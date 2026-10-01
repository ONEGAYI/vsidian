// #248 表格格内嵌入的原生浏览器回归：真实布局（Chromium）经生产控制器
// 装配（复用 liveEmbedFixture 基座）验证——
// - 表头/数据格的格内卡片挂载：转义别名形态按格内语义解码（请求 target
//   为解码 inner、区间为原始源文——slice 回源文含 \|）、卡片嵌在网格格
//   mark span 内（cell 仍是单 grid item，列结构与邻格不因卡破坏）
// - 真实键盘（Tab 切格、ArrowLeft/Right 进出嵌入区间驱动显隐）
// - 卡内真实指针拖选不启动父矩形格区选取（对照普通格拖选建立 region）；
//   区域复制序列化父文档引用源文（不把目标正文灌入表格）
// - Reading 侧 td/th 格内卡片与表格结构保真；长内容卡滚轮到边界接续
//   外层滚动区；全程零写回
// 双 page 布局稳定策略：page1 装长文（滚轮接续场景需要限高长卡）；page2
// 装短文（指针交互场景需要全表在视口内的稳定布局——限高长卡会把对照行
// 挤出视口，坐标驱动不稳定）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'tableEmbed/tableEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：三列表格（表头格嵌入 + 数据格混排多引用 + 转义别名形态） */
const PARENT_DOC = [
  '# 表格嵌入父文档',
  '',
  '开篇段落。',
  '',
  '| ![[目标笔记\\|头别名]] | 短列头 | 备注列头 |',
  '| --- | --- | --- |',
  '| 前文 ![[目标笔记]] 中 ![[乙笔记\\|e]] 后文 | 普通格 | 长长长长长长内容参照格 |',
  '| 无嵌入行甲 | 123 | 456 |',
  '',
  '结尾段落。',
  '',
].join('\n')

/** 长目标全文（滚轮边界接续场景）与短目标全文（指针交互场景） */
const TARGET_LONG = [
  '# 目标笔记标题', '',
  ...Array.from({ length: 60 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`), '',
  '- [ ] 禁写任务', '',
].join('\n')
const TARGET_SHORT = [
  '# 目标笔记标题', '',
  ...Array.from({ length: 3 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`), '',
].join('\n')
const TARGET_YI = ['# 乙笔记标题', '', '乙笔记正文一段。', ''].join('\n')

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0

/** 装配一个 page（island + 生产控制器 bundle + 父文档） */
async function setupPage(docTextArg = PARENT_DOC) {
  const page = await browser.newPage({ viewport: { width: 860, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initLiveEmbedDoc(text), docTextArg)
  await page.locator('.vsidian-live-embed').first().waitFor({ timeout: 5000 })
  return { page, errors }
}

try {
  // ============ page1：长文（载荷/绘制/键盘/滚轮） ============
  const { page, errors } = await setupPage()
  const hoverRequests = () => page.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
  const docText = () => page.evaluate(() => window.liveEmbedDocText())
  const textPainted = (needle) => page.evaluate((n) => window.liveTextPainted(n), needle)
  const respondOk = async (req, long) => {
    const isYi = req.target.startsWith('乙笔记')
    const t = isYi ? TARGET_YI : (long ? TARGET_LONG : TARGET_SHORT)
    await page.evaluate(({ reqId, instanceId, tt, fs, rel }) => window.respondLiveEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: fs, relPath: rel },
      version: 2, text: tt, range: { start: 0, end: tt.length }, scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, tt: t,
      fs: isYi ? 'D:\\notes\\乙笔记.md' : 'D:\\notes\\目标笔记.md',
      rel: isYi ? '乙笔记.md' : '目标笔记.md' })
    await page.waitForTimeout(120)
  }

  // ---- 场景 A：载荷解码语义 + 源码区间保真 ----
  const reqs = await hoverRequests()
  const byTarget = new Map(reqs.map((r) => [r.target, r]))
  assert.equal(reqs.length, 3, `表内三枚嵌入各发请求（实际 ${reqs.length}）`)
  const headReq = byTarget.get('目标笔记|头别名')
  assert.ok(headReq, '表头格转义别名形态请求 target 为解码 inner（B|别名）')
  assert.equal(PARENT_DOC.slice(headReq.sourceStart, headReq.sourceEnd),
    '![[目标笔记\\|头别名]]', '表头格请求区间 slice 回源文恰为嵌入原文（含 \\|）')
  const mixReq = byTarget.get('目标笔记')
  assert.ok(mixReq, '数据格无管道形态请求照常')
  const yiReq = byTarget.get('乙笔记|e')
  assert.ok(yiReq, '同格第二引用（转义别名）请求 target 为解码 inner')
  assert.equal(PARENT_DOC.slice(yiReq.sourceStart, yiReq.sourceEnd),
    '![[乙笔记\\|e]]', '同格第二引用区间为源文精确边界')
  passed++
  console.log('[表格嵌入][PASS] 载荷：解码 inner + 源码区间保真（\\| 不误切列）')

  // ---- 场景 B：回包后 Live 绘制（格内卡 + 网格列结构 + 邻格保真） ----
  for (const r of reqs) {
    await respondOk(r, true)
  }
  const grid = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
    const cellHosts = [...document.querySelectorAll('.vsidian-live-embed')]
      .map((host) => {
        const cell = host.closest('.vsidian-table-grid-cell')
        const card = host.querySelector('.vsidian-embed-card')
        const hr = host.getBoundingClientRect()
        const cr = cell?.getBoundingClientRect()
        return {
          inCell: cell !== null,
          cardHeight: card?.getBoundingClientRect().height ?? 0,
          rightWithinCell: cr ? hr.right <= cr.right + 1 : false,
          bottomWithinCell: cr ? hr.bottom <= cr.bottom + 1 : false,
        }
      })
    return {
      rows: rows.length,
      cellsPerRow: rows.map((r) => r.querySelectorAll(':scope > .vsidian-table-grid-cell').length),
      cellHosts,
      headerCellText: rows[0]?.querySelectorAll(':scope > .vsidian-table-grid-cell')[0]?.textContent ?? '',
      mixCellText: rows[1]?.querySelectorAll(':scope > .vsidian-table-grid-cell')[0]?.textContent ?? '',
    }
  })
  assert.equal(grid.rows, 3, `三行网格（表头 + 两数据行，实际 ${grid.rows}）`)
  assert.ok(grid.cellsPerRow.every((n) => n === 3), `各行 3 格不被卡破坏（实际 ${JSON.stringify(grid.cellsPerRow)}）`)
  assert.equal(grid.cellHosts.length, 3, '三枚格内卡在场')
  assert.ok(grid.cellHosts.every((h) => h.inCell), '卡宿主嵌在网格格 mark span 内（cell 仍单 grid item）')
  assert.ok(grid.cellHosts.every((h) => h.cardHeight > 20), `卡有真实高度（实际 ${JSON.stringify(grid.cellHosts.map((h) => h.cardHeight))}）`)
  assert.ok(grid.cellHosts.every((h) => h.rightWithinCell && h.bottomWithinCell),
    `卡不越出所在格（列宽不撑破，实际 ${JSON.stringify(grid.cellHosts)}）`)
  assert.ok(!grid.headerCellText.includes('![['), '表头格嵌入源文退场（精确区间替换）')
  assert.ok(grid.headerCellText.includes('目标笔记.md'), '表头格卡装载后标题为根内相对路径')
  assert.ok(!grid.mixCellText.includes('![[目标笔记]]') && !grid.mixCellText.includes('![[乙笔记'),
    '数据格两枚嵌入源文退场')
  assert.equal(await textPainted('前文'), true, '格内前文绘制可见')
  assert.equal(await textPainted('后文'), true, '格内后文绘制可见')
  assert.equal(await textPainted('普通格'), true, '同行邻格文本绘制可见（不挤邻格）')
  assert.equal(await textPainted('无嵌入行甲'), true, '无嵌入行照常渲染')
  passed++
  console.log('[表格嵌入][PASS] Live 绘制：格内卡 + 网格列结构 + 邻格保真')

  // ---- 场景 C：真实键盘显隐（ArrowLeft 进区间显形 / 出区间恢复） ----
  await page.evaluate(() => window.focusLiveEmbed())
  const text0 = await docText()
  const goalFrom = text0.indexOf('![[目标笔记]]', text0.indexOf('前文'))
  const goalTo = goalFrom + '![[目标笔记]]'.length
  await page.evaluate((p) => window.setLiveCursor(p), goalTo + 1) // 区间后（空格上）
  await page.waitForTimeout(80)
  let reveal = await page.evaluate(() => window.liveEmbedRevealStates().find((s) => s.inner === '目标笔记'))
  assert.equal(reveal.revealed, false, '光标在区间后一格不显形（不扩大到相邻文字）')
  await page.keyboard.press('ArrowLeft') // 进入 ]]
  await page.waitForTimeout(80)
  reveal = await page.evaluate(() => window.liveEmbedRevealStates().find((s) => s.inner === '目标笔记'))
  assert.equal(reveal.revealed, true, '真实 ArrowLeft 进入区间 → 源码显形')
  const revealedPaint = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-content .cm-line')]
      .find((l) => (l.textContent ?? '').includes('![[目标笔记]]'))
    if (!line) return { found: false }
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let painted = false
    let node = null
    while ((node = walker.nextNode()) !== null) {
      const range = document.createRange()
      range.selectNodeContents(node)
      if (range.getClientRects().length > 0) painted = true
    }
    return { found: true, painted, gridCell: line.querySelector('.vsidian-table-grid-cell') !== null }
  })
  assert.ok(revealedPaint.found && revealedPaint.painted, '显形后格内源文可编辑可见')
  assert.equal(revealedPaint.gridCell, true, '显形后网格格 mark 仍在（网格不撤）')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(80)
  reveal = await page.evaluate(() => window.liveEmbedRevealStates().find((s) => s.inner === '目标笔记'))
  assert.equal(reveal.revealed, false, '光标离开区间 → 恢复隐藏（格输入语义保留）')
  const allHidden = await page.evaluate(() => window.liveEmbedRevealStates().every((s) => !s.revealed))
  assert.equal(allHidden, true, '同行另一枚（乙别名）不受牵连（兄弟独立显隐）')
  passed++
  console.log('[表格嵌入][PASS] 真实键盘显隐：进出区间 + 显形源文可编辑 + 网格保持 + 兄弟独立')

  // ---- 场景 D：Tab 切格语义保留（真实 Tab 定位次格内容首） ----
  const headerLine = (await docText()).indexOf('| ![[目标笔记\\|头别名]]')
  await page.evaluate((p) => window.setLiveCursor(p), headerLine + 1)
  await page.waitForTimeout(60)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(80)
  const afterTab = await page.evaluate(() => ({
    sel: window.liveEmbedSelection()[0] ?? null,
    headerRevealed: window.liveEmbedRevealStates().find((s) => s.inner === '目标笔记|头别名')?.revealed ?? null,
  }))
  assert.ok(afterTab.sel, 'Tab 后有选区')
  // 光标起点在首格区间外（边界管道上）→ Tab 语义定位「下一格」内容首；
  // 首格嵌入不受牵连（独立显隐）
  const secondCellAt = (await docText()).indexOf('短列头')
  assert.equal(afterTab.sel.head, secondCellAt,
    `Tab 定位下一格内容首（实际 ${afterTab.sel?.head}，期望 ${secondCellAt}）`)
  assert.equal(afterTab.headerRevealed, false, '光标在次格 → 首格嵌入保持隐藏（不扩大显形）')
  assert.equal(await editRequestCount(), 0, '导航全程零写回')
  passed++
  console.log('[表格嵌入][PASS] Tab 切格：落点次格内容首 + 首格嵌入独立显隐 + 零写回')

  // ---- 场景 E：长内容卡滚轮到边界接续外层滚动区 ----
  await page.evaluate((p) => window.setLiveCursor(p), (await docText()).indexOf('开篇段落'))
  await page.waitForTimeout(80)
  const scrollBox = await page.evaluate(() => {
    const host = [...document.querySelectorAll('.vsidian-live-embed')]
      .find((h) => (h.textContent ?? '').includes('目标笔记第 3 段'))
    const scroll = host?.querySelector('.vsidian-embed-card-scroll')
    scroll?.scrollIntoView({ block: 'start' })
    return scroll ? { top: scroll.getBoundingClientRect().top,
      scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
      capped: scroll.clientHeight <= 481 } : null
  })
  assert.ok(scrollBox, '长内容卡滚动区在场')
  assert.ok(scrollBox.capped, `卡内容区受 embed.maxHeight 限高（clientHeight=${scrollBox.clientHeight}）`)
  await page.waitForTimeout(80)
  const top2 = await page.evaluate(() => {
    const host = [...document.querySelectorAll('.vsidian-live-embed')]
      .find((h) => (h.textContent ?? '').includes('目标笔记第 3 段'))
    const scroll = host?.querySelector('.vsidian-embed-card-scroll')
    return scroll ? scroll.getBoundingClientRect().top : -1
  })
  const scrollerTopBefore = await page.evaluate(() => window.liveEmbedScrollTop())
  for (let i = 0; i < 16; i += 1) {
    await page.mouse.move(300, Math.max(40, top2 + 60))
    await page.mouse.wheel(0, 240)
    await page.waitForTimeout(40)
  }
  const afterWheel = await page.evaluate(() => {
    const host = [...document.querySelectorAll('.vsidian-live-embed')]
      .find((h) => (h.textContent ?? '').includes('目标笔记第 3 段'))
    const scroll = host?.querySelector('.vsidian-embed-card-scroll')
    return { innerScrolled: scroll ? scroll.scrollTop > 0 : false,
      cardBottom: scroll ? scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2 : false,
      scrollerTop: window.liveEmbedScrollTop() }
  })
  assert.ok(afterWheel.innerScrolled, `滚轮先被卡内层消费（scrollTop>0，实际 ${JSON.stringify(afterWheel)}）`)
  assert.ok(afterWheel.cardBottom || afterWheel.scrollerTop > scrollerTopBefore,
    `卡到底后滚轮接续外层滚动区（内层到底=${afterWheel.cardBottom}，外层 ${scrollerTopBefore} → ${afterWheel.scrollerTop}）`)
  assert.equal(await editRequestCount(), 0, 'page1 全程零写回')
  assert.deepEqual(errors, [], `page1 无页面错误（实际 ${JSON.stringify(errors)}）`)
  passed++
  console.log('[表格嵌入][PASS] 滚轮边界接续：内层先消费，到底接续外层')
  await page.close()

  // ============ page2：短文（指针交互 / 区域复制 / Reading） ============
  const p2 = await setupPage()
  const page2 = p2.page
  const errors2 = p2.errors
  const hoverRequests2 = () => page2.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
  const editCount2 = () => page2.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
  const respondOk2 = async (req) => {
    const isYi = req.target.startsWith('乙笔记')
    const t = isYi ? TARGET_YI : TARGET_SHORT
    await page2.evaluate(({ reqId, instanceId, tt, fs, rel }) => window.respondLiveEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: fs, relPath: rel },
      version: 2, text: tt, range: { start: 0, end: tt.length }, scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, tt: t,
      fs: isYi ? 'D:\\notes\\乙笔记.md' : 'D:\\notes\\目标笔记.md',
      rel: isYi ? '乙笔记.md' : '目标笔记.md' })
    await page2.waitForTimeout(120)
  }
  for (const r of await hoverRequests2()) {
    await respondOk2(r)
  }

  // ---- 场景 F：卡内真实指针拖选不启动父矩形格区选取（交互隔离） ----
  const shortLayout = await page2.evaluate(() => {
    const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
    const yiCard = [...document.querySelectorAll('.vsidian-live-embed')]
      .find((h) => (h.textContent ?? '').includes('乙笔记标题'))
    const plainRow = rows.find((r) => (r.textContent ?? '').includes('无嵌入行甲'))
    plainRow?.scrollIntoView({ block: 'center' })
    const cells = plainRow?.querySelectorAll(':scope > .vsidian-table-grid-cell')
    const a = cells?.[0]?.getBoundingClientRect()
    const b = cells?.[1]?.getBoundingClientRect()
    const card = yiCard?.getBoundingClientRect()
    return { card, a, b, rowsTotal: rows.length }
  })
  await page2.waitForTimeout(60)
  const shortLayout2 = await page2.evaluate(() => {
    const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
    const plainRow = rows.find((r) => (r.textContent ?? '').includes('无嵌入行甲'))
    const cells = plainRow?.querySelectorAll(':scope > .vsidian-table-grid-cell')
    return { a: cells?.[0]?.getBoundingClientRect() ?? null,
      b: cells?.[1]?.getBoundingClientRect() ?? null }
  })
  const layout = { ...shortLayout, ...shortLayout2 }
  assert.ok(layout.card, '短布局：乙卡在场')
  assert.ok(layout.a && layout.b, '对照格在场')
  assert.ok(layout.b.y > 0 && layout.b.y < 600, `对照行在视口内（y=${layout.b.y}）`)
  // F1：卡内按下、拖到对照行邻格、松开——不建立矩形格区（交互隔离）
  await page2.mouse.move(layout.card.x + 24, layout.card.y + 18)
  await page2.mouse.down()
  await page2.mouse.move(layout.b.x + 12, layout.b.y + layout.b.height / 2, { steps: 5 })
  await page2.mouse.up()
  await page2.waitForTimeout(120)
  const afterCardDrag = await page2.evaluate(() => ({
    regionCells: document.querySelectorAll('.vsidian-table-region-cell').length,
    edits: window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length,
  }))
  assert.equal(afterCardDrag.regionCells, 0, '卡内开始的拖选不启动父矩形格区选取')
  assert.equal(afterCardDrag.edits, 0, '卡内交互零写回')
  // F2：对照——普通格间拖选建立矩形格区（既有表格契约不回归）
  await page2.mouse.move(layout.a.x + 14, layout.a.y + layout.a.height / 2)
  await page2.mouse.down()
  await page2.mouse.move(layout.b.x + 12, layout.b.y + layout.b.height / 2, { steps: 4 })
  await page2.mouse.up()
  await page2.waitForTimeout(120)
  const afterPlainDrag = await page2.evaluate(() =>
    document.querySelectorAll('.vsidian-table-region-cell').length)
  assert.equal(afterPlainDrag, 2, `普通格拖选照常建立矩形格区（2 格，实际 ${afterPlainDrag}）`)
  passed++
  console.log('[表格嵌入][PASS] 交互隔离：卡内拖选零格区零写回；普通格拖选契约保持')

  // ---- 场景 G：区域复制序列化父文档引用源文 ----
  // 数据行第 1 列（嵌入格）→ 第 2 列（普通格）的 1×2 区域
  const mixBoxes = await page2.evaluate(() => {
    const row = [...document.querySelectorAll('.vsidian-table-grid-row')]
      .find((r) => (r.textContent ?? '').includes('前文'))
    const c1 = row?.querySelectorAll(':scope > .vsidian-table-grid-cell')[0]
    const c2 = row?.querySelectorAll(':scope > .vsidian-table-grid-cell')[1]
    return { a: c1?.getBoundingClientRect() ?? null, b: c2?.getBoundingClientRect() ?? null }
  })
  assert.ok(mixBoxes.a && mixBoxes.b && mixBoxes.b.y < 600, '数据行格在视口内')
  await page2.evaluate(() => document.addEventListener('copy', (event) => {
    window.__copiedTable = event.clipboardData?.getData('text/plain')
  }))
  // 反向拖选（普通格 → 嵌入格）：起点在普通格文字行、终点在嵌入格的
  // 「前文」文字上——路径避开格中下部的卡域（正向路径穿越卡域时，中间
  // 点回落首格会反复交还原生拖选，观感等同用户拖选路径经过卡）
  await page2.mouse.move(mixBoxes.b.x + 16, mixBoxes.b.y + 12)
  await page2.mouse.down()
  await page2.mouse.move(mixBoxes.a.x + 12, mixBoxes.a.y + 8, { steps: 4 })
  await page2.mouse.up()
  await page2.waitForTimeout(100)
  await page2.keyboard.press('Control+c')
  const copied = await page2.evaluate(() => window.__copiedTable)
  assert.ok(copied, `区域复制产出剪贴板文本（实际 ${JSON.stringify(copied)}；格区数 ${await page2.evaluate(() => document.querySelectorAll('.vsidian-table-region-cell').length)}）`)
  assert.ok(copied.startsWith('|'), `复制产物是 Markdown 表格形态（实际 ${JSON.stringify(copied)}）`)
  assert.ok(copied.includes('![[目标笔记]]') && copied.includes('![[乙笔记\\|e]]'),
    `复制序列化父文档引用源文（含转义管道原文，实际 ${JSON.stringify(copied)}）`)
  assert.ok(!copied.includes('目标笔记第 1 段'), '不把目标文章正文灌入表格')
  await page2.evaluate(() => window.setLiveCursor(0))
  await page2.waitForTimeout(80)
  passed++
  console.log('[表格嵌入][PASS] 区域复制：序列化父文档引用源文（转义原文保真）')

  // ---- 场景 H：Reading 侧 td/th 格内卡 + 表格结构保真 ----
  await page2.evaluate(() => window.setLiveEmbedMode('reading'))
  await page2.waitForTimeout(250)
  const reading = await page2.evaluate(() => {
    const hosts = [...document.querySelectorAll('.vsidian-reading-embed-mixed')]
      .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
    const table = document.querySelector('.vsidian-reading-block table')
    return {
      hosts: hosts.length,
      inCells: hosts.map((h) => h.closest('td') !== null || h.closest('th') !== null),
      trs: table?.querySelectorAll('tr').length ?? 0,
      tds: table?.querySelectorAll('tbody td').length ?? 0,
      ths: table?.querySelectorAll('thead th').length ?? 0,
      neighbor: table?.textContent?.includes('普通格') ?? false,
      targetLoaded: hosts.some((h) => (h.textContent ?? '').includes('目标笔记第 1 段')),
    }
  })
  assert.equal(reading.hosts, 3, `Reading 三枚格内卡（表头 + 数据格两枚，实际 ${reading.hosts}）`)
  assert.ok(reading.inCells.every(Boolean), 'Reading 卡落位 td/th 内（表格结构不拆）')
  assert.equal(reading.trs, 3, '表格行结构完整')
  assert.equal(reading.ths, 3, '表头三列完整')
  assert.equal(reading.tds, 6, '数据行两行三列完整')
  assert.equal(reading.neighbor, true, '邻格文本可见（不挤邻格）')
  assert.equal(reading.targetLoaded, true, 'Reading 卡装载目标正文')
  await page2.evaluate(() => window.setLiveEmbedMode('live'))
  await page2.waitForTimeout(200)
  assert.equal(await page2.evaluate(() => window.liveEmbedDocText()), PARENT_DOC, '模式切换源文逐字节不丢')
  assert.equal(await editCount2(), 0, 'page2 全程零写回')
  assert.deepEqual(errors2, [], `page2 无页面错误（实际 ${JSON.stringify(errors2)}）`)
  passed++
  console.log('[表格嵌入][PASS] Reading 侧：td/th 格内卡 + 表格结构保真 + 源文不丢 + 零写回')
  // ============ page3：格区结构操作矩阵（P1-2 补证） ============
  // 含嵌入格的三列表格上执行清空/删行/删列/拖排/粘贴往返——每场景独立
  // page（结构写操作互相破坏，隔离最稳）；结构操作是预期写（断言恰一笔
  // edit.request 而非零写回）。
  const STRUCT_DOC = [
    '# 结构矩阵', '',
    '| 头A | 头B | 头C |',
    '| --- | --- | --- |',
    '| 甲 ![[目标笔记\\|别名]] 乙 | 普一格 | 普二格 |',
    '| 下一 | 下二 | ![[目标笔记]] |',
    '',
  ].join('\n')
  const structGrid = (page) => page.evaluate(() => ({
    text: window.liveEmbedDocText(),
    rows: document.querySelectorAll('.vsidian-table-grid-row').length,
    edits: window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length,
  }))
  const cellBox = (page, rowIdx, colIdx) => page.evaluate(([r, c]) => {
    const row = document.querySelectorAll('.vsidian-table-grid-row')[r]
    const cell = row?.querySelectorAll(':scope > .vsidian-table-grid-cell')[c]
    return cell?.getBoundingClientRect() ?? null
  }, [rowIdx, colIdx])
  /** 格区拖选：两段路径——先在起点格的文字行高度横向移入目标格，再纵向
   *  落到目标格中部。嵌入格的卡域在格中下部，斜线路径会穿越卡域使中间
   *  点回落首格（onMove 同格分支交还原生拖选）；两段路径保持锚定连续 */
  const dragRegion = async (page, a, b) => {
    const startY = a.y + Math.min(10, a.height / 2)
    await page.mouse.move(a.x + 12, startY)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 10, startY, { steps: 3 })
    await page.mouse.move(b.x + b.width - 10, b.y + b.height / 2, { steps: 2 })
    await page.mouse.up()
    await page.waitForTimeout(140)
  }

  // S1 清空：格区选数据行 1 的格 1-2（含嵌入格）→ Delete 清内容
  {
    const { page, errors } = await setupPage(STRUCT_DOC)
    // 页面取得焦点（首次鼠标操作前的常规预热——与 page2 的 F1 先行操作等价）
    await page.evaluate(() => window.focusLiveEmbed())
    const edits0 = (await structGrid(page)).edits
    const a = await cellBox(page, 1, 0)
    const b = await cellBox(page, 1, 1)
    // 诊断（失败时输出落点命中与锚定状态）
    const probeS1 = await page.evaluate(([ax, ay, bx, by]) => {
      const at = (x, y) => {
        const el = document.elementFromPoint(x, y)
        return { cls: String(el?.className ?? '').slice(0, 50), text: (el?.textContent ?? '').slice(0, 14) }
      }
      return { a: at(ax, ay), b: at(bx, by), focus: document.activeElement?.className.slice(0, 40) ?? '' }
    }, [a.x + 12, a.y + Math.min(10, a.height / 2), b.x + b.width - 10, b.y + b.height / 2])
    await dragRegion(page, a, b)
    const regionCount = await page.locator('.vsidian-table-region-cell').count()
    if (regionCount !== 2) {
      console.log('S1-DIAG', JSON.stringify({ probeS1, regionCount,
        boxes: { a: { x: a.x, y: a.y, w: a.width, h: a.height }, b: { x: b.x, y: b.y, w: b.width, h: b.height } } }))
    }
    assert.equal(regionCount, 2, 'S1 格区 1×2 建立')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(160)
    const after = await structGrid(page)
    assert.equal(after.edits, edits0 + 1, `S1 清空恰一笔 edit.request（实际 ${after.edits - edits0}）`)
    assert(!after.text.includes('![[目标笔记\\|别名]]') && !after.text.includes('普一格'),
      `S1 选中格内容清空（实际 ${after.text.split('\n')[4] ?? ''}）`)
    const s1Row = after.text.split('\n')[4] ?? ''
    assert(s1Row.includes('普二格') && (s1Row.match(/\|/g) ?? []).length === 4,
      `S1 清空后行列结构保持（实际 ${JSON.stringify(s1Row)}）`)
    assert(after.rows === 3, `S1 不删行（实际 ${after.rows}）`)
    assert(after.text.includes('下一') && after.text.includes('![[目标笔记]]'),
      'S1 未选中的行与格不受扰')
    assert.deepEqual(errors, [], 'S1 无页面错误')
    await page.close()
  }
  passed++
  console.log('[表格嵌入][PASS] S1 格区清空：嵌入格清内容、行列保持、恰一笔写')

  // S2 删行：满行选区（数据行 1 三格）→ Delete 删行
  {
    const { page, errors } = await setupPage(STRUCT_DOC)
    const edits0 = (await structGrid(page)).edits
    const a = await cellBox(page, 1, 0)
    const b = await cellBox(page, 1, 2)
    await dragRegion(page, a, b)
    assert.equal(await page.locator('.vsidian-table-region-cell').count(), 3, 'S2 满行格区建立')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(160)
    const after = await structGrid(page)
    assert.equal(after.edits, edits0 + 1, `S2 删行恰一笔 edit.request（实际 ${after.edits - edits0}）`)
    assert(!after.text.includes('别名') && !after.text.includes('普一'),
      `S2 嵌入行整行删除（实际 ${JSON.stringify(after.text.split('\n').slice(3, 6))}）`)
    assert(after.rows === 2 && after.text.includes('下一') && after.text.includes('![[目标笔记]]'),
      `S2 删行后表头与另一数据行完整（rows=${after.rows}）`)
    assert.deepEqual(errors, [], 'S2 无页面错误')
    await page.close()
  }
  passed++
  console.log('[表格嵌入][PASS] S2 删行：嵌入行删除、其余结构保持')

  // S3 删列：满列选区（列 1：表头 + 两数据行）→ Delete 删列
  {
    const { page, errors } = await setupPage(STRUCT_DOC)
    const edits0 = (await structGrid(page)).edits
    const a = await cellBox(page, 0, 0)
    const b = await cellBox(page, 2, 0)
    await dragRegion(page, a, b)
    assert.equal(await page.locator('.vsidian-table-region-cell').count(), 3, 'S3 满列格区建立')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(160)
    const after = await structGrid(page)
    assert.equal(after.edits, edits0 + 1, `S3 删列恰一笔 edit.request（实际 ${after.edits - edits0}）`)
    assert(!after.text.includes('![[目标笔记\\|别名]]') && !after.text.includes('头A'),
      `S3 嵌入列整列删除（实际 ${JSON.stringify(after.text.split('\n').slice(3, 6))}）`)
    assert(after.rows === 3 && after.text.includes('头B') && after.text.includes('头C') &&
      after.text.includes('![[目标笔记]]'),
      `S3 删列后其余列与行完整（rows=${after.rows}）`)
    const cellsPerRow = await page.evaluate(() =>
      [...document.querySelectorAll('.vsidian-table-grid-row')]
        .map((r) => r.querySelectorAll(':scope > .vsidian-table-grid-cell').length))
    assert.ok(cellsPerRow.every((n) => n === 2), `S3 列数 3→2（实际 ${JSON.stringify(cellsPerRow)}）`)
    assert.deepEqual(errors, [], 'S3 无页面错误')
    await page.close()
  }
  passed++
  console.log('[表格嵌入][PASS] S3 删列：嵌入列删除、列数收缩、其余列对齐保持')

  // S4 拖排行：数据行 1（嵌入行）拖到顶部升表头
  {
    const { page, errors } = await setupPage(STRUCT_DOC)
    const from = await page.locator('.vsidian-table-row-handle').nth(1).boundingBox()
    const top = await page.locator('.vsidian-table-row-handle').nth(0).boundingBox()
    assert.ok(from && top, 'S4 行把手在场')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, top.y + 2, { steps: 8 })
    assert(await page.locator('.vsidian-table-drop-before').count() > 0, 'S4 拖动绘出插入线')
    await page.mouse.up()
    await page.waitForTimeout(160)
    const after = await structGrid(page)
    const s4Lines = after.text.split('\n')
    assert(s4Lines[2] === '| 甲 ![[目标笔记\\|别名]] 乙 | 普一格 | 普二格 |' &&
      s4Lines[3] === '| --- | --- | --- |' && s4Lines[4] === '| 头A | 头B | 头C |',
      `S4 嵌入行升表头、转义管道原样、分隔行跟随（实际 ${JSON.stringify(s4Lines.slice(2, 6))}）`)
    assert.equal(after.rows, 3, `S4 行数不变（实际 ${after.rows}）`)
    assert.deepEqual(errors, [], 'S4 无页面错误')
    await page.close()
  }
  passed++
  console.log('[表格嵌入][PASS] S4 拖排行：嵌入行升表头、\\| 原样、分隔行跟随')

  // S5 拖排列：列 1（嵌入列）拖到列 2 位置
  {
    const { page, errors } = await setupPage(STRUCT_DOC)
    const from = await page.locator('.vsidian-table-column-handle').nth(0).boundingBox()
    const to = await page.locator('.vsidian-table-column-handle').nth(1).boundingBox()
    assert.ok(from && to, 'S5 列把手在场')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width + 6, from.y + from.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(160)
    const after = await structGrid(page)
    assert(after.text.includes('| 头B | 头A | 头C |') &&
      after.text.includes('| 普一格 | 甲 ![[目标笔记\\|别名]] 乙 | 普二格 |'),
      `S5 嵌入列随移动、转义管道原样（实际 ${JSON.stringify(after.text.split('\n').slice(3, 6))}）`)
    assert.deepEqual(errors, [], 'S5 无页面错误')
    await page.close()
  }
  passed++
  console.log('[表格嵌入][PASS] S5 拖排列：嵌入列移动、\\| 原样')

  // S6 粘贴往返：区域复制嵌入格 → 格区粘贴铺开（escapeCellText 不双重转义）
  {
    const { page, errors } = await setupPage(STRUCT_DOC)
    const edits0 = (await structGrid(page)).edits
    // 复制：数据行 2 的格 3（无管道嵌入格）+ 嵌入格（数据行 1 格 1）不在
    // 同一矩形——用数据行 1 的格 1-2（嵌入格 + 普一格）复制
    const a = await cellBox(page, 1, 0)
    const b = await cellBox(page, 1, 1)
    await dragRegion(page, a, b)
    await page.evaluate(() => document.addEventListener('copy', (event) => {
      window.__copiedTable = event.clipboardData?.getData('text/plain')
    }))
    await page.keyboard.press('Control+c')
    const copied = await page.evaluate(() => window.__copiedTable)
    assert.ok(copied.includes('![[目标笔记\\|别名]]'), `S6 复制产物含转义原文（实际 ${JSON.stringify(copied)}）`)
    // 粘贴目标：数据行 2 的格 2-3（1×2 格区铺开——首行也是数据，表头包装剥掉）
    const c = await cellBox(page, 2, 1)
    const d = await cellBox(page, 2, 2)
    await dragRegion(page, c, d)
    assert.equal(await page.locator('.vsidian-table-region-cell').count(), 2, 'S6 粘贴目标格区建立')
    await page.evaluate((payload) => {
      const target = document.querySelector('.cm-content')
      const dt = new DataTransfer()
      dt.setData('text/plain', payload)
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, copied)
    await page.waitForTimeout(200)
    const after = await structGrid(page)
    assert.equal(after.edits, edits0 + 1, `S6 格对格粘贴恰一笔 edit.request（实际 ${after.edits - edits0}）`)
    assert(after.text.includes('| 下一 | 甲 ![[目标笔记\\|别名]] 乙 | 普一格 |'),
      `S6 粘贴铺开且 \\| 不双重转义、不裸化（实际 ${JSON.stringify(after.text.split('\n').slice(3, 7))}）`)
    assert(!after.text.includes('\\\\|'), 'S6 无双重转义（\\\\|）')
    const pipeCount = (after.text.split('\n')[5] ?? '').match(/\\\|/g)?.length ?? 0
    assert.equal(pipeCount, 1, `S6 粘贴格内恰一枚转义管道（实际 ${pipeCount}）`)
    assert.deepEqual(errors, [], 'S6 无页面错误')
    await page.close()
  }
  passed++
  console.log('[表格嵌入][PASS] S6 粘贴往返：转义源文铺开、不双重转义、恰一笔写')

  // ============ page4：输入矩阵（P1-3 补证） ============
  const INPUT_DOC = [
    '# 输入矩阵', '',
    '| 头 | 值 |',
    '| --- | --- |',
    '| 甲 ![[目标笔记]] 中 ![[乙笔记\\|e]] 乙 | 普通格 |',
    '',
  ].join('\n')
  const { page: page4, errors: errors4 } = await setupPage(INPUT_DOC)
  const hoverRequests4 = () => page4.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
  const edits4 = () => page4.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
  const doc4 = () => page4.evaluate(() => window.liveEmbedDocText())
  const reqs4 = await hoverRequests4()
  for (const r of reqs4) {
    const isYi = r.target.startsWith('乙笔记')
    const t = isYi ? TARGET_YI : TARGET_SHORT
    await page4.evaluate(({ reqId, instanceId, tt, fs, rel }) => window.respondLiveEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: fs, relPath: rel },
      version: 2, text: tt, range: { start: 0, end: tt.length }, scope: { kind: 'full' },
    }), { reqId: r.reqId, instanceId: r.instanceId, tt: t,
      fs: isYi ? 'D:\\notes\\乙笔记.md' : 'D:\\notes\\目标笔记.md',
      rel: isYi ? '乙笔记.md' : '目标笔记.md' })
    await page4.waitForTimeout(120)
  }

  // I1 真实 IME：光标进格内嵌入 inner（显形）→ CDP composition + 提交
  await page4.evaluate(() => window.focusLiveEmbed())
  const inputText0 = await doc4()
  const imeAt = inputText0.indexOf('![[目标笔记]]')
  await page4.evaluate((p) => window.setLiveCursor(p + 5), imeAt) // inner 中段（显形）
  await page4.waitForTimeout(80)
  const cdp = await page4.context().newCDPSession(page4)
  await cdp.send('Input.imeSetComposition', { text: '笔', selectionStart: 1, selectionEnd: 1 })
  await page4.waitForTimeout(60)
  await cdp.send('Input.insertText', { text: '笔' }) // 提交（目标笔记 → 笔标笔记）
  await page4.waitForTimeout(160)
  const afterIme = await doc4()
  assert.ok(afterIme.includes('甲 ![[目标笔笔记]] 中 ![[乙笔记\\|e]] 乙'),
    `I1 IME 提交后格内前后文与同格另一嵌入不动（实际 ${afterIme.split('\n')[4] ?? ''}）`)
  assert.equal(afterIme.split('\n').length, inputText0.split('\n').length, 'I1 不新增行（格内单行语义）')
  const newReqs = (await hoverRequests4()).slice(reqs4.length)
  assert.ok(newReqs.some((r) => r.target === '目标笔笔记'), `I1 新目标装载请求在途（实际 ${newReqs.map((r) => r.target)}）`)
  const beforeEditsI1 = await edits4()
  assert.ok(beforeEditsI1 >= 1, 'I1 IME 编辑经出站写回（预期写）')
  passed++
  console.log('[表格嵌入][PASS] I1 真实 IME：格内 inner 编辑、同格兄弟不动、新目标请求')

  // I2 格内 Enter：光标在格内文字（前文上）→ Enter 写 <br>（一格一源行）
  const enterAt = (await doc4()).indexOf('甲 ') + 2 // 「甲」后（格内文字、非嵌入内）
  await page4.evaluate((p) => window.setLiveCursor(p), enterAt)
  await page4.waitForTimeout(80)
  await page4.keyboard.press('Enter')
  await page4.waitForTimeout(140)
  const afterEnter = await doc4()
  assert.ok(afterEnter.includes('甲 <br>![[目标笔笔记]]'),
    `I2 Enter 写 <br>（一格一源行，实际 ${afterEnter.split('\n')[4] ?? ''}）`)
  assert.equal((afterEnter.match(/<br>/g) ?? []).length, 1, 'I2 恰一枚 <br>')
  // I3 撤销等价（fixture 无 CM6 historyMod，Ctrl+Z 链路在真宿主 #223/#247
  // 用例经 table.test.history undo 覆盖——浏览器侧按 #247 先例以真实
  // Backspace 删换行恢复等价覆盖并注明）
  await page4.keyboard.press('Backspace')
  await page4.waitForTimeout(140)
  const afterBack = await doc4()
  assert.ok(!afterBack.includes('<br>'), 'I3 Backspace 合回换行（撤销等价：恢复一格一源行）')
  assert.ok(afterBack.includes('甲 ![[目标笔笔记]]'), 'I3 恢复后格内容与嵌入完整')
  const reveal4 = await page4.evaluate(() => window.liveEmbedRevealStates())
  assert.ok(reveal4.some((s) => s.inner === '乙笔记|e'), 'I3 同格另一嵌入表条目健在')
  passed++
  console.log('[表格嵌入][PASS] I2/I3 格内 Enter 换行 + Backspace 合回（撤销等价）')
  assert.deepEqual(errors4, [], `page4 无页面错误（实际 ${JSON.stringify(errors4)}）`)
  await page4.close()

  // I4 外部同步（独立 page：doc.changed 的 deferredLocal 防线——本地待发
  // 集在场时外部增量会进入暂停而非应用；IME/Enter 轮的出站确认无宿主
  // 回流，干净页面直测外部通道本身）
  const { page: page5, errors: errors5 } = await setupPage(INPUT_DOC)
  const doc5 = () => page5.evaluate(() => window.liveEmbedDocText())
  const reqs5 = () => page5.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
  const textBeforeExt = await doc5()
  const extAt = textBeforeExt.indexOf('![[乙笔记\\|e]]')
  const oldLen = '![[乙笔记\\|e]]'.length
  await page5.evaluate(({ at, len }) => window.respondLiveEmbed({
    kind: 'doc.changed', version: 9, origin: 'external',
    changes: [{ offset: at, length: len, text: '![[外部目标\\|e]]' }],
  }), { at: extAt, len: oldLen })
  await page5.waitForTimeout(180)
  const afterExt = await doc5()
  assert.ok(afterExt.includes('![[外部目标\\|e]]'), 'I4 外部改写应用（转义管道保真）')
  assert.equal(afterExt.length, textBeforeExt.length + 1, `I4 单次应用不重复（长度 +1，实际 ${afterExt.length - textBeforeExt.length}）`)
  const extReqs = (await reqs5()).filter((r) => r.target === '外部目标|e')
  assert.ok(extReqs.length >= 1, `I4 重映射后新目标请求（实际 ${(await reqs5()).map((r) => r.target)}）`)
  const extReveal = await page5.evaluate(() => window.liveEmbedRevealStates())
  assert.ok(extReveal.some((s) => s.inner === '外部目标|e') && !extReveal.some((s) => s.inner === '乙笔记|e'),
    'I4 嵌入表旧条目撤下、新条目重映射')
  assert.deepEqual(errors5, [], `page5 无页面错误（实际 ${JSON.stringify(errors5)}）`)
  await page5.close()
  passed++
  console.log('[表格嵌入][PASS] I4 外部同步：doc.changed 重映射、转义保真、不重复应用')
} finally {
  await browser.close()
}
console.log(`tableEmbed: ${passed} scenarios passed`)
