// T07（#356）可组合输入行为——两端共享的形状、守卫与序计算单一事实源。
//
// 事实源：docs/specs/vsidian-addons-tickets/t07.md、技术方案 §5.2（输入
// 行为形状）与 §7（行为顺序和逐项开关的持久化）、ADR-0012 Q27 修订
//（2026-10-05：默认依次触发、可调序逐项关闭、不互斥——取代旧「先接管
// 者生效」）。
//
// 边界（票面）：
// - **注册形状**：稳定局部 ID、必填名称、可选简短说明/例子及业务回调；
//   行为能力和适用条件只由代码表达，不复制进 manifest。名称缺失拒绝，
//   说明/例子缺失允许。
// - **键形态**：行为持久身份 = 组件 ID + 局部 ID（addonBehaviorFullKey），
//   不以显示名为存储键。局部 ID 限定 `[A-Za-z0-9._-]`（首字符字母数字）
//   ——与 addonId（publisher.name，无 #）拼出的完整键无歧义，可直接作
//   持久层键。
// - **默认序与覆盖**：默认序按完整键字典序（技术方案 §7「初始次序按
//   稳定 ID 确定」）；用户覆盖只重排已列出项（保持相对次序），未列出
//   的注册项按默认序追加尾部——新项加入不破坏已有相对次序、不重新
//   开启已关闭项。
// - **组合语义**：文本变化不终止链（默认可组合）；确需择一的入口用
//   显式独占组（exclusiveGroup，同组件命名空间内互斥），不恢复统一
//   「先接管者生效」。独占组键 = 组件 ID + 组名（跨组件不互斥）。
import type { SerChange } from './protocol'
import type {
  AddonEditorSnapshot,
  AddonSelectionRange,
} from './addonEditApi'

/** 局部 ID 长度上限（防滥用；正常行为 ID 远小于此） */
export const BEHAVIOR_LOCAL_ID_LIMIT = 128
/** 展示字段长度上限（名称/说明/例子项） */
const BEHAVIOR_NAME_LIMIT = 256
const BEHAVIOR_DESCRIPTION_LIMIT = 1024
const BEHAVIOR_EXAMPLE_LIMIT = 256
const BEHAVIOR_EXAMPLES_MAX = 8

/** 局部 ID 与独占组名的字符集（首字符字母数字，余 `[A-Za-z0-9._-]`） */
const BEHAVIOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 输入行为的操作上下文（技术方案 §5.2：当前快照 + 操作上下文） */
export interface AddonInputContext {
  /** 触发本次链的用户输入 userEvent（CM6 语义，如 'input.type'、
   *  'delete.backward'、'input.type.compose'——IME 定稿） */
  readonly userEvent: string
  /** 本次输入插入的净文本（多选区拼接；不含删除侧；delete 事务为空串） */
  readonly inputText: string
  /** 本次输入替换/删除掉的文本（事务前 LF 坐标）：input.type 替换选区时
   *  为被替换的选区内容（#401——SelectKey 包裹/替换类规则的判定依据：
   *  按键插入发生在选区销毁之后，行为从本字段读回包裹目标）；delete.*
   *  事务时为被删文本（#400——联动删除配对端需要知道删了什么）。多区间
   *  时为全部删除区间的最小包围与按序拼接文本。IME 定稿补驱动恒 null
   *  （组合事务先于 compositionend，替换侧无法归因——#399 边界）；
   *  纯插入无删除侧为 null */
  readonly replaced: AddonReplacedRange | null
  /** 行为读取时点的当前快照——已含本次输入与**前序行为的修饰结果**
   *  （后续行为读取前序结果）；输入点从快照选区读取 */
  readonly snapshot: AddonEditorSnapshot
  /** 本次驱动所属视图的目标文档 URI（#407，与该实例 views 句柄的
   *  targetDocUri 同源：main = 面板文档，embed = 引用目标文档——在
   *  引用 B 内触发时是 B 的 URI，不是宿主文档 A；文件排除类规则据此
   *  判定「我正在哪个文件里被触发」） */
  readonly docUri: string
}

/** 事务替换/删除侧的区间与文本（事务前 LF 坐标） */
export interface AddonReplacedRange {
  /** 全部删除区间的最小包围起点 */
  readonly from: number
  /** 全部删除区间的最小包围终点 */
  readonly to: number
  /** 被替换/删除的文本（按区间顺序拼接） */
  readonly text: string
}

/** 文本修饰计划（行为返回；提交与身份注入由平台完成——行为不能直接
 *  写文档，防绕过链） */
export interface AddonBehaviorInputPlan {
  /** LF 坐标变更列表（相对 context.snapshot） */
  readonly changes: SerChange[]
  /** 提交后选区（可选；缺省保持实例现有选区重定位） */
  readonly selection?: AddonSelectionRange
}

/** behaviors.register 的注册载荷（作者提供） */
export interface AddonBehaviorRegistration {
  /** 稳定局部 ID（组件内唯一；持久身份的一半） */
  readonly id: string
  /** 必填的用户可读名称（ADR Q27：注册行为时名称必填） */
  readonly name: string
  /** 可选简短说明（推荐提供，不作接入强制条件） */
  readonly description?: string
  /** 可选例子（推荐提供；至多 8 项） */
  readonly examples?: readonly string[]
  /** 可选独占组：同组件内同组行为互斥（按有效序首个适用者生效）；
   *  跨组件不互斥 */
  readonly exclusiveGroup?: string
  /** 撤回边界声明（Q29）：缺省 atomic；joinPrevious = 随同上次原子操作
   *  撤回（每次修饰按自己的原子声明提交） */
  readonly history?: 'atomic' | 'joinPrevious'
  /** 业务回调：返回不处理（null）或文本修饰计划；适用条件由代码表达 */
  readonly onInput: (context: AddonInputContext) => AddonBehaviorInputPlan | null
}

/** 注册结果的观测面（不含回调；诊断与 T08 管理查询的序列化形态） */
export interface AddonBehaviorInfo {
  addonId: string
  id: string
  name: string
  description?: string
  examples?: readonly string[]
  exclusiveGroup?: string
  history: 'atomic' | 'joinPrevious'
}

/** 行为完整键（持久身份）：组件 ID + 局部 ID 以 # 连接 */
export function addonBehaviorFullKey(addonId: string, behaviorId: string): string {
  return `${addonId}#${behaviorId}`
}

/** 独占组键（同组件命名空间内互斥；跨组件不互斥） */
export function addonBehaviorExclusiveGroupKey(addonId: string, group: string): string {
  return `${addonId}#group:${group}`
}

function isUsableLocalId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= BEHAVIOR_LOCAL_ID_LIMIT &&
    BEHAVIOR_ID_PATTERN.test(value)
}

/** 注册形状守卫：名称缺失拒绝、说明/例子缺失允许；非法形态不进入链 */
export function isAddonBehaviorRegistration(v: unknown): v is AddonBehaviorRegistration {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false
  }
  const candidate = v as Record<string, unknown>
  if (!isUsableLocalId(candidate.id)) {
    return false
  }
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0 ||
    candidate.name.length > BEHAVIOR_NAME_LIMIT) {
    return false
  }
  if (candidate.description !== undefined &&
    (typeof candidate.description !== 'string' || candidate.description.length > BEHAVIOR_DESCRIPTION_LIMIT)) {
    return false
  }
  if (candidate.examples !== undefined) {
    if (!Array.isArray(candidate.examples) || candidate.examples.length > BEHAVIOR_EXAMPLES_MAX ||
      !candidate.examples.every((item) => typeof item === 'string' && item.length > 0 && item.length <= BEHAVIOR_EXAMPLE_LIMIT)) {
      return false
    }
  }
  if (candidate.exclusiveGroup !== undefined && !isUsableLocalId(candidate.exclusiveGroup)) {
    return false
  }
  if (candidate.history !== undefined && candidate.history !== 'atomic' && candidate.history !== 'joinPrevious') {
    return false
  }
  return typeof candidate.onInput === 'function'
}

/** 注册面无关的展示信息提取（回调不外泄——序列化面只留元数据） */
export function addonBehaviorInfoOf(addonId: string, registration: AddonBehaviorRegistration): AddonBehaviorInfo {
  return {
    addonId,
    id: registration.id,
    name: registration.name,
    ...(registration.description !== undefined ? { description: registration.description } : {}),
    ...(registration.examples !== undefined ? { examples: [...registration.examples] } : {}),
    ...(registration.exclusiveGroup !== undefined ? { exclusiveGroup: registration.exclusiveGroup } : {}),
    history: registration.history ?? 'atomic',
  }
}

/** onChanged 观察事件（通知分离面：只读观察，无修饰权——技术方案 §5.2
 *  「通知监听与输入修饰回调分别注册」） */
export interface AddonBehaviorChangeEvent {
  readonly userEvent: string
  readonly inputText: string
  /** 替换/删除侧（与 AddonInputContext.replaced 同义：#400/#401） */
  readonly replaced: AddonReplacedRange | null
  readonly snapshot: AddonEditorSnapshot
  /** 本次驱动所属视图的目标文档 URI（#407，与 AddonInputContext.docUri 同源） */
  readonly docUri: string
}

/** 注册结果（SDK behaviors.register 的返回） */
export type AddonBehaviorRegisterResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'invalid-registration' | 'duplicate-id' | 'not-editor-page' | 'released' }

/** SDK behaviors 面（仅编辑器页提供；设置页为 undefined）。register 与
 *  onChanged 分开注册——onChanged 不是原输入链的第二写入口 */
export interface AddonBehaviorsFacet {
  /** 登记输入行为（稳定局部 ID + 必填名称 + 可选说明/例子/独占组/撤回
   *  声明 + 业务回调）；名称缺失拒绝，说明/例子缺失允许 */
  register(registration: AddonBehaviorRegistration): AddonBehaviorRegisterResult
  /** 观察用户输入（只读事件；不进入修饰链） */
  onChanged(callback: (event: AddonBehaviorChangeEvent) => void): () => void
}

/** 链执行轨迹条目（观测/断言面） */
export interface AddonBehaviorTraceEntry {
  behaviorKey: string
  opId: string
  outcome: 'ok' | string
}

/** runtime 观测快照（view.state 探针与测试断言面） */
export interface AddonBehaviorRuntimeStats {
  registrations: AddonBehaviorInfo[]
  hostState: { order: readonly string[]; disabled: readonly string[] } | null
  counters: {
    drives: number
    drivesSkippedWhileRunning: number
    callbackErrors: number
    observerErrors: number
    invalidPlans: number
    submitsRejected: number
  }
  trace: AddonBehaviorTraceEntry[]
}

// ---- 状态存储（宿主持久层 ↔ webview 下发的同构形态） ----

/** 行为顺序与逐项开关的持久存储（version 1 冻结）。
 * 存储设计决策（票面要求写明）：
 * - 键 = 行为完整键（组件 ID + 局部 ID），不以显示名为键——改名/本地化
 *   不丢配置；未知项（已卸载）保留存储、不剔除（技术方案 §7：展示状态
 *   而不重新打开用户已关闭的项）。
 * - 单层 user（globalState）持久，不做工作区层——行为开关与顺序是用户
 *   偏好（ADR 未要求两层）；同文档跨窗口行为一致。T08 需要工作区层时
 *   再按 T04 两层模式扩展（version 迁移）。 */
export interface AddonBehaviorStateStore {
  readonly version: 1
  /** 用户排序覆盖（完整键；未列出项按默认序追加） */
  readonly order: readonly string[]
  /** 用户关闭的行为（完整键；不在场 = 开启） */
  readonly disabled: readonly string[]
}

/** 存储解析：坏形态回空（fail-safe，调用方不写回）；order/disabled 去重 */
export function parseAddonBehaviorStateStore(v: unknown): AddonBehaviorStateStore | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return null
  }
  const candidate = v as { version?: unknown; order?: unknown; disabled?: unknown }
  if (candidate.version !== 1) {
    return null
  }
  const order = candidate.order ?? []
  const disabled = candidate.disabled ?? []
  if (!Array.isArray(order) || !Array.isArray(disabled) ||
    !order.every((k) => typeof k === 'string') || !disabled.every((k) => typeof k === 'string')) {
    return null
  }
  return { version: 1, order: [...new Set(order)], disabled: [...new Set(disabled)] }
}

/** 有效序计算（纯函数；webview 链驱动与宿主管理查询共用）：
 * 用户序中的已注册项（保相对次序）→ 未列入用户序的注册项（完整键字典
 * 序追加尾部）→ 剔除关闭项。null store = 无覆盖（全新默认态）。 */
export function resolveAddonBehaviorOrder(
  registeredKeys: readonly string[],
  store: AddonBehaviorStateStore | null,
): string[] {
  const disabled = store === null ? new Set<string>() : new Set(store.disabled)
  return orderedAddonBehaviorKeys(registeredKeys, store).filter((key) => !disabled.has(key))
}

/** T08（#357）展示全序：与 resolveAddonBehaviorOrder 同一口径，但**保留
 * 关闭项在原位**——行为冲突管理列表要呈现已关闭的行为（勾选态另呈，
 * 用户需要辨认与重新开启）；null store = 无覆盖（默认序全开启）。 */
export function orderedAddonBehaviorKeys(
  registeredKeys: readonly string[],
  store: AddonBehaviorStateStore | null,
): string[] {
  const registered = new Set(registeredKeys)
  const listed = store === null ? [] : store.order.filter((key) => registered.has(key))
  const listedSet = new Set(listed)
  const appended = registeredKeys.filter((key) => !listedSet.has(key)).sort()
  return [...listed, ...appended]
}

/** T08（#357）调序落库的未知项保留合并：管理 UI 只提交当前可见（已注册）
 * 行为的新序，本函数把存储中不可见的键（组件停用/无面板上报）按「锚定
 * 到原序列中前一个可见键之后」的规则并回新序——整组件停用期间的其他
 * 调序不丢该组件行为的位置配置，重新注册后回到锚定相对位（票面「整体
 * 停用与单项关闭互相区分、配置不丢」的存储面）。 */
export function mergeBehaviorOrderPreservingUnknown(
  nextOrder: readonly string[],
  previousOrder: readonly string[],
): string[] {
  const next = [...new Set(nextOrder)]
  const nextSet = new Set(next)
  // 不可见键按原序列锚点分组（null = 首个可见键之前）
  const anchored = new Map<string | null, string[]>([[null, []]])
  let anchor: string | null = null
  for (const key of previousOrder) {
    if (nextSet.has(key)) {
      anchor = key
      if (!anchored.has(anchor)) {
        anchored.set(anchor, [])
      }
    } else if (anchored.get(anchor)!.includes(key)) {
      continue // 历史重复只保留一次
    } else {
      anchored.get(anchor)!.push(key)
    }
  }
  const merged: string[] = [...anchored.get(null)!]
  for (const key of next) {
    merged.push(key)
    merged.push(...(anchored.get(key) ?? []))
  }
  return merged
}

/** T08（#357）行为信息序列化守卫：上报载荷（addon.behaviors.report 内层）
 * 来自 webview，进宿主目录前先过形态（与注册守卫同口径；回调不在信息面，
 * 无函数字段）。 */
export function isAddonBehaviorInfo(v: unknown): v is AddonBehaviorInfo {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false
  }
  const candidate = v as Record<string, unknown>
  if (typeof candidate.addonId !== 'string' || candidate.addonId.length === 0) {
    return false
  }
  if (!isUsableLocalId(candidate.id)) {
    return false
  }
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0 ||
    candidate.name.length > BEHAVIOR_NAME_LIMIT) {
    return false
  }
  if (candidate.description !== undefined &&
    (typeof candidate.description !== 'string' || candidate.description.length > BEHAVIOR_DESCRIPTION_LIMIT)) {
    return false
  }
  if (candidate.examples !== undefined) {
    if (!Array.isArray(candidate.examples) || candidate.examples.length > BEHAVIOR_EXAMPLES_MAX ||
      !candidate.examples.every((item) => typeof item === 'string' && item.length > 0 && item.length <= BEHAVIOR_EXAMPLE_LIMIT)) {
      return false
    }
  }
  if (candidate.exclusiveGroup !== undefined && !isUsableLocalId(candidate.exclusiveGroup)) {
    return false
  }
  return candidate.history === 'atomic' || candidate.history === 'joinPrevious'
}
