// 引用块内表格绘制回归（#296 真机报障「一表拆两块/垂直错位/列序颠倒/
// 引用竖条丢失」）：装配生产控制器的 Playwright Chromium 真实布局断言。
// 根因（隔离实验钉住）：CM6 对行首 Decoration.replace 固有产出
// <span contenteditable="false"> 空占位，grid 行内成为 grid item 抢占
// 第一格位；容器前缀裸空隙同理。断言全部落在「用户看到的布局」：
// 同一行的格子必须落在同一水平带且按源列序横排、行块垂直堆叠、引用
// 竖条计算值真实存在——elementFromPoint 命中类断言抓不住这些错位。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'blockquoteTablePaint/blockquoteTablePaint.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/blockquoteTablePaintFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]',
  plugins: [katexFontStrip, katexMinJs] })

const scenarios = [
  ['top-control', '前文\n\n| 名称 | 数量 | 备注 |\n| --- | --- | --- |\n| 苹果 | 3 | 新鲜 |\n| 香蕉 | 5 | 特价 |\n\n后文',
    { headers: ['名称', '数量', '备注'], quote: false }],
  ['quote1', '前文\n\n> | 名称 | 数量 | 备注 |\n> | --- | --- | --- |\n> | 苹果 | 3 | 新鲜 |\n> | 香蕉 | 5 | 特价 |\n\n后文',
    { headers: ['名称', '数量', '备注'], quote: true }],
  ['quote2', '前文\n\n> > | 层级 | 深度 | 说明 |\n> > | --- | --- | --- |\n> > | 外层 | 1 | 一层引用 |\n\n后文',
    { headers: ['层级', '深度', '说明'], quote: true }],
  ['quote-list', '前文\n\n> - | 层级 | 说明 |\n>   | --- | --- |\n>   | 一级 | 缩进对齐内容列 |\n\n后文',
    { headers: ['层级', '说明'], quote: true }],
  ['quote-edgeless', '前文\n\n> 名称 | 数量\n> --- | ---\n> 苹果 | 3\n> 香蕉 | 5\n\n后文',
    { headers: ['名称', '数量'], quote: true }],
]

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const failures = []
// ---- #296 二轮真机反馈：拖选蒙版与边界导航（真实键盘/鼠标） ----
{
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    const source = '前文\n\n> | 甲 | 乙 |\n> | --- | --- |\n> | 丙 | 丁 |\n\n后文'
    await page.evaluate((text) => window.initTable(text), source)
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const read = () => page.evaluate(() => ({ ...window.readEditor(),
      region: document.querySelectorAll('.vsidian-table-region-cell').length }))
    // 1) 跨格拖选：引用表格 2×2 蒙版四格齐备（region 判等行首口径——
    //    修复前蒙版类永不并入、选区折叠钉死在锚格）
    const a = await page.locator('.vsidian-table-grid-row').nth(0)
      .locator('.vsidian-table-grid-cell').nth(0).boundingBox()
    const b = await page.locator('.vsidian-table-grid-row').nth(1)
      .locator('.vsidian-table-grid-cell').nth(1).boundingBox()
    await page.mouse.move(a.x + 14, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 14, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
    const afterDrag = await read()
    assert.equal(afterDrag.region, 4,
      `引用表格跨格拖选须建立 2×2 蒙版: ${JSON.stringify(afterDrag)}`)
    await page.mouse.click(10, 300)
    // 2) 边界出格：首格最左连按 Left 直达表格上一行（此前吞键卡死）
    const cell0 = page.locator('.vsidian-table-grid-row').nth(0)
      .locator('.vsidian-table-grid-cell').nth(0)
    await cell0.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    const afterLeft = await read()
    assert(afterLeft.head <= source.indexOf('\n\n> | 甲') + 1,
      `首格最左 Left 应跳出表格到上一行（空行行尾）: ${JSON.stringify(afterLeft)}`)
    // 3) 边界入格：空行行尾 Right 直达首格内容（跳过隐藏前缀与管道）
    await page.keyboard.press('ArrowRight')
    const afterRight = await read()
    assert.equal(afterRight.head, source.indexOf('甲'),
      `表格上方空行行尾 Right 应直达首格内容「甲」: ${JSON.stringify(afterRight)}`)
    // 4) 末格最右 Right 跳出、下方空行行首 Left 回末格内容尾
    const cellLast = page.locator('.vsidian-table-grid-row').nth(1)
      .locator('.vsidian-table-grid-cell').nth(1)
    await cellLast.click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    const afterExit = await read()
    assert.equal(afterExit.head, source.indexOf('后文') - 1,
      `末格最右 Right 应跳出表格到下一行行首: ${JSON.stringify(afterExit)}`)
    await page.keyboard.press('ArrowLeft')
    const backIn = await read()
    assert.equal(backIn.head, source.indexOf('丁') + 1,
      `下方空行行首 Left 应直达末格内容尾「丁」后: ${JSON.stringify(backIn)}`)
    assert.deepEqual(errors, [], `导航场景页面异常: ${JSON.stringify(errors)}`)
    passed++
    console.log('[引用表格绘制][PASS] 边界导航与拖选蒙版（二轮）')
  } catch (error) {
    failures.push(error)
    console.error(`[引用表格绘制][FAIL] 边界导航与拖选蒙版（二轮）: ${error.message}`)
  } finally { await page.close() }
}
// ---- #296 三轮真机反馈：拖选跨越前缀不显形 + 右键保选区 ----
{
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    const source = '前文\n\n> | 甲 | 乙 |\n> | --- | --- |\n> | 丙 | 丁 |\n\n后文'
    await page.evaluate((text) => window.initTable(text), source)
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const read = () => page.evaluate(() => window.readEditor())
    // 1) 格内起点拖选跨格：前缀保持隐藏——视觉口径断言（用户看到的）：
    //    修复前选区区间覆盖前缀触发 QuoteMark 隐藏退场，`>` 进入可见文本
    //    （「引用块符号纳入选区」）；修复后端点语义，`>` 保持被 replace
    //    隐藏。field 层前缀 mark 齐备作伴证（DOM 中该 mark 被 QuoteMark
    //    replace 优先占位，不直接出现在 DOM——断言不查 DOM 存在性）
    const a = await page.locator('.vsidian-table-grid-row').nth(0)
      .locator('.vsidian-table-grid-cell').nth(0).boundingBox()
    const b = await page.locator('.vsidian-table-grid-row').nth(1)
      .locator('.vsidian-table-grid-cell').nth(1).boundingBox()
    await page.mouse.move(a.x + 14, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 14, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
    const afterDrag = await page.evaluate(() => ({
      visibleQuote: [...document.querySelectorAll('.cm-content .vsidian-table-grid-row')]
        .some((row) => row.textContent.includes('>')),
      region: document.querySelectorAll('.vsidian-table-region-cell').length,
      prefixMarks: window.probePrefixMarks(),
    }))
    assert.equal(afterDrag.visibleQuote, false,
      `拖选跨格后引用前缀 > 不得进入可见文本（纳入选区观感）: ${JSON.stringify(afterDrag)}`)
    assert.equal(afterDrag.region, 4, `跨格拖选须建立 2×2 矩形蒙版: ${JSON.stringify(afterDrag)}`)
    assert.equal(afterDrag.prefixMarks, 2,
      `field 层前缀 mark 须齐备 2 条: ${JSON.stringify(afterDrag)}`)
    // 2) 右键落在选区内：蒙版与选区保持——修复前两条链路：右键 mousedown
    //    的 Chrome 默认行为 caret 跳移（蒙版态选区折叠在锚格，guard 按
    //    蒙版表格行区间保）；右键菜单夺焦（focusMenuDom）触发
    //    tableRegionSelection.onBlur 清矩形蒙版（「选中单元格后右键失焦
    //    选区」的字面机制——onBlur 菜单豁免保）
    const before = await read()
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    const after = await read()
    assert.equal(after.ranges, before.ranges,
      `右键在选区内须保持选区形态（range 数不 collapse）: 前 ${JSON.stringify(before)} 后 ${JSON.stringify(after)}`)
    assert.equal(await page.evaluate(() =>
      document.querySelectorAll('.vsidian-table-region-cell').length), 4,
      '右键打开菜单后矩形蒙版须保持（菜单夺焦不清选区）')
    await page.keyboard.press('Escape')
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // 菜单关闭（Esc）后蒙版仍在——还焦不清
    assert.equal(await page.evaluate(() =>
      document.querySelectorAll('.vsidian-table-region-cell').length), 4,
      '菜单关闭后矩形蒙版须保持')
    assert.deepEqual(errors, [], `三轮场景页面异常: ${JSON.stringify(errors)}`)
    passed++
    console.log('[引用表格绘制][PASS] 拖选前缀保持隐藏与右键保选区（三轮）')
  } catch (error) {
    failures.push(error)
    console.error(`[引用表格绘制][FAIL] 拖选前缀保持隐藏与右键保选区（三轮）: ${error.message}`)
  } finally { await page.close() }
}
try {
  for (const [name, source, expect] of scenarios) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
      await page.addScriptTag({ path: bundle })
      await page.evaluate((text) => window.initTable(text), source)
      await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const paint = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.cm-content .vsidian-table-grid-row')]
        return rows.map((row) => ({
          cls: row.className,
          rect: row.getBoundingClientRect().toJSON(),
          shadow: getComputedStyle(row).boxShadow,
          padding: getComputedStyle(row).paddingLeft,
          display: getComputedStyle(row).display,
          cells: [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')].map((c) => ({
            text: c.textContent.trim(),
            box: c.getBoundingClientRect().toJSON(),
          })),
        }))
      })
      const dataRows = paint.filter((row) => row.cells.length > 0)
      assert(dataRows.length >= 2, `${name}: 可见网格行应有表头与数据行，实际 ${dataRows.length}`)
      // 1) 同一行内所有格子落在同一水平带（±1px），且按 x 递增排列——
      //    前缀占位会把格子挤 wrap 到第二排（真机断裂形态）
      for (const row of dataRows) {
        const tops = row.cells.map((c) => c.box.y)
        assert(Math.max(...tops) - Math.min(...tops) < 1,
          `${name}: 同行格子必须同水平带（列被挤 wrap 即断裂）: ${JSON.stringify(row.cells.map((c) => [c.text, +c.box.x.toFixed(1), +c.box.y.toFixed(1)]))}`)
        const xs = row.cells.map((c) => c.box.x)
        assert(xs.every((x, i) => i === 0 || x > xs[i - 1]),
          `${name}: 同行格子必须从左到右排列: ${JSON.stringify(xs)}`)
      }
      // 2) 列序 = 源列序（首列文本 x 最小）
      const headerTexts = dataRows[0].cells.map((c) => c.text).join('|')
      assert(headerTexts === expect.headers.join('|'),
        `${name}: 表头列序须为 ${JSON.stringify(expect.headers)}，实际 ${JSON.stringify(headerTexts)}`)
      // 3) 行块垂直堆叠：各行首格 x 一致、行 y 严格递增、行高不因格 wrap 翻倍
      const firstX = dataRows.map((r) => r.cells[0].box.x)
      assert(Math.max(...firstX) - Math.min(...firstX) < 1,
        `${name}: 各行首格须左对齐（列边界跨行一致）: ${JSON.stringify(firstX)}`)
      const rowYs = dataRows.map((r) => r.rect.y)
      assert(rowYs.every((y, i) => i === 0 || y > rowYs[i - 1]),
        `${name}: 网格行必须垂直堆叠: ${JSON.stringify(rowYs)}`)
      const rowHeights = dataRows.map((r) => r.rect.height)
      const cellH = Math.max(...dataRows[0].cells.map((c) => c.box.height))
      assert(rowHeights.every((h) => h < cellH * 1.8),
        `${name}: 行高不得因格 wrap 翻倍（应约 ${cellH.toFixed(0)}px）: ${JSON.stringify(rowHeights)}`)
      // 4) 引用竖条与内容缩进（引用表格行与普通引用行同观感）
      if (expect.quote) {
        for (const row of dataRows) {
          assert(row.cls.includes('vsidian-quote-line'), `${name}: 引用表格行须挂引用行类: ${row.cls}`)
          assert(row.cls.includes('HyperMD-quote'), `${name}: 引用表格行须保留 HyperMD-quote 兼容别名: ${row.cls}`)
          assert(row.shadow.includes('125, 126, 127') || /rgb\(/.test(row.shadow) && !row.shadow.includes('none'),
            `${name}: 引用表格行须绘制竖条（computed box-shadow）: ${row.shadow}`)
          assert(parseFloat(row.padding) > 0, `${name}: 引用表格行须保留内容缩进: ${row.padding}`)
        }
      }
      // 5) 格内文字真实可见（elementFromPoint 命中）
      const hit = await page.evaluate(() => {
        const cell = document.querySelectorAll('.cm-content .vsidian-table-grid-row .vsidian-table-grid-cell')[1]
        const box = cell.getBoundingClientRect()
        const el = document.elementFromPoint(box.x + 6, box.y + box.height / 2)
        return el?.textContent.trim() ?? ''
      })
      assert(hit.length > 0, `${name}: 格内文字须经 elementFromPoint 命中`)
      assert.deepEqual(errors, [], `${name}: 页面异常 ${JSON.stringify(errors)}`)
      await page.screenshot({ path: artifactPath(root, `bq-paint-${name}.png`), fullPage: true })
      passed++
      console.log(`[引用表格绘制][PASS] ${name}`)
    } catch (error) {
      failures.push(error)
      console.error(`[引用表格绘制][FAIL] ${name}: ${error.message}`)
    } finally { await page.close() }
  }
} finally { await browser.close() }
if (failures.length) throw new AggregateError(failures, '引用块内表格绘制回归失败')
console.log(`[引用表格绘制] ${passed}/${scenarios.length} 场景通过`)
