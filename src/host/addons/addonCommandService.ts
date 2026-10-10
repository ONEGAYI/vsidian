// #359 T10 附加组件命令宿主服务（纯逻辑，vscode 经端口注入）。
//
// 职责（票面 #359）：
// - 接受编辑器 webview 的全量对账上报（addonCommands.report）：仅 runtime
//   runState === 'enabled' 时接受（停用/故障/释放后的迟到上报忽略——权威
//   回收以 runtime 状态为准，不依赖 webview 消息到达）；
// - 为每条命令注册宿主 VSCode 命令（命令面板入口：执行转发到活动编辑器
//   面板，由 webview 按命令声明的生效模式复核后调组件回调）；
// - 维护组件命令目录并广播变化（设置页快捷键分页合并展示的消费面）；
// - 同步宿主侧键位运行期操作表（setRuntimeOperations）——keybindingService
//   的冲突检查与生效绑定对组件命令 id 生效（同一 KeybindingOverrides 存储）；
// - 停用/故障/代次释放时整组件回收（releaseAddon）：注销 VSCode 命令、清
//   目录并广播——不影响内置命令与菜单。
import type { AddonCommandReport } from '../../shared/addonCommands'
import {
  chordContainsReservedTab,
  normalizeChord,
  setRuntimeOperations,
  type RuntimeKeybindingOperation,
} from '../../shared/keybindings'

/** 宿主命令注册端口（vscode 层注入：vscode.commands.registerCommand 包装） */
export interface AddonCommandServicePorts {
  /** 注册宿主 VSCode 命令（run 返回是否投递到活动面板；dispose 注销） */
  registerHostCommand(commandId: string, run: () => boolean): { dispose(): void }
  /** runtime runState 查询（undefined = 未注册；enabled 才接受上报） */
  runStateOf(addonId: string): 'idle' | 'enabled' | 'disabled' | 'faulted' | undefined
  /** 执行转发到活动编辑器面板（addonCommand.execute 投递；无活动面板 false） */
  forwardToActivePanel(commandId: string): boolean
  /** 归因日志 */
  log(stage: string, addonId: string, detail: string): void
}

interface CommandRecord {
  report: AddonCommandReport
  disposable: { dispose(): void }
}

export class AddonCommandService {
  /** addonId → commandId → 记录 */
  private readonly byAddon = new Map<string, Map<string, CommandRecord>>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly ports: AddonCommandServicePorts) {}

  /** webview 全量对账上报：状态门控 + 全表替换（幂等；空表 = 全撤） */
  syncReport(addonId: string, generation: number, commands: readonly AddonCommandReport[]): void {
    const runState = this.ports.runStateOf(addonId)
    if (runState !== 'enabled') {
      this.ports.log('commands-report-ignored', addonId, `runState=${runState ?? 'unregistered'} generation=${generation}`)
      return
    }
    const seen = new Set<string>()
    const defaultsByCommand = new Map<string, string[]>()
    for (const command of commands) {
      if (command.addonId !== addonId || command.commandId !== `${command.addonId}.${command.localId}`) {
        // 命名空间不一致或条目归属他组件（伪造归属）：整批拒绝（协议
        // 守卫已过滤形态，此处兜底归属自洽）
        this.ports.log('commands-report-rejected', addonId, `namespace mismatch: ${command.commandId}`)
        return
      }
      if (seen.has(command.commandId)) {
        this.ports.log('commands-report-rejected', addonId, `duplicate: ${command.commandId}`)
        return
      }
      // #443：defaults 复验归一形态。协议守卫仅形态过滤（字符串数组即可
      // 过），伪造消息携带非规范序 defaults 会让宿主目录/设置页的字面比较
      // （chordOverlap）漏判冲突。null 即整批拒绝；非规范序归一后入目录
      // （与编辑器 SDK 侧 buildAddonCommandReport 的「归一化后存储」同
      // 语义——含保留 Tab 段拒绝的对称面：裸 Tab/Shift+Tab 归一为
      // tab/shift+tab 非 null，须独立拦下，否则违约绑定进宿主目录与设置页）。
      const defaults: string[] = []
      for (const raw of command.defaults) {
        const normalized = normalizeChord(raw)
        if (normalized === null) {
          this.ports.log('commands-report-rejected', addonId, `invalid defaults: ${command.commandId}`)
          return
        }
        if (chordContainsReservedTab(normalized)) {
          this.ports.log('commands-report-rejected', addonId, `tab-forbidden defaults: ${command.commandId}`)
          return
        }
        defaults.push(normalized)
      }
      seen.add(command.commandId)
      defaultsByCommand.set(command.commandId, defaults)
    }
    const table = this.byAddon.get(addonId) ?? new Map<string, CommandRecord>()
    // 全表替换：先撤不在新表的命令（dispose 注销 VSCode 命令）
    for (const [commandId, record] of [...table]) {
      if (!seen.has(commandId)) {
        record.disposable.dispose()
        table.delete(commandId)
      }
    }
    for (const command of commands) {
      const report: AddonCommandReport = { ...command, defaults: defaultsByCommand.get(command.commandId)! }
      if (table.has(command.commandId)) {
        // 已在场：替换报告载荷（同 id 的 VSCode 命令不重复注册）
        const record = table.get(command.commandId)!
        record.report = report
        continue
      }
      table.set(command.commandId, {
        report,
        disposable: this.ports.registerHostCommand(command.commandId, () =>
          this.ports.forwardToActivePanel(command.commandId)),
      })
    }
    if (table.size > 0) {
      this.byAddon.set(addonId, table)
    } else {
      this.byAddon.delete(addonId)
    }
    this.syncRuntimeOperations()
    this.notify()
  }

  /** 整组件回收（runtime 状态离开 enabled / 代次释放）：注销命令 + 清目录 */
  releaseAddon(addonId: string): void {
    const table = this.byAddon.get(addonId)
    if (!table) {
      return
    }
    for (const record of table.values()) {
      try {
        record.disposable.dispose()
      } catch {
        // 注销异常不阻断其余回收
      }
    }
    this.byAddon.delete(addonId)
    this.syncRuntimeOperations()
    this.notify()
  }

  /** 全部释放（扩展停用收尾） */
  dispose(): void {
    for (const addonId of [...this.byAddon.keys()]) {
      this.releaseAddon(addonId)
    }
    this.listeners.clear()
  }

  /** 当前目录（设置页拉取与推送载荷；全部在场组件命令） */
  catalog(): readonly AddonCommandReport[] {
    return [...this.byAddon.values()].flatMap((table) => [...table.values()].map((record) => record.report))
  }

  /** 目录变化订阅（设置页推送接线）；返回退订函数 */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 宿主侧键位运行期操作表同步（冲突检查与生效绑定的合并视图） */
  private syncRuntimeOperations(): void {
    const ops: RuntimeKeybindingOperation[] = this.catalog().map((report) => ({
      id: report.commandId,
      command: report.commandId,
      titleKey: 'command.find.title',
      titleOverride: report.title,
      addonId: report.addonId,
      mode: report.mode,
      writes: report.writes,
      defaults: [...report.defaults],
    }))
    setRuntimeOperations(ops)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}
