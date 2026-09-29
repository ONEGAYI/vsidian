# 设置页：合并「CSS 片段」与「样式参考」为「外观」（#231）

> 状态：已实施（2026-09-30）。工单 #231 为单一事实源，本文以其为蓝本落档实施形态与边界。

## 目标与不做的事

设置页侧栏两条分页「CSS 片段」（#128）与「样式参考」（#132）合并为一条**「外观」**，消除两条样式相关分页的入口碎片化。既有能力全部不回归：片段目录与逐项开关、暂停/恢复、手动刷新、契约浏览/过滤/搜索、导出 JSON、全局搜索定位。

**不做**：不改两个子分页的内部逻辑（片段状态机、契约渲染管线）；不动 `toggleDualView` 与主编辑器 webview；不新增页签层级。

## 已拍板决策（防回摆）

- **页签结构**：扁平三页签，不加嵌套层级。
- **默认页签**：从侧栏进入外观时默认第一页签「CSS 片段」；搜索定位与宿主命令按目标页签落。
- **搜索路由**：按条目归属落页签（见下）。
- **分页 id 与命令**：新分页 id `appearance`；`openStyleReference` 命令 id 与标题保留，行为改为打开外观并定位「样式参考」页签。
- **实现形态**：组合复用现有两个分页类作为页签体，`snippets.state` 消息接线不动；不重写分页内部逻辑。
- **i18n**：新增 `appearance.*` 词条（双语 parity）；页签文案沿用现有键；被替代的描述键随之清理。

## 页签结构

```
外观分页（id: appearance，调色板图标，取 CSS 片段原槽位）
├── 页签条：role=tablist，类名 vsidian-style-ref-tabs / vsidian-style-ref-tab
│   ├── CSS 片段   （t('cssSnippets.title')，默认激活）
│   ├── 样式参考   （t('styleRef.tabOverview')）
│   └── 详细查询   （t('styleRef.tabDetail')）
├── 面板 .vsidian-appearance-snippets   ← CssSnippetSettingsSection.mount 页签体
├── 面板 .vsidian-style-ref-overview    ← StyleReferenceSection.mountPanels 填充
└── 面板 .vsidian-style-ref-detail      ← 同上
```

- 页签机制与 #155 样式参考两态页签同源（pill 页签、`aria-selected` 单选、`hidden` 面板切换），`settingsPage.css` 的既有页签样式契约与「detail 可见时主区滚动收起」规则（`.vsidian-settings-main:has(.vsidian-style-ref-detail:not([hidden]))`）照常生效，零新增 CSS。
- 页签体组合：`AppearanceSection`（`src/webview/appearanceSettings.ts`）持有 `CssSnippetSettingsSection` 与 `StyleReferenceSection` 实例；mount 时把 focusEntry 原样传给两侧——两侧定位注册表互不重叠（`directory`/`snippet:*` 仅片段侧命中；`overview` 与契约 id 仅契约侧命中），不匹配的一侧按无定位处理。
- `StyleReferenceSection` 抽出 `mountPanels(overviewHost, detailHost, focusEntry)` 页签体形态（内容构建、类目分栏、过滤搜索、分页、定位与原逻辑同源，不创建页签条、不接管显隐）；`mount` 保留为独立两态页签形态（自包含消费与回归网）。
- `snippets.state` 消息接线不变：settingsMain.ts 直连 `snippets.handleHostMessage`，宿主推送就地回显到 CSS 片段页签体（页签隐藏时亦回显，切回即见最新状态）。

## 搜索路由（routeAppearanceTab 纯函数）

| focusEntry | 落点 |
| --- | --- |
| 无（侧栏进入） | CSS 片段页签 |
| `directory`、`snippet:<文件名>` | CSS 片段页签（目录行/条目定位高亮） |
| `overview` | 样式参考页签 |
| 其余（契约条目 id） | 详细查询页签（跳类目与页 + 定位高亮） |

全局搜索的 entries 由外观分页聚合两子分页：`[...snippets.entries, ...styleRef.entries]`。

## 协议变更（向后兼容）

`settings.focusSection` 增加可选 `entry` 字段（`src/shared/protocol.ts` 类型与校验分支两处同步）：

```ts
| { kind: 'settings.focusSection'; section: string; entry?: string }
```

- 校验：`section` 必填字符串；`entry` 缺省或字符串，其余形态拒绝。
- `selectSection(id, entry?)` → `render(entry)` 透传；宿主 `openWithSection(section, entry?)` 在 ready 前到达时随 pendingSection 挂起、握手后按同形态补发；entry 缺省时消息不带该字段（#132 起的既有形态不变）。
- `openStyleReference` 命令（id 与标题不变）行为改为 `openWithSection('appearance', 'overview')`。

## 图标变更

- `icon()` 工厂 `palette` 分支改为**调色板**（lucide palette 主体轮廓线性化，四个颜料孔以 `stroke-linecap: round` 圆点子路径表达，仍为单 path 线性风格；下缘内凹即拇指孔）。
- `book` 字形随样式参考侧栏条目退役：从 `icon()` 分支与 `SettingsPageSection.icon` 联合类型中移除（全仓引用扫描确认无他处使用）。

## i18n

- 新增 `appearance.title` / `appearance.description`（双语 parity 编译期把关；描述文案取工单草稿）。
- 页签文案沿用现有键：`cssSnippets.title` / `styleRef.tabOverview` / `styleRef.tabDetail`；页签条 aria-label 沿用 `styleRef.tabNav`。
- 清理：`cssSnippets.description`（唯一消费者是被替代的片段分页描述 getter）随 getter 退役删除；`styleRef.description` 保留（全局搜索 overview 条目的描述仍消费）。

## 样式契约边界（style-contract 流程记录）

设置页 webview 的类名（`vsidian-settings-*`、`vsidian-style-ref-*`、`vsidian-css-snippets-*`、`vsidian-appearance-*`）不在公开样式契约清单（`src/shared/styleContract.ts`）与界面域探针表（`src/shared/chromeContract.ts`）中，属内部类名；本票零改动契约清单与基线，`npm run check:stylecontract` 八项零失败。呈现类断言落在用户可见层（页签切换后的可见面板、文案、定位高亮），不落纯 DOM 存在性。

## 验收标准（工单原文）

- [x] 侧栏五条：常规、编辑器、快捷键、外观、索引维护；「外观」为调色板图标 —— `settingsPage.test.ts`（navTitles 与 icon path 断言）
- [x] 外观页三页签齐备且顺序正确，默认落在「CSS 片段」 —— `appearanceSettings.test.ts`（页签文案/顺序/aria-selected/面板显隐）
- [x] 全局搜索命中片段条目落 CSS 片段页签、契约条目落详细查询页签，定位高亮与滚动行为与现状一致 —— `settingsPage.test.ts` 搜索路由用例 + `routeAppearanceTab` 矩阵；定位/滚动逻辑未改（复用两子分页既有实现）
- [x] `openStyleReference` 命令打开外观并落在「样式参考」页签 —— `extension.ts` 接线 + `settingsPageHost.test.ts`（entry 透传与挂起补发）+ `settingsPage.test.ts`（focusSection entry 直达）
- [x] 片段与契约两侧既有能力无回归（相关单测同步更新并全绿）—— `cssSnippetSettings.test.ts` / `styleReferenceSettings.test.ts` / `styleReferenceSettingsEn.test.ts` 全量保留并通过

前四项自动化已覆盖；真实 IME、物理鼠标与视觉观感仍按惯例由人工验收（见 `manual-verification.md` 增补项）。
