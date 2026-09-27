// 引用块紫色提示边条绘制层回归（#143）：真实 Chromium + 生产控制器 + 产物
// CSS。断言用户看到的东西（AGENTS 视觉层断言）：
// - 两侧竖条 computed 颜色一致且为紫（明暗主题各验一次，各取规格初值档）；
// - 嵌套引用（多级竖条）不因换色机制回归：live 嵌套行与阅读嵌套 blockquote
//   均正常着色；
// - 背景底维持 VSCode 灰调（不新增紫色背景）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

  /** live 侧竖条颜色：box-shadow computed（Chromium 颜色段在最前） */
  const liveBars = () => page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-quote-line')].map((el) => {
      const m = /rgba?\([^)]+\)/.exec(getComputedStyle(el).boxShadow ?? '')
      return { bar: m?.[0] ?? null, bg: getComputedStyle(el).backgroundColor }
    }))
  /** 阅读侧竖条颜色：外层与嵌套 blockquote 的 borderLeftColor */
  const readingBars = () => page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-view-reading blockquote')].map((el) => ({
      bar: getComputedStyle(el).borderLeftColor,
      bg: getComputedStyle(el).backgroundColor,
      width: getComputedStyle(el).borderLeftWidth,
    })))
  const assertGray = (bg, label) => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg ?? '')
    assert(m, `${label} 背景应可解析: ${String(bg)}`)
    assert.equal(m[1], m[2], `${label} 背景须为灰调（不新增紫色背景）: ${bg}`)
    assert.equal(m[2], m[3], `${label} 背景须为灰调（不新增紫色背景）: ${bg}`)
  }

  // 暗色主题（默认，无 body 主题类）：live 嵌套两行竖条均为暗紫
  let live = await liveBars()
  assert.equal(live.length, 3, `live 引用行应为 3 行（外层两行 + 嵌套行）: ${JSON.stringify(live)}`)
  for (const line of live) {
    assert.equal(line.bar, DARK, `live 竖条颜色（暗）: ${JSON.stringify(line)}`)
    assertGray(line.bg, 'live 引用行')
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

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('quoteBarPaint: 全部断言通过（双视图 × 明暗主题 × 嵌套引用 + 背景灰调）')
} finally {
  await browser.close()
}
