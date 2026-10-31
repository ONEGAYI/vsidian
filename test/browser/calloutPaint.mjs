// Callout 双模式绘制层回归（#653/T02）：真实 Chromium + 生产控制器 + 产物
// CSS。断言用户看到的东西（AGENTS 视觉层断言——不以 DOM 存在性代替绘制）：
// - live 行级形态：行类/data-callout/标记隐藏 widget/标题文字可见；
//   光标触及标题行显形源码、离开恢复；正文键入外框保留
// - 阅读真实容器：div.callout > .callout-title(.callout-icon +
//   .callout-title-inner) + .callout-content 结构与文字可见
// - 明暗主题绘制层：底色双通道（内置标准色走渐变、片段三元组走 bgc）、
//   callout 行替代该层引用紫条、普通引用与代码内伪标记不回归
// - 跨行拖选坐标逐字节等于源区间
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutPaint/calloutPaint.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutPaintFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const DOC = [
  '> [!note] 提示标题',
  '> 正文第一行',
  '> 正文第二行',
  '',
  '> 普通引用行',
  '',
  '> [!note] 代码内伪标记',
  '> ```md',
  '> [!tip] 伪标记字面',
  '> ```',
  '',
  '结尾段落。',
].join('\n')

try {
  const page = await browser.newPage({ viewport: { width: 720, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initCallout(text), DOC)
  // 光标落在文档尾（不触及任何标题行——触及即显形源码）；定位走
  // view.locate 生产链路（multicursor 同款口径）
  const docLength = await page.evaluate(() => window.controller.getView().state.doc.length)
  await page.evaluate((off) => window.locateCallout(off), docLength)

  // ---- live：形态与显隐 ----
  const liveLines = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].map((el) => ({
      cls: el.className,
      callout: el.getAttribute('data-callout'),
      text: el.textContent ?? '',
    })))
  const titleLine = liveLines.find((l) => l.text.includes('提示标题'))
  assert.ok(titleLine, 'live 标题行应存在')
  for (const cls of ['callout-title', 'vsidian-callout-first', 'vsidian-callout-quiet']) {
    assert.ok(titleLine.cls.split(' ').includes(cls), `标题行应含 ${cls}: ${titleLine.cls}`)
  }
  // T05（#673）：.callout 主类与 data-callout 迁 wrapper 元素（行级不挂）
  assert.ok(!titleLine.cls.split(' ').includes('callout'), `标题行不应再挂行级主类: ${titleLine.cls}`)
  const wrapPaint = await page.evaluate(() => {
    const w = [...document.querySelectorAll('.vsidian-callout-wrap.callout')]
      .find((el) => (el.textContent ?? '').includes('提示标题'))
    return w ? { type: w.getAttribute('data-callout'), depth: w.getAttribute('data-callout-depth') } : null
  })
  assert.ok(wrapPaint, 'wrapper 容器应在场')
  assert.equal(wrapPaint.type, 'note')
  assert.equal(wrapPaint.depth, '1')
  // 标记隐藏：标题行可见文字不含 [!note]（widget 图标替代）；标题文字可见
  assert.ok(!titleLine.text.includes('[!note]'), `标记应隐藏: ${titleLine.text}`)
  assert.ok(titleLine.text.includes('提示标题'), '标题文字应可见')
  const bodyLine = liveLines.find((l) => l.text.includes('正文第一行'))
  assert.ok(bodyLine?.cls.split(' ').includes('callout-content'), '正文行应有 callout-content')
  const lastBody = liveLines.find((l) => l.text.includes('正文第二行'))
  assert.ok(lastBody?.cls.split(' ').includes('vsidian-callout-last'), '末行应有圆角类')
  const iconCount = await page.locator('.cm-line .callout-icon').count()
  assert.equal(iconCount, 2, '两个 note 的标题行各应有一个图标 widget')

  // 标记 widget 真实绘制（computed：mask 图标有背景色，尺寸非零）
  const iconPaint = await page.locator('.cm-line .callout-icon').first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { bg: s.backgroundColor, w: s.width, h: s.height, mask: s.maskImage ?? s.webkitMaskImage }
  })
  assert.notEqual(iconPaint.bg, 'rgba(0, 0, 0, 0)', '图标底色应绘制（类型色）')
  assert.ok(parseFloat(iconPaint.w) > 0 && parseFloat(iconPaint.h) > 0, '图标应有非零尺寸')
  assert.ok(String(iconPaint.mask).includes('data:image/svg+xml'), '图标应消费内联 SVG mask')

  // 光标进入标题行：源码显形（[!note] 可见、图标 widget 退场）
  const titlePos = await page.evaluate(() => {
    const view = window.controller.getView()
    return view.state.doc.toString().indexOf('提示标题')
  })
  await page.evaluate((pos) => window.locateCallout(pos), titlePos)
  let revealed = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].find((el) => (el.textContent ?? '').includes('提示标题'))?.textContent ?? '')
  assert.ok(revealed.includes('[!note]'), `触及标题行应显形源码: ${revealed}`)
  assert.equal(await page.locator('.cm-line .callout-icon').count(), 1, '显形后该行图标退场（仅剩代码内那条的 callout）')
  // 离开恢复隐藏
  await page.evaluate(() => window.locateCallout(window.controller.getView().state.doc.length))
  revealed = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].find((el) => (el.textContent ?? '').includes('提示标题'))?.textContent ?? '')
  assert.ok(!revealed.includes('[!note]'), '离开后标记应恢复隐藏')

  // 正文键入：外框保留（行类不变、文档变更成功）。先真实点击聚焦
  // （listEditing 同款序列），再经 dispatch 精确定位光标
  await page.click('.cm-content')
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('正文第一行') + 5))
  await page.keyboard.type('入')
  // 等 CM6 行 DOM 更新落地（state 已变，行文本绘制在下一帧）
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const typed = await page.evaluate(() => {
    const view = window.controller.getView()
    const doc = view.state.doc.toString()
    const el = [...document.querySelectorAll('.cm-line')].find((e) => (e.textContent ?? '').includes('正文第一行入'))
    return {
      doc, cls: el?.className ?? '',
      wrapType: el?.closest('.vsidian-callout-wrap')?.getAttribute('data-callout') ?? null,
    }
  })
  assert.ok(typed.doc.includes('正文第一行入'), '键入应写入文档')
  assert.ok(typed.cls.split(' ').includes('callout-content'), `键入后外框应保留: ${typed.cls}`)
  assert.equal(typed.wrapType, 'note')

  // 跨行拖选：标题行 → 正文行，选区坐标逐字节等于源区间
  const selectDoc = await page.evaluate(() => window.controller.getView().state.doc.toString())
  const from = selectDoc.indexOf('提示标题')
  const to = selectDoc.indexOf('正文第二行') + 5
  const pointAt = (offset) => page.evaluate((off) => {
    const rect = window.controller.getView().coordsAtPos(off)
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  }, offset)
  const start = await pointAt(from)
  const end = await pointAt(to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
  assert.deepEqual(await page.evaluate(() => {
    const range = window.controller.getView().state.selection.main
    return { from: range.from, to: range.to }
  }), { from, to }, '拖选必须落在源区间')

  // ---- 明暗主题绘制层（live）----

  /** 内置标准色通道：渐变绘制、bgc 透明 */
  const liveRowPaint = () => page.evaluate(() => {
    // T05：容器底色在 wrapper（行级让位为透明）
    const el = document.querySelector('.vsidian-callout-wrap.callout')
    const s = getComputedStyle(el)
    return { bgc: s.backgroundColor, img: s.backgroundImage, shadow: s.boxShadow }
  })
  let paint = await liveRowPaint()
  // 内置标准色走渐变通道（bgc 的 rgba(#hex, .1) 非法 → 透明；T01 §6.2 拆属性
  // 双通道的互斥实测形态）
  assert.ok(paint.img !== 'none', `标准色应由渐变通道绘制: img=${paint.img}`)
  assert.equal(paint.bgc, 'rgba(0, 0, 0, 0)', `标准色代入 rgba 非法时 bgc 应失效透明: ${paint.bgc}`)
  assert.ok(/linear-gradient\(oklch\([^)]*\/ 0\.1\)/.test(paint.img),
    `暗色主题底色应为 #027aff 的 color-mix 渐变（引擎预计算为 oklch 形态）: ${paint.img}`)
  const darkImg = paint.img
  // 紫条被替代：#657/T06 起 quiet 行 box-shadow 通道承载 border 左缘近似
  //（默认 0 宽零绘制）——断言不绘制引用紫条色（与普通引用行的紫条断言
  // 同款口径）
  // 紫条替代：wrapper 容器无 box-shadow 紫条（行级 quiet 让位后为零阴影）
  assert.ok(!/rgb\(167, 139, 250\)/.test(paint.shadow), `callout 容器不应绘制引用紫条: ${paint.shadow}`)
  // 亮色主题：底色计算随 --callout-default 变化（#086ddd）
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  paint = await liveRowPaint()
  assert.notEqual(paint.img, darkImg,
    `亮色主题底色计算应随 --callout-default 变化（#086ddd）: ${paint.img}`)
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })

  // ---- 片段三元组通道：--callout-color 覆盖为 RGB 三元组 → bgc 绘制 ----
  // .callout 在两侧都是容器挂点（Live wrapper / 阅读容器）——单选择器双命中
  await page.addStyleTag({ content: '#app .callout { --callout-color: 255, 0, 0; }' })
  paint = await liveRowPaint()
  assert.equal(paint.bgc, 'rgba(255, 0, 0, 0.1)', `三元组通道应由 bgc 绘制: ${paint.bgc}`)
  assert.equal(paint.img, 'none', `三元组代入 color-mix 非法时渐变通道应失效: ${paint.img}`)

  // ---- 普通引用不回归（紫条仍在）；代码内伪标记按字面 ----
  const quotePaint = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.cm-line')].find((e) =>
      (e.textContent ?? '').includes('普通引用行'))
    return { shadow: getComputedStyle(el).boxShadow, cls: el.className }
  })
  assert.ok(/rgb\(167, 139, 250\)/.test(quotePaint.shadow), `普通引用紫条应保留: ${quotePaint.shadow}`)
  assert.ok(!quotePaint.cls.split(' ').includes('callout'), '普通引用行不应挂 callout 类')
  const pseudo = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].map((e) => e.textContent ?? ''))
  const pseudoLine = pseudo.find((t) => t.includes('伪标记字面'))
  assert.ok(pseudoLine?.includes('[!tip]'), '代码内伪标记应字面可见')
  const pseudoCalloutLine = pseudo.find((t) => t.includes('代码内伪标记'))
  assert.equal(await page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-callout-wrap')].find((e) => (e.textContent ?? '').includes('代码内伪标记'))?.getAttribute('data-callout')), 'note',
  '含代码块的容器 data-callout 仍取首段声明（不误判围栏内标记）')

  // ---- reading：真实容器结构与绘制 ----
  await page.evaluate(() => window.setCalloutMode('reading'))
  await page.waitForSelector('.vsidian-view-reading .callout')
  const reading = await page.evaluate(() => {
    const root = document.querySelector('.vsidian-view-reading .callout')
    if (!root) return null
    const s = getComputedStyle(root)
    return {
      callout: root.getAttribute('data-callout'),
      titleText: root.querySelector('.callout-title .callout-title-inner')?.textContent ?? '',
      contentText: root.querySelector('.callout-content')?.textContent ?? '',
      hasIcon: root.querySelector('.callout-title .callout-icon') !== null,
      radius: s.borderRadius,
      bgc: s.backgroundColor,
      img: s.backgroundImage,
      pad: s.paddingTop,
    }
  })
  assert.ok(reading, '阅读侧应发射 .callout 容器')
  assert.equal(reading.callout, 'note')
  assert.equal(reading.titleText, '提示标题')
  assert.ok(reading.contentText.includes('正文第一行入'), '正文应真实位于 .callout-content 内')
  assert.ok(reading.hasIcon, '阅读侧标题应有 .callout-icon')
  assert.equal(reading.radius, '4px', `圆角应取 --callout-radius: ${reading.radius}`)
  assert.ok(/rgba?\(/.test(reading.bgc) && reading.bgc !== 'rgba(0, 0, 0, 0)', `阅读容器底色应绘制: ${reading.bgc} ${reading.img}`)
  assert.equal(reading.pad, '12px', `容器上下内边距按 --callout-padding: ${reading.pad}`)
  // 普通引用在阅读侧仍为 blockquote（tag 改形不误伤）
  assert.ok(await page.locator('.vsidian-view-reading blockquote').count() >= 1, '普通引用应保留 blockquote')

  // 仅标题形态 + 默认标题派生（Note）
  await page.evaluate(() => {
    window.controller.handleHostMessage({ kind: 'init', sessionId: 'callout', docUri: 'file:///callout.md', version: 2, text: '> [!note]\n> 正文' })
  })
  const defaultTitle = await page.evaluate(() =>
    document.querySelector('.vsidian-view-reading .callout-title .callout-title-inner')?.textContent ?? '')
  assert.equal(defaultTitle, 'Note', '无显式标题应呈现派生默认标题 Note')
  const unknown = await page.evaluate(() => {
    window.controller.handleHostMessage({ kind: 'init', sessionId: 'callout', docUri: 'file:///callout.md', version: 3, text: '> [!custom-x] 自定义\n> 正文' })
    const root = document.querySelector('.vsidian-view-reading .callout')
    return { id: root?.getAttribute('data-callout'), title: root?.querySelector('.callout-title-inner')?.textContent }
  })
  assert.equal(unknown.id, 'custom-x', '未知类型原标识进 data-callout')
  assert.equal(unknown.title, '自定义', '显式标题照常呈现')

  // 切回 live：行级形态恢复（模式往返不丢）
  await page.evaluate(() => window.setCalloutMode('live'))
  const backToLive = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-line.callout-title')]
      .find((e) => e.closest('.vsidian-callout-wrap')?.getAttribute('data-callout') === 'custom-x')
    return { cls: line?.className ?? '', wrap: !!line?.closest('.vsidian-callout-wrap.callout') }
  })
  assert.ok(backToLive.cls.split(' ').includes('callout-title'), `模式往返后 live 行级形态应恢复: ${backToLive.cls}`)
  assert.ok(backToLive.wrap, '模式往返后 wrapper 容器恢复')

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('calloutPaint: 全部断言通过（双视图 × 明暗主题 × 双通道底色 × 显隐/输入/拖选）')
} finally {
  await browser.close()
}
