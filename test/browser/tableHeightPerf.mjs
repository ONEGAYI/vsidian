// #373 多列表格高度优化性能实测（独立脚本，不入 test:browser 套件清单）。
// 测量三类路径（全部页内真实计时，Chromium headless）：
// - 纯计算：benchOptimize 直调 optimizeTableHeight（冷首跑 + 热中位/均值）
// - 显示重排：真实控制器进出表格，从离开派发到发布后两帧 rAF 的时间与
//   高度变化（含 CDP 往返，作上界读数——口径在 JSON 内注明）
// - 原生输入：表内连续键入的 keydown→input 事件处理间隔（页面内计时，
//   含浏览器派发、不含 Playwright 出站开销）
// 报告写入 docs/perf/data/table-height-opt-perf.json。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'tableHeightPerf/tableHeightPerf.js')
await build({ entryPoints: [path.join(root, 'test/browser/tableHeightPerfFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

/** 生成与冻结样例同构的多列表格文档（短标签列 + 交替长列 + 周期性全短行） */
function tableDoc(cols, dataRows) {
  const labels = ['悬停文档预览', '跳转目标提示', '引用自动更新', '图片粘贴插入', '表格列宽分配', '大纲样式装饰']
  const headers = { 3: '| 功能 | 说明 | 备注 |', 5: '| 功能 | 说明 | 备注 | 序号 | 标记 |', 6: '| 功能 | 说明 | 备注 | 序号 | 标记 | 尾列 |' }
  const header = headers[cols]
  if (!header) throw new Error(`不支持的列数: ${cols}`)
  const delims = `|${' --- |'.repeat(cols)}`
  const rows = []
  for (let i = 0; i < dataRows; i++) {
    const label = labels[i % labels.length]
    if (cols === 3) {
      rows.push(i % 3 === 2
        ? `| ${label} | 短说明${i} | 备${i} |`
        : `| ${label} | 第${i}段说明文字承载较长内容驱动行高，基线下短标签列被压窄逐字折行，优化后宽度回填标签列压缩整表高度。 | 备注内容第${i}条与说明列交替驱动行高。 |`)
    } else if (cols === 5) {
      rows.push(i % 3 === 2
        ? `| ${label} | 短${i} | 备${i} | 序${i} | 号${i} |`
        : `| ${label} | 说明文字第${i}段承载较长内容驱动行高，优化后短标签列回填宽度减少折行。 | 备注内容第${i}条交替驱动行高。 | ${i} | x${i} |`)
    } else {
      rows.push(i % 3 === 2
        ? `| ${label} | 短${i} | 备${i} | 序${i} | 号${i} | 短 |`
        : `| ${label} | 说明文字第${i}段承载较长内容驱动行高，优化后短标签列回填宽度减少折行。 | 备注内容第${i}条交替驱动行高，与说明列平衡分配可用宽度。 | ${i} | x${i} | 尾 |`)
    }
  }
  return `前文\n\n${header}\n${delims}\n${rows.join('\n')}\n\n后文`
}

/** 页内纯计算输入构造（与文档形态同构；由 fixture 在页面里直调优化器） */
async function benchInPage(page, cols, dataRows, metrics, iterations) {
  return page.evaluate(({ cols, dataRows, metrics, iterations }) => {
    const labels = ['悬停文档预览', '跳转目标提示', '引用自动更新', '图片粘贴插入', '表格列宽分配', '大纲样式装饰']
    const headers = { 3: ['功能', '说明', '备注'], 5: ['功能', '说明', '备注', '序号', '标记'], 6: ['功能', '说明', '备注', '序号', '标记', '尾列'] }
    const rows = [{ header: true, cells: headers[cols] }]
    const samples = new Array(cols).fill(0)
    const widthOf = (text) => [...text].reduce((acc, ch) => acc + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0)
    rows[0].cells.forEach((cell, c) => { samples[c] = Math.max(samples[c], widthOf(cell)) })
    for (let i = 0; i < dataRows; i++) {
      const label = labels[i % labels.length]
      const cells = cols === 3
        ? (i % 3 === 2 ? [label, `短说明${i}`, `备${i}`]
          : [label, `第${i}段说明文字承载较长内容驱动行高，基线下短标签列被压窄逐字折行，优化后宽度回填标签列压缩整表高度。`, `备注内容第${i}条与说明列交替驱动行高。`])
        : (i % 3 === 2
          ? (cols === 5 ? [label, `短${i}`, `备${i}`, `序${i}`, `号${i}`] : [label, `短${i}`, `备${i}`, `序${i}`, `号${i}`, '短'])
          : (cols === 5
            ? [label, `说明文字第${i}段承载较长内容驱动行高，优化后短标签列回填宽度减少折行。`, `备注内容第${i}条交替驱动行高。`, `${i}`, `x${i}`]
            : [label, `说明文字第${i}段承载较长内容驱动行高，优化后短标签列回填宽度减少折行。`, `备注内容第${i}条交替驱动行高，与说明列平衡分配可用宽度。`, `${i}`, `x${i}`, '尾']))
      cells.forEach((cell, c) => { samples[c] = Math.max(samples[c], widthOf(cell)) })
      rows.push({ header: false, cells })
    }
    return window.benchOptimize({ rows, samples, metrics, iterations })
  }, { cols, dataRows, metrics, iterations })
}

const scenarios = [
  { cols: 3, dataRows: 100 },
  { cols: 3, dataRows: 1000 },
  { cols: 6, dataRows: 100 },
  { cols: 6, dataRows: 1000 },
  { cols: 5, dataRows: 124 }, // 恰好预算边界：125 行 × 5 列 × 32 = 20000（表头 + 124 数据行）
]

const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    chromium: browser.version(),
    platform: process.platform,
    viewport: '1280x720（Playwright 默认）',
    headless: true,
    note: '纯计算为页内 performance.now 直调；显示重排含一次 CDP 往返与 waitForFunction 轮询（上界读数）；'
      + '原生输入为页面内 keydown→input 事件间隔（含浏览器派发与 CM6 处理，不含 Playwright 出站）',
  },
  methodology: {
    pureCompute: 'benchOptimize 直调 optimizeTableHeight：冷 = 每轮新建 tokenCache 的首跑；热 = 复用全局缓存的第 2..N 轮中位/均值（N=20）',
    displayReflow: '真实控制器：点击表内格→净编辑一字→光标离开（perfLeave）→等待发布计数 +1→两帧 rAF 后读取高度；3 次取中位',
    nativeInput: '表内格点击聚焦后连续键入 20 个英文字符，页面内记录 keydown→input 时间差，取中位',
  },
  scenarios: {},
}

for (const { cols, dataRows } of scenarios) {
  const key = `cols${cols}xRows${dataRows + 1}`
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    const doc = tableDoc(cols, dataRows)
    await page.evaluate((text) => window.initPerfDoc(text), doc)
    await page.waitForFunction(() => window.perfMetrics().availablePx > 0, undefined, { timeout: 10000 })
    const metrics = await page.evaluate(() => window.perfMetrics())
    // 1) 纯计算
    const bench = await benchInPage(page, cols, dataRows, metrics, 20)
    // 2) 显示重排：进表 → 净编辑 → 离开 → 发布后两帧
    const firstCell = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
      return window.perfFocusAt(rows.length ? (window.controller.getView().state.doc
        .line(rows.length > 1 ? 3 : 1).from + 2) : 0)
    })
    void firstCell
    await page.waitForTimeout(120)
    const reflows = []
    const heights = []
    for (let rep = 0; rep < 3; rep++) {
      const statsBefore = await page.evaluate(() => window.perfStats())
      // 净编辑一字（内容指纹区别于上一版本，确保离开触发搜索）
      await page.evaluate(() => {
        const view = window.controller.getView()
        const pos = view.state.selection.main.head
        view.dispatch({ changes: { from: pos, insert: 'x' }, selection: { anchor: pos + 1 } })
      })
      const h0 = await page.evaluate(() => window.perfRead())
      const t0 = Date.now()
      await page.evaluate(() => window.perfLeave())
      await page.waitForFunction((n) => window.perfStats().searches >= n, statsBefore.searches + 1,
        { timeout: 8000 })
      await page.evaluate(() => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const dt = Date.now() - t0
      const h1 = await page.evaluate(() => window.perfRead())
      reflows.push(dt)
      heights.push({ before: h0.height, after: h1.height, rows: h1.rowCount })
      // 回表为下一轮做准备
      await page.evaluate(() => {
        const view = window.controller.getView()
        const line = view.state.doc.line(3)
        view.dispatch({ selection: { anchor: line.from + 2 } })
      })
      await page.waitForTimeout(100)
    }
    reflows.sort((a, b) => a - b)
    // 3) 原生输入：表内连续键入
    const cellBox = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
      const cell = rows[1]?.querySelector(':scope > .vsidian-table-grid-cell')
      if (!cell) return null
      const box = cell.getBoundingClientRect()
      return { x: box.x + 8, y: box.y + box.height / 2 }
    })
    await page.evaluate(() => window.armInputProbe())
    if (cellBox) {
      await page.mouse.click(cellBox.x, cellBox.y)
      await page.keyboard.type('abcdefghijklmnopqrstuvwxyzabcd'.slice(0, 20), { delay: 0 })
    }
    const inputDeltas = await page.evaluate(() => window.readInputDeltas())
    inputDeltas.sort((a, b) => a - b)
    const finalStats = await page.evaluate(() => window.perfStats())
    const finalRead = await page.evaluate(() => window.perfRead())
    report.scenarios[key] = {
      cols,
      rows: dataRows + 1,
      metrics: { availablePx: +metrics.availablePx.toFixed(1), contentPx: +metrics.contentPx.toFixed(2) },
      pureCompute: {
        origin: bench.origin,
        totalLines: bench.totalLines,
        baselineLines: bench.baselineLines,
        candidates: bench.candidates,
        cellEvals: bench.cellEvals,
        coldMs: +bench.coldMs.toFixed(2),
        warmMedianMs: +bench.warmMedianMs.toFixed(2),
        warmMeanMs: +bench.warmMeanMs.toFixed(2),
        cacheEntriesAfterFirstRun: bench.cacheEntries,
      },
      displayReflow: {
        note: '含一次离开派发（CDP evaluate 往返）+ waitForFunction 轮询 + 两帧 rAF——上界读数。'
          + 'heightBeforeAfter 只覆盖视口内已挂载行（CM6 视口裁剪），且挂载扫描可能已优化'
          + '（before 即优化后高度）；整表高度下降的几何证据在 tableCaret/blockquoteTablePaint 套件断言',
        leaveToSettleMsMedian: reflows[Math.floor(reflows.length / 2)],
        leaveToSettleMsAll: reflows,
        mountedHeightBeforeAfterPx: heights,
        publishedOptimization: finalStats.publishes > 0,
      },
      nativeInput: {
        keys: inputDeltas.length,
        keydownToInputMedianMs: inputDeltas.length ? +inputDeltas[Math.floor(inputDeltas.length / 2)].toFixed(2) : null,
        keydownToInputMaxMs: inputDeltas.length ? +inputDeltas[inputDeltas.length - 1].toFixed(2) : null,
      },
      domBudget: {
        mountedGridCells: finalRead ? finalRead.gridCells : 0,
        mountedGridRows: finalRead ? finalRead.rowCount : 0,
        totalCellsIfFlat: (dataRows + 1) * cols,
        viewportClipped: finalRead ? finalRead.gridCells < (dataRows + 1) * cols : null,
        note: 'CM6 视口裁剪：mountedGridCells 不随全表行数线性增长（100 行与 1000 行同为视口量级）',
      },
      schedulerStats: { searches: finalStats.searches, publishes: finalStats.publishes,
        discards: finalStats.discards, maxCandidates: finalStats.candidates },
      pageErrors: errors,
    }
    console.log(`[height-perf] ${key}: origin=${bench.origin} candidates=${bench.candidates} `
      + `cellEvals=${bench.cellEvals} cold=${bench.coldMs.toFixed(2)}ms warm中位=${bench.warmMedianMs.toFixed(2)}ms `
      + `reflow中位=${reflows[Math.floor(reflows.length / 2)]}ms input中位=${inputDeltas.length ? inputDeltas[Math.floor(inputDeltas.length / 2)].toFixed(2) : '-'}ms`)
  } finally {
    await page.close()
  }
}

await browser.close()
const outDir = path.join(root, 'docs/perf/data')
await mkdir(outDir, { recursive: true })
const outPath = path.join(outDir, 'table-height-opt-perf.json')
await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(`[height-perf] 报告已写入 ${path.relative(root, outPath)}`)
