// #353 T04 附加组件基础设置区——生产设置页入口的真实浏览器回归：
// 真实键盘/点击驱动双标签作用范围、标量/数组/对象基础控件、清除覆盖
// 与保存反馈；绘制层断言（标签选中态计算色、徽章与提示可见性——非
// DOM 存在性）。宿主应答由页面内 mock 桥回灌（addons.state /
// addons.settingsState），消息断言以 webview → 宿主的上送形态为准。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = await buildSettingsMain(root)
const artifacts = artifactPath(root, 'screenshots/addonSettings')
await mkdir(artifacts, { recursive: true })
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const DEFINITIONS = [
  { key: 'flag', title: '开关项', type: 'boolean', default: true },
  { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
  { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 10 }, default: ['旧→新'] },
  {
    key: 'limits', title: '对象样例', type: 'object',
    fields: [
      { key: 'name', title: '名称', kind: 'string', maxLength: 10, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
    ],
  },
]

/** 页内 mock 宿主状态（回灌应答的数据源——消息构造在 evaluate 内联） */
const hostState = {
  open: null,
  hasWorkspace: true,
  values: {},   // key → { effective, user?, workspace?, source }
  enabled: { effective: true, userExplicit: null, workspaceExplicit: null, source: 'default' },
  notice: undefined,
  failNextUpdate: false,
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
        if (message.kind === 'addons.get') { post(window.__reply('addons-state')); return }
        if (message.kind === 'addons.settingsGet') { post(window.__reply('settings-state')); return }
        if (message.kind === 'addons.settingsOpen') {
          window.__hostState.open = message.addonId
          post(window.__reply('addons-state'))
          post(window.__reply('settings-state'))
          return
        }
        if (message.kind === 'addons.settingsClose') {
          window.__hostState.open = null
          post(window.__reply('settings-state'))
          return
        }
        if (message.kind === 'addons.settingsUpdate') {
          const fail = window.__hostState.failNextUpdate
          window.__hostState.failNextUpdate = false
          if (fail) {
            window.__hostState.notice = { kind: 'save-failed', reason: 'invalid-value', keys: Object.keys(message.values), scope: message.scope }
          } else {
            for (const [key, value] of Object.entries(message.values)) {
              window.__hostState.values[key] = { [message.scope]: value, effective: value, source: message.scope }
            }
            window.__hostState.notice = { kind: 'saved', scope: message.scope, keys: Object.keys(message.values) }
          }
          post(window.__reply('settings-state'))
          return
        }
        if (message.kind === 'addons.settingsClearOverride') {
          delete window.__hostState.values[message.key]?.workspace
          window.__hostState.values[message.key] = { ...window.__hostState.values[message.key], source: 'user' }
          window.__hostState.notice = { kind: 'saved', keys: [message.key] }
          post(window.__reply('settings-state'))
          return
        }
        if (message.kind === 'addons.setEnabled') {
          const layer = message.scope ?? 'user'
          window.__hostState.enabled = { ...window.__hostState.enabled, [layer === 'user' ? 'userExplicit' : 'workspaceExplicit']: message.enabled, effective: message.enabled, source: layer }
          post(window.__reply('addons-state'))
          post(window.__reply('settings-state'))
          return
        }
        if (message.kind === 'addons.clearEnabledOverride') {
          window.__hostState.enabled = { ...window.__hostState.enabled, workspaceExplicit: null }
          post(window.__reply('addons-state'))
          post(window.__reply('settings-state'))
          return
        }
        if (message.kind === 'settings.uiState') return
      }, 0)
    } })
    window.__hostState = state
    window.__reply = (kind) => kind === 'addons-state' ? window.__addonsState() : window.__settingsState()
  }, hostState)
  await page.evaluate(({ state, defs }) => {
    window.__hostState = state
    window.__addonsState = () => ({
      kind: 'addons.state', apiVersion: '1.0.0', draft: true, openAddonSettingsPage: null, openAddonSettings: window.__hostState.open,
      addons: [{ id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: window.__hostState.enabled.effective, hasSettingsPage: false, hasSettingsDefinitions: true }],
    })
    window.__settingsState = () => {
      const values = {}
      for (const def of defs) {
        const fallback = def.type === 'object' ? Object.fromEntries(def.fields.map((field) => [field.key, field.default])) : def.default
        values[def.key] = { effective: fallback, source: 'default', ...(window.__hostState.values[def.key] ?? {}) }
      }
      return {
        kind: 'addons.settingsState', apiVersion: '1.0.0', draft: true,
        open: window.__hostState.open, hasWorkspace: window.__hostState.hasWorkspace,
        addon: window.__hostState.open === null ? null : {
          addonId: 'fixture.demo', label: 'Demo', faulted: false, hasCustomPage: false,
          enabled: window.__hostState.enabled, definitions: defs, values,
        },
        openAddonSettingsPage: null,
        ...(window.__hostState.notice !== undefined ? { notice: window.__hostState.notice } : {}),
      }
    }
  }, { state: hostState, defs: DEFINITIONS })
  await page.addScriptTag({ path: output })

  // ---- 1. 打开附加组件分页与基础设置区 ----
  await page.getByRole('button', { name: zhCn['settings.addonsSection'], exact: true }).click()
  await page.getByRole('button', { name: zhCn['addons.openSettingsArea'], exact: true }).click()
  const area = page.locator('.vsidian-addons-settings')
  await area.waitFor()
  assert.match(await area.innerText(), new RegExp(zhCn['addons.settingsAreaTitle'].replace('{label}', 'Demo')))
  assert.match(await area.innerText(), new RegExp(zhCn['addons.scopeUserDefault']))
  assert.match(await area.innerText(), new RegExp(zhCn['addons.scopeWorkspace']))

  // ---- 2. 双标签绘制层：选中态为强调底色（非 DOM 存在性） ----
  const tabs = page.locator('.vsidian-addons-scope-tab')
  const tabPaint = await tabs.first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return { selected: el.getAttribute('aria-selected'), bg: cs.backgroundColor, fg: cs.color, radius: cs.borderRadius }
  })
  assert.equal(tabPaint.selected, 'true')
  assert.equal(tabPaint.bg, 'rgb(224, 228, 235)', '选中标签应为主题选中底色（样式未注入即失败）')
  assert.equal(tabPaint.radius, '6px')

  // 来源徽章绘制（默认来源可见）
  const badge = area.locator('.vsidian-addons-source-badge').first()
  assert.equal((await badge.evaluate((el) => getComputedStyle(el).display)) !== 'none', true)

  // ---- 3. 标量：真实键盘修改 number → user 层单键批 ----
  const threshold = area.locator('input[data-addon-setting="threshold"]')
  await threshold.click({ clickCount: 3 })
  await page.keyboard.type('42')
  await threshold.press('Enter')
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'user' && m.values.threshold === 42))
  // 保存成功反馈（notice saved 文本可见）与草稿无关的标量即时上送
  await area.getByText(new RegExp(zhCn['addons.savedNotice'].replace('{scope}', '.+'))).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'settings-area-user.png') })

  // ---- 4. 工作区标签：切换后修改走 workspace 层 ----
  await page.getByRole('tab', { name: zhCn['addons.scopeWorkspace'], exact: true }).click()
  await threshold.click({ clickCount: 3 })
  await page.keyboard.type('77')
  await threshold.press('Enter')
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'workspace' && m.values.threshold === 77))

  // 工作区标签下已覆盖项出现「使用用户默认」；点击上送清除覆盖
  const clear = area.locator(`button[data-addon-setting-key="threshold"]`)
  await clear.waitFor()
  await clear.click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsClearOverride' && m.key === 'threshold'))

  // ---- 5. 数组重复项控件：真实键盘输入新项 + 保存整批 ----
  await page.getByRole('tab', { name: zhCn['addons.scopeUserDefault'], exact: true }).click()
  await page.getByRole('button', { name: zhCn['addons.arrayAddItem'], exact: true }).click()
  const newRow = area.locator('input[data-addon-array-item="replacements"]').nth(1)
  await newRow.click()
  await page.keyboard.type('甲→乙')
  await page.getByRole('button', { name: zhCn['addons.saveChanges'], exact: true }).first().click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'user'
    && Array.isArray(m.values.replacements) && m.values.replacements[1] === '甲→乙'))

  // ---- 6. 对象字段控件：字段修改 + 保存整批 ----
  const nameField = area.locator('input[data-addon-field="limits.name"]')
  await nameField.click({ clickCount: 3 })
  await page.keyboard.type('乙')
  const countField = area.locator('input[data-addon-field="limits.count"]')
  await countField.click({ clickCount: 3 })
  await page.keyboard.type('7')
  await page.getByRole('button', { name: zhCn['addons.saveChanges'], exact: true }).nth(1).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'user'
    && m.values.limits && m.values.limits.name === '乙' && m.values.limits.count === 7))

  // ---- 7. 功能开关随标签层（workspace）----
  await page.getByRole('tab', { name: zhCn['addons.scopeWorkspace'], exact: true }).click()
  await area.locator('input[data-addon-setting="__enabled__"]').click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.setEnabled' && m.scope === 'workspace' && m.enabled === false))
  // 开关工作区覆盖可清除
  const clearEnabled = area.locator('button[data-addon-setting-key="__enabled__"]')
  await clearEnabled.waitFor()
  await clearEnabled.click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.clearEnabledOverride'))

  // ---- 8. 失败不虚报：save-failed 提示可见（错误前景色绘制层） ----
  await page.evaluate(() => { window.__hostState.failNextUpdate = true })
  await page.getByRole('tab', { name: zhCn['addons.scopeUserDefault'], exact: true }).click()
  const flagToggle = area.locator('input[data-addon-setting="flag"]')
  await flagToggle.click()
  const notice = area.locator('.vsidian-addons-settings-notice-save-failed')
  await notice.waitFor()
  assert.match(await notice.innerText(), new RegExp(zhCn['addons.saveFailedInvalid'].replace('{keys}', '.+')))
  const noticePaint = await notice.evaluate((el) => getComputedStyle(el).color)
  assert.equal(noticePaint, 'rgb(255, 102, 102)', '失败提示应为错误前景色（绘制层）')
  await page.screenshot({ path: path.join(artifacts, 'settings-area-failed.png') })

  // ---- 9. 关闭设置区 ----
  await page.getByRole('button', { name: zhCn['addons.closeSettingsArea'], exact: true }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsClose'))
  await area.waitFor({ state: 'detached' })

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  console.log('[#353] 附加组件基础设置区浏览器回归通过（双标签/标量数组对象/清覆盖/失败反馈）')
} finally {
  await browser.close()
}
