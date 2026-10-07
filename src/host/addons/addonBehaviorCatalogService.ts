// T08（#357）附加组件输入行为——宿主侧注册目录服务（行为冲突管理的
// 目录权威，纯逻辑，端口注入）。
//
// 职责（票面「展示必填行为名称和所属组件」的数据源；状态读写归
// addonBehaviorStateService，两者合成 addons.behaviors 载荷下发设置页）：
// - 接受编辑器 webview 的全量对账上报（addon.behaviors.report）：仅
//   runtime runState = enabled 的上报进入目录（停用/故障后的迟到空表
//   不恢复目录——回收权威在宿主 reconcile，与 T10 命令服务同口径）；
//   enabled 的新表整组件替换（撤项与改名如实反映）。
// - 目录是会话内「最后已知注册面」：编辑器面板全部关闭不清目录——
//   设置页仍可管理（组件启停状态与 addons.state 合成呈现）；停用/故障
//   由 wiring 的 runtime.onChanged reconcile 经 releaseAddon 回收。
// - catalog 输出按完整键稳定排序（多组件合表；与默认序同键序，设置页
//   再按用户覆盖排出展示全序）。
// - 变化通知仅在目录内容实际变化后投递（等值重报不打扰——推送节流）。
import type { AddonBehaviorInfo } from '../../shared/addonBehaviors'

export interface AddonBehaviorCatalogPorts {
  /** 组件当前运行态（addonRuntime.runtimeStatus 同源；未注册为 undefined） */
  runStateOf(addonId: string): 'idle' | 'enabled' | 'disabled' | 'faulted' | undefined
  /** 归因日志（忽略与回收留痕） */
  log(stage: string, addonId: string, detail: string): void
}

export class AddonBehaviorCatalogService {
  /** addonId → 该组件当前注册表（上报的序列化形态，防外泄引用） */
  private readonly byAddon = new Map<string, readonly AddonBehaviorInfo[]>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly ports: AddonBehaviorCatalogPorts) {}

  /** 全量对账上报（空表 = 全撤信号）；变化才通知 */
  syncReport(addonId: string, generation: number, behaviors: readonly AddonBehaviorInfo[]): void {
    const runState = this.ports.runStateOf(addonId)
    if (runState !== 'enabled') {
      this.ports.log('behaviors-report-ignored', addonId, `runState=${runState ?? 'unregistered'} generation=${generation}`)
      return
    }
    const snapshot = behaviors.map((entry) => ({ ...entry, examples: entry.examples === undefined ? undefined : [...entry.examples] }))
    const previous = this.byAddon.get(addonId)
    if (previous !== undefined && sameTable(previous, snapshot)) {
      return
    }
    if (snapshot.length === 0) {
      this.byAddon.delete(addonId)
    } else {
      this.byAddon.set(addonId, snapshot)
    }
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  /** 整组件回收（停用/故障/代次释放的 reconcile 执行面）；幂等 */
  releaseAddon(addonId: string): void {
    if (!this.byAddon.delete(addonId)) {
      return
    }
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  /** 目录内组件 ID 清单（reconcile 遍历面） */
  addonIds(): Set<string> {
    return new Set(this.byAddon.keys())
  }

  /** 当前目录（全部在场组件注册行为合表，按完整键稳定排序） */
  catalog(): AddonBehaviorInfo[] {
    const entries: AddonBehaviorInfo[] = []
    for (const table of this.byAddon.values()) {
      entries.push(...table)
    }
    return entries.sort((a, b) => (`${a.addonId}#${a.id}`).localeCompare(`${b.addonId}#${b.id}`))
  }

  /** 目录变化订阅（写入成功后投递）；返回退订 */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

function sameTable(a: readonly AddonBehaviorInfo[], b: readonly AddonBehaviorInfo[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((entry, index) => {
    const other = b[index]!
    return entry.addonId === other.addonId &&
      entry.id === other.id &&
      entry.name === other.name &&
      entry.description === other.description &&
      entry.exclusiveGroup === other.exclusiveGroup &&
      entry.history === other.history &&
      JSON.stringify(entry.examples ?? null) === JSON.stringify(other.examples ?? null)
  })
}
