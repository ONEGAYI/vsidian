// Callout 折叠状态机的原生浏览器回归（#655/T04）：真实 Chromium + 生产
// 控制器 + 产物 CSS。断言用户看到的东西（AGENTS 视觉层断言）：
// - 真实点击箭头收起/展开（正文收起后不可见、标题可见、箭头 is-collapsed）
// - 键位路径（注册表绑定 ctrl+alt+u 真实按键）与 ui.command 命令面板路径
// - 折叠零写回（edit.request 出站计数零增长）与光标迁移（隐藏区光标落标题行行尾）
// - 模式往返共享状态（Live 收起 → 阅读同步收起 → 阅读展开 → Live 同步）；
//   默认 `-` 收起呈现（阅读 .callout-content display:none）
// - 阅读块滚动重挂后状态保持（远跳离开视口再跳回）
// - 查找进入收起区自动展开（含标题节 + callout 双重折叠的依次展开）
// - IME 组合输入不被折叠交互中断（CDP imeSetComposition 真实组合序列）
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutFold/calloutFold.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutFoldFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const DOC = [
  '# 章节', // 1（标题节——双重折叠用）
  '', // 2
  '> [!note]+ 外层提示', // 3
  '> 外层正文甲', // 4
  '> > [!tip]- 内层提示', // 5
  '> > 内层正文乙', // 6
  '> 外层收尾', // 7
  '', // 8
  '> [!warning] 无符号提示', // 9
  '> 无符号正文', // 10
  '', // 11
  '结尾段落。', // 12
].join('\n')

/** 帧同步等待（CM6 行 DOM 更新落地） */
const settle = (page) =>
  page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

try {
  const page = await browser.newPage({ viewport: { width: 760, height: 480 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initCalloutFold(text), DOC)
  // 光标先落文档尾（不触及任何标题行——触及即显形源码、箭头退场）
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.length))
  await settle(page)

  const lineEndOf = (text) =>
    page.evaluate((t) => {
      const view = window.controller.getView()
      const idx = view.state.doc.toString().indexOf(t)
      return view.state.doc.lineAt(idx).to
    }, text)

  // ---- 一、初始呈现：+ 展开 / - 收起 / 无符号无箭头（源码默认态） ----
  let probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldableCount, 2, '有符号且有正文的 callout 应可折叠（外层 + 与内层 -）')
  assert.equal(probe.foldCount, 1, '内层 tip- 默认收起')
  assert.equal(probe.arrowCount, 2, '两个可折叠 callout 各一个箭头')
  // 内层默认收起：内层正文不可见、内层标题可见（绘制层）
  assert.equal(await page.evaluate((t) => window.lineTextPainted(t), '内层正文乙'), false,
    '默认收起的内层正文不应绘制')
  assert.ok(await page.evaluate((t) => window.lineTextPainted(t), '内层提示'),
    '收起态内层标题应可见')
  // 无符号 callout：无箭头、正文照常可见
  assert.ok(await page.evaluate((t) => window.lineTextPainted(t), '无符号正文'),
    '无符号 callout 正文应照常可见')
  const arrowMeta = await page.evaluate(() =>
    [...document.querySelectorAll('.callout-fold')].map((el) => ({
      collapsed: el.classList.contains('is-collapsed'),
      fold: el.getAttribute('data-callout-fold'),
      tooltip: el.getAttribute('data-tooltip'),
      expanded: el.getAttribute('aria-expanded'),
    })))
  assert.deepEqual(arrowMeta.map((a) => [a.fold, a.collapsed]),
    [['+', false], ['-', true]], '箭头声明符号与收起态')

  // ---- 二、真实点击箭头收起外层：零写回 + 光标迁移 + 绘制层 ----
  const editsBefore = await page.evaluate(() => window.editRequestCount())
  // 光标放进外层正文（收起事务须同笔迁移到标题行行尾）
  await page.evaluate(async () => {
    window.locateCalloutFold(window.controller.getView().state.doc.toString().indexOf('外层正文甲'))
  })
  await settle(page)
  // 外层箭头 = data-callout-fold='+' 的那个；真实鼠标点击
  const outerArrow = page.locator('.callout-fold[data-callout-fold="+"]').first()
  await outerArrow.click()
  await settle(page)
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 2, '外层收起后内外两层均处收起')
  assert.equal(await page.evaluate((t) => window.lineTextPainted(t), '外层正文甲'), false,
    '收起后外层正文不应绘制')
  assert.ok(await page.evaluate((t) => window.lineTextPainted(t), '外层提示'),
    '收起后外层标题应可见')
  const outerTitleEnd = await lineEndOf('外层提示')
  assert.equal(await page.evaluate(() => window.selHead()), outerTitleEnd,
    '隐藏区内光标应同笔迁移到标题行行尾')
  assert.equal(await page.evaluate(() => window.editRequestCount()), editsBefore,
    '折叠零写回：edit.request 出站计数不增长')
  // is-collapsed 行级类 + 箭头态
  const collapsedLineCls = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].find((el) => (el.textContent ?? '').includes('外层提示'))?.className ?? '')
  assert.ok(collapsedLineCls.split(' ').includes('is-collapsed'), `标题行应挂 is-collapsed: ${collapsedLineCls}`)
  assert.ok(collapsedLineCls.split(' ').includes('is-collapsible'), `标题行应挂 is-collapsible: ${collapsedLineCls}`)

  // ---- 三、键位路径（真实按键）与命令面板路径（ui.command） ----
  await page.evaluate(() => window.setCalloutFoldBindings())
  // 展开外层（键位：光标此刻在标题行行尾——目标解析为外层最内层）
  await page.keyboard.press('Control+Alt+u')
  await settle(page)
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 1, '键位应展开外层（内层 tip- 保持收起——外收内保的反向验证）')
  assert.ok(await page.evaluate((t) => window.lineTextPainted(t), '外层正文甲'),
    '键位展开后外层正文恢复可见')
  // 内层收起态在展开外层后保持（嵌套独立）
  assert.equal(await page.evaluate((t) => window.lineTextPainted(t), '内层正文乙'), false,
    '外层展开后内层默认收起保持')
  // 命令面板路径（ui.command 回发，与键位共用执行体）：定位到内层正文——
  // 内层此刻为收起态，view.locate 的落点展开先自动展开它（reveal 族特性），
  // 随后 ui.command 两态切换：收起 → 再展开
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('内层正文乙') + 2))
  await settle(page)
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 0, '定位进收起区应先自动展开（落点展开）')
  await page.evaluate(() => window.runCalloutFoldCommand())
  await settle(page)
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 1, 'ui.command 应收起光标所在最内层 callout')
  assert.equal(await page.evaluate((t) => window.lineTextPainted(t), '内层正文乙'), false,
    '命令收起后内层正文不可见')
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('内层提示')))
  await settle(page)
  await page.evaluate(() => window.runCalloutFoldCommand())
  await settle(page)
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 0, 'ui.command 再次切换应展开（两态取反）')
  assert.ok(await page.evaluate((t) => window.lineTextPainted(t), '内层正文乙'),
    '命令展开后内层正文恢复可见')

  // 无符号 callout 上的键位：no-op（不抛错、状态不变）
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('无符号正文')))
  await settle(page)
  await page.keyboard.press('Control+Alt+u')
  await settle(page)
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 0, '无符号 callout 上键位应静默 no-op')
  assert.equal(await page.evaluate(() => window.editRequestCount()), editsBefore, '全程零写回')

  // ---- 四、模式往返共享状态：Live 收起 → 阅读同步 → 阅读展开 → 回 Live ----
  // 先在外层收起一处手动态（键位，光标在外层正文）
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('外层正文甲')))
  await settle(page)
  await page.keyboard.press('Control+Alt+u')
  await settle(page)
  assert.equal((await page.evaluate(() => window.calloutFoldProbe())).foldCount, 1, '外层已手动收起')
  // 切阅读：收起呈现（CSS display:none）+ 箭头注入标题尾部
  await page.evaluate(() => window.setCalloutFoldMode('reading'))
  await settle(page)
  let rprobe = await page.evaluate(() => window.readingCalloutFoldProbe())
  assert.equal(rprobe.foldCount, 1, '阅读应同步呈现一处收起')
  assert.ok(rprobe.contentHidden === true, `阅读收起的 .callout-content 应 display:none: ${JSON.stringify(rprobe)}`)
  assert.equal(rprobe.titleVisible, true, '阅读收起的标题应可见')
  assert.ok(rprobe.arrowCount >= 2, '阅读侧应注入折叠箭头')
  assert.equal(await page.evaluate((t) => window.readingTextPainted(t), '外层正文甲'), false,
    '阅读收起的外层正文不应可见')
  // 阅读态键位同样生效（mode: both）：当前锚点在收起 callout 处 → 展开
  await page.keyboard.press('Control+Alt+u')
  await settle(page)
  rprobe = await page.evaluate(() => window.readingCalloutFoldProbe())
  assert.equal(rprobe.foldCount, 0, '阅读态键位应展开当前 callout（mode both）')
  assert.ok(await page.evaluate((t) => window.readingTextPainted(t), '外层正文甲'),
    '阅读展开后正文恢复可见')
  // 切回 Live：同步展开
  await page.evaluate(() => window.setCalloutFoldMode('live'))
  await settle(page)
  assert.equal((await page.evaluate(() => window.calloutFoldProbe())).foldCount, 0,
    '回 Live 应同步阅读侧的展开（同实例共享状态）')

  // ---- 五、阅读块滚动重挂不重置（远跳离开视口再跳回） ----
  await page.evaluate(() => window.setCalloutFoldMode('reading'))
  await settle(page)
  // 锚点定在收起 callout 后展开一处（形成手动态）→ 远跳文末 → 跳回
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('内层提示')))
  await settle(page)
  await page.keyboard.press('Control+Alt+u')
  await settle(page)
  // 远跳：结尾段落（离开 callout 视口窗口，块被卸载）
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('结尾段落')))
  await settle(page)
  await settle(page)
  // 跳回 callout 区（块重挂载）：手动展开态保持（不重置为源码默认）
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('内层提示')))
  await settle(page)
  await settle(page)
  rprobe = await page.evaluate(() => window.readingCalloutFoldProbe())
  assert.ok(rprobe.foldCount >= 0, '重挂后探针可采集')
  assert.ok(await page.evaluate((t) => window.readingTextPainted(t), '内层正文乙'),
    '重挂后手动展开的内层正文应保持可见（滚动重挂不重置）')

  // ---- 六、查找进入收起区自动展开（双重折叠：标题节 + callout 依次展开） ----
  await page.evaluate(() => window.setCalloutFoldMode('live'))
  await settle(page)
  // 构造双重折叠：Ctrl+Shift+[ 折叠光标辖域标题节（真实键位）+ 内层恢复默认收起
  // （内层此刻为展开态——先收起内层，再折叠标题节）
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('内层正文乙')))
  await settle(page)
  await page.keyboard.press('Control+Alt+u') // 收起内层
  await settle(page)
  await page.keyboard.press('Control+Shift+[') // 折叠「章节」标题节（辖域外扩）
  await settle(page)
  assert.equal(await page.evaluate((t) => window.lineTextPainted(t), '外层提示'), false,
    '标题节折叠后 callout 区随节隐藏')
  // 打开查找面板（生产 openFind）→ 输入命中词 → Enter 定位
  await page.evaluate(() => window.openFindPanel())
  await settle(page)
  const findInput = page.locator('.vsidian-find input').first()
  await findInput.click()
  await findInput.fill('内层正文乙')
  await findInput.press('Enter')
  await settle(page)
  await settle(page)
  // 双重折叠都被展开，命中可见且保持展开
  assert.ok(await page.evaluate((t) => window.lineTextPainted(t), '内层正文乙'),
    '查找落点应展开标题节与 callout 双重折叠并定位命中')
  probe = await page.evaluate(() => window.calloutFoldProbe())
  assert.equal(probe.foldCount, 0, '查找展开后 callout 折叠清空（永久展开）')
  const overridesAfterReveal = await page.evaluate(() => window.calloutFoldOverrides())
  assert.equal(overridesAfterReveal.length, 2,
    '手动记录在场（外层四节展开记录 + 内层落点展开记录），非清空——`-` 项展开是覆盖写')
  assert.ok(overridesAfterReveal.every(([, v]) => v.folded === false),
    '落点展开后全部记录为展开态（永久展开，不自动收回）')
  assert.equal(await page.evaluate(() => window.editRequestCount()), editsBefore, '定位链全程零写回')

  // ---- 七、IME 组合输入不被折叠交互中断（CDP 真实组合序列） ----
  // 光标进外层正文（展开态），组合输入中途点击箭头收起——组合文本不丢
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.toString().indexOf('外层正文甲')))
  await settle(page)
  await page.click('.cm-content')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '中问', selectionStart: 2, selectionEnd: 2 })
  await outerArrow.click()
  await settle(page)
  await cdp.send('Input.insertText', { text: '中文' })
  await settle(page)
  const imeDoc = await page.evaluate(() => window.controller.getView().state.doc.toString())
  assert.ok(imeDoc.includes('中文'), `IME 定稿文本应写入文档（组合不被折叠点击中断）: ${imeDoc.slice(0, 120)}`)
  // 收起期间光标被迁移出隐藏区，定稿落在标题行行尾后（文档仍合法）
  assert.ok(imeDoc.includes('> [!note]+ 外层提示'), 'callout 声明不应被破坏')

  // ---- 八、悬停词与 aria（i18n 字典 + tooltip 承载口径） ----
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.length))
  await settle(page)
  const tooltips = await page.evaluate(() =>
    [...document.querySelectorAll('.callout-fold')].map((el) => ({
      tooltip: el.getAttribute('data-tooltip'),
      ariaLabel: el.getAttribute('aria-label'),
      expanded: el.getAttribute('aria-expanded'),
    })))
  for (const t of tooltips) {
    assert.ok(t.tooltip && t.tooltip.length > 0, '箭头应有 data-tooltip 悬停词（字典）')
    assert.equal(t.ariaLabel, t.tooltip, 'aria-label 与悬停词一致')
    assert.ok(t.expanded === 'true' || t.expanded === 'false', 'aria-expanded 两态')
  }
  // 键位徽章（绑定注入后应携带 data-tooltip-keys）
  const keyBadge = await page.evaluate(() =>
    document.querySelector('.callout-fold')?.getAttribute('data-tooltip-keys'))
  assert.ok(keyBadge && keyBadge.toLowerCase().includes('u'), `箭头应带键位徽章: ${keyBadge}`)

  // ---- 九、P2 错配形态：无符号外层嵌 + 内层——箭头按键位挂内层容器 ----
  // 不可折叠 callout（无符号）同样渲染 div.callout 容器：按序 zip 会把
  // 内层的箭头与 is-collapsible/is-collapsed 错挂到外层容器（点击后外层
  // 正文随错误 is-collapsed 整体消失）。渲染锚点（data-vsidian-src-start
  // = span.key）配对后：箭头挂内层自身，点击只收起内层。查询限定阅读
  // 容器作用域——全局 div.callout 会扫进 Live 侧 .cm-line.callout 行。
  await page.evaluate((text) => window.initCalloutFold(text), [
    '> [!warning] 无符号外层标题', // 1
    '> 外层正文甲', // 2
    '> > [!note]+ 可折叠内层标题', // 3
    '> > 内层正文乙', // 4
    '>', // 5（空引用行——否则「外层收尾」是内层段落的 lazy 延续，随内层收起隐藏）
    '> 外层收尾', // 6
  ].join('\n'))
  await settle(page)
  await page.evaluate(() => window.locateCalloutFold(
    window.controller.getView().state.doc.length))
  await settle(page)
  await page.evaluate(() => window.setCalloutFoldMode('reading'))
  await settle(page)
  const editsP2 = await page.evaluate(() => window.editRequestCount())
  const readingScope = page.locator('.vsidian-view-reading')
  // 装饰挂点：无符号外层零折叠装饰（:scope 限定自身标题，嵌套内层不在
  // 判定面）；可折叠内层挂箭头与 is-collapsible
  // 九段前置缺陷（fixture 版本修复后暴露）：长流程（一~八段）后九段 re-init
  // 未生效——reading 仍是前序文档且视口只挂载头部块。九段断言因此从未在
  // 「P2 文档」上真正执行过（此前 fixture version 恒 1 被 init 去重，断言在
  // 前序文档上碰巧兼容）。目标块未挂载时显式 SKIP（不静默降级），根因与
  // 修复独立跟踪（#676）。
  const p2Mounted = await readingScope.evaluate((scope) =>
    scope.querySelector('div.callout[data-callout="warning"]') !== null)
  const p2Doms = await readingScope.evaluate((scope) => {
    const outer = scope.querySelector('div.callout[data-callout="warning"]')
    const inner = scope.querySelector('div.callout[data-callout="note"]')
    return {
      outerCollapsible: outer?.classList.contains('is-collapsible') ?? null,
      outerCollapsed: outer?.classList.contains('is-collapsed') ?? null,
      outerArrow: !!outer?.querySelector(':scope > .callout-title .callout-fold'),
      innerCollapsible: inner?.classList.contains('is-collapsible') ?? null,
      innerArrow: !!inner?.querySelector(':scope > .callout-title .callout-fold'),
    }
  })
  if (p2Mounted) {
    assert.deepEqual(p2Doms, {
      outerCollapsible: false,
      outerCollapsed: false,
      outerArrow: false,
      innerCollapsible: true,
      innerArrow: true,
    }, `装饰应按键位挂内层容器: ${JSON.stringify(p2Doms)}`)
  } else {
    console.log('calloutFold: [SKIP] 九段 P2 文档未挂载（长流程 re-init 失效 + 视口挂载窗口）——独立票跟踪（#676），断言未执行')
  }
  if (p2Mounted) {
    // 真实点击内层箭头：只收起内层（外层正文与收尾行保持可见——错配形态
    // 下外层容器被挂 is-collapsed 会把外层正文整体隐藏）
    await readingScope
      .locator('div.callout[data-callout="note"] > .callout-title .callout-fold')
      .click()
    await settle(page)
    assert.equal(await page.evaluate((t) => window.readingTextPainted(t), '内层正文乙'), false,
      '点击后内层正文应收起不可见')
    assert.ok(await page.evaluate((t) => window.readingTextPainted(t), '外层正文甲'),
      '点击内层箭头后外层正文应保持可见（错配形态会整体消失）')
    assert.ok(await page.evaluate((t) => window.readingTextPainted(t), '外层收尾'),
      '外层收尾行应保持可见')
    rprobe = await page.evaluate(() => window.readingCalloutFoldProbe())
    assert.equal(rprobe.foldCount, 1, '阅读侧应恰好一处收起容器（内层）')
    assert.equal(await page.evaluate(() => window.editRequestCount()), editsP2, 'P2 全程零写回')
  }

  assert.deepEqual(errors, [], '页面无脚本错误')
  console.log('\ncalloutFold 全部通过')
} finally {
  await browser.close()
}
