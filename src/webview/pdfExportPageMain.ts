// PDF 导出页入口（T02/#622）：Chrome 导出页的装载与观测面。
//
// 页面职责：读骨架页注入的固定输入 payload → 复用 webview Reading 管线
// 装配正文（pdfExportAssembly）→ 暴露完成信号谓词（宿主 CDP 轮询读取）。
// 样式复用：main.css（阅读样式与 #app 变量族）+ katex.min.css（公式字体）
// + pdfExportPage.css（导出限定观感——嵌入展开/降级说明）。
//
// 资源通道（http 同源）：
// - 图片：先探后装（/res 探测分态 not-found/inaccessible/blocked，成功把
//   同 URL 交给 ImageResourceManager 应用——本机回环双请求成本可忽略，
//   分态语义保留）；
// - htmlResource.request：POST /resource（reqId 路由），回包经
//   notifyHtmlResourceResult 进 hub。
import './main.css'
import 'katex/dist/katex.min.css'
import './pdfExportPage.css'
import { bootLocaleFromDocument } from './localeBoot'
import { setMermaidDarkTheme } from './mermaidRender'
import { evaluateExportReadiness, mountExportDocument, type PdfExportAssemblyHandle } from './pdfExportAssembly'
import type { PdfExportPagePayload, PdfExportReadyState } from '../shared/pdfExportPayload'

interface PdfExportWindow {
  __vsidianPdfExportInput?: PdfExportPagePayload
  __vsidianPdfExportReadiness?: () => PdfExportReadyState
  /** mermaid 懒加载产物地址（mermaidRender.mermaidUri 的全局约定——与编辑
   *  webview 的 nonce 内联注入同机制，此处由导出页入口自 payload 装配） */
  __vsidianMermaidUri?: string
}

function boot(): void {
  const g = globalThis as unknown as PdfExportWindow
  const payload = g.__vsidianPdfExportInput
  const appRoot = document.getElementById('app')
  if (!payload || !appRoot) {
    // 骨架异常：直接置空就绪位（宿主谓词按 not-ready 超时如报）
    g.__vsidianPdfExportReadiness = () => ({
      assembled: false, images: false, graphics: false, fonts: 'loaded',
      asyncReady: false, failures: [],
    })
    return
  }
  bootLocaleFromDocument()
  setMermaidDarkTheme(payload.style.dark)
  g.__vsidianMermaidUri = payload.mermaidUri
  const resUrl = (src: string, sourceFsPath: string | undefined): string => {
    const q = new URLSearchParams({ src })
    if (sourceFsPath !== undefined && sourceFsPath !== '') q.set('doc', sourceFsPath)
    return `${payload.resBase}?${q.toString()}`
  }
  let handle: PdfExportAssemblyHandle | undefined
  handle = mountExportDocument(appRoot, payload, {
    images: {
      resolve: async (src, sourceFsPath) => {
        try {
          const probe = await fetch(resUrl(src, sourceFsPath), { method: 'GET' })
          if (!probe.ok) {
            const body = await probe.json().catch(() => null) as { reason?: string } | null
            return { ok: false, reason: body?.reason ?? 'load-failed' }
          }
          probe.body?.cancel().catch(() => undefined)
          return { ok: true, url: resUrl(src, sourceFsPath) }
        } catch {
          return { ok: false, reason: 'inaccessible' }
        }
      },
    },
    channel: {
      send: async (message) => {
        const base = payload.resBase.slice(0, payload.resBase.lastIndexOf('/'))
        try {
          const res = await fetch(`${base}/resource`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message),
          })
          return await res.json() as { reqId: number; ok: boolean; url?: string; reason?: string }
        } catch {
          return { reqId: message.reqId, ok: false, reason: 'inaccessible' }
        }
      },
    },
  })
  g.__vsidianPdfExportReadiness = () => evaluateExportReadiness(handle!)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot())
} else {
  boot()
}
