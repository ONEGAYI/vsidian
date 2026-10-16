# 附加组件 API 扩展与 Codex 迁移批次

## 状态与计数

2026-10-15 用户批准：四张规格/父票 + 八张实施票，共十二张；旧票 #530–#533 改造为规格/父票，#534/#535 保留为实施票，新增六张实施票。T01/T03/T05/T07 已在组合分支实现，T02 正则/条件/嵌套、T04 普通链接尾部行号与 T06 组件容器嵌入亦已实现并合入第二批次集成分支，均待用户整体验收；T08 为仅存未实现票。四份规格覆盖整个批次，当前交付不代表全部规格完成；规格父票保持开放，自动化与用户验收分别记账。

## 四份规格与父票

| 父票 | 正式规格 | 实施切片 |
| --- | --- | --- |
| [#530](https://github.com/ONEGAYI/vsidian/issues/530) | [声明式粘贴转换](addon-paste-conversion.md) | T01 / T02 |
| [#531](https://github.com/ONEGAYI/vsidian/issues/531) | [文档导航与普通链接行号](addon-navigation.md) | T03 / T04 |
| [#532](https://github.com/ONEGAYI/vsidian/issues/532) | [只读引用视图](addon-reference-views.md) | T05 / T06 |
| [#533](https://github.com/ONEGAYI/vsidian/issues/533) | [统一主题与内核退役](addon-themes.md) | T07 / T08 |

父票链接规格、实施票及验收进度，保持开放；规格定稿不关闭功能需求。每张实施票包含完整纵向接线、测试、API 契约和文档更新，不另设仅补门禁或仅补测试的尾票。

## 实施清单与覆盖

| 切片 | Issue | 交付 | Blocked by | 故事 |
| --- | --- | --- | --- | --- |
| T01 | [#541](https://github.com/ONEGAYI/vsidian/issues/541) | [基础粘贴规则完整链路](addon-api-extension-tickets/t01-paste-registration.md) | 无 | P-U01–P-U06、P-U09–P-U11 |
| T02 | [#542](https://github.com/ONEGAYI/vsidian/issues/542) | [正则、条件和嵌套转换](addon-api-extension-tickets/t02-paste-expressions.md) | [#541](https://github.com/ONEGAYI/vsidian/issues/541) | P-U07/P-U08，复验基础 |
| T03 | [#543](https://github.com/ONEGAYI/vsidian/issues/543) | [组件文档打开与定位](addon-api-extension-tickets/t03-document-navigation.md) | 无 | N-U01–N-U07、N-U12 |
| T04 | [#534](https://github.com/ONEGAYI/vsidian/issues/534) | [普通链接尾部行号](addon-api-extension-tickets/t04-link-line-suffix.md) | [#543](https://github.com/ONEGAYI/vsidian/issues/543) | N-U08–N-U11，复验定位 |
| T05 | [#544](https://github.com/ONEGAYI/vsidian/issues/544) | [只读引用浮窗](addon-api-extension-tickets/t05-reference-popup.md) | 无 | R-U01–R-U07、R-U12 |
| T06 | [#545](https://github.com/ONEGAYI/vsidian/issues/545) | [组件容器只读嵌入](addon-api-extension-tickets/t06-reference-embed.md) | [#544](https://github.com/ONEGAYI/vsidian/issues/544) | R-U08–R-U11，复验只读 |
| T07 | [#546](https://github.com/ONEGAYI/vsidian/issues/546) | [统一主题完整链路](addon-api-extension-tickets/t07-theme-system.md) | 无 | H-U01–H-U08、H-U11 |
| T08 | [#535](https://github.com/ONEGAYI/vsidian/issues/535) | [Codex 内核退役与迁移](addon-api-extension-tickets/t08-codex-retirement.md) | [#546](https://github.com/ONEGAYI/vsidian/issues/546)、[bridge#3](https://github.com/ONEGAYI/vsidian-codex-bridge/issues/3)、可安装产物 | H-U09/H-U10/H-U12，复验主题 |

四份规格共 47 条用户故事：粘贴 11、导航 12、引用视图 12、主题 12；上表是全部故事的实施规划。首轮仅交付 T01/T03/T05/T07，各故事实际覆盖见[API 覆盖映射](vsidian-addons-coverage.md)。后续票仍按前置结果认领，不能把本轮回归通过写成全部 47 条故事已实现。

## 依赖关系

```mermaid
flowchart LR
  T01[基础粘贴规则] --> T02[正则/条件/嵌套]
  T03[文档导航 API] --> T04[普通链接行号 #534]
  T05[引用浮窗 API] --> T06[组件容器嵌入]
  T07[统一主题 API] --> B3[bridge#3 组件主题]
  T07 --> T08[内核退役 #535]
  B3 --> T08
  PKG[兼容且可安装的组件产物] --> T08
```

bridge#3 不再以 #535 的移除动作为上游前置。它等待 T07 提供可消费主题接口；#535 反向等待 bridge#3 与安装证据，消除循环。组件仓库 bridge#1 的脚手架、bridge#3 的运行时/ELK 决策和 bridge#4 的分发工作仍由原票管理，不计入本仓库十二张票，也不由本次文档发布擅自执行组件发布。

bridge#2 的粘贴规则仍消费 #530 的实现；本文不额外改造该组件票或把它当作主题退役前置。

## 共同维护与验收口径

- 公共 API 声明、语义目录、生成参考、消费样例和覆盖映射随各实施票维护。历史兼容的显式重锚定须同 PR 独立说明，不改台账伪造发行。
- TDD 优先现有公开 SDK/生产控制器接缝，UI 断言落绘制层；输入/光标变更跑 browser，宿主路径跑真实宿主。长命令首次落日志和退出码，后续复核读报告。
- 呈现票执行 ui-patterns / style-contract；#535 另外执行 release 打包体积与包内容检查。实施证据只覆盖已交付切片，不生成未来实现或用户视觉已验收的结论。
- 各实施 PR 引用实施票，不用自动关闭语句关闭规格父票。父票在实施与整体验收记录齐全后收口，真实视觉/IME/物理鼠标待验按人工清单保留。
- 文档提交按仓库纯文档约定进入 main；本批代码实施仍走 PR 与对应必需检查，不继承文档豁免。

## 首轮组合实现与验证（2026-10-15）

组合分支为 `addon-api-batch`（[PR #548](https://github.com/ONEGAYI/vsidian/pull/548)）。T01 已在分支内，随后按 T03 → T05 → T07 真实合并，组合实施锚点为 `8cf6a681`；各票历史对象保持可达。后续补齐测试隔离、来源 B 文件基线，以及 T01 槽声明、整数优先级与继承格式。同步主线视口修复后，独立双轴审查及修复均已完成；用户整体验收仍未完成。当前候选 API 锚点为 `f28a3e3d`，重锚理由与失败证据见[API 门禁记录](addons-api-gate.md)，不据此关闭规格父票。

以下日志位于联合工作树 `D:/CODE/Project/_Extensions/vsidian-addon-batch` 的 `out/test/addon-batch-takeover/`，只留本地，不随 VSIX 分发。结果按实际轮次记账，失败报告不覆盖：

| 检查 | 结果与证据 |
| --- | --- |
| 编译与生成产物 | 审查修复后 `review-fixes-compile.log` exit 0；API 参考由生成器更新 |
| 全量单元与 Node 契约 | 最新主线同步与审查修复后，367 文件 / 8337 项 Vitest、195 项 Node/桌面契约通过，0 跳过（`review-fixes-full-unit.log`）。首次清单解析和后续 T01/T07 红绿证据均保留；早期 7 项桌面跳过已由默认 desktop 全套实跑补齐 |
| 全量浏览器 | 同步主线与继承格式修复后 102/102 套全绿（`final-browser-before-review.log`，报告 `browser-runs/run-b7CptW`）；后续审查补丁定向复验 `addonPasteRules`、`addonThemes`、`graphicPopup`、`addonRendererTakeover` 全绿（`review-fixes-*-browser.log`）。早期 101/102 失败和修复记录保留于 `full-browser.log` / `full-browser-language-fixed.log` |
| 全量真实宿主 | `all` 组四片首轮 423/430 通过；隔离夹具面板、事件缓存和渲染首选后，二轮 429/430。唯一来源 B 失败经状态证实为前序目录 move 清理删除 `sub`；本例重建两个自有目标后，先验证目录 move → 来源 B 两例，再完整重跑分片 1 的 108 项全绿。分片 2–4 的 322 项二轮已全绿，本次未改其执行代码；430 项全部取得 PASS。证据：`integration-first-run/`、`integration-second-run/`、`integration-with-predecessors.log`（37/37）、`integration-directory-predecessor.log`（2/2）、`full-integration-s1-fixed.log`（108/108） |
| T01 宿主历史链 | `final-t01-real-host.log` exit 0：真实组件登记、已开/新开双面板广播、纯文本旁路、两阶段 Undo/Redo、停用回收与重启登记 |
| 样式与 API 门禁 | `delivery-gates.log`：生成新鲜度、候选锚点可信复验及 10 项 API 兼容检查通过；独立历史样式基线复验及 8 项检查通过。主题修复的旧锚失败和显式重锚证据在 `review-fixes-compat-red.json` / `review-fixes-baseline.log` |
| 文件树 | `delivery-gates.log` strict 通过，当前首选派生语言快照的职责已通过维护工具补齐；未新增第二份文件树或手写生成参考 |

真实宿主全量的上述 430 项为组合回归阶段证据。最终主题审查补丁后，`review-fixes-theme-host.log` 通过增强的 #546 场景：真实同语言普通提供者竞争、双文档绘制、主题停用/撤销/整组件故障回内置、声明外语言保留普通规则及恢复。profile 共用存储重建的冷启动回落由 `t07-profile-red.log` → `t07-profile-focused-unit.log` 覆盖，后者 148/148；不将该单测表述为真实 VSCode 重启已由用户验收。

独立审查按固定 HEAD `9e49fad0` 分离 Standards / Spec 两轴。Standards 的模板缓存寿命、主题名称对象所有权及补丁新增的持久化原始诊断三项 P2，Spec 的全局节点预算终止、失效主题语言回落两项 P2 均已修复；各轴对自己的发现独立复核，未遗留已确认问题。粘贴预算/缓存红两项 → 49 项定向绿（`review-paste-budget-cache-*.log`）；主题同语言竞争及名称快照红四项 → 定向绿（`t07-review-*.log`）。最终 Standards 复核锚点 `9dfb10ad`，Spec 主题复核锚点 `f28a3e3d`，之后仅生成参考、基线和交付文档变化。

样式旧契约固定于 v0.4.0（`75c3df79074bdeaec0f02a38d40124f0cd66f857`），组合前目标分支清单对象另存 `style-before-merges.json`；保留既有浮窗选择器和变量，设置页沿用原位置与控件档位。自动化运行的是开发态宿主，安装态 T16 与 Remote SSH T17 按既有阶段门控跳过，本轮未执行 VSIX 安装或 SSH 矩阵。

人工待验继续由[人工验证清单](manual-verification.md)和各规格实施段承载，以下项目仍未由用户验收：

- T01：真实来源内容的粘贴结果、纯文本选择，以及物理键盘操作下的两阶段撤销手感。
- T03：实际组件控件打开 Markdown / 原生文本、保留目标模式，及引用 B 内相对路径导航的使用体验。
- T05：真实按钮/文字旁的浮窗位置、鼠标联合域保活、键盘进入与 Esc 归还焦点，递归内容只读。
- T07：主题单选与来源标识、真实 VSCode 重启回显、跟随系统与固定 VSCode 主题的明暗行为、高对比可读性。Codex 内核继续保留，替代组件分发与退役不在本轮完成范围。
