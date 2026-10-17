// 交叉场景收口回归（#574/T09）：HTML 批次与既有子系统的四类交叉链路在
// 生产控制器真实驱动下验证——
//  1. 查找面板定位命中块级/行内 HTML 源码范围（真实 Ctrl+F 键入导航 →
//     选区相交显形源码；落点移出恢复渲染）
//  2. 标题折叠区间含 HTML 块（真实键盘折叠 → widget 不绘制；view.locate
//     落点进折叠隐藏区自动展开且 HTML 块恢复渲染）
//  3. 悬停浮层内 HTML 块（真实悬停 + hover.result 注入：表格渲染、行内
//     样式生效、脚本零执行、B 身份 docScope）
//  4. 块级 HTML 源文内的真实 IME 组合定稿（CDP——未提交输入不丢失）
// 全程纯视图链路零写回（IME 编辑链路除外，单独计数）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'htmlCross574/htmlCross574.js')
// 与 findPanel.mjs 同口径：katex css 裁掉 woff/ttf 字体引用
const katexFontStrip = {
  name: 'katex-font-fallback-strip',
  setup(b) {
    b.onLoad({ filter: /katex\.min\.css$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(
        /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\((["']?)(?:woff|truetype)\1\)/g, ''),
      loader: 'css',
    }))
  },
}
await build({ entryPoints: [path.join(root, 'test/browser/htmlCross574Fixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })

const TABLE_BLOCK = [
  '<table>',
  '  <tr>',
  '    <td colspan="2">合并单元格表</td>',
  '    <td>普通格</td>',
  '  </tr>',
  '</table>',
].join('\n')
const FOLD_TABLE_BLOCK = [
  '<table>',
  '  <tr>',
  '    <td>折叠节内表格</td>',
  '  </tr>',
  '</table>',
].join('\n')

const DOC = [
  '# 交叉场景主文档',
  '',
  '导语段，含 [[目标笔记]] 双链。',
  '',
  TABLE_BLOCK,
  '',
  '行内段落：<span style="color:red">红字注音</span> 尾巴。',
  '',
  '## 折叠节',
  '',
  '折叠节导语。',
  '',
  FOLD_TABLE_BLOCK,
  '',
  '折叠节尾段。',
  '',
  '## 折叠节二',
  '',
  '另一节内容。',
].join('\n')

const TABLE_FROM = DOC.indexOf(TABLE_BLOCK)
const TABLE_TO = TABLE_FROM + TABLE_BLOCK.length
const INLINE_FROM = DOC.indexOf('<span style="color:red">红字注音</span>')
const INLINE_TO = INLINE_FROM + '<span style="color:red">红字注音</span>'.length
const FOLD_TABLE_FROM = DOC.indexOf(FOLD_TABLE_BLOCK)
const INTRO_AT = DOC.indexOf('导语段')

/** 悬停目标全文：标题 + 带行内样式的合并单元格 HTML 表 + 脚本载荷（负向） */
const TARGET_DOC = [
  '# 目标笔记标题',
  '',
  '<table><tr><td colspan="2" style="color: rgb(178, 34, 34)">目标表内容</td></tr></table>',
  '',
  '<script>window.__crossHoverEvil = true</script>',
].join('\n')

const OPEN_WAIT = 700 // 开延迟 300ms + 余量（hoverPreview 同款）

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initCrossDoc(text), DOC)
  await page.locator('.vsidian-live-html').first().waitFor({ timeout: 5000 })

  const editCount = () => page.evaluate(() => window.crossEditCount())
  const selection = () => page.evaluate(() => window.crossSelection())
  const htmlHosts = () => page.evaluate(() => window.readCrossHtmls())
  const inlineHosts = () => page.evaluate(() => window.readCrossInlineHtmls())
  const foldKeys = () => page.evaluate(() => window.crossFoldKeys())

  // ---- 场景 1：查找面板定位命中块级 HTML（真实 Ctrl+F 键入 → Enter）----
  await page.evaluate(() => window.crossFocus())
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(120)
  await page.keyboard.type('合并单元格表')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  let sel = await selection()
  assert.equal(sel.length, 1, '查找后单选区')
  const selRange = (s) => ({ from: Math.min(s.anchor, s.head), to: Math.max(s.anchor, s.head) })
  let hit = selRange(sel[0])
  assert.ok(hit.from >= TABLE_FROM && hit.to <= TABLE_TO,
    `查找命中应落在块级 HTML 源码范围内（实际 ${JSON.stringify(sel)}，块 [${TABLE_FROM},${TABLE_TO}]）`)
  assert.equal(await page.evaluate(([f, t]) => window.crossHtmlRevealed(f, t), [TABLE_FROM, TABLE_TO]),
    true, '选区相交 → 块级 HTML 源码显形')
  assert.equal((await htmlHosts()).filter((h) => h.from === TABLE_FROM).length, 0,
    '显形期间该块渲染宿主不绘制（widget 退场）')
  await page.keyboard.press('Escape') // 关面板（选区保持——面板关闭不清选区）
  await page.waitForTimeout(120)
  // 落点移出（locate 通道）→ 恢复渲染
  await page.evaluate((offset) => window.crossLocate(offset), INTRO_AT)
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(([f, t]) => window.crossHtmlRevealed(f, t), [TABLE_FROM, TABLE_TO]),
    false, '选区离开后不再显形')
  const hosts1 = (await htmlHosts()).filter((h) => h.from === TABLE_FROM)
  assert.equal(hosts1.length, 1, '恢复渲染后块级宿主在场')
  assert.equal(hosts1[0].hitInside, true, '恢复渲染绘制层可见（合并格中心命中宿主内）')
  passed++
  console.log('[交叉场景][PASS] 1 查找定位命中块级 HTML：显形 → 移出恢复渲染')

  // ---- 场景 2：查找面板定位命中行内 HTML ----
  await page.evaluate(() => window.crossFocus())
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(120)
  await page.keyboard.type('红字注音')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  sel = await selection()
  hit = selRange(sel[0])
  assert.ok(sel.length === 1 && hit.from >= INLINE_FROM && hit.to <= INLINE_TO,
    `查找命中应落在行内 HTML 源码范围内（实际 ${JSON.stringify(sel)}，区间 [${INLINE_FROM},${INLINE_TO}]）`)
  assert.equal((await inlineHosts()).filter((h) => h.from === INLINE_FROM).length, 0,
    '选区相交 → 行内宿主退场（源码显形）')
  await page.keyboard.press('Escape')
  await page.evaluate((offset) => window.crossLocate(offset), INTRO_AT)
  await page.waitForTimeout(200)
  const inlineBack = (await inlineHosts()).filter((h) => h.from === INLINE_FROM)
  assert.equal(inlineBack.length, 1, '离开后行内宿主恢复')
  assert.equal(inlineBack[0].color, true, '行内渲染恢复（style 颜色属性在场）')
  passed++
  console.log('[交叉场景][PASS] 2 查找定位命中行内 HTML：显形 → 移出恢复渲染')

  // ---- 场景 3：标题折叠区间含 HTML 块（隐藏 → 落点展开恢复） ----
  const editBefore3 = await editCount()
  await page.evaluate((offset) => window.crossLocate(offset), DOC.indexOf('折叠节导语'))
  await page.waitForTimeout(150)
  await page.keyboard.press('Control+Shift+BracketLeft') // 折「折叠节」
  await page.waitForTimeout(200)
  let keys = await foldKeys()
  assert.equal(keys.length, 1, `折叠一键集（实际 ${JSON.stringify(keys)}）`)
  assert.equal((await htmlHosts()).filter((h) => h.from === FOLD_TABLE_FROM).length, 0,
    '折叠区间内 HTML 块 widget 不绘制')
  // view.locate 落点进折叠隐藏区（HTML 块之外的段落——落点不触块本身，
  // 展开后恢复的是渲染形态而非源码显形）→ 自动展开 + HTML 块恢复渲染
  await page.evaluate((offset) => window.crossLocate(offset), DOC.indexOf('折叠节尾段'))
  await page.waitForTimeout(250)
  keys = await foldKeys()
  assert.equal(keys.length, 0, `落点进折叠区应自动展开（实际 ${JSON.stringify(keys)}）`)
  const foldHosts = (await htmlHosts()).filter((h) => h.from === FOLD_TABLE_FROM)
  assert.equal(foldHosts.length, 1, '展开后折叠节内 HTML 块恢复渲染')
  assert.equal(foldHosts[0].hitInside, true, '恢复渲染绘制层可见')
  assert.equal(foldHosts[0].tablePresent, true, '表格结构在场')
  assert.equal(await editCount(), editBefore3, '折叠/展开/落点全程零写回')
  passed++
  console.log('[交叉场景][PASS] 3 标题折叠 × HTML 块：折叠隐藏 widget、落点展开恢复渲染')

  // ---- 场景 4：悬停浮层内 HTML 块（真实悬停 → hover.result 注入） ----
  const editBefore4 = await editCount()
  // 悬停走 Reading（hoverPreview 同款——Live 的 wikilink 渲染依赖 catalog
  // 注入，Reading 下双链即 a.vsidian-wikilink，悬停链路两模式同源）
  await page.evaluate(() => window.crossSetMode('reading'))
  await page.locator('a.vsidian-wikilink').first().waitFor({ timeout: 5000 })
  await page.locator('a.vsidian-wikilink').first().hover()
  await page.waitForTimeout(OPEN_WAIT)
  const reqs = await page.evaluate(() =>
    window.crossSent().filter((m) => m.kind === 'hover.request'))
  assert.equal(reqs.length, 1, '应恰发出一次 hover.request')
  const req = reqs[0]
  await page.evaluate(({ reqId, instanceId, text }) => window.respondCross({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 3, text, range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: req.reqId, instanceId: req.instanceId, text: TARGET_DOC })
  await page.waitForTimeout(250)
  const popup = await page.evaluate(() => window.readCrossHoverPopup())
  assert.ok(popup.open, '悬停浮层应打开')
  assert.ok(popup.tableRows >= 1, `浮层内 HTML 表格渲染（实际 ${JSON.stringify(popup)}）`)
  assert.equal(popup.mergedCellPresent, true, '合并单元格在场（块级 HTML 在浮层内渲染）')
  assert.equal(popup.mergedCellColor, 'rgb(178, 34, 34)',
    `行内样式在浮层内生效（实际 ${popup.mergedCellColor}）`)
  assert.equal(popup.scriptCount, 0, '浮层内脚本零残留')
  assert.equal(popup.evilRan, false, '脚本载荷零执行')
  assert.ok(popup.docScope !== null && popup.docScope !== 'doc',
    `浮层内容按 B 身份装载（实际 docScope=${popup.docScope}）`)
  assert.equal(await editCount(), editBefore4, '悬停全程零写回')
  await page.mouse.move(10, 10) // 移出浮层联合域（收尾）
  passed++
  console.log('[交叉场景][PASS] 4 悬停浮层 × HTML：表格渲染 + 行内样式生效 + 脚本零执行 + B 身份隔离')

  // ---- 场景 5：块级 HTML 源文内真实 IME 组合定稿（CDP） ----
  await page.evaluate(() => window.crossSetMode('live'))
  await page.locator('.vsidian-live-html').first().waitFor({ timeout: 5000 })
  // 光标落块内文本区（'<td colspan="2">' 之后——已显形源文内）
  const imeAt = TABLE_FROM + '<table>\n  <tr>\n    <td colspan="2">'.length
  await page.evaluate((offset) => window.crossLocate(offset), imeAt)
  await page.evaluate(() => window.crossFocus())
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(([f, t]) => window.crossHtmlRevealed(f, t), [TABLE_FROM, TABLE_TO]),
    true, 'IME 前块级源码已显形（光标在内）')
  const cdp = await page.context().newCDPSession(page)
  const imeCommit = async (text) => {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
    await new Promise((resolve) => setTimeout(resolve, 120))
    await cdp.send('Input.insertText', { text })
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  await imeCommit('拼')
  await imeCommit('注')
  const docText = await page.evaluate(() => window.crossDocText())
  assert.ok(docText.includes('<td colspan="2">拼注合并单元格表</td>'),
    `IME 定稿落在块级 HTML 源文内（实际片段：${docText.slice(TABLE_FROM, TABLE_FROM + 80)}）`)
  sel = await selection()
  assert.equal(sel.length, 1, 'IME 后单光标')
  assert.equal(await page.evaluate(([f, t]) => window.crossHtmlRevealed(f, t), [TABLE_FROM, TABLE_TO]),
    true, 'IME 期间与定稿后块保持显形（未提交输入不丢失）')
  passed++
  console.log('[交叉场景][PASS] 5 块级 HTML × 真实 IME：组合定稿落源文、显形保持')

  assert.deepEqual(errors, [], `页面零未捕获异常（实际 ${JSON.stringify(errors)}）`)
  console.log(`htmlCross574: 全部 ${passed} 场景通过`)
} catch (error) {
  console.error('[交叉场景][FAIL]', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
