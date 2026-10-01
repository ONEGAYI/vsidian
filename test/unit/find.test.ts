// @vitest-environment jsdom
// 编辑区查找会话契约（工单 #14，#236 起引擎换 @codemirror/search、
// 三开关面板与替换写回）：
// - 查找基于 webview 全文文本模型：屏外（CM6 视口外 / 阅读视图未挂载块）
//   内容同样命中——断言来自文本模型坐标，不用 DOM 遍历冒充全文匹配
// - 只读契约修订（#236）：纯查找交互（打开/输入/导航/开关切换/关闭）
//   零 edit.request、文本逐字节不变；替换是显式写操作（一笔 edit.request）
// - 三开关（matchCase/wholeWord/regexp）：面板按钮点亮=选项开启；切换
//   即重算匹配并出站 findOptions.set 持久化（workspace 级记忆通道）
// - 非法正则不崩且有可见反馈（输入框 invalid 类 + 「无结果」计数）
// - 替换栏：Ctrl+H / view.find.open{replace:true} 展开；替换下一个与
//   全部替换各为单笔写回（一笔撤销）；阅读模式只读不执行替换
// - Ctrl+F 种子行为对齐 VSCode：单行非空选区填入搜索词
// - 焦点与 Esc：打开聚焦输入框；Esc 关闭并把焦点归还编辑区（live 回 CM6）
// - 定位协同：live 侧选区+滚动；reading 侧源位置锚点映射到块并滚动；
//   模式切换保活查找会话，当前匹配位置经源锚点映射恢复
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { findStateField } from '../../src/webview/findSession'
import { FIND_OPTIONS_DEFAULT } from '../../src/shared/findOptions'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

// #94 起文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/find.md'

const DOC = [
  '# 查找样例标题',
  '',
  '第一段：这里有一个目标词，后续还有。',
  '',
  '中间段落没有命中内容。',
  '',
  '第二段：又出现目标词了。',
  '',
  '- 列表项包含目标词',
  '',
  '包含 emoji：🎉 与目标词相邻。',
  '',
  '结尾段落。',
  '',
].join('\n')

/** DOC 中 '目标词' 的全部出现位置（UTF-16 offset） */
const HIT_OFFSETS: number[] = (() => {
  const out: number[] = []
  let at = DOC.indexOf('目标词')
  while (at !== -1) {
    out.push(at)
    at = DOC.indexOf('目标词', at + 1)
  }
  return out
})()

interface BridgeHarness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(): BridgeHarness {
  const sent: WebviewToHost[] = []
  let state: Record<string, unknown> | undefined
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: <T,>() => state as T | undefined,
    setState: (s) => {
      state = s as Record<string, unknown>
    },
  }
  return { bridge, sent }
}

let parent: HTMLElement | undefined

function mountFind(h: BridgeHarness, text = DOC, version = 1): WebviewSyncController {
  const c = new WebviewSyncController(h.bridge)
  parent = document.createElement('div')
  document.body.appendChild(parent) // 焦点断言需要真实挂载
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version, text })
  return c
}

function viewState(c: WebviewSyncController, h: BridgeHarness) {
  const before = h.sent.length
  c.handleHostMessage({ kind: 'view.state.request' })
  const msg = h.sent.slice(before).find((m) => m.kind === 'view.state')
  if (!msg) {
    throw new Error('view.state 未回报')
  }
  return msg as Extract<WebviewToHost, { kind: 'view.state' }>
}

function editRequestCount(h: BridgeHarness): number {
  return h.sent.filter((m) => m.kind === 'edit.request').length
}

function findPanel(): HTMLElement | null {
  return parent?.querySelector<HTMLElement>('.vsidian-find') ?? null
}

function findInput(): HTMLInputElement | null {
  return parent?.querySelector<HTMLInputElement>('.vsidian-find-input') ?? null
}

function replaceInput(): HTMLInputElement | null {
  return parent?.querySelector<HTMLInputElement>('.vsidian-find-replace-input') ?? null
}

function key(target: EventTarget, k: string, opts: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }),
  )
}

beforeEach(() => {
  parent = undefined
})

afterEach(() => {
  parent?.remove()
  parent = undefined
})

describe('打开与关闭（焦点契约）', () => {
  it('view.find.open 打开面板：DOM 存在、可见、输入框获得焦点', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open' })
    const panel = findPanel()
    expect(panel).not.toBeNull()
    expect(panel!.classList.contains('vsidian-find-open')).toBe(true)
    expect(document.activeElement).toBe(findInput())
    const state = viewState(c, h)
    expect(state.find?.open).toBe(true)
    expect(state.find?.total).toBe(0)
  })

  it('webview 内 Mod-F 打开查找（Ctrl/Cmd+F 拦截），再次按下重新聚焦输入框', () => {
    const h = makeBridge()
    const c = mountFind(h)
    key(document, 'f', { ctrlKey: true })
    expect(viewState(c, h).find?.open).toBe(true)
    expect(document.activeElement).toBe(findInput())
    // 焦点被移走后再按 Mod-F：重新聚焦（VSCode find 同款手感）。
    // #38：webview 工具栏移除后，借临时按钮把焦点移出查找输入框
    const other = document.createElement('button')
    parent!.appendChild(other)
    other.focus()
    expect(document.activeElement).not.toBe(findInput())
    key(document, 'f', { metaKey: true })
    expect(document.activeElement).toBe(findInput())
  })

  it('Ctrl+F 种子行为对齐 VSCode：单行非空选区填入搜索词并全选', () => {
    const h = makeBridge()
    const c = mountFind(h)
    // 选中正文第一段的「目标词」
    const view = c.getView()!
    view.dispatch({ selection: { anchor: HIT_OFFSETS[0]!, head: HIT_OFFSETS[0]! + 3 } })
    key(document, 'f', { ctrlKey: true })
    expect(viewState(c, h).find?.query).toBe(DOC.slice(HIT_OFFSETS[0]!, HIT_OFFSETS[0]! + 3))
    expect(viewState(c, h).find?.total).toBe(HIT_OFFSETS.length)
    // 无选区（收起选区）再打开：保持既有查询词（不覆盖为空）
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    key(document, 'f', { ctrlKey: true })
    expect(viewState(c, h).find?.query).toBe('目标词')
  })

  it('多行选区不填入（VSCode 口径：仅单行选区作种子）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    const view = c.getView()!
    const from = DOC.indexOf('第一段')
    view.dispatch({ selection: { anchor: from, head: DOC.indexOf('第二段') } })
    key(document, 'f', { ctrlKey: true })
    expect(viewState(c, h).find?.query).toBe('')
    expect(viewState(c, h).find?.total).toBe(0)
  })

  it('无修饰的 f 键不触发查找（不打扰正常输入）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    key(document, 'f')
    // 从未打开过：find 观测缺省（首次打开后回报 open:false）
    expect(viewState(c, h).find).toBeUndefined()
  })

  it('view.find.close 关闭：面板隐藏、状态回报关闭、装饰清空', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    c.handleHostMessage({ kind: 'view.find.close' })
    expect(findPanel()!.classList.contains('vsidian-find-open')).toBe(false)
    expect(viewState(c, h).find?.open).toBe(false)
    expect(c.getView()!.state.field(findStateField).matches.length).toBe(0)
  })

  it('Esc 关闭并把焦点归还编辑区（live 模式回 CM6）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const input = findInput()!
    key(input, 'Escape')
    expect(viewState(c, h).find?.open).toBe(false)
    expect(c.getView()!.hasFocus).toBe(true)
    // 关闭后装饰清空
    expect(c.getView()!.state.field(findStateField).matches.length).toBe(0)
  })
})

describe('图标按钮形态（对齐 VSCode 原生浮层）', () => {
  it('导航与替换按钮为图标形态：本体无文字（CSS 背景图标），aria-label/title 承载功能词', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const cases: Array<{ cls: string; word: string }> = [
      { cls: '.vsidian-find-prev', word: '上一个匹配' },
      { cls: '.vsidian-find-next', word: '下一个匹配' },
      { cls: '.vsidian-find-close', word: '关闭查找' },
      { cls: '.vsidian-find-replace-next', word: '替换' },
      { cls: '.vsidian-find-replace-all', word: '全部替换' },
    ]
    for (const { cls, word } of cases) {
      const btn = parent!.querySelector<HTMLButtonElement>(cls)!
      expect(btn, cls).toBeDefined()
      // SVG 资产经 CSS 背景呈现（规则由 findPanelCssContract 钉住），按钮
      // 本体不得残留占位字形或任何文字
      expect(btn.textContent, `${cls} 本体应为纯图标（无文字）`).toBe('')
      expect(btn.getAttribute('aria-label'), `${cls} 可访问名称`).toBe(word)
      expect(btn.getAttribute('title'), `${cls} 悬停提示`).toBe(word)
    }
  })
})

describe('主行布局（三开关嵌入输入框容器）', () => {
  it('输入框容器包住主输入与三开关（原生同构），计数与导航在容器外', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const wrap = parent!.querySelector('.vsidian-find-inputwrap')!
    expect(wrap.querySelector('.vsidian-find-input')).not.toBeNull()
    expect(wrap.querySelector('.vsidian-find-case')).not.toBeNull()
    expect(wrap.querySelector('.vsidian-find-word')).not.toBeNull()
    expect(wrap.querySelector('.vsidian-find-regexp')).not.toBeNull()
    // 计数与导航按钮留在容器外（原生同序：输入+开关 → 计数 → 导航）
    expect(wrap.querySelector('.vsidian-find-count')).toBeNull()
    expect(wrap.querySelector('.vsidian-find-prev')).toBeNull()
  })

  it('空查询不标红不占位：计数收起（隐藏类），键入后展开', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open' })
    expect(findInput()!.classList.contains('vsidian-find-input-invalid')).toBe(false)
    const count = parent!.querySelector<HTMLElement>('.vsidian-find-count')!
    expect(count.textContent).toBe('')
    expect(count.classList.contains('vsidian-find-count-empty')).toBe(false)
    // 空查询是未搜索：计数区域整体收起（不预留「当前/总数」空白）
    expect(count.classList.contains('vsidian-find-count-hidden')).toBe(true)
    // 键入查询后展开回计数形态
    findInput()!.value = '目'
    findInput()!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(count.classList.contains('vsidian-find-count-hidden')).toBe(false)
    expect(count.classList.contains('vsidian-find-count-empty')).toBe(false)
    // 清空回未搜索态：再次收起
    findInput()!.value = ''
    findInput()!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(count.classList.contains('vsidian-find-count-hidden')).toBe(true)
  })
})

describe('匹配计算与反馈（基于文本模型，含中文与 emoji）', () => {
  it('open 带 query：total 与文本模型一致（中文+emoji 文档），当前匹配为参考位置后首个', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const state = viewState(c, h)
    expect(state.find?.total).toBe(HIT_OFFSETS.length)
    expect(state.find?.query).toBe('目标词')
    // 光标在 0：当前 = 第一个匹配
    expect(state.find?.index).toBe(1)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[0])
    expect(state.find?.currentTo).toBe(HIT_OFFSETS[0]! + '目标词'.length)
    expect(state.find?.valid).toBe(true)
  })

  it('计数显示「第 n 项，共 total 项」；无匹配显示「无结果」且带空态类', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const count = parent!.querySelector<HTMLElement>('.vsidian-find-count')!
    expect(count.textContent).toBe(`第 1 项，共 ${HIT_OFFSETS.length} 项`)
    // 输入不存在的词
    const input = findInput()!
    input.value = '不存在的词'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(count.textContent).toBe('无结果')
    expect(count.classList.contains('vsidian-find-count-empty')).toBe(true)
    const state = viewState(c, h)
    expect(state.find?.total).toBe(0)
    expect(state.find?.index).toBe(0)
    expect(state.find?.currentFrom).toBeNull()
  })

  it('emoji 查询按码点命中：🎉 查询计数与文本一致', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '🎉' })
    expect(viewState(c, h).find?.total).toBe(1)
    expect(viewState(c, h).find?.currentFrom).toBe(DOC.indexOf('🎉'))
  })

  it('大小写开关（matchCase）：默认不区分，Aa 点亮后区分并重算', () => {
    const h = makeBridge()
    const text = 'Hello hello HELLO\n中文编辑测试\n'
    const c = mountFind(h, text)
    c.handleHostMessage({ kind: 'view.find.open', query: 'hello' })
    // 默认（matchCase=false）：全部命中
    expect(viewState(c, h).find?.matchCase).toBe(false)
    expect(viewState(c, h).find?.total).toBe(3)
    const btn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-case')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.classList.contains('vsidian-find-case-active')).toBe(false)
    btn.click()
    // 点亮 = 区分大小写（active 类与 aria-pressed 同步）
    expect(btn.classList.contains('vsidian-find-case-active')).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    const state = viewState(c, h)
    expect(state.find?.matchCase).toBe(true)
    expect(state.find?.total).toBe(1)
    // 再点回不区分
    btn.click()
    expect(viewState(c, h).find?.matchCase).toBe(false)
    expect(viewState(c, h).find?.total).toBe(3)
  })

  it('全字开关（wholeWord）：点亮后词内命中被排除', () => {
    const h = makeBridge()
    const c = mountFind(h, 'cat catfish catalog\ncat.\n')
    c.handleHostMessage({ kind: 'view.find.open', query: 'cat' })
    expect(viewState(c, h).find?.total).toBe(4)
    const btn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-word')!
    expect(btn.classList.contains('vsidian-find-word-active')).toBe(false)
    btn.click()
    expect(btn.classList.contains('vsidian-find-word-active')).toBe(true)
    const state = viewState(c, h)
    expect(state.find?.wholeWord).toBe(true)
    expect(state.find?.total).toBe(2)
    expect(state.find?.currentFrom).toBe(0)
  })

  it('正则开关（regexp）：点亮后按模式匹配', () => {
    const h = makeBridge()
    const c = mountFind(h, 'a1b2c3\n')
    c.handleHostMessage({ kind: 'view.find.open', query: '\\d' })
    // 字面量模式：不命中
    expect(viewState(c, h).find?.total).toBe(0)
    const btn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-regexp')!
    btn.click()
    expect(btn.classList.contains('vsidian-find-regexp-active')).toBe(true)
    const state = viewState(c, h)
    expect(state.find?.regexp).toBe(true)
    expect(state.find?.total).toBe(3)
    expect(state.find?.currentFrom).toBe(1)
  })

  it('find.test.toggle 测试钩子：点击三开关真实按钮，驱动与用户点击同一链路', () => {
    const h = makeBridge()
    const c = mountFind(h, 'a1b2c3\n')
    c.handleHostMessage({ kind: 'view.find.open', query: '\\d' })
    // 字面量模式：不命中
    expect(viewState(c, h).find?.total).toBe(0)
    // 钩子驱动 regexp 开关（与用户点击同一按钮同一处理器）
    c.handleHostMessage({ kind: 'find.test.toggle', key: 'regexp' })
    const btn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-regexp')!
    expect(btn.classList.contains('vsidian-find-regexp-active')).toBe(true)
    const state = viewState(c, h)
    expect(state.find?.regexp).toBe(true)
    expect(state.find?.total).toBe(3)
    // 开关切换经 findOptions.set 上送宿主（持久化通道不因钩子路径旁路）
    expect(h.sent.some((m) => m.kind === 'findOptions.set' && m.options.regexp === true)).toBe(true)
    // 再切一次回到字面量：匹配随之回落
    c.handleHostMessage({ kind: 'find.test.toggle', key: 'regexp' })
    expect(viewState(c, h).find?.regexp).toBe(false)
    expect(viewState(c, h).find?.total).toBe(0)
  })

  it('非法正则不崩且有可见反馈：输入框 invalid 类 + 「无结果」计数 + valid=false', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '(' })
    const regBtn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-regexp')!
    regBtn.click()
    const input = findInput()!
    const count = parent!.querySelector<HTMLElement>('.vsidian-find-count')!
    expect(count.textContent).toBe('无结果')
    expect(count.classList.contains('vsidian-find-count-empty')).toBe(true)
    expect(input.classList.contains('vsidian-find-input-invalid')).toBe(true)
    const state = viewState(c, h)
    expect(state.find?.valid).toBe(false)
    expect(state.find?.total).toBe(0)
    // 修正为合法正则：反馈撤下、恢复命中
    input.value = '\\d+'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.classList.contains('vsidian-find-input-invalid')).toBe(false)
    expect(viewState(c, h).find?.valid).toBe(true)
    expect(viewState(c, h).find?.total).toBe(0)
    // 换回字面量查询：恢复既有命中计数
    input.value = '目标词'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(viewState(c, h).find?.total).toBe(HIT_OFFSETS.length)
  })
})

describe('循环导航（上一项/下一项）', () => {
  it('next 顺序前进，prev 后退，两端循环', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const total = HIT_OFFSETS.length
    expect(total).toBeGreaterThanOrEqual(3)
    let state = viewState(c, h)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[0])
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    state = viewState(c, h)
    expect(state.find?.index).toBe(2)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[1])
    // 从第 1 个连按 total 次 next：回到第 1 个（循环导航）
    for (let i = 2; i <= total; i++) {
      c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    }
    state = viewState(c, h)
    expect(state.find?.index).toBe(1)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[0])
    c.handleHostMessage({ kind: 'view.find.step', direction: 'prev' })
    state = viewState(c, h) // 从第 1 个 prev：回绕到末个
    expect(state.find?.index).toBe(total)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[total - 1])
  })

  it('输入框 Enter 下一个、Shift+Enter 上一个', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const input = findInput()!
    key(input, 'Enter')
    expect(viewState(c, h).find?.currentFrom).toBe(HIT_OFFSETS[1])
    key(input, 'Enter', { shiftKey: true })
    expect(viewState(c, h).find?.currentFrom).toBe(HIT_OFFSETS[0])
  })

  it('无匹配时 next/prev 不动作、不抛错', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '不存在' })
    expect(() =>
      c.handleHostMessage({ kind: 'view.find.step', direction: 'next' }),
    ).not.toThrow()
    expect(viewState(c, h).find?.index).toBe(0)
  })
})

describe('定位协同：live 选区与阅读视图块级定位', () => {
  it('live：next 把选区移到当前匹配并选中（屏外段落同样定位）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    const view = c.getView()!
    const sel = view.state.selection.main
    expect(sel.from).toBe(HIT_OFFSETS[1])
    expect(sel.to).toBe(HIT_OFFSETS[1]! + '目标词'.length)
    // modeAnchor 同步为当前匹配 from：模式切换映射用（与 view.locate 同语义）
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const state = viewState(c, h)
    expect(state.find?.open).toBe(true) // 会话保活
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[1])
  })

  it('reading：定位到当前匹配所在块并块级高亮；close 清除高亮', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    // 导航到列表项里的匹配：HIT_OFFSETS 中位于 '- 列表项包含目标词' 行的那个
    const listLineStart = DOC.indexOf('- 列表项包含目标词')
    const listHitIdx = HIT_OFFSETS.findIndex((p) => p > listLineStart && p < listLineStart + '- 列表项包含目标词'.length)
    expect(listHitIdx).toBeGreaterThan(0)
    for (let i = 0; i < listHitIdx; i++) {
      c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    }
    const state = viewState(c, h)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[listHitIdx])
    expect(state.readingAnchorStart).toBe(listLineStart)
    const hit = parent!.querySelector<HTMLElement>('.vsidian-reading-block.vsidian-reading-find-hit')
    expect(hit).not.toBeNull()
    expect(hit!.dataset['vsidianSrcStart']).toBe(String(listLineStart))
    // 阅读容器在 DOM 中只有当前匹配块带命中类（块级高亮，非全文标注）
    const hits = parent!.querySelectorAll('.vsidian-reading-find-hit')
    expect(hits.length).toBe(1)
    c.handleHostMessage({ kind: 'view.find.close' })
    expect(parent!.querySelectorAll('.vsidian-reading-find-hit').length).toBe(0)
  })

  it('模式切换保活：live 导航 → reading 锚点为当前匹配块 → 回 live 选区恢复到当前匹配', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' }) // 第 2 个匹配（第二段）
    const matchFrom = HIT_OFFSETS[1]!
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    let state = viewState(c, h)
    expect(state.find?.open).toBe(true)
    expect(state.readingAnchorStart).toBe(DOC.indexOf('第二段：又出现目标词了。'))
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'live' })
    state = viewState(c, h)
    expect(state.find?.open).toBe(true)
    expect(state.selectionOffset).toBe(matchFrom)
    expect(state.find?.currentFrom).toBe(matchFrom)
    // live 侧当前匹配装饰仍在
    expect(c.getView()!.state.field(findStateField).matches.length).toBe(HIT_OFFSETS.length)
  })
})

describe('查找选项持久化（workspace 级记忆通道）', () => {
  it('init 后拉取 findOptions.get；切换开关出站 findOptions.set（选项快照形态）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    // init 拉取发生在 mount+init（与 settings.get 同批）
    expect(h.sent.some((m) => m.kind === 'findOptions.get')).toBe(true)
    c.handleHostMessage({ kind: 'view.find.open', query: 'hello' })
    const btn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-case')!
    const before = h.sent.filter((m) => m.kind === 'findOptions.set').length
    btn.click()
    const sets = h.sent.filter((m) => m.kind === 'findOptions.set')
    expect(sets.length).toBe(before + 1)
    expect(sets.at(-1)).toMatchObject({
      kind: 'findOptions.set',
      options: { matchCase: true, wholeWord: false, regexp: false },
    })
  })

  it('findOptions.snapshot 应用三开关状态（宿主权威回流，多面板一致）', () => {
    const h = makeBridge()
    const c = mountFind(h, 'Hello hello HELLO\n')
    c.handleHostMessage({ kind: 'view.find.open', query: 'hello' })
    expect(viewState(c, h).find?.total).toBe(3)
    // 宿主广播：matchCase=true（另一面板切换后的同步）
    c.handleHostMessage({
      kind: 'findOptions.snapshot',
      options: { matchCase: true, wholeWord: false, regexp: false },
    })
    const state = viewState(c, h)
    expect(state.find?.matchCase).toBe(true)
    expect(state.find?.total).toBe(1)
    // 面板按钮态同步
    const btn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-case')!
    expect(btn.classList.contains('vsidian-find-case-active')).toBe(true)
  })

  it('默认选项与 VSCode 对齐：三开关全关', () => {
    expect(FIND_OPTIONS_DEFAULT).toEqual({ matchCase: false, wholeWord: false, regexp: false })
  })
})

describe('替换栏与替换写回（#236：替换为显式写操作）', () => {
  function openReplace(c: WebviewSyncController, query: string, replacement: string): void {
    c.handleHostMessage({ kind: 'view.find.open', query, replace: true })
    const input = replaceInput()!
    input.value = replacement
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('Ctrl+H 打开面板并展开替换栏（替换行 open 类 + replaceOpen 观测）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    key(document, 'h', { ctrlKey: true })
    expect(viewState(c, h).find?.open).toBe(true)
    expect(viewState(c, h).find?.replaceOpen).toBe(true)
    const row = parent!.querySelector<HTMLElement>('.vsidian-find-replace')!
    expect(row.classList.contains('vsidian-find-replace-open')).toBe(true)
    expect(document.activeElement).toBe(findInput())
  })

  it('view.find.open 预置替换词（replacement）：输入框与引擎 replace 字段同步', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo bar foo\n')
    c.handleHostMessage({ kind: 'view.find.open', query: 'foo', replace: true, replacement: 'qux' })
    expect(replaceInput()!.value).toBe('qux')
    // 预置词直接生效：无需再触发 input 事件即可替换
    c.handleHostMessage({ kind: 'view.find.replace', op: 'next' })
    expect(editRequestCount(h)).toBe(1)
    expect(viewState(c, h).text).toBe('qux bar foo\n')
  })

  it('view.find.open {replace:true} 展开替换栏；切换按钮可收起再展开', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', replace: true })
    expect(viewState(c, h).find?.replaceOpen).toBe(true)
    const toggle = parent!.querySelector<HTMLButtonElement>('.vsidian-find-toggle')!
    toggle.click()
    expect(viewState(c, h).find?.replaceOpen).toBe(false)
    toggle.click()
    expect(viewState(c, h).find?.replaceOpen).toBe(true)
  })

  it('替换下一个：当前匹配被替换（单笔 edit.request），会话就近保持', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo bar foo baz foo\n')
    openReplace(c, 'foo', 'qux')
    expect(viewState(c, h).find?.total).toBe(3)
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'next' })
    expect(editRequestCount(h)).toBe(before + 1)
    const after = viewState(c, h)
    expect(after.text).toBe('qux bar foo baz foo\n')
    expect(after.find?.total).toBe(2)
    // 替换后当前匹配为被替换处的下一处（官方命令移动选区语义）
    expect(after.find?.currentFrom).toBe('qux bar '.length)
    expect(after.selectionOffset).toBe(after.find?.currentFrom)
  })

  it('替换输入框 Enter = 替换下一个（面板局部键）', () => {
    const h = makeBridge()
    const c = mountFind(h, 'aa bb aa\n')
    openReplace(c, 'aa', 'cc')
    const before = editRequestCount(h)
    key(replaceInput()!, 'Enter')
    expect(editRequestCount(h)).toBe(before + 1)
    expect(viewState(c, h).text).toBe('cc bb aa\n')
  })

  it('全部替换：整批单笔 edit.request（一笔撤销）', () => {
    const h = makeBridge()
    const c = mountFind(h, 'x1 x2 x3 x4\n')
    openReplace(c, 'x', 'y')
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    expect(editRequestCount(h)).toBe(before + 1)
    const after = viewState(c, h)
    expect(after.text).toBe('y1 y2 y3 y4\n')
    expect(after.find?.total).toBe(0)
    expect(after.find?.index).toBe(0)
  })

  it('正则替换支持捕获组展开（$1）', () => {
    const h = makeBridge()
    const c = mountFind(h, '2026-09-30\n')
    openReplace(c, '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1')
    const regBtn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-regexp')!
    regBtn.click()
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    expect(viewState(c, h).text).toBe('30/09/2026\n')
  })

  it('正则全部替换（多处）：整批替换、计数清零、装饰清空（#241 验收实测回归）', () => {
    const h = makeBridge()
    const c = mountFind(h, 'a1 a22 a333\n')
    openReplace(c, 'a\\d+', 'z')
    const regBtn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-regexp')!
    regBtn.click()
    expect(viewState(c, h).find?.total).toBe(3)
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    expect(editRequestCount(h)).toBe(before + 1)
    const after = viewState(c, h)
    expect(after.text).toBe('z z z\n')
    expect(after.find?.total).toBe(0)
    // 单笔 edit.request 携带整批变更（三条，非只第一条）
    const req = h.sent.slice(before).find((m) => m.kind === 'edit.request') as
      Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.changes.length).toBe(3)
  })

  it('替换在阅读模式不执行（只读）；替换栏不展开', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo bar foo\n')
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    c.handleHostMessage({ kind: 'view.find.open', query: 'foo', replace: true })
    const state = viewState(c, h)
    expect(state.find?.open).toBe(true)
    expect(state.find?.replaceOpen).toBe(false)
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    expect(editRequestCount(h)).toBe(before)
    expect(viewState(c, h).text).toBe('foo bar foo\n')
  })

  it('非法正则会话下替换不执行、不崩', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo\n')
    openReplace(c, '(', 'x')
    const regBtn = parent!.querySelector<HTMLButtonElement>('.vsidian-find-regexp')!
    regBtn.click() // 变非法
    expect(viewState(c, h).find?.valid).toBe(false)
    const before = editRequestCount(h)
    expect(() =>
      c.handleHostMessage({ kind: 'view.find.replace', op: 'all' }),
    ).not.toThrow()
    expect(editRequestCount(h)).toBe(before)
  })
})

describe('在选定内容中查找（#241 资产接线：findInSelection）', () => {
  function inSelectionBtn(): HTMLButtonElement {
    return parent!.querySelector<HTMLButtonElement>('.vsidian-find-in-selection')!
  }

  it('无选区时按钮禁用；选中后可开启，匹配只计范围内（计数/当前项随之）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const btn = inSelectionBtn()
    expect(btn.disabled).toBe(true)
    // 选中覆盖第 2、3 处命中的区间（第二段起 → 列表项命中结尾）
    const view = c.getView()!
    const from = HIT_OFFSETS[1]!
    const to = HIT_OFFSETS[2]! + 3
    view.dispatch({ selection: { anchor: from, head: to }, userEvent: 'select.pointer' })
    c.handleHostMessage({ kind: 'view.state.request' })
    expect(btn.disabled).toBe(false)
    btn.click()
    const state = viewState(c, h)
    expect(state.find?.inSelection).toBe(true)
    expect(state.find?.total).toBe(2)
    expect(state.find?.currentFrom).toBe(HIT_OFFSETS[1])
    expect(btn.classList.contains('vsidian-find-in-selection-active')).toBe(true)
    // 范围装饰在场（标记查找范围的淡底 mark）
    expect(view.contentDOM.querySelector('.vsidian-find-selection-range')).not.toBeNull()
    // 再次点击关闭：回到全量计数
    btn.click()
    expect(viewState(c, h).find?.total).toBe(HIT_OFFSETS.length)
    expect(view.contentDOM.querySelector('.vsidian-find-selection-range')).toBeNull()
  })

  it('开启中导航只在范围内循环；替换下一个与全部替换不动范围外', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo foo foo\nbar foo\n')
    const view = c.getView()!
    // 选中第一行（前三处命中）
    view.dispatch({ selection: { anchor: 0, head: 'foo foo foo'.length }, userEvent: 'select.pointer' })
    c.handleHostMessage({ kind: 'view.find.open', query: 'foo', replace: true, replacement: 'baz' })
    inSelectionBtn().click()
    let state = viewState(c, h)
    expect(state.find?.total).toBe(3)
    // 循环不越出范围：步进 3 次回到范围内首个
    for (let i = 0; i < 3; i++) {
      c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    }
    state = viewState(c, h)
    expect(state.find?.currentFrom).toBe(0)
    // 全部替换：只动第一行三处，bar 行不动
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    state = viewState(c, h)
    expect(state.text).toBe('baz baz baz\nbar foo\n')
    // 编辑请求一笔整批（范围内三处）
    const reqs = h.sent.filter((m) => m.kind === 'edit.request') as Array<{ changes: unknown[] }>
    expect(reqs[reqs.length - 1]!.changes.length).toBe(3)
  })

  it('关闭面板复位（重开不全量受限）；阅读模式进入即复位并禁用', () => {
    const h = makeBridge()
    const c = mountFind(h)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: HIT_OFFSETS[1]!, head: HIT_OFFSETS[2]! + 3 }, userEvent: 'select.pointer' })
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    inSelectionBtn().click()
    expect(viewState(c, h).find?.total).toBe(2)
    c.handleHostMessage({ kind: 'view.find.close' })
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    expect(viewState(c, h).find?.inSelection).toBe(false)
    expect(viewState(c, h).find?.total).toBe(HIT_OFFSETS.length)
    // 阅读模式：开启中切入即复位
    view.dispatch({ selection: { anchor: HIT_OFFSETS[1]!, head: HIT_OFFSETS[2]! + 3 } })
    c.handleHostMessage({ kind: 'view.state.request' })
    inSelectionBtn().click()
    expect(viewState(c, h).find?.inSelection).toBe(true)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const state = viewState(c, h)
    expect(state.find?.inSelection).toBe(false)
    expect(state.find?.total).toBe(HIT_OFFSETS.length)
  })

  it('开启中编辑文档：范围随变更映射（插入/删除后过滤仍正确）', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo foo\nbar foo\n')
    const view = c.getView()!
    view.dispatch({ selection: { anchor: 0, head: 'foo foo'.length }, userEvent: 'select.pointer' })
    c.handleHostMessage({ kind: 'view.find.open', query: 'foo' })
    inSelectionBtn().click()
    expect(viewState(c, h).find?.total).toBe(2)
    // 文档头插入 5 字符：范围应平移（仍覆盖第一行两处）
    view.dispatch({ changes: { from: 0, insert: '12345' } })
    const state = viewState(c, h)
    expect(state.find?.total).toBe(2)
    expect(state.find?.currentFrom).toBe(5)
  })

  it('开启中用户重选：范围跟随新选区（select 事务）', () => {
    const h = makeBridge()
    const c = mountFind(h, 'foo foo\nbar foo\n')
    const view = c.getView()!
    view.dispatch({ selection: { anchor: 0, head: 'foo foo'.length }, userEvent: 'select.pointer' })
    c.handleHostMessage({ kind: 'view.find.open', query: 'foo' })
    inSelectionBtn().click()
    expect(viewState(c, h).find?.total).toBe(2)
    // 重选第二行（第四处命中）
    view.dispatch({ selection: { anchor: 'foo foo\n'.length, head: 'foo foo\nbar foo'.length }, userEvent: 'select.pointer' })
    expect(viewState(c, h).find?.total).toBe(1)
    expect(viewState(c, h).find?.currentFrom).toBe('foo foo\nbar '.length)
  })

  it('按钮形态：SVG 图标类名在册、aria-label/title 走 i18n', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const btn = inSelectionBtn()
    expect(btn.getAttribute('aria-label')).toBe('在选定内容中查找')
    expect(btn.getAttribute('title')).toBe('在选定内容中查找')
    expect(btn.textContent).toBe('')
  })
})

describe('只读契约修订（#236）：纯查找零写回，替换显式写', () => {
  it('打开/查询/导航/开关切换/关闭全程：零 edit.request，文本逐字节不变', () => {
    const h = makeBridge()
    const c = mountFind(h)
    const baseline = viewState(c, h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    for (let i = 0; i < HIT_OFFSETS.length + 2; i++) {
      c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    }
    // 三开关切换（匹配重算，无写回）
    for (const cls of ['.vsidian-find-case', '.vsidian-find-word', '.vsidian-find-regexp']) {
      parent!.querySelector<HTMLButtonElement>(cls)!.click()
    }
    key(findInput()!, 'Escape')
    c.handleHostMessage({ kind: 'view.find.open', query: '🎉' })
    c.handleHostMessage({ kind: 'view.find.close' })
    const after = viewState(c, h)
    expect(editRequestCount(h)).toBe(0)
    expect(after.text).toBe(baseline.text)
    expect(after.docLength).toBe(baseline.docLength)
    // 除 mount 的 ready、诊断回报与 init 后的只读拉取（#33 设置快照 /
    // 除 mount 的 ready、诊断回报与 init 后的只读拉取（#33 设置快照 /
    // #91 快捷键 / #128 片段清单 / #197 反链快照 / 出链快照 / #239 分词
    // 资源状态 / #236 查找选项）外零出站（查找全程只读；findOptions.set
    // 是选项记忆不是编辑）
    const kinds = new Set(h.sent.map((m) => m.kind))
    expect([...kinds].filter((k) => k !== 'view.state' && k !== 'ready' &&
      k !== 'settings.get' && k !== 'keybindings.get' && k !== 'snippets.get' &&
      k !== 'backlinks.get' && k !== 'outlinks.get' && k !== 'wordSegment.get' &&
      k !== 'findOptions.get' && k !== 'findOptions.set')).toEqual([])
  })

  it('查找会话期间的宿主 undo 不受查找影响（无新历史条目产生）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    // 未做任何编辑：history.request 之前文档没有可撤销条目，查找也不添加
    const state = viewState(c, h)
    expect(state.text).toBe(DOC)
    expect(editRequestCount(h)).toBe(0)
  })
})

describe('文档变化时的匹配失效（重算时机）', () => {
  it('外部 doc.changed 后 total 与新文本一致，当前匹配就近保持', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    expect(viewState(c, h).find?.total).toBe(HIT_OFFSETS.length)
    // 外部增量：把第二段的 '目标词' 改写掉
    const target = DOC.indexOf('又出现目标词了')
    const at = DOC.indexOf('目标词', target)
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: at, length: '目标词了。'.length, text: '他词了。' }],
    })
    const state = viewState(c, h)
    expect(state.find?.total).toBe(HIT_OFFSETS.length - 1)
    expect(state.find?.open).toBe(true)
    // 仍零出站
    expect(editRequestCount(h)).toBe(0)
  })
})

describe('成型头区排除（#236 已定边界：搜索不进入头区）', () => {
  const FM_DOC = '---\ntitle: 头区目标词\n---\n\n正文目标词继续\n'

  it('成型头区（只读表格呈现）内的命中不进匹配集', () => {
    const h = makeBridge()
    const c = mountFind(h, FM_DOC)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    const state = viewState(c, h)
    expect(state.find?.total).toBe(1)
    expect(state.find?.currentFrom).toBe(FM_DOC.indexOf('目标词', FM_DOC.indexOf('正文目标词')))
  })

  // #241 评审修复 P0-2：替换不得进入头区（与查找同源的排除匹配集）。
  // 头区 2 处命中（title 值 + tags 项）、正文 3 处命中
  const FM_REPLACE_DOC =
    '---\ntitle: 头区目标词\ntags:\n  - 目标词\n---\n\n正文目标词一。\n\n中间段落。\n\n结尾目标词二与目标词三。\n'
  const FM_BODY_START = FM_REPLACE_DOC.indexOf('正文目标词一')

  function headSlice(text: string): string {
    return text.slice(0, FM_BODY_START)
  }

  it('替换下一个：正文首个命中被替换（单笔写回），头区源文本逐字节不变', () => {
    const h = makeBridge()
    const c = mountFind(h, FM_REPLACE_DOC)
    c.handleHostMessage({
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    expect(viewState(c, h).find?.total).toBe(3) // 计数即正文命中（头区排除）
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'next' })
    expect(editRequestCount(h)).toBe(before + 1)
    const after = viewState(c, h)
    // 正文替换正确：首个正文命中被替换（官方命令先选中当前命中的语义——
    // 打开面板已定位选区到首个命中，next 即替换）
    expect(after.text).toBe(FM_REPLACE_DOC.replace('正文目标词一', '正文替换词一'))
    // 头区零写回：逐字节不变
    expect(headSlice(after.text!)).toBe(headSlice(FM_REPLACE_DOC))
    // 会话就近保持：total 递减、当前移到下一处正文命中（indexOf 从正文
    // 起点找——头区仍含命中，不得作为期望来源）
    expect(after.find?.total).toBe(2)
    expect(after.find?.currentFrom).toBe(after.text!.indexOf('目标词', FM_BODY_START))
  })

  it('全部替换：整批单笔写回只改正文，头区源文本逐字节不变', () => {
    const h = makeBridge()
    const c = mountFind(h, FM_REPLACE_DOC)
    c.handleHostMessage({
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    const totalBefore = viewState(c, h).find?.total
    expect(totalBefore).toBe(3)
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    expect(editRequestCount(h)).toBe(before + 1) // 整批一笔（一笔撤销）
    const after = viewState(c, h)
    // 面板计数与实际替换数一致：3 处正文命中各被替换一次
    expect(after.text!.split('替换词').length - 1).toBe(totalBefore)
    // 头区 2 处命中不被触碰
    expect(headSlice(after.text!)).toBe(headSlice(FM_REPLACE_DOC))
    expect(after.text).toBe(FM_REPLACE_DOC.split('目标词一').join('替换词一')
      .split('目标词二').join('替换词二').split('目标词三').join('替换词三'))
    expect(after.find?.total).toBe(0)
  })

  it('头区独有命中（面板 0 命中）：替换下一个/全部替换均零写回', () => {
    const h = makeBridge()
    const c = mountFind(h, FM_DOC)
    c.handleHostMessage({
      kind: 'view.find.open', query: '头区目标词', replace: true, replacement: '改写',
    })
    // 面板 0 命中：头区命中被排除、正文无命中（官方 replaceAll 全文扫描
    // 会改写头区源文本——P0 缺陷场景）
    expect(viewState(c, h).find?.total).toBe(0)
    const before = editRequestCount(h)
    c.handleHostMessage({ kind: 'view.find.replace', op: 'next' })
    c.handleHostMessage({ kind: 'view.find.replace', op: 'all' })
    expect(editRequestCount(h)).toBe(before)
    expect(viewState(c, h).text).toBe(FM_DOC)
  })

  it('replaceNext wrap 推进不落入头区：末个正文命中替换后回绕到首个正文命中', () => {
    const h = makeBridge()
    const c = mountFind(h, FM_REPLACE_DOC)
    c.handleHostMessage({
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    // 连续替换 3 次（每次替换当前并推进）：3 处正文命中全替换、头区不变
    for (let i = 0; i < 3; i++) {
      c.handleHostMessage({ kind: 'view.find.replace', op: 'next' })
    }
    const allBodyReplaced = FM_REPLACE_DOC.split('目标词一').join('替换词一')
      .split('目标词二').join('替换词二').split('目标词三').join('替换词三')
    const after = viewState(c, h)
    expect(editRequestCount(h)).toBe(3)
    expect(after.text).toBe(allBodyReplaced)
    expect(headSlice(after.text!)).toBe(headSlice(FM_REPLACE_DOC))
    expect(after.find?.total).toBe(0)
  })
})

describe('短文档锚点权威性（定位锚点不被视口读数覆盖）', () => {
  function stubBox(container: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true })
  }

  it('容器不可滚动（scrollHeight ≈ clientHeight）时 scroll 事件不覆盖定位锚点', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    const target = viewState(c, h)
    const targetAnchor = target.readingAnchorStart
    expect(targetAnchor).toBe(DOC.indexOf('第二段：又出现目标词了。'))
    // 短文档：内容不超出视口（真实布局里 maxScroll≈0；此处以数值桩模拟）
    const container = parent!.querySelector<HTMLElement>('.vsidian-view-reading')!
    stubBox(container, 600, 600)
    container.dispatchEvent(new Event('scroll'))
    expect(viewState(c, h).readingAnchorStart).toBe(targetAnchor)
  })

  it('容器可滚动时 scroll 事件照常以视口顶块更新锚点（既有语义保持）', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    const targetAnchor = viewState(c, h).readingAnchorStart
    expect(targetAnchor).toBe(DOC.indexOf('第二段：又出现目标词了。'))
    // 可滚动容器：视口读数是权威（jsdom 无布局 → 回退到首个可见块 0）
    const container = parent!.querySelector<HTMLElement>('.vsidian-view-reading')!
    stubBox(container, 2000, 600)
    container.dispatchEvent(new Event('scroll'))
    expect(viewState(c, h).readingAnchorStart).toBe(0)
  })
})

describe('协议校验', () => {
  it('非法 find 消息被丢弃，不改变会话状态', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.open', query: '目标词' })
    // direction 非法
    c.handleHostMessage({ kind: 'view.find.step', direction: 'jump' })
    // query 非字符串
    c.handleHostMessage({ kind: 'view.find.open', query: 123 })
    // replace op 非法
    c.handleHostMessage({ kind: 'view.find.replace', op: 'jump' })
    const state = viewState(c, h)
    expect(state.find?.open).toBe(true)
    expect(state.find?.total).toBe(HIT_OFFSETS.length)
    expect(state.find?.index).toBe(1)
    expect(editRequestCount(h)).toBe(0)
  })

  it('view.find.step 在会话未打开时被忽略', () => {
    const h = makeBridge()
    const c = mountFind(h)
    c.handleHostMessage({ kind: 'view.find.step', direction: 'next' })
    expect(viewState(c, h).find).toBeUndefined()
  })
})
