// 语法树驱动的 Live Preview 装饰（工单 #8，取代 #5 的行级正则判定）。
//
// 架构（依据 ADR-0005、mvp.md「MVP 性能契约」，#5 的直接/间接分类沿用）：
// - 语义来源：@codemirror/lang-markdown 的 markdownLanguage 解析器（GFM）。
//   解析树在 StateField 内自持，经 @lezer TreeFragment 做增量解析——
//   正常键入只重解析变更附近（实测 10 万行文档中部键入 ≈1ms），整篇
//   解析仅发生在 create 与全文替换（必要初始化/重同步）
// - 直接装饰（影响块高度）→ StateField 常驻 RangeSet 整篇维护：
//   · 行级类：标题（#5 类名不变）、围栏/缩进代码、引用、列表（含嵌套
//     深度与有序/子弹区分）、水平线、frontmatter
//   · 标记隐藏（replace）：标题标记在标题范围内显形；列表与引用前缀仅在
//     标记及相邻空格附近显形；任务 [x] 在标记范围外显示 checkbox widget；
//     水平线整段源文隐藏并呈现真横线（#106，该行触及时显形源码）
//   · 内容 span：vsidian-header-{n} / vsidian-strong / vsidian-emphasis / vsidian-inline-code
// - 间接装饰（纯视口内）→ ViewPlugin 按直接装饰集合与 visibleRanges 计算
//   光标所在标题行的活动提示（不触碰 view/DOM 测量，防布局循环）；
//   #55 移除了视口内标题行左缘竖线，inview 类保留作 active 背景作用域
// - 增量策略：键入路径的重建区间 = 变更行 ∪ 旧树相交装饰节点（映射后）
//   ∪ 选区旧行/新行；结构编辑（围栏开闭、列表吸收等）经「容器分类差异
//   探测」扩展重建范围至受影响容器边界——正确性优先，触发频率低
// - frontmatter：与阅读视图共用 markdownDoc.frontmatterRange（有界扫描），
//   头块内不产生 Markdown 装饰（伪标题/伪列表按源码呈现）
// - 未支持语法（脚注、定义列表等）：无装饰即局部源码降级，不整篇改写
// - #42 表格：安全表格始终以原文区间 mark + CSS grid 呈现，活动单元格
//   继续在 CM6 源区间输入。没有独立单元格输入模型，DOM 由视口回收
import {
  Annotation,
  EditorSelection,
  Prec,
  RangeSet,
  StateField,
  Text,
  type ChangeSet,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { TreeFragment, type SyntaxNode, type Tree } from '@lezer/common'
import {
  chainAt,
  docInput,
  FM_SCAN_LIMIT,
  frontmatterRange,
  headingLevelOf,
  markdownTreeParser,
  visitRange,
  type SourceRange,
} from '../shared/markdownDoc'
import { resolveTaskToggleAtMarker } from './taskToggle'
import { t } from '../shared/i18n'
import { applyObsidianDomAlias } from '../shared/obsidianAlias'
import { hitRevealContextOf, hitRevealField, hitRevealTouchesLine, type HitRevealContext } from './hitReveal'
import { collectColumnSamples, tableGridTemplate } from './tableColumnWidth'
import { sameTableRegion, tableRegionField } from './tableRegionField'
import type { TableRegion } from './tableRegion'
import { parseFrontmatterTable, type FmTableModel } from '../shared/frontmatterTable'
import { buildFrontmatterCardPlan, fmFoldField } from './frontmatterDecorations'
import {
  barePipeAt,
  blankContainerPrefix,
  escapedPipeBackslashes,
  parseTableDelimiter,
  splitTableRowCells,
  tableRowCellsForColumns,
  tableCellBreaks,
  type TableAlign,
} from '../shared/tableCells'

/** 标题类名（#5 契约保持不变） */
export const HEADING_CLASS_NAMES = {
  line: 'vsidian-heading-line',
  level: (lv: number) => `vsidian-heading-line-${lv}`,
  inview: 'vsidian-heading-inview',
  active: 'vsidian-heading-active',
} as const

/** #8 新增稳定类名（Obsidian 对应选择器见 docs/design/obsidian-selector-map.md） */
export const LIVE_CLASS_NAMES = {
  /** 标题内容 span（Obsidian `.cm-header-{n}`） */
  headerSpan: (lv: number) => `vsidian-header-${Math.min(6, Math.max(1, lv))}`,
  /** 粗体内容 span（`.cm-strong`） */
  strong: 'vsidian-strong',
  /** 斜体内容 span（`.cm-emphasis`） */
  emphasis: 'vsidian-emphasis',
  /** 行内代码内容 span（`.cm-inline-code`） */
  inlineCode: 'vsidian-inline-code',
  /** 高亮内容 span（#105，`.cm-highlight` 方向；底色变量见 main.css #app） */
  highlight: 'vsidian-highlight',
  /** HTML 注释淡化 span（#139，`.cm-comment` 方向；低对比度常显，
   *  不隐藏不折叠；颜色规则由 htmlCommentCssContract 契约钉住） */
  htmlComment: 'vsidian-html-comment',
  /** 引用行（`.HyperMD-quote` / `.cm-quote`） */
  quoteLine: 'vsidian-quote-line',
  /** 围栏/缩进代码行（`.HyperMD-codeblock`） */
  codeLine: 'vsidian-code-line',
  /** 列表项行（`.HyperMD-list-line`，本项目自有组合形态） */
  listLine: 'vsidian-list-line',
  /** 无序列表行修饰（标记隐藏后以 ::before 呈现圆点） */
  listBullet: 'vsidian-list-bullet',
  /** 无序列表源码标记显形时抑制行首伪圆点，避免重复 */
  listMarkerVisible: 'vsidian-list-marker-visible',
  /** 有序列表行修饰（编号保留可见） */
  listOrdered: 'vsidian-list-ordered',
  /** 任务 checkbox（input，#9 可交互：点击/Enter 切换勾选态） */
  taskCheckbox: 'vsidian-task-checkbox',
  /** 已勾选修饰类（配合 :checked 伪类的稳定类入口） */
  taskChecked: 'vsidian-task-checked',
  /** 水平线行（`.cm-hr`） */
  hrLine: 'vsidian-hr-line',
  /** 水平线渲染 widget 元素（#106：源文隐藏后呈现的真横线 span） */
  hrRule: 'vsidian-hr',
  /** frontmatter 行（`.cm-hmd-frontmatter` 方向） */
  frontmatterLine: 'vsidian-frontmatter-line',
  /** ---- 表格：源文本为唯一编辑面，安全表格保持可编辑网格（#42）---- */
  /** 表格行（表头/分隔/数据行通用；Obsidian 对应 .cm-table 方向） */
  tableLine: 'vsidian-table-line',
  /** 表头行修饰 */
  tableHeaderLine: 'vsidian-table-header-line',
  /** 分隔行修饰 */
  tableDelimiterLine: 'vsidian-table-delimiter-line',
  /** 单元格内容 span（trim 后区间） */
  tableCell: 'vsidian-table-cell',
  /** 表头单元格修饰 */
  tableCellHeader: 'vsidian-table-cell-header',
  /** 管道符 span（含首尾边界管道） */
  tablePipe: 'vsidian-table-pipe',
  /** 安全表格的网格行和单元格；行身份另见 data-vsidian-table-row */
  tableGridRow: 'vsidian-table-grid-row',
  tableGridCell: 'vsidian-table-grid-cell',
  /** 空格占位 widget 专属标记（#101）：普通格是 mark 装饰共享
   *  tableGridCell 类名，空格物化物（widget span）以此类独立可辨——
   *  localeOnDemand 的换包扫描据此只命中空格占位、不误伤普通格 */
  tableGridEmpty: 'vsidian-table-grid-empty',
  tableGridDelimiter: 'vsidian-table-grid-delimiter',
  tableEscapedPipe: 'vsidian-table-escaped-pipe',
  /** 转义管道的反斜杠在光标/选区触及该行时的显形类（Obsidian 对齐：
   *  默认隐藏渲染为 |，触及行浅色显形暴露源码——与标题 mark 显隐同语义） */
  tableEscapedPipeReveal: 'vsidian-table-escaped-pipe-reveal',
  /** Markdown 转义符的反斜杠（表格外，树驱动 Escape 节点）：默认隐藏
   *  （所见 = 字面字符），光标/选区触及该行浅色显形（Obsidian 转义符
   *  行内源码暴露语义，验收反馈通用化）。表格行内 \| 走上方专用类 */
  escape: 'vsidian-escape',
  /** 转义符反斜杠触及行的显形类（与 escape 成对，语义同上） */
  escapeReveal: 'vsidian-escape-reveal',
  /** 矩形格区蒙版（#73）：并入网格格装饰的 class 托管——外部贴类会与
   *  列把手高亮、CM6 mark 重写互抹（2026-09-28 拖选断裂实测） */
  tableRegionCell: 'vsidian-table-region-cell',
  tableRegionTop: 'vsidian-table-region-top',
  tableRegionBottom: 'vsidian-table-region-bottom',
  tableRegionLeft: 'vsidian-table-region-left',
  tableRegionRight: 'vsidian-table-region-right',
  /** 列对齐修饰（分隔行声明的对齐落到各单元格） */
  tableAlign: (a: TableAlign) => `vsidian-table-align-${a}`,
} as const

// ---- 装饰实例缓存：增量与全量构建产出相同实例，使 RangeSet.eq 成立 ----

const hideDeco = Decoration.replace({})

const lineDecoCache = new Map<string, ReturnType<typeof Decoration.line>>()
function lineDeco(cls: string): ReturnType<typeof Decoration.line> {
  // #132 别名桥：行级类经别名表加工（vsidian 名 + 承诺的 Obsidian 原名同挂）
  const aliased = applyObsidianDomAlias(cls)
  let deco = lineDecoCache.get(aliased)
  if (!deco) {
    deco = Decoration.line({ class: aliased })
    lineDecoCache.set(aliased, deco)
  }
  return deco
}

const headerSpanDecos = [1, 2, 3, 4, 5, 6].map((lv) =>
  Decoration.mark({ class: applyObsidianDomAlias(LIVE_CLASS_NAMES.headerSpan(lv)) }),
)
const strongDeco = Decoration.mark({ class: applyObsidianDomAlias(LIVE_CLASS_NAMES.strong) })
/** #139 注释淡化：整节点区间（含定界符）常显，无显形切换（内容可见） */
const htmlCommentDeco = Decoration.mark({ class: LIVE_CLASS_NAMES.htmlComment })
const emphasisDeco = Decoration.mark({ class: applyObsidianDomAlias(LIVE_CLASS_NAMES.emphasis) })
const inlineCodeDeco = Decoration.mark({ class: applyObsidianDomAlias(LIVE_CLASS_NAMES.inlineCode) })
const highlightDeco = Decoration.mark({ class: applyObsidianDomAlias(LIVE_CLASS_NAMES.highlight) })

/**
 * 任务 checkbox widget（#9）：input[type=checkbox] 替换任务标记 [ ]/[x]。
 * 点击/Enter 经 posAtDOM 定位当前文档坐标（装饰随文档同步，位置无过期），
 * 经 taskToggle 校验后派发替换事务——事务走编辑器标准出站链路
 * （syncController updateListener → edit.request），不旁路直改。
 * 空格键依赖浏览器原生激活（checkbox 上按 Space 触发 click），不另行
 * 拦截，避免与原生行为双重切换。
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = this.checked
      ? `${LIVE_CLASS_NAMES.taskCheckbox} ${LIVE_CLASS_NAMES.taskChecked}`
      : LIVE_CLASS_NAMES.taskCheckbox
    box.setAttribute('aria-label', this.checked ? t('decor.taskUncheck') : t('decor.taskCheck'))
    const toggle = (): void => {
      const view = EditorView.findFromDOM(box)
      if (!view) {
        return
      }
      const doc = view.state.doc.toString()
      const pos = view.posAtDOM(box)
      const target = resolveTaskToggleAtMarker(doc, pos, pos + 3, this.checked)
      if (target) {
        view.dispatch({
          changes: { from: target.from, to: target.to, insert: target.nextText },
        })
      }
    }
    box.addEventListener('click', (event) => {
      // 取消原生翻转：勾选态始终由文档驱动重绘（校验失败时不改显示）
      event.preventDefault()
      toggle()
    })
    box.addEventListener('mousedown', (event) => {
      // 必须在源头终结 mousedown（#116 缺陷二）：CM6 在 contentDOM 的
      // mousedown 冒泡钩子里同步启动 MouseSelection，把光标放进被替换的
      // [ ]/[x] 标记区间 → 装饰规则按「光标入标记显源码」移除 widget →
      // input 在 click 派发前被销毁，勾选永不触发。stopPropagation 让
      // CM6 完全看不到该事件（光标与视图不动）；preventDefault 再阻止
      // mousedown 的默认聚焦，焦点与后续键盘输入留在编辑器。click 的
      // 派发不受影响（浏览器在 mouseup 后照常合成），切换仍走 click 监听。
      // 该拦截只作用于 checkbox 自身：键盘导航、点击标记附近正文进入
      // 标记区间的其他路径不受影响，「光标入标记显源码」语义保持。
      event.preventDefault()
      event.stopPropagation()
    })
    box.addEventListener('keydown', (event) => {
      // Enter 在 checkbox 上无原生激活：手动触发切换；阻断冒泡避免编辑器
      // 把 Enter 解释为插入换行
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        toggle()
      }
    })
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}
const taskCheckboxDecos = [
  Decoration.replace({ widget: new TaskCheckboxWidget(false) }),
  Decoration.replace({ widget: new TaskCheckboxWidget(true) }),
]

/**
 * 分割线渲染 widget（#106）：HorizontalRule 行未触及时源文字符被 replace
 * 隐藏，本 widget 呈现真横线（CSS border-top，颜色与阅读 <hr> 同源变量）。
 * 控制域是该行区间：光标/选区触及（含两端边界）时不发射隐藏装饰，源码
 * 显形可编辑（IME 同路径）——语义沿用 #29 决议，移动光标零写回。
 * 无交互事件；点击落点由 CM6 映射到最近源位置，进入该行即显形。
 */
class HorizontalRuleWidget extends WidgetType {
  eq(): boolean { return true }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = LIVE_CLASS_NAMES.hrRule
    return el
  }
}
const hrRuleDeco = Decoration.replace({ widget: new HorizontalRuleWidget() })

// ---- 表格装饰（#12）：单元格边界来自 tableCells 的 GFM 语义拆分 ----
// （lezer 的 TableCell 节点不识别 \| 与行内代码内管道，不作定位依据）

const tablePipeDeco = Decoration.mark({ class: LIVE_CLASS_NAMES.tablePipe })
const tableEscapedPipeDeco = Decoration.mark({ class: LIVE_CLASS_NAMES.tableEscapedPipe })
const tableEscapedPipeRevealDeco = Decoration.mark({ class: LIVE_CLASS_NAMES.tableEscapedPipeReveal })
// 转义符通用显隐（表格外）：默认隐藏 / 触及行浅色显形，色口径同块 id 淡化
const escapeDeco = Decoration.mark({ class: LIVE_CLASS_NAMES.escape })
const escapeRevealDeco = Decoration.mark({ class: LIVE_CLASS_NAMES.escapeReveal })
// 行尾一个 Markdown 填充空格保留文字节点供原生输入/IME 使用，但不参与
// 可见排版。不要替换成零宽 widget：删空格再输入曾使光标显示在后一列。
const tableGridPaddingDeco = Decoration.mark({ class: 'vsidian-table-grid-padding' })
class TableCellBreakWidget extends WidgetType {
  eq(): boolean { return true }
  // 文档仍只有一个源行，CM6 必须得知 widget 在视觉上增加一行，
  // 否则格内上下方向键与光标测量会停留在原行。
  get lineBreaks(): number { return 1 }
  toDOM(): HTMLElement {
    const br = document.createElement('br')
    br.className = 'vsidian-table-cell-break'
    return br
  }
}
const tableCellBreakDeco = Decoration.replace({ widget: new TableCellBreakWidget(), tableCellBreak: true })
/** 仅无边界空白格的 IME 候选事务：源文暂变但沿用原网格装饰。 */
export const tableCompositionPreview = Annotation.define<boolean>()
export const tableCompositionSettled = Annotation.define<boolean>()
const tableGridCellDecos = new Map<string, ReturnType<typeof Decoration.mark>>()
function tableGridCellDeco(align: TableAlign | null, regionCls = ''): ReturnType<typeof Decoration.mark> {
  const cls = (align
    ? `${LIVE_CLASS_NAMES.tableGridCell} vsidian-table-grid-align-${align}`
    : LIVE_CLASS_NAMES.tableGridCell) + (regionCls ? ` ${regionCls}` : '')
  let deco = tableGridCellDecos.get(cls)
  if (!deco) {
    // 内容恰好填满单元格区间时，网格 span 仍须包在内容 span 外层；
    // 双端 inclusive 给 CM6 稳定的外层优先级，也让边界输入留在当前格。
    deco = Decoration.mark({ class: cls, inclusiveStart: true, inclusiveEnd: true })
    tableGridCellDecos.set(cls, deco)
  }
  return deco
}

/** 矩形格区在该格上的蒙版类（#73）：区域端点行/列另加边框类（与既有
 *  CSS 联合类选择器同名，仅施加者由外部贴类改为装饰托管）。 */
function tableRegionClassesFor(region: TableRegion, index: number, col: number): string {
  if (index < region.rowFrom || index > region.rowTo || col < region.columnFrom || col > region.columnTo) return ''
  const cls: string[] = [LIVE_CLASS_NAMES.tableRegionCell]
  if (index === region.rowFrom) cls.push(LIVE_CLASS_NAMES.tableRegionTop)
  if (index === region.rowTo) cls.push(LIVE_CLASS_NAMES.tableRegionBottom)
  if (col === region.columnFrom) cls.push(LIVE_CLASS_NAMES.tableRegionLeft)
  if (col === region.columnTo) cls.push(LIVE_CLASS_NAMES.tableRegionRight)
  return cls.join(' ')
}

/** 零宽空格仍须占一列；widget 仅在该行进入 CM6 视口时生成 DOM。
 *  导出供 localeRefreshContract 的直构等价形态用例（同 CodeCardHeaderWidget /
 *  LiveMathWidget 先例）；生产侧经下方 emptyTableCellDecoFor 的有限实例
 *  缓存发射（active × 对齐的有限组合）。#142 起携带列对齐类（GFM 列对齐
 *  应用到该列全部单元格，空格占位不例外）。 */
export class EmptyTableCellWidget extends WidgetType {
  constructor(private readonly active = false, private readonly align: TableAlign | null = null,
    private readonly regionCls = '') { super() }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    // 空格两态都带 tableGridEmpty 标记（换包扫描锚点，#101）；active 态
    // 只是在其上叠加修饰类（CSS 光标呈现用），同词无独立文案；对齐类与
    // 普通格的 tableGridCellDeco 同名（vsidian-table-grid-align-*）
    const align = this.align ? ` vsidian-table-grid-align-${this.align}` : ''
    const region = this.regionCls ? ` ${this.regionCls}` : ''
    span.className = this.active
      ? `${LIVE_CLASS_NAMES.tableGridCell} ${LIVE_CLASS_NAMES.tableGridEmpty} vsidian-table-grid-empty-active${align}${region}`
      : `${LIVE_CLASS_NAMES.tableGridCell} ${LIVE_CLASS_NAMES.tableGridEmpty}${align}${region}`
    span.setAttribute('aria-label', t('decor.emptyCell'))
    span.addEventListener('mousedown', (event) => {
      const view = EditorView.findFromDOM(span)
      if (!view) return
      const pos = view.posAtDOM(span)
      view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(pos, -1)]), scrollIntoView: true })
      view.focus()
      event.preventDefault()
    })
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}
/** 空格占位 widget 装饰缓存：active × 对齐的有限组合，增量与全量产出相同实例 */
const emptyCellDecos = new Map<string, ReturnType<typeof Decoration.widget>>()
function emptyTableCellDecoFor(align: TableAlign | null, active: boolean,
  regionCls = ''): ReturnType<typeof Decoration.widget> {
  const key = `${active}\u0000${align ?? ''}\u0000${regionCls}`
  let deco = emptyCellDecos.get(key)
  if (!deco) {
    deco = Decoration.widget({ widget: new EmptyTableCellWidget(active, align, regionCls) })
    emptyCellDecos.set(key, deco)
  }
  return deco
}

type GridRowKind = 'header' | 'row'
/** 网格行条目：行身份 + 该行容器前缀长度（#296——引用/列表内表格各行前缀
 *  独立计算，lazy 延续行为 0；格解析与发射一律以前缀后的内容段为对象） */
interface GridRowEntry {
  kind: GridRowKind
  prefixLen: number
}
interface TableGridPlan {
  columns: number
  rows: Map<number, GridRowEntry>
  delimiterLine: number
  /** #142 列宽计划（grid-template-columns 值）：按表内容比例分配，同表各行共享 */
  template: string
  /** #142 逐行内容宽度样本缓存（行号 → 各列宽度）：IME 组合定稿时单行重折
   *  叠出新计划，计划未变即可走单行恢复快路径（千行表性能契约） */
  rowSamples: Map<number, number[]>
}

const tableGridStats = { planCalls: 0, rowsScanned: 0 }
export function getTableGridStats(): Readonly<typeof tableGridStats> {
  return { ...tableGridStats }
}

/**
 * 仅对源区间与显示格一一对应的表格启用网格。缺列/多列以及无法解析的
 * 分隔行保持源码形态，避免视觉点击落到错误列。
 */
function tableGridPlan(doc: Text, table: SyntaxNode): TableGridPlan | null {
  tableGridStats.planCalls += 1
  const rows = new Map<number, GridRowEntry>()
  const rowSamples = new Map<number, number[]>()
  let delimiterLine = 0
  let columns = 0
  let headers = 0
  for (let c = table.firstChild; c; c = c.nextSibling) {
    tableGridStats.rowsScanned += 1
    // 引用块的 `>` 行前缀在 Lezer 树中挂为 Table 直接子节点（#296），
    // 跳过后继续；其余未知直接子节点仍整体降级（不放宽既有安全边界）
    if (c.name === 'QuoteMark') {
      continue
    }
    if (c.name !== 'TableHeader' && c.name !== 'TableDelimiter' && c.name !== 'TableRow') {
      return null
    }
    const line = doc.lineAt(c.from)
    // 行身份节点 from 即内容首：行首至此为容器前缀
    const prefixLen = c.from - line.from
    if (c.name === 'TableDelimiter') {
      const aligns = parseTableDelimiter(blankContainerPrefix(line.text, prefixLen))
      if (!aligns || delimiterLine !== 0) {
        return null
      }
      delimiterLine = line.number
      columns = aligns.length
    } else {
      const kind: GridRowKind = c.name === 'TableHeader' ? 'header' : 'row'
      if (kind === 'header') headers += 1
      rows.set(line.number, { kind, prefixLen })
    }
  }
  if (headers !== 1 || delimiterLine === 0 || columns === 0 || rows.size === 0) {
    return null
  }
  const samples = new Array<number>(columns).fill(0)
  for (const [lineNo, entry] of rows) {
    tableGridStats.rowsScanned += 1
    // 前缀替换为空格参与拆分（#296）：坐标零偏移，空白走容忍机制
    const text = blankContainerPrefix(doc.line(lineNo).text, entry.prefixLen)
    if (!tableRowCellsForColumns(text, 0, columns)) {
      return null
    }
    const widths = collectColumnSamples([text], columns)
    rowSamples.set(lineNo, widths)
    for (let col = 0; col < columns; col++) {
      if (widths[col]! > samples[col]!) {
        samples[col] = widths[col]!
      }
    }
  }
  // #142 列宽计划：表头与数据行的内容宽度样本（分隔行的对齐标记不参与）
  const template = tableGridTemplate(samples)
  return { columns, rows, delimiterLine, template, rowSamples }
}

const gridLineDecos = new Map<string, ReturnType<typeof Decoration.line>>()
/** 行装饰实例缓存上限：列宽计划随内容变化产生新键（同表各行共享同键），
 *  逐键缓存量与「编辑过的表格形态数」同阶——清空仅丢失实例复用（eq 暂时
 *  失配触发一次重绘），不影响正确性；旧文档态不再被引用后条目即死数据 */
const GRID_LINE_DECO_CACHE_LIMIT = 512
function tableGridLineDeco(cls: string, kind: GridRowKind, plan: TableGridPlan): ReturnType<typeof Decoration.line> {
  const key = `${cls}\u0000${kind}\u0000${plan.columns}\u0000${plan.template}`
  let deco = gridLineDecos.get(key)
  if (!deco) {
    if (gridLineDecos.size >= GRID_LINE_DECO_CACHE_LIMIT) {
      gridLineDecos.clear()
    }
    deco = Decoration.line({
      class: cls,
      attributes: {
        'data-vsidian-table-row': kind,
        // #142：列数（旧入口保留）+ 列宽计划（minmax 保底 + fr 占比）；
        // 消费见 main.css 网格行规则（缺省回退等分）
        style: `--vsidian-table-columns: ${plan.columns}; --vsidian-table-col-widths: ${plan.template}`,
      },
    })
    gridLineDecos.set(key, deco)
  }
  return deco
}

/** 单元格 mark 实例缓存：header × 对齐的有限组合，增量与全量产出相同实例 */
const tableCellDecos = new Map<string, ReturnType<typeof Decoration.mark>>()

function tableCellDeco(header: boolean, align: TableAlign | null): ReturnType<typeof Decoration.mark> {
  const cls = [
    LIVE_CLASS_NAMES.tableCell,
    header ? LIVE_CLASS_NAMES.tableCellHeader : '',
    align ? LIVE_CLASS_NAMES.tableAlign(align) : '',
  ]
    .filter(Boolean)
    .join(' ')
  // #132 别名桥：单元格类串逐 token 加工（vsidian-table-cell → + cm-table-cell）
  const aliased = applyObsidianDomAlias(cls)
  let deco = tableCellDecos.get(aliased)
  if (!deco) {
    deco = Decoration.mark({ class: aliased })
    tableCellDecos.set(aliased, deco)
  }
  return deco
}

/** 表格祖先（path 反向查找；Table 不可嵌套，命中即唯一） */
function tableAncestor(path: SyntaxNode[]): SyntaxNode | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i]!.name === 'Table') {
      return path[i]!
    }
  }
  return null
}

/** 表格的列对齐：解析 Table 直接子 TableDelimiter 中覆盖整行的那一个（分隔行） */
function tableAlignsOf(doc: Text, table: SyntaxNode | null): Array<TableAlign | null> | null {
  if (!table) {
    return null
  }
  for (let c = table.firstChild; c; c = c.nextSibling) {
    if (c.name !== 'TableDelimiter') {
      continue
    }
    const line = doc.lineAt(c.from)
    if (c.to > line.from && c.to <= line.to) {
      // 分隔行解析：前缀替换空格（#296），坐标零偏移
      const aligns = parseTableDelimiter(blankContainerPrefix(line.text, c.from - line.from))
      if (aligns) {
        return aligns
      }
    }
  }
  return null
}

/** 一行表格行的管道符 mark（全部裸管道：含首尾边界） */
function emitTablePipeMarks(out: Array<Range<Decoration>>, doc: Text, lineFrom: number): void {
  const line = doc.lineAt(lineFrom)
  for (let i = 0; i < line.text.length; i++) {
    // 转义/代码内管道不切分单元格，同样不作为分隔管道呈现
    if (barePipeAt(line.text, i)) {
      out.push(tablePipeDeco.range(lineFrom + i, lineFrom + i + 1))
    }
  }
}

/** 表头/数据行的单元格 mark + 管道 mark（GFM 语义拆分） */
function emitTableRowMarks(
  out: Array<Range<Decoration>>,
  doc: Text,
  node: SyntaxNode,
  path: SyntaxNode[],
  selection: EditorSelection,
  grid: boolean,
  columns?: number,
  region: TableRegion | null = null,
): void {
  const line = doc.lineAt(node.from)
  const header = node.name === 'TableHeader'
  const table = tableAncestor(path)
  const aligns = tableAlignsOf(doc, table)
  // 内容行索引（表头 0，数据行跳过分隔行）——与 tableRegionField 的坐标一致
  const regionIndex = region && table && region.tableFrom === table.from
    ? header ? 0 : line.number - doc.lineAt(region.tableFrom).number - 1
    : -1
  // 容器前缀（#296）：行身份节点 from 即内容首。格解析与发射以「前缀
  // 替换为空格」的整行为对象——坐标零偏移，空白走边界容忍
  const prefixLen = node.from - line.from
  const contentText = blankContainerPrefix(line.text, prefixLen)
  const cells = grid && columns
    ? tableRowCellsForColumns(contentText, line.from, columns) ?? []
    : splitTableRowCells(contentText, line.from)
  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col]!
    if (grid) {
      const regionCls = regionIndex >= 0 ? tableRegionClassesFor(region!, regionIndex, col) : ''
      out.push(cell.to > cell.from
        ? tableGridCellDeco(aligns?.[col] ?? null, regionCls).range(cell.from, cell.to)
        : emptyTableCellDecoFor(aligns?.[col] ?? null,
          selection.ranges.some((range) => range.empty && range.head === cell.from), regionCls).range(cell.from))
      if (cell.to > cell.from && doc.sliceString(cell.to - 1, cell.to) === ' ') {
        out.push(tableGridPaddingDeco.range(cell.to - 1, cell.to))
      }
      // 只替换裸 br；代码片段或转义后的 br 要保持可见字面文本。
      for (const lineBreak of tableCellBreaks(doc.sliceString(cell.from, cell.to))) {
        out.push(tableCellBreakDeco.range(cell.from + lineBreak.from, cell.from + lineBreak.to))
      }
    }
    if (cell.contentTo > cell.contentFrom) {
      const deco = tableCellDeco(header, aligns && col < aligns.length ? aligns[col]! : null)
      out.push(deco.range(cell.contentFrom, cell.contentTo))
    }
  }
  if (grid) {
    // 转义管道的反斜杠：光标/选区触及该行时浅色显形（暴露源码），离开隐藏。
    // 行级判定与标题 mark 显隐同谓词——折叠光标含行两端，非空选区严格重叠。
    const escapedPipeDeco = selectionTouchesRange(selection, line.from, line.to)
      ? tableEscapedPipeRevealDeco
      : tableEscapedPipeDeco
    for (const pos of escapedPipeBackslashes(contentText)) {
      out.push(escapedPipeDeco.range(line.from + pos, line.from + pos + 1))
    }
  }
  emitTablePipeMarks(out, doc, line.from)
}

/** 行是否被选区覆盖（仅用于标题行活动背景提示；mark 显形用 selectionTouchesRange）。 */
export function isLineActive(selection: EditorSelection, doc: Text, lineNumber: number): boolean {
  for (const r of selection.ranges) {
    if (doc.lineAt(r.from).number <= lineNumber && lineNumber <= doc.lineAt(r.to).number) {
      return true
    }
  }
  return false
}

/** 光标或非空选区是否触及语法范围；折叠光标包含两端边界，便于在 mark 左右编辑。 */
export function selectionTouchesRange(selection: EditorSelection, from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.empty ? range.head >= from && range.head <= to : range.from < to && range.to > from) {
      return true
    }
  }
  return false
}

/** 名为 name 的直接子节点（mark 查找用） */
function childNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === name) {
      return c
    }
  }
  return null
}

/** 跳过 pos 起的连续空格（ATX 标记后的分隔空格） */
function skipSpaces(doc: Text, pos: number): number {
  let p = pos
  while (p < doc.length) {
    const ch = doc.sliceString(p, p + 1)
    if (ch !== ' ' && ch !== '\t') {
      break
    }
    p += 1
  }
  return p
}

/** 区间行号集合：把节点/区间限制到 [fromLine, toLine] 后逐行回调。
 *  节点结束位置含块尾换行（Lezer 块节点常态），行号按去掉尾换行计算 */
function eachNodeLine(
  doc: Text,
  node: { from: number; to: number },
  fromLine: number,
  toLine: number,
  fn: (lineNo: number) => void,
): void {
  const first = Math.max(fromLine, doc.lineAt(Math.min(node.from, doc.length)).number)
  let endPos = Math.min(node.to, doc.length)
  if (endPos > node.from && doc.sliceString(endPos - 1, endPos) === '\n') {
    endPos -= 1
  }
  const last = Math.min(toLine, doc.lineAt(endPos).number)
  for (let n = first; n <= last; n++) {
    fn(n)
  }
}

function emitForRange(
  tree: Tree,
  doc: Text,
  selection: EditorSelection,
  fm: SourceRange | null,
  fromLine: number,
  toLine: number,
  gridPlans: Map<number, TableGridPlan | null> = new Map(),
  fmModel: FmTableModel | null = null,
  region: TableRegion | null = null,
  hitReveal: HitRevealContext | null = null,
  fmFolded = false,
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  const lineCls: Array<Set<string> | undefined> = new Array(toLine - fromLine + 1).fill(undefined)
  const gridLines = new Map<number, { kind: GridRowKind; plan: TableGridPlan }>()
  const addLineCls = (lineNo: number, cls: string): void => {
    const idx = lineNo - fromLine
    let set = lineCls[idx]
    if (!set) {
      set = new Set()
      lineCls[idx] = set
    }
    set.add(cls)
  }
  const touches = (from: number, to: number): boolean => selectionTouchesRange(selection, from, to)
  const markerEnd = (node: SyntaxNode): number =>
    node.to < doc.length && doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to

  // frontmatter：成型（#140）→ 表格卡片行类与结构装饰；降级 → 源码行类
  // （树发射始终裁剪到 fm 之后——头区不产生 Markdown 装饰）
  if (fm) {
    const fmLast = doc.lineAt(Math.min(fm.end, doc.length)).number
    if (fmModel) {
      // 卡片常驻呈现、不随光标位置变化（光标引导在 frontmatterEditing）；
      // 折叠态（视图态 field）决定整块收起形态
      const plan = buildFrontmatterCardPlan(doc, fmModel, fmFolded)
      for (const [lineNo, cls] of plan.lineClasses) {
        if (lineNo >= fromLine && lineNo <= toLine) {
          for (const c of cls) {
            addLineCls(lineNo, c)
          }
        }
      }
      const spanFrom = doc.line(fromLine).from
      const spanTo = doc.line(Math.min(toLine, doc.lines)).to
      for (const range of plan.ranges) {
        if (range.from >= spanFrom && range.from <= spanTo) {
          out.push(range)
        }
      }
    } else {
      for (let n = Math.max(1, fromLine); n <= Math.min(toLine, fmLast); n++) {
        addLineCls(n, LIVE_CLASS_NAMES.frontmatterLine)
      }
    }
  }

  const emitFrom = Math.max(doc.line(fromLine).from, fm ? fm.end : 0)
  const emitTo = doc.line(toLine).to

  visitRange(tree, emitFrom, emitTo, (node, path) => {
    // frontmatter 区域内的树节点不发射（头块按源码呈现）
    if (fm && node.from < fm.end) {
      return
    }
    const level = headingLevelOf(node.name)
    if (level !== null) {
      const mark = childNamed(node, 'HeaderMark')
      let contentFrom = node.from
      let contentTo = node.to
      if (mark && mark.from === node.from) {
        // ATX：# 标记在头部（HeaderMark 仅覆盖 # 字符），内容跳过标记后的空格
        contentFrom = skipSpaces(doc, mark.to)
        addLineCls(doc.lineAt(node.from).number, `${HEADING_CLASS_NAMES.line} ${HEADING_CLASS_NAMES.level(level)}`)
      } else {
        // Setext：内容行 = 下划线标记之前的行；下划线行不套标题行级类
        const underlineLine = mark ? doc.lineAt(mark.from).number : doc.lineAt(node.to).number
        contentTo = mark
          ? doc.line(Math.max(1, underlineLine - 1)).to
          : node.to
        eachNodeLine(doc, { from: node.from, to: contentTo }, fromLine, toLine, (n) => {
          if (n < underlineLine) {
            addLineCls(n, `${HEADING_CLASS_NAMES.line} ${HEADING_CLASS_NAMES.level(level)}`)
          }
        })
      }
      if (contentTo > contentFrom && contentFrom >= emitFrom) {
        out.push(headerSpanDecos[level - 1]!.range(contentFrom, contentTo))
      }
      return
    }
    switch (node.name) {
      case 'FencedCode':
      case 'CodeBlock':
        eachNodeLine(doc, node, fromLine, toLine, (n) => addLineCls(n, LIVE_CLASS_NAMES.codeLine))
        return
      case 'Blockquote':
        eachNodeLine(doc, node, fromLine, toLine, (n) => addLineCls(n, LIVE_CLASS_NAMES.quoteLine))
        return
      case 'HorizontalRule': {
        eachNodeLine(doc, node, fromLine, toLine, (n) => addLineCls(n, LIVE_CLASS_NAMES.hrLine))
        // #106 渲染态：控制域是该行区间（含两端边界），未触及时隐藏源文、
        // 呈现真横线；触及则不发射隐藏装饰，源码显形可编辑。隐藏区间严格
        // 取节点范围（CommonMark 全形态含前导缩进外的字符与行尾空格），
        // 引用/列表前缀不随吞——Setext 下划线与 frontmatter 分隔线由解析器
        // 消解为其他节点，天然不进本分支（回归用例钉住）。
        const line = doc.lineAt(node.from)
        if (line.number >= fromLine && line.number <= toLine && !touches(line.from, line.to)) {
          out.push(hrRuleDeco.range(node.from, Math.min(node.to, line.to)))
        }
        return
      }
      // 安全表格在光标进入单元格后仍保留网格；原文编辑由 CM6 承担。
      case 'Table': {
        eachNodeLine(doc, node, fromLine, toLine, (n) => addLineCls(n, LIVE_CLASS_NAMES.tableLine))
        let plan = gridPlans.get(node.from)
        if (plan === undefined && !gridPlans.has(node.from)) {
          plan = tableGridPlan(doc, node)
          gridPlans.set(node.from, plan)
        }
        if (plan) {
          const first = Math.max(fromLine, doc.lineAt(node.from).number)
          const last = Math.min(toLine, doc.lineAt(Math.min(node.to, doc.length)).number)
          for (let lineNo = first; lineNo <= last; lineNo++) {
            const entry = plan.rows.get(lineNo)
            if (!entry) continue
            // #251 命中显形：活跃命中/停驻触界的网格行回源（行不加网格
            // 行类、不进 gridLines——竖线等结构源码可见、命中 mark 可画，
            // 与分隔行光标停驻同款「类缺席」机制）。编辑选区刻意不参与
            // （表格网格核心体验），显形只认命中触界
            if (hitRevealTouchesLine(hitReveal, lineNo, doc.line(lineNo))) {
              continue
            }
            addLineCls(lineNo, LIVE_CLASS_NAMES.tableGridRow)
            gridLines.set(lineNo, { kind: entry.kind, plan })
          }
          // 只有光标直接停在分隔行才显露可编辑源码。跨行选区即使覆盖该行，
          // 也继续隐藏结构标记，避免把 `| --- |` 当可选正文显示。
          // #251：命中触界/停驻的分隔行同款显露（命中里的分隔行内容可
          // 见——命中集与停驻是除光标外的第二显形来源）
          const editingDelimiter = selection.ranges.some((range) => range.empty &&
            doc.lineAt(range.head).number === plan.delimiterLine)
          const delimiterLine = doc.line(plan.delimiterLine)
          const delimiterRevealed = !editingDelimiter &&
            hitRevealTouchesLine(hitReveal, plan.delimiterLine, delimiterLine)
          if (plan.delimiterLine >= fromLine && plan.delimiterLine <= toLine &&
              !editingDelimiter && !delimiterRevealed) {
            addLineCls(plan.delimiterLine, LIVE_CLASS_NAMES.tableGridDelimiter)
          }
        }
        return
      }
      case 'TableHeader': {
        const lineNo = doc.lineAt(node.from).number
        if (lineNo >= fromLine && lineNo <= toLine) {
          addLineCls(lineNo, LIVE_CLASS_NAMES.tableHeaderLine)
          const grid = gridPlans.get(tableAncestor(path)?.from ?? -1)
          emitTableRowMarks(out, doc, node, path, selection, Boolean(grid && gridLines.has(lineNo)), grid?.columns, region)
        }
        return
      }
      case 'TableRow': {
        const lineNo = doc.lineAt(node.from).number
        if (lineNo >= fromLine && lineNo <= toLine) {
          const grid = gridPlans.get(tableAncestor(path)?.from ?? -1)
          emitTableRowMarks(out, doc, node, path, selection, Boolean(grid && gridLines.has(lineNo)), grid?.columns, region)
        }
        return
      }
      case 'TableDelimiter': {
        // 分隔行是覆盖整行的 TableDelimiter 节点；表头/数据行内的单字符
        // 管道节点同名，按区间是否独占整行区分
        const line = doc.lineAt(node.from)
        if (node.from === line.from && node.to === line.to) {
          const lineNo = line.number
          if (lineNo >= fromLine && lineNo <= toLine) {
            addLineCls(lineNo, LIVE_CLASS_NAMES.tableDelimiterLine)
            emitTablePipeMarks(out, doc, line.from)
          }
        }
        return
      }
      case 'TableCell':
        // lezer 的 cell 切分不识别 \| 与代码内管道，装饰用 emitTableRowMarks
        // 的自研拆分；此处跳过（cell 内行内节点经 visitRange 递归照常发射）
        return
      case 'Escape': {
        // Markdown 转义符通用显隐（验收反馈：不限于表格——Obsidian 对齐，
        // 转义符在任何位置语义一致）：反斜杠（Escape 节点首字符）默认隐藏、
        // 光标/选区触及该行浅色显形。表格行内排除——grid 态的 \| 由
        // emitTableRowMarks 走 live-table-escaped-pipe 专用发射（#42 契约），
        // 降级态源文原文呈现，双路径重复发射会以 mark 叠类互抹。
        if (path.some((p) => p.name === 'Table')) {
          return
        }
        const line = doc.lineAt(node.from)
        if (line.number >= fromLine && line.number <= toLine) {
          // #251 触界来源推广：命中触界该行同样显形（与光标/选区触界并集；
          // 行外命中不显形——最小回显）
          out.push(
            (touches(line.from, line.to) ||
              (hitReveal ? hitRevealTouchesLine(hitReveal, line.number, line) : false)
                ? escapeRevealDeco
                : escapeDeco)
              .range(node.from, node.from + 1),
          )
        }
        return
      }
      case 'ListItem': {
        const depth = 1 + path.filter((p) => p.name === 'ListItem').length
        const nearestList = [...path].reverse().find((p) => p.name === 'BulletList' || p.name === 'OrderedList')
        const ordered = nearestList?.name === 'OrderedList'
        // 行级深度类覆盖项内全部行（续行跟随项缩进）；bullet/ordered 区分
        // 类只给标记所在行——续行不显圆点（lazy 续行曾借父项行类误渲圆点）
        const cls = `${LIVE_CLASS_NAMES.listLine} ${LIVE_CLASS_NAMES.listLine}-d${Math.min(8, depth)}`
        eachNodeLine(doc, node, fromLine, toLine, (n) => {
          for (const part of cls.split(' ')) {
            addLineCls(n, part)
          }
        })
        const mark = node.getChild('ListMark')
        if (mark) {
          const markLine = doc.lineAt(mark.from).number
          if (markLine >= fromLine && markLine <= toLine) {
            addLineCls(markLine, ordered ? LIVE_CLASS_NAMES.listOrdered : LIVE_CLASS_NAMES.listBullet)
          }
        }
        return
      }
      case 'Emphasis':
        pushInnerSpan(out, node, 'EmphasisMark', emphasisDeco)
        return
      case 'StrongEmphasis':
        pushInnerSpan(out, node, 'EmphasisMark', strongDeco)
        return
      case 'InlineCode':
        pushInnerSpan(out, node, 'CodeMark', inlineCodeDeco)
        return
      case 'Highlight':
        // #105 高亮：内容 span 常显（底色在 CSS；pushInnerSpan 的
        // last.from > first.to 检查天然跳过空内容形态 ====）
        pushInnerSpan(out, node, 'HighlightMark', highlightDeco)
        return
      case 'Comment':
      case 'CommentBlock':
        // #139 注释淡化：整节点（含定界符）低对比度常显——明显非正文
        // 仍可读，不隐藏不折叠、无控制域显形（frontmatter 裁剪在
        // visitRange 回调头部统一拦截头块伪节点）
        out.push(htmlCommentDeco.range(node.from, node.to))
        return
      case 'HeaderMark': {
        const heading = [...path].reverse().find((parent) => headingLevelOf(parent.name) !== null)
        const to = markerEnd(node)
        if (!heading || !touches(heading.from, heading.to)) {
          out.push(hideDeco.range(node.from, to))
        }
        return
      }
      case 'QuoteMark': {
        const to = markerEnd(node)
        if (!touches(node.from, to)) {
          out.push(hideDeco.range(node.from, to))
        }
        return
      }
      case 'ListMark': {
        // 有序列表编号保留；无序标记隐藏（吞并行首缩进空白与标记后
        // 一个空格）——伪圆点紧邻正文，层级缩进统一由 -dN padding 表达，
        // 行首空格不再与 padding 双重占位
        const ordered =
          [...path].reverse().find((p) => p.name === 'BulletList' || p.name === 'OrderedList')
            ?.name === 'OrderedList'
        if (ordered) {
          return
        }
        const line = doc.lineAt(node.from)
        const to = markerEnd(node)
        if (!touches(line.from, to)) {
          out.push(hideDeco.range(line.from, to))
        } else {
          addLineCls(line.number, LIVE_CLASS_NAMES.listMarkerVisible)
        }
        return
      }
      case 'EmphasisMark': {
        const scope = path[path.length - 1]
        if (!scope || !touches(scope.from, scope.to)) {
          out.push(hideDeco.range(node.from, node.to))
        }
        return
      }
      case 'HighlightMark': {
        // #105：控制域 = 高亮范围（含两端边界）；空内容形态（====）无
        // 字面高亮语义，定界符保持可见（源码降级，源文不丢）
        const scope = path[path.length - 1]
        const empty = scope?.firstChild && scope.lastChild &&
          scope.firstChild.to === scope.lastChild.from
        if (empty) {
          return
        }
        if (!scope || !touches(scope.from, scope.to)) {
          out.push(hideDeco.range(node.from, node.to))
        }
        return
      }
      case 'CodeMark': {
        // 仅行内代码的反引号隐藏；围栏 ``` 保留可见
        if (path[path.length - 1]?.name === 'InlineCode') {
          const scope = path[path.length - 1]!
          if (!touches(scope.from, scope.to)) {
            out.push(hideDeco.range(node.from, node.to))
          }
        }
        return
      }
      case 'TaskMarker': {
        if (!touches(node.from, node.to)) {
          const checked = doc.sliceString(node.from + 1, Math.min(node.from + 2, node.to)) !== ' '
          // 区间吞并标记后一个空格：checkbox 与正文的空隙由 widget 的
          // margin 表达，与普通列表行「圆点 margin」同口径，不再叠加
          // 空格占位（两种行的符号→正文间距相等）
          out.push(taskCheckboxDecos[checked ? 1 : 0]!.range(node.from, markerEnd(node)))
        }
        return
      }
      default:
        return
    }
  })

  for (let i = 0; i < lineCls.length; i++) {
    const set = lineCls[i]
    if (set && set.size > 0) {
      const line = doc.line(fromLine + i)
      const cls = [...set].sort().join(' ')
      const grid = gridLines.get(line.number)
      out.push((grid ? tableGridLineDeco(cls, grid.kind, grid.plan) : lineDeco(cls)).range(line.from))
    }
  }
  return out
}

/** 节点首尾 mark 之间的内容 span */
function pushInnerSpan(
  out: Array<Range<Decoration>>,
  node: SyntaxNode,
  markName: string,
  deco: Decoration,
): void {
  let first: SyntaxNode | null = null
  let last: SyntaxNode | null = null
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === markName) {
      if (!first) {
        first = c
      }
      last = c
    }
  }
  if (first && last && last.from > first.to) {
    out.push(deco.range(first.to, last.from))
  }
}

// ---- 增量观测（单测与性能探针；字段名沿用 #5 的协议通道） ----

const stats = {
  fullBuildLines: 0,
  lastUpdateScannedLines: 0,
  totalUpdates: 0,
  totalScannedLines: 0,
}

export interface HeadingStats {
  fullBuildLines: number
  lastUpdateScannedLines: number
  totalUpdates: number
  totalScannedLines: number
}

export function getHeadingStats(): HeadingStats {
  return { ...stats }
}

// ---- 解析与装饰状态 ----

/** 网格表格扫描段：行装饰带网格类（tableGridRow / tableGridDelimiter）的
 *  连续行区间（文档位置，升序互不重叠）。行格分类（liveLineNumbers 的
 *  gutterLineClass compute）据此把 decos.between 收窄到表格行段——行装饰
 *  仍是分类的唯一事实源，段只是扫描索引。刻意不用 gridPlans 当索引：它
 *  只是本次局部重建的缓存（doc 变更路径整表换新 Map），未受编辑影响的
 *  表格不在其中（同 formatLiveLineNumber 的口径）。 */
export interface GridTableSegment {
  from: number
  to: number
}

function isGridLineClass(specClass: string | undefined): boolean {
  const classes: string[] = specClass?.split(' ') ?? []
  return classes.includes(LIVE_CLASS_NAMES.tableGridRow) ||
    classes.includes(LIVE_CLASS_NAMES.tableGridDelimiter)
}

/** 从行装饰提取区间内的网格行段：行首点装饰带网格类的行号聚合成连续段
 *  （段端为该行 Line.to，不含行尾换行；行号连续的行在同一次提取内
 *  已并段）。光标停分隔行时该行
 *  装饰被撤下，段会暂时少这一行——该行本就无类可分类，不影响分类结果；
 *  光标离开后重建区间重提取，段自然并回。 */
function deriveGridSegments(
  decos: DecorationSet,
  ranges: ReadonlyArray<{ from: number; to: number }>,
  doc: Text,
): GridTableSegment[] {
  const lines = new Set<number>()
  for (const range of ranges) {
    decos.between(range.from, range.to, (from, to, deco) => {
      if (to !== from) return // 行装饰为行首点区间
      if (!isGridLineClass(deco.spec.class)) return
      lines.add(doc.lineAt(from).number)
    })
  }
  if (!lines.size) return []
  const sorted = [...lines].sort((a, b) => a - b)
  const out: GridTableSegment[] = []
  let start = sorted[0]!
  let prev = sorted[0]!
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) {
      prev = n
      continue
    }
    out.push({ from: doc.line(start).from, to: doc.line(prev).to })
    start = prev = n!
  }
  return out
}

/** 随文本变更映射旧段（无变更或无段时沿用旧引用；整段被删则丢弃） */
function mapGridSegments(segments: readonly GridTableSegment[], changes: ChangeSet): GridTableSegment[] {
  if (changes.empty || segments.length === 0) return segments as GridTableSegment[]
  const out: GridTableSegment[] = []
  for (const seg of segments) {
    const from = changes.mapPos(seg.from, -1)
    const to = changes.mapPos(seg.to, 1)
    if (to > from) out.push({ from, to })
  }
  return out
}

/** 排序归并：仅位置重叠（或零隙相接）的段合并；段端不含行尾换行，
 *  行号相邻而来自不同提取的段各自保留——各多一次 between 扫描，
 *  后续任一段被触及重建即重新归并，无正确性影响 */
function mergeGridSegments(list: readonly GridTableSegment[]): GridTableSegment[] {
  const sorted = [...list].sort((a, b) => a.from - b.from || a.to - b.to)
  const out: GridTableSegment[] = []
  for (const seg of sorted) {
    const last = out[out.length - 1]
    if (last && seg.from <= last.to) {
      last.to = Math.max(last.to, seg.to)
    } else {
      out.push({ ...seg })
    }
  }
  return out
}

/** 更新扫描段：旧段随变更映射后保留，重建区间（新坐标）内从**更新后的
 *  装饰集**重提取，两者取并集归并。触及判定用闭端（decos.update 的
 *  filter 对恰在 filterTo 上的点装饰同样生效，边界保守即正确）。
 *  关键不变量：任何可能改动段内装饰的更新路径都返回**新数组引用**
 *  （触及或新增网格行必然归并出新数组；纯映射路径文档引用同步变化兜
 *  底）——liveLineNumbers 的行格分类 memo 以 (doc 引用, 段数组引用) 为
 *  键，据此保证命中时结果必然未变。反之，无触及且无新增时沿用旧引用，
 *  memo 才能命中（表外纯选区移动零重算）。 */
function updateGridSegments(
  oldSegments: readonly GridTableSegment[],
  changes: ChangeSet,
  rebuiltRanges: ReadonlyArray<{ from: number; to: number }>,
  decos: DecorationSet,
  doc: Text,
): GridTableSegment[] {
  const mapped = mapGridSegments(oldSegments, changes)
  const touched = rebuiltRanges.some((range) =>
    mapped.some((seg) => range.from <= seg.to && range.to >= seg.from))
  const found = deriveGridSegments(decos, rebuiltRanges, doc)
  if (!touched && found.length === 0 && mapped === oldSegments) {
    return mapped
  }
  return mergeGridSegments([...mapped, ...found])
}

interface LiveDecoState {
  decos: DecorationSet
  tree: Tree
  fragments: readonly TreeFragment[]
  fm: SourceRange | null
  /** #140 成型头区模型（降级 null）；仅 fmTouched 时重析，装饰与 widget 共读 */
  fmModel: FmTableModel | null
  gridPlans: Map<number, TableGridPlan | null>
  gridSegments: GridTableSegment[]
  compositionPreview: boolean
}

function parseTree(doc: Text, fragments?: readonly TreeFragment[]): Tree {
  return markdownTreeParser.parse(docInput(doc), fragments)
}

function frontmatterOf(doc: Text): SourceRange | null {
  // 有界扫描：frontmatter 判定只依赖文档头部（markdownDoc 内限制扫描长度）
  return frontmatterRange(headText(doc))
}

/** 成型模型解析（head 有界文本；fm 为 null 时恒 null） */
function frontmatterModelOf(doc: Text, fm: SourceRange | null): FmTableModel | null {
  if (!fm) {
    return null
  }
  return parseFrontmatterTable(headText(doc), fm)
}

/** 文档头部字符串（frontmatter 判定的输入，有界；截断口径同源 markdownDoc） */
function headText(doc: Text): string {
  return doc.sliceString(0, Math.min(doc.length, FM_SCAN_LIMIT))
}

/** 全量构建（create / 全文替换 / 探针对拍） */
export function buildLivePreviewDecorations(doc: Text, selection: EditorSelection,
  region: TableRegion | null = null, hitReveal: HitRevealContext | null = null, fmFolded = false): DecorationSet {
  const tree = parseTree(doc)
  const fm = frontmatterOf(doc)
  stats.fullBuildLines = doc.lines
  return RangeSet.of(
    emitForRange(tree, doc, selection, fm, 1, doc.lines, new Map(), frontmatterModelOf(doc, fm), region, hitReveal, fmFolded),
    true,
  )
}

/** 变更行区间（新文档坐标，行扩展） */
interface LineSpan {
  fromLine: number
  toLine: number
}

interface ChangedRange4 {
  fromA: number
  toA: number
  fromB: number
  toB: number
}

/** 选区驱动的重建行：旧选区行映射 + 新选区行 */
function selectionSpans(tr: Transaction): LineSpan[] {
  const doc = tr.state.doc
  const spans: LineSpan[] = []
  for (const r of tr.startState.selection.ranges) {
    const from = tr.changes.mapPos(r.from, -1)
    const to = tr.changes.mapPos(r.to, 1)
    spans.push({ fromLine: doc.lineAt(from).number, toLine: doc.lineAt(to).number })
  }
  for (const r of tr.state.selection.ranges) {
    spans.push({ fromLine: doc.lineAt(r.from).number, toLine: doc.lineAt(r.to).number })
  }
  return spans
}

/** 矩形格区驱动的重建行：旧/新区域覆盖行（含端点行整段重算——top/bottom
 *  边框类随端点行变化）。蒙版类并入网格格装饰后，区域增删必须同步重刷
 *  受影响行，否则旧类残留（2026-09-28）。 */
function regionSpans(tr: Transaction, doc: Text): LineSpan[] {
  const spans: LineSpan[] = []
  for (const region of [tr.startState.field(tableRegionField, false), tr.state.field(tableRegionField, false)]) {
    if (!region) continue
    const headerNo = doc.lineAt(tr.changes.mapPos(region.tableFrom, -1)).number
    const first = headerNo + region.rowFrom + (region.rowFrom > 0 ? 1 : 0)
    const last = Math.min(headerNo + region.rowTo + (region.rowTo > 0 ? 1 : 0), doc.lines)
    if (last >= first) spans.push({ fromLine: first, toLine: last })
  }
  return spans
}

/** 命中显形驱动的重建行（#251）：hitRevealField 值变化时，新旧命中与
 * 停驻触界的行都要重发射（旧行撤显形/新行上显形；停驻行号在各自事务
 * 坐标系，旧侧经 changes 映射到新坐标）。纯选区事务下 changes 恒等，
 * 映射零成本。
 * 预算钳制（大文档多命中时查找键入路径的成本上界）：
 * - 本 field 只拥有行级类别装饰（grid 行/分隔行/转义符）——命中行文本
 *   无 `|` 与 `\` 时重发射必为空转，按文本过滤（块级公式/Mermaid/代码卡
 *   的回源由各自 StateField、独行图片与行内公式由各自 ViewPlugin 消费，
 *   不经此 span）
 * - span 就地合并（相邻/重叠），合并后总覆盖行数达全文档量级时退为
 *   一次全量重发射（一次 emitForRange 优于数千次逐 span update）
 * - 坐标不可信窗口（docChanged 后 find/occ 来源引用都未刷新——
 *   findStale/occStale 暂态）跳过：装饰随 decos.update 的变更映射自然
 *   移动，重算落位的引用变化事务再按新坐标重发射 */
function hitRevealSpans(tr: Transaction, doc: Text): LineSpan[] {
  const before = tr.startState.field(hitRevealField, false)
  const after = tr.state.field(hitRevealField, false)
  if (!before || !after || before === after) {
    return []
  }
  if (tr.docChanged && after.findSource === before.findSource &&
      after.occSelection === before.occSelection) {
    return []
  }
  const spans: LineSpan[] = []
  const pushHit = (from: number, to: number): void => {
    if (to < from || from > doc.length) {
      return
    }
    const firstLine = doc.lineAt(Math.min(from, doc.length)).number
    const lastLine = doc.lineAt(Math.min(Math.max(to - 1, from), doc.length)).number
    for (let lineNo = firstLine; lineNo <= lastLine; lineNo++) {
      const text = doc.line(lineNo).text
      if (text.includes('|') || text.includes('\\')) {
        spans.push({ fromLine: lineNo, toLine: lineNo })
      }
    }
  }
  for (const hit of after.hits) {
    pushHit(hit.from, hit.to)
  }
  const oldDoc = tr.startState.doc
  // 旧命中坐标可能来自更早的文档（docChanged 后 findStale 漂移窗口内
  // 引用未变，如替换事务后的清空事务）：超出本事务 changeset 覆盖长度
  // （= oldDoc.length）时 mapPos 抛 RangeError，中断整笔 dispatch——
  // 钳到旧文档尾再映射（行级消费语义下无损：该命中即将被重算落位替换）
  const mapOldPos = (pos: number, assoc: number): number =>
    tr.changes.mapPos(Math.min(pos, oldDoc.length), assoc)
  for (const hit of before.hits) {
    pushHit(mapOldPos(hit.from, -1), mapOldPos(hit.to, 1))
  }
  for (const n of after.stickyLines) {
    if (n >= 1 && n <= doc.lines) {
      spans.push({ fromLine: n, toLine: n })
    }
  }
  for (const n of before.stickyLines) {
    if (n >= 1 && n <= oldDoc.lines) {
      const pos = Math.min(tr.changes.mapPos(oldDoc.line(n).from, -1), doc.length)
      spans.push({ fromLine: doc.lineAt(pos).number, toLine: doc.lineAt(pos).number })
    }
  }
  mergeSpans(spans, doc.lines)
  let covered = 0
  for (const s of spans) {
    covered += s.toLine - s.fromLine + 1
  }
  if (covered >= doc.lines) {
    return [{ fromLine: 1, toLine: doc.lines }]
  }
  return spans
}

/** 装饰承载节点名（旧侧种子收集用——不含巨型容器，见模块头注释） */
const SEED_NODE_NAMES = new Set([
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
  'SetextHeading1', 'SetextHeading2',
  'HeaderMark', 'EmphasisMark', 'QuoteMark', 'ListMark', 'TaskMarker',
  'Emphasis', 'StrongEmphasis', 'InlineCode', 'HorizontalRule', 'ListItem',
  'Highlight', 'HighlightMark', 'Comment', 'CommentBlock',
  'Table', 'TableHeader', 'TableRow', 'TableCell', 'TableDelimiter',
])

/**
 * 分类容器（尾部差异探测用）。行内节点（InlineCode 等）刻意不入表：
 * 容器探测按块级结构扩展，行内节点高频、纳入会放宽每次重建的扩展面。
 * 已知边界（review 增量轮落档）：在能跨行配对的反引号结构上追加 `
 * 开启跨行 code span 吞掉下方行时，被吞行不进重建区间（变更行与它之间
 * 无种子表节点牵连、InlineCode 非容器分类），行内装饰（转义符等）短暂
 * 残留，选区触及该行即自愈——钉住在 liveEscape.test.ts「已知边界」用例。
 */
const CONTAINER_NAMES = new Set(['FencedCode', 'CodeBlock', 'Blockquote', 'ListItem', 'Table'])

/**
 * 一次 docChanged 事务的重建行区间计算：
 * 1. 种子：变更行（新坐标行扩展）+ 旧树相交装饰节点（映射后的行区间）+
 *    选区旧行/新行 + frontmatter 变化时的头块行
 * 2. 容器差异扩展：种子末行的下一行处比较新旧树的容器分类（名字集合与
 *    映射后范围）；分类变化（围栏开闭、列表吸收等）时扩展到容器边界，
 *    迭代至不动点——正常键入在首轮即收敛
 */
function planRebuildSpans(
  tr: Transaction,
  oldTree: Tree,
  newTree: Tree,
  changed: readonly ChangedRange4[],
  oldFm: SourceRange | null,
  newFm: SourceRange | null,
  fmDirty: boolean,
): LineSpan[] {
  const doc = tr.state.doc
  const oldDoc = tr.startState.doc
  const spans: LineSpan[] = []
  const pushSpan = (from: number, to: number): void => {
    if (to < from || from > doc.length) {
      return
    }
    spans.push({
      fromLine: doc.lineAt(Math.min(from, doc.length)).number,
      toLine: doc.lineAt(Math.min(Math.max(to, from), doc.length)).number,
    })
  }
  for (const c of changed) {
    pushSpan(c.fromB, c.toB)
    // 旧侧：变更旧行区间内相交的装饰承载节点 → 映射为新坐标
    const oldFrom = oldDoc.lineAt(Math.min(c.fromA, oldDoc.length)).from
    const oldTo = oldDoc.lineAt(Math.min(c.toA, oldDoc.length)).to
    visitRange(oldTree, oldFrom, oldTo, (node) => {
      if (SEED_NODE_NAMES.has(node.name)) {
        pushSpan(tr.changes.mapPos(node.from, -1), tr.changes.mapPos(node.to, 1))
      }
    })
  }
  // 选区显式变化才扩展重建行（编辑事务的默认选区映射不触发）
  if (tr.selection !== undefined) {
    spans.push(...selectionSpans(tr))
  }

  if ((fmDirty && (newFm !== null || oldFm !== null)) || !sameRange(newFm, oldFm)) {
    // 旧 fm 端点映射到新坐标再取行号——fm 前方插入/删除行时旧行号已偏移
    // （#140 外部在头区前插行的场景实测暴露：未映射时清理范围不足，
    // 成型装饰残留在偏移后的行上）
    const oldEndMapped = oldFm
      ? tr.changes.mapPos(Math.min(oldFm.end, oldDoc.length), 1)
      : 0
    const lastLine = Math.max(
      newFm ? doc.lineAt(Math.min(newFm.end, doc.length)).number : 0,
      oldFm ? doc.lineAt(Math.min(oldEndMapped, doc.length)).number : 0,
    )
    spans.push({ fromLine: 1, toLine: Math.max(1, Math.min(lastLine, doc.lines)) })
  }

  mergeSpans(spans, doc.lines)
  expandSpansByContainerDiff(spans, tr, oldTree, newTree, changed)
  return spans
}

function sameRange(a: SourceRange | null, b: SourceRange | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return a.start === b.start && a.end === b.end
}

/** 就地合并重叠/相邻区间并裁剪到文档行界 */
function mergeSpans(spans: LineSpan[], totalLines: number): void {
  for (const s of spans) {
    s.fromLine = Math.max(1, Math.min(s.fromLine, totalLines))
    s.toLine = Math.max(1, Math.min(s.toLine, totalLines))
  }
  spans.sort((a, b) => a.fromLine - b.fromLine || a.toLine - b.toLine)
  const merged: LineSpan[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.fromLine <= last.toLine + 1) {
      last.toLine = Math.max(last.toLine, s.toLine)
    } else {
      merged.push({ ...s })
    }
  }
  spans.length = 0
  spans.push(...merged)
}

/** 容器分类差异探测：扩展 spans 至受影响容器边界（迭代至不动点） */
function expandSpansByContainerDiff(
  spans: LineSpan[],
  tr: Transaction,
  oldTree: Tree,
  newTree: Tree,
  changed: readonly ChangedRange4[],
): void {
  const doc = tr.state.doc
  const oldDoc = tr.startState.doc
  const inverted = tr.changes.invertedDesc
  for (let iter = 0; iter < 128 && spans.length > 0; iter++) {
    let grew = false
    for (const span of spans) {
      if (span.toLine >= doc.lines) {
        continue
      }
      const probePos = doc.line(span.toLine + 1).from
      const newChain = chainAt(newTree, probePos)
      const oldPos = Math.min(inverted.mapPos(probePos, -1), oldDoc.length)
      const oldChain = chainAt(oldTree, oldPos)
      const newKinds = new Set(newChain.filter((c) => CONTAINER_NAMES.has(c.name)).map((c) => c.name))
      const oldKinds = new Set(oldChain.filter((c) => CONTAINER_NAMES.has(c.name)).map((c) => c.name))
      let needExpand = !setEquals(newKinds, oldKinds)
      if (!needExpand) {
        // 同名容器范围差异（列表吸收等）：新范围越过映射旧范围且增量不来自变更
        for (const kind of newKinds) {
          const n = newChain.find((c) => c.name === kind)!
          const o = oldChain.find((c) => c.name === kind)!
          const mappedOFrom = tr.changes.mapPos(o.from, -1)
          const mappedOTo = tr.changes.mapPos(o.to, 1)
          if (n.to > mappedOTo && !changedCovers(changed, mappedOTo, n.to)) {
            needExpand = true
            break
          }
          if (n.from < mappedOFrom && !changedCovers(changed, n.from, mappedOFrom)) {
            needExpand = true
            break
          }
        }
      }
      if (!needExpand) {
        continue
      }
      let fromLine = span.fromLine
      let toLine = span.toLine
      for (const c of newChain) {
        if (CONTAINER_NAMES.has(c.name)) {
          fromLine = Math.min(fromLine, doc.lineAt(c.from).number)
          toLine = Math.max(toLine, doc.lineAt(Math.min(c.to, doc.length)).number)
        }
      }
      for (const c of oldChain) {
        if (CONTAINER_NAMES.has(c.name)) {
          fromLine = Math.min(fromLine, doc.lineAt(tr.changes.mapPos(c.from, -1)).number)
          toLine = Math.max(toLine, doc.lineAt(Math.min(tr.changes.mapPos(c.to, 1), doc.length)).number)
        }
      }
      if (toLine > span.toLine || fromLine < span.fromLine) {
        span.fromLine = Math.max(1, fromLine)
        span.toLine = Math.min(doc.lines, toLine)
        grew = true
      }
    }
    if (!grew) {
      return
    }
    mergeSpans(spans, doc.lines)
  }
}

function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const v of a) {
    if (!b.has(v)) {
      return false
    }
  }
  return true
}

/** [from, to) 与任一变更区间（新坐标）相交 */
function changedCovers(changed: readonly ChangedRange4[], from: number, to: number): boolean {
  for (const c of changed) {
    if (c.fromB < to && c.toB > from) {
      return true
    }
  }
  return false
}

// ---- StateField ----

export const liveDecorationsField = StateField.define<LiveDecoState>({
  create(state) {
    const tree = parseTree(state.doc)
    const fm = frontmatterOf(state.doc)
    const fmModel = frontmatterModelOf(state.doc, fm)
    stats.fullBuildLines = state.doc.lines
    const gridPlans = new Map<number, TableGridPlan | null>()
    const decos = RangeSet.of(
      emitForRange(tree, state.doc, state.selection, fm, 1, state.doc.lines, gridPlans, fmModel,
        state.field(tableRegionField, false), hitRevealContextOf(state), state.field(fmFoldField, false) ?? false), true)
    return {
      decos,
      tree,
      fragments: TreeFragment.addTree(tree),
      fm,
      fmModel,
      gridPlans,
      gridSegments: deriveGridSegments(decos, [{ from: 0, to: state.doc.length }], state.doc),
      compositionPreview: false,
    }
  },
  update(value, tr) {
    // #251 命中显形：hitRevealField 值变化（命中集增删/停驻种入收缩）也
    // 是重建触发源——依赖读取（下方 hitRevealSpans）保证该 field 先更新
    const hitRevealChanged = tr.startState.field(hitRevealField, false) !== tr.state.field(hitRevealField, false)
    // 折叠切换检测（零写回 effect 事务）：头区装饰随折叠态重建
    const fmFoldChanged =
      (tr.startState.field(fmFoldField, false) ?? false) !== (tr.state.field(fmFoldField, false) ?? false)
    if (!tr.docChanged && tr.selection === undefined && !hitRevealChanged && !fmFoldChanged &&
        sameTableRegion(tr.startState.field(tableRegionField, false), tr.state.field(tableRegionField, false))) {
      return value
    }
    if (!tr.docChanged) {
      // 折叠切换：头区行（1..fm 末行）整体重发射——卡片装饰不随选区变，
      // 但随折叠态变；独立于选区/表格路径，组合预览期间不写文档同样生效。
      // 组合冻结态（compositionPreview）刻意随值保留：折叠重建走本分支的
      // 显式发射，不得因此提前解除组合期「装饰冻结」守卫（解除归
      // settled/正常写事务），否则后续组合期选区事务会以陈旧 fmModel 重算
      if (fmFoldChanged) {
        const doc = tr.state.doc
        const fmLast = doc.lineAt(Math.min(value.fm ? value.fm.end : 0, doc.length)).number
        const fmFolded = tr.state.field(fmFoldField, false) ?? false
        const decos = value.decos.update({
          filterFrom: doc.line(1).from,
          filterTo: doc.line(fmLast).to,
          filter: () => false,
          add: emitForRange(value.tree, doc, tr.state.selection, value.fm, 1, fmLast, value.gridPlans,
            value.fmModel, tr.state.field(tableRegionField, false), hitRevealContextOf(tr.state), fmFolded),
          sort: true,
        })
        return {
          ...value,
          decos,
          gridSegments: updateGridSegments(value.gridSegments, tr.changes,
            [{ from: doc.line(1).from, to: doc.line(fmLast).to }], decos, doc),
        }
      }
      if (tr.annotation(tableCompositionSettled)) {
        const doc = tr.state.doc
        const lineNo = doc.lineAt(tr.state.selection.main.head).number
        let oldKey: number | undefined
        let oldPlan: TableGridPlan | null | undefined
        for (const [key, plan] of value.gridPlans) {
          if (plan?.rows.has(lineNo)) { oldKey = key; oldPlan = plan; break }
        }
        if (oldPlan && oldKey !== undefined) {
          const currentLine = doc.line(lineNo)
          const pipe = currentLine.text.indexOf('|')
          const stillRow = pipe >= 0 &&
            chainAt(value.tree, currentLine.from + pipe + 1).some((node) => node.name === 'TableRow')
          // 该行容器前缀（#296）：替换空格参与格判定，坐标零偏移
          const settledPrefix = oldPlan.rows.get(lineNo)?.prefixLen ?? 0
          const settledText = blankContainerPrefix(currentLine.text, settledPrefix)
          if (stillRow && tableRowCellsForColumns(settledText, currentLine.from, oldPlan.columns)) {
            // #142：组合净结果先以当前行的新宽度样本与逐行缓存折叠出新列宽
            // 计划——计划未变（取消或宽度无影响的净结果）保持「仅恢复当前行」
            // 快路径（千行表组合取消不全表扫描的性能契约）；计划变化才落整表
            // 重发射（同表各行内联的 grid 计划必须一致，成本与一次常规键入的
            // 表格重建同阶）。折叠是纯数值归并，不重扫行文本。
            const freshRow = collectColumnSamples([settledText], oldPlan.columns)
            const merged = new Array<number>(oldPlan.columns).fill(0)
            for (const [rowNo, widths] of oldPlan.rowSamples) {
              const row = rowNo === lineNo ? freshRow : widths
              for (let col = 0; col < oldPlan.columns; col++) {
                if (row[col]! > merged[col]!) {
                  merged[col]! = row[col]!
                }
              }
            }
            if (tableGridTemplate(merged) === oldPlan.template) {
              const decos = value.decos.update({
                filterFrom: currentLine.from,
                filterTo: currentLine.to,
                filter: () => false,
                add: emitForRange(value.tree, doc, tr.state.selection, value.fm, lineNo, lineNo, value.gridPlans, value.fmModel,
                  tr.state.field(tableRegionField, false), hitRevealContextOf(tr.state)),
                sort: true,
              })
              return {
                ...value,
                decos,
                gridSegments: updateGridSegments(value.gridSegments, tr.changes,
                  [{ from: currentLine.from, to: currentLine.to }], decos, doc),
                compositionPreview: false,
              }
            }
          }
          let first = oldPlan.delimiterLine
          let last = oldPlan.delimiterLine
          for (const rowNo of oldPlan.rows.keys()) {
            first = Math.min(first, rowNo)
            last = Math.max(last, rowNo)
          }
          const gridPlans = new Map(value.gridPlans)
          gridPlans.delete(oldKey)
          const decos = value.decos.update({
            filterFrom: doc.line(first).from,
            filterTo: doc.line(last).to,
            filter: () => false,
            add: emitForRange(value.tree, doc, tr.state.selection, value.fm, first, last, gridPlans, value.fmModel,
              tr.state.field(tableRegionField, false), hitRevealContextOf(tr.state)),
            sort: true,
          })
          return {
            ...value,
            decos,
            gridPlans,
            gridSegments: updateGridSegments(value.gridSegments, tr.changes,
              [{ from: doc.line(first).from, to: doc.line(last).to }], decos, doc),
            compositionPreview: false,
          }
        }
      }
      if (value.compositionPreview && !tr.annotation(tableCompositionSettled)) return value
      // 纯选区移动：树不变，仅重建旧/新选区所在行的 mark 显形
      const doc = tr.state.doc
      let decos = value.decos
      let scanned = 0
      const rebuilt: Array<{ from: number; to: number }> = []
      for (const span of [...selectionSpans(tr), ...regionSpans(tr, doc), ...hitRevealSpans(tr, doc)]) {
        const from = doc.line(span.fromLine).from
        const to = doc.line(span.toLine).to
        rebuilt.push({ from, to })
        decos = decos.update({
          filterFrom: from,
          filterTo: to,
          filter: () => false,
          add: emitForRange(value.tree, doc, tr.state.selection, value.fm, span.fromLine, span.toLine, value.gridPlans, value.fmModel,
            tr.state.field(tableRegionField, false), hitRevealContextOf(tr.state), tr.state.field(fmFoldField, false) ?? false),
          sort: true,
        })
        scanned += span.toLine - span.fromLine + 1
      }
      stats.totalUpdates += 1
      stats.lastUpdateScannedLines = scanned
      stats.totalScannedLines += scanned
      return {
        ...value,
        decos,
        gridSegments: updateGridSegments(value.gridSegments, tr.changes, rebuilt, decos, doc),
        compositionPreview: false,
      }
    }

    const doc = tr.state.doc
    const changed: ChangedRange4[] = []
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      changed.push({ fromA, toA, fromB, toB })
    })
    const fragments = TreeFragment.applyChanges(value.fragments, changed)
    const tree = parseTree(doc, fragments)
    // fmTouched 精确口径：fm 存在时只认 fm 区间内（含闭边界）的变更
    // （正文击键不重析头区）；fm.end 是闭合行行尾不含换行——删除其后
    // 换行会把闭合行与正文合并（头区失效），fromA === fm.end 须触发
    // 重析；fm 尚未识别时头部 8192 内的变更都要检测（构造头区场景）
    const fmTouched = changed.some((c) => c.fromA <= (value.fm ? value.fm.end : FM_SCAN_LIMIT))
    const fm = fmTouched ? frontmatterOf(doc) : value.fm
    // #140：fmTouched（头部 8192 内的任何变更）时重析成型模型——成型与
    // 降级随编辑实时切换，模型重析成本 = 头区行扫描 + 一次 yaml 解析
    const fmModel = fmTouched ? frontmatterModelOf(doc, fm) : value.fmModel
    if (tr.annotation(tableCompositionPreview)) {
      // 候选文字由 CM6 原生 DOM 管理；只平移网格装饰，避免解析暂态列数
      // 导致整表闪退源码。结束后正常事务或 settled 选区事务重新计算。
      // fmModel 刻意沿用旧值：装饰平移须与模型一致，组合结束再重析。
      return {
        ...value,
        decos: value.decos.map(tr.changes),
        tree,
        fragments: TreeFragment.addTree(tree),
        fm,
        fmModel: value.fmModel,
        gridSegments: mapGridSegments(value.gridSegments, tr.changes),
        compositionPreview: true,
      }
    }
    const spans = [...planRebuildSpans(tr, value.tree, tree, changed, value.fm, fm, fmTouched),
      ...regionSpans(tr, doc), ...hitRevealSpans(tr, doc)]
    const gridPlans = new Map<number, TableGridPlan | null>()
    let decos = value.decos.map(tr.changes)
    let scanned = 0
    const rebuilt: Array<{ from: number; to: number }> = []
    for (const span of spans) {
      const from = doc.line(span.fromLine).from
      const to = doc.line(span.toLine).to
      rebuilt.push({ from, to })
      decos = decos.update({
        filterFrom: from,
        filterTo: to,
        filter: () => false,
        add: emitForRange(tree, doc, tr.state.selection, fm, span.fromLine, span.toLine, gridPlans, fmModel,
          tr.state.field(tableRegionField, false), hitRevealContextOf(tr.state), tr.state.field(fmFoldField, false) ?? false),
        sort: true,
      })
      scanned += span.toLine - span.fromLine + 1
    }
    stats.totalUpdates += 1
    stats.lastUpdateScannedLines = scanned
    stats.totalScannedLines += scanned
    if (scanned >= doc.lines) {
      stats.fullBuildLines = doc.lines
    }
    return {
      decos,
      tree,
      fragments: TreeFragment.addTree(tree),
      fm,
      fmModel,
      gridPlans,
      gridSegments: updateGridSegments(value.gridSegments, tr.changes, rebuilt, decos, doc),
      compositionPreview: false,
    }
  },
  provide: (f) => [
    // #150 格位共存：mark 装饰源经 Prec.low 排到全部 widget 装饰源之后
    // （decorations facet 的输入序即 RangeSet.spans 的 rank 序）。CM6 构建
    // 行 DOM 时，replace widget 只会被 rank 不低于自己的活跃 mark 嵌套
    // （rangeset activeForPoint 以 rank 过滤覆盖 mark）——默认序下本源先于
    // liveLinks/liveMath 注册，格内双链/图片/公式 widget 便裸露成
    // .cm-line（CSS grid 容器）直接子元素，各自多占一个格位，grid 自动
    // 放置把后续单元格顶到多出的行。降序后 widget 连同其 cm-widgetBuffer
    // 测量缓冲嵌套进覆盖它的 grid-cell mark span 内，含 widget 的行与普通
    // 行的行级子元素构成等价（管道 ×3 + 单元格 span ×N），渲染保留且网格
    // 不再错位。事件处理器与 StateField 本体不参与本调整，装配顺序不变。
    Prec.low(EditorView.decorations.from(f, (s) => s.decos)),
    // `<br>` 的四个源字符是一个可见换行。将其设为原子范围，退格时
    // 一次合行，方向键也不会钻进不可见的 <、b、r、> 中间。
    EditorView.atomicRanges.of((view) => {
      const breaks: Array<Range<Decoration>> = []
      for (const visible of view.visibleRanges) {
        view.state.field(f).decos.between(visible.from, visible.to, (from, to, deco) => {
          if (deco.spec.tableCellBreak) breaks.push(deco.range(from, to))
        })
      }
      return Decoration.set(breaks, true)
    }),
  ],
})

// ---- 间接装饰（视口内纯样式） ----

/**
 * 间接装饰构建（纯数据输入：doc/visibleRanges/selection/直接装饰集）：
 * 视口内标题行挂 inview 类，光标所在行另加 active（行背景强调提示，
 * CSS 见 main.css——#55 已移除左缘竖线，类不再单独绘制任何样式）。
 * 标题行身份来自直接装饰集（树驱动），围栏内伪标题天然不参与。
 */
export function buildViewportLiveDecorations(
  doc: Text,
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  selection: EditorSelection,
  direct: DecorationSet,
): DecorationSet {
  const ranges: Array<Range<Decoration>> = []
  for (const range of visibleRanges) {
    direct.between(range.from, range.to, (from, _to, value) => {
      const cls = value.spec['class']
      if (typeof cls !== 'string' || !cls.includes(HEADING_CLASS_NAMES.line) || cls.includes(HEADING_CLASS_NAMES.inview)) {
        return
      }
      const lineNo = doc.lineAt(from).number
      const active = isLineActive(selection, doc, lineNo)
      ranges.push(
        (active ? inviewActiveDeco : inviewDeco).range(doc.line(lineNo).from),
      )
    })
  }
  return RangeSet.of(ranges, true)
}

const inviewDeco = Decoration.line({ class: HEADING_CLASS_NAMES.inview })
const inviewActiveDeco = Decoration.line({
  class: `${HEADING_CLASS_NAMES.inview} ${HEADING_CLASS_NAMES.active}`,
})

/** CSS grid 的留白可能让 CM6 默认点击命中隐藏管道，甚至把中格点击映射
 * 到右格；先按实际点击的格 DOM 约束源位置。mouseup 再核对一次，处理
 * 浏览器默认选区定位晚于 mousedown 的情况，空格也必须可点可编辑。 */
const gridPointerDown = new WeakMap<EditorView, { x: number; y: number }>()

/**
 * #57：把落在安全表格隐藏结构（管道 / 分隔行 / 格间空白）上的选区端点
 * 收缩到最近的可见内容边界；端点已在可见格内容或表外文本上时返回 null。
 * 方向口径（与 tableEditing 的 protectGridPointerSelection 一致，#57 评审
 * B-5 统一）：forward = 该端点是选区的文档序**右端**——收缩取 ≤pos 的
 * 最近边界（不吞入右前方格）；左端（forward=false）取 ≥pos 的最近边界。
 * 两端各自向选区内侧收缩，选区因此可以跨格、跨行与跨进表格，而删除
 * 防护由 tableEditing 的选区级规划承担。
 */
export function snapGridSelectionHead(state: EditorState, pos: number, forward: boolean): number | null {
  const field = state.field(liveDecorationsField, false)
  if (!field) return null
  const line = state.doc.lineAt(pos)
  const table = chainAt(field.tree, Math.min(line.from + 1, state.doc.length))
    .find((node) => node.name === 'Table')
  if (!table) return null
  // 网格行装饰存在即意味着 plan 已缓存（装饰发射与缓存同源）；未缓存视为
  // 非网格表，不干预（视口外调用理论不可达，posAtCoords 只产生可见位置）。
  const plan = field.gridPlans.get(table.from)
  if (!plan) return null
  const columns = plan.columns
  const isDelimiter = line.number === plan.delimiterLine
  const contentEntry = plan.rows.get(line.number)
  const isContent = contentEntry !== undefined
  if (!isDelimiter && !isContent) return null
  // 行解析：前缀替换空格（#296）——坐标零偏移
  const prefixLenOfLine = (lineNo: number): number => plan.rows.get(lineNo)?.prefixLen ?? 0
  const boundariesOf = (lineNo: number): number[] | null => {
    const target = state.doc.line(lineNo)
    const cells = tableRowCellsForColumns(
      blankContainerPrefix(target.text, prefixLenOfLine(lineNo)), target.from, columns)
    return cells ? cells.flatMap((cell) => [cell.contentFrom, cell.contentTo]) : null
  }
  if (isContent) {
    const cells = tableRowCellsForColumns(
      blankContainerPrefix(line.text, contentEntry.prefixLen), line.from, columns)
    if (!cells) return null
    // 格区间（含首尾空白/填充）归属该格：clamp 到内容区间
    for (const cell of cells) {
      if (pos >= cell.from && pos <= cell.to) {
        return cell.contentFrom === cell.contentTo && cell.from < cell.to
          ? cell.from
          : Math.max(cell.contentFrom, Math.min(cell.contentTo, pos))
      }
    }
    // 行首/行间/行尾管道：收缩到本行最近的可见内容边界
    const boundaries = cells.flatMap((cell) => [cell.contentFrom, cell.contentTo])
    if (forward) {
      const before = boundaries.filter((b) => b <= pos)
      if (before.length) return Math.max(...before)
    } else {
      const after = boundaries.filter((b) => b >= pos)
      if (after.length) return Math.min(...after)
    }
  }
  // 分隔行或行首管道之前：跨行取相邻内容行的末/首内容边界
  const numbers = [...plan.rows.keys()].sort((a, b) => a - b)
  if (forward) {
    for (let i = numbers.length - 1; i >= 0; i--) {
      if (numbers[i]! > line.number) continue
      const boundaries = boundariesOf(numbers[i]!)
      const before = boundaries?.filter((b) => b <= pos) ?? []
      if (before.length) return Math.max(...before)
    }
  } else {
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i]! < line.number) continue
      const boundaries = boundariesOf(numbers[i]!)
      const after = boundaries?.filter((b) => b >= pos) ?? []
      if (after.length) return Math.min(...after)
    }
  }
  return null
}

/** 鼠标拖选可跨格延伸（#57）；双击和三击仍只在起始格的内容区间内定位。 */
const gridCellMouseSelection = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return null
  const target = event.target instanceof Element ? event.target : null
  const cell = target?.closest<HTMLElement>('.vsidian-table-grid-row > .vsidian-table-grid-cell')
  const row = cell?.parentElement
  if (!cell || !row) return null
  const cells = [...row.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')]
  const line = view.state.doc.lineAt(view.posAtDOM(row, 0))
  const range = tableRowCellsForColumns(line.text, line.from, cells.length)?.[cells.indexOf(cell)]
  if (!range) return null
  // 空格子的源码填充不属于用户内容。再次点击时落在填充前，避免把
  // 保留的输入节点变成下一次键入文字的前置空格。
  const empty = range.contentFrom === range.contentTo && range.from < range.to
  let from = empty ? range.from : range.contentFrom, to = empty ? range.from : range.contentTo
  // #57：落点在起始格内容上原样使用；越出起始格时收缩到最近的可见
  // 内容边界（隐藏管道 / 分隔行 / 格间空白不作选区端点），表外文本原样。
  const hit = (e: MouseEvent) => {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? from
    if (pos >= from && pos <= to) return pos
    return snapGridSelectionHead(view.state, pos, pos > from) ?? pos
  }
  const start = hit(event)
  const previousAnchor = view.state.selection.main.anchor
  // snap 方向口径（#57 评审 B-5）：forward = 端点是选区的文档序右端
  // （收缩取 ≤pos 的边界、向选区内侧收）；与 tableEditing 的
  // protectGridPointerSelection（anchor<head / head<anchor 判右端）一致。
  // shift+点击时锚点是相对新点击点 start 的另一端：锚点在右侧才传 true。
  let anchor = event.shiftKey
    ? (previousAnchor >= from && previousAnchor <= to ? previousAnchor
      : snapGridSelectionHead(view.state, previousAnchor, previousAnchor > start) ?? previousAnchor)
    : start
  const selection = (head: number) => anchor === head
    ? EditorSelection.create([EditorSelection.cursor(head, empty ? 1 : head === to ? -1 : head === from ? 1 : 0)])
    : EditorSelection.single(anchor, head)
  const word = event.detail === 2 ? view.state.wordAt(start) : null
  let startFrom = event.detail >= 3 ? from : word ? Math.max(from, Math.min(to, word.from)) : start
  let startTo = event.detail >= 3 ? to : word ? Math.max(from, Math.min(to, word.to)) : start
  gridPointerDown.set(view, { x: event.clientX, y: event.clientY })
  return {
    get(current, extend) {
      const end = hit(current)
      if (extend) return selection(end)
      if (event.detail >= 3) return EditorSelection.single(from, to)
      if (word) {
        // 双击的起始词对齐保留；拖动侧按落点收缩（wordAt 的词不跨隐藏管道）
        const currentWord = view.state.wordAt(end)
        return end < startFrom
          ? EditorSelection.single(startTo, currentWord?.from ?? end)
          : EditorSelection.single(startFrom, currentWord?.to ?? end)
      }
      return selection(end)
    },
    update(update) {
      if (!update.docChanged) return
      from = update.changes.mapPos(from, -1)
      to = update.changes.mapPos(to, 1)
      anchor = update.changes.mapPos(anchor)
      startFrom = update.changes.mapPos(startFrom)
      startTo = update.changes.mapPos(startTo)
    },
  }
})

function clampGridCellPointer(event: MouseEvent, view: EditorView): boolean {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  const target = event.target instanceof Element ? event.target : null
  const cell = target?.closest<HTMLElement>('.vsidian-table-grid-row > .vsidian-table-grid-cell')
  if (!cell) return false
  const down = gridPointerDown.get(view)
  gridPointerDown.delete(view)
  if (!down || event.detail > 1 ||
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return false
  const row = cell.parentElement
  if (!row) return false
  const column = [...row.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')].indexOf(cell)
  if (column < 0) return false
  const line = view.state.doc.lineAt(view.posAtDOM(row, 0))
  const range = tableRowCellsForColumns(line.text, line.from,
    row.querySelectorAll(':scope > .vsidian-table-grid-cell').length)?.[column]
  if (!range) return false
  const empty = range.contentFrom === range.contentTo && range.from < range.to
  const from = empty ? range.from : range.contentFrom
  const to = empty ? range.from : range.contentTo
  const hit = view.state.selection.main.head
  if (hit >= from && hit < to) return false
  const pos = hit < from ? from : to
  const assoc = empty ? 1 : pos === to ? -1 : 1
  if (hit === to && view.state.selection.main.assoc === assoc) return false
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(pos, assoc)]) })
  event.preventDefault()
  return true
}

/** 间接装饰 ViewPlugin：仅按 visibleRanges 更新，update 内不触发 DOM 测量 */
const viewportLivePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildViewportLiveDecorations(
        view.state.doc,
        view.visibleRanges,
        view.state.selection,
        view.state.field(liveDecorationsField).decos,
      )
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildViewportLiveDecorations(
          update.state.doc,
          update.view.visibleRanges,
          update.state.selection,
          update.state.field(liveDecorationsField).decos,
        )
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mouseup(event: MouseEvent, view: EditorView) {
        return clampGridCellPointer(event, view)
      },
    },
  },
)

/** Live Preview 装饰装配：直接（StateField）+ 间接（ViewPlugin） */
export const livePreviewDecorations: Extension = [
  // #251 命中显形状态源（依赖 findStateField 的 matches——findDecorations
  // 缺席的裸装配场景由 field 读取容错为空集，行为不变）
  hitRevealField,
  fmFoldField,
  liveDecorationsField,
  gridCellMouseSelection,
  viewportLivePlugin,
]
