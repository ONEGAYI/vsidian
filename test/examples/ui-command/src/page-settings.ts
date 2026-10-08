// #364 T15 界面样例——自有设置页源码（settings 页经构建桥打成 IIFE）。
//
// T02 面的消费形态：registerPage 登记入口（见 extension.ts），设置页面板
// 装载本产物并注入 SDK；mountRoot 渲染控件，读写全部经 setup scope 通道
// （ui.settingsRead / ui.settingsWrite——宿主侧转公开 settings API，按批
// 校验失败不虚报）。scope 切换展示 T05 分层写入（用户默认 / 工作区覆盖）。
//
// 控件刻意保持零依赖原生形态（不引 CSS 框架）：面板 chrome 与 dock 样式
// 归平台，内容根内部样式归组件（内容样式见 src/settings.css）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import { pickMessages } from './i18n'

const ADDON_ID = 'vsidian-example.ui-command'

/** 表单值形状（与设置定义对齐：enum/boolean/对象字段表/字符串数组） */
interface SettingsForm {
  timestampFormat: 'iso' | 'date' | 'time'
  autoOpenPanel: boolean
  panelTitle: string
  panelShowLines: boolean
  summarizeIgnore: readonly string[]
}

const FORM_DEFAULTS: SettingsForm = {
  timestampFormat: 'iso',
  autoOpenPanel: false,
  panelTitle: '',
  panelShowLines: true,
  summarizeIgnore: [],
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    throw new Error('设置页 SDK 未提供挂载根')
  }
  const m = pickMessages(navigator.language)
  let scope: 'user' | 'workspace' = 'user'

  root.className = 'sample-ui-settings-root'
  const title = document.createElement('h3')
  title.className = 'sample-ui-settings-title'
  title.textContent = m.settingsPageTitle
  root.append(title)

  const status = document.createElement('div')
  status.className = 'sample-ui-settings-status'
  status.setAttribute('data-sample-settings-status', 'idle')
  root.append(status)

  const showStatus = (text: string, state: 'idle' | 'saved' | 'failed'): void => {
    status.textContent = text
    status.setAttribute('data-sample-settings-status', state)
  }

  // ---- 控件构造（label + 控件两列；变更即记入表单，保存按钮提交） ----
  const form: SettingsForm = { ...FORM_DEFAULTS }
  const rows = document.createElement('div')
  rows.className = 'sample-ui-settings-rows'
  root.append(rows)

  const addRow = (labelText: string, control: HTMLElement): void => {
    const row = document.createElement('label')
    row.className = 'sample-ui-settings-row'
    const name = document.createElement('span')
    name.className = 'sample-ui-settings-name'
    name.textContent = labelText
    row.append(name, control)
    rows.append(row)
  }

  const formatSelect = document.createElement('select')
  for (const value of ['iso', 'date', 'time'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    formatSelect.append(option)
  }
  formatSelect.addEventListener('change', () => {
    form.timestampFormat = formatSelect.value as SettingsForm['timestampFormat']
  })
  addRow(m.settingTimestampFormat, formatSelect)

  const autoOpenCheck = document.createElement('input')
  autoOpenCheck.type = 'checkbox'
  autoOpenCheck.addEventListener('change', () => {
    form.autoOpenPanel = autoOpenCheck.checked
  })
  addRow(m.settingAutoOpenPanel, autoOpenCheck)

  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  titleInput.maxLength = 30
  titleInput.addEventListener('input', () => {
    form.panelTitle = titleInput.value
  })
  addRow(m.settingPanelTitle, titleInput)

  const showLinesCheck = document.createElement('input')
  showLinesCheck.type = 'checkbox'
  showLinesCheck.addEventListener('change', () => {
    form.panelShowLines = showLinesCheck.checked
  })
  addRow(m.settingPanelShowLines, showLinesCheck)

  const ignoreInput = document.createElement('input')
  ignoreInput.type = 'text'
  ignoreInput.placeholder = 'a, b, c'
  ignoreInput.addEventListener('input', () => {
    form.summarizeIgnore = ignoreInput.value
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 10)
  })
  addRow(m.settingSummarizeIgnore, ignoreInput)

  // ---- scope 切换（T05 分层：写入目标层） ----
  const scopeSelect = document.createElement('select')
  for (const value of ['user', 'workspace'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value === 'user' ? m.settingsScopeUser : m.settingsScopeWorkspace
    scopeSelect.append(option)
  }
  scopeSelect.addEventListener('change', () => {
    scope = scopeSelect.value as 'user' | 'workspace'
  })
  addRow('scope', scopeSelect)

  const saveButton = document.createElement('button')
  saveButton.type = 'button'
  saveButton.textContent = m.settingsSave
  saveButton.className = 'sample-ui-settings-save'
  saveButton.addEventListener('click', () => {
    void sdk.channel
      .request('ui.settingsWrite', {
        scope,
        values: {
          timestampFormat: form.timestampFormat,
          autoOpenPanel: form.autoOpenPanel,
          panel: { title: form.panelTitle, showLines: form.panelShowLines },
          summarizeIgnore: [...form.summarizeIgnore],
        },
      })
      .then((outcome) => {
        if (outcome.ok !== true) {
          showStatus(`${m.settingsSaveFailed}：${outcome.reason}`, 'failed')
          return
        }
        const result = (typeof outcome.result === 'object' && outcome.result !== null ? outcome.result : null) as { ok?: boolean; reason?: string } | null
        if (result?.ok === true) {
          showStatus(m.settingsSaved, 'saved')
        } else {
          showStatus(`${m.settingsSaveFailed}：${String(result?.reason ?? 'unknown')}`, 'failed')
        }
      })
  })
  root.append(saveButton)

  // ---- 装载即读当前生效值回显 + 上报挂载（通道闭环断言面） ----
  void sdk.channel.request('ui.settingsRead', null).then((outcome) => {
    if (outcome.ok !== true || typeof outcome.result !== 'object' || outcome.result === null) {
      return
    }
    const values = (outcome.result as { values?: Record<string, unknown> }).values ?? {}
    const panel = (typeof values['panel'] === 'object' && values['panel'] !== null ? values['panel'] : {}) as Record<string, unknown>
    const ignore = Array.isArray(values['summarizeIgnore']) ? (values['summarizeIgnore'] as unknown[]) : []
    form.timestampFormat = values['timestampFormat'] === 'date' || values['timestampFormat'] === 'time' ? values['timestampFormat'] : 'iso'
    form.autoOpenPanel = values['autoOpenPanel'] === true
    form.panelTitle = typeof panel['title'] === 'string' ? panel['title'] : ''
    form.panelShowLines = panel['showLines'] !== false
    form.summarizeIgnore = ignore.filter((item): item is string => typeof item === 'string')
    // 回显（服务端值优先——表单与权威态一致）
    formatSelect.value = form.timestampFormat
    autoOpenCheck.checked = form.autoOpenPanel
    titleInput.value = form.panelTitle
    showLinesCheck.checked = form.panelShowLines
    ignoreInput.value = form.summarizeIgnore.join(', ')
  })
  void sdk.channel.request('ui.settingsMounted', null).then(() => {}, () => {})

  sdk.onDispose(() => {
    // 释放语义由装载器驱动（面板隐藏即销毁）；页面侧无需自清
  })
})
