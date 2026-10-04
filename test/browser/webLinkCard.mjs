// #342（P3-10）外链卡片的原生浏览器回归：真实布局（Chromium）下用真实
// 指针驱动生产控制器——总开关门控（默认关 = 零 hover.request，webview
// 侧零请求路径）、开启后 http(s) 链接的 Reading 悬停与 Live Ctrl+悬停、
// web 载荷卡片的实际文字内容（标题/摘要/域名/链接 href 绘制层断言）、
// title 缺席域名兜底、失败分态真实文案与打开入口、loading 态关闭的
// hover.cancel 出站、域名链接点击的 link.activate 外开通道。
// 宿主回包由脚本注入（fixture.respondHoverResult → handleHostMessage 同
// 入口）；网络边界（超时/超限/私网/重定向/DNS 换址/合并取消/缓存）的
// 受控服务器契约在 test/unit/webLinkMetaService.test.ts 钉住。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'webLinkCard/webLinkCard.js')
await build({ entryPoints: [path.join(root, 'test/browser/webLinkCardFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  '外链 [示例站点](https://example.com/page) 与本地 [本地链接](子笔记.md)。',
  '',
  '普通正文段落，不含其他链接。',
  '',
].join('\n')

const OPEN_WAIT = 700 // 开延迟 300ms + 余量
const CLOSE_WAIT = 800 // 关延迟 350ms + 余量

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initWebLinkDoc(text), PARENT_DOC)
  await page.locator('.cm-content .vsidian-link').first().waitFor()

  const hoverRequests = () => page.evaluate(() =>
    window.webLinkSent().filter((m) => m.kind === 'hover.request'))
  const cancelMessages = () => page.evaluate(() =>
    window.webLinkSent().filter((m) => m.kind === 'hover.cancel'))
  const lastRequest = async () => (await hoverRequests()).at(-1)
  const externalDeco = () => page.locator('.cm-content .vsidian-link').first()
  const respondWeb = (req, meta) =>
    page.evaluate(({ reqId, instanceId, meta }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: true,
      contentKind: 'web', web: meta,
      target: { fsPath: '', relPath: '' }, version: 0, text: '',
      range: { start: 0, end: 0 }, scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, meta })
  const respondFail = (req, reason) =>
    page.evaluate(({ reqId, instanceId, reason }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: false, reason,
    }), { reqId: req.reqId, instanceId: req.instanceId, reason })

  // ---- 场景 1：总开关默认关——悬停外链零请求、无浮层 ----
  await page.locator('.cm-content').hover({ position: { x: 10, y: 10 } })
  await externalDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await hoverRequests()).length, 0, '外链预览关闭态：零 hover.request（webview 侧零请求路径）')
  assert.equal((await page.evaluate(() => window.readHoverPopup())).open, false, '关闭态不开浮层')

  // ---- 场景 2：开启后 Reading 悬停外链 → loading → web 卡片实际文字 ----
  await page.evaluate(() => window.applyWebLinkSettings({ 'hover.externalEnabled': true }))
  await page.evaluate(() => window.setEntryMode('reading'))
  await page.locator('.vsidian-view-reading a[href="https://example.com/page"]').waitFor()
  const readingLink = page.locator('.vsidian-view-reading a[href="https://example.com/page"]')
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req2 = await lastRequest()
  assert.ok(req2, '开启后外链悬停发出 hover.request')
  assert.equal(req2.linkHref, 'https://example.com/page', '请求携带外链 linkHref')
  let popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, true, '浮层打开（loading）')
  assert.ok(popup.stateText.length > 0, 'loading 态文案在场')
  await respondWeb(req2, {
    url: 'https://example.com/page', domain: 'example.com',
    title: '示例站点标题', description: '这是页面摘要文字。',
  })
  await page.waitForTimeout(60)
  const card = await page.evaluate(() => window.readWebCard())
  assert.ok(card, 'web 卡片元素在场（绘制层）')
  assert.equal(card.title, '示例站点标题', '卡片标题实际文字')
  assert.ok(card.titleVisible, '标题可见（display 非 none 且非空）')
  assert.equal(card.desc, '这是页面摘要文字。', '卡片摘要实际文字')
  assert.equal(card.domain, 'example.com', '域名实际文字')
  assert.equal(card.domainHref, 'https://example.com/page', '域名链接指向最终 URL')
  assert.equal(card.linkCount, 1, '卡片内唯一可点元素（显式安全链接）')
  assert.ok(card.cardWidth > 0 && card.cardHeight > 0, '卡片有实际尺寸')
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.stateVisible, false, '内容态状态行隐藏')
  passed++; console.log('[1] 开关门控与卡片实际文字 ✓')

  // ---- 场景 3：域名链接点击 → link.activate 外开通道 + 浮层关闭 ----
  await page.locator('.vsidian-hover-popup .vsidian-hover-web-domain').click()
  const activates = await page.evaluate(() =>
    window.webLinkSent().filter((m) => m.kind === 'link.activate'))
  assert.equal(activates.length, 1, '域名点击发出一次 link.activate')
  assert.equal(activates[0].href, 'https://example.com/page', '激活 href 为最终 URL')
  assert.equal((await page.evaluate(() => window.readHoverPopup())).open, false, '点击后浮层关闭')
  passed++; console.log('[2] 域名链接外开通道 ✓')

  // ---- 场景 4：title 缺席时域名兜底、无摘要时省略节点 ----
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req4 = await lastRequest()
  await respondWeb(req4, { url: 'https://example.com/page', domain: 'example.com', title: '', description: '' })
  await page.waitForTimeout(60)
  const card4 = await page.evaluate(() => window.readWebCard())
  assert.equal(card4.title, 'example.com', 'title 缺席以域名兜底显示')
  assert.equal(card4.descPresent, false, '无摘要时省略摘要节点（不留空行）')
  await page.mouse.move(20, 600)
  await page.waitForTimeout(CLOSE_WAIT)
  passed++; console.log('[3] title 兜底与摘要省略 ✓')

  // ---- 场景 5：失败分态——真实原因文案 + 打开入口保留 ----
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req5 = await lastRequest()
  await respondFail(req5, 'web-timeout')
  await page.waitForTimeout(60)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, true, '失败态浮层保持（打开入口不撤）')
  assert.equal(popup.stateText, zhCn['hover.errorWebTimeout'], '超时失败显示真实原因文案')
  const openBtn = await page.locator('.vsidian-hover-popup .vsidian-hover-popup-open').count()
  assert.equal(openBtn, 1, '标题条打开入口在场（浏览器打开）')
  await page.mouse.move(20, 600)
  await page.waitForTimeout(CLOSE_WAIT)
  passed++; console.log('[4] 失败分态与打开入口 ✓')

  // ---- 场景 6：loading 态关闭浮层 → hover.cancel 出站 ----
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req6 = await lastRequest()
  assert.ok(req6, 'loading 态请求在场（未回包）')
  await page.mouse.move(20, 600) // 移出联合域 → 延迟关闭
  await page.waitForTimeout(CLOSE_WAIT)
  const cancels = await cancelMessages()
  assert.equal(cancels.length, 1, 'loading 态关闭发出一次 hover.cancel')
  assert.equal(cancels[0].reqId, req6.reqId, '取消与在途请求配对（reqId）')
  assert.equal(cancels[0].instanceId, req6.instanceId, '取消与在途请求配对（instanceId）')
  passed++; console.log('[5] loading 态关闭取消出站 ✓')

  // ---- 场景 7：Live Ctrl+悬停外链（修饰键门控沿用） ----
  await page.evaluate(() => window.setEntryMode('live'))
  await page.locator('.cm-content .vsidian-link').first().waitFor()
  const beforeCount = (await hoverRequests()).length
  await externalDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await hoverRequests()).length, beforeCount, 'Live 无修饰键不触发（Ctrl+悬停门控保持）')
  await page.keyboard.down('Control')
  await externalDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  const req7 = await lastRequest()
  assert.equal(req7?.linkHref, 'https://example.com/page', 'Ctrl+悬停外链发出请求（Live 放行）')
  await respondWeb(req7, {
    url: 'https://example.com/page', domain: 'example.com', title: 'Live 悬停标题', description: '',
  })
  await page.waitForTimeout(60)
  const card7 = await page.evaluate(() => window.readWebCard())
  assert.equal(card7?.title, 'Live 悬停标题', 'Live 路径卡片实际文字')
  await page.keyboard.up('Control')
  await page.mouse.move(20, 600)
  await page.waitForTimeout(CLOSE_WAIT)
  passed++; console.log('[6] Live Ctrl+悬停外链 ✓')

  // ---- 场景 8：开关动态关闭——在场关闭后新悬停零请求 ----
  await page.evaluate(() => window.applyWebLinkSettings({ 'hover.externalEnabled': false }))
  await page.evaluate(() => window.setEntryMode('reading'))
  const before8 = (await hoverRequests()).length
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await hoverRequests()).length, before8, '运行期关闭后悬停零新请求')
  assert.equal((await page.evaluate(() => window.readHoverPopup())).open, false, '运行期关闭不开浮层')
  passed++; console.log('[7] 运行期开关关闭 ✓')

  assert.deepEqual(errors, [], '页面零未捕获异常')
  console.log(`webLinkCard: ${passed} 场景通过`)
} finally {
  await browser.close()
}
