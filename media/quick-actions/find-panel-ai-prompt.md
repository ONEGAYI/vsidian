# 生图记录

- 工具：Codex 内置 ImageGen，单次生成整张查找面板图板。临时参考板由现有 6 枚浅色图标（`table`、`link`、`taskList`、`externalLink`、`highlight`、`comment`）和下排 6 个空白格组成；仅保留最终生成图作为 `find-panel-ai-board.png`。
- 后处理：生成图为 2172×724（6×2 格，每格 362×362）。Pillow 只取下排格内区域，排除格线与背景；灰度阈值 `<176` 转为二值 alpha，按墨迹包围盒等比放入 80×80 安全区并居中，合并为 RGBA `find-panel-source.png`（576×96）。
- SVG：`scripts/quick-action-icons.py` 按 key 顺序读单张源图，分别着浅色/深色主题色，并由 VTracer CLI 0.6.5 描摹；不手写最终 SVG。

## 最终提示词

```text
Use case: ui-mockup
Asset type: Vsidian quick-action icon source sheet
Primary request: Complete the supplied 6-column × 2-row reference board as one clean icon sheet. The top row shows six existing Vsidian icons for style reference; keep that row and its cell grid in place. Fill the six empty cells in the lower row, left to right, with exactly one new icon per cell.
Input images: Image 1 is the reference board. Its top row is the visual style source; its lower row defines the six target cells.
Style/medium: Minimal monoline UI icons, matching the reference row's simple geometry, charcoal ink (#363C46), roughly 2.0-unit stroke on a 24-unit icon grid, rounded line ends and joins, and generous whitespace.
Composition/framing: One centered icon in each lower cell, optically balanced, entirely inside its cell. Preserve the white background and thin light-gray cell outlines. Make every symbol recognizable when reduced to 18 px.
Constraints: Lower-row cell order and semantics: (1) findPrev — a thin upward arrow with a short stem and chevron head; (2) findNext — the matching downward arrow; (3) findClose — a hand-drawn diagonal cross (×) with rounded ends; (4) replaceOne — two short text strokes, with one curved arrow indicating replacement of the current line by the shorter line; (5) replaceAll — a curved arrow above two short text strokes, indicating replacement across all lines; (6) findInSelection — three compact, evenly spaced horizontal strokes like ≡. Use line drawings, not font glyphs.
Avoid: Any labels, letters, numbers, gradients, shadows, shading, texture, glow, decorations, extra marks, uneven grid, icons touching cell borders, or changes to the six requested meanings.
```
