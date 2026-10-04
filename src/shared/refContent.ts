// 引用内容类型分派共享内核（#333 / P3-01，三期「访问、身份与挂载责任」
// 表的 shared 层落点）：目标类型分类学、Markdown 载荷类型与导航选择器
// 结构留位——宿主读取分派（host/hoverDocAccess 的 readRefContentTarget）
// 与 webview 内容装载（refContentInstance 的 refLoadedContentOfResult）
// 按同一 kind 对齐；两端不各自发明第二套类型判别。
//
// 类型边界（与三期正式规格「访问、身份与挂载责任」节对齐）：
// - #333 落地 markdown 通道（TextDocument 权威版本 + LF 全文 + 初始
//   定位区间 + Markdown 导航选择器）；#336（P3-04）登记 image 载荷
//   （来源文档相对图源 + 文件资源版本）；#337（P3-05）登记 pdf 载荷
//   （文件资源 URI + 文件状态代次 + 源字节 + PDF 导航选择器——双链
//   #page=N 解析单一事实源在 shared/pdfNav）；#340（P3-08）登记 text
//   载荷（窗口 LF 正文 + TextDocument 权威版本 + 文本导航选择器——
//   #line/#range 解析单一事实源在 shared/refText）；#342（P3-10）登记
//   web 载荷（外链卡片元信息）——Markdown 的 TextDocument.version 和
//   LF 范围不得冒充这些类型的版本或页码。
// - 本地目标的类型由宿主按解析出的 fsPath 分类（前端不声明类型、不
//   接收任意 URI）；web 类型由 href scheme 判定（#342 接入），不经本地
//   文件分类产生。
// - 导航选择器按文件类型区分：Markdown 沿用 full/heading/block（标题
//   锚点直读，`;`/`key=value` 分词不参与——2026-10-04 锚点语法修订的分
//   词边界口径）；PDF #page / 文本 #line/#range / 图片与网页 plain 均
//   已随各自载荷落地。
//
// 本模块不依赖 vscode/DOM（两端共享纯逻辑；与 protocol 的关系：协议
// 消息经 contentKind 引用本模块的分类学，消息形态仍以 protocol 为单一
// 事实源）。
import type { HoverPreviewScope } from './protocol'
import { isImageFileExtension } from './imageRefresh'
import { parseWikilinkInner } from './wikilink'

/** 引用目标内容类型（三期五类）：markdown 既有通道；pdf/image/text/web
 *  已分别由 #337/#336/#340/#342 落地登记 */
export type RefContentKind = 'markdown' | 'pdf' | 'image' | 'text' | 'web'

/** kind 全集（运行期校验的已知类型枚举——校验器据此拒绝未知类型） */
export const REF_CONTENT_KINDS: readonly RefContentKind[] = ['markdown', 'pdf', 'image', 'text', 'web']

/** 运行期类型判别（消息校验与消费端复核共用；未知类型为 false） */
export function isRefContentKind(value: unknown): value is RefContentKind {
  return typeof value === 'string' && (REF_CONTENT_KINDS as readonly string[]).includes(value)
}

/** 本地目标类型（web 不在本地分类产出之列——外链由 href scheme 判定） */
export type LocalRefContentKind = 'markdown' | 'pdf' | 'image' | 'text'

/**
 * 本地目标类型分类：按扩展名（大小写不敏感）——
 * - `.md` → markdown（与既有 isMarkdownPath 读取白名单同口径）；
 * - `.pdf` → pdf（P3-05 载荷登记前的分派落点）；
 * - 图片扩展名 → image（与图片管线 IMAGE_WATCH_GLOB_SEGMENTS 同源——
 *   P3-04「与普通 Markdown 图片同源呈现」的类型入口）；
 * - 其余（代码/配置/无扩展名）→ text（P3-08 可读文本）。
 */
export function classifyLocalRefContentKind(fsPath: string): LocalRefContentKind {
  const dot = fsPath.lastIndexOf('.')
  const ext = dot < 0 ? '' : fsPath.slice(dot + 1).toLowerCase()
  if (ext === 'md') {
    return 'markdown'
  }
  if (ext === 'pdf') {
    return 'pdf'
  }
  if (isImageFileExtension(fsPath)) {
    return 'image'
  }
  return 'text'
}

/**
 * #336（P3-04）嵌入/双链目标的图片预判（webview 渲染路径分流判据）：
 * inner 为 `![[`/`[[` 与 `]]`/`]]` 之间的原文（可含 `|别名`）。判据 =
 * 双链形态学解析出的 path 非空且扩展名为图片（与
 * classifyLocalRefContentKind 的扩展名口径同源——带扩展名目标解析不补
 * .md，书写扩展名即解析后扩展名，预判与宿主按 fsPath 分派结构性一致；
 * 锚点不参与——图片目标无锚点定位语义）。宿主回包的 contentKind 仍是
 * 权威，本判定只决定 webview 先走哪条**渲染路径**（Reading inline 规则
 * 产 img、Live 嵌入装饰分流图片 widget、占位配对扫描跳过、浮层纯阅读
 * 形态），不构成前端声明目标类型的读取通道。
 */
export function refEmbedTargetIsImage(inner: string): boolean {
  const parsed = parseWikilinkInner(inner)
  if (!parsed || parsed.path === '') {
    return false
  }
  return isImageFileExtension(parsed.path)
}

/**
 * Markdown 载荷（kind === 'markdown' 的成功载荷形态）：宿主读取分派装
 * 载、会话出站（hover.result 的 Markdown 字段由此展开）、webview 装载
 * 转换三方同形。version 为宿主 TextDocument 权威版本；range 为 LF 初始
 * 定位区间（P2-03 #280：内容范围恒全文，range 只作定位）；selector 为
 * Markdown 导航选择器。
 */
export interface RefMarkdownContent {
  kind: 'markdown'
  /** 目标 TextDocument.version（#224 变更刷新的版本基准） */
  version: number
  /** LF UTF-16 全文（webview 坐标契约） */
  lfText: string
  /** 初始定位区间（LF 坐标；锚点命中的锚定区间，full/宽容退化为全文区间） */
  range: { start: number; end: number }
  /** Markdown 导航选择器（full / heading / block） */
  selector: HoverPreviewScope
}

/**
 * #342（P3-10）外链卡片载荷（kind === 'web'）：宿主受限抓取提取的元信
 * 息——url 为最终归一地址（重定向后），domain/title/description 为展示
 * 面（title/description 缺席为空串，消费端以域名兜底）。无本地文件身
 * 份（fsPath/relPath 占位空串）、无 TextDocument 版本——网页缓存按规范
 * URL 与形态区分，不伪造宿主文档版本。
 */
export interface RefWebContent {
  kind: 'web'
  /** 最终 URL（重定向后归一；显示与缓存身份） */
  url: string
  /** 最终主机名（展示域名） */
  domain: string
  title: string
  description: string
}

/** 语言级生效字体（宿主 getConfiguration('editor', doc) 合并后的值；
 *  字段缺席 = 未设置（webview 沿用默认栈） */
export interface RefTextFont {
  family?: string
  size?: number
  ligatures?: boolean
}

/**
 * 可读文本载荷（#340 / P3-08，kind === 'text' 的成功载荷形态）：经有界
 * 准入（大小/二进制/编码/超长行）与锚点校验后的窗口正文——
 * - lfText 为**窗口内** LF 正文（#range 硬窗口只携带 B–E 行，范围外
 *   结构性不可达；无 range 恒全文）；version 为宿主 TextDocument 权威
 *   版本（未保存修改刷新的版本基准）；
 * - 行号字段全部为 1-based 绝对行（对应宿主 LF 权威正文）：beginLine/
 *   endLine 为当前正文覆盖窗口（无 range 即 [1, totalLines]），
 *   locateLine 为初始展示起点、jumpLine 为跳转锚点（规范：line 决定、
 *   仅 range 落窗口起点 B、无锚点落文件顶部）；
 * - languageId/font/lineNumbers 以目标资源／语言的原生配置为准（宿主
 *   读取；不内置 grammar、不硬编码配色——token 由宿主外观服务另行
 *   经 hover.tokens 分层推送，与正文同 version 配对）。
 */
export interface RefTextContent {
  kind: 'text'
  /** 目标 TextDocument.version（正文与 token 的版本配对基准） */
  version: number
  /** 窗口内 LF UTF-16 正文（硬窗口裁剪后；无 range 恒全文） */
  lfText: string
  /** 初始定位区间（LF 坐标，locateLine 行首起——与 markdown 通道的定位
   *  语义同构，供既有装载路径消费） */
  range: { start: number; end: number }
  /** 目标语言身份（宿主 TextDocument.languageId） */
  languageId: string
  /** 导航选择器（resolveTextNav 校验后的数值形态） */
  selector: RefTextNavSelector
  /** 是否显式 range 硬窗口（false = 全文可滚） */
  hasWindow: boolean
  beginLine: number
  endLine: number
  locateLine: number
  jumpLine: number
  /** 宿主 LF 权威正文总行数（窗口外的总界） */
  totalLines: number
  /** 语言级生效字体（宿主读取；缺席字段沿用默认） */
  font: RefTextFont
  /** 原生 editor.lineNumbers 生效值（off 时行号列不呈现） */
  lineNumbers: boolean
}

// ---- 导航选择器结构（按文件类型区分；#337 PDF / #340 文本选择器随
// 各自载荷落地——image/web 为 plain 无锚点语义） ----

/**
 * #336（P3-04）图片载荷（kind === 'image' 的成功载荷形态）：宿主读取
 * 分派装载、会话出站（hover.result 的 image 字段由此展开）、webview 装
 * 载转换三方同形。
 * - src 为**来源文档相对图源**（posix 分隔；宿主从解析出的规范 fsPath
 *   相对来源文档目录计算）——webview 经 image.request（面板文档身份）
 *   解析为可加载地址，复用普通 Markdown 图片的加载/重试/失效/弹窗管线
 *   （「与普链同源呈现」的单一行为源）。宿主不回传字节或 webview URI
 *   ——图片资源装载与版本戳走既有图片通道，不把 hover.result 变成第二
 *   条图片资源通道。
 * - version 为文件资源版本（stat mtimeMs；端口不可用时 0）——仅作回包
 *   排序与预算键基准，图片新鲜度权威在失效通道（watch/#201），mtime 不
 *   冒充 TextDocument.version。
 */
export interface RefImageContent {
  kind: 'image'
  /** 来源文档相对图源（posix 分隔；image.request 的 src 载荷） */
  src: string
  /** 文件资源版本（stat mtimeMs；不可得为 0） */
  version: number
}

/**
 * PDF 载荷（#337 / P3-05，kind === 'pdf' 的成功载荷形态）：宿主按文件
 * 资源读取（stat 三态 + 资源 URI + 文件状态代次），**不装载正文字节**——
 * PDF 源经 webview 资源域按需 fetch（宿主 Node 侧零 PDF 渲染代码）。
 * - version 为**文件状态代次**（宿主侧按 mtime/size 观测推进的单调值，
 *   图片资源版本表同款语义）——不得用 TextDocument.version 冒充（PDF
 *   不经文本管线）；
 * - uri 为 webview 资源 URI（含 `?v=` 代次戳，资源缓存击穿）；
 * - bytes 为源文件字节（逻辑预算费用——REF_EXPANSION_LIMITS 的字节
 *   预算按此计，不代表解码内存）；
 * - selector 为 PDF 导航选择器（双链 #page=N 解析产物；普通链接
 *   fragment 不解析，恒无 page 字段）。
 */
export interface RefPdfContent {
  kind: 'pdf'
  /** 文件状态代次（单调；mtime/size 观测变化时推进） */
  version: number
  /** webview 资源 URI（含 ?v= 代次戳）——PDF 源字节按需 fetch */
  uri: string
  /** 源文件字节（逻辑预算费用） */
  bytes: number
  /** PDF 导航选择器（双链限定 #page=N；无 page = 第一页） */
  selector: RefPdfNavSelector
}

/** 类型化成功载荷联合（#333 markdown；#336 image；#337 pdf；#340 text；#342 web） */
export type RefContentPayload = RefMarkdownContent | RefImageContent | RefPdfContent | RefTextContent | RefWebContent

/** PDF 导航选择器（#337 落地）：`#page=N`（双链限定）——1-based 正整数，
 *  仅初始定位，原链接不改写；页区间等其他键不新增（2026-10-04 修订
 *  确认）。无 page 字段 = 第一页；解析与校验单一事实源 shared/pdfNav */
export interface RefPdfNavSelector {
  kind: 'pdf'
  page?: number
}

/** 可读文本导航选择器（#340 落地）：`#line=N`（1-based，初始定位与跳转
 *  锚点）与 `#range=B-E`（闭区间硬展示窗口；开放端以字段缺席表示——
 *  `B-` 缺 end、`-E` 缺 begin）；两者可组合、键序无关、同一键重复非法
 *  （分词与校验单一事实源在 shared/refText） */
export interface RefTextNavSelector {
  kind: 'text'
  line?: number
  range?: { begin?: number; end?: number }
}

/** 图片/网页导航选择器：无锚点定位语义（图片复用普通图片呈现，网页为
 *  抓取元信息——位置概念不适用） */
export interface RefPlainNavSelector {
  kind: 'plain'
}

/** 导航选择器联合（按目标类型区分）：Markdown 语义不变（HoverPreviewScope
 *  直读），非 Markdown 形态为结构留位 */
export type RefNavSelector =
  | HoverPreviewScope
  | RefPdfNavSelector
  | RefTextNavSelector
  | RefPlainNavSelector
