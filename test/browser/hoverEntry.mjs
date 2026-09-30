// #221 全入口悬停的原生浏览器回归：真实布局（Chromium）下用真实指针与
// 键盘驱动生产控制器——Live 正文 Ctrl+悬停与直接悬停设置切换（开闭时序、
// 请求载荷、零抢焦点、外部链接预滤）、反链/出链面板直接悬停（直接目标
// 载荷、断链失效占位、面板重渲染释放、单例）、键盘命令「预览当前链接」
// （ui.command 与真实按键两入口、焦点进入浮层、Esc 返还触发处、无目标
// 与嵌入不误开、键盘模态鼠标离开/父容器滚动保活）、Ctrl+点击跳转回归。
// 宿主回包由脚本注入（fixture.respondHoverResult → handleHostMessage 同
// 入口）；hoverPreview.mjs 同装配模式。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'hoverEntry/hoverEntry.js')
await build({ entryPoints: [path.join(root, 'test/browser/hoverEntryFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  '指向 [[目标笔记]] 的双链。',
  '',
  '普通链接 [本地链接](目标笔记.md) 与 [外部链接](https://example.com/x)。',
  '',
  '嵌入行：',
  '',
  '![[目标笔记]]',
  '',
  '普通正文段落，不含任何链接形态。',
  '',
].join('\n')

const TARGET_DOC = [
  '# 目标笔记全文标题',
  '',
  '目标正文段一。',
  '',
  '- 列表项 ^blk1',
  '',
].join('\n')

const SOURCE_DOC = ['# 来源笔记全文', '', '来源正文段（反链悬停的全文目标）。', ''].join('\n')

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
  await page.evaluate((text) => window.initHoverEntryDoc(text), PARENT_DOC)
  await page.locator('.cm-content .vsidian-wikilink').first().waitFor()

  const hoverRequests = () => page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'hover.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'edit.request').length)
  const lastRequest = async () => (await hoverRequests()).at(-1)
  const wikilinkDeco = () => page.locator('.cm-content .vsidian-wikilink').first()
  const mdLinkDeco = () => page.locator('.cm-content .vsidian-link').first()
  const respondOk = (req, text, scope = { kind: 'full' }, range = null) =>
    page.evaluate(({ reqId, instanceId, text, scope, range }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
      version: 3, text, range: range ?? { start: 0, end: text.length }, scope,
    }), { reqId: req.reqId, instanceId: req.instanceId, text, scope, range })
  const respondFail = (req, reason, anchor) =>
    page.evaluate(({ reqId, instanceId, reason, anchor }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: false, reason,
      ...(anchor !== undefined ? { anchor } : {}),
    }), { reqId: req.reqId, instanceId: req.instanceId, reason, anchor })
  const escClose = async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(60)
  }

  // ---- 场景 A：Live Ctrl+悬停开浮层（真实 Ctrl 按住 + 真实指针）----
  const focusBefore = await page.evaluate(() => window.readActiveElement())
  await page.keyboard.down('Control')
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  let popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, 'Ctrl+悬停后浮层应打开')
  assert.equal(popup.stateVisible, true, '打开即呈就地 loading 状态行')
  assert.equal(popup.stateText, zhCn['hover.loading'], 'loading 文案与语言包同源')
  let req = await lastRequest()
  assert.equal(req.target, '目标笔记', 'Live 双链 target 为 `|` 前原文')
  assert.ok(req.sourceStart >= 0 && req.sourceEnd > req.sourceStart,
    `源区间为文档内链接区间（实际 ${req.sourceStart}..${req.sourceEnd}）`)
  assert.equal(req.linkHref, undefined, '双链形态不带 linkHref')
  assert.equal(req.directTarget, undefined, '正文入口不走面板直接目标')
  assert.equal(popup.focusInside, false, '鼠标路径零抢焦点（焦点不进浮层）')
  assert.equal(await page.evaluate(() => window.readActiveElement()), focusBefore,
    'Ctrl+悬停不得改变 activeElement')
  // 成功回包 → 绘制层可见
  await respondOk(req, TARGET_DOC)
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.hitInside, '回包后浮层内容绘制层可见（中心命中在浮层内）')
  assert.ok(popup.text.includes('目标笔记全文标题'), '浮层内容为目标文档正文')
  await page.keyboard.up('Control')
  passed++
  console.log('[全入口][PASS] Live Ctrl+悬停：开浮层 + 双链载荷 + 零抢焦点 + 内容绘制')

  // ---- 场景 B：指针离开联合域 → 延迟关闭 ----
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '离开联合域后延迟关闭')
  passed++
  console.log('[全入口][PASS] Live 悬停离开：延迟关闭')

  // ---- 场景 C：默认设置下无 Ctrl 直接悬停不开（Ctrl 必须）----
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '默认（hover.liveDirect=false）无修饰键悬停不开浮层')
  await page.mouse.move(60, 500)
  passed++
  console.log('[全入口][PASS] 默认设置：Live 直接悬停不触发（Ctrl 必须）')

  // ---- 场景 D：设置切换——开启直接悬停后无需 Ctrl；关闭后恢复 ----
  await page.evaluate(() => window.applyEntrySettings({ 'hover.liveDirect': true }))
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '开启 hover.liveDirect 后直接悬停即开（变更即时生效）')
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  await page.evaluate(() => window.applyEntrySettings({ 'hover.liveDirect': false }))
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '关闭设置后恢复 Ctrl 必须')
  await page.mouse.move(60, 500)
  passed++
  console.log('[全入口][PASS] 直接悬停设置：开启即时生效、关闭恢复 Ctrl 必须')

  // ---- 场景 E：普通链接 Ctrl+悬停（linkHref 载荷）与外部链接预滤 ----
  await page.keyboard.down('Control')
  await mdLinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  assert.equal(req.linkHref, '目标笔记.md', '普通链接形态附 linkHref 原文')
  assert.equal(req.target, '目标笔记.md', 'target 同 href（错误分态取材）')
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  const reqCountBefore = (await hoverRequests()).length
  await page.locator('.cm-content', { hasText: '外部链接' })
    .getByText('外部链接').hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await hoverRequests()).length, reqCountBefore,
    '外部链接（https scheme）Ctrl+悬停不预览（预滤）')
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '外部链接不开浮层')
  await page.keyboard.up('Control')
  await page.mouse.move(60, 500)
  passed++
  console.log('[全入口][PASS] Live 普通链接：linkHref 载荷 + 外部链接预滤')

  // ---- 场景 F：反链面板直接悬停（正文 Live 模式下）+ 重渲染释放 + 单例 ----
  await page.locator('.vsidian-sidebar-toggle').click()
  await page.locator('.vsidian-backlinks-toggle').click()
  await page.waitForTimeout(80)
  await page.evaluate(() => window.injectBacklinks([
    {
      sourceRelPath: '来源笔记.md',
      sourceFsPath: 'D:\\notes\\来源笔记.md',
      kind: 'wikilink',
      anchor: '',
      start: 24,
      end: 36,
      line: 3,
      snippet: '指向 [[目标笔记]] 的引用行',
    },
    {
      sourceRelPath: '第二来源.md',
      sourceFsPath: 'D:\\notes\\第二来源.md',
      kind: 'mdlink',
      anchor: '',
      start: 80,
      end: 96,
      line: 5,
      snippet: '[目标笔记](目标笔记.md) 引用行',
    },
  ]))
  await page.waitForTimeout(80)
  const backlinkItems = page.locator('.vsidian-backlink-item')
  await backlinkItems.first().waitFor()
  await backlinkItems.first().hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '反链面板条目直接悬停开浮层（正文 Live 模式下仍直接悬停）')
  req = await lastRequest()
  assert.equal(req.directTarget?.fsPath, 'D:\\notes\\来源笔记.md', '面板直接目标载荷 fsPath')
  assert.equal(req.directTarget?.anchor, undefined, '反链条目无锚点（全文呈现来源文档）')
  assert.equal(req.target, '来源笔记.md', 'target 为条目显示名（错误分态取材）')
  // 单例：换悬停第二条目 → 先关旧再开新（一个浮层）
  await backlinkItems.nth(1).hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  assert.equal(req.directTarget?.fsPath, 'D:\\notes\\第二来源.md', '换条目即换目标（单例浮层）')
  const popupCount = await page.evaluate(() =>
    document.querySelectorAll('.vsidian-hover-popup').length)
  assert.equal(popupCount, 1, '一次只显示一个浮层')
  // 面板快照重渲染（条目 DOM 重建）→ 锚点域释放
  await page.evaluate(() => window.injectBacklinks([
    {
      sourceRelPath: '来源笔记.md',
      sourceFsPath: 'D:\\notes\\来源笔记.md',
      kind: 'wikilink',
      anchor: '',
      start: 24,
      end: 36,
      line: 3,
      snippet: '指向 [[目标笔记]] 的引用行（更新后）',
    },
  ]))
  await page.waitForTimeout(80)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '面板重渲染（条目 DOM 重建）释放在场浮层')
  passed++
  console.log('[全入口][PASS] 反链面板：直接悬停 + 直接目标载荷 + 单例 + 重渲染释放')

  // ---- 场景 G：出链面板悬停（锚点载荷 + 断链失效占位）----
  await page.locator('.vsidian-outlinks-toggle').click()
  await page.waitForTimeout(80)
  await page.evaluate(() => window.injectOutlinks([
    {
      targetDisplay: '目标笔记',
      targetRelPath: '目标笔记.md',
      targetFsPath: 'D:\\notes\\目标笔记.md',
      kind: 'wikilink',
      anchor: '^blk1',
      resolved: true,
      start: 24,
      end: 36,
    },
    {
      targetDisplay: '不存在的笔记',
      targetRelPath: null,
      targetFsPath: null,
      kind: 'wikilink',
      anchor: '',
      resolved: false,
      start: 48,
      end: 60,
    },
  ]))
  await page.waitForTimeout(80)
  const outlinkItems = page.locator('.vsidian-outlink-item')
  await outlinkItems.first().waitFor()
  await outlinkItems.first().hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  assert.equal(req.directTarget?.fsPath, 'D:\\notes\\目标笔记.md', '出链条目 fsPath 载荷')
  assert.equal(req.directTarget?.anchor, '^blk1', '出链条目锚点载荷（^ 前缀块 id）')
  assert.ok(req.sourceStart >= 0 && req.sourceEnd > req.sourceStart, '出链标记区间为当前文档内区间')
  await respondOk(req, TARGET_DOC, { kind: 'block', anchor: '^blk1' },
    { start: TARGET_DOC.indexOf('- 列表项'), end: TARGET_DOC.length - 1 })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.text.includes('列表项'), '锚点范围回包内容渲染')
  // 断链条目悬停：空串 fsPath 入队 + not-found 分态显示条目名
  await outlinkItems.nth(1).hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  assert.equal(req.directTarget?.fsPath, '', '断链条目空串 fsPath 入队（仍可悬停显示占位）')
  await respondFail(req, 'not-found')
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.stateVisible, '断链条目呈就地错误态')
  assert.ok(popup.stateText.includes('不存在的笔记'), '错误文案含条目显示名（spec.target 取材）')
  await escClose()
  passed++
  console.log('[全入口][PASS] 出链面板：锚点载荷 + 断链条目失效占位')

  // ---- 场景 H：键盘命令（ui.command 路径）——Live 光标处 + 焦点往返 ----
  const wlFrom = PARENT_DOC.indexOf('[[目标笔记]]')
  await page.locator('.cm-content').click({ position: { x: 40, y: 30 } })
  const editorFocus = await page.evaluate(() => window.readActiveElement())
  await page.evaluate((pos) => window.setLiveCursor(pos), wlFrom + 2)
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '光标处有合法双链时命令打开浮层')
  assert.equal(popup.focusIsContainer, true, '键盘打开：焦点进入浮层容器')
  req = await lastRequest()
  assert.equal(req.target, '目标笔记', '键盘路径目标判定与悬停同口径')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, 'Esc 关闭键盘打开的浮层')
  const focusAfterEsc = await page.evaluate(() => window.readActiveElement())
  assert.equal(focusAfterEsc, editorFocus, `Esc 后焦点返还触发处（编辑器：${editorFocus}）`)
  passed++
  console.log('[全入口][PASS] 键盘命令（ui.command）：光标处打开 + 焦点进入浮层 + Esc 返还编辑器')

  // ---- 场景 I：键盘命令（真实按键路径，经 keybindings.snapshot 绑定）----
  await page.evaluate(() => window.applyEntryKeybindings({ hoverPreviewLink: ['ctrl+alt+p'] }))
  await page.evaluate((pos) => window.setLiveCursor(pos), wlFrom + 2)
  await page.keyboard.press('Control+Alt+P')
  await page.waitForTimeout(80)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '用户绑定键位真实按键打开浮层（keybindingRouter 本地分支）')
  await escClose()
  passed++
  console.log('[全入口][PASS] 键盘命令（真实按键）：绑定键位经路由本地分支打开')

  // ---- 场景 J：无目标不误开（普通文本光标 + 嵌入区间光标）----
  await page.evaluate((pos) => window.setLiveCursor(pos), PARENT_DOC.indexOf('普通正文段落'))
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '光标在普通文本上命令不误开')
  const embedFrom = PARENT_DOC.indexOf('![[目标笔记]]')
  await page.evaluate((pos) => window.setLiveCursor(pos), embedFrom + 3)
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '光标在嵌入 ![[…]] 区间命令不弹窗（已有常驻内容语义，判定族守卫）')
  passed++
  console.log('[全入口][PASS] 无目标不误开：普通文本与嵌入区间均静默')

  // ---- 场景 K：键盘模态保活——焦点在内不因鼠标离开/父容器滚动销毁 ----
  await page.evaluate((pos) => window.setLiveCursor(pos), wlFrom + 2)
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open && popup.focusInside, '键盘打开且焦点在浮层内（保活前提）')
  // 真实指针移入锚点再离开（mouseover/mouseout 经入口委托转发 leave）
  const wlBox = await wikilinkDeco().boundingBox()
  await page.mouse.move(wlBox.x + wlBox.width / 2, wlBox.y + wlBox.height / 2)
  await page.waitForTimeout(60)
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '键盘模态：焦点在浮层内时鼠标离开不销毁现场')
  // 父容器滚动（Tab 遍历引发的程序性滚动同通道）同样保活
  assert.equal(await page.evaluate(() => window.dispatchEditorScroll()), true, '滚动事件派发成功')
  await page.waitForTimeout(80)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '键盘模态：父容器滚动不销毁现场')
  // 焦点移出浮层后恢复常规鼠标关闭语义
  assert.equal(await page.evaluate(() => window.focusSidebarToggle()), true, '焦点移出成功')
  await page.mouse.move(wlBox.x + wlBox.width / 2, wlBox.y + wlBox.height / 2)
  await page.waitForTimeout(60)
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '焦点离场后恢复常规延迟关闭')
  passed++
  console.log('[全入口][PASS] 键盘模态保活：鼠标离开与父容器滚动不销毁、焦点离场恢复')

  // ---- 场景 L：Reading 键盘聚焦链接为目标（ui.command 路径）----
  await page.evaluate(() => window.setEntryMode('reading'))
  await page.locator('.vsidian-view-reading a.vsidian-wikilink').first().waitFor()
  await page.evaluate(() => {
    const a = document.querySelector('.vsidian-view-reading a.vsidian-wikilink')
    a?.focus()
  })
  const readingFocus = await page.evaluate(() => window.readActiveElement())
  assert.notEqual(readingFocus, 'body', '阅读链接已键盘聚焦')
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, 'Reading 键盘聚焦链接为目标打开浮层')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, 'Esc 关闭')
  assert.equal(await page.evaluate(() => window.readActiveElement()), readingFocus,
    'Esc 后焦点返还触发链接')
  await page.evaluate(() => window.setEntryMode('live'))
  passed++
  console.log('[全入口][PASS] Reading 键盘命令：聚焦链接为目标 + Esc 返还')

  // ---- 场景 M：Ctrl+点击跳转回归（Live 双链与普通链接，既有行为不回归）----
  const activatesBefore = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate').length)
  await page.keyboard.down('Control')
  await wikilinkDeco().click()
  await page.waitForTimeout(80)
  await mdLinkDeco().click()
  await page.waitForTimeout(80)
  await page.keyboard.up('Control')
  const activates = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate'))
  assert.equal(activates.length, activatesBefore + 2, 'Ctrl+点击双链与普通链接各上报一次跳转意图')
  const kinds = activates.slice(-2).map((m) => m.kind)
  assert.deepEqual(kinds, ['wikilink.activate', 'link.activate'],
    '双链走 wikilink.activate、普通链接走 link.activate（判定族次序）')
  passed++
  console.log('[全入口][PASS] Ctrl+点击跳转回归：双链/普通链接意图上报不回归')

  // ---- 场景 N：面板条目键盘聚焦为目标 + 面板隐藏释放 ----
  await page.evaluate(() => window.injectBacklinks([
    {
      sourceRelPath: '来源笔记.md',
      sourceFsPath: 'D:\\notes\\来源笔记.md',
      kind: 'wikilink',
      anchor: '',
      start: 24,
      end: 36,
      line: 3,
      snippet: '指向 [[目标笔记]] 的引用行',
    },
  ]))
  await page.locator('.vsidian-backlinks-toggle').click()
  await page.waitForTimeout(80)
  await page.evaluate(() => {
    const item = document.querySelector('.vsidian-backlink-item')
    item?.focus()
  })
  const itemFocus = await page.evaluate(() => window.readActiveElement())
  assert.notEqual(itemFocus, 'body', '反链卡片（button）已键盘聚焦')
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '面板聚焦条目为目标打开浮层')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  // 面板隐藏（切回出链面板）→ 锚点域释放
  await page.evaluate(() => {
    const item = document.querySelector('.vsidian-backlink-item')
    item?.focus()
  })
  await page.evaluate(() => window.runPreviewCommand())
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '再次打开（面板隐藏释放的前置）')
  await page.locator('.vsidian-outlinks-toggle').click()
  await page.waitForTimeout(80)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '面板切换（原面板隐藏）释放在场浮层')
  passed++
  console.log('[全入口][PASS] 面板键盘聚焦目标 + 面板隐藏释放')

  // ---- 场景 O：窗口失焦释放（验收反馈 2026-09-30 切窗失效）----
  // 切窗（Alt+Tab）时 webview 收 blur 且 Chromium 对未聚焦窗口不派发
  // mouseout（electron/electron#45246）——修复前浮层滞留后台遮挡正文
  // （fixed 480×400 拦截 mouseover），切回后悬停完全失效，点侧栏/切页
  // 才恢复。修复语义：失焦即关（内容装载态同关，滞留载体不存在），
  // 切回后再悬停可正常重开
  await page.keyboard.down('Control')
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  await respondOk(req, TARGET_DOC)
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open && !popup.stateVisible, '前置：内容装载态浮层在场')
  const requestsBeforeBlur = (await hoverRequests()).length
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')))
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '窗口失焦即刻关闭浮层（不待关闭延迟）')
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')))
  // 指针先移开再悬停（切窗期间指针未动，无 mouseover 可言——真实用户
  // 切回后会移动鼠标；同坐标 no-op 移动不产生事件）
  await page.mouse.move(60, 500)
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await hoverRequests()).length, requestsBeforeBlur + 1,
    '切回后再悬停正常重开（滞留失效不复现）')
  await page.keyboard.up('Control')
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  passed++
  console.log('[全入口][PASS] 窗口失焦释放浮层 + 切回重开正常')

  // ---- 场景 P：浮层标题条（#217 验收跟进：嵌入卡片同款 header）----
  // 标题为目标显示名常驻（loading 态即有）、跳转按钮带图标；点击按形态
  // 分派（双链 wikilink.activate / 普通链接 link.activate），点击即关闭
  await page.keyboard.down('Control')
  await wikilinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  const headerInfo = await page.evaluate(() => {
    const header = document.querySelector('.vsidian-hover-popup-header')
    if (!header) return null
    return {
      title: header.querySelector('.vsidian-hover-popup-title')?.textContent ?? '',
      hasIcon: !!header.querySelector('.vsidian-hover-popup-open svg'),
      aria: header.querySelector('.vsidian-hover-popup-open')?.getAttribute('aria-label') ?? '',
    }
  })
  assert.ok(headerInfo, '标题条在场（loading 态即有）')
  assert.equal(headerInfo.title, '目标笔记', '标题为目标显示名')
  assert.ok(headerInfo.hasIcon, '跳转按钮带外部跳转图标（嵌入打开入口同款）')
  assert.equal(headerInfo.aria, zhCn['embed.openTarget'], '可访问名走语言包')
  const countBeforeOpen = (await hoverRequests()).length
  const wikiActivateBefore = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'wikilink.activate').length)
  await page.locator('.vsidian-hover-popup-open').click()
  await page.waitForTimeout(120)
  const openMsgs = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'wikilink.activate'))
  assert.equal(openMsgs.length, wikiActivateBefore + 1,
    'header 跳转发 wikilink.activate（父文档身份；增量计，不叠历史场景）')
  assert.equal(openMsgs.at(-1).target, '目标笔记')
  assert.equal(openMsgs.at(-1).sourceDocUri, undefined, '不带来源文档（与嵌入打开入口同语义；断本次消息）')
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '点击跳转即上下文切换关闭')
  assert.equal((await hoverRequests()).length, countBeforeOpen, '跳转不发读取请求')
  // 普通链接形态分派 link.activate
  await mdLinkDeco().hover()
  await page.waitForTimeout(OPEN_WAIT)
  const linkActivateBefore = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'link.activate').length)
  await page.locator('.vsidian-hover-popup-open').click()
  await page.waitForTimeout(120)
  const linkMsgs = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'link.activate'))
  assert.equal(linkMsgs.length, linkActivateBefore + 1,
    '普通链接形态 header 跳转发 link.activate（增量计）')
  assert.equal(linkMsgs.at(-1).href, '目标笔记.md')
  await page.keyboard.up('Control')
  await page.mouse.move(60, 500)
  await page.waitForTimeout(CLOSE_WAIT)
  passed++
  console.log('[全入口][PASS] 浮层标题条：显示名常驻 + 跳转分派（双链/链接）+ 点击关闭')

  // ---- 场景 Q：长双链全宽命中（替换 widget 的右半段不能按源码结束位置漏判）----
  const wideLinkDoc = '# 热区\n\n指向 [[target/T1-全文与属性]]。\n\n' +
    '相邻：[[left|左侧的很长显示别名]][[right|右侧的很长显示别名]]。\n\n' +
    '普通：[本地链接的较长显示文字](target/T1-全文与属性.md)。\n'
  await page.evaluate(text => window.initHoverEntryDoc(text), wideLinkDoc)
  const wideLinks = [
    { selector: '.cm-content .vsidian-wikilink', index: 0, target: 'target/T1-全文与属性' },
    { selector: '.cm-content .vsidian-wikilink', index: 1, target: 'left' },
    { selector: '.cm-content .vsidian-wikilink', index: 2, target: 'right' },
    { selector: '.cm-content .vsidian-link', index: 0, target: 'target/T1-全文与属性.md' },
  ]
  for (const direct of [false, true]) {
    await page.evaluate(direct => window.applyEntrySettings({ 'hover.liveDirect': direct }), direct)
    if (!direct) await page.keyboard.down('Control')
    for (const { selector, index, target } of wideLinks) {
      const link = page.locator(selector).nth(index)
      const rect = await link.boundingBox()
      assert.ok(rect, '长链接应在视口内可见')
      for (const fraction of [0.15, 0.5, 0.85]) {
        await escClose()
        await page.mouse.move(60, 500)
        const before = (await hoverRequests()).length
        await page.mouse.move(rect.x + rect.width * fraction, rect.y + rect.height / 2)
        await page.waitForTimeout(OPEN_WAIT)
        assert.equal((await hoverRequests()).length, before + 1,
          `${direct ? '直接' : 'Ctrl'}悬停 ${target} 的 ${fraction} 宽度处应产生一次请求`)
        assert.equal((await lastRequest()).target, target, '别名与相邻链接不得把目标串到另一链接')
      }
    }
    if (!direct) await page.keyboard.up('Control')
  }
  // 先悬停右半段再按 Ctrl 的补触发同样应命中；键盘光标目标仍按源码范围判定。
  await escClose()
  await page.mouse.move(60, 500)
  await page.evaluate(() => window.applyEntrySettings({ 'hover.liveDirect': false }))
  const wideRect = await page.locator(wideLinks[0].selector).first().boundingBox()
  await page.mouse.move(wideRect.x + wideRect.width * 0.85, wideRect.y + wideRect.height / 2)
  const beforeModifier = (await hoverRequests()).length
  await page.keyboard.down('Control')
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await hoverRequests()).length, beforeModifier + 1, '先悬停长链接右半段再按 Ctrl 也应开浮层')
  assert.equal((await lastRequest()).target, 'target/T1-全文与属性')
  await page.keyboard.up('Control')
  await escClose()
  await page.mouse.move(60, 500)
  await page.evaluate(pos => window.setLiveCursor(pos), wideLinkDoc.indexOf(']]') + 2)
  const beforeBoundaryCommand = (await hoverRequests()).length
  await page.evaluate(() => window.runPreviewCommand())
  assert.equal((await hoverRequests()).length, beforeBoundaryCommand,
    '键盘光标在双链源码结束边界之外，不得借用鼠标全宽命中规则误开')
  passed++
  console.log('[全入口][PASS] 长链接全宽：Ctrl/直接悬停 + 别名与相邻目标 + 修饰键后按 + 键盘边界')

  // ---- 收尾：零写回 ----
  assert.equal(await editRequestCount(), 0, '全场景零 edit.request（悬停/命令不写文档）')
  passed++
  console.log('[全入口][PASS] 零写回：全程无 edit.request')

  assert.deepEqual(errors, [], '页面无未捕获异常')
  console.log(`[全入口] 全部 ${passed} 组场景通过`)
} finally {
  await browser.close()
}
