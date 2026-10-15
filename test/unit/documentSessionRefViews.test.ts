// T05（#544）附加组件只读引用请求的会话层契约：addonSource 来源覆盖的
// 成员资格守卫（面板文档或已送达目标）、形态互斥、读取端口收到
// resolvedSource（R-U02 解析语境）、main 空串回落常规根请求、缓存形态键
// 按来源区分（不同来源的同名相对目标不串包）。
import { describe, it, expect } from 'vitest'
import { DocumentSession, type HostDocumentPort } from '../../src/host/documentSession'
import type { RefReadOutcome } from '../../src/host/hoverDocAccess'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/a.md'
const A_PATH = 'D:\\notes\\a.md'
const B_PATH = 'D:\\notes\\sub\\b.md'
const OTHER_B_PATH = 'D:\\notes\\other\\b.md'

function mdOutcome(fsPath: string, text: string, version = 1): RefReadOutcome {
  return {
    ok: true,
    fsPath,
    relPath: fsPath.replace(/^D:\\notes\\/, ''),
    content: { kind: 'markdown', version, lfText: text, range: { start: 0, end: text.length }, selector: { kind: 'full' } },
  }
}

function setup() {
  const doc = new (class implements HostDocumentPort {
    version = 1
    getText(): string {
      return '# A\n'
    }
    onDocChanged(): void {}
    async applyChanges(): Promise<boolean> {
      return true
    }
    async undo(): Promise<boolean> {
      return true
    }
    async redo(): Promise<boolean> {
      return true
    }
  })()
  const out: HostToWebview[] = []
  let sourceAvailable = true
  /** 端口收到的读取载荷（resolvedSource 断言面） */
  const portPayloads: Array<{ target: string; resolvedSource?: { fsPath: string }; verifiedSource?: unknown }> = []
  const session = new DocumentSession(doc, { docUri: DOC_URI, rootFsPath: A_PATH, isWindowsHost: true })
  const id = session.attachPanel({
    send: (m) => out.push(m),
    readHoverSource: async (fsPath) => !sourceAvailable ? null : fsPath === B_PATH
      ? { version: 1, text: '# B\n' }
      : fsPath === OTHER_B_PATH
        ? { version: 1, text: '# B2\n' }
        : fsPath === A_PATH
          ? { version: 1, text: '# A\n' }
          : null,
    readHoverTarget: (payload, report) => {
      portPayloads.push({ target: payload.target, resolvedSource: payload.resolvedSource, verifiedSource: payload.verifiedSource })
      // 送达请求（directTarget）按其 fsPath 回报——登记进已送达目标集合
      if (payload.directTarget !== undefined) {
        report(mdOutcome(payload.directTarget.fsPath, '# 目标\n'))
        return
      }
      // 按 resolvedSource 归位解析结果：B 语境下 'sib.md' → sub 目录
      if (payload.resolvedSource?.fsPath === B_PATH) {
        report(mdOutcome('D:\\notes\\sub\\sib.md', '# 来自 B 目录的兄弟文件\n'))
        return
      }
      if (payload.resolvedSource?.fsPath === OTHER_B_PATH) {
        report(mdOutcome('D:\\notes\\other\\sib.md', '# 来自另一 B 目录的兄弟文件\n'))
        return
      }
      report(mdOutcome('D:\\notes\\sib.md', '# 来自 A 目录的兄弟文件\n'))
    },
  })
  const send = (msg: WebviewToHost) => session.handleWebviewMessage(msg, id)
  return { session, out, portPayloads, send, expireSources: () => { sourceAvailable = false } }
}

async function ready(s: ReturnType<typeof setup>): Promise<void> {
  await s.send({ kind: 'ready' })
}

/** 先经一次成功读取把目标登记进 hoverSourceFsPaths（已送达目标） */
async function deliverTarget(s: ReturnType<typeof setup>, fsPath: string, reqId: number, instanceId: string): Promise<void> {
  await s.send({
    kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId, instanceId,
    sourceStart: 0, sourceEnd: 0, target: `deliv-${reqId}`,
    directTarget: { fsPath },
  } as WebviewToHost)
}

describe('T05 addonSource 来源覆盖', () => {
  it('已送达目标为来源：读取端口收到 resolvedSource，目标按 B 目录解析（R-U02）', async () => {
    const s = setup()
    await ready(s)
    await deliverTarget(s, B_PATH, 1, 'mount-1')
    s.out.length = 0
    await s.send({
      kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId: 2, instanceId: 'hover-2',
      sourceStart: 0, sourceEnd: 0, target: 'sib.md',
      addonSource: { instanceId: 'embed:h1', sourceFsPath: B_PATH },
    } as WebviewToHost)
    const result = s.out.find((m) => m.kind === 'hover.result')
    expect(result && result.kind === 'hover.result' && result.ok).toBe(true)
    expect(result && result.kind === 'hover.result' && result.ok ? result.target.fsPath : '').toBe('D:\\notes\\sub\\sib.md')
    expect(s.portPayloads.at(-1)?.resolvedSource).toEqual({ fsPath: B_PATH })
  })

  it('main 空串回落常规根请求：无 resolvedSource，按面板文档解析', async () => {
    const s = setup()
    await ready(s)
    await s.send({
      kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId: 1, instanceId: 'hover-1',
      sourceStart: 0, sourceEnd: 0, target: 'sib.md',
      addonSource: { instanceId: 'main', sourceFsPath: '' },
    } as WebviewToHost)
    const result = s.out.find((m) => m.kind === 'hover.result')
    expect(result && result.kind === 'hover.result' && result.ok ? result.target.fsPath : '').toBe('D:\\notes\\sib.md')
    expect(s.portPayloads.at(-1)?.resolvedSource).toBeUndefined()
  })

  it('未送达 fsPath → source-expired（不接受任意 URI 接入无来源读取）', async () => {
    const s = setup()
    await ready(s)
    await s.send({
      kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId: 1, instanceId: 'hover-1',
      sourceStart: 0, sourceEnd: 0, target: 'sib.md',
      addonSource: { instanceId: 'embed:h1', sourceFsPath: 'D:\\outside\\e.md' },
    } as WebviewToHost)
    const result = s.out.find((m) => m.kind === 'hover.result')
    expect(result).toMatchObject({ kind: 'hover.result', ok: false, reason: 'source-expired' })
    expect(s.portPayloads).toHaveLength(0)
  })

  it('与 child-source/linkHref/directTarget 形态互斥 → source-expired', async () => {
    const s = setup()
    await ready(s)
    await deliverTarget(s, B_PATH, 1, 'mount-1')
    s.out.length = 0
    await s.send({
      kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId: 2, instanceId: 'hover-2',
      sourceStart: 0, sourceEnd: 0, target: 'sib.md', linkHref: 'sib.md',
      addonSource: { instanceId: 'embed:h1', sourceFsPath: B_PATH },
    } as WebviewToHost)
    expect(s.out.find((m) => m.kind === 'hover.result')).toMatchObject({ ok: false, reason: 'source-expired' })
    expect(s.portPayloads.filter((p) => p.target === 'sib.md')).toHaveLength(0)
  })

  it('缓存形态键按来源区分：不同来源的同名相对目标不串包', async () => {
    const s = setup()
    await ready(s)
    await deliverTarget(s, B_PATH, 1, 'mount-1')
    await deliverTarget(s, OTHER_B_PATH, 2, 'mount-2')
    s.out.length = 0
    const request = (reqId: number, sourceFsPath: string) => s.send({
      kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId, instanceId: `hover-${reqId}`,
      sourceStart: 0, sourceEnd: 0, target: 'sib.md',
      addonSource: { instanceId: 'embed:h1', sourceFsPath },
    } as WebviewToHost)
    await request(3, B_PATH)
    await request(4, OTHER_B_PATH)
    const results = s.out.filter((m) => m.kind === 'hover.result' && m.ok)
    expect(results).toHaveLength(2)
    const paths = results.map((m) => (m.kind === 'hover.result' && m.ok ? m.target.fsPath : ''))
    expect(paths).toEqual(['D:\\notes\\sub\\sib.md', 'D:\\notes\\other\\sib.md'])
    // 两次都真实过端口（缓存未把第二个请求串给第一个来源的结果）
    expect(s.portPayloads.filter((p) => p.resolvedSource !== undefined)).toHaveLength(2)
  })

  it('来源文档打不开（送达后被删且不可装载）→ source-expired', async () => {
    const s = setup()
    await ready(s)
    await deliverTarget(s, B_PATH, 1, 'mount-1')
    s.out.length = 0
    s.expireSources()
    await s.send({
      kind: 'hover.request', sessionId: 'p1', docUri: DOC_URI, reqId: 2, instanceId: 'hover-2',
      sourceStart: 0, sourceEnd: 0, target: 'sib.md',
      addonSource: { instanceId: 'embed:h1', sourceFsPath: B_PATH },
    } as WebviewToHost)
    expect(s.out.find((m) => m.kind === 'hover.result')).toMatchObject({ ok: false, reason: 'source-expired' })
  })
})
