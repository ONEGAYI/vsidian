// Live 视图 frontmatter 只读表格卡片装饰（工单 #140 Popover 改版，
// 2026-09-27 验收反馈；规格 docs/specs/frontmatter-table.md）。
//
// 架构（照表格网格 #42 + 代码块卡片 #79 的既有模式）：
// - 成型头区呈现为**只读表格**（键值两列）：键 / 值 / 项区间以 mark 装饰
//   映射为网格格（供样式着色），格不可点击编辑——光标进入头区被
//   frontmatterEditing 的光标引导弹到闭合行后（成型态不暴露源码），
//   编辑收敛到标题栏「修改」按钮的 Popover（frontmatterPopover）
// - 首围栏行：呈现态替换为标题栏（列表图标 + Properties 标题 + 右上角
//   「修改」按钮，对齐用户参考图 A）；闭合围栏行：呈现态清空（卡片底
//   边，不承载任何按钮——旧「添加属性」整行按钮随格内编辑方案退役，
//   现状图「莫名空行/空白」的来源即此行替换按钮与空围栏行的拼装）
// - 结构操作（增删键值对 / 数组项）入口全部在 Popover 内，编辑计划由
//   shared/frontmatterTable 纯函数给出，事务走标准出站链路
// - 折叠（2026-10，与代码块同交互）：标题栏整条热区 + 右上折叠
//   chevron（收起态不发射修改按钮、打开中的 Popover 自动关闭）；live
//   折叠态在 fmFoldField（CM6 视图态，零写回不持久化），收起 = 键值/
//   项/杂项行连同闭合行整块隐藏、首行携 -folded 兼任卡片底边；阅读侧
//   经 decorateReadingFrontmatterCard 注入同款交互（收起 = 表格容器挂
//   -folded 行区隐藏），状态由调用方（syncController）持有
// - 降级（解析失败 / 复杂类型）：本模块零发射，liveDecorations 的
//   frontmatter-line 行类照发（现状源码形态）；成型与降级随编辑实时切换
//
// 装饰实例全部按参数缓存（同类名 / 同行号复用），增量与全量构建产出
// 相同实例，RangeSet.eq 成立。

import type { Range, Text } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { FM_HEADER_ICON_SVG, type FmTableModel } from '../shared/frontmatterTable'
import { t } from '../shared/i18n'
// 循环依赖约定：liveDecorations 装配本模块的构建函数，本模块的 widget
// 运行时调 frontmatterPopover（→ liveDecorations）——两端顶层零引用对方
// 导出（live binding 运行时解析），模块循环加载安全。frontmatter-line
// 类名字面量与 LIVE_CLASS_NAMES.frontmatterLine 同值（liveDecorations
// 测试钉住不变）。
import { closeFmPopover, toggleFmPopover } from './frontmatterPopover'

/** #140 frontmatter 表格卡片稳定类名（样式契约 chrome 域条目同源） */
export const FM_CARD_CLASS_NAMES = {
  /** 卡片覆盖行（含首尾围栏行与全部键值/项行；卡片底色承载） */
  line: 'vsidian-fm-card-line',
  /** 首围栏行圆角修饰 */
  edgeTop: 'vsidian-fm-card-edge-top',
  /** 闭合围栏行圆角修饰 */
  edgeBottom: 'vsidian-fm-card-edge-bottom',
  /** 键值行（两列网格） */
  row: 'vsidian-fm-row',
  /** 数组宿主行修饰（键名类型图标取列表形；标量行默认 T 形） */
  listRow: 'vsidian-fm-list-row',
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
  /** 标题栏（首围栏行 replace widget：图标 + Properties 标题 + 修改按钮） */
  header: 'vsidian-fm-header',
  /** 标题栏列表图标 */
  headerIcon: 'vsidian-fm-header-icon',
  /** 标题栏标题文字 */
  headerTitle: 'vsidian-fm-header-title',
  /** 「修改」按钮（标题栏右端；打开 Popover） */
  edit: 'vsidian-fm-edit',
  /** 折叠 chevron（与代码块折叠同交互：整卡头部热区 + 右上折叠钮） */
  fold: 'vsidian-fm-fold',
  /** 收起态修饰（chevron 转向） */
  foldCollapsed: 'vsidian-fm-fold-collapsed',
  /** live 收起态首行修饰（标题栏行兼任卡片底边：补底边框与圆角） */
  cardFolded: 'vsidian-fm-card-folded',
  /** 阅读收起态表格修饰（行区整体隐藏，表壳边框圆角保留） */
  tableFolded: 'vsidian-fm-folded',
} as const

// ---- 折叠状态（与代码块 codeCardFoldField 同语义）----

/**
 * 折叠切换 effect（零写回）：标题栏热区或折叠 chevron 点击 → 携带本
 * effect 的事务由 fmFoldField 消费。不落文档、不产生撤销历史。
 */
export const fmFoldToggle = StateEffect.define<null>()

/**
 * 折叠状态（视图态，不写源文件、不跨会话持久化，重开文档全展开）：
 * frontmatter 单块且恒在文档首，布尔承载即可（代码块按围栏起点存集合
 * 是多块场景）。头区降级瞬间收起态无消费面（模型为 null 零发射），
 * 恢复成型后收起态自然复现。
 */
export const fmFoldField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const eff of tr.effects) {
      if (eff.is(fmFoldToggle)) {
        return !value
      }
    }
    return value
  },
})

/** 卡片覆盖行的组合类：vsidian 卡片行 + 降级行名（后者经别名桥携带
 *  cm-hmd-frontmatter 原名——#132 direct 级承诺在成型形态下保持命中，
 *  观感副作用 opacity 由 fm-card-line 规则显式重置为 1） */
const FM_CARD_LINE_CLASSES = `${FM_CARD_CLASS_NAMES.line} vsidian-frontmatter-line`

/** 「修改」按钮铅笔图标（参考图 A 右上角按钮形态） */
const EDIT_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M11.3 2.7l2 2L6 12l-2.6.6L4 10z"></path></svg>'

/** 折叠 chevron 图标（与代码卡 vsidian-code-card-fold 同形） */
const FOLD_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>'

// ---- widget ----

/** 按钮公共拦截：终结 mousedown 防 CM6 落选区进头区，click 派发动作 */
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

/**
 * 折叠 chevron（与代码卡 buildFoldButton 同形态）：两态常驻（收起态
 * 转向 -90°）；点击经回调执行（live 派发零写回折叠切换 effect、阅读由
 * 调用方翻转持有态并重装饰）。文案取 frontmatter.* 键（属性域措辞）。
 */
export function buildFmFoldButton(folded: boolean, onToggle: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = folded
    ? `${FM_CARD_CLASS_NAMES.fold} ${FM_CARD_CLASS_NAMES.foldCollapsed}`
    : FM_CARD_CLASS_NAMES.fold
  const label = folded ? t('frontmatter.expand') : t('frontmatter.collapse')
  btn.setAttribute('aria-label', label)
  btn.setAttribute('aria-expanded', folded ? 'false' : 'true')
  btn.setAttribute('data-tooltip', label)

  btn.innerHTML = FOLD_ICON_SVG
  armButton(btn, onToggle)
  return btn
}

/**
 * 标题栏 widget（首围栏行整行替换）：列表图标 + Properties 标题 +
 * 右上角「修改」按钮（点击开关属性编辑 Popover，贴按钮定位）+ 折叠
 * chevron（与代码块同交互：整条标题栏为折叠热区，排除按钮本身）。
 * 收起态不渲染修改按钮（编辑入口随表格一起让位，与代码卡收起态不
 * 发射复制钮同口径），仅留折叠钮。
 */
export class FmCardHeaderWidget extends WidgetType {
  constructor(readonly folded: boolean) {
    super()
  }
  eq(other: FmCardHeaderWidget): boolean {
    return other.folded === this.folded
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = FM_CARD_CLASS_NAMES.header
    const icon = document.createElement('span')
    icon.className = FM_CARD_CLASS_NAMES.headerIcon
    icon.innerHTML = FM_HEADER_ICON_SVG
    icon.setAttribute('aria-hidden', 'true')
    wrap.appendChild(icon)
    const title = document.createElement('span')
    title.className = FM_CARD_CLASS_NAMES.headerTitle
    title.textContent = t('frontmatter.title')
    wrap.appendChild(title)
    // 折叠切换闭包：按钮与整条热区共用同一入口；折叠时收起打开中的
    // Popover（编辑对象已随表格隐藏）
    const toggleFold = () => {
      closeFmPopover()
      const view = EditorView.findFromDOM(wrap)
      if (!view) return
      view.dispatch({ effects: fmFoldToggle.of(null) })
    }
    if (!this.folded) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = FM_CARD_CLASS_NAMES.edit
      btn.innerHTML = EDIT_ICON_SVG
      const label = t('frontmatter.edit')
      btn.setAttribute('data-tooltip', label)

      btn.setAttribute('aria-label', label)
      armButton(btn, () => {
        // findFromDOM 只认携带 cmTile 的节点（本版本 CM6 的 Tile.get 语义，
        // liveCodeCard 同款口径）：按钮是标题栏 widget 的深层叶子无标记，
        // 须从 widget 根（toDOM 返回值）查找视图
        const view = EditorView.findFromDOM(wrap)
        if (!view) return
        toggleFmPopover(view, btn)
      })
      wrap.appendChild(btn)
    }
    wrap.appendChild(buildFmFoldButton(this.folded, toggleFold))
    // 整条折叠热区：标题栏整体可点击切换折叠，排除按钮本身（按钮自身
    // mousedown/click 已 stopPropagation，不会走到这里）；mousedown 阻断
    // CM6 点击落位进头区（光标引导兜底之外先不产生落点）
    const onButtonTarget = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('button') !== null
    wrap.addEventListener('mousedown', (event) => {
      if (onButtonTarget(event.target)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    })
    wrap.addEventListener('click', (event) => {
      if (onButtonTarget(event.target)) {
        return
      }
      toggleFold()
    })
    return wrap
  }
  ignoreEvent(): boolean {
    return false
  }
}

// ---- 装饰实例缓存（增量与全量产出相同实例，RangeSet.eq 前提） ----

const fmHideDeco = Decoration.replace({})

const fmHeaderDecos = new Map<boolean, ReturnType<typeof Decoration.replace>>()
function fmHeaderDeco(folded: boolean): ReturnType<typeof Decoration.replace> {
  let deco = fmHeaderDecos.get(folded)
  if (!deco) {
    deco = Decoration.replace({ widget: new FmCardHeaderWidget(folded) })
    fmHeaderDecos.set(folded, deco)
  }
  return deco
}

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

// ---- 卡片构建（纯数据输入，可单测直驱） ----

/**
 * 卡片行类 + 装饰区间构建：成型头区按模型发射——首围栏行替换为标题栏、
 * 闭合围栏行清空、键值行的网格格 mark、数组项行标记。卡片**常驻呈现、
 * 不随光标位置变化**（光标引导由 frontmatterEditing 负责），行类以行号
 * → 类列表返回，由 liveDecorations 的行装饰机制落地。
 */
export interface FmCardPlan {
  lineClasses: Map<number, string[]>
  ranges: Array<Range<Decoration>>
}

export function buildFrontmatterCardPlan(doc: Text, model: FmTableModel, folded = false): FmCardPlan {
  const lineClasses = new Map<number, string[]>()
  const addCls = (lineNo: number, ...cls: string[]): void => {
    const list = lineClasses.get(lineNo) ?? []
    list.push(...cls)
    lineClasses.set(lineNo, list)
  }
  const ranges: Array<Range<Decoration>> = []

  // 首围栏行：卡片顶边；呈现态替换为标题栏（图标 + Properties + 修改/折叠按钮）
  const openLine = doc.lineAt(Math.min(model.openFrom, doc.length))
  addCls(openLine.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.edgeTop)
  ranges.push(fmHeaderDeco(folded).range(model.openFrom, model.openTo))

  // 折叠收起（与代码块同语义）：标题栏行兼任卡片底边（cardFolded 补底
  // 边框与圆角），键值/项/杂项行连同闭合行整块收起——隐藏区从首行换行
  // 之后到闭合行行尾含换行（标题栏独占一行，正文紧随其后），行类与格
  // 装饰均不再发射
  if (folded) {
    const closeLine = doc.lineAt(Math.min(model.closeFrom, doc.length))
    addCls(openLine.number, FM_CARD_CLASS_NAMES.cardFolded)
    ranges.push(fmHideDeco.range(openLine.to + 1, Math.min(closeLine.to + 1, doc.length)))
    return { lineClasses, ranges }
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
    // 数组宿主行（block 与 flow 同）：键名类型图标取列表形
    if (entry.kind !== 'scalar') {
      addCls(hostLine.number, FM_CARD_CLASS_NAMES.listRow)
    }
    ranges.push(fmCellDeco('key').range(entry.key.from, entry.key.to))
    if (entry.value.from > entry.key.to) {
      ranges.push(fmSepDeco.range(entry.key.to, entry.value.from))
    }
    if (entry.comment) {
      ranges.push(fmCommentDeco.range(entry.comment.from, entry.comment.to))
    }
    if (entry.kind === 'scalar') {
      if (entry.value.to > entry.value.from) {
        ranges.push(fmCellDeco('value').range(entry.value.from, entry.value.to))
      }
      continue
    }
    if (entry.form === 'flow') {
      ranges.push(fmCellDeco('value').range(entry.value.from, entry.value.to))
      continue
    }
    // block：项行（前缀标记淡化占 key 列 + 项文本值格）
    for (const item of entry.items) {
      const line = doc.lineAt(Math.min(item.lineFrom, doc.length))
      addCls(line.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.row, FM_CARD_CLASS_NAMES.itemRow)
      if (item.item.from > item.lineFrom) {
        ranges.push(fmItemMarkDeco.range(item.lineFrom, item.item.from))
      }
      ranges.push(fmCellDeco('value').range(item.item.from, item.item.to))
      if (item.comment) {
        ranges.push(fmCommentDeco.range(item.comment.from, item.comment.to))
      }
    }
  }

  // 闭合围栏行：卡片底边；呈现态清空行内容（行槽保留，不放任何控件）
  const closeLine = doc.lineAt(Math.min(model.closeFrom, doc.length))
  addCls(closeLine.number, FM_CARD_LINE_CLASSES, FM_CARD_CLASS_NAMES.edgeBottom)
  ranges.push(fmHideDeco.range(model.closeFrom, model.closeTo))

  return { lineClasses, ranges }
}

// ---- 阅读侧折叠装饰（与 decorateReadingCodeCard 同模式）----

export interface ReadingFmFoldOptions {
  /** 当前收起态（视图态由调用方持有） */
  folded: boolean
  /** 折叠切换回调（按钮与标题栏热区共用入口） */
  onFoldToggle: () => void
}

/**
 * 增强阅读 frontmatter 块的折叠交互（幂等）：标题栏追加折叠 chevron、
 * 整条标题栏挂热区（排除按钮）；收起态给表格容器挂 tableFolded 类
 * （行区整体隐藏，表壳边框圆角保留——CSS 承担）。块卸载随 DOM 丢弃，
 * 重挂载由调用方按持有态重新装饰。缺表格或缺标题栏（降级源码块）时
 * 安全不作为。
 */
export function decorateReadingFrontmatterCard(block: HTMLElement, opts: ReadingFmFoldOptions): void {
  const table = block.querySelector<HTMLElement>('.vsidian-fm-table')
  const header = table?.querySelector<HTMLElement>(`.${FM_CARD_CLASS_NAMES.header}`) ?? null
  if (!table || !header) {
    return
  }
  table.classList.toggle(FM_CARD_CLASS_NAMES.tableFolded, opts.folded)
  // 幂等重装饰：旧按钮移除重建（两态 chevron 类与文案随态变化）
  header.querySelector(`button.${FM_CARD_CLASS_NAMES.fold}`)?.remove()
  header.appendChild(buildFmFoldButton(opts.folded, opts.onFoldToggle))
  // 热区：标题栏整体可点击切换，排除按钮（按钮 click 已 stopPropagation）；
  // onclick 属性赋值覆盖旧处理器，重装饰不叠加监听。阅读侧无 CM6，无需
  // 拦 mousedown
  header.onclick = (event) => {
    if (event.target instanceof Element && event.target.closest('button') !== null) {
      return
    }
    opts.onFoldToggle()
  }
}
