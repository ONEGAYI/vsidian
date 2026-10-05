// #337 PDF 悬停首条闭环的原生浏览器回归：真实 Chromium 内生产装配链路
// ——悬停指向本地 PDF 的双链/普通链接（真实指针开浮层）→ 宿主 pdf 载荷
// 回包注入 → 生产 PdfHoverView 经真实 pdfMain.js 懒加载 + pdfWorker.js
// blob 装配 + 真实 PDF.js 解析渲染到 canvas。断言落绘制层（canvas 实际
// 像素：非白比例与页身份色）而非 DOM 存在性；锚点分态（anchor-invalid
// 就地报错）、页码越界（page-range 不静默跳第一页）、翻页操作（乐观页码
// 推进 + 绘制追上）、失效撤下与零写回一并覆盖。
// #338（P3-06）追加全文按页滚动场景：12 页样本从首到末浏览、中/末段页
// 身份色绘制层证明、画布挂载有界与离屏回收、翻页=滚动定位互通。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium, ensurePdfArtifacts } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildThreePageColorPdf, buildMultiPageColorPdf } from '../pdfSample.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'hoverPdf/hoverPdf.js')
await build({ entryPoints: [path.join(root, 'test/browser/hoverPdfFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  'PDF 双链 [[资料.pdf]] 与指定页 [[资料.pdf#page=2]]。',
  '',
  '非法锚点 [[资料.pdf#page=0]] 与未知键 [[资料.pdf#zoom=2]]。',
  '',
  '普通链接 [本地 PDF](资料.pdf) 与 [带 fragment](资料.pdf#page=3)。',
  '',
  '长文 [[长文.pdf]]。',
  '',
].join('\n')

const OPEN_WAIT = 700
const RENDER_WAIT = 2500 // PDF.js 首次装载 + worker 启动 + 绘制

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

// 真实 PDF 样本（三页红/绿/蓝；长文 12 页红绿蓝循环）——经 page.route fulfill 虚拟 URL
const samplePdf = await buildThreePageColorPdf()
const longPdf = await buildMultiPageColorPdf(12)
// PDF 产物先确保在场再读取（CI 无预构建产物时按需构建，#346 修复轮 2）
await ensurePdfArtifacts(root)
const pdfMainJs = await readFile(path.join(root, 'out/webview/pdfMain.js'))
const pdfWorkerJs = await readFile(path.join(root, 'out/webview/pdfWorker.js'))
const LONG_PDF_URI = 'https://files.local/%E9%95%BF%E6%96%87.pdf'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const consoleMsgs = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMsgs.push(`${msg.type()}: ${msg.text()}`)
    }
  })
  // 虚拟装配资源路由：pdfMain/pdfWorker/PDF 样本（cmaps 等资产按需命中——
  // 三页纯色样本不需要 CMap/字体/wasm，缺失路由不触发）。Playwright 路由
  // LIFO 匹配：兜底 404 先注册，精确路由后注册（优先命中）
  await page.route('https://assets.local/**', (route) =>
    route.fulfill({ status: 404, body: '' }))
  await page.route('https://assets.local/pdfMain.js', (route) =>
    route.fulfill({ body: pdfMainJs, contentType: 'application/javascript' }))
  await page.route('https://assets.local/pdfWorker.js', (route) =>
    route.fulfill({ body: pdfWorkerJs, contentType: 'application/javascript' }))
  await page.route('https://files.local/%E8%B5%84%E6%96%99.pdf**', (route) =>
    route.fulfill({ body: samplePdf, contentType: 'application/pdf' }))
  await page.route(`${LONG_PDF_URI}**`, (route) =>
    route.fulfill({ body: longPdf, contentType: 'application/pdf' }))

  // 主页面经虚拟 https origin 装载（PDF.js 的 blob worker 按 location 同源
  // 判定启用真 worker——setContent 的 about:blank/null origin 会回落 fake
  // worker，与生产 webview（资源域 origin）的装配面分叉）
  await page.route('https://app.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>` }))
  await page.goto('https://app.local/')
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initHoverPdfDoc(text), PARENT_DOC)
  await page.locator('.vsidian-view-reading .vsidian-wikilink').first().waitFor()
  await page.evaluate(() => window.applyPdfAssets({
    mainJs: 'https://assets.local/pdfMain.js',
    workerJs: 'https://assets.local/pdfWorker.js',
    cMapUrl: 'https://assets.local/cmaps',
    fontUrl: 'https://assets.local/fonts',
    wasmUrl: 'https://assets.local/wasm',
    iccUrl: 'https://assets.local/iccs',
  }))

  const hoverRequests = () => page.evaluate(() =>
    window.hoverPdfSent().filter((m) => m.kind === 'hover.request'))
  const lastRequest = async () => (await hoverRequests()).at(-1)
  const editRequestCount = () => page.evaluate(() =>
    window.hoverPdfSent().filter((m) => m.kind === 'edit.request').length)
  const readPopup = () => page.evaluate(() => window.readHoverPdf())
  // 页参必须显式转发进 evaluate（缺省取文档序首个画布——页池模式下那是
  // 窗口首页而非当前页，#338 断言一律按页号采样）
  const pixels = (pageNo) => page.evaluate((p) => window.readPdfCanvasPixels(p), pageNo)
  /** 命中帧采样：waitForFunction 等谓词通过后仍可能落入重渲染间隙的白帧——
   *  Node 侧短轮询直到采样本身满足校验（绘制确实发生，交替白是过渡帧） */
  const pixelsUntil = async (pageNo, ok) => {
    await page.waitForFunction((p) => {
      const px = window.readPdfCanvasPixels(p)
      return px !== null && px.center.some((v) => v < 245)
    }, pageNo, { timeout: 10000 })
    let last = null
    for (let i = 0; i < 60; i++) {
      const px = await pixels(pageNo)
      last = px
      if (px && ok(px)) return px
      await page.waitForTimeout(100)
    }
    return pixels(pageNo)
  }
  const respondPdf = async (req, { page: pageNo, version = 3 } = {}) => {
    await page.evaluate(({ reqId, instanceId, pageNo, version }) =>
      window.respondHoverPdfResult({
        reqId, instanceId, pdfUri: 'https://files.local/%E8%B5%84%E6%96%99.pdf?v=' + version,
        bytes: 1234, ...(pageNo !== undefined ? { page: pageNo } : {}), version,
      }), { reqId: req.reqId, instanceId: req.instanceId, pageNo, version })
  }
  const escClose = async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(80)
  }

  // ---- 场景 A：双链 PDF 悬停 → pdf 载荷 → 第一页（红）实际绘制 ----
  const wikilink = page.locator('.vsidian-view-reading .vsidian-wikilink').filter({ hasText: '资料.pdf' }).first()
  await wikilink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  let probe = await readPopup()
  assert.ok(probe.open, '双链 PDF 悬停后浮层应打开')
  assert.equal(probe.state, 'loading', '打开即呈 loading')
  let req = await lastRequest()
  assert.equal(req.target, '资料.pdf', '双链 target 为 `|` 前原文')
  await respondPdf(req)
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.state, 'content', 'pdf 载荷应用后浮层呈内容态')
  assert.equal(probe.scope, 'pdf', 'scope 标记 pdf 形态')
  assert.equal(probe.pdf.phase, 'content', '渲染器进入绘制完成态')
  assert.equal(probe.pdf.page, 1, '无页码从第一页开始')
  assert.equal(probe.pdf.totalPages, 3, '总页数来自真实 PDF.js 装载')
  assert.ok(probe.pdf.canvasWidth > 0 && probe.pdf.canvasHeight > 0, 'canvas 实际尺寸入观测面')
  let px = await pixels(1)
  assert.ok(px, 'canvas 在场')
  assert.ok(px.nonWhiteRatio > 0.5, `非白像素比例应过半（实测 ${px.nonWhiteRatio}）`)
  assert.ok(px.center[0] > 180 && px.center[1] < 100, `第一页中心应为红色（实测 ${px.center}）`)
  await escClose()
  passed++

  // ---- 场景 B：指定页双链 #page=2 → 宿主解析页码 → 绿页绘制 ----
  await page.mouse.move(5, 5)
  await page.waitForTimeout(80)
  const pageLink = page.locator('.vsidian-view-reading .vsidian-wikilink').filter({ hasText: '资料.pdf#page=2' }).first()
  await pageLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  assert.equal(req.target, '资料.pdf#page=2', '指定页双链 target 原文携带锚点')
  await respondPdf(req, { page: 2 })
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.pdf.phase, 'content', '指定页绘制完成')
  assert.equal(probe.pdf.page, 2, '初始定位第 2 页')
  px = await pixels(2)
  assert.ok(px.center[1] > 180 && px.center[0] < 100, `第二页中心应为绿色（实测 ${px.center}）`)

  // 翻页操作：下一页到蓝页（乐观页码 + 绘制追上）
  assert.ok(await page.evaluate(() => window.turnPdfPage(1)), '翻页操作应生效')
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.pdf.page, 3, '翻页推进到第 3 页')
  px = await pixels(3)
  assert.ok(px.center[2] > 180 && px.center[1] < 100, `第三页中心应为蓝色（实测 ${px.center}）`)
  assert.equal(await page.evaluate(() => window.turnPdfPage(1)), false, '末页再翻出界为无操作')
  await escClose()
  passed++

  // ---- 场景 C：页码越界（#page=9 越出总页数）→ page-range 就地报错，不静默跳第一页 ----
  await page.mouse.move(5, 5)
  await page.waitForTimeout(80)
  const overflowLink = page.locator('.vsidian-view-reading .vsidian-wikilink').filter({ hasText: '资料.pdf#page=2' }).first()
  await overflowLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  await respondPdf(req, { page: 9 })
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.state, 'error', '页码越界呈错误分态')
  assert.equal(probe.pdf.phase, 'error', '渲染器错误态')
  assert.equal(probe.pdf.errorReason, 'page-range', '分态为页码越界')
  assert.equal(probe.pdf.requestedPage, 9, '请求页码保留（修正后重试的指引）')
  const stateText = await page.locator('.vsidian-hover-popup-state').textContent()
  assert.ok(stateText.includes('9') && stateText.includes('3'), '错误文案携带请求页与总页数')
  assert.ok((await pixels()) === null, '错误态 canvas 清零（无旧内容冒充）')
  await escClose()
  passed++

  // ---- 场景 D：宿主 anchor-invalid 分态（page=0 非法格式）就地报错 ----
  await page.mouse.move(5, 5)
  await page.waitForTimeout(80)
  const badAnchor = page.locator('.vsidian-view-reading .vsidian-wikilink').filter({ hasText: '资料.pdf#page=0' }).first()
  await badAnchor.hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  await page.evaluate(({ reqId, instanceId }) => window.respondHoverPdfFail({
    reqId, instanceId, reason: 'anchor-invalid', anchor: 'page=0',
  }), { reqId: req.reqId, instanceId: req.instanceId })
  await page.waitForTimeout(120)
  probe = await readPopup()
  assert.equal(probe.state, 'error', '非法锚点呈错误分态')
  const badText = await page.locator('.vsidian-hover-popup-state').textContent()
  assert.ok(badText.includes('page=0'), '错误文案附锚点原文')
  await escClose()
  passed++

  // ---- 场景 E：普通链接 fragment 不解析（宿主回包无 page → 第一页红）----
  await page.mouse.move(5, 5)
  await page.waitForTimeout(80)
  const mdLink = page.locator('a').filter({ hasText: '本地 PDF' })
  await mdLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  const mdHref = await mdLink.evaluate((el) => el.getAttribute('href'))
  assert.equal(req.linkHref, mdHref, '普通链接以 linkHref 形态请求（DOM href 原样——编码形态由宿主容错解码）')
  await respondPdf(req)
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.pdf.page, 1, '普通链接 fragment 不解析——从第一页开始')
  px = await pixels(1)
  assert.ok(px.center[0] > 180 && px.center[1] < 100, `第一页中心应为红色（实测 ${px.center}）`)
  await escClose()
  passed++

  // ---- 场景 G（#338）：长文 12 页全文滚动——首到末可达、中/末段绘制层
  // 证明、画布挂载有界与离屏回收、翻页=滚动定位互通 ----
  await page.mouse.move(5, 5)
  await page.waitForTimeout(80)
  const longLink = page.locator('.vsidian-view-reading .vsidian-wikilink').filter({ hasText: '长文.pdf' }).first()
  await longLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  assert.equal(req.target, '长文.pdf', '长文双链 target 原文')
  await page.evaluate(({ reqId, instanceId, pdfUri }) => window.respondHoverPdfResult({
    reqId, instanceId, pdfUri, bytes: 8192, version: 1,
  }), { reqId: req.reqId, instanceId: req.instanceId, pdfUri: `${LONG_PDF_URI}?v=1` })
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.pdf.phase, 'content', '长文装载绘制完成')
  assert.equal(probe.pdf.totalPages, 12, '总页数 12（真实 PDF.js）')
  assert.ok(probe.pdf.mountedPages < 12, `画布挂载有界（实测 ${probe.pdf.mountedPages}/12）`)
  assert.ok(probe.pdf.scrollHeight > 11 * 400, `全文高度撑开（实测 ${probe.pdf.scrollHeight}px）`)
  // 滚到中段（第 7 页区间 = 6/11 × 最大滚动）
  const longScrollMax = await page.evaluate(() => {
    // .mjs 无 TS 转译——泛型写法会退化为链式比较（布尔），必须裸调用
    const scroll = document.querySelector('.vsidian-hover-popup-scroll')
    return scroll ? scroll.scrollHeight - scroll.clientHeight : 0
  })
  await page.evaluate((top) => window.scrollPdfTo(top), Math.round(longScrollMax * 6 / 11))
  await page.waitForFunction(() => {
    const probe = window.readHoverPdf()
    return probe.pdf.page >= 7 && probe.pdf.mountedPages < 12
  }, { timeout: 10000 })
  probe = await readPopup()
  assert.ok(probe.pdf.page >= 7, `滚动到中段（实际第 ${probe.pdf.page} 页）`)
  // 首页画布回收（离屏页不占画布）
  assert.equal(await page.evaluate(() =>
    document.querySelectorAll('.vsidian-hover-popup .vsidian-hover-pdf-page[data-page="1"]').length), 0,
  '离屏首页占位已回收')
  // 中段页身份色：滚入窗口后渲染异步追上——谓词直接返回命中帧的采样
  //（waitForFunction 通过后二次采样会再入重渲染间隙——白底已画、内容
  // 未到的帧——取通过帧本身）
  {
    const midPage = probe.pdf.page
    px = await pixelsUntil(midPage, (p) => p.center.some((v) => v < 245))
    assert.ok(px, '中段页画布在场且非白')
    const expectGreen = (midPage - 1) % 3 === 1
    const okColor = expectGreen
      ? px.center[1] > 180 && px.center[0] < 100
      : (midPage - 1) % 3 === 0
        ? px.center[0] > 180 && px.center[1] < 100
        : px.center[2] > 180 && px.center[1] < 100
    assert.ok(okColor, `中段第 ${midPage} 页身份色正确（实测 ${px.center}）`)
  }
  // 滚到末页（第 12 页 = 蓝）
  await page.evaluate((top) => window.scrollPdfTo(top), longScrollMax)
  await page.waitForFunction(() => {
    const probe = window.readHoverPdf()
    return probe.pdf.page === 12
  }, { timeout: 10000 })
  probe = await readPopup()
  assert.equal(probe.pdf.page, 12, '滚到末页')
  px = await pixelsUntil(12, (p) => p.center[2] > 180)
  assert.ok(px && px.center[2] > 180 && px.center[1] < 100,
    `末页中心应为蓝色（实测 ${px?.center}）——末段确实呈现的绘制层证明`)
  probe = await readPopup()
  assert.ok(probe.pdf.mountedPages < 12, `末段画布挂载仍有界（实测 ${probe.pdf.mountedPages}/12）`)
  // 翻页=滚动定位互通：上一页（第 11 页 = 绿）落回页顶偏移
  assert.ok(await page.evaluate(() => window.turnPdfPage(-1)), '翻页操作生效')
  await page.waitForTimeout(400)
  probe = await readPopup()
  assert.equal(probe.pdf.page, 11, '翻页推进到第 11 页')
  assert.ok(probe.pdf.scrollTop > 0 && probe.pdf.scrollTop < longScrollMax, '翻页落点为滚动定位（页顶偏移）')
  px = await pixelsUntil(11, (p) => p.center[1] > 180)
  assert.ok(px && px.center[1] > 180 && px.center[0] < 100, `第 11 页中心应为绿色（实测 ${px?.center}）`)
  // 共享文档存储观测：本浮层持有 1 份引用
  const store = await page.evaluate(() => window.pdfDocumentStoreStats())
  assert.ok(store.length === 1 && store[0].refs === 1, `长文文档单引用（实测 ${JSON.stringify(store)}）`)
  await escClose()
  passed++

  // ---- 场景 E2（#344 / D-10）：重复开关的资源回落压测 ----
  // 20 轮「悬停开 → 装载绘制 → Esc 关」，每轮推进资源代次（?v= 不同 =
  // 新 store 键——最重路径：每轮 acquire + destroy，无缓存复用）。每轮
  // 关闭后断言共享文档存储回落为空、画布元素清空；收口断言总开关次数下
  // 无任何累积（store 条目/refs/canvas）。
  const stressRounds = 20
  for (let round = 0; round < stressRounds; round++) {
    await page.mouse.move(5, 5)
    await page.waitForTimeout(60)
    await wikilink.hover()
    await page.waitForTimeout(OPEN_WAIT)
    req = await lastRequest()
    await respondPdf(req, { version: 100 + round })
    await page.waitForTimeout(RENDER_WAIT)
    const opened = await readPopup()
    assert.ok(opened.open && opened.pdf.phase === 'content',
      `压测轮 ${round}：装载绘制完成（实际 ${JSON.stringify(opened.pdf?.phase)}）`)
    await escClose()
    const store = await page.evaluate(() => window.pdfDocumentStoreStats())
    assert.deepEqual(store, [],
      `压测轮 ${round}：关闭后共享文档存储应回落为空（实际 ${JSON.stringify(store)}）`)
    const canvasCount = await page.evaluate(() =>
      document.querySelectorAll('.vsidian-hover-pdf-canvas').length)
    assert.equal(canvasCount, 0, `压测轮 ${round}：浮层销毁后 PDF 画布不残留（实际 ${canvasCount}）`)
  }
  passed++
  console.log(`[#344/D-10] ${stressRounds} 轮开关资源回落压测通过`)

  // ---- 场景 F：零写回与装配无页面错误 ----
  assert.equal(await editRequestCount(), 0, '悬停 PDF 全程零写回（edit.request 通道零调用）')
  assert.deepEqual(errors, [], '页面零未捕获错误（worker blob 装配与渲染无异常）')
  passed++

  console.log(`hoverPdf: ${passed} 场景通过`)
} finally {
  await browser.close()
}
