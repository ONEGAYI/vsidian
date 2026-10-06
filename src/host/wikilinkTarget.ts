// 宿主侧双链锚点定位（工单 #11 起；#196 后单一职责）：
// 目标文档内标题（findHeadingOffset）与块（findBlockOffset）的偏移计算，
// 供跳转链路（textEditorProvider）与链接锚点定位共用。
//
// #219 起补两个**完整范围**函数（悬停局部预览用）：
// - findHeadingSectionRange：标题章节（标题行起、止于下一同级或更高级标题前）
// - findBlockRange：块 id 归属块的完整区间（块首行到块尾行）
// 跳转与预览的范围需求不同——跳转要落点位置（标题行/块首行），预览要
// 完整区间；两组函数共享同一匹配口径（同名取首、围栏跳过、规范化），
// 不得各写一套。
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
// 标题比较键单一事实源已提炼至 shared（#379 T04：联想候选的同名风险标记
// 与跳转定位共用同一规范化口径，不建第二套）；re-export 保持既有导入面
export { normalizeHeadingText } from '../shared/wikilinkHeading'
import { normalizeHeadingText } from '../shared/wikilinkHeading'

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
 *
 * #219 起扫描核心提炼为 locateBlockAnchor（与 findBlockRange 共享——
 * 同一块归属判定不建两套），本函数返回值契约不变（既有跳转回归把关）。
 */
export function findBlockOffset(
  text: string,
  blockId: string,
): { offset: number; end: number } | null {
  const scan = locateBlockAnchor(text, blockId)
  if (!scan) {
    return null
  }
  const range = blockRangeOfLine(scan.lines, scan.anchorLine)
  if (!range) {
    return null
  }
  const start = scan.lineStarts[range.start]!
  return { offset: start, end: start + scan.lines[range.start]!.length }
}

/** 块锚定行定位结果：行数组（剥 \r）、宿主系行首表与归属行索引 */
interface BlockAnchorScan {
  lines: string[]
  lineStarts: number[]
  /** 归属行（blockRangeOfLine 的输入行）：行尾形态=命中行自身（块内任意
   *  行），独立行形态=跨空行回溯到的上方非空行，闭围栏行标记=开围栏行 */
  anchorLine: number
}

/**
 * 块 id 归属行扫描核心（#219 提炼自 findBlockOffset，行为逐字节一致）：
 * 双形态标记扫描 + 围栏跟踪，返回「块归属判定所依据的行」；完整块区间
 * 由调用方经 blockRangeOfLine 统一判定（前后扩展到空行/围栏边界）。
 */
function locateBlockAnchor(text: string, blockId: string): BlockAnchorScan | null {
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
  let fenceChar: string | null = null
  let fenceHead = -1 // 开围栏行 idx（闭围栏行命中时的块首）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const marker = fenceMarkerOf(line)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        // 闭围栏行：Obsidian 允许行尾 ` ^id` 标记整个围栏代码块
        if (blockIdOfLine(line) === blockId) {
          return { lines, lineStarts, anchorLine: fenceHead }
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
      return { lines, lineStarts, anchorLine: i }
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
      return { lines, lineStarts, anchorLine: above }
    }
  }
  return null
}

/**
 * 目标文档内块 id 归属块的**完整范围**（#219 悬停局部预览）：块首行行首
 * 到块尾行行尾（不含换行）——列表、表格、围栏等多行块整取，不能拿块首
 * 行当完整正文。块归属判定与 findBlockOffset 同源（locateBlockAnchor +
 * blockRangeOfLine），两者对同一文档同一 id 的块首行恒一致；未命中与
 * 空 id 返回 null；CRLF 行尾容错（offset 为宿主系）。
 */
export function findBlockRange(
  text: string,
  blockId: string,
): { start: number; end: number } | null {
  const scan = locateBlockAnchor(text, blockId)
  if (!scan) {
    return null
  }
  const range = blockRangeOfLine(scan.lines, scan.anchorLine)
  if (!range) {
    return null
  }
  return {
    start: scan.lineStarts[range.start]!,
    end: scan.lineStarts[range.end]! + scan.lines[range.end]!.length,
  }
}

/**
 * 目标文档内标题**章节**的完整范围（#219 悬停局部预览）：目标标题行行首
 * 起、止于下一个**同级或更高级** ATX 标题行之前（含目标标题行；其后无
 * 更高标题则到文件末个非空行行尾；尾随空行不属章节内容）。匹配口径与
 * findHeadingOffset 同源（ATX、normalizeHeadingText 规范化、围栏内伪
 * 标题跳过、同名取首）——章节起点恒为 findHeadingOffset 的命中行，
 * 跳转侧契约不受本函数影响。未命中与空标题返回 null；CRLF 行尾容错
 * （offset 为宿主系，\r 计入前文累计，end 不含行尾）。
 */
export function findHeadingSectionRange(
  text: string,
  heading: string,
): { start: number; end: number } | null {
  const want = normalizeHeadingText(heading)
  if (want === '') {
    return null
  }
  const lines: string[] = []
  const lineStarts: number[] = []
  let offset = 0
  for (const rawLine of text.split('\n')) {
    lines.push(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine)
    lineStarts.push(offset)
    offset += rawLine.length + 1
  }
  // 第一阶段：定位目标标题行（与 findHeadingOffset 同口径；围栏跟踪状态
  // 延续到第二阶段——章节内的围栏由同一状态机覆盖）
  let fenceChar: string | null = null
  let head = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
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
        head = i
        level = m[1]!.length
        break
      }
    }
  }
  if (head < 0) {
    return null
  }
  // 第二阶段：向后扫描到下一个同级或更高级标题行前（更深层的子标题
  // 属于本章节不终止）
  let endLine = lines.length - 1
  for (let i = head + 1; i < lines.length; i++) {
    const line = lines[i]!
    const marker = fenceMarkerOf(line)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        fenceChar = null
      }
      continue
    }
    if (marker !== null) {
      fenceChar = marker
      continue
    }
    const m = ATX_HEADING_RE.exec(line)
    if (m && m[1]!.length <= level) {
      endLine = i - 1
      break
    }
  }
  // 尾随空行收缩：章节内容止于最后非空行行尾（空行是块间缝隙，与
  // ReadingBlock「end 不含块尾换行」坐标契约对齐）
  while (endLine > head && lines[endLine]!.trim() === '') {
    endLine--
  }
  return {
    start: lineStarts[head]!,
    end: lineStarts[endLine]! + lines[endLine]!.length,
  }
}
