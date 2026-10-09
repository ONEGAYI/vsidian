// @vitest-environment jsdom
// P2-02（#279）Live 实例上下文契约：主正文提炼出的最小可复用入口。
// - 两个实例并存：选区、滚动、编辑派发目标与释放互不影响；销毁一个
//   不释放另一份编辑器（票据验收第 2 条）。
// - 实例依赖经构造注入（出站 / 持久化时机 / 资源来源 / 模式门控），
//   不默认读取 this.view 或唯一全局编辑器/桥状态（验收第 4 条的失败
//   契约：改造前不存在该入口，本文件导入即红）。
// - 主正文走新入口后：根面板只创建一套 chrome 与单份编辑器，一次输入
//   只派发一笔 edit.request（不重复注册监听/双重消费，验收第 3 条）。
import { afterEach, describe, expect, it } from 'vitest'
import { LiveEditorInstance, type LiveEditorInstanceDeps } from '../../src/webview/liveInstance'
import { addonInstanceIdField } from '../../src/webview/addonViewIdentity'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { ImageResourceManager } from '../../src/webview/imageResource'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function makeDeps(sent: WebviewToHost[], persistCount: { n: number } = { n: 0 }): LiveEditorInstanceDeps {
  return {
    send: (message) => sent.push(message),
    persistState: () => {
      persistCount.n += 1
    },
    images: new ImageResourceManager({
      isDirectSrc: () => false,
      requestHost: () => {},
    }),
    isLiveActive: () => true,
    initialDark: false,
  }
}

/** 挂一个实例到独立容器并完成会话绑定 + 全文装载（init 等价路径） */
function mountInstance(
  sent: WebviewToHost[],
  sessionId: string,
  text: string,
  persistCount?: { n: number },
): { instance: LiveEditorInstance; host: HTMLElement } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const instance = new LiveEditorInstance(host, makeDeps(sent, persistCount))
  instance.setSession(sessionId, `file:///${sessionId}.md`)
  instance.handleFullSync(1, text, {})
  return { instance, host }
}

function editRequests(sent: readonly WebviewToHost[]) {
  return sent.filter((m) => m.kind === 'edit.request') as Extract<WebviewToHost, { kind: 'edit.request' }>[]
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Live 实例上下文：两实例并存互不影响（#279 验收 2）', () => {
  it('编辑意图只派发给所属实例的目标会话，另一实例文本不动', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const persistA = { n: 0 }
    const a = mountInstance(sentA, 'sess-a', 'alpha', persistA).instance
    const b = mountInstance(sentB, 'sess-b', 'beta').instance

    a.view!.dispatch({ changes: { from: 5, insert: 'X' } })

    const reqs = editRequests(sentA)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.sessionId).toBe('sess-a')
    expect(reqs[0]!.changes).toEqual([{ offset: 5, length: 0, text: 'X' }])
    expect(editRequests(sentB)).toHaveLength(0)
    expect(b.view!.state.doc.toString()).toBe('beta')
    // 实例不落全局桥状态：seq 推进经 deps.persistState 透出时机
    expect(persistA.n).toBeGreaterThan(0)
  })

  it('外部增量只应用到所属实例文档', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const a = mountInstance(sentA, 'sess-a', 'alpha').instance
    const b = mountInstance(sentB, 'sess-b', 'beta').instance

    b.handleDocChanged({ kind: 'doc.changed', version: 2, origin: 'external', changes: [{ offset: 4, length: 0, text: '!' }] })

    expect(b.view!.state.doc.toString()).toBe('beta!')
    expect(a.view!.state.doc.toString()).toBe('alpha')
    // 外部同步零回发：不因应用增量产生新的 edit.request
    expect(editRequests(sentA)).toHaveLength(0)
    expect(editRequests(sentB)).toHaveLength(0)
  })

  it('选区与滚动互不影响', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const a = mountInstance(sentA, 'sess-a', 'alpha').instance
    const b = mountInstance(sentB, 'sess-b', 'beta').instance

    a.view!.dispatch({ selection: { anchor: 3 } })
    a.view!.scrollDOM.scrollTop = 42

    expect(a.view!.state.selection.main.head).toBe(3)
    expect(b.view!.state.selection.main.head).toBe(0)
    expect(b.view!.scrollDOM.scrollTop).toBe(0)
  })

  it('销毁一个实例不释放另一份编辑器', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const a = mountInstance(sentA, 'sess-a', 'alpha')
    const b = mountInstance(sentB, 'sess-b', 'beta')

    a.instance.destroy()

    expect(a.host.querySelector('.cm-editor')).toBeNull()
    expect(b.host.querySelector('.cm-editor')).not.toBeNull()
    // 幸存实例的编辑链路完整：dispatch → 出站仍按其会话派发
    b.instance.view!.dispatch({ changes: { from: 4, insert: 'Y' } })
    const reqs = editRequests(sentB)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.sessionId).toBe('sess-b')
  })
})

describe('主正文走新入口：根 chrome 单份、输入不双重消费（#279 验收 1/3）', () => {
  it('控制器挂载后单套 chrome 与单份编辑器，一次输入只出一笔 edit.request', () => {
    const sent: WebviewToHost[] = []
    const bridge: VsCodeBridge = {
      postMessage: (m) => sent.push(m as WebviewToHost),
      getState: () => undefined,
      setState: () => {},
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const c = new WebviewSyncController(bridge)
    c.mount(host)
    c.handleHostMessage({
      kind: 'init', sessionId: 's1', docUri: 'file:///main.md', version: 1, text: '正文内容',
    })

    expect(document.querySelectorAll('.cm-editor')).toHaveLength(1)
    expect(document.querySelectorAll('.vsidian-body')).toHaveLength(1)
    expect(document.querySelectorAll('.vsidian-toolbar')).toHaveLength(1)

    const before = sent.length
    c.getView()!.dispatch({ changes: { from: 2, insert: '字' } })
    const reqs = editRequests(sent.slice(before))
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.changes).toEqual([{ offset: 2, length: 0, text: '字' }])
    c.dispose()
  })
})


describe('T06 SDK 编辑面（#355）：快照/applyEdits/凭据结算', () => {
  it('快照含文本/多选区/版本/修订标记；输入与外部同步都推进修订', () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    const snap0 = instance.snapshotForAddon()!
    expect(snap0.text).toBe('alpha')
    expect(snap0.version).toBe(1)
    expect(snap0.revision).toBeGreaterThan(0)

    instance.view!.dispatch({ selection: { anchor: 1, head: 3 } })
    instance.view!.dispatch({ changes: { from: 5, insert: 'X' } })
    const snap1 = instance.snapshotForAddon()!
    expect(snap1.text).toBe('alphaX')
    expect(snap1.revision).toBe(snap0.revision + 1)
    expect(snap1.selections[0]).toEqual({ anchor: 1, head: 3 })

    instance.handleDocChanged({ kind: 'doc.changed', version: 2, origin: 'external', changes: [{ offset: 0, length: 0, text: 'Z' }] })
    const snap2 = instance.snapshotForAddon()!
    expect(snap2.text).toBe('ZalphaX')
    expect(snap2.revision).toBe(snap1.revision + 1)
  })

  it('applyEdits 原子事务：出站携带 origin、ack ok 结算凭据（version 对位）', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    const revision = instance.snapshotForAddon()!.revision
    const promise = instance.applyAddonEdit({
      request: { revision, changes: [{ offset: 0, length: 0, text: 'Hi ' }], selection: { anchor: 3, head: 3 } },
      origins: [{ addonId: 'pub.addon', opId: 'op-1', undo: 'atomic' }],
    })
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.origin).toEqual({ addonId: 'pub.addon', opId: 'op-1', undo: 'atomic' })
    expect(instance.view!.state.doc.toString()).toBe('Hi alpha')
    expect(instance.view!.state.selection.main.head).toBe(3)
    instance.handleEditAck({ kind: 'edit.ack', seq: reqs[0]!.seq, ok: true, version: 2 })
    const result = await promise
    expect(result).toEqual({ ok: true, credential: { opId: 'op-1', version: 2 } })
  })

  it('多范围一笔 = 一笔 edit.request（一个 origin）', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'abcdef')
    const revision = instance.snapshotForAddon()!.revision
    const promise = instance.applyAddonEdit({
      request: { revision, changes: [{ offset: 0, length: 1, text: 'X' }, { offset: 5, length: 1, text: 'Y' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-m', undo: 'atomic' }],
    })
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.changes).toHaveLength(2)
    instance.handleEditAck({ kind: 'edit.ack', seq: reqs[0]!.seq, ok: true, version: 2 })
    expect((await promise).ok).toBe(true)
  })

  it('旧快照拒绝 stale-snapshot；非法边界拒绝 invalid-request；零变更直接凭据', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    const stale = instance.snapshotForAddon()!.revision
    instance.view!.dispatch({ changes: { from: 0, insert: 'u' } })
    const req0 = editRequests(sent)[0]!
    instance.handleEditAck({ kind: 'edit.ack', seq: req0.seq, ok: true, version: 2 })
    const staleResult = await instance.applyAddonEdit({
      request: { revision: stale, changes: [{ offset: 0, length: 0, text: 'x' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-s', undo: 'atomic' }],
    })
    expect(staleResult).toEqual({ ok: false, reason: 'stale-snapshot' })

    const revision = instance.snapshotForAddon()!.revision
    const bad = await instance.applyAddonEdit({
      request: { revision, changes: [{ offset: 99, length: 0, text: 'x' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-b', undo: 'atomic' }],
    })
    expect(bad).toEqual({ ok: false, reason: 'invalid-request' })
    expect(editRequests(sent)).toHaveLength(1)

    const zero = await instance.applyAddonEdit({
      request: { revision, changes: [], selection: { anchor: 1, head: 1 } },
      origins: [{ addonId: 'pub.addon', opId: 'op-z', undo: 'atomic' }],
    })
    expect(zero.ok).toBe(true)
    expect(editRequests(sent)).toHaveLength(1) // 零文本变更不出站
    expect(instance.view!.state.selection.main.head).toBe(1)
  })

  it('业务拒绝（history-boundary）：凭据拒绝、本地回滚、不进暂停', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    const revision = instance.snapshotForAddon()!.revision
    const promise = instance.applyAddonEdit({
      request: { revision, changes: [{ offset: 0, length: 0, text: 'X' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-h', undo: 'joinPrevious' }],
    })
    const req = editRequests(sent)[0]!
    instance.handleEditAck({
      kind: 'edit.ack', seq: req.seq, ok: false, reason: 'conflict', version: 1, text: 'alpha',
      originRejection: 'history-boundary',
    })
    expect(await promise).toEqual({ ok: false, reason: 'history-boundary' })
    expect(instance.view!.state.doc.toString()).toBe('alpha')
    instance.view!.dispatch({ changes: { from: 5, insert: '!' } })
    expect(editRequests(sent)).toHaveLength(2)
  })

  it('暂停拒绝 applyEdits（suspended）', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    instance.view!.dispatch({ changes: { from: 5, insert: 'X' } })
    const req0 = editRequests(sent)[0]!
    instance.handleEditAck({ kind: 'edit.ack', seq: req0.seq, ok: false, reason: 'conflict', version: 1, text: 'alphaX' })
    const revision = instance.snapshotForAddon()!.revision
    const rejected = await instance.applyAddonEdit({
      request: { revision, changes: [{ offset: 0, length: 0, text: 'Y' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-p', undo: 'atomic' }],
    })
    expect(rejected).toEqual({ ok: false, reason: 'suspended' })
    instance.destroy()
    expect(instance.snapshotForAddon()).toBeNull()
  })

  it('destroy 终结在途凭据；setSelection/reveal 零出站', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    const revision = instance.snapshotForAddon()!.revision
    const promise = instance.applyAddonEdit({
      request: { revision, changes: [{ offset: 0, length: 0, text: 'X' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-d', undo: 'atomic' }],
    })
    instance.destroy()
    expect(await promise).toEqual({ ok: false, reason: 'view-disposed' })

    const { instance: alive } = mountInstance(sent, 'sess-b', 'beta')
    expect(alive.setSelectionForAddon([{ anchor: 2, head: 2 }])).toBe(true)
    expect(alive.setSelectionForAddon([{ anchor: 99, head: 99 }])).toBe(false)
    expect(alive.revealForAddon(2)).toBe(true)
    expect(alive.revealForAddon(-1)).toBe(false)
    expect(editRequests(sent).filter((r) => r.sessionId === 'sess-b')).toHaveLength(0)
  })

  it('暂缓窗口的同组未提交合并：atomic 开新段、joinPrevious 并入同段成一笔数组 origin', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    // 制造暂缓窗口：组合中输入（暂缓集非空、deferredLocal 在场）
    instance.view!.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    instance.view!.dispatch({ changes: { from: 5, insert: 'U' } })
    // SDK atomic 提交落在暂缓段（不并入用户输入段）
    const revA = instance.snapshotForAddon()!.revision
    const promiseA = instance.applyAddonEdit({
      request: { revision: revA, changes: [{ offset: 0, length: 0, text: 'A' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' }],
    })
    // SDK joinPrevious 提交：并入同组段（合并笔）
    const revB = instance.snapshotForAddon()!.revision
    const promiseB = instance.applyAddonEdit({
      request: { revision: revB, changes: [{ offset: 1, length: 0, text: 'B' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-b', undo: 'joinPrevious' }],
    })
    expect(editRequests(sent)).toHaveLength(0) // 暂缓窗口：都未出站
    // 组合结束 → flush：段序出站（队首用户段先出，ack 后合并段出站）
    instance.view!.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    await new Promise((r) => setTimeout(r, 60))
    const reqs = editRequests(sent)
    expect(reqs.length).toBeGreaterThanOrEqual(1)
    expect(reqs[0]!.origin).toBeUndefined() // 组合期用户输入段（无来源）
    instance.handleEditAck({ kind: 'edit.ack', seq: reqs[0]!.seq, ok: true, version: 2 })
    await new Promise((r) => setTimeout(r, 30))
    const merged = editRequests(sent).find((r) => Array.isArray(r.origin))
    expect(merged).toBeDefined()
    expect(merged!.origin).toEqual([
      { addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' },
      { addonId: 'pub.addon', opId: 'op-b', undo: 'joinPrevious' },
    ])
    instance.handleEditAck({ kind: 'edit.ack', seq: merged!.seq, ok: true, version: 3 })
    expect((await promiseA).ok).toBe(true)
    expect((await promiseB).ok).toBe(true)
  })

  it('跨组件 joinPrevious 不并入他组段：逐段独立出站（同组件约束）', async () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-a', 'alpha')
    instance.view!.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    instance.view!.dispatch({ changes: { from: 5, insert: 'U' } })
    const revA = instance.snapshotForAddon()!.revision
    const promiseA = instance.applyAddonEdit({
      request: { revision: revA, changes: [{ offset: 0, length: 0, text: 'A' }] },
      origins: [{ addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' }],
    })
    // 他组件 joinPrevious：不得并入 pub.addon 组首段
    const revB = instance.snapshotForAddon()!.revision
    const promiseB = instance.applyAddonEdit({
      request: { revision: revB, changes: [{ offset: 1, length: 0, text: 'B' }] },
      origins: [{ addonId: 'pub.other', opId: 'op-b', undo: 'joinPrevious' }],
    })
    instance.view!.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    await new Promise((r) => setTimeout(r, 60))
    const reqs = editRequests(sent)
    expect(reqs[0]!.origin).toBeUndefined()
    instance.handleEditAck({ kind: 'edit.ack', seq: reqs[0]!.seq, ok: true, version: 2 })
    await new Promise((r) => setTimeout(r, 30))
    // 段序串行：atomic 段先出站，ack 后 joinPrevious 段再出（两笔独立）
    const first = editRequests(sent).filter((r) => r.origin !== undefined)
    expect(first).toHaveLength(1)
    expect(first[0]!.origin).toEqual({ addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' })
    instance.handleEditAck({ kind: 'edit.ack', seq: first[0]!.seq, ok: true, version: 3 })
    await new Promise((r) => setTimeout(r, 30))
    const second = editRequests(sent).filter((r) => r.origin !== undefined)
    expect(second).toHaveLength(2)
    expect(second[1]!.origin).toEqual({ addonId: 'pub.other', opId: 'op-b', undo: 'joinPrevious' })
    instance.handleEditAck({ kind: 'edit.ack', seq: second[1]!.seq, ok: true, version: 4 })
    expect((await promiseA).ok).toBe(true)
    expect((await promiseB).ok).toBe(true)
  })
})

describe('#426 实例身份 field（view → instanceId 反查基座）', () => {
  it('setAddonBehaviorIdentity 把实例 ID 写进 view state；注册前为 null', () => {
    const sent: WebviewToHost[] = []
    const { instance } = mountInstance(sent, 'sess-identity', '# 标题\n\n正文')
    // 注册前：身份未知（null——SDK 反查面据此判「非平台实例或未注册」）
    expect(instance.view!.state.field(addonInstanceIdField, false)).toBeNull()
    instance.setAddonBehaviorIdentity('main')
    expect(instance.view!.state.field(addonInstanceIdField, false)).toBe('main')
    // 重复告知以新代旧（实例重建场景的注册方口径）
    instance.setAddonBehaviorIdentity('embed:h1')
    expect(instance.view!.state.field(addonInstanceIdField, false)).toBe('embed:h1')
  })
})
