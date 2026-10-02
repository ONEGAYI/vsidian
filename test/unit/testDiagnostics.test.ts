import { expect, it } from 'vitest'
import { DIAGNOSTIC_LIMIT, isDiagnosticSnapshot, recordDiagnosticMessage, TestDiagnostics } from '../../src/shared/testDiagnostics'
import { isHostToWebview, isWebviewToHost } from '../../src/shared/protocol'

it('诊断默认关闭，显式启用后保留有序阶段与时间', () => {
  const trace = new TestDiagnostics(() => 123)
  trace.record('ignored')
  expect(trace.snapshot()).toEqual({ events: [], dropped: 0 })
  trace.reset(true)
  trace.record('hover.request', { reqId: 3 })
  expect(trace.snapshot()).toEqual({ events: [{ seq: 1, at: 123, stage: 'hover.request', data: { reqId: 3 } }], dropped: 0 })
})

it('诊断有界，快照修改不污染原始证据，重置后不带上轮事件', () => {
  const trace = new TestDiagnostics(() => 1)
  trace.reset(true)
  for (let i = 0; i < DIAGNOSTIC_LIMIT + 2; i++) trace.record('event', { i })
  const snapshot = trace.snapshot()
  expect(snapshot.events).toHaveLength(DIAGNOSTIC_LIMIT)
  expect(snapshot.dropped).toBe(2)
  expect(snapshot.events[0]!.data.i).toBe(2)
  snapshot.events[0]!.data.i = -1
  expect(trace.snapshot().events[0]!.data.i).toBe(2)
  trace.reset(false)
  expect(trace.snapshot()).toEqual({ events: [], dropped: 0 })
})

it('消息采样只保留传播字段，不记录正文、修改文本或资源 URL', () => {
  const trace = new TestDiagnostics(() => 1)
  trace.reset(true)
  recordDiagnosticMessage(trace, 'host.send', { kind: 'hover.result', reqId: 2, instanceId: 'card',
    ok: true, version: 3, text: 'PRIVATE_TEXT', uri: 'https://secret',
    target: { fsPath: '/target.md', relPath: 'target.md' } })
  expect(trace.snapshot().events[0]!.data).toEqual({ reqId: 2, instanceId: 'card', ok: true, version: 3, fsPath: '/target.md' })
  expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE_TEXT')
  expect(JSON.stringify(trace.snapshot())).not.toContain('secret')
  trace.record('bounded', { long: 'x'.repeat(1000) })
  expect(trace.snapshot().events[1]!.data.long).toHaveLength(192)
})

it('协议拒绝无界或非法诊断载荷，保持旧 view.state 向后兼容', () => {
  const view = { kind: 'view.state', text: '', docLength: 0, lineCount: 1, renderedLines: 0 }
  expect(isWebviewToHost(view)).toBe(true)
  expect(isHostToWebview({ kind: 'diagnostics.test.set', enabled: true })).toBe(true)
  expect(isHostToWebview({ kind: 'diagnostics.test.set', enabled: 'true' })).toBe(false)
  const trace = new TestDiagnostics()
  trace.reset(true)
  trace.record('sample', { top: 2 })
  expect(isWebviewToHost({ ...view, diagnostics: trace.snapshot() })).toBe(true)
  expect(isDiagnosticSnapshot({ events: Array(DIAGNOSTIC_LIMIT + 1).fill(trace.snapshot().events[0]), dropped: 0 })).toBe(false)
  expect(isWebviewToHost({ ...view, diagnostics: { events: [], dropped: -1 } })).toBe(false)
  const card = { inner: 'C', state: 'content', note: 'C.md', blocks: 3, scope: 'full', fm: 'none', maxHeightPx: 480, host: 'reading' }
  expect(isWebviewToHost({ ...view, readingEmbed: [card] })).toBe(true)
  expect(isWebviewToHost({ ...view, readingEmbed: [{ ...card, rootHost: 'live' }] })).toBe(true)
  expect(isWebviewToHost({ ...view, readingEmbed: [{ ...card, rootHost: 'source' }] })).toBe(false)
})
