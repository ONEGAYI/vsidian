// 引用内容类型分派共享内核（#333 / P3-01，三期「访问、身份与挂载责任」
// 表的 shared 层落点）：目标类型分类学、Markdown 载荷类型与导航选择器
// 结构留位——宿主读取分派（host/hoverDocAccess 的 readRefContentTarget）
// 与 webview 内容装载（refContentInstance 的 refLoadedContentOfResult）
// 按同一 kind 对齐；两端不各自发明第二套类型判别。
//
// 类型边界（与三期正式规格「访问、身份与挂载责任」节对齐）：
// - #333 落地 markdown 通道（TextDocument 权威版本 + LF 全文 + 初始
//   定位区间 + Markdown 导航选择器）；#337（P3-05）登记 pdf 载荷
//   （文件资源 URI + 文件状态代次 + 源字节 + PDF 导航选择器——双链
//   #page=N 解析单一事实源在 shared/pdfNav）；image/text/web 仍为类型
//   与校验留位，载荷形态由 P3-04（图片）/ P3-08（文本）/ P3-10（外链）
//   按同一 kind 登记——Markdown 的 TextDocument.version 和 LF 范围不得
//   冒充这些类型的版本或页码。
// - 本地目标的类型由宿主按解析出的 fsPath 分类（前端不声明类型、不
//   接收任意 URI）；web 类型由 href scheme 判定（#342 接入），不经本地
//   文件分类产生。
// - 导航选择器按文件类型区分：Markdown 沿用 full/heading/block（标题
//   锚点直读，`;`/`key=value` 分词不参与——2026-10-04 锚点语法修订的分
//   词边界口径）；PDF #page / 文本 #line/#range 为结构留位（文本锚点
//   解析由 P3-08 实现）。
//
// 本模块不依赖 vscode/DOM（两端共享纯逻辑；与 protocol 的关系：协议
// 消息经 contentKind 引用本模块的分类学，消息形态仍以 protocol 为单一
// 事实源）。
import type { HoverPreviewScope } from './protocol'
import { isImageFileExtension } from './imageRefresh'

/** 引用目标内容类型（三期五类）：markdown 既有通道；pdf/image/text/web
 *  为三期扩展目标（本票仅留位——载荷与导航选择器由对应票登记） */
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

/** 类型化成功载荷联合（#333 markdown；#337 起 pdf 登记） */
export type RefContentPayload = RefMarkdownContent | RefPdfContent

// ---- 导航选择器结构（按文件类型区分；#337 起 PDF 选择器随 pdf 载荷
// 落地——文本 #line/#range 的分词语义由 P3-08 实现） ----

/** PDF 导航选择器（#337 落地）：`#page=N`（双链限定）——1-based 正整数，
 *  仅初始定位，原链接不改写；页区间等其他键不新增（2026-10-04 修订
 *  确认）。无 page 字段 = 第一页；解析与校验单一事实源 shared/pdfNav */
export interface RefPdfNavSelector {
  kind: 'pdf'
  page?: number
}

/** 可读文本导航选择器（留位）：`#line=N`（1-based，初始定位与跳转锚点）
 *  与 `#range=B-E`（闭区间硬展示窗口；开放端以字段缺席表示）；两者可
 *  组合、键序无关、同一键重复非法（分词语义由 P3-08 实现） */
export interface RefTextNavSelector {
  kind: 'text'
  line?: number
  range?: { begin: number; end: number }
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
