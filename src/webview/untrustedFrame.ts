// #343（P3-11）不可信子页消息来源判定：悬停浮层的原网页视图挂载跨源
// 沙箱 iframe 后，其 contentWindow 是 webview 内唯一由远程内容驱动的
// 脚本逸出点——沙箱剥夺其 DOM/源访问，但 postMessage 到父窗口是任何
// 沙箱 iframe 都保有的能力（sandbox 不拦截 postMessage）。webview 的
// 宿主消息入口（main.ts 的 window message 监听 → controller.handleHost
// Message）不校验来源即消费 event.data——若不设防，恶意子页可注入伪造
// 的宿主消息（settings.changed / view.mode.set 等）劫持 webview 状态。
//
// 防线按 **在场元素比对**：判定时扫描文档内全部 `.vsidian-hover-web-
// frame` iframe，event.source 与任一 contentWindow 同一即丢弃。不依赖
// event.origin（宿主桥消息的 origin 随平台实现变化，不可假设）、不依赖
// 消息内容标记（无法为全部既有宿主消息改造签名）、不做装配期注册
//（iframe 脱离文档前 contentWindow 为 null，注册时机不可靠）。iframe
// 元素移除即天然出局（销毁的 browsing context 不再派发），无悬空注册。
// 跨源 iframe 无法触达本 webview 之外的其它 window（window.top 即父
// 窗口），故本判定对威胁模型完备。

/** 在场不可信 iframe 的选择器（webPage.ts 的类名单一事实源镜像） */
const UNTRUSTED_FRAME_SELECTOR = 'iframe.vsidian-hover-web-frame'

/** message 事件来源是否为在场原网页 iframe 的窗口（main.ts 消费前判定）。
 *  直接与在场 iframe 的 contentWindow 严格相等比对——不做 instanceof
 *  Window 类型判定（跨 realm 的 instanceof 不可靠：子页窗口属另一全局
 *  环境，且 MessagePort/ServiceWorker 等其它来源类型永远不与 content
 *  Window 同一，比对即天然排除） */
export function isUntrustedMessageSource(source: unknown): boolean {
  for (const frame of Array.from(document.querySelectorAll(UNTRUSTED_FRAME_SELECTOR))) {
    if (frame instanceof HTMLIFrameElement && frame.contentWindow === source) {
      return true
    }
  }
  return false
}

/** 观测（测试断言在场 iframe 计数；销毁路径经元素移除自动出局） */
export function untrustedFrameWindowCount(): number {
  return document.querySelectorAll(UNTRUSTED_FRAME_SELECTOR).length
}
