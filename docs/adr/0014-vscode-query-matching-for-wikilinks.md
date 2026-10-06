# 双链候选以 VSCode 查询与匹配逻辑为基线

## 状态

2026-10-05 用户确认直接基于 VSCode 查询逻辑实现候选联想，仅按 Vsidian 的实际需要作少量修改。方向已接受，查询匹配实现和完整技术规格尚未交付。

2026-10-06 T07 收口核对（#382）：移植已随 T01（#376）落地于 `src/shared/wikilinkQuery.ts`，文件头部固定声明来源提交 `2dca67a07aba894351849f39d337a921758722e8`（microsoft/vscode 的 `src/vs/base/common/fuzzyScorer.ts` scoreFuzzy/prepareQuery/scoreItemFuzzy 与 `src/vs/base/common/filters.ts` matchesPrefix）与上游许可 MIT（Copyright (c) Microsoft Corporation，随本项目 MIT 依赖分发合规），并列明四项适配差异（路径分隔符归一、不移植完整比较器、不移植 PATH_IDENTITY/评分缓存、引号连续匹配按上游口径）；核查记录与官方测试例对照见[研究记录](../research/vscode-quick-open-matching.md)。官方测试例对照契约测试在 `test/unit/wikilinkQuery.test.ts`；大库费用实测见[容量基准](../perf/2026-10-wikilink-completion-capacity.md)。来源、版本与许可三方（代码头注、本 ADR、研究记录）一致。

## 背景与决定

双链输入联想需要成熟的文件名和路径匹配，用户提出以 VSCode Ctrl+P 为参考，随后明确采用其现有查询逻辑作为实现基线。源码核查表明，其模糊评分有文件名／前缀加权、路径和多词分支，不能用四段分类排序准确替代；证据与固定参照见[研究记录](../research/vscode-quick-open-matching.md)。

以 VSCode 的查询准备与匹配评分逻辑为主体，按需要适配 Vsidian；不从零另定一套替代评分。具体代码复用范围、依赖处理、来源版本与适配差异在技术规格和实现中明确记录。

## Vsidian 的适配边界

- **候选来源**：继续使用 [ADR-0013](0013-wikilink-completion-file-catalog.md) 的全类型文件清单，沿用索引排除规则，并限定直接来源所属根。
- **排序**：空查询的常用资源按 mtime 从新到旧；有查询先比匹配分数，同分再比 mtime，最终以稳定路径／身份破同分。采用评分逻辑时需要协调 VSCode 完整比较器中的额外长度和文本比较，不能让这些步骤先消耗掉 mtime 的同分排序。
- **查询与插入**：查询来自双链目标区的光标左侧前缀；选定后生成实际编辑文档的相对路径，主正文与引用内部 Live 保持同一来源口径。字段切换、默认显示文字、用户已有别名及 Esc 行为按[交互共识](../specs/wikilink-completion.md)执行。

## 后果与验证

匹配行为以现成实现和官方测试为依据，Vsidian 只对已确认的差异增加自己的契约证据。引入源码时固定参照，保留相应来源与许可信息；上游改变不会自动改变已经交付的匹配行为。

本决定不表示可以直接调用 VSCode 内部 Quick Open provider，也不决定将整套 provider、编辑历史或跨根路径直达接入 Vsidian。代码抽取和依赖适配、大库费用、平台语义、未保存内容与迟到结果仍需验证；不能把源码阅读当作实现或运行通过。
