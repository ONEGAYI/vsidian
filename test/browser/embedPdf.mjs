// #338（P3-06）PDF 全文滚动与正文嵌入的原生浏览器回归：真实 Chromium
// 内生产装配链路——父文档 Reading 正文中的 ![[资料.pdf]] 经真实挂载
// 链路升级为引用卡片，宿主 pdf 载荷回包注入后卡片侧挂生产 PdfHoverView
//（真实 pdfMain.js/pdfWorker.js 装配 + 真实 PDF.js 绘制）。容器矩阵
//（独占行/混排/引用/表格格内/递归孙卡）各至少一条绘制层断言（canvas
// 实际像素：页身份色），加双 occurrence 共享文档与独立滚动、父 Live
// 源码显隐、changed 失效重载与零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium, ensurePdfArtifacts } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildMultiPageColorPdf } from '../pdfSample.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'embedPdf/embedPdf.js')
await build({ entryPoints: [path.join(root, 'test/browser/embedPdfFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# PDF 嵌入矩阵',
  '',
  '![[资料.pdf]]',
  '',
  '混排开头 ![[资料.pdf#page=2]] 混排结尾。',
  '',
  '> 引用内 ![[资料.pdf#page=3]]',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| ![[资料.pdf]] | 普通格 |',
  '',
  '递归见 ![[子文档.md]]',
  '',
].join('\n')

const CHILD_DOC = ['# 子文档', '', '内层 ![[资料.pdf]]', '', '结尾。', ''].join('\n')

const RENDER_WAIT = 2500 // PDF.js 装载 + worker + 多卡绘制

const { islandHtml } = await buildZhLocaleIsland(root)

// 12 页样本（红绿蓝循环）与 3 页锚点页（1红/2绿/3蓝 一致）
const samplePdf = await buildMultiPageColorPdf(12)
// PDF 产物先确保在场再读取（CI 无预构建产物时按需构建，#346 修复轮 2）
await ensurePdfArtifacts(root)
const pdfMainJs = await readFile(path.join(root, 'out/webview/pdfMain.js'))
const pdfWorkerJs = await readFile(path.join(root, 'out/webview/pdfWorker.js'))
const PDF_URI = 'https://files.local/%E8%B5%84%E6%96%99.pdf'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://assets.local/**', (route) =>
    route.fulfill({ status: 404, body: '' }))
  await page.route('https://assets.local/pdfMain.js', (route) =>
    route.fulfill({ body: pdfMainJs, contentType: 'application/javascript' }))
  await page.route('https://assets.local/pdfWorker.js', (route) =>
    route.fulfill({ body: pdfWorkerJs, contentType: 'application/javascript' }))
  await page.route(`${PDF_URI}**`, (route) =>
    route.fulfill({ body: samplePdf, contentType: 'application/pdf' }))
  await page.route('https://app.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>` }))
  await page.goto('https://app.local/')
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initEmbedPdfDoc(text), PARENT_DOC)
  await page.locator('.vsidian-view-reading .vsidian-embed-card').first().waitFor({ timeout: 10000 })
  await page.evaluate(() => window.applyPdfAssets({
    mainJs: 'https://assets.local/pdfMain.js',
    workerJs: 'https://assets.local/pdfWorker.js',
    cMapUrl: 'https://assets.local/cmaps',
    fontUrl: 'https://assets.local/fonts',
    wasmUrl: 'https://assets.local/wasm',
    iccUrl: 'https://assets.local/iccs',
  }))

  const sentMsgs = () => page.evaluate(() => window.embedPdfSent())
  const hoverReqs = async () => (await sentMsgs()).filter((m) => m.kind === 'hover.request')
  // 卡快照按 reading 子序列过滤（fixture 像素采样只查 reading 容器——
  // probe 数组 live 侧卡在前，下标与 reading 容器内 DOM 序不对应）
  const cards = () => page.evaluate(() => window.readEmbedCards()).then((all) => all.filter((c) => c.host === 'reading'))
  /** 对所有在途的资料.pdf 请求回 pdf 载荷（按 target 锚点给初始页）。
   *  仅回 pdf 目标（子文档 md 请求收到 pdf 载荷会整卡变 PDF 视图，递归
   *  孙卡永不挂载）。注意参数名与 fixture 签名一致（pdfUri——传错名时
   *  uri 缺失，消息被 isHostToWebview 的 pdf 载荷契约拒收，回包静默
   *  丢弃、卡片永驻 loading） */
  const respondAllPdf = async (version = 3) => {
    const reqs = (await hoverReqs()).filter((r) => !r.target.includes('子文档'))
    for (const req of reqs) {
      await page.evaluate(({ reqId, instanceId, target, version, pdfUri }) => {
        const m = target.match(/#page=(\d+)/)
        window.respondEmbedPdf({
          reqId, instanceId, pdfUri, bytes: 4096,
          page: m ? Number(m[1]) : undefined, version,
        })
      }, { reqId: req.reqId, instanceId: req.instanceId, target: req.target, version, pdfUri: `${PDF_URI}?v=${version}` })
    }
  }
  const pixels = (index, pageNo) => page.evaluate(({ index, pageNo }) =>
    window.readCardPdfPixels(index, pageNo), { index, pageNo })
  /** 页色就绪采样：滚入窗口后渲染异步追上——轮询到画布非白取该帧采样
   *  （竞态下首次采样可能是已挂载未完成的白画布；页色判定由返回值断言） */
  const pixelsWhen = (index, pageNo) => page.waitForFunction(
    ({ index, pageNo }) => {
      const p = window.readCardPdfPixels(index, pageNo)
      return p !== null && p.center.some((v) => v < 245)
    }, { index, pageNo }, { timeout: 10000 })
    .then(() => page.evaluate(({ index, pageNo }) =>
      window.readCardPdfPixels(index, pageNo), { index, pageNo }))

  // ---- 场景 A：独占行卡装载与首页绘制（红） ----
  await page.waitForFunction(() => window.embedPdfSent().filter((m) => m.kind === 'hover.request').length >= 5)
  // 先回资料.pdf 族再回子文档：孙卡（子文档装载后挂载）与独占行/表格卡
  // 共享 entry——先回子文档会让孙卡的新请求覆盖 entry.lastReq，PDF 族旧
  // reqId 回包失配被静默丢弃（永驻 loading）。孙卡自己的请求在其出现后
  // 由 respondAllPdf 补回
  await respondAllPdf()
  await page.waitForFunction(() => {
    const cs = window.readEmbedCards().filter((c) => c.host === 'reading')
    return cs.filter((c) => c.pdf && c.pdf.phase === 'content').length >= 4
  }, { timeout: 15000 })
  const reqs0 = await hoverReqs()
  const childReq = reqs0.find((r) => r.target.includes('子文档'))
  if (childReq) {
    await page.evaluate(({ reqId, instanceId, text }) =>
      window.respondEmbedMd({ reqId, instanceId, text }), { reqId: childReq.reqId, instanceId: childReq.instanceId, text: CHILD_DOC })
  }
  // 孙卡请求出现后补回（场景 D 的递归层）
  await page.waitForFunction((before) =>
    window.embedPdfSent().filter((m) => m.kind === 'hover.request').length > before, reqs0.length, { timeout: 10000 })
  await respondAllPdf()
  let cs = await cards()
  assert.equal(cs[0].pdf.phase, 'content', '独占行卡进入绘制态')
  assert.equal(cs[0].pdf.page, 1, '无锚点从第一页开始')
  assert.equal(cs[0].pdf.totalPages, 12, '总页数来自真实 PDF.js 装载')
  let px = await pixels(0)
  assert.ok(px, '独占行卡画布在场')
  assert.ok(px.nonWhiteRatio > 0.5, `非白比例过半（实测 ${px.nonWhiteRatio}）`)
  assert.ok(px.center[0] > 180 && px.center[1] < 100, `第一页中心应为红色（实测 ${px.center}）`)
  // 挂载有界：窗口画布数远小于总页数
  assert.ok(cs[0].pdf.mountedPages < 12, `画布挂载有界（实测 ${cs[0].pdf.mountedPages}/12）`)
  passed++

  // ---- 场景 B：混排 #page=2 → 绿页绘制 ----
  cs = await cards()
  const mixed = cs.find((c) => c.host === 'reading' && c.inner.includes('#page=2'))
  assert.ok(mixed.pdf?.phase === 'content', '混排卡绘制态')
  assert.equal(mixed.pdf.page, 2, '混排卡初始定位第 2 页')
  const mixedIndex = cs.indexOf(mixed)
  px = await pixelsWhen(mixedIndex, 2)
  assert.ok(px && px.center[1] > 180 && px.center[0] < 100, `混排卡第 2 页中心应为绿色（实测 ${px?.center}）`)
  passed++

  // ---- 场景 C：引用内与表格格内卡在场且绘制 ----
  cs = await cards()
  const quote = cs.find((c) => c.host === 'reading' && c.inner.includes('#page=3'))
  assert.ok(quote && quote.pdf?.phase === 'content', '引用内嵌入卡绘制态')
  const quoteIndex = cs.indexOf(quote)
  px = await pixelsWhen(quoteIndex, 3)
  assert.ok(px && px.center[2] > 180 && px.center[1] < 100, `引用内卡第 3 页中心应为蓝色（实测 ${px?.center}）`)
  const tableCard = cs.find((c) => c.host === 'reading' && c.inner === '资料.pdf' && cs.indexOf(c) !== 0)
  assert.ok(tableCard && tableCard.pdf?.phase === 'content', '表格格内嵌入卡绘制态')
  const tableIndex = cs.indexOf(tableCard)
  px = await pixelsWhen(tableIndex, tableCard.pdf.page)
  assert.ok(px && px.nonWhiteRatio > 0.5, '表格格内卡非白比例过半（绘制层证据）')
  passed++

  // ---- 场景 D：递归孙卡（子文档 md → 内层资料.pdf 卡） ----
  // 前面的 12 页塔把递归段推出视口——阅读虚拟化已把子文档块回收；滚到
  // 文档底部让块重新挂载（孙卡 DOM 回场），probe 驻留不受影响
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(1200)
  cs = await cards()
  const grandchild = cs.find((c) => c.host === 'reading' && c.depth >= 2 && c.pdf != null)
  assert.ok(grandchild && grandchild.pdf?.phase === 'content', '递归孙卡（depth≥2）PDF 绘制态')
  assert.ok(grandchild.pdf.nonWhiteRatio > 0.5, `孙卡绘制层证据——probe 的 canvas 实际像素采样（实测 ${grandchild.pdf.nonWhiteRatio}）`)
  assert.ok(grandchild.pdf.mountedPages < 12, `孙卡画布挂载有界（实测 ${grandchild.pdf.mountedPages}/12）`)
  passed++

  // ---- 场景 E：双 occurrence 独立滚动 + 共享文档 ----
  const storeBefore = await page.evaluate(() => window.pdfDocumentStoreStats())
  assert.ok(storeBefore.length >= 1 && storeBefore[0].refs >= 4,
    `同 URI 多卡共享一份文档（refs=${storeBefore[0]?.refs}）`)
  // 卡 0 滚到第 4 页（红）：页高按实测推（12 页均高 = scrollHeight/12）
  cs = await cards()
  // 用页码驱动：直接滚到卡片滚动区最大值的 3/12（第 4 页区间）。
  // .mjs 无 TS 转译——泛型写法会退化为链式比较（布尔），必须裸调用
  const maxScroll = await page.evaluate(() => {
    const root = [...document.querySelectorAll('.vsidian-view-reading')].find((el) => el.querySelector('.vsidian-embed-card') !== null) ?? document
    const scroll = root.querySelectorAll('.vsidian-embed-card')[0]
      ?.querySelector('.vsidian-embed-card-scroll')
    return scroll ? scroll.scrollHeight - scroll.clientHeight : 0
  })
  await page.evaluate((top) => window.scrollCardPdf(0, top), Math.round(maxScroll * 3 / 11))
  await page.waitForFunction(() => {
    const cs = window.readEmbedCards().filter((c) => c.host === 'reading')
    return cs[0]?.pdf?.page !== undefined && cs[0].pdf.page >= 4
  }, { timeout: 10000 })
  cs = await cards()
  assert.ok(cs[0].pdf.page >= 4, `卡 0 滚动到中段（实际第 ${cs[0].pdf.page} 页）`)
  assert.equal(cs[tableIndex].pdf.page, 1, `另一 occurrence 滚动独立（表格卡仍第 ${cs[tableIndex].pdf.page} 页）`)
  px = await pixels(0, cs[0].pdf.page)
  if (px) {
    // 页 4 = 红（(4-1)%3=0）；页 5 = 绿——按实际页断言身份色
    const pageNo = cs[0].pdf.page
    const expectGreen = (pageNo - 1) % 3 === 1
    const okColor = expectGreen
      ? px.center[1] > 180 && px.center[0] < 100
      : px.center[0] > 180 && px.center[1] < 100
    assert.ok(okColor, `卡 0 中段页 ${pageNo} 身份色正确（实测 ${px.center}）`)
  }
  passed++

  // ---- 场景 F：父 Live 源码显隐（切 Live 卡片在场、切回不炸） ----
  await page.evaluate(() => window.setEmbedPdfMode('live'))
  await page.waitForTimeout(400)
  cs = await cards()
  assert.ok(cs.length > 0 && cs.some((c) => c.pdf !== null), 'Live 模式下嵌入卡（含 PDF）在场')
  await page.evaluate(() => window.setEmbedPdfMode('reading'))
  await page.waitForTimeout(400)
  cs = await cards()
  assert.ok(cs.some((c) => c.pdf?.phase === 'content'), '切回 Reading 后 PDF 卡恢复绘制态')
  passed++

  // ---- 场景 G：changed 失效 → 静默重发 → 新版本 uri 重载 ----
  const reqCountBefore = (await hoverReqs()).length
  await page.evaluate(() => window.postEmbedInvalidated({
    fsPath: 'D:\\notes\\资料.pdf', status: 'changed', generation: 1,
  }))
  await page.waitForFunction((before) =>
    window.embedPdfSent().filter((m) => m.kind === 'hover.request').length > before, reqCountBefore, { timeout: 8000 })
  await respondAllPdf(4)
  await page.waitForFunction(() => {
    const cs = window.readEmbedCards().filter((c) => c.host === 'reading')
    return cs[0]?.pdf?.phase === 'content'
  }, { timeout: 10000 })
  cs = await cards()
  assert.equal(cs[0].pdf.phase, 'content', 'changed 重载后恢复内容态')
  const storeAfter = await page.evaluate(() => window.pdfDocumentStoreStats())
  assert.ok(storeAfter.every((e) => e.uri.includes('v=4')), `新代次 URI 生效（实测 ${JSON.stringify(storeAfter)}）`)
  passed++

  // ---- 场景 H：零写回与装配无页面错误 ----
  const editCount = await page.evaluate(() =>
    window.embedPdfSent().filter((m) => m.kind === 'edit.request').length)
  assert.equal(editCount, 0, '嵌入 PDF 全程零写回（edit.request 通道零调用）')
  assert.deepEqual(errors, [], '页面零未捕获错误')
  passed++

  console.log(`embedPdf: ${passed} 场景通过`)
} finally {
  await browser.close()
}
