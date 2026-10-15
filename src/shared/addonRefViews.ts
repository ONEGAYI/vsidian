// T05（#544）附加组件只读引用视图请求——两端共享的形状与守卫单一事实源。
//
// 事实源：docs/specs/addon-reference-views.md（#532 规格，§4 请求面与目标
// 语义 / §5 浮窗契约 / §7 失败与生命周期接口）。本模块承载公开 SDK
// refViews 面的数据形状、可辨认拒绝与「结构化目标 → 既有链接语义」的
// 纯转换；T06（组件容器嵌入）在同名 facet 上扩展挂载入口——本模块的
// 目标描述与来源语义是两票共用的内部复用接缝。
//
// 目标语义（规格 §4，不建第二套解析）：
// - 目标 = 路径 + 可选锚点（互斥四形态：标题 / 块 ID / 行号 / 行范围）；
// - 结构化目标在平台侧合成为**双链目标原文**（buildAddonRefHoverTarget），
//   复用既有 hoverDocAccess 三形态解析与 refText 行号/范围解析——Markdown
//   继续用全文/标题/块语义，非 Markdown 文本走 #line=/#range= 与
//   REF_TEXT_LIMITS 准入；不把文本附件锚点偷换成 Markdown fragment 新语法
//   （Markdown 目标携带行号/范围锚点按标题语义解析，缺失即真实失败）；
// - 空 path 仅在带锚点时合法（`[[#锚点]]` 页内语义：目标即来源文档自身）。
//
// 边界（票面「不包含」）：
// - 不开放自定义浮窗 DOM、目标写入或外链网络能力——触发位置是本页
//   在树元素（文字对应元素或组件自有控件），DOM 对象留在页面，不经
//   JSON 桥发宿主；
// - 不新增独立用户命令或默认快捷键；Esc/键盘进入沿既有浮窗路径。
import type { HoverPreviewFailReason } from './protocol'

/** 块 ID 字符集（与 shared/wikilink 的 BLOCK_ID_RE 同集——双链形态学对
 *  `#^id` 段的合法字符判定；导出供本模块守卫与测试共用单一事实源） */
export const ADDON_REF_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/

/** 结构化锚点（互斥四形态；缺省 = 无锚点全文/全文窗口） */
export type AddonRefAnchor =
  /** Markdown 标题章节（标题原文；空 path 时为来源文档页内锚点） */
  | { kind: 'heading'; heading: string }
  /** Markdown 块 ID（`^id` 的 id 段；字符集同双链形态学） */
  | { kind: 'block'; blockId: string }
  /** 1-based 行号（非 Markdown 文本目标：#line= 语义；Markdown 目标按
   *  标题语义解析「line=N」原文——沿用既有双链行为，不新增片段语法） */
  | { kind: 'line'; line: number }
  /** 1-based 闭区间行范围（非 Markdown 文本目标：#range= 语义；同上，
   *  Markdown 目标不改变既有语义） */
  | { kind: 'range'; startLine: number; endLine: number }

/** 只读引用目标：根内路径 + 可选锚点 */
export interface AddonRefTargetSpec {
  /** 目标路径（vault 语义：相对来源文档目录或根内 `/` 绝对形态，无扩展
   *  名按双链意图补 .md——与既有解析同源）。空串仅在带锚点时合法（页内） */
  path: string
  anchor?: AddonRefAnchor
}

/** 只读引用浮窗请求（公共载荷：来源实例 + 目标 + 触发位置；组件身份与
 *  代次由 SDK 注入——请求结构上不携带身份字段） */
export interface AddonRefPopupRequest {
  /** 来源实例（views 面 instanceId：'main' / 'embed:<hostId>' /
   *  'hover:<instanceId>'）。相对路径以该实例的目标文档解析（R-U02：
   *  B 中的请求不误用父文档 A 的目录） */
  source: string
  /** 目标（结构化路径 + 可选锚点） */
  target: AddonRefTargetSpec
  /** 触发位置：本页在树元素（文字对应元素或组件自有控件）。脱树元素
   *  非法——不猜测另一处位置，不创建无锚点空浮窗 */
  trigger: HTMLElement
  /** 显式键盘请求：焦点进入浮层可操作域，Esc 关闭后归还原焦点；缺省
   *  鼠标语义（零抢焦点、移出延迟关闭） */
  keyboard?: boolean
}

/** 可辨认拒绝（规格 §7：普通结果区分；不折叠为 not-found）：
 *  - invalid-request：形状/来源/触发位置非法（不创建浮窗）；
 *  - view-disposed：来源实例不存在或已销毁、请求被替换/关闭（迟到结果
 *    与旧句柄的终结口径）；
 *  - released：组件代次已终结（装载器守卫——旧代次请求不再有有效来源）；
 *  - HoverPreviewFailReason 透传：目标解析/读取/锚点/准入超限的真实原因
 *    （not-found / escape（越出所属根）/ anchor-invalid / file-too-large …），
 *    浮窗同时以现有引用错误视图就地显示（invalid-request 除外）。 */
export type AddonRefPopupRejection =
  | 'invalid-request'
  | 'view-disposed'
  | 'released'
  | HoverPreviewFailReason

/** 本次请求的关闭句柄：身份只针对本组件本代次的这一次请求（规格 §7） */
export interface AddonRefPopupHandle {
  /** 关闭本请求的浮窗（幂等；浮窗已换主或已关时返回 false——旧句柄不
   *  误关后来另一组件的浮窗） */
  close(): boolean
  /** 本请求的浮窗是否仍在场（被替换/Esc/移出/域失效关闭后为 false） */
  isActive(): boolean
}

export type AddonRefPopupOutcome =
  | { ok: true; handle: AddonRefPopupHandle }
  | { ok: false; reason: AddonRefPopupRejection }

/** SDK refViews 面（仅编辑器页提供；设置页为 undefined）。T05（#544）
 *  首版只含浮窗请求；T06 在同一 facet 上扩展组件容器挂载入口 */
export interface AddonSdkRefViewsFacet {
  /** 请求只读引用浮窗（单页单浮窗：新请求替换旧请求，旧请求句柄随之
   *  失效）。结果在读取结局落定时兑现：内容装载成功 → ok + 句柄；目标
   *  解析/读取/锚点失败 → 失败原因（浮窗若在场显示真实错误分态）；请求
   *  被替换或关闭 → view-disposed */
  requestPopup(request: AddonRefPopupRequest): Promise<AddonRefPopupOutcome>
}

// ---- 守卫（SDK 请求入口与测试共用；非法请求不进入浮窗管线） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1
}

/** 路径可表达性：双链目标原文形态学（parseWikilinkInner）不可承载的
 *  字符直接拒绝——`#` 是锚点分割、`^` 是块引用前缀、`|` 是别名分割、
 *  换行破坏消息形态。路径两侧空白由解析侧 trim（与双链原文同口径） */
function isExpressibleRefText(value: string): boolean {
  return !value.includes('#') && !value.includes('^') && !value.includes('|') && !value.includes('\n')
}

export function isAddonRefAnchor(v: unknown): v is AddonRefAnchor {
  if (!isRecord(v) || typeof v.kind !== 'string') {
    return false
  }
  switch (v.kind) {
    case 'heading':
      return typeof v.heading === 'string' && v.heading.trim() !== '' && isExpressibleRefText(v.heading)
    case 'block':
      return typeof v.blockId === 'string' && ADDON_REF_BLOCK_ID_RE.test(v.blockId)
    case 'line':
      return isPositiveInt(v.line)
    case 'range':
      return isPositiveInt(v.startLine) && isPositiveInt(v.endLine) && v.startLine <= v.endLine
    default:
      return false
  }
}

export function isAddonRefTargetSpec(v: unknown): v is AddonRefTargetSpec {
  if (!isRecord(v) || typeof v.path !== 'string') {
    return false
  }
  if (v.anchor !== undefined && !isAddonRefAnchor(v.anchor)) {
    return false
  }
  // 空 path 仅在带锚点时合法（页内锚点——目标即来源文档自身）
  if (v.path === '' && v.anchor === undefined) {
    return false
  }
  return isExpressibleRefText(v.path)
}

/** 请求形状守卫（trigger 在共享层只钉对象在场性——DOM 元素与在树性由
 *  webview 运行时校验，共享模块不依赖 DOM） */
export function isAddonRefPopupRequest(v: unknown): v is AddonRefPopupRequest {
  if (!isRecord(v)) {
    return false
  }
  return typeof v.source === 'string' && v.source !== '' &&
    isAddonRefTargetSpec(v.target) &&
    v.trigger !== null && typeof v.trigger === 'object' &&
    (v.keyboard === undefined || typeof v.keyboard === 'boolean')
}

/**
 * 结构化目标 → 双链目标原文（hover.request 的 target 形态）：路径与锚点
 * 按既有形态学拼装——heading `路径#标题`、block `路径#^id`、line
 * `路径#line=N`、range `路径#range=A-B`、无锚点即路径本身。返回 null =
 * 形态不可表达（守卫已拦；防御性兜底，不静默降级）。合成原文走与真实
 * 双链完全相同的解析与准入链路（R-U03：行号/范围/大小限制均为既有规则）。
 */
export function buildAddonRefHoverTarget(target: AddonRefTargetSpec): string | null {
  if (!isAddonRefTargetSpec(target)) {
    return null
  }
  const path = target.path
  const anchor = target.anchor
  if (anchor === undefined) {
    return path
  }
  switch (anchor.kind) {
    case 'heading':
      return `${path}#${anchor.heading}`
    case 'block':
      return `${path}#^${anchor.blockId}`
    case 'line':
      return `${path}#line=${anchor.line}`
    case 'range':
      return `${path}#range=${anchor.startLine}-${anchor.endLine}`
  }
}
