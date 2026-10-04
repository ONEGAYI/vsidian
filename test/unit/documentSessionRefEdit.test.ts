// P2-04（#281）文档会话的目标编辑端口配套契约：
// - attachPanel 可携带 refOrigin（嵌入端口的来源面板身份），history.request
//   执行时透传给权威端口 undo/redo——provider 据此实现 P2-01 验证的
//   「临时激活 B → 全局 undo → 重显 A」路由（活动 tab 不是 B 的 custom
//   editor 时，撤销归属的唯一公开路线）
// - hasHoverSourcePin：refEdit.bind 的校验面——目标 fsPath 须为本面板成功
//   送达且被该 occurrence 的 watch 固定（不信任前端自报 URI）
import { describe, expect, it } from 'vitest'
import { DocumentSession, type HostDocumentPort, type PanelPort } from '../../src/host/documentSession'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/b.md'

class FakeDoc implements HostDocumentPort {
  content = '# B\n正文'
  ver = 1
  undoOrigins: Array<{ docUri: string } | undefined> = []
  redoOrigins: Array<{ docUri: string } | undefined> = []

  get version(): number { return this.ver }
  getText(): string { return this.content }

  async applyChanges(): Promise<boolean> { return false }

  async undo(origin?: { docUri: string }): Promise<boolean> {
    this.undoOrigins.push(origin)
    return true
  }

  async redo(origin?: { docUri: string }): Promise<boolean> {
    this.redoOrigins.push(origin)
    return true
  }
}

function setup() {
  const doc = new FakeDoc()
  const session = new DocumentSession(doc, { docUri: DOC_URI, isWindowsHost: true })
  const sent: HostToWebview[] = []
  const port: PanelPort = { send: (m) => sent.push(m) }
  return { doc, session, sent, port }
}

describe('P2-04 attachPanel refOrigin 与 history 路由', () => {
  it('带 refOrigin 的虚拟面板 history.request 把来源身份透传给 undo/redo', async () => {
    const { doc, session, port } = setup()
    const origin = { docUri: 'file:///d%3A/notes/a.md' }
    const panelId = session.attachPanel(port, { refOrigin: origin })
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    await session.handleWebviewMessage({ kind: 'history.request', op: 'undo' } as WebviewToHost, panelId)
    expect(doc.undoOrigins).toEqual([origin])
    await session.handleWebviewMessage({ kind: 'history.request', op: 'redo' } as WebviewToHost, panelId)
    expect(doc.redoOrigins).toEqual([origin])
  })

  it('普通面板（无 refOrigin）undo/redo 收到 undefined，不影响既有主面板路径', async () => {
    const { doc, session, port } = setup()
    const panelId = session.attachPanel(port)
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    await session.handleWebviewMessage({ kind: 'history.request', op: 'undo' } as WebviewToHost, panelId)
    expect(doc.undoOrigins).toEqual([undefined])
  })

  it('未 ready 面板的 history.request 被忽略（与既有口径一致）', async () => {
    const { doc, session, port } = setup()
    const panelId = session.attachPanel(port, { refOrigin: { docUri: 'file:///x.md' } })
    await session.handleWebviewMessage({ kind: 'history.request', op: 'undo' } as WebviewToHost, panelId)
    expect(doc.undoOrigins).toEqual([])
  })
})

describe('P2-04 hasHoverSourcePin：refEdit.bind 的来源校验面', () => {
  async function pinnedSetup() {
    const { session, sent } = setup()
    const served: HostToWebview[] = []
    const panelId = session.attachPanel({
      send: (m) => served.push(m),
      readHoverTarget: (_payload, report) => {
        // #333 类型化读取桩（markdown kind 标记载荷）
        report({
          ok: true,
          fsPath: 'D:\\notes\\目标.md',
          relPath: '目标.md',
          content: {
            kind: 'markdown',
            version: 2,
            lfText: '# t\n',
            range: { start: 0, end: 4 },
            selector: { kind: 'full' },
          },
        })
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    await session.handleWebviewMessage({
      kind: 'hover.request', sessionId: panelId, docUri: DOC_URI,
      reqId: 1, instanceId: 'mount-1', occurrenceId: 'occ-1',
      sourceStart: 0, sourceEnd: 6, target: '目标', retainSource: true,
    } as WebviewToHost, panelId)
    const result = served.at(-1) as { sourceLeaseId?: string }
    expect(result?.sourceLeaseId).toBeTruthy()
    return { session, panelId, served, sent, sourceLeaseId: result.sourceLeaseId! }
  }

  it('watch 固定后的 (fsPath, occurrence) 返回 true；未固定/错 occurrence/伪造 fsPath 为 false', async () => {
    const { session, panelId, sourceLeaseId } = await pinnedSetup()
    await session.handleWebviewMessage({
      kind: 'hover.watch', sessionId: panelId, docUri: DOC_URI,
      fsPath: 'D:\\notes\\目标.md', instanceId: 'occ-1', sourceLeaseId,
    } as WebviewToHost, panelId)
    expect(session.hasHoverSourcePin(panelId, 'D:\\notes\\目标.md', 'occ-1')).toBe(true)
    // 未固定的 occurrence（另一嵌入位置未 watch）
    expect(session.hasHoverSourcePin(panelId, 'D:\\notes\\目标.md', 'occ-2')).toBe(false)
    // 伪造目标（面板从未送达）
    expect(session.hasHoverSourcePin(panelId, 'D:\\notes\\伪造.md', 'occ-1')).toBe(false)
    // 未知会话
    expect(session.hasHoverSourcePin('nope', 'D:\\notes\\目标.md', 'occ-1')).toBe(false)
  })

  it('unwatch 释放固定后 pin 查询回到 false（释放后写入拒绝的数据面）', async () => {
    const { session, panelId, sourceLeaseId } = await pinnedSetup()
    await session.handleWebviewMessage({
      kind: 'hover.watch', sessionId: panelId, docUri: DOC_URI,
      fsPath: 'D:\\notes\\目标.md', instanceId: 'occ-1', sourceLeaseId,
    } as WebviewToHost, panelId)
    await session.handleWebviewMessage({
      kind: 'hover.unwatch', sessionId: panelId, docUri: DOC_URI,
      fsPath: 'D:\\notes\\目标.md', instanceId: 'occ-1',
    } as WebviewToHost, panelId)
    expect(session.hasHoverSourcePin(panelId, 'D:\\notes\\目标.md', 'occ-1')).toBe(false)
    // 送达记录仍在（hasHoverSource 不受 unwatch 影响），但 occurrence 固定已释放
    expect(session.hasHoverSource(panelId, 'D:\\notes\\目标.md')).toBe(true)
  })
})

describe('#316 onPanelReload：webview 重载信号（重复 ready）回调', () => {
  it('同一面板第二次 ready（重载）以该 sessionId 触发回调；首次 ready 不触发', async () => {
    const { doc } = { doc: new FakeDoc() }
    const reloaded: string[] = []
    const session = new DocumentSession(doc, {
      docUri: DOC_URI,
      onPanelReload: (sessionId) => reloaded.push(sessionId),
    })
    const port: PanelPort = { send: () => {} }
    const panelId = session.attachPanel(port)
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    expect(reloaded).toEqual([]) // 首次 ready 是装载，不是重载
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    expect(reloaded).toEqual([panelId]) // 重复 ready = webview 重载
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    expect(reloaded).toEqual([panelId, panelId]) // 每次重载都发信号（幂等处理归 provider）
  })

  it('未注入回调时重复 ready 无副作用（可选注入，既有构造不受影响）', async () => {
    const doc = new FakeDoc()
    const session = new DocumentSession(doc, { docUri: DOC_URI })
    const sent: HostToWebview[] = []
    const panelId = session.attachPanel({ send: (m) => sent.push(m) })
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    await session.handleWebviewMessage({ kind: 'ready' }, panelId)
    expect(session.getInfo().panels.length).toBe(1)
    expect(sent.length).toBeGreaterThan(0) // init 重发照常（既有 B-2 行为不变）
  })
})
