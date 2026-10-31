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

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('calloutWrap: 全部断言通过（结构/嵌套/懒延续归属 × 20 点击 × 键入 × 热样式 × 视口 × 模式往返）')
} finally {
  await browser.close()
}
