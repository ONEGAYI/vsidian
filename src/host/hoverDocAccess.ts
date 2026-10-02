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
// #219 局部范围：结果携带语义范围选择器（scope：full/heading/block——
// 锚点形态与链接形态无关，双链 `[[笔记#锚]]` 与普通链接 `[x](笔记.md#锚)`
// 归同一选择器）+ LF 源范围。章节/块边界复用 wikilinkTarget 的完整范围
// 函数（findHeadingSectionRange / findBlockRange——与跳转定位函数
// findHeadingOffset / findBlockOffset 共享匹配口径但互不替代：跳转要
// 落点行区间，预览要完整区间）。**全文随范围一起返回**（保留全文解析
// 上下文——范围选取在渲染侧切块后按块区间过滤做，本层不孤立解析截取
// 字符串）；目标文件在但锚点不存在 → anchor-missing 分态（携带锚点
// 原文供就地提示，不以全文替代）。
//
// 本模块不依赖 vscode（node 单测直驱；vscode 层装配在 textEditorProvider）。
import * as path from 'node:path'
import { NewlineCoordinator } from '../shared/newline'
import { parseWikilinkInner } from '../shared/wikilink'
import { isVaultPathInsideRoot, planVaultLinkPath, type VaultLinkFileResolution, type VaultLinkResolveContext } from '../shared/vaultLink'
import { classifyLinkTarget, planPathTextOf, splitHrefFragment } from './linkTarget'
import { findBlockRange, findHeadingSectionRange } from './wikilinkTarget'
import type { HoverPreviewFailReason, HoverPreviewScope } from '../shared/protocol'

/** 读取结果：成功携带规范身份 + 版本 + LF 全文、源范围与语义范围选择器；
 *  失败为错误分态（就地 i18n 呈现的载荷来源，不连续弹宿主通知；缺失锚点
 *  分态附锚点原文） */
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

/** 目标是否 Markdown（一期悬停只接 Markdown；大小写不敏感） */
function isMarkdownPath(fsPath: string): boolean {
  return /\.md$/i.test(fsPath)
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

/** 读取目标正文并按锚点规格收窄范围（双链与普通链接共用收尾）：
 *  锚点命中 → LF 换算后的区间；锚点缺失 → anchor-missing 分态（不以
 *  全文替代）；无锚点 → 全文与 full 选择器 */
async function readAndScope(
  fsPath: string,
  spec: AnchorSpec | null,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
): Promise<HoverReadOutcome> {
  if (!isMarkdownPath(fsPath)) {
    // 一期只接 Markdown；图片/附件等目标不读取正文（#220/#223+ 再扩）
    return { ok: false, reason: 'non-markdown' }
  }
  const doc = await ports.openTextDocument(fsPath)
  if (!doc) {
    return { ok: false, reason: 'read-failed' }
  }
  const coord = new NewlineCoordinator(doc.text)
  const lfText = coord.toLfText(doc.text)
  const relOf = ctx.resolve.isWindowsHost ? path.win32.relative : path.posix.relative
  const identity = {
    fsPath,
    relPath: relOf(ctx.rootFsPath, fsPath).replaceAll('\\', '/'),
    version: doc.version,
    lfText,
  }
  if (spec === null) {
    return { ok: true, ...identity, range: { start: 0, end: lfText.length }, scope: { kind: 'full' } }
  }
  const hostRange = spec.kind === 'heading'
    ? findHeadingSectionRange(doc.text, spec.anchor)
    : findBlockRange(doc.text, spec.anchor)
  if (hostRange === null) {
    return { ok: false, reason: 'anchor-missing', anchor: spec.kind === 'block' ? `^${spec.anchor}` : spec.anchor }
  }
  return {
    ok: true,
    ...identity,
    range: {
      start: coord.hostOffsetToLf(hostRange.start),
      end: coord.hostOffsetToLf(hostRange.end),
    },
    scope: scopeOf(spec),
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

/**
 * 读取悬停双链的目标文档（#218 全文路径；#219 起锚点收窄为章节/块）。
 *
 * rawTarget 为 `[[` 与 `]]` 之间、`|` 之前的原文（未 trim——parseWikilinkInner
 * 自带规范化）。全程无副作用：不 openWith、不定位、不提示、不写文档。
 */
export async function readHoverDocTarget(
  rawTarget: string,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
): Promise<HoverReadOutcome> {
  const parsed = parseWikilinkInner(rawTarget.trim())
  if (!parsed) {
    return { ok: false, reason: 'unsupported' }
  }
  let fsPath: string
  if (parsed.path === '') {
    // 本文件锚点：目标即来源文档自身（不查文件系统）
    fsPath = ctx.sourceFsPath
  } else {
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
    fsPath = resolution.fsPath
  }
  return readAndScope(fsPath, anchorSpecOfWikilink(parsed), ctx, ports)
}

/**
 * 读取悬停普通 Markdown 链接的目标文档（#219）：`[text](relative.md)` 全文、
 * `[text](note#anchor)` 章节/块（`#^id` 为块引用，与跳转链路同口径）、
 * `[text](#frag)` 页内锚点以**来源文档**为目标（页内锚点不跨文档）。
 *
 * 外部网页（http/https 等 scheme）与协议相对地址不接入（webview 侧已预
 * 滤，此处按 unsupported 复核兜底）；越出所属根 escape。href 为 `<a>` 的
 * 原始 href（阅读侧可能经 markdown-it normalizeLink 编码——容错解码与
 * fragment 拆分复用 linkTarget 的同一实现）。全程无副作用。
 */
export async function readHoverMdLinkTarget(
  href: string,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
): Promise<HoverReadOutcome> {
  const classified = classifyLinkTarget(href, {
    docDir: ctx.resolve.docDir,
    rootDir: ctx.resolve.rootDir,
    isWindowsHost: ctx.resolve.isWindowsHost,
  })
  if (classified.kind === 'external') {
    // 外部网页不接入本功能（一期范围）；webview 已预滤，防御性兜底
    return { ok: false, reason: 'unsupported' }
  }
  if (classified.kind === 'blocked') {
    // 越出所属根单独分态；其余拦截形态（scheme/空目标/跨宿主盘符）不接入
    return { ok: false, reason: classified.reason === 'escape' ? 'escape' : 'unsupported' }
  }
  let fsPath: string
  if (classified.kind === 'anchor') {
    // 页内锚点：目标即来源文档自身（不查文件系统）
    fsPath = ctx.sourceFsPath
  } else {
    // doc：路径探测经同一 resolveVaultFile 端口（内部与双链共用
    // resolveVaultLinkFile——候选规划、越界判别、补 .md 同一实现；此处
    // 喂「剥 fragment/query 后容错解码」的路径文本，与 classifyLinkTarget
    // 的 planPathTextOf 同一口径）
    const { pathText } = splitHrefFragment(href.trim())
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
    fsPath = resolution.fsPath
  }
  return readAndScope(fsPath, anchorSpecOfFragment(classified.fragment), ctx, ports)
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
 *   OutlinkItemPayload.anchor 同口径，复用 anchorSpecOfFragment 归一）；
 * - 空串 fsPath = 断链出链条目 → not-found 分态（条目仍可悬停显示失效
 *   占位，而非静默不发）。
 *
 * 全程无副作用：不 openWith、不定位、不提示、不写文档。
 */
export async function readHoverDirectTarget(
  direct: { fsPath: string; anchor?: string },
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
): Promise<HoverReadOutcome> {
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
  const spec = direct.anchor ? anchorSpecOfFragment(direct.anchor) : null
  return readAndScope(direct.fsPath, spec, ctx, ports)
}
