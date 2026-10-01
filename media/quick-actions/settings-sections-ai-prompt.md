# 设置页标题组图标生图记录（#265）

## 选定结果

- 原图：`settings-sections-ai-board.png`（1704×923）。下排左一是 `typewriter`，左二是 `wordSegment` 的 A 方案；后两格是未选的 B、C 候选。
- 裁切源图：`settings-sections-source.png`（192×96，RGBA）。左格为 `typewriter`，右格为 `wordSegment`；每格 96×96、透明背景、单色白墨、二值 alpha。
- 2026-10-01 用户确认：打字机采用照片造型版，中文分词选 A。纸张、滚筒与宽扁机身取自用户在会话中提供的打字机照片；该照片不入库。

## 生图工具与提示词

使用 Codex 内置 `image_gen`。第一张输入板由既有 `textFormat`、`findPrev`、`externalLink`、`findInSelection` 浅色 PNG 排成上排，下排留四格。首轮合并生成一枚打字机和三种分词候选，随后四次编辑同一张图：先修纸张，再以用户照片重画打字机，接着把已选定的 A 方案加高、收紧以适配 16px 标题，最后按用户反馈将第四行圆点改成短线并与第三行长线换位。最终原图为第五次输出。

首轮提示词：

```text
Use case: logo-brand
Asset type: source concept sheet for two tiny settings-page icons
Input image: the attached 4-column by 2-row reference board is the edit target. Keep its canvas, cell borders, positions, labels, and the entire TOP ROW of four existing icons unchanged. Draw ONLY inside the four empty cells in the BOTTOM ROW, one icon per cell, centered with generous equal margins.
Primary request:
- Bottom column 1 TYPEWRITER: a recognizable vintage manual typewriter icon. Include a clearly protruding sheet of paper above a low rounded machine body and just 3 to 5 obvious keys along the front. Paper and body silhouette must remain distinguishable from a computer keyboard at 18px. No actual letters on the paper.
- Bottom column 2 WORD A: Chinese word segmentation concept A, one horizontal stream of small abstract glyph-like strokes split into TWO distinct word groups by a single strong vertical separator and a wide gap.
- Bottom column 3 WORD B: concept B, TWO rounded open brackets each containing 2 to 3 short abstract strokes, like two words grouped from one text line. Do not draw actual characters.
- Bottom column 4 WORD C: concept C, a continuous abstract text line divided into THREE separated compact clusters by two short vertical cut marks. Do not draw actual characters.
Style/medium: monochrome dark slate ink matching the top-row samples, minimal vector-friendly linear icon strokes, approximately the same visual weight and round caps/corners as existing examples. No fill blobs; no shadows, gradients, texture, glow, ornament, badges, scissors, keyboards, or decorative motion lines. Each icon must survive reduction to 18px. All bottom icons should be visually balanced and distinct, on the unchanged white cell background. Avoid text or typography INSIDE icons.
```

第二轮仅修正纸张的提示词：

```text
Edit the attached icon concept sheet. Keep the sheet layout, borders, labels, top row reference icons, and all three WORD candidate icons exactly as they are. Change ONLY the bottom-left TYPEWRITER icon. It currently resembles a small monitor above a keyboard. Replace its rectangular screen-like top with a clearly visible narrow vertical PAPER SHEET emerging upward from the typewriter roller: open flat top edge, white paper interior, rounded dark outline, a lower roller beneath it. Keep the low trapezoid machine body and four simple round keys. No letters, no screen, no gradients or shadows. Preserve monochrome dark slate ink, minimal rounded line style, generous margins, and 18px readability.
```

第三轮以照片重画打字机的提示词：

```text
Use case: precise-object-edit
Input image 1 is the 4-column icon concept board and the edit target. Input image 2 is the photograph of the orange Brother typewriter and is a SHAPE REFERENCE ONLY.
Edit ONLY the bottom-left TYPEWRITER icon on image 1. Preserve all other icon cells, labels, top-row references, grid, and white background.
Primary request: isolate the actual TYPEWRITER + PAPER silhouette visible in image 2, then abstract it into a minimal single-color rounded LINE ICON for a 18px settings heading. Preserve these distinctive proportions from the photo: a broad low horizontal trapezoid body with sloped rounded front corners, a wide recessed keyboard deck across its lower front, two raised shoulder housings flanking a shallow central curved typing well, a long horizontal roller at the back, and a SINGLE tall sheet of paper rising vertically from that roller behind the low body. The sheet must be visibly taller than the machine body, wider than it is tall but narrower than the body, with a simple open outline and blank interior. The machine should look wide and squat, not like a small monitor on top of a triangle. Reduce the keys to only two short staggered rows of small circles or dashes, enough to suggest the keyboard without detail.
Style: dark slate monochrome strokes matching the four top-row references, about the same rounded stroke weight and overall visual density; no solid color fill, orange, text, brand, letters, mug, plants, pen, table, decorations, gradients, shadows, or photorealism. Center within the bottom-left cell with the same generous safe margins. Do not change any other bottom-row candidate.
```

第四轮保持 A 方案语义、提高小字号辨识度的提示词：

```text
Edit the attached 4-column icon concept board. Change ONLY the bottom-row second cell labeled WORD A. Keep the TYPEWRITER icon, top-row references, WORD B and WORD C, borders, labels, canvas and white background exactly unchanged.
WORD A has already been selected by the user as the Chinese word-segmentation design: two groups of abstract text-like marks separated by one strong vertical divider. Preserve that exact concept. Improve its readability when reduced to a 16px settings heading: make the entire WORD A icon more compact horizontally and visibly taller, with each word group formed by three short rounded strokes stacked in three rows rather than two, a small dot or shorter stroke on each side if useful, and a central vertical separator that spans the full height of the groups. The complete pictogram should have a roughly 1.4:1 width-to-height ratio inside its cell, with stroke weight and rounded caps matching the other icons. No actual letters, no brackets, no keyboard, no scissors, no extra ornament, no gradient or shadow.
```

第五轮按用户反馈调整 A 方案行序的提示词：

```text
Precise edit of the attached 4-column icon sheet. Change ONLY the WORD A icon in the bottom row, second cell. Keep every other cell, especially TYPEWRITER, exactly unchanged.
WORD A currently has a tall central vertical separator and, on BOTH its left and right sides, three long horizontal rounded strokes in rows 1, 2, 3 plus a round dot in row 4. Apply this exact row rearrangement symmetrically on both sides: rows 1 and 2 stay as long horizontal rounded strokes; row 3 becomes a SHORT horizontal rounded dash (replace the old row-4 dot with a dash and move it into row 3); row 4 becomes the former long row-3 horizontal stroke. Thus the top-to-bottom pattern on each side is LONG, LONG, SHORT, LONG, with no dots anywhere. Keep the central vertical divider, dimensions, spacing, stroke weight, dark slate monochrome, rounded ends, white background, labels and borders unchanged. No text inside the icon, no extra shapes.
```

## 裁切与矢量化

使用 Pillow 11.3.0 从最终原图的 `(80,530,380,825)`、`(485,545,800,815)` 两个区域提取深色线条：灰度小于 130 算墨水，按非空边界裁切，等比居中缩入 80×80，再放进 96×96 的 8px 安全边；缩放后二值化 alpha。源图只存 alpha 形状，生成器按 `COLORS` 着浅色 `#363C46`、深色 `#D2DAE5`。

运行 `python scripts/quick-action-icons.py`，由 VTracer CLI 0.6.5（color/spline/cutout）对 PNG 提取真实 SVG path，并逐项执行生成器的 PNG/SVG 校验。最终 SVG 没有手写路径或位图嵌入。
