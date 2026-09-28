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
  focusMenuDom,
  type MenuDomClassNames,
} from '../../src/webview/contextMenuDom'
import type { RenderedMenuGroup, RenderedMenuItem } from '../../src/shared/contextMenu'

/** 取词器注入（测试不依赖语言包装配态） */
const label = (key: MessageKey): string => `<${key}>`

const item = (over: Partial<RenderedMenuItem> & { id: string }): RenderedMenuItem => ({
  labelKey: 'contextMenu.copy' as MessageKey,
  command: over.id,
  group: 'g',
  danger: false,
  enabled: true,
  checked: false,
  order: 0,
  ...over,
})

const build = (groups: readonly RenderedMenuGroup[]) =>
  buildMenuDom(groups, { onCommand: () => {}, resolveLabel: label })

describe('子菜单分组分隔线（#183 验收反馈）', () => {
  /** 直接子级分隔线计数（jsdom 对 :scope > 支持不可靠，children 过滤等价） */
  const directSeps = (host: HTMLElement) =>
    [...host.children].filter((el) => el.classList.contains(CONTEXT_MENU_CLASS_NAMES.separator))

  it('children 跨组落分隔线：每个组边界一条，role=presentation', () => {
    const menu = build([{
      id: 'g', items: [item({
        id: 'parent', children: [
          item({ id: 'a1', group: 'ga' }),
          item({ id: 'a2', group: 'ga' }),
          item({ id: 'b1', group: 'gb' }),
          item({ id: 'c1', group: 'gc' }),
        ],
      })],
    }])
    const submenu = menu.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.submenu}`)!
    const seps = directSeps(submenu)
    expect(seps.length, '两个组边界各一条（ga|gb、gb|gc）').toBe(2)
    expect(seps[0]!.getAttribute('role')).toBe('presentation')
  })

  it('单组 children 无分隔线（与既有平铺观感一致——大纲菜单子菜单不受影响）', () => {
    const menu = build([{
      id: 'g', items: [item({
        id: 'parent', children: [
          item({ id: 'a1', group: 'ga' }),
          item({ id: 'a2', group: 'ga' }),
        ],
      })],
    }])
    const submenu = menu.querySelector<HTMLElement>(`.${CONTEXT_MENU_CLASS_NAMES.submenu}`)!
    expect(directSeps(submenu).length).toBe(0)
  })
})

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

describe('键盘方向键导航（规格交互契约：Up/Down 移动、Right 进子级、Left 退出）', () => {
  // 顶级面：a（叶）/ disabled（叶，跳过）/ parent（子菜单 child1+child2）
  const navGroups: readonly RenderedMenuGroup[] = [{
    id: 'g',
    items: [
      item({ id: 'a' }),
      item({ id: 'off', enabled: false }),
      item({ id: 'parent', children: [item({ id: 'child1' }), item({ id: 'child2' })] }),
    ],
  }]

  /** 挂 body（jsdom 焦点语义需要连接态）并派发冒泡 keydown 到当前焦点元素 */
  const mount = (groups: readonly RenderedMenuGroup[] = navGroups) => {
    const menu = build(groups)
    document.body.appendChild(menu)
    return menu
  }
  const press = (el: Element, key: string): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }
  const btn = (menu: HTMLElement, command: string): HTMLButtonElement =>
    menu.querySelector<HTMLButtonElement>(`button[data-vsidian-command="${command}"]`)!
  const activeCommand = (menu: HTMLElement): string | null =>
    (menu.ownerDocument.activeElement as HTMLElement | null)?.dataset?.['vsidianCommand'] ?? null

  it('容器 tabindex=-1（键盘导航起点：可编程聚焦、不进 Tab 序列）', () => {
    const menu = mount()
    expect(menu.getAttribute('tabindex')).toBe('-1')
    menu.remove()
  })

  it('focusMenuDom 聚焦容器：ArrowDown 从顶级面首项起步，ArrowUp 从末项起步', () => {
    const menu = mount()
    focusMenuDom(menu)
    expect(menu.ownerDocument.activeElement).toBe(menu)
    press(menu, 'ArrowDown')
    expect(activeCommand(menu)).toBe('a')
    menu.remove()

    const menu2 = mount()
    focusMenuDom(menu2)
    press(menu2, 'ArrowUp')
    expect(activeCommand(menu2), 'ArrowUp 从容器起步落末项').toBe('parent')
    menu2.remove()
  })

  it('ArrowDown/Up 在当前面内循环移动且跳过置灰项', () => {
    const menu = mount()
    const first = btn(menu, 'a')
    first.focus()
    press(first, 'ArrowDown')
    expect(activeCommand(menu), '跳过 disabled').toBe('parent')
    press(menu.ownerDocument.activeElement!, 'ArrowDown')
    expect(activeCommand(menu), '末项循环回首项').toBe('a')
    press(menu.ownerDocument.activeElement!, 'ArrowUp')
    expect(activeCommand(menu), '反向循环回末项').toBe('parent')
    menu.remove()
  })

  it('ArrowRight 进入子菜单首项；父项 aria-expanded 镜像为 true', () => {
    const menu = mount()
    const parent = btn(menu, 'parent')
    parent.focus()
    press(parent, 'ArrowRight')
    expect(activeCommand(menu)).toBe('child1')
    expect(parent.getAttribute('aria-expanded')).toBe('true')
    menu.remove()
  })

  it('子菜单面内 ArrowDown 移动子项；ArrowLeft 退回父项 button', () => {
    const menu = mount()
    const parent = btn(menu, 'parent')
    parent.focus()
    press(parent, 'ArrowRight')
    press(menu.ownerDocument.activeElement!, 'ArrowDown')
    expect(activeCommand(menu)).toBe('child2')
    press(menu.ownerDocument.activeElement!, 'ArrowLeft')
    expect(menu.ownerDocument.activeElement).toBe(parent)
    menu.remove()
  })

  it('顶级面 ArrowLeft 无操作；叶项 ArrowRight 无操作（均不抛错不挪焦点）', () => {
    const menu = mount()
    const leaf = btn(menu, 'a')
    leaf.focus()
    press(leaf, 'ArrowLeft')
    expect(menu.ownerDocument.activeElement).toBe(leaf)
    press(leaf, 'ArrowRight')
    expect(menu.ownerDocument.activeElement, '叶项无子菜单不动').toBe(leaf)
    menu.remove()
  })

  it('Enter/Space 不被菜单 keydown 拦截（原生 button 激活语义保留）', () => {
    const menu = mount()
    const leaf = btn(menu, 'a')
    leaf.focus()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    leaf.dispatchEvent(enter)
    expect(enter.defaultPrevented, 'Enter 不 preventDefault').toBe(false)
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    leaf.dispatchEvent(space)
    expect(space.defaultPrevented, 'Space 不 preventDefault').toBe(false)
    menu.remove()
  })

  it('焦点移出父项宿主后 aria-expanded 回落 false（镜像 CSS :focus-within 显隐）', () => {
    const menu = mount()
    const parent = btn(menu, 'parent')
    parent.focus()
    press(parent, 'ArrowRight')
    expect(parent.getAttribute('aria-expanded')).toBe('true')
    press(menu.ownerDocument.activeElement!, 'ArrowLeft')
    press(menu.ownerDocument.activeElement!, 'ArrowUp')
    expect(menu.ownerDocument.activeElement).toBe(btn(menu, 'a'))
    expect(parent.getAttribute('aria-expanded'), '宿主失焦且无 open 类回落').toBe('false')
    menu.remove()
  })

  it('类名参数化（大纲菜单）同样导航：face 判定走 role=menu 锚点不依赖内核类名', () => {
    const menu = buildMenuDom(
      [{
        id: 'outline',
        items: [
          item({ id: 'expandRecursively' }),
          item({ id: 'copy', children: [item({ id: 'copyHeading' }), item({ id: 'copyLink' })] }),
        ],
      }],
      {
        onCommand: () => {},
        resolveLabel: label,
        classNames: {
          menu: 'vsidian-outline-menu',
          itemHost: 'vsidian-outline-menu-host',
          item: 'vsidian-outline-menu-item',
          submenu: 'vsidian-outline-menu-submenu',
        },
      },
    )
    document.body.appendChild(menu)
    focusMenuDom(menu)
    press(menu, 'ArrowDown')
    expect(activeCommand(menu)).toBe('expandRecursively')
    press(menu.ownerDocument.activeElement!, 'ArrowDown')
    press(menu.ownerDocument.activeElement!, 'ArrowRight')
    expect(activeCommand(menu), '大纲子菜单首项').toBe('copyHeading')
    press(menu.ownerDocument.activeElement!, 'ArrowLeft')
    expect(activeCommand(menu)).toBe('copy')
    menu.remove()
  })
})
