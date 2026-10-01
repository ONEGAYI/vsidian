// 命中显形（#251）浏览器回归脚本：真实键盘（Ctrl+F 键入、Ctrl+D 追加、
// Esc 关面板、方向键离开）驱动生产控制器，验证查找与选词命中在装饰
// 隐藏区的最小源码回显——grid 行回源（竖线 computed display 可见）、
// 未命中行网格保持、面板关闭恢复、关面板停驻与离开恢复、块级公式回源。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'hit-reveal/main.js')
// 与 occurrence.mjs 同口径：katex css 裁掉 woff/ttf 字体引用
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
await build({ entryPoints: [path.join(root, 'test/browser/hitRevealFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml } = await buildZhLocaleIsland(root)

async function waitReveal(page, pred, label) {
  const deadline = Date.now() + 4000
  let last = null
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.readReveal())
    if (pred(last)) return last
    await page.waitForTimeout(50)
  }
  throw new Error(`等待命中显形状态超时：${label}，最后观测 ${JSON.stringify(last)}`)
}

const DOC = [
  'intro target',
  '| target | other |',
  '| --- | --- |',
  '| beta | plain |',
  '',
  'tail target',
  '',
  '$$',
  'target + 1',
  '$$',
  '',
].join('\n')

// 行序（tableRowStates 顺序 = 文档顺序）：0 表头 / 1 分隔 / 2 数据行
const row = (reveal, i) => reveal.rows[i]

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body class="vscode-light">${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initDoc(text), DOC)
  await page.evaluate(() => window.focusEditor())

  // ---- 基线：无命中集时表格为网格、公式为渲染态 ----
  let reveal = await waitReveal(page, (r) => r.rows.length === 3 && r.mathRendered > 0,
    '基线装配（3 表格行 + 公式渲染）')
  assert.equal(row(reveal, 0).grid, true, '基线：表头为网格行')
  assert.equal(row(reveal, 1).delimiter, true, '基线：分隔行隐藏（grid-delimiter）')
  assert.equal(row(reveal, 2).grid, true, '基线：数据行为网格行')
  assert.equal(row(reveal, 0).pipeDisplay, 'none', '基线：网格行竖线 display:none')

  // ---- 场景 A：搜索命中 grid 行回源；未命中行网格保持；公式回源 ----
  // 文档表格行：rows[0] 表头（含 target）、rows[1] 分隔行、rows[2] 数据行
  // （beta/plain，不含 target——未命中保持网格的对照行）
  await page.keyboard.press('Control+f')
  await page.keyboard.type('target')
  reveal = await waitReveal(page, (r) => r.findOpen &&
    row(r, 0).grid === false && row(r, 2).grid === true && r.mathRendered === 0,
    '键入 target：表头回源、未命中数据行保持网格 + 公式渲染退场')
  assert.equal(row(reveal, 0).pipeDisplay, 'inline', '命中表头行竖线回源可见（绘制层）')
  assert.equal(row(reveal, 2).pipeDisplay, 'none', '未命中数据行竖线保持隐藏（绘制层）')
  assert.equal(row(reveal, 1).delimiter, true, '未命中分隔行保持隐藏类（分隔行不含 target）')
  assert.ok(reveal.mathSource >= 1, '块级公式命中回源：源码 mark 在场')
  assert.equal(reveal.mathSrcTextVisible, true, '公式源码行文本可见')

  // ---- 场景 A2：Esc 关面板 → 行恢复网格、公式恢复渲染 ----
  await page.keyboard.press('Escape')
  reveal = await waitReveal(page, (r) => !r.findOpen && row(r, 0).grid === true &&
    row(r, 2).grid === true && r.mathRendered > 0,
    '关面板：网格与公式渲染恢复')
  assert.equal(row(reveal, 0).pipeDisplay, 'none', '恢复后竖线重新隐藏')
  // 关面板后选区停在当前命中（intro 行，非 grid 行）——表格无停驻残留
  assert.equal(row(reveal, 1).delimiter, true, '恢复后分隔行隐藏类回归')

  // ---- 场景 B：面板搜竖线 → 全表回源；Ctrl+D 追加选区落竖线 ----
  await page.keyboard.press('Control+f')
  await page.keyboard.type('|')
  reveal = await waitReveal(page, (r) => r.findOpen && r.rows.every((x) => !x.grid && !x.delimiter),
    '搜 |：含竖线的全部表格行回源（含分隔行显露）')
  assert.equal(row(reveal, 1).pipeDisplay, 'inline', '分隔行命中后源码可见（绘制层）')
  // 光标定位进表格格内（面板保持打开；词非空时 Ctrl+D 沿用面板词）：
  // 首按把空光标扩为词选区，再按追加面板词 `|` 匹配——选区落竖线
  const headerCellOffset = DOC.indexOf('other')
  await page.evaluate((offset) => window.locate(offset), headerCellOffset)
  await page.keyboard.press('Control+d')
  await page.keyboard.press('Control+d')
  const afterAdd = await page.evaluate(() => window.readEditor())
  assert.ok(afterAdd.ranges.some((r) => DOC.slice(r.from, r.to) === '|'),
    `Ctrl+D 追加选区应落在竖线字符上（实际 ${JSON.stringify(afterAdd.ranges)}）`)

  // ---- 场景 B2：Esc 关面板 → 停驻保持（选区触界显形行）；方向键离开恢复 ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  let sticky = await waitReveal(page, (r) => !r.findOpen,
    '关面板（停驻窗口）：选区所在行保持回源')
  const stickyRows = sticky.rows.filter((x) => !x.grid && !x.delimiter).length
  assert.ok(stickyRows >= 1, `关面板后选区触界的显形行应停驻保持（实际 ${stickyRows}）`)
  assert.ok(sticky.rows.some((x) => x.grid || x.delimiter),
    '未触界的行应恢复网格（零粘滞）')
  // 方向键把选区移出表格 → 停驻行恢复
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
  reveal = await waitReveal(page, (r) => r.rows.every((x) => x.grid || x.delimiter),
    '选区离开：停驻行恢复网格')
  assert.equal(row(reveal, 0).pipeDisplay, 'none', '离开后竖线恢复隐藏')

  // ---- 场景 C：硬边界再现——普通编辑选区覆盖 grid 行不显形 ----
  await page.evaluate(() => window.focusEditor())
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Shift+Control+End')
  await page.waitForTimeout(120)
  reveal = await page.evaluate(() => window.readReveal())
  assert.ok(reveal.rows.every((x) => x.grid || x.delimiter),
    '编辑全选覆盖表格：行保持网格（显形只认命中，不认编辑选区）')
  await page.keyboard.press('ArrowRight')

  assert.deepEqual(errors, [], '全程不得有页面错误')
  console.log('hitReveal: 全部场景通过（grid 回源/关面板恢复/Ctrl+D 竖线选区/停驻离开恢复/公式回源/编辑选区硬边界）')
} finally {
  await browser.close()
}
