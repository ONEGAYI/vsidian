# 规格：编辑器工具栏双态视图切换按钮

状态：已实施（工单 [#141](https://github.com/ONEGAYI/vsidian/issues/141)；[#158](https://github.com/ONEGAYI/vsidian/issues/158) 起按钮移至工具栏右端组）。本文是该按钮与切换通道的单一事实源，工单验收以此为准。

## 范围

- **覆盖**：webview 编辑器顶栏（`.vsidian-toolbar`）新增阅读 / Live 双态切换按钮；配套的 webview→宿主切换请求通道。
- **排除**：源码模式入口（右上角三态按钮为源码路径唯一入口）；设置页 webview；快捷键行为变更（仅做入口评估记录）。

## 现状要点（勘察 2026-09-27）

- 工具栏装配 `buildToolbar`：左端齿轮 + 快速操作 `✎`；#158 起右端组 = 双态切换（持有 `margin-left:auto` 推靠）+ 侧栏按钮紧随其后（`src/webview/main.css`），与左组间弹性空隙。
- #38 起视图切换收敛宿主：`setViewMode` 为 private，仅宿主 `view.mode.set` 驱动（`src/webview/syncController.ts:1866-1867`）；`WebviewToHost` 无视图切换请求消息；先例 `keybindings.execute` 出站 → 宿主 executeCommand → 回发 `view.mode.set`。

## 已确认决策（2026-09-27 澄清答复）

1. **位置**：#141 定为工具栏右侧、紧邻侧栏按钮左侧（按钮序：齿轮、`✎`、双态切换、侧栏）；#158 起视觉上移入右端组——双态切换持有 `margin-left:auto` 推靠右端、侧栏开关紧随其后，与左侧组（齿轮、`✎`）间为弹性空隙。DOM 序始终未动。
2. **形态**：单按钮切换，图标随当前态（阅读态显书本类图标、Live 态显编辑类图标），点击切到另一态。
3. **通道**：新增 webview→宿主请求消息（protocol.ts 单一事实源），宿主复用 `runViewSwitch` 裁剪为 live↔reading 双态；按钮态由既有 `view.mode.set` 驱动。

## 交互契约

1. **点击行为**：live→reading、reading→live；走同一 `runViewSwitch` 记忆语义（最近停留模式照常更新）；不触及源码路径。
2. **图标与 aria-label**：随当前态与界面语言双变化，进 localeDom 换包重刷注册表（参照侧栏按钮 `bindLocaleFnAttrs` 先例）。
3. **与右上角三态按钮互不回归**：`vsidian.activeMode` context 与按钮互斥显隐 when 条件不变；阅读态下右上角「转源码」仍可用。
4. **键盘可达**：原生 button，Tab 可达、Enter / Space 激活；`mousedown preventDefault` 防抢正文焦点（沿用 `✎` 按钮策略：只拦默认聚焦不拦 click，保留表格格区）。
5. **快捷键入口**（2026-09-27 用户增补，已定）：「双态切换」单列为可绑定操作（`onegayi.vsidian.mode.toggleDualView`，双模式生效、默认 **ctrl+q**），与工具栏按钮共用同一目标推导（当前态取反）与同一 `runViewSwitch` 编排；触发走既有 `keybindings.execute` 出站 → 宿主 executeCommand → 同一双态切换实现，不另造路径。源码模式不经 webview 键路由，天然不涉及。
6. **宿主命令的源码态兜底（已实现边界，已记 keybindings.md）**：命令面板或键绑在**源码编辑器态**触发 `toggleDualView` 时，目标推导仍为取反——源码态取反得 live，经 `open-in-vsidian` 分支回 Vsidian 面板（不落源码自环、不弹「已在源码」提示）；工具栏按钮本身在面板内常驻、不出现在源码态，此兜底只作用于宿主命令入口。

## 用户故事

1. 作为编辑者，我希望不动鼠标到窗口右上角，直接在编辑器顶栏一键在阅读与 Live 之间切换。
2. 作为用户，我希望按钮图标告诉我当前在哪个模式，点一下就到另一个。

## 实施决策

- **协议**：出站消息命名与载荷遵循 protocol.ts 既有风格（如 `view.switch.request`）；契约测试同步。
- **宿主**：textEditorProvider 处理新消息 → `runViewSwitch` 双态分支。
- **webview**：`buildToolbar` 在侧栏按钮前插入；内联 SVG 图标（不引 codicon 依赖，参照既有按钮）。

## 验证与完成条件

- **测试**：协议契约单测；jsdom 控制器单测（出站消息、图标随态、换包重刷）；集成（真宿主点击切换、与三态按钮 / 记忆模式一致性）。
- **视觉层断言**：按钮绘制层可见且 DOM 序在侧栏按钮之前（契约测试钉住）；#158 起浏览器套件补几何断言——按钮位于工具栏水平中点右侧、与侧栏开关以 gap 紧邻组成右端组。
- **回归与文档**：compile / test:unit / test:browser / test:integration；更新 keybindings.md、README 双语、人工验证清单、文件树。
- **用户人工验收**：位置（#158 起与侧栏开关组成右端组、侧栏开关左侧）与图标随态的观感。

Blocked by: 无
