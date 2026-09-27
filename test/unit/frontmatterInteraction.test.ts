// @vitest-environment jsdom
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

// #94 起文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)

// frontmatter 表格卡片交互契约（工单 #140）：成型/降级切换、就地增删改
// 写回、键盘导航。
//
// 核心断言（用户可观察行为，非实现复述）：
// - 成型：合法头区渲染两列网格（键值分格、项行、添加按钮在场）
// - 降级：复杂类型/非法语法退回源码行类，编辑不受限，修复后实时恢复
// - 编辑：值格内键入直接改源文本且网格保持（输入回流走 CM6 原生路径）
// - 结构操作：按钮与 Enter 的编辑计划经标准事务派发（文档变更 + 选区）
// - 出站链路：控制器级验证增删改走 edit.request → 宿主权威回读一致
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { DocumentSession, type HostDocumentPort, type SessionNotice } from '../../src/host/documentSession'
import { livePreviewDecorations } from '../../src/webview/liveDecorations'
import {
  fmEnterKeyHandler,
  fmShiftTabKeyHandler,
  fmTabKeyHandler,
  frontmatterEditing,
} from '../../src/webview/frontmatterEditing'
import type { HostToWebview, SerChange, WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/fm.md'

const FM_DOC = ['---', 'title: hello', 'count: 3', '---', '', '正文段落。', ''].join('\n')

const ARRAY_DOC = ['---', 'tags:', '  - alpha', '  - beta', '---', '', '正文。', ''].join('\n')

/** 宿主文档桩（liveTable 同款形态：applyChanges 记账 + undo 栈） */
class FakeDoc implements HostDocumentPort {
  content: string
  ver: number
  applyCalls: SerChange[][] = []
  private undoStack: { changes: SerChange[]; before: string }[] = []
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

  async applyChanges(changes: SerChange[]): Promise<boolean> {
    this.applyCalls.push(changes)
    this.undoStack.push({ changes, before: this.content })
    let out = this.content
    for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
      out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
    }
    this.content = out
    this.ver++
    this.listener?.(changes, this.ver)
    return true
  }

  async undo(): Promise<boolean> {
    const top = this.undoStack.pop()
    if (!top) {
      return false
    }
    const inverse: SerChange[] = top.changes.map((c) => ({
      offset: c.offset,
      length: c.text.length,
      text: top.before.slice(c.offset, c.offset + c.length),
    }))
    this.content = top.before
    this.ver++
    this.listener?.(inverse, this.ver)
    return true
  }

  async redo(): Promise<boolean> {
    return false
  }

  isDirty(): boolean {
    return false
  }
}

/** 宿主请求队列串行化后排空 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

interface LinkedPanel {
  controller: WebviewSyncController
  session: DocumentSession
  doc: FakeDoc
}

async function setupLinked(text: string): Promise<LinkedPanel> {
  const doc = new FakeDoc(text)
  const notices: SessionNotice[] = []
  const session = new DocumentSession(doc, { docUri: DOC_URI, onNotice: (n) => notices.push(n) })
  doc.onDocChanged((changes, version) => session.handleDocChanged(changes, version))
  let sessionId = ''
  const bridge: VsCodeBridge = {
    postMessage: (m) => {
      const msg = m as WebviewToHost
      if (sessionId) {
        void session.handleWebviewMessage(msg, sessionId)
      }
    },
    getState: () => undefined,
    setState: () => undefined,
  }
  const controller = new WebviewSyncController(bridge)
  sessionId = session.attachPanel({
    send: (m: HostToWebview) => controller.handleHostMessage(m),
  })
  controller.mount(document.createElement('div'), [keymap.of(defaultKeymap)])
  await settle()
  return { controller, session, doc }
}

/** 编辑器级直驱视图（装饰 + 键位组） */
function makeFmView(doc: string, anchor = FM_DOC.length): EditorView {
  return new EditorView({
    parent: document.body.appendChild(document.createElement('div')),
    state: EditorState.create({
      doc,
      extensions: [livePreviewDecorations, frontmatterEditing],
      selection: EditorSelection.single(anchor),
    }),
  })
}

describe('成型与降级切换', () => {
  it('合法头区渲染两列网格：键值分格、项行、添加按钮在场', () => {
    const view = makeFmView(FM_DOC)
    const rows = view.contentDOM.querySelectorAll('.vsidian-fm-row')
    expect(rows).toHaveLength(2)
    const first = rows[0]!
    const key = first.querySelector('.vsidian-fm-key')
    const value = first.querySelector('.vsidian-fm-value')
    expect(key?.textContent).toBe('title')
    expect(value?.textContent).toBe('hello')
    expect(view.contentDOM.querySelector('.vsidian-fm-add-entry')?.textContent).toBe('添加属性')
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-card-line').length).toBe(4)
    view.destroy()
  })

  it('数组 block 形态：项行占位键列与项文本、项删除与加项按钮在场', () => {
    const view = makeFmView(ARRAY_DOC)
    const rows = view.contentDOM.querySelectorAll('.vsidian-fm-row')
    expect(rows).toHaveLength(3) // 宿主行 + 两项行
    expect(rows[1]?.classList.contains('vsidian-fm-item-row')).toBe(true)
    expect(rows[1]?.querySelector('.vsidian-fm-value')?.textContent).toBe('alpha')
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-remove').length).toBe(3) // 宿主 + 2 项
    expect(view.contentDOM.querySelector('.vsidian-fm-add-item')).not.toBeNull()
    view.destroy()
  })

  it('编辑致非法实时降级源码，修复后实时恢复（成型切换零丢失）', () => {
    const view = makeFmView(FM_DOC)
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    // 在 title 行后插入嵌套行 → 头区非法 → 降级源码行类
    const insertAt = FM_DOC.indexOf('\ncount')
    view.dispatch({ changes: { from: insertAt, insert: '\nouter:\n  inner: 1' } })
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(0)
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-card-line')).toHaveLength(0)
    // 撤销嵌套行 → 恢复成型
    view.dispatch({ changes: { from: insertAt, to: insertAt + '\nouter:\n  inner: 1'.length, insert: '' } })
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    view.destroy()
  })
})

describe('就地编辑（输入回流）', () => {
  it('值格内键入直接改源文本且网格保持', () => {
    const view = makeFmView(FM_DOC, FM_DOC.indexOf('hello') + 1)
    view.dispatch({
      changes: { from: FM_DOC.indexOf('hello') + 5, insert: '!' },
      selection: { anchor: FM_DOC.indexOf('hello') + 6 },
      userEvent: 'input.type',
    })
    expect(view.state.doc.toString()).toContain('title: hello!')
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    expect(view.contentDOM.querySelector('.vsidian-fm-value')?.textContent).toBe('hello!')
    view.destroy()
  })
})

describe('键盘导航（Tab/Enter）', () => {
  it('Tab 在 key/value 格间往返；头区外返回 false 落穿', () => {
    const view = makeFmView(FM_DOC, FM_DOC.indexOf('title') + 1)
    // key 格 → 本行 value
    expect(fmTabKeyHandler(view)).toBe(true)
    expect(view.state.selection.main.head).toBe(FM_DOC.indexOf('hello'))
    // value → 下行 key
    expect(fmTabKeyHandler(view)).toBe(true)
    expect(view.state.selection.main.head).toBe(FM_DOC.indexOf('count'))
    // Shift+Tab 反向：本行 key 的上一格是上行 value
    expect(fmShiftTabKeyHandler(view)).toBe(true)
    expect(view.state.selection.main.head).toBe(FM_DOC.indexOf('hello'))
    // 正文（头区外）不接管
    view.dispatch({ selection: EditorSelection.single(FM_DOC.indexOf('正文') + 1) })
    expect(fmTabKeyHandler(view)).toBe(false)
    view.destroy()
  })

  it('Enter 末值格新增键值对并选中新键；中间行导航下行', () => {
    const view = makeFmView(FM_DOC, FM_DOC.indexOf('hello') + 1)
    // 首行 value → Enter 导航到下行 value
    expect(fmEnterKeyHandler(view)).toBe(true)
    expect(view.state.selection.main.head).toBe(FM_DOC.indexOf('3'))
    // 末行 value → Enter 加键值对（默认 key: value 模板，键选中）
    expect(fmEnterKeyHandler(view)).toBe(true)
    const text = view.state.doc.toString()
    expect(text).toContain('count: 3\nkey: value\n---')
    const sel = view.state.selection.main
    expect(text.slice(sel.from, sel.to)).toBe('key')
    view.destroy()
  })

  it('Enter 数组末项加项（缩进对齐、项文本选中）', () => {
    const view = makeFmView(ARRAY_DOC, ARRAY_DOC.indexOf('beta') + 1)
    expect(fmEnterKeyHandler(view)).toBe(true)
    const text = view.state.doc.toString()
    expect(text).toContain('  - beta\n  - item')
    const sel = view.state.selection.main
    expect(text.slice(sel.from, sel.to)).toBe('item')
    view.destroy()
  })
})

describe('结构按钮（widget 派发）', () => {
  it('「添加属性」按钮点击插入模板行（文档变更 + 选中新键）', () => {
    const view = makeFmView(FM_DOC)
    const btn = view.contentDOM.querySelector<HTMLButtonElement>('.vsidian-fm-add-entry')
    expect(btn).not.toBeNull()
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const text = view.state.doc.toString()
    expect(text).toContain('count: 3\nkey: value\n---')
    expect(view.state.selection.main.empty).toBe(false) // 新键被选中
    view.destroy()
  })

  it('条目删除按钮点击移除整行（block 数组含全部项行）', () => {
    const view = makeFmView(ARRAY_DOC)
    const buttons = view.contentDOM.querySelectorAll<HTMLButtonElement>('.vsidian-fm-remove')
    // 首个 = 宿主行删除（tags 整组）
    buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toBe(['---', '---', '', '正文。', ''].join('\n'))
    view.destroy()
  })

  it('数组项删除按钮只移除该项行', () => {
    const view = makeFmView(ARRAY_DOC)
    const buttons = view.contentDOM.querySelectorAll<HTMLButtonElement>('.vsidian-fm-remove')
    // 末个 = 第二项（beta）
    buttons[buttons.length - 1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toBe(['---', 'tags:', '  - alpha', '---', '', '正文。', ''].join('\n'))
    view.destroy()
  })

  it('空值格占位点击补结构空格并定位（冒号后无空隙场景）', () => {
    const doc = '---\ntitle:\n---\n'
    const view = makeFmView(doc, doc.length)
    const empty = view.contentDOM.querySelector<HTMLElement>('.vsidian-fm-empty-value')
    expect(empty).not.toBeNull()
    empty!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toBe('---\ntitle: \n---\n')
    expect(view.state.selection.main.head).toBe(doc.indexOf(':') + 2)
    view.destroy()
  })
})

describe('出站链路（控制器级）', () => {
  it('值格键入经权威回读后卡片保持；按钮增删的文档变更落宿主', async () => {
    const linked = await setupLinked(FM_DOC)
    const view = linked.controller.getView()!
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    // 值格键入：edit.request → 宿主 applyChanges → 回读
    const at = FM_DOC.indexOf('hello')
    view.dispatch({ changes: { from: at + 5, insert: ' world' }, selection: { anchor: at + 11 }, userEvent: 'input.type' })
    await settle()
    expect(linked.doc.getText()).toContain('title: hello world')
    expect(linked.doc.applyCalls.length).toBe(1)
    // 添加属性按钮：一笔写回
    const before = linked.doc.applyCalls.length
    view.contentDOM.querySelector<HTMLButtonElement>('.vsidian-fm-add-entry')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(linked.doc.getText()).toContain('key: value')
    expect(linked.doc.applyCalls.length).toBe(before + 1)
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(3)
    linked.controller.dispose()
  })

  it('外部变更同步：宿主侧改头区值，webview 卡片跟随', async () => {
    const linked = await setupLinked(FM_DOC)
    const view = linked.controller.getView()!
    // 模拟外部编辑：宿主文档直接变更 → session 广播 doc.changed → webview 增量应用
    linked.doc.content = FM_DOC.replace('hello', 'changed')
    linked.doc.ver++
    linked.session.handleDocChanged(
      [{ offset: FM_DOC.indexOf('hello'), length: 5, text: 'changed' }],
      linked.doc.ver,
    )
    await settle()
    expect(view.state.doc.toString()).toContain('title: changed')
    expect(view.contentDOM.querySelector('.vsidian-fm-value')?.textContent).toBe('changed')
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    linked.controller.dispose()
  })
})
