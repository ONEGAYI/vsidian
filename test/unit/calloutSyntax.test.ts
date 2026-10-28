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

describe('类型注册表（T03 全类型登记；数据源 obsidian-1144-callout-defaults.json）', () => {
  it('帮助页口径 13 规范类型逐项在场（顺序固定，T05 菜单消费）', () => {
    expect(CALLOUT_TYPES.map((entry) => entry.id)).toEqual([
      'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
      'warning', 'failure', 'danger', 'bug', 'example', 'quote',
    ])
  })

  it('14 别名按帮助页归类（important 归 tip；摘要三态/成败三态/红三义等）', () => {
    const byId = new Map(CALLOUT_TYPES.map((e) => [e.id, e]))
    expect(byId.get('abstract')!.aliases).toEqual(['summary', 'tldr'])
    expect(byId.get('tip')!.aliases).toEqual(['hint', 'important'])
    expect(byId.get('success')!.aliases).toEqual(['check', 'done'])
    expect(byId.get('question')!.aliases).toEqual(['help', 'faq'])
    expect(byId.get('warning')!.aliases).toEqual(['caution', 'attention'])
    expect(byId.get('failure')!.aliases).toEqual(['fail', 'missing'])
    expect(byId.get('danger')!.aliases).toEqual(['error'])
    expect(byId.get('quote')!.aliases).toEqual(['cite'])
    expect(byId.get('note')!.aliases).toEqual([])
    // 全表别名总数 = 14（票面口径）
    expect(CALLOUT_TYPES.flatMap((e) => e.aliases)).toHaveLength(14)
  })

  it('CSS 变量名按 app.css 取证：abstract→summary / failure→fail / danger→error 形态', () => {
    const byId = new Map(CALLOUT_TYPES.map((e) => [e.id, e]))
    expect(byId.get('note')!.colorVariable).toBe('--callout-default')
    expect(byId.get('abstract')!.colorVariable).toBe('--callout-summary')
    expect(byId.get('info')!.colorVariable).toBe('--callout-info')
    expect(byId.get('todo')!.colorVariable).toBe('--callout-todo')
    expect(byId.get('tip')!.colorVariable).toBe('--callout-tip')
    expect(byId.get('success')!.colorVariable).toBe('--callout-success')
    expect(byId.get('question')!.colorVariable).toBe('--callout-question')
    expect(byId.get('warning')!.colorVariable).toBe('--callout-warning')
    expect(byId.get('failure')!.colorVariable).toBe('--callout-fail')
    expect(byId.get('danger')!.colorVariable).toBe('--callout-error')
    expect(byId.get('bug')!.colorVariable).toBe('--callout-bug')
    expect(byId.get('example')!.colorVariable).toBe('--callout-example')
    expect(byId.get('quote')!.colorVariable).toBe('--callout-quote')
  })

  it('图标名按取证照录（help-circle 无前缀、quote-glyph 内部名照登记）', () => {
    const byId = new Map(CALLOUT_TYPES.map((e) => [e.id, e]))
    expect(byId.get('note')!.icon).toBe('lucide-pencil')
    expect(byId.get('abstract')!.icon).toBe('lucide-clipboard-list')
    expect(byId.get('info')!.icon).toBe('lucide-info')
    expect(byId.get('todo')!.icon).toBe('lucide-check-circle-2')
    expect(byId.get('tip')!.icon).toBe('lucide-flame')
    expect(byId.get('success')!.icon).toBe('lucide-check')
    expect(byId.get('question')!.icon).toBe('help-circle')
    expect(byId.get('warning')!.icon).toBe('lucide-alert-triangle')
    expect(byId.get('failure')!.icon).toBe('lucide-x')
    expect(byId.get('danger')!.icon).toBe('lucide-zap')
    expect(byId.get('bug')!.icon).toBe('lucide-bug')
    expect(byId.get('example')!.icon).toBe('lucide-list')
    expect(byId.get('quote')!.icon).toBe('quote-glyph')
  })

  it('calloutTypeOf：全部别名命中所属规范条目，大小写不敏感', () => {
    for (const [alias, id] of [
      ['summary', 'abstract'], ['tldr', 'abstract'], ['hint', 'tip'],
      ['check', 'success'], ['done', 'success'], ['help', 'question'],
      ['faq', 'question'], ['caution', 'warning'], ['attention', 'warning'],
      ['fail', 'failure'], ['missing', 'failure'], ['error', 'danger'],
      ['cite', 'quote'],
    ] as const) {
      expect(calloutTypeOf(alias).id, alias).toBe(id)
      expect(calloutTypeOf(alias).knownType, alias).toBe(true)
    }
    expect(calloutTypeOf('SuMmArY').id).toBe('abstract')
  })

  it('important 双面归属：语法归类 tip（帮助页），CSS 变量独立 --callout-important', () => {
    const important = calloutTypeOf('important')
    expect(important.id).toBe('tip')
    expect(important.colorVariable).toBe('--callout-important')
    expect(important.icon).toBe('lucide-flame') // 图标与 tip 同（取证）
    expect(calloutTypeOf('IMPORTANT').colorVariable).toBe('--callout-important')
    // 归类条目本体不受覆盖影响
    expect(calloutTypeOf('tip').colorVariable).toBe('--callout-tip')
    expect(calloutTypeOf('hint').colorVariable).toBe('--callout-tip')
  })

  it('calloutTypeOf：note 命中注册条目；未知类型回落 note 外观但保留原标识语义', () => {
    expect(calloutTypeOf('note').id).toBe('note')
    expect(calloutTypeOf('NOTE').id).toBe('note')
    const unknown = calloutTypeOf('custom-x')
    expect(unknown.id).toBe(CALLOUT_FALLBACK_TYPE)
    expect(unknown.knownType).toBe(false)
    expect(calloutTypeOf('note').knownType).toBe(true)
  })

  it('默认标题矩阵：全类型与别名按原标识派生（含连字号、Faq/Custom-question 口径）', () => {
    expect(calloutDefaultTitle('tldr')).toBe('Tldr')
    expect(calloutDefaultTitle('faq')).toBe('Faq')
    expect(calloutDefaultTitle('important')).toBe('Important')
    expect(calloutDefaultTitle('custom-question')).toBe('Custom question')
    expect(calloutDefaultTitle('quote')).toBe('Quote')
    // 全部内置类型可派生非空标题
    for (const entry of CALLOUT_TYPES) {
      expect(calloutDefaultTitle(entry.id), entry.id).toMatch(/^[A-Z]/)
    }
  })
})
