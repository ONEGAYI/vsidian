// 文档会话契约：宿主侧每个 TextDocument 一个 DocumentSession，管理多面板的
// ready 握手、edit.request 的校验与写回（seq 去重、baseVersion 过期重定位或
// 拒绝）、自家编辑确认（edit.ack）与外部变更广播（doc.changed）。
// 权威文档通过 HostDocumentPort 注入（vscode 层实现），此处用假文档驱动。
import { describe, it, expect } from 'vitest'
import { DocumentSession, type HostDocumentPort, type PanelPort, type SessionNotice } from '../../src/host/documentSession'
import { HOVER_REFRESH_DEFAULTS } from '../../src/shared/hoverRefresh'
import type { HostToWebview, SerChange, WebviewToHost } from '../../src/shared/protocol'

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
  /** 权威文档行尾（镜像 vscode.EndOfLine：1=LF、2=CRLF；#81 复制归一驱动） */
  eol: 1 | 2 = 1
  applyCalls: SerChange[][] = []
  applyResult = true
  fireChangeOnApply = true
  holdApply = false
  undoCalls = 0
  redoCalls = 0
  private undoStack: { changes: SerChange[]; before: string }[] = []
  private redoStack: { changes: SerChange[]; before: string }[] = []
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

  /** 下一笔 applyChanges 挂起（测试钩子：构造在途 pending 窗口）。
   *  挂起的调用永不完成（模拟断连/超长在途），测试结束时 release 复位标记 */
  holdNextApply(): { release: () => void } {
    this.holdApply = true
    return {
      release: () => {
        this.holdApply = false
      },
    }
  }

  async applyChanges(changes: SerChange[]): Promise<boolean> {
    this.applyCalls.push(changes)
    if (this.holdApply) {
      await new Promise<void>(() => undefined) // 测试钩子：在途挂起（由测试放弃）
      return false
    }
    if (!this.applyResult) return false
    this.undoStack.push({ changes, before: this.content })
    this.redoStack = []
    this.content = applyToText(this.content, changes)
    this.ver++
    if (this.fireChangeOnApply) {
      this.listener?.(changes, this.ver)
    }
    return true
  }

  /** 对已 pop 的编辑组计算精确逆（组内变更互不重叠时；基于其 before 文本） */
  private invertFor(entry: { changes: SerChange[]; before: string }): SerChange[] {
    const out: SerChange[] = []
    for (const c of entry.changes) {
      let delta = 0
      for (const other of entry.changes) {
        if (other !== c && other.offset + other.length <= c.offset) {
          delta += other.text.length - other.length
        }
      }
      const at = c.offset + delta
      out.push({
        offset: at,
        length: c.text.length,
        text: entry.before.slice(c.offset, c.offset + c.length),
      })
    }
    return out
  }

  async undo(): Promise<boolean> {
    this.undoCalls++
    const top = this.undoStack.pop()
    if (!top) return false
    this.redoStack.push(top)
    const inverse = this.invertFor(top)
    this.content = top.before
    this.ver++
    this.listener?.(inverse, this.ver)
    return true
  }

  async redo(): Promise<boolean> {
    this.redoCalls++
    const top = this.redoStack.pop()
    if (!top) return false
    this.undoStack.push(top)
    this.content = applyToText(this.content, top.changes)
    this.ver++
    this.listener?.(top.changes, this.ver)
    return true
  }
}

function setup(
  text = '# 标题\n正文内容',
  opts?: {
    onNotice?: (notice: SessionNotice) => void
    onViewState?: (
      sessionId: string,
      state: Extract<WebviewToHost, { kind: 'view.state' }>,
    ) => void
    /** #96 R1：语言供应者（vscode 层注入 hostLocale + LOCALE_MESSAGES） */
    requestLocale?: () => { lang: string; messages: Record<string, string> } | undefined
    /** #201：宿主文件系统语义（生产装配注入；测试缺省 Windows 语义便于
     *  路径写法归一断言） */
    isWindowsHost?: boolean
  },
) {
  const doc = new FakeDoc(text)
  const session = new DocumentSession(doc, {
    docUri: DOC_URI,
    onNotice: opts?.onNotice,
    onViewState: opts?.onViewState,
    requestLocale: opts?.requestLocale,
    isWindowsHost: opts?.isWindowsHost ?? true,
  })
  doc.onDocChanged((changes, version) => session.handleDocChanged(changes, version))
  const sent = new Map<string, HostToWebview[]>()
  const attach = (): string => {
    const out: HostToWebview[] = []
    const sessionId = session.attachPanel({ send: (m) => out.push(m) })
    sent.set(sessionId, out)
    return sessionId
  }
  const send = async (sessionId: string, msg: WebviewToHost) =>
    session.handleWebviewMessage(msg, sessionId)
  return { doc, session, attach, send, sent }
}

const DOC_URI = 'file:///d%3A/notes/a.md'

async function readyPanel(s: ReturnType<typeof setup>, sessionId: string): Promise<HostToWebview> {
  await s.send(sessionId, { kind: 'ready' })
  const init = s.sent.get(sessionId)!.at(-1)!
  expect(init.kind).toBe('init')
  return init
}

describe('ready 握手与 init', () => {
  it('dirty 状态的空内容事件不广播，也不挤掉内容版本日志', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await s.doc.applyChanges([{ offset: 0, length: 0, text: 'X' }])
    await s.doc.applyChanges([{ offset: 0, length: 0, text: 'Y' }])
    s.sent.get(id)!.length = 0
    for (let i = 0; i < 300; i++) s.session.handleDocChanged([], s.doc.version)
    expect(s.sent.get(id)).toEqual([])
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 3, length: 0, text: '尾' }],
    })
    expect(s.doc.content).toBe('YXabc尾')
    expect(s.sent.get(id)!.at(-1)).toMatchObject({ kind: 'edit.ack', ok: true })
  })

  it('ready 后发送 init：sessionId、docUri、全文与版本', async () => {
    const s = setup('# 你好\n')
    const id = s.attach()
    const init = await readyPanel(s, id)
    expect(init).toMatchObject({ kind: 'init', sessionId: id, version: 1, text: '# 你好\n' })
    if (init.kind === 'init') {
      expect(init.docUri).toBe(DOC_URI)
    }
  })

  it('init 的 docUri 取自构造时传入的文档 uri', async () => {
    const doc = new FakeDoc('x')
    const session = new DocumentSession(doc, { docUri: 'file:///b.md' })
    const out: HostToWebview[] = []
    const id = session.attachPanel({ send: (m) => out.push(m) })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    expect(out[0]).toMatchObject({ kind: 'init', docUri: 'file:///b.md' })
  })

  it('ready 重复到达（webview 重载）时重发最新 init', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    // 模拟外部变更推进文档
    s.doc.content = '新文本'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 0, length: 4, text: '新文本' }], 2)
    await s.send(id, { kind: 'ready' })
    const init = s.sent.get(id)!.at(-1)!
    expect(init).toMatchObject({ kind: 'init', version: 2, text: '新文本', sessionId: id })
  })

  it('未 ready 的面板不接收 doc.changed 广播（后续 init 自带最新文本）', async () => {
    const s = setup()
    const id = s.attach()
    s.doc.content = '外部改写'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 0, length: 6, text: '外部改写' }], 2)
    const msgs = s.sent.get(id)!
    expect(msgs).toHaveLength(0)
    const init = await readyPanel(s, id)
    expect(init).toMatchObject({ version: 2, text: '外部改写' })
  })
})

describe('#244 宿主直接父来源与当前路径', () => {
  it('只接已送达且仍订阅的 B；版本、范围、原文与回指 A 分别验证', async () => {
    const bPath = 'D:\\notes\\b.md'
    const aPath = 'D:\\notes\\a.md'
    const b = { version: 1, text: '![[C]]\n![[A]]' }
    const doc = new FakeDoc('![[B]]')
    const session = new DocumentSession(doc, { docUri: DOC_URI, rootFsPath: aPath, isWindowsHost: true })
    const out: HostToWebview[] = []
    const reads: Array<{ target: string; source?: string }> = []
    const id = session.attachPanel({
      send: (m) => out.push(m),
      readHoverSource: async (fsPath) => fsPath === bPath ? b : null,
      readHoverTarget: (payload, report) => {
        reads.push({ target: payload.target, source: payload.verifiedSource?.fsPath })
        const fsPath = payload.target === 'B' ? bPath : payload.target === 'A' ? aPath : 'D:\\notes\\c.md'
        const text = payload.target === 'B' ? b.text : '# target'
        report({ ok: true, fsPath, relPath: `${payload.target}.md`, version: 1,
          lfText: text, range: { start: 0, end: text.length }, scope: { kind: 'full' } })
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    const request = async (reqId: number, target: string, start: number, end: number) => {
      await session.handleWebviewMessage({ kind: 'hover.request', sessionId: id, docUri: DOC_URI,
        reqId, instanceId: `mount-${reqId}`, occurrenceId: `child-${reqId}`,
        sourceStart: start, sourceEnd: end, target,
        source: { parentInstanceId: 'root-b', sourceDocUri: bPath }, retainSource: true }, id)
      return out.at(-1) as Extract<HostToWebview, { kind: 'hover.result' }>
    }
    await session.handleWebviewMessage({ kind: 'hover.request', sessionId: id, docUri: DOC_URI,
      reqId: 1, instanceId: 'mount-b', occurrenceId: 'root-b', sourceStart: 0, sourceEnd: 6,
      target: 'B', retainSource: true }, id)
    const first = out.at(-1) as Extract<HostToWebview, { kind: 'hover.result'; ok: true }>
    expect(first).toMatchObject({ ok: true, depth: 1 })
    expect(session.retainHoverSource(id, bPath, 'root-b', first.sourceLeaseId)).toBe(true)
    expect(await request(2, 'C', 0, 6)).toMatchObject({ ok: true, depth: 2 })
    expect(reads.at(-1)).toEqual({ target: 'C', source: bPath })
    expect(await request(3, 'A', 7, 13)).toMatchObject({ ok: false, reason: 'cycle' })
    expect(await request(4, 'Wrong', 0, 6)).toMatchObject({ ok: false, reason: 'source-expired' })
    expect(await request(5, 'C', 7, 13)).toMatchObject({ ok: false, reason: 'source-expired' })
    b.version = 2
    expect(await request(6, 'C', 0, 6)).toMatchObject({ ok: false, reason: 'source-expired' })
    await session.handleWebviewMessage({ kind: 'hover.unwatch', sessionId: id, docUri: DOC_URI,
      fsPath: bPath, instanceId: 'root-b' }, id)
    expect(await request(7, 'C', 0, 6)).toMatchObject({ ok: false, reason: 'source-expired' })
  })

  it('两个目录的同名 C 按各自 B 来源读，缓存形态不跨来源命中', async () => {
    const doc = new FakeDoc('![[one/B]]\n![[two/B]]')
    const session = new DocumentSession(doc, { docUri: DOC_URI, rootFsPath: 'D:\\notes\\a.md', isWindowsHost: true })
    const out: HostToWebview[] = []
    const served: string[] = []
    const bText = '![[C]]'
    const id = session.attachPanel({
      send: (m) => out.push(m),
      readHoverSource: async () => ({ version: 1, text: bText }),
      readHoverTarget: (payload, report) => {
        const source = payload.verifiedSource?.fsPath ?? ''
        served.push(`${source}:${payload.target}`)
        const fsPath = payload.target === 'C' ? source.replace('B.md', 'C.md')
          : `D:\\notes\\${payload.target.replaceAll('/', '\\')}.md`
        const text = payload.target === 'C' ? '# C' : bText
        report({ ok: true, fsPath, relPath: `${payload.target}.md`, version: 1,
          lfText: text, range: { start: 0, end: text.length }, scope: { kind: 'full' } })
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    for (const [index, parent] of ['one/B', 'two/B'].entries()) {
      await session.handleWebviewMessage({ kind: 'hover.request', sessionId: id, docUri: DOC_URI,
        reqId: index + 1, instanceId: `mount-${index}`, occurrenceId: `parent-${index}`,
        sourceStart: 0, sourceEnd: 10, target: parent, retainSource: true }, id)
      const result = out.at(-1) as Extract<HostToWebview, { kind: 'hover.result'; ok: true }>
      expect(session.retainHoverSource(id, result.target.fsPath, `parent-${index}`, result.sourceLeaseId)).toBe(true)
    }
    for (const index of [0, 1, 0]) {
      const sourceDocUri = `D:\\notes\\${index === 0 ? 'one' : 'two'}\\B.md`
      await session.handleWebviewMessage({ kind: 'hover.request', sessionId: id, docUri: DOC_URI,
        reqId: index + 10, instanceId: `child-${index}`, occurrenceId: `occ-${index}`,
        sourceStart: 0, sourceEnd: 6, target: 'C',
        source: { parentInstanceId: `parent-${index}`, sourceDocUri } }, id)
      expect(out.at(-1)).toMatchObject({ ok: true, target: { fsPath: sourceDocUri.replace('B.md', 'C.md') } })
    }
    expect(served.filter((x) => x.endsWith(':C'))).toEqual([
      'D:\\notes\\one\\B.md:C', 'D:\\notes\\two\\B.md:C',
    ])
  })

  it('B 同 fsPath 未保存版本前移后旧子拒绝；新租约更新父关系且新子可读', async () => {
    const bPath = 'D:\\notes\\b.md'
    const b = { version: 1, text: '![[Old]]' }
    const session = new DocumentSession(new FakeDoc('![[B]]'),
      { docUri: DOC_URI, rootFsPath: 'D:\\notes\\a.md', isWindowsHost: true })
    const out: HostToWebview[] = []
    const id = session.attachPanel({
      send: (m) => out.push(m),
      readHoverSource: async () => b,
      readHoverTarget: (payload, report) => {
        const text = payload.target === 'B' ? b.text : '# leaf'
        report({ ok: true, fsPath: payload.target === 'B' ? bPath : `D:\\notes\\${payload.target}.md`,
          relPath: `${payload.target}.md`, version: payload.target === 'B' ? b.version : 1,
          lfText: text, range: { start: 0, end: text.length }, scope: { kind: 'full' } })
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    const loadB = async (reqId: number): Promise<string> => {
      await session.handleWebviewMessage({ kind: 'hover.request', sessionId: id, docUri: DOC_URI,
        reqId, instanceId: `mount-b-${reqId}`, occurrenceId: 'root-b',
        sourceStart: 0, sourceEnd: 6, target: 'B', retainSource: true }, id)
      const result = out.at(-1) as Extract<HostToWebview, { kind: 'hover.result'; ok: true }>
      expect(result.ok).toBe(true)
      return result.sourceLeaseId!
    }
    const child = async (reqId: number, target: string) => {
      await session.handleWebviewMessage({ kind: 'hover.request', sessionId: id, docUri: DOC_URI,
        reqId, instanceId: `child-${reqId}`, occurrenceId: `child-occ-${reqId}`,
        sourceStart: 0, sourceEnd: b.text.length, target,
        source: { parentInstanceId: 'root-b', sourceDocUri: bPath } }, id)
      return out.at(-1)
    }
    expect(session.retainHoverSource(id, bPath, 'root-b', await loadB(1))).toBe(true)
    expect(await child(2, 'Old')).toMatchObject({ ok: true })
    b.version = 2
    b.text = '![[New]]'
    session.invalidateHoverReads(bPath)
    expect(await child(3, 'New')).toMatchObject({ ok: false, reason: 'source-expired' })
    expect(session.retainHoverSource(id, bPath, 'root-b', await loadB(4))).toBe(true)
    expect(await child(5, 'Old')).toMatchObject({ ok: false, reason: 'source-expired' })
    expect(await child(6, 'New')).toMatchObject({ ok: true, depth: 2 })
  })

  it('同 occurrence 多笔在途读取按请求实数限 8，旧回报不能结算其他请求', async () => {
    const session = new DocumentSession(new FakeDoc('![[B]]'),
      { docUri: DOC_URI, rootFsPath: 'D:\\notes\\a.md', isWindowsHost: true })
    const out: HostToWebview[] = []
    const complete: Array<() => void> = []
    const id = session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        complete.push(() => report({ ok: true, fsPath: 'D:\\notes\\b.md', relPath: 'b.md',
          version: 1, lfText: '# B', range: { start: 0, end: 3 }, scope: { kind: 'full' } }))
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    const request = async (n: number) => session.handleWebviewMessage({ kind: 'hover.request',
      sessionId: id, docUri: DOC_URI, reqId: n, instanceId: `request-${n}`,
      occurrenceId: 'same-occurrence', sourceStart: 0, sourceEnd: 6,
      target: `target-${n}`, retainSource: true }, id)
    for (let i = 1; i <= 12; i++) await request(i)
    expect(complete).toHaveLength(8)
    expect(out.filter((m) => m.kind === 'hover.result' && !m.ok && m.reason === 'budget')).toHaveLength(4)
    complete[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await request(13)
    expect(complete).toHaveLength(9)
    complete[0]!() // 同一个回报重复送达，不得再结算第 13 笔的槽。
    await request(14)
    expect(complete).toHaveLength(9)
    expect(out.at(-1)).toMatchObject({ kind: 'hover.result', ok: false, reason: 'budget' })
  })

  it('失效刷新后 unwatch 仍按真实端口在途数限 8，直到回报才还槽', async () => {
    const session = new DocumentSession(new FakeDoc('![[B]]'),
      { docUri: DOC_URI, rootFsPath: 'D:\\notes\\a.md', isWindowsHost: true })
    const out: HostToWebview[] = []
    const held: Array<() => void> = []
    const first = new Set<string>()
    const id = session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (payload, report) => {
        const fsPath = `D:\\notes\\${payload.target}.md`
        const done = () => report({ ok: true, fsPath, relPath: `${payload.target}.md`,
          version: 1, lfText: '# B', range: { start: 0, end: 3 }, scope: { kind: 'full' } })
        if (!first.has(payload.target)) {
          first.add(payload.target)
          done()
        } else held.push(done)
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    const request = (n: number, refresh: boolean) => session.handleWebviewMessage({ kind: 'hover.request',
      sessionId: id, docUri: DOC_URI, reqId: refresh ? n + 100 : n,
      instanceId: `request-${n}`, occurrenceId: `root-${n}`,
      sourceStart: 0, sourceEnd: 6, target: `B${n}`, retainSource: true }, id)
    for (let i = 0; i < 10; i++) {
      await request(i, false)
      const result = out.at(-1) as Extract<HostToWebview, { kind: 'hover.result'; ok: true }>
      const fsPath = `D:\\notes\\B${i}.md`
      await session.handleWebviewMessage({ kind: 'hover.watch', sessionId: id, docUri: DOC_URI,
        fsPath, instanceId: `root-${i}`, sourceLeaseId: result.sourceLeaseId }, id)
      session.invalidateHoverReads(fsPath)
      await request(i, true)
      await session.handleWebviewMessage({ kind: 'hover.unwatch', sessionId: id, docUri: DOC_URI,
        fsPath, instanceId: `root-${i}` }, id)
    }
    expect(held).toHaveLength(8)
    expect(out.filter((m) => m.kind === 'hover.result' && !m.ok && m.reason === 'budget')).toHaveLength(2)
    held[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await request(10, false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(out.at(-1)).toMatchObject({ kind: 'hover.result', ok: true })
  })

  it('同 occurrence 旧回包 lease 释放不撤销仍在途的新读取预算', async () => {
    const session = new DocumentSession(new FakeDoc('![[B]]'),
      { docUri: DOC_URI, rootFsPath: 'D:\\notes\\a.md', isWindowsHost: true })
    const out: HostToWebview[] = []
    const complete: Array<() => void> = []
    const id = session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (payload, report) => {
        complete.push(() => report({ ok: true, fsPath: `D:\\notes\\${payload.target}.md`,
          relPath: `${payload.target}.md`, version: 1, lfText: '# target',
          range: { start: 0, end: 8 }, scope: { kind: 'full' } }))
      },
    })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    for (const reqId of [1, 2]) await session.handleWebviewMessage({ kind: 'hover.request',
      sessionId: id, docUri: DOC_URI, reqId, instanceId: `request-${reqId}`,
      occurrenceId: 'same', sourceStart: 0, sourceEnd: 6,
      target: `B${reqId}`, retainSource: true }, id)
    complete[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const old = out.find((m) => m.kind === 'hover.result' && m.reqId === 1)
    expect(old).toMatchObject({ ok: true })
    if (!old || old.kind !== 'hover.result' || !old.ok || !old.sourceLeaseId) throw new Error('missing old lease')
    await session.handleWebviewMessage({ kind: 'hover.source.release', sessionId: id,
      docUri: DOC_URI, sourceLeaseId: old.sourceLeaseId }, id)
    complete[1]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(out.find((m) => m.kind === 'hover.result' && m.reqId === 2)).toMatchObject({ ok: true })
  })
})

describe('ready 即语言校准（#96 R1：每次 ready 幂等补发 locale.changed）', () => {
  it('首次 ready：init 之后补发 locale.changed（携供应者当前生效语言）', async () => {
    const s = setup('# a\n', {
      requestLocale: () => ({ lang: 'zh-cn', messages: { 'k.a': '词' } }),
    })
    const id = s.attach()
    await s.send(id, { kind: 'ready' })
    const msgs = s.sent.get(id)!
    expect(msgs[0]?.kind).toBe('init')
    expect(msgs[1]).toEqual({
      kind: 'locale.changed',
      lang: 'zh-cn',
      messages: { 'k.a': '词' },
    })
  })

  it('重复 ready（webview 重载）同样补发：数据岛装回创建时旧语言被拉正', async () => {
    let lang = 'en'
    const s = setup('x', {
      requestLocale: () => ({ lang, messages: { 'k.a': 'w' } }),
    })
    const id = s.attach()
    await s.send(id, { kind: 'ready' })
    // 语言在面板创建之后变化（供应者即宿主当前生效语言的探针）
    lang = 'zh-cn'
    await s.send(id, { kind: 'ready' })
    const localeMsgs = s.sent.get(id)!.filter((m) => m.kind === 'locale.changed')
    expect(localeMsgs).toHaveLength(2)
    expect(localeMsgs[1]).toMatchObject({ lang: 'zh-cn', messages: { 'k.a': 'w' } })
  })

  it('未注入语言供应者时 ready 不补发 locale.changed（默认装配行为不变）', async () => {
    const s = setup()
    const id = s.attach()
    await s.send(id, { kind: 'ready' })
    expect(s.sent.get(id)!.some((m) => m.kind === 'locale.changed')).toBe(false)
  })
})

describe('edit.request 校验与写回', () => {
  it('baseVersion 匹配时应用变更并发 ack；其他面板收到 doc.changed', async () => {
    const s = setup()
    const idA = s.attach()
    const idB = s.attach()
    await readyPanel(s, idA)
    await readyPanel(s, idB)

    const change = { offset: 4, length: 0, text: '插入' }
    await s.send(idA, {
      kind: 'edit.request',
      sessionId: idA,
      docUri: DOC_URI,
      seq: 1,
      baseVersion: 1,
      changes: [change],
    })

    expect(s.doc.applyCalls).toEqual([[change]])
    // offset 4 是 '\n' 的位置：插入发生在换行符之前
    expect(s.doc.content).toBe('# 标题插入\n正文内容')
    const ack = s.sent.get(idA)!.find((m) => m.kind === 'edit.ack')
    expect(ack).toMatchObject({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    const broadcast = s.sent.get(idB)!.find((m) => m.kind === 'doc.changed')
    expect(broadcast).toMatchObject({
      kind: 'doc.changed',
      version: 2,
      changes: [change],
      origin: 'external',
    })
  })

  it('重复 seq 不重复应用，但重发相同的 ack（幂等去重）', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    const req = {
      kind: 'edit.request' as const,
      sessionId: id,
      docUri: DOC_URI,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 0, length: 0, text: 'X' }],
    }
    await s.send(id, req)
    await s.send(id, req)
    expect(s.doc.applyCalls).toHaveLength(1)
    const acks = s.sent.get(id)!.filter((m) => m.kind === 'edit.ack')
    expect(acks).toHaveLength(2)
  })

  it('baseVersion 落后但区间未受影响时平移后应用', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    // 第一个编辑在 offset 4 插入（版本 1→2），第二个请求仍基于版本 1，
    // 其编辑位置在插入点之后，应平移 +2 应用
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 4, length: 0, text: 'AB' }],
    })
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 2, baseVersion: 1,
      changes: [{ offset: 7, length: 2, text: '替换' }],
    })
    expect(s.doc.applyCalls[1]).toEqual([{ offset: 9, length: 2, text: '替换' }])
    const ack2 = s.sent.get(id)!.filter((m) => m.kind === 'edit.ack')[1]
    expect(ack2).toMatchObject({ seq: 2, ok: true, version: 3 })
  })

  it('baseVersion 过期且区间被覆盖时拒绝并附全文（#4 起进入 conflict 暂停保留）', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 3, text: '整段替换文案' }],
    })
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 2, baseVersion: 1,
      changes: [{ offset: 1, length: 1, text: 'Y' }], // 落入第一个编辑的旧区间 [0,3)
    })
    expect(s.doc.applyCalls).toHaveLength(1)
    const ack2 = s.sent.get(id)!.filter((m) => m.kind === 'edit.ack')[1]
    expect(ack2).toMatchObject({ seq: 2, ok: false, reason: 'conflict' })
    if (ack2?.kind === 'edit.ack' && !ack2.ok) {
      expect(ack2.text).toBe(s.doc.content)
    }
  })

  it('applyChanges 失败时发 error ack', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    s.doc.applyResult = false
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 0, text: 'x' }],
    })
    const ack = s.sent.get(id)!.find((m) => m.kind === 'edit.ack')
    expect(ack).toMatchObject({ seq: 1, ok: false, reason: 'error' })
  })

  it('同面板连续两个请求串行处理：第二个基于第一个应用后的版本正确重定位', async () => {
    const s = setup('abcdef')
    const id = s.attach()
    await readyPanel(s, id)
    // 模拟 webview 乐观输入：两个请求几乎同时到达且 baseVersion 相同
    const p1 = s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 0, text: '一' }],
    })
    const p2 = s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 2, baseVersion: 1,
      changes: [{ offset: 6, length: 0, text: '尾' }],
    })
    await Promise.all([p1, p2])
    expect(s.doc.content).toBe('一abcdef尾')
    const acks = s.sent.get(id)!.filter((m) => m.kind === 'edit.ack')
    expect(acks).toHaveLength(2)
  })

  it('未知 sessionId 的消息被丢弃：不应用、不回应', async () => {
    const s = setup()
    s.attach()
    await s.session.handleWebviewMessage(
      {
        kind: 'edit.request', sessionId: '不存在', docUri: DOC_URI,
        seq: 1, baseVersion: 1, changes: [{ offset: 0, length: 0, text: 'x' }],
      },
      '不存在',
    )
    expect(s.doc.applyCalls).toHaveLength(0)
  })

  it('C-4：兜底确认后迟到的回流不作为外部变更重复广播', async () => {
    const s = setup('abcdef')
    const id = s.attach()
    await readyPanel(s, id)
    // 模拟 applyEdit resolve 与回流事件之间的竞态窗口：回流延迟到达
    s.doc.fireChangeOnApply = false
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 0, text: 'X' }],
    })
    // 兜底确认路径已发 ok ack
    const ack = s.sent.get(id)!.find((m) => m.kind === 'edit.ack')
    expect(ack).toMatchObject({ seq: 1, ok: true })
    // 迟到的回流到达：识别为自家确认（已记录），不再广播给面板
    s.session.handleDocChanged([{ offset: 0, length: 0, text: 'X' }], 2)
    const broadcasts = s.sent.get(id)!.filter((m) => m.kind === 'doc.changed')
    expect(broadcasts).toHaveLength(0)
  })

  it('多段变更的回流以任意顺序到达均识别为自家确认（VSCode 回流为降序）', async () => {
    // #13 表格结构操作产生多段变更（删两行 + 插一行）；VSCode 对多段
    // WorkspaceEdit 的 onDidChangeTextDocument contentChanges 按偏移降序
    // 回流，而出站请求为升序——确认匹配必须与顺序无关，否则误判为外部
    // 变更广播回发起面板，造成自我冲突暂停
    const s = setup('AAAA\nBBBB\nCCCC\nDDDD\nEEEE\n')
    const id = s.attach()
    await readyPanel(s, id)
    // 回流延迟到达（真实 VSCode：applyEdit resolve 后才发事件），走兜底确认
    s.doc.fireChangeOnApply = false
    // 升序出站：删 [0,10)（两行）+ 在 15 处插入（CM6 合并相邻删除后的形态）
    const outbound = [
      { offset: 0, length: 10, text: '' },
      { offset: 15, length: 0, text: 'XXXX\n' },
    ]
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: outbound,
    })
    const ack = s.sent.get(id)!.find((m) => m.kind === 'edit.ack')
    expect(ack).toMatchObject({ seq: 1, ok: true })
    // 回流以降序到达（真实 VSCode 形态）：不得广播 doc.changed 给发起面板
    const refluxDesc = [...outbound].reverse()
    s.session.handleDocChanged(refluxDesc, 2)
    const broadcasts = s.sent.get(id)!.filter((m) => m.kind === 'doc.changed')
    expect(broadcasts).toHaveLength(0)
  })

  it('结构非法的消息被静默丢弃', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    await s.session.handleWebviewMessage({ kind: 'edit.request', seq: 1 }, id) // 缺字段
    await s.session.handleWebviewMessage('垃圾', id)
    await s.session.handleWebviewMessage(null, id)
    expect(s.doc.applyCalls).toHaveLength(0)
    const acks = s.sent.get(id)!.filter((m) => m.kind === 'edit.ack')
    expect(acks).toHaveLength(0)
  })
})

describe('外部变更广播与不写回保证', () => {
  it('无 pending 时文档事件广播给全部已 ready 面板', async () => {
    const s = setup()
    const idA = s.attach()
    const idB = s.attach()
    await readyPanel(s, idA)
    await readyPanel(s, idB)
    const changes = [{ offset: 0, length: 2, text: '改' }]
    s.doc.content = '改标题\n正文内容'
    s.doc.ver++
    s.session.handleDocChanged(changes, 2)
    for (const id of [idA, idB]) {
      const msg = s.sent.get(id)!.find((m) => m.kind === 'doc.changed')
      expect(msg).toMatchObject({ kind: 'doc.changed', version: 2, changes, origin: 'external' })
    }
  })

  it('只发生 ready/init 期间从不写回文档（未编辑不产生内容变化）', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    expect(s.doc.applyCalls).toHaveLength(0)
  })

  it('detach 后的面板不再收到任何消息', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    s.session.detachPanel(id)
    s.doc.ver++
    s.session.handleDocChanged([], 2)
    const after = s.sent.get(id)!.length
    await s.send(id, { kind: 'ready' }).catch(() => undefined)
    expect(s.sent.get(id)!.length).toBe(after)
  })

  it('仅有未提交组合快照时关闭可取回；快照等于权威 LF 文本时正常关闭不误报', async () => {
    const notices: SessionNotice[] = []
    const s = setup('a\r\nb', { onNotice: (notice) => notices.push(notice) })
    const first = s.attach()
    await readyPanel(s, first)
    await s.send(first, { kind: 'conflict.report', sessionId: first, docUri: DOC_URI,
      version: 1, revision: 1, text: 'a\nb候选', compositionPending: true })
    s.session.detachPanel(first)
    expect(notices).toMatchObject([{ type: 'panel-closed-with-input', webviewText: 'a\nb候选' }])

    const second = s.attach()
    await readyPanel(s, second)
    await s.send(second, { kind: 'conflict.report', sessionId: second, docUri: DOC_URI,
      version: 1, revision: 1, text: 'a\nb候选', compositionPending: true })
    await s.send(second, { kind: 'conflict.report', sessionId: second, docUri: DOC_URI,
      version: 1, revision: 2, text: 'a\nb', compositionPending: false })
    s.session.detachPanel(second)
    expect(notices).toHaveLength(1)

    const equalLf = s.attach()
    await readyPanel(s, equalLf)
    await s.send(equalLf, { kind: 'conflict.report', sessionId: equalLf, docUri: DOC_URI,
      version: 1, revision: 1, text: 'a\nb', compositionPending: true })
    s.session.detachPanel(equalLf)
    expect(notices).toHaveLength(1)

    const staleOrdinary = s.attach()
    await readyPanel(s, staleOrdinary)
    await s.send(staleOrdinary, { kind: 'conflict.report', sessionId: staleOrdinary, docUri: DOC_URI,
      version: 1, revision: 1, text: '旧快照' })
    s.session.detachPanel(staleOrdinary)
    expect(notices).toHaveLength(1)
  })

  it('组合基线后的候选增量依次更新快照，关闭时取回最新文本', async () => {
    const notices: SessionNotice[] = []
    const s = setup('a\r\nb', { onNotice: (notice) => notices.push(notice) })
    const id = s.attach()
    await readyPanel(s, id)
    await s.send(id, { kind: 'conflict.report', sessionId: id, docUri: DOC_URI,
      version: 1, revision: 1, text: 'a\nb', compositionPending: true })
    await s.send(id, { kind: 'composition.changed', sessionId: id, docUri: DOC_URI,
      revision: 2, changes: [{ offset: 3, length: 0, text: 'n' }] })
    await s.send(id, { kind: 'composition.changed', sessionId: id, docUri: DOC_URI,
      revision: 3, changes: [{ offset: 3, length: 1, text: '你' }] })
    s.session.detachPanel(id)
    expect(notices).toMatchObject([{ type: 'panel-closed-with-input', webviewText: 'a\nb你' }])
  })

  it('另一面板阻塞请求队列时，组合提交后立即关闭仍可取回；确认后正常关闭不误报', async () => {
    const source = 'a|b|c\n---|---|---\n | | \n'
    const final = 'a|b|c\n---|---|---\n| | | 你|\n'
    const rowFrom = source.indexOf(' | | ')
    const notices: SessionNotice[] = []
    const s = setup(source, { onNotice: (notice) => notices.push(notice) })
    const blocker = s.attach()
    const editing = s.attach()
    await readyPanel(s, blocker)
    await readyPanel(s, editing)
    const gate = s.doc.holdNextApply()
    void s.send(blocker, { kind: 'edit.request', sessionId: blocker, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 0, length: 0, text: 'X' }] })
    await new Promise((resolve) => setTimeout(resolve, 0)) // 第一面板占住 DocumentSession.queue
    await s.send(editing, { kind: 'conflict.report', sessionId: editing, docUri: DOC_URI,
      version: 1, revision: 1, text: final, compositionPending: true })
    void s.send(editing, { kind: 'edit.request', sessionId: editing, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: rowFrom, length: 5, text: '| | | 你|' }] })
    await s.send(editing, { kind: 'conflict.report', sessionId: editing, docUri: DOC_URI,
      version: 1, revision: 2, text: final, compositionPending: false })
    s.session.detachPanel(editing)
    expect(notices).toMatchObject([{ type: 'panel-closed-with-input', webviewText: final }])
    gate.release()

    const confirmedNotices: SessionNotice[] = []
    const confirmed = setup(source, { onNotice: (notice) => confirmedNotices.push(notice) })
    const id = confirmed.attach()
    await readyPanel(confirmed, id)
    await confirmed.send(id, { kind: 'conflict.report', sessionId: id, docUri: DOC_URI,
      version: 1, revision: 1, text: final, compositionPending: true })
    await confirmed.send(id, { kind: 'edit.request', sessionId: id, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: rowFrom, length: 5, text: '| | | 你|' }] })
    await confirmed.send(id, { kind: 'conflict.report', sessionId: id, docUri: DOC_URI,
      version: 1, revision: 2, text: final, compositionPending: false })
    confirmed.session.detachPanel(id)
    expect(confirmed.doc.getText()).toBe(final)
    expect(confirmedNotices).toHaveLength(0)
  })

  it('已确认 seq 在另一面板阻塞队列时重传，立即关闭不误报未确认输入', async () => {
    const notices: SessionNotice[] = []
    const s = setup('abc', { onNotice: (notice) => notices.push(notice) })
    const editing = s.attach()
    const blocker = s.attach()
    await readyPanel(s, editing)
    await readyPanel(s, blocker)
    const savedRequest = { kind: 'edit.request' as const, sessionId: editing, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 3, length: 0, text: '已保存' }] }
    await s.send(editing, savedRequest)
    expect(s.doc.getText()).toBe('abc已保存')
    expect(s.sent.get(editing)?.at(-1)).toMatchObject({ kind: 'edit.ack', seq: 1, ok: true })

    const gate = s.doc.holdNextApply()
    void s.send(blocker, { kind: 'edit.request', sessionId: blocker, docUri: DOC_URI,
      seq: 1, baseVersion: s.doc.ver, changes: [{ offset: 0, length: 0, text: 'X' }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    void s.send(editing, savedRequest) // 已保存请求重传，不应重新登记为未确认输入
    s.session.detachPanel(editing)
    expect(notices).toHaveLength(0)
    gate.release()
  })

  it('未确认 seq 在另一面板阻塞队列时重复到达，关闭仍可取回输入', async () => {
    const notices: SessionNotice[] = []
    const s = setup('abc', { onNotice: (notice) => notices.push(notice) })
    const blocker = s.attach()
    const editing = s.attach()
    await readyPanel(s, blocker)
    await readyPanel(s, editing)
    const gate = s.doc.holdNextApply()
    void s.send(blocker, { kind: 'edit.request', sessionId: blocker, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 0, length: 0, text: 'X' }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const unsavedRequest = { kind: 'edit.request' as const, sessionId: editing, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 3, length: 0, text: '待取回' }] }
    void s.send(editing, unsavedRequest)
    void s.send(editing, unsavedRequest)
    s.session.detachPanel(editing)
    expect(notices).toMatchObject([{ type: 'panel-closed-with-input', fragments: ['待取回'] }])
    gate.release()
  })
})

describe('CRLF 文档的换行协调（CM6 端统一 LF）', () => {
  function setupCrlf() {
    const s = setup('# 标题\r\n正文内容\r\n第三行')
    return s
  }

  it('init 发送 LF 化全文', async () => {
    const s = setupCrlf()
    const id = s.attach()
    const init = await readyPanel(s, id)
    expect(init).toMatchObject({ kind: 'init', text: '# 标题\n正文内容\n第三行' })
  })

  it('webview 的 LF 编辑转换为宿主坐标与 CRLF 文本后应用', async () => {
    const s = setupCrlf()
    const id = s.attach()
    await readyPanel(s, id)
    // LF 文档 '# 标题\n正文内容\n第三行'：在第二行行首（LF offset 5）插入
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 5, length: 0, text: '新行\n' }],
    })
    // 宿主坐标：第二行行首 = 5 + 1（越过首个 CRLF）= 6；文本换行还原 CRLF
    expect(s.doc.applyCalls).toEqual([[{ offset: 6, length: 0, text: '新行\r\n' }]])
    expect(s.doc.content).toBe('# 标题\r\n新行\r\n正文内容\r\n第三行')
  })

  it('外部变更广播给 webview 前转换为 LF 坐标与文本', async () => {
    const s = setupCrlf()
    const id = s.attach()
    await readyPanel(s, id)
    // 宿主侧变更：在宿主 offset 5 插入 'X\r\nY'（LF 侧应为 offset 4、text 'X\nY'）
    const applied = [{ offset: 5, length: 0, text: 'X\r\nY' }]
    s.doc.content = applyToText(s.doc.content, applied)
    s.doc.ver++
    s.session.handleDocChanged(applied, s.doc.ver)
    const msg = s.sent.get(id)!.find((m) => m.kind === 'doc.changed')
    expect(msg).toMatchObject({
      kind: 'doc.changed',
      changes: [{ offset: 4, length: 0, text: 'X\nY' }],
      origin: 'external',
    })
  })

  it('C-1：行尾分布变化期间的迟到请求在 LF 空间重定位（LF 形态 no-op 不被当作平移）', async () => {
    // 宿主 "a\nb\nc" v1 → 外部把第一行行尾改为 CRLF（v2，LF 空间是 no-op）
    // → 迟到请求基于 v1 在 LF offset 2（'b' 前）插 X，期望 "a\r\nXb\nc"
    const s = setup('a\nb\nc')
    const id = s.attach()
    await readyPanel(s, id)
    s.doc.content = 'a\r\nb\nc'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 1, length: 1, text: '\r\n' }], 2)
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 2, length: 0, text: 'X' }],
    })
    expect(s.doc.applyCalls).toEqual([[{ offset: 3, length: 0, text: 'X' }]])
    expect(s.doc.content).toBe('a\r\nXb\nc')
    const ack = s.sent.get(id)!.find((m) => m.kind === 'edit.ack')
    expect(ack).toMatchObject({ seq: 1, ok: true })
  })

  it('C-1：CRLF 化行尾期间的非 no-op 变更同样以 LF 空间重定位（多行尾混合场景）', async () => {
    // v1 "a\nb\nc\n"（LF）→ v2 外部把前两个行尾统一为 CRLF → 迟到请求在
    // v1 的 LF offset 5（'c' 后的换行前？即 'c' 与末行尾之间）替换 'c' 为 'Z'
    const s = setup('a\nb\nc\n')
    const id = s.attach()
    await readyPanel(s, id)
    // 宿主 v2 = "a\r\nb\r\nc\n"：两笔替换（\n → \r\n）
    s.doc.content = 'a\r\nb\r\nc\n'
    s.doc.ver++
    s.session.handleDocChanged(
      [
        { offset: 1, length: 1, text: '\r\n' },
        { offset: 3, length: 1, text: '\r\n' },
      ],
      2,
    )
    // v1 LF 坐标：'c' 在 offset 4；替换 [4,5) 'c'→'Z'
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 4, length: 1, text: 'Z' }],
    })
    // 宿主 v2 中 'c' 位于 host offset 6；期望 "a\r\nb\r\nZ\n"
    expect(s.doc.content).toBe('a\r\nb\r\nZ\n')
  })
})

describe('view.state 诊断缓存', () => {
  it('缓存最近一次 view.state 并可按面板读取', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    await s.send(id, {
      kind: 'view.state', text: '# t', docLength: 4, lineCount: 1, renderedLines: 12,
    })
    expect(s.session.getViewState(id)).toMatchObject({ renderedLines: 12, text: '# t' })
    expect(s.session.getViewState('other')).toBeUndefined()
  })
})

describe('view.state 回报回调（#38 模式编排数据源）', () => {
  it('view.state 缓存后触发 onViewState：携带 sessionId 与完整回报', async () => {
    const seen: Array<{ sessionId: string; viewMode?: string }> = []
    const s = setup('# 标题\n', {
      onViewState: (sessionId, state) => seen.push({ sessionId, viewMode: state.viewMode }),
    })
    const id = s.attach()
    await readyPanel(s, id)
    await s.send(id, {
      kind: 'view.state',
      text: '# 标题\n',
      docLength: 5,
      lineCount: 2,
      renderedLines: 2,
      viewMode: 'reading',
    })
    expect(seen).toEqual([{ sessionId: id, viewMode: 'reading' }])
    // 未注入回调时不产生副作用（缺省可选）
    const plain = setup('# 标题\n')
    const pid = plain.attach()
    await readyPanel(plain, pid)
    await plain.send(pid, {
      kind: 'view.state', text: '# 标题\n', docLength: 5, lineCount: 2, renderedLines: 2,
    })
    expect(plain.session.getViewState(pid)).toBeDefined()
  })
})

describe('history.request（撤销/重做转发到权威栈）', () => {
  async function editOnce(s: ReturnType<typeof setup>, id: string, seq: number, text: string) {
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq, baseVersion: s.doc.ver,
      changes: [{ offset: s.doc.content.length, length: 0, text }],
    })
  }

  it('undo 请求调用 port.undo，逆变更作为外部变更广播给发起面板', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await editOnce(s, id, 1, 'X') // 'abcX' v2
    const ackCountBefore = s.sent.get(id)!.filter((m) => m.kind === 'edit.ack').length
    await s.send(id, { kind: 'history.request', op: 'undo' })
    expect(s.doc.undoCalls).toBe(1)
    expect(s.doc.content).toBe('abc')
    const msgs = s.sent.get(id)!
    const changed = msgs.filter((m) => m.kind === 'doc.changed').at(-1)
    expect(changed).toMatchObject({
      kind: 'doc.changed',
      version: 3,
      changes: [{ offset: 3, length: 1, text: '' }],
      origin: 'external',
    })
    // undo 不产生新 ack（不把逆变更误判为本会话编辑确认，防回声）
    expect(msgs.filter((m) => m.kind === 'edit.ack')).toHaveLength(ackCountBefore)
  })

  it('redo 请求调用 port.redo 并把正向变更广播给面板', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await editOnce(s, id, 1, 'X')
    await s.send(id, { kind: 'history.request', op: 'undo' })
    await s.send(id, { kind: 'history.request', op: 'redo' })
    expect(s.doc.redoCalls).toBe(1)
    expect(s.doc.content).toBe('abcX')
    const changed = s.sent.get(id)!.filter((m) => m.kind === 'doc.changed').at(-1)
    expect(changed).toMatchObject({
      kind: 'doc.changed',
      changes: [{ offset: 3, length: 0, text: 'X' }],
      origin: 'external',
    })
  })

  it('history 请求排在在途 edit.request 之后：编辑先应用再撤销', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    const p1 = editOnce(s, id, 1, 'X')
    const p2 = s.send(id, { kind: 'history.request', op: 'undo' })
    await Promise.all([p1, p2])
    expect(s.doc.undoCalls).toBe(1)
    // 编辑应用后立即被撤销：文本回到原文，且 undo 的逆变更广播出去
    expect(s.doc.content).toBe('abc')
  })

  it('非法 op 的 history.request 被协议校验整体丢弃', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await s.session.handleWebviewMessage({ kind: 'history.request', op: 'wrong' }, id)
    expect(s.doc.undoCalls + s.doc.redoCalls).toBe(0)
  })

  it('未 ready 面板的 history.request 被忽略', async () => {
    const s = setup('abc')
    const id = s.attach()
    await s.session.handleWebviewMessage({ kind: 'history.request', op: 'undo' }, id)
    expect(s.doc.undoCalls).toBe(0)
  })
})

describe('B-2：暂停面板重载后的冲突快照来源', () => {
  async function suspendPanel(s: ReturnType<typeof setup>, id: string) {
    // 外部覆盖原文区间，使后续基于旧版本的请求不可安全重定位
    s.doc.content = '外部全文'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 0, length: 2, text: '外部全文' }], s.doc.ver)
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 1, text: '本' }],
    })
    expect(s.session.getConflictState(id)?.suspended).toBe(true)
  }

  it('ready 重发 init 后 reloaded 置位：宿主快照不被重载冲掉，resume 清除标记', async () => {
    const s = setup('草稿')
    const id = s.attach()
    await readyPanel(s, id)
    await suspendPanel(s, id)
    // webview 重载（retainContextWhenHidden 关闭）：ready → init 重发权威全文
    await s.send(id, { kind: 'ready' })
    const init = s.sent.get(id)!.at(-2)
    expect(init).toMatchObject({ kind: 'init', text: '外部全文' })
    const state = s.session.getConflictState(id)!
    expect(state.reloaded).toBe(true)
    // 冲突留存（fragments/webviewText）仍可用于复制取回
    expect(state.fragments).toContain('本')
    // 恢复：清除标记，面板回归正常
    s.session.resumePanel(id)
    const resumed = s.session.getConflictState(id)!
    expect(resumed.reloaded).toBe(false)
    expect(resumed.suspended).toBe(false)
  })

  it('未暂停面板的 reloaded 不影响常规诊断', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    expect(s.session.getConflictState(id)?.reloaded).toBe(false)
  })
})

describe('sync.request（webview 发起的全文重同步）', () => {
  it('回复 doc.resync：附当前版本与 LF 化全文', async () => {
    const s = setup('# 标题\r\n正文')
    const id = s.attach()
    await readyPanel(s, id)
    s.doc.content = '# 标题\r\n外部改写'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 4, length: 2, text: '外部改写' }], 2)
    await s.send(id, { kind: 'sync.request' })
    const resync = s.sent.get(id)!.at(-1)
    expect(resync).toMatchObject({ kind: 'doc.resync', version: 2, text: '# 标题\n外部改写' })
  })

  it('未 ready 面板的 sync.request 被忽略', async () => {
    const s = setup('abc')
    const id = s.attach()
    await s.session.handleWebviewMessage({ kind: 'sync.request' }, id)
    expect(s.sent.get(id)!.length).toBe(0)
  })
})

describe('perf.report 缓存（#5 性能测量通道）', () => {
  const report: Extract<WebviewToHost, { kind: 'perf.report' }> = {
    kind: 'perf.report',
    firstInputSettledEpochMs: 1760000000000,
    typingRounds: 2,
    scrollRounds: 1,
    docLines: 10,
    baseline: { renderedLines: 5, contentDomCount: 40, headingLineCount: 1, inviewHeadingCount: 1 },
    afterTyping: { renderedLines: 5, contentDomCount: 41, headingLineCount: 1, inviewHeadingCount: 1 },
    afterScroll: { renderedLines: 5, contentDomCount: 40, headingLineCount: 1, inviewHeadingCount: 1 },
    inputDelayMs: { samples: [4, 6], avgMs: 5, maxMs: 6 },
    longTasks: null,
    headingStats: { totalUpdates: 3, lastUpdateScannedLines: 1, fullBuildLines: 10 },
  }

  it('缓存最近一次 perf.report 并可按面板读取', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    expect(s.session.getLastPerfReport(id)).toBeUndefined()
    await s.send(id, report)
    expect(s.session.getLastPerfReport(id)?.docLines).toBe(10)
  })

  it('结构非法的 perf.report 被整体丢弃', async () => {
    const s = setup()
    const id = s.attach()
    await readyPanel(s, id)
    await s.send(id, { ...report, baseline: null } as unknown as WebviewToHost)
    expect(s.session.getLastPerfReport(id)).toBeUndefined()
  })
})

describe('P3 修复批：B-4 / B-6 / C-6', () => {
  async function suspendById(
    s: ReturnType<typeof setup>,
    id: string,
  ): Promise<void> {
    s.doc.content = '外部全文'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 0, length: 2, text: '外部全文' }], s.doc.ver)
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 0, length: 1, text: '本' }],
    })
    expect(s.session.getConflictState(id)?.suspended).toBe(true)
  }

  it('B-4：暂停面板的 history.request 被忽略（与 edit.request 一致）', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await suspendById(s, id)
    await s.send(id, { kind: 'history.request', op: 'undo' })
    expect(s.doc.undoCalls).toBe(0)
  })

  it('B-6：CRLF 文档在途 pending（宿主系）留存片段以 LF 形态入库', async () => {
    const notices: SessionNotice[] = []
    const s = setup('# 标题\r\n正文内容\r\n第三行', { onNotice: (n) => notices.push(n) })
    const id = s.attach()
    await readyPanel(s, id)
    const gate = s.doc.holdNextApply() // applyEdit 挂起：pending 处于在途窗口
    void s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI, seq: 1, baseVersion: 1,
      changes: [{ offset: 4, length: 0, text: '第一\n二' }],
    })
    await new Promise((r) => setTimeout(r, 0)) // seq1 已 push pending（宿主系 CRLF 文本）并挂起
    s.session.detachPanel(id) // 关闭面板：未确认输入必须留存通知
    const notice = notices.find((n) => n.type === 'panel-closed-with-input')
    expect(notice).toBeDefined()
    if (notice?.type === 'panel-closed-with-input') {
      // 片段统一 LF 形态（可读、与 webview 输入一致），不得混入 \r\n
      expect(notice.fragments).toEqual(['第一\n二'])
    }
    gate.release()
  })

  it('C-6：docUri 不匹配的 conflict.report 被忽略', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await s.send(id, {
      kind: 'conflict.report', sessionId: id, docUri: 'file:///other.md', version: 1, revision: 1, text: '他人快照',
    })
    expect(s.session.getConflictState(id)?.webviewText).toBeUndefined()
  })

  it('C-6：docUri 不匹配的 conflict.action 被忽略', async () => {
    const s = setup('abc')
    const id = s.attach()
    await readyPanel(s, id)
    await suspendById(s, id)
    const before = s.session.getConflictState(id)
    expect(before?.suspended).toBe(true)
    await s.send(id, {
      kind: 'conflict.action', sessionId: id, docUri: 'file:///other.md', action: 'resume',
    })
    // 非本文档的恢复请求不得解除暂停
    expect(s.session.getConflictState(id)?.suspended).toBe(true)
  })
})

// ---- 工单 #10：链接跳转与图片解析的会话路由 ----

async function ready10(s: ReturnType<typeof setup>, id: string): Promise<void> {
  await s.send(id, { kind: 'ready' })
}

describe('#10 link.activate：会话校验后交面板端口执行', () => {
  it('ready 面板的合法意图路由到 openLink（携带原始 href 与源位置）', async () => {
    const s = setup()
    const opened: Array<{ href: string; srcStart: number; srcEnd: number }> = []
    const id = s.session.attachPanel({
      send: () => undefined,
      openLink: (intent) => opened.push(intent),
    })
    await ready10(s, id)
    await s.send(id, {
      kind: 'link.activate', sessionId: id, docUri: DOC_URI,
      href: './目标 文档.md', srcStart: 10, srcEnd: 30,
    })
    expect(opened).toEqual([{ href: './目标 文档.md', srcStart: 10, srcEnd: 30 }])
  })

  it('docUri 不匹配或未 ready 的意图被丢弃，不触达 openLink', async () => {
    const s = setup()
    const opened: unknown[] = []
    const id = s.session.attachPanel({
      send: () => undefined,
      openLink: (intent) => opened.push(intent),
    })
    // 未 ready：丢弃
    await s.session.handleWebviewMessage(
      { kind: 'link.activate', sessionId: id, docUri: DOC_URI, href: './a.md', srcStart: 0, srcEnd: 1 },
      id,
    )
    expect(opened).toEqual([])
    await ready10(s, id)
    // docUri 不匹配：丢弃
    await s.send(id, {
      kind: 'link.activate', sessionId: id, docUri: 'file:///other.md', href: './a.md', srcStart: 0, srcEnd: 1,
    })
    expect(opened).toEqual([])
    // 合法：触达
    await s.send(id, { kind: 'link.activate', sessionId: id, docUri: DOC_URI, href: './a.md', srcStart: 0, srcEnd: 1 })
    expect(opened.length).toBe(1)
  })

  it('暂停（冲突）面板的链接意图仍被放行：跳转是只读交互，不受写回暂停影响', async () => {
    const s = setup('abc')
    const opened: unknown[] = []
    const id = s.session.attachPanel({
      send: () => undefined,
      openLink: (intent) => opened.push(intent),
    })
    await ready10(s, id)
    // 触发暂停：不可安全应用的过期请求
    s.doc.content = '外部改写'
    s.doc.ver++
    s.session.handleDocChanged([{ offset: 0, length: 3, text: '外部改写' }], 2)
    await s.send(id, {
      kind: 'edit.request', sessionId: id, docUri: DOC_URI,
      seq: 1, baseVersion: 1, changes: [{ offset: 0, length: 2, text: '未确认' }],
    })
    expect(s.session.getConflictState(id)?.suspended).toBe(true)
    await s.send(id, {
      kind: 'link.activate', sessionId: id, docUri: DOC_URI, href: 'https://example.com', srcStart: 0, srcEnd: 5,
    })
    expect(opened.length).toBe(1)
  })
})

describe('#10 image.request：会话解析、去重与结果回发', () => {
  function imageSetup(resolve: (src: string) => Promise<{ ok: true; src: string } | { ok: false; reason: 'blocked' | 'outside-workspace' | 'not-found' | 'read-error' }>) {
    const s = setup()
    const calls: string[] = []
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      resolveImage: async (src) => {
        calls.push(src)
        return resolve(src)
      },
    })
    return { s, calls, out, id }
  }

  it('请求经 resolveImage 解析并以 image.result 回发（reqId 对应）', async () => {
    const t = imageSetup(async () => ({ ok: true, src: 'vscode-webview://res/a.png' }))
    await ready10(t.s, t.id)
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 7, src: './a.png' })
    expect(t.calls).toEqual(['./a.png'])
    expect(t.out.filter((m) => m.kind === 'image.result')).toEqual([
      { kind: 'image.result', reqId: 7, ok: true, src: 'vscode-webview://res/a.png' },
    ])
  })

  it('并发同 src 去重为单次解析；成功结果缓存：后续请求不再触达解析器', async () => {
    const t = imageSetup(async () => ({ ok: true, src: 'vscode-webview://res/a.png' }))
    await ready10(t.s, t.id)
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 1, src: './a.png' })
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 2, src: './a.png' })
    expect(t.calls.length).toBe(1)
    expect(t.out.filter((m) => m.kind === 'image.result').length).toBe(2)
    // 缓存命中：第三次请求（如滚动回视口）直接回发缓存结果
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 3, src: './a.png' })
    expect(t.calls.length).toBe(1)
    expect(t.out.filter((m) => m.kind === 'image.result').length).toBe(3)
  })

  it('失败结果不缓存：重试（新请求）重新触达解析器', async () => {
    let fail = true
    const t = imageSetup(async () =>
      fail ? { ok: false as const, reason: 'not-found' as const } : { ok: true as const, src: 'res://x' },
    )
    await ready10(t.s, t.id)
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 1, src: './miss.png' })
    fail = false
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 2, src: './miss.png' })
    expect(t.calls.length).toBe(2)
    const results = t.out.filter((m) => m.kind === 'image.result')
    expect((results[0] as { ok: boolean }).ok).toBe(false)
    expect((results[1] as { ok: boolean }).ok).toBe(true)
  })

  it('未注入解析器的面板与未 ready 面板的请求不解析；前者回发 read-error', async () => {
    const s = setup()
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({ send: (m) => out.push(m) })
    // 未 ready：丢弃
    await s.session.handleWebviewMessage(
      { kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId: 1, src: './a.png' },
      id,
    )
    expect(out.filter((m) => m.kind === 'image.result').length).toBe(0)
    await ready10(s, id)
    await s.send(id, { kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId: 2, src: './a.png' })
    const results = out.filter((m) => m.kind === 'image.result')
    expect(results.length).toBe(1)
    expect((results[0] as { ok: boolean; reason?: string }).ok).toBe(false)
    expect((results[0] as { reason?: string }).reason).toBe('read-error')
  })
})

// ---- 工单 #201：图片缓存失效通道与周期核验路由 ----

describe('#201 图片失效通道：缓存删除与全面板广播', () => {
  const req = (id: string, reqId: number, src: string): WebviewToHost =>
    ({ kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId, src }) as WebviewToHost

  it('成功解析登记目标映射：invalidateImagesByFsPath 删缓存并广播全部面板', async () => {
    const s = setup()
    const calls: string[] = []
    const panelA: HostToWebview[] = []
    const panelB: HostToWebview[] = []
    const mk = (out: HostToWebview[]) =>
      s.session.attachPanel({
        send: (m) => out.push(m),
        resolveImage: async (src) => {
          calls.push(src)
          return { ok: true, src: `res://${src}?v=1`, fsPath: 'D:/notes/img/a.png' }
        },
      })
    const idA = mk(panelA)
    const idB = mk(panelB)
    await ready10(s, idA)
    await ready10(s, idB)
    await s.send(idA, req(idA, 1, './a.png'))
    expect(calls.length).toBe(1)
    // 缓存命中：面板 B 同 src 请求不再触达解析器
    await s.send(idB, req(idB, 2, './a.png'))
    expect(calls.length).toBe(1)
    // 失效（路径写法与登记不同——按归一目标匹配）
    s.session.invalidateImagesByFsPath('d:\\notes\\IMG\\a.png')
    expect(panelA.filter((m) => m.kind === 'image.invalidate')).toEqual([
      { kind: 'image.invalidate', srcs: ['./a.png'] },
    ])
    expect(panelB.filter((m) => m.kind === 'image.invalidate')).toEqual([
      { kind: 'image.invalidate', srcs: ['./a.png'] },
    ])
    // 失效后重新请求触达解析器（缓存已删）
    await s.send(idA, req(idA, 3, './a.png'))
    expect(calls.length).toBe(2)
  })

  it('失效只命中同目标文件：其他 src 的缓存不受影响', async () => {
    const s = setup()
    const calls: string[] = []
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      resolveImage: async (src) => {
        calls.push(src)
        return {
          ok: true,
          src: `res://${src}`,
          fsPath: src === './a.png' ? 'D:/notes/a.png' : 'D:/notes/b.png',
        }
      },
    })
    await ready10(s, id)
    await s.send(id, req(id, 1, './a.png'))
    await s.send(id, req(id, 2, './b.png'))
    expect(calls.length).toBe(2)
    s.session.invalidateImagesByFsPath('D:/notes/a.png')
    // b.png 未失效：再次请求命中缓存
    await s.send(id, req(id, 3, './b.png'))
    expect(calls.length).toBe(2)
    expect(out.filter((m) => m.kind === 'image.invalidate')).toEqual([
      { kind: 'image.invalidate', srcs: ['./a.png'] },
    ])
  })

  it('在途请求跨失效窗口完成：结果照发但不再写入缓存（迟到结果不复活旧解析）', async () => {
    const s = setup()
    const calls: string[] = []
    const out: HostToWebview[] = []
    let release: (() => void) | undefined
    let hold = true
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      resolveImage: (src) => {
        calls.push(src)
        if (!hold) {
          return Promise.resolve({ ok: true as const, src: 'res://new?v=2', fsPath: 'D:/notes/a.png' })
        }
        return new Promise((resolvePromise) => {
          release = () => resolvePromise({ ok: true as const, src: 'res://old?v=1', fsPath: 'D:/notes/a.png' })
        })
      },
    })
    await ready10(s, id)
    const pending = s.send(id, req(id, 1, './a.png'))
    // 解析在途时目标文件变更：失效先到达（在途登记未发生——反查为空，
    // 失效时钟仍推进）
    s.session.invalidateImagesByFsPath('D:/notes/a.png')
    hold = false
    release!()
    await pending
    // 在途结果仍回发给请求面板（webview 侧代次守卫按 reqId 丢弃），
    // 完成时按失效时钟检出覆盖：不写缓存并补发失效广播
    expect(out.filter((m) => m.kind === 'image.result').length).toBe(1)
    expect(out.filter((m) => m.kind === 'image.invalidate')).toEqual([
      { kind: 'image.invalidate', srcs: ['./a.png'] },
    ])
    // 补失效后缓存未写入：下一次请求重新触达解析器
    await s.send(id, req(id, 2, './a.png'))
    expect(calls.length).toBe(2)
  })

  it('fsPath 未随解析结果提供时（旧注入形态）：失效不产生假阳性广播', async () => {
    const s = setup()
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      resolveImage: async () => ({ ok: true, src: 'res://a' }),
    })
    await ready10(s, id)
    await s.send(id, req(id, 1, './a.png'))
    // 无 fsPath 登记：按归一 fsPath 找不到 → 不广播
    s.session.invalidateImagesByFsPath('D:/notes/a.png')
    expect(out.filter((m) => m.kind === 'image.invalidate').length).toBe(0)
  })
})

describe('#201 周期核验路由（image.verify）：端口透传与串行合并', () => {
  it('会话守卫：未 ready 的 verify 丢弃，不触达端口', async () => {
    const seen: number[] = []
    const session = new DocumentSession(new FakeDoc('# t'), {
      docUri: DOC_URI,
      verifyImages: async (items) => {
        seen.push(items.length)
      },
    })
    const out: HostToWebview[] = []
    const id = session.attachPanel({ send: (m) => out.push(m) })
    await session.handleWebviewMessage(
      { kind: 'image.verify', sessionId: id, docUri: DOC_URI, items: [{ src: './a.png', state: 'loaded' }] },
      id,
    )
    expect(seen).toEqual([])
  })

  it('ready 面板的 verify 经注入端口透传（决策与失效由 provider 协调器执行）', async () => {
    const seen: Array<Array<{ src: string; state: string; reason?: string }>> = []
    const doc = new FakeDoc('# t')
    const session = new DocumentSession(doc, {
      docUri: DOC_URI,
      verifyImages: async (items) => {
        seen.push(items.map((i) => ({ src: i.src, state: i.state, reason: i.reason })))
      },
    })
    const out: HostToWebview[] = []
    const id = session.attachPanel({ send: (m) => out.push(m) })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    await session.handleWebviewMessage(
      { kind: 'image.verify', sessionId: id, docUri: DOC_URI, items: [{ src: './a.png', state: 'loaded' }] },
      id,
    )
    expect(seen).toEqual([[{ src: './a.png', state: 'loaded', reason: undefined }]])
  })

  it('docUri 不匹配的 verify 丢弃', async () => {
    const seen: number[] = []
    const session = new DocumentSession(new FakeDoc('# t'), {
      docUri: DOC_URI,
      verifyImages: async (items) => {
        seen.push(items.length)
      },
    })
    const out: HostToWebview[] = []
    const id = session.attachPanel({ send: (m) => out.push(m) })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    await session.handleWebviewMessage(
      { kind: 'image.verify', sessionId: id, docUri: 'file:///other.md', items: [{ src: './a.png', state: 'loaded' }] },
      id,
    )
    expect(seen).toEqual([])
  })

  it('并发 verify 串行合并（并发有界）：第二轮等第一轮端口完成', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const session = new DocumentSession(new FakeDoc('# t'), {
      docUri: DOC_URI,
      verifyImages: (items) => {
        order.push(`start-${items.length}`)
        if (!releaseFirst) {
          return new Promise<void>((resolvePromise) => {
            releaseFirst = () => {
              order.push('end-1')
              resolvePromise()
            }
          })
        }
        order.push('end-2')
        return Promise.resolve()
      },
    })
    const out: HostToWebview[] = []
    const id = session.attachPanel({ send: (m) => out.push(m) })
    await session.handleWebviewMessage({ kind: 'ready' }, id)
    const first = session.handleWebviewMessage(
      { kind: 'image.verify', sessionId: id, docUri: DOC_URI, items: [{ src: './a.png', state: 'loaded' }] },
      id,
    )
    const second = session.handleWebviewMessage(
      {
        kind: 'image.verify', sessionId: id, docUri: DOC_URI,
        items: [
          { src: './a.png', state: 'loaded' },
          { src: './b.png', state: 'error', reason: 'not-found' },
        ],
      },
      id,
    )
    // 第一轮挂起时第二轮不启动（串行）：让出入队微任务后首轮端口已启动
    await Promise.resolve()
    expect(order).toEqual(['start-1'])
    releaseFirst!()
    await Promise.all([first, second])
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })
})

describe('#208 手动刷新：图片缓存失效与资源代次', () => {
  function refreshSetup() {
    const s = setup()
    const calls: string[] = []
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      resolveImage: async (src) => {
        calls.push(src)
        // 每次解析产新地址：模拟刷新后宿主代次换戳的新 URI
        return { ok: true, src: `vscode-webview://res/a.png?attempt=${calls.length}` }
      },
    })
    return { s, calls, out, id }
  }

  it('初始资源代次为 0（未刷新初值：URI 不带戳的现状语义）', () => {
    const s = setup()
    expect(s.session.getImageGeneration()).toBe(0)
  })

  it('refresh.request 清空图片缓存、代次自增并回发 refresh.invalidated（reqId 配对）', async () => {
    const t = refreshSetup()
    await ready10(t.s, t.id)
    // 先解析一次使 imageCache 有存量
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 1, src: './a.png' })
    expect(t.calls.length).toBe(1)
    await t.s.send(t.id, { kind: 'refresh.request', sessionId: t.id, docUri: DOC_URI, reqId: 5 })
    expect(t.out).toContainEqual({ kind: 'refresh.invalidated', reqId: 5, generation: 1 })
    expect(t.s.session.getImageGeneration()).toBe(1)
    // 缓存已清：同 src 再请求重新触达解析器（新地址即新代次戳的替身）
    await t.s.send(t.id, { kind: 'image.request', sessionId: t.id, docUri: DOC_URI, reqId: 2, src: './a.png' })
    expect(t.calls.length).toBe(2)
    // 再刷新：代次继续自增、reqId 各自配对
    await t.s.send(t.id, { kind: 'refresh.request', sessionId: t.id, docUri: DOC_URI, reqId: 6 })
    expect(t.out).toContainEqual({ kind: 'refresh.invalidated', reqId: 6, generation: 2 })
    expect(t.s.session.getImageGeneration()).toBe(2)
  })

  it('未 ready 或 docUri 不符的 refresh.request 静默丢弃（会话守卫与 image.request 同款）', async () => {
    const s = setup()
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({ send: (m) => out.push(m) })
    // 未 ready：丢弃
    await s.send(id, { kind: 'refresh.request', sessionId: id, docUri: DOC_URI, reqId: 1 })
    expect(out.filter((m) => m.kind === 'refresh.invalidated')).toEqual([])
    expect(s.session.getImageGeneration()).toBe(0)
    await ready10(s, id)
    // docUri 不符：丢弃
    await s.send(id, { kind: 'refresh.request', sessionId: id, docUri: 'file:///other.md', reqId: 2 })
    expect(out.filter((m) => m.kind === 'refresh.invalidated')).toEqual([])
    expect(s.session.getImageGeneration()).toBe(0)
  })

  it('暂停面板的 refresh.request 同样放行（只读交互，不写文档不入撤销栈）', async () => {
    const t = refreshSetup()
    await ready10(t.s, t.id)
    // 制造冲突暂停：baseVersion 超前的请求不可安全应用
    await t.s.send(t.id, {
      kind: 'edit.request', sessionId: t.id, docUri: DOC_URI,
      seq: 1, baseVersion: 99, changes: [{ offset: 0, length: 0, text: 'x' }],
    })
    const suspendedAck = t.out.find(
      (m) => m.kind === 'edit.ack' && m.ok === false && m.reason === 'conflict',
    )
    expect(suspendedAck).toBeDefined()
    await t.s.send(t.id, { kind: 'refresh.request', sessionId: t.id, docUri: DOC_URI, reqId: 1 })
    expect(t.out).toContainEqual({ kind: 'refresh.invalidated', reqId: 1, generation: 1 })
  })

  it('在途解析回调晚于 invalidate 到达：旧代次 URI 不得写入缓存（竞态修复）', async () => {
    // 复现路径：image.request（第一代）发起 → 解析挂起 → refresh.request
    // （invalidate：清缓存 + 代次自增）→ 在途回调此刻才携旧代次 URI 完成。
    // 修复前它会写回 imageCache，刷新后的重挂请求经同 src 缓存命中旧 URI，
    // 该图本轮不换新。
    const s = setup()
    const calls: string[] = []
    const gates: Array<(src: string) => void> = []
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      resolveImage: (src) => {
        calls.push(src)
        return new Promise((resolve) => {
          gates.push((resolved) => resolve({ ok: true, src: resolved }))
        })
      },
    })
    await ready10(s, id)
    // 第一代请求在途（resolver 同步触达，Promise 挂起）
    const first = s.send(id, { kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId: 1, src: './a.png' })
    expect(calls).toEqual(['./a.png'])
    // 刷新在在途窗口内到达
    await s.send(id, { kind: 'refresh.request', sessionId: id, docUri: DOC_URI, reqId: 9 })
    expect(s.session.getImageGeneration()).toBe(1)
    // 在途回调此刻完成（旧代次地址）
    gates[0]!('vscode-webview://res/a.png')
    await first
    // 刷新后的重挂请求：不得命中旧代次 URI——解析器应被重新触达
    const second = s.send(id, { kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId: 2, src: './a.png' })
    await Promise.resolve()
    expect(calls.length, '刷新后同 src 新请求应重新解析（旧代次 URI 不得入缓存）').toBe(2)
    gates[1]!('vscode-webview://res/a.png?v=1')
    await second
    const results = out.filter((m) => m.kind === 'image.result')
    expect(results[0]).toMatchObject({ reqId: 1, ok: true, src: 'vscode-webview://res/a.png' })
    expect(results[1]).toMatchObject({ reqId: 2, ok: true, src: 'vscode-webview://res/a.png?v=1' })
  })
})

// ---- 工单 #81：代码块复制的行尾归一（webview 出站恒为 LF） ----

describe('#81 codeblock.copy：按文档 EOL 归一后交剪贴板端口', () => {
  async function sendCopy(eol: 1 | 2): Promise<string[]> {
    const s = setup()
    s.doc.eol = eol
    const copies: string[] = []
    const id = s.session.attachPanel({
      send: () => undefined,
      writeClipboard: (text) => copies.push(text),
    })
    await ready10(s, id)
    await s.send(id, { kind: 'codeblock.copy', sessionId: id, docUri: DOC_URI, text: 'let a = 1\n\nconst b' })
    return copies
  }

  it('CRLF 文档：剪贴板收到 \r\n 文本（复制产物与文档行尾一致）', async () => {
    expect(await sendCopy(2)).toEqual(['let a = 1\r\n\r\nconst b'])
  })

  it('LF 文档：剪贴板收到原文（无二次转换）', async () => {
    expect(await sendCopy(1)).toEqual(['let a = 1\n\nconst b'])
  })

  it('docUri 不匹配或未 ready 的复制请求被丢弃', async () => {
    const s = setup()
    const copies: string[] = []
    const id = s.session.attachPanel({
      send: () => undefined,
      writeClipboard: (text) => copies.push(text),
    })
    await s.session.handleWebviewMessage(
      { kind: 'codeblock.copy', sessionId: id, docUri: DOC_URI, text: 'a' },
      id,
    )
    expect(copies).toEqual([])
    await ready10(s, id)
    await s.send(id, { kind: 'codeblock.copy', sessionId: id, docUri: 'file:///other.md', text: 'a' })
    expect(copies).toEqual([])
  })
})

describe('#69 clipboard.write：两变体路由到注入端口', () => {
  it('text 变体直写 writeClipboard（原样文本，不拼接）', async () => {
    const s = setup()
    const written: string[] = []
    const links: unknown[] = []
    const id = s.session.attachPanel({
      send: () => undefined,
      writeClipboard: (text) => written.push(text),
      writeHeadingLinkClipboard: (docUri, heading) => links.push([docUri, heading]),
    })
    await s.send(id, { kind: 'clipboard.write', text: '标题\n多行' })
    expect(written).toEqual(['标题\n多行'])
    expect(links).toEqual([])
  })

  it('CRLF 文档的 text 变体按权威行尾归一（LF 出站转 \r\n；#81 同 codeblock.copy——review-loops 修复）', async () => {
    const s = setup('段落一\r\n段落二')
    s.doc.eol = 2
    const written: string[] = []
    const id = s.session.attachPanel({
      send: () => undefined,
      writeClipboard: (text) => written.push(text),
    })
    await s.send(id, { kind: 'clipboard.write', text: '段落一\n段落二' })
    expect(written).toEqual(['段落一\r\n段落二'])
  })

  it('linkHeading 变体路由 writeHeadingLinkClipboard（docUri + 剥标记标题）', async () => {
    const s = setup()
    const written: unknown[] = []
    const links: Array<[string, string]> = []
    const id = s.session.attachPanel({
      send: () => undefined,
      writeClipboard: (text) => written.push(text),
      writeHeadingLinkClipboard: (docUri, heading) => links.push([docUri, heading]),
    })
    await s.send(id, {
      kind: 'clipboard.write',
      linkHeading: { docUri: 'file:///d%3A/notes/a.md', heading: '重点 结论' },
    })
    expect(links).toEqual([['file:///d%3A/notes/a.md', '重点 结论']])
    expect(written).toEqual([])
  })

  it('未注入端口的面板静默忽略（可选端口，无副作用）', async () => {
    const s = setup()
    const id = s.session.attachPanel({ send: () => undefined })
    await s.send(id, { kind: 'clipboard.write', text: 'x' })
    // 无异常即通过
  })

  it('linkBlock 变体路由 writeBlockLinkClipboard（docUri + 块 id，#162）', async () => {
    const s = setup()
    const written: unknown[] = []
    const headingLinks: unknown[] = []
    const blockLinks: Array<[string, string]> = []
    const id = s.session.attachPanel({
      send: () => undefined,
      writeClipboard: (text) => written.push(text),
      writeHeadingLinkClipboard: (docUri, heading) => headingLinks.push([docUri, heading]),
      writeBlockLinkClipboard: (docUri, blockId) => blockLinks.push([docUri, blockId]),
    })
    await s.send(id, {
      kind: 'clipboard.write',
      linkBlock: { docUri: 'file:///d%3A/notes/a.md', blockId: 'abcd' },
    })
    expect(blockLinks).toEqual([['file:///d%3A/notes/a.md', 'abcd']])
    expect(written).toEqual([])
    expect(headingLinks).toEqual([])
  })
})

describe('图表导出路由（#111）', () => {
  it('diagram.export 转发注入端口，report 结果回来源面板', async () => {
    const doc = new FakeDoc('x')
    const s = new DocumentSession(doc, { docUri: 'file:///d/a.md' })
    const toWebview: HostToWebview[] = []
    const received: unknown[] = []
    const id = s.attachPanel({
      send: (m) => toWebview.push(m),
      exportDiagram: (payload, report) => {
        received.push(payload)
        report({ ok: false, reason: 'cancelled' })
      },
    })
    await s.handleWebviewMessage({ kind: 'ready' }, id)
    await s.handleWebviewMessage(
      {
        kind: 'diagram.export',
        sessionId: id,
        docUri: 'file:///d/a.md',
        reqId: 7,
        format: 'svg',
        fileName: 'mermaid-diagram.svg',
        content: '<svg/>',
      },
      id,
    )
    expect(received).toHaveLength(1)
    const result = toWebview.at(-1) as { kind: string; reqId: number; ok: boolean; reason?: string }
    expect(result.kind).toBe('diagram.export.result')
    expect(result.reqId).toBe(7)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('cancelled')
  })

  it('会话守卫：面板未就绪或 docUri 不匹配时静默丢弃（对齐 codeblock.copy）', async () => {
    const doc = new FakeDoc('x')
    const s = new DocumentSession(doc, { docUri: 'file:///d/a.md' })
    const toWebview: HostToWebview[] = []
    const received: unknown[] = []
    const id = s.attachPanel({
      send: (m) => toWebview.push(m),
      exportDiagram: (payload, report) => {
        received.push(payload)
        report({ ok: true })
      },
    })
    // 未 ready：丢弃
    await s.handleWebviewMessage(
      {
        kind: 'diagram.export',
        sessionId: id,
        docUri: 'file:///d/a.md',
        reqId: 9,
        format: 'svg',
        fileName: 'a.svg',
        content: '<svg/>',
      },
      id,
    )
    // ready 后 docUri 不匹配：同样丢弃
    await s.handleWebviewMessage({ kind: 'ready' }, id)
    await s.handleWebviewMessage(
      {
        kind: 'diagram.export',
        sessionId: id,
        docUri: 'file:///d/other.md',
        reqId: 10,
        format: 'svg',
        fileName: 'a.svg',
        content: '<svg/>',
      },
      id,
    )
    expect(received).toHaveLength(0)
    expect(toWebview.filter((m) => m.kind === 'diagram.export.result')).toHaveLength(0)
  })

  it('未注入导出端口：回报 invalid（不抛错）', async () => {
    const doc = new FakeDoc('x')
    const s = new DocumentSession(doc, { docUri: 'file:///d/a.md' })
    const toWebview: HostToWebview[] = []
    const id = s.attachPanel({ send: (m) => toWebview.push(m) })
    await s.handleWebviewMessage({ kind: 'ready' }, id)
    await s.handleWebviewMessage(
      {
        kind: 'diagram.export',
        sessionId: id,
        docUri: 'file:///d/a.md',
        reqId: 8,
        format: 'png',
        fileName: 'x.png',
        content: 'aGk=',
      },
      id,
    )
    const result = toWebview.at(-1) as { kind: string; reason?: string }
    expect(result.kind).toBe('diagram.export.result')
    expect(result.reason).toBe('invalid')
  })
})

describe('定位意图送达确认与补发边界（#163 验收反馈：已送达定位不得重播）', () => {
  /** postToPanel 发出的 view.locate 计入 sent；重握手（再次 ready）后
   *  出现的 view.locate 即补发。ack 送达确认前补发兜底，送达后由 webview
   *  持久化锚点接管恢复，宿主不再重播——用户手动移位不被历史程序定位拉回 */
  const locateOffsets = (s: ReturnType<typeof setup>, id: string): number[] =>
    s.sent
      .get(id)!
      .filter((m): m is Extract<HostToWebview, { kind: 'view.locate' }> => m.kind === 'view.locate')
      .map((m) => m.offset)

  it('定位未送达（面板重载竞态）：重握手补发兜底保持', async () => {
    const s = setup('# 标题\n\n正文段落\n')
    const id = s.attach()
    await readyPanel(s, id)
    s.session.postToPanel(id, { kind: 'view.locate', offset: 7 })
    // webview 实例在定位消息送达前销毁：ack 不会到来，重握手补发兜底
    // （重握手不走 readyPanel——补发时 init 不是末条消息）
    await s.send(id, { kind: 'ready' })
    expect(locateOffsets(s, id)).toEqual([7, 7])
  })

  it('送达确认后：重握手不再补发（用户手动移位不被拉回）', async () => {
    const s = setup('# 标题\n\n正文段落\n')
    const id = s.attach()
    await readyPanel(s, id)
    s.session.postToPanel(id, { kind: 'view.locate', offset: 7 })
    await s.send(id, { kind: 'view.locate.ack', offset: 7 })
    await s.send(id, { kind: 'ready' })
    expect(locateOffsets(s, id)).toEqual([7])
  })

  it('陈旧 ack（offset 与待送达意图不一致）不清除：仍补发', async () => {
    const s = setup('# 标题\n\n正文段落\n')
    const id = s.attach()
    await readyPanel(s, id)
    s.session.postToPanel(id, { kind: 'view.locate', offset: 7 })
    // 连续两次跳转中前一次的 ack 迟到：不得误清后一次的待送达意图
    await s.send(id, { kind: 'view.locate.ack', offset: 3 })
    await s.send(id, { kind: 'ready' })
    expect(locateOffsets(s, id)).toEqual([7, 7])
  })

  it('ack 后新定位重新进入待送达态：重握手补发新意图', async () => {
    const s = setup('# 标题\n\n正文段落\n')
    const id = s.attach()
    await readyPanel(s, id)
    s.session.postToPanel(id, { kind: 'view.locate', offset: 7 })
    await s.send(id, { kind: 'view.locate.ack', offset: 7 })
    s.session.postToPanel(id, { kind: 'view.locate', offset: 12 })
    await s.send(id, { kind: 'ready' })
    expect(locateOffsets(s, id)).toEqual([7, 12, 12])
  })
})

// ---- 工单 #220：悬停浮层的来源资源路由（B 身份图片解析与链接跳转） ----
// A 悬停查看 B 时，B 内图片/链接以 B 为来源目录解析：webview 在既有
// image.request / link.activate / wikilink.activate 通道上附 sourceDocUri
//（B 的 fsPath）。会话侧守卫：只有本面板**实际送达过 hover.result 成功
// 回包**的目标才能作为来源（不信任前端任意 URI）；来源化图片解析不进
// 主缓存/去重表（浮层短生命周期，跨开缓存属 #224 有界缓存）。
describe('#220 来源资源：hover.result 来源记录与守卫路由', () => {
  const B_PATH = 'D:\\notes\\sub\\b.md'

  interface SourcedHarness {
    s: ReturnType<typeof setup>
    id: string
    resolveCalls: Array<{ src: string; sourceDocUri?: string }>
    linkIntents: unknown[]
    wikilinkIntents: unknown[]
    out: HostToWebview[]
  }

  function sourcedSetup(): SourcedHarness {
    const s = setup()
    const resolveCalls: SourcedHarness['resolveCalls'] = []
    const linkIntents: unknown[] = []
    const wikilinkIntents: unknown[] = []
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        report({
          ok: true,
          fsPath: B_PATH,
          relPath: 'sub/b.md',
          version: 1,
          lfText: '# B\n',
          range: { start: 0, end: 5 },
          scope: { kind: 'full' },
        })
      },
      resolveImage: async (src, sourceDocUri) => {
        resolveCalls.push({ src, sourceDocUri })
        return { ok: true, src: `res://${sourceDocUri ?? 'panel'}#${src}` }
      },
      openLink: (intent) => linkIntents.push(intent),
      openWikilink: (intent) => wikilinkIntents.push(intent),
    })
    return { s, id, resolveCalls, linkIntents, wikilinkIntents, out }
  }

  async function hoverServeB(t: SourcedHarness): Promise<void> {
    await ready10(t.s, t.id)
    await t.s.send(t.id, {
      kind: 'hover.request', sessionId: t.id, docUri: DOC_URI,
      reqId: 1, instanceId: 'hover-1', sourceStart: 0, sourceEnd: 5, target: 'sub/b',
    })
  }

  it('hover.result 成功送达后记录来源：sourceDocUri 匹配的 image.request 透传给解析器', async () => {
    const t = sourcedSetup()
    await hoverServeB(t)
    await t.s.send(t.id, {
      kind: 'image.request', sessionId: t.id, docUri: DOC_URI,
      reqId: 7, src: './img.png', sourceDocUri: B_PATH,
    })
    expect(t.resolveCalls).toEqual([{ src: './img.png', sourceDocUri: B_PATH }])
    expect(t.out.filter((m) => m.kind === 'image.result')).toEqual([
      { kind: 'image.result', reqId: 7, ok: true, src: `res://${B_PATH}#./img.png` },
    ])
  })

  it('来源守卫：未送达过该目标的 sourceDocUri 请求静默丢弃（不触达解析器不回发）', async () => {
    const t = sourcedSetup()
    await ready10(t.s, t.id)
    // 未 hover：任意 sourceDocUri 丢弃
    await t.s.send(t.id, {
      kind: 'image.request', sessionId: t.id, docUri: DOC_URI,
      reqId: 1, src: './img.png', sourceDocUri: B_PATH,
    })
    expect(t.resolveCalls).toEqual([])
    // hover 成功后：不匹配的来源（前端伪造任意路径）丢弃
    await hoverServeB(t)
    await t.s.send(t.id, {
      kind: 'image.request', sessionId: t.id, docUri: DOC_URI,
      reqId: 2, src: './img.png', sourceDocUri: 'C:\\任意\\目录.md',
    })
    expect(t.resolveCalls).toEqual([])
    expect(t.out.filter((m) => m.kind === 'image.result')).toHaveLength(0)
  })

  it('来源化图片解析不进主缓存/去重表：同 src 重复请求每次触达解析器', async () => {
    const t = sourcedSetup()
    await hoverServeB(t)
    for (const reqId of [1, 2]) {
      await t.s.send(t.id, {
        kind: 'image.request', sessionId: t.id, docUri: DOC_URI,
        reqId, src: './img.png', sourceDocUri: B_PATH,
      })
    }
    expect(t.resolveCalls, '来源化路径无会话缓存（浮层短生命周期）').toHaveLength(2)
    // 主文档路径（无 sourceDocUri）缓存语义不受影响：同 src 两次只解析一次
    for (const reqId of [3, 4]) {
      await t.s.send(t.id, {
        kind: 'image.request', sessionId: t.id, docUri: DOC_URI,
        reqId, src: './img.png',
      })
    }
    expect(t.resolveCalls).toHaveLength(3)
  })

  it('来源化解析异常收敛 read-error 回发（不静默吞掉浮层内图片）', async () => {
    const s = setup()
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        report({
          ok: true, fsPath: B_PATH, relPath: 'sub/b.md', version: 1,
          lfText: '# B\n', range: { start: 0, end: 5 }, scope: { kind: 'full' },
        })
      },
      resolveImage: async () => {
        throw new Error('boom')
      },
    })
    await ready10(s, id)
    await s.send(id, {
      kind: 'hover.request', sessionId: id, docUri: DOC_URI,
      reqId: 1, instanceId: 'hover-1', sourceStart: 0, sourceEnd: 5, target: 'sub/b',
    })
    await s.send(id, {
      kind: 'image.request', sessionId: id, docUri: DOC_URI,
      reqId: 9, src: './img.png', sourceDocUri: B_PATH,
    })
    expect(out.filter((m) => m.kind === 'image.result')).toEqual([
      { kind: 'image.result', reqId: 9, ok: false, reason: 'read-error', detail: undefined },
    ])
  })

  it('link.activate / wikilink.activate：sourceDocUri 匹配来源记录时透传；不匹配丢弃', async () => {
    const t = sourcedSetup()
    await hoverServeB(t)
    await t.s.send(t.id, {
      kind: 'link.activate', sessionId: t.id, docUri: DOC_URI,
      href: 'c.md', srcStart: 0, srcEnd: 3, sourceDocUri: B_PATH,
    })
    await t.s.send(t.id, {
      kind: 'wikilink.activate', sessionId: t.id, docUri: DOC_URI,
      target: 'C 笔记', srcStart: 0, srcEnd: 3, sourceDocUri: B_PATH,
    })
    expect(t.linkIntents).toEqual([
      { href: 'c.md', srcStart: 0, srcEnd: 3, sourceDocUri: B_PATH },
    ])
    expect(t.wikilinkIntents).toEqual([
      { target: 'C 笔记', srcStart: 0, srcEnd: 3, sourceDocUri: B_PATH },
    ])
    // 不匹配的来源：丢弃（不回落到面板自身文档解析——B 内链接按 A 目录
    // 解析是错误语义，宁可不动作）
    await t.s.send(t.id, {
      kind: 'link.activate', sessionId: t.id, docUri: DOC_URI,
      href: 'c.md', srcStart: 0, srcEnd: 3, sourceDocUri: 'C:\\伪造.md',
    })
    expect(t.linkIntents).toHaveLength(1)
    // 无 sourceDocUri 的常规链接（主视图点击）不受影响
    await t.s.send(t.id, {
      kind: 'link.activate', sessionId: t.id, docUri: DOC_URI,
      href: 'a-dir.md', srcStart: 0, srcEnd: 3,
    })
    expect(t.linkIntents).toHaveLength(2)
    expect(t.linkIntents[1]).toEqual({ href: 'a-dir.md', srcStart: 0, srcEnd: 3 })
  })

  it('hover.result 失败不记录来源：其后 sourced 请求丢弃', async () => {
    const s = setup()
    const resolveCalls: unknown[] = []
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        report({ ok: false, reason: 'not-found' })
      },
      resolveImage: async (src) => {
        resolveCalls.push(src)
        return { ok: true, src: 'res://x' }
      },
    })
    await ready10(s, id)
    await s.send(id, {
      kind: 'hover.request', sessionId: id, docUri: DOC_URI,
      reqId: 1, instanceId: 'hover-1', sourceStart: 0, sourceEnd: 5, target: 'missing',
    })
    await s.send(id, {
      kind: 'image.request', sessionId: id, docUri: DOC_URI,
      reqId: 2, src: './img.png', sourceDocUri: B_PATH,
    })
    expect(resolveCalls).toEqual([])
    expect(out.filter((m) => m.kind === 'image.result')).toHaveLength(0)
  })
})

// ---- 工单 #222：来源记录集合化（嵌入卡片与悬停浮层多目标共存） ----
describe('#222 来源集合：嵌入与悬停多目标同面板在场', () => {
  const B_PATH = 'D:\notes\sub\b.md'
  const C_PATH = 'D:\notes\sub\c.md'

  it('先后读取 B（嵌入）与 C（悬停）：两目标的 sourceDocUri 请求均放行（单值守卫会误杀）', async () => {
    const s = setup()
    const resolveCalls: Array<{ src: string; sourceDocUri?: string }> = []
    const linkIntents: unknown[] = []
    const out: HostToWebview[] = []
    let serve = 0
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      readHoverTarget: (_payload, report) => {
        serve += 1
        report(
          serve === 1
            ? { ok: true, fsPath: B_PATH, relPath: 'sub/b.md', version: 1, lfText: '# B\n', range: { start: 0, end: 5 }, scope: { kind: 'full' } }
            : { ok: true, fsPath: C_PATH, relPath: 'sub/c.md', version: 1, lfText: '# C\n', range: { start: 0, end: 5 }, scope: { kind: 'full' } },
        )
      },
      resolveImage: async (src, sourceDocUri) => {
        resolveCalls.push({ src, sourceDocUri })
        return { ok: true, src: `res://${sourceDocUri ?? 'p'}#${src}` }
      },
      openLink: (intent) => linkIntents.push(intent),
    })
    await ready10(s, id)
    // 嵌入卡片装载 B（hover.request）→ 悬停浮层再读取 C：两个来源同时在记录
    await s.send(id, { kind: 'hover.request', sessionId: id, docUri: DOC_URI, reqId: 1, instanceId: 'embed-1', sourceStart: 0, sourceEnd: 8, target: 'sub/b' })
    await s.send(id, { kind: 'hover.request', sessionId: id, docUri: DOC_URI, reqId: 2, instanceId: 'hover-1', sourceStart: 10, sourceEnd: 16, target: 'sub/c' })
    // B 内图片（嵌入卡片在场）与 C 内链接（浮层在场）同时放行
    await s.send(id, { kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId: 3, src: './b-img.png', sourceDocUri: B_PATH })
    await s.send(id, { kind: 'link.activate', sessionId: id, docUri: DOC_URI, href: 'd.md', srcStart: 0, srcEnd: 3, sourceDocUri: C_PATH })
    expect(resolveCalls).toEqual([{ src: './b-img.png', sourceDocUri: B_PATH }])
    expect(linkIntents).toEqual([{ href: 'd.md', srcStart: 0, srcEnd: 3, sourceDocUri: C_PATH }])
    // 伪造来源仍丢弃
    await s.send(id, { kind: 'image.request', sessionId: id, docUri: DOC_URI, reqId: 4, src: './x.png', sourceDocUri: 'D:\伪造.md' })
    expect(resolveCalls).toHaveLength(1)
  })
})

// ---- P2-2 / P3-2（review 修复）：hover.watch 来源校验查询面与集合触达序 ----
// P2-2：provider 层 watch 登记前校验 fsPath ∈ 该会话 hoverSourceFsPaths（watch
// 总在成功装载后，集合已含目标）——本 describe 钉查询面语义（伪造越界 watch
// 的判定基准）；provider 接线为薄 if。P3-2：已存在成员重读时移到队尾（插入
// 序 = 淘汰序改最近读取序），活跃目标不被上限淘汰（上限对齐
// HOVER_REFRESH_DEFAULTS.embedEntryLimit——嵌入实例状态库同容量，修 4）。
describe('#224 P2-2/P3-2：来源集合查询面与重读触达', () => {
  interface HoverSetup {
    s: ReturnType<typeof setup>
    id: string
    served: string[]
    results: HostToWebview[]
  }

  /** readHoverTarget 按 target 原文直供对应 fsPath（b1 → D:\notes\b1.md） */
  function hoverByTargetSetup(): HoverSetup {
    const s = setup()
    const served: string[] = []
    const results: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (message) => { results.push(message) },
      readHoverTarget: (payload, report) => {
        const target = payload.target
        served.push(target)
        report({
          ok: true,
          fsPath: `D:\\notes\\${target}.md`,
          relPath: `${target}.md`,
          version: 1,
          lfText: '# t\n',
          range: { start: 0, end: 4 },
          scope: { kind: 'full' },
        })
      },
    })
    return { s, id, served, results }
  }

  async function readTarget(t: HoverSetup, seq: number, target: string): Promise<void> {
    await t.s.send(t.id, {
      kind: 'hover.request', sessionId: t.id, docUri: DOC_URI,
      reqId: seq, instanceId: `inst-${seq}`, sourceStart: 0, sourceEnd: 4, target,
    })
  }

  it('P2-2 hasHoverSource：未读取过为 false、成功读取后为 true、失败读取不记录、未知会话为 false', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\b.md')).toBe(false) // 未读取
    expect(t.s.session.hasHoverSource('unknown-session', 'D:\\notes\\b.md')).toBe(false)
    await readTarget(t, 1, 'b')
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\b.md')).toBe(true)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\伪造.md')).toBe(false)
    // 失败读取不记录（read-failed 端口）
    const s2 = setup()
    const id2 = s2.session.attachPanel({
      send: () => {},
      readHoverTarget: (_p, report) => report({ ok: false, reason: 'read-failed' }),
    })
    await ready10(s2, id2)
    await s2.send(id2, {
      kind: 'hover.request', sessionId: id2, docUri: DOC_URI,
      reqId: 1, instanceId: 'x', sourceStart: 0, sourceEnd: 4, target: 'missing',
    })
    expect(s2.session.hasHoverSource(id2, 'D:\\notes\\missing.md')).toBe(false)
  })

  async function retained(t: HoverSetup, seq: number, target: string): Promise<string | undefined> {
    await t.s.send(t.id, {
      kind: 'hover.request', sessionId: t.id, docUri: DOC_URI,
      reqId: seq, instanceId: `read-${seq}`, sourceStart: 0, sourceEnd: 4, target,
      retainSource: true,
    } as WebviewToHost)
    const result = t.results.at(-1) as { sourceLeaseId?: string }
    return result.sourceLeaseId
  }

  it('#242 相同缓存内容的两次成功送达生成独立租约，释放其中一个不释放另一个', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    const one = await retained(t, 1, 'B')
    const two = await retained(t, 2, 'B')
    expect(one).not.toBe(two)
    expect(t.served).toEqual(['B']) // 读取缓存共享，租约不共享。
    await t.s.send(t.id, { kind: 'hover.source.release', sessionId: t.id, docUri: DOC_URI, sourceLeaseId: one! })
    for (let i = 3; i <= 70; i++) await readTarget(t, i, `fresh${i}`)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\B.md')).toBe(true)
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\B.md', 'second', two)).toBe(true)
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\B.md', 'first', one)).toBe(false)
  })

  it('#242 租约只转交到配对目标及会话；消耗后不能跨 occurrence 重用，release幂等', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    const lease = await retained(t, 1, 'B')
    expect(lease).toBeDefined()
    await readTarget(t, 2, 'C')
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\C.md', 'wrong', lease)).toBe(false)
    expect(t.s.session.retainHoverSource('foreign-panel', 'D:\\notes\\B.md', 'wrong', lease)).toBe(false)
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\B.md', 'owner', lease)).toBe(true)
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\B.md', 'owner', lease)).toBe(true)
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\B.md', 'other-occurrence', lease)).toBe(false)
    for (let i = 0; i < 2; i++) await t.s.send(t.id, { kind: 'hover.source.release', sessionId: t.id,
      docUri: DOC_URI, sourceLeaseId: lease! })
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\B.md')).toBe(true)
    await t.s.send(t.id, { kind: 'hover.unwatch', sessionId: t.id, docUri: DOC_URI,
      fsPath: 'D:\\notes\\B.md', instanceId: 'owner' })
    for (let i = 3; i <= 70; i++) await readTarget(t, i, `fresh${i}`)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\B.md')).toBe(false)
    expect(t.s.session.retainHoverSource(t.id, 'D:\\notes\\B.md', 'owner', lease)).toBe(false)
  })

  it('#242 待订阅租约显式释放后恢复可淘汰，错误结果不授予租约', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    const lease = await retained(t, 1, 'B')
    for (let i = 2; i <= 70; i++) await readTarget(t, i, `fresh${i}`)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\B.md')).toBe(true)
    await t.s.send(t.id, { kind: 'hover.source.release', sessionId: t.id, docUri: DOC_URI, sourceLeaseId: lease! })
    await readTarget(t, 71, 'fresh71')
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\B.md')).toBe(false)
    const s = setup()
    const results: HostToWebview[] = []
    const id = s.session.attachPanel({ send: (m) => { results.push(m) },
      readHoverTarget: (_payload, report) => report({ ok: false, reason: 'not-found' }) })
    await ready10(s, id)
    await s.send(id, { kind: 'hover.request', sessionId: id, docUri: DOC_URI, reqId: 1,
      instanceId: 'missing', sourceStart: 0, sourceEnd: 1, target: 'missing', retainSource: true })
    expect(results.find((m) => m.kind === 'hover.result')).not.toHaveProperty('sourceLeaseId')
  })

  it('#242 审查修复：旧目标退订不能撤销已送达新目标的待订阅租约', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    for (let i = 1; i <= 65; i++) {
      await readTarget(t, i, `old${i}`)
      await t.s.send(t.id, { kind: 'hover.watch', sessionId: t.id, docUri: DOC_URI,
        fsPath: `D:\\notes\\old${i}.md`, instanceId: `occ-${i}` })
    }
    const sourceLeaseId = await retained(t, 100, 'new')
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\new.md')).toBe(true)
    await t.s.send(t.id, { kind: 'hover.unwatch', sessionId: t.id, docUri: DOC_URI,
      fsPath: 'D:\\notes\\old65.md', instanceId: 'occ-65' })
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\new.md')).toBe(true)
    await t.s.send(t.id, { kind: 'hover.watch', sessionId: t.id, docUri: DOC_URI,
      fsPath: 'D:\\notes\\new.md', instanceId: 'occ-65', sourceLeaseId } as WebviewToHost)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\new.md')).toBe(true)
  })

  it('#242 审查修复：两个成功回包待订阅时，后一个读取不能回收前一个来源', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    for (let i = 1; i <= 64; i++) {
      await readTarget(t, i, `active${i}`)
      await t.s.send(t.id, { kind: 'hover.watch', sessionId: t.id, docUri: DOC_URI,
        fsPath: `D:\\notes\\active${i}.md`, instanceId: `occ-${i}` })
    }
    const sourceLeaseId = await retained(t, 100, 'pendingB')
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\pendingB.md')).toBe(true)
    await retained(t, 101, 'pendingC')
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\pendingB.md')).toBe(true)
    await t.s.send(t.id, { kind: 'hover.watch', sessionId: t.id, docUri: DOC_URI,
      fsPath: 'D:\\notes\\pendingB.md', instanceId: 'pending-B', sourceLeaseId } as WebviewToHost)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\pendingB.md')).toBe(true)
  })

  it('#242 全部来源仍活跃时，新送达目标保留授权直到订阅，不能立即被容量回收', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    for (let i = 0; i < 65; i++) {
      await readTarget(t, i + 1, `active${i}`)
      await t.s.send(t.id, { kind: 'hover.watch', sessionId: t.id, docUri: DOC_URI,
        fsPath: `D:\\notes\\active${i}.md`, instanceId: `inst-${i}` })
    }
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active64.md')).toBe(true)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active0.md')).toBe(true)
    t.s.session.dispose()
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active0.md')).toBe(false)
  })

  it('#242 已释放面板的迟到成功读取不发送结果或重新持有来源', async () => {
    const s = setup()
    const sent: HostToWebview[] = []
    let deliver = (): void => {}
    const id = s.session.attachPanel({
      send: (msg) => { sent.push(msg) },
      readHoverTarget: (_payload, report) => {
        deliver = () => report({ ok: true, fsPath: 'D:\\notes\\late.md', relPath: 'late.md',
          version: 1, lfText: '# late', range: { start: 0, end: 6 }, scope: { kind: 'full' } })
      },
    })
    await ready10(s, id)
    const pending = s.send(id, { kind: 'hover.request', sessionId: id, docUri: DOC_URI,
      reqId: 1, instanceId: 'late', sourceStart: 0, sourceEnd: 1, target: 'late' })
    s.session.detachPanel(id)
    deliver()
    await pending
    expect(sent.some((m) => m.kind === 'hover.result')).toBe(false)
    expect(s.session.hasHoverSource(id, 'D:\\notes\\late.md')).toBe(false)
  })

  it('#242 活跃来源按 occurrence 固定，容量只淘汰未订阅目标，最终释放恢复可淘汰', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    await readTarget(t, 1, 'active')
    for (const instanceId of ['left', 'right']) {
      await t.s.send(t.id, { kind: 'hover.watch', sessionId: t.id, docUri: DOC_URI,
        fsPath: 'D:\\notes\\active.md', instanceId })
    }
    const fill = async (base: number): Promise<void> => {
      for (let i = 0; i < 66; i++) await readTarget(t, base + i, `fresh${base + i}`)
    }
    await fill(10)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active.md')).toBe(true)
    for (let i = 0; i < 2; i++) {
      await t.s.send(t.id, { kind: 'hover.unwatch', sessionId: t.id, docUri: DOC_URI,
        fsPath: 'D:\\notes\\active.md', instanceId: 'left' })
    }
    await fill(100)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active.md')).toBe(true)
    await t.s.send(t.id, { kind: 'hover.unwatch', sessionId: t.id, docUri: DOC_URI,
      fsPath: 'D:\\notes\\active.md', instanceId: 'right' })
    await fill(200)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active.md')).toBe(false)
    t.s.session.detachPanel(t.id)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\active.md')).toBe(false)
  })

  it('P3-2 重读触达：已存在成员重读后移到队尾，超限淘汰按最近读取序（活跃目标不被淘汰）', async () => {
    const t = hoverByTargetSetup()
    await ready10(t.s, t.id)
    // 装满上限个不同目标（t01..tNN，插入序 t01 最旧；上限与嵌入实例
    // 状态库 embedEntryLimit 对齐——修 4）
    const limit = HOVER_REFRESH_DEFAULTS.embedEntryLimit
    for (let i = 1; i <= limit; i++) {
      await readTarget(t, i, `t${String(i).padStart(2, '0')}`)
    }
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\t01.md')).toBe(true)
    // 重读 t01（活跃目标触达 → 移到队尾）
    await readTarget(t, limit + 1, 't01')
    // 新目标入集合：淘汰的应是最久未读的 t02（而非触达过的 t01）
    await readTarget(t, limit + 2, 't99')
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\t01.md')).toBe(true)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\t02.md')).toBe(false)
    expect(t.s.session.hasHoverSource(t.id, 'D:\\notes\\t99.md')).toBe(true)
  })
})

describe('#299 hover.target.resolve：会话守卫与结果回包路由', () => {
  /** 装配一个带可观测解析端口的面板（端口可整体缺省——b 例） */
  const attach = (
    s: ReturnType<typeof setup>,
    port?: { resolveHoverTarget?: PanelPort['resolveHoverTarget'] },
  ) => {
    const out: HostToWebview[] = []
    const id = s.session.attachPanel({
      send: (m) => out.push(m),
      ...(port?.resolveHoverTarget ? { resolveHoverTarget: port.resolveHoverTarget } : {}),
    })
    return { out, id }
  }

  it('未 ready 或 docUri 不匹配：静默丢弃——无回包且解析端口零调用', async () => {
    const s = setup()
    let portCalls = 0
    const { out, id } = attach(s, {
      resolveHoverTarget: (_payload, report) => {
        portCalls++
        report({ ok: true, relPath: 'b.md', anchor: '' })
      },
    })
    // 未 ready：不发 ready 直接解析请求
    await s.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: id, docUri: DOC_URI, reqId: 1, target: 'B' }, id)
    expect(portCalls).toBe(0)
    expect(out).toEqual([])
    // ready 后 docUri 不匹配：同样静默
    await s.session.handleWebviewMessage({ kind: 'ready' }, id)
    await s.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: id, docUri: 'file:///other/x.md', reqId: 2, target: 'B' }, id)
    expect(portCalls).toBe(0)
    expect(out.filter((m) => m.kind === 'hover.target.resolved')).toEqual([])
    s.session.dispose()
  })

  it('解析端口缺失：回 ok:false 配对 reqId——防 webview inflight 悬挂的唯一保障', async () => {
    const s = setup()
    const { out, id } = attach(s) // 不注入 resolveHoverTarget
    await s.session.handleWebviewMessage({ kind: 'ready' }, id)
    await s.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: id, docUri: DOC_URI, reqId: 7, target: 'B' }, id)
    // 旧宿主/未注入端口的降级面：请求方（targetTip inflight 登记）必须
    // 收到否定回包，否则解析请求永久悬挂（无超时重发机制）
    expect(out.filter((m) => m.kind === 'hover.target.resolved')).toEqual([
      { kind: 'hover.target.resolved', reqId: 7, ok: false },
    ])
    s.session.dispose()
  })

  it('解析回调到达前会话已 dispose 或面板已注销：结果丢弃不回发', async () => {
    const s = setup()
    const reports: Array<(result: { ok: true; relPath: string; anchor?: string }) => void> = []
    const { out, id } = attach(s, {
      resolveHoverTarget: (_payload, report) => {
        reports.push(report as typeof reports[number])
      },
    })
    await s.session.handleWebviewMessage({ kind: 'ready' }, id)
    // 在途请求 1：回调持有（模拟解析进行中），随后整会话销毁
    await s.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: id, docUri: DOC_URI, reqId: 1, target: 'B' }, id)
    expect(reports.length).toBe(1)
    s.session.dispose()
    reports[0]({ ok: true, relPath: 'b.md', anchor: '' })
    expect(out.filter((m) => m.kind === 'hover.target.resolved')).toEqual([])
    // 在途请求 2：新会话上面板注销（detach）后回调到达——同守卫丢弃
    const s2 = setup()
    const reports2: Array<(result: { ok: true; relPath: string; anchor?: string }) => void> = []
    const p2 = attach(s2, {
      resolveHoverTarget: (_payload, report) => {
        reports2.push(report as typeof reports2[number])
      },
    })
    await s2.session.handleWebviewMessage({ kind: 'ready' }, p2.id)
    await s2.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: p2.id, docUri: DOC_URI, reqId: 2, target: 'B' }, p2.id)
    s2.session.detachPanel(p2.id)
    reports2[0]({ ok: true, relPath: 'b.md' })
    expect(p2.out.filter((m) => m.kind === 'hover.target.resolved')).toEqual([])
    s2.session.dispose()
  })

  it('端口解析成功：结果回发来源面板（relPath + 源码形态锚点，reqId 配对）', async () => {
    const s = setup()
    const { out, id } = attach(s, {
      resolveHoverTarget: (payload, report) => {
        report(payload.target === 'B'
          ? { ok: true, relPath: 'sub/b.md', anchor: '#标题' }
          : { ok: false })
      },
    })
    await s.session.handleWebviewMessage({ kind: 'ready' }, id)
    await s.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: id, docUri: DOC_URI, reqId: 3, target: 'B' }, id)
    await s.session.handleWebviewMessage(
      { kind: 'hover.target.resolve', sessionId: id, docUri: DOC_URI, reqId: 4, target: '坏' }, id)
    expect(out.filter((m) => m.kind === 'hover.target.resolved')).toEqual([
      { kind: 'hover.target.resolved', reqId: 3, ok: true, relPath: 'sub/b.md', anchor: '#标题' },
      { kind: 'hover.target.resolved', reqId: 4, ok: false },
    ])
    s.session.dispose()
  })
})
