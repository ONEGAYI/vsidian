// #474 行为管理积木式筛选——查询树形状、序列化守卫、求值与分页纯函数
// 单一事实源（两端共享：webview 编辑器只做 UI 编辑，求值与持久在此）。
//
// 事实源：docs/specs/behavior-manage-pagination.md 设计树 D1–D15、
// ADR-0015（积木式查询构造器取代文本搜索）。
//
// 契约口径：
// - 三族积木（D4）：字段积木（四字段内嵌文本）、逻辑积木（AND/OR 双缺口、
//   NOT 单缺口——缺口即 children 的 null 槽，可嵌任意积木任意深度）、
//   状态积木（四态下拉，与行徽章一一对应）。
// - 匹配语义（D5）：大小写不敏感子串；行为显示名匹配「当前语言解析名」
//   ——调用方渲染时以 resolveAddonBehaviorName + currentLocaleLang 现算注入
//   行上下文（不缓存，切语言后查询含义随之变化）；组件显示名对齐行上
//   组件 label（回落 addonId）；行为 ID 匹配局部 ID；组件 ID 匹配 addonId。
// - 求值语义（D7）：顶层并列积木隐式 AND；空文本字段积木恒真（占位待填）；
//   含空槽的逻辑积木整体恒真（半构造不参与过滤——规格只钉了空文本恒真，
//   空槽按同一「占位待填」精神推广，契约测试钉住）；无积木 = 全集；
//   命中只过滤不排序（展示全序由 orderedAddonBehaviorKeys 保持，本模块
//   不动序）。
// - 上限（D9）：积木总数（全部节点，空槽不计）≤ 16；超限序列化整条拒绝
//   （构造器侧另有加号禁用，此处是持久层防御）。
// - 行状态四态（D6）：与分节行徽章同源合成，优先序 用户关闭 > 组件停用 >
//   故障暂停 > 启用（对齐分节徽章三分支判定序）。

/** 字段积木的可选字段族（D4 加号下拉「行为组件」组） */
export type BehaviorQueryFieldId = 'behaviorName' | 'addonName' | 'behaviorId' | 'addonId'

/** 状态积木四态（D6：与行徽章一一对应） */
export type BehaviorQueryStatusId = 'enabled' | 'disabled' | 'addonDisabled' | 'errorPaused'

/** 逻辑积木算子（AND/OR 双缺口、NOT 单缺口） */
export type BehaviorQueryLogicOp = 'and' | 'or' | 'not'

/** 逻辑积木缺口槽：null = 空槽（占位待填；跨持久化往返保留半构造状态） */
export type BehaviorQuerySlot = BehaviorQueryBlock | null

export type BehaviorQueryBlock =
  | { readonly kind: 'field'; readonly field: BehaviorQueryFieldId; readonly text: string }
  | { readonly kind: 'logic'; readonly op: BehaviorQueryLogicOp; readonly children: readonly BehaviorQuerySlot[] }
  | { readonly kind: 'status'; readonly status: BehaviorQueryStatusId }

/** 积木查询树（持久化形态：宿主 globalState 用户级，跨重启） */
export interface BehaviorQueryFilter {
  readonly version: 1
  /** 顶层并列积木 = 隐式 AND（D7：不强制先建逻辑积木） */
  readonly blocks: readonly BehaviorQueryBlock[]
}

/** 积木总数上限（D9：超限时加号禁用 + 序列化整条拒绝） */
export const BEHAVIOR_QUERY_BLOCKS_LIMIT = 16

/** 字段积木文本长度上限（防滥用；正常过滤词远小于此） */
const BEHAVIOR_QUERY_TEXT_LIMIT = 256

/** 行为列表页容量（D1：20 行/页） */
export const BEHAVIOR_LIST_PAGE_SIZE = 20

const FIELD_IDS: readonly BehaviorQueryFieldId[] = ['behaviorName', 'addonName', 'behaviorId', 'addonId']
const STATUS_IDS: readonly BehaviorQueryStatusId[] = ['enabled', 'disabled', 'addonDisabled', 'errorPaused']
const LOGIC_OPS: readonly BehaviorQueryLogicOp[] = ['and', 'or', 'not']

/** 行状态四态单值归类（纯函数；状态积木求值的输入——D6）：用户单项关闭 >
 * 组件停用 > 故障暂停 > 启用。与分节徽章的判据同族但语义不同：徽章是
 * 多标注呈现（已关闭与故障暂停可叠加并存），求值需要单值枚举（叠加行
 * 按优先序归一类）。addonEnabled/addonFault 为 undefined 表示组件条目
 * 缺失（不计停用也不计故障）；fault 形态对齐 AddonStatusEntry.fault
 * （{ reason }），只判在场不读原因。 */
export function resolveBehaviorRowStatus(
  userDisabled: boolean,
  addonEnabled: boolean | undefined,
  addonFault: { reason: string } | undefined,
): BehaviorQueryStatusId {
  if (userDisabled) {
    return 'disabled'
  }
  if (addonEnabled === false) {
    return 'addonDisabled'
  }
  if (addonFault !== undefined) {
    return 'errorPaused'
  }
  return 'enabled'
}

/** 求值行上下文（调用方逐行现算注入；behaviorName 为当前语言解析名） */
export interface BehaviorQueryRowContext {
  readonly behaviorName: string
  readonly addonName: string
  readonly behaviorId: string
  readonly addonId: string
  readonly status: BehaviorQueryStatusId
}

function fieldTextOf(block: Extract<BehaviorQueryBlock, { kind: 'field' }>, ctx: BehaviorQueryRowContext): string {
  switch (block.field) {
    case 'behaviorName': return ctx.behaviorName
    case 'addonName': return ctx.addonName
    case 'behaviorId': return ctx.behaviorId
    case 'addonId': return ctx.addonId
  }
}

/** 单积木求值（纯函数）。语义见模块头注；含空槽的逻辑积木恒真。 */
export function evaluateBehaviorQueryBlock(block: BehaviorQueryBlock, ctx: BehaviorQueryRowContext): boolean {
  switch (block.kind) {
    case 'field': {
      const needle = block.text.trim().toLowerCase()
      if (needle.length === 0) {
        return true
      }
      return fieldTextOf(block, ctx).toLowerCase().includes(needle)
    }
    case 'status':
      return ctx.status === block.status
    case 'logic': {
      // 半构造（任一缺口空置）不参与过滤——与空文本字段积木同精神
      if (block.children.some((child) => child === null)) {
        return true
      }
      const children = block.children as readonly BehaviorQueryBlock[]
      switch (block.op) {
        case 'and':
          return children.every((child) => evaluateBehaviorQueryBlock(child, ctx))
        case 'or':
          return children.some((child) => evaluateBehaviorQueryBlock(child, ctx))
        case 'not':
          return !evaluateBehaviorQueryBlock(children[0]!, ctx)
      }
    }
  }
}

/** 整树求值（纯函数）：null / 空 blocks = 全集；顶层并列隐式 AND（D7） */
export function evaluateBehaviorQuery(filter: BehaviorQueryFilter | null, ctx: BehaviorQueryRowContext): boolean {
  if (filter === null || filter.blocks.length === 0) {
    return true
  }
  return filter.blocks.every((block) => evaluateBehaviorQueryBlock(block, ctx))
}

/** 积木总数（全部节点计数，空槽不计；上限校验 D9 用） */
export function countBehaviorQueryBlocks(filter: BehaviorQueryFilter | null): number {
  if (filter === null) {
    return 0
  }
  const countBlock = (block: BehaviorQueryBlock): number => {
    if (block.kind !== 'logic') {
      return 1
    }
    return 1 + block.children.reduce((sum, child) => sum + (child === null ? 0 : countBlock(child)), 0)
  }
  return filter.blocks.reduce((sum, block) => sum + countBlock(block), 0)
}

function isLogicChildrenShape(op: BehaviorQueryLogicOp, children: unknown): children is readonly unknown[] {
  if (!Array.isArray(children)) {
    return false
  }
  const slots = op === 'not' ? 1 : 2
  return children.length === slots
}

/** 单积木序列化守卫（递归；depth 剪枝：合法树每层 logic 自身至少计 1 块，
 * 深度超过 BEHAVIOR_QUERY_BLOCKS_LIMIT 必然超块数上限——深嵌套载荷在此
 * 早拒，防递归爆栈上抛打断扩展激活（守卫调用链无 try/catch 兜底））；
 * 非法形态回 null */
function parseBlock(v: unknown, depth: number): BehaviorQueryBlock | null {
  if (typeof v !== 'object' || v === null) {
    return null
  }
  if (depth > BEHAVIOR_QUERY_BLOCKS_LIMIT) {
    return null
  }
  const candidate = v as Record<string, unknown>
  if (candidate.kind === 'field') {
    if (typeof candidate.field !== 'string' || !FIELD_IDS.includes(candidate.field as BehaviorQueryFieldId)) {
      return null
    }
    if (typeof candidate.text !== 'string' || candidate.text.length > BEHAVIOR_QUERY_TEXT_LIMIT) {
      return null
    }
    return { kind: 'field', field: candidate.field as BehaviorQueryFieldId, text: candidate.text }
  }
  if (candidate.kind === 'status') {
    if (typeof candidate.status !== 'string' || !STATUS_IDS.includes(candidate.status as BehaviorQueryStatusId)) {
      return null
    }
    return { kind: 'status', status: candidate.status as BehaviorQueryStatusId }
  }
  if (candidate.kind === 'logic') {
    if (typeof candidate.op !== 'string' || !LOGIC_OPS.includes(candidate.op as BehaviorQueryLogicOp)) {
      return null
    }
    const op = candidate.op as BehaviorQueryLogicOp
    if (!isLogicChildrenShape(op, candidate.children)) {
      return null
    }
    const children: BehaviorQuerySlot[] = []
    for (const slot of candidate.children as readonly unknown[]) {
      if (slot === null) {
        children.push(null)
        continue
      }
      const parsed = parseBlock(slot, depth + 1)
      if (parsed === null) {
        return null
      }
      children.push(parsed)
    }
    return { kind: 'logic', op, children }
  }
  return null
}

/** 查询树存储解析（fail-safe：坏形态整条回 null，调用方不写回；空槽合法
 * 保留——半构造状态跨重启可恢复）。超 BEHAVIOR_QUERY_BLOCKS_LIMIT 整条
 * 拒绝（持久层防御；构造器侧另有加号禁用）。 */
export function parseBehaviorQueryFilter(v: unknown): BehaviorQueryFilter | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return null
  }
  const candidate = v as { version?: unknown; blocks?: unknown }
  if (candidate.version !== 1 || !Array.isArray(candidate.blocks)) {
    return null
  }
  const blocks: BehaviorQueryBlock[] = []
  for (const raw of candidate.blocks) {
    const parsed = parseBlock(raw, 1)
    if (parsed === null) {
      return null
    }
    blocks.push(parsed)
  }
  const filter: BehaviorQueryFilter = { version: 1, blocks }
  if (countBehaviorQueryBlocks(filter) > BEHAVIOR_QUERY_BLOCKS_LIMIT) {
    return null
  }
  return filter
}

/** 分页结果（page 规范化为有效页码） */
export interface BehaviorListPagination<T> {
  /** 规范化当前页（1 起；空表回落 1） */
  readonly page: number
  readonly pageCount: number
  readonly pageItems: readonly T[]
}

/** 行为列表分页（纯函数，只切片不动序——命中保持展示全序 D7）：页容量
 * BEHAVIOR_LIST_PAGE_SIZE；页码越界（含持久恢复时注册集变化）静默回落
 * 第 1 页（D11）。 */
export function paginateBehaviorList<T>(items: readonly T[], page: number): BehaviorListPagination<T> {
  const pageCount = Math.ceil(items.length / BEHAVIOR_LIST_PAGE_SIZE)
  const normalized = Number.isInteger(page) && page >= 1 && page <= pageCount ? page : 1
  const start = (normalized - 1) * BEHAVIOR_LIST_PAGE_SIZE
  return {
    page: normalized,
    pageCount,
    pageItems: items.slice(start, start + BEHAVIOR_LIST_PAGE_SIZE),
  }
}
