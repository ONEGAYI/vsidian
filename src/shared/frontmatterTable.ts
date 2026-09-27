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
// - 阅读侧 HTML：标题栏 + 值全转义的只读表格结构（经 readingBlocks 的
//   安全净化层）。
//
// 坐标约定：全文 LF UTF-16 offset，frontmatter 必在文档首（由
// frontmatterRange 保证），实现按 fm 区间相对计算，不假设 start 为 0。
//
// 已知边界（一期决策，规格「排除」节）：合法但不支持的 YAML 形态同样
// 降级源码——零缩进 block 序列（`tags:\n- a`）、空数组项（null 项）、
// flow 内嵌套结构。跨空行/独立注释行续组的 block 序列是**接受成型**
// 的（yaml 兜底层合法、项行挂接待填充宿主——行内实现注释「空行/注释
// 不终止」即此意）。降级后编辑不受限，转简单形态自动成型。

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

/** 键名归一（引号剥除）——重复键检测用（Popover 键名写回前的去重检查） */
export function normalizeKey(raw: string): string {
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

/** 改值：标量为值区间替换（空值补 `: ` 结构空格）；flow 数组为值区间
 *  （含括号）整框替换——Popover 值输入框的原文编辑口径，形态写坏交解析
 *  降级兜底。block 数组返回 null（项编辑走项级计划） */
export function planSetFmValue(model: FmTableModel, entryIndex: number, newValue: string): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry) {
    return null
  }
  if (entry.kind === 'scalar') {
    return {
      changes: [{ from: entry.value.from, to: entry.value.to, insert: scalarInsert(entry, newValue) }],
    }
  }
  if (entry.form !== 'flow') {
    return null
  }
  return {
    changes: [{ from: entry.value.from, to: entry.value.to, insert: newValue }],
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

/** 删除条目：整行组（含换行；block 数组含全部项行）。光标落保留内容
 *  （后条目前移后的键首 → 前条目行尾），不落围栏行 */
export function planRemoveFmEntry(model: FmTableModel, entryIndex: number): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry) {
    return null
  }
  const from = entry.lineFrom
  const to = Math.min(entry.lineTo + 1, model.closeFrom)
  const next = model.entries[entryIndex + 1]
  const prev = model.entries[entryIndex - 1]
  const anchor = next ? next.key.from - (to - from) : prev ? prev.lineTo : from
  return {
    changes: [{ from, to, insert: '' }],
    selection: { anchor },
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

/** 删除 block 数组项：整项行（含换行）；删到零项保留空宿主行。光标落位
 *  同 planRemoveFmEntry 口径——前项文本尾 → 后项前移后的文本首 → 宿主行
 *  行尾，均不落围栏行 */
export function planRemoveFmArrayItem(model: FmTableModel, entryIndex: number, itemIndex: number): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry || entry.kind !== 'array' || entry.form !== 'block') {
    return null
  }
  const item = entry.items[itemIndex]
  if (!item) {
    return null
  }
  const from = item.lineFrom
  const to = Math.min(item.lineTo + 1, model.closeFrom)
  const prev = entry.items[itemIndex - 1]
  const next = entry.items[itemIndex + 1]
  const anchor = prev ? prev.item.to : next ? next.item.from - (to - from) : entry.hostLineTo
  return {
    changes: [{ from, to, insert: '' }],
    selection: { anchor },
  }
}

/** 改 block 数组项文本：只替换项区间（`- ` 标记、缩进与注释保留）——
 *  Popover 项输入框的写回计划（2026-09-27 Popover 改版新增） */
export function planSetFmArrayItem(model: FmTableModel, entryIndex: number, itemIndex: number, newText: string): FmEditPlan | null {
  const entry = model.entries[entryIndex]
  if (!entry || entry.kind !== 'array' || entry.form !== 'block') {
    return null
  }
  const item = entry.items[itemIndex]
  if (!item) {
    return null
  }
  return {
    changes: [{ from: item.item.from, to: item.item.to, insert: newText }],
  }
}

// ---- 阅读侧 HTML ----

/** HTML 文本转义（& < > " 四字符；webview 侧阅读渲染的共享实现——
 *  覆盖文本内容位与双引号属性位，单引号不需实体化。进 DOM 前还有净化层
 *  纵深防御） */
export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 标题栏列表图标（三横线，参考图 A 形态；live 标题栏与阅读侧 HTML 共用） */
export const FM_HEADER_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8"></path>' +
  '<path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" stroke-width="2"></path></svg>'

/** 标题栏 HTML（live replace widget 与阅读侧同构：图标 + 标题；按钮为
 *  live 专属，由 webview 侧 widget 追加） */
export function buildFrontmatterHeaderHtml(titleHtml: string): string {
  return (
    `<div class="vsidian-fm-header"><span class="vsidian-fm-header-icon">${FM_HEADER_ICON_SVG}</span>` +
    `<span class="vsidian-fm-header-title">${titleHtml}</span></div>`
  )
}

/** 阅读侧表格 HTML（只读；标题栏 + 键值两列、数组项行带占位键列；值全转义） */
export function buildFrontmatterTableHtml(
  model: FmTableModel,
  text: string,
  opts: { emptyLabel: string; titleLabel: string },
): string {
  const header = buildFrontmatterHeaderHtml(escapeHtml(opts.titleLabel))
  if (model.entries.length === 0) {
    return (
      `<div class="vsidian-fm-table">${header}<div class="vsidian-fm-row vsidian-fm-empty-row">` +
      `<span class="vsidian-fm-empty">${escapeHtml(opts.emptyLabel)}</span></div></div>`
    )
  }
  const rows: string[] = [header]
  for (const entry of model.entries) {
    const keyHtml = escapeHtml(text.slice(entry.key.from, entry.key.to))
    if (entry.kind === 'scalar') {
      const value = entry.value.to > entry.value.from ? escapeHtml(text.slice(entry.value.from, entry.value.to)) : ''
      rows.push(rowHtml(keyHtml, value, false))
      continue
    }
    // 数组：宿主行（值列空占位，键名类型图标取列表形）+ 项行（占位键列）
    rows.push(rowHtml(keyHtml, '', false, true))
    for (const item of entry.items) {
      rows.push(rowHtml('', escapeHtml(text.slice(item.item.from, item.item.to)), true))
    }
    if (entry.items.length === 0) {
      rows.push(rowHtml('', '', true))
    }
  }
  return `<div class="vsidian-fm-table">${rows.join('')}</div>`
}

function rowHtml(keyHtml: string, valueHtml: string, itemRow: boolean, listHost = false): string {
  const keyClass = itemRow
    ? 'vsidian-fm-cell vsidian-fm-key vsidian-fm-key-placeholder'
    : 'vsidian-fm-cell vsidian-fm-key'
  const rowClass = itemRow
    ? 'vsidian-fm-row vsidian-fm-item-row'
    : listHost
      ? 'vsidian-fm-row vsidian-fm-list-row'
      : 'vsidian-fm-row'
  return (
    `<div class="${rowClass}"><span class="${keyClass}">${keyHtml}</span>` +
    `<span class="vsidian-fm-cell vsidian-fm-value">${valueHtml}</span></div>`
  )
}
