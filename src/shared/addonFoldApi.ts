// #410 附加组件标题折叠 API——两端共享的形状与守卫单一事实源。
//
// 边界（票面 #410 + #409 规格定案）：
// - **experimental 入口**：挂在页面 SDK 的 experimental.headingFold，使用
//   前须在清单 experimental 声明 headingFold 兼容范围；实验入口可能随
//   版本调整，不随稳定 API 弃用期限承诺（对齐 cm6 入口治理形态）。
// - **Live-only**：折叠承载于 Live 实例的 CM6 StateField（视图态：零写回、
//   不 dirty、不进撤销栈、不跨会话持久化）；#409 定案阅读模式不开放——
//   reading 态与只读视图（hover）一律 read-only 拒绝。
// - **查询口径单一**：folds = 有效折叠派生视图（折叠键 ∩ 可折叠标题键，
//   脱靶键经派生过滤——原始键集不对外）；foldable = 可折叠区间全集。
//   区间形状与本体 HeadingFoldSpan 同构（key/level/hideFrom/hideTo），
//   序列化面保持精简——不含标题文本摘要（大文档下每标题行切片徒增
//   开销，作者可从快照 text 与 hideFrom 前标题行自取）。
// - **命令与用户触发同链路**：apply 直传本体五操作执行体（effect 直驱
//   + 光标迁移）；foldAt/unfoldAt 是既有 effect 的批量组合（键集并/差后
//   整体设置）；无 DOM-only 路径。操作字面量到本体五操作 id 的映射在
//   webview 消费层（addonViews——本体执行体定义于 src/webview/headingFold，
//   shared 不依赖 webview）。

/** 折叠区间（LF 偏移；与本体派生视图同构）。key 同时是 foldAt/unfoldAt
 *  的区间定位键——只能来自查询结果（作者自算坐标属脱靶风险自负） */
export interface AddonHeadingFoldSpan {
  /** 折叠键：标题起始行行首 offset（ATX = `#` 行行首；Setext = 内容首行行首） */
  key: number
  /** 标题级别（ATX 1–6 / Setext 1–2） */
  level: number
  /** 隐藏区间起点：标题块行尾（标题行保持可见） */
  hideFrom: number
  /** 隐藏区间终点：下一级别 ≤ 自身的标题行行首，或文档末尾 */
  hideTo: number
}

/** 命令操作（与本体五操作一一对应，编程触发与用户触发同链路）：
 *  fold/unfold/toggle 为选区驱动（按实例当前选区解析目标——组件可先经
 *  views 面 setSelection 定位）；foldAll/unfoldAll 作用全文档 */
export type AddonHeadingFoldOperation = 'fold' | 'unfold' | 'toggle' | 'foldAll' | 'unfoldAll'

/** apply 可选参数（形状守卫见 isAddonHeadingFoldApplyOptions） */
export interface AddonHeadingFoldApplyOptions {
  /** 仅 foldAll 接受：折叠级别上限（level ≤ upToLevel 的可折叠标题才折叠；
   *  合法值 1–6 整数）。其他操作携带即 invalid-request */
  upToLevel?: number
}

/** 拒绝类型（接口冻结面；新增值视为契约变更）：view-disposed = 句柄已
 *  释放/实例已销毁/组件代次已终结；read-only = Live-only 边界（reading
 *  态或 hover 只读视图）；invalid-request = 请求形状非法 */
export type AddonHeadingFoldRejection = 'view-disposed' | 'read-only' | 'invalid-request'

/** 查询结果（spans 按文档序） */
export type AddonHeadingFoldQueryResult =
  | { ok: true; spans: readonly AddonHeadingFoldSpan[] }
  | { ok: false; reason: 'view-disposed' | 'read-only' }

/** 命令结果：applied = 实际发生折叠/展开变更的区间数（有效派生口径的
 *  前后变化数；0 = 无目标或重复提交的静默 no-op） */
export type AddonHeadingFoldCommandResult =
  | { ok: true; applied: number }
  | { ok: false; reason: AddonHeadingFoldRejection }

/** 折叠面（experimental.headingFold 的内容；仅编辑器页提供）。方法按
 *  views 面的实例 ID 寻址——主正文 'main'、嵌入内部 Live 为 occurrence
 *  键（views.list 枚举），折叠态随实例独立 */
export interface AddonHeadingFoldFacet {
  /** 有效折叠区间（派生视图：脱靶键过滤，原始键集不对外） */
  folds(instanceId: string): AddonHeadingFoldQueryResult
  /** 全部可折叠标题区间（空节/纯空白节排除） */
  foldable(instanceId: string): AddonHeadingFoldQueryResult
  /** 五操作执行（选区驱动三操作 + 全文档两操作；upToLevel 仅 foldAll） */
  apply(
    instanceId: string,
    operation: AddonHeadingFoldOperation,
    options?: AddonHeadingFoldApplyOptions,
  ): AddonHeadingFoldCommandResult
  /** 按区间键折叠（键集并入；键须来自查询结果，脱靶键静默忽略） */
  foldAt(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult
  /** 按区间键展开（键集差集；脱靶键静默忽略） */
  unfoldAt(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult
}

// ---- 守卫（SDK 请求入口与测试共用；非法请求不进入折叠管线） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** apply 可选参数守卫：upToLevel 缺省合法；在场须为 1–6 整数 */
export function isAddonHeadingFoldApplyOptions(v: unknown): v is AddonHeadingFoldApplyOptions {
  if (!isRecord(v)) {
    return false
  }
  if (v.upToLevel === undefined) {
    return true
  }
  return typeof v.upToLevel === 'number' && Number.isInteger(v.upToLevel) && v.upToLevel >= 1 && v.upToLevel <= 6
}

/** 区间键集守卫：非空要求不设（空集 = no-op）；在场须全为非负整数 */
export function isAddonHeadingFoldKeyList(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.every((key) => typeof key === 'number' && Number.isInteger(key) && key >= 0)
}

/** 操作字面量守卫（SDK 运行时边界：JS 组件可传任意字符串） */
export function isAddonHeadingFoldOperation(v: unknown): v is AddonHeadingFoldOperation {
  return v === 'fold' || v === 'unfold' || v === 'toggle' || v === 'foldAll' || v === 'unfoldAll'
}
