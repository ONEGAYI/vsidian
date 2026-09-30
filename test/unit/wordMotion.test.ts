// @vitest-environment jsdom
// #239 词级移动命令回归矩阵（真实 CM6 EditorView，jsdom）：
// - 拉丁/数字/空白/ASCII 标点：与 cursorGroupLeft/Right（及 select 变体）
//   逐字节一致——回归断言钉住「拉丁行为不变」（票面验收标准）；
// - 中文段：注入确定性 mock 边界（__setJiebaBoundariesForTest，同时覆盖
//   jieba 注入路径）逐词移动、Shift 逐词扩选；与原生命令对照证明细化
//   生效（原生对连续中文整段跳过）；
// - 多 range：中文 range 细化 + 拉丁 range 原生目标共存于单事务；
// - 引擎配置切换：configureWordSegment 的回退语义（builtin 恒生效）。
// 真实键盘链路（router 本地分支 → 命令）由 browser 测试钉住
//（test/browser/wordMotion.mjs）。
import { afterAll, describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cursorGroupLeft, cursorGroupRight, selectGroupLeft, selectGroupRight } from '@codemirror/commands'
import {
  __setJiebaBoundariesForTest,
  activeWordSegmentEngine,
  configureWordSegment,
  cursorWordLeft,
  cursorWordRight,
  selectWordLeft,
  selectWordRight,
} from '../../src/webview/wordMotion'
import { boundariesFromTokens } from '../../src/shared/wordSegment'

// jsdom 缺 Range 几何（CM6 测量阶段调用；formatInteraction.test 同款垫片）
if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function makeView(doc: string, selection?: { anchor: number; head?: number }): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [EditorView.editable.of(true)],
    selection: selection ? EditorSelection.single(selection.anchor, selection.head ?? selection.anchor) : undefined,
  })
  return new EditorView({ state, parent: document.body })
}

/** 两个命令在同一文档/选区上分别执行，比较选区（含 assoc/goalColumn 的
 *  结构等价——eq(other, true)） */
function sameOutcome(doc: string, anchor: number, head: number | undefined,
  ours: (view: EditorView) => boolean, native: (view: EditorView) => boolean): boolean {
  const a = makeView(doc, { anchor, head })
  const b = makeView(doc, { anchor, head })
  ours(a)
  native(b)
  return a.state.selection.eq(b.state.selection, true)
}

/** mock 词表 → 边界函数（确定性 jieba 形态） */
const words = (tokens: readonly string[]) => (text: string) =>
  boundariesFromTokens(text, tokens) ?? [0, text.length]

// 全文件默认引擎回 builtin（隔离其他测试的注入残留），中文用例内注入
configureWordSegment({ engine: 'builtin', resources: null })

describe('拉丁/数字路径逐字节一致（回归断言钉住）', () => {
  const latinCases: Array<[string, number]> = [
    ['hello world', 0], ['hello world', 5], ['hello world', 11],
    ['foo_bar baz42', 3], ['foo_bar baz42', 7], ['foo_bar baz42', 13],
    ['  lead spaces', 0], ['trail.  ', 6], ['a.b,c;d', 1], ['a.b,c;d', 4],
    ['snake_case_word', 5], ['123 456', 3], ['MiXeD CaSe', 4],
    ['end.', 4], ['^caret', 0], ['tab\tsep', 3],
  ]
  it.each(latinCases)('右移一致：%s @%d', (doc, pos) => {
    expect(sameOutcome(doc, pos, undefined, cursorWordRight, cursorGroupRight)).toBe(true)
  })
  it.each(latinCases)('左移一致：%s @%d', (doc, pos) => {
    expect(sameOutcome(doc, pos, undefined, cursorWordLeft, cursorGroupLeft)).toBe(true)
  })
  it.each(latinCases)('Shift 右扩选一致：%s @%d', (doc, pos) => {
    expect(sameOutcome(doc, pos, undefined, selectWordRight, selectGroupRight)).toBe(true)
  })
  it.each(latinCases)('Shift 左扩选一致：%s @%d', (doc, pos) => {
    expect(sameOutcome(doc, pos, undefined, selectWordLeft, selectGroupLeft)).toBe(true)
  })
  it('非空选区前沿跳转一致（cursorByGroup 的 rangeEnd 语义）', () => {
    for (const [doc, from, to] of [
      ['hello world', 2, 7], ['中文 test', 0, 6], ['a 中文 b', 2, 4],
    ] as const) {
      expect(sameOutcome(doc, from, to, cursorWordRight, cursorGroupRight)).toBe(true)
      expect(sameOutcome(doc, from, to, cursorWordLeft, cursorGroupLeft)).toBe(true)
    }
  })
})

describe('中文段逐词移动（注入 mock 边界 = jieba 注入路径）', () => {
  const doc = '中文测试文档'
  afterAll(() => {
    __setJiebaBoundariesForTest(null)
    configureWordSegment({ engine: 'builtin', resources: null })
  })

  it('注入后生效引擎为 jieba', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试', '文档']))
    configureWordSegment({ engine: 'jieba', resources: null })
    expect(activeWordSegmentEngine()).toBe('jieba')
  })

  it('右移逐词 0→2→4→6（原生整段跳 0→6，细化生效）', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试', '文档']))
    configureWordSegment({ engine: 'jieba', resources: null })
    const native = makeView(doc, { anchor: 0 })
    cursorGroupRight(native)
    expect(native.state.selection.main.head).toBe(6)
    const view = makeView(doc, { anchor: 0 })
    for (const expected of [2, 4, 6]) {
      cursorWordRight(view)
      expect(view.state.selection.main.head).toBe(expected)
    }
  })

  it('左移逐词 6→4→2→0', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试', '文档']))
    configureWordSegment({ engine: 'jieba', resources: null })
    const view = makeView(doc, { anchor: 6 })
    for (const expected of [4, 2, 0]) {
      cursorWordLeft(view)
      expect(view.state.selection.main.head).toBe(expected)
    }
  })

  it('Shift 变体逐词扩选（anchor 保持、head 逐词推进）', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试', '文档']))
    configureWordSegment({ engine: 'jieba', resources: null })
    const view = makeView(doc, { anchor: 0 })
    selectWordRight(view)
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(2)
    selectWordRight(view)
    expect(view.state.selection.main.to).toBe(4)
    selectWordLeft(view)
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(2)
  })

  it('中英混排：中文段细化、域外起点与原生逐字节一致', () => {
    __setJiebaBoundariesForTest(words(['中文', '更多']))
    configureWordSegment({ engine: 'jieba', resources: null })
    const mixed = 'abc中文def更多'
    const view = makeView(mixed, { anchor: 3 })
    cursorWordRight(view)
    expect(view.state.selection.main.head).toBe(5) // '中文' 段尾（词收录整段）
    // head=5 右侧是拉丁（域外）→ 委托原生：CM6 把 'def更多' 视为同一
    // Word 类整块跳过（中英混排的原生行为，改动前后一致——拉丁行为
    // 不变即钉住此点），用原生对照断言而非硬编码
    const nativeProbe = makeView(mixed, { anchor: 5 })
    cursorGroupRight(nativeProbe)
    cursorWordRight(view)
    expect(view.state.selection.main.head).toBe(nativeProbe.state.selection.main.head)
  })

  it('多 range：中文 range 细化与拉丁 range 原生目标同事务并存', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试']))
    configureWordSegment({ engine: 'jieba', resources: null })
    const mixed = '中文 and 测试'
    // CM6 契约：多 range 需显式启用 allowMultipleSelections（缺省
    // EditorState.create 直接 asSingle 折叠——生产 syncController 未启用
    // 多选，多 range 仅本用例验证命令的逐 range 语义）
    const state = EditorState.create({
      doc: mixed,
      extensions: [EditorView.editable.of(true), EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(3),
      ]),
    })
    const view = new EditorView({ state, parent: document.body })
    cursorWordRight(view)
    const ranges = view.state.selection.ranges
    expect(ranges).toHaveLength(2)
    expect(ranges[0]!.head).toBe(2) // 中文段首词（['中文'] 词典形态）
    // 拉丁 range 的目标与原生命令在同起点的结果一致（Word 组语义）
    const nativeProbe = makeView(mixed, { anchor: 3 })
    cursorGroupRight(nativeProbe)
    expect(ranges[1]!.head).toBe(nativeProbe.state.selection.main.head)
  })

  it('引擎切回 builtin 即时生效（注入边界不再被使用）', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试', '文档']))
    configureWordSegment({ engine: 'jieba', resources: null })
    expect(activeWordSegmentEngine()).toBe('jieba')
    configureWordSegment({ engine: 'builtin', resources: null })
    expect(activeWordSegmentEngine()).toBe('builtin')
    const view = makeView(doc, { anchor: 0 })
    cursorWordRight(view)
    // Intl 真实引擎的目标必为段内边界（具体切分随 ICU 版本，不进契约）
    const head = view.state.selection.main.head
    expect(head).toBeGreaterThan(0)
    expect(head).toBeLessThanOrEqual(6)
  })

  it('命令契约：jsdom（无组合态）下正常返回 boolean', () => {
    __setJiebaBoundariesForTest(words(['中文', '测试', '文档']))
    configureWordSegment({ engine: 'jieba', resources: null })
    const view = makeView(doc, { anchor: 0 })
    expect(typeof cursorWordRight(view)).toBe('boolean')
  })
})
