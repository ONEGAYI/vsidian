// PDF 导出模态（T01/#621）：createWebviewPanel 装配的宿主级 webview 面板
//（照 settingsPage.ts 的成熟链路：randomUUID nonce、CSP、asWebviewUri 产物
// 地址、单例 reveal；retainContextWhenHidden 不开——隐藏即释放，重开经
// pdfExportModal.get 重新拉取权威状态回显）。
//
// 固定输入（规格 §2.1）：open 时经 source.session.whenEditsSettled() 等待
// 在途 edit.request 落地，随后读权威 TextDocument 全文与版本——此后任务
// 只消费该字符串快照，生成期间的后续编辑不混入；不强制保存、不新增撤销
// 记录、源文 dirty 状态不受影响（读取路径零写入）。阅读样式快照 T01 只记
// 骨架（主题 kind），完整样式面归 T02。
//
// 持久默认参数与浏览器路径只在 Vsidian 设置页（每次 open / run 实时读快照
// ——设置页改完重开模态即生效）。测试钩子（VSIDIAN_TEST_HOOKS=1）：
// showSaveDialog 短路为临时目录自动路径（真实落盘可断言），装配 HTML 与
// 绘制层探针经 _test.getPdfExportModalState 命令暴露（extension.ts 注册）。

import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isWebviewToHost } from '../../shared/protocol'
import { t } from '../../shared/i18n'
import { LOCALE_MESSAGES, type LocaleCode } from '../../shared/locales'
import { buildLocaleIslandHtml } from '../../shared/locales/island'
import { hostLocale } from '../hostLocale'
import {
  normalizePdfExportOptions,
  PDF_EXPORT_OPTIONS_DEFAULTS,
  type PdfExportOptions,
} from '../../shared/pdfExportOptions'
import {
  PDF_EXPORT_BROWSER_PATH_KEY,
  PDF_EXPORT_MARGIN_KEY,
  PDF_EXPORT_ORIENTATION_KEY,
  PDF_EXPORT_PAPER_KEY,
  PDF_EXPORT_SCALE_KEY,
  type SettingsPayload,
} from '../../shared/settings'
import { PdfExportJob, type PdfExportInput, type PdfExportJobState } from './pdfExportJob'
import { createBrowserExportSession } from './pdfExportSession'
import { resolveExportBrowser } from './browserFind'
import type { DocumentSession } from '../documentSession'

/** 模态 viewType（createWebviewPanel 无需清单声明） */
export const PDF_EXPORT_VIEW_TYPE = 'onegayi.vsidian.pdfExport'

/** 固定输入源（provider.getActivePdfExportSource 的返回形态） */
export interface PdfExportDocumentSource {
  uri: vscode.Uri
  document: vscode.TextDocument
  session: DocumentSession
}

/** 模态观测信息（_test 钩子与集成断言用） */
export interface PdfExportModalInfo {
  open: boolean
  phase: PdfExportJobState['phase']
  generation: number
  docName: string
  capturedVersion: number
  savedPath: string | undefined
  failReason: string | undefined
  /** 失败的原始错误信息（诊断观测面） */
  failDetail: string | undefined
  /** 最近一次装配 HTML（测试钩子断言固定输入渲染面） */
  lastHtml: string | undefined
  /** 模态 webview 最近上报的绘制层探针（控件可见性与计算样式摘要） */
  lastPaint: unknown
  /** 钩子模式下 showSaveDialog 短路的自动目标路径 */
  hookedSaveTarget: string | undefined
}

export interface PdfExportModalHandle {
  /** 打开（或 reveal 已有面板并刷新固定输入——重新执行命令 = 新一轮输入） */
  open(source: PdfExportDocumentSource): void
  close(): void
  isOpen(): boolean
  getInfo(): PdfExportModalInfo
  /** 经正式处理入口注入模态 webview → 宿主消息（测试钩子通道） */
  injectMessage(message: unknown): void
}

/** 从设置快照读取本次默认参数与浏览器路径（实时快照——设置页修改即时生效） */
function defaultsFromSettings(snapshot: SettingsPayload): { defaults: PdfExportOptions; browserPath: string } {
  return {
    defaults: normalizePdfExportOptions({
      paper: snapshot[PDF_EXPORT_PAPER_KEY],
      orientation: snapshot[PDF_EXPORT_ORIENTATION_KEY],
      marginMm: typeof snapshot[PDF_EXPORT_MARGIN_KEY] === 'number' ? snapshot[PDF_EXPORT_MARGIN_KEY] as number : undefined,
      scale: typeof snapshot[PDF_EXPORT_SCALE_KEY] === 'number' ? snapshot[PDF_EXPORT_SCALE_KEY] as number : undefined,
    }, PDF_EXPORT_OPTIONS_DEFAULTS),
    browserPath: typeof snapshot[PDF_EXPORT_BROWSER_PATH_KEY] === 'string'
      ? snapshot[PDF_EXPORT_BROWSER_PATH_KEY] as string
      : '',
  }
}

export function createPdfExportModal(
  context: vscode.ExtensionContext,
  getSettingsSnapshot: () => SettingsPayload,
  openSettingsCallback: () => void,
): PdfExportModalHandle {
  let panel: vscode.WebviewPanel | undefined
  /** 当前固定输入（open 时捕获；新一轮命令重新捕获） */
  let fixedInput: PdfExportInput | undefined
  let sourceDirForDialog: vscode.Uri | undefined
  let lastHtml: string | undefined
  let lastPaint: unknown
  let hookedSaveTarget: string | undefined

  const job = new PdfExportJob({
    resolveBrowser: (configuredPath) => resolveExportBrowser(configuredPath),
    createSession: (executablePath) => createBrowserExportSession(executablePath),
    showSaveDialog: async (defaultFileName) => {
      if (process.env.VSIDIAN_TEST_HOOKS === '1') {
        // 测试钩子短路：自动目标路径（临时目录 + 文档名），真实落盘可断言；
        // 目标路径经 getInfo().hookedSaveTarget 暴露
        const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-test-'))
        hookedSaveTarget = path.join(dir, defaultFileName)
        return hookedSaveTarget
      }
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(sourceDirForDialog ?? vscode.Uri.file(tmpdir()), defaultFileName),
        filters: { 'PDF': ['pdf'] },
      })
      return target?.fsPath
    },
    writeFile: async (targetPath, bytes) => {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(bytes))
    },
    onHtmlAssembled: (html) => {
      lastHtml = html
    },
  })

  const info = (): PdfExportModalInfo => ({
    open: panel !== undefined,
    phase: job.state.phase,
    generation: job.state.generation,
    docName: fixedInput?.docName ?? '',
    capturedVersion: fixedInput?.capturedVersion ?? 0,
    savedPath: job.state.savedPath,
    failReason: job.state.failReason,
    failDetail: job.state.failDetail,
    lastHtml,
    lastPaint,
    hookedSaveTarget,
  })

  const notifyState = (): void => {
    if (!panel) return
    const { defaults, browserPath } = defaultsFromSettings(getSettingsSnapshot())
    void panel.webview.postMessage({
      kind: 'pdfExportModal.state',
      phase: job.state.phase,
      generation: job.state.generation,
      docName: fixedInput?.docName ?? '',
      capturedVersion: fixedInput?.capturedVersion ?? 0,
      defaults,
      browserPath,
      ...(job.state.savedPath !== undefined ? { savedPath: job.state.savedPath } : {}),
      ...(job.state.failReason !== undefined ? { failReason: job.state.failReason } : {}),
      ...(job.state.failDetail !== undefined ? { failDetail: job.state.failDetail } : {}),
      ...(job.state.cancelKind !== undefined ? { cancelKind: job.state.cancelKind } : {}),
    })
  }
  job.onStateChange = () => notifyState()

  /** 固定输入捕获：在途编辑落地后读权威全文（此后任务只消费该快照） */
  const captureInput = (source: PdfExportDocumentSource): Promise<PdfExportInput> =>
    source.session.whenEditsSettled().then(() => ({
      docName: path.basename(source.uri.fsPath || 'document.md'),
      markdown: source.document.getText(),
      capturedVersion: source.document.version,
      // T01 骨架：主题 kind 记录在案（T02 接完整阅读样式面）
      readingStyleSnapshot: {
        colorThemeKind: vscode.window.activeColorTheme.kind,
      },
    }))

  const handleMessage = (message: unknown): void => {
    if (!isWebviewToHost(message)) return
    switch (message.kind) {
      case 'pdfExportModal.get':
        notifyState()
        return
      case 'pdfExportModal.run': {
        if (!fixedInput) return
        lastHtml = undefined
        hookedSaveTarget = undefined
        const { defaults, browserPath } = defaultsFromSettings(getSettingsSnapshot())
        const params = normalizePdfExportOptions(message.params, defaults)
        void job.run(fixedInput, params, browserPath.trim() || undefined).then((result) => {
          if (result.kind === 'done') {
            void vscode.window.showInformationMessage(t('pdfExport.savedTo', { path: result.state.savedPath ?? '' }))
          }
        })
        return
      }
      case 'pdfExportModal.cancel':
        job.cancel()
        return
      case 'settings.open':
        openSettingsCallback()
        return
      case '_test.pdfExportModal.report':
        lastPaint = message.paint
        return
      default:
        return // 模态不会发出其余消息，忽略
    }
  }

  const open = (source: PdfExportDocumentSource): void => {
    sourceDirForDialog = source.uri.scheme === 'file'
      ? vscode.Uri.file(path.dirname(source.uri.fsPath))
      : vscode.workspace.workspaceFolders?.[0]?.uri
    // 固定输入捕获（异步）：面板装载握手（get）早于捕获完成时以空输入态
    // 应答，捕获完成由 then 补推对齐（新一轮输入就位）
    void captureInput(source).then((input) => {
      fixedInput = input
      notifyState()
    })
    if (panel) {
      panel.reveal()
      return
    }
    const created = vscode.window.createWebviewPanel(
      PDF_EXPORT_VIEW_TYPE,
      t('pdfExport.modalTitle'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
      },
    )
    panel = created
    created.webview.html = buildPdfExportModalHtml(
      created.webview,
      context.extensionUri,
      hostLocale(getSettingsSnapshot()),
    )
    const messageSub = created.webview.onDidReceiveMessage(handleMessage)
    created.onDidDispose(() => {
      messageSub.dispose()
      panel = undefined
      // 关闭模态：取消在途任务并释放（规格 §2.5 配对释放；未完成产物不落盘）
      job.dispose()
      lastPaint = undefined
    })
  }

  return {
    open,
    close: () => {
      panel?.dispose()
    },
    isOpen: () => panel !== undefined,
    getInfo: info,
    injectMessage: handleMessage,
  }
}

/** 模态 HTML：CSP 与产物地址装配（settingsPage 同模式）；测试钩子标志经
 *  nonce 内联注入（webview 侧仅在该标志下发送 _test.* 绘制层探针——宿主
 *  侧门控的被动接收形态，与编辑器面板 _test 钩子同约定） */
function buildPdfExportModalHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  locale: LocaleCode,
): string {
  const nonce = randomUUID()
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfExport.js'),
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfExport.css'),
  )
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource}`,
  ].join('; ')
  const testHooksFlag = process.env.VSIDIAN_TEST_HOOKS === '1' ? 'window.__vsidianTestHooks = true;' : ''
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>${t('pdfExport.modalTitle')}</title>
</head>
<body>
<div id="app"></div>
${buildLocaleIslandHtml(locale, LOCALE_MESSAGES[locale])}
<script nonce="${nonce}">${testHooksFlag}</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
