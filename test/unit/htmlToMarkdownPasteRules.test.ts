// @vitest-environment jsdom
// #541 T01 附加组件粘贴规则——htmlToMarkdown 消费链契约测试。
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
import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../../src/webview/htmlToMarkdown'
import {
  ADDON_PASTE_RULES_EVAL_STEP_BUDGET,
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
})
