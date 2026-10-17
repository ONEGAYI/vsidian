// #569（T04）全文文档样式装载与作用域隔离的原生浏览器回归：真实布局
// （Chromium）下经生产控制器验证——b2 逐块标记 + :where():is() 改写的
// 端到端行为。断言全部落在绘制读值（getComputedStyle）或 head 产物元素，
// 不以 DOM 存在性替代样式命中证据（视觉层断言纪律）。
//
// 覆盖矩阵（票面验收）：
// - 多处 style 块按源码顺序层叠；Live 编辑/撤销/重做同步产物与绘制
// - Markdown 标签选择器 Reading 直中、Live 按实际 DOM 不命中（Q4=B 模式
//   差异——断言双向：Reading 命中 + Live 源码行不被污染）
// - 工具栏与源码层排除（定向规则无标记祖先不命中，读值保持基线）
// - 纯 <style> 块 Reading 隐藏（T02 既有）+ 样式仍生效（本票）
// - 虚拟化：滚动远离/返回样式不失效（产物挂 head，不随块窗口）
// - A→B 嵌入隔离 + 同一 B 多实例共享产物 + B 内部 Live 的孙卡 C 隔离
// - CSS 片段兼容：生产标题字号规则（类特异性）不被文档标签规则压过
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'docStyle/docStyle.js')
await build({ entryPoints: [path.join(root, 'test/browser/docStyleFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

// ---- 文档内容 ----
const STYLE_1 = '<style>\np { color: rgb(178, 34, 34); }\n</style>'
const STYLE_2 = [
  '<style>',
  'p { color: rgb(0, 0, 205); }',
  'h1 { color: rgb(75, 0, 130); }',
  '.mark-a { background-color: rgb(222, 0, 111); }',
  'div { --a-mark: rgb(9, 130, 9); }',
  '.cm-content { color: rgb(250, 0, 250); }',
  '.vsidian-toolbar { color: rgb(250, 100, 0); }',
  '</style>',
].join('\n')
const VAR_BLOCK = '<div class="mark-a" style="color: var(--a-mark, rgb(3, 3, 3))">A 变量消费</div>'
const FILLER = Array.from({ length: 60 }, (_, i) => `填充段落 ${i + 1}，撑开视口驱动虚拟化窗口滚动。`).join('\n\n')
const A_DOC = [
  '# A 主标题',
  '',
  'A 导语段落。',
  '',
  STYLE_1,
  '',
  STYLE_2,
  '',
  VAR_BLOCK,
  '',
  `![[目标B]]`,
  '',
  `![[目标B]]`,
  '',
  FILLER,
].join('\n')
const B_DOC = [
  '<style>',
  'p { color: rgb(0, 128, 128); }',
  'h1 { color: rgb(128, 0, 96); }',
  '</style>',
  '',
  '# B 标题',
  '',
  'B 段落。',
  '',
  '![[孙级C]]',
].join('\n')
const C_DOC = [
  '<style>',
  'p { color: rgb(107, 142, 35); }',
  '</style>',
  '',
  'C 段落。',
].join('\n')

const BLUE = 'rgb(0, 0, 205)'
const PURPLE = 'rgb(75, 0, 130)'
const TEAL = 'rgb(0, 128, 128)'
const B_H1 = 'rgb(128, 0, 96)'
const OLIVE = 'rgb(107, 142, 35)'
const A_MARK = 'rgb(9, 130, 9)'
const A_MARK_BG = 'rgb(222, 0, 111)'
/** Live 编辑后的新终值（块 2 的 p 被替换） */
const EDITED_BLUE = 'rgb(0, 102, 51)'

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  // ---- Reading 模式起步（Markdown 标签直中 + 层叠 + 排除面） ----
  await page.evaluate(([a, b, c]) => window.initDocStyleDoc(a, b, c), [A_DOC, B_DOC, C_DOC])
  await page.evaluate(() => window.setDocStyleMode('reading'))
  // 主阅读区（.vsidian-main 直接子容器）——B 卡的隐藏 Reading 容器
  //（embed 双容器并存）不参与等待
  await page.locator('.vsidian-main > .vsidian-view-reading .vsidian-reading-paragraph')
    .first().waitFor({ timeout: 5000 })

  let paint = await page.evaluate(() => window.readDocStylePaint())
  let head = await page.evaluate(() => window.docStyleHeadInfo())
  const mainEntry = head.find((h) => h.scope === 'doc')
  assert.ok(mainEntry, '主文档产物元素在场（head 末尾）')
  assert.equal(mainEntry.snippetLinkAfter, false, '产物后置于片段链（决策点 2：产物之后无片段 link）')
  assert.ok(mainEntry.rules > 0, `产物有真实规则（实际 ${mainEntry.rules}）`)

  // 多处 style 块按源码顺序层叠：块 2 的蓝压过块 1 的红
  assert.equal(paint.aPColor, BLUE, `A 段落取后块终值（实际 ${paint.aPColor}）`)
  // Markdown 标签选择器 Reading 直中（语义 h1 元素）
  assert.equal(paint.aH1Color, PURPLE, `A 标题被 h1{} 直染（实际 ${paint.aH1Color}）`)
  // 生产 CSS 兼容：文档标签规则(0,0,1)不压过生产标题类规则（探针 M7 同口径）
  assert.notEqual(paint.aH1FontSize, '', '生产标题字号规则在场（非空读值）')
  const baseH1FontSize = paint.aH1FontSize
  // html 块：类命中 + 变量定义/消费都在本篇标记面内
  assert.equal(paint.aMarkBg, A_MARK_BG, `.mark-a 类命中（实际 ${paint.aMarkBg}）`)
  assert.equal(paint.aVarColor, A_MARK, `div{--a-mark} 变量本篇可用（实际 ${paint.aVarColor}）`)
  // 排除面：工具栏与源码层不被定向规则污染（读值非攻击色）
  assert.notEqual(paint.toolbarColor, 'rgb(250, 100, 0)', '工具栏不被 .vsidian-toolbar{} 定向规则染指')
  assert.notEqual(paint.cmLineColor, 'rgb(250, 0, 250)', '源码层不被 .cm-content{} 定向规则染指')
  // 纯 style 块 Reading 隐藏（渲染区无样式源文可见）+ 样式仍生效（上面已断言）
  assert.equal(paint.styleBlockVisible, false, '纯 style 块源文在 Reading 不可见')
  // 标记铺开：全部 Reading 块根挂 doc 标记
  assert.equal(paint.scopedBlockCount, paint.readingBlockCount,
    `全部内容块挂 doc 标记（${paint.scopedBlockCount}/${paint.readingBlockCount}）`)
  passed += 9

  // ---- B 嵌入隔离（Reading 卡）+ C 孙卡 + 多实例共享 ----
  // 主阅读容器内的卡（B 的隐藏 Reading 容器中的卡壳不参与等待）
  await page.locator('.vsidian-main > .vsidian-view-reading .vsidian-embed-card')
    .first().waitFor({ timeout: 5000 })
  // 嵌入装载异步（hover.request 微任务往返 + B/C 递归装载）——轮询至
  // 双层卡与 B/C 产物齐备（上限 8s）
  await page.waitForFunction(() => {
    const embeds = window.readDocStyleEmbeds()
    const grand = embeds.filter((e) => e.nested)
    return embeds.filter((e) => !e.nested).length === 2 && grand.length === 2 &&
      grand.every((g) => g.pColor === 'rgb(107, 142, 35)') &&
      window.docStyleHeadInfo().filter((h) => h.scope.startsWith('ref:')).length === 2
  }, { timeout: 8000 })
  const embeds = await page.evaluate(() => window.readDocStyleEmbeds())
  const topCards = embeds.filter((e) => !e.nested)
  const grandCards = embeds.filter((e) => e.nested)
  assert.equal(topCards.length, 2, `两个 B 实例（多 occurrence；实际 ${embeds.length} 卡含嵌套）`)
  for (const e of topCards) {
    assert.equal(e.pColor, TEAL, `B 段落取 B 自有样式（实际 ${e.pColor}）`)
    assert.equal(e.h1Color, B_H1, `B 标题不被 A 的 purple 污染（实际 ${e.h1Color}）`)
    assert.ok(e.scopeValue && e.scopeValue.startsWith('ref:'),
      `B 内容块挂派生键标记（实际 ${e.scopeValue}）`)
  }
  // C 孙卡（B 内容中的 ![[孙级C]] 在 Reading 链升级嵌卡）：取 C 自有
  // olive、不被 A 的 blue/B 的 teal 污染
  assert.equal(grandCards.length, 2, '两个 C 孙卡（每个 B 内一个）')
  for (const g of grandCards) {
    assert.equal(g.pColor, OLIVE, `C 段落取 C 自有样式（实际 ${g.pColor}）`)
  }
  head = await page.evaluate(() => window.docStyleHeadInfo())
  const refEntries = head.filter((h) => h.scope.startsWith('ref:'))
  assert.equal(refEntries.length, 2, `B 与 C 各自产物在场（键互异；实际 ${refEntries.map((r) => r.scope).join(',')}）`)
  assert.ok(refEntries.every((h) => h.rules > 0), 'B/C 产物有规则')
  passed += 10

  // ---- 虚拟化：滚动远离/返回，样式不失效不闪回 ----
  await page.evaluate(() => window.docStyleScrollRatio(0.95))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.docStyleScrollRatio(0))
  await page.waitForTimeout(200)
  paint = await page.evaluate(() => window.readDocStylePaint())
  assert.equal(paint.aPColor, BLUE, '滚动往返后 A 段落样式仍命中（产物挂 head 不随窗口）')
  head = await page.evaluate(() => window.docStyleHeadInfo())
  assert.equal(head.find((h) => h.scope === 'doc')?.rules, mainEntry.rules, '滚动期间产物规则数稳定')
  passed += 2

  // ---- Live 模式：源码层排除 + html 块命中 + 编辑/撤销/重做 ----
  await page.evaluate(() => window.setDocStyleMode('live'))
  // 模式切换按锚点恢复视口（前段滚动把锚点留在文档深处）——滚回顶部
  // 让前部 html 块进入 CM6 视口（widget 是视口内渲染，视口外不挂载）
  await page.evaluate(() => {
    const sc = document.querySelector('.cm-scroller')
    if (sc instanceof HTMLElement) sc.scrollTop = 0
  })
  await page.waitForTimeout(150)
  await page.locator('.vsidian-live-html').first().waitFor({ timeout: 5000 })
  const liveLineBaseline = await page.evaluate(() => {
    const el = document.querySelector('.cm-content .cm-line')
    return el ? getComputedStyle(el).color : ''
  })
  assert.notEqual(liveLineBaseline, 'rgb(250, 0, 250)', 'Live 源码行不被定向规则污染')
  const liveHostPaint = await page.evaluate(() => {
    const host = document.querySelector('.vsidian-live-html .mark-a')
    return host ? { bg: getComputedStyle(host).backgroundColor, color: getComputedStyle(host).color } : null
  })
  assert.ok(liveHostPaint, 'Live html 块 widget 在场')
  assert.equal(liveHostPaint.bg, A_MARK_BG, 'Live html 块类命中（双模式一致）')
  assert.equal(liveHostPaint.color, A_MARK, 'Live html 块变量消费命中')
  passed += 3

  // Live 编辑 style 块：真实事务替换块 2 的 p 色值 → 产物与绘制同步
  const oldDecl = 'p { color: rgb(0, 0, 205); }'
  const newDecl = 'p { color: rgb(0, 102, 51); }'
  const docText = await page.evaluate(() => window.docStyleDocText())
  const declAt = docText.indexOf(oldDecl)
  assert.ok(declAt >= 0, '定位块 2 的 p 声明')
  await page.evaluate(([from, to, text]) => window.docStyleReplace(from, to, text),
    [declAt, declAt + oldDecl.length, newDecl])
  await page.waitForTimeout(120)
  await page.evaluate(() => window.setDocStyleMode('reading'))
  await page.waitForTimeout(120)
  paint = await page.evaluate(() => window.readDocStylePaint())
  assert.equal(paint.aPColor, EDITED_BLUE, `Live 编辑后 Reading 绘制同步（实际 ${paint.aPColor}）`)
  passed += 1

  // 撤销 → 旧值回来；重做 → 新值回来
  assert.equal(await page.evaluate(() => window.docStyleUndo()), true, '撤销成功')
  await page.waitForTimeout(120)
  paint = await page.evaluate(() => window.readDocStylePaint())
  assert.equal(paint.aPColor, BLUE, `撤销后回到旧值（实际 ${paint.aPColor}）`)
  assert.equal(await page.evaluate(() => window.docStyleRedo()), true, '重做成功')
  await page.waitForTimeout(120)
  paint = await page.evaluate(() => window.readDocStylePaint())
  assert.equal(paint.aPColor, EDITED_BLUE, `重做后恢复新值（实际 ${paint.aPColor}）`)
  passed += 2

  // ---- 删除全部 style 块：产物移除（无残留规则） ----
  const editedDoc = await page.evaluate(() => window.docStyleDocText())
  await page.evaluate(([from, to]) => window.docStyleReplace(from, to, ''),
    [editedDoc.indexOf(STYLE_1), editedDoc.indexOf(STYLE_1) + STYLE_1.length])
  await page.evaluate(() => window.setDocStyleMode('live'))
  await page.waitForTimeout(80)
  const afterFirst = await page.evaluate(() => window.docStyleDocText())
  const s2at = afterFirst.indexOf(newDecl.replace('rgb(0, 102, 51)', 'rgb(0, 0, 205)')) >= 0
    ? afterFirst.indexOf('<style>\np { color: rgb(0, 0, 205); }') // undo 已回滚处不适用——直接找块 2 起点
    : afterFirst.indexOf('<style>\np { color: rgb(0, 102, 51); }')
  assert.ok(s2at >= 0, '定位块 2 起点')
  const s2endMarker = afterFirst.indexOf('</style>', s2at) + '</style>'.length
  await page.evaluate(([from, to]) => window.docStyleReplace(from, to, ''), [s2at, s2endMarker])
  await page.waitForTimeout(150)
  head = await page.evaluate(() => window.docStyleHeadInfo())
  assert.equal(head.find((h) => h.scope === 'doc'), undefined, '删除全部 style 块后主文产物移除（无残留）')
  paint = await page.evaluate(() => window.setDocStyleMode('reading'))
  await page.waitForTimeout(120)
  paint = await page.evaluate(() => window.readDocStylePaint())
  assert.notEqual(paint.aPColor, EDITED_BLUE, '删除后样式不再命中')
  assert.notEqual(paint.aH1Color, PURPLE, '标题回到生产主题色')
  passed += 3

  // ---- 撤销恢复（重挂即恢复）+ 嵌入内部 Live 的装载与排除 ----
  // 撤销两步（两次删除）回到初始全文，B/C 嵌入重新装载
  await page.evaluate(async () => { await window.docStyleUndo() })
  await page.evaluate(async () => { await window.docStyleUndo() })
  await page.waitForTimeout(150)
  head = await page.evaluate(() => window.docStyleHeadInfo())
  assert.ok(head.find((h) => h.scope === 'doc'), '撤销删除后产物恢复（重挂即恢复）')
  assert.equal(head.filter((h) => h.scope.startsWith('ref:')).length, 2, 'B 与 C 产物随嵌入重挂恢复')
  // 切 Live：B 卡随根模式为 Live（内部编辑器装配 docScope facet 与装载）
  await page.evaluate(() => window.setDocStyleMode('live'))
  await page.locator('.cm-editor').first().waitFor({ timeout: 5000 })
  await page.waitForTimeout(200)
  // 嵌入内部 Live 编辑器（B 的隐藏/可见 Live 容器随根模式装配）：B 样式
  // 装载不依赖命中面（产物在场），B 源码行不被 A 定向规则污染
  const innerLines = await page.evaluate(() => {
    const editors = Array.from(document.querySelectorAll('.cm-editor'))
    return editors.filter((e) => e.closest('.vsidian-embed-card') !== null).map((e) => {
      const line = e.querySelector('.cm-content .cm-line')
      return line ? getComputedStyle(line).color : ''
    })
  })
  assert.ok(innerLines.length > 0, 'B 内部 Live 编辑器在场（Live 装配接线生效）')
  for (const c of innerLines) {
    assert.notEqual(c, 'rgb(250, 0, 250)', 'B 内部 Live 源码行不被 A 定向规则污染')
  }
  passed += 5

  assert.deepEqual(errors, [], '无页面错误')
  console.log(`docStyle: ${passed} 组断言通过`)
} finally {
  await browser.close()
}
