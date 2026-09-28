// 统一右键菜单 DOM 装配（#183）：内核渲染模型（shared/contextMenu 的
// RenderedMenuGroup）→ 菜单浮层 DOM。稳定类名走 CONTEXT_MENU_CLASS_NAMES
// （新命名空间 vsidian-context-menu*，样式契约 entry: context-menu）；
// 类名表参数化——大纲菜单迁移传入 vsidian-outline-menu* 子集映射，内核
// 装配产出既有类名（视觉不变的迁移前提）。
//
// 语义单一事实源（供契约测试 contextMenuDom.test.ts 对拍）：
//
// 1. 容器 role=menu；项为 button（键盘 Tab/Enter/空格原生可达），命令 id
//    落 data-vsidian-command；勾选能力项 role=menuitemcheckbox + aria-checked
//    （其余 menuitem）；置灰用原生 disabled（键盘跳过、点击无回调）。
//
// 2. 分组线只在组间产出（首组之前无）；组内可见项为零时模型层已整组收起，
//    DOM 不出现孤立分隔线。
//
// 3. 子菜单显隐唯一开关是 CSS :hover/:focus-within（无 JS 展开状态机）；
//    父项点击展开是兜底通道（宿主挂 open 类 + aria-expanded 派生）；父项
//    点击不执行命令（无叶命令）。
//
// 4. 子菜单右缘放不下自动翻左侧：applySubmenuFlip 在菜单挂载后一次判定
//    （临时显形量宽 → shared/contextMenu.submenuSide 纯函数 → flip 类；
//    无布局环境安全跳过）。
import type { MessageKey } from '../shared/locales/en'
import { t } from '../shared/i18n'
import { submenuSide, type RenderedMenuGroup, type RenderedMenuItem } from '../shared/contextMenu'

/** 菜单 DOM 稳定类名（样式与断言的公共锚点；样式契约 entry: context-menu） */
export interface MenuDomClassNames {
  menu: string
  /** 组容器（分隔线的兄弟单元；当前仅作语义锚，样式落在组间线上） */
  group: string
  /** 组间分组线 */
  separator: string
  /** 菜单项宿主（顶级项与子菜单项共用；含子菜单的父项内嵌 submenu） */
  itemHost: string
  /** 菜单项按钮（键盘可达的激活目标） */
  item: string
  /** 图标位（data-icon 携 key；CSS 无规则即留空——资产后补即生效） */
  icon: string
  /** 文字徽标位（H1–H6） */
  badge: string
  /** 勾选指示槽（✓） */
  check: string
  /** 文案槽（与 hint/cue 并列） */
  label: string
  /** 快捷键提示列（右对齐、小字号 + 低不透明度；未绑定不占位） */
  hint: string
  /** 级联子菜单容器（CSS :hover/:focus-within 显隐） */
  submenu: string
  /** 子菜单左翻态（装配期判定加类；right:100% 承载） */
  submenuFlip: string
  /** 子菜单指示箭头（▸） */
  cue: string
  /** 破坏性命令红字 */
  danger: string
  /** 父项宿主展开态（点击兜底通道） */
  open: string
}

export const CONTEXT_MENU_CLASS_NAMES: MenuDomClassNames = {
  menu: 'vsidian-context-menu',
  group: 'vsidian-context-menu-group',
  separator: 'vsidian-context-menu-separator',
  itemHost: 'vsidian-context-menu-host',
  item: 'vsidian-context-menu-item',
  icon: 'vsidian-context-menu-icon',
  badge: 'vsidian-context-menu-badge',
  check: 'vsidian-context-menu-check',
  label: 'vsidian-context-menu-label',
  hint: 'vsidian-context-menu-hint',
  submenu: 'vsidian-context-menu-submenu',
  submenuFlip: 'vsidian-menu-flip',
  cue: 'vsidian-context-menu-cue',
  danger: 'vsidian-context-menu-danger',
  open: 'vsidian-menu-open',
} as const

export interface BuildMenuDomOptions {
  /** 类名映射（缺省 CONTEXT_MENU_CLASS_NAMES；大纲迁移传 vsidian-outline-menu* 子集） */
  classNames?: Partial<MenuDomClassNames>
  /** 叶命令回调（父项不触发） */
  onCommand: (command: string) => void
  /** 取词器（缺省 t()；测试注入绕过语言包装配态） */
  resolveLabel?: (key: MessageKey) => string
}

export function buildMenuDom(
  groups: readonly RenderedMenuGroup[],
  options: BuildMenuDomOptions,
): HTMLElement {
  const names: MenuDomClassNames = { ...CONTEXT_MENU_CLASS_NAMES, ...options.classNames }
  const resolveLabel = options.resolveLabel ?? ((key: MessageKey) => t(key))
  const menu = document.createElement('div')
  menu.className = names.menu
  menu.setAttribute('role', 'menu')

  const appendItem = (host: HTMLElement, def: RenderedMenuItem): void => {
    const itemHost = document.createElement('div')
    itemHost.className = names.itemHost
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = names.item
    btn.dataset['vsidianCommand'] = def.command
    if (!def.enabled) {
      btn.disabled = true
    }
    if (def.danger) {
      btn.classList.add(names.danger)
    }
    // 勾选语义按当前布尔渲染：勾选项 role=menuitemcheckbox + aria-checked
    // （aria-checked 在 menuitem 上不合法，未勾选项回落 menuitem、无 ✓ 槽）
    if (def.checked) {
      btn.setAttribute('role', 'menuitemcheckbox')
      btn.setAttribute('aria-checked', 'true')
    } else {
      btn.setAttribute('role', 'menuitem')
    }
    if (def.iconKey !== undefined) {
      const icon = document.createElement('span')
      icon.className = names.icon
      icon.setAttribute('aria-hidden', 'true')
      icon.dataset['icon'] = def.iconKey
      btn.appendChild(icon)
    }
    if (def.badge !== undefined) {
      const badge = document.createElement('span')
      badge.className = names.badge
      badge.setAttribute('aria-hidden', 'true')
      badge.textContent = def.badge
      btn.appendChild(badge)
    }
    if (def.checked) {
      const check = document.createElement('span')
      check.className = names.check
      check.setAttribute('aria-hidden', 'true')
      check.textContent = '✓'
      btn.appendChild(check)
    }
    const label = document.createElement('span')
    label.className = names.label
    label.textContent = resolveLabel(def.labelKey)
    btn.appendChild(label)
    if (def.hint !== undefined) {
      const hint = document.createElement('span')
      hint.className = names.hint
      hint.setAttribute('aria-hidden', 'true')
      hint.textContent = def.hint
      btn.appendChild(hint)
    }
    itemHost.appendChild(btn)
    if (def.children && def.children.length > 0) {
      const cue = document.createElement('span')
      cue.className = names.cue
      cue.setAttribute('aria-hidden', 'true')
      cue.textContent = '▸'
      btn.appendChild(cue)
      btn.setAttribute('aria-haspopup', 'true')
      btn.setAttribute('aria-expanded', 'false')
      // 父项点击展开兜底（显隐主通道仍是 CSS :hover/:focus-within——无 JS
      // 展开状态机）；父项无叶命令，点击不进 onCommand
      btn.addEventListener('click', () => {
        if (btn.disabled) {
          return
        }
        const open = itemHost.classList.toggle(names.open)
        btn.setAttribute('aria-expanded', String(open))
      })
      const submenu = document.createElement('div')
      submenu.className = names.submenu
      submenu.setAttribute('role', 'menu')
      for (const child of def.children) {
        appendItem(submenu, child)
      }
      itemHost.appendChild(submenu)
    } else {
      btn.addEventListener('click', () => {
        if (btn.disabled) {
          return
        }
        options.onCommand(def.command)
      })
    }
    host.appendChild(itemHost)
  }

  let firstGroup = true
  for (const group of groups) {
    if (group.items.length === 0) {
      continue
    }
    if (!firstGroup) {
      const separator = document.createElement('div')
      separator.className = names.separator
      separator.setAttribute('role', 'presentation')
      menu.appendChild(separator)
    }
    firstGroup = false
    const groupEl = document.createElement('div')
    groupEl.className = names.group
    for (const def of group.items) {
      appendItem(groupEl, def)
    }
    menu.appendChild(groupEl)
  }
  return menu
}

/**
 * 子菜单翻转装配期判定：菜单挂载后对每个子菜单量自然宽度（临时显形），
 * 按内核 submenuSide 判定右/左，左翻加 flip 类（CSS right:100% 承载）。
 * 无布局环境（jsdom：尺寸与坐标全 0）安全跳过。
 */
export function applySubmenuFlip(
  menu: HTMLElement,
  viewportWidth: number,
  classNames?: Partial<MenuDomClassNames>,
): void {
  const names: MenuDomClassNames = { ...CONTEXT_MENU_CLASS_NAMES, ...classNames }
  for (const submenu of Array.from(menu.querySelectorAll<HTMLElement>(`.${names.submenu}`))) {
    const host = submenu.parentElement
    if (!host) {
      continue
    }
    // 子菜单默认 display:none（CSS :hover 显隐）——临时显形量宽后恢复
    submenu.style.display = 'block'
    submenu.style.visibility = 'hidden'
    const width = submenu.offsetWidth
    submenu.style.display = ''
    submenu.style.visibility = ''
    if (width <= 0) {
      continue
    }
    const rect = host.getBoundingClientRect()
    if (rect.left === 0 && rect.top === 0 && rect.width === 0 && rect.height === 0) {
      continue // 无布局环境（jsdom）——真实翻转由浏览器回归钉住
    }
    if (submenuSide({ left: rect.left, right: rect.right }, width, viewportWidth) === 'left') {
      submenu.classList.add(names.submenuFlip)
    }
  }
}
