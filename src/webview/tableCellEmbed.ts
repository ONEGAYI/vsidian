// 表格格内嵌入的三套区间映射（工单 #248）：表格单元格内的 `![[…]]` 嵌入
// 在「原始源码（LF 全文 offset）— 表格转义（`\|` 等）— 渲染文字（解码后）」
// 三套坐标之间建立显式映射。核心约束：
//
// - **解码语义**：GFM 表格格内 `\|` 是转义管道（escapeCellText 的逆），
//   `![[B\|别名]]` 的格内语义即 `![[B|别名]]`——别名管道不误切列
//   （splitTableRowCells 的 isEscapedAt 已保证 `\|` 不作列分隔），嵌入
//   inner/目标解析一律用**解码语义**（`B|别名`——`\` 不进目标路径）。
// - **源码区间保真**：occurrence 的 from/to 恒为**原始源码区间**（含
//   `\|` 转义字符本身），写回/索引/rename 都落回源文坐标——绝不用解码
//   字符串 offset 直接写回（解码文本短于源文，offset 必错位）。
// - **单一事实源**：切列判定复用 tableCells（scanCodeSpans/isEscapedAt/
//   splitTableRowCells），嵌入形态学复用 shared/wikilink（scanEmbedsInLine
//   与 parseWikilinkInner），本模块不另起一套扫描器。
//
// 消费端（三处准入 + 索引/rename，全链同源）：
// - Reading 呈现：readingMarkdown 的格内重解析（占位 inner 为解码语义）与
//   embedSlots 的 occurrence 扫描（配对区间为源文）
// - Live 呈现：liveEmbed 的嵌入表（表格行解码扫描，EMIT 层 #248 起开放）
// - 宿主准入与索引：refExpansion.validChildSource（对齐口径）、
//   vaultLinkExtract（嵌入边 target 解码、区间源文）、vaultRename（改写
//   只替换路径段，`\|` 别名与锚点原文保真）
//
// 本模块不依赖 vscode/CM6/DOM（node 单测直驱；宿主与 webview 双产物共用）。
import type { EmbedOccurrence } from '../shared/wikilink'
import { scanEmbedsInLine } from '../shared/wikilink'
import { isEscapedAt, scanCodeSpans, splitTableRowCells } from './tableCells'

/** 格内解码视图：文本 + 逐解码位置到源码位置的映射。
 *  toSourceAt 长度 = text.length + 1，末项为源文本长度（越界端点）；
 *  无转义管道时映射恒等（快路径同构对象）。 */
export interface CellDecodedView {
  /** 解码文本（非代码 span 内的 `\|` 已并为 `|`） */
  text: string
  /** 解码位置 → 源码位置（0 基、同文本坐标系） */
  toSourceAt: number[]
}

/**
 * 构建单元格内容文本的解码视图：非行内代码 span 内、被反斜杠转义的管道
 * （`\|`，isEscapedAt 语义——`\\|` 的 `|` 前导偶数反斜杠不构成转义）解码
 * 为 `|`。`\\`（转义反斜杠字面）与其余 `\X` 不在解码范围（GFM 表格只对
 * 管道有格内转义语义，其余转义交由渲染层）。
 */
export function decodeCellView(cellText: string): CellDecodedView {
  if (!cellText.includes('\\')) {
    const identity = new Array<number>(cellText.length + 1)
    for (let i = 0; i <= cellText.length; i++) {
      identity[i] = i
    }
    return { text: cellText, toSourceAt: identity }
  }
  const inSpan = scanCodeSpans(cellText)
  let text = ''
  const toSourceAt: number[] = []
  let i = 0
  while (i < cellText.length) {
    const ch = cellText[i]!
    if (ch === '\\' && i + 1 < cellText.length && cellText[i + 1] === '|' &&
        !inSpan[i + 1] && isEscapedAt(cellText, i + 1)) {
      // 转义管道：解码视图单字符 |，映射到源码的管道字符位置（反斜杠
      // 位置在解码视图无对应位——line[src]===text[i] 的还原性成立）
      text += '|'
      toSourceAt.push(i + 1)
      i += 2
      continue
    }
    text += ch
    toSourceAt.push(i)
    i += 1
  }
  toSourceAt.push(cellText.length)
  return { text, toSourceAt }
}

/**
 * 表格内容行（表头/数据行）的格内嵌入 occurrence：逐单元格（GFM 语义切分
 * ——`\|` 不切列）构建解码视图后扫描嵌入，命中映射回**原始源码区间**，
 * inner 为解码语义。调用方负责判定该行确为表格内容行（lezer TableRow/
 * TableHeader 或等价形态）；分隔行无嵌入内容天然返回空。
 *
 * - code span 内的嵌入字面量不命中（backticks 先消费——与 markdown-it
 *   渲染、lezer InlineCode 排除、INLINE_SCAN_CODE_CONTEXTS 同向）
 * - 跨单元格的伪形态（`![[x` 与 `]]` 分属两格）不命中（逐格扫描，
 *   单格内不构成完整嵌入）
 * - base 为该行行首的全文 LF offset（缺省 0）
 */
export function scanEmbedsInTableRow(lineText: string, base = 0): EmbedOccurrence[] {
  if (!lineText.includes('![[')) {
    return []
  }
  const out: EmbedOccurrence[] = []
  for (const cell of splitTableRowCells(lineText, 0)) {
    const raw = lineText.slice(cell.from, cell.to)
    if (!raw.includes('![[')) {
      continue
    }
    const view = decodeCellView(raw)
    const inSpan = scanCodeSpans(raw)
    for (const hit of scanEmbedsInLine(view.text)) {
      // code span 内的嵌入字面量：源码起点落在 span 内即排除。起点侧单点
      // 判定与消费端（markdown-it 占位、lezer InlineCode）在「起点/终点
      // 恰好跨界」的病态形态（span 定界反引号与嵌入标记相邻）下同为伪
      // 命中——两侧一致的既有容错（#242 起行级扫描同款边界），不是本
      // 模块新增的分叉面
      const srcHit = view.toSourceAt[hit.from]!
      if (inSpan[srcHit]) {
        continue
      }
      // to 是开区间端点：不能直接取解码位 hit.to 的映射——`]]` 紧贴
      // `\|` 时（`![[B]]\|尾`），hit.to 落在解码缩短点上、其映射指向源码
      // 管道字符位置，区间会多含一枚 `\`。正确端点 = 末字符（hit.to - 1，
      // 恒为 `]`）的源码位 + 1；无缩短点时与直接映射恒等（相邻位差 1）
      out.push({
        from: base + cell.from + srcHit,
        to: base + cell.from + view.toSourceAt[hit.to - 1]! + 1,
        inner: hit.inner,
      })
    }
  }
  return out
}
