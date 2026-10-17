// #570（T05）HTML/CSS 资源解析枢纽（webview 页内单例）：原生 HTML 的
// srcset/媒体属性与文档样式 url()/@import/@font-face 的相对目标按来源
// 文档解析为 webview 可装载地址。
//
// 通道纪律（为什么是独立消息种 htmlResource.request/result，不复用
// image.request）：
// - 宿主侧解析与白名单完全复用（resolveImage 端口 → classifyImageTarget
//   + asWebviewUri，路径规则不建第二份——#556 纪律）。
// - webview 侧 reqId 路由空间按消息种隔离：既有 image.result 由多个
//   ImageResourceManager 实例按「pending + reqId 首个命中」认领，并入
//   同一空间会引入跨实例误配对（本票新增消费者不扩大既有隐患面）。
// - 身份矩阵：sourceDocUri 缺省 = 面板自身文档（A）；嵌入/悬停 B/C 以其
//   fsPath 订阅（宿主与已读取的 hover/嵌入目标比对，不匹配即丢弃——
//   不信任前端任意 URI）。同一 raw 在不同来源文档是不同键（A/B/C 不串源
//   的数据面）。
//
// 失效链路：宿主 image.invalidate 广播按目标 fsPath 反查登记的 raw 集合
// （htmlResource 请求成功同样登记 imageSrcTarget——invalidateImagesByFsPath
// 广播的 srcs 命中本枢纽缓存）→ 清缓存并对仍有订阅者的条目重取（新代次
// URI 击穿 webview 资源缓存）。释放语义：订阅退订后迟到结果只丢不写。
import type { WebviewToHost } from '../shared/protocol'

/** 资源解析结果（url 为可直接进属性/产物文本的 webview 资源 URI） */
export type HtmlResourceOutcome = { ok: true; url: string } | { ok: false; reason?: string }

export type HtmlResourceApply = (outcome: HtmlResourceOutcome) => void

/** 订阅端口：apply 可能同步（缓存命中）或异步（请求往返）回调；返回退订 */
export type HtmlResourceSubscribe = (
  url: string,
  apply: HtmlResourceApply,
  sourceDocUri?: string,
) => () => void

/** htmlResource.result 协议消息的最小数据形态（协议层已校验） */
export interface HtmlResourceResultPayload {
  reqId: number
  ok: boolean
  url?: string
  reason?: string
  detail?: string
}

interface HubPort {
  session(): { sessionId: string | undefined; docUri: string | undefined }
  send(message: WebviewToHost): void
}

interface HubEntry {
  raw: string
  sourceDocUri: string | undefined
  /** 成功缓存（失效前复用——同 raw 同来源的重复订阅零请求） */
  resolved: string | null
  /** 失败登记（不重试风暴；失效通知清除后可重取） */
  failed: boolean
  pendingReqId: number | null
  listeners: Set<HtmlResourceApply>
}

let port: HubPort | null = null
let nextReqId = 0
const entries = new Map<string, HubEntry>()

/** syncController 装配时注册出站端口（一个面板 webview 一个） */
export function registerHtmlResourcePort(deps: HubPort): void {
  port = deps
}

function keyOf(raw: string, sourceDocUri: string | undefined): string {
  return `${sourceDocUri ?? ''}\u0000${raw}`
}

function sendRequest(entry: HubEntry): void {
  if (port === null) {
    // 端口未注册（测试直驱/装配序异常）：瞬时失败——不缓存 failed
    //（登记后端口就位仍可正常解析）
    for (const apply of [...entry.listeners]) {
      apply({ ok: false })
    }
    return
  }
  const session = port.session()
  if (!session.sessionId || !session.docUri) {
    for (const apply of [...entry.listeners]) {
      apply({ ok: false })
    }
    return
  }
  const reqId = ++nextReqId
  entry.pendingReqId = reqId
  port.send({
    kind: 'htmlResource.request',
    sessionId: session.sessionId,
    docUri: session.docUri,
    reqId,
    url: entry.raw,
    ...(entry.sourceDocUri !== undefined ? { sourceDocUri: entry.sourceDocUri } : {}),
  })
}

/**
 * 订阅一个资源 URL 的解析结果：缓存命中同步回调；在途/新发请求异步回调。
 * 返回退订函数（视图释放/元素离场调用——退订后迟到结果不回写）。
 * 失败登记后同键后续订阅立即失败回调（不重复请求），直至失效清除。
 */
export function subscribeHtmlResource(
  url: string,
  apply: HtmlResourceApply,
  sourceDocUri?: string,
): () => void {
  const key = keyOf(url, sourceDocUri)
  let entry = entries.get(key)
  if (!entry) {
    entry = { raw: url, sourceDocUri, resolved: null, failed: false, pendingReqId: null, listeners: new Set() }
    entries.set(key, entry)
  }
  entry.listeners.add(apply)
  if (entry.resolved !== null) {
    apply({ ok: true, url: entry.resolved })
  } else if (entry.failed) {
    apply({ ok: false })
  } else if (entry.pendingReqId === null) {
    sendRequest(entry)
  }
  return () => {
    entry!.listeners.delete(apply)
    if (entry!.listeners.size === 0 && entry!.pendingReqId === null) {
      entries.delete(keyOf(entry!.raw, entry!.sourceDocUri))
    }
  }
}

/** 宿主 htmlResource.result 路由（reqId 配对；未知/迟到即丢弃） */
export function notifyHtmlResourceResult(msg: HtmlResourceResultPayload): void {
  for (const entry of entries.values()) {
    if (entry.pendingReqId !== msg.reqId) {
      continue
    }
    entry.pendingReqId = null
    if (msg.ok && typeof msg.url === 'string') {
      entry.resolved = msg.url
      for (const apply of [...entry.listeners]) {
        apply({ ok: true, url: msg.url })
      }
    } else {
      entry.failed = true
      for (const apply of [...entry.listeners]) {
        apply({ ok: false, reason: msg.reason })
      }
    }
    if (entry.listeners.size === 0) {
      entries.delete(keyOf(entry.raw, entry.sourceDocUri))
    }
    return
  }
}

/**
 * 失效通知（image.invalidate 广播消费）：命中的 raw 清缓存/清失败登记，
 * 仍有订阅者的条目立即重取（新代次 URI）；无订阅者的条目直接回收。
 */
export function notifyHtmlResourceInvalidate(srcs: readonly string[]): void {
  const set = new Set(srcs)
  for (const [key, entry] of [...entries.entries()]) {
    if (!set.has(entry.raw)) {
      continue
    }
    entry.resolved = null
    entry.failed = false
    if (entry.listeners.size === 0) {
      entries.delete(key)
      continue
    }
    if (entry.pendingReqId === null) {
      sendRequest(entry)
    }
  }
}

/** 手动刷新（refresh.invalidated）：全量失效重取（新代次戳 URI） */
export function invalidateAllHtmlResources(): void {
  for (const raw of new Set([...entries.values()].map((e) => e.raw))) {
    notifyHtmlResourceInvalidate([raw])
  }
}

/**
 * 以 hub 为后端的资源端口工厂（docStyleLoader 的 DocStyleResourcePort
 * 结构兼容形态）：sourceDocUri 绑定来源文档身份（缺省 = 面板文档 A）。
 * 同一来源的多次 subscribe 走 hub 的缓存/去重。
 */
export function hubResourcePort(sourceDocUri?: string): {
  subscribe(raw: string, apply: HtmlResourceApply): () => void
} {
  return {
    subscribe: (raw, apply) => subscribeHtmlResource(raw, apply, sourceDocUri),
  }
}

/** 测试/诊断观测：当前在场条目（来源键 + raw + 缓存态） */
export function htmlResourceHubEntries(): Array<{ sourceDocUri?: string; raw: string; resolved: string | null; failed: boolean; pending: boolean; listeners: number }> {
  return [...entries.values()].map((e) => ({
    sourceDocUri: e.sourceDocUri,
    raw: e.raw,
    resolved: e.resolved,
    failed: e.failed,
    pending: e.pendingReqId !== null,
    listeners: e.listeners.size,
  }))
}
