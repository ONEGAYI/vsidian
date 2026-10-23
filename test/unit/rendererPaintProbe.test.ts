// @vitest-environment jsdom
// #629 renderers 绘制探针契约（syncController 直驱）：探针字段语义与
// 消息白名单校验——组件真渲染 SVG 场景 builtinSvg 不得误计、addonSvg
// 计组件产物、含新字段的 view.state 消息经 isWebviewToHost 接受。
// 对照实验（vsidian-codex-bridge#7 评审轮）：旧探针在「组件真渲染出
// SVG」时恒 builtinSvg>=1 且 width 落 display:none 内嵌 <style> 恒 0
// ——断言面写反；本文件钉住修正后的语义。
import { describe, it, expect, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { isWebviewToHost, type WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { GRAPHIC_LANG_ATTR, GRAPHIC_MODE_ATTR, GRAPHIC_PROVIDER_ATTR, MERMAID_STATE_ATTR } from '../../src/shared/mermaid'

installLocale('zh-cn', zhCn)

const DOC_URI = 'file:///d%3A/notes/renderer-probe.md'
const DOC = '# 探针样例\n\n正文段。\n'

function makeBridge(): { bridge: VsCodeBridge; sent: WebviewToHost[] } {
  const sent: WebviewToHost[] = []
  let state: Record<string, unknown> | undefined
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: <T,>() => state as T | undefined,
    setState: (s) => {
      state = s as Record<string, unknown>
    },
  }
  return { bridge, sent }
}

let cleanup: Array<() => void> = []

function mountProbe(h: { bridge: VsCodeBridge; sent: WebviewToHost[] }): WebviewSyncController {
  const c = new WebviewSyncController(h.bridge)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  cleanup.push(() => parent.remove())
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
  return c
}

function viewStateRenderers(c: WebviewSyncController, h: { bridge: VsCodeBridge; sent: WebviewToHost[] }) {
  const before = h.sent.length
  c.handleHostMessage({ kind: 'view.state.request' })
  const msg = h.sent.slice(before).find((m) => m.kind === 'view.state') as Extract<WebviewToHost, { kind: 'view.state' }> | undefined
  if (!msg) {
    throw new Error('view.state 未回报')
  }
  return msg
}

/** 按真实挂载形态（remountGraphicContainer + 组件 mount）构造图形容器：
 *  类名/语言/模式/提供者/状态齐全，innerHtml 模拟组件渲染产物 */
function mountGraphicContainer(provider: string, innerHtml: string): void {
  const el = document.createElement('div')
  el.className = 'vsidian-mermaid'
  el.setAttribute(GRAPHIC_LANG_ATTR, 'mermaid')
  el.setAttribute(GRAPHIC_MODE_ATTR, 'live')
  el.setAttribute(GRAPHIC_PROVIDER_ATTR, provider)
  el.setAttribute(MERMAID_STATE_ATTR, 'rendered')
  el.innerHTML = innerHtml
  document.body.appendChild(el)
  cleanup.push(() => el.remove())
}

afterEach(() => {
  cleanup.forEach((fn) => fn())
  cleanup = []
})

describe('renderers 绘制探针（#629）', () => {
  it('组件真渲染 SVG：builtinSvg 不误计、addonSvg 计组件产物，容器条目带所有权', () => {
    const h = makeBridge()
    const c = mountProbe(h)
    mountGraphicContainer(
      'test.addon/mermaid-alt',
      '<svg viewBox="0 0 40 20"><style>.node{fill:#333}</style><g><text>节点</text></g></svg>',
    )
    const msg = viewStateRenderers(c, h)
    const renderers = msg.paint?.renderers
    expect(renderers).toBeDefined()
    // 旧实现（.vsidian-mermaid svg 全量计数）此处为 1——#629 主缺陷
    expect(renderers!.builtinSvg).toBe(0)
    expect(renderers!.addonSvg).toBe(1)
    const entry = renderers!.containers.find((row) => row.language === 'mermaid')
    expect(entry?.provider).toBe('test.addon/mermaid-alt')
    expect(entry?.mode).toBe('live')
    expect(entry?.state).toBe('rendered')
  })

  it('内置容器：builtinSvg 计内置产物、addonSvg 归零（过滤不误伤内置计数）', () => {
    const h = makeBridge()
    const c = mountProbe(h)
    mountGraphicContainer('builtin', '<svg viewBox="0 0 40 20"><g><text>内置图</text></g></svg>')
    const msg = viewStateRenderers(c, h)
    const renderers = msg.paint!.renderers!
    expect(renderers.builtinSvg).toBe(1)
    expect(renderers.addonSvg).toBe(0)
    expect(renderers.containers.find((row) => row.language === 'mermaid')?.provider).toBe('builtin')
  })

  it('error 占位（组件自渲染错误文本、无 svg）：addonSvg 归零——渲染成败可区分', () => {
    const h = makeBridge()
    const c = mountProbe(h)
    // 组件捕获自己的异常、输出错误占位（Q30 自处理失败——平台 state 仍
    // rendered，mount 同步返回即写）：探针的成败信号只有 addonSvg 计数
    mountGraphicContainer(
      'test.addon/mermaid-alt',
      '<style>.err{color:red}</style><span>渲染失败：语法错误</span>',
    )
    const msg = viewStateRenderers(c, h)
    const renderers = msg.paint!.renderers!
    expect(renderers.addonSvg).toBe(0)
    expect(renderers.builtinSvg).toBe(0)
    expect(renderers.containers.find((row) => row.language === 'mermaid')?.provider).toBe('test.addon/mermaid-alt')
  })

  it('含 renderers.addonSvg 的 view.state 消息经 isWebviewToHost 接受（校验白名单同步）', () => {
    const h = makeBridge()
    const c = mountProbe(h)
    mountGraphicContainer('test.addon/mermaid-alt', '<svg></svg>')
    const msg = viewStateRenderers(c, h)
    // #105 同款回归：运行时白名单漏登新字段时宿主丢弃整条 view.state 消息，
    // 集成表现为 viewState 轮询超时
    expect(isWebviewToHost(msg)).toBe(true)
  })
})
