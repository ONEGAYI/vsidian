// #541 T01 附加组件粘贴规则——共享声明、校验、排序与快照守卫的契约测试。
//
// 覆盖票面验收的失败用例面：命中/不命中形状（校验矩阵）、缺属性、
// 非法 URL 声明（url 槽形态）、冲突顺序（确定性排序）、批内重复 ID、
// 超预算、未实现高级节点（正则/条件/嵌套字段）的显式拒绝。
import { describe, expect, it } from 'vitest'
import {
  ADDON_PASTE_RULES_EVAL_STEP_BUDGET,
  ADDON_PASTE_RULES_MAX_DEPTH,
  ADDON_PASTE_RULES_MAX_PER_ADDON,
  isAddonPasteRulesSnapshot,
  orderAddonPasteRules,
  parseAddonPasteTemplate,
  validateAddonPasteRuleDeclarations,
  type AddonPasteRule,
} from '../../src/shared/addonPasteRules'

/** 模板规则声明构建器（减少深层嵌套字面量的括号配平失误） */
const templateRule = (id: string, template: string, slots: Record<string, unknown>): unknown => ({
  id,
  match: { tag: 'SPAN' },
  output: { kind: 'template', template, slots },
})

/** 最小合法声明（Codex 形态样例：来源特化 span → Markdown 链接） */
const linkDeclaration = () => ({
  id: 'prompt-link',
  match: {
    tag: 'span',
    attributes: [
      { name: 'data-prompt-link-url', value: 'https://example.com/a' },
      { name: 'data-prompt-link-kind' },
    ],
  },
  output: {
    kind: 'template',
    template: '[{{label}}]({{url}})',
    slots: {
      label: { source: { kind: 'text' } },
      url: { source: { kind: 'attribute', name: 'data-prompt-link-url' }, url: true },
    },
  },
})

describe('粘贴规则声明校验', () => {
  it('接受最小合法声明并规整（标签大写、缺省优先级 0、属性条件保序）', () => {
    const result = validateAddonPasteRuleDeclarations([linkDeclaration()])
    expect(result).toEqual({
      ok: true,
      rules: [{
        id: 'prompt-link',
        priority: 0,
        match: {
          tag: 'SPAN',
          attributes: [
            { name: 'data-prompt-link-url', value: 'https://example.com/a' },
            { name: 'data-prompt-link-kind' },
          ],
        },
        output: linkDeclaration().output,
      }],
    })
  })

  it('接受显式丢弃声明（无模板与槽）与负优先级', () => {
    const result = validateAddonPasteRuleDeclarations([{
      id: 'drop-chrome',
      priority: -3,
      match: { tag: 'SPAN', attributes: [{ name: 'data-copy-button' }] },
      output: { kind: 'discard' },
    }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rules[0]!.priority).toBe(-3)
      expect(result.rules[0]!.output).toEqual({ kind: 'discard' })
    }
  })

  it.each([-10001, 10001, 100001])('接受规格允许的整数优先级 %i，不另设量级上限', (priority) => {
    const result = validateAddonPasteRuleDeclarations([{ ...linkDeclaration(), priority }])
    expect(result).toMatchObject({ ok: true, rules: [{ priority }] })
  })

  it('接受显式声明的 constructor 槽', () => {
    const declaration = templateRule('own-slot', '{{constructor}}', { constructor: { source: { kind: 'text' } } })
    expect(validateAddonPasteRuleDeclarations([declaration]).ok).toBe(true)
  })

  it('缺失与空字符串区分：属性值空串是合法条件值，缺失 value 才是存在性条件', () => {
    const result = validateAddonPasteRuleDeclarations([{
      id: 'empty-ok',
      match: { tag: 'SPAN', attributes: [{ name: 'data-x', value: '' }] },
      output: { kind: 'discard' },
    }])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rules[0]!.match.attributes![0]).toEqual({ name: 'data-x', value: '' })
  })

  it.each([
    ['声明非对象', [42]],
    ['声明缺 id', [{ match: { tag: 'SPAN' }, output: { kind: 'discard' } }]],
    ['id 非法字符', [{ ...linkDeclaration(), id: 'bad id' }]],
    ['id 含点号伪造跨组件身份', [{ ...linkDeclaration(), id: 'other.addon#x' }]],
    ['优先级非整数', [{ ...linkDeclaration(), priority: 1.5 }]],
    ['优先级非有限数', [{ ...linkDeclaration(), priority: Infinity }]],
    ['未知顶层字段', [{ ...linkDeclaration(), note: 'x' }]],
    ['match 缺标签', [{ id: 'a', match: {}, output: { kind: 'discard' } }]],
    ['标签名非法', [{ id: 'a', match: { tag: 'SP AN' }, output: { kind: 'discard' } }]],
    ['属性名含引号', [{ id: 'a', match: { tag: 'SPAN', attributes: [{ name: 'data-"x"' }] }, output: { kind: 'discard' } }]],
    ['属性条件带未知字段', [{ id: 'a', match: { tag: 'SPAN', attributes: [{ name: 'x', regex: '.' }] }, output: { kind: 'discard' } }]],
    ['属性条件数超限', [{ id: 'a', match: { tag: 'SPAN', attributes: Array.from({ length: 9 }, (_, i) => ({ name: `data-${i}` })) }, output: { kind: 'discard' } }]],
    ['产出 kind 未知（未知操作）', [{ id: 'a', match: { tag: 'SPAN' }, output: { kind: 'drop' } }]],
    ['模板缺失', [{ id: 'a', match: { tag: 'SPAN' }, output: { kind: 'template', slots: {} } }]],
    ['模板空串', [{ id: 'a', match: { tag: 'SPAN' }, output: { kind: 'template', template: '', slots: {} } }]],
    ['模板引用未定义槽', [{ id: 'a', match: { tag: 'SPAN' }, output: { kind: 'template', template: '{{miss}}', slots: {} } }]],
    ['模板引用继承的 constructor 而未声明槽', [templateRule('inherited-constructor', '{{constructor}}', {})]],
    ['模板引用继承的 toString 而未声明槽', [templateRule('inherited-tostring', '{{toString}}', {})]],
    ['模板槽未被引用', [linkDeclaration(), {
      id: 'b', match: { tag: 'SPAN' },
      output: { kind: 'template', template: 'x', slots: { unused: { source: { kind: 'text' } } } },
    }]],
    ['模板残留未闭合花括号', [templateRule('unclosed', '{{label', { label: { source: { kind: 'text' } } })]],
    ['模板槽名非法', [templateRule('bad-slot-name', '{{1bad}}', { '1bad': { source: { kind: 'text' } } })]],
    ['槽来源 kind 未知', [templateRule('script-source', '{{x}}', { x: { source: { kind: 'script' } } })]],
    ['attribute 来源缺名', [templateRule('attr-unnamed', '{{x}}', { x: { source: { kind: 'attribute' } } })]],
    ['url 槽接 children 来源（无 URL 语义）', [templateRule('url-children', '{{x}}', { x: { source: { kind: 'children' }, url: true } })]],
    ['槽带未知字段', [templateRule('slot-extra-field', '{{x}}', { x: { source: { kind: 'text' }, escape: false } })]],
    ['来源带未知字段', [templateRule('source-extra-field', '{{x}}', { x: { source: { kind: 'text', trim: true } } })]],
  ])('整批拒绝：%s', (_name, declarations) => {
    const result = validateAddonPasteRuleDeclarations(declarations as readonly unknown[])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-declaration')
      expect(typeof result.detail).toBe('string')
    }
  })

  it('未实现的高级节点显式拒绝：match.regex / 顶层 condition / output.nested 不被静默当成基础声明', () => {
    for (const declaration of [
      { ...linkDeclaration(), match: { ...linkDeclaration().match, regex: { pattern: 'a', flags: '' } } },
      { ...linkDeclaration(), condition: { all: [] } },
      { ...linkDeclaration(), output: { ...linkDeclaration().output, nested: 'children-rules' } as unknown },
    ]) {
      const result = validateAddonPasteRuleDeclarations([declaration])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('invalid-declaration')
    }
  })

  it('批内 ID 重复整批拒绝（不部分安装）', () => {
    const result = validateAddonPasteRuleDeclarations([linkDeclaration(), { ...linkDeclaration(), match: { tag: 'DIV' } }])
    expect(result).toMatchObject({ ok: false, reason: 'duplicate-id' })
  })

  it('与已登记 ID 重复拒绝（上下文注入现有 ID 集）', () => {
    const result = validateAddonPasteRuleDeclarations([linkDeclaration()], { existingIds: new Set(['prompt-link']) })
    expect(result).toMatchObject({ ok: false, reason: 'duplicate-id' })
  })

  it('超预算声明整批拒绝：每组件至多 256 条', () => {
    const many = Array.from({ length: ADDON_PASTE_RULES_MAX_PER_ADDON + 1 }, (_, i) => ({
      id: `rule-${i}`,
      match: { tag: 'SPAN' },
      output: { kind: 'discard' },
    }))
    expect(validateAddonPasteRuleDeclarations(many)).toMatchObject({ ok: false, reason: 'too-many' })
    // 现有计数参与判定：已登记 1 条时 256 条新声明同样越界
    expect(validateAddonPasteRuleDeclarations(many.slice(0, ADDON_PASTE_RULES_MAX_PER_ADDON), {
      currentCount: 1,
    })).toMatchObject({ ok: false, reason: 'too-many' })
    // 边界值本身合法
    expect(validateAddonPasteRuleDeclarations(many.slice(0, ADDON_PASTE_RULES_MAX_PER_ADDON)).ok).toBe(true)
  })

  it('预算常量集中定义（宿主与页面同源取值）', () => {
    expect(ADDON_PASTE_RULES_MAX_PER_ADDON).toBe(256)
    expect(ADDON_PASTE_RULES_MAX_DEPTH).toBe(16)
    expect(ADDON_PASTE_RULES_EVAL_STEP_BUDGET).toBe(100_000)
  })
})

describe('粘贴规则确定性排序', () => {
  const rule = (addonId: string, id: string, priority: number): AddonPasteRule =>
    ({ addonId, id, priority, match: { tag: 'SPAN' }, output: { kind: 'discard' } })

  it('优先级降序、组件稳定 ID 升序、规则稳定 ID 升序；缺省优先级 0', () => {
    const ordered = orderAddonPasteRules([
      rule('b.addon', 'r1', 0),
      rule('a.addon', 'r2', 0),
      rule('a.addon', 'r1', 0),
      rule('z.addon', 'r9', 10),
      rule('a.addon', 'r0', -1),
    ])
    expect(ordered.map((r) => [r.addonId, r.id])).toEqual([
      ['z.addon', 'r9'],
      ['a.addon', 'r1'],
      ['a.addon', 'r2'],
      ['b.addon', 'r1'],
      ['a.addon', 'r0'],
    ])
  })

  it('不依赖输入顺序（装载顺序不影响粘贴结果）', () => {
    const rules = [rule('a', 'x', 1), rule('b', 'y', 1), rule('c', 'z', 2)]
    expect(orderAddonPasteRules([...rules].reverse())).toEqual(orderAddonPasteRules(rules))
  })
})

describe('粘贴模板解析', () => {
  it('字面与槽引用切分', () => {
    expect(parseAddonPasteTemplate('[{{label}}]({{url}})')).toEqual([
      { literal: '[' },
      { slot: 'label' },
      { literal: '](' },
      { slot: 'url' },
      { literal: ')' },
    ])
  })

  it('同一槽可多次引用', () => {
    expect(parseAddonPasteTemplate('{{x}}={{x}}')).toEqual([
      { slot: 'x' }, { literal: '=' }, { slot: 'x' },
    ])
  })

  it('非法引用形态返回 null（花括号残留/槽名非法）', () => {
    expect(parseAddonPasteTemplate('{{label')).toBeNull()
    expect(parseAddonPasteTemplate('{{1bad}}')).toBeNull()
    expect(parseAddonPasteTemplate('{{ bad}}')).toBeNull()
  })
})

describe('快照载荷守卫', () => {
  const validSnapshot = () => ({
    version: 3,
    rules: [{ ...linkDeclaration(), addonId: 'a.addon', priority: 0 } as AddonPasteRule],
  })

  it('接受合法快照', () => {
    expect(isAddonPasteRulesSnapshot(validSnapshot())).toBe(true)
  })

  it.each([
    ['非对象', null],
    ['version 非整数', { ...validSnapshot(), version: 1.5 }],
    ['version 负数', { ...validSnapshot(), version: -1 }],
    ['rules 非数组', { ...validSnapshot(), rules: {} }],
    ['规则缺 addonId', { version: 1, rules: [{ id: 'x', priority: 0, match: { tag: 'SPAN' }, output: { kind: 'discard' } }] }],
    ['规则带非法模板', {
      version: 1,
      rules: [{ addonId: 'a', id: 'x', priority: 0, match: { tag: 'SPAN' }, output: { kind: 'template', template: '{{x', slots: { x: { source: { kind: 'text' } } } } }],
    }],
  ])('拒绝：%s', (_name, value) => {
    expect(isAddonPasteRulesSnapshot(value)).toBe(false)
  })
})
