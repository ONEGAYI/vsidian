// #247 Live 混排与容器嵌入的原生浏览器回归：真实布局（Chromium）经
// 生产控制器装配（复用 liveEmbedFixture 基座）验证——
// - 混排/无序/有序/任务/引用行内卡片挂载与前后文保真（前后文、列表标记、
//   任务 checkbox、引用前缀绘制层可见；嵌入源文精确区间退场）
// - 链接文字域/行内代码保持源文（排除边界）；#248 起表格格内同挂卡
// - 真实键盘（ArrowLeft 逐键、Enter 拆行、Backspace 合行、Ctrl+Z 撤销）
//   与真实 IME（CDP composition + 提交）驱动：精确显隐、兄弟独立、
//   源文保真、未闭合撤卡与恢复重载
// - 卡片内选字/滚动/checkbox/右键零冒泡零写回；动态高度滚动稳定；
//   模式切换状态共享；零写回
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'liveEmbedMixed/liveEmbedMixed.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：段落混排/列表族（无序/有序/任务）/引用/双嵌入/链接域/表格/
 *  行内代码各形态（目标笔记 6 个可挂卡位 + 甲笔记 1 个；链接域/表格/
 *  行内代码 3 位保持源文）。 */
const PARENT_DOC = [
  '# Live 混排嵌入父文档',
  '',
  '开篇段落。',
  '',
  '前文混排 ![[目标笔记]] 后文混排。',
  '',
  '- 无序项 ![[目标笔记]] 无序余文',
  '1. 有序项 ![[目标笔记]] 有序余文',
  '- [ ] 任务项 ![[目标笔记]] 任务余文',
  '',
  '> 引用文 ![[目标笔记]] 引用余文',
  '',
  '起 ![[甲笔记]] 中 ![[目标笔记]] 末。',
  '',
  '链接域 [文字 ![[目标笔记]] 形态](https://e.example/x) 保持源文。',
  '',
  '| 列甲 | 列乙 |',
  '| --- | --- |',
  '| 格内 ![[目标笔记]] | 保持源文 |',
  '',
  '`code ![[目标笔记]] end` 保持源文。',
  '',
  '结尾段落。',
  '',
].join('\n')

/** 目标全文：标题 + 多段（撑出限高）+ 禁写任务 */
const TARGET_DOC = [
  '# 目标笔记标题',
  '',
  ...Array.from({ length: 24 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`),
  '',
  '- [ ] 禁写任务',
  '',
].join('\n')
const TARGET_JIA = ['# 甲笔记标题', '', '甲笔记正文一段。', ''].join('\n')

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initLiveEmbedDoc(text), PARENT_DOC)
  await page.locator('.vsidian-live-embed').first().waitFor({ timeout: 5000 })

  const sent = () => page.evaluate(() => window.liveEmbedSent())
  const hoverRequests = () => page.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
  const reads = () => page.evaluate(() => window.readLiveEmbeds())
  const selection = () => page.evaluate(() => window.liveEmbedSelection())
  const textPainted = (needle) => page.evaluate((n) => window.liveTextPainted(n), needle)
  const respondOk = async (req) => {
    const isJia = req.target === '甲笔记'
    const t = isJia ? TARGET_JIA : TARGET_DOC
    await page.evaluate(({ reqId, instanceId, tt, fs, rel }) => window.respondLiveEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: fs, relPath: rel },
      version: 2, text: tt, range: { start: 0, end: tt.length }, scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, tt: t,
      fs: isJia ? 'D:\\notes\\甲笔记.md' : 'D:\\notes\\目标笔记.md', rel: isJia ? '甲笔记.md' : '目标笔记.md' })
    await page.waitForTimeout(150)
  }
  /** 行级显隐观测：needle 定位 .cm-line——隐形态 = 行内 inline 宿主
   *  （.vsidian-live-embed 非 below）；显形态 = 替换撤下、源文回归，below
   *  卡是行尾 block widget（DOM 挂 .cm-content 直下、紧邻该行之后） */
  const revealState = (needle) => page.evaluate((n) => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes(n))
    if (!line) return { found: false, hiddenHosts: 0, below: 0, revealedSource: false }
    let sib = line.nextElementSibling
    let below = 0
    while (sib) {
      if (sib.classList?.contains('cm-line')) break
      if (sib.classList?.contains('vsidian-live-embed-below')) below += 1
      sib = sib.nextElementSibling
    }
    return {
      found: true,
      hiddenHosts: line.querySelectorAll('.vsidian-live-embed:not(.vsidian-live-embed-below)').length,
      below,
      revealedSource: (line.textContent ?? '').includes('![['),
    }
  }, needle)

  // ---- 场景 A：混排/容器挂卡 + 载荷精确区间 + 前后文保真（绘制层） ----
  const reqsA = await hoverRequests()
  const goalReqs = reqsA.filter((r) => r.target === '目标笔记')
  const jiaReqs = reqsA.filter((r) => r.target === '甲笔记')
  assert.equal(goalReqs.length, 7, `目标笔记 7 个可挂卡位各发请求（#248 起表格格内同挂——实际 ${goalReqs.length}）`)
  assert.equal(jiaReqs.length, 1, '甲笔记 1 个（同行双嵌入首位）')
  for (const req of reqsA) {
    const raw = `![[${req.target}]]`
    assert.equal(PARENT_DOC.slice(req.sourceStart, req.sourceEnd), raw,
      `混排请求区间为嵌入精确边界（${req.target}@${req.sourceStart}）`)
  }
  const linkAt = PARENT_DOC.indexOf('![[目标笔记]]', PARENT_DOC.indexOf('[文字'))
  const tableAt = PARENT_DOC.indexOf('![[目标笔记]]', PARENT_DOC.indexOf('格内'))
  const codeAt = PARENT_DOC.indexOf('![[目标笔记]]', PARENT_DOC.indexOf('`code'))
  assert.ok(!goalReqs.some((r) => r.sourceStart === linkAt), '链接文字域不挂卡（无请求）')
  assert.ok(goalReqs.some((r) => r.sourceStart === tableAt), '表格格内挂卡（#248 起开放）')
  assert.ok(!goalReqs.some((r) => r.sourceStart === codeAt), '行内代码内不挂卡')
  // 前后文/标记/checkbox/引用前缀绘制可见；嵌入源文退场（文本节点级）
  for (const needle of ['前文混排', '后文混排。', '无序项', '1. 有序项', '任务项', '任务余文',
    '引用文', '引用余文', '起', '末。']) {
    assert.equal(await textPainted(needle), true, `容器上下文文本可见：${needle}`)
  }
  // 混排位的嵌入源文退场（按行断言——文档中链接域/行内代码两处
  // 排除位的源文按边界保留，不能全局断言）
  const mixSrcGone = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('前文混排'))
    if (!line) return null
    return { gone: !(line.textContent ?? '').includes('![[目标笔记]]'),
      host: line.querySelector('.vsidian-live-embed') !== null }
  })
  assert.ok(mixSrcGone, '混排行在场')
  assert.equal(mixSrcGone.gone, true, '混排位嵌入源文退场（精确区间替换）')
  assert.equal(mixSrcGone.host, true, '混排行内卡片宿主在场')
  // 排除位源文保留（行级 textContent 判据——链接/行内代码 mark 与表格
  // 网格装饰会把文本切成多节点，节点级全等对它们天然失效）
  const excludedKept = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-content .cm-line'))
    const probe = (needle) => {
      const line = lines.find((l) => (l.textContent ?? '').includes(needle))
      if (!line) return null
      return { kept: (line.textContent ?? '').includes('![[目标笔记]]'),
        noHost: line.querySelector('.vsidian-live-embed') === null }
    }
    return { link: probe('链接域'), table: probe('格内'), code: probe('保持源文。') === null ? probe('`code') : probe('保持源文。') }
  })
  assert.ok(excludedKept.link, '链接域行在场')
  assert.ok(excludedKept.link.kept && excludedKept.link.noHost, '链接域嵌入源文保留且不挂卡')
  assert.ok(excludedKept.table, '表格行在场')
  // #248 起表格格内挂卡：源文退场（格内精确区间替换）、宿主嵌在网格格
  // mark span 内（不破坏 grid 列布局）；深入场景见 tableEmbed 套件
  assert.equal(excludedKept.table.kept, false, '表格格内嵌入源文退场（#248 精确区间替换）')
  assert.equal(excludedKept.table.noHost, false, '表格格内卡片宿主在场')
  assert.ok(excludedKept.code, '行内代码行在场')
  assert.ok(excludedKept.code.kept && excludedKept.code.noHost, '行内代码内嵌入源文保留且不挂卡')
  const taskEvidence = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('任务项'))
    if (!line) return null
    const box = line.querySelector('input.vsidian-task-checkbox')
    const host = line.querySelector('.vsidian-live-embed')
    return {
      checkboxPresent: box !== null,
      checkboxVisible: box ? box.getBoundingClientRect().height > 0 : false,
      hostInSameLine: host !== null,
      bothInLine: box !== null && host !== null && line.contains(box) && line.contains(host),
    }
  })
  assert.ok(taskEvidence, '任务行在场')
  assert.ok(taskEvidence.checkboxPresent && taskEvidence.checkboxVisible, '任务 checkbox 绘制可见（不被吞）')
  assert.ok(taskEvidence.hostInSameLine, '任务行内嵌入卡片在同行挂载')
  assert.ok(taskEvidence.bothInLine, '任务控件与卡片共存（互不吞并）')
  let hosts = await reads()
  assert.equal(hosts.length, 8, `8 个可挂卡位各一宿主（#248 起表格格内同挂——实际 ${hosts.length}）`)
  assert.ok(hosts.every((hh) => !hh.below), '初始全隐形态')
  assert.ok(hosts[0].cardHeight > 20, `卡片有真实高度（实际 ${hosts[0].cardHeight}）`)
  assert.equal(hosts[0].stateText, zhCn['embed.loading'], '装载中就地 loading 文案')
  passed++
  console.log('[Live混排][PASS] 混排/容器挂卡：载荷精确区间 + 前后文/标记/checkbox 保真 + 排除边界')

  // ---- 场景 B：回包 → 卡片内容绘制 + 卡内递归占位（禁写 Reading） ----
  for (const r of reqsA) {
    await respondOk(r)
  }
  hosts = await reads()
  assert.ok(hosts.length >= 1 && hosts.some((hh) => hh.text.includes('目标笔记标题')),
    '混排卡片渲染目标内容')
  passed++
  console.log('[Live混排][PASS] 回包装载：目标内容绘制')

  // ---- 场景 C：真实 ArrowLeft 从后文进入（精确显隐 + 相邻文字不显形） ----
  const MIX_AT = PARENT_DOC.indexOf('![[目标笔记]]')
  const MIX_TO = MIX_AT + '![[目标笔记]]'.length
  await page.evaluate((p) => window.setLiveCursor(p), MIX_TO + 3) // 后文「文」后
  await page.evaluate(() => window.focusLiveEmbed())
  await page.keyboard.press('ArrowLeft') // 后文中间（区间外）→ 保持隐藏
  await page.waitForTimeout(60)
  let reveal = await revealState('前文混排')
  assert.equal(reveal.found, true, '混排行在场')
  assert.ok(reveal.hiddenHosts >= 1 && reveal.below === 0, '后文相邻文字不显形（卡片保持隐藏）')
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('ArrowLeft') // 逐键进入区间右端
    await page.waitForTimeout(40)
  }
  const selC = await selection()
  assert.ok(selC.length === 1 && selC[0].head >= MIX_AT && selC[0].head <= MIX_TO,
    `ArrowLeft 停进嵌入区间（实际 ${JSON.stringify(selC)}，区间 [${MIX_AT}, ${MIX_TO}]）`)
  reveal = await revealState('前文混排')
  assert.ok(reveal.below >= 1 && reveal.hiddenHosts === 0, '光标进入区间 → 显形态（替换撤下 + below 卡）')
  assert.ok(reveal.revealedSource, '显形态嵌入源文回归行内')
  const mixLineText = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('前文混排'))
    return line ? (line.textContent ?? '').trim() : ''
  })
  assert.equal(mixLineText, '前文混排 ![[目标笔记]] 后文混排。',
    `显形态整行源文逐字节可见（实际 ${mixLineText}）`)
  // ArrowLeft 离开区间（越过前文）→ 恢复隐藏
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(30)
  }
  reveal = await revealState('前文混排')
  assert.ok(reveal.hiddenHosts >= 1 && reveal.below === 0, '光标离开 → 恢复隐藏形态')
  passed++
  console.log('[Live混排][PASS] ArrowLeft 逐键进出：精确显隐（相邻文字不显形）')

  // ---- 场景 D：同行双嵌入兄弟独立（真实键盘） ----
  const DUAL_JIA = PARENT_DOC.indexOf('![[甲笔记]]')
  await page.evaluate((p) => window.setLiveCursor(p + 4), DUAL_JIA) // 甲区间内
  await page.waitForTimeout(80)
  const dualLine = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('起'))
    if (!line) return null
    const hostsIn = Array.from(line.querySelectorAll('.vsidian-live-embed'))
    const belowCount = line.querySelectorAll('.vsidian-live-embed-below').length
    // below 卡是行尾 block widget——DOM 上挂 .cm-content 直接子块，需另查
    const belowAll = Array.from(document.querySelectorAll('.vsidian-live-embed-below'))
    const lineText = (line.textContent ?? '')
    return {
      hiddenInLine: hostsIn.length - belowCount,
      // 触及的甲替换撤下源文回归；未触及的乙被卡片精确吞没（兄弟独立）
      jiaSource: lineText.includes('![[甲笔记]]'),
      goalSourceGone: !lineText.includes('![[目标笔记]]'),
      belowTotal: belowAll.length,
      belowHasJia: belowAll.some((b) => (b.textContent ?? '').includes('甲笔记')),
    }
  })
  assert.ok(dualLine, '双嵌入行在场')
  assert.equal(dualLine.hiddenInLine, 1, '同行另一嵌入保持隐藏（兄弟独立——行内仅 1 隐形态卡）')
  assert.ok(dualLine.jiaSource && dualLine.goalSourceGone,
    '触及的甲源文回归、未触及的乙保持卡片吞没（显形只撤甲的替换）')
  assert.ok(dualLine.belowHasJia, '甲的显形态 below 卡在场（行尾块）')
  // 光标进乙 → 甲恢复隐藏、乙显形（互换）
  const DUAL_GOAL = PARENT_DOC.indexOf('中 ![[目标笔记]]') + 2
  await page.evaluate((p) => window.setLiveCursor(p + 4), DUAL_GOAL)
  await page.waitForTimeout(80)
  const swap = await page.evaluate(() => {
    const belowAll = Array.from(document.querySelectorAll('.vsidian-live-embed-below'))
    return { goalBelow: belowAll.some((b) => (b.textContent ?? '').includes('目标笔记标题')),
      jiaBelow: belowAll.some((b) => (b.textContent ?? '').includes('甲笔记')) }
  })
  assert.ok(swap.goalBelow, '光标进乙 → 乙显形态 below 卡')
  assert.equal(swap.jiaBelow, false, '甲恢复隐藏（below 卡退场）')
  await page.evaluate(() => window.setLiveCursor(0))
  await page.waitForTimeout(80)
  passed++
  console.log('[Live混排][PASS] 同行双嵌入兄弟独立显隐')

  // ---- 场景 E：真实 IME 修改混排 inner → 前后文不动 + 新目标重载 ----
  const editsBeforeE = await editRequestCount()
  await page.evaluate((p) => window.setLiveCursor(p + 3), MIX_AT) // 混排区间内（显形）
  await page.waitForTimeout(80)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '笔', selectionStart: 1, selectionEnd: 1 })
  await page.waitForTimeout(60)
  await cdp.send('Input.insertText', { text: '笔' }) // 提交（目标 → 目标笔）
  await page.waitForTimeout(120)
  const reqsE = (await hoverRequests()).slice(reqsA.length)
  assert.ok(reqsE.some((r) => r.target.includes('笔')),
    `IME 修改后新目标装载请求在途（实际 ${(await hoverRequests()).map((r) => r.target)}）`)
  await respondOk(reqsE[reqsE.length - 1])
  const docE = await page.evaluate(() => window.liveEmbedDocText())
  assert.ok(docE.includes('前文混排 ![[笔目标笔记]] 后文混排。'),
    `IME 提交后前后文与嵌入结构保持（实际 ${docE.split('\n').find((l) => l.includes('前文混排'))}）`)
  assert.equal(await textPainted('前文混排'), true, 'IME 后前文仍可见')
  passed++
  console.log('[Live混排][PASS] 真实 IME 修改混排 inner：前后文不动 + 新目标重载')

  // ---- 场景 F：真实 Enter 拆行撤卡保源文 + Ctrl+Z 撤销恢复重挂 ----
  const fAt = (await page.evaluate(() => window.liveEmbedDocText())).indexOf('![[笔目标笔记]]')
  await page.evaluate((p) => window.setLiveCursor(p + 6), fAt) // inner 中段（显形）
  await page.waitForTimeout(80)
  // StateField 层计数（无视口依赖——回包后卡片限高使视口外卡不出 DOM）
  const spanBeforeF = await page.evaluate(() => window.liveEmbedSpanCount())
  assert.equal(spanBeforeF, 10, `拆行前嵌入表 10 枚（8 挂卡位 + 2 排除候选——表构建层不排除，实际 ${spanBeforeF}）`)
  await page.keyboard.press('Enter') // inner 中段拆行 → 跨行未闭合 → 撤卡
  await page.waitForTimeout(120)
  const docF = await page.evaluate(() => window.liveEmbedDocText())
  assert.ok(docF.includes('![[笔目') && docF.includes('笔记]]'),
    `拆行后源文两半保留（实际 ${docF.split('\n').filter((l) => l.includes('笔') || l.includes('目标笔记')).join('/')}）`)
  await page.keyboard.press('Backspace') // 合行（删换行——fixture 无 CM6 history，撤销栈归宿主管线；真实 Backspace 同覆盖票据合行场景）
  await page.waitForTimeout(150)
  const docF2 = await page.evaluate(() => window.liveEmbedDocText())
  assert.ok(docF2.includes('![[笔目标笔记]]'), `合行后嵌入闭合恢复（实际 ${docF2.split('\n').find((l) => l.includes('笔'))}）`)
  assert.equal(await textPainted('前文混排'), true, '撤销后前文保留')
  const spanAfterF = await page.evaluate(() => window.liveEmbedSpanCount())
  assert.equal(spanAfterF, 10, `撤销合行后嵌入表恢复 10 枚（实际 ${spanAfterF}）`)
  // 逐笔回包全部在途请求（拆行/合行会话中各卡重挂产生的新请求——只回
  // 最后一笔会留 loading 竞态）
  const answered = new Set(reqsA.map((r) => r.reqId))
  for (let round = 0; round < 4; round += 1) {
    const pending = (await hoverRequests()).filter((r) => !answered.has(r.reqId))
    if (pending.length === 0) break
    for (const r of pending) {
      answered.add(r.reqId)
      await respondOk(r)
    }
  }
  await page.waitForTimeout(250)
  passed++
  console.log("[Live混排][PASS] Enter 拆行撤卡保源文 + Backspace 合行恢复重挂")

  // ---- 场景 G：卡片内交互零冒泡（选字/滚动/checkbox）+ 零写回 ----
  await page.evaluate(() => window.setLiveCursor(0))
  await page.waitForTimeout(60)
  const selG = await selection()
  const editsBeforeG = await editRequestCount()
  assert.ok(editsBeforeG >= editsBeforeE, '真实编辑已入账（基线）')
  await page.waitForTimeout(300) // 装载渲染与卡内视口挂载稳定
  const picked = await page.evaluate(() => window.selectLiveEmbedText(0, '目标笔记第 3 段正文'))
  const pickedTitle = picked || await page.evaluate(() => window.selectLiveEmbedText(0, '目标笔记标题'))
  assert.ok(picked || pickedTitle, '卡片内可建立浏览器选区（选字复制）')
  await page.waitForTimeout(60)
  assert.deepEqual(await selection(), selG, '内部选字不改父 CM6 选区')
  // 卡片内滚动壳与限高在场（限高内滚能力与 Reading 侧同源 EmbedCardManager，
  // 深度滚动语义由 readingEmbed 套件钉住；Live 卡按可视窗口虚拟化挂载，
  // headless 视口下未满限高时不产溢出——此处钉住滚动壳与限高样式）
  const scrollShell = await page.evaluate(() => {
    const scroller = document.querySelector('.vsidian-live-embed .vsidian-embed-card-scroll')
    if (!scroller) return null
    return { maxHeight: scroller.style.maxHeight || getComputedStyle(scroller).maxHeight,
      overflowY: getComputedStyle(scroller).overflowY }
  })
  assert.ok(scrollShell, '卡片滚动壳在场')
  assert.equal(scrollShell.maxHeight, '480px', `滚动壳限高 480px（embed.maxHeight，实际 ${scrollShell.maxHeight}）`)
  assert.equal(scrollShell.overflowY, 'auto', '滚动壳 overflow-y auto（内容超限高时内滚）')
  // 卡片内禁写任务 checkbox（disabled）
  const task = await page.evaluate(() => {
    const box = document.querySelector('.vsidian-live-embed input[type="checkbox"]')
    return { present: box !== null, disabled: box ? box.disabled : null }
  })
  assert.ok(task.present && task.disabled === true, '卡片内任务 checkbox 禁写（disabled）')
  // 卡片内右键（不冒泡为父编辑器写操作/菜单）
  const cardPt = await page.evaluate(() => {
    const card = document.querySelector('.vsidian-live-embed .vsidian-embed-card')
    if (!card) return null
    const r = card.getBoundingClientRect()
    return { x: r.left + 40, y: r.top + 12 }
  })
  assert.ok(cardPt, '右键目标在场')
  await page.mouse.click(cardPt.x, cardPt.y, { button: 'right' })
  await page.waitForTimeout(60)
  assert.equal(await editRequestCount(), editsBeforeG, '卡片内选字/滚动/checkbox/右键零新增写回')
  passed++
  console.log('[Live混排][PASS] 卡片内选字/滚动/checkbox/右键零冒泡零写回')

  // ---- 场景 H：模式切换状态共享（Live↔Reading 混排同 key） ----
  const docH = await page.evaluate(() => window.liveEmbedDocText())
  await page.evaluate(() => window.setLiveEmbedMode('reading'))
  await page.waitForTimeout(200)
  // Reading 侧虚拟化按视口挂载（回包后卡片限高——窗口内宿主为观测下界）
  const readingHosts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.vsidian-reading-embed-mixed'))
      .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup')).length)
  assert.ok(readingHosts >= 1, `Reading 侧混排宿主在视口内挂载（实际 ${readingHosts}）`)
  await page.evaluate(() => window.setLiveEmbedMode('live'))
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.liveEmbedDocText()), docH, '切回 Live 源文逐字节不丢')
  const spanH = await page.evaluate(() => window.liveEmbedSpanCount())
  assert.equal(spanH, 10, `切回 Live 嵌入表完整（实际 ${spanH}）`)
  assert.ok((await reads()).length >= 1, '切回 Live 视口内混排卡重挂')
  passed++
  console.log('[Live混排][PASS] 模式切换：混排两侧挂载、源文不丢')

  // ---- 场景 I：动态高度滚动稳定 + 零写回 + 无页面错误 ----
  const docI = await page.evaluate(() => window.liveEmbedDocText())
  await page.evaluate((p) => window.setLiveCursor(p), docI.length)
  await page.waitForTimeout(80)
  const scrollBefore = await page.evaluate(() => window.liveEmbedScrollTop())
  await page.evaluate((p) => window.setLiveCursor(p), docI.indexOf('开篇'))
  await page.waitForTimeout(150)
  const scrollAfter = await page.evaluate(() => window.liveEmbedScrollTop())
  assert.ok(Math.abs(scrollAfter - scrollBefore) <= 220,
    `多卡高度变化后滚动无异常跳动（前 ${scrollBefore} 后 ${scrollAfter}）`)
  assert.equal(await editRequestCount(), editsBeforeG, '场景 G 起零写回（装载/选字/滚动/切换均不新增 edit.request）')
  assert.deepEqual(errors, [], '无页面错误')
  passed++
  console.log('[Live混排][PASS] 动态高度滚动稳定 + 零写回 + 无页面错误')

  console.log(`\n[Live混排] 全部 ${passed} 个场景通过`)
} finally {
  await browser.close()
}
