// #299 跳转目标提示的原生浏览器回归：真实布局（Chromium）下用真实指针
// 驱动生产控制器——行为矩阵逐行（默认组合无 Ctrl 出提示；浮层将现不出；
// 补按 Ctrl 即消；阅读/面板/浮层内子引用在总开关开时不出；总开关关全域
// 出；指向图片目标出；提示开关关不出）+ 消失四路（浮层开/指针离场/
// 持焦 Esc/目标脱树）+ 缓存与解析失败契约 + 零浮层读取零写回。提示可见
// 性与内容断言落绘制层（实底背景 + 非零几何 + 文本，非 DOM 存在性）。
// 宿主轻量解析回包由脚本注入（respondHost → handleHostMessage 同入口）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'targetTip/targetTip.js')
await build({ entryPoints: [path.join(root, 'test/browser/targetTipFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml } = await buildZhLocaleIsland(root)

/** 默认组合文档：Live 双链 + 普通链接 + 图片双链 + 本文件锚点 */
const DOC = [
  '# 父文档',
  '',
  '指向 [[目标笔记]] 的双链。',
  '',
  '图片引用 [[assets/图.png]] 与锚点 [[#本文件标题]]、[[#页内锚]]。',
  '',
  '普通链接 [全文](目标笔记.md)。',
  '',
  '结尾。',
  '',
].join('\n')

const OPEN_WAIT = 750 // 稳定悬停 300ms（统一 tooltip 延迟变量缺省）+ 余量

/** 页面装配 */
const setupPage = async (browser, text) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((t) => window.initTargetTipDoc(t), text)
  return { page, errors }
}

const resolves = (page) => page.evaluate(() =>
  window.tipSent().filter((m) => m.kind === 'hover.target.resolve'))
const hoverRequests = (page) => page.evaluate(() =>
  window.tipSent().filter((m) => m.kind === 'hover.request'))
const editRequests = (page) => page.evaluate(() =>
  window.tipSent().filter((m) => m.kind === 'edit.request').length)
const tip = (page) => page.evaluate(() => window.readTargetTip())
const popup = (page) => page.evaluate(() => window.readTipPopup())
/** 注入轻量解析成功回包（最后一条 resolve 请求配对） */
const respondOk = async (page, relPath, anchor) => {
  const reqs = await resolves(page)
  const req = reqs.at(-1)
  assert.ok(req, '应已发出 hover.target.resolve')
  await page.evaluate(({ reqId, relPath, anchor }) => window.respondHost(
    { kind: 'hover.target.resolved', reqId, ok: true, relPath, ...(anchor ? { anchor } : {}) }),
  { reqId: req.reqId, relPath, anchor })
}
const respondFail = async (page) => {
  const reqs = await resolves(page)
  const req = reqs.at(-1)
  assert.ok(req, '应已发出 hover.target.resolve')
  await page.evaluate((reqId) => window.respondHost(
    { kind: 'hover.target.resolved', reqId, ok: false }), req.reqId)
}

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  // ---- 场景 1（矩阵行 2）：默认组合 Live 无 Ctrl → 提示出（绘制层）----
  const { page, errors } = await setupPage(browser, DOC)
  await page.evaluate(() => window.applyTipSettings({}))
  const wikilink = page.locator('.cm-content .vsidian-wikilink').first()
  await wikilink.waitFor()
  await wikilink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  // 稳定悬停满延迟：发出轻量解析请求（双链 target 原文），零浮层读取
  const reqs1 = await resolves(page)
  assert.equal(reqs1.length, 1, '应恰发出一次 hover.target.resolve')
  assert.equal(reqs1[0].target, '目标笔记', '双链形态 target 为原文')
  assert.equal(reqs1[0].linkHref, undefined)
  assert.equal(reqs1[0].directTarget, undefined)
  assert.equal(reqs1[0].sessionId, 'target-tip')
  assert.equal(reqs1[0].docUri, 'file:///d%3A/notes/parent.md')
  assert.equal((await hoverRequests(page)).length, 0, '提示场景零 hover.request（轻量边界）')
  assert.equal((await tip(page)).open, false, '回包前提示不在场')
  await respondOk(page, 'sub/目标笔记.md', '#章节一')
  const t1 = await tip(page)
  assert.equal(t1.open, true, '回包后提示在场')
  assert.equal(t1.text, 'sub/目标笔记.md#章节一', '内容 = 所属根相对路径 + 源码形态锚点')
  assert.ok(t1.background.includes('rgb(') && t1.background !== 'rgba(0, 0, 0, 0)',
    `提示应有实底背景（实际 ${t1.background}）`)
  assert.ok(t1.rect.width > 0 && t1.rect.height > 0, '提示非零尺寸（真实绘制）')
  assert.equal(t1.display, 'block', '统一 tooltip 卡片显示态（--shown）')
  assert.equal(t1.focusable, true, '提示可聚焦（统一 tooltip 语义）')
  // 几何：提示贴锚点下方（统一几何：下方优先）
  const anchorBox = await wikilink.boundingBox()
  assert.ok(t1.rect.top >= (anchorBox?.y ?? 0) + (anchorBox?.height ?? 0) - 2,
    `提示应位于锚点下方（提示 top ${t1.rect.top}，锚 bottom ${(anchorBox?.y ?? 0) + (anchorBox?.height ?? 0)}）`)
  passed++
  console.log('[目标提示][PASS] 矩阵行2：默认组合无 Ctrl 出提示（绘制层实底+几何+内容+轻量请求）')

  // ---- 场景 2（矩阵行 3）：悬停中补按 Ctrl → 提示立即消失，浮层开 ----
  await page.keyboard.down('Control')
  const t2 = await tip(page)
  assert.equal(t2.open, false, '补按 Ctrl 提示立即消失（不等浮层打开）')
  await page.waitForTimeout(OPEN_WAIT)
  const p2 = await popup(page)
  assert.equal(p2.open, true, '补按 Ctrl 后浮层照常打开（loading 态在场）')
  await page.keyboard.up('Control')
  await page.keyboard.press('Escape')
  await page.mouse.move(8, 8)
  await page.waitForTimeout(150)
  passed++
  console.log('[目标提示][PASS] 矩阵行3：补按 Ctrl 即消 + 浮层打开（联动收起）')

  // ---- 场景 3（矩阵行 1）：直接悬停开 → 浮层开、提示不出 ----
  await page.evaluate(() => window.applyTipSettings({ 'hover.liveDirect': true }))
  await wikilink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs3 = await resolves(page)
  assert.equal(reqs3.length, 1, '直接悬停开（浮层将现）零提示请求')
  assert.equal((await popup(page)).open, true, '浮层打开（loading）')
  assert.equal((await tip(page)).open, false, '浮层将现场景不出提示')
  await page.keyboard.press('Escape')
  await page.mouse.move(8, 8)
  await page.waitForTimeout(150)
  await page.evaluate(() => window.applyTipSettings({ 'hover.liveDirect': false }))
  passed++
  console.log('[目标提示][PASS] 矩阵行1：浮层将现（直接悬停开）不出提示')

  // ---- 场景 4（矩阵行 4a）：Reading 正文（总开关开）→ 浮层开、不出提示 ----
  await page.evaluate(() => window.setTipMode('reading'))
  const readingLink = page.locator('a.vsidian-wikilink').first()
  await readingLink.waitFor()
  await readingLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await resolves(page)).length, 1, 'Reading 直接悬停零提示请求')
  assert.equal((await popup(page)).open, true, 'Reading 悬停浮层打开')
  assert.equal((await tip(page)).open, false, 'Reading（总开关开）不出提示')
  await page.keyboard.press('Escape')
  await page.mouse.move(8, 8)
  await page.waitForTimeout(150)

  // ---- 场景 5（矩阵行 4b）：面板条目（总开关开）→ 浮层开、不出提示 ----
  await page.evaluate(() => window.injectTipBacklinks([{
    sourceRelPath: '来源笔记.md', sourceFsPath: 'D:\\notes\\来源笔记.md',
    kind: 'wikilink', anchor: '', start: 24, end: 36, line: 3,
    snippet: '指向 [[父文档]] 的引用行',
  }]))
  // 侧栏默认收起：先展开侧栏再切反链面板（hoverEntry 先例）
  await page.locator('.vsidian-sidebar-toggle').click()
  await page.locator('.vsidian-backlinks-toggle').click()
  await page.locator('.vsidian-backlink-item').first().waitFor()
  await page.locator('.vsidian-backlink-item').first().hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await resolves(page)).length, 1, '面板悬停（总开关开）零提示请求')
  assert.equal((await popup(page)).open, true, '面板悬停浮层打开')
  assert.equal((await tip(page)).open, false, '面板（总开关开）不出提示')
  await page.keyboard.press('Escape')
  await page.mouse.move(8, 8)
  await page.waitForTimeout(150)

  // ---- 场景 6（矩阵行 4c）：浮层内子引用 → 不出提示（浮层在场） ----
  // 回 Reading 开浮层并注入含子引用的回包，悬停浮层内链接：浮层内容不在
  // 提示入口容器（readingContainer/contentDOM/面板）——零提示链路
  const readingLink6 = page.locator('a.vsidian-wikilink').first()
  await readingLink6.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs6 = (await page.evaluate(() =>
    window.tipSent().filter((m) => m.kind === 'hover.request'))).at(-1)
  assert.ok(reqs6, '浮层读取请求在场')
  const inner = '# B 文档\n\n内部子引用 [[C 笔记]]。\n'
  await page.evaluate(({ reqId, instanceId, text }) => window.respondHost({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: reqs6.reqId, instanceId: reqs6.instanceId, text: inner })
  await page.waitForTimeout(150)
  const innerLink = page.locator('.vsidian-hover-popup a.vsidian-wikilink').first()
  await innerLink.waitFor()
  await innerLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await tip(page)).open, false, '浮层内子引用不出提示（浮层在场）')
  assert.equal((await resolves(page)).length, 1, '浮层内子引用零提示请求')
  await page.keyboard.press('Escape')
  await page.mouse.move(8, 8)
  await page.waitForTimeout(150)
  passed++
  console.log('[目标提示][PASS] 矩阵行4：Reading/面板/浮层内子引用（总开关开）均不出提示')

  // ---- 场景 7（矩阵行 6）：总开关关 → 全域出提示、零浮层请求 ----
  const hoverReqBase7 = (await hoverRequests(page)).length
  await page.evaluate(() => window.applyTipSettings({ 'hover.enabled': false }))
  // 7a Reading（同目标命中场景 1 的成功缓存——跨设置组合复用，零新请求）
  const resolves7a = (await resolves(page)).length
  const readingLink7 = page.locator('a.vsidian-wikilink').first()
  await readingLink7.hover()
  await page.waitForTimeout(OPEN_WAIT)
  let t7 = await tip(page)
  assert.equal(t7.open, true, '总开关关：Reading 出提示（缓存直接出）')
  assert.equal(t7.text, 'sub/目标笔记.md#章节一', '缓存内容一致（相对路径+锚点）')
  assert.equal((await resolves(page)).length, resolves7a, '缓存命中零新解析请求')
  assert.equal((await popup(page)).open, false, '总开关关零浮层')
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(150)
  // 7b 面板
  const resolvesBefore7b = (await resolves(page)).length
  const item7 = page.locator('.vsidian-backlink-item').first()
  await item7.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs7b = await resolves(page)
  assert.equal(reqs7b.length, resolvesBefore7b + 1, '面板悬停发出提示请求（directTarget 形态）')
  assert.deepEqual(reqs7b.at(-1).directTarget, { fsPath: 'D:\\notes\\来源笔记.md' },
    '面板直接目标载荷形态')
  await respondOk(page, '来源笔记.md')
  t7 = await tip(page)
  assert.equal(t7.open, true, '总开关关：面板出提示')
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(150)
  // 7c Live（含按住 Ctrl：总开关关时浮层仍不开，提示照出）。同目标
  //（目标笔记）已命中成功缓存——跨入口复用，零新解析请求
  const resolvesBefore7c = (await resolves(page)).length
  await page.evaluate(() => window.setTipMode('live'))
  const liveDeco7 = page.locator('.cm-content .vsidian-wikilink').first()
  await liveDeco7.hover()
  await page.waitForTimeout(OPEN_WAIT)
  t7 = await tip(page)
  assert.equal(t7.open, true, '总开关关：Live（无 Ctrl）出提示（缓存复用）')
  await page.keyboard.down('Control')
  await liveDeco7.hover({ modifiers: ['Control'] })
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await popup(page)).open, false, '总开关关 + Ctrl：浮层仍不开')
  assert.equal((await resolves(page)).length, resolvesBefore7c, 'Ctrl+悬停同目标缓存命中零新请求')
  assert.equal((await tip(page)).open, true, '总开关关 + Ctrl：提示照出（浮层无从开）')
  await page.keyboard.up('Control')
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(150)
  assert.equal((await hoverRequests(page)).length, hoverReqBase7, '总开关关期间零浮层读取请求（增量）')
  passed++
  console.log('[目标提示][PASS] 矩阵行6：总开关关全域出提示（Reading/面板/Live 两路）+ 零浮层')

  // ---- 场景 8（矩阵行 5）：指向图片目标 → 提示出、内容为图片路径 ----
  await page.evaluate(() => window.applyTipSettings({ 'hover.enabled': true, 'hover.liveDirect': false }))
  const imgLink = page.locator('.cm-content .vsidian-wikilink').nth(1)
  await imgLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs8 = await resolves(page)
  assert.equal(reqs8.at(-1).target, 'assets/图.png', '图片双链 target 原文')
  await respondOk(page, 'assets/图.png')
  const t8 = await tip(page)
  assert.equal(t8.open, true, '指向图片（浮层不可展开组合）提示出')
  assert.equal(t8.text, 'assets/图.png', '提示内容为图片路径')
  passed++
  console.log('[目标提示][PASS] 矩阵行5：图片目标出提示（默认组合触发条件未满足）')

  // ---- 场景 9：消失四路——指针离场 / 持焦 Esc / 目标脱树（滚动） ----
  // 9a 指针离场
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  assert.equal((await tip(page)).open, false, '指针离开目标即收')
  // 9b 持焦 Esc（统一 tooltip 语义：提示持焦时 Esc 收起并还焦锚点）
  await imgLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  await respondOk(page, 'assets/图.png')
  assert.equal((await tip(page)).open, true, '重悬停提示在场')
  await page.evaluate(() => {
    const el = document.querySelector('.vsidian-tooltip.vsidian-tooltip--shown')
    if (el instanceof HTMLElement) el.focus()
  })
  await page.keyboard.press('Escape')
  assert.equal((await tip(page)).open, false, '持焦 Esc 收起提示')
  // 9c 滚动即收（统一 tooltip 语义；「目标脱树（虚拟化回收伴随滚动）」
  // 由同一捕获路径覆盖，回包时脱树的 isConnected 兜底由单元测试钉住）
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  await imgLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  await respondOk(page, 'assets/图.png')
  assert.equal((await tip(page)).open, true, '第三次悬停提示在场')
  await page.evaluate(() => {
    document.dispatchEvent(new Event('scroll'))
  })
  assert.equal((await tip(page)).open, false, '滚动捕获即收（覆盖虚拟化回收场景）')
  passed++
  console.log('[目标提示][PASS] 消失四路：指针离场 / 持焦 Esc / 滚动捕获（覆盖脱树）')

  // ---- 场景 10：解析失败不出提示 + 失败缓存（同目标零新请求） ----
  // 失败目标取未缓存的本文件锚点（#页内锚）——已成功缓存的目标会直接出
  const normalLink = page.locator('.cm-content .vsidian-wikilink').nth(2)
  await normalLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const before10 = (await resolves(page)).length
  const lastReq10 = (await resolves(page)).at(-1)
  assert.ok(lastReq10, '失败场景请求在场')
  await page.evaluate((reqId) => window.respondHost(
    { kind: 'hover.target.resolved', reqId, ok: false }), lastReq10.reqId)
  await page.waitForTimeout(120)
  assert.equal((await tip(page)).open, false, '解析失败不出提示')
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  await normalLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await resolves(page)).length, before10, '失败缓存：同目标零新请求')
  assert.equal((await tip(page)).open, false, '失败缓存不出提示')
  passed++
  console.log('[目标提示][PASS] 解析失败不出提示 + 失败缓存零重复请求')

  // ---- 场景 11：成功缓存（同目标不重复请求）+ 锚点两形态 ----
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  await normalLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  // 清失败缓存：换目标——用普通链接（linkHref 形态）
  const mdLink = page.locator('.cm-content .vsidian-link').first()
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  await mdLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs11 = await resolves(page)
  assert.equal(reqs11.at(-1).linkHref, '目标笔记.md', '普通链接 linkHref 形态')
  await respondOk(page, '目标笔记.md', '#^块id')
  const t11 = await tip(page)
  assert.equal(t11.text, '目标笔记.md#^块id', '块锚点源码形态附加（#^前缀）')
  // 同目标再悬停：零新请求、直接出
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  const countBefore = (await resolves(page)).length
  await mdLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await resolves(page)).length, countBefore, '成功缓存：同目标零新请求')
  const t11b = await tip(page)
  assert.equal(t11b.open, true, '缓存命中直接显示')
  assert.equal(t11b.text, '目标笔记.md#^块id', '缓存内容一致（含锚点）')
  passed++
  console.log('[目标提示][PASS] 成功缓存零重复请求 + linkHref 形态 + #^块锚点形态')

  // ---- 场景 12（矩阵行 7）：提示开关关 → 不出、零请求 ----
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  await page.evaluate(() => window.applyTipSettings({ 'hover.targetTip': false }))
  const count12 = (await resolves(page)).length
  await normalLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await resolves(page)).length, count12, '提示开关关零解析请求')
  assert.equal((await tip(page)).open, false, '提示开关关不出提示')
  // 开关重开恢复（目标换未缓存的 #页内锚——失败缓存目标不再发请求）
  await page.mouse.move(8, 8, { steps: 3 })
  await page.waitForTimeout(120)
  await page.evaluate(() => window.applyTipSettings({ 'hover.targetTip': true }))
  const anchorLink = page.locator('.cm-content .vsidian-wikilink').nth(3)
  await anchorLink.hover()
  await page.waitForTimeout(OPEN_WAIT)
  assert.equal((await resolves(page)).length, count12 + 1, '重开后恢复解析请求')
  await respondOk(page, 'parent.md', '#页内锚')
  const t13 = await tip(page)
  assert.equal(t13.text, 'parent.md#页内锚', '本文件锚点同样带完整路径（规则不特判）')
  assert.equal(await editRequests(page), 0, '全程零 edit.request（零写回）')
  assert.deepEqual(errors, [], '页面无未捕获异常')
  await page.close()
  passed++
  console.log('[目标提示][PASS] 矩阵行7：开关关不出 + 重开恢复（本文件锚点完整路径）+ 零写回')

  console.log(`[目标提示] 全部 ${passed} 组场景通过`)
} finally {
  await browser.close()
}
