// #543 T03 附加组件文档导航——生产链路消费回归（Playwright 生产构建）。
// 夹具（addonDocNavFixture.ts）装配生产 WebviewSyncController + 生产装载器
// + 生产视图注册表（docNav 出站端口与面板身份接线同生产 main.ts）；
// docnav 夹具组件（公开 SDK 的 views.openDocument 消费者）经本地 http 服务
// 以真实 URL 装载。夹具扮演宿主：捕获 addonDocNav.request 出站（来源文档
// URI/面板身份/代次注入的断言面）、以 addonDocNav.result 回执（生产路由点）
// 与 view.locate / view.mode.set（宿主定位管线生产入口消息）驱动真实落点。
//
// 断言面（票面验收「浏览器与真宿主证明」的浏览器半边；CRLF 属宿主换算，
// 由单测 addonDocNav.test.ts 与真宿主集成 addonDocNavCases 承载）：
// - 请求形状：来源文档 URI 取注册表值（main）、面板身份注入、代次注入；
// - 回执配对：请求 → 回执 → 组件回报的生产闭环；
// - 真实落点：live 光标偏移（生产控制器选区）、reading 块级 flash 绘制层；
// - 折叠隐藏区展开：foldAll 后 view.locate 落进隐藏区 → 祖先折叠永久展开
//   （folds 状态面 + DOM 行可见的绘制层）；
// - N-U12 迟到回包：gen1 未回执请求 → 卸载 → gen2 装载后旧回包不干扰
//   新代次配对（旧代次在途终结由装载器释放钩子驱动，单测钉住）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonDocNav.js')

// ---- 0. 夹具组件构建（构建桥 + CM6 静态红线） ----
const layout = await buildTestAddons({ log: () => {} })
const addonScript = layout.docNavAddon.distDir + '/editor.js'

// ---- 1. 测试夹具构建（katex 裸导入与字体裁剪同 addonHostSettings 口径） ----
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
await esbuild({ entryPoints: [path.join(root, 'test/browser/addonDocNavFixture.ts')],
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

// 小文档（全行在视口内——DOM 行可见性断言的前提）
const DOC = '# T1\n\npara under t1\n\n## T1a\n\ndeep target line\n\n# T2\n\nafter t2\n'
const HEADING_T1A = DOC.indexOf('## T1a')
const DEEP_LINE = DOC.indexOf('deep target line')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 6

const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>')
await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
await page.addScriptTag({ path: bundle })
await page.setViewportSize({ width: 900, height: 700 })
await page.evaluate((text) => window.initDoc(text), DOC)
await page.locator('.cm-line').first().waitFor()

try {
  // ---- 场景 1：装载组件，views 面 openDocument 在场 ----
  const loadOutcome = await page.evaluate((uri) => window.loadDocNavAddon(uri, 1), addonUri)
  assert.deepEqual(loadOutcome, { ok: true, css: [] }, `组件应装载成功：${JSON.stringify(loadOutcome)}`)
  assert.deepEqual(await page.evaluate(() => window.runDocNavOp('facetMissing')), { missing: false }, 'views 面应在场')
  passed += 1

  // ---- 场景 2：请求形状 + 真实落点（live）+ 回执闭环 ----
  // 宿主时序对齐：组件发出导航请求 → 宿主（夹具）定位（view.locate）→ 回执
  const outcomePromise = page.evaluate(() => window.runDocNavOp('open', { target: '', locateHeading: 'T1a' }))
  await page.waitForTimeout(250)
  const requests = await page.evaluate(() => window.docNavRequests())
  assert.equal(requests.length, 1, `应恰有一条导航出站（实际 ${requests.length}）`)
  const req = requests[0]
  assert.deepEqual({
    sessionId: req.sessionId, docUri: req.docUri, addonId: req.addonId,
    generation: req.generation, sourceDocUri: req.sourceDocUri, target: req.target,
    locate: req.locate,
  }, {
    sessionId: 'docnav-addon',
    docUri: 'file:///d%3A/ws/a.md',
    addonId: 'vsidian-test-fixture.addon-docnav',
    generation: 1,
    sourceDocUri: 'file:///d%3A/ws/a.md',
    target: '',
    locate: { kind: 'heading', heading: 'T1a' },
  }, '出站请求应携带注册表来源、面板身份与 SDK 注入的组件身份/代次')
  assert.ok(req.reqId >= 1, 'reqId 应为正整数')
  // 宿主定位管线（openWith 后发 view.locate 的生产消息）→ live 光标落标题行首
  await page.evaluate((offset) => window.hostLocate(offset), HEADING_T1A)
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.cursorOffset()), HEADING_T1A,
    'live 光标应落在 ## T1a 行首（生产 locateOffset 管线）')
  // 回执 → 组件经通道回报同一结果（请求-回执-回报生产闭环）
  await page.evaluate((r) => window.replyDocNav(r.reqId, r.addonId, r.generation, { ok: true, opened: true, located: true }), req)
  assert.deepEqual(await outcomePromise, { ok: true, opened: true, located: true })
  passed += 1

  // ---- 场景 3：失败回执原样到达组件（区分 opened 与 located） ----
  const failPromise = page.evaluate(() => window.runDocNavOp('open', { target: 'b.md', locateLine: 4 }))
  await page.waitForTimeout(250)
  const pending2 = (await page.evaluate(() => window.docNavRequests())).at(-1)
  await page.evaluate((r) => window.replyDocNav(r.reqId, r.addonId, r.generation, { ok: false, reason: 'out-of-bounds', opened: true }), pending2)
  assert.deepEqual(await failPromise, { ok: false, reason: 'out-of-bounds', opened: true },
    '失败回执应原样到达组件（区分 opened 与 located）')
  passed += 1

  // ---- 场景 4：阅读态定位——块级 flash 绘制层（宿主 view.locate 双模式语义） ----
  await page.evaluate(() => window.hostSetMode('reading'))
  await page.waitForTimeout(200)
  await page.evaluate((offset) => window.hostLocate(offset), DEEP_LINE)
  await page.waitForTimeout(120)
  const readingFlash = await page.evaluate(() => ({
    count: document.querySelectorAll('.vsidian-view-reading .vsidian-anchor-flash').length,
    text: (document.querySelector('.vsidian-view-reading .vsidian-anchor-flash')?.textContent ?? '').slice(0, 40),
  }))
  assert.equal(readingFlash.count, 1, `阅读态应有一块 flash 高亮（实际 ${readingFlash.count}）`)
  assert.ok(readingFlash.text.includes('deep target line'),
    `flash 块应覆盖目标段（实际 "${readingFlash.text}"）`)
  await page.evaluate(() => window.hostSetMode('live'))
  await page.waitForTimeout(200)
  passed += 1

  // ---- 场景 5：折叠隐藏区展开——foldAll 后定位进隐藏区，祖先折叠永久展开 ----
  assert.deepEqual(await page.evaluate(() => window.runDocNavOp('foldAll')), { ok: true, applied: 3 },
    'foldAll 应折全部三区间')
  assert.equal(
    await page.evaluate((needle) => !(document.querySelector('.cm-content')?.textContent ?? '').includes(needle), 'deep target line'),
    true, '折叠后隐藏区目标行不可见（live 绘制层；阅读容器残留文本不计）')
  const foldsAfterFold = await page.evaluate(() => window.runDocNavOp('folds'))
  assert.equal(foldsAfterFold.spans.length, 3, `折叠状态面应含 3 区间（实际 ${JSON.stringify(foldsAfterFold)}）`)
  // 宿主管线 view.locate 落进隐藏区 → unfoldAround 展开祖先链后定位
  await page.evaluate((offset) => window.hostLocate(offset), DEEP_LINE)
  await page.waitForTimeout(120)
  assert.equal(
    await page.evaluate((needle) => (document.querySelector('.cm-content')?.textContent ?? '').includes(needle), 'deep target line'),
    true, '定位后隐藏区目标行应重新可见（展开祖先折叠）')
  const foldsAfterLocate = await page.evaluate(() => window.runDocNavOp('folds'))
  const stillFoldedKeys = foldsAfterLocate.spans.filter((s) => s.hideFrom < DEEP_LINE && s.hideTo > DEEP_LINE)
  assert.equal(stillFoldedKeys.length, 0, `包含落点的折叠应已展开（实际 ${JSON.stringify(foldsAfterLocate)}）`)
  assert.equal(await page.evaluate(() => window.cursorOffset()), DEEP_LINE, '展开后光标落在目标行')
  passed += 1

  // ---- 场景 6：N-U12 迟到回包——gen1 未回执请求卸载后，gen2 配对不受旧回包干扰 ----
  const stalePromise = page.evaluate(() => window.runDocNavOp('open', { target: 'b.md' }))
  stalePromise.catch(() => {}) // 组件已随卸载终结：8s 后的轮询超时按预期吞掉
  await page.waitForTimeout(250)
  const staleReq = (await page.evaluate(() => window.docNavRequests())).at(-1)
  assert.equal(staleReq.generation, 1, '卸载前的请求应携带 gen1')
  await page.evaluate(() => window.unloadDocNavAddon(1))
  const load2 = await page.evaluate((uri) => window.loadDocNavAddon(uri, 2), addonUri)
  assert.deepEqual(load2, { ok: true, css: [] }, 'gen2 应装载成功')
  const gen2Promise = page.evaluate(() => window.runDocNavOp('open', { target: 'c.md' }))
  await page.waitForTimeout(250)
  const gen2Req = (await page.evaluate(() => window.docNavRequests())).at(-1)
  assert.equal(gen2Req.generation, 2, 'gen2 请求应携带新代次')
  // 旧代次迟到回包先到：代次不符，不得接入 gen2 的在途请求
  await page.evaluate((r) => window.replyDocNav(r.reqId, r.addonId, r.generation, { ok: true, opened: true, located: true }), staleReq)
  await page.evaluate((r) => window.replyDocNav(r.reqId, r.addonId, r.generation, { ok: true, opened: true, located: true }), gen2Req)
  assert.deepEqual(await gen2Promise, { ok: true, opened: true, located: true }, 'gen2 请求应配对自己的回执（旧回包不干扰）')
  passed += 1

  assert.deepEqual(errors, [], '页面不应有未捕获异常')
  console.log(`addonDocNav: ${passed}/${total} 场景通过`)
} finally {
  await browser.close()
  server.close()
}
if (passed !== total) {
  throw new Error(`addonDocNav 场景未全过：${passed}/${total}`)
}
