// V02（#349）探针编辑器页 webview 主（真宿主 1.82.3 内运行，chrome114）：
// 装配**生产** WebviewSyncController（与生产编辑器页同一控制器类、同一
// CM6 运行时——页面 bundle 单实例），并在页面内安装 V02 装载器原型。
// 与生产编辑器 webview 的差异仅在宿主侧装配来源（探针面板 HTML 由探针
// 套件以生产 buildEditorCsp 同型装配，脚本/样式经 asWebviewUri 注入）；
// 资源授权机制（localResourceRoots 包含性 + 资源服务拒绝）与生产一致。
// 消息桥：宿主 → 页面为 probe.rpc / AddonPageDirective；页面 → 宿主为
// probe.ready / probe.rpc.result / probe.forward（装载器出站转发）与控制
// 器原始消息（kind:'ready' 等）。
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { WebviewSyncController } from '../../../src/webview/syncController'
import { installAddonPageLoader, type AddonPageLoaderHandle } from '../../fixtures/addon-v02/loader/pageAddonLoader'
import type { AddonPageDirective } from '../../fixtures/addon-v02/loader/types'
import '../../../src/webview/main.css'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
}

const vscode = acquireVsCodeApi()
const post = (message: unknown) => vscode.postMessage(message)

const addonSlot = new Compartment()
const findView = () => {
  const host = document.querySelector('.cm-editor') as HTMLElement | null
  const view = host ? EditorView.findFromDOM(host) : null
  if (!view) throw new Error('cm-editor 视图未就绪')
  return view
}

const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  // 共享运行时 = 本页 bundle 的模块命名空间（与生产控制器同一实例）
  cm6: { state: cmState, view: cmView },
  attachExtensions: (extension) => {
    const view = findView()
    view.dispatch({ effects: addonSlot.reconfigure(extension ?? []) })
  },
  send: (message) => post({ type: 'probe.forward', message }),
})

const controller = new WebviewSyncController({
  postMessage: (message) => post({ controller: message }),
  getState: () => undefined,
  setState() {},
})
controller.mount(document.getElementById('app') ?? document.body, [addonSlot.of([])])

const actions: Record<string, (args?: unknown) => unknown> = {
  init: (args) => {
    const { text } = args as { text: string }
    controller.handleHostMessage({
      kind: 'init', sessionId: 'v02-probe-editor', docUri: 'file:///v02-probe.md', version: 1, text,
    })
    return true
  },
  stats: () => loader.stats(),
  paint: () => {
    const marks = [...document.querySelectorAll<HTMLElement>('.vsa2-mark')]
    if (marks.length === 0) return { count: 0 }
    const first = marks[0]
    const rect = first.getBoundingClientRect()
    return {
      count: marks.length,
      color: getComputedStyle(first).backgroundColor,
      text: first.textContent ?? '',
      rectWidth: rect.width,
      rectHeight: rect.height,
    }
  },
  doc: () => {
    const host = document.querySelector('.cm-editor') as HTMLElement | null
    const view = host ? EditorView.findFromDOM(host) : null
    return view ? view.state.doc.toString() : null
  },
  dispatchProbeEvent: () => {
    document.dispatchEvent(new CustomEvent('vsa2-probe'))
    return true
  },
}

window.addEventListener('message', (event) => {
  const message = event.data as { type?: string; id?: string; action?: string; args?: unknown }
  if (!message || typeof message !== 'object') return
  if (message.type === 'probe.rpc') {
    const handler = actions[message.action ?? '']
    let result: unknown
    try {
      result = handler ? handler(message.args) : { error: `unknown action: ${message.action}` }
    } catch (err) {
      result = { error: String(err) }
    }
    post({ type: 'probe.rpc.result', id: message.id, result })
    return
  }
  if (message.type === 'addon.load' || message.type === 'addon.unload' ||
    message.type === 'addon.channel.reply' || message.type === 'addon.fault') {
    loader.handleDirective(message as AddonPageDirective)
  }
})

window.addEventListener('error', (event) => {
  post({ type: 'probe.pageError', message: `${event.message} @${event.filename}:${event.lineno}` })
})

post({ type: 'probe.ready', page: 'editor', userAgent: navigator.userAgent })
