// 块 id 标记 live 淡化装饰契约（#163 验收反馈）：行尾 ` ^id` 与独立行
// `^id` 双形态发射 mark 装饰区间（类 vsidian-block-id），围栏内部不命中。
// 形态学同源于 shared/blockId（识别矩阵不再重测——这里钉「装饰区间发射」
// 与 StateField 装配）。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { blockIdMarkField, buildBlockIdMarkRanges, liveBlockId } from '../../src/webview/liveBlockId'

/** 装饰发射区间 → 覆盖文本列表（装饰发射契约的统一读法） */
function coveredTexts(set: DecorationSet, doc: string): string[] {
  const out: string[] = []
  set.between(0, doc.length, (from, to, deco) => {
    if (deco.spec.class === 'vsidian-block-id') {
      out.push(doc.slice(from, to))
    }
  })
  return out
}

describe('buildBlockIdMarkRanges：双形态标记区间（#163 验收反馈）', () => {
  it('行尾形态：区间含前导空格到行尾（整段标记淡化）', () => {
    const doc = '正文段落 ^abc123\n'
    expect(buildBlockIdMarkRanges(EditorState.create({ doc }).doc).map((r) => doc.slice(r.from, r.to)))
      .toEqual([' ^abc123'])
  })
  it('独立行形态：区间覆盖整行', () => {
    const doc = '段落\n\n^std456\n\n后文\n'
    expect(buildBlockIdMarkRanges(EditorState.create({ doc }).doc).map((r) => doc.slice(r.from, r.to)))
      .toEqual(['^std456'])
  })
  it('双形态并存多标记：区间按文档序有序发射', () => {
    const doc = '块甲 ^aaa111\n\n块乙\n\n^bbb222\n\n块丙\t^ccc333\n'
    expect(buildBlockIdMarkRanges(EditorState.create({ doc }).doc).map((r) => doc.slice(r.from, r.to)))
      .toEqual([' ^aaa111', '^bbb222', '\t^ccc333'])
  })
  it('围栏内部不命中（代码内容）；闭围栏行行尾标记命中', () => {
    const doc = '```js\nconst x = `code ^inside`\n```\n\n正文 ^after\n'
    const ranges = buildBlockIdMarkRanges(EditorState.create({ doc }).doc)
    expect(ranges.map((r) => doc.slice(r.from, r.to))).toEqual([' ^after'])
    const fenced = '```js\nx\n``` ^fence9\n'
    expect(buildBlockIdMarkRanges(EditorState.create({ doc: fenced }).doc).map((r) => fenced.slice(r.from, r.to)))
      .toEqual([' ^fence9'])
  })
  it('无标记与行内代码字面量：不发射', () => {
    const doc = '普通正文\n行内 `code ^x` 尾\n正文^no-space\n'
    expect(buildBlockIdMarkRanges(EditorState.create({ doc }).doc)).toEqual([])
  })
})

describe('liveBlockId 扩展装配（StateField decorations）', () => {
  it('装饰集随扩展发射；编辑后重建', () => {
    const doc = '段落\n\n^keep1\n'
    let state = EditorState.create({ doc, extensions: [liveBlockId] })
    expect(coveredTexts(state.field(blockIdMarkField), doc)).toEqual(['^keep1'])
    // 编辑追加一个行尾标记后重建（docChanged 全量重扫）
    state = state.update({ changes: { from: 2, insert: ' ^new789' } }).state
    expect(coveredTexts(state.field(blockIdMarkField), state.doc.toString())).toEqual([' ^new789', '^keep1'])
  })
})
