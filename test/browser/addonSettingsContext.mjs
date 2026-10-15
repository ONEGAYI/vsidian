// #553 组件设置详情自绘页优先——生产设置页入口的真实浏览器回归：
// 真实 defineAddonPage 工厂（settingsContextSettings.ts 夹具）经生产
// settingsMain 装载器装载进详情首屏；基础设置转次级页签；作用域切换与
// 全局搜索定位经 SDK settingsContext 面交付（消费夹具回显）；生命周期
// （故障撤下/重试恢复/切换组件）。绘制层断言：夹具回显行计算色（组件
// 样式经装载器 <link> 注入）与可见几何——非 DOM 存在性。宿主应答由页内
// mock 桥回灌（含 addonPage.directive 装载指令——与生产宿主推送同形）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = await buildSettingsMain(root)
const artifacts = artifactPath(root, 'screenshots/addonSettingsContext')
await mkdir(artifacts, { recursive: true })
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

// ---- 夹具组件产物（真实 defineAddonPage 工厂 + 组件样式）与 http 服务 ----
const layout = await buildTestAddons({ log: () => {} })
const MIME = { '.js': 'text/javascript', '.css': 'text/css' }
const assetServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const filePath = path.join(layout.settingsContextAddon.distDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
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
const scriptUrl = `${origin}/settings.js`
const cssUrl = `${origin}/settings.css`

const ADDON_ID = 'vsidian-test-fixture.settings-context'
const PLAIN_ID = 'fixture.plain-b'

const DEFINITIONS = [
  { key: 'flag', title: '开关项', description: '开关项描述', type: 'boolean', default: true },
]

/** 页内 mock 宿主状态（回灌应答的数据源——消息构造在 evaluate 内联） */
const hostState = {
  open: null,
  hasWorkspace: true,
  faulted: false,
  /** 当前挂载的自绘页（openAddonSettingsPage 的 mock 权威值） */
  mountedPage: null,
  values: {},
  enabled: { effective: true, userExplicit: null, workspaceExplicit: null, source: 'default' },
  notice: undefined,
}

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#ffffff; --vscode-editor-foreground:#30343b; --vscode-sideBar-background:#f5f6f8; --vscode-descriptionForeground:#59616d; --vscode-list-activeSelectionBackground:#e0e4eb; --vscode-list-activeSelectionForeground:#26313e; --vscode-input-background:#ffffff; --vscode-input-foreground:#30343b; --vscode-panel-border:#d7dce3; --vscode-focusBorder:#2687d4; --vscode-button-background:#0078d4; --vscode-button-foreground:#ffffff; --vscode-errorForeground:#f66; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.evaluate((state) => {
    window.sentMessages = []
    const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    window.acquireVsCodeApi = () => ({ postMessage(message) {
      window.sentMessages.push(message)
      setTimeout(() => {
        if (message.kind === 'addons.get') { post(window.__addonsState()); return }
        if (message.kind === 'addons.settingsGet') { post(window.__settingsState()); return }
        if (message.kind === 'addons.settingsOpen') {
          window.__hostState.open = message.addonId
          post(window.__addonsState())
          post(window.__settingsState())
          return
        }
        if (message.kind === 'addons.settingsClose') {
          window.__hostState.open = null
          post(window.__settingsState())
          return
        }
        if (message.kind === 'addons.openAddonPage') {
          window.__hostState.mountedPage = message.addonId
          window.__loadGeneration += 1
          post(window.__addonsState())
          post({ kind: 'addonPage.directive', directive: { type: 'addon.load', manifest: {
            addonId: message.addonId, generation: window.__loadGeneration, page: 'settings',
            scriptUri: window.__scriptUrl, cssUris: [window.__cssUrl],
          } } })
          return
        }
        if (message.kind === 'addons.closeAddonPage') {
          const had = window.__hostState.mountedPage
          window.__hostState.mountedPage = null
          post(window.__addonsState())
          if (had !== null) {
            post({ kind: 'addonPage.directive', directive: { type: 'addon.unload', addonId: had, generation: window.__loadGeneration } })
          }
          return
        }
        if (message.kind === 'addons.settingsUpdate') {
          for (const [key, value] of Object.entries(message.values)) {
            window.__hostState.values[key] = { [message.scope]: value, effective: value, source: message.scope }
          }
          window.__hostState.notice = { kind: 'saved', scope: message.scope, keys: Object.keys(message.values) }
          post(window.__settingsState())
          return
        }
        if (message.kind === 'settings.uiState') return
      }, 0)
    } })
    window.__hostState = state
  }, hostState)
  await page.evaluate(({ state, defs, script, css }) => {
    window.__hostState = state
    window.__defs = defs
    window.__scriptUrl = script
    window.__cssUrl = css
    window.__loadGeneration = 0
    window.__addonsState = () => ({
      kind: 'addons.state', apiVersion: '1.0.0', draft: true,
      openAddonSettingsPage: window.__hostState.mountedPage, openAddonSettings: window.__hostState.open,
      addons: [
        {
          id: 'vsidian-test-fixture.settings-context', label: 'SCX', official: false, status: 'registered',
          enabled: window.__hostState.enabled.effective,
          hasSettingsPage: !window.__hostState.faulted, hasSettingsDefinitions: true,
          settingsSearchIndex: { definitions: window.__defs.map((def) => ({ key: def.key, title: def.title })), groups: [] },
          ...(window.__hostState.faulted ? { fault: { reason: 'setup 异常：boom' } } : {}),
        },
        { id: 'fixture.plain-b', label: 'PlainB', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      ],
    })
    window.__settingsState = () => {
      const values = {}
      for (const def of window.__defs) {
        values[def.key] = { effective: def.default, source: 'default', ...(window.__hostState.values[def.key] ?? {}) }
      }
      const open = window.__hostState.open
      return {
        kind: 'addons.settingsState', apiVersion: '1.0.0', draft: true,
        open, hasWorkspace: window.__hostState.hasWorkspace,
        addon: open === null ? null : {
          addonId: open, label: open === 'vsidian-test-fixture.settings-context' ? 'SCX' : 'PlainB',
          faulted: window.__hostState.faulted, hasCustomPage: open === 'vsidian-test-fixture.settings-context' && !window.__hostState.faulted,
          ...(window.__hostState.faulted ? { faultReason: 'setup 异常：boom' } : {}),
          enabled: window.__hostState.enabled, definitions: window.__defs, values,
        },
        openAddonSettingsPage: window.__hostState.mountedPage,
        ...(window.__hostState.notice !== undefined ? { notice: window.__hostState.notice } : {}),
      }
    }
  }, { state: hostState, defs: DEFINITIONS, script: scriptUrl, css: cssUrl })
  await page.addScriptTag({ path: output })

  // ---- 1. 打开 SCX 详情：首屏即自绘页（自动 openAddonPage → 装载指令 → 工厂） ----
  await page.getByRole('button', { name: zhCn['settings.addonsSection'], exact: true }).click()
  // 两组件各有一枚「设置」入口（SCX 居清单首行）
  await page.getByRole('button', { name: zhCn['addons.openSettingsArea'], exact: true }).first().click()
  await page.locator('.vsidian-addons-settings').waitFor()
  // 自动开页（无「打开自定义设置页」按钮可点——操作已消除）
  await page.waitForFunction((id) => window.sentMessages.some((m) => m.kind === 'addons.openAddonPage' && m.addonId === id), ADDON_ID)
  const area = page.locator('.vsidian-addons-settings')
  const fixtureRoot = area.locator('.vsidian-addons-addonpage .scx-settings-root')
  await fixtureRoot.waitFor()
  // 首屏绘制层：夹具回显行可见（几何非零）且计算色来自组件样式（<link> 授权装载同证）
  const scopePaint = await fixtureRoot.locator('.scx-scope').evaluate((el) => {
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return { color: cs.color, display: cs.display, height: rect.height, text: el.textContent }
  })
  assert.equal(scopePaint.display, 'block', '夹具作用域回显行可见（样式未注入即失败）')
  assert.ok(scopePaint.height > 0, '夹具回显行几何非零（真实绘制）')
  assert.equal(scopePaint.color, 'rgb(178, 74, 214)', '夹具回显行计算色来自组件样式（绘制层）')
  assert.equal(scopePaint.text, 'scope=user;hasWorkspace=true', '初始作用域快照经 facet 拉取回显')
  // 首屏无重复默认表单；基础设置在次级页签
  assert.equal(await area.locator('[data-addon-setting="flag"]').count(), 0, '首屏不呈现同批设置项的默认表单')
  const detailTabs = area.locator('.vsidian-addons-detail-tab')
  assert.equal(await detailTabs.first().getAttribute('aria-selected'), 'true', '自绘页页签默认选中')
  // 平台外壳保留：作用域标签 + 总开关
  assert.equal(await area.locator('.vsidian-addons-scope-tab').count(), 2, '作用域标签恒在场（平台外壳）')
  assert.equal(await area.locator('input[data-addon-setting="__enabled__"]').count(), 1, '总开关恒在场（平台外壳）')
  await page.screenshot({ path: path.join(artifacts, 'detail-custom-first.png') })

  // ---- 2. 作用域切换真实传至组件：工作区标签 → 夹具回显 workspace ----
  await page.getByRole('tab', { name: zhCn['addons.scopeWorkspace'], exact: true }).click()
  await fixtureRoot.locator('.scx-scope').filter({ hasText: 'scope=workspace' }).waitFor()
  // 次级「基础设置」页签：表单呈现且写入带 workspace scope（显示值与写入目标一致）
  await page.getByRole('tab', { name: zhCn['addons.detailBasicsViewTab'], exact: true }).click()
  const flagToggle = area.locator('input[data-addon-setting="flag"]')
  await flagToggle.waitFor()
  await flagToggle.click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'workspace' && m.values.flag === false))

  // ---- 3. 搜索定位交给自绘页：def 条目点击 → 夹具收到目标并切回自绘页视图 ----
  const search = page.locator('input.vsidian-settings-search')
  await search.fill('开关项')
  const defHit = page.locator('.vsidian-settings-result', { hasText: zhCn['settings.addonSettingsSection'] }).filter({ hasText: '开关项' }).first()
  await defHit.waitFor()
  await defHit.click()
  await area.waitFor()
  // 定位落点交给组件：夹具回显目标并标记；平台不描自己的表单、视图回自绘页
  await fixtureRoot.waitFor()
  const locatePaint = await fixtureRoot.locator('.scx-locate').evaluate((el) => ({
    text: el.textContent, located: el.getAttribute('data-located'), color: getComputedStyle(el).color,
  }))
  assert.equal(locatePaint.text, 'locate=def:flag', '定位目标经 settingsContext 交付（页内 Tab 与控件定位由组件承接）')
  assert.equal(locatePaint.located, 'def:flag', '夹具标记页内定位消费')
  assert.equal(locatePaint.color, 'rgb(178, 74, 214)', '定位回显行计算色（绘制层）')
  assert.equal(await area.locator('.vsidian-settings-item-located').count(), 0, '平台不描自己的表单（不是切回表单）')
  assert.equal(await area.locator('.vsidian-addons-detail-tab').first().getAttribute('aria-selected'), 'true', '定位后详情保持自绘页视图')
  await page.screenshot({ path: path.join(artifacts, 'detail-locate-delivered.png') })

  // ---- 4. 故障暂停：自绘代码撤下（卸载指令 → 夹具移除），基础控件 + 排障块呈现 ----
  await page.evaluate(() => {
    window.__hostState.faulted = true
    window.__hostState.mountedPage = null
    post0()
    function post0() {
      const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
      post(window.__addonsState())
      post(window.__settingsState())
    }
  })
  await area.locator('.vsidian-addons-fault-troubleshoot').waitFor()
  assert.equal(await area.locator('.scx-settings-root').count(), 0, '故障后自绘内容撤下')
  assert.equal(await area.locator('.vsidian-addons-detail-tab').count(), 0, '故障后双视图页签退场（基础表单整页形态）')
  await area.locator('input[data-addon-setting="flag"]').waitFor()
  await page.screenshot({ path: path.join(artifacts, 'detail-faulted-basics.png') })

  // ---- 5. 重试恢复：faulted 复原 → 详情再次自动开页 → 夹具重新装载回显 ----
  await page.evaluate(() => {
    window.__hostState.faulted = false
    const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    post(window.__addonsState())
    post(window.__settingsState())
  })
  await page.waitForFunction((id) => window.sentMessages.filter((m) => m.kind === 'addons.openAddonPage' && m.addonId === id).length >= 2, ADDON_ID)
  await area.locator('.vsidian-addons-addonpage .scx-settings-root').waitFor()

  // ---- 6. 切换到无自绘页组件：详情为表单、自绘页卸载（残留挂载撤除） ----
  await page.evaluate(() => { window.sentMessages.length = 0 })
  await page.getByRole('button', { name: 'PlainB', exact: true }).click()
  await page.waitForFunction((id) => window.sentMessages.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === id), PLAIN_ID)
  await page.evaluate(() => {
    const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    window.__hostState.open = 'fixture.plain-b'
    window.__hostState.mountedPage = null
    post(window.__settingsState())
  })
  await page.locator('.vsidian-addons-settings input[data-addon-setting="flag"]').waitFor()
  assert.equal(await area.locator('.scx-settings-root').count(), 0, '切换组件后他组件自绘内容让位')
  assert.equal(await area.locator('.vsidian-addons-detail-tab').count(), 0, '无自绘页组件为整页表单形态')
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.closeAddonPage'), undefined, { timeout: 3000 }).catch(() => {})
  const closedPage = await page.evaluate(() => window.sentMessages.some((m) => m.kind === 'addons.closeAddonPage'))
  assert.equal(closedPage, true, '切换到无自绘页组件时撤下残留挂载（单一组件身份）')

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  console.log('[#553] 组件设置详情自绘页优先浏览器回归通过（首屏装载/次级页签/作用域与定位交付/故障恢复/切换组件）')
} finally {
  assetServer.close()
  await browser.close()
}
