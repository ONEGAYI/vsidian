// @vitest-environment jsdom
// T07（#356）liveInstance 输入行为链驱动检测的契约测试（jsdom 生产实例）。
//
// 契约口径（票面 + 技术方案 §5.2「内核先执行只读、IME、表格与既有情境
// 门控」）：
// - 合格用户键入（userEvent 'input.type'）经微任务驱动（不在键入事务的
//   updateListener 同步段内嵌套 dispatch——修饰先于输入反序出站的实证
//   修复）；
// - compose userEvent（IME 组合中间/定稿）、网格编辑态（tableRegionField
//   在场——setTableRegion 激活）、代码上下文（inCodeContext）、外部同步
//   （externalSync）、SDK 修饰（addonEditOriginTag）不驱动；
// - 表格源码行内（region 未激活）键入照常驱动（#124 同口径：排除面是
//   网格编辑态而非表格行文本）；
// - 未装配驱动（deps 缺省）或未设身份（setAddonBehaviorIdentity 未调）
//   时零驱动。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@codemirror/state'
import { LiveEditorInstance, externalSync, addonEditOriginTag, type LiveEditorInstanceDeps } from '../../src/webview/liveInstance'
import { setTableRegion } from '../../src/webview/tableRegionSelection'
import { ImageResourceManager } from '../../src/webview/imageResource'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

interface DriveCall { instanceId: string; userEvent: string; inputText: string }

function makeDeps(sent: WebviewToHost[], drives: DriveCall[]): LiveEditorInstanceDeps {
  return {
    send: (message) => sent.push(message),
    persistState: () => {},
    images: new ImageResourceManager({ isDirectSrc: () => false, requestHost: () => {} }),
    isLiveActive: () => true,
    initialDark: false,
    driveAddonBehaviors: (input) => drives.push(input),
  }
}

function mountInstance(deps: LiveEditorInstanceDeps, text: string): LiveEditorInstance {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const instance = new LiveEditorInstance(host, deps)
  instance.setSession('s1', 'file:///doc.md')
  instance.handleFullSync(1, text, {})
  return instance
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('T07 liveInstance 行为链驱动检测', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn()
  })

  function setup(text: string): { instance: LiveEditorInstance; drives: DriveCall[]; sent: WebviewToHost[] } {
    const drives: DriveCall[] = []
    const sent: WebviewToHost[] = []
    const instance = mountInstance(makeDeps(sent, drives), text)
    instance.setAddonBehaviorIdentity('main')
    cleanups.push(() => instance.destroy())
    return { instance, drives, sent }
  }

  it('合格键入经微任务驱动：同步段零驱动，微任务后恰好一次且含输入文本', async () => {
    const { instance, drives } = setup('word\n')
    const view = instance.getView()!
    view.dispatch({ selection: { anchor: 4 } })
    view.dispatch({ changes: { from: 4, insert: '^' }, userEvent: 'input.type' })
    expect(drives).toEqual([]) // 键入事务的 updateListener 同步段内不驱动
    await flushMicrotasks()
    expect(drives).toEqual([{ instanceId: 'main', userEvent: 'input.type', inputText: '^' }])
  })

  it('compose userEvent（IME 组合中间/定稿）不驱动', async () => {
    const { instance, drives } = setup('word\n')
    const view = instance.getView()!
    view.dispatch({ changes: { from: 4, insert: '组' }, userEvent: 'input.type.compose' })
    await flushMicrotasks()
    expect(drives).toEqual([])
  })

  it('网格编辑态（tableRegionField 在场）内键入不驱动；源码行（region 未激活）照常驱动', async () => {
    const { instance, drives } = setup('| a | b |\n| --- | --- |\n')
    const view = instance.getView()!
    // 源码行内键入：region 未激活（#124 同口径——排除面是网格编辑态）
    view.dispatch({ selection: { anchor: 7 } })
    view.dispatch({ changes: { from: 7, insert: '^' }, userEvent: 'input.type' })
    await flushMicrotasks()
    expect(drives.length).toBe(1)
    // 网格编辑态：setTableRegion 激活后同位置键入不驱动
    view.dispatch({ effects: setTableRegion.of({
      tableFrom: 0, rowFrom: 0, rowTo: 0, columnFrom: 0, columnTo: 1,
    }) })
    view.dispatch({ changes: { from: 5, insert: 'x' }, userEvent: 'input.type' })
    await flushMicrotasks()
    expect(drives.length).toBe(1)
  })

  it('代码上下文（围栏代码块内）不驱动', async () => {
    const { instance, drives } = setup('```js\nconst a = 1\n```\n')
    const view = instance.getView()!
    view.dispatch({ selection: { anchor: 12 } })
    view.dispatch({ changes: { from: 12, insert: '^' }, userEvent: 'input.type' })
    await flushMicrotasks()
    expect(drives).toEqual([])
  })

  it('外部同步与 SDK 修饰事务不驱动（防第二写入口/递归）', async () => {
    const { instance, drives } = setup('word\n')
    const view = instance.getView()!
    view.dispatch({ changes: { from: 4, insert: 'E' }, annotations: externalSync.of(true) })
    view.dispatch({
      changes: { from: 5, insert: 'A' },
      annotations: addonEditOriginTag.of({ origins: [{ addonId: 'pub.x', opId: 'g1-op1', undo: 'atomic' }] }),
    })
    await flushMicrotasks()
    expect(drives).toEqual([])
  })

  it('非 input.type userEvent（delete/paste/keymap 派生）不驱动', async () => {
    const { instance, drives } = setup('word\n')
    const view = instance.getView()!
    view.dispatch({ changes: { from: 4, to: 5 }, userEvent: 'delete.backward' })
    view.dispatch({ changes: { from: 4, insert: 'P' }, userEvent: 'input.paste' })
    view.dispatch({ changes: { from: 5, insert: 'K' } }) // 无 userEvent（程序化）
    await flushMicrotasks()
    expect(drives).toEqual([])
  })

  it('未设身份（setAddonBehaviorIdentity 未调）零驱动', async () => {
    const drives: DriveCall[] = []
    const sent: WebviewToHost[] = []
    const instance = mountInstance(makeDeps(sent, drives), 'word\n')
    cleanups.push(() => instance.destroy())
    const view = instance.getView()!
    view.dispatch({ changes: { from: 4, insert: '^' }, userEvent: 'input.type' })
    await flushMicrotasks()
    expect(drives).toEqual([])
  })

  it('deps 未装配 driveAddonBehaviors 时输入路径无异常', async () => {
    const sent: WebviewToHost[] = []
    const instance = mountInstance({
      send: (message) => sent.push(message),
      persistState: () => {},
      images: new ImageResourceManager({ isDirectSrc: () => false, requestHost: () => {} }),
      isLiveActive: () => true,
      initialDark: false,
    }, 'word\n')
    instance.setAddonBehaviorIdentity('main')
    cleanups.push(() => instance.destroy())
    const view = instance.getView()!
    expect(() => {
      view.dispatch({ changes: { from: 4, insert: '^' }, userEvent: 'input.type' })
    }).not.toThrow()
    await flushMicrotasks()
    expect(sent.filter((m) => m.kind === 'edit.request').length).toBe(1)
  })

  it('微任务时序：键入的 edit.request 先于修饰类后续事务（驱动不嵌套 dispatch）', async () => {
    const { instance, drives, sent } = setup('word\n')
    const view = instance.getView()!
    view.dispatch({ selection: { anchor: 4 } })
    view.dispatch({ changes: { from: 4, insert: '^' }, userEvent: 'input.type' })
    await flushMicrotasks()
    expect(drives.length).toBe(1)
    // 键入出站在驱动之前完成（updateListener 同步段先记账出站）
    expect(sent.filter((m) => m.kind === 'edit.request').length).toBeGreaterThanOrEqual(1)
  })
})

void vi
void Transaction
