// Live 视图 frontmatter 表格卡片装饰（工单 #140，规格
// docs/specs/frontmatter-table.md）。
//
// 架构（照表格网格 #42 + 代码块卡片 #79 的既有模式）：
// - 编辑面即 CM6 源文本行：合法头区（shared/frontmatterTable 的模型）的
//   键 / 值 / 项区间以 mark 装饰映射为两列网格格；冒号分隔与数组 `- `
//   标记以 mark 淡化呈现（源文仍在，光标可入）；网格在光标进入格内
//   后保留——编辑直接发生在源区间，IME、Tab、宿主写回链路全部复用
//   既有管线，无独立输入状态
// - 首尾围栏行：呈现态清空（首行）/替换为「添加属性」按钮（闭合行）；
//   光标触及该行时撤下替换、源码显形可编辑（表格分隔行同款语义）
// - 结构操作（增删键值对 / 数组项）经行尾 widget 按钮触发，编辑计划由
//   shared/frontmatterTable 纯函数给出，事务走标准出站链路
// - 空值格零宽：占位 widget 承接点击定位；首次点击补 `: ` 结构空格
//   （一次文本事务），避免打字即冒号粘连降级
// - 降级（解析失败 / 复杂类型）：本模块零发射，liveDecorations 的
//   frontmatter-line 行类照发（现状源码形态）；成型与降级随编辑实时切换
//
// 装饰实例全部按参数缓存（同类名 / 同行号复用），增量与全量构建产出
// 相同实例，RangeSet.eq 成立。

import type { EditorSelection, Range, Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import {
  planAddFmArrayItem,
  planAddFmEntry,
  planRemoveFmArrayItem,
  planRemoveFmEntry,
  type FmEditPlan,
  type FmTableModel,
} from '../shared/frontmatterTable'
import { t } from '../shared/i18n'
// 循环依赖约定：liveDecorations 装配本模块的构建函数，本模块的 widget
// 运行时读 liveDecorationsField——两端顶层零引用对方导出（live binding
// 运行时解析），模块循环加载安全。frontmatter-line 类名字面量与
// LIVE_CLASS_NAMES.frontmatterLine 同值（liveDecorations 测试钉住不变）。
import { liveDecorationsField, selectionTouchesRange } from './liveDecorations'

/** #140 frontmatter 表格卡片稳定类名（样式契约 chrome 域条目同源） */
export const FM_CARD_CLASS_NAMES = {
  /** 卡片覆盖行（含首尾围栏行与全部键值/项行；卡片底色承载） */
  line: 'vsidian-fm-card-line',
  /** 首围栏行圆角修饰 */
  edgeTop: 'vsidian-fm-card-edge-top',
  /** 闭合围栏行圆角修饰 */
  edgeBottom: 'vsidian-fm-card-edge-bottom',
  /** 键值行（两列网格；CSS 变量 --vsidian-fm-columns=2） */
  row: 'vsidian-fm-row',
  /** 数组项行修饰（key 列为项标记占位） */
  itemRow: 'vsidian-fm-item-row',
  /** 单元格（key/value 修饰见下） */
  cell: 'vsidian-fm-cell',
  /** 键列 */
  key: 'vsidian-fm-key',
  /** 值列 */
  value: 'vsidian-fm-value',
  /** 冒号与结构空格（淡化呈现，不占格位） */
  sep: 'vsidian-fm-sep',
  /** 行内注释（绘制层隐藏，不占格位） */
  comment: 'vsidian-fm-comment',
  /** 独立注释行内容（整行淡化，纳入卡片） */
  commentLine: 'vsidian-fm-comment-line',
  /** 数组项 `- ` 标记（含前导缩进；淡化占位 key 列） */
  itemMark: 'vsidian-fm-item-mark',
  /** 键值对删除按钮（行尾 widget） */
  remove: 'vsidian-fm-remove',
  /** 添加属性按钮（闭合行替换 widget） */
  addEntry: 'vsidian-fm-add-entry',
  /** 添加数组项按钮（末项行尾 widget） */
  addItem: 'vsidian-fm-add-item',
  /** 空值格占位（零宽格承接点击） */
  emptyValue: 'vsidian-fm-empty-value',
} as const

/** 卡片覆盖行的组合类：vsidian 卡片行 + 降级行名（后者经别名桥携带
 *  cm-hmd-frontmatter 原名——#132 direct 级承诺在成型形态下保持命中，
 *  观感副作用 opacity 由 fm-card-line 规则显式重置为 1） */
const FM_CARD_LINE_CLASSES = `${FM_CARD_CLASS_NAMES.line} vsidian-frontmatter-line`

// ---- widget ----

/** 按钮公共拦截：终结 mousedown 防 CM6 落选区进源区间，click 派发计划 */
function armButton(el: HTMLButtonElement, onClick: () => void): void {
  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  el.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
}

/** 当前文档的成型模型（liveDecorationsField 携带；随文档重析） */
function modelOfView(view: EditorView): FmTableModel | null {
  const field = view.state.field(liveDecorationsField, false)
  return field ? field.fmModel : null
}

/** 从 widget DOM 找回编辑器并派发编辑计划（标准出站链路） */
function dispatchFmPlan(el: HTMLElement, plan: FmEditPlan | null): void {
  const view = EditorView.findFromDOM(el)
  if (!view || !plan) {
    return
  }
  view.dispatch({
    changes: plan.changes.map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert })),
    selection: plan.selection
      ? { anchor: plan.selection.anchor, head: plan.selection.head ?? plan.selection.anchor }
      : undefined,
  })
  view.focus()
}

/**
 * 键值对删除按钮（条目行尾「×」，hover 显现）。派发时按宿主行行首
 * 反查条目索引（模型随文档重析，widget 构造时的索引会过期）。
 */
export class FmRemoveEntryButtonWidget extends WidgetType {
  constructor(readonly entryFrom: number) {
    super()
  }
  eq(other: FmRemoveEntryButtonWidget): boolean {
    return other.entryFrom === this.entryFrom
  }
  toDOM(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = FM_CARD_CLASS_NAMES.remove
    btn.textContent = '×'
    const label = t('frontmatter.removeProperty')
    btn.title = label
    btn.setAttribute('aria-label', label)
    armButton(btn, () => {
      const view = EditorView.findFromDOM(btn)
      const model = view ? modelOfView(view) : null
      if (!view || !model) return
      const index = model.entries.findIndex((e) => e.lineFrom === this.entryFrom)
      dispatchFmPlan(btn, index >= 0 ? planRemoveFmEntry(model, index) : null)
    })
    return btn
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** 数组项删除按钮（项行尾「×」） */
export class FmRemoveItemButtonWidget extends WidgetType {
  constructor(readonly entryFrom: number, readonly itemIndex: number) {
    super()
  }
  eq(other: FmRemoveItemButtonWidget): boolean {
    return other.entryFrom === this.entryFrom && other.itemIndex === this.itemIndex
  }
  toDOM(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = FM_CARD_CLASS_NAMES.remove
    btn.textContent = '×'
    const label = t('frontmatter.removeItem')
    btn.title = label
    btn.setAttribute('aria-label', label)
    armButton(btn, () => {
      const view = EditorView.findFromDOM(btn)
      const model = view ? modelOfView(view) : null
      if (!view || !model) return
      const index = model.entries.findIndex((e) => e.lineFrom === this.entryFrom)
      dispatchFmPlan(btn, index >= 0 ? planRemoveFmArrayItem(model, index, this.itemIndex) : null)
    })
    return btn
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** 数组末尾加项按钮（末项行尾「+」；flow 数组不发射） */
export class FmAddItemButtonWidget extends WidgetType {
  constructor(readonly entryFrom: number) {
    super()
  }
  eq(other: FmAddItemButtonWidget): boolean {
    return other.entryFrom === this.entryFrom
  }
  toDOM(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = FM_CARD_CLASS_NAMES.addItem
    btn.textContent = '+'
    const label = t('frontmatter.addItem')
    btn.title = label
    btn.setAttribute('aria-label', label)
    armButton(btn, () => {
      const view = EditorView.findFromDOM(btn)
      const model = view ? modelOfView(view) : null
      if (!view || !model) return
      const index = model.entries.findIndex((e) => e.lineFrom === this.entryFrom)
      dispatchFmPlan(btn, index >= 0 ? planAddFmArrayItem(model, index) : null)
    })
    return btn
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** 「添加属性」按钮（闭合行整行替换 widget）：插入 `key: value` 模板并选中新键 */
export class FmAddEntryButtonWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = FM_CARD_CLASS_NAMES.addEntry
    btn.textContent = t('frontmatter.addProperty')
    armButton(btn, () => {
      const view = EditorView.findFromDOM(btn)
      const model = view ? modelOfView(view) : null
      if (!view || !model) return
      dispatchFmPlan(
        btn,
        planAddFmEntry(model, view.state.doc.sliceString(model.from, model.to)),
      )
    })
    return btn
  }
  ignoreEvent(): boolean {
    return false
  }
}

/**
 * 空值格占位（零宽值格的可点击占位）：点击把光标放到值位置；冒号后
 * 无结构空格时先补一个空格（一次写回），使后续打字不粘连冒号降级。
 * 仅用于标量空值（block 数组宿主的空值格不发射——项编辑走项行与加项按钮）。
 */
export class FmEmptyValueWidget extends WidgetType {
  constructor(readonly valueFrom: number, readonly colonEnd: number) {
    super()
  }
  eq(other: FmEmptyValueWidget): boolean {
    return other.valueFrom === this.valueFrom && other.colonEnd === this.colonEnd
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `${FM_CARD_CLASS_NAMES.cell} ${FM_CARD_CLASS_NAMES.value} ${FM_CARD_CLASS_NAMES.emptyValue}`
    span.setAttribute('aria-label', t('frontmatter.emptyValue'))
    span.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const view = EditorView.findFromDOM(span)
      if (!view) return
      if (this.valueFrom > this.colonEnd) {
        view.dispatch({ selection: { anchor: this.valueFrom }, scrollIntoView: true })
      } else {
        view.dispatch({
          changes: { from: this.colonEnd, insert: ' ' },
          selection: { anchor: this.colonEnd + 1 },
          scrollIntoView: true,
        })
      }
      view.focus()
    })
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

// ---- 装饰实例缓存（增量与全量产出相同实例，RangeSet.eq 前提） ----

const fmHideDeco = Decoration.replace({})

const cellDecos = new Map<string, ReturnType<typeof Decoration.mark>>()
function fmCellDeco(kind: 'key' | 'value'): ReturnType<typeof Decoration.mark> {
  let deco = cellDecos.get(kind)
  if (!deco) {
    deco = Decoration.mark({ class: `${FM_CARD_CLASS_NAMES.cell} ${FM_CARD_CLASS_NAMES[kind]}` })
    cellDecos.set(kind, deco)
  }
  return deco
}

const fmSepDeco = Decoration.mark({ class: FM_CARD_CLASS_NAMES.sep })
const fmCommentDeco = Decoration.mark({ class: FM_CARD_CLASS_NAMES.comment })
const fmItemMarkDeco = Decoration.mark({ class: FM_CARD_CLASS_NAMES.itemMark })
const fmCommentLineDeco = Decoration.mark({ class: FM_CARD_CLASS_NAMES.commentLine })

/** widget 装饰缓存上限（LRU；键含行号，防长会话无界增长） */
const FM_WIDGET_DECO_CACHE_LIMIT = 128
const widgetDecos = new Map<string, Decoration>()

function widgetDeco(key: string, make: () => Decoration): Decoration {
  const hit = widgetDecos.get(key)
  if (hit) {
    widgetDecos.delete(key)
    widgetDecos.set(key, hit)
    return hit
  }
  const deco = make()
  widgetDecos.set(key, deco)
  while (widgetDecos.size > FM_WIDGET_DECO_CACHE_LIMIT) {
    const oldest = widgetDecos.keys().next().value
    if (oldest === undefined) break
    widgetDecos.delete(oldest)
  }
  return deco
}

// ---- 卡片构建（纯数据输入，可单测直驱） ----

/**
 * 卡片行类 + 装饰区间构建：成型头区按模型发射——首尾围栏行行类与呈现态
 * 替换、键值行的网格格 mark 与行尾按钮、数组项行标记与按钮、空值占位。
 * 行类以行号 → 类列表返回，由 liveDecorations 的行装饰机制落地。
 */
export interface FmCardPlan {
  lineClasses: Map<number, string[]>
  ranges: Array<Range<Decoration>>
}

export function buildFrontmatterCardPlan(
  doc: Text,
  model: FmTableModel,
  selection: EditorSelection,
): FmCardPlan {
  const lineClasses = new Map<number, string[]>()
  const addCls = (lineNo: number, ...cls: string[]): void => {
    const list = lineClasses.get(lineNo) ?? []
    list.push(...cls)
    lineClasses.set(lineNo, list)
  }
  const ranges: Array<Range<Decoration>> = []
  const touches = (from: number, to: number): boolean => selectionTouchesRange(selection, from, to)

  // 首围栏行：卡片顶边；呈现态清空行内容（行槽保留）
  const openLine = doc.lineAt(Math.min(model.openFrom, doc.length))
  addCls(openLine.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.edgeTop)
  if (!touches(model.openFrom, model.openTo)) {
    ranges.push(fmHideDeco.range(model.openFrom, model.openTo))
  }

  // 杂项行（独立注释/空行）：纳入卡片背景；注释行内容淡化呈现
  for (const misc of model.miscLines) {
    const line = doc.lineAt(Math.min(misc.from, doc.length))
    addCls(line.number, FM_CARD_LINE_CLASSES)
    if (misc.kind === 'comment' && misc.to > misc.from) {
      ranges.push(fmCommentLineDeco.range(misc.from, misc.to))
    }
  }

  for (const entry of model.entries) {
    const hostLine = doc.lineAt(Math.min(entry.lineFrom, doc.length))
    addCls(hostLine.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.row)
    ranges.push(fmCellDeco('key').range(entry.key.from, entry.key.to))
    if (entry.value.from > entry.key.to) {
      ranges.push(fmSepDeco.range(entry.key.to, entry.value.from))
    }
    if (entry.comment) {
      ranges.push(fmCommentDeco.range(entry.comment.from, entry.comment.to))
    }
    // 宿主行行尾删除按钮（条目级；block 数组删除含全部项行）
    ranges.push(
      widgetDeco(`rmEntry\u0000${entry.lineFrom}`, () =>
        Decoration.widget({ widget: new FmRemoveEntryButtonWidget(entry.lineFrom), side: 1 }),
      ).range(entry.kind === 'array' && entry.form === 'block' ? entry.hostLineTo : entry.lineTo),
    )
    if (entry.kind === 'scalar') {
      if (entry.value.to > entry.value.from) {
        ranges.push(fmCellDeco('value').range(entry.value.from, entry.value.to))
      } else {
        ranges.push(
          widgetDeco(`empty\u0000${entry.value.from}\u0000${entry.colonEnd}`, () =>
            Decoration.widget({
              widget: new FmEmptyValueWidget(entry.value.from, entry.colonEnd),
              side: 1,
            }),
          ).range(entry.value.from),
        )
      }
      continue
    }
    if (entry.form === 'flow') {
      // flow：值整格文本编辑（原文呈现）
      ranges.push(fmCellDeco('value').range(entry.value.from, entry.value.to))
      continue
    }
    // block：项行（前缀标记淡化占 key 列 + 项文本值格 + 行尾按钮）
    for (let j = 0; j < entry.items.length; j++) {
      const item = entry.items[j]!
      const line = doc.lineAt(Math.min(item.lineFrom, doc.length))
      addCls(line.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.row, FM_CARD_CLASS_NAMES.itemRow)
      if (item.item.from > item.lineFrom) {
        ranges.push(fmItemMarkDeco.range(item.lineFrom, item.item.from))
      }
      ranges.push(fmCellDeco('value').range(item.item.from, item.item.to))
      if (item.comment) {
        ranges.push(fmCommentDeco.range(item.comment.from, item.comment.to))
      }
      ranges.push(
        widgetDeco(`rmItem\u0000${entry.lineFrom}\u0000${j}`, () =>
          Decoration.widget({ widget: new FmRemoveItemButtonWidget(entry.lineFrom, j), side: 1 }),
        ).range(item.lineTo),
      )
    }
    if (entry.items.length > 0) {
      const last = entry.items[entry.items.length - 1]!
      ranges.push(
        widgetDeco(`addItem\u0000${entry.lineFrom}`, () =>
          Decoration.widget({ widget: new FmAddItemButtonWidget(entry.lineFrom), side: 1 }),
        ).range(last.lineTo),
      )
    }
  }

  // 闭合围栏行：卡片底边；呈现态替换为「添加属性」按钮
  const closeLine = doc.lineAt(Math.min(model.closeFrom, doc.length))
  addCls(closeLine.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.edgeBottom)
  if (!touches(model.closeFrom, model.closeTo)) {
    ranges.push(
      widgetDeco(`addEntry\u0000${model.closeFrom}`, () =>
        Decoration.replace({ widget: new FmAddEntryButtonWidget() }),
      ).range(model.closeFrom, model.closeTo),
    )
  }

  return { lineClasses, ranges }
}
