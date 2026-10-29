// PDF 导出页正文装配（T02/#622）：浏览器页面内复用 webview Reading 管线。
//
// 架构（票 #622「核心方向」）：导出正文的完整装配发生在导出页（Chrome
// 页面，http origin——V01 §10.1 opaque origin 坑的结构性规避），宿主只
// 提供固定输入 payload 与资源服务；本模块与阅读视图共用同一批模块——
// 解析（splitReadingBlocks）、DOM 构建（createReadingBlockElement——净化
// 与任务项转换在内）、图片（ImageResourceManager，宿主通道经 deps 注入
// http 端口）、HTML 资源（htmlResourceHub 单例，port 经
// registerHtmlResourcePort 注入 http 通道）、文档样式（DocumentStyleBinding
// ——docScope 作用域语义与产物装载生命周期原样）、图形渲染
// （renderGraphicBlockInto/renderMermaidIn——mermaid 产物经注入的
// __vsidianMermaidUri 懒加载）、混排嵌入提升（promoteEmbedSlotsInBlock）。
// 不建第二套路径解析/文档样式收集/净化规则。
//
// 嵌入展开（规格 §2.3）：
// - payload.embeds 按 inner 精确匹配（块级 embed 块 + 混排提升宿主统一经
//   data-vsidian-embed-inner 通道）；展开一层——B 的块群挂 B 的 docScope，
//   B 内嵌块保留占位引用行（与阅读嵌入卡一层展开同边界，循环天然断）。
// - 非 Markdown 嵌入（payload.mediaEmbeds）与正文 video/audio/iframe 降级
//   为静态说明 + 不可误导的链接呈现：本地 file:/// 真实路径、http(s) 原
//   URL；远端身份（payload.remoteFs——Remote SSH 咨询单一判据）不产
//   file:/// 链接（远端路径以远端标注纯文本呈现，不伪装本机地址——规格
//   §2.3；决策单一事实源 mediaNoticeTargetOf）。
// - 预取失败（embedFailures）按块命中才呈现失败说明并计入 failures；
//   枚举超集不命中即静默（与阅读形态学差异不冒充失败）。
//
// 完成信号分层（V01 §5 语义）：assembled（同步装配 + 图片解析请求已发）∧
// images（全图槽位终态且 loaded 图 complete&&naturalWidth>0）∧ graphics
// （全图形容器非 pending/rendering）；fonts 由宿主谓词另行轮询
// document.fonts.status。禁止固定延迟。
//
// jsdom 可单测：http 端口与 DOM 均可注入。

import { applyReadingRendererBreaks, splitReadingBlocks } from './readingBlocks'
import { createReadingBlockElement, prepareReadingImages, READING_CLASS_NAMES } from './readingView'
import { ImageResourceManager } from './imageResource'
import { registerHtmlResourcePort, notifyHtmlResourceResult, hubResourcePort } from './htmlResourceHub'
import { prepareHtmlResources, NESTED_DOC_ROOT_ATTR, type HtmlResourceBinding } from './htmlResourceMount'
import { DocumentStyleBinding } from './docStyleLoader'
import { docScopeKeyOf } from '../shared/docStyle'
import { promoteEmbedSlotsInBlock } from './embedSlots'
import { mountCalloutIcons } from './calloutIconMount'
import { renderGraphicBlockInto } from './graphicRenderers'
import { renderMermaidIn } from './mermaidRender'
import { GRAPHIC_LANG_ATTR, MERMAID_CODE_ATTR, MERMAID_STATE_ATTR } from '../shared/mermaid'
import { graphicRendererFor } from './graphicRenderers'
import { t } from '../shared/i18n'
import type {
  PdfExportEmbedEntry,
  PdfExportFailureItem,
  PdfExportMediaEmbedEntry,
  PdfExportPagePayload,
} from '../shared/pdfExportPayload'

/** 导出正文容器公开类名（pdfExportPage.css 钉观感；复用的阅读类名不改） */
export const PDF_EXPORT_CLASS_NAMES = {
  /** 导出正文根（#app 直下，阅读容器复用类叠加导出限定） */
  root: 'vsidian-pdf-export-root',
  /** 嵌入展开容器（来源标识行 + B 的块群） */
  embedExpanded: 'vsidian-pdf-embed-expanded',
  /** 嵌入来源标识行（B 的显示名） */
  embedSourceLabel: 'vsidian-pdf-embed-source',
  /** 嵌入/媒体降级说明块 */
  notice: 'vsidian-pdf-notice',
  /** 降级说明内链接 */
  noticeLink: 'vsidian-pdf-notice-link',
  /** 降级说明内远端路径标注（远端身份目标的纯文本呈现——不可点） */
  noticeRemotePath: 'vsidian-pdf-notice-remote-path',
  /** T06（#626）合并分篇容器（每篇一块——docScope 与资源身份的篇边界） */
  mergeDoc: 'vsidian-pdf-merge-doc',
  /** T06（#626）每篇另起一页（非首篇分篇容器的分页修饰类） */
  mergeBreak: 'vsidian-pdf-merge-break',
} as const

/** 标题书签埋点属性（T05/#625）：装配层 heading 块挂 level 标记，宿主
 *  probe 阶段拉取（DOM 文档顺序 = 书签顺序；标题文本读 textContent——
 *  行内标记天然剥离）。层级口径 = Reading 管线 heading 块的 level
 *  （markdown-it 标题 token，与用户看到的标题层级一致）。 */
export const PDF_EXPORT_HEADING_LEVEL_ATTR = 'data-vsidian-heading-level'

/** T06（#626）标题书签埋点的篇序属性：合并分篇容器内的 heading 挂所属
 *  篇序（merge.docs 下标——嵌入展开容器内的标题随宿主篇）；单文档导出
 *  不挂，宿主侧缺省归 0（readHeadingMarks 同口径） */
export const PDF_EXPORT_HEADING_DOC_ATTR = 'data-vsidian-heading-doc'

function annotateHeadingMark(el: HTMLElement, kind: string, level: number | undefined, docIndex?: number): void {
  if (kind === 'heading') {
    el.setAttribute(PDF_EXPORT_HEADING_LEVEL_ATTR, String(level ?? 1))
    if (docIndex !== undefined) {
      el.setAttribute(PDF_EXPORT_HEADING_DOC_ATTR, String(docIndex))
    }
  }
}

/** 图片槽位终态属性值（ImageSlotState） */
const IMG_STATE_ATTR = 'data-vsidian-img-state'

/** 图片解析端口（宿主 http /res 端点；返回可作 img.src 的同源 URL） */
export interface PdfExportImagePort {
  resolve(src: string, sourceFsPath: string | undefined): Promise<{ ok: true; url: string } | { ok: false; reason: string }>
}

/** htmlResource.request 的 http 端口（回包经 notifyHtmlResourceResult 路由） */
export interface PdfExportResourceChannel {
  send(message: { reqId: number; url: string; sourceDocUri?: string }): Promise<{ reqId: number; ok: boolean; url?: string; reason?: string }>
}

export interface PdfExportAssemblyPorts {
  images: PdfExportImagePort
  channel: PdfExportResourceChannel
}

export interface PdfExportAssemblyHandle {
  /** 装配期已知失败（嵌入/媒体/图形——图片装载失败在就绪态里） */
  failures: PdfExportFailureItem[]
  /** 完成信号谓词的页面侧求值（宿主轮询读；图片/图形态实时） */
  readiness(): { assembled: boolean; images: boolean; graphics: boolean }
  /** 图片槽位失败清单（就绪后提取——error 态槽位的 src+reason） */
  imageFailures(): PdfExportFailureItem[]
  /** 图形渲染失败清单（终态后提取——error 态容器） */
  graphicFailures(): PdfExportFailureItem[]
  /** 释放（docStyle/订阅/图片槽位——导出页生命周期随页面，通常无需显式调） */
  dispose(): void
}

/** 装配期身份标记：展开容器的来源 fsPath（装配内部回查用，非公开契约） */
const EMBED_FS_PATH_ATTR = 'data-vsidian-pdf-embed-fs'

/** 装配期身份标记：合并分篇容器的来源 fsPath 与篇序（资源身份回查与
 *  docRoots 数据面，非公开契约） */
const MERGE_SECTION_FS_ATTR = 'data-vsidian-pdf-merge-fs'
const MERGE_SECTION_INDEX_ATTR = 'data-vsidian-pdf-merge-index'

/** 嵌入展开：B 全文的块群 + 来源标识行（B 的 docScope；一层边界——B 内
 *  embed 块保留占位引用行，不再展开） */
function buildExpandedEmbed(doc: PdfExportPagePayload['docs'][number]): HTMLElement {
  const scope = docScopeKeyOf(doc.fsPath)
  const box = document.createElement('div')
  box.className = `${READING_CLASS_NAMES.embedBlock} ${PDF_EXPORT_CLASS_NAMES.embedExpanded}`
  box.dataset['vsidianDocScope'] = scope
  box.setAttribute(EMBED_FS_PATH_ATTR, doc.fsPath)
  // 嵌套文档根标记：外层文档根的图片/资源/ID 公证述以下内层根的子树归本根
  // 所有——同一 <img> 不被两层根各绑一次（外层先剥 src，内层拿空串会向宿主
  // 请求空图源并被分类成 blocked）
  box.setAttribute(NESTED_DOC_ROOT_ATTR, '1')
  const label = document.createElement('div')
  label.className = PDF_EXPORT_CLASS_NAMES.embedSourceLabel
  label.textContent = doc.docName
  box.appendChild(label)
  for (const block of splitReadingBlocks(doc.text)) {
    const el = createReadingBlockElement(block, doc.text, scope)
    annotateHeadingMark(el, block.kind, block.kind === 'heading' ? block.level : undefined)
    box.appendChild(el)
  }
  return box
}

/** 媒体/PDF 嵌入降级说明：静态文字 + 真实可点击链接（不伪装本机路径） */
function buildMediaNotice(kindLabel: string, linkHref: string, linkText: string): HTMLElement {
  const notice = document.createElement('div')
  notice.className = PDF_EXPORT_CLASS_NAMES.notice
  const a = document.createElement('a')
  a.className = PDF_EXPORT_CLASS_NAMES.noticeLink
  a.href = linkHref
  a.textContent = linkText
  notice.append(kindLabel, a)
  return notice
}

/** 远端目标的降级说明：静态文字 + 远端标注 + 路径纯文本（不可点——本机
 *  浏览器无该盘，file:/// 形态即伪装；规格 §2.3「说明与链接必须指向真实
 *  目标」的远端侧形态） */
function buildRemotePathNotice(kindLabel: string, remotePath: string): HTMLElement {
  const notice = document.createElement('div')
  notice.className = PDF_EXPORT_CLASS_NAMES.notice
  const mark = document.createElement('span')
  mark.className = PDF_EXPORT_CLASS_NAMES.noticeRemotePath
  mark.textContent = t('pdfExport.remoteMediaBadge')
  notice.append(kindLabel, mark, document.createTextNode(remotePath))
  return notice
}

/** 仅说明降级（无可表达真实目标：空 src / data: 等非路径非 http 形态） */
function buildLabelOnlyNotice(kindLabel: string): HTMLElement {
  const notice = document.createElement('div')
  notice.className = PDF_EXPORT_CLASS_NAMES.notice
  notice.textContent = kindLabel
  return notice
}

/** 本地 fsPath → file:/// 真实路径链接（Windows 盘符与 POSIX 均归一） */
export function fileLinkOf(fsPath: string): string {
  const normalized = fsPath.replaceAll('\\', '/')
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
}

// ---- 降级链接目标决策（双轴评审 P1/P2 的单一事实源） ----
//
// 消费方：块级 ![[媒体/PDF]] 嵌入（consumeEmbedHosts——目标恒为宿主解析的
// 绝对身份）与行内 video/audio/iframe（degradeMediaElements——src 可能是
// 文档相对路径，以所属文档身份词法解析）。规则不建第二份：
// - http(s)：原样真实链接（本地/远端一致）；
// - 绝对路径（POSIX `/`、Windows 盘符、`\\`）：本地 = file:/// 真实路径；
//   远端（remoteFs）= 远端标注纯文本，不产链接；
// - 文档相对路径：以所属文档目录词法解析为绝对目标后按上述分派（`..`
//   段归并；无文档身份则无可表达地址）；
// - 其余 scheme（data:/blob: 等）：无可表达真实地址，仅说明。

/** Windows 盘符绝对形态（`X:/`、`X:\`——裸 `X:` 是盘内相对怪语义，不算） */
const WINDOWS_DRIVE_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/
/** 一般 scheme 形态（http(s) 已先行分流；命中即非路径语义） */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export type PdfMediaNoticeTarget =
  | { kind: 'link'; href: string }
  | { kind: 'remote-path'; path: string }
  | { kind: 'none' }

/** 相对 src 以所属文档身份词法解析为绝对目标（`/` 分隔；`.`/`..` 段归并） */
export function resolveDocRelativePath(rel: string, docFsPath: string): string {
  const cut = docFsPath.lastIndexOf('/')
  const dir = cut > 0 ? docFsPath.slice(0, cut) : ''
  const absolute = dir.startsWith('/') || WINDOWS_DRIVE_ABSOLUTE_RE.test(dir)
  const out: string[] = []
  for (const part of `${dir === '' ? '' : `${dir}/`}${rel.replaceAll('\\', '/')}`.split('/')) {
    if (part === '') {
      if (out.length === 0 && dir.startsWith('/')) out.push('')
      continue
    }
    if (part === '.') continue
    if (part === '..') {
      // 绝对身份不向上逃出根（POSIX 前导空段 / 盘符段是根锚）；相对身份
      // 保留 .. 段（词法保真——无可定位基准时不编造）
      if (out.length > 0 && out[out.length - 1] !== '' && out[out.length - 1] !== '..' && !/^[a-zA-Z]:$/.test(out[out.length - 1]!)) {
        out.pop()
      } else if (!absolute) {
        out.push('..')
      }
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** 降级链接目标决策（单一事实源——见上方矩阵） */
export function mediaNoticeTargetOf(
  target: string,
  docFsPath: string | undefined,
  remoteFs: boolean,
): PdfMediaNoticeTarget {
  if (target === '') return { kind: 'none' }
  if (/^https?:\/\//i.test(target)) return { kind: 'link', href: target }
  const absolute = target.startsWith('/') || target.startsWith('\\') || WINDOWS_DRIVE_ABSOLUTE_RE.test(target)
  if (!absolute && URL_SCHEME_RE.test(target)) return { kind: 'none' }
  const resolved = absolute
    ? target
    : docFsPath !== undefined && docFsPath !== ''
      ? resolveDocRelativePath(target, docFsPath)
      : ''
  // 解析结果须为绝对身份（文档身份异常时词法结果可能仍相对——无可表达
  // 真实地址，不产伪 file 链接）
  if (resolved === '' || !(resolved.startsWith('/') || resolved.startsWith('\\') || WINDOWS_DRIVE_ABSOLUTE_RE.test(resolved))) {
    return { kind: 'none' }
  }
  return remoteFs
    ? { kind: 'remote-path', path: resolved }
    : { kind: 'link', href: fileLinkOf(resolved) }
}

/** 文档根归属谓词（嵌套根的子树归内层根——见 NESTED_DOC_ROOT_ATTR） */
function ownedBy(root: HTMLElement): (el: Element) => boolean {
  const nested = root.querySelector(`[${NESTED_DOC_ROOT_ATTR}]`) !== null
  if (!nested) {
    return () => true
  }
  return (el: Element): boolean => {
    let node: Element | null = el.parentElement
    while (node !== null && node !== root) {
      if (node.hasAttribute(NESTED_DOC_ROOT_ATTR)) {
        return false
      }
      node = node.parentElement
    }
    return true
  }
}

/** 图形容器预降级：导出页无附加组件渲染面，无内置渲染器的图形语言围栏
 *  在发起渲染前降级为源码呈现（否则容器停留 pending 使完成信号不收敛） */
function degradeUnsupportedGraphicContainers(root: ParentNode, owns?: (el: Element) => boolean): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${GRAPHIC_LANG_ATTR}]`))) {
    if (owns !== undefined && !owns(el)) {
      continue
    }
    const lang = (el.getAttribute(GRAPHIC_LANG_ATTR) ?? '').trim()
    if (graphicRendererFor(lang) !== undefined) {
      continue
    }
    const code = el.getAttribute(MERMAID_CODE_ATTR) ?? ''
    const pre = document.createElement('pre')
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    pre.appendChild(codeEl)
    el.replaceWith(pre)
  }
}

/** 媒体元素降级（video/audio/iframe → 静态说明 + 真实链接）：
 *  PDF 页面/视频帧/网页截图不进正文（规格 §2.3 硬边界）；目标经
 *  mediaNoticeTargetOf 单一事实源决策（http(s) 原样、本地路径 file:///、
 *  远端身份纯文本标注）。相对 src 先被 prepareHtmlResources 剥离——原文
 *  在 dataset.vsidianMediaSrc（memo），此处优先读 memo 再读属性/source 子
 *  元素（双轴评审 P2：不读 memo 会丢链接，读属性拼相对路径会产伪地址） */
function degradeMediaElements(root: ParentNode, docFsPath: string, remoteFs: boolean, owns?: (el: Element) => boolean): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('video, audio, iframe'))) {
    if (owns !== undefined && !owns(el)) {
      continue
    }
    const sourceEl = el.querySelector('source')
    const raw = el.getAttribute('src')
      ?? el.dataset['vsidianMediaSrc']
      ?? sourceEl?.getAttribute('src')
      ?? sourceEl?.dataset['vsidianMediaSrc']
      ?? ''
    const tag = el.tagName.toLowerCase()
    const label = t(`pdfExport.mediaNotice.${tag === 'iframe' ? 'iframe' : 'media'}`)
    const target = mediaNoticeTargetOf(raw, docFsPath, remoteFs)
    const notice = target.kind === 'link'
      ? buildMediaNotice(label, target.href, raw)
      : target.kind === 'remote-path'
        ? buildRemotePathNotice(label, target.path)
        : buildLabelOnlyNotice(label)
    el.replaceWith(notice)
  }
}

/** 装配入口：固定输入 payload → 导出正文 DOM（挂 appRoot；返回观测句柄）。
 *  幂等约束：单页面单次调用（导出页生命周期即装配生命周期）。 */
export function mountExportDocument(
  appRoot: HTMLElement,
  payload: PdfExportPagePayload,
  ports: PdfExportAssemblyPorts,
): PdfExportAssemblyHandle {
  const [main, ...restDocs] = payload.docs
  const failures: PdfExportFailureItem[] = []
  const embedByInner = new Map(payload.embeds.map((e) => [e.inner, e]))
  const mediaByInner = new Map(payload.mediaEmbeds.map((e) => [e.inner, e]))
  const failedInners = new Set(payload.embedFailures.map((e) => e.inner))
  const bindings: HtmlResourceBinding[] = []
  const docStyleBindings: DocumentStyleBinding[] = []

  // #423 宽松换行与阅读视图同值（切块渲染器单例全局生效）
  applyReadingRendererBreaks(payload.breaks)

  // htmlResourceHub 的 http 通道：sendRequest 出站 → fetch 回包 →
  // notifyHtmlResourceResult 路由（hub 的缓存/去重/失效语义原样）
  registerHtmlResourcePort({
    session: () => ({ sessionId: 'pdf-export', docUri: main.fsPath }),
    send: (message) => {
      if (message.kind !== 'htmlResource.request') return
      void ports.channel.send({
        reqId: message.reqId,
        url: message.url,
        ...(message.sourceDocUri !== undefined ? { sourceDocUri: message.sourceDocUri } : {}),
      }).then((res) => {
        notifyHtmlResourceResult({
          reqId: res.reqId,
          ok: res.ok,
          ...(res.url !== undefined ? { url: res.url } : {}),
          ...(res.reason !== undefined ? { reason: res.reason } : {}),
        })
      })
    },
  })

  // 图片管理器：按文档身份（A + 各 B）——解析端口带来源身份（同
  // refReadingContent.createSourcedImageManager 的身份模式；导出页一个
  // 文档一个 manager，attach/释放与槽位生命周期同构）
  const managers = new Map<string, ImageResourceManager>()
  const managerFor = (fsPath: string): ImageResourceManager => {
    let m = managers.get(fsPath)
    if (!m) {
      m = new ImageResourceManager({
        isDirectSrc: (src) => /^https?:\/\//i.test(src),
        requestHost: (src, reqId) => {
          void ports.images.resolve(src, fsPath).then((outcome) => {
            m!.handleResult({
              reqId,
              ok: outcome.ok,
              ...(outcome.ok ? { src: outcome.url } : { reason: outcome.reason }),
            })
          })
        },
      })
      managers.set(fsPath, m)
    }
    return m
  }

  const reading = document.createElement('div')
  reading.className = READING_CLASS_NAMES.view
  reading.dataset['vsidianMode'] = 'reading'

  /** 一个文本的块群装配（主文档全文/选区片段/合并分篇共用：文本 → 块群
   *  → 容器；混排嵌入提升对各形态同样生效——embeds 按 inner 命中即展开。
   *  docIndex（T06）：合并分篇的标题埋点挂篇序；单文档缺省不挂） */
  const mountTextBlocks = (text: string, scope: string, container: HTMLElement, expandEmbeds: boolean, docIndex?: number): void => {
    const blocks = splitReadingBlocks(text)
    for (const block of blocks) {
      const el = createReadingBlockElement(block, text, scope)
      annotateHeadingMark(el, block.kind, block.kind === 'heading' ? block.level : undefined, docIndex)
      container.appendChild(el)
      // 混排嵌入提升（#246 与阅读同源：占位 → 块级宿主，data 通道统一）
      if (expandEmbeds && block.kind !== 'embed') {
        promoteEmbedSlotsInBlock(el, text, block.start, block.end, block.references)
      }
    }
  }

  /** 嵌入消费（块级 embed 块 + 混排提升宿主统一按 data-vsidian-embed-inner；
   *  T06 合并分篇按篇传入各自的嵌入面——嵌入解析以来源文档为基准，不跨
   *  篇混配；docIndex 在场时展开容器内的标题埋点补挂宿主篇序。远端身份
   *  （remoteFs）只作用于非 Markdown 嵌入的降级链接形态——见
   *  mediaNoticeTargetOf） */
  const consumeEmbedHosts = (
    root: HTMLElement,
    embedByInner: Map<string, PdfExportEmbedEntry>,
    mediaByInner: Map<string, PdfExportMediaEmbedEntry>,
    failedInners: ReadonlySet<string>,
    embedFailures: ReadonlyArray<{ inner: string; reason: string }>,
    docIndex: number | undefined,
    remoteFs: boolean,
  ): void => {
    for (const host of Array.from(root.querySelectorAll<HTMLElement>('[data-vsidian-embed-inner]'))) {
      const inner = host.dataset['vsidianEmbedInner'] ?? ''
      const embed = embedByInner.get(inner)
      if (embed !== undefined) {
        const expanded = buildExpandedEmbed(embed)
        host.replaceWith(expanded)
        if (docIndex !== undefined) {
          for (const heading of Array.from(expanded.querySelectorAll<HTMLElement>(`[${PDF_EXPORT_HEADING_LEVEL_ATTR}]`))) {
            heading.setAttribute(PDF_EXPORT_HEADING_DOC_ATTR, String(docIndex))
          }
        }
        continue
      }
      const media = mediaByInner.get(inner)
      if (media !== undefined) {
        const label = t(`pdfExport.mediaNotice.${media.kind === 'pdf' ? 'pdf' : media.kind === 'web' ? 'web' : 'media'}`)
        // 嵌入身份目标的链接决策与行内媒体同一事实源（mediaNoticeTargetOf）：
        // web = 远端 URL 真实链接；pdf/media = 宿主解析的绝对 fsPath——本地
        // 产 file:/// 真实路径，远端纯文本标注（不伪装本机地址）
        const target = media.kind === 'web'
          ? (media.url !== undefined && media.url !== '' ? { kind: 'link' as const, href: media.url } : { kind: 'none' as const })
          : media.fsPath !== undefined ? mediaNoticeTargetOf(media.fsPath, undefined, remoteFs) : { kind: 'none' as const }
        const notice = target.kind === 'link'
          ? buildMediaNotice(label, target.href, media.kind === 'web' ? media.url ?? inner : media.fsPath ?? inner)
          : target.kind === 'remote-path'
            ? buildRemotePathNotice(label, target.path)
            : buildLabelOnlyNotice(label)
        host.replaceWith(notice)
        continue
      }
      if (failedInners.has(inner)) {
        const reason = embedFailures.find((f) => f.inner === inner)?.reason ?? 'not-found'
        const notice = document.createElement('div')
        notice.className = PDF_EXPORT_CLASS_NAMES.notice
        notice.textContent = t('pdfExport.embedFailedNotice', { target: inner })
        host.replaceWith(notice)
        failures.push({ kind: 'embed', item: inner, reason })
        continue
      }
      // 超集未命中（枚举形态差异）：保留占位引用行（阅读混排边界同形，不冒充失败）
    }
  }

  const mainScope = docScopeKeyOf(main.fsPath)
  const remoteFs = payload.remoteFs === true
  if (payload.merge !== undefined) {
    // T06（#626）合并分篇挂载：每篇一个分篇容器（docScope/资源身份按篇
    //  隔离——样式与相对资源不跨篇污染）；pageBreak 时非首篇另起一页
    //  （break-before: page 由 mergeBreak 类承载，pdfExportPage.css 钉住）
    const { docs: mergeDocs, pageBreak } = payload.merge
    mergeDocs.forEach((entry, index) => {
      const scope = docScopeKeyOf(entry.doc.fsPath)
      const section = document.createElement('div')
      section.className = PDF_EXPORT_CLASS_NAMES.mergeDoc
        + (pageBreak && index > 0 ? ` ${PDF_EXPORT_CLASS_NAMES.mergeBreak}` : '')
      section.dataset['vsidianDocScope'] = scope
      section.setAttribute(MERGE_SECTION_FS_ATTR, entry.doc.fsPath)
      section.setAttribute(MERGE_SECTION_INDEX_ATTR, String(index))
      reading.appendChild(section)
      mountTextBlocks(entry.doc.text, scope, section, true, index)
      consumeEmbedHosts(
        section,
        new Map(entry.embeds.map((e) => [e.inner, e])),
        new Map(entry.mediaEmbeds.map((e) => [e.inner, e])),
        new Set(entry.embedFailures.map((e) => e.inner)),
        entry.embedFailures,
        index,
        remoteFs,
      )
    })
  } else if (payload.fragments !== undefined) {
    // T03（#623）选区导出：片段在场时以片段序列替代 docs[0] 全文挂载——每片段独立
    // 解析（splitReadingBlocks 对片段文本直接可用，半段语法真实降级）、按文档
    // 顺序组合到同一 reading 容器；片段间不拼接成新语法（独立解析保证
    // ——相邻列表/表格/围栏片段是各自的块群，不会互认成同一结构）。资源
    // 身份与 docScope 仍用主文档 fsPath（图片/嵌入/文档样式同源）。空片段
    // 数组 = 零正文挂载（不回落全文——选区导出不误触发全文导出）
    for (const fragment of payload.fragments) {
      mountTextBlocks(fragment.text, mainScope, reading, true)
    }
  } else {
    mountTextBlocks(main.text, mainScope, reading, true)
  }

  // 嵌入消费：单文档/选区路径在整个 reading 上消费（合并路径已在分篇
  // 容器内按篇消费完毕——此处不再全局扫描，避免跨篇 inner 混配）
  if (payload.merge === undefined) {
    consumeEmbedHosts(
      reading,
      embedByInner,
      mediaByInner,
      failedInners,
      payload.embedFailures,
      undefined,
      remoteFs,
    )
  }

  // 每个文档的图片 + HTML 资源 + 图形渲染（A 与各 B 同管线；B 的资源以
  // B 身份解析——prepareHtmlResources 的 sourceDocUri 与 manager 身份一致；
  // 展开容器的 fsPath 经装配期身份标记回查；T06 合并：分篇容器是第一层
  // 文档根——篇内图片/资源以该篇身份解析，嵌套展开容器回查自身身份）
  const sectionRoots = payload.merge !== undefined
    ? Array.from(reading.querySelectorAll<HTMLElement>(`[${MERGE_SECTION_FS_ATTR}]`))
      .map((el) => ({ fsPath: el.getAttribute(MERGE_SECTION_FS_ATTR) ?? '', root: el }))
      .filter((entry) => entry.fsPath !== '')
    : [{ fsPath: main.fsPath, root: reading }]
  const docRoots: Array<{ fsPath: string; root: HTMLElement }> = [
    ...sectionRoots,
    ...Array.from(reading.querySelectorAll<HTMLElement>(`[${EMBED_FS_PATH_ATTR}]`))
      .map((el) => ({ fsPath: el.getAttribute(EMBED_FS_PATH_ATTR) ?? '', root: el }))
      .filter((entry) => entry.fsPath !== ''),
  ]

  for (const { fsPath, root } of docRoots) {
    const owns = ownedBy(root)
    prepareReadingImages(root, managerFor(fsPath), owns)
    bindings.push(prepareHtmlResources(root, {
      images: managerFor(fsPath),
      sourceDocUri: fsPath,
      docScope: docScopeKeyOf(fsPath),
    }))
    degradeUnsupportedGraphicContainers(root, owns)
    renderMermaidIn(root, owns)
    renderGraphicBlockInto(root, owns)
    degradeMediaElements(root, fsPath, remoteFs, owns)
  }

  // 文档样式：A 与各 B 的 docScope 独立装载（合并不跨篇污染的隔离基础）
  for (const doc of [main, ...restDocs]) {
    const binding = new DocumentStyleBinding(docScopeKeyOf(doc.fsPath), hubResourcePort(doc.fsPath))
    binding.sync(doc.text)
    docStyleBindings.push(binding)
  }

  // #659（T08）callout 图标注入：--callout-icon 被片段/文档样式设置时按
  // T06 同一决策面注入 SVG（默认类型表走 CSS mask 通道不需 JS——PDF 页
  // 样式快照携带同样的类型表变量，两通道与阅读同源；样式快照在 head，
  // 计算值读取时序天然就绪）。装配是一次性同步全量，此处一次扫描即可；
  // 须在容器进 DOM 后（computed 值读取要求元素在文档树内级联可达）。
  appRoot.appendChild(reading)
  mountCalloutIcons(reading)

  const allImageSlots = (): HTMLImageElement[] =>
    Array.from(reading.querySelectorAll<HTMLImageElement>(`img[${IMG_STATE_ATTR}]`))

  return {
    failures,
    readiness: () => ({
      assembled: true,
      images: allImageSlots().every((img) => {
        const state = img.dataset['vsidianImgState']
        if (state === 'error') return true // 终态（失败面登记）
        if (state !== 'loaded') return false
        return img.complete && img.naturalWidth > 0
      }),
      graphics: Array.from(reading.querySelectorAll<HTMLElement>(`[${MERMAID_CODE_ATTR}]`))
        .every((el) => {
          const state = el.getAttribute(MERMAID_STATE_ATTR)
          return state !== 'pending' && state !== 'rendering'
        }),
    }),
    imageFailures: () => allImageSlots()
      .filter((img) => img.dataset['vsidianImgState'] === 'error')
      .map((img) => ({
        kind: 'image' as const,
        item: img.dataset['vsidianImgSrc'] ?? img.alt ?? '',
        reason: img.dataset['vsidianImgReason'] ?? 'load-failed',
      })),
    /** 图形渲染失败清单（终态后提取——error 态容器：语法错误/装载失败；
     *  阅读里的可见错误说明在导出语义下进失败面，由用户选择继续或取消） */
    graphicFailures: () => Array.from(reading.querySelectorAll<HTMLElement>(`[${MERMAID_CODE_ATTR}]`))
      .filter((el) => el.getAttribute(MERMAID_STATE_ATTR) === 'error')
      .map((el) => ({
        kind: 'graphic' as const,
        item: el.getAttribute(GRAPHIC_LANG_ATTR) ?? 'mermaid',
        reason: 'render-failed',
      })),
    dispose: () => {
      for (const b of bindings) b.dispose()
      for (const b of docStyleBindings) b.dispose()
      for (const m of managers.values()) m.detachWithin(reading)
    },
  }
}

/** 完成信号整体求值（宿主轮询读 window.__vsidianPdfExport 的形态）：
 *  failures 合并装配期（嵌入/媒体）与图片/图形终态失败。 */
export function evaluateExportReadiness(handle: PdfExportAssemblyHandle): {
  assembled: boolean
  images: boolean
  graphics: boolean
  fonts: string
  asyncReady: boolean
  failures: PdfExportFailureItem[]
} {
  const state = handle.readiness()
  const failures = [...handle.failures, ...handle.imageFailures(), ...handle.graphicFailures()]
  return {
    ...state,
    fonts: typeof document !== 'undefined' && document.fonts ? document.fonts.status : 'loaded',
    asyncReady: state.assembled && state.images && state.graphics,
    failures,
  }
}
