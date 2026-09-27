// @vitest-environment jsdom
// 换包刷新契约（#101 第一部分）：装配 zh-cn 后模拟生产同构换包
// （installLocale('en', en) 触发 listeners），遍历三面板 DOM 全树收集
// aria-label / title / placeholder / 显式 textContent，断言不得整体等于
// 任何 zh 唯一值（zh≠en 且不出现在任何 en 值中的文案）。
// - fixture 文档纯 ASCII：用户文档内容可能天然含中文，排除法不区分来源；
// - 收集范围刻意不含 aria-description 等运行时动态属性（键位提示由
//   refreshQuickActions 按选区/输入重算，非换包驱动）；
// - 按需控件（#101 第三部分）：fixture 文档含代码围栏/坏公式/图片，若
//   CM6 在 jsdom 物化 widget 则全树扫描直接覆盖；无法真实物化的控件由
//   「生产 builder/widget.toDOM 直构 + 挂同一 document 查询域」的等价
//   形态用例覆盖（见文件末 describe）。
// - 大纲面板随编辑器控制器装配（buildSidebar 内建骨架），不单列用例。
import { describe, it, expect, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { PRODUCTION_SETTING_DEFINITIONS } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { en } from '../../src/shared/locales/en'
import { CodeCardHeaderWidget } from '../../src/webview/liveCodeCard'
import { buildGraphicChrome } from '../../src/webview/graphicBlockChrome'
import { LiveMathWidget } from '../../src/webview/liveMath'
import { EmptyTableCellWidget, LIVE_CLASS_NAMES } from '../../src/webview/liveDecorations'
import { ImageResourceManager } from '../../src/webview/imageResource'
import {
  closeDiagramPopup,
  DIAGRAM_POPUP_CLASS_NAMES,
  openGraphicPopup,
} from '../../src/webview/diagramPopup'
import { bindLocale, __localeDomBindingCountForTest } from '../../src/webview/localeDom'
import { MERMAID_CLASS_NAMES, MERMAID_CODE_ATTR } from '../../src/shared/mermaid'
import {
  __resetMermaidRenderStateForTest,
  __setMermaidApiForTest,
  renderMermaidInto,
} from '../../src/webview/mermaidRender'

// #94 起文案经 t() 取词：装配生产中文包（与 outlineSearchPanel 先例同款）
installLocale('zh-cn', zhCn)

// jsdom 无布局：CM6 视口测量的零值 polyfill（与 outlineSearchPanel.test.ts 同款）
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/locale-refresh.md'

/** 纯 ASCII 文档（#101 第三部分起含按需控件元素）：标题 + 段落 + 代码
 *  围栏（卡片按钮）+ 坏公式（降级 title）+ 图片（loading 无固化文案）——
 *  CM6 在 jsdom 无布局、视口物化不保证，物化则全树扫描覆盖，未物化由
 *  文件末的直构等价形态用例兜底 */
const DOC = [
  '# Alpha',
  '',
  'Intro paragraph with plain words.',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  'Broken math $\\bad$ stays as source text.',
  '',
  '![pic](./missing.png)',
  '',
  '## Beta',
  '',
  'Closing paragraph.',
  '',
].join('\n')

/** zh 唯一值 → 键（zh≠en 且该文案不出现在任何 en 值中——后者是合法的
 *  换包后终态，不判残留） */
const zhOnlyByValue = (() => {
  const enValues = new Set<string>(Object.values(en))
  const map = new Map<string, string>()
  for (const [key, value] of Object.entries(zhCn)) {
    if (value !== (en as Record<string, string>)[key] && !enValues.has(value)) {
      map.set(value, key)
    }
  }
  return map
})()

/** 遍历 DOM 全树收集用户可见文案载体：三个可本地化属性 + 非空 textContent */
function collectVisibleTexts(root: Element): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll('*')) {
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const value = el.getAttribute(attr)
      if (value) {
        out.push(value)
      }
    }
    if (el.textContent && el.textContent.trim() !== '') {
      out.push(el.textContent)
    }
  }
  return out
}

/** 断言 root 子树无 zh 唯一值残留（失败信息带键名与命中文案，便于定位） */
function expectNoStaleZh(root: Element, label: string): void {
  const stale = collectVisibleTexts(root).filter((text) => zhOnlyByValue.has(text))
  const detail = stale.map((text) => `${zhOnlyByValue.get(text)!} → ${JSON.stringify(text)}`)
  expect(stale, `${label} 换包后仍残留 zh 文案：${detail.join('; ')}`).toEqual([])
}

function makeBridge(): { bridge: VsCodeBridge; sent: unknown[] } {
  const sent: unknown[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m),
    getState: () => undefined,
    setState: () => {},
  }
  return { bridge, sent }
}

/** 与生产换包同构的触发：installLocale 原子换包并通知 listeners */
function switchToEnglish(): void {
  installLocale('en', en)
}

/** 挂到 document.body（重刷注册表按 isConnected 判存活，游离子树不重刷——
 *  生产元素恒连线，测试需同构）；返回清理函数 */
function attach(parent: HTMLElement): () => void {
  document.body.append(parent)
  return () => {
    parent.remove()
  }
}

/** 排空 mermaid 渲染的异步链（串行队列 + promise 微任务；与
 *  mermaidRender.test.ts 同款） */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

describe('换包后 DOM 无旧语言残留（#101 常驻控件契约）', () => {
  it('编辑器面板：换包后全树无 zh 唯一值（顶栏/操作条/查找/横幅/侧栏/大纲）', () => {
    installLocale('zh-cn', zhCn)
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      c.handleHostMessage({ kind: 'sidebar.test.click' }) // 展开侧栏：大纲骨架入树
      // 前置：确实装配的是 zh（防 vacuous pass 的正控制之一）
      const resizer = parent.querySelector<HTMLElement>('.vsidian-sidebar-resizer')!
      expect(resizer.getAttribute('aria-label')).toBe(zhCn['sidebar.resize'])
      // 按需控件真实物化路径正控制：fixture 围栏/坏公式经 CM6 真实物化
      // （jsdom 无布局但 docView 首屏物化成立），卡片复制按钮 title 为 zh；
      // 物化若退化此断言先红，提示 fixture 与直构用例的分工需重估
      const cardCopy = parent.querySelector<HTMLElement>('.vsidian-code-card-copy')!
      expect(cardCopy.title).toBe(zhCn['codeblock.copy'])
      switchToEnglish()
      // 正控制：既有刷新路径确实换词（标题栏设置按钮）
      const settingsBtn = parent.querySelector<HTMLButtonElement>('.vsidian-settings-toggle')!
      expect(settingsBtn.getAttribute('aria-label')).toBe(en['sidebar.settings'])
      // 按需控件：就地重刷换词（真实物化的卡片按钮 + 公式降级 title
      // 由全树 zhOnly 扫描覆盖）
      expect(cardCopy.title).toBe(en['codeblock.copy'])
      expectNoStaleZh(parent, '编辑器面板')
    } finally {
      detach()
    }
  })

  it('编辑器面板正控制：大纲工具条与查找面板换包后取 en 词', () => {
    installLocale('zh-cn', zhCn)
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      switchToEnglish()
      const jump = parent.querySelector<HTMLButtonElement>('.vsidian-outline-jump-bottom')
      expect(jump?.getAttribute('aria-label')).toBe(en['outline.jumpBottom'])
      const search = parent.querySelector<HTMLInputElement>('.vsidian-outline-search')
      expect(search?.getAttribute('placeholder')).toBe(en['outline.searchPlaceholder'])
    } finally {
      detach()
    }
  })

  it('编辑器面板：大纲搜索无匹配占位换包后换词（nomatch 态钉住）', () => {
    installLocale('zh-cn', zhCn)
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      c.handleHostMessage({ kind: 'sidebar.test.click' }) // 展开侧栏：大纲工具条入树
      // 激活无匹配态：输入不命中任何标题的词（setOutlineSearch → 折叠落
      // DOM 路径幂等补挂 nomatch 占位，与生产同构）
      const search = parent.querySelector<HTMLInputElement>('.vsidian-outline-search')!
      search.value = 'zzzz'
      search.dispatchEvent(new Event('input', { bubbles: true }))
      const nomatch = parent.querySelector<HTMLElement>('.vsidian-outline-nomatch')
      // 正控制：占位确实存在且为 zh（防退回直写的钉住基线）
      expect(nomatch).not.toBeNull()
      expect(nomatch!.textContent).toBe(zhCn['outline.noMatch'])
      switchToEnglish()
      expect(nomatch!.textContent).toBe(en['outline.noMatch'])
    } finally {
      detach()
    }
  })

  it('设置页面板：换包后全树无 zh 唯一值（含搜索框/侧栏导航等常驻骨架）', () => {
    installLocale('zh-cn', zhCn)
    // 与生产 settingsMain.ts 同构：生产定义表 + 快捷键分页
    const keybindings = new KeybindingSettingsSection({ postMessage: () => {} })
    const view = new SettingsPageView(
      { postMessage: () => {} },
      PRODUCTION_SETTING_DEFINITIONS,
      [keybindings],
    )
    const parent = document.createElement('div')
    const detach = attach(parent)
    try {
      view.mount(parent)
      // 前置：搜索框确实装配 zh
      const search = parent.querySelector<HTMLInputElement>('.vsidian-settings-search')!
      expect(search.getAttribute('placeholder')).toBe(zhCn['settings.searchPlaceholder'])
      switchToEnglish()
      // 正控制：框架标题确实换词
      const title = parent.querySelector<HTMLElement>('.vsidian-settings-title')
      expect(title?.textContent).toBe(en['settings.pageTitle'])
      expectNoStaleZh(parent, '设置页面板')
    } finally {
      detach()
      view.dispose()
    }
  })
})

describe('按需控件换包后就地重刷（#101 第三部分契约）', () => {
  afterEach(() => {
    // 本组注入的 mermaid mock 不外溢（其他组不消费渲染层状态）
    __resetMermaidRenderStateForTest()
  })

  it('卡片/图形/公式/图片控件：换包后 title 与 aria-label 就地取 en 词', () => {
    // 等价形态：CM6 widget 的视口物化依赖布局（jsdom 无），此处直调生产
    // widget.toDOM / chrome builder——CM6 物化即调同一函数——并挂进与生产
    // 相同的 document 查询域；换包链路（installLocale → onLocaleChanged →
    // applyEditorLocale → localeOnDemand 扫描）走真控制器，与生产同构。
    // 图片错误态经真实状态机写入（attach → 宿主解析失败），钉住 data 属性
    // 契约（data-vsidian-img-state / -reason）。
    installLocale('zh-cn', zhCn)
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    const host = document.createElement('div')
    document.body.append(host)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      host.append(
        new CodeCardHeaderWidget('ts', 'ts', true, 'const x = 1', false).toDOM(),
        new CodeCardHeaderWidget('ts', 'ts', true, 'const x = 1', true).toDOM(),
        buildGraphicChrome({ onEdit: () => {}, onPopup: () => {} }),
        new LiveMathWidget('\\bad', false).toDOM(),
      )
      const images = new ImageResourceManager({
        isDirectSrc: () => false,
        requestHost: () => {},
      })
      const img = document.createElement('img')
      host.append(img)
      images.attach(img, './broken.png')
      images.handleResult({ reqId: 1, ok: false, reason: 'not found' })
      // 正控制：换包前全部是 zh（展开态提示折叠、收起态提示展开）
      expect(host.querySelector<HTMLElement>('.vsidian-code-card-copy')!.title)
        .toBe(zhCn['codeblock.copy'])
      const folds = [...host.querySelectorAll<HTMLElement>('.vsidian-code-card-fold')]
      expect(folds.map((btn) => btn.title))
        .toEqual([zhCn['codeblock.collapse'], zhCn['codeblock.expand']])
      expect(host.querySelector<HTMLElement>('.vsidian-graphic-chrome-edit')!.title)
        .toBe(zhCn['graphic.editSource'])
      expect(host.querySelector<HTMLElement>('.vsidian-graphic-chrome-popup')!.title)
        .toBe(zhCn['graphic.popup'])
      expect(host.querySelector<HTMLElement>('.vsidian-math-error')!.title)
        .toBe(zhCn['decor.mathError'])
      expect(img.title).toBe(zhCn['decor.imageError'].replace('{reason}', 'not found'))
      switchToEnglish()
      // 换包后：就地重刷为 en（title 与 aria-label 同源换词）
      const copy = host.querySelector<HTMLElement>('.vsidian-code-card-copy')!
      expect(copy.title).toBe(en['codeblock.copy'])
      expect(copy.getAttribute('aria-label')).toBe(en['codeblock.copy'])
      expect(folds.map((btn) => btn.title))
        .toEqual([en['codeblock.collapse'], en['codeblock.expand']])
      expect(host.querySelector<HTMLElement>('.vsidian-graphic-chrome-edit')!.title)
        .toBe(en['graphic.editSource'])
      expect(host.querySelector<HTMLElement>('.vsidian-graphic-chrome-popup')!.title)
        .toBe(en['graphic.popup'])
      expect(host.querySelector<HTMLElement>('.vsidian-math-error')!.title)
        .toBe(en['decor.mathError'])
      expect(img.title).toBe(en['decor.imageError'].replace('{reason}', 'not found'))
      expectNoStaleZh(host, '按需控件（直构树）')
    } finally {
      host.remove()
      detach()
    }
  })

  it('mermaid 错误占位：换包后经重渲染取 en 词（缓存复用原始错误串）', async () => {
    installLocale('zh-cn', zhCn)
    __setMermaidApiForTest({
      initialize() {},
      async render() {
        throw new Error('Parse error on line 2')
      },
    })
    // 容器形态与生产一致（diagram 类 + 源码 data 属性），挂 document 域
    const el = document.createElement('div')
    el.className = MERMAID_CLASS_NAMES.diagram
    el.setAttribute(MERMAID_CODE_ATTR, 'graph TD\n<<bad')
    document.body.append(el)
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      renderMermaidInto(el, 'graph TD\n<<bad')
      await settle()
      expect(el.getAttribute('data-vsidian-mermaid-state')).toBe('error')
      // 正控制：换包前是 zh 插值（原始错误串与语言无关）
      expect(el.querySelector<HTMLElement>('.vsidian-mermaid-error-message')!.textContent)
        .toBe(zhCn['decor.mermaidError'].replace('{message}', 'Parse error on line 2'))
      switchToEnglish()
      // 换包触发 refreshMermaidErrorLocale → 重渲染（异步）→ 新词。
      // 注意重新取节点：applyEntry 先清空容器重建降级 DOM，换包前抓的
      // 旧 message 引用已脱挂、textContent 停留旧词
      await settle()
      expect(el.querySelector<HTMLElement>('.vsidian-mermaid-error-message')!.textContent)
        .toBe(en['decor.mermaidError'].replace('{message}', 'Parse error on line 2'))
    } finally {
      el.remove()
      detach()
    }
  })

  it('表格空格占位 widget：换包后 aria-label 就地取 en 词（不误伤普通格）', () => {
    // 等价形态同前：直调生产 widget.toDOM（CM6 物化即调同一函数）。
    // 空格 widget 的装饰是模块级单例实例（eq 恒成立），物化 DOM 不随
    // 换包重建——两态（常规/active）都固化 aria-label，须扫描就地重写；
    // 普通格是 mark 装饰加同款 tableGridCell 类名，不得被误加 aria-label
    installLocale('zh-cn', zhCn)
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    const host = document.createElement('div')
    document.body.append(host)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      const calm = new EmptyTableCellWidget(false).toDOM()
      const active = new EmptyTableCellWidget(true).toDOM()
      const plainCell = document.createElement('span')
      plainCell.className = LIVE_CLASS_NAMES.tableGridCell // 普通格物化形态（无 aria）
      host.append(calm, active, plainCell)
      // 正控制：换包前两态 aria-label 均为 zh
      expect(calm.getAttribute('aria-label')).toBe(zhCn['decor.emptyCell'])
      expect(active.getAttribute('aria-label')).toBe(zhCn['decor.emptyCell'])
      switchToEnglish()
      expect(calm.getAttribute('aria-label')).toBe(en['decor.emptyCell'])
      expect(active.getAttribute('aria-label')).toBe(en['decor.emptyCell'])
      expect(plainCell.getAttribute('aria-label')).toBeNull() // 选择器不误伤普通格
      expectNoStaleZh(host, '空格占位 widget（直构树）')
    } finally {
      host.remove()
      detach()
    }
  })

  it('图表弹窗：打开期间换包后 overlay 名与工具条按钮就地取 en 词', async () => {
    // 生产路径直开：openGraphicPopup 构建 overlay 挂 body 直下（document
    // 级扫描可达），mermaid 经 mock API 渲染成功（成功态无错误占位干扰）
    installLocale('zh-cn', zhCn)
    __setMermaidApiForTest({
      initialize() {},
      async render() {
        return {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="30" fill="#888"/></svg>',
        }
      },
    })
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    const detach = attach(parent)
    try {
      c.mount(parent)
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
      openGraphicPopup('mermaid', 'graph TD\nA-->B')
      await settle()
      const overlay = document.querySelector<HTMLElement>(
        `.${DIAGRAM_POPUP_CLASS_NAMES.overlay}`,
      )!
      // 正控制：换包前 overlay 名与关闭按钮均为 zh
      expect(overlay.getAttribute('aria-label')).toBe(zhCn['graphic.popup'])
      expect(overlay.querySelector<HTMLButtonElement>(
        `.${DIAGRAM_POPUP_CLASS_NAMES.close}`)!.title,
      ).toBe(zhCn['graphic.popupClose'])
      switchToEnglish()
      expect(overlay.getAttribute('aria-label')).toBe(en['graphic.popup'])
      const toolbarCases: Array<[string, string]> = [
        [DIAGRAM_POPUP_CLASS_NAMES.zoomOut, en['graphic.popupZoomOut']],
        [DIAGRAM_POPUP_CLASS_NAMES.zoomIn, en['graphic.popupZoomIn']],
        [DIAGRAM_POPUP_CLASS_NAMES.reset, en['graphic.popupReset']],
        [DIAGRAM_POPUP_CLASS_NAMES.refresh, en['graphic.popupRefresh']],
        [DIAGRAM_POPUP_CLASS_NAMES.exportSvg, en['graphic.popupExportSvg']],
        [DIAGRAM_POPUP_CLASS_NAMES.exportPng, en['graphic.popupExportPng']],
        [DIAGRAM_POPUP_CLASS_NAMES.close, en['graphic.popupClose']],
      ]
      for (const [cls, word] of toolbarCases) {
        const btn = overlay.querySelector<HTMLButtonElement>(`.${cls}`)!
        expect(btn, cls).toBeDefined()
        expect(btn.title, `${cls} title`).toBe(word)
        expect(btn.getAttribute('aria-label'), `${cls} aria-label`).toBe(word)
      }
      expectNoStaleZh(overlay, '图表弹窗')
    } finally {
      closeDiagramPopup()
      detach()
    }
  })
})

describe('localeDom 注册表有界性（#101 常驻控件契约）', () => {
  it('先登记后挂树同构：超阈值微任务剪枝不误剪同批未挂树活项（N1）', async () => {
    installLocale('zh-cn', zhCn)
    const scratch = document.createElement('div')
    document.body.append(scratch)
    try {
      // 清场：一批未挂树登记触发延迟剪枝，把历史用例可能滞留的死项清空，
      // 使 before 成为全活项的干净基线（installLocale 开头的同步重刷只清
      // 当刻已脱挂项，未触发过剪枝排队的遗留死项仍可能在册）
      for (let i = 0; i < 600; i++) {
        bindLocale(document.createElement('div'), 'text', 'outline.noMatch')
      }
      await Promise.resolve() // flush：清场剪枝微任务执行
      const before = __localeDomBindingCountForTest()
      // 生产同构（outline 构建函数返回后挂树 / nomatch 占位登记后
      // appendChild）：bindLocale 时元素尚未入树，登记瞬间
      // isConnected === false 是常态而非死项信号
      const items: HTMLElement[] = []
      for (let i = 0; i < 600; i++) {
        const item = document.createElement('div')
        bindLocale(item, 'text', 'outline.noMatch')
        items.push(item)
      }
      // 同步挂树先于微任务：flush 时同批元素已全部 isConnected，
      // 不得被剪（修复前 register 内同步剪枝在挂树前执行，同批整批
      // 误剪，计数断言红）
      scratch.append(...items)
      await Promise.resolve()
      expect(__localeDomBindingCountForTest()).toBe(before + 600)
      // 换包重刷未失：同批元素全部换词（误剪后以残留 zh 形态红）
      switchToEnglish()
      for (const item of items) {
        expect(item.textContent).toBe(en['outline.noMatch'])
      }
    } finally {
      scratch.remove()
    }
  })

  it('批量登记超阈值时延迟剪枝：死绑定不无界累积，连线登记仍换包重刷', async () => {
    installLocale('zh-cn', zhCn)
    const scratch = document.createElement('div')
    document.body.append(scratch)
    try {
      // 模拟大纲条目反复重建：每次重建 bindLocale 新元素、旧元素脱挂丢弃，
      // 两次换包间无人触发 refreshLocaleDom 剪枝
      const before = __localeDomBindingCountForTest()
      for (let i = 0; i < 600; i++) {
        bindLocale(document.createElement('div'), 'text', 'outline.noMatch')
      }
      // 超阈值触发的剪枝经微任务延迟执行：flush 后死绑定（未连线）被移除，
      // 登记总数显著低于 before + 600（未实现时恰等于，先红）
      await Promise.resolve()
      expect(__localeDomBindingCountForTest()).toBeLessThan(before + 600)
      // 剪枝不误伤连线登记：挂树元素登记后换包仍被注册表重刷
      const live = document.createElement('div')
      scratch.append(live)
      bindLocale(live, 'text', 'outline.noMatch')
      switchToEnglish()
      expect(live.textContent).toBe(en['outline.noMatch'])
    } finally {
      scratch.remove()
    }
  })
})
