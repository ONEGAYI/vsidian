// YAML frontmatter 表格化纯逻辑（工单 #140，规格 docs/specs/frontmatter-table.md）。
//
// 职责分层（单一事实源，Live 装饰与阅读切块共用）：
// - 解析：合法简单头区（标量 + 字符串数组）→ 区间模型；其余 → null 降级。
//   判定由两道互补扫描组成：自研行级形态学只认「一期支持形态」并给出
//   键 / 值 / 项的源区间（同 tableCells 的 GFM 语义拆分先例——yaml 包的
//   CST 不承担行级定位）；yaml 包 parseDocument 做语义合法性兜底（未闭合
//   flow、非法缩进等）与值类型判定（标量 / 字符串数组之外的复杂类型整卡
//   降级）。边界（首尾围栏、8192 有界扫描）由 markdownDoc.frontmatterRange
//   单一事实源先行判定，本模块只消费其区间。
// - 编辑计划：增删改键值对 / 数组项的最小重写——只替换被编辑区间，
//   未触及行字节不变（顺序、引号、缩进、行内注释原样保留）；增删行按
//   整行（含换行）操作。计划是纯数据，由 webview 层组装 CM6 事务走既有
//   出站管线（edit.request → WorkspaceEdit），不新增旁路。
// - 格导航：Tab/Shift+Tab 格间往返、Enter 下行同列的定位（表格网格
//   同构语义；末行返回 null 交上层决定加行）。
// - 阅读侧 HTML：值全转义的只读表格结构（经 readingBlocks 的安全净化层）。
//
// 坐标约定：全文 LF UTF-16 offset，frontmatter 必在文档首（由
// frontmatterRange 保证），实现按 fm 区间相对计算，不假设 start 为 0。
//
// 已知边界（一期决策，规格「排除」节）：合法但不支持的 YAML 形态同样
// 降级源码——零缩进 block 序列（`tags:\n- a`）、跨空行续组的 block 序列
// 项、空数组项（null 项）、flow 内嵌套结构。降级后编辑不受限，转简单
// 形态自动成型。

import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

/** 源文本区间（end 不含）——与 SourceRange/SerChange 坐标同构 */
export interface FmRange {
  from: number
  to: number
}

/** 标量键值条目（字符串 / 数字 / 布尔 / 日期字符串 / 空值） */
export interface FmScalarEntry {
  kind: 'scalar'
  /** 条目行区间（行首到行尾，不含换行） */
  lineFrom: number
  lineTo: number
  key: FmRange
  /** 值区间（trim 后；空值为 from === to） */
  value: FmRange
  /** 冒号后第一个字符位置（空值插入补 `: ` 结构空格的判定基准） */
  colonEnd: number
  /** 行内尾注释区间（# 起、不含前导空格；无则 null） */
  comment: FmRange | null
}

/** 数组项（block 形态为独立 `- item` 行；flow 形态与宿主同行） */
export interface FmArrayItem {
  /** 项文本区间（不含 `- ` 标记、缩进与注释） */
  item: FmRange
  /** 项所在行区间（block 形态为项行；flow 形态为宿主行） */
  lineFrom: number
  lineTo: number
  /** block 项行的前导缩进宽度（flow 项为 0） */
  indent: number
  /** 行内尾注释区间 */
  comment: FmRange | null
}

/** 字符串数组条目 */
export interface FmArrayEntry {
  kind: 'array'
  /** block（`- item` 行组）或 flow（`[a, b]` 单行） */
  form: 'flow' | 'block'
  /** 宿主 `key:` 行行首 */
  lineFrom: number
  /** 宿主 `key:` 行行尾（block 形态的导航边界；与 lineTo 区分） */
  hostLineTo: number
  /** 末项行行尾（block；flow 时同 hostLineTo） */
  lineTo: number
  key: FmRange
  /** flow：括号整体区间；block：宿主行空值位（from === to） */
  value: FmRange
  /** 冒号后第一个字符位置（空值占位交互的判定基准，同标量） */
  colonEnd: number
  /** 宿主行行内尾注释 */
  comment: FmRange | null
  /** 项列表（flow 也拆分——阅读侧逐项呈现；Live 侧 flow 值格整格编辑） */
  items: FmArrayItem[]
}

export type FmEntry = FmScalarEntry | FmArrayEntry

/** 杂项行（独立注释 / 空行）：不进条目模型，原样保留；呈现层纳入卡片 */
export interface FmMiscLine {
  from: number
  to: number
  kind: 'comment' | 'blank'
}

/** 成型头区的区间模型 */
export interface FmTableModel {
  entries: FmEntry[]
  /** 杂项行（独立注释/空行），按文档序 */
  miscLines: FmMiscLine[]
  /** 头区整体区间（含首尾围栏行，同 frontmatterRange 返回值） */
  from: number
  to: number
  /** 首围栏行（`---`）行区间 */
  openFrom: number
  openTo: number
  /** 闭合围栏行（`---` / `...`）行区间 */
  closeFrom: number
  closeTo: number
  /** 新键值对插入点：末条目行行尾；无条目时为末杂项行（注释/空行）行尾；
   *  连杂项行也没有时为首围栏行行尾。插入文本前缀 `\n` */
  insertAt: number
}

/** 编辑计划：纯数据（changes + 选区），由调用方组装事务 */
export interface FmEditPlan {
  changes: ReadonlyArray<{ from: number; to?: number; insert: string }>
  selection?: { anchor: number; head?: number }
}

// ---- 行级形态学 ----

/** 行信息（区间为绝对 offset；text 不含换行） */
interface FmLine {
  from: number
  to: number
  text: string
}

/** 头区切行（含首尾围栏行） */
function fmLines(text: string, fm: { start: number; end: number }): FmLine[] {
  const slice = text.slice(fm.start, Math.min(fm.end, text.length))
  const lines: FmLine[] = []
  let offset = fm.start
  for (const line of slice.split('\n')) {
    lines.push({ from: offset, to: offset + line.length, text: line })
    offset += line.length + 1
  }
  return lines
}

/** 引号闭合位置（含起始引号）；未闭合返回 -1（合法性交 yaml 兜底） */
function matchQuote(s: string, start: number): number {
  const q = s[start]!
  let i = start + 1
  while (i < s.length) {
    if (q === '"' && s[i] === '\\') {
      i += 2
      continue
    }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") {
        i += 2 // 单引号转义 ''
        continue
      }
      return i
    }
    i += 1
  }
  return -1
}

/** 引号感知的顶层冒号位置（其后为空格或行尾才构成键分隔） */
function topLevelColon(s: string): number {
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (c === '"' || c === "'") {
      const end = matchQuote(s, i)
      if (end < 0) {
        return -1
      }
      i = end + 1
      continue
    }
    if (c === '#' && (i === 0 || s[i - 1] === ' ')) {
      return -1 // 注释起点前无键分隔
    }
    if (c === ':' && (i + 1 >= s.length || s[i + 1] === ' ')) {
      return i
    }
    i += 1
  }
  return -1
}

/** 值部分内首个顶层注释（前置空格的 # 或起始 #）的位置；无则 -1 */
function commentStartIn(s: string, from: number): number {
  let i = from
  while (i < s.length) {
    const c = s[i]!
    if (c === '"' || c === "'") {
      const end = matchQuote(s, i)
      if (end < 0) {
        return -1
      }
      i = end + 1
      continue
    }
    if (c === '#' && (i === from || s[i - 1] === ' ')) {
      return i
    }
    i += 1
  }
  return -1
}

/** 一期不支持的结构值前缀（多行标量 / 锚点 / 别名 / 标签 / flow map） */
const COMPLEX_VALUE_PREFIX = ['|', '>', '&', '*', '!', '{']

/** flow 括号内项拆分：顶层逗号分割（引号与嵌套深度感知） */
function flowItems(inner: string): FmRange[] {
  const items: FmRange[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < inner.length) {
    const c = inner[i]!
    if (c === '"' || c === "'") {
      const end = matchQuote(inner, i)
      i = end < 0 ? inner.length : end + 1
      continue
    }
    if (c === '[' || c === '{') {
      depth += 1
    } else if (c === ']' || c === '}') {
      depth -= 1
    } else if (c === ',' && depth === 0) {
      pushTrimmed(items, inner, start, i)
      start = i + 1
    }
    i += 1
  }
  pushTrimmed(items, inner, start, inner.length)
  // 空数组（[] / [ ]）产出零项；尾逗号宽容（末项空丢弃），中间空项保留
  if (inner.trim() === '' || (items.length > 0 && items[items.length - 1]!.from === items[items.length - 1]!.to)) {
    if (inner.trim() === '' || items.length === 1) {
      return []
    }
    items.pop()
  }
  return items
}

function pushTrimmed(items: FmRange[], s: string, rawFrom: number, rawTo: number): void {
  let from = rawFrom
  let to = rawTo
  while (from < to && s[from] === ' ') {
    from += 1
  }
  while (to > from && s[to - 1] === ' ') {
    to -= 1
  }
  items.push({ from, to })
}

/** 键名归一（引号剥除）——重复键检测用 */
function normalizeKey(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1)
  }
  return t
}

/** 项行匹配：前导缩进 + `-` + 空格 + 内容 */
function matchItemLine(text: string): { indent: number; contentFrom: number } | null {
  let indent = 0
  while (indent < text.length && text[indent] === ' ') {
    indent += 1
  }
  if (indent === 0 || text[indent] !== '-') {
    return null
  }
  const after = text[indent + 1] ?? ''
  if (after === '') {
    return { indent, contentFrom: text.length }
  }
  if (after !== ' ') {
    return null // `-x` 是标量不是项
  }
  let c = indent + 1
  while (c < text.length && text[c] === ' ') {
    c += 1
  }
  return { indent, contentFrom: c }
}

/**
 * 解析：合法简单头区返回区间模型；解析失败、含复杂类型、重复键 → null
 * （降级源码）。fm 为 null（未闭合/超界）时调用方不进本函数。
 */
export function parseFrontmatterTable(text: string, fm: { start: number; end: number }): FmTableModel | null {
  const lines = fmLines(text, fm)
  if (lines.length < 2) {
    return null
  }
  const open = lines[0]!
  const close = lines[lines.length - 1]!
  const entries: FmEntry[] = []
  const miscLines: FmMiscLine[] = []
  const seenKeys = new Set<string>()
  // 待填充宿主（空值键行）在 entries 中的索引；空行/注释不终止，新键行终止
  let pendingHost = -1
  let lastMidLineTo = open.to

  for (let li = 1; li < lines.length - 1; li++) {
    const line = lines[li]!
    const trimmedStart = line.text.trimStart()
    if (trimmedStart === '' || trimmedStart[0] === '#') {
      miscLines.push({
        from: line.from,
        to: line.to,
        kind: trimmedStart === '' ? 'blank' : 'comment',
      })
      lastMidLineTo = line.to
      continue // 空行 / 独立注释行：保留原位，不进条目模型
    }
    const indentWidth = line.text.length - trimmedStart.length
    if (indentWidth === 0) {
      pendingHost = -1
      const colon = topLevelColon(line.text)
      if (colon <= 0) {
        return null // 顶层标量/序列/粘连形态：一期不支持
      }
      let keyTo = colon
      while (keyTo > 0 && line.text[keyTo - 1] === ' ') {
        keyTo -= 1
      }
      if (keyTo === 0) {
        return null // 空键（`: v` 的 null 键形态）
      }
      const keyText = line.text.slice(0, keyTo)
      const normalized = normalizeKey(keyText)
      if (seenKeys.has(normalized)) {
        return null // 重复键：YAML 映射不允许
      }
      seenKeys.add(normalized)
      const colonEnd = colon + 1
      const commentAt = commentStartIn(line.text, colonEnd)
      const lineEnd = trimEndPos(line.text, line.text.length)
      const comment: FmRange | null =
        commentAt >= 0 ? { from: line.from + commentAt, to: line.from + lineEnd } : null
      let valueFrom = colonEnd
      while (valueFrom < line.text.length && line.text[valueFrom] === ' ') {
        valueFrom += 1
      }
      const valueEmpty = valueFrom >= line.text.length || commentAt === valueFrom
      if (valueEmpty) {
        const emptyAt = trimEndPos(line.text, Math.min(valueFrom, line.text.length))
        entries.push({
          kind: 'scalar',
          lineFrom: line.from,
          lineTo: line.to,
          key: { from: line.from, to: line.from + keyTo },
          value: { from: line.from + emptyAt, to: line.from + emptyAt },
          colonEnd: line.from + colonEnd,
          comment,
        })
        pendingHost = entries.length - 1
        lastMidLineTo = line.to
        continue
      }
      const valueRawTo =
        commentAt >= 0 ? trimEndPos(line.text, commentAt) : trimEndPos(line.text, line.text.length)
      const first = line.text[valueFrom]!
      if (first === '[') {
        if (valueRawTo <= valueFrom || line.text[valueRawTo - 1] !== ']') {
          return null // 括号未闭合（快速失败；yaml 兜底同判）
        }
        const innerFrom = valueFrom + 1
        const innerTo = valueRawTo - 1
        const rel = flowItems(line.text.slice(innerFrom, innerTo))
        if (rel.some((it) => it.to === it.from)) {
          return null // 中间空项（[a,,b]）：降级
        }
        entries.push({
          kind: 'array',
          form: 'flow',
          lineFrom: line.from,
          hostLineTo: line.to,
          lineTo: line.to,
          key: { from: line.from, to: line.from + keyTo },
          value: { from: line.from + valueFrom, to: line.from + valueRawTo },
          colonEnd: line.from + colonEnd,
          comment,
          items: rel.map((it) => ({
            item: { from: line.from + innerFrom + it.from, to: line.from + innerFrom + it.to },
            lineFrom: line.from,
            lineTo: line.to,
            indent: 0,
            comment: null,
          })),
        })
        lastMidLineTo = line.to
        continue
      }
      if (COMPLEX_VALUE_PREFIX.includes(first)) {
        return null // 多行标量/锚点/别名/标签/flow map：整卡降级
      }
      entries.push({
        kind: 'scalar',
        lineFrom: line.from,
        lineTo: line.to,
        key: { from: line.from, to: line.from + keyTo },
        value: { from: line.from + valueFrom, to: line.from + valueRawTo },
        colonEnd: line.from + colonEnd,
        comment,
      })
      lastMidLineTo = line.to
      continue
    }

    // 缩进行：只认 block 数组项（其余为嵌套 map / 多行标量 → 降级）
    const m = matchItemLine(line.text)
    if (!m || pendingHost < 0) {
      return null
    }
    if (m.contentFrom >= line.text.length) {
      return null // 空项（`-` / `- ` 无内容）：一期字符串数组不含 null 项
    }
    const content = line.text.slice(m.contentFrom)
    if (COMPLEX_VALUE_PREFIX.includes(content[0]!) || content[0] === '[') {
      return null // 对象项 / 嵌套数组项 / 标记值
    }
    if (topLevelColon(content) >= 0) {
      return null // `- k: v` 对象数组项
    }
    const commentAt = commentStartIn(line.text, m.contentFrom)
    const itemRawTo =
      commentAt >= 0 ? trimEndPos(line.text, commentAt) : trimEndPos(line.text, line.text.length)
    if (itemRawTo <= m.contentFrom) {
      return null // 项内容全为注释（空项）
    }
    const item: FmArrayItem = {
      item: { from: line.from + m.contentFrom, to: line.from + itemRawTo },
      lineFrom: line.from,
      lineTo: line.to,
      indent: m.indent,
      comment: commentAt >= 0 ? { from: line.from + commentAt, to: line.from + trimEndPos(line.text, line.text.length) } : null,
    }
    const host = entries[pendingHost]!
    if (host.kind === 'scalar') {
      // 空值宿主升格为 block 数组（key/value/comment/colonEnd 语义继承）
      entries[pendingHost] = {
        kind: 'array',
        form: 'block',
        lineFrom: host.lineFrom,
        hostLineTo: host.lineTo,
        lineTo: line.to,
        key: host.key,
        value: host.value,
        colonEnd: host.colonEnd,
        comment: host.comment,
        items: [item],
      }
    } else if (host.items[host.items.length - 1]!.indent !== m.indent) {
      return null // 项缩进不一致（YAML 非法形态；防奇形混排）
    } else {
      host.items.push(item)
      host.lineTo = line.to
    }
    lastMidLineTo = line.to
  }

  if (!yamlSimpleOk(text, open, close)) {
    return null
  }
  return {
    entries,
    miscLines,
    from: fm.start,
    to: fm.end,
    openFrom: open.from,
    openTo: open.to,
    closeFrom: close.from,
    closeTo: close.to,
    insertAt: entries.length > 0 ? entries[entries.length - 1]!.lineTo : lastMidLineTo,
  }
}

/** 行尾 trimEnd 位置（相对行内；空白含 \t/\r） */
function trimEndPos(s: string, end: number): number {
  let p = end
  while (p > 0 && (s[p - 1] === ' ' || s[p - 1] === '\t' || s[p - 1] === '\r')) {
    p -= 1
  }
  return p
}

/** yaml 语义校验：剥围栏后解析，顶层映射且值全为一期类型 */
function yamlSimpleOk(text: string, open: FmLine, close: FmLine): boolean {
  const inner = text.slice(open.to, close.from)
  let doc
  try {
    doc = parseDocument(inner, { merge: false })
  } catch {
    return false
  }
  if (doc.errors.length > 0) {
    return false
  }
  const contents = doc.contents
  if (contents === null || contents === undefined) {
    return true // 空文档 / 纯注释
  }
  if (!isMap(contents)) {
    return false // 顶层序列或标量
  }
  const scalarOk = (node: unknown): boolean => {
    if (!isScalar(node)) {
      return false
    }
    if (node.value === null || node.value === undefined) {
      return true // 空值（`key:` / null 字面）
    }
    return typeof node.value === 'string' || typeof node.value === 'number' || typeof node.value === 'boolean'
  }
  for (const pair of contents.items) {
    const value = pair.value
    if (value === null || value === undefined) {
      continue // 空值键
    }
    if (isScalar(value)) {
      if (!scalarOk(value)) {
        return false
      }
      continue
    }
    if (isSeq(value)) {
      for (const item of value.items) {
        if (!scalarOk(item)) {
          return false
        }
      }
      continue
    }
    return false
  }
  return true
}

// ---- 编辑计划（最小重写：只动被编辑区间） ----

/** 空值插入补 `: ` 结构空格（冒号后无空隙时） */
function scalarInsert(entry: FmScalarEntry, newText: string): string {
  if (newText === '' || entry.value.from !== entry.value.to) {
    return newText
  }
  return entry.value.from === entry.colonEnd ? ` ${newText}` : newText
}

/** 改标量值（数组条目返回 null——数组值编辑走整格文本或项级计划） */
export function planSetFmValue(model: FmTableModel, entryIndex: number, newValue: string): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry || entry.kind !== 'scalar') {
    return null
  }
  return {
    changes: [{ from: entry.value.from, to: entry.value.to, insert: scalarInsert(entry, newValue) }],
  }
}

/** 改键（保留值与注释形态） */
export function planSetFmKey(model: FmTableModel, entryIndex: number, newKey: string): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry) {
    return null
  }
  return {
    changes: [{ from: entry.key.from, to: entry.key.to, insert: newKey }],
  }
}

/** 新增键值对模板（键名与用户内容约定，非 UI 文案——不进语言包） */
const NEW_ENTRY_KEY = 'key'
const NEW_ENTRY_VALUE = 'value'
const NEW_ITEM_TEXT = 'item'

/**
 * 新增键值对：末条目行后插入 `key: value`，光标选中新键文本。
 * text 传入全文用于既有键名去重（`key`、`key2`…递增）。
 */
export function planAddFmEntry(model: FmTableModel, text: string): FmEditPlan | null {
  const used = new Set(model.entries.map((e) => normalizeKey(text.slice(e.key.from, e.key.to))))
  let keyName = NEW_ENTRY_KEY
  if (used.has(keyName)) {
    let n = 2
    while (used.has(`${NEW_ENTRY_KEY}${n}`)) {
      n += 1
    }
    keyName = `${NEW_ENTRY_KEY}${n}`
  }
  const insert = `\n${keyName}: ${NEW_ENTRY_VALUE}`
  const from = model.insertAt + 1
  return {
    changes: [{ from: model.insertAt, insert }],
    selection: { anchor: from, head: from + keyName.length },
  }
}

/** 删除条目：整行组（含换行；block 数组含全部项行） */
export function planRemoveFmEntry(model: FmTableModel, entryIndex: number): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry) {
    return null
  }
  return {
    changes: [{ from: entry.lineFrom, to: Math.min(entry.lineTo + 1, model.closeFrom), insert: '' }],
  }
}

/** block 数组末尾加项（空值标量宿主亦可起步）；flow/非空标量返回 null */
export function planAddFmArrayItem(model: FmTableModel, entryIndex: number): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry) {
    return null
  }
  if (entry.kind === 'scalar') {
    if (entry.value.from !== entry.value.to) {
      return null // 非空标量不支持项化（编辑值文本达成）
    }
    const insert = `\n  - ${NEW_ITEM_TEXT}`
    const itemAt = entry.lineTo + 1 + '\n  - '.length
    return {
      changes: [{ from: entry.lineTo, insert }],
      selection: { anchor: itemAt, head: itemAt + NEW_ITEM_TEXT.length },
    }
  }
  if (entry.form !== 'block' || entry.items.length === 0) {
    return null // flow 数组：整格文本编辑（一期不提供项级按钮）
  }
  const last = entry.items[entry.items.length - 1]!
  const pad = ' '.repeat(Math.max(2, last.indent))
  const prefix = `\n${pad}- `
  const insert = `${prefix}${NEW_ITEM_TEXT}`
  const itemAt = last.lineTo + prefix.length
  return {
    changes: [{ from: last.lineTo, insert }],
    selection: { anchor: itemAt, head: itemAt + NEW_ITEM_TEXT.length },
  }
}

/** 删除 block 数组项：整项行（含换行）；删到零项保留空宿主行 */
export function planRemoveFmArrayItem(model: FmTableModel, entryIndex: number, itemIndex: number): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry || entry.kind !== 'array' || entry.form !== 'block') {
    return null
  }
  const item = entry.items[itemIndex]
  if (!item) {
    return null
  }
  return {
    changes: [{ from: item.lineFrom, to: Math.min(item.lineTo + 1, model.closeFrom), insert: '' }],
  }
}

// ---- 格导航（表格网格同构语义） ----

export type FmCellKind = 'key' | 'value' | 'item'

export interface FmCellTarget {
  entryIndex: number
  itemIndex: number // item 格有效；其余 -1
  kind: FmCellKind
}

/** 光标所在格（宽松区间：行内分隔/缩进归邻格，注释区不算格） */
export function fmCellAt(model: FmTableModel, pos: number): FmCellTarget | null {
  if (pos < model.openTo || pos > model.closeFrom) {
    return null
  }
  for (let i = 0; i < model.entries.length; i++) {
    const entry = model.entries[i]!
    if (pos >= entry.key.from && pos <= entry.key.to) {
      return { entryIndex: i, itemIndex: -1, kind: 'key' }
    }
    if (entry.kind === 'scalar') {
      if (pos > entry.key.to && pos <= entry.lineTo && !inComment(entry.comment, pos)) {
        return { entryIndex: i, itemIndex: -1, kind: 'value' }
      }
      continue
    }
    if (entry.form === 'flow') {
      if (pos > entry.key.to && pos <= entry.lineTo && !inComment(entry.comment, pos)) {
        return { entryIndex: i, itemIndex: -1, kind: 'value' }
      }
      continue
    }
    // block：宿主行（key 后到宿主行尾）或项行
    if (pos > entry.key.to && pos <= entry.hostLineTo && !inComment(entry.comment, pos)) {
      return { entryIndex: i, itemIndex: -1, kind: 'value' }
    }
    for (let j = 0; j < entry.items.length; j++) {
      const item = entry.items[j]!
      if (pos >= item.lineFrom && pos <= item.lineTo && !inComment(item.comment, pos)) {
        return { entryIndex: i, itemIndex: j, kind: 'item' }
      }
    }
  }
  return null
}

function inComment(comment: FmRange | null, pos: number): boolean {
  return comment !== null && pos > comment.from && pos <= comment.to
}

interface SequencedCell {
  entryIndex: number
  itemIndex: number
  kind: FmCellKind
  from: number
  lineFrom: number
}

/** 头区格的文档序序列（key/value/item 依次展开；block 宿主 value 在项前） */
function cellSequence(model: FmTableModel): SequencedCell[] {
  const seq: SequencedCell[] = []
  for (let i = 0; i < model.entries.length; i++) {
    const entry = model.entries[i]!
    seq.push({ entryIndex: i, itemIndex: -1, kind: 'key', from: entry.key.from, lineFrom: entry.lineFrom })
    if (entry.kind === 'array' && entry.form === 'block') {
      seq.push({ entryIndex: i, itemIndex: -1, kind: 'value', from: entry.value.from, lineFrom: entry.lineFrom })
      for (let j = 0; j < entry.items.length; j++) {
        seq.push({ entryIndex: i, itemIndex: j, kind: 'item', from: entry.items[j]!.item.from, lineFrom: entry.items[j]!.lineFrom })
      }
    } else {
      seq.push({ entryIndex: i, itemIndex: -1, kind: 'value', from: entry.value.from, lineFrom: entry.lineFrom })
    }
  }
  return seq
}

function findCell(seq: SequencedCell[], cell: FmCellTarget): number {
  return seq.findIndex((s) => s.entryIndex === cell.entryIndex && s.itemIndex === cell.itemIndex && s.kind === cell.kind)
}

/** Tab/Shift+Tab 格间往返；末格前向 → 闭合行行尾（越出）；首格后向 → null */
export function fmCellNavTarget(model: FmTableModel, pos: number, backward: boolean): number | null {
  const cell = fmCellAt(model, pos)
  if (!cell) {
    return null
  }
  const seq = cellSequence(model)
  const index = findCell(seq, cell)
  if (index < 0) {
    return null
  }
  const next = backward ? index - 1 : index + 1
  if (next < 0) {
    return null
  }
  if (next >= seq.length) {
    return model.closeTo
  }
  return seq[next]!.from
}

/** Enter 下行同列（值列把宿主空值格与项视为同列）；末行返回 null */
export function fmCellDownTarget(model: FmTableModel, pos: number): number | null {
  const cell = fmCellAt(model, pos)
  if (!cell) {
    return null
  }
  const seq = cellSequence(model)
  const index = findCell(seq, cell)
  if (index < 0) {
    return null
  }
  const colOf = (kind: FmCellKind): number => (kind === 'key' ? 0 : 1)
  const currentCol = colOf(seq[index]!.kind)
  const currentRow = seq[index]!.lineFrom
  for (let i = index + 1; i < seq.length; i++) {
    const candidate = seq[i]!
    if (candidate.lineFrom > currentRow && colOf(candidate.kind) === currentCol) {
      return candidate.from
    }
  }
  return null
}

// ---- 阅读侧 HTML ----

/** HTML 转义（值与键全转义，进 DOM 前还有净化层纵深防御） */
function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 阅读侧表格 HTML（只读；键值两列、数组项行带占位键列；值全转义） */
export function buildFrontmatterTableHtml(
  model: FmTableModel,
  text: string,
  opts: { emptyLabel: string },
): string {
  if (model.entries.length === 0) {
    return (
      `<div class="vsidian-fm-table"><div class="vsidian-fm-row vsidian-fm-empty-row">` +
      `<span class="vsidian-fm-empty">${escapeHtml(opts.emptyLabel)}</span></div></div>`
    )
  }
  const rows: string[] = []
  for (const entry of model.entries) {
    const keyHtml = escapeHtml(text.slice(entry.key.from, entry.key.to))
    if (entry.kind === 'scalar') {
      const value = entry.value.to > entry.value.from ? escapeHtml(text.slice(entry.value.from, entry.value.to)) : ''
      rows.push(rowHtml(keyHtml, value, false))
      continue
    }
    // 数组：宿主行（值列空占位）+ 项行（占位键列）
    rows.push(rowHtml(keyHtml, '', false))
    for (const item of entry.items) {
      rows.push(rowHtml('', escapeHtml(text.slice(item.item.from, item.item.to)), true))
    }
    if (entry.items.length === 0) {
      rows.push(rowHtml('', '', true))
    }
  }
  return `<div class="vsidian-fm-table">${rows.join('')}</div>`
}

function rowHtml(keyHtml: string, valueHtml: string, itemRow: boolean): string {
  const keyClass = itemRow
    ? 'vsidian-fm-cell vsidian-fm-key vsidian-fm-key-placeholder'
    : 'vsidian-fm-cell vsidian-fm-key'
  const rowClass = itemRow ? 'vsidian-fm-row vsidian-fm-item-row' : 'vsidian-fm-row'
  return (
    `<div class="${rowClass}"><span class="${keyClass}">${keyHtml}</span>` +
    `<span class="vsidian-fm-cell vsidian-fm-value">${valueHtml}</span></div>`
  )
}
