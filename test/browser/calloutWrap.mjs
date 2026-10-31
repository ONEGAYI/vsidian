// T04（#672）callout 容器 BlockWrapper 结构回归：真实 Chromium + 生产
// 控制器（wrapper 经 rootOwnedViewExtensions 装配，非探针注入）。断言
// 口径与探针报告（docs/research/callout-blockwrapper-probe.md）一致：
// - 结构：wrapper 数量/嵌套/data-callout-depth；懒延续行归内层容器
//   （calloutParity F17 勘误口径）；无 callout 行逃逸；列表内/普通引用/
//   正文不产 wrapper（v1 边界）
// - 落点：关键坐标 20 次同坐标点击全准（S1 口径）；wrapper padding 热更新
//   后重测仍准（S1 热样式口径；padding 入 heightmap 记账）
// - 键入：内层正文真实键入后文档更新、行仍在内层 wrapper
// - 模式往返：live→reading→live 后 wrapper 结构恢复（S1 口径）
// - 视口入场：长文档滚动到 wrapper 区后结构与点击正常（S2 口径）
// 禁垂直 margin 属生产纪律（无规则可测），错行证据见探针 S1b/S1c。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutWrap/calloutWrap.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutWrapFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const DOC = [
  '> [!note] 外层标题',
  '> 外层正文',
  '> > [!tip] 内层标题',
  '> > 内层正文',
  '> 外层尾行',
  '',
  '> [!example] 兄弟标题',
  '> 兄弟正文',
  '',
  '- > [!info] 列表内标题',
  '  > 列表内正文',
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
  const docLength = await page.evaluate(() => window.controller.getView().state.doc.length)
  await page.evaluate((off) => window.locateCallout(off), docLength)
  await page.waitForSelector('.vsidian-callout-wrap')

  // ---- 结构：数量 / 嵌套 / depth / 行归属 ----
  const structure = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll('.vsidian-callout-wrap')]
    const outer = wraps.find((w) => w.getAttribute('data-callout-depth') === '1' &&
      (w.textContent ?? '').includes('内层标题'))
    const inner = wraps.find((w) => w.getAttribute('data-callout-depth') === '2')
    const sibling = wraps.find((w) => (w.textContent ?? '').includes('兄弟标题'))
    const inList = wraps.find((w) => (w.textContent ?? '').includes('列表内标题'))
    return {
      count: wraps.length,
      hasOuter: outer !== undefined,
      hasInner: inner !== undefined,
      hasSibling: sibling !== undefined,
      innerInsideOuter: !!(outer && inner && outer.contains(inner)),
      siblingInsideOuter: !!(outer && sibling && outer.contains(sibling)),
      lines: [...document.querySelectorAll('.cm-line')].map((el) => ({
        text: el.textContent ?? '',
        wrapDepth: el.closest('.vsidian-callout-wrap')?.getAttribute('data-callout-depth') ?? null,
      })),
    }
  })
  assert.equal(structure.count, 3, `wrapper 应恰 3 个（外层/内层/兄弟；列表内 v1 不产）: ${structure.count}`)
  assert.ok(structure.hasOuter && structure.hasInner && structure.hasSibling, '外层/内层/兄弟 wrapper 应各在场')
  assert.ok(structure.innerInsideOuter, '内层 wrapper 应嵌套于外层 wrapper 内')
  assert.ok(!structure.siblingInsideOuter, '兄弟 wrapper 不得嵌套于外层 wrapper 内')
  const lineOf = (needle) => structure.lines.find((l) => l.text.includes(needle))
  // 懒延续行归内层（勘误口径——calloutParity F17 与 Reading 同渲染）
  assert.equal(lineOf('外层尾行')?.wrapDepth, '2', `懒延续行应归内层 wrapper: ${JSON.stringify(lineOf('外层尾行'))}`)
  for (const [needle, depth] of [
    ['外层标题', '1'], ['外层正文', '1'], ['内层标题', '2'], ['内层正文', '2'],
    ['兄弟标题', '1'], ['兄弟正文', '1'],
  ]) {
    assert.equal(lineOf(needle)?.wrapDepth, depth, `${needle} 应在 depth=${depth} wrapper 内`)
  }
  // v1 边界：列表内 callout 维持行级形态（无 wrapper 承载）
  assert.equal(lineOf('列表内标题')?.wrapDepth, null, '列表内 callout 行 v1 不入 wrapper')
  // 正文行直接断言（此前仅由 count=3 间接排除——标题行断言不覆盖正文行
  // 混入 wrapper 的情形）
  assert.equal(lineOf('列表内正文')?.wrapDepth, null, '列表内 callout 正文行 v1 不入 wrapper')
  assert.equal(lineOf('结尾段落')?.wrapDepth, null, '容器外正文不入 wrapper')

  // ---- 20 次同坐标点击（S1 口径）----
  // 靶点选几何稳定行：正文行/懒延续行（无标记显隐）。标题行首击精确即可
  // ——光标进入后标记 widget 按端点语义显形源码、行几何变化，同坐标连击
  // 落在显形后位置是显隐语义而非 wrapper 缺陷（本轮探针实测钉住）。
  const clickPoint = (offset) => page.evaluate((off) => {
    const rect = window.controller.getView().coordsAtPos(off)
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  }, offset)
  const clickTwenty = async (offset, label) => {
    const point = await clickPoint(offset)
    const heads = []
    for (let i = 0; i < 20; i++) {
      await page.mouse.click(point.x, point.y)
      heads.push(await page.evaluate(() => window.controller.getView().state.selection.main.head))
    }
    const unique = [...new Set(heads)]
    assert.equal(unique.length, 1, `${label}: 20 次同坐标点击应全同（坐标 ${point.x},${point.y}）: ${JSON.stringify(heads)}`)
    assert.equal(unique[0], offset, `${label}: 点击应精确落 ${offset}（实测 ${unique[0]}）`)
  }
  const posOf = (needle) => page.evaluate((t) => {
    const doc = window.controller.getView().state.doc.toString()
    return doc.indexOf(t) + Math.floor(t.length / 2)
  }, needle)
  await clickTwenty(await posOf('外层正文'), '外层正文')
  await clickTwenty(await posOf('内层正文'), '内层正文')
  await clickTwenty(await posOf('外层尾行'), '懒延续行')
  await clickTwenty(await posOf('兄弟正文'), '兄弟正文')
  // 标题行首击精确（光标进入前几何未变）
  const titlePoint = await clickPoint(await posOf('内层标题'))
  await page.mouse.click(titlePoint.x, titlePoint.y)
  assert.equal(await page.evaluate(() => window.controller.getView().state.selection.main.head),
    await posOf('内层标题'), '标题行首击应精确')

  // ---- 键入：内层正文真实键入（插入点 = 词中偏移 +2，实测形态「内层字正文」），行仍在内层 wrapper ----
  await page.click('.cm-content')
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('内层正文') + 2))
  await page.keyboard.type('字')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const typed = await page.evaluate(() => {
    const view = window.controller.getView()
    const el = [...document.querySelectorAll('.cm-line')].find((e) => (e.textContent ?? '').includes('内层字正文'))
    return {
      inDoc: view.state.doc.toString().includes('内层字正文'),
      wrapDepth: el?.closest('.vsidian-callout-wrap')?.getAttribute('data-callout-depth') ?? null,
      wrapCount: document.querySelectorAll('.vsidian-callout-wrap').length,
    }
  })
  assert.ok(typed.inDoc, '键入应写入文档（内层字正文）')
  assert.equal(typed.wrapDepth, '2', `键入后行应仍在内层 wrapper: ${JSON.stringify(typed)}`)
  assert.equal(typed.wrapCount, 3, '键入后 wrapper 数量不变')

  // ---- 热样式：wrapper padding 变更后 20 点击仍准（padding 入记账）----
  // 沉淀：padding 变更后 CM6 异步重测量 heightmap——先触发测量并等待落地，
  // 再取坐标连击（否则连击中途测量落地会使同坐标映射漂移，属测量时序而
  // 非记账缺失）
  // 产物 CSS 已有高特异性 padding 消费规则——热样式经变量覆盖（片段惯用形态）
  await page.addStyleTag({ content: '.vsidian-callout-wrap.callout { --callout-padding: 14px 18px; }' })
  // 热样式发现（2026-10-31 实测，诚实降级）：styles 变更无 DOM mutation，
  // CM6 不自行察觉；短文档下 scroll/空 dispatch/视口 resize/沉降点击/重
  // init 均不恢复 coordsAtPos↔posAtCoords 一致（映射稳定偏移 = 新增
  // wrapper 边界空间 28px）。「片段热更新后的测量刷新」为 T05（#673）
  // 测量设计项。本套对热样式只断言结构保持；padding 记账与坐标精度在
  // 模式往返（docView 冷重建，全新测量）后验证
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
    requestAnimationFrame(resolve))))
  const styledStructure = await page.evaluate(() => ({
    count: document.querySelectorAll('.vsidian-callout-wrap').length,
    nested: !!document.querySelector('.vsidian-callout-wrap .vsidian-callout-wrap'),
  }))
  assert.equal(styledStructure.count, 3, '热样式后 wrapper 结构保持')
  assert.ok(styledStructure.nested, '热样式后嵌套保持')

  // ---- 视口入场：长文档滚动后结构/点击（S2 口径）----
  // 视口渲染（ADR-0005）：callout 区在初始视口之外，DOM 未实例化——先滚
  // 动入场再断言（waitForSelector 前置于滚动会永远等不到）
  const filler = Array.from({ length: 150 }, (_, i) => `填充行 ${i + 1}`)
  const longDoc = [...filler, ...DOC.split('\n'), ...filler.map((l) => `${l} 后`)].join('\n')
  await page.evaluate((text) => window.initCallout(text), longDoc)
  await page.evaluate(() => {
    // 直接驱动滚动层（目标区约在 151 行 × ~21px；行 DOM 未渲染时
    // scrollIntoView 无目标可寻）
    window.controller.getView().scrollDOM.scrollTop = 3000
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.waitForSelector('.vsidian-callout-wrap')
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.cm-line')].find((e) => (e.textContent ?? '').includes('内层标题'))
    el?.scrollIntoView({ block: 'center' })
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const scrolled = await page.evaluate(() => ({
    count: document.querySelectorAll('.vsidian-callout-wrap').length,
    nested: !!document.querySelector('.vsidian-callout-wrap .vsidian-callout-wrap'),
  }))
  assert.equal(scrolled.count, 3, '视口入场后 wrapper 数量不变')
  assert.ok(scrolled.nested, '视口入场后嵌套结构仍在')
  await clickTwenty(await posOf('内层正文'), '滚动后内层正文')

  // ---- 模式往返：live→reading→live 后 wrapper 恢复（docView 冷重建，
  //      热样式 padding 参与全新测量——记账与坐标精度在此验证）----
  await page.evaluate(() => window.setCalloutMode('reading'))
  await page.waitForSelector('.vsidian-view-reading .callout')
  await page.evaluate(() => window.setCalloutMode('live'))
  await page.waitForSelector('.vsidian-callout-wrap')
  const roundtrip = await page.evaluate(() => ({
    count: document.querySelectorAll('.vsidian-callout-wrap').length,
    nested: !!document.querySelector('.vsidian-callout-wrap .vsidian-callout-wrap'),
    lazyDepth: [...document.querySelectorAll('.cm-line')].find((e) =>
      (e.textContent ?? '').includes('外层尾行'))?.closest('.vsidian-callout-wrap')?.getAttribute('data-callout-depth') ?? null,
    pad: getComputedStyle(document.querySelector('.vsidian-callout-wrap')).padding,
  }))
  assert.equal(roundtrip.count, 3, '模式往返后 wrapper 数量恢复')
  assert.ok(roundtrip.nested, '模式往返后嵌套恢复')
  assert.equal(roundtrip.lazyDepth, '2', '模式往返后懒延续行仍归内层')
  assert.equal(roundtrip.pad, '14px 18px', `冷重建后 wrapper padding 变量覆盖应生效: ${roundtrip.pad}`)
  await clickTwenty(await posOf('兄弟正文'), '往返冷重建后兄弟正文')

  // ---- 无 callout 文档零 wrapper（普通形态不受影响）----
  await page.evaluate(() => window.initCallout('普通段落\n\n> 普通引用\n'))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.locator('.vsidian-callout-wrap').count(), 0, '无 callout 文档不得产 wrapper')

  // ---- T07（#675）：引用内子块组合——代码卡 + 多行公式 + 嵌套 callout
  //      单一 wrapper 承载（T04 结构 + T05 视觉 + T06 扫描全在场）----
  const T07_DOC = [
    '> [!note] 外层标题',
    '> 外层正文',
    '> ```js',
    '> const a = 1',
    '> const bb = 2',
    '> ```',
    '> $$',
    '> x = a^2 + b',
    '> $$',
    '> > [!tip] 内层标题',
    '> > 内层正文',
    '外层尾部',
  ].join('\n')
  await page.evaluate((text) => window.initCallout(text), T07_DOC)
  await page.waitForSelector('.vsidian-callout-wrap')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  // 结构 + 绘制层：卡 chrome / 行号入盒（T05 防雷）/ token 对位 / 公式成型
  // 与无泄漏 / 前缀全隐 / 尾部不吞（S3：QuoteMark × 围栏行 replace × 跨行
  // math replace 并存）
  const combo = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll('.vsidian-callout-wrap')]
    const outer = wraps.find((w) => (w.textContent ?? '').includes('外层标题'))
    const inner = wraps.find((w) => (w.textContent ?? '').includes('内层标题'))
    const header = document.querySelector('.vsidian-code-card-header')
    const headerLabel = document.querySelector('.vsidian-code-card-header-label')
    const copyBtn = document.querySelector('.vsidian-code-card-copy')
    const foldBtn = document.querySelector('.vsidian-code-card-fold')
    const linenos = [...document.querySelectorAll('.vsidian-code-card-linenumber')].map((el) => el.textContent)
    const wrapRect = outer?.getBoundingClientRect()
    const firstNo = document.querySelector('.vsidian-code-card-linenumber')?.getBoundingClientRect()
    // token 对位（第二行起）：mark 覆盖的可见文本必须恰是 token 文本
    const toks = [...document.querySelectorAll('.cm-line [class*="tok-"]')]
      .map((el) => ({ cls: [...el.classList].filter((c) => c.startsWith('tok-')).join(','), text: el.textContent ?? '' }))
    // 无泄漏：wrapper 内移除公式 widget 子树后不得残留源文
    const outerClone = outer ? outer.cloneNode(true) : null
    if (outerClone) {
      outerClone.querySelectorAll('.vsidian-math').forEach((el) => el.remove())
    }
    // 前缀全隐 + 尾部不吞：行文本不以 > 开头；尾部行完整
    const lines = [...document.querySelectorAll('.cm-line')].map((el) => ({ text: el.textContent ?? '' }))
    return {
      wrapCount: wraps.length,
      singleHost: !!(outer && header && outer.contains(header)),
      mathInOuter: !!(outer && outer.querySelector('.vsidian-math .katex')),
      innerInOuter: !!(outer && inner && outer.contains(inner)),
      headerLabel: headerLabel?.textContent ?? null,
      hasCopy: !!copyBtn,
      hasFold: !!foldBtn,
      linenos,
      linenoInBox: !!(wrapRect && firstNo && firstNo.left >= wrapRect.left && firstNo.right <= wrapRect.right),
      keywords: toks.filter((t) => t.cls.includes('tok-keyword')).map((t) => t.text),
      numbers: toks.filter((t) => t.cls.includes('tok-number')).map((t) => t.text).sort(),
      mathLeak: outerClone ? (outerClone.textContent ?? '').includes('a^2') : true,
      quotePrefixed: lines.filter((l) => l.text.trimStart().startsWith('>')).length,
      tailIntact: lines.some((l) => l.text.includes('外层尾部')),
      emptyFenceRows: lines.filter((l) => l.text === '').length,
    }
  })
  assert.equal(combo.wrapCount, 2, `组合文档应恰 2 个 wrapper（外层+内层嵌套）: ${combo.wrapCount}`)
  assert.ok(combo.singleHost, '代码卡头部应在外层 wrapper 内（单一容器承载）')
  assert.ok(combo.mathInOuter, 'KaTeX 公式应成型且在外层 wrapper 内')
  assert.ok(combo.innerInOuter, '内层 callout wrapper 应嵌套于外层（单一容器承载）')
  assert.ok(combo.headerLabel?.includes('JavaScript'), `语言标签应为 JavaScript: ${combo.headerLabel}`)
  assert.ok(combo.hasCopy && combo.hasFold, '复制与折叠按钮应在场')
  assert.deepEqual(combo.linenos, ['1', '2'], `卡内行号应为 1/2（围栏行不占号）: ${JSON.stringify(combo.linenos)}`)
  assert.ok(combo.linenoInBox, '行号应落在 wrapper 盒内（T05 防雷回归——悬挂缩进对不被清零）')
  assert.deepEqual(combo.keywords, ['const', 'const'],
    `引用内两行 keyword 着色应各覆盖 'const'（逐行前缀映射，§4.2 错位不得回潮）: ${JSON.stringify(combo.keywords)}`)
  assert.deepEqual(combo.numbers, ['1', '2'],
    `数字着色应覆盖 '1'/'2': ${JSON.stringify(combo.numbers)}`)
  assert.equal(combo.mathLeak, false, '移除公式 widget 后 wrapper 内不得残留源文（§4.1 泄漏不得回潮）')
  assert.equal(combo.quotePrefixed, 0, `可见行不得以 > 前缀呈现（QuoteMark 隐藏 × replace 并存）: ${combo.quotePrefixed}`)
  assert.ok(combo.tailIntact, '跨行 replace 并存时尾部文字不得被吞（S3 形态）')
  // 围栏行 replace 清空（实测取证 2026-10-31：文档 13 行无空行，空文本行恰
  // 为两个围栏行；quotePrefixed 只抓 > 残留，``` 残留不以 > 开头会逃过——
  // 此断言是围栏行 replace 失效的唯一观测点）
  assert.equal(combo.emptyFenceRows, 2,
    `两个围栏行应 replace 清空为空文本行（S3：围栏行 replace 与 QuoteMark/跨行 math replace 并存）: ${combo.emptyFenceRows}`)

  // 20 次同坐标点击：先无显隐扰动的行（光标自文档头直击——内层正文/
  // 懒延续尾部），再代码行（首击进编辑态、围栏行由清空恢复显形会改行高
  // ——先单击一次让几何落地再连击，热样式场景同款沉淀），公式行只做
  // 首击（进入即显源码、行几何变化是显隐语义）
  await clickTwenty(await posOf('内层正文'), '组合文档内层正文')
  await clickTwenty(await posOf('外层尾部'), '组合文档懒延续尾部')
  const codeWarm = await clickPoint(await posOf('const bb = 2'))
  await page.mouse.click(codeWarm.x, codeWarm.y)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await clickTwenty(await posOf('const bb = 2'), '引用内代码第二行（编辑态几何落地后）')
  const mathPoint = await clickPoint(await posOf('x = a^2 + b'))
  await page.mouse.click(mathPoint.x, mathPoint.y)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  // inline replace widget 的点击定位落在块端点（CM6 posAtDOM 语义）——
  // head 落在区间或端点即触发光标进入；随后断言源码态显形（widget 退场）
  const mathHit = await page.evaluate(() => {
    const view = window.controller.getView()
    const doc = view.state.doc.toString()
    const i = doc.indexOf('x = a^2 + b')
    return {
      head: view.state.selection.main.head,
      from: i - 4, // 开行 `> $$` 的 $$ 起点
      to: i + 16, // 闭行 `> $$` 的 $$ 尾后
      sourceRevealed: !document.querySelector('.vsidian-math'),
    }
  })
  assert.ok(mathHit.head >= mathHit.from && mathHit.head <= mathHit.to,
    `公式首击应落入块区间或端点（widget 点击定位链路通）: ${JSON.stringify(mathHit)}`)
  assert.ok(mathHit.sourceRevealed, '光标进入公式后应显源码（widget 退场，编辑入口通）')

  // 折叠展开往返：收起（体消失、头部留）→ 展开（行号/token/内容恢复）
  await page.click('.vsidian-code-card-fold')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const folded = await page.evaluate(() => ({
    bodyGone: (document.querySelector('.vsidian-callout-wrap')?.textContent ?? '').includes('const a = 1') === false,
    headerAlive: !!document.querySelector('.vsidian-code-card-header'),
    foldBtnAlive: !!document.querySelector('.vsidian-code-card-fold'),
  }))
  assert.ok(folded.bodyGone, '折叠收起后代码体不得可见')
  assert.ok(folded.headerAlive && folded.foldBtnAlive, '折叠收起后头部与展开钮保留')
  await page.click('.vsidian-code-card-fold')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const unfolded = await page.evaluate(() => {
    const toks = [...document.querySelectorAll('.cm-line [class*="tok-keyword"]')].map((el) => el.textContent)
    return {
      bodyBack: (document.querySelector('.vsidian-callout-wrap')?.textContent ?? '').includes('const a = 1'),
      linenos: [...document.querySelectorAll('.vsidian-code-card-linenumber')].map((el) => el.textContent),
      keywords: toks,
    }
  })
  assert.ok(unfolded.bodyBack, '展开后代码体恢复')
  assert.deepEqual(unfolded.linenos, ['1', '2'], '展开后行号恢复')
  assert.deepEqual(unfolded.keywords, ['const', 'const'], `展开后 token 对位仍准: ${JSON.stringify(unfolded.keywords)}`)

  // 复制内容（剥前缀后的代码）：hover 卡头触发整卡显现 → 点复制 → 出站断言
  await page.hover('.vsidian-code-card-header')
  await page.click('.vsidian-code-card-copy')
  const copyMsg = await page.evaluate(() =>
    window.postedCallout().filter((m) => m.kind === 'codeblock.copy').pop() ?? null)
  assert.ok(copyMsg, '复制点击应产出 codeblock.copy 出站消息')
  assert.equal(copyMsg.text, 'const a = 1\nconst bb = 2',
    `复制内容应为剥前缀后的代码: ${JSON.stringify(copyMsg.text)}`)

  // 增量编辑：代码行键入后 token 对位仍准；公式内容行删字符后仍渲染
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('const bb = 2') + 7))
  await page.keyboard.type('X')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const typedInCard = await page.evaluate(() => {
    const toks = [...document.querySelectorAll('.cm-line [class*="tok-"]')]
      .map((el) => ({ cls: [...el.classList].filter((c) => c.startsWith('tok-')).join(','), text: el.textContent ?? '' }))
    return {
      keywords: toks.filter((t) => t.cls.includes('tok-keyword')).map((t) => t.text),
      inDoc: window.controller.getView().state.doc.toString().includes('const bXb = 2'),
      mathAlive: !!document.querySelector('.vsidian-math .katex'),
    }
  })
  assert.ok(typedInCard.inDoc, '容器内键入应写入文档（const bXb = 2）')
  assert.deepEqual(typedInCard.keywords, ['const', 'const'],
    `增量键入后 token 对位仍准（增量重建路径同 lineMap 折算）: ${JSON.stringify(typedInCard.keywords)}`)
  assert.ok(typedInCard.mathAlive, '代码行键入后公式仍渲染')
  // 公式内容行删一字符（行尾 b）：块表增量重建、公式仍成型
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('x = a^2 + b') + 'x = a^2 + b'.length))
  await page.keyboard.press('Backspace')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const trimming = await page.evaluate(() => ({
    sourceRevealed: !document.querySelector('.vsidian-math'),
    texInDoc: window.controller.getView().state.doc.toString().includes('x = a^2 + '),
  }))
  assert.ok(trimming.texInDoc, '公式内容行删字符应写入文档')
  assert.ok(trimming.sourceRevealed, '光标在公式内编辑应显源码（widget 退场）')
  // 光标移出公式：块表增量重建后恢复渲染（tex 已变 'x = a^2 + '）
  await page.evaluate(() => window.locateCallout(0))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const remathed = await page.evaluate(() => ({
    mathAlive: !!document.querySelector('.vsidian-math .katex'),
    mathText: document.querySelector('.vsidian-math')?.textContent ?? '',
  }))
  assert.ok(remathed.mathAlive, '光标移出后公式块表增量重建恢复渲染')
  assert.ok(!remathed.mathText.includes('a^2 + b'), '恢复渲染的公式不得再含已删的 b')

  // 截图对照（gitignored，out/test/ 留证）
  await page.screenshot({ path: path.join(root, 'out/test/t07-callout-combo-live.png') })
  // 光标进入公式的源码态形态一并留证（显形后源文可见是显隐语义）
  await page.evaluate(() => window.locateCallout(
    window.controller.getView().state.doc.toString().indexOf('x = a^2 + ') + 2))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: path.join(root, 'out/test/t07-callout-combo-source.png') })

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('calloutWrap: 全部断言通过（结构/嵌套/懒延续归属 × 20 点击 × 键入 × 热样式 × 视口 × 模式往返 × T07 组合：卡 chrome/token 对位/公式无泄漏/折叠往返/复制/增量编辑）')
} finally {
  await browser.close()
}
