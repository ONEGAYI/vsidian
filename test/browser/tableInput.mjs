// 生产控制器的表外落点与独立格内输入，使用真实浏览器键盘。
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'tableInput/fixture.js')
await build({ entryPoints: [path.join(root, 'test/browser/tableCaretFixture.ts')], bundle: true,
  outfile: bundle, format: 'iife', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file' } })
const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><style>:root{--vscode-focusBorder:rgb(0,120,212);--vscode-editor-foreground:rgb(35,35,35);--vscode-editor-background:white;--vscode-editorCursor-foreground:black}#app{height:600px}</style><link rel="stylesheet" href="/fixture.css"><div id="app"></div><script src="/fixture.js"></script>')
  } else if (req.url === '/fixture.js' || req.url === '/fixture.css') {
    res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(await readFile(req.url.endsWith('.js') ? bundle : bundle.replace(/\.js$/, '.css')))
  } else { res.statusCode = 404; res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, ...(process.env.VSIDIAN_TEST_BROWSER_CHANNEL ? { channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL } : {}) })
const errors = []
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
page.on('pageerror', error => errors.push(error.message))
const source = '| A | B |\n| --- | --- |\n|| y |'
const read = () => page.evaluate(() => window.readEditor())
async function init(text = source) {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.evaluate(text => window.initTable(text), text)
  await page.locator('.vsidian-table-grid-cell').first().click()
}
try {
  await init('a|b|c\n---|---|---\n | | ')
  await page.evaluate(() => window.moveCaret(23))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal((await read()).head, 23, '只定位与聚焦不得改写透明格式空白内的源坐标')
  await page.keyboard.insertText('(')
  assert.equal((await read()).text, 'a|b|c\n---|---|---\n| | | ()|')
  console.log('PASS 定位保留源坐标，实际键入时对齐独立输入落点')

  await init()
  await page.evaluate(() => window.moveCaret(window.readEditor().text.indexOf('y')))
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'table.command', op: 'insertRowBelow' }))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const inserted = await read()
  assert.equal(inserted.head, inserted.text.indexOf('| | |') + 2, '插行后的内容落点须在异步 select 后保持')
  console.log('PASS 结构命令的空格落点不被独立输入的异步选区事件改写')

  await init()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  const edge = page.locator('.vsidian-table-boundary')
  await edge.waitFor({ state: 'visible' })
  assert.equal((await read()).text, source)
  assert.equal(await page.evaluate(() => window.__editRequests), 0)
  const paint = await edge.evaluate(el => {
    const style = getComputedStyle(el), caret = getComputedStyle(el, '::after')
    return { color: style.backgroundColor, caret: caret.backgroundColor, top: caret.top, height: el.getBoundingClientRect().height }
  })
  assert.equal(paint.color, 'rgb(0, 120, 212)')
  assert.equal(paint.caret, 'rgb(0, 0, 0)')
  assert.ok(Math.abs(Number.parseFloat(paint.top) - paint.height / 2) < 1)
  await page.keyboard.press('Enter')
  assert.equal((await read()).text, '\n' + source)
  await page.keyboard.press('Delete')
  assert.equal((await read()).text, source)
  console.log('PASS 首行停靠、绘制层中央光标、真实插行及前行 Delete')

  await init('\n\n' + source + '\n\n')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  assert.equal((await read()).text, source + '\n\n')
  await page.keyboard.press('ArrowRight')
  await page.evaluate(() => window.moveCaret(window.readEditor().text.indexOf('y') + 1))
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Delete')
  assert.equal((await read()).text, source)
  console.log('PASS 已有普通行仍停靠，两边沿连续删除空行')

  await init('前文\n' + source)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  assert.equal((await read()).text, '前文\n' + source)
  await page.keyboard.press('Backspace')
  assert.equal((await read()).text, '前文\n' + source)
  assert.equal((await read()).head, 2)
  console.log('PASS 朝表格删除不删表，朝正文退格只进入前行末尾')

  await init()
  await page.locator('.vsidian-table-grid-row').last().locator('.vsidian-table-grid-cell').first().click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('vsidian-table-cell-input'))
  assert.equal(await page.locator('.vsidian-table-cell-input').inputValue(), '')
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Backspace'); await page.keyboard.press('Delete') }
  // 空数据行的既有结构删除语义只在整行全空时触发，此处第二格非空。
  assert.equal((await read()).text, source)
  await page.keyboard.insertText('中文')
  assert.equal((await read()).text, '| A | B |\n| --- | --- |\n|中文| y |')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  assert.equal((await read()).text, source)
  await page.keyboard.insertText('再次')
  assert.ok((await read()).text.includes('|再次|'))
  console.log('PASS 零宽格无填充输入、清空和再次输入')
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('a b ')
  await page.keyboard.insertText('c')
  assert.equal((await read()).text, '| A | B |\n| --- | --- |\n|a b c| y |')
  console.log('PASS 连续输入保留用户空格')

  await init('| 左 | sss | 右 |\n| --- | --- | --- |\n| 带 |  | 末 |')
  const middle = page.locator('.vsidian-table-grid-cell').nth(1)
  const middleBox = await middle.boundingBox()
  await middle.click({ position: { x: middleBox.width - 2, y: middleBox.height / 2 } })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await middle.evaluate(el => window.tableCaretInside(el)), true)
  console.log('PASS 从格子右边缘点击后光标仍绘在当前格内')

  for (const mode of [[true, true], [false, false]]) {
    await init('\n' + source + '\n')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await page.evaluate(([readOnly, editable]) => window.setTableInputMode(readOnly, editable), mode)
    for (const key of ['Enter', 'Backspace', 'Delete']) await page.keyboard.press(key)
    await page.keyboard.insertText('X')
    assert.equal((await read()).text, '\n' + source + '\n')
  }
  console.log('PASS 边沿停靠后切为只读或不可编辑时禁止写入')

  await init(source.replace('|| y |', '|`ab`| y |'))
  await page.locator('.vsidian-table-grid-row').last().locator('.vsidian-table-grid-cell').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.insertText('|')
  assert.equal((await read()).text, source.replace('|| y |', '|`a|b`| y |'))
  console.log('PASS 代码片段中的管道不重复转义')

  await init()
  await page.locator('.vsidian-table-grid-cell').nth(1).click({ position: { x: 200, y: 10 } })
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    assert.equal((await read()).head, (await read()).text.indexOf('next') + 4)
  }
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
  assert.equal((await read()).text, source)
  console.log('PASS 格内换行上下移动保留水平落点')

  for (const key of ['Backspace', 'Delete']) {
    await init(source.replace('|| y |', '|a\\|b| y |'))
    await page.locator('.vsidian-table-grid-row').last().locator('.vsidian-table-grid-cell').first().click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    if (key === 'Backspace') await page.keyboard.press('ArrowRight')
    await page.keyboard.press(key)
    assert.equal((await read()).text, source.replace('|| y |', '|ab| y |'))
  }
  console.log('PASS 双向删除字面管道不遗留转义符')

  await init(source.replace('|| y |', '|abc| y |'))
  await page.locator('.vsidian-table-grid-row').last().locator('.vsidian-table-grid-cell').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.insertText('X')
  assert.equal((await read()).text, source.replace('|| y |', '|abX| y |'))
  console.log('PASS 反向选字缩小选区后替换')

  await init(source.replace('|| y |', '| abc | xyz |'))
  const body = page.locator('.vsidian-table-grid-row').last()
  const first = await body.locator('.vsidian-table-grid-cell').first().boundingBox()
  const last = await body.locator('.vsidian-table-grid-cell').last().boundingBox()
  await page.mouse.move(first.x + 20, first.y + 10)
  await page.mouse.down()
  await page.mouse.move(last.x + 20, last.y + 10, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.type('a')
  assert.equal((await read()).text, source.replace('|| y |', '| a |  |'))
  console.log('PASS 格区输入保留完整载荷并清除其余格')

  await init()
  await page.locator('.vsidian-table-grid-row').last().locator('.vsidian-table-grid-cell').first().click()
  await page.evaluate(() => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([new Uint8Array([1, 2, 3])], 'paste.png', { type: 'image/png' }))
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => window.__lastHostMessage?.kind === 'image.paste', null, { timeout: 3000 })
  assert.equal((await read()).text, source)
  console.log('PASS 独立输入仍将图片粘贴交给既有宿主通道')

  await init()
  await page.locator('.vsidian-table-grid-row').last().locator('.vsidian-table-grid-cell').first().click()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
  await cdp.send('Input.insertText', { text: '你' })
  await page.waitForFunction(() => window.readEditor().text.includes('|你|'))
  assert.equal((await read()).text, '| A | B |\n| --- | --- |\n|你| y |')
  await cdp.detach()
  console.log('PASS 原生组合输入定稿落在零宽格')

  await init()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  const boundaryIme = await page.context().newCDPSession(page)
  await boundaryIme.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
  await boundaryIme.send('Input.insertText', { text: '你' })
  await page.waitForFunction(() => window.readEditor().text.startsWith('你\n'))
  assert.equal((await read()).text, '你\n' + source)
  await boundaryIme.detach()
  console.log('PASS 边沿直接中文输入不残留候选')

  await init()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('前文')
  assert.equal((await read()).text, '前文\n' + source)
  console.log('PASS 紧邻行输入不自动增加空行')
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
