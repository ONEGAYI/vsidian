// #541 T01 附加组件粘贴规则宿主服务（vscode 经端口注入，单测友好）。
//
// 职责（票面 / 规格 §4.1、§4.4）：
// - 会话内规则登记簿：按 addonId 维护当前有效规则（注册经 enable 生命
//   周期面乙，身份由平台注入——服务只接受宿主侧调用，作者声明不携带
//   身份字段）；普通拒绝（非法/重复/超预算）不算组件故障；
// - 有效快照：全部组件规则经 orderAddonPasteRules 确定性排序后广播；
//   内容等值不递增版本（等值广播幂等），变化才递增并通知订阅者；
// - 回收：dispose 句柄只移除本批；releaseAddon 撤回整组件（停用/故障/
//   代次结束由 AddonRuntime 的运行生命周期统一驱动）。
// 规则不持久化：注册在宿主运行功能阶段，扩展重启后组件重新 enable 登记。
import {
  countAddonPasteRuleDeclarations,
  orderAddonPasteRules,
  validateAddonPasteRuleDeclarations,
  type AddonPasteRule,
  type AddonPasteRulesRegisterResult,
  type AddonPasteRulesSnapshot,
} from '../../shared/addonPasteRules'

export interface AddonPasteRuleServicePorts {
  log(stage: string, detail: string): void
}

interface AddonBatch {
  addonId: string
  rules: readonly AddonPasteRule[]
  disposed: boolean
}

export class AddonPasteRuleService {
  private readonly byAddon = new Map<string, AddonPasteRule[]>()
  private readonly listeners = new Set<() => void>()
  private lastSnapshot: AddonPasteRulesSnapshot = { version: 0, rules: [] }

  constructor(private readonly ports: AddonPasteRuleServicePorts) {}

  /**
   * 登记一批规则声明（整批校验，不部分安装）。addonId 由调用方（运行
   * 生命周期面乙）注入；返回普通注册结果与释放句柄（重复 dispose 无害）。
   */
  registerRules(addonId: string, declarations: readonly unknown[]): AddonPasteRulesRegisterResult {
    const existing = this.byAddon.get(addonId) ?? []
    const validation = validateAddonPasteRuleDeclarations(declarations, {
      existingIds: new Set(existing.map((rule) => rule.id)),
      // 256 总量按「顶层 + 嵌套子规则合计」跨批计量（PR #564 评审：只数
      // 顶层可被分批登记绕过）；dispose 移除本批、releaseAddon 撤回整组
      // 后存量随之回收，代次更迭不重复计。
      currentCount: countAddonPasteRuleDeclarations(existing),
    })
    if (!validation.ok) {
      this.ports.log('paste-rules-rejected', `${addonId} ${validation.reason}${validation.detail ? `: ${validation.detail}` : ''}`)
      return validation
    }
    const rules: AddonPasteRule[] = validation.rules.map((rule) => ({
      addonId,
      id: rule.id,
      priority: rule.priority,
      match: rule.match,
      output: rule.output,
    }))
    this.byAddon.set(addonId, [...existing, ...rules])
    const batch: AddonBatch = { addonId, rules, disposed: false }
    this.refresh()
    return {
      ok: true,
      dispose: () => {
        if (batch.disposed) return
        batch.disposed = true
        const current = this.byAddon.get(batch.addonId)
        if (!current) return
        const registered = new Set(batch.rules)
        const next = current.filter((rule) => !registered.has(rule))
        if (next.length === 0) this.byAddon.delete(batch.addonId)
        else this.byAddon.set(batch.addonId, next)
        this.refresh()
      },
    }
  }

  /** 撤回整组件规则（停用/故障/代次结束；幂等——无规则时不递增版本） */
  releaseAddon(addonId: string): void {
    if (!this.byAddon.has(addonId)) return
    this.byAddon.delete(addonId)
    this.refresh()
  }

  /** 当前登记规则的组件 ID 集（观测面） */
  addonIds(): readonly string[] {
    return [...this.byAddon.keys()]
  }

  /** 当前有效快照（确定性排序；内容等值时返回旧引用，版本不递增） */
  effectiveSnapshot(): AddonPasteRulesSnapshot {
    const all: AddonPasteRule[] = []
    for (const rules of this.byAddon.values()) all.push(...rules)
    const ordered = orderAddonPasteRules(all)
    if (snapshotKey(ordered) === snapshotKey(this.lastSnapshot.rules)) {
      return this.lastSnapshot
    }
    this.lastSnapshot = { version: this.lastSnapshot.version + 1, rules: ordered }
    return this.lastSnapshot
  }

  /** 快照内容变化并已推进时通知订阅者（wiring 广播有效快照） */
  refresh(): void {
    this.effectiveSnapshot()
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  /** 状态变化订阅（登记/释放；返回退订函数） */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** 内容等值键（规则为纯数据；字段顺序由构造保证稳定） */
function snapshotKey(rules: readonly AddonPasteRule[]): string {
  return JSON.stringify(rules.map((rule) => [rule.addonId, rule.id, rule.priority, rule.match, rule.output]))
}
