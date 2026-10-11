// 统一右键菜单内核（#183，规格 docs/specs/context-menu.md）：菜单项描述符、
// 内置表（as const 编译期）、运行期覆写层（模块私有 Map + 访问器，照
// graphicRenderers 惯例）、渲染模型构建（分组/排序/when 过滤/enable 传播/
// 空组收起）、安全降级区域判定、键位提示派生与定位纯函数（视口 clamp 与
// 子菜单左右翻转）。零 vscode/DOM 依赖，node 单测直驱。
//
// 接入清单（新增菜单项的三步，规格「扩展约定（落档）」）：
// 1. CONTEXT_MENU_ITEMS 登记描述符——`when` / `enable` 必须显式声明，安全
//    降级矩阵不得因新项破例（结构敏感区 zone!=='normal' 时写操作置灰）；
// 2. 图标位：iconKey 必须已在 CONTEXT_MENU_ICON_KEYS 登记（资产接入归图标
//    票——渲染层按 CSS 有无规则自然降级留空，资产后补即生效）；
// 3. 语言包双写（en/zh-cn）+ 契约测试钉住（本文件 describe「描述符表契约」）。
//
// 既有边界（不得顺手放宽）：阅读模式与 frontmatter 头区不接管（zone 判定
// 返回 null）；内置项不可删只可隐藏；提示列数据只派生自键位注册表（剪贴板
// 四项固定提示除外）；内置菜单最深两级（children 数据结构支持任意嵌套，
// 运行期注册不受限）。
import type { MessageKey } from './locales/en'
import { atxHeadingOf, blockRangeOfLine, scanFenceBlocks } from './blockId'
import { parseLinePrefix } from './listPrefix'
import { isRenderedFenceInfo } from './mermaid'
import { formatBindingLabel, getEffectiveBindings, type KeybindingOverrides } from './keybindings'

/** 右键命中区域（安全降级矩阵的行维度；null = 不接管） */
export type ContextMenuZone = 'normal' | 'table' | 'fence' | 'graphic'

/** 块链接目标（迁自 blockMenu 的 BlockMenuTarget，语义不变） */
export interface ContextMenuBlockTarget {
  /** 行索引闭区间（LF 系，与 CM6 doc 同坐标） */
  block: { start: number; end: number }
  /** 命中行为 ATX 标题行时的标题（行面字面文本，含行内标记） */
  heading: { level: number; text: string } | null
}

/** 命中行的段落结构（段落设置勾选判定的输入；#184）——行文本形态学
 *  （atxHeadingOf + parseLinePrefix）单一事实源在本模块 */
export interface MenuLineStructure {
  /** ATX 标题级别；非标题行 null */
  headingLevel: number | null
  /** 列表族（任务标记优先归 task，与无序互斥）；非列表行 null */
  listKind: 'bullet' | 'ordered' | 'task' | null
  /** 行首引用层在场（含纯引用空行与引用内列表） */
  quoted: boolean
  /** 行去空白后非空（空行不点亮任何段落勾选） */
  hasText: boolean
}

/** 中性态（结构敏感区与不可解析行：不点亮任何勾选——采集侧约定） */
export const PLAIN_MENU_LINE: MenuLineStructure = {
  headingLevel: null,
  listKind: null,
  quoted: false,
  hasText: false,
}

/**
 * 行文本 → 段落结构形态学（#184 段落设置勾选的判定源）：ATX 标题优先
 * （`# - 伪列表` 的 `- 伪列表` 是标题文本），再解析引用层 + 列表标记
 * （伪标记 `-item` 不算列表——与 listPrefix #119 口径一致）。呈现层
 * （liveDecorations）走语法树；菜单快照走行文本形态学——两者判定源
 * 不同层，本函数只服务勾选语义。
 */
export function menuLineStructureOf(line: string): MenuLineStructure {
  const hasText = line.trim() !== ''
  const heading = atxHeadingOf(line)
  if (heading !== null) {
    return { headingLevel: heading.level, listKind: null, quoted: false, hasText }
  }
  const prefix = parseLinePrefix(line)
  const quoted = prefix !== null && prefix.quote !== ''
  const list = prefix?.list ?? null
  const listKind =
    list === null ? null : list.task !== null ? 'task' : list.bullet !== '' ? 'bullet' : 'ordered'
  return { headingLevel: null, listKind, quoted, hasText }
}

/** 命中格的表格结构坐标（#436 场景基建：行/列系 = 内容行系，表头为
 *  第 0 行、数据行 1..；分隔行不占行索引）。层级判定与 shared/tableCells
 *  的 quoteDepthOfLine 同源；分隔行（含 lazy 无前缀形态）不参与一致性
 *  判定——与 blockquote-table 规格的残缺口径一致 */
export interface TableMenuHit {
  /** 命中格所在内容行索引（表头 = 0）；命中分隔行无内容行身份 = null */
  rowIndex: number | null
  /** 命中行是否表头行（= rowIndex 0；命中分隔行 false）——表头/表体的
   *  显式判定面（删表头行升格等语义差异由执行侧按此分流） */
  inHeader: boolean
  /** 命中列索引（0 基，行内越出格区时钳到最近列）；命中分隔行或格数与
   *  声明列数不齐的内容行（ragged 行，如两列表中的 `| 1 |`）= null */
  columnIndex: number | null
  /** 内容行总数（表头 + 数据行；分隔行不计） */
  rowCount: number
  /** 列总数（分隔行声明列数） */
  columnCount: number
  /** 表格全部物理行区间（LF 行系闭区间：表头行 .. 末数据行，含分隔行） */
  lines: { start: number; end: number }
  /** 命中处文档偏移（执行期结构定位入口输入——runTableEditAt 族以 pos
   *  自行解析结构，与悬浮控件不先移光标同口径） */
  pos: number
  /** 表内内容行（表头 + 数据行）引用层级是否全部一致 */
  quoteUniform: boolean
  /** 一致时的引用层级（顶层表 = 0）；不一致 = null（层级操作置灰输入） */
  quoteDepth: number | null
  /** 命中行引用层级（分隔行同样计算） */
  hitQuoteDepth: number
}

/** 链接命中族类（与 Ctrl+单击 activate 判定族同源：双链 → 树驱动链接
 *  （普通/autolink）→ 宽松链接；嵌入 `![[…]]` 明确排除） */
export type MenuLinkKind = 'wikilink' | 'link' | 'autolink' | 'loose'

/** 命中链接的结构化负载（#436：target 与 activate 上报同口径——双链取
 *  `|` 之前原文未 trim、外部链接 href 原样；display 与渲染口径一致——
 *  双链别名优先） */
export interface LinkMenuHit {
  kind: MenuLinkKind
  /** 目标原文（复制链接地址与 activate 载荷共用，不解码不 trim） */
  target: string
  /** 显示文字（双链 = 别名优先 / 普通链接 = 链接文字 / autolink = URL
   *  本身 / 宽松链接 = 文字段） */
  display: string
  /** 源区间（含完整链接标记语法的半开区间，文档 offset） */
  range: { from: number; to: number }
}

/** 命中图形块（渲染型围栏）的结构化负载（#436；语言键 = info string
 *  trim 后全等，与 isRenderedFenceInfo 判定同键） */
export interface GraphicMenuHit {
  /** 围栏行区间（LF 行系闭区间，含开闭围栏行；未闭合围栏到末行） */
  lines: { start: number; end: number }
  /** 语言标识（info string trim 后，如 'mermaid'） */
  language: string
  /** 围栏源码（开闭围栏行之间的内容，不含围栏行；LF 连接） */
  code: string
  /** 当前生效渲染器（live 模式）有无 svg 取图能力——弹窗/导出类操作的
   *  enable gate 与 effectiveGraphicSvgExport 同口径 */
  svgExport: boolean
  /** #438 右键时该围栏 live 渲染是否成功（渲染容器 state 属性的 DOM 探针：
   *  错误降级态 false；探针不可得——widget 未物化/异步渲染在途——缺省，
   *  enable gate 按成功放行，执行路径重渲染自会兜底）。弹窗/导出三项的
   *  渲染成功 gate（能力 ≠ 渲染成功，#436 落档口径的执行侧补充） */
  rendered?: boolean
}

/** 打开菜单时采集的判定输入快照（when/enable/checked 谓词的唯一数据面）。
 *  三类场景命中负载均为可选字段：只在对应 zone 采集（table 仅 zone='table'、
 *  graphic 仅 zone='graphic'、link 仅 zone='normal'——结构敏感区不采集，
 *  与安全降级矩阵对齐）；表格树解析失败（源码降级表/残缺表）时负载缺省，
 *  不阻塞菜单打开 */
export interface MenuContextSnapshot {
  zone: ContextMenuZone
  hasSelection: boolean
  blockTarget: ContextMenuBlockTarget | null
  /** 命中行段落结构（checked 谓词输入；结构敏感区采集中性态不点亮） */
  line: MenuLineStructure
  /** 表格命中负载（#436；仅 zone='table' 且解析树接管该表时在场） */
  table?: TableMenuHit
  /** 链接命中负载（#436；仅 zone='normal' 且命中链接时在场——代码上下文
   *  与头区内行内扫描抑制同口径，嵌入 `![[…]]` 不采集） */
  link?: LinkMenuHit
  /** 图形块命中负载（#436；仅 zone='graphic'） */
  graphic?: GraphicMenuHit
}

/** 上下文谓词（纯函数；输入只认 MenuContextSnapshot） */
export type MenuPredicate = (ctx: MenuContextSnapshot) => boolean

/** 菜单项描述符（注册单位；children 支持任意嵌套，内置表最深两级） */
export interface MenuItemDescriptor {
  id: string
  /** 簇 id（正文菜单须在 CONTEXT_MENU_GROUP_ORDER 登记；其他场景组按首现顺序排后） */
  group: string
  /** 组内排序键（稳定排序） */
  order: number
  labelKey: MessageKey
  /** #359 T10 显式文字（附加组件菜单项的自由文本——组件文案不进 Vsidian
   *  内置字典；渲染时优先于 labelKey 取词，内置表不用此字段） */
  label?: string
  /** 命令标识（formatOperations id / 内建命令名 / 运行期自定义） */
  command: string
  /** 图标 key（须存在于 CONTEXT_MENU_ICON_KEYS；与 badge 互斥） */
  iconKey?: string
  /** 文字徽标（如 H1–H6；与 iconKey 互斥） */
  badge?: string
  /** 上下文显隐谓词（缺省可见；隐藏只用于显隐规则声明的场合） */
  when?: MenuPredicate
  /** 置灰谓词（缺省可用；置灰项仍显示——保住可发现性） */
  enable?: MenuPredicate
  /** 勾选态谓词（段落设置为首个消费者；文本格式类不接） */
  checked?: MenuPredicate
  children?: readonly MenuItemDescriptor[]
  danger?: boolean
  /** 覆写层专用：隐藏不删（内置项保底可用性的载体） */
  hidden?: boolean
  /** 运行期执行体（覆写语义「可换 handler」的载体）：分派器先查运行期
   *  handler，未命中再走内置白名单。内置 as const 表保持纯数据不写此
   *  字段——内置执行体在控制器分派器（formatOperations 路由 + 显式分支） */
  handler?: () => void
}

/** 簇序（组间分隔线的落点 = 组边界；渲染按此序产出组）。tableOps /
 *  graphicOps 是 #436 为场景簇（#437 表格 / #438 图形块）预登记的组位
 *  ——位于链接簇后、块与格式簇前；场景票在此落项，本表不加项 */
export const CONTEXT_MENU_GROUP_ORDER = ['link', 'tableOps', 'graphicOps', 'blockFormat', 'clipboard'] as const
export type ContextMenuGroupId = (typeof CONTEXT_MENU_GROUP_ORDER)[number]

/** 图标 key 表（规格图标清单全量：复用 16 + 需生成接线 10 + 备用记账 4。
 *  资产生成与 quick-action-icons.py KEYS 的两表同步归图标接线票；渲染层
 *  按 CSS 有无 data-icon 规则降级留空，key 先行登记不阻塞内核。 */
export const CONTEXT_MENU_ICON_KEYS = [
  // 复用现有快速操作图标资产
  'link', 'bold', 'italic', 'strikethrough', 'highlight', 'inlineCode', 'inlineMath',
  'clearInline', 'bulletList', 'orderedList', 'taskList', 'quote', 'table',
  'horizontalRule', 'codeBlock', 'blockMath',
  // 需 AI 新生成（接线）
  'externalLink', 'textFormat', 'paragraphStyle', 'insertPlus', 'normalText',
  'cut', 'copy', 'paste', 'pastePlain', 'selectAll', 'comment',
  // #438 图形专属簇新登记（资产生成与 CSS 接线归图标票 #441——渲染层
  // 无规则时留空降级，资产后补即生效）
  'popupPreview', 'exportSvg', 'exportPng',
  // 备用（项不做，显式记账）
  'media', 'footnote', 'callout',
] as const

/** 结构敏感区谓词（表格单元格/围栏代码/图形块——写操作置灰的矩阵单元） */
const structureSensitive = (ctx: MenuContextSnapshot): boolean => ctx.zone !== 'normal'
/** 簇 1 新增链接与簇 2 全簇的 enable（矩阵：结构敏感区置灰） */
const enabledOutsideStructure = (ctx: MenuContextSnapshot): boolean => !structureSensitive(ctx)
const hasSelection = (ctx: MenuContextSnapshot): boolean => ctx.hasSelection

/** #438 图形专属簇显隐谓词：仅图形块（渲染型围栏 zone）出簇——普通围栏
 *  （zone='fence'）与正文不出；渲染失败/负载缺省置灰不隐藏（保可发现性） */
const graphicZone = (ctx: MenuContextSnapshot): boolean => ctx.zone === 'graphic'
/** #438 弹窗/导出三项 enable gate：负载在场 + svg 取图能力（与 popup 按钮
 *  「不虚设」同口径）+ 渲染成功态（错误降级块无图可弹/可导）。复制源码
 *  不经此 gate（错误块取源码恰是高价值操作） */
const graphicRenderable = (ctx: MenuContextSnapshot): boolean => {
  const graphic = ctx.graphic
  return graphic !== undefined && graphic.svgExport && graphic.rendered !== false
}

/** 文本格式子项（簇 2.1）——id/command/iconKey 与 formatOperations 同名 */
const textFormatChildren: readonly MenuItemDescriptor[] = [
  { id: 'bold', group: 'blockFormat', order: 0, command: 'bold', labelKey: 'format.bold', iconKey: 'bold', enable: enabledOutsideStructure },
  { id: 'italic', group: 'blockFormat', order: 1, command: 'italic', labelKey: 'format.italic', iconKey: 'italic', enable: enabledOutsideStructure },
  { id: 'strikethrough', group: 'blockFormat', order: 2, command: 'strikethrough', labelKey: 'format.strikethrough', iconKey: 'strikethrough', enable: enabledOutsideStructure },
  { id: 'highlight', group: 'blockFormat', order: 3, command: 'highlight', labelKey: 'format.highlight', iconKey: 'highlight', enable: enabledOutsideStructure },
  { id: 'inlineCode', group: 'blockFormat', order: 4, command: 'inlineCode', labelKey: 'format.inlineCode', iconKey: 'inlineCode', enable: enabledOutsideStructure },
  { id: 'inlineMath', group: 'blockFormat', order: 5, command: 'inlineMath', labelKey: 'format.inlineMath', iconKey: 'inlineMath', enable: enabledOutsideStructure },
  { id: 'htmlComment', group: 'blockFormat', order: 6, command: 'htmlComment', labelKey: 'format.htmlComment', iconKey: 'comment', enable: enabledOutsideStructure },
  { id: 'clearInline', group: 'blockFormat', order: 7, command: 'clearInline', labelKey: 'format.clearInline', iconKey: 'clearInline', enable: enabledOutsideStructure },
]

/** 段落设置子项（簇 2.2；H1–H6 用文字徽标不经生图；checked 按当前行结构
 *  点亮——#184：任务标记优先归 task（族互斥），引用与列表可并存双勾，
 *  空行/中性态不点亮任何项） */
const lineOf = (ctx: MenuContextSnapshot) => ctx.line
const isPlainParagraphLine = (ctx: MenuContextSnapshot): boolean => {
  const line = lineOf(ctx)
  return line.hasText && line.headingLevel === null && line.listKind === null && !line.quoted
}
// 段落设置子项分子类组（#183 验收反馈）：正文+标题族｜列表族｜引用 各成
// 一组，DOM 装配在组边界落分隔线（与顶级三簇同机制）；组内序 = Obsidian
// 顺序（正文在最前、标题按级、列表保持既有相对序）
const paragraphChildren: readonly MenuItemDescriptor[] = [
  { id: 'headingNone', group: 'paragraphHeading', order: 0, command: 'headingNone', labelKey: 'format.headingNone', iconKey: 'normalText', enable: enabledOutsideStructure, checked: isPlainParagraphLine },
  { id: 'heading1', group: 'paragraphHeading', order: 1, command: 'heading1', labelKey: 'format.heading1', badge: 'H1', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).headingLevel === 1 },
  { id: 'heading2', group: 'paragraphHeading', order: 2, command: 'heading2', labelKey: 'format.heading2', badge: 'H2', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).headingLevel === 2 },
  { id: 'heading3', group: 'paragraphHeading', order: 3, command: 'heading3', labelKey: 'format.heading3', badge: 'H3', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).headingLevel === 3 },
  { id: 'heading4', group: 'paragraphHeading', order: 4, command: 'heading4', labelKey: 'format.heading4', badge: 'H4', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).headingLevel === 4 },
  { id: 'heading5', group: 'paragraphHeading', order: 5, command: 'heading5', labelKey: 'format.heading5', badge: 'H5', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).headingLevel === 5 },
  { id: 'heading6', group: 'paragraphHeading', order: 6, command: 'heading6', labelKey: 'format.heading6', badge: 'H6', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).headingLevel === 6 },
  { id: 'bulletList', group: 'paragraphList', order: 0, command: 'bulletList', labelKey: 'format.bulletList', iconKey: 'bulletList', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).listKind === 'bullet' },
  { id: 'orderedList', group: 'paragraphList', order: 1, command: 'orderedList', labelKey: 'format.orderedList', iconKey: 'orderedList', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).listKind === 'ordered' },
  { id: 'taskList', group: 'paragraphList', order: 2, command: 'taskList', labelKey: 'format.taskList', iconKey: 'taskList', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).listKind === 'task' },
  { id: 'quote', group: 'paragraphQuote', order: 0, command: 'quote', labelKey: 'format.quote', iconKey: 'quote', enable: enabledOutsideStructure, checked: (ctx) => lineOf(ctx).quoted },
]

/** 插入子项（簇 2.3；表格与快速操作条建表同源入口 command=insertTable） */
const insertChildren: readonly MenuItemDescriptor[] = [
  { id: 'insertTable', group: 'blockFormat', order: 0, command: 'insertTable', labelKey: 'format.insertTable', iconKey: 'table', enable: enabledOutsideStructure },
  { id: 'horizontalRule', group: 'blockFormat', order: 1, command: 'horizontalRule', labelKey: 'format.horizontalRule', iconKey: 'horizontalRule', enable: enabledOutsideStructure },
  { id: 'codeBlock', group: 'blockFormat', order: 2, command: 'codeBlock', labelKey: 'format.codeBlock', iconKey: 'codeBlock', enable: enabledOutsideStructure },
  { id: 'blockMath', group: 'blockFormat', order: 3, command: 'blockMath', labelKey: 'format.blockMath', iconKey: 'blockMath', enable: enabledOutsideStructure },
]

/** 内置项编译期表（照 formatOperations 惯例；运行期覆写层的首个注册者） */
export const CONTEXT_MENU_ITEMS = [
  // ---- 簇 1：链接 ----
  { id: 'insertWikilink', group: 'link', order: 0, command: 'wikilink', labelKey: 'format.wikilink', iconKey: 'link', enable: enabledOutsideStructure },
  { id: 'insertExternalLink', group: 'link', order: 1, command: 'link', labelKey: 'format.link', iconKey: 'externalLink', enable: enabledOutsideStructure },
  { id: 'copyHeadingLink', group: 'link', order: 2, command: 'copyHeadingLink', labelKey: 'contextMenu.copyHeadingLink', iconKey: 'link', when: (ctx: MenuContextSnapshot) => ctx.blockTarget?.heading != null },
  { id: 'copyBlockLink', group: 'link', order: 3, command: 'copyBlockLink', labelKey: 'contextMenu.copyBlockLink', iconKey: 'link', when: (ctx: MenuContextSnapshot) => ctx.blockTarget != null },
  // ---- 场景簇：图形块（#438；全部只读/导出——「编辑源码」不设右键项，
  // 编辑入口仍收敛于 edit 按钮（graphic-code-block-interaction.md 契约 2）。
  // 弹窗/导出 enable = svg 能力 + 渲染成功（错误降级置灰）；复制源码仅按
  // zone 显隐（错误块取源码可用）。图标 popupPreview/exportSvg/exportPng
  // 资产归 #441，渲染层留空降级 ----
  { id: 'graphicPopup', group: 'graphicOps', order: 0, command: 'graphicPopup', labelKey: 'contextMenu.graphicPopup', iconKey: 'popupPreview', when: graphicZone, enable: graphicRenderable },
  { id: 'graphicExportSvg', group: 'graphicOps', order: 1, command: 'graphicExportSvg', labelKey: 'contextMenu.graphicExportSvg', iconKey: 'exportSvg', when: graphicZone, enable: graphicRenderable },
  { id: 'graphicExportPng', group: 'graphicOps', order: 2, command: 'graphicExportPng', labelKey: 'contextMenu.graphicExportPng', iconKey: 'exportPng', when: graphicZone, enable: graphicRenderable },
  { id: 'graphicCopySource', group: 'graphicOps', order: 3, command: 'graphicCopySource', labelKey: 'contextMenu.graphicCopySource', iconKey: 'copy', when: graphicZone },
  // ---- 簇 2：块与格式（全部带子菜单）----
  { id: 'textFormat', group: 'blockFormat', order: 0, command: 'textFormat', labelKey: 'contextMenu.textFormat', iconKey: 'textFormat', enable: enabledOutsideStructure, children: textFormatChildren },
  { id: 'paragraphStyle', group: 'blockFormat', order: 1, command: 'paragraphStyle', labelKey: 'contextMenu.paragraphStyle', iconKey: 'paragraphStyle', enable: enabledOutsideStructure, children: paragraphChildren },
  { id: 'insert', group: 'blockFormat', order: 2, command: 'insert', labelKey: 'contextMenu.insert', iconKey: 'insertPlus', enable: enabledOutsideStructure, children: insertChildren },
  // ---- 簇 3：剪贴板（键位沿用 CM6 默认，提示列固定显示）----
  { id: 'cut', group: 'clipboard', order: 0, command: 'cut', labelKey: 'contextMenu.cut', iconKey: 'cut', enable: hasSelection },
  { id: 'copy', group: 'clipboard', order: 1, command: 'copy', labelKey: 'contextMenu.copy', iconKey: 'copy', enable: hasSelection },
  { id: 'paste', group: 'clipboard', order: 2, command: 'paste', labelKey: 'contextMenu.paste', iconKey: 'paste' },
  { id: 'pastePlain', group: 'clipboard', order: 3, command: 'pastePlain', labelKey: 'contextMenu.pastePlain', iconKey: 'pastePlain' },
  { id: 'selectAll', group: 'clipboard', order: 4, command: 'selectAll', labelKey: 'contextMenu.selectAll', iconKey: 'selectAll' },
] as const satisfies readonly MenuItemDescriptor[]

// ---- 覆写层（模块私有 Map + 访问器；内置 = 第一个注册者，无第二套渲染路径）----

interface RegistryEntry {
  descriptor: MenuItemDescriptor
  /** 来源标签（'builtin' 或运行期注册方标识；后注册者胜时被覆盖） */
  source: string
}

const registry = new Map<string, RegistryEntry>()

/** 运行期条目的还原栈（cleanup 时恢复被覆盖的前一条目） */
const restoreStack = new Map<string, RegistryEntry | null>()

function seedBuiltin(): void {
  if (registry.size > 0) {
    return
  }
  for (const def of flattenDefs(CONTEXT_MENU_ITEMS)) {
    registry.set(def.id, { descriptor: def, source: 'builtin' })
  }
}

function flattenDefs(defs: readonly MenuItemDescriptor[]): MenuItemDescriptor[] {
  const out: MenuItemDescriptor[] = []
  for (const def of defs) {
    out.push(def)
    if (def.children) {
      out.push(...flattenDefs(def.children))
    }
  }
  return out
}

/**
 * 注册树是否包含 id（环检测输入）：子项先按字面判 id，再经注册表解析其
 * children 递归下探（跨条目环在闭合的那次注册暴露）。seen 只防注册表
 * 既有数据自身成环时检测函数栈溢出，不影响命中判定。
 */
function menuTreeContainsId(def: MenuItemDescriptor, id: string, seen: Set<string>): boolean {
  for (const child of def.children ?? []) {
    if (child.id === id) {
      return true
    }
    if (seen.has(child.id)) {
      continue
    }
    seen.add(child.id)
    if (menuTreeContainsId(resolveDef(child), id, seen)) {
      return true
    }
  }
  return false
}

/**
 * 注册菜单项：新增条目或覆盖既有条目（同 id 后注册者胜；覆盖内置项时来源
 * 更新为注册方，cleanup 后还原内置）。返回 cleanup 函数。
 *
 * 环防护：子树（经注册表既有条目解析）引用自身 id 时抛错——渲染链
 * （deepResolve/renderDef/buildMenuDom）对 children 递归无深度上限，
 * 循环嵌套会在右键装配时栈溢出（菜单打不开）。嵌套深度本身不受限。
 */
export function registerContextMenuItem(
  def: MenuItemDescriptor,
  source = 'runtime',
): () => void {
  seedBuiltin()
  if (menuTreeContainsId(def, def.id, new Set())) {
    throw new Error(`[vsidian] 菜单项注册拒绝循环嵌套：${def.id} 的子树引用了自身`)
  }
  const prev = registry.get(def.id) ?? null
  registry.set(def.id, { descriptor: def, source })
  restoreStack.set(def.id, prev)
  return () => {
    // 只还原未被后续写入（register/override）再覆盖的槽位（后注册者胜，
    // 先注册者的 cleanup 不回滚更晚的注册或覆写）
    if (restoreStack.get(def.id) === prev) {
      restoreStack.delete(def.id)
      if (prev === null) {
        registry.delete(def.id)
      } else {
        registry.set(def.id, prev)
      }
    }
  }
}

/**
 * 覆写既有条目的部分字段（浅合并；children 提供时整体替换）。隐藏内置项
 * 用 hideContextMenuItem（隐藏不删）。返回是否命中既有条目。
 */
export function overrideContextMenuItem(
  id: string,
  partial: Partial<MenuItemDescriptor>,
  source = 'runtime',
): boolean {
  seedBuiltin()
  const entry = registry.get(id)
  if (!entry) {
    return false
  }
  // 环防护与 register 同口径（review-loops 二轮 P3-1：children 整体替换
  // 同样能引入环，register 侧检测不可被 override 绕过）；检测在写入之前，
  // 抛错时注册表与还原栈都不留痕
  const merged: MenuItemDescriptor = { ...entry.descriptor, ...partial }
  if (menuTreeContainsId(merged, id, new Set())) {
    throw new Error(`[vsidian] 菜单项覆写拒绝循环嵌套：${id} 的子树引用了自身`)
  }
  // 覆写同样入还原栈：更早注册者的 cleanup 见栈顶已变即跳过回滚——
  // 「后注册者胜」对 register→override→cleanup 交错序列同样成立（覆写
  // 不被先注册者的卸载清掉）
  restoreStack.set(id, entry)
  registry.set(id, { descriptor: merged, source })
  return true
}

/** 隐藏条目（内置项保底可用性：只隐藏不删，registry 条目仍在） */
export function hideContextMenuItem(id: string, source = 'runtime'): boolean {
  return overrideContextMenuItem(id, { hidden: true }, source)
}

/** 覆写来源观测（排查「谁改了菜单项」） */
export function contextMenuItemSources(): Readonly<Record<string, string>> {
  seedBuiltin()
  const out: Record<string, string> = {}
  for (const [id, entry] of registry) {
    out[id] = entry.source
  }
  return out
}

/** 注册表快照（渲染唯一数据源；内置项全量经此路径） */
export function contextMenuRegistrySnapshot(): readonly MenuItemDescriptor[] {
  seedBuiltin()
  return [...registry.values()].map((entry) => entry.descriptor)
}

/** 按命令标识查运行期 handler（查找键是 command 字段而非条目 id）：命中
 *  返回执行体，无 handler 或无条目返回 undefined——分派器先查此表，未命中
 *  再走内置白名单（覆写内置 id 的 handler 即替换内置执行体） */
export function contextMenuHandlerForCommand(command: string): (() => void) | undefined {
  seedBuiltin()
  for (const entry of registry.values()) {
    if (entry.descriptor.command === command && entry.descriptor.handler !== undefined) {
      return entry.descriptor.handler
    }
  }
  return undefined
}

/** 测试钩子：还原注册表到内置态 */
export function __resetContextMenuRegistryForTest(): void {
  registry.clear()
  restoreStack.clear()
  seedBuiltin()
}

// ---- 渲染模型 ----

/** 渲染后的菜单项（DOM 装配的直接输入；谓词已求值） */
export interface RenderedMenuItem {
  id: string
  labelKey: MessageKey
  /** #359 T10 显式文字（优先于 labelKey；附加组件项用） */
  label?: string
  command: string
  /** 所属组（DOM 层在子菜单内按组边界落分隔线的判定键；顶级分组由 buildMenuModel 聚合） */
  group: string
  iconKey?: string
  badge?: string
  danger: boolean
  enabled: boolean
  checked: boolean
  hint?: string
  /** 组内排序键（DOM 不消费；buildMenuModel / 子菜单排序用） */
  order: number
  children?: readonly RenderedMenuItem[]
}

export interface RenderedMenuGroup {
  id: string
  items: readonly RenderedMenuItem[]
}

function renderDef(
  def: MenuItemDescriptor,
  ctx: MenuContextSnapshot,
  hints: Readonly<Record<string, string>> | undefined,
  parentDisabled: boolean,
): RenderedMenuItem | null {
  if (def.hidden === true) {
    return null
  }
  if (def.when && !def.when(ctx)) {
    return null
  }
  // enable 求值一次；父项置灰向子树传播（簇 2 整簇置灰的矩阵语义）
  const selfEnabled = !parentDisabled && (def.enable ? def.enable(ctx) : true)
  const children: RenderedMenuItem[] = []
  for (const child of sortMenuDefsByGroup(def.children ?? [])) {
    const rendered = renderDef(child, ctx, hints, !selfEnabled)
    if (rendered) {
      children.push(rendered)
    }
  }
  if (def.children && def.children.length > 0 && children.length === 0) {
    return null // 子项全数不可见：父项随之隐藏（空子菜单不可留）
  }
  const item: RenderedMenuItem = {
    id: def.id,
    labelKey: def.labelKey,
    ...(def.label !== undefined ? { label: def.label } : {}),
    command: def.command,
    group: def.group,
    danger: def.danger === true,
    enabled: selfEnabled,
    checked: def.checked ? def.checked(ctx) : false,
    order: def.order,
  }
  if (def.iconKey !== undefined) {
    item.iconKey = def.iconKey
  }
  if (def.badge !== undefined) {
    item.badge = def.badge
  }
  const hint = hints?.[def.id]
  if (hint !== undefined) {
    item.hint = hint
  }
  if (children.length > 0) {
    item.children = children
  }
  return item
}

/**
 * 子菜单项分组排序（与顶级 buildMenuModel 同口径）：CONTEXT_MENU_GROUP_ORDER
 * 登记组按登记序，未登记子组按首现顺序排后；组内 order 稳定排序。DOM 装配
 * 在组边界落分隔线，子菜单由此获得与顶级一致的分组呈现；整组不可见时相邻
 * 组交界自然收敛为单线（renderDef 已过滤隐藏项，无需独立收起逻辑）。
 */
function sortMenuDefsByGroup(defs: readonly MenuItemDescriptor[]): MenuItemDescriptor[] {
  const seen: string[] = []
  for (const def of defs) {
    if (
      !(CONTEXT_MENU_GROUP_ORDER as readonly string[]).includes(def.group) &&
      !seen.includes(def.group)
    ) {
      seen.push(def.group)
    }
  }
  const keyOf = (group: string): number => {
    const registered = (CONTEXT_MENU_GROUP_ORDER as readonly string[]).indexOf(group)
    return registered !== -1 ? registered : CONTEXT_MENU_GROUP_ORDER.length + seen.indexOf(group)
  }
  return [...defs].sort((a, b) => keyOf(a.group) - keyOf(b.group) || a.order - b.order)
}

/**
 * 通用模型构建：描述符集 → 分组渲染模型。组序 = CONTEXT_MENU_GROUP_ORDER
 * 优先 + 未登记组按首现顺序排后；组内按 order 稳定排序；可见项为零的组整组
 * 收起（连同分隔线的落点）；组内置灰项不触发收起。大纲菜单等非注册表场景
 * 与正文菜单共用此渲染管线。
 */
export function buildMenuModel(
  defs: readonly MenuItemDescriptor[],
  ctx: MenuContextSnapshot,
  hints?: Readonly<Record<string, string>>,
): readonly RenderedMenuGroup[] {
  const byGroup = new Map<string, RenderedMenuItem[]>()
  const groupOrder: string[] = []
  for (const def of defs) {
    const item = renderDef(def, ctx, hints, false)
    if (!item) {
      continue
    }
    let items = byGroup.get(def.group)
    if (!items) {
      items = []
      byGroup.set(def.group, items)
      groupOrder.push(def.group)
    }
    items.push(item)
  }
  const registeredIndex = (group: string): number => {
    const index = (CONTEXT_MENU_GROUP_ORDER as readonly string[]).indexOf(group)
    return index === -1 ? CONTEXT_MENU_GROUP_ORDER.length + groupOrder.indexOf(group) : index
  }
  const sorted = groupOrder
    .filter((group) => (byGroup.get(group) ?? []).length > 0)
    .sort((a, b) => registeredIndex(a) - registeredIndex(b))
  return sorted.map((group) => {
    const items = byGroup.get(group)!
    items.sort((a, b) => a.order - b.order)
    return { id: group, items }
  })
}

/** 注册表内按 id 取覆写后的描述符（无条目时原样返回） */
function resolveDef(def: MenuItemDescriptor): MenuItemDescriptor {
  const entry = registry.get(def.id)
  if (!entry) {
    return def
  }
  return entry.descriptor
}

/** 递归应用覆写：内置树为骨架，每个节点（含子项）被 registry 中的版本替换 */
function deepResolve(def: MenuItemDescriptor): MenuItemDescriptor {
  const resolved = resolveDef(def)
  if (!resolved.children) {
    return resolved
  }
  return { ...resolved, children: resolved.children.map(deepResolve) }
}

/**
 * 正文统一菜单模型（注册表驱动——内置全量经运行期层渲染，无第二套代码
 * 路径）：顶级结构 = 内置树（逐节点应用覆写）+ 运行期新增顶级项（内置树
 * 中不存在的 id）按注册顺序追加。对子项的覆写经 deepResolve 拾取，子项
 * 不会因扁平注册表而被提升为顶级项。
 */
export function buildContextMenuModel(
  ctx: MenuContextSnapshot,
  hints?: Readonly<Record<string, string>>,
): readonly RenderedMenuGroup[] {
  seedBuiltin()
  const builtinIds = new Set(flattenDefs(CONTEXT_MENU_ITEMS).map((def) => def.id))
  const topDefs = CONTEXT_MENU_ITEMS.map(deepResolve)
  for (const entry of registry.values()) {
    if (!builtinIds.has(entry.descriptor.id)) {
      topDefs.push(entry.descriptor)
    }
  }
  return buildMenuModel(topDefs, ctx, hints)
}

// ---- 键位提示派生（提示列唯一数据通道：键位注册表 + 剪贴板固定提示）----

/** 剪切/复制/全选沿用 CM6 固定提示；粘贴两操作取有效注册值（#305）。 */
const CLIPBOARD_FIXED_HINTS: Readonly<Record<string, string>> = {
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  selectAll: 'Ctrl+A',
}

/** 菜单项 id → 当前生效键位的显示形态；未绑定不出现（不占位） */
export function contextMenuKeybindingHints(
  overrides: KeybindingOverrides,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = { ...CLIPBOARD_FIXED_HINTS }
  // 遍历注册表快照而非内置表——运行期新增条目同样按其 command 派生提示
  // （提示列数据只派生自键位注册表的原则对注册项一致）；剪贴板四项固定
  // 提示以 id 判重优先，不被覆写 command 顶掉
  for (const def of flattenDefs(contextMenuRegistrySnapshot())) {
    if (out[def.id] !== undefined) {
      continue
    }
    const bindings = getEffectiveBindings(overrides, def.command)
    if (bindings.length > 0) {
      out[def.id] = formatBindingLabel(bindings[0]!)
    }
  }
  return out
}

// ---- 命中判定与区域判定（安全降级矩阵的输入侧）----

/**
 * 块目标命中（迁自 blockMenu.blockMenuTargetAt，断言语义不变）：行 → 行
 * 所属块（围栏块整块、空行分界）+ 命中行自身是否 ATX 标题行。头区与空行
 * 返回 null（块链接两项据此隐藏；空行仍接管菜单——全域接管）。
 */
export function contextMenuBlockTargetAt(
  lines: readonly string[],
  lineIndex: number,
  fmEndLine: number,
): ContextMenuBlockTarget | null {
  if (lineIndex <= fmEndLine) {
    return null // 头区不接管：成型卡片只读；降级源码行写 ^id 只会破坏 YAML
  }
  const block = blockRangeOfLine(lines, lineIndex)
  if (block === null) {
    return null // 空行/越界不属于任何块
  }
  const inFence = scanFenceBlocks(lines).some(
    (fence) => lineIndex >= fence.start && lineIndex <= fence.end,
  )
  const heading = inFence ? null : atxHeadingOf(lines[lineIndex]!)
  return { block, heading }
}

/** 表格分隔行形态（与 shared/tableCells.parseTableDelimiter 的格子口径
 *  对齐的行级近似——最小连字符数同为 `-+`（GFM 单连字符 `|-|-|` 即合法），
 *  `|---|---|` / `:---: |` / 无边界管道形态；转义管道等完整切分语义仍以
 *  tableCells 为准，此处只服务区域判定） */
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/** 行首容器前缀剥离（#296 三轮右键识别）：引用 `>` / 列表标记 / 缩进
 *  不参与分隔行形态判定——块内表格（引用/列表及其组合容器内）与顶层
 *  表进同一降级矩阵。形态学与 webview/tableCells.containerPrefixLen
 *  同源（shared/listPrefix 的 parseLinePrefix） */
function stripContainerPrefix(line: string): string {
  const prefix = parseLinePrefix(line)
  return prefix ? line.slice(prefix.quote.length + prefix.indent.length + prefix.mark.length) : line
}

function tableRowLike(line: string): boolean {
  return line.includes('|') && line.trim() !== ''
}

/** 命中行是否落在表格块内（连续 pipe 行组内存在分隔行）；分隔行判定
 *  先剥容器前缀（块内表格的 `> |---|` 同为分隔形态） */
function tableZoneAt(lines: readonly string[], lineIndex: number): boolean {
  if (!tableRowLike(lines[lineIndex]!)) {
    return false
  }
  let start = lineIndex
  while (start > 0 && tableRowLike(lines[start - 1]!)) {
    start -= 1
  }
  let end = lineIndex
  while (end + 1 < lines.length && tableRowLike(lines[end + 1]!)) {
    end += 1
  }
  for (let k = start; k <= end; k++) {
    if (TABLE_DELIMITER_RE.test(stripContainerPrefix(lines[k]!))) {
      return true
    }
  }
  return false
}

/** 开围栏行的 info string（matchFenceOpen 同式；shared/blockId 不透出 info）。
 *  #436 起导出：右键快照的图形块负载以同口径取语言键（trim 后全等） */
export function fenceInfoOf(openLine: string): string {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(openLine)
  return m ? (m[2] ?? '') : ''
}

/**
 * 区域判定（全域接管的降级输入）：头区与越界返回 null（不接管，原生菜单
 * 照常——frontmatter 头区边界沿 blockMenu 既有语义）；围栏区含开闭围栏行
 * （渲染型围栏 = graphic，其余 = fence）；表格按行级形态学；普通行与空行
 * 均 normal（空行接管是全域接管的验收线之一）。
 */
export function contextMenuZoneAt(
  lines: readonly string[],
  lineIndex: number,
  fmEndLine: number,
): ContextMenuZone | null {
  if (lineIndex < 0 || lineIndex >= lines.length || lineIndex <= fmEndLine) {
    return null
  }
  for (const fence of scanFenceBlocks(lines)) {
    if (lineIndex >= fence.start && lineIndex <= fence.end) {
      return isRenderedFenceInfo(fenceInfoOf(lines[fence.start]!)) ? 'graphic' : 'fence'
    }
  }
  if (tableZoneAt(lines, lineIndex)) {
    return 'table'
  }
  return 'normal'
}

/** 右键保选区判定（#186 关键 bug 1）：Chrome contenteditable 上右键
 *  mousedown 的默认行为会把选区折叠到点击处（点在选区外时），编辑器
 *  选好的单元格/文本选区被右键清掉；右键落在既有选区内（含端点）时
 *  应保持选区——VSCode 原生编辑器同款语义。结构化 ranges 不依赖
 *  CM6 类型（shared 端可测；调用方传 selection.ranges） */
export function contextMenuClickWithinSelection(
  ranges: ReadonlyArray<{ from: number; to: number }>,
  pos: number,
): boolean {
  return ranges.some((r) => pos >= r.from && pos <= r.to)
}

// ---- 定位纯函数（块菜单与大纲菜单共用；子菜单翻转是大纲右置修复载体）----

/**
 * 视口系 fixed 定位（迁自 blockMenu.blockMenuPosition，语义不变）：点击点
 * 起、右/下缘 clamp、底部放不下翻上方、再放不下 clamp 视口顶。
 */
export function menuViewportPosition(
  click: { x: number; y: number },
  menu: { w: number; h: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(0, Math.min(click.x, viewport.width - menu.w))
  let top = click.y
  if (top + menu.h > viewport.height) {
    top = Math.max(0, click.y - menu.h)
  }
  return { left, top }
}

/**
 * 子菜单展开侧判定：右缘放不下翻左侧（大纲面板右置时子菜单溢出屏幕的修复
 * 载体）；两侧都放不下时取剩余空间更大侧（等空间优先右）。
 * @param anchor 父项宿主的视口坐标区间
 */
export function submenuSide(
  anchor: { left: number; right: number },
  submenuWidth: number,
  viewportWidth: number,
): 'right' | 'left' {
  if (anchor.right + submenuWidth <= viewportWidth) {
    return 'right'
  }
  if (anchor.left - submenuWidth >= 0) {
    return 'left'
  }
  return viewportWidth - anchor.right >= anchor.left ? 'right' : 'left'
}
