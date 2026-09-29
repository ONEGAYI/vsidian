// Reading 正文嵌入的原生浏览器回归（#222）：真实布局（Chromium）下经生产
// 控制器装配验证——独占行嵌入挂载升级为卡片（绘制层可见性：边条/命中/
// 标题）、混排保留源文、长内容限高内部滚动（默认 480 与设置热更）、
// 选字复制（Selection 层）、一层展开占位呈现与按 B 身份跳转出站、
// 视口回收重挂的 fm/滚动状态保持与装载缓存零重发、零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'readingEmbed/readingEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：独占行全文嵌入 + 章节嵌入 + 混排行 + 尾部大段正文（视口回收场景） */
const PARENT_DOC = [
  '# 嵌入父文档',
  '',
  '开篇正文，先铺垫一段。',
  '',
  '![[目标笔记]]',
  '',
  '中间正文段落。',
  '',
  '混排嵌入 ![[目标笔记]] 不成卡片（保留源文）。',
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
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })

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

  // ---- 场景 A：独占行嵌入挂载升级 + 请求载荷身份契约 + 混排保留源文 ----
  const reqsA = await hoverRequests()
  assert.equal(reqsA.length, 2, '两个独占行嵌入（全文 + 章节）各发一笔装载请求')
  assert.match(reqsA[0].instanceId, /^embed-/, '嵌入实例前缀')
  assert.equal(reqsA[0].target, '目标笔记', 'target 为嵌入 inner 原文')
  assert.equal(reqsA[1].target, '目标笔记#章节一', '章节嵌入目标原文含锚点')
  assert.equal(reqsA[0].sourceStart, PARENT_DOC.indexOf('![[目标笔记]]'), 'sourceStart 为嵌入行区间起点')
  assert.equal(reqsA[0].sourceEnd, PARENT_DOC.indexOf('![[目标笔记]]') + '![[目标笔记]]'.length, 'sourceEnd 为嵌入行区间终点')
  let cards = await page.evaluate(() => window.readEmbedCards())
  assert.equal(cards.length, 2, '恰两张嵌入卡片（混排行不成卡片）')
  assert.ok(cards[0].hitInside, '卡片头部 elementFromPoint 命中应落在卡片内（真实绘制）')
  assert.ok(parseFloat(cards[0].barWidth) >= 3, `左侧引用边条应在场（实际 ${cards[0].barWidth}）`)
  assert.notEqual(cards[0].barColor, 'rgba(0, 0, 0, 0)', '边条颜色非透明（引用条色）')
  assert.equal(cards[0].stateText, zhCn['embed.loading'], '装载中就地 loading 文案')
  assert.ok(cards[0].openPresent, '右上角打开入口在场')
  // 混排：主文档中的混排嵌入不成卡片，正文保留源文（占位引用行也不出现——它是 paragraph 文本）
  const inlineMention = await page.evaluate(() =>
    (document.querySelector('.vsidian-view-reading')?.textContent ?? '').includes('混排嵌入 ![[目标笔记]] 不成卡片'))
  assert.ok(inlineMention, '混排嵌入行应保留源文文本')
  passed++
  console.log('[正文嵌入][PASS] 独占行挂载升级 + 载荷契约 + 混排保留源文')

  // ---- 场景 B：成功回包 → 内容绘制（标题/任务禁写/标题栏 relPath/限高滚动）----
  await respondOk(0)
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

  // ---- 场景 D：一层展开——B 内嵌入为占位引用行，点击按 B 身份出站 ----
  assert.equal(cards[0].nestedCards, 0, 'B 内嵌入不嵌套装载卡片（一层展开）')
  assert.deepEqual(cards[0].embedRefs, ['![[内层目标]]'], 'B 内嵌入呈占位引用行（保留 ![[ ]] 形态）')
  const reqCountBefore = (await hoverRequests()).length
  // 占位行在 40 段正文之后：先滚动卡片内容使占位行进入可视区（真实指针点击前提）
  await page.evaluate(() => window.scrollEmbedCard(0, 999999))
  await page.waitForTimeout(60)
  const refClicked = await page.evaluate(() => window.clickEmbedRef(0))
  assert.ok(refClicked, '占位引用行应可被真实指针命中并点击')
  const activates = await page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'wikilink.activate'))
  assert.equal(activates.length, 1, '占位点击应出站 wikilink.activate')
  assert.equal(activates[0].target, '内层目标', '占位目标为内层嵌入原文（| 前）')
  assert.equal(activates[0].sourceDocUri, 'D:\\notes\\目标笔记.md',
    '按 B 身份出站（sourceDocUri=B）')
  assert.equal((await hoverRequests()).length, reqCountBefore, '点击占位不触发新装载请求（不递归）')
  passed++
  console.log('[正文嵌入][PASS] 一层展开占位呈现 + 点击按 B 身份出站（不递归装载）')

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

  // ---- 场景 G：错误分态就地呈现（第二张卡片回 not-found）----
  // 章节卡片的在途请求取最新一笔（场景 E 的回收重挂会以新身份重发在途请求）
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

  console.log(`\n[正文嵌入] 全部 ${passed} 个场景通过`)
} finally {
  await browser.close()
}
