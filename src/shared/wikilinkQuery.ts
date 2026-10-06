// 双链联想查询：VSCode 查询准备/评分移植（工单 #376 T01，ADR-0014）。
//
// 来源基线：microsoft/vscode 固定提交
// 2dca67a07aba894351849f39d337a921758722e8 的 src/vs/base/common/fuzzyScorer.ts
// （scoreFuzzy / prepareQuery / scoreItemFuzzy）与 src/vs/base/common/filters.ts
// （matchesPrefix）；上游许可为 MIT（Copyright (c) Microsoft Corporation，
// 随本项目 MIT 依赖分发合规）。核查记录与官方测试例对照见
// docs/research/vscode-quick-open-matching.md。
//
// 相对上游的适配差异（均有票面/规格依据，不视为上游等价复刻）：
// 1. 平台分隔符：上游按运行平台把查询的 `/`↔`\` 互转；本项目可搜索路径
//    统一为索引域的根内相对路径（`/` 分隔），故 pathNormalized 固定把 `\`
//    归一为 `/`。评分本身不受影响——上游 considerAsEqual 本就把两类分隔符
//    视为等价；containsPathSeparator 按归一后判定。
// 2. 不移植完整比较器 compareItemsByFuzzyScore：其命中紧凑度/名称长度/
//    路径长度/文本兜底会先消耗同分排序，使票面契约「同分 mtime 新→旧」
//    失效。排序由 rankWikilinkCandidates 以「匹配分数 → 已知 mtime 新→旧
//    （未知沉底）→ 稳定路径」承担。
// 3. 不移植 PATH_IDENTITY（完整路径相等）分支与 IItemAccessor 泛型/评分
//    缓存：本项目以 label（文件名）+ description（根内目录）评分，不做
//    跨根路径直达（ADR-0014 边界），候选查询单次执行无跨请求缓存收益。
// 4. 引号连续匹配按上游口径：片段首尾成对引号表示该片段须连续子串命中
//    （expectContiguousMatch），不扩展为完整短语解析。
//
// 本模块不依赖 vscode/DOM（node 单测直驱；宿主与 webview 双产物共用）。
import * as path from 'node:path'
import { planVaultLinkPath } from './vaultLink'
import { parseWikilinkInner, scanWikilinksInLine } from './wikilink'

/** 高亮区间（UTF-16 code unit 半开区间；对应原始文字偏移） */
export interface WikilinkMatch {
  start: number
  end: number
}

/** 上游 CharCode 常量（只列本移植用到的） */
const enum CharCode {
  Slash = 47,
  Backslash = 92,
  Underline = 95,
  Dash = 45,
  Period = 46,
  Space = 32,
  SingleQuote = 39,
  DoubleQuote = 34,
  Colon = 58,
  A = 65,
  Z = 90,
}

//#region 查询准备（上游 prepareQuery/normalizeQuery 逐行移植，差异见模块头 #1）

export interface WikilinkQueryPiece {
  /** 原始片段（引号保留） */
  readonly original: string
  readonly originalLowercase: string
  /** 分隔符归一形态（`\` → `/`，差异 #1） */
  readonly pathNormalized: string
  /** 剥除引号/通配符/空白/省略号与尾随 # 的评分形态 */
  readonly normalized: string
  readonly normalizedLowercase: string
  /** 首尾成对引号：须连续子串命中（上游 queryExpectsExactMatch 语义） */
  readonly expectContiguousMatch: boolean
}

export interface WikilinkPreparedQuery extends WikilinkQueryPiece {
  /** 按空格拆片（空格拆分出的非空片段）；单片/空查询为 undefined */
  readonly values: readonly WikilinkQueryPiece[] | undefined
  /** 查询含路径分隔符（决定是否走路径分支评分） */
  readonly containsPathSeparator: boolean
}

function queryExpectsExactMatch(query: string): boolean {
  return query.startsWith('"') && query.endsWith('"') && query.length >= 2
}

function normalizeQuery(original: string): { pathNormalized: string; normalized: string; normalizedLowercase: string } {
  // 差异 #1：固定 `\` → `/`（上游按运行平台互转）
  const pathNormalized = original.replace(/\\/g, '/')
  const normalized = pathNormalized.replace(/[\*\u2026\s"]/g, '').replace(/(?<=.)#$/, '')
  return { pathNormalized, normalized, normalizedLowercase: normalized.toLowerCase() }
}

/** 查询准备（上游 prepareQuery 移植）：空格拆片、引号/通配符剥除、
 *  尾随 # 剥除（锚点修饰符不进文件评分） */
export function prepareWikilinkQuery(original: string): WikilinkPreparedQuery {
  if (typeof original !== 'string') {
    original = ''
  }
  const originalLowercase = original.toLowerCase()
  const { pathNormalized, normalized, normalizedLowercase } = normalizeQuery(original)
  const containsPathSeparator = pathNormalized.includes('/')
  const expectContiguousMatch = queryExpectsExactMatch(original)

  let values: WikilinkQueryPiece[] | undefined = undefined
  const originalSplit = original.split(' ')
  if (originalSplit.length > 1) {
    for (const originalPiece of originalSplit) {
      const expectExactMatchPiece = queryExpectsExactMatch(originalPiece)
      const piece = normalizeQuery(originalPiece)
      if (piece.normalized) {
        if (!values) {
          values = []
        }
        values.push({
          original: originalPiece,
          originalLowercase: originalPiece.toLowerCase(),
          pathNormalized: piece.pathNormalized,
          normalized: piece.normalized,
          normalizedLowercase: piece.normalizedLowercase,
          expectContiguousMatch: expectExactMatchPiece,
        })
      }
    }
  }

  return {
    original, originalLowercase, pathNormalized, normalized, normalizedLowercase,
    values, containsPathSeparator, expectContiguousMatch,
  }
}

//#endregion

//#region 逐字符模糊评分（上游 doScoreFuzzy/computeCharScore 逐行移植）
// 上游坐标：VSCode src/vs/base/common/fuzzyScorer.ts（1.82 基线，ADR-0014
// 决策复用算法本体）。已知差异仅在：① label+description 拼接评分的路径
// 分隔符按本项目索引域固定 /（上游按平台 sep）；② 剥离 aria/幽灵文本等
// 宿主专用钩子。除此之外的行序与常量（词首 +8、路径分隔 +5、其他分隔
// +4、驼峰 +2、连续奖励 6/3）与上游逐行对应——对照核对以上游 1.82 源
// 为准，不在此段内引入本地优化（前缀碰撞字界语义由 wikilinkQuery.test
// 「前缀碰撞字界」组钉住）

export type WikilinkFuzzyScore = [number, number[]]

const NO_MATCH = 0
const NO_SCORE: WikilinkFuzzyScore = [NO_MATCH, []]

function scoreSeparatorAtPos(charCode: number): number {
  switch (charCode) {
    case CharCode.Slash:
    case CharCode.Backslash:
      return 5 // 优先路径分隔符…
    case CharCode.Underline:
    case CharCode.Dash:
    case CharCode.Period:
    case CharCode.Space:
    case CharCode.SingleQuote:
    case CharCode.DoubleQuote:
    case CharCode.Colon:
      return 4 // …其次其他分隔符
    default:
      return 0
  }
}

function isUpper(code: number): boolean {
  return CharCode.A <= code && code <= CharCode.Z
}

function considerAsEqual(a: string, b: string): boolean {
  if (a === b) {
    return true
  }
  // 特例：路径分隔符不区分平台差异
  if (a === '/' || a === '\\') {
    return b === '/' || b === '\\'
  }
  return false
}

function computeCharScore(
  queryCharAtIndex: string,
  queryLowerCharAtIndex: string,
  target: string,
  targetLower: string,
  targetIndex: number,
  matchesSequenceLength: number,
): number {
  let score = 0
  if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex]!)) {
    return score
  }
  // 字符命中 +1
  score += 1
  // 连续命中奖励：前 3 位全额（每位 6），其后减半（每位 3）
  if (matchesSequenceLength > 0) {
    score += (Math.min(matchesSequenceLength, 3) * 6) + (Math.max(0, matchesSequenceLength - 3) * 3)
  }
  // 大小写一致 +1
  if (queryCharAtIndex === target[targetIndex]) {
    score += 1
  }
  if (targetIndex === 0) {
    // 词首 +8
    score += 8
  } else {
    // 分隔符后 +5/+4；驼峰边界（非连续序列中）+2
    const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1))
    if (separatorBonus) {
      score += separatorBonus
    } else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) {
      score += 2
    }
  }
  return score
}

/** 顺序模糊评分（上游 doScoreFuzzy 移植）：allowNonContiguousMatches=false
 *  时仅连续子串命中（引号片段口径） */
function doScoreFuzzy(
  query: string,
  queryLower: string,
  queryLength: number,
  target: string,
  targetLower: string,
  targetLength: number,
  allowNonContiguousMatches: boolean,
): WikilinkFuzzyScore {
  const scores: number[] = []
  const matches: number[] = []
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const queryIndexOffset = queryIndex * targetLength
    const queryIndexPreviousOffset = queryIndexOffset - targetLength
    const queryIndexGtNull = queryIndex > 0
    const queryCharAtIndex = query[queryIndex]
    const queryLowerCharAtIndex = queryLower[queryIndex]
    for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
      const targetIndexGtNull = targetIndex > 0
      const currentIndex = queryIndexOffset + targetIndex
      const leftIndex = currentIndex - 1
      const diagIndex = queryIndexPreviousOffset + targetIndex - 1
      const leftScore = targetIndexGtNull ? scores[leftIndex]! : 0
      const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex]! : 0
      const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex]! : 0
      let score: number
      if (!diagScore && queryIndexGtNull) {
        score = 0
      } else {
        score = computeCharScore(queryCharAtIndex!, queryLowerCharAtIndex!, target, targetLower, targetIndex, matchesSequenceLength)
      }
      const isValidScore = score && diagScore + score >= leftScore
      if (isValidScore && (
        allowNonContiguousMatches ||
        queryIndexGtNull ||
        targetLower.startsWith(queryLower, targetIndex)
      )) {
        matches[currentIndex] = matchesSequenceLength + 1
        scores[currentIndex] = diagScore + score
      } else {
        matches[currentIndex] = NO_MATCH
        scores[currentIndex] = leftScore
      }
    }
  }
  // 回溯命中位置（矩阵右下角起）
  const positions: number[] = []
  let queryIndex = queryLength - 1
  let targetIndex = targetLength - 1
  while (queryIndex >= 0 && targetIndex >= 0) {
    const currentIndex = queryIndex * targetLength + targetIndex
    const match = matches[currentIndex]
    if (match === NO_MATCH || match === undefined) {
      targetIndex--
    } else {
      positions.push(targetIndex)
      queryIndex--
      targetIndex--
    }
  }
  return [scores[queryLength * targetLength - 1]!, positions.reverse()]
}

/** 字符串目标模糊评分（上游 scoreFuzzy 移植）；空查询/超长目标返回 NO_SCORE */
export function scoreFuzzy(target: string, query: string, queryLower: string, allowNonContiguousMatches: boolean): WikilinkFuzzyScore {
  if (!target || !query) {
    return NO_SCORE
  }
  const targetLength = target.length
  const queryLength = query.length
  if (targetLength < queryLength) {
    return NO_SCORE
  }
  const targetLower = target.toLowerCase()
  return doScoreFuzzy(query, queryLower, queryLength, target, targetLower, targetLength, allowNonContiguousMatches)
}

//#endregion

//#region 前缀匹配（上游 filters._matchesPrefix ignoreCase 分支移植）

/** 大小写不敏感前缀匹配：命中返回 [{ start: 0, end: word.length }] */
function matchesPrefix(word: string, wordToMatchAgainst: string): WikilinkMatch[] | undefined {
  if (!wordToMatchAgainst || wordToMatchAgainst.length < word.length) {
    return undefined
  }
  // 上游 startsWithIgnoreCase：逐字符 toLowerCase 比较（与 toLocaleUpperCase
  // 提升无关；对本次用途与 toLowerCase().startsWith() 等价）
  if (!wordToMatchAgainst.toLowerCase().startsWith(word.toLowerCase())) {
    return undefined
  }
  return [{ start: 0, end: word.length }]
}

//#endregion

//#region 结构化条目评分（上游 doScoreItemFuzzy 移植；无 path 直达分支）

const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17
const LABEL_SCORE_THRESHOLD = 1 << 16

export interface WikilinkItemScore {
  score: number
  labelMatch: WikilinkMatch[]
  descriptionMatch: WikilinkMatch[]
}

function createMatches(offsets: number[] | undefined): WikilinkMatch[] {
  const ret: WikilinkMatch[] = []
  if (!offsets) {
    return ret
  }
  let last: WikilinkMatch | undefined
  for (const pos of offsets) {
    if (last && last.end === pos) {
      last.end += 1
    } else {
      last = { start: pos, end: pos + 1 }
      ret.push(last)
    }
  }
  return ret
}

function matchOverlaps(matchA: WikilinkMatch, matchB: WikilinkMatch): boolean {
  if (matchA.end < matchB.start) {
    return false
  }
  if (matchB.end < matchA.start) {
    return false
  }
  return true
}

function normalizeMatches(matches: WikilinkMatch[]): WikilinkMatch[] {
  const sortedMatches = [...matches].sort((matchA, matchB) => matchA.start - matchB.start)
  const normalizedMatches: WikilinkMatch[] = []
  let currentMatch: WikilinkMatch | undefined = undefined
  for (const match of sortedMatches) {
    if (!currentMatch || !matchOverlaps(currentMatch, match)) {
      currentMatch = match
      normalizedMatches.push(match)
    } else {
      currentMatch.start = Math.min(currentMatch.start, match.start)
      currentMatch.end = Math.max(currentMatch.end, match.end)
    }
  }
  return normalizedMatches
}

function doScoreItemFuzzySingle(
  label: string,
  description: string | undefined,
  piece: WikilinkQueryPiece,
  preferLabelMatches: boolean,
  allowNonContiguousMatches: boolean,
): WikilinkItemScore | null {
  // 优先 label 命中（preferLabelMatches 或无 description）
  if (preferLabelMatches || !description) {
    const [labelScore, labelPositions] = scoreFuzzy(
      label,
      piece.normalized,
      piece.normalizedLowercase,
      allowNonContiguousMatches && !piece.expectContiguousMatch,
    )
    if (labelScore) {
      // label 前缀匹配给高基础分（输入文件名胜出散布在名称中的命中），
      // 并按查询占 label 的比例给短名加分
      const labelPrefixMatch = matchesPrefix(piece.normalized, label)
      let baseScore: number
      if (labelPrefixMatch) {
        baseScore = LABEL_PREFIX_SCORE_THRESHOLD
        const prefixLengthBoost = Math.round((piece.normalized.length / label.length) * 100)
        baseScore += prefixLengthBoost
      } else {
        baseScore = LABEL_SCORE_THRESHOLD
      }
      return { score: baseScore + labelScore, labelMatch: labelPrefixMatch ?? createMatches(labelPositions), descriptionMatch: [] }
    }
  }
  // label+description 拼接评分（目录加分隔符——上游按平台 sep，本项目固定 /）
  if (description) {
    const descriptionPrefix = `${description}/`
    const descriptionPrefixLength = descriptionPrefix.length
    const descriptionAndLabel = `${descriptionPrefix}${label}`
    const [labelDescriptionScore, labelDescriptionPositions] = scoreFuzzy(
      descriptionAndLabel,
      piece.normalized,
      piece.normalizedLowercase,
      allowNonContiguousMatches && !piece.expectContiguousMatch,
    )
    if (labelDescriptionScore) {
      const labelDescriptionMatches = createMatches(labelDescriptionPositions)
      const labelMatch: WikilinkMatch[] = []
      const descriptionMatch: WikilinkMatch[] = []
      // 拼接命中拆回 label/description 两段（上游同款拆分）
      for (const h of labelDescriptionMatches) {
        if (h.start < descriptionPrefixLength && h.end > descriptionPrefixLength) {
          labelMatch.push({ start: 0, end: h.end - descriptionPrefixLength })
          descriptionMatch.push({ start: h.start, end: descriptionPrefixLength })
        } else if (h.start >= descriptionPrefixLength) {
          labelMatch.push({ start: h.start - descriptionPrefixLength, end: h.end - descriptionPrefixLength })
        } else {
          descriptionMatch.push(h)
        }
      }
      return { score: labelDescriptionScore, labelMatch, descriptionMatch }
    }
  }
  return null
}

function doScoreItemFuzzy(
  label: string,
  description: string | undefined,
  query: WikilinkPreparedQuery,
  preferLabelMatches: boolean,
  allowNonContiguousMatches: boolean,
): WikilinkItemScore | null {
  if (!query.normalized) {
    return null
  }
  // 多片查询：逐片评分并累加；任一片未命中则整项不命中
  if (query.values && query.values.length > 1) {
    let totalScore = 0
    const totalLabelMatches: WikilinkMatch[] = []
    const totalDescriptionMatches: WikilinkMatch[] = []
    for (const piece of query.values) {
      const single = doScoreItemFuzzySingle(label, description, piece, preferLabelMatches, allowNonContiguousMatches)
      if (single === null) {
        return null
      }
      totalScore += single.score
      totalLabelMatches.push(...single.labelMatch)
      totalDescriptionMatches.push(...single.descriptionMatch)
    }
    return {
      score: totalScore,
      labelMatch: normalizeMatches(totalLabelMatches),
      descriptionMatch: normalizeMatches(totalDescriptionMatches),
    }
  }
  return doScoreItemFuzzySingle(label, description, query, preferLabelMatches, allowNonContiguousMatches)
}

/**
 * 结构化条目评分（label=文件名、description=根内目录）：
 * 含路径分隔符的查询走路径分支（label+description 拼接评分），否则优先
 * label 命中（前缀加权）。未命中返回 null。
 */
export function scoreWikilinkItem(label: string, description: string, query: WikilinkPreparedQuery): WikilinkItemScore | null {
  if (!query.normalized) {
    return null
  }
  const preferLabelMatches = !query.containsPathSeparator
  return doScoreItemFuzzy(label, description || undefined, query, preferLabelMatches, true)
}

//#endregion

//#region 候选排序（Vsidian 契约：分数 → mtime 新→旧 → 稳定路径）

/** 候选文件输入（索引域形态：根内相对路径 `/` 分隔） */
export interface WikilinkCandidateFile {
  /** 文件名（含扩展名） */
  name: string
  /** 根内目录（根直下为空串） */
  dir: string
  /** 根内相对路径（`/` 分隔；稳定路径破同分的键） */
  relPath: string
  /** 文件修改时间（毫秒；未知 0 沉底） */
  mtimeMs: number
}

/** 排序后的候选（含分数与高亮区间） */
export interface RankedWikilinkCandidate extends WikilinkCandidateFile {
  score: number
  labelHighlights: WikilinkMatch[]
  dirHighlights: WikilinkMatch[]
}

const NO_HIGHLIGHTS: readonly WikilinkMatch[] = []

function compareByMtimeDescThenPath(a: WikilinkCandidateFile, b: WikilinkCandidateFile): number {
  // 已知 mtime（>0）新→旧；未知（0）沉底；再按稳定路径升序破同分
  if ((a.mtimeMs > 0) !== (b.mtimeMs > 0)) {
    return a.mtimeMs > 0 ? -1 : 1
  }
  if (a.mtimeMs !== b.mtimeMs) {
    return b.mtimeMs - a.mtimeMs
  }
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
}

function compareByScoreThenMtimeThenPath(
  a: RankedWikilinkCandidate,
  b: RankedWikilinkCandidate,
): number {
  if (a.score !== b.score) {
    return b.score - a.score
  }
  return compareByMtimeDescThenPath(a, b)
}

/**
 * 候选排名（T01 排序契约单一实现）：
 * - 空查询（normalized 为空）：全部候选按 mtime 新→旧（未知沉底）、稳定
 *   路径破同分；无评分、无高亮（score=0）。
 * - 有查询：按 {@link scoreWikilinkItem} 评分，未命中淘汰；分数优先，
 *   同分 mtime 新→旧（未知沉底）、稳定路径破同分。
 * total 为命中总数；items 截取前 limit 条（首屏限量，排序在截取前全量
 * 完成——宿主侧有界维护，不把整库逐次传给 webview）。
 */
export function rankWikilinkCandidates(
  files: readonly WikilinkCandidateFile[],
  query: string,
  limit: number,
): { items: RankedWikilinkCandidate[]; total: number } {
  const prepared = prepareWikilinkQuery(query)
  if (!prepared.normalized) {
    const sorted = [...files].sort(compareByMtimeDescThenPath)
    return {
      items: sorted.slice(0, Math.max(0, limit)).map((f) => ({
        ...f, score: 0,
        labelHighlights: [...NO_HIGHLIGHTS],
        dirHighlights: [...NO_HIGHLIGHTS],
      })),
      total: sorted.length,
    }
  }
  const scored: RankedWikilinkCandidate[] = []
  for (const f of files) {
    const hit = scoreWikilinkItem(f.name, f.dir, prepared)
    if (hit === null) {
      continue
    }
    scored.push({
      ...f,
      score: hit.score,
      labelHighlights: hit.labelMatch,
      dirHighlights: hit.descriptionMatch,
    })
  }
  scored.sort(compareByScoreThenMtimeThenPath)
  return { items: scored.slice(0, Math.max(0, limit)), total: scored.length }
}

//#endregion

//#region 默认别名与插入路径（确认产物，经 vaultLink 往返核对）

/**
 * 确认时的默认显示文字：Markdown 去掉末尾 .md（大小写不敏感、只去一次），
 * 其余资源保留完整文件名（规格「新链接文件确认默认别名」）。
 */
export function defaultAliasOf(name: string, kind: 'markdown' | 'asset'): string {
  if (kind !== 'markdown') {
    return name
  }
  return /\.md$/i.test(name) ? name.slice(0, -3) : name
}

/**
 * 来源相对插入路径 + vaultLink 往返核对（验收标准：插入结果经现有解析器
 * 往返核对为所选目标）。计算 docDir → targetAbs 的相对路径（`/` 分隔），
 * 经 {@link planVaultLinkPath}（implicitMd=false 单候选精确语义）规划后
 * 须回到所选目标身份（Windows 宿主大小写不敏感对账），否则 null——调用方
 * 丢弃该候选（不产出不可信插入路径）。
 */
export function planWikilinkInsertPath(
  docDir: string,
  rootDir: string,
  isWindowsHost: boolean,
  targetAbs: string,
): string | null {
  const ops = isWindowsHost ? path.win32 : path.posix
  const rel = ops.relative(ops.resolve(docDir), ops.resolve(targetAbs))
  // rel 为空（targetAbs 即 docDir，目录身份）或跨盘绝对（Windows 相对
  // 结果退化为绝对路径）不可用；含 `..` 的根内上行是合法插入路径——
  // 越界判定交给下方 planVaultLinkPath 往返核对（root 内边界）
  if (!rel || ops.isAbsolute(rel)) {
    return null
  }
  const insertPath = rel.replace(/\\/g, '/')
  const plan = planVaultLinkPath(insertPath, { docDir, rootDir, isWindowsHost }, { implicitMd: false })
  if (plan.kind !== 'inside' || plan.candidates.length === 0) {
    return null
  }
  const hit = plan.candidates[0]!
  const same = isWindowsHost
    ? hit.toLowerCase() === ops.resolve(targetAbs).toLowerCase()
    : hit === ops.resolve(targetAbs)
  return same ? insertPath : null
}

/**
 * 文件候选写回往返校验（code-review F5）：`[[insertPath|alias]]` 须以完整
 * 链接形态被扫描器（scanWikilinksInLine——内部 `[`/`]` 拒绝）与语义解析器
 * （parseWikilinkInner）解析回**同一目标路径**（无锚点）。病态文件名——
 * POSIX `a|b.md`（首个 `|` 被当别名分隔）、`a#b.md`（首个 `#` 被当锚点
 * 标记）、路径含 `^`（裸 ^ 恒非法）、含 `[`/`]`（链接形态守卫拒绝）——
 * 经确认写回后引用静默损坏，与 planWikilinkInsertPath 往返失败同型：不
 * 入候选列表（insertPath 合法 ⟹ 路径各节无 `|` ⟹ 文件名与默认别名也无
 * 裸 `|`，表格 pipeEscape 形态的裂格风险随之覆盖）。
 */
export function wikilinkFileCandidateSafe(insertPath: string, alias: string): boolean {
  if (insertPath.trim() === '') {
    return false
  }
  const inner = `${insertPath}|${alias}`
  const occurrences = scanWikilinksInLine(`[[${inner}]]`)
  if (occurrences.length !== 1) {
    return false
  }
  const parsed = parseWikilinkInner(occurrences[0]!.inner)
  return parsed !== null && parsed.path === insertPath.trim() &&
    parsed.heading === null && parsed.blockId === null
}

/**
 * 标题候选写回往返校验（code-review F5）：`[[目标#标题]]` 须解析回同一
 * 标题（首个 `|` 被当别名分隔裂断标题、含 `#` 判多级标题非法、含 `^` 判
 * 标题块组合非法、以 `^` 开头判块引用、含 `[`/`]` 链接形态守卫拒绝）——
 * 不合法标题不入候选列表，写入侧（wikilinkField 编辑计划）无需再防。
 */
export function wikilinkHeadingCandidateSafe(heading: string): boolean {
  const trimmed = heading.trim()
  if (trimmed === '') {
    return false
  }
  const occurrences = scanWikilinksInLine(`[[t#${heading}]]`)
  if (occurrences.length !== 1) {
    return false
  }
  const parsed = parseWikilinkInner(occurrences[0]!.inner)
  return parsed !== null && parsed.path === 't' &&
    parsed.heading === trimmed && parsed.blockId === null
}

//#endregion
