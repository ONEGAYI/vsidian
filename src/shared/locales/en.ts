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
  'setting.pastePreserveFormatting.title': 'Preserve formatting when pasting',
  'setting.pastePreserveFormatting.description': 'Convert supported rich text formatting to Markdown during ordinary paste.',
  'setting.pasteAskBefore.title': 'Ask before pasting',
  'setting.pasteSplitUndo.title': 'Undo rich text paste in steps',
  'setting.pasteSplitUndo.description': 'Undo pasted formatting first, then the text. When disabled, undo the entire paste at once.',
  'setting.pasteAskBefore.description': 'Ask whether to keep convertible formatting. Enable again to restore the prompt.',
  'paste.dialog.question': 'Keep the formatting in the pasted content?',
  'paste.dialog.keep': 'Keep formatting',
  'paste.dialog.plain': 'Paste text only',
  'paste.dialog.cancel': 'Cancel',
  'paste.dialog.remember': 'Do not show this message again',
  'toast.pasteFormattingKept': 'Formatting in the pasted content has been preserved.',
  'toast.pasteFormattingUndone': 'Pasted formatting has been undone. Undo again to remove the pasted text.',
  'toast.pasteFormattingFailed': 'Formatting could not be preserved. Pasted as plain text.',
  'toast.pasteNoText': 'Cannot paste: no usable text could be extracted.',
  'toast.pastePreferencesFailed': 'Paste preferences could not be saved. The choice applies only to this paste.',
  'command.clipboard.paste.title': 'Paste',
  'command.clipboard.pastePlain.title': 'Paste as plain text',
  'contextMenu.pastePlain': 'Paste as plain text',
  'toast.pasteImageOnly': 'An image cannot be pasted as plain text. Use {paste} to paste the image.',
  'toast.pasteTextOnly': 'Text pasted without the image. Use {paste} to paste the image.',
  'styleRef.category.toast': 'Light notifications',
  'styleRef.category.wikilinkSuggest': 'Wikilink suggestions',
  // ---- wikilinkSuggest.（双链文件联想候选，#376 T01；#378 T03 占位）----
  'wikilinkSuggest.list.ariaLabel': 'Wikilink suggestions',
  'wikilinkSuggest.status.loading': 'Searching files…',
  'wikilinkSuggest.status.empty': 'No matching files',
  'wikilinkSuggest.status.noWorkspace': 'No folder open — type the link manually',
  'wikilinkSuggest.status.notReady': 'Index is being prepared — type the link manually',
  'wikilinkSuggest.status.updating': 'Index still updating — results are partial',
  'wikilinkSuggest.status.more': '{count} more — press ↓ to load more',
  // #378 T03：标题/块占位提示（占位只作提示，不可确认、不写正文）
  'wikilinkSuggest.placeholder.heading': 'Type a heading…',
  'wikilinkSuggest.placeholder.block': 'Type a block ID…',
  // 验收反馈（2026-10-06）：浮层底部键提示条——按阶段裁剪显示当前可用进阶键
  'wikilinkSuggest.hint.heading': 'Type # to link to a heading',
  'wikilinkSuggest.hint.block': 'Type ^ to link a text block',
  'wikilinkSuggest.hint.alias': 'Type | to set display text',
  // #379 T04：标题阶段状态与候选（明确 Markdown 目标的真实候选；
  // 失败分真实状态，不伪装空结果）
  'wikilinkSuggest.status.headingLoading': 'Loading headings…',
  'wikilinkSuggest.status.headingEmpty': 'No matching headings',
  'wikilinkSuggest.status.headingNotFound': 'Target document not found — type the anchor manually',
  'wikilinkSuggest.status.headingNotMd': 'Target is not a Markdown file — no heading candidates',
  'wikilinkSuggest.status.headingReadError': 'Failed to read target document — type the anchor manually',
  'wikilinkSuggest.heading.meta': 'H{level} · line {line}',
  'wikilinkSuggest.toast.duplicateHeading': 'Duplicate headings exist; navigation goes to the first match',
  // #380 T05: block-stage states and candidates (blocks without an ID listed
  // as usual; accepting goes through host-side ^id insertion)
  'wikilinkSuggest.status.blockLoading': 'Loading blocks…',
  'wikilinkSuggest.status.blockEmpty': 'No matching blocks',
  'wikilinkSuggest.status.blockNotFound': 'Target document not found — type the block reference manually',
  'wikilinkSuggest.status.blockNotMd': 'Target is not a Markdown file — no block candidates',
  'wikilinkSuggest.status.blockReadError': 'Failed to read target document — type the block reference manually',
  'wikilinkSuggest.status.blockAccepting': 'Inserting block ID…',
  'wikilinkSuggest.block.meta': 'line {line} · {count} lines',
  'wikilinkSuggest.toast.blockAcceptFailed': 'Failed to insert the block ID — input kept',
  // #380 T05: host-side withdraw coordination notices (best-effort removal of
  // the auto-added marker when the origin link is undone)
  'host.wikilinkBlockIdKept': 'Auto-added block marker ^{id} was kept: {reason}',
  'host.wikilinkBlockIdKeptReason.versionChanged': 'target document changed',
  'host.wikilinkBlockIdKeptReason.markerChanged': 'block marker changed',
  'host.wikilinkBlockIdKeptReason.newUse': 'other references exist',
  'host.wikilinkBlockIdKeptReason.applyFailed': 'write failed',
  'host.wikilinkBlockIdKeptReason.notFound': 'target unreadable',
  'host.wikilinkBlockIdRebuildFailed': 'Failed to rebuild block marker ^{id} — the link may be broken',
  'styleRef.category.richPaste': 'Paste prompt',
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
  /** Files-and-links page section (moved from editor page in #332): image.* paste settings */
  'settings.groupImage': 'Images',
  /** Files-and-links page section (#298 created, moved with the page in #332):
   *  hover.* preview family and embed.* family */
  'settings.groupRefview': 'Reference views',
  /** Settings "Files and links" section page (#332: renamed from "Index
   *  maintenance" to host the Images / Reference views / Index maintenance
   *  groups, mirroring Obsidian's Files & links page) */
  'settings.filesLinksSection': 'Files and links',
  /** Settings "Files and links" page subtitle */
  'settings.filesLinksSectionDescription':
    'Image paste storage, reference view hover and embed presentation, and workspace reference index maintenance (exclusions, rebuild, cleanup). Changes save automatically.',
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
  /** #296 tables inside block containers: editable grid rendering for tables
   *  nested in blockquotes/lists and other containers (live preview only) */
  'setting.experimentalTableRender.title': 'Render tables inside containers',
  'setting.experimentalTableRender.description':
    'Render tables inside blockquotes, lists and other containers as an editable grid in the live preview; turn off to show their raw source text instead. The reading view always renders tables and is not affected by this setting.',
  'setting.readableLineWidth.title': 'Readable line width',
  'setting.readableLineWidth.description': 'Maximum width of the content column in the live preview and reading view: 0 fills the available width; a specific value caps the column, which then centers in the editor area and yields to the outline sidebar when space is tight.',
  'setting.readableLineWidthFill': 'Fill',
  /** #318 search reveal open hint (editor.searchRevealHint) */
  'setting.searchRevealHint.title': 'Search reveal open hint',
  'setting.searchRevealHint.description': 'When a note opened from workspace search results becomes active, show a hint notification with a "Locate" button that jumps to the selected match. The hint itself changes nothing — locating only runs after you click. One hint per note per session; command and keybinding entries stay available regardless.',
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
  /** #342 (P3-10) external link preview settings (hover.externalEnabled / hover.externalShape) */
  'setting.hoverExternalEnabled.title': 'Preview external link cards on hover',
  'setting.hoverExternalEnabled.description': 'When enabled, hovering an HTTP(S) web link shows a card with its title, summary, and domain: the extension host performs a restricted fetch (HTML metadata only, with timeout, size limits, and private-network rejection) and never sends note content, paths, or credentials. Off by default — no network requests are made while disabled. Under Remote SSH the fetch happens on the remote machine.',
  'setting.hoverExternalShape.title': 'External link preview shape',
  'setting.hoverExternalShape.description': 'Choose how hovered external links are presented. "Card" shows the title, summary, and domain; "Live page" renders the page itself inside the popup — the page loads locally in the editor and connects to the target site and its third-party services (an independent network path from the host-side metadata-only restricted fetch), and your everyday browser login is not carried over; sites that refuse embedding or cannot be shown safely fall back to the card with the reason, and a fallback never rewrites this choice. Fetch caches are tracked per link address and shape.',
  'setting.hoverExternalShapeCard': 'Card (title, summary, domain)',
  'setting.hoverExternalShapePage': 'Live page (rendered in the popup)',
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
  /** P2-12 (#289) title of the native diff editor opened by "Compare and
   *  Resolve" (left: temporary copy of the uncommitted input; right: the real
   *  target document) */
  'host.conflictDiffTitle': 'Write conflict: {name} (Left: copy of current input / Right: current target version)',
  'host.panelClosedWithInput': 'The editor for "{name}" was closed (or the connection dropped) with unsaved unconfirmed input: {text}',
  /** P2-13 (#290) notice for input from a reference edit port (virtual panel)
   *  that was never written to the target after its parent tab closed (three
   *  immediate choices: compare and resolve / discard current version / cancel) */
  'host.refClosedWithInput': 'The parent document closed with input from the "{name}" reference edit that was not written to the target: {text}',
  'host.conflictCompareLabel': 'Compare and resolve',
  'host.conflictDiscardLabel': 'Discard current version',
  'host.conflictCancelLabel': 'Cancel',
  'host.handoffFailed': 'Failed to open an editor tab for "{name}"; its unsaved changes are still kept by the host and can be retried.',
  'host.handoffRetry': 'Retry opening',
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
  /** #318: failure feedback for the search reveal command (success is shown via the flash highlight) */
  'host.searchRevealNotFound': 'Could not match a selected search result to the current Vsidian panel (select a match in the search view first).',
  'host.searchRevealNoPanel': 'No active Vsidian panel — open the note in Vsidian (or switch to its tab) before revealing a search result.',
  /** #318 open hint (host notification with a locate button; showing it is side-effect free) */
  'host.searchRevealHint': 'Opened from search results? Jump to the selected match here.',
  'host.searchRevealHintLocate': 'Locate',
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
  /** #342 (P3-10) external card failure states: real network causes, never masked as missing files */
  'hover.errorWebDisabled': 'External link preview is not enabled (turn it on in the Vsidian settings page).',
  'hover.errorWebInvalidAddress': 'The target address was rejected by the safety policy (private network, loopback, credentials, or malformed URL).',
  'hover.errorWebTimeout': 'The target page timed out.',
  'hover.errorWebTooLarge': 'The target page exceeds the response size limit.',
  'hover.errorWebNotHtml': 'The target is not a parsable web page (non-HTML content).',
  'hover.errorWebRedirects': 'The target page redirected too many times.',
  'hover.errorWebUnreachable': 'The target page could not be reached (network error or error status).',
  /** #343 (P3-11) live page shape: fallback reasons (real known causes) and the honest note */
  'hover.webFrameDenied': 'Fell back to the card: this site restricts embedding (X-Frame-Options / CSP frame-ancestors); you can open it in the browser.',
  'hover.webFrameHttp': 'Fell back to the card: an HTTP page cannot be embedded in a secure context; you can open it in the browser.',
  'hover.webPageNote': 'The page loads inside this popup and connects to the target site and its third-party services; your everyday browser login is not carried over. Cross-origin content cannot be observed, so there is no way to confirm it renders fully — if it looks wrong, fall back to the card or open it in the browser.',
  'hover.webFallbackToCard': 'Back to card',
  'hover.loading': 'Loading preview…',
  'hover.errorUnsupported': 'Unsupported link form: no preview target to show (web pages are out of scope)',
  'hover.errorNoWorkspace': 'The current document is not in any workspace folder: link targets cannot be resolved for preview',
  'hover.errorEscape': 'The link target escapes the owning workspace root and cannot be previewed',
  'hover.errorNotFound': 'Target not found: {target} (resolved relative to the current document; files are never created automatically)',
  'hover.errorNonMarkdown': '{target} is not a Markdown note: preview supports Markdown documents only in this phase',
  'hover.errorReadFailed': 'Failed to read the target document',
  'hover.errorAnchorMissing': 'Anchor not found in the target note: {target}#{anchor} (the full document is not shown instead)',
  /** #337 PDF hover preview: invalid anchor syntax (page=0 / non-numeric /
   *  unknown key / duplicate key - never silently falls back to page 1; fix
   *  the link and retry) */
  'hover.errorAnchorInvalid': 'Invalid anchor syntax: {target}#{anchor} (the page number must be a positive integer such as #page=3; page 1 is not silently used)',
  'hover.errorWatchCapacity': 'Too many referenced notes are open. Close another preview or card, then reopen this one.',
  'hover.errorSourceExpired': 'The source note changed or closed. Reopen this reference to refresh it.',
  'hover.errorCycle': 'This note is already in the current reference path.',
  'hover.errorDepth': 'The reference depth limit has been reached.',
  'hover.errorBudget': 'The reference tree has reached its resource limit.',
  /** #340 (P3-08) readable-text admission and anchor error states: reported
   *  in place, never silently falling back to the top or truncating; {maxMb}
   *  is the per-file admission cap in MB; every failure can continue in the
   *  native editor via the popup header open action */
  'hover.errorTextBinary': '{target} is a binary file and cannot be previewed as text. Use the open button in the top-right corner to open it in the native editor.',
  'hover.errorTextEncoding': '{target} is not valid UTF-8 text and cannot be previewed reliably. Use the open button in the top-right corner, then "Reopen with Encoding" to pick the right encoding.',
  'hover.errorTextTooLarge': '{target} exceeds the per-file preview cap ({maxMb} MB); the full content is not read. Use the open button in the top-right corner to open it in the native editor.',
  'hover.errorTextLongLine': '{target} contains extremely long lines; loading stopped to keep the preview responsive (no truncated display). Use the open button in the top-right corner to open it in the native editor.',
  'hover.errorTextAnchorFormat': 'Invalid anchor syntax: #{anchor} (text anchors support #line=N and #range=B-E, combinable; line numbers are positive integers)',
  'hover.errorTextAnchorOrder': 'Invalid anchor window: #{anchor} (the range start line must not exceed the end line)',
  'hover.errorTextAnchorBounds': 'Anchor out of bounds: #{anchor} (line number exceeds the file total)',
  'hover.errorTextAnchorOutside': 'Anchor conflict: #{anchor} (line is outside the range window; no other position is silently used)',
  /** #220 referenced Reading content: accessibility labels of the expand/
   *  collapse button of the note-properties section inside the hover popup
   *  (aria-label and title share the word; the button is the only operable
   *  entry, hovering the header row only reveals it) */
  /** #337 PDF hover rendering: page info line and render failure states
   *  (shown in place, never as host notifications; encrypted files prompt to
   *  open the original in a local reader - no password collection) */
  'hover.pdfPageInfo': 'Page {page} of {total}',
  /** #339 zoom feedback on the page-info line (achieved percent vs fit width) */
  'hover.pdfPageInfoZoom': 'Page {page} of {total} - {percent}%',
  /** #339 link-layer disabled tooltips (explicit security boundary) */
  'hover.pdfLinkExternalOnly': 'Only http(s) links can be opened in the browser from the preview',
  'hover.pdfLinkUnsupported': 'This link action is disabled in the preview (security restriction)',
  'hover.pdfLinkUnresolved': 'The link target could not be resolved',
  'hover.pdfErrorCorrupt': 'The PDF file is damaged or not a valid PDF; it cannot be previewed',
  'hover.pdfErrorEncrypted': 'This PDF is encrypted and cannot be opened in the preview yet. Open the original file in a local PDF reader.',
  'hover.pdfErrorPageRange': 'Page number out of range: page {page} was requested but the PDF has {total} pages (page 1 is not silently used)',
  'hover.pdfErrorResource': 'Failed to load or render the PDF resource; please retry',
  'hover.pdfErrorLoadFailed': 'The PDF renderer failed to load (the extension installation may be incomplete)',
  'hover.content.fmExpand': 'Expand note properties',
  'hover.content.fmCollapse': 'Collapse note properties',
  /** #222 Reading embed cards: loading line and the open-target entry in the
   *  card header (aria-label and title share the word; opening reuses the
   *  existing Vsidian open behavior, never edits the embed source) */
  'embed.loading': 'Loading embedded note…',
  'embed.openTarget': 'Open target note',
  /** P2-04 (#281) embed internal Live: mode toggle / save target / dirty dot
   *  and bind-failed / paused notes (tooltips share the same keys) */
  'embed.modeToLive': 'Edit inside reference (switch to Live)',
  'embed.modeToReading': 'Switch to Reading view',
  'embed.saveTarget': 'Save target note',
  'embed.dirtyDot': 'Target has unsaved changes',
  'embed.liveBindFailed': 'Cannot attach target editing (target unavailable or not Markdown).',
  'embed.livePaused': 'Editing paused: unsafe to write back, input retained.',
  /** P2-05 (#282) explicit close confirmation: close entry tooltip and the
   *  three-action dialog (cancel is the default focus; the file name and the
   *  document-level discard impact must be spelled out in the confirmation) */
  'embed.closeEditor': 'Close reference editing',
  'embed.closeDialogTitle': 'Close reference editing',
  'embed.closeDialogMessage': '{file} has unsaved changes.',
  'embed.closeDialogDiscardScope': 'Discarding restores the entire file to its saved content, including unsaved changes made in other views.',
  'embed.closeCancel': 'Cancel',
  'embed.closeSave': 'Save and close',
  'embed.closeDiscard': 'Discard changes and close',
  'embed.closeSaveFailed': 'Save failed (the file may be read-only); the current editing state is kept.',
  'embed.closeDiscardFailed': 'Discard failed; the current state is kept.',
  'embed.closeStale': 'The target changed while confirming; please confirm again.',

  /** P2-12 (#289) write-conflict three choices in the paused state row.
   *  The compare hover text is the user-specified wording, translated to
   *  match it word for word in meaning; discard only drops the input that
   *  failed to write (not a document-level rollback); cancel keeps the
   *  pause and the current input. */
  'embed.conflictCompareLabel': 'Compare and Resolve',
  'embed.conflictCompareHint': 'Resolve the conflict in a diff view between the temporary copy and the conflicting version',
  'embed.conflictDiscardLabel': 'Discard Current Version',
  'embed.conflictDiscardHint': 'Discard the input that failed to write, then resync to the current target content.',
  'embed.conflictCancelLabel': 'Cancel',
  'embed.conflictCancelHint': 'Keep the pause and the current input.',
  'embed.conflictReopenLabel': 'Choose Again',
  'embed.conflictReopenHint': 'Show the conflict resolution choices again.',
  'embed.conflictCompareFailed': 'Failed to open the diff view. The current input is kept; you can retry.',

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

  /** #332: "Index maintenance" group title inside the Files and links page
   *  (#198: exclude patterns and maintenance ops; the former page title key
   *  is reused for the in-page group, page-level title uses filesLinksSection) */
  'indexMaintenance.title': 'Index maintenance',
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
  /** #318: search reveal (unbound by default; see docs/specs/keybindings.md) */
  'command.searchReveal.locate.title': 'Reveal selected search result',
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
  'command.ui.hoverPdfPageNext.title': 'PDF preview: next page',
  'command.ui.hoverPdfPagePrev.title': 'PDF preview: previous page',
  /** #339 PDF zoom trio (read-only preview presentation; unbound by default) */
  'command.ui.hoverPdfZoomIn.title': 'PDF preview: zoom in',
  'command.ui.hoverPdfZoomOut.title': 'PDF preview: zoom out',
  'command.ui.hoverPdfZoomReset.title': 'PDF preview: fit width',
  'command.ui.embedToggleMode.title': 'Toggle reference internal view mode',
  /** P2-10 reference Live action entries (save target / explicit close / conflict trio; all unbound by default) */
  'command.embed.saveTarget.title': 'Save focused reference target',
  'command.embed.close.title': 'Close focused reference editing session',
  'command.conflict.compare.title': 'Compare and resolve',
  'command.conflict.discard.title': 'Discard current version',
  'command.conflict.cancel.title': 'Cancel conflict choice',

  // ---- #159 锚点跳转（块引用定位与本文件锚点）----
  /** 块 id 缺失提示（与标题缺失同款「打开后提示」行为） */
  'host.wikilinkBlockMissing': 'Opened {link} in the target document, but the block reference "^{blockId}" was not found (block ids are ` ^id` markers at the end of a block’s last line)',
  /** #340 (P3-08) invalid-anchor notice for text-target wikilink jumps (still opened natively at the top) */
  'host.wikilinkTextAnchorInvalid': 'Opened {link} in the editor, but the anchor "#{anchor}" is invalid (text anchors support #line=N and #range=B-E, combinable; line numbers are positive integers within the file)',

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
  /** #322 默认编辑器守护：设置项（呈现归 #323 常规页「默认编辑器」委托组） */
  'setting.defaultEditorGuard.title': 'Default editor guard',
  'setting.defaultEditorGuard.description': 'Show a notification when another extension takes over as the default editor for Markdown files, with a one-click way to restore Vsidian.',
  /** #322 默认编辑器守护：宿主通知（抢占提示 / 修复结果） */
  'host.defaultEditorTakenOver': 'The default editor for Markdown files is currently {name}. Restore Vsidian as the default?',
  'host.defaultEditorBuiltinName': 'the VSCode built-in text editor',
  'host.defaultEditorFixLabel': 'Use Vsidian',
  'host.defaultEditorDismissLabel': 'Dismiss',
  'host.defaultEditorFixed': 'Vsidian is again the default editor for Markdown files.',
  'host.defaultEditorFixFailed': 'Could not restore the default editor automatically (a workspace setting may override it). Opening the editor associations setting for manual review.',
  /** #323 设置页常规页「默认编辑器」委托组：组标题、状态行四形态与手动按钮 */
  'defaultEditor.title': 'Default Editor',
  'defaultEditor.statusLabel': 'Current default editor',
  'defaultEditor.statusDescription': 'Which editor opens Markdown files by default. When another extension takes over, restore Vsidian with one click.',
  'defaultEditor.statusPending': 'Reading current associations…',
  'defaultEditor.statusVsidian': 'Vsidian',
  'defaultEditor.statusBuiltin': 'VSCode built-in text editor',
  'defaultEditor.statusOther': 'Another extension: {name}',
  'defaultEditor.statusNone': 'No association recorded — VSCode picks the editor when a Markdown file opens',
  'defaultEditor.fixButton': 'Set as Default',
  /** #350 T01 附加组件：设置页「附加组件」分页（状态列表与 VSCode 管理入口） */
  'settings.addonsSection': 'Add-ons',
  'settings.addonsSectionDescription': 'Vsidian add-ons are separate VSCode extensions. Install, uninstall and disable them in VSCode; their capabilities register through the add-on API. The add-on API is still a draft.',
  'addons.groupOfficial': 'Core add-ons',
  'addons.groupThirdParty': 'Third-party add-ons',
  'addons.empty': 'No Vsidian add-ons are visible in the current extension host.',
  'addons.statusRegistered': 'Registered',
  'addons.statusActivating': 'Activating…',
  'addons.statusAwaitingRegistration': 'Activated — waiting for the add-on to register',
  'addons.statusIncompatible': 'Incompatible: declared API {range}, host API {version}',
  'addons.statusActivationFailed': 'Activation failed: {detail}',
  'addons.statusHostUnavailable': 'Not visible in the current extension host — check its installation or running location via VSCode extension management',
  'addons.statusInvalidDeclaration': 'Invalid identity declaration: {detail}',
  'addons.apiVersionLabel': 'Add-on API version {version} (draft — not a published stable API)',
  'addons.searchMarketplace': 'Search Marketplace for add-ons',
  'addons.openExtensionsView': 'Manage extensions in VSCode',
  'addons.openDetail': 'Extension details',
  'addons.officialBadge': 'Official',
  // #360 T11: add-on UI contribution mount points (platform chrome text; the
  // add-on's own button labels and panel titles are free text from the add-on)
  'addonUi.toolbarSlotLabel': 'Add-on buttons',
  'addonUi.panelDockLabel': 'Add-on panels',
  'addonUi.panelClose': 'Close panel',
  // #351 T02：运行生命周期（功能开关 / 组件设置页 / 故障暂停）
  'addons.enable': 'Enable',
  'addons.disable': 'Disable',
  'addons.openSettingsPage': 'Open add-on settings page',
  'addons.closeSettingsPage': 'Close add-on settings page',
  'addons.addonSettingsTitle': 'Add-on settings: {label}',
  'addons.statusEnabledRuntime': 'Enabled',
  'addons.statusDisabled': 'Disabled',
  'addons.statusFaulted': 'Faulted (suspended): {detail}',
  // ---- #353 T04 basic settings area (scope tabs / basic controls / save notice) ----
  'addons.openSettingsArea': 'Settings',
  'addons.settingsAreaTitle': 'Basic settings: {label}',
  'addons.closeSettingsArea': 'Close basic settings',
  'addons.scopeUserDefault': 'User default',
  'addons.scopeWorkspace': 'Current workspace',
  'addons.noWorkspaceHint': 'No workspace open — the workspace scope is unavailable',
  'addons.useUserDefault': 'Use user default',
  'addons.sourceDefault': 'Default',
  'addons.sourceUser': 'User default',
  'addons.sourceWorkspace': 'Workspace override',
  'addons.enableSwitchTitle': 'Enable toggle',
  'addons.enableSwitchDescription': "Controls this add-on's editing, rendering and UI features in Vsidian; settings stay available when off",
  'addons.arrayAddItem': 'Add item',
  'addons.arrayRemoveItem': 'Remove',
  'addons.saveChanges': 'Save',
  'addons.savedNotice': 'Saved ({scope})',
  'addons.saveFailedNotice': 'Save failed: {reason}',
  'addons.saveFailedInvalid': 'Invalid values: {keys}',
  'addons.saveFailedUnknownKey': 'Unknown settings: {keys}',
  'addons.saveFailedNoWorkspace': 'No workspace open',
  'addons.saveFailedStore': 'Storage write failed',
  'addons.saveFailedRejected': 'Add-on generation ended',
  'addons.openCustomPage': 'Open custom settings page',
  'addons.settingsEmpty': 'This add-on registered no setting definitions',
  'addons.faultedSettingsHint': 'Add-on faulted (suspended) — the custom settings page is withdrawn; adjust parameters with the basic controls, then retry from the add-on list',
  /** #354 T05 侧栏三组结构（选项/核心组件/第三方组件）与故障排障入口 */
  'settings.sidebarOptions': 'Options',
  'addons.sidebarCoreAddons': 'Core add-ons',
  'addons.sidebarThirdPartyAddons': 'Third-party add-ons',
  'addons.sidebarEnabledGroup': 'Enabled',
  'addons.sidebarDisabledGroup': 'Disabled',
  'addons.sidebarFaultBadge': 'Fault-paused',
  'addons.sidebarEmptyGroup': 'No add-ons yet',
  'addons.openLogs': 'View add-on logs',
  'addons.retryFaulted': 'Retry add-on',
  'addons.faultTroubleshootTitle': 'Add-on faulted',
  'addons.faultTroubleshootHint': 'Running contributions of this add-on are suspended and its custom settings page is withdrawn. Basic controls below remain usable when definitions exist; full diagnostics arrive with later versions.',
  // T08（#357）行为冲突管理：注册行为的调序与逐项开关
  'addons.behaviorsGroupTitle': 'Behavior conflicts',
  'addons.behaviorsGroupHint': 'Manage input behaviors registered by add-ons: applicable behaviors trigger in order by default; reorder them or turn off individual ones. Turning off one behavior keeps the rest of the add-on running.',
  'addons.behaviorsLoading': 'Loading registered behaviors…',
  'addons.behaviorsEmpty': 'No registered input behaviors yet. Behaviors registered by add-ons appear here once a document is open.',
  'addons.behaviorsOwnerLabel': 'Add-on: {label}',
  'addons.behaviorsItemDisabledBadge': 'Off',
  'addons.behaviorsAddonDisabledBadge': 'Add-on disabled',
  'addons.behaviorsFaultedBadge': 'Fault-paused',
  'addons.behaviorsMoveUpText': 'Up',
  'addons.behaviorsMoveDownText': 'Down',
  'addons.behaviorsMoveUpAria': 'Move "{name}" up',
  'addons.behaviorsMoveDownAria': 'Move "{name}" down',
  'addons.behaviorsToggleAria': 'Enable "{name}"',
  'addons.behaviorsDetailsSummary': 'Description and examples',
  'addons.behaviorsExamplesLabel': 'Examples: {examples}',
  'addons.behaviorsSavedNotice': 'Behavior settings saved',
  'addons.behaviorsSaveFailedNotice': 'Failed to save behavior settings',
  /** #350 T01 附加组件：宿主输出通道名（安装态日志，标明组件 ID 与原因） */
  'host.addonsChannelName': 'Vsidian Add-ons',
} as const satisfies Record<string, string>

/** 字典键：点分扁平键，以本包为类型基准（编译期检查 t() 取词键） */
export type MessageKey = keyof typeof en
