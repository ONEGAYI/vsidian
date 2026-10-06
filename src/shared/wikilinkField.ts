// 新建闭合双链围栏的文件字段识别（工单 #376 T01，局部输入识别器；
// #378 T03 扩展为阶段化目标字段识别 + 转阶段/确认编辑计划）：
// 光标所在行内，从 `[[` / `![[` 到 `]]` 的**闭合**围栏，且光标位于
// 「目标区」（开标记之后、`|` 之前——含文件字段与锚点字段）时给出字段
// 边界与阶段标记。
//
// 与既有完整渲染解析器的边界（symbol-input 约定「不放宽」）：本识别器是
// 新增局部逻辑，只服务联想触发；`src/shared/wikilink.ts` 的
// parseWikilinkInner / scanWikilinksInLine / scanEmbedsInLine 语义一律不动
// ——识别器认得的形态是渲染解析器命中集合的**超集输入**（如空字段
// `[[]]`、未完成目标 `[[Aa|B]]` 的目标区、空锚点 `[[#]]`），反向不成立：
// 识别器对残缺/未闭合/嵌套形态返回 null，保留普通输入。
//
// 识别口径（与 scanWikilinksInLine / scanEmbedsInLine 的守卫同向）：
// - 前置守卫：`[[` 的前一字符为 `[` 时不命中（三连括号）；嵌入 `![[` 的
//   `!` 前为 `[` 或 `!` 时不命中（`[![[x]]` 链接域 / `!![[x]]` 双叹）
// - 围栏内部（开标记与 `]]` 之间）不得出现 `[` / `]` / 换行（行内识别
//   天然无换行）
// - 光标必须在 `|` 之前（含左边界）——越过首个 `|` 即显示文字字段，不
//   触发候选（规格「路径与显示文字」：编辑显示文字 B 不触发）
// - 只认闭合围栏（`]]` 必须在光标之后存在）；未闭合保留普通输入
// - 阶段判定：围栏内、`|` 前的首个 `#` 为锚点标记；光标在 `#` 左边界
//   （含）之前为文件阶段；其后为锚点字段——`#^` 形态（# 紧跟 ^）且光标
//   越过 ^ 为块阶段，否则标题阶段。锚点文字中的后续 `#` / `^` 均按文字
//   处理（与 parseWikilinkInner 的「首个 # 恒为分割」同向）
//
// 本模块不依赖 vscode/DOM/CM6（node 单测直驱；webview 侧叠加代码上下文
// /frontmatter/表格格区等环境守卫后消费）。
//
// #381 T06 表格格形态（pipeEscape）：表格单元格内的别名分隔符为转义序列
// `\|`（两字符——裸 `|` 是格边界，写入会破坏网格，见 shared/tableCells 的
// 转义口径）。pipeEscape 模式下围栏内只认 `\|` 为分隔符（pipeAt 指向 `\`，
// pipeWidth=2），编辑计划插入/复用分隔符时写 `\|`。调用方负责把识别窗口
// 收窄到格内容（裸管之外），本模块不判定表格形态。

/** 目标区阶段：文件字段 / 标题锚点 / 块锚点（#378 T03） */
export type WikilinkTargetStage = 'file' | 'heading' | 'block'

/** 识别选项（#381 T06） */
export interface WikilinkFieldScanOptions {
  /** 表格格内形态：别名分隔符为 `\|`（默认 false = 正文单字符 `|`） */
  pipeEscape?: boolean
}

/** 阶段化目标字段识别结果（偏移为传入 line 的本地偏移；调用方加行基准） */
export interface WikilinkTargetField {
  /** 是否嵌入前缀 `![[`（false = 普通 `[[`） */
  embed: boolean
  /** 开标记起点（embed 时含 `!`） */
  openFrom: number
  /** 围栏内部起点（开标记之后 = 文件字段起点） */
  innerFrom: number
  /** 文件字段终点（首个 `#`/`|` 之前；无则为 `]]` 起点） */
  fileTo: number
  /** 闭围栏 `]]` 起点 */
  closeFrom: number
  /** 锚点标记 `#` 位置（围栏内、`|` 前的首个 #）；-1 = 无锚点标记 */
  hashAt: number
  /** 锚点字段起点（# 后；`#^` 形态在 ^ 后）；hashAt < 0 时 -1 */
  anchorFrom: number
  /** 锚点字段终点（`|` 前或 `]]` 前）；hashAt < 0 时 -1 */
  anchorTo: number
  /** 别名分隔符位置（pipeEscape 时指向 `\`；无分隔符 -1） */
  pipeAt: number
  /** 分隔符字符数（#381 T06：pipeEscape 为 2（`\|`），默认 1） */
  pipeWidth: 1 | 2
  /** 光标所在字段阶段 */
  stage: WikilinkTargetStage
}

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
 * 自右向左找最近的开标记（`[[` 且其起点 ≤ 光标）：返回行内偏移与嵌入
 * 标记；无合法开标记（三连括号 / `[![[` / `!![[` 前置守卫）返回 -1。
 */
function findOpenMark(line: string, col: number): { openAt: number; embed: boolean } {
  for (let p = col - 2; p >= 0; p--) {
    if (line[p] !== '[' || line[p + 1] !== '[') {
      continue
    }
    // 遇到任意闭合右括号即停止：说明光标处于更早围栏之外或残缺形态，
    // 再往左的开标记不可能包含光标（中间已有 `]]`）
    const prev = p > 0 ? line[p - 1] : ''
    if (prev === '[') {
      return { openAt: -1, embed: false } // 三连括号（[[[）：不识别（与扫描器前置守卫同向）
    }
    let embed = false
    if (prev === '!') {
      const bang = p - 1
      if (bang > 0 && (line[bang - 1] === '[' || line[bang - 1] === '!')) {
        return { openAt: -1, embed: false } // [![[ 链接域 / !![[ 双叹：不识别
      }
      embed = true
    }
    return { openAt: p, embed }
  }
  return { openAt: -1, embed: false }
}

/**
 * 判定 line 的 col（0 基）是否位于可触发联想的闭合双链**目标区**（| 之前
 * 的文件/锚点字段）中；命中返回阶段化字段边界，否则 null。
 * #381 T06：pipeEscape 模式（表格格内）分隔符为 `\|`（pipeAt 指向 `\`、
 * pipeWidth=2）；围栏内只认转义序列为分隔符——裸 `|` 不会出现在格窗口内
 * （调用方收窄），若出现按既有左侧守卫降级。
 */
export function findWikilinkTargetField(
  line: string,
  col: number,
  options?: WikilinkFieldScanOptions,
): WikilinkTargetField | null {
  if (col < 0 || col > line.length) {
    return null
  }
  const pipeEscape = options?.pipeEscape === true
  const { openAt, embed } = findOpenMark(line, col)
  if (openAt < 0) {
    return null
  }
  const innerFrom = openAt + 2
  // 光标左侧（开标记到光标）不得出现 `|`——越过即显示文字字段
  //（pipeEscape 下转义管的 `|` 同样被此拦下：col 越过 `\` 即字段外）
  const left = line.slice(innerFrom, col)
  if (/[\[\]|]/.test(left)) {
    return null
  }
  const closeAt = line.indexOf(']]', col)
  if (closeAt < 0) {
    return null // 未闭合：保留普通输入
  }
  // 围栏内部不得出现 `[` / `]`（残缺形态）
  const inner = line.slice(innerFrom, closeAt)
  if (/[\[\]]/.test(inner)) {
    return null
  }
  // 别名分隔符：默认围栏内首个 `|`；pipeEscape 下首个转义序列 `\|`
  //（pipeAt 指向 `\`——编辑计划据此复用/越过完整序列）
  let pipeAt: number
  let pipeWidth: 1 | 2
  if (pipeEscape) {
    const escAt = inner.indexOf('\\|')
    pipeAt = escAt >= 0 ? innerFrom + escAt : -1
    pipeWidth = 2
  } else {
    const bareAt = inner.indexOf('|')
    pipeAt = bareAt >= 0 ? innerFrom + bareAt : -1
    pipeWidth = 1
  }
  // pipeEscape 时光标越过转义管首字符（含 `\` 与 `|` 之间）＝显示文字字段：
  // 上方 left 检查拦住 `|` 之后，此处拦 `\` 与 `|` 之间的位置
  if (pipeEscape && pipeAt >= 0 && col > pipeAt) {
    return null
  }
  const targetEnd = pipeAt >= 0 ? pipeAt : closeAt
  // 锚点标记：目标区内首个 `#`（| 后的 # 属显示文字，不算）
  const hashRel = line.slice(innerFrom, targetEnd).indexOf('#')
  const hashAt = hashRel >= 0 ? innerFrom + hashRel : -1
  // 阶段判定：# 左边界（含）之前为文件字段；其后锚点字段——`#^` 且光标
  // 越过 ^ 为块阶段，否则标题阶段
  let stage: WikilinkTargetStage = 'file'
  if (hashAt >= 0 && col > hashAt) {
    stage = line.startsWith('^', hashAt + 1) && col > hashAt + 1 ? 'block' : 'heading'
  }
  const fileTo = hashAt >= 0 ? hashAt : targetEnd
  // 锚点字段起点按阶段取：标题阶段从 # 后起（区间含 #^ 间光标），块阶段
  // （恒为 #^ 形态）从 ^ 后起
  const anchorFrom = hashAt >= 0 ? (stage === 'block' ? hashAt + 2 : hashAt + 1) : -1
  const anchorTo = hashAt >= 0 ? targetEnd : -1
  return {
    embed, openFrom: embed ? openAt - 1 : openAt, innerFrom, fileTo, closeFrom: closeAt,
    hashAt, anchorFrom, anchorTo, pipeAt, pipeWidth, stage,
  }
}

/**
 * 判定 line 的 col（0 基，col 须在文件字段内）是否位于可触发联想的闭合
 * 双链文件字段中；命中返回字段边界，否则 null。
 */
export function findWikilinkFileField(line: string, col: number): WikilinkFileField | null {
  const field = findWikilinkTargetField(line, col)
  if (!field || field.stage !== 'file') {
    return null
  }
  return {
    embed: field.embed,
    openFrom: field.openFrom,
    fieldFrom: field.innerFrom,
    fieldTo: field.fileTo,
    closeFrom: field.closeFrom,
  }
}

//#region 转阶段与确认编辑计划（#378 T03，纯函数；webview 控制器组装事务）

/** 会话内可规划按键：# / ^ 转阶段、| 进显示文字、Enter/Tab 确认 */
export type WikilinkPhaseKey = '#' | '^' | '|' | 'confirm'

/** 确认/转阶段可选中的候选产物（宿主已核对插入路径与默认别名） */
export interface WikilinkPlanItem {
  insertPath: string
  alias: string
}

/** 标题阶段确认/竖线可选中的候选产物（#379 T04；宿主已解析明确 Markdown
 *  目标并派生文件名默认别名——heading 为写入 #锚点 的标题原文） */
export interface WikilinkHeadingPlanItem {
  heading: string
  alias: string
}

/** 块阶段确认/竖线可选中的候选产物（#380 T05；blockId 为写入 #^锚点 的
 *  id 文本——块阶段 anchorFrom 已在 ^ 后，产物不含 ^ 前缀；alias 为目标
 *  文件名默认别名，无手写别名时使用） */
export interface WikilinkBlockPlanItem {
  blockId: string
  alias: string
}

/** 一次编辑计划（行内坐标；changes 按原坐标升序、互不重叠） */
export interface WikilinkFieldEditPlan {
  changes: Array<{ from: number; to: number; insert: string }>
  /** 编辑后光标（行内坐标，按 changes 应用后的新坐标） */
  cursorTo: number
  /** 编辑后会话去向：heading/block = 转对应阶段（占位）；null = 关闭 */
  nextStage: 'heading' | 'block' | null
}

/**
 * 转阶段/确认编辑计划（规格「高亮与确认」「路径与显示文字」）：
 * - `confirm`（Enter/Tab）：仅文件阶段且须有高亮项——替换整个文件字段
 *   （不留光标右侧旧名称），无 `|` 时在目标区末补默认别名（锚点保留在
 *   `|` 前），已有 `|`（含空别名）原样保留；光标落目标区末端（分隔符/
 *   闭围栏之前）；关闭会话。
 * - `#`：仅文件阶段——有高亮先补全文件，无高亮保留原输入；目标区末
 *   （`fileTo`）已有 `#` 则复用不重复插，否则插 `#`；光标跳/落在锚点
 *   起点，转标题阶段。
 * - `^`：文件/标题阶段——文件阶段无 `#` 一次形成 `#^`（有高亮先补全），
 *   已有 `#` 只补 `^`；标题阶段在光标处补 `^`（保留两侧锚点文字）；
 *   转块阶段。块阶段不接管（null）。
 * - `|`：任意阶段——有真实高亮（仅文件阶段，T03）先补全目标；已有 `|`
 *   复用（光标跳其后、零编辑），否则在目标区末插 `|`；显示文字留空、
 *   已有别名保留；关闭会话（显示文字区不触发候选）。
 *
 * 坐标均为传入 line 的行内偏移；cursorTo 按 changes 应用后的新坐标计算。
 * 阶段不匹配或缺前置条件返回 null（调用方落穿普通输入）。
 */
export function planWikilinkFieldEdit(
  field: WikilinkTargetField,
  key: WikilinkPhaseKey,
  col: number,
  item: WikilinkPlanItem | null,
  headingItem: WikilinkHeadingPlanItem | null = null,
  blockItem: WikilinkBlockPlanItem | null = null,
): WikilinkFieldEditPlan | null {
  const { innerFrom, fileTo, hashAt, anchorFrom, anchorTo, pipeAt, pipeWidth, closeFrom, stage } = field
  /** 分隔符写入形态（#381 T06：格内 pipeWidth=2 写 `\|`——裸 `|` 破坏网格） */
  const pipeIns = pipeWidth === 2 ? '\\|' : '|'
  // 目标区末（| 前或 ] 前；有锚点时 = anchorTo，无锚点 = fileTo）
  const targetEnd = pipeAt >= 0 ? pipeAt : closeFrom
  /** 文件字段替换的坐标平移（插入点/光标在 fileTo 之后时叠加） */
  const replaceDelta = (replace: boolean, insertPath: string): number =>
    replace ? insertPath.length - (fileTo - innerFrom) : 0
  const replaceItem = item !== null && item.insertPath !== '' ? item : null
  /** 标题阶段真实候选（T04；heading 空串防御——宿主已保证非空） */
  const replaceHeading = headingItem !== null && headingItem.heading !== '' ? headingItem : null
  /** 块阶段真实候选（T05；blockId 空串防御——宿主已保证非空） */
  const replaceBlock = blockItem !== null && blockItem.blockId !== '' ? blockItem : null
  /** 锚点字段替换的坐标平移（插入点/光标在 anchorTo 之后时叠加） */
  const headingDelta = replaceHeading !== null
    ? replaceHeading.heading.length - (anchorTo - anchorFrom)
    : 0

  if (key === 'confirm') {
    if (stage === 'block') {
      // #380 T05 块确认：替换整个锚点字段（^ 后的查询文字——^ 前缀由字段
      // 形态承载），无分隔符时补文件名默认别名（与标题确认同规则：块选择
      // 完成后没有用户手写别名仍用文件名）；已有 |（含空别名）原样保留；
      // 关闭会话
      if (!replaceBlock) {
        return null
      }
      const blockChanges: WikilinkFieldEditPlan['changes'] = [
        { from: anchorFrom, to: anchorTo, insert: replaceBlock.blockId },
      ]
      if (pipeAt < 0) {
        blockChanges.push({ from: closeFrom, to: closeFrom, insert: `${pipeIns}${replaceBlock.alias}` })
      }
      return {
        changes: blockChanges,
        cursorTo: anchorFrom + replaceBlock.blockId.length,
        nextStage: null,
      }
    }
    if (stage === 'heading') {
      // #379 T04 标题确认：替换整个锚点字段（不留光标右侧残留），无分隔符
      // 时补文件名默认别名（规格「路径与显示文字」：标题选择完成后没有
      // 用户手写别名仍用文件名）；已有 |（含空别名）原样保留；关闭会话
      if (!replaceHeading) {
        return null
      }
      const changes: WikilinkFieldEditPlan['changes'] = [
        { from: anchorFrom, to: anchorTo, insert: replaceHeading.heading },
      ]
      if (pipeAt < 0) {
        changes.push({ from: closeFrom, to: closeFrom, insert: `${pipeIns}${replaceHeading.alias}` })
      }
      // 光标落锚点末（| 前 / 闭围栏前）——与文件确认「留在目标区末端」对称
      return {
        changes,
        cursorTo: anchorFrom + replaceHeading.heading.length,
        nextStage: null,
      }
    }
    if (stage !== 'file' || !item || item.insertPath === '') {
      return null
    }
    const changes: WikilinkFieldEditPlan['changes'] = [
      { from: innerFrom, to: fileTo, insert: item.insertPath },
    ]
    if (pipeAt < 0) {
      // 无分隔符：目标区末补默认别名（有锚点时锚点保留在 | 前）
      changes.push({ from: targetEnd, to: targetEnd, insert: `${pipeIns}${item.alias}` })
    }
    // 光标 = 目标区末端（新坐标）：文件字段替换后加锚点保留长度（有锚点
    // 时光标在锚点末/新 | 前，无锚点在 | 前——均「便于随后添加锚点」）
    const anchorKeep = hashAt >= 0 ? targetEnd - fileTo : 0
    return {
      changes,
      cursorTo: innerFrom + item.insertPath.length + anchorKeep,
      nextStage: null,
    }
  }

  if (key === '#') {
    if (stage !== 'file') {
      return null
    }
    const delta = replaceDelta(replaceItem !== null, replaceItem?.insertPath ?? '')
    const changes: WikilinkFieldEditPlan['changes'] = replaceItem !== null
      ? [{ from: innerFrom, to: fileTo, insert: replaceItem.insertPath }]
      : []
    if (hashAt >= 0) {
      // 已有锚点标记：复用，光标跳到锚点起点
      return { changes, cursorTo: hashAt + 1 + delta, nextStage: 'heading' }
    }
    changes.push({ from: fileTo, to: fileTo, insert: '#' })
    return { changes, cursorTo: fileTo + 1 + delta, nextStage: 'heading' }
  }

  if (key === '^') {
    if (stage === 'block') {
      return null
    }
    if (stage === 'heading') {
      // 标题阶段：光标处补 ^（已有 # 不重复补）；保留两侧锚点文字
      return {
        changes: [{ from: col, to: col, insert: '^' }],
        cursorTo: col + 1,
        nextStage: 'block',
      }
    }
    // 文件阶段：有高亮先补全，再形成 #^（已有 # 只补 ^）
    const delta = replaceDelta(replaceItem !== null, replaceItem?.insertPath ?? '')
    const changes: WikilinkFieldEditPlan['changes'] = replaceItem !== null
      ? [{ from: innerFrom, to: fileTo, insert: replaceItem.insertPath }]
      : []
    if (hashAt >= 0) {
      changes.push({ from: hashAt + 1, to: hashAt + 1, insert: '^' })
      return { changes, cursorTo: hashAt + 2 + delta, nextStage: 'block' }
    }
    changes.push({ from: fileTo, to: fileTo, insert: '#^' })
    return { changes, cursorTo: fileTo + 2 + delta, nextStage: 'block' }
  }

  // key === '|'：竖线在文件／标题／块阶段都只接受**该阶段**的真实高亮——
  // 文件阶段=文件候选（T01）、标题阶段=标题候选（#379 T04）、块阶段=块
  // 候选（#380 T05）
  if (stage === 'block') {
    const blockChanges: WikilinkFieldEditPlan['changes'] = replaceBlock !== null
      ? [{ from: anchorFrom, to: anchorTo, insert: replaceBlock.blockId }]
      : []
    /** 块锚点替换的坐标平移（插入点/光标在 anchorTo 之后时叠加） */
    const blockDelta = replaceBlock !== null
      ? replaceBlock.blockId.length - (anchorTo - anchorFrom)
      : 0
    if (pipeAt >= 0) {
      // 已有分隔符：复用，光标跳到已有 | 后（已有别名保留；pipeEscape 越
      // 过完整 `\|` 序列——pipeWidth=2）
      return { changes: blockChanges, cursorTo: pipeAt + pipeWidth + blockDelta, nextStage: null }
    }
    blockChanges.push({ from: closeFrom, to: closeFrom, insert: pipeIns })
    return { changes: blockChanges, cursorTo: closeFrom + pipeWidth + blockDelta, nextStage: null }
  }
  if (stage === 'heading') {
    const changes: WikilinkFieldEditPlan['changes'] = replaceHeading !== null
      ? [{ from: anchorFrom, to: anchorTo, insert: replaceHeading.heading }]
      : []
    if (pipeAt >= 0) {
      // 已有分隔符：复用，光标跳到已有 | 后（已有别名保留）
      return { changes, cursorTo: pipeAt + pipeWidth + headingDelta, nextStage: null }
    }
    changes.push({ from: closeFrom, to: closeFrom, insert: pipeIns })
    return { changes, cursorTo: closeFrom + pipeWidth + headingDelta, nextStage: null }
  }
  const pipeItem = stage === 'file' ? replaceItem : null
  const delta = replaceDelta(pipeItem !== null, pipeItem?.insertPath ?? '')
  const changes: WikilinkFieldEditPlan['changes'] = pipeItem !== null
    ? [{ from: innerFrom, to: fileTo, insert: pipeItem.insertPath }]
    : []
  if (pipeAt >= 0) {
    // 已有分隔符：复用，零编辑，光标跳到已有 | 后（已有别名保留）
    return { changes, cursorTo: pipeAt + pipeWidth + delta, nextStage: null }
  }
  changes.push({ from: targetEnd, to: targetEnd, insert: pipeIns })
  return { changes, cursorTo: targetEnd + pipeWidth + delta, nextStage: null }
}

//#endregion
