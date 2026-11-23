// VSCode 编辑器操作族（2026-11-23）：视口按行滚动、上下插入空行、上下移动当前行。
//
// 六个操作全部登记在操作注册表（src/shared/keybindings.ts 的 scrollLineUp /
// scrollLineDown / insertLineAbove / insertLineBelow / moveLineUp /
// moveLineDown）：快捷键经 keybindingRouter 的 document 捕获层本地分支直达，
// 命令面板经 UI_OPERATIONS 注册循环回发 ui.command——两入口在 syncController
// 汇合到本模块同一执行体。
//
// 视口按行滚动（对齐宿主 scrollLineUp / scrollLineDown：Ctrl+Up / Ctrl+Down）：
// 视口每次平移一个行高（view.defaultLineHeight——CM6 实测的普通行高），
// 光标与选区不动；顶部/底部钳制，已在边界或内容不足一屏时零操作。滚动
// 容器恒为 view.scrollDOM（.cm-scroller）——主编辑器全高，嵌入/浮窗内部
// Live 由限高的 cm-scroller 自持滚动（main.css「内部 Live 编辑器容器」约定：
// 容器不滚动）。仅 macOS 的 defaultKeymap 有 Ctrl+方向键翻页绑定，须接管。
//
// 插入空行（对齐宿主 insertLineBefore / insertLineAfter：Ctrl+Shift+Enter /
// Ctrl+Enter）：在光标所在行（选区取活动端所在行）的行尾（下方）或行首
// （上方）断行，新行继承当前行的前导空白，光标落在新行缩进之后；当前行
// 文本不拆分（区别于 Enter 的光标处断行）。与宿主的一处差异：宿主「上方
// 插入」等价于上一行行尾按 Enter（缩进随上一行），本模块统一继承当前行
// 缩进——Markdown 里新空行与光标所在行同层级更符合直觉（评估记录见
// docs/specs/keybindings.md）。
//
// 移动当前行（对齐宿主 editor.action.moveLinesUpAction / DownAction：
// Alt+Up / Alt+Down）：整行上移/下移一行。此前该键位是 CM6 defaultKeymap
// 的裸内建绑定（moveLineUp/moveLineDown），不经注册表故设置页看不见、
// 改不了；本批登记为可配置操作，内建绑定由接管 keymap 退役（键位所有权
// 归注册表）。移动本身仍走 CM6 内建命令——选区跨行块、多选区、行尾换行、
// 首末行边界都由它处理干净，且事务带 userEvent 'move.line'（CM6 自己的
// 结构命令，不在本仓库 `input` 键入路径门控范围内）。
//
// 写回边界：
// - 多光标：插入按结构性操作口径退化主选区（keybindings.md「多光标下格式
//   操作 的键位语义」）——只在主选区所在行插入，其余 range 经 ChangeSet
//   映射原样保留，多光标形态不收敛；移动行走 CM6 moveLine，天然支持多选区
// - 表格内（inTable：格区在场 或 光标所在行有表格行身份）不插入空行：
//   会撕裂网格结构。**只用 tableRegionField 不够**——该字段只有拖选表格
//   区域后才非空，光标停在一行表格文本上时为 null（真宿主验收发现的缺陷）
// - 落点展开：新光标落入已折叠标题节的隐藏区时（光标在已折叠标题行上
//   向下插入）展开该节——复用 headingFold.unfoldAround（定位/查找落点展开
//   的同一条链路，永久展开），新行可见可编辑
// - 插入事务不带 userEvent 注解：本仓库把 `input` 类事务当键入路径——空白行
//   规范化（tableEditing.normalizeBlankRowInput，命中时整行重建并改写
//   选区）与符号补全/包裹 filter 均按 isUserEvent('input') 门控。命令
//   驱动的结构编辑与 callout 插入、格式操作同口径不标注，不进入键入路径
//
// 接管 keymap（registryLineTakeover）：defaultKeymap 内建的 Mod-Enter
// （insertBlankLine）、Alt-ArrowUp/Down（moveLineUp/Down）与注册表默认同键。
// 键位所有权归注册表——路由命中时事件在 document 捕获层被截断，不到 CM6；
// 用户清空/改绑后按键落到 CM6，本 keymap 吞键不执行，内建绑定不得复活
// （多光标扩展组接管 Mod-Alt-ArrowUp/Down 的同款先例）。defaultKeymap 仅
// 主编辑器经 extraExtensions 装配（嵌入/浮窗实例不装），接管随之只对主
// 编辑器生效；装配位置在 liveInstance 实例扩展组，先于 extraExtensions
// 末位的 defaultKeymap（keymap 正序尝试）。
import { EditorSelection, type Extension, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { moveLineDown, moveLineUp } from '@codemirror/commands'
import { unfoldAround } from './headingFold'
import { liveDecorationsField } from './liveDecorations'
import { tableRowsAt } from './tableEditing'
import { tableRegionField } from './tableRegionField'

export type LineInsertSide = 'above' | 'below'

/** 纯插入计划：插入点单一坐标（无替换区间——两方向都是纯插入） */
export interface LineInsertPlan {
  /** 插入点 */
  from: number
  /** 插入文本：换行 + 当前行前导空白 */
  insert: string
  /** 新光标位置（终文坐标） */
  cursor: number
}

/** 插入空行计划（纯函数，LF 坐标）：head 为光标位置（选区取活动端） */
export function planLineInsert(doc: Text, head: number, side: LineInsertSide): LineInsertPlan {
  const line = doc.lineAt(Math.min(Math.max(head, 0), doc.length))
  const indent = /^[ \t]*/.exec(line.text)![0]
  // 下方：行尾追加「换行 + 缩进」，新行在当前行之后；上方：行首插入
  // 「缩进 + 换行」，新行在当前行之前（原行连同自身缩进整体下移）
  if (side === 'below') {
    return { from: line.to, insert: '\n' + indent, cursor: line.to + 1 + indent.length }
  }
  return { from: line.from, insert: indent + '\n', cursor: line.from + indent.length }
}

/**
 * 光标是否位于表格内。两个判据都要：格区在场（拖选态）以及光标所在行
 * 是否有表格行身份（未拖选时 tableRegionField 恒 null——只用它会让
 * 守卫在「光标停在一行表格文本上」时失效，插入把表格切成两半）。
 * 行身份取自解析树（tableRowsAt），源码降级表/残缺表按形态学行组也算。
 */
function inTable(view: EditorView, pos: number): boolean {
  if (view.state.field(tableRegionField, false)) return true
  const tree = view.state.field(liveDecorationsField, false)?.tree
  return tree ? tableRowsAt(view.state, pos, tree) !== null : false
}

/**
 * 在光标所在行的上方/下方插入空行并移动光标到新行。返回是否执行；
 * 只读或光标在表格内时零操作。
 */
export function insertLineAt(view: EditorView, side: LineInsertSide): boolean {
  const state = view.state
  if (state.readOnly) {
    return false
  }
  // 表格内：格区/网格行维持结构语义，插空行会撕裂表格——与 runCursorAdd
  // 同口径静默（格内键入焦点在独立输入框，键盘路径本就不路由到本命令；
  // 光标停在表格行上的命令面板入口在此拦下）。见 inTable 的两判据说明
  if (inTable(view, state.selection.main.head)) {
    return false
  }
  const selection = state.selection
  const main = selection.main
  const plan = planLineInsert(state.doc, main.head, side)
  const changes = state.changes({ from: plan.from, insert: plan.insert })
  // 结构性操作退化主选区：主 range 落新行单光标，其余 range 以原生选区
  // range 经 ChangeSet 映射（与 runFormatOperation 的多选区分支同语义）
  const ranges = selection.ranges.map((range) =>
    range === main ? EditorSelection.cursor(plan.cursor) : range.map(changes))
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, selection.mainIndex),
    scrollIntoView: true,
  })
  // 落点展开：新行落在已折叠标题节的隐藏区内时展开（纯 effect 事务，零
  // 写回），展开后重新显露新光标行
  if (unfoldAround(view, plan.cursor)) {
    view.dispatch({ effects: EditorView.scrollIntoView(plan.cursor) })
  }
  return true
}

/** 行级命令的方向（滚动与移动共用同一域概念：-1 上 / 1 下） */
export type LineDirection = -1 | 1

/**
 * 视口按行滚动的目标 scrollTop（纯函数）：在当前位置上平移 lineStep 并
 * 钳制到 [0, scrollHeight - clientHeight]。返回 null = 无可滚动（内容
 * 不足一屏、已在边界或行高非正）。边界判定留 0.5px 容差——设备像素取整
 * 让 scrollTop 与上限有亚像素漂移时，仍视作已在边界。
 */
export function lineScrollTop(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  lineStep: number,
  direction: LineDirection,
): number | null {
  if (!(lineStep > 0) || metrics.scrollHeight <= metrics.clientHeight) {
    return null
  }
  const max = metrics.scrollHeight - metrics.clientHeight
  const target = Math.min(max, Math.max(0, metrics.scrollTop + direction * lineStep))
  return Math.abs(target - metrics.scrollTop) < 0.5 ? null : target
}

/** 视口上移/下移一个行高，光标与选区不动。返回是否发生滚动。 */
export function scrollByLine(view: EditorView, direction: LineDirection): boolean {
  const scroller = view.scrollDOM
  const target = lineScrollTop(scroller, view.defaultLineHeight, direction)
  if (target === null) {
    return false
  }
  scroller.scrollTop = target
  return true
}

/**
 * 把光标/选区所在行整体上移或下移一行（对齐 VSCode
 * editor.action.moveLinesUpAction / moveLinesDownAction，CM6 的
 * moveLineUp / moveLineDown 是同一语义的实现）。
 *
 * 走 CM6 内建命令而非自己搬运文本：选区跨行块、多选区、行尾换行、首末行
 * 边界（首行不能上移、末行不能下移）都由 selectedLineBlocks/moveLine 处理
 * 干净，且事务带 userEvent 'move.line'——这是 CM6 自己的结构命令，
 * 不属于本仓库 `input` 键入路径门控的范围（symbolAutocomplete /
 * tableEditing 的空行规范化只认 isUserEvent('input')），因此不会误触
 * 键入链。返回 false = 未发生移动（首/末行、只读）。
 */
export function moveLineAt(view: EditorView, direction: LineDirection): boolean {
  const state = view.state
  // **不设表格守卫**：收编前 Alt+↑/↓ 在表格行上一直可用（内建 moveLine
  // 直接移动整行），登记为可配置操作不该改变既有行为——加了守卫反而
  // 是退化。插空行不同：那是新增行为，没有任何既有语义要保护
  if (state.readOnly) {
    return false
  }
  // moveLineUp/Down 首个参数是目标 State（当前态），第二个是 dispatch
  return (direction === -1 ? moveLineUp : moveLineDown)({
    state,
    dispatch: (tr) => view.dispatch(tr),
  })
}

/** 注册表接管 keymap：吞掉 defaultKeymap 内建的 Mod-Enter / Alt-Arrow /
 *  Ctrl-Arrow(mac)（见模块头） */
export const registryLineTakeover: Extension = keymap.of([
  // 吞键不执行：执行路径唯一（路由本地分支按注册表绑定分发）。返回 true
  // 阻止 defaultKeymap 的内建绑定落穿
  { key: 'Mod-Enter', run: () => true },
  // 「上移/下移当前行」由本族接管为可配置操作：内建 moveLineUp/moveLineDown
  // 与注册表默认同键（Alt+方向键）。键位所有权归注册表——用户清空/改绑后
  // 内建绑定不得复活（多光标组吞 Mod-Alt-Arrow 的同款先例）
  { key: 'Alt-ArrowUp', run: () => true },
  { key: 'Alt-ArrowDown', run: () => true },
  // mac 专属：CM6 standardKeymap 把 Ctrl-ArrowUp/Down 绑给 cursorPageUp/
  // cursorPageDown（Windows/Linux 上 Ctrl+方向键无内建绑定）。不清掉的话
  // mac 上清空「滚动一行」绑定后按 Ctrl+↑ 仍会翻页——「清空不复活」的
  // 契约在 mac 上不成立。keymap 按平台取键名（mac 属性优先），此处只在
  // mac 生效，其余平台这两条不参与
  { mac: 'Ctrl-ArrowUp', run: () => true },
  { mac: 'Ctrl-ArrowDown', run: () => true },
])
