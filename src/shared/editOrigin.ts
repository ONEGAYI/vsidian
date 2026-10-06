// T03（#352）可选编辑来源与原子操作归属元数据——公开编辑 API（T06 落地）
// 的接入面基础类型。事实源：docs/specs/vsidian-addons-tickets/t03.md、
// docs/design/vsidian-addon-api.md 第 6 节、ADR-0012 Q29、V01 验证报告
// （docs/research/vsidian-addons-v01-history-probe.md）的接入点要求。
//
// 边界（票面）：
// - **不是已发布 SDK**：本模块只定义经 edit.request / HostDocumentPort /
//   版本确认管线贯通的**可选**元数据形状；组件侧 applyEdits 公开入口属
//   T06，本票不开放、不发布。
// - 不用文本显示名充当身份：addonId 沿用 T01 身份体系的组件规范 ID
//   （Extension.id，publisher.name 形态），opId 为一次修饰提交的操作身份。
// - 旧调用缺省不携带 origin，走原行为（契约等价由
//   test/unit/documentSessionEditOrigin.test.ts 钉住）。

/** 一次修饰提交的可选来源与撤回边界元数据 */
export interface EditOriginMeta {
  /** 来源组件规范 ID（T01 身份体系：Extension.id 的 publisher.name 形态；
   *  非空、无空白字符） */
  addonId: string
  /** 修饰操作 ID：一次提交的唯一标识（来源跟踪；非空、无空白字符） */
  opId: string
  /** 撤回边界（ADR-0012 Q29）：atomic = 建立独立撤销项的原子操作；
   *  joinPrevious = 不建立独立撤销项，随同同一目标文档的上次原子操作
   *  撤回（非原子操作仍跟踪，不省略来源记录） */
  undo: 'atomic' | 'joinPrevious'
}

/** 身份字段上限（防滥用；正常 Extension.id 与操作 ID 远小于此） */
const ORIGIN_ID_LIMIT = 256

function isUsableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= ORIGIN_ID_LIMIT && !/\s/.test(value)
}

/** 形状校验：edit.request 携带的 origin 须通过本判定才进入写回管线 */
export function isEditOriginMeta(v: unknown): v is EditOriginMeta {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false
  }
  const candidate = v as { addonId?: unknown; opId?: unknown; undo?: unknown }
  return isUsableId(candidate.addonId) && isUsableId(candidate.opId) &&
    (candidate.undo === 'atomic' || candidate.undo === 'joinPrevious')
}

/** 是否存在净文本变更（多段任一非空即真）。origin 在场且无净变更的请求
 *  是纯选区事务：不写回、不造宿主历史项、不留来源记录（票面验收） */
export function hasNetTextChange(changes: readonly { length: number; text: string }[]): boolean {
  return changes.some((c) => c.length > 0 || c.text.length > 0)
}
