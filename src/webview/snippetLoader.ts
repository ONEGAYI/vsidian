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

/** 链的 sheet 三态（#129 error 事件分流判定，见 apply 内注释）：
 *  - none：无 sheet 或可读空表（未装载/入口级失败）
 *  - rules：可读且规则数 > 0（部分内容已生效）
 *  - opaque：跨源不可读（读 cssRules 抛异常） */
type LinkSheetState = 'none' | 'rules' | 'opaque'

function sheetStateOf(link: HTMLLinkElement): LinkSheetState {
  try {
    if (link.sheet === null) {
      return 'none'
    }
    return link.sheet.cssRules.length > 0 ? 'rules' : 'none'
  } catch {
    return 'opaque'
  }
}

/** 链是否已被浏览器实际解析（#129 pending 晋升判定：非空 sheet 且规则数>0） */
function sheetApplied(link: HTMLLinkElement): boolean {
  return sheetStateOf(link) === 'rules'
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
      // 旧 pending 被更新的装载请求取代（陈旧结果不再晋升）。例外
      //（#129）：事件未到达（Chromium 对个别子资源失败形态不触发任何
      // link 事件）但浏览器已解析出非空 sheet 且 URI 未变——该链实际已
      // 生效，直接晋升，避免下一次同清单 apply 把生效样式摘掉
      if (slot.pending) {
        if (!slot.settled && slot.pending.getAttribute('href') === uri && sheetApplied(slot.pending)) {
          slot.settled = slot.pending
        } else {
          slot.pending.remove()
        }
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
        // #129 嵌套导入失败口径（Chromium 实测留证 test/browser/
        // cssSnippetImports.mjs 与探针日志）：@import 子资源失败会对
        // <link> 触发 error，但 sheet 本身已解析、其余规则正在生效。
        // error 事件按 sheet 三态分流：
        // - rules：sheet 可读且规则数 > 0 → 部分内容已生效，按「已装载
        //   （降级）」晋升并回报 ok:true——缺失导入不整份回滚（浏览器逐
        //   规则容错的既有承诺；生产 webview 片段链与页面同源，cssRules
        //   可读，命中此态）
        // - opaque：sheet 存在但跨源不可读（测试环境 http 形态）→ 保留
        //   该链（浏览器正在应用其能解析的部分），回报 ok:false（能确认
        //   的状态：有失败，不虚构定位）
        // - none：无 sheet 或可读空表（入口 404/CSP 拦截）→ 移除失败链，
        //   settled 原样保留（#128 失败保留最近成功样式）
        const sheetState = sheetStateOf(link)
        const applied = ok || sheetState === 'rules'
        if (applied) {
          current.settled?.remove()
          current.settled = link
          this.reorder()
        } else if (sheetState === 'none') {
          link.remove()
          // 失败保留最近成功样式：settled 原样保留
        } else {
          // opaque：链保留为已失败但浏览器或仍在应用其可解析部分；不
          // 晋升（不可证），也不移除（避免误撤生效规则）
          current.pending = link
        }
        onOutcome?.({ name, version: itemVersion, ok: applied })
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
