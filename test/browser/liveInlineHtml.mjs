// 行内原生 HTML 的原生浏览器回归（#568/T03）：真实布局（Chromium）下经
// 生产控制器装配验证——Live 行内 inline replace 装饰（span 内联颜色绘制
// /br 换行/前后正文同行流不断行/嵌套最外层/未闭合字面降级/净化负向）、
// 真实点击 = 完整源码选区、方向键逐字符进出保留落点、正反向跨片段选区
// 不扩选、兄弟片段独立显隐、多选区不坍缩、CDP 真实 IME 组合定稿、编辑
// 与文本插入生产链路（新片段即时渲染）、阅读态原位渲染（颜色 computed /
// br / 引用与表格上下文）与模式切换零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'liveInlineHtml/liveInlineHtml.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveInlineHtmlFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const SPAN_RED = '<span style="color:red">红字</span>'
const SPAN_BLUE = '<span style="color:blue">蓝字</span>'
const SPAN_NESTED = '<span style="color:red">a<b>bi</b>c</span>'
const EVIL = '<span style="color:red" onclick="evil()" data-vsidian-src-start="9">恶</span>'
const SCRIPT_FRAG = '<script>window.__inlineEvilRan = true</script>'
const DOC = [
  '开篇段落。',
  '',
  '正文：' + SPAN_RED + ' 与 ' + SPAN_BLUE + ' 兄弟，嵌套 ' + SPAN_NESTED + ' 片段，未闭合 <span style="color:red">尾巴',
  '',
  '换行第一行<br>换行第二行 尾字',
  '',
  '恶意 ' + EVIL + ' 与脚本 a ' + SCRIPT_FRAG + ' b 尾',
  '',
  '> 引用 <span style="color:red">q</span> 尾',
  '',
  '| a | b |',
  '|---|---|',
  '| <span style="color:red">格</span> | y |',
].join('\n')

const RED_FROM = DOC.indexOf(SPAN_RED)
const RED_TO = RED_FROM + SPAN_RED.length
const BLUE_FROM = DOC.indexOf(SPAN_BLUE)
const LINE2_TEXT_FROM = DOC.indexOf('正文：')
const SCRIPT_FROM = DOC.indexOf(SCRIPT_FRAG)

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initInlineHtmlDoc(text), DOC)
  await page.locator('.vsidian-live-inline-html').first().waitFor({ timeout: 5000 })

  const hosts = () => page.evaluate(() => window.readLiveInlineHosts())
  const spans = () => page.evaluate(() => window.inlineHtmlSpanInfo())
  const selection = () => page.evaluate(() => window.inlineHtmlSelection())
  const textPainted = (needle) => page.evaluate((n) => window.inlineHtmlTextPainted(n), needle)
  const lineHeightOf = (needle) => page.evaluate((n) => window.inlineHtmlLineHeightOf(n), needle)
  const editRequestCount = () => page.evaluate(() =>
    window.inlineHtmlSent().filter((m) => m.kind === 'edit.request').length)

  // ---- 场景 A：行内渲染绘制（颜色/br/嵌套/净化负向/前后正文不断行） ----
  await page.evaluate(() => window.setInlineHtmlCursor(2)) // 光标远离全部片段
  await page.waitForTimeout(120)
  const hostList = await hosts()
  // 片段表：红/蓝/嵌套/br/恶意/脚本/引用/表格格（未闭合不进表）
  const spanList = await spans()
  assert.equal(spanList.length, 8, `片段表八条（实际 ${JSON.stringify(spanList)}）`)
  assert.equal(spanList.some((s) => DOC.slice(s.from, s.to).includes('尾巴')), false,
    '未闭合尾巴不进片段表（字面降级）')
  const red = hostList.find((h) => h.from === RED_FROM)
  assert.ok(red, '红片段宿主在场')
  assert.equal(red.display, 'inline', '宿主行内化（display:inline）')
  assert.equal(red.color, 'rgb(255, 0, 0)', `span 内联颜色绘制（实际 ${red.color}）`)
  assert.equal(red.hitInside, true, '颜色元素中心命中落在宿主内（绘制层）')
  assert.equal(red.text, '红字', '渲染文本（源文标签不显示）')
  const blue = hostList.find((h) => h.from === BLUE_FROM)
  assert.equal(blue?.color, 'rgb(0, 0, 255)', '兄弟蓝片段独立渲染')
  const nested = hostList.find((h) => h.text === 'abic')
  assert.ok(nested, '嵌套片段渲染（最外层整段）')
  assert.equal(nested.color, 'rgb(255, 0, 0)', '嵌套片段内层 b 按原生语义着色')
  // br 换行：宿主含 br 元素，且所在 CM6 行高约两倍文本行高（行内换行不拆段）
  const brHost = hostList.find((h) => h.brs === 1)
  assert.ok(brHost, 'br 片段宿主在场（void 单标签）')
  const brLineHeight = await lineHeightOf('换行第一行')
  const refLineHeight = await lineHeightOf('开篇段落')
  assert.ok(brLineHeight && refLineHeight && brLineHeight > refLineHeight * 1.5,
    `br 行内换行实际加高（br 行 ${brLineHeight} vs 参照行 ${refLineHeight}）`)
  // 混排行不拆行：片段行的行高与参照同量级（< 1.8 倍——无 br 的行不该双倍高）
  const mixLineHeight = await lineHeightOf('正文：')
  assert.ok(mixLineHeight && mixLineHeight < refLineHeight * 1.8,
    `混排行单行呈现（实际 ${mixLineHeight} vs 参照 ${refLineHeight}）`)
  // 前后正文不隐藏
  assert.equal(await textPainted('正文：'), true, '片段前正文绘制')
  assert.equal(await textPainted('兄弟，嵌套'), true, '片段间正文绘制')
  assert.equal(await textPainted('<span style="color:red">尾巴'), true, '未闭合片段源文字面绘制')
  // 净化负向：恶意宿主无事件属性/伪造锚点；脚本未执行；脚本片段回退源码可见
  const evilHost = hostList.find((h) => h.text === '恶')
  assert.ok(evilHost, '恶意片段宿主在场（可安全部分渲染）')
  assert.equal(evilHost.eventAttrs, 0, 'on* 事件属性不进场')
  assert.equal(evilHost.forgedAnchor, false, '伪造系统锚点不进场')
  assert.equal(await page.evaluate(() => window.__inlineEvilRan === true), false, '内联脚本未执行')
  const scriptHost = hostList.find((h) => h.from === SCRIPT_FROM)
  assert.ok(scriptHost, '脚本片段宿主在场（回退形态）')
  assert.equal(scriptHost.scriptCount, 0, 'script 元素不进场')
  assert.ok((scriptHost.text ?? '').includes('<script>'), '脚本片段回退转义源码可见')
  passed++
  console.log('[LiveInlineHTML][PASS] 行内渲染绘制：颜色/br/嵌套/净化负向/前后正文不断行')

  // ---- 场景 B：真实点击渲染内容 → 选中完整源码 ----
  await page.evaluate(() => window.focusInlineHtml())
  const redBox = await page.evaluate((from) => {
    const host = Array.from(document.querySelectorAll('.vsidian-live-inline-html'))
      .find((h) => Number(h.dataset['vsidianHtmlFrom']) === from)
    const colored = host?.querySelector('[style*="color"]')
    if (!colored) {
      return null
    }
    const rect = colored.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, RED_FROM)
  assert.ok(redBox, '红片段颜色元素有边界盒')
  await page.mouse.click(redBox.x + redBox.width / 2, redBox.y + redBox.height / 2)
  await page.waitForTimeout(120)
  let sel = await selection()
  assert.equal(sel.length, 1, '单选区')
  assert.equal(Math.min(sel[0].anchor, sel[0].head), RED_FROM, '点击后选区起点 = 片段起点')
  assert.equal(Math.max(sel[0].anchor, sel[0].head), RED_TO, '点击后选区终点 = 片段终点')
  assert.equal(await textPainted(SPAN_RED), true, '源码显形绘制（完整源文可见）')
  assert.equal((await hosts()).some((h) => h.from === RED_FROM), false, '触及后 widget 撤下')
  passed++
  console.log('[LiveInlineHTML][PASS] 点击渲染内容 → 选中完整源码并显形')

  // ---- 场景 C：方向键逐字符进出（键盘落点保留） ----
  await page.evaluate((p) => window.setInlineHtmlCursor(p), LINE2_TEXT_FROM)
  await page.evaluate(() => window.focusInlineHtml())
  await page.waitForTimeout(120)
  // 从行首 3 次 ArrowRight：'正文：' 三字符后落点 = 片段起点（边界触及显形）
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(40)
  }
  sel = await selection()
  assert.equal(sel[0].head, RED_FROM, `键盘落点 = 片段起点（实际 ${sel[0].head}）`)
  assert.equal((await hosts()).some((h) => h.from === RED_FROM), false, '边界触及即显形')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(40)
  sel = await selection()
  assert.equal(sel[0].head, RED_FROM + 1, '显形后逐字符前进（落点保留）')
  // 继续前进直至越过片段终点 → 恢复渲染
  let left = false
  for (let step = 0; step < SPAN_RED.length + 4 && !left; step++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(30)
    const s = await selection()
    left = s[0].head > RED_TO
  }
  assert.ok(left, '方向键可离开片段区间')
  assert.equal((await hosts()).some((h) => h.from === RED_FROM), true, '离开后恢复渲染')
  passed++
  console.log('[LiveInlineHTML][PASS] 方向键逐字符进出：落点保留、离开恢复渲染')

  // ---- 场景 D：正反向跨片段选区（shift+click 两向，不扩选） ----
  // 边界语义先行：shift+click 落点映射到片段起点（replace 区间无内部
  // 位置，posAtDOM 取最近边界）——选区止于边界 = 严格相交不成立 → 不
  // 显形（#296「端点进入才显形」同款口径）
  const line2Box = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('开篇段落'))
    return line ? line.getBoundingClientRect() : null
  })
  assert.ok(line2Box, '参照行在场')
  await page.evaluate(() => window.focusInlineHtml())
  await page.mouse.click(line2Box.x + 4, line2Box.y + line2Box.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.click(redBox.x + redBox.width / 2, redBox.y + redBox.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  sel = await selection()
  assert.equal(sel.length, 1, '选区单 range')
  assert.equal(Math.min(sel[0].anchor, sel[0].head), 0, '锚点 = 点击行内位置（未被扩到片段起点）')
  const edgeTo = Math.max(sel[0].anchor, sel[0].head)
  assert.equal(edgeTo, RED_FROM, `shift+click 片段渲染区落点 = 片段起点边界（实际 ${edgeTo}）`)
  assert.equal((await hosts()).some((h) => h.from === RED_FROM), true,
    '选区止于边界不显形（严格相交语义——端点触及不算相交）')
  // 正向跨片段：行首锚点，shift+click 混排行尾（片段之后）→ 选区横跨
  const mixBox = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('尾巴'))
    return line ? line.getBoundingClientRect() : null
  })
  assert.ok(mixBox, '混排行在场')
  await page.mouse.click(line2Box.x + 4, line2Box.y + line2Box.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.click(mixBox.x + mixBox.width - 6, mixBox.y + mixBox.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  sel = await selection()
  assert.equal(sel.length, 1, '跨片段选区单 range')
  const span = { from: Math.min(sel[0].anchor, sel[0].head), to: Math.max(sel[0].anchor, sel[0].head) }
  assert.ok(span.from <= RED_FROM && span.to >= RED_TO, '选区横跨片段（端点在片段外）')
  assert.notEqual(span.from, RED_FROM, '选区起点未被扩到片段起点')
  assert.notEqual(span.to, RED_TO, '选区终点未被扩到片段终点')
  assert.equal((await hosts()).some((h) => h.from === RED_FROM), false, '选区严格相交显形')
  assert.equal(await textPainted(SPAN_RED), true, '显形后源文可见可复制')
  // 反向：从混排行尾选回行首
  await page.mouse.click(mixBox.x + mixBox.width - 6, mixBox.y + mixBox.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.click(line2Box.x + line2Box.width - 6, line2Box.y + line2Box.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  sel = await selection()
  assert.equal(sel.length, 1, '反向跨片段选区单 range')
  const rspan = { from: Math.min(sel[0].anchor, sel[0].head), to: Math.max(sel[0].anchor, sel[0].head) }
  assert.ok(rspan.from <= RED_FROM && rspan.to >= RED_TO, '反向选区同样横跨')
  assert.notEqual(rspan.from, RED_FROM, '反向选区起点未被扩选')
  assert.notEqual(rspan.to, RED_TO, '反向选区终点未被扩选')
  passed++
  console.log('[LiveInlineHTML][PASS] 正反向跨片段选区：严格相交显形、端点不扩选、边界触及不显形')

  // ---- 场景 E：兄弟片段独立显隐 + 多选区不坍缩 ----
  await page.evaluate((p) => window.setInlineHtmlCursor(p), RED_FROM + 5)
  await page.waitForTimeout(120)
  let hostNow = await hosts()
  assert.equal(hostNow.some((h) => h.from === RED_FROM), false, '红片段显形')
  assert.equal(hostNow.some((h) => h.from === BLUE_FROM), true, '蓝片段独立保持渲染')
  await page.evaluate((ranges) => window.setInlineHtmlRanges(ranges), [
    [2, 2],
    [RED_FROM + 2, RED_FROM + 2],
  ])
  await page.waitForTimeout(120)
  sel = await selection()
  assert.equal(sel.length, 2, '多选区两 range 保持（不坍缩）')
  assert.equal(Math.min(sel[0].anchor, sel[0].head), 2, '无关 range 端点不变')
  assert.equal((await hosts()).some((h) => h.from === RED_FROM), false, '任一 range 命中即显形')
  passed++
  console.log('[LiveInlineHTML][PASS] 兄弟片段独立显隐；多选区任一命中显形不坍缩')

  // ---- 场景 F：选择类操作零写回（进入编辑前的基线） ----
  assert.equal(await editRequestCount(), 0, '点击/键盘/选区全程零 edit.request（零写回）')
  passed++
  console.log('[LiveInlineHTML][PASS] 显隐与选区操作零写回')

  // ---- 场景 G：CDP 真实 IME 组合定稿（multicursorIme 同型手法） ----
  // 光标落片段内文本区（'红' 前——已显形源文内）
  await page.evaluate((p) => window.setInlineHtmlCursor(p), RED_FROM + SPAN_RED.indexOf('红'))
  await page.evaluate(() => window.focusInlineHtml())
  await page.waitForTimeout(120)
  const cdp = await page.context().newCDPSession(page)
  const imeCommit = async (text) => {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
    await new Promise((resolve) => setTimeout(resolve, 120))
    await cdp.send('Input.insertText', { text })
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  await imeCommit('注')
  await imeCommit('音')
  let docText = await page.evaluate(() => window.inlineHtmlDocText())
  assert.ok(docText.includes('<span style="color:red">注音红字</span>'),
    `IME 定稿落在已显形片段源文内（实际片段：${docText.slice(RED_FROM, RED_FROM + 40)}）`)
  sel = await selection()
  assert.equal(sel.length, 1, 'IME 后单光标')
  passed++
  console.log('[LiveInlineHTML][PASS] 真实 IME 组合定稿：未提交输入不丢失、落点保持')

  // ---- 场景 H：编辑/插入生产链路（新片段即时渲染） ----
  const spansBefore = (await spans()).length
  await page.evaluate((p) => window.setInlineHtmlCursor(p), DOC.indexOf('开篇段落') + 5)
  await page.evaluate(() => window.focusInlineHtml())
  await cdp.send('Input.insertText', { text: ' 贴入 <u>贴</u> 尾' })
  await page.waitForTimeout(200)
  docText = await page.evaluate(() => window.inlineHtmlDocText())
  assert.ok(docText.includes('开篇段落。 贴入 <u>贴</u> 尾'), '文本插入经生产链路写回文档')
  const spansAfter = (await spans()).length
  assert.equal(spansAfter, spansBefore + 1, `新片段即时进表并渲染（${spansBefore} → ${spansAfter}）`)
  const uHost = (await hosts()).find((h) => h.text === '贴')
  assert.ok(uHost, '新插入片段渲染宿主在场')
  assert.ok(await editRequestCount() >= 1, '编辑经生产出站通道（edit.request 在场）')
  passed++
  console.log('[LiveInlineHTML][PASS] 编辑/插入生产链路：新片段即时渲染')

  // ---- 场景 I：阅读态原位渲染（颜色 computed / br / 上下文 / 降级） ----
  const editsBeforeMode = await editRequestCount()
  await page.evaluate((mode) => window.setInlineHtmlMode(mode), 'reading')
  await page.locator('.vsidian-view-reading').waitFor({ timeout: 5000 })
  await page.waitForTimeout(200)
  const colors = await page.evaluate(() => window.readReadingInlineColors())
  assert.ok(colors.length >= 5, `阅读态行内颜色元素 ≥5（红/蓝/嵌套/恶意/引用/表格，实际 ${colors.length}）`)
  assert.ok(colors.some((c) => c.color === 'rgb(255, 0, 0)' && c.text.includes('红')),
    '红片段原位着色（computed 绘制证据）')
  assert.ok(colors.some((c) => c.color === 'rgb(0, 0, 255)'), '蓝片段原位着色')
  assert.ok(colors.some((c) => c.text.trim() === 'q'), '引用内片段渲染（容器语义不丢）')
  assert.ok(colors.some((c) => c.text.trim() === '格'), '表格格内片段渲染')
  assert.ok(colors.some((c) => c.hitInside), '阅读态颜色元素中心命中（绘制层）')
  const brCount = await page.evaluate(() => window.readingInlineBrCount())
  assert.ok(brCount >= 1, `阅读态 br 换行渲染（实际 ${brCount}）`)
  const readingText = await page.evaluate(() =>
    (document.querySelector('.vsidian-view-reading')?.textContent ?? ''))
  assert.ok(readingText.includes('<span style="color:red">尾巴'), '未闭合片段阅读态字面')
  assert.ok(readingText.includes('window.__inlineEvilRan'), '脚本片段回退源码可见')
  assert.equal(await page.evaluate(() => window.__inlineEvilRan === true), false, '阅读态脚本未执行')
  assert.equal(await editRequestCount(), editsBeforeMode, '模式切换零写回')
  // 切回 Live：文档全文与编辑后状态一致（无陈旧装饰残留态破坏）
  await page.evaluate((mode) => window.setInlineHtmlMode(mode), 'live')
  await page.locator('.cm-editor').waitFor({ timeout: 5000 })
  await page.waitForTimeout(150)
  const liveAgain = await page.evaluate(() => window.inlineHtmlDocText())
  assert.equal(liveAgain, docText, '模式往返源文逐字节一致')
  passed++
  console.log('[LiveInlineHTML][PASS] 阅读态原位渲染 + 模式往返零写回')

  // ---- 收尾：页面错误收集 ----
  assert.deepEqual(errors, [], '无页面错误（脚本不执行、装饰切换无异常）')
  passed++
  console.log('[LiveInlineHTML][PASS] 全程无 pageerror')
} finally {
  await browser.close()
}
console.log(`[LiveInlineHTML] 全部通过：${passed} 组`)
