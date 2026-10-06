// 双链联想块候选纯逻辑（工单 #380 T05）：可引用块枚举（沿用
// shared/blockId 的块边界——空行/围栏分界、连续行合并、围栏整体一块）、
// 片段与已有 id 搜索、目标块补写计划（V01 探针 planTargetBlockId 的生产
// 提炼，见 docs/research/wikilink-completion-v01-probe.md）与撤回双守卫
// 判定（正向 delete 前的纯决策）。纯逻辑、不依赖 vscode/DOM/CM6（node
// 单测直驱；宿主与 webview 双产物共用）。
//
// 口径同源（不建第二套）：
// - 块边界/id 双形态/查重/插入文本形态复用 shared/blockId（跳转
//   findBlockOffset 与右键复制块链接同一状态机）。
// - 补写计划与 V01 探针（test/integration/suite/probe375.ts 的
//   planTargetBlockId）逐字节同口径：已有 id 三落点判定、插入点 = 块尾行
//   行尾序列之前（CRLF 时在 \r 之前——切断 \r\n 会破坏行尾）、插入文本
//   LF 形态 '\n\n^id'（宿主写回时按目标文档 EOL 归一）。
// - 撤回守卫 = V01 放行判据：目标版本自补 ID 后未变 + 标记在记录 offset
//   逐字在场，两关全过才允许正向 delete——绝不走 undo（undo 撤的是目标
//   「最近一笔」，会吃掉目标的无关输入，探针 case 3 反证）。
import {
  blockIdOfLine,
  blockRangeOfLine,
  collectBlockIds,
  fenceMarkerOf,
  generateBlockId,
  planBlockIdInsertion,
  scanFenceBlocks,
  standaloneBlockIdAfterBlock,
  standaloneBlockIdOf,
} from './blockId'
import { frontmatterRange as frontmatterRangeOfText } from './markdownDoc'

/** 显示文本片段上限（块首行 trim 后截断——候选行主文字） */
const SNIPPET_MAX = 60

/** 可引用块枚举条目（一个块一项；已有 id 与无 id 块同列） */
export interface WikilinkBlockEntry {
  /** 块首行（1-based；候选身份与接受时的块身份核对键） */
  line: number
  /** 块行数（「层级／位置」类元信息显示） */
  lineCount: number
  /** 显示文本片段（块首行 trim 后截断；可搜索内容之一） */
  snippet: string
  /** 已有块 id（行尾/紧贴独立行/跨空行独立行三落点判定；无 = 空串） */
  blockId: string
}

/** 剥 \r 行尾的行数组（blockId 模块坐标约定） */
function strippedLines(text: string): string[] {
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

/** 文件头 frontmatter 区间（含首尾围栏行的行索引闭区间）；无/未闭合 null。
 *  F12：判定口径单一事实源为 markdownDoc.frontmatterRange（live 装饰与
 *  阅读切块同一实现——`---` 与 `...` 双收尾、FM_SCAN_LIMIT 有界扫描、
 *  未闭合不识别），此处只做 offset→行索引换算，不再维护本地第二实现
 *  （本地版不认 `...` 收尾，会把 frontmatter 内容误入块候选，内层块
 *  选中写坏 YAML） */
function frontmatterRange(text: string): { start: number; end: number } | null {
  const range = frontmatterRangeOfText(text)
  if (range === null) {
    return null
  }
  // 区间末（结束围栏行行尾）所在行即结束行索引；行首累计换算
  const endLine = text.slice(0, range.end).split('\n').length - 1
  return { start: 0, end: endLine }
}

/**
 * 按现有块边界枚举目标正文全部可引用块：围栏代码块整体一块（含内部
 * 空行）、围栏外按空行与围栏行分界、无空行连续行（连续列表等）整体
 * 一块。跨空行的独立 `^id` 标记行自身不是可引用块（它是上方块的标记，
 * 其归属已在 blockId 判定中体现）；文件头 frontmatter 不进入候选。
 * 无 id 块照常枚举（规格：不能偷换为仅列已有 id）。
 */
export function enumerateReferableBlocks(text: string): WikilinkBlockEntry[] {
  const lines = strippedLines(text)
  const fences = scanFenceBlocks(lines)
  const front = frontmatterRange(text)
  const ranges: Array<{ start: number; end: number }> = []
  const seen = new Set<string>()
  const push = (start: number, end: number): void => {
    const key = `${start}:${end}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    ranges.push({ start, end })
  }
  for (const fence of fences) {
    if (front !== null && fence.start <= front.end) {
      continue // frontmatter 内的围栏不参与
    }
    push(fence.start, fence.end)
  }
  let i = front !== null ? front.end + 1 : 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '' || fenceMarkerOf(line) !== null) {
      i += 1
      continue // 空行是块间缝隙；围栏行归围栏块（上方已收）
    }
    if (front === null || i > front.end) {
      const range = blockRangeOfLine(lines, i)
      if (range) {
        // 跨空行孤立的独立标记行：单行区间且整行是 ^id 标记 → 不是内容块
        const soloMarker = range.start === range.end && standaloneBlockIdOf(line) !== null
        if (!soloMarker) {
          push(range.start, range.end)
        }
        i = range.end + 1
        continue
      }
    }
    i += 1
  }
  ranges.sort((a, b) => a.start - b.start)
  return ranges.map((range) => {
    const firstLine = lines[range.start] ?? ''
    const lastLine = lines[range.end] ?? ''
    const blockId = blockIdOfLine(lastLine) ?? standaloneBlockIdOf(lastLine) ??
      standaloneBlockIdAfterBlock(lines, range) ?? ''
    const snippet = firstLine.trim().slice(0, SNIPPET_MAX)
    return { line: range.start + 1, lineCount: range.end - range.start + 1, snippet, blockId }
  })
}

/**
 * 按实际输入过滤块候选：空查询 = 全部；否则显示文本片段与已有 id 均按
 * trim + 小写包含匹配（用户按片段搜内容、按 id 搜已有标记同一入口）。
 */
export function filterWikilinkBlocks(
  blocks: ReadonlyArray<WikilinkBlockEntry>,
  query: string,
): WikilinkBlockEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return [...blocks]
  }
  return blocks.filter((b) =>
    b.snippet.toLowerCase().includes(q) ||
    (b.blockId !== '' && b.blockId.toLowerCase().includes(q)))
}

/** 目标块补写计划：已有 id 复用（零写入），无 id 查重生成并给出插入计划 */
export type TargetBlockIdPlan =
  | { kind: 'reused'; id: string }
  | {
      kind: 'planned'
      id: string
      /** 插入文本（LF 形态；宿主写回按目标文档 EOL 归一） */
      insertText: string
      /** 插入点：宿主系 offset（\r 计入前文）——块尾行行尾序列之前 */
      insertOffset: number
    }

/** 宿主系行首表（\r 计入前文累计；入参为未剥 \r 的 raw 行） */
function lineStartsOf(rawLines: readonly string[]): number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of rawLines) {
    starts.push(offset)
    offset += line.length + 1
  }
  return starts
}

/**
 * 目标块 id 补写计划（V01 探针同口径的生产提炼）：blockFirstLine 为块
 * 首行（1-based）。已有 id 三落点（块尾行行尾形态 / 块尾行自身紧贴独立
 * 行 / 块尾之后跨空行首个非空行）任一在场即复用、零写入；否则在全文
 * 已有 id 集合（双形态）避让下生成 6 位随机 id，插入点 = 块尾行行尾
 * 序列之前（CRLF 时在 \r 之前），插入文本 LF 形态 '\n\n^id'。行越界或
 * 非可引用行（空行等）返回 null。
 */
export function planTargetBlockId(
  text: string,
  blockFirstLine: number,
  random: () => number = Math.random,
): TargetBlockIdPlan | null {
  const lines = strippedLines(text)
  const idx = blockFirstLine - 1
  if (idx < 0 || idx >= lines.length) {
    return null
  }
  const block = blockRangeOfLine(lines, idx)
  if (!block) {
    return null
  }
  const lastLine = lines[block.end] ?? ''
  const existing = blockIdOfLine(lastLine) ?? standaloneBlockIdOf(lastLine) ??
    standaloneBlockIdAfterBlock(lines, block)
  if (existing !== null) {
    return { kind: 'reused', id: existing }
  }
  const id = generateBlockId(collectBlockIds(lines), random)
  // 宿主系插入点 = 块尾行行首 + 剥 \r 行文本长度 = 行尾序列（\r\n 或 \n）
  // 之前（\r 计入前文行宽——V01 探针 lineEndOffset 同口径）
  const rawStarts = lineStartsOf(text.split('\n'))
  return {
    kind: 'planned',
    id,
    insertText: planBlockIdInsertion(id),
    insertOffset: rawStarts[block.end]! + (lines[block.end] ?? '').length,
  }
}

/** 撤回记录（V01 AddedIdRecord 生产形态）：宿主系坐标与版本基准 */
export interface BlockIdWithdrawRecord {
  id: string
  /** 标记全文（宿主形态——按目标文档 EOL 归一后的 '\n\n^id' 等价物） */
  marker: string
  /** 标记插入点（宿主系 offset） */
  offset: number
  /** 补 ID 生效后的目标版本（撤回守卫的核对基准） */
  versionAfterInsert: number
}

/** 撤回守卫判定（V01 双守卫纯决策；正向 delete 的执行归宿主编排） */
export type WithdrawalVerdict =
  | { action: 'withdraw'; offset: number; length: number }
  | { action: 'keep'; reason: 'version-changed' | 'marker-changed' }

/**
 * 尽力撤回守卫（V01 核心判据，给 T05 的可实施路径）：
 * 1. 目标版本自补 ID 后未变（挡住一切并发修改——含用户输入与 undo/redo）；
 * 2. 标记在记录 offset 逐字在场（防御纵深：版本不变时标记必然原样）。
 * 两关全过才允许正向 delete 精确移除标记文本；任何不符保留标记
 * （结构化 reason 是 toast 的判定数据源）。绝不借目标 undo 撤回——undo
 * 撤的是「最近一笔」，与本轮新增标记无对应关系。
 */
export function withdrawalGuard(
  record: Pick<BlockIdWithdrawRecord, 'marker' | 'offset' | 'versionAfterInsert'>,
  targetNow: { text: string; version: number },
): WithdrawalVerdict {
  if (targetNow.version !== record.versionAfterInsert) {
    return { action: 'keep', reason: 'version-changed' }
  }
  if (targetNow.text.slice(record.offset, record.offset + record.marker.length) !== record.marker) {
    return { action: 'keep', reason: 'marker-changed' }
  }
  return { action: 'withdraw', offset: record.offset, length: record.marker.length }
}
