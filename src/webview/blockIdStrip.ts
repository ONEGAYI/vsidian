// 阅读侧块 id 标记剥离（#163 验收反馈，口径同 htmlComment.ts）：markdown-it
// 解析前删除块 id 标记，阅读视图不渲染标记。
//
// - 行尾形态 ` ^id`：删标记区间（前导空白到行尾），正文保留
// - 独立行形态 `^id`：删整行内容，保留换行（独立行剥成空行，markdown-it
//   连续空行不产 token，无空块）
// - 围栏内部是代码内容不剥；闭围栏行行尾标记是围栏块自身的 id 照剥；
//   开围栏行的 ^ 属 info string 不剥（未闭合围栏延伸到文件末行）
// - 行数不变是坐标系承诺（readingBlocks 的 token.map 行号与 env.lineStarts
//   均为原文坐标——锚点取行首/行尾偏移，行内偏移不参与，口径同
//   stripHtmlComments）
//
// 识别同源于 shared/blockId（RE 与围栏状态机一致）。仅影响阅读渲染输入
// （splitBody 的 body 切片）：查找、写回、源码文本不经本函数。
import {
  BLOCK_ID_LINE_RE,
  STANDALONE_BLOCK_ID_RE,
  fenceMarkerOf,
} from '../shared/blockId'

/** 阅读渲染输入的块 id 标记剥离：全文（body 切片）→ 删除标记。纯函数 */
export function stripBlockIdMarks(text: string, onRemoved?: (from: number, to: number) => void): string {
  if (!text.includes('^')) {
    return text
  }
  const out: string[] = []
  let fenceChar: string | null = null
  let at = 0
  for (const line of text.split('\n')) {
    const lineFrom = at
    at += line.length + 1
    const marker = fenceMarkerOf(line)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        fenceChar = null // 闭围栏：行尾标记照剥（下落处理）
      } else {
        out.push(line) // 围栏内部：代码内容原样
        continue
      }
    } else if (marker !== null) {
      fenceChar = marker
      out.push(line) // 开围栏行：^ 属 info string，原样
      continue
    }
    if (STANDALONE_BLOCK_ID_RE.test(line)) {
      onRemoved?.(lineFrom, lineFrom + line.length)
      out.push('') // 独立行：整行内容删除，保留换行
      continue
    }
    const m = BLOCK_ID_LINE_RE.exec(line)
    if (m !== null) onRemoved?.(lineFrom + m.index, lineFrom + line.length)
    out.push(m !== null ? line.slice(0, m.index) : line)
  }
  return out.join('\n')
}
