// #541 T01 / #542 T02 附加组件粘贴规则——共享声明、校验、排序与快照守卫的契约测试。
//
// 覆盖票面验收的失败用例面：命中/不命中形状（校验矩阵）、缺属性、
// 非法 URL 声明（url 槽形态）、冲突顺序（确定性排序）、批内重复 ID、
// 超预算、未实现高级节点（顶层 condition / match.regex / output.nested
// 等未知字段）的显式拒绝；T02 追加正则（编译/组引用/flags）、条件
//（all/any/not、空组合、深度与节点预算）与嵌套规则（局部 ID、深度、
// 总量并入 256 预算）的校验矩阵与常量钉住。
import { describe, expect, it } from 'vitest'
import {
  ADDON_PASTE_RULES_CONDITION_NODES_LIMIT,
  ADDON_PASTE_RULES_EVAL_STEP_BUDGET,
  ADDON_PASTE_RULES_MAX_DEPTH,
  ADDON_PASTE_RULES_MAX_PER_ADDON,
  ADDON_PASTE_RULES_REGEX_INPUT_LIMIT,
  ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT,
  addonPasteRegexGroupInfo,
  isAddonPasteRulesSnapshot,
  orderAddonPasteRules,
  parseAddonPasteTemplate,
  validateAddonPasteRuleDeclarations,
  type AddonPasteCondition,
  type AddonPasteNestedRule,
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
    // T02 追加预算（规格 §4.4「常量须集中定义并测试边界」）
    expect(ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT).toBe(1024)
    expect(ADDON_PASTE_RULES_REGEX_INPUT_LIMIT).toBe(4096)
    expect(ADDON_PASTE_RULES_CONDITION_NODES_LIMIT).toBe(64)
  })
})

// ---------------------------------------------------------------------------
// #542 T02：正则、条件与嵌套声明的校验矩阵
// ---------------------------------------------------------------------------

/** T02 最小正则槽声明（元素文本 → 捕获组） */
const regexSlotDeclaration = (group: number | string, pattern = '^(?<no>\\d+)-(?<name>\\w+)$') => ({
  id: 'regex-slot',
  match: { tag: 'SPAN' },
  output: {
    kind: 'template',
    template: '{{v}}',
    slots: {
      v: { source: { kind: 'text-regex' as const, regex: { pattern, flags: 'i' }, group } },
    },
  },
})

/** T02 最小条件声明（all 组合基础谓词与正则谓词） */
const conditionDeclaration = (condition: unknown) => ({
  id: 'cond',
  match: { tag: 'SPAN', condition },
  output: { kind: 'discard' },
})

/** T02 最小嵌套声明（children 槽携带子规则集） */
const nestedDeclaration = (rules: unknown) => ({
  id: 'outer',
  match: { tag: 'DIV' },
  output: {
    kind: 'template',
    template: '> {{body}}',
    slots: { body: { source: { kind: 'children' as const, ...(rules === undefined ? {} : { rules }) } } },
  },
})

describe('T02 正则声明校验', () => {
  it('接受合法 text-regex 槽：数字捕获组与命名组；组 0 为整匹', () => {
    for (const group of [0, 1, 2, 'no', 'name']) {
      const result = validateAddonPasteRuleDeclarations([regexSlotDeclaration(group)])
      expect(result.ok, `group=${String(group)}`).toBe(true)
    }
  })

  it('接受 attribute-regex 槽（受限 flags 各合法组合；无 flags 合法）', () => {
    for (const flags of [undefined, '', 'i', 'm', 's', 'u', 'imsu']) {
      const declaration = {
        id: 'attr-regex',
        match: { tag: 'SPAN' },
        output: {
          kind: 'template',
          template: '{{v}}',
          slots: {
            v: {
              source: {
                kind: 'text-regex' as const,
                regex: { pattern: 'a', ...(flags === undefined ? {} : { flags }) },
                group: 0,
              },
            },
          },
        },
      }
      const result = validateAddonPasteRuleDeclarations([declaration])
      expect(result.ok, `flags=${String(flags)}`).toBe(true)
    }
  })

  it('捕获组探测：组数与命名组集合（注册校验与求值同源）', () => {
    expect(addonPasteRegexGroupInfo('^(?<no>\\d+)-(?<name>\\w+)$')).toEqual({
      count: 2,
      names: new Set(['no', 'name']),
    })
    expect(addonPasteRegexGroupInfo('abc')).toEqual({ count: 0, names: new Set() })
    expect(addonPasteRegexGroupInfo('(')).toBeNull()
  })

  it.each([
    ['pattern 缺失', regexSlotDeclaration(0, '')],
    ['pattern 非字符串', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 1 }, group: 0 } } } } }],
    ['pattern 超长', regexSlotDeclaration(0, `a{${'x'.repeat(ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT)}}`)],
    ['pattern 不可编译', regexSlotDeclaration(0, '(')],
    ['flags 含 g（有状态 lastIndex）', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a', flags: 'g' }, group: 0 } } } } }],
    ['flags 含 y', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a', flags: 'y' }, group: 0 } } } } }],
    ['flags 重复字符', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a', flags: 'ii' }, group: 0 } } } } }],
    ['flags 未知字符', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a', flags: 'x' }, group: 0 } } } } }],
    ['flags 非字符串', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a', flags: 1 }, group: 0 } } } } }],
    ['group 负数', regexSlotDeclaration(-1)],
    ['group 非整数', regexSlotDeclaration(1.5)],
    ['group 超出捕获组数', regexSlotDeclaration(3)],
    ['命名组未在 pattern 声明', regexSlotDeclaration('missing')],
    ['命名组名非法', regexSlotDeclaration('1bad')],
    ['group 非数字非字符串', regexSlotDeclaration(true as unknown as number)],
    ['regex 带未知字段', { ...regexSlotDeclaration(0), output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a', trim: true }, group: 0 } } } } }],
    ['text-regex 槽缺 group', { id: 'x', match: { tag: 'SPAN' }, output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: 'a' } } } } } }],
    ['attribute-regex 缺属性名', { id: 'x', match: { tag: 'SPAN' }, output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'attribute-regex', regex: { pattern: 'a' }, group: 0 } } } } }],
  ])('整批拒绝：%s', (_name, declaration) => {
    const result = validateAddonPasteRuleDeclarations([declaration as unknown])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-declaration')
  })
})

describe('T02 条件声明校验', () => {
  it('接受 all/any/not 组合基础谓词与正则谓词', () => {
    const condition: AddonPasteCondition = {
      all: [
        { kind: 'attribute', name: 'data-kind', value: 'card' },
        { any: [
          { kind: 'attribute-regex', name: 'data-src', regex: { pattern: '^https://' } },
          { not: { kind: 'text-regex', regex: { pattern: '^\\s*$' } } },
        ] },
      ],
    }
    const result = validateAddonPasteRuleDeclarations([conditionDeclaration(condition)])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rules[0]!.match.condition).toEqual(condition)
  })

  it('条件深度至多 16：16 层嵌套接受，17 层拒绝', () => {
    const nest = (depth: number): unknown =>
      depth === 0 ? { kind: 'attribute', name: 'data-x' } : { not: nest(depth - 1) }
    expect(validateAddonPasteRuleDeclarations([conditionDeclaration(nest(16))]).ok).toBe(true)
    expect(validateAddonPasteRuleDeclarations([conditionDeclaration(nest(17))]).ok).toBe(false)
  })

  it('条件节点总数至多 64：64 个叶子接受，65 个拒绝', () => {
    const leaves = (count: number) => Array.from({ length: count }, () => ({ kind: 'attribute', name: 'data-x' }))
    expect(validateAddonPasteRuleDeclarations([conditionDeclaration({ all: leaves(ADDON_PASTE_RULES_CONDITION_NODES_LIMIT) })]).ok).toBe(true)
    expect(validateAddonPasteRuleDeclarations([conditionDeclaration({ all: leaves(ADDON_PASTE_RULES_CONDITION_NODES_LIMIT + 1) })]).ok).toBe(false)
  })

  it.each([
    ['空 all 组合', { all: [] }],
    ['空 any 组合', { any: [] }],
    ['not 接数组', { not: [{ kind: 'attribute', name: 'x' }] }],
    ['not 缺节点', { not: undefined }],
    ['组合键多于一个', { all: [{ kind: 'attribute', name: 'x' }], any: [{ kind: 'attribute', name: 'y' }] }],
    ['未知条件节点（字符串）', { all: ['yes'] }],
    ['未知条件节点（空对象，防隐式真值）', { all: [{}] }],
    ['未知谓词 kind', { all: [{ kind: 'magic' }] }],
    ['谓词未知字段', { all: [{ kind: 'attribute', name: 'x', invert: true }] }],
    ['attribute-regex 谓词缺 regex', { all: [{ kind: 'attribute-regex', name: 'x' }] }],
    ['text-regex 谓词未知字段', { all: [{ kind: 'text-regex', regex: { pattern: 'a' }, name: 'x' }] }],
    ['all 非数组', { all: { kind: 'attribute', name: 'x' } }],
  ])('整批拒绝：%s', (_name, condition) => {
    const result = validateAddonPasteRuleDeclarations([conditionDeclaration(condition)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-declaration')
  })
})

describe('T02 嵌套规则声明校验', () => {
  const nestedRule = (id: string) => ({
    id,
    match: { tag: 'SPAN', attributes: [{ name: 'data-inner' }] },
    output: { kind: 'template', template: '`{{t}}`', slots: { t: { source: { kind: 'text' } } } },
  })

  it('接受 children 槽携带子规则集（规则语言同形）', () => {
    const result = validateAddonPasteRuleDeclarations([nestedDeclaration([nestedRule('inner-link')])])
    expect(result.ok).toBe(true)
    if (result.ok) {
      const source = (result.rules[0]!.output as unknown as { slots: { body: { source: { kind: string; rules?: unknown[] } } } }).slots.body.source
      expect(source.kind).toBe('children')
      expect(source.rules).toEqual([{
        id: 'inner-link',
        priority: 0,
        match: { tag: 'SPAN', attributes: [{ name: 'data-inner' }] },
        output: nestedRule('inner-link').output,
      }])
    }
  })

  it('嵌套深度至多 16：16 层接受，17 层拒绝（只能向子节点下降）', () => {
    const chain = (depth: number): unknown => depth === 0 ? nestedRule('leaf') : {
      id: `level-${depth}`,
      match: { tag: 'DIV' },
      output: { kind: 'template', template: '{{body}}', slots: { body: { source: { kind: 'children', rules: [chain(depth - 1)] } } } },
    }
    // 顶层 1 层 + 嵌套 15 层 = 深度 16
    expect(validateAddonPasteRuleDeclarations([chain(15)]).ok).toBe(true)
    expect(validateAddonPasteRuleDeclarations([chain(16)]).ok).toBe(false)
  })

  it('嵌套规则 ID 为槽内局部：不同集合可重名，同集合重复拒绝', () => {
    // 同一顶层规则的两个 children 槽各带同名子规则——不同集合，接受
    const twin = {
      id: 'twin',
      match: { tag: 'DIV' },
      output: {
        kind: 'template',
        template: '{{a}}{{b}}',
        slots: {
          a: { source: { kind: 'children' as const, rules: [nestedRule('same')] } },
          b: { source: { kind: 'children' as const, rules: [nestedRule('same')] } },
        },
      },
    }
    expect(validateAddonPasteRuleDeclarations([twin]).ok).toBe(true)
    // 同一集合内重复拒绝
    expect(validateAddonPasteRuleDeclarations([nestedDeclaration([nestedRule('x'), nestedRule('x')])]).ok).toBe(false)
    // 嵌套 ID 与顶层 ID 同名不冲突（局部命名空间）
    expect(validateAddonPasteRuleDeclarations([nestedDeclaration([nestedRule('outer')])]).ok).toBe(true)
  })

  it('规则总量并入 256 预算：254 顶层 + 外层 + 嵌套共 256 条接受，255 顶层 + 外层 + 嵌套共 257 条拒绝', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => ({
      id: `top-${i}`,
      match: { tag: 'SPAN' },
      output: { kind: 'discard' },
    }))
    const withNested = [...many(ADDON_PASTE_RULES_MAX_PER_ADDON - 2), nestedDeclaration([nestedRule('inner')])]
    expect(validateAddonPasteRuleDeclarations(withNested).ok).toBe(true)
    // 顶层批量长度 256 通过入口检查，但嵌套子规则使总量达到 257 → too-many
    const over = [...many(ADDON_PASTE_RULES_MAX_PER_ADDON - 1), nestedDeclaration([nestedRule('inner')])]
    expect(validateAddonPasteRuleDeclarations(over)).toMatchObject({ ok: false, reason: 'too-many' })
  })

  it.each([
    ['rules 非数组', nestedDeclaration('x')],
    ['嵌套规则非对象', nestedDeclaration([42])],
    ['嵌套规则未知字段', nestedDeclaration([{ ...nestedRule('x'), note: 1 }])],
    ['嵌套规则非法声明', nestedDeclaration([{ id: 'x', match: { tag: 'SP AN' }, output: { kind: 'discard' } }])],
    ['嵌套规则非法正则', nestedDeclaration([{ id: 'x', match: { tag: 'SPAN' }, output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'text-regex', regex: { pattern: '(' }, group: 0 } } } } }])],
    ['children 带未知字段', { id: 'x', match: { tag: 'DIV' }, output: { kind: 'template', template: '{{b}}', slots: { b: { source: { kind: 'children', depth: 2 } } } } }],
    ['children 槽 url 语义仍拒绝', { id: 'x', match: { tag: 'DIV' }, output: { kind: 'template', template: '{{b}}', slots: { b: { source: { kind: 'children', rules: [nestedRule('x')] }, url: true } } } }],
  ])('整批拒绝：%s', (_name, declaration) => {
    const result = validateAddonPasteRuleDeclarations([declaration as unknown])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-declaration')
  })
})

describe('T02 快照守卫与嵌套排序', () => {
  const ruleWithAdvanced = (): AddonPasteRule => ({
    addonId: 'a.addon',
    id: 'advanced',
    priority: 0,
    match: {
      tag: 'SPAN',
      condition: { all: [{ kind: 'attribute-regex', name: 'data-src', regex: { pattern: '^https://' } }] },
    },
    output: {
      kind: 'template',
      template: '{{u}}',
      slots: {
        u: { source: { kind: 'attribute-regex', name: 'data-src', regex: { pattern: '^(?<u>https://\\S+)$', flags: 'i' }, group: 'u' }, url: true },
      },
    },
  })

  it('接受携带条件与正则槽的合法快照', () => {
    expect(isAddonPasteRulesSnapshot({ version: 1, rules: [ruleWithAdvanced()] })).toBe(true)
  })

  it.each([
    ['条件空组合', { version: 1, rules: [{ ...ruleWithAdvanced(), match: { tag: 'SPAN', condition: { all: [] } } }] }],
    ['正则槽缺 group', { version: 1, rules: [{ ...ruleWithAdvanced(), output: { kind: 'template', template: '{{u}}', slots: { u: { source: { kind: 'attribute-regex', name: 'data-src', regex: { pattern: 'a' } }, url: true } } } }] }],
    ['group 类型非法', { version: 1, rules: [{ ...ruleWithAdvanced(), output: { kind: 'template', template: '{{u}}', slots: { u: { source: { kind: 'text-regex', regex: { pattern: 'a' }, group: true }, url: true } } } }] }],
    ['嵌套规则缺 match', { version: 1, rules: [{ addonId: 'a', id: 'x', priority: 0, match: { tag: 'DIV' }, output: { kind: 'template', template: '{{b}}', slots: { b: { source: { kind: 'children', rules: [{ id: 'n', priority: 0, output: { kind: 'discard' } }] } } } } }] }],
    ['嵌套深度超限（敌意载荷）', { version: 1, rules: [deepHostileRule(ADDON_PASTE_RULES_MAX_DEPTH + 1)] }],
  ])('拒绝：%s', (_name, value) => {
    expect(isAddonPasteRulesSnapshot(value)).toBe(false)
  })

  it('嵌套子规则集按优先级降序、ID 升序递归排序（页面求值同源）', () => {
    const mk = (id: string, priority: number): AddonPasteNestedRule => ({
      id, priority,
      match: { tag: 'SPAN' },
      output: { kind: 'template', template: `[${id}]`, slots: {} },
    })
    const outer: AddonPasteRule = {
      addonId: 'a.addon',
      id: 'outer',
      priority: 0,
      match: { tag: 'DIV' },
      output: {
        kind: 'template',
        template: '{{b}}',
        slots: { b: { source: { kind: 'children', rules: [mk('r2', 0), mk('r0', 1), mk('r1', 0)] } } },
      },
    }
    const ordered = orderAddonPasteRules([outer])
    const source = (ordered[0]!.output as unknown as { slots: { b: { source: { rules?: readonly AddonPasteNestedRule[] } } } }).slots.b.source
    expect(source.rules?.map((rule) => rule.id)).toEqual(['r0', 'r1', 'r2'])
    // 输入乱序不影响结果（确定性）
    expect(orderAddonPasteRules([outer])[0]).toEqual(ordered[0])
  })
})

/** 敌意深嵌套载荷构造（守卫深度上限拦截） */
function deepHostileRule(depth: number): unknown {
  const leaf = { addonId: 'a', id: 'leaf', priority: 0, match: { tag: 'SPAN' }, output: { kind: 'discard' } }
  let current: unknown = leaf
  for (let i = 0; i < depth; i++) {
    current = {
      addonId: 'a', id: `hostile-${i}`, priority: 0, match: { tag: 'DIV' },
      output: { kind: 'template', template: '{{b}}', slots: { b: { source: { kind: 'children', rules: [current] } } } },
    }
  }
  return current
}

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
