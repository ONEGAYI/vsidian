// 生产设置页在 Chromium 中的原生按键录入、筛选签、捕获签与明暗绘制回归。
// #95 i18n：页面注入 zh-cn 数据岛首帧装配语言包，文案断言与字典同源；
// #94 起 format 操作标题也经 t() 取词（keybindingSettings 渲染层）。
// #155 视觉刷新：单框搜索＋键盘切换按键捕获、筛选签、每操作单行、
// ＋ 原位变 ✓ 的就地捕获流（真实 pointer/keyboard 事件路径）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'settings/main.js')
await build({ entryPoints: [path.join(root, 'src/webview/settingsMain.ts')], bundle: true,
  outfile: output, format: 'iife' })
const artifacts = artifactPath(root, 'screenshots/keybindings')
await mkdir(artifacts, { recursive: true })
// 数据岛与宿主生成点同源；zhCn 为 zhCnMessages 的断言取词别名
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
    const palette = theme === 'light' ? ['#fff', '#30343b', '#f5f6f8', '#d7dce3', '#f2f4f7']
      : ['#1e1e1e', '#ddd', '#252526', '#474750', '#313136']
    await page.addStyleTag({ content: `:root { --vscode-editor-background:${palette[0]}; --vscode-editor-foreground:${palette[1]}; --vscode-sideBar-background:${palette[2]}; --vscode-panel-border:${palette[3]}; --vscode-editorWidget-background:${palette[4]}; --vscode-input-background:${palette[0]}; --vscode-input-foreground:${palette[1]}; --vscode-descriptionForeground:${palette[1]}; --vscode-focusBorder:#2687d4; }` })
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.evaluate(() => {
      window.messages = []
      window.overrides = {}
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        window.messages.push(message)
        if (message.kind === 'settings.get') setTimeout(() => window.dispatchEvent(new MessageEvent('message',
          { data: { kind: 'settings.snapshot', values: { 'editor.lineNumbers': true } } })), 0)
        if (message.kind === 'keybindings.get') setTimeout(() => window.dispatchEvent(new MessageEvent('message',
          { data: { kind: 'keybindings.snapshot', overrides: window.overrides } })), 0)
        if (message.kind === 'keybindings.set') {
          window.overrides[message.id] = message.bindings
          if (message.replaceConflicts) window.overrides.bold = []
          setTimeout(() => window.dispatchEvent(new MessageEvent('message',
            { data: { kind: 'keybindings.changed', overrides: window.overrides,
              requestId: message.requestId, ok: true } })), 0)
        }
      } })
    })
    await page.addScriptTag({ path: output })
    const globalSearch = page.getByRole('searchbox', { name: zhCn['settings.searchAriaLabel'] })
    await globalSearch.fill('双链')
    await page.locator('.vsidian-settings-result')
      .filter({ hasText: zhCn['format.wikilink'] }).click()
    const located = await page.locator('[data-operation-id="wikilink"]').evaluate((row) => {
      const bounds = row.getBoundingClientRect()
      return { visible: bounds.top >= 0 && bounds.bottom <= innerHeight,
        focused: row.contains(document.activeElement) }
    })
    assert.equal(located.visible, true, '全局搜索定位的操作行应滚动到视口内（主区独立滚动容器内）')
    assert.equal(located.focused, true, '全局搜索定位的操作行应获得键盘焦点')
    await page.getByRole('button', { name: zhCn['keybindingSettings.title'], exact: true }).click()
    const bold = page.locator('[data-operation-id="bold"]')
    await bold.locator('kbd').waitFor()
    assert.equal(await bold.locator('kbd').innerText(), 'Ctrl+B')
    const paint = await bold.locator('.vsidian-keybindings-tag').evaluate((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return { bg: style.backgroundColor, border: style.borderStyle, visible: rect.width > 0 && rect.height > 0 }
    })
    assert.equal(paint.bg, theme === 'light' ? 'rgb(242, 244, 247)' : 'rgb(49, 49, 54)')
    assert.equal(paint.border, 'solid')
    assert.equal(paint.visible, true)
    const nameSearch = page.getByRole('searchbox', { name: zhCn['keybindingSettings.searchNamePlaceholder'] })
    const searchNode = await nameSearch.elementHandle()
    await nameSearch.fill('粗体')
    await nameSearch.evaluate((input) => input.setSelectionRange(1, 1))
    await page.keyboard.type('X')
    assert.equal(await nameSearch.inputValue(), '粗X体')
    assert.equal(await nameSearch.evaluate((input) => input.selectionStart), 2,
      '在中间插字后应保留光标位置')
    await page.keyboard.type('Y')
    assert.equal(await nameSearch.inputValue(), '粗XY体', '连续输入应继续插在中间')
    assert.equal(await searchNode.evaluate((input) => document.contains(input)), true,
      '筛选更新不得替换正在输入的搜索框')
    await nameSearch.evaluate((input) => input.setSelectionRange(1, 3))
    await page.keyboard.type('Z')
    assert.equal(await nameSearch.inputValue(), '粗Z体', '替换中段选区后应保留两侧文本')
    assert.equal(await nameSearch.evaluate((input) => input.selectionStart), 2)
    await nameSearch.fill('')
    // 捕获签流（#155）：＋ 原位变 ✓，就地录制 Ctrl+B，真实 pointer 点击提交
    const italic = page.locator('[data-operation-id="italic"]')
    await italic.getByRole('button', { name: zhCn['keybindingSettings.addBinding'] }).click()
    const capture = italic.getByRole('textbox', { name: zhCn['keybindingSettings.capturePlaceholder'] })
    await capture.press('Control+b')
    assert.equal(await capture.inputValue(), 'Ctrl+B')
    const commit = italic.getByRole('button', { name: zhCn['keybindingSettings.commitCapture'] })
    assert.equal(await commit.isDisabled(), false, '草稿非空后提交应可用')
    await commit.click()
    await italic.getByRole('alert').waitFor()
    const conflictPaint = await italic.getByRole('alert').evaluate((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return { border: style.borderLeftWidth, visible: rect.width > 0 && rect.height > 0 }
    })
    assert.equal(conflictPaint.border, '3px')
    assert.equal(conflictPaint.visible, true)
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.kind === 'keybindings.set').length), 0)
    await italic.getByRole('button', { name: zhCn['keybindingSettings.replaceConflicts'] }).click()
    await page.getByRole('status').filter({ hasText: zhCn['keybindingSettings.saved'] }).waitFor()
    assert.equal(await bold.locator('.vsidian-keybindings-unbound').innerText(), zhCn['keybindingSettings.unbound'])
    // 两段键位：就地录制后 Enter 提交（提交手势的键盘路径）
    const math = page.locator('[data-operation-id="inlineMath"]')
    await math.getByRole('button', { name: zhCn['keybindingSettings.addBinding'] }).click()
    await math.getByRole('textbox', { name: zhCn['keybindingSettings.capturePlaceholder'] })
      .press('Control+k')
    await math.getByRole('textbox', { name: zhCn['keybindingSettings.capturePlaceholder'] })
      .press('Control+m')
    await math.getByRole('textbox', { name: zhCn['keybindingSettings.capturePlaceholder'] })
      .press('Enter')
    await page.getByRole('status').filter({ hasText: zhCn['keybindingSettings.saved'] }).waitFor()
    assert.equal(await math.locator('kbd').innerText(), 'Ctrl+K Ctrl+M')
    // 按键捕获过滤模式（#155）：键盘图标切换，就地录制过滤
    const keyToggle = page.getByRole('button', { name: zhCn['keybindingSettings.keySearchToggle'] })
    await keyToggle.click()
    assert.equal(await keyToggle.getAttribute('aria-pressed'), 'true')
    const togglePaint = await keyToggle.evaluate((node) => getComputedStyle(node).color)
    assert.equal(togglePaint, 'rgb(38, 135, 212)', '激活态键盘图标应为主题强调色')
    await page.getByRole('searchbox', { name: zhCn['keybindingSettings.searchNamePlaceholder'] })
      .press('Control+k')
    await page.getByRole('searchbox', { name: zhCn['keybindingSettings.searchNamePlaceholder'] })
      .press('Control+m')
    assert.equal(await page.locator('.vsidian-keybindings-row').count(), 1)
    assert.equal(await page.locator('.vsidian-keybindings-row').getAttribute('data-operation-id'), 'inlineMath')
    await page.getByRole('searchbox', { name: zhCn['keybindingSettings.searchNamePlaceholder'] })
      .press('Escape')
    assert.equal(await page.locator('.vsidian-keybindings-row').count() > 1, true, 'Esc 退回文字模式应清空键位过滤')
    // 筛选签（#155）：冲突计数与四维过滤（真实点击路径）
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message',
      { data: { kind: 'keybindings.snapshot',
        overrides: { bold: [], italic: ['ctrl+b'], find: ['ctrl+b'], inlineMath: [] } } })))
    const chip = (kind) => page.locator(`.vsidian-keybindings-filter[data-filter="${kind}"]`)
    assert.equal(await chip('conflict').innerText(), `${zhCn['keybindingSettings.filterConflicts']} (2)`)
    await chip('conflict').click()
    assert.deepEqual(await page.locator('.vsidian-keybindings-row').evaluateAll(
      els => els.map(e => e.dataset.operationId)), ['italic', 'find'])
    await chip('userAssigned').click()
    assert.deepEqual(await page.locator('.vsidian-keybindings-row').evaluateAll(
      els => els.map(e => e.dataset.operationId)), ['bold', 'italic', 'inlineMath', 'find'])
    await chip('unassigned').click()
    const unassignedIds = await page.locator('.vsidian-keybindings-row').evaluateAll(
      els => els.map(e => e.dataset.operationId))
    assert.ok(unassignedIds.includes('bold') && unassignedIds.includes('toReading'),
      '未分配应含显式清空与默认无键位的操作')
    assert.ok(!unassignedIds.includes('italic'), '已分配操作不应出现在未分配筛选')
    const chipPaint = await chip('unassigned').evaluate((node) => ({
      pressed: node.getAttribute('aria-pressed'),
      bg: getComputedStyle(node).backgroundColor,
      radius: getComputedStyle(node).borderRadius }))
    assert.equal(chipPaint.pressed, 'true')
    assert.equal(chipPaint.bg, 'rgb(224, 228, 235)', '选中筛选签应呈主题选中底色')
    assert.equal(chipPaint.radius, '999px')
    await page.screenshot({ path: path.join(artifacts, `keybindings-${theme}.png`) })
    assert.deepEqual(errors, [])
    console.log(`[快捷键页][PASS] ${theme}：原生录键、捕获签提交、冲突替换、两段键、按键捕获过滤与筛选签`)
    await page.close()
  }
} finally { await browser.close() }
