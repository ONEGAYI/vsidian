// #334（P3-02）PDF 探针宿主侧套件：在 VSCode 1.82.3 真实宿主内运行。
// - 自建 WebviewPanel（enableScripts），HTML 与生产 textEditorProvider 同型
//   （nonce + meta CSP + asWebviewUri 脚本），CSP 用生产 buildEditorCsp 纯逻辑
//   装配，按变体追加候选新增指令；
// - 变体 A（生产 CSP 原样）验证 blob worker 被拒（证明 worker-src 新增必要）；
// - 变体 B（+worker-src blob:）跑全矩阵：绘制、文本提取、取消、并发、
//   生命周期计数归零、失败样本分态；
// - 用例输出对齐 [集成测试][START]/[PASS]/[FAIL]/[TIME] 标记，报告判定可
//   复用 evaluateHostReport；测量数据落 JSON 报告。
// 探针代码不进 VSIX；宿主侧不 import pdfjs-dist（Node 18 不执行 PDF 渲染）。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { buildEditorCsp } from '../../../src/host/editorCsp'

interface StepMessage { type: 'step'; scenario: string; ok: boolean; detail: string }
interface DoneMessage { type: 'scenarioDone'; scenario: string }
interface ReadyMessage { type: 'ready' }
interface FinalizedMessage { type: 'finalized'; metrics: unknown }
type ProbeMessage = StepMessage | DoneMessage | ReadyMessage | FinalizedMessage | { type: 'metrics' | 'bootstrap-alive' }

/** 单个 webview 面板会话：发送场景并按 scenarioDone 收口。 */
class PanelSession {
  readonly panel: vscode.WebviewPanel
  private steps: StepMessage[] = []
  private doneResolvers = new Map<string, () => void>()
  private readyResolve!: () => void
  private finalized!: Promise<unknown>
  private disposed = false

  constructor(extensionUri: vscode.Uri, localRoots: vscode.Uri[], cspExtra: string) {
    this.panel = vscode.window.createWebviewPanel(
      'vsidianPdfProbe',
      'PDF probe',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [extensionUri, ...localRoots] },
    )
    const webview = this.panel.webview
    const nonce = randomUUID()
    // 变体 A：生产 CSP 原样；变体 B：追加 worker-src blob:
    const csp = buildEditorCsp(webview.cspSource, nonce) + (cspExtra ? `; ${cspExtra}` : '')
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'test', 'integration', 'pdfProbe', 'main.js'),
    )
    webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>PDF probe</title>
</head>
<body>
<script nonce="${nonce}">
  // 诊断通道：HTML 存活信号 + 主脚本执行错误转发（探针调试用）
  window.addEventListener('error', (e) => {
    try {
      window.__vsidianProbeApi.postMessage({ type: 'step', scenario: 'bootstrap', ok: false, detail: 'window.onerror: ' + e.message + ' @' + (e.filename || '?') + ':' + e.lineno + ':' + (e.colno ?? '?') + (e.error && e.error.stack ? ' STACK ' + String(e.error.stack).slice(0, 300) : '') })
    } catch { /* late error after dispose */ }
  })
  window.__vsidianProbeApi = window.acquireVsCodeApi()
  window.__vsidianProbeApi.postMessage({ type: 'bootstrap-alive' })
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
    webview.onDidReceiveMessage((msg: ProbeMessage) => this.onMessage(msg))
    this.ready = new Promise((resolve) => { this.readyResolve = resolve })
  }

  readonly ready: Promise<void>
  private onMessage(msg: ProbeMessage): void {
    if (msg.type === 'bootstrap-alive') console.log('[pdfProbe] webview HTML 存活信号已到达')
    else if (msg.type === 'ready') this.readyResolve()
    else if (msg.type === 'step') {
      console.log(`[pdfProbe][${msg.ok ? 'ok' : 'BAD'}] (step) ${msg.detail}`)
      this.steps.push(msg)
    }
    else if (msg.type === 'scenarioDone') this.doneResolvers.get(msg.scenario)?.()
    else if (msg.type === 'finalized') this.finalResolve?.((msg as FinalizedMessage).metrics)
  }
  private finalResolve?: (metrics: unknown) => void

  async runScenario(scenario: string, timeoutMs = 60_000): Promise<StepMessage[]> {
    const start = this.steps.length
    const done = new Promise<void>((resolve) => this.doneResolvers.set(scenario, resolve))
    await this.panel.webview.postMessage({ type: 'run', scenario })
    const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
    const outcome = await Promise.race([done.then(() => 'done' as const), timer])
    if (outcome === 'timeout') {
      this.steps.push({ type: 'step', scenario, ok: false, detail: `场景超时（${timeoutMs}ms）` })
    }
    this.doneResolvers.delete(scenario)
    return this.steps.slice(start)
  }

  finalizeMetrics(): Promise<unknown> {
    this.finalized = new Promise((resolve) => { this.finalResolve = resolve })
    void this.panel.webview.postMessage({ type: 'finalize' })
    return Promise.race([this.finalized, new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 10_000))])
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true
      this.panel.dispose()
    }
  }
}

export async function run(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..', '..', '..')
  const samplesDir = process.env.VSIDIAN_PDF_PROBE_SAMPLES
  if (!samplesDir) throw new Error('缺少 VSIDIAN_PDF_PROBE_SAMPLES（样本目录）')
  const extensionUri = vscode.Uri.file(root)
  const sampleNames = [
    'zh-embedded.pdf', 'zh-cmap.pdf', 'latin-standard.pdf', 'scanned.pdf',
    'multipage.pdf', 'corrupt.pdf', 'encrypted.pdf', 'garbage.pdf',
  ]

  const failures: string[] = []
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), scenarios: [] }

  const testCase = async (name: string, fn: () => Promise<void>) => {
    console.log(`[集成测试][START] ${name}`)
    const t0 = Date.now()
    try {
      await fn()
      console.log(`[集成测试][PASS] ${name}`)
    } catch (err) {
      failures.push(name)
      console.error(`[集成测试][FAIL] ${name}`, err)
    } finally {
      console.log(`[集成测试][TIME] ${Date.now() - t0}ms ${name}`)
    }
  }

  const resourceUris = (webview: vscode.Webview): Record<string, string> => ({
    workerJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'test', 'integration', 'pdfProbe', 'worker.js')).toString(),
    cMapUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist', 'cmaps')).toString(),
    fontUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist', 'standard_fonts')).toString(),
    wasmUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist', 'wasm')).toString(),
    iccUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist', 'iccs')).toString(),
  })

  // 变体 A：生产 CSP 原样 —— blob worker 应被 CSP 拒绝（SecurityError）
  const samplesRoot = vscode.Uri.file(samplesDir)
  await testCase('pdfProbe: 生产 CSP 下 blob worker 被拒（worker-src 必要性）', async () => {
    const session = new PanelSession(extensionUri, [samplesRoot], '')
    // HTML 里才有 webview.cspSource——资源 URI 需要在 panel 建好后再补发：
    // PanelSession 构造时传空，ready 后直接补一条带资源的消息
    try {
      await Promise.race([session.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('webview ready 超时')), 30_000))])
      const webview = session.panel.webview
      await webview.postMessage({
        type: 'configure',
        ...resourceUris(webview),
        samples: Object.fromEntries(sampleNames.map((n) => [n, webview.asWebviewUri(vscode.Uri.file(path.join(samplesDir, n))).toString()])),
      })
      const steps = await session.runScenario('worker-csp-probe')
      const rejected = steps.some((s) => !s.ok && /SecurityError|被拒/.test(s.detail))
      ;(report.scenarios as unknown[]).push({ scenario: 'cspA-worker-csp-probe', steps })
      if (!rejected) throw new Error(`预期 blob worker 被 CSP 拒绝，实际：${JSON.stringify(steps.map((s) => s.detail))}`)
      console.log(`[pdfProbe] ${steps.map((s) => s.detail).join('；')}`)
    } finally {
      session.dispose()
    }
  })

  // 变体 B：+ worker-src blob: —— 全矩阵
  const variantB = new PanelSession(extensionUri, [samplesRoot], 'worker-src blob:')
  try {
    await Promise.race([variantB.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('webview ready 超时')), 30_000))])
    const webview = variantB.panel.webview
    await webview.postMessage({
      type: 'configure',
      ...resourceUris(webview),
      samples: Object.fromEntries(sampleNames.map((n) => [n, webview.asWebviewUri(vscode.Uri.file(path.join(samplesDir, n))).toString()])),
    })

    const scenarios: Array<{ scenario: string; label: string }> = [
      { scenario: 'worker-csp-probe', label: 'blob worker 放行（echo）' },
      { scenario: 'draw-zh-embedded', label: '内嵌中文绘制 + 文本提取' },
      { scenario: 'draw-zh-cmap', label: '非内嵌中文（CMap）绘制 + 文本提取' },
      { scenario: 'draw-latin', label: '标准字体（standard_fonts）绘制' },
      { scenario: 'draw-scanned', label: '扫描页（纯图）绘制 + 零文本' },
      { scenario: 'draw-zh-page2', label: 'scale 2 绘制（像素费用样本）' },
      { scenario: 'multipage-cancel', label: '按页取消与后续可用' },
      { scenario: 'concurrent-load-destroy', label: '并发装载与计数归零' },
      { scenario: 'failure-states', label: '损坏/加密/非 PDF 分态' },
    ]
    for (const { scenario, label } of scenarios) {
      await testCase(`pdfProbe: ${label}`, async () => {
        const steps = await variantB.runScenario(scenario)
        ;(report.scenarios as unknown[]).push({ scenario, steps })
        const bad = steps.filter((s) => !s.ok)
        for (const s of steps) console.log(`[pdfProbe][${s.ok ? 'ok' : 'BAD'}] ${s.detail}`)
        if (bad.length > 0) throw new Error(`${bad.length} 步未过：${bad.map((s) => s.detail).join('；')}`)
      })
    }

    await testCase('pdfProbe: 生命周期终检（blob/worker 计数归零）', async () => {
      const metrics = await variantB.finalizeMetrics() as Record<string, unknown>
      report.finalMetrics = metrics
      console.log(`[pdfProbe] finalMetrics ${JSON.stringify(metrics)}`)
      const stats = metrics.workerStats as { workersCreated: number; workersTerminated: number; blobCreated: number; blobRevoked: number }
      const workerBalanced = stats.workersCreated === stats.workersTerminated
      const blobBalanced = stats.blobCreated === stats.blobRevoked
      console.log(`[pdfProbe] worker 计数 created=${stats.workersCreated} terminated=${stats.workersTerminated}；blob created=${stats.blobCreated} revoked=${stats.blobRevoked}`)
      if (!workerBalanced) throw new Error(`worker 计数未归零：created=${stats.workersCreated} terminated=${stats.workersTerminated}`)
      if (!blobBalanced) throw new Error(`blob 计数未归零：created=${stats.blobCreated} revoked=${stats.blobRevoked}`)
    })
  } finally {
    variantB.dispose()
  }

  report.finishedAt = new Date().toISOString()
  try {
    const reportPath = path.join(root, '.vscode-test', 'pdf-probe-report.json')
    mkdirSync(path.dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[pdfProbe] 测量报告已写入 ${reportPath}`)
  } catch (err) {
    console.error('[pdfProbe] 测量报告写入失败', err)
  }

  if (failures.length > 0) {
    throw new Error(`PDF 探针失败 ${failures.length} 项：${failures.join('；')}`)
  }
  console.log(`[集成测试] 执行 ${11}/11 项（pdfProbe 全部用例）`)
}
