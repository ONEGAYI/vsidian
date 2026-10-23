import { describe, it, expect } from 'vitest'
import { tableCellInputView, planTableCellInput } from '../../src/shared/tableCellInput'

describe('独立格内输入投影', () => {
  it('插入管道使用完整代码片段上下文，不添加可见反斜杠', () => {
    expect(planTableCellInput('`ab`', '`a|b`', 3)).toEqual({ from: 2, to: 2, insert: '|', selection: 3 })
  })
  it('管道前输入反斜杠保持单格且投影往返不丢字符', () => {
    const plan = planTableCellInput('a\\|b', 'a\\|b', 2)
    const next = 'a\\|b'.slice(0, plan.from) + plan.insert + 'a\\|b'.slice(plan.to)
    expect(next).toBe('a\\\\\\|b')
    expect(tableCellInputView(next).text).toBe('a\\|b')
  })
  it('真正空值直接输入及清空，不需要源码填充', () => {
    expect(tableCellInputView('')).toEqual({ text: '', positions: [0] })
    expect(planTableCellInput('', '中文', 2)).toEqual({ from: 0, to: 0, insert: '中文', selection: 2 })
    expect(planTableCellInput('中文', '', 0)).toEqual({ from: 0, to: 2, insert: '', selection: 0 })
  })
  it('删除解码管道会同时删除源码转义符', () => {
    expect(tableCellInputView('a\\|b')).toEqual({ text: 'a|b', positions: [0, 1, 3, 4] })
    expect(planTableCellInput('a\\|b', 'ab', 1)).toEqual({ from: 1, to: 3, insert: '', selection: 1 })
  })
  it('br 按可见换行映射，删除一笔覆盖整个标记', () => {
    expect(tableCellInputView('a<br>b')).toEqual({ text: 'a\nb', positions: [0, 1, 5, 6] })
    expect(planTableCellInput('a<br>b', 'ab', 1)).toEqual({ from: 1, to: 5, insert: '', selection: 1 })
  })
  it('未编辑 br 原始拼写保持，代码内 br 不解码', () => {
    expect(planTableCellInput('a<BR />b', 'a\nbc', 4)).toEqual({ from: 8, to: 8, insert: 'c', selection: 9 })
    expect(tableCellInputView('`<br>`').text).toBe('`<br>`')
  })
  it('输入管道和换行共用表格转义事实源', () => {
    expect(planTableCellInput('ab', 'a|\nb', 3)).toEqual({ from: 1, to: 1, insert: '\\|<br>', selection: 7 })
  })
})
