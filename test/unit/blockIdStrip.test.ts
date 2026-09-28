// 阅读侧块 id 标记剥离契约（#163 验收反馈）：markdown-it 解析前删除块 id
// 标记——行尾 ` ^id` 删标记区间、独立行 `^id` 删整行内容，仅保留换行
// （行数不变是 readingBlocks 锚点坐标系承诺，口径同 htmlComment.ts）；
// 围栏内部是代码内容不剥；闭围栏行行尾标记是围栏块自身 id，照剥。
import { describe, expect, it } from 'vitest'
import { stripBlockIdMarks } from '../../src/webview/blockIdStrip'

describe('阅读侧块 id 剥离（stripBlockIdMarks）', () => {
  it('行尾形态：删标记区间保正文与换行', () => {
    expect(stripBlockIdMarks('正文段落 ^abc123\n后文\n')).toBe('正文段落\n后文\n')
    expect(stripBlockIdMarks('正文\t^abc-def\n')).toBe('正文\n')
    expect(stripBlockIdMarks('正文 ^abc   \n')).toBe('正文\n') // 尾随空白随标记剥除
  })
  it('独立行形态：整行内容删除保换行（行数不变）', () => {
    expect(stripBlockIdMarks('段落\n\n^std456\n\n后文\n')).toBe('段落\n\n\n\n后文\n')
    expect(stripBlockIdMarks('  ^indent9\n')).toBe('\n')
  })
  it('围栏内部不剥（代码内容）；闭围栏行行尾标记照剥', () => {
    expect(stripBlockIdMarks('```js\nconst s = "x ^inside"\n```\n')).toBe('```js\nconst s = "x ^inside"\n```\n')
    expect(stripBlockIdMarks('```js\nx\n``` ^fence9\n')).toBe('```js\nx\n```\n')
  })
  it('行内代码与无标记文本：原样返回', () => {
    expect(stripBlockIdMarks('行内 `code ^x` 尾\n')).toBe('行内 `code ^x` 尾\n')
    expect(stripBlockIdMarks('普通正文\n正文^no-space\n')).toBe('普通正文\n正文^no-space\n')
    expect(stripBlockIdMarks('')).toBe('')
  })
  it('双形态混合全文', () => {
    const doc = '块甲 ^aaa111\n\n块乙\n\n^bbb222\n\n```js\nc ^in\n```\n\n``` ^f8ff\n'
    // ``` ^f8ff 未闭合围栏延伸到文件末行——围栏内不剥（其行尾标记保留）
    expect(stripBlockIdMarks(doc)).toBe('块甲\n\n块乙\n\n\n\n```js\nc ^in\n```\n\n``` ^f8ff\n')
  })
})
