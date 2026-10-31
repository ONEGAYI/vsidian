// Callout 类型菜单取色预览（#658/T07）浏览器 fixture：生产控制器 + 产物
// CSS + 真实片段通道（calloutIcon 同款 SnippetLoader 装配）+ edit.ack 回环
// 宿主模拟（calloutPlan 同款）。驱动三级类型菜单的真实右键/键盘路径，供
// 套件断言：菜单预览计算色与正文呈现对拍（live 行 / 阅读容器）、同色相邻
// 类型分隔线、片段热更新与明暗主题在菜单打开期间的即时刷新、探针零泄漏。
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
const sent: Array<{ kind: string; [k: string]: unknown }> = []

const controller = new WebviewSyncController({
  postMessage(msg: unknown) {
    const message = msg as { kind: string; [k: string]: unknown }
    sent.push(message)
    if (message.kind === 'edit.request') {
      const req = message as unknown as { seq: number; baseVersion: number }
      setTimeout(() => {
        controller.handleHostMessage({
          kind: 'edit.ack', seq: req.seq, ok: true, version: req.baseVersion + 1,
        })
      }, 10)
    }
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

Object.assign(window, {
  controller,
  initCalloutMenu(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'callout-menu', docUri: 'file:///notes/callout-menu.md',
      version: 1, text,
    })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  post(msg: Record<string, unknown>) {
    controller.handleHostMessage(msg)
  },
  setTheme(mode: 'light' | 'dark') {
    document.body.classList.toggle('vscode-light', mode === 'light')
    document.body.classList.toggle('vscode-dark', mode === 'dark')
  },
  snippetUrl(css: string): string {
    return URL.createObjectURL(new Blob([css], { type: 'text/css' }))
  },
  applySnippets(version: number, snippets: Array<{ name: string; uri: string }>) {
    controller.handleHostMessage({ kind: 'snippets.snapshot', version, snippets })
  },
  sent: () => sent,
  clearSent() {
    sent.length = 0
  },
})

// ---- 观测面（Playwright evaluate 跨边界：自包含、只含可克隆结构）----

/** 三级类型面 = 菜单内最后一个 role=menu（孙级 submenu） */
function typeFace(): HTMLElement | null {
  const menu = document.querySelector('.vsidian-context-menu')
  const faces = [...(menu?.querySelectorAll<HTMLElement>('[role="menu"]') ?? [])]
  return faces[faces.length - 1] ?? null
}

/** 类型页结构：可见项命令序列、分隔线数、交替形态、孤线、可聚焦性 */
function faceStructure() {
  const face = typeFace()
  if (!face) return null
  const kinds = [...face.children].map((el) => {
    if (el.classList.contains('vsidian-context-menu-separator')) return 'sep'
    if (el.classList.contains('vsidian-context-menu-host')) return 'item'
    return 'other'
  })
  return {
    commands: [...face.querySelectorAll<HTMLButtonElement>(':scope > .vsidian-context-menu-host > button')]
      .map((b) => b.dataset['vsidianCommand'] ?? ''),
    visibleCount: kinds.filter((k) => k === 'item').length,
    sepCount: kinds.filter((k) => k === 'sep').length,
    kinds: kinds.join(','),
    firstIsSep: kinds[0] === 'sep',
    lastIsSep: kinds[kinds.length - 1] === 'sep',
    sepFocusable: [...face.children].some((el) =>
      el.classList.contains('vsidian-context-menu-separator') &&
      (el.hasAttribute('tabindex') || el instanceof HTMLButtonElement)),
    faceRole: face.getAttribute('role'),
  }
}

/** 菜单行预览绘制（色底双通道 / 图标颜色与形状 / 标题字色） */
function rowPaint(command: string) {
  const btn = document.querySelector<HTMLButtonElement>(
    `.vsidian-context-menu button[data-vsidian-command="${CSS.escape(command)}"]`)
  if (!btn) return null
  const swatch = btn.querySelector<HTMLElement>('.vsidian-context-menu-swatch')
  if (!swatch) return { missing: true, command }
  const icon = swatch.querySelector<HTMLElement>('.vsidian-context-menu-swatch-icon')
  const sw = getComputedStyle(swatch)
  const si = icon ? getComputedStyle(icon) : null
  const label = btn.querySelector<HTMLElement>('.vsidian-context-menu-label')
  return {
    missing: false,
    swatchClass: swatch.className,
    bgColor: sw.backgroundColor,
    bgImage: sw.backgroundImage,
    radius: sw.borderTopLeftRadius,
    iconColor: si ? si.backgroundColor : null,
    iconMask: si ? (si.maskImage ?? si.webkitMaskImage) : null,
    iconSvg: icon ? !!icon.querySelector('svg') : false,
    labelColor: label ? getComputedStyle(label).color : null,
  }
}

/** 正文 live 行绘制（对拍锚点：标题行携带 callout/quiet 行级类） */
function livePaint(type: string) {
  const line = [...document.querySelectorAll<HTMLElement>('.cm-line.callout-title')]
    .find((el) => el.closest('.vsidian-callout-wrap')?.getAttribute('data-callout') === type)
  if (!line) return null
  const s = getComputedStyle(line.closest<HTMLElement>('.vsidian-callout-wrap')!)
  const icon = line.querySelector<HTMLElement>('.callout-icon')
  const is = icon ? getComputedStyle(icon) : null
  return {
    bgColor: s.backgroundColor,
    bgImage: s.backgroundImage,
    iconColor: is ? is.backgroundColor : null,
    iconMask: is ? (is.maskImage ?? is.webkitMaskImage) : null,
  }
}

/** 正文阅读容器绘制（对拍锚点：.markdown-preview-view 下真实 .callout） */
function readingPaint(type: string) {
  const el = document.querySelector<HTMLElement>(
    `.markdown-preview-view div.callout[data-callout="${CSS.escape(type)}"]`)
  if (!el) return null
  const s = getComputedStyle(el)
  return { bgColor: s.backgroundColor, bgImage: s.backgroundImage }
}

/** 普通引用行绘制（无 Callout 行的呈现对拍锚点） */
function quotePaint() {
  // T05：callout 行不再挂行级 .callout（迁 wrapper）——排除 wrapper 内的 quiet 行
  const line = [...document.querySelectorAll<HTMLElement>('.cm-line.vsidian-quote-line')]
    .find((el) => !el.classList.contains('vsidian-callout-quiet'))
  if (!line) return null
  const s = getComputedStyle(line)
  return {
    bgColor: s.backgroundColor,
    shadowColor: s.boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? s.boxShadow,
  }
}

Object.assign(window, {
  faceStructure,
  rowPaint,
  livePaint,
  readingPaint,
  quotePaint,
  probeCount: () => document.querySelectorAll('.vsidian-callout-menu-probe').length,
})
