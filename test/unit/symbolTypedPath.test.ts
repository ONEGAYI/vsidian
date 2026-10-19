// @vitest-environment jsdom
// #597 方案 3 键入路径核心语义（原始输入 → 行为链 → 内置兜底）：
//
// - 键入符号字符经 transactionFilter **放行原始单字符事务**（不再原子
//   改写），链驱动（maybeDriveAddonBehaviors）以原始形态驱动恰一次
//   （inputText='('，现状为展开形态 '()'）；同一事件循环微任务时点的
//   内置兜底 attempt 补闭合/按段重建，终态与现行改写一致；
// - 装配序（ADR-0020 裁决一）：主簿记 listener（数组后段，链驱动入队点）
//   先于符号组 listener 执行 → 链驱动微任务（M1）先于内置兜底（M3）——
//   行为收到的快照不含内置兜底产物；不得从 filter 入队（会抢在链前）；
// - 同步行为改写区间时内置兜底形态校验让位（组件产出为终态、零重复）；
// - 出站强制暂缓：原始符号事务进暂缓段、兜底并入同段 → flush 单笔
//   edit.request（'()'），宿主撤销一次整体恢复（探针基线用例形态）；
// - 多 range 键入包裹由内置兜底按段重建，终态与选区覆盖文本和现行
//   filter 改写逐字一致（数学原型见 plan3Probe.test.ts 第 5 例）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { addonEditOriginTag } from '../../src/webview/liveInstance'
import { planSelectionWrap } from '../../src/shared/symbolWrap'
import { findSelectionWrapEntry } from '../../src/shared/symbols'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/u.md'

interface DriveCall {
  instanceId: string
  userEvent: string
  inputText: string
  replaced: { from: number; to: number; text: string } | null
}

type DriveHook = (input: DriveCall, view: NonNullable<ReturnType<WebviewSyncController['getView']>>) => void

function setup(text: string, onDrive?: DriveHook) {
  const sent: WebviewToHost[] = []
  const drives: DriveCall[] = []
  /** 每次 M1 链驱动时点读到的文档（钉 M1→M3 微任务序：不含兜底产物） */
  const docAtDrive: string[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => {},
  }
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'))
  controller.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  if (onDrive) {
    controller.attachAddonBehaviorDrive((input) => {
      drives.push(input as DriveCall)
      docAtDrive.push(controller.getView()!.state.doc.toString())
      onDrive(input as DriveCall, controller.getView()!)
    })
  } else {
    controller.attachAddonBehaviorDrive((input) => {
      drives.push(input as DriveCall)
      docAtDrive.push(controller.getView()!.state.doc.toString())
    })
  }
  return { controller, sent, drives, docAtDrive, view: controller.getView()! }
}

/** 微任务推平：链驱动（M1）→ 其内同步修饰 → 内置兜底（M3）全部落地 */
async function settleMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function useSegmentClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

afterEach(() => {
  vi.useRealTimers()
})

type EditReq = Extract<WebviewToHost, { kind: 'edit.request' }>
const editRequests = (sent: WebviewToHost[]) =>
  sent.filter((m): m is EditReq => m.kind === 'edit.request')

function applySer(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

/** 一次 Ctrl+Z 后的权威文本（栈顶 = 最后一条 edit.request） */
function undoOnceOver(reqs: EditReq[], base: string): string {
  const states = [base]
  for (const r of reqs) {
    states.push(applySer(states[states.length - 1], r.changes))
  }
  return states[states.length - 2]
}

describe('#597 键入路径：原始输入 → 链驱动 → 内置兜底', () => {
  it('真实键入 ( ：驱动恰一次且 inputText 为原始单字符；行为快照不含兜底产物（M1→M3）', async () => {
    const { drives, docAtDrive, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 4 } })
    // 真实键入事务总带显式选区（CM6 domObserver 从 DOM 读回光标——插入
    // 后落在插入文本之后），模拟形态与其对齐
    view.dispatch({ changes: { from: 4, insert: '(' }, selection: { anchor: 5 }, userEvent: 'input.type' })
    await settleMicrotasks()
    expect(drives).toEqual([
      { instanceId: 'main', userEvent: 'input.type', inputText: '(', replaced: null },
    ])
    // 链驱动时点文档为原始形态（无闭合）——兜底不得抢在链前落地
    expect(docAtDrive).toEqual(['word(\n'])
    // 兜底微任务落地后终态与现行改写一致：() 且光标居中
    expect(view.state.doc.toString()).toBe('word()\n')
    expect(view.state.selection.main.head).toBe(5)
  })

  it('出站强制暂缓：原始 ( 与兜底 ) 合并单笔 edit.request，一次 Ctrl+Z 整体恢复', async () => {
    const { sent, view } = setup('中')
    useSegmentClock()
    view.dispatch({ selection: { anchor: 1 } })
    view.dispatch({ changes: { from: 1, insert: '(' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    await vi.advanceTimersByTimeAsync(20)
    expect(view.state.doc.toString()).toBe('中()')
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.changes).toEqual([{ offset: 1, length: 0, text: '()' }])
    expect(undoOnceOver(reqs, '中')).toBe('中')
  })

  it('兜底落地后闭合越过照常：键入 ) 零写回、光标跳过闭合符号', async () => {
    const { sent, view } = setup('')
    view.dispatch({ changes: { from: 0, insert: '(' }, selection: { anchor: 1 }, userEvent: 'input.type' })
    await settleMicrotasks()
    expect(view.state.doc.toString()).toBe('()')
    const before = editRequests(sent).length
    view.dispatch({ changes: { from: 1, insert: ')' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    expect(view.state.doc.toString()).toBe('()')
    expect(view.state.selection.main.head).toBe(2)
    expect(editRequests(sent)).toHaveLength(before)
  })

  it('同步行为改写区间时内置兜底让位：组件产出为终态、零重复内容', async () => {
    const { view } = setup('中\n', (input, v) => {
      // 模拟同步行为（如全角转换）：M1 微任务时点同步 dispatch 修饰事务
      if (input.inputText === '(') {
        v.dispatch({
          changes: { from: 1, to: 2, insert: '（' },
          annotations: addonEditOriginTag.of({
            origins: [{ addonId: 'pub.demo', opId: 'op-1', undo: 'atomic' }],
          }),
        })
      }
    })
    view.dispatch({ selection: { anchor: 1 } })
    view.dispatch({ changes: { from: 1, insert: '(' }, userEvent: 'input.type' })
    await settleMicrotasks()
    // 追加式校验失败（光标左侧已被链改为全角（）：内置不再补 ）
    expect(view.state.doc.toString()).toBe('中（\n')
  })

  it('表格空白行首笔补全照常：blankRow 规范化链上兜底载体不丢（评审 002）', async () => {
    const text = 'a|b|c\n---|---|---\n | | \n'
    const { view } = setup(text)
    view.dispatch({ selection: { anchor: 23 } })
    view.dispatch({ changes: { from: 23, insert: '(' }, selection: { anchor: 24 }, userEvent: 'input.type' })
    await settleMicrotasks()
    // 期望与 #597 前（原子改写经 blankRow 规范化）逐字一致：
    // 红形态 | | | (|（normalizeBlankRowInput 重建事务丢 effect 载体，兜底不发生）
    expect(view.state.doc.toString()).toBe('a|b|c\n---|---|---\n| | | ()|\n')
  })

  it('同步行为产出保留同开符号与光标时补全兜底让位：不重复补闭合（评审 001）', async () => {
    const { view } = setup('中\n', (input, v) => {
      // 同步行为产出保留开符号与光标位置（如智能括号组件补上闭合）：
      // 追加式校验的「光标紧邻 open 后 + 左邻字符」两项都仍满足，仅凭
      // 它们无法分辨组件改写——长度基准（原始事务后文档长度）被组件
      // 净改写破坏才让位
      if (input.inputText === '(') {
        v.dispatch({
          changes: { from: 2, insert: ')' },
          annotations: addonEditOriginTag.of({
            origins: [{ addonId: 'pub.demo', opId: 'op-3', undo: 'atomic' }],
          }),
        })
      }
    })
    view.dispatch({ selection: { anchor: 1 } })
    view.dispatch({ changes: { from: 1, insert: '(' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    await settleMicrotasks()
    // 组件产出 () 为终态：内置不得再补 )（红：当前实得中())）
    expect(view.state.doc.toString()).toBe('中()\n')
  })

  it('同步 SelectKey 行为包裹选区时内置兜底让位：终态为组件产出（原文选中）', async () => {
    const { view } = setup('word\n', (input, v) => {
      if (input.inputText === '【' && input.replaced?.text === 'ord') {
        v.dispatch({
          changes: { from: 1, to: 2, insert: '【ord】' },
          selection: EditorSelection.range(2, 5),
          annotations: addonEditOriginTag.of({
            origins: [{ addonId: 'pub.demo', opId: 'op-2', undo: 'atomic' }],
          }),
        })
      }
    })
    view.dispatch({ selection: { anchor: 1, head: 4 } })
    view.dispatch({
      changes: { from: 1, to: 4, insert: '【' },
      selection: { anchor: 2 },
      userEvent: 'input.type',
    })
    await settleMicrotasks()
    expect(view.state.doc.toString()).toBe('w【ord】\n')
    const sel = view.state.selection
    expect(sel.ranges).toHaveLength(1)
    expect(view.state.doc.sliceString(sel.main.anchor, sel.main.head)).toBe('ord')
  })

  it('同步行为等长改写时补全兜底让位：净长度为零不等于未修改（评审 001 续）', async () => {
    const { view } = setup('中 \n', (input, v) => {
      // 组件把 ( 后的空格等长替换为闭符）：docLength 基准不破坏——
      // 「净长度为零」不等于「未修改」，组件修饰纪元（addonEditEpoch）
      // 是唯一可辨证据
      if (input.inputText === '(') {
        v.dispatch({
          changes: { from: 2, to: 3, insert: ')' },
          annotations: addonEditOriginTag.of({
            origins: [{ addonId: 'pub.demo', opId: 'op-5', undo: 'atomic' }],
          }),
        })
      }
    })
    view.dispatch({ selection: { anchor: 1 } })
    view.dispatch({ changes: { from: 1, insert: '(' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    await settleMicrotasks()
    // 组件产出中() 为终态：内置不得再补 )（红：当前实得中())）
    expect(view.state.doc.toString()).toBe('中()\n')
  })

  it('同步行为产出同前缀重建时包裹兜底让位：不回退组件已取代的原文（评审 001）', async () => {
    const { view } = setup('word\n', (input, v) => {
      // 同步行为以「同前缀改写」重建（区间首字符仍是 【、光标仍在 2）：
      // 占据校验与选区校验都仍满足——长度基准被净改写破坏才让位
      if (input.inputText === '【' && input.replaced?.text === 'ord') {
        v.dispatch({
          changes: { from: 1, to: 2, insert: '【word】' },
          selection: EditorSelection.cursor(2),
          annotations: addonEditOriginTag.of({
            origins: [{ addonId: 'pub.demo', opId: 'op-4', undo: 'atomic' }],
          }),
        })
      }
    })
    view.dispatch({ selection: { anchor: 1, head: 4 } })
    view.dispatch({ changes: { from: 1, to: 4, insert: '【' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    await settleMicrotasks()
    // 组件产出 【word】 为终态：内置不得以快照旧原文 ord 回退重建
    expect(view.state.doc.toString()).toBe('w【word】\n')
  })
})

describe('#597 键入路径：选区包裹（单/多 range）', () => {
  it('单 range 键入 【 ：驱动 replaced 携带原文，微任务兜底重建 w【ord】且原文选中', async () => {
    const { drives, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 1, head: 4 } })
    view.dispatch({
      changes: { from: 1, to: 4, insert: '【' },
      selection: { anchor: 2 },
      userEvent: 'input.type',
    })
    await settleMicrotasks()
    expect(drives).toEqual([
      {
        instanceId: 'main', userEvent: 'input.type', inputText: '【',
        replaced: { from: 1, to: 4, text: 'ord' },
      },
    ])
    expect(view.state.doc.toString()).toBe('w【ord】\n')
    const sel = view.state.selection
    expect(sel.ranges).toHaveLength(1)
    expect(view.state.doc.sliceString(sel.main.anchor, sel.main.head)).toBe('ord')
  })

  it('多 range 键入包裹：终态与选区覆盖文本 = 现行 filter 改写（逐字一致，端到端）', async () => {
    const text = 'x ord y zwei z'
    const ranges = [
      { from: 2, to: 5 },
      { from: 8, to: 12 },
    ]
    const entry = findSelectionWrapEntry('【')!
    expect(entry).not.toBeNull()
    // 对照基准：现行 filter 改写（planSelectionWrap 在原文档上直算）
    const plan = planSelectionWrap(text, ranges, entry)!
    expect(plan).not.toBeNull()
    const terminal = applySer(
      text,
      plan.changes.map((c) => ({ offset: c.from, length: c.to - c.from, text: c.insert })),
    )
    const covered = plan.selection.map((s) => terminal.slice(s.anchor, s.head))
    expect(covered).toEqual(['ord', 'zwei'])

    const { view } = setup(text)
    view.dispatch({
      selection: EditorSelection.create(
        ranges.map((r) => EditorSelection.range(r.from, r.to)),
        0,
      ),
    })
    // applyDefaultInsert 的多 range 键入形态：每 range 一条单字符替换、
    // 光标各落在插入字符后（第二段平移 = 首段净长差 1-3 = -2）
    view.dispatch({
      changes: [
        { from: 2, to: 5, insert: '【' },
        { from: 8, to: 12, insert: '【' },
      ],
      selection: EditorSelection.create(
        [EditorSelection.cursor(3), EditorSelection.cursor(7)],
        0,
      ),
      userEvent: 'input.type',
    })
    await settleMicrotasks()
    expect(view.state.doc.toString()).toBe(terminal)
    const sel = view.state.selection
    expect(sel.ranges.map((r) => view.state.doc.sliceString(r.anchor, r.head))).toEqual(covered)
  })

  it('多 range 混合纯空白段：空白段换回原文、选区只含非空段（与现行改写逐字一致）', async () => {
    const text = 'x ord y  z'
    const ranges = [
      { from: 2, to: 5 },
      { from: 7, to: 9 },
    ]
    const entry = findSelectionWrapEntry('【')!
    // 对照基准：现行 filter 改写跳过纯空白块——changes 与 selection 均
    // 不含空白段（该段选区消失是旧形态既有行为，不得顺手改）
    const plan = planSelectionWrap(text, ranges, entry)!
    expect(plan.selection).toHaveLength(1)
    const terminal = applySer(
      text,
      plan.changes.map((c) => ({ offset: c.from, length: c.to - c.from, text: c.insert })),
    )
    const covered = plan.selection.map((s) => terminal.slice(s.anchor, s.head))
    expect(covered).toEqual(['ord'])

    const { view } = setup(text)
    view.dispatch({
      selection: EditorSelection.create(
        ranges.map((r) => EditorSelection.range(r.from, r.to)),
        0,
      ),
    })
    // 多 range 键入形态：每 range 一条单字符替换，第二段平移 = 首段净长差 -2
    view.dispatch({
      changes: [
        { from: 2, to: 5, insert: '【' },
        { from: 7, to: 9, insert: '【' },
      ],
      selection: EditorSelection.create(
        [EditorSelection.cursor(3), EditorSelection.cursor(6)],
        0,
      ),
      userEvent: 'input.type',
    })
    await settleMicrotasks()
    expect(view.state.doc.toString()).toBe(terminal)
    const sel = view.state.selection
    expect(sel.ranges.map((r) => view.state.doc.sliceString(r.anchor, r.head))).toEqual(covered)
  })

  it('多 range 键入包裹出站单笔合并：open/原文/close 同段一笔 edit.request', async () => {
    const { sent, view } = setup('x ord y zwei z')
    useSegmentClock()
    view.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(2, 5), EditorSelection.range(8, 12)],
        0,
      ),
    })
    view.dispatch({
      changes: [
        { from: 2, to: 5, insert: '【' },
        { from: 8, to: 12, insert: '【' },
      ],
      selection: EditorSelection.create(
        [EditorSelection.cursor(3), EditorSelection.cursor(7)],
        0,
      ),
      userEvent: 'input.type',
    })
    await vi.advanceTimersByTimeAsync(20)
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    // 单笔净变更 = 原始替换（原文→键入字符）与兜底重建（键入字符→
    // open+原文+close）的 ChangeSet 复合——SerChange 呈现为「替换」形态
    // （删原文插重建串），与现行 filter 改写的「纯插入」形态不同但文档
    // 应用结果逐字等价（SerChange 是替换语义序列）；撤销一次回到原文
    const entry = findSelectionWrapEntry('【')!
    const plan = planSelectionWrap('x ord y zwei z', [
      { from: 2, to: 5 },
      { from: 8, to: 12 },
    ], entry)!
    const expectedTerminal = applySer(
      'x ord y zwei z',
      plan.changes.map((c) => ({ offset: c.from, length: c.to - c.from, text: c.insert })),
    )
    expect(applySer('x ord y zwei z', reqs[0]!.changes)).toBe(expectedTerminal)
    expect(undoOnceOver(reqs, 'x ord y zwei z')).toBe('x ord y zwei z')
  })

  it('纯空白选区不接管：键入 【 保持普通替换语义（无兜底重建）', async () => {
    const { view } = setup('a   b\n')
    view.dispatch({ selection: { anchor: 1, head: 4 } })
    view.dispatch({
      changes: { from: 1, to: 4, insert: '【' },
      selection: { anchor: 2 },
      userEvent: 'input.type',
    })
    await settleMicrotasks()
    expect(view.state.doc.toString()).toBe('a【b\n')
    expect(view.state.selection.main.head).toBe(2)
  })
})
