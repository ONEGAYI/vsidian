// P2-04（#281）refEdit 端口协议契约：嵌入内部 Live 与宿主 B 会话之间的
// 绑定/出站/推送消息形态与运行期校验——「不信任前端任意 URI、释放后迟到
// 消息按 portId 拒绝」的第一道形态学防线（行为级拒绝在 provider 路由层，
// 由集成用例钉住；本文件钉住协议层的接受/拒绝边界）。
import { describe, expect, it } from 'vitest'
import { isHostToWebview, isWebviewToHost } from '../../src/shared/protocol'

const PANEL = { panelSessionId: 'panel-1', panelDocUri: 'file:///d%3A/notes/a.md' }

describe('refEdit 协议：webview → 宿主', () => {
  it('refEdit.bind 接受完整载荷', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.bind',
      ...PANEL,
      fsPath: 'D:\\notes\\b.md',
      occurrence: '12::![[b]]',
      reqId: 1,
    })).toBe(true)
  })

  it('refEdit.bind 拒绝缺字段/错型载荷', () => {
    expect(isWebviewToHost({ kind: 'refEdit.bind', ...PANEL, fsPath: 'D:\\b.md', occurrence: 'k' })).toBe(false)
    expect(isWebviewToHost({ kind: 'refEdit.bind', ...PANEL, fsPath: 'D:\\b.md', occurrence: 'k', reqId: 0 })).toBe(false)
    expect(isWebviewToHost({ kind: 'refEdit.bind', ...PANEL, occurrence: 'k', reqId: 1 })).toBe(false)
  })

  it('refEdit.message 携带编辑通道内消息时接受（edit.request / history.request）', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'edit.request',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        seq: 1,
        baseVersion: 3,
        changes: [{ offset: 0, length: 0, text: 'x' }],
      },
    })).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: { kind: 'history.request', op: 'undo' },
    })).toBe(true)
  })

  it('refEdit.message 携带资源消息时接受（P2-11：链接/双链/图片/粘贴/刷新经目标端口传身份）', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'link.activate',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        href: './c.md',
        srcStart: 0,
        srcEnd: 8,
      },
    })).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'wikilink.activate',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        target: '双链目标',
        srcStart: 0,
        srcEnd: 8,
      },
    })).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'image.request',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        reqId: 1,
        src: './res.png',
      },
    })).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'image.paste',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        reqId: 1,
        mime: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
      },
    })).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'refresh.request',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        reqId: 1,
      },
    })).toBe(true)
  })

  it('refEdit.message 仍拒绝面板级消息混入目标端口（settings/view 族不走端口）', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: { kind: 'view.switch.request', target: 'reading' },
    })).toBe(false)
  })

  it('refEdit.message 携带 codeblock.copy 时接受（P2-14：代码卡复制经目标端口走宿主剪贴板）', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: {
        kind: 'codeblock.copy',
        sessionId: 'panel-9',
        docUri: 'file:///d%3A/notes/b.md',
        text: 'const x = 1\n',
      },
    })).toBe(true)
    // 缺 text / 错型仍拒绝（复用直发形态完整校验）
    expect(isWebviewToHost({
      kind: 'refEdit.message',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      message: { kind: 'codeblock.copy', sessionId: 'panel-9', docUri: 'file:///d%3A/notes/b.md' },
    })).toBe(false)
  })

  it('refEdit.save / refEdit.unbind 接受完整载荷', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.save',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
    })).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.unbind',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
    })).toBe(true)
    expect(isWebviewToHost({ kind: 'refEdit.save', ...PANEL, portId: '', fsPath: 'D:\\b.md' })).toBe(false)
  })
})

describe('refEdit 协议：宿主 → webview', () => {
  it('refEdit.bound 成功形态携带 portId/docUri/version/dirty', () => {
    expect(isHostToWebview({
      kind: 'refEdit.bound',
      reqId: 1,
      ok: true,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      docUri: 'file:///d%3A/notes/b.md',
      version: 2,
      dirty: false,
    })).toBe(true)
  })

  it('refEdit.bound 失败形态限定原因码', () => {
    expect(isHostToWebview({ kind: 'refEdit.bound', reqId: 1, ok: false, reason: 'source' })).toBe(true)
    expect(isHostToWebview({ kind: 'refEdit.bound', reqId: 1, ok: false, reason: 'not-markdown' })).toBe(true)
    expect(isHostToWebview({ kind: 'refEdit.bound', reqId: 1, ok: false, reason: 'open-failed' })).toBe(true)
    expect(isHostToWebview({ kind: 'refEdit.bound', reqId: 1, ok: false, reason: 'whatever' })).toBe(false)
  })

  it('refEdit.push 接受编辑通道与资源回包事件（P2-11 起含 image.*/refresh.invalidated）', () => {
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'doc.changed', version: 4, changes: [], origin: 'external' },
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'session.suspended', version: 4, reason: 'conflict' },
    })).toBe(true)
    // P2-11 资源回包：B 会话对虚拟面板的资源结果经同一信封定向回推
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'image.result', reqId: 1, ok: true, src: 'vscode-webview-resource://x/res.png' },
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'image.invalidate', srcs: ['res.png'] },
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'image.paste.result', reqId: 1, ok: true, markdown: '![image](assets/p.png)' },
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'refresh.invalidated', reqId: 1, generation: 5 },
    })).toBe(true)
    // 非端口通道事件不得作为 push 载荷（settings/locale 走根通道）
    expect(isHostToWebview({
      kind: 'refEdit.push',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      message: { kind: 'view.mode.set', mode: 'live' },
    })).toBe(false)
  })

  it('refEdit.dirty / refEdit.save.result 接受完整载荷', () => {
    expect(isHostToWebview({ kind: 'refEdit.dirty', fsPath: 'D:\\b.md', dirty: true })).toBe(true)
    expect(isHostToWebview({ kind: 'refEdit.dirty', fsPath: 'D:\\b.md' })).toBe(false)
    expect(isHostToWebview({ kind: 'refEdit.save.result', portId: 'panel-9', fsPath: 'D:\\b.md', ok: true })).toBe(true)
    expect(isHostToWebview({ kind: 'refEdit.save.result', portId: 'panel-9', fsPath: 'D:\\b.md' })).toBe(false)
  })

  it('P2-12：refEdit.conflictCompare（webview → 宿主）接受完整载荷并拒绝缺 text', () => {
    expect(isWebviewToHost({
      kind: 'refEdit.conflictCompare',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      text: '# 冲突输入全文',
    })).toBe(true)
    // text 是临时副本的唯一内容来源，缺失/错型整体拒绝
    expect(isWebviewToHost({
      kind: 'refEdit.conflictCompare',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
    })).toBe(false)
    expect(isWebviewToHost({
      kind: 'refEdit.conflictCompare',
      ...PANEL,
      portId: 'panel-9',
      fsPath: 'D:\\notes\\b.md',
      text: 42,
    })).toBe(false)
  })

  it('P2-12：refEdit.conflictCompare.result（宿主 → webview）接受完整载荷并拒绝缺 ok', () => {
    expect(isHostToWebview({
      kind: 'refEdit.conflictCompare.result',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      ok: true,
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.conflictCompare.result',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
      ok: false,
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.conflictCompare.result',
      portId: 'panel-9',
      fsPath: 'D:\\b.md',
    })).toBe(false)
  })
})
