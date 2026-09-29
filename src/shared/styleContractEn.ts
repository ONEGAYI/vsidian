// 样式参考条目英文平行覆盖（#178 机制 + #179 content 域全量 + #180 chrome
// 域全量）：设置页「样式参考」条目文档字段的英文版单一事实源——中文清单
// （./styleContract）保持权威基准不动，本模块按条目 id 索引、字段级覆盖；
// 取词规则为**英文优先、条目或字段缺失回退中文基准**（规格
// docs/specs/style-reference-i18n.md）。141 条（content 78 + chrome 63）
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
  'image-failure-variants': {
    purpose:
      'Failure variants (#201): confirmed deletion (positive on-disk missing evidence, "not found") and inaccessibility (SSH disconnect / permission errors) never masquerade as each other — not found gets a faint red background, inaccessible a warning-yellow hint; kept in sync with data-vsidian-img-reason (not-found / inaccessible).',
    states: 'Only applied on top of the error base class; removed when a refresh succeeds (loaded) or the slot is released.',
    dom: 'Element-level failure-reason modifier classes on the image slot.',
    obsidian: { counterpart: 'No counterpart (Obsidian has no deleted/inaccessible distinction classes)' },
  },
  'image-solo-block': {
    purpose:
      'Block container variant for an image standing alone on its line in live view: when the whole line holds a single image (all remaining text is whitespace, trailing whitespace included), the widget slot switches to block layout, providing a definite width basis for sources without intrinsic dimensions (viewBox-only percentage-width SVGs, the mermaid export form) — such sources collapse to 0×0 under inline-block shrink-to-fit (the img loads successfully, so the failure is silent and shows as a blank line). Sources with intrinsic dimensions are unaffected (they still render at natural width under block layout). Known boundary: such SVGs mixed inline with other content (list prefixes, surrounding text, multiple images on one line) keep the inline form.',
    states:
      'Decided per line at decoration build time (same rule on the tree-driven and loose paths): the line counts as solo when all text outside the image range is whitespace; the three state modifier classes still stack on top.',
    dom: 'Live inline widget span.vsidian-image.vsidian-image-block > img (display: block).',
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
      'The positioning wrapper of graphic code blocks (fences rendered as graphics) and its top-right button group: edit enters source editing (live preview only), popup opens the diagram popup; the group hover show/hide is CSS-driven (an opacity toggle; the DOM stays present in the rendered-success state).',
    states:
      'The button group shows in the rendered-success state (error fallback blocks do not emit it); the edit button is assembled only on the live preview side.',
    dom: "Live: the frame around the fence widget; reading: the frame around the mermaid/graphic container. The button group is absolutely positioned at the frame's top right.",
    obsidian: { counterpart: 'None (Obsidian diagram blocks have no public button-group structure)' },
  },
  'diagram-popup': {
    purpose:
      'The fullscreen overlay of the diagram popup (#111): backdrop + stage (the diagram body being zoomed/panned) + toolbar (zoom/reset/refresh/export/close); the error state keeps close and refresh; note is the notice bar shown when the environment does not support PNG rasterization. Attached to document.body and present only while the popup is open.',
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
      'The line-level class covered by cards: in live view the source line level (including the cleared fence lines and all code lines, carrying the card background); in reading view the in-card line spans (same class name as live, same convention across views); runs in parallel with the content-domain live-code-line (both are present when live cards are enabled).',
    dom: 'Live: .cm-line line elements (the fence range with cards enabled); reading: span.vsidian-reading-code-line inside code.',
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
      'Line-level class of the read-only frontmatter table card: when a legal simple header block (scalars + string arrays) is well-formed, it covers every line of the header block (including the opening/closing fence lines and stray lines) and carries the left/right border lines (the row area stays transparent — the contrasting boundary feel comes from the card border and the slightly brighter header strip); the opening/closing fence lines add horizontal rules and corner rounding, assembling a full bordered rounded card. Card lines also carry vsidian-frontmatter-line (the alias bridge promises at the direct level that .cm-hmd-frontmatter keeps matching in the well-formed shape; its transparency-lowering side effect is reset by the card rules). Complex types / parse failures degrade the whole card back to the frontmatter-line raw-source shape (see limit-fm-complex-types).',
    states:
      'Persistent card (independent of cursor position — the well-formed state never exposes the raw source, and a cursor entering the header area is guided to just after the closing line); cells are not click-to-edit — editing is funneled into the Popover opened by the header bar Edit button.',
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
      'The card header bar (a replace widget on the opening fence line): a slightly brighter background strip (creating the contrasting boundary feel against the transparent row area) + a list icon + a Properties title (600 weight, secondary-foreground gray) + a rounded outlined Edit button at the top right (pencil icon, highlighted on hover/focus). The cm-widgetBuffers before and after the inline replacement are hidden (the cursor parking spots of the inline replace each take one line of text height, and in the well-formed state the cursor never enters the header area so there are no consumers), pulling the header row height down to about 1.2x the body line height. Clicking the button toggles the property-editing Popover. The reading side renders the same container, class names and layout (no button, read-only).',
    states: 'The header bar is persistent in both views; the button exists only in live (not emitted on the reading side).',
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
