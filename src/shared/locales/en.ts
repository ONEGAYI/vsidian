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
  /** Editor-page section: editing capabilities (multi-cursor, #237) */
  'settings.groupEditing': 'Editing',
  /** Editor-page section: codeblock.* presentation */
  'settings.groupCodeblock': 'Code blocks',
  /** Editor-page section: image.* paste settings */
  'settings.groupImage': 'Images',
  /** Editor-page section (#298): hover.* preview family and embed.* family */
  'settings.groupRefview': 'Reference views',
  /** Settings-page "Experimental" sidebar category (home for experimental.*
   *  toggles; defaults follow the shipped behavior, disable to fall back) */
  'settings.experimentalSection': 'Experimental',
  'settings.experimentalSectionDescription':
    'Toggles for features not yet settled. They default to the current shipped behavior; disable to fall back to the stable one.',
  /** Experimental-page section: experimental.table.* table behaviors */
  'settings.groupExperimentalTable': 'Table behavior',

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
  /** #296 tables inside block containers: grid rendering for tables nested in
   *  blockquotes/lists and other containers */
  'setting.experimentalTableRender.title': 'Render tables inside containers',
  'setting.experimentalTableRender.description':
    'Render tables inside blockquotes, lists and other containers as tables (both views). Turn off to show their raw source text instead.',
  'setting.readableLineWidth.title': 'Readable line width',
  'setting.readableLineWidth.description': 'Maximum width of the content column in the live preview and reading view: 0 fills the available width; a specific value caps the column, which then centers in the editor area and yields to the outline sidebar when space is tight.',
  'setting.readableLineWidthFill': 'Fill',
  /** #222 embed card height cap (reading-view embeds scroll internally past it) */
  'setting.embedMaxHeight.title': 'Embedded note max height',
  'setting.embedMaxHeight.description': 'Maximum height of the reading-view embed card content area: shorter notes keep their natural height while longer content scrolls inside the card up to this limit.',
  'setting.embedMaxDepth.title': 'Embedded note depth',
  'setting.embedMaxDepth.description': 'Automatically expand references inside embedded notes. The source note is depth 0; 1 shows only direct embeds, and 3 also shows the next two levels.',
  /** #298 hover preview master switch (hover.enabled) */
  'setting.hoverEnabled.title': 'Preview references on hover',
  'setting.hoverEnabled.description': 'Point at a link to open the reference preview popup — covers the reading view body, the live preview, and the backlink/outlink panels (sub-references inside the popup included). Turn off to stop every trigger — hovering and the "Preview the current link" keyboard command — from opening the popup; embeds written in the note body are not affected.',
  /** #299 jump target tip (hover.targetTip) */
  'setting.hoverTargetTip.title': 'Show jump target on hover',
  'setting.hoverTargetTip.description': 'When hovering a reference would not open the preview popup (for example without holding Ctrl in the live view, or while the hover preview master switch is off), show a brief path tip for the target location after a short dwell. Independent of "Preview references on hover" — the tip stays available with the master switch off.',
  /** #221 Live hover trigger (Ctrl+hover vs direct hover); #298 renamed + rewritten */
  'setting.hoverLiveDirect.title': 'Show previews directly on hover in the live view',
  'setting.hoverLiveDirect.description': 'Point at a link in the live preview to open the reference popup directly, without a modifier key. When off, hold Ctrl (Cmd on macOS) while hovering, or press Ctrl mid-hover. Has no effect while "Preview references on hover" is off.',
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
  /** 设置项「多光标」（#237 editor.multicursor） */
  'setting.multicursor.title': 'Multiple cursors',
  'setting.multicursor.description':
    'Enable multiple cursors and secondary selections in live preview: Alt+click adds or removes a cursor at the pointer, Ctrl+Alt+Up/Down adds a cursor on the line above or below, and Esc collapses back to the main cursor. Turn off to restore single-selection editing. Independent from "Wrap selection with symbols".',
  /** 设置项「界面语言」（#96 general.language，经 titleKey/descriptionKey 取词） */
  'setting.language.title': 'Interface language',
  'setting.language.description':
    'The display language for interface text. Auto follows the VS Code display language (Simplified Chinese in Chinese environments, English otherwise); an explicit choice no longer follows it. Changes take effect immediately.',
  /** 语言下拉 auto 档显示名（随当前语言取词；具体语言为静态自名不自译） */
  'setting.languageAuto': 'Auto',
  /** 测试钩子 fixture 定义（VSIDIAN_TEST_HOOKS 注入设置页的占位开关） */
  'setting.testFlag.title': 'Test flag',

  // ---- appearance.（#231 外观合并分页：侧栏条目标题与描述）----
  'appearance.title': 'Appearance',
  'appearance.description': 'Manage CSS snippets and appearance customization: snippet directory, per-file toggles, and the public style contract reference.',

  // ---- styleRef.（样式参考：总表/详细查询文案与骨架标签，#132；#231 起为
  // 外观合并分页的页签体，tabOverview/tabDetail 亦作外观页签文案沿用）----
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
  'styleRef.category.backlinks': 'Backlinks panel',
  'styleRef.category.outlinks': 'Outgoing links panel',
  'styleRef.category.hoverPreview': 'Hover preview',
  'styleRef.category.findPanel': 'Find panel',
  'styleRef.category.loading': 'Loading placeholder',
  'styleRef.category.tooltip': 'Hover hints',
  'host.styleRefExported': 'Style contract JSON exported: {path}',
  'host.styleRefExportFailed': 'Failed to export style contract JSON: {reason}',
  'host.styleRefExportReasonMissingAsset': 'extension install incomplete (style-reference.json missing)',
  'host.styleRefExportReasonWriteFailed': 'writing the file failed',
  'command.exportStyleReference.title': 'Vsidian: Export style reference JSON',
  'command.openStyleReference.title': 'Vsidian: Open style reference',
  'cssSnippets.title': 'CSS snippets',
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
  'host.wikilinkNoWorkspace': 'The current document is not in any workspace folder: wikilink targets resolve relative to the source document, so jumping is unavailable with no folder open (the link text is kept)',
  'host.wikilinkNotFound': 'Wikilink target not found: [[{target}]] (resolved relative to the source document directory; files are never created automatically)',
  'host.wikilinkOutsideRoot': 'Wikilink target escapes the owning workspace root: [[{target}]] (relative paths must stay inside their root)',
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
  /** #198 索引维护命令反馈（命令面板触发时无 webview 也可见；设置页按钮同链路） */
  'host.indexRebuildDone': 'Index rebuilt from disk contents.',
  'host.indexRebuildCancelled': 'Index rebuild was cancelled; the previous index stays in use.',
  'host.indexRebuildFailed': 'Index rebuild failed: {detail}',
  'host.indexMaintenanceBusy': 'An index maintenance operation is already running. Please try again later.',
  'host.indexCleanupDone': 'Index cache cleaned; {count} obsolete generation(s) removed.',
  'host.indexCleanupFailed': 'Cache cleanup failed: {detail}',
  // ---- #199 rename/move reference auto-update (host notices; batch merged) ----
  'host.renameRefsUpdated': 'Renamed "{file}" and updated {count} reference(s) in {files} file(s).',
  'host.renameRefsPartiallyUpdated': 'Renamed "{file}" and updated {count} reference(s); {skipped} skipped (out of root or content changed) — not fully updated.',
  'host.renameRefsSkippedAll': 'Renamed "{file}"; references were NOT updated: {skipped} skipped (out of root or content changed).',
  'host.renameRefsIndexNotReady': 'Renamed "{file}", but the reference index is not ready yet, so references were left unchanged (rebuild the index later from the settings page if needed).',
  // ---- #200 batch/folder moves: skipped-item detail line and reasons ----
  'host.renameRefsSkippedDetail': 'Not updated: {items}',
  'host.renameRefsSkipItem': '{file} ({reason})',
  'host.renameRefsSkipMore': ' … {count}',
  'host.renameRefsSkipCrossRoot': 'outside its root',
  'host.renameRefsSkipEdgeStale': 'content changed',
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
  /** #208 toolbar refresh button (drop embedded-resource caches and re-render) */
  'toolbar.refresh': 'Refresh embedded resources',
  'sidebar.resize': 'Drag to resize sidebar',

  /** 查找控件 */
  'find.placeholder': 'Find',
  'find.label': 'Find in document',
  'find.toggleReplace': 'Toggle replace bar',
  'find.replaceLabel': 'Replace with',
  'find.replaceNext': 'Replace',
  'find.replaceAll': 'Replace All',
  'find.invalid': 'Invalid regular expression',
  'find.matchCase': 'Match Case',
  'find.wholeWord': 'Match Whole Word',
  'find.regexp': 'Use Regular Expression',
  'find.prev': 'Previous match',
  'find.next': 'Next match',
  'find.close': 'Close find',
  'find.inSelection': 'Find in selection',
  /** Count form (VSCode-style): {n} current index, {total} match total */
  'find.count': '{n} of {total}',
  'find.noResults': 'No results',
  'find.sourceHit': 'Source match',
  'find.sourceReadonly': 'Read-only',
  'find.sourceLocation': 'Line {line}, column {column}',
  /** #238 查找选项条（Ctrl+D 会话期间的迷你三按钮）容器可访问名称 */
  'find.optionsBar': 'Find options',

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

  /** Hover document preview (#218: in-popup state line; error states never
   *  surface host notifications. Since #219 wikilinks and Markdown links share
   *  the states — the raw target is no longer wrapped in wikilink brackets;
   *  anchor-missing covers missing heading/block anchors without falling back
   *  to the full document) */
  'hover.loading': 'Loading preview…',
  'hover.errorUnsupported': 'Unsupported link form: no preview target to show (web pages are out of scope)',
  'hover.errorNoWorkspace': 'The current document is not in any workspace folder: link targets cannot be resolved for preview',
  'hover.errorEscape': 'The link target escapes the owning workspace root and cannot be previewed',
  'hover.errorNotFound': 'Target not found: {target} (resolved relative to the current document; files are never created automatically)',
  'hover.errorNonMarkdown': '{target} is not a Markdown note: preview supports Markdown documents only in this phase',
  'hover.errorReadFailed': 'Failed to read the target document',
  'hover.errorAnchorMissing': 'Anchor not found in the target note: {target}#{anchor} (the full document is not shown instead)',
  'hover.errorWatchCapacity': 'Too many referenced notes are open. Close another preview or card, then reopen this one.',
  'hover.errorSourceExpired': 'The source note changed or closed. Reopen this reference to refresh it.',
  'hover.errorCycle': 'This note is already in the current reference path.',
  'hover.errorDepth': 'The reference depth limit has been reached.',
  'hover.errorBudget': 'The reference tree has reached its resource limit.',
  /** #220 referenced Reading content: accessibility labels of the expand/
   *  collapse button of the note-properties section inside the hover popup
   *  (aria-label and title share the word; the button is the only operable
   *  entry, hovering the header row only reveals it) */
  'hover.content.fmExpand': 'Expand note properties',
  'hover.content.fmCollapse': 'Collapse note properties',
  /** #222 Reading embed cards: loading line and the open-target entry in the
   *  card header (aria-label and title share the word; opening reuses the
   *  existing Vsidian open behavior, never edits the embed source) */
  'embed.loading': 'Loading embedded note…',
  'embed.openTarget': 'Open target note',

  /** 反链面板（#197：四态与条目；形态改版批次：工具栏/排序/搜索/页头） */
  'backlinks.label': 'Backlinks',
  'backlinks.panelTitle': 'Links to this file',
  'backlinks.toolbarLabel': 'Backlinks toolbar',
  'backlinks.sortBy': 'Sort',
  'backlinks.sortNameAsc': 'File name (A-Z)',
  'backlinks.sortNameDesc': 'File name (Z-A)',
  'backlinks.sortMtimeDesc': 'Modified (new to old)',
  'backlinks.sortMtimeAsc': 'Modified (old to new)',
  'backlinks.sortBirthDesc': 'Created (new to old)',
  'backlinks.sortBirthAsc': 'Created (old to new)',
  'backlinks.search': 'Search',
  'backlinks.searchPlaceholder': 'Search backlinks…',
  'backlinks.searchNoMatch': 'No matches',
  'backlinks.collapseAll': 'Collapse all',
  'backlinks.expandAll': 'Expand all',
  'backlinks.moreContext': 'More context',
  'backlinks.countLabel': '{n} backlinks',
  'backlinks.groupCount': '{n} links',
  'backlinks.empty': 'No backlinks',
  'backlinks.loading': 'Loading backlinks…',
  'backlinks.updating': 'Index updating…',
  'backlinks.error': 'Backlinks unavailable',
  'backlinks.errorNoWorkspace': 'Open a workspace to see backlinks',
  'backlinks.jumpTo': 'Jump to reference in {file} (line {n})',

  /** 出链面板（出链面板批次：四态与条目） */
  'outlinks.label': 'Outgoing links',
  'outlinks.panelTitle': 'Links in current note',
  'outlinks.countLabel': '{n} links',
  'outlinks.empty': 'No links',
  'outlinks.loading': 'Loading links…',
  'outlinks.updating': 'Index updating…',
  'outlinks.error': 'Outgoing links unavailable',
  'outlinks.errorNoWorkspace': 'Open a workspace to see outgoing links',
  'outlinks.jumpTo': 'Open {target}',

  /** 索引维护设置分页（#198：排除模式与维护操作） */
  'indexMaintenance.title': 'Index maintenance',
  'indexMaintenance.description': 'Control what the workspace reference index scans, and rebuild or clean the index cache. Maintenance runs in the background; scheduling values are engineering defaults, not time-limit guarantees.',
  'indexMaintenance.patternsLabel': 'Exclude patterns',
  'indexMaintenance.patternsDescription': 'Glob patterns matched against paths relative to each workspace root (**, * and ?; a plain folder name excludes its whole subtree). Defaults to **/.git/** and **/node_modules/**. VSCode search exclude rules and .gitignore are never inherited. Excluded files are not scanned, while targets inside them that an indexed note references explicitly stay registered.',
  'indexMaintenance.addPattern': 'Add pattern',
  'indexMaintenance.removePattern': 'Remove pattern',
  'indexMaintenance.patternPlaceholder': 'e.g. drafts/**',
  'indexMaintenance.patternsAriaLabel': 'Exclude pattern list',
  'indexMaintenance.savePatterns': 'Save patterns',
  'indexMaintenance.resetPatterns': 'Restore defaults',
  'indexMaintenance.rebuild': 'Full rebuild',
  'indexMaintenance.cleanup': 'Clean workspace cache',
  'indexMaintenance.cancel': 'Cancel',
  'indexMaintenance.rebuildProgress': 'Rebuilding: {done} / {total} notes',
  'indexMaintenance.rebuilding': 'Rebuilding index…',
  'indexMaintenance.unavailable': 'No workspace is open. Patterns are still saved and will take effect once a workspace is opened.',
  'indexMaintenance.noticePatternsSaved': 'Exclude patterns saved; coverage is being recalculated.',
  'indexMaintenance.noticePatternsInvalid': 'Some patterns were rejected ({detail}); the valid ones were saved.',
  'indexMaintenance.noticeRebuildDone': 'Index rebuilt from disk contents.',
  'indexMaintenance.noticeRebuildCancelled': 'Rebuild cancelled; the previous index stays in use.',
  'indexMaintenance.noticeRebuildFailed': 'Rebuild failed: {detail}',
  'indexMaintenance.noticeCleanupDone': 'Index cache cleaned; {count} obsolete generation(s) removed.',
  'indexMaintenance.noticeCleanupFailed': 'Cache cleanup failed: {detail}',

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
  'codeblock.wrapEnable': 'Enable word wrap',
  'codeblock.wrapDisable': 'Disable word wrap',

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
  'graphic.popupExportImage': 'Save a copy of the original image',
  'graphic.popupExportImageDisabled': 'Remote images cannot be exported; save a workspace copy first.',
  'graphic.imageExportFailed': 'Image export failed',

  /** 图片/公式/任务/Mermaid 装饰与错误占位 */
  'decor.taskCheck': 'Check task',
  'decor.taskUncheck': 'Uncheck task',
  'decor.emptyCell': 'Empty cell',
  'decor.mathError': 'Math failed to parse: source text is shown; move the cursor in to edit',
  'decor.imageError': 'Image failed to load ({reason}). Click to retry',
  'decor.imageNotFound': 'Image not found (file missing or deleted). Click to retry',
  'decor.imageInaccessible': 'Image inaccessible (remote connection or permission issue). Click to retry',
  'decor.unknownReason': 'unknown reason',
  'decor.mermaidUnavailable': 'Diagram renderer unavailable (mermaid.js failed to load)',
  'decor.mermaidError': 'Diagram failed to render: {message}',

  // ---- frontmatter.（#140 表格卡片：标题栏、修改按钮与 Popover 编辑）----
  /** 卡片标题栏文字（对齐 Obsidian Properties 面板） */
  'frontmatter.title': 'Properties',
  /** 标题栏右上角「修改」按钮（打开属性编辑 Popover） */
  'frontmatter.edit': 'Edit',
  /** 标题栏折叠 chevron：收起键值行区（与代码块折叠同交互） */
  'frontmatter.collapse': 'Collapse properties',
  'frontmatter.expand': 'Expand properties',
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
  // titleKey（快捷键页与命令面板同源，无第二套文案）；例外是三态切换
  // 三命令（#232）：manifest title 改归属句式，操作名拆到 operation.* 独立键。
  /** 扩展市场 displayName / description（含 customEditors displayName 同源） */
  'manifest.displayName': 'Vsidian',
  'manifest.description': 'Obsidian-like Markdown editing: live preview + reading views',

  'command.toggleViewMode.title': 'Switch to the next view mode',
  /** #232 归属句式：editor/title 三态切换命令的 manifest title（genNls 生成源），
   *  与快捷键注册表的无前缀操作名键（operation.*）拆键分持 */
  'command.mode.toReading.title': 'Switch Vsidian to reading view',
  'command.mode.toSource.title': 'Switch Vsidian to the source editor',
  'command.mode.toLive.title': 'Switch Vsidian to live preview',
  /** #232 拆键：三态切换的无前缀操作名（keybindings 注册表 titleKey，
   *  快捷键页显示不带品牌名；值即拆键前原文案） */
  'operation.toReading': 'Switch to reading view',
  'operation.toSource': 'Switch to the source editor',
  'operation.toLive': 'Switch to live preview',
  /** #141 dual-state toggle (live↔reading; shared by toolbar button and Ctrl+Q) */
  'command.mode.toggleDualView.title': 'Toggle reading/live preview',
  'command.find.title': 'Find (in the editor)',
  'command.find.next.title': 'Next match',
  'command.find.previous.title': 'Previous match',
  'command.find.replace.title': 'Replace (in the editor)',
  'command.find.replaceNext.title': 'Replace next match',
  'command.find.replaceAll.title': 'Replace all matches',
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
  /** #198 索引维护命令（设置页按钮与命令面板共用入口；默认未绑定，
   *  评估记录见 docs/specs/keybindings.md） */
  'command.index.rebuild.title': 'Index: full rebuild',
  'command.index.cleanup.title': 'Index: clean workspace cache',
  'command.ui.sidebarToggle.title': 'Expand or collapse the sidebar',
  'command.ui.outlineToggle.title': 'Show or hide the outline',
  'command.ui.outlineSearch.title': 'Search headings',
  'command.ui.outlineJumpBottom.title': 'Jump to end of note',
  'command.ui.outlineReset.title': 'Reset outline',
  'command.ui.outlineCollapseAll.title': 'Collapse all outline headings',
  'command.ui.outlineExpandAll.title': 'Expand all outline headings',
  /** #197 反链面板：双模式 UI 操作，默认未绑定（评估记录见 keybindings.md） */
  'command.ui.backlinksToggle.title': 'Show or hide the backlinks panel',
  /** 出链面板：双模式 UI 操作，默认未绑定（评估记录见 keybindings.md） */
  'command.ui.outlinksToggle.title': 'Show or hide the outgoing links panel',
  /** #208 refresh embedded resources command (toolbar button and keybinding/command palette share it) */
  'command.editor.refresh.title': 'Refresh embedded resources',
  /** #237 multi-cursor: add a cursor on the line above/below (live preview only; Alt+click adds at the pointer) */
  'command.editor.addCursorAbove.title': 'Add cursor above',
  'command.editor.addCursorBelow.title': 'Add cursor below',
  /** #221 preview the link at the cursor/focus (manual hover-popup open; keyboard enters the popup and Esc returns) */
  'command.ui.hoverPreviewLink.title': 'Preview the current link',

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

  // ---- #183 统一右键菜单（Live 正文全域接管；块链接两项自 #162 迁入）----
  /** 右键菜单：标题行命中的额外项（拼 [[笔记名#标题]]，标题取行面文本） */
  'contextMenu.copyHeadingLink': 'Copy heading link',
  /** 右键菜单/快捷键共用项（拼 [[笔记名#^块id]]，无 id 时先自动补写） */
  'contextMenu.copyBlockLink': 'Copy block link',
  /** 簇 2 父项：行内文本格式子菜单 */
  'contextMenu.textFormat': 'Text format',
  /** 簇 2 父项：段落结构子菜单（列表/标题/引用） */
  'contextMenu.paragraphStyle': 'Paragraph style',
  /** 簇 2 父项：插入子菜单（表格/分隔线/代码块/数学块） */
  'contextMenu.insert': 'Insert',
  /** 剪贴板四项（键位沿用 CM6 默认，提示列固定显示） */
  'contextMenu.cut': 'Cut',
  'contextMenu.copy': 'Copy',
  'contextMenu.paste': 'Paste',
  'contextMenu.selectAll': 'Select all',
  /** 命令面板/快捷键页操作名（keybindings 注册表 titleKey） */
  'command.block.copyLink.title': 'Copy link to current block',

  // ---- #239 中文分词词级移动（操作注册表 + 设置页分页 + 宿主通知）----
  /** 词级移动四操作（默认 ctrl+方向 / alt+方向（mac 词移动惯例）；
   *  Shift 变体单列操作——扩选注册） */
  'command.wordMotion.cursorLeft.title': 'Move left by one word (CJK-aware)',
  'command.wordMotion.cursorRight.title': 'Move right by one word (CJK-aware)',
  'command.wordMotion.selectLeft.title': 'Select left by one word (CJK-aware)',
  'command.wordMotion.selectRight.title': 'Select right by one word (CJK-aware)',
  // ---- #238 select-next-occurrence family（操作注册表 titleKey） ----
  'command.find.selectNext.title': 'Select Next Occurrence',
  'command.find.selectPrevious.title': 'Select Previous Occurrence',
  'command.find.skipCurrent.title': 'Skip and Select Next Occurrence',
  'command.find.allOccurrences.title': 'Select All Occurrences',
  /** 设置项：分词引擎（呈现归「中文分词」附加分页） */
  'setting.wordSegmentEngine.title': 'Word segmentation engine',
  'setting.wordSegmentEngine.description': 'Engine used to split continuous CJK text for word-wise Ctrl+Left/Right motion. Latin and digit runs always keep the built-in group semantics.',
  'setting.wordSegmentEngineBuiltin': 'Built-in (Intl.Segmenter)',
  'setting.wordSegmentEngineJieba': 'jieba-wasm (dictionary segmentation)',
  /** 设置项：jieba 下载源 */
  'setting.wordSegmentSource.title': 'jieba download source',
  'setting.wordSegmentSource.description': 'Where the jieba-wasm resources are downloaded from. Resources are stored in the extension storage after a locked-version sha256 check; the download runs on the extension host (on the remote machine for Remote SSH).',
  'setting.wordSegmentSourceJsdelivr': 'jsDelivr CDN (default)',
  'setting.wordSegmentSourceNpmmirror': 'npmmirror (China mirror)',
  'setting.wordSegmentSourceCustom': 'Custom URL',
  /** 设置项：自定义下载源基址 */
  'setting.wordSegmentCustomUrl.title': 'Custom source base URL',
  'setting.wordSegmentCustomUrl.description': 'HTTPS directory URL used in the custom mode — the two locked files are fetched as baseURL/jieba_rs_wasm.js and baseURL/jieba_rs_wasm_bg.wasm. Plain HTTP is rejected.',
  /** 设置页「中文分词」分页框架与资源管理 */
  'wordSegment.title': 'Word Segmentation',
  'wordSegment.engineLabel': 'Segmentation engine',
  'wordSegment.engineDescription': 'Controls how continuous Chinese text is split when moving by words. Switching takes effect immediately.',
  'wordSegment.engineBuiltinHint': 'Browser built-in ICU segmentation; no download, always available.',
  'wordSegment.engineJiebaHint': 'Better dictionary quality; requires a one-time resource download, falls back to the built-in engine when unavailable.',
  'wordSegment.sourceLabel': 'Download source',
  'wordSegment.sourceDescription': 'Applies only when the jieba engine is selected.',
  'wordSegment.customUrlPlaceholder': 'https://example.com/jieba/',
  'wordSegment.resourceLabel': 'jieba resources',
  'wordSegment.resourceDescription': 'Downloaded on demand into the extension storage (about 4 MB); never bundled with the extension. Deleting falls back to the built-in engine.',
  'wordSegment.installed': 'jieba-wasm {version} installed and verified.',
  'wordSegment.notInstalled': 'Not installed. The built-in engine is active.',
  'wordSegment.downloading': 'Downloading and verifying…',
  'wordSegment.download': 'Download',
  'wordSegment.deleteResource': 'Delete resources',
  'wordSegment.noticeDownloaded': 'Downloaded and verified.',
  'wordSegment.noticeDownloadFailed': 'Download failed: {detail}',
  'wordSegment.noticeDeleted': 'Resources deleted; the built-in engine is active.',
  'wordSegment.noticeDeleteFailed': 'Delete failed: {detail}',
  'wordSegment.noticeLoadFailed': 'Failed to load the downloaded resources in the editor; the built-in engine is active. {detail}',
  /** 宿主通知（下载/删除结果） */
  'host.jiebaDownloaded': 'jieba-wasm {version} downloaded and verified. Word motion now uses jieba.',
  'host.jiebaDownloadFailed': 'Failed to download jieba resources: {detail}. Word motion keeps using the built-in engine.',
  'host.jiebaDeleted': 'jieba resources deleted. Word motion falls back to the built-in engine.',
  'host.jiebaDeleteFailed': 'Failed to delete jieba resources: {detail}.',
  'host.jiebaLoadFailed': 'Failed to load jieba in the editor: {detail}. The built-in engine stays active.',
} as const satisfies Record<string, string>

/** 字典键：点分扁平键，以本包为类型基准（编译期检查 t() 取词键） */
export type MessageKey = keyof typeof en
