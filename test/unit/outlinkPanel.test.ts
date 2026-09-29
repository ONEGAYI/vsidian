// @vitest-environment jsdom
// 出链面板 DOM 契约测试（出链面板批次）：四态渲染、条目两行结构、断链
// 不可点属性、页头计数与 toggle 图标形态。
import { describe, expect, it } from 'vitest'
import {
  buildOutlinksDom,
  OUTLINK_CLASS_NAMES,
  outlinkPathLabel,
  renderOutlinksState,
} from '../../src/webview/outlinkPanel'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { OutlinkItemPayload } from '../../src/shared/protocol'

installLocale('zh-cn', zhCn)

function itemOf(overrides: Partial<OutlinkItemPayload> = {}): OutlinkItemPayload {
  return {
    targetDisplay: '设计笔记',
    targetRelPath: 'docs/设计笔记.md',
    targetFsPath: 'C:/vault/docs/设计笔记.md',
    kind: 'wikilink',
    anchor: '',
    resolved: true,
    start: 10,
    end: 20,
    ...overrides,
  }
}

describe('buildOutlinksDom', () => {
  it('按钮与面板带稳定类名与可访问语义；初始为 loading 占位', () => {
    const { toggle, panel } = buildOutlinksDom()
    expect(toggle.className).toBe('vsidian-outlinks-toggle')
    expect(panel.className).toBe(OUTLINK_CLASS_NAMES.panel)
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('aria-label')).toBe('当前笔记中的链接')
    expect(panel.querySelector(`.${OUTLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('正在加载链接…')
  })

  it('toggle 图标为链环 SVG（currentColor，线宽归 CSS 契约）', () => {
    const svg = buildOutlinksDom().toggle.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBeNull()
  })
})

describe('renderOutlinksState：四态', () => {
  it('ready + items：页头（标题 + 计数）+ 平铺条目', () => {
    const panel = buildOutlinksDom().panel
    const items = [
      itemOf(),
      itemOf({ targetDisplay: '附件', targetRelPath: 'pic.png', targetFsPath: 'C:/vault/pic.png', kind: 'image', resolved: true, start: 30, end: 44 }),
    ]
    renderOutlinksState(panel, { state: 'ready', updating: false, items })
    const header = panel.querySelector(`.${OUTLINK_CLASS_NAMES.pageHeader}`)!
    expect(header.querySelector(`.${OUTLINK_CLASS_NAMES.pageTitle}`)!.textContent)
      .toBe('当前笔记中的链接')
    expect(header.querySelector(`.${OUTLINK_CLASS_NAMES.pageCount}`)!.textContent).toBe('2')
    expect(panel.querySelectorAll(`.${OUTLINK_CLASS_NAMES.item}`)).toHaveLength(2)
    // 平铺：无分组无分隔线
    expect(panel.querySelectorAll(`.${OUTLINK_CLASS_NAMES.item} + .${OUTLINK_CLASS_NAMES.item}`).length).toBe(1)
  })

  it('条目两行结构：行 1 图标 + 目标名（svg 挂行内）、行 2 路径', () => {
    const panel = buildOutlinksDom().panel
    renderOutlinksState(panel, { state: 'ready', updating: false, items: [itemOf()] })
    const item = panel.querySelector(`.${OUTLINK_CLASS_NAMES.item}`)! as HTMLElement
    const nameRow = item.querySelector(`.${OUTLINK_CLASS_NAMES.itemName}`)!
    expect(nameRow.querySelector('svg')).not.toBeNull()
    expect(nameRow.textContent).toBe('设计笔记')
    expect(item.querySelector(`.${OUTLINK_CLASS_NAMES.itemPath}`)!.textContent)
      .toBe('docs/设计笔记')
  })

  it('断链条目：broken 弱化类 + disabled 属性 + 不写跳转 data；命中条目写 data', () => {
    const panel = buildOutlinksDom().panel
    const items = [
      itemOf({ targetDisplay: '不存在的笔记', targetRelPath: null, targetFsPath: null, resolved: false }),
      itemOf({ targetDisplay: '锚点目标', anchor: '深处小节', resolved: true, start: 30, end: 50 }),
    ]
    renderOutlinksState(panel, { state: 'ready', updating: false, items })
    const nodes = panel.querySelectorAll(`.${OUTLINK_CLASS_NAMES.item}`)!
    const broken = nodes[0] as HTMLButtonElement
    expect(broken.classList.contains(OUTLINK_CLASS_NAMES.broken)).toBe(true)
    expect(broken.disabled).toBe(true)
    expect(broken.getAttribute('aria-disabled')).toBe('true')
    expect(broken.dataset['vsidianTarget']).toBeUndefined()
    const ok = nodes[1] as HTMLButtonElement
    expect(ok.disabled).toBe(false)
    expect(ok.dataset['vsidianTarget']).toBe('C:/vault/docs/设计笔记.md')
    expect(ok.dataset['vsidianAnchor']).toBe('深处小节')
  })

  it('ready + updating：更新中细条', () => {
    const panel = buildOutlinksDom().panel
    renderOutlinksState(panel, { state: 'ready', updating: true, items: [itemOf()] })
    expect(panel.querySelector(`.${OUTLINK_CLASS_NAMES.updating}`)).not.toBeNull()
  })

  it('ready + 空 items：空态占位（无链接）', () => {
    const panel = buildOutlinksDom().panel
    renderOutlinksState(panel, { state: 'ready', updating: false, items: [] })
    expect(panel.querySelector(`.${OUTLINK_CLASS_NAMES.item}`)).toBeNull()
    expect(panel.querySelector(`.${OUTLINK_CLASS_NAMES.placeholder}`)!.textContent).toBe('无链接')
  })

  it('error 态：无工作区与读取失败分开文案', () => {
    const panel = buildOutlinksDom().panel
    renderOutlinksState(panel, { state: 'error', updating: false, reason: 'no-workspace', items: [] })
    expect(panel.querySelector(`.${OUTLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('未打开工作区，无法查看出链')
    renderOutlinksState(panel, { state: 'error', updating: false, reason: 'read-error', items: [] })
    expect(panel.querySelector(`.${OUTLINK_CLASS_NAMES.placeholder}`)!.textContent).toBe('出链不可用')
  })
})

describe('辅助口径', () => {
  it('目标路径显示去 .md 扩展、目录段保留；非 md 不动', () => {
    expect(outlinkPathLabel('docs/设计.md')).toBe('docs/设计')
    expect(outlinkPathLabel('pic.png')).toBe('pic.png')
  })
})
