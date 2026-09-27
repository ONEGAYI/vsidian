// 阅读侧 HTML 注释剥离纯函数契约（#139）：
// - 真删除（保留换行）：剥离不改行数——阅读块的 token.map 行号与
//   env.lineStarts（原文坐标，全部锚点取行首/行尾偏移）保持对齐，
//   锚点坐标系（#6/#7 的 data-vsidian-src-*、任务写回锚点）不受影响。
//   行内删除不留空位（验收修复：等长空格替换会在渲染折叠后残留一个
//   可见空格，`单<!--注释-->词` 曾显示为 `单 词`）
// - 未闭合残缺保留原样（不吞正文）
// - 围栏代码 / 行内代码 / 缩进代码内的字面 `<!--` 不剥离（多保护优于
//   误剥：误剥正文不可恢复，多显示注释只是呈现瑕疵）
// - 剥离只影响阅读渲染输入；查找、写回、源码文本不经本函数
import { describe, expect, it } from 'vitest'
import { stripHtmlComments } from '../../src/webview/htmlComment'

describe('stripHtmlComments（#139 阅读剥离）', () => {
  it('行内注释整段删除（不留空位，无空格紧贴场景）；同行多处独立剥离', () => {
    const out = stripHtmlComments('单<!--注释-->词')
    expect(out).toBe('单词')
    const text = '前 <!-- 注释一 --> 中 <!-- 注释二 --> 尾'
    expect(stripHtmlComments(text)).toBe('前  中  尾')
  })

  it('跨行块级注释剥离：换行保留（行数不变），体行成为空行', () => {
    const text = '段前\n<!-- 跨行\n注释 -->\n段后'
    const out = stripHtmlComments(text)
    expect(out.split('\n')).toEqual(['段前', '', '', '段后'])
    expect(out.match(/\n/g)).toHaveLength(3)
  })

  it('未闭合残缺保留原样，不吞后续正文', () => {
    const text = '正文 <!-- 残缺\n后续段'
    expect(stripHtmlComments(text)).toBe(text)
    // 残缺之后出现的新注释对仍按各自开闭处理（扫描不因残缺中止）
    expect(stripHtmlComments('a <!-- 残缺 b <!-- 好 --> c')).toBe('a <!-- 残缺 b  c')
  })

  it('围栏代码内的字面 <!-- 不剥离（含信息行与闭合前的内容）', () => {
    const text = '```\n<!-- 代码内 -->\n```'
    expect(stripHtmlComments(text)).toBe(text)
    const tilde = '~~~md\n<!-- 波浪围栏 -->\n~~~'
    expect(stripHtmlComments(tilde)).toBe(tilde)
  })

  it('行内代码内的字面 <!-- 不剥离', () => {
    const text = '说明 `<!-- 码 -->` 结束'
    expect(stripHtmlComments(text)).toBe(text)
    // 同行先有真注释、后有行内代码：只剥真注释
    expect(stripHtmlComments('前 <!-- 真 --> 后 `<!-- 码 -->` 尾')).toBe('前  后 `<!-- 码 -->` 尾')
  })

  it('缩进代码行（≥4 空格或含 tab）不剥离', () => {
    const text = '    <!-- 缩进代码 -->'
    expect(stripHtmlComments(text)).toBe(text)
  })

  it('嵌套开标记：体内含 < 的开标记作废，第二个开标记按自身配对（与 Lezer 一致）', () => {
    // Lezer 实测：第一个 <!-- 的体内再遇 '<'，不是合法注释起点（保留字面），
    // 只有第二个 <!-- y --> 构成 Comment 节点——剥离器同口径
    expect(stripHtmlComments('a <!-- x <!-- y --> b')).toBe('a <!-- x  b')
  })

  it('空串与无注释文本原样返回', () => {
    expect(stripHtmlComments('')).toBe('')
    expect(stripHtmlComments('普通正文\n另一行')).toBe('普通正文\n另一行')
  })
})
