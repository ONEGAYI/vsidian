// #566（T01）文档内 CSS 作用域探针核心（两环境共用：
// 真宿主 1.82.3 webview / 本机 Playwright Chromium）。
//
// 四条候选隔离路线，全部实测记录、不预设结论：
//   a1/a2/a3 Shadow DOM（Reading 内容整体进 shadow / 生产样式采纳进 shadow /
//      Live widget 级 shadow 共享 constructed sheet）
//   b1/b2  容器选择器前缀改写（b1 朴素类前缀包装 / b2 逐块 data 属性 +
//      :where():is() 零特异性改写）
//   c     CSS @scope（含 donut 上边界），Chromium 114 可用性实测
//   d     每文档 iframe（srcdoc，嵌套 B/C）
//
// 证据标准（票面）：只有 DOM 存在或 CSS 文本存在不算数——断言全部落在
// 绘制读值（getComputedStyle 实际值）；排除面断言用「同基线」比较
// （基线 = 未挂文档样式时同脚手架的读值，同环境内相对差判定，
// 跨环境绝对值差异不参与判定）。
//
// 脚手架按生产视图接缝仿形：#app > .vsidian-toolbar（工具栏）、
// .vsidian-view-live > .cm-editor/.cm-scroller/.cm-content/.cm-line（CM6
// 源码层）、.vsidian-view-reading（Reading 容器）、.vsidian-embed-card
// （引用卡：卡壳=系统 chrome，卡体=被引文档内容根）。
// 生产样式表（out/webview/main.css）与稳定契约测试片段
// （media/css-contract-probe.css）由宿主 HTML / 浏览器 harness 预先挂载，
// 探针只在其上叠加候选路线——层叠/特异性因此对真实生产 CSS 取证。
//
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

export interface CssScopeProbeEnv {
  label: string
  /** a2 变体取生产样式表文本：宿主 fetch link href；浏览器读注入 <style> 文本 */
  readStylesheetText: (which: 'main' | 'probe') => Promise<string>
}

export interface ProbeRow {
  name: string
  value: string
  expect: string
  meets: boolean | null
}

export interface ProbeScenario {
  route: string
  summary: string
  rows: ProbeRow[]
  notes: string[]
}

export interface CssScopeProbeResult {
  env: { label: string; userAgent: string; startedAt: string }
  capabilities: Record<string, unknown>
  scenarios: ProbeScenario[]
}

// ---------------------------------------------------------------------------
// 文档样式源文（A 两块验证全文源序；值选用与生产/UA 兜底可区分的 rgb）
// ---------------------------------------------------------------------------

/** A 文档 style 块 1：先声明 p 红——应被 style 块 2 的蓝覆盖（源序证据） */
const A_STYLE_1 = `
p { color: rgb(178, 34, 34); }
.probe-a-cls { background-color: rgb(0, 128, 0); }
`

/** A 文档 style 块 2：终值来源；覆盖矩阵各选择器形态 */
const A_STYLE_2 = `
p { color: rgb(0, 0, 205); }
h1 { color: rgb(75, 0, 130); }
table td { background-color: rgb(255, 255, 0); }
[data-probe-attr] { text-decoration-line: underline; text-decoration-color: rgb(255, 0, 255); }
.probe-pe::before { content: "PE"; color: rgb(1, 2, 3); }
.probe-sib + .probe-sib-target { color: rgb(9, 8, 7); }
.probe-parent > .probe-child { border: 2px solid; border-color: rgb(4, 5, 6); }
.probe-fam p:nth-child(2) { letter-spacing: 5px; }
div { --a-mark: rgb(222, 0, 111); }
@media (min-width: 1px) { .probe-media-cls { color: rgb(60, 60, 61); } }
:root { --a-root-mark: rgb(9, 9, 9); }
body { --a-body-mark: rgb(8, 8, 8); }
.probe-snippet-target { color: rgb(205, 92, 92); }
.cm-content { color: rgb(250, 0, 250); }
.vsidian-toolbar { color: rgb(250, 100, 0); }
`

const B_STYLE = `p { color: rgb(0, 128, 128); }`
const C_STYLE = `p { color: rgb(107, 142, 35); }`

/** 既有 CSS 片段仿真（snippetLoader 的 <link> 在生产中先于文档样式） */
const SNIPPET_SIM = `
.probe-snippet-target { color: rgb(46, 139, 87); }
.probe-tag-beat { color: rgb(46, 139, 87); }
`

// ---------------------------------------------------------------------------
// DOM 仿形（生产接缝形状；data-doc 属性 = b2/c 路线的逐块标记）
// ---------------------------------------------------------------------------

const ID = {
  toolbar: 'probe-toolbar',
  toolbarBtn: 'probe-toolbar-btn',
  cmLine: 'probe-cm-line',
  cmStrong: 'probe-cm-strong',
  aMdH1: 'probe-a-md-h1',
  aMdP: 'probe-a-md-p',
  aStrong: 'probe-a-strong',
  aTheme: 'probe-a-theme-consumer',
  aNativeH1: 'probe-a-native-h1',
  aNativeTd: 'probe-a-native-td',
  aProbeChild: 'probe-a-child',
  aSibTarget: 'probe-a-sib-target',
  aPe: 'probe-a-pe',
  aPOrder: 'probe-a-p-order',
  aPTag: 'probe-a-p-tag',
  aPseudoCls: 'probe-a-pseudo-cls',
  aVar: 'probe-a-var-consumer',
  aVarRoot: 'probe-a-var-root-consumer',
  aMedia: 'probe-a-media-el',
  bMdP: 'probe-b-md-p',
  bNativeH1: 'probe-b-native-h1',
  bNativeP: 'probe-b-native-p',
  cMdP: 'probe-c-md-p',
  bHost: 'probe-b-content-root',
  cHost: 'probe-c-content-root',
} as const

const attr = (doc: string | null): string => (doc === null ? '' : ` data-doc="${doc}"`)

/** A 的内容块：Markdown 标题块 + Markdown 段落块 + 原生 HTML 块 + 变量探测位 */
function aBlocksHtml(markDoc: string | null): string {
  return `
<div class="vsidian-reading-block vsidian-reading-heading-1"${attr(markDoc)}><h1 id="${ID.aMdH1}">A Markdown 标题</h1></div>
<div class="vsidian-reading-block"${attr(markDoc)}><p id="${ID.aMdP}">A 段落 <strong id="${ID.aStrong}">重点</strong> <span id="${ID.aTheme}" style="color: var(--vsidian-heading-color-1, rgb(64, 64, 64))">主题变量消费者</span></p></div>
<div class="vsidian-html-block"${attr(markDoc)}>
  <h1 id="${ID.aNativeH1}" class="probe-a-cls" data-probe-attr="1">A 原生 H1</h1>
  <table><tbody><tr><td id="${ID.aNativeTd}">格</td></tr></tbody></table>
  <div class="probe-parent"><span class="probe-child" id="${ID.aProbeChild}">子</span></div>
  <span class="probe-sib">邻</span><span class="probe-sib-target" id="${ID.aSibTarget}">邻目标</span>
  <div class="probe-fam"><p>一</p><p id="${ID.aPseudoCls}">二</p></div>
  <div class="probe-pe" id="${ID.aPe}">伪宿主</div>
  <p id="${ID.aPOrder}" class="probe-snippet-target">顺序竞争段</p>
  <p id="${ID.aPTag}" class="probe-tag-beat">特异性竞争段</p>
  <div id="${ID.aVar}" style="color: var(--a-mark, rgb(3, 3, 3))">A 变量消费者</div>
  <span id="${ID.aVarRoot}" style="color: var(--a-root-mark, rgb(7, 7, 7))">root 变量消费者</span>
  <span id="${ID.aMedia}" class="probe-media-cls">媒体查询元素</span>
</div>`
}

/** B 的内容块：Markdown 段落 + 原生 HTML 块（含 A 变量泄漏探测位与直染泄漏证人 h1） */
function bBlocksHtml(markDoc: string | null): string {
  return `
<div class="vsidian-reading-block"${attr(markDoc)}><p id="${ID.bMdP}">B 段落</p></div>
<div class="vsidian-html-block"${attr(markDoc)}><h1 id="${ID.bNativeH1}">B 原生 H1</h1><p id="${ID.bNativeP}" style="color: var(--a-mark, rgb(5, 5, 5))">B 原生段落（A 变量消费探测）</p></div>`
}

/** C 的内容块 */
function cBlocksHtml(markDoc: string | null): string {
  return `<div class="vsidian-reading-block"${attr(markDoc)}><p id="${ID.cMdP}">C 段落</p></div>`
}

/** 引用卡：卡壳（header/body 容器）= 系统 chrome，不携带任何 doc 标记 */
function embedCardHtml(id: 'b' | 'c', inner: string): string {
  const hostId = id === 'b' ? ID.bHost : ID.cHost
  return `<div class="vsidian-embed-card"><div class="vsidian-embed-card-header">${id}.md</div><div class="vsidian-embed-card-body" id="${hostId}">${inner}</div></div>`
}

interface Scaffold {
  toolbar: HTMLElement
  toolbarBtn: HTMLElement
  cmLine: HTMLElement
  cmStrong: HTMLElement
  cmContent: HTMLElement
  readingView: HTMLElement
}

function mountScaffold(root: HTMLElement): Scaffold {
  root.innerHTML = `
<div id="app">
  <div class="vsidian-toolbar" id="${ID.toolbar}"><button id="${ID.toolbarBtn}" class="probe-media-cls vsidian-view-toggle">切换</button></div>
  <div class="vsidian-body">
    <div class="vsidian-view-live"><div class="cm-editor"><div class="cm-scroller"><div class="cm-content">
      <div class="cm-line" id="${ID.cmLine}">源码行 <span class="cm-strong" id="${ID.cmStrong}">强调</span></div>
      <div class="cm-line">第二源码行</div>
    </div></div></div></div>
    <div class="vsidian-view-reading" id="probe-reading-view"></div>
  </div>
</div>`
  return {
    toolbar: byId(root, `#${ID.toolbar}`),
    toolbarBtn: byId(root, `#${ID.toolbarBtn}`),
    cmLine: byId(root, `#${ID.cmLine}`),
    cmStrong: byId(root, `#${ID.cmStrong}`),
    cmContent: byId<HTMLElement>(root, '.cm-content'),
    readingView: byId(root, '#probe-reading-view'),
  }
}

function byId<T extends Element = HTMLElement>(scope: ParentNode, sel: string): T {
  const el = scope.querySelector(sel)
  if (!el) throw new Error(`脚手架元素缺失：${sel}`)
  return el as T
}

// ---------------------------------------------------------------------------
// 读值与行收集
// ---------------------------------------------------------------------------

const norm = (raw: string): string => raw.trim().replace(/\s+/g, ' ')

/** 能力标记命中读取（background-color 非继承，见 collectCapabilities 注释） */
const hitSel = (scope: ParentNode, sel: string): string => {
  const el = scope.querySelector(sel)
  return el ? norm(getComputedStyle(el).backgroundColor) : ''
}

interface ReadOpts {
  pseudo?: string
  win?: Window
}

function cssOf(el: Element, prop: string, opts: ReadOpts = {}): string {
  const win = opts.win ?? window
  return norm(win.getComputedStyle(el, opts.pseudo).getPropertyValue(prop))
}

class ScenarioCollector implements ProbeScenario {
  readonly route: string
  readonly summary: string
  readonly rows: ProbeRow[] = []
  readonly notes: string[] = []
  private readonly base: Map<string, string>

  constructor(route: string, summary: string, base: Map<string, string>) {
    this.route = route
    this.summary = summary
    this.base = base
  }

  row(name: string, value: string, expect: string, expectValue?: string): void {
    this.rows.push({ name, value, expect, meets: expectValue === undefined ? null : value === expectValue })
  }

  rowEl(name: string, el: Element | null | undefined, prop: string, expect: string, opts: ReadOpts & { expectValue?: string } = {}): void {
    if (!el) {
      this.rows.push({ name, value: '<元素缺失>', expect, meets: false })
      return
    }
    const { expectValue, ...read } = opts
    this.row(name, cssOf(el, prop, read), expect, expectValue)
  }

  /** 排除面断言：读值必须与基线场景一致（同环境相对差判定） */
  rowSame(name: string, el: Element | null | undefined, prop: string, opts: ReadOpts = {}): void {
    if (!el) {
      this.rows.push({ name, value: '<元素缺失>', expect: '同基线', meets: false })
      return
    }
    const value = cssOf(el, prop, opts)
    const baseValue = this.base.get(name)
    this.rows.push({ name, value, expect: `同基线（${baseValue ?? '基线缺失'}）`, meets: baseValue === undefined ? null : value === baseValue })
  }

  /** 反证断言：读值必须不等于某禁止值（如 A 的 purple 不得到达 B） */
  rowNot(name: string, el: Element | null | undefined, prop: string, forbidden: string, expect: string, opts: ReadOpts = {}): void {
    if (!el) {
      this.rows.push({ name, value: '<元素缺失>', expect, meets: false })
      return
    }
    const value = cssOf(el, prop, opts)
    this.rows.push({ name, value, expect, meets: value !== forbidden })
  }

  storeBase(name: string, el: Element, prop: string, opts: ReadOpts = {}): void {
    this.base.set(name, cssOf(el, prop, opts))
  }
}

// ---------------------------------------------------------------------------
// CSS 改写（CSSOM 语法处理，非正则替换；@media/@supports 递归下钻）
// ---------------------------------------------------------------------------

function rewriteCss(cssText: string, transform: (selector: string) => string): string {
  const sheet = new CSSStyleSheet()
  try {
    sheet.replaceSync(cssText)
  } catch (err) {
    return `/* 解析失败，原样保留：${String(err)} */\n${cssText}`
  }
  const walk = (rules: CSSRuleList): string[] => {
    const parts: string[] = []
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const sels = rule.selectorText.split(',').map((s) => s.trim()).filter(Boolean)
        parts.push(`${sels.map(transform).join(', ')} { ${rule.style.cssText} }`)
      } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        const head = rule instanceof CSSMediaRule ? `@media ${rule.conditionText}` : `@supports ${rule.conditionText}`
        parts.push(`${head} { ${walk(rule.cssRules).join('\n')} }`)
      } else {
        parts.push(`/* 未改写边界（${rule.constructor.name}）：原样保留 */ ${rule.cssText}`)
      }
    }
    return parts
  }
  return walk(sheet.cssRules).join('\n')
}

const rewriteB1 = (scopeClass: string) => (sel: string): string => `.${scopeClass} ${sel}`
/**
 * b2 逐块改写：`:where([data-doc=x]) :is(sel)`。
 * 伪元素必须留在 :is() 之外（:is() 参数禁伪元素，整条规则会被丢弃——
 * 探针首版实测踩坑）：后缀 ::pe 拆出后缀到 :is() 之后。
 */
const rewriteB2 = (docId: string) => (sel: string): string => {
  const m = sel.match(/^(.*?)(::[a-zA-Z-]+)$/)
  if (m) {
    const head = m[1].trim() || '*'
    return `:where([data-doc="${docId}"]) :is(${head})${m[2]}`
  }
  return `:where([data-doc="${docId}"]) :is(${sel})`
}

// ---------------------------------------------------------------------------
// 能力探测（行为检测优先：CSS.supports('selector()') 在 Chromium 114 缺失，
// 直接用会得到 :is/:where 的假阴性）
// ---------------------------------------------------------------------------

function collectCapabilities(): Record<string, unknown> {
  const caps: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    fontsBaseline: document.fonts.size,
    constructedSheet: typeof CSSStyleSheet === 'function' && typeof CSSStyleSheet.prototype.replaceSync === 'function',
  }

  // 行为检测：真 DOM + 真 <style>。标记属性用 background-color（非继承）：
  // 自定义属性会继承，会把命中结果污染到未命中的后代（探针首版实测踩坑）。
  const stage = document.createElement('div')
  stage.setAttribute('data-cap-stage', '')
  stage.innerHTML = `
<div class="cap-is"><span class="tgt a"></span></div>
<div class="cap-where"><span class="tgt"></span></div>
<div class="cap-not"><span><span class="keep"></span></span><span class="skip"><span class="skip-inner"></span></span></div>
<div class="cap-has"><span class="kid"></span></div>`
  const style = document.createElement('style')
  style.textContent = `
.cap-is .tgt:is(.a) { background-color: rgb(1, 2, 3) }
.cap-where :where(.tgt) { background-color: rgb(1, 2, 3) }
.cap-not span:not(.skip *) { background-color: rgb(1, 2, 3) }
.cap-has:has(> .kid) { background-color: rgb(1, 2, 3) }`
  document.body.append(stage, style)
  try {
    const hit = (sel: string): string => hitSel(stage, sel)
    const HIT = 'rgb(1, 2, 3)'
    caps[':is'] = hit('.cap-is .tgt') === HIT
    caps[':where'] = hit('.cap-where .tgt') === HIT
    caps[':not(complex)'] = hit('.cap-not .keep') === HIT && hit('.cap-not .skip-inner') !== HIT
    caps[':has'] = hit('.cap-has') === HIT
  } finally {
    stage.remove()
    style.remove()
  }

  // 规则级检测：构造表插入代表规则，看规则对象类型
  if (caps.constructedSheet === true) {
    const ruleKind = (text: string): string => {
      const sheet = new CSSStyleSheet()
      try {
        sheet.replaceSync(text)
      } catch (err) {
        return `解析异常：${String(err).slice(0, 80)}`
      }
      const first = sheet.cssRules.item(0)
      return first ? first.constructor.name : '(无规则)'
    }
    caps['@scope 规则类型'] = ruleKind('@scope ([data-x]) { p { color: red } }')
    caps['CSSScopeRule 全局'] = 'CSSScopeRule' in window
    caps['@layer 规则类型'] = ruleKind('@layer probe { p { color: red } }')
    caps['@container 规则类型'] = ruleKind('@container (min-width: 1px) { p { color: red } }')
    caps['嵌套规则'] = (() => {
      const sheet = new CSSStyleSheet()
      try {
        sheet.replaceSync('.probe-nest { & p { color: red } }')
        const outer = sheet.cssRules.item(0)
        return outer instanceof CSSStyleRule && outer.cssRules.length > 0
      } catch {
        return false
      }
    })()
  }

  // adoptedStyleSheets：document 与 shadow root 两侧
  try {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    caps['adoptedStyleSheets(document)'] = Array.isArray(document.adoptedStyleSheets)
    caps['adoptedStyleSheets(shadowRoot)'] = Array.isArray(shadow.adoptedStyleSheets)
    host.remove()
  } catch (err) {
    caps['adoptedStyleSheets'] = `探测异常：${String(err)}`
  }
  return caps
}

// ---------------------------------------------------------------------------
// 场景实现
// ---------------------------------------------------------------------------

interface RunContext {
  root: HTMLElement
  base: Map<string, string>
  snippetSim(): HTMLStyleElement
  docStyle(text: string, tag: string): HTMLStyleElement
}

async function scenarioBaseline(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  run.snippetSim()
  sf.readingView.innerHTML = aBlocksHtml(null) + embedCardHtml('b', bBlocksHtml(null) + embedCardHtml('c', cBlocksHtml(null)))
  // 基线入库（排除面「同基线」断言的参照系）
  sc.storeBase('toolbar.color', sf.toolbar, 'color')
  sc.storeBase('toolbar-btn.color', sf.toolbarBtn, 'color')
  sc.storeBase('cm-line.color', sf.cmLine, 'color')
  sc.storeBase('cm-strong.color', sf.cmStrong, 'color')
  sc.storeBase('a-md-h1.font-size', byId(run.root, `#${ID.aMdH1}`), 'font-size')
  sc.storeBase('a-md-h1.color', byId(run.root, `#${ID.aMdH1}`), 'color')
  sc.storeBase('a-strong.text-decoration-color', byId(run.root, `#${ID.aStrong}`), 'text-decoration-color')
  sc.storeBase('a-theme.color', byId(run.root, `#${ID.aTheme}`), 'color')
  sc.storeBase('embed-b-header.color', byId(run.root, '.vsidian-embed-card-header'), 'color')
  sc.row('toolbar.color', cssOf(sf.toolbar, 'color'), '基线入库')
  sc.row('cm-strong.color', cssOf(sf.cmStrong, 'color'), '基线入库')
  sc.row('a-md-h1.font-size', cssOf(byId(run.root, `#${ID.aMdH1}`), 'font-size'), '基线入库（生产标题规则值）')
  sc.row('a-strong.text-decoration-color', cssOf(byId(run.root, `#${ID.aStrong}`), 'text-decoration-color'), '基线入库（契约片段命中值）', 'rgb(16, 17, 18)')
  sc.row('a-theme.color', cssOf(byId(run.root, `#${ID.aTheme}`), 'color'), '基线入库（主题变量解析值）')
  sc.row('b-md-p.color', cssOf(byId(run.root, `#${ID.bMdP}`), 'color'), '基线入库')
}

async function scenarioShadowContent(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  const hostEl = document.createElement('div')
  sf.readingView.appendChild(hostEl)
  const shadow = hostEl.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${A_STYLE_1}\n${A_STYLE_2}\n@font-face { font-family: "probe-leak-font"; src: local("__no_such_probe_font__"); }</style>${aBlocksHtml(null)}${embedCardHtml('b', '')}`
  // B/C 各自嵌套 shadow：影子路由的「每文档一 shadow」形态
  const bShadow = byId<HTMLElement>(shadow, `#${ID.bHost}`).attachShadow({ mode: 'open' })
  bShadow.innerHTML = `<style>${B_STYLE}</style>${bBlocksHtml(null)}${embedCardHtml('c', '')}`
  const cShadow = byId<HTMLElement>(bShadow, `#${ID.cHost}`).attachShadow({ mode: 'open' })
  cShadow.innerHTML = `<style>${C_STYLE}</style>${cBlocksHtml(null)}`

  sc.rowEl('a-native-h1.color', shadow.querySelector(`#${ID.aNativeH1}`), 'color', '文档样式命中 shadow 内原生 h1', { expectValue: 'rgb(75, 0, 130)' })
  sc.rowEl('a-md-p.color', shadow.querySelector(`#${ID.aMdP}`), 'color', '文档样式命中 shadow 内 Markdown p', { expectValue: 'rgb(0, 0, 205)' })
  sc.rowSame('a-md-h1.font-size', shadow.querySelector(`#${ID.aMdH1}`), 'font-size')
  sc.row('a-md-h1.font-size.breakage', cssOf(byId(shadow, `#${ID.aMdH1}`), 'font-size'), '生产 CSS 断供证据（应≠基线值）')
  sc.rowSame('a-strong.text-decoration-color', shadow.querySelector(`#${ID.aStrong}`), 'text-decoration-color')
  sc.row('a-strong.text-decoration-color.breakage', cssOf(byId(shadow, `#${ID.aStrong}`), 'text-decoration-color'), '外部片段断供证据（应≠基线值）')
  sc.rowSame('a-theme.color', shadow.querySelector(`#${ID.aTheme}`), 'color')
  sc.rowEl('b-md-p.color', bShadow.querySelector(`#${ID.bMdP}`), 'color', 'B 自有样式命中', { expectValue: 'rgb(0, 128, 128)' })
  sc.rowNot('b-native-h1.color', bShadow.querySelector(`#${ID.bNativeH1}`), 'color', 'rgb(75, 0, 130)', 'A 的 h1{} 不达 B shadow（非 purple）')
  sc.rowEl('c-md-p.color', cShadow.querySelector(`#${ID.cMdP}`), 'color', 'C 自有样式命中', { expectValue: 'rgb(107, 142, 35)' })
  // A 的 div{} 规会命中 B 卡宿主（B host 是 A shadow 树内 div）→ 变量经宿主继承进 B shadow
  sc.rowEl('b-native-p.color', bShadow.querySelector(`#${ID.bNativeP}`), 'color', 'A 变量是否穿透进 B shadow（继承泄漏探测）', { expectValue: 'rgb(5, 5, 5)' })
  sc.rowSame('toolbar.color', sf.toolbar, 'color')
  sc.rowSame('cm-strong.color', sf.cmStrong, 'color')
  const families: string[] = []
  document.fonts.forEach((face) => families.push(face.family))
  sc.row('document.fonts.families', families.join(','), 'shadow 内 @font-face 是否泄漏进文档字体集')
  sc.notes.push('若 families 含 probe-leak-font：shadow 样式表内 @font-face 在该引擎按文档作用域生效（泄漏）；否则为 shadow 作用域。')
}

async function scenarioShadowAdopted(sc: ScenarioCollector, run: RunContext, env: CssScopeProbeEnv): Promise<void> {
  const sf = mountScaffold(run.root)
  const mainText = await env.readStylesheetText('main')
  const probeText = await env.readStylesheetText('probe')
  const hostEl = document.createElement('div')
  sf.readingView.appendChild(hostEl)
  const shadow = hostEl.attachShadow({ mode: 'open' })
  // 生产 CSS 的选择器链（#app … .vsidian-view-reading …）是外部上下文依赖：
  // shadow 内必须重建同一包装链，采纳的生产样式才能在 shadow 树内命中
  shadow.innerHTML = `<style>${A_STYLE_1}\n${A_STYLE_2}</style><div id="app"><div class="vsidian-view-reading">${aBlocksHtml(null)}${embedCardHtml('b', bBlocksHtml(null) + embedCardHtml('c', cBlocksHtml(null)))}</div></div>`
  const mainSheet = new CSSStyleSheet()
  mainSheet.replaceSync(mainText)
  const probeSheet = new CSSStyleSheet()
  probeSheet.replaceSync(probeText)
  shadow.adoptedStyleSheets = [probeSheet, mainSheet]
  sc.rowEl('a-md-h1.font-size', shadow.querySelector(`#${ID.aMdH1}`), 'font-size', '生产 CSS 采纳进 shadow 后恢复（重装变体）')
  sc.rowEl('a-md-p.color', shadow.querySelector(`#${ID.aMdP}`), 'color', '文档样式命中', { expectValue: 'rgb(0, 0, 205)' })
  sc.rowEl('b-md-p.color', shadow.querySelector(`#${ID.bMdP}`), 'color', 'B 段落（同树直染，shadow 单根形态）')
  sc.rowSame('toolbar.color', sf.toolbar, 'color')
  sc.notes.push('重装变体代价：每个 shadow root 都要复制采纳生产 CSS + 片段链（snippetLoader 现管 document.head，需第二套装配），嵌入/浮层每个内容根一份。')
}

async function scenarioShadowLiveWidget(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  const shared = new CSSStyleSheet()
  shared.replaceSync(`${A_STYLE_1}\n${A_STYLE_2}`)
  const widget = (label: string): { root: HTMLElement; h1: Element; p: Element } => {
    const root = document.createElement('div')
    root.setAttribute('data-probe-widget', label)
    sf.cmContent.appendChild(root)
    const shadow = root.attachShadow({ mode: 'open' })
    shadow.adoptedStyleSheets = [shared]
    shadow.innerHTML = `<h1>${label} H1</h1><p>${label} p</p>`
    return { root, h1: byId(shadow, 'h1'), p: byId(shadow, 'p') }
  }
  const w1 = widget('w1')
  const w2 = widget('w2')
  sc.rowEl('w1.h1.color', w1.h1, 'color', '共享 constructed sheet 命中 widget1', { expectValue: 'rgb(75, 0, 130)' })
  sc.rowEl('w2.h1.color', w2.h1, 'color', '同一共享 sheet 命中 widget2', { expectValue: 'rgb(75, 0, 130)' })
  sc.rowSame('cm-strong.color', sf.cmStrong, 'color')
  sc.rowSame('cm-line.color', sf.cmLine, 'color')
  // 虚拟化：卸下 widget1，widget2 与规则不受影响；重挂（新 widget 新 shadow 采纳同一 sheet）
  w1.root.remove()
  sc.rowEl('w2.h1.color(卸下w1后)', w2.h1, 'color', '规则不随块走', { expectValue: 'rgb(75, 0, 130)' })
  const w3 = widget('w3')
  sc.rowEl('w3.h1.color(重挂)', w3.h1, 'color', '重挂 widget 恢复绘制', { expectValue: 'rgb(75, 0, 130)' })
  sc.notes.push('Live 限制：sheet 在 shadow 内只命中 widget 内容，CM6 Markdown DOM（div/span）在光 DOM——文档样式无法按标签语义命中 Markdown（h1{} 不命中光 DOM）。')
}

async function scenarioPrefixNaive(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  run.snippetSim()
  sf.readingView.innerHTML = `<div class="vsidian-doc-scope-a">${aBlocksHtml(null)}${embedCardHtml('b', `<div class="vsidian-doc-scope-b">${bBlocksHtml(null)}${embedCardHtml('c', `<div class="vsidian-doc-scope-c">${cBlocksHtml(null)}</div>`)}</div>`)}</div>`
  run.docStyle(
    rewriteCss(`${A_STYLE_1}\n${A_STYLE_2}`, rewriteB1('vsidian-doc-scope-a'))
    + '\n' + rewriteCss(B_STYLE, rewriteB1('vsidian-doc-scope-b'))
    + '\n' + rewriteCss(C_STYLE, rewriteB1('vsidian-doc-scope-c')),
    'b1',
  )
  sc.rowEl('a-md-p.color', byId(run.root, `#${ID.aMdP}`), 'color', '命中本篇 Markdown p', { expectValue: 'rgb(0, 0, 205)' })
  sc.rowEl('a-native-h1.color', byId(run.root, `#${ID.aNativeH1}`), 'color', '命中原生 h1', { expectValue: 'rgb(75, 0, 130)' })
  sc.rowEl('b-native-h1.color', byId(run.root, `#${ID.bNativeH1}`), 'color', '包装内直染泄漏证人：A 的 h1{} 应染到 B 的 h1（purple）', { expectValue: 'rgb(75, 0, 130)' })
  sc.rowEl('b-md-p.color', byId(run.root, `#${ID.bMdP}`), 'color', '同特异性下 B 样式后置可掩盖直染（teal），泄漏以 h1/变量证人为准')
  sc.rowEl('b-native-p.color', byId(run.root, `#${ID.bNativeP}`), 'color', 'A 变量经包装继承泄漏进 B', { expectValue: 'rgb(222, 0, 111)' })
  sc.rowSame('toolbar.color', sf.toolbar, 'color')
  sc.rowSame('cm-strong.color', sf.cmStrong, 'color')
  sc.rowEl('a-p-tag.color', byId(run.root, `#${ID.aPTag}`), 'color', '特异性翻转证据：.scope p(0,1,1) 压过片段类(0,1,0)')
  sc.rowEl('a-p-order.color', byId(run.root, `#${ID.aPOrder}`), 'color', '同特异性时 doc 后置胜出')
  sc.notes.push('包装器形态（含嵌入卡在内的整片前缀）对「引用隔离」约束失败：直染与继承双泄漏——本场景即失败证据取样。')
}

async function scenarioPrefixPerBlock(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  run.snippetSim()
  sf.readingView.innerHTML = aBlocksHtml('a') + embedCardHtml('b', bBlocksHtml('b') + embedCardHtml('c', cBlocksHtml('c')))
  const styleEl = run.docStyle(
    rewriteCss(`${A_STYLE_1}\n${A_STYLE_2}`, rewriteB2('a'))
    + '\n' + rewriteCss(B_STYLE, rewriteB2('b'))
    + '\n' + rewriteCss(C_STYLE, rewriteB2('c')),
    'b2',
  )
  // M1 原生选择器形态
  sc.rowEl('a-native-h1.color', byId(run.root, `#${ID.aNativeH1}`), 'color', 'h1{}', { expectValue: 'rgb(75, 0, 130)' })
  sc.rowEl('a-native-h1.background-color', byId(run.root, `#${ID.aNativeH1}`), 'background-color', '.probe-a-cls{}', { expectValue: 'rgb(0, 128, 0)' })
  sc.rowEl('a-native-td.background-color', byId(run.root, `#${ID.aNativeTd}`), 'background-color', 'table td{}', { expectValue: 'rgb(255, 255, 0)' })
  sc.rowEl('a-native-h1.text-decoration-line', byId(run.root, `#${ID.aNativeH1}`), 'text-decoration-line', '[attr]{}', { expectValue: 'underline' })
  sc.rowEl('a-native-h1.text-decoration-color', byId(run.root, `#${ID.aNativeH1}`), 'text-decoration-color', '[attr]{} 配对', { expectValue: 'rgb(255, 0, 255)' })
  sc.rowEl('a-pe::before.content', byId(run.root, `#${ID.aPe}`), 'content', '.probe-pe::before', { pseudo: '::before', expectValue: '"PE"' })
  sc.rowEl('a-pe::before.color', byId(run.root, `#${ID.aPe}`), 'color', '::before 配色', { pseudo: '::before', expectValue: 'rgb(1, 2, 3)' })
  sc.rowEl('a-sib-target.color', byId(run.root, `#${ID.aSibTarget}`), 'color', '.probe-sib + .probe-sib-target', { expectValue: 'rgb(9, 8, 7)' })
  sc.rowEl('a-child.border-color', byId(run.root, `#${ID.aProbeChild}`), 'border-color', '.probe-parent > .probe-child', { expectValue: 'rgb(4, 5, 6)' })
  sc.rowEl('a-pseudo-cls.letter-spacing', byId(run.root, `#${ID.aPseudoCls}`), 'letter-spacing', '.probe-fam p:nth-child(2)', { expectValue: '5px' })
  sc.rowEl('a-media.color', byId(run.root, `#${ID.aMedia}`), 'color', '@media 内规则（改写递归下钻）', { expectValue: 'rgb(60, 60, 61)' })
  // M2 Markdown DOM 同规则
  sc.rowEl('a-md-p.color', byId(run.root, `#${ID.aMdP}`), 'color', 'Markdown p 同规则命中', { expectValue: 'rgb(0, 0, 205)' })
  sc.rowEl('a-md-h1.color', byId(run.root, `#${ID.aMdH1}`), 'color', 'Markdown h1 同规则命中（元素直染胜过包装继承）', { expectValue: 'rgb(75, 0, 130)' })
  // M3 排除面
  sc.rowSame('toolbar.color', sf.toolbar, 'color')
  sc.rowSame('toolbar-btn.color', sf.toolbarBtn, 'color')
  sc.rowSame('cm-line.color', sf.cmLine, 'color')
  sc.rowSame('cm-strong.color', sf.cmStrong, 'color')
  sc.rowEl('b-md-p.color', byId(run.root, `#${ID.bMdP}`), 'color', 'B 隔离（teal 非 blue）', { expectValue: 'rgb(0, 128, 128)' })
  sc.rowNot('b-native-h1.color', byId(run.root, `#${ID.bNativeH1}`), 'color', 'rgb(75, 0, 130)', 'B 隔离：A 的 h1{} 不达 B（非 purple）')
  sc.rowEl('c-md-p.color', byId(run.root, `#${ID.cMdP}`), 'color', 'C 隔离（olive 非 blue）', { expectValue: 'rgb(107, 142, 35)' })
  sc.rowSame('embed-b-header.color', run.root.querySelector('.vsidian-embed-card-header'), 'color')
  // M4 继承与变量
  sc.rowEl('b-native-p.color', byId(run.root, `#${ID.bNativeP}`), 'color', 'A 变量不泄漏进 B（fallback 生效）', { expectValue: 'rgb(5, 5, 5)' })
  sc.rowEl('a-var.color', byId(run.root, `#${ID.aVar}`), 'color', 'A 变量本篇可用', { expectValue: 'rgb(222, 0, 111)' })
  sc.rowEl('a-var-root.color', byId(run.root, `#${ID.aVarRoot}`), 'color', ':root 规则改写后失活（fallback）', { expectValue: 'rgb(7, 7, 7)' })
  sc.row('body.--a-body-mark', cssOf(document.body, '--a-body-mark'), 'body 规则改写后失活（空值）', '')
  sc.rowSame('a-theme.color', byId(run.root, `#${ID.aTheme}`), 'color')
  // M5 层叠与片段关系
  sc.rowEl('a-p-order.color', byId(run.root, `#${ID.aPOrder}`), 'color', '同特异性(0,1,0)：doc 后置胜片段（indianred）', { expectValue: 'rgb(205, 92, 92)' })
  sc.rowEl('a-p-tag.color', byId(run.root, `#${ID.aPTag}`), 'color', '特异性语义保持：片段类(0,1,0)>doc 标签(0,0,1)（seagreen）', { expectValue: 'rgb(46, 139, 87)' })
  sc.rowEl('a-md-h1.font-size', byId(run.root, `#${ID.aMdH1}`), 'font-size', '生产标题规则不受影响')
  // M7 历史片段兼容
  sc.rowSame('a-strong.text-decoration-color', byId(run.root, `#${ID.aStrong}`), 'text-decoration-color')
  // M6/M8 虚拟化与源码显形
  const htmlBlock = byId<HTMLElement>(run.root, '.vsidian-html-block')
  const ruleCount = styleEl.sheet ? styleEl.sheet.cssRules.length : -1
  htmlBlock.remove()
  sc.rowEl('a-md-p.color(卸下原生块后)', byId(run.root, `#${ID.aMdP}`), 'color', '规则不随块走', { expectValue: 'rgb(0, 0, 205)' })
  sc.rowEl('b-md-p.color(卸下原生块后)', byId(run.root, `#${ID.bMdP}`), 'color', '其他文档不受卸载影响', { expectValue: 'rgb(0, 128, 128)' })
  sc.row('sheet.rules(卸下前后)', String(ruleCount) + '→' + (styleEl.sheet ? styleEl.sheet.cssRules.length : -1), '文档样式规则数稳定', `${ruleCount}→${ruleCount}`)
  sf.readingView.insertBefore(htmlBlock, sf.readingView.firstChild)
  sc.rowEl('a-native-h1.color(重挂)', byId(run.root, `#${ID.aNativeH1}`), 'color', '重挂恢复绘制', { expectValue: 'rgb(75, 0, 130)' })
}

async function scenarioAtScope(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  run.snippetSim()
  sf.readingView.innerHTML = aBlocksHtml('a') + embedCardHtml('b', bBlocksHtml('b') + embedCardHtml('c', cBlocksHtml('c')))
  const text = `@scope ([data-doc="a"]) to (.vsidian-embed-card) {\n${A_STYLE_1}\n${A_STYLE_2}\n}\n@scope ([data-doc="b"]) to (.vsidian-embed-card) {\n${B_STYLE}\n}\n@scope ([data-doc="c"]) {\n${C_STYLE}\n}`
  const styleEl = run.docStyle(text, 'c')
  const kinds: string[] = []
  if (styleEl.sheet) {
    for (const rule of Array.from(styleEl.sheet.cssRules)) kinds.push(rule.constructor.name)
  }
  sc.row('sheet.rule-kinds', kinds.join(',') || '(空)', '规则对象类型（CSSScopeRule=支持；CSSUnknownRule/CSSStyleRule 退化=不支持）')
  sc.rowEl('a-native-h1.color', byId(run.root, `#${ID.aNativeH1}`), 'color', '@scope 命中即 purple；114 预期不命中（≠基线即支持）')
  sc.rowEl('a-md-p.color', byId(run.root, `#${ID.aMdP}`), 'color', '同上')
  sc.rowEl('b-md-p.color', byId(run.root, `#${ID.bMdP}`), 'color', 'donut 上边界隔离 B（teal=隔离成立）')
  sc.rowSame('toolbar.color', sf.toolbar, 'color')
  sc.rowEl('a-p-tag.color', byId(run.root, `#${ID.aPTag}`), 'color', '@scope 不改特异性（seagreen=语义保持）')
  sc.notes.push('Chromium 114（Chrome 118 起 @scope 进 stable）预期：规则不生效且命中值=基线——本场景即淘汰证据取样；现代 Chromium 应全绿。')
}

/** srcdoc 帧内容就绪轮询：load 事件可能早于 srcdoc 导航完成（首版实测竞速），
 *  以内容元素出现为准；超时静默返回（调用侧以 URL/元素缺失记录拦截证据）。 */
async function waitFrameContent(frame: HTMLIFrameElement, probeSel: string, timeoutMs = 5000): Promise<void> {
  const t0 = performance.now()
  while (performance.now() - t0 < timeoutMs) {
    if (frame.contentDocument?.querySelector(probeSel)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function scenarioIframe(sc: ScenarioCollector, run: RunContext): Promise<void> {
  const sf = mountScaffold(run.root)
  const frame = document.createElement('iframe')
  frame.setAttribute('data-probe-frame', 'a')
  frame.width = '480'
  frame.height = '360'
  frame.style.border = '0'
  frame.srcdoc = `<!DOCTYPE html><html><head><style>${A_STYLE_1}\n${A_STYLE_2}</style></head><body>${aBlocksHtml(null)}${embedCardHtml('b', '')}</body></html>`
  sf.readingView.appendChild(frame)
  await waitFrameContent(frame, `#${ID.aMdH1}`)
  const doc = frame.contentDocument
  sc.row('frame-a.url', doc?.URL ?? '不可访问', 'about:srcdoc=装载成功；about:blank=被 CSP 拦截或未装载')
  sc.row('frame-a.access', doc ? `readyState=${doc.readyState}` : '不可访问', 'srcdoc 同源可访问性（生产 CSP frame-src https: 下的实测）')
  if (!doc) {
    sc.notes.push('srcdoc iframe 不可访问：可能被 CSP frame-src 拦截或未装载——记录为该环境的淘汰/边界证据。')
    sc.rowSame('toolbar.color', sf.toolbar, 'color')
    return
  }
  const win = frame.contentWindow ?? window
  // B 嵌套 iframe（B 自有 style + C 再嵌套）
  const bHost = doc.querySelector(`#${ID.bHost}`)
  const bFrame = doc.createElement('iframe')
  bFrame.setAttribute('data-probe-frame', 'b')
  bFrame.width = '440'
  bFrame.height = '200'
  bFrame.srcdoc = `<!DOCTYPE html><html><head><style>${B_STYLE}</style></head><body>${bBlocksHtml(null)}${embedCardHtml('c', '')}</body></html>`
  bHost?.appendChild(bFrame)
  await waitFrameContent(bFrame, `#${ID.bMdP}`)
  const bDoc = bFrame.contentDocument
  const bWin = bFrame.contentWindow ?? win
  let cFrameReady = false
  let cMdPColor = '<未构造>'
  if (bDoc) {
    const cHost = bDoc.querySelector(`#${ID.cHost}`)
    const cFrame = bDoc.createElement('iframe')
    cFrame.srcdoc = `<!DOCTYPE html><html><head><style>${C_STYLE}</style></head><body>${cBlocksHtml(null)}</body></html>`
    cFrame.width = '400'
    cFrame.height = '80'
    cHost?.appendChild(cFrame)
    await waitFrameContent(cFrame, `#${ID.cMdP}`)
    const cP = cFrame.contentDocument?.querySelector(`#${ID.cMdP}`)
    cFrameReady = !!cFrame.contentDocument && !!cP
    if (cP && cFrame.contentWindow) cMdPColor = cssOf(cP, 'color', { win: cFrame.contentWindow })
  }
  sc.rowEl('a-md-h1.color(帧内)', doc.querySelector(`#${ID.aMdH1}`), 'color', 'A 文档样式在自有 iframe 内命中 Markdown h1', { win })
  sc.rowEl('a-native-h1.color(帧内)', doc.querySelector(`#${ID.aNativeH1}`), 'color', '原生 h1 同命中', { win, expectValue: 'rgb(75, 0, 130)' })
  sc.rowEl('a-md-h1.font-size(帧内)', doc.querySelector(`#${ID.aMdH1}`), 'font-size', '生产 CSS 不在帧内（应≠基线值）', { win })
  sc.rowEl('a-theme.color(帧内)', doc.querySelector(`#${ID.aTheme}`), 'color', '主题变量不进帧（fallback rgb(64,64,64)）', { win, expectValue: 'rgb(64, 64, 64)' })
  sc.rowEl('a-strong.text-decoration-color(帧内)', doc.querySelector(`#${ID.aStrong}`), 'text-decoration-color', '外部片段不进帧（≠基线值）', { win })
  sc.row('b-frame.access', bDoc ? 'ok' : '不可访问', '嵌套 srcdoc（B）')
  if (bDoc) {
    sc.rowEl('b-md-p.color(帧内)', bDoc.querySelector(`#${ID.bMdP}`), 'color', 'B 自有样式帧内命中（teal）', { win: bWin, expectValue: 'rgb(0, 128, 128)' })
  }
  sc.row('c-frame.access', cFrameReady ? 'ok' : '不可访问', '二重嵌套 srcdoc（C）')
  sc.row('c-md-p.color(帧内)', cMdPColor, 'C 自有样式帧内命中（olive）', 'rgb(107, 142, 35)')
  sc.rowSame('toolbar.color', sf.toolbar, 'color')
  sc.rowSame('cm-strong.color', sf.cmStrong, 'color')
  sc.notes.push('iframe 隔离成立但生产 CSS/主题变量/片段全数断供（需每帧重装）；Live 的 Markdown DOM 在帧外，帧内样式无法命中——结构性不满足「同规则命中原生+Markdown」。')
}

// ---------------------------------------------------------------------------
// b2 视觉取证挂载（截图用）：按获选路线形态挂一份脚手架 + 改写后的文档样式，
// 供浏览器 harness 截图留证；不影响矩阵结果。
// ---------------------------------------------------------------------------

export function mountB2Demo(): void {
  document.querySelectorAll('[data-css-scope-probe-root]').forEach((el) => el.remove())
  const root = document.createElement('div')
  root.setAttribute('data-css-scope-probe-root', '')
  document.body.appendChild(root)
  const sf = mountScaffold(root)
  const snippet = document.createElement('style')
  snippet.setAttribute('data-probe-snippet-sim', '')
  snippet.textContent = SNIPPET_SIM
  document.head.appendChild(snippet)
  sf.readingView.innerHTML = aBlocksHtml('a') + embedCardHtml('b', bBlocksHtml('b') + embedCardHtml('c', cBlocksHtml('c')))
  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-probe-doc-style', 'b2-demo')
  styleEl.textContent = rewriteCss(`${A_STYLE_1}\n${A_STYLE_2}`, rewriteB2('a'))
    + '\n' + rewriteCss(B_STYLE, rewriteB2('b'))
    + '\n' + rewriteCss(C_STYLE, rewriteB2('c'))
  document.head.appendChild(styleEl)
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function runCssScopeProbe(env: CssScopeProbeEnv): Promise<CssScopeProbeResult> {
  const result: CssScopeProbeResult = {
    env: { label: env.label, userAgent: navigator.userAgent, startedAt: new Date().toISOString() },
    capabilities: collectCapabilities(),
    scenarios: [],
  }
  const root = document.createElement('div')
  root.setAttribute('data-css-scope-probe-root', '')
  document.body.appendChild(root)
  const createdStyles: HTMLStyleElement[] = []
  const base = new Map<string, string>()

  const run: RunContext = {
    root,
    base,
    snippetSim(): HTMLStyleElement {
      const el = document.createElement('style')
      el.setAttribute('data-probe-snippet-sim', '')
      el.textContent = SNIPPET_SIM
      document.head.appendChild(el)
      createdStyles.push(el)
      return el
    },
    docStyle(text: string, tag: string): HTMLStyleElement {
      const el = document.createElement('style')
      el.setAttribute('data-probe-doc-style', tag)
      el.textContent = text
      document.head.appendChild(el)
      createdStyles.push(el)
      return el
    },
  }

  const scenario = async (route: string, summary: string, fn: (sc: ScenarioCollector, run: RunContext) => Promise<void>): Promise<void> => {
    root.innerHTML = ''
    const sc = new ScenarioCollector(route, summary, base)
    try {
      await fn(sc, run)
    } catch (err) {
      sc.notes.push(`场景异常：${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    }
    result.scenarios.push(sc)
    for (const el of createdStyles.splice(0)) el.remove()
  }

  await scenario('baseline', '基线：无文档样式，生产 CSS + 契约片段 + 片段仿真下的参照读值', scenarioBaseline)
  await scenario('a1-shadow-content', 'Shadow DOM：Reading 内容整体进 shadow root，文档样式挂 shadow 内', (sc) => scenarioShadowContent(sc, run))
  await scenario('a2-shadow-adopted', 'Shadow DOM 重装变体：生产 CSS/片段以 constructed sheet 采纳进 shadow', (sc) => scenarioShadowAdopted(sc, run, env))
  await scenario('a3-shadow-live-widget', 'Shadow DOM Live 变体：widget 级 shadow 共享 constructed sheet', (sc) => scenarioShadowLiveWidget(sc, run))
  await scenario('b1-prefix-naive', '前缀改写（朴素）：包装器类前缀，嵌入卡在包装内', (sc) => scenarioPrefixNaive(sc, run))
  await scenario('b2-prefix-perblock', '前缀改写（逐块）：data-doc 标记 + :where():is() 零特异性', (sc) => scenarioPrefixPerBlock(sc, run))
  await scenario('c-at-scope', 'CSS @scope（donut 上边界），Chromium 114 可用性实测', (sc) => scenarioAtScope(sc, run))
  await scenario('d-iframe-srcdoc', '每文档 iframe（srcdoc，嵌套 B/C）', (sc) => scenarioIframe(sc, run))

  root.remove()
  return result
}
