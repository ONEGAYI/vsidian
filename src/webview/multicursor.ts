// 多光标扩展组（工单 #237）：Live 正文多选区/副光标的装配单一事实源。
//
// 装配内容（随「多光标」设置项经 Compartment 整组进退，默认开启）：
// - EditorState.allowMultipleSelections：多 range 选区存续的前提（此前随
//   #124 symbolWrap 扩展组装配，#237 起解耦为本组——符号包裹开关不再影响
//   多选区可用性；本组关闭时跨段包裹的文本改写仍生效，仅产物选区被
//   asSingle 折回主 range）
// - drawSelection：绘制层接管选区背景与光标（Chromium 原生 DOM 选区单
//   range，不装则副光标不可见）。伴生效应由 main.css 承接：原生选区/光标
//   被 hideNativeSelection 主题隐藏（caret-color transparent !important），
//   绘制光标颜色仍走 baseTheme 明暗变体（light=black / dark=#ddd，与原生
//   caret 时代的 baseTheme 口径同源，不硬编码）；选区背景在 main.css 以
//   VSCode 主题变量落色。表格零宽空格活动格的假光标（::after）与绘制光标
//   重叠的去重亦在 main.css（:has 门控隐藏绘制光标）
// - clickAddsSelectionRange.of(e => e.altKey)：Alt+点击在指针处添加/移除
//   选区（CM6 默认 Ctrl/Cmd——Ctrl+点击已被 Live 链接跳转占用，CONTEXT.md
//   产品边界钉死，恒为 Alt 无切换空间）——facet 挂在 EditorView 静态
//   （EditorView.clickAddsSelectionRange）。Alt 与表格格内拖选（gridCell
//   mouseSelection 的 altKey 让路）、悬停预览（Ctrl+悬停）、链接跳转
//   （liveLinks mouseup 已补 alt 排除）互不竞争
// - 接管 keymap：吞掉 defaultKeymap 内建的 Mod-Alt-ArrowUp/Down（其绑定
//   addCursorAbove/Below）。键位所有权归操作注册表——用户清空/改绑
//   「在上方/下方添加光标」后，路由不匹配时按键落到本 keymap 被吞下，
//   内建绑定不得复活；实际执行经 keybindingRouter 本地分支（注册表当前
//   生效绑定驱动）。本组退出装配（设置关闭）时接管一并撤下，内建绑定
//   恢复其既有行为（无 allowMultipleSelections 时多 range 被 asSingle 折
//   回，等同于光标上/下移一行——即 #237 之前的既有行为）
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, ViewPlugin } from '@codemirror/view'

/** 宿主会转发 webview 的 Alt keyup 并激活菜单；真宿主复现表明夺焦在
 *  释放 Alt 时发生，mouseup 追回焦点过早。只消费已用于点击添光标的
 *  Alt 释放，单独按 Alt 仍交给宿主；不干预 CM6 的 mousedown 选区逻辑。 */
const altClickFocusGuard = ViewPlugin.fromClass(class {
  clickedWithAlt = false
}, {
  eventHandlers: {
    keydown(event: KeyboardEvent) {
      if (event.key === 'Alt' && !event.repeat) this.clickedWithAlt = false
      return false
    },
    mousedown(event: MouseEvent) {
      if (event.altKey && event.button === 0) this.clickedWithAlt = true
      return false
    },
    keyup(event: KeyboardEvent) {
      if (event.key !== 'Alt' || !this.clickedWithAlt) return false
      this.clickedWithAlt = false
      event.preventDefault()
      event.stopPropagation()
      return true
    },
    blur() {
      this.clickedWithAlt = false
      return false
    },
  },
})

export const multicursorExtensions = [
  EditorState.allowMultipleSelections.of(true),
  drawSelection(),
  EditorView.clickAddsSelectionRange.of((event: MouseEvent) => event.altKey),
  altClickFocusGuard,
  keymap.of([
    // 吞键不执行：执行路径唯一（路由本地分支按注册表绑定分发）。返回
    // true 阻止 defaultKeymap 的内建 addCursorAbove/Below 落穿
    { key: 'Mod-Alt-ArrowUp', run: () => true },
    { key: 'Mod-Alt-ArrowDown', run: () => true },
  ]),
]
