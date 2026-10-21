// PDF 导出固定输入载荷（T02/#622）：宿主准备阶段 → 导出页的单一事实源。
//
// 职责（规格 §2.1/§2.3）：
// - 准备阶段固定输入：主文档全文（含未保存）+ 嵌入目标预取全文 + 阅读
//   样式快照 + CSS 片段文本，一次装配进导出页骨架；生成期间后续编辑不
//   混入（导出页零回读）。
// - 嵌入预取是**超集**（宿主逐行枚举独占行嵌入目标，页面按 Reading 块
//   精确消费）——多取的目标不构成失败；真实失败面由页面侧按块消费后
//   登记进 failures（宿主 probe 阶段拉取）。
// - 失败项类型两端共享：页面产出（image/graphic/media/embed 消费失败），
//   模态按 kind + reason 做 i18n 映射；机器原因码不进用户文案。
//
// 零依赖（webview 与宿主两端共用，不引 node:/DOM API）。

/** 参与导出的文档条目（主文档 + 每个成功预取的嵌入目标一份） */
export interface PdfExportDocEntry {
  /** 规范绝对身份（`/` 分隔；嵌入目标 B 的原文档身份——资源以它解析） */
  fsPath: string
  /** 文档显示名（含扩展名） */
  docName: string
  /** 固定输入的 LF 全文快照 */
  text: string
  /** 固定时刻权威版本（观测面） */
  version: number
}

/** Markdown 嵌入目标的预取条目（按 inner 原文键去重） */
export interface PdfExportEmbedEntry extends PdfExportDocEntry {
  /** `![[` 与 `]]` 之间的原文（页面按块精确匹配消费） */
  inner: string
}

/** 非 Markdown 嵌入目标（PDF/音视频等）的身份条目：页面降级为静态说明
 *  + 真实可点击链接（本地 file:/// 真实路径、远端原 URL——不伪装） */
export interface PdfExportMediaEmbedEntry {
  inner: string
  kind: 'pdf' | 'media' | 'web'
  /** 本地目标规范绝对 fsPath（web 目标缺省） */
  fsPath?: string
  /** 远端目标原 URL（本地目标缺省） */
  url?: string
}

/** 预取失败登记（超集的一部分）：页面消费时命中（块级嵌入且无成功条目）
 *  才降级呈现并计入 failures——枚举形态（列表内混排等）不命中即静默 */
export interface PdfExportEmbedPrefetchFailure {
  inner: string
  reason: string
}

/** 阅读样式快照：编辑器面板 webview 的主题变量计算值 + 阅读正文外观 */
export interface PdfExportStyleSnapshot {
  dark: boolean
  /** 主体 CSS 自定义属性计算值（--vscode-* 与 --h1-color 等引用族） */
  vars: Record<string, string>
  /** 阅读正文计算外观（导出页正文样式跟随） */
  reading: { fontFamily?: string; fontSize?: string; lineHeight?: string }
}

/** CSS 片段固定文本（宿主读文件；@page 由装配侧统一剥离——T01 防线） */
export interface PdfExportSnippetEntry {
  name: string
  css: string
}

/** 导出页完整载荷（骨架页 nonce 内联注入） */
export interface PdfExportPagePayload {
  /** 首项恒为主文档 */
  docs: [PdfExportDocEntry, ...PdfExportDocEntry[]]
  /** 嵌入目标预取（成功；按 inner 去重） */
  embeds: PdfExportEmbedEntry[]
  /** 非 Markdown 嵌入目标身份（降级说明用） */
  mediaEmbeds: PdfExportMediaEmbedEntry[]
  /** 预取失败登记（页面按块消费时命中才呈现） */
  embedFailures: PdfExportEmbedPrefetchFailure[]
  style: PdfExportStyleSnapshot
  snippets: PdfExportSnippetEntry[]
  /** 阅读宽松换行（#423：渲染器 breaks 与阅读视图同值） */
  breaks: boolean
  /** mermaid 产物地址（http 服务同源供） */
  mermaidUri: string
  /** 资源解析端点前缀（同源绝对路径，含 token 根） */
  resBase: string
  locale: 'zh-cn' | 'en'
}

/** 页面侧失败项（probe 阶段宿主拉取；模态 i18n 列表数据源） */
export type PdfExportFailureKind = 'embed' | 'image' | 'graphic' | 'media'

export interface PdfExportFailureItem {
  kind: PdfExportFailureKind
  /** 目标标识（嵌入 inner / 图源 / 图形语言） */
  item: string
  /** 机器原因码（不进用户文案；模态按 kind+reason 映射词条） */
  reason: string
}

/** 页面就绪态（browserLauncher 轮询谓词读取的整体 JSON） */
export interface PdfExportReadyState {
  /** 正文与嵌入装配完成（含媒体降级与 docStyle 装载发起） */
  assembled: boolean
  /** 全部 img complete && naturalWidth > 0 */
  images: boolean
  /** 全部图形容器非 pending/rendering（mermaid 队列空） */
  graphics: boolean
  /** document.fonts.status（'loaded' 才与 asyncReady 合取） */
  fonts: string
  /** assembled && images && graphics */
  asyncReady: boolean
  /** 页面侧真实失败清单（按块消费后的权威失败面） */
  failures: PdfExportFailureItem[]
}

export const PDF_EXPORT_FAILURE_KINDS: readonly PdfExportFailureKind[] = ['embed', 'image', 'graphic', 'media']

export function isPdfExportFailureKind(value: unknown): value is PdfExportFailureKind {
  return typeof value === 'string' && (PDF_EXPORT_FAILURE_KINDS as readonly string[]).includes(value)
}

/** 失败项运行期校验（CDP evaluate 回传值的防御性收窄） */
export function isPdfExportFailureItem(value: unknown): value is PdfExportFailureItem {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isPdfExportFailureKind(v['kind']) && typeof v['item'] === 'string' && typeof v['reason'] === 'string'
}
