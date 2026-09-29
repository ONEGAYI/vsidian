// 图片刷新浏览器回归（#201）：真实浏览器内驱动生产控制器的失效/重发/
// 状态细分链路。核心断言落在**绘制层**：
// - 像素替换：canvas 采样图片实际呈现颜色（内容变化后画布像素变化，
//   不只 src 字符串替换）
// - 删除可见态与不可访问区分：computed 背景/边框色（样式注入失效时
//   DOM 存在性照样通过，颜色必须是可见的差异来源）
// - 代次守卫：invalidate 后旧 reqId 在途结果不复活旧图
// - 唤醒核验：image.wake 立即触发一轮 image.verify 上报
// - 图片尺寸变化后的阅读视口稳定（虚拟化高度回填 + 滚动锚定）
// 真实文件 watcher → 宿主失效的链路由集成测试覆盖（真宿主钩子）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'imageRefresh/main.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/imageRefreshFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body class="vscode-light"><div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: sans-serif; --vscode-editor-background: #ffffff; --vscode-editor-foreground: #222222; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  const imageRequests = () => page.evaluate(() =>
    window.readHostMessages().filter((m) => m.kind === 'image.request'))
  const imageVerifies = () => page.evaluate(() =>
    window.readHostMessages().filter((m) => m.kind === 'image.verify'))
  const slots = () => page.evaluate(() => window.imageSlots())
  const waitForSlots = async (predicate, label, timeout = 8000) => {
    await page.waitForFunction(predicate, null, { timeout, polling: 100 })
    const current = await slots()
    return current
  }

  // ---- 场景 1：像素替换（invalidate → 重发 → 新版本内容实际呈现） ----
  await page.evaluate(() => window.initDoc('# 标题\n\n![红图](./ref.png)\n\n结尾段。'))
  await page.waitForFunction(() => window.imageSlots().length > 0, null, { timeout: 8000, polling: 50 })
  let requests = await imageRequests()
  assert.equal(requests.length, 1, '挂载后应发起一次 image.request')
  const req1 = requests[0].reqId
  const redUrl = await page.evaluate(() => window.makeDataPng(255, 32, 32, 40, 40))
  await page.evaluate(({ reqId, src }) => window.respondImage(reqId, true, src), { reqId: req1, src: redUrl })
  await waitForSlots(() => window.imageSlots()[0]?.state === 'loaded', '红图应加载完成')
  let liveSlots = await slots()
  assert.equal(liveSlots[0].notfound, false, 'loaded 态无失败细分类')
  let redPixel = await page.evaluate(() => window.sampleCenter(document.querySelector('.vsidian-image')))
  assert.ok(redPixel && redPixel.r > 200 && redPixel.g < 80 && redPixel.b < 80,
    `红图中心像素应为红系，实际 ${JSON.stringify(redPixel)}`)

  // 失效：撤下旧图回 loading，重发请求
  await page.evaluate(() => window.injectInvalidate(['./ref.png']))
  await page.waitForFunction(() => window.imageSlots()[0]?.state === 'loading', null, { timeout: 8000, polling: 50 })
  liveSlots = await slots()
  assert.equal(liveSlots[0].src, '', '失效应撤下旧图（img src 清空）')
  requests = await imageRequests()
  assert.equal(requests.length, 2, '失效后应重发一次请求（新 reqId）')
  const req2 = requests[1].reqId
  assert.ok(req2 > req1, '重发请求应携带更大 reqId（代次递增）')

  // ---- 场景 2：代次守卫——旧 reqId 在途结果不复活旧图 ----
  await page.evaluate(({ reqId, src }) => window.respondImage(reqId, true, src), { reqId: req1, src: redUrl })
  await page.waitForTimeout(150)
  liveSlots = await slots()
  assert.equal(liveSlots[0].state, 'loading', '旧 reqId 的迟到结果不得驱动状态')
  assert.equal(liveSlots[0].src, '', '旧 reqId 的迟到结果不得复活旧图')
  const blueUrl = await page.evaluate(() => window.makeDataPng(32, 32, 255, 40, 40))
  await page.evaluate(({ reqId, src }) => window.respondImage(reqId, true, src), { reqId: req2, src: blueUrl })
  await waitForSlots(() => window.imageSlots()[0]?.state === 'loaded', '新版本应加载完成')
  const bluePixel = await page.evaluate(() => window.sampleCenter(document.querySelector('.vsidian-image')))
  assert.ok(bluePixel && bluePixel.b > 200 && bluePixel.r < 80,
    `替换后中心像素应为蓝系（实际像素替换，非仅 src 字符串），实际 ${JSON.stringify(bluePixel)}`)

  // ---- 场景 3：唤醒核验——image.wake 立即触发一轮上报 ----
  await page.evaluate(() => window.injectWake())
  await page.waitForFunction(() =>
    window.readHostMessages().some((m) => m.kind === 'image.verify'), null, { timeout: 4000, polling: 50 })
  const verifies = await imageVerifies()
  assert.equal(verifies.length, 1, 'wake 应恰好触发一轮 image.verify')
  assert.equal(verifies[0].items.length, 1, '活跃图源合并上报')
  assert.equal(verifies[0].items[0].src, './ref.png')
  assert.equal(verifies[0].items[0].state, 'loaded')

  // ---- 场景 4：删除可见态（找不到）与不可访问区分（绘制层） ----
  await page.evaluate(() => window.initDoc('# 二\n\n![删除](./gone.png)\n\n![远程](./remote.png)'))
  await page.waitForFunction(() => window.imageSlots().length >= 2, null, { timeout: 8000, polling: 50 })
  requests = await imageRequests()
  // initDoc 重建后 reqId 重新计数：取最新两条（gone 与 remote 的在途请求）
  const goneReq = requests[requests.length - 2]
  const remoteReq = requests[requests.length - 1]
  await page.evaluate((reqId) => window.respondImage(reqId, false, 'not-found'), goneReq.reqId)
  await page.evaluate((reqId) => window.respondImage(reqId, false, 'inaccessible'), remoteReq.reqId)
  await waitForSlots(() => window.imageSlots().length >= 2 && window.imageSlots().every((x) => x.state === 'error'), '两图均应进入失败态')
  liveSlots = await slots()
  const gone = liveSlots[0]
  const remote = liveSlots[1]
  assert.equal(gone.notfound, true, '明确删除应标记 notfound')
  assert.equal(gone.unreachable, false, '找不到不得标记不可访问')
  assert.equal(remote.unreachable, true, 'SSH 断连/权限错误应标记不可访问')
  assert.equal(remote.notfound, false, '不可访问不得冒充找不到')
  // 绘制层可见性：computed 颜色是用户看到的差异来源
  const paint = await page.evaluate(() => {
    const els = document.querySelectorAll('.vsidian-image')
    return { gone: window.slotPaint(els[0]), remote: window.slotPaint(els[1]) }
  })
  assert.equal(paint.gone.background, 'rgba(190, 17, 0, 0.08)', '找不到应有淡红底（细分类绘制层规则）')
  assert.ok(paint.gone.width > 0 && paint.gone.height > 0, '失败态槽位应占据可见布局')
  assert.equal(paint.remote.borderColor, 'rgb(204, 167, 0)', '不可访问应为警告黄边框')
  assert.notEqual(paint.gone.borderColor, paint.remote.borderColor, '两失败态边框色必须可区分')

  // ---- 场景 5：阅读模式一致 + 图片尺寸变化后的视口稳定 ----
  const filler = Array.from({ length: 30 }, (_, i) => `填充段落 ${i}：一些用于撑高文档的文字内容。`).join('\n\n')
  await page.evaluate((text) => {
    window.initDoc(text)
    window.setViewMode('reading')
  }, `# 长文\n\n段落甲：滚动锚定的观测起点。\n\n![变化图](./resize.png)\n\n锚点段落：视口稳定性观测。\n\n${filler}`)
  // 滚动到图片附近使其进入挂载窗口
  await page.waitForFunction(() => window.scrollToText('段落甲') !== -1, null, { timeout: 8000, polling: 100 })
  await page.waitForFunction(() => window.imageSlots().length > 0, null, { timeout: 8000, polling: 50 })
  requests = await imageRequests()
  const resizeReq = requests[requests.length - 1]
  const smallUrl = await page.evaluate(() => window.makeDataPng(40, 160, 40, 40, 40))
  await page.evaluate(({ reqId, src }) => window.respondImage(reqId, true, src), { reqId: resizeReq.reqId, src: smallUrl })
  await waitForSlots(() => window.imageSlots()[0]?.state === 'loaded', '阅读模式小图应加载完成')
  // 滚动锚定语义：视口顶块不动（图片下方内容被撑开下移属预期重排）——
  // 观测点取图片上方的「段落甲」（视口顶附近），其视口位置应保持稳定
  const anchorBefore = await page.evaluate(() => window.anchorTopAt('段落甲'))
  assert.ok(anchorBefore !== null && anchorBefore > 0 && anchorBefore < 640, '观测段落应在视口内')
  // 失效替换为高图：视口内容不应随图片增高而跳变（滚动锚定）
  await page.evaluate(() => window.injectInvalidate(['./resize.png']))
  await page.waitForFunction(() => window.imageSlots()[0]?.state === 'loading', null, { timeout: 8000, polling: 50 })
  requests = await imageRequests()
  const tallReq = requests[requests.length - 1]
  const tallUrl = await page.evaluate(() => window.makeDataPng(160, 40, 160, 40, 300))
  await page.evaluate(({ reqId, src }) => window.respondImage(reqId, true, src), { reqId: tallReq.reqId, src: tallUrl })
  await waitForSlots(() => window.imageSlots()[0]?.state === 'loaded', '高图应加载完成')
  await page.waitForTimeout(600) // 等待虚拟化高度回填与滚动锚定稳定
  const anchorAfter = await page.evaluate(() => window.anchorTopAt('段落甲'))
  assert.ok(anchorAfter !== null, '观测段落在替换后仍应挂载')
  const drift = Math.abs(anchorAfter - anchorBefore)
  assert.ok(drift < 60, `图片增高 260px 后视口顶内容位置漂移应有界（实际 ${drift.toFixed(1)}px）`)
  const tallPixel = await page.evaluate(() => window.sampleCenter(document.querySelector('.vsidian-image')))
  assert.ok(tallPixel && tallPixel.r > 120 && tallPixel.b > 120 && tallPixel.g < 80,
    `阅读模式替换后中心像素应为紫系（双模式像素替换一致），实际 ${JSON.stringify(tallPixel)}`)

  assert.deepEqual(errors, [], '页面不应有未捕获异常')
} finally {
  await browser.close()
}
