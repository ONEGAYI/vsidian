// #360 T11 附加组件界面贡献的原生浏览器回归：生产控制器 + 生产装载器 +
// 生产命令注册表 + 生产界面运行时（addonT11UiFixture 装配——与生产 main.js
// 同源），组件产物（t11-addon 经 V02 构建桥 chrome114 IIFE）经本地 http
// 服务真实装载。场景（真实指针/键盘 + 绘制层断言）：
// 1. 装载与注册：三枚按钮挂进平台槽（命名空间 data 属性 + aria/tooltip 承
//    载 + 命令按钮键位徽章）；负向四例明确拒绝（t11.register 收件断言）；
// 2. 真实点击：stampBtn 真实指针点击 → onClick 经 target 句柄真实提交
//    （T11-BTN 出现在正文，一次宿主撤销单位）；
// 3. 悬停提示：#300 体系——悬停组件按钮后自绘 tooltip 卡片出现（组件
//    自由文本 label），命令按钮带键位徽章段；
// 4. 面板生命周期：open → 平台 chrome（标题/关闭按钮 aria）+ 组件内容
//    绘制命中；真实点击关闭按钮 → 面板消失；迟到写入（组件往保留根写）
//    不再可见；
// 5. 模式回收：切 reading 后 live-only 按钮撤挂（绘制层不可见、DOM 离
//    场）、both 按钮常驻；切回 live 恢复；
// 6. 卸载回收（停用路径）：全部组件按钮/面板撤下，内置工具栏按钮原样，
//    槽容器空态零占位。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'
import { buildTestAddons, CM6_RUNTIME_MARKERS } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/addonT11Ui.js')
const ADDON_ID = 'vsidian-test-fixture.addon-t11'

// ---- 0. 组件产物构建 + 静态红线（CM6 不重打包） ----
const layout = await buildTestAddons({ log: () => {} })
const t11Entry = path.join(layout.t11Addon.distDir, 'editor.js')
const product = await readFile(t11Entry, 'utf8')
for (const marker of CM6_RUNTIME_MARKERS) {
  assert.ok(!product.includes(marker), `组件产物不得含 CM6 运行时标记（${marker}）`)
}
console.log(`[T11][ok] 组件产物 ${t11Entry}（${(await stat(t11Entry)).size} B，无 CM6 标记）`)

// ---- 1. 夹具构建（katex 裸导入与字体裁剪同 addonPageSdk 口径） ----
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
await esbuild({ entryPoints: [path.join(root, 'test/browser/addonT11UiFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// ---- 2. 组件产物 http 服务（真实 URL 装载） ----
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const assetServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const filePath = path.join(layout.t11Addon.distDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
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
    console.log(`[T11][PASS] ${name}`)
  } catch (error) {
    failed++
    console.log(`[T11][FAIL] ${name}`)
    console.log(error)
  } finally {
    await page.close()
  }
}

/** 装载组件并等注册收件（返回 outcomes） */
async function loadAndRegister(page) {
  await page.evaluate(async (uri) => {
    window.initDoc('T11 正文基态\n')
    await window.loadT11(uri, 1)
  }, scriptUrl)
  return await poll(page, async () => {
    const regs = await page.evaluate(() => window.takeRegistrations())
    return regs.length > 0 ? regs[0].outcomes : undefined
  })
}

async function poll(page, fn, label = '条件', timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== null) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`等待超时：${label}`)
    }
    await page.waitForTimeout(80)
  }
}

// ---- 3. 场景 ----

await scenario('装载注册：三按钮绘制可见、键位徽章与负向拒绝', async (page) => {
  const outcomes = await loadAndRegister(page)
  // 正向：命名空间 ID
  assert.equal(outcomes['stampBtn'].ok, true)
  assert.equal(outcomes['stampBtn'].id, `${ADDON_ID}.stampBtn`)
  assert.equal(outcomes['cmdBtn'].ok, true)
  assert.equal(outcomes['liveOnlyBtn'].ok, true)
  assert.equal(outcomes['notesPanel'].ok, true)
  // 负向四例：明确拒绝（普通 API 拒绝）
  assert.equal(outcomes['dupButton'].ok, false)
  assert.match(outcomes['dupButton'].reason, /duplicate-button/)
  assert.match(outcomes['slotButton'].reason, /slot/)
  assert.match(outcomes['conflictButton'].reason, /action-conflict/)
  assert.match(outcomes['dupPanel'].reason, /duplicate-panel/)
  // 绘制层：三按钮可见（elementFromPoint 命中）；命令按钮键位徽章
  const probe = await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.buttons.length === 3 && p.buttons.every((b) => b.visible) ? p : undefined
  }, '三按钮绘制可见')
  const cmd = probe.buttons.find((b) => b.id === `${ADDON_ID}.cmdBtn`)
  // #448：徽章经 formatBindingLabel 平台渲染（headless Chromium 本机 Windows → Win 形态）
  assert.equal(cmd.tooltipKeys, 'Ctrl+Alt+T', '命令按钮键位徽章（默认绑定经运行期表）')
  assert.equal(cmd.tooltip, 'T11 Cmd')
})

await scenario('真实点击与悬停提示：onClick 经 target 句柄真实提交 + data-tooltip 体系', async (page) => {
  await loadAndRegister(page)
  // 真实指针点击（不注入）：按钮坐标点击
  await page.click(`button[data-addon-button="${ADDON_ID}.stampBtn"]`)
  const editor = await poll(page, async () => {
    const e = await page.evaluate(() => window.readEditor())
    return e.text.includes('T11-BTN') ? e : undefined
  }, 'T11-BTN 出现在正文（真实提交链）')
  assert.ok(await page.evaluate(async () => window.settleInputs()), '输入落定')
  // 悬停提示（#300 体系）：悬停命令按钮 → 自绘 tooltip 出现（组件自由文本 + 键位徽章段）
  await page.hover(`button[data-addon-button="${ADDON_ID}.cmdBtn"]`)
  const tooltip = await poll(page, async () => {
    return await page.evaluate(() => {
      const card = document.querySelector('.vsidian-tooltip.vsidian-tooltip--shown')
      if (!card) return undefined
      return {
        text: card.querySelector('.vsidian-tooltip-text')?.textContent ?? '',
        keys: [...card.querySelectorAll('.vsidian-tooltip-key')].map((k) => k.textContent),
      }
    })
  }, '悬停提示卡片出现')
  assert.equal(tooltip.text, 'T11 Cmd')
  assert.deepEqual(tooltip.keys, ['Ctrl+Alt+T'])
  assert.ok(editor.text.length > 0)
})

await scenario('面板生命周期：open 绘制命中、真实点击关闭、迟到写入不可见', async (page) => {
  await loadAndRegister(page)
  const opened = await page.evaluate(async () => window.runOp('openPanel'))
  assert.equal(opened.opened, true, `面板应打开（${JSON.stringify(opened)}）`)
  const probe = await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.panels.length === 1 && p.panels[0].contentVisible ? p : undefined
  }, '面板内容绘制命中')
  const panel = probe.panels[0]
  assert.equal(panel.id, `${ADDON_ID}.notes`)
  assert.equal(panel.title, 'T11 Notes')
  assert.equal(panel.content, 'T11-PANEL-CONTENT')
  assert.ok(panel.closeLabel.length > 0, '关闭按钮平台文案（i18n）在场')
  // mount 的 target 解析主正文（焦点未落嵌入）
  const state = await page.evaluate(async () => window.runOp('panelState'))
  assert.equal(state.targetSeen.at(-1), 'main')
  // 真实点击关闭按钮：面板消失
  await page.click(`[data-addon-panel="${ADDON_ID}.notes"] .vsidian-addon-panel-close`)
  await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.panels.length === 0 ? p : undefined
  }, '面板关闭后消失')
  // 迟到写入：组件往保留根写内容——不可见（dock 文本不含）
  await page.evaluate(async () => window.runOp('lateWrite'))
  const late = await page.evaluate(async () => window.runOp('panelState'))
  assert.equal(late.open, false)
  const dockText = await page.evaluate(() =>
    document.querySelector('.vsidian-addon-panel-dock')?.textContent ?? '')
  assert.ok(!dockText.includes('T11-LATE-RESULT'), '迟到结果不得进入失效面板')
})

await scenario('模式回收：reading 撤挂 live-only 按钮、both 常驻、切回恢复', async (page) => {
  await loadAndRegister(page)
  await page.evaluate(() => window.switchMode('reading'))
  const reading = await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.buttons.length === 2 ? p : undefined
  }, 'reading 态 live-only 按钮撤挂')
  assert.ok(!reading.buttons.some((b) => b.id === `${ADDON_ID}.liveOnlyBtn`),
    `live-only 按钮应撤挂（实际 ${JSON.stringify(reading.buttons.map((b) => b.id))}）`)
  assert.ok(reading.buttons.every((b) => b.visible), 'both 按钮常驻且可见')
  // 阅读态打开 live-only 面板：拒绝（模式声明门控）
  const livePanelOpened = await page.evaluate(async () => window.runOp('openLivePanel'))
  assert.equal(livePanelOpened.opened, false, 'live-only 面板在阅读态不得打开')
  // 切回 live：恢复
  await page.evaluate(() => window.switchMode('live'))
  await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.buttons.length === 3 && p.buttons.every((b) => b.visible) ? p : undefined
  }, '切回 live 按钮恢复')
})

await scenario('卸载回收：全部挂载撤下、内置工具栏原样、槽空态零占位', async (page) => {
  await loadAndRegister(page)
  await page.evaluate(async () => window.runOp('openPanel'))
  await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.panels.length === 1 ? p : undefined
  }, '面板打开预置')
  await page.evaluate(async () => window.unloadT11(1))
  const after = await poll(page, async () => {
    const p = await page.evaluate(() => window.probeAddonUi())
    return p.buttons.length === 0 && p.panels.length === 0 ? p : undefined
  }, '卸载后组件界面全撤')
  assert.equal(after.buttons.length, 0)
  assert.equal(after.panels.length === undefined ? 0 : after.panels.length, 0)
  // 内置工具栏按钮原样（设置/快速操作/刷新/双态/侧栏五按钮可见）
  const builtinVisible = await page.evaluate(() => {
    const ids = ['vsidian-settings-toggle', 'vsidian-quick-toggle', 'vsidian-refresh-toggle', 'vsidian-view-toggle', 'vsidian-sidebar-toggle']
    return ids.map((cls) => {
      const el = document.querySelector(`.vsidian-toolbar .${cls}`)
      if (!(el instanceof HTMLElement)) return false
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return hit !== null && el.contains(hit)
    }).every((v) => v === true)
  })
  assert.ok(builtinVisible, '内置五按钮应原样可见（不受组件卸载影响）')
  // 槽空态零占位（:empty → display:none）
  const slotDisplay = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.vsidian-toolbar .vsidian-addon-toolbar-slot')).display)
  assert.equal(slotDisplay, 'none', '空槽应零占位')
})

await browser.close()
await assetServer.close()
if (failed > 0) {
  console.log(`[T11] 失败 ${failed} / 通过 ${passed}`)
  process.exit(1)
}
console.log(`[T11] 全部通过（${passed}）`)
