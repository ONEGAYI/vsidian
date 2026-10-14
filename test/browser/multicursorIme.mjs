// 多光标 IME 定稿的原生浏览器回归（#495）：真实 CDP IME（imeSetComposition
// 候选 + insertText 定稿）驱动双光标连续键入全角句号三轮。
// 定位边界（诚实声明）：CDP 组合序列的 DOM selection 时序与真实 IME 不同
// （mainSel 恒在场、光标本就前进——easy-typing #47 报告第六节同型局限），
// 本脚本不复现「定稿文本落光标右侧且光标不前进」的错位本身；错位的机制级
// 钉住在 test/unit/liveInstance.test.ts 的 #495 jsdom 组合序列用例（副光标
// 停留 → 补偿后前进，红→绿已验证）。本脚本的断言面是**回归保护**：
// 修复的 compositionend 选区补偿在真实浏览器 IME 下不破坏既有输入——
// 双光标存续、两行句号逐轮累积、各光标随输入前进、单光标行为不变。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'multicursorIme/multicursorIme.js')
// 与 multicursorWrite 同口径：katex 裸导入重定向官方 UMD；css 裁掉 woff/ttf
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
await build({ entryPoints: [path.join(root, 'test/browser/multicursorImeFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let total = 0

async function scenario(name, { doc, cursor }, run) {
  total++
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    await page.evaluate((text) => window.initDoc(text), doc)
    await page.click('.cm-content')
    if (cursor !== undefined) {
      await page.evaluate((offset) => window.locate(offset), cursor)
    }
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[多光标IME][PASS] ${name}`)
  } catch (error) {
    console.log(`[多光标IME][FAIL] ${name}: ${error.message}`)
    throw error
  } finally {
    await page.close()
  }
}

const read = (page) => page.evaluate(() => window.readEditor())
const pos = (page, offset) => page.evaluate((at) => window.posCoords(at), offset)

/** Alt+点击在指定偏移添加一个光标（与 multicursor.mjs 同口径） */
async function altClick(page, offset) {
  const { x, y } = await pos(page, offset)
  await page.keyboard.down('Alt')
  await page.mouse.click(x, y)
  await page.keyboard.up('Alt')
}

/** 真实 IME 一轮：候选组合 + 定稿（T06/T07 同型 CDP 手法） */
async function imeCommit(cdp, text) {
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await new Promise((resolve) => setTimeout(resolve, 120))
  await cdp.send('Input.insertText', { text })
  await new Promise((resolve) => setTimeout(resolve, 150))
}

// 文档坐标速算：
// '今天天气很好\n他问了一'：今=0..好=5（行一长 6）\n=6 他=7..一=10（行二末 = 11，总长 11）

await scenario('双光标连续三轮 IME 定稿全角句号：各光标每轮随输入前进', { doc: '今天天气很好\n他问了一', cursor: 6 },
  async (page) => {
    await altClick(page, 11)
    let state = await read(page)
    assert.equal(state.ranges.length, 2, '双光标在场')
    const cdp = await page.context().newCDPSession(page)
    for (let round = 1; round <= 3; round++) {
      await imeCommit(cdp, '。')
      state = await read(page)
      // 广播插入：两行各得一枚句号；光标随最新句号前进——行二坐标 =
      // 自身前进（round）+ 行一累计平移（round）
      assert.deepEqual(state.ranges, [{ from: 6 + round, to: 6 + round }, { from: 11 + 2 * round, to: 11 + 2 * round }],
        `第 ${round} 轮后双光标应各随输入前进：${JSON.stringify(state.ranges)}`)
    }
    state = await read(page)
    assert.equal(state.text, '今天天气很好。。。\n他问了一。。。', `三轮定稿文本：${JSON.stringify(state.text)}`)
    // 双光标全程存续（不坍缩）
    assert.equal(state.ranges.length, 2, '多光标存续')
  })

await scenario('单光标 IME 定稿不介入：光标随输入前进（既有行为）', { doc: '今天天气很好', cursor: 6 },
  async (page) => {
    const cdp = await page.context().newCDPSession(page)
    for (let round = 1; round <= 2; round++) {
      await imeCommit(cdp, '。')
    }
    const state = await read(page)
    assert.equal(state.text, '今天天气很好。。', `两轮定稿文本：${JSON.stringify(state.text)}`)
    assert.deepEqual(state.ranges, [{ from: 8, to: 8 }], `单光标随输入前进：${JSON.stringify(state.ranges)}`)
  })

await browser.close()
console.log(`[多光标IME] ${passed}/${total} 场景通过`)
if (passed !== total) process.exit(1)
