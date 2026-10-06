// 双链文件字段识别器单测（#376 T01；#378 T03 扩展阶段化识别与编辑计划）：
// 闭合空双链 [[]] / ![[]]、文件前缀输入、别名/锚点字段边界与残缺形态降级。
// 识别器是新增局部逻辑——既有完整渲染解析器（wikilink.ts）的命中集合不因
// 本模块扩大（对照断言）。T03 增补：锚点字段（# 标题 / #^ 块）阶段识别，
// 与 #／^／| 转阶段、Enter/Tab 确认的编辑计划纯函数矩阵。
import { describe, expect, it } from 'vitest'
import {
  findWikilinkFileField,
  findWikilinkTargetField,
  planWikilinkFieldEdit,
  type WikilinkTargetField,
} from '../../src/shared/wikilinkField'
import { parseWikilinkInner, scanEmbedsInLine, scanWikilinksInLine } from '../../src/shared/wikilink'

/** 便于断言：返回 {embed, openFrom, fieldFrom, fieldTo, closeFrom} 简写 */
const at = (line: string, col: number) => findWikilinkFileField(line, col)

describe('findWikilinkFileField（新建闭合空双链）', () => {
  it('[[]] 空字段命中，查询为空', () => {
    expect(at('[[]]', 2)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 2, closeFrom: 2 })
  })

  it('![[]] 嵌入前缀命中，openFrom 含 !', () => {
    expect(at('![[]]', 3)).toEqual({ embed: true, openFrom: 0, fieldFrom: 3, fieldTo: 3, closeFrom: 3 })
  })

  it('行内前置文字不影响（openFrom/字段为行内偏移）', () => {
    expect(at('正文 [[]] 尾', 5)).toEqual({ embed: false, openFrom: 3, fieldFrom: 5, fieldTo: 5, closeFrom: 5 })
  })
})

describe('findWikilinkFileField（文件前缀输入与光标位置）', () => {
  it('目标中部光标：查询为光标左侧前缀', () => {
    // [[方案¦]] —— col = 4（'方案' 之后、]] 之前）
    expect(at('[[方案]]', 4)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 4, closeFrom: 4 })
  })

  it('目标中部编辑已有别名链接：[[A¦a|B]] 命中且 fieldTo 在 | 前', () => {
    // col = 3（A 之后）：fieldTo = 首个 | 的位置 4
    expect(at('[[Aa|B]]', 3)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 4, closeFrom: 6 })
  })

  it('显示文字区不命中（[[Aa|B¦]]）', () => {
    expect(at('[[Aa|B]]', 7)).toBeNull()
  })

  it('别名分隔符左侧光标（[[Aa¦|B]]）命中', () => {
    expect(at('[[Aa|B]]', 4)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 4, closeFrom: 6 })
    // 分隔符右侧（显示区）不命中
    expect(at('[[Aa|B]]', 5)).toBeNull()
  })

  it('空字段键入 # 后不命中（锚点字段归后续票）', () => {
    expect(at('[[#]]', 3)).toBeNull()
  })

  it('标题字段中部不命中（[[Aa#标¦题]]）', () => {
    expect(at('[[Aa#标题]]', 6)).toBeNull()
  })

  it('嵌入前缀输入中部命中（![[]] 内键入）', () => {
    expect(at('![[方案]]', 5)).toEqual({ embed: true, openFrom: 0, fieldFrom: 3, fieldTo: 5, closeFrom: 5 })
  })

  it('闭合之后光标不命中（[[Aa]]¦）', () => {
    expect(at('[[Aa]]', 6)).toBeNull()
  })

  it('同一行第二处围栏独立命中', () => {
    // [[a]] [[b¦]] —— 光标在第二处闭围栏前（col=9）
    expect(at('[[a]] [[b]]', 9)).toEqual({ embed: false, openFrom: 6, fieldFrom: 8, fieldTo: 9, closeFrom: 9 })
    // 光标在第一处同样命中第一处
    expect(at('[[a]] [[b]]', 3)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 3, closeFrom: 3 })
    // 落在闭围栏中间（两 ] 之间）不命中
    expect(at('[[a]] [[b]]', 10)).toBeNull()
  })
})

describe('findWikilinkFileField（残缺形态降级）', () => {
  it('未闭合（[[Aa）不命中', () => {
    expect(at('[[Aa', 4)).toBeNull()
  })

  it('三连括号（[[[¦]]）不命中', () => {
    expect(at('[[[]]', 3)).toBeNull()
  })

  it('内部残缺方括号（[[a[b]]）不命中', () => {
    expect(at('[[a[b]]', 7)).toBeNull()
  })

  it('围栏外光标不命中', () => {
    expect(at('正文', 2)).toBeNull()
    expect(at('[[a]] [[b]]', 5)).toBeNull()
  })

  it('!![[ 与 [![[ 前置守卫不命中', () => {
    expect(at('!![[]]', 5)).toBeNull()
    expect(at('[![[]]', 6)).toBeNull()
  })

  it('越界 col 返回 null（防御）', () => {
    expect(at('[[a]]', -1)).toBeNull()
    expect(at('[[a]]', 7)).toBeNull()
  })
})

describe('识别器不放宽既有完整渲染解析器', () => {
  it('识别器命中的空字段在渲染解析器中仍非法（parseWikilinkInner null）', () => {
    expect(at('[[]]', 2)).not.toBeNull()
    expect(parseWikilinkInner('')).toBeNull()
  })

  it('识别器命中的显示文字区在渲染解析器中仍合法（互为补充不互改）', () => {
    expect(parseWikilinkInner('方案|显示')).not.toBeNull()
    expect(at('[[方案|显示]]', 7)).toBeNull() // 显示区不触发联想
  })

  it('既有扫描器命中集合不变（双链/嵌入互斥照旧）', () => {
    const line = '[[a]] ![[b.png]]'
    expect(scanWikilinksInLine(line)).toHaveLength(1)
    expect(scanEmbedsInLine(line)).toHaveLength(1)
  })
})

// ---- #378 T03：阶段化目标字段识别（文件 / 标题锚点 / 块锚点）----

/** 简写：行内 col 处的阶段化识别 */
const target = (line: string, col: number) => findWikilinkTargetField(line, col)

describe('findWikilinkTargetField（锚点字段阶段识别）', () => {
  it('空锚点 # 后光标为标题阶段', () => {
    expect(target('[[#]]', 3)).toMatchObject({
      stage: 'heading', embed: false, openFrom: 0, innerFrom: 2,
      hashAt: 2, anchorFrom: 3, anchorTo: 3, pipeAt: -1, closeFrom: 3,
    })
  })

  it('空锚点 #^ 后光标为块阶段；# 与 ^ 之间仍是标题阶段', () => {
    expect(target('[[#^]]', 4)).toMatchObject({ stage: 'block', hashAt: 2, anchorFrom: 4 })
    expect(target('[[#^]]', 3)).toMatchObject({ stage: 'heading', hashAt: 2, anchorFrom: 3 })
  })

  it('块 ID 中部光标仍是块阶段', () => {
    expect(target('[[#^abc]]', 7)).toMatchObject({ stage: 'block' })
  })

  it('标题字段中部与字段末端（| 左边界）均为标题阶段', () => {
    expect(target('[[A#H|B]]', 4)).toMatchObject({ stage: 'heading', hashAt: 3, anchorFrom: 4, anchorTo: 5, pipeAt: 5 })
    expect(target('[[A#H|B]]', 5)).toMatchObject({ stage: 'heading' })
  })

  it('标题字段内无 |：anchorTo 落在闭围栏前', () => {
    expect(target('[[A#H]]', 5)).toMatchObject({ stage: 'heading', anchorTo: 5, pipeAt: -1, closeFrom: 5 })
  })

  it('已有锚点标记时光标在 # 左边界（含）之前仍是文件阶段', () => {
    expect(target('[[A#H]]', 3)).toMatchObject({ stage: 'file', fileTo: 3, hashAt: 3 })
    expect(target('[[A#H|B]]', 2)).toMatchObject({ stage: 'file', fileTo: 3 })
  })

  it('显示文字区（| 右侧）与 | 后的 # 均不命中', () => {
    expect(target('[[A|B]]', 6)).toBeNull()
    expect(target('[[A|B#C]]', 7)).toBeNull()
  })

  it('锚点内第二个 # 属标题文字（首个 # 为标记），嵌入前缀同构', () => {
    expect(target('[[A#B#C]]', 7)).toMatchObject({ stage: 'heading', hashAt: 3 })
    expect(target('![[A#^i]]', 7)).toMatchObject({ stage: 'block', embed: true, openFrom: 0, innerFrom: 3 })
  })

  it('残缺与未闭合沿用 T01 守卫（锚点字段同样不命中）', () => {
    expect(target('[[A#', 4)).toBeNull()
    expect(target('[[A#[b]]', 6)).toBeNull()
    expect(target('[[A#H]]', 6)).toBeNull() // 闭合之后
  })
})

// ---- #378 T03：转阶段与确认编辑计划（行内坐标；¦ 表示光标）----

const FANGAN = { insertPath: '../资料/方案.md', alias: '方案' }

/** 便于断言：把计划应用到行文本并给出新光标位置（¦ 标记） */
function applyPlan(line: string, plan: { changes: Array<{ from: number; to: number; insert: string }>; cursorTo: number }): string {
  let text = line
  for (const change of [...plan.changes].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, change.from) + change.insert + text.slice(change.to)
  }
  return `${text.slice(0, plan.cursorTo)}¦${text.slice(plan.cursorTo)}`
}

/** 从行文本与光标取识别结果（计划矩阵输入同源单一事实源） */
function fieldOf(line: string, col: number): WikilinkTargetField {
  const field = findWikilinkTargetField(line, col)
  if (!field) {
    throw new Error(`识别失败: ${line}@${col}`)
  }
  return field
}

describe('planWikilinkFieldEdit：Enter/Tab 确认（文件字段整体替换）', () => {
  it('[[A¦a|B]]：替换完整 Aa、原样保留 B、光标在分隔符前', () => {
    const line = '[[Aa|B]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), 'confirm', 3, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md¦|B]]')
    expect(plan!.nextStage).toBeNull()
  })

  it('[[A¦#H]]：锚点保留在 | 前，无分隔符补默认别名，光标在锚点末尾', () => {
    const line = '[[A#H]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), 'confirm', 3, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md#H¦|方案]]')
  })

  it('[[A#^id|B¦]] 目标侧光标位（#^id|B 之前）：已有别名不覆盖、块锚点保留', () => {
    const line = '[[A#^id|B]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), 'confirm', 3, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md#^id¦|B]]')
  })

  it('[[A¦]]：无锚点无分隔符——插入相对路径|默认别名，光标在 | 前（T01 兼容）', () => {
    const line = '[[A]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), 'confirm', 3, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md¦|方案]]')
  })

  it('confirm 文件阶段缺高亮返回 null；标题/块阶段缺标题候选返回 null（占位不可确认）', () => {
    expect(planWikilinkFieldEdit(fieldOf('[[A]]', 3), 'confirm', 3, null)).toBeNull()
    expect(planWikilinkFieldEdit(fieldOf('[[A#H]]', 5), 'confirm', 5, FANGAN)).toBeNull()
    expect(planWikilinkFieldEdit(fieldOf('[[A#^id]]', 7), 'confirm', 7, FANGAN)).toBeNull()
  })
})

describe('planWikilinkFieldEdit：# 转标题阶段', () => {
  it('有高亮：补全文件并加 #，光标在 # 后', () => {
    const line = '[[方]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '#', 3, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md#¦]]')
    expect(plan!.nextStage).toBe('heading')
  })

  it('无高亮：不补文件名，保留原输入加 #（空目标占位）', () => {
    const line = '[[方]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '#', 3, null)
    expect(applyPlan(line, plan!)).toBe('[[方#¦]]')
    expect(plan!.nextStage).toBe('heading')
  })

  it('光标在目标中部且无高亮：保留完整目标，# 落在字段末（右侧文字不残留）', () => {
    // [[A¦a]]：col=3 在 A 与 a 之间
    const line = '[[Aa]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '#', 3, null)
    expect(applyPlan(line, plan!)).toBe('[[Aa#¦]]')
  })

  it('已有锚点标记：不重复插 #，光标跳到锚点起点', () => {
    const line = '[[A#H]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '#', 3, null)
    expect(applyPlan(line, plan!)).toBe('[[A#¦H]]')
    const withItem = planWikilinkFieldEdit(fieldOf(line, 3), '#', 3, FANGAN)
    expect(applyPlan(line, withItem!)).toBe('[[../资料/方案.md#¦H]]')
  })

  it('已有 |：# 插在锚点位置（| 之前），显示文字保留', () => {
    const line = '[[A|B]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '#', 3, null)
    expect(applyPlan(line, plan!)).toBe('[[A#¦|B]]')
  })

  it('非文件阶段按 # 返回 null（标题/块阶段落穿）', () => {
    expect(planWikilinkFieldEdit(fieldOf('[[A#H]]', 5), '#', 5, null)).toBeNull()
    expect(planWikilinkFieldEdit(fieldOf('[[A#^]]', 5), '#', 5, null)).toBeNull()
  })
})

describe('planWikilinkFieldEdit：^ 转块阶段', () => {
  it('文件阶段无 #：一次形成 #^ 语法，光标在 ^ 后', () => {
    const line = '[[Aa]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 4), '^', 4, null)
    expect(applyPlan(line, plan!)).toBe('[[Aa#^¦]]')
    expect(plan!.nextStage).toBe('block')
  })

  it('文件阶段有高亮：补全文件再形成 #^', () => {
    const line = '[[方]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '^', 3, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md#^¦]]')
  })

  it('文件阶段已有锚点标记（光标在 # 前）：不重复补 #，只补 ^', () => {
    const line = '[[A#B]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '^', 3, null)
    expect(applyPlan(line, plan!)).toBe('[[A#^¦B]]')
  })

  it('标题阶段（空锚点）：光标处补 ^ 得 #^，光标在 ^ 后', () => {
    const line = '[[A#]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 4), '^', 4, null)
    expect(applyPlan(line, plan!)).toBe('[[A#^¦]]')
    expect(plan!.nextStage).toBe('block')
  })

  it('标题阶段锚点中部：^ 插在光标处（用户显式输入，保留两侧锚点文字）', () => {
    const line = '[[A#H]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 4), '^', 4, null)
    expect(applyPlan(line, plan!)).toBe('[[A#^¦H]]')
  })

  it('块阶段按 ^ 返回 null（不接管）', () => {
    expect(planWikilinkFieldEdit(fieldOf('[[A#^]]', 5), '^', 5, null)).toBeNull()
  })

  it('空目标按 ^：不写占位词，只形成可继续手写的空块字段', () => {
    const line = '[[]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 2), '^', 2, null)
    expect(applyPlan(line, plan!)).toBe('[[#^¦]]')
  })
})

describe('planWikilinkFieldEdit：| 进显示文字', () => {
  it('有高亮：补全目标后加 |，显示文字留空等待手动输入（新链接）', () => {
    // [[方案.md¦]]：col=7 在 ] 前
    const line = '[[方案.md]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 7), '|', 7, FANGAN)
    expect(applyPlan(line, plan!)).toBe('[[../资料/方案.md|¦]]')
    expect(plan!.nextStage).toBeNull()
  })

  it('无高亮：保留原输入（含光标右侧文字），| 落在目标区末', () => {
    // [[A¦a]]：col=3 在 A 与 a 之间
    const line = '[[Aa]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 3), '|', 3, null)
    expect(applyPlan(line, plan!)).toBe('[[Aa|¦]]')
  })

  it('已有 |：不重复插入，光标跳到已有分隔符后（已有别名保留）', () => {
    const line = '[[Aa|B]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 4), '|', 4, null)
    expect(applyPlan(line, plan!)).toBe('[[Aa|¦B]]')
    expect(plan!.changes).toHaveLength(0)
    const withItem = planWikilinkFieldEdit(fieldOf(line, 3), '|', 3, FANGAN)
    expect(applyPlan(line, withItem!)).toBe('[[../资料/方案.md|¦B]]')
  })

  it('标题阶段按 |：无高亮保留锚点，| 在锚点区末（或复用已有 |）', () => {
    const line = '[[Aa#H]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 6), '|', 6, null)
    expect(applyPlan(line, plan!)).toBe('[[Aa#H|¦]]')
    const piped = planWikilinkFieldEdit(fieldOf('[[Aa#H|B]]', 6), '|', 6, null)
    expect(applyPlan('[[Aa#H|B]]', piped!)).toBe('[[Aa#H|¦B]]')
  })

  it('块阶段按 |：同标题口径', () => {
    const line = '[[A#^id]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 7), '|', 7, null)
    expect(applyPlan(line, plan!)).toBe('[[A#^id|¦]]')
  })
})

// ---- #379 T04：标题阶段确认与竖线（标题候选产物 {heading, alias}）----

const YUSUAN = { heading: '预算', alias: '方案' }

describe('planWikilinkFieldEdit：标题阶段 Enter/Tab 确认（#379 T04）', () => {
  it('[[方案.md#预¦x]]：标题字段整体替换不留残留，无别名补文件名默认别名', () => {
    // col=9：锚点字段中部（'预' 与 'x' 之间）——确认替换整个标题字段，
    // 光标右侧的 'x' 不残留
    const line = '[[方案.md#预x]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 9), 'confirm', 9, null, YUSUAN)
    expect(applyPlan(line, plan!)).toBe('[[方案.md#预算¦|方案]]')
    expect(plan!.nextStage).toBeNull()
  })

  it('已有别名保留不用默认别名覆盖：[[方案.md#H¦|手写]]', () => {
    const line = '[[方案.md#H|手写]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 8), 'confirm', 8, null, YUSUAN)
    expect(applyPlan(line, plan!)).toBe('[[方案.md#预算¦|手写]]')
  })

  it('光标在标题字段首与字段尾同形态（替换区间是整个锚点字段）', () => {
    const head = planWikilinkFieldEdit(fieldOf('[[A#xy]]', 4), 'confirm', 4, null, YUSUAN)
    expect(applyPlan('[[A#xy]]', head!)).toBe('[[A#预算¦|方案]]')
    const tail = planWikilinkFieldEdit(fieldOf('[[A#xy]]', 6), 'confirm', 6, null, YUSUAN)
    expect(applyPlan('[[A#xy]]', tail!)).toBe('[[A#预算¦|方案]]')
  })

  it('缺标题候选返回 null（占位/无高亮不可确认，Enter/Tab 落穿）', () => {
    expect(planWikilinkFieldEdit(fieldOf('[[A#H]]', 5), 'confirm', 5, null, null)).toBeNull()
  })

  it('文件阶段带标题候选不消费（文件确认仍走文件产物）', () => {
    expect(planWikilinkFieldEdit(fieldOf('[[A]]', 3), 'confirm', 3, null, YUSUAN)).toBeNull()
  })
})

describe('planWikilinkFieldEdit：标题阶段 | 进显示文字（#379 T04）', () => {
  it('有真实高亮：接受标题并替换锚点字段（不留残留），| 落在锚点末、显示文字留空', () => {
    const line = '[[方案.md#预x]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 9), '|', 9, null, YUSUAN)
    expect(applyPlan(line, plan!)).toBe('[[方案.md#预算|¦]]')
    expect(plan!.nextStage).toBeNull()
  })

  it('无高亮保留原输入：| 落在锚点区末（沿用 T03 口径）', () => {
    // col=6：锚点字段（HI）末、闭围栏前
    const line = '[[A#HI]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 6), '|', 6, null, null)
    expect(applyPlan(line, plan!)).toBe('[[A#HI|¦]]')
  })

  it('已有 |：接受标题后复用分隔符，已有别名保留、光标跳 | 后', () => {
    const line = '[[方案.md#H|手写]]'
    const plan = planWikilinkFieldEdit(fieldOf(line, 8), '|', 8, null, YUSUAN)
    expect(applyPlan(line, plan!)).toBe('[[方案.md#预算|¦手写]]')
  })
})
