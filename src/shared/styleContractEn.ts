// 样式参考条目英文平行覆盖（#178 机制 + #179 content 域全量）：设置页
// 「样式参考」条目文档字段的英文版单一事实源——中文清单（./styleContract）
// 保持权威基准不动，本模块按条目 id 索引、字段级覆盖；取词规则为**英文优先、
// 条目或字段缺失回退中文基准**（规格 docs/specs/style-reference-i18n.md）。
// content 域 75 条已全量覆盖（域级完整性由
// test/unit/styleContractEn.test.ts 钉住）；chrome 域随 #180 渐进合入。
//
// 字段分级（规格钉死）：
// - 双语（可覆盖）：purpose / states / dom / deprecated / removed /
//   obsidian.counterpart——设置页渲染的说明性文案（dom 当前仅离线 HTML
//   指南渲染，按同一分级提供覆盖）；
// - 不译（覆盖对象中不得出现）：target / example / aliasTargets /
//   introduced / verification / id / views——代码标识符、CSS 代码、工单号、
//   测试定位，语言无关或可检索性优先。
//
// 消费方与包体纪律：
// - `scripts/genStyleGuide.mjs` 加载 STYLE_CONTRACT_EN_OVERRIDES 内联进
//   设置页渲染数据 src/webview/styleGuideData.ts（一致性由
//   test/unit/styleContractEn.test.ts 钉住）；契约 JSON 与离线 HTML 固定
//   取中文，不消费本模块。
// - 设置页（styleReferenceSettings.ts）按 UI 语言调用参数化取词函数
//   applyStyleContractEntryOverride，覆盖表经生成物内联数据传入——本文件
//   的覆盖数据不进任何 bundle（webview 侧仅 type 依赖，编译后擦除）。
// - CJK 防回潮扫描：本文件为纯英文数据（注释不计字面量），不需豁免。
import type { StyleContractEntry } from './styleContract'

/** 条目英文覆盖形态（字段级）：仅双语字段可覆盖，键全部可选；obsidian
 *  覆盖形态固定为 { counterpart }（support 等级是枚举、语言无关） */
export interface StyleContractEntryOverride {
  purpose?: string
  states?: string
  dom?: string
  deprecated?: string
  removed?: string
  obsidian?: { counterpart: string }
}

/** 英文覆盖表：条目 id → 字段级覆盖（未覆盖条目/字段渲染时回退中文基准） */
export const STYLE_CONTRACT_EN_OVERRIDES: Readonly<Record<string, StyleContractEntryOverride>> = {
  // 试点：「容器与视图」类目 2 条（#178；术语对齐 locales/en.ts 与
  // README.en.md——live preview / reading view / mounted on demand）
  'container-live': {
    purpose: 'Live preview view container; holds the CodeMirror 6 editor.',
    dom: 'Direct child of #app; hidden with display:none in reading view but stays in the DOM, so styles still match (same probe convention as LineGutterProbe).',
    obsidian: {
      counterpart:
        '.markdown-source-view (editing-area container), .mod-cm6 (CM6 mode marker), .cm-s-obsidian (CM theme container)',
    },
  },
  'container-reading': {
    purpose: 'Reading view container; holds block-level structures that are mounted on demand.',
    dom: 'Direct child of #app; blocks are real semantic tags rendered by markdown-it, so tag selectors (p/h1/strong etc.) match naturally as descendants of the container.',
    obsidian: { counterpart: '.markdown-preview-view (reading view container)' },
  },

  // ---- 标题（heading，4 条）----
  'live-heading-line': {
    purpose:
      'Line container class for live headings (attached to the .cm-line line element); the whole-line styling entry point.',
    dom: 'A .cm-line line element inside the live container; the # heading markers are revealed when the cursor enters the heading line.',
    obsidian: { counterpart: '.HyperMD-header-{1..6} (the Obsidian live heading line container class)' },
  },
  'live-header-span': {
    purpose:
      'Content span class for live headings (a mark decoration wrapping only the heading text); the inline token-level entry point.',
    dom: 'A mark decoration span inside the heading line; Setext headings match as well.',
    obsidian: { counterpart: '.cm-header-{1..6} (the Obsidian live heading inline token class)' },
  },
  'live-heading-inview': {
    purpose:
      'Marks heading lines currently inside the viewport; since #55 it only scopes the active heading background and serves as an observation hook, drawing no styles of its own.',
    states: 'Added when a heading line enters the viewport; added and removed as scrolling proceeds.',
    dom: 'Same element as .vsidian-heading-line-{n} (a line-level modifier class).',
    obsidian: { counterpart: 'No direct counterpart (Obsidian has no in-viewport heading indicator class)' },
  },
  'live-heading-active': {
    purpose:
      'Line background accent for the heading line under the cursor; the # heading markers are revealed when the cursor enters the line.',
    states: 'Added while the cursor is inside the heading range; removed as soon as it leaves.',
    dom: 'Same element as .vsidian-heading-line-{n}; background drawing is scoped by the inview class.',
    obsidian: { counterpart: 'No direct counterpart (a vsidian-specific extension)' },
  },

  // ---- 行内格式（inline-format，7 条）----
  'inline-strong': {
    purpose:
      'Entry point for bold content: a mark decoration span in live view; a semantic strong tag rendered by markdown-it in reading view.',
    states:
      'In live view the ** markers are revealed when the cursor touches them and return to the formatted form when it leaves.',
    dom: 'Live: a mark span inside heading/body lines. Reading: a real <strong> element inside the block.',
    obsidian: { counterpart: '.cm-strong (live token) / .markdown-preview-view strong (reading tag)' },
  },
  'inline-emphasis': {
    purpose:
      'Entry point for italic content: a mark decoration span in live view; a semantic em tag in reading view.',
    states: 'In live view the * / _ markers are revealed when the cursor touches them.',
    dom: 'Same two-view structure as inline-strong.',
    obsidian: { counterpart: '.cm-emphasis (live token) / .markdown-preview-view em (reading tag)' },
  },
  'inline-code': {
    purpose:
      'Entry point for inline code content: a mark decoration span in live view; a semantic code tag in reading view.',
    states: 'In live view the backtick markers are revealed when the cursor touches them.',
    dom: 'Live: an inline mark span (multi-backtick fences match by their actual delimiter length). Reading: a <code> element inside the block.',
    obsidian: { counterpart: '.cm-inline-code (Obsidian also uses .cm-hmd-inline-code; this contract promises the former)' },
  },
  'inline-highlight': {
    purpose:
      'Entry point for highlighted (==text==) content: the live span carries a persistent theme-colored background; reading view uses the mark tag. For the background variable see var-highlight-background.',
    states: 'In live view the == delimiters are revealed when the cursor touches them (same semantics as bold).',
    dom: 'Live: a mark decoration span. Reading: a <mark> element inside the block.',
    obsidian: { counterpart: '.cm-highlight (live token) / .markdown-preview-view mark' },
  },
  'inline-strikethrough': {
    purpose:
      'Entry point for strikethrough (~~text~~) content: reading view only — a semantic del tag rendered by markdown-it. The live side parses the syntax but adds no decoration and shows the raw source (see limit-strikethrough-live).',
    dom: 'A <del> element inside the reading block. No live decoration class exists; not supported there.',
    obsidian: { counterpart: '.markdown-preview-view del (reading tag)' },
  },
  'html-comment': {
    purpose:
      'Dimming entry point for HTML comments (#139): in live view the whole inline Comment / multi-line CommentBlock range (delimiters included) gets a mark decoration span rendered at low contrast by mixing 45% into the foreground (not hidden, not folded — readable and editable). In reading view comments are removed entirely before rendering (line breaks kept, no inline gap left), so nothing shows and there is no class to target.',
    states:
      'The dimmed color is always visible in live view (no reveal-on-touch semantics — comments do not participate in the two-state toggle; Ctrl+/ is the only way to remove them).',
    dom: 'A mark decoration span inside the live container; node names follow Lezer observation (inline Comment / block CommentBlock — HTMLBlock is a real HTML block whose inner comments are unreachable).',
    obsidian: { counterpart: 'Direction of .cm-comment (semantically equivalent in Obsidian, but the original name is not promised to match)' },
  },
  'block-id-mark': {
    purpose:
      'Dimming entry point for block id markers (#163 acceptance feedback): in live view both forms — a trailing ` ^id` at end of line and a standalone `^id` line — get a whole-range mark decoration span (including the leading whitespace of the trailing form), rendered at low contrast by mixing 45% into the body foreground. The color transforms relative to the body color instead of anchoring to a fixed value, so custom font colors keep working; a single color-mix rule serves both dark and light themes; not hidden, not folded — readable and editable. In reading view the markers are stripped before rendering (blockIdStrip: trailing markers deleted, standalone lines deleted with their line breaks kept), so nothing shows and there is no class to target.',
    states:
      'The dimmed color is always visible in live view (a block id is a structural marker with no cursor two-state toggle; copy block link lives in the context menu / keyboard shortcut).',
    dom: 'A mark decoration span inside the live container; markers inside fences do not match (code content), while a trailing marker on the closing fence line does match (the id of the fence block itself).',
    obsidian: { counterpart: 'None (Obsidian hides block ids in reading view and dims them via built-in live styles, with no public class name)' },
  },

  // ---- 行级语法（line-syntax，5 条）----
  'live-code-line': {
    purpose:
      'Line class for live fenced/indented code lines (fence marker lines included); for the line class while cards are enabled see live-code-card-line in the chrome domain.',
    dom: 'A .cm-line line element inside the live container; matches line by line inside fences.',
    obsidian: { counterpart: '.HyperMD-codeblock (the Obsidian code block line class family)' },
  },
  'live-quote-line': {
    purpose:
      'Line class for live quotes (the > prefix); quote content gets no extra spans (see limit-quote-span). For the 3px accent bar on the left edge see var-quote-bar-color (shared with the reading blockquote); left padding is calc(0.9em + 3px) — the layout slot left after the QuoteMark presentation is hidden — aligned with the reading blockquote.',
    states: 'The > marker at line start is only revealed near the marker and its adjacent spaces.',
    dom: 'A .cm-line line element inside the live container.',
    obsidian: { counterpart: '.HyperMD-quote (the Obsidian quote line class)' },
  },
  'live-hr-line': {
    purpose:
      'Line-level class for live horizontal rules; since #106 the rendered state took over, and this class remains for coloring the raw-source state.',
    states: 'The source text is revealed while the cursor touches the line (the line class still matches).',
    dom: 'A .cm-line line element inside the live container.',
    obsidian: { counterpart: '.cm-hr (the Obsidian horizontal rule token class)' },
  },
  'live-hr-widget': {
    purpose:
      'The rendered widget element for live horizontal rules (#106: the source text is hidden unless touched, and this element draws the actual rule as a centered gradient; its line box height equals the body line height, and its color shares the reading hr variable --vsidian-hr-color).',
    states: 'The widget is withdrawn and the source shown while the cursor touches the line.',
    dom: 'An inline element replacing the entire horizontal rule source text.',
    obsidian: { counterpart: 'The rule-drawing side of .cm-hr (Obsidian draws through the same token class; vsidian splits this into a line class and a widget)' },
  },
  'live-frontmatter-line': {
    purpose:
      'Line class for live frontmatter lines (the header block is shown as raw source; its syntax is not parsed).',
    dom: 'A .cm-line line element inside the live container; boundaries are determined by markdownDoc.frontmatterRange (shared by both views).',
    obsidian: { counterpart: '.cm-hmd-frontmatter (the Obsidian frontmatter class)' },
  },

  // ---- 列表与任务（list-task，5 条）----
  'live-list-line': {
    purpose:
      'Line class for live list item lines; the -d{1..8} depth modifier is a vsidian-specific form (Obsidian expresses indentation through combinations of line classes).',
    states: 'The list marker at line start is only revealed near the marker and its adjacent spaces.',
    dom: 'A .cm-line line element inside the live container; combines with the bullet/ordered modifiers.',
    obsidian: { counterpart: '.HyperMD-list-line (the Obsidian list line class family)' },
  },
  'live-list-bullet': {
    purpose:
      'Modifier for unordered list lines: once the source marker is hidden, a ::before bullet takes its place.',
    states:
      'Mutually exclusive with .vsidian-list-marker-visible (the pseudo-bullet is suppressed while the source marker is revealed).',
    dom: 'A line-level modifier class on list lines; the bullet is drawn on ::before.',
    obsidian: { counterpart: 'No direct counterpart (Obsidian relies on .cm-formatting-list hiding plus native list styles)' },
  },
  'live-list-ordered': {
    purpose: 'Modifier for ordered list lines (the numbering stays visible).',
    dom: 'A line-level modifier class on list lines.',
    obsidian: { counterpart: 'No direct counterpart (same as live-list-bullet)' },
  },
  'live-list-marker-visible': {
    purpose:
      'Suppresses the ::before pseudo-bullet while the unordered list source marker is revealed, avoiding a double bullet.',
    states: 'Added when the cursor enters the neighborhood of the marker.',
    dom: 'A line-level state modifier class on list lines.',
    obsidian: { counterpart: 'No direct counterpart' },
  },
  'live-task-checkbox': {
    purpose:
      'The live task checkbox (interactive: click / Enter / Space toggles the check and writes it back to Markdown); the checked state has two entry points: the :checked pseudo-class and the .vsidian-task-checked class.',
    states: 'Switches back to the raw source form while the cursor is inside the [ ]/[x] markers (the widget is withdrawn).',
    dom: 'An input widget replacing the task marker range.',
    obsidian: { counterpart: 'Direction of .cm-task-* (Obsidian renders task markers through an HMR widget with no public stable class)' },
  },

  // ---- 表格（table，11 条）----
  'live-table-line': {
    purpose:
      'Line class for live table rows (shared by header/delimiter/data rows); pipes are shown only in the degraded source form or on the active delimiter row.',
    dom: 'A .cm-line line element inside the live container; combines with the header/delimiter modifiers.',
    obsidian: { counterpart: '.HyperMD-table-line (the Obsidian live table line class family)' },
  },
  'live-table-header-line': {
    purpose: 'Modifier for live table header rows.',
    dom: 'A line-level modifier class on table rows.',
    obsidian: { counterpart: 'No direct counterpart (Obsidian covers this through thead styles)' },
  },
  'live-table-delimiter-line': {
    purpose: 'Modifier for live table delimiter rows (the active delimiter row falls back to raw source display).',
    states: 'Switches to the raw source form while the cursor is on the delimiter row.',
    dom: 'A line-level modifier class on table rows.',
    obsidian: { counterpart: 'No direct counterpart' },
  },
  'live-table-cell': {
    purpose:
      'Content span for live table cells (the trimmed range); the GFM splitting semantics are implemented in-house (escaped \\| and | inside inline code do not split).',
    dom: 'A mark decoration span inside table rows; combines with the align modifiers.',
    obsidian: { counterpart: '.cm-table-cell (a direction commonly used by community themes, not an official Obsidian class)' },
  },
  'live-table-pipe': {
    purpose:
      'Span for live table pipes (boundary pipes included); hidden in the grid state, visible in the source state.',
    dom: 'A mark decoration span inside table rows.',
    obsidian: { counterpart: 'No counterpart (Obsidian hides pipes or shows them as-is)' },
  },
  'live-table-align': {
    purpose:
      'Column alignment modifiers declared by the live delimiter row (applied to the trimmed content spans); the actual grid layout is handled by the grid-align classes.',
    dom: 'Span-level modifier classes on table cells.',
    obsidian: { counterpart: 'No counterpart (alignment is handled by the rendered layout)' },
  },
  'live-table-grid-row': {
    purpose:
      'The CSS grid row of safe tables; the active cell keeps the grid in place, and cells still map to their source ranges (not an independent table data model). Since #142 column widths are distributed by content proportion: the line decoration inlines a per-table column width plan (per column minmax(min(48px, equal share), content-proportion fr); all rows of a table share the same plan) which the grid rules consume, falling back to equal columns by count when the plan is missing. Snippet overrides of grid-template-columns through class rules still take precedence.',
    dom: 'The grid row container inside table rows (CSS grid layout).',
    obsidian: { counterpart: 'The direction of the Obsidian live table grid (no precisely matching class)' },
  },
  'live-table-grid-cell': {
    purpose:
      'Grid cells of safe tables; the grid is not withdrawn when the cursor enters a cell — typing goes straight into the source range of that cell (reusing CM6 IME, navigation and write-back).',
    dom: 'The cell element inside grid rows.',
    obsidian: { counterpart: 'The direction of the Obsidian live table grid' },
  },
  'live-table-grid-delimiter': {
    purpose: 'Hides the delimiter row in the grid state.',
    states: 'The active delimiter row falls back to raw source.',
    dom: 'The delimiter row element inside grid rows.',
    obsidian: { counterpart: 'The direction of Obsidian table alignment' },
  },
  'live-table-grid-align': {
    purpose:
      'Column alignment in the grid state (since #142 applied to every cell in the column — the space placeholder widgets carry the alignment classes too).',
    dom: 'Cell-level modifier classes on grid cells.',
    obsidian: { counterpart: 'The direction of Obsidian table alignment' },
  },
  'live-table-escaped-pipe': {
    purpose:
      'Hides the backslash before escaped pipes in the grid; changes display only, never the Markdown source.',
    dom: 'A span inside grid cells.',
    obsidian: { counterpart: 'No direct counterpart' },
  },

  // ---- 阅读块级结构（reading-structure，12 条）----
  'reading-block': {
    purpose:
      'Base class for every content block inside the reading container; the anchor attributes hold LF whole-document UTF-16 offsets (isomorphic to the message protocol coordinates) and are relied on by on-demand mounting and task locating.',
    dom: 'A direct child of .vsidian-view-reading; blocks contain real semantic tags rendered by markdown-it.',
    obsidian: { counterpart: 'No counterpart (the Obsidian reading view is a flat tag stream; vsidian wraps blocks in divs with inner tag structure)' },
  },
  'reading-heading': {
    purpose: 'Reading heading blocks; two entry points match (the block class and the inner tag).',
    dom: 'The block container holds a real h{n} element.',
    obsidian: { counterpart: '.markdown-preview-view h{1..6}' },
  },
  'reading-paragraph': {
    purpose: 'Reading paragraph blocks.',
    dom: 'The block container holds a real p element.',
    obsidian: { counterpart: '.markdown-preview-view p' },
  },
  'reading-blockquote': {
    purpose:
      'Reading blockquote blocks. For the 3px accent bar on the left border see var-quote-bar-color (shared with the live quote line).',
    dom: 'The block container holds a real blockquote element.',
    obsidian: { counterpart: '.markdown-preview-view blockquote' },
  },
  'reading-list': {
    purpose: 'Reading list blocks (the nested structure is restored as one block).',
    dom: 'The block container holds a real ul/ol > li nesting.',
    obsidian: { counterpart: '.markdown-preview-view ul / ol / li' },
  },
  'reading-task': {
    purpose:
      'Reading task list items (attached to the semantic li); extended data-task check states ([/], [!] etc.) are not supported.',
    dom: 'An li element inside the list block.',
    obsidian: { counterpart: '.markdown-preview-view .task-list-item' },
  },
  'reading-task-checkbox': {
    purpose: 'Reading task checkboxes (click / keyboard toggles and writes back).',
    dom: 'An input element inside the task li.',
    obsidian: { counterpart: '.markdown-preview-view .task-list-item input[type="checkbox"]' },
  },
  'reading-code-block': {
    purpose:
      'Reading fenced/indented code blocks (content excludes the fence marker text; large fences over 60 lines are split into multiple blocks line by line; for the card shell see reading-code-card in the chrome domain).',
    dom: 'The block container holds a real pre > code.',
    obsidian: { counterpart: '.markdown-preview-view pre' },
  },
  'reading-hr': {
    purpose: 'Reading horizontal rule blocks.',
    dom: 'The block container holds a real hr element.',
    obsidian: { counterpart: '.markdown-preview-view hr' },
  },
  'reading-table': {
    purpose: 'Reading table blocks (rendered by markdown-it, read-only presentation).',
    dom: 'The block container holds a real table element.',
    obsidian: { counterpart: '.markdown-preview-view table' },
  },
  'reading-frontmatter': {
    purpose:
      'Reading frontmatter header block (shown as raw source; syntax inside the header is not parsed; boundary detection is shared by both views).',
    dom: 'A pre element inside the block container.',
    obsidian: { counterpart: '.markdown-preview-view .markdown-frontmatter' },
  },
  'reading-spacer': {
    purpose:
      'Reading viewport placeholders: height reservations for off-screen blocks (not content nodes; the height is a prefix/suffix sum over the block height table). A vsidian-specific structure outside the compatibility promises; its presence in snippets does not affect content block targeting.',
    dom: 'Placeholder divs at the head/tail of the reading container.',
    obsidian: { counterpart: 'No counterpart (Obsidian handles virtualization internally)' },
  },

  // ---- 链接、图片与双链（link-image-wikilink，7 条）----
  'live-link': {
    purpose:
      'Content span for live links (always decorated; when the cursor or selection enters the range of a link, its [ and ](url) source is revealed while other links on the same line stay formatted); the hidden tail corresponds to the direction of .cm-formatting-link / .cm-string.cm-url in Obsidian — vsidian presents it by hiding, with no separate styling class.',
    states: 'The source is revealed while the cursor or selection is inside the link range.',
    dom: 'An inline mark decoration span in live view (indirect decoration: shown as raw source outside the viewport and applied once scrolled into it).',
    obsidian: { counterpart: '.cm-link (the Obsidian link content token)' },
  },
  'reading-link': {
    purpose:
      'Reading links: a semantic <a> rendered by markdown-it (a single click reports the navigation intent through container delegation; no webview-native navigation).',
    dom: 'A real a element inside the reading block.',
    obsidian: { counterpart: '.markdown-preview-view a' },
  },
  'image-slot': {
    purpose:
      'Base class of the image slot: in reading view it is the <img> element itself (Obsidian img tag selectors match naturally); in live view it is a widget container span (the inner img is loaded by the resource manager — a vsidian-specific form).',
    states: 'Loading starts only when the slot enters the viewport; leaving the viewport unloads and releases it (src is cleared).',
    dom: 'Reading: img.vsidian-image inside the block. Live: an inline widget span.vsidian-image > img.',
    obsidian: { counterpart: '.markdown-preview-view img (reading) / .cm-image (live direction; Obsidian has no public stable class)' },
  },
  'image-states': {
    purpose:
      'The three image states: placeholder (alt text) / loaded (confirmed by the load event) / failed (click to retry, with a visible error outline).',
    states: 'loading → loaded / error; clicking in the error state retries.',
    dom: 'Element-level state modifier classes on the image slot.',
    obsidian: { counterpart: 'No direct counterpart (Obsidian has no public loading state classes)' },
  },
  'live-wikilink': {
    purpose:
      'Live wikilink presentation: outside the range it is a display-text widget (replacing the whole [[…]], with the alias class on both the widget wrapper and the source mark); inside the range it becomes the source mark. The split form of Obsidian (link name / alias / formatting brackets) has no split classes here.',
    states: 'The source is revealed while the cursor is inside the wikilink range.',
    dom: 'An inline widget or mark decoration in live view (indirect decoration, shown as raw source outside the viewport; not decorated inside fences, inline code or frontmatter).',
    obsidian: { counterpart: '.cm-hmd-internal-link (the Obsidian live internal link token class family)' },
  },
  'reading-wikilink': {
    purpose:
      'Reading wikilinks: a semantic <a> rendered by the markdown-it wikilink rule (href is the raw target; the alias or link name is displayed; a single click reports the navigation intent).',
    dom: 'A real a element inside the reading block.',
    obsidian: { counterpart: '.markdown-preview-view a.internal-link (the Obsidian reading internal link class)' },
  },
  'anchor-flash': {
    purpose:
      'Jump target highlight (#163 acceptance feedback): after an anchor jump through a wikilink or plain link (the view.locate channel), the target heading/paragraph is overlaid with a translucent yellow; it disappears on any user interaction (click, scroll, key press, switching away). Live applies a line-level decoration (each line of the target block), reading a block-level class (flashBlock, which survives remounting under virtualization) — the class name is identical across views, and the background color is exposed through the --vsidian-anchor-flash-background variable (a user-overridable CSS interface, see var-anchor-flash-background). Outline clicks do not flash (the target entry keeps its persistent highlight).',
    states:
      'Appears after the jump locates the target and disappears on any user interaction (including switching modes or editing the document) — a transient hint with no persistent state.',
    dom: 'Live: .cm-line line elements (each line of the target block). Reading: the .vsidian-reading-block element.',
    obsidian: { counterpart: 'None (the Obsidian built-in highlight animation has no public class name)' },
  },

  // ---- 公开 CSS 变量（content-variables，11 条）----
  'var-anchor-flash-background': {
    purpose:
      'The translucent yellow background of the jump target highlight (#163 acceptance feedback): a user-overridable CSS interface, referenced by both the live line-level rule and the reading block-level rule (defined once, effective in both views). Defaults to rgba(255, 213, 79, 0.25).',
    dom: 'Defined on #app.',
    obsidian: { counterpart: 'None' },
  },
  'var-heading-color': {
    purpose:
      'The heading level color variable family: referenced by live heading lines, reading heading blocks and outline entries alike (theme-graded coloring defined once, effective everywhere). Defaults to var(--vscode-editor-foreground).',
    dom: 'Defined on #app; the Obsidian aliases --h{1..6}-color take effect through the variable bridge (a vsidian-name override always takes strict precedence).',
    obsidian: { counterpart: '--h1-color ... --h6-color (the Obsidian per-level color variable family)' },
  },
  'var-reading-font-size': {
    purpose:
      'The reading body font size; defaults to var(--vsidian-content-font-size) (follows the VSCode editor font size).',
    dom: 'Defined on the reading content layer; Obsidian alias --font-text-size.',
    obsidian: { counterpart: '--font-text-size' },
  },
  'var-reading-max-width': {
    purpose:
      'The reading block max width (since #175 one of the readable line width pair — a single editor.readableLineWidth setting drives both modes while snippets can override either one separately); defaults to none = full width (the former invisible 760px cap was abolished with the #174 fix).',
    dom: 'Defined on the #app layer (since #175 at the same site as the live variable — the setting value is written inline on the mount root, and a former reading-layer definition would shadow it, hence the move); Obsidian alias --file-line-width.',
    obsidian: { counterpart: '--file-line-width' },
  },
  'var-live-preview-max-width': {
    purpose:
      'The max width of the live content column (added in #175, sharing the setting value with the reading variable; when capped, the whole [line-number column + gap + content column] group is centered and the line-number column moves with it); defaults to none = full width.',
    dom: 'Defined on the #app layer; Obsidian alias --file-line-width (the same alias as the reading variable — Obsidian semantics are one global line width applied to both the editing and reading views).',
    obsidian: { counterpart: '--file-line-width' },
  },
  'var-reading-line-height': {
    purpose: 'The reading body line height; defaults to var(--vsidian-content-line-height).',
    dom: 'Defined on the reading content layer; Obsidian alias --line-height-normal.',
    obsidian: { counterpart: '--line-height-normal' },
  },
  'var-reading-code-background': {
    purpose:
      'The code block background; defaults to var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12)).',
    dom: 'Defined on the reading code block layer; Obsidian alias --code-background.',
    obsidian: { counterpart: '--code-background' },
  },
  'var-highlight-background': {
    purpose:
      'The highlight background: referenced by the live body span, the reading mark and outline entries alike. Dark theme defaults to rgba(255, 208, 0, 0.35); light theme overrides it with #ffe066 under body.vscode-light (two rounds of visual testing found the theme-variable contrast insufficient, so Obsidian-style fixed fluorescent yellow was adopted with per-theme tuning).',
    dom: 'Defined on #app (light branch under body.vscode-light); Obsidian alias --text-highlight-bg.',
    obsidian: { counterpart: '--text-highlight-bg' },
  },
  'var-quote-bar-color': {
    purpose:
      'The quote accent bar color: referenced by the live quote line (the inset bar of .vsidian-quote-line) and the reading blockquote left border alike. A clearly accent purple: dark theme defaults to #a78bfa, light theme overrides it with #7c3aed under body.vscode-light; the background still uses --vscode-textBlockQuote-background (only the bar changes color — no purple background is added).',
    dom: 'Defined on #app (light branch under body.vscode-light); a vsidian-owned variable with no Obsidian alias.',
    obsidian: { counterpart: 'None (the Obsidian quote bar is handled by theme border styles, with no public variable)' },
  },
  'var-table-background': {
    purpose:
      'Background of live table rows / the reading table header; defaults to rgba(128, 128, 128, 0.05).',
    dom: 'Defined on #app (centrally defined since #132; consumer sites previously carried inline fallbacks); Obsidian alias --table-background.',
    obsidian: { counterpart: '--table-background' },
  },
  'var-heading-accent': {
    purpose:
      'Formerly the left-edge accent color of in-viewport live headings; removed along with the #55 removal of the left-edge bar and no longer public. This entry is kept as the historical record of the deprecation/removal lifecycle.',
    dom: 'None (the variable is no longer defined or consumed).',
    obsidian: { counterpart: 'None' },
    removed:
      'Removed during the v0.2.x cycle with #55 (2026-09-25); at removal the variable was only used by an internal test snippet, so no user migration was needed.',
  },

  // ---- 不支持与限制（content-limits，11 条）----
  'limit-hashtag': {
    purpose:
      'Tag (#tag) syntax is not implemented: selectors match nothing in snippets (no errors, no effect).',
    dom: 'No tag nodes exist.',
    obsidian: { counterpart: '.cm-hashtag (live) / .tag (reading)' },
  },
  'limit-callout': {
    purpose: 'Callout syntax is not implemented; a later version will provide it.',
    dom: 'No callout structure exists.',
    obsidian: { counterpart: '.callout' },
  },
  'limit-task-extended-states': {
    purpose: 'Extended task check states are not supported: only space / x / X.',
    dom: 'The task checkbox has only two entry points: :checked and .vsidian-task-checked.',
    obsidian: { counterpart: '.task-list-item[data-task]' },
  },
  'limit-markdown-embed': {
    purpose:
      'Embed (![[…]] etc.) structures are not provided (incomplete wikilink forms are shown as-is); blockquote blocks are already supported.',
    dom: 'No embed containers exist.',
    obsidian: { counterpart: '.markdown-embed' },
  },
  'limit-strikethrough-live': {
    purpose:
      'Strikethrough is undecorated in live view: the parser supports it but no live decoration class exists and the raw source is shown; the reading-side del tag is available (see inline-strikethrough).',
    dom: 'No strikethrough span exists in live view.',
    obsidian: { counterpart: '.cm-strikethrough (live token) / the reading-side del is supported' },
  },
  'limit-quote-span': {
    purpose:
      'Quote content gets no extra spans: live view only has the line-level .HyperMD-quote alias; the span-level .cm-quote token class of Obsidian is not promised.',
    dom: 'No content spans exist inside quote lines.',
    obsidian: { counterpart: '.cm-quote (span-level token)' },
  },
  'limit-is-unresolved': {
    purpose:
      'Not implemented: the workspace is not queried for display, avoiding indexes/lookups introduced for styling. All wikilinks render in the same color.',
    dom: 'No unresolved modifier class exists.',
    obsidian: { counterpart: '.is-unresolved' },
  },
  'limit-reference-links-live': {
    purpose:
      'Reference-style links/images: fully parsed by markdown-it in reading view (clickable); live view does not parse reference definitions and shows the raw source (Ctrl+click does not navigate) — a cross-view behavior difference.',
    dom: 'No reference-style link decoration exists in live view.',
    obsidian: { counterpart: 'Obsidian parses them in both views' },
  },
  'limit-table-crossview': {
    purpose:
      'markdown-it does not recognize | inside inline code: tables containing this form are split at wrong positions or degraded to paragraphs in reading view; live view splits correctly per the GFM spec (the deviation is recorded under "Known limitations" in docs/perf/2026-09-table-cell-editing.md).',
    dom: 'Reading tables are split by markdown-it.',
    obsidian: { counterpart: 'Obsidian behaves consistently in both views' },
  },
  'limit-virtualization': {
    purpose:
      'Blocks outside the reading viewport do not exist in the DOM: snippets relying on a persistent whole-document DOM (global :nth-child targeting, cross-screen sibling/descendant selectors, scrollbar calculations assuming the full content height) conflict with on-demand mounting. Blocks scrolled back into the viewport remount and inherit document-level styles.',
    dom: 'Off-screen areas are held by spacers (see reading-spacer).',
    obsidian: { counterpart: 'Obsidian handles virtualization internally' },
  },
  'limit-find-hit-mask': {
    purpose:
      'The replace decoration of the current match takes precedence over find highlights: when a hit falls inside a folded hidden marker (such as link syntax markers), the find highlight is not visible; match counting and stepping are unaffected (computed over the whole-document text model).',
    dom: 'The find highlight decoration layer and the syntax decoration layer stack.',
    obsidian: { counterpart: '—' },
  },
}

/**
 * 按目标语言应用条目英文覆盖（参数化取词，覆盖表由调用方传入）：
 * - lang 非 en 开头（或条目无覆盖）→ 原样返回同一引用（中文基准零开销）；
 * - 有覆盖 → 字段级 merge 生成新条目：覆盖字段用英文，其余字段（含不译
 *   字段与 obsidian.support）回退中文基准；不原地改写入参。
 */
export function applyStyleContractEntryOverride(
  entry: StyleContractEntry,
  lang: string,
  overrides: Readonly<Record<string, StyleContractEntryOverride>>,
): StyleContractEntry {
  if (!lang.startsWith('en')) return entry
  const override = overrides[entry.id]
  if (!override) return entry
  return {
    ...entry,
    ...(override.purpose !== undefined ? { purpose: override.purpose } : {}),
    ...(override.states !== undefined ? { states: override.states } : {}),
    ...(override.dom !== undefined ? { dom: override.dom } : {}),
    ...(override.deprecated !== undefined ? { deprecated: override.deprecated } : {}),
    ...(override.removed !== undefined ? { removed: override.removed } : {}),
    ...(override.obsidian !== undefined
      ? { obsidian: { ...entry.obsidian, counterpart: override.obsidian.counterpart } }
      : {}),
  }
}

/** 便捷封装：查本模块覆盖表（生成器加载校验与测试用；设置页消费生成物
 *  内联覆盖表时走参数化 applyStyleContractEntryOverride，避免本模块数据
 *  与生成物数据重复进 bundle） */
export function localizedStyleContractEntry(entry: StyleContractEntry, lang: string): StyleContractEntry {
  return applyStyleContractEntryOverride(entry, lang, STYLE_CONTRACT_EN_OVERRIDES)
}
