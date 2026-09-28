// 统一右键菜单（#183）的原生浏览器回归：真实布局（Chromium）下用真实右键、
// 真实键盘（Ctrl+Shift+C/Escape）与真实 hover 验证——Live 正文全域接管（空行
// 接管、头区不接管）、菜单浮层真实绘制与 fixed 定位、三簇分组线、安全降级
// 矩阵（表格/围栏区写操作置灰）、子菜单 hover 展开与右缘翻转、提示列小字
// 渲染、图标位资产缺失留空、剪贴板四项桥链路（cut/copy/paste/selectAll）、
// 块链接两项（自 blockMenu.mjs 迁移：标题链接/自动补写/既有 id 复用）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'contextMenu/contextMenu.js')
await build({ entryPoints: [path.join(root, 'test/browser/contextMenuFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

// 行号（0 基）：0 `---` 1 头区行 2 `---` 3 空行 4 H1 5 空行 6 段落 7 空行
// 8 表格三行 11 空行 12 ```js 13 代码 14 ``` 15 空行 16 mermaid 三行
const DOC = [
  '---',
  'title: 头区',
  '---',
  '',
  '# 标题甲',
  '',
  '普通段落一行',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
].join('\n')

// #94：菜单文案经 t() 取词（无岛回退键名会改变菜单测宽）——注入岛
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`${islandHtml}<div id="app"></div>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initContextMenu(text), DOC)
  await page.locator('.cm-line').first().waitFor()
  await page.waitForTimeout(120)
  const line = (n) => page.locator('.cm-line').nth(n)

  // ---- 场景 A：真实右键普通段弹出统一菜单（绘制 + 三簇 + 分组线 + 取词） ----
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  let state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuRect && state.menuRect.width > 100, '右键后菜单应有布局盒（真实绘制）')
  assert.equal(state.menuPosition, 'fixed', '菜单应为视口系 fixed 定位')
  assert.notEqual(state.menuBackground, 'rgba(0, 0, 0, 0)', '菜单背景应真实绘制')
  assert.equal(state.separatorCount, 2, `三簇应恰两条分组线（实际 ${state.separatorCount}）`)
  assert.deepEqual(state.topCommands, [
    'wikilink', 'link', 'copyBlockLink',
    'textFormat', 'paragraphStyle', 'insert',
    'cut', 'copy', 'paste', 'selectAll',
  ], `普通段顶级命令序列（实际 ${JSON.stringify(state.topCommands)}）`)
  assert.ok(state.topTexts.includes('复制块链接') && state.topTexts.includes('粘贴'),
    `菜单文案应取 zh 语言包（实际 ${JSON.stringify(state.topTexts)}）`)
  passed++
  console.log('[统一菜单回归][PASS] 真实右键普通段：绘制、三簇、分组线与取词')

  // ---- 场景 B：分组线真实绘制（computed 非零厚度）+ 提示列渲染 ----
  const sepPainted = await page.evaluate(() => {
    const sep = document.querySelector('.vsidian-context-menu-separator')
    if (!sep) return false
    const style = getComputedStyle(sep)
    return style.borderTopWidth !== '0px' && style.display !== 'none'
  })
  assert.ok(sepPainted, '分组线应真实绘制（边框厚度非零）')
  const hintState = await page.evaluate(() => ({
    cut: window.readMenu().hintOf('cut'),
    selectAll: window.readMenu().hintOf('selectAll'),
    wikilink: window.readMenu().hintOf('wikilink'),
    hintRight: (() => {
      // 取剪贴板簇顶级项（可见）的提示列——子菜单默认 display:none 几何为 0
      const hint = document.querySelector('button[data-vsidian-command="cut"] .vsidian-context-menu-hint')
      if (!hint) return null
      const item = hint.closest('button').getBoundingClientRect()
      const hintRect = hint.getBoundingClientRect()
      return hintRect.right > item.left + (item.right - item.left) / 2
    })(),
    hintSmall: (() => {
      const hint = document.querySelector('button[data-vsidian-command="cut"] .vsidian-context-menu-hint')
      const label = hint ? hint.closest('button').querySelector('.vsidian-context-menu-label') : null
      if (!hint || !label) return null
      return Number.parseFloat(getComputedStyle(hint).fontSize) <
        Number.parseFloat(getComputedStyle(label).fontSize)
    })(),
  }))
  assert.equal(hintState.cut, 'Ctrl+X', '剪切提示列固定显示 Ctrl+X')
  assert.equal(hintState.selectAll, 'Ctrl+A', '全选提示列固定显示 Ctrl+A')
  assert.equal(hintState.wikilink, null, '未绑定项提示列不占位')
  assert.ok(hintState.hintRight, '提示列应右对齐（位于项右半区）')
  assert.ok(hintState.hintSmall, '提示列字号应小于菜单项文字（不抢戏）')
  passed++
  console.log('[统一菜单回归][PASS] 分组线绘制 + 提示列右对齐小字 + 未绑定不占位')

  // ---- 场景 C：图标位资产缺失留空 + H1 徽标在场 ----
  const iconState = await page.evaluate(() => ({
    mask: window.readMenu().iconMaskOf('selectAll'),
    badge: window.readMenu().badgeOf('heading1'),
  }))
  assert.ok(iconState.mask === null || !iconState.mask.includes('url('),
    `图标资产未接入时 mask 应留空（实际 ${iconState.mask}）`)
  assert.equal(iconState.badge, 'H1', '段落设置 H1 档用文字徽标（不经生图）')
  passed++
  console.log('[统一菜单回归][PASS] 图标位资产缺失留空 + H1 文字徽标')

  // ---- 场景 D：子菜单 hover 展开 + 翻转（视口右缘右键）----
  const submenu = page.locator('.vsidian-context-menu-host', { has: page.locator('button[data-vsidian-command="textFormat"]') })
  await submenu.hover()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  let opened = state.submenus.find((s) => s.display === 'block')
  assert.ok(opened, 'hover 父项宿主应展开子菜单（:hover 主通道）')
  // 右缘翻转发判定在装配期——菜单打开于 x=60 右侧空间充足，应向右不翻转
  assert.ok(!opened.flipped, '右侧空间充足时子菜单不翻转')
  passed++
  console.log('[统一菜单回归][PASS] 子菜单 hover 展开（右侧空间充足不翻转）')

  // 关菜单 → 视口右缘真实右键（绝对坐标 mouse API——行盒窄于视口，元素内
  // position 到不了右缘）：子菜单应装配期翻左
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.mouse.move(400, 300) // 挪走指针，解除上一场景的 hover 悬停态
  const lineBox = await line(6).boundingBox()
  await page.mouse.click(870, (lineBox?.y ?? 100) + 6, { button: 'right' })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '前置：视口右缘菜单已打开')
  assert.ok(state.menuRect && state.menuRect.x + state.menuRect.width <= 900 + 1,
    `菜单右缘 clamp 不越出视口（实际 ${state.menuRect && state.menuRect.x + state.menuRect.width}）`)
  const flipped = state.submenus.filter((s) => s.flipped)
  assert.ok(flipped.length === state.submenus.length && flipped.length > 0,
    `视口右缘打开时全部子菜单应装配期翻左（实际 ${state.submenus.map((s) => s.flipped)}）`)
  // 翻转后子菜单真实展开（hover 父项宿主）不溢出视口左缘
  await page.locator('.vsidian-context-menu button[data-vsidian-command="textFormat"]').hover()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  const textFmtSub = state.submenus[0]
  assert.ok(textFmtSub.display === 'block', '翻转态子菜单仍可 hover 展开')
  assert.ok(textFmtSub.rect.left >= -1, `翻转后子菜单不得溢出视口左缘（实际 left=${textFmtSub.rect.left}）`)
  await page.mouse.move(400, 300)
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 视口右缘：子菜单装配期左翻（不溢出屏幕）')

  // ---- 场景 E：子菜单叶命令真实点击（bold 写回一笔） ----
  // 选区经钩子开菜单保持（真实右键的 mousedown 会扰动既有选区——选区内
  // 右键保留选区是浏览器行为，测试以钩子通道隔离该变量；真实右键路径由
  // 场景 A/D/F/G/H 覆盖）
  await page.evaluate(({ from, to, pos }) => {
    window.setSelection(from, to)
    window.post({ kind: 'contextMenu.test.contextMenu', pos })
  }, { from: DOC.indexOf('普通'), to: DOC.indexOf('普通') + 2, pos: DOC.indexOf('普通') + 1 })
  // 子菜单默认 display:none：先 hover 父项展开（子菜单在宿主内，hover 保持）
  await page.locator('.vsidian-context-menu button[data-vsidian-command="textFormat"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="bold"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '叶命令执行后菜单应关闭')
  assert.ok(state.text.includes('**普通**'), `子菜单 bold 应真实写回（实际片段 ${state.text.slice(20, 40)}）`)
  const sentAfterBold = await page.evaluate(() => window.sent())
  assert.equal(sentAfterBold.filter((m) => m.kind === 'edit.request').length, 1,
    'bold 走标准出站一笔')
  passed++
  console.log('[统一菜单回归][PASS] 子菜单叶命令真实点击：写回一笔')

  // ---- 场景 F：空行接管 + 头区不接管 ----
  await page.evaluate(() => window.clearSent())
  await line(3).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '空行右键应接管（全域接管验收线）')
  assert.ok(!state.topCommands.includes('copyBlockLink'), '空行无块目标：复制块链接隐藏')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await line(1).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, 'frontmatter 头区右键不接管（原生菜单照常）')
  passed++
  console.log('[统一菜单回归][PASS] 空行接管 + 头区不接管')

  // ---- 场景 G：安全降级矩阵（表格网格/围栏卡片/图形块上真实右键——
  // 各区的呈现层元素：grid 行、代码卡片行、mermaid 渲染容器） ----
  await page.locator('.vsidian-table-grid-row').first().click({ button: 'right', position: { x: 30, y: 8 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.disabledCommands.includes('wikilink'), '表格行：新增链接（wikilink）置灰')
  assert.ok(state.disabledCommands.includes('link'), '表格行：新增外部链接置灰')
  assert.ok(state.disabledCommands.includes('textFormat'), '表格行：簇 2 父项置灰')
  assert.ok(state.disabledCommands.includes('bold'), '表格行：簇 2 子项置灰')
  assert.ok(!state.disabledCommands.includes('copyBlockLink'), '表格行：块链接可用（整块）')
  assert.ok(!state.disabledCommands.includes('selectAll'), '表格行：剪贴板可用')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.locator('.vsidian-code-card-line').first().click({ button: 'right', position: { x: 30, y: 8 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.disabledCommands.includes('textFormat'), '围栏代码区：簇 2 整簇置灰')
  assert.ok(!state.disabledCommands.includes('copyBlockLink'), '围栏区：块链接可用（整块）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.locator('.vsidian-mermaid').first().click({ button: 'right', position: { x: 40, y: 40 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.disabledCommands.includes('textFormat'), '图形块（mermaid）：簇 2 整簇置灰')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 安全降级矩阵：表格/围栏/图形块逐区域置灰')

  // ---- 场景 H：剪贴板四项（cut/copy/paste/selectAll 真实点击）----
  // 场景 E 的 bold 已改写文档——重装载原始 DOC，后续偏移按 DOC 对拍
  await page.evaluate((t) => window.initContextMenu(t), DOC)
  await page.waitForTimeout(80)
  // 选区内右键保留选区（浏览器行为）：右键点击点落在选区文字上
  await page.evaluate(() => window.clearSent())
  await page.evaluate(({ from, to }) => window.setSelection(from, to),
    { from: DOC.indexOf('普通'), to: DOC.indexOf('普通') + 2 })
  await line(6).click({ button: 'right', position: { x: 12, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.disabledCommands.includes('cut'), '有选区：剪切点亮')
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copy"]').click()
  let sent = await page.evaluate(() => window.sent())
  assert.ok(sent.some((m) => m.kind === 'clipboard.write' && m.text === '普通'),
    `复制应经桥写选区文本（实际 ${JSON.stringify(sent.filter((m) => m.kind === 'clipboard.write'))}）`)
  state = await page.evaluate(() => window.readMenu())
  assert.equal(state.text, DOC, '复制零写回')
  // 剪切：桥写 + 单笔删除
  await page.evaluate(({ from, to }) => window.setSelection(from, to),
    { from: DOC.indexOf('普通'), to: DOC.indexOf('普通') + 2 })
  await line(6).click({ button: 'right', position: { x: 12, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="cut"]').click()
  sent = await page.evaluate(() => window.sent())
  assert.ok(sent.some((m) => m.kind === 'clipboard.write' && m.text === '普通'),
    '剪切应先桥写选区文本')
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('段落一行') && !state.text.includes('普通'),
    `剪切应删除选区（实际片段 ${state.text.slice(18, 30)}）`)
  // 全选：纯选区事务
  await line(6).click({ button: 'right', position: { x: 40, y: 6 } })
  const beforeSelectAll = (await page.evaluate(() => window.readMenu())).text
  await page.locator('.vsidian-context-menu button[data-vsidian-command="selectAll"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.selection.empty && state.selection.from === 0 && state.selection.to === state.text.length,
    `全选应为纯选区事务选全文（实际 ${JSON.stringify(state.selection)}）`)
  assert.equal(state.text, beforeSelectAll, '全选零写回')
  // 粘贴：桥往返（模拟宿主回包——与真实宿主同一消息通道）
  await page.evaluate(() => window.clearSent())
  await line(6).click({ button: 'right', position: { x: 40, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="paste"]').click()
  sent = await page.evaluate(() => window.sent())
  const readMsg = sent.findLast((m) => m.kind === 'clipboard.read')
  assert.ok(readMsg, '粘贴应经宿主剪贴板读桥出站 clipboard.read')
  await page.evaluate((reqId) => window.post(
    { kind: 'clipboard.read.result', reqId, ok: true, text: '桥回文本' }), readMsg.reqId)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('桥回文本'), `宿主回包后应光标处插入（实际片段 ${state.text.slice(18, 34)}）`)
  await page.waitForTimeout(900) // 撤销分段停顿（500ms）+ 出站去抖（250ms）收敛后再计笔数
  sent = await page.evaluate(() => window.sent())
  assert.equal(sent.filter((m) => m.kind === 'edit.request').length, 1,
    '粘贴插入走标准出站一笔')
  passed++
  console.log('[统一菜单回归][PASS] 剪贴板四项：桥写/桥读往返/纯选区事务/单笔删除')

  // ---- 场景 I：块链接两项（自 blockMenu.mjs 迁移，断言语义不变）----
  await page.evaluate(() => window.clearSent())
  // 场景 H 的 cut/paste 已改写文档——重装载原始 DOC（标题行/块链接偏移对拍）
  await page.evaluate((text) => window.initContextMenu(text), DOC)
  await page.waitForTimeout(80)
  // 标题行：复制标题链接 → linkHeading 出站、零写回
  await line(4).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.topCommands.includes('copyHeadingLink'), '标题行：复制标题链接在场')
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copyHeadingLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '命令执行后菜单应关闭')
  assert.equal(state.text, DOC, '复制标题链接零写回')
  let headingMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkHeading' in m))
  assert.deepEqual(headingMsg?.linkHeading,
    { docUri: 'file:///d%3A/notes/ctx.md', heading: '标题甲' },
    `linkHeading 应携标题字面文本（实际 ${JSON.stringify(headingMsg)}）`)
  // 无 id 段：自动补写独立行 ^id + linkBlock
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copyBlockLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.match(state.text, /普通段落一行\n\n\^[a-z0-9]{6}\n/,
    `块尾行后应空一行写独立行 id（实际片段 ${JSON.stringify(state.text.split('\n').slice(6, 9))}）`)
  const blockMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkBlock' in m))
  assert.match(blockMsg.linkBlock.blockId, /^[a-z0-9]{6}$/, 'linkBlock 携 6 位随机 id')
  passed++
  console.log('[统一菜单回归][PASS] 块链接迁移：标题链接 linkHeading + 自动补写 linkBlock')

  // ---- 场景 J：快捷键入口（Ctrl+Shift+C）与 Esc 真实键盘关闭 ----
  await page.evaluate(() => window.clearSent())
  await line(6).click({ position: { x: 10, y: 6 } }) // 左键聚焦 + 光标入普通段
  await page.keyboard.press('Control+Shift+c')
  const execMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'keybindings.execute'))
  assert.equal((execMsg).id, 'blockCopyLink', 'ctrl+shift+c 应出站 blockCopyLink')
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '前置：菜单已打开')
  await page.keyboard.press('Escape')
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, 'Esc 后菜单应关闭')
  assert.deepEqual(errors, [], '页面无未捕获异常')
  passed++
  console.log('[统一菜单回归][PASS] 快捷键入口 + Esc 真实键盘关闭')

  // ---- 场景 K：菜单键盘可达（button 原生可聚焦 + Enter 执行）----
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  const focusState = await page.evaluate(() => {
    // 右键不转移焦点（Tab 序起点依环境而异）——直接验证按钮原生可聚焦，
    // 键盘可达的本质是 button 元素（Tab/Enter/Space 原生行为）
    const btn = document.querySelector('.vsidian-context-menu button')
    if (!btn) return false
    btn.focus()
    return document.activeElement === btn
  })
  assert.ok(focusState, '菜单项应可聚焦（button 键盘可达）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 菜单项键盘可达（button 可聚焦）')
} finally {
  await browser.close()
}
console.log(`[统一菜单回归] 全部通过：${passed} 场景`)
