// #342（P3-10）外链卡片内容视图（悬停浮层 web 通道）：宿主受限抓取的
// 元信息以纯文字和一条显式链接呈现。站点图标和可选封面只消费宿主
// 已下载的图片数据；远程 SVG 仅作 img 使用，不插入页面 DOM。
//
// 边界：
// - 文字全部经 textContent 赋值（无 innerHTML——标题/摘要原文无 HTML
//   注入面）；域名链接是唯一可点元素，href 为宿主归一后的 http(s) 最终
//   URL，点击经浮层既有 link.activate 通道外开浏览器（不导航 webview）；
// - 无标题时以域名兜底显示（title 缺席不占位空白）；无摘要时省略摘要
//   节点（不留空行）；
// - 卡片不接管 Esc/焦点/关闭（沿用浮层既有优先级），无任何写操作。
import type { RefWebContent } from '../shared/refContent'
import { TOOLTIP_ATTR } from './tooltipCard'

const SITE_ICON = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="6.25"/><ellipse cx="8" cy="8" rx="2.75" ry="6.25"/><path d="M1.75 8h12.5"/></svg>'

/** 卡片类名（样式入口公开供片段覆写；登记于 styleContract hover-popup 条目） */
export const WEB_CARD_CLASS_NAMES = {
  card: 'vsidian-hover-web-card',
  title: 'vsidian-hover-web-title',
  description: 'vsidian-hover-web-desc',
  domain: 'vsidian-hover-web-domain',
  cover: 'vsidian-hover-web-cover',
  icon: 'vsidian-hover-web-icon',
} as const

/** 站点、可选封面、标题、摘要从上到下排列。 */
export function buildWebCardEl(meta: RefWebContent, showCover: boolean, sourceHref: string): HTMLElement {
  const card = document.createElement('div')
  card.className = WEB_CARD_CLASS_NAMES.card

  const domain = document.createElement('a')
  domain.className = WEB_CARD_CLASS_NAMES.domain
  domain.href = meta.url
  domain.rel = 'noreferrer noopener'
  domain.setAttribute(TOOLTIP_ATTR, sourceHref)
  const icon = document.createElement('span')
  icon.className = WEB_CARD_CLASS_NAMES.icon
  icon.innerHTML = SITE_ICON
  if (meta.iconSrc !== undefined) {
    const image = document.createElement('img')
    image.alt = ''
    image.addEventListener('load', () => icon.replaceChildren(image), { once: true })
    image.src = meta.iconSrc
  }
  const name = document.createElement('span')
  name.className = 'vsidian-hover-web-domain-name'
  name.textContent = meta.domain
  domain.append(icon, name)
  card.appendChild(domain)

  if (showCover && meta.coverSrc !== undefined) {
    const cover = document.createElement('img')
    cover.className = WEB_CARD_CLASS_NAMES.cover
    cover.alt = ''
    cover.addEventListener('error', () => cover.remove(), { once: true })
    cover.src = meta.coverSrc
    card.appendChild(cover)
  }

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

  return card
}
