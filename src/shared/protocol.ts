// 消息协议单一事实源：宿主（extension host）与 webview 两端共享的消息类型
// 与结构校验。两端不依赖 vscode / DOM，位置一律使用全文 UTF-16 code unit
// offset（与 TextDocument.contentChanges 的 rangeOffset/rangeLength 及
// CodeMirror 的文档定位同构）。
//
// 设计依据：探索笔记 02 §5（协议设计建议）、§6（陷阱清单）。

import type { SettingsPayload } from './settings'
import { isFormatOperationId, type FormatOperationId } from './formatOperations'
import { isKeybindingOperationId, isUiOperationId, type KeybindingOverrides, type UiOperationId } from './keybindings'
import { sanitizeFindOptions, type FindOptions } from './findOptions'
import { isDiagnosticSnapshot, type DiagnosticSnapshot } from './testDiagnostics'

/** 设置快照类型随协议消息透出（载荷单一事实源仍在 shared/settings） */
export type { SettingsPayload }
export type { FindOptions }

/** 一次变更：把全文 [offset, offset+length) 替换为 text（与 contentChanges 同构） */
export interface SerChange {
  offset: number
  length: number
  text: string
}

/** 粘贴阶段只为真实宿主历史提供归属和选区解释，不执行替代撤销。 */
export interface PasteSelection {
  ranges: { anchor: number; head: number }[]
  mainIndex: number
}
export interface PasteStage {
  group: string
  stage: 'text' | 'format' | 'single'
  hasTextStep: boolean
  before: PasteSelection
  after: PasteSelection
}
export type DocumentChangeReason = 'undo' | 'redo'
export interface PasteHistory extends PasteStage { sessionId: string }

/** 表格结构操作（#13）：宿主命令面板命令 → webview 在光标处执行（live 模式） */
export type TableEditOp =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'deleteRow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'deleteColumn'

/** 宿主 → webview 消息 */
export type HostToWebview =
  | { kind: 'paste.preferences.result'; reqId: number; ok: boolean }
  /** ready 后首发：全文 + 当前权威版本 */
  | { kind: 'init'; sessionId: string; docUri: string; version: number; text: string }
  /** 编辑请求已应用（或被拒绝）。
   *  失败语义（#4 起）：conflict = 不可安全应用（重定位失败/版本异常/日志缺口），
   *  宿主已保留该请求的输入并暂停面板写回；error = 写回通道失败（applyEdit）。
   *  两者均附权威全文：webview 无未确认输入时重置装载，有则保留本地输入。 */
  | { kind: 'edit.ack'; seq: number; ok: true; version: number }
  | { kind: 'edit.ack'; seq: number; ok: false; reason: 'conflict' | 'error'; version: number; text?: string }
  /** 权威文档发生变更：变更增量（同指变更前文档） */
  | { kind: 'doc.changed'; version: number; changes: SerChange[]; origin: 'external'; reason?: DocumentChangeReason; paste?: PasteHistory }
  /** 全文重同步（应 sync.request 或宿主主动）：webview 以全文重置本地文档；
   *  对暂停中的面板兼作恢复信号（重置并解除暂停） */
  | { kind: 'doc.resync'; version: number; text: string }
  /** 面板处于暂停写回状态（webview 重载后由 init 后跟随下发，恢复暂停提示） */
  | { kind: 'session.suspended'; version: number; reason: 'conflict' | 'host-error' }
  /** 请求 webview 回报视图诊断（文本与渲染行数，供测试与性能观测） */
  | { kind: 'view.state.request' }
  /** #272 测试钩子门控的观测开关；只记录传播身份，不改变调度。 */
  | { kind: 'diagnostics.test.set'; enabled: boolean }
  /** 性能探针（#5）：webview 测量输入延迟/长任务/滚动回收并回报 perf.report。
   *  探针编辑带 externalSync 注解，不产生写回（测量不污染宿主文档） */
  | { kind: 'perf.probe'; typingRounds: number; scrollRounds: number }
  /** #292 骨架屏测试钩子（VSIDIAN_TEST_HOOKS=1 集成装配专用）：release
   *  解除宿主 HTML 嵌入的撤除冻结并立即撤除。状态观测走 getLastSkeletonReport
   *  轮询（adopt/hold/release 路径均主动回报，无需独立查询消息） */
  | { kind: '_test.skeleton.release' }
  /** 模式切换指令（#6）：live=实时预览，reading=阅读，toggle=翻转当前。
   *  模式是 webview 视图状态：不写 TextDocument、不入撤销栈。#38 起切换
   *  入口迁移宿主标题栏三态命令与命令面板命令（宿主推导显式目标后经
   *  此消息驱动）；'toggle' 保留兼容，新链路不再使用 */
  | { kind: 'view.mode.set'; mode: 'live' | 'reading' | 'toggle' }
  /** 定位请求（#6 起，为 #10 查找/跳转预留的宿主 → webview 入口）：
   *  把光标移动到源 offset 并滚动到可见（live）；reading 模式滚动到
   *  对应锚点块。纯视图操作：不写文档、不产生编辑历史 */
  | { kind: 'view.locate'; offset: number }
  /** 阅读视图性能探针（#7）：reading 模式下对阅读容器往返滚动并回报
   *  挂载/回收/解析次数。要求当前处于 reading 模式，否则回报失败态 */
  | { kind: 'reading.perf'; scrollRounds: number }
  /** 测试钩子（#7）：向包含 srcStart 的挂载块注入无网络图片并延迟改高，
   * 模拟图片加载后的布局变化（动态尺寸变化机制的验证载体） */
  | {
      kind: 'reading.test.image'
      srcStart: number
      initialHeightPx: number
      finalHeightPx: number
      delayMs: number
    }
  /** 测试钩子（#9）：按视图与序号点击真实任务 checkbox，驱动与用户点击
   *  完全相同的处理器链路（校验 → 出站 edit.request）。宿主测试无法向
   *  webview 派发真实鼠标事件，以此通道验证真实宿主内的勾选写回 */
  | { kind: 'task.test.click'; view: 'live' | 'reading'; index: number }
  /** 测试钩子（#81）：按序号点击卡片头部复制按钮（驱动与用户点击相同的
   *  处理器链路：effect → codeblock.copy 出站 → 宿主剪贴板写入） */
  | { kind: 'codecard.test.copy'; index: number }
  /** 测试钩子（#111）：按序号点击图形化代码块的 popup 按钮（驱动与用户
   *  点击相同的处理器链路：打开图表弹窗）。宿主测试无法向 webview 派发
   *  真实鼠标事件，以此通道验证真实宿主内的弹窗打开；action 存在时改为
   *  点击弹窗工具条按钮（export-svg/export-png 驱动导出链路的消息形态
   *  ——宿主测试钩子模式下短路真实另存为对话框；refresh 驱动弹窗原地
   *  重取源码刷新——#133 样式保持验证） */
  | {
      kind: 'graphic.test.popup'
      view: 'live' | 'reading'
      index: number
      action?: 'export-svg' | 'export-png' | 'refresh' | 'close'
    }
  /** 测试钩子（#212）：按序号点击图片 popup 按钮（驱动与用户点击相同的
   *  处理器链路：打开图片弹窗）；action 存在时改为点击弹窗工具条按钮
   *  （export 驱动导出链路的消息形态——宿主测试钩子模式下短路真实另存
   *  为对话框；refresh 驱动弹窗按当前文档重定位重取；close 关闭）。
   *  action 路径不重开弹窗（单例重开会清空快照） */
  | {
      kind: 'image.test.popup'
      view: 'live' | 'reading'
      index: number
      action?: 'export' | 'refresh' | 'close'
    }
  /** 测试钩子（#82）：按序号点击卡片头部折叠 chevron（驱动与用户点击相同
   *  的处理器链路：effect → codeCardFoldField 视图态切换） */
  | { kind: 'codecard.test.fold'; index: number }
  /** 图片解析结果（#10）：reqId 对应 image.request。ok 时 src 为可直接作
   *  img.src 的地址——工作区文件经 asWebviewUri 的 webview 资源 URI
   *  （本地与远程工作区同通道；#201 起拼 ?v=<代次> 缓存击穿参数）；失败
   *  附原因码供错误态与重试呈现（#201 新增 inaccessible：SSH 断连/权限
   *  错误等不可访问，不得冒充 not-found） */
  | { kind: 'image.result'; reqId: number; ok: true; src: string }
  | {
      kind: 'image.result'
      reqId: number
      ok: false
      reason: 'blocked' | 'outside-workspace' | 'not-found' | 'read-error' | 'inaccessible'
      detail?: string
    }
  /** 图片失效通知（#201）：目标文件已观测变更（watcher 事件 / 索引
   *  onTargetChange / 周期核验 refresh 决策）——作废宿主解析缓存后广播到
   *  会话全部面板（多面板一致）。webview 对命中条目撤下旧图、作废重发
   *  image.request（新版本 URL）；旧 reqId 在途结果被代次守卫丢弃 */
  | { kind: 'image.invalidate'; srcs: string[] }
  /** 图片核验唤醒（#201）：窗口焦点回归/远程重连后由宿主广播，webview
   *  有活跃图源时立即触发一轮周期核验（及时核验，不等下一周期） */
  | { kind: 'image.wake' }
  /** 图片粘贴落盘结果（#161）：ok 时 markdown 为宿主计算好的完整插入文本
   *  （![stem](percent-encode 相对路径)，与渲染端 normalizeImgSrc 的 decode
   *  对偶），webview 在光标处单事务插入（一笔撤销）；失败附原因码
   *  （invalid-location=子路径越界/绝对路径；write-failed=建目录或写盘
   *  失败；invalid=载荷校验失败），webview 不插入文本 */
  | { kind: 'image.paste.result'; reqId: number; ok: true; markdown: string }
  | {
      kind: 'image.paste.result'
      reqId: number
      ok: false
      reason: 'invalid-location' | 'write-failed' | 'invalid'
    }
  /** #208 刷新失效通知（refresh.request 的应答，reqId 配对）：webview 收到
   *  后全量失效图片条目并对活跃槽位重新解析（image.request 新 reqId，宿主
   *  缓存已清、新 URI 带 ?v=<generation> 代次戳）+ 重置 Mermaid 懒加载失败
   *  终态。generation 为自增后的资源代次（恒 ≥ 1，观测面——webview 的失效
   *  动作无条件执行，不依赖其值做判定） */
  | { kind: 'refresh.invalidated'; reqId: number; generation: number }
  /** 测试钩子（#161）：登记图片粘贴在途 reqId。集成测试经宿主注入
   *  image.paste（绕过 webview 的 paste 拦截，拦截侧的在途登记不会发生），
   *  以此补登记同 reqId，使结果回包能通过陈旧回包校验、走完插入往返
   *  （与真实粘贴同一在途表同一插入路径） */
  | { kind: 'image.test.pending'; reqId: number }
  /** 查找会话指令（#14；#236 起三开关/替换栏）：open 打开 webview 内浮动
   *  查找面板（可预置查询词，焦点进输入框；replace=true 同时展开替换栏
   *  ——仅 Live；阅读模式整体禁用替换（2026-10）：带 replace 指令不打开
   *  面板静默忽略，替换是 Live 编辑能力；replacement 随
   *  replace 预置替换词——与预置查询词同语义，宿主命令与测试注入共用）；
   *  close 关闭并归还焦点；step 循环定位上一/下一匹配。open/step/close
   *  为纯只读视图操作：不写文档、不产生编辑历史。replace（#236）执行
   *  替换——next 替换当前匹配并移到下一处、all 全部替换，经 webview 的
   *  CM6 事务走标准出站链路（一笔 edit.request = 宿主撤销一次），仅
   *  live 模式执行 */
  | { kind: 'view.find.open'; query?: string; replace?: boolean; replacement?: string }
  | { kind: 'view.find.close' }
  | { kind: 'view.find.step'; direction: 'next' | 'prev' }
  | { kind: 'view.find.replace'; op: 'next' | 'all' }
  /** 表格结构操作（#13）：在面板光标处执行增删行列（仅 live 模式；阅读
   *  模式只读忽略）。变更经 webview 的 CM6 事务走标准出站链路
   *  （edit.request 一笔 = 宿主撤销一次） */
  | { kind: 'table.command'; op: TableEditOp }
  /** 在当前光标/选区建立两列两内容行的空表格，仍走 CM6 文本事务。 */
  | { kind: 'table.create' }
  /** 格式命令在 Live 光标/选区处执行，单个 CM6 事务经宿主写回。 */
  | { kind: 'format.command'; op: FormatOperationId }
  /** #162 复制块链接命令（快捷键/命令面板入口）：面板在 Live 光标所在块
   *  执行与右键菜单同款的复制（标题行=复制标题链接；无块 id 先自动补写
   *  ——一笔标准编辑事务，可撤销）。阅读模式只读忽略 */
  | { kind: 'blockLink.copy' }
  | { kind: 'ui.command'; op: UiOperationId }
  /** 测试钩子（#13）：向真实编辑器派发 Tab/Shift+Tab keydown（与用户按键
   *  同一 keymap 链路；纯选区导航，零写回）。宿主测试无法向 webview 派发
   *  真实键盘事件，以此通道验证导航装配 */
  | { kind: 'table.test.key'; key: 'tab' | 'shift-tab' | 'select-all' | 'backspace' | 'delete' | 'enter' }
  /** 测试钩子：模拟 Live 纯光标移动和纯滚动；空载荷仅启用绘制探针。 */
  | { kind: 'viewport.test.position'; cursorLine?: number; scrollNearLine?: number; scrollBiasPx?: number }
  /** 测试钩子（#42）：在真实 webview 网格单元格派发鼠标点击及当前位置输入。 */
  | { kind: 'table.test.cellClick'; rowIndex: number; columnIndex: number; point?: 'edge' | 'middle' | 'right-edge' }
  | { kind: 'table.test.crossSelect'; anchor: number; head: number }
  | { kind: 'table.test.type'; text: string }
  | { kind: 'table.test.domType'; text: string }
  /** 测试钩子（#148）：直调撤销/重做转发入口 requestHistory（keymap 绑定
   *  由单元测试钉住）。不派发 keydown——真宿主内 webview 会把按键事件
   *  转发给宿主键绑定服务，合成 Ctrl+Z 会额外触发一次全局 undo，与转发
   *  意图叠加成双撤销 */
  | { kind: 'table.test.history'; op: 'undo' | 'redo' }
  /** 测试钩子（#148）：派发合成 IME 组合序列（compositionstart → 组合事务
   *  → compositionend），组合净输入经 deferredLocal 暂缓出站——驱动真实
   *  webview 的组合竞态窗口（宿主测试无法驱动真实 IME） */
  | { kind: 'table.test.compose'; from: number; text: string }
  /** 测试钩子（#43）：点击真实行/列抓手，验证选中态实际绘制。 */
  | { kind: 'table.test.select'; axis: 'row' | 'column'; index: number }
  /** 测试钩子（#43）：真实 webview DOM 的点阵抓手拖动事件。 */
  | { kind: 'table.test.drag'; sourceIndex: number; targetSlot: number }
  /** 测试钩子（#53）：点击主编辑区顶栏的侧栏切换按钮，驱动与用户点击同一
   *  处理器（纯视图状态翻转，零写回）。宿主测试无法向 webview 派发真实鼠标
   *  事件，以此通道验证真实宿主内的布局切换与绘制 */
  | { kind: 'sidebar.test.click' }
  /** 测试钩子：向真实拖宽句柄派发 pointer 事件序列（pointerdown → 超阈值
   *  move 进入拖拽态 → 左移 delta px 的 move → pointerup 落定），驱动与
   *  用户拖拽同一处理器链。delta 为水平位移（正=向左=增宽，负=向右=收窄，
   *  均受钳制）。宿主测试无法向 webview 派发真实鼠标事件，以此通道验证
   *  真实宿主内的拖宽链路 */
  | { kind: 'sidebar.test.resize'; delta: number }
  /** #89 测试钩子：点击真实快速操作控件，走用户同一路径。 */
  | { kind: 'quick.test.click'; action: 'toggle' | 'heading' | 'bold' | 'heading1' | 'headingNone' }
  /** 测试钩子（#54）：点击侧栏顶栏的大纲按钮，驱动与用户点击同一处理器
   *  （纯视图状态翻转，零写回）。与 sidebar.test.click 同通道形态 */
  | { kind: 'outline.test.click' }
  /** 测试钩子（#66）：点击第 index 个真实大纲条目，驱动与用户点击同一
   *  委托处理器（纯视图跳转：live 落光标居中 / reading 滚动到块，零写回） */
  | { kind: 'outline.test.itemClick'; index: number }
  /** 测试钩子（#67）：点击第 level 档（0–5）的真实滑块圆点，驱动与用户
   *  点击同一处理器（档位整体替换展开集，纯视图状态零写回） */
  | { kind: 'outline.test.expandClick'; level: number }
  /** 测试钩子（#67）：点击第 index 个真实条目的折叠箭头，驱动与用户点击
   *  同一委托处理器（单条折叠/展开，不触发跳转） */
  | { kind: 'outline.test.chevronClick'; index: number }
  /** 测试钩子（#68）：向真实搜索输入框设值并派发 input 事件，驱动与用户
   *  输入同一处理器（搜索过滤与片段高亮即时重算，纯视图零写回） */
  | { kind: 'outline.test.searchInput'; text: string }
  /** 测试钩子（#68）：点击工具条真实按钮（跳转到末尾 / 重置），驱动与
   *  用户点击同一处理器（纯视图滚动 / 三合一重置，零写回） */
  | { kind: 'outline.test.toolbarClick'; action: 'jump-bottom' | 'reset' }
  /** 测试钩子（#69）：对第 index 个真实条目派发 contextmenu（与用户右键
   *  同一面板委托处理器，弹出右键菜单）；宿主测试无法向 webview 派发真实
   *  鼠标事件，以此通道验证真实宿主内的菜单装配 */
  | { kind: 'outline.test.contextMenu'; index: number }
  /** 测试钩子（#69）：点击菜单中 command 对应的真实按钮（与用户点击同一
   *  处理器；command 取 outlineMenu 的 OutlineMenuCommand） */
  | { kind: 'outline.test.menuClick'; command: string }
  /** 测试钩子（#69）：关闭当前右键菜单（等价 Esc/外点关闭路径） */
  | { kind: 'outline.test.menuClose' }
  /** 测试钩子（#14/#236）：点击查找面板三开关（Aa/ab/.*）中 key 对应的
   *  真实按钮，驱动与用户点击同一处理器（本地翻转 + 重算 + findOptions.set
   *  上送宿主持久化，snapshot 广播回流）；宿主测试无法向 webview 派发真实
   *  鼠标事件，以此通道驱动真实宿主内的选项链路 */
  | { kind: 'find.test.toggle'; key: 'matchCase' | 'wholeWord' | 'regexp' }
  /** 剪贴板读结果（#183）：ok 时 text 为 LF 归一后的剪贴板文本；失败附
   *  原因码（read-failed = 环境读失败）。陈旧回包由 webview 按 reqId
   *  丢弃（在途表先例见 image.paste） */
  | { kind: 'clipboard.read.result'; reqId: number; ok: true; text: string }
  | { kind: 'clipboard.read.result'; reqId: number; ok: false; reason: 'read-failed' }
  /** 测试钩子（#183 统一右键菜单）：在正文 doc 偏移 pos 处打开统一右键
   *  菜单（与用户右键同一命中判定与装配链路——posAtCoords 的替代注入点；
   *  frontmatter 头区等不接管位同样不开菜单；空行与表格/围栏/图形块均
   *  接管）。宿主测试无法向 webview 派发真实鼠标事件，以此通道验证真实
   *  宿主内的菜单装配 */
  | { kind: 'contextMenu.test.contextMenu'; pos: number }
  /** 测试钩子（#183）：点击菜单中 command 对应的真实按钮（与用户点击同一
   *  处理器；command 取菜单项描述符的 command——含运行期注册项，通道为
   *  非空字符串校验） */
  | { kind: 'contextMenu.test.menuClick'; command: string }
  /** 测试钩子（#183）：关闭当前统一右键菜单（等价 Esc/外点关闭路径） */
  | { kind: 'contextMenu.test.menuClose' }
  /** 测试钩子（#69）：向重命名输入框注入文本并以 Enter/Esc 收尾（真实
   *  keydown 链路；须先经 menuClick command='rename' 进入重命名态） */
  | { kind: 'outline.test.renameKey'; text: string; key: 'enter' | 'escape' }
  /** 测试钩子（#70）：向真实大纲条目派发 pointer 事件序列（pointerdown →
   *  超阈值 pointermove 进入拖拽态 → pointermove 到目标条目的三态落点区
   *  域），驱动与用户拖拽同一处理器链。action=hover 停在悬停态（供 probe
   *  观测拖拽态与落点指示），drop 以 pointerup 收尾执行写回，escape 悬停
   *  后按 Esc 取消（零写回）。宿主测试无法向 webview 派发真实鼠标事件，
   *  以此通道验证真实宿主内的拖拽链路 */
  | {
      kind: 'outline.test.drag'
      from: number
      to: number
      position: 'before' | 'after' | 'inside'
      action: 'hover' | 'drop' | 'escape'
    }
  /** 测试钩子（#140 Popover 改版）：驱动 frontmatter 修改按钮与 Popover
   *  控件（与用户点击同一处理器；变更走标准 CM6 事务出站）。action/index
   *  定位（DOM 文档序）：edit-button = 标题栏「修改」按钮（开关浮层）；
   *  popover-close = 关闭浮层（与 Esc 同一关闭函数）；popover-add-entry =
   *  浮层「添加属性」；popover-add-item = 第 index 个条目的「添加列表项」；
   *  popover-remove-entry = 第 index 个条目的删行按钮；popover-remove-item =
   *  第 index 个删项按钮（跨条目按项行文档序累计）；fold-button = 标题栏
   *  折叠 chevron（2026-10 折叠批次，零写回视图态切换）；fold-hotspot =
   *  标题栏热区（标题文字节点，与整卡头部热区同一处理器） */
  | {
      kind: 'fm.test.click'
      action: 'edit-button' | 'popover-close' | 'popover-add-entry' | 'popover-add-item'
        | 'popover-remove-entry' | 'popover-remove-item'
        | 'fold-button' | 'fold-hotspot'
      index?: number
    }
  /** 测试钩子（#141）：点击顶栏双态视图切换真实按钮（与用户点击同一处理器：
   *  出站 view.switch.request，切换由宿主 runViewSwitch 编排回流驱动）。 */
  | { kind: 'view.test.click' }
  /** 测试钩子（#197）：点击侧栏顶栏的反链按钮（与用户点击同一处理器；纯
   *  视图状态翻转 + 面板互斥切换，零写回） */
  | { kind: 'backlinks.test.click' }
  /** 测试钩子（#197）：点击第 index 个真实反链条目（与用户点击同一委托
   *  处理器；出站 backlink.activate 跳转意图，由宿主打开来源文档并定位） */
  | { kind: 'backlinks.test.itemClick'; index: number }
  /** 测试钩子（形态改版批次）：点击工具栏四按钮之一（与用户点击同一委托
   *  处理器；action 与按钮 data-action 一一对应） */
  | { kind: 'backlinks.test.toolbarClick'; action: 'sort' | 'search' | 'collapse' | 'context' }
  /** 测试钩子（形态改版批次）：设置搜索词（真实 input 事件链——值写入 +
   *  input 事件派发，与用户键入同一处理器） */
  | { kind: 'backlinks.test.searchInput'; value: string }
  /** 测试钩子（形态改版批次）：选择排序项（与用户路径同链：开菜单 → 点
   *  对应菜单项；mode 合法性经协议守卫） */
  | { kind: 'backlinks.test.sortSelect'; mode: 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc' | 'birth-desc' | 'birth-asc' }
  /** 测试钩子（出链面板批次）：点击侧栏顶栏的出链按钮（与用户点击同一
   *  处理器；纯视图状态翻转 + 三面板互斥切换，零写回） */
  | { kind: 'outlinks.test.click' }
  /** 测试钩子（出链面板批次）：点击第 index 个真实出链条目（与用户点击
   *  同一委托处理器；出站 outlink.activate 跳转意图，断链条目不可点） */
  | { kind: 'outlinks.test.itemClick'; index: number }
  /** 测试钩子（#208）：点击顶栏刷新嵌入资源真实按钮（与用户点击同一
   *  处理器：出站 refresh.request，失效重挂由宿主 refresh.invalidated
   *  回流驱动）。 */
  | { kind: 'refresh.test.click' }
  /** 测试钩子（#218）：对阅读视图第 index 个真实双链派发悬停进入/离开
   * （mouseover/mmouseout 经容器委托——与用户悬停同一处理器链路；宿主
   * 测试无法向 webview 派发真实鼠标事件，以此通道验证真实宿主内的
   * 悬停读取与浮层开闭）。#219 起 link='md' 对第 index 个普通 Markdown
   * 链接（非双链 `<a>`）派发——缺省仍为双链；#221 起 link 枚举扩展
   * Live 与面板入口：'live-wikilink' / 'live-md' 对 Live 正文第 index
   * 个双链/普通链接装饰派发（ctrlKey 模拟 Ctrl+悬停修饰位，缺省不带
   * = 直接悬停口径），'backlink' / 'outlink' 对面板第 index 个条目
   * 派发（面板直接悬停，无修饰语义）。action='modkey' 对 document 派发
   * 真实 keydown Control（先 enter 后 modkey 走「悬停后再按 Ctrl」的
   * 补触发路径；index/link 忽略） */
  | {
      kind: 'hover.test.pointer'
      action: 'enter' | 'leave' | 'modkey'
      index: number
      link?: 'wikilink' | 'md' | 'live-wikilink' | 'live-md' | 'backlink' | 'outlink'
      /** Live 入口的 Ctrl 修饰位（派发 mouseover 时透传；仅 live-* 有意义） */
      ctrlKey?: boolean
    }
  /** 测试钩子（#21）：在真实 webview 的 CM6 中输入，验证暂停态即时留存。 */
  | { kind: 'sync.test.edit'; offset: number; text: string; closeAfter?: boolean }
  /** 测试钩子：组合候选写入首行 DOM，经过 CM6 MutationObserver 的真实输入链。 */
  | { kind: 'sync.test.composition'; phase: 'start' | 'update' | 'end'; text: string }
  /** 测试钩子：真实 webview DOM 的渲染链接 mousedown。 */
  | { kind: 'link.test.mousedown'; target: 'wikilink' | 'link'; index: number; ctrlKey?: boolean }
  /** 设置快照（#33）：当前生效设置的全量键值对。两个消费方向——设置页
   *  ready 后请求-响应回填（settings.get）；编辑器面板 init 后主动拉取。
   *  values 整体下发而非逐项布尔：#34 起新增设置项不需要改协议形态 */
  /** 图表导出结果（#111）：ok=false 时 reason 区分用户取消（cancelled）、
   *  载荷校验失败（invalid）与写盘失败（writeFailed） */
  | { kind: 'diagram.export.result'; reqId: number; ok: boolean; reason?: 'cancelled' | 'invalid' | 'writeFailed' }
  /** 图片导出结果（#212）：ok=false 时 reason 区分用户取消（cancelled）、
   *  载荷校验失败（invalid）、目标图不可寻址（not-found）、读字节失败
   *  （read-failed）与写盘失败（writeFailed）；失败通知由宿主呈现 */
  | {
      kind: 'image.export.result'
      reqId: number
      ok: boolean
      reason?: 'cancelled' | 'invalid' | 'not-found' | 'read-failed' | 'writeFailed'
    }
  | { kind: 'settings.snapshot'; values: SettingsPayload }
  /**
   * #132 样式参考：打开设置页后定位到指定附加分页（section id）。
   * 面板未加载完成时由宿主在 ready 握手后补发；未知分页 id 时 webview 忽略。
   * entry（#231 外观合并，可选）：分页内进一步定位的条目 id——外观分页按
   * 条目归属路由到页内页签（片段目录/文件 → CSS 片段；overview → 样式参考；
   * 契约条目 → 详细查询）。缺省时目标分页按自身默认形态呈现（向后兼容）。
   * scroll（可选，会话内恢复）：定位后应用的主区滚动位置——面板关闭/隐藏
   * 重载后按宿主记忆的 UI 态恢复分页与滚动；缺省 = 顶部（既有定位语义），
   * 与 entry 不同时使用（恢复消息只带 scroll）
   */
  | { kind: 'settings.focusSection'; section: string; entry?: string; scroll?: number }
  /** 设置变更通知（#33）：任一设置项保存成功后广播到全部已打开 Vsidian
   *  编辑器面板与设置页（含变更发起页面）。values 仍为全量快照；消费方按
   *  需读取关心的键（#34 场景：editor.lineNumbers 触发 CM6 扩展热重配） */
  | { kind: 'settings.changed'; values: SettingsPayload }
  /** 查找选项快照（#236，请求-响应与推送共用形态）：三开关完整对象
   *  （matchCase/wholeWord/regexp）。findOptions.get 的应答与 set 保存后的
   *  广播共用；编辑器面板据此装配查找面板开关态与引擎匹配语义（#238
   *  「选下一处相同词」同源消费） */
  | { kind: 'findOptions.snapshot'; options: FindOptions }
  /** 语言包切换（#93 i18n）：携带新语言代码与完整新语言包，host→webview。
   *  语言变化不走 settings.changed 附带（语言包体积大，随每次设置变更附带
   *  是浪费）；宿主检测到 general.language 变化时发送。webview 收到后原子
   *  换包（shared/i18n.installLocale）、重渲染常驻文本节点并同步
   *  <html lang>；按需创建的控件自然取新词 */
  | { kind: 'locale.changed'; lang: string; messages: Record<string, string> }
  | { kind: 'keybindings.snapshot' | 'keybindings.changed'; overrides: KeybindingOverrides; requestId?: number; ok?: boolean; reason?: 'invalid' | 'conflict' | 'storage'; conflicts?: string[] }
  /** CSS 片段装载清单（#128/#129，编辑器面板消费）：宿主权威扫描 × 开关
   *  映射 × 依赖分析（越界条目排除）→ 启用片段的 webview 资源 URI（含
   *  ?v=版本 缓存击穿参数），按确定性文件名顺序排列（后者覆盖）。编辑器
   *  面板 init 后经 snippets.get 拉取，状态变更后由宿主广播；空清单即撤下
   *  全部已装片段。
   *  v（#129）：入口级缓存击穿版本——入口自身或其 @import 依赖闭包变更时
   *  推进该入口（装载回报的关联键）；缺省回退列表版本（仅列表级语义） */
  | {
      kind: 'snippets.snapshot'
      version: number
      snippets: Array<{ name: string; uri: string; v?: number }>
    }
  /** CSS 片段管理状态（#128/#129/#131，设置页消费）：目录、读取失败标志、
   *  全局暂停标志（#131，设置页回显暂停状态条）、全部第一层条目（含未启
   *  用）与版本。设置页经 snippets.get 拉取；宿主状态变更后推送（含编辑
   *  器侧片段变更）。不携带 URI——设置页不加载用户 CSS。rejections（#129）：
   *  被拒启用条目（越界/符号链接逃逸，清单装配排除），设置页行内提示；
   *  缺省视为无拒绝 */
  | {
      kind: 'snippets.state'
      directory: string | null
      readError: boolean
      paused: boolean
      version: number
      entries: Array<{ name: string; enabled: boolean }>
      rejections?: Record<string, { reason: 'path-escape' | 'symlink-escape'; path: string }>
    }
  /** 反链快照（#197，请求-响应与推送共用形态）：面板经 backlinks.get 拉取，
   *  宿主索引变更（覆盖层更新/重扫/重建完成）后按面板文档广播。state 四态：
   *  loading（索引未就绪/首扫中）、ready（items 为反链列表，空列表=无引用；
   *  updating=true 表示索引重建中当前为旧数据）、error（读取失败，含索引
   *  不可用；reason 区分无工作区）。items 按来源路径/位置稳定排序（宿主
   *  queryBacklinks 序）；offset 为来源正文的 LF 偏移（跳转定位用）。
   *  seq（review-loops #16）：宿主按文档单调递增的广播序号——快照应答为
   *  异步 fire-and-forget，乱序到达时 webview 丢弃降序帧；缺省不丢弃
   *  （兼容无序号的发送方） */
  | {
      kind: 'backlinks.snapshot'
      docUri: string
      state: 'loading' | 'ready' | 'error'
      updating?: boolean
      reason?: 'no-workspace' | 'read-error'
      items?: BacklinkItemPayload[]
      seq?: number
    }
  /** 出链快照（出链面板批次，请求-响应与推送共用形态；语义与
   *  backlinks.snapshot 镜像）：面板经 outlinks.get 拉取，宿主索引变更后
   *  与 backlinks 同点广播。items 为当前文档的出链（含覆盖层未保存态，
   *  外部 scheme 边不进面板），按 resolved → 目标 → 区间稳定排序；seq
   *  为宿主按文档单调递增的广播序号（乱序到达时 webview 丢弃降序帧） */
  | {
      kind: 'outlinks.snapshot'
      docUri: string
      state: 'loading' | 'ready' | 'error'
      updating?: boolean
      reason?: 'no-workspace' | 'read-error'
      items?: OutlinkItemPayload[]
      seq?: number
    }
  /** 悬停文档预览结果（#218，hover.request 的应答，reqId+instanceId 双配对）：
   *  成功携带规范目标身份（fsPath + 所属根内相对路径）、目标版本
   *  （TextDocument.version，#224 变更刷新的版本基准）、LF UTF-16 全文与
   *  源范围、语义范围选择器（#219 起 full 全文 / heading 章节 / block 块；
   *  全文随范围一起返回是「保留全文解析上下文再选取范围」的载荷形态，
   *  webview 切范围在切块后按块区间过滤，不孤立解析截取字符串）。失败附
   *  原因码（错误分态见 HoverPreviewFailReason；anchor-missing 附锚点原文）
   *  ——webview 就地 i18n 呈现，不弹宿主通知。只读消息：宿主不写任何文档 */
  | {
      kind: 'hover.result'
      reqId: number
      instanceId: string
      ok: true
      target: HoverPreviewTargetIdentity
      version: number
      text: string
      range: { start: number; end: number }
      scope: HoverPreviewScope
      /** #244 Host-authenticated expansion ancestry, including root A. */
      expansionPath?: string[]
      depth?: number
      /** #242 每次成功送达的来源租约；不能作为共享内容缓存身份。 */
      sourceLeaseId?: string
    }
  | {
      kind: 'hover.result'
      reqId: number
      instanceId: string
      ok: false
      reason: HoverPreviewFailReason
      /** anchor-missing 时的锚点原文（块 id 带 ^ 前缀），供就地提示 */
      anchor?: string
    }
  /** 悬停目标失效推送（#224 引用视图同步）：宿主观测到被订阅目标（hover.watch
   *  登记）的内容或磁盘状态变化后，向订阅该目标的全部面板推送——webview
   *  据此对在场浮层/嵌入卡片撤旧重载（changed）、撤下内容显示缺失态
   *  （deleted，不无限保留旧内容）或呈现读取失败（stale：权限/断连，不等同
   *  删除）。status 三态与 vaultIndex onTargetChange 同口径；generation 为
   *  同一目标的失效代次（单调递增，首观测为 1）。P3-1（review 修订）：当前
   *  单面板消息通道为 FIFO 保序，webview **不消费 generation 做乱序丢弃**
   *  ——代次仅作观测与单调性事实保留（跨通道/多宿主场景若引入再启用）。
   *  未保存修改经短暂合并（防抖窗）后以 changed 推送；deleted/stale 直通。
   *  只读推送：不携带正文（webview 重发 hover.request 读取），宿主不写文档 */
  | {
      kind: 'hover.invalidated'
      fsPath: string
      status: 'changed' | 'deleted' | 'stale'
      generation: number
    }
  | { kind: 'hover.watch.rejected'; fsPath: string; instanceId: string; reason: 'capacity' | 'source'; sourceLeaseId?: string }
  /** #299 跳转目标提示解析结果（hover.target.resolve 的应答，reqId 配对）：
   *  成功携带所属根内相对路径（`/` 分隔、含扩展名）与源码形态锚点
   *  （`#标题` / `#^块id`；无锚点缺省）；webview 侧拼接 `relPath + anchor`
   *  作为提示内容。失败仅 ok:false（无原因码——提示失败即静默不出，
   *  不需要就地错误文案）。只读消息 */
  | { kind: 'hover.target.resolved'; reqId: number; ok: true; relPath: string; anchor?: string }
  | { kind: 'hover.target.resolved'; reqId: number; ok: false }
  /** 索引维护状态（#198，设置页消费）：排除模式（当前生效 + 默认值）、
   *  维护操作状态与进度、最近一次操作结果反馈。设置页经 index.get 拉取；
   *  宿主状态变更（模式保存/进度推进/操作完成）后推送。available=false
   *  表示当前窗口无工作区（索引服务未建——操作按钮禁用，模式仍可编辑
   *  持久化，打开工作区后生效）。notice 保留至下一次操作覆盖（页面不
   *  自行清除）；detail 为补充信息（如被拒的非法模式列表） */
  | {
      kind: 'index.state'
      available: boolean
      patterns: string[]
      defaults: string[]
      status: 'idle' | 'cleaning' | 'rebuilding'
      progress: { done: number; total: number } | null
      roots: number
      notice: {
        kind: 'patterns-saved' | 'patterns-invalid' | 'rebuild-done' | 'rebuild-cancelled'
          | 'rebuild-failed' | 'cleanup-done' | 'cleanup-failed'
        detail?: string
      } | null
    }
  /** #239 分词资源状态（jieba-wasm 按需下载，宿主权威）：设置页「中文
   *  分词」分页与编辑器面板消费。installed = 锁定版本资源在场且 sha256
   *  校验通过；resources 仅在 installed 时携带（globalStorage 文件经
   *  asWebviewUri 的 webview 资源 URI，编辑器侧按需动态 import 加载，
   *  逐面板 URI 前缀私有故不缓存在宿主）。status:downloading 期间按钮
   *  禁用；notice 保留至下一次操作覆盖（页面不自行清除）。 */
  | {
      kind: 'wordSegment.state'
      installed: boolean
      version: string
      status: 'idle' | 'downloading'
      notice: {
        kind: 'downloaded' | 'download-failed' | 'deleted' | 'delete-failed' | 'load-failed'
        detail?: string
      } | null
      resources: { js: string; wasm: string } | null
    }

/** webview → 宿主消息 */
export type WebviewToHost =
  | { kind: 'paste.preferences.set'; reqId: number; preserveFormatting: boolean }
  /** webview 脚本加载完成，请求 init。
   *  已知限制（C-8）：ready 与 init 之间的毫秒级窗口内到达的 doc.changed
   *  会被未 ready 面板丢弃——装载以 init 全文为准，内容不丢；仅当窗口内
   *  版本推进且 init 竞态落后时理论可见，宿主按事件序串行发送可缓解 */
  | { kind: 'ready' }
  | { kind: 'keybindings.get' }
  | { kind: 'keybindings.set'; id: string; bindings: string[]; replaceConflicts: boolean; requestId: number }
  | { kind: 'keybindings.reset'; id: string; replaceConflicts: boolean; requestId: number }
  | { kind: 'keybindings.resetAll'; requestId: number }
  | { kind: 'keybindings.execute'; id: string }
  /** #141 工具栏双态切换按钮：请求宿主切换到目标模式（live↔reading，
   *  宿主复用 runViewSwitch 的编排与模式记忆；源码路径不经本消息——
   *  右上角三态命令是源码唯一入口）。target=另一态由 webview 按当前
   *  viewMode 求值，宿主不再推导（多面板场景活动面板与本面板一致时
   *  按钮才可点，显式目标消除歧义） */
  | { kind: 'view.switch.request'; target: 'live' | 'reading' }
  /** 编辑请求：seq 会话内单调递增；baseVersion 为发送方自认的权威版本 */
  | {
      kind: 'edit.request'
      sessionId: string
      docUri: string
      seq: number
      baseVersion: number
      changes: SerChange[]
      paste?: PasteStage
    }
  /** 撤销/重做请求：作用于宿主 TextDocument 权威历史（探索笔记 03 §4） */
  | { kind: 'history.request'; op: 'undo' | 'redo' }
  /** 请求宿主回发全文重同步（外部变更与本地状态无法安全对齐时） */
  | { kind: 'sync.request' }
  /** 冲突/暂停时的本地全文快照上报：宿主保存供用户取回未确认输入 */
  | { kind: 'conflict.report'; sessionId: string; docUri: string; version: number; revision: number; text: string;
      /** 仅空白表格格 IME 暂缓：快照仍含未提交候选文本；结束时显式清除。 */
      compositionPending?: boolean }
  /** 空白格组合候选的 LF 增量：首笔 conflict.report 已提供全文基线。 */
  | { kind: 'composition.changed'; sessionId: string; docUri: string; revision: number; changes: SerChange[] }
  /** 测试钩子（#21）：编辑事务结束后立即关闭面板，检验快照与关闭竞争。 */
  | { kind: 'sync.test.close'; sessionId: string; docUri: string }
  /** 暂停横幅按钮动作：copy = 请求宿主复制未确认输入；resume = 请求恢复（重新同步） */
  | { kind: 'conflict.action'; sessionId: string; docUri: string; action: 'copy' | 'resume' }
  /** view.locate 送达确认（#163 验收反馈）：webview 应用定位后原样回发
   *  消息 offset——宿主只补发「从未送达」的定位意图（面板重载竞态兜底），
   *  已送达的定位交给 webview 持久化锚点恢复，历史程序定位不再重播 */
  | { kind: 'view.locate.ack'; offset: number }
  /** 视图诊断回报 */
  | {
      kind: 'view.state'
      diagnostics?: DiagnosticSnapshot
      text: string
      docLength: number
      lineCount: number
      renderedLines: number
      /** 面板是否处于暂停写回状态（#4；可选字段向后兼容） */
      suspended?: boolean
      /** .cm-content 内全部元素数（#5 视口渲染 DOM 有界性观测） */
      contentDomCount?: number
      /** DOM 中标题行数（直接装饰渲染结果） */
      headingLineCount?: number
      /** 第一个源码态（活动）标题行的 DOM 文本 */
      headingActiveText?: string
      /** 第一个隐藏标记态（非活动）标题行的 DOM 文本 */
      headingHiddenText?: string
      /** 当前视图首个一级标题的实际字号（px；真实宿主样式回归观测） */
      headingFontPx?: number
      /** 当前视图模式（#6；缺省 live，向后兼容） */
      viewMode?: 'live' | 'reading'
      /** live 光标主位置（UTF-16 offset；#6 锚点恢复观测） */
      selectionOffset?: number
      selectionHead?: number
      selectionAssoc?: number
      /** Live 绘制视口中心对应的源码行号（真布局时可用）。 */
      liveViewportCenterLine?: number
      /** Live 实际滚动像素；与中心源码行对拍，暴露重排后像素坐标失真。 */
      liveScrollTopPx?: number
      /** webview 实际运行时能否使用词级分段器（#88）。 */
      wordSegmenter?: boolean
      /** webview 实际运行时 CSP 是否放行 WebAssembly 编译（#241 评审修复：
       *  8 字节空模块同步编译探针——jieba wasm 实例化的 CSP 前置条件，
       *  在真实宿主 webview 内验证，词法断言之外的行为级证据） */
      wasmCompile?: boolean
      /** webview 实际生效的词级分词引擎（#239 端到端观测）：engine=jieba
       *  且 globalStorage 资源在 webview 内动态装载成功后为 'jieba'；未装
       *  /装载中/装载失败回退时恒 'builtin'——真宿主 webview 资源服务
       *  （localResourceRoots 许可面）覆盖 globalStorage 的回归断言证据 */
      jiebaEngine?: 'builtin' | 'jieba'
      /** 阅读容器内块元素数（#6；#7 起为挂载块数，屏外块不创建） */
      readingBlockCount?: number
      /** 当前阅读锚点块的源 start（源码位置锚点，非滚动百分比） */
      readingAnchorStart?: number
      /** 阅读块模型总数（#7：全文切块结果，与挂载无关） */
      readingTotalBlocks?: number
      /** 阅读挂载块数（#7：当前窗口内真实创建的块） */
      readingMountedBlocks?: number
      /** 阅读容器内全部元素数（#7 DOM 有界性观测，含 spacer） */
      readingContentDomCount?: number
      /** 阅读全文解析累计次数（#7：滚动不得使其增长） */
      readingParseCount?: number
      /** 阅读视图是否虚拟化（#7：false 为无布局回退全量渲染） */
      readingVirtualized?: boolean
      /** 锚点块元素顶部位置（#7：px；锚点块未挂载时为估计位置） */
      readingAnchorTopPx?: number
      /** 阅读容器滚动位置与内容总高（#7：px） */
      readingScrollTopPx?: number
      readingScrollHeightPx?: number
      /** 阅读容器内查找命中块元素数（#241 验收回归观测：块级命中高亮的
       *  绘制层证据——状态级 total 不保证 DOM 类落地；仅 reading 模式上报，
       *  旧 webview 缺省） */
      readingFindHitBlocks?: number
      /** 稳定样式契约探针（#6 内部测试 CSS 验证入口）：目标元素不存在时字段为 null */
      cssProbe?: CssProbeReport
      /** live 侧语法装饰统计（#8 双视图语义一致性观测；装饰集合级计数，非 DOM） */
      liveSyntax?: LiveSyntaxProbe
      /** #42：网格 DOM 与活动格、#43 抓手的真实宿主观测 */
      tableGrid?: { visibleRows: number; selectedRowIsGrid: boolean; selectedRowCells: string[]; rowHandles: number }
      /** reading 侧渲染语义统计（#8 双视图语义一致性观测；小文档全量挂载时有效） */
      readingSyntax?: ReadingSyntaxProbe
      /** live 视口内链接 span 数（#10；间接装饰渲染结果，限于视口） */
      liveLinkCount?: number
      /** live 视口内图片 widget 数（#10） */
      liveImageCount?: number
      /** live 视口内双链数（#11；范围外 widget 与范围内 mark 共用类名） */
      liveWikilinkCount?: number
      /** #59：live 视口内公式渲染数（范围外 KaTeX widget 与降级 span 共用类名） */
      liveMathCount?: number
      /** #59：阅读挂载块内公式数（KaTeX span / 降级 span） */
      readingMathCount?: number
      /** #60：live 视口内 mermaid 容器数（渲染 widget 与降级态共用类名） */
      liveMermaidCount?: number
      /** #60：阅读挂载块内 mermaid 容器数（渲染 / 降级态共用类名） */
      readingMermaidCount?: number
      /** 阅读挂载块内链接数（#10；屏外块不创建，无 DOM） */
      readingLinkCount?: number
      /** 阅读挂载块内图片数（#10） */
      readingImageCount?: number
      /** 阅读挂载块内双链数（#11；markdown-it 渲染的 a.vsidian-wikilink） */
      readingWikilinkCount?: number
      /** 图片槽位状态计数（#10：当前视图内 loading/loaded/error） */
      imageStates?: ImageStateCounts
      /** 图片条目明细（#201：失效/版本刷新链路断言载体，直连外链除外） */
      imageEntries?: ImageEntryProbe[]
      /** 图片槽位探针（#208）：当前视图内活跃槽位的最终 src 与解码尺寸
       *  ——同名图片外部替换后刷新是否真换字节的绘制层证据（src 换新 +
       *  naturalWidth 变化 = 浏览器实际解码了新地址的字节；旧 webview 缺省） */
      imageProbe?: ImageSlotProbe[]
      /** 查找会话观测（#14）：首次打开后回报（未打开过时缺省） */
      find?: FindSessionProbe
      /** #238 选词会话观测（选项条在场态与三开关；旧 webview 缺省） */
      occurrence?: OccurrenceProbe
      /** 当前生效设置快照（#33 起缓存宿主下发的值；#34 行号等设置的观测面） */
      settings?: SettingsPayload
      /** #34 行号栏观测（设置开关态与视口内渲染结果；旧 webview 缺省） */
      lineGutter?: LineGutterProbe
      /** #32 排版一致性探针（两模式基础排版对照采样；旧 webview 缺省） */
      typography?: TypographyProbe
      /** 绘制层探针（P0 回归）：正文可见性与 CM6 注入样式存活观测 */
      paint?: PaintProbe
      /** 右侧栏观测（#53；布局态与绘制层证据，旧 webview 缺省） */
      sidebar?: SidebarProbe
      /** 大纲观测（#54；面板态、绘制层证据与标题序列，旧 webview 缺省） */
      outline?: OutlineProbe
      /** 反链面板观测（#197；面板态、四态实值与绘制层证据，旧 webview 缺省） */
      backlinks?: BacklinksProbe
      /** 出链面板观测（出链面板批次；面板态、四态实值与绘制层证据，旧 webview 缺省） */
      outlinks?: OutlinksProbe
      /** #140 Popover 改版：frontmatter 属性编辑浮层是否打开（旧 webview 缺省） */
      fmPopoverOpen?: boolean
      /** #218 悬停预览观测：浮层开闭、内容态（loading/content/error）、
       *  目标标识（成功为根内相对路径）与内容块数（旧 webview 缺省）。
       *  #220 新增：fm 属性区三态（none=无属性区/非全文范围，collapsed/
       *  expanded=全文引用的折叠态）与 imageSrcs（浮层内已应用 src 的图片
       *  地址——B 身份资源解析的观测面；字段可选，旧 webview 缺省） */
      hoverPreview?: {
        open: boolean
        state: 'loading' | 'content' | 'error'
        note: string
        blocks: number
        scope: 'full' | 'heading' | 'block' | ''
        fm?: 'none' | 'collapsed' | 'expanded'
        imageSrcs?: string[]
        /** #243 引用内部虚拟窗口与解析观测；旧 webview 缺省。 */
        viewStats?: {
          totalBlocks: number; mountedBlocks: number; contentDomCount: number
          parseCount: number; virtualized: boolean; maxMountedBlocks: number
          mountedEver: number; unmountedEver: number
        } | null
      }
      /** #299 跳转目标提示观测：在场与路径文本（旧 webview 缺省）。 */
      targetTip?: {
        open: boolean
        text: string
      }
      /** #222 嵌入卡片观测：在场卡片逐枚的嵌入目标原文、状态
       *  （loading/content/error）、目标标识（成功为根内相对路径/失败为
       *  错误文案）、内容块数、语义范围、属性区三态与限高（旧 webview 缺省）。
       *  #223 起 host 区分容器（reading 块挂载 / live widget 挂载） */
      readingEmbed?: Array<{
        inner: string
        state: 'loading' | 'content' | 'error'
        note: string
        blocks: number
        scope: 'full' | 'heading' | 'block' | ''
        fm: 'none' | 'collapsed' | 'expanded'
        maxHeightPx: number
        host?: 'reading' | 'live'
        rootHost?: 'reading' | 'live' | 'hover'
        /** #224 内容文本字符数（未保存修改推送后刷新可见性的观测面：
         *  目标内容变化 → textLen 变化；旧 webview 缺省） */
        textLen?: number
        /** #243 引用内部虚拟窗口与解析观测；旧 webview 缺省。 */
        viewStats?: {
          totalBlocks: number; mountedBlocks: number; contentDomCount: number
          parseCount: number; virtualized: boolean; maxMountedBlocks: number
          mountedEver: number; unmountedEver: number
        } | null
      }>
      /** #223 Live 嵌入显隐观测：嵌入表逐枚的源码显形态（目标原文、行号、
       *  光标/选区是否触及源码区间——selectionTouchesRange 语义；旧 webview
       *  缺省为空数组） */
      liveEmbedReveal?: Array<{ inner: string; line: number; revealed: boolean }>
    }
      /** 阅读视图性能探针回报（#7）：滚动往返期间的挂载/回收与解析观测 */
  | {
      kind: 'reading.perf.report'
      scrollRounds: number
      totalBlocks: number
      baseline: ReadingPerfSnapshot
      afterScroll: ReadingPerfSnapshot
      /** 探针全程的全文解析次数（滚动不得使其增长；装载时为 1 起） */
      parseCount: number
      /** 探针期间出现过的最大挂载块数（窗口有界性） */
      maxMountedBlocks: number
      /** 非阅读模式下执行探针时为 false（探针未执行） */
      ok: boolean
    }
  /** 链接跳转意图（#10）：webview 只上报原始 URI 与源位置，执行归宿主——
   *  URI 解析与路径拼接（含 Windows/远程语义）只在宿主侧进行。阅读视图
   *  单击、实时预览 Ctrl/Cmd+单击产生；href 为源文原样（未解码/未规范化）。
   *  #220 来源资源：悬停浮层内（B 文档 Reading 内容）点击的链接附
   *  sourceDocUri（B 的 fsPath，hover.result 成功回包送达过的目标）——宿主
   *  按 B 目录解析并执行；缺省 = 面板自身文档（主视图点击，向后兼容） */
  | {
      kind: 'link.activate'
      sessionId: string
      docUri: string
      href: string
      srcStart: number
      srcEnd: number
      /** #220 来源文档（悬停浮层内链接）；宿主侧与面板已送达的悬停目标比对，不匹配即丢弃 */
      sourceDocUri?: string
    }
  /** 双链跳转意图（#11）：与 link.activate 同通道语义，但目标是 Obsidian
   *  双链（按名/按路径在工作区内解析，非 URI）——分类走 wikilinkTarget
   *  而非 #10 的 URI 白名单。target 为 `[[` 与 `]]` 之间、`|` 之前的原文
   *  （未 trim；宿主解析自带规范化）。阅读视图单击、实时预览
   *  Ctrl/Cmd+单击产生；srcStart/srcEnd 覆盖整个 `[[…]]` 出现（阅读视图
   *  为所在块源锚点）。#220 sourceDocUri 语义与 link.activate 同（浮层内
   *  双链以 B 为来源解析） */
  | {
      kind: 'wikilink.activate'
      sessionId: string
      docUri: string
      target: string
      srcStart: number
      srcEnd: number
      /** #220 来源文档（悬停浮层内双链）；宿主侧与面板已送达的悬停目标比对，不匹配即丢弃 */
      sourceDocUri?: string
    }
  /** 图片资源解析请求（#10）：非 http(s) 直连的工作区图源经宿主解析为
   *  webview 可加载地址（reqId 会话面板内自增，对应 image.result）。
   *  #220 来源资源：悬停浮层内 B 文档的图片附 sourceDocUri（B 的 fsPath）
   *  ——宿主按 B 目录走同一 classifyImageTarget 白名单与 asWebviewUri 机制
   *  （会话守卫字段仍为面板自身文档；sourceDocUri 与已送达悬停目标比对，
   *  不匹配即丢弃）；缺省 = 面板自身文档。来源化请求不进会话解析缓存/
   *  在途去重表（浮层短生命周期；跨开缓存属 #224 有界缓存） */
  | {
      kind: 'image.request'
      sessionId: string
      docUri: string
      reqId: number
      src: string
      /** #220 来源文档（悬停浮层内图片） */
      sourceDocUri?: string
    }
  /** 图片周期核验（#201）：webview 活跃挂载图源（非直连）合并上报，宿主
   *  stat 对比版本表后对变化目标回发 image.invalidate（维持目标不响应）。
   *  由 webview 调度器驱动：间隔约 30 秒、无活跃槽位停止、面板恢复可见/
   *  收到 image.wake 立即触发 */
  | {
      kind: 'image.verify'
      sessionId: string
      docUri: string
      items: Array<{ src: string; state: 'loaded' | 'loading' | 'error'; reason?: string }>
    }
  /** 图片粘贴落盘（#161）：webview paste 拦截命中 image/* 剪贴板项后出站；
   *  mime 为 image/*、dataBase64 为严格 base64（上限见 IMAGE_PASTE_LIMITS），
   *  fileNameHint 可选（剪贴板文件的原始名，宿主判定合成名后决定沿用或
   *  时间戳命名）。宿主按设置解析目录 → 建目录 → 写盘，结果经
   *  image.paste.result 回来源面板（载荷形态照 diagram.export 的 base64
   *  先例） */
  | {
      kind: 'image.paste'
      sessionId: string
      docUri: string
      reqId: number
      mime: string
      dataBase64: string
      fileNameHint?: string
    }
  /** #208 手动刷新请求（工具栏刷新按钮/快捷键入口）：宿主清图片解析缓存、
   *  推进资源代次后以 refresh.invalidated 应答（reqId 配对）。会话守卫与
   *  image.request 同款（就绪且 docUri 匹配才放行）；只读交互，不写文档、
   *  不入撤销栈，暂停态同样放行 */
  | { kind: 'refresh.request'; sessionId: string; docUri: string; reqId: number }
  /** 悬停文档预览请求（#218，只读引用消息——**不进 edit.request 通道**）：
   *  webview 悬停 Reading 双链时请求宿主无副作用读取目标并以 hover.result
   *  回包（reqId 配对）。会话守卫字段（sessionId/docUri）与其余请求同款；
   *  请求身份契约：instanceId 为 webview 侧浮层视图实例标识（一次打开一个
   *  实例，重开换新 id——迟到回包据此丢弃）、sourceStart/sourceEnd 为父
   *  文档内引用区间的 LF 偏移（Reading 侧为所在块源锚点）、target 为 `[[`
   *  与 `]]` 之间 `|` 之前的原文（未 trim；宿主解析自带规范化）。#219 起
   *  普通本地 Markdown 链接接入：linkHref 存在时为 `<a>` 的 href 原文
   *  （阅读侧可能经 markdown-it normalizeLink 编码——宿主容错解码），宿主
   *  走普通链接解析（外部网页 webview 侧已预滤，宿主复核兜底）。只读交互：
   *  宿主只 openTextDocument+getText，不写文档、不建面板 */
  | {
      kind: 'hover.request'
      sessionId: string
      docUri: string
      reqId: number
      instanceId: string
      sourceStart: number
      sourceEnd: number
      target: string
      /** Stable card occurrence; request instanceId may change on remount. */
      occurrenceId?: string
      /** Child references use the delivered, still-watched parent occurrence. */
      source?: { parentInstanceId: string; sourceDocUri: string }
      /** #242 成功送达后保留来源，直到 watch 转交或显式 release。 */
      retainSource?: boolean
      /** 普通链接形态的 href 原文（#219；缺省 = 双链形态） */
      linkHref?: string
      /** #221 面板直接目标（反链/出链条目）：宿主快照携带的绝对 fsPath
       *  （± 锚点——标题原文或 ^块id，与 OutlinkItemPayload.anchor 同口径），
       *  存在时宿主不走 target/linkHref 文本解析与根内路径探测，直接按
       *  fsPath 读取并按锚点收窄范围。空串 fsPath = 断链出链条目（宿主回
       *  not-found 分态——条目仍可悬停显示失效占位）。target 字段此时为
       *  条目显示名（错误分态文案的取材） */
      directTarget?: { fsPath: string; anchor?: string }
    }
  /** 悬停目标订阅（#224 引用视图同步，只读消息）：webview 侧视图实例
   *  （浮层/嵌入卡片）成功装载目标后登记——宿主对该目标的文档修改与磁盘
   *  变化经 hover.invalidated 推送。fsPath 恒为 hover.result 成功回包送达
   *  的目标身份（webview 不自行解析路径）；instanceId 为视图实例标识
   *  （浮层 instanceId / 嵌入 entry 语义键）——同一目标多实例合并订阅
   *  （目标级推送），各实例独立释放（hover.unwatch 归零才退订） */
  | {
      kind: 'hover.watch'
      sessionId: string
      docUri: string
      fsPath: string
      instanceId: string
      sourceLeaseId?: string
    }
  /** 悬停目标订阅释放（hover.watch 的配对消息）：实例关闭/回收时释放其
   *  订阅；面板销毁由宿主侧整体释放（releaseSession），不依赖逐实例消息 */
  | {
      kind: 'hover.unwatch'
      sessionId: string
      docUri: string
      fsPath: string
      instanceId: string
    }
  | { kind: 'hover.source.release'; sessionId: string; docUri: string; sourceLeaseId: string }
  /** #299 跳转目标提示轻量解析（只读消息，**不进 edit.request 通道**）：
   *  webview 侧「浮层不将现」的悬停场景请求宿主把目标解析为所属根内
   *  相对路径，应答经 hover.target.resolved（reqId 配对）。载荷三形态与
   *  hover.request 的目标解析口径同源（target 双链原文 / linkHref 普通
   *  链接 href / directTarget 面板直接目标）择一；**只解析不读正文**——
   *  宿主仅做路径解析与存在性探测（stat 级），不 openTextDocument、不
   *  建立 hover.request/watch 的文档读取与租约链路（提示只报位置不展
   *  内容，轻量是硬边界）。解析失败（not-found/escape/不支持形态）回
   *  ok:false，webview 侧不出提示 */
  | {
      kind: 'hover.target.resolve'
      sessionId: string
      docUri: string
      reqId: number
      /** 双链目标原文（`|` 之前；缺省取其余两形态之一） */
      target?: string
      /** 普通链接 href 原文 */
      linkHref?: string
      /** 面板直接目标（反链/出链条目；空串 fsPath = 断链条目） */
      directTarget?: { fsPath: string; anchor?: string }
    }
  /** 代码块复制请求（#81）：卡片头部复制按钮点击 → 宿主剪贴板 API 写入。
   *  text 为代码体原文（两条围栏行之间，不含围栏与 info string），恒为
   *  LF（CM6 LF 模型）；宿主按文档 EOL 归一后写剪贴板（webview 不触碰
   *  剪贴板权限） */
  | { kind: 'codeblock.copy'; sessionId: string; docUri: string; text: string }
  /** 图表导出（#111）：图表弹窗工具条 → 宿主另存为对话框落盘。content：
   *  SVG 为文档文本，PNG 为 dataURL 去前缀的 base64；宿主按上限校验后
   *  showSaveDialog + writeFile，结果经 diagram.export.result 回报来源面板 */
  | { kind: 'diagram.export'; sessionId: string; docUri: string; reqId: number; format: 'svg' | 'png'; fileName: string; content: string }
  /** 图片导出（#212）：图片弹窗工具条「另存原图副本」→ 宿主定位工作区
   *  文件读字节 → showSaveDialog → writeFile。字节级拷贝、保持原格式，
   *  不经 canvas 光栅化；src 为文档内图片原始地址（外链图 webview 侧
   *  按钮已禁用，不发本消息），fileName 为建议名（basename 清洗后）；
   *  结果经 image.export.result 回报来源面板 */
  | { kind: 'image.export'; sessionId: string; docUri: string; reqId: number; src: string; fileName: string }
  /** 打开 Vsidian 设置页（#33）：编辑器工具栏「设置」按钮 → 宿主
   *  createWebviewPanel。无 sessionId/docUri——打开设置页不依赖任何文档
   *  会话（无文档打开时同样可用） */
  | { kind: 'settings.open' }
  /** 请求设置快照（#33）：设置页 ready 后与编辑器面板 init 后拉取当前值，
   *  宿主以 settings.snapshot 响应（webview 不持久化设置，权威在宿主） */
  | { kind: 'settings.get' }
  /** 保存设置（#33）：设置页上送变更键值对（批，原子生效）。宿主按定义
   *  校验：通过才持久化并广播 settings.changed；拒绝时向来源设置页回
   *  settings.snapshot 以权威值恢复显示 */
  | { kind: 'settings.set'; values: SettingsPayload }
  /** 设置页 UI 态上报（会话内恢复）：当前分页 id 与主区滚动位置。webview
   *  在分页切换与主区滚动时上送，宿主记忆于扩展宿主内存（会话内存活）；
   *  面板关闭/隐藏重载后按记忆经 settings.focusSection{scroll} 恢复。
   *  section 为空字符串时宿主忽略（尚无激活分页——如首帧默认页未回落） */
  | { kind: 'settings.uiState'; section: string; scrollTop: number }
  /** 请求查找选项快照（#236）：编辑器面板 init 后拉取当前三开关状态，
   *  宿主以 findOptions.snapshot 响应（workspace 级记忆权威在宿主） */
  | { kind: 'findOptions.get' }
  /** 保存查找选项（#236）：查找面板切换开关后上送完整三开关。宿主清洗
   *  校验后持久化（workspaceState）并广播 findOptions.snapshot 到全部
   *  编辑器面板（多面板一致；选项是共享状态，非面板私有） */
  | { kind: 'findOptions.set'; options: FindOptions }
  /** #69 剪贴板写（直写）：webview 环境无 navigator.clipboard 权限面，
   *  经宿主 env.clipboard.writeText。只读交互，暂停态同样放行 */
  | { kind: 'clipboard.write'; text: string }
  /** #69 剪贴板写（标题链接）：`[[笔记名#标题]]` 的拼接在宿主侧——
   *  webview 只上报 docUri（宿主取笔记名 = 文件名去扩展名）与标题原文
   *  （含行内标记，与宿主 findHeadingOffset 的字面匹配同源；剥标记可见
   *  文本只用于 text 直写变体的「复制标题」纯文本场景） */
  | { kind: 'clipboard.write'; linkHeading: { docUri: string; heading: string } }
  /** #162 剪贴板写（块链接）：`[[笔记名#^块id]]` 的拼接在宿主侧——
   *  blockId 为 webview 侧块尾行既有 id 或刚自动写入的新 id（写入先经
   *  标准 edit.request 落权威文档，本消息只携最终 id；与 linkHeading
   *  同一只读交互端口） */
  | { kind: 'clipboard.write'; linkBlock: { docUri: string; blockId: string } }
  /** 剪贴板读（#183 统一右键菜单粘贴项）：webview 无 navigator.clipboard
   *  权限面，经宿主 env.clipboard.readText 读回（沿 clipboard.write 消息
   *  桥先例）；结果经 clipboard.read.result 回来源面板。宿主读回文本按
   *  LF 归一（webview 全程 LF 坐标） */
  | { kind: 'clipboard.read'; reqId: number }
  /** 性能探针回报（#5）：快照为 DOM 计数，输入延迟含 rAF 稳定等待 */
  | {
      kind: 'perf.report'
      typingRounds: number
      scrollRounds: number
      docLines: number
      /** 首次探针输入 dispatch 且完成两个 rAF 后的 wall clock 时间 */
      firstInputSettledEpochMs: number
      baseline: PerfSnapshot
      afterTyping: PerfSnapshot
      afterScroll: PerfSnapshot
      inputDelayMs: { samples: number[]; avgMs: number; maxMs: number }
      /** 宿主不支持 PerformanceObserver('longtask') 时为 null */
      longTasks: { count: number; maxMs: number; totalMs: number } | null
      headingStats: { totalUpdates: number; lastUpdateScannedLines: number; fullBuildLines: number }
    }
  /** #292 骨架屏状态回报（测试钩子）：present 为骨架元素在场，container 为
   *  挂载收编落点；仅在宿主嵌入 hold 全局（测试装配）时回报，生产零消息 */
  | {
      kind: '_test.skeleton.report'
      present: boolean
      container: 'live' | 'reading' | null
      shownAt: number | null
    }
  /** CSS 片段快照拉取（#128）：编辑器面板 init 后与设置页 ready 后请求；
   *  宿主分别以 snippets.snapshot（编辑器，含 URI 清单）与 snippets.state
   *  （设置页，含开关列表）应答 */
  | { kind: 'snippets.get' }
  /** CSS 片段 <link> 装载结果回报（#128，编辑器面板）：入口级加载成败——
   *  失败时 webview 保留最近成功样式（装新链成功后才摘旧链），宿主据此
   *  给用户提示与诊断；version 对应触发装载的清单版本 */
  | { kind: 'snippets.loadResult'; name: string; version: number; ok: boolean }
  /** CSS 片段目录选择对话框（#128，设置页）：宿主弹文件夹选择器并按结果
   *  应用目录（snippets.chooseOpenLabel 取词作确认按钮文案）；结果经
   *  snippets.state 推送，不逐次应答 */
  | { kind: 'snippets.chooseDirectory' }
  /** 直接设置片段目录（#128，设置页/测试注入通道）：null = 取消配置 */
  | { kind: 'snippets.setDirectory'; directory: string | null }
  /** 逐片段开关（#128，设置页）：文件名键 + 显式开关 */
  | { kind: 'snippets.setEnabled'; name: string; enabled: boolean }
  /** #131 暂停/恢复全部片段（设置页「暂停全部」按钮与暂停状态条的恢复
   *  入口）。宿主持久化全局标志；命令面板命令（cssSnippets.pause /
   *  cssSnippets.resume）与设置页按钮共用同一服务入口——即使 webview
   *  异常，命令仍独立可用 */
  | { kind: 'snippets.setPaused'; paused: boolean }
  /** 手动刷新片段（#128，设置页按钮；命令面板走宿主命令同链路） */
  | { kind: 'snippets.refresh' }
  /** 在系统文件管理器中打开片段目录（#128，设置页） */
  | { kind: 'snippets.openDirectory' }
  /** 导出样式契约 JSON（#145，设置页「样式参考」分页工具区）：宿主读
   *  VSIX 内 media/style-reference/style-reference.json（与分发的机器可读
   *  清单同一字节），经 showSaveDialog 另存到用户路径；成功/失败以宿主
   *  通知回报，不逐次应答（命令面板 exportStyleReference 同一实现） */
  | { kind: 'styleRef.export' }
  /** 反链快照拉取（#197）：面板 init 后与文档切换后请求当前文档的反链；
   *  宿主以 backlinks.snapshot 响应（索引变更后主动推送，不逐次应答） */
  | { kind: 'backlinks.get'; sessionId: string; docUri: string }
  /** 反链条目跳转意图（#197）：点击面板条目 → 宿主打开来源文档（Vsidian
   *  面板）并定位到出链标记处。offset 为来源正文的 LF 偏移（宿主打开后
   *  经 NewlineCoordinator 换算发 view.locate，与双链跳转同链路） */
  | { kind: 'backlink.activate'; sessionId: string; docUri: string; sourceUri: string; offset: number }
  /** 出链快照拉取（出链面板批次）：面板 init 后请求当前文档的出链；宿主
   *  以 outlinks.snapshot 响应（索引变更后与 backlinks 同点主动推送） */
  | { kind: 'outlinks.get'; sessionId: string; docUri: string }
  /** 出链条目跳转意图（出链面板批次）：点击面板条目 → 宿主打开目标文档
   *  （Vsidian 面板）并按该链接的实际锚点定位（标题/块 id，复用双链跳转
   *  的锚点定位器；无锚点或锚点未命中回落文档顶）。targetUri 为目标绝对
   *  fsPath（快照载荷原样回传）；anchor 空串表示无锚点 */
  | { kind: 'outlink.activate'; sessionId: string; docUri: string; targetUri: string; anchor: string }
  /** 索引维护状态拉取（#198，设置页）：宿主以 index.state 应答；状态变更
   *  后由宿主推送（onStateChanged → settingsPage.notifyIndexChanged） */
  | { kind: 'index.get' }
  /** 保存排除模式（#198，设置页）：宿主清洗（shared/vaultIndexExclude 规
   *  则）后持久化并触发覆盖范围重算；结果经 index.state 推送（非法项在
   *  notice.patterns-invalid 回显，合法项照常生效） */
  | { kind: 'index.setPatterns'; patterns: string[] }
  /** 恢复默认排除模式（#198，设置页）：等价保存默认值清单 */
  | { kind: 'index.resetPatterns' }
  /** 清理当前工作区索引缓存（#198，设置页）：安全回收旧代际（进度/结果
   *  经 index.state 推送） */
  | { kind: 'index.cleanup' }
  /** 完整重建索引（#198，设置页）：全根重扫 + 资源核验，进度经 index.state
   *  推送；index.cancel 可中止 */
  | { kind: 'index.rebuild' }
  /** 取消在途维护操作（#198，设置页，重建/清理期间可用） */
  | { kind: 'index.cancel' }
  /** 分词资源状态拉取（#239，设置页与编辑器面板装载时）：宿主以
   *  wordSegment.state 应答（含已安装资源的 webview URI——逐面板私有） */
  | { kind: 'wordSegment.get' }
  /** 请求下载 jieba 资源（#239，设置页）：宿主按当前下载源设置执行——
   *  下载 → sha256 校验 → 落 globalStorage，失败清理不留半成品文件；
   *  全程经 wordSegment.state 推送（downloading → idle/notice） */
  | { kind: 'wordSegment.download' }
  /** 删除已下载 jieba 资源（#239，设置页）：删除后引擎回退 builtin，
   *  结果经 wordSegment.state 推送 */
  | { kind: 'wordSegment.delete' }
  /** 编辑器侧 jieba 加载结果回报（#239）：宿主已确认资源就绪但 webview
   *  动态 import/init 失败时上报（CSP/运行时不兼容等宿主不可见场景），
   *  宿主通知用户并记录 notice.load-failed；成功不回报 */
  | { kind: 'wordSegment.loadResult'; ok: boolean; detail?: string }

/** 反链面板条目载荷（#197 backlinks.snapshot.items；形态与宿主
 *  BacklinkItem 同构——本接口为协议层稳定契约） */
export interface BacklinkItemPayload {
  /** 来源文档根内相对路径（`/` 分隔） */
  sourceRelPath: string
  /** 来源文档绝对 fsPath（跳转与打开用） */
  sourceFsPath: string
  /** 边类型（双链/内联链接/图片/引用式定义/嵌入——#222 embed 与双链同构） */
  kind: 'wikilink' | 'mdlink' | 'image' | 'refdef' | 'embed'
  /** 标题/块锚点文本（空串无） */
  anchor: string
  /** 出链标记在来源正文中的 LF 偏移区间 */
  start: number
  end: number
  /** 来源行号（1 基） */
  line: number
  /** 引用片段（来源行文本，超长已截断） */
  snippet: string
  /** 短片段起点（LF 全文偏移；卡片命中高亮的区间切分基准。可选：旧宿主
   *  快照缺省，webview 侧缺省不高亮） */
  snippetStart?: number
  /** 来源文件 mtime（毫秒；未知 0）——面板分组排序键 */
  sourceMtimeMs?: number
  /** 来源文件创建时间（毫秒；未知 0——POSIX 宿主 birthtime 常不可得，
   *  排序沉底）。可选：旧宿主快照缺省按 0 处理 */
  sourceBirthtimeMs?: number
  /** 长片段（「更多上下文」态：引用行 ±2 行，总长上限约 300 字符，首尾
   *  按截断加「…」；切换纯显示层）。可选：旧宿主快照缺省回退短片段 */
  snippetLong?: string
  /** 长片段起点（LF 全文偏移；同 snippetStart 语义） */
  snippetLongStart?: number
}

/** 出链面板条目载荷（outlinks.snapshot.items；形态与宿主 OutlinkItem
 *  同构——本接口为协议层稳定契约） */
export interface OutlinkItemPayload {
  /** 目标显示名：解析命中取 basename 去扩展名（目录段不保留——与目标
   *  路径行分工）；断链用 target 原文 */
  targetDisplay: string
  /** 解析命中的根内相对路径（`/` 分隔）；断链 null */
  targetRelPath: string | null
  /** 目标绝对 fsPath（跳转与打开用）；断链 null */
  targetFsPath: string | null
  /** 边类型（双链/内联链接/图片/引用式定义/嵌入——#222 embed 与双链同构） */
  kind: 'wikilink' | 'mdlink' | 'image' | 'refdef' | 'embed'
  /** 标题/块锚点文本（空串无；#^块id 形态保留 ^ 前缀） */
  anchor: string
  /** 是否解析命中（断链条目弱化呈现且不可点） */
  resolved: boolean
  /** 出链标记在当前正文中的 LF 偏移区间 */
  start: number
  end: number
}

/** 悬停预览规范目标身份（#218 hover.result.ok）：fsPath 为宿主侧真实
 *  路径（大小写归正后形态），relPath 为所属根内相对路径（`/` 分隔） */
export interface HoverPreviewTargetIdentity {
  fsPath: string
  relPath: string
}

/** 悬停预览语义范围选择器（#218 一期全文；#219 扩展标题章节与块——
 *  锚点语义与链接形态无关：双链 `[[笔记#锚]]` 与普通链接 `[x](笔记.md#锚)`
 *  归同一选择器。anchor：标题原文或带 ^ 前缀的块 id（与
 *  OutlinkItemPayload.anchor 同口径） */
export type HoverPreviewScope =
  | { kind: 'full' }
  | { kind: 'heading'; anchor: string }
  | { kind: 'block'; anchor: string }

/** 悬停预览失败原因（#218 错误分态，就地 i18n 呈现；#219 增锚点缺失）：
 *  unsupported=目标形态非法/外部网页不接入；no-workspace=来源不在工作区；
 *  escape=目标越出所属根；not-found=目标文件不存在；non-markdown=目标非
 *  Markdown（一期只接 Markdown）；read-failed=打开/读取目标失败；
 *  anchor-missing=目标文件在但标题/块锚点不存在（不以全文替代，附锚点
 *  原文） */
export type HoverPreviewFailReason =
  'unsupported' | 'no-workspace' | 'escape' | 'not-found' | 'non-markdown' | 'read-failed' | 'anchor-missing' |
  'source-expired' | 'cycle' | 'depth' | 'budget'

/** #218 悬停预览请求载荷（宿主侧消费形态） */
export type HoverPreviewRequestPayload = Extract<WebviewToHost, { kind: 'hover.request' }>

/** #218 悬停预览结果消息（webview 侧消费形态） */
export type HoverPreviewResult = Extract<HostToWebview, { kind: 'hover.result' }>

/** #299 跳转目标提示解析结果消息（webview 侧消费形态） */
export type TargetTipResolved = Extract<HostToWebview, { kind: 'hover.target.resolved' }>

/** 性能快照（#5）：一次观测时点的 DOM 计数 */
export interface PerfSnapshot {
  /** .cm-line 行元素数 */
  renderedLines: number
  /** .cm-content 内全部元素数 */
  contentDomCount: number
  /** .vsidian-heading-line 元素数 */
  headingLineCount: number
  /** .vsidian-heading-inview 元素数（间接装饰渲染结果） */
  inviewHeadingCount: number
  /** #15：webview JS 堆已用字节数（Chromium performance.memory）；环境不支持为 null */
  jsHeapBytes?: number | null
}

/** 阅读视图性能快照（#7）：一次观测时点的挂载与滚动状态 */
export interface ReadingPerfSnapshot {
  /** 挂载块数 */
  mountedBlocks: number
  /** 容器内全部元素数（含 spacer） */
  contentDomCount: number
  /** 容器 scrollTop（px） */
  scrollTopPx: number
  /** 容器 scrollHeight（px） */
  scrollHeightPx: number
  /** #15：webview JS 堆已用字节数（Chromium performance.memory）；环境不支持为 null */
  jsHeapBytes?: number | null
}

/** 图片槽位状态计数（#10：图片生命周期观测，当前视图内计数） */
export interface ImageStateCounts {
  loading: number
  loaded: number
  error: number
}

/** 图片条目明细观测（#201）：view.state 的 imageEntries 数据形态——失效
 *  与版本刷新链路的细粒度断言载体（appliedSrc 含 ?v= 代次可直接断言） */
export interface ImageEntryProbe {
  src: string
  state: 'loaded' | 'loading' | 'error'
  reason?: string
  appliedSrc?: string
}

function isImageEntryProbe(v: unknown): v is ImageEntryProbe {
  return (
    isObject(v) &&
    isString(v.src) &&
    (v.state === 'loaded' || v.state === 'loading' || v.state === 'error') &&
    (v.reason === undefined || isString(v.reason)) &&
    (v.appliedSrc === undefined || isString(v.appliedSrc))
  )
}

/** 图片槽位探针（#208：当前视图内活跃槽位的最终地址与解码观测） */
export interface ImageSlotProbe {
  /** img 元素最终应用的 src 属性（宿主 webview URI 含 ?v= 代次戳；
   *  槽位尚无 img（未解析）为 null） */
  src: string | null
  /** 浏览器实际解码宽度（load 后为位图宽；img 未创建/未解码为 null，
   *  jsdom 无解码环境为 0） */
  naturalWidth: number | null
  /** 槽位状态（与 data-vsidian-img-state 同步） */
  state: 'loading' | 'loaded' | 'error'
}

/** CSS 契约探针回报（#6）：一段仅经稳定类名定位的内部测试 CSS 是否生效 */
export interface CssProbeReport {
  /** live 一级标题行经 `.vsidian-heading-line-1` 命中的属性值；无目标元素为 null */
  liveHeadingDecorationColor: string | null
  /** 阅读一级标题块经 `.vsidian-reading-heading-1` 命中的属性值；无目标元素为 null */
  readingHeadingDecorationColor: string | null
  /** `.vsidian-view-reading` 上被外部片段覆盖的探针变量值；未覆盖为空（null） */
  readingVarProbe: string | null
  /** #8：live 粗体 span 经 `.vsidian-strong` 命中的属性值；无目标为 null */
  liveStrongDecorationColor: string | null
  /** #8：live 行内代码 span 经 `.vsidian-inline-code` 命中的属性值；无目标为 null */
  liveInlineCodeDecorationColor: string | null
  /** #139：live HTML 注释 span 经 `.vsidian-html-comment` 命中的属性值；无目标为 null */
  liveHtmlCommentDecorationColor: string | null
  /** #8：live 代码行经 `.vsidian-code-line` 命中的属性值；无目标为 null */
  liveCodeLineDecorationColor: string | null
  /** #8：阅读视图内语义 strong 经 `.vsidian-view-reading strong` 命中的属性值 */
  readingStrongDecorationColor: string | null
  /** #9：live 任务 checkbox 经 `.vsidian-task-checkbox` 命中的属性值；无目标为 null */
  liveTaskCheckboxDecorationColor: string | null
  /** #9：阅读任务 checkbox 经 `.vsidian-reading-task-checkbox` 命中的属性值 */
  readingTaskCheckboxDecorationColor: string | null
  /** #10：live 链接 span 经 `.vsidian-link` 命中的属性值；无目标为 null */
  liveLinkDecorationColor: string | null
  /** #10：阅读链接经 `.vsidian-reading-block a` 命中的属性值；无目标为 null */
  readingLinkDecorationColor: string | null
  /** #10：阅读图片经 `.vsidian-reading-block img.vsidian-image` 命中的属性值 */
  readingImageDecorationColor: string | null
  /** #12：live 表格管道符经 `.vsidian-table-pipe` 命中的属性值；无目标为 null */
  liveTablePipeDecorationColor: string | null
  /** #12：阅读表格经 `.vsidian-reading-block table` 命中的属性值；无目标为 null */
  readingTableDecorationColor: string | null
  /** #11：live 双链经 `.vsidian-wikilink` 命中的属性值；无目标为 null */
  liveWikilinkDecorationColor: string | null
  /** #11：阅读双链经 `.vsidian-reading-block a.vsidian-wikilink` 命中的属性值 */
  readingWikilinkDecorationColor: string | null
  /** #59：live 公式内层 `.katex` 的 computed font-family（katex.min.css 生效
   *  时含 KaTeX 字体族；样式/CSP 失效时回落 body 字体——字体管线观测位） */
  liveMathFontFamily?: string | null
  /** #59：阅读公式内层 `.katex` 的 computed font-family（同上） */
  readingMathFontFamily?: string | null
  /** #129：@font-face 装载观测（document.fonts 总数与已裂数）——片段
   *  相对字体按各自 CSS 文件路径解析可用的字节级证据；FontFaceSet 不可
   *  用（旧环境/jsdom）为 null */
  documentFonts?: { total: number; loaded: number } | null
  /** #129：阅读容器 computed background-image（'none' → null）——片段
   *  相对图片的解析锚点观测（URL 按引用它的 CSS 文件路径解析） */
  readingBackgroundImage?: string | null
  /**
   * #132 Obsidian 原名别名桥探针：键 = 清单条目 ID（或「条目 ID-reading」
   * 视图消歧后缀），值 = 按 **Obsidian 原名选择器** 定位目标元素的
   * text-decoration-color（media/css-contract-probe.css 以原名写探针规则；
   * 别名类未挂上/挂错节点即 null，断言端逐项核对期望 rgb）。选择器表
   * 单一事实源：src/shared/obsidianAlias.ts 的 OBSIDIAN_ALIAS_PROBES。
   */
  obsidianAliases?: Record<string, string | null>
  /**
   * #132 变量别名桥观测：一级标题的 computed color（经 --h1-color 驱动的
   * 可见效果——变量桥生效则随片段设置的 Obsidian 原名变量变化；无目标
   * 元素为 null）。真实片段链路验证：集成用例「Obsidian 变量别名桥」
   */
  obsidianVarProbe?: { liveHeadingColor: string | null; readingHeadingColor: string | null }
  /**
   * #133 界面域样式契约探针：键 = 清单条目 ID（或「条目 ID-视图」消歧
   * 后缀），值 = 按 **vsidian 稳定类名选择器** 在 document 域（界面域目标
   * 不全在两视图容器内——大纲面板挂侧栏）定位目标元素的 computed 自定义属性
   * --vsidian-chrome-probe 的 computed 值（不可见探针，与 outline-color /
   * text-decoration-color 两套既有探针正交；media/css-contract-probe.css 同源
   * 探针规则；类未挂上/
   * 挂错节点即 null）。选择器表单一事实源：src/shared/chromeContract.ts
   * 的 CHROME_CONTRACT_PROBES。
   */
  chromeSelectors?: Record<string, string | null>
  /**
   * #133 界面域可见颜色观测：各区域代表元素的 computed color（随当前
   * viewMode 取对应侧目标；无目标元素为 null）。真实片段链路验证：
   * 集成用例「界面域样式契约」——片段改写这些可见属性即被观测到。
   */
  chromePaint?: {
    mathKatexColor: string | null
    codeCardLabelColor: string | null
    tokKeywordColor: string | null
    mermaidContainerColor: string | null
    outlineLevel1Color: string | null
  }
  /**
   * #133 图表弹窗样式观测：浮层在场时的 computed color（toolbar 与
   * stage 两区）；浮层不在场为 null（弹窗 DOM 只在打开期间存在）。
   * 打开与刷新后样式保持的验证：集成用例「界面域样式契约」。
   */
  chromePopup?: { toolbarColor: string | null; stageColor: string | null } | null
}

/** #34 行号栏观测（view.state 扩展字段）：开关生效态与视口内渲染结果。
 *  口径注意：采集不判 viewMode——reading 态 liveWrapper 仅 display:none
 *  而 DOM 仍在，count/first/last 仍统计隐藏的 live gutter（与 TypographyProbe
 *  对隐藏侧的显式声明同理），不得据此断言"reading 态行号在渲染"。 */
export interface LineGutterProbe {
  /** 设置开关生效态（快照缺键时为定义默认 true） */
  on: boolean
  /** `.cm-lineNumbers .cm-gutterElement` 数（CM6 原生视口有界，远小于全文行数） */
  count: number
  /** 首个行号单元格文本（源行编号起点观测；栏未装配为 null） */
  first: string | null
  /** 末个行号单元格文本（视口尾行号观测；栏未装配为 null） */
  last: string | null
  /** #116 行号几何对齐采样：每条可见行号与所属正文行首可见文本的偏差
   *  采样，主口径为基线差 deltaBaseline（光学对齐看基线；绘制稳定后
   *  采集）。无布局环境（jsdom，含无 canvas 2D 实现）或视口内无可见
   *  文本行时为 null（旧 webview 缺省容忍）。 */
  alignment?: LineGutterAlignment[] | null
}

/** #116 行号对齐采样条目 */
export interface LineGutterAlignment {
  /** 行号文本（源行号） */
  num: string
  /** 基线差（主断言口径，|值| ≤ 1 视为对齐）：数字基线 − 正文行首可见
   *  文本基线的像素差（负 = 行号偏上）。由底边差按两侧各自 computed
   *  font 的 canvas measureText fontBoundingBox descent 换算——行号字号
   *  小于正文（0.75×），两侧 descent 不同，底边重合 ≠ 基线重合。 */
  deltaBaseline: number
  /** 次要上报：数字文本底边 − 正文行首可见文本底边的像素差（旧基线
   *  代理口径，负 = 行号偏上）。保留用于诊断对照，不作断言口径。 */
  deltaBottom: number
}

/**
 * 绘制层探针（view.state 扩展字段）：守护"正文真的可见"这一用户级事实。
 * 由来（P0）：CSP `style-src` 未放行内联样式时，CM6（style-mod）注入的
 * baseTheme 样式表被浏览器拒绝（el.sheet 为 null），.cm-scroller 退化
 * block——无行号时与 flex 视觉等价从未暴露，行号栏加入后 gutter 与正文
 * 上下堆叠、正文被推出视口。既有用例只断言 DOM 数量与几何 x 坐标，均
 * 存活于该缺陷之上，故补此探针断言绘制层。
 * jsdom 无布局能力（rect 恒 0），textVisible 恒 false，不作单测断言依据。
 */
export interface PaintProbe {
  /** #305 本地轻提示：不拦截命中，文字范围与样式确认实际可见。 */
  toast?: { visible: boolean; text: string; severity: string; background: string; foreground: string; pointerEvents: string }
  /** 首个含文本行：首字符 rect 在视口内且 elementFromPoint 命中内容区。
   *  覆盖物（冲突暂停横幅、查找面板等绝对定位元素）遮挡首 8 行文本时同样
   *  返回 false——失败排障时先排除覆盖物再怀疑 CSP 样式失效 */
  textVisible: boolean
  /** `.cm-scroller` computed display：CM6 baseTheme 存活时为 'flex' */
  scrollerDisplay: string | null
  /** 行号栏 computed user-select（'none' = 禁选；栏未装配为 null） */
  gutterUserSelect: string | null
  /** 真宿主中通过文字可见性、面积与命中检查的行号文本。 */
  visibleLineNumbers?: string[]
  /** CM6 明暗声明当前激活态（EditorView.darkTheme facet 实值）。随宿主
   *  body 主题 class 动态跟随；激活后 baseTheme 内建变体接管 caret 等
   *  颜色——本扩展不硬编码光标色（深色主题黑底黑光标回归的观测位） */
  darkTheme: boolean
  /** `.cm-content` computed caret-color（'rgb(...)' 文本）。#237 多光标
   *  开启时 drawSelection 隐藏原生 caret（恒 transparent），光标颜色证据
   *  移至 drawnCursorColor；关闭多光标时 CM6 光标即原生 caret，颜色由
   *  baseTheme 明暗变体决定（light=black / dark=white）；jsdom 无 CSS
   *  引擎为 null */
  caretColor: string | null
  /** #237 绘制光标 `.cm-cursor` 的 computed borderLeftColor（'rgb(...)'
   *  文本；多光标开→drawSelection 绘制，baseTheme 明暗变体 light=black /
   *  dark=#ddd）。元素不在场（多光标关、未聚焦或 jsdom）为 null */
  drawnCursorColor?: string | null
  /** 阅读查找隐藏源码反馈：当前文字真实命中且有背景才视为 visible。 */
  readingFindSource?: { visible: boolean; text: string; current: string; background: string | null }
  /** #42/#43 表格绘制：真宿主文本命中与计算样式；无表格/未选中为 null。 */
  table?: {
    cellVisible: boolean
    /** 真宿主光标（零宽格使用格内绘制指示）的命中列；无可见光标时为 null。 */
    caretGridColumn?: number | null
    delimiterDisplay?: string | null
    headerCellBackgrounds?: string[]
    caretDomColumn?: number | null
    caretNativeRectHeight?: number | null
    cellBreakDisplay?: string | null
    /** #213 数据行/分隔行行级 computed background-color（取首个网格数据行
     *  [data-vsidian-table-row="row"]；无表格为 null）。默认透明断言依据。 */
    dataRowLineBackground?: string | null
    gridDisplay: string | null
    cellBorderWidth: string | null
    rowOutlineColor: string | null
    rowOutlineWidth: string | null
    rowBackgroundColor: string | null
    columnBorderColor: string | null
    columnBorderWidth: string | null
    columnRightBorderWidth: string | null
    columnTopBorderWidth: string | null
    columnBottomBorderWidth: string | null
    columnBackgroundColor: string | null
    regionCellCount?: number
    regionBackgroundColor?: string | null
    regionTopBorderWidth?: string | null
    regionLeftBorderWidth?: string | null
  }
  /** #59 公式绘制：当前激活视图内首个公式的实际可见性与计数。
   *  jsdom 无布局（rect 恒 0），visible 恒 false，只作真宿主集成断言依据；
   *  live 态探 live 侧 .vsidian-math，reading 态探阅读容器（另一侧
   *  display:none 的 rect 全 0，不作依据）。无公式时整个字段缺省。 */
  math?: {
    /** 首个公式的 rect 有面积且 elementFromPoint 命中其所在容器 */
    visible: boolean
    /** 该公式外层 computed display（'none' = 未绘制） */
    display: string | null
    /** 当前激活视图内 .vsidian-math / .vsidian-math-error 元素数 */
    count: number
  }
  /** #60 Mermaid 图绘制：当前激活视图内图表容器的实际可见性与分态计数。
   *  jsdom 无布局（rect 恒 0），visible 恒 false，只作真宿主集成断言依据；
   *  live 态探 live 侧 .vsidian-mermaid，reading 态探阅读容器。无图时缺省。 */
  mermaid?: {
    /** 视口与裁切祖先交集内，至少一张 SVG 的可见图形子节点被命中 */
    visible: boolean
    /** 首个图表容器 computed display（'none' = 未绘制） */
    display: string | null
    /** state=rendered（内含 SVG）的容器数 */
    rendered: number
    /** state=error（降级态）的容器数 */
    error: number
    /** 当前激活视图内 .vsidian-mermaid 容器总数 */
    count: number
  }
  /** #106 分割线绘制：当前激活视图内渲染态横线的实际可见性与计数。可见性
   *  口径 = 任一候选命中（首个候选可能滚出视口，取首条会把「新分割线已
   *  绘制」误判为不可见，hr.md 插入用例实测）；display/backgroundImage/
   *  borderTopWidth 取该命中元素，全不命中时取首条供字段观测。jsdom 无
   *  布局（rect 恒 0），visible 恒 false，只作真宿主集成断言依据；live
   *  态探渲染 widget .vsidian-hr（光标触及该行时源码显形、计数归零），
   *  reading 态探阅读容器内原生 <hr>。无分割线时整个字段缺省。 */
  hr?: {
    /** 任一横线元素的 rect 有面积且 elementFromPoint 命中 */
    visible: boolean
    /** 该横线元素 computed display（'none' = 未绘制） */
    display: string | null
    /** computed background-image（live 态横线以居中渐变落笔，'none' = 未绘制） */
    backgroundImage: string | null
    /** computed border-top-width（reading 态原生 <hr> 以 border-top 落笔） */
    borderTopWidth: string | null
    /** 当前激活视图内横线元素总数 */
    count: number
  }
  /** #105 高亮绘制：当前激活视图内高亮元素的实际可见性与计数（可见性
   *  口径 = 任一候选命中，同 hr 探针；字段取该命中元素，全不命中时取
   *  首条供观测）。live 态探 .vsidian-highlight span，reading 态探 mark。
   *  backgroundColor 证明底色真实画出（'rgba(0, 0, 0, 0)' = 透明，样式
   *  注入失效的信号）；delimitersHidden 为 live 态 == 定界符隐藏观测
   *  （激活视口文本不含 == 且高亮 span 存在——文本口径不依赖布局，
   *  jsdom 同样成立），reading 态该字段 null（定界符天然不进渲染产物）。
   *  无高亮时整个字段缺省。 */
  highlight?: {
    /** 任一高亮元素的 rect 有面积且 elementFromPoint 命中 */
    visible: boolean
    /** 该元素 computed display（'none' = 未绘制） */
    display: string | null
    /** 该元素 computed background-color */
    backgroundColor: string | null
    /** 当前激活视图内高亮元素数 */
    count: number
    /** live 态：视口内源文 == 已被隐藏装饰移除（false = 光标触及显形中） */
    delimitersHidden: boolean | null
  }
  /** #111 图形化代码块按钮组与图表弹窗绘制：当前激活视图内 frame/按钮
   *  计数与浮层状态（按钮显隐由 CSS 悬停承担，此处观测 DOM 在场与
   *  渲染成功态联动；浮层覆盖为真实绘制断言依据）。无图形块时缺省。 */
  graphic?: {
    /** 当前激活视图内 .vsidian-graphic-frame 数 */
    frames: number
    /** edit 按钮数（仅 live 视图发射；阅读恒 0） */
    editButtons: number
    /** popup 按钮数（两视图均发射） */
    popupButtons: number
    /** 图表弹窗浮层在场（document 级单例） */
    overlay: boolean
    /** 浮层实际遮蔽正文：backdrop 几何中心被浮层子树占据且可见（jsdom
     *  无布局恒 false，真宿主集成断言依据，与 mermaid.visible 同口径） */
    overlayVisible: boolean
    /** 浮层内 SVG 已装载 */
    overlaySvg: boolean
  }
  /** #212 图片按钮组与图片弹窗绘制：图片挂载的同款 chrome（live 槽位内
   *  与阅读 frame 内，排除链接内嵌/表格内不发射形态）与图片弹窗浮层
   *  状态（document 级单例，与图表弹窗互斥）。计数只统计 loaded 态图片
   *  （规格语义「loaded 态才有按钮」；loading/error 的 frame 类在场但
   *  不计）。无图片时缺省。 */
  imageChrome?: {
    /** 当前激活视图内 loaded 图片的按钮组宿主数 */
    frames: number
    /** edit 按钮数（仅 live 视图发射；阅读恒 0） */
    editButtons: number
    /** popup 按钮数（两视图均发射） */
    popupButtons: number
    /** 图片弹窗浮层在场 */
    overlay: boolean
    /** 浮层实际遮蔽正文（jsdom 无布局恒 false，真宿主集成断言依据） */
    overlayVisible: boolean
    /** 浮层内图片已装载（img 元素在场且 loaded 态） */
    overlayImgLoaded: boolean
  }
  /** #89 快速操作条的真实绘制、流内布局与已应用态。 */
  quickActions?: {
    open: boolean
    togglePainted: boolean
    barPainted: boolean
    boldPainted: boolean
    activePainted: boolean
    menuPainted: boolean
    barBelowToolbar: boolean
    editorBelowBar: boolean
  }
  /** #79 代码块卡片绘制：当前激活视图内卡片头部横带的实际可见性与计数。
   *  jsdom 无布局（rect 恒 0），visible 恒 false，只作真宿主集成断言依据；
   *  live 态探 live 侧头部 widget，reading 态探阅读容器（#84 起同源类名）。
   *  无卡片（设置关闭/无围栏）时整个字段缺省。 */
  code?: {
    /** 首个头部横带的 rect 有面积且 elementFromPoint 命中 */
    visible: boolean
    /** 首个头部横带 computed display（'none' = 未绘制） */
    display: string | null
    /** 首个头部语言标签文本（如 'JavaScript'；无头部时 null） */
    label: string | null
    /** 当前激活视图内 .vsidian-code-card-header 头部数 */
    headerCount: number
    /** 当前激活视图内 .vsidian-code-card-line 行数（含被清空的围栏行） */
    cardLineCount: number
    /** #80 视口内卡内行号文本序列（如 ['1','2','3']；关闭或无行为 null） */
    lineNumberTexts?: string[] | null
    /** #81 呈现态复制按钮在场数（编辑态同样常驻，收起态不发射） */
    copyCount?: number
    /** #82 视口内收起态头部数（chevron -collapsed 计数） */
    foldedCount?: number
    /** #83 视口内 tok-* token 元素数（高亮关闭或无引擎语言为 0） */
    tokenCount?: number
    /** 全部头部语言标签序列（DOM 顺序；渲染型围栏接入后断言 Mermaid 标签在场） */
    labels?: string[]
  }
  /** frontmatter 卡片绘制观测（折叠链路）：当前激活视图内标题栏在场时
   *  提供——rowCount 键值行数（收起态归零）、foldedCount 收起态 chevron
   *  数、editCount 修改按钮数（收起态不发射）、cardFoldedCount live
   *  收起首行类数、tableFoldedCount 阅读收起表格类数 */
  fm?: {
    rowCount: number
    foldedCount: number
    editCount: number
    cardFoldedCount: number
    tableFoldedCount: number
  }
  /** #55 标题行绘制观测：视口内已挂载的 .vsidian-heading-inview 行的
   *  distinct 计算值（box-shadow 应为 'none'、border-left-width 应为
   *  '0px'——标题行不得绘制左缘竖线）；无挂载标题行为 null。
   *  jsdom 无 CSS 引擎，值不可作单测断言依据（同 textVisible 口径） */
  heading?: {
    inviewCount: number
    boxShadowValues: string[]
    borderLeftWidthValues: string[]
  } | null
  /** #183 统一右键菜单绘制：浮层在场（瞬态挂载）时的实际可见性
   *  （elementFromPoint 命中——样式注入失效时 DOM 在场但命中失败）、
   *  分组线与置灰计数（安全降级矩阵的绘制层证据）；菜单关闭时缺省。
   *  jsdom 无布局恒 false，只作真宿主集成断言依据 */
  contextMenu?: {
    visible: boolean
    display: string | null
    separatorCount: number
    disabledCount: number
  }
}

/** #32 排版一致性探针：正文基础排版四项样本（null = 元素缺失/不可读） */
export interface TypographySample {
  /** computed font-family（浏览器归一化串） */
  fontFamily: string | null
  fontSizePx: number | null
  /** computed line-height 换算 px；'normal'（未解析为长度）为 null */
  lineHeightPx: number | null
  /** 正文文本左缘相对滚动容器左缘（几何口径，含中间层 padding/border；
   *  display:none 侧 rect 全 0，不可作断言依据——各模式态取各自激活侧） */
  textInsetPx: number | null
}

/** #32 排版一致性探针：继承型元素样本（列表/引用/表格——行高与缩进属
 *  各自语义，只对照字体族与字号） */
export interface TypographyInheritSample {
  fontFamily: string | null
  fontSizePx: number | null
}

/** #32 排版一致性探针（view.state 可选字段）：两模式基础排版对照采样。
 *  各侧样本只在对应模式激活态断言（隐藏侧几何口径 textInsetPx 无意义）。 */
export interface TypographyProbe {
  /** live 正文：.cm-content（scroller 基线字体作用面，视口常驻） */
  live: TypographySample | null
  /** reading 正文：首个阅读块内段落（虚拟化下须已挂载） */
  reading: TypographySample | null
  liveList: TypographyInheritSample | null
  readingList: TypographyInheritSample | null
  liveQuote: TypographyInheritSample | null
  readingQuote: TypographyInheritSample | null
  liveTable: TypographyInheritSample | null
  readingTable: TypographyInheritSample | null
}

/** live 侧语法装饰统计（#8：装饰集合计数，覆盖标题/行内/块级/任务/降级观测） */
export interface LiveSyntaxProbe {
  /** 标题行数（#5 类） */
  headingLines: number
  /** 标题内容 span 数 */
  headerSpans: number
  strongSpans: number
  emphasisSpans: number
  inlineCodeSpans: number
  quoteLines: number
  codeLines: number
  listLines: number
  hrLines: number
  frontmatterLines: number
  /** 任务字形数与其中勾选数 */
  taskGlyphs: number
  taskChecked: number
  /** #12：表格行装饰数（表头+分隔+数据行） */
  tableLines: number
  /** #12：单元格内容 mark 数 */
  tableCells: number
}

/** reading 侧渲染语义统计（#8：DOM 级计数，用于双视图一致性对拍） */
export interface ReadingSyntaxProbe {
  headings: number
  strongCount: number
  emphasisCount: number
  inlineCodeCount: number
  blockquoteBlocks: number
  codeBlocks: number
  hrCount: number
  listItems: number
  taskCheckboxes: number
  taskChecked: number
  /** #12：表格元素数（块级 table 标签；虚拟化下仅统计已挂载块） */
  tables: number
}

/** 查找会话观测（#14；#236 起三开关与替换栏）：匹配集来自 webview 全文
 *  文本模型（屏外内容同样计数）；三开关与替换栏展开态随会话回报 */
export interface FindSessionProbe {
  /** 面板当前是否打开（关闭后仍回报 open:false） */
  open: boolean
  query: string
  /** 三开关（#236，单一事实源见 shared/findOptions）：matchCase 区分大小写 */
  matchCase: boolean
  wholeWord: boolean
  regexp: boolean
  /** 查询有效性（正则语法；非法时无匹配，面板有可见反馈） */
  valid: boolean
  /** 在选定内容中查找开启态（#241 资产接线：面板局部、非持久化，关闭
   *  面板或进入阅读即复位；旧 webview 缺省） */
  inSelection?: boolean
  /** 替换栏展开态（替换为 Live 编辑能力，阅读模式恒 false） */
  replaceOpen: boolean
  /** 匹配总数（文本模型全量计算） */
  total: number
  /** 当前匹配序号（1 基；无匹配为 0） */
  index: number
  /** 当前匹配区间（UTF-16 offset；无匹配为 null） */
  currentFrom: number | null
  currentTo: number | null
}

/** #238「选下一处相同词」会话观测：查找选项条在场态（= 会话在场）与
 *  三开关按钮态（与 findOptions 单一事实源同源——显示的是面板开关记忆
 *  档，会话 override 档不在此暴露） */
export interface OccurrenceProbe {
  /** 查找选项条是否在场（会话存续；主面板打开时恒 false——面板开关闪烁
   *  承担选项提示） */
  barOpen: boolean
  matchCase: boolean
  wholeWord: boolean
  regexp: boolean
}

/**
 * 右侧栏观测（#53）：布局态与绘制层证据。命中类字段（*Painted）走
 * elementFromPoint——侧栏/按钮只有真实绘制（非 display:none、非零尺寸、
 * 无覆盖遮挡）时才可能命中，几何或存在性探针测不出样式失效；线宽字段
 * 是 computed stroke-width 文本（图标两态粗细差异的唯一来源是样式表的
 * vsidian-sidebar-open 类规则）。jsdom 无布局与 CSS 引擎：命中恒 false、
 * 线宽/宽度容错为 null，真宿主断言见集成。
 */
export interface SidebarProbe {
  /** 侧栏展开态（状态机实值） */
  open: boolean
  /** 侧栏顶栏中心点 elementFromPoint 命中侧栏容器（展开态的绘制证据） */
  sidebarToolbarPainted: boolean
  /** 侧栏切换按钮中心点命中按钮自身（按钮真实可见且可点） */
  togglePainted: boolean
  /** 齿轮设置按钮中心点命中自身（图标化入口真实可见） */
  settingsPainted: boolean
  /** 切换图标竖线 computed stroke-width（收起细线 1.5px / 展开粗线 3px） */
  toggleBarStrokeWidth: string | null
  /** 切换图标外框 computed stroke-width（两态恒定对照） */
  toggleFrameStrokeWidth: string | null
  /** 主编辑区内容宽度 px（收起=全宽；展开=随侧栏收缩）；无布局为 null */
  mainWidthPx: number | null
  /** 侧栏宽度 px（收起时元素不占位为 0）；无布局为 null */
  sidebarWidthPx: number | null
  /** 拖宽句柄中心点命中自身（左缘热区真实可见可拖；收起态被裁切时命中失败） */
  resizerPainted: boolean
  /** 切换按钮可访问名称（状态一致性观测：随收起/展开变化） */
  toggleAriaLabel: string | null
  /** 齿轮设置按钮可访问名称 */
  settingsAriaLabel: string | null
}

/** #65 大纲条目行内标记类型（白名单 = 正文已支持的行内标记子集；
 *  #105 起高亮接入；公式/行内颜色待正文支持后按同一机制接入） */
export type OutlineSpanKind = 'strong' | 'emphasis' | 'code' | 'strike' | 'highlight'

/** #65 大纲条目行内标记区间：kind + plainText 内偏移（start 含、end 不含） */
export interface OutlineSpanInfo {
  kind: OutlineSpanKind
  start: number
  end: number
}

/**
 * 大纲观测（#54）：面板态与绘制层证据。命中类字段（*Painted）走
 * elementFromPoint——面板只有真实绘制（侧栏展开 + 面板 active + 样式表
 * 显隐规则生效）时才可能命中，样式失效（如 CSP 拦截注入）时 DOM 存在但
 * 命中失败。items 是全文标题序列（数据源 = CM6 全文解析，含未保存编辑；
 * 与视口渲染和 live/reading 模式无关）。#65 起 items 携带行内样式透传
 * 信息（plainText 剥标记可见文本 + spans 白名单标记区间），style 为
 * 条目与标记 span 的 computed 字重/字体族/颜色（绘制层证据；jsdom 无
 * CSS 引擎时字段为 null，真宿主断言见集成）。jsdom 无布局与 CSS 引擎：
 * 命中恒 false，名称容错为 null（probe 未装配时字段缺省）。
 */
export interface OutlineProbe {
  /** 大纲面板 active 态（状态机实值；侧栏收起时面板同样不可见） */
  active: boolean
  /** 大纲按钮中心点 elementFromPoint 命中自身（侧栏展开 + 按钮真实绘制） */
  togglePainted: boolean
  /** 大纲面板容器中心点命中面板内（面板内容真实绘制，非 display:none） */
  panelPainted: boolean
  /** 大纲按钮图标 computed 宽度 px（预期 16px：选择器写错或样式失效时
   *  SVG 回退默认尺寸溢出按钮盒，可测出死选择器回归） */
  toggleIconSizePx: number | null
  /** 大纲面板 scrollHeight px（内容总高；无布局环境为 0 或 null） */
  panelScrollHeightPx: number | null
  /** 大纲面板 clientHeight px（可视高；scrollHeight > clientHeight 即
   *  面板高度被宿主约束且内容溢出——overflow-y:auto 由此激活滚动） */
  panelClientHeightPx: number | null
  /** 全文标题序列（级别 1–6 / 原文 / 剥标记可见文本 / 标记区间 / 起始行 1 基） */
  items: Array<{
    level: number
    text: string
    plainText: string
    spans: OutlineSpanInfo[]
    line: number
  }>
  /** 大纲按钮可访问名称 */
  toggleAriaLabel: string | null
  /** 大纲面板可访问名称（role=region + aria-label） */
  panelAriaLabel: string | null
  /** #65 样式透传绘制证据（computed）：条目常规字重与显式标记加重的对照、
   *  行内代码等宽字体族、条目层级色与正文标题层级色的同源对照 */
  style?: {
    itemFontWeight: string | null
    strongFontWeight: string | null
    codeFontFamily: string | null
    itemFontFamily: string | null
    itemColor: string | null
    headingColor: string | null
  }
  /** #66 当前控制域条目索引（items 下标；null = 无标题、首标题之前或
   *  无布局环境）。以视口顶部行向上最近标题为准（locateOutlineIndex）。
   *  #67 起条目可能被折叠遮蔽：本字段仍回报真实控制域索引，高亮实际
   *  施加在可见代表上（被遮蔽时为第一个可见祖先） */
  locatedItemIndex: number | null
  /** located 条目的文字（locatedItemIndex 的冗余可读形态；null 同上） */
  locatedText: string | null
  /** 高亮横条绘制证据（#66）：located 条目中心点 elementFromPoint 命中
   *  自身且 computed background-color 非全透明（半透明横条真实绘制；
   *  条目在面板可视区外或 jsdom 无布局时为 false） */
  locatedPainted: boolean
  /** #67 展开档位实值（0=No-Expand、1–5=展开到 H1–H5；经 bridge state
   *  全局记忆，跨文档共享） */
  expandLevel: number
  /** #67 当前可见条目索引序列（折叠遮蔽后的用户实际可见集；空文档为空
   *  数组——折叠可见性断言的权威口径） */
  visibleIndices: number[]
  /** #67 滑块行绘制证据：elementFromPoint 命中滑块容器（侧栏展开 +
   *  面板 active + 样式表显隐规则生效；jsdom 无布局恒 false） */
  sliderPainted: boolean
  /** #67 当前档圆点绘制证据：命中 active 圆点且 computed 背景非全透明
   *  （实心珠真实绘制——串珠两态差异来源的绘制层验证） */
  sliderActiveDotPainted: boolean
  /** #67 折叠箭头绘制证据：首个箭头中心点命中自身（有子项条目的箭头
   *  真实绘制；无标题/无子项文档或 jsdom 无布局时为 false） */
  chevronPainted: boolean
  /** #68 当前搜索词（工具条输入框实值；空串 = 无过滤） */
  searchQuery: string
  /** #68 搜索态（searchQuery 非空；搜索关闭时过滤口径为恒真） */
  searchActive: boolean
  /** #68 组合可见口径的条目索引序列（折叠可见 ∩ 搜索保留；搜索关闭时
   *  与 visibleIndices 同值——用户实际可见集的权威口径） */
  filteredVisibleIndices: number[]
  /** #68 工具条行绘制证据：elementFromPoint 命中工具条容器（侧栏展开 +
   *  面板 active + 样式表显隐规则生效；jsdom 无布局恒 false） */
  toolbarPainted: boolean
  /** #68 跳转到末尾按钮可访问名称 */
  jumpBottomAriaLabel: string | null
  /** #68 重置按钮可访问名称 */
  resetAriaLabel: string | null
  /** #68 搜索框 placeholder 文案（「输入以搜索」） */
  searchPlaceholder: string | null
  /** #68 命中片段绘制证据：首个可见条目内的 mark 中心点命中自身且
   *  computed 背景非全透明（片段高亮真实绘制；无搜索/无命中或 jsdom
   *  无布局时为 false） */
  searchHitPainted: boolean
  /** #68 无匹配占位绘制证据：占位元素中心点命中自身（有词条零命中的
   *  「无匹配」真实可见；无占位或 jsdom 无布局时为 false） */
  nomatchPainted: boolean
  /** #69 右键菜单打开态（菜单容器在侧栏内挂载） */
  menuOpen: boolean
  /** #69 菜单目标条目索引（items 下标；未打开为 null） */
  menuTargetIndex: number | null
  /** #69 菜单容器中心点 elementFromPoint 命中自身（菜单真实绘制；
   *  jsdom 无布局恒 false，真宿主断言见集成） */
  menuPainted: boolean
  /** #69 级联子菜单可见证据：任一子菜单 computed display 非 none
   *  （hover/focus-within 展开；未展开或 jsdom 恒 false） */
  submenuVisible: boolean
  /** #69 重命名编辑态：正在行内编辑的条目索引（null = 无编辑态） */
  renamingIndex: number | null
  /** #70 拖拽态：正在拖拽的源条目索引（null = 无拖拽） */
  draggingIndex: number | null
  /** #70 当前有效落点目标索引（null = 未悬停在条目上或落点无效——
   *  拖入自身控制域内部不显示落点） */
  dropTargetIndex: number | null
  /** #70 落点三态（dropTargetIndex 非空时的位置语义；null = 无有效落点） */
  dropPosition: 'before' | 'after' | 'inside' | null
  /** #70 落点指示绘制证据：带指示类的条目中心点命中自身且 computed
   *  插入线（box-shadow）或包裹高亮（outline/背景）可读（真实绘制；
   *  无拖拽或 jsdom 无布局时 false，真宿主断言见集成） */
  dropHintPainted: boolean
}

/**
 * 反链面板观测（#197）：面板态、四态实值与绘制层证据。命中类字段
 * （*Painted）走 elementFromPoint——面板只有真实绘制（侧栏展开 + 面板
 * active + 显隐样式规则生效）时才可能命中，DOM 存在性探不出样式失效。
 * items 为面板当前条目的可观测摘要（来源 + 行号 + 片段），与
 * backlinks.snapshot 的载荷对齐；jsdom 无布局与 CSS 引擎：命中恒 false，
 * 真宿主断言见集成。
 */
export interface BacklinksProbe {
  /** 反链面板 active 态（状态机实值；与大纲面板互斥） */
  active: boolean
  /** 反链按钮中心点 elementFromPoint 命中自身（侧栏展开 + 按钮真实绘制） */
  togglePainted: boolean
  /** 反链面板容器中心点命中面板内（面板内容真实绘制，非 display:none） */
  panelPainted: boolean
  /** 面板当前四态实值（loading/ready/error 由最近 snapshot 决定） */
  state: 'loading' | 'ready' | 'error' | 'none'
  /** ready 态的更新中标记（索引重建中，当前为旧数据） */
  updating: boolean
  /** 条目序列摘要（与渲染 DOM 同序；空列表 = 无引用或非 ready 态） */
  items: Array<{ sourceRelPath: string; kind: BacklinkItemPayload['kind']; line: number; snippet: string }>
  /** 首个条目中心点命中自身（条目真实绘制且可点击） */
  itemPainted: boolean
  /** 空态占位中心点命中自身（「没有反向链接」真实可见） */
  emptyPainted: boolean
  /** 反链按钮可访问名称 */
  toggleAriaLabel: string | null
  /** 反链面板可访问名称（role=region + aria-label） */
  panelAriaLabel: string | null
  /** 面板视图状态摘要（形态改版批次：排序/搜索/折叠/更多上下文；旧
   *  webview 缺省） */
  view?: {
    sortMode: string
    query: string
    searchOpen: boolean
    contextLong: boolean
    collapsedCount: number
    /** 当前渲染的卡片数（DOM 层计数——搜索过滤的直接证据；旧 webview 缺省） */
    domCards: number
  }
  /** 工具栏中心点命中自身（形态改版批次；旧 webview 缺省） */
  toolbarPainted?: boolean
  /** 首个命中高亮 mark 中心点命中自身（形态改版批次；旧 webview 缺省） */
  hitPainted?: boolean
  /** 首个命中高亮 mark 的 computed 背景色（形态改版批次；无高亮或 jsdom
   *  无 CSS 引擎为 null）——黄底变量失效（明暗两值）在此暴露 */
  hitBg?: string | null
}

/**
 * 出链面板观测（出链面板批次）：面板态、四态实值与绘制层证据。语义与
 * BacklinksProbe 镜像（elementFromPoint 命中类字段、jsdom 恒 false 等
 * 口径同源，见 BacklinksProbe 注释）；items 为面板当前条目摘要。
 */
export interface OutlinksProbe {
  /** 出链面板 active 态（状态机实值；与大纲/反链面板互斥） */
  active: boolean
  /** 出链按钮中心点 elementFromPoint 命中自身（侧栏展开 + 按钮真实绘制） */
  togglePainted: boolean
  /** 出链面板容器中心点命中面板内（面板内容真实绘制，非 display:none） */
  panelPainted: boolean
  /** 面板当前四态实值（loading/ready/error 由最近 snapshot 决定） */
  state: 'loading' | 'ready' | 'error' | 'none'
  /** ready 态的更新中标记（索引重建中，当前为旧数据） */
  updating: boolean
  /** 条目序列摘要（与渲染 DOM 同序；空列表 = 无出链或非 ready 态） */
  items: Array<{
    targetDisplay: string
    targetRelPath: string | null
    kind: OutlinkItemPayload['kind']
    anchor: string
    resolved: boolean
  }>
  /** 首个条目中心点命中自身（条目真实绘制且可点击） */
  itemPainted: boolean
  /** 空态占位中心点命中自身（「无链接」真实可见） */
  emptyPainted: boolean
  /** 出链按钮可访问名称 */
  toggleAriaLabel: string | null
  /** 出链面板可访问名称（role=region + aria-label） */
  panelAriaLabel: string | null
}

/** 表格结构操作码校验（#13） */
function isTableEditOp(v: unknown): v is TableEditOp {
  return (
    v === 'insertRowAbove' ||
    v === 'insertRowBelow' ||
    v === 'deleteRow' ||
    v === 'insertColumnLeft' ||
    v === 'insertColumnRight' ||
    v === 'deleteColumn'
  )
}

function isFindSessionProbe(v: unknown): v is FindSessionProbe {
  return (
    isObject(v) &&
    typeof v.open === 'boolean' &&
    isString(v.query) &&
    typeof v.matchCase === 'boolean' &&
    typeof v.wholeWord === 'boolean' &&
    typeof v.regexp === 'boolean' &&
    (v.inSelection === undefined || typeof v.inSelection === 'boolean') &&
    typeof v.valid === 'boolean' &&
    typeof v.replaceOpen === 'boolean' &&
    isNonNegativeInt(v.total) &&
    isNonNegativeInt(v.index) &&
    (v.currentFrom === null || isNonNegativeInt(v.currentFrom)) &&
    (v.currentTo === null || isNonNegativeInt(v.currentTo))
  )
}

/** #236 查找选项载荷校验：sanitize 后仍是原值（三布尔齐全）才放行——
 *  set/snapshot 拒绝缺字段或类型不符的载荷（宿主侧持久化前同样清洗） */
function isFindOptions(v: unknown): v is FindOptions {
  if (!isObject(v)) {
    return false
  }
  const cleaned = sanitizeFindOptions(v)
  return (
    typeof v.matchCase === 'boolean' && cleaned.matchCase === v.matchCase &&
    typeof v.wholeWord === 'boolean' && cleaned.wholeWord === v.wholeWord &&
    typeof v.regexp === 'boolean' && cleaned.regexp === v.regexp
  )
}

function isTableGridProbe(v: unknown): boolean {
  return isObject(v) && isNonNegativeInt(v.visibleRows) &&
    typeof v.selectedRowIsGrid === 'boolean' &&
    Array.isArray(v.selectedRowCells) && v.selectedRowCells.every(isString) &&
    isNonNegativeInt(v.rowHandles)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** #33 设置载荷校验：键 → 标量值（boolean/number/string）。协议层只约束
 *  形态（键值对可序列化）；键是否已定义、值是否符合类型语义由
 *  shared/settings 的定义校验判定——两层职责分离 */
function isSettingsPayload(v: unknown): v is SettingsPayload {
  if (!isObject(v)) {
    return false
  }
  for (const key of Object.keys(v)) {
    const value = v[key]
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
      return false
    }
  }
  return true
}

function isNonNegativeInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** #34 行号栏观测校验：on 布尔、count 非负整数、first/last 字符串或 null；
 *  #116 alignment 可缺省（旧 webview）、null 或条目数组（num 字符串 +
 *  deltaBaseline/deltaBottom 数字） */
function isLineGutterProbe(v: unknown): v is LineGutterProbe {
  return (
    isObject(v) &&
    typeof v.on === 'boolean' &&
    isNonNegativeInt(v.count) &&
    (v.first === null || isString(v.first)) &&
    (v.last === null || isString(v.last)) &&
    (v.alignment === undefined || v.alignment === null ||
      (Array.isArray(v.alignment) && v.alignment.every((item) =>
        isObject(item) && isString(item.num) &&
        typeof item.deltaBaseline === 'number' && typeof item.deltaBottom === 'number')))
  )
}

/** #53 右侧栏观测校验：open/命中布尔、线宽与名称字符串或 null、宽度非负数或 null */
function isSidebarProbe(v: unknown): v is SidebarProbe {
  return (
    isObject(v) &&
    typeof v.open === 'boolean' &&
    typeof v.sidebarToolbarPainted === 'boolean' &&
    typeof v.togglePainted === 'boolean' &&
    typeof v.settingsPainted === 'boolean' &&
    isNullOrString(v.toggleBarStrokeWidth) &&
    isNullOrString(v.toggleFrameStrokeWidth) &&
    (v.mainWidthPx === null || isNonNegativeNumber(v.mainWidthPx)) &&
    (v.sidebarWidthPx === null || isNonNegativeNumber(v.sidebarWidthPx)) &&
    isNullOrString(v.toggleAriaLabel) &&
    isNullOrString(v.settingsAriaLabel)
  )
}

/** #65 大纲标记区间校验：白名单 kind + 非负整数偏移 + 区间不倒置 */
function isOutlineSpan(v: unknown): v is OutlineSpanInfo {
  return (
    isObject(v) &&
    (v.kind === 'strong' || v.kind === 'emphasis' || v.kind === 'code' || v.kind === 'strike' ||
      v.kind === 'highlight') &&
    isNonNegativeInt(v.start) &&
    isNonNegativeInt(v.end) &&
    (v.start as number) <= (v.end as number)
  )
}

/** #54/#65 大纲条目序列校验：level 1–6 整数、text/plainText 字符串（可为
 *  空）、spans 白名单区间数组、line 正整数 */
function isOutlineItems(v: unknown): v is OutlineProbe['items'] {
  return (
    Array.isArray(v) &&
    v.every(
      (item) =>
        isObject(item) &&
        typeof item.level === 'number' && Number.isInteger(item.level) &&
        item.level >= 1 && item.level <= 6 &&
        isString(item.text) &&
        isString(item.plainText) &&
        Array.isArray(item.spans) && item.spans.every(isOutlineSpan) &&
        typeof item.line === 'number' && Number.isInteger(item.line) && item.line >= 1,
    )
  )
}

/** #54/#65/#66/#67/#68/#69/#70 大纲观测校验：active/命中布尔、图标尺寸与滚动几何（null 或
 *  非负数）、items 序列、名称字符串或 null、style 绘制证据（缺省或字段字符
 *  串或 null）、located 索引（null 或非负整数）/文字（字符串或 null）/绘制
 *  命中布尔、#67 档位（0–5 整数）/可见索引序列（非负整数数组）/滑块与箭头
 *  绘制命中布尔、#68 搜索词（字符串）/搜索态布尔/组合可见索引序列/工具条
 *  绘制命中布尔/按钮与占位文案（字符串或 null）/命中片段与占位绘制命中布
 *  尔、#69 菜单开合布尔/目标索引（null 或非负整数）/菜单与子菜单绘制布尔/
 *  重命名索引（null 或非负整数）、#70 拖拽源索引与落点目标索引（null 或
 *  非负整数）/落点三态（null 或 before/after/inside）/落点指示绘制布尔 */
function isOutlineProbe(v: unknown): v is OutlineProbe {
  return (
    isObject(v) &&
    typeof v.active === 'boolean' &&
    typeof v.togglePainted === 'boolean' &&
    typeof v.panelPainted === 'boolean' &&
    (v.toggleIconSizePx === null || isNonNegativeNumber(v.toggleIconSizePx)) &&
    (v.panelScrollHeightPx === null || isNonNegativeNumber(v.panelScrollHeightPx)) &&
    (v.panelClientHeightPx === null || isNonNegativeNumber(v.panelClientHeightPx)) &&
    isOutlineItems(v.items) &&
    isNullOrString(v.toggleAriaLabel) &&
    isNullOrString(v.panelAriaLabel) &&
    (v.style === undefined || (
      isObject(v.style) &&
      isNullOrString(v.style.itemFontWeight) &&
      isNullOrString(v.style.strongFontWeight) &&
      isNullOrString(v.style.codeFontFamily) &&
      isNullOrString(v.style.itemFontFamily) &&
      isNullOrString(v.style.itemColor) &&
      isNullOrString(v.style.headingColor)
    )) &&
    (v.locatedItemIndex === null || isNonNegativeInt(v.locatedItemIndex)) &&
    isNullOrString(v.locatedText) &&
    typeof v.locatedPainted === 'boolean' &&
    typeof v.expandLevel === 'number' && Number.isInteger(v.expandLevel) &&
    v.expandLevel >= 0 && v.expandLevel <= 5 &&
    Array.isArray(v.visibleIndices) && v.visibleIndices.every(isNonNegativeInt) &&
    typeof v.sliderPainted === 'boolean' &&
    typeof v.sliderActiveDotPainted === 'boolean' &&
    typeof v.chevronPainted === 'boolean' &&
    isString(v.searchQuery) &&
    typeof v.searchActive === 'boolean' &&
    Array.isArray(v.filteredVisibleIndices) && v.filteredVisibleIndices.every(isNonNegativeInt) &&
    typeof v.toolbarPainted === 'boolean' &&
    isNullOrString(v.jumpBottomAriaLabel) &&
    isNullOrString(v.resetAriaLabel) &&
    isNullOrString(v.searchPlaceholder) &&
    typeof v.searchHitPainted === 'boolean' &&
    typeof v.nomatchPainted === 'boolean' &&
    typeof v.menuOpen === 'boolean' &&
    (v.menuTargetIndex === null || isNonNegativeInt(v.menuTargetIndex)) &&
    typeof v.menuPainted === 'boolean' &&
    typeof v.submenuVisible === 'boolean' &&
    (v.renamingIndex === null || isNonNegativeInt(v.renamingIndex)) &&
    (v.draggingIndex === null || isNonNegativeInt(v.draggingIndex)) &&
    (v.dropTargetIndex === null || isNonNegativeInt(v.dropTargetIndex)) &&
    (v.dropPosition === null || v.dropPosition === 'before' || v.dropPosition === 'after' || v.dropPosition === 'inside') &&
    typeof v.dropHintPainted === 'boolean'
  )
}

/** #69 大纲菜单命令码（菜单结构单一清单：结构命令三/复制五/调级四/
 *  重命名/删除；父项容器 id 不进此列）。webview 的 outlineMenu 与宿主
 *  校验器共用——命令码两边一致性的单一事实源 */
export type OutlineMenuCommand =
  | 'expandRecursively'
  | 'collapseSiblings'
  | 'expandSiblings'
  | 'copyHeading'
  | 'copySiblings'
  | 'copyChildren'
  | 'copyLink'
  | 'copySection'
  | 'levelUp'
  | 'levelUpRecursive'
  | 'levelDown'
  | 'levelDownRecursive'
  | 'rename'
  | 'delete'

/** #69 菜单命令码校验（outline.test.menuClick 只转发合法命令） */
export function isOutlineMenuCommand(v: unknown): v is OutlineMenuCommand {
  return (
    v === 'expandRecursively' || v === 'collapseSiblings' || v === 'expandSiblings' ||
    v === 'copyHeading' || v === 'copySiblings' || v === 'copyChildren' ||
    v === 'copyLink' || v === 'copySection' ||
    v === 'levelUp' || v === 'levelUpRecursive' || v === 'levelDown' || v === 'levelDownRecursive' ||
    v === 'rename' || v === 'delete'
  )
}

/** 绘制层探针校验：textVisible/darkTheme 布尔；display/userSelect/caretColor/
 *  drawnCursorColor 字符串或 null（#237 绘制光标色可缺省） */
function isPaintProbe(v: unknown): v is PaintProbe {
  return (
    isObject(v) &&
    typeof v.textVisible === 'boolean' &&
    isNullOrString(v.scrollerDisplay) &&
    isNullOrString(v.gutterUserSelect) &&
    (v.visibleLineNumbers === undefined || (Array.isArray(v.visibleLineNumbers) &&
      v.visibleLineNumbers.every((number) => typeof number === 'string'))) &&
    typeof v.darkTheme === 'boolean' &&
    isNullOrString(v.caretColor) &&
    (v.drawnCursorColor === undefined || isNullOrString(v.drawnCursorColor)) &&
    (v.readingFindSource === undefined || (isObject(v.readingFindSource) &&
      typeof v.readingFindSource.visible === 'boolean' && isString(v.readingFindSource.text) &&
      isString(v.readingFindSource.current) && isNullOrString(v.readingFindSource.background))) &&
    (v.table === undefined || (
      isObject(v.table) &&
      typeof v.table.cellVisible === 'boolean' &&
      (v.table.caretGridColumn === undefined || v.table.caretGridColumn === null ||
        isNonNegativeInt(v.table.caretGridColumn)) &&
      isNullOrString(v.table.gridDisplay) &&
      (v.table.delimiterDisplay === undefined || isNullOrString(v.table.delimiterDisplay)) &&
      (v.table.headerCellBackgrounds === undefined || (Array.isArray(v.table.headerCellBackgrounds) &&
        v.table.headerCellBackgrounds.every(isString))) &&
      (v.table.caretDomColumn === undefined || v.table.caretDomColumn === null || isNonNegativeInt(v.table.caretDomColumn)) &&
      (v.table.caretNativeRectHeight === undefined || v.table.caretNativeRectHeight === null || isNonNegativeNumber(v.table.caretNativeRectHeight)) &&
      (v.table.cellBreakDisplay === undefined || v.table.cellBreakDisplay === null || isString(v.table.cellBreakDisplay)) &&
      (v.table.dataRowLineBackground === undefined || isNullOrString(v.table.dataRowLineBackground)) &&
      isNullOrString(v.table.cellBorderWidth) &&
      isNullOrString(v.table.rowOutlineColor) &&
      isNullOrString(v.table.rowOutlineWidth) &&
      isNullOrString(v.table.rowBackgroundColor) &&
      isNullOrString(v.table.columnBorderColor) &&
      isNullOrString(v.table.columnBorderWidth) &&
      isNullOrString(v.table.columnRightBorderWidth) &&
      isNullOrString(v.table.columnTopBorderWidth) &&
      isNullOrString(v.table.columnBottomBorderWidth) &&
      isNullOrString(v.table.columnBackgroundColor) &&
      (v.table.regionCellCount === undefined || isNonNegativeInt(v.table.regionCellCount)) &&
      (v.table.regionBackgroundColor === undefined || isNullOrString(v.table.regionBackgroundColor)) &&
      (v.table.regionTopBorderWidth === undefined || isNullOrString(v.table.regionTopBorderWidth)) &&
      (v.table.regionLeftBorderWidth === undefined || isNullOrString(v.table.regionLeftBorderWidth))
    )) &&
    (v.math === undefined || (
      isObject(v.math) &&
      typeof v.math.visible === 'boolean' &&
      isNullOrString(v.math.display) &&
      isNonNegativeInt(v.math.count)
    )) &&
    (v.highlight === undefined || (
      isObject(v.highlight) &&
      typeof v.highlight.visible === 'boolean' &&
      isNullOrString(v.highlight.display) &&
      isNullOrString(v.highlight.backgroundColor) &&
      isNonNegativeInt(v.highlight.count) &&
      (v.highlight.delimitersHidden === undefined || v.highlight.delimitersHidden === null ||
        typeof v.highlight.delimitersHidden === 'boolean')
    )) &&
    (v.graphic === undefined || (
      isObject(v.graphic) &&
      isNonNegativeInt(v.graphic.frames) &&
      isNonNegativeInt(v.graphic.editButtons) &&
      isNonNegativeInt(v.graphic.popupButtons) &&
      typeof v.graphic.overlay === 'boolean' &&
      typeof v.graphic.overlayVisible === 'boolean' &&
      typeof v.graphic.overlaySvg === 'boolean'
    )) &&
    (v.imageChrome === undefined || (
      isObject(v.imageChrome) &&
      isNonNegativeInt(v.imageChrome.frames) &&
      isNonNegativeInt(v.imageChrome.editButtons) &&
      isNonNegativeInt(v.imageChrome.popupButtons) &&
      typeof v.imageChrome.overlay === 'boolean' &&
      typeof v.imageChrome.overlayVisible === 'boolean' &&
      typeof v.imageChrome.overlayImgLoaded === 'boolean'
    )) &&
    (v.mermaid === undefined || (
      isObject(v.mermaid) &&
      typeof v.mermaid.visible === 'boolean' &&
      isNullOrString(v.mermaid.display) &&
      isNonNegativeInt(v.mermaid.rendered) &&
      isNonNegativeInt(v.mermaid.error) &&
      isNonNegativeInt(v.mermaid.count)
    )) &&
    (v.hr === undefined || (
      isObject(v.hr) &&
      typeof v.hr.visible === 'boolean' &&
      isNullOrString(v.hr.display) &&
      isNullOrString(v.hr.backgroundImage) &&
      isNullOrString(v.hr.borderTopWidth) &&
      isNonNegativeInt(v.hr.count)
    )) &&
    (v.quickActions === undefined || (
      isObject(v.quickActions) &&
      typeof v.quickActions.open === 'boolean' &&
      typeof v.quickActions.togglePainted === 'boolean' &&
      typeof v.quickActions.barPainted === 'boolean' &&
      typeof v.quickActions.boldPainted === 'boolean' &&
      typeof v.quickActions.activePainted === 'boolean' &&
      typeof v.quickActions.menuPainted === 'boolean' &&
      typeof v.quickActions.barBelowToolbar === 'boolean' &&
      typeof v.quickActions.editorBelowBar === 'boolean'
    )) &&
    (v.code === undefined || (
      isObject(v.code) &&
      typeof v.code.visible === 'boolean' &&
      isNullOrString(v.code.display) &&
      (v.code.label === undefined || v.code.label === null || isString(v.code.label)) &&
      isNonNegativeInt(v.code.headerCount) &&
      isNonNegativeInt(v.code.cardLineCount) &&
      (v.code.lineNumberTexts === undefined || v.code.lineNumberTexts === null ||
        (Array.isArray(v.code.lineNumberTexts) && v.code.lineNumberTexts.every(isString))) &&
      (v.code.copyCount === undefined || isNonNegativeInt(v.code.copyCount)) &&
      (v.code.foldedCount === undefined || isNonNegativeInt(v.code.foldedCount)) &&
      (v.code.tokenCount === undefined || isNonNegativeInt(v.code.tokenCount)) &&
      (v.code.labels === undefined ||
        (Array.isArray(v.code.labels) && v.code.labels.every(isString)))
    )) &&
    (v.fm === undefined || v.fm === null || (
      isObject(v.fm) &&
      isNonNegativeInt(v.fm.rowCount) &&
      isNonNegativeInt(v.fm.foldedCount) &&
      isNonNegativeInt(v.fm.editCount) &&
      isNonNegativeInt(v.fm.cardFoldedCount) &&
      isNonNegativeInt(v.fm.tableFoldedCount)
    )) &&
    (v.heading === undefined || v.heading === null || (
      isObject(v.heading) &&
      isNonNegativeInt(v.heading.inviewCount) &&
      Array.isArray(v.heading.boxShadowValues) && v.heading.boxShadowValues.every(isString) &&
      Array.isArray(v.heading.borderLeftWidthValues) && v.heading.borderLeftWidthValues.every(isString)
    )) &&
    (v.contextMenu === undefined || (
      isObject(v.contextMenu) &&
      typeof v.contextMenu.visible === 'boolean' &&
      isNullOrString(v.contextMenu.display) &&
      isNonNegativeInt(v.contextMenu.separatorCount) &&
      isNonNegativeInt(v.contextMenu.disabledCount)
    ))
  )
}

/** #32 排版样本校验：字体族字符串或 null、字号/行高/几何 inset 非负数或 null */
function isTypographySample(v: unknown): v is TypographySample {
  return (
    isObject(v) &&
    isNullOrString(v.fontFamily) &&
    (v.fontSizePx === null || isNonNegativeNumber(v.fontSizePx)) &&
    (v.lineHeightPx === null || isNonNegativeNumber(v.lineHeightPx)) &&
    (v.textInsetPx === null || isNonNegativeNumber(v.textInsetPx))
  )
}

function isTypographyInheritSample(v: unknown): v is TypographyInheritSample {
  return (
    isObject(v) &&
    isNullOrString(v.fontFamily) &&
    (v.fontSizePx === null || isNonNegativeNumber(v.fontSizePx))
  )
}

/** #32 排版一致性探针校验：八个采样位各为 null（元素缺失/不可读）或合法样本 */
function isTypographyProbe(v: unknown): v is TypographyProbe {
  return (
    isObject(v) &&
    (v.live === null || isTypographySample(v.live)) &&
    (v.reading === null || isTypographySample(v.reading)) &&
    (v.liveList === null || isTypographyInheritSample(v.liveList)) &&
    (v.readingList === null || isTypographyInheritSample(v.readingList)) &&
    (v.liveQuote === null || isTypographyInheritSample(v.liveQuote)) &&
    (v.readingQuote === null || isTypographyInheritSample(v.readingQuote)) &&
    (v.liveTable === null || isTypographyInheritSample(v.liveTable)) &&
    (v.readingTable === null || isTypographyInheritSample(v.readingTable))
  )
}

function isPositiveInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isString(v: unknown): boolean {
  return typeof v === 'string'
}

/** #161 图片粘贴 base64 形态（严格 base64；与 diagramExportValidate 同式，
 *  该常量归协议层因校验在此侧发生） */
const BASE64_STRICT = /^[A-Za-z0-9+/]+={0,2}$/

/** 非负数值（含小数）：滚动位置/元素位置等亚像素观测量 */
function isNonNegativeNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export function isSerChange(v: unknown): v is SerChange {
  return (
    isObject(v) &&
    isNonNegativeInt(v.offset) &&
    isNonNegativeInt(v.length) &&
    isString(v.text)
  )
}

function isPasteSelection(v: unknown): v is PasteSelection {
  if (!isObject(v) || !Array.isArray(v.ranges) || v.ranges.length === 0 || v.ranges.length > 1000 ||
      typeof v.mainIndex !== 'number' || !isNonNegativeInt(v.mainIndex) || v.mainIndex >= v.ranges.length) return false
  return v.ranges.every(r => isObject(r) && isNonNegativeInt(r.anchor) && isNonNegativeInt(r.head))
}

function isPasteStage(v: unknown): v is PasteStage {
  return isObject(v) && typeof v.group === 'string' && v.group.length > 0 && v.group.length <= 128 &&
    (v.stage === 'text' || v.stage === 'format' || v.stage === 'single') &&
    typeof v.hasTextStep === 'boolean' && isPasteSelection(v.before) && isPasteSelection(v.after)
}

function isSerChangeArray(v: unknown): v is SerChange[] {
  return Array.isArray(v) && v.every(isSerChange)
}

/** #15：可选 JS 堆读数字段——缺省（旧探针）或 null（环境不支持）均合法，非正整数拒绝 */
function isOptionalJsHeap(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v > 0)
}

function isPerfSnapshot(v: unknown): v is PerfSnapshot {
  return (
    isObject(v) &&
    isNonNegativeInt(v.renderedLines) &&
    isNonNegativeInt(v.contentDomCount) &&
    isNonNegativeInt(v.headingLineCount) &&
    isNonNegativeInt(v.inviewHeadingCount) &&
    isOptionalJsHeap(v.jsHeapBytes)
  )
}

function isNullOrString(v: unknown): boolean {
  return v === null || isString(v)
}

/** #129 snippets.state.rejections 形态守卫 */
function isCssSnippetRejectionMap(v: unknown): v is Record<string, unknown> {
  return (
    isObject(v) &&
    Object.entries(v).every(
      ([name, item]) =>
        name.length > 0 &&
        isObject(item) &&
        (item.reason === 'path-escape' || item.reason === 'symlink-escape') &&
        isString(item.path),
    )
  )
}

function isCssProbeReport(v: unknown): v is CssProbeReport {
  return (
    isObject(v) &&
    isNullOrString(v.liveHeadingDecorationColor) &&
    isNullOrString(v.readingHeadingDecorationColor) &&
    isNullOrString(v.readingVarProbe) &&
    isNullOrString(v.liveStrongDecorationColor) &&
    isNullOrString(v.liveInlineCodeDecorationColor) &&
    isNullOrString(v.liveHtmlCommentDecorationColor) &&
    isNullOrString(v.liveCodeLineDecorationColor) &&
    isNullOrString(v.readingStrongDecorationColor) &&
    isNullOrString(v.liveTaskCheckboxDecorationColor) &&
    isNullOrString(v.readingTaskCheckboxDecorationColor) &&
    isNullOrString(v.liveLinkDecorationColor) &&
    isNullOrString(v.readingLinkDecorationColor) &&
    isNullOrString(v.readingImageDecorationColor) &&
    isNullOrString(v.liveTablePipeDecorationColor) &&
    isNullOrString(v.readingTableDecorationColor) &&
    isNullOrString(v.liveWikilinkDecorationColor) &&
    isNullOrString(v.readingWikilinkDecorationColor) &&
    (v.liveMathFontFamily === undefined || isNullOrString(v.liveMathFontFamily)) &&
    (v.readingMathFontFamily === undefined || isNullOrString(v.readingMathFontFamily)) &&
    (v.documentFonts === undefined ||
      v.documentFonts === null ||
      (isObject(v.documentFonts) &&
        Number.isInteger(v.documentFonts.total) &&
        (v.documentFonts.total as number) >= 0 &&
        Number.isInteger(v.documentFonts.loaded) &&
        (v.documentFonts.loaded as number) >= 0)) &&
    (v.readingBackgroundImage === undefined || isNullOrString(v.readingBackgroundImage)) &&
    (v.obsidianAliases === undefined ||
      (isObject(v.obsidianAliases) &&
        Object.entries(v.obsidianAliases).every(([k, val]) => k.length > 0 && isNullOrString(val)))) &&
    (v.obsidianVarProbe === undefined ||
      (isObject(v.obsidianVarProbe) && isNullOrString(v.obsidianVarProbe.liveHeadingColor) &&
        isNullOrString(v.obsidianVarProbe.readingHeadingColor))) &&
    (v.chromeSelectors === undefined ||
      (isObject(v.chromeSelectors) &&
        Object.entries(v.chromeSelectors).every(([k, val]) => k.length > 0 && isNullOrString(val)))) &&
    (v.chromePaint === undefined ||
      (isObject(v.chromePaint) &&
        isNullOrString(v.chromePaint.mathKatexColor) &&
        isNullOrString(v.chromePaint.codeCardLabelColor) &&
        isNullOrString(v.chromePaint.tokKeywordColor) &&
        isNullOrString(v.chromePaint.mermaidContainerColor) &&
        isNullOrString(v.chromePaint.outlineLevel1Color))) &&
    (v.chromePopup === undefined ||
      v.chromePopup === null ||
      (isObject(v.chromePopup) &&
        isNullOrString(v.chromePopup.toolbarColor) &&
        isNullOrString(v.chromePopup.stageColor)))
  )
}

function isImageStateCounts(v: unknown): v is ImageStateCounts {
  return (
    isObject(v) &&
    isNonNegativeInt(v.loading) &&
    isNonNegativeInt(v.loaded) &&
    isNonNegativeInt(v.error)
  )
}

function isImageSlotProbe(v: unknown): v is ImageSlotProbe {
  return (
    isObject(v) &&
    isNullOrString(v.src) &&
    (v.naturalWidth === null || isNonNegativeInt(v.naturalWidth)) &&
    (v.state === 'loading' || v.state === 'loaded' || v.state === 'error')
  )
}

function isLiveSyntaxProbe(v: unknown): v is LiveSyntaxProbe {
  return (
    isObject(v) &&
    isNonNegativeInt(v.headingLines) &&
    isNonNegativeInt(v.headerSpans) &&
    isNonNegativeInt(v.strongSpans) &&
    isNonNegativeInt(v.emphasisSpans) &&
    isNonNegativeInt(v.inlineCodeSpans) &&
    isNonNegativeInt(v.quoteLines) &&
    isNonNegativeInt(v.codeLines) &&
    isNonNegativeInt(v.listLines) &&
    isNonNegativeInt(v.hrLines) &&
    isNonNegativeInt(v.frontmatterLines) &&
    isNonNegativeInt(v.taskGlyphs) &&
    isNonNegativeInt(v.taskChecked) &&
    isNonNegativeInt(v.tableLines) &&
    isNonNegativeInt(v.tableCells)
  )
}

function isReadingSyntaxProbe(v: unknown): v is ReadingSyntaxProbe {
  return (
    isObject(v) &&
    isNonNegativeInt(v.headings) &&
    isNonNegativeInt(v.strongCount) &&
    isNonNegativeInt(v.emphasisCount) &&
    isNonNegativeInt(v.inlineCodeCount) &&
    isNonNegativeInt(v.blockquoteBlocks) &&
    isNonNegativeInt(v.codeBlocks) &&
    isNonNegativeInt(v.hrCount) &&
    isNonNegativeInt(v.listItems) &&
    isNonNegativeInt(v.taskCheckboxes) &&
    isNonNegativeInt(v.taskChecked) &&
    isNonNegativeInt(v.tables)
  )
}

function isReadingPerfSnapshot(v: unknown): v is ReadingPerfSnapshot {
  return (
    isObject(v) &&
    isNonNegativeInt(v.mountedBlocks) &&
    isNonNegativeInt(v.contentDomCount) &&
    isNonNegativeNumber(v.scrollTopPx) &&
    isNonNegativeNumber(v.scrollHeightPx) &&
    isOptionalJsHeap(v.jsHeapBytes)
  )
}

/** 宿主侧校验 webview 消息；非法消息必须整体丢弃，不部分读取字段 */
/** #111 图表导出请求载荷（宿主侧消费的子集形态） */
export type DiagramExportPayload = Extract<WebviewToHost, { kind: 'diagram.export' }>

/** #111 图表导出失败原因（cancelled=用户取消另存为对话框） */
export type DiagramExportFailReason = 'cancelled' | 'invalid' | 'writeFailed'

/** #161 图片粘贴载荷上限（单一事实源；协议校验与宿主防御共用） */
export const IMAGE_PASTE_LIMITS = {
  /** dataBase64 上限（字符；约 12MB 二进制，与 diagram.export PNG 档同量级） */
  dataBase64MaxChars: 16_000_000,
  /** fileNameHint 上限（字符；清洗/时间戳名不受此限） */
  fileNameHintMaxChars: 255,
} as const

/** #161 图片粘贴请求载荷（宿主侧消费形态） */
export type ImagePastePayload = Extract<WebviewToHost, { kind: 'image.paste' }>

/** #161 图片粘贴失败原因（invalid-location=目录非法；write-failed=写盘；invalid=载荷） */
export type ImagePasteFailReason = 'invalid-location' | 'write-failed' | 'invalid'

/** #212 图片导出请求载荷（宿主侧消费形态） */
export type ImageExportPayload = Extract<WebviewToHost, { kind: 'image.export' }>

/** #212 图片导出失败原因（cancelled=取消对话框；invalid=载荷；not-found=
 *  目标图不可寻址；read-failed=读字节；writeFailed=写盘） */
export type ImageExportFailReason =
  'cancelled' | 'invalid' | 'not-found' | 'read-failed' | 'writeFailed'

export function isWebviewToHost(v: unknown): v is WebviewToHost {
  if (!isObject(v)) {
    return false
  }
  switch (v.kind) {
    case 'ready':
      return true
    case '_test.skeleton.report':
      // #292 骨架状态回报：测试钩子通道，仅校验字段类型
      return typeof v.present === 'boolean' &&
        (v.container === 'live' || v.container === 'reading' || v.container === null) &&
        (v.shownAt === null || typeof v.shownAt === 'number')
    case 'keybindings.get':
      return true
    case 'keybindings.set':
      return isKeybindingOperationId(v.id) && Array.isArray(v.bindings) &&
        v.bindings.every(isString) &&
        typeof v.replaceConflicts === 'boolean' && isPositiveInt(v.requestId)
    case 'keybindings.reset':
      return isKeybindingOperationId(v.id) && typeof v.replaceConflicts === 'boolean' &&
        isPositiveInt(v.requestId)
    case 'keybindings.resetAll':
      return isPositiveInt(v.requestId)
    case 'keybindings.execute':
      return isKeybindingOperationId(v.id)
    case 'view.switch.request':
      return v.target === 'live' || v.target === 'reading'
    case 'edit.request':
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.seq) &&
        isNonNegativeInt(v.baseVersion) &&
        isSerChangeArray(v.changes) &&
        (v.paste === undefined || isPasteStage(v.paste))
      )
    case 'history.request':
      return v.op === 'undo' || v.op === 'redo'
    case 'sync.request':
      return true
    case 'conflict.report':
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isNonNegativeInt(v.version) &&
        isPositiveInt(v.revision) &&
        isString(v.text) &&
        (v.compositionPending === undefined || typeof v.compositionPending === 'boolean')
      )
    case 'composition.changed':
      return isString(v.sessionId) && isString(v.docUri) &&
        isPositiveInt(v.revision) && isSerChangeArray(v.changes)
    case 'sync.test.close':
      return isString(v.sessionId) && isString(v.docUri)
    case 'settings.open':
      return true
    case 'settings.get':
      return true
    case 'settings.set':
      return isSettingsPayload(v.values)
    case 'settings.uiState':
      // 会话内恢复：分页 id（可为空串=尚无激活分页）与非负滚动位置
      return isString(v.section) && isNonNegativeInt(v.scrollTop)
    case 'findOptions.get':
      return true
    case 'findOptions.set':
      return isFindOptions(v.options)
    case 'clipboard.write':
      // #69 两变体：text 直写 / linkHeading 由宿主拼标题链接；
      // #162 第三变体 linkBlock 由宿主拼块链接 [[笔记名#^id]]
      if (isString(v.text) && v.linkHeading === undefined && v.linkBlock === undefined) {
        return true
      }
      if (
        v.text === undefined && v.linkBlock === undefined &&
        isObject(v.linkHeading) &&
        isString(v.linkHeading.docUri) &&
        isString(v.linkHeading.heading)
      ) {
        return true
      }
      return (
        v.text === undefined && v.linkHeading === undefined &&
        isObject(v.linkBlock) &&
        isString(v.linkBlock.docUri) &&
        isString(v.linkBlock.blockId)
      )
    case 'clipboard.read':
      // #183 粘贴桥：reqId 会话面板内自增（对应 clipboard.read.result）
      return isPositiveInt(v.reqId)
    case 'paste.preferences.set':
      return isPositiveInt(v.reqId) && typeof v.preserveFormatting === 'boolean'
    case 'conflict.action':
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        (v.action === 'copy' || v.action === 'resume')
      )
    case 'view.locate.ack':
      return isNonNegativeInt(v.offset)
    case 'view.state':
      return (
        (v.diagnostics === undefined || isDiagnosticSnapshot(v.diagnostics)) &&
        isString(v.text) &&
        isNonNegativeInt(v.docLength) &&
        isNonNegativeInt(v.lineCount) &&
        isNonNegativeInt(v.renderedLines) &&
        (v.suspended === undefined || typeof v.suspended === 'boolean') &&
        (v.contentDomCount === undefined || isNonNegativeInt(v.contentDomCount)) &&
        (v.headingLineCount === undefined || isNonNegativeInt(v.headingLineCount)) &&
        (v.headingActiveText === undefined || isString(v.headingActiveText)) &&
        (v.headingHiddenText === undefined || isString(v.headingHiddenText)) &&
        (v.headingFontPx === undefined || isNonNegativeNumber(v.headingFontPx)) &&
        (v.viewMode === undefined || v.viewMode === 'live' || v.viewMode === 'reading') &&
        (v.selectionOffset === undefined || isNonNegativeInt(v.selectionOffset)) &&
        (v.selectionHead === undefined || isNonNegativeInt(v.selectionHead)) &&
        (v.selectionAssoc === undefined || (typeof v.selectionAssoc === 'number' &&
          Number.isInteger(v.selectionAssoc) && v.selectionAssoc >= -1 && v.selectionAssoc <= 1)) &&
        (v.liveViewportCenterLine === undefined || isNonNegativeInt(v.liveViewportCenterLine)) &&
        (v.liveScrollTopPx === undefined || isNonNegativeNumber(v.liveScrollTopPx)) &&
        (v.wordSegmenter === undefined || typeof v.wordSegmenter === 'boolean') &&
        (v.wasmCompile === undefined || typeof v.wasmCompile === 'boolean') &&
        (v.jiebaEngine === undefined || v.jiebaEngine === 'builtin' || v.jiebaEngine === 'jieba') &&
        (v.readingBlockCount === undefined || isNonNegativeInt(v.readingBlockCount)) &&
        (v.readingAnchorStart === undefined || isNonNegativeInt(v.readingAnchorStart)) &&
        (v.readingTotalBlocks === undefined || isNonNegativeInt(v.readingTotalBlocks)) &&
        (v.readingMountedBlocks === undefined || isNonNegativeInt(v.readingMountedBlocks)) &&
        (v.readingContentDomCount === undefined || isNonNegativeInt(v.readingContentDomCount)) &&
        (v.readingParseCount === undefined || isNonNegativeInt(v.readingParseCount)) &&
        (v.readingVirtualized === undefined || typeof v.readingVirtualized === 'boolean') &&
        (v.readingAnchorTopPx === undefined || isNonNegativeNumber(v.readingAnchorTopPx)) &&
        (v.readingScrollTopPx === undefined || isNonNegativeNumber(v.readingScrollTopPx)) &&
        (v.readingScrollHeightPx === undefined || isNonNegativeNumber(v.readingScrollHeightPx)) &&
        (v.readingFindHitBlocks === undefined || isNonNegativeInt(v.readingFindHitBlocks)) &&
        (v.cssProbe === undefined || isCssProbeReport(v.cssProbe)) &&
        (v.liveSyntax === undefined || isLiveSyntaxProbe(v.liveSyntax)) &&
        (v.tableGrid === undefined || isTableGridProbe(v.tableGrid)) &&
        (v.readingSyntax === undefined || isReadingSyntaxProbe(v.readingSyntax)) &&
        (v.liveLinkCount === undefined || isNonNegativeInt(v.liveLinkCount)) &&
        (v.liveImageCount === undefined || isNonNegativeInt(v.liveImageCount)) &&
        (v.liveWikilinkCount === undefined || isNonNegativeInt(v.liveWikilinkCount)) &&
        (v.liveMathCount === undefined || isNonNegativeInt(v.liveMathCount)) &&
        (v.readingMathCount === undefined || isNonNegativeInt(v.readingMathCount)) &&
        (v.liveMermaidCount === undefined || isNonNegativeInt(v.liveMermaidCount)) &&
        (v.readingMermaidCount === undefined || isNonNegativeInt(v.readingMermaidCount)) &&
        (v.readingLinkCount === undefined || isNonNegativeInt(v.readingLinkCount)) &&
        (v.readingImageCount === undefined || isNonNegativeInt(v.readingImageCount)) &&
        (v.readingWikilinkCount === undefined || isNonNegativeInt(v.readingWikilinkCount)) &&
        (v.imageStates === undefined || isImageStateCounts(v.imageStates)) &&
        (v.imageEntries === undefined ||
          (Array.isArray(v.imageEntries) && v.imageEntries.every(isImageEntryProbe))) &&
        (v.imageProbe === undefined ||
          (Array.isArray(v.imageProbe) && v.imageProbe.every(isImageSlotProbe))) &&
        (v.find === undefined || isFindSessionProbe(v.find)) &&
        (v.settings === undefined || isSettingsPayload(v.settings)) &&
        (v.lineGutter === undefined || isLineGutterProbe(v.lineGutter)) &&
        (v.paint === undefined || isPaintProbe(v.paint)) &&
        (v.sidebar === undefined || isSidebarProbe(v.sidebar)) &&
        (v.outline === undefined || isOutlineProbe(v.outline)) &&
        (v.backlinks === undefined || isBacklinksProbe(v.backlinks)) &&
        (v.outlinks === undefined || isOutlinksProbe(v.outlinks)) &&
        (v.fmPopoverOpen === undefined || typeof v.fmPopoverOpen === 'boolean') &&
          (v.hoverPreview === undefined || (isObject(v.hoverPreview) &&
          typeof v.hoverPreview.open === 'boolean' &&
          (v.hoverPreview.state === 'loading' || v.hoverPreview.state === 'content' || v.hoverPreview.state === 'error') &&
          isString(v.hoverPreview.note) &&
          isNonNegativeInt(v.hoverPreview.blocks) &&
          (v.hoverPreview.scope === 'full' || v.hoverPreview.scope === 'heading' ||
            v.hoverPreview.scope === 'block' || v.hoverPreview.scope === '') &&
          (v.hoverPreview.fm === undefined || v.hoverPreview.fm === 'none' ||
            v.hoverPreview.fm === 'collapsed' || v.hoverPreview.fm === 'expanded') &&
          (v.hoverPreview.imageSrcs === undefined ||
            (Array.isArray(v.hoverPreview.imageSrcs) && v.hoverPreview.imageSrcs.every(isString))))) &&
        (v.targetTip === undefined || (isObject(v.targetTip) &&
          typeof v.targetTip.open === 'boolean' &&
          isString(v.targetTip.text))) &&
        (v.readingEmbed === undefined ||
          (Array.isArray(v.readingEmbed) && v.readingEmbed.every((e: unknown) =>
            isObject(e) &&
            isString(e.inner) &&
            (e.state === 'loading' || e.state === 'content' || e.state === 'error') &&
            isString(e.note) &&
            isNonNegativeInt(e.blocks) &&
            (e.scope === 'full' || e.scope === 'heading' || e.scope === 'block' || e.scope === '') &&
            (e.fm === 'none' || e.fm === 'collapsed' || e.fm === 'expanded') &&
            isNonNegativeInt(e.maxHeightPx) &&
            // 修 2（review 第二轮）：#223 host 字段入校验器（与联合类型
            // 同步——缺省 / reading 块挂载 / live widget 挂载）
            (e.host === undefined || e.host === 'reading' || e.host === 'live') &&
            (e.rootHost === undefined || e.rootHost === 'reading' || e.rootHost === 'live' || e.rootHost === 'hover') &&
            (e.textLen === undefined || isNonNegativeInt(e.textLen))))) &&
        (v.typography === undefined || isTypographyProbe(v.typography))
      )
    case 'reading.perf.report':
      return (
        isNonNegativeInt(v.scrollRounds) &&
        isNonNegativeInt(v.totalBlocks) &&
        isReadingPerfSnapshot(v.baseline) &&
        isReadingPerfSnapshot(v.afterScroll) &&
        isNonNegativeInt(v.parseCount) &&
        isNonNegativeInt(v.maxMountedBlocks) &&
        typeof v.ok === 'boolean'
      )
    case 'link.activate':
      // #220 sourceDocUri（悬停浮层内链接的来源文档）：可选非空字符串
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isString(v.href) &&
        isNonNegativeInt(v.srcStart) &&
        isNonNegativeInt(v.srcEnd) &&
        (v.sourceDocUri === undefined || (typeof v.sourceDocUri === 'string' && v.sourceDocUri.length > 0))
      )
    case 'wikilink.activate':
      // #220 sourceDocUri 语义与 link.activate 同
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isString(v.target) &&
        isNonNegativeInt(v.srcStart) &&
        isNonNegativeInt(v.srcEnd) &&
        (v.sourceDocUri === undefined || (typeof v.sourceDocUri === 'string' && v.sourceDocUri.length > 0))
      )
    case 'codeblock.copy':
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isString(v.text)
      )
    case 'diagram.export':
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.reqId) &&
        (v.format === 'svg' || v.format === 'png') &&
        isString(v.fileName) &&
        isString(v.content)
      )
    case 'image.export':
      // #212 图片导出：会话守卫字段对齐 image.request；src 非空、fileName
      // 限长（与粘贴 fileNameHint 同限；非法整体丢弃）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.reqId) &&
        typeof v.src === 'string' &&
        v.src.length > 0 &&
        typeof v.fileName === 'string' &&
        v.fileName.length > 0 &&
        v.fileName.length <= IMAGE_PASTE_LIMITS.fileNameHintMaxChars
      )
    case 'image.request':
      // #220 sourceDocUri（悬停浮层内图片的来源文档）：可选非空字符串
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.reqId) &&
        isString(v.src) &&
        (v.sourceDocUri === undefined || (typeof v.sourceDocUri === 'string' && v.sourceDocUri.length > 0))
      )
    case 'image.verify':
      // #201 周期核验：条目形态（state 枚举 + 可选 reason 码）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        Array.isArray(v.items) &&
        v.items.every(
          (item: unknown) =>
            isObject(item) &&
            isString(item.src) &&
            (item.state === 'loaded' || item.state === 'loading' || item.state === 'error') &&
            (item.reason === undefined || isString(item.reason)),
        )
      )
    case 'image.paste':
      // #161 图片粘贴：mime 白名单形态（image/*）、严格 base64 + 上限、
      // fileNameHint 可选限长（非法整体丢弃，不部分读取）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.reqId) &&
        typeof v.mime === 'string' &&
        v.mime.startsWith('image/') &&
        v.mime.length > 'image/'.length &&
        typeof v.dataBase64 === 'string' &&
        v.dataBase64.length > 0 &&
        v.dataBase64.length <= IMAGE_PASTE_LIMITS.dataBase64MaxChars &&
        BASE64_STRICT.test(v.dataBase64) &&
        (v.fileNameHint === undefined ||
          (typeof v.fileNameHint === 'string' &&
            v.fileNameHint.length <= IMAGE_PASTE_LIMITS.fileNameHintMaxChars))
      )
    case 'refresh.request':
      // #208 手动刷新请求：会话守卫字段 + 正整数 reqId（与 image.request 同惯例）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.reqId)
      )
    case 'hover.request':
      // #218 悬停预览请求：会话守卫字段 + reqId 配对 + 非空实例标识 +
      // 非负源区间（P3-5：sourceStart 不得大于 sourceEnd——两字段同时
      // 存在，倒置即整体拒绝） + 目标原文（字符串即可，形态合法性由宿主
      // 解析判定）；
      // #219 普通链接形态的 linkHref（可选字符串，存在即走普通链接解析）；
      // #221 面板直接目标 directTarget（可选对象：fsPath 字符串可为空串
      // ——断链条目；anchor 可选字符串，^ 前缀 = 块锚点）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isPositiveInt(v.reqId) &&
        typeof v.instanceId === 'string' &&
        v.instanceId.length > 0 &&
        isNonNegativeInt(v.sourceStart) &&
        isNonNegativeInt(v.sourceEnd) &&
        (v.sourceStart as number) <= (v.sourceEnd as number) &&
        isString(v.target) &&
        (v.occurrenceId === undefined || (typeof v.occurrenceId === 'string' && v.occurrenceId.length > 0)) &&
        (v.source === undefined || (isObject(v.source) &&
          typeof v.source.parentInstanceId === 'string' && v.source.parentInstanceId.length > 0 &&
          typeof v.source.sourceDocUri === 'string' && v.source.sourceDocUri.length > 0)) &&
        (v.retainSource === undefined || typeof v.retainSource === 'boolean') &&
        (v.linkHref === undefined || isString(v.linkHref)) &&
        (v.directTarget === undefined ||
          (isObject(v.directTarget) &&
            isString(v.directTarget.fsPath) &&
            (v.directTarget.anchor === undefined || isString(v.directTarget.anchor))))
      )
    case 'hover.watch':
    case 'hover.unwatch':
      // #224 目标订阅：会话守卫字段 + 非空目标路径与实例标识（身份字段，
      // 空串即语义缺失——整体拒绝）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        typeof v.fsPath === 'string' &&
        v.fsPath.length > 0 &&
        typeof v.instanceId === 'string' &&
        v.instanceId.length > 0 &&
        (v.sourceLeaseId === undefined || (typeof v.sourceLeaseId === 'string' && v.sourceLeaseId.length > 0))
      )
    case 'hover.source.release':
      return isString(v.sessionId) && isString(v.docUri) &&
        typeof v.sourceLeaseId === 'string' && v.sourceLeaseId.length > 0
    case 'hover.target.resolve':
      // #299 目标提示轻量解析：会话守卫 + reqId + 三形态目标载荷
      //（target/linkHref/directTarget 与 hover.request 同口径）
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isNonNegativeInt(v.reqId) &&
        (v.target === undefined || isString(v.target)) &&
        (v.linkHref === undefined || isString(v.linkHref)) &&
        (v.directTarget === undefined ||
          (typeof v.directTarget === 'object' && v.directTarget !== null &&
            typeof (v.directTarget as { fsPath?: unknown }).fsPath === 'string' &&
            ((v.directTarget as { anchor?: unknown }).anchor === undefined ||
              typeof (v.directTarget as { anchor?: unknown }).anchor === 'string')))
      )
    case 'perf.report':
      return (
        isNonNegativeInt(v.typingRounds) &&
        isNonNegativeInt(v.scrollRounds) &&
        isNonNegativeInt(v.docLines) &&
        isPositiveInt(v.firstInputSettledEpochMs) &&
        isPerfSnapshot(v.baseline) &&
        isPerfSnapshot(v.afterTyping) &&
        isPerfSnapshot(v.afterScroll) &&
        isObject(v.inputDelayMs) &&
        Array.isArray(v.inputDelayMs.samples) &&
        v.inputDelayMs.samples.every((s) => typeof s === 'number' && s >= 0) &&
        typeof v.inputDelayMs.avgMs === 'number' &&
        typeof v.inputDelayMs.maxMs === 'number' &&
        (v.longTasks === null ||
          (isObject(v.longTasks) &&
            isNonNegativeInt(v.longTasks.count) &&
            typeof v.longTasks.maxMs === 'number' &&
            typeof v.longTasks.totalMs === 'number')) &&
        isObject(v.headingStats) &&
        isNonNegativeInt(v.headingStats.totalUpdates) &&
        isNonNegativeInt(v.headingStats.lastUpdateScannedLines) &&
        isNonNegativeInt(v.headingStats.fullBuildLines)
      )
    case 'snippets.get':
      return true
    case 'snippets.loadResult':
      return isString(v.name) && isNonNegativeInt(v.version) && typeof v.ok === 'boolean'
    case 'snippets.chooseDirectory':
      return true
    case 'snippets.setDirectory':
      return v.directory === null || (typeof v.directory === 'string' && v.directory.length > 0)
    case 'snippets.setEnabled':
      return typeof v.name === 'string' && v.name.length > 0 && typeof v.enabled === 'boolean'
    case 'snippets.setPaused':
      return typeof v.paused === 'boolean'
    case 'snippets.refresh':
      return true
    case 'snippets.openDirectory':
      return true
    case 'styleRef.export':
      return true
    case 'backlinks.get':
      return isString(v.sessionId) && isString(v.docUri)
    case 'backlink.activate':
      return isString(v.sessionId) && isString(v.docUri) &&
        isString(v.sourceUri) && isNonNegativeInt(v.offset)
    case 'outlinks.get':
      return isString(v.sessionId) && isString(v.docUri)
    case 'outlink.activate':
      return isString(v.sessionId) && isString(v.docUri) &&
        isString(v.targetUri) && isString(v.anchor)
    case 'index.get':
    case 'index.resetPatterns':
    case 'index.cleanup':
    case 'index.rebuild':
    case 'index.cancel':
    case 'wordSegment.get':
    case 'wordSegment.download':
    case 'wordSegment.delete':
      return true
    case 'wordSegment.loadResult':
      return typeof v.ok === 'boolean' &&
        (v.detail === undefined || isString(v.detail))
    case 'index.setPatterns':
      return Array.isArray(v.patterns) && v.patterns.every(isString)
    default:
      return false
  }
}

/** webview 侧校验宿主消息 */
export function isHostToWebview(v: unknown): v is HostToWebview {
  if (!isObject(v)) {
    return false
  }
  switch (v.kind) {
    case '_test.skeleton.release':
      // #292 骨架测试钩子：无字段的触发型消息
      return true
    case 'diagram.export.result':
      return isPositiveInt(v.reqId) && typeof v.ok === 'boolean' &&
        (v.reason === undefined || v.reason === 'cancelled' || v.reason === 'invalid' || v.reason === 'writeFailed')
    case 'image.export.result':
      // #212 图片导出结果：reason 枚举（not-found=目标图不可寻址；
      // read-failed=读字节失败——均为 diagram 导出没有的图片侧场景）
      return isPositiveInt(v.reqId) && typeof v.ok === 'boolean' &&
        (v.reason === undefined || v.reason === 'cancelled' || v.reason === 'invalid' ||
          v.reason === 'not-found' || v.reason === 'read-failed' || v.reason === 'writeFailed')
    case 'keybindings.snapshot':
    case 'keybindings.changed':
      return isObject(v.overrides) && Object.values(v.overrides).every((value) =>
        Array.isArray(value) && value.every(isString)) &&
        (v.requestId === undefined || isPositiveInt(v.requestId)) &&
        (v.ok === undefined || typeof v.ok === 'boolean') &&
        (v.reason === undefined || v.reason === 'invalid' || v.reason === 'conflict' || v.reason === 'storage') &&
        (v.conflicts === undefined || (Array.isArray(v.conflicts) && v.conflicts.every(isString)))
    case 'init':
      return (
        isString(v.sessionId) &&
        isString(v.docUri) &&
        isNonNegativeInt(v.version) &&
        isString(v.text)
      )
    case 'edit.ack':
      if (!isPositiveInt(v.seq) || !isNonNegativeInt(v.version)) {
        return false
      }
      if (v.ok === true) {
        return true
      }
      if (v.ok === false) {
        return (
          (v.reason === 'conflict' || v.reason === 'error') &&
          (v.text === undefined || isString(v.text))
        )
      }
      return false
    case 'doc.changed':
      return (
        isNonNegativeInt(v.version) &&
        isSerChangeArray(v.changes) &&
        v.origin === 'external' &&
        (v.reason === undefined || v.reason === 'undo' || v.reason === 'redo') &&
        (v.paste === undefined || (isObject(v.paste) && isString(v.paste.sessionId) && isPasteStage(v.paste)))
      )
    case 'doc.resync':
      return isNonNegativeInt(v.version) && isString(v.text)
    case 'session.suspended':
      return (
        isNonNegativeInt(v.version) &&
        (v.reason === 'conflict' || v.reason === 'host-error')
      )
    case 'view.state.request':
      return true
    case 'diagnostics.test.set':
      return typeof v.enabled === 'boolean'
    case 'perf.probe':
      return isPositiveInt(v.typingRounds) && isPositiveInt(v.scrollRounds)
    case 'view.mode.set':
      return v.mode === 'live' || v.mode === 'reading' || v.mode === 'toggle'
    case 'view.locate':
      return isNonNegativeInt(v.offset)
    case 'reading.perf':
      return isPositiveInt(v.scrollRounds)
    case 'reading.test.image':
      return (
        isNonNegativeInt(v.srcStart) &&
        isNonNegativeInt(v.initialHeightPx) &&
        isNonNegativeInt(v.finalHeightPx) &&
        isNonNegativeInt(v.delayMs)
      )
    case 'task.test.click':
      return (
        (v.view === 'live' || v.view === 'reading') &&
        isNonNegativeInt(v.index)
      )
    case 'codecard.test.copy':
      return isNonNegativeInt(v.index)
    case 'graphic.test.popup':
      return (
        (v.view === 'live' || v.view === 'reading') &&
        isNonNegativeInt(v.index) &&
        (v.action === undefined || v.action === 'export-svg' || v.action === 'export-png' ||
          v.action === 'refresh' || v.action === 'close')
      )
    case 'image.test.popup':
      // #212 测试钩子：与 graphic.test.popup 同通道形态（图片按钮组按
      // 序号点击；action 只点弹窗工具条，不重开弹窗）
      return (
        (v.view === 'live' || v.view === 'reading') &&
        isNonNegativeInt(v.index) &&
        (v.action === undefined || v.action === 'export' || v.action === 'refresh' || v.action === 'close')
      )
    case 'codecard.test.fold':
      return isNonNegativeInt(v.index)
    case 'image.result':
      if (!isPositiveInt(v.reqId)) {
        return false
      }
      if (v.ok === true) {
        return isString(v.src)
      }
      if (v.ok === false) {
        return (
          (v.reason === 'blocked' ||
            v.reason === 'outside-workspace' ||
            v.reason === 'not-found' ||
            v.reason === 'read-error' ||
            v.reason === 'inaccessible') &&
          (v.detail === undefined || isString(v.detail))
        )
      }
      return false
    case 'image.invalidate':
      // #201 失效通知：src 非空数组（空批无广播意义，防御放行不收紧）
      return Array.isArray(v.srcs) && v.srcs.every(isString)
    case 'image.wake':
      return true
    case 'image.paste.result':
      // #161 图片粘贴结果：ok 携完整插入文本；失败 reason 枚举
      if (!isPositiveInt(v.reqId)) {
        return false
      }
      if (v.ok === true) {
        return isString(v.markdown)
      }
      return (
        v.ok === false &&
        (v.reason === 'invalid-location' || v.reason === 'write-failed' || v.reason === 'invalid')
      )
    case 'image.test.pending':
      // #161 测试钩子：补登记在途 reqId（见消息定义注释）
      return isPositiveInt(v.reqId)
    case 'refresh.invalidated':
      // #208 刷新失效通知：正整数 reqId（配对请求）；generation 为自增后
      // 的资源代次，恒 ≥ 1（0 是未刷新初值，不回发）
      return isPositiveInt(v.reqId) && isPositiveInt(v.generation)
    case 'view.find.open':
      return (v.query === undefined || isString(v.query)) &&
        (v.replace === undefined || typeof v.replace === 'boolean') &&
        (v.replacement === undefined || isString(v.replacement))
    case 'view.find.close':
      return true
    case 'view.find.step':
      return v.direction === 'next' || v.direction === 'prev'
    case 'view.find.replace':
      return v.op === 'next' || v.op === 'all'
    case 'table.command':
      return isTableEditOp(v.op)
    case 'table.create':
      return true
    case 'format.command':
      return isFormatOperationId(v.op)
    case 'blockLink.copy':
      return true
    case 'ui.command':
      return isUiOperationId(v.op)
    case 'table.test.key':
      return v.key === 'tab' || v.key === 'shift-tab' || v.key === 'select-all' || v.key === 'enter' ||
        v.key === 'backspace' || v.key === 'delete'
    case 'viewport.test.position':
      return (v.cursorLine === undefined || isNonNegativeInt(v.cursorLine)) &&
        (v.scrollNearLine === undefined || isNonNegativeInt(v.scrollNearLine)) &&
        (v.scrollBiasPx === undefined || (v.scrollNearLine !== undefined &&
          typeof v.scrollBiasPx === 'number' && Number.isFinite(v.scrollBiasPx)))
    case 'table.test.cellClick':
      return isNonNegativeInt(v.rowIndex) && isNonNegativeInt(v.columnIndex) &&
        (v.point === undefined || v.point === 'edge' || v.point === 'middle' || v.point === 'right-edge')
    case 'table.test.crossSelect':
      return isNonNegativeInt(v.anchor) && isNonNegativeInt(v.head)
    case 'table.test.type':
    case 'table.test.domType':
      return isString(v.text)
    case 'table.test.history':
      return v.op === 'undo' || v.op === 'redo'
    case 'table.test.compose':
      return isNonNegativeInt(v.from) && isString(v.text)
    case 'table.test.select':
      return (v.axis === 'row' || v.axis === 'column') && isNonNegativeInt(v.index)
    case 'table.test.drag':
      return isNonNegativeInt(v.sourceIndex) && isNonNegativeInt(v.targetSlot)
    case 'sidebar.test.click':
      return true
    case 'sidebar.test.resize':
      return typeof v.delta === 'number' && Number.isFinite(v.delta)
    case 'quick.test.click':
      return v.action === 'toggle' || v.action === 'heading' || v.action === 'bold' ||
        v.action === 'heading1' || v.action === 'headingNone'
    case 'outline.test.click':
      return true
    case 'outline.test.itemClick':
      return isNonNegativeInt(v.index)
    case 'outline.test.expandClick':
      return typeof v.level === 'number' && Number.isInteger(v.level) &&
        v.level >= 0 && v.level <= 5
    case 'outline.test.chevronClick':
      return isNonNegativeInt(v.index)
    case 'outline.test.searchInput':
      return isString(v.text)
    case 'outline.test.toolbarClick':
      return v.action === 'jump-bottom' || v.action === 'reset'
    case 'outline.test.contextMenu':
      return isNonNegativeInt(v.index)
    case 'outline.test.menuClick':
      return isOutlineMenuCommand(v.command)
    case 'outline.test.menuClose':
      return true
    case 'find.test.toggle':
      return v.key === 'matchCase' || v.key === 'wholeWord' || v.key === 'regexp'
    case 'clipboard.read.result':
      if (!isPositiveInt(v.reqId)) {
        return false
      }
      if (v.ok === true) {
        return isString(v.text)
      }
      return v.ok === false && v.reason === 'read-failed'
    case 'paste.preferences.result':
      return isPositiveInt(v.reqId) && typeof v.ok === 'boolean'
    case 'contextMenu.test.contextMenu':
      return isNonNegativeInt(v.pos)
    case 'contextMenu.test.menuClick':
      return typeof v.command === 'string' && v.command.length > 0
    case 'contextMenu.test.menuClose':
      return true
    case 'outline.test.renameKey':
      return isString(v.text) && (v.key === 'enter' || v.key === 'escape')
    case 'outline.test.drag':
      return isNonNegativeInt(v.from) && isNonNegativeInt(v.to) &&
        (v.position === 'before' || v.position === 'after' || v.position === 'inside') &&
        (v.action === 'hover' || v.action === 'drop' || v.action === 'escape')
    case 'sync.test.edit':
      return isNonNegativeInt(v.offset) && isString(v.text) &&
        (v.closeAfter === undefined || typeof v.closeAfter === 'boolean')
    case 'fm.test.click':
      return (v.action === 'edit-button' || v.action === 'popover-close' ||
        v.action === 'popover-add-entry' || v.action === 'popover-add-item' ||
        v.action === 'popover-remove-entry' || v.action === 'popover-remove-item' ||
        v.action === 'fold-button' || v.action === 'fold-hotspot') &&
        (v.index === undefined || isNonNegativeInt(v.index))
    case 'view.test.click':
      return true
    case 'backlinks.test.click':
      return true
    case 'backlinks.test.itemClick':
      return isNonNegativeInt(v.index)
    case 'backlinks.test.toolbarClick':
      return v.action === 'sort' || v.action === 'search' || v.action === 'collapse' || v.action === 'context'
    case 'backlinks.test.searchInput':
      return isString(v.value)
    case 'backlinks.test.sortSelect':
      return ['name-asc', 'name-desc', 'mtime-desc', 'mtime-asc', 'birth-desc', 'birth-asc']
        .includes(v.mode as string)
    case 'refresh.test.click':
      return true
    case 'hover.test.pointer':
      // #218 测试钩子：真实双链序号 + 进/离动作枚举；#219 link 选择器
      // （缺省 wikilink，'md' 对普通 Markdown 链接派发）；#221 扩展
      // Live（live-wikilink / live-md，ctrlKey 修饰位可选）与面板
      // （backlink / outlink）入口；'modkey' 对 document 派发 keydown
      // Control（「悬停后按 Ctrl」补触发路径）
      return (v.action === 'enter' || v.action === 'leave' || v.action === 'modkey') && isNonNegativeInt(v.index) &&
        (v.link === undefined || v.link === 'wikilink' || v.link === 'md' ||
          v.link === 'live-wikilink' || v.link === 'live-md' ||
          v.link === 'backlink' || v.link === 'outlink') &&
        (v.ctrlKey === undefined || typeof v.ctrlKey === 'boolean')
    case 'sync.test.composition':
      return (v.phase === 'start' || v.phase === 'update' || v.phase === 'end') && isString(v.text)
    case 'link.test.mousedown':
      return (v.target === 'wikilink' || v.target === 'link') && isNonNegativeInt(v.index) &&
        (v.ctrlKey === undefined || typeof v.ctrlKey === 'boolean')
    case 'settings.snapshot':
      return isSettingsPayload(v.values)
    case 'settings.focusSection':
      // #231：entry 可选字符串（缺省 = 无分页内定位，向后兼容）；
      // scroll（会话内恢复）可选非负数——恢复滚动位置，与 entry 不同时使用
      return isString(v.section) && (v.entry === undefined || isString(v.entry)) &&
        (v.scroll === undefined || isNonNegativeInt(v.scroll))
    case 'settings.changed':
      return isSettingsPayload(v.values)
    case 'findOptions.snapshot':
      return isFindOptions(v.options)
    case 'locale.changed':
      // #93 语言包切换：形态校验（非空语言代码 + 全字符串词条的完整包）；
      // 语言代码是否在支持清单内由宿主发送侧保证（解析见 locales/resolveLocale）
      return (
        typeof v.lang === 'string' &&
        v.lang.length > 0 &&
        isObject(v.messages) &&
        Object.values(v.messages).every(isString)
      )
    case 'snippets.snapshot':
      return (
        isNonNegativeInt(v.version) &&
        Array.isArray(v.snippets) &&
        v.snippets.every(
          (item) =>
            isObject(item) &&
            isString(item.name) &&
            isString(item.uri) &&
            (item.v === undefined || isNonNegativeInt(item.v)),
        )
      )
    case 'snippets.state':
      return (
        (v.directory === null || (typeof v.directory === 'string' && v.directory.length > 0)) &&
        typeof v.readError === 'boolean' &&
        typeof v.paused === 'boolean' &&
        isNonNegativeInt(v.version) &&
        Array.isArray(v.entries) &&
        v.entries.every(
          (item) => isObject(item) && isString(item.name) && typeof item.enabled === 'boolean',
        ) &&
        (v.rejections === undefined || isCssSnippetRejectionMap(v.rejections))
      )
    case 'backlinks.snapshot':
      return (
        isString(v.docUri) &&
        (v.state === 'loading' || v.state === 'ready' || v.state === 'error') &&
        (v.updating === undefined || typeof v.updating === 'boolean') &&
        (v.reason === undefined || v.reason === 'no-workspace' || v.reason === 'read-error') &&
        (v.items === undefined || (Array.isArray(v.items) && v.items.every(isBacklinkItemPayload)))
      )
    case 'outlinks.snapshot':
      return (
        isString(v.docUri) &&
        (v.state === 'loading' || v.state === 'ready' || v.state === 'error') &&
        (v.updating === undefined || typeof v.updating === 'boolean') &&
        (v.reason === undefined || v.reason === 'no-workspace' || v.reason === 'read-error') &&
        (v.items === undefined || (Array.isArray(v.items) && v.items.every(isOutlinkItemPayload)))
      )
    case 'hover.result':
      // #218 悬停预览结果：reqId+instanceId 双配对；成功形态须携带完整
      // 目标身份/版本/LF 全文/范围（start<=end）/范围选择器（#219 起
      // heading/block 附锚点原文）；失败形态 reason 限定错误分态枚举
      // （anchor-missing 附锚点原文）
      if (!isPositiveInt(v.reqId) ||
        typeof v.instanceId !== 'string' || v.instanceId.length === 0) {
        return false
      }
      if (v.ok === true) {
        return (
          isObject(v.target) &&
          isString(v.target.fsPath) &&
          isString(v.target.relPath) &&
          isNonNegativeInt(v.version) &&
          isString(v.text) &&
          (v.expansionPath === undefined || (Array.isArray(v.expansionPath) && v.expansionPath.every(isString))) &&
          (v.depth === undefined || isPositiveInt(v.depth)) &&
          (v.sourceLeaseId === undefined || (typeof v.sourceLeaseId === 'string' && v.sourceLeaseId.length > 0)) &&
          isObject(v.range) &&
          typeof v.range.start === 'number' &&
          typeof v.range.end === 'number' &&
          isNonNegativeInt(v.range.start) &&
          isNonNegativeInt(v.range.end) &&
          v.range.start <= v.range.end &&
          isObject(v.scope) &&
          (v.scope.kind === 'full' ||
            ((v.scope.kind === 'heading' || v.scope.kind === 'block') && isString(v.scope.anchor)))
        )
      }
      return (
        v.ok === false &&
        (v.reason === 'unsupported' || v.reason === 'no-workspace' || v.reason === 'escape' ||
          v.reason === 'not-found' || v.reason === 'non-markdown' || v.reason === 'read-failed' ||
          v.reason === 'anchor-missing' || v.reason === 'source-expired' || v.reason === 'cycle' ||
          v.reason === 'depth' || v.reason === 'budget') &&
        (v.anchor === undefined || isString(v.anchor))
      )
    case 'hover.invalidated':
      // #224 失效推送：非空目标路径 + status 三态（vaultIndex onTargetChange
      // 同口径）+ 非负整数代次（单调递增；首观测为 1）
      return (
        typeof v.fsPath === 'string' &&
        v.fsPath.length > 0 &&
        (v.status === 'changed' || v.status === 'deleted' || v.status === 'stale') &&
        isNonNegativeInt(v.generation)
      )
    case 'hover.watch.rejected':
      return typeof v.fsPath === 'string' && v.fsPath.length > 0 &&
        typeof v.instanceId === 'string' && v.instanceId.length > 0 &&
        (v.sourceLeaseId === undefined || (typeof v.sourceLeaseId === 'string' && v.sourceLeaseId.length > 0)) &&
        (v.reason === 'capacity' || v.reason === 'source')
    case 'hover.target.resolved':
      // #299 目标提示解析结果：reqId 配对；成功形态必带非空相对路径，
      // 锚点为源码形态字符串（`#标题` / `#^块id`）或缺省
      if (v.ok === false) {
        return isNonNegativeInt(v.reqId)
      }
      return isNonNegativeInt(v.reqId) &&
        typeof v.relPath === 'string' && v.relPath.length > 0 &&
        (v.anchor === undefined || typeof v.anchor === 'string')
    case 'outlinks.test.click':
      return true
    case 'outlinks.test.itemClick':
      return isNonNegativeInt(v.index)
    case 'index.state':
      return (
        typeof v.available === 'boolean' &&
        Array.isArray(v.patterns) && v.patterns.every(isString) &&
        Array.isArray(v.defaults) && v.defaults.every(isString) &&
        (v.status === 'idle' || v.status === 'cleaning' || v.status === 'rebuilding') &&
        (v.progress === null || (isObject(v.progress) &&
          isNonNegativeInt(v.progress.done) && isNonNegativeInt(v.progress.total))) &&
        isNonNegativeInt(v.roots) &&
        (v.notice === null || (isObject(v.notice) && isIndexNoticeKind(v.notice.kind) &&
          (v.notice.detail === undefined || isString(v.notice.detail))))
      )
    case 'wordSegment.state':
      // #239 分词资源状态：installed/version/status/notice 形态 + resources
      // 仅 installed 时携带（js/wasm 两个 webview 资源 URI）
      return (
        typeof v.installed === 'boolean' &&
        isString(v.version) &&
        (v.status === 'idle' || v.status === 'downloading') &&
        (v.notice === null || (isObject(v.notice) && isWordSegmentNoticeKind(v.notice.kind) &&
          (v.notice.detail === undefined || isString(v.notice.detail)))) &&
        (v.resources === null || (isObject(v.resources) &&
          isString(v.resources.js) && isString(v.resources.wasm)))
      )
    default:
      return false
  }
}

/** #198 索引维护操作结果反馈种类（index.state.notice.kind） */
const INDEX_NOTICE_KINDS = [
  'patterns-saved', 'patterns-invalid', 'rebuild-done', 'rebuild-cancelled',
  'rebuild-failed', 'cleanup-done', 'cleanup-failed',
] as const

function isIndexNoticeKind(v: unknown): v is (typeof INDEX_NOTICE_KINDS)[number] {
  return typeof v === 'string' && (INDEX_NOTICE_KINDS as readonly string[]).includes(v)
}

/** #239 分词资源操作结果反馈种类（wordSegment.state.notice.kind） */
const WORD_SEGMENT_NOTICE_KINDS = [
  'downloaded', 'download-failed', 'deleted', 'delete-failed', 'load-failed',
] as const

function isWordSegmentNoticeKind(v: unknown): v is (typeof WORD_SEGMENT_NOTICE_KINDS)[number] {
  return typeof v === 'string' && (WORD_SEGMENT_NOTICE_KINDS as readonly string[]).includes(v)
}

/** #197 反链条目载荷形态守卫（新字段可选：旧宿主快照缺省容忍） */
function isBacklinkItemPayload(v: unknown): v is BacklinkItemPayload {
  if (!isObject(v)) {
    return false
  }
  return (
    isString(v.sourceRelPath) &&
    isString(v.sourceFsPath) &&
    (v.kind === 'wikilink' || v.kind === 'mdlink' || v.kind === 'image' || v.kind === 'refdef' || v.kind === 'embed') &&
    isString(v.anchor) &&
    isNonNegativeInt(v.start) &&
    isNonNegativeInt(v.end) &&
    isPositiveInt(v.line) &&
    isString(v.snippet) &&
    (v.snippetStart === undefined || isNonNegativeInt(v.snippetStart)) &&
    (v.sourceMtimeMs === undefined || (typeof v.sourceMtimeMs === 'number' && v.sourceMtimeMs >= 0)) &&
    (v.sourceBirthtimeMs === undefined || (typeof v.sourceBirthtimeMs === 'number' && v.sourceBirthtimeMs >= 0)) &&
    (v.snippetLong === undefined || isString(v.snippetLong)) &&
    (v.snippetLongStart === undefined || isNonNegativeInt(v.snippetLongStart))
  )
}

/** 出链条目载荷形态守卫 */
function isOutlinkItemPayload(v: unknown): v is OutlinkItemPayload {
  if (!isObject(v)) {
    return false
  }
  return (
    isString(v.targetDisplay) &&
    (v.targetRelPath === null || isString(v.targetRelPath)) &&
    (v.targetFsPath === null || isString(v.targetFsPath)) &&
    (v.kind === 'wikilink' || v.kind === 'mdlink' || v.kind === 'image' || v.kind === 'refdef' || v.kind === 'embed') &&
    isString(v.anchor) &&
    typeof v.resolved === 'boolean' &&
    isNonNegativeInt(v.start) &&
    isNonNegativeInt(v.end)
  )
}

/** #197 反链面板观测形态守卫 */
function isBacklinksProbe(v: unknown): v is BacklinksProbe {
  if (!isObject(v)) {
    return false
  }
  return (
    typeof v.active === 'boolean' &&
    typeof v.togglePainted === 'boolean' &&
    typeof v.panelPainted === 'boolean' &&
    (v.state === 'loading' || v.state === 'ready' || v.state === 'error' || v.state === 'none') &&
    typeof v.updating === 'boolean' &&
    Array.isArray(v.items) &&
    v.items.every(
      (item) => isObject(item) && isString(item.sourceRelPath) &&
        (item.kind === 'wikilink' || item.kind === 'mdlink' || item.kind === 'image' || item.kind === 'refdef' || item.kind === 'embed') &&
        isPositiveInt(item.line) && isString(item.snippet),
    ) &&
    typeof v.itemPainted === 'boolean' &&
    typeof v.emptyPainted === 'boolean' &&
    (v.toggleAriaLabel === null || isString(v.toggleAriaLabel)) &&
    (v.panelAriaLabel === null || isString(v.panelAriaLabel)) &&
    (v.view === undefined || (isObject(v.view) && isString(v.view.sortMode) &&
      isString(v.view.query) && typeof v.view.searchOpen === 'boolean' &&
      typeof v.view.contextLong === 'boolean' &&
      (v.view.collapsedCount === undefined || isNonNegativeInt(v.view.collapsedCount)) &&
      (v.view.domCards === undefined || isNonNegativeInt(v.view.domCards)))) &&
    (v.toolbarPainted === undefined || typeof v.toolbarPainted === 'boolean') &&
    (v.hitPainted === undefined || typeof v.hitPainted === 'boolean') &&
    (v.hitBg === undefined || v.hitBg === null || isString(v.hitBg))
  )
}

/** 出链面板观测形态守卫 */
function isOutlinksProbe(v: unknown): v is OutlinksProbe {
  if (!isObject(v)) {
    return false
  }
  return (
    typeof v.active === 'boolean' &&
    typeof v.togglePainted === 'boolean' &&
    typeof v.panelPainted === 'boolean' &&
    (v.state === 'loading' || v.state === 'ready' || v.state === 'error' || v.state === 'none') &&
    typeof v.updating === 'boolean' &&
    Array.isArray(v.items) &&
    v.items.every(
      (item) => isObject(item) && isString(item.targetDisplay) &&
        (item.targetRelPath === null || isString(item.targetRelPath)) &&
        (item.kind === 'wikilink' || item.kind === 'mdlink' || item.kind === 'image' || item.kind === 'refdef' || item.kind === 'embed') &&
        isString(item.anchor) &&
        typeof item.resolved === 'boolean',
    ) &&
    typeof v.itemPainted === 'boolean' &&
    typeof v.emptyPainted === 'boolean' &&
    (v.toggleAriaLabel === null || isString(v.toggleAriaLabel)) &&
    (v.panelAriaLabel === null || isString(v.panelAriaLabel))
  )
}
