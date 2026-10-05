// 新建闭合双链围栏的文件字段识别（工单 #376 T01，局部输入识别器）：
// 光标所在行内，从 `[[` / `![[` 到 `]]` 的**闭合**围栏，且光标位于「文件
// 字段」（开标记之后、首个 `|` 或 `#` 之前）时给出字段边界与嵌入前缀标记。
//
// 与既有完整渲染解析器的边界（symbol-input 约定「不放宽」）：本识别器是
// 新增局部逻辑，只服务联想触发；`src/shared/wikilink.ts` 的
// parseWikilinkInner / scanWikilinksInLine / scanEmbedsInLine 语义一律不动
// ——识别器认得的形态是渲染解析器命中集合的**超集输入**（如空字段
// `[[]]`、未完成目标 `[[Aa|B]]` 的目标区），反向不成立：识别器对残缺/
// 未闭合/嵌套形态返回 null，保留普通输入。
//
// 识别口径（与 scanWikilinksInLine / scanEmbedsInLine 的守卫同向）：
// - 前置守卫：`[[` 的前一字符为 `[` 时不命中（三连括号）；嵌入 `![[` 的
//   `!` 前为 `[` 或 `!` 时不命中（`[![[x]]` 链接域 / `!![[x]]` 双叹）
// - 围栏内部（开标记与 `]]` 之间）不得出现 `[` / `]` / 换行（行内识别
//   天然无换行）
// - 光标左侧（开标记到光标）不得出现 `|` / `#`——出现即说明光标已落入
//   显示文字/锚点字段，不属于文件字段（显示文字编辑不触发候选，规格
//   「路径与显示文字」）
// - 只认闭合围栏（`]]` 必须在光标之后存在）；未闭合保留普通输入
// - 文件字段终点 = 内部首个 `|` 或 `#`（恒在光标之后或与光标重合），
//   无则为 `]]` 起点
//
// 本模块不依赖 vscode/DOM/CM6（node 单测直驱；webview 侧叠加代码上下文
// /frontmatter/表格格区等环境守卫后消费）。

/** 一次文件字段识别结果（偏移为传入 line 的本地偏移；调用方加行基准） */
export interface WikilinkFileField {
  /** 是否嵌入前缀 `![[`（false = 普通 `[[`） */
  embed: boolean
  /** 开标记起点（embed 时含 `!`） */
  openFrom: number
  /** 文件字段起点（开标记之后） */
  fieldFrom: number
  /** 文件字段终点（首个 `|`/`#` 之前；无分隔符时为 `]]` 起点） */
  fieldTo: number
  /** 闭合 `]]` 起点 */
  closeFrom: number
}

/**
 * 判定 line 的 col（0 基，col 须在文件字段内）是否位于可触发联想的闭合
 * 双链文件字段中；命中返回字段边界，否则 null。
 */
export function findWikilinkFileField(line: string, col: number): WikilinkFileField | null {
  if (col < 0 || col > line.length) {
    return null
  }
  // 自右向左找最近的开标记（`[[` 且其起点 ≤ 光标）：左侧内容须落在
  // 文件字段内（无 `|`/`#` 分隔符、无方括号残缺）
  let openAt = -1
  let embed = false
  for (let p = col - 2; p >= 0; p--) {
    if (line[p] !== '[' || line[p + 1] !== '[') {
      continue
    }
    // 遇到任意闭合右括号即停止：说明光标处于更早围栏之外或残缺形态，
    // 再往左的开标记不可能包含光标（中间已有 `]]`）
    const prev = p > 0 ? line[p - 1] : ''
    if (prev === '[') {
      return null // 三连括号（[[[）：不识别（与扫描器前置守卫同向）
    }
    if (prev === '!') {
      const bang = p - 1
      if (bang > 0 && (line[bang - 1] === '[' || line[bang - 1] === '!')) {
        return null // [![[ 链接域 / !![[ 双叹：不识别
      }
      embed = true
    }
    openAt = p
    break
  }
  if (openAt < 0) {
    return null
  }
  const fieldFrom = openAt + 2
  const left = line.slice(fieldFrom, col)
  if (/[\[\]|#]/.test(left)) {
    return null // 左侧已离开文件字段（|/# 分隔）或围栏残缺（方括号）
  }
  const closeAt = line.indexOf(']]', col)
  if (closeAt < 0) {
    return null // 未闭合：保留普通输入
  }
  const right = line.slice(col, closeAt)
  if (/[\[\]]/.test(right)) {
    return null // 右侧围栏内部残缺（单独的 ] 或 [）
  }
  // 文件字段终点：内部首个 | 或 #（必在光标之后——左侧已排除），无则 closeAt
  let fieldTo = closeAt
  for (let i = col; i < closeAt; i++) {
    const ch = line[i]
    if (ch === '|' || ch === '#') {
      fieldTo = i
      break
    }
  }
  return { embed, openFrom: embed ? openAt - 1 : openAt, fieldFrom, fieldTo, closeFrom: closeAt }
}
