// @vitest-environment jsdom
// #541 T01 / #542 T02 附加组件粘贴规则——htmlToMarkdown 消费链契约测试。
// 钉住票面验收：
// - 命中/不命中：来源特化 span 恢复链接；规则不匹配时回内置转换；
// - 缺属性（必需取值缺失）、非法 URL（safeUrl 拒绝）→ 本规则失败进入
//   下一条，全部未成功才回内置转换；
// - 冲突顺序：优先级降序、组件 ID 升序、规则 ID 升序确定性执行，首条
//   成功接管；单规则失败继续；
// - 不复活内置忽略元素（SCRIPT/STYLE 等先行生效）；
// - 邻接 strong/code/pre 按原格式转换（一处规则不破坏其他内容）；
// - 模板字面转义 / URL 槽走既有 safeUrl / children 槽不二次转义；
// - 显式丢弃算成功；模板空产出不算成功；
// - 转换成功参与 hasFormatting 判定；
// - 单次粘贴求值步数预算：超限停用规则，内置转换继续。
// T02 追加：正则捕获组（数字/命名/整匹、无匹配回退、捕获组未参与、
// 输入超限、URL 槽与转义）、条件（all/any/not 组合正则谓词、谓词假值
// 回退）、嵌套转换（子规则集、内置回退、内外规则不串味、嵌套标记与
// 表格上下文、运行时深链）与步计费扩展（条件节点与正则执行计入同一
// 预算，超限确定性停用）。
import { describe, expect, it, vi } from 'vitest'
import { htmlToMarkdown } from '../../src/webview/htmlToMarkdown'
import * as pasteRulesModule from '../../src/shared/addonPasteRules'
import {
  ADDON_PASTE_RULES_EVAL_STEP_BUDGET,
  ADDON_PASTE_RULES_REGEX_INPUT_LIMIT,
  type AddonPasteRule,
} from '../../src/shared/addonPasteRules'

const rule = (init: Partial<AddonPasteRule> & Pick<AddonPasteRule, 'id' | 'output'>): AddonPasteRule => ({
  addonId: 'fixture.demo',
  priority: 0,
  match: { tag: 'SPAN' },
  ...init,
})

/** Codex 形态：data-prompt-link-url span → Markdown 链接 */
const promptLinkRule = (override: Partial<AddonPasteRule> = {}): AddonPasteRule =>
  rule({
    id: 'prompt-link',
    match: { tag: 'SPAN', attributes: [{ name: 'data-prompt-link-url' }] },
    output: {
      kind: 'template',
      template: '[{{label}}]({{url}})',
      slots: {
        label: { source: { kind: 'text' } },
        url: { source: { kind: 'attribute', name: 'data-prompt-link-url' }, url: true },
      },
    },
    ...override,
  })

const convert = (html: string, rules: readonly AddonPasteRule[]) => htmlToMarkdown(html, { addonPasteRules: rules })

describe('粘贴规则转换：命中与回退', () => {
  it('命中：来源特化 span 恢复为可点击链接', () => {
    const result = convert(
      '<p><span data-prompt-link-url="https://example.com/a">查看</span></p>',
      [promptLinkRule()],
    )
    expect(result).toEqual({ markdown: '[查看](https://example.com/a)', hasFormatting: true })
  })

  it('不命中：无规则与规则不匹配都走内置转换', () => {
    const html = '<p><strong>粗</strong></p>'
    expect(convert(html, []).hasFormatting).toBe(true)
    expect(convert(html, []).markdown).toBe('**粗**')
    // 规则要求 data-prompt-link-url 属性——strong 不匹配也不受影响
    expect(convert(html, [promptLinkRule()]).markdown).toBe('**粗**')
  })

  it('缺属性：存在性条件不满足回内置；值不相等回内置', () => {
    const strict = rule({
      id: 'strict',
      match: { tag: 'SPAN', attributes: [{ name: 'data-kind', value: 'card' }] },
      output: { kind: 'discard' },
    })
    // 属性存在但值不等 → 不匹配 → 内置（span 无格式 → 纯文本文字）
    expect(convert('<p><span data-kind="other">文字</span></p>', [strict]).markdown).toBe('文字')
    // 属性缺失 → 不匹配
    expect(convert('<p><span>文字</span></p>', [strict]).markdown).toBe('文字')
    // 值相等（含空串语义区分）→ 命中丢弃
    expect(convert('<p><span data-kind="card">文字</span></p>', [strict]).markdown).toBe('')
    const emptyValue = rule({
      id: 'empty-value',
      match: { tag: 'SPAN', attributes: [{ name: 'data-empty', value: '' }] },
      output: { kind: 'discard' },
    })
    expect(convert('<p><span data-empty="">文字</span></p>', [emptyValue]).markdown).toBe('')
    expect(convert('<p><span>文字</span></p>', [emptyValue]).markdown).toBe('文字')
  })

  it('必需取值缺失：文本/属性/子内容空值时本规则失败回内置', () => {
    // url 属性在但 label 文本为空 → 必需取值缺失 → 回内置（span 纯文本）
    expect(convert('<p><span data-prompt-link-url="https://e.com/a"></span></p>', [promptLinkRule()]).markdown).toBe('')
    const attrRule = rule({
      id: 'attr-label',
      match: { tag: 'SPAN', attributes: [{ name: 'data-url' }] },
      output: {
        kind: 'template',
        template: '<{{v}}>',
        slots: { v: { source: { kind: 'attribute', name: 'data-missing' } } },
      },
    })
    expect(convert('<p><span data-url="x">文字</span></p>', [attrRule]).markdown).toBe('文字')
    const childrenRule = rule({
      id: 'children-wrap',
      match: { tag: 'SPAN' },
      output: {
        kind: 'template',
        template: '**{{body}}**',
        slots: { body: { source: { kind: 'children' } } },
      },
    })
    expect(convert('<p><span></span></p>', [childrenRule]).markdown).toBe('')
  })

  it('非法 URL：safeUrl 拒绝后本规则失败回内置（危险协议不能借规则绕过）', () => {
    const result = convert(
      '<p><span data-prompt-link-url="javascript:alert(1)">文字</span></p>',
      [promptLinkRule()],
    )
    expect(result.markdown).toBe('文字')
    expect(result.hasFormatting).toBe(false)
  })

  it('失败回退：首条失败继续尝试下一条，全部未成功才回内置', () => {
    const first = promptLinkRule({ id: 'a-first' })
    const second = rule({
      id: 'b-second',
      match: { tag: 'SPAN', attributes: [{ name: 'data-prompt-link-url' }] },
      output: {
        kind: 'template',
        template: '`{{label}}`',
        slots: { label: { source: { kind: 'text' } } },
      },
    })
    // 首条因 label 空失败（url 在但 text 空）→ 第二条同样需要 text……换一个
    // 可区分形态：首条要 data-kind=card（不满足），次条命中
    const cascade = [
      rule({
        id: 'needs-card',
        match: { tag: 'SPAN', attributes: [{ name: 'data-kind', value: 'card' }] },
        output: { kind: 'discard' },
      }),
      second,
    ]
    const result = convert('<p><span data-prompt-link-url="https://e.com/a">文字</span></p>', cascade)
    expect(result.markdown).toBe('`文字`')
    expect(result.hasFormatting).toBe(true)
    // 全部失败回内置
    expect(convert('<p><span data-kind="x">文字</span></p>', cascade).markdown).toBe('文字')
    void first
  })

  it('冲突顺序：优先级降序、组件 ID 升序、规则 ID 升序；首条成功接管', () => {
    const mk = (addonId: string, id: string, priority: number, mark: string): AddonPasteRule =>
      rule({
        addonId, id, priority,
        match: { tag: 'SPAN', attributes: [{ name: 'data-x' }] },
        output: { kind: 'template', template: mark, slots: {} },
      })
    const ordered = [
      mk('b.addon', 'r1', 0, '[B0]'),
      mk('a.addon', 'r2', 0, '[A2]'),
      mk('a.addon', 'r1', 0, '[A1]'),
      mk('z.addon', 'r9', 10, '[Z10]'),
      mk('a.addon', 'r0', -1, '[A-1]'),
    ]
    // 输入乱序：结果不依赖输入顺序
    expect(convert('<p><span data-x>文字</span></p>', [...ordered].reverse()).markdown).toBe('[Z10]')
    const noZ = ordered.filter((r) => r.id !== 'r9')
    expect(convert('<p><span data-x>文字</span></p>', [...noZ].reverse()).markdown).toBe('[A1]')
    const onlyB = [ordered[0]!, ordered[4]!]
    expect(convert('<p><span data-x>文字</span></p>', onlyB).markdown).toBe('[B0]')
  })
})

describe('粘贴规则转换：边界与既有管线兼容', () => {
  it('不复活内置忽略元素：SCRIPT/STYLE 上的规则不执行', () => {
    const anyScript = rule({
      id: 'script-revive',
      match: { tag: 'SCRIPT' },
      output: { kind: 'template', template: '泄露', slots: {} },
    })
    const result = convert('<p>文字</p><script>bad()</script><style>x{}</style>', [anyScript])
    expect(result.markdown).toBe('文字')
  })

  it('邻接 strong/code/pre 保持原格式转换（一处规则不破坏其他内容）', () => {
    const html = [
      '<p><strong>粗</strong> <code>a`b</code></p>',
      '<pre><code class="language-js">const a = 1\n```</code></pre>',
      '<p><span data-prompt-link-url="https://e.com/a">查看</span> 尾随</p>',
    ].join('')
    const result = convert(html, [promptLinkRule()])
    expect(result.markdown).toBe([
      '**粗** ``a`b``',
      '````js\nconst a = 1\n```\n````',
      '[查看](https://e.com/a) 尾随',
    ].join('\n\n'))
    expect(result.hasFormatting).toBe(true)
  })

  it.each([
    ['strong', '**'],
    ['em', '*'],
    ['del', '~~'],
  ])('链接模板保留 %s 父元素的继承格式', (tag, marker) => {
    expect(convert(
      `<p><${tag}>前<span data-prompt-link-url="https://e.com/a">中</span>后</${tag}></p>`,
      [promptLinkRule()],
    ).markdown).toBe(`${marker}前[中](https://e.com/a)后${marker}`)
  })

  it('链接模板保留当前元素的格式，并尊重显式常规字重', () => {
    expect(convert(
      '<p><span style="font-weight:bold" data-prompt-link-url="https://e.com/a">中</span></p>',
      [promptLinkRule()],
    ).markdown).toBe('**[中](https://e.com/a)**')
    expect(convert(
      '<p><strong>前<span style="font-weight:normal" data-prompt-link-url="https://e.com/a">中</span>后</strong></p>',
      [promptLinkRule()],
    ).markdown).toBe('**前**[中](https://e.com/a)**后**')
  })

  it('children 槽已含继承格式，不重复套用同一层标记', () => {
    const childrenRule = rule({
      id: 'builtin-children',
      output: { kind: 'template', template: '{{body}}', slots: { body: { source: { kind: 'children' } } } },
    })
    expect(convert('<p><strong><span>中</span></strong></p>', [childrenRule]).markdown).toBe('**中**')
  })

  it('模板字面按内置规则转义（来源文本中的 Markdown 特殊字符不二次解释）', () => {
    const result = convert(
      '<p><span data-prompt-link-url="https://e.com/a(b)">*字面*</span></p>',
      [promptLinkRule()],
    )
    // 标签文本转义；URL 括号经 safeUrl 百分号编码
    expect(result.markdown).toBe('[\\*字面\\*](https://e.com/a%28b%29)')
  })

  it('children 槽：子内容按内置转换结果拼接，不二次转义', () => {
    const wrap = rule({
      id: 'quote-card',
      match: { tag: 'DIV', attributes: [{ name: 'data-card' }] },
      output: {
        kind: 'template',
        template: '> {{body}}',
        slots: { body: { source: { kind: 'children' } } },
      },
    })
    const result = convert(
      '<div data-card><p><strong>粗</strong>文字</p></div>',
      [wrap],
    )
    expect(result.markdown).toBe('> **粗**文字')
    expect(result.hasFormatting).toBe(true)
    // T01 的 children 只取内置转换结果；子元素不得继续调用组件规则。
    expect(convert(
      '<div data-card><span data-prompt-link-url="https://e.com/a">子文字</span></div>',
      [wrap, promptLinkRule()],
    ).markdown).toBe('> 子文字')
  })

  it('块级与行内元素都消费规则；INPUT 不经规则', () => {
    const dropSpan = rule({ id: 'drop-span', output: { kind: 'discard' } })
    expect(convert('<p>a<span>b</span>c</p>', [dropSpan]).markdown).toBe('ac')
    // INPUT 元素按内置语义剔除，规则不介入
    const inputRule = rule({
      id: 'input-rule',
      match: { tag: 'INPUT' },
      output: { kind: 'template', template: 'x', slots: {} },
    })
    expect(convert('<p>a<input type="checkbox" checked>b</p>', [inputRule]).markdown).toBe('ab')
  })

  it('显式丢弃算成功（产出空串）；模板解析为空串不算成功回内置', () => {
    const discard = rule({ id: 'discard-all', match: { tag: 'SPAN', attributes: [{ name: 'data-copy-button' }] }, output: { kind: 'discard' } })
    const result = convert('<p>文字<span data-copy-button>复制</span>结尾</p>', [discard])
    expect(result.markdown).toBe('文字结尾')
    expect(result.hasFormatting).toBe(true)
    // 模板仅引用空值属性（present 但空串）→ 产出空串 → 不算成功 → 内置输出文字
    const emptyTemplate = rule({
      id: 'empty-out',
      match: { tag: 'SPAN', attributes: [{ name: 'data-empty' }] },
      output: { kind: 'template', template: 'x{{v}}', slots: { v: { source: { kind: 'attribute', name: 'data-empty' } } } },
    })
    // 产出 'x'（非空）——补充一个真正产出空的形态：模板只含槽且槽为空属性
    const onlySlot = rule({
      id: 'only-slot',
      match: { tag: 'SPAN', attributes: [{ name: 'data-empty' }] },
      output: { kind: 'template', template: '{{v}}', slots: { v: { source: { kind: 'attribute', name: 'data-empty' } } } },
    })
    expect(convert('<p><span data-empty="">文字</span></p>', [onlySlot]).markdown).toBe('文字')
    void emptyTemplate
  })

  it('单次粘贴求值步数预算：超限后停用规则、内置转换继续', () => {
    // 永不匹配的规则 × 大量元素 → 尝试步数超预算
    const noise: AddonPasteRule[] = Array.from({ length: 400 }, (_, i) =>
      rule({
        id: `noise-${i}`,
        addonId: `n${i % 4}.addon`,
        match: { tag: 'ZZZ' },
        output: { kind: 'discard' },
      }))
    const winner = promptLinkRule({ priority: 100 })
    const html = Array.from({ length: 300 }, (_, i) => `<p><span data-prompt-link-url="https://e.com/${i}">链接${i}</span></p>`).join('')
    // 噪声规则在前且优先级低不会先尝试；先让 winner 处理前几个，之后步数
    // 耗尽 → 后续 span 回内置（输出纯文本）
    const rules = [...noise, winner]
    const result = convert(html, rules)
    // 前若干链接被规则转换；预算耗尽后回内置为纯文本 span 文字
    expect(result.markdown).toContain('[链接0](https://e.com/0)')
    const plainCount = (result.markdown.match(/^链接\d+$/gm) ?? []).length
    const linkCount = (result.markdown.match(/^\[链接\d+\]/gm) ?? []).length
    expect(linkCount).toBeGreaterThan(0)
    expect(linkCount + plainCount).toBe(300)
    // 预算边界：noise 400 × 元素若干 —— 总步数确实超过 100k 才触发停用
    expect(400 * (plainCount + linkCount)).toBeGreaterThan(ADDON_PASTE_RULES_EVAL_STEP_BUDGET)
  })

  it('子内容超过全局节点预算后整次失败，不能用下一条静态产出掩盖', () => {
    const rules = [
      rule({ id: 'a-children', match: { tag: 'DIV' }, output: {
        kind: 'template', template: '{{body}}', slots: { body: { source: { kind: 'children' } } },
      } }),
      rule({ id: 'b-static', match: { tag: 'DIV' }, output: {
        kind: 'template', template: '不能插入的半成品', slots: {},
      } }),
    ]
    const html = '<div>' + '<span>x</span>'.repeat(50_001) + '</div>'
    expect(() => convert(html, rules)).toThrow('Clipboard HTML exceeds node budget')
  })

  it('模板切分只在本次转换复用，下次粘贴不持有上次规则缓存', () => {
    const parse = vi.spyOn(pasteRulesModule, 'parseAddonPasteTemplate')
    const textRule = rule({ id: 'scoped-cache', output: {
      kind: 'template', template: '缓存{{label}}', slots: { label: { source: { kind: 'text' } } },
    } })
    try {
      const html = '<p><span>甲</span><span>乙</span></p>'
      expect(convert(html, [textRule]).markdown).toBe('缓存甲缓存乙')
      expect(parse).toHaveBeenCalledTimes(1)
      expect(convert(html, [textRule]).markdown).toBe('缓存甲缓存乙')
      expect(parse).toHaveBeenCalledTimes(2)
    } finally {
      parse.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// #542 T02：正则捕获组
// ---------------------------------------------------------------------------

describe('T02 粘贴规则转换：正则捕获组', () => {
  const regexSlotRule = (init: Partial<AddonPasteRule> = {}): AddonPasteRule =>
    rule({
      id: 'regex-slot',
      output: {
        kind: 'template',
        template: '[{{label}}]({{url}})',
        slots: {
          label: { source: { kind: 'text-regex', regex: { pattern: '^(?<t>\\S+)\\s*$', flags: 'i' }, group: 't' } },
          url: { source: { kind: 'attribute-regex', name: 'data-href', regex: { pattern: '^https://(?:\\w+\\.)*([\\w.-]+)/(.*)$' }, group: 0 }, url: true },
        },
      },
      ...init,
    })

  it('捕获组取值：命名组与数字组 0（整匹）分别填充槽', () => {
    const result = convert(
      '<p><span data-href="https://example.com/a/b?x=1">链接词</span></p>',
      [regexSlotRule()],
    )
    expect(result).toEqual({
      markdown: '[链接词](https://example.com/a/b?x=1)',
      hasFormatting: true,
    })
  })

  it('无匹配或捕获组未参与：本规则失败回内置（不产出半成品）', () => {
    // 文本带空格不匹配 ^\w+\s*$ → 失败；属性不匹配 URL 形态 → 失败
    expect(convert('<p><span data-href="not-url">词</span></p>', [regexSlotRule()]).markdown).toBe('词')
    expect(convert('<p><span data-href="https://e.com/a">两个 词</span></p>', [regexSlotRule()]).markdown).toBe('两个 词')
    // 捕获组声明存在但该次匹配未参与 → 必需取值缺失 → 回内置
    const optionalGroup = rule({
      id: 'optional-group',
      output: {
        kind: 'template',
        template: '{{v}}',
        slots: { v: { source: { kind: 'text-regex', regex: { pattern: '^(?:a(x)|b)$' }, group: 1 } } },
      },
    })
    expect(convert('<p><span>ax</span></p>', [optionalGroup]).markdown).toBe('x')
    expect(convert('<p><span>b</span></p>', [optionalGroup]).markdown).toBe('b')
  })

  it('空捕获 = 必需取值缺失（与其他来源口径一致）', () => {
    const emptyCapture = rule({
      id: 'empty-capture',
      output: {
        kind: 'template',
        template: 'v={{v}}',
        slots: { v: { source: { kind: 'text-regex', regex: { pattern: '^a()$' }, group: 1 } } },
      },
    })
    expect(convert('<p><span>a</span></p>', [emptyCapture]).markdown).toBe('a')
  })

  it('正则输入超上限：本规则失败回内置，不截断不改写', () => {
    const longText = 'a'.repeat(ADDON_PASTE_RULES_REGEX_INPUT_LIMIT + 1)
    const capped = rule({
      id: 'capped',
      output: {
        kind: 'template',
        template: '[{{v}}]',
        slots: { v: { source: { kind: 'text-regex', regex: { pattern: '^a+$' }, group: 0 } } },
      },
    })
    expect(convert(`<p><span>${longText}</span></p>`, [capped]).markdown).toBe(longText)
    // 边界值本身（恰好上限长度）仍可匹配
    const edge = 'a'.repeat(ADDON_PASTE_RULES_REGEX_INPUT_LIMIT)
    expect(convert(`<p><span>${edge}</span></p>`, [capped]).markdown).toBe(`[${edge}]`)
  })

  it('URL 槽取捕获组仍走既有 safeUrl：危险协议拒绝后回内置', () => {
    const jsUrl = rule({
      id: 'js-url',
      output: {
        kind: 'template',
        template: '[{{t}}]({{u}})',
        slots: {
          t: { source: { kind: 'text' } },
          u: { source: { kind: 'attribute-regex', name: 'data-href', regex: { pattern: '^(.*)$' }, group: 1 }, url: true },
        },
      },
    })
    const result = convert('<p><span data-href="javascript:alert(1)">词</span></p>', [jsUrl])
    expect(result.markdown).toBe('词')
    expect(result.hasFormatting).toBe(false)
  })

  it('捕获结果按内置规则转义（来源文本的 Markdown 特殊字符不二次解释）', () => {
    const capture = rule({
      id: 'capture-escape',
      output: {
        kind: 'template',
        template: '*{{v}}*',
        slots: { v: { source: { kind: 'text-regex', regex: { pattern: '^a(.*)b$' }, group: 1 } } },
      },
    })
    // 捕获 `*x_`（a 与末位 b 之间）→ 转义为 \*x\_；模板字面 * 是作者结构
    expect(convert('<p><span>a*x_b</span></p>', [capture]).markdown).toBe('*\\*x\\_*')
  })

  it('求值期编译失败（绕过校验的敌意规则数据）按单条失败回退，不崩整次粘贴', () => {
    const hostile = rule({
      id: 'hostile-regex',
      output: {
        kind: 'template',
        template: '{{v}}',
        slots: { v: { source: { kind: 'text-regex', regex: { pattern: '(' }, group: 0 } } },
      },
    })
    const fallback = rule({
      id: 'fallback-next',
      output: { kind: 'template', template: '[ok]', slots: {} },
    })
    const result = convert('<p><span>词</span></p>', [hostile, fallback])
    expect(result.markdown).toBe('[ok]')
  })
})

// ---------------------------------------------------------------------------
// #542 T02：条件组合
// ---------------------------------------------------------------------------

describe('T02 粘贴规则转换：条件组合', () => {
  const conditionRule = (condition: unknown): AddonPasteRule =>
    rule({ id: 'cond', match: { tag: 'SPAN', condition: condition as never }, output: { kind: 'discard' } })

  it('all/any/not 组合基础谓词与正则谓词命中丢弃', () => {
    const condition = {
      all: [
        { kind: 'attribute', name: 'data-kind', value: 'chrome' },
        { any: [
          { kind: 'attribute-regex', name: 'data-role', regex: { pattern: '^(copy|menu)$' } },
          { not: { kind: 'text-regex', regex: { pattern: '\\S' } } },
        ] },
      ],
    }
    // data-role=copy 命中 any 左枝 → 命中丢弃
    expect(convert('<p>正文<span data-kind="chrome" data-role="copy">复制</span>尾</p>', [conditionRule(condition)]).markdown).toBe('正文尾')
    // data-role 不匹配左枝；文本含非空白 → not 右枝为假 → any 假 → 回内置
    expect(convert('<p>正文<span data-kind="chrome" data-role="other">词</span>尾</p>', [conditionRule(condition)]).markdown).toBe('正文词尾')
    // 纯空白文本 → not 右枝为真 → any 真 → 命中丢弃
    expect(convert('<p>正文<span data-kind="chrome" data-role="other"> </span>尾</p>', [conditionRule(condition)]).markdown).toBe('正文尾')
    // 基础谓词值不相等 → all 假 → 回内置
    expect(convert('<p><span data-kind="card">词</span></p>', [conditionRule(condition)]).markdown).toBe('词')
  })

  it('正则谓词输入超上限按假值处理（不匹配该规则）', () => {
    const longText = 'x'.repeat(ADDON_PASTE_RULES_REGEX_INPUT_LIMIT + 1)
    const condition = { all: [{ kind: 'text-regex', regex: { pattern: '^x+$' } }] }
    expect(convert(`<p><span>${longText}</span></p>`, [conditionRule(condition)]).markdown).toBe(longText)
  })

  it('条件不满足进入下一条规则；属性缺失的谓词为假', () => {
    const first = rule({
      id: 'needs-card',
      match: { tag: 'SPAN', condition: { all: [{ kind: 'attribute', name: 'data-kind', value: 'card' }] } as never },
      output: { kind: 'discard' },
    })
    const second = rule({
      id: 'fallback-template',
      output: { kind: 'template', template: '`{{t}}`', slots: { t: { source: { kind: 'text' } } } },
    })
    const result = convert('<p><span data-kind="other">词</span></p>', [first, second])
    expect(result.markdown).toBe('`词`')
    expect(result.hasFormatting).toBe(true)
  })

  it('条件与 attributes 全与组合（两处条件同时约束）', () => {
    const strict = rule({
      id: 'strict-both',
      match: {
        tag: 'SPAN',
        attributes: [{ name: 'data-x', value: '1' }],
        condition: { all: [{ kind: 'attribute-regex', name: 'data-y', regex: { pattern: '^2$' } }] } as never,
      },
      output: { kind: 'discard' },
    })
    expect(convert('<p><span data-x="1" data-y="2">词</span></p>', [strict]).markdown).toBe('')
    expect(convert('<p><span data-x="1" data-y="3">词</span></p>', [strict]).markdown).toBe('词')
  })
})

// ---------------------------------------------------------------------------
// #542 T02：子节点嵌套转换
// ---------------------------------------------------------------------------

describe('T02 粘贴规则转换：子节点嵌套', () => {
  const nestedWrap = (nestedRules: readonly unknown[]): AddonPasteRule =>
    rule({
      id: 'outer-card',
      match: { tag: 'DIV', attributes: [{ name: 'data-card' }] },
      output: {
        kind: 'template',
        template: '> {{body}}',
        slots: { body: { source: { kind: 'children', rules: nestedRules as never } } },
      },
    })

  const innerLink = {
    id: 'inner-link',
    match: { tag: 'SPAN', attributes: [{ name: 'data-inner-url' }] },
    output: {
      kind: 'template',
      template: '[{{t}}]({{u}})',
      slots: {
        t: { source: { kind: 'text' } },
        u: { source: { kind: 'attribute', name: 'data-inner-url' }, url: true },
      },
    },
  }

  it('子规则集先于内置转换命中子元素；未命中子元素回内置', () => {
    const result = convert(
      '<div data-card><p><span data-inner-url="https://e.com/a">内链</span> 与 <strong>粗体</strong></p></div>',
      [nestedWrap([innerLink])],
    )
    expect(result.markdown).toBe('> [内链](https://e.com/a) 与 **粗体**')
    expect(result.hasFormatting).toBe(true)
  })

  it('外层规则集不串入嵌套求值：同标签子元素不被外层规则再次转换', () => {
    const outerSpanRule = rule({
      id: 'outer-span',
      priority: -1,
      match: { tag: 'SPAN', attributes: [{ name: 'data-inner-url' }] },
      output: { kind: 'template', template: '外层接管', slots: {} },
    })
    // 外层规则集（含 outer-span）在嵌套求值期间不参与：子 span 由子规则集处理
    const result = convert(
      '<div data-card><p><span data-inner-url="https://e.com/a">内链</span></p></div>',
      [outerSpanRule, nestedWrap([innerLink])],
    )
    expect(result.markdown).toBe('> [内链](https://e.com/a)')
    // 无子规则集时子 span 回内置（T01 语义保持），外层规则同样不串入
    const plainWrap = rule({
      id: 'plain-wrap',
      match: { tag: 'DIV', attributes: [{ name: 'data-card' }] },
      output: { kind: 'template', template: '> {{body}}', slots: { body: { source: { kind: 'children' } } } },
    })
    expect(convert(
      '<div data-card><p><span data-inner-url="https://e.com/a">内链</span></p></div>',
      [outerSpanRule, plainWrap],
    ).markdown).toBe('> 内链')
  })

  it('嵌套求值不越出子树：卡片外的同形元素不受子规则集影响', () => {
    const html = '<div data-card><p><span data-inner-url="https://e.com/a">内</span></p></div><p><span data-inner-url="https://e.com/b">外</span></p>'
    const result = convert(html, [nestedWrap([innerLink])])
    expect(result.markdown).toBe('> [内](https://e.com/a)\n\n外')
  })

  it('嵌套子规则失败回内置；子规则可显式丢弃', () => {
    const conditionalDrop = {
      id: 'drop-chrome',
      match: { tag: 'SPAN', condition: { all: [{ kind: 'attribute', name: 'data-chrome' }] } },
      output: { kind: 'discard' },
    }
    const result = convert(
      '<div data-card><p>词<span data-chrome>按钮</span>尾</p></div>',
      [nestedWrap([conditionalDrop])],
    )
    expect(result.markdown).toBe('> 词尾')
  })

  it('嵌套 children 已编码继承标记，不重复套用同一层格式（表格上下文保持）', () => {
    const tableWrap = rule({
      id: 'table-card',
      match: { tag: 'DIV', attributes: [{ name: 'data-card' }] },
      output: {
        kind: 'template',
        template: '{{body}}',
        slots: { body: { source: { kind: 'children', rules: [innerLink] as never } } },
      },
    })
    const result = convert(
      '<table><tr><th>标题</th></tr><tr><td><div data-card><span data-inner-url="https://e.com/a">内链</span> 文字|竖线</div></td></tr></table>',
      [tableWrap],
    )
    expect(result.markdown).toBe('| 标题 |\n| --- |\n| [内链](https://e.com/a) 文字\\|竖线 |')
  })

  it('嵌套可逐层下降：深层 HTML 链条由多层声明完成且输出可预期', () => {
    const chain = (depth: number): unknown => depth === 0
      ? { id: 'leaf', match: { tag: 'SPAN' }, output: { kind: 'template', template: '⟦{{t}}⟧', slots: { t: { source: { kind: 'text' } } } } }
      : {
          id: `level-${depth}`,
          match: { tag: 'DIV' },
          output: { kind: 'template', template: '〔{{b}}〕', slots: { b: { source: { kind: 'children', rules: [chain(depth - 1)] } } } },
        }
    const html = Array.from({ length: 15 }, () => '<div>').join('') + '<span>芯</span>' + '</div>'.repeat(15)
    const result = convert(html, [chain(15) as never])
    expect(result.markdown).toBe('〔'.repeat(15) + '⟦芯⟧' + '〕'.repeat(15))
  })

  it('嵌套规则求值异常与失败不放大：整体回内置转换', () => {
    const badNested = {
      id: 'bad-regex',
      match: { tag: 'SPAN' },
      output: {
        kind: 'template',
        template: '{{v}}',
        slots: { v: { source: { kind: 'text-regex', regex: { pattern: '(' }, group: 0 } },
        },
      },
    }
    const result = convert('<div data-card><p>词</p></div>', [nestedWrap([badNested])])
    expect(result.markdown).toBe('> 词')
  })
})

// ---------------------------------------------------------------------------
// #542 T02：步计费扩展与确定性回退
// ---------------------------------------------------------------------------

describe('T02 粘贴规则转换：步计费与确定性', () => {
  it('条件节点与正则执行计入同一求值步预算：超限确定性停用，内置继续', () => {
    // 单条规则（标签 SPAN）：每段消耗 1（P 块尝试，标签不匹配）+ 1（span
    // 尝试命中）+ 99（同一槽被模板引用 99 次，每次各执行一次正则）= 101
    // 步；1050 段 → 105,050 步 > 100,000——第 991 段第 9 次正则执行时越
    // 限。若只按 T01「规则尝试」计费（2,100 步）则不会停用：本用例证明
    // 正则执行同样计步且停用是确定性的（前 990 段转换、其余回内置）。
    const slots = { a: { source: { kind: 'text-regex' as const, regex: { pattern: '^Y$' }, group: 0 } } }
    const rule99: AddonPasteRule = rule({
      id: 'regex-heavy',
      output: {
        kind: 'template',
        template: '{{a}}'.repeat(99),
        slots: slots as never,
      },
    })
    const html = Array.from({ length: 1050 }, () => '<p><span>Y</span></p>').join('')
    const result = convert(html, [rule99])
    const lines = result.markdown.split('\n')
    const converted = lines.filter((line) => line === 'Y'.repeat(99)).length
    const builtin = lines.filter((line) => line === 'Y').length
    expect(converted).toBe(990)
    expect(builtin).toBe(60)
    expect(converted + builtin).toBe(1050)
  })

  it('多组件冲突在正则/条件形态下仍确定性：结果与规则输入顺序无关', () => {
    const mk = (addonId: string, id: string, priority: number, mark: string): AddonPasteRule =>
      rule({
        addonId, id, priority,
        match: { tag: 'SPAN', condition: { all: [{ kind: 'attribute-regex', name: 'data-x', regex: { pattern: '^1$' } }] } as never },
        output: { kind: 'template', template: mark, slots: {} },
      })
    const rules = [
      mk('b.addon', 'r1', 0, '[B0]'),
      mk('a.addon', 'r2', 0, '[A2]'),
      mk('z.addon', 'r9', 10, '[Z10]'),
    ]
    const html = '<p><span data-x="1">词</span></p>'
    expect(convert(html, rules).markdown).toBe('[Z10]')
    expect(convert(html, [...rules].reverse()).markdown).toBe('[Z10]')
  })
})
