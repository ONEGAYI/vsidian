# 生图记录

- 工具：Codex 内置 ImageGen，先以 `reference-board.png` 生出整张初版 `ai-board-v1.png`；用户反馈后，以初版整张图和 `text-format-reference.png` 为参照，仅编辑 `textFormat` 所在格。`ai-board-final.png` 将新格合入初版，其他格像素保留。
- 后处理：Pillow 从目标格取图、阈值去背景与边框、等比缩放至 96px 安全区、二值 alpha；VTracer CLI 0.6.5 以仓库同款参数描摹 SVG。

## 最终提示词

```text
Edit the supplied 4-column × 6-row reference board into a COMPLETE SINGLE ICON SHEET. The top two rows contain eight existing Vsidian UI icons. Preserve those reference icons and grid in place. Fill the fourteen blank cells in rows 3–6, left to right, with exactly one dark charcoal (#363C46) icon per cell, matching the existing icons' simple monoline style, stroke thickness, rounded ends, size, optical weight and generous spacing. Keep each icon centered and entirely inside its cell. Keep the white background and light gray cell outlines; no labels, letters outside icon semantics, gradients, shadows, decorations, or extra marks. Last two cells of row 6 stay empty.

Exact target cell order and semantics:
row 3: (1) externalLink: square with arrow pointing outward toward upper left; (2) textFormat: highlighter marker nib; (3) paragraphStyle: paragraph sign ¶; (4) insertPlus: short list lines and a plus sign.
row 4: (1) normalText: three simple horizontal text lines like ≡; (2) cut: open scissors; (3) copy: two overlapping square sheets; (4) paste: clipboard with checkmark.
row 5: (1) selectAll: dashed outline rectangle; (2) comment: percent sign % as code comment symbol; (3) pastePlain: clipboard with capital T; (4) media: film strip.
row 6: (1) footnote: small page with pen; (2) callout: quotation mark in a rectangular callout block; (3)(4) blank.

The 14 icons must read clearly when downscaled to 18 px. Use crisp minimal silhouettes with no shading.
```

## `textFormat` 修订提示词

```text
Edit image 1, the 4-column by 6-row Vsidian icon board. Image 2 is the user's tiny reference for the NEW "textFormat" icon: a small outlined paint brush angled diagonally, with a short rounded handle, a distinct ferrule and compact bristle head. In image 1, replace ONLY row 3 column 2 (the current highlighter marker icon) with a clean dark-charcoal (#363C46) monoline paint-brush icon inspired by image 2. The brush must be centered in that cell, use the same optical size, line weight, rounded ends, and minimalist style as the other icons, and remain clear at 18px. It must have no underline or highlighter chisel silhouette and should not resemble row 2 column 4, the existing highlight icon. Preserve every other icon, blank cell, white background, and gray grid exactly. Do not add labels, shading, gradients, or extra marks.
```
