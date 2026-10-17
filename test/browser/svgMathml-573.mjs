// #573（T08）SVG/MathML 与混合命名空间渲染的原生浏览器回归（真实
// Chromium 布局 + 生产控制器 / 生产装配链直驱）：SVG 几何/文字/渐变/
// foreignObject 实际绘制（rect 面积 + computed fill + elementFromPoint，
// 非 DOM 存在性）、MathML 结构绘制（Chromium MathML Core）、行内 SVG
// 混排不吞前后 Markdown、Live 点击 SVG 选区精确与零写回、净化负向
//（svg onload/script/animate 劫持不进场不执行）、本篇 style 类选择器
// 命中 SVG、SVG image href 资源通道装载、A/B 相同 ID 不串目标（B 前缀
// 化 + CSS #id/url(#id) 协同命中）、释放无残留。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'svgMathml-573/svgMathml-573.js')
await build({ entryPoints: [path.join(root, 'test/browser/svgMathml573Fixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml } = await buildZhLocaleIsland(root)

/** A 主文档：块级 SVG（渐变/文字/foreignObject）+ MathML + 行内 SVG 混排
 *  + 恶意载荷块 + SVG image 块 + 本篇 style 类 + 目标块。id="shared" 与
 *  B 同名（串目标检测——A 橙色渐变 / B 绿色渐变）。 */
const SVG_BLOCK = [
  '<svg width="160" height="80" viewBox="0 0 160 80">',
  '  <defs>',
  '    <linearGradient id="shared">',
  '      <stop offset="0" stop-color="#ff8800"/>',
  '      <stop offset="1" stop-color="#ffcc00"/>',
  '    </linearGradient>',
  '  </defs>',
  '  <rect x="2" y="2" width="120" height="50" fill="url(#shared)"/>',
  '  <text x="6" y="20" font-size="14">SVG 文字</text>',
  '  <foreignObject x="124" y="4" width="32" height="18"><div xmlns="http://www.w3.org/1999/xhtml" style="color: rgb(178, 34, 34)">FO</div></foreignObject>',
  '</svg>',
].join('\n')
const MATH_BLOCK = '<math display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mfrac><mn>1</mn><mi>y</mi></mfrac></mrow></math>'
const INLINE_LINE = '中间段落 <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="#0a880a"></circle></svg> 行内后文。'
const EVIL_BLOCK = '<svg class="vsidian-svgmath-evil" width="10" height="10"><rect onload="window.__svgMathEvilRan = true" width="5" height="5"/><script>window.__svgMathEvilRan = true</script><a><text>e</text><animate attributeName="href" values="javascript:x"></animate></a></svg>'
const IMAGE_BLOCK = '<svg width="40" height="24"><image href="svgpic.png" width="36" height="20"></image></svg>'
const DOC = [
  '开篇段落。',
  '',
  SVG_BLOCK,
  '',
  MATH_BLOCK,
  '',
  INLINE_LINE,
  '',
  EVIL_BLOCK,
  '',
  IMAGE_BLOCK,
  '',
  '<style>',
  '.svg-cls { fill: #0055aa; }',
  '</style>',
  '',
  '<svg width="30" height="30"><rect class="svg-cls" width="24" height="24"></rect></svg>',
  '',
  '尾段。',
].join('\n')

const SVG_FROM = DOC.indexOf(SVG_BLOCK)
const SVG_TO = SVG_FROM + SVG_BLOCK.length
const INLINE_FROM = DOC.indexOf(INLINE_LINE)
const INLINE_TO = INLINE_FROM + INLINE_LINE.length

/** 1x1 PNG（SVG image 装载资源） */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** B 嵌入目标（生产装配链直驱）：id="shared" 与 A 同名（绿色渐变——
 *  串到 A 的橙色即串目标）；#bstroke 钉 CSS id 选择器协同。 */
const B_HTML = '<svg width="200" height="70"><defs><linearGradient id="shared"><stop offset="0" stop-color="#00aa44"/><stop offset="1" stop-color="#00cc66"/></linearGradient></defs><rect class="b-target" fill="url(#shared)" width="160" height="44"/><rect class="b-stroke" id="bstroke" width="100" height="30" fill="none"/></svg>'
const B_CSS = [
  '#bstroke { stroke: #aa00aa; stroke-width: 2; }',
  '.b-target { stroke: url(#shared); stroke-width: 1; }',
].join('\n')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  const settle = (ms = 250) => page.waitForTimeout(ms)
  const readA = () => page.evaluate(() => window.readSvgMathA())

  // ---- 场景 A：Live 装载 + 块级 SVG/MathML widget 渲染（真实布局）----
  await page.evaluate(([text, pic]) => window.initSvgMathDoc(text, { 'svgpic.png': pic }), [DOC, TINY_PNG])
  await settle(500)
  await page.locator('.vsidian-live-html').first().waitFor({ timeout: 5000 })
  const editCount0 = await page.evaluate(() => window.svgMathSent().filter((m) => m.kind === 'edit.request').length)
  let a = await readA()
  assert.ok(a, 'A 观测域在场')
  assert.ok(a.svgs >= 5, `块级 4 + 行内 1 至少 5 个 svg（实际 ${a.svgs}）`)
  assert.ok(a.svgSizes.some((s) => s.w > 40 && s.h > 30), `首个块级 svg 有真实布局尺寸（实际 ${JSON.stringify(a.svgSizes)}）`)
  assert.equal(a.scriptCount, 0, `净化负向：svg 命名空间 script 零残留（实际 ${a.scriptCount}）`)
  assert.equal(a.eventAttrCount, 0, `净化负向：on* 事件属性零残留（实际 ${a.eventAttrCount}）`)
  assert.equal(a.animateHijack, false, '净化负向：animate attributeName=href 劫持形态不进场')
  assert.equal(await page.evaluate(() => window.svgMathEvilRan()), false, '恶意载荷零执行（script/onload 未触发）')
  assert.equal(errors.length, 0, `页面零未捕获异常（实际 ${JSON.stringify(errors)}）`)
  passed++
  console.log('[SVG/MathML][PASS] A Live 净化负向：svg script/事件/动画劫持零进场零执行')

  // ---- 场景 B：点击 SVG 渲染区 → 选中完整源码（选区精确 + 零写回）----
  const svgHostBox = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('.vsidian-live-html'))
    const hit = hosts.find((h) => h.querySelector('svg rect[fill], svg circle') !== null)
    return hit ? hit.getBoundingClientRect().toJSON() : null
  })
  assert.ok(svgHostBox, 'SVG 渲染 widget 在场')
  await page.mouse.click(svgHostBox.x + 40, svgHostBox.y + 20)
  await settle(200)
  let sel = await page.evaluate(() => window.svgMathSelection())
  assert.equal(sel.length > 0 ? Math.min(sel[0].anchor, sel[0].head) : -1, SVG_FROM, '点击 SVG 后选区起点 = 片段起点')
  assert.equal(sel.length > 0 ? Math.max(sel[0].anchor, sel[0].head) : -1, SVG_TO, '点击 SVG 后选区终点 = 片段终点')
  const editCount1 = await page.evaluate(() => window.svgMathSent().filter((m) => m.kind === 'edit.request').length)
  assert.equal(editCount1, editCount0, '点击显形零写回（edit.request 计数不变）')
  // 离开恢复渲染（块级按区间精确匹配——单行 HTML 片段在 Lezer 侧为行内
  // 装饰，块级 widget 的期望数以多行块为准）
  await page.evaluate(() => window.setSvgMathCursor(0))
  await settle(200)
  const recovered = await page.evaluate((from) => {
    const host = Array.from(document.querySelectorAll('.vsidian-live-html'))
      .find((h) => Number(h.dataset['vsidianHtmlFrom']) === from)
    return host ? host.querySelector('svg') !== null : false
  }, SVG_FROM)
  assert.equal(recovered, true, '光标离开后块级 SVG 恢复渲染（按区间精确匹配）')
  passed++
  console.log('[SVG/MathML][PASS] B 点击 SVG 选中完整源码、离开恢复渲染、零写回')

  // ---- 场景 C：行内 SVG 混排不吞前后 Markdown ----
  await page.evaluate((p) => window.setSvgMathCursor(p), DOC.indexOf('开篇段落。'))
  await settle(300)
  const inlineInfo = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('.vsidian-live-inline-html'))
    const svgHost = hosts.find((h) => h.querySelector('svg circle') !== null)
    const line = svgHost?.closest('.cm-line')
    const svgEl = svgHost?.querySelector('svg')
    const rect = svgEl?.getBoundingClientRect()
    return {
      present: svgHost !== undefined,
      svgPainted: rect !== undefined && rect.width > 0,
      lineText: line?.textContent ?? '',
    }
  })
  assert.ok(inlineInfo.present, '行内 SVG widget 在场')
  assert.ok(inlineInfo.svgPainted, '行内 SVG 有布局尺寸（真实渲染）')
  assert.ok((inlineInfo.lineText ?? '').includes('中间段落') && (inlineInfo.lineText ?? '').includes('行内后文'),
    `行内 SVG 前后正文保留（实际 ${JSON.stringify(inlineInfo.lineText)}）`)
  // 键盘进入行内片段区间（光标触及 → 显形源码可见；落点取 svg 开标签内部）
  await page.evaluate(() => window.focusSvgMathLive())
  await page.evaluate((p) => window.setSvgMathCursor(p), INLINE_FROM + '中间段落 '.length + 2)
  await settle(200)
  const inlineRevealed = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('.vsidian-live-inline-html'))
    return hosts.filter((h) => h.querySelector('svg circle') !== null).length
  })
  assert.equal(inlineRevealed, 0, '光标进入行内 SVG 区间 → 显形（widget 撤下）')
  passed++
  console.log('[SVG/MathML][PASS] C 行内 SVG 混排：前后正文保留、光标触及显形')

  // ---- 场景 D：Reading 模式全量观测（绘制层证据）----
  await page.evaluate(() => window.setSvgMathMode('reading'))
  await settle(500)
  a = await readA()
  assert.ok(a.svgs >= 5, `Reading：svg 全量渲染（实际 ${a.svgs}）`)
  assert.ok(a.shapeHit, 'SVG 图形 elementFromPoint 真实命中（非 DOM 存在性）')
  assert.match(a.gradientFill ?? '', /^url\(/, `渐变引用进入 computed fill（实际 ${a.gradientFill}）`)
  assert.ok(a.gradientRectSize && a.gradientRectSize.w > 80, `渐变 rect 有布局尺寸（实际 ${JSON.stringify(a.gradientRectSize)}）`)
  assert.equal(a.textPainted, true, 'SVG 文字有布局尺寸（文字绘制）')
  assert.equal(a.textContent, 'SVG 文字', 'SVG 文字内容保真')
  assert.equal(a.foreignObjectDivColor, 'rgb(178, 34, 34)', `foreignObject 内 HTML 内联样式绘制（实际 ${a.foreignObjectDivColor}）`)
  assert.equal(a.foreignObjectDivPainted, true, 'foreignObject 内 div 有布局尺寸')
  assert.equal(a.clsFillComputed, 'rgb(0, 85, 170)', `本篇 style 类选择器命中 SVG 元素（实际 ${a.clsFillComputed}）`)
  assert.match(a.svgImageSrc ?? '', /^data:image\/png;base64,/, `SVG image href 经资源通道解析应用（实际 ${a.svgImageSrc}）`)
  const resLog = await page.evaluate(() => window.svgMathResourceLog())
  assert.ok(resLog.some((e) => e.kind === 'htmlResource.request' && e.url === 'svgpic.png'),
    `SVG image href 走 htmlResource 独立通道（实际 ${JSON.stringify(resLog)}）`)
  // MathML（本机 Chromium——能力矩阵记录点）
  assert.equal(a.maths, 1, 'MathML 块渲染在场')
  assert.ok(a.mathPainted && a.mathPainted.w > 8 && a.mathPainted.h > 8,
    `MathML 结构有布局尺寸（实际 ${JSON.stringify(a.mathPainted)}）`)
  assert.equal(a.mathHasMfrac, true, 'MathML 结构（mfrac）保真')
  assert.equal(a.scriptCount, 0, 'Reading 净化负向：script 零残留')
  passed++
  console.log('[SVG/MathML][PASS] D Reading：渐变/文字/foreignObject/类命中/资源装载/MathML 实际绘制')

  // ---- 场景 E：B 嵌入（生产装配链）：相同 ID 不串目标 + CSS 协同 ----
  await page.evaluate(([html, css]) => window.mountSvgMathB(html, css, {}), [B_HTML, B_CSS])
  await settle(400)
  const b = await page.evaluate(() => window.readSvgMathB())
  assert.ok(b, 'B 渲染在场')
  assert.ok(b.ids.length >= 2 && b.ids.every((id) => /^vsref_.*--(shared|bstroke)$/.test(id)),
    `B 产物 id 全部前缀化（实际 ${JSON.stringify(b.ids)}）`)
  assert.match(b.fillAttr ?? '', /^url\(#vsref_/, `B 的 url(#shared) 引用已前缀化（实际 ${b.fillAttr}）`)
  assert.match(b.fillComputed ?? '', /url\("#?vsref_/, `B 渐变 computed fill 指向前缀目标——不串 A（实际 ${b.fillComputed}）`)
  assert.equal(b.rectPainted, true, 'B 渲染目标有布局尺寸')
  assert.equal(b.strokeComputed, 'rgb(170, 0, 170)', `B 的 #bstroke CSS id 选择器协同命中（实际 ${b.strokeComputed}）`)
  assert.ok((b.styleProduct ?? '').includes('--bstroke'), `B 样式产物含 id 选择器协同（实际 ${b.styleProduct}）`)
  assert.match(b.styleProduct ?? '', /url\(("#?)vsref_/, `B 样式产物含 url(#id) 协同（实际 ${b.styleProduct}）`)
  // A 侧 id 未被前缀化（A 保持原生语义）
  const aSharedId = await page.evaluate(() => {
    const reading = document.querySelector('.vsidian-view-reading')
    const g = reading?.querySelector('linearGradient[id="shared"]')
    return g ? g.id : null
  })
  assert.equal(aSharedId, 'shared', 'A 主文档 id 零改写（B 单侧前缀化）')
  passed++
  console.log('[SVG/MathML][PASS] E B 嵌入：相同 ID 不串目标 + CSS #id/url(#id) 协同命中')

  // ---- 场景 F：释放无残留 ----
  await page.evaluate(() => window.unmountSvgMathB())
  await settle(200)
  const bGone = await page.evaluate(() => ({
    host: document.querySelector('.vsidian-svgmathml-b-host') === null,
    product: document.querySelector('style[data-vsidian-doc-style]:not([data-vsidian-doc-style="doc"])') === null,
  }))
  assert.equal(bGone.host, true, 'B 挂载宿主移除')
  assert.equal(bGone.product, true, 'B 样式产物随释放回收（无残留规则）')
  passed++
  console.log('[SVG/MathML][PASS] F B 释放：宿主与样式产物无残留')

  assert.equal(errors.length, 0, `全程零页面异常（实际 ${JSON.stringify(errors)}）`)
} finally {
  await browser.close()
}
console.log(`[SVG/MathML] 全部 ${passed} 组断言通过`)
