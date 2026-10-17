// #566（T01）CSS 作用域探针 webview 主线程（宿主 webview / 浏览器两用）。
// - 宿主形态：suite 注入的 HTML 已预挂生产 main.css + 契约测试片段
//   <link>（data-probe-main / data-probe-snippet 标记），本脚本等 'run'
//   消息后执行 probeCore 并 postMessage 回结果；
// - 浏览器形态：runBrowserProbe.mjs 直接注入本 bundle，经全局
//   __vsidianCssScopeProbeRun 调用（无 acquireVsCodeApi，桥接自动退化为空）。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。
import { runCssScopeProbe, mountB2Demo, type CssScopeProbeEnv, type CssScopeProbeResult } from './probeCore'

interface AcquireVsCodeApi {
  postMessage(msg: unknown): void
}
declare const acquireVsCodeApi: () => AcquireVsCodeApi

const vscode: AcquireVsCodeApi | null =
  (window as unknown as { __vsidianProbeApi?: AcquireVsCodeApi }).__vsidianProbeApi
  ?? (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null)

const readStylesheetText = async (which: 'main' | 'probe'): Promise<string> => {
  const link = document.querySelector<HTMLLinkElement>(which === 'main' ? 'link[data-probe-main]' : 'link[data-probe-snippet]')
  if (!link) return ''
  // 浏览器形态：读注入 <style> 的文本宿主没有——统一走 fetch(link href)；
  // file:// 下 fetch 不可用时由浏览器 harness 自行传入读取器（见下）。
  try {
    const res = await fetch(link.href)
    return res.ok ? await res.text() : ''
  } catch {
    return ''
  }
}

export const probeEnvForPage = (label: string): CssScopeProbeEnv => ({ label, readStylesheetText })

declare global {
  interface Window {
    __vsidianCssScopeProbeRun?: (env: CssScopeProbeEnv) => Promise<CssScopeProbeResult>
    __vsidianCssScopeProbeMountB2?: () => void
  }
}

window.__vsidianCssScopeProbeRun = runCssScopeProbe
window.__vsidianCssScopeProbeMountB2 = mountB2Demo

if (vscode) {
  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as { type?: string } | null
    if (!msg || msg.type !== 'run') return
    void (async () => {
      try {
        const result: CssScopeProbeResult = await runCssScopeProbe(probeEnvForPage('host-1.82.3-webview'))
        vscode.postMessage({ type: 'result', result })
      } catch (err) {
        vscode.postMessage({ type: 'error', message: String((err as { stack?: string } | null)?.stack ?? err) })
      }
    })()
  })
  vscode.postMessage({ type: 'ready' })
}
