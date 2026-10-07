// 样式参考条目英文平行覆盖（#178 机制 + #179 content 域全量 + #180 chrome
// 域全量）：设置页「样式参考」条目文档字段的英文版单一事实源——中文清单
// （./styleContract）保持权威基准不动，本模块按条目 id 索引、字段级覆盖；
// 取词规则为**英文优先、条目或字段缺失回退中文基准**（规格
// docs/specs/style-reference-i18n.md）。153 条（content 84 + chrome 69）
// 已全量覆盖（域级完整性由 test/unit/styleContractEn.test.ts 钉住）。
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
      'Modifier for unordered list lines: once the source marker is hidden, a ::before bullet takes its place; the bullet glyph is graded by nesting depth (aligned with the reading-side marker semantics): level 1 filled disc, level 2 hollow circle, level 3 and deeper filled square — the hollow shape is reserved for second-level sublists (the previous all-filled rendering that disagreed with the reading view has been fixed). The reading side pins the same semantics with explicit list-style-type (disc/circle/square, no reliance on UA defaults).',
    states:
      'Mutually exclusive with .vsidian-list-marker-visible (the pseudo-bullet is suppressed while the source marker is revealed); the depth grading combines with the -d{1..8} line classes.',
    dom: 'Live: a line-level modifier class on list lines, the bullet drawn on ::before; reading: the native li::marker.',
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
  'live-table-prefix': {
    purpose:
      'Container prefix span for grid rows (#296 render-breakage fix): the prefix region of table rows inside quotes/lists (marker hiding range and the bare gap before the first pipe) is wrapped into this mark and excluded from grid placement via CSS display:none — leftover prefix DOM (the empty placeholder intrinsically produced by replace, and bare text nodes) becomes an occupying grid item that wraps cells onto a second row.',
    states:
      'The mark steps aside while the cursor/selection touches the prefix region, so the prefix text becomes visible and editable (it then participates in the inline layout).',
    dom: 'A mark decoration span covering the container prefix range inside a grid row.',
    obsidian: { counterpart: 'No counterpart (Obsidian exposes no public class for prefix handling of tables in containers)' },
  },
  'live-table-align': {
    purpose:
      'Column alignment modifiers declared by the live delimiter row (applied to the trimmed content spans); the actual grid layout is handled by the grid-align classes.',
    dom: 'Span-level modifier classes on table cells.',
    obsidian: { counterpart: 'No counterpart (alignment is handled by the rendered layout)' },
  },
  'live-table-grid-row': {
    purpose:
      'The CSS grid row of safe tables; the active cell keeps the grid in place, and cells still map to their source ranges (not an independent table data model). Since #142 column widths are distributed by content proportion: the line decoration inlines a per-table column width plan (per column minmax(min(floor px, equal share), content-proportion fr); all rows of a table share the same plan) which the grid rules consume, falling back to equal columns by count when the plan is missing. Since #371 the floor is a font-size-aware readability minimum (about three CJK glyphs of content width plus the cell box allowance, measured by the tableMetrics probe and injected, falling back to 48px by default), while the equal share inside min() remains the CSS double guard keeping the summed floors within the container. Snippet overrides of grid-template-columns through class rules still take precedence. #296 render-breakage fix: the generic grid row rule no longer declares padding/box-shadow that flatten quote line classes — table rows inside quotes restore the accent bar and content indent via the .vsidian-quote-line combination (matching plain quote lines); line-level leftovers outside cells (pipes, measurement buffers, prefixes, replace empty placeholders) are all excluded from grid placement.',
    dom: 'The grid row container inside table rows (CSS grid layout).',
    states:
      'Table rows inside quotes/lists stack container line classes on top (accent bar, indent, bullet); the selected-row outline is covered separately by the row-selected rules.',
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
      'Base class of the image slot: in reading view it is the <img> element itself (Obsidian img tag selectors match naturally); in live view it is a widget container span (the inner img is loaded by the resource manager — a vsidian-specific form). Since #212 images outside links and tables carry the shared button group: the live slot span doubles as vsidian-graphic-frame (the vsidian-image class stays, slot semantics unchanged); reading imgs are wrapped by the same frame span (img is a void element and cannot have children).',
    states:
      'Loading starts only when the slot enters the viewport; leaving the viewport unloads and releases it (src is cleared). Since #212 the button group appears in the loaded state (no buttons while error/loading — the error-state click-to-retry semantics stay), driven by sibling/descendant selectors on data-vsidian-img-state.',
    dom: 'Reading: img.vsidian-image inside the block (since #212 optionally wrapped by span.vsidian-graphic-frame.vsidian-image). Live: an inline widget span.vsidian-image > img (with the frame class added when the button group is attached; the group is a following sibling of the img).',
    obsidian: { counterpart: '.markdown-preview-view img (reading) / .cm-image (live direction; Obsidian has no public stable class)' },
  },
  'image-states': {
    purpose:
      'The three image states: placeholder (alt text) / loaded (confirmed by the load event) / failed (click to retry, with a visible error outline). Failure notices are directly visible (2026-10-05 acceptance rework): the notice text (per failure variant i18n entry) is written into the slot img\'s alt while the src is removed — an img without a valid src renders its alt as text per spec, so the notice sits inside the error capsule and reads without hovering (previously the info lived only in the hover tooltip, and alt-less failure slots collapsed into a few-pixel sliver). The original alt is remembered and restored on recovery (user-written alt is never lost), and "loaded-but-failed with a src" also drops the src to unify on the alt-text form (the broken-image icon form truncates the alt beyond reading).',
    states: 'loading → loaded / error; clicking in the error state retries; in the error state the slot img has no src and alt = the failure notice (the original alt is restored on leaving the error state).',
    dom: 'Element-level state modifier classes on the image slot.',
    obsidian: { counterpart: 'No direct counterpart (Obsidian has no public loading state classes)' },
  },
  'image-failure-variants': {
    purpose:
      'Failure variants (#201): confirmed deletion (positive on-disk missing evidence, "not found") and inaccessibility (SSH disconnect / permission errors) never masquerade as each other — not found gets a faint red background, inaccessible a warning-yellow hint; kept in sync with data-vsidian-img-reason (not-found / inaccessible).',
    states: 'Only applied on top of the error base class; removed when a refresh succeeds (loaded) or the slot is released.',
    dom: 'Element-level failure-reason modifier classes on the image slot.',
    obsidian: { counterpart: 'No counterpart (Obsidian has no deleted/inaccessible distinction classes)' },
  },
  'image-solo-block': {
    purpose:
      'Block container variant for an image standing alone on its line: in live view, when the whole line holds a single image (all remaining text is whitespace, trailing whitespace included), the widget slot switches to block layout; since #212 the reading view carries the same semantics — when the image is the only element child of its paragraph and the surrounding sibling text is all whitespace, the mount hook wraps the frame and a JS check adds this class (the :only-child pseudo-class is not used — it only counts element children, so a "text + image" mixed paragraph would falsely match and force the image onto its own line). Block layout provides a definite width basis for sources without intrinsic dimensions (viewBox-only percentage-width SVGs, the mermaid export form) — such sources collapse to 0×0 under inline-block shrink-to-fit (the img loads successfully, so the failure is silent and shows as a blank line). Sources with intrinsic dimensions are unaffected (they still render at natural width under block layout). Known boundary: such SVGs mixed inline with other content (list prefixes, surrounding text, multiple images on one line) keep the inline form. Companion modifier vsidian-image-sized (effective only on the solo block form, added by the #212 button-alignment fix): once the image finishes loading and still renders narrower than the available line width (parent content width), markImageFrameSized adds it and the frame takes width:fit-content to shrink around the image — the button group (absolute top-right) then hugs the image corner instead of the line edge. Percentage-width SVGs and clamped large images (rendered width = line width) do not get it, so the block fill basis of the former (its collapse-fix semantics) is never fit-content-ed. The comparison denominator is the parent content width, not the current frame width (the latter negates itself after shrinking); no decision before load completes (percentage-width SVGs show a bogus naturalWidth before load — an early hit deadlocks into collapse); offscreen construction defers the first computation to a ResizeObserver once the frame gains layout.',
    states:
      'Live: decided per line at decoration build time (same rule on the tree-driven and loose paths) — the line counts as solo when all text outside the image range is whitespace. Reading: decided by decorateImageChromeBlock when wrapping the frame (only element child plus all-whitespace sibling text). The three state modifier classes still stack on top. sized: attached only on the solo block form (live render callback gates on block+chrome, reading frame wrap on the block class — inline mixed, link-nested and table-grid images do not get it, no button-alignment need) — added when the image has loaded (load listener recomputes, converging after invalidate refetches) and renders narrower than the available line width, removed otherwise; removed immediately on error (the loaded→invalidated→refetch-failed chain restores the full-width error box and its retry target instead of a shrunken remnant); loading state shows no visual difference (the button group only appears in the loaded state).',
    dom: 'Live inline widget span.vsidian-image.vsidian-image-block > img; reading span.vsidian-graphic-frame.vsidian-image.vsidian-image-block > img (both display: block). With sized stacked, the same node also carries .vsidian-image-sized (width: fit-content).',
    obsidian: { counterpart: 'No direct counterpart (Obsidian has no public standalone-image layout class)' },
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
      'Background of the live header cells / the reading table header (th) / the frontmatter card title bar (since #213 data rows are transparent — the row background now uses --vsidian-table-row-background); defaults to rgba(128, 128, 128, 0.05).',
    dom: 'Defined on #app (centrally defined since #132; consumer sites previously carried inline fallbacks); Obsidian alias --table-background.',
    obsidian: { counterpart: '--table-background' },
  },
  'var-table-row-background': {
    purpose:
      'Background of live table data rows and delimiter rows; defaults to transparent (blending into the editor background, aligned with the reading-side td). Header cell backgrounds are unaffected by this variable (they still use --vsidian-table-background).',
    dom: 'Defined on #app; consumed by the .vsidian-table-line line-level rule (shared by header/delimiter/data rows — the header cell-level background paints on top of it on header rows). Snippets override it by declaring on #app or any descendant — :root/body declarations are cut off by the #app-level definition.',
    obsidian: {
      counterpart:
        'None (Obsidian derives data-row backgrounds from the table-wide --table-background default plus the --table-row-alt-background zebra stripe — no single data-row variable exists, and --table-background is already bridged to --vsidian-table-background)',
    },
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
      'Partial boundary for embeds (![[…]]): a line-owning embed renders as the reference card in the reading view (#222) and mounts the same card in the live view with cursor-driven source reveal (#223) — see reading-embed-card / live-embed-widget. Since #244/#245, line-owning embeds expand recursively inside body cards and hover previews. Since #246, mixed-run lines (other content on the line) and list/blockquote containers upgrade to in-flow cards in the reading view — see reading-embed-mixed. Since #247, mixed-run lines and list/blockquote/task/lazy-continuation containers in the live view mount cards too, with the hidden form replacing only the exact embed range — surrounding text, list markers, task checkboxes, quote prefixes and existing indentation are preserved, see live-embed-widget. Since #248, table cells (header and data cells, with escaped-pipe alias forms decoded per in-cell semantics — the target/inner uses the decoded form while ranges stay on the raw source) upgrade to in-cell cards in both views. Link-label runs keep the raw source/placeholder in both views (a block-level card inside an inline link label would be an invalid presentation); writing into embedded content is not supported. Incomplete wikilink forms are shown as-is; blockquote blocks are already supported.',
    dom: 'Where no embed container applies: table cells and link-label runs in both views render the raw source or placeholder span (.vsidian-embed-slot, plain-text form); embed literals inside code (fenced/indented/inline) and comments are never parsed.',
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

  // ==== 界面域（chrome，55 条；#180 全量）====
  // 术语锚点：公式 = math、图表 = diagram、大纲 = outline、
  // frontmatter 表格卡片 = frontmatter table card、属性 = property、
  // 修改按钮 = Edit button、添加属性 = Add property（均与 locales/en.ts
  // 对应界面词条同源）；降级 = falls back / degrades、成型 = well-formed、
  // 写回 = writes back。

  // ---- 公式（math，5 条；#59）----
  'live-math': {
    purpose:
      'The stable container of the rendered math state: in live view the outer wrapper of the inline widget; in reading view the KaTeX outer span/p (containing the KaTeX .katex structure); color inherits the editor foreground. Obsidian splits the .cm-math-begin/end delimiter classes; this project replaces the range as a whole and has no split classes.',
    states: 'In live view the source is revealed while the cursor is inside the math range (see live-math-source).',
    dom: 'Live: an inline replacement widget; reading: an inline span or a block-level p.katex-block (the KaTeX HTML is produced by KaTeX).',
    obsidian: { counterpart: '.cm-math (the Obsidian live math token)' },
  },
  'live-math-block': {
    purpose:
      'The rendered-state variant of block math ($$…$$ / \\begin{align} etc.): its own block, centered, horizontally scrollable. Emitted on both sides — the live widget and the reading p.katex-block (attached alongside .vsidian-math).',
    dom: 'Live: a block-level replacement widget; reading: p.katex-block (vsidian-math and this class are attached together).',
    obsidian: { counterpart: 'The direction of .HyperMD-math (block math lines)' },
  },
  'live-math-source': {
    purpose: 'The source-revealing mark shown while the cursor is inside the math range (monospace coloring + a light background).',
    states: 'While the cursor is inside the math range.',
    dom: 'A live mark decoration.',
    obsidian: { counterpart: 'The editing-state direction of .cm-hmd-math-begin' },
  },
  'reading-math-block': {
    purpose:
      'The reading math block (rendered by markdown-it-katex; rendered on mount, released on unmount, height filled back in by a ResizeObserver); the math container inside the block is p.katex-block (vsidian-math / -math-block attached on top of it).',
    dom: 'Inside the reading block container, a <p class="katex-block"> wrapping .katex-display.',
    obsidian: { counterpart: '.markdown-preview-view .math-block' },
  },
  'math-error': {
    purpose:
      'The raw-source fallback span for math that fails to parse: error color + light red background + monospace font, with the original text fully readable (shared by both views; the title attribute carries the original text for hover checking).',
    dom: 'Live: a replacement widget span; reading: a span (inline) / p.katex-block>code (block).',
    obsidian: { counterpart: 'The direction of .math-error / .katex-error' },
  },

  // ---- 图表渲染（diagram，4 条；#60）----
  'mermaid-container': {
    purpose:
      'The rendering container of a mermaid fence (shared by the live widget inner layer and the reading fence container; carries the data-vsidian-mermaid-code source and the data-vsidian-mermaid-state state loading/rendered/error).',
    dom: 'Live: the inner layer of the vsidian-graphic-frame widget; reading: inside the vsidian-reading-mermaid block. The rendering container holds the mermaid SVG (in the rendered state).',
    obsidian: { counterpart: '.mermaid (the diagram container of the Obsidian reading rendering)' },
  },
  'mermaid-svg': {
    purpose:
      'The SVG produced by mermaid itself (width constrained by the container, height scaled proportionally). Nodes inside the SVG are private DOM of the third-party renderer and are not promised stable (see limit-mermaid-internals).',
    dom: 'An SVG inside the rendering container.',
    obsidian: { counterpart: '.mermaid svg' },
  },
  'reading-mermaid-block': {
    purpose:
      'The block element class for a reading mermaid fence rendered as one whole block (exempt from the 60-line large-fence splitting; rendered on mount, released with the block on unmount); the .vsidian-mermaid rendering container lives inside the block.',
    dom: 'A reading block-level container.',
    obsidian: { counterpart: 'The direction of .markdown-preview-view .mermaid' },
  },
  'mermaid-error': {
    purpose:
      'The fallback state for mermaid syntax/render failures: the error message and the source stay readable, and the fence remains editable when the cursor enters (shared by both views).',
    dom: 'The message and source areas inside the error container.',
    obsidian: { counterpart: 'The direction of the .mermaid error' },
  },

  // ---- 图形化按钮与弹窗（graphic-interact，2 条；#111）----
  'graphic-chrome': {
    purpose:
      "The positioning wrapper of graphic code blocks (fences rendered as graphics) and its top-right button group: edit enters source editing (live preview only), popup opens the diagram popup; the group hover show/hide is CSS-driven (an opacity toggle; the DOM stays present in the rendered-success state). Since #212 Markdown images reuse the same button group and interaction contract (edit+popup on live / popup-only on reading; the image body swallows clicks to prevent accidental edits); images inside links or table grids do not carry it (explicitly out of scope). The button background is a two-layer composite (a solid-color gradient layer of the theme face + a solid editor-background underlay; editorWidget-background at rest, button-secondaryBackground on hover): theme variables may be translucent (glass-style themes), and with the buttons floating directly over mottled content such as images a translucent face lets the content color bleed through; the solid underlay keeps the face opaque under any theme, while solid theme values are fully covered by the gradient layer with no visual change.",
    states:
      'The button group shows in the rendered-success state (error fallback blocks do not emit it); the edit button is assembled only on the live preview side. Image form: shown in the loaded state (driven by sibling/descendant selectors on data-vsidian-img-state); frame.vsidian-image takes an inline layout (inline mixed flow is not broken).',
    dom: "Live: the frame around the fence widget; reading: the frame around the mermaid/graphic container. Image form: the live slot span doubles as the frame (vsidian-image added); reading imgs are wrapped by an inline frame span. The button group is absolutely positioned at the frame's top right.",
    obsidian: { counterpart: 'None (Obsidian diagram blocks have no public button-group structure)' },
  },
  'diagram-popup': {
    purpose:
      'The fullscreen overlay of the diagram popup (#111): backdrop + stage (the diagram body being zoomed/panned) + toolbar (zoom/reset/refresh/export/close); the error state keeps close and refresh; note is the notice bar shown when the environment does not support PNG rasterization. Attached to document.body and present only while the popup is open. Since #212 the image popup (view/zoom/pan/refresh/save a copy of the original image) reuses the same class family and overlay skeleton: the content is an <img> (transform-based zoom), -export-image is the image-side export button (disabled for remote images with a hover hint on a wrapper span), a mutually exclusive singleton with the diagram popup.',
    states: 'Present while opened via the popup button; dismissed by Esc, clicking the empty area or the close button.',
    dom: 'A direct child of body — the overlay (backdrop/stage/toolbar areas).',
    obsidian: { counterpart: 'None (Obsidian opens diagrams in a new tab)' },
  },

  // ---- 大纲面板（outline，19 条；#54/#65–#70；Obsidian 大纲为应用级 DOM，
  // 全系本项目自有）----
  'outline-item': {
    purpose:
      'An outline entry (the level class doubles as the indentation and level-color entry); entries are pinned to regular weight 400 and do not inherit heading-level bolding; the level colors reference the same --vsidian-heading-color-{1..6} as body headings (one source across the three sides, see var-heading-color).',
    dom: 'The entry container of the outline panel in the right sidebar.',
    obsidian: { counterpart: 'None (the Obsidian outline is app-level DOM)' },
  },
  'outline-inline-marks': {
    purpose:
      'Inline mark passthrough for outline entries (a second class-name entry on the semantic strong/em/code/del/mark elements): weight/italic/monospace/strikethrough/highlight background are triggered only by explicit markers; wikilinks/links are plain text (no a, not clickable).',
    dom: 'Semantic inline elements inside outline entries.',
    obsidian: { counterpart: 'None (the Obsidian-side outline plugin DOM is private)' },
  },
  'outline-guide': {
    purpose:
      'Level-alignment guide lines (absolutely positioned vertical lines inside entries; left aligns with the center of the ancestor chevron — a visual alignment aid for nesting levels).',
    dom: 'An absolutely positioned span inside entries with nesting levels.',
    obsidian: { counterpart: 'None' },
  },
  'outline-located': {
    purpose:
      "The persistent highlight bar of the current section's entry (semi-transparent background; the class toggle is the only source of the two-state difference); applied to the visible representative (the first visible ancestor when the target is hidden by collapse).",
    states: 'Follows the cursor position.',
    dom: 'The outline entry container.',
    obsidian: { counterpart: 'None' },
  },
  'outline-slider': {
    purpose:
      'The collapse slider row (its only show/hide switch is the outline-active class on the sidebar container; ::before draws the through line; the six-button role=group group is keyboard accessible).',
    dom: 'Between the sidebar top bar and the entry list.',
    obsidian: { counterpart: 'None' },
  },
  'outline-slider-dot': {
    purpose:
      'The six-step collapse dots: idle beads are hollow (transparent fill + outlined ring) and the current bead is solid — the active class rule is the only source of the two-state difference; since #99 the beads along the way to the current step (filled) are solid in the same state; the solid color follows --vscode-button-background.',
    dom: 'Buttons inside the slider row.',
    obsidian: { counterpart: 'None' },
  },
  'outline-chevron': {
    purpose:
      'The collapse chevron button (entries with children) / an equal-width placeholder for childless entries (keeping text left edges aligned); the stroke width is not written on SVG attributes; clicking the arrow collapses/expands while clicking the text still jumps.',
    dom: 'Button/placeholder elements inside entries.',
    obsidian: { counterpart: 'None' },
  },
  'outline-collapsed': {
    purpose:
      'A parent entry in the collapsed state (the arrow rotated -90° to point right is the only source of the two-state difference).',
    states: 'Collapsed state.',
    dom: 'The entry container.',
    obsidian: { counterpart: 'None' },
  },
  'outline-hidden': {
    purpose:
      'Entries hidden by collapse (display:none; the class toggle is the only show/hide switch; the DOM is kept to preserve index order); since #68 search filtering hides entries with the same class.',
    states: 'Hidden by collapse or filtered out by search.',
    dom: 'The entry container.',
    obsidian: { counterpart: 'None' },
  },
  'outline-toolbar': {
    purpose:
      'The outline toolbar row (jump to end, reset, search box; the outline-active class is the only show/hide switch).',
    dom: 'Between the sidebar top bar and the slider row.',
    obsidian: { counterpart: 'None (the Quiet Outline function bar is plugin-private DOM)' },
  },
  'outline-toolbar-buttons': {
    purpose:
      'The toolbar icon buttons (jump to the end of the note / the three-in-one reset — clearing the search, resetting the level and clearing manual collapse), sharing the shape of the sidebar top bar buttons (the base form is carried by the .vsidian-outline-toolbar button structural selector; this class name is the behavior anchor and snippet entry).',
    dom: 'Buttons inside the toolbar.',
    obsidian: { counterpart: 'None' },
  },
  'outline-search': {
    purpose:
      'The heading search input (flex-fills the remaining width; colors come from the --vscode-input-* variable family).',
    dom: 'The input inside the toolbar.',
    obsidian: { counterpart: 'None' },
  },
  'outline-search-hit': {
    purpose:
      'Search hit fragment highlights (wrapping only the matched substring; the background follows --vscode-editor-findMatchHighlightBackground, the same visual language family as body find hits); split at the text layer, orthogonal to the semantic elements.',
    states: 'On entries with hits.',
    dom: 'A mark element inside the entry.',
    obsidian: { counterpart: 'None' },
  },
  'outline-nomatch': {
    purpose: 'The no-match placeholder (readable feedback when a query has zero hits).',
    states: 'The search has zero hits.',
    dom: 'At the end of the entry list.',
    obsidian: { counterpart: 'None' },
  },
  'outline-menu': {
    purpose:
      "The context-menu overlay (absolutely positioned inside the sidebar; menu items are keyboard-accessible buttons; the submenu's only show/hide switch is the parent item host's :hover/:focus-within; danger marks delete in red; colors follow the --vscode-menu-* variable family). Since #183 it is assembled through the unified menu kernel (descriptor-driven, class names unchanged); the shared state classes vsidian-menu-open (the parent-item click fallback that pins the submenu open) and vsidian-menu-flip (the submenu flips left at assembly time when the right edge would clip) layer on top of the existing submenu classes.",
    states: 'Summoned by right-click.',
    dom: 'An overlay inside the sidebar.',
    obsidian: { counterpart: 'None (the VSCode native context menu lives at the host level)' },
  },
  'outline-rename-input': {
    purpose:
      'The rename inline-editing input (the entry content area is replaced by an input; the text being edited includes inline markers); the three VSCode input variables (foreground/background/border).',
    states: 'Rename state.',
    dom: 'An input inside the entry.',
    obsidian: { counterpart: 'None' },
  },
  'outline-dragging': {
    purpose:
      'The source entry being dragged (whole-element translucent weakening; the class toggle is the only source of the two-state difference).',
    states: 'While being dragged.',
    dom: 'The entry container.',
    obsidian: { counterpart: 'None' },
  },
  'outline-drop-edge': {
    purpose:
      "The insertion lines on the drop target's top/bottom edges (inset box-shadow takes no layout space and does not conflict with the located background; the color follows --vscode-focusBorder).",
    states: 'While a drag hovers over the target.',
    dom: 'The target entry container.',
    obsidian: { counterpart: 'None' },
  },
  'outline-drop-inside': {
    purpose:
      'The drop-target wrapping highlight (an outline inset by one ring + a semi-transparent background, same variable family as located — the visual distinction for "drop inside to become a child heading").',
    states: 'While a drag hovers over the middle of the target.',
    dom: 'The target entry container.',
    obsidian: { counterpart: 'None' },
  },

  // ---- 代码块卡片（code-card，10 条；#78–#84）----
  'live-code-card-line': {
    purpose:
      'Card lines carry the background on live source lines, including fence lines, and reading code-line spans. Live code ranges also carry .vsidian-code-selection: with drawSelection enabled, the text layer paints focused or inactive selection colors above opaque code backgrounds. With multicursor disabled, native selection rendering remains in use.',
    states: 'Card lines persist; .vsidian-code-selection is emitted only where nonempty live selections intersect fenced code, including multiple ranges. Text-layer painting is gated by .cm-editor:has(.cm-selectionLayer).',
    dom: 'Live: .cm-line elements in card-enabled fences, with span.vsidian-code-selection around selected code text; reading: span.vsidian-reading-code-line inside code.',
    obsidian: {
      counterpart:
        '.HyperMD-codeblock (the line family; the content-domain alias is attached to .vsidian-code-line, and the card line class is a vsidian-specific extension)',
    },
  },
  'live-code-card-edge': {
    purpose:
      'Corner rounding modifiers for the first/last card lines (the bottom corners where no header covers them; the top corners are carried by the header band). Emitted on the live side only; reading card corners are carried by .vsidian-reading-code-card.',
    dom: "The card's first/last line elements.",
    obsidian: { counterpart: 'No counterpart (corners are handled by the Obsidian native code block styles)' },
  },
  'live-code-card-header': {
    purpose:
      'The card header band: the language label + the button area on the right, with a bottom 1px separator (the look references the Code Styler plugin direction; the structure is vsidian-specific).',
    dom: "The band above the card's first line (a live block widget / the reading block's first child).",
    obsidian: { counterpart: '.code-styler-header-container (the Code Styler plugin direction)' },
  },
  'live-code-card-header-parts': {
    purpose:
      'The card language label (capitalized display name) / the button container / the language badge (the #83 colored-glyph badge, mounted inside the label).',
    dom: 'Inside the header band.',
    obsidian: { counterpart: 'The direction of .code-styler-header-title' },
  },
  'live-code-card-copy': {
    purpose: 'The copy button (through the host clipboard API); -done is the ✓ feedback state for about 1.2s after the click.',
    states: '-done lasts about 1.2s after copying; the button is not emitted in the collapsed state.',
    dom: 'The header button area.',
    obsidian: { counterpart: 'button.copy-code-button (the Obsidian native copy button)' },
  },
  'live-code-card-fold': {
    purpose:
      'The fold chevron; -collapsed is the collapsed state (rotated); folding is a view state and never writes to the source file (the reading-side collapse additionally has the block-level vsidian-code-card-folded modifier, see reading-code-card).',
    states: 'Collapse/expand.',
    dom: 'The header button area.',
    obsidian: { counterpart: '.code-styler-header-container::after (the fold arrow direction)' },
  },
  'live-code-card-wrap': {
    purpose:
      'The word-wrap toggle (#191): one click toggles auto word wrap for all reading-view code blocks at once — on is the current pre-wrap wrapping, off makes the code area scroll horizontally (the line-number column sticks to the left edge, the header stays fixed); -off is the wrapped-off modifier (weakened via filter: opacity(0.4), orthogonal to the show/hide opacity). Reading-card header only: live view always wraps (CM6 wrapping is an editor-level facet and cannot be turned off per block). A view state, not persisted and with no setting (same semantics as the fold chevron).',
    states: 'Wrapping on (default) / off (-off, the title offers to turn it back on); revealed on card hover like the copy button (hidden by default); not emitted in the collapsed state.',
    dom: 'The leftmost slot of the header button area ([wrap] [copy] [fold]).',
    obsidian: { counterpart: 'No counterpart (Obsidian code blocks have no per-block wrap toggle)' },
  },
  'live-code-card-linenumber': {
    purpose:
      'In-card line numbers (each block starts at 1, fence lines take no number; numbering continues across the split chunks of a large fence); a line-start widget in live view and a line span in reading view (same class name); coexists with the document line-number gutter (source file line numbers) as two separate columns that do not overlap.',
    dom: "At the start of the card's code lines (a live widget / a reading span).",
    obsidian: { counterpart: '.code-styler-line-number (direction)' },
  },
  'tok-tokens': {
    purpose:
      'Syntax highlight token spans; both views share the same class names and dark/light palettes (colors taken from Dark+/Light+, not Obsidian theme variables); the Prism original names .token-* are not provided (see limit-prism-tokens).',
    dom: 'Token spans inside code content (a live mark decoration / reading in-card line spans).',
    obsidian: { counterpart: '.token-* (the Prism vocabulary direction) / the .cm-* token family' },
  },
  'reading-code-card': {
    purpose:
      'The reading view card container (the card shell of vsidian-reading-code-block); the language-x class stays on code for routing; the line structure span.vsidian-reading-code-line carries line numbers and tokens; the collapsed block-level modifier hides the pre (the header is kept).',
    dom: 'The reading code block shell (discarded with the DOM when the block unmounts; rebuilt idempotently from the source snapshot on remount).',
    obsidian: { counterpart: '.markdown-preview-view pre (the original mapping is kept in the content domain)' },
  },
  'var-code-card-background': {
    purpose:
      'The code block card background (shared by the header band and the code area; the reading card uses the same source); defaults to var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12)).',
    dom: 'Defined on #app.',
    obsidian: {
      counterpart:
        '--code-background (semantic correspondence; the alias bridge for the content code block variable is promised only to var-reading-code-background)',
    },
  },

  // ---- frontmatter 表格卡片（frontmatter，5 条；#140 Popover 改版）----
  'live-fm-card-line': {
    purpose:
      'Line-level class of the read-only frontmatter table card: when a legal simple header block (scalars + string arrays) is well-formed, it covers every line of the header block (including the opening/closing fence lines and stray lines) and carries the left/right border lines (the row area stays transparent — the contrasting boundary feel comes from the card border and the slightly brighter header strip); the opening/closing fence lines add horizontal rules and corner rounding, assembling a full bordered rounded card. When collapsed, the key-value/item/stray lines together with the closing line are hidden as a whole, and the first line instead carries the -folded modifier to double as the card bottom edge (adding the bottom border and four-corner rounding). Card lines also carry vsidian-frontmatter-line (the alias bridge promises at the direct level that .cm-hmd-frontmatter keeps matching in the well-formed shape; its transparency-lowering side effect is reset by the card rules). Complex types / parse failures degrade the whole card back to the frontmatter-line raw-source shape (see limit-fm-complex-types).',
    states:
      'Persistent card (independent of cursor position — the well-formed state never exposes the raw source, and a cursor entering the header area is guided to just after the closing line); cells are not click-to-edit — editing is funneled into the Popover opened by the header bar Edit button; folding is a view state (zero write-back, not persisted across sessions — a reopened document starts expanded, the same semantics as the code card fold).',
    dom: 'A .cm-line line element in the live view (header block lines).',
    obsidian: { counterpart: '.metadata-container (the Obsidian properties panel direction; the table card shape is vsidian-specific)' },
  },
  'live-fm-row': {
    purpose:
      'Key-value rows of the read-only table card (a two-column grid: key column / value column): no cell borders and no row separators (the row area stays transparent — the contrasting boundary feel comes from the card border and the slightly brighter header strip); the row-level grid spans the full content area (**no width cap** — capping it would misalign the row-level borders with the header row and leave a hole on the right); array host rows carry the list-row modifier (the key type icon takes the list shape ≡) and array item rows carry the item-row modifier (the key column is a dimmed `- ` marker placeholder). The reading side renders the same table rows under the same names (inside the .vsidian-fm-table container, full-width and transparent under the same convention).',
    dom: 'Live: .cm-line line elements (grid rows); reading: divs inside .vsidian-fm-table.',
    obsidian: { counterpart: '.metadata-property (the Obsidian property row direction; the DOM structure differs)' },
  },
  'live-fm-cell': {
    purpose:
      'Cell marks: keys and values (array item text included) map to cells over their source ranges with read-only coloring (cells are not click-to-edit); the key column uses a regular font weight + muted gray (opacity 0.7 — in the reference mock the key is lighter and the value darker) + a leading type icon (::before: scalar T, list shape ≡ for array host rows); sep (the colon and structural spaces) and comment (inline comments) are hidden in the paint layer (display:none, occupying no cell slot); item-mark is a dimmed placeholder in the key column; standalone comment lines are dimmed as a whole line inside the card.',
    dom: 'Live: cell mark spans (source ranges); reading: spans (item-mark/sep/comment are live-only hiding classes).',
    obsidian: { counterpart: '.metadata-property-key / -value (direction)' },
  },
  'live-fm-header': {
    purpose:
      'The card header bar (a replace widget on the opening fence line): a slightly brighter background strip (creating the contrasting boundary feel against the transparent row area) + a list icon + a Properties title (600 weight, secondary-foreground gray) + a rounded outlined Edit button at the top right (pencil icon, highlighted on hover/focus) + a fold chevron at the far right (the same interaction as the code card: the whole header bar is the fold hotspot, excluding the buttons themselves). The cm-widgetBuffers before and after the inline replacement are hidden (the cursor parking spots of the inline replace each take one line of text height, and in the well-formed state the cursor never enters the header area so there are no consumers), pulling the header row height down to about 1.2x the body line height. The Edit button toggles the property-editing Popover; a Popover left open closes automatically when the card is collapsed. The reading side renders the same container, class names and layout (read-only, the Edit button is not emitted; the fold chevron and hotspot are attached by the mount-time decoration).',
    states: 'The header bar is persistent in both views; the Edit button exists only in live and is not emitted while collapsed (the editing entry gives way with the table, the same convention as the code card not emitting the copy button when collapsed); the fold chevron is persistent in both states (rotated -90 when collapsed).',
    dom: 'Live: the content of the replace widget on the opening fence line; reading: the first child of .vsidian-fm-table.',
    obsidian: { counterpart: '.metadata-container heading (direction)' },
  },
  'live-fm-popover': {
    purpose:
      'The property-editing Popover: a small floating layer positioned next to the Edit button (attached to body, fixed positioning computed by JS) with a white background, 10px rounded corners and a distinct shadow; structured editing rows (key/value inputs + a remove button, indented array item input rows, an add-item entry) and a primary Add property button at the bottom right (solid fill in the theme accent color). Focused inputs get a focusBorder outline; invalid key names get a red border marker.',
    states:
      'An interaction-state floating layer (mounted while open, auto-closed by Esc / outside click / degradation) — the container itself is not part of the static probes; open/close and write-back are verified behaviorally by the browser suite; the style entry point (a single low-specificity class) is public for snippet overrides.',
    dom: 'Attached directly to document.body (outside #app, so the rules carry no #app prefix).',
    obsidian: { counterpart: '.metadata-property-editor (the Obsidian property editor overlay direction)' },
  },

  'live-fm-fold': {
    purpose:
      'The fold chevron (the same interaction as the code card fold: a top-right fold button + the whole header bar as the hotspot): clicking collapses/expands the key-value row area — on the live side the block is hidden as a whole (the header line doubles as the card bottom edge), on the reading side the table row area is hidden as a whole (the table shell keeps its border and rounding). Folding is a view state: it never writes the source file and is not persisted across sessions (a reopened document starts expanded); live and reading each hold their own fold state, not shared (the same convention as the code card).',
    states: 'Collapsed/expanded (chevron rotated); while collapsed live does not emit the Edit button and reading rows are display:none.',
    dom: 'The rightmost slot of the header button area (to the right of the Edit button).',
    obsidian: { counterpart: 'The .metadata-container header collapse direction (the Obsidian properties panel is collapsible)' },
  },
  // ---- 限制说明（chrome-limits，4 条）----
  'limit-fm-complex-types': {
    purpose:
      'A boundary of what is supported: the first-version table covers only scalars (strings/numbers/booleans/date strings) and string arrays (block `- item` line groups + single-line flow `[a, b]`; on the live side block items and the flow value box are edited in the Popover, and the reading side renders items split out); complex types and parse failures degrade the whole card to the raw-source shape (the .vsidian-frontmatter-line line class in live, the .vsidian-reading-frontmatter-text escaped block in reading) with editing unrestricted, and the card becomes well-formed again automatically once the header returns to a simple shape; an open Popover closes automatically at the moment of degradation.',
    dom: 'The degraded lines/block (within the frontmatter boundaries).',
    obsidian: { counterpart: 'The Obsidian properties panel shows complex types as source / restricted editing' },
  },
  'limit-prism-tokens': {
    purpose:
      'Syntax highlighting is provided through the stable tok-* vocabulary (see tok-tokens); the Prism original names and the .HyperMD-codeblock-* subclasses are not provided, and snippets targeting them by their original names match nothing.',
    dom: 'Token spans use the tok-* class names.',
    obsidian: { counterpart: '.token-* / .HyperMD-codeblock-*' },
  },
  'limit-katex-internals': {
    purpose:
      'A compatibility boundary of internal rendering structures: the internal DOM produced by KaTeX (glyph spans, the MathML layer, etc.) changes with upstream versions and is not promised as a stable interface — only the stable container shells (.vsidian-math / .vsidian-math-block / .katex-block) are public; snippet coloring that depends on internal classes may stop working after upgrades.',
    dom: 'The KaTeX HTML sits inside the stable containers.',
    obsidian: { counterpart: 'Obsidian likewise does not promise KaTeX internal structures' },
  },
  'limit-mermaid-internals': {
    purpose:
      'A compatibility boundary of internal rendering structures: the internal node classes of the SVG produced by Mermaid change with upstream versions and themes and are not promised as a stable interface — only the container-level entries (.vsidian-mermaid and its svg descendants) are public; the SVG inside the popup shares the same source and boundary. To restyle the inside of a diagram, use mermaid theme configuration instead of snippet selectors.',
    dom: 'The mermaid SVG sits inside the stable container.',
    obsidian: { counterpart: 'Obsidian likewise does not promise mermaid internal structures' },
  },

  // ---- 工具栏与横幅（toolbar-banner，6 条；#4/#5，本项目自有 UI）----
  'suspend-banner': {
    purpose:
      'The write-back conflict suspension banner (vsidian-specific UI): a top-of-view notice while paused + a resume button.',
    states: 'While a write-back conflict has paused writing back.',
    dom: 'A banner at the top of #app.',
    obsidian: { counterpart: 'No counterpart' },
  },
  'toolbar': {
    purpose:
      'The top toolbar of the main editing area: the settings gear (.vsidian-settings-toggle), the quick-action toggle (.vsidian-quick-toggle), the refresh-embedded-resources button (.vsidian-refresh-toggle, the fifth button since #208 with its own entry), the dual-state view toggle (.vsidian-view-toggle, the fourth button since #141 with its own entry) and the sidebar toggle (.vsidian-sidebar-toggle) — since #38 the three-state switch (including source mode) lives in the host editor title bar commands, not on this toolbar (see the mode-toggle removal record).',
    dom: 'The toolbar at the top of #app.',
    obsidian: { counterpart: 'No counterpart' },
  },
  'view-toggle': {
    purpose:
      'The dual-state view toggle button (#141): one of the entries for switching between live↔reading (the in-webview entry besides the host title bar three-state command and Ctrl+Q). The icons show the current mode: a book (currently reading) / a pen (currently live) — both icons stay in the DOM permanently, and their show/hide has a single source: the body mode class rules (see the mode-body entry) — when styles fail, both icons show at once, which paint assertions can expose.',
    states:
      'The button itself is persistent in both modes; a click posts a view.switch.request outbound (not applied locally), and the button state is driven by the view.mode.set flowed back from the host — the aria/tooltip names the target action and re-words as the mode changes.',
    dom:
      'A button inside the top .vsidian-toolbar, immediately to the left of the sidebar toggle; since #158 it forms the right-end group with the sidebar toggle, and since #208 the refresh button joins the group and takes over the margin-left:auto push rule (this button no longer holds it — see the toolbar-refresh entry for the handover record); a flexible gap remains toward the left group (settings, quick actions); an inline SVG with two paths (book/edit subclasses).',
    obsidian: { counterpart: 'No counterpart' },
  },
  'toolbar-refresh': {
    purpose:
      'The refresh-embedded-resources button (#208): the manual refresh entry — a click posts a refresh.request outbound; the host drops the image resolution cache, bumps the resource generation and replies with the invalidation notice, after which the webview remounts every active image slot for re-resolution (reloading with the new-generation URI) and resets the Mermaid lazy-load failure terminal state. Refreshing never touches the document content/undo stack/view state (cursor, scroll and mode stay as they were), and the keybinding entry shares the same send implementation.',
    states:
      'Persistent in both modes; before readiness (before init) a click is a no-op. The #158 push rule (margin-left:auto) moved from view-toggle to this button in #208 — head of the right-end group (refresh + dual-state toggle + sidebar toggle, adjacent), with a flexible gap toward the left group.',
    dom:
      'A button inside the top .vsidian-toolbar, immediately to the left of the dual-state view toggle; an inline SVG circular arrow (lucide refresh-cw motif, four paths, constant stroke-width=2, no icon library).',
    obsidian: { counterpart: 'No counterpart' },
  },
  // #360 T11 add-on UI contribution mount points (platform-owned containers;
  // add-on button/panel content styling belongs to the add-on)
  'addon-toolbar-slot': {
    purpose:
      'Add-on toolbar button slot (#360 T11): the only legal mount point for Vsidian add-ons adding their own toolbar buttons — the platform constructs and owns the container; an add-on can only add its own buttons into the slot and never takes over kernel containers or built-in button positions. Button base shape reuses the toolbar button structural selector (transparent background / hover highlight); text content (iconText/label) widens the box.',
    states:
      'Persistent container DOM (empty state collapses via :empty — zero footprint with no registrations); buttons mount on add-on registration, unmount/remount with the declared mode, and are recycled wholesale when the add-on is disabled or faults. The button display text defaults to the registered label; iconText overrides it.',
    dom:
      'A div inside the top .vsidian-toolbar, at the tail of the left group (after quick actions) and before the right-end group head refresh button (which owns the margin-left:auto push rule).',
    obsidian: { counterpart: 'No counterpart (the Obsidian plugin ribbon is a separate bar; this slot is an in-toolbar group)' },
  },
  'addon-panel-dock': {
    purpose:
      'Add-on panel dock (#360 T11): the only legal host container for add-on panels — panel chrome (header/title/close button) and dock styling belong to the platform, while the content root (.vsidian-addon-panel-root) interior styling belongs to the add-on (managed via its loaded stylesheets). Kernel containers or the whole editor are never handed to authors; locate a specific panel via [data-addon-panel="<addonId>.<localId>"].',
    states:
      'Persistent dock DOM (empty state collapses via :empty); panels default to closed, toggled by the add-on open() or the user close button; closing a panel removes its container and detaches the content root (late writes by the add-on stay invisible); a panel whose declared mode excludes the current mode is force-closed.',
    dom:
      'At the tail of the main editor area .vsidian-main (after the content containers); each panel section holds a header (title span + close button) and a body (scroll container, max-height constrained) whose child is the add-on content root div.',
    obsidian: { counterpart: 'No counterpart (Obsidian has no in-webview add-on panel dock)' },
  },
  'skeleton': {
    purpose:
      'Loading skeleton overlay for the editor initial open (#292): rendered with the initial HTML immediately, covering both the script-load and content-ready windows; after mount it is re-parented as an overlay inside the main editor area below the toolbar, and removed after the first content frame following the shimmer cycle-completion rule. Default background follows the editor background variable; the skeleton never intercepts pointer events.',
    states:
      'Present only during the load window: covers #app fully before mount, content area only after mount (the host class .vsidian-skeleton-host provides the positioning context and is removed on dismissal); gone after removal.',
    dom:
      'Direct child of #app in the initial HTML (single instance, stable id vsidian-skeleton); after mount moved to the end of .vsidian-main (vsidian-skeleton-host state) — never inside a view container (the reading virtualizer manages container children per block, see docs/specs/skeleton-screen.md).',
    obsidian: { counterpart: 'No counterpart' },
  },
  'skeleton-block': {
    purpose:
      'Skeleton gray bars and shimmer animation (#292): a generic fixed form (no document content is read, no line-number gutter simulated); both the bar fill and the shimmer highlight derive from the editor foreground color via low-ratio color-mix (adapts to light/dark themes); the shimmer starts after a start delay and loops, and removal waits for the current cycle to finish — delay/cycle constants are shared with the exit planner (shared/skeletonTiming).',
    states:
      'The shimmer is disabled under prefers-reduced-motion: reduce (static bars); it starts only after the start delay (default 300ms), so instantly-loaded documents never show it.',
    dom:
      'Direct div sequence of .vsidian-skeleton > .vsidian-skeleton-column; the column width consumes --vsidian-live-preview-max-width (same source as the content column; full-bleed at the 0 setting), with horizontal padding sharing the content baseline variable (--vsidian-content-padding-inline).',
    obsidian: { counterpart: 'No counterpart' },
  },
  'skeleton-column': {
    purpose:
      'Skeleton column box (#292): hosts the skeleton bar sequence; its max-width consumes --vsidian-live-preview-max-width (same source as the content column, no copied values) and its horizontal padding shares the content baseline variable (--vsidian-content-padding-inline) — the customization point for user snippets targeting the loading-time column width.',
    states:
      'Present only during the load window, gone after removal; at the full-bleed setting (0) it fills the available width as the variable falls back to none.',
    dom:
      'The only child of .vsidian-skeleton; its direct children are the .vsidian-skeleton-block sequence (see the skeleton-block entry).',
    obsidian: { counterpart: 'No counterpart' },
  },
  'mode-body': {
    purpose:
      'The webview-wide mode anchor (#141): a mutually exclusive class pair that switches with the view mode on the layout root div (.vsidian-body inside #app, not the HTML body element — the class pair is not attached to <body>), serving as the public entry for user snippets styling "per mode" (e.g. #app .vsidian-body.vsidian-mode-reading .vsidian-toolbar button { … }). Built-in consumer: the show/hide rules of the view toggle book/edit icons take it as their single source.',
    states:
      'Mode-state classes: the live view carries .vsidian-mode-live and the reading view .vsidian-mode-reading, recomputed by applyModeDom on every mode switch.',
    dom:
      'The classList of the layout root div inside #app (.vsidian-body, the horizontal layout root); not on the HTML body element or any specific control.',
    obsidian: { counterpart: 'No counterpart (Obsidian expresses this through container-state classes such as mod-cm6; the original name is not promised to match)' },
  },
  'mode-toggle': {
    purpose:
      'Formerly the mode toggle button group on the toolbar. Since #38 (commit 288044d, 2026-09-24) mode switching moved to the host editor title bar three-state commands and the toolbar no longer renders this class; the entry is kept as the correction record for a stale row of the old mapping table — the class has never existed in the DOM of any released build since v0.1.0 (verified: git grep v0.4.0 -- src/ has zero hits).',
    dom: 'None (the class is no longer emitted).',
    obsidian: { counterpart: 'No counterpart' },
    removed:
      'Removed by #38 (2026-09-24, 288044d) and never present in any released build; the old mapping table row was stale data (corrected during the #133 verification against the v0.4.0 tag 75c3df7 source).',
  },

  // ---- 正文右键菜单（context-menu，1 条；#183 统一内核）----
  'context-menu': {
    purpose:
      'The unified context-menu overlay (#183 takes over the whole live body): a self-drawn fixed-position menu attached to body. Three cluster separators (-separator), cascading submenus (-submenu; shown/hidden via :hover/:focus-within + the parent-item click fallback class vsidian-menu-open + the assembly-time left flip vsidian-menu-flip when the right edge would clip), the icon slot (-icon driven by data-icon through a mask; since #184 the 26 wired icon keys define light/dark assets via --vsidian-context-icon, spare keys keep assets on disk but stay unwired), text badges (-badge, H1-H6), checkmarks (-check, paragraph-style items lit per line structure), disabled greying, danger red text, and the shortcut hint column (-hint, right-aligned small text at lowered opacity, no placeholder when unbound). Menu items are keyboard-accessible buttons; colors follow the --vscode-menu-* variable family (same visual language family as the outline menu). The former blockMenu (#162, .vsidian-block-menu*) is retired and folded in — that class name never existed in any released build (zero hits in the v0.5.0 tag), so there is no compatibility obligation and the contract keeps no entry for it.',
    states:
      'Right-clicking the live body (empty lines, plain text, table rows, inside fences and graphic blocks are all intercepted; the frontmatter header area and reading mode are not — the native menu behaves as usual). Write commands are greyed out in structure-sensitive areas (the safe-degradation matrix).',
    dom: 'A direct child of document.body (viewport-fixed positioning); submenus are nested inside their parent item host (absolute).',
    obsidian: { counterpart: 'None (the Obsidian context menu is an app-native menu, not a DOM element)' },
  },

  // ---- 反链面板（backlinks，4 条；#197 + 形态改版批次）----
  'backlink-panel': {
    purpose:
      'The backlinks panel (#197, reworked in the panel-rework batch): backlinks of the current note grouped by source file — a group header (chevron + source name + count, collapsible) above white context cards (card body is the quoting line; the raw Markdown syntax of the matched link is highlighted as a whole, see the backlink-hit entry); a page header shows the panel title plus the card count; four-state placeholders (loading/empty/error/no-match) and the updating strip share the container. The visibility switch is the vsidian-backlinks-active class on the sidebar container (mutually exclusive with the outline and outlinks panels).',
    states:
      'The panel DOM is persistent in the sidebar (.vsidian-sidebar-panel), display:none by default; visible when the sidebar is expanded and the panel is active. Items are dynamic data (driven by host index snapshots); the four states follow the latest backlinks.snapshot; group collapsing is expressed by the group-collapsed class (card area hidden, header kept).',
    dom: 'In the sidebar panel area: vsidian-backlink-panel container > persistent area (updating strip (optional) + toolbar (see the backlink-toolbar entry) + search box) + dynamic area (sort menu (when open) + header (title + count) + groups (group-header buttons + card buttons) or a placeholder). Persistent-area nodes are reused across renders (the search input keeps focus).',
    obsidian: { counterpart: 'None (the Obsidian backlinks pane is app-level DOM)' },
  },
  'backlink-toolbar': {
    purpose:
      'The backlinks panel toolbar (panel-rework batch): four linear icon buttons centered in a row — sort (a six-item, three-group dropdown with the current item checked; closes on Esc/outside click), search (toggles the full-width search box below the buttons), collapse all (two-state, aria-pressed) and more context (short/long snippet toggle, aria-pressed). Active buttons carry the selection background; the sort menu is an absolutely positioned layer inside the panel.',
    states:
      'Visible when ready with items (not rendered for loading/error/empty documents); the four buttons track view state via aria-pressed/expanded; the search box visibility switch is the hidden attribute; the menu mounts only while open (a dynamic state, so the probe table does not fake a static assertion for it).',
    dom: 'Persistent area of vsidian-backlink-panel: a role=toolbar container with four buttons (inline 16-unit SVG icons); the search box follows; the menu (when open) heads the dynamic area (the panel container is its absolute anchor).',
    obsidian: { counterpart: 'None (the Obsidian backlinks pane is app-level DOM with no such class names)' },
  },
  'backlink-hit': {
    purpose:
      'Backlink card match highlight (panel-rework batch): the raw Markdown syntax of the matched link ([...](...) or [[...]] including brackets and URL) inside a card is marked with a yellow background — light themes use #ffec99, dark/high-contrast themes use a readable yellow (about 30% yellow overlay; the text color inside the highlight is unchanged with no underline). The variable is public and can be overridden by external snippets.',
    states: 'Defined permanently on #app; light/dark values switch with body.vscode-dark / body.vscode-high-contrast.',
    dom: 'A custom property of #app; consumed by mark.vsidian-backlink-hit inside backlink cards (dynamic data, so the probe table does not fake per-item static assertions — the color rule is pinned by contract tests).',
    obsidian: { counterpart: 'None (the Obsidian search-match highlight is app-internal styling)' },
  },
  'backlinks-toggle': {
    purpose:
      'The sidebar toolbar button toggling the backlinks panel (same row as the outline and outlinks buttons): clicking toggles the panel (three-way mutual exclusion); the active-state highlight follows --vscode-list-activeSelectionBackground.',
    states: 'Visible when the sidebar is expanded; aria-expanded tracks the panel active state.',
    dom: 'A button plus a chain-link SVG icon (interlocked double loop with a left-returning arrow, 24-unit viewBox; stroke width pinned via CSS) inside .vsidian-sidebar-toolbar-actions.',
    obsidian: { counterpart: 'None (the Obsidian backlinks toggle is app-level UI)' },
  },

  // ---- 出链面板（outlinks，2 条；出链面板批次）----
  'outlink-panel': {
    purpose:
      'The outgoing links panel (outlinks batch): a flat list of links in the current note — a page header (title + muted count at the top right) plus two-line items (line 1: a small chain icon + target display name; line 2: the target path with hanging indent); clicking opens the target and locates the actual anchor of the link; broken-link items are globally muted (broken class + disabled) and not clickable; external-scheme edges never enter the panel. The visibility switch is the vsidian-outlinks-active class on the sidebar container (mutually exclusive with the outline and backlinks panels).',
    states:
      'The panel DOM is persistent in the sidebar, display:none by default; visible when the sidebar is expanded and the panel is active. Items are dynamic data (driven by host outlinks.snapshot); the four states mirror the backlinks panel.',
    dom: 'In the sidebar panel area: vsidian-outlink-panel container > updating strip (optional) + outlink-header (title + count) + outlink-item buttons (item-name (with an inline 16-unit chain SVG) + item-path) or a placeholder.',
    obsidian: { counterpart: 'None (the Obsidian outgoing-links pane is app-level DOM)' },
  },
  'outlinks-toggle': {
    purpose:
      'The sidebar toolbar button toggling the outgoing links panel (same row as the outline and backlinks buttons): clicking toggles the panel (three-way mutual exclusion); the active-state highlight follows --vscode-list-activeSelectionBackground.',
    states: 'Visible when the sidebar is expanded; aria-expanded tracks the panel active state.',
    dom: 'A button plus a chain-link SVG icon (interlocked double loop with a right-going arrow, 24-unit viewBox; stroke width pinned via CSS) inside .vsidian-sidebar-toolbar-actions.',
    obsidian: { counterpart: 'None (the Obsidian outgoing-links toggle is app-level UI)' },
  },

  // ---- 悬停预览（hover-preview，#218 起；#220 增 hover-fm-section）----
  'hover-popup': {
    purpose:
      'The hover document preview popup (first closing loop of phase one, #218): hover a wikilink or local Markdown link in the parent reading view, and the target is read through the document-access channel and shown as read-only reading content. Since #221 the same popup serves all entry points: the live-preview body (Ctrl+hover by default, direct hover once the hover.liveDirect setting is on) and backlink/outgoing-link panel entries (direct hover). Default width 480px / max height 400px (in small viewports a JS geometry plan flips at the four edges and shrinks to fit); the content is read-only — task checkboxes are disabled (JS disabled + pointer-events double safety), with no write-back channel at all. Since #220 the popup carries the target document (B) as reading content: images resolve relative to B (the sourceDocUri channel), links are clickable for navigation, and code blocks get plain syntax highlighting. Since #245, line-owning embeds inside B expand into read-only cards using the same depth and budget as body cards; a child card at its scroll boundary hands the wheel to the popup, and asynchronous height changes reposition it using natural content height. Only one hover popup exists throughout. #217 acceptance follow-up: a header bar shared with the embed cards — the target display name (spec.target) stays constant regardless of the result payload, and the top-right open button dispatches to the existing activation message family by target shape (wikilink/plain-link sent directly; panel shapes go through an openAction closure along the same channel as the entry click); clicking closes the popup as a context switch. Since P2-06 (#283) the popup root reference supports internal Live: it follows the root panel mode by default and can be switched manually (remembered per reference position within the panel session); the header gains a save-target / mode-toggle / close-editing action group plus an unsaved dot (`·`) right after the display name (present while target B is dirty, warning color — same semantics as the embed cards in P2-04), and the scroll area carries a parallel internal-Live editor container (height capped by the geometry plan; scrolling is handled by CM6\'s own scroller). A dirty internal Live resists the normal dismiss conditions (leave, outside click, blur — Q18); a clean one keeps the normal hover rules, and explicit close reuses the embed ref-close-dialog three-way confirmation.',
    states:
      'An interaction-state floating layer (mounted after the hover open delay, dismissed by leaving the joint anchor/popup domain after a close delay, Esc, parent scroll, or mode switch; since #221 a keyboard-command open moves focus into the popup with a :focus-visible outline, and while focus stays inside the popup it is not dismissed by the mouse leaving; since P2-06 an internal Live whose target is dirty resists the normal dismiss conditions — leaving, outside clicks and blur do not destroy it, and the normal rules resume once it is clean again) — the container itself is not part of the static probes; open/close, keep-alive and painting are verified behaviorally by the browser hoverPreview / hoverEntry / hoverLive suites; the style entry point (a single low-specificity class) is public for snippet overrides. P2-06 internal modes: internal Reading (default content view, no write port; the dot and the save/close entries are absent) / internal Live (editor container present, content view hidden; the dot and save entry are visible while the target is dirty; a paused session shows an inline state notice). #343 (P3-11) web dual shape: card (the #342 card) / page (for https addresses the precheck did not reject, a cross-origin sandboxed iframe — sandbox limited to allow-scripts, referrer no-referrer, a fixed 320px viewport scrolling its own content; an honest cannot-confirm note sits below; 2026-10-05 acceptance rework: the back-to-card button moved from an in-view toolbar into the header action group — an icon button in the slot one left of the mode toggle, shown only in the page shape (always assembled, its visibility flipping with the iframe view mounting/destruction), with the old toolbar and in-view text button removed; a known refusal (X-Frame-Options/frame-ancestors) or HTTP mixed content falls back to the card automatically with a theme-error-colored reason line; manual/automatic fallback and close/target-change/switch-off/shape-change all destroy the iframe (removing the element aborts the load; the message bridge is an allow list where only host-origin messages pass and subframe messages are rejected unconditionally, so no per-iframe registration exists), and the user shape setting is never rewritten).',
    dom: 'Since #220 attached directly inside #app (previously on body; fixed positioning is unaffected by the #app layout) — the #app theme variables, the `#app .vsidian-view-reading …` content styles, and enabled CSS snippets (the container class carries the .markdown-preview-view alias bridge) therefore match naturally, without duplicating a second theme environment for the popup. The inner reading container carries .vsidian-view-reading. The header bar (target display name plus open button) lists its rules together with the embed-card header selectors (popup selector first, embed selector last). Since P2-06 the action-group buttons are real <button type="button"> elements (save/mode-toggle/close-editing take aria-label and tooltip via the i18n entries embed.saveTarget / embed.modeToLive / embed.modeToReading / embed.closeEditor, tooltips carried by data-tooltip; inline SVG icons aria-hidden, 16-grid stroke currentColor), the dot is a <span> (aria-label embed.dirtyDot), and their rules are listed alongside the embed-card header ones (popup selector first); the 2026-10-05 acceptance rework adds a fourth back-to-card button of the same spec (a hook-arrow glyph, aria-label and tooltip reusing the hover.webFallbackToCard entry, DOM order [save][back][mode][close][open] — shown only in the page shape, independent of the root session).',
    obsidian: { counterpart: '.hover-popover (the Obsidian page-preview popover direction; the internal structure is closed-source and not promised)' },
  },
  'hover-pdf-view': {
    purpose:
      'The read-only PDF reading view (hover first closing loop, #337 / P3-05; full-document page scrolling and body embeds, #338 / P3-06): when hovering a wikilink or plain link that targets a local PDF, or embedding ![[file.pdf]] in the note body (standalone line / mixed run / list / quote / table cell / recursive — the same card-shell path), a PDF rendering container sits inside the host scroll area. Since #338 it is a per-page canvas pool plus spacer virtualization: the full-document model (page-height table — estimated at load, backfilled on render) stays separate from resident DOM/canvases, and only visible pages plus a bounded neighbor window keep canvases (window mounting is constrained by the PDF_SCROLL_LIMITS budget and caps — cost does not grow linearly with total page count); page-turn operations interoperate with scroll positioning (keybindings unbound by default, read-only — never modifying any document); multiple occurrences of the same URI share one document store while keeping their scrolling and lifecycles independent. Error states (corrupt / encrypted / first-time out-of-range page / resource failure) go through the existing state lines (the popup .vsidian-hover-popup-state / the card state line, with the error modifier); this container carries only the successfully painted state. Since #339 (P3-07) the basic reading interactions are complete: fit-to-container-width by default (zoom=1), a user zoom multiplier (keybindings pdfZoomIn/pdfZoomOut/pdfZoomReset, unbound by default, read-only) applied on top of the width-fitted scale, clamped by the PDF_RENDER_MAX_SCALE (2.5) hard cap and narrowed by the canvas budget — operations at the caps are silently inert; zoom and container-width changes recompute the height model and repaint all mounted pages (old canvases/text layers/link layers are recycled with no stale remains). The text layer is the pdf.js TextLayer: transparent spans aligned with the painted glyphs carry native selection and copy (Chinese and English alike; the selection background is themed), scanned pages or failed extraction leave no span (nothing pretend-copyable); the link layer consumes getAnnotations — same-document jumps navigate in place, http(s) external links go through the link.activate host channel only on explicit clicks (elements carry no href — no navigable surface, no automatic external-link preview requests), and named actions / attachments / disallowed protocols (file/javascript/ftp/mailto/tel) are all disabled states (aria-disabled + title hint, zero action on click).',
    states:
      'Loading (zero-height spacer/page placeholders, loading text on the state line) / painted (in-window page placeholders carrying actual canvas sizes, the spacer opening the full-document height, and the page-info line sticky at the bottom of the scroll area reporting the current visible page) / error (canvas zeroed, error text on the state line) / invalidated withdrawal (when the target is deleted/stale the old pages are withdrawn — canvases and page placeholders cleared, the spacer zeroed, the view skeleton kept for recovery reload). Zoomed (zoom is not 1: when the page body is wider than the content width the host scroll area scrolls horizontally, and the safe-center placeholder keeps both overflow ends reachable; the page-info line feeds back the achieved percent). Link-layer disabled state (disallowed protocol / unsupported action / unresolvable target: cursor not-allowed + title hint). An interaction-state container — not part of the static probes; paint-level visibility is asserted by browser and integration tests on actual canvas pixels (not DOM presence); text-layer alignment is pinned by paint-level assertions mapping span rects onto canvas ink.',
    dom: 'In the popup it is attached inside the #app popup scroll area (.vsidian-hover-popup-scroll); in embed cards inside the card scroll area (.vsidian-embed-card-scroll) — both in parallel with the reading container (in PDF form the reading/live containers are hidden by the render layer). The spacer and page placeholders are <div> elements (heights written by the renderer from the page-height table); placeholder centering is justify-content: safe center — plain center clips both ends equally on zoom overflow); inside each placeholder sits the .vsidian-hover-pdf-body wrapper <div> (position: relative, shrink-wrapped to the canvas display box — the shared coordinate system for text-layer percentage positioning and link-layer absolute positioning), which contains in turn the canvas (a native <canvas>, width/height from the fitted scale times the zoom multiplier, capped at 2.5; no max-width — the painted surface is the display surface, zoom overflow scrolls horizontally in the host scroll area), the text layer <div> (absolute inset 0; --total-scale-factor inlined by the renderer from the paint scale, --min-font-size written by TextLayer; absolutely-positioned transparent spans inside — the variable family mirrors the official pdf.js textLayer styles) and link-layer elements (one per Link annotation, absolute rects written from the viewport transform; no href — internal targets navigate in place on click, http(s) goes through the callback channel, disabled entries add the link-disabled class and aria-disabled); the page-info line is a <div> (sticky bottom fixed) whose text comes from the i18n entry hover.pdfPageInfo (hover.pdfPageInfoZoom with the percent when zoomed); link-disable hints come from hover.pdfLinkExternalOnly / hover.pdfLinkUnsupported / hover.pdfLinkUnresolved.',
    obsidian: { counterpart: 'None (the PDF presentation of the Obsidian page-preview popover is closed-source and not promised)' },
  },
  'hover-text-view': {
    purpose:
      'The readable-text hover view (#340 / P3-08): when hovering a wikilink that points to a code/config text attachment, the popup content area renders an editor-like read-only presentation — a line-number gutter, layered token coloring (the syntax layer paints first, the semantic layer overlays per character range once it arrives — the same stacking as the native editor), and language-scoped font family/size/ligatures (carried by the payload, falling back to the editor default variable family when absent). Fixed-height virtualization: only visible lines plus a buffer are mounted, keeping the full-text model separate from resident DOM (the #341 embed reuses the same view). Read-only boundary: no input port at all (selection/copy uses the browser-native text selection, and the gutter is user-select:none so copies never sweep line numbers); with a #range hard window, out-of-range lines never enter the payload (structurally unreachable by scrolling). Zero new public CSS variables — colors all follow theme variables or inline token values (computed by the host appearance service). Horizontal scrolling belongs to the host scroll area (2026-10-05 acceptance rework): the code area no longer scrolls by itself — long-line overflow is carried by the popup scrollEl / the embed-card scroll area, so the horizontal scrollbar sits at the viewport bottom edge (the same semantics as the native editor; previously the code area had overflow-x:auto while the view box is as tall as the full text, leaving the bar glued to the end of the content flow, visible only after scrolling to the bottom), and the line-number gutter is sticky-pinned to the viewport left edge with an opaque background masking the text sliding underneath.',
    states:
      'The text shape of the hover popup content state (Markdown result payloads never pass through this view); since #341 (P3-09) the embed-card content state takes the same shape (text loads are permanently read-only — the mode button is hidden, zero edit ports); the gutter can be hidden by the effective editor.lineNumbers value (gutter display:none). Horizontal scrolling appears on the host scroll area only when long lines overflow (a popup/card-level bar, with the gutter pinned left).',
    dom: 'Attached inside the popup .vsidian-hover-popup-scroll content container (mutually exclusive with the Markdown reading container — the virtual reading view is released once text content takes over the mount); since #341 the same view is also attached inside embed-card content areas (the Reading container inside .vsidian-embed-card — container-agnostic across standalone lines, promoted mixed hosts, table cells and Live widgets, with no per-container copy of the view implementation); line elements use white-space:pre with heights computed from the language-scoped font size × a 1.5 line-height factor, and the window layer shifts via translateY; the gutter is position:sticky left:0 (pinned to the viewport left edge while scrolling horizontally, z-index:1 with an editor-background mask covering the sliding text).',
    obsidian: { counterpart: '.hover-popover reading of code files (no standalone class-name promise in Obsidian)' },
  },
  'hover-fm-section': {
    purpose:
      'The note-properties section of referenced reading content (introduced by the #220 hover popup; shared with the #222 embed cards via the common assembly in refReadingContent — selectors list both the .vsidian-hover-popup and .vsidian-embed-card scopes): shown for full-document references only — collapsed by default, the whole header row is the hover hot zone (hovering it or focusing the button reveals the toggle button; hovering never auto-expands), and clicking the button toggles expansion. The expanded state persists for the current open (rebuilds caused by target-content changes do not reset it); reopening the popup restores collapsed, and an embed card keeps it per instance state (viewport recycling does not clear it). A well-formed frontmatter reuses the reading-side header and key-value rows (presentation and type/degradation boundaries follow the frontmatterTable rules, not widened); the degraded form synthesizes a structurally identical header and keeps the escaped raw source (hidden while collapsed). Section/block references and documents without frontmatter show no properties section; there is no add/delete/edit or task-check write-back entry at all. The main reading view properties presentation is unaffected.',
    states:
      'Collapsed (default, vsidian-hover-fm-collapsed — property rows and the degraded source block get display:none, the header row stays) / expanded (modifier removed); the button is opacity:0 + pointer-events:none by default (no wholesale hiding declarations — Tab reachability is preserved), shown and pointer-enabled on header :hover or button :focus-visible; the chevron points down when expanded and rotates -90° (rightward) when collapsed. Internal structure of an interaction-state popup — not part of the static probes; collapse/hot-zone/keyboard interactions and light/dark-theme visibility are verified behaviorally by the browser hoverPreview suite.',
    dom: 'Attached to the frontmatter block (.vsidian-reading-frontmatter) inside the #app popup (.vsidian-hover-popup); the toggle is a real <button type="button"> (Enter/Space activate natively), with aria-expanded following the state and aria-label/title from the i18n entries (hover.content.fmExpand/fmCollapse).',
    obsidian: { counterpart: '.metadata-container and .collapse-indicator (the Obsidian properties-collapse direction; the internal structure is closed-source and not promised)' },
  },

  // ---- #222 Reading 正文嵌入（embed cards）----
  'reading-embed-card': {
    purpose:
      'The in-flow embed card (created for the reading view in #222, mounted identically in the live view since #223 — both containers share the same card assembly and state store): a line-owning ![[…]] is replaced by a reference card — visually aligned with the reading prose (#217 acceptance feedback: only the left accent bar remains; no fill, no full border, no rounding — white background with square corners, the same direction as an in-prose quote block), the file name on top (the target root-relative path once loaded), and an open-target entry at the top right (reusing the existing Vsidian open behavior, never editing the embed source; an inline SVG icon stroked with currentColor so it inherits --vscode-icon-foreground — added by the #217 acceptance feedback, the button used to be an invisible empty shell). The content is a read-only reading view of the target (full document/section/block, loaded through the hover document-access channel); short content keeps its natural height while longer content scrolls internally, capped at 480px by default and adjustable via the embed.maxHeight setting (the inline max-height takes precedence over the rule default). The card lives in the #app content flow — theme variables and CSS snippets match through nesting, and the .markdown-embed alias on the card shell lets embed-container rules match as well. For the live-side mount forms and source reveal, see live-embed-widget (inside the live host the card shell margin is zeroed and spacing is carried by the host padding — the height-accounting semantics). Since P2-04 (#281) the card supports an internal live editor: the header gains a right-hand action group (save target / toggle internal mode / open target, icon buttons sharing the same button rules) and a dirty dot right after the file name (the `·` character, present while the target has unsaved changes, in the theme warning color), and the scroll area gains a sibling .vsidian-embed-card-live editor container (present in the internal live state, capped by the same inline max-height with scrolling carried by the CM6 scroller itself); the default internal mode follows the direct parent view (unless manually overridden), and the internal reading state remains a read-only content view (no write port). Since P2-05 (#282) the header also carries a close-editing entry (visible while an internal live port is attached): explicit exits uniformly check the target B\'s latest authoritative state — a dirty target opens the ref-close-dialog three-action confirmation, a clean target simply switches back to reading.',
    states:
      'Loading (a state line with the i18n text, content area hidden) / loaded (the content scroll area present, task checkboxes disabled, the properties section collapsed by default) / a failure state (the state line shows the localized error text in place, no host notification). On viewport recycling (reading) and decoration teardown (live) the card DOM and the target content view are released while the properties expansion and scroll position are kept (restored on remount); within the parent session the loaded content is cached and never re-requested; live↔reading mode switches share the same per-instance state (the semantic key is the embed line start plus the raw target). P2-04 internal modes: internal reading (the default — the content view, no write port; the dirty dot and save entry are absent) / internal live (the editor container present, the content view hidden; the dirty dot and save entry visible while the target is dirty; a paused editing state shows an in-place state-line note). P2-05 (#282): the close-editing entry is present in the internal live state (hidden once the port is released); an explicit close against a dirty target opens the ref-close-dialog modal, and a clean target switches straight back to reading.',
    dom: 'Reading: inside the reading-view embed block (.vsidian-reading-embed, with data-vsidian-embed-inner carrying the raw target). Live (#223): inside a .vsidian-live-embed host widget (hidden form = a block-level whole-line replacement, revealed form = a below-line block widget). The card shell .vsidian-embed-card also carries the .markdown-embed alias (same-source table in obsidianAlias); the content area is a nested .vsidian-view-reading container; the open entry is a real <button type="button"> (aria-label from the i18n entry embed.openTarget; the inline SVG icon is aria-hidden, 16-grid, stroked with currentColor — added by the #217 acceptance feedback). P2-04: the save and mode-toggle entries are the same kind of real <button> (aria-label and tooltip from the i18n entries embed.saveTarget / embed.modeToLive / embed.modeToReading, tooltips carried by data-tooltip); the dirty dot is a <span> (aria-label embed.dirtyDot). P2-05: the close-editing entry is the same kind of real <button> (i18n entry embed.closeEditor, an X-shaped inline SVG, tooltip carried by data-tooltip).',
    obsidian: { counterpart: '.markdown-embed (the Obsidian reading embed container)' },
  },
  'ref-close-dialog': {
    purpose:
      'P2-05 (#282) explicit-close confirmation modal for reference editing: plugin-controlled exit intents (the embed card header close button, Esc inside the embed editor, and the interception of deleting an active reference line) uniformly check the target B\'s latest authoritative state; a dirty target opens this self-drawn three-action dialog — "Save and close" (TextDocument.save; a failure keeps the scene), "Discard changes and close" (the P2-01-verified activate-B + argument-less revert document-level rollback that restores the entire B including unsaved changes from other views), and "Cancel" (the default focus; the scene is kept and a delete intent never completes the deletion in A). The confirmation text spells out the B file name and the document-level discard impact; if B changes while the dialog is open, a re-confirmation is required (a stale notice line plus a fresh baseline, with a version guard on the host side as the second line of defense). Closing a clean target, mode switches and offscreen recycling never open this modal. Self-drawn presentation (role=dialog + aria-modal + Esc cancels), never window.alert; theme variables come from the public VSCode families (backdrop editorWidget-editableBackground / box editor-background + panel-border / save & cancel button family / discard button-secondary family / notice editorWarning left bar), so themes and CSS snippets follow the host appearance. The upcoming hover popup (P2-06) reuses the same target operation and this modal.',
    states:
      'Absent (the default — no exit intent or a clean target) / open (the three action buttons plus the file name and discard-impact notes, focus defaults to cancel) / re-confirm (the target changed while confirming: the -notice line present with the warning left bar, the confirmation baseline refreshed) / action failure keeping the scene (save-failed / discard-failed: the -notice line present, the modal stays open).',
    dom: 'A direct child of body: .vsidian-ref-close-backdrop (a fixed full-screen overlay, z-index above the hover popup and the image popup — modal blocking) containing .vsidian-ref-close-dialog; the title and notes are divs; the three actions are real <button type="button"> elements (labels from the i18n entries embed.closeCancel / embed.closeSave / embed.closeDiscard); the notice line is a div (text from embed.closeStale / embed.closeSaveFailed / embed.closeDiscardFailed, display:none by default). Keyboard semantics: Esc on the modal cancels; Enter lands on the default focus (cancel).',
    obsidian: { counterpart: 'No direct counterpart (Obsidian uses the native host save-confirmation dialog; this project draws its own modal).' },
  },
  'embed-conflict-choices': {
    purpose:
      'P2-12 (#289) write-conflict three choices: when an internal live editor is paused because writing back is unsafe (an external interleaved edit overwrote the requested range, and so on), the paused scene (the state line) shows "Compare and Resolve / Discard Current Version / Cancel" in place — the compare hover text is the user-specified wording "Resolve the conflict in a diff view between the temporary copy and the conflicting version" (carried by data-tooltip, word for word). The three actions: compare sends out the full snapshot of the current input, and the host creates an untitled temporary copy and opens the native VSCode diff (left = the temporary copy, right = the real B; the P2-01 §6 verified route — the diff view belongs to the host and the extension builds no resolution UI of its own); after a successful handoff a sync.request resyncs and lifts the pause (the old uncommitted queue is never replayed). Discard drops only the input that failed to write this time and resyncs B (never a document-level rollback of the whole B — modeled separately from the P2-05 discard). Cancel collapses the choices while keeping the pause and the input (a single -reopen button re-expands them). Non-modal presentation (reading the embedded content stays possible; never window.alert); a failure (the -notice line with the warning left bar) keeps the scene and can be retried. Theme variables come from the public VSCode families (compare as the primary button family / the others button-secondary / in-flight disabled opacity / focus-visible outline / notice editorWarning left bar), so themes and CSS snippets follow the host appearance.',
    states:
      'Absent (the default — not a conflict pause; normal editing, loading and failure states never show the choice bar) / expanded (the paused note plus the three buttons; compare disabled in flight — reduced opacity) / collapsed (after cancel: only the -reopen entry remains, the pause and input kept) / failure keeping the scene (the -notice line present plus the three buttons, retryable) / pause lifted (when doc.resync arrives: the whole choice bar is removed and the state line returns to loading/error handling).',
    dom: 'Inside the embed card state line .vsidian-embed-card-state: the paused note is a <span> (text from the i18n entry embed.livePaused, registered with bindLocale for locale switches); the choice bar is a div.vsidian-embed-card-conflict (a flex wrap container); the buttons are real <button type="button"> elements (visible labels from embed.conflictCompareLabel / embed.conflictDiscardLabel / embed.conflictCancelLabel / embed.conflictReopenLabel, tooltips via data-tooltip from embed.conflictCompareHint / embed.conflictDiscardHint / embed.conflictCancelHint / embed.conflictReopenHint — the compare tooltip is the user-specified wording); the failure note is a div.vsidian-embed-card-conflict-notice (text embed.conflictCompareFailed). The bar buttons, the keybinding operations (conflictCompare/conflictDiscard/conflictCancel, registered in P2-10 with no default binding) and the test hooks share one handler chain.',
    obsidian: { counterpart: 'No direct counterpart (Obsidian conflict handling is closed-source; this project draws its own in-place choice bar and delegates the diff to the native host diff editor).' },
  },
  'live-embed-widget': {
    purpose:
      'The live-view embed host widget (#223 for line-owning embeds; since #247 occurrences inside mixed-run lines, ordered/unordered/task lists, lazy continuations, blockquotes and their combinations mount too — recognition shares the #246 reading-side scanEmbedsInLine; since #248 occurrences inside table content rows (header/data cells) mount via the in-cell decoded scan — inner/target use the decoded semantics (an escaped-pipe alias never leaks into the target path) while the replacement range is the exact raw-source range, and the widget nests inside the grid-cell mark span (a CM6 inline replace widget does not split marks), so the grid column layout and region highlighting survive in-cell cards): a ![[…]] in the live document mounts the same card as reading-embed-card via a CodeMirror decoration — hidden form (cursor/selection not touching the source range) replaces only the exact embed range [from, to] (the ![[…]] itself; before #247 the whole line) with an inline replacement (surrounding text, list markers/numbers, task checkboxes, quote prefixes and existing indentation stay on the line, no newline is ever inserted into the source, and the CSS block-levelized host renders the "leading text → card → trailing text" flow break; the cm-widgetBuffer pair around the replacement is zero-height block-levelized — the acceptance-feedback "no invisible source line" fix that also keeps the layout boxes as CM6 inline-block coordinate anchors: fully removing them (display:none) starves posAtCoords vertical probing at the range end of any rect, so the probing skips the whole block and ArrowDown from above jumps past the embed line — measured during the #217 acceptance round; keeping the replacement inline is the prerequisite for keyboard vertical navigation to enter the embed line, as a block-level replacement gets skipped wholesale by CM6; the in-cell buffer zero-heighting and host width constraints are carried by the grid-cell container rules); revealed form (per the selectionTouchesRange semantics: a collapsed cursor inside or on either end of the range, a non-empty selection strictly overlapping it, or any one selection range hitting it — never widened to adjacent text or the whole line) shows the editable source with the card moved below the line (dynamically shifting down one line to make room; reveal only affects the visual presentation of the source text — the card is not dismissed, and sibling cards reveal independently). The host vertical spacing is carried by its own padding with the in-host card shell margin zeroed — margins collapse out of the line box and CM6 height accounting (which drives the line-number gutter and viewport math) excludes them, which used to accumulate a per-card gutter misalignment (#217 acceptance measurement; padding counts into the box height so accounting matches rendering). The host swallows events (ignoreEvent=true): clicks inside the card never place the parent editor cursor, and browser text selections inside the card are never mistaken for parent-document CM6 source selections; in-card interactions (scrolling/text-selection copy/links/properties buttons) go through the embed card own listeners; since #248 the rectangular cell-region anchor also excludes the embed-card domain (tableRegionSelection — a pointerdown inside a card never starts the parent cell-region selection). An unclosed reference keeps the editable raw text and dismisses the old card (re-closing reloads per the new reference); embeds inside code fences/inline code/HTML comments/frontmatter and link-label runs do not mount (raw source shown). Cross-mode state sharing: the line-owning host key uses the line range while the mixed/in-cell host key uses the exact embed range (matching the two reading-side host conventions).',
    states:
      'Hidden (an exact-embed-range inline replace widget — the line structure plus surrounding text and container markers are kept so keyboard vertical navigation can enter from both directions; the source-line alignment and buffer zero-height block-levelization are carried by CSS, and mixed runs render the leading-text → card → trailing-text flow break; since #248 the in-cell form nests inside the grid-cell mark span with the card bounded by the column width — the in-cell buffers and host width are constrained by the grid-cell container rules) / revealed (a below-line block widget .vsidian-live-embed-below with the source present, dynamically shifting down one line to make room; sibling cards reveal independently); the switch rebuilds the decoration (per-instance card state is kept by the embed-card state store); loading/loaded/failure states reuse the card state line.',
    dom: 'Inside the live view .cm-content: the hidden-form host div sits inside .cm-line (the replacement of an inline replace, block-levelized via CSS display:block, with the surrounding cm-widgetBuffer pair zero-height block-levelized via display:block + height:0 — visually equivalent to hidden while the layout boxes remain as coordinate anchors); the revealed form is a block widget after the line end. The card shell .vsidian-embed-card (carrying the .markdown-embed alias) sits inside; the nested reading container resets white-space: normal (#217 acceptance measurement: the CM6 .cm-content white-space: pre cascade renders the trailing newline of each block innerHTML as a ghost line box, inflating card line spacing). Async card height changes (content loading, late images) wake the CM6 layout via ResizeObserver → view.requestMeasure.',
    obsidian: { counterpart: '.cm-embed-block (the Obsidian live embed container direction; the internal structure is closed-source and not promised)' },
  },
  'live-escape': {
    purpose:
      'Universal escape reveal/hide (generalized from acceptance feedback, Obsidian-aligned): in the live view the backslash of a Markdown escape sequence (backslash + ASCII punctuation, tree-driven Escape nodes) is hidden by default — what you see is the literal character (\\* renders as *, \\\\ renders as \\); when the cursor or a selection touches the line, the reveal class takes over and the backslash is shown in a low-mix tint of the editor foreground (exposing the source, same tint as the block-id dimming). Escapes inside table rows do not use this class: an escaped pipe (\\|) goes through the #42 live-table-escaped-pipe dedicated emission and rules (a degraded table keeps the raw source), while other escapes inside a cell (\\* and the like) get no emission at all — their backslash stays visible in the raw text (a deliberate degraded boundary: the table\'s own cell splitting and this generic emission are mutually exclusive to avoid class collisions), pinned by a liveEscape unit case. No effect inside code blocks/inline code (no Escape nodes). Display only — the source text is never changed.',
    states:
      'Hidden (default — the backslash is display:none) / revealed (touching the line swaps in the reveal class: display:inline plus a 45% low-mix tint of the editor foreground, following light/dark themes and custom font colors); the switch rebuilds with selection transactions, sharing the same predicate semantics as the heading/wikilink mark reveal (a collapsed cursor includes both line ends, a non-empty selection strictly overlaps).',
    dom: 'An inline mark span (covering the first character of the tree-driven Escape node); nests freely with wikilink/emphasis and other inline marks.',
    obsidian: { counterpart: 'the Obsidian live preview inline source exposure of escapes (the touching line shows the backslash in a light tint)' },
  },
  'mod-link-hover': {
    purpose:
      'Modifier-key hover feedback (#217 acceptance feedback: Ctrl+hover over a jumpable link gave no visual cue at all — a discoverability gap): while Ctrl/Cmd is held, hovering a jumpable link (wikilink/embed reference/plain link — source-form marks and rendered widgets alike, reading-view anchors included) underlines it and shows the clickable pointer cursor (instead of the text caret). The state class is maintained by the syncController document-level keydown/keyup (getModifierState handles left/right modifier pairs and alternation precisely) plus a window-blur fallback; the rendered widgets own standing clickable-cursor rule (pre-existing) is unaffected.',
    states:
      'Active (Ctrl/Cmd held — the body carries the class, hovering a link picks up underline + cursor:pointer) / inactive (no class, links render exactly as before); window blur forces the fallback (a keyup may have been lost).',
    dom: 'A class on body; the rule selectors cover .vsidian-wikilink / .vsidian-link / reading anchors under :hover.',
    obsidian: { counterpart: 'the Obsidian pointer and underline feedback while holding Ctrl over internal links' },
  },
  'reading-embed-ref': {
    purpose:
      'The openable placeholder form of an embed reference (#222): a line-owning embed inside referenced reading content first parses into a recognizable ![[display]] reference. Since #244/#245 it mounts as a body card or hover-internal card when depth and budgets allow; excessive depth, a cycle, or budget rejection retains an in-place explanation and an open-target entry. The target always resolves relative to its direct source document.',
    states:
      'Inside referenced content, the line upgrades to a card or an in-place placeholder according to depth and budgets; clicks navigate by direct source without stacking another hover popup (the embed content domain stops mouseover/mouseout propagation).',
    dom: 'An <a class="vsidian-wikilink vsidian-embed-ref" href="raw target"> inside the embed block html (the href is the raw text before |, same convention as the reading wikilink anchor); when the parent-document embed block mounts it is replaced wholesale by the embed card (the placeholder line never appears there).',
    obsidian: { counterpart: '(Obsidian expands embeds recursively; there is no placeholder form)' },
  },
  'reading-embed-mixed': {
    purpose:
      'Reading mixed-run embed host (#246): a ![[…]] mixed with text ("lead ![[B]] trail") or inside a list/blockquote container is promoted from its inline placeholder (embed-slot) into an in-flow block host after the block mounts, carrying the same reading-embed-card — rendered as "lead text → block card → trail text" with no newlines inserted into the source. Promotion inside a p splits the paragraph (lead p + host + trail p, classes and attributes cloned, empty halves dropped — valid DOM, never a block node inside p); bold/italic/highlight spanning the embed is unwrapped into two complete inline tags on each side (visual semantics preserved); list items (bullet/ordered/task/lazy continuation) and blockquotes host the card in place — list numbering, indentation, and the quote bar container stay intact; the host width follows its column/indentation area (block-level, filling the parent content box without crossing the indent). One shared recognition/mounting adapter covers the main reading document, card content, and hover content (RefContentMount and EmbedCardManager share the embedSlots assembly); multiple embeds in one paragraph each own an occurrence-keyed card in source order. Since #248, table cells (th/td) upgrade the same way — the placeholder is replaced in place by an in-cell host (the table row/column structure stays intact, the width follows the column; escaped-pipe alias forms produce their placeholder via the in-cell decoded re-parse, with data-vsidian-embed-inner in decoded semantics and the src anchors on the raw-source range).',
    states:
      'Upgrade path mirrors the line-owning card (loading/success/failure states, capped scrolling, depth and budget rejection, recursion and source leases all reuse the #244/#245 infrastructure); non-promotable forms (inside an anchor, pairing-failure degradation) keep the .vsidian-embed-slot placeholder text; since #248 table-cell placeholders upgrade to in-cell hosts (escaped-pipe alias forms included).',
    dom:
      'Main reading document: produced inside a block element (.vsidian-reading-block) by the mounting adapter (embedSlots.promoteEmbedSlot), the host div carries classes .vsidian-reading-embed .vsidian-reading-embed-mixed; card and hover content produce it the same way via the RefContentMount block-mounted hook (direct-source/occurrence semantics follow the parent instance); since #248 table blocks (the table kind) produce in-cell hosts inside td/th the same way (in-place placeholder replacement). Unmounting pairs via the data-vsidian-embed-promoted query (the host is reclaimed with its owning block; instance state stays in the card state store).',
    obsidian: { counterpart: '(Obsidian inserts mixed-run embeds as blocks too; container rules are closed-source and not promised)' },
  },
  'embed-slot': {
    purpose:
      'Reading mixed-run inline placeholder (#246): a span emitted by a markdown-it inline rule (the embedAtPosition check, same source as the shared/wikilink scanner) in the inline content of paragraphs/lists/blockquotes/tables — promoted into a reading-embed-mixed in-flow host after the block mounts (since #248 including table td/th cells); when not promoted or not promotable (inside an anchor — nested anchors are invalid DOM; pairing-failure degradation) it renders as placeholder text (body text in the muted description color, keeping the ![[ ]] form recognizable). The placeholder is a span rather than an anchor: it can sit inside link label text without breaking DOM validity, and clicks inside link labels follow the enclosing anchor semantics. Since #248, table-cell embeds containing an escaped pipe produce their placeholder via the in-cell decoded re-parse (data-vsidian-embed-inner in decoded semantics, e.g. B|alias), pairing against the in-cell decoded occurrence scan.',
    states:
      'Promoted (block mounted and the placeholder is promotable — replaced by the in-flow/in-cell host, the span leaves) / placeholder kept (all other forms; rebuilt whenever the block html is rebuilt).',
    dom:
      'Inline content of a block container (p/li/td/th): <span class="vsidian-embed-slot" data-vsidian-embed-inner="raw">![[display]]</span>; attribute values are HTML-escaped and survive the sanitizeReadingDom deep sanitization (data attributes are kept).',
    obsidian: { counterpart: '(Obsidian renders mixed-run embeds directly; there is no placeholder form)' },
  },
  'find-panel': {
    purpose:
      'Floating find panel over the editing area (three-toggle panel since #236, powered by the @codemirror/search engine in external-drive mode): two-column grid layout since 2026-10, matching the native VSCode widget — the left column is the replace-bar expander (full height across rows: as tall as the main row when collapsed, spanning both rows via :has when expanded; no border at rest, the accent ring appears only on focus and stays mutually exclusive with the input focus ring — clicking hands focus back to the input; the icon is a self-drawn SVG from quick-action-icons.py on an embedded glyph layer, rotating 90° with aria-expanded when expanded: > to a downward chevron), and the right column stacks the main row (input, the case/whole-word/regexp toggles, the "n of total / No results" counter, previous/next/close — same order as the native VSCode widget) and the replace row. The three toggles are the find-options single source of truth (shared/findOptions; also consumed by #238 "select next same word") and persist per workspace across sessions; the panel is available in both live and reading views (reading keeps block-level hits and positioning), while the replace entry points are disabled entirely in reading view (2026-10 user decision — the toggle is disabled and grayed out, and Ctrl+H is not consumed).',
    states:
      'The panel DOM is always present; visibility is controlled by .vsidian-find-open (display:none when closed, so probes are unaffected). A lit toggle means the option is on (e.g. Aa lit when match-case is enabled). An invalid regexp shows a red border on the input container (the invalid class marks the input as the state source and :has lifts the coloring onto the container; an empty query is not flagged and shows no red; no crash, counter reads "No results"). An empty query collapses the whole counter area via the -hidden class (display:none — nothing searched yet reserves no "n of total" blank, #241 acceptance revision). Find-in-selection (#241 asset wiring, the native ☰): a panel-local non-persisted state (reset on panel close or entering reading view) — the button is disabled without a user-selection anchor (grayed, hover unresponsive); when on it joins the lit family and matches/navigation/replacement are confined to the range (the range maps through edits and follows user reselection), with the range marked in the body text by a .vsidian-find-selection-range low-emphasis background mark (inactive-selection color, may span lines). The replace-bar toggle is disabled in reading view (grayed via the disabled attribute — the shared hover rule carries a :not(:disabled) guard, and a disabled control cannot take focus so the focus ring never appears). Open/close and toggle interactions are verified by the browser suite along behavior paths.',
    dom: 'Attached inside the editor container (position:relative containing block), below #app; buttons are real <button type="button"> elements (aria-pressed/aria-expanded follow state; aria-label/title from the find.* i18n entries). Since #241 the navigate/close/replace buttons are icon-shaped — the button body shows its light- or dark-theme SVG icon, while the words live solely in aria-label and the hover title; the input border/background/focus ring live on .vsidian-find-inputwrap, which embeds the three toggles at its right edge like the native widget.',
    obsidian: { counterpart: 'None (the Obsidian find widget is an application-level part, not a document styling surface)' },
  },
  'find-options-bar': {
    purpose:
      'The find options bar (#238): a mini floating strip present while a "select next occurrence" session is active — just the three toggle buttons, no search box and no counter (user decision: every Ctrl+D press opens it directly). The button states share the main panel toggle memory (shared/findOptions; aria-pressed in sync); clicking toggles and rebuilds the session with the new options. Non-modal: it never takes editor focus (button mousedown is preventDefault-ed to keep focus), never claims the popup mutex slot, and Esc is consumed once after the find panel (closes the bar only, leaving selections intact). While the main find panel is open it does not appear (the panel toggle buttons blink via .vsidian-find-flash instead); the session end (external selection change / focus loss / Esc / mode switch) fades it out.',
    states:
      'The bar DOM is always present; visibility is controlled by .vsidian-occurrence-bar-open (display:none by default, so probes are unaffected). A lit toggle means the option is on (same lit language as the main panel -active states). The panel toggle blink state is .vsidian-find-flash (a 0.45s opacity pulse animation; it lives on the find-panel buttons, not on the selectors of this entry).',
    dom: 'Attached inside the editor container (same positioning containing block and top-right corner as .vsidian-find; the two appear exclusively); buttons are real <button type="button"> elements (aria-pressed follows state; aria-label/title reuse the find.matchCase / find.wholeWord / find.regexp entries, the container aria-label uses find.optionsBar).',
    obsidian: { counterpart: 'None (the Obsidian Ctrl+D option hint is an application-level part, not a document styling surface)' },
  },
  'find-panel-replace': {
    purpose:
      'The expandable replace bar of the find panel (#236): collapsed by default, expanded via the left-edge toggle (find-panel entry, .vsidian-find-toggle) or Ctrl+H (the findReplace operation); "Replace" replaces the current match and moves to the next one, "Replace All" replaces the whole batch — both are explicit write operations (a single CM6 transaction through the standard write-back chain; one edit.request = one host undo). Replacing is a live-editing capability, disabled entirely in reading view (2026-10 user decision): an open instruction carrying replace does not open the panel (silently ignored), Ctrl+H is not consumed (the registry lists the operation as live-only), and the toggle is disabled and grayed; the live-side expanded state is untouched by reading view and restored as-is when switching back to live (closing the panel ends the session in either mode alike).',
    states:
      'The replace-row DOM is always present; visibility is controlled by .vsidian-find-replace-open (display:none by default; permanently collapsed in reading view, where the toggle is also disabled). The expanded state is observable via FindSessionProbe.replaceOpen.',
    dom: 'Third section inside the panel (.vsidian-find); Enter in the input is a panel-local key (replace next); buttons are real <button type="button"> elements (icon-shaped since #241 — the words live in aria-label/title, i18n entries find.replaceNext / find.replaceAll).',
    obsidian: { counterpart: 'None (the Obsidian replace widget is application-level)' },
  },
  'find-match-highlight': {
    purpose:
      'Matches come from the @codemirror/search engine and are counted and located in the full source text. Live uses direct current-match and viewport match decorations. Reading maps source positions to visible text in mounted blocks: all hits are pale yellow and the current hit orange, including within callouts and blockquotes. Hidden link targets, image attributes, and rendered formula source still count without highlighting unrelated identical visible text. The current block retains .vsidian-reading-find-hit for existing snippets; default rendering adds no block tint or side bar.',
    states:
      'Interactive-state decoration (present only while a find session is open and has hits) — excluded from static probes; hit counting, the current index and positioning are verified by the integration find cases along behavior paths.',
    dom: 'Live: inline decorations inside #app .cm-editor .cm-content; reading: spans around matching text inside #app .vsidian-view-reading. The current block retains .vsidian-reading-block.vsidian-reading-find-hit.',
    obsidian: { counterpart: 'None (Obsidian match highlighting is application-level)' },
  },
  'var-find-highlight': {
    purpose:
      'Four find-highlight variables: --match-background colors all matches (semi-transparent yellow by default); --match-current-background colors the current match (orange by default, shared by both views); --match-current-outline sets its outline. --hit-block-background remains the reading current-block background entry for existing snippets, transparent by default and still effective when explicitly set.',
    dom: 'Consumed by the live match decorations and the reading hit-block rules; defaults are inlined as var() fallbacks in the rules (no root value defined on #app — a snippet overriding at :root takes effect globally).',
    obsidian: { counterpart: 'None (Obsidian highlight colors are application settings, not CSS variables)' },
  },
  'reading-find-source': {
    purpose: 'Reading find feedback for hidden source: when the current match cannot be fully mapped to visible text, keep the rendered content and show its starting source line. Table delimiters, hidden link targets, formulas and comments remain locatable without switching modes. Match counts and order stay unchanged. Source is plain text with no editing or writeback path.',
    states: 'Interactive state, mounted only for hidden or partially hidden current hits. Removed on visible hits, closing find, switching to Live, or disposal. Offscreen anchors hide it; virtual remounts restore it, and resizing repositions it. Fixed positioning leaves paragraph positions, block heights and scroll height unchanged; it never steals find focus, avoids the find panel and flips or shrinks at viewport edges. Long lines show about 320 UTF-16 units near the hit without splitting emoji. Multiline matches show the starting line, with trailing LF represented as \\n.',
    dom: 'Inside #app but outside the reading scroll container. An aside[role=region] contains a header with source-hit, source line/column and read-only labels, followed by pre > code with precise span highlights. No input, textarea, contenteditable or new keyboard action; existing find navigation and close keys apply.',
    obsidian: { counterpart: 'None (Vsidian reading find source feedback)' },
  },

  // ---- 悬停提示（tooltip，#300：统一自绘悬停提示，原生 title 退役）----
  'tooltip-card': {
    purpose: 'The unified self-drawn hover hint card (#300): every hover hint in the editor and settings webviews (operation names, user-content literals like raw TeX or image alt, disabled-state reasons, and keybinding badges). A document-level delegate listens on [data-tooltip] — the native title attribute is retired fleet-wide and a contract scan blocks regressions. Appears after the --vsidian-tooltip-show-delay on hover and immediately on keyboard focus; focusable (tabindex=0) with selectable, copyable text; no buttons or interactive logic. Fixed positioning goes through tooltipGeometry (below-first with above flip, center-first horizontal alignment flipping at viewport edges, clamping) at z-index 10500, above modals so buttons inside popups keep hints; it never claims the popup mutex — visibility is purely pointer/focus driven. The settings webview shares the same mechanism and class names.',
    dom: 'Appended to #app (falling back to body); a persistent singleton whose shown modifier class drives visibility.',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'tooltip-key': {
    purpose: 'A keybinding badge inside the hover hint (#300): operations with shortcuts split into a two-part hint — the name travels in data-tooltip and the keys in data-tooltip-keys (internally \\n-separated), one badge per chord segment. The display connector is the badge form itself, not the common.keySeparator text join.',
    dom: 'Direct children of the .vsidian-tooltip-keys area inside .vsidian-tooltip (an internal layout shell, not a public entry).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-background': {
    purpose: 'The hover hint card background (#300): defaults to the host --vscode-editorHoverWidget-background — light text on a dark card in dark themes and the inverse in light themes, adapting in step with native host hovers. A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-foreground': {
    purpose: 'The hover hint text foreground (#300): defaults to the host editorHover foreground, adapting across themes. A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-border': {
    purpose: 'The hover hint border (#300): defaults to the host editorHover border — a hairline in light themes, nearly none in dark ones, strengthened automatically in high-contrast themes. A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-radius': {
    purpose: 'The hover hint corner radius (#300). A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-font-size': {
    purpose: 'The hover hint font size (#300). A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-max-width': {
    purpose: 'The hover hint max width (#300): longer copy such as error reasons wraps past this bound. A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-key-background': {
    purpose: 'The keybinding badge background (#300): defaults to the host editorHover status-bar tint. A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-key-foreground': {
    purpose: 'The keybinding badge foreground (#300): defaults to the host description foreground. A public variable overridable by CSS snippets.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  'var-tooltip-show-delay': {
    purpose: 'The hover hint show delay in unitless milliseconds (#300): the controller reads it via getComputedStyle; published as a behavioral variable so snippets can tune the pacing.',
    dom: 'Defined on #app (the same-named container in both the editor and settings webviews).',
    obsidian: { counterpart: 'None (Obsidian tooltips expose no customization interface)' },
  },
  "toast-container": {
    "purpose": "Independent lightweight notification channel centered at the bottom of the editor viewport; preserves focus and does not block input.",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    },
    "states": "At most one visible message; independent from host notifications."
  },
  "toast": {
    "purpose": "Local notification card; text wraps without truncating action guidance.",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    },
    "states": "data-severity is neutral, warning or error; animation states are internal."
  },
  "toast-severity": {
    "purpose": "Severity selectors: neutral follows the theme, warning is pale yellow, error pale red; high contrast uses theme foreground and borders.",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-background": {
    "purpose": "Neutral background, follows the current theme",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-foreground": {
    "purpose": "Neutral text color, follows the current theme",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-border": {
    "purpose": "Neutral border, follows the current theme",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-background": {
    "purpose": "Pale yellow warning background, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-foreground": {
    "purpose": "Warning text color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-border": {
    "purpose": "Warning border color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-background": {
    "purpose": "Pale red error background, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-foreground": {
    "purpose": "Error text color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-border": {
    "purpose": "Error border color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-radius": {
    "purpose": "Notification corner radius",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-font-size": {
    "purpose": "Notification font size",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-padding-inline": {
    "purpose": "Notification horizontal padding",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-padding-block": {
    "purpose": "Notification vertical padding",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-max-width": {
    "purpose": "Maximum width, also clamped by viewport margins",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-viewport-margin": {
    "purpose": "Horizontal viewport margin",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-bottom-offset": {
    "purpose": "Offset from the editor viewport bottom, plus safe area",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-shadow": {
    "purpose": "Notification shadow",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-enter-distance": {
    "purpose": "Upward entrance distance; removed when reduced motion is preferred",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-enter-duration": {
    "purpose": "Entrance animation duration (CSS time)",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-exit-duration": {
    "purpose": "Exit animation duration (CSS time)",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-duration": {
    "purpose": "Neutral display duration in unitless milliseconds",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-duration": {
    "purpose": "Warning display duration in unitless milliseconds",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-duration": {
    "purpose": "Error display duration in unitless milliseconds",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "paste-dialog-overlay": {
    "purpose": "Overlay for the paste-formatting prompt; cancellation creates no edit.",
    "states": "Mounted only when formatting can be converted and prompting is enabled; stale results cannot insert after mode or target changes.",
    "dom": "Direct child of #app, covering the current editor viewport.",
    "obsidian": {
      "counterpart": "None (Vsidian paste prompt)"
    }
  },
  "paste-dialog": {
    "purpose": "Dialog with Keep formatting, Paste text only, Cancel and a Do not show again checkbox; Tab cycles focus and Escape cancels.",
    "states": "Choice applies to this paste; checking Remember saves two preferences only when not cancelled.",
    "dom": "Direct child of .vsidian-paste-dialog-overlay; role=dialog and aria-modal=true.",
    "obsidian": {
      "counterpart": "None (Vsidian paste prompt)"
    }
  },
  // ==== 双链联想候选（#376 T01）====
  "wikilink-suggest-popup": {
    "purpose": "Popup container for wikilink suggestions: anchored at the wikilink fence opening, listing candidates and the real states (searching / no matches / not ready / no folder open; the heading stage additionally distinguishes target-not-found / not-Markdown / read-error, #379 T04; the block stage shares those states and adds the 'inserting block ID' state while an ID-less block acceptance is in flight, #380 T05).",
    "states": "Mounted while the main-body Live cursor sits inside the target field of a closed wikilink [[]] / ![[ ] (file field, or a heading/block anchor field with an explicit file target); removed on confirm, Esc, leaving the field or switching mode. An empty #/^ target keeps the placeholder hint (the target document is not read); with an explicit file target the heading/block stages query outbound (the block stage since #380 T05).",
    "dom": "Direct child of document.body (outside #app); role=listbox with the wikilinkSuggest.list.ariaLabel message; never steals editor focus. Two-segment structure: candidates and status rows live in the .vsidian-wikilink-suggest-list scroll region while the fixed .vsidian-wikilink-suggest-hints key-hint bar sits at the bottom; max-height stays on the container (the override example keeps its shape). Positioning: horizontally centered on the caret (8px viewport clamping, falling back to the field start when caret coords are unavailable), vertically attached to the field line and flipped above it when it would overflow the bottom edge.",
    "obsidian": {
      "counterpart": "None (Vsidian wikilink suggestions)"
    }
  },
  "wikilink-suggest-item": {
    "purpose": "Candidate row: in the file stage the file name is the primary text and its folder is right-aligned in a muted tone to disambiguate same-named files; in the heading stage (#379 T04) the heading text is the primary text and the level/line meta is right-aligned in the same muted slot; in the block stage (#380 T05) the first-line snippet is the primary text (an existing id trails as ' ^id' on the same row and ID-less blocks are listed as-is) with the block start line / line-count meta right-aligned; matched ranges are marked by the child .vsidian-wikilink-suggest-hl element (file stage).",
    "dom": "Option rows of the listbox container; child structure: .vsidian-wikilink-suggest-name (file name / heading text / block snippet), .vsidian-wikilink-suggest-dir (folder / heading level-and-line / block line-and-count meta), .vsidian-wikilink-suggest-hl (matched ranges).",
    "obsidian": {
      "counterpart": "None (Vsidian wikilink suggestions)"
    }
  },
  "wikilink-suggest-item-active": {
    "purpose": "Keyboard-highlighted row (the Enter/Tab confirmation target): moved with arrow keys, auto-lands on the first item for non-empty queries, no highlight for empty queries.",
    "states": "A modifier class on the same element as .vsidian-wikilink-suggest-item; aria-selected=true is kept in sync.",
    "dom": "Modifier class on a candidate row (not a separate node).",
    "obsidian": {
      "counterpart": "None (Vsidian wikilink suggestions)"
    }
  },
  "wikilink-suggest-status": {
    "purpose": "Status row: textual presentation of real states - searching, no matching files, index not ready, no folder open, 'index still updating (partial results)' and the pagination hint (#377 - 'N more, press ArrowDown to load more'); not confirmable, never writes to the document.",
    "states": "Switches with query results and index readiness; can coexist with candidate rows (usable items remain listed while the index is still building); appends a remaining-count row at the list tail when the match total is not exhausted (#377 load-more hint).",
    "dom": "Direct child rows of the list scroll region (.vsidian-wikilink-suggest-list), not option semantics - placeholders are not confirmable.",
    "obsidian": {
      "counterpart": "None (Vsidian wikilink suggestions)"
    }
  },
  "wikilink-suggest-hints": {
    "purpose": "Bottom key-hint bar (acceptance feedback 2026-10-06): hints the advanced keys still available in the current stage - three segments in the file stage (# links a heading, ^ links a text block, | sets display text), two in the heading stage (# already consumed), only | in the block stage; muted small text, never scrolls with the list and is never confirmable.",
    "states": "Segment count switches with the session stage; coexists with candidate and status rows (also present for no-result, loading and placeholder states).",
    "dom": "Last direct child row of the container (outside the .vsidian-wikilink-suggest-list scroll region); one child span per key hint; separated from the item body by a 1px solid border-top.",
    "obsidian": {
      "counterpart": "None (Vsidian wikilink suggestions)"
    }
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
