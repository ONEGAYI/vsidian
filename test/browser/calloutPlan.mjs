// Callout 源文转换操作（#656/T05）浏览器回归：真实右键三级菜单、键位/
// ui.command 入口与自定义输入宿主往返。断言与规划器单测同一精确原文口径
// （真实菜单/键盘路径与规划器结果一致——票面验收线）；取消菜单/输入框
// 与点击父项零编辑；三级菜单鼠标到达、方向键导航、低高度滚动可达。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutPlan/calloutPlan.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutPlanFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const DOC = [
  '第一段正文甲',
  '第二段正文乙',
  '',
  '> [!note]+ 固定标题',
  '> note 正文',
  '> > [!tip] 内层',
  '> > 内层正文',
  '',
  '结尾段',
].join('\n')

const PARA_POS = DOC.indexOf('正文乙')

let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initCalloutPlan(text), DOC)
  await page.evaluate((off) => window.locate(off), DOC.length)

  // ---- 场景 1：普通段落右键 → 三级菜单（插入 → Callout → 类型）真实点击 ----
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), PARA_POS)
  let state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '菜单应打开')
  assert.ok(state.allCommands.includes('calloutInsert'), '插入子菜单应有 Callout 项')
  // 无 Callout 为普通正文当前态（勾选）
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(60)
  assert.equal(await page.evaluate(() => window.readMenu().checkedOf('calloutType:none')), 'true',
    '普通正文「无 Callout」为当前状态（勾选呈现）')
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutType:tip"]').click()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '叶命令执行后菜单应关闭')
  assert.equal(state.text,
    '> [!tip]\n> 第一段正文甲\n> 第二段正文乙\n\n> [!note]+ 固定标题\n> note 正文\n> > [!tip] 内层\n> > 内层正文\n\n结尾段',
    '段落转换应精确包裹（选区所在段落整体 + 逐行前缀）')
  // 完成后选中类型名
  assert.equal(state.text.slice(state.selection.from, state.selection.to), 'tip', '完成后应选中类型名')
  let edits = (await page.evaluate(() => window.sent())).filter((m) => m.kind === 'edit.request')
  assert.equal(edits.length, 1, '一次转换 = 一笔 edit.request（宿主一步撤销面）')
  passed++
  console.log('[Callout 转换回归][PASS] 段落右键三级菜单：精确包裹 + 选中类型名 + 单笔出站')

  // ---- 场景 2：callout 标题右键「Callout 类型」子菜单改类型（保标题/折叠符号） ----
  const titlePos = async () => (await page.evaluate(() => window.readMenu())).text.indexOf('固定标题')
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), await titlePos())
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.allCommands.includes('calloutChangeType'), '标题行右键应有「Callout 类型」子菜单')
  const calloutOpsButton = (command) => page.locator(
    '.vsidian-context-menu-group:first-child button[data-vsidian-command="' + command + '"]')
  await calloutOpsButton('calloutChangeType').hover()
  await page.waitForTimeout(60)
  assert.equal(await page.evaluate(() => window.readMenu().checkedOf('calloutType:note')), 'true',
    '当前类型 note 应勾选')
  await calloutOpsButton('calloutType:bug').click()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('> [!bug]+ 固定标题'), '改类型保留折叠符号与显式标题')
  assert.ok(!state.text.includes('[!note]'), '旧类型标识应被替换')
  assert.equal(state.text.slice(state.selection.from, state.selection.to), 'bug', '改类型后选中类型名')
  passed++
  console.log('[Callout 转换回归][PASS] 标题右键改类型：保标题折叠符号 + 勾选当前')

  // ---- 场景 3：嵌套正文右键改最内层（不动外层） ----
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }),
    (await page.evaluate(() => window.readMenu())).text.indexOf('内层正文'))
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutType:danger"]').click()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('> [!bug]+ 固定标题'), '外层不动')
  assert.ok(state.text.includes('> > [!danger] 内层'), '内层改类型（最内层目标）')
  passed++
  console.log('[Callout 转换回归][PASS] 嵌套正文改最内层类型')

  // ---- 场景 4：无 Callout（显式标题转首段） ----
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), await titlePos())
  await calloutOpsButton('calloutChangeType').hover()
  await page.waitForTimeout(60)
  await calloutOpsButton('calloutType:none').click()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('> 固定标题\n> note 正文'), '无 Callout：标题转首段，正文与引用层级保留')
  passed++
  console.log('[Callout 转换回归][PASS] 无 Callout：声明与折叠符号移除、标题转首段')

  // ---- 场景 5：键位入口（ui.command）空行骨架 + 骨架内幂等 ----
  // 重新 init 独立文档：骨架空行必须不与引用块相邻（相邻空行的骨架会被
  // 该块吸收为后续段落——既有解析边界（字面标记不识别），非本票验证面）
  await page.evaluate(() => {
    window.initCalloutPlan('普通段落\n\n结尾段\n\n孤立段\n')
  })
  await page.evaluate(() => window.clearSent())
  const blankLinePos = '普通段落'.length + 1 // 行 2 空行（LF 偏移 5）
  await page.evaluate((off) => window.locate(off), blankLinePos)
  await page.evaluate(() => window.post({ kind: 'ui.command', op: 'calloutInsert' }))
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('> [!note]\n结尾段'),
    `空行骨架应写入 > [!note]（实际 ${JSON.stringify(state.text)}）`)
  assert.equal(state.text.slice(state.selection.from, state.selection.to), 'note', '骨架完成后选中类型名')
  // 骨架 callout 内再执行插入：改最内层 note（幂等零编辑零撤销项）
  const skeletonDeclPos = state.text.indexOf('> [!note]') + 4
  await page.evaluate((off) => window.locate(off), skeletonDeclPos)
  await page.evaluate(() => window.clearSent())
  await page.evaluate(() => window.post({ kind: 'ui.command', op: 'calloutInsert' }))
  await page.waitForTimeout(80)
  edits = (await page.evaluate(() => window.sent())).filter((m) => m.kind === 'edit.request')
  assert.equal(edits.length, 0, 'callout 内已是 note：幂等零编辑零撤销项')
  passed++
  console.log('[Callout 转换回归][PASS] 键位入口：空行骨架选中类型名 + callout 内幂等零编辑')

  // ---- 场景 6：取消菜单零编辑 ----
  const before = (await page.evaluate(() => window.readMenu())).text
  await page.evaluate(() => window.clearSent())
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), before.indexOf('结尾段'))
  // 点击父项只展开不执行
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').click()
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').click()
  await page.waitForTimeout(60)
  assert.ok(await page.evaluate(() => window.readMenu().menuExists), '点击父项后菜单仍开（只展开）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.waitForTimeout(40)
  state = await page.evaluate(() => window.readMenu())
  assert.equal(state.text, before, '取消菜单不改文档')
  edits = (await page.evaluate(() => window.sent())).filter((m) => m.kind === 'edit.request')
  assert.equal(edits.length, 0, '取消菜单零编辑出站')
  passed++
  console.log('[Callout 转换回归][PASS] 取消菜单/点击父项：零编辑零出站')

  // ---- 场景 7：自定义输入宿主往返（取消零编辑 / 写入两态） ----
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), before.indexOf('结尾段'))
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutType:custom"]').click()
  await page.waitForTimeout(60)
  let outbound = await page.evaluate(() => window.sent())
  const req = outbound.find((m) => m.kind === 'callout.typeInput.request')
  assert.ok(req, '自定义输入应出站 callout.typeInput.request')
  // 取消：type null → 零编辑
  await page.evaluate((id) => window.post({ kind: 'callout.typeInput.result', sessionId: 'callout-plan', reqId: id, type: null }), req.reqId)
  await page.waitForTimeout(60)
  state = await page.evaluate(() => window.readMenu())
  assert.equal(state.text, before, '取消输入不改文档')
  // 写入：my-note → 骨架
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), before.indexOf('结尾段'))
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutType:custom"]').click()
  await page.waitForTimeout(60)
  outbound = await page.evaluate(() => window.sent())
  const req2 = outbound.filter((m) => m.kind === 'callout.typeInput.request').pop()
  await page.evaluate((id) => window.post({ kind: 'callout.typeInput.result', sessionId: 'callout-plan', reqId: id, type: 'My-Note' }), req2.reqId)
  await page.waitForTimeout(60)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('> [!my-note]'), '自定义输入写入规范化小写标识')
  assert.equal(state.text.slice(state.selection.from, state.selection.to), 'my-note', '自定义类型完成后选中类型名')
  passed++
  console.log('[Callout 转换回归][PASS] 自定义输入往返：取消零编辑 / 写入规范化标识')

  // ---- 场景 8：普通正文点「无 Callout」零编辑（孤立段——结尾段与骨架
  // 行相邻会 lazy 粘连命中 callout，属解析边界非本票验证面） ----
  const plainPos = state.text.indexOf('孤立段')
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), plainPos)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(60)
  await page.evaluate(() => window.clearSent())
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutType:none"]').click()
  await page.waitForTimeout(60)
  edits = (await page.evaluate(() => window.sent())).filter((m) => m.kind === 'edit.request')
  assert.equal(edits.length, 0, '普通正文执行「无 Callout」不改文件（可点选零操作）')
  passed++
  console.log('[Callout 转换回归][PASS] 普通正文「无 Callout」：零编辑')

  // ---- 场景 9：键盘导航三级（方向键到达叶 + Enter 执行） ----
  const paraPos = state.text.indexOf('孤立段')
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), paraPos)
  // 键盘：顶级可达项 = wikilink、insertExternalLink、copyBlockLink（孤立
  // 段有块目标）、textFormat、paragraphStyle、insert——ArrowDown×6 到
  // insert → ArrowRight 进二级 → 二级 5 项（table/hr/code/math/callout）
  // Down×4 到 Callout → ArrowRight 进三级首项
  const menu = page.locator('.vsidian-context-menu')
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight']) {
    // page.keyboard.press：事件派发到当前焦点元素（locator.press 会先聚焦
    // 容器，每键都从容器起点重走——无法形成连续导航）
    await page.keyboard.press(key)
  }
  // 焦点应已进入三级菜单面；逐步导航到 warning（无 Callout 后第 9 项）由
  // 当前焦点位置决定——直接校验焦点在三级面内后用方向键收敛
  const focusedCommand = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-vsidian-command') ?? '')
  assert.ok(focusedCommand.startsWith('calloutType:'),
    `键盘焦点应进入三级类型面（实际 ${focusedCommand}）`)
  // 导航到 warning 并 Enter 执行（面内循环；每步重读焦点）
  let focusNow = focusedCommand
  for (let i = 0; i < 16 && focusNow !== 'calloutType:warning'; i++) {
    await page.keyboard.press('ArrowDown')
    focusNow = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-vsidian-command') ?? '')
  }
  assert.equal(focusNow, 'calloutType:warning', '方向键应可循环到达 warning')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('> [!warning]'), '键盘 Enter 应执行转换')
  assert.ok(!state.menuExists, '执行后菜单关闭')
  passed++
  console.log('[Callout 转换回归][PASS] 键盘三级导航 + Enter 执行')

  // ---- 场景 10：低高度视口滚动可达 ----
  const lowPage = await browser.newPage({ viewport: { width: 900, height: 240 } })
  await lowPage.setContent('<div id="app"></div>')
  await lowPage.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await lowPage.addScriptTag({ path: output })
  await lowPage.evaluate((text) => window.initCalloutPlan(text), DOC)
  await lowPage.evaluate((off) => window.locate(off), DOC.length)
  await lowPage.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), PARA_POS)
  await lowPage.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await lowPage.waitForTimeout(60)
  await lowPage.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await lowPage.waitForTimeout(80)
  const overflow = await lowPage.evaluate(() => window.readMenu().submenuOverflow)
  const grand = overflow[overflow.length - 1]
  assert.ok(grand.display === 'block', '三级子菜单应展开')
  assert.ok(grand.scrollHeight > grand.clientHeight,
    `低高度下类型列表应有滚动面（scroll ${grand.scrollHeight} vs client ${grand.clientHeight}）`)
  // 滚动可达末项（自定义输入）：scrollIntoView 后可见
  const lastVisible = await lowPage.evaluate(() => {
    const btn = document.querySelector('button[data-vsidian-command="calloutType:custom"]')
    if (!btn) return { ok: false, why: 'btn-not-found' }
    btn.scrollIntoView({ block: 'nearest' })
    const rect = btn.getBoundingClientRect()
    return { ok: rect.top >= 0 && rect.bottom <= window.innerHeight, why: '', rect: { top: rect.top, bottom: rect.bottom, vh: window.innerHeight } }
  })
  assert.ok(lastVisible.ok, `滚动后末项（自定义输入）应在视口内可达：${JSON.stringify(lastVisible)}`)
  await lowPage.close()
  passed++
  console.log('[Callout 转换回归][PASS] 低高度滚动可达')

  // ---- 场景 11：结构敏感区（表格内）置灰 ----
  await page.evaluate(() => {
    window.initCalloutPlan('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  })
  await page.evaluate(() => window.locate(8))
  await page.waitForTimeout(120)
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.contextMenu', pos: 8 }))
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '表格内右键菜单应打开（zone=table 接管）')
  assert.ok(state.disabledCommands.includes('calloutInsert'),
    `表格内 Callout 项应置灰（实际置灰 ${JSON.stringify(state.disabledCommands.slice(0, 6))}…）`)
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[Callout 转换回归][PASS] 表格内：Callout 父项随插入簇置灰（安全矩阵）')

  assert.deepEqual(errors, [], '浏览器回归无未捕获异常')
  console.log(`[Callout 转换回归] 全部 ${passed} 节通过`)
} finally {
  await browser.close()
}
