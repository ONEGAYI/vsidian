// 英文语言包（#93 i18n 基础设施）——字典单一事实源的【类型基准】：
// `MessageKey = keyof typeof en`，zh-cn.ts 以 `Record<MessageKey, string>`
// 约束（缺键/多键即 tsc 编译失败，编译期 parity）。
//
// 翻译约定（规格「翻译流程与术语」）：术语以 docs/specs/i18n.md 附录术语表
// 为唯一术语源；按钮与动作用祈使动词，标题与标签名词短语，描述为完整句、
// 句尾句号，sentence case。#93 入基础设施词条；#94 补编辑器 webview 呈现面
// （common/format/sidebar/find/conflict/outline/outlineMenu/table/codeblock/
// decor）；#95 补设置页框架、快捷键分页、设置项定义（setting.*）与宿主消息
// （host.*）词条（键前缀分组见规格「字典架构」表）。
export const en = {
  // ---- settings.（设置页框架：标题、搜索、分类、保存状态、空状态）----
  /** 设置页面板标题（宿主 createWebviewPanel 标题与页面 h1 同源） */
  'settings.pageTitle': 'Vsidian Settings',
  'settings.searchPlaceholder': 'Search settings…',
  'settings.searchAriaLabel': 'Search all settings',
  'settings.navLabel': 'Options',
  'settings.navAriaLabel': 'Setting categories',
  'settings.saving': 'Saving…',
  'settings.saveDone': 'Settings saved',
  'settings.saveFailed': 'Failed to save the setting; the currently effective value has been restored. Please try again.',
  /** 默认分类（侧栏入口、搜索分组与空 section 兜底共用） */
  'settings.editorCategory': 'Editor',
  'settings.searchResults': 'Search results',
  'settings.searchCount': 'Settings found: {count}',
  'settings.searchEmpty': 'No matching settings found. Try other keywords.',
  'settings.editorSubtitle': 'Adjust editing and presentation behavior. Changes are saved automatically.',
  'settings.empty': 'Nothing to configure yet.',
  /** Editor-page group section titles (#163 second-pass restore: sidebar keeps
   *  General/Editor only; categories render as in-page group titles — group* keys) */
  'settings.groupDisplay': 'Display',
  /** 设置页「常规」分组标题（#96 general.* 设置项的归属分组） */
  'settings.generalSection': 'General',
  /** 设置页「常规」分组副文案（对齐「编辑器」分组的说明句式） */
  'settings.generalSectionDescription':
    'Adjust basic Vsidian behavior. Changes save automatically.',
  /** Editor-page section: editor.symbol* input behaviors */
  'settings.groupSymbols': 'Symbols',
  /** Editor-page section: codeblock.* presentation */
  'settings.groupCodeblock': 'Code blocks',
  /** Editor-page section: image.* paste settings */
  'settings.groupImage': 'Images',

  // ---- keybindingSettings.（快捷键分页：标题、模式标签、状态、搜索、按钮）----
  'keybindingSettings.title': 'Keybindings',
  'keybindingSettings.description': 'Manage keybindings for Vsidian actions. Conflict checks cover Vsidian internals; effective keys from VS Code and other extensions cannot be fully queried.',
  'keybindingSettings.modeLive': 'Live preview',
  'keybindingSettings.modeReading': 'Reading',
  /** entries 副文案的模式段（顿号连接） */
  'keybindingSettings.modeBoth': 'Live preview, reading',
  /** 行首模式标签（中点连接） */
  'keybindingSettings.modeLiveReading': 'Live preview · Reading',
  /** 冲突文案中操作名的连接符（zh 顿号 / en 逗号加空格） */
  'keybindingSettings.nameSeparator': ', ',
  'keybindingSettings.saving': 'Saving…',
  'keybindingSettings.saved': 'Keybinding saved and effective immediately.',
  'keybindingSettings.saveFailedStorage': 'Failed to save; the currently effective bindings have been restored.',
  'keybindingSettings.conflictInternal': 'Conflict within Vsidian: {names}',
  'keybindingSettings.conflictSave': 'Conflict within Vsidian: {names}. You can replace the original binding.',
  'keybindingSettings.conflictReset': 'Restoring the default conflicts with {names}. You can replace the original binding.',
  'keybindingSettings.conflictRow': 'Conflicts with {names}.',
  'keybindingSettings.invalid': 'Invalid keybinding; not saved.',
  'keybindingSettings.resetFailed': 'Failed to restore the default.',
  'keybindingSettings.searchNamePlaceholder': 'Search action names',
  /** 搜索框内键盘图标按钮（#155）：点击切换为按键捕获过滤模式 */
  'keybindingSettings.keySearchToggle': 'Filter by keybinding',
  /** 键位捕获签占位（#155）：行内就地录制键位 */
  'keybindingSettings.capturePlaceholder': 'Press a shortcut…',
  /** 筛选签（#155）：冲突/全部/已分配/由我分配/未分配 */
  'keybindingSettings.filterAll': 'All',
  'keybindingSettings.filterConflicts': 'Conflicts',
  'keybindingSettings.filterAssigned': 'Assigned',
  'keybindingSettings.filterUserAssigned': 'Assigned by me',
  'keybindingSettings.filterUnassigned': 'Unassigned',
  /** 行内更多操作菜单（⋯）按钮与容器的可访问名 */
  'keybindingSettings.moreActions': 'More actions',
  /** 捕获态提交钮（＋ 原位变更）的可访问名 */
  'keybindingSettings.commitCapture': 'Commit keybinding',
  'keybindingSettings.resetAll': 'Reset all to defaults',
  'keybindingSettings.noMatch': 'No matching actions.',
  'keybindingSettings.unbound': 'Unbound',
  'keybindingSettings.addBinding': 'Add binding',
  'keybindingSettings.clearBindings': 'Clear bindings',
  'keybindingSettings.resetDefault': 'Reset to default',
  'keybindingSettings.replaceConflicts': 'Replace original binding',

  // ---- setting.（设置项定义 title/description，经 titleKey/descriptionKey 取词）----
  'setting.editorLineNumbers.title': 'Show line numbers',
  'setting.editorLineNumbers.description': 'Show source file line numbers in the left gutter of the live preview (not shown in reading view).',
  'setting.codeblockCard.title': 'Code block card',
  'setting.codeblockCard.description': 'Collapse a fenced code block into a card when the cursor leaves it: hide the fence markers and show a language header bar. Turn off to restore the plain source fence look.',
  'setting.codeblockLineNumbers.title': 'Line numbers inside cards',
  'setting.codeblockLineNumbers.description': 'Show per-block line numbers at the start of each line inside the card (counting from 1 per block; fence lines excluded). Requires "Code block card".',
  'setting.codeblockCopyButton.title': 'Copy button',
  'setting.codeblockCopyButton.description': 'Show a copy button on the card header on hover; click to copy the whole block (without fence lines). Requires "Code block card".',
  'setting.codeblockHighlight.title': 'Syntax highlighting',
  'setting.codeblockHighlight.description': 'Colorize code block content by language (also applies to plain fences when the card is off; unrecognized languages fall back to plain text).',
  /** 设置项「符号自动补全」（#123 editor.symbolAutocomplete） */
  'setting.symbolAutocomplete.title': 'Auto-close symbol pairs',
  'setting.symbolAutocomplete.description':
    'In live preview, typing an opening symbol also inserts its closing counterpart (brackets and quotes pair even inside code; Markdown emphasis triggers only at a run start). Typing the closing symbol again right after an auto-inserted one skips over it, and backspace inside an empty auto-inserted pair deletes both sides. Turn off to disable all of these.',
  /** 设置项「选区符号包裹」（#124 editor.symbolSelectionWrap） */
  'setting.symbolSelectionWrap.title': 'Wrap selection with symbols',
  'setting.symbolSelectionWrap.description':
    'With text selected in live preview, typing a registered symbol wraps both sides of the selection (repeated typing stacks markers: two asterisks make bold, two brackets form wiki-link-style structures; a cross-paragraph selection wraps each paragraph and keeps blank lines). The original text stays selected after wrapping. Markdown emphasis is not wrapped inside code; independent from auto-close above.',
  /** 设置项「符号 Tab 越界」（#125 editor.symbolTabEscape） */
  'setting.symbolTabEscape.title': 'Tab escapes symbol fences',
  'setting.symbolTabEscape.description':
    'With the cursor inside a paired symbol fence (brackets, quotes, or inline Markdown structures) and no text selected, Tab first moves to the left edge of the closing marker, then jumps over it; nested fences exit innermost first. Tab moves the cursor only and never edits text. Outside fences, Tab keeps the existing behavior (table cell navigation or line indent); Shift+Tab is unaffected. Independent from the two symbol settings above.',
  /** 设置项「界面语言」（#96 general.language，经 titleKey/descriptionKey 取词） */
  'setting.language.title': 'Interface language',
  'setting.language.description':
    'The display language for interface text. Auto follows the VS Code display language (Simplified Chinese in Chinese environments, English otherwise); an explicit choice no longer follows it. Changes take effect immediately.',
  /** 语言下拉 auto 档显示名（随当前语言取词；具体语言为静态自名不自译） */
  'setting.languageAuto': 'Auto',
  /** 测试钩子 fixture 定义（VSIDIAN_TEST_HOOKS 注入设置页的占位开关） */
  'setting.testFlag.title': 'Test flag',

  // ---- cssSnippets.（CSS 片段设置分页：目录行、状态条、按钮，#128）----
  'styleRef.title': 'Style reference',
  'styleRef.description': 'Browse the public style contract of this installed version: selectors, CSS variables, Obsidian-name compatibility levels and limitations. Generated from the contract manifest.',
  'styleRef.versionNote': 'This reference matches the installed version {version}.',
  'styleRef.bridgeNote': 'Entries marked "direct" accept the listed Obsidian selector/variable names as-is: vsidian elements carry both names, and variables fall back through var(Obsidian-name, default). A vsidian-name override always takes precedence over an Obsidian name.',
  'styleRef.variableTable': 'Obsidian variable aliases',
  'styleRef.varObsidian': 'Obsidian variable',
  'styleRef.varVsidian': 'vsidian variable (precedence)',
  'styleRef.varDefault': 'Default when unset',
  'styleRef.domainFilter': 'Filter by domain',
  'styleRef.supportFilter': 'Filter by support level',
  'styleRef.searchPlaceholder': 'Search entries (id / selector / purpose)',
  'styleRef.filterAll': 'All',
  'styleRef.domainContent': 'Content',
  'styleRef.domainChrome': 'Interface',
  'styleRef.kindContainer': 'Containers',
  'styleRef.kindSelector': 'Selectors',
  'styleRef.kindVariable': 'CSS variables',
  'styleRef.kindLimitation': 'Limitations',
  'styleRef.supportDirect': 'Direct',
  'styleRef.supportSemantic': 'Semantic',
  'styleRef.supportNative': 'Native',
  'styleRef.supportNone': 'None',
  'styleRef.viewLive': 'Live preview',
  'styleRef.viewReading': 'Reading',
  'styleRef.viewNone': 'Not an editor view',
  'styleRef.obsidianCounterpart': 'Obsidian counterpart',
  'styleRef.aliasTargets': 'Alias promises',
  'styleRef.deprecated': 'Deprecated',
  'styleRef.removed': 'Removed',
  'styleRef.empty': 'No entries match the current filters.',
  // ---- #145 类目分栏分页与契约 JSON 导出 ----
  'styleRef.categoryNav': 'Browse by category',
  // #155 小改：总分页签（总表/详细查询两态）
  'styleRef.tabNav': 'Style reference views',
  'styleRef.tabOverview': 'Reference',
  'styleRef.tabDetail': 'Detailed lookup',
  'styleRef.exportJson': 'Export JSON',
  'styleRef.prevPage': 'Previous page',
  'styleRef.nextPage': 'Next page',
  'styleRef.pageIndicator': 'Page {page} of {pages}',
  'styleRef.searchCount': '{count} matches across all categories',
  'styleRef.category.viewContainer': 'Containers & views',
  'styleRef.category.heading': 'Headings',
  'styleRef.category.inlineFormat': 'Inline formatting',
  'styleRef.category.listTask': 'Lists & tasks',
  'styleRef.category.lineSyntax': 'Line-level syntax',
  'styleRef.category.table': 'Tables',
  'styleRef.category.readingStructure': 'Reading block structure',
  'styleRef.category.linkImageWikilink': 'Links, images & wikilinks',
  'styleRef.category.contentVariables': 'Public CSS variables',
  'styleRef.category.contentLimits': 'Limitations',
  'styleRef.category.math': 'Math',
  'styleRef.category.diagram': 'Diagram rendering',
  'styleRef.category.graphicInteract': 'Graphic controls & popup',
  'styleRef.category.codeCard': 'Code block cards',
  'styleRef.category.outline': 'Outline panel',
  'styleRef.category.chromeLimits': 'Limitations',
  'styleRef.category.frontmatter': 'Frontmatter table',
  'styleRef.category.toolbarBanner': 'Toolbar & banner',
  'styleRef.category.contextMenu': 'Content context menu',
  'host.styleRefExported': 'Style contract JSON exported: {path}',
  'host.styleRefExportFailed': 'Failed to export style contract JSON: {reason}',
  'host.styleRefExportReasonMissingAsset': 'extension install incomplete (style-reference.json missing)',
  'host.styleRefExportReasonWriteFailed': 'writing the file failed',
  'command.exportStyleReference.title': 'Vsidian: Export style reference JSON',
  'command.openStyleReference.title': 'Vsidian: Open style reference',
  'cssSnippets.title': 'CSS snippets',
  'cssSnippets.description': 'Load first-level .css files from a user-level folder as snippets shared across projects. New snippets start disabled; files load in deterministic filename order, so later files override earlier ones at equal specificity.',
  'cssSnippets.directoryLabel': 'Snippets directory',
  'cssSnippets.chooseDirectory': 'Choose directory…',
  'cssSnippets.chooseOpenLabel': 'Select folder',
  'cssSnippets.openDirectory': 'Open in file manager',
  'cssSnippets.refresh': 'Reload snippets',
  'cssSnippets.noDirectory': 'No snippets directory selected. Choose a folder; its first-level .css files become snippets (new files start disabled).',
  'cssSnippets.emptyDirectory': 'No .css files found in the first level of the selected directory.',
  'cssSnippets.readError': 'Failed to read the snippets directory. The list below is the last successful state; open editors keep the last applied styles.',
  /** #131 暂停/恢复（全局冻结，保留逐片段开关；恢复按原配置生效） */
  'cssSnippets.pauseAll': 'Pause all snippets',
  'cssSnippets.resume': 'Resume snippets',
  'cssSnippets.pausedStatus': 'All CSS snippets are paused. Per-snippet switches are kept; resuming reloads them exactly as configured.',
  'cssSnippets.entryRejected': 'Rejected: references a path outside the snippets directory.',
  'cssSnippets.remoteCacheNote': 'HTTPS imports and online fonts (@import url(https://…) and @font-face src) load directly from the network. Manual reload only re-fetches your local snippet entries; remote stylesheets and fonts follow the server’s HTTP cache headers, and remote servers are not monitored for changes.',

  // ---- host.（宿主通知、确认框、QuickPick、链接拦截反馈）----
  'host.conflictInputCopied': 'Unconfirmed input copied to clipboard',
  'host.noConflictInputToCopy': 'No unconfirmed input to copy',
  'host.copyConflictInput': 'Copy unconfirmed input',
  'host.discardAndResync': 'Discard local changes and resync',
  'host.confirmResume': 'This will discard the unconfirmed local changes in the "{name}" editor and resync with the on-disk/authoritative content. Consider copying the unconfirmed input first.',
  'host.conflictPaused': 'Editing of "{name}" is paused: the external change and the unconfirmed input cannot be merged safely. The unconfirmed input is kept and can be retrieved at any time.',
  'host.panelClosedWithInput': 'The editor for "{name}" was closed (or the connection dropped) with unsaved unconfirmed input: {text}',
  'host.wikilinkUnsupported': 'Unsupported wikilink form "[[{target}]]" (embeds ![[…]] belong to a later phase): kept as-is',
  'host.wikilinkNoWorkspace': 'The current document is not in any workspace folder: wikilink targets are resolved against the workspace, so jumping is unavailable with no folder open (the link text is kept)',
  'host.wikilinkNotFound': 'Wikilink target not found: [[{target}]] (looked up on demand within the current workspace; files are never created automatically)',
  'host.wikilinkAmbiguousPick': 'Multiple wikilink targets found for "{target}"; choose the note to open',
  'host.wikilinkHeadingMissing': 'Opened {link} in the target document, but the heading "{heading}" was not found (heading matching: trimmed, whitespace-collapsed, case-insensitive ATX headings)',
  'host.rejectDiffContext': 'View switching is not supported in diff views',
  'host.rejectPanelNotReady': 'The Vsidian panel is not ready yet; please retry shortly',
  'host.rejectAlreadySource': 'Already in the source editor',
  'host.noActiveMarkdown': 'Focus a Markdown document first (a Vsidian panel or a .md source editor) before switching view modes',
  'host.noPanelForFind': 'Focus a Vsidian editor panel first before using find in the editor',
  'host.readOnlyTableOp': 'Reading view is read-only: switch to live preview before running table operations',
  'host.noPanelForTableCreate': 'Focus a Vsidian editor panel first before creating a table',
  'host.noPanelForTableOp': 'Focus a Vsidian editor panel first (with the cursor inside a table) before running table operations',
  'host.blockedLinkEmpty': 'The link target is empty (blank or anchor-only): in-document anchors are not supported in this phase',
  'host.blockedLinkScheme': 'Link protocol "{scheme}" is not allowed: only http/https and in-workspace paths are supported',
  'host.blockedLinkEscape': 'The link points outside the workspace and was blocked: {detail}',
  'host.blockedLinkWindowsDrive': 'Windows drive-letter path links are not supported on remote (POSIX) workspaces',
  'host.externalOpenFailed': 'Failed to open the external link: {url}',
  'host.linkNotFound': 'Link target not found: {href} (resolved relative to the current document directory)',
  /** #128 CSS 片段：宿主侧用户提示 */
  'host.cssSnippetLoadFailed': 'Failed to load CSS snippet "{name}"; the last successful styles are kept.',
  'host.cssSnippetReadFailed': 'Failed to read the CSS snippets directory "{directory}".',
  /** #131 暂停/恢复命令反馈（命令面板触发时无 webview 也可见） */
  'host.cssSnippetsPaused': 'All CSS snippets are paused. Per-snippet switches are kept.',
  'host.cssSnippetsResumed': 'CSS snippets resumed; enabled snippets reload as configured.',
  'host.cssSnippetRejectedEscape': 'CSS snippet "{name}" references "{path}", which is outside the snippets directory; loading it is rejected.',
  'host.cssSnippetRejectedSymlink': 'CSS snippet "{name}" resolves through a link to "{path}", which is outside the snippets directory; loading it is rejected.',
  /** 运行时设置定义注册（测试钩子/懒注册）的拒绝原因 */
  'host.invalidSettingDefinition': 'Invalid definition: {definition}',
  'host.duplicateSettingKey': 'Setting key already exists: {key}',

  // ---- #94 编辑器 webview 呈现面 ----

  /** 跨面通用：快捷键提示前缀与多键位连接符（zh 顿号、en 逗号） */
  'common.keybindingHint': 'Keybinding: {keys}',
  'common.keySeparator': ', ',

  /** 快捷操作工具条 24 条操作标题（兼作命令 title 的 NLS 生成源，#97 映射） */
  'format.bold': 'Bold',
  'format.italic': 'Italic',
  'format.strikethrough': 'Strikethrough',
  'format.highlight': 'Highlight',
  'format.inlineCode': 'Inline code',
  'format.heading1': 'Heading 1',
  'format.heading2': 'Heading 2',
  'format.heading3': 'Heading 3',
  'format.heading4': 'Heading 4',
  'format.heading5': 'Heading 5',
  'format.heading6': 'Heading 6',
  'format.headingNone': 'Remove heading',
  'format.bulletList': 'Bullet list',
  'format.orderedList': 'Numbered list',
  'format.taskList': 'Task list',
  'format.quote': 'Quote',
  'format.codeBlock': 'Code block',
  'format.link': 'Link',
  'format.clearInline': 'Clear inline formatting',
  'format.inlineMath': 'Insert inline math',
  'format.blockMath': 'Insert block math',
  'format.wikilink': 'Insert wikilink',
  'format.horizontalRule': 'Insert horizontal rule',
  'format.htmlComment': 'HTML comment',

  /** 快捷操作工具条框架（分组、标题菜单；非命令标题，不进 #97 映射） */
  'format.toolbarAria': 'Formatting quick actions',
  'format.groupText': 'Text',
  'format.groupParagraph': 'Paragraph',
  'format.groupInsert': 'Insert',
  'format.heading': 'Heading',
  'format.headingMenu': 'Heading level',
  /** 标题菜单里「无标题」档的文字图标（与 H1–H6 同宽槽位，取正文术语缩写） */
  'format.bodyText': 'Body',
  'format.insertTable': 'Insert table',

  /** 右侧栏（顶栏按钮与侧栏切换） */
  'sidebar.settings': 'Open Vsidian settings',
  'sidebar.quickActions': 'Quick actions',
  'sidebar.collapse': 'Collapse sidebar',
  'sidebar.expand': 'Expand sidebar',
  /** #141 toolbar dual-state view toggle (aria/title names the target action) */
  'toolbar.switchToReading': 'Switch to reading view',
  'toolbar.switchToLive': 'Switch to live preview',
  'sidebar.resize': 'Drag to resize sidebar',

  /** 查找控件 */
  'find.placeholder': 'Find',
  'find.label': 'Find in document',
  'find.caseToggle': 'Ignore case',
  'find.prev': 'Previous match',
  'find.next': 'Next match',
  'find.close': 'Close find',

  /** 外部修改冲突横幅 */
  'conflict.bannerText':
    'An external change was detected that cannot be synced safely: writing back is paused, and your local input is kept and will not be overwritten.',
  'conflict.copyUnconfirmed': 'Copy unconfirmed input',
  'conflict.resume': 'Discard local changes and resync',

  /** 大纲面板（标题、空态、折叠滑块、搜索工具条） */
  'outline.label': 'Outline',
  'outline.empty': 'No headings',
  'outline.chevron': 'Collapse or expand',
  'outline.searchPlaceholder': 'Input to search',
  'outline.searchLabel': 'Search headings',
  'outline.jumpBottom': 'Jump to end of note',
  'outline.reset': 'Reset',
  'outline.noMatch': 'No match',
  'outline.expandLevels': 'Outline expand level',
  'outline.collapseAll': 'Collapse all',
  'outline.expandLevel1': 'Expand to level 1',
  'outline.expandLevel2': 'Expand to level 2',
  'outline.expandLevel3': 'Expand to level 3',
  'outline.expandLevel4': 'Expand to level 4',
  'outline.expandLevel5': 'Expand to level 5',
  'outline.renameHeading': 'Rename heading',

  /** 大纲右键菜单 */
  'outlineMenu.expandRecursively': 'Expand recursively',
  'outlineMenu.collapseSiblings': 'Collapse siblings',
  'outlineMenu.expandSiblings': 'Expand siblings',
  'outlineMenu.copy': 'Copy',
  'outlineMenu.copyHeading': 'Heading',
  'outlineMenu.copySiblings': 'Heading and sibling headings',
  'outlineMenu.copyChildren': 'Heading and child headings',
  'outlineMenu.copyLink': 'Heading link',
  'outlineMenu.copySection': 'Section content',
  'outlineMenu.adjustLevel': 'Adjust level',
  'outlineMenu.levelUp': 'Increase by one level',
  'outlineMenu.levelUpRecursive': 'Increase by one level recursively',
  'outlineMenu.levelDown': 'Decrease by one level',
  'outlineMenu.levelDownRecursive': 'Decrease by one level recursively',
  'outlineMenu.rename': 'Rename',
  'outlineMenu.delete': 'Delete',

  /** 表格可见行控件 */
  'table.controls': 'Table controls',
  'table.insertColumnRight': 'Add column on the right',
  'table.insertRowBelow': 'Add row at the bottom',
  'table.selectRow': 'Select or drag row {n}',
  'table.selectColumn': 'Select or drag column {n}',

  /** 代码块卡片 */
  'codeblock.copy': 'Copy code',
  'codeblock.expand': 'Expand code block',
  'codeblock.collapse': 'Collapse code block',

  /** 图形化代码块按钮组与图表弹窗（#111） */
  'graphic.editSource': 'Edit source',
  'graphic.popup': 'Open in popup',
  'graphic.popupZoomIn': 'Zoom in',
  'graphic.popupZoomOut': 'Zoom out',
  'graphic.popupReset': 'Reset zoom',
  'graphic.popupRefresh': 'Refresh',
  'graphic.popupExportSvg': 'Export as SVG',
  'graphic.popupExportPng': 'Export as PNG',
  'graphic.popupClose': 'Close',
  'graphic.exportPngUnavailable': 'PNG export is unavailable here; use SVG export instead.',
  'graphic.exportFailed': 'Diagram export failed',
  'graphic.exportSvgFilter': 'SVG file',
  'graphic.exportPngFilter': 'PNG image',

  /** 图片/公式/任务/Mermaid 装饰与错误占位 */
  'decor.taskCheck': 'Check task',
  'decor.taskUncheck': 'Uncheck task',
  'decor.emptyCell': 'Empty cell',
  'decor.mathError': 'Math failed to parse: source text is shown; move the cursor in to edit',
  'decor.imageError': 'Image failed to load ({reason}). Click to retry',
  'decor.unknownReason': 'unknown reason',
  'decor.mermaidUnavailable': 'Diagram renderer unavailable (mermaid.js failed to load)',
  'decor.mermaidError': 'Diagram failed to render: {message}',

  // ---- frontmatter.（#140 表格卡片：标题栏、修改按钮与 Popover 编辑）----
  /** 卡片标题栏文字（对齐 Obsidian Properties 面板） */
  'frontmatter.title': 'Properties',
  /** 标题栏右上角「修改」按钮（打开属性编辑 Popover） */
  'frontmatter.edit': 'Edit',
  /** Popover 容器 aria 标签 */
  'frontmatter.popoverAriaLabel': 'Edit properties',
  /** Popover 内键名输入框 aria 标签 */
  'frontmatter.keyAriaLabel': 'Property name',
  /** Popover 内值输入框 aria 标签 */
  'frontmatter.valueAriaLabel': 'Property value',
  /** Popover 内数组项输入框 aria 标签 */
  'frontmatter.itemAriaLabel': 'List item',
  'frontmatter.addProperty': 'Add property',
  'frontmatter.removeProperty': 'Delete property',
  'frontmatter.removeConfirm': 'Confirm delete',
  'frontmatter.addItem': 'Add list item',
  'frontmatter.removeItem': 'Delete list item',
  'frontmatter.empty': 'No properties yet',

  // ---- #97 manifest NLS（命令 title 与 displayName/description 生成源）----
  // 工具条 24 条命令直接复用上方 format.* 既有键（FORMAT_OPERATIONS 的
  // titleKey，见 scripts/genNls.mjs 映射）；其余命令的键按 id 推导：
  // onegayi.vsidian.<suffix> → command.<suffix>.title（既有唯一键
  // command.table.create.title 天然吻合该规则，单轨收编，不留双轨）。
  // 这些 command.* 键同时是 KEYBINDING_OPERATIONS extra/UI 源操作名的
  // titleKey（快捷键页与命令面板同源，无第二套文案）。
  /** 扩展市场 displayName / description（含 customEditors displayName 同源） */
  'manifest.displayName': 'Vsidian',
  'manifest.description': 'Obsidian-like Markdown editing: live preview + reading views',

  'command.toggleViewMode.title': 'Switch to the next view mode',
  'command.mode.toReading.title': 'Switch to reading view',
  'command.mode.toSource.title': 'Switch to the source editor',
  'command.mode.toLive.title': 'Switch to live preview',
  /** #141 dual-state toggle (live↔reading; shared by toolbar button and Ctrl+Q) */
  'command.mode.toggleDualView.title': 'Toggle reading/live preview',
  'command.find.title': 'Find (in the editor)',
  'command.find.next.title': 'Next match',
  'command.find.previous.title': 'Previous match',
  'command.table.create.title': 'Create a table',
  'command.table.insertRowAbove.title': 'Table: insert row above',
  'command.table.insertRowBelow.title': 'Table: insert row below',
  'command.table.deleteRow.title': 'Table: delete row',
  'command.table.insertColumnLeft.title': 'Table: insert column left',
  'command.table.insertColumnRight.title': 'Table: insert column right',
  'command.table.deleteColumn.title': 'Table: delete column',
  'command.openSettings.title': 'Open settings',
  /** #128 CSS 片段刷新命令（快捷键页与命令面板同源） */
  'command.cssSnippets.refresh.title': 'CSS snippets: reload',
  /** #131 暂停/恢复全部片段命令 */
  'command.cssSnippets.pause.title': 'CSS snippets: pause all',
  'command.cssSnippets.resume.title': 'CSS snippets: resume',
  'command.ui.sidebarToggle.title': 'Expand or collapse the sidebar',
  'command.ui.outlineToggle.title': 'Show or hide the outline',
  'command.ui.outlineSearch.title': 'Search headings',
  'command.ui.outlineJumpBottom.title': 'Jump to end of note',
  'command.ui.outlineReset.title': 'Reset outline',
  'command.ui.outlineCollapseAll.title': 'Collapse all outline headings',
  'command.ui.outlineExpandAll.title': 'Expand all outline headings',

  // ---- #159 锚点跳转（块引用定位与本文件锚点）----
  /** 块 id 缺失提示（与标题缺失同款「打开后提示」行为） */
  'host.wikilinkBlockMissing': 'Opened {link} in the target document, but the block reference "^{blockId}" was not found (block ids are ` ^id` markers at the end of a block’s last line)',

  // ---- #160 普通链接锚点定位（host 通知）----
  'host.linkAnchorMissing':
    'Opened the document targeted by {href}, but the heading "{heading}" was not found (heading matching: trimmed, whitespace-collapsed, case-insensitive ATX headings)',

  // ---- #161 image paste (setting entries + host notifications) ----
  'setting.imagePaste.title': 'Paste images from clipboard',
  'setting.imagePaste.description': 'When pasting an image in the live preview, save it to the configured asset folder and insert a Markdown image reference at the cursor.',
  'setting.imagePasteLocation.title': 'Image save location',
  'setting.imagePasteLocation.description': 'Where pasted images are saved: next to the current file, under the workspace root plus subpath, or next to the current file plus subpath. The subpath applies to the last two modes only.',
  'setting.imagePasteLocationSameDir': 'Same folder as the file',
  'setting.imagePasteLocationWorkspaceRoot': 'Relative to workspace root',
  'setting.imagePasteLocationRelativeToFile': 'Relative to current file',
  'setting.imagePasteSubpath.title': 'Image subpath',
  'setting.imagePasteSubpath.description': 'Subfolder appended in the workspace-root and relative-to-file modes — greyed out while the same-folder mode is selected. Absolute paths and parent traversal (..) are rejected.',
  'host.imagePasteInvalidLocation': 'Pasted image was not saved: the configured subpath "{subpath}" is invalid (absolute paths and ".." are not allowed).',
  'host.imagePasteNoWorkspaceFallback': 'No workspace folder is open; the pasted image was saved next to the current file.',
  'host.imagePasteWriteFailed': 'Failed to save the pasted image.',

  // ---- #162 复制块链接（正文右键菜单与快捷键）----
  /** 右键菜单：标题行命中的额外项（拼 [[笔记名#标题]]，标题取行面文本） */
  'blockMenu.copyHeadingLink': 'Copy heading link',
  /** 右键菜单/快捷键共用项（拼 [[笔记名#^块id]]，无 id 时先自动补写） */
  'blockMenu.copyLink': 'Copy block link',
  /** 命令面板/快捷键页操作名（keybindings 注册表 titleKey） */
  'command.block.copyLink.title': 'Copy link to current block',
} as const satisfies Record<string, string>

/** 字典键：点分扁平键，以本包为类型基准（编译期检查 t() 取词键） */
export type MessageKey = keyof typeof en
