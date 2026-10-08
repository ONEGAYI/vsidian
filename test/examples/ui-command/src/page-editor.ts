// #364 T15 界面样例——编辑器页源码（经 SDK 构建桥打成 chrome114 IIFE）。
//
// 经公开 commands/menus/ui 面注册界面贡献（覆盖 T15 票面验收路径）：
// - 命令 insertTimestamp（live、writes、默认未绑定——统一快捷键管理中可
//   绑定/清空/恢复）：光标处插入时间戳（views.applyEdits 默认原子提交，
//   经 timestampFormat 设置取格式）；命令 summarize（both、只读、默认
//   ctrl+alt+u）：统计当前文档（面板打开时刷新面板内容并上报）；
// - 菜单项 insertTimestampEntry（挂接 insertTimestamp——点击经命令体系
//   执行）；执行链三入口（快捷键路由/命令面板/菜单点击）共用组件回调；
// - 按钮 timestampBtn（command 挂接路径——键位徽章取生效绑定）与
//   summarizeBtn（onClick 自带回调——平台注入当前活动视图句柄）；
// - 面板 docStats（mount 经 target() 句柄读快照渲染字符数/行数/模式；
//   autoOpenPanel 设置为 true 时注册后自动打开）。
//
// 停用/故障/代次释放由平台整组件回收（命令目录撤、按钮撤、面板关）；
// 用户键位与设置值保留（平台持久层）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonViewHandle } from '../../../../src/shared/addonEditApi'
import type { AddonUiTargetGetter } from '../../../../src/shared/addonUi'
import { pickMessages, type ExampleMessages } from './i18n'

const ADDON_ID = 'vsidian-example.ui-command'

/** 组件设置缓存（宿主不可达回退默认值） */
interface UiSettings {
  readonly timestampFormat: 'iso' | 'date' | 'time'
  readonly autoOpenPanel: boolean
  readonly panel: { title: string; showLines: boolean }
  readonly summarizeIgnore: readonly string[]
}

function defaultSettings(m: ExampleMessages): UiSettings {
  return { timestampFormat: 'iso', autoOpenPanel: false, panel: { title: m.panelDocStats, showLines: true }, summarizeIgnore: [] }
}

/** 时间戳文本（按 timestampFormat 设置） */
function timestampOf(format: UiSettings['timestampFormat']): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  if (format === 'date') {
    return date
  }
  if (format === 'time') {
    return time
  }
  return `${date} ${time}`
}

defineAddonPage(ADDON_ID, async (sdk: VsidianAddonPageSdk) => {
  const views = sdk.views
  const commands = sdk.commands
  const menus = sdk.menus
  const ui = sdk.ui
  if (!views || !commands || !menus || !ui) {
    throw new Error('editor page SDK must expose views/commands/menus/ui facets')
  }
  const m = pickMessages(navigator.language)

  // 放行门控（默认值语义见 extension.ts 文件头注）
  const permission = await sdk.channel.request('ui.allowed', null)
  const allowed = permission.ok === true &&
    (permission.result as { allowed?: unknown } | null)?.allowed === true
  if (!allowed) {
    return
  }

  let settings: UiSettings = defaultSettings(m)
  const refreshSettings = async (): Promise<void> => {
    const outcome = await sdk.channel.request('ui.settingsRead', null)
    if (outcome.ok !== true || typeof outcome.result !== 'object' || outcome.result === null) {
      return
    }
    const values = (outcome.result as { values?: Record<string, unknown> }).values ?? {}
    const panel = (typeof values['panel'] === 'object' && values['panel'] !== null ? values['panel'] : {}) as Record<string, unknown>
    const ignore = Array.isArray(values['summarizeIgnore']) ? (values['summarizeIgnore'] as unknown[]) : []
    settings = {
      timestampFormat: values['timestampFormat'] === 'date' || values['timestampFormat'] === 'time' ? values['timestampFormat'] : 'iso',
      autoOpenPanel: values['autoOpenPanel'] === true,
      panel: {
        title: typeof panel['title'] === 'string' && panel['title'].length > 0 ? panel['title'] : m.panelDocStats,
        showLines: panel['showLines'] !== false,
      },
      summarizeIgnore: ignore.filter((item): item is string => typeof item === 'string'),
    }
  }
  await refreshSettings()

  const report = (event: Record<string, unknown>): void => {
    void sdk.channel.request('ui.event', event).then(() => {}, () => {})
  }

  const counters: Record<string, number> = { insertTimestamp: 0, summarize: 0, panelMounts: 0 }
  const outcomes: Record<string, unknown> = {}

  /** 主正文句柄（命令回调无 target 注入——经 views.list 取主视图） */
  const mainHandle = (): AddonViewHandle | null => {
    const listed = views.list().filter((info) => info.viewType === 'main')
    const main = listed[0]
    return main ? views.get(main.instanceId) ?? null : null
  }

  /** 插入时间戳（默认原子提交——宿主撤销一笔回退） */
  const insertTimestamp = async (): Promise<unknown> => {
    await refreshSettings()
    const handle = mainHandle()
    if (!handle) {
      return { ok: false, reason: 'no-main-view' }
    }
    const snapshot = await handle.editor.getSnapshot()
    if (!snapshot.ok) {
      return snapshot
    }
    return handle.editor.applyEdits({
      revision: snapshot.snapshot.revision,
      changes: [{ offset: snapshot.snapshot.selections[0]?.head ?? 0, length: 0, text: timestampOf(settings.timestampFormat) }],
    })
  }

  /** 统计（忽略列表按设置；面板打开时刷新其内容） */
  const summarizeOf = (text: string): { chars: number; lines: number } => {
    const ignored = new Set(settings.summarizeIgnore)
    let chars = 0
    for (const ch of text) {
      if (!ignored.has(ch)) {
        chars++
      }
    }
    return { chars, lines: text.length === 0 ? 0 : text.split('\n').length }
  }

  const runSummarize = async (target: AddonViewHandle | null): Promise<unknown> => {
    await refreshSettings()
    const handle = target ?? mainHandle()
    if (!handle) {
      return { ok: false, reason: 'no-main-view' }
    }
    const snapshot = await handle.editor.getSnapshot()
    if (!snapshot.ok) {
      return snapshot
    }
    const summary = summarizeOf(snapshot.snapshot.text)
    report({ kind: 'summarized', ...summary, viewId: handle.info.instanceId, mode: handle.info.mode })
    renderPanelBody(summary, handle)
    return { ok: true, ...summary }
  }

  // ---- 命令注册（T10）----
  const insertCommand = commands.register(
    { id: 'insertTimestamp', title: m.commandInsertTimestamp, mode: 'live', writes: true },
    () => {
      counters.insertTimestamp++
      void insertTimestamp().catch(() => {})
    },
  )
  outcomes['insertTimestamp'] = insertCommand.ok
    ? { ok: true, commandId: insertCommand.commandId }
    : { ok: false, reason: insertCommand.reason }
  const insertDispose: (() => void) | undefined = insertCommand.ok ? insertCommand.dispose : undefined

  const summarizeCommand = commands.register(
    { id: 'summarize', title: m.commandSummarize, mode: 'both', writes: false, defaultBindings: ['ctrl+alt+u'] },
    () => {
      counters.summarize++
      void runSummarize(null).catch(() => {})
    },
  )
  outcomes['summarize'] = summarizeCommand.ok
    ? { ok: true, commandId: summarizeCommand.commandId }
    : { ok: false, reason: summarizeCommand.reason }
  const summarizeDispose: (() => void) | undefined = summarizeCommand.ok ? summarizeCommand.dispose : undefined

  // ---- 菜单项（T10）：挂接命令（点击经命令体系执行） ----
  const menuOutcome = menus.registerItem({
    id: 'insertTimestampEntry',
    label: m.menuInsertTimestamp,
    iconKey: 'link',
    command: 'insertTimestamp',
  })
  outcomes['menuEntry'] = menuOutcome.ok ? { ok: true, id: menuOutcome.id } : { ok: false, reason: menuOutcome.reason }
  const menuDispose: (() => void) | undefined = menuOutcome.ok ? menuOutcome.dispose : undefined

  // ---- 按钮（T11）：挂接命令路径 ----
  const timestampButton = ui.registerButton({ id: 'timestampBtn', label: m.buttonTimestamp, iconText: 'TS', command: 'insertTimestamp' })
  outcomes['timestampBtn'] = timestampButton.ok ? { ok: true, id: timestampButton.id } : { ok: false, reason: timestampButton.reason }
  const timestampButtonDispose: (() => void) | undefined = timestampButton.ok ? timestampButton.dispose : undefined

  // ---- 按钮（T11）：onClick 自带回调路径（平台注入当前活动视图句柄） ----
  const summarizeButton = ui.registerButton(
    { id: 'summarizeBtn', label: m.buttonSummarize, iconText: 'Σ' },
    (target) => {
      void runSummarize(target).catch(() => {})
    },
  )
  outcomes['summarizeBtn'] = summarizeButton.ok ? { ok: true, id: summarizeButton.id } : { ok: false, reason: summarizeButton.reason }
  const summarizeButtonDispose: (() => void) | undefined = summarizeButton.ok ? summarizeButton.dispose : undefined

  // ---- 面板（T11）：mount 读 target() 快照渲染统计 ----
  let panelBody: HTMLElement | null = null
  const renderPanelBody = (summary: { chars: number; lines: number }, handle: AddonViewHandle | null): void => {
    if (!panelBody) {
      return
    }
    panelBody.textContent = ''
    const row = (label: string, value: string): void => {
      const line = document.createElement('div')
      line.className = 'sample-ui-panel-row'
      const name = document.createElement('span')
      name.className = 'sample-ui-panel-label'
      name.textContent = `${label}：`
      const val = document.createElement('span')
      val.textContent = value
      line.append(name, val)
      panelBody?.append(line)
    }
    row(m.panelChars, String(summary.chars))
    if (settings.panel.showLines) {
      row(m.panelLines, String(summary.lines))
    }
    row(m.panelMode, handle?.info.mode ?? '-')
  }
  const statsPanel = ui.registerPanel({
    id: 'docStats',
    title: settings.panel.title,
    mount: (root: unknown, target: AddonUiTargetGetter) => {
      counters.panelMounts++
      const el = root as HTMLElement
      el.className = 'sample-ui-panel'
      const body = document.createElement('div')
      body.className = 'sample-ui-panel-body'
      // 同步占位内容（面板内容根立即非空——可见性不依赖异步快照完成）
      body.textContent = '…'
      el.append(body)
      panelBody = body
      void (async () => {
        const handle = target()
        if (!handle) {
          renderPanelBody({ chars: 0, lines: 0 }, null)
          report({ kind: 'panelMounted', chars: 0, lines: 0, mode: '-' })
          return
        }
        const snapshot = await handle.editor.getSnapshot()
        if (!snapshot.ok) {
          renderPanelBody({ chars: 0, lines: 0 }, handle)
          report({ kind: 'panelMounted', chars: 0, lines: 0, mode: handle.info.mode })
          return
        }
        const summary = summarizeOf(snapshot.snapshot.text)
        renderPanelBody(summary, handle)
        report({ kind: 'panelMounted', ...summary, mode: handle.info.mode, viewId: handle.info.instanceId })
      })().catch(() => {
        // 快照失败保持占位内容（面板内容根非空；下次 mount 重试）
      })
    },
    unmount: () => {
      panelBody = null
    },
  })
  outcomes['docStats'] = statsPanel.ok ? { ok: true, id: statsPanel.id } : { ok: false, reason: statsPanel.reason }
  const panelDispose: (() => void) | undefined = statsPanel.ok ? statsPanel.dispose : undefined

  // 注册结局上报（宿主收件箱——集成/调试断言面）
  report({ kind: 'registered', outcomes: { ...outcomes } })

  // 设置驱动：autoOpenPanel = true 时挂载即打开统计面板
  if (settings.autoOpenPanel && statsPanel.ok) {
    statsPanel.open()
  }

  sdk.onDispose(() => {
    // 自主清理（平台整组件回收之外的句柄路径；重复释放无害）
    for (const dispose of [insertDispose, summarizeDispose, menuDispose, timestampButtonDispose, summarizeButtonDispose, panelDispose]) {
      if (dispose !== undefined) {
        try {
          dispose()
        } catch {
          // 已释放句柄的迟到 dispose 无害
        }
      }
    }
  })
})
