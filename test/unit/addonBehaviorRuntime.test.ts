// T07（#356）可组合输入行为——webview 页面级 runtime 链执行契约测试。
// 事实源 src/webview/addonBehaviors.ts。
//
// 契约口径（票面 + 技术方案 §5.2 + ADR-0012 Q27/Q29）：
// - 链按有效序依次调用适用行为，后续行为读到的快照含前序修饰结果；
//   前序产生文本变化不终止链（默认可组合）。
// - 每次修饰按行为自己的原子声明提交（history 透传 applyEdits），提交
//   由平台完成（行为不能直接写文档）。
// - 独占组：同组件内同组按有效序首个适用者生效，其后的同组行为跳过
//   （不调回调）；跨组件同组名不互斥。
// - 单项关闭经 applyHostState 即时生效；注册/注销即时反映（不经 CM6
//   Compartment 装配）。
// - onChanged 观察与输入修饰分开注册：观察者收到事件但无注册行为时
//   不发生任何提交（不能把 onChanged 变成第二写入口）。
// - 回调异常不断链（记日志继续）；拒绝（stale-snapshot 等）不断链；
//   快照不可得（实例销毁）终止整链。
// - 链在途时新输入不重入（计数器可观察）。
import { describe, expect, it, vi } from 'vitest'
import { AddonBehaviorRuntime } from '../../src/webview/addonBehaviors'
import type {
  AddonBehaviorRegistration,
  AddonInputContext,
} from '../../src/shared/addonBehaviors'
import type {
  AddonApplyEditsRequest, AddonApplyEditsResult, AddonSnapshotResult,
} from '../../src/shared/addonEditApi'

interface RuntimeHarness {
  runtime: AddonBehaviorRuntime
  snapshots: Array<{ text: string; revision: number }>
  submits: Array<{ addonId: string; opId: string; request: AddonApplyEditsRequest }>
  /** 推进文档状态（模拟前序修饰落地） */
  advanceTo: (text: string) => void
  rejectNext: (reason: AddonApplyEditsResult extends { ok: false; reason: infer R } ? R : never) => void
  logs: string[]
}

function createHarness(initialText = 'x'): RuntimeHarness {
  const snapshots: Array<{ text: string; revision: number }> = []
  const submits: RuntimeHarness['submits'] = []
  const logs: string[] = []
  let text = initialText
  let revision = 1
  let nextRejection: AddonApplyEditsResult | null = null
  const opSeq: Record<string, number> = {}
  const harness: RuntimeHarness = {
    runtime: new AddonBehaviorRuntime({
      snapshotOf: (): AddonSnapshotResult => {
        const snapshot = { text, selections: [{ anchor: text.length, head: text.length }], version: 3, revision }
        snapshots.push(snapshot)
        return { ok: true, snapshot }
      },
      applyEdit: (addonId, opId, _instanceId, request) => {
        submits.push({ addonId, opId, request })
        if (nextRejection !== null) {
          const rejection = nextRejection
          nextRejection = null
          return Promise.resolve(rejection)
        }
        // 模拟提交落地：按第一笔变更重写文本并推进修订
        const first = request.changes[0]!
        text = text.slice(0, first.offset) + first.text + text.slice(first.offset + first.length)
        revision += 1
        return Promise.resolve({ ok: true, credential: { opId, version: 3 } })
      },
      log: (stage, addonId, detail) => logs.push(`${stage}:${addonId}:${detail}`),
    }),
    snapshots, submits,
    advanceTo: (next) => {
      text = next
      revision += 1
    },
    rejectNext: (reason) => {
      nextRejection = { ok: false, reason }
    },
    logs,
  }
  // 预绑测试组件的 opId 分配器（装载器装载成功时注入；opId 体系同 T06）
  for (const addonId of ['pub.a', 'pub.b']) {
    opSeq[addonId] = 0
    harness.runtime.bindOpIdAllocator(addonId, () => `g1-op${++opSeq[addonId]!}`)
  }
  return harness
}

function registration(overrides: Partial<AddonBehaviorRegistration> & { id: string; name: string }): AddonBehaviorRegistration {
  return { onInput: () => null, ...overrides }
}

function plan(text: string, offset = 0, length = 0): { changes: Array<{ offset: number; length: number; text: string }> } {
  return { changes: [{ offset, length, text }] }
}

describe('T07 链执行：组合语义与前序结果', () => {
  it('两个行为共同运行：后续行为快照含前序修饰结果（读取前序结果）', async () => {
    const h = createHarness('word')
    const seenSnapshots: string[] = []
    h.runtime.register('pub.a', 1, registration({
      id: 'bracket', name: '括号',
      onInput: () => plan(')', 4),
    }))
    h.runtime.register('pub.b', 1, registration({
      id: 'space', name: '空格',
      onInput: (ctx: AddonInputContext) => {
        seenSnapshots.push(ctx.snapshot.text)
        return null
      },
    }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: '(' })
    // 默认序 pub.a#bracket 先：b 读到的快照已含 a 的修饰（word)）
    expect(seenSnapshots).toEqual(['word)'])
    expect(h.submits.map((s) => s.addonId)).toEqual(['pub.a'])
    // 文本变化不终止链：b 的回调仍被调用
  })

  it('每次修饰按自己的原子声明提交（history 透传）', async () => {
    const h = createHarness('word')
    h.runtime.register('pub.a', 1, registration({ id: 'a1', name: 'A1', history: 'joinPrevious', onInput: () => plan('x') }))
    h.runtime.register('pub.a', 1, registration({ id: 'a2', name: 'A2', onInput: () => plan('y') }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.map((s) => s.request.history)).toEqual(['joinPrevious', undefined])
  })

  it('提交端口收到快照修订标记与行为计划的变更', async () => {
    const h = createHarness('ab')
    h.runtime.register('pub.a', 1, registration({
      id: 'tidy', name: '整理',
      onInput: () => ({ changes: [{ offset: 1, length: 1, text: 'X' }], selection: { anchor: 2, head: 2 } }),
    }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'c' })
    expect(h.submits[0]!.request.revision).toBe(1)
    expect(h.submits[0]!.request.changes).toEqual([{ offset: 1, length: 1, text: 'X' }])
    expect(h.submits[0]!.request.selection).toEqual({ anchor: 2, head: 2 })
    expect(h.submits[0]!.opId).toMatch(/^g1-op1$/)
  })

  it('提交拒绝（stale-snapshot）不断链，后续行为继续', async () => {
    const h = createHarness('word')
    h.rejectNext('stale-snapshot')
    h.runtime.register('pub.a', 1, registration({ id: 'a1', name: 'A1', onInput: () => plan('1') }))
    h.runtime.register('pub.a', 1, registration({ id: 'a2', name: 'A2', onInput: () => plan('2') }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(2)
    expect(h.runtime.stats().counters.submitsRejected).toBe(1)
  })

  it('回调异常不断链（记日志），异常行为之后的仍执行', async () => {
    const h = createHarness('word')
    h.runtime.register('pub.a', 1, registration({
      id: 'boom', name: '炸',
      onInput: () => { throw new Error('behavior crashed') },
    }))
    h.runtime.register('pub.a', 1, registration({ id: 'ok', name: '好', onInput: () => plan('!') }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(1)
    expect(h.runtime.stats().counters.callbackErrors).toBe(1)
    expect(h.logs.some((entry) => entry.startsWith('behavior-callback-error'))).toBe(true)
  })

  it('快照不可得（实例销毁）终止整链', async () => {
    const h = createHarness('word')
    let broken = false
    let applyCalls = 0
    const runtime = new AddonBehaviorRuntime({
      snapshotOf: () => (broken ? { ok: false, reason: 'view-disposed' } : {
        ok: true, snapshot: { text: 'word', selections: [], version: 1, revision: 1 },
      }),
      applyEdit: (_a, opId) => {
        applyCalls++
        return Promise.resolve({ ok: true, credential: { opId, version: 1 } })
      },
      log: () => {},
    })
    runtime.bindOpIdAllocator('pub.a', () => 'g1-op1')
    runtime.register('pub.a', 1, registration({ id: 'a1', name: 'A1', onInput: () => plan('1') }))
    runtime.register('pub.a', 1, registration({ id: 'a2', name: 'A2', onInput: () => plan('2') }))
    const driven = runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    broken = true
    await driven
    // 首行为已提交（销毁标志在其 await 之后生效不回滚），第二行为因快照
    // 不可得不再执行
    expect(applyCalls).toBe(1)
    expect(h.submits.length).toBe(0)
  })

  it('链在途时新输入不重入（跳过计数）', async () => {
    // 提交端口延迟结算：制造「提交在途」窗口（行为回调是同步契约，链的
    // 异步窗口来自 applyEdits 的宿主往返）
    let releaseSubmit: (() => void) | undefined
    let opSeq = 0
    let submitted = 0
    const slowRuntime = new AddonBehaviorRuntime({
      snapshotOf: () => ({
        ok: true,
        snapshot: { text: 'word', selections: [], version: 1, revision: 1 },
      }),
      applyEdit: (_addonId, opId) => new Promise<{ ok: true; credential: { opId: string; version: number } }>((resolve) => {
        releaseSubmit = () => resolve({ ok: true, credential: { opId, version: 1 } })
      }),
      log: () => {},
    })
    slowRuntime.bindOpIdAllocator('pub.a', () => `g1-op${++opSeq}`)
    slowRuntime.register('pub.a', 1, registration({
      id: 'slow', name: '慢', onInput: () => { submitted++; return plan('?') },
    }))
    const first = slowRuntime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    await vi.waitFor(() => expect(releaseSubmit).toBeDefined())
    const second = slowRuntime.driveInput('main', { userEvent: 'input.type', inputText: 'j' })
    await second
    releaseSubmit!()
    await first
    expect(slowRuntime.stats().counters.drivesSkippedWhileRunning).toBe(1)
    expect(submitted).toBe(1)
  })
})

describe('T07 独占组', () => {
  it('同组按有效序首个适用者生效，其后同组行为不调回调', async () => {
    const h = createHarness('word')
    const called: string[] = []
    h.runtime.register('pub.a', 1, registration({
      id: 'b-first', name: '先', exclusiveGroup: 'fill',
      onInput: () => { called.push('b-first'); return plan('1') },
    }))
    h.runtime.register('pub.a', 1, registration({
      id: 'b-second', name: '后', exclusiveGroup: 'fill',
      onInput: () => { called.push('b-second'); return plan('2') },
    }))
    h.runtime.register('pub.a', 1, registration({
      id: 'free', name: '无组',
      onInput: () => { called.push('free'); return plan('3') },
    }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    // 组内只有首个适用者生效；组外行为不受影响（不恢复先接管者生效）
    expect(called).toEqual(['b-first', 'free'])
    expect(h.submits.map((s) => s.addonId)).toEqual(['pub.a', 'pub.a'])
  })

  it('首个适用者返回不处理时，同组后续行为接管', async () => {
    const h = createHarness('word')
    h.runtime.register('pub.a', 1, registration({
      id: 'pass', name: '让', exclusiveGroup: 'fill', onInput: () => null,
    }))
    h.runtime.register('pub.a', 1, registration({
      id: 'take', name: '接', exclusiveGroup: 'fill', onInput: () => plan('2'),
    }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(1)
    expect(h.submits[0]!.request.changes[0]!.text).toBe('2')
  })

  it('跨组件同组名不互斥', async () => {
    const h = createHarness('word')
    h.runtime.register('pub.a', 1, registration({ id: 'x', name: 'X', exclusiveGroup: 'fill', onInput: () => plan('1') }))
    h.runtime.register('pub.b', 1, registration({ id: 'y', name: 'Y', exclusiveGroup: 'fill', onInput: () => plan('2') }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(2)
  })
})

describe('T07 注册/注销与逐项开关', () => {
  it('重复局部 ID 拒绝；名称缺失拒绝（invalid-registration）；说明缺失允许', () => {
    const h = createHarness()
    expect(h.runtime.register('pub.a', 1, registration({ id: 'x', name: 'X' }))).toEqual({ ok: true, key: 'pub.a#x' })
    expect(h.runtime.register('pub.a', 1, registration({ id: 'x', name: 'X' }))).toEqual({ ok: false, reason: 'duplicate-id' })
    expect(h.runtime.register('pub.a', 1, registration({ id: 'y', name: '' }))).toEqual({ ok: false, reason: 'invalid-registration' })
    expect(h.runtime.register('pub.a', 1, { id: 'z', onInput: () => null } as never)).toEqual({ ok: false, reason: 'invalid-registration' })
  })

  it('注销组件清掉其全部行为；重装载（新代次）重新注册可用', async () => {
    const h = createHarness('word')
    h.runtime.register('pub.a', 1, registration({ id: 'x', name: 'X', onInput: () => plan('1') }))
    h.runtime.unregisterAddon('pub.a')
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(0)
    // 重装载：装载器再次绑定该组件的 opId 分配器后行为重新可用
    h.runtime.bindOpIdAllocator('pub.a', () => 'g2-op1')
    h.runtime.register('pub.a', 2, registration({ id: 'x', name: 'X', onInput: () => plan('1') }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(1)
    expect(h.submits[0]!.opId).toBe('g2-op1')
  })

  it('applyHostState 单项关闭即时生效：关闭项不再被调用，重开恢复', async () => {
    const h = createHarness('word')
    const called: string[] = []
    h.runtime.register('pub.a', 1, registration({ id: 'a1', name: 'A1', onInput: () => { called.push('a1'); return null } }))
    h.runtime.register('pub.a', 1, registration({ id: 'a2', name: 'A2', onInput: () => { called.push('a2'); return null } }))
    h.runtime.applyHostState({ version: 1, order: [], disabled: ['pub.a#a1'] })
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(called).toEqual(['a2'])
    h.runtime.applyHostState({ version: 1, order: ['pub.a#a2', 'pub.a#a1'], disabled: [] })
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(called).toEqual(['a2', 'a2', 'a1'])
  })

  it('用户覆盖顺序改变行为执行次序（调序即时生效）', async () => {
    const h = createHarness('word')
    const called: string[] = []
    h.runtime.register('pub.a', 1, registration({ id: 'a1', name: 'A1', onInput: () => { called.push('a1'); return null } }))
    h.runtime.register('pub.a', 1, registration({ id: 'a2', name: 'A2', onInput: () => { called.push('a2'); return null } }))
    h.runtime.applyHostState({ version: 1, order: ['pub.a#a2', 'pub.a#a1'], disabled: [] })
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(called).toEqual(['a2', 'a1'])
  })
})

describe('T07 通知分离', () => {
  it('onChanged 观察者收到输入事件（含快照），但无注册行为时不发生提交', async () => {
    const h = createHarness('word')
    const events: Array<{ userEvent: string; inputText: string; snapshotText: string }> = []
    h.runtime.onChanged((event) => {
      events.push({ userEvent: event.userEvent, inputText: event.inputText, snapshotText: event.snapshot.text })
    })
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: '(' })
    expect(events).toEqual([{ userEvent: 'input.type', inputText: '(', snapshotText: 'word' }])
    expect(h.submits.length).toBe(0)
  })

  it('观察者异常不影响链执行', async () => {
    const h = createHarness('word')
    h.runtime.onChanged(() => { throw new Error('observer crashed') })
    h.runtime.register('pub.a', 1, registration({ id: 'x', name: 'X', onInput: () => plan('1') }))
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: 'k' })
    expect(h.submits.length).toBe(1)
    expect(h.runtime.stats().counters.observerErrors).toBe(1)
  })
})

describe('T07 观测面', () => {
  it('stats 呈现注册清单（元数据无回调）、链执行轨迹与驱动计数', async () => {
    const h = createHarness('word')
    h.runtime.register('pub.a', 1, registration({
      id: 'bracket', name: '括号', description: '补全', exclusiveGroup: 'fill', history: 'joinPrevious',
      onInput: () => plan(')'),
    }))
    const stats0 = h.runtime.stats()
    expect(stats0.registrations).toEqual([{
      addonId: 'pub.a', id: 'bracket', name: '括号', description: '补全',
      exclusiveGroup: 'fill', history: 'joinPrevious',
    }])
    await h.runtime.driveInput('main', { userEvent: 'input.type', inputText: '(' })
    const stats1 = h.runtime.stats()
    expect(stats1.counters.drives).toBe(1)
    expect(stats1.trace).toEqual([
      { behaviorKey: 'pub.a#bracket', opId: 'g1-op1', outcome: 'ok' },
    ])
  })
})
