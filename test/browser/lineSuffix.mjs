// #534 普通链接尾部行号的浏览器回归：真实指针驱动生产控制器——带行号
// 普通链接（note.md:103 / code.ts:2）的悬停上报保真（linkHref 原文——
// 行号剥离归宿主解析层，webview 不解析）、浮窗错误分态就地可见呈现
//（anchor-conflict 混合定位与 anchor-invalid 越界——文案与语言包同源，
// 用户实际看到的字），md 行号预览首开定位（range 行首 → scrollTop）与
// 点击上报（link.activate href 原文）。定位落行与原生 reveal 的宿主侧
// 管线由集成用例覆盖（view.locate 消费端由 anchorFlash 钉住）。
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
  '# 行号链接父文档',
  '',
  '普通链接 [跳行](note.md:20) 与 [混合](note.md:3#sec)。',
  '',
  '文本目标 [代码](code.ts:2)；越界 [远处](note.md:999)。',
  '',
  '结尾正文。',
  '',
].join('\n')

/** 目标全文：行 20 在文档中后部（行首 range 定位须产生滚动量）；空行
 *  分段（每行独立段落块——浮窗滚动定位按块生效，单换行会被 markdown-it
 *  并成一个大段落导致无块可滚） */
const TARGET_DOC = [
  ...Array.from({ length: 19 }, (_, i) => `第 ${i + 1} 行内容。`),
  '第二十行锚定正文。',
  ...Array.from({ length: 14 }, (_, i) => `尾部段落 ${i + 1}，撑出足够的滚动高度。`),
].join('\n\n')
/** 行 20 行首偏移（LF 系：前 19 段 + 各自的段间空行，共 2 换行/段） */
const LINE_OFFSET = (() => {
  let acc = 0
  for (let i = 0; i < 19; i++) {
    acc += `第 ${i + 1} 行内容。`.length + 2
  }
  return acc
})()

const OPEN_WAIT = 700
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
  await page.locator('a').filter({ hasText: '跳行' }).first().waitFor()

  const lastRequest = async () =>
    (await page.evaluate(() => window.hoverSent().filter((m) => m.kind === 'hover.request'))).at(-1)
  const hoverLink = async (label) => {
    const link = page.locator('a').filter({ hasText: label }).first()
    await link.scrollIntoViewIfNeeded()
    await link.hover()
    await page.waitForTimeout(OPEN_WAIT)
    return lastRequest()
  }
  const linkSentCount = async () =>
    (await page.evaluate(() => window.hoverSent().filter((m) => m.kind === 'link.activate'))).length

  // ---- 1. 行号链接悬停：linkHref 原文保真（解析归宿主，webview 零解析） ----
  const jumpReq = await hoverLink('跳行')
  assert.equal(jumpReq?.linkHref, 'note.md:20', `带行号链接 linkHref 应为原文（实际 ${jumpReq?.linkHref}）`)
  assert.equal(jumpReq?.target, 'note.md:20', '错误文案共用 target 同为原文')

  // ---- 2. md 行号预览：全文载荷 + 行首 range → 首开滚动定位到目标行 ----
  await page.evaluate(({ reqId, instanceId, text, range }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\note.md', relPath: 'note.md' },
    version: 5, text, range, scope: { kind: 'full' },
  }), { reqId: jumpReq.reqId, instanceId: jumpReq.instanceId, text: TARGET_DOC,
    range: { start: LINE_OFFSET, end: TARGET_DOC.length } })
  await page.waitForTimeout(200)
  let popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open && popup.text.includes('第二十行锚定正文'), '行号预览浮窗在场且全文可达')
  const jumpViewport = await page.evaluate(() => window.hoverViewportSnapshot())
  assert.ok(jumpViewport.scrollTop > 0, `md 行号预览应定位到第 20 行（scrollTop=${jumpViewport.scrollTop}）`)
  assert.ok(popup.text.includes('第 1 行内容'), '锚点前内容同样在场（全文可达）')
  await page.keyboard.press('Escape')
  passed++
  console.log('[行号链接][PASS] md 行号预览：全文 + 行首 range 首开定位')

  // ---- 3. 混合定位：anchor-conflict 分态文案就地可见（与语言包同源） ----
  const mixedReq = await hoverLink('混合')
  assert.equal(mixedReq?.linkHref, 'note.md:3#sec', '混合定位 linkHref 原文')
  await page.evaluate(({ reqId, instanceId }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: false,
    reason: 'anchor-conflict', anchor: 'sec',
  }), { reqId: mixedReq.reqId, instanceId: mixedReq.instanceId })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open, '混合定位错误态浮层保持在场（就地呈现）')
  assert.equal(popup.stateVisible, true, '错误文案在状态行在场绘制')
  const expectedConflict = zhCn['hover.errorAnchorConflict']
    .replaceAll('{target}', 'note.md:3#sec').replaceAll('{anchor}', 'sec')
  assert.equal(popup.stateText, expectedConflict,
    `混合定位文案与语言包同源（期望「${expectedConflict}」，实际「${popup.stateText}」）`)
  await page.keyboard.press('Escape')
  passed++
  console.log('[行号链接][PASS] 混合定位 anchor-conflict 错误文案就地可见')

  // ---- 4. md 行号越界：anchor-invalid(out-of-bounds) 分态文案可见 ----
  const farReq = await hoverLink('远处')
  assert.equal(farReq?.linkHref, 'note.md:999', '越界行号 linkHref 原文')
  await page.evaluate(({ reqId, instanceId }) => window.respondHoverResult({
    kind: 'hover.result', reqId, instanceId, ok: false,
    reason: 'anchor-invalid', anchor: ':999', anchorDetail: 'out-of-bounds',
  }), { reqId: farReq.reqId, instanceId: farReq.instanceId })
  await page.waitForTimeout(120)
  popup = await page.evaluate(() => window.readHoverPopup())
  assert.ok(popup.open && popup.stateVisible, '越界错误态浮层与文案在场')
  const expectedBounds = zhCn['hover.errorTextAnchorBounds']
    .replaceAll('{target}', 'note.md:999').replaceAll('{anchor}', ':999')
  assert.equal(popup.stateText, expectedBounds,
    `越界文案与语言包同源（期望「${expectedBounds}」，实际「${popup.stateText}」）`)
  await page.keyboard.press('Escape')
  passed++
  console.log('[行号链接][PASS] 行号越界 out-of-bounds 错误文案就地可见')

  // ---- 5. 文本目标行号悬停：linkHref 原文（text 通道定位由 textHover 钉住） ----
  const codeReq = await hoverLink('代码')
  assert.equal(codeReq?.linkHref, 'code.ts:2', '文本行号链接 linkHref 原文')
  await page.keyboard.press('Escape')
  passed++
  console.log('[行号链接][PASS] 文本目标行号悬停上报保真')

  // ---- 6. 点击：link.activate 携带 href 原文（行号解析全归宿主） ----
  const before = await linkSentCount()
  const jumpLink = page.locator('a').filter({ hasText: '跳行' }).first()
  await jumpLink.scrollIntoViewIfNeeded()
  await jumpLink.click()
  await page.waitForTimeout(150)
  const activations = await page.evaluate(() =>
    window.hoverSent().filter((m) => m.kind === 'link.activate'))
  assert.equal(activations.length, before + 1, '点击应发出一次 link.activate')
  assert.equal(activations.at(-1).href, 'note.md:20', `点击上报 href 原文（实际 ${activations.at(-1).href}）`)
  passed++
  console.log('[行号链接][PASS] 点击上报：href 原文不经 webview 解析')

  assert.deepEqual(errors, [], `页面不应有 JS 错误：${JSON.stringify(errors)}`)
  console.log(`[行号链接] 全部通过（${passed} 项）`)
} finally {
  await browser.close()
}
