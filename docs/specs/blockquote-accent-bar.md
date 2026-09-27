# 规格：引用块紫色提示边条

状态：已实施（工单 [#143](https://github.com/ONEGAYI/vsidian/issues/143)）。本文是引用块提示边条换色的单一事实源，工单验收以此为准。

## 范围

- **覆盖**：Live 引用行与阅读 blockquote 的左侧提示竖条颜色升级；新增主题变量族。
- **排除**：背景底（既有 `--vscode-textBlockQuote-background` 灰底维持，不新增紫色背景）；引用块其余样式（缩进、内边距、前景色变量）。

## 现状要点（勘察证实 2026-09-27）

- 两侧**均有** 3px 左竖条，但颜色走 VSCode 灰调主题变量 `--vscode-textBlockQuote-border`——观感不显眼的根因是灰调而非缺失（已核实无变量名笔误）：
  - Live：`.vsidian-quote-line` inset box-shadow（`src/webview/main.css:1148-1151`）
  - 阅读：`blockquote` border-left（`src/webview/main.css:1845-1851`）

## 已确认决策（2026-09-27 澄清答复）

1. **浓度**：明显 accent 紫（非 Obsidian 式灰紫）。
2. **范围**：仅竖条。
3. **机制**：新建 `--vsidian-quote-bar-color` 变量族——`#app` 定义、亮暗主题各一档、Live 与阅读两处同引（同 heading-color 先例，一处定义多处生效）。
4. **初值**：亮 `#7c3aed` / 暗 `#a78bfa`；视觉验收微调后写回本规格。

## 用户故事

1. 作为读者，我希望引用块一眼可辨，紫色竖条清晰标记「这是引用」。

## 实施决策

- Live 与阅读两处改引新变量；CSS 契约测试钉住「`#app` 定义 + 两处引用」（参照 outlineCssContract 先例）。

## 验证与完成条件

- **测试**：CSS 契约测试；绘制层断言（两侧颜色一致且为紫，明暗主题各验一次）。
- **回归**：compile / test:unit。
- **用户人工验收**：明暗两主题下「显眼」程度确认，色值微调在此环节并写回规格初值。

Blocked by: 无
