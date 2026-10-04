# 文件与链接分页组标题图标生图记录（#332）

## 选定结果

- 原图：`refview-index-ai-board.png`（1774×887），左格为 `pointerLink`，右格为 `dbLink`。
- 裁切源图：`refview-index-source.png`（192×96，RGBA）。左格为 `pointerLink`，右格为 `dbLink`；每格 96×96、透明背景、单色白墨、二值 alpha。
- `pointerLink` 用于「引用视图」组标题，意象为手型指针落在下划线链接上；`dbLink` 用于「索引维护」组标题，意象为数据库圆柱体与右下角锁链。

## 生图工具与提示词

使用 Codex 内置 `image_gen`，通过一次生成得到两格横排透明图。输入参考为 `contact-sheet.png` 的图标家族与 `settings-sections-source.png` 的设置页组标题图标。

```text
Use case: ui-mockup
Asset type: A single generated source board for two monochrome subsection-header UI icons used at 16 px.
Input images: Image 1 is the existing Vsidian quick-action icon family and is the style reference; Image 2 shows the current settings-section icon family, especially its bold, rounded visual weight.
Primary request: Generate exactly two distinct symbols arranged left to right in one landscape 2:1 transparent canvas, each centered in an equally sized square cell with a generous clear gap. Left cell: a recognizable hand-shaped mouse pointer with an extended index finger pointing down onto a short horizontal underlined link; make both the hand and underline unmistakable at tiny size. Right cell: a familiar database cylinder with a compact chain-link symbol attached at its lower-right corner; the database and chain must both remain recognizable.
Style/medium: Very simple solid-fill monochrome glyphs, compact, bold, rounded terminals and curves, matching the weight and visual simplicity of the supplied settings-section icons. Use only solid closed shapes with transparent negative-space cutouts for internal details, not fine line art.
Composition/framing: Two equal square icon cells side by side, left = hand pointer over underlined link, right = database cylinder plus lower-right chain link; centered and balanced in each cell, similar visual size and density, enough transparent margin for a 96×96 icon cell.
Color palette: One solid near-black ink color only; background fully transparent.
Constraints: Crisp flat shapes with hard edges suitable for thresholding to binary alpha and vector tracing; preserve clear silhouettes and separate components so each glyph stays readable at 16 px.
Avoid: Text, labels, numerals, borders, panel frames, grid lines, shadows, gradients, highlights, texture, background, extra symbols, embellishments, blur, watermark.
```

## 裁切记录

原图从中线分为两个 887×887 像素格。各格按 alpha ≥128 提取前景，保持长宽比缩入 80×80 像素范围并居中放入 96×96 画布；输出前景为白色，alpha 再二值化。源图顺序与生成器登记一致：`pointerLink`、`dbLink`。
