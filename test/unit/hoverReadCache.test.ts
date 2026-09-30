// 悬停读取缓存契约（#224 有界缓存，DocumentSession 级）：相同请求形态
// 合并读取（在途去重）与成功缓存、失败不缓存（保留重试语义）、按目标
// fsPath 反查失效（版本变更使缓存失效）、在途跨失效窗口的世代守卫
//（迟到完成不回写缓存——#208 图片代次守卫同构）、条目/字节双上限与
// 命中观测。读取端口与生产装配同形态（provider 注入的回调端口）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession, type HostDocumentPort } from '../../src/host/documentSession'
import {
  connectHoverEvents,
  HoverRefreshCoordinator,
  type HoverInvalidationStatus,
} from '../../src/host/hoverRefreshCoordinator'
import type { HoverReadOutcome } from '../../src/host/hoverDocAccess'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { HOVER_REFRESH_DEFAULTS } from '../../src/shared/hoverRefresh'

const DOC_URI = 'file:///d%3A/notes/a.md'
const B_PATH = 'D:\\notes\\b.md'

class StaticDoc implements HostDocumentPort {
  constructor(readonly content: string) {}
  get version(): number {
    return 1
  }
  getText(): string {
    return this.content
  }
  onDocChanged(): void {
    // 静态文档：本测试不驱动宿主文档变更
  }
  async applyChanges(): Promise<boolean> {
    return true
  }
  async undo(): Promise<boolean> {
    return false
  }
  async redo(): Promise<boolean> {
    return false
  }
}

interface Harness {
  session: DocumentSession
  panelId: string
  out: HostToWebview[]
  /** 读取端口触达计数（形态 → 次数） */
  reads: Map<string, number>
  send(msg: WebviewToHost): Promise<void>
}

function makeHarness(opts?: {
  outcome?: (target: string) => HoverReadOutcome
  cacheLimits?: { entryLimit?: number; byteLimit?: number }
}): Harness {
  const out: HostToWebview[] = []
  const reads = new Map<string, number>()
  const session = new DocumentSession(new StaticDoc('# A\n'), {
    docUri: DOC_URI,
    isWindowsHost: true,
    hoverReadCache: opts?.cacheLimits,
  })
  const panelId = session.attachPanel({
    send: (m) => out.push(m),
    readHoverTarget: (payload, report) => {
      const target = payload.directTarget
        ? `direct:${payload.directTarget.fsPath}`
        : payload.linkHref !== undefined
          ? `href:${payload.linkHref}`
          : `wikilink:${payload.target}`
      reads.set(target, (reads.get(target) ?? 0) + 1)
      const outcome: HoverReadOutcome = opts?.outcome
        ? opts.outcome(target)
        : {
            ok: true,
            fsPath: B_PATH,
            relPath: 'b.md',
            version: 3,
            lfText: '# B\n',
            range: { start: 0, end: 5 },
            scope: { kind: 'full' },
          }
      report(outcome)
    },
  })
  return {
    session,
    panelId,
    out,
    reads,
    send: async (msg) => {
      await session.handleWebviewMessage({ ...msg, sessionId: panelId, docUri: DOC_URI }, panelId)
    },
  }
}

async function ready(t: Harness): Promise<void> {
  await t.send({ kind: 'ready' })
}

function hoverRequest(reqId: number, instanceId: string, target = 'b'): WebviewToHost {
  return {
    kind: 'hover.request',
    sessionId: '',
    docUri: '',
    reqId,
    instanceId,
    sourceStart: 0,
    sourceEnd: 3,
    target,
  }
}

function resultsOf(t: Harness): Extract<HostToWebview, { kind: 'hover.result' }>[] {
  return t.out.filter((m): m is Extract<HostToWebview, { kind: 'hover.result' }> => m.kind === 'hover.result')
}

describe('悬停读取缓存：合并读取与命中', () => {
  it('并发相同形态合并读取：读取端口一次、两实例各得回包', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1'))
    await t.send(hoverRequest(2, 'hover-2'))
    expect(t.reads.get('wikilink:b')).toBe(1)
    expect(resultsOf(t)).toHaveLength(2)
    expect(resultsOf(t).map((r) => r.reqId)).toEqual([1, 2])
  })

  it('读取完成后同形态命中缓存：不再触达读取端口', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1'))
    await t.send(hoverRequest(2, 'hover-2'))
    expect(t.reads.get('wikilink:b')).toBe(1)
    const stats = t.session.hoverReadCacheStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.entries).toBe(1)
  })

  it('不同形态不合并（按规范目标与范围区分）', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1', 'b'))
    await t.send(hoverRequest(2, 'hover-2', 'sub/c'))
    expect(t.reads.get('wikilink:b')).toBe(1)
    expect(t.reads.get('wikilink:sub/c')).toBe(1)
  })

  it('失败不缓存：not-found 后重试重新触达读取端口', async () => {
    const t = makeHarness({
      outcome: () => ({ ok: false, reason: 'not-found' }),
    })
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1'))
    await t.send(hoverRequest(2, 'hover-2'))
    expect(t.reads.get('wikilink:b')).toBe(2)
    expect(t.session.hoverReadCacheStats().entries).toBe(0)
  })
})

describe('悬停读取缓存：失效与世代守卫', () => {
  it('invalidateHoverReads 按目标 fsPath 清缓存：后续请求重新读取', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1'))
    expect(t.reads.get('wikilink:b')).toBe(1)
    t.session.invalidateHoverReads(B_PATH)
    await t.send(hoverRequest(2, 'hover-2'))
    expect(t.reads.get('wikilink:b')).toBe(2)
  })

  it('fsPath 反查：多形态指向同一目标时一并失效', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1', 'b'))
    await t.send({
      ...hoverRequest(2, 'hover-2', 'b.md'),
      linkHref: 'b.md',
    } as WebviewToHost)
    expect(t.session.hoverReadCacheStats().entries).toBe(2)
    t.session.invalidateHoverReads(B_PATH)
    expect(t.session.hoverReadCacheStats().entries).toBe(0)
    await t.send(hoverRequest(3, 'hover-3', 'b'))
    await t.send({
      ...hoverRequest(4, 'hover-4', 'b.md'),
      linkHref: 'b.md',
    } as WebviewToHost)
    expect(t.reads.get('wikilink:b')).toBe(2)
    expect(t.reads.get('href:b.md')).toBe(2)
  })

  it('未命中目标 fsPath 的失效为零副作用', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'hover-1'))
    t.session.invalidateHoverReads('D:\\notes\\other.md')
    await t.send(hoverRequest(2, 'hover-2'))
    expect(t.reads.get('wikilink:b')).toBe(1) // 缓存仍在
  })

  it('在途跨失效窗口完成不回写缓存（世代守卫）：下一请求重新读取', async () => {
    const out: HostToWebview[] = []
    const reads = { count: 0 }
    const releaseRead: Array<(o: HoverReadOutcome) => void> = []
    const session = new DocumentSession(new StaticDoc('# A\n'), { docUri: DOC_URI, isWindowsHost: true })
    const panelId = session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        reads.count++
        releaseRead.push(report) // 挂起：由测试手动完成（构造在途窗口）
      },
    })
    const send = (msg: WebviewToHost) =>
      session.handleWebviewMessage({ ...msg, sessionId: panelId, docUri: DOC_URI }, panelId)
    await send({ kind: 'ready' })
    await send(hoverRequest(1, 'hover-1'))
    // 在途期间目标失效（外部改写已到达）
    session.invalidateHoverReads(B_PATH)
    releaseRead.pop()!({
      ok: true,
      fsPath: B_PATH,
      relPath: 'b.md',
      version: 3,
      lfText: '# B\n',
      range: { start: 0, end: 5 },
      scope: { kind: 'full' },
    })
    await new Promise((r) => setTimeout(r, 0))
    // 请求面板仍收到回包（webview 侧按 reqId/版本仲裁丢弃旧内容）
    expect(out.some((m) => m.kind === 'hover.result')).toBe(true)
    // 迟到完成不写缓存：下一请求重新读取
    await send(hoverRequest(2, 'hover-2'))
    expect(reads.count).toBe(2)
  })
})

describe('悬停读取缓存：双上限（条目与字节分别计量）', () => {
  it('条目上限：超出按插入序淘汰最早形态', async () => {
    const t = makeHarness({ cacheLimits: { entryLimit: 2 } })
    await ready(t)
    await t.send(hoverRequest(1, 'i1', 'a'))
    await t.send(hoverRequest(2, 'i2', 'b'))
    await t.send(hoverRequest(3, 'i3', 'c'))
    expect(t.session.hoverReadCacheStats().entries).toBe(2)
    // a 被淘汰：再请求 a 重新读取；b/c 仍在缓存命中（a 重入只淘汰 b——
    // 插入序语义，b 的命中证据在其重入之前取证）
    await t.send(hoverRequest(4, 'i4', 'b'))
    expect(t.reads.get('wikilink:b')).toBe(1)
    await t.send(hoverRequest(5, 'i5', 'a'))
    expect(t.reads.get('wikilink:a')).toBe(2)
    await t.send(hoverRequest(6, 'i6', 'c'))
    expect(t.reads.get('wikilink:c')).toBe(1)
  })

  it('字节上限：大文本写入触发淘汰（容量/内存有界）', async () => {
    const bigText = 'x'.repeat(600)
    const t = makeHarness({
      outcome: (target) => ({
        ok: true,
        fsPath: `D:\\notes\\${target.split(':').pop()}.md`,
        relPath: `${target.split(':').pop()}.md`,
        version: 1,
        lfText: target === 'wikilink:big' ? bigText : '# 小\n',
        range: { start: 0, end: target === 'wikilink:big' ? bigText.length : 4 },
        scope: { kind: 'full' },
      }),
      cacheLimits: { byteLimit: 1000 }, // big（600×2=1200 字节）单条即超限
    })
    await ready(t)
    await t.send(hoverRequest(1, 'i1', 'big'))
    expect(t.session.hoverReadCacheStats().entries).toBe(0) // 超限单条不入缓存
    await t.send(hoverRequest(2, 'i2', 'big'))
    expect(t.reads.get('wikilink:big')).toBe(2)
  })

  it('缺省上限与共享参数一致（集中定义不旁路）', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'i1', 'b'))
    const stats = t.session.hoverReadCacheStats()
    expect(stats.entryLimit).toBe(HOVER_REFRESH_DEFAULTS.cacheEntryLimit)
    expect(stats.byteLimit).toBe(HOVER_REFRESH_DEFAULTS.cacheByteLimit)
    expect(stats.bytes).toBeGreaterThan(0)
  })
})

// ---- 修 1（review 第二轮 P2）：事件路径无条件广播 session 级缓存失效 ----
// 缺陷链：缓存命中直接回包无版本比对 + 协调器 handleDocChanged/
// handleDiskEvent 以 registry.has(fsPath) 早退——浮层/卡片关闭（unwatch）
// 后目标被修改，事件被丢弃、缓存不失效，再悬停命中陈旧全文（且首载
// appliedVersion=-1 无法仲裁）。connectHoverEvents 是 provider 层两条事件
// 转发（onDidChangeTextDocument / vaultIndex.onTargetChange）的生产接线，
// 此处用真实协调器 + 真实 session 直驱钉住语义。
describe('事件接线（connectHoverEvents）：缓存失效不依赖订阅在场', () => {
  interface Wired {
    t: Harness
    coordinator: HoverRefreshCoordinator
    pushed: Array<{ sessionKeys: string[]; fsPath: string; status: HoverInvalidationStatus; generation: number }>
    events: ReturnType<typeof connectHoverEvents>
  }

  function makeWired(): Wired {
    const t = makeHarness()
    const pushed: Wired['pushed'] = []
    const coordinator = new HoverRefreshCoordinator({
      pushInvalidation: (sessionKeys, fsPath, status, generation) => {
        pushed.push({ sessionKeys: [...sessionKeys], fsPath, status, generation })
      },
    })
    const events = connectHoverEvents(coordinator, () => [t.session])
    return { t, coordinator, pushed, events }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('unwatch 后目标 docChanged：缓存仍被失效（再悬停重新读取），推送门控保持零推送', async () => {
    const w = makeWired()
    await ready(w.t)
    await w.t.send(hoverRequest(1, 'hover-1'))
    expect(w.t.reads.get('wikilink:b')).toBe(1)
    // 浮层/卡片在场与退场的生产序列：watch → unwatch（registry 清空）
    const sessionKey = `${DOC_URI}\n${w.t.panelId}`
    w.coordinator.watch(sessionKey, B_PATH, 'hover-1')
    w.coordinator.unwatch(sessionKey, B_PATH, 'hover-1')
    expect(w.coordinator.stats().targets).toBe(0)
    w.events.onDocChanged(B_PATH)
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(w.pushed).toEqual([]) // 未订阅零推送（门控不动）
    await w.t.send(hoverRequest(2, 'hover-2'))
    expect(w.t.reads.get('wikilink:b')).toBe(2) // 缓存已失效，读取端口重新触达
  })

  it('unwatch 后目标磁盘事件：同链路失效（changed/deleted 直通路径）', async () => {
    const w = makeWired()
    await ready(w.t)
    await w.t.send(hoverRequest(1, 'hover-1'))
    w.events.onDiskEvent(B_PATH, 'changed')
    expect(w.pushed).toEqual([]) // 未订阅零推送
    await w.t.send(hoverRequest(2, 'hover-2'))
    expect(w.t.reads.get('wikilink:b')).toBe(2)
  })

  it('订阅在场时事件照常推送（接线不改变推送语义）', async () => {
    const w = makeWired()
    await ready(w.t)
    w.coordinator.watch(`${DOC_URI}\n${w.t.panelId}`, B_PATH, 'hover-1')
    w.events.onDiskEvent(B_PATH, 'changed')
    expect(w.pushed).toHaveLength(1)
    expect(w.pushed[0]!.status).toBe('changed')
  })

  it('目标从未被读取过：事件到达零开销（无推送、无读取、无辅助登记）', async () => {
    const w = makeWired()
    await ready(w.t)
    w.events.onDocChanged('D:\\notes\\stranger.md')
    w.events.onDiskEvent('D:\\notes\\stranger.md', 'deleted')
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(w.pushed).toEqual([])
    expect([...w.t.reads.values()]).toEqual([])
    const stats = w.t.session.hoverReadCacheStats()
    expect(stats.entries).toBe(0)
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.invalidatedAtEntries).toBe(0) // 无在途读取：失效钟零登记
  })
})

// ---- 修 3（review 第二轮 P3）：辅助索引清理 ----
// hoverInvalidatedAt / hoverEpochs 只写不删会随事件广播无界积累：
// 失效钟条目仅在「有在途读取」时写入（消费方是读取完成回调的竞态补
// 校验），无在途时按目标清理；世代条目随缓存条目淘汰同步清理。
describe('辅助索引清理：失效钟与世代表不随事件无界积累', () => {
  it('quiescent 失效（有缓存反查）清缓存后不留失效钟条目', async () => {
    const t = makeHarness()
    await ready(t)
    await t.send(hoverRequest(1, 'i1'))
    expect(t.session.hoverReadCacheStats().entries).toBe(1)
    t.session.invalidateHoverReads(B_PATH) // 无在途读取
    expect(t.session.hoverReadCacheStats().entries).toBe(0)
    expect(t.session.hoverReadCacheStats().invalidatedAtEntries).toBe(0)
  })

  it('有在途读取时失效钟条目保留（竞态窗口守卫），下一次 quiescent 失效顺带清理', async () => {
    const out: HostToWebview[] = []
    const releaseRead: Array<(o: HoverReadOutcome) => void> = []
    const session = new DocumentSession(new StaticDoc('# A\n'), { docUri: DOC_URI, isWindowsHost: true })
    const panelId = session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        releaseRead.push(report) // 挂起：由测试手动完成（构造在途窗口）
      },
    })
    const send = (msg: WebviewToHost) =>
      session.handleWebviewMessage({ ...msg, sessionId: panelId, docUri: DOC_URI }, panelId)
    await send({ kind: 'ready' })
    await send(hoverRequest(1, 'hover-1'))
    session.invalidateHoverReads(B_PATH)
    expect(session.hoverReadCacheStats().invalidatedAtEntries).toBe(1) // 在途：保留
    releaseRead.pop()!({
      ok: true,
      fsPath: B_PATH,
      relPath: 'b.md',
      version: 3,
      lfText: '# B\n',
      range: { start: 0, end: 5 },
      scope: { kind: 'full' },
    })
    await new Promise((r) => setTimeout(r, 0))
    // 完成后条目仍在（等待下次失效顺带清理——无缓存反查时清）
    session.invalidateHoverReads(B_PATH)
    expect(session.hoverReadCacheStats().invalidatedAtEntries).toBe(0)
  })

  it('世代条目随缓存条目淘汰同步清理（LRU 淘汰路径挂钩）', async () => {
    const t = makeHarness({
      outcome: (target) => ({
        ok: true,
        fsPath: `D:\\notes\\${target.split(':').pop()}.md`,
        relPath: `${target.split(':').pop()}.md`,
        version: 1,
        lfText: '# t\n',
        range: { start: 0, end: 4 },
        scope: { kind: 'full' as const },
      }),
      cacheLimits: { entryLimit: 1 },
    })
    await ready(t)
    await t.send(hoverRequest(1, 'i1', 'b'))
    t.session.invalidateHoverReads('D:\\notes\\b.md') // 世代推进 + 缓存清
    expect(t.session.hoverReadCacheStats().epochEntries).toBe(1)
    await t.send(hoverRequest(2, 'i2', 'b')) // 重新读取入缓存（同形态键）
    expect(t.session.hoverReadCacheStats().entries).toBe(1)
    await t.send(hoverRequest(3, 'i3', 'c')) // entryLimit=1：淘汰 b 形态
    expect(t.session.hoverReadCacheStats().entries).toBe(1)
    expect(t.session.hoverReadCacheStats().epochEntries).toBe(0) // 淘汰同步清理
  })
})
