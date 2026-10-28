// Callout 识别器与注册表契约（#653/T02）：识别形态学与 T01 两端语法对拍
// （docs/research/data/callout-t01/syntax-parity.json，35 夹具零分歧）同例——
// 识别器是两端共用的单一事实源（Live/Reading 适配器不得各写一份规则）。
// 输入约定（T01 §4 固定）：容器直属首段首行「段起点→行尾」子串（两端解析器
// 均已剥掉引用/列表前缀）；形态 /^\[!([^\]]*)\]([+-])?/ 上接三道拒绝——
// 空类型、类型非单标识符 [A-Za-z0-9_-]+、声明后紧贴非空白。
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_FALLBACK_TYPE,
  CALLOUT_TYPES,
  calloutDefaultTitle,
  calloutTypeOf,
  parseCalloutDecl,
} from '../../src/shared/calloutSyntax'

function decl(line: string) {
  return parseCalloutDecl(line)
}

describe('parseCalloutDecl：识别矩阵（对拍夹具同例）', () => {
  it('基本成型：显式标题 + fold 符号（F01/F03/F04/F05）', () => {
    expect(decl('[!note] 标题文字')).toEqual({
      type: 'note', fold: undefined, title: '标题文字', markerTo: 7,
    })
    expect(decl('[!tip] 提示一下')).toEqual({
      type: 'tip', fold: undefined, title: '提示一下', markerTo: 6,
    })
    expect(decl('[!note]+ 可折叠')).toEqual({
      type: 'note', fold: '+', title: '可折叠', markerTo: 8,
    })
    expect(decl('[!note]- 收起')).toEqual({
      type: 'note', fold: '-', title: '收起', markerTo: 8,
    })
  })

  it('只有声明（无标题无 fold，F02）：title 为 undefined，markerTo 在 ] 后', () => {
    expect(decl('[!note]')).toEqual({ type: 'note', fold: undefined, title: undefined, markerTo: 7 })
    expect(decl('[!note] ')).toEqual({ type: 'note', fold: undefined, title: undefined, markerTo: 7 })
  })

  it('大小写不敏感，类型小写规范化（F06）', () => {
    expect(decl('[!NoTe] 大小写')!.type).toBe('note')
    expect(decl('[!NOTE]')!.type).toBe('note')
  })

  it('未成型矩阵：空类型 / 含空格 / 未闭合 / 紧贴非空白（F07–F10）均 null', () => {
    expect(decl('[!] 空类型')).toBeNull()
    expect(decl('[!note extra] 非法')).toBeNull()
    expect(decl('[!note 标题')).toBeNull()
    expect(decl('[!note]-标题紧贴')).toBeNull()
    expect(decl('[!note]+标题')).toBeNull()
  })

  it('非标记起点（转义、普通文字、后续段落伪标记形态）不识别', () => {
    // F12/F28：首段普通文字与转义形态——识别器只认行首 [!，其余自然不命中
    expect(decl('普通引用首段')).toBeNull()
    expect(decl('\\[!note\\] 转义非 callout')).toBeNull()
    expect(decl('文字中间 [!note] 出现')).toBeNull()
  })

  it('标题含第二个标记按字面保留（F27）、含行内代码（F26）、中文标题（F35）', () => {
    expect(decl('[!note] 见 [!tip] 文档')!.title).toBe('见 [!tip] 文档')
    expect(decl('[!note] 用 `code` 说明')!.title).toBe('用 `code` 说明')
    expect(decl('[!note] 中文标题「测试」')!.title).toBe('中文标题「测试」')
  })

  it('未知自定义类型照常成型，原标识小写保留（F32）', () => {
    expect(decl('[!custom-question] 自定义')).toEqual({
      type: 'custom-question', fold: undefined, title: '自定义', markerTo: 18,
    })
  })

  it('markerTo 覆盖 fold 符号后的位置（标记隐藏区间的派生依据）', () => {
    expect(decl('[!note]+')!.markerTo).toBe(8)
    expect(decl('[!note]')!.markerTo).toBe(7)
    // 标题首字符偏移 = 声明后跳过空白
    const d = decl('[!note]   多空格标题')!
    expect(d.title).toBe('多空格标题')
  })
})

describe('calloutDefaultTitle：默认标题派生（Obsidian 1.14.4 app.js 实测口径）', () => {
  it('type trim → 连字号换空格 → 小写 → 首字母大写', () => {
    expect(calloutDefaultTitle('note')).toBe('Note')
    expect(calloutDefaultTitle('NoTe')).toBe('Note')
    expect(calloutDefaultTitle('custom-question')).toBe('Custom question')
    expect(calloutDefaultTitle('faq')).toBe('Faq')
  })
})

describe('类型注册表（T02 只登记 note；结构为 T03 全类型预留）', () => {
  it('note 条目在场，携带 CSS 变量与图标名（T03/T06 消费字段）', () => {
    expect(CALLOUT_TYPES.map((entry) => entry.id)).toEqual(['note'])
    const note = CALLOUT_TYPES[0]!
    expect(note.colorVariable).toBe('--callout-default')
    expect(note.icon).toBe('lucide-pencil')
  })

  it('calloutTypeOf：note 命中注册条目；未知类型回落 note 外观但保留原标识语义', () => {
    expect(calloutTypeOf('note').id).toBe('note')
    expect(calloutTypeOf('NOTE').id).toBe('note')
    const unknown = calloutTypeOf('custom-x')
    expect(unknown.id).toBe(CALLOUT_FALLBACK_TYPE)
    expect(unknown.knownType).toBe(false)
    expect(calloutTypeOf('note').knownType).toBe(true)
  })
})
