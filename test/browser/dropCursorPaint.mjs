// 拖放落点光标原生浏览器回归（2026-10 修复）：真实 Chromium + 生产控制器
// + 产物 CSS，断言用户看到的东西（AGENTS 视觉层断言）：
//   D1 拖动选中文本悬停期间 .cm-dropCursor 落点光标真实画出且定位在落点
//      附近（liveInstance 装配 dropCursor 扩展的绘制层证据；修复前无扩展、
//      拖拽全程无任何落点指示）；亮色轮为 baseTheme 黑线
//   D1b 暗色轮（body.vscode-dark）落点光标提亮为 caret 色——CM6 baseTheme
//      的 dark 变体只提亮 .cm-cursor，不补则暗底黑线不可见（评审 F1）
//   D2 松手落位后落点光标撤下（无残留幽灵指示）
//   D3 文本真实落位（CM6 核心 drop 链路不受扩展装配影响：源区间移除 +
//      落点插入，dragMovesSelection 默认语义）
//
// 驱动方式取舍（本机实证留证）：CDP 裸 mouse.down/move/up 序列不触发
// Chromium HTML5 拖拽（只有 mousedown/mouseup，move 被当作拖选重选文本）；
// page.dragAndDrop 能分发 dragstart/dragover 但不分发 drop。故经合成
// DragEvent 三段序列（dragstart → dragover → drop，真实字符边界坐标、
// dataTransfer 载荷由 CM6 dragstart handler 填后复用）驱动生产
// eventObservers/domEventHandlers——断言对象仍是绘制层产物，键盘/鼠标
// 可靠的场景仍用原生输入（见 imagePopup/multicursor 等套件）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'dropCursorPaint/dropCursorPaint.js')
// 与 multicursor.mjs 同口径：katex 裸导入重定向官方 UMD；css 裁掉 woff/ttf
const katexFontStrip = {
  name: 'katex-font-fallback-strip',
  setup(b) {
    b.onLoad({ filter: /katex\.min\.css$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(
        /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\((["']?)(?:woff|truetype)\1\)/g, ''),
      loader: 'css',
    }))
  },
}
const katexMinJs = {
  name: 'katex-min-js',
  setup(b) {
    b.onResolve({ filter: /^katex$/ }, () => ({
      path: path.resolve(root, 'node_modules/katex/dist/katex.min.js'),
    }))
  },
}
await build({ entryPoints: [path.join(root, 'test/browser/dropCursorPaintFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// line1: 0-10（含 \n），line2: 11-22（含 \n，'second line' 11 字符），line3: 23-32
const DOC = 'first line\nsecond line\nthird line'
const DROP_AT = 23 // line3 行首：落位后 first 插到 third 前，期望文本唯一确定
const EXPECTED_AFTER_DROP = ' line\nsecond line\nfirstthird line'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initDoc(text), DOC)
  await page.waitForSelector('.cm-line')

  // 拖拽源：选中 line1 的 first（0..5）；三段序列从选区内字符边界发起
  await page.evaluate(() => window.selectRange(0, 5))
  await page.evaluate(() => window.dispatchDrag('dragstart', 2))
  const to = await page.evaluate((offset) => window.dispatchDrag('dragover', offset), DROP_AT)
  // dropCursor 经 view.requestMeasure 异步测量定位（rAF 一帧），轮询等
  // 定位落定再读——同步读会拿到未定位的静态流内位置（left 漂移、height=0）
  await page.waitForFunction(() => {
    const c = window.readDropCursor()
    return c !== null && c.height > 0 && c.left > -1000
  })

  // D1：拖拽悬停期间落点光标在场且真实定位（无扩展时元素不存在；
  // 装配但未定位时停在 -100000px 兜底位——两种失败形态都拦）；
  // 亮色轮维持 baseTheme 黑线（明暗两轮都可见的亮端）
  const cursor = await page.evaluate(() => window.readDropCursor())
  check('D1 拖拽悬停期间落点光标真实画出并定位在落点附近',
    cursor !== null && cursor.height > 5 && cursor.left > -1000
      && Math.abs(cursor.left - to.x) <= 40,
    cursor === null
      ? '.cm-dropCursor 不在场（dropCursor 扩展未装配）'
      : `left=${cursor.left.toFixed(1)} height=${cursor.height.toFixed(1)} 落点x=${to.x.toFixed(1)}`)
  check('D1 亮色轮落点光标为 baseTheme 黑线',
    cursor?.color === 'rgb(0, 0, 0)',
    `color=${cursor?.color}`)

  // D1b：暗色轮落点光标提亮为 caret 色——CM6 baseTheme 的 dark 变体只
  // 提亮 .cm-cursor，.cm-dropCursor 由实例主题层 &dark 变体补（评审 F1）。
  // 生产链路：body.vscode-dark → hostThemeObserver → applyHostTheme →
  // darkCompartment 热重配（异步），加类后重发 dragover 并轮询颜色落定
  await page.evaluate(() => document.body.classList.add('vscode-dark'))
  await page.evaluate((offset) => window.dispatchDrag('dragover', offset), DROP_AT)
  await page.waitForFunction(() => window.readDropCursor()?.color === 'rgb(221, 221, 221)')
  const darkCursor = await page.evaluate(() => window.readDropCursor())
  check('D1b 暗色轮落点光标提亮为 caret 色（不再黑线不可见）',
    darkCursor?.color === 'rgb(221, 221, 221)',
    `color=${darkCursor?.color}（--vscode-editorCursor-foreground 缺省回退 #ddd）`)
  await page.evaluate(() => document.body.classList.remove('vscode-dark'))

  await page.evaluate((offset) => window.dispatchDrag('drop', offset), DROP_AT)

  // D2：松手落位后落点光标撤下（无残留幽灵指示）
  await page.waitForFunction(() => {
    const c = window.readDropCursor()
    return c === null || c.left < -1000
  })
  const afterDrop = await page.evaluate(() => window.readDropCursor())
  check('D2 落位后落点光标撤下（无残留）',
    afterDrop === null || afterDrop.left < -1000,
    afterDrop === null ? '元素已移除' : `left=${afterDrop.left.toFixed(1)}`)

  // D3：文本真实落位（核心 drop 链路不受扩展装配影响）
  const text = await page.evaluate(() => window.readText())
  check('D3 拖放落位：源区间移除 + 落点插入（dragMovesSelection 默认语义）',
    text === EXPECTED_AFTER_DROP,
    `实际=${JSON.stringify(text)}`)

  check('页面无脚本错误', errors.length === 0, JSON.stringify(errors))
  if (failures.length > 0) {
    console.error(`dropCursorPaint: ${failures.length} 条断言红`)
    process.exitCode = 1
  } else {
    console.log('dropCursorPaint: 全部断言通过（拖拽落点光标绘制/撤下/落位）')
  }
} finally {
  await browser.close()
}
