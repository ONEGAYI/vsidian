# Obsidian 选择器映射表（已退位：迁移至结构化清单）

> **本文件已不再是事实源**（#132，2026-09-27）。全部条目（选择器、变量、
> 不支持项与虚拟化限制，共 110 条）已逐项迁移至结构化清单：
>
> - **单一事实源**：`src/shared/styleContract.ts`（`STYLE_CONTRACT_ENTRIES`）
> - **别名桥实现同源表**：`src/shared/obsidianAlias.ts`（DOM 双类名与变量 fallback）
> - **用户指南**：由清单生成（`scripts/genStyleGuide.mjs` →
>   `media/style-reference/style-reference.html` 与设置页数据模块），设置页
>   「样式参考」分页离线可查；生成一致性由 `test/unit/styleGuideGen.test.ts` 钉住
> - **契约测试**：`test/unit/styleContract.test.ts`（schema + 迁移完整性快照）、
>   `test/unit/obsidianAlias.test.ts`（别名发射与探针资产一致性）
>
> 请勿在本文件增改条目——此处修改不会进入指南与测试，属无效竞争事实源。

## 初始基线（冻结证据）

迁移底稿为本文 @ 提交 `6ef5997`，与已发布 **v0.4.0** tag
（`75c3df79074bdeaec0f02a38d40124f0cd66f857`）的本文内容**逐字节一致**
（`git diff --stat v0.4.0 6ef5997 -- docs/design/obsidian-selector-map.md` 为空，
选择器条目 74 行对 74 行）——即迁移底稿就是 v0.4.0 的公开契约快照，不存在
「发布后、迁移前」的未发布契约改动。逐项迁移对照表（110 条）与核对命令
见工单 #132 实施日志 `logs/migration-parity.txt` 与
`logs/baseline-freeze-2026-09-27.md`（本地留证，不入库）；对照表的可回归
断言在 `test/unit/styleContract.test.ts` 的 `MIGRATION_PARITY` 快照。

## 历史沿革（保留溯源，不承载现状）

本文自 #6（2026-09-23）建立至 #78（2026-09-26）增补，记录了以下工单逐步
建立的稳定样式入口：#6 容器与阅读结构、#8 span 级映射与阅读语义标签、
#9 任务勾选交互类、#10 链接/图片、#11 双链、#12 表格、#42 实时预览表格网格、
#55 移除 live 标题行左缘竖线（唯一弃用/移除先例：`--vsidian-heading-accent`）、
#59 公式、#60 Mermaid、#65–#70 大纲面板、#78–#84 代码块卡片。#105 高亮与
#106 分割线渲染态为最后两次增补。

各条目的用途、适用视图、DOM 关系、Obsidian 对应项及支持等级（direct /
semantic / native / none）、验证定位与生命周期字段的**现状**一律以清单为准；
本文的历史表格内容已随迁移移除（git 历史可查：`git show 6ef5997:docs/design/obsidian-selector-map.md`）。

## 核对来源（历史参考）

- Obsidian 官方帮助（CSS snippets 格式参考）：https://obsidian.md/help/snippets
- 社区实际片段与论坛讨论确认的选择器族（`.markdown-preview-view` 系、
  `.HyperMD-header-N` 行级与 `.cm-header-N` span 级的分工、`.task-list-item` 系）：
  - [Live Preview: Style header font attributes? — Obsidian Forum](https://forum.obsidian.md/t/live-preview-style-header-font-attributes/32053)
  - [obsidian-css-snippets/Snippets/Headers.md — GitHub](https://github.com/Dmytro-Shulha/obsidian-css-snippets/blob/master/Snippets/Headers.md)
  - [Background formatting for text under a header — Obsidian Forum](https://forum.obsidian.md/t/background-formatting-for-text-under-a-header/47385)

> 来源链接为选择器核对依据，不证明本项目已具备对应兼容能力；能力范围以
> 清单「支持等级」为准。
