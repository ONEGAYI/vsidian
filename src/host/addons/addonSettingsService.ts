// #353 T04 附加组件设置服务（宿主侧纯逻辑，持久层经端口注入）。
//
// 职责（票面 #353 / ADR-0012 Q21–Q23 / 规格 5.4/6.2）：
// - 定义注册：按组件 ID 隔离；形状非法/重复 key 整批拒绝；重新注册替换
//   定义集，存储值不重置（覆盖、默认、来源及功能开关普通升级不重置）。
// - 按批校验与保存：补丁逐键校验（未知键/非法值整批拒绝，有效值不落地）
//   → 先写持久层、成功后才更新内存权威并发出变化事件——失败不虚报，
//   内存回滚。无工作区时 workspace 层读写拒绝。
// - 清除工作区覆盖只删该键覆盖（恢复继承用户默认，不是恢复出厂值）。
// - 存储结构冻结 version 1（shared/addonSettings.ts 单一事实源）；构造时
//   从持久层装配，坏形态 fail-safe 回空不写回。
//
// 跨窗口边界（设计决策，1.82.3 API 面核实：Memento 无变更事件）：
// - 同窗口以本服务内存为权威：写入即更新内存并广播 onChanged（组件代码）
//   与设置页推送（wiring 消费）；同窗口内多面板一致由宿主单实例保证。
// - 跨窗口不做实时推送（API 面不可实现）：另一窗口的写入在本窗口不自动
//   可见；本窗口 refreshFromPersistence 重新装配持久层（新窗口构造、
//   或显式对账入口），并发写按最后落盘胜出。
// - 写序串行化：读改写经内部 promise 链排队，本窗口并发 update 不丢键。
//
// 组件私有业务缓存不混入本服务：本服务只管「定义驱动的用户设置」；
// 组件自管数据走其自身通道（channel）。
import {
  isAddonSettingDefinition,
  addonSettingValueMatches,
  resolveAddonSettingLayer,
  serializeAddonSettingsStore,
  parseAddonSettingsStore,
  addonSettingDefault,
  type AddonSettingDefinition,
  type AddonSettingSource,
  type AddonSettingValue,
} from '../../shared/addonSettings'

/** 持久层端口（vscode 层实现：user = globalState / workspace = workspaceState） */
export interface AddonSettingsPersistencePort {
  /** 无工作区判定（workspace 层读写前置检查） */
  readonly hasWorkspace: boolean
  /** 读某层持久原始值（未写过为 undefined） */
  read(scope: 'user' | 'workspace'): unknown
  /** 写整层存储结构；resolve false = 落盘失败（不虚报路径的依据） */
  write(scope: 'user' | 'workspace', value: ReturnType<typeof serializeAddonSettingsStore>): Promise<boolean>
}

/** 归因日志端口（vscode 层接输出通道：组件 ID + 阶段 + 原因） */
export type AddonSettingsLogPort = (stage: string, addonId: string, detail: string) => void

/** update / clearWorkspaceOverride 的结果（失败不虚报） */
export type AddonSettingsUpdateResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-key' | 'invalid-value' | 'no-workspace' | 'store-write-failed'; invalidKeys?: readonly string[] }

/** 变化事件载荷（只在持久化成功后发出） */
export interface AddonSettingsChange {
  readonly addonId: string
  readonly scope: 'user' | 'workspace'
  readonly keys: readonly string[]
}

/** 生效快照（设置页载荷与组件 settings.get() 的共同数据源） */
export interface AddonSettingsEffectiveSnapshot {
  /** 定义键 → 生效值（定义未注册时为空对象） */
  readonly values: Readonly<Record<string, AddonSettingValue>>
  /** 定义键 → 生效来源 */
  readonly sources: Readonly<Record<string, AddonSettingSource>>
  /** 用户默认层显式值（含定义外遗留键——存储原样，不删除） */
  readonly userValues: Readonly<Record<string, AddonSettingValue>>
  /** 工作区层显式值；null = 无工作区 */
  readonly workspaceValues: Readonly<Record<string, AddonSettingValue>> | null
  readonly hasWorkspace: boolean
}

/** 层内存快照（内部） */
interface LayerState {
  values: Record<string, Record<string, AddonSettingValue>>
}

export class AddonSettingsService {
  /** 组件 ID → 定义表（注册序保留；重新注册整体替换） */
  private readonly definitions = new Map<string, readonly AddonSettingDefinition[]>()
  private readonly user: LayerState
  private readonly workspace: LayerState
  private readonly listeners = new Set<(change: AddonSettingsChange) => void>()
  /** 写序串行化队列（读改写不交错） */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly ports: AddonSettingsPersistencePort,
    private readonly log: AddonSettingsLogPort = () => {},
  ) {
    this.user = { values: parseAddonSettingsStore(ports.read('user')) ?? {} }
    this.workspace = ports.hasWorkspace ? { values: parseAddonSettingsStore(ports.read('workspace')) ?? {} } : { values: {} }
  }

  // ---- 定义注册 ----

  /**
   * 注册定义批（setup 生命周期调用）。批内任一形状非法或 key 重复（批内
   * 或与既有）整批拒绝；同一 setup 代次内的多次调用按追加处理（键冲突
   * 拒绝）。新代次 setup 重跑前由 runtime 调 clearDefinitions 清空该组件
   * 定义集（普通升级语义——存储值不动，定义消失的键暂不呈现、存储保留）。
   */
  registerDefinitions(addonId: string, defs: readonly unknown[]): { ok: true } | { ok: false; reason: 'invalid-definitions'; detail?: string } {
    const seen = new Set<string>(this.definitions.get(addonId)?.map((def) => def.key) ?? [])
    for (const def of defs) {
      if (!isAddonSettingDefinition(def)) {
        this.log('definitions-rejected', addonId, `invalid shape: ${safeKeyOf(def)}`)
        return { ok: false, reason: 'invalid-definitions', detail: `invalid shape: ${safeKeyOf(def)}` }
      }
      if (seen.has(def.key)) {
        this.log('definitions-rejected', addonId, `duplicate key: ${def.key}`)
        return { ok: false, reason: 'invalid-definitions', detail: `duplicate key: ${def.key}` }
      }
      seen.add(def.key)
    }
    this.definitions.set(addonId, [...(this.definitions.get(addonId) ?? []), ...(defs as readonly AddonSettingDefinition[])])
    return { ok: true }
  }

  /** 清空某组件定义集（新 setup 代次重跑前调用；存储值不动） */
  clearDefinitions(addonId: string): void {
    this.definitions.delete(addonId)
  }

  definitionsOf(addonId: string): readonly AddonSettingDefinition[] {
    return this.definitions.get(addonId) ?? []
  }

  hasDefinitions(addonId: string): boolean {
    return (this.definitions.get(addonId)?.length ?? 0) > 0
  }

  // ---- 读取 ----

  /** 生效快照：定义键的生效值与来源 + 两层显式值（供 UI 与组件 API） */
  effectiveSnapshot(addonId: string): AddonSettingsEffectiveSnapshot {
    const values: Record<string, AddonSettingValue> = {}
    const sources: Record<string, AddonSettingSource> = {}
    for (const def of this.definitionsOf(addonId)) {
      const resolved = resolveAddonSettingLayer(def, this.user.values[addonId]?.[def.key], this.workspaceLayerValues(addonId)[def.key])
      values[def.key] = resolved.value
      sources[def.key] = resolved.source
    }
    return {
      values,
      sources,
      userValues: { ...this.user.values[addonId] ?? {} },
      workspaceValues: this.ports.hasWorkspace ? { ...this.workspaceLayerValues(addonId) } : null,
      hasWorkspace: this.ports.hasWorkspace,
    }
  }

  /** 单键来源（组件 settings.getSource；未定义键为 undefined） */
  sourceOf(addonId: string, key: string): AddonSettingSource | undefined {
    const def = this.definitionsOf(addonId).find((entry) => entry.key === key)
    if (!def) return undefined
    return resolveAddonSettingLayer(def, this.user.values[addonId]?.[def.key], this.workspaceLayerValues(addonId)[def.key]).source
  }

  // ---- 写入（按批原子 + 持久化成功后才生效/发事件） ----

  /** 写入某层补丁（批内任一键非法整批拒绝） */
  update(addonId: string, scope: 'user' | 'workspace', patch: Record<string, unknown>): Promise<AddonSettingsUpdateResult> {
    return this.enqueue(async () => {
      if (scope === 'workspace' && !this.ports.hasWorkspace) {
        return { ok: false, reason: 'no-workspace' } as const
      }
      const defs = this.definitions.get(addonId)
      const invalidKeys: string[] = []
      let unknown = false
      for (const [key, value] of Object.entries(patch)) {
        const def = defs?.find((entry) => entry.key === key)
        if (!def) {
          unknown = true
          invalidKeys.push(key)
        } else if (!addonSettingValueMatches(def, value)) {
          invalidKeys.push(key)
        }
      }
      if (unknown) {
        return { ok: false, reason: 'unknown-key', invalidKeys } as const
      }
      if (invalidKeys.length > 0) {
        return { ok: false, reason: 'invalid-value', invalidKeys } as const
      }
      return this.persistLayer(addonId, scope, (layer) => {
        for (const [key, value] of Object.entries(patch)) {
          layer[key] = value as AddonSettingValue
        }
        return Object.keys(patch)
      })
    })
  }

  /** 清除工作区对某键的覆盖（恢复继承用户默认；幂等，无覆盖也成功） */
  clearWorkspaceOverride(addonId: string, key: string): Promise<AddonSettingsUpdateResult> {
    return this.enqueue(async () => {
      if (!this.ports.hasWorkspace) {
        return { ok: false, reason: 'no-workspace' } as const
      }
      const defs = this.definitions.get(addonId)
      if (!defs?.some((entry) => entry.key === key)) {
        return { ok: false, reason: 'unknown-key', invalidKeys: [key] } as const
      }
      if (this.workspaceLayerValues(addonId)[key] === undefined) {
        // 无覆盖：语义上已继承（幂等成功，不产生落盘与事件）
        return { ok: true } as const
      }
      return this.persistLayer(addonId, 'workspace', (layer) => {
        delete layer[key]
        return [key]
      })
    })
  }

  /** 变化订阅（只在持久化成功后投递）；返回退订 */
  onChanged(listener: (change: AddonSettingsChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 从持久层重新装配内存权威（构造等价）：新窗口对账入口。同窗口内存
   * 未落盘的在途写不受伤（写入队列串行，调用方经 enqueue 等待后再刷新）。
   */
  refreshFromPersistence(): void {
    this.user.values = parseAddonSettingsStore(this.ports.read('user')) ?? {}
    this.workspace.values = this.ports.hasWorkspace ? (parseAddonSettingsStore(this.ports.read('workspace')) ?? {}) : {}
  }

  // ---- 内部 ----

  private workspaceLayerValues(addonId: string): Record<string, AddonSettingValue> {
    return this.ports.hasWorkspace ? this.workspace.values[addonId] ?? {} : {}
  }

  /** 层写入公共路径：内存改 → 落盘 → 成功才保留内存并广播；失败回滚 */
  private async persistLayer(
    addonId: string,
    scope: 'user' | 'workspace',
    mutate: (layer: Record<string, AddonSettingValue>) => readonly string[],
  ): Promise<AddonSettingsUpdateResult> {
    const layerState = scope === 'user' ? this.user : this.workspace
    const previous = layerState.values[addonId]
    const nextLayer = { ...previous }
    const keys = mutate(nextLayer)
    layerState.values[addonId] = nextLayer
    const written = await this.ports.write(scope, serializeAddonSettingsStore(layerState.values))
    if (!written) {
      // 落盘失败：内存权威回滚（不虚报成功，事件不发）
      if (previous === undefined) {
        delete layerState.values[addonId]
      } else {
        layerState.values[addonId] = previous
      }
      this.log('store-write-failed', addonId, `scope=${scope} keys=[${keys.join(',')}]`)
      return { ok: false, reason: 'store-write-failed' }
    }
    const change: AddonSettingsChange = { addonId, scope, keys }
    for (const listener of [...this.listeners]) {
      listener(change)
    }
    return { ok: true }
  }

  /** 操作串行化（读改写不交错；异常不断链） */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => {})
    return next
  }
}

function safeKeyOf(def: unknown): string {
  if (typeof def === 'object' && def !== null && 'key' in def) {
    const key = (def as { key?: unknown }).key
    return typeof key === 'string' ? key : '<non-string-key>'
  }
  return '<non-object>'
}

/** 出厂值快照辅助（设置页「恢复出厂」不做——此导出仅供测试与观测对齐默认值） */
export function addonSettingsDefaults(addonId: string, defs: readonly AddonSettingDefinition[]): Record<string, AddonSettingValue> {
  const values: Record<string, AddonSettingValue> = {}
  for (const def of defs) {
    values[def.key] = addonSettingDefault(def)
  }
  return values
}
