// Callout T03 浏览器回归（#654）：全类型/别名在双模式的绘制层与组合形态。
// 复用 calloutPaintFixture（生产控制器 + 产物 CSS），断言用户看到的东西：
// - 全类型 × 别名（27 个 data-callout 值）：图标 mask 绘制 + 图标颜色逐值
//   等于取证色（暗 #027aff 轮 / 亮 #086ddd 轮），行底色渐变通道绘制
// - 图标按组分派：同图标组同 mask（tip/hint/important 共 flame），不同组
//   不同 mask（tip≠note）
// - 三层嵌套：最内层 data-callout 胜出、行类逐层叠加
// - 列表容器内 callout 的真实编辑（T01 报告 §10 留给本票的缺口）：真实
//   点击聚焦 + 键入外框保留 + 跨行拖选坐标逐字节等于源区间
// - malformed 不误识别、代码内伪标记字面、callout 内表格网格行共存
// - 阅读侧：27 容器 data-callout 与类型色绘制、富标题（粗体/链接）、
//   嵌套严格容器、普通引用保持 blockquote、模式往返恢复
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutTypes/calloutTypes.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutPaintFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

/** 27 个 data-callout 值 → 取证色（obsidian-1144-callout-defaults.json；
 *  important 独立变量但默认值同 cyan；quote 固定灰不经主题轮换） */
const TYPE_COLORS = {
  note: ['#027aff', '#086ddd'], abstract: ['#53dfdd', '#00bfbc'], summary: ['#53dfdd', '#00bfbc'],
  tldr: ['#53dfdd', '#00bfbc'], info: ['#027aff', '#086ddd'], todo: ['#027aff', '#086ddd'],
  tip: ['#53dfdd', '#00bfbc'], hint: ['#53dfdd', '#00bfbc'], important: ['#53dfdd', '#00bfbc'],
  success: ['#44cf6e', '#08b94e'], check: ['#44cf6e', '#08b94e'], done: ['#44cf6e', '#08b94e'],
  question: ['#e9973f', '#ec7500'], help: ['#e9973f', '#ec7500'], faq: ['#e9973f', '#ec7500'],
  warning: ['#e9973f', '#ec7500'], caution: ['#e9973f', '#ec7500'], attention: ['#e9973f', '#ec7500'],
  failure: ['#fb464c', '#e93147'], fail: ['#fb464c', '#e93147'], missing: ['#fb464c', '#e93147'],
  danger: ['#fb464c', '#e93147'], error: ['#fb464c', '#e93147'], bug: ['#fb464c', '#e93147'],
  example: ['#a882ff', '#7852ee'], quote: ['#9e9e9e', '#9e9e9e'], cite: ['#9e9e9e', '#9e9e9e'],
}

const hexToRgb = (h) => {
  const n = parseInt(h.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/** 全类型文档：每类型一个独立容器（空行分隔），别名混排 */
const typesDoc = Object.keys(TYPE_COLORS)
  .map((t) => `> [!${t}] ${t} 标题\n> ${t} 正文`)
  .join('\n\n') + '\n'

const NESTED_DOC = [
  '> [!note] 外层',
  '> > [!tip] 中层',
  '> > > [!warning] 内层',
  '> > > 内层正文',
  '> > 中层正文',
  '> 外层正文',
  '',
].join('\n')

const LIST_DOC = [
  '- 前置条目',
  '- > [!info] 列表内标题',
  '  > 列表内正文一',
  '  > 列表内正文二',
  '- 后置条目',
  '',
].join('\n')

const MIXED_DOC = [
  '> [!] 空类型未成型',
  '> 正文',
  '',
  '> [!todo] 含表格与代码',
  '> | a | b |',
  '> | - | - |',
  '> | 1 | 2 |',
  '>',
  '> ```md',
  '> [!tip] 代码内伪标记',
  '> ```',
  '',
  '> 普通引用保持',
  '',
  '> [!example] **富标题** 与 [链接](https://example.com)',
  '',
].join('\n')

const raf = (page) => page.evaluate(() =>
  new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

/** live 行级观测：type → { row img, icon bgc, icon mask, 行 quiet } */
const livePaint = (page) => page.evaluate(() => {
  const out = {}
  for (const line of document.querySelectorAll('.cm-line.callout-title')) {
    // T05：类型标识与容器底色在 wrapper（行级让位）
    const type = line.closest('.vsidian-callout-wrap')?.getAttribute('data-callout')
    if (!type) continue
    const icon = line.querySelector('.callout-icon')
    const s = getComputedStyle(line.closest('.vsidian-callout-wrap'))
    out[type] = {
      img: s.backgroundImage,
      quiet: line.classList.contains('vsidian-callout-quiet'),
      iconBgc: icon ? getComputedStyle(icon).backgroundColor : null,
      iconMask: icon ? (getComputedStyle(icon).maskImage ?? '') : null,
      iconW: icon ? getComputedStyle(icon).width : null,
    }
  }
  return out
})

try {
  const page = await browser.newPage({ viewport: { width: 760, height: 2400 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  // ---- Live：全类型图标与行底色（暗色轮）----
  await page.evaluate((text) => window.initCallout(text), typesDoc)
  await page.evaluate(() => window.locateCallout(window.controller.getView().state.doc.length))
  await page.waitForSelector('.cm-line .callout-icon')
  let paint = await livePaint(page)
  assert.equal(Object.keys(paint).length, 27, `27 个类型值都应有标题行绘制: ${Object.keys(paint).length}`)
  for (const [type, [dark]] of Object.entries(TYPE_COLORS)) {
    const p = paint[type]
    assert.ok(p, `类型 ${type} 应有观测`)
    assert.ok(p.quiet, `${type} 标题行应挂 quiet（替代紫条）`)
    assert.equal(p.iconBgc, hexToRgb(dark), `${type} 暗色图标色应为 ${dark}: ${p.iconBgc}`)
    assert.ok(String(p.iconMask).includes('data:image/svg+xml'), `${type} 图标应绘制 SVG mask`)
    assert.notEqual(parseFloat(p.iconW), 0, `${type} 图标应有非零尺寸`)
    assert.ok(p.img !== 'none', `${type} 行底色应由渐变通道绘制`)
  }
  // 图标分组：同 flame 组同 mask、不同组不同 mask（图标分派的可见差异）
  assert.equal(paint.tip.iconMask, paint.hint.iconMask, 'hint 与 tip 共 flame 图标')
  assert.equal(paint.tip.iconMask, paint.important.iconMask, 'important 与 tip 共 flame 图标（取证）')
  assert.notEqual(paint.tip.iconMask, paint.note.iconMask, 'tip 与 note 图标应不同')
  assert.notEqual(paint.question.iconMask, paint.warning.iconMask, 'question 与 warning 图标应不同')
  // important 与 tip 颜色通道独立（默认值同色，但变量独立——经覆盖验证）
  const overrideStyle = await page.addStyleTag({ content: ":where([data-callout='important']) { --callout-important: #ff00ff; }" })
  paint = await livePaint(page)
  assert.equal(paint.important.iconBgc, 'rgb(255, 0, 255)', 'important 独立变量可单独覆盖（不连带 tip）')
  assert.equal(paint.tip.iconBgc, hexToRgb(TYPE_COLORS.tip[0]), 'tip 颜色不受 important 覆盖影响')
  await overrideStyle.evaluate((el) => el.remove()) // 覆盖验证后移除，不污染后续轮次

  // ---- 亮色轮：全类型图标色换档（quote 固定灰不换）----
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  await raf(page)
  paint = await livePaint(page)
  for (const [type, [, light]] of Object.entries(TYPE_COLORS)) {
    assert.equal(paint[type].iconBgc, hexToRgb(light), `${type} 亮色图标色应为 ${light}: ${paint[type].iconBgc}`)
  }
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })

  // ---- 三层嵌套：最内层 data-callout 胜出、行类叠加 ----
  await page.evaluate((text) => window.initCallout(text), NESTED_DOC)
  await page.evaluate(() => window.locateCallout(window.controller.getView().state.doc.length))
  const nested = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].map((el) => ({
      callout: el.closest('.vsidian-callout-wrap')?.getAttribute('data-callout') ?? null,
      cls: el.className,
      text: el.textContent ?? '',
    })))
  const inner = nested.find((l) => l.text.includes('内层正文'))
  assert.equal(inner.callout, 'warning', '嵌套正文行归最内层 wrapper（嵌套 DOM 承载最内层语义）')
  assert.ok(inner.cls.includes('callout-content'), '嵌套正文行应挂 callout-content')
  const midTitle = nested.find((l) => l.text.trim() === '中层')
  assert.ok(midTitle.cls.includes('callout-title') && midTitle.cls.includes('callout-content'),
    '中层标题行同时是外层 content 与中层 title')
  // 三个图标 widget 各自在场
  assert.equal(await page.locator('.cm-line .callout-icon').count(), 3, '三层各应有一个图标')

  // ---- 列表容器内 callout：真实编辑（T01 §10 缺口）----
  await page.evaluate((text) => window.initCallout(text), LIST_DOC)
  // 等新文档真实挂载（init 异步处理——直接点击会落在前文档 DOM 上）
  await page.waitForFunction(() =>
    window.controller.getView().state.doc.toString().includes('列表内正文二'))
  await raf(page)
  await page.click('.cm-content')
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('列表内正文一') + 3))
  await page.keyboard.type('X')
  await raf(page)
  // 键入落点 = locateCallout 定位处（indexOf('列表内正文一') + 3，即
  // 「列表内」与「正文一」之间）——期望串按该落点构造
  const typed = await page.evaluate(() => {
    const view = window.controller.getView()
    const doc = view.state.doc.toString()
    const el = [...document.querySelectorAll('.cm-line')].find((e) => (e.textContent ?? '').includes('列表内X正文一'))
    return { doc, cls: el?.className ?? '', callout: el?.getAttribute('data-callout') }
  })
  assert.ok(typed.doc.includes('列表内X正文一'), '列表内 callout 键入应写入文档')
  assert.ok(typed.cls.includes('callout-content'), `键入后外框应保留: ${typed.cls}`)
  assert.ok(typed.cls.includes('vsidian-list-line'), '键入后列表行身份应保留')
  assert.equal(typed.callout, 'info')
  // 跨行拖选（列表内标题行 → 正文行）：坐标逐字节等于源区间
  const selectDoc = await page.evaluate(() => window.controller.getView().state.doc.toString())
  const from = selectDoc.indexOf('列表内标题')
  const to = selectDoc.indexOf('列表内正文二') + 6
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
  const sel = await page.evaluate(() => {
    const range = window.controller.getView().state.selection.main
    return { from: range.from, to: range.to }
  })
  // A86 选区覆盖显形（2026-10-31）伴生：拖选路径标记显形右移，释放
  // 像素映射左偏 ≤1（详见 calloutPaint.mjs 同款注释）
  assert.equal(sel.from, from, `拖选起点应精确: ${JSON.stringify(sel)}`)
  assert.ok(sel.to >= to - 1 && sel.to <= to, `拖选终点覆盖源区间（显形伴生 ≤1）: ${JSON.stringify(sel)} vs ${from}-${to}`)
  // 标题源码可编辑：光标进标题行显形 [!info]
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('列表内标题') + 1))
  await raf(page)
  const revealed = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].find((e) => (e.textContent ?? '').includes('列表内标题'))?.textContent ?? '')
  assert.ok(revealed.includes('[!info]'), `触及标题行应显形源码: ${revealed}`)

  // ---- malformed / 代码伪标记 / 内部控件（MIXED 文档）----
  await page.evaluate((text) => window.initCallout(text), MIXED_DOC)
  await page.evaluate(() => window.locateCallout(window.controller.getView().state.doc.length))
  await raf(page)
  const mixed = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].map((el) => ({
      callout: el.closest('.vsidian-callout-wrap')?.getAttribute('data-callout') ?? null,
      cls: el.className,
      text: el.textContent ?? '',
    })))
  const malformed = mixed.find((l) => l.text.includes('空类型未成型'))
  assert.ok(!malformed.cls.includes('callout'), '未成型标记不得挂 callout 类')
  assert.ok(mixed.find((l) => l.text.includes('代码内伪标记'))?.text.includes('[!tip]'), '代码内伪标记字面可见')
  const todoBody = mixed.find((l) => l.text.includes('表格与代码'))
  assert.equal(todoBody.callout, 'todo', '含代码块容器 wrapper 取首段声明（不误判围栏内标记）')
  // callout 内表格行网格共存（网格行类在 callout 行上叠加）
  // callout 内表格行网格共存（网格行类在 callout 行上叠加；管道符经
  // 表格网格装饰呈现，字面文本不含 | 1 | 2 |——按行类断言）
  const gridRow = mixed.find((l) => l.cls.includes('vsidian-table-line') && l.text.includes('1'))
  assert.ok(gridRow, `表格行在场: ${JSON.stringify(mixed.map((l) => l.cls))}`)
  assert.ok(gridRow.cls.includes('callout'), 'callout 内表格行应同时挂 callout 类')
  assert.equal(gridRow.callout, 'todo')
  const plain = mixed.find((l) => l.text.includes('普通引用保持'))
  assert.ok(!plain.cls.includes('callout'), '普通引用不回归')
  assert.ok(/rgb\(167, 139, 250\)/.test(await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.cm-line')].find((e) => (e.textContent ?? '').includes(t))
    return getComputedStyle(el).boxShadow
  }, '普通引用保持')), '普通引用紫条保留')

  // ---- 阅读侧：27 容器 + 类型色 + 富标题 + 嵌套 + 保留 ----
  await page.evaluate((text) => window.initCallout(text), typesDoc)
  await page.evaluate(() => window.setCalloutMode('reading'))
  await page.waitForSelector('.vsidian-view-reading .callout')
  const readingPaint = await page.evaluate(() => {
    const out = {}
    for (const rootEl of document.querySelectorAll('.vsidian-view-reading .callout')) {
      const type = rootEl.getAttribute('data-callout')
      const icon = rootEl.querySelector('.callout-title .callout-icon')
      out[type] = {
        iconBgc: icon ? getComputedStyle(icon).backgroundColor : null,
        img: getComputedStyle(rootEl).backgroundImage,
        title: rootEl.querySelector('.callout-title-inner')?.textContent ?? '',
      }
    }
    return out
  })
  assert.equal(Object.keys(readingPaint).length, 27, `阅读侧 27 容器都应发射: ${Object.keys(readingPaint).length}`)
  for (const [type, [dark]] of Object.entries(TYPE_COLORS)) {
    const p = readingPaint[type]
    assert.ok(p, `阅读侧 ${type} 容器应在场`)
    assert.equal(p.iconBgc, hexToRgb(dark), `阅读侧 ${type} 图标色应为 ${dark}: ${p.iconBgc}`)
    assert.ok(p.img !== 'none', `阅读侧 ${type} 容器底色应绘制`)
    assert.ok(p.title.includes(type), `阅读侧 ${type} 标题应可见`)
  }

  // ---- #671/T02：标题按类型着色（绘制层，非规则形态） ----
  // 观察用户看到的东西：27 类型标题计算色各自等于该类型 --callout-color 的
  // 解析结果，而不是 DOM 上有没有 color 声明。
  const rgbOf = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }
  const readingTitlePaint = await page.evaluate(() => {
    const out = {}
    for (const rootEl of document.querySelectorAll('.vsidian-view-reading .callout')) {
      const type = rootEl.getAttribute('data-callout')
      const title = rootEl.querySelector('.callout-title')
      const inner = rootEl.querySelector('.callout-title-inner')
      out[type] = {
        titleColor: title ? getComputedStyle(title).color : null,
        innerColor: inner ? getComputedStyle(inner).color : null,
      }
    }
    return out
  })
  for (const [type, [dark]] of Object.entries(TYPE_COLORS)) {
    const p = readingTitlePaint[type]
    assert.equal(p.titleColor, rgbOf(dark),
      `阅读侧 ${type} 标题计算色应为类型色 ${dark}: ${p.titleColor}`)
    // 内层保持 --callout-title-color=inherit → 继承标题层类型色
    assert.equal(p.innerColor, rgbOf(dark),
      `阅读侧 ${type} 标题内层应继承类型色: ${p.innerColor}`)
  }
  const distinctTitleColors = new Set(Object.values(readingTitlePaint).map((p) => p.titleColor))
  assert.ok(distinctTitleColors.size >= 6,
    `不同类型标题色应互不相同（至少 6 种），实际 ${distinctTitleColors.size} 种`)

  // 用户片段覆盖 --callout-title-color：只有内层变、标题层不变（证明该变量
  // 仍是内层覆盖点，语义未被改成类型色）
  const titleColorOverride = await page.addStyleTag({ content:
    ".vsidian-view-reading .callout[data-callout='note'] { --callout-title-color: #ff00ff; }" })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const overridden = await page.evaluate(() => {
    const root = document.querySelector(".vsidian-view-reading .callout[data-callout='note']")
    return {
      titleColor: getComputedStyle(root.querySelector('.callout-title')).color,
      innerColor: getComputedStyle(root.querySelector('.callout-title-inner')).color,
    }
  })
  await titleColorOverride.evaluate((el) => el.remove())
  assert.equal(overridden.innerColor, 'rgb(255, 0, 255)',
    `--callout-title-color 覆盖应作用于内层: ${overridden.innerColor}`)
  assert.equal(overridden.titleColor, rgbOf(TYPE_COLORS.note[0]),
    `标题层仍是类型色（覆盖只作用于内层）: ${overridden.titleColor}`)

  // Live 侧同一 data-callout 计算色与阅读侧一致
  await page.evaluate((text) => window.initCallout(text), typesDoc)
  await page.evaluate(() => window.setCalloutMode('live'))
  await page.waitForSelector('.cm-line.callout-title')
  const liveTitlePaint = await page.evaluate(() => {
    const out = {}
    for (const line of document.querySelectorAll('.cm-line.callout-title')) {
      // T05：类型标识在 wrapper（标题行取所属 wrapper 的 data-callout）
      const type = line.closest('.vsidian-callout-wrap')?.getAttribute('data-callout')
      if (!type) continue
      const inner = line.querySelector('.callout-title-inner')
      out[type] = {
        lineColor: getComputedStyle(line).color,
        innerColor: inner ? getComputedStyle(inner).color : null,
      }
    }
    return out
  })
  for (const [type, [dark]] of Object.entries(TYPE_COLORS)) {
    const p = liveTitlePaint[type]
    assert.ok(p, `live 侧 ${type} 标题行应在场`)
    assert.equal(p.lineColor, rgbOf(dark), `live 侧 ${type} 标题行计算色应为 ${dark}: ${p.lineColor}`)
    if (p.innerColor !== null) {
      assert.equal(p.innerColor, rgbOf(dark), `live 侧 ${type} 标题内层应继承类型色: ${p.innerColor}`)
    }
  }

  // 回到阅读模式（下方嵌套用例消费阅读侧 container 结构）
  await page.evaluate(() => window.setCalloutMode('reading'))
  await page.waitForSelector('.vsidian-view-reading .callout')

  // 嵌套阅读 + 富标题 + 普通引用
  await page.evaluate((text) => window.initCallout(text), [
    NESTED_DOC,
    '',
    '> 普通引用块',
    '',
    '> [!example] **富标题** 与 [链接](https://example.com)',
    '',
  ].join('\n'))
  const readingNested = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('.vsidian-view-reading .callout')]
    return {
      types: roots.map((r) => r.getAttribute('data-callout')),
      nestedStrict: !!roots[0]?.querySelector('.callout-content .callout'),
      blockquoteCount: document.querySelectorAll('.vsidian-view-reading blockquote').length,
      richTitle: document.querySelector('.vsidian-view-reading .callout[data-callout="example"] .callout-title-inner')?.innerHTML ?? '',
    }
  })
  assert.deepEqual(readingNested.types, ['note', 'tip', 'warning', 'example'], '嵌套三层 + 富标题容器顺序')
  assert.ok(readingNested.nestedStrict, '阅读侧嵌套为严格容器（content 内 callout）')
  assert.ok(readingNested.blockquoteCount >= 1, '普通引用保持 blockquote')
  assert.ok(readingNested.richTitle.includes('<strong>富标题</strong>'), `富标题粗体应渲染: ${readingNested.richTitle}`)
  assert.ok(readingNested.richTitle.includes('href="https://example.com"'), '富标题链接应渲染 href')

  // ---- 模式往返：live 行级形态恢复 ----
  await page.evaluate(() => window.setCalloutMode('live'))
  await raf(page)
  const backToLive = await page.evaluate(() => ({
    wrapCount: document.querySelectorAll('.vsidian-callout-wrap.callout').length,
    titleCls: [...document.querySelectorAll('.cm-line.callout-title')].some((e) =>
      e.closest('.vsidian-callout-wrap')?.getAttribute('data-callout') === 'warning'),
  }))
  assert.ok(backToLive.wrapCount > 0 && backToLive.titleCls, `模式往返后 live wrapper 形态应恢复: ${JSON.stringify(backToLive)}`)

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('calloutTypes: 全部断言通过（27 类型 × 明暗 × 图标 × 嵌套/列表编辑 × malformed × 阅读侧）')
} finally {
  await browser.close()
}
