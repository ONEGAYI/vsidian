// Live 块级 HTML 装饰契约（#567/T02）：html 块表（Lezer HTMLBlock 派生、
// 容器/代码/frontmatter 排除）、片段替换装饰（未触及 = inline replace
// widget；触及 = 源码显形，selectionTouchesRange 语义）、纯 <style> 块
// 恒不发射（源码常显不占位，Q6A）、「编辑当前 HTML 源码」操作的目标解析
// （命中当前片段后选中完整源码区间）。真实指针/绘制验证在 browser 与
// 集成层。
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  LIVE_HTML_CLASS_NAMES,
  LIVE_HTML_FRAME_CLASS_NAMES,
  LiveHtmlWidget,
  liveHtml,
  liveHtmlDecorations,
  liveHtmlSpansField,
  revealHtmlSourceAtCursor,
} from '../../src/webview/liveHtml'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { isPureStyleHtmlBlock } from '../../src/shared/htmlBlock'

function buildState(text: string, selection: EditorSelection) {
  return EditorState.create({
    doc: text,
    extensions: [liveDecorationsField, liveHtml],
    selection,
  })
}

/** 装饰观测：StateField 直驱（跨行 replace 只能来自 StateField 的 CM6 约束）；
 *  便捷接受单 range（EditorSelection.range 产物——内部包成单 range 选区） */
function buildDecos(
  text: string,
  selection: EditorSelection | SelectionRange,
): Array<{ from: number; to: number; widget: LiveHtmlWidget }> {
  const sel = selection instanceof EditorSelection
    ? selection
    : EditorSelection.create([selection], 0)
  const state = buildState(text, sel)
  const decos = state.field(liveHtmlDecorations)
  const out: Array<{ from: number; to: number; widget: LiveHtmlWidget }> = []
  decos.between(0, text.length, (from, to, value) => {
    const spec = value.spec as { widget?: LiveHtmlWidget }
    if (spec.widget) {
      out.push({ from, to, widget: spec.widget })
    }
  })
  return out.sort((a, b) => a.from - b.from)
}

const TABLE_BLOCK = [
  '<table>',
  '  <tr>',
  '    <td colspan="2" rowspan="3">合并</td>',
  '    <td>普通</td>',
  '  </tr>',
  '</table>',
].join('\n')

const DOC = [
  '前文段。',
  '',
  TABLE_BLOCK,
  '',
  '中间段。',
  '',
  '<style>',
  '.x { color: red; }',
  '</style>',
  '',
  '尾段。',
].join('\n')

const HTML_FROM = DOC.indexOf('<table>')
const HTML_TO = HTML_FROM + TABLE_BLOCK.length
const STYLE_FROM = DOC.indexOf('<style>')

describe('Live HTML 块表（Lezer HTMLBlock 派生）', () => {
  it('顶层 html 块进入表（from/to 为源文精确区间）', () => {
    const spans = buildState(DOC, EditorSelection.single(0)).field(liveHtmlSpansField)
    const table = spans.find((s) => s.from === HTML_FROM)
    expect(table).toBeDefined()
    expect(table!.to).toBe(HTML_TO)
    expect(table!.source).toBe(TABLE_BLOCK)
  })

  it('纯 <style> 块进入表但恒不发射装饰（源码常显不占位）', () => {
    const spans = buildState(DOC, EditorSelection.single(0)).field(liveHtmlSpansField)
    const style = spans.find((s) => s.from === STYLE_FROM)
    expect(style).toBeDefined()
    expect(isPureStyleHtmlBlock(style!.source)).toBe(true)
    // 光标远离两块：style 块不发射、table 块发射
    const items = buildDecos(DOC, EditorSelection.single(0))
    expect(items).toHaveLength(1)
    expect(items[0]!.from).toBe(HTML_FROM)
  })

  it('围栏代码/引用内不产 html 块表条目', () => {
    const text = '```\n<div>围栏内</div>\n```\n\n> <div>引用内</div>\n'
    const spans = buildState(text, EditorSelection.single(0)).field(liveHtmlSpansField)
    expect(spans).toHaveLength(0)
  })
})

describe('Live HTML 片段替换装饰：显隐切换', () => {
  it('光标在块外 → inline replace widget 覆盖精确区间', () => {
    const items = buildDecos(DOC, EditorSelection.single(0))
    expect(items[0]!.from).toBe(HTML_FROM)
    expect(items[0]!.to).toBe(HTML_TO)
    expect(items[0]!.widget).toBeInstanceOf(LiveHtmlWidget)
  })

  it('折叠光标进入区间（含两端边界）→ 撤下 widget 源码显形', () => {
    for (const pos of [HTML_FROM, HTML_FROM + 3, HTML_TO]) {
      expect(buildDecos(DOC, EditorSelection.single(pos))).toHaveLength(0)
    }
  })

  it('非空选区与区间相交 → 显形（不要求包含）', () => {
    // 从块前选到块中间
    const sel = EditorSelection.range(HTML_FROM - 5, HTML_FROM + 4)
    expect(buildDecos(DOC, sel)).toHaveLength(0)
  })

  it('非空选区横跨整块（跨块选择）→ 显形且区间外端点不扩选', () => {
    const sel = EditorSelection.range(HTML_FROM - 6, HTML_TO + 2)
    expect(buildDecos(DOC, sel)).toHaveLength(0)
    // 选区保持原样由 CM6 selection 语义承担——此处钉装饰不发射即可
  })

  it('光标完全离开 → 恢复渲染（widget 重新在场）', () => {
    const inside = buildDecos(DOC, EditorSelection.single(HTML_FROM + 4))
    expect(inside).toHaveLength(0)
    const outside = buildDecos(DOC, EditorSelection.single(HTML_TO + 10))
    expect(outside).toHaveLength(1)
    expect(outside[0]!.from).toBe(HTML_FROM)
  })

  it('多选区任一 range 命中显形（其他 range 不坍缩——谓词按任一命中判定）', () => {
    const state = EditorState.create({
      doc: DOC,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        liveDecorationsField,
        liveHtml,
      ],
      selection: EditorSelection.create([
        EditorSelection.range(0, 0),
        EditorSelection.range(HTML_FROM + 2, HTML_FROM + 2),
      ], 1),
    })
    expect(state.field(liveHtmlDecorations).size).toBe(0)
  })

  it('widget eq 语义（source/from/to/docScope 同键复用）', () => {
    const a = new LiveHtmlWidget('<div>x</div>', 10, 20, 'doc')
    const b = new LiveHtmlWidget('<div>x</div>', 10, 20, 'doc')
    const c = new LiveHtmlWidget('<div>x</div>', 10, 20, null)
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })

  it('widget toDOM：宿主类名、净化内容、源码区间 dataset（点击拦截的目标面）', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(0)), parent: document.body })
    try {
      const host = view.dom.querySelector<HTMLElement>(`.${LIVE_HTML_CLASS_NAMES.host}`)
      expect(host).not.toBeNull()
      expect(host!.dataset['vsidianHtmlFrom']).toBe(String(HTML_FROM))
      expect(host!.dataset['vsidianHtmlTo']).toBe(String(HTML_TO))
      // 净化内容：table 原生语义 DOM（非转义文本）
      expect(host!.querySelector('table')).not.toBeNull()
      expect(host!.querySelector('td[colspan="2"][rowspan="3"]')).not.toBeNull()
      // 右上角编辑按钮（复用图形块按钮族，仅 edit）
      expect(host!.querySelector('.vsidian-graphic-chrome-edit')).not.toBeNull()
      expect(host!.querySelector('.vsidian-graphic-chrome-popup')).toBeNull()
    } finally {
      view.destroy()
    }
  })

  it('widget 不吞事件（ignoreEvent=false——点击进入源码的规格前提）', () => {
    const w = new LiveHtmlWidget('<div>x</div>', 0, 5, 'doc')
    expect(w.ignoreEvent()).toBe(false)
  })

  it('危险内容在 widget DOM 中被净化（负向：script/事件/伪造锚点不进场）', () => {
    const evil = '<div onclick="evil()">x</div><script>bad()</script><span data-vsidian-src-start="1">y</span>'
    const w = new LiveHtmlWidget(evil, 0, evil.length, 'doc')
    const dom = w.toDOM()
    expect(dom.querySelector('script')).toBeNull()
    expect(dom.querySelector('[onclick]')).toBeNull()
    expect(dom.querySelector('[data-vsidian-src-start]')).toBeNull()
    expect(dom.querySelector('div')!.textContent).toContain('x')
    expect(dom.querySelector('span')!.textContent).toBe('y')
  })

  it('#571（T06）widget destroy：媒体立即释放（显形撤下 widget 后无持续播放）+ 资源订阅退订', () => {
    const src = '<video src="https://cdn/v.mp4" controls></video>'
    const w = new LiveHtmlWidget(src, 0, src.length, 'doc')
    const dom = w.toDOM()
    const video = dom.querySelector('video')!
    const pause = vi.spyOn(video, 'pause')
    const load = vi.spyOn(video, 'load')
    w.destroy(dom)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(video.getAttribute('src')).toBe(null)
  })

  it('#572（T07）iframe 命中区接管：wrapper + 透明 shield 装配（外层命中机制——帧事件不冒泡到父文档）', () => {
    const src = '<iframe src="https://example.com/embed"></iframe>'
    const w = new LiveHtmlWidget(src, 0, src.length, 'doc')
    const dom = w.toDOM()
    const iframe = dom.querySelector('iframe')
    expect(iframe, 'iframe 在场（白名单放行）').not.toBeNull()
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts')
    const shield = dom.querySelector(`.${LIVE_HTML_FRAME_CLASS_NAMES.shield}`)
    expect(shield, '透明覆盖层在场').not.toBeNull()
    const wrapper = dom.querySelector(`.${LIVE_HTML_FRAME_CLASS_NAMES.frame}`)
    expect(wrapper, '定位包裹层在场').not.toBeNull()
    // 结构契约：iframe 与 shield 同为 wrapper 子级、shield 后置（覆盖帧）
    expect(iframe!.parentElement).toBe(wrapper)
    expect(shield!.parentElement).toBe(wrapper)
    expect(wrapper!.lastElementChild).toBe(shield)
  })

  it('#572（T07）srcdoc iframe 同样接管（内容形态不影响命中区机制）', () => {
    const src = '<iframe srcdoc="<b>内嵌文档</b>"></iframe>'
    const w = new LiveHtmlWidget(src, 0, src.length, 'doc')
    const dom = w.toDOM()
    expect(dom.querySelector('iframe')!.getAttribute('sandbox')).toBe('')
    expect(dom.querySelector(`.${LIVE_HTML_FRAME_CLASS_NAMES.shield}`)).not.toBeNull()
  })
})

describe('revealHtmlSourceAtCursor：编辑当前 HTML 源码（键位/按钮同源执行体）', () => {
  function head(state: EditorState): number {
    return state.selection.main.head
  }

  it('光标在 html 块内 → 选中该片段完整源码区间', () => {
    const state = buildState(DOC, EditorSelection.single(HTML_FROM + 4))
    const next = state.update({ selection: { anchor: HTML_FROM, head: HTML_TO } }).state
    // 通过 view 派发路径验证（与生产执行体同入口）
    const view = new EditorView({ state, parent: document.body })
    try {
      const hit = revealHtmlSourceAtCursor(view)
      expect(hit).toBe(true)
      expect(view.state.selection.main.anchor).toBe(HTML_FROM)
      expect(view.state.selection.main.head).toBe(HTML_TO)
    } finally {
      view.destroy()
    }
    expect(head(next)).toBe(HTML_TO)
  })

  it('光标在块区间端点（含边界）也命中', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(HTML_FROM)), parent: document.body })
    try {
      expect(revealHtmlSourceAtCursor(view)).toBe(true)
      expect(view.state.selection.main.from).toBe(HTML_FROM)
      expect(view.state.selection.main.to).toBe(HTML_TO)
    } finally {
      view.destroy()
    }
  })

  it('光标不在任何 html 块 → 静默不动作（选区不变）', () => {
    const view = new EditorView({ state: buildState(DOC, EditorSelection.single(2)), parent: document.body })
    try {
      expect(revealHtmlSourceAtCursor(view)).toBe(false)
      expect(view.state.selection.main.head).toBe(2)
    } finally {
      view.destroy()
    }
  })
})
