// 可读文本（#340 / P3-08）的共享纯逻辑内核：双链 #line/#range 锚点解析
// 与校验、有界准入探测、行窗口裁剪与 token 5 元组编解码——宿主读取分派
// （host/hoverDocAccess 的 text 通道）与 webview 文本视图（textRefView）
// 共用同一套口径，两端不各自发明第二套语义。
//
// 规范来源（docs/specs/hover-preview-embed.md「三期正式规格」导航边界，
// 2026-10-04 修订确认）：
// - 双链限定：锚点控制仅 [[...]]/![[...]] 可用；普通 Markdown 链接的
//   fragment 不由本扩展解析（调用方按链接形态决定是否进入锚点解析）。
// - 分词边界：`;` 与 `key=value` 形态仅对非 Markdown 目标的锚点段启用。
// - #line=N 控制展示初始起点与跳转锚点；#range=B-E 为闭区间硬展示窗口
//   （B-/-E 开放端合法、B==E 合法）；可组合 #line=N;range=B-E；键序无关、
//   同一键重复非法。
// - line 落窗口外、B>E、0/负数/非数字、越出文件总行数一律就地报错，不
//   静默回顶；仅 range 时跳转落窗口起点 B；无锚点全文从头。
// - 文件被编辑变短后，已打开视图的窗口与定位可合法钳制（初次打开仍按
//   报错口径）——本模块只承担「初次打开」的严格校验；刷新宽容由调用方
//   （anchorOptional）处理。
//
// 本模块不依赖 vscode/DOM（两端共享纯逻辑）。

/** 文本附件准入参数（集中定义；初值依据见票据报告——2 MiB 与引用树文本
 *  预算同量级、单行 2 万字符对齐原生超长行性能边界，可在后续压测票修订） */
export const REF_TEXT_LIMITS = {
  /** 单文件准入上限（字节；超限就地拒绝，不读完整无界内容） */
  maxFileBytes: 2 * 1024 * 1024,
  /** 单行字符上限（LF 正文的任一行超限即拒绝，不悄悄截断） */
  maxLineChars: 20_000,
  /** 有界探测字节数（二进制/非法编码判定只看头部） */
  probeBytes: 8192,
} as const

/** 文本锚点解析后的原始规格（数值尚未与总行数校验） */
export interface TextAnchorSpec {
  line?: number
  range?: { begin?: number; end?: number }
}

/** 文本锚点非法的原因码（错误分态文案的参数） */
export type TextAnchorInvalidCode =
  | 'format' // 非数字 / 未知键 / 重复键 / 空段 / 形态非法（含块引用形态）
  | 'range-order' // B > E
  | 'out-of-bounds' // 越出文件总行数
  | 'line-outside-window' // 组合时 line 落在 range 窗口外

/**
 * 分词解析非 Markdown 目标的锚点段（`;` 与 `key=value` 形态）：
 * `line=10`、`range=3-5`、`line=10;range=3-5`（键序无关）。
 * 值为十进制非负整数的字面量；`range` 取 `B-E` / `B-` / `-E` 形态
 * （开放端以字段缺席表示）。任一段无法完整识别为已知键的合法形态
 * （含 0/负数/小数/未知键/重复键/空段）返回 null——「非法值就地报错」
 * 的形态学判据。空串输入返回 {}（无锚点段，全文从头）。
 */
export function parseTextAnchorSpec(anchor: string): TextAnchorSpec | null {
  if (anchor === '') {
    return {}
  }
  const spec: TextAnchorSpec = {}
  for (const rawPart of anchor.split(';')) {
    const part = rawPart.trim()
    if (part === '') {
      return null // 空段（`;;` / 尾分号）非法
    }
    const eq = part.indexOf('=')
    if (eq <= 0) {
      return null // 无键或空键
    }
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 'line') {
      if (spec.line !== undefined || !isPositiveDecimal(value)) {
        return null // 重复键 / 非正整数字面量
      }
      spec.line = Number(value)
    } else if (key === 'range') {
      if (spec.range !== undefined) {
        return null // 重复键
      }
      const dash = value.indexOf('-')
      if (dash < 0) {
        return null // range 值必须含 -
      }
      const beginText = value.slice(0, dash)
      const endText = value.slice(dash + 1)
      if (beginText === '' && endText === '') {
        return null // `range=-` 无界
      }
      if (value.indexOf('-', dash + 1) >= 0) {
        return null // 多余的 - 段
      }
      const range: { begin?: number; end?: number } = {}
      if (beginText !== '') {
        if (!isPositiveDecimal(beginText)) {
          return null
        }
        range.begin = Number(beginText)
      }
      if (endText !== '') {
        if (!isPositiveDecimal(endText)) {
          return null
        }
        range.end = Number(endText)
      }
      spec.range = range
    } else {
      return null // 未知键
    }
  }
  return spec
}

/** 十进制正整数字面量（前导零宽容——值语义一致；0/负数/小数/空白非法） */
function isPositiveDecimal(text: string): boolean {
  return /^\d+$/.test(text) && Number(text) > 0
}

/** 文本导航的解析结果：窗口与落点（全部绝对行号，1-based） */
export interface TextNavResolution {
  selector: { line?: number; range?: { begin?: number; end?: number } }
  /** 硬展示窗口起（含）；无 range 时为 1 */
  beginLine: number
  /** 硬展示窗口止（含）；无 range / 开放端时为 totalLines */
  endLine: number
  /** 初始展示起点（= line ?? beginLine） */
  locateLine: number
  /** 跳转锚点（规范：line 决定；仅 range 落窗口起点 B；无锚点落文件顶部） */
  jumpLine: number
}

/**
 * 结合文件总行数完成锚点校验与窗口规划：
 * - strict（初次打开，默认）：0/负数/非数字由 parseTextAnchorSpec 判
 *   （format）；B>E → range-order；越出总行数（line/begin/end 任一）→
 *   out-of-bounds；组合时 line 落窗口外 → line-outside-window——一律
 *   就地报错，不静默回顶（规范口径）；
 * - clamp（anchorOptional 刷新重载）：文件被编辑变短后的合法收口——
 *   越界值钳到总行数、line 钳回窗口内，不构成失败（初次打开仍按报错
 *   口径）；B>E 的结构性矛盾在两模式下都报错（钳制无法给出合理窗口）。
 * - 开放端按 totalLines 收口（`B-` 的 end = totalLines，`-E` 的 begin = 1）。
 */
export function resolveTextNav(
  spec: TextAnchorSpec,
  totalLines: number,
  mode: 'strict' | 'clamp' = 'strict',
): { ok: true; nav: TextNavResolution } | { ok: false; code: TextAnchorInvalidCode } {
  const beginLine = spec.range?.begin ?? 1
  const endLine = spec.range?.end ?? totalLines
  if (spec.range !== undefined && beginLine > endLine) {
    return { ok: false, code: 'range-order' }
  }
  if (mode === 'strict' && spec.line !== undefined && spec.range !== undefined &&
    (spec.line < beginLine || spec.line > endLine)) {
    // 越窗判定先于越界判定（窗口约束更具体：line=10;range=3-5 归
    // line-outside-window——2026-10-04 修正口径的显式报错例；目标文件
    // 更短使多重错误叠加时也按更具体的锚点语法错误报出）
    return { ok: false, code: 'line-outside-window' }
  }
  if (mode === 'strict') {
    if (spec.range !== undefined &&
      ((spec.range.begin !== undefined && spec.range.begin > totalLines) ||
        (spec.range.end !== undefined && spec.range.end > totalLines))) {
      return { ok: false, code: 'out-of-bounds' }
    }
    if (spec.line !== undefined && spec.line > totalLines) {
      return { ok: false, code: 'out-of-bounds' }
    }
  }
  let line = spec.line
  if (line !== undefined && mode === 'clamp') {
    line = Math.min(line, totalLines)
  }
  if (line !== undefined && mode !== 'strict') {
    // clamp：line 钳回窗口内（窗口本身随后也会按 totalLines 收口）
    line = Math.min(Math.max(line, beginLine), Math.min(endLine, totalLines))
  }
  const clampedBegin = Math.min(beginLine, totalLines)
  const clampedEnd = Math.min(endLine, totalLines)
  const finalBegin = Math.min(clampedBegin, clampedEnd)
  const finalEnd = Math.max(clampedBegin, clampedEnd) === clampedEnd ? clampedEnd : finalBegin
  const clampedLine = line !== undefined ? Math.min(Math.max(line, finalBegin), finalEnd) : undefined
  return {
    ok: true,
    nav: {
      selector: spec,
      beginLine: finalBegin,
      endLine: finalEnd,
      locateLine: clampedLine ?? finalBegin,
      jumpLine: clampedLine ?? finalBegin,
    },
  }
}

/** 有界探测结论：头部字节的准入判定（编码以宿主打开文档的解码结果为准
 *  ——探测只拦「宿主解码必然无意义」的形态） */
export type TextHeadSniff = 'ok' | 'binary' | 'invalid-encoding'

/**
 * 头部有界探测（默认 8 KiB，REF_TEXT_LIMITS.probeBytes）：
 * - UTF-16 BOM（FF FE / FE FF）开头：宿主可解码，放行；
 * - 含 NUL 字节（0x00）：二进制（UTF-16 已在前放行，其余含 NUL 即非文本）；
 * - 严格 UTF-8 解码失败：非法编码（宿主解码会得替换字符，如实拒绝）。
 *   流式口径（stream: true）：探测边界切在多字节字符中间的截断序列不判
 *   非法（8 KiB 切割的常见正常现象）；真实的非法序列（如 GBK 字节）仍拒。
 */
export function sniffTextHead(head: Uint8Array): TextHeadSniff {
  if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) {
    return 'ok'
  }
  if (head.includes(0)) {
    return 'binary'
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true })
    return 'ok'
  } catch {
    return 'invalid-encoding'
  }
}

/** LF 正文按行拆分（结尾无换行也成行；空文件为 1 个空行——与宿主
 *  TextDocument.lineCount 语义一致） */
export function splitLfLines(lfText: string): string[] {
  if (lfText === '') {
    return ['']
  }
  return lfText.split('\n')
}

/** 窗口裁剪：取 [beginLine, endLine]（1-based 闭区间）内的行 */
export function clipLinesToWindow(lines: readonly string[], beginLine: number, endLine: number): string[] {
  return lines.slice(beginLine - 1, endLine)
}

/** 文本 token 行（窗口内 0-based 行坐标，UTF-16 列） */
export interface TextTokenRun {
  line: number
  start: number
  length: number
  colorIdx: number
  /** 字体样式位：1 italic / 2 bold / 4 underline / 8 strikethrough */
  fontStyleBits: number
}

/**
 * token 5 元组增量解码（与语义 token 命令同构：deltaLine / deltaStart /
 * length / colorIdx / fontStyleBits）。行列为窗口内相对坐标（首行 = 0），
 * UTF-16 列——宿主编码侧与 webview 解码侧共用本实现，避免两套漂移。
 */
export function decodeTextTokenRuns(data: readonly number[]): TextTokenRun[] {
  const runs: TextTokenRun[] = []
  let line = 0
  let start = 0
  for (let i = 0; i + 5 <= data.length; i += 5) {
    const deltaLine = data[i]
    const deltaStart = data[i + 1]
    if (deltaLine > 0) {
      line += deltaLine
      start = deltaStart
    } else {
      start += deltaStart
    }
    runs.push({ line, start, length: data[i + 2], colorIdx: data[i + 3], fontStyleBits: data[i + 4] })
  }
  return runs
}

/** token 5 元组增量编码（decodeTextTokenRuns 的逆；宿主出站侧使用） */
export function encodeTextTokenRuns(runs: readonly TextTokenRun[]): number[] {
  const data: number[] = []
  let prevLine = 0
  let prevStart = 0
  for (const run of runs) {
    const deltaLine = run.line - prevLine
    const deltaStart = deltaLine > 0 ? run.start : run.start - prevStart
    data.push(deltaLine, deltaStart, run.length, run.colorIdx, run.fontStyleBits)
    prevLine = run.line
    prevStart = run.start
  }
  return data
}
