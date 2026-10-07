// #364 T15 渲染样例——编辑器页源码（经 SDK 构建桥打成 chrome114 IIFE）。
//
// 经公开 renderers 面登记四个提供者（覆盖 T15 票面验收路径）：
// - mermaid-lite：接管内置 mermaid（live+reading 双模式、svg 导出）——
//   「替换一个内置语言的渲染」：安装后自动接管（无需用户先选）；
// - flow-plain / flow-boxed：普通语言 sampleflow（无内置图形渲染）的两
//   个候选——同批确定性默认序（providerId 字典序末位 flow-plain 生效）
//   与用户首选按需调整（用户可改选 boxed、清除回默认）；
// - flow-buggy：同语言第三候选——mount 内部故意抛错并**自捕获**渲染
//   降级占位：组件自身 bug 的自处理降级（不等于组件故障——平台不接管、
//   不修复，组件仍 enabled），与全组件故障停用（宿主侧 armCrash 通道
//   注入，见 extension.ts）形成四态对照。
//
// 渲染样式读组件自身设置（theme/showSource，经 setup 通道）；每次挂载
// 顺带异步刷新缓存——设置页改样式后下一次挂载生效。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import { pickMessages } from './i18n'

const ADDON_ID = 'vsidian-example.renderer'

defineAddonPage(ADDON_ID, async (sdk: VsidianAddonPageSdk) => {
  const renderers = sdk.renderers
  if (!renderers) {
    throw new Error('editor page SDK must expose renderers facet')
  }
  const m = pickMessages(navigator.language)

  // 放行门控（默认值语义见 extension.ts 文件头注）：未放行时零候选上报
  const permission = await sdk.channel.request('renderer.allowed', null)
  const allowed = permission.ok === true &&
    (permission.result as { allowed?: unknown } | null)?.allowed === true
  if (!allowed) {
    return
  }

  /** 组件设置缓存（theme/showSource；宿主不可达回退默认） */
  interface RendererSettings {
    readonly theme: 'plain' | 'boxed'
    readonly showSource: boolean
  }
  let settings: RendererSettings = { theme: 'boxed', showSource: true }
  const refreshSettings = async (): Promise<void> => {
    const outcome = await sdk.channel.request('renderer.getSettings', null)
    if (outcome.ok !== true || typeof outcome.result !== 'object' || outcome.result === null) {
      return
    }
    const values = outcome.result as Record<string, unknown>
    settings = {
      theme: values['theme'] === 'plain' ? 'plain' : 'boxed',
      showSource: values['showSource'] !== false,
    }
  }
  await refreshSettings()

  /** 上报事件（fire-and-forget） */
  const report = (event: Record<string, unknown>): void => {
    void sdk.channel.request('renderer.event', event).then(() => {}, () => {})
  }

  /** 通用挂载：清空容器后落样例渲染框（provider 标记 + 源码 + 样式变体）；
   *  本次消费设置缓存，顺带异步刷新——设置页改样式后下一次挂载生效 */
  const mountBox = (rendererId: string) => (container: HTMLElement, code: string, ctx: { language: string; mode: string }) => {
    void refreshSettings()
    container.textContent = ''
    const box = document.createElement('div')
    box.className = 'sample-render-box'
    box.setAttribute('data-sample-renderer', rendererId)
    box.setAttribute('data-sample-language', ctx.language)
    box.setAttribute('data-sample-mode', ctx.mode)
    box.setAttribute('data-sample-theme', settings.theme)
    const title = document.createElement('div')
    title.className = 'sample-render-title'
    title.textContent = `${rendererId} · ${ctx.language} · ${ctx.mode}`
    box.append(title)
    if (settings.showSource) {
      const source = document.createElement('div')
      source.className = 'sample-render-source'
      source.textContent = `${code.split('\n').length} 行 · ${code.slice(0, 40)}`
      box.append(source)
    }
    container.append(box)
  }

  // ---- 内置语言接管：mermaid（替换内置图形渲染） ----
  renderers.register({
    rendererId: 'mermaid-lite',
    label: m.providerMermaidLite,
    languages: ['mermaid'],
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount: mountBox('mermaid-lite'),
    release: (container) => {
      container.setAttribute('data-sample-released', '1')
    },
    exportSvg: async (code) =>
      `<svg xmlns="http://www.w3.org/2000/svg" data-sample-export="mermaid-lite" width="120" height="24"><rect width="120" height="24" fill="#0960f6"/><text x="6" y="16" fill="#fff">${code.slice(0, 10)}</text></svg>`,
  })

  // ---- 普通语言 sampleflow：确定性默认序的朴素候选（末位默认生效） ----
  renderers.register({
    rendererId: 'flow-plain',
    label: m.providerFlowPlain,
    languages: ['sampleflow'],
    modes: ['live', 'reading'],
    exportFormats: [],
    mount: mountBox('flow-plain'),
  })

  // ---- 普通语言 sampleflow：卡片候选（用户首选按需调整的目标） ----
  renderers.register({
    rendererId: 'flow-boxed',
    label: m.providerFlowBoxed,
    languages: ['sampleflow'],
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount: mountBox('flow-boxed'),
    exportSvg: async () => '<svg xmlns="http://www.w3.org/2000/svg" data-sample-export="flow-boxed"></svg>',
  })

  // ---- 普通语言 sampleflow：带缺陷候选（自身 bug 的自处理降级） ----
  // mount 内部抛错并自捕获渲染降级占位：组件仍 enabled、其他语言的渲染
  // 不受牵连——「自处理降级不等于故障」，与 armCrash 通道注入的全组件
  // 故障停用形成对照（平台语义：组件仍运行而渲染有 bug 时不自动接管）
  renderers.register({
    rendererId: 'flow-buggy',
    label: m.providerFlowBuggy,
    languages: ['sampleflow'],
    modes: ['live', 'reading'],
    exportFormats: [],
    mount: (container, code, ctx) => {
      container.textContent = ''
      try {
        throw new Error('sample renderer bug: cannot parse sampleflow source')
      } catch (err) {
        const fallback = document.createElement('div')
        fallback.className = 'sample-self-handled'
        fallback.setAttribute('data-sample-renderer', 'flow-buggy')
        fallback.setAttribute('data-sample-language', ctx.language)
        fallback.textContent = `${String(err)}（自处理降级，源码 ${(code ?? '').length} 字符）`
        container.append(fallback)
      }
    },
  })

  report({ kind: 'registered', providers: ['mermaid-lite', 'flow-plain', 'flow-boxed', 'flow-buggy'] })

  sdk.onDispose(() => {
    // 释放语义由装载器与生效表广播驱动（release 回调逐容器执行）
  })
})
