// #343（P3-11）外链原网页内容视图（悬停浮层 web 通道 page 形态）：宿主
// 预检（assessWebFrameEmbeddability）未拒绝的 https 最终地址以跨源沙箱
// iframe 尽力显示网站本身。
//
// 沙箱与隔离边界（三期正式规格「外链形态、网络与退回」第 4 条）：
// - sandbox 只给 "allow-scripts"——网站内容渲染所需的最小能力；不含
//   allow-same-origin（子页运行于不透明源，无 cookie/存储，天然跨源，
//   不可能取得父窗口对象或 acquireVsCodeApi）、不含 allow-top-navigation
//   （顶层导航被结构性拒绝）、不含 allow-forms / allow-popups /
//   allow-downloads / allow-modals（表单提交、弹窗、下载与模态全部拒绝）；
// - referrerpolicy=no-referrer：不向目标站点泄露 webview 来源 URL；
// - 不绕过网站拒绝内嵌头——宿主预检已知拒绝的直接退回卡片，未知头形
//   态放行后由站点自身的 X-Frame-Options / frame-ancestors 在浏览器
//   层拦截（此时 iframe 显示空白，见下方诚实说明）。
//
// 诚实边界（iframe 事件语义，MDN）：跨源 iframe 的 load 事件不证明内容
// 加载成功、error 事件不可靠——登录墙、脚本失败、空白渲染均不可观察。
// 本视图不监听 load/error 编造「加载成功/失败」状态，只呈现无法确认的
// 真实说明与可操作退路（退回卡片按钮在浮窗标题条动作组——2026-10-05
// 验收改版自本视图内部工具行迁入，见 hoverPopup.ts 装配；标题条浏览器
// 打开入口同在）。
//
// 生命周期：dispose 由容器（hoverPopup）在关闭/换目标/手动退回/设置联动
// 销毁时调用——移除 DOM 即同时中止 iframe 在途网络装载（消息桥为允许
// 清单制：仅放行宿主来源，一切子帧消息无条件拒绝，无按 iframe 登记的
// 状态需释放）。
import { t } from '../shared/i18n'
import type { RefWebContent } from '../shared/refContent'
import type { WebFrameDenyReason } from '../shared/webLink'

/** 页面视图类名（样式入口公开供片段覆写；登记于 styleContract hover-popup 条目）。
 *  2026-10-05 验收改版：退回卡片按钮迁入浮窗标题条动作组
 *  （.vsidian-hover-popup-web-fallback，hoverPopup.ts 装配）——原工具行
 *  toolbar/fallbackBtn 两类名随迁出移除，本视图仅含 iframe 与说明行 */
export const WEB_PAGE_CLASS_NAMES = {
  page: 'vsidian-hover-web-page',
  frame: 'vsidian-hover-web-frame',
  note: 'vsidian-hover-web-note',
  reason: 'vsidian-hover-web-reason',
} as const

/** 沙箱属性（契约钉住：仅网站内容必需能力，见模块头） */
export const WEB_FRAME_SANDBOX = 'allow-scripts'

/** 自动退回原因的就地文案（真实原因，不编造检测） */
export function webFrameFallbackReasonText(reason: WebFrameDenyReason): string {
  return t(reason === 'denied' ? 'hover.webFrameDenied' : 'hover.webFrameHttp')
}

/** page 形态装配视图（容器 el 由调用方挂 scrollEl；dispose 收敛全部释放） */
export interface WebPageView {
  el: HTMLElement
  iframe: HTMLIFrameElement
  dispose: () => void
}

/** 构建原网页视图：沙箱 iframe + 诚实说明行（退回卡片按钮自 2026-10-05
 *  验收改版起在浮窗标题条动作组，由容器装配与接线——本视图无按钮）。
 *  meta.url 非 https 时防御性拒绝装配（宿主预检已保证，此处兜底——
 *  HTTP 页面无法在安全上下文中嵌入显示） */
export function buildWebPageView(meta: RefWebContent): WebPageView | null {
  let parsed: URL
  try {
    parsed = new URL(meta.url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') {
    return null
  }
  const page = document.createElement('div')
  page.className = WEB_PAGE_CLASS_NAMES.page

  const iframe = document.createElement('iframe')
  iframe.className = WEB_PAGE_CLASS_NAMES.frame
  iframe.setAttribute('sandbox', WEB_FRAME_SANDBOX)
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('src', meta.url)
  // 无障碍名称经 aria-label（#300 悬停词契约：原生 title 已退役，
  // data-tooltip 是唯一悬停承载——iframe 无悬停词，不写 title）
  iframe.setAttribute('aria-label', meta.title !== '' ? meta.title : meta.domain)
  page.appendChild(iframe)

  const note = document.createElement('div')
  note.className = WEB_PAGE_CLASS_NAMES.note
  note.textContent = t('hover.webPageNote')
  page.appendChild(note)

  let disposed = false
  return {
    el: page,
    iframe,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      page.remove()
    },
  }
}

/** 退回卡片的自动原因行（denied/http 两种已知原因；挂在卡片内摘要下） */
export function appendWebCardFallbackReason(card: HTMLElement, reason: WebFrameDenyReason): void {
  const reasonEl = document.createElement('div')
  reasonEl.className = WEB_PAGE_CLASS_NAMES.reason
  reasonEl.textContent = webFrameFallbackReasonText(reason)
  card.appendChild(reasonEl)
}
