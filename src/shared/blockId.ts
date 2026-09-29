// 块 id 形态学与块边界判定单一事实源（#159 宿主块定位 / #162 复制块链接
// 入口）：宿主 wikilinkTarget.findBlockOffset 与 webview 统一右键菜单
// （#183 起为 syncController 的 copyBlockLink 链路，前身 blockMenu 已退役
// 并入）同源，两端对「什么算块、块 id 写在哪、已有 id 怎么认」的判定逐字
// 节一致。
//
// 块 id 双形态（#163 验收反馈对齐 Obsidian；识别是增集——两形态并存，
// 不剥夺用户手写任一形态的选择权）：
// - 行尾形态（#159/#162 原生）：正文 + 至少一个空格/制表符 + `^id` + 行尾
// - 独立行形态（#163 起新的默认写入形态）：整行仅 `^id`（容忍前后空白与
//   缩进），Obsidian 语义中归属其上方块（跨空行回溯第一个非空行所属块，
//   紧贴无空行同样归属）
//
// 坐标约定：入参一律为**已剥行尾 \r 的行数组**（webview CM6 全程 LF 坐标
// 天然满足；宿主侧自行剥 \r 后传入——宿主系 offset 的 \r 累计归宿主，
// 本模块只认行索引，不产文本偏移）。
//
// 规则（与 #159 findBlockOffset 的既有矩阵同口径，写入测试固定）：
// - 块 id 行尾标记：见上「双形态」；id 字符集 [A-Za-z0-9-]（Obsidian 官方
//   约束，与 wikilink.ts 的 BLOCK_ID_RE 同集）。行内代码内的字面 `^id`
//   因其后还有反引号等字符天然不匹配
// - 围栏代码块内部的标记不是块标记（是代码内容）；闭围栏行行尾标记是
//   围栏代码块自身的块 id（Obsidian 形态）；开围栏行的 `^` 属 info string
// - 块边界 = 空行（含纯空白行）、文件头尾或围栏行（普通块的上下行是
//   围栏行时互不吞并——围栏块自成一块）
// - 未闭合围栏延伸到文件末行（与宿主「其后内容全部跳过」语义对齐）
//
// 本模块不依赖 vscode/DOM/CM6（node 单测直驱；宿主与 webview 双产物共用）。

/** 块 id 行尾标记：正文 + 至少一空格/制表符 + `^id` + 行尾（尾随空白容忍）。
 *  id 全字匹配由捕获组与目标串全等保证（`^abc-def` 不被 `abc` 命中） */
export const BLOCK_ID_LINE_RE = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/

/** 块 id 独立行标记（#163 验收反馈）：整行仅 `^id`（容忍前后空白与缩进）。
 *  带正文的行不匹配（那是行尾形态的领地）；`^^`、越集字符不匹配 */
export const STANDALONE_BLOCK_ID_RE = /^[ \t]*\^([A-Za-z0-9-]+)[ \t]*$/

/** 行尾块 id 标记：无标记返回 null（围栏语义由调用方判定——本函数只认
 *  行尾形态，闭围栏行的标记是围栏块自身 id 这一判定在调用方） */
export function blockIdOfLine(line: string): string | null {
  const m = BLOCK_ID_LINE_RE.exec(line)
  return m ? m[1]! : null
}

/** 独立行块 id 标记：整行仅 `^id` 返回 id，否则 null（围栏语义同上由
 *  调用方判定——围栏内部的独立 `^id` 是代码内容） */
export function standaloneBlockIdOf(line: string): string | null {
  const m = STANDALONE_BLOCK_ID_RE.exec(line)
  return m ? m[1]! : null
}

/** ATX 标题行（# 形态；setext 不匹配——一期规则，容器内标题因前缀字符
 *  天然不命中）。文本 = 标记后到行尾、剥可选关闭序列与尾随空白——与宿主
 *  findHeadingOffset 的比较口径及大纲 OutlineItem.text 的取文口径同源，
 *  三处不得各写一套 */
export const ATX_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+([^\n]*?)(?:[ \t]+#+)?[ \t\r]*$/

/** ATX 标题行解析：{ level: 1–6, text: 剥标记与关闭序列的标题原文 }；
 *  非标题行返回 null */
export function atxHeadingOf(line: string): { level: number; text: string } | null {
  const m = ATX_HEADING_RE.exec(line)
  return m ? { level: m[1]!.length, text: m[2]! } : null
}

/** 围栏行标记（``` 或 ~~~，≥3 个，前缀空格 ≤3）：返回围栏字符，非围栏行
 *  返回 null */
export function fenceMarkerOf(line: string): string | null {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
  return m ? m[1]![0]! : null
}

/** 围栏代码块区间（行索引闭区间） */
export interface FenceBlock {
  /** 开围栏行 */
  start: number
  /** 闭围栏行（未闭合围栏 = 文件末行） */
  end: number
  /** 围栏字符（` 或 ~） */
  char: string
}

/** 全文围栏代码块区间扫描：开闭围栏字符须一致（``` 只被 ``` 闭合）；
 *  未闭合围栏延伸到文件末行（其后内容都属围栏内部） */
export function scanFenceBlocks(lines: readonly string[]): FenceBlock[] {
  const out: FenceBlock[] = []
  let char: string | null = null
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const marker = fenceMarkerOf(lines[i]!)
    if (char !== null) {
      if (marker === char) {
        out.push({ start, end: i, char })
        char = null
      }
    } else if (marker !== null) {
      char = marker
      start = i
    }
  }
  if (char !== null) {
    out.push({ start, end: lines.length - 1, char })
  }
  return out
}

/** 行所属块（行索引闭区间）：围栏内部（含开闭围栏行与**围栏内的空行**，
 *  空行在围栏内不是块边界）= 整个围栏块；其余按空行与围栏行分界。围栏外
 *  的空行不属于任何块（返回 null）；越界返回 null */
export function blockRangeOfLine(
  lines: readonly string[],
  lineIndex: number,
): { start: number; end: number } | null {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return null
  }
  for (const fence of scanFenceBlocks(lines)) {
    if (lineIndex >= fence.start && lineIndex <= fence.end) {
      return { start: fence.start, end: fence.end }
    }
  }
  if (lines[lineIndex]!.trim() === '') {
    return null
  }
  let start = lineIndex
  let end = lineIndex
  while (start > 0 && lines[start - 1]!.trim() !== '' && fenceMarkerOf(lines[start - 1]!) === null) {
    start -= 1
  }
  while (end + 1 < lines.length && lines[end + 1]!.trim() !== '' && fenceMarkerOf(lines[end + 1]!) === null) {
    end += 1
  }
  return { start, end }
}

/** 全文已有块 id 集合（id 自动生成的查重域，双形态）：围栏内部不计；闭
 *  围栏行行尾标记是围栏块自身的 id，计入；围栏外独立行 `^id` 计入；开围栏
 *  行的 ^ 属 info string，不计 */
export function collectBlockIds(lines: readonly string[]): Set<string> {
  const ids = new Set<string>()
  let fenceChar: string | null = null
  for (const line of lines) {
    const marker = fenceMarkerOf(line)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        fenceChar = null // 闭围栏：其行尾标记是围栏块自身的 id（下落检查）
      } else {
        continue // 围栏内部（非闭围栏行）的 ^id 是代码内容，不视为块标记
      }
    } else if (marker !== null) {
      fenceChar = marker
      continue // 开围栏行的 ^ 属 info string
    }
    const id = blockIdOfLine(line) ?? standaloneBlockIdOf(line)
    if (id !== null) {
      ids.add(id)
    }
  }
  return ids
}

/** 6 位随机块 id（#163 验收反馈对齐 Obsidian 六位随机块 hash 观感；字符集
 *  [a-z0-9]）：不用内容 hash——相同内容的不同块会映射到同一 id；改用随机
 *  生成 + 已有 id 集合避让（碰撞即重生成直至唯一）。random 注入点供确定性
 *  单测（缺省 Math.random） */
export function generateBlockId(
  existing: ReadonlySet<string>,
  random: () => number = Math.random,
): string {
  for (;;) {
    let id = ''
    for (let i = 0; i < 6; i++) {
      const n = Math.floor(random() * 36)
      id += n < 26 ? String.fromCharCode(97 + n) : String.fromCharCode(48 + n - 26)
    }
    if (!existing.has(id)) {
      return id
    }
  }
}

/** 块尾之后的独立行已有 id 探查（复制块链接查已有 id 的第三落点）：从块尾
 *  行下一行起跳过空行，首个非空行是独立 `^id` 形态即返回——是正文行即止
 *  （那是下一块的领地，不得越过继续找）。紧贴块尾的独立行已被
 *  blockRangeOfLine 吞进块区间，由调用方对 lastLine 用 standaloneBlockIdOf
 *  覆盖，不经本函数 */
export function standaloneBlockIdAfterBlock(
  lines: readonly string[],
  block: { start: number; end: number },
): string | null {
  let i = block.end + 1
  while (i < lines.length && lines[i]!.trim() === '') {
    i += 1
  }
  return i < lines.length ? standaloneBlockIdOf(lines[i]!) : null
}

/** 块尾行行尾起插入的独立行块 id 文本（#163 验收反馈起的默认写入形态）：
 *  空一行 + `^id` 独立行（Obsidian 语义——块标记写在块后空一行处）。插
 *  入不消耗块尾原有的分隔空行，与后续内容天然保持一个空行间距 */
export function planBlockIdInsertion(id: string): string {
  return '\n\n^' + id
}
