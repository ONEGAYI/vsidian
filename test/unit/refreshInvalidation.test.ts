// @vitest-environment jsdom
// #208 手动刷新失效通道的面板接线契约：宿主 refresh.invalidated 到达后，
// ImageResourceManager 全量失效重挂（活跃图片槽位重新出站 image.request，
// 新 reqId；宿主已清缓存且新解析 URI 带新代次戳）+ Mermaid 懒加载失败
// 终态重置（重新允许注入）。工具栏刷新按钮已随按钮批次落地，失效通知的
// reqId 须与面板最后发出的 refresh.request 配对（陈旧回执观测层丢弃），
// 故本文件用例先经按钮发出请求再回执。
import { describe, it, expect, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import {
  __resetMermaidRenderStateForTest,
  ensureMermaidApi,
} from '../../src/webview/mermaidRender'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  ;(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null
}

const DOC_URI = 'file:///d%3A/notes/refresh.md'
const MERMAID_URI = 'https://res.invalid/mermaid.js'

const mountedParents: HTMLElement[] = []

async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

function makeBridge(): { bridge: VsCodeBridge; sent: WebviewToHost[] } {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

function mountPanel(h: { bridge: VsCodeBridge }, text: string) {
  const c = new WebviewSyncController(h.bridge)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  mountedParents.push(parent)
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  return { c, parent }
}

function imageRequests(sent: WebviewToHost[]): Array<{ reqId: number; src: string }> {
  return sent
    .filter((m): m is Extract<WebviewToHost, { kind: 'image.request' }> => m.kind === 'image.request')
    .map((m) => ({ reqId: m.reqId, src: m.src }))
}

afterEach(() => {
  for (const parent of mountedParents.splice(0)) {
    parent.remove()
  }
  delete (globalThis as Record<string, unknown>)['__vsidianMermaidUri']
  __resetMermaidRenderStateForTest()
  document.head.querySelectorAll('script').forEach((s) => s.remove())
})

describe('#208 refresh.invalidated 面板接线', () => {
  it('失效通知后活跃图片槽位重新出站 image.request（同 src、新 reqId），新结果换新 src', async () => {
    const h = makeBridge()
    const { c } = mountPanel(h, '![图](./a.png)\n')
    // 阅读块挂载：图片槽位 attach → 首轮解析请求
    expect(imageRequests(h.sent)).toEqual([{ reqId: 1, src: './a.png' }])
    const imgEl = document.querySelector<HTMLImageElement>('img[data-vsidian-img-src="./a.png"]')
    expect(imgEl).not.toBeNull()
    // 首轮结果应用（旧代次地址）
    c.handleHostMessage({ kind: 'image.result', reqId: 1, ok: true, src: 'vscode-webview://res/a.png' })
    expect(imgEl!.getAttribute('src')).toBe('vscode-webview://res/a.png')
    // 经工具栏刷新按钮发出请求（reqId=1）后，宿主失效通知回执配对到达：
    // 全量失效重挂
    document.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')!.click()
    expect(h.sent.some((m) => m.kind === 'refresh.request')).toBe(true)
    c.handleHostMessage({ kind: 'refresh.invalidated', reqId: 1, generation: 1 })
    expect(imageRequests(h.sent)).toEqual([
      { reqId: 1, src: './a.png' },
      { reqId: 2, src: './a.png' },
    ])
    expect(imgEl!.getAttribute('src')).toBeNull() // 释放旧图位图，回 loading 占位
    // 宿主新代次 URI 到达：换新 src 重载
    c.handleHostMessage({ kind: 'image.result', reqId: 2, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    expect(imgEl!.getAttribute('src')).toBe('vscode-webview://res/a.png?v=1')
  })

  it('失效通知重置 Mermaid 懒加载失败终态：后续装载恢复注入能力', async () => {
    ;(globalThis as Record<string, unknown>)['__vsidianMermaidUri'] = MERMAID_URI
    const scripts = () => document.head.querySelectorAll<HTMLScriptElement>(`script[src="${MERMAID_URI}"]`)
    const h = makeBridge()
    const { c } = mountPanel(h, '```mermaid\nA-->B\n```\n')
    await settle()
    // 阅读挂载钩子触发懒加载：注入第一个 script（jsdom 不装载外部资源，pending）
    expect(scripts().length).toBe(1)
    scripts()[0]!.onerror?.(new Event('error') as ErrorEvent)
    await settle(2)
    // 失败终态：不再注入（既有 D-5 契约）
    void ensureMermaidApi()
    await settle(2)
    expect(scripts().length).toBe(1)
    // 经按钮发出请求（reqId=1）后，宿主失效通知回执配对到达：终态重置
    // → 重新允许注入
    document.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')!.click()
    c.handleHostMessage({ kind: 'refresh.invalidated', reqId: 1, generation: 1 })
    void ensureMermaidApi()
    await settle(2)
    expect(scripts().length).toBe(2)
  })

  it('失效通知后已降级的 Mermaid 容器立即重画（无需滚动触发新 pending 容器）', async () => {
    ;(globalThis as Record<string, unknown>)['__vsidianMermaidUri'] = MERMAID_URI
    const scripts = () => document.head.querySelectorAll<HTMLScriptElement>(`script[src="${MERMAID_URI}"]`)
    const h = makeBridge()
    const { c } = mountPanel(h, '```mermaid\nA-->B\n```\n')
    await settle()
    // 懒加载失败 → 容器固化 error 态（降级提示 + 源码）
    scripts()[0]!.onerror?.(new Event('error') as ErrorEvent)
    await settle(2)
    const container = document.querySelector<HTMLElement>('.vsidian-mermaid')
    expect(container).not.toBeNull()
    expect(container!.getAttribute('data-vsidian-mermaid-state')).toBe('error')
    // 经按钮发出请求（reqId=1）后，宿主失效通知回执配对到达：终态重置 +
    // 已降级容器立即重新走渲染管线（重入 rendering 态、重新注入 script）
    document.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')!.click()
    c.handleHostMessage({ kind: 'refresh.invalidated', reqId: 1, generation: 1 })
    await settle(2)
    expect(scripts().length).toBe(2)
    expect(container!.getAttribute('data-vsidian-mermaid-state')).toBe('rendering')
  })
})
