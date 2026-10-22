// PDF 导出选区切片（T03/#623）：CM6 多选区 → 严格原文片段（纯逻辑）。
//
// 语义（规格 §2.1「选区不自动扩大」）：
// - 输入是 webview CM6 的 selection.ranges（LF 坐标——webview 全程 LF，
//   宿主 whenEditsSettled 后的 LF 全文与切片基准一致）；
// - 归一化：换向（from>to 交换）、钳制到 [0, text.length]、纯光标（空
//   选区）剔除、按 from 排序（文档顺序）、重叠包含剔除（CM6 选区天然
//   不重叠——防御 webview 异常回报）；
// - 邻接不合并：两个相邻独立选区保持两个片段（多选区分别渲染的既定
//   语义，不是同一片段的续接）；
// - 切片严格按字符区间 slice，不扩大到完整段落/表格行/围栏。
//
// 零依赖（不引 node:/DOM——与 pdfExportPayload 同域纯逻辑）。

import type { PdfExportSelectionFragment } from '../../shared/pdfExportPayload'

/** 选区区间（webview 回报形态；from/to 语义为 LF 偏移） */
export interface PdfSelectionRange {
  from: number
  to: number
}

/** 归一化选区：换向 + 钳制 + 去空 + 排序 + 去重叠包含。
 *  输出按文档顺序（from 主键，end 次键），空选区（纯光标）全部剔除。 */
export function normalizeSelectionRanges(
  text: string,
  ranges: readonly PdfSelectionRange[],
): PdfSelectionRange[] {
  const limit = text.length
  const normalized: PdfSelectionRange[] = []
  for (const range of ranges) {
    const from = Math.max(0, Math.min(Math.min(range.from, range.to), limit))
    const to = Math.max(0, Math.min(Math.max(range.from, range.to), limit))
    if (from >= to) continue // 空选区（纯光标）不是有效导入选区
    normalized.push({ from, to })
  }
  normalized.sort((a, b) => a.from - b.from || a.to - b.to)
  const out: PdfSelectionRange[] = []
  for (const range of normalized) {
    const prev = out[out.length - 1]
    if (prev !== undefined && range.to <= prev.to) continue // 重叠包含（防御）
    out.push(range)
  }
  return out
}

/** 选区 → 严格原文片段（切片与原文按位相等；不扩大、不补齐）。 */
export function sliceSelectionFragments(
  text: string,
  ranges: readonly PdfSelectionRange[],
): PdfExportSelectionFragment[] {
  return normalizeSelectionRanges(text, ranges).map((range) => ({
    start: range.from,
    end: range.to,
    text: text.slice(range.from, range.to),
  }))
}
