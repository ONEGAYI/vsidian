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

/** T03（#623）选区片段：主文档选区的严格原文切片（不扩大到段落/表格行/
 *  围栏）。在场时导出页以片段序列替代 docs[0].text 的全文挂载——每片段
 *  独立 Markdown 解析（半段语法按真实降级呈现），按文档顺序组合；docs[0]
 *  仍携带全文（嵌入超集预取与 docStyle 收集的消费面不变），资源身份与
 *  docScope 均以 docs[0].fsPath 解析。 */
export interface PdfExportSelectionFragment {
  /** 片段在主文档 LF 全文的起始（观测面；页面渲染不依赖） */
  start: number
  /** 结束（不含） */
  end: number
  /** 切片文本（严格原文，不补齐） */
  text: string
}

/** T06（#626）合并导出的分篇条目：每篇一份完整固定输入（主文档 + **该篇**
 *  的嵌入预取超集）。按篇携带的原因：嵌入 inner 的解析以**来源文档**为基准
 *  （readEmbedTarget 在源文档上下文解析相对路径），两篇同 inner 可解析到
 *  不同目标——顶层 union 无法按篇归属，装配与失败面都按篇消费。 */
export interface PdfMergeDocEntry {
  doc: PdfExportDocEntry
  /** 本篇的嵌入预取（成功） */
  embeds: PdfExportEmbedEntry[]
  /** 本篇的非 Markdown 嵌入目标身份 */
  mediaEmbeds: PdfExportMediaEmbedEntry[]
  /** 本篇的预取失败登记 */
  embedFailures: PdfExportEmbedPrefetchFailure[]
}

/** 导出页完整载荷（骨架页 nonce 内联注入） */
export interface PdfExportPagePayload {
  /** 首项恒为主文档（merge 在场时 = 全部主文档依清单序 + 嵌入目标并集
   *  ——docStyle 收集与资源身份数据面不变，挂载面以 merge.docs 为准） */
  docs: [PdfExportDocEntry, ...PdfExportDocEntry[]]
  /** 嵌入目标预取（成功；按 inner 去重——merge 在场时为跨篇并集，消费
   *  面按篇走 merge.docs[k].embeds） */
  embeds: PdfExportEmbedEntry[]
  /** 非 Markdown 嵌入目标身份（降级说明用） */
  mediaEmbeds: PdfExportMediaEmbedEntry[]
  /** 预取失败登记（页面按块消费时命中才呈现） */
  embedFailures: PdfExportEmbedPrefetchFailure[]
  style: PdfExportStyleSnapshot
  snippets: PdfExportSnippetEntry[]
  /** T06（#626）合并导出：多主文档分篇装配。在场时装配侧按 merge.docs
   *  逐篇挂载（替代 docs[0] 单主文档全文），每篇独立 docScope/资源身份
   *  （样式与相对资源不跨篇污染）；pageBreak = 每篇另起一页（首篇除外
   *  ——break-before: page），关闭 = 连续排版。 */
  merge?: {
    docs: [PdfMergeDocEntry, ...PdfMergeDocEntry[]]
    pageBreak: boolean
  }
  /** T03（#623）选区片段（在场 = 选区导出：替代 docs[0] 全文挂载；
   *  空数组 = 零正文——不回落全文，不误触发全文导出） */
  fragments?: PdfExportSelectionFragment[]
  /** 远端文件系统身份（双轴评审 P1，规格 §2.3「不能将远端路径伪装成可在
   *  本机打开的文件地址」）：true = payload 内 fsPath 属 Remote SSH 工作区
   *  （文档在远端、浏览器与产物在本机）——媒体/PDF 嵌入与行内媒体降级
   *  **不产出 file:/// 链接**（远端路径以远端标注纯文本呈现）；http(s)
   *  目标不受影响。由远端适配器在 renderPage 咽喉统一标注（链接规则的
   *  身份判据单一事实源——payload 其余构建点零感知）；本地窗口缺省。 */
  remoteFs?: boolean
  /** 阅读宽松换行（#423：渲染器 breaks 与阅读视图同值） */
  breaks: boolean
  /** mermaid 产物地址（http 服务同源供） */
  mermaidUri: string
  /** 资源解析端点前缀（同源绝对路径，含 token 根） */
  resBase: string
  locale: 'zh-cn' | 'en'
}

/** 标题书签报告（T05/#625 定义于 pdfExportJob，T08/#628 下沉 shared——
 *  跨宿主协议两端口径同源）：written=false 时产物不加 /Outlines——不给
 *  伪造书签；机器原因码不进用户文案（模态按 reason 映射词条） */
export interface PdfBookmarkReport {
  written: boolean
  /** 埋点标题总数 */
  total: number
  /** 定位失败被跳过的标题数（written=true 时可为部分跳过） */
  skipped: number
  reason?: 'disabled' | 'no-headings' | 'none-located' | 'locate-failed' | 'write-failed'
  /** 失败的原始诊断信息（观测面；不进用户文案） */
  detail?: string
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
