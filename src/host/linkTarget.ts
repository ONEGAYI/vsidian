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
// - 尾部行号后缀（#534，规格 addon-navigation.md §5）：仅普通 Markdown
//   链接（含宽松链接）的**本地路径段**支持 `:十进制正整数` 行号后缀，
//   剥离早于 Win32 ADS/怪异 basename 拦截（note.md:103 的 basename 含
//   ':' 不先剥会被当 NTFS 备用数据流拦截）；0/负数/非数字不构成行号，
//   编码冒号（%3A）不剥——行号仅认明文冒号（工具输出复制的是明文，
//   normalizeLink 对 ':' 原样保留）；真 scheme 形态（外链端口
//   https://host:443 与拦截协议）不剥；行号与 fragment 同报为混合定位
//   整次非法（blocked，不丢弃 fragment 也不误作标题）；图片通道无行号
//   语义不剥
//
// 本模块不依赖 vscode（可在 node 单测直驱）；fsPath 语义由注入的
// LinkContext 提供，vscode 层负责 Uri ↔ fsPath 的双向换算（同一扩展宿主
// 内 round-trip，天然不混用本地与远程 URI）。
//
// #196 起：工作区路径解析（docDir 基准拼接、越界判别、扩展名候选）统一
// 经 src/shared/vaultLink.ts 的 planVaultLinkPath（双链跳转与后续索引/
// 重命名共用的同一解析器，不建重复实现）——本模块保留 scheme 白名单、
// fragment 拆分与容错解码等链接语法层职责。
//
// #556 起（ADR-0018）：显式绝对路径（Windows 宿主盘符形态 / POSIX 宿主
// 根路径）归 absolute 分类——携带候选/fsPath 与 fragment，允许跨根与
// 工作区外目标，按宿主文件系统解释（Remote SSH 用服务器路径）。Win32
// 怪 basename（ADS/尾随点）拦截对盘符路径继续适用；UNC 与 POSIX 宿主
// 上的 Windows 盘符维持拦截（两类 URI 不混用）。
import * as path from 'node:path'
import { planVaultLinkPath } from '../shared/vaultLink'

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
  | {
      kind: 'doc'
      candidates: string[]
      fragment: string | null
      /** #534 尾部行号后缀（1-based；仅普通链接本地路径段剥出时携带，
       *  供执行层落位——越界判定在执行层按权威文本校验，不静默钳位） */
      line?: number
    }
  | {
      /** 显式绝对路径目标（#556）：Windows 宿主盘符形态 / POSIX 宿主根路径——
       *  允许跨根与工作区外，按宿主文件系统解释 */
      kind: 'absolute'
      /** 按优先序的候选绝对 fsPath（扩展名规则与 doc 一致） */
      candidates: string[]
      /** 结构化锚点（与 doc 同口径，供执行层定位） */
      fragment: string | null
      /** #534 尾部行号后缀（与 doc 同口径） */
      line?: number
    }
  | {
      /** 本文件锚点目标（#160：`#frag` 省略路径，目标即当前文档） */
      kind: 'anchor'
      /** 容错 percent-decode 后的锚点文本（空串已被拦截） */
      fragment: string
    }
  | {
      kind: 'blocked'
      reason:
        | 'empty'
        | 'scheme'
        | 'escape'
        | 'windows-drive-on-posix'
        /** #534 混合定位：路径已含冒号行号再带非空 fragment——整次语法
         *  非法（不丢弃 fragment、不误作标题、不执行打开） */
        | 'line-anchor-conflict'
      /** scheme 拦截时的协议名（小写；协议相对为空串） */
      scheme?: string
      detail?: string
    }

/** 图片目标分类结果（webview 只对非 http(s) 图源走宿主通道） */
export type ImageTarget =
  | { kind: 'workspace'; fsPath: string }
  | {
      /** 显式绝对路径图源（#556）：允许跨根与工作区外（加载口径由资源
       *  服务/localResourceRoots 决定，分类层只负责形态判别） */
      kind: 'absolute'
      fsPath: string
    }
  | {
      kind: 'blocked'
      reason: 'empty' | 'scheme' | 'escape' | 'windows-drive-on-posix'
      scheme?: string
      detail?: string
    }

/** 宿主图片解析结果（会话经面板端口注入实现；reason 与协议 image.result 对齐）。
 *  fsPath（#201）：解析出的目标磁盘路径（成功与失败分支都带——失败登记
 *  反查映射后，删除→恢复的事件链路才能即时反查到 src），供会话失效通道
 *  按归一目标登记；不带时（旧注入形态）失效按无映射处理（不产生假阳性） */
export type ImageResolution =
  | { ok: true; src: string; fsPath?: string }
  | {
      ok: false
      reason: 'blocked' | 'outside-workspace' | 'not-found' | 'read-error' | 'inaccessible'
      detail?: string
      fsPath?: string
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

/** 喂给根内路径规划器的路径文本：剥 hash/query 后容错解码（trim 与
 *  分隔符归一是规划器自身职责，此处不重复）。#219 起公开导出——
 *  hoverDocAccess 的普通链接读取入口复用同一剥取口径（阅读侧 href 经
 *  markdown-it normalizeLink 编码、字面原文两种写法解析到同一目标），
 *  不另建第二套 fragment 拆分 */
export function planPathTextOf(href: string): string {
  return tolerantDecode(href.split('#')[0]!.split('?')[0]!)
}

/**
 * CommonMark 语义的 href 拆分（#160）：**首个** `#` 之前为路径部分、之后
 * 整段为 fragment（`./a#b.md` 拆为 `./a` + `b.md`——路径本身含 `#` 属
 * 已知边界）；`#` 后为空串时无 fragment。fragment 做容错 percent-decode
 * （阅读侧 href 经 markdown-it normalizeLink 编码、live 侧为字面原文，
 * 两种写法须解析到同一锚点——与路径同口径）；空 fragment 解码后回空串
 * 交由调用方按「无可定位目标」处置。
 * #219 起公开导出（消费方：hoverDocAccess 普通链接读取——fragment 拆分
 * 与 classifyLinkTarget 同一实现，不建副本）。
 */
export function splitHrefFragment(
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

/**
 * #534 尾部行号后缀剥离：对 href 的**本地路径段**（首个 `#`/`?` 之前、
 * 容忍行号后紧跟的尾随空白）剥 `:十进制正整数`。仅普通 Markdown 链接语
 * 义调用（图片与页内锚点不走此入口）。
 *
 * 边界（规格 §5.1）：
 * - 只认**明文**冒号：编码冒号（`note.md%3A103`）不构成行号（工具输出
 *   复制的是明文，normalizeLink 对 ':' 原样保留——两种写法都不会产生
 *   编码形态，编码冒号维持既有文件名分类）；
 * - `0`/全零不是行号（负数天然不匹配 `:数字$`，无绝对值/截断/宽容修正）；
 *   前导零按值语义（`0103` = 103，与 refText isPositiveDecimal 同口径）；
 * - 行号后缀的尾随空白容忍（宽松链接字面目标 `<note.md:103 >`），剥后
 *   **保留尾空白**——Windows 的 Win32 尾空白拦截口径不变；
 * - hash/query 段原样保留在 text 中（fragment 拆分与混合定位判定在
 *   classifyLinkTarget，本函数不拆语义）；
 * - 真.scheme 形态（多字母且不含点——外链 https://host:443 的端口与
 *   file:/mailto: 等拦截协议）由调用侧先行排除，本函数不重复判定。
 * 返回剥后完整 href（无行号时原样）与 1-based 行号（无后缀为 null）。
 */
export function splitLineSuffix(href: string): { text: string; line: number | null } {
  const hashIdx = href.indexOf('#')
  const queryIdx = href.indexOf('?')
  const cut = hashIdx >= 0 ? (queryIdx >= 0 ? Math.min(hashIdx, queryIdx) : hashIdx) : queryIdx
  const rawPath = cut >= 0 ? href.slice(0, cut) : href
  // 行号后紧跟的尾随空白不属行号（匹配容忍）；剥除点在去空白后的末尾
  const trimmedPath = rawPath.replace(/\s+$/, '')
  const m = /:(\d+)$/.exec(trimmedPath)
  if (m === null || Number(m[1]!) === 0) {
    return { text: href, line: null }
  }
  const trailingWs = rawPath.slice(trimmedPath.length)
  const text =
    href.slice(0, trimmedPath.length - m[0]!.length) + trailingWs + href.slice(rawPath.length)
  return { text, line: Number(m[1]!) }
}

/**
 * #534 普通链接喂规划器的路径文本完整口径：剥尾部行号后缀 → fragment
 * 拆分 → 剥 query → 容错解码（与 classifyLinkTarget 内部同一语义——
 * hoverDocAccess / vaultLinkExtract 等「手动重拆路径喂 resolveVaultFile」
 * 的消费方复用本口径，不建第二套行号剥离实现）。
 */
export function linkPathTextOf(href: string): string {
  return planPathTextOf(splitHrefFragment(splitLineSuffix(href).text).pathText)
}

/** 通用分类前半段：外链放行 / 空白拦截 / 锚点放行 / scheme 拦截 / 盘符拦截。
 *  lineSuffix（#534，仅普通链接开）：本地路径段剥尾部行号后缀——在
 *  Win32 ADS/怪异 basename 拦截**之前**（否则 note.md:103 被 basename
 *  含 ':' 误拦）；图片等无行号语义的通道关闭（保持既有分类） */
function preClassify(
  raw: string,
  ctx: LinkContext,
  opts?: { lineSuffix?: boolean },
):
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; fragment: string }
  | {
      /** preClassify 不产出 line-anchor-conflict——混合定位判定在
       *  classifyLinkTarget（需要 fragment 拆分结果） */
      kind: 'blocked'
      reason: 'empty' | 'scheme' | 'escape' | 'windows-drive-on-posix'
      scheme?: string
      detail?: string
    }
  | { kind: 'path'; pathText: string; line: number | null } {
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
  }  // 行号剥离是否启用（#534）：后续本地路径分支共用。剥离对象是 **trim 前
  // 的原文**——尾空白经 basename 检查后不可恢复（与 isWin32OddBasename 的
  // 原文判定口径一致）；图片模式（strip=null）text 恒为原样，行为不变
  const strip = opts?.lineSuffix === true ? splitLineSuffix : null
  // Windows 宿主上盘符是路径而非 scheme（c:\x）；POSIX 宿主上同形态只能是
  // 单字母 scheme（怪异且非白名单）——按"Windows 路径出现在远程宿主"拦截
  if (WINDOWS_DRIVE_RE.test(href)) {
    if (ctx.isWindowsHost) {
      // 盘符本地路径：剥行号先于 ADS 拦截（c:\x\note.md:103 归 note.md）
      const stripped = strip !== null ? strip(raw) : { text: raw, line: null }
      if (isWin32OddBasename(stripped.text)) {
        return { kind: 'blocked', reason: 'escape', detail: href }
      }
      return { kind: 'path', pathText: stripped.text.trim(), line: stripped.line }
    }
    return { kind: 'blocked', reason: 'windows-drive-on-posix' }
  }
  const s = schemeOf(href)
  // 单字母或含 '.' 的"scheme"不是现实协议（注册 scheme 无此形态），而是
  // 文件名形态：a:b.md / note.md:stream——POSIX 宿主上是合法相对文件名，
  // Windows 宿主上属 NTFS ADS 怪异形态（下方统一拦截）
  if (s && s.scheme.length > 1 && !s.scheme.includes('.')) {
    // 真 scheme（含外链 https://host:443 的端口语义与 file: 等拦截协议）
    // 不剥行号——external 原样放行、其余照旧拦截
    if (s.scheme === 'http' || s.scheme === 'https') {
      return { kind: 'external', url: href }
    }
    return { kind: 'blocked', reason: 'scheme', scheme: s.scheme }
  }
  // 文件名形态（无 scheme，或单字母/含点 scheme）：剥行号先于 ADS 拦截
  //（note.md:103 归 note.md + 行号；note.md:0/abc 等非行号形态维持拦截）；
  // POSIX 宿主剥后按剥除路径解析（:103 字面文件名几乎必为 not-found）
  const strippedFn = strip !== null ? strip(raw) : { text: raw, line: null }
  if (ctx.isWindowsHost && isWin32OddBasename(strippedFn.text)) {
    return { kind: 'blocked', reason: 'escape', detail: href }
  }
  return { kind: 'path', pathText: strippedFn.text.trim(), line: strippedFn.line }
}

/**
 * 链接目标分类：external → openExternal（URL 原样含 `#`，网页锚点语义
 * 不接管）；anchor → 本文件锚点目标（#160 页内跳转）；doc → 候选绝对
 * 路径 + 结构化 fragment（存在性由 vscode 层探测，精确优先、无扩展名
 * 其次补 .md；fragment 供执行层定位）+ 可选行号（#534 尾部 `:正整数`
 * 后缀，越界判定在执行层）；absolute → 显式绝对路径目标（#556，候选
 * 与 fragment/line 同 doc 口径，不受资源根边界）；blocked → 用户可见
 * 反馈（#534：行号 + 非空 fragment 的混合定位整次非法，不执行打开）。
 */
export function classifyLinkTarget(href: string, ctx: LinkContext): LinkTarget {
  const pre = preClassify(href, ctx, { lineSuffix: true })
  if (pre.kind !== 'path') {
    return pre
  }
  // #160 首个 `#` 拆分：路径部分参与解析（?query 随 planPathTextOf 剥除），
  // fragment 结构化保留——含空格的宽松字面目标在此层同样拆分。
  // 候选规划（docDir 基准、越界判别、无扩展名补 .md）统一走 vaultLink（#196）
  const { pathText, fragment } = splitHrefFragment(pre.pathText)
  if (pre.line !== null && fragment !== null) {
    // #534 混合定位（note.md:20#第二章）：路径已含冒号行号再带非空
    // fragment——整次语法非法（不丢弃 fragment、不误作标题、不执行打开）
    return { kind: 'blocked', reason: 'line-anchor-conflict', detail: pre.pathText }
  }
  const plan = planVaultLinkPath(planPathTextOf(pathText), ctx, { implicitMd: true })
  if (plan.kind === 'escape') {
    return { kind: 'blocked', reason: 'escape', detail: pre.pathText }
  }
  if (plan.kind === 'absolute') {
    return { kind: 'absolute', candidates: plan.candidates, fragment, ...(pre.line !== null ? { line: pre.line } : {}) }
  }
  return { kind: 'doc', candidates: plan.candidates, fragment, ...(pre.line !== null ? { line: pre.line } : {}) }
}

/** 图片目标分类：仅工作区内相对路径可经宿主读取；显式绝对路径归
 *  absolute（#556 允许工作区外图源，形态判别在此、加载口径在资源服务）；
 *  外链/危险 scheme 拦截（webview 只应对非 http(s) 图源走宿主通道；
 *  http(s) 到达此处按拦截防御） */
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
  // 图片单候选精确路径（implicitMd=false：显式扩展名不补 .md）
  const plan = planVaultLinkPath(planPathTextOf(pre.pathText), ctx, { implicitMd: false })
  if (plan.kind === 'escape') {
    return { kind: 'blocked', reason: 'escape', detail: pre.pathText }
  }
  if (plan.kind === 'absolute') {
    return { kind: 'absolute', fsPath: plan.candidates[0]! }
  }
  return { kind: 'workspace', fsPath: plan.candidates[0]! }
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
