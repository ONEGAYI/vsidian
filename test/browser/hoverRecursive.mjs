// #245 生产控制器 + 原生 Chromium 指针：悬停内递归卡片绘制与滚轮边界。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'hoverRecursive/hoverRecursive.js')
await build({ entryPoints: [path.join(root, 'test/browser/hoverPreviewFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)
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
  await page.evaluate(() => window.initHoverDoc('# A\n\n[[B]]\n'))
  await page.locator('a.vsidian-wikilink').first().hover()
  await page.waitForTimeout(450)
  const request = async (target) => page.evaluate((name) => window.hoverSent()
    .filter((m) => m.kind === 'hover.request' && m.target === name).at(-1), target)
  const respond = async (target, text, depth) => {
    const req = await request(target)
    assert.ok(req, `${target} 读取请求存在`)
    await page.evaluate(({ req, target, text, depth }) => window.respondHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `D:/notes/${target}.md`, relPath: `${target}.md` },
      version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
      depth, sourceLeaseId: `lease-${target}`,
    }), { req, target, text, depth })
    await page.waitForTimeout(100)
  }
  const b = ['# B', '', '![[C]]', '', ...Array.from({ length: 24 }, (_, i) => `B 段落 ${i}：悬停外层内容。`)].join('\n')
  const c = ['# C', '', '[[Leaf]] 与 [普通链接](leaf.md)。', '', '![](./c.png)', '',
    ...Array.from({ length: 48 }, (_, i) => `C 段落 ${i}：子卡独立滚动内容。`)].join('\n')
  await respond('B', b, 1)
  const bReq = await request('B')
  const cReq = await request('C')
  assert.deepEqual(cReq.source,
    { parentInstanceId: bReq.occurrenceId, sourceDocUri: 'D:/notes/B.md' })
  await respond('C', c, 2)
  const childImage = await page.evaluate(() => window.hoverSent()
    .filter((m) => m.kind === 'image.request' && m.src === './c.png').at(-1))
  assert.equal(childImage?.sourceDocUri, 'D:/notes/C.md', '子卡图片按直接 C 来源解析')
  const popupCount = await page.locator('.vsidian-hover-popup:visible').count()
  assert.equal(popupCount, 1, '整轮只有一个悬停浮窗')
  const card = page.locator('.vsidian-hover-popup .vsidian-embed-card').first()
  assert.equal(await card.isVisible(), true, 'C 卡片实际可见')
  await card.hover()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.vsidian-hover-popup:visible').count(), 1,
    '鼠标进入子卡片仍属于浮层保活域')
  const paint = await card.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const hit = document.elementFromPoint(box.left + 8, box.top + 8)
    return { width: parseFloat(style.borderLeftWidth), color: style.borderLeftColor,
      hit: hit !== null && el.contains(hit) }
  })
  assert.ok(paint.width >= 3 && paint.color !== 'rgba(0, 0, 0, 0)' && paint.hit,
    `C 引用边条与命中真实绘制：${JSON.stringify(paint)}`)
  const inner = page.locator('.vsidian-hover-popup .vsidian-embed-card-scroll:visible').first()
  await inner.scrollIntoViewIfNeeded()
  const box = await inner.boundingBox()
  assert.ok(box, 'C 滚动区在视口内')
  const before = await page.evaluate(() => ({
    inner: document.querySelector('.vsidian-hover-popup .vsidian-embed-card-scroll')?.scrollTop ?? 0,
    outer: document.querySelector('.vsidian-hover-popup-scroll')?.scrollTop ?? 0,
  }))
  await page.mouse.move(box.x + 18, box.y + 18)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(100)
  const first = await page.evaluate(() => ({
    inner: document.querySelector('.vsidian-hover-popup .vsidian-embed-card-scroll')?.scrollTop ?? 0,
    outer: document.querySelector('.vsidian-hover-popup-scroll')?.scrollTop ?? 0,
  }))
  assert.ok(first.inner > before.inner, `滚轮先由 C 消费：${JSON.stringify({ before, first })}`)
  await inner.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(90)
  const atBoundary = await page.evaluate(() =>
    document.querySelector('.vsidian-hover-popup-scroll')?.scrollTop ?? 0)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(100)
  const outerAfter = await page.evaluate(() =>
    document.querySelector('.vsidian-hover-popup-scroll')?.scrollTop ?? 0)
  assert.ok(outerAfter > atBoundary, `C 到底后接续浮层：${atBoundary}→${outerAfter}`)
  await inner.evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(100)
  await page.locator('.vsidian-hover-popup .vsidian-embed-card a[href="Leaf"]').first().click()
  const childLink = await page.evaluate(() => window.hoverSent()
    .filter((m) => m.kind === 'wikilink.activate' && m.target === 'Leaf').at(-1))
  assert.equal(childLink?.sourceDocUri, 'D:/notes/C.md', '子卡双链按直接 C 来源打开')
  assert.equal(await page.locator('.vsidian-hover-popup:visible').count(), 1,
    '子卡内链不另建第二个浮窗')

  // 小窗口贴底：B 短文先开 C loading，C 长文晚到后翻转/收缩，
  // C 再缩短时仍贴锚点；标题与打开入口始终在真实绘制和命中域内。
  const small = await browser.newPage({ viewport: { width: 520, height: 550 } })
  small.on('pageerror', (error) => errors.push(error.message))
  await small.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await small.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await small.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await small.addScriptTag({ path: bundle })
  const longParent = ['# A', '', ...Array.from({ length: 40 }, (_, i) => `父段落 ${i}`), '', '[[B]]', ''].join('\n')
  await small.evaluate((text) => window.initHoverDoc(text), longParent)
  await small.locator('a.vsidian-wikilink').first().waitFor()
  assert.equal(await small.evaluate(() => window.scrollReadingSoAnchorNearBottom(35)), true)
  const point = await small.evaluate(() => {
    const r = document.querySelector('a.vsidian-wikilink').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await small.mouse.move(point.x, point.y, { steps: 3 })
  await small.waitForTimeout(450)
  const smallResponse = async (target, text, version = 1) => {
    const req = await small.evaluate((name) => window.hoverSent()
      .filter((m) => m.kind === 'hover.request' && m.target === name).at(-1), target)
    assert.ok(req)
    await small.evaluate(({ req, target, text, version }) => window.respondHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `D:/notes/${target}.md`, relPath: `${target}.md` },
      version, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
      depth: target === 'B' ? 1 : 2, sourceLeaseId: `small-${target}-${version}`,
    }), { req, target, text, version })
    await small.waitForTimeout(120)
  }
  await smallResponse('B', '# B\n\n![[C]]\n')
  const snug = async (phase) => {
    const popup = await small.evaluate(() => window.readHoverPopup())
    const anchor = await small.evaluate(() => window.readAnchor())
    const popupBottom = popup.rect.top + popup.rect.height
    const anchorGap = popup.rect.top >= anchor.bottom
      ? popup.rect.top - anchor.bottom : anchor.top - popupBottom
    assert.ok(popup.rect.top >= 8 && popup.rect.top + popup.rect.height <= 542 &&
      popup.rect.left >= 8 && popup.rect.left + popup.rect.width <= 512,
    `${phase} 浮层四边需在视口内：${JSON.stringify({ popup, anchor })}`)
    assert.ok(Math.abs(anchorGap - 6) <= 12,
      `${phase} 短文/晚到内容须贴锚点而非留下大空隙：${anchorGap}px`)
    const chrome = await small.evaluate(() => {
      const el = document.querySelector('.vsidian-hover-popup')
      const title = el?.querySelector('.vsidian-hover-popup-title')
      const open = el?.querySelector('.vsidian-hover-popup-open')
      const box = open?.getBoundingClientRect()
      const hit = box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return { title: title?.textContent, openVisible: !!open && getComputedStyle(open).display !== 'none',
        openHit: !!hit && open.contains(hit) }
    })
    assert.ok(chrome.title === 'B' && chrome.openVisible && chrome.openHit,
      `${phase} 标题及打开入口可见且可命中：${JSON.stringify(chrome)}`)
  }
  await snug('C loading')
  await smallResponse('C', ['# C', '', ...Array.from({ length: 45 }, (_, i) => `长内容 ${i}`)].join('\n'))
  await snug('C 异步增高')
  const grownHeight = (await small.evaluate(() => window.readHoverPopup())).rect.height
  await small.evaluate(() => window.respondHoverResult({ kind: 'hover.invalidated',
    fsPath: 'D:/notes/C.md', status: 'changed', generation: 1 }))
  await smallResponse('C', '# C\n\n短内容。\n', 2)
  await snug('C 异步缩短')
  const shrunkHeight = (await small.evaluate(() => window.readHoverPopup())).rect.height
  // 外壳高与卡内 scrollHeight 都受视口钳制/#243 视口虚拟挂载影响（Linux CI
  // 实测增高→缩短仅差 14px），固定像素阈值跨平台必误报；"收缩"的证据改为
  // 方向断言（不得反向增高）+ 子卡文本实际换新（旧段落零残留），贴锚观感
  // 已由 snug 的 gap 断言钉住。
  assert.ok(shrunkHeight <= grownHeight,
    `C 缩短后浮层高度不得反向增高：${grownHeight}→${shrunkHeight}`)
  const shrunkText = await small.evaluate(() =>
    document.querySelector('.vsidian-hover-popup .vsidian-embed-card')?.textContent ?? '')
  assert.ok(shrunkText.includes('短内容。') && !shrunkText.includes('长内容'),
    `C 缩短后子卡应显示新短文且旧段落零残留：${shrunkText.slice(0, 80)}`)
  await small.close()

  // 键盘模态：焦点进单一浮窗、可进入 C 卡片并复制，Esc 返回原触发处。
  const keyboard = await browser.newPage({ viewport: { width: 900, height: 640 } })
  keyboard.on('pageerror', (error) => errors.push(error.message))
  await keyboard.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await keyboard.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await keyboard.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await keyboard.addScriptTag({ path: bundle })
  await keyboard.evaluate(() => {
    window.initHoverDoc('# A\n\n[[B]]\n')
    window.openHoverKeyboard('B')
  })
  assert.equal(await keyboard.evaluate(() => document.activeElement?.classList.contains('vsidian-hover-popup')),
    true, '键盘预览打开后焦点进入浮窗')
  const keyboardRespond = async (target, text, depth) => {
    const req = await keyboard.evaluate((name) => window.hoverSent()
      .filter((m) => m.kind === 'hover.request' && m.target === name).at(-1), target)
    assert.ok(req)
    await keyboard.evaluate(({ req, target, text, depth }) => window.respondHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `D:/notes/${target}.md`, relPath: `${target}.md` },
      version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
      depth, sourceLeaseId: `keyboard-${target}`,
    }), { req, target, text, depth })
    await keyboard.waitForTimeout(80)
  }
  await keyboardRespond('B', '![[C]]\n', 1)
  await keyboardRespond('C', '# C\n\n可复制正文。\n', 2)
  await keyboard.keyboard.press('Tab')
  await keyboard.keyboard.press('Tab')
  assert.equal(await keyboard.evaluate(() => document.activeElement?.classList.contains('vsidian-embed-card-open')),
    true, 'Tab 可进入 C 子卡打开入口')
  const selected = await keyboard.evaluate(() => {
    const block = [...document.querySelectorAll('.vsidian-hover-popup .vsidian-embed-card .vsidian-reading-block')]
      .find((el) => el.textContent?.includes('可复制正文。'))
    const range = document.createRange()
    range.selectNodeContents(block)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  })
  await keyboard.keyboard.press('Control+C')
  assert.ok(selected.includes('可复制正文。'), 'C 子卡文字可选择并走原生复制键')
  await keyboard.keyboard.press('Escape')
  assert.equal(await keyboard.locator('.vsidian-hover-popup').count(), 0, 'Esc 关闭整棵浮层树')
  assert.equal(await keyboard.evaluate(() => document.activeElement?.id), 'hover-keyboard-trigger',
    'Esc 焦点返回打开前的触发处')
  await keyboard.evaluate(() => window.openHoverKeyboard('B'))
  await keyboard.evaluate(() => window.dispatchEvent(new Event('blur')))
  assert.equal(await keyboard.locator('.vsidian-hover-popup').count(), 0, '窗口失焦释放整树')
  await keyboard.evaluate(() => window.openHoverKeyboard('B'))
  await keyboard.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  assert.equal(await keyboard.locator('.vsidian-hover-popup').count(), 0, '文档隐藏释放整树')
  assert.equal(await keyboard.evaluate(() => window.hoverSent().filter((m) => m.kind === 'edit.request').length),
    0, '键盘选择/复制与关闭全程零写回')
  await keyboard.close()
  // 面板直达目标仍走同一浮窗及来源预算；顶栏跳转保留面板 openAction。
  const panel = await browser.newPage({ viewport: { width: 720, height: 520 } })
  panel.on('pageerror', (error) => errors.push(error.message))
  await panel.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await panel.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await panel.addScriptTag({ path: bundle })
  await panel.evaluate(() => { window.initHoverDoc('# A\n'); window.openHoverPanel() })
  const directB = await panel.evaluate(() => window.hoverSent().find((m) =>
    m.kind === 'hover.request' && m.target === 'B'))
  assert.equal(directB?.directTarget?.fsPath, 'D:/notes/B.md', '面板 B 使用直接目标身份')
  await panel.evaluate((req) => window.respondHoverResult({ kind: 'hover.result',
    reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath: 'D:/notes/B.md', relPath: 'B.md' }, version: 1,
    text: '![[C]]\n', range: { start: 0, end: 7 }, scope: { kind: 'full' },
    depth: 1, sourceLeaseId: 'panel-B',
  }), directB)
  const directC = await panel.evaluate(() => window.hoverSent().find((m) =>
    m.kind === 'hover.request' && m.target === 'C'))
  assert.equal(directC?.source?.sourceDocUri, 'D:/notes/B.md', '面板浮层内 C 仍以 B 为直接来源')
  await panel.locator('.vsidian-hover-popup-open').click()
  assert.equal(await panel.evaluate(() => window.panelOpenCount()), 1, '面板顶栏仍用原 openAction')
  assert.equal(await panel.locator('.vsidian-hover-popup').count(), 0, '面板跳转关闭整树')
  await panel.evaluate(() => window.openHoverPanel())
  await panel.evaluate(() => window.respondHoverResult({ kind: 'view.mode.set', mode: 'live' }))
  assert.equal(await panel.locator('.vsidian-hover-popup').count(), 0, '切 Live 关闭面板浮层树')
  await panel.close()
  const pending = await browser.newPage({ viewport: { width: 720, height: 520 } })
  pending.on('pageerror', (error) => errors.push(error.message))
  await pending.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await pending.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await pending.addScriptTag({ path: bundle })
  await pending.evaluate(() => window.initHoverDoc('[[B]]\n'))
  const link = pending.locator('a.vsidian-wikilink').first()
  await link.hover()
  await pending.evaluate(() => window.dispatchEvent(new Event('blur')))
  await pending.waitForTimeout(400)
  assert.equal(await pending.locator('.vsidian-hover-popup').count(), 0,
    '窗口失焦取消待开计时，不在后台复活浮层')
  await pending.mouse.move(700, 500)
  await link.hover()
  await pending.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await pending.waitForTimeout(400)
  assert.equal(await pending.locator('.vsidian-hover-popup').count(), 0,
    '文档隐藏取消待开计时，不在后台复活浮层')
  await pending.close()
  assert.equal(await page.evaluate(() => window.hoverSent().filter((m) => m.kind === 'edit.request').length),
    0, '递归指针与滚轮零写回')
  assert.deepEqual(errors, [], '无浏览器运行时错误')
  console.log('[悬停递归][PASS] B→C 来源、唯一浮窗、绘制边条、原生滚轮先子后父、零写回')
} finally {
  await browser.close()
}
