// Live 行内 HTML 装饰契约（#568/T03）：行内片段表（Lezer HTMLTag 树派生、
// 单行成型、最外层）、片段替换装饰（未触及 = 精确区间 inline replace
// widget；触及 = 源码显形，selectionTouchesRange 语义；查找命中同列）、
// frontmatter 排除、嵌套最外层唯一、兄弟片段独立显隐、widget 净化内容、
// revealInlineHtmlSourceAtCursor 目标解析。真实指针/绘制验证在 browser
// 与集成层。
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  LIVE_INLINE_HTML_CLASS_NAMES,
  LiveInlineHtmlWidget,
  buildLiveInlineHtmlDecorationRanges,
  liveInlineHtml,
  liveInlineHtmlDecorations,
  liveInlineHtmlSpansField,
  revealInlineHtmlSourceAtCursor,
} from '../../src/webview/liveInlineHtml'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { liveHtml, liveHtmlSpansField } from '../../src/webview/liveHtml'

function buildState(text: string, selection: EditorSelection) {
  return EditorState.create({
    doc: text,
    extensions: [liveDecorationsField, liveHtml, liveInlineHtml],
    selection,
  })
}

function buildDecos(
  text: string,
  selection: EditorSelection | SelectionRange,
): Array<{ from: number; to: number; widget: LiveInlineHtmlWidget }> {
  const sel = selection instanceof EditorSelection
    ? selection
    : EditorSelection.create([selection], 0)
  const state = buildState(text, sel)
  const decos = state.field(liveInlineHtmlDecorations)
  const out: Array<{ from: number; to: number; widget: LiveInlineHtmlWidget }> = []
  decos.between(0, text.length, (from, to, value) => {
    const spec = value.spec as { widget?: LiveInlineHtmlWidget }
    if (spec.widget) {
      out.push({ from, to, widget: spec.widget })
    }
  })
  return out.sort((a, b) => a.from - b.from)
}

const SPAN = '<span style="color:red">红字</span>'
const DOC = [
  '---',
  'title: 头区 <span style="color:gray">不渲染</span>',
  '---',
  '开篇 <u>下划线</u> 段落。',
  '',
  '正文：' + SPAN + ' 与 <span style="color:blue">蓝字</span> 兄弟，嵌套 <span style="color:red">a<b>bi</b>c</span> 片段，未闭合 <span style="color:red">尾巴',
  '',
  '`<span style="color:red">行内代码</span>` 字面。',
  '',
  '> 引用 <span style="color:red">q</span> 尾',
].join('\n')

const RED_FROM = DOC.indexOf(SPAN)
const RED_TO = RED_FROM + SPAN.length
const BLUE_FROM = DOC.indexOf('<span style="color:blue">')
const NESTED_FROM = DOC.indexOf('<span style="color:red">a<b>bi</b>c</span>')
const NESTED_TO = NESTED_FROM + '<span style="color:red">a<b>bi</b>c</span>'.length

describe('Live 行内片段表（Lezer HTMLTag 派生）', () => {
  it('成对片段进入表（from/to 为源文精确区间，含完整开闭标签）', () => {
    const spans = buildState(DOC, EditorSelection.single(0)).field(liveInlineHtmlSpansField)
    const red = spans.find((s) => s.from === RED_FROM)
    expect(red).toBeDefined()
    expect(red!.to).toBe(RED_TO)
    expect(red!.source).toBe(SPAN)
  })

  it('未闭合/孤立闭/跨行/行内代码不进表；frontmatter 区域在表但发射层排除（树解析形态）', () => {
    const spans = buildState(DOC, EditorSelection.single(0)).field(liveInlineHtmlSpansField)
    // 未闭合尾巴
    expect(spans.some((s) => s.source.startsWith('<span style="color:red">尾巴'))).toBe(false)
    // 行内代码字面
    expect(spans.some((s) => s.source.includes('行内代码'))).toBe(false)
    // frontmatter 内的 span 是否在表取决于树形态（frontmatter 不产 HTMLTag
    // ——头区按源文呈现）；无论哪种，发射层必须排除（下一条钉）
  })

  it('frontmatter 内不发射装饰（头区不产正文装饰）', () => {
    const text = '---\ntitle: 头区 <span style="color:red">x</span>\n---\n\n正文 <u>u</u>\n'
    // 头区内的 span 位于 frontmatterRange 内——发射层排除
    const fmEnd = text.indexOf('---', 4) + 3
    const items = buildDecos(text, EditorSelection.single(0))
    for (const item of items) {
      expect(item.from >= fmEnd).toBe(true)
    }
    expect(items).toHaveLength(1) // 只有正文 <u>
  })

  it('块级 HTML 区间内无行内片段（块表与行内表不重叠）', () => {
    const text = '段落 <u>x</u>\n\n<div>\n  块内 <span style="color:red">y</span>\n</div>\n'
    const state = buildState(text, EditorSelection.single(0))
    const blocks = state.field(liveHtmlSpansField)
    const inlines = state.field(liveInlineHtmlSpansField)
    expect(blocks).toHaveLength(1)
    for (const f of inlines) {
      const b = blocks[0]!
      expect(f.from < b.to && f.to > b.from).toBe(false)
    }
  })
})

describe('Live 行内片段替换装饰：显隐切换（selectionTouchesRange 语义）', () => {
  it('光标在片段外 → inline replace widget 覆盖精确区间', () => {
    const items = buildDecos(DOC, EditorSelection.single(0))
    const red = items.find((i) => i.from === RED_FROM)
    expect(red).toBeDefined()
    expect(red!.to).toBe(RED_TO)
    expect(red!.widget).toBeInstanceOf(LiveInlineHtmlWidget)
  })

  it('折叠光标进入区间（含两端边界）→ 撤下 widget 源码显形', () => {
    for (const pos of [RED_FROM, RED_FROM + 3, RED_TO]) {
      const items = buildDecos(DOC, EditorSelection.single(pos))
      expect(items.some((i) => i.from === RED_FROM)).toBe(false)
    }
  })

  it('非空选区与区间相交 → 显形（不要求包含）', () => {
    const sel = EditorSelection.range(RED_FROM - 3, RED_FROM + 4)
    expect(buildDecos(DOC, sel).some((i) => i.from === RED_FROM)).toBe(false)
  })

  it('光标完全离开 → 恢复渲染；兄弟片段独立显隐', () => {
    // 光标进入红片段：红撤下、蓝保留
    const insideRed = buildDecos(DOC, EditorSelection.single(RED_FROM + 5))
    expect(insideRed.some((i) => i.from === RED_FROM)).toBe(false)
    expect(insideRed.some((i) => i.from === BLUE_FROM)).toBe(true)
    // 光标离开全部：都恢复
    const outside = buildDecos(DOC, EditorSelection.single(2))
    expect(outside.some((i) => i.from === RED_FROM)).toBe(true)
    expect(outside.some((i) => i.from === BLUE_FROM)).toBe(true)
  })

  it('嵌套片段只发射最外层（确定性区间——内层不独立成装饰）', () => {
    const items = buildDecos(DOC, EditorSelection.single(0))
    const nested = items.find((i) => i.from === NESTED_FROM)
    expect(nested).toBeDefined()
    expect(nested!.to).toBe(NESTED_TO)
    // 内层 <b>…</b> 不独立发射
    const innerB = DOC.indexOf('<b>bi</b>', NESTED_FROM)
    expect(items.some((i) => i.from === innerB)).toBe(false)
  })

  it('多选区任一 range 命中显形（其他 range 不坍缩）', () => {
    const state = EditorState.create({
      doc: DOC,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        liveDecorationsField,
        liveHtml,
        liveInlineHtml,
      ],
      selection: EditorSelection.create([
        EditorSelection.range(0, 0),
        EditorSelection.range(RED_FROM + 2, RED_FROM + 2),
      ], 1),
    })
    const decos = state.field(liveInlineHtmlDecorations)
    let redPresent = false
    decos.between(0, DOC.length, (from) => {
      if (from === RED_FROM) redPresent = true
    })
    expect(redPresent).toBe(false)
    // 选区本身两 range 保持
    expect(state.selection.ranges).toHaveLength(2)
  })

  it('查找/锚点命中（hitIntersectsRange）驱动显形：命中片段撤下、未命中保留', () => {
    const spans = buildState(DOC, EditorSelection.single(0)).field(liveInlineHtmlSpansField)
    const withHits = buildLiveInlineHtmlDecorationRanges(
      EditorSelection.single(0), spans, null, null,
      [{ from: RED_FROM + 2, to: RED_FROM + 6 }],
    )
    expect(withHits.some((r) => r.from === RED_FROM)).toBe(false)
    expect(withHits.some((r) => r.from === BLUE_FROM)).toBe(true)
    // 零宽命中按点闭端触界（命中起点落在片段边界也算）
    const edgeHits = buildLiveInlineHtmlDecorationRanges(
      EditorSelection.single(0), spans, null, null,
      [{ from: RED_TO, to: RED_TO }],
    )
    expect(edgeHits.some((r) => r.from === RED_FROM)).toBe(false)
  })

  it('widget eq 语义（source/from/to/docScope 同键复用）', () => {
    const a = new LiveInlineHtmlWidget('<u>x</u>', 10, 18, 'doc')
    const b = new LiveInlineHtmlWidget('<u>x</u>', 10, 18, 'doc')
    const c = new LiveInlineHtmlWidget('<u>x</u>', 10, 18, null)
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })

  it('widget toDOM：宿主类名、净化内容（行内颜色元素）、源码区间 dataset、docScope', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(0)), parent: document.body })
    try {
      // 按 dataset 定位红片段宿主（行内可有多个片段——不假设 DOM 首个）
      const hosts = Array.from(view.dom.querySelectorAll<HTMLElement>(`.${LIVE_INLINE_HTML_CLASS_NAMES.host}`))
      const host = hosts.find((h) => h.dataset['vsidianHtmlFrom'] === String(RED_FROM)) ?? null
      expect(host).not.toBeNull()
      expect(host!.dataset['vsidianHtmlTo']).toBe(String(RED_TO))
      const colored = host!.querySelector<HTMLElement>('span[style*="color:red"]')
      expect(colored).not.toBeNull()
      expect(colored!.textContent).toBe('红字')
      // docScope 消费 T02 通道（facet 注入缺省 null——主文由视图装配层挂 'doc'）
      const bare = new LiveInlineHtmlWidget(SPAN, 0, SPAN.length, null)
      const bareContent = bare.toDOM().querySelector(`.${LIVE_INLINE_HTML_CLASS_NAMES.content}`) as HTMLElement
      expect(bareContent.dataset['vsidianDocScope']).toBeUndefined()
      const scoped = new LiveInlineHtmlWidget(SPAN, 0, SPAN.length, 'doc')
      const scopedContent = scoped.toDOM().querySelector(`.${LIVE_INLINE_HTML_CLASS_NAMES.content}`) as HTMLElement
      expect(scopedContent.dataset['vsidianDocScope']).toBe('doc')
    } finally {
      view.destroy()
    }
  })

  it('widget 不吞事件（ignoreEvent=false——点击进入源码的规格前提）', () => {
    const w = new LiveInlineHtmlWidget('<u>x</u>', 0, 8, 'doc')
    expect(w.ignoreEvent()).toBe(false)
  })

  it('危险内容在 widget DOM 中被净化（负向：script/事件/伪造锚点不进场）', () => {
    const evil = '<span onclick="evil()" style="color:red" data-vsidian-src-start="1">x</span><script>bad()</script>'
    const w = new LiveInlineHtmlWidget(evil, 0, evil.length, 'doc')
    const dom = w.toDOM()
    expect(dom.querySelector('script')).toBeNull()
    expect(dom.querySelector('[onclick]')).toBeNull()
    expect(dom.querySelector('[data-vsidian-src-start]')).toBeNull()
    expect(dom.textContent).toContain('x')
  })

  it('#571（T06）widget destroy：行内媒体立即释放（显形撤下后无持续播放）', () => {
    const src = '<audio src="https://cdn/t.mp3" controls></audio>'
    const w = new LiveInlineHtmlWidget(src, 0, src.length, 'doc')
    const dom = w.toDOM()
    const audio = dom.querySelector('audio')!
    const pause = vi.spyOn(audio, 'pause')
    const load = vi.spyOn(audio, 'load')
    w.destroy(dom)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(audio.getAttribute('src')).toBe(null)
  })
})

describe('revealInlineHtmlSourceAtCursor：编辑当前 HTML 源码（行内目标）', () => {
  it('光标在行内片段内 → 选中该片段完整源码区间', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(RED_FROM + 4)), parent: document.body })
    try {
      expect(revealInlineHtmlSourceAtCursor(view)).toBe(true)
      expect(view.state.selection.main.anchor).toBe(RED_FROM)
      expect(view.state.selection.main.head).toBe(RED_TO)
    } finally {
      view.destroy()
    }
  })

  it('光标在片段端点（含边界）也命中', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(RED_TO)), parent: document.body })
    try {
      expect(revealInlineHtmlSourceAtCursor(view)).toBe(true)
      expect(view.state.selection.main.from).toBe(RED_FROM)
      expect(view.state.selection.main.to).toBe(RED_TO)
    } finally {
      view.destroy()
    }
  })

  it('光标不在任何行内片段 → 静默不动作', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(2)), parent: document.body })
    try {
      expect(revealInlineHtmlSourceAtCursor(view)).toBe(false)
      expect(view.state.selection.main.head).toBe(2)
    } finally {
      view.destroy()
    }
  })
})
