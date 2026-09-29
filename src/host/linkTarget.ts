// 链接/图片目标分类（工单 #10）：宿主侧 URI 解析与路径拼接的纯逻辑核心。
//
// 职责边界（架构事实：webview 只上报原始 href/src，URI 解析必须在宿主侧）：
// - scheme 白名单：仅 http/https 外开（env.openExternal）；其余带 scheme 的
//   一律拦截（file://、javascript:、vscode-asset:、mailto:、协议相对 //…），
//   由 vscode 层给用户可见反馈
// - 工作区路径：基于当前文档所在目录解析，不得越过资源根（工作区文件夹
//   根；无工作区时为文档目录）——"路径不能静默越过工作区边界"
// - Windows 与远程不混用：Windows 盘符/反斜杠语义只在 Windows 扩展宿主
//   生效（远程 SSH 宿主是 POSIX 进程，天然只认 POSIX 路径）；Windows
//   路径出现在 POSIX 宿主时拦截而非误解析
// - 相对路径、空格、中文与 %编码：percent-decode 容错（源文原样或已编码
//   两种写法解析到同一目标）
// - 文档链接无扩展名：候选为「精确路径优先，其次补 .md」（与 #11 双链
//   「扩展名省略按 Markdown 处理」同语义）
// - 锚点 fragment（#160）：CommonMark 语义取首个 `#`——其前为路径、其后
//   整段为 fragment，结构化保留供执行层定位（不再静默丢弃）；仅锚点
//   （#frag）解析为本文件锚点目标；外部 scheme（http/https 等）的 `#`
//   是网页锚点语义不接管，照旧外开；图片通道无锚点语义，`#` 开头维持拦截
//
// 本模块不依赖 vscode（可在 node 单测直驱）；fsPath 语义由注入的
// LinkContext 提供，vscode 层负责 Uri ↔ fsPath 的双向换算（同一扩展宿主
// 内 round-trip，天然不混用本地与远程 URI）。
import * as path from 'node:path'

/** 目标解析上下文（宿主文件系统语义由注入方描述） */
export interface LinkContext {
  /** 当前文档所在目录（绝对 fsPath，宿主平台分隔符） */
  docDir: string
  /** 资源根（工作区文件夹根；无工作区时为文档目录）的绝对 fsPath */
  rootDir: string
  /** 宿主文件系统是否 Windows 语义（本地 Windows 为 true；远程一律 false） */
  isWindowsHost: boolean
}

/** 链接目标分类结果 */
export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'doc'; candidates: string[]; fragment: string | null }
  | {
      /** 本文件锚点目标（#160：`#frag` 省略路径，目标即当前文档） */
      kind: 'anchor'
      /** 容错 percent-decode 后的锚点文本（空串已被拦截） */
      fragment: string
    }
  | {
      kind: 'blocked'
      reason: 'empty' | 'scheme' | 'escape' | 'windows-drive-on-posix'
      /** scheme 拦截时的协议名（小写；协议相对为空串） */
      scheme?: string
      detail?: string
    }

/** 图片目标分类结果（webview 只对非 http(s) 图源走宿主通道） */
export type ImageTarget =
  | { kind: 'workspace'; fsPath: string }
  | {
      kind: 'blocked'
      reason: 'empty' | 'scheme' | 'escape' | 'windows-drive-on-posix'
      scheme?: string
      detail?: string
    }

/** 宿主图片解析结果（会话经面板端口注入实现；reason 与协议 image.result 对齐） */
export type ImageResolution =
  | { ok: true; src: string }
  | {
      ok: false
      reason: 'blocked' | 'outside-workspace' | 'not-found' | 'read-error'
      detail?: string
    }

/**
 * #208 图片 webview URI 的资源代次戳（缓存击穿参数，CSS 片段 ?v= 同式：
 * webview 资源服务不承诺无缓存）：同名图片被外部替换后地址随代次变化。
 * generation 取会话资源代次（getImageGeneration）——0 为未刷新初值，
 * 不戳（URI 形态与现状一致），≥ 1 为历次手动刷新后的代次。
 */
export function appendImageVersionStamp(uri: string, generation: number): string {
  return generation > 0 ? `${uri}?v=${generation}` : uri
}

/** 协议名提取（file:、javascript: 等；不含 Windows 盘符形态——盘符在
 *  Windows 宿主上先于此检查被识别为路径） */
function schemeOf(text: string): { scheme: string; rest: string } | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):(.*)$/.exec(text)
  if (!m) {
    return null
  }
  return { scheme: m[1]!.toLowerCase(), rest: m[2]! }
}

/** Windows 盘符绝对路径（c:\x 或 C:/x）；仅在 Windows 宿主上有路径语义 */
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/].*/

/** 容错 percent-decode：非法序列按原样保留（混合编码的防御） */
function tolerantDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** 按注入语义选择路径实现：Windows/POSIX 分类不得依赖运行进程的平台
 *  （在 Windows 上跑单测也必须能验 POSIX 远程语义，反之亦然） */
function pathOps(ctx: LinkContext) {
  return ctx.isWindowsHost ? path.win32 : path.posix
}

/**
 * CommonMark 语义的 href 拆分（#160）：**首个** `#` 之前为路径部分、之后
 * 整段为 fragment（`./a#b.md` 拆为 `./a` + `b.md`——路径本身含 `#` 属
 * 已知边界）；`#` 后为空串时无 fragment。fragment 做容错 percent-decode
 * （阅读侧 href 经 markdown-it normalizeLink 编码、live 侧为字面原文，
 * 两种写法须解析到同一锚点——与路径同口径）；空 fragment 解码后回空串
 * 交由调用方按「无可定位目标」处置。
 */
function splitHrefFragment(
  href: string,
): { pathText: string; fragment: string | null } {
  const hashIdx = href.indexOf('#')
  if (hashIdx < 0) {
    return { pathText: href, fragment: null }
  }
  const rawFragment = href.slice(hashIdx + 1)
  if (rawFragment === '') {
    return { pathText: href.slice(0, hashIdx), fragment: null }
  }
  return { pathText: href.slice(0, hashIdx), fragment: tolerantDecode(rawFragment) }
}

/** 解析为工作区内的绝对路径：返回绝对 fsPath；越出资源根返回 null */
function resolveInside(href: string, ctx: LinkContext): string | null {
  // 剥掉 #fragment 与 ?query（路径部分才参与解析；链接通道的 fragment 已
  // 由 #160 的 splitHrefFragment 结构化保留，此处剥除对图片通道与防御性
  // 重复剥除均为无操作——pathText 无 # 时 split('#')[0] 即原文）
  const withoutHash = href.split('#')[0]!
  const pathPart = withoutHash.split('?')[0]!
  let p = tolerantDecode(pathPart.trim())
  // Windows 宿主上统一分隔符（远程 POSIX 宿主不转换：正斜杠本就合法，
  // 反斜杠是普通文件名字符——两类语义不得混用）
  if (ctx.isWindowsHost) {
    p = p.replace(/\\/g, '/')
  }
  if (p === '') {
    return null
  }
  const ops = pathOps(ctx)
  const absolute = ops.resolve(ctx.docDir, p)
  if (!isInsideRoot(absolute, ctx.rootDir, ops)) {
    return null
  }
  return absolute
}

/** absolute 是否位于 root 内（含 root 本身） */
function isInsideRoot(
  absolute: string,
  rootDir: string,
  ops: ReturnType<typeof pathOps>,
): boolean {
  const rel = ops.relative(rootDir, absolute)
  if (rel === '') {
    return true
  }
  return rel !== '..' && !rel.startsWith(`..${ops.sep}`) && !ops.isAbsolute(rel)
}

/** Windows 宿主的 Win32 规范化怪异形态：basename 含 ':'（NTFS 备用数据流，
 *  如 note.md::$DATA 会读备用数据流）或尾随 '.'/空白（规范化剥除后不指向
 *  用户可见文件——含 tab 等 trim 家族空白，点+tab 组合同样被 Win32 剥点）——
 *  两者都不该被放行为工作区目标。判定用 trim 前的原文
 *  （尾随空格 trim 后不可恢复），且先剥 hash/query */
function isWin32OddBasename(raw: string): boolean {
  const rawPath = raw.split('#')[0]!.split('?')[0]!
  const base = path.win32.basename(rawPath)
  return base.includes(':') || /[.\s]$/.test(base)
}

/** 通用分类前半段：外链放行 / 空白拦截 / 锚点放行 / scheme 拦截 / 盘符拦截 */
function preClassify(
  raw: string,
  ctx: LinkContext,
):
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; fragment: string }
  | {
      kind: 'blocked'
      reason: 'empty' | 'scheme' | 'escape' | 'windows-drive-on-posix'
      scheme?: string
      detail?: string
    }
  | { kind: 'path'; pathText: string } {
  const href = raw.trim()
  if (href.startsWith('#')) {
    // #160 仅锚点目标：本文件页内跳转；空锚点（裸 #）无可定位目标维持拦截
    const { fragment } = splitHrefFragment(href)
    if (fragment === null) {
      return { kind: 'blocked', reason: 'empty' }
    }
    return { kind: 'anchor', fragment }
  }
  if (href === '') {
    // #95 i18n：empty 分支原带的 detail（空白链接/仅锚点）无消费方——反馈
    // 文案由 vscode 层按 reason 键名取词，分类层不再产出文案字面量
    return { kind: 'blocked', reason: 'empty' }
  }
  // 协议相对 //host/...：无显式 scheme 但按外站目标处理，一律拦截
  if (href.startsWith('//')) {
    return { kind: 'blocked', reason: 'scheme', scheme: '' }
  }
  // Windows 宿主上盘符是路径而非 scheme（c:\x）；POSIX 宿主上同形态只能是
  // 单字母 scheme（怪异且非白名单）——按"Windows 路径出现在远程宿主"拦截
  if (WINDOWS_DRIVE_RE.test(href)) {
    if (ctx.isWindowsHost) {
      if (isWin32OddBasename(raw)) {
        return { kind: 'blocked', reason: 'escape', detail: href }
      }
      return { kind: 'path', pathText: href }
    }
    return { kind: 'blocked', reason: 'windows-drive-on-posix' }
  }
  const s = schemeOf(href)
  // 单字母或含 '.' 的"scheme"不是现实协议（注册 scheme 无此形态），而是
  // 文件名形态：a:b.md / note.md:stream——POSIX 宿主上是合法相对文件名，
  // Windows 宿主上属 NTFS ADS 怪异形态（下方统一拦截）
  if (s && s.scheme.length > 1 && !s.scheme.includes('.')) {
    if (s.scheme === 'http' || s.scheme === 'https') {
      return { kind: 'external', url: href }
    }
    return { kind: 'blocked', reason: 'scheme', scheme: s.scheme }
  }
  // 文件名形态（无 scheme，或单字母/含点 scheme）：Windows 宿主上 basename
  // 含 ':' 或尾随 '.'/空格的一律按越界口径拦截（POSIX 上这些是合法文件名字符）
  if (ctx.isWindowsHost && isWin32OddBasename(raw)) {
    return { kind: 'blocked', reason: 'escape', detail: href }
  }
  return { kind: 'path', pathText: href }
}

/**
 * 链接目标分类：external → openExternal（URL 原样含 `#`，网页锚点语义
 * 不接管）；anchor → 本文件锚点目标（#160 页内跳转）；doc → 候选绝对
 * 路径 + 结构化 fragment（存在性由 vscode 层探测，精确优先、无扩展名
 * 其次补 .md；fragment 供执行层定位）；blocked → 用户可见反馈。
 */
export function classifyLinkTarget(href: string, ctx: LinkContext): LinkTarget {
  const pre = preClassify(href, ctx)
  if (pre.kind !== 'path') {
    return pre
  }
  // #160 首个 `#` 拆分：路径部分参与解析（?query 仍由 resolveInside 剥），
  // fragment 结构化保留——含空格的宽松字面目标在此层同样拆分
  const { pathText, fragment } = splitHrefFragment(pre.pathText)
  const absolute = resolveInside(pathText, ctx)
  if (absolute === null) {
    return { kind: 'blocked', reason: 'escape', detail: pre.pathText }
  }
  const candidates = [absolute]
  if (!pathOps(ctx).extname(absolute)) {
    candidates.push(`${absolute}.md`)
  }
  return { kind: 'doc', candidates, fragment }
}

/** 图片目标分类：仅工作区内相对路径可经宿主读取；外链/危险 scheme 拦截
 *  （webview 只应对非 http(s) 图源走宿主通道；http(s) 到达此处按拦截防御） */
export function classifyImageTarget(src: string, ctx: LinkContext): ImageTarget {
  const pre = preClassify(src, ctx)
  if (pre.kind === 'external') {
    return { kind: 'blocked', reason: 'scheme', scheme: 'https' }
  }
  if (pre.kind === 'anchor') {
    // #160：`#frag` src 无图片语义（不随链接锚点放行），维持 empty 拦截
    return { kind: 'blocked', reason: 'empty' }
  }
  if (pre.kind === 'blocked') {
    return pre
  }
  const absolute = resolveInside(pre.pathText, ctx)
  if (absolute === null) {
    return { kind: 'blocked', reason: 'escape', detail: pre.pathText }
  }
  return { kind: 'workspace', fsPath: absolute }
}

/** blocked reason → 协议 image.result 的 reason 码（vscode 层换算用） */
export function imageBlockReasonOf(
  target: Extract<ImageTarget, { kind: 'blocked' }>,
): Extract<ImageResolution, { ok: false }>['reason'] {
  if (target.reason === 'escape') {
    return 'outside-workspace'
  }
  return 'blocked'
}
