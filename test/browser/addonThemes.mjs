// #546 T07 统一组件主题——真实浏览器回归（Chromium）：
// 主题关联提供者不走自动接管（安装只新增候选）、主题选中生效（绘制层：
// theme-box 计算色/几何/文本）、选中不可用回落与恢复、页面明暗快照与
// 订阅（缓存先更新后通知、重复值不广播、代次释放退订、组件图形重画）、
// 设置页「主题」页签单选/持久化/重开回显/搜索定位。
//
// 链路与生产同构：编辑器侧夹具装配生产 WebviewSyncController + 生产装载器
// + 生产渲染桥与主题环境 hub（addonPageSdkFixture）；宿主角色经真实
// AddonRendererService + resolveActiveTheme 求表。设置页侧用生产 settings
// bundle（settingsBundle.mjs）+ 宿主消息 mock 回环。绘制层断言落在计算色
// rgb(0, 138, 123)（theme-box）与内置 mermaid SVG 在场数——不是 DOM 存在性。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'
import { build as esbuild } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { artifactPath } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ---- 组件产物构建（复用 V02 构建桥） ----
const layout = await buildTestAddons({ log: () => {} })

// ---- Part 1：编辑器侧（夹具装配生产控制器 + 装载器） ----
const bundle = path.join(root, 'out/test/browser/addonThemesEditor.js')
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

const MIME = { '.js': 'text/javascript', '.css': 'text/css' }
const assetServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const filePath = path.join(layout.themeAddon.distDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
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
const themeScriptUrl = `${origin}/editor.js`
const themeCssUrl = `${origin}/editor.css`

const ADDON_ID = 'vsidian-test-fixture.addon-theme'
const DOC = ['# T07', '', '```mermaid', 'flowchart TD', '  A --> B', '```', ''].join('\n')

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let failed = 0
async function scenario(name, run) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    await page.evaluate(() => {
      window.mermaid = {
        initialize() {},
        render: async (_id, code) => ({ svg: '<svg data-builtin-mermaid="1" viewBox="0 0 100 30" width="100" height="30"><text x="2" y="18">' + code.slice(0, 6) + '</text></svg>' }),
      }
    })
    await page.evaluate((doc) => {
      window.initDoc(doc)
      window.focusEditorAt(0)
    }, DOC)
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[T07][PASS] ${name}`)
  } catch (error) {
    failed++
    console.log(`[T07][FAIL] ${name}`)
    console.log(String(error?.stack ?? error))
  } finally {
    await page.close()
  }
}

/** 装载主题组件 + 放行候选 + 注入目录（三步就绪） */
const setupTheme = async (page) => {
  const loaded = await page.evaluate(([script, css]) => window.loadThemeAddon(script, css, 1), [themeScriptUrl, themeCssUrl])
  assert.equal(loaded.ok, true, '主题夹具组件装载应成功')
  const granted = await page.evaluate(() => window.grantThemeProviders())
  assert.equal(granted, 1, '页面应发出候选放行询问')
  await page.evaluate(() => window.setThemeCatalog([
    { addonId: 'vsidian-test-fixture.addon-theme', themeId: 'aqua', rendererId: 'aqua-renderer', languages: ['mermaid'] },
  ]))
}

// ---- 场景 1：安装不切换（主题提供者不走自动接管）；选中才生效（绘制层） ----
await scenario('主题例外：安装不接管内置 mermaid；选中后生效（计算色绘制层）', async (page) => {
  await setupTheme(page)
  // 首选 default：主题提供者候选在场但不接管（H-U03/H-U11）
  let step = await page.evaluate((preferred) => window.hostThemeRendererStep(['vsidian-test-fixture.addon-theme'], preferred), 'default')
  const mermaidRow = step.languages.find((row) => row.language === 'mermaid')
  assert.equal(mermaidRow?.effective, 'builtin', '主题提供者不走自动接管（安装只新增候选）')
  // 内置 mermaid 绘制在场
  await page.waitForFunction(() => window.rendererPaintInfo().builtinSvg > 0, null, { timeout: 8000 })
  let paint = await page.evaluate(() => window.rendererPaintInfo())
  assert.equal(paint.boxes.length, 0, '无组件渲染内容（未选中主题）')

  // 选中组件主题：生效该提供者（source=user）
  step = await page.evaluate((preferred) => window.hostThemeRendererStep(['vsidian-test-fixture.addon-theme'], preferred), 'vsidian-test-fixture.addon-theme/aqua')
  assert.equal(step.theme.activeProviderId, `${ADDON_ID}/aqua-renderer`, '选中主题解析出关联提供者')
  const row = step.languages.find((r) => r.language === 'mermaid')
  assert.equal(row?.effective, `${ADDON_ID}/aqua-renderer`)
  assert.equal(row?.source, 'user')
  // 绘制层：theme-box 计算色/几何/文本 + 内置 SVG 退场
  await page.waitForFunction(() => window.themePaintInfo().boxes.length > 0, null, { timeout: 8000 })
  paint = await page.evaluate(() => ({ ...window.themePaintInfo(), builtin: window.rendererPaintInfo().builtinSvg }))
  const box = paint.boxes[0]
  assert.equal(box?.renderer, 'aqua-renderer')
  assert.equal(box?.language, 'mermaid')
  assert.equal(box?.color, 'rgb(0, 138, 123)', '主题组件样式表实际生效（计算色）')
  assert.ok((box?.width ?? 0) > 0, '绘制层非零几何')
  assert.ok((box?.text ?? '').includes('flowchart'), '源码进主题渲染')
  assert.equal(paint.builtin, 0, '内置 mermaid SVG 已被主题渲染替换')
})

// ---- 场景 2：选中主题不可用回落内置与恢复（首选保留——绘制层） ----
await scenario('不可用回落与恢复：停用回内置绘制、恢复按原选择继续', async (page) => {
  await setupTheme(page)
  await page.evaluate((preferred) => window.hostThemeRendererStep(['vsidian-test-fixture.addon-theme'], preferred), 'vsidian-test-fixture.addon-theme/aqua')
  await page.waitForFunction(() => window.themePaintInfo().boxes.length > 0, null, { timeout: 8000 })

  // 组件不可用（停用/故障）：主题提供者退出，内置 default 承接显示
  const step = await page.evaluate((preferred) => window.hostThemeRendererStep([], preferred), 'vsidian-test-fixture.addon-theme/aqua')
  assert.equal(step.theme.available, false, '首选组件主题不可用')
  assert.equal(step.theme.effective, 'default', '回落内置 default（不用其他主题顶替）')
  assert.equal(step.theme.preferred, 'vsidian-test-fixture.addon-theme/aqua', '首选保留')
  await page.waitForFunction(() => window.rendererPaintInfo().builtinSvg > 0, null, { timeout: 8000 })
  let paint = await page.evaluate(() => ({ boxes: window.themePaintInfo().boxes.length, builtin: window.rendererPaintInfo().builtinSvg }))
  assert.equal(paint.boxes, 0, '主题渲染内容退场')
  assert.equal(paint.builtin, 1, '内置接管绘制')

  // 恢复可用：按原选择继续（主题渲染回归——绘制层）
  await page.evaluate((preferred) => window.hostThemeRendererStep(['vsidian-test-fixture.addon-theme'], preferred), 'vsidian-test-fixture.addon-theme/aqua')
  await page.waitForFunction(() => window.themePaintInfo().boxes.length > 0, null, { timeout: 8000 })
  paint = await page.evaluate(() => window.themePaintInfo())
  assert.equal(paint.boxes[0]?.color, 'rgb(0, 138, 123)', '恢复后按原选择（主题渲染回归）')
})

// ---- 场景 3：页面明暗快照与订阅（缓存先更新、重复值不广播、组件图形重画、释放退订） ----
await scenario('明暗四态：订阅通知、重复值不广播、组件图形重画、释放退订', async (page) => {
  await setupTheme(page)
  await page.evaluate((preferred) => window.hostThemeRendererStep(['vsidian-test-fixture.addon-theme'], preferred), 'vsidian-test-fixture.addon-theme/aqua')
  await page.waitForFunction(() => window.themePaintInfo().boxes.length > 0, null, { timeout: 8000 })

  // 初始快照（亮色）
  assert.deepEqual(await page.evaluate(() => window.themeEnvironmentNow()), { dark: false, highContrast: false })
  let box = (await page.evaluate(() => window.themePaintInfo())).boxes[0]
  assert.equal(box?.dark, '0', '初始亮色标记')

  // 切暗：组件在回调中改写已挂载图形（H-U07 消费样例——绘制层断言）
  await page.evaluate(() => window.pushThemeEnvironment({ dark: true, highContrast: false }))
  await page.waitForFunction(() => window.themePaintInfo().boxes[0]?.dark === '1', null, { timeout: 4000 })
  assert.deepEqual(await page.evaluate(() => window.themeEnvironmentNow()), { dark: true, highContrast: false }, '快照已更新')
  assert.equal((await page.evaluate(() => window.themePaintInfo())).boxes[0]?.color, 'rgb(0, 70, 64)', '已挂载图形实际暗色重画')

  // 亮色高对比：dark=false（不误判为暗）、hc 标记翻转
  await page.evaluate(() => window.pushThemeEnvironment({ dark: false, highContrast: true }))
  await page.waitForFunction(() => window.themePaintInfo().boxes[0]?.hc === '1', null, { timeout: 4000 })
  box = (await page.evaluate(() => window.themePaintInfo())).boxes[0]
  assert.equal(box?.dark, '0', '亮色高对比不误判为暗')

  // 重复值不广播：事件计数不增
  const countBefore = await page.evaluate(() => window.__t07ThemeEnvEvents.length)
  await page.evaluate(() => window.pushThemeEnvironment({ dark: false, highContrast: true }))
  const countAfter = await page.evaluate(() => window.__t07ThemeEnvEvents.length)
  assert.equal(countAfter, countBefore, '重复值不重复通知')

  // 代次释放退订：卸载组件后推送不再触发组件回调（事件计数冻结）
  await page.evaluate(() => window.unloadThemeAddon(1))
  await page.evaluate(() => window.pushThemeEnvironment({ dark: true, highContrast: false }))
  const countFinal = await page.evaluate(() => window.__t07ThemeEnvEvents.length)
  assert.equal(countFinal, countAfter, '释放后组件订阅退订（不再收到通知）')
  // 页面快照仍更新（hub 页面级，不随组件释放）
  assert.deepEqual(await page.evaluate(() => window.themeEnvironmentNow()), { dark: true, highContrast: false })
})

// ---- 场景 4：阅读模式主题渲染（mode=reading 挂载） ----
await scenario('阅读视图：主题提供者按 reading 模式挂载', async (page) => {
  await setupTheme(page)
  await page.evaluate((preferred) => window.hostThemeRendererStep(['vsidian-test-fixture.addon-theme'], preferred), 'vsidian-test-fixture.addon-theme/aqua')
  await page.waitForFunction(() => window.themePaintInfo().boxes.length > 0, null, { timeout: 8000 })
  await page.evaluate(() => window.switchMode('reading'))
  await page.waitForFunction(() => window.themePaintInfo().boxes.some((box) => box.mode === 'reading' && box.renderer === 'aqua-renderer'), null, { timeout: 8000 })
})

await browser.close()
assetServer.close()

// ---- Part 2：设置页（生产 settings bundle + 宿主消息 mock 回环） ----
const settingsOutput = await buildSettingsMain(root)
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)
const enFile = artifactPath(root, 'addon-theme-en.mjs')
await esbuild({ stdin: { contents: "export { en } from './src/shared/locales/en.ts'", loader: 'ts', resolveDir: root }, bundle: true, format: 'esm', outfile: enFile, platform: 'node' })
const { en } = await import(pathToFileURL(enFile).href)
const settingsBrowser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const artifacts = artifactPath(root, 'screenshots/addonThemes')
await mkdir(artifacts, { recursive: true })

const themesState = {
  kind: 'addons.themesState',
  version: 3,
  themes: [
    {
      addonId: 'vsidian-test-fixture.addon-theme',
      themeId: 'aqua',
      themeRef: 'vsidian-test-fixture.addon-theme/aqua',
      label: { 'zh-cn': '水青', en: 'Aqua' },
      rendererId: 'aqua-renderer',
      providerId: 'vsidian-test-fixture.addon-theme/aqua-renderer',
      languages: ['mermaid'],
      available: true,
    },
    {
      addonId: 'other.publisher.pack',
      themeId: 'aqua',
      themeRef: 'other.publisher.pack/aqua',
      label: { 'zh-cn': '水青', en: 'Aqua' },
      rendererId: 'aqua-renderer',
      providerId: 'other.publisher.pack/aqua-renderer',
      languages: ['mermaid'],
      available: false,
    },
  ],
  preferred: 'default',
  preferredAvailable: true,
}

const page = await settingsBrowser.newPage({ viewport: { width: 1100, height: 720 } })
const errors = []
page.on('pageerror', (err) => errors.push(err.message))
await page.setContent(`<html lang="zh-CN"><body class="">${islandHtml}<div id="app"></div></body></html>`)
await page.addStyleTag({ path: settingsOutput.replace(/\.js$/, '.css') })
await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#ffffff; --vscode-editor-foreground:#30343b; --vscode-sideBar-background:#f5f6f8; --vscode-descriptionForeground:#59616d; --vscode-list-activeSelectionBackground:#e0e4eb; --vscode-list-activeSelectionForeground:#26313e; --vscode-input-background:#ffffff; --vscode-input-foreground:#30343b; --vscode-panel-border:#d7dce3; --vscode-focusBorder:#2687d4; }` })
await page.evaluate((state) => {
  window.savedSettings = { 'appearance.mermaidTheme': 'codex' }
  window.sentMessages = []
  window.themesState = state
  window.acquireVsCodeApi = () => ({ postMessage(message) {
    window.sentMessages.push(message)
    setTimeout(() => {
      if (message.kind === 'settings.set') {
        Object.assign(window.savedSettings, message.values)
        window.themesState = { ...window.themesState, preferred: message.values['appearance.theme'], preferredAvailable: true }
        window.dispatchEvent(new MessageEvent('message', { source: window, data: window.themesState }))
      }
      if (message.kind === 'settings.uiState') return
      if (message.kind === 'addons.themesGet') {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: window.themesState }))
        return
      }
      if (message.kind === 'addons.get') {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: {
          kind: 'addons.state', apiVersion: '1.0.0', draft: false, addons: [
            { id: 'vsidian-test-fixture.addon-theme', label: '主题夹具', official: false, status: 'registered' },
            { id: 'other.publisher.pack', label: '第三方主题包', official: false, status: 'registered' },
          ], openAddonSettingsPage: null, openAddonSettings: null,
        } }))
        return
      }
      // settings.set → changed 回执；get → snapshot（主题 preferred 经推送对账）
      window.dispatchEvent(new MessageEvent('message', { source: window, data: {
        kind: message.kind === 'settings.set' ? 'settings.changed' : 'settings.snapshot',
        values: window.savedSettings,
      } }))
    }, 0)
  } })
}, themesState)
await page.addScriptTag({ path: settingsOutput })
try {
  // 进入外观分页 → 「主题」页签（原预设主题原位更名——H-U01）
  await page.getByRole('button', { name: zhCn['appearance.title'], exact: true }).click()
  await page.getByRole('tab', { name: zhCn['appearance.themes'], exact: true }).click()
  // 单选列表：内置 default/codex + 两个组件主题（同名主题按来源区分——H-U01/H-U08）
  await page.waitForFunction(() => document.querySelectorAll('.vsidian-appearance-presets input[type=radio]').length >= 4, null, { timeout: 8000 })
  const radios = page.locator('.vsidian-appearance-presets input[type=radio]')
  assert.equal(await radios.count(), 4, 'default + codex + 两个组件主题')
  // 升级用户旧键 codex 回显（目录 preferred 权威未达前——宿主推送 themesState.preferred=default 到达后 codex 回显由宿主权威驱动；
  // 此处宿主 mock preferred=default，断言 default 选中）——H-U04 回显走宿主推送
  assert.equal(await radios.nth(0).isChecked(), true, 'preferred=default 选中')

  // 同名主题来源徽章：两个 aqua 分别标来源（H-U01）——addons.state 的组件
  // 显示名表异步到达，先等来源徽章解析为组件显示名
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.vsidian-appearance-presets .vsidian-theme-option-source')].some((el) => el.textContent === '主题夹具'), null, { timeout: 8000 })
  const sources = await page.locator('.vsidian-appearance-presets .vsidian-theme-option-source').allTextContents()
  assert.ok(sources.includes('主题夹具'), '组件主题标来源（显示名）')
  assert.ok(sources.includes('第三方主题包'), '同名主题按来源区分')
  // 不可用主题：禁用态 + 徽章（H-U05 呈现）
  const unavailableRow = page.locator('.vsidian-appearance-presets label:has(input[value="other.publisher.pack/aqua"])')
  assert.equal(await unavailableRow.locator('input').isDisabled(), true, '不可用主题 radio 禁用')
  assert.equal(await unavailableRow.locator('.vsidian-theme-option-unavailable').textContent(), zhCn['appearance.theme.unavailable'])

  // 单选切换：点击组件主题 → settings.set 双键补丁（H-U02/H-U04 持久化）
  await page.locator('.vsidian-appearance-presets input[value="vsidian-test-fixture.addon-theme/aqua"]').check()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'settings.set' && m.values['appearance.theme'] === 'vsidian-test-fixture.addon-theme/aqua'), null, { timeout: 8000 })
  const setMsg = await page.evaluate(() => window.sentMessages.find((m) => m.kind === 'settings.set' && m.values['appearance.theme']))
  assert.equal(setMsg.values['appearance.mermaidTheme'], 'default', '旧键同步写 preset 投影')
  await page.getByRole('button', { name: zhCn['keybindingSettings.title'], exact: true }).click()
  await page.getByRole('button', { name: zhCn['appearance.title'], exact: true }).click()
  await page.getByRole('tab', { name: zhCn['appearance.themes'], exact: true }).click()
  assert.equal(await page.locator('.vsidian-appearance-presets input[value="vsidian-test-fixture.addon-theme/aqua"]').isChecked(), true, '重开外观回显已保存首选')

  // 目录推送对账：preferred 变化后选中回显（宿主权威——H-U04 重开回显同机制）
  await page.evaluate((state) => {
    window.themesState = { ...state, version: 4, preferred: 'codex', preferredAvailable: true }
    window.dispatchEvent(new MessageEvent('message', { source: window, data: window.themesState }))
  }, themesState)
  await page.waitForFunction(() => {
    const codex = document.querySelector('.vsidian-appearance-presets input[value=codex]')
    return codex?.checked === true
  }, null, { timeout: 8000 })

  // 搜索定位：主题设置条目可搜（H-U08）——输入「主题选择」出现结果并点击路由
  const search = page.getByRole('searchbox', { name: zhCn['settings.searchAriaLabel'] })
  await search.fill(zhCn['setting.theme.title'])
  const result = page.locator('.vsidian-settings-result', { hasText: zhCn['setting.theme.title'] })
  await result.first().waitFor({ timeout: 8000 })
  await result.first().click()
  // 路由落点：外观分页主题页签（radiogroup 可见）
  await page.waitForFunction(() => {
    const panel = document.querySelector('.vsidian-appearance-presets')
    return panel !== null && !panel.hasAttribute('hidden') && panel.querySelectorAll('input[type=radio]').length >= 4
  }, null, { timeout: 8000 })

  // 首选不可用回落提示（保留首选回显——H-U05）：宿主推送 preferred 指向不可用主题
  await page.evaluate((state) => {
    window.themesState = { ...state, version: 5, preferred: 'other.publisher.pack/aqua', preferredAvailable: false }
    window.dispatchEvent(new MessageEvent('message', { source: window, data: window.themesState }))
  }, themesState)
  await page.waitForFunction(() => document.querySelector('.vsidian-theme-fallback') !== null, null, { timeout: 8000 })
  const fallbackText = await page.locator('.vsidian-theme-fallback').textContent()
  assert.equal(fallbackText, zhCn['appearance.theme.fallbackNotice'])
  // 回落态仍选中原首选（不静默换主题）
  assert.equal(await page.locator('.vsidian-appearance-presets label:has(input[value="other.publisher.pack/aqua"]) input').isChecked(), true)

  const geometry = await page.locator('.vsidian-theme-option').first().evaluate((row) => ({ padding: getComputedStyle(row).paddingTop, radio: row.querySelector('input').getBoundingClientRect().width, nestedCard: row.closest('.vsidian-theme-group').classList.contains('vsidian-settings-group') }))
  assert.deepEqual(geometry, { padding: '18px', radio: 16, nestedCard: false }, '标准设置行节奏、16px控件、外观大卡片承载组头')
  await page.evaluate((messages) => window.dispatchEvent(new MessageEvent('message', { source: window, data: { kind: 'locale.changed', lang: 'en', messages } })), en)
  await page.getByRole('tab', { name: en['appearance.themes'], exact: true }).waitFor()
  assert.equal(await page.locator('.vsidian-theme-option-name', { hasText: 'Aqua' }).count(), 2, '组件多语言名随页面语言变化')

  await page.screenshot({ path: path.join(artifacts, 'settings-theme.png') })
  assert.deepEqual(errors, [], '设置页无页面错误')
  passed++
  console.log('[T07][PASS] 设置页主题页签：单选/来源/不可用/持久化/回显/搜索/回落提示')
} catch (error) {
  failed++
  console.log('[T07][FAIL] 设置页主题页签')
  console.log(String(error?.stack ?? error))
} finally {
  await page.close()
}

await settingsBrowser.close()

if (failed > 0) {
  console.error(`[T07] 失败 ${failed} / 通过 ${passed}`)
  process.exit(1)
}
console.log(`[T07] 全部通过：${passed}`)
