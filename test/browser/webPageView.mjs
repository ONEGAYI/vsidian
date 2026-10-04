// #343（P3-11）外链原网页形态的原生浏览器回归：真实布局（Chromium）下
// 用真实指针与真实网络驱动生产控制器——page 形态 embeddable 样本的真实
// iframe 内容可见与滚轮滚动（断言落 iframe 内容元素而非 load 事件）、
// 沙箱/referrer 属性契约、关闭释放、DENY/HTTP 样本自动退回卡片与真实
// 原因、手动退回零设置写、恶意子页 postMessage 注入被丢弃、开关关闭
// 联动销毁。宿主抓取层（头预检/缓存/取消）在 test/unit 钉住——本层的
// 回包为受控注入，iframe 目标为本机受控 https 服务器（真实跨源装载，
// 与生产「预检退回 HTTP 后恒挂 https」的路径一致；自签证书经 context
// 的 ignoreHTTPSErrors 接受，仅测试基建）。
import assert from 'node:assert/strict'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'webPageView/webPageView.js')
await build({ entryPoints: [path.join(root, 'test/browser/webPageViewFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

// ---- 受控服务器：可嵌入样本页（含恶意 postMessage 注入） ----
/** 可嵌入页：高内容（滚轮可滚）+ 顶部标记 + 底部哨兵；装载即向父窗口
 *  注入伪造宿主消息（view.mode.set / settings.snapshot——若守卫失效会把
 *  webview 切到阅读模式或触发联动销毁，两者均有不变量断言） */
const EMBED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>可嵌入样本页</title></head>
<body style="margin:0">
<div id="marker" style="padding:8px;font-family:sans-serif">受控样本页顶部标记</div>
<div style="height:4000px"></div>
<div id="bottom" style="padding:8px">底部哨兵</div>
<script>
  window.parent.postMessage({ kind: 'view.mode.set', mode: 'reading' }, '*')
  window.parent.postMessage({ kind: 'settings.snapshot', values: { 'hover.externalShape': 'card' } }, '*')
</script>
</body></html>`

const serverHits = []
const fixturesDir = path.join(root, 'test', 'fixtures')
const tlsOptions = {
  key: readFileSync(path.join(fixturesDir, 'webframe-test-key.pem')),
  cert: readFileSync(path.join(fixturesDir, 'webframe-test-cert.pem')),
}
const server = https.createServer(tlsOptions, (req, res) => {
  serverHits.push(req.url ?? '')
  if ((req.url ?? '').startsWith('/embed')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(EMBED_PAGE)
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const embedUrl = `https://127.0.0.1:${port}/embed`

const PARENT_DOC = [
  '# 父文档',
  '',
  `外链 [示例站点](https://example.com/page) 与本地 [本地链接](子笔记.md)。`,
  '',
  '普通正文段落，不含其他链接。',
  '',
].join('\n')

const OPEN_WAIT = 700 // 开延迟 300ms + 余量
const CLOSE_WAIT = 800 // 关延迟 350ms + 余量

/** 轮询等待指定 URL 的 frame 注册（本 playwright 版本 Page 无 waitForFrame） */
async function waitForFrameBy(page, urlPrefix) {
  for (let i = 0; i < 100; i++) {
    const hit = page.frames().find((f) => f.url().startsWith(urlPrefix))
    if (hit) {
      return hit
    }
    await page.waitForTimeout(100)
  }
  return undefined
}

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  // 自签 https 受控服务器需要忽略证书错误（仅测试 context）
  const context = await browser.newContext({ viewport: { width: 900, height: 640 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initWebPageDoc(text), PARENT_DOC)
  await page.locator('.cm-content .vsidian-link').first().waitFor()
  await page.evaluate(() => window.applyWebPageSettings({
    'hover.externalEnabled': true, 'hover.externalShape': 'page',
  }))
  const externalDeco = page.locator('.cm-content .vsidian-link').first()

  const hoverRequests = () => page.evaluate(() =>
    window.webPageSent().filter((m) => m.kind === 'hover.request'))
  const lastRequest = async () => (await hoverRequests()).at(-1)
  const respondWeb = (req, web) =>
    page.evaluate(({ reqId, instanceId, web }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: true,
      contentKind: 'web', web,
      target: { fsPath: '', relPath: '' }, version: 0, text: '',
      range: { start: 0, end: 0 }, scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, web })
  const respondFail = (req, reason) =>
    page.evaluate(({ reqId, instanceId, reason }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: false, reason,
    }), { reqId: req.reqId, instanceId: req.instanceId, reason })
  /** 开浮层并注入 web 回包（返回 frame 引用供内容断言） */
  const openWebPopup = async (web) => {
    await readingLink.hover()
    await page.waitForTimeout(OPEN_WAIT)
    const req = await lastRequest()
    assert.ok(req, '悬停发出 hover.request')
    await respondWeb(req, web)
    const frame = await waitForFrameBy(page, embedUrl)
    assert.ok(frame, 'iframe 实际导航到受控样本页')
    await frame.locator('#marker').waitFor({ state: 'visible' })
    return frame
  }
  const closeByMoveAway = async () => {
    await page.mouse.move(20, 600)
    await page.waitForTimeout(CLOSE_WAIT)
  }

  // ---- 场景 1：embeddable 样本 → 沙箱 iframe 真实装载、内容可见 ----
  // 在 Live 模式下以 Ctrl+悬停打开（恶意子页伪造 view.mode.set 的可观测
  // 不变量：守卫生效则父视图保持 Live 编辑器在场）
  await page.keyboard.down('Control')
  await externalDeco.hover()
  await page.keyboard.up('Control')
  await page.waitForTimeout(OPEN_WAIT)
  const req1 = await lastRequest()
  assert.ok(req1, 'page 形态悬停发出 hover.request')
  await respondWeb(req1, {
    url: embedUrl, domain: '127.0.0.1', title: '可嵌入样本页', description: '',
    frame: { embeddable: true },
  })
  // iframe 内容元素可见（跨源 frame 经 CDP 观察——非 load 事件断言）
  const frame = await waitForFrameBy(page, embedUrl)
  assert.ok(frame, 'iframe 实际导航到受控样本页（服务端已收到 GET）')
  await frame.locator('#marker').waitFor({ state: 'visible' })
  const view1 = await page.evaluate(() => window.readWebPage())
  assert.ok(view1, 'page 视图在场')
  assert.equal(view1.sandbox, 'allow-scripts', 'sandbox 仅 allow-scripts（最小能力）')
  assert.equal(view1.referrerPolicy, 'no-referrer', 'referrer 不泄露 webview 来源')
  assert.equal(view1.src, embedUrl, 'iframe src 为宿主归一最终 URL')
  assert.equal(view1.allowAttr, null, '无 allow 特性（付款/摄像头等默认全拒）')
  assert.ok(view1.frameVisible && view1.frameWidth > 300 && view1.frameHeight >= 300,
    `iframe 有实际绘制尺寸（实际 ${view1.frameWidth}x${view1.frameHeight}）`)
  assert.ok(view1.fallbackVisible && view1.fallbackText === zhCn['hover.webFallbackToCard'],
    '退回卡片按钮可见且文案正确')
  assert.ok(view1.noteVisible && view1.noteText === zhCn['hover.webPageNote'],
    '无法确认诚实说明可见且文案正确')
  passed++; console.log('[1] 沙箱 iframe 真实装载与工具行可见 ✓')

  // ---- 场景 2：滚轮在 iframe 上滚动其内容（可滚动的真证据） ----
  const iframeBox = await page.locator('.vsidian-hover-web-frame').boundingBox()
  assert.ok(iframeBox, 'iframe 有包围盒')
  await page.mouse.move(iframeBox.x + iframeBox.width / 2, iframeBox.y + iframeBox.height / 2)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(300)
  const scrolled = await frame.evaluate(() => window.scrollY)
  assert.ok(scrolled > 100, `iframe 内容经真实滚轮滚动（scrollY=${scrolled}）`)
  passed++; console.log('[2] iframe 内容滚轮可滚 ✓')

  // ---- 场景 3：恶意子页 postMessage 注入被丢弃（消息桥隔离） ----
  // 样本页装载即注入伪造 view.mode.set（reading）与 settings.snapshot——
  // 守卫生效则父视图保持 Live 编辑器在场（场景 1 在 Live 模式打开），
  // 且在场 iframe 未被伪造 settings.snapshot 联动销毁
  await page.waitForTimeout(200)
  const dropped = await page.evaluate(() => window.__webPageHostileDropped ?? 0)
  assert.ok(dropped >= 2, `恶意子页消息被丢弃（实际 ${dropped} 条）`)
  assert.equal(await page.evaluate(() => window.liveEditorPresent()), true,
    '父视图保持 Live（伪造 view.mode.set 未被消费）')
  assert.equal(await page.evaluate(() => window.readWebPage() !== null), true,
    'iframe 仍在场（伪造 settings.snapshot 未触发联动销毁）')
  passed++; console.log('[3] 恶意子页消息注入隔离 ✓')

  // ---- 场景 4：关闭浮层 → iframe 随之释放（DOM 出局） ----
  await closeByMoveAway()
  assert.equal((await page.evaluate(() => window.readHoverPopup())).open, false, '移出联合域后浮层关闭')
  assert.equal(await page.evaluate(() => window.readWebPage()), null, '关闭后 iframe 随浮层销毁')
  passed++; console.log('[4] 关闭释放 ✓')

  // ---- 场景 5：切阅读模式重开 → 手动退回零设置写 ----
  await page.evaluate(() => window.setEntryMode('reading'))
  await page.locator('.vsidian-view-reading a[href="https://example.com/page"]').waitFor()
  const readingLink = page.locator('.vsidian-view-reading a[href="https://example.com/page"]')
  const frame5 = await openWebPopup({
    url: embedUrl, domain: '127.0.0.1', title: '可嵌入样本页', description: '',
    frame: { embeddable: true },
  })
  void frame5
  assert.equal(await page.evaluate(() => window.readWebPage() !== null), true,
    '重开 iframe 在场')
  const sentBefore = (await page.evaluate(() => window.webPageSent())).length
  await page.locator('.vsidian-hover-web-fallback').click()
  assert.equal(await page.evaluate(() => window.readWebPage()), null, '手动退回后 iframe 销毁')
  const card5 = await page.evaluate(() => window.readWebFallbackCard())
  assert.ok(card5, '退回卡片呈现')
  assert.equal(card5.title, '可嵌入样本页', '卡片标题为宿主元信息')
  assert.equal(card5.reasonPresent, false, '手动退回不带自动原因行')
  const sentAfter = await page.evaluate(() => window.webPageSent())
  assert.equal(sentAfter.length, sentBefore, '退回零出站消息（含设置写——不偷偷改形态设置）')
  passed++; console.log('[5] 重开在场与手动退回零设置写 ✓')
  await closeByMoveAway()

  // ---- 场景 6：DENY 样本 → 自动退回卡片 + 真实原因 + 打开入口 ----
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req6 = await lastRequest()
  await respondWeb(req6, {
    url: 'https://deny.example.com/page', domain: 'deny.example.com', title: '拒绝内嵌站点', description: '',
    frame: { embeddable: false, reason: 'denied' },
  })
  await page.waitForTimeout(60)
  assert.equal(await page.evaluate(() => window.readWebPage()), null, 'DENY 不挂 iframe')
  const card6 = await page.evaluate(() => window.readWebFallbackCard())
  assert.ok(card6, 'DENY 退回卡片在场')
  assert.equal(card6.reasonText, zhCn['hover.webFrameDenied'], '退回原因为真实文案（denied）')
  assert.ok(card6.reasonVisible, '原因行实际可见（非透明/非隐藏）')
  assert.ok(card6.openEntryPresent, '标题条浏览器打开入口保留')
  passed++; console.log('[6] DENY 自动退回与真实原因 ✓')
  await closeByMoveAway()

  // ---- 场景 7：HTTP 混合内容样本 → 卡片 + 混合内容原因 ----
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req7 = await lastRequest()
  await respondWeb(req7, {
    url: 'http://plain.example.com/page', domain: 'plain.example.com', title: '', description: '',
    frame: { embeddable: false, reason: 'http' },
  })
  await page.waitForTimeout(60)
  const card7 = await page.evaluate(() => window.readWebFallbackCard())
  assert.ok(card7, 'HTTP 样本退回卡片在场')
  assert.equal(card7.reasonText, zhCn['hover.webFrameHttp'], '退回原因为混合内容文案')
  assert.equal(card7.title, 'plain.example.com', 'title 缺席域名兜底')
  assert.ok(card7.openEntryPresent, '打开入口保留')
  passed++; console.log('[7] HTTP 混合内容退回 ✓')
  await closeByMoveAway()

  // ---- 场景 8：超时失败分态（page 形态沿用 #342 错误分态与打开入口） ----
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req8 = await lastRequest()
  await respondFail(req8, 'web-timeout')
  await page.waitForTimeout(60)
  const popup8 = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup8.open, true, '超时失败浮层保持（打开入口不撤）')
  assert.equal(popup8.stateText, zhCn['hover.errorWebTimeout'], '超时真实原因文案')
  passed++; console.log('[8] 超时失败分态与打开入口 ✓')
  await closeByMoveAway()

  // ---- 场景 9：开关动态关闭 → 在场 iframe 销毁、就地退回卡片 ----
  const frame9 = await openWebPopup({
    url: embedUrl, domain: '127.0.0.1', title: '联动销毁样本', description: '',
    frame: { embeddable: true },
  })
  void frame9
  await page.evaluate(() => window.applyWebPageSettings({ 'hover.externalEnabled': false }))
  await page.waitForTimeout(60)
  assert.equal(await page.evaluate(() => window.readWebPage()), null, '开关关闭销毁在场 iframe')
  const card9 = await page.evaluate(() => window.readWebFallbackCard())
  assert.ok(card9, '开关关闭后就地退回卡片')
  passed++; console.log('[9] 开关关闭联动销毁 ✓')

  assert.ok(serverHits.filter((h) => h.startsWith('/embed')).length >= 2,
    '受控服务器真实收到 iframe 导航（跨源装载证据）')
  assert.deepEqual(errors, [], '页面零未捕获异常')
  console.log(`webPageView: ${passed} 场景通过`)
} finally {
  await browser.close()
  server.close()
  server.closeAllConnections()
}
