// #570（T05）HTML 资源的 DOM 装配（净化产物 → DOM 的后置管线，两端
// 共用一份）：Reading 块挂载钩（A 主文档 / 嵌入 B/C 的 mountRefContentBlock）
// 与 Live 块级/行内 widget 的 toDOM 都经本入口装配——「解析与净化的共享
// 规则只维护一份」（规格工程接缝表）。
//
// 处理矩阵（语法事实源 src/shared/htmlResource.ts）：
// - img[src]：绑所属视图的 ImageResourceManager（既有 #10 语义——src 剥离
//   等宿主解析；live 形态开 sweep 兜底）。
// - img[source] 的 srcset：先剥离（防浏览器在解析完成前选用 webview
//   origin 下的坏相对候选），原文记忆于 data-vsidian-srcset；逐候选按
//   真实语法解析（不是单字符串），全部落定后按描述符重组回写。有 srcset
//   时管理器绑定**首个候选**（浏览器从 srcset 选用时 src 仅回退）。
// - picture 内 source[srcset]：同 srcset 管线。
// - video/audio 的 src、video 的 poster、video/audio 内 source[src]：
//   相对目标先剥离（#571/T06 起媒体装载放行——保留原文会先向 webview
//   origin 发坏相对请求再被改写覆盖；img/srcset 同纪律），原文记忆于
//   data-vsidian-media-*；解析成功改写为绝对地址，失败恢复原文（T05
//   失败语义——最终 DOM 与源文一致，不编造地址）。
// - a[href]：**不改写**——导航归 Reading 点击委托/宿主 linkTarget 分类
//   （单一权威），Live 侧点击显形优先（mousedown 拦截器 + click 防默认
//   导航在 widget 装配层）。
// - 失败语义：失败候选/属性保持原文（浏览器按原生语义回退/失败，不编造
//   地址）；危险协议在净化层已拒，本层不越权。
//
// 生命周期：返回 binding（dispose 退订全部订阅并**释放子树媒体**——
// #571/T06：pause + 断流，DOM 移除不自动暂停；退订后迟到结果不回写，
// 「视图释放后无迟到结果污染」）；幂等标记防同根重复装配；模块级登记表
// 供 sweep（Live widget DOM 离场兜底——挂在 liveLinks 的 sweep 调用点）。
import { ImageResourceManager } from './imageResource'
import { releaseHtmlMedia } from './htmlInteract'
import {
  buildSrcsetValue,
  needsDocumentBaseResolution,
  parseSrcsetCandidates,
} from '../shared/htmlResource'
import { subscribeHtmlResource, type HtmlResourceOutcome, type HtmlResourceSubscribe } from './htmlResourceHub'

export type { HtmlResourceOutcome, HtmlResourceSubscribe } from './htmlResourceHub'

/** srcset 原文记忆属性（装配期携带；重组应用后清除） */
const SRCSET_MEMO_ATTR = 'data-vsidian-srcset'

/** 装配幂等标记（同根二次 prepare 不重复剥离/订阅） */
const PREPARED_ATTR = 'data-vsidian-html-res'

export interface HtmlResourceMountDeps {
  /** 所属视图的图片管理器（A 面板 / B 实例——身份随视图成立）；null = 无绑定 */
  images: ImageResourceManager | null
  /** 属性 URL 解析订阅端口；缺省走模块 hub（subscribeHtmlResource） */
  subscribe?: HtmlResourceSubscribe
  /** 来源文档（嵌入/悬停 B/C 的 fsPath；缺省 = 面板自身文档 A） */
  sourceDocUri?: string
  /** Live widget 形态：img 槽位开 sweep 兜底清理 */
  live?: boolean
}

export interface HtmlResourceBinding {
  /** 退订全部订阅（块卸载/视图释放）——退订后迟到结果不回写 */
  dispose(): void
  /** 兜底清理：owner 元素已脱离文档的订阅整体退订（Live widget 离场） */
  sweep(): void
}

/** 模块级登记表（sweep 消费；dispose 自移除） */
const activeBindings = new Set<{ dispose(): void; sweep(): void }>()

/** 根元素 → binding（unmount 钩子显式释放用） */
const bindingsByRoot = new Map<HTMLElement, { dispose(): void; sweep(): void }>()

/**
 * 装配一个 DOM 子树的 HTML 资源（幂等——同根重复调用零动作）。root 为
 * Reading 块元素或 Live widget 的内容容器（净化产物挂载后的后置管线）。
 */
export function prepareHtmlResources(root: HTMLElement, deps: HtmlResourceMountDeps): HtmlResourceBinding {
  if (root.hasAttribute(PREPARED_ATTR)) {
    return { dispose: () => undefined, sweep: () => undefined }
  }
  root.setAttribute(PREPARED_ATTR, '1')
  const subscribe = deps.subscribe ?? subscribeHtmlResource
  const sourceDocUri = deps.sourceDocUri
  const unsubscribers: Array<() => void> = []
  const owners: HTMLElement[] = [root]
  let disposed = false

  const track = (unsub: () => void): void => {
    unsubscribers.push(unsub)
  }
  /** 迟到守卫包装：binding 已 dispose 则丢弃结果 */
  const guard = (apply: (o: HtmlResourceOutcome) => void) => (o: HtmlResourceOutcome) => {
    if (disposed) {
      return
    }
    apply(o)
  }

  // ---- srcset 管线（img 与 picture source）----
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('img[srcset], source[srcset]'))) {
    const raw = el.getAttribute('srcset') ?? ''
    el.removeAttribute('srcset')
    const candidates = parseSrcsetCandidates(raw)
    if (candidates.length === 0) {
      // 无合法候选：恢复原文（保持作者原意，浏览器自行处置）
      el.setAttribute('srcset', raw)
      continue
    }
    el.setAttribute(SRCSET_MEMO_ATTR, raw)
    owners.push(el)
    const settled: Array<string | null> = candidates.map(() => null)
    let pending = 0
    const applyIfSettled = (): void => {
      if (pending > 0) {
        return
      }
      const value = buildSrcsetValue(candidates.map((c, i) => ({
        url: settled[i] ?? c.url, // 失败候选保持原 URL（不编造地址）
        descriptor: c.descriptor,
      })))
      el.setAttribute('srcset', value)
      el.removeAttribute(SRCSET_MEMO_ATTR)
    }
    candidates.forEach((candidate, index) => {
      if (!needsDocumentBaseResolution(candidate.url)) {
        settled[index] = candidate.url
        return
      }
      pending += 1
      track(subscribe(candidate.url, guard((o) => {
        settled[index] = o.ok ? o.url : null
        pending -= 1
        applyIfSettled()
      }), sourceDocUri))
    })
    if (pending === 0) {
      applyIfSettled() // 全直连候选：同步应用
    }
  }

  // ---- img 管理器绑定（src 剥离 + 状态机；srcset 在场时绑定首个候选）----
  if (deps.images) {
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const srcsetRaw = img.getAttribute(SRCSET_MEMO_ATTR) ?? img.getAttribute('srcset')
      const candidates = srcsetRaw !== null ? parseSrcsetCandidates(srcsetRaw) : []
      const logicalSrc = candidates.length > 0
        ? candidates[0]!.url
        : img.getAttribute('src') ?? ''
      if (logicalSrc === '' && img.getAttribute('src') === null) {
        // 无任何图源语义：交给既有 prepareReadingImages 同款口径（空串绑定）
      }
      img.removeAttribute('src')
      deps.images.attach(img, logicalSrc, undefined, deps.live === true ? { sweepOnDisconnect: true } : undefined)
    }
  } else {
    for (const img of Array.from(root.querySelectorAll('img'))) {
      // 无管理器（测试直驱/裸视图）：仍剥 src 防坏相对候选请求噪声，
      // 原文记忆于既有 dataset 口径（回挂管理器时 attach 自行读取）
      const raw = img.getAttribute('src')
      if (raw !== null) {
        img.dataset['vsidianImgSrc'] = raw
        img.removeAttribute('src')
      }
    }
  }

  // ---- 媒体属性管线（video/audio src、poster、source[src]；#571/T06 装载语义）----
  const mediaTargets: Array<[string, string]> = [
    ['video[src]', 'src'],
    ['video[poster]', 'poster'],
    ['audio[src]', 'src'],
    ['source[src]', 'src'],
  ]
  for (const [selector, attr] of mediaTargets) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      const raw = el.getAttribute(attr)
      if (raw === null || !needsDocumentBaseResolution(raw)) {
        continue // 直连/无目标语义：保持原属性
      }
      // 相对目标先剥离（防 webview origin 坏相对请求——#571 起媒体装载
      // 放行，img/srcset 同纪律）；原文记忆 dataset，失败恢复原文
      el.removeAttribute(attr)
      const memoKey = `vsidianMedia${attr === 'poster' ? 'Poster' : 'Src'}`
      el.dataset[memoKey] = raw
      owners.push(el)
      track(subscribe(raw, guard((o) => {
        delete el.dataset[memoKey]
        if (o.ok) {
          el.setAttribute(attr, o.url)
        } else {
          el.setAttribute(attr, raw) // 失败恢复原文（真实失败按原生语义呈现）
        }
      }), sourceDocUri))
    }
  }

  const binding: HtmlResourceBinding = {
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      for (const unsub of unsubscribers) {
        unsub()
      }
      unsubscribers.length = 0
      // #571（T06）释放即停：子树媒体 pause + 断流（DOM 移除不自动暂停）
      releaseHtmlMedia(root)
      activeBindings.delete(binding)
      bindingsByRoot.delete(root)
    },
    sweep(): void {
      if (disposed) {
        return
      }
      if (owners.some((el) => el.isConnected)) {
        return
      }
      binding.dispose()
    },
  }
  activeBindings.add(binding)
  bindingsByRoot.set(root, binding)
  return binding
}

/** 根元素（块/内容容器）离场时显式释放其装配 binding（Reading 卸载钩） */
export function disposeHtmlResourcesOf(root: HTMLElement): void {
  bindingsByRoot.get(root)?.dispose()
}

/** 模块级兜底：owner 元素全部脱离文档的 binding 整体退订（Live widget 离场） */
export function sweepHtmlResourceBindings(): void {
  for (const binding of [...activeBindings]) {
    binding.sweep()
  }
}
