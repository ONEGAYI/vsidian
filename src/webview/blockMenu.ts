// 正文右键菜单——复制块链接入口（#162）：命中判定（纯函数，块形态学走
// shared/blockId 与宿主 findBlockOffset 同源）、菜单结构模型、DOM 装配与
// 定位纯函数。控制器装配（contentDOM contextmenu 委托、命令分派到写回
// 管线与剪贴板消息桥）在 syncController；架构照大纲菜单先例（outlineMenu）。
//
// 语义单一事实源（供契约测试 blockMenu.test.ts / blockMenuPanel.test.ts
// 对拍）：
//
// 1. 命中判定（blockMenuTargetAt）：行 → 行所属块（围栏块整块、空行分界）
//    + 命中行自身是否 ATX 标题行（决定「复制标题链接」项）；frontmatter
//    头区（结构合法 `---` 头块，含成型卡片与降级源码行）与空行不接管
//    （返回 null，浏览器原生菜单照常）。
//
// 2. 菜单结构：标题行 = 「复制标题链接」+「复制块链接」；其余块仅
//    「复制块链接」。项一律 button（键盘 Tab/Enter/空格原生可达）；命令 id
//    落 data-vsidian-command（测试钩子与断言锚点）。
//
// 3. 定位（blockMenuPosition）：视口坐标系 fixed 定位——点击点起、右缘/
//    下缘 clamp；底部放不下翻到点击点上方，再放不下 clamp 视口顶。
import type { MessageKey } from '../shared/locales/en'
import { t } from '../shared/i18n'
import { atxHeadingOf, blockRangeOfLine, scanFenceBlocks } from '../shared/blockId'

/** 块菜单命令 id（data-vsidian-command 与宿主测试钩子的稳定值） */
export type BlockMenuCommand = 'copyHeadingLink' | 'copyBlockLink'

/** 块菜单的稳定类名（样式与断言的公共锚点；样式契约 entry: block-menu） */
export const BLOCK_MENU_CLASS_NAMES = {
  /** 菜单容器（挂 document.body，fixed 定位） */
  menu: 'vsidian-block-menu',
  /** 菜单项按钮（键盘可达的激活目标） */
  item: 'vsidian-block-menu-item',
} as const

/** 命中目标：块区间 + 命中行的标题（标题行才有「复制标题链接」） */
export interface BlockMenuTarget {
  /** 行索引闭区间（LF 系，与 CM6 doc 同坐标） */
  block: { start: number; end: number }
  /** 命中行为 ATX 标题行时的标题；标题文本 = 行面字面文本（含行内标记，
   *  与宿主 findHeadingOffset 字面比较及大纲 copyLink 口径同源） */
  heading: { level: number; text: string } | null
}

/**
 * 命中判定（纯函数）：lineIndex 所在行 → 所属块 + 标题信息。
 * @param lines 已剥 \r 的行数组（webview LF 坐标天然满足）
 * @param lineIndex 命中行索引
 * @param fmEndLine frontmatter 头区结束行索引（含）；无头区传 -1
 * @returns 不接管位（头区/空行/越界）返回 null
 */
export function blockMenuTargetAt(
  lines: readonly string[],
  lineIndex: number,
  fmEndLine: number,
): BlockMenuTarget | null {
  if (lineIndex <= fmEndLine) {
    return null // 头区不接管：成型卡片只读；降级源码行写 ^id 只会破坏 YAML
  }
  const block = blockRangeOfLine(lines, lineIndex)
  if (block === null) {
    return null // 空行/越界不属于任何块
  }
  const inFence = scanFenceBlocks(lines).some(
    (fence) => lineIndex >= fence.start && lineIndex <= fence.end,
  )
  const heading = inFence ? null : atxHeadingOf(lines[lineIndex]!)
  return { block, heading }
}

/** 菜单项描述 */
export interface BlockMenuItemDef {
  id: BlockMenuCommand
  labelKey: MessageKey
}

/** 菜单结构（isHeading：命中行是否 ATX 标题行——决定标题链接项） */
export function blockMenuSpec(isHeading: boolean): BlockMenuItemDef[] {
  const items: BlockMenuItemDef[] = [{ id: 'copyBlockLink', labelKey: 'blockMenu.copyLink' }]
  if (isHeading) {
    items.unshift({ id: 'copyHeadingLink', labelKey: 'blockMenu.copyHeadingLink' })
  }
  return items
}

/** 菜单 DOM 装配：容器 role=menu；项为 button（data-vsidian-command 携带
 *  命令 id）。onCommand 接收叶命令 */
export function buildBlockMenu(
  spec: readonly BlockMenuItemDef[],
  onCommand: (id: BlockMenuCommand) => void,
): HTMLElement {
  const menu = document.createElement('div')
  menu.className = BLOCK_MENU_CLASS_NAMES.menu
  menu.setAttribute('role', 'menu')
  for (const def of spec) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = BLOCK_MENU_CLASS_NAMES.item
    btn.dataset['vsidianCommand'] = def.id
    btn.textContent = t(def.labelKey)
    btn.addEventListener('click', () => {
      onCommand(def.id)
    })
    menu.appendChild(btn)
  }
  return menu
}

/** 菜单定位（视口系 fixed left/top）：见模块头 3。click = 点击点，
 *  menu = 菜单尺寸，viewport = 视口尺寸 */
export function blockMenuPosition(
  click: { x: number; y: number },
  menu: { w: number; h: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(0, Math.min(click.x, viewport.width - menu.w))
  let top = click.y
  if (top + menu.h > viewport.height) {
    top = Math.max(0, click.y - menu.h)
  }
  return { left, top }
}
