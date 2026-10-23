// 引用块紫色提示边条绘制层回归（#143）：真实 Chromium + 生产控制器 + 产物
// CSS。断言用户看到的东西（AGENTS 视觉层断言）：
// - 两侧竖条 computed 颜色一致且为紫（明暗主题各验一次，各取规格初值档）；
// - 嵌套引用（多级竖条）不因换色机制回归：live 嵌套行与阅读嵌套 blockquote
//   均正常着色；
// - 背景底维持 VSCode 灰调（不新增紫色背景）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'quoteBarPaint/quoteBarPaint.js')
await build({ entryPoints: [path.join(root, 'test/browser/quoteBarPaintFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
// 规格初值（blockquote-accent-bar.md）：亮 #7c3aed / 暗 #a78bfa
const DARK = 'rgb(167, 139, 250)'
const LIGHT = 'rgb(124, 58, 237)'
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  const DOC = ['> 外层引用行', '>', '> > 嵌套引用行', '', '正文段落。'].join('\n')
  await page.evaluate((text) => window.initQuote(text), DOC)

  /** live 侧竖条颜色：box-shadow computed（Chromium 颜色段在最前）；
   *  padding-left = 内容与竖条的排版间距（验收修复：QuoteMark 隐藏后
   *  内容左移，无内边距时文字与竖条重合） */
  const liveBars = () => page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-quote-line')].map((el) => {
      const m = /rgba?\([^)]+\)/.exec(getComputedStyle(el).boxShadow ?? '')
      return { bar: m?.[0] ?? null, bg: getComputedStyle(el).backgroundColor, pad: getComputedStyle(el).paddingLeft }
    }))
  /** 阅读侧竖条颜色：外层与嵌套 blockquote 的 borderLeftColor */
  const readingBars = () => page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-view-reading blockquote')].map((el) => ({
      bar: getComputedStyle(el).borderLeftColor,
      bg: getComputedStyle(el).backgroundColor,
      width: getComputedStyle(el).borderLeftWidth,
      pad: getComputedStyle(el).paddingLeft,
    })))
  const assertGray = (bg, label) => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg ?? '')
    assert(m, `${label} 背景应可解析: ${String(bg)}`)
    assert.equal(m[1], m[2], `${label} 背景须为灰调（不新增紫色背景）: ${bg}`)
    assert.equal(m[2], m[3], `${label} 背景须为灰调（不新增紫色背景）: ${bg}`)
  }
  /** 文字与竖条不重合：左内边距换算 px 后须超过竖条宽度（3px） */
  const assertPadClearsBar = (pad, label) => {
    const px = Number.parseFloat(pad ?? '')
    assert.ok(Number.isFinite(px) && px > 3, `${label} 左内边距须大于竖条宽度 3px（文字不与竖条重合）: ${pad}`)
  }

  // 暗色主题（默认，无 body 主题类）：live 嵌套两行竖条均为暗紫
  let live = await liveBars()
  assert.equal(live.length, 3, `live 引用行应为 3 行（外层两行 + 嵌套行）: ${JSON.stringify(live)}`)
  for (const line of live) {
    assert.equal(line.bar, DARK, `live 竖条颜色（暗）: ${JSON.stringify(line)}`)
    assertGray(line.bg, 'live 引用行')
    assertPadClearsBar(line.pad, 'live 引用行')
  }
  // 阅读侧：外层与嵌套 blockquote 竖条同色，与 live 一致
  await page.evaluate(() => window.setQuoteMode('reading'))
  await page.waitForSelector('.vsidian-view-reading blockquote blockquote')
  let reading = await readingBars()
  assert.equal(reading.length, 2, '阅读侧应为嵌套两层 blockquote')
  for (const q of reading) {
    assert.equal(q.bar, DARK, `阅读竖条颜色（暗）: ${JSON.stringify(q)}`)
    assert.equal(q.width, '3px', '竖条宽度维持 3px（换色不改形态）')
    assertGray(q.bg, '阅读 blockquote')
    assertPadClearsBar(q.pad, '阅读 blockquote')
  }
  assert.equal(reading[0].bar, reading[1].bar, '外层与嵌套竖条颜色一致（嵌套不回归）')
  assert.equal(reading[0].bar, live[0].bar, '两侧竖条颜色一致（同一变量来源）')

  // 亮色主题（body.vscode-light，VSCode webview 标准主题类）：两侧取浅色档
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  reading = await readingBars()
  for (const q of reading) assert.equal(q.bar, LIGHT, `阅读竖条颜色（亮）: ${JSON.stringify(q)}`)
  await page.evaluate(() => window.setQuoteMode('live'))
  live = await liveBars()
  for (const line of live) assert.equal(line.bar, LIGHT, `live 竖条颜色（亮）: ${JSON.stringify(line)}`)

  // 显式暗色类（vscode-dark）回到暗档：两档均验证完毕
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })
  live = await liveBars()
  for (const line of live) assert.equal(line.bar, DARK, `live 竖条颜色（显式暗）: ${JSON.stringify(line)}`)

  // 不透明引用底色下，真实拖选的颜色必须最终绘制到屏幕，不能只查选区 DOM。
  const pointAt = (target, offset) => target.evaluate((offset) => {
    const rect = window.controller.getView().coordsAtPos(offset)
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  }, offset)
  const pixelAt = async (target, point) => {
    const pixel = await target.screenshot({ clip: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 } })
    return target.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
    }, pixel.toString('base64'))
  }
  const selectedPixels = []
  for (const theme of ['dark', 'light']) {
  for (const [name, text] of [
    ['paragraph', 'alpha    omega'],
    ['quote', '> alpha    omega'],
    ['multi-quote', '> alpha    omega\n> beta     gamma'],
    ['quote-list', '> - alpha    omega'],
    ['heading', '# alpha    omega'],
    ['indented-code', '    alpha    omega'],
    ['inline-code', '`alpha    omega`'],
    ['highlight', '==alpha    omega=='],
    ['fenced-code', '```text\nalpha    omega\n```'],
    ['table', '| alpha    omega | other |\n| --- | --- |\n| a | b |'],
    ['math', '$$\nalpha    omega\n$$'],
  ]) {
    const selectionPage = await browser.newPage({ viewport: { width: 720, height: 560 } })
    await selectionPage.setContent(`<body class="vscode-${theme}"><div id="app"></div></body>`)
    await selectionPage.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await selectionPage.addStyleTag({ content: '#app { --vscode-textBlockQuote-background: rgb(40,40,40); --vscode-editor-selectionBackground: rgb(24,96,180); --vscode-editor-inactiveSelectionBackground: rgb(96,96,128); --vscode-editor-lineHighlightBackground: rgb(40,40,40); --vsidian-live-code-background: rgb(40,40,40); --vsidian-highlight-background: rgb(40,40,40); --vsidian-code-card-background: rgb(40,40,40); --vsidian-table-row-background: rgb(40,40,40); --vsidian-table-background: rgb(40,40,40); --vsidian-math-source-background: rgb(40,40,40); }' })
    await selectionPage.addScriptTag({ path: output })
    const from = text.indexOf('alpha'), to = text.indexOf('omega') + 5
    await selectionPage.evaluate(({ text, from }) => {
      window.initQuote(text)
      const view = window.controller.getView()
      view.dispatch({ selection: { anchor: from } })
      view.focus()
    }, { text, from })
    const start = await pointAt(selectionPage, from)
    const end = await pointAt(selectionPage, to)
    await selectionPage.mouse.move(start.x, start.y)
    await selectionPage.mouse.down()
    await selectionPage.mouse.move(end.x, end.y, { steps: 10 })
    await selectionPage.mouse.up()
    assert.deepEqual(await selectionPage.evaluate(() => {
      const range = window.controller.getView().state.selection.main
      return { from: range.from, to: range.to }
    }), { from, to }, `${name} 拖选必须真正形成正文选区`)
    await selectionPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const snapshot = artifactPath(root, `screenshots/selection-${name}-${theme}.png`)
    await mkdir(path.dirname(snapshot), { recursive: true })
    await selectionPage.screenshot({ path: snapshot })
    const sampleOffset = text.indexOf('    ', from) + 2
    selectedPixels.push({ name: `${name}/${theme}`, rgb: await pixelAt(selectionPage, await pointAt(selectionPage, sampleOffset)) })
    if (name === 'multi-quote') {
      const secondFrom = text.indexOf('beta'), secondTo = text.length
      const secondStart = await pointAt(selectionPage, secondFrom)
      await selectionPage.keyboard.down('Alt')
      await selectionPage.mouse.move(secondStart.x, secondStart.y)
      await selectionPage.mouse.down()
      // 新端点会显形引用前缀；按显形后的真实落点拖到行末。
      const secondEnd = await pointAt(selectionPage, secondTo)
      await selectionPage.mouse.move(secondEnd.x, secondEnd.y, { steps: 10 })
      await selectionPage.mouse.up()
      await selectionPage.keyboard.up('Alt')
      assert.deepEqual(await selectionPage.evaluate(() => window.controller.getView().state.selection.ranges
        .map(range => ({ from: range.from, to: range.to }))),
      [{ from, to }, { from: secondFrom, to: secondTo }], 'Alt 拖选应形成两个真实非空选区')
      assert.deepEqual(await pixelAt(selectionPage, await pointAt(selectionPage, sampleOffset)),
        [24, 96, 180], '引用块副选区也应在不透明底色上可见')
      assert.deepEqual(await pixelAt(selectionPage, await pointAt(selectionPage, text.indexOf('     ', secondFrom) + 2)),
        [24, 96, 180], '引用块主选区应与副选区同色')
    }
    await selectionPage.evaluate(() => document.activeElement.blur())
    await selectionPage.waitForFunction(() => {
      const view = window.controller.getView()
      return !view.hasFocus && !view.dom.classList.contains('cm-focused') &&
        !view.dom.classList.contains('vsidian-table-cell-input-active')
    })
    assert.deepEqual(await pixelAt(selectionPage, await pointAt(selectionPage, sampleOffset)),
      [96, 96, 128], `${name}/${theme} 失焦时应使用非活动选区色`)
    if (name === 'quote') {
      await selectionPage.evaluate(() => {
        window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': false } })
        window.controller.getView().focus()
      })
      assert.equal(await selectionPage.locator('.vsidian-selection-text').count(), 0,
        '关闭多光标时字符补绘必须随组卸载')
      assert.notDeepEqual(await pixelAt(selectionPage, await pointAt(selectionPage, sampleOffset)),
        [40, 40, 40], '多光标关闭后的原生选区仍应在引用底色上可见')
      await selectionPage.evaluate(({ from, to }) => {
        window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': true } })
        window.setQuoteMode('reading')
        window.setQuoteMode('live')
        const view = window.controller.getView()
        view.dispatch({ selection: { anchor: from, head: to } })
        view.focus()
      }, { from, to })
      assert.deepEqual(await pixelAt(selectionPage, await pointAt(selectionPage, sampleOffset)),
        [24, 96, 180], '设置恢复与模式切回后应继续补绘新选区')
    }
    await selectionPage.close()
  }
  }
  console.log('选区绘制像素矩阵:', JSON.stringify(selectedPixels))
  for (const { name, rgb } of selectedPixels) {
    assert.deepEqual(rgb, [24, 96, 180], `${name} 底色不能遮住拖选背景（实际屏幕像素）`)
  }

  await page.evaluate(() => {
    window.initQuote('> 参照正文\n>\n> - 列表条目内容应在引用块边距内换行，列表续行也应保留引用边距。\n>   列表续行\n>   - 子列表\n\n正文')
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  })
  const quoteListLayout = await page.locator('.vsidian-quote-line').evaluateAll((lines) =>
    lines.map(line => ({ list: line.classList.contains('vsidian-list-line'),
      depth2: line.classList.contains('vsidian-list-line-d2'),
      padding: parseFloat(getComputedStyle(line).paddingLeft),
      font: parseFloat(getComputedStyle(line).fontSize) })))
  const quotePadding = quoteListLayout.find(line => !line.list).padding
  assert.ok(quoteListLayout.some(line => line.list && line.depth2), '夹具应真实渲染嵌套列表')
  for (const line of quoteListLayout.filter(line => line.list)) {
    const expected = quotePadding + (line.depth2 ? 1.6 * line.font : 0)
    assert.ok(Math.abs(line.padding - expected) < 0.1,
      `列表首行、续行、子列表应叠加引用块内容边距：${JSON.stringify({ line, expected })}`)
  }

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('quoteBarPaint: 全部断言通过（双视图 × 明暗主题 × 嵌套引用 + 背景灰调）')
} finally {
  await browser.close()
}
