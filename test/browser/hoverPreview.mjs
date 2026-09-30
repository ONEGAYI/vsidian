// 悬停文档预览的原生浏览器回归（#218 装配基座，#219 扩展局部范围与普通
// 链接）：真实布局（Chromium）下用真实指针驱动生产控制器——Reading 双链
// 悬停开浮层（开延迟/请求载荷）、宿主回包后正文绘制层可见（实底/命中/
// 内容文本）、移入保活可滚动、Esc/延迟关闭、小视口四边避障、迟到回包
// 不重开、零抢焦点与零写回；#219 场景：标题章节/块引用（多行块不截首行）
// 的范围过滤渲染、普通本地 Markdown 链接（linkHref 载荷）与外部链接预滤、
// 锚点缺失错误分态。
// 宿主读取回包由脚本注入（fixture.respondHoverResult → handleHostMessage
// 同入口）；outlineHover.mjs 同装配模式。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'hoverPreview/hoverPreview.js')
await build({ entryPoints: [path.join(root, 'test/browser/hoverPreviewFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  '开篇正文，先铺垫两段再放链接。',
  '',
  '第二段正文。',
  '',
  '指向 [[目标笔记]] 的双链，以及一段普通文字。',
  '',
  '局部锚点：[[目标笔记#章节一]]、[[目标笔记#^multi-blk]] 与 [[目标笔记#没有的锚点]]。',
  '',
  '普通链接 [全文链接](目标笔记.md) 与 [章节链接](目标笔记.md#章节一)。',
  '',
  '外部链接 [外站](https://example.com) 与 [协议相对](//example.com/x) 不预览。',
  '',
  '结尾正文。',
  '',
].join('\n')

/** 目标全文：含标题、任务列表与足量段落（撑出滚动）；尾部追加章节结构
 *  与多行块（#219 局部范围场景——不破坏前置场景的全文断言） */
const TARGET_DOC = [
  '# 目标笔记全文标题',
  '',
  '- [ ] 待办一',
  '- [x] 已完成项',
  '',
  ...Array.from({ length: 24 }, (_, i) => `目标笔记的第 ${i + 1} 段正文，用于把浮层内容撑出最大高度以验证滚动承载。`),
  '',
  '## 章节一',
  '',
  '章节一段落。',
  '',
  '- 章节列表一',
  '- 章节列表二 ^multi-blk',
  '',
  '## 章节二',
  '',
  '章节二段落（章节一范围外）。',
  '',
].join('\n')

/** 章节一范围（宿主 findHeadingSectionRange 语义：标题行行首 → 下一同级
 *  标题前最后非空行行尾，不含尾随换行） */
const SECTION_ONE_RANGE = {
  start: TARGET_DOC.indexOf('## 章节一'),
  end: TARGET_DOC.indexOf('## 章节二') - 2,
}
/** 多行列表块范围（宿主 findBlockRange 语义：块首行行首 → 标记行行尾） */
const MULTI_BLOCK_RANGE = {
  start: TARGET_DOC.indexOf('- 章节列表一'),
  end: TARGET_DOC.indexOf('- 章节列表二 ^multi-blk') + '- 章节列表二 ^multi-blk'.length,
}

const OPEN_WAIT = 700 // 开延迟 300ms + 余量
const CLOSE_WAIT = 800 // 关延迟 350ms + 余量

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initHoverDoc(text), PARENT_DOC)
  await page.locator('a.vsidian-wikilink').first().waitFor()

  const hoverLink = () => page.locator('a.vsidian-wikilink').first().hover()
  const hoverRequests = () => page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'hover.request'))
  const editRequests = () => page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'edit.request').length)

  // ---- 场景 A：真实悬停 → 开延迟后浮层在场 + 请求载荷身份契约 ----
  const focusBefore = await page.evaluate(() =>
    document.activeElement === document.body ? 'body' : document.activeElement?.tagName ?? '')
  await hoverLink()
  await page.waitForTimeout(OPEN_WAIT)
  let popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '悬停后浮层应打开')
  assert.equal(popup.stateVisible, true, '打开即呈就地 loading 状态行')
  assert.equal(popup.stateText, zhCn['hover.loading'], 'loading 文案与语言包同源')
  const reqs = await hoverRequests()
  assert.equal(reqs.length, 1, '应恰发出一次 hover.request')
  const req = reqs[0]
  assert.equal(req.sessionId, 'hover-preview')
  assert.equal(req.docUri, 'file:///d%3A/notes/parent.md')
  assert.ok(req.reqId > 0 && Number.isInteger(req.reqId), 'reqId 为正整数')
  assert.match(req.instanceId, /^hover-/, 'instanceId 为浮层实例标识')
  assert.equal(req.target, '目标笔记', 'target 为双链原文')
  // 零抢焦点：打开全程 activeElement 不变
  assert.equal(popup.activeElement, focusBefore, `悬停不得抢焦点（前 ${focusBefore} 后 ${popup.activeElement}）`)
  passed++
  console.log('[悬停预览][PASS] 真实悬停开浮层：loading 就地态 + 请求身份契约 + 零抢焦点')

  // ---- 场景 B：宿主成功回包 → 正文绘制层可见（实底/命中/内容文本/禁写）----
  await page.evaluate(({ reqId, instanceId, text }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 3, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: req.reqId, instanceId: req.instanceId, text: TARGET_DOC })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '内容态浮层在场')
  assert.ok(popup.background.includes('rgba') || popup.background.includes('rgb('),
    `浮层应有实底背景（实际 ${popup.background}）`)
  assert.ok(popup.boxShadow, '浮层应有投影（可辨识）')
  assert.ok(popup.hitInside, '浮层上半中心点的 elementFromPoint 命中应落在浮层内（真实绘制）')
  assert.ok(popup.contentText.includes('目标笔记全文标题'), `应显示目标标题（实际 ${popup.contentText}）`)
  assert.ok(popup.blockCount >= 3, `视口内块应已挂载（虚拟化按窗口挂载；实际 ${popup.blockCount}）`)
  assert.equal(popup.checkboxCount, 2, '目标内两个任务 checkbox 应渲染')
  assert.equal(popup.checkboxAllDisabled, true, '任务 checkbox 应全部禁用（只读）')
  assert.ok(popup.rect.width >= 470 && popup.rect.width <= 480, `默认宽 480（实际 ${popup.rect.width}）`)
  assert.ok(popup.rect.height <= 400 + 2, `最大高 400（实际 ${popup.rect.height}）`)
  passed++
  console.log('[悬停预览][PASS] 成功回包：正文绘制层可见（实底/命中/标题/禁写/480×400）')

  // ---- 场景 C：移入保活 + 内容滚动承载；移出后延迟关闭 ----
  const popupCenter = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-hover-popup')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height - 10, 60) }
  })
  await page.mouse.move(popupCenter.x, popupCenter.y, { steps: 4 })
  await page.waitForTimeout(CLOSE_WAIT + 150)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '移入浮层后应保活（超过关延迟仍在场）')
  assert.ok(popup.scrollHeight > popup.clientHeight, `长文应可滚动（scroll ${popup.scrollHeight} > client ${popup.clientHeight}）`)
  const scrolled = await page.evaluate(() => window.scrollHoverPopup(120))
  assert.ok(Math.abs(scrolled - 120) < 2, `内容应可滚动（scrollTop=${scrolled}）`)
  // 移出联合域（视口左上角空白）→ 延迟关闭
  await page.mouse.move(8, 8, { steps: 5 })
  await page.waitForTimeout(CLOSE_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '离开链接与浮层后应延迟关闭')
  passed++
  console.log('[悬停预览][PASS] 移入保活（可滚动）→ 移出联合域延迟关闭')

  // ---- 场景 D：Esc 关闭 + 关闭后迟到成功回包不得重开 ----
  await hoverLink()
  await page.waitForTimeout(OPEN_WAIT)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '再次悬停应重新打开')
  const reqs2 = await hoverRequests()
  const req2 = reqs2.at(-1)
  assert.notEqual(req2.instanceId, req.instanceId, '重开实例身份应换新')
  await page.keyboard.press('Escape')
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, 'Esc 应关闭浮层')
  // 已关闭实例的迟到成功回包
  await page.evaluate(({ reqId, instanceId, text }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 4, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: req2.reqId, instanceId: req2.instanceId, text: TARGET_DOC })
  await page.waitForTimeout(300)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.equal(popup.open, false, '迟到回包不得重开已关闭浮层')
  passed++
  console.log('[悬停预览][PASS] Esc 关闭 + 迟到成功回包不重开（实例身份校验）')

  // ---- 场景 E：错误分态就地呈现（不弹宿主通知、不关浮层）----
  // Esc 后指针仍在链接上：先移出联合域再悬停（同一目标上的 mouseover
  // 只有指针离开后再进入才会重发）
  await page.mouse.move(8, 8, { steps: 3 })
  await hoverLink()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs3 = await hoverRequests()
  const req3 = reqs3.at(-1)
  await page.evaluate(({ reqId, instanceId }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: false, reason: 'not-found',
  }), { reqId: req3.reqId, instanceId: req3.instanceId })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '错误态浮层保持在场（就地呈现）')
  assert.equal(popup.stateVisible, true, '错误文案应在状态行在场绘制')
  assert.ok(popup.stateText.length > 0, '错误文案非空')
  const expectedError = zhCn['hover.errorNotFound'].replaceAll('{target}', '目标笔记')
  assert.equal(popup.stateText, expectedError, `错误文案应与语言包同源（期望 ${expectedError}）`)
  await page.keyboard.press('Escape')
  passed++
  console.log('[悬停预览][PASS] 错误分态就地呈现（not-found 含目标原文）')

  // ---- 场景 F：零写回 —— 全程交互后无任何 edit.request 出站 ----
  const edits = await editRequests()
  assert.equal(edits, 0, '悬停预览全程不得产生 edit.request（零写回）')
  passed++
  console.log('[悬停预览][PASS] 零写回：全程无 edit.request 出站')

  // ---- 场景 G：小视口四边避障——锚点贴近底缘时翻到上方 ----
  // 长父文档使阅读容器可滚动；locator.hover 会自动把元素滚回视口中央
  //（破坏贴底构造），故先滚容器再用 mouse.move 落点（不触发自动滚动）
  const LONG_PARENT_DOC = [
    '# 父文档（长）',
    '',
    ...Array.from({ length: 40 }, (_, i) => `铺垫段落 ${i + 1}，撑出可滚动的阅读容器。`),
    '',
    '指向 [[目标笔记]] 的双链。',
    '',
  ].join('\n')
  const small = await browser.newPage({ viewport: { width: 520, height: 420 } })
  small.on('pageerror', (error) => errors.push(error.message))
  await small.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await small.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await small.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await small.addScriptTag({ path: bundle })
  await small.evaluate((text) => window.initHoverDoc(text), LONG_PARENT_DOC)
  await small.locator('a.vsidian-wikilink').first().waitFor()
  // 把链接滚到紧贴视口底缘（距底约 30px——上方空间远大于下方，触发翻转）
  const scrolledNearBottom = await small.evaluate(() => window.scrollReadingSoAnchorNearBottom(30))
  assert.equal(scrolledNearBottom, true, '长文档下容器应可滚动贴底')
  const linkPoint = await small.evaluate(() => {
    const r = document.querySelector('a.vsidian-wikilink').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await small.mouse.move(linkPoint.x, linkPoint.y, { steps: 3 })
  await small.waitForTimeout(OPEN_WAIT)
  const smallReq = (await small.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'hover.request'))).at(-1)
  await small.evaluate(({ reqId, instanceId, text }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'x', relPath: 'y.md' }, version: 1, text,
    range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: smallReq.reqId, instanceId: smallReq.instanceId, text: TARGET_DOC })
  await small.waitForTimeout(120)
  const smallPopup = await small.evaluate(() => window.readHoverPopup())
  const smallAnchor = await small.evaluate(() => window.readAnchor())
  assert.ok(smallPopup.open, '小视口浮层应打开')
  assert.ok(smallPopup.rect.top < smallAnchor.top, `锚点贴底时应翻到上方（浮层 top ${smallPopup.rect.top} < 锚 top ${smallAnchor.top}）`)
  assert.ok(smallPopup.rect.top >= 0 && smallPopup.rect.top + smallPopup.rect.height <= smallPopup.viewport.height + 1,
    `浮层应整体落在视口内（top ${smallPopup.rect.top}，bottom ${smallPopup.rect.top + smallPopup.rect.height}，vh ${smallPopup.viewport.height}）`)
  assert.ok(smallPopup.rect.left >= 0 && smallPopup.rect.left + smallPopup.rect.width <= smallPopup.viewport.width + 1,
    `水平方向应钳制在视口内（left ${smallPopup.rect.left}，right ${smallPopup.rect.left + smallPopup.rect.width}，vw ${smallPopup.viewport.width}）`)
  // 小视口宽度收缩：520 视口下宽 ≤ 520-16
  assert.ok(smallPopup.rect.width <= 520 - 16 + 1, `窄视口应收缩宽（实际 ${smallPopup.width}）`)
  await small.keyboard.press('Escape')
  await small.close()
  passed++
  console.log('[悬停预览][PASS] 小视口四边避障：贴底翻上方 + 视口内钳制 + 宽度收缩')

  // ---- #219 场景族：局部范围（章节/块）与普通链接 ----
  // 辅助：悬停第 n 个双链并等待开延迟
  const hoverNthWikilink = async (n) => {
    const loc = page.locator('a.vsidian-wikilink').nth(n)
    await loc.scrollIntoViewIfNeeded()
    await loc.hover()
    await page.waitForTimeout(OPEN_WAIT)
  }
  const lastRequest = async () =>
    (await page.evaluate(() => window.hoverSent().filter((m) => m.kind === 'hover.request'))).at(-1)
  const respondScoped = (req, range, scope) => page.evaluate(
    ({ reqId, instanceId, text, range, scope }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
      version: 5, text, range, scope,
    }),
    { reqId: req.reqId, instanceId: req.instanceId, text: TARGET_DOC, range, scope })

  // ---- 场景 H：标题章节双链——只渲染章节内块（切块后过滤，非截字符串）----
  await hoverNthWikilink(1)
  const hReq = await lastRequest()
  assert.equal(hReq.target, '目标笔记#章节一', '章节双链 target 为原文')
  assert.equal(hReq.linkHref, undefined, '双链不携带 linkHref')
  await respondScoped(hReq, SECTION_ONE_RANGE, { kind: 'heading', anchor: '章节一' })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '章节预览浮层在场')
  assert.ok(popup.hitInside, '章节内容绘制层可见（命中浮层内）')
  assert.ok(popup.text.includes('章节一'), `应含目标标题（实际 ${popup.text.slice(0, 80)}）`)
  assert.ok(popup.text.includes('章节一段落'), '应含章节内段落')
  assert.ok(!popup.text.includes('目标笔记全文标题'), '章节外的顶部标题不得出现')
  assert.ok(!popup.text.includes('章节二段落'), '下一章节内容不得出现')
  assert.deepEqual(popup.listItems, ['章节列表一', '章节列表二'],
    `章节内列表整取且全文顶部任务列表被过滤（实际 ${JSON.stringify(popup.listItems)}）`)
  await page.keyboard.press('Escape')
  passed++
  console.log('[悬停预览][PASS] 标题章节双链：章节内块渲染（含列表）、章节外内容过滤')

  // ---- 场景 I：块引用双链——多行块整取（列表不截首行）----
  await hoverNthWikilink(2)
  const iReq = await lastRequest()
  assert.equal(iReq.target, '目标笔记#^multi-blk')
  await respondScoped(iReq, MULTI_BLOCK_RANGE, { kind: 'block', anchor: '^multi-blk' })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '块预览浮层在场')
  assert.deepEqual(popup.listItems, ['章节列表一', '章节列表二'],
    `多行列表块整取——不得截成首行（实际 ${JSON.stringify(popup.listItems)}）`)
  assert.ok(!popup.text.includes('章节一段落'), '块外内容不得出现')
  await page.keyboard.press('Escape')
  passed++
  console.log('[悬停预览][PASS] 块引用双链：完整多行块（列表两项整取、块外过滤）')

  // ---- 场景 J：普通链接全文——linkHref 载荷与 DOM href 保真 ----
  const fullLink = page.locator('a').filter({ hasText: '全文链接' })
  await fullLink.scrollIntoViewIfNeeded()
  await fullLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const jReq = await lastRequest()
  const jHref = await fullLink.evaluate((el) => el.getAttribute('href'))
  assert.equal(jReq.linkHref, jHref, `普通链接 linkHref 应为 DOM href 原文（实际 ${jReq.linkHref}）`)
  assert.equal(jReq.target, jHref, 'target 同为 href 原文（错误文案共用）')
  await respondScoped(jReq, { start: 0, end: TARGET_DOC.length }, { kind: 'full' })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open && popup.text.includes('目标笔记全文标题'), '普通链接全文预览在场')
  assert.ok(popup.text.includes('章节二段落'), '全文含尾部章节')
  await page.keyboard.press('Escape')
  passed++
  console.log('[悬停预览][PASS] 普通链接全文：linkHref 载荷保真 + 全文渲染')

  // ---- 场景 K：普通链接章节锚点——fragment 目标同样收窄 ----
  const sectionLink = page.locator('a').filter({ hasText: '章节链接' })
  await sectionLink.scrollIntoViewIfNeeded()
  await sectionLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const kReq = await lastRequest()
  const kHref = await sectionLink.evaluate((el) => el.getAttribute('href'))
  assert.equal(kReq.linkHref, kHref, `章节链接 linkHref 应为 DOM href 原文（实际 ${kReq.linkHref}）`)
  await respondScoped(kReq, SECTION_ONE_RANGE, { kind: 'heading', anchor: '章节一' })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open && popup.text.includes('章节一段落'), '链接章节预览在场')
  assert.ok(!popup.text.includes('章节二段落'), '章节外内容过滤')
  await page.keyboard.press('Escape')
  passed++
  console.log('[悬停预览][PASS] 普通链接章节锚点：fragment 目标收窄渲染')

  // ---- 场景 L：外部链接预滤——不开浮层、零请求 ----
  const requestsBefore = (await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'hover.request'))).length
  for (const label of ['外站', '协议相对']) {
    const external = page.locator('a').filter({ hasText: label })
    await external.scrollIntoViewIfNeeded()
    await external.hover()
    await page.waitForTimeout(OPEN_WAIT)
    const externalPopup = await page.evaluate(() => window.readHoverPopup())
    assert.equal(externalPopup.open, false, `${label}（外部网页）不得开浮层`)
  }
  const requestsAfter = (await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'hover.request'))).length
  assert.equal(requestsAfter, requestsBefore, '外部链接悬停不得产生 hover.request')
  passed++
  console.log('[悬停预览][PASS] 外部链接预滤：https 与协议相对均零浮层零请求')

  // ---- 场景 M：锚点缺失——就地分态提示（不以全文替代），文案与语言包同源 ----
  await hoverNthWikilink(3)
  const mReq = await lastRequest()
  assert.equal(mReq.target, '目标笔记#没有的锚点')
  await page.evaluate(({ reqId, instanceId, anchor }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: false, reason: 'anchor-missing', anchor,
  }), { reqId: mReq.reqId, instanceId: mReq.instanceId, anchor: '没有的锚点' })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '锚点缺失浮层保持在场（就地提示）')
  assert.equal(popup.stateVisible, true, '错误文案在状态行绘制')
  const expectedAnchorMissing = zhCn['hover.errorAnchorMissing']
    .replaceAll('{target}', '目标笔记#没有的锚点')
    .replaceAll('{anchor}', '没有的锚点')
  assert.equal(popup.stateText, expectedAnchorMissing,
    `锚点缺失文案与语言包同源（期望 ${expectedAnchorMissing}，实际 ${popup.stateText}）`)
  await page.keyboard.press('Escape')
  passed++
  console.log('[悬停预览][PASS] 锚点缺失：anchor-missing 就地提示（含锚点原文，语言包同源）')

  // ---- #220 场景族：来源资源（B 身份）、浮层内链接与笔记属性区 ----
  const B_FS_PATH = 'D:\\notes\\sub\\b.md'
  /** B 目标文档：成型 frontmatter + 相对图片 + 双链/普通链接 + 代码块 */
  const B_DOC = [
    '---',
    'title: B 笔记',
    'tags: alpha',
    '---',
    '',
    '# B 文档标题',
    '',
    '![B 相对图](./img.png)',
    '',
    '内部双链 [[C 笔记]] 与普通 [局部链接](c.md)。',
    '',
    '```js',
    'const answer = 42',
    '```',
    '',
  ].join('\n')
  const respondB = (req) => page.evaluate(
    ({ reqId, instanceId, text, fsPath }) => window.respondHoverResult({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath, relPath: 'sub/b.md' },
      version: 6, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
    }),
    { reqId: req.reqId, instanceId: req.instanceId, text: B_DOC, fsPath: B_FS_PATH })

  // ---- 场景 N：B 相对图片以 B 为来源——image.request 附 sourceDocUri + 结果应用 ----
  await hoverNthWikilink(0)
  await respondB(await lastRequest())
  await page.waitForTimeout(120)
  const imgReqs = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'image.request'))
  assert.equal(imgReqs.length, 1, 'B 文档图片应发出一次 image.request')
  const imgReq = imgReqs[0]
  assert.equal(imgReq.sourceDocUri, B_FS_PATH,
    `图片请求应以 B 为来源解析（实际 ${imgReq.sourceDocUri}）`)
  assert.equal(imgReq.docUri, 'file:///d%3A/notes/parent.md', '会话守卫字段仍是面板自身文档')
  assert.equal(imgReq.sessionId, 'hover-preview')
  assert.equal(imgReq.src, './img.png')
  // 宿主解析结果注入（真实 handleHostMessage 同入口）→ src 应用到浮层图片
  await page.evaluate(({ reqId }) => window.respondHoverResult({
    kind: 'image.result', reqId, ok: true, src: 'vscode-webview://res/sub/img.png',
  }), { reqId: imgReq.reqId })
  await page.waitForTimeout(80)
  const imgs = await page.evaluate(() => window.readHoverImages())
  assert.equal(imgs.length, 1, '浮层内应有一张图片')
  assert.equal(imgs[0].rawSrc, './img.png', '原始地址转入 data 属性')
  assert.equal(imgs[0].appliedSrc, 'vscode-webview://res/sub/img.png',
    'B 身份解析结果应应用到浮层图片（src 应用）')
  passed++
  console.log('[悬停预览][PASS] B 相对图片以 B 为来源：sourceDocUri 载荷 + 解析结果应用')

  // ---- 场景 O：浮层内链接点击跳转——既有 open 通道附 sourceDocUri，浮层关闭 ----
  await page.locator('.vsidian-hover-popup a.vsidian-wikilink').click()
  const wlActivates = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'wikilink.activate'))
  assert.equal(wlActivates.length, 1, '浮层内双链点击应发出 wikilink.activate')
  const wl = wlActivates[0]
  assert.equal(wl.target, 'C 笔记')
  assert.equal(wl.sourceDocUri, B_FS_PATH, '双链跳转应以 B 为来源解析')
  assert.equal(wl.docUri, 'file:///d%3A/notes/parent.md', '会话守卫字段仍是面板自身')
  assert.equal((await page.evaluate(() => window.readHoverPopup())).open, false,
    '点击跳转后浮层应关闭（上下文切换）')
  // 重开 → 点击普通链接（link.activate 同口径）
  await hoverNthWikilink(0)
  await respondB(await lastRequest())
  await page.waitForTimeout(120)
  await page.locator('.vsidian-hover-popup a[href="c.md"]').click()
  const linkActivates = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'link.activate'))
  assert.equal(linkActivates.length, 1, '浮层内普通链接点击应发出 link.activate')
  assert.equal(linkActivates[0].href, 'c.md')
  assert.equal(linkActivates[0].sourceDocUri, B_FS_PATH, '普通链接跳转应以 B 为来源解析')
  assert.equal((await page.evaluate(() => window.readHoverPopup())).open, false, '跳转后浮层关闭')
  assert.equal(await editRequests(), 0, '浮层内点击不得产生 edit.request（零写回）')
  passed++
  console.log('[悬停预览][PASS] 浮层内链接可点击：双链/普通链接经 open 通道（sourceDocUri）+ 零写回')

  // ---- 场景 P：笔记属性区——默认折叠 + 标题行热区显示按钮 + 点击展开 ----
  await hoverNthWikilink(0)
  await respondB(await lastRequest())
  await page.waitForTimeout(120)
  let fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.present, true, '全文引用（成型 frontmatter）应显示属性区')
  assert.equal(fm.collapsed, true, '属性区默认折叠')
  assert.equal(fm.rowDisplay, 'none', '收起态属性行不可见（display:none）')
  assert.equal(fm.btnOpacity, '0', '切换按钮默认透明')
  assert.equal(fm.btnPointerEvents, 'none', '切换按钮默认不接指针')
  assert.equal(fm.btnAriaExpanded, 'false', 'aria-expanded 随态')
  // 代码高亮：朴素形态 token span 在场（沿用现有引擎，卡片工具条不进入浮层）
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.codeTokenSpans > 0, `代码块应有 token span（实际 ${popup.codeTokenSpans}）`)
  // 标题整行是悬停热区：hover 标题行 → 按钮显示并接指针（不是悬停自动展开）
  await page.locator('.vsidian-hover-popup .vsidian-hover-fm .vsidian-fm-header').hover()
  await page.waitForTimeout(220) // 按钮透明度有 0.12s 过渡——等过渡完成再断言
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.collapsed, true, '悬停标题行不自动展开')
  assert.equal(fm.btnOpacity, '1', '悬停标题行应显示切换按钮')
  assert.equal(fm.btnPointerEvents, 'auto', '显示后按钮应可点击')
  // 点击按钮展开：属性行回到可见
  await page.locator('.vsidian-hover-fm-toggle').click()
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.collapsed, false, '点击按钮应展开')
  assert.notEqual(fm.rowDisplay, 'none', '展开后属性行可见')
  assert.equal(fm.btnAriaExpanded, 'true')
  passed++
  console.log('[悬停预览][PASS] 笔记属性区：默认折叠/热区显示按钮/点击展开 + 代码朴素高亮')

  // ---- 场景 Q：键盘操作——键盘模态下聚焦按钮（focus-visible 显示）+ Enter/Space 切换 ----
  // 指针挪到浮层正文标题（保活）但避开属性行——按钮显示只可能来自键盘聚焦。
  // 说明：纯 Tab 从头遍历会先走过父文档链接并触发「父容器滚动即关闭」
  //（#218 规则，锚点视口失效）——键盘直达浮层内部属 #221（键盘打开即
  // 焦点进入）；本场景以一次 Tab 建立键盘模态后程序化聚焦按钮，验证
  // :focus-visible 显示规则与 Enter/Space 原生激活（与键盘路径同一焦点态）
  const titlePoint = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-hover-popup .vsidian-reading-heading-1')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(titlePoint.x, titlePoint.y, { steps: 3 })
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      active.blur()
    }
  })
  await page.waitForTimeout(220) // 透明度过渡回落完成后再断言（非热区且无聚焦 = 隐藏）
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.btnOpacity, '0', '指针在正文（非热区）且无键盘聚焦时按钮应保持隐藏')
  await page.keyboard.press('Tab') // 建立键盘模态（此后聚焦按 :focus-visible 呈现）
  await page.locator('.vsidian-hover-fm-toggle').focus()
  await page.waitForTimeout(220) // 透明度过渡完成后再断言
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.btnOpacity, '1', '键盘聚焦应显示按钮（focus-visible）')
  assert.equal(fm.btnPointerEvents, 'auto', '键盘聚焦后按钮可操作')
  const focusState = await page.evaluate(() => {
    const btn = document.querySelector('.vsidian-hover-popup .vsidian-hover-fm-toggle')
    return {
      focused: document.activeElement === btn,
      focusVisible: btn.matches(':focus-visible'),
    }
  })
  assert.equal(focusState.focused, true, '按钮应持有焦点')
  assert.equal(focusState.focusVisible, true, '焦点态应为 focus-visible（键盘模态）')
  // Enter 原生激活 → 收起；Space 原生激活 → 展开（同一 click 处理器）
  await page.keyboard.press('Enter')
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.collapsed, true, 'Enter 应切换为收起')
  await page.keyboard.press('Space')
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.collapsed, false, 'Space 应切换为展开')
  passed++
  console.log('[悬停预览][PASS] 属性区键盘操作：键盘模态聚焦显示按钮 + Enter/Space 切换')

  // ---- 场景 R：刷新保留展开状态（同实例内容重建）→ 重新打开恢复折叠 ----
  const rReq = await lastRequest()
  await respondB(rReq)
  await page.waitForTimeout(120)
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.collapsed, false, '刷新（目标内容变化引发的重建）不得重置展开状态')
  await page.keyboard.press('Escape')
  await hoverNthWikilink(0)
  await respondB(await lastRequest())
  await page.waitForTimeout(120)
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.collapsed, true, '重新打开浮层应恢复默认折叠')
  passed++
  console.log('[悬停预览][PASS] 属性区状态保持：刷新保留展开、重开恢复折叠')

  // ---- 场景 S：明暗主题下浮层与属性区跟随主题（绘制层颜色断言） ----
  // 宿主在真实环境按主题注入 --vscode-* 变量；此处模拟明暗两套注入，验证
  // 浮层（#220 起挂 #app，主题变量经继承链生效）与属性区标题行随主题取色
  await page.addStyleTag({ content: [
    'body.vscode-dark { --vscode-editor-background: #1e1e1e; --vscode-panel-border: #3c3c3c; }',
    'body.vscode-light { --vscode-editor-background: #ffffff; --vscode-panel-border: #cccccc; }',
  ].join('\n') })
  await page.evaluate(() => document.body.classList.add('vscode-dark'))
  let themed = await page.evaluate(() => window.readHoverPopup())
  assert.equal(themed.background, 'rgb(30, 30, 30)',
    `暗色主题浮层实底应取主题背景（实际 ${themed.background}）`)
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.headerVisible, true, '暗色主题下属性区标题行可见')
  assert.equal(fm.headerBg, 'rgba(128, 128, 128, 0.05)',
    `属性区标题行应取 #app 层微亮条变量（实际 ${fm.headerBg}——证明 #app 样式链命中浮层）`)
  await page.evaluate(() => {
    document.body.classList.remove('vscode-dark')
    document.body.classList.add('vscode-light')
  })
  themed = await page.evaluate(() => window.readHoverPopup())
  assert.equal(themed.background, 'rgb(255, 255, 255)',
    `亮色主题浮层实底应取主题背景（实际 ${themed.background}）`)
  fm = await page.evaluate(() => window.readHoverFm())
  assert.equal(fm.headerVisible, true, '亮色主题下属性区标题行可见')
  passed++
  console.log('[悬停预览][PASS] 明暗主题：浮层实底与属性区标题行随主题取色（绘制层）')

  // ---- 场景 T：短文末尾紧凑留白，不能继承主阅读视图的 40vh ----
  const shortDoc = '正文第一段。\n\n本文正文结束。\n'
  for (const height of [640, 1000]) {
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 900, height })
    await page.mouse.move(60, 500)
    await hoverLink()
    await page.waitForTimeout(OPEN_WAIT)
    const shortReq = await lastRequest()
    await page.evaluate(({ req, text }) => window.respondHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\短文.md', relPath: '短文.md' }, version: 1,
      text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
    }), { req: shortReq, text: shortDoc })
    await page.waitForTimeout(120)
    const spacing = await page.evaluate(() => {
      const content = document.querySelector('.vsidian-hover-popup .vsidian-view-reading')
      const last = [...content.querySelectorAll('.vsidian-reading-block')].at(-1)
      const lastRect = last.getBoundingClientRect()
      return {
        paddingBottom: getComputedStyle(content).paddingBottom,
        trailingGap: content.getBoundingClientRect().bottom - lastRect.bottom,
        endVisible: document.elementFromPoint(lastRect.left + 5, lastRect.top + 5)?.closest('.vsidian-reading-block') === last,
        mainPaddingBottom: getComputedStyle(document.querySelector('.vsidian-main > .vsidian-view-reading')).paddingBottom,
      }
    })
    assert.equal(spacing.paddingBottom, '10px', '浮层内容应使用紧凑内边距')
    assert.ok(spacing.trailingGap < 40, `文末不得多出大截空白（实际 ${spacing.trailingGap}px）`)
    assert.equal(spacing.endVisible, true, '文末内容须在绘制层可见')
    assert.equal(spacing.mainPaddingBottom, `${height * 0.4}px`, '主阅读视图保留原有 40vh 文末留白')
  }
  passed++
  console.log('[悬停预览][PASS] 浮层文末紧凑留白：两种视口高度 + 文末绘制可见 + 主阅读留白保持')

  assert.deepEqual(errors, [], '页面无未捕获异常')
  console.log(`[悬停预览] 全部 ${passed} 组场景通过`)
} finally {
  await browser.close()
}
