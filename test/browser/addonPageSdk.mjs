// #351 T02 页面 SDK 浏览器回归：生产构建方式下的 CM6 输入与绘制。
// 夹具（addonPageSdkFixture.ts）装配生产 WebviewSyncController + **生产
// 装载器**（src/webview/addonPageLoader）+ 生产槽路径
// （controller.reconfigureAddonExtensions → liveInstance 附加组件
// Compartment）；组件产物经本地 http 服务以真实 URL 装载（与
// asWebviewUri 地址同机制）。场景断言形态承接 V02（#349）。
// 场景：
// 1. 产物静态红线：组件 bundle 不含 CM6 运行时标记（构建桥第二道防线）；
// 2. 首键不丢：init 后立即真实键盘输入（不等组件装载），装载后组件的
//    StateField create 即见全文、标记绘制在首字符上；
// 3. 装载竞态：装载进行中（脚本未 onload）立即按键，文档不丢；
// 4. IME：首个输入即 CDP composition（候选期→提交），组件装载前后各一轮，
//    组合文本与提交结果完整、标记跟随首字符；
// 5. 绘制层：.vsa2-mark 计算背景色 rgb(255,0,127) + 非零几何（来自组件
//    page.css 经装载器 <link> 注入——样式授权与绘制同证）；
// 6. 通道：组件上报 addon.state 经夹具收件箱可见（宿主角色）；
// 7. 卸载与迟回执：卸载后标记消失、文档不变；已终结请求的迟到回执被
//    拒收计数；同入口新代次重新装载成功（手动恢复）；
// 8. 探针监听自清：卸载后 dispatch 探针事件不再产生通道请求。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons, CM6_RUNTIME_MARKERS } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonPageSdk.js')

// ---- 0. 组件产物构建 + 静态红线 ----
const layout = await buildTestAddons({ log: () => {} })
for (const marker of CM6_RUNTIME_MARKERS) {
  const product = await readFile(layout.testAddon.entry, 'utf8')
  assert.ok(!product.includes(marker), `组件产物不得含 CM6 运行时标记（${marker}）`)
}
const addonBytes = (await stat(layout.testAddon.entry)).size
console.log(`[T02][ok] 组件产物 ${layout.testAddon.entry}（${addonBytes} B，无 CM6 标记）`)

// ---- 1. 夹具构建（katex 裸导入与字体裁剪同 symbolInput 口径） ----
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
await esbuild({ entryPoints: [path.join(root, 'test/browser/addonPageSdkFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// ---- 2. 组件产物 http 服务（loader 用真实 URL 驱动 <script>/<link>） ----
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const assetServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const filePath = path.join(layout.testAddon.resourceDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
    const data = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve) => assetServer.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${assetServer.address().port}`
const scriptUrl = `${origin}/page.js`
const cssUrl = `${origin}/page.css`

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let failed = 0

async function scenario(name, run) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[T02][PASS] ${name}`)
  } catch (error) {
    failed++
    console.log(`[T02][FAIL] ${name}: ${error.message}`)
    throw error
  } finally {
    await page.close()
  }
}

const loadAddon = (page, generation) =>
  page.evaluate(([s, c, g]) => window.loadAddon(s, c, g), [scriptUrl, cssUrl, generation])
const waitReports = async (page, topic, count = 1, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const seen = await page.evaluate(([t]) => window.takeChannelRequests().filter((r) => r.topic === t), [topic])
    if (seen.length >= count) return seen
    if (Date.now() > deadline) throw new Error(`等待组件上报 ${topic} x${count} 超时`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

// ---- 场景 2：首键不丢（真实键盘，装载前输入） ----
await scenario('首键不丢——装载前输入 hello，组件 field 即见全文且标记首字符', async (page) => {
  await page.evaluate(() => window.initDoc(''))
  await page.click('.cm-content')
  // 不等组件：init 后立即输入
  await page.keyboard.type('hello')
  await loadAddon(page, 1)
  const reports = await waitReports(page, 'addon.state')
  assert.equal(reports.at(-1).payload.docLength, 5, '组件 StateField create 即见首键后的全文')
  const editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, 'hello', '文档完整')
  const mark = await page.evaluate(() => window.markInfo())
  assert.equal(mark.count, 1, '首字符标记在场')
  assert.equal(mark.text, 'h', '标记文本为首字符')
})

// ---- 场景 3：装载竞态（脚本未 onload 时按键） ----
await scenario('装载竞态——脚本装载中按键不丢失', async (page) => {
  await page.evaluate(() => window.initDoc(''))
  await page.click('.cm-content')
  const loading = loadAddon(page, 1)
  await page.keyboard.type('race')
  await loading
  await waitReports(page, 'addon.state')
  const editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, 'race', '装载期输入完整保留')
  const mark = await page.evaluate(() => window.markInfo())
  assert.equal(mark.count, 1)
  assert.equal(mark.text, 'r')
})

// ---- 场景 4：IME（首输入即组合；装载前后各一轮） ----
await scenario('IME——首个输入即组合输入，装载前后组合与提交完整', async (page) => {
  await page.evaluate(() => window.initDoc(''))
  await page.click('.cm-content')
  const cdp = await page.context().newCDPSession(page)
  // 首个输入即 IME：候选期 + 提交
  await cdp.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 })
  let editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, '你', '候选期组合文本在场')
  await cdp.send('Input.insertText', { text: '你好' })
  editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, '你好', 'IME 提交完整')
  // 装载组件后再来一轮组合（组件扩展在场时的 IME 不被扰动）
  await loadAddon(page, 1)
  await waitReports(page, 'addon.state')
  await cdp.send('Input.imeSetComposition', { text: '世', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.insertText', { text: '世界' })
  editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, '你好世界', '组件在场时 IME 提交完整')
  const reports = await waitReports(page, 'addon.state', 2)
  assert.equal(reports.at(-1).payload.docLength, 4, '组件 field 跟随组合提交后的全文')
  const mark = await page.evaluate(() => window.markInfo())
  assert.equal(mark.text, '你', '标记跟随首字符')
})

// ---- 场景 5：绘制层 + 样式授权（计算样式来自组件 page.css） ----
await scenario('绘制层——组件标记的计算背景色与几何（page.css 经装载器注入）', async (page) => {
  await page.evaluate(() => window.initDoc('paint'))
  await page.click('.cm-content')
  await loadAddon(page, 1)
  await waitReports(page, 'addon.state')
  const mark = await page.evaluate(() => window.markInfo())
  assert.equal(mark.count, 1)
  assert.equal(mark.color, 'rgb(255, 0, 127)', '组件样式的计算背景色（用户可见）')
  assert.ok(mark.rectWidth > 0 && mark.rectHeight > 0, '标记几何非零（真实绘制）')
  const identity = await page.evaluate(() => window.runtimeIdentity())
  assert.equal(identity.cm6Shared, true, '装载器注入了页面共享运行时')
  assert.ok(String(identity.stateFieldConstructor).includes('StateField'), `StateField 构造器身份：${identity.stateFieldConstructor}`)
  assert.ok(String(identity.viewConstructor).includes('EditorView'), `EditorView 构造器身份：${identity.viewConstructor}`)
})

// ---- 场景 7：卸载、迟回执拒收与手动恢复 ----
await scenario('卸载释放——标记消失文档不变，迟回执拒收，新代次重载成功', async (page) => {
  await page.evaluate(() => window.initDoc('keep'))
  await page.click('.cm-content')
  await loadAddon(page, 1)
  await waitReports(page, 'addon.state')
  // 制造一个挂起请求（探针事件触发 addon.ping），不回执
  await page.evaluate(() => window.dispatchProbeEvent())
  const ping = await waitReports(page, 'addon.ping')
  assert.equal(ping.length, 1, '探针监听在装载期生效')
  // 卸载
  const unloadOutcome = await page.evaluate((g) => window.unloadAddon(g), 1)
  assert.deepEqual(unloadOutcome, { ok: true })
  const editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, 'keep', '卸载不扰动文档')
  const mark = await page.evaluate(() => window.markInfo())
  assert.equal(mark.count, 0, '卸载后标记移除（扩展摘除）')
  // 迟到回执（请求已随卸载 released）：装载器必须拒收
  await page.evaluate(([requestId]) => window.replyChannelRequest(requestId, { ok: true, result: 'late' }), [ping[0].requestId])
  const stats = await page.evaluate(() => window.addonStats())
  assert.equal(stats.counters.lateChannelRepliesDropped, 1, '迟到回执拒收计数')
  assert.equal(stats.active.length, 0)
  // 卸载后探针监听不再产生请求（组件 onDispose 自清）
  await page.evaluate(() => window.dispatchProbeEvent())
  await new Promise((r) => setTimeout(r, 300))
  const after = await page.evaluate(() => window.takeChannelRequests())
  assert.equal(after.filter((r) => r.topic === 'addon.ping').length, 0, '释放后监听不再生效')
  // 手动恢复：新代次重新装载同一入口
  const reload = await loadAddon(page, 2)
  assert.equal(reload.ok, true, '新代次重载成功')
  await waitReports(page, 'addon.state')
  const mark2 = await page.evaluate(() => window.markInfo())
  assert.equal(mark2.count, 1, '恢复后标记重新绘制')
})

// ---- 场景 8：未授权地址（404）装载拒绝 ----
await scenario('未授权入口——404 地址装载失败且不留半装配', async (page) => {
  await page.evaluate(() => window.initDoc('denied'))
  await page.click('.cm-content')
  const outcome = await page.evaluate(([s, c, g]) => window.loadAddon(s, c, g), [`${origin}/missing.js`, cssUrl, 1])
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'script-load-failed', `未授权入口被拒：${JSON.stringify(outcome)}`)
  const stats = await page.evaluate(() => window.addonStats())
  assert.equal(stats.active.length, 0)
  const mark = await page.evaluate(() => window.markInfo())
  assert.equal(mark.count, 0, '失败装载不产生标记')
})

console.log(`[V02] 通过 ${passed} 项`)
assetServer.close()
await browser.close()
if (failed > 0) process.exit(1)
