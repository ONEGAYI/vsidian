import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { DocumentSession, type HostDocumentPort } from '../../src/host/documentSession'
import { isHostToWebview, isWebviewToHost, type HostToWebview, type PasteStage, type SerChange } from '../../src/shared/protocol'

const stage = (kind: 'text' | 'format'): PasteStage => ({ group: 'group-1', stage: kind, hasTextStep: true,
  before: { ranges: [{ anchor: 0, head: 3 }], mainIndex: 0 }, after: { ranges: [{ anchor: 3, head: 3 }], mainIndex: 0 } })
function serialize(changes: ChangeSet) {
  const result: SerChange[] = []
  changes.iterChanges((from, to, _b, _e, inserted) => result.push({ offset: from, length: to - from, text: inserted.toString() }))
  return result
}
describe('粘贴阶段元数据通过宿主实际事件回流', () => {
  it('两个面板看同一真正Undo/Redo原因；重复ACK不重登记，原生回流不回声写入', async () => {
    let text = Text.of(['旧内容']), version = 1
    const records: { forward: ChangeSet; inverse: ChangeSet }[] = [], redo: typeof records = []
    let session: DocumentSession
    const change = (cs: ChangeSet, reason?: 'undo' | 'redo') => { text = cs.apply(text); session.handleDocChanged(serialize(cs), ++version, reason) }
    const doc: HostDocumentPort = {
      get version() { return version }, getText: () => text.toString(),
      async applyChanges(changes) {
        const cs = ChangeSet.of(changes.map(c => ({ from: c.offset, to: c.offset + c.length, insert: c.text })), text.length)
        records.push({ forward: cs, inverse: cs.invert(text) }); redo.length = 0; change(cs); return true
      },
      async undo() { const item = records.pop(); if (!item) return false; redo.push(item); change(item.inverse, 'undo'); return true },
      async redo() { const item = redo.pop(); if (!item) return false; records.push(item); change(item.forward, 'redo'); return true },
    }
    session = new DocumentSession(doc, { docUri: 'file:///a.md' })
    const send = (id: string, message: unknown) => session.handleWebviewMessage(message, id)
    const a: HostToWebview[] = [], b: HostToWebview[] = []
    const owner = session.attachPanel({ send: m => a.push(m) }), peer = session.attachPanel({ send: m => b.push(m) })
    await send(owner, { kind: 'ready' }); await send(peer, { kind: 'ready' })
    const request = { kind: 'edit.request' as const, sessionId: owner, docUri: 'file:///a.md', seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 3, text: '新内容' }], paste: stage('text') }
    await send(owner, request); await send(owner, request)
    await send(owner, { ...request, seq: 2, baseVersion: 2, changes: [{ offset: 0, length: 3, text: '**新内容**' }], paste: stage('format') })
    expect(records).toHaveLength(2)
    await send(owner, { kind: 'history.request', op: 'undo' })
    expect(text.toString()).toBe('新内容')
    expect(a.at(-1)).toMatchObject({ kind: 'doc.changed', reason: 'undo', paste: { stage: 'format', sessionId: owner, group: 'group-1' } })
    expect(b.at(-1)).toEqual(a.at(-1))
    await send(owner, { kind: 'history.request', op: 'undo' })
    expect(text.toString()).toBe('旧内容'); expect(a.at(-1)).toMatchObject({ paste: { stage: 'text' } })
    await send(owner, { kind: 'history.request', op: 'redo' }); await send(owner, { kind: 'history.request', op: 'redo' })
    expect(text.toString()).toBe('**新内容**'); expect(a.at(-1)).toMatchObject({ reason: 'redo', paste: { stage: 'format' } })
    session.dispose()
  })
  it('协议拒绝不完整阶段、非法选区和伪原因，兼容无元数据的旧消息', () => {
    const message = { kind: 'edit.request', sessionId: 's', docUri: 'd', seq: 1, baseVersion: 1, changes: [{ offset: 0, length: 0, text: 'x' }] }
    expect(isWebviewToHost(message)).toBe(true)
    expect(isWebviewToHost({ ...message, paste: stage('text') })).toBe(true)
    expect(isWebviewToHost({ ...message, paste: { ...stage('text'), before: { ranges: [], mainIndex: 0 } } })).toBe(false)
    expect(isWebviewToHost({ ...message, paste: { ...stage('text'), stage: 'unknown' } })).toBe(false)
    const changed = { kind: 'doc.changed', version: 2, origin: 'external', changes: [] }
    expect(isHostToWebview(changed)).toBe(true)
    expect(isHostToWebview({ ...changed, reason: 'keypress' })).toBe(false)
  })
})
