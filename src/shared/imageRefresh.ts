// 图片定期刷新共享契约（工单 #201）：两端共用的工程常量与周期核验决策
// 纯函数。语义来自 #194「图片定期刷新与删除态」节。
//
// 常量为工程初值（集中可调，经开销实测调整），不等于网络条件下的刷新
// 时限承诺：
// - 周期核验间隔约 30 秒（可见面板已挂载图源合并核验一次）
// - watcher 事件去抖：图片保存器写临时文件 + rename 会产生成组事件
// - 宿主唤醒（窗口焦点回归触发及时核验）节流
//
// 边界（本票不覆盖）：HTTP(S) 直连图源不走本管线（imageResource 的
// isDirectSrc 分支），不纳入刷新；无工作区时无 watcher，靠周期核验与
// 按需 stat 兜底。

/** 周期核验间隔（工程初值）：活跃挂载图源每约 30 秒合并 stat 核验一次 */
export const IMAGE_VERIFY_INTERVAL_MS = 30_000

/** 文件事件去抖（工程初值）：成组事件归并为一次核验 */
export const IMAGE_EVENT_DEBOUNCE_MS = 400

/** 唤醒节流（工程初值）：窗口焦点回归广播的及时核验最小间隔 */
export const IMAGE_WAKE_MIN_GAP_MS = 5_000

/**
 * 图片文件扩展清单（小写；watcher glob 段与事件过滤同源）。与粘贴落盘
 * 的 mime 映射（imagePastePlan）口径对齐：覆盖常见位图/矢量格式；其余
 * 扩展的文件不经图片管线呈现，不监听。#336（P3-04）起纳入 apng——动图
 * PNG 以独立扩展名存在时同走图片管线（解码由 Chromium 的 PNG 路径承担，
 * 格式下界实测矩阵见 test/browser/imageEmbedParity.mjs）。
 */
export const IMAGE_WATCH_GLOB_SEGMENTS: readonly string[] = [
  'png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]

/** 路径是否图片类文件（按扩展名；大小写不敏感） */
export function isImageFileExtension(fsPath: string): boolean {
  const dot = fsPath.lastIndexOf('.')
  if (dot < 0) {
    return false
  }
  const ext = fsPath.slice(dot + 1).toLowerCase()
  return IMAGE_WATCH_GLOB_SEGMENTS.includes(ext)
}

/**
 * stat 探测失败错误码分类（#198/#201 三处同形判定收敛）：`FileNotFound`
 * （vscode.workspace.fs 语义）与 `ENOENT`（node fs 透传）表示目标明确
 * 不存在；其余失败（NoPermissions/Unavailable——SSH 断连等）为不可访问，
 * 不得等同删除。调用点：图片解析（resolveWorkspaceImage）、图片刷新
 * 协调（statTarget 端口）与引用索引可访问性探测（vaultIndexWiring
 * accessOf）——三态口径同源。
 */
export function isFileNotFound(err: unknown): boolean {
  const code = (err as { code?: string }).code
  return code === 'FileNotFound' || code === 'ENOENT'
}

/** webview 上报的单条活跃图源状态（image.verify 载荷项） */
export interface ImageVerifyItem {
  /** 文档内图源原文（normalizeImgSrc 归一后） */
  src: string
  /** 条目当前呈现态（entry 级汇总） */
  state: 'loaded' | 'loading' | 'error'
  /** error 态原因码（image.result 的 reason 或 load-failed） */
  reason?: string
}

/** 宿主侧单次 stat 的三态结果（fsKey 归并后喂入决策） */
export type ImageStatOutcome =
  | { kind: 'ok'; mtimeMs: number; size: number }
  | { kind: 'missing' }
  | { kind: 'inaccessible' }

/** 单个文件目标的核验处置：current = 维持不重载；refresh = 失效重取 */
export type ImageVerifyAction = 'current' | 'refresh'

/** 决策输入条目：上报项 + 宿主解析出的归一目标键 */
export interface ImageVerifyInputItem extends ImageVerifyItem {
  fsKey: string
}

/**
 * 周期核验决策（纯函数）：对按 fsKey 归并的活跃条目统一判定。
 *
 * - stat ok 且元数据与版本表最后已知相同且无 error 态条目 → current
 *   （「元数据未变不强制重载/解码」；loading 在途同样不打扰）
 * - 其余 → refresh：元数据变化（宿主执行 recordObservation 自然 bump 出
 *   新 URI）、曾缺失后恢复（lastKnown 为空）、呈现态与磁盘真相不符
 *   （loaded 但磁盘缺失 / inaccessible 但已恢复 / not-found 但文件回来）
 * - 维持态不扰动：全部条目已呈 not-found（stat missing）或已呈
 *   inaccessible（stat inaccessible）→ current（周期核验覆盖失败槽位，
 *   恢复由「呈现态不符」分支检出，不产生广播风暴）
 *
 * inaccessible 不触碰版本表元数据（文件可能未变）：恢复时 refresh 重发
 * 请求，recordObservation 语义下元数据相同不 bump，URI 不变，浏览器
 * 缓存命中即可恢复显示（无需网络重取）。
 *
 * 返回 fsKey → 动作；宿主对 refresh 键执行 stat 写回版本表 + 失效广播。
 */
export function planImageVerification(
  items: readonly ImageVerifyInputItem[],
  statOf: (fsKey: string) => ImageStatOutcome,
  lastKnownOf: (fsKey: string) => { mtimeMs: number; size: number } | null,
): Map<string, ImageVerifyAction> {
  // 按 fsKey 归并（同文件多 src 形态一次判定）
  const byKey = new Map<string, ImageVerifyInputItem[]>()
  for (const item of items) {
    const list = byKey.get(item.fsKey)
    if (list) {
      list.push(item)
    } else {
      byKey.set(item.fsKey, [item])
    }
  }
  const out = new Map<string, ImageVerifyAction>()
  for (const [key, group] of byKey) {
    const stat = statOf(key)
    if (stat.kind === 'ok') {
      const known = lastKnownOf(key)
      const metaSame =
        known !== null && known.mtimeMs === stat.mtimeMs && known.size === stat.size
      const anyError = group.some((item) => item.state === 'error')
      out.set(key, metaSame && !anyError ? 'current' : 'refresh')
      continue
    }
    // missing / inaccessible：呈现态与磁盘真相相符的维持，否则刷新
    const holdReason = stat.kind === 'missing' ? 'not-found' : 'inaccessible'
    const allHolding = group.every(
      (item) => item.state === 'error' && item.reason === holdReason,
    )
    out.set(key, allHolding ? 'current' : 'refresh')
  }
  return out
}
