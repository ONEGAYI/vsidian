// 块级原生 HTML 的原生浏览器回归（#567/T02）：真实布局（Chromium）下经
// 生产控制器装配验证——Live 片段替换装饰（悬停边框 + 编辑按钮、净化 HTML
// 绘制）、普通点击与编辑按钮两入口选中完整源码、方向键进出保留落点、
// 正反向跨块选择不扩选、多选区不坍缩、纯 <style> 块常显不占位、畸形
// 边界不吞邻接、净化负向（脚本/事件/伪造锚点不进场不执行）、阅读态
// 渲染与 docScope 标记、显隐切换零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'liveHtml/liveHtml.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveHtmlFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：表格块（首条用户路径，含表头行——#613 边框/表头底色断言载体）
 * + 纯 style 块 + 恶意载荷块 + 未闭合块（#613 可覆盖性验证独立装载第二
 * 文档——文档 <style> 按 docScope 全篇生效，掺进主文档会同时改写默认
 * 表格块，两组断言互扰） */
const TABLE_BLOCK = [
  '<table>',
  '  <tr>',
  '    <th>表头甲</th>',
  '    <th>表头乙</th>',
  '  </tr>',
  '  <tr>',
  '    <td colspan="2" rowspan="3">合并单元格</td>',
  '    <td>普通格</td>',
  '  </tr>',
  '</table>',
].join('\n')
const EVIL_BLOCK = '<div onclick="evil()">可点击</div><script>window.__htmlEvilRan = true</script>'
const OVERRIDE_TABLE = '<table>\n  <tr>\n    <td>覆盖态单元格</td>\n  </tr>\n</table>'
const OVERRIDE_DOC = [
  '覆盖篇首段。',
  '',
  // 覆盖按 CSS 元素对应语义声明在 table/th/td 三个元素上：内置默认的
  // 边框声明在 th/td（collapse 模式分隔线由 cell 边框绘制，table 自身
  // 只画外圈），`table {}` 单选择器本就不与 td 声明竞争
  '<style>table, th, td { border: none }</style>',
  OVERRIDE_TABLE,
  '',
  '收尾段落。',
].join('\n')
const DOC = [
  '开篇段落。',
  '',
  TABLE_BLOCK,
  '',
  '中间段落。',
  '',
  '<style>',
  '.x { color: red; }',
  '</style>',
  '',
  '样式后段落。',
  '',
  EVIL_BLOCK,
  '',
  '<div>',
  '  未闭合内容',
  '',
  '邻接段落照常。',
].join('\n')

const HTML_FROM = DOC.indexOf(TABLE_BLOCK)
const HTML_TO = HTML_FROM + TABLE_BLOCK.length
const EVIL_FROM = DOC.indexOf(EVIL_BLOCK)
const EVIL_TO = EVIL_FROM + EVIL_BLOCK.length
const STYLE_X_BLOCK = '<style>\n.x { color: red; }'
const UNCLOSED_FROM = DOC.indexOf('<div>\n  未闭合内容')

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

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
  await page.evaluate((text) => window.initLiveHtmlDoc(text), DOC)
  await page.locator('.vsidian-live-html').first().waitFor({ timeout: 5000 })

  const editRequestCount = () => page.evaluate(() =>
    window.liveHtmlSent().filter((m) => m.kind === 'edit.request').length)
  const reads = () => page.evaluate(() => window.readLiveHtmls())
  const spans = () => page.evaluate(() => window.liveHtmlSpanInfo())
  const selection = () => page.evaluate(() => window.liveHtmlSelection())
  const linePainted = (t) => page.evaluate((n) => window.liveHtmlLinePainted(n), t)

  // ---- 场景 A：隐形态挂载 + 净化绘制 + 抑制边界（纯 style/恶意/未闭合） ----
  // 初始光标在文档起点（块外）：表格块渲染 widget；纯 style 块与围栏外
  // 恶意块各自有边界；未闭合块渲染在自身边界内
  let hosts = await reads()
  assert.equal(hosts.length, 3, '表格 + 恶意 + 未闭合三块挂 widget（纯 style 不占位）')
  const tableHost = hosts.find((h) => h.from === HTML_FROM)
  assert.ok(tableHost, '表格宿主在场')
  assert.ok(tableHost.hostHeight > 20, `宿主有真实高度（实际 ${tableHost.hostHeight}）`)
  assert.equal(tableHost.tablePresent, true, '净化 table 原生语义 DOM')
  assert.equal(tableHost.mergedCell, true, '合并单元格在场')
  assert.equal(tableHost.hitInside, true, '合并格中心命中落在宿主内（绘制层）')
  assert.equal(tableHost.editButton, true, '右上角编辑按钮在场')
  assert.equal(tableHost.popupButton, false, '无弹窗按钮（HTML 块仅 edit）')
  assert.equal(tableHost.tooltip, zhCn['html.blockTooltip'], '宿主悬停词走 i18n 词条')
  assert.equal(tableHost.position, 'relative', '宿主承担按钮定位上下文')
  // #613 默认表格样式（绘制层计算值——样式注入失效即红，非 DOM 存在性）
  assert.equal(tableHost.cellBorderStyle, 'solid', `默认边框绘制（实际 ${tableHost.cellBorderStyle}）`)
  assert.ok(Number.parseFloat(tableHost.cellBorderWidth) >= 1,
    `边框有宽度（实际 ${tableHost.cellBorderWidth}）`)
  assert.notEqual(tableHost.headerBg, 'rgba(0, 0, 0, 0)', `表头底色绘制（实际 ${tableHost.headerBg}）`)
  assert.equal(await linePainted('<table>'), false, '隐形态源文不绘制（区间替换）')
  const spanList = await spans()
  assert.equal(spanList.length, 4, '块表四条（表格/样式/恶意/未闭合）')
  assert.equal(spanList.filter((s) => DOC.slice(s.from, s.to).startsWith(STYLE_X_BLOCK)).length, 1, '纯 style 块在表（常显不占位）')
  // 恶意块：净化负向（无 script/事件/伪造锚点；脚本未执行）
  const evilHost = hosts.find((h) => h.from === EVIL_FROM)
  assert.ok(evilHost, '恶意块宿主在场（可安全部分渲染）')
  assert.equal(evilHost.scriptCount, 0, 'script 不进场')
  assert.equal(evilHost.forgedAnchor, false, '伪造系统锚点不进场')
  assert.ok(evilHost.text.includes('可点击'), '可安全部分照常渲染')
  const evilRan = await page.evaluate(() => window.__htmlEvilRan === true)
  assert.equal(evilRan, false, '内联脚本未执行（CSP + 净化双闸）')
  // 未闭合块：渲染边界在自身行内，邻接段落照常
  const unclosedHost = hosts.find((h) => h.from === UNCLOSED_FROM)
  assert.ok(unclosedHost, '未闭合块宿主在场')
  assert.equal(await linePainted('邻接段落照常。'), true, '空行后邻接段落照常绘制（不被吞）')
  // 未闭合块的源文标记不绘制：行内不含 '<div>' 原始文本且挂宿主
  //（linePainted 的整行文本判据在此失真——渲染 DOM 文本恰与源文同文）
  const unclosedRendered = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .find((l) => (l.textContent ?? '').includes('未闭合内容'))
    if (!line) return null
    return { host: line.querySelector('.vsidian-live-html') !== null,
      rawTag: (line.textContent ?? '').includes('<div>') }
  })
  assert.ok(unclosedRendered, '未闭合块所在行在场')
  assert.equal(unclosedRendered.host, true, '未闭合块渲染态挂宿主')
  assert.equal(unclosedRendered.rawTag, false, '未闭合块源文标记不绘制')
  passed++
  console.log('[LiveHTML][PASS] 隐形态挂载 + 净化绘制 + 边界矩阵（纯 style/恶意/未闭合）')

  // ---- 场景 B：真实点击渲染内容 → 选中完整源码 ----
  await page.evaluate(() => window.setLiveHtmlCursor(2))
  await page.evaluate(() => window.focusLiveHtml())
  const cellBox = await page.locator('.vsidian-live-html td').first().boundingBox()
  assert.ok(cellBox, '合并格有边界盒')
  await page.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2)
  await page.waitForTimeout(120)
  let sel = await selection()
  assert.equal(sel.length, 1, '单选区')
  assert.equal(Math.min(sel[0].anchor, sel[0].head), HTML_FROM, '点击后选区起点 = 片段起点')
  assert.equal(Math.max(sel[0].anchor, sel[0].head), HTML_TO, '点击后选区终点 = 片段终点')
  assert.equal(await linePainted('<table>'), true, '源码显形绘制（首行）')
  hosts = await reads()
  assert.equal(hosts.filter((h) => h.from === HTML_FROM).length, 0, '触及后 widget 撤下')
  passed++
  console.log('[LiveHTML][PASS] 点击渲染内容 → 选中完整源码并显形')

  // ---- 场景 C：离开恢复渲染 + 编辑按钮入口 ----
  await page.evaluate((p2) => window.setLiveHtmlCursor(p2), 2)
  await page.waitForTimeout(120)
  hosts = await reads()
  assert.equal(hosts.filter((h) => h.from === HTML_FROM).length, 1, '离开后恢复渲染')
  const btn = page.locator('.vsidian-live-html .vsidian-graphic-chrome-edit').first()
  await btn.click()
  await page.waitForTimeout(120)
  sel = await selection()
  assert.equal(Math.min(sel[0].anchor, sel[0].head), HTML_FROM, '编辑按钮入口同源：起点 = 片段起点')
  assert.equal(Math.max(sel[0].anchor, sel[0].head), HTML_TO, '编辑按钮入口同源：终点 = 片段终点')
  passed++
  console.log('[LiveHTML][PASS] 离开恢复渲染 + 编辑按钮入口选中完整源码')

  // ---- 场景 D：真实方向键进出（键盘落点保留） ----
  await page.evaluate((p2) => window.setLiveHtmlCursor(p2), DOC.indexOf('中间段落。'))
  await page.evaluate(() => window.focusLiveHtml())
  await page.keyboard.press('ArrowUp') // 空行
  await page.keyboard.press('ArrowUp') // 进入 </table> 行（区间端点）
  sel = await selection()
  const afterKeyIn = sel[0].head
  assert.ok(afterKeyIn >= HTML_FROM && afterKeyIn <= HTML_TO,
    `键盘进入落在片段区间内（实际 ${afterKeyIn}）`)
  assert.equal(await linePainted('  </table>'), true, '显形后光标所在源码行绘制')
  // 逐键向下离开（进入行不定——显形后行高变动影响 CM6 落点，逐键推进
  // 直到选区离开区间，钉「离开恢复渲染」而非钉固定步数）
  let leftRange = false
  for (let step = 0; step < 10 && !leftRange; step++) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(50)
    const s = await selection()
    leftRange = s[0].head < HTML_FROM || s[0].head > HTML_TO
  }
  assert.ok(leftRange, '方向键可离开片段区间')
  hosts = await reads()
  assert.equal(hosts.filter((h) => h.from === HTML_FROM).length, 1, '方向键离开后恢复渲染')
  passed++
  console.log('[LiveHTML][PASS] 方向键进出：落点保留在区间内、离开恢复渲染')

  // ---- 场景 E：正反向跨块选择不扩选（shift+click 两向） ----
  // 正向：从表格前行选到中间段落行之后（选区横跨整块）
  const beforeLine = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.cm-content .cm-line'))
    const i = els.findIndex((l) => (l.textContent ?? '').includes('开篇段落'))
    return els[i] ? els[i].getBoundingClientRect() : null
  })
  const afterLine = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.cm-content .cm-line'))
    const i = els.findIndex((l) => (l.textContent ?? '').includes('中间段落'))
    return els[i] ? els[i].getBoundingClientRect() : null
  })
  assert.ok(beforeLine && afterLine, '跨块两行在场')
  await page.evaluate(() => window.focusLiveHtml())
  await page.mouse.click(beforeLine.x + 4, beforeLine.y + beforeLine.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.click(afterLine.x + afterLine.width - 4, afterLine.y + afterLine.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  sel = await selection()
  // 快照形态是 {anchor, head}——from/to 就地派生
  const spanOf = (r) => ({ from: Math.min(r.anchor, r.head), to: Math.max(r.anchor, r.head) })
  const span = spanOf(sel[0])
  assert.equal(sel.length, 1, '跨块选区仍单 range')
  assert.ok(span.from <= HTML_FROM && span.to >= HTML_TO, '选区横跨片段（端点在块外）')
  assert.notEqual(span.from, HTML_FROM, '选区起点未被扩到片段起点')
  assert.notEqual(span.to, HTML_TO, '选区终点未被扩到片段终点')
  hosts = await reads()
  assert.equal(hosts.filter((h) => h.from === HTML_FROM).length, 0, '跨块选区相交显形（不扩选）')
  assert.equal(await linePainted('<table>'), true, '显形后源文可复制')
  // 反向：从中间段落行选回表格前行。正向选区撤销后 widget 恢复渲染、
  // 布局下移——坐标须在恢复后重新捕获（陈旧坐标会点进渲染区触发完整
  // 选区语义，污染跨块场景）
  await page.waitForTimeout(150)
  const rectOf = async (needle) => page.evaluate((n) => {
    const els = Array.from(document.querySelectorAll('.cm-content .cm-line'))
    const i = els.findIndex((l) => (l.textContent ?? '').includes(n))
    return els[i] ? els[i].getBoundingClientRect() : null
  }, needle)
  const afterFresh = await rectOf('中间段落')
  const beforeFresh = await rectOf('开篇段落')
  assert.ok(afterFresh && beforeFresh, '反向两行在场（布局重捕）')
  await page.mouse.click(afterFresh.x + 4, afterFresh.y + afterFresh.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.click(beforeFresh.x + beforeFresh.width - 4, beforeFresh.y + beforeFresh.height / 2)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  sel = await selection()
  const rspan = spanOf(sel[0])
  assert.equal(sel.length, 1, '反向跨块选区仍单 range')
  assert.ok(rspan.from <= HTML_FROM && rspan.to >= HTML_TO, '反向选区同样横跨')
  assert.notEqual(rspan.from, HTML_FROM, '反向选区起点未被扩选')
  assert.notEqual(rspan.to, HTML_TO, '反向选区终点未被扩选')
  passed++
  console.log('[LiveHTML][PASS] 正反向跨块选择：显形且端点不扩选')

  // ---- 场景 F：多选区不坍缩（无关 range 显形互不影响） ----
  await page.evaluate((ranges) => window.setLiveHtmlRanges(ranges), [
    [2, 2],
    [HTML_FROM + 2, HTML_FROM + 2],
  ])
  await page.waitForTimeout(120)
  sel = await selection()
  assert.equal(sel.length, 2, '多选区两 range 保持（不坍缩）')
  assert.equal(Math.min(sel[0].anchor, sel[0].head), 2, '无关 range 端点不变')
  hosts = await reads()
  assert.equal(hosts.filter((h) => h.from === HTML_FROM).length, 0, '任一 range 命中即显形')
  passed++
  console.log('[LiveHTML][PASS] 多选区：任一命中显形、无关选区不坍缩')

  // ---- 场景 G：纯 <style> 块常显不占位 ----
  const styleVisible = await linePainted('.x { color: red; }')
  assert.equal(styleVisible, true, '纯 style 块源码常显（Q6A）')
  const styleHosts = await page.evaluate(() =>
    document.querySelectorAll('.vsidian-live-html').length)
  await page.evaluate(() => window.setLiveHtmlCursor(2))
  await page.waitForTimeout(120)
  const hostsAfterLeave = await reads()
  // style 块从未出现在宿主列表（无论光标在哪）
  assert.equal(hostsAfterLeave.every((h) => DOC.slice(h.from, h.to).startsWith(STYLE_X_BLOCK) === false), true,
    '纯 style 块恒不发射 widget')
  passed++
  console.log('[LiveHTML][PASS] 纯 <style> 块：源码常显不占位')

  // ---- 场景 H：悬停边框（绘制层 computed） ----
  const hostLoc = page.locator('.vsidian-live-html').first()
  await hostLoc.hover()
  await page.waitForTimeout(350) // 按钮透明度 0.12s 过渡完成后取值
  const hoverOutline = await page.evaluate(() => {
    const host = document.querySelector('.vsidian-live-html')
    return host ? getComputedStyle(host).outlineColor : ''
  })
  assert.notEqual(hoverOutline, 'rgba(0, 0, 0, 0)', `悬停边框绘制（实际 ${hoverOutline}）`)
  const btnOpacity = await page.evaluate(() => {
    const btn = document.querySelector('.vsidian-live-html .vsidian-graphic-chrome-edit')
    return btn ? getComputedStyle(btn).opacity : ''
  })
  assert.ok(Number.parseFloat(btnOpacity) > 0.99, `悬停时编辑按钮显现（实际 ${btnOpacity}）`)
  passed++
  console.log('[LiveHTML][PASS] 悬停边框与编辑按钮显现（绘制层）')

  // ---- 场景 I：零写回（显隐切换不产生编辑事务） ----
  assert.equal(await editRequestCount(), 0, '全程零 edit.request（显隐切换零写回）')
  const docText = await page.evaluate(() => window.liveHtmlDocText())
  assert.equal(docText, DOC, '文档全文逐字节不变（不序列化浏览器修复 DOM）')
  passed++
  console.log('[LiveHTML][PASS] 显隐切换零写回、源文逐字节不变')

  // ---- 场景 J：阅读态渲染（净化 + docScope 标记 + 隐藏纯 style） ----
  await page.evaluate((mode) => window.setLiveHtmlMode(mode), 'reading')
  await page.locator('.vsidian-reading-html').first().waitFor({ timeout: 5000 })
  await page.waitForTimeout(150)
  const readingBlocks = await page.evaluate(() => window.readReadingHtmls())
  // 四个块元素在场：表格/恶意/未闭合渲染 + 纯 style 零占位隐藏（Q6A 的
  // Reading 对偶——元素在场 display:none，阅读区不可见）
  assert.equal(readingBlocks.length, 4, '阅读态四块元素（表格/恶意/未闭合 + 纯 style 隐藏）')
  assert.equal(readingBlocks.filter((b) => b.display === 'none').length, 1, '纯 style 块零占位隐藏')
  const readingTable = readingBlocks.find((b) => b.tablePresent)
  assert.ok(readingTable, '阅读态表格块渲染')
  assert.equal(readingTable.mergedCell, true, '阅读态合并单元格在场')
  assert.equal(readingTable.hitInside, true, '阅读态合并格中心命中（绘制层）')
  assert.equal(readingTable.docScope, 'doc', '主文档 docScope 标记在场（T04 基座）')
  assert.equal(readingTable.scriptCount, 0, '阅读态 script 不进场')
  // #613 阅读态默认样式（绘制层计算值——样式注入失效即红）
  assert.equal(readingTable.cellBorderStyle, 'solid', `阅读态默认边框绘制（实际 ${readingTable.cellBorderStyle}）`)
  assert.notEqual(readingTable.headerBg, 'rgba(0, 0, 0, 0)', `阅读态表头底色绘制（实际 ${readingTable.headerBg}）`)
  assert.equal(await page.evaluate(() => window.liveHtmlSent().filter((m) => m.kind === 'edit.request').length), 0,
    '模式切换零写回')
  passed++
  console.log('[LiveHTML][PASS] 阅读态渲染：合并单元格绘制 + docScope + 净化负向')

  // ---- 场景 K（#613）：文档 <style> 裸标签覆盖默认边框（可覆盖性，绘制层）----
  // 文档样式按 docScope 全篇生效，覆盖验证独立装载第二文档（真实 init
  // 换文档链路，docStyle 随新文档重装载）：docStyle 产物（:where 标记
  // 前缀 + 裸标签）与内置默认同为 (0,0,1) 特异性，层叠序后置即胜——
  // 作者无需提高特异性即可改写默认表格观感
  await page.evaluate((mode) => window.setLiveHtmlMode(mode), 'live')
  await page.evaluate((text) => window.initLiveHtmlDoc(text), OVERRIDE_DOC)
  await page.locator('.vsidian-live-html').first().waitFor({ timeout: 5000 })
  await page.waitForTimeout(150)
  const overrideHosts = await reads()
  const overrideHost = overrideHosts.find((h) => (h.text ?? '').includes('覆盖态单元格'))
  assert.ok(overrideHost, '覆盖文档表格宿主在场（渲染态）')
  assert.equal(overrideHost.tablePresent, true, '覆盖文档表格渲染（净化剥 style、docStyle 走源文装载）')
  assert.equal(overrideHost.cellBorderStyle, 'none',
    `Live 文档 <style> 裸标签覆盖默认边框（实际 ${overrideHost.cellBorderStyle}）`)
  await page.evaluate((mode) => window.setLiveHtmlMode(mode), 'reading')
  // 等表格块本身：覆盖文档首个 reading-html 块是净化为空的纯 style 块
  //（display:none 恒不可见，等它可见会超时）
  await page.locator('.vsidian-reading-html table').first().waitFor({ timeout: 5000 })
  await page.waitForTimeout(150)
  const overrideReading = (await page.evaluate(() => window.readReadingHtmls()))
    .find((b) => (b.text ?? '').includes('覆盖态单元格'))
  assert.ok(overrideReading, '阅读态覆盖文档表格渲染')
  assert.equal(overrideReading.cellBorderStyle, 'none',
    `阅读态文档样式覆盖同样生效（实际 ${overrideReading.cellBorderStyle}）`)
  passed++
  console.log('[LiveHTML][PASS] 文档 <style> 裸标签覆盖默认边框（Live/Reading 双态，可覆盖性）')

  // ---- 收尾：页面错误收集 ----
  assert.deepEqual(errors, [], '无页面错误（脚本不执行、装饰切换无异常）')
  passed++
  console.log('[LiveHTML][PASS] 全程无 pageerror')
} finally {
  await browser.close()
}
console.log(`[LiveHTML] 全部通过：${passed} 组`)
