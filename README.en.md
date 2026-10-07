# Vsidian

English | **[中文](https://github.com/ONEGAYI/vsidian/blob/main/README.md)**

Vsidian brings an Obsidian-like Markdown editing experience to VS Code. After installing, opening a `.md` file enters live preview directly: the document renders as you read it, moving the cursor onto a heading, link, or formula reveals its source, and the rendering restores once you move on. A reading mode and the native source editor are one click away at any time.

- **Both views render only the viewport**: scrolling and editing stay responsive on large documents.
- **Obsidian editing habits**: wikilinks and block-reference jumps, hover preview and document embeds (edit embedded notes in place), backlink and outgoing-link panels, reference updates on rename, grid table editing, task checkboxes, frontmatter property tables, image paste with automatic saving, and a unified context menu — familiar operations in familiar places.
- **Public styling surface**: a built-in CSS snippet system plus a documented style contract browsed offline and exportable as JSON, with Obsidian-name selectors and CSS variables accepted directly.

## Installation

**Marketplace (recommended)**: search for **Vsidian** in the Extensions view of VS Code (1.82+), or open the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=onegayi.vsidian); reload after installing.

**Manual VSIX**: download `vsidian-*.vsix` from [GitHub Releases](https://github.com/ONEGAYI/vsidian/releases), then Command Palette → "Extensions: Install from VSIX…", pick the file and reload. For Remote SSH, install the same VSIX in the remote extension host.

## Feature overview

### Editing & formatting

| Feature | Description |
| --- | --- |
| Three view states | Cycle live preview, reading, and the source editor; the last mode and scroll position are remembered across windows |
| Default editor guard | Prompts when another extension takes over as the default `.md` editor and restores Vsidian in one click; the "General" settings group shows the current default editor live |
| Unified context menu | Right-click anywhere in the live preview body for link, formatting, and clipboard clusters, with cascading submenus, icons, and shortcut hints |
| Text formatting | Command palette and quick-action bar cover bold, italic, highlight, headings, inline code, and more; every action is rebindable |
| Rich / plain text paste | Ctrl+V converts supported HTML formatting to Markdown, asking first and undoing text and formatting separately by default; Ctrl+Shift+V keeps original text and Markdown markers; see [paste details](docs/features.md#富文本粘贴与撤销) (Chinese) |
| Multi-cursor editing | Alt+click and Ctrl+Alt+Up/Down add cursors; type and format across selections in parallel, Esc collapses back to one cursor (toggle in settings) |
| Select next occurrence | Ctrl+D adds each next match as a selection; Ctrl+Shift+L selects all occurrences |
| Chinese word-wise motion | Ctrl+arrows step through Chinese text word by word; optional jieba engine (downloaded on demand) falls back to the built-in segmenter |
| Find & replace | Case, whole-word, and regex toggles; find in selection; Ctrl+H expands the replace bar; reading mode highlights matches per character |
| Keybindings | Every action rebinds in one place (chords supported) with conflict detection, clear, and reset to defaults |

### Structured content

| Feature | Description |
| --- | --- |
| Table editing | Well-formed tables render as an editable grid: in-cell editing, rectangular selection and copy, row/column add, delete and reorder, content-proportional column widths with a font-aware readability floor for short columns, and whole-table height optimization once the caret leaves; tables inside quotes and lists are supported too |
| Lists & quotes | Enter continues structure, Backspace peels it off in layers, Tab indents whole lines; nested lists and quotes fully supported |
| Frontmatter properties | The YAML head renders as a read-only table card; a popover adds, edits, and removes properties, one undo per action |

### Links & images

| Feature | Description |
| --- | --- |
| Wikilinks & anchors | Five `[[wikilink]]` forms; `#heading` and `#^block-id` jumps land on the target, with a highlight flash on arrival |
| Wikilink completion | Typing `[[]]` pops up file candidates (every common file type — images, PDFs, and more); `#` / `^` then list the target's headings and blocks; works in table cells and embedded editors too |
| Copy block link | Right-click any block to copy `[[note#^block-id]]`, generating an id when missing; `Ctrl+Shift+C` shortcut |
| Image paste | Ctrl+V saves the clipboard image and inserts the reference at the cursor; save location and subpath are configurable |
| Image wikilink embeds | `![[image.png]]` embeds images that behave identically to plain Markdown image links — loading, failure hints, auto refresh, and the popup viewer are the same; hovering a wikilink that points to an image shows the image itself in the popup |
| Image popup | Hover an image for its button group; the full-screen popup zooms, pans, refreshes, and exports the original; clicking the image no longer jumps to source |
| Embedded refresh | Images replaced or deleted on disk reload automatically or show a not-found state; the toolbar button refreshes images and diagrams on demand; shortcut bindable (unbound by default) |
| External link previews | Hover an http(s) link to show a card with its title, summary, and domain (off by default; restricted fetch that never sends note content or credentials); the "Live page" shape renders the page itself in a sandboxed view, with a one-click fallback to the card |
| Search reveal | After a workspace-search result opens a note, the command "Reveal selected search result" moves the cursor to the match (unbound by default; no auto-reveal due to a VSCode API gap) |

### References & backlinks

| Feature | Description |
| --- | --- |
| Hover document preview | Ctrl+hover a link to preview the target: notes show the full text, a section, or a block reference, editable and savable inside the popup; text files render read-only with native VS Code coloring; PDFs browse by page with selectable text and zoom. Available in live preview, reading, and the link panels; direct-hover and master toggles in settings |
| Jump target tip | When hovering shows no preview popup, a brief pause reveals a small badge with the target path and anchor; works in both views and the link panels, toggle in settings |
| Document embeds | `![[note]]` mounts a card where the target note can be edited and saved in place, leaving the parent untouched; `![[file.ts]]` and `![[file.pdf]]` embed text and PDF read-only, with `#line=N` / `#range=B-E` anchors; the cursor reveals the reference source for editing; inline, list, quote, and table-cell positions all render, with recursive expansion (three levels by default) |
| Backlink panel | The sidebar shows which documents reference the current note: context cards grouped by source with the matched link highlighted, sortable and searchable, click to jump to the reference |
| Outgoing links panel | The sidebar lists every link in the current note (wikilinks, links, images, reference definitions); click lands on the link's actual anchor, broken links dim |
| Reference updates on rename | Renaming or moving files and folders inside VS Code rewrites wikilinks, links, and image references to the new locations; one undo reverts the whole rewrite |

### Code blocks & diagrams

| Feature | Description |
| --- | --- |
| Code block cards | Fences collapse into cards with a language badge, line numbers, copy, fold, and a reading-view wrap toggle; syntax colors follow the VS Code theme |
| Diagrams & math | Mermaid diagrams and KaTeX math render in both views; diagrams zoom in a full-screen popup and export as SVG/PNG |

See the [fenced-language list](docs/specs/code-block-card.md#语法高亮) for supported languages and aliases, including Tcl, VHDL, project configuration languages, C#, Kotlin, Swift, and Dart. Main content and Markdown hover/embed views share the highlighting engine.

### Outline

| Feature | Description |
| --- | --- |
| Outline panel | Headings stay in sync; click to jump, drag to reorder whole sections, search, and fold with a depth slider |

### Appearance & customization

| Feature | Description |
| --- | --- |
| CSS snippets | The "Appearance" page in Vsidian settings manages user-folder `.css` snippets with per-file toggles, nested `@import`, and HTTPS remote styles and fonts |
| Style reference | The "Appearance" page browses the public style contract offline with search; the contract JSON exports for AI assistants and external tools |
| Readable line width | One slider constrains the body column in both views; 0 fills the available width, the column centers and yields to the outline panel |
| Interface language | English and 简体中文 switch instantly, following the VS Code display language by default |

The complete behavior, boundaries, and settings of each feature are documented in [docs/features.md](https://github.com/ONEGAYI/vsidian/blob/main/docs/features.md) (in Chinese).

## Known limitations

- No support for Obsidian Canvas, whiteboards, the Obsidian plugin ecosystem, or note formats other than Markdown.
- The CSP allows any https image source (a design trade-off for remote image hosting; in theory usable as a tracking pixel).
- Very long code blocks skip syntax coloring and fall back to a plain-text card.
- External entries (workspace search, problems panel, etc.) open a note without revealing the match — a VSCode public API gap (tracking vscode#289785); use the command "Reveal selected search result" to locate it manually.

## Building from source

```bash
npm install             # install pinned dependencies
npm run compile         # esbuild bundles + tsc type check
npm run test:unit       # unit tests (no VS Code host required)
npm run test:browser    # Playwright browser regression (first run: npx playwright install chromium)
npm run test:integration # real-host integration tests
npm run release:check   # package the VSIX and run pre-release checks
```

On Windows, integration tests launch the real VS Code host on a separate desktop by default, without disturbing the current one; the foreground mode for unattended environments and shard settings are documented in the launchers under `test/integration/`. Release conventions live in the in-repo skills (`.agents/skills/release/` and `.agents/skills/style-contract/`).

Please report issues at [Issues](https://github.com/ONEGAYI/vsidian/issues); see [CHANGELOG](https://github.com/ONEGAYI/vsidian/blob/main/CHANGELOG.md) for version history.
