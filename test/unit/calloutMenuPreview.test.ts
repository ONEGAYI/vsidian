// @vitest-environment jsdom
// Callout 类型菜单取色预览（#658/T07）结构契约：探针装配（隐藏定位 + 正文
// 作用域祖先 + 文档样式身份 + 13 类型探针元素）、行内预览槽装配（类型行
// 色底槽 / 无 Callout 引用槽 / 自定义行占位不伪装）、refresh 幂等与 dispose
// 归零（无泄漏）。颜色数值的绘制层断言归浏览器套件 calloutMenu（同色相邻
// 类型、片段/主题/文档样式热更新、与正文呈现对拍）——jsdom 无级联计算值。
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_MENU_PROBE_CLASS,
  CALLOUT_MENU_SWATCH_CLASS,
  mountCalloutMenuPreview,
} from '../../src/webview/calloutMenuPreview'
import { CALLOUT_TYPE_IDS } from '../../src/shared/calloutPlan'

/** 装配一个含 Callout 类型行的菜单 DOM（模拟 buildMenuDom 产物形态） */
const buildMenu = (commands: string[]): HTMLElement => {
  const menu = document.createElement('div')
  menu.className = 'vsidian-context-menu'
  for (const command of commands) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset['vsidianCommand'] = command
    const label = document.createElement('span')
    label.className = 'vsidian-context-menu-label'
    btn.appendChild(label)
    menu.appendChild(btn)
  }
  return menu
}

const allCommands = ['calloutType:none', ...CALLOUT_TYPE_IDS.map((id) => `calloutType:${id}`), 'calloutType:custom']

describe('Callout 类型菜单取色预览（#658/T07：结构与生命周期）', () => {
  it('菜单含类型行时装配探针：隐藏定位 + 双正文作用域祖先 + 文档样式身份 + 全类型探针元素', () => {
    const scopeRoot = document.createElement('div')
    document.body.appendChild(scopeRoot)
    const menu = buildMenu(allCommands)
    document.body.appendChild(menu)
    const handle = mountCalloutMenuPreview(menu, { scopeRoot })
    expect(handle, '应返回生命周期句柄').not.toBeNull()
    const probe = scopeRoot.querySelector<HTMLElement>(`.${CALLOUT_MENU_PROBE_CLASS}`)
    expect(probe, '探针应装配在 scopeRoot 内').not.toBeNull()
    expect(probe!.className).toContain('markdown-preview-view')
    expect(probe!.className).toContain('markdown-source-view')
    expect(probe!.className).toContain('mod-cm6')
    expect(probe!.getAttribute('data-vsidian-doc-scope')).toBe('doc')
    expect(probe!.getAttribute('aria-hidden')).toBe('true')
    // 隐藏定位（T01 §8：布局零影响——不在正文流内占位）
    const s = probe!.style
    expect(s.position).toBe('absolute')
    expect(s.visibility).toBe('hidden')
    // 13 规范类型各一个探针 callout（含标题结构：图标计算面 .callout-icon）
    const callouts = [...probe!.querySelectorAll<HTMLElement>('.callout')]
    expect(callouts.map((el) => el.getAttribute('data-callout'))).toEqual([...CALLOUT_TYPE_IDS])
    for (const el of callouts) {
      expect(el.querySelector('.callout-title .callout-icon'), '标题结构供标题色/图标计算').not.toBeNull()
    }
    handle!.dispose()
    menu.remove()
    scopeRoot.remove()
  })

  it('行为行装配：类型行色底槽 / 无 Callout 引用槽 / 自定义行占位（不伪装固定类型）', () => {
    const scopeRoot = document.createElement('div')
    document.body.appendChild(scopeRoot)
    const menu = buildMenu(allCommands)
    document.body.appendChild(menu)
    const handle = mountCalloutMenuPreview(menu, { scopeRoot })
    const swatches = [...menu.querySelectorAll<HTMLElement>(`.${CALLOUT_MENU_SWATCH_CLASS}`)]
    expect(swatches.length, '15 行各一个预览槽（13 类型 + 无 Callout + 自定义占位）').toBe(15)
    const swatchOf = (command: string) =>
      menu.querySelector<HTMLElement>(`button[data-vsidian-command="${command}"] .${CALLOUT_MENU_SWATCH_CLASS}`)
    // 类型行：色底槽 + 图标位（aria-hidden 装饰）
    const note = swatchOf('calloutType:note')!
    expect(note.getAttribute('aria-hidden')).toBe('true')
    expect(note.querySelector('.vsidian-context-menu-swatch-icon')).not.toBeNull()
    // 无 Callout：引用呈现槽（普通引用色变体，非类型色底）
    expect(swatchOf('calloutType:none')!.classList.contains(`${CALLOUT_MENU_SWATCH_CLASS}-quote`)).toBe(true)
    // 自定义输入：占位槽（保持列对齐），无类型色底变量——菜单语义不伪装固定类型
    const custom = swatchOf('calloutType:custom')!
    expect(custom.classList.contains(`${CALLOUT_MENU_SWATCH_CLASS}-placeholder`)).toBe(true)
    expect(custom.style.getPropertyValue('--callout-color')).toBe('')
    // 其他菜单行（非 calloutType 命令）不被装配
    const other = buildMenu(['bold'])
    document.body.appendChild(other)
    expect(other.querySelectorAll(`.${CALLOUT_MENU_SWATCH_CLASS}`)).toHaveLength(0)
    other.remove()
    handle!.dispose()
    menu.remove()
    scopeRoot.remove()
  })

  it('refresh 幂等：重复刷新不复制预览槽（每行仍恰一个）', () => {
    const scopeRoot = document.createElement('div')
    document.body.appendChild(scopeRoot)
    const menu = buildMenu(allCommands)
    document.body.appendChild(menu)
    const handle = mountCalloutMenuPreview(menu, { scopeRoot })!
    handle.refresh()
    handle.refresh()
    expect(menu.querySelectorAll(`.${CALLOUT_MENU_SWATCH_CLASS}`)).toHaveLength(15)
    handle.dispose()
    menu.remove()
    scopeRoot.remove()
  })

  it('dispose 归零：探针从 scopeRoot 移除，重复 dispose 安全', () => {
    const scopeRoot = document.createElement('div')
    document.body.appendChild(scopeRoot)
    const menu = buildMenu(allCommands)
    document.body.appendChild(menu)
    const handle = mountCalloutMenuPreview(menu, { scopeRoot })!
    expect(scopeRoot.querySelector(`.${CALLOUT_MENU_PROBE_CLASS}`)).not.toBeNull()
    handle.dispose()
    handle.dispose()
    expect(scopeRoot.querySelector(`.${CALLOUT_MENU_PROBE_CLASS}`)).toBeNull()
    menu.remove()
    scopeRoot.remove()
  })

  it('菜单不含类型行时不装配（其他菜单零影响）', () => {
    const scopeRoot = document.createElement('div')
    document.body.appendChild(scopeRoot)
    const menu = buildMenu(['bold', 'italic'])
    document.body.appendChild(menu)
    const handle = mountCalloutMenuPreview(menu, { scopeRoot })
    expect(handle).toBeNull()
    expect(scopeRoot.querySelector(`.${CALLOUT_MENU_PROBE_CLASS}`)).toBeNull()
    menu.remove()
    scopeRoot.remove()
  })
})
