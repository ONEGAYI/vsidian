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

const browser = await chromium.launch({ headless: true,
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
    const sr = scroller.getBoundingClientRect()
    const cs = getComputedStyle(scroller)
    const padL = Number.parseFloat(cs.paddingLeft)
    const padR = Number.parseFloat(cs.paddingRight)
    const contentLeft = sr.left + padL
    const contentW = scroller.clientWidth - padL - padR
    return { contentW, colW: c.width, colLeft: c.left, colRight: c.right,
      gutterLeft: g ? g.left : null, gutterRight: g ? g.right : null, gutterW: g ? g.width : 0,
      spacing: g ? c.left - g.right : 0,
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
