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
// - 非 Markdown 嵌入（payload.mediaEmbeds）降级为静态说明 + 真实链接
//   （本地 file:/// 真实路径、远端原 URL——不伪装本机路径）。
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
import { prepareHtmlResources, type HtmlResourceBinding } from './htmlResourceMount'
import { DocumentStyleBinding } from './docStyleLoader'
import { docScopeKeyOf } from '../shared/docStyle'
import { promoteEmbedSlotsInBlock } from './embedSlots'
import { renderGraphicBlockInto } from './graphicRenderers'
import { renderMermaidIn } from './mermaidRender'
import { GRAPHIC_LANG_ATTR, MERMAID_CODE_ATTR, MERMAID_STATE_ATTR } from '../shared/mermaid'
import { graphicRendererFor } from './graphicRenderers'
import { t } from '../shared/i18n'
import type {
  PdfExportFailureItem,
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
} as const

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

/** 嵌入展开：B 全文的块群 + 来源标识行（B 的 docScope；一层边界——B 内
 *  embed 块保留占位引用行，不再展开） */
function buildExpandedEmbed(doc: PdfExportPagePayload['docs'][number]): HTMLElement {
  const scope = docScopeKeyOf(doc.fsPath)
  const box = document.createElement('div')
  box.className = `${READING_CLASS_NAMES.embedBlock} ${PDF_EXPORT_CLASS_NAMES.embedExpanded}`
  box.dataset['vsidianDocScope'] = scope
  box.setAttribute(EMBED_FS_PATH_ATTR, doc.fsPath)
  const label = document.createElement('div')
  label.className = PDF_EXPORT_CLASS_NAMES.embedSourceLabel
  label.textContent = doc.docName
  box.appendChild(label)
  for (const block of splitReadingBlocks(doc.text)) {
    box.appendChild(createReadingBlockElement(block, doc.text, scope))
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

/** 本地 fsPath → file:/// 真实路径链接（Windows 盘符与 POSIX 均归一） */
export function fileLinkOf(fsPath: string): string {
  const normalized = fsPath.replaceAll('\\', '/')
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
}

/** 图形容器预降级：导出页无附加组件渲染面，无内置渲染器的图形语言围栏
 *  在发起渲染前降级为源码呈现（否则容器停留 pending 使完成信号不收敛） */
function degradeUnsupportedGraphicContainers(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${GRAPHIC_LANG_ATTR}]`))) {
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
 *  PDF 页面/视频帧/网页截图不进正文（规格 §2.3 硬边界）；src 保留真实
 *  目标（http(s) 原样、本地路径解析为 file:///） */
function degradeMediaElements(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('video, audio, iframe'))) {
    const raw = el.getAttribute('src')
      ?? el.querySelector('source')?.getAttribute('src')
      ?? ''
    const tag = el.tagName.toLowerCase()
    const label = t(`pdfExport.mediaNotice.${tag === 'iframe' ? 'iframe' : 'media'}`)
    let href = ''
    let linkText = raw
    if (/^https?:\/\//i.test(raw)) {
      href = raw
    } else if (raw !== '') {
      href = fileLinkOf(raw)
      linkText = raw
    }
    const notice = href === ''
      ? (() => {
        const n = document.createElement('div')
        n.className = PDF_EXPORT_CLASS_NAMES.notice
        n.textContent = label
        return n
      })()
      : buildMediaNotice(label, href, linkText)
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

  /** 一个文档的块群装配（主文档挂 reading；嵌入目标挂展开容器） */
  const mountBlocks = (doc: PdfExportPagePayload['docs'][number], container: HTMLElement, expandEmbeds: boolean): void => {
    const scope = docScopeKeyOf(doc.fsPath)
    const blocks = splitReadingBlocks(doc.text)
    for (const block of blocks) {
      const el = createReadingBlockElement(block, doc.text, scope)
      container.appendChild(el)
      // 混排嵌入提升（#246 与阅读同源：占位 → 块级宿主，data 通道统一）
      if (expandEmbeds && block.kind !== 'embed') {
        promoteEmbedSlotsInBlock(el, doc.text, block.start, block.end, block.references)
      }
    }
  }

  mountBlocks(main, reading, true)

  // 嵌入消费：块级 embed 块 + 混排提升宿主统一按 data-vsidian-embed-inner
  for (const host of Array.from(reading.querySelectorAll<HTMLElement>('[data-vsidian-embed-inner]'))) {
    const inner = host.dataset['vsidianEmbedInner'] ?? ''
    const embed = embedByInner.get(inner)
    if (embed !== undefined) {
      host.replaceWith(buildExpandedEmbed(embed))
      continue
    }
    const media = mediaByInner.get(inner)
    if (media !== undefined) {
      const label = t(`pdfExport.mediaNotice.${media.kind === 'pdf' ? 'pdf' : media.kind === 'web' ? 'web' : 'media'}`)
      const target = media.kind === 'web'
        ? media.url ?? ''
        : media.fsPath !== undefined ? fileLinkOf(media.fsPath) : ''
      const linkText = media.kind === 'web' ? media.url ?? inner : media.fsPath ?? inner
      const notice = target === ''
        ? (() => {
          const n = document.createElement('div')
          n.className = PDF_EXPORT_CLASS_NAMES.notice
          n.textContent = label
          return n
        })()
        : buildMediaNotice(label, target, linkText)
      host.replaceWith(notice)
      continue
    }
    if (failedInners.has(inner)) {
      const reason = payload.embedFailures.find((f) => f.inner === inner)?.reason ?? 'not-found'
      const notice = document.createElement('div')
      notice.className = PDF_EXPORT_CLASS_NAMES.notice
      notice.textContent = t('pdfExport.embedFailedNotice', { target: inner })
      host.replaceWith(notice)
      failures.push({ kind: 'embed', item: inner, reason })
      continue
    }
    // 超集未命中（枚举形态差异）：保留占位引用行（阅读混排边界同形，不冒充失败）
  }

  // 每个文档的图片 + HTML 资源 + 图形渲染（A 与各 B 同管线；B 的资源以
  // B 身份解析——prepareHtmlResources 的 sourceDocUri 与 manager 身份一致；
  // 展开容器的 fsPath 经装配期身份标记回查）
  const docRoots: Array<{ fsPath: string; root: HTMLElement }> = [
    { fsPath: main.fsPath, root: reading },
    ...Array.from(reading.querySelectorAll<HTMLElement>(`[${EMBED_FS_PATH_ATTR}]`))
      .map((el) => ({ fsPath: el.getAttribute(EMBED_FS_PATH_ATTR) ?? '', root: el }))
      .filter((entry) => entry.fsPath !== ''),
  ]

  for (const { fsPath, root } of docRoots) {
    prepareReadingImages(root, managerFor(fsPath))
    bindings.push(prepareHtmlResources(root, {
      images: managerFor(fsPath),
      sourceDocUri: fsPath,
      docScope: docScopeKeyOf(fsPath),
    }))
    degradeUnsupportedGraphicContainers(root)
    renderMermaidIn(root)
    renderGraphicBlockInto(root)
    degradeMediaElements(root)
  }

  // 文档样式：A 与各 B 的 docScope 独立装载（合并不跨篇污染的隔离基础）
  for (const doc of [main, ...restDocs]) {
    const binding = new DocumentStyleBinding(docScopeKeyOf(doc.fsPath), hubResourcePort(doc.fsPath))
    binding.sync(doc.text)
    docStyleBindings.push(binding)
  }

  appRoot.appendChild(reading)

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
