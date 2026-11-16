import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())

describe('HTML 资源请求的失效与代次', () => {
  it('R17：全量刷新按条目数线性检查，并为同 raw 的不同来源各重发一次', async () => {
    const hub = await import('../../src/webview/htmlResourceHub')
    const requests: number[] = []
    hub.registerHtmlResourcePort({
      session: () => ({ sessionId: 's', docUri: 'A' }),
      send: (message) => { if (message.kind === 'htmlResource.request') requests.push(message.reqId) },
    })
    const releases: Array<() => void> = []
    const count = 100
    for (let i = 0; i < count; i++) {
      releases.push(hub.subscribeHtmlResource(`${i}.png`, () => undefined))
      releases.push(hub.subscribeHtmlResource(`${i}.png`, () => undefined, 'B'))
    }
    requests.length = 0
    // 工作量观测而非耗时阈值：输入集合的成员检查不得随条目数平方增长。
    const membership = vi.spyOn(Set.prototype, 'has')
    hub.invalidateAllHtmlResources()
    const checks = membership.mock.calls.length
    membership.mockRestore()
    expect(requests).toHaveLength(count * 2)
    expect(checks).toBeLessThanOrEqual(count * 4)
    for (const release of releases) release()
    for (const reqId of requests) hub.notifyHtmlResourceResult({ reqId, ok: false })
    expect(hub.htmlResourceHubEntries()).toEqual([])
  })

  it('R08：在途失效重发新请求，旧成功/失败回包均不得落地', async () => {
    const hub = await import('../../src/webview/htmlResourceHub')
    const requests: Array<{ reqId: number; url: string; sourceDocUri?: string }> = []
    hub.registerHtmlResourcePort({
      session: () => ({ sessionId: 's', docUri: 'A' }),
      send: (message) => { if (message.kind === 'htmlResource.request') requests.push(message) },
    })
    const applyA = vi.fn()
    const applyB = vi.fn()
    const releaseA = hub.subscribeHtmlResource('photo.png', applyA)
    const releaseB = hub.subscribeHtmlResource('photo.png', applyB, 'B')
    const old = [...requests]
    hub.notifyHtmlResourceInvalidate(['photo.png'])
    expect(requests).toHaveLength(4)
    hub.notifyHtmlResourceResult({ reqId: old[0]!.reqId, ok: true, url: 'old' })
    hub.notifyHtmlResourceResult({ reqId: old[1]!.reqId, ok: false })
    expect(applyA).not.toHaveBeenCalled()
    expect(applyB).not.toHaveBeenCalled()
    hub.notifyHtmlResourceResult({ reqId: requests[2]!.reqId, ok: true, url: 'new-A' })
    hub.notifyHtmlResourceResult({ reqId: requests[3]!.reqId, ok: true, url: 'new-B' })
    expect(applyA).toHaveBeenCalledExactlyOnceWith({ ok: true, url: 'new-A' })
    expect(applyB).toHaveBeenCalledExactlyOnceWith({ ok: true, url: 'new-B' })
    releaseA()
    releaseB()
    expect(hub.htmlResourceHubEntries()).toEqual([])
  })
})
