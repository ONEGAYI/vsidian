// #474 积木式查询构造器（输入行为管理页搜索区）——三类积木（字段/逻辑/
// 状态）的可视化组合编辑器。事实源：docs/specs/behavior-manage-pagination.md
// 设计树 D4–D9、ADR-0015。
//
// 分工（ADR-0015「求值与持久解耦」）：本组件只做**编辑**——查询树的
// 增删/移动/嵌套与选中态；求值与序列化是 shared/behaviorFilterQuery 纯
// 函数，本组件不实现。查询树权威在组件内（query 字段），变化经 onChange
// 通知分节（持久 + 列表过滤重渲染由分节负责）。
//
// 交互契约（D8）：
// - 选中态 = 积木及其全部嵌套整体发光（明示删除范围）；单击积木选中，
//   单击容器空白取消。
// - 键盘：Tab 可达全部积木与控件；Enter 拾取（浅色高亮）→ 方向键在可放
//   缺口间移动深色高亮 → Enter 放下；Esc 取消；Delete 删除选中（垃圾桶
//   的键盘等价）。字段文本就地输入（input 事件实时上抛过滤）。
// - 拖拽：积木可拖入任意空缺口或查询区**顶层任意位置**（含重排）；嵌套
//   内容可拖出抢救；拖到垃圾桶删除。放置原子性 = 先从原位移除再放入目标
//   （拖到无效区不落，树不动即回原位）。
// - 加号下拉三组（D4）：字段四项 / 逻辑三项 / 状态一项，新块入顶层末尾；
//   总数 ≥ 16 加号禁用 + tooltip 说明（D9）。
// - 垃圾桶三用法（D4）：无选中单击 = 清空整个查询（经 onClearAll 给分节
//   弹可撤销 toast）；有选中单击 = 删除选中积木及嵌套；拖拽放入 = 删除
//   该积木及嵌套。
//
// 渲染策略：**结构变化**（增删移动）才重建积木流；**状态变化**（选中/
// 键盘高亮/拖放高亮）只 toggle 类——焦点与输入现场不因高亮更新而丢失。
// 分节重渲染列表时经 ensureRendered() 复用同一根节点（appendChild 移动
// 节点不重建，焦点保持）。
import { t } from '../shared/i18n'
import {
  BEHAVIOR_QUERY_BLOCKS_LIMIT,
  countBehaviorQueryBlocks,
  type BehaviorQueryBlock,
  type BehaviorQueryFieldId,
  type BehaviorQueryFilter,
  type BehaviorQueryStatusId,
} from '../shared/behaviorFilterQuery'

/** 积木路径：从顶层块起的索引序列（[顶层块下标, 槽下标, …]；顶层块路径
 *  长度 1） */
type BehaviorBlockPath = readonly number[]

/** 可变树视图（编辑操作域）：与 BehaviorQueryBlock 同型但 children 可写——
 *  深拷贝草稿上的就地修改需要；结构协变，可直接装配回 BehaviorQueryFilter */
type MutableBehaviorBlock =
  | { kind: 'field'; field: BehaviorQueryFieldId; text: string }
  | { kind: 'logic'; op: 'and' | 'or' | 'not'; children: (MutableBehaviorBlock | null)[] }
  | { kind: 'status'; status: BehaviorQueryStatusId }

/** 槽位（放置目标）：父块路径 + 槽下标（parentPath 为空数组 = 顶层位，
 *  仅拖拽顶层重排使用；键盘目标只含缺口槽） */
interface BehaviorSlotTarget {
  readonly parentPath: readonly number[]
  readonly slotIndex: number
}

export interface BehaviorQueryBuilderOptions {
  /** 查询树变化（含文本输入实时过滤）；分节负责持久与列表重渲染 */
  onChange(query: BehaviorQueryFilter): void
  /** 垃圾桶「无选中单击清空整个查询」（onChange 亦随后触发；携带**清空前**
   *  的查询树——分节在此弹可撤销 toast，D15 的气泡撤销机制） */
  onClearAll?(previousQuery: BehaviorQueryFilter): void
}

/** 深拷贝查询树为可变草稿（积木 ≤ 16 节点，成本可忽略；换取不可变更新的
 *  简单性——草稿就地改，装配回只读形态返回） */
function cloneQuery(query: BehaviorQueryFilter): { blocks: MutableBehaviorBlock[] } {
  return { blocks: JSON.parse(JSON.stringify(query.blocks)) as MutableBehaviorBlock[] }
}

function getBlockAt(blocks: readonly MutableBehaviorBlock[], path: BehaviorBlockPath): MutableBehaviorBlock | null {
  let current: MutableBehaviorBlock | null = blocks[path[0]] ?? null
  for (let i = 1; current !== null && i < path.length; i++) {
    current = current.kind === 'logic' ? current.children[path[i]!] ?? null : null
  }
  return current
}

/** remove 顶层块 r 后修正路径：顶层下标 >r 的减一；嵌套 remove（槽置空）
 * 不影响任何其他路径 */
function adjustPathAfterRemoval(path: readonly number[], removed: BehaviorBlockPath): BehaviorBlockPath {
  if (removed.length !== 1 || path.length === 0) {
    return path
  }
  const [r] = removed
  return path[0]! > r ? [path[0]! - 1, ...path.slice(1)] : path
}

/** 删除路径上的积木：嵌套位置 → 槽置 null；顶层 → splice。返回新树与被
 *  删块（可变视图——草稿对象，供放置复用）；路径失效（树被并发改动）时
 *  返回 removed: null，调用方放弃后续放置（不拿错块冒充，评审 F3） */
function removeBlockAt(query: BehaviorQueryFilter, path: BehaviorBlockPath): { query: BehaviorQueryFilter; removed: MutableBehaviorBlock | null } {
  const draft = cloneQuery(query)
  const removed = getBlockAt(draft.blocks, path)
  if (removed === null) {
    return { query, removed: null }
  }
  if (path.length === 1) {
    draft.blocks.splice(path[0]!, 1)
  } else {
    const parent = getBlockAt(draft.blocks, path.slice(0, -1))
    if (parent !== null && parent.kind === 'logic') {
      parent.children[path[path.length - 1]!] = null
    }
  }
  return { query: { version: 1, blocks: draft.blocks }, removed }
}

/** 放入空缺口槽（占用即失败）；parentPath 为空 = 顶层位插入（拖拽重排） */
function insertBlockAt(
  query: BehaviorQueryFilter,
  target: BehaviorSlotTarget,
  block: MutableBehaviorBlock,
): BehaviorQueryFilter | null {
  const draft = cloneQuery(query)
  if (target.parentPath.length === 0) {
    draft.blocks.splice(Math.min(target.slotIndex, draft.blocks.length), 0, block)
    return { version: 1, blocks: draft.blocks }
  }
  const parent = getBlockAt(draft.blocks, target.parentPath)
  if (parent === null || parent.kind !== 'logic') {
    return null
  }
  if (parent.children[target.slotIndex] !== null && parent.children[target.slotIndex] !== undefined) {
    return null
  }
  parent.children[target.slotIndex] = block
  return { version: 1, blocks: draft.blocks }
}

/** path 是否为 ancestor 自身或其后代（移动放置的自嵌套防护） */
function isPathWithin(path: BehaviorBlockPath, ancestor: BehaviorBlockPath): boolean {
  return path.length >= ancestor.length && ancestor.every((segment, i) => segment === path[i])
}

/** 全部空缺口槽（文档序 DFS；键盘放置目标集） */
function emptySlotsOf(query: BehaviorQueryFilter): BehaviorSlotTarget[] {
  const slots: BehaviorSlotTarget[] = []
  const walk = (path: BehaviorBlockPath, block: BehaviorQueryBlock): void => {
    if (block.kind !== 'logic') {
      return
    }
    block.children.forEach((child, slotIndex) => {
      if (child === null) {
        slots.push({ parentPath: path, slotIndex })
      } else {
        walk([...path, slotIndex], child)
      }
    })
  }
  query.blocks.forEach((block, index) => walk([index], block))
  return slots
}

const FIELD_IDS: readonly { id: BehaviorQueryFieldId; labelKey: string }[] = [
  { id: 'behaviorName', labelKey: 'addons.behaviorQueryField.behaviorName' },
  { id: 'addonName', labelKey: 'addons.behaviorQueryField.addonName' },
  { id: 'behaviorId', labelKey: 'addons.behaviorQueryField.behaviorId' },
  { id: 'addonId', labelKey: 'addons.behaviorQueryField.addonId' },
]
const STATUS_IDS: readonly { id: BehaviorQueryStatusId; labelKey: string }[] = [
  { id: 'enabled', labelKey: 'addons.behaviorQueryStatus.enabled' },
  { id: 'disabled', labelKey: 'addons.behaviorQueryStatus.disabled' },
  { id: 'addonDisabled', labelKey: 'addons.behaviorQueryStatus.addonDisabled' },
  { id: 'errorPaused', labelKey: 'addons.behaviorQueryStatus.errorPaused' },
]

const pathToString = (path: readonly number[]): string => path.join('.')
const pathOfString = (value: string): BehaviorBlockPath =>
  value.length === 0 ? [] : value.split('.').map((segment) => Number.parseInt(segment, 10))

/** 加号下拉新建的积木初值：字段空文本 / 逻辑空槽 / 状态默认已启用（D6）。
 *  返回可变视图（构造字面量；可协变装配回只读形态） */
export function newQueryBlock(kind: 'field' | 'and' | 'or' | 'not' | 'status'): MutableBehaviorBlock {
  switch (kind) {
    case 'field': return { kind: 'field', field: 'behaviorName', text: '' }
    case 'and': return { kind: 'logic', op: 'and', children: [null, null] }
    case 'or': return { kind: 'logic', op: 'or', children: [null, null] }
    case 'not': return { kind: 'logic', op: 'not', children: [null] }
    case 'status': return { kind: 'status', status: 'enabled' }
  }
}

export class BehaviorQueryBuilder {
  private query: BehaviorQueryFilter = { version: 1, blocks: [] }
  private readonly root: HTMLElement
  private readonly blockFlow: HTMLElement
  private readonly addButton: HTMLButtonElement
  private readonly addWrap: HTMLElement
  private readonly trashButton: HTMLButtonElement
  private menu: HTMLElement | undefined
  /** 选中积木路径（发光明示删除范围；null = 无选中） */
  private selectedPath: BehaviorBlockPath | null = null
  /** 键盘拾取中的积木路径（浅色高亮） */
  private carryPath: BehaviorBlockPath | null = null
  /** 键盘目标缺口在空槽列表中的下标（深色高亮；null = 未选） */
  private carrySlotIndex: number | null = null
  private readonly closeMenuOnDocClick = (event: Event): void => {
    if (this.menu !== undefined && !this.menu.contains(event.target as Node)) {
      this.closeMenu()
    }
  }

  constructor(private readonly options: BehaviorQueryBuilderOptions) {
    this.root = document.createElement('div')
    this.root.className = 'vsidian-behavior-query'
    this.root.setAttribute('role', 'group')
    this.root.setAttribute('aria-label', t('addons.behaviorQueryAria'))
    // 单击容器空白（积木与控件之外）取消选中（D8 选中态语义）
    this.root.addEventListener('click', (event) => {
      if (!(event.target as HTMLElement).closest('.vsidian-bq-block, button, input, select')) {
        this.setSelected(null)
      }
    })
    this.blockFlow = document.createElement('div')
    this.blockFlow.className = 'vsidian-behavior-query-flow'
    this.root.append(this.blockFlow)
    this.addButton = document.createElement('button')
    this.addButton.type = 'button'
    this.addButton.className = 'vsidian-behavior-query-add'
    this.addButton.textContent = '+'
    this.addButton.setAttribute('aria-haspopup', 'menu')
    this.addButton.addEventListener('click', () => this.toggleMenu())
    // tooltip 挂非禁用包裹（评审 F1）：disabled 表单控件不派发鼠标事件，
    // document 级 tooltip 委托在按钮本体上收不到悬停——包裹 span 恒可命中
    this.addWrap = document.createElement('span')
    this.addWrap.className = 'vsidian-behavior-query-add-wrap'
    this.addWrap.append(this.addButton)
    this.trashButton = document.createElement('button')
    this.trashButton.type = 'button'
    this.trashButton.className = 'vsidian-behavior-query-trash'
    this.trashButton.textContent = '🗑'
    this.trashButton.setAttribute('aria-label', t('addons.behaviorQueryTrashAria'))
    this.trashButton.dataset.tooltip = t('addons.behaviorQueryTrashTooltip')
    this.trashButton.addEventListener('click', () => {
      if (this.selectedPath !== null) {
        this.removeBlock(this.selectedPath)
      } else if (this.query.blocks.length > 0) {
        const previous = this.query
        this.updateQuery({ version: 1, blocks: [] })
        this.options.onClearAll?.(previous)
      }
    })
    // 拖拽删除（垃圾桶三用法之三）：dragover 放行 + drop 取拖拽路径删除
    this.trashButton.addEventListener('dragover', (event) => {
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
      this.trashButton.classList.add('vsidian-behavior-query-trash--armed')
    })
    this.trashButton.addEventListener('dragleave', () => {
      this.trashButton.classList.remove('vsidian-behavior-query-trash--armed')
    })
    this.trashButton.addEventListener('drop', (event) => {
      event.preventDefault()
      this.trashButton.classList.remove('vsidian-behavior-query-trash--armed')
      const path = this.dragPathOf(event)
      if (path !== null) {
        this.removeBlock(path)
      }
    })
    this.root.append(this.addWrap, this.trashButton)
    this.rebuild()
  }

  /** 分节渲染时复用同一根节点（移动不重建——焦点与输入现场保持） */
  ensureRendered(): HTMLElement {
    return this.root
  }

  /** 当前查询树（分节持久与求值用） */
  getQuery(): BehaviorQueryFilter {
    return this.query
  }

  /** 外部设置查询树（跨重启恢复 / 会话恢复 / D15 定位清空）——结构变化走
   *  全量重建，选中与键盘拾取态复位 */
  setQuery(query: BehaviorQueryFilter): void {
    this.query = query
    this.selectedPath = null
    this.cancelCarry()
    this.closeMenu()
    this.rebuild()
  }

  // ---- 结构操作（增删移，全部经 updateQuery 上抛） ----

  private updateQuery(next: BehaviorQueryFilter): void {
    this.query = next
    this.selectedPath = null
    this.cancelCarry()
    this.rebuild()
    this.options.onChange(this.query)
  }

  private removeBlock(path: BehaviorBlockPath): void {
    const { query } = removeBlockAt(this.query, path)
    this.updateQuery(query)
  }

  /** 加号新建入顶层末尾（D4；嵌套与重排经拖拽/键盘） */
  addTopLevelBlock(block: MutableBehaviorBlock): void {
    if (countBehaviorQueryBlocks(this.query) >= BEHAVIOR_QUERY_BLOCKS_LIMIT) {
      return
    }
    const draft = cloneQuery(this.query)
    draft.blocks.push(block)
    this.updateQuery({ version: 1, blocks: draft.blocks })
  }

  /** 移动（拖拽/键盘放置的公共路径）：先移除再放入目标槽/顶层位；任何一步
   *  失败（占用/自嵌套）回退不落。removeBlockAt 拿走块后按修正路径插入
   *  （顶层块 remove 使后续顶层下标前移，槽路径与顶层插入位都按此修正）。 */
  private moveBlock(from: BehaviorBlockPath, target: BehaviorSlotTarget): void {
    if (isPathWithin(target.parentPath, from)) {
      return // 自嵌套（放进自己或后代）拒绝
    }
    const { query: without, removed } = removeBlockAt(this.query, from)
    if (removed === null) {
      return // 拖拽路径已失效（树被并发改动）：放弃放置，树保持现状
    }
    const adjustedParent = adjustPathAfterRemoval(target.parentPath, from)
    // 顶层插入位语义 = 「当前第 i 块之前」：remove 原块（顶层第 r 块）后，
    // i > r 的插入位随序列前移一并减一（i <= r 不变）
    const adjustedIndex = target.parentPath.length === 0 && from.length === 1 && target.slotIndex > from[0]!
      ? target.slotIndex - 1
      : target.slotIndex
    const placed = insertBlockAt(without, { parentPath: adjustedParent, slotIndex: adjustedIndex }, removed)
    if (placed !== null) {
      this.updateQuery(placed)
    }
  }

  // ---- 状态高亮（只 toggle 类，不重建——焦点保持） ----

  private blockElements(): HTMLElement[] {
    return [...this.blockFlow.querySelectorAll<HTMLElement>('.vsidian-bq-block')]
  }

  private setSelected(path: BehaviorBlockPath | null): void {
    this.selectedPath = path
    for (const el of this.blockElements()) {
      const elPath = pathOfString(el.dataset.bqPath ?? '')
      // 选中发光覆盖该块及其全部嵌套（删除范围整体明示）
      el.classList.toggle('vsidian-bq-selected', path !== null && isPathWithin(elPath, path))
    }
  }

  private cancelCarry(): void {
    this.carryPath = null
    this.carrySlotIndex = null
    this.refreshCarryHighlight()
  }

  private refreshCarryHighlight(): void {
    for (const el of this.blockElements()) {
      el.classList.toggle('vsidian-bq-carrying', this.carryPath !== null && pathOfString(el.dataset.bqPath ?? '').join() === this.carryPath!.join())
    }
    const slots = [...this.blockFlow.querySelectorAll<HTMLElement>('.vsidian-bq-slot')]
    for (const slot of slots) {
      slot.classList.toggle('vsidian-bq-slot--target', false)
    }
    if (this.carryPath !== null && this.carrySlotIndex !== null) {
      const emptySlots = this.emptySlotsExcludingCarried()
      const target = emptySlots[this.carrySlotIndex]
      if (target !== undefined) {
        const key = `${pathToString(target.parentPath)}:${target.slotIndex}`
        for (const slot of slots) {
          if (slot.dataset.bqSlot === key) {
            slot.classList.add('vsidian-bq-slot--target')
          }
        }
      }
    }
  }

  /** 空缺口槽（排除拾取块自身内部——不能自嵌套） */
  private emptySlotsExcludingCarried(): BehaviorSlotTarget[] {
    const all = emptySlotsOf(this.query)
    const carry = this.carryPath
    if (carry === null) {
      return all
    }
    return all.filter((slot) => !isPathWithin(slot.parentPath, carry))
  }

  // ---- 渲染 ----

  private rebuild(): void {
    this.blockFlow.replaceChildren()
    // 顶层任意落点拖放（D8）：块间与首尾插入位（细 dropzone，dragover 增高）
    for (let index = 0; index <= this.query.blocks.length; index++) {
      this.blockFlow.append(this.renderDropzone(index))
      const block = this.query.blocks[index]
      if (block !== undefined) {
        this.blockFlow.append(this.renderBlock(block, [index]))
      }
    }
    const atLimit = countBehaviorQueryBlocks(this.query) >= BEHAVIOR_QUERY_BLOCKS_LIMIT
    this.addButton.disabled = atLimit
    // D9：超限禁用 + 悬停提示——tooltip 挂包裹（disabled 不派发鼠标事件），
    // aria-label 随禁用态切换（读屏获知不可用原因，评审 F1）
    this.addWrap.dataset.tooltip = t(atLimit ? 'addons.behaviorQueryLimitTooltip' : 'addons.behaviorQueryAddTooltip')
    this.addButton.setAttribute('aria-label', t(atLimit ? 'addons.behaviorQueryLimitTooltip' : 'addons.behaviorQueryAddTooltip'))
    this.addButton.setAttribute('aria-expanded', this.menu !== undefined ? 'true' : 'false')
    this.trashButton.classList.toggle('vsidian-behavior-query-trash--active', this.selectedPath !== null)
  }

  private renderDropzone(index: number): HTMLElement {
    const zone = document.createElement('div')
    zone.className = 'vsidian-bq-dropzone'
    zone.dataset.bqTopIndex = String(index)
    zone.addEventListener('dragover', (event) => {
      if (this.dragPathOf(event) === null) {
        return
      }
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
      zone.classList.add('vsidian-bq-dropzone--active')
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('vsidian-bq-dropzone--active'))
    zone.addEventListener('drop', (event) => {
      event.preventDefault()
      zone.classList.remove('vsidian-bq-dropzone--active')
      const from = this.dragPathOf(event)
      if (from !== null) {
        this.moveBlock(from, { parentPath: [], slotIndex: index })
      }
    })
    return zone
  }

  private renderBlock(block: BehaviorQueryBlock, path: BehaviorBlockPath): HTMLElement {
    const el = document.createElement('div')
    el.dataset.bqPath = pathToString(path)
    el.tabIndex = 0
    // 字段积木内 input 与拖拽冲突防护：输入焦点期间关 draggable，失焦恢复
    const syncDraggable = (): void => {
      const input = el.querySelector('input, select')
      el.draggable = input === null || document.activeElement !== input
    }
    el.addEventListener('focusout', () => setTimeout(syncDraggable, 0))
    syncDraggable()
    el.addEventListener('dragstart', (event) => {
      event.dataTransfer!.setData('text/plain', pathToString(path))
      event.dataTransfer!.effectAllowed = 'move'
      this.dragPath = path
      el.classList.add('vsidian-bq-block--dragging')
    })
    el.addEventListener('dragend', () => {
      this.dragPath = null
      el.classList.remove('vsidian-bq-block--dragging')
    })
    el.addEventListener('click', (event) => {
      // 输入控件与下拉的点击不改变选中（积木外壳点击才选中）
      if ((event.target as HTMLElement).closest('input, select, button')) {
        return
      }
      this.setSelected(path)
    })
    el.addEventListener('keydown', (event) => this.handleBlockKeydown(event, path))

    if (block.kind === 'field') {
      el.className = 'vsidian-bq-block vsidian-bq-block--field'
      el.setAttribute('role', 'group')
      el.setAttribute('aria-label', t(FIELD_IDS.find((f) => f.id === block.field)!.labelKey))
      const label = document.createElement('span')
      label.className = 'vsidian-bq-block-label'
      label.textContent = t(FIELD_IDS.find((f) => f.id === block.field)!.labelKey)
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'vsidian-bq-field-input'
      input.value = block.text
      input.setAttribute('aria-label', t(FIELD_IDS.find((f) => f.id === block.field)!.labelKey))
      // 键盘拾取/删除不拦截输入路径（input 自身按键照常）
      input.addEventListener('keydown', (event) => event.stopPropagation())
      input.addEventListener('pointerdown', () => { el.draggable = false })
      input.addEventListener('input', () => {
        const next = cloneQuery(this.query)
        const target = getBlockAt(next.blocks, path)
        if (target !== null && target.kind === 'field') {
          target.text = input.value
          this.query = { version: 1, blocks: next.blocks }
          this.options.onChange(this.query)
        }
      })
      el.append(label, input)
      return el
    }
    if (block.kind === 'status') {
      el.className = 'vsidian-bq-block vsidian-bq-block--status'
      el.setAttribute('role', 'group')
      el.setAttribute('aria-label', t('addons.behaviorQueryStatusBlockLabel'))
      const label = document.createElement('span')
      label.className = 'vsidian-bq-block-label'
      label.textContent = t('addons.behaviorQueryStatusBlockLabel')
      const select = document.createElement('select')
      select.className = 'vsidian-bq-status-select'
      for (const status of STATUS_IDS) {
        const option = document.createElement('option')
        option.value = status.id
        option.textContent = t(status.labelKey)
        select.append(option)
      }
      select.value = block.status
      select.addEventListener('keydown', (event) => event.stopPropagation())
      select.addEventListener('pointerdown', () => { el.draggable = false })
      select.addEventListener('change', () => {
        // 显示就地更新（select 自身），只改树并上抛——不重建（焦点保持）
        const next = cloneQuery(this.query)
        const target = getBlockAt(next.blocks, path)
        if (target !== null && target.kind === 'status') {
          target.status = select.value as BehaviorQueryStatusId
          this.query = { version: 1, blocks: next.blocks }
          this.options.onChange(this.query)
        }
      })
      el.append(label, select)
      return el
    }
    // 逻辑积木：菱形外壳内嵌缺口槽（AND/OR 双缺口、NOT 单缺口）
    el.className = 'vsidian-bq-block vsidian-bq-block--logic'
    el.dataset.bqOp = block.op
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', t(`addons.behaviorQueryLogic.${block.op}`))
    const opLabel = document.createElement('span')
    opLabel.className = 'vsidian-bq-block-label'
    opLabel.textContent = t(`addons.behaviorQueryLogic.${block.op}`)
    el.append(opLabel)
    const slots = document.createElement('span')
    slots.className = 'vsidian-bq-slots'
    block.children.forEach((child, slotIndex) => {
      slots.append(this.renderSlot([...path, slotIndex], child))
    })
    el.append(slots)
    return el
  }

  private renderSlot(path: BehaviorBlockPath, child: BehaviorQueryBlock | null): HTMLElement {
    const slot = document.createElement('span')
    slot.className = 'vsidian-bq-slot'
    slot.dataset.bqSlot = `${pathToString(path.slice(0, -1))}:${path[path.length - 1]!}`
    if (child === null) {
      slot.classList.add('vsidian-bq-slot--empty')
      slot.addEventListener('dragover', (event) => {
        const from = this.dragPathOf(event)
        if (from === null || isPathWithin(path.slice(0, -1), from)) {
          return
        }
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'move'
        slot.classList.add('vsidian-bq-slot--over')
      })
      slot.addEventListener('dragleave', () => slot.classList.remove('vsidian-bq-slot--over'))
      slot.addEventListener('drop', (event) => {
        event.preventDefault()
        slot.classList.remove('vsidian-bq-slot--over')
        const from = this.dragPathOf(event)
        if (from !== null) {
          this.moveBlock(from, { parentPath: path.slice(0, -1), slotIndex: path[path.length - 1]! })
        }
      })
    } else {
      slot.append(this.renderBlock(child, path))
    }
    return slot
  }

  // ---- 键盘构建（D8：Enter 拾取 → 方向键选缺口 → Enter 放下） ----

  private handleBlockKeydown(event: KeyboardEvent, path: BehaviorBlockPath): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      const carry = this.carryPath
      if (carry === null) {
        this.carryPath = path
        this.carrySlotIndex = this.emptySlotsExcludingCarried().length > 0 ? 0 : null
      } else if (this.carrySlotIndex !== null) {
        const slots = this.emptySlotsExcludingCarried()
        const target = slots[this.carrySlotIndex]
        if (target !== undefined) {
          this.moveBlock(carry, target)
        }
      } else {
        this.cancelCarry() // 无可放缺口：第二次 Enter 等价取消回原位
      }
      this.refreshCarryHighlight()
      return
    }
    if (event.key === 'Escape' && this.carryPath !== null) {
      event.preventDefault()
      this.cancelCarry()
      return
    }
    if (this.carryPath !== null && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      const slots = this.emptySlotsExcludingCarried()
      if (slots.length === 0) {
        return
      }
      const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      const current = this.carrySlotIndex ?? 0
      const next = forward
        ? (current + 1) % slots.length
        : (current - 1 + slots.length) % slots.length
      this.carrySlotIndex = next
      this.refreshCarryHighlight()
      return
    }
    if (event.key === 'Delete') {
      // 垃圾桶的键盘等价（D8）：删选中；无选中时删键盘焦点所在积木
      const target = this.selectedPath ?? path
      event.preventDefault()
      this.removeBlock(target)
    }
  }

  // ---- 加号下拉（三组；设置页页内菜单形态） ----

  private toggleMenu(): void {
    if (this.menu !== undefined) {
      this.closeMenu()
      return
    }
    const menu = document.createElement('div')
    menu.className = 'vsidian-bq-menu'
    menu.setAttribute('role', 'menu')
    const addGroup = (groupLabelKey: string, items: Array<{ labelKey: string; onPick: () => void }>): void => {
      const groupLabel = document.createElement('div')
      groupLabel.className = 'vsidian-bq-menu-group'
      groupLabel.textContent = t(groupLabelKey)
      menu.append(groupLabel)
      for (const item of items) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'vsidian-bq-menu-item'
        button.setAttribute('role', 'menuitem')
        button.textContent = t(item.labelKey)
        button.addEventListener('click', () => {
          this.closeMenu()
          item.onPick()
        })
        menu.append(button)
      }
    }
    addGroup('addons.behaviorQueryGroup.field', FIELD_IDS.map((field) => ({
      labelKey: field.labelKey,
      onPick: () => this.addTopLevelBlock({ kind: 'field', field: field.id, text: '' }),
    })))
    addGroup('addons.behaviorQueryGroup.logic', (['and', 'or', 'not'] as const).map((op) => ({
      labelKey: `addons.behaviorQueryLogic.${op}`,
      onPick: () => this.addTopLevelBlock(newQueryBlock(op)),
    })))
    addGroup('addons.behaviorQueryGroup.status', [{
      labelKey: 'addons.behaviorQueryStatusBlockLabel',
      onPick: () => this.addTopLevelBlock(newQueryBlock('status')),
    }])
    this.root.append(menu)
    this.menu = menu
    this.addButton.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', this.closeMenuOnDocClick, true)
  }

  private closeMenu(): void {
    this.menu?.remove()
    this.menu = undefined
    this.addButton.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', this.closeMenuOnDocClick, true)
  }

  // ---- 拖拽路径（dataTransfer 不可靠时的会话兜底：dragstart 记录） ----

  private dragPath: BehaviorBlockPath | null = null

  private dragPathOf(event: DragEvent): BehaviorBlockPath | null {
    const text = event.dataTransfer?.getData('text/plain') ?? ''
    if (text.length > 0 && /^[\d.]+$/.test(text)) {
      return pathOfString(text)
    }
    return this.dragPath
  }

  dispose(): void {
    this.closeMenu()
  }
}
