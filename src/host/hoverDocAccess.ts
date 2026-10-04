// 悬停预览文档访问（工单 #218，ADR-0009「文档访问」层首块；#219 扩展局部
// 范围）：从双链跳转链路（executeWikilinkIntent 七步）提炼的**无副作用读取
// 路径**——目标解析、规范身份、带版本正文与 LF 范围；不打开面板、不写
// 文档、不建索引。
//
// 分层（ADR-0009）：本模块只负责「读什么、读成什么」，不做视图布局与
// 编辑输入；端口面（HoverDocAccessPorts）只有解析与读取两个入口、无任何
// 写端口——「只读视图不获得写入端口」的结构性表达，后续 #220（来源资源）、
// #222（嵌入内容来源）、#224（版本订阅与刷新）复用本通道。
//
// 解析语义（与跳转链路同源，不建第二套解析器）：
// - 双链形态学 parseWikilinkInner（shared/wikilink 单一事实源）；
// - 普通链接分类 classifyLinkTarget（host/linkTarget 单一事实源；路径
//   探测仍经 resolveVaultFile 端口——与双链同一 resolveVaultLinkFile，
//   fragment 拆分/容错解码复用其导出的同一实现）；
// - 空 path（[[#标题]] / [text](#frag)）目标即来源文档自身，不查文件系统
//   （页内锚点不跨文档）；
// - 根内相对路径 resolveVaultLinkFile（ADR-0008 语义：docDir 基准、越出
//   所属根拦截、多根互不补查）；外部网页（http/https 等 scheme）不接入；
// - 正文读取 openTextDocument+getText（宿主 TextDocument 是权威事实源，
//   未保存修改天然可见；不创建每引用 WebviewPanel）；
// - LF 坐标经 NewlineCoordinator 转换（webview 全程 LF）。
//
// #219 起结果携带语义选择器（scope：full/heading/block——锚点形态与链接
// 形态无关，双链 `[[笔记#锚]]` 与普通链接 `[x](笔记.md#锚)` 归同一选择器）
// + LF 锚定区间。章节/块边界复用 wikilinkTarget 的完整范围函数
// （findHeadingSectionRange / findBlockRange——与跳转定位函数
// findHeadingOffset / findBlockOffset 共享匹配口径但互不替代：跳转要
// 落点行区间，预览要完整区间）。**全文随结果一起返回**（P2-03 #280，
// ADR-0011：内容范围恒为目标全文，锚点区间只作初始定位点——渲染侧不
// 再按区间过滤）；目标文件在但锚点不存在 → anchor-missing 分态（携带锚点
// 原文供就地提示，不以全文替代；刷新重载 anchorOptional 时例外——已打开
// 实例继续可用，重开再验证）。
//
// 本模块不依赖 vscode（node 单测直驱；vscode 层装配在 textEditorProvider）。
//
// #333（P3-01）类型分派入口：readRefContentTarget 为生产读取入口——目标
// 三形态（双链/普通链接/直接目标）先解析出 fsPath，再按 shared/refContent
// 的类型分类学分派：markdown 通道装载既有全文载荷（RefMarkdownContent）；
// 其余类型维持 non-markdown 分态（pdf/image/text/web 的载荷与导航选择器
// 由 P3-04/P3-05/P3-08/P3-10 在分派表登记——Markdown 的 TextDocument
// .version 与 LF 范围不得冒充这些类型的版本或页码）。旧三入口
// （readHoverDocTarget/readHoverMdLinkTarget/readHoverDirectTarget）成为
// 兼容适配薄壳：经类型化入口后展开回旧扁平形态（HoverReadOutcome），
// 供既有调用与测试保持等价。
import * as path from 'node:path'
import { NewlineCoordinator } from '../shared/newline'
import { parseWikilinkInner } from '../shared/wikilink'
import { isVaultPathInsideRoot, planVaultLinkPath, type VaultLinkFileResolution, type VaultLinkResolveContext } from '../shared/vaultLink'
import { classifyLocalRefContentKind, type RefMarkdownContent } from '../shared/refContent'
import { classifyLinkTarget, planPathTextOf, splitHrefFragment } from './linkTarget'
import { findBlockRange, findHeadingSectionRange } from './wikilinkTarget'
import type { HoverPreviewFailReason, HoverPreviewScope } from '../shared/protocol'

/** 读取结果：成功携带规范身份 + 版本 + LF 全文、源范围与语义范围选择器；
 *  失败为错误分态（就地 i18n 呈现的载荷来源，不连续弹宿主通知；缺失锚点
 *  分态附锚点原文）。#333 起为**兼容适配形态**——生产读取走类型化
 *  RefReadOutcome（旧扁平形态经 flattenHoverReadOutcome 展开，供既有调用
 *  与测试保持等价；字段语义不变） */
export type HoverReadOutcome =
  | {
      ok: true
      /** 宿主侧真实路径（解析端口大小写归正后形态） */
      fsPath: string
      /** 所属根内相对路径（`/` 分隔；身份键与显示名共用） */
      relPath: string
      /** 目标 TextDocument.version（#224 变更刷新的版本基准） */
      version: number
      /** LF 全文（保留全文解析上下文——范围选取在渲染侧做） */
      lfText: string
      /** 目标源范围（LF 坐标；全文恒为 [0, length]，章节/块为锚定区间） */
      range: { start: number; end: number }
      /** 语义范围选择器（#219：full / heading 章节 / block 块） */
      scope: HoverPreviewScope
    }
  | { ok: false; reason: HoverPreviewFailReason; /** anchor-missing 时的锚点原文（块 id 带 ^ 前缀） */ anchor?: string }

/** #333（P3-01）类型化读取结果：成功形态为「目标身份（fsPath/relPath，
 *  类型无关）+ 按 kind 分派的内容载荷」——markdown 通道为 RefMarkdown
 *  Content（TextDocument 权威版本 + LF 全文 + 初始定位区间 + Markdown
 *  导航选择器）；pdf/image/text/web 的载荷形态由后续票（P3-04/P3-05/
 *  P3-08/P3-10）扩展 content 联合登记，登记前这些类型在分派处回落
 *  non-markdown 失败分态。失败形态与旧扁平入口同源 */
export type RefReadOutcome =
  | { ok: true; fsPath: string; relPath: string; content: RefMarkdownContent }
  | { ok: false; reason: HoverPreviewFailReason; anchor?: string }

/** 类型化结果 → 旧扁平 Markdown 形态（兼容适配展开）。非 markdown 载荷
 *  在当前分派表内不可达（结构性保证）；防御性收敛为 non-markdown 分态 */
export function flattenHoverReadOutcome(typed: RefReadOutcome): HoverReadOutcome {
  if (!typed.ok) {
    return typed
  }
  if (typed.content.kind !== 'markdown') {
    return { ok: false, reason: 'non-markdown' }
  }
  return {
    ok: true,
    fsPath: typed.fsPath,
    relPath: typed.relPath,
    version: typed.content.version,
    lfText: typed.content.lfText,
    range: typed.content.range,
    scope: typed.content.selector,
  }
}

/** 读取上下文：来源文档的解析语境与身份（vscode 层从父 TextDocument 构造） */
export interface HoverDocAccessContext {
  /** 根内相对解析上下文（docDir 基准；与跳转链路同款） */
  resolve: VaultLinkResolveContext
  /** 来源文档绝对 fsPath（空 path 双链/页内锚点的自引用目标） */
  sourceFsPath: string
  /** 所属根绝对 fsPath（relPath 计算基准；无工作区时与 docDir 同） */
  rootFsPath: string
}

/** 读取端口（vscode 层注入；无写端口——只读访问不依赖写入） */
export interface HoverDocAccessPorts {
  /** 双链/链接文件目标存在性解析（vscode 层 = resolveVaultLinkFile + statFileRealPath） */
  resolveVaultFile(rawPath: string): Promise<VaultLinkFileResolution>
  /** 打开并读取目标文档（vscode 层 = openTextDocument 只装载不显示 + getText；
   *  失败返回 null） */
  openTextDocument(fsPath: string): Promise<{ version: number; text: string } | null>
}

/** 锚点规格（链接形态无关的语义选择器输入）：双链 heading/blockId 与
 *  普通链接 fragment 归一到同一形态 */
interface AnchorSpec {
  kind: 'heading' | 'block'
  /** heading：标题原文；block：块 id（无 ^ 前缀） */
  anchor: string
}

/** scope 载荷口径：块锚点带 ^ 前缀（与 OutlinkItemPayload.anchor 同口径） */
function scopeOf(spec: AnchorSpec): HoverPreviewScope {
  return spec.kind === 'heading'
    ? { kind: 'heading', anchor: spec.anchor }
    : { kind: 'block', anchor: `^${spec.anchor}` }
}

/** 读取 Markdown 目标正文并定位锚点（类型分派的 markdown 通道——调用前
 *  类型已判定为 markdown）：内容范围恒为全文（P2-03 #280，ADR-0011——
 *  标题/块引用全文可达）；锚点命中 → LF 换算的**初始定位区间**（不再是
 *  内容边界）；锚点缺失 → anchor-missing 分态（不以全文替代，重开再验
 *  证）；anchorOptional（刷新重载）时锚点缺失不构成失败——回成功全文，
 *  定位区间退化为全文区间（已打开实例继续可用）；无锚点 → 全文与 full
 *  选择器 */
async function readMarkdownContent(
  fsPath: string,
  spec: AnchorSpec | null,
  ports: HoverDocAccessPorts,
  opts?: { anchorOptional?: boolean },
): Promise<{ ok: true; content: RefMarkdownContent } | { ok: false; reason: HoverPreviewFailReason; anchor?: string }> {
  const doc = await ports.openTextDocument(fsPath)
  if (!doc) {
    return { ok: false, reason: 'read-failed' }
  }
  const coord = new NewlineCoordinator(doc.text)
  const lfText = coord.toLfText(doc.text)
  const base = { kind: 'markdown' as const, version: doc.version, lfText }
  if (spec === null) {
    return {
      ok: true,
      content: { ...base, range: { start: 0, end: lfText.length }, selector: { kind: 'full' } },
    }
  }
  const hostRange = spec.kind === 'heading'
    ? findHeadingSectionRange(doc.text, spec.anchor)
    : findBlockRange(doc.text, spec.anchor)
  if (hostRange === null) {
    // P2-03 刷新宽容：已打开实例重载时锚点缺失不切成错误页（重开再验证）
    if (opts?.anchorOptional === true) {
      return {
        ok: true,
        content: { ...base, range: { start: 0, end: lfText.length }, selector: scopeOf(spec) },
      }
    }
    return { ok: false, reason: 'anchor-missing', anchor: spec.kind === 'block' ? `^${spec.anchor}` : spec.anchor }
  }
  return {
    ok: true,
    content: {
      ...base,
      range: {
        start: coord.hostOffsetToLf(hostRange.start),
        end: coord.hostOffsetToLf(hostRange.end),
      },
      selector: scopeOf(spec),
    },
  }
}

/** 双链解析结果的锚点规格（heading 与 blockId 互斥——形态学层已保证） */
function anchorSpecOfWikilink(parsed: { heading: string | null; blockId: string | null }): AnchorSpec | null {
  if (parsed.heading !== null) {
    return { kind: 'heading', anchor: parsed.heading }
  }
  if (parsed.blockId !== null) {
    return { kind: 'block', anchor: parsed.blockId }
  }
  return null
}

/** 普通链接 fragment 的锚点规格（`^id` 前缀为块引用，与 #160 跳转链路
 *  isBlockIdFragment 同口径；空 fragment 由分类层拦截，此处防御性按
 *  标题空串处理——空标题不命中任何章节，归 anchor-missing） */
function anchorSpecOfFragment(fragment: string | null): AnchorSpec | null {
  if (fragment === null) {
    return null
  }
  if (fragment.startsWith('^')) {
    return { kind: 'block', anchor: fragment.slice(1) }
  }
  return { kind: 'heading', anchor: fragment }
}

/** 读取选项（P2-03 #280）：anchorOptional = 刷新重载宽容——已打开实例的
 *  重载在锚点缺失时仍回成功全文（重开再验证原锚点，见 readMarkdownContent） */
export interface HoverReadOpts {
  anchorOptional?: boolean
}

/** 目标三形态（与 hover.request 的载荷形态一一对应：双链 target 原文 /
 *  普通链接 linkHref / 面板直接目标 directTarget——择一） */
export interface HoverTargetForm {
  target?: string
  linkHref?: string
  directTarget?: { fsPath: string; anchor?: string }
}

/** 三形态解析结果：成功携带 fsPath + 锚点规格（形态归一后）；失败为
 *  解析层错误分态（unsupported/no-workspace/escape/not-found） */
type HoverTargetResolution =
  | { ok: true; fsPath: string; spec: AnchorSpec | null }
  | { ok: false; reason: HoverPreviewFailReason }

/**
 * 解析目标三形态为 fsPath + 锚点规格（#333 从旧三入口提炼的共用解析层
 * ——形态学与既有行为逐一保持：双链形态学 parseWikilinkInner；普通链接
 * classifyLinkTarget + resolveVaultFile（剥 fragment/query 后容错解码）；
 * 直接目标 fsPath 直取（根内边界校验，不走文本解析））。不读正文——
 * 类型分派在解析之后（readRefContentTarget）。
 */
async function resolveHoverTargetForm(
  form: HoverTargetForm,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
): Promise<HoverTargetResolution> {
  if (form.directTarget !== undefined) {
    const direct = form.directTarget
    if (direct.fsPath === '') {
      return { ok: false, reason: 'not-found' }
    }
    // P1-1 宿主侧静态边界：fsPath 来自前端消息（正常来源是宿主快照的身份
    // 直读，但被攻陷 webview 可伪造任意路径）——文本解析路径经
    // resolveVaultFile 的 escape 拦截天然带界，直供身份在此补同一根内语义
    // （所属根 = 当前文档的 workspaceFolder；索引按根分区、跨根目标不解析，
    // 面板快照身份恒在所属根内，合法条目不受影响）。越界/相对形态归 escape。
    if (!isVaultPathInsideRoot(direct.fsPath, ctx.resolve)) {
      return { ok: false, reason: 'escape' }
    }
    return { ok: true, fsPath: direct.fsPath, spec: direct.anchor ? anchorSpecOfFragment(direct.anchor) : null }
  }
  if (form.linkHref !== undefined) {
    const classified = classifyLinkTarget(form.linkHref, {
      docDir: ctx.resolve.docDir,
      rootDir: ctx.resolve.rootDir,
      isWindowsHost: ctx.resolve.isWindowsHost,
    })
    if (classified.kind === 'external') {
      // 外部网页不接入本功能（web 类型载荷由 #342 接入，届时在分派层扩展
      // 而非此处放行）；webview 已预滤，防御性兜底
      return { ok: false, reason: 'unsupported' }
    }
    if (classified.kind === 'blocked') {
      // 越出所属根单独分态；其余拦截形态（scheme/空目标/跨宿主盘符）不接入
      return { ok: false, reason: classified.reason === 'escape' ? 'escape' : 'unsupported' }
    }
    if (classified.kind === 'anchor') {
      // 页内锚点：目标即来源文档自身（不查文件系统）
      return { ok: true, fsPath: ctx.sourceFsPath, spec: anchorSpecOfFragment(classified.fragment) }
    }
    // doc：路径探测经同一 resolveVaultFile 端口（内部与双链共用
    // resolveVaultLinkFile——候选规划、越界判别、补 .md 同一实现；此处
    // 喂「剥 fragment/query 后容错解码」的路径文本，与 classifyLinkTarget
    // 的 planPathTextOf 同一口径）
    const { pathText } = splitHrefFragment(form.linkHref.trim())
    const resolution = await ports.resolveVaultFile(planPathTextOf(pathText))
    if (resolution.kind === 'no-workspace') {
      return { ok: false, reason: 'no-workspace' }
    }
    if (resolution.kind === 'escape') {
      return { ok: false, reason: 'escape' }
    }
    if (resolution.kind === 'not-found') {
      return { ok: false, reason: 'not-found' }
    }
    return { ok: true, fsPath: resolution.fsPath, spec: anchorSpecOfFragment(classified.fragment) }
  }
  const target = form.target ?? ''
  const parsed = parseWikilinkInner(target.trim())
  if (!parsed) {
    return { ok: false, reason: 'unsupported' }
  }
  if (parsed.path === '') {
    // 本文件锚点：目标即来源文档自身（不查文件系统）
    return { ok: true, fsPath: ctx.sourceFsPath, spec: anchorSpecOfWikilink(parsed) }
  }
  const resolution = await ports.resolveVaultFile(parsed.path)
  if (resolution.kind === 'no-workspace') {
    return { ok: false, reason: 'no-workspace' }
  }
  if (resolution.kind === 'escape') {
    return { ok: false, reason: 'escape' }
  }
  if (resolution.kind === 'not-found') {
    return { ok: false, reason: 'not-found' }
  }
  return { ok: true, fsPath: resolution.fsPath, spec: anchorSpecOfWikilink(parsed) }
}

/**
 * #333（P3-01）类型化只读访问入口（生产读取路径）：目标三形态解析出
 * fsPath 后按类型分派——
 * - markdown：装载既有全文载荷（RefMarkdownContent：TextDocument 权威
 *   版本 + LF 全文 + 初始定位区间 + Markdown 导航选择器）；
 * - 其余类型（pdf/image/text/web）：维持 non-markdown 分态（附件/外链
 *   的载荷与导航选择器由 P3-04/P3-05/P3-08/P3-10 在此分派表登记——
 *   Markdown 的 TextDocument.version 和 LF 范围不能冒充这些类型的版本
 *   或页码）。
 *
 * 类型由宿主按解析出的 fsPath 分类（classifyLocalRefContentKind），不
 * 接收前端声明的类型；web 目标在解析层即 unsupported（#342 接入时扩展）。
 * 全程无副作用：不 openWith、不定位、不提示、不写文档。
 */
export async function readRefContentTarget(
  form: HoverTargetForm,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
  opts?: HoverReadOpts,
): Promise<RefReadOutcome> {
  const resolution = await resolveHoverTargetForm(form, ctx, ports)
  if (!resolution.ok) {
    return resolution
  }
  const kind = classifyLocalRefContentKind(resolution.fsPath)
  if (kind !== 'markdown') {
    // 类型分派表（#333 落位）：markdown 通道之外的类型本票不装载——
    // 既有 non-markdown 分态保持（图片 #336 / PDF #337 / 文本 #340 /
    // 外链 #342 接入时按 kind 登记各自载荷与导航选择器）
    return { ok: false, reason: 'non-markdown' }
  }
  const content = await readMarkdownContent(resolution.fsPath, resolution.spec, ports, opts)
  if (!content.ok) {
    return content
  }
  const relOf = ctx.resolve.isWindowsHost ? path.win32.relative : path.posix.relative
  return {
    ok: true,
    fsPath: resolution.fsPath,
    relPath: relOf(ctx.rootFsPath, resolution.fsPath).replaceAll('\\', '/'),
    content: content.content,
  }
}

/**
 * 读取悬停双链的目标文档（#218 全文路径；#219 起锚点收窄为章节/块；
 * P2-03 起锚点只决定初始定位区间，内容范围恒全文）。
 *
 * rawTarget 为 `[[` 与 `]]` 之间、`|` 之前的原文（未 trim——parseWikilinkInner
 * 自带规范化）。全程无副作用：不 openWith、不定位、不提示、不写文档。
 *
 * #333 起为兼容适配薄壳：经 readRefContentTarget 类型化通道后展开回旧
 * 扁平形态（行为等价由 hoverDocAccess 契约测试的等价矩阵钉住）。
 */
export async function readHoverDocTarget(
  rawTarget: string,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
  opts?: HoverReadOpts,
): Promise<HoverReadOutcome> {
  return flattenHoverReadOutcome(await readRefContentTarget({ target: rawTarget }, ctx, ports, opts))
}

/**
 * 读取悬停普通 Markdown 链接的目标文档（#219）：`[text](relative.md)` 全文、
 * `[text](note#anchor)` 章节/块（`#^id` 为块引用，与跳转链路同口径）、
 * `[text](#frag)` 页内锚点以**来源文档**为目标（页内锚点不跨文档）。
 *
 * 外部网页（http/https 等 scheme）与协议相对地址不接入（webview 侧已预
 * 滤，此处按 unsupported 复核兜底；web 类型载荷由 #342 接入）；越出所属
 * 根 escape。href 为 `<a>` 的原始 href（阅读侧可能经 markdown-it
 * normalizeLink 编码——容错解码与 fragment 拆分复用 linkTarget 的同一实
 * 现）。全程无副作用。
 *
 * #333 起为兼容适配薄壳（经 readRefContentTarget 后展开回旧扁平形态）。
 */
export async function readHoverMdLinkTarget(
  href: string,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
  opts?: HoverReadOpts,
): Promise<HoverReadOutcome> {
  return flattenHoverReadOutcome(await readRefContentTarget({ linkHref: href }, ctx, ports, opts))
}

/**
 * #299 跳转目标提示轻量解析：把悬停目标解析为「所属根内相对路径 + 源码
 * 形态锚点」供提示显示。**只解析不读正文**——路径解析与存在性探测
 * （stat 级，经 resolveVaultFile 端口）之外零 IO：不 openTextDocument、
 * 不进 hover.request/watch 的读取与租约链路（提示只报位置不展内容，
 * 轻量是硬边界）。目标语义与 readHoverDocTarget / readHoverMdLinkTarget /
 * readHoverDirectTarget 同源（同一形态学、同一解析端口），仅省去正文
 * 读取与范围收窄。解析失败（not-found/escape/unsupported/空串 fsPath）
 * 一律 ok:false——webview 侧失败不出提示（不区分原因，无就地错误文案）。
 */
export type HoverTargetTipOutcome =
  | { ok: true; relPath: string; anchor: string }
  | { ok: false }

/**
 * #299 跳转目标提示轻量解析：把悬停目标解析为「所属根内相对路径 + 源码
 * 形态锚点」供提示显示。**纯路径计算、零文件系统请求**——提示诚实地把
 * 链接目标反映出来：链接写什么就显示什么（无扩展名按双链默认补 .md 的
 * 意图路径），目标文件是否存在、是否在工作区内打开（无工作区时根已回
 * 退为文档父目录）均不影响位置呈现（2026-10-02 用户裁定）。只有形态学
 * 非法（非链接/非法 wikilink/外部 scheme）与越出根边界（escape——无从
 * 构成根内相对路径）静默不出。
 */
export async function resolveHoverTargetTip(
  spec: { target?: string; linkHref?: string; directTarget?: { fsPath: string; anchor?: string } },
  ctx: HoverDocAccessContext,
): Promise<HoverTargetTipOutcome> {
  const relOf = ctx.resolve.isWindowsHost ? path.win32.relative : path.posix.relative
  const relPathOf = (fsPath: string): string =>
    relOf(ctx.rootFsPath, fsPath).replaceAll('\\', '/')

  if (spec.directTarget !== undefined) {
    // 面板直接目标：fsPath 直取（宿主快照身份，无形态学歧义；不读正文
    // 所以无 not-found 分态）
    if (spec.directTarget.fsPath === '') {
      return { ok: false }
    }
    if (!isVaultPathInsideRoot(spec.directTarget.fsPath, ctx.resolve)) {
      return { ok: false }
    }
    return {
      ok: true,
      relPath: relPathOf(spec.directTarget.fsPath),
      // 锚点原文（标题或 ^块id）直接前缀 `#`——与源码形态一致
      anchor: spec.directTarget.anchor ? `#${spec.directTarget.anchor}` : '',
    }
  }

  // 链接目标的意图路径：候选规划取末位——无扩展名时即补 .md 的双链意图
  // 候选，有扩展名时为唯一候选（自身）；escape（越界）无从呈现根内相对路径
  const intentPathOf = (rawPath: string): string | null => {
    const plan = planVaultLinkPath(rawPath, ctx.resolve)
    if (plan.kind !== 'inside') {
      return null
    }
    return plan.candidates[plan.candidates.length - 1] ?? null
  }

  if (spec.linkHref !== undefined) {
    const classified = classifyLinkTarget(spec.linkHref, {
      docDir: ctx.resolve.docDir,
      rootDir: ctx.resolve.rootDir,
      isWindowsHost: ctx.resolve.isWindowsHost,
    })
    if (classified.kind === 'external' || classified.kind === 'blocked') {
      return { ok: false }
    }
    if (classified.kind === 'anchor') {
      // 页内锚点：目标即来源文档自身（与 readHoverMdLinkTarget 同口径）
      return { ok: true, relPath: relPathOf(ctx.sourceFsPath), anchor: `#${classified.fragment}` }
    }
    const { pathText } = splitHrefFragment(spec.linkHref.trim())
    const fsPath = intentPathOf(planPathTextOf(pathText))
    if (fsPath === null) {
      return { ok: false }
    }
    return {
      ok: true,
      relPath: relPathOf(fsPath),
      anchor: classified.fragment ? `#${classified.fragment}` : '',
    }
  }

  if (spec.target !== undefined) {
    const parsed = parseWikilinkInner(spec.target.trim())
    if (!parsed) {
      return { ok: false }
    }
    let fsPath: string
    if (parsed.path === '') {
      fsPath = ctx.sourceFsPath // 本文件锚点：不特判，同样带完整路径
    } else {
      const planned = intentPathOf(parsed.path)
      if (planned === null) {
        return { ok: false }
      }
      fsPath = planned
    }
    const anchor = parsed.heading !== null
      ? `#${parsed.heading}`
      : parsed.blockId !== null
        ? `#^${parsed.blockId}`
        : ''
    return { ok: true, relPath: relPathOf(fsPath), anchor }
  }

  return { ok: false }
}

/**
 * 读取面板条目的直接目标（#221 反链/出链悬停）：目标身份是宿主快照携带
 * 的绝对 fsPath（± 锚点），**不走 target/linkHref 文本解析与根内路径探测**
 * （解析端口零调用——条目身份在快照生成时已由宿主解析定局）。
 *
 * - 无锚点 / 空串锚点 → 全文（scope=full；反链条目与无锚点出链条目）；
 * - 锚点语义与链接形态无关（`^id` 前缀 = 块引用，否则标题章节——与
 *   OutlinkItemPayload.anchor 同口径）；
 * - 空串 fsPath = 断链出链条目 → not-found 分态（条目仍可悬停显示失效
 *   占位，而非静默不发）。
 *
 * 全程无副作用：不 openWith、不定位、不提示、不写文档。
 *
 * #333 起为兼容适配薄壳（经 readRefContentTarget 后展开回旧扁平形态；
 * 根内静态边界 P1-1 校验在共用解析层 resolveHoverTargetForm 保持）。
 */
export async function readHoverDirectTarget(
  direct: { fsPath: string; anchor?: string },
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
  opts?: HoverReadOpts,
): Promise<HoverReadOutcome> {
  return flattenHoverReadOutcome(await readRefContentTarget({ directTarget: direct }, ctx, ports, opts))
}
