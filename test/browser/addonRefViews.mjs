// T05（#544）附加组件只读引用浮窗的原生浏览器回归：生产控制器 + 生产
// 装载器 + 生产引用视图运行时 + 生产界面运行时（addonRefViewsFixture 装配
// ——与生产 main.js 同源），组件产物（refviews-addon 经 V02 构建桥
// chrome114 IIFE）经本地 http 服务真实装载。场景（真实指针/键盘 + 绘制层
// 断言——用户看到的东西，非 DOM 存在性）：
// 1. 触发位置旁的实际浮窗：组件面板触发按钮旁出现浮窗（几何邻近 +
//    elementFromPoint 命中 + 内容文本绘制 + 背景实底）；
// 2. 单实例仲裁：新请求替换旧请求（旧请求 view-disposed、旧句柄不误关）；
// 3. 键盘路径：焦点进入浮层（R-U12），Esc 关闭并归还原焦点；
// 4. 来源消失关闭：关闭组件面板（触发控件脱树）→ 浮窗关闭、请求以
//    view-disposed 终结；
// 5. 只读绘制：浮窗在场期间零 edit.request 出站（请求面无写回通道）；
// 6. 错误内容：目标缺失 → 浮窗就地错误分态 + 请求结果 not-found；
// 7. 来源 B（消息层）：hover 实例为来源的请求携带 addonSource（R-U02 的
//    浏览器侧证据——真实目录解析由真宿主集成用例覆盖）。
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
const bundle = path.join(root, 'out/test/browser/addonRefViews.js')
const ADDON_ID = 'vsidian-test-fixture.addon-refviews'

// ---- 0. 组件产物构建 + 静态红线（CM6 不重打包） ----
const layout = await buildTestAddons({ log: () => {} })
const rvEntry = path.join(layout.refViewsAddon.distDir, 'editor.js')
const product = await readFile(rvEntry, 'utf8')
for (const marker of CM6_RUNTIME_MARKERS) {
  assert.ok(!product.includes(marker), `组件产物不得含 CM6 运行时标记（${marker}）`)
}
console.log(`[T05][ok] 组件产物 ${rvEntry}（${(await stat(rvEntry)).size} B，无 CM6 标记）`)

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
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  // 84e91ea0 的既有 hover-popup DOM 入口：独立片段须命中真实绘制节点。
  await page.addStyleTag({ content: '#app > .vsidian-hover-popup { outline: 1px solid rgb(17, 91, 133); }' })
  await page.addScriptTag({ path: bundle })
  await page.evaluate(() => window.initRvDoc('# 父文档\n\n正文一段。\n'))

  const loadOutcome = await page.evaluate((uri) => window.rvLoad('vsidian-test-fixture.addon-refviews', uri), scriptUrl)
  assert.ok(loadOutcome.ok, `组件装载应成功（${JSON.stringify(loadOutcome)}）`)
  await page.waitForFunction(() => window.rvRegistrations().length > 0)
  await page.waitForSelector('.rv-trigger', { state: 'attached' })
  passed++; console.log('[T05][ok] 组件装载、面板挂载与触发控件在场')

  const pumpUntil = async (pred, label, timeoutMs = 6000) => {
    const start = Date.now()
    for (;;) {
      page.evaluate(() => window.rvPump())
      if (await pred()) return
      if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`)
      await page.waitForTimeout(80)
    }
  }
  /** 指令收发（seq 配对） */
  const runOp = async (op, args) => {
    const seq = await page.evaluate(([o, a]) => window.rvQueue(o, a), [op, args])
    await pumpUntil(() => page.evaluate((s) => window.rvPeek().some((r) => r.seq === s), seq), `rv.${op} 结局`)
    const outcome = await page.evaluate((s) => window.rvCollect().find((r) => r.seq === s)?.outcome, seq)
    assert.notEqual(outcome, undefined, `rv.${op} 应有结局`)
    return outcome
  }

  // ---- 场景 1：触发位置旁的实际浮窗（绘制层） ----
  const triggerBox = await page.locator('.rv-trigger').boundingBox()
  assert.ok(triggerBox, '触发按钮应有几何')
  await runOp('request', { id: 'r1', path: 'notes/b.md' })
  await pumpUntil(() => page.evaluate(() => window.readRvPopup().open))
  await page.waitForTimeout(150) // 内容装载后布局稳定
  const popup1 = await page.evaluate(() => window.readRvPopup())
  assert.ok(popup1.open, '浮窗应在场')
  assert.ok(popup1.hitInside, '浮窗绘制层命中（elementFromPoint 落浮窗内——非 display:none/被遮挡）')
  assert.notEqual(popup1.background, 'rgba(0, 0, 0, 0)', '浮窗背景实底（样式注入失效时透明——视觉层断言）')
  assert.equal(popup1.outlineColor, 'rgb(17, 91, 133)', '历史浮窗选择器命中实际绘制节点')
  assert.ok(popup1.text.includes('B 目标标题'), `浮窗应绘制目标内容（实际 ${popup1.text.slice(0, 40)}）`)
  // 几何邻近：浮窗垂直跨度与触发按钮带相接（上方翻转或下方贴靠——
  // hoverPopupGeometry 四边翻转；非屏幕中心兜底）
  const popupBottom = popup1.rect.top + popup1.rect.height
  assert.ok(popupBottom >= triggerBox.y - 8 && popup1.rect.top <= triggerBox.y + triggerBox.height + 8,
    `浮窗应贴邻触发按钮（trigger@${triggerBox.y}+${triggerBox.height}，popup ${popup1.rect.top}~${popupBottom}）`)
  assert.ok(popup1.rect.left >= 0 && popup1.rect.top >= 0 &&
    popup1.rect.left + popup1.rect.width <= 900 && popup1.rect.top + popup1.rect.height <= 640,
    '浮窗在视口内（钳制）')
  passed++; console.log('[T05][ok] 触发位置旁的实际浮窗（几何邻近 + 绘制层命中 + 内容文本）')

  // ---- 场景 5（先钉）：只读——浮窗在场期间零 edit.request ----
  const editCount = await page.evaluate(() => window.rvSent().filter((m) => m.kind === 'edit.request').length)
  assert.equal(editCount, 0, '引用请求面零写回（edit.request 不出站）')
  const bindCount = await page.evaluate(() => window.rvSent().filter((m) => m.kind === 'refEdit.bind').length)
  assert.equal(bindCount, 0, '父 Live 下引用浮窗不建立目标写端口')
  assert.equal(popup1.modeDisplay, 'none', '只读浮窗不显示编辑模式入口')
  assert.equal(popup1.saveDisplay, 'none', '只读浮窗不显示保存入口')
  passed++; console.log('[T05][ok] 只读绘制：请求面零 edit.request 出站')

  // ---- 场景 7：hover 实例为来源的请求携带 addonSource（R-U02 消息层） ----
  const views = await page.evaluate(() => window.rvViews())
  const hoverView = views.find((v) => v.viewType === 'hover')
  assert.ok(hoverView, `浮窗内容应登记 hover 只读视图（实际 ${JSON.stringify(views)}）`)
  const sentBefore = await page.evaluate(() => window.rvSent().length)
  await runOp('request', { id: 'r2', source: hoverView.instanceId, path: 'sibling.md' })
  await pumpUntil(() => page.evaluate(() => window.rvSent().length > 0))
  const addonReq = await page.evaluate((from) =>
    window.rvSent().slice(from).find((m) => m.kind === 'hover.request' && m.addonSource !== undefined), sentBefore)
  assert.ok(addonReq, '来源为 hover 实例的请求应携带 addonSource')
  assert.equal(addonReq.addonSource.instanceId, hoverView.instanceId)
  assert.ok(String(addonReq.addonSource.sourceFsPath).length > 0, 'addonSource.sourceFsPath 应为来源目标 fsPath')
  passed++; console.log('[T05][ok] 来源 B 消息层：请求携带 addonSource（hover 实例目标 fsPath）')

  // ---- 场景 2：单实例仲裁（新请求替换旧请求；旧句柄不误关） ----
  const instanceBefore = await page.evaluate(() => window.rvPopupInstanceId())
  await runOp('request', { id: 'r3', path: 'notes/b.md' })
  await pumpUntil(() => page.evaluate((prev) => window.rvPopupInstanceId() !== null && window.rvPopupInstanceId() !== prev, instanceBefore))
  const popupCount = await page.evaluate(() => document.querySelectorAll('.vsidian-hover-popup').length)
  assert.equal(popupCount, 1, '单页单浮窗（新请求替换旧请求，不堆积）')
  const r2Active = await runOp('active', { id: 'r2' })
  assert.equal(r2Active, false, '被替换请求的句柄 isActive = false')
  const closeOld = await runOp('close', { id: 'r2' })
  assert.equal(closeOld, false, '旧句柄 close 不误关后来的浮窗')
  assert.ok(await page.evaluate(() => window.readRvPopup().open), '浮窗仍在场（未被旧句柄误关）')
  const closeNew = await runOp('close', { id: 'r3' })
  assert.equal(closeNew, true, '当前请求句柄 close 关闭自己的浮窗')
  await pumpUntil(() => page.evaluate(() => !window.readRvPopup().open))
  passed++; console.log('[T05][ok] 单实例仲裁：替换、旧句柄失活不误关、本句柄可关')

  // ---- 场景 6：错误内容（真实错误分态） ----
  const errOutcome = await runOp('request', { id: 'r4', path: 'missing-note.md' })
  assert.deepEqual(errOutcome, { ok: false, reason: 'not-found' }, `目标缺失应回真实原因（${JSON.stringify(errOutcome)}）`)
  await pumpUntil(() => page.evaluate(() => { const p = window.readRvPopup(); return p.open && p.errorState }))
  const errPopup = await page.evaluate(() => window.readRvPopup())
  assert.ok(errPopup.errorState, '浮窗就地错误分态（错误修饰类在场）')
  assert.ok(errPopup.stateText.includes('missing-note.md'), `错误文案含目标原文（实际 ${errPopup.stateText}）`)
  passed++; console.log('[T05][ok] 错误内容：浮窗错误分态 + 请求结果 not-found')

  // ---- 场景 4：来源消失关闭（触发控件随面板脱树） ----
  await runOp('close')
  await runOp('request', { id: 'r5', path: 'notes/b.md' })
  await pumpUntil(() => page.evaluate(() => window.readRvPopup().open))
  await runOp('closePanel')
  await pumpUntil(() => page.evaluate(() => !window.readRvPopup().open), '触发控件脱树后浮窗关闭')
  passed++; console.log('[T05][ok] 来源消失关闭：面板关闭（触发控件脱树）→ 浮窗释放')

  // ---- 场景 3：键盘路径（R-U12：焦点进入 + Esc 归还） ----
  await runOp('openPanel')
  await page.waitForSelector('.rv-trigger', { state: 'attached' })
  await page.focus('.rv-trigger')
  await runOp('request', { id: 'r6', path: 'notes/b.md', keyboard: true })
  await pumpUntil(() => page.evaluate(() => window.rvFocusInPopup()))
  assert.ok(await page.evaluate(() => window.rvFocusInPopup()), '键盘请求：焦点进入浮层')
  await page.keyboard.press('Escape')
  await pumpUntil(() => page.evaluate(() => !window.readRvPopup().open), 'Esc 关闭浮窗')
  const focusBack = await page.evaluate(() => window.readRvTrigger())
  assert.ok(focusBack !== null && focusBack.focused, `Esc 后焦点归还触发控件（实际 ${JSON.stringify(focusBack)}）`)
  passed++; console.log('[T05][ok] 键盘路径：焦点进入浮层，Esc 关闭并归还原焦点')

  assert.deepEqual(errors, [], `页面零未捕获异常（${errors.join(' | ')}）`)
} finally {
  await browser.close()
  assetServer.close()
}
console.log(`[T05] addonRefViews 浏览器回归全部通过（${passed} 组）`)
