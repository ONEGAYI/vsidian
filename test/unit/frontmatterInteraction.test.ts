// @vitest-environment jsdom
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

// #94 起文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)

// frontmatter 表格卡片交互契约（工单 #140 Popover 改版，2026-09-27 验收
// 反馈：格内直接编辑退役，改为「只读表格 + 标题栏修改按钮 + Popover」）。
//
// 核心断言（用户可观察行为，非实现复述）：
// - 成型：合法头区渲染只读表格（标题栏 + 修改按钮 + 两列网格行）；格内
//   无 ×/＋ 按钮、闭合行无「添加属性」整行按钮
// - 光标引导：成型态不暴露源码——光标/选区进入头区被弹到闭合行后；
//   Popover 写回、外部同步、撤销不受影响；降级形态可编辑
// - Popover 编辑：键/值/项输入即时写回（一笔键入 = 一笔事务）；删行/
//   删项/加项/添加属性各为一笔事务；Esc 与外点关闭、焦点返还
// - 出站链路：控制器级验证输入与按钮操作走 edit.request → 宿主权威
//   回读一致；外部同步改头区时浮层内容跟随刷新
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { DocumentSession, type HostDocumentPort, type SessionNotice } from '../../src/host/documentSession'
import { livePreviewDecorations } from '../../src/webview/liveDecorations'
import { frontmatterEditing } from '../../src/webview/frontmatterEditing'
import { FM_POPOVER_CLASS_NAMES } from '../../src/webview/frontmatterPopover'
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

/** 闭合行行尾与 body 起点（光标引导目标：闭合行后的换行之后的行首） */
const BODY_START = FM_DOC.indexOf('---', 4) + 3 + 1

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
  controller.mount(document.createElement('div'), [])
  await settle()
  return { controller, session, doc }
}

/** 编辑器级直驱视图（装饰 + 光标引导；Popover 经标题栏按钮打开） */
function makeFmView(doc: string, anchor = doc.length): EditorView {
  return new EditorView({
    parent: document.body.appendChild(document.createElement('div')),
    state: EditorState.create({
      doc,
      extensions: [livePreviewDecorations, frontmatterEditing],
      selection: EditorSelection.single(anchor),
    }),
  })
}

function popoverEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${FM_POPOVER_CLASS_NAMES.popover}`)
}

function clickEditButton(view: EditorView): void {
  const btn = view.contentDOM.querySelector<HTMLButtonElement>('.vsidian-fm-edit')
  if (!btn) throw new Error('修改按钮不在场')
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function popInput(role: string, index = 0): HTMLInputElement {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    `.${FM_POPOVER_CLASS_NAMES.popover} .${FM_POPOVER_CLASS_NAMES.input}.${role}`)
  const input = inputs[index]
  if (!input) throw new Error(`Popover ${role} 输入框不在场`)
  return input
}

function typeInto(input: HTMLInputElement, text: string): void {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function clickPopoverButton(cls: string, index = 0): void {
  const btns = document.querySelectorAll<HTMLButtonElement>(
    `.${FM_POPOVER_CLASS_NAMES.popover} .${cls}`)
  const btn = btns[index]
  if (!btn) throw new Error(`Popover 按钮 ${cls} 不在场`)
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** 删除按钮两段式二次确认：首击进确认态（断言武装类在场），再击执行 */
function confirmRemoveButton(index = 0): void {
  const btns = document.querySelectorAll<HTMLButtonElement>(
    `.${FM_POPOVER_CLASS_NAMES.popover} .${FM_POPOVER_CLASS_NAMES.remove}`)
  const btn = btns[index]
  if (!btn) throw new Error('Popover 删除按钮不在场')
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  if (!btn.classList.contains(FM_POPOVER_CLASS_NAMES.removeArmed)) {
    throw new Error('首击删除按钮应进入确认态（armed 类）')
  }
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('成型与降级切换（只读表格）', () => {
  it('合法头区渲染标题栏与两列网格：修改按钮在场，行内无结构按钮', () => {
    const view = makeFmView(FM_DOC)
    const root = view.contentDOM
    expect(root.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    const first = root.querySelectorAll('.vsidian-fm-row')[0]!
    expect(first.querySelector('.vsidian-fm-key')?.textContent).toBe('title')
    expect(first.querySelector('.vsidian-fm-value')?.textContent).toBe('hello')
    // 标题栏：图标 + Properties 标题 + 修改按钮
    expect(root.querySelector('.vsidian-fm-header-title')?.textContent).toBe('属性')
    expect(root.querySelector('.vsidian-fm-header-icon')).not.toBeNull()
    expect(root.querySelector<HTMLButtonElement>('.vsidian-fm-edit')?.getAttribute('aria-label')).toBe('修改')
    // 格内编辑时代的三类控件全部退役
    expect(root.querySelectorAll('.vsidian-fm-remove')).toHaveLength(0)
    expect(root.querySelectorAll('.vsidian-fm-add-item')).toHaveLength(0)
    expect(root.querySelectorAll('.vsidian-fm-add-entry')).toHaveLength(0)
    expect(root.querySelectorAll('.vsidian-fm-empty-value')).toHaveLength(0)
    expect(root.querySelectorAll('.vsidian-fm-card-line').length).toBe(4)
    view.destroy()
  })

  it('数组 block 形态：项行占位键列与项文本呈现，行内无按钮', () => {
    const view = makeFmView(ARRAY_DOC)
    const rows = view.contentDOM.querySelectorAll('.vsidian-fm-row')
    expect(rows).toHaveLength(3) // 宿主行 + 两项行
    expect(rows[1]?.classList.contains('vsidian-fm-item-row')).toBe(true)
    expect(rows[1]?.querySelector('.vsidian-fm-value')?.textContent).toBe('alpha')
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-remove')).toHaveLength(0)
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-add-item')).toHaveLength(0)
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

describe('光标引导（成型态不暴露源码）', () => {
  it('光标进入头区被弹到闭合行后（正文起点），文档字节不变', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    view.dispatch({ selection: EditorSelection.cursor(FM_DOC.indexOf('hello')) })
    expect(view.state.selection.main.head).toBe(BODY_START)
    expect(view.state.doc.toString()).toBe(FM_DOC) // 零写回
    // 闭合围栏行本体也拦截（标题栏替换区点击落位场景）
    view.dispatch({ selection: EditorSelection.cursor(FM_DOC.indexOf('---', 4) + 1) })
    expect(view.state.selection.main.head).toBe(BODY_START)
    view.destroy()
  })

  it('选区跨越头区时收敛为正文单光标；首围栏行与键值行同样拦截', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    view.dispatch({ selection: EditorSelection.range(FM_DOC.indexOf('title'), FM_DOC.indexOf('正文段落。') + 2) })
    const sel = view.state.selection.main
    expect(sel.head).toBe(BODY_START)
    expect(sel.empty).toBe(true)
    // 头区首字符（打开文档默认光标 0 场景）
    view.dispatch({ selection: EditorSelection.cursor(0) })
    expect(view.state.selection.main.head).toBe(BODY_START)
    view.destroy()
  })

  it('Popover 式写回（头区变更 + 无选区）不受拦截；undo 恢复的选区被兜底弹出', async () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    // 头区写回不带选区（Popover dispatchPlan 口径）→ 照常落文档
    const worldAt = FM_DOC.indexOf('hello')
    view.dispatch({ changes: { from: worldAt, to: worldAt + 5, insert: 'world' } })
    expect(view.state.doc.toString()).toContain('title: world')
    // 撤销恢复（userEvent undo 豁免 filter）；恢复后的选区若落头区由兜底
    // 弹出（update 途中不得 dispatch,兜底在微任务重读最新状态后执行）
    view.dispatch({
      changes: { from: worldAt, to: worldAt + 5, insert: 'hello' },
      selection: { anchor: worldAt + 2 },
      userEvent: 'undo',
    })
    expect(view.state.doc.toString()).toBe(FM_DOC)
    await new Promise((r) => setTimeout(r, 0))
    expect(view.state.selection.main.head).toBe(BODY_START)
    view.destroy()
  })

  it('降级形态不引导：光标可入源码头区编辑', () => {
    const degraded = '---\nouter:\n  inner: 1\n---\n\n正文'
    const view = makeFmView(degraded, degraded.length)
    view.dispatch({ selection: EditorSelection.cursor(degraded.indexOf('inner')) })
    expect(view.state.selection.main.head).toBe(degraded.indexOf('inner'))
    view.destroy()
  })
})

describe('Popover 编辑（结构操作与即时写回）', () => {
  it('点修改按钮开浮层：焦点入首个键输入框；再点同按钮关闭并返还焦点', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    const btn = view.contentDOM.querySelector<HTMLButtonElement>('.vsidian-fm-edit')!
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(popoverEl()).not.toBeNull()
    expect(document.activeElement).toBe(popInput(FM_POPOVER_CLASS_NAMES.key))
    // 再点同按钮 = 关闭，焦点返还修改按钮
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(popoverEl()).toBeNull()
    expect(document.activeElement).toBe(btn)
    view.destroy()
  })

  it('Esc 关闭浮层并返还焦点；点击浮层外关闭', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    clickEditButton(view)
    expect(popoverEl()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(popoverEl()).toBeNull()
    expect(document.activeElement).toBe(view.contentDOM.querySelector('.vsidian-fm-edit'))
    // 外点关闭：浮层外 pointerdown
    clickEditButton(view)
    expect(popoverEl()).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(popoverEl()).toBeNull()
    // 浮层内 pointerdown 不关闭
    clickEditButton(view)
    popoverEl()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(popoverEl()).not.toBeNull()
    view.destroy()
  })

  it('键与值输入即时写回源文本（一笔键入 = 一笔事务）', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    clickEditButton(view)
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.key, 0), 'name')
    expect(view.state.doc.toString()).toContain('name: hello')
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.value, 0), 'world!')
    expect(view.state.doc.toString()).toContain('name: world!')
    expect(view.state.doc.toString()).toBe(FM_DOC.replace('title: hello', 'name: world!'))
    // 表格行跟随刷新（浮层重建不断链）
    expect(view.contentDOM.querySelector('.vsidian-fm-key')?.textContent).toBe('name')
    view.destroy()
  })

  it('空键名与重复键名不写回（标错类），源文本保持合法', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    clickEditButton(view)
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.key, 0), 'count')
    expect(view.state.doc.toString()).toContain('title: hello') // 未写回
    expect(popInput(FM_POPOVER_CLASS_NAMES.key, 0).classList.contains(FM_POPOVER_CLASS_NAMES.invalid)).toBe(true)
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.key, 0), '')
    expect(view.state.doc.toString()).toContain('title: hello')
    // 恢复合法键名后标错清除且写回恢复
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.key, 0), 'title')
    expect(popInput(FM_POPOVER_CLASS_NAMES.key, 0).classList.contains(FM_POPOVER_CLASS_NAMES.invalid)).toBe(false)
    view.destroy()
  })

  it('block 数组：项输入即时写回、删项与加项按钮单笔写回', () => {
    const view = makeFmView(ARRAY_DOC, ARRAY_DOC.length)
    clickEditButton(view)
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.item, 0), 'alpha!')
    expect(view.state.doc.toString()).toContain('  - alpha!')
    // 删首项（alpha!）：只剩 beta
    confirmRemoveButton(1) // 0=删行 1=首项删
    expect(view.state.doc.toString()).toBe(
      ['---', 'tags:', '  - beta', '---', '', '正文。', ''].join('\n'))
    // 加项：末尾插入模板项
    clickPopoverButton(FM_POPOVER_CLASS_NAMES.addItem, 0)
    expect(view.state.doc.toString()).toContain('  - beta\n  - item')
    view.destroy()
  })

  it('删行按钮整组移除条目；添加属性按钮插入模板行并聚焦新行键框全选', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    clickEditButton(view)
    confirmRemoveButton(0)
    expect(view.state.doc.toString()).toBe(FM_DOC.replace('title: hello\n', ''))
    // 添加属性：新行 + 焦点落新键框全选（直接键入覆盖默认键名）
    clickPopoverButton(FM_POPOVER_CLASS_NAMES.add, 0)
    expect(view.state.doc.toString()).toContain('count: 3\nkey: value\n---')
    const active = document.activeElement as HTMLInputElement
    expect(active.classList.contains(FM_POPOVER_CLASS_NAMES.key)).toBe(true)
    expect(active.value).toBe('key')
    expect(active.selectionStart).toBe(0)
    expect(active.selectionEnd).toBe(3)
    typeInto(active, 'name')
    expect(view.state.doc.toString()).toContain('name: value')
    view.destroy()
  })

  it('flow 数组值整框原文编辑；空值标量提供加项入口（tags 空值起步）', () => {
    const flowDoc = '---\ntags: [a, b]\ncount: 1\n---'
    const view = makeFmView(flowDoc, flowDoc.length)
    clickEditButton(view)
    expect(popInput(FM_POPOVER_CLASS_NAMES.value, 0).value).toBe('[a, b]')
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.value, 0), '[a, b, c]')
    expect(view.state.doc.toString()).toContain('tags: [a, b, c]')
    view.destroy()

    const emptyDoc = '---\ntags:\n---'
    const view2 = makeFmView(emptyDoc, emptyDoc.length)
    clickEditButton(view2)
    clickPopoverButton(FM_POPOVER_CLASS_NAMES.addItem, 0)
    expect(view2.state.doc.toString()).toBe('---\ntags:\n  - item\n---')
    view2.destroy()
  })

  it('头区降级时浮层自动关闭（回源码形态编辑）', () => {
    const view = makeFmView(FM_DOC, FM_DOC.length)
    clickEditButton(view)
    expect(popoverEl()).not.toBeNull()
    // 外部把头区改坏（嵌套）→ 解析降级 → 浮层失去依据自动关闭
    const at = FM_DOC.indexOf('\ncount')
    view.dispatch({ changes: { from: at, insert: '\nouter:\n  inner: 1' } })
    expect(popoverEl()).toBeNull()
    view.destroy()
  })
})

describe('出站链路（控制器级）', () => {
  it('Popover 值输入经权威回读后卡片保持；按钮操作单笔写回落宿主', async () => {
    const linked = await setupLinked(FM_DOC)
    const view = linked.controller.getView()!
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    // Popover 值输入：一笔 edit.request → 宿主 applyChanges → 回读
    clickEditButton(view)
    typeInto(popInput(FM_POPOVER_CLASS_NAMES.value, 0), 'hello world')
    await settle()
    expect(linked.doc.getText()).toContain('title: hello world')
    expect(linked.doc.applyCalls.length).toBe(1)
    expect(view.contentDOM.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
    // 删行按钮：一笔写回
    const before = linked.doc.applyCalls.length
    confirmRemoveButton(1)
    await settle()
    expect(linked.doc.getText()).toContain('title: hello world')
    expect(linked.doc.applyCalls.length).toBe(before + 1)
    linked.controller.dispose()
  })

  it('外部变更同步：宿主侧改头区值，webview 卡片与打开中的浮层同步刷新', async () => {
    const linked = await setupLinked(FM_DOC)
    const view = linked.controller.getView()!
    clickEditButton(view)
    expect(popInput(FM_POPOVER_CLASS_NAMES.value, 0).value).toBe('hello')
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
    // 浮层仍打开且值框已刷新为外部新值
    expect(popoverEl()).not.toBeNull()
    expect(popInput(FM_POPOVER_CLASS_NAMES.value, 0).value).toBe('changed')
    linked.controller.dispose()
  })
})
