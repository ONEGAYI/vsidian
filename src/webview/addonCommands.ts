// #359 T10 附加组件命令与菜单注册表（webview 编辑器页运行时）。
//
// 职责（票面 #359 / ADR-0012 菜单边界）：
// - SDK 注册面后端：sdk.commands.register / sdk.menus.registerItem 的校验、
//   命名空间注入、回调存管与句柄分发；
// - 统一快捷键管理接入：注册/撤销同步 shared/keybindings 运行期操作层
//  （setRuntimeOperations）——本页键路由、菜单提示与冲突检查即消费合并视图；
// - 全量对账上报：每次注册/撤销后把该组件命令表（AddonCommandReport[]，
//   序列化安全）经通道上报宿主——宿主据此注册命令面板命令与推送设置页
//   目录（同名 second 注册拒绝，首表继续服务）；
// - 停用/故障回收：releaseAddon（装载器 releaseLoad 调用）撤命令、菜单与
//   运行期表并上报空表——回收在本页闭环，不依赖宿主消息到达。
//
// 拒绝面语义（普通 API 拒绝，不算故障——与通道同名 topic 拒绝同口径）：
// localId 含点（伪造跨组件/内置身份）、同名注册（同组件同 localId）、
// 非法默认绑定（含 Tab——#125 固定链）、菜单 iconKey 未登记、label 空。
import {
  addonLocalIdProblem,
  addonDefaultBindingsProblem,
  addonMenuItemProblem,
  buildAddonCommandReport,
  namespacedAddonId,
  type AddonCommandDefinition,
  type AddonCommandRegisterResult,
  type AddonCommandReport,
  type AddonMenuItemDefinition,
} from '../shared/addonCommands'
import { setRuntimeOperations, type RuntimeKeybindingOperation } from '../shared/keybindings'
import { registerContextMenuItem, CONTEXT_MENU_ITEMS, type MenuContextSnapshot } from '../shared/contextMenu'

/** 内置菜单项 id 全集（覆写尝试的结构性对照面：localId 命名空间化后
 *  不得命中任何内置 id——前缀隔离天然满足，此处仅防御性复核） */
const BUILTIN_MENU_IDS = new Set<string>(flattenIds(CONTEXT_MENU_ITEMS))

function flattenIds(defs: readonly { id: string; children?: readonly object[] }[]): string[] {
  const out: string[] = []
  for (const def of defs) {
    out.push(def.id)
    if (def.children) {
      out.push(...flattenIds(def.children as readonly { id: string; children?: readonly object[] }[]))
    }
  }
  return out
}

/** SDK 命令注册返回句柄（对齐 AddonCommandRegisterResult；dispose 撤销本条
 *  注册，拒绝时为 no-op） */
export type AddonCommandRegistrationOutcome = AddonCommandRegisterResult & { dispose(): void }

/** SDK 菜单注册返回句柄（id = 命名空间菜单项 ID） */
export interface AddonMenuRegistrationOutcome {
  ok: boolean
  reason?: string
  id?: string
  dispose(): void
}

interface CommandEntry {
  addonId: string
  generation: number
  report: AddonCommandReport
  handler: () => void
}

export interface AddonCommandsRuntimeEnv {
  /** 全量对账上报（注册与撤销后各发一次该组件当前全表） */
  report: (payload: { addonId: string; generation: number; commands: readonly AddonCommandReport[] }) => void
  /** 归因日志（拒绝与执行异常留痕；缺省 console） */
  log?: (detail: string) => void
  /** T12（#361）可归因执行回调异常升级上报（main.ts 注入装载器的
   *  reportRuntimeFault；缺省仅留痕不升级——旧装配不受影响） */
  reportFault?: (addonId: string, stage: string, detail: string) => boolean
}

export class AddonCommandsRuntime {
  /** commandId → 条目（同组件同 localId 即同名注册——拒绝面） */
  private readonly commands = new Map<string, CommandEntry>()
  /** 菜单 cleanup 句柄（per addon 收集——releaseAddon 统一撤） */
  private readonly menuCleanups = new Map<string, Array<() => void>>()

  constructor(private readonly env: AddonCommandsRuntimeEnv) {}

  /** SDK commands.register 后端：校验 → 存管 → 同步运行期表 → 上报 */
  registerCommand(addonId: string, generation: number, def: AddonCommandDefinition, handler: () => void): AddonCommandRegistrationOutcome {
    const reject = (reason: string): AddonCommandRegistrationOutcome => {
      this.env.log?.(`addon ${addonId} command-register rejected: ${reason}`)
      return { ok: false, reason, dispose: () => {} }
    }
    const idProblem = addonLocalIdProblem(def.id)
    if (idProblem !== null) {
      return reject(`local-id:${idProblem}`)
    }
    if (typeof def.title !== 'string' || def.title.length === 0) {
      return reject('title-empty')
    }
    const bindingProblem = addonDefaultBindingsProblem(def.defaultBindings ?? [])
    if (bindingProblem !== null) {
      return reject(`default-bindings:${bindingProblem}`)
    }
    if (typeof handler !== 'function') {
      return reject('handler-not-function')
    }
    const report = buildAddonCommandReport(addonId, def)
    if (report === null) {
      return reject('invalid-definition')
    }
    if (this.commands.has(report.commandId)) {
      // 同名注册（同组件同 localId）：拒绝，首个继续服务
      return reject('duplicate-command')
    }
    this.commands.set(report.commandId, { addonId, generation, report, handler })
    this.syncRuntimeOperations()
    this.reportOf(addonId)
    return {
      ok: true,
      commandId: report.commandId,
      dispose: () => {
        if (this.commands.get(report.commandId)?.generation === generation) {
          this.commands.delete(report.commandId)
          this.syncRuntimeOperations()
          this.reportOf(addonId)
        }
      },
    }
  }

  /** SDK menus.registerItem 后端：校验 → 命名空间注入 → 内置覆写防御复核
   *  → contextMenu 运行期层注册（handler 优先分派路径） */
  registerMenuItem(
    addonId: string,
    def: AddonMenuItemDefinition,
    execute: (commandId: string) => void,
  ): AddonMenuRegistrationOutcome {
    const reject = (reason: string): AddonMenuRegistrationOutcome => {
      this.env.log?.(`addon ${addonId} menu-register rejected: ${reason}`)
      return { ok: false, reason, dispose: () => {} }
    }
    const problem = addonMenuItemProblem(def)
    if (problem !== null) {
      return reject(`menu-item:${problem}`)
    }
    const commandLocalId = def.command ?? def.id
    const namespacedMenuId = namespacedAddonId(addonId, def.id)
    // 防御性复核：命名空间化 id 不得命中内置菜单 id（localId 禁点已结构
    // 隔离；此处兜底未来 id 形态变化）
    if (BUILTIN_MENU_IDS.has(namespacedMenuId)) {
      return reject('builtin-id')
    }
    const executeCommandId = namespacedAddonId(addonId, commandLocalId)
    const disposeMenu = registerContextMenuItem({
      id: namespacedMenuId,
      group: `addon.${addonId}`,
      order: def.order ?? 0,
      labelKey: 'contextMenu.copy',
      label: def.label,
      command: executeCommandId,
      ...(def.iconKey !== undefined ? { iconKey: def.iconKey } : {}),
      ...(def.when !== undefined ? { when: def.when } : {}),
      ...(def.enable !== undefined ? { enable: def.enable } : {}),
      handler: () => execute(executeCommandId),
    })
    let cleanups = this.menuCleanups.get(addonId)
    if (!cleanups) {
      cleanups = []
      this.menuCleanups.set(addonId, cleanups)
    }
    cleanups.push(disposeMenu)
    return {
      ok: true,
      id: namespacedMenuId,
      dispose: () => this.disposeMenuItem(addonId, disposeMenu),
    }
  }

  private disposeMenuItem(addonId: string, disposeMenu: () => void): void {
    const cleanups = this.menuCleanups.get(addonId)
    const index = cleanups?.indexOf(disposeMenu) ?? -1
    if (index === undefined || index < 0) {
      return
    }
    cleanups!.splice(index, 1)
    disposeMenu()
  }

  /** 执行命令回调（快捷键本地分支与宿主回发两入口共用；返回执行结局） */
  execute(commandId: string): 'executed' | 'unknown' {
    const entry = this.commands.get(commandId)
    if (!entry) {
      return 'unknown'
    }
    try {
      entry.handler()
    } catch (err) {
      // 回调异常不外溢（键路由/宿主回发不因组件代码抛错断链）
      this.env.log?.(`addon ${entry.addonId} command ${commandId} handler error: ${String(err)}`)
      // T12（#361）：可归因执行回调异常升级为全组件故障上报（组件 +
      // 命令 ID + 原因）——宿主 faultRecord 后经指令对账整组件回收
      this.env.reportFault?.(entry.addonId, 'command-handler', `${commandId}: ${String(err)}`)
    }
    return 'executed'
  }

  /** 命令在场判定（执行前模式校验等消费） */
  commandMode(commandId: string): RuntimeKeybindingOperation['mode'] | undefined {
    const entry = this.commands.get(commandId)
    return entry?.report.mode
  }

  /** 命令是否为写类（router 门控已覆盖；宿主回发入口的模式复核用） */
  commandWrites(commandId: string): boolean | undefined {
    const entry = this.commands.get(commandId)
    return entry === undefined ? undefined : entry.report.writes
  }

  /** 组件命令是否注册在场（menu 挂接 command 的存在性校验等） */
  hasCommand(commandId: string): boolean {
    return this.commands.has(commandId)
  }

  /** 整组件回收（装载器 releaseLoad：停用/故障/卸载）——撤命令、菜单与
   *  运行期表，上报空表；回收在本页闭环 */
  releaseAddon(addonId: string): void {
    let removed = false
    for (const [commandId, entry] of [...this.commands]) {
      if (entry.addonId === addonId) {
        this.commands.delete(commandId)
        removed = true
      }
    }
    const cleanups = this.menuCleanups.get(addonId)
    if (cleanups) {
      for (const dispose of cleanups.splice(0)) {
        dispose()
      }
      this.menuCleanups.delete(addonId)
      removed = true
    }
    if (removed) {
      this.syncRuntimeOperations()
      this.reportOf(addonId)
    }
  }

  /** 当前全部组件命令表（宿主目录形态；观测面） */
  reports(): readonly AddonCommandReport[] {
    return [...this.commands.values()].map((entry) => entry.report)
  }

  /** 运行期操作层同步：本页全部在场命令 → setRuntimeOperations */
  private syncRuntimeOperations(): void {
    const ops: RuntimeKeybindingOperation[] = [...this.commands.values()].map((entry) => ({
      id: entry.report.commandId,
      command: entry.report.commandId,
      titleKey: 'command.find.title',
      titleOverride: entry.report.title,
      addonId: entry.report.addonId,
      mode: entry.report.mode,
      writes: entry.report.writes,
      defaults: [...entry.report.defaults],
    }))
    setRuntimeOperations(ops)
  }

  /** 该组件当前全表上报（空表 = 全撤信号；代次取该组件在场条目——空表
   *  时无从取得，置 0 表示「不携带有效代次」） */
  private reportOf(addonId: string): void {
    const entries = [...this.commands.values()].filter((entry) => entry.addonId === addonId)
    const generation = entries[0]?.generation ?? 0
    this.env.report({ addonId, generation, commands: entries.map((entry) => entry.report) })
  }
}

/** 菜单注册时暴露给组件的执行上下文形状（SDK menus 面的 execute 通道） */
export type AddonMenuExecute = (commandId: string) => void
export type { MenuContextSnapshot }
