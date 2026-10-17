// 块级 HTML 边界共享事实源（#567/T02，规格「HTML 范围与源文」）：
// - 顶层 HTML 块区间从两端解析器**既有产出**派生（Live：Lezer
//   markdownLanguage 的 HTMLBlock 节点；Reading：markdown-it html_block
//   token），不新写正则猜测嵌套范围——本模块只做「Lezer 树 → 顶层块区间
//   集合」的派生与纯 <style> 形态判定，两端一致性由对拍测试钉住
//   （test/unit/htmlBlock.test.ts）。
// - 容器排除（引用/列表内的 html 块两端一致降级为源码呈现）：Lezer 侧
//   按祖先链排除；markdown-it 侧天然只消费顶层 token（readingBlocks 的
//   level-0 token 循环）。该边界移入容器属后续票，不随本票顺手放宽。
// - 纯 <style> 块（Q6A）：Live 源码常显不占位、Reading 隐藏（T04 收集器
//   从源文装载）。判定是解析器已界定块内的形态检查，不是嵌套猜测。
import type { SyntaxNode, Tree } from '@lezer/common'

/** 一个顶层 HTML 块的源文区间（LF 全文 UTF-16 offset，end 不含） */
export interface HtmlBlockSpan {
  from: number
  to: number
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
