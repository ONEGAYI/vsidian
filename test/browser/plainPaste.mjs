import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'plainPaste/plainPaste.js')
await build({ entryPoints: [path.join(root, 'test/browser/plainPasteFixture.ts')], bundle: true, outfile: bundle, format: 'iife', loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 560 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  await page.route('http://localhost/**', async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname)
    if (name.endsWith('.svg')) await route.fulfill({ path: artifactPath(root, 'plainPaste/assets', name), contentType: 'image/svg+xml' })
    else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="utf-8"></head><body class="vscode-light" style="--vscode-editor-background:#fff;--vscode-editor-foreground:#222;--vscode-editorWidget-background:#f8f8f8;--vscode-editorWidget-foreground:#222;--vscode-contrastBorder:#000">${islandHtml}<div id="app"></div></body></html>` })
  })
  await page.goto('http://localhost/')
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate(() => window.initContextMenu('原文'))
  const editor = page.locator('.cm-content')
  const toast = page.locator('.vsidian-toast')
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
  async function write(text, image = true, html) {
    await page.evaluate(async ({ text, image, html, png }) => {
      const values = {}
      if (text !== undefined) values['text/plain'] = new Blob([text], { type: 'text/plain' })
      if (html !== undefined) values['text/html'] = new Blob([html], { type: 'text/html' })
      if (image) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2
        canvas.getContext('2d').fillRect(0, 0, 2, 2)
        values['image/png'] = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      }
      await navigator.clipboard.write([new ClipboardItem(values)])
    }, { text, image, html, png })
  }
  await editor.click()
  await page.keyboard.press('Control+A')
  await write('**文字**')
  await page.keyboard.press('Control+Shift+V')
  await page.waitForFunction(() => window.controller.getView().state.doc.toString() === '**文字**')
  await toast.waitFor()
  assert.match(await toast.innerText(), /已粘贴文本.*Ctrl\+V/)
  assert.equal(await page.evaluate(() => window.sent().some((m) => m.kind === 'image.paste')), false)
  assert.equal(await editor.evaluate((el) => document.activeElement === el), true)
  await page.waitForTimeout(180)
  await page.evaluate(() => window.post({ kind: 'view.state.request' }))
  let paint = await page.evaluate(() => window.sent().findLast((m) => m.kind === 'view.state').paint.toast)
  assert.equal(paint.visible, true)
  assert.equal(paint.background, 'rgb(255, 247, 219)')
  assert.equal(paint.pointerEvents, 'none')
  const warningRect = await toast.boundingBox()
  assert.ok(Math.abs(warningRect.x + warningRect.width / 2 - 450) < 1)
  assert.ok(Math.abs(560 - warningRect.y - warningRect.height - 24) < 1)
  await toast.screenshot({ path: artifactPath(root, 'plainPaste/warning-light.png') })
  console.log('[PASS] 真实 Clipboard API + CtrlShiftV：只插文字、淡黄绘制、底部居中、不抢焦点')

  // 两种粘贴菜单提示取有效注册值，纯文本菜单走相同快照。
  await page.evaluate(() => { window.post({ kind: 'keybindings.changed', overrides: { paste: ['ctrl+alt+v'] } }); document.getElementById('app').style.setProperty('--vsidian-toast-warning-duration', '10') })
  await page.waitForTimeout(4200)
  await write(undefined)
  await editor.click({ button: 'right' })
  await page.locator('button[data-vsidian-command="pastePlain"]').click()
  await toast.waitFor()
  assert.match(await toast.innerText(), /无法将图片.*Ctrl\+Alt\+V/)
  assert.equal(await page.evaluate(() => window.controller.getView().state.doc.toString()), '**文字**')
  console.log('[PASS] 图片无文本菜单：文档不变、提示改绑同步')

  // 主题、片段覆盖、错误/普通色、窄视口、减少动画、像素截图。
  await page.waitForTimeout(200)
  await page.evaluate(() => { document.body.className = 'vscode-dark'; document.getElementById('app').style.setProperty('--vsidian-toast-warning-duration', '1000'); window.showLocalToast('暗色警告', 'warning') })
  await toast.waitFor(); await page.waitForTimeout(180)
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(57, 51, 33)')
  await toast.screenshot({ path: artifactPath(root, 'plainPaste/warning-dark.png') })
  await page.waitForTimeout(1200)
  await page.evaluate(() => document.getElementById('app').style.removeProperty('--vsidian-toast-warning-duration'))
  await page.addStyleTag({ content: '#app { --vsidian-toast-warning-background: rgb(10, 20, 30); --vsidian-toast-warning-duration: 50; --vsidian-toast-error-duration: 50; --vsidian-toast-duration: 50; }' })
  await page.evaluate(() => window.showLocalToast('片段覆盖', 'warning'))
  await toast.waitFor()
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(10, 20, 30)')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.showLocalToast('转换失败', 'error'))
  await toast.waitFor()
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(60, 41, 45)')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.showLocalToast('已保留格式'))
  await toast.waitFor()
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(248, 248, 248)')
  await page.waitForTimeout(200)
  await page.evaluate(() => { document.body.className = 'vscode-high-contrast'; window.showLocalToast('高对比提示', 'error') })
  await toast.waitFor()
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).borderTopColor), 'rgb(0, 0, 0)')
  await page.waitForTimeout(200)
  const bareClassSnippet = await page.addStyleTag({ content: '.vsidian-toast { background: rgb(30, 40, 50); color: rgb(220, 230, 240); border-color: rgb(80, 90, 100); }' })
  for (const severity of ['neutral', 'warning', 'error']) {
    await page.evaluate((severity) => window.showLocalToast('裸类片段覆盖', severity), severity)
    await toast.waitFor()
    assert.deepEqual(await toast.evaluate((el) => {
      const paint = getComputedStyle(el)
      return [paint.backgroundColor, paint.color, paint.borderTopColor]
    }), ['rgb(30, 40, 50)', 'rgb(220, 230, 240)', 'rgb(80, 90, 100)'])
    await page.waitForTimeout(200)
  }
  await bareClassSnippet.evaluate((el) => el.remove())
  console.log('[PASS] 公开裸类片段覆盖普通、警告、错误三类实际绘制')
  await page.setViewportSize({ width: 240, height: 400 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { document.getElementById('app').style.setProperty('--vsidian-toast-duration', '1000'); window.showLocalToast('很长的操作引导文字，要求完整折行显示，不能裁掉正确粘贴图片的方式。') })
  await toast.waitFor()
  const narrow = await toast.boundingBox()
  assert.ok(narrow.x >= 16 && narrow.x + narrow.width <= 224)
  assert.ok(narrow.height > 40)
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).animationName), 'none')
  await toast.screenshot({ path: artifactPath(root, 'plainPaste/narrow-reduced-motion.png') })
  console.log('[PASS] 明暗/高对比、片段覆盖、三种严重性、窄视口折行、减少动态效果')
  await page.waitForTimeout(1200)
  // 原始 Markdown -> 纯文本，HTML-only -> 文本，普通 CtrlV图片仍沿既有路径。
  await write(undefined, false, '<p><b>HTML 文字</b></p>')
  await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Control+Shift+V')
  await page.waitForFunction(() => window.controller.getView().state.doc.toString() === 'HTML 文字')
  await write('忽略文本', true)
  await editor.click(); await page.keyboard.press('Control+V')
  await page.waitForFunction(() => window.sent().some((m) => m.kind === 'image.paste'))
  assert.equal(await page.evaluate(() => window.controller.getView().state.doc.toString()), 'HTML 文字')
  console.log('[PASS] HTML-only提取与原生普通CtrlV图片优先回归')
} finally { await browser.close() }
