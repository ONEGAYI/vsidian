// 多光标写操作的原生浏览器回归（#240）：真实键盘 + 鼠标构造多光标
// 选区（Alt+点击、Ctrl+Alt+Down、Shift+方向键逐 range 扩选、真实 Tab），
// 经宿主命令回发链路（format.command）与快速操作条按钮（真实点击）触发
// 格式操作。钉住：
// - 行内包裹类逐 range 应用（粗体/行内代码），单笔 edit.request（两条
//   changes 合一 = 一笔撤销整批回退的既定语义）
// - 结构性操作退化主 range（标题只作用主选区行），退化后多 range 形态
//   不收敛
// - 快速操作条按钮入口与命令链路同产物（两入口共用 runFormatOperation）
// - Tab 多光标行并集缩进 + Shift+Tab 回退（#120「各 range 覆盖行取并集」
//   声明的浏览器层真实 Tab 实证）
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'multicursorWrite/multicursorWrite.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/multicursorWriteFixture.ts')],
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
    console.log(`[多光标写操作][PASS] ${name}`)
  } catch (error) {
    console.log(`[多光标写操作][FAIL] ${name}: ${error.message}`)
    throw error
  } finally {
    await page.close()
  }
}

const read = (page) => page.evaluate(() => window.readEditor())
const hostMessages = (page) => page.evaluate(() => window.readHostMessages())
const editRequests = async (page) =>
  (await hostMessages(page)).filter((m) => m.kind === 'edit.request')
const pos = (page, offset) => page.evaluate(
  (at) => window.posCoords(at), offset)

/** Alt+点击在指定偏移添加一个光标（与 multicursor.mjs 同口径） */
async function altClick(page, offset) {
  const { x, y } = await pos(page, offset)
  await page.keyboard.down('Alt')
  await page.mouse.click(x, y)
  await page.keyboard.up('Alt')
}

// 文档坐标速算：
// '中文 English'：中=0 文=1 ␣=2 E=3 n=4 g=5 l=6 i=7 s=8 h=9（长 10）
// '第一行\n第二行\n第三行'：第=0..行=2 \n=3 第=4..行=6 \n=7 第=8..行=10（长 11）

await scenario('多选区粗体逐 range：两处原文各自包裹，单笔写回', { doc: '中文 English', cursor: 0 },
  async (page) => {
    // 光标 0（中文首）+ Alt+点击 3（English 首）→ Shift+Right×2 各自扩两字符
    await altClick(page, 3)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    let state = await read(page)
    assert.deepEqual(state.ranges, [{ from: 0, to: 2 }, { from: 3, to: 5 }],
      `扩选后双选区：${JSON.stringify(state.ranges)}`)
    await page.evaluate((op) => window.formatCommand(op), 'bold')
    state = await read(page)
    assert.equal(state.text, '**中文** **En**glish')
    // 逐 range 应用后形态仍为两 range；单笔 edit.request 含两条 changes
    assert.equal(state.ranges.length, 2)
    const edits = await editRequests(page)
    assert.equal(edits.length, 1, '单笔 edit.request（一笔撤销整批回退）')
    assert.equal(edits[0].changes.length, 2, '两条 range 变更合入同一笔')
  })

await scenario('空光标多光标扩词包裹：两行词各自成对', { doc: '中文 alpha\n第二 beta', cursor: 0 },
  async (page) => {
    // Ctrl+Alt+Down 在下一行同列添加光标（真实键盘）
    await page.keyboard.press('Control+Alt+ArrowDown')
    let state = await read(page)
    assert.equal(state.ranges.length, 2, '两行光标')
    await page.evaluate((op) => window.formatCommand(op), 'bold')
    state = await read(page)
    assert.equal(state.text, '**中文** alpha\n**第二** beta')
    assert.equal(state.ranges.length, 2)
    const edits = await editRequests(page)
    assert.equal(edits.length, 1)
  })

await scenario('结构性操作退化主 range：标题只作用主选区行且多光标不收敛', { doc: '第一行\n第二行\n第三行', cursor: 4 },
  async (page) => {
    await altClick(page, 9)
    // 主 range 为后加光标（9，第三行内）；Alt+点击添加的选区成为 main
    let state = await read(page)
    assert.equal(state.ranges.length, 2)
    assert.equal(state.mainIndex, 1)
    await page.evaluate((op) => window.formatCommand(op), 'heading1')
    state = await read(page)
    assert.equal(state.text, '第一行\n第二行\n# 第三行', `标题仅主行：${state.text}`)
    assert.equal(state.ranges.length, 2, '退化不收敛多光标')
    assert.equal(state.mainIndex, 1)
    const edits = await editRequests(page)
    assert.equal(edits.length, 1)
  })

await scenario('快速操作条按钮入口与命令链路同产物', { doc: '中文 English', cursor: 0 },
  async (page) => {
    await altClick(page, 3)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    // 真实鼠标打开快速操作条并点击粗体按钮（mousedown 不抢焦点）
    await page.click('.vsidian-quick-toggle')
    await page.click('.vsidian-quick-action[data-op=bold]')
    const state = await read(page)
    assert.equal(state.text, '**中文** **En**glish')
    assert.equal(state.ranges.length, 2)
    const edits = await editRequests(page)
    assert.equal(edits.length, 1, '按钮路径同样单笔写回')
  })

await scenario('行内代码多光标：一处扩词包裹与一处贴邻取消并存', { doc: 'code `x` tail', cursor: 0 },
  async (page) => {
    // 光标 0（code 词首，扩词包裹）+ Alt+点击 5（` 边界，贴邻既有行内
    // 代码 → 两态取消）——逐 range 独立判定两态分支
    await altClick(page, 5)
    await page.evaluate((op) => window.formatCommand(op), 'inlineCode')
    const state = await read(page)
    assert.equal(state.text, '`code` x tail', `两态并存：${state.text}`)
  })

await scenario('Tab 多光标行并集缩进 + Shift+Tab 回退（#120 实证）', { doc: '第一行\n第二行\n第三行', cursor: 0 },
  async (page) => {
    await page.keyboard.press('Control+Alt+ArrowDown')
    let state = await read(page)
    assert.equal(state.ranges.length, 2, '两行光标')
    await page.keyboard.press('Tab')
    state = await read(page)
    assert.equal(state.text, '  第一行\n  第二行\n第三行', `并集缩进：${state.text}`)
    // 光标随缩进平移到内容前（assoc=1：行首光标推过插入的缩进——
    // 与单测 indentEditing.test.ts 的 [2,8] 同款语义）
    assert.deepEqual(state.ranges.map((r) => r.from).sort((a, b) => a - b), [2, 8],
      '光标随缩进平移')
    await page.keyboard.press('Shift+Tab')
    state = await read(page)
    assert.equal(state.text, '第一行\n第二行\n第三行', `回退：${state.text}`)
  })

await browser.close()
console.log(`[多光标写操作] ${passed}/${total} 场景通过`)
if (passed !== total) process.exit(1)
