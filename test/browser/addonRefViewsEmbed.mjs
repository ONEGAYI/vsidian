// T06（#545）附加组件只读引用嵌入的原生浏览器回归：生产控制器 + 生产
// 装载器 + 生产引用视图运行时（addonRefViewsFixture 装配——与生产 main.js
// 同源），组件产物经本地 http 服务真实装载，在**真实组件面板**（T11
// ui.registerPanel 的内容根）挂载内核只读引用子根。场景（绘制层断言——
// 用户看到的东西）：
// 1. 面板内嵌入可见：引用卡片实际绘制（elementFromPoint 命中 + 引用竖条
//    计算色 + 标题条下边线 + 目标内容文本）；
// 2. 只读硬边界：模式入口不显示、零 refEdit.bind、零 edit.request（R-U04）；
// 3. 双实例滚动不串用：同目标两处挂载各自滚动（R-U10）；
// 4. 正文不变：挂载/滚动/释放全程主正文用户可见文本与出站写通道不变
//    （R-U09；宿主撤销历史按架构经文本管线，真宿主用例按文档版本断言）；
// 5. 重复挂载仲裁：同容器未释放前 duplicate-mount，释放后可重挂；
// 6. 容器归属：正文外容器（body）拒绝 invalid-request；
// 7. 整组释放：句柄释放撤子根、面板关闭（容器脱树）自动释放剩余挂载。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons, CM6_RUNTIME_MARKERS } from '../fixtures/addon-v02/sdk/buildAddon.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonRefViewsEmbed.js')
const ADDON_ID = 'vsidian-test-fixture.addon-refviews'

// ---- 0. 组件产物构建 + 静态红线（CM6 不重打包） ----
const layout = await buildTestAddons({ log: () => {} })
const rvEntry = path.join(layout.refViewsAddon.distDir, 'editor.js')
const product = await readFile(rvEntry, 'utf8')
for (const marker of CM6_RUNTIME_MARKERS) {
  assert.ok(!product.includes(marker), `组件产物不得含 CM6 运行时标记（${marker}）`)
}
console.log(`[T06][ok] 组件产物 ${rvEntry}（${(await stat(rvEntry)).size} B，无 CM6 标记）`)

// ---- 1. 夹具构建 ----
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
await esbuild({ entryPoints: [path.join(root, 'test/browser/addonRefViewsFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// ---- 2. 组件产物 http 服务 ----
const MIME = { '.js': 'text/javascript', '.css': 'text/css' }
const assetServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const filePath = path.join(layout.refViewsAddon.distDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
    const data = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve) => assetServer.listen(0, '127.0.0.1', resolve))
const scriptUrl = `http://127.0.0.1:${assetServer.address().port}/editor.js`

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate(() => window.initRvDoc('# 父文档\n\n正文一段，展示请求不改写正文。\n'))
  const mainTextBefore = await page.evaluate(() => window.rvMainText())
  const sentBaseline = await page.evaluate(() => window.rvSent().length)

  const loadOutcome = await page.evaluate((uri) => window.rvLoad('vsidian-test-fixture.addon-refviews', uri), scriptUrl)
  assert.ok(loadOutcome.ok, `组件装载应成功（${JSON.stringify(loadOutcome)}）`)
  await page.waitForFunction(() => window.rvRegistrations().length > 0)

  const pumpUntil = async (pred, label, timeoutMs = 6000) => {
    const start = Date.now()
    for (;;) {
      page.evaluate(() => window.rvPump())
      if (await pred()) return
      if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`)
      await page.waitForTimeout(80)
    }
  }
  const runOp = async (op, args) => {
    const seq = await page.evaluate(([o, a]) => window.rvQueue(o, a), [op, args])
    await pumpUntil(() => page.evaluate((s) => window.rvPeek().some((r) => r.seq === s), seq), `rv.${op} 结局`)
    const outcome = await page.evaluate((s) => window.rvCollect().find((r) => r.seq === s)?.outcome, seq)
    assert.notEqual(outcome, undefined, `rv.${op} 应有结局`)
    return outcome
  }

  await runOp('openPanel')
  await page.waitForSelector('.rv-embed-slot-1', { state: 'attached' })
  passed++; console.log('[T06][ok] 组件装载、面板打开与嵌入容器在场')

  // ---- 场景 1：真实面板内嵌入可见（绘制层） ----
  const mount1 = await runOp('embed', { id: 'e1', path: 'notes/b.md' })
  assert.deepEqual(mount1, { ok: true }, `面板内容根挂载应成功（${JSON.stringify(mount1)}）`)
  await pumpUntil(() => page.evaluate(() => { const e = window.readRvEmbed(1); return e.present && e.card && e.stateHidden }))
  await page.waitForTimeout(150) // 布局稳定
  const embed1 = await page.evaluate(() => window.readRvEmbed(1))
  assert.ok(embed1.hitInside, '卡片绘制层命中（elementFromPoint 落卡片内——非透明/被遮挡）')
  assert.notEqual(embed1.borderLeftColor, 'rgba(0, 0, 0, 0)', '引用竖条实际着色（面板容器锚点命中——样式注入失效时透明）')
  assert.equal(embed1.borderLeftWidth, '3px', '引用竖条宽度（卡片壳规则）')
  assert.ok(embed1.text.includes('B 目标标题'), `卡片应绘制目标内容（实际 ${embed1.text.slice(0, 40)}）`)
  passed++; console.log('[T06][ok] 面板内嵌入可见：绘制层命中 + 引用竖条计算色 + 内容文本')

  // ---- 场景 2：只读硬边界（R-U04 复验） ----
  assert.equal(embed1.modeDisplay, 'none', '只读嵌入不显示模式切换入口')
  const writeMessages = await page.evaluate((from) => window.rvSent().slice(from)
    .filter((m) => m.kind === 'edit.request' || m.kind === 'refEdit.bind'), sentBaseline)
  assert.deepEqual(writeMessages, [], '嵌入请求面零写回（edit.request / refEdit.bind 不出站）')
  passed++; console.log('[T06][ok] 只读硬边界：模式入口隐藏 + 零写端口')

  // ---- 场景 3：双实例滚动不串用（R-U10） ----
  const mount2 = await runOp('embed', { id: 'e2', path: 'notes/b.md', slot: 2 })
  assert.deepEqual(mount2, { ok: true })
  await pumpUntil(() => page.evaluate(() => { const e = window.readRvEmbed(2); return e.present && e.card && e.stateHidden }))
  const scrolled = await page.evaluate(() => window.rvEmbedScroll(1, 120))
  assert.ok(scrolled, '容器 1 滚动写入应命中')
  await page.waitForTimeout(120)
  const [s1, s2] = await page.evaluate(() => [window.readRvEmbed(1), window.readRvEmbed(2)])
  assert.ok(s1.scrollTop > 100, `容器 1 应保持滚动位置（实际 ${s1.scrollTop}）`)
  assert.equal(s2.scrollTop, 0, `容器 2 不随容器 1 滚动（实际 ${s2.scrollTop}——双实例滚动独立）`)
  passed++; console.log('[T06][ok] 同目标双实例：滚动各自独立不串用')

  // ---- 场景 4：正文不变（R-U09） ----
  const mainTextAfter = await page.evaluate(() => window.rvMainText())
  assert.equal(mainTextAfter, mainTextBefore, '展示请求不改变主正文用户可见文本')

  // ---- 场景 5：重复挂载仲裁 ----
  const dup = await runOp('embed', { id: 'e3', path: 'notes/b.md' })
  assert.deepEqual(dup, { ok: false, reason: 'duplicate-mount' }, `同容器未释放前重复挂载应拒绝（${JSON.stringify(dup)}）`)
  const release1 = await runOp('embedRelease', { id: 'e1' })
  assert.equal(release1, true, '句柄释放成功')
  await pumpUntil(() => page.evaluate(() => window.readRvEmbed(1).childCount === 0), '释放后子根撤下')
  const active2 = await runOp('embedActive', { id: 'e2' })
  assert.equal(active2, true, '释放其一不影响另一处挂载')
  const remount = await runOp('embed', { id: 'e4', path: 'notes/b.md' })
  assert.deepEqual(remount, { ok: true }, '释放后同容器可重挂')
  passed++; console.log('[T06][ok] 重复挂载仲裁：duplicate-mount → 释放 → 可重挂')

  // ---- 场景 6：容器归属 ----
  const outside = await runOp('embed', { id: 'e5', path: 'notes/b.md', container: 'body' })
  assert.deepEqual(outside, { ok: false, reason: 'invalid-request' }, `非本组件容器拒绝（${JSON.stringify(outside)}）`)

  // ---- 场景 7：正文复核 + 面板关闭整组释放 ----
  const mainTextEnd = await page.evaluate(() => window.rvMainText())
  assert.equal(mainTextEnd, mainTextBefore, '全程主正文不变（含重挂/释放）')
  const writeAll = await page.evaluate((from) => window.rvSent().slice(from)
    .filter((m) => m.kind === 'edit.request' || m.kind === 'refEdit.bind'), sentBaseline)
  assert.deepEqual(writeAll, [], '全程零写通道出站（正文文本与宿主撤销历史不变——撤销经文本管线的结构性保证）')
  await runOp('closePanel')
  await pumpUntil(() => page.evaluate(() => !document.querySelector('.vsidian-addon-panel')), '面板关闭脱树')
  const active4 = await runOp('embedActive', { id: 'e4' })
  assert.equal(active4, false, '面板关闭（容器脱树）后挂载自动释放')
  passed++; console.log('[T06][ok] 整组释放：面板关闭自动释放 + 全程零正文写入')

  assert.deepEqual(errors, [], `页面零未捕获异常（${errors.join(' | ')}）`)
} finally {
  await browser.close()
  assetServer.close()
}
console.log(`[T06] addonRefViewsEmbed 浏览器回归全部通过（${passed} 组）`)
