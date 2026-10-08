// #410 附加组件标题折叠 API——生产链路消费回归（Playwright 生产构建）。
// 夹具（addonHeadingFoldFixture.ts）装配生产 WebviewSyncController + 生产
// 装载器 + 统一视图注册表；折叠夹具组件（fold-addon，公开 SDK 的
// experimental.headingFold 消费者）经本地 http 服务以真实 URL 装载。
// 指令经「宿主收件箱 ↔ 组件短轮询」驱动（fold.next / fold.result），
// 断言面：
// - 组件回报的 API 结果（查询 spans / 命令 applied / 拒绝码）；
// - view.state.paint.headingFold 探针（绘制层：折叠后隐藏区不可见、
//   省略号占位可见——#414 T03 同探针口径）；
// - 编辑器文本与出站通道（零写回：折叠全程不产生 edit.request）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonHeadingFold.js')

// ---- 0. 夹具组件构建（构建桥 + CM6 静态红线） ----
const layout = await buildTestAddons({ log: () => {} })
const addonScript = layout.foldAddon.distDir + '/editor.js'

// ---- 1. 测试夹具构建（katex 裸导入与字体裁剪同 addonPageSdk 口径） ----
const katexFontStrip = {
  name: 'katex-font-fallback-strip',
  setup(b) {
    b.onLoad({ filter: /katex\.min\.css$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(
        /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\((["']?)(?:woff|truetype)\1\)/g, ''),
      loader: 'css',
    }))
  },
}
const katexMinJs = {
  name: 'katex-min-js',
  setup(b) {
    b.onResolve({ filter: /^katex$/ }, () => ({
      path: path.resolve(root, 'node_modules/katex/dist/katex.min.js'),
    }))
  },
}
await esbuild({ entryPoints: [path.join(root, 'test/browser/addonHeadingFoldFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// ---- 2. 组件产物经本地 http 服务（与真宿主 asWebviewUri 地址同机制） ----
const server = createServer(async (req, res) => {
  if (req.url === '/editor.js') {
    res.setHeader('content-type', 'application/javascript')
    res.end(await readFile(addonScript))
    return
  }
  res.statusCode = 404
  res.end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const addonUri = `http://127.0.0.1:${server.address().port}/editor.js`

// 文档与单测同族：T1/T2 可折叠（嵌套）、Empty 空节不可折叠、Blank 含 tail
const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# Empty\n# Blank\n\ntail\n'
const T1_KEY = 0
const T2_KEY = DOC.indexOf('## T2')
const BLANK_KEY = DOC.indexOf('# Blank')
/** 标题块行尾（hideFrom 的期望值——从 marker 行首找首个换行，免手算） */
const lineEndOf = (marker) => DOC.indexOf('\n', DOC.indexOf(marker))
const EMPTY_KEY = DOC.indexOf('# Empty')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 7

const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>')
await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
await page.addScriptTag({ path: bundle })
await page.setViewportSize({ width: 900, height: 700 })
await page.evaluate((text) => { window.initDoc(text) }, DOC)
await page.evaluate(() => document.body.style.setProperty('margin', '0'))

try {
  // ---- 场景 1：装载组件，实验入口在场，查询面语义 ----
  const loadOutcome = await page.evaluate((uri) => window.loadFoldAddon(uri, 1), addonUri)
  assert.deepEqual(loadOutcome, { ok: true, css: [] }, `组件应装载成功：${JSON.stringify(loadOutcome)}`)
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('facetMissing')), { missing: false }, '实验入口应在场')
  const foldable = await page.evaluate(() => window.runFoldOp('foldable', { instanceId: 'main' }))
  assert.deepEqual(foldable, {
    ok: true,
    spans: [
      { key: T1_KEY, level: 1, hideFrom: lineEndOf('# T1'), hideTo: EMPTY_KEY },
      { key: T2_KEY, level: 2, hideFrom: lineEndOf('## T2'), hideTo: EMPTY_KEY },
      { key: BLANK_KEY, level: 1, hideFrom: lineEndOf('# Blank'), hideTo: DOC.length },
    ],
  }, `foldable 应为三区间：${JSON.stringify(foldable)}`)
  const folds0 = await page.evaluate(() => window.runFoldOp('folds', { instanceId: 'main' }))
  assert.deepEqual(folds0, { ok: true, spans: [] }, '初始无折叠')
  passed++
  console.log('[PASS] 装载与查询面（facetMissing=false、foldable 三区间、folds 空）')

  // ---- 场景 2：foldAt 折叠 + 绘制层断言（隐藏区不可见、省略号可见）----
  const beforeText = (await page.evaluate(() => window.readEditor())).text
  const foldAt = await page.evaluate((key) => window.runFoldOp('foldAt', { instanceId: 'main', keys: [key] }), T1_KEY)
  assert.deepEqual(foldAt, { ok: true, applied: 1 }, `foldAt 应折一区间：${JSON.stringify(foldAt)}`)
  let probe = await page.evaluate(() => window.foldProbe())
  assert.equal(probe.foldCount, 1, `探针折叠数应为 1：${JSON.stringify(probe)}`)
  assert.equal(probe.hiddenLinePainted, false, '折叠后隐藏区首个非空行（alpha）不可见——绘制层断言')
  assert.equal(probe.ellipsisVisible, true, '省略号占位可见且命中')
  assert.equal(probe.ellipsisText, '⋯')
  assert.equal(probe.arrowCollapsed, true, '折叠态箭头常显在场')
  const afterText = (await page.evaluate(() => window.readEditor())).text
  assert.equal(afterText, beforeText, '折叠零写回：文本不变')
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1_KEY], '本体键集含 T1（独立对照）')
  const folds1 = await page.evaluate(() => window.runFoldOp('folds', { instanceId: 'main' }))
  assert.deepEqual(folds1, {
    ok: true,
    spans: [{ key: T1_KEY, level: 1, hideFrom: lineEndOf('# T1'), hideTo: EMPTY_KEY }],
  }, `folds 应返回 T1 派生区间：${JSON.stringify(folds1)}`)
  passed++
  console.log('[PASS] foldAt 折叠（applied=1、绘制层隐藏/省略号、零写回、本体键集对照）')

  // ---- 场景 3：apply 选区驱动三操作（与用户触发同链路） ----
  await page.evaluate((offset) => window.setCursor(offset), DOC.length) // 光标到 tail 内：辖域 Blank
  const foldBlank = await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'fold' }))
  assert.deepEqual(foldBlank, { ok: true, applied: 1 }, `选区驱动 fold 应折 Blank：${JSON.stringify(foldBlank)}`)
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1_KEY, BLANK_KEY], '键集 T1+Blank')
  // 光标在折叠区间内（tail 折叠后迁移到标题行尾）：unfold 展开最深包含折叠
  const unfoldBlank = await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'unfold' }))
  assert.deepEqual(unfoldBlank, { ok: true, applied: 1 }, `选区驱动 unfold：${JSON.stringify(unfoldBlank)}`)
  // toggle：光标到 T2 行内两态取反
  await page.evaluate((offset) => window.setCursor(offset), T2_KEY + 1)
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'toggle' })), { ok: true, applied: 1 })
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1_KEY, T2_KEY], 'toggle 折 T2')
  // 嵌套折叠光标迁移（本体语义）：折 T2 时光标 14 落在已折叠 T1 区间
  // (4, 26) 内，迁移到 T1 标题行尾——二次 toggle 前须重新定位（API 语义
  // 下选区驱动操作的定位责任在调用方）
  await page.evaluate((offset) => window.setCursor(offset), T2_KEY + 1)
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'toggle' })), { ok: true, applied: 1 })
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1_KEY], 'toggle 展 T2')
  passed++
  console.log('[PASS] apply 选区驱动三操作（fold/unfold/toggle 与用户触发同链路）')

  // ---- 场景 4：foldAll 参数化与 unfoldAt 批量 ----
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'foldAll' })), { ok: true, applied: 2 }, 'foldAll 全量（T1 已折 + Blank/T2）')
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1_KEY, T2_KEY, BLANK_KEY])
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'unfoldAll' })), { ok: true, applied: 3 })
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'foldAll', options: { upToLevel: 1 } })), { ok: true, applied: 2 }, 'upToLevel=1 只折 level 1')
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1_KEY, BLANK_KEY], 'T2（level 2）不折')
  assert.deepEqual(await page.evaluate((keys) => window.runFoldOp('unfoldAt', { instanceId: 'main', keys }), [T1_KEY, BLANK_KEY]), { ok: true, applied: 2 })
  assert.deepEqual(await page.evaluate(() => window.foldKeys()), [], '全展开')
  passed++
  console.log('[PASS] foldAll/upToLevel 参数化与 unfoldAt 批量组合')

  // ---- 场景 5：拒绝矩阵（脱靶键静默、形状非法、未知句柄） ----
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('foldAt', { instanceId: 'main', keys: [42] })), { ok: true, applied: 0 }, '脱靶键静默忽略')
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('foldAt', { instanceId: 'main', keys: [1.5] })), { ok: false, reason: 'invalid-request' }, '非整数键拒绝')
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('apply', { instanceId: 'main', operation: 'fold', options: { upToLevel: 1 } })), { ok: false, reason: 'invalid-request' }, 'upToLevel 仅 foldAll 接受')
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('folds', { instanceId: 'ghost' })), { ok: false, reason: 'view-disposed' }, '未知句柄拒绝')
  passed++
  console.log('[PASS] 拒绝矩阵（脱靶静默 / invalid-request / view-disposed）')

  // ---- 场景 6：Live-only（切阅读模式拒绝 read-only，回 Live 恢复） ----
  await page.evaluate(() => window.switchMode('reading'))
  await page.waitForTimeout(300)
  assert.deepEqual(await page.evaluate(() => window.runFoldOp('folds', { instanceId: 'main' })), { ok: false, reason: 'read-only' }, '阅读模式拒绝')
  await page.evaluate(() => window.switchMode('live'))
  await page.waitForTimeout(300)
  const foldsBack = await page.evaluate(() => window.runFoldOp('folds', { instanceId: 'main' }))
  assert.equal(foldsBack.ok, true, '回 Live 后查询恢复')
  passed++
  console.log('[PASS] Live-only（阅读拒绝 read-only、回 Live 恢复）')

  // ---- 场景 7：卸载回收（迟到指令不再消费，通道退出） ----
  assert.deepEqual(await page.evaluate(() => window.unloadFoldAddon(1)), { ok: true })
  // 塞一条迟到指令：卸载后组件循环已退出，指令滞留队列、无 fold.result 回报
  await page.evaluate(() => window.queueFoldCmd('folds', { instanceId: 'main' }))
  await page.waitForTimeout(800)
  assert.deepEqual(await page.evaluate(() => window.takeFoldResults()), [], '卸载后迟到指令不被消费（空收件）')
  passed++
  console.log('[PASS] 卸载回收（组件循环退出，迟到指令不消费）')

  assert.deepEqual(errors, [], '页面错误')
  console.log(`[标题折叠 API] ${passed}/${total} 场景通过`)
} finally {
  await browser.close()
  server.close()
}
if (passed !== total) {
  throw new Error(`场景未全过：${passed}/${total}`)
}
