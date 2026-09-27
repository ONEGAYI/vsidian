// CSS 片段 <link> 装配器（#128）：按宿主下发的有序清单在 document.head
// 装配片段样式表。只操作 <link> 元素——不触碰 CM6 状态与正文 DOM，输入、
// 选区、撤销与模式切换天然不受影响；样式与虚拟化正交（文档级样式表，阅读
// 侧重挂载的新块天然继承）。
//
// 关键语义（验收）：
// - 后者覆盖：宿主按确定性文件名顺序下发，settled 链按该顺序在 DOM 中
//   排列（同等层叠优先级后加载者优先）。
// - 失败保留最近成功样式：热替换走「先装新链、加载成功后再摘旧链」——
//   新链 load 前旧链持续生效；load 失败只移除失败的新链并回报，旧链保留。
// - 明确停用/删除立即撤下（不在清单即摘链）。
// - 幂等：同版本同 URI 不重装（无闪烁、无重复请求）。
import type { SnippetLinkList } from '../shared/cssSnippets'

/** 片段链元素标记（data 属性承载片段名；测试与诊断的观测位） */
export const SNIPPET_LINK_ATTR = 'data-vsidian-snippet'

/** 单片段装载结果（回报告宿主：入口级加载成败可观测；version 为触发装
 *  载的入口级版本 #129——清单条目缺省 v 时回退列表版本） */
export interface SnippetLoadOutcome {
  name: string
  version: number
  ok: boolean
}

interface SnippetSlot {
  /** 已生效链（最近一次成功加载） */
  settled?: HTMLLinkElement
  /** 加载中链（成功后晋升 settled，失败移除） */
  pending?: HTMLLinkElement
}

/** 装载观测（测试与诊断） */
export interface SnippetSlotInfo {
  name: string
  href: string
  state: 'pending' | 'settled'
}

export class SnippetLoader {
  private readonly slots = new Map<string, SnippetSlot>()
  /** 最近一次 apply 的期望顺序（settled 链按此重排） */
  private order: string[] = []

  /**
   * 应用装载清单（全量 diff）：
   * 1. 不在清单的片段立即摘链（停用/删除撤下）；
   * 2. 清单内片段：settled 已在该 URI 则跳过（幂等），否则挂新链加载，
   *    成功后摘旧链晋升（无样式空窗），失败移除并回报（旧链保留）；
   * 3. settled 链按清单顺序重排（DOM 内移动已加载元素不重新取资源）。
   */
  apply(list: SnippetLinkList, onOutcome?: (outcome: SnippetLoadOutcome) => void): void {
    const desired = new Map(list.snippets.map((item) => [item.name, item.uri]))
    // #129 入口级版本（装载回报关联键）：条目显式 v 优先，缺省回退列表版本
    const itemVersions = new Map(list.snippets.map((item) => [item.name, item.v ?? list.version]))
    this.order = list.snippets.map((item) => item.name)
    // 1. 摘除不再需要的
    for (const [name, slot] of [...this.slots]) {
      if (!desired.has(name)) {
        slot.pending?.remove()
        slot.settled?.remove()
        this.slots.delete(name)
      }
    }
    // 2. 装配与热替换
    for (const { name, uri } of list.snippets) {
      const itemVersion = itemVersions.get(name) ?? list.version
      let slot = this.slots.get(name)
      if (!slot) {
        slot = {}
        this.slots.set(name, slot)
      }
      // 旧 pending 被更新的装载请求取代（陈旧结果不再晋升）
      if (slot.pending) {
        slot.pending.remove()
        slot.pending = undefined
      }
      if (slot.settled?.getAttribute('href') === uri) {
        continue
      }
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.setAttribute('href', uri)
      link.setAttribute(SNIPPET_LINK_ATTR, name)
      const settle = (ok: boolean): void => {
        const current = this.slots.get(name)
        if (!current) {
          // 片段已被摘除：本链不再生效
          link.remove()
          return
        }
        if (current.settled === link) {
          return // 已晋升后重复到达的 load（幂等，不误摘生效链）
        }
        if (current.pending !== link) {
          // 被更新的装载请求取代：陈旧结果丢弃
          link.remove()
          return
        }
        current.pending = undefined
        if (ok) {
          current.settled?.remove()
          current.settled = link
          this.reorder()
        } else {
          link.remove()
          // 失败保留最近成功样式：settled 原样保留
        }
        onOutcome?.({ name, version: itemVersion, ok })
      }
      link.addEventListener('load', () => settle(true))
      link.addEventListener('error', () => settle(false))
      document.head.append(link)
      slot.pending = link
    }
    // 3. 稳态顺序（等待晋升的 pending 自带最新 DOM 位次，不参与重排）
    this.reorder()
  }

  /** 摘除全部片段链（面板卸载/观测用） */
  clear(): void {
    for (const slot of this.slots.values()) {
      slot.pending?.remove()
      slot.settled?.remove()
    }
    this.slots.clear()
    this.order = []
  }

  /** 当前装载状态（测试与诊断观测面） */
  describe(): SnippetSlotInfo[] {
    const out: SnippetSlotInfo[] = []
    for (const name of this.order) {
      const slot = this.slots.get(name)
      if (!slot) {
        continue
      }
      if (slot.settled) {
        out.push({ name, href: slot.settled.getAttribute('href') ?? '', state: 'settled' })
      }
      if (slot.pending) {
        out.push({ name, href: slot.pending.getAttribute('href') ?? '', state: 'pending' })
      }
    }
    return out
  }

  /** 已生效（settled）片段名，按装载顺序 */
  loadedNames(): string[] {
    return this.order.filter((name) => this.slots.get(name)?.settled !== undefined)
  }

  /** settled 链按最近 apply 的清单顺序重排（DOM 移动不重新取资源） */
  private reorder(): void {
    for (const name of this.order) {
      const el = this.slots.get(name)?.settled
      if (el) {
        document.head.append(el)
      }
    }
  }
}
