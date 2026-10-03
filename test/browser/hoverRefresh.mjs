// 引用视图同步的原生浏览器回归（#224）：真实布局（Chromium）下经生产控制
// 器装配验证——目标失效推送（changed/deleted）驱动嵌入卡片与悬停浮层
// 刷新（未保存修改可见）、刷新保持 fm 展开与滚动位置（绘制层断言）、
// 快速连续更新无旧内容冒充（新请求代次 + 旧回包丢弃）、删除撤下内容
// 显示缺失态与恢复重载、订阅生命周期（watch/unwatch 出站序列）与零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'hoverRefresh/hoverRefresh.js')
await build({ entryPoints: [path.join(root, 'test/browser/hoverRefreshFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const B_PATH = 'D:\\notes\\目标笔记.md'

/** 父文档：全文嵌入 + 章节嵌入（快速连续更新场景用双目标） */
const PARENT_DOC = [
  '# 同步父文档',
  '',
  '悬停链接：[[目标笔记]] 在正文中。',
  '',
  '![[目标笔记]]',
  '',
  '![[目标笔记#章节一]]',
  '',
].join('\n')

/** 目标全文（fm + 撑出卡片滚动的多段 + 章节锚点） */
const targetDoc = (/** @type {string} */ headline) => [
  '---',
  'title: 目标笔记',
  '---',
  '',
  `# ${headline}`,
  '',
  ...Array.from({ length: 40 }, (_, i) => `目标第 ${i + 1} 段：撑出卡片内部滚动，验证刷新后滚动位置保持。`),
  '',
  '## 章节一',
  '',
  '章节一段落。',
  '',
].join('\n')

const TARGET_V1 = targetDoc('目标旧标题')
const TARGET_V2 = targetDoc('目标新标题')

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
  await page.evaluate((text) => window.initRefreshDoc(text), PARENT_DOC)
  await page.locator('.vsidian-view-reading .vsidian-embed-card').first().waitFor({ timeout: 5000 })

  const sent = () => page.evaluate(() => window.refreshSent())
  const hoverRequests = () => page.evaluate(() =>
    window.refreshSent().filter((m) => m.kind === 'hover.request'))
  const watchMessages = () => page.evaluate(() =>
    window.refreshSent().filter((m) => m.kind === 'hover.watch' || m.kind === 'hover.unwatch'))
  /** 对指定序号的在途请求回成功包（缺省最新一笔；version 递增模拟未保存修改） */
  const respondLatest = async (text, version, at = -1) => {
    const reqs = await hoverRequests()
    const req = at === -1 ? reqs.at(-1) : reqs[at]
    assert.ok(req, '应有在途装载请求')
    await page.evaluate(({ reqId, instanceId, t, v }) => window.respondRefresh({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
      version: v, text: t,
      range: { start: 0, end: t.length },
      scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, t: text, v: version })
    await page.waitForTimeout(120)
  }
  /** 对浮层（hover- 实例）的在途请求回成功包（changed 后浮层与嵌入都重发，
   *  嵌入请求排在后面——浮层须按实例前缀定向） */
  const respondPopup = async (text, version) => {
    const reqs = await hoverRequests()
    const req = [...reqs].reverse().find((m) => m.instanceId.startsWith('hover-'))
    assert.ok(req, '应有浮层在途请求')
    await page.evaluate(({ reqId, instanceId, t, v }) => window.respondRefresh({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\notes\目标笔记.md', relPath: '目标笔记.md' },
      version: v, text: t,
      range: { start: 0, end: t.length },
      scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, t: text, v: version })
    await page.waitForTimeout(120)
  }
  /** 对最近 n 笔在途请求逐一回应（changed 推送后同目标全部实例各重发一笔） */
  const respondAll = async (text, version, n) => {
    for (let i = n; i >= 1; i--) {
      const reqs = await hoverRequests()
      await respondLatest(text, version, reqs.length - i)
    }
  }
  /** 注入失效推送（宿主协调器 → webview 的真实消息形态） */
  const pushInvalidation = async (status, generation) => {
    await page.evaluate(([s, g]) => window.respondRefresh({
      kind: 'hover.invalidated', fsPath: 'D:\\notes\\目标笔记.md', status: s, generation: g,
    }), [status, generation])
    await page.waitForTimeout(60)
  }

  // ---- 场景 A：装载成功登记订阅（watch 出站契约）+ 初始内容绘制 ----
  // 两笔初始请求（全文嵌入 + 章节嵌入）逐一回应
  await respondLatest(TARGET_V1, 3, 0)
  await respondLatest(TARGET_V1, 3, 1)
  const watches = await watchMessages()
  // 订阅是实例级出站（每 entry 一笔、实例身份 = 语义键）；相同目标的合并
  // 订阅在宿主侧协调器（目标级推送，单测钉住）——此处断言出站契约
  assert.equal(watches.length, 2, '两嵌入各发一笔实例订阅（目标相同）')
  assert.ok(watches.every((m) => m.kind === 'hover.watch' && m.fsPath === B_PATH))
  assert.notEqual(watches[0].instanceId, watches[1].instanceId, '实例身份互异（entry 语义键）')
  assert.match(watches[0].instanceId, /^\d+::/, '嵌入实例身份为 entry 语义键')
  let cards = await page.evaluate(() => window.readRefreshCards())
  assert.equal(cards.length, 2)
  assert.ok(cards[0].hitInside, '卡片绘制层命中（真实接收指针）')
  assert.ok(cards[0].text.includes('目标旧标题'), '初始内容在场')
  assert.ok((await page.evaluate(() => window.refreshSent().filter((m) => m.kind === 'edit.request').length)) === 0,
    '全程零写回（edit.request 不发）')
  passed++
  console.log('[视图同步][PASS] 装载登记订阅（目标级合并）+ 初始内容绘制')

  // ---- 场景 B：目标未保存修改（changed 推送）→ 嵌入静默重载、新内容可见、
  //      fm 展开与滚动保持（绘制层断言）----
  const clicked = await page.evaluate(() => window.clickRefreshCardFm(0))
  assert.ok(clicked, 'fm 切换按钮应在场（全文引用）')
  await page.evaluate(() => window.readRefreshCards()) // 等一拍让类名生效
  const scrolled = await page.evaluate(() => window.scrollRefreshCard(0, 120))
  assert.ok(scrolled > 0, `卡片内容应可滚动（实际 scrollTop=${scrolled}）`)
  await pushInvalidation('changed', 1)
  // 刷新在途：内容保持（不闪 loading）
  cards = await page.evaluate(() => window.readRefreshCards())
  assert.ok(cards[0].contentVisible, '静默重载：内容区保持可见（不闪 loading）')
  assert.ok(cards[0].text.includes('目标旧标题'), '刷新在途保留旧内容（无空窗）')
  await respondAll(TARGET_V2, 4, 2)
  cards = await page.evaluate(() => window.readRefreshCards())
  assert.ok(cards[0].text.includes('目标新标题'), '未保存修改后新内容可见')
  assert.ok(cards[1].text.includes('章节一段落'), '同目标第二卡片同步刷新')
  assert.equal(cards[0].fmCollapsed, false, 'fm 展开保持（刷新不重置）')
  assert.ok(cards[0].scrollTop >= 100, `滚动位置保持（实际 ${cards[0].scrollTop}）`)
  passed++
  console.log('[视图同步][PASS] changed 推送：嵌入静默重载 + 新内容 + fm/滚动保持')

  // ---- 场景 C：快速连续更新无旧内容冒充（旧回包注入丢弃）----
  const reqCountBefore = (await hoverRequests()).length
  await pushInvalidation('changed', 2)
  await pushInvalidation('changed', 3)
  const reqs = await hoverRequests()
  assert.equal(reqs.length, reqCountBefore + 4,
    '两次推送 × 两嵌入各发一笔新请求（请求代次推进）')
  // 旧请求的慢回包（版本旧）：丢弃
  const staleReq = reqs[reqCountBefore]
  const staleText = targetDoc('慢响应旧内容')
  await page.evaluate(({ reqId, instanceId, t }) => window.respondRefresh({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 2, text: t,
    range: { start: 0, end: 100 }, scope: { kind: 'full' },
  }), { reqId: staleReq.reqId, instanceId: staleReq.instanceId, t: staleText })
  await page.waitForTimeout(120)
  cards = await page.evaluate(() => window.readRefreshCards())
  assert.ok(!cards[0].text.includes('慢响应旧内容'), '慢响应旧内容不得冒充')
  await respondAll(targetDoc('连续更新终态'), 6, 2)
  cards = await page.evaluate(() => window.readRefreshCards())
  assert.ok(cards[0].text.includes('连续更新终态'), '终态内容可见')
  passed++
  console.log('[视图同步][PASS] 快速连续更新：新请求代次 + 旧回包丢弃 + 终态可见')

  // ---- 场景 D：删除分态（撤下内容显示缺失态）与恢复重载 ----
  await pushInvalidation('deleted', 4)
  cards = await page.evaluate(() => window.readRefreshCards())
  assert.ok(cards[0].stateVisible, '缺失态状态行可见')
  assert.equal(cards[0].stateText, zhCn['hover.errorNotFound'].replaceAll('{target}', '目标笔记'),
    `确认删除显示缺失态文案（实际 ${cards[0].stateText}）`)
  assert.ok(!cards[0].contentVisible, '内容区撤下（不无限保留旧内容）')
  assert.ok(!cards[0].text.includes('连续更新终态'), '旧内容文本不残留')
  // 恢复：changed → 重载
  await pushInvalidation('changed', 5)
  await respondAll(targetDoc('恢复后内容'), 7, 2)
  cards = await page.evaluate(() => window.readRefreshCards())
  assert.ok(cards[0].text.includes('恢复后内容'), '恢复后重载可见')
  assert.equal(cards[0].fmCollapsed, false, '恢复重载后 fm 展开仍保持（实例状态）')
  passed++
  console.log('[视图同步][PASS] 删除分态撤内容 + 恢复重载 + 实例状态保持')

  // ---- 场景 E：悬停浮层订阅刷新（changed 后浮层重载、fm 保持、关闭 unwatch）----
  // 悬停正文双链（真实指针；Ctrl+悬停默认仅 Live 侧——Reading 直接悬停）
  const linkPoint = await page.evaluate(() => {
    const container = Array.from(document.querySelectorAll('.vsidian-view-reading'))
      .find((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
    if (!container) {
      throw new Error('主 Reading 容器未找到')
    }
    const links = Array.from(container.querySelectorAll('a.vsidian-wikilink'))
    const a = links.find((el) => (el.textContent ?? '').includes('目标笔记'))
    if (!a) {
      throw new Error('正文双链未找到')
    }
    const r = a.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  const reqCountBeforeHover = (await hoverRequests()).length
  await page.mouse.move(linkPoint.x, linkPoint.y, { steps: 3 })
  await page.waitForTimeout(450) // 开延迟 300ms + 余量
  const popupReqs = (await hoverRequests()).filter((m) => m.instanceId.startsWith('hover-'))
  assert.ok(popupReqs.length > 0, `悬停应发出浮层装载请求（实际新增 ${popupReqs.length}）`)
  const beforeLoad = await page.evaluate(() => window.readRefreshPopup())
  assert.ok(beforeLoad.open, '回包前浮层应在场（开延迟后未关）')
  await respondPopup(targetDoc('浮层内容'), 8)
  let popup = await page.evaluate(() => window.readRefreshPopup())
  assert.ok(popup.open && popup.hitInside, '浮层在场且绘制层命中')
  assert.ok(popup.text.includes('浮层内容'), '浮层内容可见')
  // 浮层的 watch（与嵌入同目标合并——目标级 +1 实例）
  const watchesBefore = (await watchMessages()).filter((m) => m.kind === 'hover.watch').length
  assert.ok(watchesBefore >= 2, '浮层装载后新增实例订阅')
  // 浮层内滚动 + changed 刷新
  await page.evaluate(() => window.scrollRefreshPopup(90))
  await pushInvalidation('changed', 6)
  await respondPopup(targetDoc('浮层刷新内容'), 9)
  popup = await page.evaluate(() => window.readRefreshPopup())
  assert.ok(popup.text.includes('浮层刷新内容'), '浮层刷新后新内容可见（未保存修改跟随）')
  assert.ok(popup.scrollTop >= 70, `浮层滚动保持（实际 ${popup.scrollTop}）`)
  // 关闭浮层（指针移出联合域 + 关延迟）：unwatch 配对
  await page.mouse.move(8, 8, { steps: 4 })
  await page.waitForTimeout(600) // 关延迟 350ms + 余量
  popup = await page.evaluate(() => window.readRefreshPopup())
  assert.equal(popup.open, false, '浮层已关闭')
  const unwatchMessages = (await watchMessages()).filter((m) => m.kind === 'hover.unwatch')
  // P2-06（#283）起浮窗 watch 身份 = 引用位置语义键（hover@…，bind 来源
  // 固定同源）；与嵌入订阅（start::inner 形态）仍可区分
  assert.ok(unwatchMessages.some((m) => m.instanceId.startsWith('hover@')),
    `浮层关闭应配对 unwatch（实际 ${JSON.stringify(unwatchMessages)}）`)
  // 嵌入订阅仍在（仍有效实例）
  const finalWatches = (await watchMessages()).filter((m) => m.kind === 'hover.watch').length
  const finalUnwatches = unwatchMessages.filter((m) => m.instanceId.startsWith('hover@')).length
  assert.ok(finalWatches - finalUnwatches >= 1, '嵌入订阅不随浮层关闭退场（仍有效实例）')
  passed++
  console.log('[视图同步][PASS] 浮层订阅刷新 + 滚动保持 + 关闭配对 unwatch')

  assert.deepEqual(errors, [], '页面零未捕获异常')
} finally {
  await browser.close()
}
console.log(`[视图同步] 全部 ${passed} 场景通过`)
