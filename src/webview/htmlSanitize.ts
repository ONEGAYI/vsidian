// 块级 HTML 专用内容净化边界（#567/T02，ADR-0019 决定 5；T01 探针附录 B
// 选型 DOMPurify 的最小接线）：html 块源文进 DOM 前经白名单净化——
// Reading 块渲染与 Live widget 共用本入口（净化规则只维护一份）。
//
// 分层（探针附录 B 口径）：
// - 第一道闸：DOMPurify 白名单（默认全量 HTML + 安全 SVG/MathML 子集；
//   script/事件属性/危险协议默认拒绝）。`<style>` 显式 FORBID——文档内
//   样式由 T04 收集器从源文独立装载，不随 DOM 净化放行进正文（双通道）。
// - 第二道闸：既有 sanitizeReadingDom 黑名单（防御纵深）继续对挂载 DOM
//   执行（mermaid 管线依赖其剥 SVG 内 style 的现状口径，不受本模块影响）。
// - 系统锚点互斥：源文自带的 `data-vsidian-*` 一律剥离（防越权自标记/
//   伪造锚点）；系统装配生成的锚点（块元素 src 锚点、docScope 标记）写
//   在净化输入之外，天然不被误删——无需回填 hook（T01 探针的回填建议
//   针对对既有 DOM 复净化的场景，本管线是字符串→DOM 单向装配）。
// - 降级：净化后为空（script-only 等）回退转义源码呈现（规格「无法安全
//   呈现的片段保持可访问的原始源码」）。DOMPurify 不可用（无 DOM 环境）
//   同样回退源码——绝不放行未净化内容。
import DOMPurify from 'dompurify'
import { escapeHtml } from '../shared/frontmatterTable'

/** 净化后为空的块回退源码呈现的稳定类名（样式契约 reading-html-block /
 *  live-html-widget 条目的降级态注记） */
export const HTML_SOURCE_FALLBACK_CLASS = 'vsidian-html-source-fallback'

/** data-vsidian-* 剥离 hook 只挂一次（模块级实例单例） */
let hooksInstalled = false

function purifyInstance(): typeof DOMPurify | null {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) {
    return null
  }
  if (!hooksInstalled) {
    DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName.startsWith('data-vsidian-')) {
        data.keepAttr = false
      }
    })
    hooksInstalled = true
  }
  return DOMPurify
}

/**
 * html 块源文的净化产物（字符串）。不可安全呈现时返回空串（调用方
 * htmlBlockRenderHtml 回退转义源码）；DOM 环境缺失同样返回空串（降级
 * 方向安全——源码可见优先于内容放行）。
 */
export function sanitizeHtmlBlockMarkup(source: string): string {
  const purify = purifyInstance()
  if (!purify) {
    return ''
  }
  return purify.sanitize(source, {
    // 文档内样式走 T04 收集器（源文 → CSSStyleSheet 装载），不进正文 DOM
    FORBID_TAGS: ['style'],
  })
}

/**
 * html 块的渲染 HTML 装配：净化成功 → 净化产物（供 innerHTML）；净化后
 * 为空且源文非空 → 转义源码 pre（可访问原始源码，不吞不执行）。纯空白
 * 源文产空串（无内容可呈现）。
 */
export function htmlBlockRenderHtml(source: string): string {
  const sanitized = sanitizeHtmlBlockMarkup(source)
  if (sanitized !== '' || source.trim() === '') {
    return sanitized
  }
  return `<pre class="${HTML_SOURCE_FALLBACK_CLASS}">${escapeHtml(source)}</pre>`
}
