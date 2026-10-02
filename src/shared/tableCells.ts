// 表格单元格边界与写回转义（工单 #12）：live 侧表格编辑语义的单一来源。
//
// 设计取舍（首版语义，测试固定；详见 test/unit/tableCells.test.ts 头注释）：
// - 单元格分隔符 = 未转义（非 \|）且不在行内代码 span 内的 |
//   （GFM 规范语义，即 GitHub 实际渲染行为）。@lezer/markdown 与
//   markdown-it 的表格 cell 切分均不识别行内代码内的 |（实测探针确认），
//   因此 live 装饰与编辑钩子不用它们的 TableCell 节点定位单元格，
//   仅用其 TableRow/TableHeader/TableDelimiter 判定「哪些行是表格行」
// - 写回不做重排对齐：单元格编辑直接落在源文本上（CM6 事务），
//   行内其余部分（其他单元格、管道符、缩进）保持不动
// - 键入 | 自动转义为 \|（单元格内容处）；\ 之后（用户手动转义）与
//   行内代码 span 内不转义
// - 行内代码判定为 CommonMark code span 的行内简化扫描：等长反引号串
//   配对；转义反斜杠 \` 不参与配对扫描（罕见形态，已知限制——如实记录
//   于 docs/perf/2026-09-table-cell-editing.md）
//
// 坐标契约：区间一律 LF 全文 UTF-16 code unit offset（与协议 SerChange、
// CodeMirror 文档定位同构）；lineStart 为该行行首 offset。
//
// #13 扩展点：TableCellRange 已携带列结构与对齐上下文（alignAt 调用方从
// 分隔行解析），键盘导航/增删行列在此抽象上扩展，不需要重解析行文本。

import { parseLinePrefix } from '../shared/listPrefix'

/** 单元格区间：from/to 覆盖两管道符之间（含内侧空白），content* 为 trim 后内容 */
export interface TableCellRange {
  from: number
  to: number
  contentFrom: number
  contentTo: number
}

/** 行首容器前缀长度（#296）：格区/控件层没有解析树行身份时的轻量回退。
 *  形态学复用 src/shared/listPrefix（引用层 + 缩进 + 列表标记，含任务
 *  标记）；无前缀（普通行/顶层表格行）为 0。装饰与结构层不经过本函数
 *  ——它们以解析树行身份节点的 prefixLen 为准（单一口径见规格）。 */
export function containerPrefixLen(lineText: string): number {
  const prefix = parseLinePrefix(lineText)
  return prefix ? prefix.quote.length + prefix.indent.length + prefix.mark.length : 0
}

/** 把行首容器前缀替换为等宽空格（#296）：结构性字符（`>`/列表标记）不
 *  参与格拆分，留下的空白交给 splitTableRowCells 的边界容忍消化（无边界
 *  纯空白行 ' | | ' 的前导空白参与格计数，不能剥走）。行内坐标全程无
 *  偏移——调用方继续以行首/原 lineStart 为基准。 */
export function blankContainerPrefix(lineText: string, prefixLen: number): string {
  return prefixLen > 0 ? ' '.repeat(prefixLen) + lineText.slice(prefixLen) : lineText
}

/** 表格格内换行的持久化形式，仅允许无属性的 br。
 * 宽松接受大小写、空格和自闭合写法，以便重新打开已有 Markdown 时同样换行；
 * 带属性标签不在此白名单内，也不应因此打开通用 HTML 渲染。 */
export function tableCellBreakLength(text: string, at: number): number {
  return /^<br[\t ]*\/?>/i.exec(text.slice(at))?.[0].length ?? 0
}

/** 行内代码与转义文本中的 br 仍为字面内容。 */
export function tableCellBreaks(text: string): Array<{ from: number; to: number }> {
  const code = scanCodeSpans(text)
  const breaks: Array<{ from: number; to: number }> = []
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '<' || code[at] || isEscapedAt(text, at)) continue
    const length = tableCellBreakLength(text, at)
    if (length) {
      breaks.push({ from: at, to: at + length })
      at += length - 1
    }
  }
  return breaks
}

/** 列对齐语义（GFM 分隔行声明） */
export type TableAlign = 'left' | 'center' | 'right'

/** 行内代码 span 覆盖表（含定界反引号本身；未配对反引号不构成 span）。
 *  #248 起导出：格内嵌入解码视图（tableCellEmbed）与写回转义共用同一
 *  code span 判定，不另起一套扫描。 */
export function scanCodeSpans(line: string): boolean[] {
  const inSpan = new Array<boolean>(line.length).fill(false)
  let i = 0
  while (i < line.length) {
    if (line[i] === '`') {
      const runStart = i
      while (i < line.length && line[i] === '`') {
        i += 1
      }
      const runLen = i - runStart
      // 向后找等长反引号串（CommonMark：跨长度不配对）
      let j = i
      let closeAt = -1
      while (j < line.length) {
        if (line[j] === '`') {
          let k = j
          while (k < line.length && line[k] === '`') {
            k += 1
          }
          if (k - j === runLen) {
            closeAt = j
            i = k
            break
          }
          j = k
        } else {
          j += 1
        }
      }
      if (closeAt >= 0) {
        for (let p = runStart; p < i; p++) {
          inSpan[p] = true
        }
      }
    } else {
      i += 1
    }
  }
  return inSpan
}

/** 保持行长度不变地遮蔽 code span 内的管道符，供阅读表格解析使用。
 * markdown-it 的表格规则先于 inline code 切格，遮蔽后再从 token 还原原字。
 */
export function maskCodeSpanPipes(line: string, marker: string): string {
  if (!line.includes('|') || !line.includes('`')) {
    return line
  }
  const inSpan = scanCodeSpans(line)
  let changed = false
  const chars = line.split('')
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && inSpan[i]) {
      chars[i] = marker
      changed = true
    }
  }
  return changed ? chars.join('') : line
}

/** 位置 i 的管道符是否被反斜杠转义（前导奇数个连续 \）。
 *  #248 起导出：格内解码视图（tableCellEmbed）复用同一转义判定。 */
export function isEscapedAt(line: string, i: number): boolean {
  let n = 0
  for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) {
    n += 1
  }
  return n % 2 === 1
}

/** 行内位置 i 的 | 是否为未转义、行内代码 span 外的裸管道（单元格分隔口径；
 *  live 装饰的管道符样式与单元格切分共用同一判定，见 liveDecorations） */
export function barePipeAt(lineText: string, i: number): boolean {
  if (lineText[i] !== '|') {
    return false
  }
  if (isEscapedAt(lineText, i)) {
    return false
  }
  return !scanCodeSpans(lineText)[i]
}

/** 非代码 span 中被反斜杠转义的管道符，其紧邻的反斜杠位置。网格显示
 * 隐藏这一枚转义标记，源文本及编辑行为保持不变。 */
export function escapedPipeBackslashes(lineText: string): number[] {
  if (!lineText.includes('\\|')) return []
  const inSpan = scanCodeSpans(lineText)
  const out: number[] = []
  for (let i = 1; i < lineText.length; i++) {
    if (lineText[i] === '|' && !inSpan[i] && isEscapedAt(lineText, i)) {
      out.push(i - 1)
    }
  }
  return out
}

/**
 * GFM 语义切分一行表格行为单元格。
 * 调用方负责判定该行确为表格行（表头/数据行）；非表格行（无裸管道）返回 []。
 * 行首/行尾边界管道符不产生空单元格；中间空段是空单元格（零宽内容）。
 * prefixLen（#296 审查轮）：行首容器前缀宽。内部把前缀替换为等宽空格参与
 * 切分（结构字符不入格），并把首格 from clamp 到前缀右端——无边界行
 * （> a | b）的首段含内容不会被 shift，不 clamp 时前缀区会被算进首格
 * 区间（插列管道落到 > 之前、删列吞 >、格值带前缀）。坐标零偏移。
 */
export function splitTableRowCells(lineText: string, lineStart: number, prefixLen = 0): TableCellRange[] {
  const text = blankContainerPrefix(lineText, prefixLen)
  if (!text.includes('|')) {
    return []
  }
  const inSpan = scanCodeSpans(text)
  const segs: Array<{ from: number; to: number }> = []
  let segStart = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && !inSpan[i] && !isEscapedAt(text, i)) {
      segs.push({ from: segStart, to: i })
      segStart = i + 1
    }
  }
  segs.push({ from: segStart, to: text.length })
  // 纯空白行且首尾没有实际边界管道时，每段空白都是一个单元格：
  // ` | ` 为两格，` | | ` 为三格。若行首/行尾有管道，或行内有内容，
  // 则首尾空白段是边界外的缩进/尾随空白，不计入单元格。
  const hasContent = segs.some((seg) => text.slice(seg.from, seg.to).trim() !== '')
  const hasEdgePipe = segs[0]!.from === segs[0]!.to ||
    segs[segs.length - 1]!.from === segs[segs.length - 1]!.to
  if (hasContent || hasEdgePipe) {
    if (segs.length > 0 && text.slice(segs[0]!.from, segs[0]!.to).trim() === '') {
      segs.shift()
    }
    if (segs.length > 0 && text.slice(segs[segs.length - 1]!.from, segs[segs.length - 1]!.to).trim() === '') {
      segs.pop()
    }
  }
  const cells = segs.map((seg) => {
    const raw = text.slice(seg.from, seg.to)
    const lead = raw.length - raw.trimStart().length
    const trail = raw.length - raw.trimEnd().length
    const contentFrom = lineStart + seg.from + lead
    const contentTo = Math.max(contentFrom, lineStart + seg.to - trail)
    return {
      from: lineStart + seg.from,
      to: lineStart + seg.to,
      contentFrom,
      contentTo,
    }
  })
  // 首格 from clamp 到前缀右端（前缀区不可入格；from ≤ to 防御）
  if (prefixLen > 0 && cells.length > 0) {
    const first = cells[0]!
    const from = Math.min(Math.max(first.from, lineStart + prefixLen), first.to)
    if (from !== first.from) {
      cells[0] = { ...first, from }
    }
  }
  return cells
}

/**
 * 表格网格需要每个显示格有独立源区间。仅在纯空白且省略边界管道的行上，
 * 允许按表头列数舍弃多余的尾部空白段；含内容的多列行仍拒绝映射。
 * prefixLen 语义同 splitTableRowCells（#296 审查轮）。
 */
export function tableRowCellsForColumns(
  lineText: string,
  lineStart: number,
  columns: number,
  prefixLen = 0,
): TableCellRange[] | null {
  const cells = splitTableRowCells(lineText, lineStart, prefixLen)
  if (cells.length === columns) return cells
  if (columns > 0 && cells.length === columns + 1 &&
      /^[\s|]+$/.test(blankContainerPrefix(lineText, prefixLen)) &&
      lineText[0] !== '|' && lineText[lineText.length - 1] !== '|') {
    return cells.slice(0, columns)
  }
  return null
}

/** 首次写入无边界纯空白行时，在同一事务中规范化为显式边界并填目标格。
 *  prefixLen（#296 审查轮）：引用/列表内的纯空白行同样规范化，canonical
 *  重建保留行首前缀（原文照抄），坐标以行首为基准零偏移。 */
export function planBlankRowCellInput(
  lineText: string,
  lineStart: number,
  columns: number,
  from: number,
  to: number,
  insert: string,
  prefixLen = 0,
): { from: number; to: number; insert: string; selection: number } | null {
  const blanked = blankContainerPrefix(lineText, prefixLen)
  if (from !== to || !insert || insert.includes('\n') || !/^[\s|]+$/.test(blanked) ||
      blanked[0] === '|' || blanked[blanked.length - 1] === '|') return null
  const cells = tableRowCellsForColumns(lineText, lineStart, columns, prefixLen)
  if (!cells) return null
  const column = cells.findIndex((cell) => cell.contentFrom === from)
  if (column < 0) return null
  const prefix = lineText.slice(0, prefixLen)
  const canonical = prefix + '|' + ' |'.repeat(columns)
  const target = splitTableRowCells(canonical, lineStart, prefixLen)[column]!.contentFrom
  const relative = target - lineStart
  const escaped = escapeCellText(insert)
  return {
    from: lineStart,
    to: lineStart + lineText.length,
    insert: canonical.slice(0, relative) + escaped + canonical.slice(relative),
    selection: target + escaped.length,
  }
}

/**
 * 分隔行判定与列对齐：`---`/`:---`/`:---:`/`:---:` 序列。
 * 非分隔行返回 null。允许省略首尾边界管道与段内空格。
 * prefixLen 语义同 splitTableRowCells（#296 审查轮）：引用分隔行原文
 * 直接解析（等宽替换下 contentFrom 在原文与 blank 文本中同指）。
 */
export function parseTableDelimiter(lineText: string, prefixLen = 0): Array<TableAlign | null> | null {
  const cells = splitTableRowCells(lineText, 0, prefixLen)
  if (cells.length === 0) {
    return null
  }
  const aligns: Array<TableAlign | null> = []
  for (const cell of cells) {
    const t = lineText.slice(cell.contentFrom, cell.contentTo)
    if (!/^:?-+:?$/.test(t)) {
      return null
    }
    const left = t.startsWith(':')
    const right = t.endsWith(':')
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null)
  }
  return aligns
}

/**
 * 键入 | 的转义判定：在表格行 lineText 的插入点 pos 处（相对行首）键入 |
 * 是否须写为 \|。
 * - 行首/行尾：边界管道语义，不转义
 * - 前一字符是 \：用户手动转义已就位，不重复
 * - 行内代码 span 内（GFM 语义内管道不切分）：不转义
 * - 其余：转义
 */
export function needsPipeEscapeAt(lineText: string, pos: number): boolean {
  if (pos <= 0 || pos >= lineText.length) {
    return false
  }
  if (lineText[pos - 1] === '\\') {
    return false
  }
  const inSpan = scanCodeSpans(lineText)
  return !inSpan[pos]
}

/**
 * 写回内容持久化形式（单一事实源，键入/粘贴/跨格替换共用）：换行写为
 * `<br>`（一格一源行），文本中的裸 |（行内代码 span 外、未被 \ 转义）
 * 转义为 \|——span 内与已转义的管道保持原样，与键入路径
 * tablePipeKeyHandler 的逐位置判定同口径。
 * 单元格内容经此函数写回后，保存回读与再渲染保持单格语义。
 */
export function escapeCellText(text: string): string {
  const bridged = text.replace(/\r?\n/g, '<br>')
  if (!bridged.includes('|')) {
    return bridged
  }
  const text$ = bridged
  const inSpan = scanCodeSpans(text$)
  let out = ''
  for (let i = 0; i < text$.length; i++) {
    if (text$[i] === '|' && !inSpan[i] && !isEscapedAt(text$, i)) {
      out += '\\|'
    } else {
      out += text$[i]
    }
  }
  return out
}

// ---- #296 二轮：引用内表格的前缀一致性判定（live/reading 同源语义） ----

/** 行首引用层级：行首到首个非空白非 `>` 字符之间的 `>` 个数。
 *  `> > x` 与 `>>x` 均为 2；`  | x` 为 0；`> - x` 为 1（列表标记停）。 */
export function quoteDepthOfLine(text: string): number {
  let depth = 0
  for (const ch of text) {
    if (ch === '>') depth += 1
    else if (!/\s/.test(ch)) break
  }
  return depth
}

/** 引用表前缀残缺判定（形态学）：headerIdx 为表头行号。从表头起逐行扫
 *  连续的表格形态行（含管道）：分隔行（去空白/管道/冒号/`>` 后为 ≥3 连
 *  字符 `-`，含 lazy 无前缀形态）豁免；数据行引用层级 ≠ 表头即残缺。
 *  顶层表头（层级 0）恒不残缺。live 侧由树内行集合同义校验（分隔行不进
 *  行集合，天然豁免），两侧对同一源文给出一致结论。 */
export function quoteTableRowsDegraded(lines: readonly string[], headerIdx: number): boolean {
  const headerDepth = quoteDepthOfLine(lines[headerIdx] ?? '')
  if (headerDepth === 0) return false
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.includes('|')) break
    // 去空白/管道/冒号/引用符/反斜杠后为 ≥3 连字符 → 分隔行（含 lazy）
    const stripped = line.replace(/[\s|:>]/g, '').replaceAll('\\', '')
    if (/^-{3,}$/.test(stripped)) continue
    if (quoteDepthOfLine(line) !== headerDepth) return true
  }
  return false
}
