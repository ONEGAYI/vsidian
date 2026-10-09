// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// jsdom 无布局：为 CM6 的视口测量（measureTextSize → Range.getClientRects）
// 提供零值 polyfill（#413 用例经真实 EditorView 驱动折叠事务触发测量），
// 真宿主 Chromium 有真实实现（compositionBuffer.test.ts 同款先例）
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}
import { EditorView } from '@codemirror/view'
import { headingFoldField } from '../../src/webview/headingFold'
import { WebviewSyncController } from '../../src/webview/syncController'

describe('可绑定的大纲/侧栏操作', () => {
  it('命令入口与可见按钮共享状态，搜索会打开大纲并聚焦输入', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const controller = new WebviewSyncController({ postMessage() {}, getState() { return undefined }, setState() {} })
    controller.mount(root)
    controller.handleHostMessage({ kind: 'init', sessionId: 'ui-keys',
      docUri: 'file:///outline.md', version: 1, text: '# 标题\n\n## 子标题\n' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineSearch' })
    expect(root.querySelector('.vsidian-body')?.classList.contains('vsidian-sidebar-open')).toBe(true)
    expect(root.querySelector('.vsidian-sidebar')?.classList.contains('vsidian-outline-active')).toBe(true)
    expect(document.activeElement).toBe(root.querySelector('.vsidian-outline-search'))
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineCollapseAll' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineExpandAll' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineReset' })
    controller.dispose()
    root.remove()
  })
})

describe('#208 刷新嵌入资源（refreshEditor）命令入口', () => {
  it('ui.command op=refreshEditor 与工具栏按钮汇合：同款出站、同一 reqId 序列续接', () => {
    const sent: unknown[] = []
    const root = document.createElement('div')
    document.body.append(root)
    const controller = new WebviewSyncController({
      postMessage: (m) => sent.push(m),
      getState: () => undefined,
      setState: () => undefined,
    })
    controller.mount(root)
    controller.handleHostMessage({ kind: 'init', sessionId: 'ui-refresh',
      docUri: 'file:///refresh.md', version: 1, text: '# 标题\n' })
    // 快捷键链路：keybindings.execute 出站 → 宿主 executeCommand →
    // UI_OPERATIONS 注册的命令回发 ui.command → webview 与按钮共用同一
    // 发送实现（宿主编排在 documentSession 的 refresh.request 处理唯一）
    controller.handleHostMessage({ kind: 'ui.command', op: 'refreshEditor' })
    expect(sent.filter((m) => (m as { kind?: string }).kind === 'refresh.request'))
      .toEqual([{ kind: 'refresh.request', sessionId: 'ui-refresh',
        docUri: 'file:///refresh.md', reqId: 1 }])
    // 与按钮点击共用同一 reqId 序列（命令先触发 → 1，按钮点击 → 2，命令再触发 → 3）
    root.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')!.click()
    controller.handleHostMessage({ kind: 'ui.command', op: 'refreshEditor' })
    const reqs = sent.filter((m): m is { kind: string; reqId: number } =>
      (m as { kind?: string }).kind === 'refresh.request')
    expect(reqs.map((m) => m.reqId)).toEqual([1, 2, 3])
    controller.dispose()
    root.remove()
  })
})

// #413（#409 T02）标题折叠五操作：双入口（ui.command 命令面板回发与
// keybindingRouter document 捕获层本地分支）共用同一执行实现——两条入口
// 都落到 effect 直驱（setHeadingFolds），折叠是视图态零写回（无出站
// edit.request、文档零变更），Live 之外（阅读模式）静默不接管。
describe('#413 标题折叠五操作：ui.command 分发与键位本地分支', () => {
  const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# T3\n\ngamma\n'
  const T1 = 0
  const T2 = DOC.indexOf('## T2')
  const T3 = DOC.indexOf('# T3')
  const T2_LINE_END = T2 + '## T2'.length

  function setup(doc = DOC): { root: HTMLElement; controller: WebviewSyncController; sent: unknown[] } {
    const root = document.createElement('div')
    document.body.append(root)
    const sent: unknown[] = []
    const controller = new WebviewSyncController({
      postMessage: (m) => sent.push(m),
      getState: () => undefined,
      setState: () => undefined,
    })
    controller.mount(root)
    controller.handleHostMessage({ kind: 'init', sessionId: 'heading-fold-keys',
      docUri: 'file:///heading-fold.md', version: 1, text: doc })
    return { root, controller, sent }
  }

  function editor(root: HTMLElement): EditorView {
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)
    if (!view) throw new Error('未找到主编辑器实例')
    return view
  }

  function foldKeysOf(root: HTMLElement): number[] {
    const keys = editor(root).state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  }

  /** 经 document 捕获层派发真实 KeyboardEvent（与用户按键同路径） */
  function pressKey(root: HTMLElement, key: string, init: KeyboardEventInit): void {
    editor(root).contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, ...init, bubbles: true, cancelable: true }))
  }

  it('ui.command 分发：foldAll/unfoldAll/toggleFold/fold 逐操作生效且零写回', () => {
    const { root, controller, sent } = setup()
    controller.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('beta') })
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingFoldAll' })
    expect(foldKeysOf(root)).toEqual([T1, T2, T3])
    // 全部折叠后光标迁出隐藏区（beta 在 T2 节内 → 迁到 T2 标题行行尾）
    expect(editor(root).state.selection.main.head).toBe(T2_LINE_END)
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingUnfoldAll' })
    expect(foldKeysOf(root)).toEqual([])
    // 切换：辖域两态取反
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingToggleFold' })
    expect(foldKeysOf(root)).toEqual([T2])
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingToggleFold' })
    expect(foldKeysOf(root)).toEqual([])
    // 折叠：辖域标题
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingFold' })
    expect(foldKeysOf(root)).toEqual([T2])
    // 展开：辖域已折叠 → 展之
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingUnfold' })
    expect(foldKeysOf(root)).toEqual([])
    // 零写回：全程无出站编辑消息，文档零变更
    expect(sent.filter((m) => (m as { kind?: string }).kind === 'edit.request')).toEqual([])
    expect(editor(root).state.doc.toString()).toBe(DOC)
    controller.dispose()
    root.remove()
  })

  it('键位本地分支：Ctrl+Shift+[ 折叠 + 再按外扩，Ctrl+Shift+] 展开，Ctrl+K 弦切换', () => {
    const { root, controller, sent } = setup()
    controller.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('beta') })
    // Ctrl+Shift+[（美式布局事件字符 `{`）：折叠辖域 T2
    pressKey(root, '{', { ctrlKey: true, shiftKey: true })
    expect(foldKeysOf(root)).toEqual([T2])
    // 光标迁到 T2 标题行行尾；再按：T2 已折叠 → 外扩折 T1
    pressKey(root, '{', { ctrlKey: true, shiftKey: true })
    expect(foldKeysOf(root)).toEqual([T1, T2])
    // Ctrl+Shift+]（事件字符 `}`）：光标在外扩折叠时迁到 T1 标题行 →
    // 辖域 T1 已折叠 → 展 T1（内层 T2 折叠保持——嵌套独立性）
    pressKey(root, '}', { ctrlKey: true, shiftKey: true })
    expect(foldKeysOf(root)).toEqual([T2])
    // Ctrl+K Ctrl+L 弦：光标仍在 T1 标题行 → 切换 T1（未折叠 → 折）
    pressKey(root, 'k', { ctrlKey: true })
    pressKey(root, 'l', { ctrlKey: true })
    expect(foldKeysOf(root)).toEqual([T1, T2])
    // Ctrl+K Ctrl+0 / Ctrl+K Ctrl+J：全部折叠 / 全部展开
    pressKey(root, 'k', { ctrlKey: true })
    pressKey(root, '0', { ctrlKey: true })
    expect(foldKeysOf(root)).toEqual([T1, T2, T3])
    pressKey(root, 'k', { ctrlKey: true })
    pressKey(root, 'j', { ctrlKey: true })
    expect(foldKeysOf(root)).toEqual([])
    expect(sent.filter((m) => (m as { kind?: string }).kind === 'edit.request')).toEqual([])
    expect(editor(root).state.doc.toString()).toBe(DOC)
    controller.dispose()
    root.remove()
  })

  it('阅读模式静默：键位与命令均不触发折叠（无意外行为）', () => {
    const { root, controller } = setup()
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    editor(root).contentDOM.dispatchEvent(new KeyboardEvent('keydown',
      { key: '{', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingFoldAll' })
    expect(foldKeysOf(root)).toEqual([])
    controller.dispose()
    root.remove()
  })
})
