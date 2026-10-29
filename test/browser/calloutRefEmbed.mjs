// T08（#659）引用实例 Callout 的原生浏览器回归：真实 Chromium + 生产
// 控制器 + 产物 CSS。断言用户看到的东西（AGENTS 视觉层断言）：
// - Reading 嵌入卡内 callout 呈现（容器/标题/图标位/正文）与 `-` 默认
//   收起（.callout-content display:none——绘制层而非 DOM 存在性）
// - 真实点击箭头展开；两个引用位置（相邻同文件实例）各自开合独立
// - 折叠零写回（edit.request 出站计数零增长）
// - Reading → Live 模式往返：StateField 灌入同一 overrides；Live 内翻转
//   切回 Reading 保持（同实例共享状态）
// - 切回 Reading 后卡内无遗留 CM6 编辑器（资源回基线）
// - 片段设 --callout-icon 后注入 SVG 图标并真实绘制（宽度 > 0）
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutRefEmbed/calloutRefEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutRefEmbedFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const MAIN_DOC = '![[目标笔记]]\n\n中间段落。\n\n![[目标笔记]]\n'
const B_DOC = [
  '# 目标笔记', // 1
  '', // 2
  '> [!note]- 默认收起提示', // 3
  '> 隐藏正文第一段。', // 4
  '> 隐藏正文第二行。', // 5
  '', // 6
  '> [!info] 无符号提示', // 7
  '> 无符号正文。', // 8
].join('\n')

/** 帧同步等待（块挂载与装饰落地） */
const settle = (page) =>
  page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
/** 微任务排空（伪造宿主桥 queueMicrotask 应答链路） */
const drain = (page) => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)))

try {
  const page = await browser.newPage({ viewport: { width: 760, height: 520 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate(({ m, b }) => window.initCalloutRefEmbed(m, b), { m: MAIN_DOC, b: B_DOC })
  await drain(page)
  await settle(page)

  // ---- 一、Reading 呈现：两卡 callout 家族 + 默认收起（绘制层） ----
  for (const idx of [0, 1]) {
    const note = await page.evaluate((i) => window.refCalloutInfo(i, 'note'), idx)
    assert.ok(note.present, `卡 ${idx} 应呈现 note callout`)
    assert.equal(note.titleText, '默认收起提示')
    assert.ok(note.collapsible && note.collapsed, `卡 ${idx} note 默认收起（- 声明）`)
    assert.equal(note.contentDisplay, 'none', `卡 ${idx} 收起正文 display:none（不可见而非 DOM 缺席）`)
    assert.equal(note.arrowCount, 1)
    assert.ok(note.iconPainted, `卡 ${idx} 图标位真实绘制（默认 mask 通道）`)
    const info = await page.evaluate((i) => window.refCalloutInfo(i, 'info'), idx)
    assert.ok(info.present && !info.collapsible && info.arrowCount === 0, '无符号 callout 无箭头不可折叠')
    assert.notEqual(info.contentDisplay, 'none', '无符号正文照常可见')
  }
  assert.ok(errors.length === 0, `页面无错误：${errors.join(' | ')}`)

  // ---- 二、真实点击箭头展开；两实例独立；零写回 ----
  const editCountBefore = await page.evaluate(() =>
    window.refSent().filter((m) => m.kind === 'edit.request').length)
  assert.ok(await page.evaluate(() => window.refClickArrow(0, 'note')), '卡 0 箭头在场可点击')
  await settle(page)
  const card0 = await page.evaluate(() => window.refCalloutInfo(0, 'note'))
  const card1 = await page.evaluate(() => window.refCalloutInfo(1, 'note'))
  assert.ok(!card0.collapsed && card0.contentDisplay !== 'none', '卡 0 点击后展开（正文可见）')
  assert.ok(card1.collapsed && card1.contentDisplay === 'none', '卡 1 不受卡 0 翻转影响（实例独立）')
  const editCountAfter = await page.evaluate(() =>
    window.refSent().filter((m) => m.kind === 'edit.request').length)
  assert.equal(editCountAfter, editCountBefore, 'Reading 折叠翻转零源文写回')

  // ---- 三、Reading → Live：StateField 灌入同一 overrides（展开不复活收起） ----
  assert.ok(await page.evaluate(() => window.refToggleCardMode(0)), '模式按钮在场')
  await drain(page)
  await settle(page)
  let folds = await page.evaluate(() => window.refEmbedFoldField())
  assert.equal(folds.length, 1, '卡 0 Live StateField 含 Reading 期间的手动翻转')
  assert.equal(folds[0].folded, false, '手动展开随模式往返带入 Live')
  assert.equal(folds[0].declFold, '-')

  // ---- 四、Live 内翻转 → 切回 Reading：导出保持（同实例共享状态） ----
  await page.evaluate(() => {
    const arrow = document.querySelector('.vsidian-embed-card .callout-fold')
    if (arrow instanceof HTMLElement) arrow.click()
  })
  await settle(page)
  folds = await page.evaluate(() => window.refEmbedFoldField())
  assert.equal(folds[0].folded, true, 'Live 内箭头点击翻转回收起')
  assert.ok(await page.evaluate(() => window.refToggleCardMode(0)), '切回 Reading')
  await drain(page)
  await settle(page)
  const afterBack = await page.evaluate(() => window.refCalloutInfo(0, 'note'))
  assert.ok(afterBack.collapsed && afterBack.contentDisplay === 'none',
    '切回 Reading 后按 Live 翻转结果呈现（收起保持）')
  const card1After = await page.evaluate(() => window.refCalloutInfo(1, 'note'))
  assert.ok(card1After.collapsed, '另一实例仍按自身状态（互不串扰）')
  assert.equal(await page.evaluate(() => window.refEmbedEditorCount()), 0,
    '切回 Reading 后卡内无遗留 CM6 编辑器（资源回基线）')
  assert.ok(errors.length === 0, `页面无错误：${errors.join(' | ')}`)

  // ---- 五、片段 --callout-icon 注入：重挂后 SVG 图标真实绘制 ----
  // 片段形态与 calloutIcon.mjs 同型：元素直接命中（类型表 :where() 零
  // 特异性——继承值（:root）会被容器上的直接声明恒胜，不能走 :root）
  await page.evaluate(() => window.refInjectSnippet(
    "[data-callout='note'], [data-callout='info'] { --callout-icon: lucide-flame; }"))
  await page.evaluate(({ m, b }) => window.initCalloutRefEmbed(m, b), { m: MAIN_DOC, b: B_DOC })
  await drain(page)
  await settle(page)
  const custom = await page.evaluate(() => window.refCalloutInfo(0, 'note'))
  assert.ok(custom.iconInjected, '片段定制后图标走注入通道（内部类在场）')
  assert.ok(custom.iconSvg, '注入产物为 SVG 子元素')
  assert.ok(custom.iconPainted, '注入图标真实绘制（宽度 > 0）')
  const plain = await page.evaluate(() => window.refCalloutInfo(0, 'info'))
  assert.ok(plain.iconInjected && plain.iconPainted, '全部类型均消费同一注入面')

  assert.ok(errors.length === 0, `页面无错误：${errors.join(' | ')}`)

  // ---- 六、嵌入内类型菜单预览身份：探针 docScope 取目标文档（T07 评审移交 T08） ----
  await page.evaluate(({ m, b }) => window.initCalloutRefEmbed(m, b), { m: MAIN_DOC, b: B_DOC })
  await drain(page)
  await settle(page)
  assert.ok(await page.evaluate(() => window.refToggleCardMode(0)), '切 Live（菜单预览身份用例前置）')
  await drain(page)
  await settle(page)
  assert.ok(await page.evaluate(() => window.refContextMenuAtCallout(0, 'note')),
    '嵌入内 callout 标题行右键应可达（contentDOM 转发链路在场）')
  await settle(page)
  // 右键命中 callout 标题行：菜单直接携带「修改类型」与类型页（calloutType:*）
  const menuState = await page.evaluate(() => ({
    open: !!document.querySelector('.vsidian-context-menu'),
    typeRows: document.querySelectorAll('.vsidian-context-menu button[data-vsidian-command^="calloutType:"]').length,
  }))
  assert.ok(menuState.open, '右键后统一菜单应打开（嵌入转发链路）')
  assert.ok(menuState.typeRows >= 14, `类型页应在场（实际 ${menuState.typeRows} 行）`)
  const bScope = await page.evaluate(() => window.refBDocScope())
  const probeScope = await page.evaluate(() => window.refMenuProbeDocScope())
  assert.ok(probeScope !== null, '类型页在场时预览探针应挂载')
  assert.equal(probeScope, bScope, `探针文档样式身份应取嵌入目标 B（期望 ${bScope}，实际 ${probeScope}）`)
  assert.notEqual(probeScope, 'doc', '不得回落根文档身份（T07 评审发现的缺口）')
  assert.ok(errors.length === 0, `页面无错误：${errors.join(' | ')}`)

  console.log('calloutRefEmbed: 全部断言通过')
} finally {
  await browser.close()
}
