// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { WebviewSyncController } from '../../src/webview/syncController'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost } from '../../src/shared/protocol'

if (!Range.prototype.getClientRects) { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect() }
let c: WebviewSyncController
afterEach(() => { c?.dispose(); document.body.replaceChildren() })
function mount(text = '旧内容', split = true, saved?: unknown) {
  installLocale('zh-cn', zhCn)
  const sent: WebviewToHost[] = []
  const persisted: unknown[] = []
  c = new WebviewSyncController({ postMessage: m => sent.push(m as WebviewToHost), getState: <T>() => saved as T | undefined, setState: state => persisted.push(state) })
  const app = document.createElement('div'); app.id = 'app'; document.body.append(app)
  c.mount(app); c.handleHostMessage({ kind: 'init', sessionId: 's', docUri: 'file:///d/a.md', version: 1, text })
  c.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.pasteAskBefore': false, 'editor.pasteSplitUndo': split } })
  const view = EditorView.findFromDOM(app.querySelector('.cm-editor')!)!
  view.focus(); view.dispatch({ selection: { anchor: 0, head: text.length } })
  return { sent, view, app, persisted }
}
function paste(view: EditorView, text = '新内容', html = '<b>新内容</b>') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items: [], types: ['text/html', 'text/plain'], getData: (type: string) => type === 'text/html' ? html : text } })
  view.contentDOM.dispatchEvent(event)
}
function edits(sent: WebviewToHost[]) { return sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request') }
function ack(seq: number, version: number) { c.handleHostMessage({ kind: 'edit.ack', seq, ok: true, version }) }
function undo(view: EditorView) { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })) }

describe('富文本粘贴两阶段出站', () => {
  it('同一宿主面板重载后粘贴组仍唯一，不复用旧历史的session/group', () => {
    const first = mount(); paste(first.view); ack(edits(first.sent)[0].seq, 2); ack(edits(first.sent)[1].seq, 3)
    const oldGroup = edits(first.sent)[0].paste!.group, saved = first.persisted.at(-1)
    c.dispose(); document.body.replaceChildren()
    const next = mount('**新内容**', true, saved); paste(next.view, '下一次', '<b>下一次</b>')
    expect(edits(next.sent)[0].seq).toBeGreaterThan(edits(first.sent)[1].seq)
    expect(edits(next.sent)[0].paste!.group).not.toBe(oldGroup)
  })
  it('CM已处理的Undo/Redo不再冒泡给宿主webview键盘转发，防一次按键撤两笔', () => {
    const { view, sent } = mount()
    const forwarded = vi.fn()
    window.addEventListener('keydown', forwarded)
    try {
      undo(view)
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }))
      expect(sent.filter(m => m.kind === 'history.request')).toHaveLength(2)
      expect(forwarded).not.toHaveBeenCalled()
    } finally { window.removeEventListener('keydown', forwarded) }
  })
  it('本地立即显示C；B确认后独立发送C，两条历史不混入后续输入', () => {
    const { sent, view, app } = mount()
    paste(view)
    expect(view.state.doc.toString()).toBe('**新内容**')
    expect(edits(sent)).toHaveLength(1)
    expect(edits(sent)[0].changes).toEqual([{ offset: 0, length: 3, text: '新内容' }])
    expect(edits(sent)[0]).toMatchObject({ paste: { stage: 'text', hasTextStep: true } })
    view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
    ack(edits(sent)[0].seq, 2)
    expect(edits(sent)).toHaveLength(2)
    expect(edits(sent)[1]).toMatchObject({ paste: { stage: 'format' } })
    expect(edits(sent)[1].changes).toEqual([{ offset: 0, length: 3, text: '**新内容**' }])
    ack(edits(sent)[1].seq, 3)
    expect(edits(sent)).toHaveLength(3)
    expect(edits(sent)[2].changes).toEqual([{ offset: 7, length: 0, text: '!' }])
    ack(edits(sent)[2].seq, 4)
    expect(app.querySelector('.vsidian-toast')).toBeNull()
  })
  it('快速双撤等待两个阶段确认，不先撤旧记录；迟到重复ACK不重复插入', () => {
    const { sent, view } = mount()
    paste(view); undo(view); undo(view)
    expect(sent.filter(m => m.kind === 'history.request')).toHaveLength(0)
    ack(edits(sent)[0].seq, 2)
    expect(sent.filter(m => m.kind === 'history.request')).toHaveLength(0)
    ack(edits(sent)[1].seq, 3); ack(edits(sent)[0].seq, 2)
    expect(sent.filter(m => m.kind === 'history.request')).toEqual([{ kind: 'history.request', op: 'undo' }, { kind: 'history.request', op: 'undo' }])
    expect(edits(sent)).toHaveLength(2)
  })
  it('关闭分步只有一笔；A=B时跳过空文本阶段，也不诱导撤销无关输入', () => {
    const first = mount('旧内容', false); paste(first.view)
    expect(edits(first.sent)[0].changes[0].text).toBe('**新内容**')
    expect(edits(first.sent)).toHaveLength(1)
    c.dispose(); document.body.replaceChildren()
    const second = mount('新内容'); paste(second.view)
    expect(edits(second.sent)).toHaveLength(1)
    expect(edits(second.sent)[0]).toMatchObject({ paste: { stage: 'format', hasTextStep: false } })
  })
  it('B成功、C失败保留本地内容及随后输入，不报告保留格式成功', () => {
    const { sent, view, app } = mount(); paste(view)
    view.dispatch({ changes: { from: 7, insert: '后续' } })
    ack(edits(sent)[0].seq, 2)
    c.handleHostMessage({ kind: 'edit.ack', seq: edits(sent)[1].seq, ok: false, reason: 'error', version: 2, text: '新内容' })
    expect(view.state.doc.toString()).toBe('**新内容**后续')
    expect(app.querySelector('.vsidian-toast')).toBeNull()
    ack(edits(sent)[1].seq, 3)
    expect(edits(sent)).toHaveLength(2)
  })
  it('首次提示依据真实Undo及对应阶段；快速第二次与后续输入清除过期引导，恢复原选区', () => {
    const { sent, view, app } = mount(); paste(view)
    ack(edits(sent)[0].seq, 2); ack(edits(sent)[1].seq, 3)
    const format = { ...edits(sent)[1].paste!, sessionId: 's' }
    const text = { ...edits(sent)[0].paste!, sessionId: 's' }
    c.handleHostMessage({ kind: 'doc.changed', origin: 'external', version: 4, changes: [{ offset: 0, length: 7, text: '新内容' }], reason: 'undo', paste: format })
    expect(app.querySelector('.vsidian-toast')?.textContent).toContain('再撤销一次')
    c.handleHostMessage({ kind: 'doc.changed', origin: 'external', version: 5, changes: [{ offset: 0, length: 3, text: '旧内容' }], reason: 'undo', paste: text })
    expect(app.querySelector('.vsidian-toast')).toBeNull()
    expect(view.state.selection.main.from).toBe(0); expect(view.state.selection.main.to).toBe(3)
    c.handleHostMessage({ kind: 'doc.changed', origin: 'external', version: 6, changes: [{ offset: 0, length: 3, text: '新内容' }], reason: 'redo', paste: text })
    expect(app.querySelector('.vsidian-toast')).toBeNull()
    c.handleHostMessage({ kind: 'doc.changed', origin: 'external', version: 7, changes: [{ offset: 0, length: 3, text: '**新内容**' }], reason: 'redo', paste: format })
    c.handleHostMessage({ kind: 'doc.changed', origin: 'external', version: 8, changes: [{ offset: 0, length: 7, text: '新内容' }], reason: 'undo', paste: format })
    view.dispatch({ changes: { from: 3, insert: '!' } })
    expect(app.querySelector('.vsidian-toast')).toBeNull()
  })
  it('多选区两行纯文本与三行Markdown不能在撤格式时改变文字分发', () => {
    const { sent, view, app } = mount('aa bb')
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 5)]) })
    paste(view, '甲\n乙', '<p><b>甲</b></p><p>乙</p>')
    const before = edits(sent)[0]
    expect(before.changes.map(c => c.text)).toEqual(['甲', '乙'])
    ack(before.seq, 2)
    expect(edits(sent)).toHaveLength(1)
    expect(view.state.doc.toString()).toBe('甲 乙')
    expect(app.querySelector<HTMLElement>('.vsidian-toast')?.dataset['severity']).toBe('error')
    expect(app.querySelector('.vsidian-toast')?.textContent).toBe('无法保留格式，已粘贴为纯文本')
  })
})
