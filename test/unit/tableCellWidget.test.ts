// @vitest-environment jsdom
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

installLocale('zh-cn', zhCn)

// 表格格内 widget 网格共存契约（工单 #150）：
//
// 核心断言（用户可观察行为，非实现复述）：
// - 含 replace widget（双链/图片/公式）的表格网格行，其行级格位分配与
//   普通行等价：widget 与 cm-widgetBuffer 不裸露为 .cm-line（CSS grid
//   容器）直接子元素，不额外占格位（票内诊断：裸露导致 grid 自动放置
//   把后续单元格顶到多出的行）
// - widget 渲染保留：以渲染态（显示文字/占位/KaTeX）呈现在所属格内，
//   与格内文字同处一个 cell span（边框与内边距包裹全部格内容）
// - 光标进入格内显示源码、网格保留；移出后渲染态恢复（编辑链路不回归）
// - 表格外正文中的 widget 渲染不受影响
import { describe, it, expect } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/table-widget.md'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

interface Harness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(): Harness {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

function mount(h: Harness, text: string): WebviewSyncController {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const c = new WebviewSyncController(h.bridge)
  c.mount(host)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  return c
}

const WIKILINK_TABLE = [
  '# 表格',
  '',
  '| 甲 | 乙 |',
  '| --- | --- |',
  '| 一 | 二 |',
  '| 三[[a b]] | 四 |',
  '',
  '正文 [[外部 双链]] 段落。',
  '',
].join('\n')

/** 行级格位签名：直接子元素的 tag + 排序类名 token 序列（格位分配等价判据） */
function childSignature(row: Element): Array<{ tag: string; cls: string[] }> {
  return [...row.children].map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: [...el.classList].sort(),
  }))
}

/** 普通两列网格行的期望签名：管道 ×3 + 单元格 ×2（票内诊断基线） */
const NORMAL_ROW_SIGNATURE = [
  { tag: 'span', cls: ['vsidian-table-pipe'] },
  { tag: 'span', cls: ['vsidian-table-grid-cell'] },
  { tag: 'span', cls: ['vsidian-table-pipe'] },
  { tag: 'span', cls: ['vsidian-table-grid-cell'] },
  { tag: 'span', cls: ['vsidian-table-pipe'] },
]

function gridRows(c: WebviewSyncController): HTMLElement[] {
  const view = c.getView()!
  return [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')]
}

describe('表格格内 widget 网格共存（#150）', () => {
  it('含双链格的行与普通行格位子元素等价，widget 不裸露为格位', () => {
    const c = mount(makeBridge(), WIKILINK_TABLE)
    try {
      const rows = gridRows(c)
      expect(rows).toHaveLength(3)
      expect(childSignature(rows[1]!)).toEqual(NORMAL_ROW_SIGNATURE)
      // 修复目标：含 widget 的行签名与普通行一致（widget 与缓冲都在格内）
      expect(childSignature(rows[2]!)).toEqual(NORMAL_ROW_SIGNATURE)
      expect(rows[2]!.querySelectorAll(':scope > img.cm-widgetBuffer')).toHaveLength(0)
      expect(rows[2]!.querySelectorAll(':scope > .vsidian-wikilink')).toHaveLength(0)
    } finally {
      c.dispose()
    }
  })

  it('双链以渲染态呈现在所属格内，格 span 同时包含文字与渲染文字', () => {
    const c = mount(makeBridge(), WIKILINK_TABLE)
    try {
      const rows = gridRows(c)
      const cell = rows[2]!.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[0]!
      const wikilink = cell.querySelector<HTMLElement>('.vsidian-wikilink')
      expect(wikilink, '双链应渲染在第一格内').not.toBeNull()
      expect(wikilink!.textContent).toBe('a b')
      // 同一格既有源文字「三」又有渲染文字（一个 cell span 承载全部内容；
      // 格区间含管道两侧空格）
      expect(cell.textContent).toBe(' 三a b ')
      // 网格行的两列格仍在（第二格是「四」）
      const cells = rows[2]!.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')
      expect(cells).toHaveLength(2)
      expect(cells[1]!.textContent).toBe(' 四 ')
    } finally {
      c.dispose()
    }
  })

  it('格首双链同样不破坏格位', () => {
    const doc = [
      '| 甲 | 乙 |',
      '| --- | --- |',
      '| [[x]]三 | 四 |',
      '',
    ].join('\n')
    const c = mount(makeBridge(), doc)
    try {
      const rows = gridRows(c)
      expect(childSignature(rows[1]!)).toEqual(NORMAL_ROW_SIGNATURE)
      const cell = rows[1]!.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[0]!
      expect(cell.querySelector('.vsidian-wikilink')?.textContent).toBe('x')
      expect(cell.textContent).toBe(' x三 ')
    } finally {
      c.dispose()
    }
  })

  it('格内图片 widget 渲染保留且格位子元素与普通行等价', () => {
    const doc = [
      '| 甲 | 乙 |',
      '| --- | --- |',
      '| 一 | 二 |',
      '| 三![alt 文字](a.png) | 四 |',
      '',
    ].join('\n')
    const c = mount(makeBridge(), doc)
    try {
      const rows = gridRows(c)
      expect(childSignature(rows[2]!)).toEqual(NORMAL_ROW_SIGNATURE)
      const cell = rows[2]!.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[0]!
      const image = cell.querySelector<HTMLElement>('.vsidian-image')
      expect(image, '图片占位应渲染在第一格内').not.toBeNull()
      expect(cell.textContent).toContain('alt 文字')
      expect(rows[2]!.querySelectorAll(':scope > .vsidian-image')).toHaveLength(0)
    } finally {
      c.dispose()
    }
  })

  it('格内行内公式 widget 渲染保留且格位子元素与普通行等价', () => {
    const doc = [
      '| 甲 | 乙 |',
      '| --- | --- |',
      '| 一 | 二 |',
      '| 三$x$ | 四 |',
      '',
    ].join('\n')
    const c = mount(makeBridge(), doc)
    try {
      const rows = gridRows(c)
      expect(childSignature(rows[2]!)).toEqual(NORMAL_ROW_SIGNATURE)
      const cell = rows[2]!.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[0]!
      const math = cell.querySelector<HTMLElement>('[data-vsidian-rendered-math]')
      expect(math, '公式应渲染在第一格内').not.toBeNull()
      expect(math!.querySelector('.katex')).not.toBeNull()
      expect(rows[2]!.querySelectorAll(':scope > [data-vsidian-rendered-math]')).toHaveLength(0)
    } finally {
      c.dispose()
    }
  })

  it('一格多个 widget 与多格 widget 同时在场不破坏格位', () => {
    const doc = [
      '| 甲 | 乙 |',
      '| --- | --- |',
      '| 三[[a]][[b]]四 | $x$ |',
      '',
    ].join('\n')
    const c = mount(makeBridge(), doc)
    try {
      const rows = gridRows(c)
      expect(childSignature(rows[1]!)).toEqual(NORMAL_ROW_SIGNATURE)
      const cells = rows[1]!.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')
      expect(cells[0]!.querySelectorAll('.vsidian-wikilink')).toHaveLength(2)
      expect(cells[1]!.querySelector('[data-vsidian-rendered-math]')).not.toBeNull()
    } finally {
      c.dispose()
    }
  })

  it('光标进入含 widget 的格显示源码且网格保留，移出后渲染恢复', () => {
    const c = mount(makeBridge(), WIKILINK_TABLE)
    try {
      const view = c.getView()!
      const doc = view.state.doc.toString()
      const inside = doc.indexOf('a b')
      view.dispatch({ selection: EditorSelection.single(inside) })
      const rowAfterIn = [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')][2]!
      expect(rowAfterIn, '光标在格内仍保留网格').not.toBeNull()
      expect(rowAfterIn.querySelectorAll(':scope > .vsidian-table-grid-cell')).toHaveLength(2)
      // 触及双链显示源码：渲染态标记消失（源码态是带同类名的 mark span）
      expect(rowAfterIn.querySelector('[data-vsidian-rendered-wikilink]')).toBeNull()
      expect(rowAfterIn.textContent).toContain('[[a b]]')
      // 移出（表外正文）后恢复渲染态，且仍在格内
      view.dispatch({ selection: EditorSelection.single(0) })
      const rowAfterOut = [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')][2]!
      const wikilink = rowAfterOut.querySelector<HTMLElement>('[data-vsidian-rendered-wikilink]')
      expect(wikilink?.textContent).toBe('a b')
      expect(wikilink?.closest('.vsidian-table-grid-cell')).not.toBeNull()
    } finally {
      c.dispose()
    }
  })

  it('表格外正文中的双链渲染不受影响', () => {
    const c = mount(makeBridge(), WIKILINK_TABLE)
    try {
      const view = c.getView()!
      const wikilinks = [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-wikilink')]
      expect(wikilinks.map((el) => el.textContent).sort()).toEqual(['a b', '外部 双链'])
      // 表外双链不在任何网格行内
      expect(wikilinks.every((el) => el.closest('.vsidian-table-grid-row') === null ||
        el.closest('.vsidian-table-grid-cell') !== null)).toBe(true)
    } finally {
      c.dispose()
    }
  })
})
