// #318 原型验证契约：搜索选中条目回读与文档配对（host/searchReveal）。
// copyMatch 输出格式钉在 1.82.3 实测样例（"3,1: 原型唯一匹配词出现在甲文件
// 第三行。"——1-based 行列 + 行全文）；配对以行文本吻合为文件身份唯一校验
// （残留选中条目误配对到其他文件必须在此拦下），offset 为宿主系（含 \r）。
import { describe, expect, it } from 'vitest'
import { matchHostOffset, parseCopyMatch } from '../../src/host/searchReveal'

const LF_DOC = '# 标题\n\n第一段正文。\n\n目标行内容在此。\n\n结尾。\n'
const CRLF_DOC = '# 标题\r\n\r\n目标行内容在此。\r\n结尾。\r\n'

describe('copyMatch 输出解析（parseCopyMatch）', () => {
  it('1.82.3 实测样例：`3,1: 行文本` 解析为 1-based 行列', () => {
    expect(parseCopyMatch('3,1: 原型唯一匹配词出现在甲文件第三行。')).toEqual({
      line: 3,
      col: 1,
      text: '原型唯一匹配词出现在甲文件第三行。',
    })
  })
  it('列非 1（匹配在行中）照常解析', () => {
    expect(parseCopyMatch('2,9: abc def')).toEqual({ line: 2, col: 9, text: 'abc def' })
  })
  it('非 copyMatch 产物：哨兵、普通文本、空串、多行文本均拒绝', () => {
    expect(parseCopyMatch('\u0000vsidian-search-reveal-probe\u0000')).toBeNull()
    expect(parseCopyMatch('随便一段剪贴板文本')).toBeNull()
    expect(parseCopyMatch('')).toBeNull()
    expect(parseCopyMatch('3,1: 第一行\n第二行')).toBeNull()
  })
  it('0 基行列（非法 workbench Range）拒绝', () => {
    expect(parseCopyMatch('0,1: x')).toBeNull()
    expect(parseCopyMatch('3,0: x')).toBeNull()
  })
})

describe('文档配对与宿主系 offset（matchHostOffset）', () => {
  it('LF 文档命中：行文本吻合，offset 为匹配起始（宿主系）', () => {
    // LF_DOC 第 3 行 '第一段正文。'（1-based），col 4 → 第 4 列「正」字起始
    const probe = { line: 3, col: 4, text: '第一段正文。' }
    expect(matchHostOffset(LF_DOC, probe)).toBe('# 标题\n\n第一段'.length)
  })
  it('CRLF 文档命中：offset 计入 \\r（宿主系口径）', () => {
    const probe = { line: 3, col: 1, text: '目标行内容在此。' }
    expect(matchHostOffset(CRLF_DOC, probe)).toBe('# 标题\r\n\r\n'.length)
  })
  it('行文本不吻合（残留条目属于其他文件）：拒绝——文件身份唯一校验', () => {
    const probe = { line: 3, col: 1, text: '完全不同的行内容' }
    expect(matchHostOffset(LF_DOC, probe)).toBeNull()
  })
  it('行号越界拒绝；空文档空行匹配（正则 ^$ 残留）落到 offset 0 无害', () => {
    expect(matchHostOffset(LF_DOC, { line: 99, col: 1, text: 'x' })).toBeNull()
    expect(matchHostOffset('', { line: 1, col: 1, text: '' })).toBe(0)
  })
  it('末行命中（无行尾）与 col 越界钳制到行尾', () => {
    const last = { line: 7, col: 1, text: '结尾。' } as const
    expect(matchHostOffset(LF_DOC, last)).toBe(LF_DOC.length - '结尾。\n'.length)
    const clamped = matchHostOffset(LF_DOC, { line: 3, col: 999, text: '第一段正文。' })
    expect(clamped).toBe('# 标题\n\n第一段正文。'.length)
  })
})
