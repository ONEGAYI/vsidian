// #358 T09 渲染提供者自动接管——真实浏览器绘制层回归（Chromium）：
// 安装测试渲染组件后无额外选择即替换内置 Mermaid 与普通语言显示、同批
// 多候选确定性默认序、用户按需调整与改回内置、停用后内置接管与恢复、
// 旧代次迟到异步结果不回潮、图形弹窗经生效提供者取图。
//
// 链路与生产同构：夹具（addonPageSdkFixture）装配生产 WebviewSyncController
// + 生产装载器 + 生产渲染桥（setAddonRenderersBridge / attachAddonRenderers
// ——与 main.ts 同款装配）；宿主角色经真实 AddonRendererService（内存持久
// 层）求生效表；组件产物（t09-addon/dist/editor.js）经本地 http 服务以真实
// URL 装载。绘制层断言落在计算色/几何/文本（t09-box 计算背景色
// rgb(9, 96, 246)）与内置 mermaid SVG 在场数——不是 DOM 存在性。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonRendererTakeover.js')

// ---- 组件产物构建（复用 V02 构建桥） ----
const layout = await buildTestAddons({ log: () => {} })

// ---- 夹具构建（katex 裸导入与字体裁剪同 addonHotSwitch 口径） ----
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
const MIME = { '.js': 'text/javascript', '.css': 'text/css' }
const assetServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const filePath = path.join(layout.t09Addon.distDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
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
const addonScriptUrl = `${origin}/editor.js`
const addonCssUrl = `${origin}/editor.css`

const ADDON_ID = 'vsidian-test-fixture.addon-t09'
const DOC = ['# T09', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', '```t09draw', 'hello-draw', '```', ''].join('\n')

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let failed = 0
async function scenario(name, run) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    // setContent 不触发 init script（本机 Playwright 实证）：改为在夹具
    // 装配后、文档装载前注入内置 mermaid 管线 mock（真实异步路径 + 缓存/
    // 串行队列——SVG 标记可区分内置与组件接管）
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    await page.evaluate(() => {
      window.mermaid = {
        initialize() {},
        render: async (_id, code) => ({ svg: '<svg data-builtin-mermaid="1" viewBox="0 0 100 30" width="100" height="30"><text x="2" y="18">' + code.slice(0, 6) + '</text></svg>' }),
      }
    })
    // 光标移出围栏（呈现态发射前提）
    await page.evaluate((doc) => {
      window.initDoc(doc)
      window.focusEditorAt(0)
    }, DOC)
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[T09][PASS] ${name}`)
  } catch (error) {
    failed++
    console.log(`[T09][FAIL] ${name}`)
    console.log(String(error?.stack ?? error))
  } finally {
    await page.close()
  }
}

const waitForBoxCount = (page, count) =>
  page.waitForFunction(
    (count) => window.rendererPaintInfo().boxes.length === count,
    count,
    { timeout: 8000 },
  )

// ---- 场景 1：安装后无额外选择即接管内置 Mermaid 与普通语言（双模式） ----
await scenario('安装自动接管：内置 Mermaid 替换 + 普通语言渲染 + Live/阅读按模式', async (page) => {
  // 接入前：内置 mermaid 绘制（SVG 在场、state rendered）；t09draw 是普通代码块
  await page.waitForFunction(() => window.rendererPaintInfo().builtinSvg > 0 && window.rendererPaintInfo().mermaidStates.includes('rendered'))
  let info = await page.evaluate(() => window.rendererPaintInfo())
  assert.equal(info.boxes.length, 0, '接入前无组件渲染内容')

  // 装载组件 + 宿主求表（新安装批次 1 → 默认序末位生效）
  const loaded = await page.evaluate(([script, css]) => window.loadRendererAddon(script, css, 1), [addonScriptUrl, addonCssUrl])
  assert.equal(loaded.ok, true, '组件装载应成功')
  const table = await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  const mermaidRow = table.languages.find((row) => row.language === 'mermaid')
  const drawRow = table.languages.find((row) => row.language === 't09draw')
  assert.equal(mermaidRow?.effective, `${ADDON_ID}/mermaid-alt`, '新安装组件应自动接管内置 mermaid')
  assert.equal(drawRow?.effective, `${ADDON_ID}/draw-beta`, '同批多候选按稳定 ID 升序末位生效（draw-beta）')

  // Live 绘制层：t09-box 计算色/几何/文本 + 内置 SVG 消失
  await waitForBoxCount(page, 2)
  info = await page.evaluate(() => window.rendererPaintInfo())
  const mermaidBox = info.boxes.find((box) => box.language === 'mermaid')
  const drawBox = info.boxes.find((box) => box.language === 't09draw')
  assert.equal(mermaidBox?.renderer, 'mermaid-alt')
  assert.equal(mermaidBox?.mode, 'live', 'Live 模式挂载')
  assert.equal(mermaidBox?.color, 'rgb(9, 96, 246)', '组件样式表实际生效（计算色）')
  assert.ok((mermaidBox?.width ?? 0) > 0, '绘制层非零几何')
  assert.equal(drawBox?.renderer, 'draw-beta')
  assert.ok((drawBox?.text ?? "").includes('hello-draw'), '源码进组件挂载')
  assert.equal(info.builtinSvg, 0, '内置 mermaid SVG 已被替换')
})

// ---- 场景 2：阅读模式按支持模式执行（mode=reading 挂载） ----
await scenario('阅读视图：生效提供者按 reading 模式挂载', async (page) => {
  await page.evaluate(([script, css]) => window.loadRendererAddon(script, css, 1), [addonScriptUrl, addonCssUrl])
  await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  await waitForBoxCount(page, 2)
  // 切阅读模式（宿主 view.mode.set 同款消息路径；live 侧 CM6 隐藏但
  // widget DOM 仍在文档——按 mode 过滤断言阅读挂载）
  await page.evaluate(() => window.switchMode('reading'))
  await page.waitForFunction(() => {
    const reading = window.rendererPaintInfo().boxes.filter((box) => box.mode === 'reading')
    return reading.some((box) => box.language === 'mermaid' && box.renderer === 'mermaid-alt') &&
      reading.some((box) => box.language === 't09draw' && box.renderer === 'draw-beta')
  }, null, { timeout: 8000 })
  const info = await page.evaluate(() => window.rendererPaintInfo())
  const reading = info.boxes.filter((box) => box.mode === 'reading')
  assert.equal(reading.length, 2, '阅读侧恰好两块挂载')
})

// ---- 场景 3：用户按需调整与改回内置（热切换） ----
await scenario('用户调整：draw 切 alpha 再回默认；mermaid 改回内置', async (page) => {
  await page.evaluate(([script, css]) => window.loadRendererAddon(script, css, 1), [addonScriptUrl, addonCssUrl])
  await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  await waitForBoxCount(page, 2)

  // 首选 alpha：热切换生效
  await page.evaluate(({ available, preferred }) => window.hostRendererStep(available, preferred), {
    available: [ADDON_ID],
    preferred: [['t09draw', `${ADDON_ID}/draw-alpha`]],
  })
  await page.waitForFunction(() => window.rendererPaintInfo().boxes.some((box) => box.language === 't09draw' && box.renderer === 'draw-alpha'), null, { timeout: 8000 })

  // 清除首选：回确定性默认序（beta）
  await page.evaluate(({ available, preferred }) => window.hostRendererStep(available, preferred), {
    available: [ADDON_ID],
    preferred: [['t09draw', null]],
  })
  await page.waitForFunction(() => window.rendererPaintInfo().boxes.some((box) => box.language === 't09draw' && box.renderer === 'draw-beta'), null, { timeout: 8000 })

  // mermaid 改回内置：内置 SVG 恢复绘制
  await page.evaluate(({ available, preferred }) => window.hostRendererStep(available, preferred), {
    available: [ADDON_ID],
    preferred: [['mermaid', 'builtin']],
  })
  await page.waitForFunction(() => window.rendererPaintInfo().builtinSvg > 0, null, { timeout: 8000 })
  const info = await page.evaluate(() => window.rendererPaintInfo())
  assert.equal(info.boxes.filter((box) => box.language === 'mermaid').length, 0, 'mermaid 组件内容已退场')
  assert.equal(info.builtinSvg, 1, '内置管线接管绘制')
})

// ---- 场景 4：Q30① 正常停用 → 内置接管（普通语言回落代码块）；恢复 → 原选择 ----
await scenario('停用内置接管与恢复：mermaid 回内置、t09draw 回代码块、恢复按原选择', async (page) => {
  await page.evaluate(([script, css]) => window.loadRendererAddon(script, css, 1), [addonScriptUrl, addonCssUrl])
  await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  await waitForBoxCount(page, 2)
  // 用户显式首选 draw-alpha（恢复后应按原选择显示——首选保留语义）
  await page.evaluate(({ available, preferred }) => window.hostRendererStep(available, preferred), {
    available: [ADDON_ID],
    preferred: [['t09draw', `${ADDON_ID}/draw-alpha`]],
  })
  await page.waitForFunction(() => window.rendererPaintInfo().boxes.some((box) => box.renderer === 'draw-alpha'), null, { timeout: 8000 })

  // 停用（可用性 false = 用户停用或整组件故障降级停用）
  await page.evaluate(() => window.hostRendererStep([]))
  await page.waitForFunction(() => window.rendererPaintInfo().builtinSvg > 0, null, { timeout: 8000 })
  let info = await page.evaluate(() => window.rendererPaintInfo())
  assert.equal(info.boxes.length, 0, '停用后组件渲染内容全部退场')
  assert.equal(info.builtinSvg, 1, '内置 mermaid 接管（无图形内置的 t09draw 回普通代码块——boxes 为空即证）')

  // 恢复：首选保留——draw 按 alpha 显示，mermaid 回组件
  await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  await waitForBoxCount(page, 2)
  info = await page.evaluate(() => window.rendererPaintInfo())
  assert.equal(info.boxes.find((box) => box.language === 't09draw')?.renderer, 'draw-alpha', '恢复后按原选择（首选保留）')
  assert.equal(info.boxes.find((box) => box.language === 'mermaid')?.renderer, 'mermaid-alt')
})

// ---- 场景 5：旧代次迟到异步结果不回潮（不覆盖恢复内容） ----
await scenario('迟到结果不回潮：接管后立即停用，延迟写入不进文档', async (page) => {
  await page.evaluate(([script, css]) => window.loadRendererAddon(script, css, 1), [addonScriptUrl, addonCssUrl])
  await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  await waitForBoxCount(page, 2)
  // mermaid-alt 的 mount 已调度 400ms 延迟写入（data-t09-late）——立即停用
  await page.evaluate(() => window.hostRendererStep([]))
  await page.waitForFunction(() => window.rendererPaintInfo().builtinSvg > 0, null, { timeout: 8000 })
  // 等待延迟写入到期：写入落在脱离文档的旧容器，正文不受影响
  await page.waitForTimeout(700)
  const info = await page.evaluate(() => window.rendererPaintInfo())
  assert.equal(info.lateMarks, 0, '迟到写入不得出现在文档中')
  assert.equal(info.builtinSvg, 1, '内置接管内容不被旧结果覆盖')
})

// ---- 场景 6：图形弹窗经生效提供者取图（导出能力链路） ----
await scenario('弹窗取图走生效提供者：draw-beta 的 svg 导出产物装载', async (page) => {
  await page.evaluate(([script, css]) => window.loadRendererAddon(script, css, 1), [addonScriptUrl, addonCssUrl])
  await page.evaluate((available) => window.hostRendererStep(available), [ADDON_ID])
  await waitForBoxCount(page, 2)
  const frame = page.locator('.vsidian-graphic-frame').nth(1)
  await frame.hover()
  await page.locator('.vsidian-graphic-chrome-popup').nth(1).click()
  await page.waitForSelector('.vsidian-diagram-overlay', { timeout: 8000 })
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay svg')?.getAttribute('data-t09-export') === 'draw-beta', null, { timeout: 8000 })
  await page.keyboard.press('Escape')
})

await browser.close()
assetServer.close()
if (failed > 0) {
  console.error(`[T09] 失败 ${failed} / 通过 ${passed}`)
  process.exit(1)
}
console.log(`[T09] 全部通过：${passed}`)
