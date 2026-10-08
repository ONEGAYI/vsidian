// V02（#349）探针设置页 webview 主（真宿主 1.82.3，chrome114）：
// 组件自身设置页的装载目标——安装 V02 装载器原型（设置页形态：无 CM6
// 共享运行时，提供挂载容器）。CSP 由探针套件按生产 buildSettingsPageHtml
// 的收紧形态装配（script-src cspSource+nonce、style-src/img-src 仅
// cspSource）——组件脚本/样式/图片仍经 cspSource 放行，越界路径由资源
// 服务拒绝。
import { installAddonPageLoader, type AddonPageLoaderHandle } from '../../fixtures/addon-v02/loader/pageAddonLoader'
import type { AddonPageDirective } from '../../fixtures/addon-v02/loader/types'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
}

const vscode = acquireVsCodeApi()
const post = (message: unknown) => vscode.postMessage(message)

const mountContainer = document.createElement('div')
mountContainer.id = 'vsa2-addon-mount'
document.body.appendChild(mountContainer)

const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'settings',
  mountContainer,
  send: (message) => post({ type: 'probe.forward', message }),
})

const actions: Record<string, () => unknown> = {
  stats: () => loader.stats(),
  settingsInfo: () => {
    const root = document.querySelector<HTMLElement>('.vsa2-settings-root')
    const title = document.querySelector<HTMLElement>('.vsa2-title')
    const logo = document.querySelector<HTMLImageElement>('.vsa2-logo')
    return {
      rootPresent: root !== null,
      rootConnected: root?.isConnected ?? false,
      titleColor: title ? getComputedStyle(title).color : null,
      logoComplete: logo ? logo.complete : false,
      logoNaturalWidth: logo?.naturalWidth ?? 0,
      logoSrc: logo?.currentSrc ?? logo?.src ?? null,
    }
  },
}

window.addEventListener('message', (event) => {
  const message = event.data as { type?: string; id?: string; action?: string }
  if (!message || typeof message !== 'object') return
  if (message.type === 'probe.rpc') {
    const handler = actions[message.action ?? '']
    let result: unknown
    try {
      result = handler ? handler() : { error: `unknown action: ${message.action}` }
    } catch (err) {
      result = { error: String(err) }
    }
    post({ type: 'probe.rpc.result', id: message.id, result })
    return
  }
  if (message.type === 'addon.load' || message.type === 'addon.unload' ||
    message.type === 'addon.channel.reply' || message.type === 'addon.fault') {
    post({ type: 'probe.note', note: `directive:${message.type}` })
    loader.handleDirective(message as AddonPageDirective)
  }
})

window.addEventListener('error', (event) => {
  post({ type: 'probe.pageError', message: `${event.message} @${event.filename}:${event.lineno}` })
})

post({ type: 'probe.ready', page: 'settings', userAgent: navigator.userAgent })
