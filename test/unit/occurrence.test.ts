// 选下一处相同词（工单 #238）控制器契约（jsdom）：键位路由（Ctrl+D /
// Ctrl+K Ctrl+D 弦 / Ctrl+Shift+L）、匹配选项与查找面板同源联动、查找
// 选项条（迷你三按钮）的显示/在场/淡出、会话生命周期（选区外部变化/
// 失焦/开关切换结束会话）与 Esc 消费顺序。与浏览器套件（occurrence）
// 互补：本层驱动 CM6 事务与消息；浏览器层用真实键盘验证连按、弦键位
// 与多光标编辑回流。
// 文本布局（UTF-16 offset）：
// 'foo bar foo\nfood Foo bar\nfoo end'
//  foo:0-3 foo:8-11 food:12-16（内含 foo:12-15）Foo:17-20 foo:25-28
// 敏感+全字档命中：0-3 / 8-11 / 25-28；不敏感非全字：+12-15 +17-20。
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost } from '../../src/shared/protocol'

installLocale('zh-cn', zhCn)

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC = 'foo bar foo\nfood Foo bar\nfoo end'

function setup(text = DOC) {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => {
      sent.push(m as WebviewToHost)
      // 生产宿主行为回环：findOptions.set 清洗后广播 findOptions.snapshot
      const kind = (m as { kind?: string }).kind
      if (kind === 'findOptions.set') {
        const { options } = m as { options: Record<string, boolean> }
        queueMicrotask(() => {
          controller.handleHostMessage({ kind: 'findOptions.snapshot', options })
        })
      }
    },
    getState: () => undefined,
    setState() {},
  }
  const controller = new WebviewSyncController(bridge)
  const host = document.createElement('div')
  document.body.append(host)
  controller.mount(host, [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 'occurrence',
    docUri: 'file:///occurrence.md', version: 1, text })
  const view = controller.getView()!
  const bar = () => host.querySelector<HTMLElement>('.vsidian-occurrence-bar')
  const barOpen = () => !!bar()?.classList.contains('vsidian-occurrence-bar-open')
  const press = (key: string, init: KeyboardEventInit = {}) =>
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  const ranges = () =>
    view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
  const state = () => {
    const before = sent.length
    controller.handleHostMessage({ kind: 'view.state.request' })
    const msg = sent.slice(before).find((m) => m.kind === 'view.state') as { occurrence?: {
      barOpen: boolean
      matchCase: boolean
      wholeWord: boolean
      regexp: boolean
    } }
    return msg.occurrence ?? null
  }
  return { controller, sent, view, host, bar, barOpen, press, ranges, state }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Ctrl+D 键位与匹配语义（#238）', () => {
  it('空光标在词上：首次按下选中整词（override 档种子，不加选）', () => {
    const { view, ranges, press } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 8, to: 11 }])
  })

  it('连按追加下一处相同词（override 档：Foo 与 food 内 foo 不进候选），文档尾 wrap', () => {
    const { view, ranges, press } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 8, to: 11 }, { from: 25, to: 28 }])
    press('d', { ctrlKey: true })
    // wrap 回头部 foo:0-3
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
    // 全部命中已选：保持
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
  })

  it('会话档固定：面板 matchCase 记忆为关时，空选区种子的 override 档不随选区出现漂移', () => {
    const { view, ranges, press, controller } = setup()
    // 面板开关记忆档：matchCase 关（默认档），若按面板档 Foo 将进候选
    controller.handleHostMessage({ kind: 'findOptions.snapshot',
      options: { matchCase: false, wholeWord: false, regexp: false } })
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    press('d', { ctrlKey: true })
    press('d', { ctrlKey: true })
    // override 档（敏感+全字）三处已选，第四次 wrap；Foo:17-20 始终不进
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
  })

  it('有选区按下：选区文本为词、沿用面板开关记忆档（matchCase 关 → Foo 进候选）', () => {
    const { view, ranges, press, controller } = setup()
    controller.handleHostMessage({ kind: 'findOptions.snapshot',
      options: { matchCase: false, wholeWord: false, regexp: false } })
    // 手选 12-15（food 内 foo）——非全字档下它本身是命中
    view.dispatch({ selection: EditorSelection.range(12, 15) })
    press('d', { ctrlKey: true })
    // 不敏感非全字命中序：0-3, 8-11, 12-15, 17-20, 25-28；从 15 起下一处 17-20
    expect(ranges()).toEqual([{ from: 12, to: 15 }, { from: 17, to: 20 }])
  })

  it('阅读模式不路由（Live 编辑能力边界）', () => {
    const { view, ranges, press, controller } = setup()
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 9, to: 9 }])
    controller.dispose()
  })

  it('命令面板入口（ui.command）与快捷键共用同一实现', () => {
    const { view, ranges, controller } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    controller.handleHostMessage({ kind: 'ui.command', op: 'findSelectNext' })
    expect(ranges()).toEqual([{ from: 8, to: 11 }])
    controller.handleHostMessage({ kind: 'ui.command', op: 'findAllOccurrences' })
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
    controller.dispose()
  })
})

describe('查找选项条（#238 用户决策：每次按下直接打开三按钮迷你条）', () => {
  it('Ctrl+D 生效后选项条在场；三按钮 aria-pressed 与面板开关记忆同源', () => {
    const { view, press, bar, barOpen, state } = setup()
    expect(barOpen()).toBe(false)
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(barOpen()).toBe(true)
    expect(state()).toEqual({
      barOpen: true,
      matchCase: false, wholeWord: false, regexp: false,
    })
    const btn = bar()!.querySelector<HTMLElement>('.vsidian-occurrence-case')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('无效按下（光标不在词上）不显示选项条', () => {
    const { view, press, barOpen } = setup('foo  bar')
    view.dispatch({ selection: EditorSelection.cursor(4) })
    press('d', { ctrlKey: true })
    expect(barOpen()).toBe(false)
  })

  it('选项条点击切换：findOptions.set 出站持久化，下一次 Ctrl+D 即时随动新档', () => {
    const { view, press, bar, ranges, sent } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 8, to: 11 }])
    // 切 matchCase？不——先验证默认档（面板记忆三关）下的行为：
    // 选项条点击 matchCase 开启后，会话按新档重建，下一次加选 Foo 不再进候选
    const btn = bar()!.querySelector<HTMLElement>('.vsidian-occurrence-case')!
    btn.click()
    const sets = sent.filter((m) => m.kind === 'findOptions.set') as Array<{ options: {
      matchCase: boolean, wholeWord: boolean, regexp: boolean } }>
    expect(sets.at(-1)!.options).toEqual({ matchCase: true, wholeWord: false, regexp: false })
    // 选项条保持在场（会话重建，不淡出打断）
    expect(bar()!.classList.contains('vsidian-occurrence-bar-open')).toBe(true)
    // 下一次 Ctrl+D：新档（matchCase 开）——从 8-11 起下一处仍 25-28（全字关时
    // food 内 foo:12-15 也不是候选吗？非全字档下 12-15 是命中且在 11 之后！）
    press('d', { ctrlKey: true })
    // matchCase 开 + wholeWord 关：命中 0/8/12-15/25；从 11 起下一处 = 12-15
    expect(ranges()).toEqual([{ from: 8, to: 11 }, { from: 12, to: 15 }])
  })

  it('面板开关切换（外部 snapshot）同样结束并按新档重建会话', () => {
    const { view, press, controller, ranges, barOpen } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    controller.handleHostMessage({ kind: 'findOptions.snapshot',
      options: { matchCase: false, wholeWord: true, regexp: false } })
    expect(barOpen()).toBe(true)
    press('d', { ctrlKey: true })
    // 新档 matchCase 关 + wholeWord 开：命中 0/8/25 + Foo:17-20；从 11 起下一处 17-20
    expect(ranges()).toEqual([{ from: 8, to: 11 }, { from: 17, to: 20 }])
  })

  it('主查找面板打开时 Ctrl+D：选项条不出场，改为闪烁面板对应开关按钮', () => {
    const { view, press, barOpen, host } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    controller_openFind_helper()
    // 经 Ctrl+F：面板打开、词为空 → 面板开 → 选项条不出现
    const findPanel = host.querySelector<HTMLElement>('.vsidian-find')!
    expect(findPanel.classList.contains('vsidian-find-open')).toBe(true)
    // 焦点进查找输入框后回编辑器（面板保持开）
    view.focus()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(barOpen()).toBe(false)
    // override 档（matchCase+wholeWord）与面板显示（三关）脱节 → 闪烁两开关
    const flashed = host.querySelectorAll('.vsidian-find-flash')
    expect(flashed.length).toBe(2)
  })
})

/** 打开查找面板（不预置查询词）的生产等价入口（Ctrl+F 全局键，writes
 *  关——withinEditor 即可路由，dispatch 到 document 与 find.test.ts 同款） */
function controller_openFind_helper(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
}

describe('会话生命周期（对齐 VSCode：选区变化/失焦/开关切换结束会话）', () => {
  it('选区被外部改变：选项条淡出，下一次按下按新状态重建', () => {
    const { view, press, barOpen, ranges } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(barOpen()).toBe(true)
    // 用户点击别处（外部选区变化）
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' })
    expect(barOpen()).toBe(false)
    // 重建：光标在行首（'f' 上）→ 种子选词 foo
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 0, to: 3 }])
    expect(barOpen()).toBe(true)
  })

  it('编辑器失焦（focusout）：选项条淡出', () => {
    const { view, press, barOpen } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(barOpen()).toBe(true)
    view.contentDOM.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    expect(barOpen()).toBe(false)
  })

  it('window blur（webview 整体失焦）：选项条淡出', () => {
    const { view, press, barOpen } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    window.dispatchEvent(new Event('blur'))
    expect(barOpen()).toBe(false)
  })

  it('Esc：关选项条（多选区保留——收敛由下一次 Esc 经 CM6 simplifySelection）', () => {
    const { view, press, barOpen, ranges } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 8, to: 11 }, { from: 25, to: 28 }])
    press('Escape')
    expect(barOpen()).toBe(false)
    expect(ranges()).toEqual([{ from: 8, to: 11 }, { from: 25, to: 28 }])
  })

  it('切换到阅读模式：选项条淡出', () => {
    const { view, press, barOpen, controller } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('d', { ctrlKey: true })
    expect(barOpen()).toBe(true)
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(barOpen()).toBe(false)
    controller.dispose()
  })
})

describe('跳过链（Ctrl+K Ctrl+D）与全选（Ctrl+Shift+L）', () => {
  it('弦键位：首次种子 + 立即追加下一处；再按把最后选区替换为 wrap 命中', () => {
    const { view, ranges, press } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('k', { ctrlKey: true })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 8, to: 11 }, { from: 25, to: 28 }])
    press('k', { ctrlKey: true })
    press('d', { ctrlKey: true })
    // 25-28 被去掉，其后无未选命中 → wrap 回头部 0-3（净数量不变）
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }])
    // 三处全占前的推进：跳过 8-11，从其后接 25-28
    press('k', { ctrlKey: true })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 25, to: 28 }])
    // 补齐三处（Ctrl+D wrap 加 8-11）后跳过：唯一未选是刚去掉的 → 无候选保持
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
    press('k', { ctrlKey: true })
    press('d', { ctrlKey: true })
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
  })

  it('Ctrl+Shift+L：一次选中全部相同词（override 档全字，Foo/food 不进）', () => {
    const { view, ranges, press, barOpen } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('L', { ctrlKey: true, shiftKey: true })
    expect(ranges()).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }, { from: 25, to: 28 }])
    expect(barOpen()).toBe(true)
  })

  it('多光标编辑回流：全选后键入逐 range 改写（一笔 edit.request）', () => {
    const { view, press, sent } = setup()
    view.dispatch({ selection: EditorSelection.cursor(9) })
    press('L', { ctrlKey: true, shiftKey: true })
    const before = sent.filter((m) => m.kind === 'edit.request').length
    view.dispatch({
      changes: { from: 0, to: 3, insert: 'bar' },
      userEvent: 'input.type',
    })
    const edits = sent.filter((m) => m.kind === 'edit.request')
    expect(edits.length).toBe(before + 1)
    expect(view.state.doc.toString()).toBe('bar bar foo\nfood Foo bar\nfoo end')
  })
})

describe('选上一处相同词（命令面板入口，无默认键位）', () => {
  it('ui.command findSelectPrevious：从最前选区往前追加上一处（手选选区走面板记忆档，Foo 进候选）', () => {
    const { view, controller, ranges } = setup()
    // 手选 foo:25-28 —— 面板未开 + 有选区 → 面板开关记忆档（三关）：
    // 从最前往前上一处 = Foo:17-20（不敏感档 Foo 是候选）
    view.dispatch({ selection: EditorSelection.range(25, 28) })
    controller.handleHostMessage({ kind: 'ui.command', op: 'findSelectPrevious' })
    expect(ranges()).toEqual([{ from: 17, to: 20 }, { from: 25, to: 28 }])
    controller.dispose()
  })
})
