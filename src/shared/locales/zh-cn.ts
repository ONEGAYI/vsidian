// 简体中文语言包（#93 i18n 基础设施）。以 `Record<MessageKey, string>` 约束
// 到英文包的类型基准：缺键、多键均编译失败（编译期 parity）；运行时键集
// 一致性另由 test/unit/i18nLocales.test.ts 钉住（防构建旁路）。
// #94/#95 起存量中文文案迁入本包（值即原硬编码字面量，保证呈现不变）。
import type { MessageKey } from './en'

export const zhCn: Record<MessageKey, string> = {
  'setting.pastePreserveFormatting.title': '粘贴保留富文本',
  'setting.pastePreserveFormatting.description': '普通粘贴时，将支持的富文本格式转换为 Markdown。',
  'setting.pasteAskBefore.title': '粘贴前询问',
  'setting.pasteSplitUndo.title': '分步撤销富文本粘贴',
  'setting.pasteSplitUndo.description': '先撤销粘贴格式，再撤销文本；关闭时一次撤销全部粘贴内容。',
  'setting.pasteAskBefore.description': '遇到可转换格式时询问是否保留，可重新开启以恢复提示。',
  'paste.dialog.question': '是否保留粘贴内容中的格式？',
  'paste.dialog.keep': '保留格式',
  'paste.dialog.plain': '仅粘贴文本',
  'paste.dialog.cancel': '取消',
  'paste.dialog.remember': '不再提示该信息',
  'toast.pasteFormattingKept': '已保留粘贴内容中的格式',
  'toast.pasteFormattingUndone': '已撤销粘贴格式，再撤销一次可撤回粘贴的文本',
  'toast.pasteFormattingFailed': '无法保留格式，已粘贴为纯文本',
  'toast.pasteNoText': '无法粘贴：未能提取可用文本',
  'toast.pastePreferencesFailed': '未能保存粘贴偏好，本次选择仅对本次粘贴生效',
  'command.clipboard.paste.title': '粘贴',
  'command.clipboard.pastePlain.title': '粘贴纯文本',
  'contextMenu.pastePlain': '粘贴纯文本',
  'toast.pasteImageOnly': '无法将图片粘贴为纯文本，请使用{paste}粘贴图片',
  'toast.pasteTextOnly': '已粘贴文本，未粘贴图片；如需图片，请使用{paste}',
  'styleRef.category.toast': '轻提示',
  'styleRef.category.wikilinkSuggest': '双链联想候选',
  // ---- wikilinkSuggest.（双链文件联想候选，#376 T01；#378 T03 占位）----
  'wikilinkSuggest.list.ariaLabel': '双链联想候选',
  'wikilinkSuggest.status.loading': '正在搜索文件…',
  'wikilinkSuggest.status.empty': '没有匹配的文件',
  'wikilinkSuggest.status.noWorkspace': '未打开文件夹——可继续手写链接',
  'wikilinkSuggest.status.notReady': '索引准备中——可继续手写链接',
  'wikilinkSuggest.status.updating': '索引仍在构建——当前为部分结果',
  'wikilinkSuggest.status.more': '还有 {count} 项——按 ↓ 继续加载',
  // #378 T03：标题/块占位提示（占位只作提示，不可确认、不写正文）
  'wikilinkSuggest.placeholder.heading': '输入小标题…',
  'wikilinkSuggest.placeholder.block': '输入块 ID…',
  // 验收反馈（2026-10-06）：浮层底部键提示条——按阶段裁剪显示当前可用进阶键
  'wikilinkSuggest.hint.heading': '输入 # 可以链接到标题',
  'wikilinkSuggest.hint.block': '输入 ^ 链接文本块',
  'wikilinkSuggest.hint.alias': '输入 | 指定显示的文本',
  // #379 T04：标题阶段状态与候选（明确 Markdown 目标的真实候选；
  // 失败分真实状态，不伪装空结果）
  'wikilinkSuggest.status.headingLoading': '正在读取标题…',
  'wikilinkSuggest.status.headingEmpty': '没有匹配的标题',
  'wikilinkSuggest.status.headingNotFound': '未找到目标文档——可继续手写锚点',
  'wikilinkSuggest.status.headingNotMd': '目标不是 Markdown 文件——无标题候选',
  'wikilinkSuggest.status.headingReadError': '目标文档读取失败——可继续手写锚点',
  'wikilinkSuggest.heading.meta': 'H{level} · 行 {line}',
  'wikilinkSuggest.toast.duplicateHeading': '存在多个同名标题，跳转将定位到第一个',
  // #380 T05：块阶段状态与候选（无 ID 块照常列出；接受经宿主补写 ^id）
  'wikilinkSuggest.status.blockLoading': '正在读取块…',
  'wikilinkSuggest.status.blockEmpty': '没有匹配的块',
  'wikilinkSuggest.status.blockNotFound': '未找到目标文档——可继续手写块引用',
  'wikilinkSuggest.status.blockNotMd': '目标不是 Markdown 文件——无块候选',
  'wikilinkSuggest.status.blockReadError': '目标文档读取失败——可继续手写块引用',
  'wikilinkSuggest.status.blockAccepting': '正在补写块 ID…',
  'wikilinkSuggest.block.meta': '行 {line} · {count} 行',
  'wikilinkSuggest.toast.blockAcceptFailed': '未能补写块 ID——已保留输入',
  // #380 T05：宿主侧撤回协调提示（来源撤销时尽力撤回目标新增标记）
  'host.wikilinkBlockIdKept': '自动新增的块标记 ^{id} 未撤回：{reason}',
  'host.wikilinkBlockIdKeptReason.versionChanged': '目标文档已变化',
  'host.wikilinkBlockIdKeptReason.markerChanged': '块标记已变化',
  'host.wikilinkBlockIdKeptReason.newUse': '已有其他引用',
  'host.wikilinkBlockIdKeptReason.applyFailed': '写入失败',
  'host.wikilinkBlockIdKeptReason.notFound': '目标不可读',
  'host.wikilinkBlockIdRebuildFailed': '未能重建块标记 ^{id}——链接可能失效',
  'styleRef.category.richPaste': '粘贴询问',
  // ---- settings.（设置页框架）----
  'settings.pageTitle': 'Vsidian 设置',
  'settings.searchPlaceholder': '搜索设置…',
  'settings.searchAriaLabel': '搜索全部设置',
  'settings.navLabel': '选项',
  'settings.navAriaLabel': '设置分类',
  'settings.saving': '正在保存…',
  'settings.saveDone': '设置已保存',
  'settings.saveFailed': '未能保存设置，已恢复当前生效值。请重试。',
  'settings.editorCategory': '编辑器',
  'settings.searchResults': '搜索结果',
  'settings.searchCount': '找到 {count} 项设置',
  'settings.searchEmpty': '未找到匹配的设置，请尝试其他关键词。',
  'settings.editorSubtitle': '调整编辑与呈现行为。更改会自动保存。',
  'settings.empty': '暂无可配置项。',
  /** 设置页编辑器分组页内的组内小节标题（#163 二轮还原：侧栏只留
   *  常规/编辑器，分类以下方组内标题呈现——group* 键族） */
  'settings.groupDisplay': '显示',
  /** 设置页「常规」分组标题（#96 general.* 设置项的归属分组） */
  'settings.generalSection': '常规',
  /** 设置页「常规」分组副文案（对齐「编辑器」分组的说明句式） */
  'settings.generalSectionDescription': '调整 Vsidian 的基础行为。更改会自动保存。',
  /** 编辑器页内小节（#163 二轮还原）：editor.symbol* 输入行为类 */
  'settings.groupSymbols': '符号输入',
  /** 编辑器页内小节：编辑能力类（多光标，#237） */
  'settings.groupEditing': '编辑',
  /** 编辑器页内小节：codeblock.* 呈现类 */
  'settings.groupCodeblock': '代码块',
  /** 「文件与链接」分页内小节（#332 自编辑器页迁入）：image.* 图片粘贴设置 */
  'settings.groupImage': '图片',
  /** 「文件与链接」分页内小节（#298 建组、#332 随分页迁移）：hover.* 悬停
   *  预览族与 embed.* 正文嵌入族 */
  'settings.groupRefview': '引用视图',
  /** 设置页「文件与链接」附加分页（#332：原「索引维护」改名承接图片/
   *  引用视图/索引维护三组，对齐 Obsidian 文件与链接分页心智） */
  'settings.filesLinksSection': '文件与链接',
  /** 设置页「文件与链接」分页副文案 */
  'settings.filesLinksSectionDescription': '图片粘贴存放、引用视图悬停与嵌入呈现，以及工作区引用索引的排除、重建与清理维护。更改会自动保存。',
  /** 设置页「实验性功能」侧栏分组（experimental.* 设置项的归属分组；
   *  实验性开闭默认随功能落地状态，出问题可关闭回退稳定行为） */
  'settings.experimentalSection': '实验性功能',
  'settings.experimentalSectionDescription': '尚未定型的功能开关。默认按当前落地行为开启，遇到问题可关闭回退。',
  /** 实验性页内小节：experimental.table.* 表格行为类 */
  'settings.groupExperimentalTable': '表格行为',

  // ---- keybindingSettings.（快捷键分页）----
  'keybindingSettings.title': '快捷键',
  'keybindingSettings.description': '管理 Vsidian 操作的快捷键。冲突检查覆盖 Vsidian 内部；VS Code 和其他扩展的有效键位无法完整查询。',
  'keybindingSettings.modeLive': '实时预览',
  'keybindingSettings.modeReading': '阅读',
  'keybindingSettings.modeBoth': '实时预览、阅读',
  'keybindingSettings.modeLiveReading': '实时预览 · 阅读',
  'keybindingSettings.nameSeparator': '、',
  'keybindingSettings.saving': '正在保存…',
  'keybindingSettings.saved': '快捷键已保存并立即生效。',
  'keybindingSettings.saveFailedStorage': '保存失败，已恢复当前生效绑定。',
  'keybindingSettings.conflictInternal': 'Vsidian 内部冲突：{names}',
  'keybindingSettings.conflictSave': 'Vsidian 内部冲突：{names}。可选择替换原绑定。',
  'keybindingSettings.conflictReset': '恢复默认与 {names} 冲突。可选择替换原绑定。',
  'keybindingSettings.conflictRow': '与 {names} 冲突。',
  'keybindingSettings.invalid': '快捷键无效，未保存。',
  'keybindingSettings.resetFailed': '恢复默认失败。',
  'keybindingSettings.searchNamePlaceholder': '搜索操作名',
  'keybindingSettings.keySearchToggle': '按按键筛选',
  'keybindingSettings.capturePlaceholder': '按下快捷键…',
  'keybindingSettings.filterAll': '全部',
  'keybindingSettings.filterConflicts': '冲突',
  'keybindingSettings.filterAssigned': '已分配',
  'keybindingSettings.filterUserAssigned': '由我分配',
  'keybindingSettings.filterUnassigned': '未分配',
  'keybindingSettings.moreActions': '更多操作',
  'keybindingSettings.commitCapture': '提交键位',
  'keybindingSettings.resetAll': '全部恢复默认',
  'keybindingSettings.noMatch': '没有匹配的操作。',
  'keybindingSettings.unbound': '未绑定',
  'keybindingSettings.addBinding': '添加绑定',
  'keybindingSettings.clearBindings': '清空绑定',
  'keybindingSettings.resetDefault': '恢复默认',
  'keybindingSettings.replaceConflicts': '替换原绑定',

  // ---- setting.（设置项定义）----
  'setting.editorLineNumbers.title': '显示行号',
  'setting.editorLineNumbers.description': '在实时预览左侧留白带内显示源文件行号（阅读模式不显示）。',
  /** #296 块内表格渲染：引用块/列表等容器内的表格是否网格化渲染（仅实时预览） */
  'setting.experimentalTableRender.title': '块内表格渲染',
  'setting.experimentalTableRender.description': '在实时预览中将引用块、列表等容器内的表格渲染为可编辑网格，关闭后按源码文本呈现。阅读模式不受此设置影响，始终渲染表格。',
  'setting.readableLineWidth.title': '可读行宽',
  'setting.readableLineWidth.description': '实时预览与阅读模式正文列的最大宽度：0 表示铺满可用宽度；设为具体数值后正文按该宽度限宽，在主编辑区内居中，右侧大纲栏展开时自动避让收缩。',
  'setting.readableLineWidthFill': '铺满',
  /** #318 搜索定位打开提示（editor.searchRevealHint） */
  'setting.searchRevealHint.title': '搜索定位打开提示',
  'setting.searchRevealHint.description': '从工作区搜索结果打开笔记并首次激活时，右下角显示带「定位」按钮的提示气泡，点击后跳转到搜索选中的匹配处。提示本身不做任何操作——只有点击按钮才会定位。每篇笔记每会话最多提示一次；命令与键位入口不受此设置影响。',
  /** #222 嵌入卡片限高（阅读模式嵌入内容超出后内部滚动） */
  'setting.embedMaxHeight.title': '嵌入内容最大高度',
  'setting.embedMaxHeight.description': '阅读模式嵌入卡片内容区的最大高度：较短笔记保持自然高度，超出该值的内容在卡片内部滚动。',
  'setting.embedMaxDepth.title': '嵌入笔记展开层级',
  'setting.embedMaxDepth.description': '自动展开嵌入内容中的引用。来源笔记是第 0 层；设为 1 只显示直接嵌入，设为 3 再显示后续两层。',
  /** #298 悬停预览总开关（hover.enabled） */
  'setting.hoverEnabled.title': '悬停预览引用文档',
  'setting.hoverEnabled.description': '指针悬停链接时弹出引用文档预览浮层，覆盖阅读模式正文、实时预览与反链/出链面板（含浮层内子引用）。关闭后浮层的全部触发入口——悬停与「预览当前链接」键盘命令——均不再打开浮层；正文嵌入卡片不受影响。',
  /** #299 跳转目标提示（hover.targetTip） */
  'setting.hoverTargetTip.title': '悬停显示跳转目标',
  'setting.hoverTargetTip.description': '悬停在引用上且不会弹出引用视图浮层时（如实时预览中未按住 Ctrl，或悬停预览总开关已关闭），短暂停留后显示目标位置的路径提示。独立于「悬停预览引用文档」总开关——关闭总开关后提示仍可用。',
  /** #342（P3-10）外链预览设置（hover.externalEnabled / hover.externalShape） */
  'setting.hoverExternalEnabled.title': '悬停预览外部链接卡片',
  'setting.hoverExternalEnabled.description': '开启后悬停 HTTP(S) 网页链接会显示标题、摘要与域名卡片：由扩展宿主发起受限网络抓取（仅 HTML 元信息、限制超时与响应大小、拒绝内网地址），不发送笔记内容、路径或任何登录凭据。默认关闭——关闭时不发起任何网络请求。远程开发（Remote SSH）下抓取发生在远端机器。',
  'setting.hoverExternalShape.title': '外链预览形态',
  'setting.hoverExternalShape.description': '选择悬停外部链接时的呈现形态。「卡片」显示标题、摘要与域名；「原网页」在浮层内尽力显示网页本身——网页内容在编辑器本地加载，会连接目标站点及其第三方服务（与宿主侧仅抓取元信息的受限抓取是两条独立的网络路径），不继承日常浏览器的登录状态；网站拒绝被内嵌或无法安全显示时自动退回卡片并给出原因，退回不会改写本选择。抓取缓存按链接地址与形态分别记录。',
  'setting.hoverExternalShapeCard': '卡片（标题摘要域名）',
  'setting.hoverExternalShapePage': '原网页（浮层内显示网页）',
  /** #221 Live 悬停触发方式（Ctrl+悬停 vs 直接悬停）；#298 改名并重写描述 */
  'setting.hoverLiveDirect.title': '实时预览中直接悬停显示',
  'setting.hoverLiveDirect.description': '开启后在实时预览中指针悬停链接即可直接打开引用视图浮层，无需修饰键；关闭时需按住 Ctrl（macOS 为 Cmd）再悬停，或悬停中补按 Ctrl。关闭「悬停预览引用文档」总开关后本设置不再生效。',
  'setting.codeblockCard.title': '代码块卡片',
  'setting.codeblockCard.description': '围栏代码块在光标离开时收起为卡片：隐藏围栏标记，显示语言头部横带。关闭后回到朴素源码围栏外观。',
  'setting.codeblockLineNumbers.title': '卡内行号',
  'setting.codeblockLineNumbers.description': '卡片内代码行行首显示块内行号（每块从 1 起，围栏行不占号）。需开启「代码块卡片」。',
  'setting.codeblockCopyButton.title': '复制按钮',
  'setting.codeblockCopyButton.description': '卡片头部悬停显示复制按钮，点击复制整块代码（不含围栏行）。需开启「代码块卡片」。',
  'setting.codeblockHighlight.title': '语法高亮',
  'setting.codeblockHighlight.description': '代码块内容按语言着色（卡片关闭时朴素围栏同样生效；未识别语言回退纯文本）。',
  /** 设置项「符号自动补全」（#123 editor.symbolAutocomplete） */
  'setting.symbolAutocomplete.title': '符号自动补全',
  'setting.symbolAutocomplete.description':
    '实时预览正文中键入起始符号时自动补入对应闭合符号（代码内括号引号照常配对，Markdown 强调符仅在连续串首触发）。紧贴自动补出的闭合符号再键入同一符号可直接越过，自动补出的空符号对内退格两侧同删。关闭后以上行为一并停用。',
  /** 设置项「选区符号包裹」（#124 editor.symbolSelectionWrap） */
  'setting.symbolSelectionWrap.title': '选区符号包裹',
  'setting.symbolSelectionWrap.description':
    '实时预览选中文字后键入符号，在选区两侧添加对应符号并保持原文选中（连续键入叠加标记：两次星号成粗体，两次方括号成双链类结构；跨段选择按段分别包裹且保留空行）。代码内不对 Markdown 强调符包裹；本开关与符号自动补全相互独立。',
  /** 设置项「符号 Tab 越界」（#125 editor.symbolTabEscape） */
  'setting.symbolTabEscape.title': '符号 Tab 越界',
  'setting.symbolTabEscape.description':
    '实时预览中光标位于成对符号围栏内部（括号、引号或行内 Markdown 结构）且未选中文字时，Tab 先移到闭合标记左边界，再按一次越过整个闭合标记；嵌套围栏从最内层逐层退出。Tab 仅移动光标，不改动文本。围栏外保持既有行为（表格切格或整行缩进）；Shift+Tab 不受影响。本开关与前两项符号设置相互独立。',
  /** 设置项「多光标」（#237 editor.multicursor） */
  'setting.multicursor.title': '多光标',
  'setting.multicursor.description':
    '在实时预览中启用多条光标与副选区：按住 Alt 点击可在指针处添加（或移除）光标，Ctrl+Alt+Up/Down 在上方或下方行添加光标，Esc 一次收敛回主光标。关闭后回到单选区编辑。与「选区符号包裹」相互独立。',
  /** 设置项「界面语言」（#96 general.language，经 titleKey/descriptionKey 取词） */
  'setting.language.title': '界面语言',
  'setting.language.description':
    '界面文案的显示语言。选择「自动」时跟随 VS Code 显示语言（中文环境显示简体中文，其余显示英文）；显式选择后不再跟随。更改立即生效。',
  /** 语言下拉 auto 档显示名（随当前语言取词；具体语言为静态自名不自译） */
  'setting.languageAuto': '自动',
  'setting.testFlag.title': '测试开关',

  // ---- appearance.（#231 外观合并分页：侧栏条目标题与描述）----
  'appearance.title': '外观',
  'appearance.description': '管理 CSS 片段与外观定制：片段目录、逐项开关与公开样式契约参考。',

  // ---- styleRef.（样式参考：总表/详细查询文案与骨架标签，#132；#231 起为
  // 外观合并分页的页签体，tabOverview/tabDetail 亦作外观页签文案沿用）----
  'styleRef.title': '样式参考',
  'styleRef.description': '查阅当前安装版本的公开样式契约：选择器、CSS 变量、Obsidian 原名兼容等级与限制项。内容随版本由契约清单生成。',
  'styleRef.versionNote': '本参考与安装版本 {version} 配套。',
  'styleRef.bridgeNote': '标记为「直接兼容」的条目可按所列 Obsidian 原名选择器/变量直接书写：元素同时挂载两个类名，变量经 var(Obsidian 名, 默认值) 回退链生效；vsidian 名整条覆盖严格优先于 Obsidian 名。',
  'styleRef.variableTable': 'Obsidian 变量别名总表',
  'styleRef.varObsidian': 'Obsidian 变量',
  'styleRef.varVsidian': 'vsidian 变量（优先）',
  'styleRef.varDefault': '未设置时默认值',
  'styleRef.domainFilter': '按域筛选',
  'styleRef.supportFilter': '按支持等级筛选',
  'styleRef.searchPlaceholder': '搜索条目（ID / 选择器 / 用途）',
  'styleRef.filterAll': '全部',
  'styleRef.domainContent': '正文域',
  'styleRef.domainChrome': '界面域',
  'styleRef.kindContainer': '容器',
  'styleRef.kindSelector': '选择器',
  'styleRef.kindVariable': 'CSS 变量',
  'styleRef.kindLimitation': '不支持与限制',
  'styleRef.supportDirect': '直接兼容',
  'styleRef.supportSemantic': '语义对应',
  'styleRef.supportNative': '原生承担',
  'styleRef.supportNone': '无对应',
  'styleRef.viewLive': '实时预览',
  'styleRef.viewReading': '阅读',
  'styleRef.viewNone': '非编辑视图',
  'styleRef.obsidianCounterpart': 'Obsidian 对应',
  'styleRef.aliasTargets': '别名承诺',
  'styleRef.deprecated': '弃用',
  'styleRef.removed': '移除',
  'styleRef.empty': '当前筛选条件下没有条目。',
  // ---- #145 类目分栏分页与契约 JSON 导出 ----
  'styleRef.categoryNav': '按类目浏览',
  // #155 小改：总分页签（总表/详细查询两态）
  'styleRef.tabNav': '样式参考视图',
  'styleRef.tabOverview': '样式参考',
  'styleRef.tabDetail': '详细查询',
  'styleRef.exportJson': '导出 JSON',
  'styleRef.prevPage': '上一页',
  'styleRef.nextPage': '下一页',
  'styleRef.pageIndicator': '第 {page} / {pages} 页',
  'styleRef.searchCount': '全部类目命中 {count} 条',
  'styleRef.category.viewContainer': '容器与视图',
  'styleRef.category.heading': '标题',
  'styleRef.category.inlineFormat': '行内格式',
  'styleRef.category.listTask': '列表与任务',
  'styleRef.category.lineSyntax': '行级语法',
  'styleRef.category.table': '表格',
  'styleRef.category.readingStructure': '阅读块级结构',
  'styleRef.category.linkImageWikilink': '链接、图片与双链',
  'styleRef.category.contentVariables': '公开 CSS 变量',
  'styleRef.category.contentLimits': '不支持与限制',
  'styleRef.category.math': '公式',
  'styleRef.category.diagram': '图表渲染',
  'styleRef.category.graphicInteract': '图形化按钮与弹窗',
  'styleRef.category.codeCard': '代码块卡片',
  'styleRef.category.outline': '大纲面板',
  'styleRef.category.chromeLimits': '限制说明',
  'styleRef.category.frontmatter': 'frontmatter 表格卡片',
  'styleRef.category.toolbarBanner': '工具栏与横幅',
  'styleRef.category.contextMenu': '正文右键菜单',
  'styleRef.category.backlinks': '反链面板',
  'styleRef.category.outlinks': '出链面板',
  'styleRef.category.hoverPreview': '悬停预览',
  'styleRef.category.findPanel': '查找面板',
  'styleRef.category.loading': '加载占位',
  'styleRef.category.tooltip': '悬停提示',
  'host.styleRefExported': '样式契约 JSON 已导出：{path}',
  'host.styleRefExportFailed': '样式契约 JSON 导出失败：{reason}',
  'host.styleRefExportReasonMissingAsset': '扩展安装不完整（缺少 style-reference.json）',
  'host.styleRefExportReasonWriteFailed': '写入文件失败',
  'command.exportStyleReference.title': 'Vsidian：导出样式参考 JSON',
  'command.openStyleReference.title': 'Vsidian：打开样式参考',
  'cssSnippets.title': 'CSS 片段',
  'cssSnippets.directoryLabel': '片段目录',
  'cssSnippets.chooseDirectory': '选择目录…',
  'cssSnippets.chooseOpenLabel': '选择文件夹',
  'cssSnippets.openDirectory': '在文件管理器中打开',
  'cssSnippets.refresh': '重新加载片段',
  'cssSnippets.noDirectory': '尚未选择片段目录。选择一个文件夹后，其第一层 .css 文件将作为片段（新文件默认关闭）。',
  'cssSnippets.emptyDirectory': '所选目录的第一层没有 .css 文件。',
  'cssSnippets.readError': '片段目录读取失败。下方清单为最近成功状态，已打开的编辑器保留最近应用的样式。',
  /** #131 暂停/恢复（全局冻结，保留逐片段开关；恢复按原配置生效） */
  'cssSnippets.pauseAll': '暂停全部片段',
  'cssSnippets.resume': '恢复片段',
  'cssSnippets.pausedStatus': '已暂停全部 CSS 片段。逐片段开关保留，恢复后按原配置重新生效。',
  'cssSnippets.entryRejected': '已拒绝：引用了片段目录外的路径。',
  'cssSnippets.remoteCacheNote': 'HTTPS 导入与联网字体（@import url(https://…) 与 @font-face src）直接经网络加载。手动重新加载只重新拉取本地片段入口；远程样式表与字体遵循其服务器的 HTTP 缓存头，扩展不监听远程内容变化，也不承诺远端更新推送。',

  // ---- host.（宿主消息）----
  'host.conflictInputCopied': '未确认输入已复制到剪贴板',
  'host.noConflictInputToCopy': '没有可复制的未确认输入',
  'host.copyConflictInput': '复制未确认输入',
  'host.discardAndResync': '放弃本地修改并重新同步',
  'host.confirmResume': '将放弃“{name}”编辑器中未确认的本地修改，并以磁盘/权威内容重新同步。建议先复制未确认输入。',
  'host.conflictPaused': '“{name}”的编辑已暂停：外部修改与未确认输入无法安全合并。未确认输入已保留，可随时取回。',
  /** P2-12（#289）冲突三项「对比并解决」打开的原生对比页标题（左：未提交
   *  输入临时副本；右：真实目标文档） */
  'host.conflictDiffTitle': '写入冲突：{name}（左侧：当前输入副本 / 右侧：目标当前版本）',
  'host.panelClosedWithInput': '“{name}”的编辑器已关闭（或连接断开），存在未保存的未确认输入：{text}',
  /** P2-13（#290）父标签关闭后，引用编辑端口（虚拟面板）未写入目标的输入
   *  通知（三项当次选择：对比并解决 / 放弃当前版本 / 取消） */
  'host.refClosedWithInput': '父文档已关闭，“{name}”的引用编辑存在未写入目标的输入：{text}',
  'host.conflictCompareLabel': '对比并解决',
  'host.conflictDiscardLabel': '放弃当前版本',
  'host.conflictCancelLabel': '取消',
  'host.handoffFailed': '打开“{name}”的编辑标签失败，未保存修改仍保留在宿主中，可重试打开。',
  'host.handoffRetry': '重试打开',
  'host.wikilinkUnsupported': '不支持的双链形态「[[{target}]]」（嵌入 ![[…]] 属二期）：已按原文保留',
  'host.wikilinkNoWorkspace': '当前文档不在任何工作区文件夹内：双链目标按来源文档的相对路径解析，未打开文件夹时无法跳转（链接文本保留）',
  'host.wikilinkNotFound': '双链目标不存在：[[{target}]]（已按来源文档所在目录解析；不会自动创建文件）',
  'host.wikilinkOutsideRoot': '双链目标越出来源所属的工作区根：[[{target}]]（相对路径不得越出所属根）',
  'host.wikilinkHeadingMissing': '已在目标文档中打开{link}，但未找到标题「{heading}」（标题匹配：trim + 空白折叠 + 大小写不敏感的 ATX 标题）',
  'host.rejectDiffContext': '对比视图不支持视图切换',
  'host.rejectPanelNotReady': 'Vsidian 面板尚未就绪，请稍后重试',
  'host.rejectAlreadySource': '当前已在源码编辑器中',
  'host.noActiveMarkdown': '请先聚焦一个 Markdown 文档（Vsidian 面板或 .md 源码编辑器）再切换视图模式',
  'host.noPanelForFind': '请先聚焦一个 Vsidian 编辑器面板，再使用编辑区查找',
  'host.readOnlyTableOp': '阅读模式为只读视图：切换到实时预览后再执行表格操作',
  'host.noPanelForTableCreate': '请先聚焦一个 Vsidian 编辑器面板，再创建表格',
  'host.noPanelForTableOp': '请先聚焦一个 Vsidian 编辑器面板（光标置于表格内），再执行表格操作',
  'host.blockedLinkEmpty': '链接目标为空（空白或仅锚点）：本期不支持页内锚点定位',
  'host.blockedLinkScheme': '不允许打开的链接协议「{scheme}」：仅支持 http/https 与工作区内路径',
  'host.blockedLinkEscape': '链接指向工作区之外，已拦截：{detail}',
  'host.blockedLinkWindowsDrive': '远程（POSIX）工作区不支持 Windows 盘符路径链接',
  'host.externalOpenFailed': '无法打开外部链接：{url}',
  'host.linkNotFound': '链接目标不存在：{href}（已按相对当前文档目录解析）',
  /** #128 CSS 片段：宿主侧用户提示 */
  'host.cssSnippetLoadFailed': 'CSS 片段「{name}」加载失败，已保留最近成功的样式。',
  'host.cssSnippetReadFailed': '读取 CSS 片段目录「{directory}」失败。',
  /** #131 暂停/恢复命令反馈（命令面板触发时无 webview 也可见） */
  'host.cssSnippetsPaused': '已暂停全部 CSS 片段。逐片段开关保留。',
  'host.cssSnippetsResumed': '已恢复 CSS 片段；启用的片段按原配置重新加载。',
  'host.cssSnippetRejectedEscape': 'CSS 片段「{name}」引用了片段目录外的路径「{path}」，已拒绝加载。',
  'host.cssSnippetRejectedSymlink': 'CSS 片段「{name}」经链接解析到片段目录外的「{path}」，已拒绝加载。',
  /** #198 索引维护命令反馈（命令面板触发时无 webview 也可见；设置页按钮同链路） */
  'host.indexRebuildDone': '已按磁盘正文完整重建索引。',
  'host.indexRebuildCancelled': '索引重建已取消，继续使用原有索引。',
  'host.indexRebuildFailed': '索引重建失败：{detail}',
  'host.indexMaintenanceBusy': '索引维护操作正在进行中，请稍后再试。',
  'host.indexCleanupDone': '索引缓存已清理，移除 {count} 个过期代际。',
  'host.indexCleanupFailed': '缓存清理失败：{detail}',
  /** #318 搜索导航定位恢复命令的失败反馈（成功由 flash 高亮呈现） */
  'host.searchRevealNotFound': '未能将搜索选中条目匹配到当前 Vsidian 面板（需要先在搜索结果中选中一条匹配）。',
  'host.searchRevealNoPanel': '当前活动标签页不是 Vsidian 面板——请先在 Vsidian 中打开目标笔记（或切换到其标签页）再定位搜索结果。',
  /** #318 打开提示（宿主通知气泡 + 定位按钮；弹出本身零副作用） */
  'host.searchRevealHint': '从搜索结果打开？点此定位到选中的匹配处。',
  'host.searchRevealHintLocate': '定位',
  // ---- #199 更名/移动引用自动更新（宿主通知；批量操作合并提示）----
  'host.renameRefsUpdated': '已更名「{file}」并更新 {count} 处引用（{files} 个文件）。',
  'host.renameRefsPartiallyUpdated': '已更名「{file}」并更新 {count} 处引用；{skipped} 处因越界或内容变化跳过，未全部更新。',
  'host.renameRefsSkippedAll': '已更名「{file}」，引用未更新：{skipped} 处因越界或内容变化被跳过。',
  'host.renameRefsIndexNotReady': '已更名「{file}」，但引用索引尚未就绪，本次未更新引用（可稍后在设置页重建索引后手动修正）。',
  // ---- #200 目录/批量移动：未更新项详情行与跳过原因 ----
  'host.renameRefsSkippedDetail': '未更新项：{items}',
  'host.renameRefsSkipItem': '{file}（{reason}）',
  'host.renameRefsSkipMore': ' … {count}',
  'host.renameRefsSkipCrossRoot': '越出所属根',
  'host.renameRefsSkipEdgeStale': '内容已变化',
  'host.invalidSettingDefinition': '非法定义：{definition}',
  'host.duplicateSettingKey': '设置键已存在：{key}',

  // ---- #94 编辑器 webview 呈现面 ----

  'common.keybindingHint': '快捷键：{keys}',
  'common.keySeparator': '、',

  'format.bold': '粗体',
  'format.italic': '斜体',
  'format.strikethrough': '删除线',
  'format.highlight': '高亮',
  'format.inlineCode': '行内代码',
  'format.heading1': '一级标题',
  'format.heading2': '二级标题',
  'format.heading3': '三级标题',
  'format.heading4': '四级标题',
  'format.heading5': '五级标题',
  'format.heading6': '六级标题',
  'format.headingNone': '取消标题',
  'format.bulletList': '无序列表',
  'format.orderedList': '有序列表',
  'format.taskList': '任务列表',
  'format.quote': '引用',
  'format.codeBlock': '代码块',
  'format.link': '链接',
  'format.clearInline': '清除行内格式',
  'format.inlineMath': '插入行内公式',
  'format.blockMath': '插入块级公式',
  'format.wikilink': '插入双链',
  'format.horizontalRule': '插入分割线',
  'format.htmlComment': 'HTML 注释',

  'format.toolbarAria': '格式快速操作',
  'format.groupText': '文字',
  'format.groupParagraph': '段落',
  'format.groupInsert': '插入',
  'format.heading': '标题',
  'format.headingMenu': '标题层级',
  'format.bodyText': '正文',
  'format.insertTable': '插入表格',

  'sidebar.settings': '打开 Vsidian 设置',
  'sidebar.quickActions': '快速操作条',
  'sidebar.collapse': '收起右侧栏',
  'sidebar.expand': '展开右侧栏',
  /** #141 工具栏双态视图切换按钮（aria/title 表目标动作，随当前态换词） */
  'toolbar.switchToReading': '切换到阅读视图',
  'toolbar.switchToLive': '切换到实时预览',
  /** #208 工具栏刷新按钮（清嵌入资源缓存重渲染：图片/图表取新解析） */
  'toolbar.refresh': '刷新嵌入资源',
  'sidebar.resize': '拖拽调整侧栏宽度',

  'find.placeholder': '查找',
  'find.label': '在文档中查找',
  'find.toggleReplace': '展开/收起替换栏',
  'find.replaceLabel': '替换为',
  'find.replaceNext': '替换',
  'find.replaceAll': '全部替换',
  'find.invalid': '无效的正则表达式',
  'find.matchCase': '区分大小写',
  'find.wholeWord': '全字匹配',
  'find.regexp': '使用正则表达式',
  'find.prev': '上一个匹配',
  'find.next': '下一个匹配',
  'find.close': '关闭查找',
  'find.inSelection': '在选定内容中查找',
  /** 计数形态（VSCode 同款）：{n} 当前序号、{total} 命中总数 */
  'find.count': '第 {n} 项，共 {total} 项',
  'find.noResults': '无结果',
  'find.sourceHit': '源码命中',
  'find.sourceReadonly': '只读',
  'find.sourceLocation': '第 {line} 行，第 {column} 列',
  /** #238 查找选项条（Ctrl+D 会话期间的迷你三按钮）容器可访问名称 */
  'find.optionsBar': '查找选项',

  'conflict.bannerText': '检测到无法安全同步的外部修改：写回已暂停，本地输入已保留，不会被覆盖。',
  'conflict.copyUnconfirmed': '复制未确认输入',
  'conflict.resume': '放弃本地修改并重新同步',

  'outline.label': '大纲',
  'outline.empty': '无标题',
  'outline.chevron': '折叠或展开',
  'outline.searchPlaceholder': '输入以搜索',
  'outline.searchLabel': '搜索大纲标题',
  'outline.jumpBottom': '跳转到笔记末尾',
  'outline.reset': '重置',
  'outline.noMatch': '无匹配',
  'outline.expandLevels': '大纲展开层级',
  'outline.collapseAll': '全部折叠',
  'outline.expandLevel1': '展开到一级标题',
  'outline.expandLevel2': '展开到二级标题',
  'outline.expandLevel3': '展开到三级标题',
  'outline.expandLevel4': '展开到四级标题',
  'outline.expandLevel5': '展开到五级标题',
  'outline.renameHeading': '重命名标题',

  'outlineMenu.expandRecursively': '递归展开',
  'outlineMenu.collapseSiblings': '折叠同级',
  'outlineMenu.expandSiblings': '展开同级',
  'outlineMenu.copy': '复制',
  'outlineMenu.copyHeading': '标题',
  'outlineMenu.copySiblings': '标题和兄弟标题',
  'outlineMenu.copyChildren': '标题和子标题',
  'outlineMenu.copyLink': '标题链接',
  'outlineMenu.copySection': '该段内容',
  'outlineMenu.adjustLevel': '调整层级',
  'outlineMenu.levelUp': '增加一级',
  'outlineMenu.levelUpRecursive': '递归增加一级',
  'outlineMenu.levelDown': '减少一级',
  'outlineMenu.levelDownRecursive': '递归减少一级',
  'outlineMenu.rename': '重命名',
  'outlineMenu.delete': '删除',

  /** 悬停文档预览（#218：浮层就地状态行；错误分态不弹宿主通知。#219 起
   *  双链与普通链接共用分态——目标原文不再裹双链括号；anchor-missing 为
   *  锚点缺失分态，不以全文替代） */
  /** #342（P3-10）外链卡片失败分态：真实网络原因，不伪装成文件缺失 */
  'hover.errorWebDisabled': '外部链接预览未开启（可在 Vsidian 设置页开启）。',
  'hover.errorWebInvalidAddress': '目标地址被安全策略拒绝（内网、回环、带凭据或非法 URL）。',
  'hover.errorWebTimeout': '目标网页响应超时。',
  'hover.errorWebTooLarge': '目标网页超出响应大小上限。',
  'hover.errorWebNotHtml': '目标不是可解析的网页（非 HTML 内容）。',
  'hover.errorWebRedirects': '目标网页重定向次数过多。',
  'hover.errorWebUnreachable': '无法访问目标网页（网络错误或服务器返回错误状态）。',
  /** #343（P3-11）原网页形态：退回原因（真实已知原因）与无法确认说明 */
  'hover.webFrameDenied': '已退回卡片：该网站限制嵌入显示（X-Frame-Options / CSP frame-ancestors），可在浏览器打开。',
  'hover.webFrameHttp': '已退回卡片：HTTP 页面无法在安全上下文中嵌入显示，可在浏览器打开。',
  'hover.webPageNote': '网页内容在本浮层内加载，会与目标站点及其第三方服务建立连接；不继承日常浏览器登录态。跨源内容不可观测，无法确认其显示是否完整——若显示异常，请退回卡片或在浏览器打开。',
  'hover.webFallbackToCard': '退回卡片',
  'hover.loading': '正在加载预览…',
  'hover.errorUnsupported': '不支持的目标形态：没有可预览的目标（外部网页不在预览范围）',
  'hover.errorNoWorkspace': '当前文档不在任何工作区文件夹内：无法解析链接目标进行预览',
  'hover.errorEscape': '目标越出来源所属的工作区根，无法预览',
  'hover.errorNotFound': '目标不存在：{target}（按当前文档所在目录解析；不会自动创建文件）',
  'hover.errorNonMarkdown': '{target} 不是 Markdown 笔记：本期预览仅支持 Markdown 文档',
  'hover.errorReadFailed': '读取目标文档失败',
  'hover.errorAnchorMissing': '目标笔记中不存在锚点：{target}#{anchor}（不会以全文替代显示）',
  /** #337 PDF 悬停预览：锚点语法非法（page=0/非数字/未知键/重复键等，
   *  不静默回落第一页——修正链接后可重试） */
  'hover.errorAnchorInvalid': '锚点语法无效：{target}#{anchor}（页码须为正整数，如 #page=3；不会静默改用第一页）',
  'hover.errorWatchCapacity': '同时打开的引用笔记过多。请关闭其他预览或卡片后重新打开。',
  'hover.errorSourceExpired': '来源笔记已变更或关闭。请重新打开此引用。',
  'hover.errorCycle': '当前引用路径中已包含这篇笔记。',
  'hover.errorDepth': '已达到引用展开的最大层级。',
  'hover.errorBudget': '当前引用树已达到资源上限。',
  /** #340（P3-08）可读文本悬停的准入与锚点错误分态：就地报错不静默
   *  回顶/截断；{maxMb} 为单文件准入上限（MB），失败均可经浮层标题栏
   *  打开入口在原生编辑器继续 */
  'hover.errorTextBinary': '{target} 是二进制文件，无法作为文本预览。可点击右上角打开按钮在原生编辑器中打开。',
  'hover.errorTextEncoding': '{target} 不是有效的 UTF-8 文本，无法可靠预览。可点击右上角打开按钮，用「Reopen with Encoding」选择正确编码。',
  'hover.errorTextTooLarge': '{target} 超过单文件预览上限（{maxMb} MB），不读取完整内容。可点击右上角打开按钮在原生编辑器中打开。',
  'hover.errorTextLongLine': '{target} 含超长行，为避免预览卡顿已停止加载（不截断显示）。可点击右上角打开按钮在原生编辑器中打开。',
  'hover.errorTextAnchorFormat': '锚点语法非法：#{anchor}（文本锚点支持 #line=N 与 #range=B-E，可组合；行号为正整数）',
  'hover.errorTextAnchorOrder': '锚点窗口非法：#{anchor}（range 的起始行不得大于结束行）',
  'hover.errorTextAnchorBounds': '锚点越界：#{anchor}（行号超出文件总行数）',
  'hover.errorTextAnchorOutside': '锚点冲突：#{anchor}（line 不在 range 窗口内；不会静默改用其他位置）',
  /** #220 引用 Reading 内容：浮层内笔记属性区展开/折叠按钮的无障碍文案
   *  （aria-label 与 title 同词；按钮是唯一操作入口，标题行悬停只负责显示） */
  /** #337 PDF 悬停渲染：页码信息行与渲染失败分态（就地呈现，不弹宿主
   *  通知；加密文件首批提示在原应用打开，不采集密码） */
  'hover.pdfPageInfo': '第 {page} / {total} 页',
  /** #339 页码行的缩放反馈（相对适合宽度的达成百分比） */
  'hover.pdfPageInfoZoom': '第 {page} / {total} 页 · {percent}%',
  /** #339 链接层禁用提示（显式安全边界） */
  'hover.pdfLinkExternalOnly': '预览中仅支持在浏览器打开 http(s) 链接',
  'hover.pdfLinkUnsupported': '此链接操作在预览中已禁用（安全限制）',
  'hover.pdfLinkUnresolved': '链接目标无法解析',
  'hover.pdfErrorCorrupt': 'PDF 文件已损坏或不是有效的 PDF，无法预览',
  'hover.pdfErrorEncrypted': '此 PDF 已加密，暂不支持在预览中打开。请使用本地 PDF 阅读器打开原文件。',
  'hover.pdfErrorPageRange': '页码超出范围：请求第 {page} 页，该 PDF 共 {total} 页（不会静默跳到第一页）',
  'hover.pdfErrorResource': 'PDF 资源装载或渲染失败，请重试',
  'hover.pdfErrorLoadFailed': 'PDF 渲染组件装载失败（扩展安装可能不完整）',
  'hover.content.fmExpand': '展开笔记属性',
  'hover.content.fmCollapse': '收起笔记属性',
  /** #222 Reading 嵌入卡片：装载中文案与卡片头部打开入口的无障碍文案
   *  （aria-label 与 title 同词；打开沿用 Vsidian 既有打开行为，不改写嵌入原文） */
  'embed.loading': '正在加载嵌入内容…',
  'embed.openTarget': '打开目标笔记',
  /** P2-04（#281）嵌入内部 Live：模式切换 / 保存目标 / 未保存圆点与
   *  绑定失败、暂停态的就地文案（悬停词走 data-tooltip 同一词条） */
  'embed.modeToLive': '在引用内编辑（切换到实时预览）',
  'embed.modeToReading': '切换到阅读视图',
  'embed.saveTarget': '保存目标笔记',
  'embed.dirtyDot': '目标有未保存修改',
  'embed.liveBindFailed': '无法接入目标编辑（目标不可用或不是 Markdown）。',
  'embed.livePaused': '编辑已暂停：无法安全写回，输入已保留。',
  /** P2-05（#282）显式关闭确认：关闭入口悬停词与三项模态（默认取消；
   *  文件名与文档级丢弃影响须在确认文字中指明） */
  'embed.closeEditor': '关闭引用编辑',
  'embed.closeDialogTitle': '关闭引用编辑',
  'embed.closeDialogMessage': '{file} 有未保存的修改。',
  'embed.closeDialogDiscardScope': '丢弃将恢复整个文件的已保存内容，包括在其他视图中的未保存修改。',
  'embed.closeCancel': '取消',
  'embed.closeSave': '保存并关闭',
  'embed.closeDiscard': '丢弃修改并关闭',
  'embed.closeSaveFailed': '保存失败（文件可能只读），已保留当前编辑。',
  'embed.closeDiscardFailed': '丢弃失败，已保留当前状态。',
  'embed.closeStale': '目标在确认期间又被修改，请重新确认。',

  /** P2-12（#289）写入冲突三项选择（暂停状态行就地呈现）。compare 的
   *  hover 为用户指定原文逐字；discard 只放弃本次未成功写入的输入（非
   *  文档级回滚）；cancel 保持暂停与当前输入 */
  'embed.conflictCompareLabel': '对比并解决',
  'embed.conflictCompareHint': '在临时副本和冲突版本的对比视图中处理冲突',
  'embed.conflictDiscardLabel': '放弃当前版本',
  'embed.conflictDiscardHint': '放弃本次未成功写入的输入，重新同步目标当前内容。',
  'embed.conflictCancelLabel': '取消',
  'embed.conflictCancelHint': '保持暂停与当前输入。',
  'embed.conflictReopenLabel': '重新选择',
  'embed.conflictReopenHint': '重新显示冲突处理选项。',
  'embed.conflictCompareFailed': '打开对比视图失败，已保留当前输入，可重试。',

  /** 反链面板（#197：四态与条目；形态改版批次：工具栏/排序/搜索/页头） */
  'backlinks.label': '反向链接',
  'backlinks.panelTitle': '链接当前文件',
  'backlinks.toolbarLabel': '反链面板工具栏',
  'backlinks.sortBy': '排序',
  'backlinks.sortNameAsc': '文件名（A-Z）',
  'backlinks.sortNameDesc': '文件名（Z-A）',
  'backlinks.sortMtimeDesc': '编辑时间（从新到旧）',
  'backlinks.sortMtimeAsc': '编辑时间（从旧到新）',
  'backlinks.sortBirthDesc': '创建时间（从新到旧）',
  'backlinks.sortBirthAsc': '创建时间（从旧到新）',
  'backlinks.search': '搜索',
  'backlinks.searchPlaceholder': '搜索反链…',
  'backlinks.searchNoMatch': '无匹配',
  'backlinks.collapseAll': '全部折叠',
  'backlinks.expandAll': '全部展开',
  'backlinks.moreContext': '更多上下文',
  'backlinks.countLabel': '{n} 条反向链接',
  'backlinks.groupCount': '{n} 条',
  'backlinks.empty': '没有反向链接',
  'backlinks.loading': '正在加载反向链接…',
  'backlinks.updating': '索引更新中…',
  'backlinks.error': '反向链接不可用',
  'backlinks.errorNoWorkspace': '未打开工作区，无法查看反向链接',
  'backlinks.jumpTo': '跳转到 {file} 的引用处（第 {n} 行）',

  /** 出链面板（出链面板批次：四态与条目） */
  'outlinks.label': '出链',
  'outlinks.panelTitle': '当前笔记中的链接',
  'outlinks.countLabel': '{n} 条链接',
  'outlinks.empty': '无链接',
  'outlinks.loading': '正在加载链接…',
  'outlinks.updating': '索引更新中…',
  'outlinks.error': '出链不可用',
  'outlinks.errorNoWorkspace': '未打开工作区，无法查看出链',
  'outlinks.jumpTo': '打开 {target}',

  /** #332 起「文件与链接」分页内「索引维护」二级组标题（#198：排除模式
   *  与维护操作；原分页标题词条降级复用，分页级标题走 filesLinksSection） */
  'indexMaintenance.title': '索引维护',
  'indexMaintenance.patternsLabel': '排除模式',
  'indexMaintenance.patternsDescription': '按各工作区根的相对路径匹配的 glob 模式（支持 **、* 与 ?；单独的目录名会排除其整个子树）。默认为 **/.git/** 与 **/node_modules/**。不继承 VSCode 搜索排除规则与 .gitignore。被排除的文件不参与扫描；其中被已索引笔记显式引用的目标仍会登记。',
  'indexMaintenance.addPattern': '添加模式',
  'indexMaintenance.removePattern': '移除模式',
  'indexMaintenance.patternPlaceholder': '例如 drafts/**',
  'indexMaintenance.patternsAriaLabel': '排除模式列表',
  'indexMaintenance.savePatterns': '保存模式',
  'indexMaintenance.resetPatterns': '恢复默认',
  'indexMaintenance.rebuild': '完整重建',
  'indexMaintenance.cleanup': '清理当前工作区缓存',
  'indexMaintenance.cancel': '取消',
  'indexMaintenance.rebuildProgress': '重建中：{done} / {total} 篇',
  'indexMaintenance.rebuilding': '正在重建索引…',
  'indexMaintenance.unavailable': '当前未打开工作区。模式仍会保存，打开工作区后生效。',
  'indexMaintenance.noticePatternsSaved': '排除模式已保存，正在重算覆盖范围。',
  'indexMaintenance.noticePatternsInvalid': '部分模式被拒绝（{detail}），合法项已保存。',
  'indexMaintenance.noticeRebuildDone': '已按磁盘正文完整重建索引。',
  'indexMaintenance.noticeRebuildCancelled': '重建已取消，继续使用原有索引。',
  'indexMaintenance.noticeRebuildFailed': '重建失败：{detail}',
  'indexMaintenance.noticeCleanupDone': '索引缓存已清理，移除 {count} 个过期代际。',
  'indexMaintenance.noticeCleanupFailed': '缓存清理失败：{detail}',

  'table.controls': '表格操作控件',
  'table.insertColumnRight': '在右侧新增列',
  'table.insertRowBelow': '在表格底部新增行',
  'table.selectRow': '选择或拖动第 {n} 行',
  'table.selectColumn': '选择或拖动第 {n} 列',

  'codeblock.copy': '复制代码',
  'codeblock.expand': '展开代码块',
  'codeblock.collapse': '折叠代码块',
  'codeblock.wrapEnable': '开启自动折行',
  'codeblock.wrapDisable': '关闭自动折行',

  /** 图形化代码块按钮组与图表弹窗（#111） */
  'graphic.editSource': '编辑源码',
  'graphic.popup': '弹窗预览',
  'graphic.popupZoomIn': '放大',
  'graphic.popupZoomOut': '缩小',
  'graphic.popupReset': '重置缩放',
  'graphic.popupRefresh': '刷新',
  'graphic.popupExportSvg': '导出 SVG',
  'graphic.popupExportPng': '导出 PNG',
  'graphic.popupClose': '关闭',
  'graphic.exportPngUnavailable': '当前环境暂不支持导出 PNG，可改用导出 SVG。',
  'graphic.exportFailed': '图表导出失败',
  'graphic.exportSvgFilter': 'SVG 文件',
  'graphic.exportPngFilter': 'PNG 图片',
  'graphic.popupExportImage': '另存原图副本',
  'graphic.popupExportImageDisabled': '外链图片不支持导出，可先保存到工作区。',
  'graphic.imageExportFailed': '图片导出失败',

  'decor.taskCheck': '勾选任务',
  'decor.taskUncheck': '取消任务勾选',
  'decor.emptyCell': '空单元格',
  'decor.mathError': '公式解析失败：显示原文，移动光标进入可编辑',
  'decor.imageError': '图片加载失败（{reason}），点击重试',
  'decor.imageNotFound': '图片找不到（文件不存在或已被删除），点击重试',
  'decor.imageInaccessible': '图片暂不可访问（远程连接或权限问题），点击重试',
  'decor.unknownReason': '未知原因',
  'decor.mermaidUnavailable': '图表渲染器不可用（mermaid.js 未能加载）',
  'decor.mermaidError': '图表渲染失败：{message}',

  // ---- frontmatter.（#140 表格卡片：标题栏、修改按钮与 Popover 编辑）----
  /** 卡片标题栏文字（对齐 Obsidian Properties 面板） */
  'frontmatter.title': '属性',
  /** 标题栏右上角「修改」按钮（打开属性编辑 Popover） */
  'frontmatter.edit': '修改',
  /** 标题栏折叠 chevron：收起键值行区（与代码块折叠同交互） */
  'frontmatter.collapse': '折叠属性',
  'frontmatter.expand': '展开属性',
  /** Popover 容器 aria 标签 */
  'frontmatter.popoverAriaLabel': '修改属性',
  /** Popover 内键名输入框 aria 标签 */
  'frontmatter.keyAriaLabel': '属性名',
  /** Popover 内值输入框 aria 标签 */
  'frontmatter.valueAriaLabel': '属性值',
  /** Popover 内数组项输入框 aria 标签 */
  'frontmatter.itemAriaLabel': '列表项',
  'frontmatter.addProperty': '添加属性',
  'frontmatter.removeProperty': '删除属性',
  'frontmatter.removeConfirm': '确认删除',
  'frontmatter.addItem': '添加列表项',
  'frontmatter.removeItem': '删除列表项',
  'frontmatter.empty': '暂无属性',

  // ---- #97 manifest NLS（命令 title 与 displayName/description 生成源）----
  // 值即 package.json 原硬编码字面量（呈现不变）；工具条 24 条命令复用
  // format.* 既有键。command.* 键同时是快捷键页 extra/UI 源操作名的
  // titleKey（与命令面板同源，无第二套文案）；例外是三态切换三命令
  // （#232）：manifest title 改归属句式，操作名拆到 operation.* 独立键。
  'manifest.displayName': 'Vsidian',
  'manifest.description': '类 Obsidian 的 Markdown 编辑体验：实时预览 + 阅读双视图',

  'command.toggleViewMode.title': '切换到下一视图模式',
  /** #232 归属句式：editor/title 三态切换命令的 manifest title（genNls 生成源），
   *  与快捷键注册表的无前缀操作名键（operation.*）拆键分持 */
  'command.mode.toReading.title': '将 Vsidian 切换到阅读模式',
  'command.mode.toSource.title': '将 Vsidian 切换到源码编辑器',
  'command.mode.toLive.title': '将 Vsidian 切换到实时预览',
  /** #232 拆键：三态切换的无前缀操作名（keybindings 注册表 titleKey，
   *  快捷键页显示不带品牌名；值即拆键前原文案） */
  'operation.toReading': '切换到阅读模式',
  'operation.toSource': '切换到源码编辑器',
  'operation.toLive': '切换到实时预览',
  /** #141 双态切换（live↔reading，不含源码；工具栏按钮与 Ctrl+Q 共用） */
  'command.mode.toggleDualView.title': '切换阅读/实时预览',
  'command.find.title': '查找（编辑区）',
  'command.find.next.title': '下一个查找结果',
  'command.find.previous.title': '上一个查找结果',
  'command.find.replace.title': '替换（编辑区）',
  'command.find.replaceNext.title': '替换下一个匹配',
  'command.find.replaceAll.title': '全部替换匹配',
  'command.table.create.title': '创建表格',
  'command.table.insertRowAbove.title': '表格：上方插入行',
  'command.table.insertRowBelow.title': '表格：下方插入行',
  'command.table.deleteRow.title': '表格：删除行',
  'command.table.insertColumnLeft.title': '表格：左侧插入列',
  'command.table.insertColumnRight.title': '表格：右侧插入列',
  'command.table.deleteColumn.title': '表格：删除列',
  'command.openSettings.title': '打开设置',
  /** #128 CSS 片段刷新命令（快捷键页与命令面板同源） */
  'command.cssSnippets.refresh.title': 'CSS 片段：重新加载',
  /** #131 暂停/恢复全部片段命令 */
  'command.cssSnippets.pause.title': 'CSS 片段：暂停全部',
  'command.cssSnippets.resume.title': 'CSS 片段：恢复',
  /** #198 索引维护命令（设置页按钮与命令面板共用入口；默认未绑定，
   *  评估记录见 docs/specs/keybindings.md） */
  'command.index.rebuild.title': '索引：完整重建',
  'command.index.cleanup.title': '索引：清理当前工作区缓存',
  /** #318 搜索导航定位恢复（默认未绑定，评估记录见 docs/specs/keybindings.md） */
  'command.searchReveal.locate.title': '定位到搜索选中结果',
  'command.ui.sidebarToggle.title': '展开或收起右侧栏',
  'command.ui.outlineToggle.title': '显示或隐藏大纲',
  'command.ui.outlineSearch.title': '搜索大纲标题',
  'command.ui.outlineJumpBottom.title': '跳转到笔记末尾',
  'command.ui.outlineReset.title': '重置大纲',
  'command.ui.outlineCollapseAll.title': '折叠全部大纲',
  'command.ui.outlineExpandAll.title': '展开全部大纲',
  /** #197 反链面板：双模式 UI 操作，默认未绑定（评估记录见 keybindings.md） */
  'command.ui.backlinksToggle.title': '显示或隐藏反链面板',
  /** 出链面板：双模式 UI 操作，默认未绑定（评估记录见 keybindings.md） */
  'command.ui.outlinksToggle.title': '显示或隐藏出链面板',
  /** #208 刷新嵌入资源命令（工具栏按钮与快捷键/命令面板共用） */
  'command.editor.refresh.title': '刷新嵌入资源',
  /** #237 多光标：在上方/下方行添加光标（仅实时预览；Alt+点击在指针处添加） */
  'command.editor.addCursorAbove.title': '在上方添加光标',
  'command.editor.addCursorBelow.title': '在下方添加光标',
  /** #221 预览当前链接（手动打开悬停浮层：键盘进入浮层、Esc 返回触发处） */
  'command.ui.hoverPreviewLink.title': '预览当前链接',
  'command.ui.hoverPdfPageNext.title': 'PDF 预览：下一页',
  'command.ui.hoverPdfPagePrev.title': 'PDF 预览：上一页',
  /** #339 PDF 缩放三操作（只读预览呈现；默认未绑定） */
  'command.ui.hoverPdfZoomIn.title': 'PDF 预览：放大',
  'command.ui.hoverPdfZoomOut.title': 'PDF 预览：缩小',
  'command.ui.hoverPdfZoomReset.title': 'PDF 预览：适合宽度',
  'command.ui.embedToggleMode.title': '切换引用的内部视图模式',
  /** P2-10 引用 Live 操作入口（保存目标/显式关闭/冲突三项；默认均未绑定） */
  'command.embed.saveTarget.title': '保存焦点引用的目标',
  'command.embed.close.title': '关闭焦点引用的编辑会话',
  'command.conflict.compare.title': '对比并解决',
  'command.conflict.discard.title': '放弃当前版本',
  'command.conflict.cancel.title': '取消冲突选择',

  // ---- #159 锚点跳转（块引用定位与本文件锚点）----
  /** 块 id 缺失提示（与标题缺失同款「打开后提示」行为） */
  'host.wikilinkBlockMissing': '已在目标文档中打开{link}，但未找到块引用「^{blockId}」（块 id 是块尾行行尾的 ` ^id` 标记）',
  /** #340（P3-08）text 目标双链跳转的锚点非法提示（仍原生打开到顶部） */
  'host.wikilinkTextAnchorInvalid': '已在编辑器中打开{link}，但锚点「#{anchor}」非法（文本锚点支持 #line=N 与 #range=B-E，可组合；行号为正整数且不得越界）',

  // ---- #160 普通链接锚点定位（host 通知）----
  'host.linkAnchorMissing':
    '已打开 {href} 指向的文档，但未找到标题「{heading}」（标题匹配：trim + 空白折叠 + 大小写不敏感的 ATX 标题）',

  // ---- #161 图片粘贴（设置项与宿主通知）----
  'setting.imagePaste.title': '粘贴图片插入',
  'setting.imagePaste.description': '实时预览中粘贴剪贴板图片时，自动保存到配置的资产文件夹并在光标处插入图片引用。',
  'setting.imagePasteLocation.title': '图片存放位置',
  'setting.imagePasteLocation.description': '粘贴图片的落盘位置：与当前文件同目录、相对工作区根加子路径、或相对当前文件加子路径。子路径仅对后两种模式生效。',
  'setting.imagePasteLocationSameDir': '与当前文件同目录',
  'setting.imagePasteLocationWorkspaceRoot': '相对工作区根',
  'setting.imagePasteLocationRelativeToFile': '相对当前文件',
  'setting.imagePasteSubpath.title': '图片存放子路径',
  'setting.imagePasteSubpath.description': '「相对工作区根」与「相对当前文件」模式下拼接的子文件夹——选择「与当前文件同目录」时本项置灰不可编辑。拒绝绝对路径与 .. 越界。',
  'host.imagePasteInvalidLocation': '粘贴图片未保存：子路径 {subpath} 非法（不允许绝对路径或 ..）。',
  'host.imagePasteNoWorkspaceFallback': '未打开工作区文件夹，粘贴图片已保存到当前文件同目录。',
  'host.imagePasteWriteFailed': '粘贴图片保存失败。',
 
  // ---- #183 统一右键菜单（Live 正文全域接管；块链接两项自 #162 迁入）----
  /** 右键菜单：标题行命中的额外项（拼 [[笔记名#标题]]，标题取行面文本） */
  'contextMenu.copyHeadingLink': '复制标题链接',
  /** 右键菜单/快捷键共用项（拼 [[笔记名#^块id]]，无 id 时先自动补写） */
  'contextMenu.copyBlockLink': '复制块链接',
  /** 簇 2 父项：行内文本格式子菜单 */
  'contextMenu.textFormat': '文本格式',
  /** 簇 2 父项：段落结构子菜单（列表/标题/引用） */
  'contextMenu.paragraphStyle': '段落设置',
  /** 簇 2 父项：插入子菜单（表格/分隔线/代码块/数学块） */
  'contextMenu.insert': '插入',
  /** 剪贴板四项（键位沿用 CM6 默认，提示列固定显示） */
  'contextMenu.cut': '剪切',
  'contextMenu.copy': '复制',
  'contextMenu.paste': '粘贴',
  'contextMenu.selectAll': '全选',
  /** 命令面板/快捷键页操作名（keybindings 注册表 titleKey） */
  'command.block.copyLink.title': '复制当前块链接',

  // ---- #239 中文分词词级移动（操作注册表 + 设置页分页 + 宿主通知）----
  /** 词级移动四操作（默认 ctrl+方向 / alt+方向（mac 词移动惯例）；
   *  Shift 变体单列操作——扩选注册） */
  'command.wordMotion.cursorLeft.title': '按词左移（中文分词）',
  'command.wordMotion.cursorRight.title': '按词右移（中文分词）',
  'command.wordMotion.selectLeft.title': '按词向左扩展选区（中文分词）',
  'command.wordMotion.selectRight.title': '按词向右扩展选区（中文分词）',
  // ---- #238 选下一处相同词族（操作注册表 titleKey） ----
  'command.find.selectNext.title': '选下一处相同词',
  'command.find.selectPrevious.title': '选上一处相同词',
  'command.find.skipCurrent.title': '跳过当前，选下一处相同词',
  'command.find.allOccurrences.title': '选中全部相同词',
  /** 设置项：分词引擎（呈现归「中文分词」附加分页） */
  'setting.wordSegmentEngine.title': '分词引擎',
  'setting.wordSegmentEngine.description': 'Ctrl+左/右箭头按词移动时对连续中文段的切分引擎。英文与数字段始终沿用内置分组语义。',
  'setting.wordSegmentEngineBuiltin': '内置（Intl.Segmenter）',
  'setting.wordSegmentEngineJieba': 'jieba-wasm（词典分词）',
  /** 设置项：jieba 下载源 */
  'setting.wordSegmentSource.title': 'jieba 下载源',
  'setting.wordSegmentSource.description': 'jieba-wasm 资源的下载来源。资源经锁定版本 sha256 校验后存入扩展存储；下载在扩展宿主侧执行（Remote SSH 场景在远程机下载）。',
  'setting.wordSegmentSourceJsdelivr': 'jsDelivr CDN（默认）',
  'setting.wordSegmentSourceNpmmirror': 'npmmirror（国内镜像）',
  'setting.wordSegmentSourceCustom': '自定义 URL',
  /** 设置项：自定义下载源基址 */
  'setting.wordSegmentCustomUrl.title': '自定义源基址',
  'setting.wordSegmentCustomUrl.description': '自定义模式使用的 HTTPS 目录地址——两个锁定文件按 基址/jieba_rs_wasm.js 与 基址/jieba_rs_wasm_bg.wasm 下载。明文 HTTP 会被拒绝。',
  /** 设置页「中文分词」分页框架与资源管理 */
  'wordSegment.title': '中文分词',
  'wordSegment.engineLabel': '分词引擎',
  'wordSegment.engineDescription': '决定按词移动时连续中文的切分方式，切换即时生效。',
  'wordSegment.engineBuiltinHint': '浏览器内置 ICU 分词，无需下载、始终可用。',
  'wordSegment.engineJiebaHint': '词典质量更好；需一次性下载资源，不可用时自动回退内置引擎。',
  'wordSegment.sourceLabel': '下载源',
  'wordSegment.sourceDescription': '仅在选择 jieba 引擎时生效。',
  'wordSegment.customUrlPlaceholder': 'https://example.com/jieba/',
  'wordSegment.resourceLabel': 'jieba 资源',
  'wordSegment.resourceDescription': '按需下载到扩展存储（约 4 MB），不随扩展打包。删除后回退内置引擎。',
  'wordSegment.installed': '已安装并校验通过（jieba-wasm {version}）。',
  'wordSegment.notInstalled': '未安装，当前使用内置引擎。',
  'wordSegment.downloading': '下载并校验中…',
  'wordSegment.download': '下载',
  'wordSegment.deleteResource': '删除资源',
  'wordSegment.noticeDownloaded': '下载并校验完成。',
  'wordSegment.noticeDownloadFailed': '下载失败：{detail}',
  'wordSegment.noticeDeleted': '资源已删除，回退内置引擎。',
  'wordSegment.noticeDeleteFailed': '删除失败：{detail}',
  'wordSegment.noticeLoadFailed': '已下载资源在编辑器中加载失败，回退内置引擎。{detail}',
  /** 宿主通知（下载/删除结果） */
  'host.jiebaDownloaded': 'jieba-wasm {version} 已下载并校验通过，按词移动已切换为 jieba。',
  'host.jiebaDownloadFailed': 'jieba 资源下载失败：{detail}。按词移动继续使用内置引擎。',
  'host.jiebaDeleted': 'jieba 资源已删除，按词移动回退内置引擎。',
  'host.jiebaDeleteFailed': 'jieba 资源删除失败：{detail}。',
  'host.jiebaLoadFailed': 'jieba 在编辑器中加载失败：{detail}。内置引擎保持生效。',
  /** #322 默认编辑器守护：设置项（呈现归 #323 常规页「默认编辑器」委托组） */
  'setting.defaultEditorGuard.title': '默认编辑器守护',
  'setting.defaultEditorGuard.description': '当其他扩展抢占 Markdown 文件的默认编辑器时显示提示通知，并可一键改回 Vsidian。',
  /** #322 默认编辑器守护：宿主通知（抢占提示 / 修复结果） */
  'host.defaultEditorTakenOver': 'Markdown 文件的默认编辑器当前为 {name}，要改回 Vsidian 吗？',
  'host.defaultEditorBuiltinName': 'VSCode 内置文本编辑器',
  'host.defaultEditorFixLabel': '改回 Vsidian',
  'host.defaultEditorDismissLabel': '忽略',
  'host.defaultEditorFixed': 'Vsidian 已恢复为 Markdown 文件的默认编辑器。',
  'host.defaultEditorFixFailed': '未能自动恢复默认编辑器（可能被工作区设置覆盖），即将打开编辑器关联设置供手动处理。',
  /** #323 设置页常规页「默认编辑器」委托组：组标题、状态行四形态与手动按钮 */
  'defaultEditor.title': '默认编辑器',
  'defaultEditor.statusLabel': '当前默认编辑器',
  'defaultEditor.statusDescription': 'Markdown 文件默认由哪个编辑器打开。被其他扩展抢占时可一键改回 Vsidian。',
  'defaultEditor.statusPending': '正在读取当前关联…',
  'defaultEditor.statusVsidian': 'Vsidian',
  'defaultEditor.statusBuiltin': 'VSCode 内置文本编辑器',
  'defaultEditor.statusOther': '其他扩展：{name}',
  'defaultEditor.statusNone': '无记录（打开 Markdown 文件时由 VSCode 仲裁决定）',
  'defaultEditor.fixButton': '设为默认',
  /** #350 T01 附加组件：设置页「附加组件」分页（状态列表与 VSCode 管理入口） */
  'settings.addonsSection': '附加组件',
  'settings.addonsSectionDescription': 'Vsidian 附加组件是独立的 VSCode 扩展：安装、卸载与禁用由 VSCode 管理，能力由组件代码经附加组件 API 注册。该 API 仍为草案。',
  'addons.groupOfficial': '核心组件',
  'addons.groupThirdParty': '第三方组件',
  'addons.empty': '当前扩展宿主中未发现 Vsidian 附加组件。',
  'addons.statusRegistered': '已注册',
  'addons.statusActivating': '正在唤醒…',
  'addons.statusAwaitingRegistration': '已激活，等待组件注册',
  'addons.statusIncompatible': '不兼容：声明 API {range}，宿主 API {version}',
  'addons.statusActivationFailed': '激活失败：{detail}',
  'addons.statusHostUnavailable': '当前扩展宿主中查不到该扩展——请在 VSCode 扩展管理中检查安装状态或运行位置',
  'addons.statusInvalidDeclaration': '身份声明不合法：{detail}',
  'addons.apiVersionLabel': '附加组件 API 版本 {version}（草案，未发布稳定 API）',
  'addons.searchMarketplace': '在市场搜索附加组件',
  'addons.openExtensionsView': '在 VSCode 管理扩展',
  'addons.openDetail': '扩展详情',
  'addons.officialBadge': '官方',
  // #351 T02：运行生命周期（功能开关 / 组件设置页 / 故障暂停）
  'addons.enable': '启用',
  'addons.disable': '停用',
  'addons.openSettingsPage': '打开组件设置页',
  'addons.closeSettingsPage': '关闭组件设置页',
  'addons.addonSettingsTitle': '组件设置页：{label}',
  'addons.statusEnabledRuntime': '已启用',
  'addons.statusDisabled': '已停用',
  'addons.statusFaulted': '故障暂停：{detail}',
  // ---- #353 T04 基础设置区（双标签作用范围 / 基础控件 / 保存反馈） ----
  'addons.openSettingsArea': '设置',
  'addons.settingsAreaTitle': '基础设置：{label}',
  'addons.closeSettingsArea': '关闭基础设置',
  'addons.scopeUserDefault': '用户默认',
  'addons.scopeWorkspace': '当前工作区',
  'addons.noWorkspaceHint': '当前无打开的工作区——工作区层不可用',
  'addons.useUserDefault': '使用用户默认',
  'addons.sourceDefault': '默认',
  'addons.sourceUser': '用户默认',
  'addons.sourceWorkspace': '工作区覆盖',
  'addons.enableSwitchTitle': '功能开关',
  'addons.enableSwitchDescription': '控制本组件在 Vsidian 中的编辑、渲染与界面功能；关闭后保留设置能力',
  'addons.arrayAddItem': '添加项',
  'addons.arrayRemoveItem': '移除',
  'addons.saveChanges': '保存',
  'addons.savedNotice': '已保存（{scope}）',
  'addons.saveFailedNotice': '保存失败：{reason}',
  'addons.saveFailedInvalid': '值不合法：{keys}',
  'addons.saveFailedUnknownKey': '未知设置项：{keys}',
  'addons.saveFailedNoWorkspace': '当前无工作区',
  'addons.saveFailedStore': '存储写入失败',
  'addons.saveFailedRejected': '组件代次已终结',
  'addons.openCustomPage': '打开自定义设置页',
  'addons.settingsEmpty': '该组件未注册设置定义',
  'addons.faultedSettingsHint': '组件故障暂停——自定义设置页已撤下，可先用基础控件修正参数，再从组件管理页手动重试',
  /** #354 T05 侧栏三组结构（选项/核心组件/第三方组件）与故障排障入口 */
  'settings.sidebarOptions': '选项',
  'addons.sidebarCoreAddons': '核心组件',
  'addons.sidebarThirdPartyAddons': '第三方组件',
  'addons.sidebarEnabledGroup': '已启用',
  'addons.sidebarDisabledGroup': '已停用',
  'addons.sidebarFaultBadge': '故障暂停',
  'addons.sidebarEmptyGroup': '暂无附加组件',
  'addons.openLogs': '查看组件日志',
  'addons.retryFaulted': '重试组件',
  'addons.faultTroubleshootTitle': '组件故障暂停',
  'addons.faultTroubleshootHint': '该组件在 Vsidian 中的全部注册功能已暂停，自定义设置页已撤下。已有设置定义时下方基础控件仍可修改参数；完整诊断信息将在后续版本提供。',
  /** #350 T01 附加组件：宿主输出通道名（安装态日志，标明组件 ID 与原因） */
  'host.addonsChannelName': 'Vsidian 附加组件',
}
