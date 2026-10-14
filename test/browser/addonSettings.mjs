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
  // #477：带 description（徽章挂标题行、描述独占行的布局断言对象）
  { key: 'flag', title: '开关项', description: '开关项的描述文案', type: 'boolean', default: true },
  { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
  {
    // #473：enumLabels 部分覆盖（strict 缺失——回退枚举值本身）
    key: 'strategy', title: '空格策略', type: 'string', enum: ['none', 'soft', 'strict'], default: 'soft',
    enumLabels: { none: { 'zh-cn': '不要求空格', en: 'No spaces' }, soft: { 'zh-cn': '软空格', en: 'Soft spaces' } },
  },
  { key: 'note', title: '备注', type: 'string', multiline: true, maxLength: 20, default: '第一行\n第二行' },
  { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 10 }, default: ['旧→新'] },
  {
    key: 'limits', title: '对象样例', type: 'object',
    fields: [
      { key: 'name', title: '名称', kind: 'string', maxLength: 10, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
      // #477：布尔对象字段（开关档位几何断言对象——审查轮 1 发现 2 补两路断言）
      { key: 'strict', title: '严格', kind: 'boolean', default: true },
    ],
  },
  // #477：布尔数组项（开关档位几何断言对象；放末位不扰动既有保存按钮 nth 定位）
  { key: 'switches', title: '开关数组', type: 'array', items: { kind: 'boolean' }, default: [true] },
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
    window.__defs = defs
    window.__addonsState = () => ({
      kind: 'addons.state', apiVersion: '1.0.0', draft: true, openAddonSettingsPage: null, openAddonSettings: window.__hostState.open,
      addons: [{ id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: window.__hostState.enabled.effective, hasSettingsPage: false, hasSettingsDefinitions: true,
        // #472 搜索摘要随 addons.state 既有链路（mock 与生产 wiring 同形）
        settingsSearchIndex: {
          definitions: window.__defs.map((def) => ({ key: def.key, title: def.title, ...(def.description !== undefined ? { description: def.description } : {}) })),
          ...(window.__hostState.groups ? { groups: window.__hostState.groups } : {}),
        } }],
    })
    window.__settingsState = () => {
      const values = {}
      for (const def of window.__defs) {
        const fallback = def.type === 'object' ? Object.fromEntries(def.fields.map((field) => [field.key, field.default])) : def.default
        values[def.key] = { effective: fallback, source: 'default', ...(window.__hostState.values[def.key] ?? {}) }
      }
      return {
        kind: 'addons.settingsState', apiVersion: '1.0.0', draft: true,
        open: window.__hostState.open, hasWorkspace: window.__hostState.hasWorkspace,
        addon: window.__hostState.open === null ? null : {
          addonId: 'fixture.demo', label: 'Demo', faulted: false, hasCustomPage: false,
          enabled: window.__hostState.enabled, definitions: window.__defs,
          ...(window.__hostState.groups ? { groups: window.__hostState.groups } : {}),
          values,
        },
        openAddonSettingsPage: null,
        ...(window.__hostState.notice !== undefined ? { notice: window.__hostState.notice } : {}),
      }
    }
  }, { state: hostState, defs: DEFINITIONS })
  await page.addScriptTag({ path: output })

  // ---- 1. 附加组件页「设置」入口：导航到「组件设置」分页（#465 通道堵死，
  //      本页不承载任何组件设置内容） ----
  await page.getByRole('button', { name: zhCn['settings.addonsSection'], exact: true }).click()
  await page.getByRole('button', { name: zhCn['addons.openSettingsArea'], exact: true }).click()
  await page.locator('.vsidian-settings-heading', { hasText: zhCn['settings.addonSettingsSection'] }).waitFor()
  const area = page.locator('.vsidian-addons-settings')
  await area.waitFor()
  assert.match(await area.innerText(), new RegExp(zhCn['addons.settingsAreaTitle'].replace('{label}', 'Demo')))
  assert.match(await area.innerText(), new RegExp(zhCn['addons.scopeUserDefault']))
  assert.match(await area.innerText(), new RegExp(zhCn['addons.scopeWorkspace']))
  // #465 IA 分页：组件设置分页不混装附加组件管理内容（对偶守护）
  assert.equal(await page.locator('.vsidian-addons-list').count(), 0, '组件设置分页不混装管理列表')
  assert.equal(await page.locator('.vsidian-addons-actions').count(), 0, '组件设置分页不混装工具组')

  // ---- 2. 双标签绘制层：选中态为强调底色（非 DOM 存在性） ----
  const tabs = page.locator('.vsidian-addons-scope-tab')
  const tabPaint = await tabs.first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return { selected: el.getAttribute('aria-selected'), bg: cs.backgroundColor, fg: cs.color, radius: cs.borderRadius }
  })
  assert.equal(tabPaint.selected, 'true')
  assert.equal(tabPaint.bg, 'rgb(224, 228, 235)', '选中标签应为主题选中底色（样式未注入即失败）')
  assert.equal(tabPaint.radius, '6px')

  // 来源徽章绘制（默认来源可见）+ #477 挂标题行不挤占描述行（真实布局：
  // 徽章与标题垂直区间重叠、描述起点在标题行之下——几何坐标仅作同容器
  // 行列关系断言，非存在性）
  const badge = area.locator('.vsidian-addons-source-badge').first()
  assert.equal((await badge.evaluate((el) => getComputedStyle(el).display)) !== 'none', true)
  const badgeLayout = await area.locator('.vsidian-addons-setting-item').first().evaluate((row) => {
    const titleRow = row.querySelector('.vsidian-addons-setting-title-row')
    const title = row.querySelector('.vsidian-settings-item-title')
    const badgeEl = row.querySelector('.vsidian-addons-source-badge')
    if (!titleRow || !title || !badgeEl) return null
    const rowRect = titleRow.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const badgeRect = badgeEl.getBoundingClientRect()
    const desc = row.querySelector('.vsidian-settings-item-description')
    const descTop = desc ? desc.getBoundingClientRect().top : null
    return {
      inTitleRow: rowRect.top <= badgeRect.top && badgeRect.bottom <= rowRect.bottom,
      sameLineAsTitle: Math.abs((titleRect.top + titleRect.bottom) / 2 - (badgeRect.top + badgeRect.bottom) / 2) < titleRect.height,
      descBelowTitleRow: descTop === null || descTop >= rowRect.bottom - 1,
    }
  })
  assert.ok(badgeLayout, '标题行容器在场（徽章挂标题行）')
  assert.equal(badgeLayout.inTitleRow, true, '来源徽章在标题行容器内')
  assert.equal(badgeLayout.sameLineAsTitle, true, '来源徽章与标题同行（不挤占描述行）')
  assert.equal(badgeLayout.descBelowTitleRow, true, '描述独占行（起点在标题行之下）')

  // #477 布尔定义控件为拨动开关形态（绘制层：appearance/几何/选中底色）
  const flagSwitch = area.locator('input[data-addon-setting="flag"]')
  const togglePaint = await flagSwitch.evaluate((el) => {
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return { appearance: cs.appearance, width: rect.width, height: rect.height, radius: cs.borderRadius, bg: cs.backgroundColor, checked: el.checked }
  })
  assert.equal(togglePaint.appearance, 'none', '布尔控件为纯 CSS 拨动开关（非原生复选框）')
  assert.equal(togglePaint.width, 36, '开关宽度 36px 档位')
  assert.equal(togglePaint.height, 20, '开关高度 20px 档位')
  assert.equal(togglePaint.radius, '999px', '开关 pill 圆角档位')
  assert.equal(togglePaint.checked, true, '开关选中（默认值 true）')
  assert.equal(togglePaint.bg, 'rgb(38, 135, 212)', '选中态为主题焦点色（样式未注入即失败）')

  // #477 定义行归型标准设置行（绘制层：非末行行间分隔线在场）
  const dividerPaint = await area.locator('.vsidian-addons-setting-item').first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return { width: cs.borderBottomWidth, style: cs.borderBottomStyle }
  })
  assert.equal(dividerPaint.width, '1px', '定义行行间分隔线宽度（样式未注入即失败）')
  assert.equal(dividerPaint.style, 'solid', '定义行行间分隔线样式')

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
  // #477 夹具新增布尔数组后有多个「添加项」按钮——replacements 按定义序居首
  await page.getByRole('button', { name: zhCn['addons.arrayAddItem'], exact: true }).first().click()
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

  // ---- 6b. #473 枚举档位标签 / #475 多行形态与批量粘贴拆分 ----
  // 标签绘制层：用户看到的下拉文案是本地化标签（缺失键回退枚举值），
  // option.value 恒为枚举原值（标签仅呈现层）
  const strategySelect = area.locator('select[data-addon-setting="strategy"]')
  const optionShape = await strategySelect.evaluate((el) => [...el.options].map((o) => ({ value: o.value, text: o.textContent })))
  assert.deepEqual(optionShape, [
    { value: 'none', text: '不要求空格' },
    { value: 'soft', text: '软空格' },
    { value: 'strict', text: 'strict' },
  ], '枚举档位显示本地化标签，缺失标签回退枚举值本身')
  assert.equal(await strategySelect.evaluate((el) => el.selectedOptions[0].textContent), '软空格', '选中态用户可见文本为当前值标签')
  await strategySelect.selectOption('none')
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'user' && m.values.strategy === 'none'))

  // 多行文本：textarea 计算样式绘制层（样式未注入即失败）
  const noteArea = area.locator('textarea[data-addon-setting="note"]')
  const notePaint = await noteArea.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { display: cs.display, radius: cs.borderRadius, resize: cs.resize, height: el.getBoundingClientRect().height }
  })
  assert.notEqual(notePaint.display, 'none', '多行控件可见')
  assert.equal(notePaint.radius, '2px', 'textarea 圆角对齐 select/text 档位')
  assert.equal(notePaint.resize, 'vertical', 'textarea 可纵向拖高')
  assert.ok(notePaint.height >= 72, 'textarea 最小高度档位（min-height 72px）')
  // 真实键盘多行输入（textarea 内 Enter 是换行）→ 失焦上送含换行的值
  await noteArea.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('甲行')
  await page.keyboard.press('Enter')
  await page.keyboard.type('乙行')
  await noteArea.evaluate((el) => el.blur())
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'user' && typeof m.values.note === 'string' && m.values.note.includes('\n')))
  await area.getByText(new RegExp(zhCn['addons.savedNotice'].replace('{scope}', '.+'))).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'settings-area-labels-multiline.png') })

  // 批量粘贴拆分（真实 ClipboardEvent + DataTransfer）：多行剪贴板按行
  // 拆为多项（首行追加当前项末尾、空行丢弃）；单行粘贴不拦截由单测钉住
  await area.evaluate(() => {
    const input = document.querySelector('input[data-addon-array-item="replacements"]')
    const data = new DataTransfer()
    data.setData('text', ' 甲 \r\n\r\n乙\n丙\n')
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => document.querySelectorAll('input[data-addon-array-item="replacements"]').length === 4)
  const pastedValues = await area.evaluate(() => [...document.querySelectorAll('input[data-addon-array-item="replacements"]')].map((el) => el.value))
  assert.deepEqual(pastedValues, ['旧→新甲', '乙', '丙', '甲→乙'], '粘贴拆分：首行追加当前项，其余行依次插入')
  // 保存触发的 mock 回灌（setTimeout(0) 推送 settingsState）会整区重建——
  // notice 文本不含 keys（两次保存同文本），等 notice 等不住本次重建；改为
  // 抓保存前节点引用、等它被替换为新节点（重建完成的精确信号，CI 实挂过
  // 一次 evaluate 恰跨重建边界拿到 detached 节点 rect 0 的竞态）
  const strictSwitchBeforeSave = await page.evaluate(() => document.querySelector('input[data-addon-field="limits.strict"]'))
  await page.getByRole('button', { name: zhCn['addons.saveChanges'], exact: true }).nth(0).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate' && m.scope === 'user'
    && Array.isArray(m.values.replacements) && m.values.replacements.length === 4 && m.values.replacements[0] === '旧→新甲' && m.values.replacements[3] === '甲→乙'))
  await page.waitForFunction((oldNode) => {
    const current = document.querySelector('input[data-addon-field="limits.strict"]')
    return current !== null && current !== oldNode
  }, strictSwitchBeforeSave)

  // ---- 6c. #477 布尔数组项/对象字段开关几何（审查轮 1 发现 1 回归钉住：
  //      行内 input 通用 flex:1 规则曾把两路开关拉成整行宽胶囊；
  //      一次 evaluate 现场查询双路，最小化跨重建时序窗口） ----
  const switchShapes = await page.evaluate(() => {
    const measure = (el) => el === null ? null : {
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      appearance: getComputedStyle(el).appearance,
    }
    return {
      arraySwitch: measure(document.querySelector('.vsidian-addons-array-row input[data-addon-array-item="switches"]')),
      fieldSwitch: measure(document.querySelector('input[data-addon-field="limits.strict"]')),
    }
  })
  assert.ok(switchShapes.arraySwitch, '布尔数组项开关在场')
  assert.equal(switchShapes.arraySwitch.width, 36, '布尔数组项开关宽 36px（不被行内 flex:1 拉伸）')
  assert.equal(switchShapes.arraySwitch.height, 20, '布尔数组项开关高 20px（min-height 覆写回档）')
  assert.equal(switchShapes.arraySwitch.appearance, 'none', '布尔数组项为拨动开关形态')
  assert.ok(switchShapes.fieldSwitch, '布尔对象字段开关在场')
  assert.equal(switchShapes.fieldSwitch.width, 36, '布尔对象字段开关宽 36px（不被行内 flex:1 拉伸）')
  assert.equal(switchShapes.fieldSwitch.height, 20, '布尔对象字段开关高 20px（min-height 覆写回档）')

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

  // ---- 9. 「返回组件列表」：关闭详情，回到本页的组件清单（hub）形态 ----
  await page.getByRole('button', { name: zhCn['addons.closeSettingsArea'], exact: true }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsClose'))
  await area.waitFor({ state: 'detached' })
  const hub = page.locator('.vsidian-addons-settings-hub')
  await hub.waitFor()
  assert.match(await hub.innerText(), new RegExp(zhCn['addons.settingsHubTitle']), '关闭后回到组件清单（hub）')

  // ---- 10-12. #467 推送链路滚动与焦点保持 ----
  // 经侧栏组件条目进入（locatedAddonId 持久化）：定位高亮保留，但推送
  // 重渲染不得重放定位 scrollIntoView（渲染中间态内容塌缩时它把滚动钳
  // 制到顶部——真宿主跨帧推送下的回顶向量）。交互统一「先 preventScroll
  // 聚焦 → 钉滚动 → 程序化 click（对已聚焦元素不再引发焦点滚动）」，
  // 使钉住值与渲染入口保存值之间零扰动；键盘路径的 Blink 焦点补偿与滚
  // 动锚定恢复会互相抵消、掩盖丢失向量，不用于本场景
  await page.getByRole('button', { name: 'Demo', exact: true }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === 'fixture.demo'))
  await area.waitFor()
  // 长页场景：收窄视口使分页内容超一屏
  await page.setViewportSize({ width: 1100, height: 320 })
  const main = page.locator('.vsidian-settings-main')
  const nextFrame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  // 劫持 scrollIntoView 计数：定位态推送重渲染的重放即回顶向量（初始
  // 定位渲染的合法调用发生在注入前，不计数）
  await page.evaluate(() => {
    globalThis.__sivCount = 0
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function patched(...args) {
      globalThis.__sivCount++
      return orig.apply(this, args)
    }
  })
  const sivCount = () => page.evaluate(() => globalThis.__sivCount)
  /** 先 preventScroll 聚焦 → 钉滚动到主区中部 → 程序化点击（变更） */
  const scrollAndChange = async (selector) => {
    await page.evaluate((sel) => { document.querySelector(sel)?.focus({ preventScroll: true }) }, selector)
    const pinned = await main.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2)
      return el.scrollTop
    })
    await page.evaluate((sel) => { document.querySelector(sel)?.click() }, selector)
    return pinned
  }

  // 复选框类：boolean 定义行
  const pinnedFlag = await scrollAndChange('input[data-addon-setting="flag"]')
  await page.waitForFunction(() => document.querySelector('input[data-addon-setting="flag"]')?.checked === false)
  await nextFrame()
  assert.equal(await main.evaluate((el) => el.scrollTop), pinnedFlag, '#467 复选框变更回推后滚动位置保持（不回顶）')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-addon-setting')), 'flag',
    '#467 复选框变更回推后焦点回到同键控件')
  assert.equal(await sivCount(), 0, '#467 复选框回推重渲染不得重放定位 scrollIntoView')

  // 功能开关：两连发回推（addons.state + addons.settingsState）
  const pinnedEnabled = await scrollAndChange('input[data-addon-setting="__enabled__"]')
  await page.waitForFunction(() => document.querySelector('input[data-addon-setting="__enabled__"]')?.checked === false)
  await nextFrame()
  assert.equal(await main.evaluate((el) => el.scrollTop), pinnedEnabled, '#467 功能开关两连发回推后滚动位置保持')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-addon-setting')), '__enabled__',
    '#467 功能开关回推后焦点回到同键控件')
  assert.equal(await sivCount(), 0, '#467 功能开关回推重渲染不得重放定位 scrollIntoView')

  // 列表增删：数组项 Add（本地行重建）+ Save（推送重渲染）
  await page.evaluate(() => {
    const add = document.querySelector('.vsidian-addons-array-actions button')
    add?.focus({ preventScroll: true })
    add?.click() // 本地草稿增行（不整页重渲染）
  })
  await page.evaluate(() => {
    document.querySelectorAll('input[data-addon-array-item="replacements"]')[2]
      ?.focus({ preventScroll: true })
  })
  // 6b 粘贴拆分后该行已有值（'丙'）：全选替换回目标内容
  await page.keyboard.press('Control+a')
  await page.keyboard.type('丙→丁')
  const pinnedSave = await main.evaluate((el) => {
    document.querySelector('.vsidian-addons-array-save')?.focus({ preventScroll: true })
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2)
    return el.scrollTop
  })
  await page.evaluate(() => { document.querySelector('.vsidian-addons-array-save')?.click() })
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsUpdate'
    && Array.isArray(m.values.replacements) && m.values.replacements[2] === '丙→丁'))
  await area.getByText(new RegExp(zhCn['addons.savedNotice'].replace('{scope}', '.+'))).waitFor()
  await nextFrame()
  assert.equal(await main.evaluate((el) => el.scrollTop), pinnedSave, '#467 数组保存回推后滚动位置保持')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('vsidian-addons-array-save')), true,
    '#467 保存回推后焦点回到数组保存按钮')
  await page.setViewportSize({ width: 1100, height: 760 })

  // ---- 13. #472 设置定义分组：组容器/组标题/组描述呈现 + 全局搜索跨组件定位 ----
  // 运行时换组化定义集（strategy/note 进组、其余未分组）+ 组声明（title
  // 多语言映射、description 直值——AddonLocalizedText 两形态），推送
  // settingsState 重渲染（与生产宿主推送同链路）
  await page.evaluate(() => {
    window.__defs = [
      { key: 'flag', title: '开关项', type: 'boolean', default: true },
      { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
      { key: 'strategy', title: '空格策略', type: 'string', enum: ['none', 'soft', 'strict'], default: 'soft', group: 'appearance',
        enumLabels: { none: { 'zh-cn': '不要求空格', en: 'No spaces' }, soft: { 'zh-cn': '软空格', en: 'Soft spaces' } } },
      { key: 'note', title: '备注', type: 'string', multiline: true, maxLength: 20, default: '行一', group: 'appearance' },
    ]
    window.__hostState.groups = [
      { key: 'appearance', title: { 'zh-cn': '外观', en: 'Appearance' }, description: '观感相关' },
    ]
    // 搜索摘要随 addons.state 既有链路刷新（全局索引用），组声明随
    // settingsState 透传——两条既有推送，与生产宿主同形
    window.dispatchEvent(new MessageEvent('message', { source: window, data: window.__addonsState() }))
    window.dispatchEvent(new MessageEvent('message', { source: window, data: window.__settingsState() }))
  })
  await area.waitFor()
  // 组标题与组描述：用户可见文本按当前语言取值（zh-cn 页面）——组描述
  // 文本「观感相关」唯一定位组卡片（filter 相对语义，不嵌套绝对定位器）
  const groupCard = area.locator('.vsidian-settings-group').filter({ hasText: '观感相关' })
  await groupCard.waitFor()
  assert.equal(await groupCard.locator('.vsidian-settings-group-title').innerText(), '外观', '组标题按当前语言选值（映射取 zh-cn 键）')
  assert.match(await groupCard.innerText(), /观感相关/, '组描述（直值）呈现在组卡片内')
  assert.equal(await groupCard.innerText().then((t) => /开关项/.test(t)), false, '组容器只收组内定义（聚拢不散插）')
  const firstCard = area.locator('.vsidian-settings-group').first()
  assert.equal(await firstCard.locator('.vsidian-settings-group-title').count(), 0, '首容器无组标题（开关行 + 未分组项恒置顶）')
  assert.match(await firstCard.innerText(), /开关项|阈值/, '未分组定义留在首容器')
  // 绘制层：组卡片间距 20px 档位（#477 起为合成口径——flex gap 10px +
  // 组卡 margin 10px，真实布局间距经 rect 断言）与组标题分隔线
  const groupPaint = await groupCard.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      radius: cs.borderRadius,
      marginTop: cs.marginTop,
      title: getComputedStyle(el.querySelector('.vsidian-settings-group-title')).borderBottomWidth,
      areaGap: getComputedStyle(el.parentElement).rowGap,
      realGap: (() => {
        const cards = [...el.parentElement.querySelectorAll(':scope > .vsidian-settings-group')]
        const idx = cards.indexOf(el)
        return idx > 0 ? cards[idx].getBoundingClientRect().top - cards[idx - 1].getBoundingClientRect().bottom : null
      })(),
    }
  })
  assert.equal(groupPaint.radius, '10px', '组卡片圆角 10px 档位')
  assert.equal(groupPaint.marginTop, '10px', '组卡 margin 10px（与 flex gap 合成 20px 档位）')
  assert.equal(groupPaint.areaGap, '10px', '设置区 flex gap 10px（间距合成的另一半）')
  assert.equal(groupPaint.realGap, 20, '组卡片真实间距 20px 档位（gap + margin 叠加后）')
  assert.equal(groupPaint.title, '1px', '组标题通栏下边线在场')
  await page.screenshot({ path: path.join(artifacts, 'settings-area-grouped.png') })

  // 全局搜索：组标题命中归「组件设置」分组，点击跨组件定位组容器
  const search = page.locator('input.vsidian-settings-search')
  await search.fill('外观')
  const groupHit = page.locator('.vsidian-settings-result', { hasText: zhCn['settings.addonSettingsSection'] }).filter({ hasText: '外观' }).first()
  await groupHit.waitFor()
  await groupHit.click()
  await area.waitFor()
  const locatedCard = area.locator('.vsidian-settings-group.vsidian-settings-item-located')
  await locatedCard.waitFor()
  assert.match(await locatedCard.innerText(), /外观/, '组级定位描组容器')
  const locatedPaint = await locatedCard.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset }
  })
  assert.equal(locatedPaint.width, '1px', '定位高亮外框宽度（绘制层）')
  assert.equal(locatedPaint.style, 'solid', '定位高亮外框样式（绘制层）')
  assert.equal(locatedPaint.offset, '8px', '定位高亮外框偏移档位')
  await page.screenshot({ path: path.join(artifacts, 'settings-area-group-located.png') })

  // 定义级定位：搜索定义标题命中并定位到定义行（落点唯一——行不描容器）
  await search.fill('阈值')
  const defHit = page.locator('.vsidian-settings-result', { hasText: zhCn['settings.addonSettingsSection'] }).filter({ hasText: '阈值' }).first()
  await defHit.waitFor()
  await defHit.click()
  await area.waitFor()
  const locatedRow = area.locator('.vsidian-addons-setting-item.vsidian-settings-item-located')
  await locatedRow.waitFor()
  assert.match(await locatedRow.innerText(), /阈值/, 'def 级定位描定义行')
  assert.equal(await area.locator('.vsidian-settings-group.vsidian-settings-item-located').count(), 0, 'def 级定位不描组容器（落点唯一）')

  // ---- 13b. #472 挂起定位的真实布局滚动（评审轮修复回归） ----
  // 长定义集（远超一屏）+ 窄视口 + 设置区关闭态：经全局搜索点击末位组内
  // 定义 → 发 settingsOpen → 应答渲染定位——断言主区滚到目标行且不被
  // #467 滚动守卫的 restore 写回（定位语义优先于锚点恢复）
  await page.evaluate(() => {
    const longDefs = [{ key: 'flag', title: '开关项', type: 'boolean', default: true }]
    for (let i = 1; i <= 30; i++) longDefs.push({ key: `opt${i}`, title: `选项 ${String(i).padStart(2, '0')}`, type: 'boolean', default: false })
    longDefs.push({ key: 'farTheme', title: '远端主题', type: 'string', default: 'light', group: 'appearance' })
    window.__defs = longDefs
    window.__hostState.open = null
    window.dispatchEvent(new MessageEvent('message', { source: window, data: window.__addonsState() }))
    window.dispatchEvent(new MessageEvent('message', { source: window, data: window.__settingsState() }))
  })
  await page.locator('.vsidian-addons-settings-hub').waitFor()
  await page.setViewportSize({ width: 1100, height: 320 })
  await page.evaluate(() => { window.sentMessages.length = 0 })
  const search13b = page.locator('input.vsidian-settings-search')
  await search13b.fill('远端主题')
  const farHit = page.locator('.vsidian-settings-result', { hasText: zhCn['settings.addonSettingsSection'] }).filter({ hasText: '远端主题' }).first()
  await farHit.waitFor()
  await farHit.click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === 'fixture.demo'))
  const area13b = page.locator('.vsidian-addons-settings')
  await area13b.waitFor()
  const locatedRow13b = area13b.locator('.vsidian-addons-setting-item.vsidian-settings-item-located')
  await locatedRow13b.waitFor()
  assert.match(await locatedRow13b.innerText(), /远端主题/, '挂起定位到达后目标行高亮')
  const scrolled = await main.evaluate((el) => el.scrollTop)
  assert.ok(scrolled > 0, `定位滚动应落位且不被滚动守卫写回（实际 scrollTop ${scrolled}）`)
  const inViewport = await locatedRow13b.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight
  })
  assert.equal(inViewport, true, '目标行在视口内（真实布局定位）')
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.screenshot({ path: path.join(artifacts, 'settings-area-pending-located.png') })

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  console.log('[#353] 附加组件基础设置区浏览器回归通过（双标签/标量数组对象/清覆盖/失败反馈）')
  console.log('[#467] 附加分页推送链路滚动与焦点保持通过（复选框/功能开关/数组保存 × 中部滚动）')
  console.log('[#472] 设置定义分组浏览器回归通过（组容器/组标题档位/搜索跨组件定位 def+group）')
} finally {
  await browser.close()
}
