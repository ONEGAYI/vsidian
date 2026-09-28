// @vitest-environment jsdom
// 统一右键菜单 DOM 装配契约（webview/contextMenuDom.ts，#183）：role=menu/
// menuitem（勾选能力项 menuitemcheckbox）、组间分组线、提示列（右对齐小字
// 的类锚点；未绑定不占位）、置灰（disabled + 点击不回调）、danger、文字
// 徽标、图标位（data-icon；资产缺失留空的 DOM 形态）、子菜单（aria-
// haspopup/aria-expanded + 父项点击展开兜底 + cue）、类名参数化（大纲菜单
// 迁移：子集映射产出既有 vsidian-outline-menu* 类名，视觉不变的前提）与
// 子菜单翻转装配期判定（jsdom 无布局时的安全退化）。
import { describe, expect, it } from 'vitest'
import type { MessageKey } from '../../src/shared/locales/en'
import {
  applySubmenuFlip,
  buildMenuDom,
  CONTEXT_MENU_CLASS_NAMES,
  type MenuDomClassNames,
} from '../../src/webview/contextMenuDom'
import type { RenderedMenuGroup, RenderedMenuItem } from '../../src/shared/contextMenu'

/** 取词器注入（测试不依赖语言包装配态） */
const label = (key: MessageKey): string => `<${key}>`

const item = (over: Partial<RenderedMenuItem> & { id: string }): RenderedMenuItem => ({
  labelKey: 'contextMenu.copy' as MessageKey,
  command: over.id,
  danger: false,
  enabled: true,
  checked: false,
  order: 0,
  ...over,
})

const build = (groups: readonly RenderedMenuGroup[]) =>
  buildMenuDom(groups, { onCommand: () => {}, resolveLabel: label })

describe('基础装配（role / 命令锚点 / 分组线）', () => {
  it('容器 role=menu；顶级项 button role=menuitem 携 data-vsidian-command；文案经取词器', () => {
    const menu = build([{ id: 'link', items: [item({ id: 'selectAll' })] }])
    expect(menu.className).toBe(CONTEXT_MENU_CLASS_NAMES.menu)
    expect(menu.getAttribute('role')).toBe('menu')
    const btn = menu.querySelector<HTMLButtonElement>('button')!
    expect(btn.getAttribute('role')).toBe('menuitem')
    expect(btn.dataset['vsidianCommand']).toBe('selectAll')
    expect(btn.textContent).toContain('<contextMenu.copy>')
  })

  it('两组之间恰一条分组线（首组之前无）；单组无分组线', () => {
    const two = build([
      { id: 'link', items: [item({ id: 'a' })] },
      { id: 'clipboard', items: [item({ id: 'b' })] },
    ])
    expect(two.querySelectorAll(`.${CONTEXT_MENU_CLASS_NAMES.separator}`)).toHaveLength(1)
    const one = build([{ id: 'link', items: [item({ id: 'a' })] }])
    expect(one.querySelectorAll(`.${CONTEXT_MENU_CLASS_NAMES.separator}`)).toHaveLength(0)
  })

  it('叶命令点击回调 command；置灰项 disabled 且点击不回调', () => {
    const got: string[] = []
    const menu = buildMenuDom(
      [{ id: 'g', items: [item({ id: 'ok', command: 'ok' }), item({ id: 'no', command: 'no', enabled: false })] }],
      { onCommand: (c) => got.push(c), resolveLabel: label },
    )
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons[1]!.disabled).toBe(true)
    buttons[0]!.click()
    buttons[1]!.click()
    expect(got).toEqual(['ok'])
  })
})

describe('项内槽位（图标 / 徽标 / 勾选 / 提示 / danger）', () => {
  const slot = (over: Partial<RenderedMenuItem>) => {
    const menu = build([{ id: 'g', items: [item({ id: 'x', ...over })] }])
    return menu.querySelector<HTMLButtonElement>('button')!
  }

  it('图标位：span 携 data-icon（资产缺失时无 CSS 规则即留空——DOM 形态稳定）', () => {
    const btn = slot({ iconKey: 'cut' })
    const icon = btn.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.icon}`)!
    expect(icon.dataset['icon']).toBe('cut')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  it('文字徽标：span.badge 文本（H1 档），无图标位', () => {
    const btn = slot({ badge: 'H1' })
    expect(btn.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.badge}`)!.textContent).toBe('H1')
    expect(btn.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.icon}`)).toBeNull()
  })

  it('勾选能力项：role=menuitemcheckbox + aria-checked + ✓ 槽；未勾选 aria-checked=false', () => {
    const checked = slot({ checked: true })
    expect(checked.getAttribute('role')).toBe('menuitemcheckbox')
    expect(checked.getAttribute('aria-checked')).toBe('true')
    expect(checked.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.check}`)!.textContent).toBe('✓')
    const plain = slot({})
    expect(plain.getAttribute('role')).toBe('menuitem')
    expect(plain.getAttribute('aria-checked')).toBeNull()
    expect(plain.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.check}`)).toBeNull()
  })

  it('提示列：span.hint 文案（右对齐小字由 CSS 承载）；未提供 hint 不占位', () => {
    const withHint = slot({ hint: 'Ctrl+A' })
    expect(withHint.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.hint}`)!.textContent).toBe('Ctrl+A')
    const without = slot({})
    expect(without.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.hint}`)).toBeNull()
  })

  it('danger 项：按钮挂 danger 类', () => {
    expect(slot({ danger: true }).classList.contains(CONTEXT_MENU_CLASS_NAMES.danger)).toBe(true)
  })

  it('文案落在 label 槽（与 hint/cue 并列不互相覆盖）', () => {
    const btn = slot({ hint: 'Ctrl+A' })
    expect(btn.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.label}`)!.textContent).toBe('<contextMenu.copy>')
  })
})

describe('子菜单（级联结构 / aria / 点击展开兜底）', () => {
  const submenuGroups: readonly RenderedMenuGroup[] = [{
    id: 'g',
    items: [
      item({
        id: 'parent',
        command: 'parent',
        children: [item({ id: 'child', command: 'child' })],
      }),
    ],
  }]

  it('子菜单嵌父项宿主内 role=menu；父项 aria-haspopup + aria-expanded=false + cue；父项不触发命令', () => {
    const got: string[] = []
    const menu = buildMenuDom(submenuGroups, { onCommand: (c) => got.push(c), resolveLabel: label })
    const submenu = menu.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.submenu}`)!
    expect(submenu.getAttribute('role')).toBe('menu')
    const host = submenu.parentElement!
    expect(host.classList.contains(CONTEXT_MENU_CLASS_NAMES.itemHost)).toBe(true)
    const parentBtn = host.querySelector<HTMLButtonElement>('button')!
    expect(parentBtn.getAttribute('aria-haspopup')).toBe('true')
    expect(parentBtn.getAttribute('aria-expanded')).toBe('false')
    expect(parentBtn.querySelector(`.${CONTEXT_MENU_CLASS_NAMES.cue}`)).not.toBeNull()
    parentBtn.click()
    expect(got, '父项点击只展开不执行命令').toEqual([])
  })

  it('父项点击展开兜底：宿主挂 open 类 + aria-expanded=true；再点收起', () => {
    const menu = build(submenuGroups)
    const host = menu.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.itemHost}`)!
    const parentBtn = host.querySelector<HTMLButtonElement>('button')!
    parentBtn.click()
    expect(host.classList.contains(CONTEXT_MENU_CLASS_NAMES.open)).toBe(true)
    expect(parentBtn.getAttribute('aria-expanded')).toBe('true')
    parentBtn.click()
    expect(host.classList.contains(CONTEXT_MENU_CLASS_NAMES.open)).toBe(false)
    expect(parentBtn.getAttribute('aria-expanded')).toBe('false')
  })

  it('子菜单内叶命令点击走同一回调', () => {
    const got: string[] = []
    const menu = buildMenuDom(submenuGroups, { onCommand: (c) => got.push(c), resolveLabel: label })
    menu.querySelector<HTMLButtonElement>('button[data-vsidian-command="child"]')!.click()
    expect(got).toEqual(['child'])
  })

  it('子项全置灰时父项点击仍展开（可见性由模型层决定，DOM 不二次过滤）', () => {
    const groups: readonly RenderedMenuGroup[] = [{
      id: 'g',
      items: [item({ id: 'parent', children: [item({ id: 'child', enabled: false })] })],
    }]
    const menu = build(groups)
    const host = menu.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.itemHost}`)!
    host.querySelector<HTMLButtonElement>('button')!.click()
    expect(host.classList.contains(CONTEXT_MENU_CLASS_NAMES.open)).toBe(true)
  })
})

describe('类名参数化（大纲菜单迁移：内核装配产出既有类名，视觉不变）', () => {
  const outlineNames: Partial<MenuDomClassNames> = {
    menu: 'vsidian-outline-menu',
    itemHost: 'vsidian-outline-menu-host',
    item: 'vsidian-outline-menu-item',
    submenu: 'vsidian-outline-menu-submenu',
    danger: 'vsidian-outline-menu-danger',
    cue: 'vsidian-outline-menu-cue',
  }

  it('子集映射时使用传入类名；未映射槽位（分组线/提示列等）不产生节点', () => {
    const groups: readonly RenderedMenuGroup[] = [
      { id: 'outline', items: [item({ id: 'expandRecursively' })] },
      { id: 'outline2', items: [item({ id: 'delete', danger: true })] },
    ]
    const menu = buildMenuDom(groups, { onCommand: () => {}, resolveLabel: label, classNames: outlineNames })
    expect(menu.className).toBe('vsidian-outline-menu')
    const btns = [...menu.querySelectorAll<HTMLButtonElement>('button')]
    expect(btns.every((b) => b.classList.contains('vsidian-outline-menu-item'))).toBe(true)
    expect(btns[1]!.classList.contains('vsidian-outline-menu-danger')).toBe(true)
    // 未映射的槽位类名回落内核缺省——但产出的分组线在映射场景同样产出
    // （内核类名的分隔线不与大纲既有样式冲突；outline 单组场景不出现）
    expect(menu.querySelectorAll('.vsidian-context-menu-separator')).toHaveLength(1)
  })

  it('outline 子菜单：嵌套结构与 cue 使用映射类名', () => {
    const groups: readonly RenderedMenuGroup[] = [{
      id: 'outline',
      items: [item({ id: 'copy', children: [item({ id: 'copyHeading' })] })],
    }]
    const menu = buildMenuDom(groups, { onCommand: () => {}, resolveLabel: label, classNames: outlineNames })
    expect(menu.querySelector('.vsidian-outline-menu-submenu')).not.toBeNull()
    expect(menu.querySelector('.vsidian-outline-menu-cue')).not.toBeNull()
  })
})

describe('子菜单翻转装配期判定（applySubmenuFlip）', () => {
  it('jsdom 无布局（尺寸/坐标全 0）：安全跳过，不加翻转类、不抛错', () => {
    const menu = build([{ id: 'g', items: [item({ id: 'parent', children: [item({ id: 'child' })] })] }])
    applySubmenuFlip(menu, 900)
    const submenu = menu.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.submenu}`)!
    expect(submenu.classList.contains(CONTEXT_MENU_CLASS_NAMES.submenuFlip)).toBe(false)
  })
})
