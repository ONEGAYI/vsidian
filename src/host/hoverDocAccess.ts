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
import { classifyLocalRefContentKind, type RefImageContent, type RefMarkdownContent, type RefPdfContent, type RefTextContent, type RefTextFont, type RefWebContent } from '../shared/refContent'
import { checkWebLinkUrl, isHttpLinkHref } from '../shared/webLink'
import { parsePdfNavAnchor } from '../shared/pdfNav'
import {
  REF_TEXT_LIMITS,
  clipLinesToWindow,
  parseTextAnchorSpec,
  resolveTextNav,
  sniffTextHead,
  splitLfLines,
} from '../shared/refText'
import { classifyLinkTarget, planPathTextOf, splitHrefFragment } from './linkTarget'
import { findBlockRange, findHeadingSectionRange } from './wikilinkTarget'
import type { HoverAnchorInvalidDetail, HoverPreviewFailReason, HoverPreviewScope } from '../shared/protocol'
import type { WebLinkMetaOutcome } from './webLinkMetaService'

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
 *  导航选择器）；#336（P3-04）登记 image 通道（RefImageContent：来源相
 *  对图源 + 文件资源版本——不读正文，图片字节与版本戳走既有图片通道）；
 *  #337（P3-05）登记 pdf 通道（RefPdfContent：文件资源 URI + 文件状态
 *  代次 + 源字节 + PDF 导航选择器——双链 #page=N 解析，普通链接 fragment
 *  不解析）；#340（P3-08）登记 text 通道（RefTextContent：有界准入 +
 *  锚点校验后的窗口正文与导航字段）；web 通道（#342）为 RefWebContent
 *  （受限抓取的元信息；fsPath/relPath 为空串占位——外链无本地文件身
 *  份）。失败形态与旧扁平入口同源；text 通道的锚点非法分态附细分原因
 *  （anchorDetail） */
export type RefReadOutcome =
  | { ok: true; fsPath: string; relPath: string; content: RefMarkdownContent | RefImageContent | RefPdfContent | RefTextContent }
  | { ok: true; fsPath: ''; relPath: ''; content: RefWebContent }
  | {
      ok: false
      reason: HoverPreviewFailReason
      anchor?: string
      /** #340 anchor-invalid 的细分原因（webview 分态文案参数） */
      anchorDetail?: HoverAnchorInvalidDetail
    }

/** 类型化结果 → 旧扁平 Markdown 形态（兼容适配展开）。image 载荷（#336）
 *  收敛为 non-markdown 分态——旧扁平消费者（Markdown 语义）行为保持；图
 *  片的 webview 呈现走类型化通道的独立装载路径。其余非 markdown 载荷在
 *  当前分派表内不可达（结构性保证）；防御性同样收敛 non-markdown */
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

/** 读取端口（vscode 层注入；无写端口——只读访问不依赖写入）。可选端口：
 *  #336 起图片文件状态探测（statFile）；#342 起外链元信息抓取
 *  （fetchWebMeta，宿主受限抓取服务的装配形态；缺席 = 外链维持
 *  unsupported 分态） */
export interface HoverDocAccessPorts {
  /** 双链/链接文件目标存在性解析（vscode 层 = resolveVaultLinkFile + statFileRealPath） */
  resolveVaultFile(rawPath: string): Promise<VaultLinkFileResolution>
  /** 打开并读取目标文档（vscode 层 = openTextDocument 只装载不显示 + getText；
   *  失败返回 null。#340 起 languageId 可选携带（text 通道的语言身份；
   *  缺省 plaintext——既有桩不破） */
  openTextDocument(fsPath: string): Promise<{ version: number; text: string; languageId?: string } | null>
  /** #336（P3-04）图片目标的文件状态探测（vscode 层 = workspace.fs.stat）：
   *  文件资源版本（mtimeMs）的来源——图片不是 TextDocument 权威语义，
   *  版本取文件状态；端口缺省（node 单测替身）时 version 为 0（仅回包
   *  排序基准，图片新鲜度权威在失效通道） */
  statFile?(fsPath: string): Promise<{ mtimeMs: number } | null>
  /** #342（P3-10）外链元信息受限抓取（宿主 WebLinkMetaService 装配；测试
   *  注入替身）。signal 为消费者取消通道（webview 关浮层 → 宿主 abort） */
  fetchWebMeta?(url: string, signal?: AbortSignal): Promise<WebLinkMetaOutcome>
  /** #337（P3-05）PDF 文件资源读取（可选——纯 Markdown 消费端不注入时
   *  pdf 目标回落 non-markdown 分态；vscode 层 = workspace.fs.stat 三态 +
   *  asWebviewUri + 文件状态代次表）。不装载正文字节：PDF 源经 webview
   *  资源域按需 fetch，宿主侧零 PDF 解析代码 */
  readPdfFileResource?(fsPath: string): Promise<
    | { kind: 'ok'; uri: string; version: number; bytes: number }
    | { kind: 'not-found' }
    | { kind: 'inaccessible' }
  >
  /** #340（P3-08）text 通道准入端口（vscode 层注入；缺省跳过对应检查——
   *  单测直驱形态）：stat 文件大小（字节；失败 null）与有界头部字节读取
   *  （超过可用长度返回实际读取的部分；失败 null） */
  statFileSize?(fsPath: string): Promise<number | null>
  readFileHead?(fsPath: string, maxBytes: number): Promise<Uint8Array | null>
  /** #340（P3-08）语言级生效外观配置（vscode 层 = openTextDocument +
   *  getConfiguration('editor', doc) 合并读取；缺省全缺席——沿用默认） */
  readTextEditorConfig?(fsPath: string): Promise<RefTextFont & { lineNumbers: boolean } | null>
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
 *  重载在锚点缺失时仍回成功全文（重开再验证原锚点，见 readMarkdownContent）。
 *  web（#342）：外链卡片开关与取消信号——enabled 为 false/缺席时 external
 *  目标维持 unsupported（关闭态零抓取：不发起任何网络请求） */
export interface HoverReadOpts {
  anchorOptional?: boolean
  web?: { enabled: boolean; signal?: AbortSignal }
}

/** 目标三形态（与 hover.request 的载荷形态一一对应：双链 target 原文 /
 *  普通链接 linkHref / 面板直接目标 directTarget——择一） */
export interface HoverTargetForm {
  target?: string
  linkHref?: string
  directTarget?: { fsPath: string; anchor?: string }
}

/** 三形态解析结果：成功携带 fsPath + 锚点规格（形态归一后）+ **来源形态
 *  标记**（#337：PDF 锚点语法双链限定——mdlink/direct 不解析 #page=N，
 *  fragment 原样交宿主，悬停预览从第一页开始）；web 目标（#342）携带
 *  归一 URL（webUrl 在场 = 外链卡片通道，无本地文件身份，不带 formKind）；
 *  失败为解析层错误分态（unsupported/no-workspace/escape/not-found） */
type HoverTargetResolution =
  | { ok: true; fsPath: string; spec: AnchorSpec | null; formKind: 'wikilink' | 'mdlink' | 'direct' }
  | { ok: true; webUrl: string }
  | { ok: false; reason: HoverPreviewFailReason }

/**
 * 解析目标三形态为 fsPath + 锚点规格（#333 从旧三入口提炼的共用解析层
 * ——形态学与既有行为逐一保持：双链形态学 parseWikilinkInner；普通链接
 * classifyLinkTarget + resolveVaultFile（剥 fragment/query 后容错解码）；
 * 直接目标 fsPath 直取（根内边界校验，不走文本解析））。不读正文——
 * 类型分派在解析之后（readRefContentTarget）。
 *
 * #342（P3-10）：external 分支为 web 类型入口——仅 http(s) 且总开关开启
 * （opts.web.enabled）且抓取端口在场时归一为 webUrl 交付分派层；凭据/
 * 私网/畸形 URL 在准入层拒绝（web-invalid-address）；其余形态（非 http
 * scheme、开关关闭、端口缺席）维持 unsupported。不放行任意 URI——
 * href scheme 判定不经 classifyLocalRefContentKind（本地文件分类不适用
 * 于外链目标）。
 */
async function resolveHoverTargetForm(
  form: HoverTargetForm,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
  opts?: HoverReadOpts,
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
    return { ok: true, fsPath: direct.fsPath, spec: direct.anchor ? anchorSpecOfFragment(direct.anchor) : null, formKind: 'direct' }
  }
  if (form.linkHref !== undefined) {
    const classified = classifyLinkTarget(form.linkHref, {
      docDir: ctx.resolve.docDir,
      rootDir: ctx.resolve.rootDir,
      isWindowsHost: ctx.resolve.isWindowsHost,
    })
    if (classified.kind === 'external') {
      // #342（P3-10）web 类型入口：总开关开启 + 抓取端口在场才进外链
      // 通道；关闭态零抓取（webview 预滤已拦，此处宿主复核兜底——被攻陷
      // webview 无法绕过开关发起抓取）
      if (opts?.web?.enabled !== true || ports.fetchWebMeta === undefined) {
        return { ok: false, reason: 'unsupported' }
      }
      // 仅 http(s)：ftp/mailto/javascript 等其余 external 形态不接入
      if (!isHttpLinkHref(form.linkHref.trim())) {
        return { ok: false, reason: 'unsupported' }
      }
      // URL 准入（scheme/凭据/字面私网）+ 归一（缓存键与抓取地址同源）
      const check = checkWebLinkUrl(form.linkHref.trim())
      if (!check.ok) {
        return check
      }
      return { ok: true, webUrl: check.url }
    }
    if (classified.kind === 'blocked') {
      // 越出所属根单独分态；其余拦截形态（scheme/空目标/跨宿主盘符）不接入
      return { ok: false, reason: classified.reason === 'escape' ? 'escape' : 'unsupported' }
    }
    if (classified.kind === 'anchor') {
      // 页内锚点：目标即来源文档自身（不查文件系统）
      return { ok: true, fsPath: ctx.sourceFsPath, spec: anchorSpecOfFragment(classified.fragment), formKind: 'mdlink' }
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
    return { ok: true, fsPath: resolution.fsPath, spec: anchorSpecOfFragment(classified.fragment), formKind: 'mdlink' }
  }
  const target = form.target ?? ''
  const parsed = parseWikilinkInner(target.trim())
  if (!parsed) {
    return { ok: false, reason: 'unsupported' }
  }
  if (parsed.path === '') {
    // 本文件锚点：目标即来源文档自身（不查文件系统）
    return { ok: true, fsPath: ctx.sourceFsPath, spec: anchorSpecOfWikilink(parsed), formKind: 'wikilink' }
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
  return { ok: true, fsPath: resolution.fsPath, spec: anchorSpecOfWikilink(parsed), formKind: 'wikilink' }
}

/** PDF 悬停/嵌入读取的运行保护上限（review 修复）：PDF 载荷按源文件
 *  字节全量进 webview（webview 按需 fetch 渲染），数百 MB 尖峰会整文件
 *  灌入内存——stat 得字节后超限就地拒绝（file-too-large，复用既有文案）。
 *  防御性运行保护而非产品参数，量级可按用户意见调整 */
export const PDF_HOVER_MAX_BYTES = 64 * 1024 * 1024

/**
 * 读取 PDF 目标的文件资源与导航选择器（类型分派的 pdf 通道——调用前
 * 类型已判定为 pdf，#337 / P3-05）：**锚点语法双链限定**——
 * - 双链（formKind wikilink）：锚点原文经 parsePdfNavAnchor 解析
 *   `#page=N`（1-based 正整数；块 id 形态与一切非法形态报 anchor-invalid，
 *   附锚点原文，不静默回落第一页）；
 * - 普通链接/直接目标（mdlink/direct）：fragment 不由本扩展解析（原样交
 *   宿主打开），悬停预览从第一页开始；
 * 文件资源经 readPdfFileResource 端口（stat 三态 + 资源 URI + 文件状态
 * 代次）：not-found 归缺失分态，inaccessible（权限/断连）归 read-failed
 * （不冒充删除）。全程无副作用：不打开、不写、不装载正文字节。
 */
async function readPdfContent(
  fsPath: string,
  spec: AnchorSpec | null,
  formKind: 'wikilink' | 'mdlink' | 'direct',
  ports: HoverDocAccessPorts,
): Promise<{ ok: true; content: RefPdfContent } | { ok: false; reason: HoverPreviewFailReason; anchor?: string }> {
  let selector: RefPdfContent['selector'] = { kind: 'pdf' }
  if (formKind === 'wikilink' && spec !== null) {
    // 双链限定：块 id（#^…）不是合法 PDF 锚点键；heading 原文走分词解析
    const parsed = spec.kind === 'block'
      ? ({ ok: false, reason: 'invalid', anchor: `^${spec.anchor}` } as const)
      : parsePdfNavAnchor(spec.anchor)
    if (!parsed.ok) {
      return { ok: false, reason: 'anchor-invalid', anchor: parsed.anchor }
    }
    selector = parsed.selector
  }
  // 文件资源（端口未注入 = 纯 Markdown 消费端，维持 non-markdown 兼容降级）
  if (ports.readPdfFileResource === undefined) {
    return { ok: false, reason: 'non-markdown' }
  }
  const resource = await ports.readPdfFileResource(fsPath)
  if (resource.kind === 'not-found') {
    return { ok: false, reason: 'not-found' }
  }
  if (resource.kind === 'inaccessible') {
    // 权限/断连等不可访问：不冒充文件删除
    return { ok: false, reason: 'read-failed' }
  }
  // 大小门（review 修复）：悬停浮层与嵌入卡同经此读取点，一并受门——
  // stat 字节超上限不进入载荷（file-too-large 就地分态，不新增文案）
  if (resource.bytes > PDF_HOVER_MAX_BYTES) {
    return { ok: false, reason: 'file-too-large' }
  }
  return {
    ok: true,
    content: { kind: 'pdf', version: resource.version, uri: resource.uri, bytes: resource.bytes, selector },
  }
}

/**
 * #340（P3-08）text 通道读取（调用前类型已判定为 text）：有界准入 →
 * 宿主解码 → 锚点校验 → 窗口裁剪，全程只读。
 *
 * 准入顺序（「不读完整无界内容、不悄悄截断」）：
 * 1. stat 大小超限（REF_TEXT_LIMITS.maxFileBytes）→ file-too-large（不
 *    打开文件）；
 * 2. 头部有界探测（probeBytes）：NUL → binary-file；严格 UTF-8 失败 →
 *    invalid-encoding（编码以宿主打开文档的解码结果为准——探测只拦宿主
 *    解码必然无意义的形态，UTF-16 BOM 放行）；
 * 3. openTextDocument 解码（失败 read-failed）→ LF 正文；
 * 4. 单行超限（maxLineChars）→ line-too-long（不截断）。
 *
 * 锚点（双链限定 + 分词边界）：仅双链形态（anchorSource 'wikilink'）的
 * 锚点段进入 `;`/key=value 分词解析（Markdown 标题/块 id 直读语义不适用
 * 于代码文件——块引用形态与非 key=value 形态一律 anchor-invalid(format)）；
 * 普通链接 fragment 与面板直接目标锚点不解析（按无锚点全文，规范「锚点
 * 控制仅双链可用」）。anchorOptional（刷新重载）时越界钳制（已打开视图
 * 合法收口，初次打开仍按报错口径）。
 */
async function readTextContent(
  fsPath: string,
  spec: AnchorSpec | null,
  anchorSource: 'wikilink' | 'mdlink' | 'direct',
  ports: HoverDocAccessPorts,
  opts?: { anchorOptional?: boolean },
): Promise<{ ok: true; content: RefTextContent } | { ok: false; reason: HoverPreviewFailReason; anchor?: string; anchorDetail?: HoverAnchorInvalidDetail }> {
  // 1. 大小准入（不打开文件）
  if (ports.statFileSize !== undefined) {
    const size = await ports.statFileSize(fsPath)
    if (size !== null && size > REF_TEXT_LIMITS.maxFileBytes) {
      return { ok: false, reason: 'file-too-large' }
    }
  }
  // 2. 头部有界探测
  if (ports.readFileHead !== undefined) {
    const head = await ports.readFileHead(fsPath, REF_TEXT_LIMITS.probeBytes)
    if (head !== null) {
      const sniff = sniffTextHead(head)
      if (sniff === 'binary') {
        return { ok: false, reason: 'binary-file' }
      }
      if (sniff === 'invalid-encoding') {
        return { ok: false, reason: 'invalid-encoding' }
      }
    }
  }
  // 3. 宿主解码（编码以宿主打开文档的解码结果为准）
  const doc = await ports.openTextDocument(fsPath)
  if (!doc) {
    return { ok: false, reason: 'read-failed' }
  }
  const lfText = new NewlineCoordinator(doc.text).toLfText(doc.text)
  const lines = splitLfLines(lfText)
  // 4. 单行准入（不悄悄截断）
  for (const line of lines) {
    if (line.length > REF_TEXT_LIMITS.maxLineChars) {
      return { ok: false, reason: 'line-too-long' }
    }
  }
  const totalLines = lines.length
  // 5. 锚点（双链限定）：非双链来源的锚点段不生效（无锚点全文）
  let anchorSpec: ReturnType<typeof parseTextAnchorSpec>
  if (spec !== null && anchorSource === 'wikilink') {
    if (spec.kind === 'block') {
      // `#^块id` 形态：text 目标无块语义——就地报错（不静默当标题）
      return { ok: false, reason: 'anchor-invalid', anchor: `^${spec.anchor}`, anchorDetail: 'format' }
    }
    const parsed = parseTextAnchorSpec(spec.anchor)
    if (parsed === null) {
      return { ok: false, reason: 'anchor-invalid', anchor: spec.anchor, anchorDetail: 'format' }
    }
    anchorSpec = parsed
  } else {
    anchorSpec = {}
  }
  // 6. 校验与窗口规划（初次打开严格报错；anchorOptional 刷新钳制）
  const resolved = resolveTextNav(anchorSpec, totalLines, opts?.anchorOptional === true ? 'clamp' : 'strict')
  if (!resolved.ok) {
    return { ok: false, reason: 'anchor-invalid', anchor: spec !== null && anchorSource === 'wikilink' && spec.kind === 'heading' ? spec.anchor : undefined, anchorDetail: resolved.code }
  }
  const nav = resolved.nav
  // 7. 窗口裁剪（#range 硬窗口：范围外不进载荷——结构性不可滚达）
  const windowText = clipLinesToWindow(lines, nav.beginLine, nav.endLine).join('\n')
  // 定位区间（窗口正文坐标系；locateLine 在窗口内的行首——与 markdown
  // 通道「初始定位区间」语义同构，start=0 即无定位动作）
  let locateStart = 0
  for (let i = 0; i < nav.locateLine - nav.beginLine; i++) {
    locateStart += lines[nav.beginLine - 1 + i].length + 1
  }
  const appearance = (await ports.readTextEditorConfig?.(fsPath)) ?? null
  const content: RefTextContent = {
    kind: 'text',
    version: doc.version,
    lfText: windowText,
    range: { start: locateStart, end: windowText.length },
    languageId: doc.languageId ?? 'plaintext',
    selector: {
      kind: 'text',
      ...(nav.selector.line !== undefined ? { line: nav.selector.line } : {}),
      ...(nav.selector.range !== undefined ? { range: nav.selector.range } : {}),
    },
    hasWindow: nav.selector.range !== undefined,
    beginLine: nav.beginLine,
    endLine: nav.endLine,
    locateLine: nav.locateLine,
    jumpLine: nav.jumpLine,
    totalLines,
    font: appearance === null ? {} : { ...(appearance.family !== undefined ? { family: appearance.family } : {}), ...(appearance.size !== undefined ? { size: appearance.size } : {}), ...(appearance.ligatures !== undefined ? { ligatures: appearance.ligatures } : {}) },
    lineNumbers: appearance?.lineNumbers ?? true,
  }
  return { ok: true, content }
}

/**
 * #333（P3-01）类型化只读访问入口（生产读取路径）：目标三形态解析出
 * fsPath 后按类型分派——
 * - markdown：装载既有全文载荷（RefMarkdownContent：TextDocument 权威
 *   版本 + LF 全文 + 初始定位区间 + Markdown 导航选择器）；
 * - image（#336 / P3-04）：装载图片载荷（RefImageContent：来源文档相对
 *   图源 + stat 文件资源版本）——不读正文（openTextDocument 零调用），
 *   图片字节与版本戳不经本通道（webview 经既有 image.request 解析装载，
 *   「与普通 Markdown 图片同源呈现」）；锚点不参与（图片无锚点语义，
 *   不构成 anchor-missing）；
 * - pdf（#337 / P3-05）：装载文件资源载荷（RefPdfContent：资源 URI +
 *   文件状态代次 + 源字节 + PDF 导航选择器——#page=N 双链限定解析）；
 * - text（#340 / P3-08）：装载窗口正文载荷（RefTextContent——有界准入、
 *   双链 #line/#range 锚点、语言身份与外观配置，见 readTextContent）；
 * - web（#342 / P3-10）：解析层 external 分支归一 URL 后经抓取端口装载
 *   RefWebContent（无本地文件身份）。
 *
 * 类型由宿主按解析出的 fsPath 分类（classifyLocalRefContentKind），不
 * 接收前端声明的类型；web 目标在解析层即 unsupported（#342 接入时扩展）。
 * 锚点来源随三形态推导（双链限定：仅 target 形态的锚点段进入 text 锚点
 * 解析）。全程无副作用：不 openWith、不定位、不提示、不写文档。
 */
export async function readRefContentTarget(
  form: HoverTargetForm,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
  opts?: HoverReadOpts,
): Promise<RefReadOutcome> {
  const resolution = await resolveHoverTargetForm(form, ctx, ports, opts)
  if (!resolution.ok) {
    return resolution
  }
  if ('webUrl' in resolution) {
    // #342（P3-10）web 通道：受限抓取元信息（解析层已完成开关/端口/scheme/
    // URL 准入复核）；失败 reason 逐字透传（网络失败不伪装成文件缺失），
    // 成功装载 RefWebContent（fsPath/relPath 空串占位——无本地文件身份，
    // 不进 watch/租约/来源集合链路）
    const fetchWebMeta = ports.fetchWebMeta!
    const outcome = await fetchWebMeta(resolution.webUrl, opts?.web?.signal)
    if (!outcome.ok) {
      return outcome
    }
    return { ok: true, fsPath: '', relPath: '', content: { kind: 'web', ...outcome.meta } }
  }
  const kind = classifyLocalRefContentKind(resolution.fsPath)
  // 平台 API 按 isWindowsHost 显式限定（不随运行平台漂移）：CI Linux 上默认
  // 模块是 posix 语义，dirname 对 Windows 风格路径返回 '.'，relative 无从
  // 相对化而回退绝对路径（#346 修复轮 2 回归钉子见 hoverDocAccessPlatform.test.ts）
  const relOf = ctx.resolve.isWindowsHost ? path.win32.relative : path.posix.relative
  const dirnameOf = ctx.resolve.isWindowsHost ? path.win32.dirname : path.posix.dirname
  const relPath = relOf(ctx.rootFsPath, resolution.fsPath).replaceAll('\\', '/')
  if (kind === 'image') {
    // #336（P3-04）image 分派登记：图源 = 解析出的规范 fsPath 相对**来源
    // 文档目录**（ctx.sourceFsPath 的父目录——链接所在文档；webview 以面
    // 板文档身份发非来源化 image.request，同一基准解析回同一目标）。stat
    // 端口给出文件资源版本（mtimeMs）；探测失败不构成读取失败（版本退 0
    // ——排序基准缺失优于误报错误；图片存在性已由 resolveVaultFile 证实）
    let version = 0
    if (ports.statFile !== undefined) {
      const stat = await ports.statFile(resolution.fsPath).catch(() => null)
      if (stat !== null) {
        version = stat.mtimeMs
      }
    }
    return {
      ok: true,
      fsPath: resolution.fsPath,
      relPath,
      content: {
        kind: 'image',
        src: relOf(dirnameOf(ctx.sourceFsPath), resolution.fsPath).replaceAll('\\', '/'),
        version,
      },
    }
  }
  if (kind === 'pdf') {
    // #337（P3-05）pdf 通道：文件资源载荷 + 双链限定导航选择器
    const content = await readPdfContent(resolution.fsPath, resolution.spec, resolution.formKind, ports)
    if (!content.ok) {
      return content
    }
    return { ok: true, fsPath: resolution.fsPath, relPath, content: content.content }
  }
  if (kind !== 'markdown' && kind !== 'text') {
    // 类型分派表（#333 落位）：markdown/image/pdf/text 通道之外的类型不
    // 装载——既有 non-markdown 分态保持（四通道已登记，此处仅 web 之外
    // 的未知扩展类型防御性回落）
    return { ok: false, reason: 'non-markdown' }
  }
  if (kind === 'text') {
    const anchorSource: 'wikilink' | 'mdlink' | 'direct' =
      form.directTarget !== undefined ? 'direct' : form.linkHref !== undefined ? 'mdlink' : 'wikilink'
    const content = await readTextContent(resolution.fsPath, resolution.spec, anchorSource, ports, opts)
    if (!content.ok) {
      return content
    }
    return { ok: true, fsPath: resolution.fsPath, relPath, content: content.content }
  }
  const content = await readMarkdownContent(resolution.fsPath, resolution.spec, ports, opts)
  if (!content.ok) {
    return content
  }
  return {
    ok: true,
    fsPath: resolution.fsPath,
    relPath,
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
