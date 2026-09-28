# 样式参考条目双语化规格

状态：规格已落盘，待实施（工单对照见文末）。
关联：[i18n.md](i18n.md)（防回潮扫描口径）、[css-snippets.md](css-snippets.md)（#132 样式参考规格落点）、style-contract 技能（`.agents/skills/style-contract/`，清单字段约定）。

## 背景与问题

2026-09-28 验收反馈：英文 VSCode 环境下，设置页「样式参考 → 详细查询」的条目卡片正文仍为中文；页面 chrome（标题、页签、类目栏、过滤、搜索、分页、导出）翻译正常。

诊断结论：这不是漏翻，而是 #132 落档的设计决策——条目内容被定性为「文档数据（中文为准）」，从一开始就豁免于 i18n 体系：

- **数据源**：`src/shared/styleContract.ts`（公开样式契约清单单一事实源）130 条条目的文档字段为中文字符串，经 `scripts/genStyleGuide.mjs` 生成三产物——设置页渲染数据 `src/webview/styleGuideData.ts`、离线 HTML 指南、契约 JSON。
- **渲染侧**：`src/webview/styleReferenceSettings.ts` 的 `renderCard` 中，卡片骨架标签（「Obsidian 对应：」「别名承诺：」、视图徽标、支持等级、弃用/移除前缀）走 `t()` 词条；条目数据字段直接 `textContent` 渲染，不进字典。
- **扫描豁免**：CJK 防回潮扫描器（`test/unit/i18nScan.ts` 的 `SCAN_EXCLUDED_PREFIXES`）显式排除 `styleContract.ts` 与 `styleGuideData.ts` 两路径，豁免理由只落在代码注释，[i18n.md](i18n.md) 的扫描范围描述漏记（文档缺口，工单 4 补齐）。

条目规模：content 域 75 条、chrome 域 55 条（合计 130；`styleContract.ts` 类目定义旁的 69/46 注释已过时，实施时一并订正）。

## 决策回执（2026-09-28 用户澄清）

| 决策点 | 结论 |
|---|---|
| 双语化方案 | **A 数据双语化**（渲染侧键控翻译方案否决——字典膨胀数百键且数据与译文两处维护） |
| 契约 JSON（AI 可读材料） | **不做双语**，维持中文单语 |
| 离线 HTML 指南 | **维持中文单语**——2026-09 起已不随 VSIX 分发（`.vscodeignore` 排除、`scripts/release.mjs` 记载），无运行时消费者 |
| `verification` 字段 | **不译**——开发面验证定位（测试用例 / 探针字段名），翻译破坏可检索性 |
| 数据形态 | **英文平行清单**（expand 形态），不改 130 条存量条目结构 |
| 票粒度 | 4 张独立票；两域翻译票可并行 |
| 规格落盘 | 本文件；独立工作树分支随 PR 合入，合入后为工单补 `ready-for-agent` 标签 |

## 数据形态：英文平行清单

中文清单（`styleContract.ts`）保持权威基准与现有结构不动；新增英文覆盖模块（`src/shared/` 内，模块名实施时定，建议 `styleContractEn.ts`）：

- **形态**：按条目 id 索引的映射，值为该条目文档字段的英文版（字段级覆盖）。
- **取词规则**：渲染与生成按目标语言取英文覆盖，条目或字段无覆盖时回退中文基准——翻译可渐进合入，不阻塞交付。
- **一致性契约测试钉住**：英文覆盖集的 id 集合 ⊆ 中文条目 id 集合；字段键与中文条目形态一致且值非空。
- **CJK 扫描**：英文模块为纯英文数据，不需豁免；既有两路径豁免维持。
- **包体**：英文数据仅进设置页产物（`settings.js`），不进编辑器 webview bundle（字节纪律与现状一致）；实施时核对 settings.js 体积增量。

## 字段分级

| 分级 | 字段 | 说明 |
|---|---|---|
| 双语 | `purpose` / `states` / `obsidian.counterpart` / `dom` / `deprecated` / `removed` | 设置页或 HTML 指南渲染的说明性文案；`removed` 现有 2 条均含中文说明句 |
| 不译 | `target` / `example` / `aliasTargets` / `introduced` / `verification` / `id` / `views` | 代码标识符、CSS 代码、工单号+日期、测试定位——语言无关或可检索性优先 |
| 已双语 | 类目名（`titleKey` → 字典）、页面 chrome（`styleRef.*` 词条） | 既有机制，不动 |

## 渲染与生成链

- **设置页**（`renderCard`）：按 UI 语言取词，英文环境显示英文，缺失回退中文；语言切换后呈现跟随（复用设置页既有换包重刷路径）。
- **契约 JSON 生成**：固定取中文（单语）；meta 是否补语言标记由实施定。
- **离线 HTML 指南**：固定取中文，维持单语产物。
- **生成纪律不变**：产物一致性 `--check` 钉住，改清单后重跑生成并提交。

## 验收要点

- 英文 UI：试点及全量条目显示英文；工单 3 收尾做全局断言——英文 UI 下样式参考页无中文残留。
- 中文 UI：呈现与现状无回归。
- 呈现断言落在用户可见层（文本内容断言，而非 DOM 存在性——PR #37 教训）。
- 英文文案为 agent 初稿，人工校对随验收进行。

## 工单对照

| 工单 | 主题 | 阻塞 |
|---|---|---|
| [#178](https://github.com/ONEGAYI/vsidian/issues/178) | 英文平行清单与取词机制 + 试点端到端（「容器与视图」类目 2 条试点） | 无 |
| [#179](https://github.com/ONEGAYI/vsidian/issues/179) | 正文域 75 条英文文案 | #178 |
| [#180](https://github.com/ONEGAYI/vsidian/issues/180) | 界面域 55 条英文文案 + 全局残留断言 | #178 |
| [#181](https://github.com/ONEGAYI/vsidian/issues/181) | 规格口径补齐（i18n.md / css-snippets.md / style-contract 技能 / 条目计数注释订正） | 无 |
