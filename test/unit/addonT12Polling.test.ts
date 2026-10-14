import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../../src/shared/addonPage'

// 执行完整T12页面入口，在公开defineAddonPage/channel.request边界提供SDK。
const pageCode = buildSync({
  entryPoints: [fileURLToPath(new URL('../fixtures/addon-v02/addon/t12Editor.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['vsidian-addon-sdk'],
}).outputFiles[0].text

function mountPage() {
  let factory!: (sdk: VsidianAddonPageSdk) => unknown
  runInNewContext(pageCode, {
    setTimeout,
    require: () => ({ defineAddonPage: (id: string, entry: typeof factory) => {
      expect(id).toBe('vsidian-test-fixture.addon-t12')
      factory = entry
    } }),
  })
  const pending: Array<{ topic: string; reply: (outcome: AddonChannelOutcome) => void }> = []
  const requests: Array<{ topic: string; payload: unknown }> = []
  const disposals: Array<() => void> = []
  factory({
    views: {}, behaviors: {}, commands: {}, ui: {}, renderers: {},
    channel: { request: (topic: string, payload: unknown) => {
      requests.push({ topic, payload })
      return new Promise<AddonChannelOutcome>(reply => pending.push({ topic, reply }))
    } },
    onDispose: (callback: () => void) => disposals.push(callback),
  } as unknown as VsidianAddonPageSdk)
  return {
    nextCount: () => requests.filter(request => request.topic === 't12.next').length,
    requests,
    reply(topic: string, result: unknown) {
      const index = pending.findIndex(request => request.topic === topic)
      expect(index).toBeGreaterThanOrEqual(0)
      pending.splice(index, 1)[0].reply({ ok: true, result })
    },
    dispose() {
      for (const callback of disposals.splice(0)) callback()
      for (const request of pending.splice(0)) request.reply({ ok: false, reason: 'released' })
    },
  }
}

describe('T12页面空轮询节奏', () => {
  it('无命令回包后等待100ms再查询，不立即再次请求', async () => {
    vi.useFakeTimers()
    const page = mountPage()
    try {
      page.reply('t12.contributionsAllowed', { allowed: false, arm: null })
      await vi.advanceTimersByTimeAsync(0)
      expect(page.nextCount()).toBe(1)
      page.reply('t12.next', { command: null, arm: null })
      await vi.advanceTimersByTimeAsync(0)
      expect(page.nextCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(99)
      expect(page.nextCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(page.nextCount()).toBe(2)
    } finally {
      page.dispose()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('有命令时立即处理结果并继续查询，不加入空轮询延迟', async () => {
    vi.useFakeTimers()
    const page = mountPage()
    try {
      page.reply('t12.contributionsAllowed', { allowed: false, arm: null })
      await vi.advanceTimersByTimeAsync(0)
      page.reply('t12.next', { command: { seq: 7, op: 'ping' }, arm: null })
      await vi.advanceTimersByTimeAsync(0)
      expect(page.requests).toContainEqual({ topic: 't12.result', payload: { seq: 7, outcome: { pong: true } } })
      expect(page.nextCount()).toBe(2)
    } finally {
      page.dispose()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('等待空轮询间隔时释放页面，计时到期后不再出站', async () => {
    vi.useFakeTimers()
    const page = mountPage()
    try {
      page.reply('t12.contributionsAllowed', { allowed: false, arm: null })
      await vi.advanceTimersByTimeAsync(0)
      page.reply('t12.next', { command: null, arm: null })
      await vi.advanceTimersByTimeAsync(0)
      page.dispose()
      await vi.advanceTimersByTimeAsync(100)
      expect(page.nextCount()).toBe(1)
    } finally {
      page.dispose()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
