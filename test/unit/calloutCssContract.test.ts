// Callout CSS 契约（#653/T02，#654/T03 扩展全类型）：钉住 main.css 的
// callout 变量族、类型变量表、双通道背景与「callout 替代该层引用紫条」边界
// （T01 报告 §5.4 四项实施边界的 CSS 落点）。类型变量表与图标表**从注册表
// 驱动断言**（CALLOUT_TYPES 为单一事实源——CSS 手写表被测试强制同步，
// 不复制类型数据第二份）。用户看到的东西（AGENTS 视觉层断言）：外框
// 底色/圆角/标题字重/图标可见性由浏览器 calloutPaint / calloutTypes 的
// computed 断言兜底，本契约在源头钉住规则形态——样式被误删时先在此失败。
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_TYPES,
  CALLOUT_ALIAS_VARIABLE_OVERRIDES,
} from '../../src/shared/calloutSyntax'
import { cssRule, cssRuleExact, readMainCss } from './cssContract'

const css = readMainCss()

describe('callout 变量族（Obsidian 原名即公开入口）', () => {
  it('#app 定义暗色档默认值（note 色 #027aff、radius 4px、边框宽 0）', () => {
    const app = cssRuleExact(css, '#app')
    expect(app).toMatch(/--callout-radius:\s*4px/)
    expect(app).toMatch(/--callout-default:\s*#027aff/)
    expect(app).toMatch(/--callout-color:\s*var\(--callout-default\)/)
    expect(app).toMatch(/--callout-border-width:\s*0px/)
    expect(app).toMatch(/--callout-content-background:\s*transparent/)
  })

  it('暗色档全类型变量默认值按取证（cyan #53dfdd / green #44cf6e / orange #e9973f / red #fb464c / purple #a882ff / quote #9e9e9e）', () => {
    const app = cssRuleExact(css, '#app')
    expect(app).toMatch(/--callout-summary:\s*#53dfdd/)
    expect(app).toMatch(/--callout-info:\s*#027aff/)
    expect(app).toMatch(/--callout-todo:\s*#027aff/)
    expect(app).toMatch(/--callout-tip:\s*#53dfdd/)
    expect(app).toMatch(/--callout-important:\s*#53dfdd/)
    expect(app).toMatch(/--callout-success:\s*#44cf6e/)
    expect(app).toMatch(/--callout-question:\s*#e9973f/)
    expect(app).toMatch(/--callout-warning:\s*#e9973f/)
    expect(app).toMatch(/--callout-fail:\s*#fb464c/)
    expect(app).toMatch(/--callout-error:\s*#fb464c/)
    expect(app).toMatch(/--callout-bug:\s*#fb464c/)
    expect(app).toMatch(/--callout-example:\s*#a882ff/)
    expect(app).toMatch(/--callout-quote:\s*#9e9e9e/)
  })

  it('亮色主题覆盖全部类型色（取证亮值：blue #086ddd / cyan #00bfbc / green #08b94e / orange #ec7500 / red #e93147 / purple #7852ee）', () => {
    const light = cssRule(css, 'body.vscode-light #app')
    for (const [name, value] of [
      ['--callout-default', '#086ddd'], ['--callout-summary', '#00bfbc'],
      ['--callout-info', '#086ddd'], ['--callout-todo', '#086ddd'],
      ['--callout-tip', '#00bfbc'], ['--callout-important', '#00bfbc'],
      ['--callout-success', '#08b94e'], ['--callout-question', '#ec7500'],
      ['--callout-warning', '#ec7500'], ['--callout-fail', '#e93147'],
      ['--callout-error', '#e93147'], ['--callout-bug', '#e93147'],
      ['--callout-example', '#7852ee'],
    ] as const) {
      expect(light, name).toMatch(new RegExp(`${name}:\\s*${value}`))
    }
    // quote 固定 #9e9e9e 不做亮色覆盖（非调色板引用色，取证照录）
    expect(light).not.toMatch(/--callout-quote/)
  })

  it('类型变量表以 :where() 零特异性承载（T01 边界 1：行元素无内联变量）', () => {
    // 零特异性承诺：色表与图标表都以 :where 起头（无 #app 等特异性来源
    // 前缀——契约解析器会把前置块注释并入 selector，故按行首锚定断言）
    expect(css).toMatch(/\n:where\(\[data-callout='note'\]\)\s*\{\s*\r?\n\s*--callout-color:\s*var\(--callout-default\)/)
    expect(css).toMatch(/\n:where\(\[data-callout='note'\]\)\s*\{\s*\r?\n\s*--_vsidian-callout-icon:\s*url\("data:image\/svg\+xml/)
  })

  it('类型变量表与注册表完全同步（每条目 id+无覆盖别名都有规则且变量名一致）', () => {
    for (const entry of CALLOUT_TYPES) {
      // 覆盖表别名（important）的 CSS 变量独立成规则——条目组规则只含
      // 条目本体与无覆盖别名
      const selectors = [entry.id, ...entry.aliases.filter((a) => !(a in CALLOUT_ALIAS_VARIABLE_OVERRIDES))]
        .map((t) => `[data-callout='${t}']`).join(', ')
      const pattern = new RegExp(
        `\\n:where\\(${selectors.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*\\{[^}]*--callout-color:\\s*var\\(${entry.colorVariable}\\)`)
      expect(css, entry.id).toMatch(pattern)
    }
    // important：别名变量覆盖规则独立在场（变量面登记，取证 aliasDiscrepancy）
    expect(css).toMatch(/\n:where\(\[data-callout='important'\]\)\s*\{[^}]*--callout-color:\s*var\(--callout-important\)/)
  })

  it('图标表与注册表同步：每条目 id+别名都命中某条 --_vsidian-callout-icon 规则', () => {
    // 取全部图标规则块（selector + 变量定义），再断言类型出现在选择器列表
    const iconRules = css.match(/:where\([^)]*\)\s*\{[^}]*--_vsidian-callout-icon:/g) ?? []
    expect(iconRules.length).toBeGreaterThanOrEqual(
      new Set(CALLOUT_TYPES.map((e) => e.icon)).size,
    )
    for (const entry of CALLOUT_TYPES) {
      // important 与 tip 同图标（lucide-flame）——图标规则按图标分组，别名
      // 随所属条目组命中即可（flame 组选择器含 tip/hint/important 三值）
      const selectors = [entry.id, ...entry.aliases]
      const found = selectors.some((t) =>
        iconRules.some((rule) => rule.includes(`[data-callout='${t}']`)))
      expect(found, entry.id).toBe(true)
    }
    // 基础规则消费变量（默认铅笔兜底：未知类型无规则命中时回落）
    const icon = cssRule(css, '#app .callout-icon')
    expect(icon).toMatch(/mask:\s*var\(--_vsidian-callout-icon,/)
  })

  it('行级类不携带内联 style 变量（增量发射的 data-callout 属性不带 style）', () => {
    // 契约口径：行装饰 attributes 只有 data-callout（+既有网格属性）；
    // 本测试钉 CSS 侧不消费 --callout-color 以外的行内注入面——变量只
    // 经 :where 类型表与 #app 默认值两处定义
    const defs = css.match(/--callout-color:\s*[^;]+;/g) ?? []
    expect(defs.filter((d) => !/var\(--callout-(default|summary|info|todo|tip|important|success|question|warning|fail|error|bug|example|quote)\)/.test(d))).toHaveLength(0)
  })
})

describe('live 行级形态：替代紫条与双通道底色', () => {
  const liveQuiet = () => cssRule(css, '.vsidian-quote-line.callout.vsidian-callout-quiet')

  it('quiet 行抑制引用紫条并画双通道底色（拆属性双通道，T01 §6.2）', () => {
    const rule = liveQuiet()
    expect(rule).toMatch(/box-shadow:\s*none/)
    expect(rule).toMatch(/background-color:\s*rgba\(var\(--callout-color\),\s*0?\.1\)/)
    expect(rule).toMatch(/background-image:\s*linear-gradient\(\s*color-mix\(in oklch, var\(--callout-color\) 10%, transparent\)/)
  })

  it('普通引用行紫条规则不被改动（callout 接入不回归引用契约）', () => {
    const quote = cssRule(css, '#app .cm-editor .cm-scroller .vsidian-quote-line')
    expect(quote).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--vsidian-quote-bar-color\)/)
  })

  it('首末行圆角分角（单行容器两类同挂自然合成全圆角）', () => {
    const first = cssRule(css, '.vsidian-quote-line.vsidian-callout-first')
    expect(first).toMatch(/border-top-left-radius:\s*var\(--callout-radius\)/)
    expect(first).toMatch(/border-top-right-radius:\s*var\(--callout-radius\)/)
    const last = cssRule(css, '.vsidian-quote-line.vsidian-callout-last')
    expect(last).toMatch(/border-bottom-left-radius:\s*var\(--callout-radius\)/)
    expect(last).toMatch(/border-bottom-right-radius:\s*var\(--callout-radius\)/)
  })

  it('标题行字重与图标 mask（#654/T03：mask 经私有变量分派，铅笔兜底）', () => {
    const title = cssRule(css, '.vsidian-quote-line.callout-title')
    expect(title).toMatch(/font-weight:\s*var\(--callout-title-weight\)/)
    const icon = cssRule(css, '#app .callout-icon')
    expect(icon).toMatch(/mask:\s*var\(--_vsidian-callout-icon,\s*url\("data:image\/svg\+xml/)
    expect(icon).toMatch(/background-color:\s*var\(--callout-color\)/)
  })
})

describe('阅读侧真实容器', () => {
  it('div.callout 容器：padding/radius 与双通道底色（与 live 同变量）', () => {
    const rule = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block div.callout')
    expect(rule).toMatch(/padding:\s*var\(--callout-padding\)/)
    expect(rule).toMatch(/border-radius:\s*var\(--callout-radius\)/)
    expect(rule).toMatch(/background-color:\s*rgba\(var\(--callout-color\),\s*0?\.1\)/)
    expect(rule).toMatch(/background-image:\s*linear-gradient\(\s*color-mix\(in oklch, var\(--callout-color\) 10%, transparent\)/)
  })

  it('.callout-title / .callout-content 消费标题与正文变量', () => {
    const title = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block .callout-title')
    expect(title).toMatch(/font-weight:\s*var\(--callout-title-weight\)/)
    const content = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block .callout-content')
    expect(content).toMatch(/padding:\s*var\(--callout-content-padding\)/)
    expect(content).toMatch(/background:\s*var\(--callout-content-background\)/)
  })
})
