// 统一自绘悬停提示的原生浏览器回归（#300）：真实布局与悬停驱动下验证——
// 显示与文案、键位徽章、移出即收、定位钳制、主题变量跟随（以 body 主题类
// + 变量定义仿真宿主注入）、内部文字可选中。绘制层断言口径：computed
// 样式与可见几何，不接受 DOM 存在性。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'tooltipCard/tooltipCard.js')
await build({ entryPoints: [path.join(root, 'test/browser/tooltipCardFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  // 仿真宿主主题注入：VSCode 向 webview 注入 body 主题类与 --vscode-* 变量
  await page.addStyleTag({ content: `
    body.vscode-light { --vscode-editorHoverWidget-background: #f3f3f3; --vscode-editorHoverWidget-foreground: #3b3b3b; }
    body.vscode-dark { --vscode-editorHoverWidget-background: #252526; --vscode-editorHoverWidget-foreground: #cccccc; }
  ` })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate(() => window.tooltipProbe.makeButton('bold', '加粗', ['Ctrl+B']))
  await page.evaluate(() => window.tooltipProbe.makeButton('plain', '插入表格'))

  const card = page.locator('.vsidian-tooltip')

  // 1. 悬停延迟显示：文案与键位徽章（名称、键位两段结构）
  await page.locator('button', { hasText: 'bold' }).hover()
  await page.locator('.vsidian-tooltip--shown').waitFor({ timeout: 2000 })
  assert.equal((await card.locator('.vsidian-tooltip-text').textContent()), '加粗')
  const keys = await card.locator('.vsidian-tooltip-key').allTextContents()
  assert.deepEqual(keys, ['Ctrl+B'])

  // 2. 绘制层：可见几何 + computed 背景取到变量值（非透明）
  const shown = await card.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return { display: style.display, background: style.backgroundColor,
      width: rect.width, height: rect.height, top: rect.top, left: rect.left }
  })
  assert.equal(shown.display, 'block')
  assert.ok(shown.width > 0 && shown.height > 0, '提示应有非零几何')
  assert.notEqual(shown.background, 'rgba(0, 0, 0, 0)', '背景应来自公开变量而非透明')
  assert.ok(shown.top >= 0 && shown.left >= 0, '定位应落盘且在视口内')

  // 3. 主题跟随：body 主题类切换后背景随变量变化（明暗自适应）
  const darkBg = shown.background
  await page.evaluate(() => { document.body.className = 'vscode-light' })
  const lightBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor)
  assert.notEqual(lightBg, darkBg, '浅色主题下背景应随宿主变量变化')
  await page.evaluate(() => { document.body.className = 'vscode-dark' })

  // 4. 移出即收，再悬停无键位目标不渲染徽章
  await page.mouse.move(400, 300)
  await page.waitForFunction(() => !document.querySelector('.vsidian-tooltip').classList.contains('vsidian-tooltip--shown'), undefined, { timeout: 2000 })
  await page.locator('button', { hasText: 'plain' }).hover()
  await page.locator('.vsidian-tooltip--shown').waitFor({ timeout: 2000 })
  assert.equal((await card.locator('.vsidian-tooltip-text').textContent()), '插入表格')
  assert.equal(await card.locator('.vsidian-tooltip-key').count(), 0)

  // 5. 内部文字可选中复制（小卡片契约）
  await card.locator('.vsidian-tooltip-text').evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  const selected = await page.evaluate(() => window.getSelection().toString())
  assert.equal(selected, '插入表格')

  // 6. 态变清空：属性移除后悬停不再显示
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'plain')
    window.tooltipProbe.setHoverText(btn, '')
  })
  await page.mouse.move(400, 300)
  await page.locator('button', { hasText: 'plain' }).hover()
  await page.waitForTimeout(500)
  assert.equal(await card.getAttribute('class'), 'vsidian-tooltip', '清空后不应进入 shown 态')

  assert.deepEqual(errors, [])
  passed = 6
  console.log('tooltipCard browser: 6 组断言全绿')
} finally {
  await browser.close()
}
if (passed !== 6) process.exit(1)
