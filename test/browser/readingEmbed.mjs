// Reading 正文嵌入的原生浏览器回归（#222）：真实布局（Chromium）下经生产
// 控制器装配验证——独占行嵌入挂载升级为卡片（绘制层可见性：边条/命中/
// 标题）、混排保留源文、长内容限高内部滚动（默认 480 与设置热更）、
// 选字复制（Selection 层）、一层展开占位呈现与按 B 身份跳转出站、
// 视口回收重挂的 fm/滚动状态保持与装载缓存零重发、零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'readingEmbed/readingEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：独占行全文嵌入 + 章节嵌入 + 混排行（#246 起升级流内卡片）+ 尾部大段正文（视口回收场景） */
const PARENT_DOC = [
  '# 嵌入父文档',
  '',
  '开篇正文，先铺垫一段。',
  '',
  '![[目标笔记]]',
  '',
  '中间正文段落。',
  '',
  '混排嵌入 ![[目标笔记]] 现于 #246 升级为流内卡片。',
  '',
  '![[目标笔记#章节一]]',
  '',
  ...Array.from({ length: 220 }, (_, i) => `父文档尾部第 ${i + 1} 段：把全文撑出多屏，滚动到底部时首屏嵌入块应被视口回收（buffer 约 960px，须显著超出）。`),
  '',
].join('\n')

/** 目标全文：frontmatter（fm 折叠场景）+ 标题 + 多段（撑出卡片内部滚动）+ 二层嵌入 */
const TARGET_DOC = [
  '---',
  'title: 目标笔记',
  '---',
  '',
  '# 目标笔记标题',
  '',
  ...Array.from({ length: 40 }, (_, i) => `目标笔记第 ${i + 1} 段正文，把卡片内容撑出限高以验证内部滚动承载与滚动位置保持。`),
  '',
  '![[内层目标]]',
  '',
  '二层嵌入后的正文。',
  '',
  '## 章节一',
  '',
  '章节一段落。',
  '',
  '- [ ] 章节内任务',
  '',
].join('\n')

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
  await page.evaluate((text) => window.initEmbedDoc(text), PARENT_DOC)
  // 保留一期单层回归：新深度设置置 1，B 内引用显示有界深度卡片。
  await page.evaluate(() => window.respondEmbed({ kind: 'settings.snapshot', values: { 'embed.maxDepth': 1 } }))
  await page.locator('.vsidian-view-reading .vsidian-embed-card').first().waitFor({ timeout: 5000 })

  const sent = () => page.evaluate(() => window.embedSent())
  const hoverRequests = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'hover.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'edit.request').length)
  /** 对在场卡片的在途请求按 index 回成功包 */
  const respondOk = async (index, text = TARGET_DOC, scope = { kind: 'full' }) => {
    const reqs = await hoverRequests()
    const req = reqs[index]
    assert.ok(req, `第 ${index} 个嵌入装载请求应在途`)
    await page.evaluate(({ reqId, instanceId, t, s }) => window.respondEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
      version: 2, text: t,
      range: s.kind === 'full' ? { start: 0, end: t.length } : { start: t.indexOf('## 章节一'), end: t.length },
      scope: s,
    }), { reqId: req.reqId, instanceId: req.instanceId, t: text, s: scope })
    await page.waitForTimeout(150)
  }

  // ---- 场景 A：独占行嵌入挂载升级 + 请求载荷身份契约 + 混排流内卡片 ----
  const reqsA = await hoverRequests()
  assert.equal(reqsA.length, 3, '三个嵌入（独占全文 + 混排 + 章节）各发一笔装载请求')
  const reqAt = (start) => {
    const req = reqsA.find((r) => r.sourceStart === start)
    assert.ok(req, `区间起点 ${start} 的装载请求应在途`)
    return req
  }
  const ownStart = PARENT_DOC.indexOf('![[目标笔记]]')
  const mixedAt = PARENT_DOC.indexOf('混排嵌入 ![[目标笔记]]') + '混排嵌入 '.length
  const sectionAt = PARENT_DOC.indexOf('![[目标笔记#章节一]]')
  const ownReq = reqAt(ownStart)
  const mixedReq = reqAt(mixedAt)
  const sectReq = reqAt(sectionAt)
  for (const req of reqsA) {
    assert.match(req.instanceId, /^embed-/, '嵌入实例前缀')
  }
  assert.equal(ownReq.target, '目标笔记', 'target 为嵌入 inner 原文')
  assert.equal(mixedReq.target, '目标笔记', '混排嵌入目标原文同口径')
  assert.equal(sectReq.target, '目标笔记#章节一', '章节嵌入目标原文含锚点')
  assert.equal(ownReq.sourceEnd, ownStart + '![[目标笔记]]'.length, 'sourceEnd 为嵌入行区间终点')
  // #246：混排请求区间是行内 occurrence 精确边界（不吞前后文）
  assert.equal(mixedReq.sourceEnd, mixedAt + '![[目标笔记]]'.length, '混排 sourceEnd 为行内嵌入终点')
  let cards = await page.evaluate(() => window.readEmbedCards())
  assert.equal(cards.length, 3, '恰三张嵌入卡片（#246 混排升级为流内卡片）')
  assert.ok(cards[0].hitInside, '卡片头部 elementFromPoint 命中应落在卡片内（真实绘制）')
  assert.ok(parseFloat(cards[0].barWidth) >= 3, `左侧引用边条应在场（实际 ${cards[0].barWidth}）`)
  assert.notEqual(cards[0].barColor, 'rgba(0, 0, 0, 0)', '边条颜色非透明（引用条色）')
  assert.equal(cards[0].stateText, zhCn['embed.loading'], '装载中就地 loading 文案')
  assert.ok(cards[0].openPresent, '右上角打开入口在场')
  // #246：混排前后文成独立 p 且文本保留（流内卡片不吞文字）
  const mixedAround = await page.evaluate(() => {
    const host = document.querySelector('.vsidian-reading-embed-mixed')
    if (!host) return null
    const before = host.previousElementSibling
    const after = host.nextElementSibling
    return {
      beforeText: (before?.textContent ?? '').trim(),
      afterText: (after?.textContent ?? '').trim(),
      beforeIsP: before instanceof HTMLParagraphElement,
      afterIsP: after instanceof HTMLParagraphElement,
    }
  })
  assert.ok(mixedAround, '混排流内宿主在场')
  assert.ok(mixedAround.beforeIsP && mixedAround.afterIsP, '混排提升拆段为 p(前)+宿主+p(后)')
  assert.ok(mixedAround.beforeText.includes('混排嵌入'), `前文保留（实际 ${mixedAround.beforeText}）`)
  assert.ok(mixedAround.afterText.includes('升级为流内卡片'), `后文保留（实际 ${mixedAround.afterText}）`)
  passed++
  console.log('[正文嵌入][PASS] 独占行挂载升级 + 载荷契约 + 混排流内卡片（#246）')

  // ---- 场景 B：成功回包 → 内容绘制（标题/任务禁写/标题栏 relPath/限高滚动）----
  await respondOk(0)
  // #246 混排卡同目标回包（按区间寻位——请求序含 Live 侧先行，不按 index；
  // E 场景零重发断言须全部全文卡已装载缓存）
  {
    const reqsB = await hoverRequests()
    const mixedIdx = reqsB.findIndex((r) => r.sourceStart === mixedAt)
    assert.ok(mixedIdx >= 0, '混排卡装载请求应在途')
    await respondOk(mixedIdx, TARGET_DOC)
  }
  cards = await page.evaluate(() => window.readEmbedCards())
  assert.equal(cards[0].stateVisible, false, '成功后状态行隐藏（内容区在场）')
  assert.ok(cards[0].text.includes('目标笔记标题'), '应渲染目标标题')
  assert.equal(cards[0].title, '目标笔记.md', '顶部文件名为目标根内相对路径')
  assert.equal(cards[0].checkboxAllDisabled, true, '任务 checkbox 禁用（只读）')
  assert.ok(cards[0].scrollable, `长内容应超出限高（scroll ${cards[0].scrollScrollHeight} > client ${cards[0].scrollClientHeight}）`)
  assert.ok(Math.abs(cards[0].scrollClientHeight - 480) <= 4, `默认限高 480（实际 ${cards[0].scrollClientHeight}）`)
  assert.ok(cards[0].rect.height <= 480 + 40, `卡片总高不超过限高+头部（实际 ${cards[0].rect.height}）`)
  passed++
  console.log('[正文嵌入][PASS] 成功回包：内容绘制 + 任务禁写 + 限高 480 内部滚动')

  // ---- 场景 C：选字复制（Selection 层证据：卡片内容文本可建立非空选区）----
  const selected = await page.evaluate(() => window.selectEmbedText(0, '目标笔记第 3 段正文'))
  assert.equal(selected, '目标笔记第 3 段正文', '卡片内容应可建立文本选区（选字复制能力）')
  const selectionNow = await page.evaluate(() => window.embedSelection())
  assert.equal(selectionNow, '目标笔记第 3 段正文', '选区应保持（读取不受容器拦截）')
  passed++
  console.log('[正文嵌入][PASS] 内部 Reading 可选字复制（Selection 层）')

  // ---- 场景 D：深度 1——B 内引用显示深度卡片，打开仍按 B 身份 ----
  assert.equal(cards[0].nestedCards, 1, '深度 1 时 B 内引用有明确的深度卡片')
  assert.ok(cards[0].text.includes(zhCn['hover.errorDepth']), '深度占位说明可见')
  const reqCountBefore = (await hoverRequests()).length
  // 深度卡片在 40 段正文之后：先滚动卡片内容使打开入口进入可视区。
  await page.evaluate(() => window.scrollEmbedCard(0, 999999))
  await page.waitForTimeout(60)
  await page.locator('.vsidian-view-reading .vsidian-embed-card .vsidian-embed-card .vsidian-embed-card-open').first().click()
  const activates = await page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'wikilink.activate'))
  assert.equal(activates.length, 1, '占位点击应出站 wikilink.activate')
  assert.equal(activates[0].target, '内层目标', '深度卡片目标为内层嵌入原文（| 前）')
  assert.equal(activates[0].sourceDocUri, 'D:\\notes\\目标笔记.md',
    '按 B 身份出站（sourceDocUri=B）')
  assert.equal((await hoverRequests()).length, reqCountBefore, '点击深度卡片不绕过预算装载')
  passed++
  console.log('[正文嵌入][PASS] 深度 1 占位呈现 + 打开按 B 身份出站')

  // ---- 场景 E：fm 折叠交互与回收重挂状态保持（fm 展开 + 滚动位置）----
  assert.equal(cards[0].fmCollapsed, true, '全文嵌入属性区默认折叠')
  await page.evaluate(() => window.clickEmbedFmToggle(0))
  cards = await page.evaluate(() => window.readEmbedCards())
  assert.equal(cards[0].fmCollapsed, false, '点击切换后属性区展开')
  const scrolled = await page.evaluate(() => window.scrollEmbedCard(0, 160))
  assert.ok(Math.abs(scrolled - 160) < 4, `卡片内容应可滚动（scrollTop=${scrolled}）`)
  const reqCountE = (await hoverRequests()).length

  // 滚动父文档到底部：首屏嵌入块移出挂载窗口 → 视口回收（卡片 DOM 释放）
  await page.evaluate(() => window.scrollReadingTo(999999))
  await page.waitForTimeout(300)
  let cardCount = await page.evaluate(() => window.embedCardCount())
  assert.equal(cardCount, 0, `远离视口后嵌入卡片应被回收（实际 ${cardCount}）`)

  // 滚回顶部：重挂 + 状态恢复（fm 展开/滚动位置）+ 装载缓存零重发
  await page.evaluate(() => window.scrollReadingTo(0))
  await page.waitForTimeout(300)
  cardCount = await page.evaluate(() => window.embedCardCount())
  assert.ok(cardCount >= 1, '滚回视口后嵌入卡片应重挂')
  cards = await page.evaluate(() => window.readEmbedCards())
  assert.ok(cards[0].text.includes('目标笔记标题'), '重挂后内容经缓存直接渲染')
  assert.equal(cards[0].fmCollapsed, false, '回收重挂后 fm 展开状态保持')
  const scrollTopRestored = await page.evaluate(() => window.embedCardScrollTop(0))
  assert.ok(Math.abs(scrollTopRestored - 160) < 4, `回收重挂后滚动位置恢复（实际 ${scrollTopRestored}）`)
  // 已装载缓存的全文卡片零重发；章节卡片（回包未达、lastReq 在途）重挂
  // 重发属幂等读取重试（新请求覆盖 lastReq，旧回包按身份守卫丢弃）
  const reqsAfterRemount = (await hoverRequests()).slice(reqCountE)
  assert.ok(!reqsAfterRemount.some((r) => r.target === '目标笔记'),
    `已装载的全文卡片不得重发装载请求（实际 ${JSON.stringify(reqsAfterRemount.map((r) => r.target))}）`)
  passed++
  console.log('[正文嵌入][PASS] 视口回收重挂：fm/滚动状态保持 + 装载缓存零重发')

  // ---- 场景 F：限高设置热更（settings.snapshot 注入 embed.maxHeight=300）----
  await page.evaluate(() => window.respondEmbed({
    kind: 'settings.snapshot',
    values: { 'embed.maxHeight': 300 },
  }))
  await page.waitForTimeout(120)
  cards = await page.evaluate(() => window.readEmbedCards())
  assert.ok(Math.abs(cards[0].scrollClientHeight - 300) <= 4, `设置热更后限高 300（实际 ${cards[0].scrollClientHeight}）`)
  passed++
  console.log('[正文嵌入][PASS] 限高设置热更：embed.maxHeight=300 即时生效')

  // ---- 场景 G：错误分态就地呈现（第三张卡片回 not-found）----
  // 混排卡（#246）装载后头部总高把章节块挤出首屏窗口——先滚到章节块
  // 入场（其在途/重挂请求以最新一笔为准），再回错误包
  const sectBlock = await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('.vsidian-reading-block'))) {
      if ((el.dataset['vsidianEmbedInner'] ?? '') === '目标笔记#章节一') return el.offsetTop
    }
    return null
  })
  assert.ok(sectBlock !== null, '章节块应已解析（dataset 携带 inner）')
  await page.evaluate((top) => window.scrollReadingTo(top), sectBlock)
  await page.waitForTimeout(300)
  const reqsG = (await hoverRequests()).filter((r) => r.target === '目标笔记#章节一')
  const sectionReq = reqsG.at(-1)
  await page.evaluate(({ reqId, instanceId }) => window.respondEmbed({
    kind: 'hover.result', reqId, instanceId, ok: false, reason: 'not-found',
  }), { reqId: sectionReq.reqId, instanceId: sectionReq.instanceId })
  await page.waitForTimeout(150)
  cards = await page.evaluate(() => window.readEmbedCards())
  const sectionCard = cards.find((c) => c.title.includes('目标笔记#章节一') || c.stateText.includes('目标笔记'))
  assert.ok(sectionCard, '章节嵌入卡片应在场（错误态卡片壳保留）')
  assert.ok(sectionCard.stateText.includes(zhCn['hover.errorNotFound'].split('{target}')[0]),
    `错误分态就地呈现（实际 ${sectionCard.stateText}）`)
  assert.equal(sectionCard.stateVisible, true, '错误态状态行可见')
  passed++
  console.log('[正文嵌入][PASS] 错误分态就地呈现（not-found 含目标原文文案）')

  // ---- 场景 H：零写回（全程无 edit.request）----
  assert.equal(await editRequestCount(), 0, '嵌入链路零写回（悬停/嵌入/点击均只读）')
  assert.deepEqual(errors, [], '无页面错误')
  passed++
  console.log('[正文嵌入][PASS] 零写回 + 无页面错误')

  // ---- #243：1000 块 B 文档由卡片自己的真实 scrollport 驱动 ----
  const longPage = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const longErrors = []
  longPage.on('pageerror', (error) => longErrors.push(error.message))
  await longPage.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await longPage.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await longPage.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await longPage.addScriptTag({ path: bundle })
  await longPage.evaluate((text) => window.initEmbedDoc(text), '# 引用父文档\n\n![[长文]]\n')
  const longTarget = Array.from({ length: 1000 }, (_, i) => `长文段落 ${String(i).padStart(4, '0')}：引用内容按内部视口挂载。`).join('\n\n')
  const longReq = await longPage.evaluate(() => window.embedSent().find((m) => m.kind === 'hover.request'))
  const startMs = performance.now()
  await longPage.evaluate(({ reqId, instanceId, text }) => window.respondEmbed({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\long-243.md', relPath: 'long-243.md' },
    version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: longReq.reqId, instanceId: longReq.instanceId, text: longTarget })
  await longPage.waitForTimeout(120)
  const first = await longPage.evaluate(() => ({
    stats: window.embedVirtualStats(0), viewport: window.embedViewportSnapshot(0),
    cache: window.refCacheStats(), lifecycle: window.refLifecycleStats(),
  }))
  const responseToFirstPaintMs = Math.round(performance.now() - startMs)
  assert.equal(first.stats.totalBlocks, 1000)
  assert.equal(first.stats.virtualized, true)
  assert.ok(first.stats.maxMountedBlocks < 100, `首载峰值 ${first.stats.maxMountedBlocks}，不得先全文建 DOM`)
  assert.ok(first.stats.mountedEver < 100, `首载累计创建 ${first.stats.mountedEver}，不得先全文创建再回收`)
  assert.equal(first.cache.parses, 1, '同目标 Live/Reading 两实例共用一次全文解析')
  assert.ok(first.viewport.visible.some((b) => b.text.includes('0000') && b.painted), '首屏实际绘制长文开头')
  const middle = await longPage.evaluate(async () => {
    const start = performance.now()
    const initial = window.embedViewportSnapshot(0)
    window.scrollEmbedCard(0, Math.round((initial.scrollHeight - initial.clientHeight) / 2))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { stats: window.embedVirtualStats(0), viewport: window.embedViewportSnapshot(0), lifecycle: window.refLifecycleStats(),
      scrollToPaintMs: Math.round(performance.now() - start) }
  })
  const midIndexes = middle.viewport.visible.map((b) => /长文段落 (\d{4})/.exec(b.text)?.[1]).filter(Boolean).map(Number)
  assert.ok(midIndexes.some((i) => i > 200 && i < 800), `中部应有真实内容（${midIndexes.join(',')}）`)
  assert.ok(middle.viewport.visible.some((b) => b.painted), '中部内容在绘制层可命中')
  assert.ok(middle.stats.unmountedEver > 0, `中部滚动回收首屏块（${JSON.stringify({ first: first.stats, middle: middle.stats })}）`)
  assert.ok(middle.stats.mountedBlocks < 100, '中部窗口有界')
  const last = await longPage.evaluate(async () => {
    const start = performance.now()
    window.scrollEmbedCard(0, 999999)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { stats: window.embedVirtualStats(0), viewport: window.embedViewportSnapshot(0), lifecycle: window.refLifecycleStats(),
      scrollToPaintMs: Math.round(performance.now() - start) }
  })
  assert.ok(last.viewport.visible.some((b) => b.text.includes('0999') && b.painted),
    `末段 0999 在绘制层可见（${JSON.stringify({ viewport: last.viewport, stats: last.stats })}）`)
  assert.ok(last.stats.mountedBlocks < 100, '末端窗口有界')
  assert.equal(last.stats.parseCount, first.stats.parseCount, '往返滚动不增加实例解析次数')
  await longPage.evaluate(() => window.scrollEmbedCard(0, 0))
  await longPage.waitForTimeout(80)
  const back = await longPage.evaluate(() => window.embedVirtualStats(0))
  assert.equal(back.parseCount, first.stats.parseCount, '回到首屏仍不重复解析')
  const beforeDispose = await longPage.evaluate(() => window.refLifecycleStats())
  await longPage.evaluate(() => window.respondEmbed({ kind: 'view.mode.set', mode: 'live' }))
  await longPage.locator('.cm-content').first().click()
  await longPage.evaluate(() => window.startInputProbe())
  await longPage.keyboard.type('x')
  await longPage.waitForTimeout(80)
  const inputToEditRequestMs = await longPage.evaluate(() => window.inputProbeMs())
  const parentEdits = await longPage.evaluate(() => window.embedSent().filter((m) => m.kind === 'edit.request'))
  assert.ok(inputToEditRequestMs !== null, '父文档 Live 输入须出站供延迟测量')
  assert.ok(parentEdits.every((m) => m.docUri === 'file:///d%3A/notes/parent.md'), '长 B 在场时输入只写父文档')
  await longPage.evaluate(() => window.disposeEmbedController())
  const afterDispose = await longPage.evaluate(() => window.refLifecycleStats())
  assert.ok(beforeDispose.activeBlocks > 0, '释放前有真实引用块')
  assert.equal(afterDispose.activeBlocks, 0, '关闭面板后配对释放引用块')
  assert.deepEqual(longErrors, [], '长文页无未捕获异常')
  const longReport = { targetBlocks: 1000, first, middle, last, back, beforeDispose, afterDispose,
    responseToFirstPaintMs, inputToEditRequestMs }
  await longPage.close()

  // 一个超长列表仍是单个挂载块：记录 DOM 下界，不将多块窗口数据泛化。
  const singlePage = await browser.newPage({ viewport: { width: 900, height: 640 } })
  await singlePage.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await singlePage.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await singlePage.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await singlePage.addScriptTag({ path: bundle })
  await singlePage.evaluate((text) => window.initEmbedDoc(text), '# 引用父文档\n\n![[巨大列表]]\n')
  const singleReq = await singlePage.evaluate(() => window.embedSent().find((m) => m.kind === 'hover.request'))
  const singleTarget = Array.from({ length: 1000 }, (_, i) => `- 列表项 ${i}`).join('\n')
  await singlePage.evaluate(({ reqId, instanceId, text }) => window.respondEmbed({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\single-block-243.md', relPath: 'single-block-243.md' },
    version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: singleReq.reqId, instanceId: singleReq.instanceId, text: singleTarget })
  await singlePage.waitForTimeout(120)
  const singleBlock = await singlePage.evaluate(() => ({ stats: window.embedVirtualStats(0),
    liCount: document.querySelectorAll('.vsidian-embed-card-scroll li').length }))
  assert.equal(singleBlock.stats.totalBlocks, 1, '1000 项列表保持一个原有分块')
  assert.equal(singleBlock.liCount, 1000, '单块内部仍创建全部列表项')
  assert.ok(singleBlock.stats.contentDomCount > 1000, '单个巨大块不受块级窗口上限约束')
  longReport.singleBlock = singleBlock
  await singlePage.close()
  if (process.env.VSIDIAN_REF_PERF_REPORT) {
    await writeFile(process.env.VSIDIAN_REF_PERF_REPORT, JSON.stringify(longReport, null, 2) + '\n')
  }
  passed++
  console.log('[正文嵌入][PASS] 1000 块首中末绘制、峰值有界、回收与零重解析；巨大单块实测边界')

  console.log(`\n[正文嵌入] 全部 ${passed} 个场景通过`)
} finally {
  await browser.close()
}
