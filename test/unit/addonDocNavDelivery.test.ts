import { describe, expect, it, vi } from 'vitest'
import { DocumentSession, type HostDocumentPort } from '../../src/host/documentSession'
import type { HostToWebview } from '../../src/shared/protocol'

function setup() {
  let version = 1
  const doc: HostDocumentPort = { get version() { return version }, getText: () => '# H\nbody',
    applyChanges: async () => true, undo: async () => true, redo: async () => true }
  const session = new DocumentSession(doc)
  const messages: HostToWebview[] = []
  const panel = session.attachPanel({ send: (message) => messages.push(message) })
  return { session, messages, panel, advanceVersion: () => { version++ } }
}

describe('组件导航的定位送达确认', () => {
  it('发出消息后仍等待同面板、同请求的确认；同 offset 的旧确认不冒充成功', async () => {
    const { session, messages, panel } = setup()
    await session.handleWebviewMessage({ kind: 'ready' }, panel)
    const controller = new AbortController()
    const result = session.locateAndWait(panel, 4, controller.signal)
    const message = messages.at(-1) as Extract<HostToWebview, { kind: 'view.locate' }>
    let settled = false
    void result.then(() => { settled = true })
    await session.handleWebviewMessage({ kind: 'view.locate.ack', offset: 4 }, panel)
    await Promise.resolve()
    expect(settled).toBe(false)
    await session.handleWebviewMessage({ kind: 'view.locate.ack', offset: 4, locateId: message.locateId }, panel)
    expect(await result).toBe(true)
  })

  it('超时与取消都失败，并清除未送达意图，重握手不重放旧定位', async () => {
    vi.useFakeTimers()
    try {
      const { session, messages, panel } = setup()
      await session.handleWebviewMessage({ kind: 'ready' }, panel)
      const controller = new AbortController()
      const result = session.locateAndWait(panel, 4, controller.signal)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await result).toBe(false)
      const result2 = session.locateAndWait(panel, 2, controller.signal)
      controller.abort()
      expect(await result2).toBe(false)
      messages.length = 0
      await session.handleWebviewMessage({ kind: 'ready' }, panel)
      expect(messages.some((m) => m.kind === 'view.locate')).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('面板关闭在途定位立即失败', async () => {
    const { session, panel } = setup()
    await session.handleWebviewMessage({ kind: 'ready' }, panel)
    const result = session.locateAndWait(panel, 4, new AbortController().signal)
    session.detachPanel(panel)
    expect(await result).toBe(false)
  })

  it('目标版本变化后不重放旧偏移，也不接受旧坐标的确认', async () => {
    const { session, messages, panel, advanceVersion } = setup()
    await session.handleWebviewMessage({ kind: 'ready' }, panel)
    const result = session.locateAndWait(panel, 4, new AbortController().signal)
    advanceVersion()
    messages.length = 0
    await session.handleWebviewMessage({ kind: 'ready' }, panel)
    expect(await result).toBe(false)
    expect(messages.some((m) => m.kind === 'view.locate')).toBe(false)
  })
})
