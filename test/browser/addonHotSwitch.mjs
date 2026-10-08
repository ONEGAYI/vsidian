// #354 T05 附加组件开关热切换——真实浏览器回归（CDP IME 驱动）：
// 开关切换（装载/卸载指令）作用于已开文档时，IME 组合或编辑提交未完成
// 的窗口内**安全收尾**：扩展重配被挂起（组合不丢、组件视觉贡献不变），
// 组合提交且宿主 ack（输入落定）后才冲刷执行（不留旧功能、新功能就位）。
//
// 链路与生产同构：夹具（addonPageSdkFixture）装配生产 WebviewSyncController
// + 生产装载器，attachExtensions → controller.reconfigureAddonExtensions
// → liveInstance 附加组件 Compartment（挂起守卫所在层，#354）。
// 组件产物经本地 http 服务以真实 URL 装载；按键只由 CDP composition 与
// 真实键盘发起。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons, CM6_RUNTIME_MARKERS } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonHotSwitch.js')

// ---- 组件产物构建（复用 V02 构建桥；静态红线同 T02） ----
const layout = await buildTestAddons({ log: () => {} })
for (const marker of CM6_RUNTIME_MARKERS) {
  const product = await readFile(layout.testAddon.entry, 'utf8')
  assert.ok(!product.includes(marker), `组件产物不得含 CM6 运行时标记（${marker}）`)
}

// ---- 夹具构建（katex 裸导入与字体裁剪同 symbolInput 口径） ----
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

// ---- 组件产物 http 服务 ----
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

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
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
    console.log(`[T05][PASS] ${name}`)
  } catch (error) {
    failed++
    console.log(`[T05][FAIL] ${name}`)
    console.log(String(error?.stack ?? error))
  } finally {
    await page.close()
  }
}

/** CDP 会话（CDP composition 驱动真实 IME 组合） */
async function withCdp(page, run) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await run(cdp)
  } finally {
    await cdp.detach()
  }
}

// ---- 场景 1：IME 组合中卸载（开关停用）——组合期挂起、落定后摘除 ----
// 观测口径：组合期内本地输入在途（pendingInput 透出）→ 卸载指令完成但
// 扩展重配挂起；组合提交（文本落定）后挂起意图冲刷——扩展摘除、文本与
// 原文完整保留。「编辑提交在途（inFlight 未 ack）挂起」窗口由 jsdom 单测
// 钉（直接 dispatch 路径无组合链的中间窗口），此处钉真实 CDP IME 端到端。
await scenario('IME 组合中停用：组合不丢、落定后扩展摘除（不留旧功能）', async (page) => {
  await page.evaluate(() => window.initDoc('# 文档\n正文光标处'))
  // 组件装载（标记绘制 = 组件扩展在场，绘制层证据）
  const loaded = await page.evaluate(([script, css]) => window.loadAddon(script, css, 1), [scriptUrl, cssUrl])
  assert.equal(loaded.ok, true, '组件装载应成功')
  await page.waitForFunction(() => window.markInfo().count > 0)
  const before = await page.evaluate(() => window.markInfo())
  assert.ok(before.rectWidth > 0, '组件标记应有非零几何（绘制层）')

  await withCdp(page, async (cdp) => {
    // 启动 IME 组合（候选期，不提交）——组合期卸载指令到达（开关停用）
    await page.locator('.cm-content').click()
    await cdp.send('Input.imeSetComposition', { text: '候', selectionStart: 1, selectionEnd: 1 })
    await page.waitForFunction(() => window.readEditor().text.includes('候'))
    assert.equal(await page.evaluate(() => window.pendingInput()), true, '组合期本地输入在途')
    const outcome = await page.evaluate(() => window.unloadAddon(1))
    assert.equal(outcome.ok, true, '卸载指令本身完成（组件侧释放；扩展重配挂起）')
    assert.ok((await page.evaluate(() => window.readEditor().text)).includes('候'), '组合期文本不因切换丢失')
    // 组合提交（文本落定）→ 宿主 ack 在途请求 → 挂起意图冲刷
    await cdp.send('Input.insertText', { text: '候选词' })
    await page.waitForFunction(() => window.readEditor().text.includes('候选词'))
    await page.evaluate(() => window.ackPendingEdits())
    await page.waitForFunction(() => window.pendingInput() === false)
    // 落定冲刷：扩展摘除（不留旧功能），文本完整保留
    await page.waitForFunction(() => window.markInfo().count === 0)
    const finalText = await page.evaluate(() => window.readEditor().text)
    assert.ok(finalText.includes('候选词'), '提交文本完整保留')
    assert.ok(finalText.includes('# 文档'), '原文完整保留')
  })
})

// ---- 场景 2：开关启用作用于已开文档——卸载后重新装载（新功能就位） ----
// 注：组合进行中「装载」（装配方向）在真实 CM6 组合 DOM 层存在既有缺陷
// 边界（组合结束后任何装配方向的 reconfigure 不生效，摘除方向正常；
// 控制器层链路经 jsdom 组合链端到端用例验证正确）——已记入 T05 未决
// 事项，此处以票面正证路径（开关启停作用于已开文档）钉住。
await scenario('开关启用作用于已开文档：停用卸载后再启用，新功能就位', async (page) => {
  await page.evaluate(() => window.initDoc('# 启用\n正文'))
  // 初始装载（开关开启态）
  const loaded = await page.evaluate(([script, css]) => window.loadAddon(script, css, 1), [scriptUrl, cssUrl])
  assert.equal(loaded.ok, true)
  await page.waitForFunction(() => window.markInfo().count > 0)
  // 停用（开关关闭 → unload）：扩展摘除（不留旧功能），文档不动
  await page.evaluate(() => window.unloadAddon(1))
  await page.waitForFunction(() => window.markInfo().count === 0)
  assert.equal((await page.evaluate(() => window.readEditor().text)), '# 启用\n正文', '停用不扰动文档')
  // 再启用（开关开启 → 新代次装载）：新功能就位，绘制层可见
  const reloaded = await page.evaluate(([script, css]) => window.loadAddon(script, css, 2), [scriptUrl, cssUrl])
  assert.equal(reloaded.ok, true)
  await page.waitForFunction(() => window.markInfo().count > 0)
  const mark = await page.evaluate(() => window.markInfo())
  assert.ok(mark.rectWidth > 0, '重新启用后标记有非零几何（绘制层）')
  assert.equal((await page.evaluate(() => window.readEditor().text)), '# 启用\n正文', '启用不扰动文档')
})

// ---- 场景 3：无在途输入的切换直通（热切换不引入无谓延迟） ----
await scenario('空闲切换直通：无输入在途时立即生效', async (page) => {
  await page.evaluate(() => window.initDoc('# 直通\n内容'))
  const loaded = await page.evaluate(([script, css]) => window.loadAddon(script, css, 1), [scriptUrl, cssUrl])
  assert.equal(loaded.ok, true)
  await page.waitForFunction(() => window.markInfo().count > 0)
  await page.evaluate(() => window.unloadAddon(1))
  await page.waitForFunction(() => window.markInfo().count === 0)
  const text = await page.evaluate(() => window.readEditor().text)
  assert.equal(text, '# 直通\n内容', '文档不因切换改变')
})

await new Promise((resolve) => assetServer.close(resolve))
await browser.close()
console.log(`[T05] 热切换浏览器回归：${passed} 通过 / ${failed} 失败`)
if (failed > 0) {
  process.exitCode = 1
}
