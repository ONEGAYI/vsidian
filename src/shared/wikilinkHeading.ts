// 标题候选枚举与前缀过滤（工单 #379 T04，双链联想标题阶段）：
// 目标 Markdown 正文内的 ATX 标题清单，供宿主侧标题查询（host/
// wikilinkHeadingSource）枚举候选。纯逻辑、不依赖 vscode/DOM/CM6（node
// 单测直驱）。
//
// 口径同源（不建第二套）：
// - ATX 识别与围栏排除复用 shared/blockId 的 ATX_HEADING_RE / fenceMarkerOf
//   （跳转定位 findHeadingOffset 同一状态机形态：开围栏后内容直到闭围栏
//   都不是标题；CRLF 行尾容错）。
// - 同名规范化键 normalizeHeadingText 自 host/wikilinkTarget 提炼至此
//   （跳转「同名取首」的比较键单一事实源——webview 侧宿主产物标记与跳转
//   定位不得各写一套）；wikilinkTarget 经 re-export 保持既有导入面。
// - 重复标题全部展示、保留独立身份与位置（每行一项不合并）；同名项（按
//   规范化键）标记 duplicate——跳转定位取首处，选任何同名项都有定位风险
//   （规格「重复标题的呈现与提示」：检测到重复 toast 提示并继续接受）。
// - 前缀过滤按规范化口径（与同名判定同一折叠）——原文略有差异但定位会同
//   名命中的标题不得漏报。
import { ATX_HEADING_RE, fenceMarkerOf } from './blockId'

/** 标题比较键：trim + 空白折叠 + 小写（跳转定位「同名取首」的匹配口径；
 *  大小写不敏感是标题匹配的一期规则，与文件路径的平台相关大小写语义无关） */
export function normalizeHeadingText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 枚举产物：一个标题候选（重复标题各占一项，行号即独立身份） */
export interface WikilinkHeadingEntry {
  /** ATX 层级（1-6） */
  level: number
  /** 标题文字（ATX 捕获原文；写入 #锚点 用的就是这个形态） */
  text: string
  /** 1-based 行号（候选「层级／位置」显示与身份派生用） */
  line: number
  /** 行首 LF 偏移（含 \r 前文累计；观测与调试用） */
  offset: number
  /** 规范化同名项在场（跳转定位取首处的风险标记；候选不借此改跳转语义） */
  duplicate: boolean
}

/**
 * 按现有 ATX 口径枚举目标正文标题（围栏内伪标题排除；CRLF 容错）。
 * 重复标题保留各自行号独立身份、按规范化键标记 duplicate；Setext 不匹配
 * （一期规则，不因联想扩展解析面）。
 */
export function enumerateAtxHeadings(text: string): WikilinkHeadingEntry[] {
  const entries: Array<Omit<WikilinkHeadingEntry, 'duplicate'>> = []
  let offset = 0
  let line = 1
  let fenceChar: string | null = null
  for (const rawLine of text.split('\n')) {
    const stripped = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const marker = fenceMarkerOf(stripped)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        fenceChar = null // 闭围栏：其后内容恢复标题识别
      }
    } else if (marker !== null) {
      fenceChar = marker // 开围栏：内部伪标题排除
    } else {
      const m = ATX_HEADING_RE.exec(stripped)
      if (m) {
        entries.push({ level: m[1]!.length, text: m[2]!, line, offset })
      }
    }
    offset += rawLine.length + 1
    line += 1
  }
  // 同名标记（二遍计数——规范化键与跳转标题比较同源）
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = normalizeHeadingText(entry.text)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return entries.map((entry) => ({
    ...entry,
    duplicate: (counts.get(normalizeHeadingText(entry.text)) ?? 0) > 1,
  }))
}

/**
 * 按实际输入的标题前缀过滤（空查询 = 全部标题——「# 后进入标题列表」；
 * 前缀比较经 normalizeHeadingText 折叠：大小写、首尾与内部空白差异不造成
 * 漏报，与同名风险判定同一口径）。过滤保留 duplicate 标记与原始顺序
 * （文档顺序即候选顺序，重复不合并、稳定）。
 */
export function filterWikilinkHeadings(
  headings: ReadonlyArray<WikilinkHeadingEntry>,
  query: string,
): WikilinkHeadingEntry[] {
  const prefix = normalizeHeadingText(query)
  if (prefix === '') {
    return [...headings]
  }
  return headings.filter((h) => normalizeHeadingText(h.text).startsWith(prefix))
}
