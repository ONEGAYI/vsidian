// @vitest-environment jsdom
// 换包刷新契约（#101 第一部分）：装配 zh-cn 后模拟生产同构换包
// （installLocale('en', en) 触发 listeners），遍历三面板 DOM 全树收集
// aria-label / title / placeholder / 显式 textContent，断言不得整体等于
// 任何 zh 唯一值（zh≠en 且不出现在任何 en 值中的文案）。
// - fixture 文档纯 ASCII：用户文档内容可能天然含中文，排除法不区分来源；
// - 收集范围刻意不含 aria-description 等运行时动态属性（键位提示由
//   refreshQuickActions 按选区/输入重算，非换包驱动）；
// - 按需控件（代码卡片/公式降级/图形按钮/图片占位/表格控件按钮）不在
//   本契约范围（fixture 不触发物化；另一提交处理）。
// - 大纲面板随编辑器控制器装配（buildSidebar 内建骨架），不单列用例。
import { describe, it, expect } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { PRODUCTION_SETTING_DEFINITIONS } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { en } from '../../src/shared/locales/en'

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

/** 纯 ASCII 文档：标题 + 段落，不含表格/任务/代码块/公式/图片/双链——
 *  刻意避开按需控件物化（它们是另一提交的领域） */
const DOC = [
  '# Alpha',
  '',
  'Intro paragraph with plain words.',
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
      switchToEnglish()
      // 正控制：既有刷新路径确实换词（标题栏设置按钮）
      const settingsBtn = parent.querySelector<HTMLButtonElement>('.vsidian-settings-toggle')!
      expect(settingsBtn.getAttribute('aria-label')).toBe(en['sidebar.settings'])
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
