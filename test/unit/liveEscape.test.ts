// Markdown 转义符通用显隐契约（验收反馈：转义符不限于表格，全文档一致）：
// Live 正文里 Escape 节点（`\`+ASCII 标点）的反斜杠默认隐藏（所见 = 字面
// 字符），光标/选区触及该行时浅色显形（暴露源码）——对齐 Obsidian 的
// 转义符行内源码暴露语义。表格行内的 `\|` 例外：走 live-table-escaped-pipe
// 契约的专用装饰（#42 既有承诺；降级态源文原文呈现），本模块不重复发射。
// 断言分两层：装饰构建（DecorationSet 类名与文本）与真实 EditorView DOM
// （e5576db 教训：构建层过不等于 DOM 层挂载）。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  LIVE_CLASS_NAMES,
  buildLivePreviewDecorations,
  livePreviewDecorations,
} from '../../src/webview/liveDecorations'

const DOC = [
  'plain \\*literal\\* text',
  'code `a\\|b` span',
  '\\\\ double',
  '| a | b |',
  '| --- | --- |',
  '| only one |',
  '| [[x\\|y]] | c |',
  '',
].join('\n')

const DOC_TEXT = Text.of(DOC.split('\n'))

function build(anchor: number, head?: number): { escape: string[]; reveal: string[] } {
  const set = buildLivePreviewDecorations(
    DOC_TEXT,
    head === undefined ? EditorSelection.single(anchor) : EditorSelection.single(anchor, head),
  )
  const texts = (cls: string): string[] => {
    const out: string[] = []
    set.between(0, DOC.length, (from, to, deco) => {
      if (deco.spec.class?.split(' ').includes(cls)) {
        out.push(DOC.slice(from, to))
      }
    })
    return out
  }
  return { escape: texts(LIVE_CLASS_NAMES.escape), reveal: texts(LIVE_CLASS_NAMES.escapeReveal) }
}

describe('转义符通用显隐（构建层）', () => {
  it('光标未触及：反斜杠挂隐藏类（渲染为字面字符）；代码 span 内不发射', () => {
    const got = build(DOC.length)
    // 第一行两个 \* 的反斜杠 + 第三行 \\ 的首个反斜杠；代码 span 内不发射
    expect(got.escape).toEqual(['\\', '\\', '\\'])
    expect(got.reveal).toEqual([])
  })

  it('光标触及该行：换挂显形类；离开恢复隐藏', () => {
    const line1 = DOC.split('\n')[0]!
    const hidden = build(DOC.length)
    const revealed = build(line1.length)
    expect(revealed.reveal).toEqual(['\\', '\\'])
    expect(revealed.escape).toEqual(['\\']) // 第三行 \\ 的首字符仍隐藏
    expect(hidden.reveal).toEqual([])
  })

  it('非空选区与该行重叠即显形（Obsidian 选区控制范围语义）', () => {
    // 光标在第二行首（不触及第一行）→ 隐藏
    expect(build(DOC.indexOf('code') + 1).reveal).toEqual([])
    // 跨第一二行的非空选区 → 第一行显形
    const got = build(1, DOC.indexOf('code') + 2)
    expect(got.reveal).toEqual(['\\', '\\'])
  })

  it('表格行内 \\| 不走通用装饰：grid 态归专用类，降级态原文呈现', () => {
    // grid 表头行与数据行、降级行的反斜杠都不进通用集合（专用路径或原文）
    const got = build(DOC.length)
    expect(got.escape).toHaveLength(3)
    // 光标进入表格别名格所在行：该行 \| 的显形由专用 reveal 类承担，
    // 通用 reveal 不发射
    const tableLineFrom = DOC.indexOf('| [[x')
    expect(build(tableLineFrom + 2).reveal).toEqual([])
  })
})

describe('转义符通用显隐（DOM 层）', () => {
  it('真实 EditorView：触及行显形 span 挂载、未触行隐藏 span 挂载', () => {
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({
        doc: DOC,
        extensions: [livePreviewDecorations],
        selection: EditorSelection.single(2), // 第一行内（\* 前）
      }),
    })
    const line1 = view.contentDOM.querySelectorAll('.cm-line')[0]!
    expect(line1.querySelectorAll(`.${LIVE_CLASS_NAMES.escapeReveal}`)).toHaveLength(2)
    expect(line1.querySelectorAll(`.${LIVE_CLASS_NAMES.escape}`)).toHaveLength(0)
    const codeLine = view.contentDOM.querySelectorAll('.cm-line')[1]!
    expect(codeLine.querySelectorAll(`.${LIVE_CLASS_NAMES.escape}, .${LIVE_CLASS_NAMES.escapeReveal}`))
      .toHaveLength(0)
    view.destroy()
  })
})
