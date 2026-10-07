// T06（#355）附加组件统一视图编辑 API——两端共享的形状与守卫单一事实源。
//
// 事实源：docs/specs/vsidian-addons-tickets/t06.md、docs/design/
// vsidian-addon-api.md §5.1（视图/快照/文本提交）、ADR-0012 Q29（修饰与
// 撤回产品规则）、V01 验证报告（docs/research/vsidian-addons-v01-
// history-probe.md）。
//
// 边界（票面）：
// - **随消费样例冻结的接口名称、错误类型与提交凭据**：本模块定义公开
//   SDK views 面的数据形状；组件不引用内部控制器或稳定 EditorView。
// - 公开坐标 UTF-16/LF（webview 全程 LF，宿主适配器继续负责行尾转换）。
// - 来源由 SDK 的组件上下文添加（addonId/opId），作者请求不携带身份字段
//   ——不能冒充其他组件。
// - 旧快照、只读、已释放或失活写入明确拒绝（可辨认拒绝类型枚举）。
import type { SerChange } from './protocol'
import { isSerChange } from './protocol'

/** 视图种类：main = 面板主正文；embed = 嵌入内部 Live；hover = 悬停引用
 *  （只读预览，无写端口） */
export type AddonViewType = 'main' | 'embed' | 'hover'

/** 视图模式：live 可写（CM6 实例在场）；reading 只读（阅读形态） */
export type AddonViewMode = 'live' | 'reading'

/** views.list() 返回的有效实例句柄信息（设计 §5.1：实例/目标/模式/可编辑） */
export interface AddonViewInfo {
  /** 页面内稳定实例 ID：main 恒 'main'；embed/hover 为 occurrence 键 */
  instanceId: string
  /** 目标文档 URI（主正文 = 面板文档；embed/hover = 引用目标） */
  targetDocUri: string
  mode: AddonViewMode
  viewType: AddonViewType
  editable: boolean
}

/** 选区范围（LF 偏移；anchor/head 与 CM6 语义一致） */
export interface AddonSelectionRange {
  anchor: number
  head: number
}

/** view.editor.getSnapshot() 结果（设计 §5.1：文本、多选区、权威版本、
 *  快照修订标记） */
export interface AddonEditorSnapshot {
  /** 页面文本（UTF-16/LF；含页面未确认输入——快照描述视图现状） */
  text: string
  /** 多选区（有序；只读视图为空数组） */
  selections: AddonSelectionRange[]
  /** 权威文档版本（页面已确认到的宿主版本） */
  version: number
  /** 快照修订标记：页面文档代次计数（本地输入与外部同步都推进）。
   *  提交请求携带快照 revision，执行时点失配即拒绝 stale-snapshot——
   *  覆盖「宿主版本未变但页面有未确认输入」的窗口（设计 §5.1：修订
   *  标记不能只看尚未包含页面未确认状态的宿主版本） */
  revision: number
}

/** 撤回边界声明（ADR-0012 Q29）：缺省 atomic；joinPrevious = 不建立独立
 *  撤销项、随同同目标上次原子操作撤回（仍逐次跟踪，无可确认前项拒绝） */
export type AddonEditHistory = 'atomic' | 'joinPrevious'

/** applyEdits 请求（作者提供的业务修改；来源身份由 SDK 注入，不在此形） */
export interface AddonApplyEditsRequest {
  /** 快照修订标记（getSnapshot 返回值；失配 = 旧快照，明确拒绝） */
  revision: number
  /** 变更列表（LF 坐标，多范围 = 一笔修饰操作，Q29：不按底层变更拆分） */
  changes: SerChange[]
  /** 提交后选区（随同一事务原子应用；缺省保持实例现有选区重定位） */
  selection?: AddonSelectionRange
  /** 撤回边界声明；缺省 atomic */
  history?: AddonEditHistory
}

/** 可辨认拒绝类型（接口冻结面；新增值视为契约变更） */
export type AddonEditRejection =
  /** 句柄已释放 / 实例已销毁 */
  | 'view-disposed'
  /** 只读视图（hover 引用、reading 态主正文）不接受写入 */
  | 'read-only'
  /** 视图失活（冲突暂停写回） */
  | 'suspended'
  /** 快照修订失配（旧快照；内核输入重定位不适用于 API 提交，不自动重试） */
  | 'stale-snapshot'
  /** joinPrevious 无可确认的同目标前项（HistoryBoundaryUnavailable 语义：
   *  空日志、仅外来写入、组顶被外来写入打断、映射失配四种形态） */
  | 'history-boundary'
  /** 宿主冲突拒绝（不可安全重定位 / 暂停面板） */
  | 'conflict'
  /** 宿主写回失败 */
  | 'error'
  /** 请求形状非法（revision/changes/selection 越界或类型错误） */
  | 'invalid-request'

/** 提交凭据（宿主确认后签发；与该笔 edit.ack(ok) 同源版本） */
export interface AddonEditCredential {
  /** 本次修饰操作 ID（SDK 注入；凭据可对账来源记录） */
  opId: string
  /** 宿主确认版本 */
  version: number
}

export type AddonApplyEditsResult =
  | { ok: true; credential: AddonEditCredential }
  | { ok: false; reason: AddonEditRejection }

export type AddonSnapshotResult =
  | { ok: true; snapshot: AddonEditorSnapshot }
  | { ok: false; reason: 'view-disposed' }

// ---- 守卫（SDK 请求入口与测试共用；非法请求不进入编辑管线） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

export function isAddonSelectionRange(v: unknown): v is AddonSelectionRange {
  return isRecord(v) && isNonNegativeInt(v.anchor) && isNonNegativeInt(v.head)
}

/** applyEdits 请求形状守卫：非法形态按 invalid-request 拒绝，不进入
 *  CM6 事务（无效变更在 dispatch 前拦截——CM6 会抛出而非拒绝） */
export function isAddonApplyEditsRequest(v: unknown): v is AddonApplyEditsRequest {
  if (!isRecord(v)) {
    return false
  }
  if (!isNonNegativeInt(v.revision)) {
    return false
  }
  if (!Array.isArray(v.changes) || !v.changes.every(isSerChange)) {
    return false
  }
  if (v.selection !== undefined && !isAddonSelectionRange(v.selection)) {
    return false
  }
  return v.history === undefined || v.history === 'atomic' || v.history === 'joinPrevious'
}

export function isAddonViewInfo(v: unknown): v is AddonViewInfo {
  if (!isRecord(v)) {
    return false
  }
  return typeof v.instanceId === 'string' && v.instanceId.length > 0 &&
    typeof v.targetDocUri === 'string' && v.targetDocUri.length > 0 &&
    (v.mode === 'live' || v.mode === 'reading') &&
    (v.viewType === 'main' || v.viewType === 'embed' || v.viewType === 'hover') &&
    typeof v.editable === 'boolean'
}
