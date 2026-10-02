import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import MarkdownIt from 'markdown-it'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const directory = artifactPath(root, 'richPasteCompatibility')
mkdirSync(directory, { recursive: true })
const bundle = path.join(directory, 'fixture.js')
await build({ entryPoints: [path.join(root, 'test/browser/richPasteFixture.ts')], bundle: true,
  outfile: bundle, format: 'iife', loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)
const sample = JSON.parse(readFileSync(path.join(root, 'test/browser/fixtures/rich-paste/mdn-strong-native.json'), 'utf8'))
const renderer = new MarkdownIt()
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 900, height: 560 } })
  const page = await context.newPage()
  const unexpectedRequests = []
  page.on('request', request => { if (!request.url().startsWith('http://localhost/')) unexpectedRequests.push(request.url()) })
  await page.route('http://localhost/**', async route => {
    const name = path.basename(new URL(route.request().url()).pathname)
    if (name.endsWith('.svg')) return route.fulfill({ path: path.join(directory, 'assets', name), contentType: 'image/svg+xml' })
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="utf-8"></head><body class="vscode-light" style="--vscode-editor-background:#fff;--vscode-editor-foreground:#222;--vscode-editorWidget-background:#f8f8f8;--vscode-editorWidget-foreground:#222">${islandHtml}<div id="app"></div></body></html>` })
  })
  await page.goto('http://localhost/')
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate(() => window.settings({ 'editor.pasteAskBefore': false }))
  const editor = page.locator('.cm-content'), toast = page.locator('.vsidian-toast')
  async function snapshot() {
    return page.evaluate(async () => {
      const data = { types: [] }
      for (const item of await navigator.clipboard.read()) {
        data.types.push(...item.types)
        for (const type of item.types) if (type === 'text/plain' || type === 'text/html') data[type] = await (await item.getType(type)).text()
      }
      return data
    })
  }
  async function write(text, html) {
    await page.evaluate(async ({ text, html }) => {
      const data = { 'text/plain': new Blob([text], { type: 'text/plain' }) }
      if (html !== undefined) data['text/html'] = new Blob([html], { type: 'text/html' })
      await navigator.clipboard.write([new ClipboardItem(data)])
    }, { text, html })
  }
  async function text() { return page.evaluate(() => window.text()) }
  async function waitText(expected) {
    await page.waitForFunction(expected => window.text() === expected && window.hostText() === expected, expected)
  }
  async function selectAll() { await editor.focus(); await page.keyboard.press('Control+A') }
  async function semantics() {
    const html = renderer.render(await text())
    return page.evaluate(html => {
      const template = document.createElement('template'); template.innerHTML = html
      const dom = template.content
      return { text: dom.textContent.trim(), heading: dom.querySelector('h2')?.textContent,
        bold: [...dom.querySelectorAll('p strong')].map(el => el.textContent),
        italic: [...dom.querySelectorAll('p em')].map(el => el.textContent),
        strike: [...dom.querySelectorAll('p s')].map(el => el.textContent),
        link: dom.querySelector('a')?.getAttribute('href'), code: dom.querySelector('code')?.textContent,
        items: [...dom.querySelectorAll('li')].map(el => el.textContent) }
    }, html)
  }
  async function screenshot(name, severity, pattern) {
    await page.waitForFunction(({ severity, pattern }) => {
      const toast = document.querySelector('.vsidian-toast')
      return toast?.dataset.severity === severity && new RegExp(pattern).test(toast.textContent)
    }, { severity, pattern })
    await page.waitForTimeout(180)
    const paint = await page.evaluate(() => window.paint().toast)
    assert.equal(paint.visible, true)
    assert.equal(paint.severity, severity)
    assert.equal(await editor.evaluate(el => document.activeElement === el), true)
    const box = await toast.boundingBox(), viewport = page.viewportSize()
    assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 1)
    assert.ok(Math.abs(viewport.height - box.y - box.height - 24) < 1)
    await page.screenshot({ path: path.join(directory, name) })
  }

  // CI 默认回放留有来源与获取方式的真实存档；显式环境变量补原生外部网页直达。
  if (process.env.VSIDIAN_RICH_PASTE_EXTERNAL_CAPTURE === '1') {
    const source = await context.newPage()
    await source.goto(sample.source.url, { waitUntil: 'domcontentloaded' })
    const sourceText = await source.evaluate(() => {
      const paragraph = [...document.querySelectorAll('main p')].find(el => el.textContent.includes('element indicates that its contents have strong importance'))
      if (!paragraph) throw new Error('MDN source paragraph not found')
      const range = document.createRange(); range.selectNodeContents(paragraph)
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
      return selection.toString()
    })
    await source.keyboard.press('Control+C')
    await page.bringToFront()
    const captured = await snapshot()
    assert.equal(captured['text/plain'], sourceText)
    assert(captured.types.includes('text/html'))
    writeFileSync(path.join(directory, 'external-native-clipboard.json'), JSON.stringify({ source: sample.source.url, browser: browser.version(), acquisition: 'Unmodified MDN native Ctrl+C; switched to Live without rewriting the clipboard', ...captured }, null, 2))
    await source.close()
  } else await write(sample.text, sample.html)
  await selectAll(); await page.keyboard.press('Control+V')
  await page.waitForFunction(() => window.text() !== '原文' && window.hostText() === window.text())
  let dom = await semantics()
  assert.equal(dom.text, sample.text)
  assert.equal(dom.code, '<strong>')
  assert.equal(dom.link, 'https://developer.mozilla.org/en-US/docs/Web/HTML')
  await screenshot('external-success-viewport.png', 'neutral', '已保留')
  const externalFormatted = await text()
  await page.keyboard.press('Control+Z'); await waitText(sample.text)
  await page.keyboard.press('Control+Z'); await waitText('原文')
  await selectAll(); await editor.click({ button: 'right' }); await page.locator('[data-vsidian-command=paste]').click()
  await waitText(externalFormatted)
  console.log(`[PASS] ${process.env.VSIDIAN_RICH_PASTE_EXTERNAL_CAPTURE === '1' ? '实际MDN网页原生复制' : '真实MDN剪贴板存档回放'}→Live native/menu同文，代码与链接语义、纯文两步历史与toast绘制`)

  const readingMarkdown = '## 粘贴样本\n\n正文 **粗体**、*斜体*与 ~~删除~~，链接 [文档](https://example.com/docs)。\n\n- 第一项\n- 第二项'
  await page.evaluate(text => { window.replace(text); window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }) }, readingMarkdown)
  const reading = page.locator('.vsidian-view-reading')
  await reading.locator('h2').waitFor({ state: 'visible' })
  await reading.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) })
  await page.keyboard.press('Control+C')
  const copied = await snapshot()
  assert(copied.types.includes('text/plain') && copied.types.includes('text/html'))
  assert.match(copied['text/html'], /<h2/)
  assert.match(copied['text/html'], /<strong/)
  writeFileSync(path.join(directory, 'reading-native-clipboard.json'), JSON.stringify({ source: 'Production Reading view', acquisition: 'DOM Range selection and native Ctrl+C, no ClipboardItem.write', markdown: readingMarkdown, ...copied }, null, 2))
  await page.evaluate(() => { getSelection()?.removeAllRanges(); window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'live' }); window.replace('旧内容') })
  await selectAll(); await page.keyboard.press('Control+V')
  await page.waitForFunction(() => window.text() !== '旧内容' && window.hostText() === window.text())
  dom = await semantics()
  assert.equal(dom.heading, '粘贴样本')
  assert.deepEqual(dom.bold, ['粗体'])
  assert.deepEqual(dom.italic, ['斜体'])
  assert.deepEqual(dom.strike, ['删除'])
  assert.equal(dom.link, 'https://example.com/docs')
  assert.deepEqual(dom.items, ['第一项', '第二项'])
  await screenshot('reading-success-viewport.png', 'neutral', '已保留')
  // Windows 原生 Clipboard 提供 CRLF；CM6 与宿主桥内沿用既有 LF 坐标。
  await page.keyboard.press('Control+Z'); await waitText(copied['text/plain'].replace(/\r\n?/g, '\n'))
  await screenshot('undo-format-viewport.png', 'neutral', '再撤销一次')
  await page.keyboard.press('Control+Z'); await waitText('旧内容')
  console.log('[PASS] 生产Reading原生CtrlC携plain+HTML→Live，标题/粗斜删除/链接/列表语义与A/B/C替换选区')

  const rawMarkdown = '## 原始标题\n\n**字面标记**与 [原链接](https://example.com)\n\n- [ ] 原始任务'
  await page.evaluate(text => window.replace(text), rawMarkdown)
  await selectAll(); await page.keyboard.press('Control+C')
  assert.equal((await snapshot())['text/plain'], rawMarkdown)
  await page.evaluate(() => window.replace('原文'))
  await selectAll(); await page.keyboard.press('Control+Shift+V'); await waitText(rawMarkdown)
  await page.keyboard.press('Control+Z'); await waitText('原文')
  console.log('[PASS] 原始Markdown原生复制→CtrlShiftV逐字保留、单次撤销')

  await write('甲\n乙', '<p><b>甲</b></p><p><i>乙</i></p>')
  await page.evaluate(() => { window.replace('a\nb'); window.selectRanges([{ anchor: 0, head: 1 }, { anchor: 2, head: 3 }]) })
  await page.keyboard.press('Control+V'); await waitText('甲\n乙')
  await screenshot('fallback-error-viewport.png', 'error', '无法保留格式')
  await page.keyboard.press('Control+Z'); await waitText('a\nb')
  console.log('[PASS] 不可一致分发的多选区纯文本回退、淡红error实际绘制与单次撤销')

  await page.waitForTimeout(5300)
  await page.evaluate(async () => {
    window.controller.handleHostMessage({ kind: 'keybindings.changed', overrides: { paste: ['ctrl+alt+v'] } })
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2
    canvas.getContext('2d').fillRect(0, 0, 2, 2)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
  await editor.focus(); await page.keyboard.press('Control+Shift+V')
  await screenshot('image-warning-viewport.png', 'warning', 'Ctrl\\+Alt\\+V')
  assert.equal(await text(), 'a\nb')
  assert.equal(await page.evaluate(() => window.sent().filter(m => m.kind === 'image.paste').length), 0)
  assert.deepEqual(unexpectedRequests, [])
  console.log('[PASS] 图片纯文本warning、重绑引导与焦点保持；HTML转换未请求外部资源；四类提示完整视口截图')
} finally { await browser.close() }
