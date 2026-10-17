// #573（T08）ID 文档作用域的**语法**层（纯逻辑，两端共用）：主文档与
// 引用文档的相同内部 ID 不串目标（规格验收：docScope 键作用域）。
//
// 背景：HTML/SVG 的内部 ID（linearGradient/use/clipPath 的 id 与
// url(#id)、href="#id" 引用）在**同一 webview document** 内全局解析——
// 嵌入 B 的渲染产物挂在 A 的 DOM 里，B 的 url(#g1) 会命中 A 的 g1（或
// 反向），串掉呈现目标。隔离方向：**B 单侧前缀化**——B 产物内全部 id 与
// # 片段引用统一加 scope 前缀；A 主文档保持 HTML 原生全局 ID 语义零改写
//（A 内多块 id 冲突是作者自己的原生语义，不是本层要治的病）。
//
// 协同面（同前缀两处使用，缺一即失配）：
// - DOM 侧：htmlResourceMount 的装配咽喉（id 属性 + 引用属性值）。
// - CSS 侧：docStyle 改写器（#id 选择器与 url(#id) 声明）——B 的本篇
//   `<style>` 按 b2 路径装载时对 id 引用做同前缀代换，选择器含义保持
//   （规格「隔离机制不得借机改变选择器本来的含义」）。
//
// 不伪造宿主锚点：B 域内的 # 引用**一律**限定 B 域（未命中目标也加前缀
// → 引用落空按原生无目标呈现，不外溢成 A 的锚点跳转）。
import { scanCssUrls } from './htmlResource'
/** 主文档的 docScope 标识（syncController 根正文注入值——主文 Live facet
 *  与 Reading 块标记共用；本模块据此判「零改写」） */
export const PRIMARY_DOC_SCOPE = 'doc'

/**
 * 引用文档（B/C）的 ID 前缀；主文档（'doc'）与空值返回 null = 不改写。
 * 前缀形态 'vs' + scope 键清洗（非 [-A-Za-z0-9_] 替 '_'）+ '--'：对 HTML
 * id 与 CSS ident 均合法（无转义需求，DOM/CSS 两侧拼接即可对齐）。
 */
export function htmlIdScopePrefix(docScope: string | null | undefined): string | null {
  if (docScope === null || docScope === undefined || docScope === PRIMARY_DOC_SCOPE) {
    return null
  }
  return 'vs' + docScope.replace(/[^-A-Za-z0-9_]/g, '_') + '--'
}

/**
 * `href`/`xlink:href` 属性值的整值片段引用替换（DOM 装配侧消费——URI
 * 值语法面）：整值 `#id`（use/a/image 的文档内引用）加前缀；外部 URL
 * （含其 #frag）、相对路径、data: 不是文档内引用，不动作。值内
 * `url(#id)` 函数不属于 URL 属性语法（paint/style 走 CSS 值面
 * scopeCssFragmentRefs），不在此处理。
 */
export function rewriteHrefFragmentValue(value: string, prefix: string | null): string {
  if (prefix === null || value === '' || !value.startsWith('#') || value.length <= 1) {
    return value
  }
  return `#${prefix}${value.slice(1)}`
}

/**
 * CSS 值文本内 `url(#id)` 的前缀协同（docStyle 装载侧与 DOM 装配侧的
 * paint/style 属性值共用——CSS 值语法面）：只改写**片段引用形态**的 url
 * 产（`url(#x)`/`url("#x")`/`url('#x')`，词法复用 htmlResource.
 * scanCssUrls——共享规则只维护一份）；paint 属性的整值 `#rrggbb` 是
 * 颜色不是引用（无 url() 产，天然零动作）；http/相对路径的 url() 是
 * 资源引用（T05 管线），字符串字面量（content: "url(#x)"）与注释不是
 * 产，均不动作。prefix 为 null（主文档）原样返回。
 */
export function scopeCssFragmentRefs(css: string, prefix: string | null): string {
  if (prefix === null || !css.includes('#')) {
    return css
  }
  const tokens = scanCssUrls(css)
  let out = ''
  let cursor = 0
  for (const token of tokens) {
    if (!token.url.startsWith('#')) {
      continue // 资源引用（http/相对）归 T05 管线；import-string 的 # 目标是病态输入，保持原文
    }
    const inner = `#${prefix}${token.url.slice(1)}`
    const replacement = token.quote !== null ? `url(${token.quote}${inner}${token.quote})` : `url(${inner})`
    out += css.slice(cursor, token.start) + replacement
    cursor = token.end
  }
  if (cursor === 0) {
    return css
  }
  return out + css.slice(cursor)
}

/**
 * 选择器内 `#id` 项的前缀协同（docStyle 装载侧消费）：词法跳过字符串
 * 与属性选择器方括号内的 #（`[href="#x"]` 不是 id 选择器）；`#ident`
 * 形态加前缀。prefix 为 null（主文档）原样返回。
 */
export function scopeSelectorIdTokens(selector: string, prefix: string | null): string {
  if (prefix === null || !selector.includes('#')) {
    return selector
  }
  let out = ''
  let i = 0
  const n = selector.length
  let bracketDepth = 0
  while (i < n) {
    const ch = selector[i]!
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < n && selector[j] !== ch) {
        j++
      }
      out += selector.slice(i, Math.min(j + 1, n))
      i = j + 1
      continue
    }
    if (ch === '[') {
      bracketDepth++
      out += ch
      i++
      continue
    }
    if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      out += ch
      i++
      continue
    }
    if (ch === '#' && bracketDepth === 0) {
      // id 项：# 后 ident 字符序列（转义序列保守按原文保留不改写——
      // 带 CSS 转义的 id 与前缀拼接会破坏转义结构，保持原样降级）
      let j = i + 1
      while (j < n && /[-A-Za-z0-9_\u00a0-\uffff]/.test(selector[j]!)) {
        j++
      }
      if (j > i + 1 && selector[i + 1] !== '\\') {
        out += `#${prefix}${selector.slice(i + 1, j)}`
        i = j
        continue
      }
    }
    out += ch
    i++
  }
  return out
}
