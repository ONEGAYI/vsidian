// 中文分词词级移动的分词域形态学与移动规划纯函数（#239）：
// Ctrl+Left/Right 词级移动仅对「连续 CJK 分词域」按引擎结果逐词切分，
// 拉丁/数字/空白路径不在本模块——由 CM6 cursorGroupLeft/Right 既有语义
// 原样处理（回归断言钉住，见 test/unit/wordMotion.test.ts）。
//
// 分词域（isCjkTextChar，按码点判定）：CJK 统一表意与扩展（含兼容表意、
// 扩展 B–H）、CJK 符号与标点（U+3000–U+303F）、平假名/片假名、全角
// ASCII 形式（U+FF01–U+FF60）与中文排版常用的通用标点区字符（弯引号、
// 破折号、省略号等显式集合）。域外字符（拉丁、ASCII 标点、空白、emoji、
// 韩文谚文）不走分词细化。
//
// 引擎边界模型：boundaries(text) 返回 text 的全部移动边界偏移（UTF-16
// 索引、升序、含 0 与 text.length、落在码点边界上）。Intl.Segmenter 的
// word 分段中 isWordLike=false 的标点段同样贡献边界（「中文标点独立
// 边界」）；jieba 的 cut 词序列按累计偏移产边界。两侧经
// normalizeWordBoundaries 归一到同一防御形态。
//
// 码点安全（对齐 findSession 惯例）：遍历与边界产出均按码点推进，
// 代理对不被劈开；引擎输出中理论上不会出现的落点在归一时过滤。
export type WordBoundaryFn = (text: string) => readonly number[]

/** 码点是否属 CJK 分词域（域定义见文件头） */
export function isCjkTextChar(codePoint: number): boolean {
  if (codePoint < 0x2014) return false
  if (codePoint <= 0x201d) {
    // U+2014 —、U+2016 ‖、U+2018/2019 ' '、U+201C/201D " "（中文排版常用）
    return codePoint === 0x2014 || codePoint === 0x2016 ||
      (codePoint >= 0x2018 && codePoint <= 0x2019) ||
      (codePoint >= 0x201c && codePoint <= 0x201d)
  }
  if (codePoint === 0x2025 || codePoint === 0x2026) return true // ‥ …
  if (codePoint >= 0x3000 && codePoint <= 0x30ff) return true // CJK 标点 + 假名
  if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return true // 扩展 A
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return true // 统一表意
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return true // 兼容表意
  if (codePoint >= 0xff01 && codePoint <= 0xff60) return true // 全角 ASCII
  if (codePoint >= 0x20000 && codePoint <= 0x323af) return true // 扩展 B–H
  return false
}

/** 引擎边界归一：升序去重、过滤劈开代理对的落点、确保 0 与 len 在场 */
export function normalizeWordBoundaries(text: string, offsets: readonly number[]): number[] {
  const isBoundary = (p: number): boolean => {
    if (p <= 0 || p >= text.length) return true
    const prev = text.charCodeAt(p - 1)
    // 前一单元是高位代理且当前单元是低位代理 ⇒ p 劈开了代理对
    return !(prev >= 0xd800 && prev <= 0xdbff && text.charCodeAt(p) >= 0xdc00)
  }
  const set = new Set<number>([0, text.length])
  for (const offset of offsets) {
    if (Number.isInteger(offset) && offset >= 0 && offset <= text.length && isBoundary(offset)) {
      set.add(offset)
    }
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * 累计偏移：把逐段长度序列转为边界序列（0, l0, l0+l1, …, total）。
 * 长度累计与 total 不一致（调用方数据错位）返回空数组，由
 * normalizeWordBoundaries 退化为「段首尾即边界」形态。
 */
export function cumulativeBoundaries(lengths: readonly number[], total: number): number[] {
  const out: number[] = []
  let acc = 0
  for (const length of lengths) {
    out.push(acc)
    acc += length
  }
  if (acc !== total) return []
  out.push(total)
  return out
}

/** Intl.Segmenter 词级分段引擎（granularity 'word'，ICU 词典分词）：
 *  每个 segment 的起点都是边界（isWordLike=false 的标点段同样贡献，
 *  「中文标点独立边界」），段连续覆盖全文故起点集合 + 尾界即全集。
 *  运行时缺 Intl.Segmenter（理论不可达：chrome118 webview 确定
 *  available；node 18 亦有）返回 null，调用方退化为段首尾边界。 */
export function createIntlWordBoundaries(): WordBoundaryFn | null {
  const ctor = (globalThis as unknown as {
    Intl?: {
      Segmenter?: new (
        locale: string,
        options: { granularity: string },
      ) => { segment(text: string): Iterable<{ segment: string; isWordLike: boolean }> }
    }
  }).Intl?.Segmenter
  if (typeof ctor !== 'function') return null
  const segmenter = new ctor('zh', { granularity: 'word' })
  return (text: string): number[] => {
    if (text.length === 0) return [0]
    const lengths: number[] = []
    for (const { segment } of segmenter.segment(text)) {
      lengths.push(segment.length)
    }
    return normalizeWordBoundaries(text, cumulativeBoundaries(lengths, text.length))
  }
}

/** 词序列（jieba cut 产物）→ 边界集合。词拼接与原文不一致（词典外
 *  形态，理论不可达）返回 null，调用方退化为段首尾边界。 */
export function boundariesFromTokens(text: string, tokens: readonly string[]): number[] | null {
  if (tokens.join('') !== text) return null
  const boundaries = cumulativeBoundaries(tokens.map((token) => token.length), text.length)
  if (boundaries.length === 0) return null
  return normalizeWordBoundaries(text, boundaries)
}

/**
 * 词级移动目标规划（核心纯函数）：行内 offset 处沿 forward 方向按分词
 * 细化一步的目标偏移；返回 null = 该步不涉分词域（拉丁/空白/ASCII 标点/
 * 行界等，交 CM6 原生 group 语义）。
 * 语义：offset 邻近（移动方向一侧）字符属分词域时，取该侧连续域段的
 * 分词边界中距 offset 最近的一个；段内无更细边界时即段界（等同原生整
 * 段跳过，引擎词典未收录的退化形态）。
 * 域外补充（#241 验收修订）：方向一侧是 ASCII 词字符（字母/数字/下划
 * 线）且其连续词段与分词域粘连（无空白/标点分隔）时，目标截断在词段
 * 与域段的交界——原生 word 语义把中英连排吞成整词（CM6 wordChar 覆盖
 * CJK），从拉丁侧发起的移动必须在此切开，中文段留给后续步骤按分词逐
 * 词走；词段与域段间有任何分隔时不切（交原生）。
 */
export function planCjkWordTarget(
  lineText: string,
  offset: number,
  forward: boolean,
  boundariesOf: WordBoundaryFn,
): number | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > lineText.length) return null
  if (forward) {
    if (offset === lineText.length) return null
    const cp = codePointAt(lineText, offset)
    if (!isCjkTextChar(cp)) {
      return asciiRunToCjkSeamForward(lineText, offset)
    }
  } else {
    if (offset === 0) return null
    const prevStart = prevCodePointStart(lineText, offset)
    if (!isCjkTextChar(codePointAt(lineText, prevStart))) {
      return asciiRunToCjkSeamBackward(lineText, prevStart)
    }
  }
  const [segStart, segEnd] = cjkSegmentAround(lineText, offset, forward)
  if (segEnd <= segStart) return null
  const boundaries = boundariesOf(lineText.slice(segStart, segEnd))
  if (forward) {
    for (const boundary of boundaries) {
      const absolute = segStart + boundary
      if (absolute > offset) return absolute
    }
    return null
  }
  let target: number | null = null
  for (const boundary of boundaries) {
    const absolute = segStart + boundary
    if (absolute >= offset) break
    target = absolute
  }
  return target
}

function codePointAt(text: string, index: number): number {
  const value = text.codePointAt(index)
  return value === undefined ? Number.NaN : value
}

/** ASCII 词字符（字母/数字/下划线——CM6 wordSeparators 默认的词面） */
function isAsciiWordChar(codePoint: number): boolean {
  return (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    codePoint === 0x5f
}

/** 前向域外分支：offset 起（含）的 ASCII 词段终点若紧邻分词域，返回
 *  终点（交界）；否则 null（交原生）。 */
function asciiRunToCjkSeamForward(lineText: string, offset: number): number | null {
  if (!isAsciiWordChar(codePointAt(lineText, offset))) {
    return null
  }
  let end = offset
  while (end < lineText.length && isAsciiWordChar(codePointAt(lineText, end))) {
    end++
  }
  if (end < lineText.length && isCjkTextChar(codePointAt(lineText, end))) {
    return end
  }
  return null
}

/** 后向域外分支：start 处（含）向前延伸的 ASCII 词段起点若紧邻分词域，
 *  返回起点（交界）；否则 null（交原生）。start 是 offset 的前一码点。 */
function asciiRunToCjkSeamBackward(lineText: string, start: number): number | null {
  if (!isAsciiWordChar(codePointAt(lineText, start))) {
    return null
  }
  let from = start
  while (from > 0 && isAsciiWordChar(codePointAt(lineText, prevCodePointStart(lineText, from)))) {
    from = prevCodePointStart(lineText, from)
  }
  if (from > 0 && isCjkTextChar(codePointAt(lineText, prevCodePointStart(lineText, from)))) {
    return from
  }
  return null
}

/** offset 前一个码点的起始索引（代理对不劈开） */
export function prevCodePointStart(text: string, offset: number): number {
  if (offset <= 0) return 0
  const prev = text.charCodeAt(offset - 1)
  if (prev >= 0xdc00 && prev <= 0xdfff && offset >= 2) {
    const high = text.charCodeAt(offset - 2)
    if (high >= 0xd800 && high <= 0xdbff) return offset - 2
  }
  return offset - 1
}

/**
 * 包含 offset 邻近域字符的连续分词域段 [start, end)。forward 时段以
 * offset 处字符起算向两侧扩展；backward 时以 offset 前一码点起算——
 * 保证「正在跨越的那段」完整进入引擎（jieba 对短片段切分质量差，
 * 段必须取极大连续区间）。
 */
export function cjkSegmentAround(lineText: string, offset: number, forward: boolean): [number, number] {
  const anchor = forward ? offset : prevCodePointStart(lineText, offset)
  let start = anchor
  while (start > 0 && isCjkTextChar(codePointAt(lineText, prevCodePointStart(lineText, start)))) {
    start = prevCodePointStart(lineText, start)
  }
  let end = anchor
  while (end < lineText.length) {
    const cp = codePointAt(lineText, end)
    if (!isCjkTextChar(cp)) break
    end += cp > 0xffff ? 2 : 1
  }
  return [start, end]
}
