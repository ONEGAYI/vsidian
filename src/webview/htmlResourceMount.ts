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
// - #573（T08）SVG image/use 的 href 与旧 xlink:href 两形态：# 片段引用
//   归下方 ID 作用域管线；相对路径沿 T05 媒体同款订阅改写（xlink 命名
//   空间保形——setAttributeNS）；真 scheme 保持原文（外部 use 引用
//   Chromium 已禁用，浏览器原生失败如实呈现）。
// - #572（T07）iframe[src]：相对路径沿同款订阅改写为解析地址（本地可控
//   页面）；srcdoc 在场跳过（内容非资源引用 + 浏览器忽略 src）；https
//   直连不改写（sandbox 已在净化层按形态强制）。
// - #576 评审 P2-4 style 属性：值是 CSS 声明列表——url() 产按 CSS 词法
//   扫描（引号形态同产），相对目标沿媒体同款订阅改写（成功重装为解析
//   地址、失败保持原文）；片段 url(#id) 归 ID 作用域管线。
// - a[href]：**不改写**（导航归 Reading 点击委托/宿主 linkTarget 分类
//   ——单一权威，Live 侧点击显形优先）；唯一例外是 B 域内 `#frag` 锚点
//   经 ID 作用域前缀化（锚点归属 B——不伪造宿主 A 的锚跳目标）。
// - 失败语义：失败候选/属性保持原文（浏览器按原生语义回退/失败，不编造
//   地址）；危险协议在净化层已拒，本层不越权。
//
// #573（T08）ID 文档作用域（applyHtmlIdScope，经本咽喉接线）：引用文档
// （B/C——deps.docScope 携带 docScope 键）渲染产物的内部 id 与片段引用
// （url(#id)/href="#id"）统一加 scope 前缀——主文档与引用文档相同 ID 不
// 串目标；主文档（'doc'/缺省）零改写（HTML 原生全局 ID 语义）。CSS 侧
// 协同（#id 选择器与 url(#id) 声明）在 docStyle 改写器按同前缀代换。
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
  rewriteCssUrls,
  scanCssUrls,
} from '../shared/htmlResource'
import { htmlIdScopePrefix, rewriteHrefFragmentValue, scopeCssFragmentRefs } from '../shared/htmlFragment'
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
  /** #573（T08）文档身份键（嵌入/悬停 B/C 的 docScope）：ID 文档作用域
   *  的作用对象；缺省/'doc'（主文档 A）零改写 */
  docScope?: string | null
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

const XLINK_NS = 'http://www.w3.org/1999/xlink'

/**
 * #573（T08）ID 文档作用域（B/C 单侧前缀化，模块头注释）：产物内全部
 * id 加 scope 前缀。引用改写按属性语法分派（#576 评审 P2）：href/
 * xlink:href 是 URI 值语法——整值 `#frag` 前缀化；style 与 SVG paint
 * 属性（fill、stroke、clip、mask、marker 前缀族与 filter）是 CSS 值语法——只改
 * `url(#id)` 产（引号保形，词法复用 scanCssUrls），整值 `#rrggbb` 是
 * 颜色零动作。xlink 命名空间保形（setAttributeNS）。主文档前缀为 null
 * 时零动作。同步纯 DOM 变换（无订阅、无生命周期——幂等由 PREPARED_ATTR
 * 咽喉挡重复）。
 */
function applyHtmlIdScope(root: HTMLElement, docScope: string | null | undefined): void {
  const prefix = htmlIdScopePrefix(docScope)
  if (prefix === null) {
    return
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[id]'))) {
    const id = el.getAttribute('id')
    if (id !== null && id !== '') {
      el.setAttribute('id', prefix + id)
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    for (const attr of [...el.attributes]) {
      const value = attr.value
      if (!value.includes('#')) {
        continue
      }
      if (attr.name === 'xlink:href' && attr.namespaceURI === XLINK_NS) {
        // namespaced xlink：保形改写（qualified name 带前缀）
        el.setAttributeNS(XLINK_NS, 'xlink:href', rewriteHrefFragmentValue(value, prefix))
        continue
      }
      if (attr.name === 'href') {
        el.setAttribute('href', rewriteHrefFragmentValue(value, prefix))
        continue
      }
      if (attr.name === 'style' || attr.name.startsWith('fill') ||
        attr.name.startsWith('stroke') || attr.name.startsWith('clip') || attr.name.startsWith('mask') ||
        attr.name.startsWith('marker') || attr.name === 'filter') {
        el.setAttribute(attr.name, scopeCssFragmentRefs(value, prefix))
      }
    }
  }
}

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

  // ---- #573（T08）ID 文档作用域（B/C 单侧前缀化，先于资源订阅——
  // href="#id" 已前缀化后不再命中下方相对路径订阅）----
  applyHtmlIdScope(root, deps.docScope)

  // ---- #576 评审 P2-4：style 属性的相对 URL（CSS URL 语法面）----
  // style 属性值是 CSS 声明列表：url() 产按 CSS 词法扫描（引号形态同
  // 产，非单字符串拆分），相对目标接入与媒体同款的订阅管线；全部落定
  // 后以**装配时刻属性值**为基底重装（成功者替换为解析地址、失败者保持
  // 原文——不编造地址），片段 url(#id) 已由上方 ID 作用域改写（base 取
  // 改写后值，重装不冲掉前缀）；直连 URL 与无产属性零动作。hub 订阅持
  // 续活跃：资源失效经同一 listener 重取再回调（重装幂等）。
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    const base = el.getAttribute('style') ?? ''
    const raws = new Set(
      scanCssUrls(base)
        .filter((t) => t.url !== '' && needsDocumentBaseResolution(t.url))
        .map((t) => t.url),
    )
    if (raws.size === 0) {
      continue
    }
    owners.push(el)
    const resolved = new Map<string, string>()
    let pending = 0
    const apply = (): void => {
      if (pending > 0) {
        return
      }
      el.setAttribute('style', rewriteCssUrls(base, (t) => {
        const hit = resolved.get(t.url)
        if (hit === undefined) {
          return null // 失败/未解析：保持原文
        }
        // 重装为引号形态（解析地址可能含 '?' 等——引号形态最稳）
        return t.form === 'import-string' ? `"${hit}"` : `url("${hit}")`
      }))
    }
    for (const raw of raws) {
      pending += 1
      track(subscribe(raw, guard((o) => {
        if (o.ok) {
          resolved.set(raw, o.url)
        } else {
          // #576 二轮复审 P2：失效后重取失败——丢弃旧代映射回退装配原值
          //（资源失效语义：不保留旧地址，最终 DOM 与源文一致）
          resolved.delete(raw)
        }
        pending -= 1
        apply()
      }), sourceDocUri))
    }
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
    // #573（T08）SVG 引用元素：href 与旧 xlink:href 两形态（转义冒号的
    // 属性选择器按 qualified name 命中 namespaced 属性——jsdom/浏览器
    // 实测一致）；# 片段已被上方 ID 作用域管线前缀化（needs 判定对前缀
    // 后的 # 开头值仍返回 false，天然不进订阅）
    ['image[href]', 'href'],
    ['image[xlink\\:href]', 'xlink:href'],
    ['use[href]', 'href'],
    ['use[xlink\\:href]', 'xlink:href'],
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
          // xlink 命名空间保形：setAttribute 按 qualified name 挂无命名
          // 空间副本（浏览器 SVG 属性读取虽兼容，但序列化会产双属性）
          if (attr === 'xlink:href') {
            el.setAttributeNS(XLINK_NS, 'xlink:href', o.url)
          } else {
            el.setAttribute(attr, o.url)
          }
        } else {
          // 失败恢复原文（真实失败按原生语义呈现；xlink 保形同理）
          if (attr === 'xlink:href') {
            el.setAttributeNS(XLINK_NS, 'xlink:href', raw)
          } else {
            el.setAttribute(attr, raw)
          }
        }
      }), sourceDocUri))
    }
  }

  // ---- #572（T07）iframe src 归属（本地可控页面）----
  // 同媒体管线语义：保留原属性、成功解析后改写为绝对地址（本地 .html 经
  // classifyImageTarget + asWebviewUri——与 img/font 同一信任面；装载由
  // frame-src 的 cspSource 源表达式放行）。srcdoc 在场跳过：内容不是资源
  // 引用，且浏览器按规范忽略 src（解析它纯属浪费请求）。
  for (const frame of Array.from(root.querySelectorAll<HTMLElement>('iframe[src]'))) {
    if (frame.hasAttribute('srcdoc')) {
      continue
    }
    const raw = frame.getAttribute('src')
    if (raw === null || !needsDocumentBaseResolution(raw)) {
      continue // https 直连远端帧：sandbox 已在净化层给 allow-scripts
    }
    owners.push(frame)
    track(subscribe(raw, guard((o) => {
      if (o.ok) {
        frame.setAttribute('src', o.url)
      }
      // 失败：保持原文（无效地址矩阵——相对地址在 webview origin 下按原生
      // 语义失败，不编造地址）
    }), sourceDocUri))
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
