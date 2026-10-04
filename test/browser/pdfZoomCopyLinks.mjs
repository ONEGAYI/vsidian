// #339（P3-07）PDF 适合宽度/缩放/文本选择/链接 的原生浏览器回归：
// 真实 Chromium + 真实 pdfjs（pdfMain/pdfWorker 经虚拟 URL 装配）在生产
// 控制器链路上验证——文本层 span 与画布墨迹对齐（映射区域像素采样）、
// 原生选区文本（西文恒定 + 中文按样本嵌入能力条件）、缩放改变实际绘制
// 尺寸且预算不越界、重绘后文本层仍对齐、内部 GoTo 就地翻页（目标页淡绿
// 底绘制层证明）、https 外链经 link.activate 出站、禁用面零动作、全程
// 零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildTextLinkPdf } from '../pdfSample.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'pdfZoomCopyLinks/pdfZoomCopyLinks.js')
await build({ entryPoints: [path.join(root, 'test/browser/pdfZoomCopyLinksFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  '文本链接 [[文本链接.pdf]]。',
  '',
].join('\n')

const OPEN_WAIT = 700
const RENDER_WAIT = 2500

const { islandHtml } = await buildZhLocaleIsland(root)

const sample = await buildTextLinkPdf()
const samplePdf = sample.bytes
const pdfMainJs = await readFile(path.join(root, 'out/webview/pdfMain.js'))
const pdfWorkerJs = await readFile(path.join(root, 'out/webview/pdfWorker.js'))
const SAMPLE_URI = 'https://files.local/%E6%96%87%E6%9C%AC%E9%93%BE%E6%8E%A5.pdf'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://assets.local/**', (route) =>
    route.fulfill({ status: 404, body: '' }))
  await page.route('https://assets.local/pdfMain.js', (route) =>
    route.fulfill({ body: pdfMainJs, contentType: 'application/javascript' }))
  await page.route('https://assets.local/pdfWorker.js', (route) =>
    route.fulfill({ body: pdfWorkerJs, contentType: 'application/javascript' }))
  await page.route(`${SAMPLE_URI}**`, (route) =>
    route.fulfill({ body: samplePdf, contentType: 'application/pdf' }))
  await page.route('https://app.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>` }))
  await page.goto('https://app.local/')
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initZoomPdfDoc(text), PARENT_DOC)
  await page.locator('.vsidian-view-reading .vsidian-wikilink').first().waitFor()
  await page.evaluate(() => window.applyPdfAssets({
    mainJs: 'https://assets.local/pdfMain.js',
    workerJs: 'https://assets.local/pdfWorker.js',
    cMapUrl: 'https://assets.local/cmaps',
    fontUrl: 'https://assets.local/fonts',
    wasmUrl: 'https://assets.local/wasm',
    iccUrl: 'https://assets.local/iccs',
  }))

  const sentKinds = () => page.evaluate(() =>
    window.zoomPdfSent().map((m) => m.kind))
  const readPopup = () => page.evaluate(() => window.readZoomPdf())
  const editRequestCount = () => page.evaluate(() =>
    window.zoomPdfSent().filter((m) => m.kind === 'edit.request').length)

  // ---- 场景 A：文本层挂载与对齐（span 矩形映射画布墨迹） ----
  const wikilink = page.locator('.vsidian-view-reading .vsidian-wikilink').filter({ hasText: '文本链接.pdf' }).first()
  await wikilink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req = (await page.evaluate(() =>
    window.zoomPdfSent().filter((m) => m.kind === 'hover.request'))).at(-1)
  await page.evaluate(({ reqId, instanceId, pdfUri }) => window.respondZoomPdfResult({
    reqId, instanceId, pdfUri,
  }), { reqId: req.reqId, instanceId: req.instanceId, pdfUri: `${SAMPLE_URI}?v=3` })
  await page.waitForTimeout(RENDER_WAIT)
  let probe = await readPopup()
  assert.equal(probe.state, 'content', 'pdf 载荷应用后内容态')
  assert.equal(probe.pdf.phase, 'content', '渲染器绘制完成')
  assert.equal(probe.pdf.totalPages, 2, '样本两页')
  assert.equal(probe.pdf.zoom, 1, '默认适合宽度（zoom=1）')
  assert.ok(probe.pdf.textLayerPages >= 1, `文本层挂载（实测 ${probe.pdf.textLayerPages} 页带 span）`)
  assert.ok(probe.pdf.linkAnnotations >= 6, `链接层挂载（实测 ${probe.pdf.linkAnnotations} 枚）`)
  // 对齐断言：span 矩形映射到画布的非白像素（文本绘制在 span 之下）
  let ink = await page.evaluate((t) => window.pdfSpanInkPixels(1, t), 'The quick brown fox')
  assert.ok(ink > 10, `西文 span 与画布墨迹对齐（实测非白 ${ink} 像素）`)
  // span 几何与选区语义
  const span = await page.evaluate((t) => window.readPdfTextSpan(1, t), 'The quick brown fox')
  assert.ok(span?.found, '西文 span 在场')
  assert.equal(span.userSelect, 'text', 'span 可选（原生选区语义）')
  const selected = await page.evaluate((t) => window.selectPdfSpanText(1, t), 'The quick brown fox')
  assert.equal(selected, 'The quick brown fox', `选区文本准确（实测 "${selected}"）`)
  // 中文（样本嵌入能力条件断言——运行机无 CJK 字体时跳过并说明）
  if (sample.cjkText !== null) {
    ink = await page.evaluate((t) => window.pdfSpanInkPixels(1, t), sample.cjkText)
    assert.ok(ink > 10, `中文 span 与画布墨迹对齐（实测非白 ${ink} 像素）`)
    const zhSelected = await page.evaluate((t) => window.selectPdfSpanText(1, t), sample.cjkText)
    assert.ok(zhSelected.includes('中文文本'), `中文选区文本准确（实测 "${zhSelected}"）`)
  } else {
    console.log('（运行机无 CJK 字体——中文选区断言按样本能力跳过）')
  }
  passed++

  // ---- 场景 B：放大改变实际绘制尺寸 + 页码行百分比 + 预算 + 重对齐 ----
  const fitWidth = probe.pdf.canvasWidth
  const fitInk = ink
  assert.ok(await page.evaluate(() => window.zoomPdf(1.25)), '放大受理')
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  const zoomedWidth = probe.pdf.canvasWidth
  assert.ok(probe.pdf.zoom > 1, `zoom 乘子推进（实测 ${probe.pdf.zoom}）`)
  assert.ok(zoomedWidth > fitWidth, `绘制尺寸实际放大（${fitWidth} → ${zoomedWidth}）`)
  assert.ok(probe.pdf.canvasBytes <= 40 * 1024 * 1024, `画布预算不越界（实测 ${(probe.pdf.canvasBytes / 1048576).toFixed(1)} MiB）`)
  assert.ok(probe.pdf.mountedPages <= 8, `挂载页有界（实测 ${probe.pdf.mountedPages}）`)
  const infoText = await page.evaluate(() => window.pdfPageInfoText())
  assert.ok(infoText.includes('%'), `页码行附缩放百分比（实测 "${infoText}"）`)
  // 重绘后文本层仍与字符位置对应（span 重挂 + 墨迹对齐复验）
  const zoomedInk = await page.evaluate((t) => window.pdfSpanInkPixels(1, t), 'The quick brown fox')
  assert.ok(zoomedInk > 10, `放大重绘后 span 仍与画布墨迹对齐（实测 ${zoomedInk} 像素）`)
  assert.ok(zoomedInk > fitInk, `放大后墨迹像素数多于 fit 态（字形变大——${fitInk} → ${zoomedInk}）`)
  // 缩小（生产步进 1/1.25）与适合宽度复位
  assert.ok(await page.evaluate(() => window.zoomPdf(1 / 1.25)), '缩小受理（zoom 回 1）')
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.ok(probe.pdf.canvasWidth < zoomedWidth, `缩小后绘制尺寸回落（${zoomedWidth} → ${probe.pdf.canvasWidth}）`)
  assert.ok(await page.evaluate(() => window.zoomPdf(1 / 1.25)), '再缩小受理（zoom < 1）')
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.ok(probe.pdf.zoom < 1 && probe.pdf.canvasWidth < fitWidth, `进一步缩小（zoom ${probe.pdf.zoom}，宽 ${probe.pdf.canvasWidth}）`)
  assert.ok(await page.evaluate(() => window.resetPdfZoom()), '适合宽度复位置理')
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.pdf.zoom, 1, '复位后 zoom=1')
  assert.ok(Math.abs(probe.pdf.canvasWidth - fitWidth) <= 1, `复位回宽度适配绘制尺寸（${probe.pdf.canvasWidth} ≈ ${fitWidth}）`)
  const resetInk = await page.evaluate((t) => window.pdfSpanInkPixels(1, t), 'The quick brown fox')
  assert.ok(resetInk > 10, `复位重绘后对齐保持（实测 ${resetInk} 像素）`)
  passed++

  // ---- 场景 C：链接矩阵——内部跳转绘制层证明 + 外链出站 + 禁用面 ----
  const links = await page.evaluate(() => window.readPdfLinks(1))
  assert.ok(links.length >= 6, `六枚链接元素挂载（实测 ${links.length}）`)
  for (const l of links) {
    assert.equal(l.href, null, '链接元素不带 href（不可导航面）')
    assert.ok(l.width > 5 && l.height > 5, `链接矩形非零（${l.width}×${l.height}）`)
  }
  // ① 内部 GoTo：点击 → 就地翻到第 2 页（淡绿底绘制层证明）
  await page.evaluate(() => window.clickPdfLink(1, 0))
  await page.waitForTimeout(RENDER_WAIT)
  probe = await readPopup()
  assert.equal(probe.pdf.page, 2, `内部链接就地翻页（实际第 ${probe.pdf.page} 页）`)
  {
    const px = await page.evaluate(() => {
      const canvas = document.querySelector('.vsidian-hover-pdf-page[data-page="2"] canvas')
      if (!canvas) return null
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
      return [d[0], d[1], d[2]]
    })
    assert.ok(px, '目标页画布在场')
    assert.ok(px[1] > px[0] && px[1] > 200, `第 2 页中心为淡绿底（实测 ${px}）——跳转确实呈现目标页`)
  }
  // 回第 1 页（滚动定位复位）供外链场景
  await page.evaluate(() => {
    const scroll = document.querySelector('.vsidian-hover-popup-scroll')
    if (scroll) {
      scroll.scrollTop = 0
      scroll.dispatchEvent(new Event('scroll'))
    }
  })
  await page.waitForFunction(() => window.readZoomPdf().pdf.page === 1, { timeout: 10000 })
  await page.waitForTimeout(400)
  // ② https 外链：显式点击 → link.activate 出站（面板会话身份、无 sourceDocUri）
  await page.evaluate(() => window.clickPdfLink(1, 1))
  await page.waitForTimeout(200)
  const activate = await page.evaluate(() =>
    window.zoomPdfSent().filter((m) => m.kind === 'link.activate'))
  assert.ok(activate.length >= 1, 'https 外链点击产生 link.activate 出站')
  const lastActivate = activate.at(-1)
  assert.equal(lastActivate.href, 'https://example.com/pdf-doc-link', '出站 href 为注解 URL')
  assert.equal(lastActivate.sourceDocUri, undefined, '无 sourceDocUri（PDF 不是文档解析语境）')
  probe = await readPopup()
  assert.ok(probe.open && probe.state === 'content', '外链点击不关闭浮层（阅读面保持在场）')
  // 自动外链预览请求不发生（#342 卡片通道不被 PDF 链接触发）
  const hoverReqs = await page.evaluate(() =>
    window.zoomPdfSent().filter((m) => m.kind === 'hover.request').length)
  assert.equal(hoverReqs, 1, `跳转不发送自动外链预览请求（hover.request 恒 ${hoverReqs}）`)
  // ③ 禁用面：ftp / javascript / file / Launch / 未知目标——零动作零出站
  const disabledLinks = links.filter((l) => l.disabled)
  assert.ok(disabledLinks.length >= 4, `禁用链接 ≥4（实测 ${disabledLinks.length}——ftp/javascript/file/Launch）`)
  for (const l of disabledLinks) {
    assert.ok(l.tooltip.length > 0, '禁用链接带提示（data-tooltip）')
  }
  for (let i = 2; i < 6; i++) {
    await page.evaluate((idx) => window.clickPdfLink(1, idx), i)
  }
  await page.waitForTimeout(200)
  probe = await readPopup()
  assert.equal(probe.pdf.page, 1, '禁用链接点击零翻页')
  const afterDisabled = await page.evaluate(() =>
    window.zoomPdfSent().filter((m) => m.kind === 'link.activate').length)
  assert.equal(afterDisabled, activate.length, '禁用链接点击零出站')
  passed++

  // ---- 场景 D：零写回与页面零错误；Esc 关闭沿用外层 ----
  assert.equal(await editRequestCount(), 0, '缩放/选区/链接全程零写回（edit.request 零调用）')
  assert.deepEqual(errors, [], '页面零未捕获错误（TextLayer/链接层装配无异常）')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  probe = await readPopup()
  assert.equal(probe.open, false, 'Esc 沿用外层关闭（不被 PDF 链接层夺取）')
  passed++

  console.log(`pdfZoomCopyLinks: ${passed} 场景通过${sample.cjkText === null ? '（中文断言按样本能力跳过）' : ''}`)
} finally {
  await browser.close()
}
