// 可读行宽回归套件（#174 bug 修复 + #175 功能）：真实 Chromium + 生产
// 控制器 + 产物 CSS，断言用户看到的东西（AGENTS 视觉层断言）——正文列
// 实际渲染宽度、水平位置与设置/片段的生效次序：
//   A1 默认（0=铺满）双模式铺满可用宽度，无隐形钳制（bug #174 修复本体）
//   A2 行号关闭时两模式正文宽严格一致（模式一致性基线）
//   A3 限宽档（600px）双模式列宽 = 设定值且在主区居中（左缝≈右缝）
//   A4 侧栏开合：铺满档实时避让；限宽档居中跟随（动画后测量）
//   A5 Live 行号列贴正文列左缘随列居中（Q5 共识）
//   A6 优先序：0 档片段常规规则生效；非 0 档设置优先、片段 !important 可覆盖
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'readingWidthProbe/readingWidthProbe.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingWidthProbeFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'],
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}
/** 容差：居中缝隙 ±4px，宽度差 ±2px（子像素与取整余量） */
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  const LONG = '这是一段足够长的正文文字用来撑满可用宽度并触发折行。'.repeat(12)
  const DOC = `---\ntitle: 宽度\n---\n\n# 标题\n\n${LONG}\n\n${LONG}\n\n| 列一 | 列二 | 列三 | 列四 | 列五 |\n| --- | --- | --- | --- | --- |\n| 数据 | 数据 | 数据 | 数据 | 数据 |\n\n\`\`\`js\nconst width = 'clamped'\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  A --> B --> C\n\`\`\`\n`
  await page.evaluate((text) => window.initReadingWidth(text), DOC)

  /** 阅读侧观测：容器内容区与首个段落块的几何 */
  const measureReading = () => page.evaluate(() => {
    const view = document.querySelector('.vsidian-view-reading')
    const p = document.querySelector('.vsidian-reading-block p')
    if (!view || !p) return null
    const cs = getComputedStyle(view)
    const vr = view.getBoundingClientRect()
    const r = p.getBoundingClientRect()
    const padL = Number.parseFloat(cs.paddingLeft)
    const padR = Number.parseFloat(cs.paddingRight)
    const contentLeft = vr.left + padL
    const contentW = view.clientWidth - padL - padR
    return { contentW, blockW: r.width, blockLeft: r.left,
      gapL: r.left - contentLeft, gapR: contentLeft + contentW - (r.left + r.width) }
  })
  /** Live 侧观测：正文列与行号列的几何。#32 契约：行号列与正文间有固定
   *  间距（--vsidian-ln-gap，随 UI 字号），限宽档居中的单位是
   *  [行号列 + 间距 + 正文列] 整组；gutterLeft 是组左缘 */
  const measureLive = () => page.evaluate(() => {
    const content = document.querySelector('.cm-content')
    const gutters = document.querySelector('.cm-gutters')
    const scroller = document.querySelector('.cm-scroller')
    if (!content || !scroller) return null
    const c = content.getBoundingClientRect()
    const g = gutters?.getBoundingClientRect()
    // #414 起 ln-gap 间距挂 .cm-lineNumbers（gutters 内常驻零宽箭头列，
    // margin 留容器会让行号关态正文基线多出一段）——间距测量改以行号列
    // 右缘为锚（视觉语义不变：行号数字右缘到正文左缘）
    const ln = document.querySelector('.cm-lineNumbers')
    const lnr = ln?.getBoundingClientRect()
    const sr = scroller.getBoundingClientRect()
    const cs = getComputedStyle(scroller)
    const padL = Number.parseFloat(cs.paddingLeft)
    const padR = Number.parseFloat(cs.paddingRight)
    const contentLeft = sr.left + padL
    const contentW = scroller.clientWidth - padL - padR
    return { contentW, colW: c.width, colLeft: c.left, colRight: c.right,
      gutterLeft: g ? g.left : null, gutterRight: g ? g.right : null, gutterW: g ? g.width : 0,
      spacing: lnr ? c.left - lnr.right : 0,
      gapL: (g ? g.left : c.left) - contentLeft, gapR: contentLeft + contentW - c.right }
  })

  // —— A1/A2：默认（0 = 铺满）——
  await page.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 0 }))
  await page.waitForSelector('.cm-line')
  let live = await measureLive()
  // 铺满态（#32 语义）：行号组贴容器左缘（组左缝 0，与旧布局一致）、
  // 正文右缘贴可用区右缘、行号-正文间距保留
  check('A1 Live 铺满（组贴左缘、正文贴右缘、间距保留）',
    Math.abs(live.gapR) < 2 && Math.abs(live.gapL) < 2 && live.spacing > 0,
    `右缝=${live.gapR.toFixed(1)} 组左缝=${live.gapL.toFixed(1)} 行号列宽=${live.gutterW.toFixed(1)} 间距=${live.spacing.toFixed(1)}`)
  const fillSpacing = live.spacing
  await page.evaluate(() => window.setRwMode('reading'))
  await page.waitForSelector('.vsidian-reading-block p')
  let reading = await measureReading()
  check('A1 阅读铺满（bug #174：无 760px 隐形钳制）',
    Math.abs(reading.blockW - reading.contentW) < 2,
    `块宽=${reading.blockW.toFixed(1)} 可用=${reading.contentW.toFixed(1)}`)

  // A2：行号关闭后两模式正文宽严格一致（一致性基线）
  await page.evaluate(() => window.setRwSettings({ 'editor.lineNumbers': false, 'editor.readableLineWidth': 0 }))
  await page.evaluate(() => window.setRwMode('live'))
  await page.waitForSelector('.cm-line')
  live = await measureLive()
  check('A2 行号关闭：Live 正文列占满（无行号列）',
    Math.abs(live.colW - live.contentW) < 2 && live.gutterW === 0,
    `列宽=${live.colW.toFixed(1)} 可用=${live.contentW.toFixed(1)} 行号列宽=${live.gutterW}`)
  const liveFill = live.colW
  await page.evaluate(() => window.setRwMode('reading'))
  await page.waitForSelector('.vsidian-reading-block p')
  reading = await measureReading()
  check('A2 行号关闭：两模式正文宽一致',
    Math.abs(reading.blockW - liveFill) < 2,
    `阅读=${reading.blockW.toFixed(1)} live=${liveFill.toFixed(1)}`)

  // —— A3/A5：限宽档 600px（行号恢复默认开启走新一轮快照）——
  await page.evaluate(() => window.setRwSettings({ 'editor.lineNumbers': true, 'editor.readableLineWidth': 600 }))
  reading = await measureReading()
  check('A3 阅读限宽 600 居中', Math.abs(reading.blockW - 600) < 2 && Math.abs(reading.gapL - reading.gapR) < 4,
    `块宽=${reading.blockW.toFixed(1)} 左缝=${reading.gapL.toFixed(1)} 右缝=${reading.gapR.toFixed(1)}`)
  // A3b（#206）：标题块与段落块左缘一致——heading 装饰类直接挂在块 div 上，
  // 若其规则声明水平 margin（简写置 0），同特异性源序在后会覆盖块居中 auto，
  // 限宽档下标题贴左而正文居中（铺满档 auto 与 0 等价，不可见）
  const blockEdges = await page.evaluate(() => {
    const L = (s) => document.querySelector(s)?.getBoundingClientRect().left ?? null
    return { heading: L('.vsidian-reading-heading-1'), paragraph: L('.vsidian-reading-paragraph') }
  })
  check('A3b 限宽档标题块与段落块左缘一致（#206）',
    blockEdges.heading !== null && blockEdges.paragraph !== null
      && Math.abs(blockEdges.heading - blockEdges.paragraph) < 2,
    `标题=${blockEdges.heading?.toFixed(1)} 段落=${blockEdges.paragraph?.toFixed(1)}`)
  await page.evaluate(() => window.setRwMode('live'))
  await page.waitForSelector('.cm-line')
  live = await measureLive()
  check('A3 Live 限宽 600 整组居中（行号列+间距+正文）',
    Math.abs(live.colW - 600) < 2 && Math.abs(live.gapL - live.gapR) < 2,
    `列宽=${live.colW.toFixed(1)} 组左缝=${live.gapL.toFixed(1)} 右缝=${live.gapR.toFixed(1)}`)
  check('A5 行号列随列移动（不钉死容器左缘）且间距不变',
    live.gapL > 50 && Math.abs(live.spacing - fillSpacing) < 1,
    `组左缝=${live.gapL.toFixed(1)} 行号-正文间距=${live.spacing.toFixed(1)}（铺满态 ${fillSpacing.toFixed(1)}）`)

  // —— A4：侧栏开合（铺满档避让 + 限宽档居中跟随）——
  await page.evaluate(() => window.setRwMode('reading'))
  await page.waitForSelector('.vsidian-reading-block p')
  await page.evaluate(() => window.setRwSidebar(true))
  await page.waitForTimeout(250)
  reading = await measureReading()
  check('A4 侧栏展开·限宽档仍居中', Math.abs(reading.gapL - reading.gapR) < 4,
    `左缝=${reading.gapL.toFixed(1)} 右缝=${reading.gapR.toFixed(1)} 可用=${reading.contentW.toFixed(1)}`)
  await page.evaluate(() => window.setRwSidebar(false))
  await page.evaluate(() => window.setRwSettings({ 'editor.lineNumbers': true, 'editor.readableLineWidth': 0 }))
  await page.waitForTimeout(250)
  await page.evaluate(() => window.setRwSidebar(true))
  await page.waitForTimeout(250)
  reading = await measureReading()
  check('A4 侧栏展开·铺满档避让到新可用宽',
    Math.abs(reading.blockW - reading.contentW) < 2,
    `块宽=${reading.blockW.toFixed(1)} 可用=${reading.contentW.toFixed(1)}（1280 视口收侧栏后）`)
  await page.evaluate(() => window.setRwSidebar(false))

  // —— A7：宽块同钳制（Q6：表格、代码块、frontmatter 卡、Mermaid 随正文列限宽）——
  await page.evaluate(() => window.setRwSettings({ 'editor.lineNumbers': true, 'editor.readableLineWidth': 600 }))
  await page.waitForTimeout(250) // 侧栏关闭过渡与重排稳定后再量
  const wideBlocks = await page.evaluate(() => {
    const view = document.querySelector('.vsidian-view-reading')
    const table = view?.querySelector('.vsidian-reading-table table')
    const pre = view?.querySelector('pre')
    const fm = view?.querySelector('.vsidian-reading-frontmatter .vsidian-fm-table')
    const mermaid = view?.querySelector('.vsidian-reading-mermaid')
    return {
      tableW: table?.getBoundingClientRect().width ?? 0,
      tableLeft: table?.getBoundingClientRect().left ?? 0,
      preW: pre?.getBoundingClientRect().width ?? 0,
      fmW: fm?.getBoundingClientRect().width ?? 0,
      mermaidW: mermaid?.getBoundingClientRect().width ?? 0,
      mermaidLeft: mermaid?.getBoundingClientRect().left ?? 0,
      paragraphLeft: view?.querySelector('.vsidian-reading-paragraph')?.getBoundingClientRect().left ?? 0,
    }
  })
  check('A7 宽表格钳制进正文列（600）', wideBlocks.tableW <= 610 && wideBlocks.tableLeft > 300,
    `表宽=${wideBlocks.tableW.toFixed(1)} 左缘=${wideBlocks.tableLeft.toFixed(1)}（列内居中）`)
  check('A7 代码块钳制进正文列（600）', wideBlocks.preW <= 610 && wideBlocks.preW > 0,
    `代码块宽=${wideBlocks.preW.toFixed(1)}`)
  check('A7 frontmatter 卡钳制进正文列（600）', wideBlocks.fmW <= 601 && wideBlocks.fmW > 0,
    `FM 表宽=${wideBlocks.fmW.toFixed(1)}（border-box 后不超列宽）`)
  check('A7 Mermaid 块钳制进正文列（600）', wideBlocks.mermaidW <= 610 && wideBlocks.mermaidW > 0,
    `Mermaid 块宽=${wideBlocks.mermaidW.toFixed(1)}`)
  // A7b（2026-10 修复）：mermaid 块与段落块左缘一致——mermaid 块类规则
  // #60 起 margin: 0（纵向交内层容器）与块基类同挂在块 div 上且源序在后，
  // 若简写不含水平 auto，同特异性下覆盖块居中 auto，限宽档 mermaid 贴左
  // 而正文居中（铺满档 auto 与 0 等价不可见；#206 标题块同族缺陷的变体）
  check('A7b 限宽档 Mermaid 块与段落块左缘一致（居中不丢）',
    Math.abs(wideBlocks.mermaidLeft - wideBlocks.paragraphLeft) < 2,
    `Mermaid=${wideBlocks.mermaidLeft.toFixed(1)} 段落=${wideBlocks.paragraphLeft.toFixed(1)}`)
  await page.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 0 }))

  // —— A8：长文档虚拟化重排（规格注意点 3：宽度变更 → 折行高度变 → 高度表重算）——
  {
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors2 = []
    page2.on('pageerror', (error) => errors2.push(error.message))
    await page2.setContent('<div id="app"></div>')
    await page2.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page2.addScriptTag({ path: output })
    const PARAS = Array.from({ length: 150 }, (_, i) => `第${i}段 ${LONG}`).join('\n\n')
    await page2.evaluate((text) => window.initReadingWidth(text), PARAS)
    await page2.evaluate(() => window.setRwMode('reading'))
    await page2.waitForSelector('.vsidian-reading-block p')
    const readState = () => page2.evaluate(() => {
      const view = document.querySelector('.vsidian-view-reading')
      const blocks = [...view.querySelectorAll('.vsidian-reading-block')]
      const first = blocks.find((b) => {
        const r = b.getBoundingClientRect()
        return r.bottom > 0 && r.top < innerHeight
      })
      return { scrollH: view.scrollHeight, scrollTop: view.scrollTop, visibleW: first?.getBoundingClientRect().width ?? 0, mounted: blocks.length }
    })
    await page2.evaluate(() => { document.querySelector('.vsidian-view-reading').scrollTop = 6000 })
    await page2.waitForTimeout(300)
    await page2.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 600 }))
    await page2.waitForTimeout(400)
    const narrow = await readState()
    check('A8 长文限宽：视口内已挂载块钳制到 600（虚拟化路径）',
      Math.abs(narrow.visibleW - 600) < 2 && narrow.mounted < 150,
      `可见块宽=${narrow.visibleW.toFixed(1)} 已挂载=${narrow.mounted}/150（虚拟化激活）`)
    await page2.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 0 }))
    await page2.waitForTimeout(400)
    const filled = await readState()
    check('A8 宽度切铺满：总高变短（折行减少）且可见块铺满',
      filled.scrollH < narrow.scrollH && filled.visibleW > 1000,
      `总高 ${narrow.scrollH} → ${filled.scrollH}，可见块宽=${filled.visibleW.toFixed(1)}`)
    await page2.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 600 }))
    await page2.waitForTimeout(400)
    const back = await readState()
    check('A8 切回限宽：高度表稳定复原', Math.abs(back.scrollH - narrow.scrollH) < 40,
      `总高 ${narrow.scrollH} → ${back.scrollH}（往返一致）`)
    check('A8 长文重排无脚本错误', errors2.length === 0, JSON.stringify(errors2))
    await page2.close()
  }

  // —— A6：优先序（设置 0 → 片段常规规则；设置 900 → 设置优先；!important 可覆盖）——
  const snippet = await page.addStyleTag({ content: '#app { --vsidian-reading-max-width: 700px; }' })
  await page.waitForTimeout(50)
  reading = await measureReading()
  check('A6 铺满档：片段常规规则生效（CSS 定制空间）', Math.abs(reading.blockW - 700) < 2,
    `块宽=${reading.blockW.toFixed(1)}`)
  await page.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 900 }))
  reading = await measureReading()
  check('A6 限宽档：设置优先于片段常规规则', Math.abs(reading.blockW - 900) < 2,
    `块宽=${reading.blockW.toFixed(1)}`)
  await snippet.evaluate((el) => { el.textContent = '#app { --vsidian-reading-max-width: 700px !important; }' })
  await page.waitForTimeout(50)
  reading = await measureReading()
  check('A6 限宽档：片段 !important 可覆盖设置', Math.abs(reading.blockW - 700) < 2,
    `块宽=${reading.blockW.toFixed(1)}`)
  // A6″ 差异化定制：按视图作用域声明的后代级片段常规规则即可单独覆盖
  // 一侧（Q7 双变量方案的存在理由；继承链比挂载根内联更近）
  await snippet.evaluate((el) => { el.textContent = '.vsidian-view-live { --vsidian-live-preview-max-width: 640px; }' })
  await page.evaluate(() => window.setRwMode('live'))
  await page.waitForSelector('.cm-line')
  live = await measureLive()
  check('A6 Live 侧片段单独覆盖（后代级常规规则，无需 !important）',
    Math.abs(live.colW - 640) < 2,
    `列宽=${live.colW.toFixed(1)}（设置 900，Live 作用域片段 640）`)
  await page.evaluate(() => window.setRwMode('reading'))
  await page.waitForSelector('.vsidian-reading-block p')
  reading = await measureReading()
  check('A6 阅读侧不受 Live 作用域片段影响（两模式差异化成立）',
    Math.abs(reading.blockW - 900) < 2,
    `块宽=${reading.blockW.toFixed(1)}`)
  await snippet.evaluate((el) => { el.textContent = '' })
  await page.evaluate(() => window.setRwSettings({ 'editor.readableLineWidth': 0 }))

  // 宽代码标识符不应把表格撑出阅读列；缩窗后短列仍小于内容重的列。
  {
    const tablePage = await browser.newPage({ viewport: { width: 960, height: 720 } })
    const tableErrors = []
    tablePage.on('pageerror', error => tableErrors.push(error.message))
    await tablePage.setContent('<div id="app"></div>')
    await tablePage.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await tablePage.addScriptTag({ path: output })
    const source = [
      '| # | 阶段 | 操作 | 输入 | 输出 |',
      '| --- | --- | --- | --- | --- |',
      '| 1 | 采样 | 波形 / `record_signal_across_time_window` | 观测结果 + 波形 | `waveform_capture_with_high_resolution` |',
      '| 2 | 分析 | 运行 / `estimate_recovery_characteristics` | 观测结果 | `recovery_characteristics_for_each_sample` |',
      '| 3 | 结果核对 | 统计 / `validate_voltage_drop_threshold` | 实测数据 | `validated_threshold_and_confidence_bounds` |',
    ].join('\n')
    await tablePage.evaluate(source => {
      window.initReadingWidth(source)
      window.setRwMode('reading')
    }, source)
    const table = tablePage.locator('.vsidian-reading-table > table')
    const measure = () => table.evaluate(table => {
      const cells = [...table.rows[1].cells]
      const last = cells.at(-1).getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(cells.at(-1).querySelector('code'))
      const textRects = [...range.getClientRects()]
      const block = table.parentElement.getBoundingClientRect()
      return {
        overflow: Math.max(last.right - block.right, table.scrollWidth - table.clientWidth,
          table.parentElement.scrollWidth - table.parentElement.clientWidth),
        widths: cells.map(cell => cell.getBoundingClientRect().width),
        wrappedInside: textRects.length > 1 && textRects.every(rect => rect.right <= last.right + 1),
      }
    })
    const settle = () => tablePage.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await settle()
    const wide = await measure()
    await tablePage.setViewportSize({ width: 500, height: 720 })
    await settle()
    const narrow = await measure()
    check('阅读表格窄窗不横向溢出，长行内代码在格内折行',
      narrow.overflow < 2 && narrow.wrappedInside,
      JSON.stringify(narrow))
    check('阅读表格随窗口重新分配列宽，长内容列比序号列宽',
      narrow.widths[4] < wide.widths[4] - 20 && narrow.widths[4] > narrow.widths[0] + 12,
      JSON.stringify({ before: wide.widths, after: narrow.widths }))
    await table.screenshot({ path: artifactPath(root, 'reading-table-narrow.png') })
    await tablePage.setViewportSize({ width: 960, height: 720 })
    await settle()
    const restored = await measure()
    check('窗口恢复后，阅读表格列宽随之恢复',
      restored.widths.every((width, index) => Math.abs(width - wide.widths[index]) < 2),
      JSON.stringify(restored.widths))
    check('阅读表格重排无脚本错误', tableErrors.length === 0, JSON.stringify(tableErrors))
    await tablePage.close()
  }

  // 阅读表格（列表项内和独立块）继承同一主题下 Live 表格的色彩与线条。
  {
    const tablePage = await browser.newPage({ viewport: { width: 800, height: 480 } })
    await tablePage.setContent('<!doctype html><body class="vscode-light"><div id="app"></div></body>')
    // Light+ 主题的相关 webview 变量与宿主 code 默认规则。
    await tablePage.addStyleTag({ content: `body {
      --vscode-editor-foreground: #000;
      --vscode-editor-background: #fff;
      --vscode-panel-border: rgba(128, 128, 128, 0.35);
      --vscode-symbolIcon-fieldForeground: #007acc;
      --vscode-textPreformat-foreground: #a31515;
      --vscode-textCodeBlock-background: rgba(220, 220, 220, 0.4);
    } code { color: var(--vscode-textPreformat-foreground); }` })
    await tablePage.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await tablePage.addScriptTag({ path: output })
    const rows = [
      '| 路径 | 远端 | 分支 |', '| --- | --- | --- |',
      '| `packages/core/` | `https://git.example.test/tools/core.git` | `feature/reading-table` |',
    ]
    const nativeTable = '<table><tr><th>原生表头</th></tr><tr><td><code>html</code></td></tr></table>'
    const source = ['1. 克隆仓库：', '', `   | 路径 | 远端 | ${nativeTable} |`, ...rows.slice(1).map(row => `   ${row}`),
      '2. 安装 `bun`。', '', ...rows].join('\n')
    await tablePage.evaluate(source => window.initReadingWidth(source), source)
    const live = await tablePage.locator('.vsidian-table-cell-header').first().evaluate(header => {
      const cell = document.querySelector('.vsidian-table-grid-row:not(.vsidian-table-header-line) .vsidian-inline-code')
        .closest('.vsidian-table-grid-cell')
      return {
        header: getComputedStyle(header).color,
        headerBg: getComputedStyle(header.closest('.vsidian-table-grid-cell')).backgroundColor,
        separator: getComputedStyle(header.closest('.vsidian-table-header-line')).boxShadow,
        border: getComputedStyle(cell).borderRight,
        code: getComputedStyle(cell.querySelector('.vsidian-inline-code')).color,
      }
    })
    await tablePage.evaluate(() => window.setRwMode('reading'))
    await tablePage.waitForSelector('.vsidian-view-reading .vsidian-reading-list ol > li > table')
    const styles = await tablePage.locator('.vsidian-view-reading table[data-vsidian-table-from]').evaluateAll(tables => tables.map(table => {
      const header = getComputedStyle(table.rows[0].cells[0])
      const cell = getComputedStyle(table.rows[1].cells[0])
      return {
        collapse: getComputedStyle(table).borderCollapse,
        header: header.color,
        headerBg: header.backgroundColor,
        separator: header.boxShadow,
        border: cell.borderRight,
        code: getComputedStyle(table.rows[1].cells[0].querySelector('code')).color,
        padding: cell.paddingLeft,
      }
    }))
    check('阅读列表内和独立表格的表头、边框及代码字色同主题 Live 表格一致',
      live.header === 'rgb(0, 122, 204)' && styles.length === 2 && styles.every(style =>
        style.collapse === 'collapse' && style.padding === '12px' &&
        Object.entries(live).every(([key, value]) => style[key] === value)), JSON.stringify({ live, reading: styles }))
    const proseCode = await tablePage.locator('.vsidian-reading-list ol > li:nth-child(2) code')
      .evaluate(code => getComputedStyle(code).color)
    check('表格外的阅读行内代码保留宿主原色', proseCode === 'rgb(163, 21, 21)', proseCode)
    await tablePage.locator('.vsidian-reading-list').screenshot({ path: artifactPath(root, 'reading-list-table.png') })
    const nested = tablePage.locator('.vsidian-view-reading li > table')
    const native = await nested.locator('table').evaluate(table => ({
      header: getComputedStyle(table.rows[0].cells[0]).color,
      separator: getComputedStyle(table.rows[0].cells[0]).boxShadow,
      border: getComputedStyle(table.rows[1].cells[0]).borderRightWidth,
      code: getComputedStyle(table.querySelector('code')).color,
    }))
    check('表头内原生 HTML 表格不继承外层 Markdown 表格的网格或强调色',
      native.header === 'rgb(0, 0, 0)' && native.separator === 'none' &&
        native.border === '0px' && native.code === 'rgb(163, 21, 21)', JSON.stringify(native))
    const mixedSeparator = await nested.locator(':scope > thead > tr > th').last().evaluate(cell => getComputedStyle(cell).boxShadow)
    check('含原生表格的表头仍保留外层表头下沿分隔线', mixedSeparator === live.separator, mixedSeparator)
    await tablePage.addStyleTag({ content: '.markdown-preview-view li > table td { border: none; padding: 2px; }' })
    const overridden = await nested.locator('td').first().evaluate(cell => {
      const style = getComputedStyle(cell)
      return { border: style.borderRightWidth, padding: style.paddingLeft }
    })
    check('原有 CSS 片段仍可覆盖列表表格格线和留白',
      overridden.border === '0px' && overridden.padding === '2px', JSON.stringify(overridden))
    await tablePage.close()
  }

  // 保持单行：读到长表中段，不滚到表底也能操作真实的水平滚动条。
  {
    const tall = await browser.newPage({ viewport: { width: 500, height: 520 } })
    await tall.setContent('<div id="app"></div>')
    await tall.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await tall.addScriptTag({ path: output })
    const source = [
      '| 序号 | 第一个长字段 | 第二个长字段 |', '| --- | --- | --- |',
      ...Array.from({ length: 52 }, (_, n) =>
        `| ${n + 1} | ` + '`temperature_recovery_across_multiple_sensor_channels` | `sampling_status_at_the_end_of_the_observation_window` |'),
      ...Array.from({ length: 24 }, (_, n) => `\n表后正文 ${n + 1}`),
    ].join('\n')
    await tall.evaluate(source => {
      window.initReadingWidth(source)
      window.setRwMode('reading')
      window.setRwSettings({ 'editor.readingTableLayout': 'single-line' })
    }, source)
    const reading = tall.locator('.vsidian-view-reading').first()
    const table = reading.locator('table').first()
    const bar = tall.locator('.vsidian-reading-scrollbar')
    const present = await tall.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const view = document.querySelector('.vsidian-view-reading')
      const table = view.querySelector('table')
      const bar = document.querySelector('.vsidian-reading-scrollbar')
      const bottom = view.getBoundingClientRect().bottom
      return {
        nowrap: getComputedStyle(table.rows[1].cells[1]).whiteSpace === 'nowrap',
        overflow: table.scrollWidth - table.clientWidth,
        taller: table.getBoundingClientRect().bottom > bottom + 100,
        sticky: !!bar && !bar.hidden && Math.abs(bar.getBoundingClientRect().bottom - bottom) < 2,
      }
    })
    check('保持单行时，长表格的横向滚动条固定在阅读视口底部',
      present.nowrap && present.overflow > 50 && present.taller && present.sticky, JSON.stringify(present))
    if (present.sticky) {
      await reading.evaluate(el => { el.scrollTop = 400 })
      await tall.evaluate(() => new Promise(requestAnimationFrame))
      const rect = await bar.boundingBox()
      const viewRect = await reading.boundingBox()
      check('表格纵滚到中段，滚动条仍在视口下端',
        Math.abs(rect.y + rect.height - viewRect.y - viewRect.height) < 2, JSON.stringify(rect))
      await tall.mouse.move(rect.x + 20, rect.y + rect.height / 2)
      await tall.mouse.down()
      await tall.mouse.move(rect.x + 140, rect.y + rect.height / 2, { steps: 6 })
      await tall.mouse.up()
      const positions = await tall.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve([
        document.querySelector('.vsidian-reading-scrollbar').scrollLeft,
        document.querySelector('.vsidian-view-reading table').scrollLeft,
      ]))))
      check('拖动底部滚动条会移动表格正文', positions[0] > 50 && positions[0] === positions[1],
        JSON.stringify(positions))
      await tall.screenshot({ path: artifactPath(root, 'reading-table-sticky-scroll.png') })
      await table.evaluate(el => { el.scrollLeft = 64 })
      await tall.waitForFunction(() => document.querySelector('.vsidian-reading-scrollbar').scrollLeft === 64)
      await reading.evaluate(el => { el.scrollTop = el.scrollHeight })
      await bar.waitFor({ state: 'hidden' })
      await reading.evaluate(el => { el.scrollTop = 0 })
      await bar.waitFor()
      await tall.evaluate(() => window.setRwSettings({ 'editor.readingTableLayout': 'wrap' }))
      await bar.waitFor({ state: 'hidden' })
      const after = await table.evaluate(el => el.scrollWidth - el.clientWidth)
      check('切回折行时表格重新适宽并隐藏滚动条', after < 2, `溢出=${after}`)
    }
    await tall.close()
  }

  // 两张超宽表同屏：先点击 B，再送达 A 刚排队的 scroll，底栏仍属于 B。
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 520 } })
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })
    const source = [65, 94].map(length => `| 编号 | 值 |\n| --- | --- |\n| 1 | ${'x'.repeat(length)} |`).join('\n\n间隔\n\n')
    await page.evaluate(text => {
      window.initReadingWidth(text)
      window.setRwMode('reading')
      window.setRwSettings({ 'editor.readingTableLayout': 'single-line' })
    }, source)
    const bar = page.locator('.vsidian-reading-scrollbar')
    await bar.waitFor()
    const actual = await page.evaluate(async () => {
      const [a, b] = document.querySelectorAll('.vsidian-view-reading table')
      a.scrollLeft = 20
      b.rows[0].cells[0].dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' }))
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const bar = document.querySelector('.vsidian-reading-scrollbar')
      return { a: a.scrollWidth, b: b.scrollWidth, target: bar.scrollWidth, left: bar.scrollLeft }
    })
    check('旧表迟到的滚动事件不抢回底栏',
      actual.a !== actual.b && actual.target === actual.b && actual.left === 0, JSON.stringify(actual))

    // 保留片段给表格设置的右到左排版；浏览器在 RTL 下使用负的 scrollLeft。
    await page.evaluate(() => {
      const uri = URL.createObjectURL(new Blob(['#app .vsidian-reading-table table { direction: rtl; }'], { type: 'text/css' }))
      window.controller.handleHostMessage({ kind: 'snippets.snapshot', version: 1, snippets: [{ name: 'rtl.css', uri }] })
    })
    await page.waitForFunction(() => getComputedStyle(document.querySelectorAll('.vsidian-reading-table table')[1]).direction === 'rtl')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const box = await bar.boundingBox()
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 120, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    const rtl = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      const bar = document.querySelector('.vsidian-reading-scrollbar')
      const table = document.querySelectorAll('.vsidian-reading-table table')[1]
      return { bar: bar.scrollLeft, table: table.scrollLeft, direction: getComputedStyle(bar).direction }
    })
    check('从右向左的表格能随底栏向左拖动',
      rtl.direction === 'rtl' && rtl.bar < -50 && rtl.table === rtl.bar, JSON.stringify(rtl))
    await page.close()
  }

  // 片段只改表内宽度，不改外框：不点击、不中断纵向阅读也更新底栏。
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 520 } })
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })
    await page.evaluate(() => {
      window.initReadingWidth('| A | B |\n| --- | --- |\n| short | cell |')
      window.setRwMode('reading')
      window.setRwSettings({ 'editor.readingTableLayout': 'single-line' })
    })
    const state = () => page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const table = document.querySelector('.vsidian-view-reading table')
      const bar = document.querySelector('.vsidian-reading-scrollbar')
      return { outer: [table.clientWidth, table.clientHeight], content: table.scrollWidth,
        shown: !bar.hidden, barWidth: bar.scrollWidth }
    })
    const initial = await state()
    await page.evaluate(() => {
      const uri = URL.createObjectURL(new Blob(['#app .vsidian-view-reading th, #app .vsidian-view-reading td { padding-inline: 240px !important; }'], { type: 'text/css' }))
      window.controller.handleHostMessage({ kind: 'snippets.snapshot', version: 1, snippets: [{ name: 'wide.css', uri }] })
    })
    await page.waitForFunction(width => document.querySelector('.vsidian-view-reading table').scrollWidth > width + 50,
      initial.content, { timeout: 5000 })
    const loaded = await state()
    check('CSS 片段仅改变内在宽度时，底栏立即跟随',
      initial.outer.every((size, index) => size === loaded.outer[index]) && !initial.shown &&
        loaded.content > initial.content + 50 && loaded.shown && loaded.barWidth === loaded.content, JSON.stringify({ initial, loaded }))
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'snippets.snapshot', version: 2, snippets: [] }))
    const cleared = await state()
    check('停用片段后，没有横向溢出就隐藏底栏',
      !cleared.shown && cleared.content === initial.content, JSON.stringify(cleared))
    await page.close()
  }

  // 上一个块只改变目标的位置，不会通知该表格或视口的 ResizeObserver。
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 430 } })
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })
    const source = [
      '> [!note]- Details', ...Array.from({ length: 17 }, (_, n) => `>\n> 提示段落 ${n}`), '',
      '| Key | Value |', '| --- | --- |', `| A | ${'wide_value'.repeat(25)} |`,
      ...Array.from({ length: 35 }, (_, n) => `\n表后正文 ${n}`),
    ].join('\n')
    await page.evaluate(text => {
      window.initReadingWidth(text)
      window.setRwMode('reading')
      window.setRwSettings({ 'editor.readingTableLayout': 'single-line' })
    }, source)
    await page.locator('.vsidian-reading-scrollbar').waitFor()
    const view = page.locator('.vsidian-view-reading').first()
    const toggle = view.locator('.callout-fold')
    const state = () => view.evaluate(async (view) => {
      // 等待折叠重排、相交观察与底栏合帧都落地。
      for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
      const table = view.querySelector('table')
      const bar = document.querySelector('.vsidian-reading-scrollbar')
      return { top: table.getBoundingClientRect().top, bottom: view.getBoundingClientRect().bottom,
        scroll: view.scrollTop, outer: [table.clientWidth, table.clientHeight], shown: !bar.hidden }
    })
    const before = await state()
    await toggle.click()
    const expanded = await state()
    check('展开表格上方提示框，无滚动也会隐藏离屏目标的底栏',
      before.shown && !expanded.shown && expanded.top >= expanded.bottom &&
        before.scroll === expanded.scroll && before.outer.every((size, index) => size === expanded.outer[index]),
      JSON.stringify({ before, expanded }))
    await toggle.click()
    const restored = await state()
    check('收起上方提示框后，底栏随表格重新入屏出现',
      restored.shown && restored.top < restored.bottom && restored.scroll === before.scroll, JSON.stringify(restored))
    await page.close()
  }

  // 分片长围栏：不必找到代码块尾端；用同一条底栏操作当前可见的代码区。
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 520 } })
    const codeErrors = []
    page.on('pageerror', error => codeErrors.push(error.message))
    await page.setContent('<div id="app" style="--vscode-scrollbarSlider-background: rgb(61, 102, 151)"></div>')
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })
    const source = [
      '| Key | Value |', '| --- | --- |', `| 1 | ${'T'.repeat(90)} |`, '',
      '```js',
      ...Array.from({ length: 100 }, (_, n) => `const sample_${n} = "${'abcdefghijklmnopqrstuvwxyz'.repeat(n < 60 ? 4 : 7)}";`),
      '```',
      ...Array.from({ length: 20 }, (_, n) => `\n代码后正文 ${n + 1}`),
    ].join('\n')
    await page.evaluate(text => {
      window.initReadingWidth(text)
      window.setRwMode('reading')
    }, source)
    const view = page.locator('.vsidian-view-reading').first()
    // 首片含起始围栏行；第二片从第 60 个代码行开始，按源码锚区分虚拟挂载的片。
    const starts = [source.indexOf('```js'), source.indexOf('const sample_59 ')]
    const [card, nextCard] = starts.map(start => view.locator(`.vsidian-reading-code-card[data-vsidian-src-start="${start}"]`))
    const firstPre = card.locator('pre')
    const bar = page.locator('.vsidian-reading-scrollbar')
    const wrap = card.locator('button.vsidian-code-card-wrap')
    await firstPre.waitFor()
    check('代码块默认折行时不显示横向底栏', !(await bar.isVisible()), '默认阅读模式')
    await card.locator('.vsidian-code-card-header').hover()
    await wrap.click()
    await page.evaluate(() => window.setRwSettings({ 'editor.readingTableLayout': 'single-line' }))
    await firstPre.locator('.vsidian-reading-code-line').first().click()
    const current = () => page.evaluate(async (starts) => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const view = document.querySelector('.vsidian-view-reading')
      const bar = document.querySelector('.vsidian-reading-scrollbar')
      const [first, next] = starts.map(start => view.querySelector(`.vsidian-reading-code-card[data-vsidian-src-start="${start}"] > pre`))
      const box = bar.getBoundingClientRect()
      const viewport = view.getBoundingClientRect()
      return {
        top: viewport.top, y: viewport.bottom,
        barY: box.bottom,
        tableW: view.querySelector('table')?.scrollWidth ?? 0,
        barW: bar.scrollWidth,
        firstW: first?.scrollWidth ?? 0, nextW: next?.scrollWidth ?? 0,
        firstY: first?.getBoundingClientRect().bottom ?? 0,
        visible: box.height > 0 && document.elementFromPoint(box.left + 10, box.bottom - 6) === bar,
        thumb: getComputedStyle(bar, '::-webkit-scrollbar-thumb').backgroundColor,
        nativeInset: first ? first.offsetHeight - first.clientHeight : null,
      }
    }, starts)
    const clickedCode = await current()
    check('代码与单行表格同时可见时，点击代码可切换底栏目标',
      clickedCode.visible && clickedCode.barW === clickedCode.firstW && clickedCode.firstW !== clickedCode.tableW,
      JSON.stringify(clickedCode))
    await view.locator('th').first().click()
    const clickedTable = await current()
    check('同一底栏可以切回可见的表格',
      clickedTable.visible && clickedTable.barW === clickedTable.tableW, JSON.stringify(clickedTable))

    await view.evaluate(el => { el.scrollTop = 420 })
    const middle = await current()
    check('长代码块中段可见主题滑块，且不再另画块内原生横条',
      middle.visible && Math.abs(middle.barY - middle.y) < 2 && middle.firstY > middle.y + 100 &&
        middle.barW === middle.firstW && middle.nativeInset === 0 && middle.thumb === 'rgb(61, 102, 151)',
      JSON.stringify(middle))
    if (middle.visible) {
      const box = await bar.boundingBox()
      await page.mouse.move(box.x + 20, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 130, box.y + box.height / 2, { steps: 6 })
      await page.mouse.up()
      const positions = await page.evaluate(() => [
        document.querySelector('.vsidian-reading-scrollbar').scrollLeft,
        document.querySelector('.vsidian-reading-code-card > pre').scrollLeft,
      ])
      check('拖动视口底栏移动长代码正文', positions[0] > 50 && positions[0] === positions[1], JSON.stringify(positions))
    }
    await view.evaluate((el, distance) => { el.scrollTop += distance }, middle.firstY - middle.top + 20)
    await nextCard.waitFor()
    const next = await current()
    check('滚到下一分片时，底栏跟随可见的代码区',
      next.visible && next.firstY <= next.top && next.barW === next.nextW, JSON.stringify(next))
    await view.evaluate(el => { el.scrollTop = el.scrollHeight })
    const passed = await current()
    check('最后一片离开视口后隐藏底栏', !passed.visible && passed.barW === 0, JSON.stringify(passed))
    await view.evaluate(el => { el.scrollTop = 0 })
    await card.locator('.vsidian-code-card-header').hover()
    await wrap.click()
    await page.evaluate(() => window.setRwSettings({ 'editor.readingTableLayout': 'wrap' }))
    const restored = await current()
    check('恢复代码和表格折行后隐藏底栏', !restored.visible && restored.barW === 0, JSON.stringify(restored))
    check('代码与表格切换无脚本错误', codeErrors.length === 0, JSON.stringify(codeErrors))
    await page.close()
  }

  check('页面无脚本错误', errors.length === 0, JSON.stringify(errors))
  if (failures.length > 0) {
    console.error(`readingWidthProbe: ${failures.length} 条断言红`)
    process.exitCode = 1
  } else {
    console.log('readingWidthProbe: 全部断言通过（铺满/限宽居中/行号跟随/侧栏避让/优先序）')
  }
} finally {
  await browser.close()
}
