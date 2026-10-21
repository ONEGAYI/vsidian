// PDF 导出模态 webview 启动入口（T01/#621）：装配 acquireVsCodeApi 与
// 模态视图（settingsMain 同模式——装载即拉取权威状态，面板隐藏即释放、
// 重开重载，回显以宿主权威值为准）。语言包首帧从数据岛装配，locale.changed
// 换包后视图重渲染常驻文本。
import { PdfExportModalView } from './pdfExportModalView'
import { bootLocaleFromDocument, handleLocaleChangedMessage } from './localeBoot'
import { installTooltipCard } from './tooltipCard'
import { isHostToWebview } from '../shared/protocol'
import './pdfExportModal.css'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
}

bootLocaleFromDocument()

// #300 统一自绘悬停提示（T04 起模态携带 data-tooltip 承载的提示——设置页
// 同款装配，document 级委托监听）
installTooltipCard()

const vscode = acquireVsCodeApi()
const view = new PdfExportModalView({
  postMessage: (message) => vscode.postMessage(message),
})
view.mount(document.getElementById('app') ?? document.body)
vscode.postMessage({ kind: 'pdfExportModal.get' })

window.addEventListener('message', (event) => {
  if (isHostToWebview(event.data)) {
    if (event.data.kind === 'pdfExportModal.state') {
      view.applyState(event.data)
    } else if (event.data.kind === 'pdfExportModal.previewArtifact') {
      // T07（#627）预览产物字节（base64——webview 转 Blob URL 交 PdfHoverView；
      // 代次配对在视图内完成，迟到/旧会话产物丢弃）
      const data = event.data as { generation: unknown; base64: unknown }
      if (typeof data.generation === 'number' && typeof data.base64 === 'string') {
        view.applyPreviewArtifact(data.generation, data.base64)
      }
    } else if (event.data.kind === 'pdfExportModal._test.setParam') {
      // 宿主 _test 转发（VSIDIAN_TEST_HOOKS 门控链路——视图内再校验标志）
      view.applyTestSetParam(event.data as { field?: unknown; value?: unknown })
    }
  }
  handleLocaleChangedMessage(event.data)
  view.handleLocaleChanged(event.data)
})
