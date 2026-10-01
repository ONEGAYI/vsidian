// #244 production controller + Chromium layout: nested read-only cards, paint and scroll chaining.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'recursiveEmbed/recursiveEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate(() => window.initEmbedDoc('![[B]]\n'))

  const requests = () => page.evaluate(() => window.embedSent().filter((m) => m.kind === 'hover.request'))
  const respond = async (index, name, text, depth) => {
    const req = (await requests())[index]
    assert.ok(req, `第 ${index + 1} 层读取请求存在`)
    await page.evaluate(({ req, name, text, depth }) => window.respondEmbed({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `D:\\notes\\${name}.md`, relPath: `${name}.md` },
      version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
      depth, expansionPath: ['A', ...['B', 'C', 'D'].slice(0, depth)],
      sourceLeaseId: `lease-${name}`,
    }), { req, name, text, depth })
    await page.waitForTimeout(80)
  }
  const b = ['# B', '', '![[C]]', '', ...Array.from({ length: 22 }, (_, i) => `B 段落 ${i}: 外层滚动内容。`)].join('\n\n')
  const c = ['# C', '', '![[D]]', '', ...Array.from({ length: 22 }, (_, i) => `C 段落 ${i}: 内层滚动内容。`)].join('\n\n')
  await respond(0, 'B', b, 1)
  assert.deepEqual((await requests())[1].source,
    { parentInstanceId: (await requests())[0].occurrenceId, sourceDocUri: 'D:\\notes\\B.md' })
  await respond(1, 'C', c, 2)
  assert.equal((await requests())[2].source.sourceDocUri, 'D:\\notes\\C.md')
  await respond(2, 'D', '# D\n\n![[E]]', 3)
  assert.equal((await requests()).length, 3, '第四层只显示深度占位，不发读取')
  const cards = await page.evaluate(() => window.readEmbedCards())
  assert.equal(cards.length, 4, 'B/C/D 与 E 占位都在 DOM')
  assert.ok(cards[3].stateVisible && cards[3].stateText.includes(zhCn['hover.errorDepth']))
  assert.ok(cards.slice(0, 3).every((card) => !card.stateVisible), '已读取三层呈正文')
  assert.ok(cards.slice(0, 3).every((card) => parseFloat(card.barWidth) >= 3 &&
    card.barColor !== 'rgba(0, 0, 0, 0)'), '逐层引用边条真实绘制')
  assert.ok(cards[0].scrollable && cards[1].scrollable, 'B/C 长内容分别独立滚动')
  assert.equal(cards[2].scrollable, false, 'D 短内容自然高度')

  const scrolls = page.locator('.vsidian-embed-card-scroll:visible')
  const inner = scrolls.nth(1)
  await inner.scrollIntoViewIfNeeded()
  const box = await inner.boundingBox()
  assert.ok(box, 'C 内层滚动区可见')
  await page.mouse.move(box.x + 18, box.y + 18)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(100)
  const firstWheel = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.vsidian-embed-card-scroll')].filter((el) => el.clientHeight > 0)
    return { outer: els[0].scrollTop, inner: els[1].scrollTop,
      outerMax: els[0].scrollHeight - els[0].clientHeight,
      main: [...document.querySelectorAll('.vsidian-view-reading')][0]?.parentElement?.scrollTop }
  })
  assert.ok(firstWheel.inner > 0, `滚轮先由 C 消费：${JSON.stringify(firstWheel)}`)
  await inner.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(160)
  await inner.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(80)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(100)
  const boundary = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.vsidian-embed-card-scroll')].filter((el) => el.clientHeight > 0)
    return { outer: els[0].scrollTop, inner: els[1].scrollTop }
  })
  assert.ok(boundary.outer > firstWheel.outer, `C 到底后接续 B：${JSON.stringify({ firstWheel, boundary })}`)
  const active = await page.evaluate(() => ({ budget: window.embedBudgetStats(),
    cache: window.refCacheStats(), lifecycle: window.refLifecycleStats(),
    visibleCards: window.readEmbedCards().length }))
  await page.evaluate(() => window.respondEmbed({ kind: 'settings.changed', values: { 'embed.maxDepth': 1 } }))
  await page.waitForTimeout(80)
  const reduced = await page.evaluate(() => ({ budget: window.embedBudgetStats(),
    cache: window.refCacheStats(), lifecycle: window.refLifecycleStats(),
    visibleCards: window.readEmbedCards().length }))
  assert.equal(reduced.budget.panelInstances, 1, '深度收为 1 后只保留 B 的预算')
  assert.ok(reduced.budget.panelBytes < active.budget.panelBytes, 'C/D 全文与 HTML 驻留计费释放')
  await page.evaluate(() => window.disposeEmbedController())
  const disposed = await page.evaluate(() => ({ budget: window.embedBudgetStats(),
    cache: window.refCacheStats(), lifecycle: window.refLifecycleStats() }))
  assert.equal(disposed.budget.panelInstances, 0, '面板关闭实例预算归零')
  assert.equal(disposed.budget.panelBytes, 0, '面板关闭活跃正文预算归零')
  assert.equal(disposed.lifecycle.activeBlocks, 0, '面板关闭块挂载归零')
  const livePage = await browser.newPage({ viewport: { width: 900, height: 640 } })
  livePage.on('pageerror', (error) => errors.push(error.message))
  await livePage.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await livePage.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await livePage.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await livePage.addScriptTag({ path: bundle })
  await livePage.evaluate(() => {
    window.initEmbedDoc('![[B]]\n')
    window.respondEmbed({ kind: 'view.mode.set', mode: 'live' })
  })
  const liveRespond = async (target, text, depth) => {
    const req = await livePage.evaluate((name) => window.embedSent()
      .filter((m) => m.kind === 'hover.request' && m.target === name).at(-1), target)
    assert.ok(req, `${target} 的 Live 递归读取存在`)
    await livePage.evaluate(({ req, target, text, depth }) => window.respondEmbed({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `D:/notes/${target}.md`, relPath: `${target}.md` },
      version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
      depth, sourceLeaseId: `live-${target}`,
    }), { req, target, text, depth })
    await livePage.waitForTimeout(80)
  }
  await liveRespond('B', '![[C]]', 1)
  await liveRespond('C', '# Child C', 2)
  const childHeading = livePage.locator('.vsidian-live-embed .vsidian-reading-heading-1')
    .filter({ hasText: 'Child C' }).first()
  assert.equal(await childHeading.isVisible(), true, 'Live 子卡标题真实可见且可命中')
  await childHeading.click({ button: 'right' })
  assert.equal(await livePage.locator('.vsidian-context-menu:visible').count(), 0,
    '子卡原生右键不打开父 Live 的写操作菜单')
  assert.equal(await livePage.evaluate(() => window.embedSent()
    .filter((m) => m.kind === 'edit.request').length), 0, '子卡右键不写回 A')
  await livePage.close()
  const hugePage = await browser.newPage({ viewport: { width: 900, height: 640 } })
  await hugePage.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await hugePage.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await hugePage.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await hugePage.addScriptTag({ path: bundle })
  await hugePage.evaluate(() => window.initEmbedDoc('![[Huge]]\n'))
  const hugeReq = await hugePage.evaluate(() => window.embedSent().find((m) => m.kind === 'hover.request'))
  const hugeText = 'x'.repeat(600 * 1024)
  const hugeStarted = performance.now()
  await hugePage.evaluate(({ req, text }) => window.respondEmbed({
    kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\Huge.md', relPath: 'Huge.md' },
    version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
    depth: 1, sourceLeaseId: 'huge-lease',
  }), { req: hugeReq, text: hugeText })
  const huge = await hugePage.evaluate(() => ({ card: window.readEmbedCards()[0],
    budget: window.embedBudgetStats(), cache: window.refCacheStats(),
    sent: window.embedSent().filter((m) => m.kind === 'hover.watch' || m.kind === 'hover.source.release') }))
  assert.ok(huge.card.stateText.includes(zhCn['hover.errorBudget']), '超大 HTML 在挂载前显示预算占位')
  assert.equal(huge.budget.panelBytes, 0, '超大目标不形成活跃解析驻留')
  assert.equal(huge.budget.panelInstances, 0, '超大目标释放预留实例槽')
  assert.equal(huge.sent.filter((m) => m.kind === 'hover.watch').length, 0, '超大目标不订阅')
  assert.ok(huge.cache.oversizeSkips >= 1, '超大目标不进入解析缓存')
  await hugePage.close()
  await writeFile(artifactPath(root, 'recursiveEmbed/measurements.json'), JSON.stringify({
    sample: { source: 'A→B→C→D→E', bChars: b.length, cChars: c.length,
      dChars: '# D\n\n![[E]]'.length, budgetUnit: 'estimated UTF-16 bytes plus 128 bytes per block' },
    active, reduced, disposed,
    oversize: { inputChars: hugeText.length, elapsedMs: Math.round(performance.now() - hugeStarted),
      budget: huge.budget, cache: huge.cache, watchCount: 0, state: 'budget' },
  }, null, 2))
  assert.equal(await page.evaluate(() => window.embedSent().filter((m) => m.kind === 'edit.request').length),
    0, '递归内容与滚轮全程零写回')
  assert.deepEqual(errors, [], '无浏览器运行时错误')
  console.log('[递归嵌入][PASS] A→B→C→D、深度占位、逐层绘制、内层优先滚轮与边界接续、零写回')
} finally {
  await browser.close()
}
