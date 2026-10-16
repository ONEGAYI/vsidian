// #569（T04）全文文档样式：收集、b2 改写核心与身份键（纯逻辑，两端
// 共用；规格 html-rendering.md「CSS 原意与作用域」；T01 探针
// docs/research/html-css-scope-probe.md 获选路线的生产化）。
//
// 分层纪律：本模块不依赖 DOM/vscode——CSSOM 解析在 webview 装载器
// （src/webview/docStyleLoader.ts）适配为下面的 DocStyleRule 数据树后
// 进入本模块的纯变换；Live 与 Reading/嵌入共用同一收集结果（同一文档
// 两端样式源一致，「同一原生 HTML 规则两端一致」的结构前提）。
//
// 口径落档（票面决策点，随 T04 定案）：
// - **`:root`/`body`/`html` 改写后失活**（决策点 1，探针建议）：逐块
//   改写下这三类选择器永不命中（标记块不是根/文档元素的祖先）。维持
//   失活最忠实于「不翻译选择器语义」；Obsidian 式「文档根」映射留待
//   用户反馈驱动，不在此开受控翻译口子。
// - **文档样式后置于 CSS 片段**（决策点 2）：产物挂 document.head 末尾
//   ——实测「片段在前、文档后置」时同特异性文档胜（就近直觉：文档
//   特定覆盖全局配置）；片段启停/排序/契约不因本功能改写。
//
// at-rule 矩阵（票面「逐类核对」的落档去向）：
// - @media / @supports / @layer / @container：**递归改写内层**（组块头
//   原样保留——层叠序/层序/容器条件语义不变，仅内层选择器进隔离前缀）。
// - @keyframes：**原样保留**。名字空间是文档级——嵌套场景 A/B 同名动画
//   冲突属既有 CSS 语义（探针第七节），不改名（animation 属性里的名字
//   引用无法安全重写，「不翻译语义」）。
// - @font-face / @property / @import：**原样保留**（文档级语义，无选择器
//   可隔离）。@import 的 CSS 原生位置规则仍生效：多块拼接产物中非首位
//   的 @import 按引擎原生行为失效；url()/字体资源的**来源文档解析基准**
//   归 T05（当前按 head 内 <style> 的文档基准解析，矩阵记录在案）。
// - CSS 嵌套（&）：**递归代换改写**（探针警示的静默丢失不允许：& 按
//   「父选择器整体 :is() 代换 + 无 & 隐式后代」展开，多层嵌套累积祖先链，
//   伪元素后缀在代换后拆分）。
// - 未知 at-rule：原样保留（保守：不猜语义）。
import { canonicalRefTargetKey } from './refExpansion'
import { frontmatterRange, markdownTreeParser } from './markdownDoc'
import type { Tree } from '@lezer/common'

// ---------------------------------------------------------------------------
// 身份键（docScope 值域）
// ---------------------------------------------------------------------------

/** 主文档的 docScope 值（T02 已定；与 T04 派生键共用 data-vsidian-doc-scope 属性面） */
export const MAIN_DOC_SCOPE = 'doc'

/** docScope 属性名（Live widget / Reading 块根 / 嵌入实例内容块统一携带） */
export const DOC_SCOPE_ATTR = 'data-vsidian-doc-scope'

/**
 * 嵌入视图的 docScope 键：canonicalRefTargetKey 单向派生（#556 落档的
 * 规范绝对身份域——不建第二份路径规则）。FNV-1a 双 32bit 拼合的 64bit
 * hex：CSS 属性选择器值安全（无引号/反斜杠/空白），vault 级文件数的
 * 碰撞概率可忽略；'ref:' 前缀与主文档字面量 'doc' 不碰撞。
 *
 * windows 参数由 fsPath 形态内派（盘符/UNC = Windows 形态）：fsPath 是
 * 宿主 path 模块产出的规范形态——本地与远程工作区的 file: URI 都按
 * **扩展宿主所在机器**的平台产形，与 documentSession.isWindowsHost
 * （process.platform）语义一致；webview 无 process，形态判定即权威形态
 * 的投影，不引入协议字段。
 */
export function docScopeKeyOf(fsPath: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(fsPath) || fsPath.startsWith('\\\\')
  return 'ref:' + fnv1a64(canonicalRefTargetKey(fsPath, windows))
}

function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + 0x9e3779b9), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// 收集器：全文源码顺序的 <style> 源文
// ---------------------------------------------------------------------------

/** 一个文档内 <style> 元素的源文（LF 全文 UTF-16 offset） */
export interface DocStyleSource {
  /** style 元素整体区间（开标签 '<' 到闭标签 '>'，end 不含） */
  from: number
  to: number
  /** style 元素内容文本（开闭标签之间，原样） */
  css: string
}

/** 语法掩码节点名：其整个子树内的 <style> 是字面内容，不收集（两端共口径） */
const LITERAL_NODE_NAMES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'Comment', 'CommentBlock'])

/**
 * 全文 <style> 收集（#569 票面：按全文源码顺序，块级与行内出现的
 * style 标签源文都收集——样式存续依附全文源文，不依附样式块 DOM 在场）。
 *
 * 语法感知排除：代码上下文（围栏/缩进/行内代码）、HTML 注释（Comment/
 * CommentBlock——既有注释规则不随本功能重定义）、frontmatter 内的
 * `<style` 是字面内容不收集。容器内（引用/列表）的降级 HTML 块**收集**
 * ——降级是呈现边界，样式装载按全文源文口径（与「纯 style 块 Live 源码
 * 常显且样式生效」同一语义）。
 *
 * 配对词法 = HTML raw text 元素语义：开标签 `<style\b...>` 之后**首个**
 * `</style` 闭标签（内容中的 `</style>`（如 content 值）提前闭合——与
 * 浏览器词法一致）；未闭合不产出（不吞后续内容）。树缺席时独立全文
 * parse（markdownTreeParser——与 liveDecorations 同一解析器事实源）。
 */
export function collectDocumentStyles(text: string, tree?: Tree | null): DocStyleSource[] {
  const mask = literalMask(text, tree ?? markdownTreeParser.parse(text))
  const out: DocStyleSource[] = []
  const openRe = /<style\b/ig
  let match: RegExpExecArray | null
  while ((match = openRe.exec(text)) !== null) {
    const from = match.index
    openRe.lastIndex = from // 对齐到匹配末尾继续（下方手动推进）
    const openTagEnd = text.indexOf('>', from + match[0].length)
    if (openTagEnd < 0) {
      break // 开标签未闭合：后续内容无词法依据，停止
    }
    const openTag = text.slice(from, openTagEnd + 1)
    if (/\/>$/.test(openTag)) {
      openRe.lastIndex = openTagEnd + 1
      continue // 自闭合形态（HTML 中非法但源文可能出现）：无内容体
    }
    if (inMask(mask, from)) {
      openRe.lastIndex = from + match[0].length
      continue // 字面上下文（代码/注释/frontmatter）：跳过开标签本身
    }
    const closeMatch = /<\/style\b[^>]*>/i.exec(text.slice(openTagEnd + 1))
    if (closeMatch === null) {
      // 未闭合：不产出（保守——不把后续全文当样式体）；继续找下一个开标签
      openRe.lastIndex = openTagEnd + 1
      continue
    }
    const cssStart = openTagEnd + 1
    const to = openTagEnd + 1 + closeMatch.index + closeMatch[0].length
    out.push({ from, to, css: text.slice(cssStart, cssStart + closeMatch.index) })
    openRe.lastIndex = to
  }
  return out
}

/** 代码/注释/frontmatter 的字面区间集合（升序，供收集器排除） */
function literalMask(text: string, tree: Tree): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  const visit = (node: import('@lezer/common').SyntaxNode): void => {
    if (LITERAL_NODE_NAMES.has(node.name)) {
      ranges.push({ from: node.from, to: node.to })
      return // 子树整体掩码
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child)
    }
  }
  visit(tree.topNode)
  const fm = frontmatterRange(text)
  if (fm) {
    ranges.push({ from: fm.start, to: fm.end })
  }
  ranges.sort((a, b) => a.from - b.from)
  return ranges
}

function inMask(mask: Array<{ from: number; to: number }>, pos: number): boolean {
  // mask 已升序：线性窗口推进足够（调用侧每次从头，规模小）
  for (const r of mask) {
    if (r.from <= pos && pos < r.to) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// b2 改写核心：规则树纯变换
// ---------------------------------------------------------------------------

/**
 * CSSOM 规则的最小数据投影（webview 装载器从 CSSRule 适配；纯数据无
 * DOM 依赖）。四种形态：
 * - 样式规则：selectorText + declarations（+ cssRules 嵌套子规则）
 * - 组块规则：groupHead（如 `@media (min-width: 1px)`）+ cssRules
 * - 原样规则：rawCssText（@keyframes/@font-face/@import/@property/未知）
 * - 空形态（解析丢弃）自动跳过
 */
export interface DocStyleRule {
  selectorText?: string
  declarations?: string
  groupHead?: string
  cssRules?: readonly DocStyleRule[]
  rawCssText?: string
}

/**
 * 选择器项的 b2 隔离改写：`:where([data-vsidian-doc-scope="…"]) :is(项)`
 * ——:where 归零前缀特异性（层叠语义保持）、:is 保留项内特异性。伪元素
 * 后缀拆到 :is() 之外（:is() 参数禁伪元素，整条规则会被静默丢弃——T01
 * 探针实测警示）。纯伪元素项（::selection）主体回退 *。
 */
export function scopeDocStyleSelector(selector: string, docScope: string): string {
  const pe = splitPseudoElement(selector.trim())
  const head = pe === null ? selector.trim() : pe.head || '*'
  const suffix = pe === null ? '' : pe.suffix
  return `:where([${DOC_SCOPE_ATTR}="${docScope}"]) :is(${head})${suffix}`
}

/** 伪元素后缀拆分（双冒号任意名 + 单冒号遗留四名；带参数形态兼容） */
function splitPseudoElement(sel: string): { head: string; suffix: string } | null {
  const m = /^(.*?)(::[a-zA-Z-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter)(?:\([^)]*\))?)$/.exec(sel)
  if (m === null) {
    return null
  }
  return { head: m[1].trim(), suffix: m[2] }
}

/**
 * 括号感知的选择器列表拆项（`h1, .a` → 两项；`:is(.a, .b)` 内的逗号
 * 不拆——探针参考实现的 split(',') 会拆坏括号形态，此处修正）。
 */
export function splitSelectorList(selectorText: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i]
    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
    } else if (ch === ',' && depth === 0) {
      out.push(selectorText.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = selectorText.slice(start).trim()
  if (last !== '' || out.length > 0) {
    out.push(last)
  }
  return out.filter(Boolean)
}

/**
 * 嵌套子选择器对父链的代换：`& p` → `:is(父) p`（& 整体代换父选择器）；
 * 无 & 的嵌套项为隐式后代（`.parent { p {} }` ≡ `.parent p`）。父链为
 * 逗号列表时逐项展开（笛卡尔）。
 */
export function substituteNesting(selector: string, parents: readonly string[]): string[] {
  const out: string[] = []
  for (const parent of parents) {
    const scoped = selector.includes('&')
      ? selector.split('&').join(`:is(${parent})`)
      : `:is(${parent}) ${selector}`
    out.push(scoped.trim())
  }
  return out
}

/**
 * 规则树的 b2 改写（纯变换核心）。输出为拼接的产物 CSS 文本：
 * - 样式规则：逐项 `:where(…) :is(项)[伪元素] { 声明 }`；嵌套子规则以
 *   「本层完整选择器（含祖先链代换、未加文档前缀）」为父继续递归。
 * - 组块：头原样 + 花括号内递归（parents 原样透传——组块不改选择器语境）。
 * - 原样规则：rawCssText 保序输出（at-rule 矩阵见模块头注释）。
 * - declarations 为空的嵌套宿主不产空声明行（仅展开子规则）。
 */
export function rewriteDocStyleRuleTree(rules: readonly DocStyleRule[], docScope: string): string {
  const lines = rewriteGroup(rules, null, docScope)
  return lines.join('\n')
}

function rewriteGroup(
  rules: readonly DocStyleRule[],
  parents: readonly string[] | null,
  docScope: string,
): string[] {
  const lines: string[] = []
  for (const rule of rules) {
    if (rule.rawCssText !== undefined) {
      lines.push(rule.rawCssText)
      continue
    }
    if (rule.groupHead !== undefined) {
      const inner = rewriteGroup(rule.cssRules ?? [], parents, docScope)
      lines.push(`${rule.groupHead} {\n${inner.join('\n')}\n}`)
      continue
    }
    if (rule.selectorText === undefined) {
      continue // 空形态（解析丢弃）
    }
    // 空选择器 = 裸声明规则（CSSNestedDeclarations 形态，`& { … }` 语义
    // ——声明属于父选择器整体）：按 & 代换展开
    const items = rule.selectorText === '' ? ['&'] : splitSelectorList(rule.selectorText)
    const fulls: string[] = []
    for (const item of items) {
      if (parents === null) {
        fulls.push(item)
      } else {
        fulls.push(...substituteNesting(item, parents))
      }
    }
    const decl = (rule.declarations ?? '').trim()
    if (decl !== '') {
      lines.push(`${fulls.map((f) => scopeDocStyleSelector(f, docScope)).join(', ')} { ${decl} }`)
    }
    if (rule.cssRules !== undefined && rule.cssRules.length > 0) {
      lines.push(...rewriteGroup(rule.cssRules, fulls, docScope))
    }
  }
  return lines
}
