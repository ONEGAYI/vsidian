// #342（P3-10）外链卡片内容视图（悬停浮层 web 通道）：宿主受限抓取的
// 元信息（标题/摘要/域名/最终 URL）以纯文字 + 一条显式安全链接呈现——
// 不执行远程 HTML、不加载第三方缩略图、不触发任何子资源请求（卡片是
// 本地 DOM 构建而非远程内容渲染）。
//
// 边界：
// - 文字全部经 textContent 赋值（无 innerHTML——标题/摘要原文无 HTML
//   注入面）；域名链接是唯一可点元素，href 为宿主归一后的 http(s) 最终
//   URL，点击经浮层既有 link.activate 通道外开浏览器（不导航 webview）；
// - 无标题时以域名兜底显示（title 缺席不占位空白）；无摘要时省略摘要
//   节点（不留空行）；
// - 卡片不接管 Esc/焦点/关闭（沿用浮层既有优先级），无任何写操作。
import type { RefWebContent } from '../shared/refContent'

/** 卡片类名（样式入口公开供片段覆写；登记于 styleContract hover-popup 条目） */
export const WEB_CARD_CLASS_NAMES = {
  card: 'vsidian-hover-web-card',
  title: 'vsidian-hover-web-title',
  description: 'vsidian-hover-web-desc',
  domain: 'vsidian-hover-web-domain',
} as const

/** 构建外链卡片 DOM（纯文字 + 域名安全链接） */
export function buildWebCardEl(meta: RefWebContent): HTMLElement {
  const card = document.createElement('div')
  card.className = WEB_CARD_CLASS_NAMES.card

  const title = document.createElement('div')
  title.className = WEB_CARD_CLASS_NAMES.title
  title.textContent = meta.title !== '' ? meta.title : meta.domain
  card.appendChild(title)

  if (meta.description !== '') {
    const description = document.createElement('div')
    description.className = WEB_CARD_CLASS_NAMES.description
    description.textContent = meta.description
    card.appendChild(description)
  }

  const domain = document.createElement('a')
  domain.className = WEB_CARD_CLASS_NAMES.domain
  domain.href = meta.url
  domain.textContent = meta.domain
  domain.rel = 'noreferrer noopener'
  card.appendChild(domain)

  return card
}
