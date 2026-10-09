// #433 附加组件行类型/行内标记查询——两端共享的形状与组合判定单一
// 事实源（B+ 形态，#408 落定）。
//
// 边界（票面 #433 + #408 评估定案）：
// - **experimental 入口**：挂在页面 SDK 的 experimental.syntax，使用前须
//   在清单 experimental 声明 syntax 兼容范围；实验入口可能随版本调整，
//   不随稳定 API 弃用期限承诺（对齐 cm6/headingFold/viewIdentity 治理
//   形态）。
// - **不暴露树/节点句柄**：查询面只出平台自有枚举（kind），不把 Lezer
//   树形或节点名字符串变成事实契约；nodeNames 是诊断载荷，显式声明
//   **非稳定**——不构成兼容承诺（experimental 语义下的 escape hatch，
//   稳定化时再决策）。不挂 language facet（#406 结论不翻案）。
// - **Live-only**：reading 态主正文与 hover 只读视图拒绝 read-only（照
//   addonFoldApi 三值先例）；设置页不提供该入口。
// - **位置驱动单点查询**：不给全树 iterate 形态（#426-2 的 folds() 全
//   文档直查教训——上游 getCodeBlocksInfos 形态后置评估）。
//
// 组合判定（#408 探针修正版产品化，19 情形矩阵迁移至
// test/unit/addonSyntaxApi.test.ts）：live 树对五类行类型需求只正确覆盖
// 三类（代码块/表格/行内代码树可答；frontmatter 树上反语义
// HorizontalRule/SetextHeading2、公式树上零语义皆 Paragraph），三条平台
// 常驻管线组合即全量覆盖——liveDecorationsField 的 tree/fm（增量树与
// frontmatter 区间缓存）+ mathBlocksField（跨行 `$$` 块表）。判定器为
// 纯函数：输入三条管线快照 + 位置，webview 装配层（liveInstance）只做
// 取数与拒绝分层，不复制判定逻辑。
import type { Text } from '@codemirror/state'
import type { Tree } from '@lezer/common'
import { chainAt, type SourceRange } from './markdownDoc'
import { MATH_CODE_CONTEXTS, scanMathRanges, type MathOccurrence } from './math'

/** 行类型枚举（块级维度；callout 一期不入枚举——live 侧无识别管线，
 * 引用块形态统一 quote，落档见 developer-guide「与 Obsidian 上游语义
 * 对照」节） */
export type AddonSyntaxLineKind =
  | 'frontmatter'
  | 'code'
  | 'formula'
  | 'table'
  | 'heading'
  | 'quote'
  | 'list'
  | 'text'

/** 行内标记枚举（位置级行内维度；none = 普通文本位置） */
export type AddonSyntaxInlineKind = 'code' | 'formula' | 'none'

/** 拒绝类型（照 addonFoldApi 三值先例；接口冻结面）：view-disposed =
 * 句柄已释放/实例已销毁/组件代次已终结；read-only = Live-only 边界
 * （reading 态或 hover 只读视图）；invalid-request = 请求形状非法 */
export type AddonSyntaxRejection = 'view-disposed' | 'read-only' | 'invalid-request'

/** 查询成功分支：kind + nodeNames 诊断载荷（光标处祖先链节点名快照，
 * 根→叶）。**非稳定**：节点名随解析器升级变化，不构成兼容承诺 */
export interface AddonSyntaxLineJudge {
  kind: AddonSyntaxLineKind
  nodeNames: readonly string[]
}

export interface AddonSyntaxInlineJudge {
  kind: AddonSyntaxInlineKind
  nodeNames: readonly string[]
}

export type AddonSyntaxLineTypeResult =
  | ({ ok: true } & AddonSyntaxLineJudge)
  | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }

export type AddonSyntaxInlineResult =
  | ({ ok: true } & AddonSyntaxInlineJudge)
  | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }

/** 查询面（experimental.syntax 的内容；仅编辑器页提供）。方法按 views
 * 面的实例 ID 寻址（对齐 headingFold/viewIdentity 先例），pos 为全文
 * UTF-16 code unit 偏移（页面全程 LF） */
export interface AddonSyntaxFacet {
  /** 光标处行类型（块级维度；见 AddonSyntaxLineKind） */
  lineTypeAt(instanceId: string, pos: number): AddonSyntaxLineTypeResult
  /** 位置级行内标记：code（行内代码）/ formula（行内或块内公式）/
   * none（普通文本） */
  inlineAt(instanceId: string, pos: number): AddonSyntaxInlineResult
}

/** pos 守卫（SDK 运行时边界：JS 组件可传任意值）：非负整数。pos 超出
 * 文档长度时钳制到文末（行尾是合法光标位），不因此拒绝 */
export function isAddonSyntaxPos(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** 判定输入：三条常驻管线的快照（webview 装配层从 liveDecorationsField
 * 与 mathBlocksField 取数；测试直驱构造）。pos 约定 0 ≤ pos ≤ doc.length。
 * tree 为 undefined 仅是装配层防御位（核心装饰管线不在场的视图）——树
 * 枚举退化为不命中，fm/数学/单行扫描判定照走（对齐 foldableSpansCached
 * 对 tree 可选的处理形态） */
export interface AddonSyntaxSource {
  doc: Text
  tree: Tree | undefined
  fm: SourceRange | null
  /** 跨行 `$$` 块表（mathBlocksField 值；单行闭合块不在其中——由
   * 判定器的单行扫描补判） */
  mathBlocks: readonly MathOccurrence[]
}

/** pos 所在行整行落在 frontmatter 区间内（行级口径：行尾光标仍在 fm
 * 内；树上反语义先行拦截，链快照照常返回供诊断） */
function inFrontmatter(source: AddonSyntaxSource, pos: number): boolean {
  if (!source.fm) {
    return false
  }
  const line = source.doc.lineAt(pos)
  return line.from >= source.fm.start && line.to <= source.fm.end
}

/** pos 处的祖先链节点名快照（根→叶；树不在场时空数组） */
function nodeNamesAt(source: AddonSyntaxSource, pos: number): string[] {
  return source.tree ? chainAt(source.tree, pos).map((node) => node.name) : []
}

/**
 * 光标处行类型（块级维度）。判定链（探针 #408 修正版同序，矩阵测试
 * 钉住）：
 * 1. frontmatter 区间（行级）→ frontmatter（树上反语义，必须最先拦截）
 * 2. 跨行 `$$` 块表命中 → formula（树上零语义，必须先于树枚举）
 * 3. 树链枚举按优先级：code（FencedCode）> table > heading（ATX/Setext）
 *    > list（Bullet/Ordered）> quote（嵌套组合取先命中者）
 * 4. 单行闭合块 `$$x$$`（独占一行、内容非空）→ formula（树上零语义、
 *    块表不含；段内 `text $$x$$` 形态不算——那是行内维度，见
 *    addonSyntaxInlineAt；树链已有强语义的行不抢判，如围栏内 `$$x$$`
 *    是字面代码）
 * 5. 兜底 text
 */
export function addonSyntaxLineTypeAt(source: AddonSyntaxSource, pos: number): AddonSyntaxLineJudge {
  const nodeNames = nodeNamesAt(source, pos)
  if (inFrontmatter(source, pos)) {
    return { kind: 'frontmatter', nodeNames }
  }
  for (const hit of source.mathBlocks) {
    if (pos >= hit.from && pos < hit.to) {
      return { kind: 'formula', nodeNames }
    }
  }
  const chain = nodeNames.join(' ')
  if (chain.includes('FencedCode')) {
    return { kind: 'code', nodeNames }
  }
  if (chain.includes('Table')) {
    return { kind: 'table', nodeNames }
  }
  if (chain.includes('ATXHeading') || chain.includes('SetextHeading')) {
    return { kind: 'heading', nodeNames }
  }
  if (chain.includes('BulletList') || chain.includes('OrderedList')) {
    return { kind: 'list', nodeNames }
  }
  if (chain.includes('Blockquote')) {
    return { kind: 'quote', nodeNames }
  }
  const line = source.doc.lineAt(pos)
  const trimmedFrom = line.from + (line.text.length - line.text.trimStart().length)
  if (
    scanMathRanges([line.text], line.from).some(
      (hit) => hit.kind === 'block' && hit.from === trimmedFrom && hit.to === line.to,
    )
  ) {
    return { kind: 'formula', nodeNames }
  }
  return { kind: 'text', nodeNames }
}

/**
 * 位置级行内标记。判定链：
 * 1. frontmatter 区间（行级）→ none（fm 是源码态，无行内标记语义）
 * 2. 树链含 InlineCode → code（树语义精确到 span 粒度）
 * 3. 其余代码上下文（围栏/缩进代码）→ none（`$` 是字面文本——与 live
 *    数学管线的抑制口径同源，见 MATH_CODE_CONTEXTS）
 * 4. 跨行 `$$` 块表命中 → formula
 * 5. 当前行的行内/段内/单行闭合扫描命中（$…$、$$…$$）→ formula
 * 6. 兜底 none
 */
export function addonSyntaxInlineAt(source: AddonSyntaxSource, pos: number): AddonSyntaxInlineJudge {
  const nodeNames = nodeNamesAt(source, pos)
  if (inFrontmatter(source, pos)) {
    return { kind: 'none', nodeNames }
  }
  if (nodeNames.includes('InlineCode')) {
    return { kind: 'code', nodeNames }
  }
  if (nodeNames.some((name) => MATH_CODE_CONTEXTS.has(name))) {
    return { kind: 'none', nodeNames }
  }
  for (const hit of source.mathBlocks) {
    if (pos >= hit.from && pos < hit.to) {
      return { kind: 'formula', nodeNames }
    }
  }
  const line = source.doc.lineAt(pos)
  for (const hit of scanMathRanges([line.text], line.from)) {
    if (pos >= hit.from && pos < hit.to) {
      return { kind: 'formula', nodeNames }
    }
  }
  return { kind: 'none', nodeNames }
}
