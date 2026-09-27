// frontmatter 属性编辑 Popover（工单 #140 Popover 改版，2026-09-27 验收
// 反馈：格内直接编辑观感不佳，改为「只读表格 + 卡片右上角修改按钮 +
// 贴按钮浮层编辑」。
//
// 形态（对齐用户参考图 B）：白色圆角小浮层、明显投影、贴修改按钮下方
// 右对齐；浮层内为结构化编辑行——每个键值对一行（键输入框 + 值输入框 +
// 删除按钮），字符串数组条目展开项行（项输入框 + 删项 + 加项），底部
// 「添加属性」主按钮。
//
// 写回语义（与格内编辑时代的管线承诺一致）：
// - 文本输入即时写回：每个 input 事件经既有计划纯函数（planSetFmKey /
//   planSetFmValue / planSetFmArrayItem）派发单笔 CM6 事务 → 标准出站
//   （一笔键入 = 一笔 edit.request = 宿主撤销一步）
// - 按钮操作单笔写回：删行 / 删项 / 加项 / 新增键值对各为一笔事务
// - 浮层不持有独立编辑状态：文档每次变更后按最新模型全量重建行 DOM，
//   焦点与光标位按行标识还原（外部同步改写头区同样回流刷新）
// - 成型态不暴露源码：浮层派发的事务不带 CM6 选区（键名选中改由浮层
//   内 input 全选承担），光标保持在正文
//
// 焦点管理（参考 diagramPopup 的 prevFocus 模式，非全屏）：打开时焦点
// 入首个键输入框，Esc 与点击浮层外关闭，关闭后焦点返还修改按钮；
// 头区降级（复杂类型/非法语法）时浮层自动关闭——源码形态可编辑。
// 注意不得使用 window.alert（宿主 webview sandbox 无 allow-modals）。

import { EditorView, type EditorView as EditorViewType } from '@codemirror/view'
import {
  planAddFmArrayItem,
  planAddFmEntry,
  planRemoveFmArrayItem,
  planRemoveFmEntry,
  planSetFmArrayItem,
  planSetFmKey,
  planSetFmValue,
  normalizeKey,
  type FmEditPlan,
  type FmTableModel,
} from '../shared/frontmatterTable'
import { t } from '../shared/i18n'
// 循环依赖约定：liveDecorations → frontmatterDecorations → 本模块 →
// liveDecorations（widget 点击运行时读 field），与 frontmatterDecorations
// 的既有循环先例同款——顶层零执行对方代码，live binding 运行时解析。
import { liveDecorationsField } from './liveDecorations'

/** Popover 稳定类名（样式契约 chrome 域 live-fm-popover 条目同源） */
export const FM_POPOVER_CLASS_NAMES = {
  /** 浮层容器 */
  popover: 'vsidian-fm-popover',
  /** 行列表区 */
  rows: 'vsidian-fm-pop-rows',
  /** 单条目容器（data-entry-from 锚定宿主行行首） */
  entry: 'vsidian-fm-pop-entry',
  /** 输入行（主行与项行共用） */
  row: 'vsidian-fm-pop-row',
  /** 数组项行修饰（缩进呈现） */
  itemRow: 'vsidian-fm-pop-item-row',
  /** 文本输入框（键 / 值 / 项共用） */
  input: 'vsidian-fm-pop-input',
  /** 键输入框 */
  key: 'vsidian-fm-pop-key',
  /** 值输入框（标量与 flow 数组） */
  value: 'vsidian-fm-pop-value',
  /** block 数组宿主行值列占位（非输入——值在项里） */
  valuePlaceholder: 'vsidian-fm-pop-value-placeholder',
  /** 数组项输入框 */
  item: 'vsidian-fm-pop-item',
  /** 删除按钮（行 / 项共用） */
  remove: 'vsidian-fm-pop-remove',
  /** 删除按钮确认态（两段式二次确认的武装标记） */
  removeArmed: 'vsidian-fm-pop-remove-armed',
  /** 加项按钮 */
  addItem: 'vsidian-fm-pop-add-item',
  /** 底部操作区 */
  footer: 'vsidian-fm-pop-footer',
  /** 「添加属性」主按钮 */
  add: 'vsidian-fm-pop-add',
  /** 键名非法（空 / 与既有键重复）标记：不写回只标错 */
  invalid: 'vsidian-fm-pop-invalid',
} as const

const REMOVE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2.5 4.5h11"></path><path d="M6.5 2.5h3"></path>' +
  '<path d="M4 4.5l.7 8a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8"></path>' +
  '<path d="M6.5 7.5v4M9.5 7.5v4"></path></svg>'

const ADD_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"></path></svg>'

interface FmPopoverState {
  view: EditorView
  container: HTMLElement
  anchor: HTMLElement
  prevFocus: HTMLElement | null
  cleanups: Array<() => void>
  /** 添加属性后下一轮重建聚焦新条目键框（planAddFmEntry 的选中新键在
   *  浮层语境的等价物）；加项后聚焦新项输入框 */
  /** 焦点接管意图：添加属性（新行总在末尾，取末条目）或对指定条目加项
   *  （entryFrom 锚——加项可发生在任意条目上，重建后按 data-entry-from
   *  定位，不能固定取最后条目） */
  pendingFocus: { kind: 'new-entry' } | { kind: 'new-item'; entryFrom: number } | null
}

let popover: FmPopoverState | null = null

export function isFmPopoverOpen(): boolean {
  return popover !== null
}

/** 当前文档的成型模型（liveDecorationsField 携带；降级 null） */
function modelOfView(view: EditorViewType): FmTableModel | null {
  const field = view.state.field(liveDecorationsField, false)
  return field ? field.fmModel : null
}

/** Popover 派发编辑计划（不带选区、不抢焦点——光标保持在正文） */
function dispatchPlan(view: EditorView, plan: FmEditPlan): void {
  view.dispatch({
    changes: plan.changes.map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert })),
  })
}

/** 行元素 → 当前模型的条目索引（DOM 反映最新模型，data-anchor 反查） */
function entryIndexOf(view: EditorView, el: HTMLElement): { model: FmTableModel; index: number } | null {
  const model = modelOfView(view)
  if (!model) return null
  const entryEl = el.closest<HTMLElement>(`.${FM_POPOVER_CLASS_NAMES.entry}`)
  if (!entryEl) return null
  const anchor = Number(entryEl.dataset.entryFrom)
  const index = model.entries.findIndex((e) => e.lineFrom === anchor)
  return index < 0 ? null : { model, index }
}

// ---- 行构建 ----

function textInput(cls: string, value: string, label: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = `${FM_POPOVER_CLASS_NAMES.input} ${cls}`
  input.value = value
  input.setAttribute('aria-label', label)
  input.spellcheck = false
  return input
}

/** 删除按钮（两段式二次确认）：首次点击进入确认态（图标换「确认删除」
 *  文字、错误色提示），再次点击才执行；2.5s 超时还原图标，浮层全量重建
 *  时按钮随 DOM 重建自然重置。防误删（撤销栈可回但用户未必知道）。 */
function removeButton(label: string, onConfirm: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = FM_POPOVER_CLASS_NAMES.remove
  btn.innerHTML = REMOVE_ICON
  btn.title = label
  btn.setAttribute('aria-label', label)
  const resetArmed = (): void => {
    btn.classList.remove(FM_POPOVER_CLASS_NAMES.removeArmed)
    btn.innerHTML = REMOVE_ICON
    btn.title = label
    btn.setAttribute('aria-label', label)
  }
  let armed = false
  let timer = 0
  btn.addEventListener('click', () => {
    if (armed) {
      window.clearTimeout(timer)
      onConfirm()
      return
    }
    armed = true
    btn.classList.add(FM_POPOVER_CLASS_NAMES.removeArmed)
    const confirmLabel = t('frontmatter.removeConfirm')
    btn.textContent = confirmLabel
    btn.title = confirmLabel
    btn.setAttribute('aria-label', confirmLabel)
    timer = window.setTimeout(() => {
      armed = false
      // 浮层已重建/关闭时按钮已脱树，只剩孤儿定时器，无需还原
      if (btn.isConnected) resetArmed()
    }, 2500)
  })
  return btn
}

function buildRows(p: FmPopoverState, model: FmTableModel): void {
  const view = p.view
  const rows = p.container.querySelector(`.${FM_POPOVER_CLASS_NAMES.rows}`)!
  rows.textContent = ''
  for (const entry of model.entries) {
    const entryEl = document.createElement('div')
    entryEl.className = FM_POPOVER_CLASS_NAMES.entry
    entryEl.dataset.entryFrom = String(entry.lineFrom)

    const mainRow = document.createElement('div')
    mainRow.className = FM_POPOVER_CLASS_NAMES.row
    const keyText = view.state.doc.sliceString(entry.key.from, entry.key.to)
    const keyInput = textInput(FM_POPOVER_CLASS_NAMES.key, keyText, t('frontmatter.keyAriaLabel'))
    keyInput.addEventListener('input', () => {
      const found = entryIndexOf(view, keyInput)
      if (!found) return
      const next = keyInput.value
      const normalized = normalizeKey(next)
      // 空键 / 与其他条目重复（归一后）：不写回，标错提示——写回会使
      // 头区非法整卡降级、浮层被迫关闭；合法范围内键名即时生效
      const duplicate = normalized === '' || found.model.entries.some((e, i) =>
        i !== found.index &&
        normalizeKey(view.state.doc.sliceString(e.key.from, e.key.to)) === normalized)
      keyInput.classList.toggle(FM_POPOVER_CLASS_NAMES.invalid, duplicate)
      if (duplicate) return
      dispatchPlan(view, planSetFmKey(found.model, found.index, next)!)
    })
    mainRow.appendChild(keyInput)

    if (entry.kind === 'scalar') {
      const valueText = entry.value.to > entry.value.from
        ? view.state.doc.sliceString(entry.value.from, entry.value.to)
        : ''
      const valueInput = textInput(FM_POPOVER_CLASS_NAMES.value, valueText, t('frontmatter.valueAriaLabel'))
      valueInput.addEventListener('input', () => {
        const found = entryIndexOf(view, valueInput)
        if (!found) return
        const plan = planSetFmValue(found.model, found.index, valueInput.value)
        if (plan) dispatchPlan(view, plan)
      })
      mainRow.appendChild(valueInput)
    } else if (entry.form === 'flow') {
      // flow 数组：值整框原文编辑（与一期「整格文本编辑」同口径）
      const valueText = view.state.doc.sliceString(entry.value.from, entry.value.to)
      const valueInput = textInput(FM_POPOVER_CLASS_NAMES.value, valueText, t('frontmatter.valueAriaLabel'))
      valueInput.addEventListener('input', () => {
        const found = entryIndexOf(view, valueInput)
        if (!found) return
        const plan = planSetFmValue(found.model, found.index, valueInput.value)
        if (plan) dispatchPlan(view, plan)
      })
      mainRow.appendChild(valueInput)
    } else {
      const placeholder = document.createElement('span')
      placeholder.className = FM_POPOVER_CLASS_NAMES.valuePlaceholder
      placeholder.setAttribute('aria-hidden', 'true')
      mainRow.appendChild(placeholder)
    }

    const removeEntry = removeButton(t('frontmatter.removeProperty'), () => {
      const found = entryIndexOf(view, removeEntry)
      if (!found) return
      const plan = planRemoveFmEntry(found.model, found.index)
      if (plan) dispatchPlan(view, plan)
    })
    mainRow.appendChild(removeEntry)
    entryEl.appendChild(mainRow)

    if (entry.kind === 'array' && entry.form === 'block') {
      entry.items.forEach((item, itemIndex) => {
        const itemRow = document.createElement('div')
        itemRow.className = `${FM_POPOVER_CLASS_NAMES.row} ${FM_POPOVER_CLASS_NAMES.itemRow}`
        const itemText = view.state.doc.sliceString(item.item.from, item.item.to)
        const itemInput = textInput(FM_POPOVER_CLASS_NAMES.item, itemText, t('frontmatter.itemAriaLabel'))
        itemInput.addEventListener('input', () => {
          const found = entryIndexOf(view, itemInput)
          if (!found) return
          const plan = planSetFmArrayItem(found.model, found.index, itemIndex, itemInput.value)
          if (plan) dispatchPlan(view, plan)
        })
        itemRow.appendChild(itemInput)
        const removeItem = removeButton(t('frontmatter.removeItem'), () => {
          const found = entryIndexOf(view, removeItem)
          if (!found) return
          const plan = planRemoveFmArrayItem(found.model, found.index, itemIndex)
          if (plan) dispatchPlan(view, plan)
        })
        itemRow.appendChild(removeItem)
        entryEl.appendChild(itemRow)
      })
    }

    // 加项入口：block 数组与空值标量（planAddFmArrayItem 支持的两形态）
    const canAddItem = entry.kind === 'array'
      ? entry.form === 'block'
      : entry.value.from === entry.value.to
    if (canAddItem) {
      const addItem = document.createElement('button')
      addItem.type = 'button'
      addItem.className = FM_POPOVER_CLASS_NAMES.addItem
      addItem.innerHTML = `${ADD_ICON}<span>${t('frontmatter.addItem')}</span>`
      addItem.addEventListener('click', () => {
        const found = entryIndexOf(view, addItem)
        if (!found) return
        const plan = planAddFmArrayItem(found.model, found.index)
        if (plan) {
          p.pendingFocus = { kind: 'new-item', entryFrom: entry.lineFrom }
          dispatchPlan(view, plan)
        }
      })
      entryEl.appendChild(addItem)
    }

    rows.appendChild(entryEl)
  }
}

function buildContainer(p: FmPopoverState): void {
  const container = document.createElement('div')
  container.className = FM_POPOVER_CLASS_NAMES.popover
  container.setAttribute('role', 'dialog')
  container.setAttribute('aria-label', t('frontmatter.popoverAriaLabel'))
  const rows = document.createElement('div')
  rows.className = FM_POPOVER_CLASS_NAMES.rows
  container.appendChild(rows)
  const footer = document.createElement('div')
  footer.className = FM_POPOVER_CLASS_NAMES.footer
  const add = document.createElement('button')
  add.type = 'button'
  add.className = FM_POPOVER_CLASS_NAMES.add
  add.textContent = t('frontmatter.addProperty')
  add.addEventListener('click', () => {
    const view = p.view
    const model = modelOfView(view)
    if (!model) return
    const plan = planAddFmEntry(model, view.state.doc.sliceString(model.from, model.to))
    if (!plan) return
    p.pendingFocus = { kind: 'new-entry' }
    dispatchPlan(view, plan)
  })
  footer.appendChild(add)
  container.appendChild(footer)
  p.container = container
}

// ---- 焦点还原（全量重建间的光标保持） ----

interface FocusMark {
  entryFrom: number
  role: string
  itemIndex: number
  start: number
  end: number
}

function captureFocus(p: FmPopoverState): FocusMark | 'add' | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !p.container.contains(active)) return null
  if (active.classList.contains(FM_POPOVER_CLASS_NAMES.add)) return 'add'
  const input = active as HTMLInputElement
  if (!(input instanceof HTMLInputElement)) return null
  const entryEl = active.closest<HTMLElement>(`.${FM_POPOVER_CLASS_NAMES.entry}`)
  if (!entryEl) return null
  const role = input.classList.contains(FM_POPOVER_CLASS_NAMES.key)
    ? FM_POPOVER_CLASS_NAMES.key
    : input.classList.contains(FM_POPOVER_CLASS_NAMES.value)
      ? FM_POPOVER_CLASS_NAMES.value
      : input.classList.contains(FM_POPOVER_CLASS_NAMES.item)
        ? FM_POPOVER_CLASS_NAMES.item
        : ''
  if (!role) return null
  let itemIndex = -1
  if (role === FM_POPOVER_CLASS_NAMES.item) {
    const itemInputs = [...entryEl.querySelectorAll<HTMLInputElement>(
      `.${FM_POPOVER_CLASS_NAMES.input}.${FM_POPOVER_CLASS_NAMES.item}`)]
    itemIndex = itemInputs.indexOf(input)
  }
  return {
    entryFrom: Number(entryEl.dataset.entryFrom),
    role,
    itemIndex,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.value.length,
  }
}

function restoreFocus(p: FmPopoverState, mark: FocusMark | 'add' | null): void {
  // 添加属性/加项的焦点接管优先：触发按钮不在标记面内（mark null）时
  // 也要生效——点击按钮本身使 activeElement 为按钮、captureFocus 为 null
  if (p.pendingFocus !== null) {
    const want = p.pendingFocus
    p.pendingFocus = null
    // new-item 按触发加项的条目锚定位（该条目 lineFrom 不因加项改变）；
    // new-entry（添加属性）新行总在末尾，取末条目
    const entryScope = want.kind === 'new-item'
      ? p.container.querySelector<HTMLElement>(
        `.${FM_POPOVER_CLASS_NAMES.entry}[data-entry-from="${want.entryFrom}"]`)
      : [...p.container.querySelectorAll<HTMLElement>(
        `.${FM_POPOVER_CLASS_NAMES.entry}`)].at(-1)
    const target = want.kind === 'new-entry'
      ? entryScope?.querySelector<HTMLInputElement>(
        `.${FM_POPOVER_CLASS_NAMES.input}.${FM_POPOVER_CLASS_NAMES.key}`)
      // 新项插在该条目末尾：取最后一个项输入框（首个是既有项）
      : [...(entryScope?.querySelectorAll<HTMLInputElement>(
        `.${FM_POPOVER_CLASS_NAMES.input}.${FM_POPOVER_CLASS_NAMES.item}`) ?? [])].at(-1)
    if (target) {
      target.focus()
      target.select()
      return
    }
  }
  if (mark === null) return
  if (mark === 'add') {
    p.container.querySelector<HTMLButtonElement>(`.${FM_POPOVER_CLASS_NAMES.add}`)?.focus()
    return
  }
  const entryEl = p.container.querySelector<HTMLElement>(
    `.${FM_POPOVER_CLASS_NAMES.entry}[data-entry-from="${mark.entryFrom}"]`)
  if (!entryEl) return
  const candidates = [...entryEl.querySelectorAll<HTMLInputElement>(
    `.${FM_POPOVER_CLASS_NAMES.input}.${mark.role}`)]
  const target = mark.role === FM_POPOVER_CLASS_NAMES.item ? candidates[mark.itemIndex] : candidates[0]
  if (target) {
    target.focus()
    try {
      target.setSelectionRange(mark.start, mark.end)
    } catch {
      // setSelectionRange 对部分 input 状态可能抛错；焦点还原已足够
    }
  }
}

// ---- 定位（贴修改按钮下方右对齐；放不下翻上方） ----

function positionPopover(p: FmPopoverState): void {
  const rect = p.anchor.getBoundingClientRect()
  const el = p.container
  const width = el.offsetWidth
  const height = el.offsetHeight
  let top = rect.bottom + 6
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6)
  }
  let left = rect.right - width
  if (left < 8) left = 8
  if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width
  el.style.top = `${Math.round(top)}px`
  el.style.left = `${Math.round(left)}px`
}

// ---- 开关与文档回流 ----

function refresh(p: FmPopoverState): void {
  const model = modelOfView(p.view)
  if (!model) {
    // 头区降级（复杂类型 / 非法语法）：浮层失去依据，回源码形态编辑
    closeFmPopover()
    return
  }
  const mark = captureFocus(p)
  buildRows(p, model)
  restoreFocus(p, mark)
  positionPopover(p)
}

/** 文档变更通知（frontmatterEditing 的 updateListener 派发）：浮层打开
 *  期间任何文档变更（自身写回、外部同步）都按最新模型重建 */
export function fmPopoverNotifyDocChanged(view: EditorViewType): void {
  if (popover && popover.view === view) {
    refresh(popover)
  }
}

/** 打开浮层（已开时先关再开，锚点取新按钮） */
export function openFmPopover(view: EditorViewType, anchor: HTMLElement): void {
  closeFmPopover()
  const model = modelOfView(view)
  if (!model) return
  const p: FmPopoverState = {
    view: view as EditorView,
    container: document.createElement('div'),
    anchor,
    // 「打开前焦点」返还目标：body 不是有意义的焦点载体（程序化 click
    // 不产生焦点），此时返还修改按钮本身——真实点击路径 mousedown 已把
    // 焦点落在按钮上，两条路径殊途同归
    prevFocus: document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : anchor,
    cleanups: [],
    pendingFocus: null,
  }
  buildContainer(p)
  document.body.appendChild(p.container)

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeFmPopover()
    }
  }
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof Node && (p.container.contains(target) || p.anchor.contains(target))) {
      return
    }
    closeFmPopover()
  }
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  p.cleanups.push(() => document.removeEventListener('keydown', onKeydown, true))
  p.cleanups.push(() => document.removeEventListener('pointerdown', onPointerDown, true))

  popover = p
  refresh(p)
  // 焦点入浮层：首个键输入框（无条目时落添加按钮）
  const firstKey = p.container.querySelector<HTMLInputElement>(
    `.${FM_POPOVER_CLASS_NAMES.entry} .${FM_POPOVER_CLASS_NAMES.input}.${FM_POPOVER_CLASS_NAMES.key}`)
  ;(firstKey ?? p.container.querySelector<HTMLButtonElement>(`.${FM_POPOVER_CLASS_NAMES.add}`))?.focus()
}

/** 修改按钮的开关切换（再点同按钮 = 关闭） */
export function toggleFmPopover(view: EditorViewType, anchor: HTMLElement): void {
  if (popover && popover.anchor === anchor) {
    closeFmPopover()
    return
  }
  openFmPopover(view, anchor)
}

export function closeFmPopover(): void {
  if (!popover) return
  const p = popover
  popover = null
  for (const cleanup of p.cleanups) {
    cleanup()
  }
  p.container.remove()
  if (p.prevFocus && p.prevFocus.isConnected) {
    p.prevFocus.focus()
  }
}
