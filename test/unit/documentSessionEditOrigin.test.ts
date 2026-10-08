// T03（#352）编辑来源与宿主历史接入点——契约测试（先立预期再实现）。
//
// 覆盖票面验收的纯逻辑面：
// - 可选来源/原子组元数据（EditOriginMeta）的形状校验与协议通道放行。
// - DocumentSession 管线贯通：edit.request.origin → PendingEdit →
//   HostDocumentPort.applyChanges(…, origin) → 确认后 onEditAttributed
//   恰好一次（ack version 对位、LF 形态变更）。
// - 失败不留下成功来源记录（applyChanges 失败 / 冲突暂停 / 不可重定位）。
// - 重放（ackCache 命中）不重复计入。
// - 纯选区事务（origin 且无净文本变更）不造文本撤销项、不写回、不归属。
// - 跨目标元数据不合并到父文档历史（会话划分隔离）。
// - 旧调用（无 origin）行为契约等价：onEditAttributed 不触发。
// - 组历史窄适配点 runHistorySteps：会话队列串行、origin 透传、
//   端口缺省时明确 route-unavailable。
import { describe, it, expect, vi } from 'vitest'
import { DocumentSession, type HostDocumentPort, type PanelPort } from '../../src/host/documentSession'
import { isEditOriginMeta, type EditOriginMeta } from '../../src/shared/editOrigin'
import { isWebviewToHost } from '../../src/shared/protocol'
import type { HostToWebview, SerChange, WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/a.md'
const OTHER_DOC_URI = 'file:///d%3A/notes/b.md'

const ORIGIN: EditOriginMeta = { addonId: 'onegayi.demo-addon', opId: 'op-1', undo: 'atomic' }

function applyToText(text: string, changes: SerChange[]): string {
  const sorted = [...changes].sort((a, b) => a.offset - b.offset)
  let out = text
  let shift = 0
  for (const c of sorted) {
    out = out.slice(0, c.offset + shift) + c.text + out.slice(c.offset + shift + c.length)
    shift += c.text.length - c.length
  }
  return out
}

class FakeDoc implements HostDocumentPort {
  content: string
  ver: number
  eol: 1 | 2 = 1
  applyCalls: { changes: SerChange[]; origin?: EditOriginMeta }[] = []
  applyResult = true
  undoGroupCalls: { steps: number; origin?: { docUri: string } }[] = []
  redoGroupCalls: { steps: number; origin?: { docUri: string } }[] = []
  /** 组历史执行结果（缺省按 undoGroup 调用成功执行全部步） */
  groupResult: { executedSteps: number; aborted?: 'version-mismatch' | 'route-unavailable' } | undefined
  private listener: ((changes: SerChange[], version: number) => void) | undefined

  constructor(text: string) {
    this.content = text
    this.ver = 1
  }

  get version(): number {
    return this.ver
  }

  getText(): string {
    return this.content
  }

  onDocChanged(cb: (changes: SerChange[], version: number) => void): void {
    this.listener = cb
  }

  async applyChanges(changes: SerChange[], origin?: EditOriginMeta): Promise<boolean> {
    this.applyCalls.push({ changes, origin })
    if (!this.applyResult) return false
    this.content = applyToText(this.content, changes)
    this.ver++
    this.listener?.(changes, this.ver)
    return true
  }

  async undo(): Promise<boolean> {
    return false
  }

  async redo(): Promise<boolean> {
    return false
  }

  /** 可选组入口（属性形式：测试可整体替换或置空） */
  undoGroup: ((steps: number, origin?: { docUri: string }) => Promise<{ executedSteps: number; aborted?: 'version-mismatch' | 'route-unavailable' }>) | undefined =
    async (steps, origin) => {
      this.undoGroupCalls.push({ steps, origin })
      return this.groupResult ?? { executedSteps: steps }
    }

  redoGroup: ((steps: number, origin?: { docUri: string }) => Promise<{ executedSteps: number; aborted?: 'version-mismatch' | 'route-unavailable' }>) | undefined =
    async (steps, origin) => {
      this.redoGroupCalls.push({ steps, origin })
      return this.groupResult ?? { executedSteps: steps }
    }
}

interface AttributionRecord {
  docUri: string
  sessionId: string
  seq: number
  version: number
  changes: SerChange[]
  origin: EditOriginMeta
  joined?: EditOriginMeta[]
}

function setup(text = 'abc\n', opts?: { eol?: 1 | 2; onEditAttributed?: (record: AttributionRecord) => void; onOriginGate?: (origin: EditOriginMeta) => boolean }) {
  const doc = new FakeDoc(text)
  if (opts?.eol) doc.eol = opts.eol
  const session = new DocumentSession(doc, {
    docUri: DOC_URI,
    isWindowsHost: true,
    ...(opts?.onEditAttributed ? { onEditAttributed: opts.onEditAttributed } : {}),
    ...(opts?.onOriginGate ? { onOriginGate: opts.onOriginGate } : {}),
  })
  doc.onDocChanged((changes, version) => session.handleDocChanged(changes, version))
  const sent: HostToWebview[] = []
  const port: PanelPort = { send: (m) => sent.push(m) }
  const sessionId = session.attachPanel(port)
  return { doc, session, sent, sessionId }
}

async function ready(s: { session: DocumentSession; sessionId: string; sent: HostToWebview[] }): Promise<void> {
  await s.session.handleWebviewMessage({ kind: 'ready' } as WebviewToHost, s.sessionId)
  expect(s.sent[0]?.kind).toBe('init')
}

function originRequest(seq: number, baseVersion: number, changes: SerChange[], origin?: EditOriginMeta): WebviewToHost {
  return {
    kind: 'edit.request',
    sessionId: 'unused',
    docUri: DOC_URI,
    seq,
    baseVersion,
    changes,
    ...(origin !== undefined ? { origin } : {}),
  } as WebviewToHost
}

function lastAck(sent: HostToWebview[]): Extract<HostToWebview, { kind: 'edit.ack' }> {
  const ack = [...sent].reverse().find((m): m is Extract<HostToWebview, { kind: 'edit.ack' }> => m.kind === 'edit.ack')
  expect(ack).toBeDefined()
  return ack!
}

describe('EditOriginMeta 形状校验与协议通道', () => {
  it('合法形态通过 isEditOriginMeta', () => {
    expect(isEditOriginMeta(ORIGIN)).toBe(true)
    expect(isEditOriginMeta({ addonId: 'pub.name', opId: 'op', undo: 'joinPrevious' })).toBe(true)
  })

  it('非法形态拒绝：缺字段 / 空串 / undo 值越界 / 非对象', () => {
    expect(isEditOriginMeta(undefined)).toBe(false)
    expect(isEditOriginMeta(null)).toBe(false)
    expect(isEditOriginMeta('x')).toBe(false)
    expect(isEditOriginMeta({ addonId: 'pub.name', opId: 'op' })).toBe(false)
    expect(isEditOriginMeta({ addonId: '', opId: 'op', undo: 'atomic' })).toBe(false)
    expect(isEditOriginMeta({ addonId: 'pub.name', opId: '', undo: 'atomic' })).toBe(false)
    expect(isEditOriginMeta({ addonId: 'pub.name', opId: 'op', undo: 'coalesced' })).toBe(false)
    expect(isEditOriginMeta({ addonId: 1, opId: 'op', undo: 'atomic' })).toBe(false)
  })

  it('edit.request 携带合法 origin 通过协议校验；非法 origin 整条消息拒绝', () => {
    expect(isWebviewToHost(originRequest(1, 1, [{ offset: 0, length: 0, text: 'x' }], ORIGIN))).toBe(true)
    expect(isWebviewToHost(originRequest(1, 1, []))).toBe(true)
    expect(isWebviewToHost(originRequest(1, 1, [{ offset: 0, length: 0, text: 'x' }], { addonId: 'a.b', opId: '', undo: 'atomic' } as unknown as EditOriginMeta))).toBe(false)
    expect(isWebviewToHost(originRequest(1, 1, [{ offset: 0, length: 0, text: 'x' }], { addonId: 'a.b', opId: 'o', undo: 'nope' } as unknown as EditOriginMeta))).toBe(false)
  })
})

describe('T03 来源归属：确认管线接入点', () => {
  it('带 origin 的编辑成功确认后 onEditAttributed 恰好一次，version 与 ack 对位、changes 为 LF 形态', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }], ORIGIN), s.sessionId)
    expect(s.doc.content).toBe('abcX\n')
    expect(attributed.length).toBe(1)
    const ack = lastAck(s.sent)
    expect(ack).toMatchObject({ kind: 'edit.ack', seq: 1, ok: true })
    expect(ack.ok && attributed[0]!.version).toBe(ack.version)
    expect(attributed[0]).toMatchObject({ docUri: DOC_URI, sessionId: s.sessionId, seq: 1, origin: ORIGIN })
    expect(attributed[0]!.changes).toEqual([{ offset: 3, length: 0, text: 'X' }])
    // 归属查询面：按落定版本命中；外来版本未命中
    expect(s.session.editOriginAtVersion(attributed[0]!.version)?.origin).toEqual(ORIGIN)
    expect(s.session.editOriginAtVersion(99)).toBeUndefined()
  })

  it('HostDocumentPort.applyChanges 收到透传的 origin（写回层接入点）', async () => {
    const s = setup('abc\n', { onEditAttributed: () => undefined })
    await ready(s)
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 0, length: 0, text: 'Z' }], ORIGIN), s.sessionId)
    expect(s.doc.applyCalls.length).toBe(1)
    expect(s.doc.applyCalls[0]!.origin).toEqual(ORIGIN)
  })

  it('多范围一笔提交只归属一次（changes 多段完整保留）', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    await s.session.handleWebviewMessage(originRequest(1, 1, [
      { offset: 0, length: 0, text: '[' },
      { offset: 4, length: 0, text: ']' },
    ], ORIGIN), s.sessionId)
    expect(attributed.length).toBe(1)
    expect(attributed[0]!.changes).toEqual([
      { offset: 0, length: 0, text: '[' },
      { offset: 4, length: 0, text: ']' },
    ])
  })

  it('baseVersion 落后但可平移（重定位）时归属落定 version，不认错外来条目', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abcdef\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    // 外部写入推进版本（外部条目，无归属）
    await s.doc.applyChanges([{ offset: 6, length: 0, text: '!' }])
    expect(attributed.length).toBe(0)
    // 落后一版的 origin 请求：offset=3 在外部变更(6)之前可平移
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }], ORIGIN), s.sessionId)
    expect(attributed.length).toBe(1)
    const ack = lastAck(s.sent)
    expect(ack.ok && attributed[0]!.version).toBe(ack.version)
    expect(s.doc.content).toBe('abcXdef!\n')
  })

  it('CRLF 文档：归属 changes 为 LF 坐标形态（与广播同款）', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('a\r\nb\r\n', { eol: 2, onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    // LF 坐标 offset=3 = LF 形态 'a\nb\n' 的 b 之后（宿主 offset=4，\r\n 双宽）
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }], ORIGIN), s.sessionId)
    expect(s.doc.content).toBe('a\r\nbX\r\n')
    expect(attributed.length).toBe(1)
    expect(attributed[0]!.changes).toEqual([{ offset: 3, length: 0, text: 'X' }])
  })

  it('写回失败（applyChanges false）不留下成功来源记录', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    s.doc.applyResult = false
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 0, length: 0, text: 'X' }], ORIGIN), s.sessionId)
    expect(attributed.length).toBe(0)
    expect(lastAck(s.sent)).toMatchObject({ kind: 'edit.ack', ok: false, reason: 'error' })
    expect(s.session.editOriginAtVersion(s.doc.version)).toBeUndefined()
  })

  it('不可安全重定位（版本日志缺口）不留下成功来源记录', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    // 版本超前：webview 迟到异常 → 拒绝并暂停
    await s.session.handleWebviewMessage(originRequest(1, 99, [{ offset: 0, length: 0, text: 'X' }], ORIGIN), s.sessionId)
    expect(attributed.length).toBe(0)
    expect(lastAck(s.sent)).toMatchObject({ kind: 'edit.ack', ok: false, reason: 'conflict' })
  })

  it('暂停面板的 origin 请求走冲突拒绝，不归属', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    await s.session.handleWebviewMessage(originRequest(1, 99, [{ offset: 0, length: 0, text: 'X' }], ORIGIN), s.sessionId)
    await s.session.handleWebviewMessage(originRequest(2, 1, [{ offset: 0, length: 0, text: 'Y' }], ORIGIN), s.sessionId)
    expect(attributed.length).toBe(0)
    expect(s.doc.applyCalls.length).toBe(0)
  })

  it('重放（同 seq 已确认）重发同一 ack，不重复计入归属', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    const msg = originRequest(1, 1, [{ offset: 0, length: 0, text: 'X' }], ORIGIN)
    await s.session.handleWebviewMessage(msg, s.sessionId)
    expect(attributed.length).toBe(1)
    const ackBefore = lastAck(s.sent)
    s.sent.length = 0
    await s.session.handleWebviewMessage(msg, s.sessionId)
    expect(attributed.length).toBe(1)
    expect(s.doc.applyCalls.length).toBe(1)
    expect(lastAck(s.sent)).toEqual(ackBefore)
  })

  it('连续两笔 origin 编辑各自归属，版本逐条对位', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 3, length: 0, text: '1' }], { ...ORIGIN, opId: 'op-a' }), s.sessionId)
    await s.session.handleWebviewMessage(originRequest(2, 2, [{ offset: 4, length: 0, text: '2' }], { ...ORIGIN, opId: 'op-b' }), s.sessionId)
    expect(attributed.map((r) => r.origin.opId)).toEqual(['op-a', 'op-b'])
    expect(attributed[0]!.version).toBe(2)
    expect(attributed[1]!.version).toBe(3)
  })
})

describe('T03 纯选区事务与旧调用等价', () => {
  it('origin 且无净文本变更：ack 成功、不写回、不造历史项、不归属', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    const before = { version: s.doc.version, text: s.doc.getText() }
    await s.session.handleWebviewMessage(originRequest(1, 1, [], ORIGIN), s.sessionId)
    await s.session.handleWebviewMessage(originRequest(2, 1, [{ offset: 1, length: 0, text: '' }], ORIGIN), s.sessionId)
    expect(s.doc.applyCalls.length).toBe(0)
    expect(s.doc.version).toBe(before.version)
    expect(s.doc.getText()).toBe(before.text)
    expect(attributed.length).toBe(0)
    expect(lastAck(s.sent)).toMatchObject({ kind: 'edit.ack', seq: 2, ok: true, version: before.version })
  })

  it('无 origin 旧调用不触发 onEditAttributed，ack/广播行为保持', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }]), s.sessionId)
    expect(attributed.length).toBe(0)
    expect(s.doc.content).toBe('abcX\n')
    expect(lastAck(s.sent)).toMatchObject({ kind: 'edit.ack', seq: 1, ok: true })
    expect(s.session.editOriginAtVersion(2)).toBeUndefined()
  })

  it('跨目标元数据不合并到父文档历史：B 会话的归属不经 A 会话回调', async () => {
    const aAttributed: AttributionRecord[] = []
    const bAttributed: AttributionRecord[] = []
    const docA = new FakeDoc('A\n')
    const docB = new FakeDoc('B\n')
    const sessionA = new DocumentSession(docA, { docUri: DOC_URI, onEditAttributed: (r) => aAttributed.push(r) })
    const sessionB = new DocumentSession(docB, { docUri: OTHER_DOC_URI, onEditAttributed: (r) => bAttributed.push(r) })
    docA.onDocChanged((changes, version) => sessionA.handleDocChanged(changes, version))
    docB.onDocChanged((changes, version) => sessionB.handleDocChanged(changes, version))
    const sentB: HostToWebview[] = []
    const panelB = sessionB.attachPanel({ send: (m) => sentB.push(m) })
    await sessionB.handleWebviewMessage({ kind: 'ready' }, panelB)
    await sessionB.handleWebviewMessage({
      kind: 'edit.request', sessionId: panelB, docUri: OTHER_DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 1, length: 0, text: 'X' }], origin: ORIGIN,
    } as WebviewToHost, panelB)
    expect(docB.content).toBe('BX\n')
    expect(bAttributed.length).toBe(1)
    expect(bAttributed[0]!.docUri).toBe(OTHER_DOC_URI)
    expect(aAttributed.length).toBe(0)
  })
})

describe('T03 组历史窄适配点 runHistorySteps', () => {
  it('经会话队列串行：排在在途 edit.request 之后执行', async () => {
    const s = setup('abc\n')
    await ready(s)
    const order: string[] = []
    const originalApply = s.doc.applyChanges.bind(s.doc)
    s.doc.applyCalls.length = 0
    s.doc.applyChanges = async (changes: SerChange[], origin?: EditOriginMeta) => {
      order.push('apply')
      return originalApply(changes, origin)
    }
    s.doc.undoGroup = async (steps) => {
      order.push('undoGroup')
      return { executedSteps: steps }
    }
    const editTask = s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }]), s.sessionId)
    const groupTask = s.session.runHistorySteps('undo', 2)
    await Promise.all([editTask, groupTask])
    expect(order).toEqual(['apply', 'undoGroup'])
  })

  it('origin 透传到端口 undoGroup/redoGroup', async () => {
    const s = setup('abc\n')
    await ready(s)
    const refOrigin = { docUri: 'file:///d%3A/notes/source.md' }
    await s.session.runHistorySteps('undo', 3, refOrigin)
    await s.session.runHistorySteps('redo', 1, refOrigin)
    expect(s.doc.undoGroupCalls).toEqual([{ steps: 3, origin: refOrigin }])
    expect(s.doc.redoGroupCalls).toEqual([{ steps: 1, origin: refOrigin }])
  })

  it('端口未实现组入口时明确 route-unavailable（不抛出、不动文档）', async () => {
    const s = setup('abc\n')
    await ready(s)
    s.doc.undoGroup = undefined
    const before = s.doc.version
    const result = await s.session.runHistorySteps('undo', 2)
    expect(result).toEqual({ executedSteps: 0, aborted: 'route-unavailable' })
    expect(s.doc.version).toBe(before)
  })

  it('端口中止（version-mismatch）时结果原样返回', async () => {
    const s = setup('abc\n')
    await ready(s)
    s.doc.groupResult = { executedSteps: 1, aborted: 'version-mismatch' }
    const result = await s.session.runHistorySteps('undo', 3)
    expect(result).toEqual({ executedSteps: 1, aborted: 'version-mismatch' })
  })
})

describe('T06 数组 origin 与业务闸门', () => {
  it('数组 origin 通过协议校验；非法数组（空/部分非法）整条消息拒绝', () => {
    const merged = [
      { addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' as const },
      { addonId: 'pub.addon', opId: 'op-b', undo: 'joinPrevious' as const },
    ]
    const req = originRequest(1, 1, [{ offset: 0, length: 0, text: 'x' }], merged[0]!)
    ;(req as { origin?: unknown }).origin = merged
    expect(isWebviewToHost(req)).toBe(true)
    const emptyArr = originRequest(1, 1, [], merged[0]!)
    ;(emptyArr as { origin?: unknown }).origin = []
    expect(isWebviewToHost(emptyArr)).toBe(false)
    const badArr = originRequest(1, 1, [], merged[0]!)
    ;(badArr as { origin?: unknown }).origin = [merged[0]!, { addonId: 'x', opId: 2, undo: 'joinPrevious' }]
    expect(isWebviewToHost(badArr)).toBe(false)
  })

  it('合并笔归属：origin 为组首、joined 携带并入来源；editOriginAtVersion 返回组首', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    const head = { addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' as const }
    const joined = { addonId: 'pub.addon', opId: 'op-b', undo: 'joinPrevious' as const }
    const req = originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }], head)
    ;(req as { origin?: unknown }).origin = [head, joined]
    await s.session.handleWebviewMessage(req, s.sessionId)
    const ack = lastAck(s.sent)
    expect(ack.ok).toBe(true)
    expect(attributed.length).toBe(1)
    expect(attributed[0]!.origin).toEqual(head)
    expect(attributed[0]!.joined).toEqual([joined])
    expect(s.session.editOriginAtVersion(ack.ok ? ack.version : 0)?.origin).toEqual(head)
    // applyChanges 透传数组形态
    expect(s.doc.applyCalls[0]!.origin).toEqual([head, joined])
  })

  it('跨组件合并笔防御复核拒绝：伪造他组件 joinPrevious 并组整条拒（不写回不留归属）', async () => {
    const attributed: AttributionRecord[] = []
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r) })
    await ready(s)
    const head = { addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' as const }
    const forged = { addonId: 'pub.other', opId: 'op-x', undo: 'joinPrevious' as const }
    const req = originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }], head)
    ;(req as { origin?: unknown }).origin = [head, forged]
    await s.session.handleWebviewMessage(req, s.sessionId)
    const ack = lastAck(s.sent)
    expect(ack).toMatchObject({ kind: 'edit.ack', seq: 1, ok: false, reason: 'conflict', originRejection: 'history-boundary' })
    expect(s.doc.content).toBe('abc\n')
    expect(s.doc.applyCalls).toHaveLength(0)
    expect(attributed).toHaveLength(0)
  })

  it('闸门拒绝（history-boundary）：不写回、不留归属记录、ack 附带全文与业务标记', async () => {
    const attributed: AttributionRecord[] = []
    const gate = vi.fn(() => false)
    const s = setup('abc\n', { onEditAttributed: (r) => attributed.push(r), onOriginGate: gate })
    await ready(s)
    const origin: EditOriginMeta = { addonId: 'pub.addon', opId: 'op-x', undo: 'joinPrevious' }
    const before = s.doc.version
    await s.session.handleWebviewMessage(originRequest(1, 1, [{ offset: 0, length: 0, text: 'X' }], origin), s.sessionId)
    const ack = lastAck(s.sent)
    expect(ack.ok).toBe(false)
    if (!ack.ok) {
      expect(ack.reason).toBe('conflict')
      expect(ack.originRejection).toBe('history-boundary')
      expect(ack.text).toBe('abc\n')
    }
    expect(gate).toHaveBeenCalledWith(origin)
    expect(s.doc.version).toBe(before)
    expect(s.doc.applyCalls.length).toBe(0)
    expect(attributed.length).toBe(0)
    expect(s.session.editOriginAtVersion(before + 1)).toBeUndefined()
  })

  it('闸门放行 atomic：正常写回与归属不受影响；无闸门时 joinPrevious 也放行（旧契约）', async () => {
    const gateAtomic = vi.fn((o: EditOriginMeta) => o.undo === 'atomic')
    const s1 = setup('abc\n', { onOriginGate: gateAtomic })
    await ready(s1)
    await s1.session.handleWebviewMessage(
      originRequest(1, 1, [{ offset: 3, length: 0, text: 'X' }], { addonId: 'p.a', opId: 'o1', undo: 'atomic' }),
      s1.sessionId,
    )
    expect(lastAck(s1.sent).ok).toBe(true)
    // 无闸门：joinPrevious 直通（闸门是 T06 生产装配，非会话缺省）
    const s2 = setup('abc\n')
    await ready(s2)
    await s2.session.handleWebviewMessage(
      originRequest(1, 1, [{ offset: 3, length: 0, text: 'Y' }], { addonId: 'p.a', opId: 'o2', undo: 'joinPrevious' }),
      s2.sessionId,
    )
    expect(lastAck(s2.sent).ok).toBe(true)
  })
})
