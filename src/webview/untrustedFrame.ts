// #343（P3-11）宿主消息来源允许清单：悬停浮层的原网页视图挂载跨源沙箱
// iframe 后，其 contentWindow 是 webview 内唯一由远程内容驱动的脚本逸出
// 点——沙箱剥夺其 DOM/源访问，但 postMessage 到父窗口是任何沙箱 iframe
// 都保有的能力（sandbox 不拦截 postMessage）。webview 的宿主消息入口
//（main.ts 的 window message 监听 → controller.handleHostMessage）若不
// 设防，恶意子页可注入伪造的宿主消息（settings.changed / view.mode.set
// 等）劫持 webview 状态。
//
// 防线为**允许清单**：仅放行真宿主桥来源，拒绝其余一切。允许清单封死
// 「在场元素比对」否定判定（旧行为）的两个逃逸向量：
// - 嵌套 iframe：恶意子页内再嵌一层，其 window.parent.parent.postMessage
//   的 event.source 是孙代窗口，不在本 webview 文档扫描集内——否定判定
//   放行；允许清单下孙代窗口不等于 window/parent 且 origin 为不透明源或
//   攻击者源，两道判据全部落选；
// - 移除竞态：iframe 移除前已入队的 message 在元素移除后派发，source
//   指向已销毁 browsing context 的旧 contentWindow 引用——否定判定因
//   元素脱树漏判；允许清单下身份与 origin 判据同样落选。
//
// 判据（真宿主 1.82.3 便携版实测，探针经 vscode.postMessage 回传宿主打印）：
// - 宿主桥消息的 poster 是与本帧同源（origin 逐字符等于 window.origin，
//   形如 vscode-webview://<webview-id>）但**身份不可达**的 Window——与
//   window、window.parent、window.top 严格相等全部为假（本帧对
//   window.parent 的属性访问在该宿主甚至抛 TypeError），身份比对不可用，
//   origin 等值是唯一稳定判据；
// - 判据分两层：身份层（source === window || source === window.parent）
//   覆盖单帧环境（jsdom / 浏览器 fixture，parent === window）与自投递
//   形态；来源层（event.origin === window.origin 且本帧源非不透明 'null'）
//   覆盖真宿主桥。不透明源环境（origin 'null'）下沙箱 iframe 的 origin
//   也是 'null'，来源层零区分度，故整体禁用、仅身份层兜底。
//
// 不可伪造性：不可信子树（不透明源沙箱 iframe 及其嵌套帧）结构性无法
// 取得本帧 window / parent 窗口对象作为 source，也无法以 vscode-webview
// 源投递（不透明源与其子帧的 origin 恒为 'null' 或攻击者自身源）。
// 行为级证据：集成 core 分片在真宿主全绿（init/settings/view.mode 等
// 全链路宿主消息未被误拒，webview 正常就绪与渲染）。

/** message 事件来源是否为真宿主桥（main.ts 消费前判定；判据分层与实测
 *  依据见模块头） */
export function isTrustedHostMessageSource(source: unknown, origin: string): boolean {
  if (source === window || source === window.parent) {
    return true
  }
  return window.origin !== 'null' && origin === window.origin
}

/** 在场不可信 iframe 的选择器（webPage.ts 的类名单一事实源镜像） */
const UNTRUSTED_FRAME_SELECTOR = 'iframe.vsidian-hover-web-frame'

/** 观测（测试断言在场 iframe 计数；销毁路径经元素移除自动出局） */
export function untrustedFrameWindowCount(): number {
  return document.querySelectorAll(UNTRUSTED_FRAME_SELECTOR).length
}
