// 正文右键菜单（复制块链接）的原生浏览器回归（#162）：真实布局（Chromium）
// 下用真实右键、真实键盘（Ctrl+Shift+C）验证——菜单浮层真实绘制与 fixed
// 定位（点击点起位、右缘 clamp）、菜单项文案取词、自动补写 id 的文档对拍、
// 快捷键出站与宿主命令回流同一执行路径。与 outlineMenu.mjs 同装配模式。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'blockMenu/blockMenu.js')
await build({ entryPoints: [path.join(root, 'test/browser/blockMenuFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

// 行号（0 基）：0 `---` 1 头区行 2 `---` 3 空行 4 H1 5 空行 6 段落 7 空行 8 已有 id 段
const DOC = [
  '---',
  'title: 头区',
  '---',
  '',
  '# 标题甲',
  '',
  '普通段落一行',
  '',
  '已有 id 的段落 ^keep1',
].join('\n')

// #94：菜单文案经 t() 取词（无岛回退键名会改变菜单测宽）——注入岛
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`${islandHtml}<div id="app"></div>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initBlockMenu(text), DOC)
  await page.locator('.cm-line').first().waitFor()
  await page.waitForTimeout(120)
  const line = (n) => page.locator('.cm-line').nth(n)

  // ---- 场景 A：真实右键普通段弹出菜单（真实绘制 + fixed 定位 + 文案取词） ----
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  let state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuRect, '右键后菜单应有布局盒（真实绘制）')
  assert.ok(state.menuRect.width > 100 && state.menuRect.height > 20,
    `菜单应有实质尺寸（实际 ${state.menuRect.width}x${state.menuRect.height}）`)
  assert.equal(state.menuPosition, 'fixed', '菜单应为视口系 fixed 定位')
  assert.notEqual(state.menuBackground, 'rgba(0, 0, 0, 0)',
    `菜单背景应真实绘制（实际 ${state.menuBackground}）`)
  assert.deepEqual(state.commands, ['copyBlockLink'],
    `普通块应只有复制块链接（实际 ${JSON.stringify(state.commands)}）`)
  assert.deepEqual(state.itemTexts, ['复制块链接'],
    `菜单文案应取 zh 语言包（实际 ${JSON.stringify(state.itemTexts)}）`)
  // 起位：菜单左上角在点击点附近（点击 y 是行内 6px，允许小幅偏差）
  const clickBox = await line(6).boundingBox()
  assert.ok(state.menuRect.x >= (clickBox?.x ?? 0) + 40,
    `菜单应在点击点右侧起位（menu.x=${state.menuRect.x}）`)
  passed++
  console.log('[块菜单回归][PASS] 真实右键普通段：绘制、fixed 定位、单项与取词')

  // ---- 场景 B：右键视口右缘：菜单右缘 clamp 不越界 ----
  await page.evaluate(() => window.post({ kind: 'block.test.menuClose' }))
  await line(6).click({ button: 'right', position: { x: 800, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuRect.x + state.menuRect.width <= 900 + 1,
    `菜单右缘不得越出视口（right=${state.menuRect.x + state.menuRect.width}）`)
  passed++
  console.log('[块菜单回归][PASS] 右缘 clamp：菜单不越出视口')

  // ---- 场景 C：右键标题行：两项（复制标题链接在前） ----
  await page.evaluate(() => window.post({ kind: 'block.test.menuClose' }))
  await line(4).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.deepEqual(state.commands, ['copyHeadingLink', 'copyBlockLink'],
    `标题行应有两项（实际 ${JSON.stringify(state.commands)}）`)
  passed++
  console.log('[块菜单回归][PASS] 标题行右键：复制标题链接 + 复制块链接')

  // ---- 场景 D：复制标题链接（真实左键）：linkHeading 出站、零写回 ----
  await page.locator('.vsidian-block-menu button[data-vsidian-command="copyHeadingLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '命令执行后菜单应关闭')
  assert.equal(state.text, DOC, '复制标题链接零写回')
  const headingMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkHeading' in m))
  assert.deepEqual(headingMsg?.linkHeading, { docUri: 'file:///d%3A/notes/block.md', heading: '标题甲' },
    `linkHeading 应携标题字面文本（实际 ${JSON.stringify(headingMsg)}）`)
  passed++
  console.log('[块菜单回归][PASS] 复制标题链接：linkHeading 出站、标题字面文本')

  // ---- 场景 E：复制块链接无 id 段：真实左键 → 自动补写 + linkBlock ----
  // #163 验收反馈：默认写入形态 = 块尾行后空一行 + 独立行 ^id（6 位随机）
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  await page.locator('.vsidian-block-menu button[data-vsidian-command="copyBlockLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.match(state.text, /普通段落一行\n\n\^[a-z0-9]{6}\n/,
    `块尾行后应空一行写独立行 id（实际片段 ${JSON.stringify(state.text.split('\n').slice(6, 9))}）`)
  const blockMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkBlock' in m))
  assert.match(blockMsg?.linkBlock?.blockId, /^[a-z0-9]{6}$/, 'linkBlock 携 6 位随机 id')
  passed++
  console.log('[块菜单回归][PASS] 复制块链接：自动补写独立行 6 位 id + linkBlock 出站')

  // ---- 场景 F：已有 id 段：零写回直接复制既有 id ----
  // 场景 E 插入两行后「已有 id 的段落」从行 8 移到行 10
  await page.evaluate(() => window.clearSent())
  await line(10).click({ button: 'right', position: { x: 60, y: 6 } })
  await page.locator('.vsidian-block-menu button[data-vsidian-command="copyBlockLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.match(state.text, /已有 id 的段落 \^keep1$/, '既有 id 段零改写')
  const keepMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkBlock' in m))
  assert.equal(keepMsg?.linkBlock?.blockId, 'keep1', '直接复制既有 id')
  passed++
  console.log('[块菜单回归][PASS] 既有 id 段：零写回直接复制')

  // ---- 场景 G：真实键盘 Ctrl+Shift+C（快捷键入口）与宿主命令回流路径 ----
  await page.evaluate(() => window.clearSent())
  await line(6).click({ position: { x: 10, y: 6 } }) // 左键聚焦 + 光标入普通段
  await page.keyboard.press('Control+Shift+c')
  let execMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'keybindings.execute'))
  assert.equal(execMsg?.id, 'blockCopyLink',
    `ctrl+shift+c 应出站 keybindings.execute blockCopyLink（实际 ${JSON.stringify(execMsg)}）`)
  // 宿主命令回流（宿主注册命令 → 面板消息）与右键同一执行路径
  await page.evaluate(() => window.post({ kind: 'blockLink.copy' }))
  state = await page.evaluate(() => window.readMenu())
  // 场景 E 已为该块写入 id：光标块复制应沿用既有 id，不再追加第二个标记
  assert.match(state.text, /普通段落一行\n\n\^[a-z0-9]{6}(?:\n|$)/,
    '光标所在块应沿用（或补写）恰好一个块 id')
  const paraBlock = state.text.split('\n').slice(6, 9).join('\n')
  assert.equal(paraBlock.match(/\^[a-z0-9]{6}/g)?.length, 1,
    '同一块不得追加第二个 id')
  const cursorMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkBlock' in m))
  assert.match(cursorMsg?.linkBlock?.blockId, /^[a-z0-9]{6}$/, '光标块复制仍出站 linkBlock')
  passed++
  console.log('[块菜单回归][PASS] 快捷键出站与宿主命令回流：光标块同一执行路径')

  // ---- 场景 H：frontmatter 头区右键不接管 + Esc 真实键盘关闭 ----
  await line(1).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, 'frontmatter 头区右键不应弹菜单')
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '前置：普通段菜单已打开')
  await page.keyboard.press('Escape')
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, 'Esc 后菜单应关闭')
  assert.deepEqual(errors, [], '页面无未捕获异常')
  passed++
  console.log('[块菜单回归][PASS] 头区不接管 + Esc 真实键盘关闭')

  // ---- 场景 I：块 id 标记淡化绘制（#163 验收反馈，双形态 computed）----
  // 此前场景已写入独立行 id（场景 E）且 DOC 自带行尾 ^keep1——双形态在场
  const paints = await page.evaluate(() => window.readBlockIdPaint())
  assert.ok(paints.length >= 2, `行尾与独立行双形态标记应各有淡化 span（实际 ${paints.length}）`)
  const hasTail = paints.some((p) => /keep1/.test(p.text))
  const hasStandalone = paints.some((p) => /^ \^[a-z0-9]{6}$|^\^[a-z0-9]{6}$/.test(p.text))
  assert.ok(hasTail, `行尾形态标记应淡化（实际 ${JSON.stringify(paints.map((p) => p.text))}）`)
  assert.ok(hasStandalone, `独立行形态标记应淡化（实际 ${JSON.stringify(paints.map((p) => p.text))}）`)
  const alphaOf = (color) => {
    const rgba = /rgba?\(([^)]+)\)/.exec(color)
    if (rgba) {
      const parts = rgba[1].split(',').map((p) => p.trim())
      return parts.length > 3 ? Number(parts[3]) : 1
    }
    const css = /color\(srgb[^/]*\/\s*([\d.]+)\)/.exec(color)
    return css ? Number(css[1]) : 1
  }
  const bodyColor = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.cm-line')).color)
  for (const p of paints) {
    assert.equal(p.display, 'inline', `淡化不得隐藏（${p.text}）`)
    assert.ok(alphaOf(p.color) < alphaOf(bodyColor),
      `标记色 alpha 应低于正文（${p.text}: ${p.color} vs ${bodyColor}）`)
  }
  // 自定义字体色适配：改动正文前景变量后标记色跟随（相对变换而非锚定
  // 固定色——用户可自定义字体颜色，淡化必须随之）
  const beforeFg = paints[0].color
  await page.addStyleTag({ content: ':root { --vscode-editor-foreground: #c01c1c; }' })
  const repaints = await page.evaluate(() => window.readBlockIdPaint())
  assert.notEqual(repaints[0].color, beforeFg,
    `标记色应跟随正文前景变化（适配自定义字体色：${beforeFg} → ${repaints[0].color}）`)
  // 阅读侧隐藏：标记不进阅读渲染（剥离在 markdown-it 解析前）
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'reading' }))
  await page.waitForTimeout(60)
  const readingText = await page.evaluate(() => window.readingText())
  assert.ok(readingText.includes('已有 id 的段落'), '阅读侧正文保留')
  assert.ok(!readingText.includes('keep1') && !readingText.includes('^'),
    `阅读侧不应出现块 id 标记（实际片段 ${JSON.stringify(readingText.slice(-80))}）`)
  passed++
  console.log('[块菜单回归][PASS] 块 id 双形态淡化 + 自定义字体色适配 + 阅读隐藏')
} finally {
  await browser.close()
}
console.log(`[块菜单回归] 全部通过：${passed} 场景`)
