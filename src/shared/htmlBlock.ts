// 块级 HTML 边界共享事实源（#567/T02，规格「HTML 范围与源文」）：
// - 顶层 HTML 块区间从两端解析器**既有产出**派生（Live：Lezer
//   markdownLanguage 的 HTMLBlock 节点；Reading：markdown-it html_block
//   token），不新写正则猜测嵌套范围。独立 div 外壳两端都沿原文 Lezer 块
//   区间配对，不继承阅读预处理产生的空行。两端一致性由对拍测试钉住
//   （test/unit/htmlBlock.test.ts）。
// - 容器排除（引用/列表内的 html 块两端一致降级为源码呈现）：Lezer 侧
//   按祖先链排除；markdown-it 侧天然只消费顶层 token（readingBlocks 的
//   level-0 token 循环）。该边界移入容器属后续票，不随本票顺手放宽。
// - 纯 <style> 块（Q6A）：Live 源码常显不占位、Reading 隐藏（T04 收集器
//   从源文装载）。判定是解析器已界定块内的形态检查，不是嵌套猜测。
import type { SyntaxNode, Tree } from '@lezer/common'
import { matchHtmlTagAt, matchRawHtmlNonElementAt } from './htmlInline'

/** 一个顶层 HTML 块的源文区间（LF 全文 UTF-16 offset，end 不含） */
export interface HtmlBlockSpan {
  from: number
  to: number
}

export interface HtmlDivWrapper {
  open: number
  close: number
  align: string | undefined
}

/** null 开标签对齐值表示属性不受支持，但仍占用相应的闭标签。 */
type HtmlDivTag = { align: string | undefined | null } | 'close'
export type HtmlDivBlock = HtmlDivTag | { hasUnpairedDiv: () => boolean } | null

const DIV_TAG_START = /<\/?div(?=[\s/>]|$)/i
const DIV_TAG_AT = new RegExp(DIV_TAG_START.source, 'iy')

// HTML 的原始文本及 RCDATA 元素：其中看似 div 的字符串不是标签。
const RAW_TEXT_END: Readonly<Record<string, RegExp>> = Object.fromEntries(
  ['script', 'style', 'title', 'textarea', 'iframe', 'xmp', 'noembed', 'noframes']
    .map((name) => [name, new RegExp(`</${name}[\\t\\n\\r\\f ]*>`, 'gi')]),
)

/** 只有整个块恰为一行 div 标签时，才可能成为外壳端点。 */
export function standaloneHtmlDivTag(source: string): HtmlDivTag | null {
  const text = source.trim()
  DIV_TAG_AT.lastIndex = 0
  if (!DIV_TAG_AT.test(text) || text.includes('\n')) return null
  const tag = matchHtmlTagAt(text, 0, text.length)
  if (tag?.end !== text.length || tag.kind === 'atomic') return null
  if (tag.kind === 'close') return 'close'
  const attrs = /^<div(?:[ \t]+align[ \t]*=[ \t]*(["']?)(left|center|right|justify)\1)?[ \t]*>$/i.exec(text)
  return { align: attrs ? attrs[2]?.toLowerCase() : null }
}

/** 分类一个原文 HTML 块。不完整的 div 可能占用块外闭标签，阻断跨块配对。 */
export function classifyHtmlDivBlock(source: string): HtmlDivBlock {
  const tag = standaloneHtmlDivTag(source)
  if (tag !== null || !DIV_TAG_START.test(source)) return tag
  // 只有前面已有待配对的外壳才扫描原生内块；坐标映射保留这份源文分类。
  let unpaired: boolean | undefined
  return { hasUnpairedDiv: () => unpaired ??= hasUnpairedDiv(source) }
}

function hasUnpairedDiv(text: string): boolean {
  const end = text.length
  const foreign: string[] = []
  let depth = 0
  for (let at = text.indexOf('<'); at !== -1;) {
    const rawEnd = matchRawHtmlNonElementAt(text, at, end)
    if (rawEnd !== null) {
      at = text.indexOf('<', rawEnd)
      continue
    }
    const tag = matchHtmlTagAt(text, at, end)
    if (tag === null) {
      if (text.startsWith('<!--', at)) break // 未闭注释的余部仍是字面内容
      DIV_TAG_AT.lastIndex = at
      if (DIV_TAG_AT.test(text)) return true // 半截 div 标签可能是正在编辑的开界
      at = text.indexOf('<', at + 1)
      continue
    }
    if (tag.name === 'div') {
      // div 不是 void 元素，HTML 中的 <div/> 也不会闭合它。
      depth += tag.kind === 'close' ? -1 : 1
      if (depth < 0) return true
    }
    if (tag.name === 'svg' || tag.name === 'math') {
      if (tag.kind === 'open') foreign.push(tag.name)
      if (tag.kind === 'close' && foreign.at(-1) === tag.name) foreign.pop()
    }
    let next = tag.end
    // HTML 的 <title/> 不闭合；SVG/MathML 中的自闭合标签不消费后续块内容。
    if ((tag.kind === 'open' || (tag.kind === 'atomic' && foreign.length === 0)) && Object.hasOwn(RAW_TEXT_END, tag.name)) {
      const close = RAW_TEXT_END[tag.name]!
      close.lastIndex = next
      next = close.test(text) ? close.lastIndex : end
    }
    at = text.indexOf('<', next)
  }
  return depth !== 0
}

/** 配对已经由 Markdown 解析器切开的独立 div 标签。索引用首尾块起点，正文仍由原解析器处理。 */
export function htmlDivWrappersOf(
  blocks: Iterable<{ from: number; div: HtmlDivBlock }>,
): ReadonlyMap<number, HtmlDivWrapper> {
  const wrappers = new Map<number, HtmlDivWrapper>()
  const stack: Array<{ from: number; align: string | undefined | null }> = []
  for (const { from, div } of blocks) {
    if (div === 'close') {
      const open = stack.pop()
      if (open && open.align !== null) {
        const pair = { open: open.from, close: from, align: open.align }
        wrappers.set(pair.open, pair)
        wrappers.set(pair.close, pair)
      }
    } else if (div !== null) {
      if ('align' in div) stack.push({ from, align: div.align })
      else if (stack.length > 0 && div.hasUnpairedDiv()) stack.length = 0
    }
  }
  return wrappers
}

/** 容器节点名：其内的 HTMLBlock 不属于「顶层 HTML 块」（两端一致边界） */
const CONTAINER_NODE_NAMES = new Set(['Blockquote', 'ListItem'])

/**
 * Lezer 树的顶层 HTMLBlock 节点区间（升序）：跳过引用/列表容器内的
 * HTMLBlock（容器内 html 降级为源码——Reading 侧 markdown-it 只在顶层
 * token 循环消费 html_block，两端同边界）。Comment/CommentBlock 是独立
 * 节点名，天然不进本扫描（HTML 注释沿用既有规则）。
 */
export function topLevelHtmlBlockSpansOfTree(tree: Tree): HtmlBlockSpan[] {
  const out: HtmlBlockSpan[] = []
  const visit = (node: SyntaxNode, inContainer: boolean): void => {
    const nextInContainer = inContainer || CONTAINER_NODE_NAMES.has(node.name)
    if (!inContainer && node.name === 'HTMLBlock') {
      out.push({ from: node.from, to: node.to })
      return // HTMLBlock 内部无子 Markdown 节点，不递归
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child, nextInContainer)
    }
  }
  visit(tree.topNode, false)
  return out
}

/**
 * 纯 `<style>` 块判定（Q6A，ADR-0019 决定 7）：块源文（解析器已界定）
 * 整体恰为一个 style 元素（允许首尾空白与属性）。多元素、混排其他内容
 * 或未闭合形态不命中——按普通 html 块走渲染降级路径（保守方向：不把
 * 混排块误判为纯样式块而隐藏内容）。形态检查不递归——style 元素内容
 * 不含 `<style` 即视为单个元素。
 */
export function isPureStyleHtmlBlock(source: string): boolean {
  if (!/^\s*<style\b/i.test(source) || !/<\/style\s*>\s*$/i.test(source)) {
    return false
  }
  // 去掉首尾的 <style …> 开标签与 </style> 闭标签后，体内不得再有 <style
  const openEnd = source.indexOf('>', source.indexOf('<style'))
  const closeStart = source.toLowerCase().lastIndexOf('</style')
  if (openEnd < 0 || closeStart < 0 || openEnd >= closeStart) {
    return false
  }
  return !/<style\b/i.test(source.slice(openEnd + 1, closeStart))
}
