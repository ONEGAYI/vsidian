// #543 T03 附加组件文档打开与定位 API——两端共享的形状与守卫单一事实源。
//
// 事实源：docs/specs/addon-navigation.md §4（组件导航请求：载荷与归属、
// 解析执行与完成、失败语义）；N-U01–N-U07、N-U12。
//
// 边界（规格落档）：
// - 定位描述互斥：无定位 / 1-based 行号 / 标题 / 块 ID 四选一——行号与
//   其他锚点同报为非法形状（invalid-request，不执行打开）；
// - 本面仅编辑器页（views 面内）；设置页不提供；
// - 来源身份（组件 ID + 代次 + 来源实例文档）由 SDK 层注入，作者请求
//   不携带身份字段——不能冒充其他组件或伪造来源文档 URI；
// - 结果区分「是否打开」与「是否定位」——目标已打开但锚点失败不谎称
//   完整成功；首次行号越界不默默钳到末行；
// - 请求具有有界终态：来源释放 / 代次结束 / 面板关闭 / 定位未送达都返回
//   失败，不把仅调用 openWith 当作已定位成功。
//
// 本模块不依赖 vscode/DOM（与 addonEditApi 同分层）。

/** 定位描述（互斥三形态；缺省 = 无定位仅打开）。
 *  行号为 1-based 正整数；标题为不含 `#` 前缀的文本（与双链 [[目标#标题]]
 *  解析后形态一致）；块 ID 不含 `^` 前缀（与 [[目标#^id]] 解析后形态一致）。 */
export type AddonDocNavLocate =
  | { readonly kind: 'line'; readonly line: number }
  | { readonly kind: 'heading'; readonly heading: string }
  | { readonly kind: 'block'; readonly blockId: string }

/** 文档打开与定位请求（views.openDocument 的入参形状；来源身份由 SDK 注入）。
 *  target 为相对路径（按来源实例目标文档目录解析，越出所属根拦截）；
 *  空串 = 同文件锚点（目标即来源文档，沿双链 [[#锚点]] 语义，无需工作区）。 */
export interface AddonDocNavRequest {
  /** 来源视图实例 ID（views 面有效句柄；相对路径解析与来源存活判定基准） */
  readonly sourceInstanceId: string
  /** 目标路径（来源文档目录相对；空串 = 来源文档自身） */
  readonly target: string
  /** 可选定位描述（互斥；缺省仅打开） */
  readonly locate?: AddonDocNavLocate
}

/** 可辨认拒绝类型（规格 §4.3 失败语义表；接口冻结面） */
export type AddonDocNavRejection =
  /** 非法形状、非正整数行号或冲突定位；目标为附件类型（图片/PDF）也不
   *  在本面——一律不执行打开 */
  | 'invalid-request'
  /** 无工作区的跨文档请求（对齐双链 no-workspace 口径） */
  | 'no-workspace'
  /** 越出来源所属根 */
  | 'escape'
  /** 目标不存在（扩展名候选全未命中） */
  | 'not-found'
  /** 来源视图或请求代次失效（迟到执行拒收——旧偏移不抢回定位） */
  | 'view-disposed'
  /** 目标存在但标题/块 ID 未命中（opened 报告实际打开状态） */
  | 'anchor-not-found'
  /** 行号越出目标总行数（不自动钳到末行；opened 报告实际打开状态） */
  | 'out-of-bounds'
  /** 定位未送达（面板未就绪/已关闭或请求超时） */
  | 'delivery-failed'
  /** 宿主执行失败（打开/读取抛错） */
  | 'error'

/** 导航结果：成功分支区分 opened（目标已打开或重显）与 located（定位
 *  描述存在且已送达）；失败分支的 opened 报告失败前的实际打开状态。 */
export type AddonDocNavResult =
  | { ok: true; opened: boolean; located: boolean }
  | { ok: false; reason: AddonDocNavRejection; opened: boolean }

// ---- 守卫（SDK 入口、消息桥与宿主复核共用；非法请求不进入打开管线） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 定位描述形状守卫：互斥三形态逐项校验，多余定位字段整条拒绝 */
export function isAddonDocNavLocate(v: unknown): v is AddonDocNavLocate {
  if (!isRecord(v) || typeof v.kind !== 'string') {
    return false
  }
  switch (v.kind) {
    case 'line':
      return typeof v.line === 'number' && Number.isInteger(v.line) && v.line >= 1 &&
        v.heading === undefined && v.blockId === undefined
    case 'heading':
      return typeof v.heading === 'string' && v.heading.trim() !== '' &&
        v.line === undefined && v.blockId === undefined
    case 'block':
      return typeof v.blockId === 'string' && v.blockId !== '' && !v.blockId.startsWith('^') &&
        v.line === undefined && v.heading === undefined
    default:
      return false
  }
}

/** 请求形状守卫（views.openDocument 入参与协议消息内层共用） */
export function isAddonDocNavRequest(v: unknown): v is AddonDocNavRequest {
  if (!isRecord(v)) {
    return false
  }
  if (typeof v.sourceInstanceId !== 'string' || v.sourceInstanceId === '') {
    return false
  }
  if (typeof v.target !== 'string') {
    return false
  }
  return v.locate === undefined || isAddonDocNavLocate(v.locate)
}

/** 结果形状守卫（协议 addonDocNav.result 内层——回执失形按不可辨认丢弃） */
export function isAddonDocNavResult(v: unknown): v is AddonDocNavResult {
  if (!isRecord(v) || typeof v.ok !== 'boolean' || typeof v.opened !== 'boolean') {
    return false
  }
  if (v.ok === true) {
    return typeof v.located === 'boolean'
  }
  return (
    typeof v.reason === 'string' &&
    ['invalid-request', 'no-workspace', 'escape', 'not-found', 'view-disposed',
      'anchor-not-found', 'out-of-bounds', 'delivery-failed', 'error'].includes(v.reason)
  )
}
