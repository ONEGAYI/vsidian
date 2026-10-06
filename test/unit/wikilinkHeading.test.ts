// 标题候选纯逻辑契约（工单 #379 T04）：
// - enumerateAtxHeadings：按现有 ATX 口径枚举（ATX_HEADING_RE 同源、围栏内
//   伪标题排除、CRLF 容错），重复标题保留独立身份与位置（每行一项，不合并），
//   同名项（规范化口径）标记 duplicate——与跳转定位 findHeadingOffset 的
//   「同名取首」对齐：选任何同名项都有定位风险。
// - filterWikilinkHeadings：按实际输入的标题前缀过滤（规范化口径：trim +
//   空白折叠 + 小写——与 normalizeHeadingText 同一实现，原文略有差异但
//   定位会同名命中的标题不得漏报）。
// 规格依据：docs/specs/wikilink-completion.md「重复标题的呈现与提示」
// 「输入识别、选区与确认」（标题按现有 ATX 口径枚举，围栏内伪标题排除）。
import { describe, expect, it } from 'vitest'
import {
  enumerateAtxHeadings,
  filterWikilinkHeadings,
  normalizeHeadingText,
} from '../../src/shared/wikilinkHeading'

describe('enumerateAtxHeadings：ATX 口径枚举', () => {
  it('枚举全部层级（1-6）并给出层级、行号与行首偏移', () => {
    const text = '# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级\n'
    const headings = enumerateAtxHeadings(text)
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6])
    expect(headings.map((h) => h.text)).toEqual(['一级', '二级', '三级', '四级', '五级', '六级'])
    expect(headings.map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6])
    expect(headings.map((h) => h.offset)).toEqual([0, 5, 11, 18, 26, 35])
  })

  it('非 ATX 形态不枚举：七级、缩进超限、无空格、setext、行中 #；行尾关闭序列仍命中', () => {
    const text = [
      '####### 七级不是标题',
      '    # 缩进四格不是标题',
      '#无空格不是标题',
      '标题',
      '======',
      '闭尾标记 ## 不是标题（行首无 #）',
      '# 真闭尾标记 ##',
    ].join('\n')
    const headings = enumerateAtxHeadings(text)
    // ATX_HEADING_RE 允许行首 ≤3 空格与行尾关闭序列；上列中仅最后一行命中
    expect(headings.map((h) => h.text)).toEqual(['真闭尾标记'])
    expect(headings[0]!.level).toBe(1)
  })

  it('围栏代码内的伪标题排除；闭围栏后恢复；闭围栏行尾容错', () => {
    const text = [
      '# 真标题',
      '```md',
      '# 围栏内伪标题',
      '## 也是伪标题',
      '```',
      '# 围栏后真标题',
      '~~~',
      '# 波浪围栏内伪标题',
      '~~~',
    ].join('\n')
    const headings = enumerateAtxHeadings(text)
    expect(headings.map((h) => h.text)).toEqual(['真标题', '围栏后真标题'])
  })

  it('CRLF 行尾容错：行号/偏移按 LF 系计算，\\r 不计入标题文字', () => {
    const text = '# 标题甲\r\n正文\r\n## 标题乙\r\n'
    const headings = enumerateAtxHeadings(text)
    expect(headings.map((h) => h.text)).toEqual(['标题甲', '标题乙'])
    expect(headings.map((h) => h.line)).toEqual([1, 3])
    expect(headings[1]!.offset).toBe('# 标题甲\r\n正文\r\n'.length)
  })

  it('重复标题全部保留：每行独立身份，同名项标记 duplicate，无同名不标', () => {
    // 尾随空白不入捕获组（ATX 正则捕获后 [ \t\r]*$ 吸收）——'预算' 与
    // '预算 '（原文尾随空格）捕获同为 '预算'，规范化同名命中
    const text = '# 预算\n正文\n# 预算 \n# 其他\n## 预算\n'
    const headings = enumerateAtxHeadings(text)
    expect(headings.map((h) => h.text)).toEqual(['预算', '预算', '其他', '预算'])
    expect(headings.map((h) => h.line)).toEqual([1, 3, 4, 5])
    // 规范化口径：定位会同名命中，须标风险
    expect(headings.map((h) => h.duplicate)).toEqual([true, true, false, true])
  })

  it('规范化同名判定与跳转口径一致：大小写与内部空白折叠', () => {
    const text = '# Big Feature\n# big  feature\n# other\n'
    const headings = enumerateAtxHeadings(text)
    expect(headings.map((h) => h.duplicate)).toEqual([true, true, false])
  })

  it('空文档与无标题文档返回空数组', () => {
    expect(enumerateAtxHeadings('')).toEqual([])
    expect(enumerateAtxHeadings('正文只有一段\n\n没有标题\n')).toEqual([])
  })
})

describe('filterWikilinkHeadings：前缀过滤（规范化口径）', () => {
  const headings = enumerateAtxHeadings(
    '# 预算 总览\n## 预算-明细\n# 其他\n#  预算\n',
  )

  it('空查询返回全部（# 后立即列出全部标题）', () => {
    expect(filterWikilinkHeadings(headings, '')).toHaveLength(4)
  })

  it('前缀匹配（大小写不敏感、空白折叠）', () => {
    const hits = filterWikilinkHeadings(headings, '预算')
    expect(hits.map((h) => h.text)).toEqual(['预算 总览', '预算-明细', '预算'])
    // 查询首尾空白折叠后同前缀——命中一致
    expect(filterWikilinkHeadings(headings, '  预算 ')).toHaveLength(3)
  })

  it('英文大小写折叠', () => {
    const en = enumerateAtxHeadings('# Overview\n# other\n')
    expect(filterWikilinkHeadings(en, 'OVE')).toHaveLength(1)
    expect(filterWikilinkHeadings(en, 'ove')).toHaveLength(1)
  })

  it('无命中返回空数组（空态呈现由消费方负责）', () => {
    expect(filterWikilinkHeadings(headings, '不存在的标题')).toEqual([])
  })

  it('过滤保留 duplicate 标记（重复风险不因过滤丢失）', () => {
    const dup = enumerateAtxHeadings('# 预算\n# 预算\n# 其他\n')
    const hits = filterWikilinkHeadings(dup, '预算')
    expect(hits.map((h) => h.duplicate)).toEqual([true, true])
  })
})

describe('normalizeHeadingText：规范化单一事实源', () => {
  it('trim + 空白折叠 + 小写（与跳转标题比较键一致）', () => {
    expect(normalizeHeadingText('  中部   小节 ')).toBe('中部 小节')
    expect(normalizeHeadingText('ABC')).toBe('abc')
    expect(normalizeHeadingText('')).toBe('')
  })
})
