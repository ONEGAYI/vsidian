// 宿主侧双链锚点定位（工单 #11 起；#196 后单一职责）：
// 目标文档内标题（findHeadingOffset）与块（findBlockOffset）的偏移计算，
// 供跳转链路（textEditorProvider）与链接锚点定位共用。
//
// 文件目标解析已随 #196 迁出：双链文件目标一律按来源文档相对路径解析
// （docDir 基准、越出所属根 escape、多根互不补查），单一实现在
// src/shared/vaultLink.ts（与普通链接/图片及后续 #197 索引、#199/#200
// 重命名共用，不建重复解析器）——basename 全根搜索、文档相对/根相对
// 双候选与 QuickPick 歧义选择已随旧语义废除（ADR-0008 取代 ADR-0002
// 的按需查找/同名选择范围）。
//
// 标题定位（findHeadingOffset）：ATX 标题行扫描（setext 不匹配，一期规则），
// 规范化 = trim + 空白折叠 + 小写（写入测试固定）；围栏代码内的伪标题跳过。
//
// 块定位（findBlockOffset，#159）：行尾 ` ^id` 标记扫描（跳过围栏代码内部；
// 闭围栏行行尾标记算围栏代码块自身的块 id，块首=开围栏行），命中行向上回溯
// 所属块首行（块边界=空行、围栏行或文件头——与 shared/blockId 的
// blockRangeOfLine 同口径：围栏自成一块，紧贴围栏无空行的段落不被吞并），
// 返回 [offset, end) 块首行区间。
//
// 本模块不依赖 vscode（node 单测直驱）。
// 块形态学共享单一事实源（#162 提炼自本模块，行为不变）：ATX/围栏/行尾
// ` ^id` 与独立行 `^id` 双形态判定与 webview 复制块链接入口同源
import {
  ATX_HEADING_RE,
  blockIdOfLine,
  blockRangeOfLine,
  fenceMarkerOf,
  standaloneBlockIdOf,
} from '../shared/blockId'

/** 标题比较键：trim + 空白折叠 + 小写（大小写不敏感是标题匹配的一期规则，
 *  与文件路径的平台相关大小写语义无关—— Obsidian 同款宽松标题匹配） */
export function normalizeHeadingText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 围栏行标记（``` 或 ~~~，≥3 个）：返回围栏字符，非围栏行返回 null。
 *  #162 起实现提炼至 shared/blockId（本模块 import 同源实现） */

/**
 * 目标文档内定位标题：返回首个匹配标题行的 [offset, end)（行首到行尾，
 * 不含换行；selection reveal 与 view.locate 的区间依据）。无命中返回 null。
 * 规则（一期，写入测试）：仅 ATX 标题；围栏代码内的 # 行不作为标题；
 * CRLF 行尾容错。
 */
export function findHeadingOffset(
  text: string,
  heading: string,
): { offset: number; end: number } | null {
  const want = normalizeHeadingText(heading)
  if (want === '') {
    return null
  }
  let offset = 0
  let fenceChar: string | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const marker = fenceMarkerOf(line)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        fenceChar = null // 闭围栏
      }
    } else if (marker !== null) {
      fenceChar = marker // 开围栏：其后内容直到闭围栏都不是标题
    } else {
      const m = ATX_HEADING_RE.exec(line)
      if (m && normalizeHeadingText(m[2]!) === want) {
        return { offset, end: offset + line.length }
      }
    }
    offset += rawLine.length + 1
  }
  return null
}

/** 块 id 行尾标记（` ^id` 形态与全字匹配语义）：#162 起实现提炼至
 *  shared/blockId 的 BLOCK_ID_LINE_RE（本模块经 blockIdOfLine 同源使用） */

/**
 * 目标文档内定位块（#159；#163 验收反馈增集独立行形态）：扫描行尾 ` ^id`
 * 与独立行 `^id` 双形态标记，命中行回溯所属块的首行，返回块首行的
 * [offset, end)（行首到行尾，不含换行——与 findHeadingOffset 的
 * selection reveal / view.locate 区间同款）。
 * 规则（写入测试）：
 * - 行尾形态：命中行向上回溯块首（块边界=空行、围栏行或文件头——与
 *   shared/blockId blockRangeOfLine 同口径；#159/#162 两端闭环：右键写入
 *   id 的块与跳转定位的块逐字节一致）
 * - 独立行形态（Obsidian 语义）：归属其上方块——跨空行回溯第一个非空行，
 *   取该行所属块（紧贴无空行同样归属；块首经 blockRangeOfLine 统一判定，
 *   上方是闭围栏行时归属整个围栏块）；上方无块（文件头悬挂）不命中
 * - 围栏代码块内部的标记不命中；闭围栏行行尾标记是围栏代码块自身的块 id
 *   （Obsidian 形态），块首=开围栏行；开围栏行的 `^` 属 info string
 * - 同 id 多命中取首；未命中返回 null；CRLF 行尾容错（offset 为宿主系，
 *   \r 计入行宽）
 */
export function findBlockOffset(
  text: string,
  blockId: string,
): { offset: number; end: number } | null {
  if (blockId === '') {
    return null
  }
  // 行信息缓存：剥 \r 后文本 + 宿主系行首 offset（\r 计入前文累计）
  const lines: string[] = []
  const lineStarts: number[] = []
  let offset = 0
  for (const rawLine of text.split('\n')) {
    lines.push(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine)
    lineStarts.push(offset)
    offset += rawLine.length + 1
  }
  const anchorOf = (idx: number): { offset: number; end: number } => ({
    offset: lineStarts[idx]!,
    end: lineStarts[idx]! + lines[idx]!.length,
  })
  let fenceChar: string | null = null
  let fenceHead = -1 // 开围栏行 idx（闭围栏行命中时的块首）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const marker = fenceMarkerOf(line)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        // 闭围栏行：Obsidian 允许行尾 ` ^id` 标记整个围栏代码块
        if (blockIdOfLine(line) === blockId) {
          return anchorOf(fenceHead)
        }
        fenceChar = null
      }
      continue // 围栏内部（非闭围栏行）的 ^id 是代码内容，不视为块标记
    }
    if (marker !== null) {
      fenceChar = marker
      fenceHead = i
      continue // 开围栏行的 ^ 属 info string
    }
    if (blockIdOfLine(line) === blockId) {
      let head = i
      // 块边界=空行或围栏行（围栏行是 fenceMarkerOf 命中行；命中行必在围栏
      // 外，回溯首遇的围栏行必为闭围栏行）；到文件头自然停——与
      // blockRangeOfLine 的回溯条件同源
      while (
        head > 0 &&
        lines[head - 1]!.trim() !== '' &&
        fenceMarkerOf(lines[head - 1]!) === null
      ) {
        head--
      }
      return anchorOf(head)
    }
    if (standaloneBlockIdOf(line) === blockId) {
      // 独立行标记归属上方块：跨空行回溯第一个非空行，其所属块即目标
      // （紧贴时空行数为 0；上方是闭围栏行时 blockRangeOfLine 返回整围栏）
      let above = i - 1
      while (above >= 0 && lines[above]!.trim() === '') {
        above--
      }
      if (above < 0) {
        continue // 文件头悬挂：上方无块，不是有效块标记
      }
      const range = blockRangeOfLine(lines, above)
      if (range !== null) {
        return anchorOf(range.start)
      }
    }
  }
  return null
}
