// 可读文本嵌入的原生浏览器回归（#341 / P3-09）：真实布局（Chromium）下
// 经生产控制器验证——文本目标嵌入卡在全部容器（正文独占行/列表与引用混排/
// 表格格内/Live widget）挂载渲染、#range 硬窗口（范围外不渲染不可滚达、
// 行号绝对值）与 #line 定位及组合、同目标不同锚点 occurrence 滚动独立、
// token 分层着色（计算色断言——视觉层断言对象是用户看到的颜色）、DOM
// 常驻受视口约束（探针 textStats）、视口回收重挂状态保持与缓存零重发、
// 外观广播静默重载、锚点非法就地报错（细分文案）与零写回。
// 宿主回包由脚本注入（respondEmbed → handleHostMessage 同入口）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'textEmbed/textEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/textEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：独占行全文 + 列表/引用混排 + 表格头/数据格（窗口与全文）+
 *  独占行硬窗口/组合定位/非法锚点 + 尾部长段（视口回收场景） */
const PARENT_DOC = [
  '# 文本嵌入父文档',
  '',
  '开篇正文，先铺垫一段。',
  '',
  '![[code.ts]]',
  '',
  '- 列表混排 ![[code.ts]] 项内',
  '',
  '> 引用混排 ![[code.ts]] 文内',
  '',
  '| ![[code.ts#range=10-20]] | 普通列头 |',
  '| --- | --- |',
  '| 格内 ![[code.ts]] 全文 | 数据格 |',
  '',
  '![[code.ts#range=10-20]]',
  '',
  '![[code.ts#line=25;range=10-60]]',
  '',
  '![[code.ts#line=9;range=10-20]]',
  '',
  ...Array.from({ length: 220 }, (_, i) => `父文档尾部第 ${i + 1} 段：把全文撑出多屏，滚动到底部时首屏嵌入块应被视口回收（buffer 约 960px，须显著超出）。`),
  '',
].join('\n')

/** 目标全文（120 行；行号/着色断言按此手算） */
const FULL_TEXT = Array.from({ length: 120 }, (_, i) => `const field${i + 1} = ${i + 1};`).join('\n')
/** #range=10-20 硬窗口正文（宿主侧已裁剪——载荷只含窗口行） */
const WINDOW_TEXT = Array.from({ length: 11 }, (_, i) => `const field${i + 10} = ${i + 10};`).join('\n')
/** #range=10-60 大窗口正文（51 行 > 视口——#line 定位可观测） */
const BIG_WINDOW_TEXT = Array.from({ length: 51 }, (_, i) => `const field${i + 10} = ${i + 10};`).join('\n')
const LINE_HEIGHT = 22.5 // 15px 字号 × 1.5 行高倍数（语言级字体生效值）

const { islandHtml } = await buildZhLocaleIsland(root)

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
  await page.evaluate((text) => window.initEmbedDoc(text), PARENT_DOC)
  await page.locator('.vsidian-view-reading .vsidian-embed-card').first().waitFor({ timeout: 5000 })

  const sentAll = () => page.evaluate(() => window.embedSent())
  const hoverRequests = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'hover.request'))
  const tokenRequests = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'hover.tokens.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'edit.request').length)

  /** 定位到指定 inner 的嵌入块：目标块未挂载时宿主不在 DOM——从顶步进
   *  扫描使虚拟视图逐段挂载，找到后滚动到位（返回 -1 = 扫描全程未见） */
  const seekEmbed = async (inner) => {
    await page.evaluate(() => window.scrollReadingTo(0))
    await page.waitForTimeout(150)
    for (let attempt = 0; attempt < 26; attempt++) {
      const found = await page.evaluate((arg) => window.scrollToEmbedInner(arg), inner)
      if (found >= 0) {
        await page.waitForTimeout(220)
        return found
      }
      await page.evaluate(() => window.scrollReadingTo(window.embedReadingTop() + 400))
      await page.waitForTimeout(130)
    }
    return -1
  }


  /** text 成功回包（与 documentSession 出站形态一致；nav 覆写窗口字段） */
  const respondText = async (req, { text, version = 5, target = 'code.ts', nav = {} }) => {
    await page.evaluate((args) => window.respondEmbed({
      kind: 'hover.result',
      reqId: args.req.reqId, instanceId: args.req.instanceId, ok: true,
      contentKind: 'text',
      target: { fsPath: 'D:\\notes\\code.ts', relPath: args.target },
      version: args.version, text: args.text,
      range: { start: 0, end: args.text.length }, scope: { kind: 'full' },
      textNav: {
        languageId: 'typescript', hasWindow: false, beginLine: 1, endLine: 120,
        locateLine: 1, jumpLine: 1, totalLines: 120,
        fontFamily: 'Consolas, monospace', fontSize: 15, lineNumbers: true,
        ...args.nav,
      },
    }), { req, text, version, target, nav })
  }

  // ---- 场景 0：八个 occurrence 全部出站装载请求（容器矩阵：独占行/混排×2/
  //      表格头窗口/表格数据格全文/独占行窗口/组合/非法）----
  // 装载中卡片低矮：分步滚动父文档使全部嵌入块进入挂载窗口，收集请求。
  for (let step = 0; (await hoverRequests()).length < 8 && step < 12; step++) {
    await page.evaluate((top) => window.scrollReadingTo(top), 320 * (step + 1))
    await page.waitForTimeout(120)
  }
  await page.evaluate(() => window.scrollReadingTo(0))
  await page.waitForTimeout(200)
  const reqs0 = await hoverRequests()
  assert.equal(reqs0.length, 8, `八个文本嵌入 occurrence 各发一笔装载请求（实际 ${reqs0.length}）`)
  const reqOf = (inner) => {
    const req = reqs0.find((r) => r.target === inner)
    assert.ok(req, `目标 ${inner} 的装载请求应在途`)
    return req
  }
  const FULL = 'code.ts'
  const WIN = 'code.ts#range=10-20'
  const COMBO = 'code.ts#line=25;range=10-60'
  const BAD = 'code.ts#line=9;range=10-20'
  const ownFullReq = reqOf(FULL) // 同 inner 四处 occurrence 的首笔（独占行）
  const windowNav = { hasWindow: true, beginLine: 10, endLine: 20, locateLine: 10, jumpLine: 10 }
  // 回包：全文四处同载荷；窗口两处（表头 + 独占行）窗口载荷；组合带定位；非法回锚点错误
  for (const req of reqs0.filter((r) => r.target === FULL)) {
    await respondText(req, { text: FULL_TEXT })
  }
  for (const req of reqs0.filter((r) => r.target === WIN)) {
    await respondText(req, { text: WINDOW_TEXT, nav: windowNav })
  }
  await respondText(reqOf(COMBO), { text: BIG_WINDOW_TEXT,
    nav: { hasWindow: true, beginLine: 10, endLine: 60, locateLine: 25, jumpLine: 25 } })
  await page.evaluate((args) => window.respondEmbed({
    kind: 'hover.result', reqId: args.reqId, instanceId: args.instanceId, ok: false,
    reason: 'anchor-invalid', anchor: 'line=9;range=10-20', anchorDetail: 'line-outside-window',
  }), reqOf(BAD))
  await page.waitForTimeout(200)
  passed++
  console.log('[文本嵌入][PASS] 容器矩阵八 occurrence 装载请求与回包配对')

  // ---- 场景 A：独占行全文卡——文本视图/绝对行号/只读 chrome/视口约束 ----
  assert.ok(await seekEmbed('code.ts') >= 0, 'code.ts 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  let cards = await page.evaluate(() => window.readTextCards())
  const ownCard = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  assert.ok(ownCard, `独占行全文卡应渲染文本视图（得 ${cards.map((c) => c.gutterNumbers.slice(0, 2))}）`)
  assert.equal(ownCard.stateVisible, false, '装载成功后状态行隐藏（内容态）')
  assert.equal(ownCard.title, 'code.ts', '顶部文件名为目标根内相对路径')
  assert.equal(ownCard.modeBtnHidden, true, 'text 只读边界：模式切换按钮隐藏')
  assert.equal(ownCard.lineCount < 60, true,
    `120 行全文 DOM 常驻受视口约束（实际 ${ownCard.lineCount} 行）`)
  assert.ok(Number(ownCard.gutterNumbers.at(-1)) < 60,
    `首屏行号窗口从 1 起有界（末位 ${ownCard.gutterNumbers.at(-1)}）`)
  const probe0 = await page.evaluate(() => window.embedTextProbe())
  const fullStats = probe0.find((p) => p.textStats?.totalLines === 120)
  assert.ok(fullStats, '探针 textStats 在场（markdown 卡为 null，text 卡有虚拟化统计）')
  assert.equal(fullStats.textStats.totalLines, 120)
  assert.ok(fullStats.textStats.renderedLines > 0 && fullStats.textStats.renderedLines < 60,
    `探针 renderedLines 受视口约束（实际 ${fullStats.textStats.renderedLines}）`)
  assert.equal(fullStats.internalMode, 'reading', 'text 卡内部模式恒 reading')
  assert.equal(fullStats.liveBound, false, 'text 卡零编辑端口绑定')
  const bindCount = (await sentAll()).filter((m) => m.kind === 'refEdit.bind').length
  assert.equal(bindCount, 0, '全程零 refEdit.bind（只读文本无写端口）')
  passed++
  console.log('[文本嵌入][PASS] 独占行全文卡：文本视图/行号/只读边界/视口约束')

  // ---- 场景 B：token 分层着色（计算色）+ 末行远距离滚动可见 ----
  const tokenReqs = await tokenRequests()
  const ownTokenReq = tokenReqs.find((t) => t.instanceId === ownFullReq.occurrenceId)
  assert.ok(ownTokenReq, '全文卡装载后 token 请求出站（hostId 身份配对）')
  assert.equal(ownTokenReq.version, 5, 'token 请求携带装载版本')
  assert.equal(ownTokenReq.beginLine, 1, '无窗口全文 token 请求从首行起')
  assert.equal(ownTokenReq.endLine, 120)
  // 语法层：首行与末行 const → #569cd6（行坐标窗口内相对，deltaLine 编码）
  await page.evaluate((args) => window.respondEmbed({
    kind: 'hover.tokens', reqId: args.reqId, instanceId: args.instanceId, ok: true,
    fsPath: 'D:\\notes\\code.ts', version: 5, layer: 'textmate',
    colors: ['#569cd6'], tokens: [0, 0, 5, 0, 0, 119, 0, 5, 0, 0],
  }), ownTokenReq)
  // 语义层覆盖：首行 field1 → #00ffaa
  await page.evaluate((args) => window.respondEmbed({
    kind: 'hover.tokens', reqId: args.reqId, instanceId: args.instanceId, ok: true,
    fsPath: 'D:\\notes\\code.ts', version: 5, layer: 'semantic',
    colors: ['#00ffaa'], tokens: [0, 6, 6, 0, 0],
  }), ownTokenReq)
  await page.waitForTimeout(120)
  cards = await page.evaluate(() => window.readTextCards())
  let card = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  const kw = card.spans.find((s) => s.text === 'const')
  assert.ok(kw && kw.color.includes('86, 156, 214'), `语法层着色为真实计算色（得 ${kw?.color}）`)
  assert.ok(kw.painted && kw.inViewport, '着色 span 绘制层可见')
  const ident = card.spans.find((s) => s.text === 'field1')
  assert.ok(ident && ident.color.includes('0, 255, 170'), `语义层覆盖为 #00ffaa（得 ${ident?.color}）`)
  passed++
  // 远距离滚动到末行：第 120 行真实着色可见，DOM 常驻仍有界
  await page.evaluate(() => {
    const cards = window.readTextCards()
    const idx = cards.findIndex((c) => !c.inTableCell && c.gutterNumbers.length > 20)
    window.scrollEmbedCard(idx, 999999)
  })
  await page.waitForTimeout(150)
  cards = await page.evaluate(() => window.readTextCards())
  card = cards.find((c) => c.gutterNumbers.at(-1) === '120')
  assert.ok(card, '滚动后末行窗口在场')
  assert.equal(card.lineCount < 60, true, `末屏 DOM 常驻仍有界（实际 ${card.lineCount}）`)
  const tailKw = card.spans.find((s) => s.text === 'const')
  assert.ok(tailKw && tailKw.color.includes('86, 156, 214'), `末行 const 真实着色（得 ${tailKw?.color}）`)
  assert.ok(tailKw.painted && tailKw.inViewport, '末行着色 span 绘制层可见')
  assert.equal(card.lineTexts.includes('const field120 = 120;'), true, '末行内容在绘制层（行文本在场）')
  const ownScrollAfterBottom = card.scrollTop
  assert.ok(ownScrollAfterBottom > 1000, `全文卡滚到末行（scrollTop=${ownScrollAfterBottom}）`)
  passed++
  console.log('[文本嵌入][PASS] token 分层着色（语法+语义计算色）+ 末行远距离滚动可见')

  // ---- 场景 C：#range=10-20 硬窗口——窗口外不渲染、行号绝对、不可滚达 ----
  assert.ok(await seekEmbed('code.ts#range=10-20') >= 0, 'code.ts#range=10-20 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  cards = await page.evaluate(() => window.readTextCards())
  const winCard = cards.find((c) => c.gutterNumbers[0] === '10' && c.gutterNumbers.length <= 16)
  assert.ok(winCard, `硬窗口卡应渲染 10-20 窗口（得 ${cards.map((c) => c.gutterNumbers.slice(0, 2))}）`)
  assert.deepEqual(winCard.gutterNumbers,
    Array.from({ length: 11 }, (_, i) => String(10 + i)), '行号从 beginLine=10 起算（绝对行）')
  assert.equal(winCard.lineTexts.includes('const field10 = 10;'), true, '窗口首行在场')
  assert.equal(winCard.lineTexts.includes('const field20 = 20;'), true, '窗口末行在场')
  assert.equal(winCard.lineTexts.includes('const field9 = 9;'), false, '窗口外（前行）不渲染')
  assert.equal(winCard.lineTexts.includes('const field21 = 21;'), false, '窗口外（后行）不渲染')
  assert.ok(winCard.scrollHeight <= winCard.clientHeight + 2,
    `硬窗口不可滚达（scroll ${winCard.scrollHeight} ≤ client ${winCard.clientHeight}）`)
  // 窗口卡 token 请求按窗口配对（begin=10/end=20）
  const winTokenReq = (await tokenRequests()).findLast((t) =>
    t.instanceId === reqOf(WIN).occurrenceId && t.beginLine === 10)
  assert.ok(winTokenReq, '窗口卡 token 请求按窗口行配对')
  assert.equal(winTokenReq.endLine, 20)
  // 组合定位卡（#line=25;range=10-60）：初始滚动位置 = (25-10) × 行高
  assert.ok(await seekEmbed('code.ts#line=25;range=10-60') >= 0, 'code.ts#line=25;range=10-60 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  cards = await page.evaluate(() => window.readTextCards())
  // 定位后首行号随滚动窗移动（视口显示 17-55），按「非表格格内 + 大窗口
  // + 已滚动」判别组合卡
  const comboCard = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 16 && c.scrollTop > 0)
  assert.ok(comboCard, '组合定位卡在场且已定位')
  assert.ok(Math.abs(comboCard.scrollTop - 15 * LINE_HEIGHT) < 12,
    `#line=25 初始定位到窗口内第 15 行（实际 scrollTop=${comboCard.scrollTop}）`)
  passed++
  console.log('[文本嵌入][PASS] #range=10-20 硬窗口：窗口外不渲染/行号绝对/不可滚达/#line 组合定位')

  // ---- 场景 D：同目标不同锚点 occurrence 滚动独立（窗口互不串用）----
  const comboScrollBefore = comboCard.scrollTop
  assert.ok(await seekEmbed('code.ts') >= 0, 'code.ts 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  const idxNow = await page.evaluate(() => {
    const cards = window.readTextCards()
    return cards.findIndex((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  })
  await page.evaluate((i) => window.scrollEmbedCard(i, 600), idxNow)
  await page.waitForTimeout(120)
  assert.ok(await seekEmbed('code.ts#line=25;range=10-60') >= 0, 'code.ts#line=25;range=10-60 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  cards = await page.evaluate(() => window.readTextCards())
  const comboAfter = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 16)
  assert.ok(Math.abs(comboAfter.scrollTop - comboScrollBefore) < 2,
    `全文卡滚动不串扰窗口卡（组合卡 scrollTop ${comboAfter.scrollTop} ≈ ${comboScrollBefore}）`)
  assert.notEqual(comboAfter.scrollTop, 0, '组合卡定位保持非零（occurrence 滚动独立）')
  passed++
  console.log('[文本嵌入][PASS] 同目标不同锚点 occurrence 滚动独立')

  // ---- 场景 E：混排（列表/引用）与表格格内卡——容器矩阵其余通道 ----
  // 混排宿主：滚到引用块（列表/引用在其上方 buffer 内一并挂载）
  assert.ok(await seekEmbed('code.ts') >= 0, 'code.ts 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  assert.ok(await page.evaluate(() => window.scrollToEmbedOccurrence('code.ts', 2)) >= 0,
    '引用内混排宿主（同 inner 第 3 个 occurrence）应已挂载可定位')
  await page.waitForTimeout(250)
  const mixedCount = await page.evaluate(() =>
    document.querySelectorAll('.vsidian-reading-embed-mixed').length)
  assert.ok(mixedCount >= 2, `列表/引用混排提升宿主在场（实际 ${mixedCount}）`)
  // 表格：滚到表头格内窗口卡（首处 inner=WIN 的宿主即表头格）
  assert.ok(await seekEmbed('code.ts#range=10-20') >= 0, 'code.ts#range=10-20 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  const structure = await page.evaluate(() => ({
    tableCards: [...document.querySelectorAll('.vsidian-embed-card')]
      .filter((c) => c.closest('td, th')).length,
    tableRows: document.querySelectorAll('table tr').length,
  }))
  assert.ok(structure.tableCards >= 2, `表格头/数据格格内卡在场（实际 ${structure.tableCards}）`)
  assert.equal(structure.tableRows, 2, `表格结构保真（表头 + 数据行各一，不被卡破坏；实际 ${structure.tableRows}）`)
  // 表格数据格内全文卡：窗口行号正常（数据格卡为全文目标）
  cards = await page.evaluate(() => window.readTextCards())
  const cellCard = cards.find((c) => c.inTableCell && c.gutterNumbers[0] === '1')
  assert.ok(cellCard, '表格格内全文卡渲染文本视图（格仍是单 grid item）')
  // 选字复制（Selection 层）不改父正文、不触发表格编辑
  const sel = await page.evaluate(() => {
    const cards = window.readTextCards()
    const idx = cards.findIndex((c) => c.inTableCell && c.gutterNumbers[0] === '1')
    return window.selectEmbedText(idx, 'const field1 = 1;')
  })
  assert.equal(sel, 'const field1 = 1;', '格内卡文本可建立选区（选字复制能力）')
  assert.equal(await editRequestCount(), 0, '选字不触发任何写回（含表格编辑）')
  const parentText = await page.evaluate(() => window.parentDocText())
  assert.equal(parentText, PARENT_DOC, '父正文一字不改（只读呈现零写回）')
  passed++
  console.log('[文本嵌入][PASS] 混排/表格格内卡 + 选字复制零写回')

  // ---- 场景 F：锚点非法就地报错（细分文案，不静默回顶）----
  // 错误结果不缓存：阅读侧块挂载即重新请求（与生产语义一致）——对最新
  // 在途请求回锚点错误包
  assert.ok(await seekEmbed('code.ts#line=9;range=10-20') >= 0, 'code.ts#line=9;range=10-20 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  const badReqs = (await hoverRequests()).filter((r) => r.target === BAD)
  assert.ok(badReqs.length >= 1, '非法锚点 occurrence 的装载请求在场')
  const badReq = badReqs.at(-1)
  await page.evaluate((args) => window.respondEmbed({
    kind: 'hover.result', reqId: args.reqId, instanceId: args.instanceId, ok: false,
    reason: 'anchor-invalid', anchor: 'line=9;range=10-20', anchorDetail: 'line-outside-window',
  }), badReq)
  await page.waitForTimeout(150)
  cards = await page.evaluate(() => window.readTextCards())
  const badCard = cards.find((c) => c.stateVisible && c.stateText.includes('锚点冲突'))
  assert.ok(badCard, `非法锚点卡就地错误态（得 ${cards.map((c) => c.stateText.slice(0, 12))}）`)
  assert.ok(badCard.stateText.includes('line 不在 range 窗口内'),
    `细分文案透传（line 越窗：得 "${badCard.stateText}"）`)
  assert.ok(badCard.stateText.includes('#line=9;range=10-20'), '错误文案携带锚点原文')
  assert.equal(badCard.lineCount, 0, '非法锚点不渲染正文（不静默回顶）')
  passed++
  console.log('[文本嵌入][PASS] 锚点非法就地报错（anchorDetail 细分文案）')

  // ---- 场景 G：视口回收重挂——滚动位置保持 + 装载缓存零重发 ----
  assert.ok(await seekEmbed('code.ts') >= 0, 'code.ts 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  const idxFull = await page.evaluate(() => {
    const cards = window.readTextCards()
    return cards.findIndex((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  })
  await page.evaluate((i) => window.scrollEmbedCard(i, 900), idxFull)
  await page.waitForTimeout(120)
  const scrollBeforeRecycle = await page.evaluate((i) => window.embedCardScrollTop(i), idxFull)
  const reqCountG = (await hoverRequests()).length
  await page.evaluate(() => window.scrollReadingTo(999999))
  await page.waitForTimeout(350)
  let cardCount = await page.evaluate(() => window.embedCardCount())
  assert.equal(cardCount, 0, `远离视口后嵌入卡应被回收（实际 ${cardCount}）`)
  await page.evaluate(() => window.scrollReadingTo(0))
  await page.waitForTimeout(400)
  cardCount = await page.evaluate(() => window.embedCardCount())
  assert.ok(cardCount >= 1, '滚回视口后嵌入卡重挂')
  cards = await page.evaluate(() => window.readTextCards())
  // 独占行全文卡 = 非格内全文卡的首个（文档序先于列表/引用混排卡）；
  // 恢复滚动后首行号随窗口位移，不按首行号判别
  const restored = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  assert.ok(restored, '重挂后文本视图经缓存直接渲染')
  assert.ok(Math.abs(restored.scrollTop - scrollBeforeRecycle) < 4,
    `回收重挂后滚动位置恢复（实际 ${restored.scrollTop} ≈ ${scrollBeforeRecycle}）`)
  const reqsAfterRecycle = (await hoverRequests()).slice(reqCountG)
  assert.equal(reqsAfterRecycle.filter((r) => r.target.startsWith('code.ts')).length, 0,
    `已装载卡片重挂零重发装载请求（实际 ${JSON.stringify(reqsAfterRecycle.map((r) => r.target))}）`)
  passed++
  console.log('[文本嵌入][PASS] 视口回收重挂：滚动位置保持 + 装载缓存零重发')

  // ---- 场景 H：外观广播静默重载（不闪 loading；重载回包重建视图）----
  assert.ok(await seekEmbed('code.ts') >= 0, 'code.ts 嵌入块应可定位挂载')
  await page.waitForTimeout(250)
  const reqCountH = (await hoverRequests()).length
  await page.evaluate(() => window.respondEmbed({ kind: 'appearance.changed', generation: 1 }))
  await page.waitForTimeout(200)
  cards = await page.evaluate(() => window.readTextCards())
  const ownH = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  assert.ok(ownH && !ownH.stateVisible, '外观广播重载不闪 loading（内容态保持）')
  const reloads = (await hoverRequests()).slice(reqCountH)
  assert.ok(reloads.length >= 1, `在场 text 卡静默重载出站（实际 ${reloads.length} 笔）`)
  assert.ok(reloads.every((r) => r.anchorOptional === true), '重载带 anchorOptional（窗口/定位合法钳制）')
  for (const req of reloads) {
    if (req.target === FULL) {
      await respondText(req, { text: FULL_TEXT, version: 6 })
    } else if (req.target === WIN) {
      await respondText(req, { text: WINDOW_TEXT, version: 6, nav: windowNav })
    } else if (req.target === COMBO) {
      await respondText(req, { text: BIG_WINDOW_TEXT, version: 6,
        nav: { hasWindow: true, beginLine: 10, endLine: 60, locateLine: 25, jumpLine: 25 } })
    }
  }
  await page.waitForTimeout(200)
  cards = await page.evaluate(() => window.readTextCards())
  const reloaded = cards.find((c) => !c.inTableCell && c.gutterNumbers.length > 20)
  assert.ok(reloaded && reloaded.gutterNumbers.at(-1) !== undefined, '重载回包后视图重建')
  passed++
  console.log('[文本嵌入][PASS] 外观广播静默重载（零闪烁 + 重载重建）')

  // ---- 场景 I：Live 模式 widget——同一文本卡在 Live 装饰通道渲染（缓存零重发）----
  const reqCountI = (await hoverRequests()).length
  await page.evaluate(() => window.respondEmbed({ kind: 'view.mode.set', mode: 'live' }))
  await page.locator('.vsidian-live-embed .vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await page.waitForTimeout(250)
  const liveInfo = await page.evaluate(() => {
    const card = document.querySelector('.vsidian-live-embed .vsidian-embed-card')
    if (!card) return null
    const gutters = card.querySelectorAll('.vsidian-text-gutter-line')
    const stateEl = card.querySelector('.vsidian-embed-card-state')
    return {
      hasTextView: card.querySelector('.vsidian-text-view') !== null,
      firstGutter: gutters[0]?.textContent ?? '',
      stateVisible: stateEl !== null && getComputedStyle(stateEl).display !== 'none',
    }
  })
  assert.ok(liveInfo, 'Live widget 内嵌入卡在场')
  assert.equal(liveInfo.hasTextView, true, 'Live widget 文本视图渲染（容器无关挂载）')
  assert.equal(liveInfo.firstGutter, '1', 'Live widget 行号正常（绝对行）')
  assert.equal(liveInfo.stateVisible, false, 'Live widget 卡内容态')
  const reqsAfterLive = (await hoverRequests()).slice(reqCountI)
  assert.equal(reqsAfterLive.length, 0,
    `Live 切换经语义键命中装载缓存零重发（实际 ${JSON.stringify(reqsAfterLive.map((r) => r.target))}）`)
  passed++
  console.log('[文本嵌入][PASS] Live widget 通道：文本卡渲染 + 语义键缓存零重发')

  // ---- 收尾：零写回 + 无页面错误 ----
  assert.equal(await editRequestCount(), 0, '文本嵌入全程零写回（edit.request 为 0）')
  assert.deepEqual(errors, [], '页面零未捕获异常')
  passed++
  console.log('[文本嵌入][PASS] 零写回 + 无页面错误')

  console.log(`\n[文本嵌入] 全部 ${passed} 个场景通过`)
} finally {
  await browser.close()
}
