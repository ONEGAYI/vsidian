# 菜单场景图标生图与裁切记录（#441）

13 枚图标已生成并处理，用户查看逐张预览后于 2026-10-11 授权接线。生成器可重建明暗两套 PNG/SVG；菜单 CSS 接线与真实右键截图像素回归已完成。真实宿主中的物理鼠标观感仍按人工验证清单执行。

- 工具：Codex 内置 ImageGen，一次生成整张图板；Pillow 裁切与规范化；VTracer CLI 0.6.5 描摹真实 SVG path。
- 参考：既有 `table`、`copy`、`insertPlus`、`externalLink` 浅色图标，排在四列五行参考板的首行。保持现有单色、圆角线稿风格。
- 最终原图：`menu-scenes-ai-board.png`，1122×1402，RGB；首行四枚是风格参照，不纳入新增资产。
- 单张裁切源图：`menu-scenes-source.png`，1248×96，RGBA，13 格按下表顺序排列。
- 裁切：原图按四列五行等分，边界取最近整数；目标格内缩 20px 排除网格线。灰度 `<176` 提取墨迹，按墨迹包围盒等比缩至最长边 80px，Lanczos 缩放后二值化（`>=128`），居中放入 96×96 格。alpha 仅为 0/255，保留 8px 安全边距；不补画图形。
- 主题：浅色 `#363C46`、深色 `#D2DAE5`，两套共用同一 alpha；SVG 参数与校验复用 `scripts/quick-action-icons.py`。
- 对账：13 枚新 key 均已由场景票登记在 `CONTEXT_MENU_ICON_KEYS` 与生成器 `KEYS`；本轮补源图注册、菜单 CSS 与运行时资产清单。链接场景依实际描述符复用 `externalLink`（打开）、`link`（复制地址）与 `copy`（复制显示文字）。

## 元素对应

| 编号 | key | 原图格位 | 对应菜单元素 | 图形语义 |
| --- | --- | --- | --- | --- |
| 01 | `insertRowAbove` | 第2行第1列 | 表格：上方插入行 | 表格上侧加号 |
| 02 | `insertRowBelow` | 第2行第2列 | 表格：下方插入行 | 表格下侧加号 |
| 03 | `insertColumnLeft` | 第2行第3列 | 表格：左侧插入列 | 表格左侧加号 |
| 04 | `insertColumnRight` | 第2行第4列 | 表格：右侧插入列 | 表格右侧加号 |
| 05 | `deleteRow` | 第3行第1列 | 表格：删除行 | 横向行区域与减号 |
| 06 | `deleteColumn` | 第3行第2列 | 表格：删除列 | 纵向列区域与减号 |
| 07 | `deleteTable` | 第3行第3列 | 表格：删除表格 | 表格与叉号 |
| 08 | `selectRow` | 第3行第4列 | 表格：选择行 | 横向行区域与鼠标指针 |
| 09 | `selectColumn` | 第4行第1列 | 表格：选择列 | 纵向列区域与鼠标指针 |
| 10 | `removeQuote` | 第4行第2列 | 引用块内表格：移除引用块 | 引用竖条、文字与减号 |
| 11 | `popupPreview` | 第4行第3列 | 图形块：弹窗预览 | 四角框与向外箭头 |
| 12 | `exportSvg` | 第4行第4列 | 图形块：导出 SVG | 下载箭头与带节点曲线 |
| 13 | `exportPng` | 第5行第1列 | 图形块：导出 PNG | 下载箭头与像素方格 |

原图第5行其余三格留空。没有新增媒体、脚注、callout 或 database 图标。

## 生图提示词

```text
Use case: ui-mockup
Asset type: Vsidian context-menu icon source sheet, thirteen new icons for an 18px menu.
Primary request: Complete the supplied FOUR-COLUMN by FIVE-ROW reference board as ONE single consistent icon sheet. Keep the four reference icons in the top row. Fill the next thirteen blank cells with one new icon each in the precise order below. The final three cells must remain empty.
Input images: Image 1 is a layout and style reference board. Its top row contains existing Vsidian table, copy, insert-plus and external-link icons; its other rows define the target positions.
Style/medium: Clean single-color monoline UI icons. Match the top row's dark charcoal #363C46 ink, medium stroke weight, rounded line ends, straight grid geometry, simple forms and generous whitespace. Use roughly 1.7–2-unit strokes on a 24-unit icon grid, balanced ink density, NO decorative details. Each icon must be easily recognizable when scaled to 18px.
Composition: Preserve the exact regular 4 × 5 grid, white background and thin light-gray grid lines. Center every icon in its cell, similar optical size to the reference icons, occupying approximately 40–50 percent of the cell width/height. All dark ink must stay far from cell borders. Treat related table icons as one coherent family, with consistent grid geometry.
Exact new cell order:
ROW 2, column 1: insertRowAbove — small table grid with a clear plus sign ABOVE its top horizontal row; plus position indicates inserting a row above.
ROW 2, column 2: insertRowBelow — matching table grid with a clear plus sign BELOW its bottom horizontal row.
ROW 2, column 3: insertColumnLeft — small table grid with a clear plus sign at its LEFT side, aligned with the center vertical column.
ROW 2, column 4: insertColumnRight — matching table grid with a clear plus sign at its RIGHT side.
ROW 3, column 1: deleteRow — compact table grid with an emphasized HORIZONTAL row and an adjacent clear MINUS sign; make row deletion visually distinct from column deletion.
ROW 3, column 2: deleteColumn — compact table grid with an emphasized VERTICAL column and an adjacent clear MINUS sign.
ROW 3, column 3: deleteTable — compact table outline/grid and a clear diagonal X at its lower-right corner.
ROW 3, column 4: selectRow — compact table grid with one emphasized HORIZONTAL row and a small simple mouse-pointer outline at lower right. Keep the pointer uncluttered.
ROW 4, column 1: selectColumn — matching table grid with one emphasized VERTICAL column and the same small simple mouse pointer at lower right.
ROW 4, column 2: removeQuote — one upright blockquote bar on the left, two short horizontal text strokes to its right, and a clear MINUS sign at lower right. This means remove blockquote formatting.
ROW 4, column 3: popupPreview — four square corner brackets, with two simple diagonal outward arrows toward opposite corners, suggesting expand into a preview popup.
ROW 4, column 4: exportSvg — downward download arrow beside a simple smooth Bezier curve with two endpoint nodes, representing exporting a vector graphic. No letters.
ROW 5, column 1: exportPng — matching downward download arrow beside a small 2 × 3 array of square pixels, representing exporting a bitmap. No letters.
ROW 5, columns 2, 3 and 4: keep EMPTY.
Constraints: Exactly 13 new icons plus the four top-row references; no labels or text, no SVG/PNG letters, no numbers, no gradients, no shadows, no fill color other than charcoal, no watermarks, no extra symbols or borders other than the original cell grid. Light/dark variants will be made afterwards from these same silhouettes.
```

## 本轮验证

- 缺图基线：既有生成器运行失败，`Unknown icon: insertRowAbove`，退出码 1。
- 源图注册后：`python scripts/quick-action-icons.py` 通过，退出码 0；55 枚图标、110 PNG + 110 SVG，总览 5280×192。
- 生成器逐个校验 PNG 的尺寸、主题色、透明度、安全区，以及 SVG 的 viewBox、非空 path、无位图嵌入。
- 既有 42 枚图标的 PNG/SVG 未改变；新增资产与既有图标共同纳入总览。
- 96px 与 18px 明暗主题预览已制作，用户已授权接线；13 枚新增图标与链接簇三项在浅色、深色、高对比度主题下经真实右键打开并验证截图墨迹像素。
- 生成器、CSS 两表契约、运行时包内容清单与缺失资产负向断言通过。浏览器 `contextMenu` 22 场景通过；自动化不代替真实宿主的物理鼠标观感验收。

