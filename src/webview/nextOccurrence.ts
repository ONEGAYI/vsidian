// 选下一处相同词（工单 #238）的选区计划纯函数单一事实源：
// 匹配语义对齐 VSCode 1.86.2 MultiCursorSession.create——
// - 面板开且搜索词非空 → 沿用面板三开关与面板词；
// - 面板未开 + 无（非空）选区 → 先选中光标所在词，匹配按
//   「大小写敏感 + 全字」override 档（VSCode FindOptionOverride.True 的
//   实际默认，注意不是不敏感）；
// - 面板未开 + 有选区 → 选区文本为搜索词，沿用面板开关记忆档
//   （shared/findOptions 的 workspace 级状态）。
// 会话语义：会话档与种子词在会话创建时决定、存续期间沿用（每次按下不
// 重新决策——空选区种子的 override 档不因「已有选区」漂移回面板档）；
// 选区外部变化 / 失焦 / 开关切换结束会话（由 syncController 的会话簿记
// 执行，本模块无状态）。
// 匹配引擎复用 findSession 的 computeFindMatches（@codemirror/search
// SearchQuery + literal 口径 + 码点边界过滤 + 成型头区排除），原生
// selectNextOccurrence（恒敏感、无选项联动）由本模块的计划 + 控制器
// dispatch 取代。wordAt 由调用方注入（控制器传 view.state.wordAt），
// 本模块不依赖 EditorView，可在纯环境测试。
import { computeFindMatches, isFindQueryValid, type FindMatch } from './findSession'
import type { FindOptions } from '../shared/findOptions'

/** 选区 range（全文 UTF-16 code unit，与 FindMatch 同构） */
export interface OccurrenceRange {
  from: number
  to: number
}

/** 词边界查询（CM6 EditorState.wordAt 同构：pos 所在词；两侧空白 null） */
export type WordAtFn = (pos: number) => OccurrenceRange | null

/**
 * 空选区种子档（面板未开时的 Ctrl+D 默认档）：大小写敏感 + 全字。
 * VSCode 口径：这是会话级 override，不写回面板开关记忆
 * （shared/findOptions 状态不变，仅本次会话生效）。
 */
export const OCCURRENCE_OVERRIDE_OPTIONS: FindOptions = {
  matchCase: true,
  wholeWord: true,
  regexp: false,
}

/** 查找选项条稳定类名（ADR-0004；`vsidian-` 前缀；契约登记见
 *  shared/styleContract 的 find-options-bar 条目）。
 *  按钮态与主面板开关同源（aria-pressed = this.findOptions 对应开关），
 *  不显示会话 override 档——选项条是面板开关的迷你遥控器 */
export const OCCURRENCE_CLASS_NAMES = {
  /** 迷你浮动条容器（webview 内；三按钮，无搜索框无计数） */
  bar: 'vsidian-occurrence-bar',
  /** 显示态（会话在场；默认 display:none） */
  barOpen: 'vsidian-occurrence-bar-open',
  /** 大小写开关（Aa）与点亮态 */
  caseToggle: 'vsidian-occurrence-case',
  caseActive: 'vsidian-occurrence-case-active',
  /** 全字开关（ab）与点亮态 */
  wordToggle: 'vsidian-occurrence-word',
  wordActive: 'vsidian-occurrence-word-active',
  /** 正则开关（.*）与点亮态 */
  regexpToggle: 'vsidian-occurrence-regexp',
  regexpActive: 'vsidian-occurrence-regexp-active',
} as const

/** 会话种子：匹配档 + 搜索词（会话存续期间沿用） */
export interface OccurrenceSeed {
  options: FindOptions
  searchText: string
}

/**
 * 会话种子决策（对齐 VSCode MultiCursorSession.create）。
 * - 返回 seed：可建会话（调用方以 seed.options/searchText 匹配）；
 * - 返回 'inconsistent'：多选区（含多光标各自扩词后）文本不一致——
 *   不加选，调用方应改为把各空光标扩为词（planExpandWords）；
 * - 返回 null：无从取词（无面板词、无选区、光标不在词上）——命令无效果。
 */
export function resolveOccurrenceSeed(input: {
  panelOpen: boolean
  panelQuery: string
  panelOptions: FindOptions
  text: string
  selection: readonly OccurrenceRange[]
  wordAt: WordAtFn
}): OccurrenceSeed | null | 'inconsistent' {
  const { panelOpen, panelQuery, panelOptions, text, selection, wordAt } = input
  // 面板开且词非空：面板词 + 面板档（选区只影响匹配起点，不影响种子）
  if (panelOpen && panelQuery !== '') {
    return { options: { ...panelOptions }, searchText: panelQuery }
  }
  const nonEmpty = selection.filter((range) => range.to > range.from)
  const textsEqualCase = (a: string, b: string, caseSensitive: boolean): boolean =>
    caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase()
  if (nonEmpty.length > 0) {
    const first = text.slice(nonEmpty[0]!.from, nonEmpty[0]!.to)
    // 有选区路径的会话档 = 面板档：一致性按面板 matchCase 比较
    if (nonEmpty.some((range) =>
      !textsEqualCase(text.slice(range.from, range.to), first, panelOptions.matchCase))) {
      return 'inconsistent'
    }
    return { options: { ...panelOptions }, searchText: first }
  }
  // 全空选区：各自扩词取种子词（一致建会话，不一致 inconsistent）。
  // 会话档为 override（敏感）：一致性按敏感比较（VSCode 会话档口径）
  const wordTexts: string[] = []
  for (const range of selection) {
    const word = wordAt(range.from)
    if (!word || word.to <= word.from) {
      return null
    }
    wordTexts.push(text.slice(word.from, word.to))
  }
  const firstWord = wordTexts[0]!
  if (wordTexts.some((word) => !textsEqualCase(word, firstWord, true))) {
    return 'inconsistent'
  }
  return { options: { ...OCCURRENCE_OVERRIDE_OPTIONS }, searchText: firstWord }
}

/** 选区计划：none = 无操作；select = 整组替换为目标选区（mainIndex 主光标） */
export type OccurrencePlan =
  | { kind: 'none' }
  | { kind: 'select'; ranges: OccurrenceRange[]; mainIndex: number }

/**
 * 空光标扩词计划：各空 range 扩为所在词（无词保持），非空 range 不动。
 * 无空 range 或扩词后无变化（单空光标不在词上）→ none。
 */
export function planExpandWords(
  selection: readonly OccurrenceRange[],
  wordAt: WordAtFn,
): OccurrencePlan {
  if (!selection.some((range) => range.from === range.to)) {
    return { kind: 'none' }
  }
  const ranges: OccurrenceRange[] = []
  let changed = false
  for (const range of selection) {
    if (range.from === range.to) {
      const word = wordAt(range.from)
      if (word && word.to > word.from) {
        ranges.push({ from: word.from, to: word.to })
        changed = true
      } else {
        ranges.push({ ...range })
      }
    } else {
      ranges.push({ ...range })
    }
  }
  return changed ? { kind: 'select', ranges, mainIndex: 0 } : { kind: 'none' }
}

/** 选区文本一致性（按会话 matchCase 比较；防御层——种子层已检查） */
function selectionConsistent(
  text: string,
  selection: readonly OccurrenceRange[],
  matchCase: boolean,
): boolean {
  const first = text.slice(selection[0]!.from, selection[0]!.to)
  const eq = (a: string, b: string): boolean => (matchCase ? a === b : a.toLowerCase() === b.toLowerCase())
  return selection.every((range) => eq(text.slice(range.from, range.to), first))
}

/** 全部命中（含头区排除与有效性守卫） */
function occurrenceMatches(
  text: string,
  seed: OccurrenceSeed,
  excludeEnd: number,
): FindMatch[] {
  if (seed.searchText === '' || !isFindQueryValid(seed.searchText, seed.options)) {
    return []
  }
  return computeFindMatches(text, seed.searchText, seed.options, excludeEnd)
}

/** 选区是否全部在头区排除界之后（多光标不进头区的防御层） */
function selectionOutsideExclude(
  selection: readonly OccurrenceRange[],
  excludeEnd: number,
): boolean {
  return selection.every((range) => range.from >= excludeEnd)
}

/**
 * 环形匹配内核：from >= afterPos 的首个命中；无则回绕文档头，跳过
 * from 已在 selectedFroms 的命中（wrap 去重，CM6 findNextOccurrence
 * 同款语义）；无候选返回 null。
 */
export function nextOccurrenceMatch(
  text: string,
  searchText: string,
  options: FindOptions,
  excludeEnd: number,
  afterPos: number,
  selectedFroms: ReadonlySet<number>,
): OccurrenceRange | null {
  const matches = occurrenceMatches(text, { options, searchText }, excludeEnd)
  let fallback: FindMatch | null = null
  for (const match of matches) {
    if (match.from >= afterPos) {
      return { from: match.from, to: match.to }
    }
    if (!selectedFroms.has(match.from) && !fallback) {
      fallback = match
    }
  }
  return fallback ? { from: fallback.from, to: fallback.to } : null
}

/** 目标选区合并辅助：现有选区 + 新命中 → 排序去重，主光标指新命中 */
function withAddedRange(
  selection: readonly OccurrenceRange[],
  added: OccurrenceRange,
): { kind: 'select'; ranges: OccurrenceRange[]; mainIndex: number } {
  const all = [...selection.map((range) => ({ ...range })), { ...added }]
  all.sort((a, b) => a.from - b.from || a.to - b.to)
  const ranges: OccurrenceRange[] = []
  let mainIndex = -1
  for (const range of all) {
    const last = ranges[ranges.length - 1]
    if (last && last.from === range.from && last.to === range.to) {
      continue
    }
    if (mainIndex < 0 && range.from === added.from && range.to === added.to) {
      mainIndex = ranges.length
    }
    ranges.push(range)
  }
  return { kind: 'select', ranges, mainIndex }
}

/**
 * 选下一处（Ctrl+D 步进）计划：
 * - 存在空 range → 种子行为（空扩词，planExpandWords 同款）；
 * - 全非空：多选区不一致不加选（none）；一致则从最末选区起环形找下一处
 *   追加（新命中为主光标）；全部命中已被选 → none（保持现状）。
 */
export function planSelectNext(
  text: string,
  selection: readonly OccurrenceRange[],
  seed: OccurrenceSeed,
  excludeEnd: number,
  wordAt: WordAtFn,
): OccurrencePlan {
  if (selection.some((range) => range.from === range.to)) {
    return planExpandWords(selection, wordAt)
  }
  if (!selection.length || !selectionOutsideExclude(selection, excludeEnd)) {
    return { kind: 'none' }
  }
  if (!selectionConsistent(text, selection, seed.options.matchCase)) {
    return { kind: 'none' }
  }
  const matches = occurrenceMatches(text, seed, excludeEnd)
  if (!matches.length) {
    return { kind: 'none' }
  }
  const last = selection[selection.length - 1]!
  const selectedFroms = new Set(selection.map((range) => range.from))
  const next = nextFromMatches(matches, last.to, selectedFroms)
  return next ? withAddedRange(selection, next) : { kind: 'none' }
}

/**
 * 选上一处（无默认键位的对称操作）计划：从最前选区起往前找上一处追加
 * （新命中为主光标）；文档头 wrap 回尾部（已选跳过）。
 */
export function planSelectPrevious(
  text: string,
  selection: readonly OccurrenceRange[],
  seed: OccurrenceSeed,
  excludeEnd: number,
  wordAt: WordAtFn,
): OccurrencePlan {
  if (selection.some((range) => range.from === range.to)) {
    return planExpandWords(selection, wordAt)
  }
  if (!selection.length || !selectionOutsideExclude(selection, excludeEnd)) {
    return { kind: 'none' }
  }
  if (!selectionConsistent(text, selection, seed.options.matchCase)) {
    return { kind: 'none' }
  }
  const matches = occurrenceMatches(text, seed, excludeEnd)
  if (!matches.length) {
    return { kind: 'none' }
  }
  const first = selection[0]!
  const selectedFroms = new Set(selection.map((range) => range.from))
  // 最前选区之前（from < first.from）的最后一个命中；无则 wrap 到尾部
  // 未被选中的最后一个命中
  let prev: FindMatch | null = null
  for (const match of matches) {
    if (match.from >= first.from) {
      break
    }
    if (!selectedFroms.has(match.from)) {
      prev = match
    }
  }
  if (!prev) {
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i]!
      if (!selectedFroms.has(match.from)) {
        prev = match
        break
      }
    }
  }
  return prev ? withAddedRange(selection, prev) : { kind: 'none' }
}

/**
 * 跳过链（Ctrl+K Ctrl+D）计划：去掉最后加的选区、把光标移到其后下一处
 * 匹配（不加选——净选区数量不变）。
 * - 存在空 range：种子选词并立即追加下一处（两步合一，对齐 VSCode 无
 *   会话首按「当前词 + 下一处」的实测行为）；
 * - 只有种子选区（单 range）：与 Ctrl+D 同款追加；
 * - 已有加选（多 range）：最末选区替换为其后下一处；无候选 → none
 *   （选区保持不变）。
 */
export function planSkipCurrent(
  text: string,
  selection: readonly OccurrenceRange[],
  seed: OccurrenceSeed,
  excludeEnd: number,
  wordAt: WordAtFn,
): OccurrencePlan {
  const hasEmpty = selection.some((range) => range.from === range.to)
  if (hasEmpty) {
    const expanded = planSelectNext(text, selection, seed, excludeEnd, wordAt)
    if (expanded.kind !== 'select' || !expanded.ranges.length) {
      return expanded
    }
    return planSelectNext(text, expanded.ranges, seed, excludeEnd, wordAt)
  }
  if (!selection.length || !selectionOutsideExclude(selection, excludeEnd)) {
    return { kind: 'none' }
  }
  if (!selectionConsistent(text, selection, seed.options.matchCase)) {
    return { kind: 'none' }
  }
  if (selection.length === 1) {
    return planSelectNext(text, selection, seed, excludeEnd, wordAt)
  }
  const matches = occurrenceMatches(text, seed, excludeEnd)
  if (!matches.length) {
    return { kind: 'none' }
  }
  const last = selection[selection.length - 1]!
  const kept = selection.slice(0, -1)
  // wrap 去重含被去掉的选区：刚跳过的位置不得回选（全部命中已选时跳过
  // 无候选 → none，选区保持不变——对齐 VSCode 全选后跳过无效果）
  const selectedFroms = new Set(selection.map((range) => range.from))
  const next = nextFromMatches(matches, last.to, selectedFroms)
  return next ? withAddedRange(kept, next) : { kind: 'none' }
}

/**
 * 全选（Ctrl+Shift+L）计划：一次选中全部相同词转多光标。
 * 空光标先按种子扩词；命中集为引擎全量（头区排除同源）。
 */
export function planSelectAllOccurrences(
  text: string,
  selection: readonly OccurrenceRange[],
  seed: OccurrenceSeed,
  excludeEnd: number,
  wordAt: WordAtFn,
): OccurrencePlan {
  let base = selection
  if (selection.some((range) => range.from === range.to)) {
    const expanded = planExpandWords(selection, wordAt)
    if (expanded.kind === 'none') {
      return { kind: 'none' }
    }
    base = expanded.ranges
  }
  if (!base.length || !selectionOutsideExclude(base, excludeEnd)) {
    return { kind: 'none' }
  }
  const matches = occurrenceMatches(text, seed, excludeEnd)
  if (!matches.length) {
    return { kind: 'none' }
  }
  return { kind: 'select', ranges: matches.map((match) => ({ from: match.from, to: match.to })), mainIndex: 0 }
}

/** 环形查找：afterPos 起首个命中；无则回绕到首个未选命中 */
function nextFromMatches(
  matches: readonly FindMatch[],
  afterPos: number,
  selectedFroms: ReadonlySet<number>,
): OccurrenceRange | null {
  for (const match of matches) {
    if (match.from >= afterPos) {
      return { from: match.from, to: match.to }
    }
  }
  for (const match of matches) {
    if (!selectedFroms.has(match.from)) {
      return { from: match.from, to: match.to }
    }
  }
  return null
}
