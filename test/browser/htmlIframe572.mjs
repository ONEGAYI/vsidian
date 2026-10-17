// #572（T07）iframe 子文档装载隔离与源码显形的原生浏览器回归（真实
// Chromium 布局 + 生产控制器 + 伪造资源宿主 + 本机受控 https 服务器）：
// - sandbox 系统强制面：https 远端帧仅 allow-scripts；srcdoc/本地/未知
//   形态零 token（作者值被覆盖——矩阵装配断言）
// - srcdoc 帧内容真实可见（CDP 帧读取，非 load 事件）；帧内脚本零执行
//   （sandbox 结构性禁脚本）；帧内样式生效（帧文档作用域）
// - 本地可控页面（相对 src 经资源归属改写）真实装载可见；父 docStyle
//   不入帧（b2 标记隔离——帧内同选择器不着色）而父域对照命中
// - https 帧脚本运行（allow-scripts）且父窗口访问被结构性拒绝
//   （SecurityError 报告写入帧自身 DOM）、顶层导航不发生
// - 站点拒绝嵌入（X-Frame-Options: DENY）：请求真实到达服务器、帧内容
//   不可见——空白帧是真实状态，不编造原因
// - 无效地址：解析失败保持原文（不编造地址）
// - Live 外层命中机制：单击帧可视区（shield 覆盖）→ 选中该片段完整源码
//   （正确片段：命中哪个块选哪个块）
// - Reading 原生交互：帧内按钮真实可点、零父文档写回、无 shield
// - 生命周期：触及显形撤 widget、离开恢复；换文档后无残留帧
import assert from 'node:assert/strict'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'htmlIframe572/htmlIframe572.js')
await build({ entryPoints: [path.join(root, 'test/browser/htmlIframe572Fixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

// ---- 受控 https 服务器（自签证书，仓库 test/fixtures——webPageView 同款） ----
// 可交互样本页：可见标记 + 按钮（Reading 原生交互证据）+ 脚本运行标记
// （allow-scripts 证据）+ 父窗口访问探针（隔离负向——结果写帧自身 DOM
// 经 CDP 读回）+ 顶层导航尝试（主 URL 不变是断言，报告只证尝试发生）
const EMBED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>可嵌入样本页</title></head>
<body style="margin:0;font-family:sans-serif">
<div id="marker" style="padding:8px">受控样本页顶部标记</div>
<button id="btn" type="button">计数</button>
<span id="count">0</span>
<div id="script-ran"></div>
<div id="parent-report"></div>
<div id="topnav-report"></div>
<script>
  document.getElementById('script-ran').textContent = 'ran'
  document.getElementById('btn').addEventListener('click', () => {
    const el = document.getElementById('count')
    el.textContent = String(Number(el.textContent) + 1)
  })
  try {
    void window.parent.document
    document.getElementById('parent-report').textContent = 'parent-reachable'
  } catch (e) {
    document.getElementById('parent-report').textContent = 'parent-blocked:' + e.name
  }
  document.getElementById('topnav-report').textContent = 'attempting'
  try { window.top.location = String(window.top.location) } catch (e) { /* 拒绝即证据 */ }
</script>
</body></html>`
// 站点拒绝嵌入样本（X-Frame-Options: DENY——浏览器层拒绝渲染）
const DENY_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>拒绝嵌入</title></head><body><div id="marker">拒绝嵌入页标记（不应可见）</div></body></html>'
// 本地可控页面样本（相对 src 解析目标：可见标记 + 父 docStyle 隔离探针）
const LOCAL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>本地页</title></head>
<body style="margin:0;font-family:sans-serif"><div id="local-marker" style="padding:8px">本地页面顶部标记</div>
<p class="iso-probe" id="frame-probe">帧内对照</p></body></html>`

const serverHits = []
const fixturesDir = path.join(root, 'test', 'fixtures')
const server = https.createServer({
  key: readFileSync(path.join(fixturesDir, 'webframe-test-key.pem')),
  cert: readFileSync(path.join(fixturesDir, 'webframe-test-cert.pem')),
}, (req, res) => {
  const url = req.url ?? ''
  serverHits.push(url)
  if (url.startsWith('/embed')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(EMBED_PAGE)
  } else if (url.startsWith('/deny')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' })
    res.end(DENY_PAGE)
  } else if (url.startsWith('/local-page')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(LOCAL_PAGE)
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const embedUrl = `https://127.0.0.1:${port}/embed`
const denyUrl = `https://127.0.0.1:${port}/deny`
const localUrl = `https://127.0.0.1:${port}/local-page`

// 文档：块级 iframe 群（本地/远端/拒绝/无效）+ 独立 srcdoc 块 + 行内
// iframe + 文档样式隔离探针（.iso-probe 父域命中/帧内不命中）
const DIV_BLOCK = [
  '<div>',
  `  <iframe id="f-local" src="page.html" height="110" title="本地页"></iframe>`,
  `  <iframe id="f-https" src="${embedUrl}" height="110" title="远端页"></iframe>`,
  `  <iframe id="f-deny" src="${denyUrl}" height="110" title="拒绝页"></iframe>`,
  '  <iframe id="f-missing" src="missing.html" height="110"></iframe>',
  '</div>',
].join('\n')
const SRCDOC_BLOCK = `<iframe id="f-srcdoc" srcdoc="<p id='in'>内嵌标记</p><script>document.getElementById('in').classList.add('ran')</script><style>#in{color:red}</style>" height="60"></iframe>`
const DOC = [
  '开篇段落。',
  '',
  DIV_BLOCK,
  '',
  SRCDOC_BLOCK,
  '',
  `行内 <iframe id="f-inline" src="page.html" height="60"></iframe> 混排。`,
  '',
  '<style>',
  '.iso-probe { color: rgb(0, 0, 255); }',
  '</style>',
  '',
  '<p class="iso-probe" id="parent-probe">父域对照</p>',
  '',
  '尾段。',
].join('\n')

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  // 自签 https 受控服务器需要忽略证书错误（仅测试 context）
  const context = await browser.newContext({ viewport: { width: 900, height: 1200 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let navigated = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigated += 1
    }
  })
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  const settle = (ms = 350) => page.waitForTimeout(ms)
  const framesProbe = () => page.evaluate(() => window.readIframeFrames())
  const mainUrl = () => page.evaluate(() => window.location.href)

  // 活跃容器内指定 id iframe 的内容帧（elementHandle.contentFrame 精确
  // 到该 DOM 副本——双容器同 id 副本不串）
  const frameOf = async (selector) => {
    const handle = await page.locator(selector).first().elementHandle()
    const frame = await handle?.contentFrame()
    assert.ok(frame, `iframe ${selector} 应有内容帧`)
    return frame
  }

  // ---- 场景 1：Live 装配面（sandbox 系统强制 + src 归属改写 + shield） ----
  await page.evaluate(([text, local]) => window.initIframeDoc(text, { 'page.html': local }), [DOC, localUrl])
  await settle(600)
  const probe1 = await framesProbe()
  assert.equal(probe1.frames.length, 6, `六帧在场（块级 4 + srcdoc 1 + 行内 1；实际 ${JSON.stringify(probe1)}）`)
  // DOM 顺序 = 文档顺序：f-local/f-https/f-deny/f-missing（div 块内）→
  // f-srcdoc（独立块）→ f-inline（行内）
  const [fLocal, fHttps, fDeny, fMissing, fSrcdoc, fInline] = probe1.frames
  assert.equal(fHttps.sandbox, 'allow-scripts', 'https 远端帧 sandbox 仅 allow-scripts')
  assert.equal(fDeny.sandbox, 'allow-scripts', 'https 拒绝页帧同为 allow-scripts（拒绝嵌入与 sandbox 面正交）')
  assert.equal(fLocal.sandbox, '', '本地页帧 sandbox 零 token（笔记可控内容禁脚本）')
  assert.equal(fMissing.sandbox, '', '无效地址帧 sandbox 零 token')
  assert.equal(fSrcdoc.sandbox, '', 'srcdoc 帧 sandbox 零 token')
  assert.equal(fInline.sandbox, '', '行内本地帧 sandbox 零 token')
  assert.equal(fLocal.src, localUrl, `本地相对 src 已改写为解析地址（实际 ${fLocal.src}）`)
  assert.equal(fInline.src, localUrl, '行内相对 src 同款改写')
  assert.equal(fHttps.src, embedUrl, 'https 直连不改写')
  assert.equal(fMissing.src, 'missing.html', '解析失败保持原文（不编造地址）')
  assert.ok(fSrcdoc.srcdoc, 'srcdoc 帧携带内容属性')
  assert.ok(probe1.frames.every((f) => f.shield), 'Live 帧全部被 shield 覆盖（外层命中机制）')
  assert.equal(probe1.shields, 6, 'shield 计数与帧一致')
  const log1 = await page.evaluate(() => window.iframeResourceLog())
  assert.ok(log1.includes('page.html') && log1.includes('missing.html'),
    `iframe src 经资源归属通道解析（实际 ${JSON.stringify(log1)}）`)
  passed++
  console.log('[HTML iframe][PASS] 1 Live 装配面：sandbox 矩阵 + src 归属改写 + shield 全覆盖')

  // ---- 场景 2：srcdoc 内容真实可见 + 帧内脚本零执行 + 帧样式生效 ----
  const srcdocFrame = await frameOf('.cm-content iframe#f-srcdoc')
  await srcdocFrame.locator('#in').waitFor({ state: 'visible' })
  const inText = await srcdocFrame.locator('#in').textContent()
  assert.equal(inText, '内嵌标记', 'srcdoc 帧内容真实可见（CDP 帧读取，非 load 事件）')
  const inClass = await srcdocFrame.locator('#in').getAttribute('class')
  assert.equal(inClass, null, 'srcdoc 内脚本零执行（sandbox 结构性禁脚本——ran 类未加）')
  const inColor = await srcdocFrame.locator('#in').evaluate((el) => getComputedStyle(el).color)
  assert.equal(inColor, 'rgb(255, 0, 0)', `帧内样式生效（帧文档作用域；实际 ${inColor}）`)
  passed++
  console.log('[HTML iframe][PASS] 2 srcdoc：内容可见 + 脚本零执行 + 帧内样式生效')

  // ---- 场景 3：本地可控页面装载可见 + 父 docStyle 不入帧 ----
  const localFrame = await frameOf('.cm-content iframe#f-local')
  await localFrame.locator('#local-marker').waitFor({ state: 'visible' })
  assert.equal(await localFrame.locator('#local-marker').textContent(), '本地页面顶部标记')
  const frameProbeColor = await localFrame.locator('#frame-probe').evaluate((el) => getComputedStyle(el).color)
  assert.notEqual(frameProbeColor, 'rgb(0, 0, 255)',
    `父 docStyle 不入帧（帧内 .iso-probe 不着蓝；实际 ${frameProbeColor}）`)
  const parentProbeColor = await page.locator('.cm-content #parent-probe').evaluate((el) => getComputedStyle(el).color)
  assert.equal(parentProbeColor, 'rgb(0, 0, 255)',
    `父域对照命中（docStyle 装载在场的方向证据；实际 ${parentProbeColor}）`)
  passed++
  console.log('[HTML iframe][PASS] 3 本地页装载可见 + 父 docStyle 不入帧（隔离两侧证据）')

  // ---- 场景 4：https 帧脚本运行 + 父窗口访问拒绝 + 顶层导航不发生 ----
  const httpsFrame = await frameOf('.cm-content iframe#f-https')
  await httpsFrame.locator('#marker').waitFor({ state: 'visible' })
  assert.equal(await httpsFrame.locator('#script-ran').textContent(), 'ran', '帧内脚本运行（allow-scripts——站点渲染最小能力）')
  const parentReport = await httpsFrame.locator('#parent-report').textContent()
  assert.ok(parentReport.startsWith('parent-blocked:'),
    `子文档不可达父窗口（跨源访问结构性拒绝；实际 ${parentReport}）`)
  assert.equal(await httpsFrame.locator('#topnav-report').textContent(), 'attempting', '顶层导航尝试已发生')
  const urlBefore = await mainUrl()
  await settle(300)
  assert.equal(await mainUrl(), urlBefore, '顶层导航未发生（无 allow-top-navigation）')
  assert.equal(navigated, 0, '主帧零导航（不意外跳转）')
  passed++
  console.log('[HTML iframe][PASS] 4 https 帧：脚本运行 + 父窗口不可达 + 顶层导航拒绝')

  // ---- 场景 5：站点明确拒绝嵌入（XFO DENY——真实状态呈现） ----
  const denyFrame = await frameOf('.cm-content iframe#f-deny')
  await settle(500)
  assert.ok(serverHits.some((u) => u.startsWith('/deny')),
    `拒绝页请求真实到达服务器（拒绝嵌入的真实证据；实际 ${JSON.stringify(serverHits)}）`)
  const denyMarker = await denyFrame.locator('#marker').waitFor({ state: 'visible', timeout: 1200 }).then(
    () => true, () => false)
  assert.equal(denyMarker, false, 'XFO 拒绝帧内容不可见（空白帧 = 真实状态，不编造原因）')
  passed++
  console.log('[HTML iframe][PASS] 5 拒绝嵌入：请求到达 + 内容不可见（真实状态，不伪装成功）')

  // ---- 场景 6：Live 单击帧可视区 → 选中正确片段完整源码（外层命中） ----
  const divFrom = DOC.indexOf('<div>')
  const divTo = divFrom + DIV_BLOCK.length
  const srcdocFrom = DOC.indexOf('<iframe id="f-srcdoc"')
  const srcdocTo = srcdocFrom + SRCDOC_BLOCK.length
  const httpsBox = await page.locator('.cm-content iframe#f-https').boundingBox()
  assert.ok(httpsBox, 'https 帧有可视盒')
  await page.mouse.click(httpsBox.x + httpsBox.width / 2, httpsBox.y + 12)
  let sel = await page.evaluate(() => window.iframeSelection())
  assert.equal(sel.length, 1, `单选区（实际 ${JSON.stringify(sel)}）`)
  assert.equal(sel[0].anchor, divFrom, `点击帧区选中所在块完整源码 from（实际 ${sel[0].anchor} 期望 ${divFrom}）`)
  assert.equal(sel[0].head, divTo, `选中至块尾 to（实际 ${sel[0].head} 期望 ${divTo}）`)
  // 显隐生命周期：触及显形撤 widget（div 块四帧离场）
  let probe6 = await framesProbe()
  assert.equal(probe6.frames.length, 2, `触及显形撤 widget——div 块四帧离场（实际 ${probe6.frames.length}）`)
  // 点击 srcdoc 帧（另一片段）→ 选区切到该块（正确片段，不扩到整篇）
  const srcdocBox = await page.locator('.cm-content iframe#f-srcdoc').boundingBox()
  assert.ok(srcdocBox, 'srcdoc 帧有可视盒')
  await page.mouse.click(srcdocBox.x + srcdocBox.width / 2, srcdocBox.y + 8)
  sel = await page.evaluate(() => window.iframeSelection())
  assert.equal(sel[0].anchor, srcdocFrom, '第二片段命中不扩到前一/后块（srcdoc 块起点）')
  assert.equal(sel[0].head, srcdocTo, 'srcdoc 块终点')
  // 离开 → 恢复渲染（widget 回场）
  await page.locator('.cm-content .cm-line').first().click()
  await settle(250)
  probe6 = await framesProbe()
  assert.equal(probe6.frames.length, 6, `完全离开恢复渲染（六帧回场；实际 ${probe6.frames.length}）`)
  assert.equal(await mainUrl(), urlBefore, '点击全程主帧零导航')
  passed++
  console.log('[HTML iframe][PASS] 6 Live 外层命中：单击帧区选完整源码（正确片段）+ 显隐生命周期')

  // ---- 场景 7：Reading 原生交互 + 无 shield + 零父文档写回 ----
  await page.evaluate(() => window.setIframeMode('reading'))
  await settle(500)
  const probe7 = await framesProbe()
  assert.equal(probe7.frames.length, 6, 'Reading 六帧在场（原生呈现）')
  assert.equal(probe7.shields, 0, 'Reading 无 shield（原生交互不接管）')
  const readHttps = await frameOf('.vsidian-view-reading iframe#f-https')
  await readHttps.locator('#btn').click()
  await readHttps.locator('#btn').click()
  assert.equal(await readHttps.locator('#count').textContent(), '2', 'Reading 帧内按钮真实可点（原生交互）')
  const editRequests = await page.evaluate(() => window.iframeSent().filter((m) => m.kind === 'edit.request').length)
  assert.equal(editRequests, 0, 'Reading 原生交互零父文档写回')
  // Reading 侧 sandbox 面不随模式变化
  assert.equal(probe7.frames[0].sandbox, '', 'Reading 本地帧 sandbox 保持零 token')
  passed++
  console.log('[HTML iframe][PASS] 7 Reading：原生交互可点 + 无 shield + 零写回')

  // ---- 场景 8：换文档释放——无残留帧 ----
  await page.evaluate(() => window.initIframeDoc('# 新文档\n\n普通正文，无 iframe。\n'))
  await settle(600)
  const probe8 = await framesProbe()
  assert.equal(probe8.frames.length, 0, `换文档后活跃域零 iframe（实际 ${probe8.frames.length}）`)
  const stale = page.frames().filter((f) => f.url().startsWith(`https://127.0.0.1:${port}`))
  assert.equal(stale.length, 0, `旧帧全部卸载（Playwright 帧表无残留；实际 ${stale.map((f) => f.url())}）`)
  passed++
  console.log('[HTML iframe][PASS] 8 换文档释放：零残留帧')

  // 观测证据：内容可见性截图（人工验收口径的自动化留档）
  await page.evaluate(([text, local]) => window.initIframeDoc(text, { 'page.html': local }), [DOC, localUrl])
  await page.evaluate(() => window.setIframeMode('reading'))
  await settle(800)
  await page.screenshot({ path: path.join(root, 'out', 'test', 'htmlIframe572-reading.png'), fullPage: false })
  await page.evaluate(() => window.setIframeMode('live'))
  await settle(500)
  await page.screenshot({ path: path.join(root, 'out', 'test', 'htmlIframe572-live.png'), fullPage: false })

  assert.equal(errors.length, 0, `页面零未捕获异常（实际 ${JSON.stringify(errors)}）`)
} finally {
  await browser.close()
  server.close()
}
console.log(`[HTML iframe] 全部 ${passed} 个场景通过`)
