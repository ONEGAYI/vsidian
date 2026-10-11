// 表格键盘导航、增删行列与拖排行的纯函数层（工单 #13 + #43）。
//
// 职责分工：行身份（哪些行构成表格）由解析树判定（tableEditing 从
// liveDecorationsField 的树提取 TableRowInfo 后传入）；本模块只做字符串
// 与区间运算，不依赖 CM6/DOM，语义由 test/unit/tableStructure.test.ts 固定。
//
// 语义（首版，构建于 #12 的 tableCells 抽象上）：
// - 导航：Tab 落下一单元格内容首（行末环绕到下一表格行首格）；Shift+Tab
//   落上一单元格内容尾（行首回退到上一表格行末格）；表格首行首格回退与
//   末行末格前进返回 null——上层交默认行为（不吞输入）
// - 插入行：数据行前/后插入空数据行（格数 = 分隔行列数）；表头/分隔行上
//   的插入统一落到分隔行之后（表头上方或表头与分隔行之间插数据行会拆表）
// - 删除行：数据行直接删（光标落相邻行同列格）；删表头 = 首个数据行升格
//   为新表头、分隔行随移到升格行之后（对齐信息保留）；只剩表头时删整表；
//   单独删分隔行拒绝（返回 null，零变更）
// - 插入/删除列：最小插入/删除法（不重建行）——既有单元格文本（含转义
//   管道与行内代码）逐字节保留；分隔行同步增删对应段（对齐信息随列走）；
//   缺该列的行不动；边界管道省略的行（a | b 形态）同样正确
// - 一切变更只落在表格行区间内，表格外文本逐字节不变
//
// 坐标契约：全文 UTF-16 code unit offset（与协议 SerChange、CM6 同构）；
// selection 为应用 changes 之后的新文档坐标。
import { barePipeAt, blankContainerPrefix, parseTableDelimiter, splitTableRowCells, tableRowCellsForColumns, type TableCellRange } from '../shared/tableCells'
import type { TableEditOp } from '../shared/protocol'

/** 表格行身份（解析树判定后传入；行区间不含换行） */
export interface TableRowInfo {
  kind: 'header' | 'delimiter' | 'row'
  /** 行首全文 offset */
  lineFrom: number
  /** 行尾（不含换行）全文 offset */
  lineTo: number
  /** 容器前缀长度（#296）：行首到表格结构起点的距离（引用层+缩进+列表
   *  标记；lazy 行为 0）。缺省 0——顶层表格行为不变。格解析与结构重建
   *  一律以前缀之后的内容段为运算对象，整行删除区间仍从行首起。 */
  prefixLen?: number
}

/** 一次结构操作的规划结果：changes 与操作后光标落点（新文档坐标） */
export interface PlannedTableEdit {
  changes: Array<{ from: number; to: number; insert: string }>
  selection: number
}

/**
 * 把一个内容行插入到目标槽位之前。索引只数表头与数据行，不数分隔行；
 * slot 可为内容行数，表示插到末尾。只替换内容行字符，不触碰分隔行或换行符。
 * 返回的全部 changes 供 CM6 以一笔事务派发。
 * cursor（可选）给定时返回 selection：光标随所在内容行的文本一起搬到新物理
 * 行——保留行内偏移，行首按**置换后**的各槽位文本累计（各物理行接收的
 * 新文本长度不同，后续行起点随之前方槽位的长度差平移；审查轮实证修复）。
 * 光标不在内容行上（表外/分隔行）时不给 selection——CM6 默认映射即正确
 * （#296 六轮：默认映射把替换区间内部的光标归到区间左端，引用表上恰落
 * 前缀区端点触发显形、网格破裂）。doc 须为 LF 形态（webview 协议契约，
 * 行间恰一个换行的累计假设才成立）。
 */
export function planTableRowMove(
  doc: string,
  rows: TableRowInfo[],
  source: number,
  slot: number,
  cursor?: number,
): Pick<PlannedTableEdit, 'changes'> & { selection?: number } | null {
  if (rows.length < 3 || rows[0]?.kind !== 'header' || rows[1]?.kind !== 'delimiter' ||
      rows.slice(2).some((r) => r.kind !== 'row')) {
    return null
  }
  const content = [rows[0]!, ...rows.slice(2)]
  if (!Number.isInteger(source) || !Number.isInteger(slot) || source < 0 ||
      source >= content.length || slot < 0 || slot > content.length ||
      slot === source || slot === source + 1) {
    return null
  }
  if (rows.some((r) => r.lineFrom < 0 || r.lineTo < r.lineFrom || r.lineTo > doc.length)) {
    return null
  }
  const texts = content.map((r) => doc.slice(r.lineFrom, r.lineTo))
  const reordered = [...texts]
  const [moved] = reordered.splice(source, 1)
  reordered.splice(slot > source ? slot - 1 : slot, 0, moved!)
  const changes: PlannedTableEdit['changes'] = []
  for (let i = 0; i < content.length; i++) {
    if (texts[i] !== reordered[i]) {
      changes.push({
        from: content[i]!.lineFrom,
        to: content[i]!.lineTo,
        insert: reordered[i]!,
      })
    }
  }
  if (changes.length === 0) {
    return null
  }
  let selection: number | undefined
  if (cursor !== undefined) {
    const c = content.findIndex((r) => cursor >= r.lineFrom && cursor <= r.lineTo)
    if (c >= 0) {
      const insertAt = slot > source ? slot - 1 : slot
      let c2: number
      if (c === source) {
        c2 = insertAt
      } else {
        c2 = c > source ? c - 1 : c
        if (c2 >= insertAt) {
          c2++
        }
      }
      // 目标槽位新行首：物理布局 [槽0, 分隔行, 槽1, 槽2, ...]——槽 0 行首
      // 不变；槽 k≥1 的行首越过槽 0 新文本、分隔行（不置换、长度不变）与
      // 前方各槽位的新文本累计（每行 +1 换行）
      let targetFrom = rows[0]!.lineFrom
      if (c2 > 0) {
        const delimLen = rows[1]!.lineTo - rows[1]!.lineFrom
        targetFrom += reordered[0]!.length + 1 + delimLen + 1
        for (let j = 1; j < c2; j++) {
          targetFrom += reordered[j]!.length + 1
        }
      }
      selection = targetFrom + (cursor - content[c]!.lineFrom)
    }
  }
  return { changes, selection }
}

/** 将整列插入到目标槽位，分隔行对齐段与各内容行一同移动。
 *  cursor（可选）给定时返回 selection：光标随所在格内容一起搬到新列位置
 *  （保留内容内偏移，clamp 到新内容长度）；光标在行首容器前缀区（cursor <
 *  lineFrom + prefixLen）时保留行内偏移——前缀不参与列交换、字符级不变，
 *  「前缀显形编辑态」随行守恒（审查轮 F7）；光标不在内容行上（表外/分隔
 *  行）时不给 selection，理由同 planTableRowMove。doc 须为 LF 形态（webview
 *  协议契约）。 */
export function planTableColumnMove(
  doc: string,
  rows: TableRowInfo[],
  source: number,
  slot: number,
  cursor?: number,
): Pick<PlannedTableEdit, 'changes'> & { selection?: number } | null {
  if (rows[0]?.kind !== 'header' || rows[1]?.kind !== 'delimiter') return null
  const columns = parseTableDelimiter(doc.slice(rows[1]!.lineFrom, rows[1]!.lineTo), prefixLenOf(rows[1!]))?.length
  if (!columns || !Number.isInteger(source) || !Number.isInteger(slot) || source < 0 ||
      source >= columns || slot < 0 || slot > columns || slot === source || slot === source + 1) return null
  const changes: PlannedTableEdit['changes'] = []
  const newLineTexts: string[] = []
  let cursorInfo: { rowIdx: number; col: number; offset: number; inPrefix: boolean } | null = null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const p = prefixLenOf(row)
    const lineText = doc.slice(row.lineFrom, row.lineTo)
    const cells = tableRowCellsForColumns(lineText, row.lineFrom, columns, p)
    if (!cells || cells.length !== columns) return null
    if (cursor !== undefined && !cursorInfo && row.kind !== 'delimiter' &&
        cursor >= row.lineFrom && cursor <= row.lineTo) {
      if (cursor < row.lineFrom + p) {
        cursorInfo = { rowIdx: i, col: -1, offset: cursor - row.lineFrom, inPrefix: true }
      } else {
        const col = columnOf(cells, cursor)
        const cell = cells[col]!
        cursorInfo = {
          rowIdx: i,
          col,
          offset: Math.min(Math.max(cursor - cell.contentFrom, 0), cell.contentTo - cell.contentFrom),
          inPrefix: false,
        }
      }
    }
    const values = cells.map((cell) => doc.slice(cell.from, cell.to))
    const [moved] = values.splice(source, 1)
    values.splice(slot > source ? slot - 1 : slot, 0, moved!)
    const insert = '|' + values.join('|') + '|'
    newLineTexts.push(lineText.slice(0, p) + insert)
    if (insert !== doc.slice(row.lineFrom + p, row.lineTo)) {
      changes.push({ from: row.lineFrom + p, to: row.lineTo, insert })
    }
  }
  if (!changes.length) return null
  let selection: number | undefined
  if (cursorInfo) {
    const { rowIdx, col, offset, inPrefix } = cursorInfo
    // 表内行连续（含分隔行）；基准锚在首行行首，加上前方各行的新长度
    let lineFrom = rows[0]!.lineFrom
    for (let k = 0; k < rowIdx; k++) {
      lineFrom += newLineTexts[k]!.length + 1
    }
    if (inPrefix) {
      selection = lineFrom + offset
    } else {
      const insertAt = slot > source ? slot - 1 : slot
      let col2: number
      if (col === source) {
        col2 = insertAt
      } else {
        col2 = col > source ? col - 1 : col
        if (col2 >= insertAt) {
          col2++
        }
      }
      const p = prefixLenOf(rows[rowIdx]!)
      const newCells = tableRowCellsForColumns(newLineTexts[rowIdx]!, 0, columns, p)
      const cell = newCells?.[col2]
      if (cell) {
        selection = lineFrom + cell.contentFrom +
          Math.min(offset, cell.contentTo - cell.contentFrom)
      }
    }
  }
  return { changes, selection }
}

/** 行容器前缀长度（缺省 0） */
export function prefixLenOf(row: TableRowInfo): number {
  return row.prefixLen ?? 0
}

/**
 * 单行引用层级变换（#437 表格右键簇；逐行独立——blockquote-table 规格
 * 契约 5 口径，不一表一常量）：
 * - delta=+1：行首补 `> `（顶层 0 层同样可加）；
 * - delta=-1：剥掉首个 `>` 及其后至多一个空格（`>>` 紧贴形态只剥首个
 *   `>`；行首空白保留）；无引用前缀的行（lazy 分隔行）原样保留返回 null。
 * 返回 null 表示该行无变化。
 */
export function changeLineQuoteLevel(text: string, delta: -1 | 1): string | null {
  if (delta === 1) {
    return `> ${text}`
  }
  const m = /^(\s*)> ?/.exec(text)
  if (!m) {
    return null
  }
  return `${m[1] ?? ''}${text.slice(m[0].length)}`
}

/**
 * 表格引用层级统一增/删一层（#437 右键簇「移除引用块 / 增一层引用」，
 * blockquote-table 三轮职能转移项）：对全部物理行（表头/分隔/数据行）逐行
 * 独立变换，changes 合一为单笔事务（宿主撤销一次）。层级一致性（enable）
 * 由菜单谓词按 TableMenuHit 判定——残缺表置灰不做猜测修复，本函数不做
 * 一致性校验（逐行独立运算天然安全）。无任何变更（如顶层表减层）返回
 * null。cursor 给出且落在表内行上时 selection 按行内偏移跟随新行文本
 * （不落前缀端点触发显形——#296 六轮口径）；否则 selection 为表头行
 * lineFrom 兜底（调用方也可走默认映射）。
 */
export function planTableQuoteLevel(
  doc: string,
  rows: TableRowInfo[],
  delta: -1 | 1,
  cursor?: number,
): PlannedTableEdit | null {
  if (rows.length === 0) {
    return null
  }
  const changes: PlannedTableEdit['changes'] = []
  let selection = rows[0]!.lineFrom
  let cursorRow = -1
  let cursorOffset = 0
  if (cursor !== undefined) {
    cursorRow = rowIndexOf(rows, cursor)
    if (cursorRow >= 0) {
      cursorOffset = cursor - rows[cursorRow]!.lineFrom
    }
  }
  // 新文档行首游标：按各行**变换后**文本长度累计（selection 是应用 changes
  // 之后的新文档坐标——前方各行的前缀增删同样平移本行，与
  // planTableColumnMove 的按新文本累计行首同法）
  let nextLineFrom = rows[0]!.lineFrom
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const text = doc.slice(row.lineFrom, row.lineTo)
    const next = changeLineQuoteLevel(text, delta)
    if (next === null) {
      if (i === cursorRow) {
        selection = nextLineFrom + cursorOffset // 无变化行：行内偏移照旧，行首按前方平移
      }
      nextLineFrom += text.length + 1
      continue
    }
    changes.push({ from: row.lineFrom, to: row.lineTo, insert: next })
    if (i === cursorRow) {
      // 行首前缀增删使行内内容平移（next - text 长度差）：光标按平移量
      // 跟随原内容（clamp 在新行内），不落前缀端点触发显形（#296 六轮口径）
      selection = nextLineFrom +
        Math.max(0, Math.min(cursorOffset + next.length - text.length, next.length))
    }
    nextLineFrom += next.length + 1
  }
  return changes.length ? { changes, selection } : null
}

/** pos 所在行（区间含端点）；未命中返回 -1 */
function rowIndexOf(rows: TableRowInfo[], pos: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (pos >= rows[i]!.lineFrom && pos <= rows[i]!.lineTo) {
      return i
    }
  }
  return -1
}

/** pos 所在列：最后一个 from <= pos 的单元格（管道上归右格；行首管道归首格） */
function columnOf(cells: TableCellRange[], pos: number): number {
  let col = 0
  for (let k = 0; k < cells.length; k++) {
    if (cells[k]!.from <= pos) {
      col = k
    } else {
      break
    }
  }
  return col
}

/**
 * 单元格导航目标。forward=true 为 Tab（下一格内容首），false 为 Shift+Tab
 * （上一格内容尾）。首行首格回退、末行末格前进、非表格行上下文均返回 null。
 */
export function tableCellNavTarget(
  doc: string,
  rows: TableRowInfo[],
  pos: number,
  forward: boolean,
): number | null {
  const i = rowIndexOf(rows, pos)
  if (i < 0) {
    return null
  }
  const row = rows[i]!
  const delimiter = rows.find((entry) => entry.kind === 'delimiter')
  const columns = delimiter
    ? parseTableDelimiter(doc.slice(delimiter.lineFrom, delimiter.lineTo), prefixLenOf(delimiter))?.length
    : undefined
  const cellsOf = (entry: TableRowInfo): TableCellRange[] => {
    const text = doc.slice(entry.lineFrom, entry.lineTo)
    return columns && entry.kind !== 'delimiter'
      ? tableRowCellsForColumns(text, entry.lineFrom, columns, prefixLenOf(entry)) ??
        splitTableRowCells(text, entry.lineFrom, prefixLenOf(entry))
      : splitTableRowCells(text, entry.lineFrom, prefixLenOf(entry))
  }
  const cells = cellsOf(row)
  if (cells.length === 0) {
    return null
  }
  const col = columnOf(cells, pos)
  if (forward) {
    if (col + 1 < cells.length) {
      return cells[col + 1]!.contentFrom
    }
    const next = rows[i + 1]
    if (!next) {
      return null
    }
    const nextCells = cellsOf(next)
    return nextCells.length > 0 ? nextCells[0]!.contentFrom : null
  }
  if (col - 1 >= 0) {
    return cells[col - 1]!.contentTo
  }
  const prev = rows[i - 1]
  if (!prev) {
    return null
  }
  const prevCells = cellsOf(prev)
  return prevCells.length > 0 ? prevCells[prevCells.length - 1]!.contentTo : null
}

/** 行尾边界裸管道的行内位置（其后仅空白才算；无则 -1） */
function trailingBarePipeRel(text: string): number {
  const end = text.trimEnd().length
  if (end === 0) {
    return -1
  }
  const i = end - 1
  return text[i] === '|' && barePipeAt(text, i) ? i : -1
}

/** 生成 n 个空单元格的新数据行（'| | |' 形态） */
function emptyRowText(n: number): string {
  return '|' + ' |'.repeat(Math.max(1, n))
}

/**
 * 规划一次表格结构操作。返回 null = 该上下文不可操作（零变更）：
 * 光标不在表格行上、单独删分隔行等。
 */
export function planTableEdit(
  doc: string,
  rows: TableRowInfo[],
  pos: number,
  op: TableEditOp,
): PlannedTableEdit | null {
  const i = rowIndexOf(rows, pos)
  if (i < 0) {
    return null
  }
  const delimIdx = rows.findIndex((r) => r.kind === 'delimiter')
  if (delimIdx < 0) {
    return null
  }
  // 两种行文本语义：fullText 整行含前缀（删除/随移/拖排的单位）；
  // 格切分经 prefixLen 参数内建前缀感知（#296 审查轮——blank+首格 clamp
  // 见 tableCells.splitTableRowCells），坐标以行首为基准零偏移
  const fullText = (r: TableRowInfo): string => doc.slice(r.lineFrom, r.lineTo)
  const rowCells = (r: TableRowInfo): TableCellRange[] =>
    splitTableRowCells(fullText(r), r.lineFrom, prefixLenOf(r))
  /** 该行前缀原文（插行补前缀用；参照行的容器层级） */
  const prefixTextOf = (r: TableRowInfo): string => doc.slice(r.lineFrom, r.lineFrom + prefixLenOf(r))
  const cursorCells = rowCells(rows[i]!)
  if (cursorCells.length === 0) {
    return null
  }
  const col = columnOf(cursorCells, pos)
  /** 光标行同列（clamp）格内容首；无格时行首 */
  const focusOfCells = (cells: TableCellRange[], lineFrom: number, c: number): number =>
    cells.length > 0 ? cells[Math.min(c, cells.length - 1)]!.contentFrom : lineFrom

  switch (op) {
    case 'insertRowAbove':
    case 'insertRowBelow': {
      // 表头/分隔行上的插入统一落到分隔行后（数据区首）；数据行按上/下
      const insertAt = rows[i]!.kind === 'row' ? (op === 'insertRowAbove' ? i : i + 1) : delimIdx + 1
      const newRow = emptyRowText(rowCells(rows[delimIdx]!).length)
      if (insertAt < rows.length) {
        // 新行带参照行（插入落点行）的容器前缀：引用/列表内插行保持层级（#296）
        const target = rows[insertAt]!
        const prefix = prefixTextOf(target)
        const from = target.lineFrom
        return { changes: [{ from, to: from, insert: `${prefix}${newRow}\n` }], selection: from + prefix.length + 2 }
      }
      // 表格末尾追加（挂在末行换行之后；末行无换行则补）；同样携带末行前缀
      const lastRow = rows[rows.length - 1]!
      const at = lastRow.lineTo
      const tailPrefix = prefixTextOf(lastRow)
      return { changes: [{ from: at, to: at, insert: `\n${tailPrefix}${newRow}` }], selection: at + 1 + tailPrefix.length + 2 }
    }
    case 'deleteRow': {
      const row = rows[i]!
      if (row.kind === 'delimiter') {
        return null // 结构行：单独删除即拆表，拒绝
      }
      if (row.kind === 'header') {
        if (rows.length <= delimIdx + 1) {
          return { changes: [{ from: rows[0]!.lineFrom, to: rows[rows.length - 1]!.lineTo, insert: '' }],
            selection: rows[0]!.lineFrom }
        }
        // 删表头 = 首个数据行升为新表头：GFM 要求分隔行紧跟表头，升格须把
        // 分隔行移到升格行之后（对齐信息随分隔行文本原样保留——整行随移，
        // lazy 无前缀分隔行落位后仍合法）——单纯删除表头行会让分隔行成为
        // 表格首行，整表退化为普通段落
        const delim = rows[delimIdx]!
        const successor = rows[delimIdx + 1]!
        const successorHasNl = successor.lineTo < doc.length
        const promotedFrom = successorHasNl ? successor.lineTo + 1 : successor.lineTo
        const promotedInsert = successorHasNl
          ? `${fullText(delim)}\n`
          : `\n${fullText(delim)}`
        const changes: PlannedTableEdit['changes'] = [
          { from: row.lineFrom, to: row.lineTo + 1, insert: '' },
          { from: delim.lineFrom, to: delim.lineTo + 1, insert: '' },
          { from: promotedFrom, to: promotedFrom, insert: promotedInsert },
        ]
        const removed = row.lineTo + 1 - row.lineFrom + (delim.lineTo + 1 - delim.lineFrom)
        const newLineFrom = successor.lineFrom - removed
        const cells = splitTableRowCells(fullText(successor), newLineFrom, prefixLenOf(successor))
        return { changes, selection: focusOfCells(cells, newLineFrom, col) }
      }
      // 数据行：优先与后继换行合并删除；文件尾无换行时回纳前行换行
      const hasNl = row.lineTo < doc.length
      const changes = hasNl
        ? [{ from: row.lineFrom, to: row.lineTo + 1, insert: '' }]
        : [{ from: row.lineFrom - 1, to: row.lineTo, insert: '' }]
      const len = hasNl ? row.lineTo + 1 - row.lineFrom : row.lineTo - row.lineFrom + 1
      const target = i + 1 < rows.length ? rows[i + 1]! : rows[i - 1]!
      const newLineFrom = i + 1 < rows.length ? target.lineFrom - len : target.lineFrom
      const cells = splitTableRowCells(fullText(target), newLineFrom, prefixLenOf(target))
      return { changes, selection: focusOfCells(cells, newLineFrom, col) }
    }
    case 'insertColumnLeft':
    case 'insertColumnRight': {
      const newCol = op === 'insertColumnLeft' ? col : col + 1
      const changes: PlannedTableEdit['changes'] = []
      let focus = -1
      let delta = 0 // 光标行之前各行的插入总长（内容首右移量；与前缀无关）
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!
        const p = prefixLenOf(row)
        const text = blankContainerPrefix(fullText(row), p)
        const cells = rowCells(row)
        const c = Math.min(newCol, cells.length)
        let insertAtRel: number
        let piece: string
        if (c === 0 && cells.length > 0 && cells[0]!.from - row.lineFrom <= p) {
          // 目标列是首格且该行无左边界管道（无边界行，#296 审查轮）：
          // 「空格+管道」会与行首（前缀）空白融合、列数不增——顶层无边界
          // 行基线即此静默无效；改产「管道开头」形态：新边界 + 新空列
          insertAtRel = p
          piece = row.kind === 'delimiter' ? '| --- |' : '| |'
        } else if (c < cells.length) {
          // 目标列已有格：在其区间起点（前管道之后）插入「空格+管道」
          insertAtRel = cells[c]!.from - row.lineFrom
          piece = row.kind === 'delimiter' ? ' --- |' : ' |'
        } else {
          const lp = trailingBarePipeRel(text)
          if (lp >= 0) {
            // 行尾边界管道之后追加
            insertAtRel = lp + 1
            piece = row.kind === 'delimiter' ? ' --- |' : ' |'
          } else {
            // 无尾边界管道：行尾补「管道 + 空格 + 边界管道」形态
            insertAtRel = text.length
            piece = row.kind === 'delimiter' ? ' | ---' : ' | |'
          }
        }
        if (r === i) {
          const newText = text.slice(0, insertAtRel) + piece + text.slice(insertAtRel)
          const newCells = splitTableRowCells(newText, row.lineFrom + delta, p)
          focus = focusOfCells(newCells, row.lineFrom + delta, newCol)
        }
        if (r < i) {
          delta += piece.length
        }
        changes.push({ from: row.lineFrom + insertAtRel, to: row.lineFrom + insertAtRel, insert: piece })
      }
      return focus >= 0 ? { changes, selection: focus } : null
    }
    case 'deleteColumn': {
      // 唯一列删除整表，避免留下裸管道构成残缺源码。
      if (rowCells(rows[delimIdx]!).length <= 1) {
        return { changes: [{ from: rows[0]!.lineFrom, to: rows[rows.length - 1]!.lineTo, insert: '' }],
          selection: rows[0]!.lineFrom }
      }
      const changes: PlannedTableEdit['changes'] = []
      let focus = -1
      let delta = 0 // 光标行之前各行的删除总长（内容首左移量；与前缀无关）
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!
        const p = prefixLenOf(row)
        const text = blankContainerPrefix(fullText(row), p)
        const cells = rowCells(row)
        if (col >= cells.length) {
          continue // 该行缺此列：不动
        }
        let delFromRel: number
        let delToRel: number
        if (col > 0 || cells[0]!.from - row.lineFrom > 0) {
          // 常态：删该格及其前管道（含内侧空白）。格前位置落进容器前缀区
          // 时收在前缀右端——无边界行删首列不动前缀（#296 审查轮）
          delFromRel = Math.max(p, cells[col]!.from - row.lineFrom - 1)
          delToRel = cells[col]!.to - row.lineFrom
        } else {
          // 首格且行首无边界管道：删该格及其后管道
          delFromRel = 0
          delToRel = cells.length > 1 ? cells[1]!.from - row.lineFrom : text.length
        }
        if (r === i) {
          const newText = text.slice(0, delFromRel) + text.slice(delToRel)
          const newCells = splitTableRowCells(newText, row.lineFrom - delta, p)
          focus = focusOfCells(newCells, row.lineFrom - delta, col)
        }
        if (r < i) {
          delta += delToRel - delFromRel
        }
        changes.push({ from: row.lineFrom + delFromRel, to: row.lineFrom + delToRel, insert: '' })
      }
      return changes.length > 0 && focus >= 0 ? { changes, selection: focus } : null
    }
  }
}
