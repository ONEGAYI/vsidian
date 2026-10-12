// #457 附加组件宿主设置读取面——生产链路消费回归（Playwright 生产构建）。
// 夹具（addonHostSettingsFixture.ts）装配生产 WebviewSyncController + 生产
// 装载器（hostSettingsSnapshot 接线与生产 main.ts 同款）；hostSettings
// 夹具组件（host-settings-addon，公开 SDK 的 experimental.hostSettings
// 消费者）经本地 http 服务以真实 URL 装载。指令经「宿主收件箱 ↔ 组件
// 短轮询」驱动（hostSettings.next / hostSettings.result），断言面是
// 组件回报的 get 结果（生产链路：设置消息 → controller 缓存 → 快照
// 读取器 → SDK facet → 组件）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonHostSettings.js')

// ---- 0. 夹具组件构建（构建桥 + CM6 静态红线） ----
const layout = await buildTestAddons({ log: () => {} })
const addonScript = layout.hostSettingsAddon.distDir + '/editor.js'

// ---- 1. 测试夹具构建（katex 裸导入与字体裁剪同 addonHeadingFold 口径） ----
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
await esbuild({ entryPoints: [path.join(root, 'test/browser/addonHostSettingsFixture.ts')],
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

const DOC = '# 标题\n\n正文段落一行。\n'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 5

const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>')
await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
await page.addScriptTag({ path: bundle })
await page.setViewportSize({ width: 900, height: 700 })
await page.evaluate((text) => { window.initDoc(text) }, DOC)

try {
  // ---- 场景 1：装载组件，实验入口在场 ----
  const loadOutcome = await page.evaluate((uri) => window.loadHostSettingsAddon(uri, 1), addonUri)
  assert.deepEqual(loadOutcome, { ok: true, css: [] }, `组件应装载成功：${JSON.stringify(loadOutcome)}`)
  assert.deepEqual(await page.evaluate(() => window.runHostSettingsOp('facetMissing')), { missing: false },
    '实验入口应在场')
  passed += 1

  // ---- 场景 2：快照未达回默认值（宿主初始渲染同语义——缺键严格软换行） ----
  assert.deepEqual(await page.evaluate(() => window.runHostSettingsOp('get', { key: 'editor.readingBreaks' })),
    { ok: true, value: false }, '快照未达时 get 应回定义表默认值 false')
  passed += 1

  // ---- 场景 3：settings.snapshot 携带值 → get 与宿主快照同源 ----
  await page.evaluate(() => window.pushSettings({ 'editor.readingBreaks': true }))
  assert.deepEqual(await page.evaluate(() => window.runHostSettingsOp('get', { key: 'editor.readingBreaks' })),
    { ok: true, value: true }, '快照携带 true 时 get 应返回 true')
  await page.evaluate(() => window.pushSettings({ 'editor.readingBreaks': false }))
  assert.deepEqual(await page.evaluate(() => window.runHostSettingsOp('get', { key: 'editor.readingBreaks' })),
    { ok: true, value: false }, '快照携带 false 时 get 应返回 false')
  passed += 1

  // ---- 场景 4：保存热更（settings.changed 广播）→ 下次 get 即新值（拉取式跟随） ----
  await page.evaluate(() => window.pushSettings({ 'editor.readingBreaks': true }, 'settings.changed'))
  assert.deepEqual(await page.evaluate(() => window.runHostSettingsOp('get', { key: 'editor.readingBreaks' })),
    { ok: true, value: true }, '热更广播后下次 get 应拿到新值')
  passed += 1

  // ---- 场景 5：白名单外键 invalid-key 拒绝（读取范围收敛） ----
  assert.deepEqual(await page.evaluate(() => window.runHostSettingsOp('get', { key: 'editor.fontSize' })),
    { ok: false, reason: 'invalid-key' }, '白名单外键应拒绝 invalid-key')
  passed += 1

  assert.deepEqual(errors, [], '页面不应有未捕获异常')
  console.log(`addonHostSettings: ${passed}/${total} 场景通过`)
} finally {
  await browser.close()
  server.close()
}
if (passed !== total) {
  throw new Error(`addonHostSettings 场景未全过：${passed}/${total}`)
}
