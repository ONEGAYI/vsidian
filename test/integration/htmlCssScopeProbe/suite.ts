// #566（T01）文档内 CSS 作用域探针宿主侧套件：在 VSCode 1.82.3 真实宿主内运行。
// - 自建 WebviewPanel（enableScripts），HTML 与生产 textEditorProvider 同型
//   （nonce + meta CSP + asWebviewUri 资源）；CSP 用生产 buildEditorCsp
//   纯逻辑装配、原样不加改动——srcdoc iframe 在 frame-src https: 下的
//   实际行为因此对生产口径取证；
// - 头部预挂生产 out/webview/main.css 与 media/css-contract-probe.css
//   （生产构建恒挂的稳定契约测试片段），层叠/特异性对真实生产 CSS 取证；
// - webview 内执行 probeCore 全矩阵，绘制读值逐行打印并落 JSON 报告；
// - 用例输出对齐 [集成测试][START]/[PASS]/[FAIL]/[TIME] 标记，判定可复用
//   evaluateHostReport。探针代码不进 VSIX。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { buildEditorCsp } from '../../../src/host/editorCsp'

interface ProbeRow { name: string; value: string; expect: string; meets: boolean | null }
interface ProbeScenario { route: string; summary: string; rows: ProbeRow[]; notes: string[] }
interface ProbeResult {
  env: { label: string; userAgent: string; startedAt: string }
  capabilities: Record<string, unknown>
  scenarios: ProbeScenario[]
}

export async function run(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..', '..', '..')
  const extensionUri = vscode.Uri.file(root)
  console.log('[probe] 宿主 process.versions', JSON.stringify({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }))
  console.log('[集成测试][START] htmlCssScopeProbe: 文档内 CSS 作用域隔离矩阵（webview 绘制读值）')
  const t0 = Date.now()
  try {
    const panel = vscode.window.createWebviewPanel(
      'vsidianCssScopeProbe',
      'CSS scope probe',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [extensionUri] },
    )
    try {
      const webview = panel.webview
      const nonce = randomUUID()
      const csp = buildEditorCsp(webview.cspSource, nonce)
      const mainCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.css'))
      const probeCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'css-contract-probe.css'))
      const mainJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'test', 'integration', 'htmlCssScopeProbe', 'main.js'))
      webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link data-probe-main href="${mainCss}" rel="stylesheet">
<link data-probe-snippet href="${probeCss}" rel="stylesheet">
<title>CSS scope probe</title>
</head>
<body>
<script nonce="${nonce}">
  window.addEventListener('error', (e) => {
    try { window.__vsidianProbeApi.postMessage({ type: 'error', message: 'window.onerror: ' + e.message + ' @' + (e.filename || '?') + ':' + e.lineno }) } catch { /* late error */ }
  })
  window.__vsidianProbeApi = window.acquireVsCodeApi()
  window.__vsidianProbeApi.postMessage({ type: 'ready' })
</script>
<script nonce="${nonce}" src="${mainJs}"></script>
</body>
</html>`
      const result = await new Promise<ProbeResult>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('探针结果等待超时（180s）')), 180_000)
        let started = false
        webview.onDidReceiveMessage((msg: { type?: string; result?: ProbeResult; message?: string }) => {
          if (msg?.type === 'ready') {
            console.log('[probe] webview ready 信号已到达')
            if (!started) {
              started = true
              void webview.postMessage({ type: 'run' })
            }
          } else if (msg?.type === 'result' && msg.result) {
            clearTimeout(timer)
            resolve(msg.result)
          } else if (msg?.type === 'error') {
            clearTimeout(timer)
            reject(new Error(msg.message ?? '未知 webview 错误'))
          }
        })
      })
      console.log(`[probe] capabilities ${JSON.stringify(result.capabilities)}`)
      for (const s of result.scenarios) {
        console.log(`[probe] 场景 ${s.route}：${s.summary}`)
        for (const r of s.rows) {
          const tag = r.meets === null ? 'info' : r.meets ? 'ok' : 'BAD'
          console.log(`[probe][${tag}] ${s.route}.${r.name} = ${r.value}（期望：${r.expect}）`)
        }
        for (const n of s.notes) console.log(`[probe][note] ${s.route}: ${n}`)
      }
      const reportPath = path.join(root, '.vscode-test', 'html-css-scope-probe-report.json')
      mkdirSync(path.dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8')
      console.log(`[probe] 测量报告已写入 ${reportPath}`)
      console.log(`[集成测试][PASS] htmlCssScopeProbe: 文档内 CSS 作用域隔离矩阵（webview 绘制读值）`)
    } finally {
      panel.dispose()
    }
  } catch (err) {
    console.error('[集成测试][FAIL] htmlCssScopeProbe: 文档内 CSS 作用域隔离矩阵（webview 绘制读值）', err)
    throw err
  } finally {
    console.log(`[集成测试][TIME] ${Date.now() - t0}ms htmlCssScopeProbe`)
  }
  console.log('[集成测试] 执行 1/1 项（htmlCssScopeProbe）')
}
