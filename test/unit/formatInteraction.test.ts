// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EditorState, StateEffect } from '@codemirror/state'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { FORMAT_OPERATIONS } from '../../src/shared/formatOperations'
import { selectTableRegion } from '../../src/webview/tableRegionSelection'
import type { WebviewToHost } from '../../src/shared/protocol'

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function setup(text: string) {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (message) => sent.push(message as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'))
  controller.handleHostMessage({ kind: 'init', sessionId: 'format', docUri: 'file:///format.md', version: 1, text })
  return { controller, sent, view: controller.getView()! }
}

describe('格式命令生产链路', () => {
  it('命令面板消息走 CM6 单事务及 edit.request，撤销只需一笔', () => {
    const { controller, sent, view } = setup('中文 English')
    view.dispatch({ selection: { anchor: 1 } })
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('**中文** English')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    expect(sent.at(-1)).toMatchObject({ kind: 'edit.request', changes: [
      { offset: 0, length: 2, text: '**中文**' },
    ] })
  })

  it('无选区围栏两态切换：包裹后光标在开围栏内侧，再按取消，三按复原', () => {
    const cases = [
      ['bold', '**word**'], ['italic', '*word*'],
      ['strikethrough', '~~word~~'], ['inlineCode', '`word`'],
    ] as const
    for (const [op, wrapped] of cases) {
      const { controller, view } = setup('word')
      view.dispatch({ selection: { anchor: 0 } })
      controller.handleHostMessage({ kind: 'format.command', op })
      expect(view.state.doc.toString()).toBe(wrapped)
      expect(view.state.selection.main.head).toBe(wrapped.indexOf('word'))
      controller.handleHostMessage({ kind: 'format.command', op })
      expect(view.state.doc.toString()).toBe('word')
      controller.handleHostMessage({ kind: 'format.command', op })
      expect(view.state.doc.toString()).toBe(wrapped)
    }
  })

  it('阅读态拒绝写入；源码模式不由格式命令接管', () => {
    const { controller, sent, view } = setup('文字')
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('文字')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('只读状态与暂停写回状态拒绝格式操作', () => {
    const { controller, sent, view } = setup('文字')
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('文字')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    controller.handleHostMessage({ kind: 'session.suspended', version: 1, reason: 'conflict' })
    controller.handleHostMessage({ kind: 'format.command', op: 'italic' })
    expect(view.state.doc.toString()).toBe('文字')
  })

  it('矩形格区经同一命令一次写回两格，其他列不变', () => {
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    const { controller, sent, view } = setup(table)
    selectTableRegion(view, { tableFrom: 0, rowFrom: 0, rowTo: 1, columnFrom: 0, columnTo: 0 })
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('| **A** | B |\n| --- | --- |\n| **x** | y |')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })

  it('分割线插入经同一命令链路：单事务写回、光标落行尾（#106）', () => {
    const { controller, sent, view } = setup('上文\n下文')
    view.dispatch({ selection: { anchor: 2 } })
    controller.handleHostMessage({ kind: 'format.command', op: 'horizontalRule' })
    expect(view.state.doc.toString()).toBe('上文\n\n---\n\n下文')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    expect(sent.at(-1)).toMatchObject({ kind: 'edit.request', changes: [
      { offset: 0, length: 2, text: '上文\n\n---\n' },
    ] })
    expect(view.state.selection.main.anchor).toBe(7)
  })

  it('清单覆盖全部操作，写操作只在 Live，约定默认键位准确', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { commands: Array<{ command: string }> }
    }
    for (const item of FORMAT_OPERATIONS) {
      expect(manifest.contributes.commands.some((command) => command.command === item.command)).toBe(true)
      expect(item.mode).toBe('live')
      expect(item.writes).toBe(true)
    }
    const bindings = FORMAT_OPERATIONS.filter((item) => item.defaultKey !== null)
    expect(bindings.map((item) => item.id)).toEqual([
      'bold', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'headingNone',
      'htmlComment',
    ])
  })

  it('行内围栏两态往返：光标在围栏内再触发即取消整段（显式枚举，#105 起含高亮）', () => {
    const cases: ReadonlyArray<[typeof FORMAT_OPERATIONS[number]['id'], string]> = [
      ['bold', '**文字**'],
      ['italic', '*文字*'],
      ['strikethrough', '~~文字~~'],
      ['inlineCode', '`文字`'],
      ['highlight', '==文字=='],
    ]
    for (const [op, text] of cases) {
      const { controller, view } = setup(text)
      view.dispatch({ selection: { anchor: text.indexOf('文字') } })
      controller.handleHostMessage({ kind: 'format.command', op })
      expect(view.state.doc.toString(), `操作 ${op}`).toBe('文字')
      controller.dispose()
    }
  })

  it('贴边两态三按：包裹带光标定位，再按只拆所在对，三按复原（#107）', () => {
    const { controller, view } = setup('**加粗**普通')
    view.dispatch({ selection: { anchor: 6 } })
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('**加粗****普通**')
    expect(view.state.selection.main.anchor).toBe(8)
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('**加粗**普通')
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toBe('**加粗****普通**')
  })

  it('围栏开边界贴邻即取消：行首与行尾对称（#107，显式枚举）', () => {
    const cases: ReadonlyArray<[typeof FORMAT_OPERATIONS[number]['id'], string]> = [
      ['bold', '**文字**'],
      ['italic', '*文字*'],
      ['strikethrough', '~~文字~~'],
      ['inlineCode', '`文字`'],
      ['highlight', '==文字=='],
    ]
    for (const [op, text] of cases) {
      const head = setup(text)
      head.view.dispatch({ selection: { anchor: 0 } })
      head.controller.handleHostMessage({ kind: 'format.command', op })
      expect(head.view.state.doc.toString(), `操作 ${op} 行首`).toBe('文字')
      head.controller.dispose()
      const tail = setup(text)
      tail.view.dispatch({ selection: { anchor: text.length } })
      tail.controller.handleHostMessage({ kind: 'format.command', op })
      expect(tail.view.state.doc.toString(), `操作 ${op} 行尾`).toBe('文字')
      tail.controller.dispose()
    }
  })

  it('合并形态贴边往返与独立节点贴边往返经生产链路（#107）', () => {
    // italic / inlineCode 的贴边产物是合并节点：二按按 mark 出现顺序拆光标所在对
    const italic = setup('*斜体*普通')
    italic.view.dispatch({ selection: { anchor: 5 } })
    italic.controller.handleHostMessage({ kind: 'format.command', op: 'italic' })
    expect(italic.view.state.doc.toString()).toBe('*斜体**普通*')
    italic.controller.handleHostMessage({ kind: 'format.command', op: 'italic' })
    expect(italic.view.state.doc.toString()).toBe('*斜体*普通')
    italic.controller.dispose()
    const code = setup('`码`文')
    code.view.dispatch({ selection: { anchor: 3 } })
    code.controller.handleHostMessage({ kind: 'format.command', op: 'inlineCode' })
    expect(code.view.state.doc.toString()).toBe('`码``文`')
    code.controller.handleHostMessage({ kind: 'format.command', op: 'inlineCode' })
    expect(code.view.state.doc.toString()).toBe('`码`文')
    code.controller.dispose()
    // strikethrough / highlight 的贴边产物是独立节点：两态往返
    const strike = setup('~~删除~~普通')
    strike.view.dispatch({ selection: { anchor: 6 } })
    strike.controller.handleHostMessage({ kind: 'format.command', op: 'strikethrough' })
    expect(strike.view.state.doc.toString()).toBe('~~删除~~~~普通~~')
    strike.controller.handleHostMessage({ kind: 'format.command', op: 'strikethrough' })
    expect(strike.view.state.doc.toString()).toBe('~~删除~~普通')
    strike.controller.dispose()
  })

  it('围栏前贴邻取消三按链路：取消得裸词，再按扩词包裹复原（#107 补缺口）', () => {
    // 行首侧：一按取消（光标 0 映射后仍在行首），二按取到词包裹复原
    const head = setup('**word**')
    head.view.dispatch({ selection: { anchor: 0 } })
    head.controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(head.view.state.doc.toString()).toBe('word')
    head.controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(head.view.state.doc.toString()).toBe('**word**')
    head.controller.dispose()
    // 行尾侧：一按取消（光标映射到裸词末），二按光标在词内取词包裹复原
    const tail = setup('**word**')
    tail.view.dispatch({ selection: { anchor: 8 } })
    tail.controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(tail.view.state.doc.toString()).toBe('word')
    tail.controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(tail.view.state.doc.toString()).toBe('**word**')
    tail.controller.dispose()
  })

  it('升级定界符围栏取消经生产链路：光标在内容中整拆得裸内容（#107 审查修复）', () => {
    const code = setup('``码``')
    code.view.dispatch({ selection: { anchor: 2 } })
    code.controller.handleHostMessage({ kind: 'format.command', op: 'inlineCode' })
    expect(code.view.state.doc.toString()).toBe('码')
    code.controller.dispose()
  })

  it('HTML 注释两态经生产链路（#139）：空插落光标开围栏内侧，再按取消复原，逐笔写回', () => {
    const { controller, sent, view } = setup('正文')
    view.dispatch({ selection: { anchor: 1 } })
    controller.handleHostMessage({ kind: 'format.command', op: 'htmlComment' })
    expect(view.state.doc.toString()).toBe('正<!-- -->文')
    expect(view.state.selection.main.anchor).toBe(5)
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    // 光标在空对（Comment 节点）内再按 → 取消整对。第二笔与前笔未确认
    // 区间相触会并入暂缓链（既有协议行为）：先确认第一笔，第二笔立即
    // 出站——每笔 edit.request 对应宿主一次撤销单元
    controller.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    controller.handleHostMessage({ kind: 'format.command', op: 'htmlComment' })
    expect(view.state.doc.toString()).toBe('正文')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(2)
  })

  it('HTML 注释选区包裹经生产链路（#139）：原文保持选中，注释内取消剥定界符', () => {
    const wrapped = setup('前言 内容 后缀')
    wrapped.view.dispatch({ selection: { anchor: 3, head: 5 } })
    wrapped.controller.handleHostMessage({ kind: 'format.command', op: 'htmlComment' })
    expect(wrapped.view.state.doc.toString()).toBe('前言 <!--内容--> 后缀')
    expect(wrapped.view.state.selection.main).toMatchObject({ anchor: 7, head: 9 })
    // 光标留在注释内（折叠）：再按取消，剥定界符保留内容
    wrapped.view.dispatch({ selection: { anchor: 7 } })
    wrapped.controller.handleHostMessage({ kind: 'format.command', op: 'htmlComment' })
    expect(wrapped.view.state.doc.toString()).toBe('前言 内容 后缀')
    wrapped.controller.dispose()
  })

  it('高亮命令走 CM6 单事务写回（与 bold 同链路）', () => {
    const { controller, sent, view } = setup('中文 English')
    view.dispatch({ selection: { anchor: 0 } })
    controller.handleHostMessage({ kind: 'format.command', op: 'highlight' })
    expect(view.state.doc.toString()).toBe('==中文== English')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    expect(sent.at(-1)).toMatchObject({ kind: 'edit.request', changes: [
      { offset: 0, length: 2, text: '==中文==' },
    ] })
  })
})
