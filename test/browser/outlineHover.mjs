// 大纲悬停视效的原生浏览器回归（#99）：真实布局（Chromium）下用真实
// 悬停驱动验证——条目整行指针光标、悬停行浅一档高亮（located 优先不
// 叠加、悬停互斥单行、移出即恢复）。与 outlineJump.mjs 同装配模式
// （esbuild 打包生产控制器 + 注入页面），located 高亮经点击即时落位。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'outlineHover/outlineHover.js')
await build({ entryPoints: [path.join(root, 'test/browser/outlineHoverFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const DOC = [
  '# 甲',
  '甲开篇正文。',
  '## 甲一',
  '甲一正文段落。',
  '### 甲一一',
  '甲一一深层正文。',
  '## 甲二',
  '甲二正文段落。',
  '# 乙',
  '乙开篇正文。',
  '## 乙一',
  '乙一正文段落。',
  '',
].join('\n')
// 条目序列（0 基）：甲0 甲一1 甲一一2 甲二3 乙4 乙一5

/** 从 computed 颜色里取 alpha（兼容 rgba(...) 与 color(srgb ... / a)
 *  两种序列化——color-mix 产物在 Chromium 下输出 color() 函数格式） */
const alphaOf = (color) => {
  const m = /(?:,\s*|\/\s*)([\d.]+)\)$/.exec(color ?? '')
  return m ? Number.parseFloat(m[1]) : 1
}

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initOutline(text), DOC)
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'sidebar.test.click' }))
  await page.locator('.vsidian-outline-item').first().waitFor()
  await page.waitForTimeout(120)

  // 前置：点击「乙」（条目 4）——located 即时落位（#66 路径）
  await page.locator('.vsidian-outline-item').nth(4).click()
  let state = await page.evaluate(() => window.readOutline())
  assert.equal(state.locatedIndex, 4, `点击后高亮应在条目 4「乙」（实际 ${state.locatedIndex}）`)

  // ---- 场景 A：条目整行指针光标（点击命中区与光标语义一致）----
  for (const n of [0, 1, 5]) {
    const cursor = await page.evaluate((i) => window.readOutline().cursor(i), n)
    assert.equal(cursor, 'pointer', `条目 ${n} 光标应为 pointer（实际 ${cursor}）`)
  }
  passed++
  console.log('[悬停回归][PASS] 条目整行指针光标（含深层与叶条目）')

  // ---- 场景 B：悬停非 located 条目——浅一档背景（alpha 约 0.07，位于 (0.02, 0.1)）----
  await page.locator('.vsidian-outline-item').nth(0).hover()
  const hoverBg = await page.evaluate(() => window.readOutline().bg(0))
  const hoverAlpha = alphaOf(hoverBg)
  assert(hoverAlpha > 0.02 && hoverAlpha < 0.1,
    `悬停条目背景应为浅一档半透明（alpha≈0.07，实际 ${hoverBg}）`)
  passed++
  console.log('[悬停回归][PASS] 悬停非 located 条目：浅一档背景着色')

  // ---- 场景 C：悬停 located 条目——located 优先不叠加（最多两条、最少一条）----
  const locatedBgBefore = await page.evaluate(() => window.readOutline().bg(4))
  await page.locator('.vsidian-outline-item').nth(4).hover()
  const locatedBgDuring = await page.evaluate(() => window.readOutline().bg(4))
  assert.equal(locatedBgDuring, locatedBgBefore,
    `悬停 located 条目时背景应保持 located 原色（实际 ${locatedBgDuring} ≠ ${locatedBgBefore}）`)
  assert(alphaOf(locatedBgDuring) > 0.1,
    `located 背景应明显深于悬停浅档（实际 ${locatedBgDuring}）`)
  // 悬停互斥：悬停移到条目 4 后，条目 0 的悬停着色应消失（最多一条悬停行）
  const bg0AfterMove = await page.evaluate(() => window.readOutline().bg(0))
  assert.equal(bg0AfterMove, 'rgba(0, 0, 0, 0)',
    `悬停移开后条目 0 应无背景（实际 ${bg0AfterMove}）`)
  passed++
  console.log('[悬停回归][PASS] 悬停 located 条目：located 优先不叠加 + 悬停互斥')

  // ---- 场景 D：移出条目区——悬停着色即恢复透明，located 常驻不受影响 ----
  await page.locator('.vsidian-outline-slider').hover()
  const bg4AfterLeave = await page.evaluate(() => window.readOutline().bg(4))
  assert.equal(bg4AfterLeave, locatedBgBefore,
    `悬停移出后 located 常驻背景应保持（实际 ${bg4AfterLeave}）`)
  passed++
  console.log('[悬停回归][PASS] 移出悬停：located 常驻高亮不受悬停影响')

  // ---- #577 大纲条目 Ctrl 悬停弹出标题引用浮窗（directTarget 全链路）----
  // 条目序列（0 基）：甲0 甲一1 甲一一2 甲二3 乙4 乙一5；init 携带宿主
  // 权威 fsPath（d:\notes\outline.md），directTarget 锚点 = 条目标题字面文本
  const DOC_FS_PATH = 'd:\\notes\\outline.md'
  const OPEN_WAIT = 700 // 开延迟 300ms + 余量
  const CLOSE_WAIT = 800 // 关延迟 350ms + 余量
  const hoverRequests = () => page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'hover.request'))
  const lastRequest = async () => (await hoverRequests()).at(-1)
  const respondOk = (req, text, anchor) =>
    page.evaluate(({ reqId, instanceId, text, anchor }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'd:\\notes\\outline.md', relPath: 'outline.md' },
      version: 3, text, range: { start: 0, end: text.length },
      scope: { kind: 'heading', anchor },
    }), { reqId: req.reqId, instanceId: req.instanceId, text, anchor })
  const moveToSidebarToggle = () => page.locator('.vsidian-sidebar-toggle').hover()

  // ---- 场景 E：Ctrl+悬停条目「甲一」→ 开浮窗 + directTarget 载荷 + 内容绘制 ----
  const reqCountBefore = (await hoverRequests()).length
  await page.keyboard.down('Control')
  await page.locator('.vsidian-outline-item').nth(1).hover()
  await page.waitForTimeout(OPEN_WAIT)
  let popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, 'Ctrl+悬停大纲条目应打开引用浮窗')
  let req = await lastRequest()
  assert.ok(req, '应出站 hover.request')
  assert.equal(req.directTarget?.fsPath, DOC_FS_PATH,
    `directTarget.fsPath 应为当前文档宿主身份（实际 ${req.directTarget?.fsPath}）`)
  assert.equal(req.directTarget?.anchor, '甲一',
    `directTarget.anchor 应为标题字面文本（实际 ${req.directTarget?.anchor}）`)
  assert.equal(req.target, '甲一', 'target 为条目显示名（错误分态取材）')
  // 回包 → 全文渲染绘制层可见（内容含深层标题与正文段）
  await respondOk(req, DOC, '甲一')
  await page.waitForTimeout(150)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.hitInside, '回包后浮窗绘制层可见（中心命中在浮层内）')
  assert.ok(popup.text.includes('甲一一深层正文') && popup.text.includes('乙一正文段落'),
    `浮窗应为当前文档全文渲染（实际 ${popup.text.slice(0, 60)}…）`)
  passed++
  console.log('[#577][PASS] Ctrl+悬停大纲条目：浮窗打开 + directTarget 载荷 + 全文绘制')

  // ---- 场景 F：openAction = 大纲现有跳转（located 落位 + 浮窗关闭）----
  assert.equal(await page.evaluate(() => window.clickHoverOpenButton()), true,
    '浮窗标题条「打开」按钮应在场')
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '点击打开后浮窗关闭（上下文切换）')
  const locatedAfterOpen = await page.evaluate(() => window.readOutline().locatedIndex)
  assert.equal(locatedAfterOpen, 1, `打开按钮应执行大纲跳转（located 落到条目 1，实际 ${locatedAfterOpen}）`)
  await page.keyboard.up('Control')
  passed++
  console.log('[#577][PASS] 浮窗打开按钮：执行大纲现有跳转（located 落位）')

  // ---- 场景 G：无 Ctrl 直接悬停不开（Ctrl 修饰必须）----
  await page.locator('.vsidian-outline-item').nth(2).hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '无修饰键悬停大纲条目不开浮窗')
  await moveToSidebarToggle()
  passed++
  console.log('[#577][PASS] 无 Ctrl 悬停：不弹浮窗（条目悬停高亮行为不变）')

  // ---- 场景 H：先悬停后按 Ctrl 补触发；松开 Ctrl 按时序关闭 ----
  await page.locator('.vsidian-outline-item').nth(3).hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '补触发前置：悬停在场、无 Ctrl 不开')
  await page.keyboard.down('Control')
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '悬停中按下 Ctrl 应补触发开浮窗')
  req = await lastRequest()
  assert.equal(req.directTarget?.anchor, '甲二', `补触发的锚点为悬停条目（实际 ${req.directTarget?.anchor}）`)
  // 松开 Ctrl → 350ms 关延迟内仍在场，超时后关闭
  await page.keyboard.up('Control')
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, true, '松开后关延迟内浮窗仍在场（350ms 时序）')
  await page.waitForTimeout(CLOSE_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '松开 Ctrl 后按既有 350ms 时序关闭')
  passed++
  console.log('[#577][PASS] 补触发开浮窗；松开 Ctrl 按时序关闭')

  // ---- 场景 I：hover.outlinePreview 设置门控（关闭不弹，开启后恢复）----
  await page.evaluate(() => window.applyOutlineSettings({ 'hover.outlinePreview': false }))
  await page.keyboard.down('Control')
  await page.locator('.vsidian-outline-item').nth(5).hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, 'hover.outlinePreview 关闭后 Ctrl 悬停不弹')
  // 开启后重新进入悬停（设置只辖「出现」，不追溯已悬停现场）——即时生效
  await page.evaluate(() => window.applyOutlineSettings({ 'hover.outlinePreview': true }))
  await moveToSidebarToggle()
  await page.locator('.vsidian-outline-item').nth(5).hover()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '设置重新开启后 Ctrl 悬停照常弹窗（变更即时生效）')
  await page.keyboard.up('Control')
  await moveToSidebarToggle()
  await page.waitForTimeout(CLOSE_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '复位：移出 + 松开后关闭')
  passed++
  console.log('[#577][PASS] 设置门控：关闭不弹、重新开启后恢复')

  // ---- 场景 J：编辑触发条目重建 → 在场浮窗释放（无悬挂）----
  await page.keyboard.down('Control')
  await page.locator('.vsidian-outline-item').nth(0).hover()
  await page.waitForTimeout(OPEN_WAIT)
  req = await lastRequest()
  await respondOk(req, DOC, '甲')
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '重建释放前置：浮窗在场（内容态）')
  // 追加新标题触发大纲序列变化 → renderOutlineItems 全量重建（不派发
  // mouseout）；view.state 校准路径即时重建（与 codeCardChrome 同款 dispatch）
  await page.evaluate(() => {
    const view = window.controller.getView()
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n## 重建后新标题\n' } })
    window.controller.handleHostMessage({ kind: 'view.state.request' })
  })
  await page.waitForTimeout(400) // 去抖 + 校准窗口
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '条目重建后浮窗应被释放（锚点脱树防悬挂）')
  const textsAfter = await page.evaluate(() => window.readOutline().texts)
  assert.ok(textsAfter.includes('重建后新标题'), '重建后新条目在场（重建确实发生）')
  await page.keyboard.up('Control')
  assert.equal((await hoverRequests()).length, reqCountBefore + 4,
    '大纲悬停请求数 = 场景 E/H/I/J 各一（无多余请求）')
  passed++
  console.log('[#577][PASS] 编辑触发条目重建：在场浮窗释放无悬挂')

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  await page.close()
} finally {
  await browser.close()
}
console.log(`[悬停回归] ${passed} 项通过`)
