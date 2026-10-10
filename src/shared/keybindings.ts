/** 用户操作、默认键位和生效模式的单一事实源。字符串采用 ctrl+shift+b / ctrl+k ctrl+b。 */
import { FORMAT_OPERATIONS } from './formatOperations'
import type { MessageKey } from './locales/en'

export type BindingMode = 'live' | 'reading' | 'both'
export interface KeybindingOperation {
  id: string
  command: string
  /** 操作显示名的字典消息键：format 源持 format.*（工具条/快捷键页/manifest
   *  三面同源），extra/UI 源持 command.*（快捷键页与 manifest NLS 同源，
   *  键名按 command id 推导，与 genNls 的映射规则一致——无第二套文案；
   *  例外：#232 起三态切换三操作持独立 operation.* 键，操作名与 manifest
   *  归属句式 title 拆键分持） */
  titleKey: MessageKey
  mode: BindingMode
  writes: boolean
  defaults: readonly string[]
}

const extra: readonly KeybindingOperation[] = [
  { id: 'find', command: 'onegayi.vsidian.find', titleKey: 'command.find.title', mode: 'both', writes: false, defaults: ['ctrl+f', 'meta+f'] },
  { id: 'findNext', command: 'onegayi.vsidian.find.next', titleKey: 'command.find.next.title', mode: 'both', writes: false, defaults: ['f3'] },
  { id: 'findPrevious', command: 'onegayi.vsidian.find.previous', titleKey: 'command.find.previous.title', mode: 'both', writes: false, defaults: ['shift+f3'] },
  // #236 查找替换：findReplace 打开面板并展开替换栏（2026-10 用户决策：
  // 阅读模式整体禁用替换——生效模式收窄到 Live，Ctrl+H 在阅读不消费不
  // 响应，替换栏 toggle 同步 disabled；替换操作是面板
  // 会话命令（仅面板开 + live + 合法 query 时执行，webview 本地消化），
  // 默认不占键位——面板内替换输入框 Enter 与按钮是主入口（VSCode
  // Windows 档替换下一个亦无全局默认键），键位留给用户按需绑定
  { id: 'findReplace', command: 'onegayi.vsidian.find.replace', titleKey: 'command.find.replace.title', mode: 'live', writes: false, defaults: ['ctrl+h'] },
  { id: 'findReplaceNext', command: 'onegayi.vsidian.find.replaceNext', titleKey: 'command.find.replaceNext.title', mode: 'live', writes: false, defaults: [] },
  { id: 'findReplaceAll', command: 'onegayi.vsidian.find.replaceAll', titleKey: 'command.find.replaceAll.title', mode: 'live', writes: false, defaults: [] },
  { id: 'toggleViewMode', command: 'onegayi.vsidian.toggleViewMode', titleKey: 'command.toggleViewMode.title', mode: 'both', writes: false, defaults: [] },
  // #232 拆键：三态切换的 titleKey 持独立无前缀操作名键（operation.*），
  // 与 manifest title 键（command.mode.to*.title，归属句式「将 Vsidian
  // 切换到 xx」）分离——快捷键页操作名维持原文案、不带品牌名
  { id: 'toReading', command: 'onegayi.vsidian.mode.toReading', titleKey: 'operation.toReading', mode: 'live', writes: false, defaults: [] },
  { id: 'toLive', command: 'onegayi.vsidian.mode.toLive', titleKey: 'operation.toLive', mode: 'reading', writes: false, defaults: [] },
  { id: 'toSource', command: 'onegayi.vsidian.mode.toSource', titleKey: 'operation.toSource', mode: 'both', writes: false, defaults: [] },
  // #141 双态切换（live↔reading，不含源码）：工具栏按钮与快捷键共用
  // 同一目标推导（当前态取反）。双模式可触发（源码模式不经 webview 键
  // 路由天然不涉及）；默认 ctrl+q（2026-09-27 用户指示，全仓与宿主
  // webview 默认无占用——冲突核对记录见本表与 keybindings.md）
  { id: 'toggleDualView', command: 'onegayi.vsidian.mode.toggleDualView', titleKey: 'command.mode.toggleDualView.title', mode: 'both', writes: false, defaults: ['ctrl+q'] },
  { id: 'tableCreate', command: 'onegayi.vsidian.table.create', titleKey: 'command.table.create.title', mode: 'live', writes: true, defaults: [] },
  { id: 'insertRowAbove', command: 'onegayi.vsidian.table.insertRowAbove', titleKey: 'command.table.insertRowAbove.title', mode: 'live', writes: true, defaults: [] },
  { id: 'insertRowBelow', command: 'onegayi.vsidian.table.insertRowBelow', titleKey: 'command.table.insertRowBelow.title', mode: 'live', writes: true, defaults: [] },
  { id: 'deleteRow', command: 'onegayi.vsidian.table.deleteRow', titleKey: 'command.table.deleteRow.title', mode: 'live', writes: true, defaults: [] },
  { id: 'insertColumnLeft', command: 'onegayi.vsidian.table.insertColumnLeft', titleKey: 'command.table.insertColumnLeft.title', mode: 'live', writes: true, defaults: [] },
  { id: 'insertColumnRight', command: 'onegayi.vsidian.table.insertColumnRight', titleKey: 'command.table.insertColumnRight.title', mode: 'live', writes: true, defaults: [] },
  { id: 'deleteColumn', command: 'onegayi.vsidian.table.deleteColumn', titleKey: 'command.table.deleteColumn.title', mode: 'live', writes: true, defaults: [] },
  // #162 复制块链接：目标由光标所在块即时推导（标题行=复制标题链接；无块
  // id 先在块尾自动补写——一笔可撤销编辑），与正文右键菜单同一命令的两个
  // 入口。默认 ctrl+shift+c（2026-09-28 冲突核对：操作表与 keybindingRouter
  // 零占用，宿主编辑器正文无默认占用——评估记录见 docs/specs/keybindings.md）
  { id: 'blockCopyLink', command: 'onegayi.vsidian.block.copyLink', titleKey: 'command.block.copyLink.title', mode: 'live', writes: true, defaults: ['ctrl+shift+c'] },
  { id: 'openSettings', command: 'onegayi.vsidian.openSettings', titleKey: 'command.openSettings.title', mode: 'both', writes: false, defaults: [] },
  // #132 样式参考：打开设置页并定位「样式参考」分页（只读全局命令，双模式
  // 可用；默认不绑定——设置页入口常驻，快捷键留给用户按需绑定）
  { id: 'openStyleReference', command: 'onegayi.vsidian.openStyleReference', titleKey: 'command.openStyleReference.title', mode: 'both', writes: false, defaults: [] },
  // #145 导出样式参考 JSON：只读操作（把随 VSIX 分发的机器可读契约清单另存
  // 到用户路径，不写文档），双模式可用、默认不占键位——设置页「样式参考」
  // 分页的「导出 JSON」按钮与命令面板同一实现，评估记录见 keybindings.md
  { id: 'exportStyleReference', command: 'onegayi.vsidian.exportStyleReference', titleKey: 'command.exportStyleReference.title', mode: 'both', writes: false, defaults: [] },
  // #128 CSS 片段刷新：只读视图操作（重新扫描目录并广播），双模式可救回
  // 被片段影响的界面；默认不占键位。「打开 CSS 片段设置」不单列命令——
  // openSettings（双模式、默认未绑定）打开设置页后经左侧导航直达分页，
  // 见 docs/specs/keybindings.md 的评估记录
  { id: 'cssSnippetsRefresh', command: 'onegayi.vsidian.cssSnippets.refresh', titleKey: 'command.cssSnippets.refresh.title', mode: 'both', writes: false, defaults: [] },
  // #131 暂停/恢复全部片段：宿主侧命令（不依赖 webview 健康），全局冻结
  // 与逐项停用语义正交（暂停保留开关）。被片段影响的界面可用暂停立即
  // 撤下全部样式再按原配置恢复——双模式可用，默认不占键位
  { id: 'cssSnippetsPause', command: 'onegayi.vsidian.cssSnippets.pause', titleKey: 'command.cssSnippets.pause.title', mode: 'both', writes: false, defaults: [] },
  { id: 'cssSnippetsResume', command: 'onegayi.vsidian.cssSnippets.resume', titleKey: 'command.cssSnippets.resume.title', mode: 'both', writes: false, defaults: [] },
  // #198 索引维护：宿主侧命令（设置页按钮与命令面板共用同一 wiring，
  // 不依赖 webview 健康度）。索引维护属设置页/宿主域操作，不接管正文
  // 输入（mode: both 只表示两模式下命令均可用）；低频操作默认不占键位，
  // 评估记录见 docs/specs/keybindings.md
  { id: 'indexRebuild', command: 'onegayi.vsidian.index.rebuild', titleKey: 'command.index.rebuild.title', mode: 'both', writes: false, defaults: [] },
  { id: 'indexCleanup', command: 'onegayi.vsidian.index.cleanup', titleKey: 'command.index.cleanup.title', mode: 'both', writes: false, defaults: [] },
  // #318 外部搜索导航定位恢复——显式触发（命令面板可达）。恢复路径
  // 依赖内部命令 copyMatch 的剪贴板回读，自动捕获有歧义与副作用（#318
  // 原型验证结论评论），默认未绑定，用户可经键位设置自配（裁定依据与
  // 评估记录见 docs/specs/keybindings.md 与 docs/specs/search-reveal.md）
  { id: 'searchRevealLocate', command: 'onegayi.vsidian.searchReveal.locate', titleKey: 'command.searchReveal.locate.title', mode: 'both', writes: false, defaults: [] },
]

/** 视图中已有明确目标的按钮动作：命令面板、快捷键均可调用。 */
export const UI_OPERATIONS = [
  { id: 'paste', command: 'onegayi.vsidian.clipboard.paste', titleKey: 'command.clipboard.paste.title', mode: 'live', writes: true, defaults: ['ctrl+v', 'meta+v'] },
  // #417：mac 默认按修饰键规范序书写（shift 在 meta 前）——存储默认不再
  // 次归一，非规范序（此前的 meta+shift+v）永不匹配 keyStep 事件派生串
  { id: 'pastePlain', command: 'onegayi.vsidian.clipboard.pastePlain', titleKey: 'command.clipboard.pastePlain.title', mode: 'live', writes: true, defaults: ['ctrl+shift+v', 'shift+meta+v'] },
  { id: 'sidebarToggle', command: 'onegayi.vsidian.ui.sidebarToggle', titleKey: 'command.ui.sidebarToggle.title', mode: 'both', writes: false, defaults: [] },
  { id: 'outlineToggle', command: 'onegayi.vsidian.ui.outlineToggle', titleKey: 'command.ui.outlineToggle.title', mode: 'both', writes: false, defaults: [] },
  { id: 'outlineSearch', command: 'onegayi.vsidian.ui.outlineSearch', titleKey: 'command.ui.outlineSearch.title', mode: 'both', writes: false, defaults: [] },
  { id: 'outlineJumpBottom', command: 'onegayi.vsidian.ui.outlineJumpBottom', titleKey: 'command.ui.outlineJumpBottom.title', mode: 'both', writes: false, defaults: [] },
  { id: 'outlineReset', command: 'onegayi.vsidian.ui.outlineReset', titleKey: 'command.ui.outlineReset.title', mode: 'both', writes: false, defaults: [] },
  { id: 'outlineCollapseAll', command: 'onegayi.vsidian.ui.outlineCollapseAll', titleKey: 'command.ui.outlineCollapseAll.title', mode: 'both', writes: false, defaults: [] },
  { id: 'outlineExpandAll', command: 'onegayi.vsidian.ui.outlineExpandAll', titleKey: 'command.ui.outlineExpandAll.title', mode: 'both', writes: false, defaults: [] },
  // #197 反链面板：双模式 UI 操作（面板在 Live/阅读两模式均可用，切换为
  // 纯视图状态零写回）；默认不占键位——侧栏按钮与命令面板常驻入口，快捷键
  // 留给用户按需绑定（评估记录见 docs/specs/keybindings.md）
  { id: 'backlinksToggle', command: 'onegayi.vsidian.ui.backlinksToggle', titleKey: 'command.ui.backlinksToggle.title', mode: 'both', writes: false, defaults: [] },
  // 出链面板（出链面板批次）：与反链面板同款双模式 UI 操作（三面板互斥的
  // 纯视图状态翻转，零写回）；默认不占键位（评估记录见 docs/specs/keybindings.md）
  { id: 'outlinksToggle', command: 'onegayi.vsidian.ui.outlinksToggle', titleKey: 'command.ui.outlinksToggle.title', mode: 'both', writes: false, defaults: [] },
  // #208 刷新嵌入资源：工具栏刷新按钮的快捷键/命令面板入口（两条入口
  // 汇合——宿主命令经 UI_OPERATIONS 注册循环回发 ui.command，webview 与
  // 按钮共用同一发送实现，宿主编排在 documentSession 的 refresh.request
  // 处理唯一）。只读视图操作（不写文档），双模式可用，默认不占键位
  { id: 'refreshEditor', command: 'onegayi.vsidian.editor.refresh', titleKey: 'command.editor.refresh.title', mode: 'both', writes: false, defaults: [] },
  // #221 预览当前链接：悬停浮层的键盘入口（手动打开——焦点进入浮层、Esc
  // 返回触发处；Live 以光标处合法双链/普通链接为目标，Reading/面板以键盘
  // 聚焦的链接/条目为目标，无目标静默不误开；嵌入 ![[…]] 已有常驻内容不
  // 重复弹窗）。纯 webview 域只读操作（不写文档、无宿主往返），双模式
  // 生效（mode: both 只表示两模式下命令均可用——目标判定各自实现）；
  // 默认不占键位，键位留给用户按需绑定（评估记录见 docs/specs/keybindings.md）
  { id: 'hoverPreviewLink', command: 'onegayi.vsidian.ui.hoverPreviewLink', titleKey: 'command.ui.hoverPreviewLink.title', mode: 'both', writes: false, defaults: [] },
  // #337（P3-05）PDF 悬停预览翻页：只读操作（翻页不修改任何文档，页码仅
  // 控制预览呈现），作用于在场的 PDF 悬停浮层（无 PDF 浮层或翻出界时静默
  // 无效）；默认不占键位——翻页属 P3-06 全文滚动接入前的最小页码操作，
  // 评估记录见 docs/specs/keybindings.md
  { id: 'pdfPageNext', command: 'onegayi.vsidian.ui.hoverPdfPageNext', titleKey: 'command.ui.hoverPdfPageNext.title', mode: 'both', writes: false, defaults: [] },
  { id: 'pdfPagePrev', command: 'onegayi.vsidian.ui.hoverPdfPagePrev', titleKey: 'command.ui.hoverPdfPagePrev.title', mode: 'both', writes: false, defaults: [] },
  // #339（P3-07）PDF 缩放三操作：只读（只改预览呈现，不写任何文档），与
  // 翻页同款作用于**在场的 PDF 悬停浮层**（无 PDF 浮层或已达 scale 上限/
  // 下限时静默无效）；缩放受 PDF_RENDER_MAX_SCALE 费用上限与画布预算约束。
  // 默认不占键位——用户经快捷键设置自配（评估记录见 docs/specs/keybindings.md）
  { id: 'pdfZoomIn', command: 'onegayi.vsidian.ui.hoverPdfZoomIn', titleKey: 'command.ui.hoverPdfZoomIn.title', mode: 'both', writes: false, defaults: [] },
  { id: 'pdfZoomOut', command: 'onegayi.vsidian.ui.hoverPdfZoomOut', titleKey: 'command.ui.hoverPdfZoomOut.title', mode: 'both', writes: false, defaults: [] },
  { id: 'pdfZoomReset', command: 'onegayi.vsidian.ui.hoverPdfZoomReset', titleKey: 'command.ui.hoverPdfZoomReset.title', mode: 'both', writes: false, defaults: [] },
  // P2-04（#281）切换焦点嵌入的内部模式（Reading ↔ Live）：与嵌入卡片头部
  // 模式按钮同一实现（焦点不在嵌入编辑器内零操作）。切换本身只建/拆目标
  // 编辑端口、不写正文（writes: false——写门控按「是否写权威文本」判定）。
  // 规格约定模式切换默认未绑定；保存目标不设独立操作（复用焦点内
  // Ctrl+S 路由，见 syncController docKeydown 的 P2-04 段）
  { id: 'embedToggleMode', command: 'onegayi.vsidian.ui.embedToggleMode', titleKey: 'command.ui.embedToggleMode.title', mode: 'both', writes: false, defaults: [] },
  // P2-10（#287）+ P2-05（#282）合并口径：保存目标补独立可绑定入口（焦点内
  // Ctrl+S 路由继续有效，两入口共用同一出站——此前 P2-04 评估「不设独立
  // 操作」由 P2-10 按规格「保存目标登记可绑定入口」扩充）；显式关闭统一为
  // P2-05 退出确认链路（dirty 时先弹保存并关闭/丢弃修改并关闭/取消三项自
  // 绘模态，干净目标直接关闭；切回 Reading 并释放端口；与头部关闭按钮、
  // 嵌入内 Esc、删除活跃引用拦截四径同一实现）；冲突三项按规格登记（对比并解决/放弃
  // 当前版本/取消）——compare 的原生对比页与完整选择界面属 P2-12，本票
  // compare/cancel 为登记占位（无暂停现场零操作），discard 走既有恢复
  // 通道（经端口出站 sync.request → doc.resync 重新同步 = 放弃未提交输入
  // 版本，不回滚整个 B）。全部默认未绑定（规格「模式切换、冲突选择默认
  // 未绑定」）
  { id: 'embedSaveTarget', command: 'onegayi.vsidian.embed.saveTarget', titleKey: 'command.embed.saveTarget.title', mode: 'both', writes: false, defaults: [] },
  { id: 'embedClose', command: 'onegayi.vsidian.embed.close', titleKey: 'command.embed.close.title', mode: 'live', writes: false, defaults: [] },
  { id: 'conflictCompare', command: 'onegayi.vsidian.conflict.compare', titleKey: 'command.conflict.compare.title', mode: 'both', writes: false, defaults: [] },
  { id: 'conflictDiscard', command: 'onegayi.vsidian.conflict.discard', titleKey: 'command.conflict.discard.title', mode: 'both', writes: false, defaults: [] },
  { id: 'conflictCancel', command: 'onegayi.vsidian.conflict.cancel', titleKey: 'command.conflict.cancel.title', mode: 'both', writes: false, defaults: [] },
  // #237 多光标·上下添加光标：@codemirror/commands 内置命令，webview 本地
  // 消化（快捷键经 keybindingRouter 本地分支，命令面板经 ui.command 回发，
  // 两条入口共用 webview 同一实现，不做出站宿主往返）。仅 Live 正文生效
  // （阅读只读；写操作类——批次 D4「多光标为 Live 编辑能力」口径，本表
  // 首个 mode live + writes 的 UI 操作）。默认 ctrl+alt+up/down（对齐
  // VSCode；与操作表现有键位零冲突）；defaultKeymap 同键位内建绑定由
  // multicursor 扩展组的接管 keymap 退役——键位所有权归注册表（用户清空/
  // 改绑后内建绑定不得复活）
  { id: 'addCursorAbove', command: 'onegayi.vsidian.editor.addCursorAbove', titleKey: 'command.editor.addCursorAbove.title', mode: 'live', writes: true, defaults: ['ctrl+alt+up'] },
  { id: 'addCursorBelow', command: 'onegayi.vsidian.editor.addCursorBelow', titleKey: 'command.editor.addCursorBelow.title', mode: 'live', writes: true, defaults: ['ctrl+alt+down'] },
  // #239 中文分词词级移动四操作（批次文档 §3 钉住：Live 编辑能力，
  // writes=true 类——据此走 router 的 allowWrites 焦点门控，find 输入框
  // 等非正文焦点不劫持）。默认 ctrl+方向（Windows/Linux）与 alt+方向
  // （mac 词移动惯例；meta+left/right 不注册——mac Cmd+方向为行首/行尾
  // 惯例不被覆盖）。Shift 变体单列操作（router 按整串 chord 精确匹配，
  // ctrl+left 不含 shift——扩选必须独立注册）。执行装配在
  // keybindingRouter 本地分支（同步直达，不出站宿主往返）；命令面板经
  // UI_OPERATIONS 注册循环 → ui.command 回流（评估记录见 keybindings.md）
  { id: 'cursorWordLeft', command: 'onegayi.vsidian.wordMotion.cursorLeft', titleKey: 'command.wordMotion.cursorLeft.title', mode: 'live', writes: true, defaults: ['ctrl+left', 'alt+left'] },
  { id: 'selectWordLeft', command: 'onegayi.vsidian.wordMotion.selectLeft', titleKey: 'command.wordMotion.selectLeft.title', mode: 'live', writes: true, defaults: ['ctrl+shift+left', 'alt+shift+left'] },
  { id: 'cursorWordRight', command: 'onegayi.vsidian.wordMotion.cursorRight', titleKey: 'command.wordMotion.cursorRight.title', mode: 'live', writes: true, defaults: ['ctrl+right', 'alt+right'] },
  { id: 'selectWordRight', command: 'onegayi.vsidian.wordMotion.selectRight', titleKey: 'command.wordMotion.selectRight.title', mode: 'live', writes: true, defaults: ['ctrl+shift+right', 'alt+shift+right'] },
  // #238 选下一处相同词族（批次 D3）：匹配选项与查找面板三开关同源
  //（shared/findOptions），Live 编辑能力（writes=true 走 router 焦点门控）。
  // 默认键对齐 VSCode：ctrl+d（选下一处）、ctrl+k ctrl+d（两段弦——跳过
  // 当前；router 整串 chord 匹配与 1.2s 前缀超时已有基建）、ctrl+shift+l
  // （全选）。「选上一处」对齐 VSCode 无默认键位（命令面板入口可达）。
  // defaultKeymap/searchKeymap 均未绑定这三键（searchKeymap 不装配），
  // 无内建绑定复活问题，不需吞键接管；冲突核对记录见 keybindings.md
  { id: 'findSelectNext', command: 'onegayi.vsidian.find.selectNext', titleKey: 'command.find.selectNext.title', mode: 'live', writes: true, defaults: ['ctrl+d'] },
  { id: 'findSelectPrevious', command: 'onegayi.vsidian.find.selectPrevious', titleKey: 'command.find.selectPrevious.title', mode: 'live', writes: true, defaults: [] },
  { id: 'findSkipCurrent', command: 'onegayi.vsidian.find.skipCurrent', titleKey: 'command.find.skipCurrent.title', mode: 'live', writes: true, defaults: ['ctrl+k ctrl+d'] },
  { id: 'findAllOccurrences', command: 'onegayi.vsidian.find.allOccurrences', titleKey: 'command.find.allOccurrences.title', mode: 'live', writes: true, defaults: ['ctrl+shift+l'] },
  // #413（#409 T02）标题折叠五操作：Live 编辑器视图态（writes: false——
  // 折叠零写回不改选区语义上的「文档写」，与 outlineCollapseAll 同口径），
  // 无 Live 正文实例/无目标即静默。默认键对齐宿主 VSCode 惯例
  //（editor.fold/unfold/toggleFold/foldAll/unfoldAll 的 Win 与 mac 键位族，
  // mac 形态与 find 的 meta+f 同款双登记；修饰键序按 normalizeChord 规范
  // 形态 ctrl→alt→shift→meta 书写——存储默认不再次归一，非规范序永不
  // 匹配事件派生串）。键位所有权归注册表，不经 CM6 keymap；执行装配在
  // keybindingRouter document 捕获层本地分支 + 命令面板经本表注册循环
  // 回发 ui.command，两入口共用同一执行实现（syncController.
  // runHeadingFoldCommand → headingFold effect 直驱）。Ctrl+Shift+[ / ]
  // 依赖 keyStep 的 shift 上档符号映射（美式布局事件字符 { } 折回
  // bracketleft/right）。冲突核对（2026-10-09 #240 收口形态复核）：与
  // 全部注册表默认零占用；Ctrl+K 弦与既有唯一弦 ctrl+k ctrl+d 首段重叠
  // 不冲突（整串精确匹配），结论由单测钉住。
  { id: 'headingFold', command: 'onegayi.vsidian.heading.fold', titleKey: 'command.heading.fold.title', mode: 'live', writes: false, defaults: ['ctrl+shift+bracketleft', 'alt+meta+bracketleft'] },
  { id: 'headingUnfold', command: 'onegayi.vsidian.heading.unfold', titleKey: 'command.heading.unfold.title', mode: 'live', writes: false, defaults: ['ctrl+shift+bracketright', 'alt+meta+bracketright'] },
  { id: 'headingToggleFold', command: 'onegayi.vsidian.heading.toggleFold', titleKey: 'command.heading.toggleFold.title', mode: 'live', writes: false, defaults: ['ctrl+k ctrl+l', 'meta+k meta+l'] },
  { id: 'headingFoldAll', command: 'onegayi.vsidian.heading.foldAll', titleKey: 'command.heading.foldAll.title', mode: 'live', writes: false, defaults: ['ctrl+k ctrl+0', 'meta+k meta+0'] },
  { id: 'headingUnfoldAll', command: 'onegayi.vsidian.heading.unfoldAll', titleKey: 'command.heading.unfoldAll.title', mode: 'live', writes: false, defaults: ['ctrl+k ctrl+j', 'meta+k meta+j'] },
] as const satisfies readonly KeybindingOperation[]
export type UiOperationId = (typeof UI_OPERATIONS)[number]['id']
export function isUiOperationId(value: unknown): value is UiOperationId {
  return typeof value === 'string' && UI_OPERATIONS.some((op) => op.id === value)
}

export const KEYBINDING_OPERATIONS: readonly KeybindingOperation[] = [
  ...FORMAT_OPERATIONS.map((op) => ({
    id: op.id, command: op.command, titleKey: op.titleKey,
    mode: op.mode, writes: op.writes,
    defaults: op.defaultKey ? [op.defaultKey] : op.id === 'italic' ? ['ctrl+i'] : [],
  })),
  ...extra,
  ...UI_OPERATIONS,
]

const byId = new Map(KEYBINDING_OPERATIONS.map((op) => [op.id, op]))
export type KeybindingOverrides = Record<string, string[]>

// ---- #359 T10 运行期操作层（附加组件命令）：编译期表之上的进程内扩展 ----
// 组件命令经页面 SDK 注册（编辑器 webview）或宿主目录推送（设置页 webview /
// 宿主侧）喂入本表；操作进入统一快捷键管理（冲突检查、生效绑定、路由与
// 设置页全链消费合并视图 allKeybindingOperations()）。三环境（编辑器页、
// 设置页、宿主）各持一份实例，由各自通道同步——本模块不做跨端广播。

/** 运行期操作条目（附加组件命令；titleOverride 优先于 titleKey 取词——
 *  组件文案是自由文本，不伪造 MessageKey 进内置字典） */
export interface RuntimeKeybindingOperation extends KeybindingOperation {
  /** 归属组件 ID（命名空间来源；设置页归属呈现用） */
  readonly addonId: string
  /** 组件提供的操作名（自由文本） */
  readonly titleOverride: string
}

const runtimeOps = new Map<string, RuntimeKeybindingOperation>()

/** 全量替换运行期操作表（幂等对账——目录推送与注册表同步的公共入口） */
export function setRuntimeOperations(ops: readonly RuntimeKeybindingOperation[]): void {
  runtimeOps.clear()
  for (const op of ops) {
    runtimeOps.set(op.id, op)
  }
}

/** 当前运行期操作快照 */
export function runtimeOperations(): readonly RuntimeKeybindingOperation[] {
  return [...runtimeOps.values()]
}

/** 合并视图（编译期内置 + 运行期组件命令）：统一管理的单一读取面 */
export function allKeybindingOperations(): readonly KeybindingOperation[] {
  return [...KEYBINDING_OPERATIONS, ...runtimeOps.values()]
}

/** 测试钩子：还原运行期层 */
export function __resetRuntimeOperationsForTest(): void {
  runtimeOps.clear()
}

/** 合并视图的 id 查找（内置优先——命名空间 id 含点，与内置无点 id 不撞） */
function operationById(id: string): KeybindingOperation | undefined {
  return byId.get(id) ?? runtimeOps.get(id)
}

/** #359 T10（#427 修订）：chord 是否含保留 Tab 段——段内键为 tab 且无
 *  ctrl/alt/meta 修饰（裸 Tab 与 Shift+Tab）。输入须为 normalizeChord
 *  归一化形态（小写、修饰序固定）——本函数不做归一化，直接喂原始
 *  大小写形态（如 'Ctrl+Tab'）会漏判；调用点（默认绑定校验）已先归一。这两形态属 #125 情境输入
 *  固定链（围栏越界 → 表格导航 → 行缩进），任何命令绑定都会被
 *  keybindingRouter 先于 CM6 keymap 拦截（stopPropagation）破坏该链，
 *  注册期即拒。ctrl/alt/meta+Tab 不参与三段链（链只匹配裸 Tab/Shift+Tab
 *  语义），#427 起放行；宿主/操作系统可能占用个别修饰组合（如宿主标签
 *  切换），注册成功不保证按键事件可达——组件文档明示。 */
export function chordContainsReservedTab(chord: string): boolean {
  return chord.split(' ').some((step) => {
    const parts = step.split('+')
    if (!parts.includes('tab')) {
      return false
    }
    return !parts.some((p) => p === 'ctrl' || p === 'alt' || p === 'meta')
  })
}

const modifiers = new Set(['ctrl', 'alt', 'shift', 'meta'])
const keyAliases: Record<string, string> = {
  control: 'ctrl', cmd: 'meta', command: 'meta', option: 'alt', esc: 'escape',
  spacebar: 'space', ' ': 'space', arrowup: 'up', arrowdown: 'down',
  arrowleft: 'left', arrowright: 'right',
}
const validKey = /^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4])|escape|enter|tab|space|backspace|delete|home|end|pageup|pagedown|up|down|left|right|minus|equal|comma|period|slash|backslash|semicolon|quote|bracketleft|bracketright)$/

export function normalizeChord(value: string): string | null {
  const steps = value.trim().toLowerCase().replace(/\s*\+\s*/g, '+').split(/\s+/)
  if (!steps.length || steps.length > 2) return null
  const normalized: string[] = []
  for (const step of steps) {
    const parts = step.split('+').map((p) => keyAliases[p.trim()] ?? p.trim())
    if (parts.some((p) => !p)) return null
    const keys = parts.filter((p) => !modifiers.has(p))
    if (keys.length !== 1 || !validKey.test(keys[0])) return null
    const mods = parts.filter((p) => modifiers.has(p))
    if (new Set(mods).size !== mods.length) return null
    normalized.push([...['ctrl', 'alt', 'shift', 'meta'].filter((p) => mods.includes(p)), keys[0]].join('+'))
  }
  return normalized.join(' ')
}

export function isKeybindingOperationId(value: unknown): value is string {
  return typeof value === 'string' && (byId.has(value) || runtimeOps.has(value))
}

/** 缺键=跟随当前默认；空数组=明确禁用；非空=用户覆盖。 */
export function getEffectiveBindings(overrides: KeybindingOverrides, operationId: string): readonly string[] {
  const op = operationById(operationId)
  if (!op) return []
  return Object.prototype.hasOwnProperty.call(overrides, operationId)
    ? overrides[operationId] : op.defaults
}

export function sanitizeStoredOverrides(stored: unknown): KeybindingOverrides {
  const result: KeybindingOverrides = {}
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result
  for (const [id, value] of Object.entries(stored)) {
    // #359 T10：命名空间键（含点）即附加组件命令——组件不在场（停用/未装）
    // 时也保留用户绑定与显式清空（「重启保留」契约）；无点未知键仍按垃圾
    // 剔除（编译期表 + 运行期表均未知）
    if (!byId.has(id) && !runtimeOps.has(id) && !id.includes('.')) continue
    if (!Array.isArray(value)) continue
    const bindings = value.map((item) => typeof item === 'string' ? normalizeChord(item) : null)
    if (bindings.some((item) => !item) || new Set(bindings).size !== bindings.length) continue
    result[id] = bindings as string[]
  }
  return result
}

function modesOverlap(a: BindingMode, b: BindingMode): boolean {
  return a === 'both' || b === 'both' || a === b
}
function chordOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)
}

export function findBindingConflicts(overrides: KeybindingOverrides, operationId: string, chord: string): string[] {
  const operation = operationById(operationId)
  const normalized = normalizeChord(chord)
  if (!operation || !normalized) return []
  return allKeybindingOperations().filter((other) => other.id !== operationId &&
    modesOverlap(operation.mode, other.mode) &&
    getEffectiveBindings(overrides, other.id).some((binding) => chordOverlap(binding, normalized)))
    .map((other) => other.id)
}

/** 快捷键分页筛选签维度（#155）：冲突/全部/已分配/由我分配/未分配 */
export type KeybindingFilterKind = 'all' | 'conflict' | 'assigned' | 'userAssigned' | 'unassigned'

export const KEYBINDING_FILTER_KINDS: readonly KeybindingFilterKind[] =
  ['all', 'conflict', 'assigned', 'userAssigned', 'unassigned']

/**
 * 当前生效键位存在冲突的操作 id 集合（筛选签「冲突」的判定源）：双方生效
 * 模式可交叠且任一键位重叠（含两段前缀重叠）即各自计入；单侧无绑定不构成
 * 冲突。纯函数，不与录入路径（findBindingConflicts）共享状态。
 */
export function findConflictedOperationIds(overrides: KeybindingOverrides): Set<string> {
  const conflicted = new Set<string>()
  const operations = allKeybindingOperations()
  for (let i = 0; i < operations.length; i++) {
    const source = operations[i]
    const sourceBindings = getEffectiveBindings(overrides, source.id)
    if (!sourceBindings.length) continue
    for (let j = i + 1; j < operations.length; j++) {
      const other = operations[j]
      if (!modesOverlap(source.mode, other.mode)) continue
      const otherBindings = getEffectiveBindings(overrides, other.id)
      if (sourceBindings.some((chord) => otherBindings.some((candidate) => chordOverlap(chord, candidate)))) {
        conflicted.add(source.id)
        conflicted.add(other.id)
      }
    }
  }
  return conflicted
}

/**
 * 筛选签谓词（#155）：操作在指定维度下是否可见。userAssigned 按 overrides
 * 显式登记判定（含空数组=显式禁用，与存储语义一致）；assigned/unassigned
 * 按生效绑定判定；conflict 复用 findConflictedOperationIds（可传入复用集合
 * 避免逐行重算）。
 */
export function operationMatchesFilter(overrides: KeybindingOverrides, operationId: string,
  filter: KeybindingFilterKind, conflicted: ReadonlySet<string> = findConflictedOperationIds(overrides)): boolean {
  if (filter === 'conflict') return conflicted.has(operationId)
  if (filter === 'userAssigned') return Object.prototype.hasOwnProperty.call(overrides, operationId)
  if (filter === 'assigned') return getEffectiveBindings(overrides, operationId).length > 0
  if (filter === 'unassigned') return getEffectiveBindings(overrides, operationId).length === 0
  return true
}

export type BindingChangeResult = { ok: true; overrides: KeybindingOverrides } |
  { ok: false; reason: 'invalid' | 'conflict'; conflicts: string[] }

export function applyBindingChange(overrides: KeybindingOverrides, operationId: string,
  bindings: readonly string[], replaceConflicts: boolean): BindingChangeResult {
  if (!isKeybindingOperationId(operationId)) return { ok: false, reason: 'invalid', conflicts: [] }
  const normalized = bindings.map(normalizeChord)
  if (normalized.some((v) => !v) || new Set(normalized).size !== normalized.length ||
    normalized.some((a, index) => normalized.some((b, other) => index !== other && chordOverlap(a!, b!)))) {
    return { ok: false, reason: 'invalid', conflicts: [] }
  }
  const desired = normalized as string[]
  const conflicts = [...new Set(desired.flatMap((chord) => findBindingConflicts(overrides, operationId, chord)))]
  if (conflicts.length && !replaceConflicts) return { ok: false, reason: 'conflict', conflicts }
  const next = { ...overrides, [operationId]: desired }
  for (const id of conflicts) {
    next[id] = getEffectiveBindings(overrides, id).filter((binding) =>
      !desired.some((chord) => chordOverlap(binding, chord)))
  }
  return { ok: true, overrides: next }
}

export function resolveKeybinding(overrides: KeybindingOverrides, mode: 'live' | 'reading',
  chord: string, allowWrites = true): { kind: 'none' } | { kind: 'prefix' } | { kind: 'command'; id: string } {
  const normalized = normalizeChord(chord)
  if (!normalized) return { kind: 'none' }
  // 用户覆盖优先于后来加入/修改的默认值，升级不能让新默认抢走旧自定义。
  const operations = allKeybindingOperations()
  for (const custom of [true, false]) {
    for (const op of operations) {
      if (Object.prototype.hasOwnProperty.call(overrides, op.id) !== custom ||
        (op.mode !== 'both' && op.mode !== mode) || (!allowWrites && op.writes)) continue
      for (const binding of getEffectiveBindings(overrides, op.id)) {
        if (binding === normalized) return { kind: 'command', id: op.id }
        if (binding.startsWith(`${normalized} `)) return { kind: 'prefix' }
      }
    }
  }
  return { kind: 'none' }
}

/** #444：键位标签的平台呈现维度（仅渲染层——存储与比较恒用规范序小写
 *  形态，不受本状态影响）。webview 端按 navigator 探测默认；宿主与测试经
 *  setKeybindingLabelPlatform 显式注入（宿主当前无标签消费点，注入留作
 *  未来通知类消费的接线位）。 */
export type KeybindingLabelPlatform = 'mac' | 'windows' | 'linux'

let labelPlatform: KeybindingLabelPlatform | null = null

function detectLabelPlatform(): KeybindingLabelPlatform {
  if (typeof navigator === 'undefined') {
    return 'windows'
  }
  const ua = navigator.userAgent
  if (/Macintosh|Mac OS X|MacIntel/i.test(ua)) return 'mac'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'windows'
}

/** 显式指定平台（宿主按 process.platform 注入；webview 默认走探测） */
export function setKeybindingLabelPlatform(platform: KeybindingLabelPlatform): void {
  labelPlatform = platform
}

/** 当前标签平台（首访探测并缓存） */
export function keybindingLabelPlatform(): KeybindingLabelPlatform {
  return (labelPlatform ??= detectLabelPlatform())
}

/** 测试钩子：还原平台探测默认 */
export function __resetKeybindingLabelPlatformForTest(): void {
  labelPlatform = null
}

export function formatBindingLabel(chord: string): string {
  const platform = keybindingLabelPlatform()
  const metaLabel = { mac: 'Cmd', windows: 'Win', linux: 'Super' }[platform]
  const labelOf = (part: string): string =>
    // #413：符号物理键名渲染为字符形态（bracketleft → [），设置页标签与
    // 捕获框不出现 BRACKETLEFT 式大写名；与 keyStep 别名同一份键名词表。
    // #444：meta 按平台渲染（mac: Cmd / Windows: Win / Linux: Super）
    ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: metaLabel, escape: 'Esc', space: 'Space',
      minus: '-', equal: '=', comma: ',', period: '.', slash: '/', backslash: '\\',
      semicolon: ';', quote: "'", bracketleft: '[', bracketright: ']' })[part] ?? part.toUpperCase()
  return chord.split(' ').map((step) => {
    const labels = step.split('+').map(labelOf)
    // #444：mac 用户视角 Cmd 前置（keybindings.md「Cmd+Shift+V」式）——
    // 存储规范序 shift 在 meta 前，mac 标签把 meta 提到段首；Windows/Linux
    // 保持位置渲染（meta 后置，与平台惯例一致，票面未要求改序）
    const metaIndex = step.split('+').indexOf('meta')
    if (platform === 'mac' && metaIndex >= 0) {
      labels.unshift(labels.splice(metaIndex, 1)[0]!)
    }
    return labels.join('+')
  }).join(' ')
}
