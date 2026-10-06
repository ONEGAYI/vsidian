# 双链文件输入联想实施批次

## 状态与范围

2026-10-05 用户确认拆分并授权发布，已创建[总览 #374](https://github.com/ONEGAYI/vsidian/issues/374)、V01 验证票 #375 与 T01–T07 子票 #376–#382。本地票面记录自包含范围、实际依赖和验收标准；功能尚未实施。用户本轮另授权推送、合并文档并清理独立工作树。

**2026-10-06 实施完成**：V01 与 T01–T07 全部实施完毕（T01–T06 已合入；T07 为本批收口票——全量回归、三档容量测量与交付落档，结果见[人工验证清单](manual-verification.md) T07 节与[容量基准](../perf/2026-10-wikilink-completion-capacity.md)）。总览 #374 保持开放；人工待验（真实 IME／物理输入／观感／Remote SSH）不随自动化通过而关闭。

主规格：[双链文件输入联想](wikilink-completion.md)。架构依据：[全文件清单](../adr/0013-wikilink-completion-file-catalog.md)、[VSCode 查询复用](../adr/0014-vscode-query-matching-for-wikilinks.md)。匹配证据：[Ctrl+P 源码核查](../research/vscode-quick-open-matching.md)。

## 拆分与依赖

| 本地号 | GitHub Issue | 票面 | Blocked by | 用户故事 |
| --- | --- | --- | --- | --- |
| V01 | [#375](https://github.com/ONEGAYI/vsidian/issues/375) | [双链联想 V01——补写块 ID 与尽力撤销真宿主验证](wikilink-completion-tickets/v01.md) | 无 | U10、U11、U12 |
| T01 | [#376](https://github.com/ONEGAYI/vsidian/issues/376) | [双链联想 T01——Markdown 文件候选首条闭环](wikilink-completion-tickets/t01.md) | 无 | U01、U04、U07、U08、U15、U16 |
| T02 | [#377](https://github.com/ONEGAYI/vsidian/issues/377) | [双链联想 T02——全文件清单、资源候选与增量维护](wikilink-completion-tickets/t02.md) | [#376](https://github.com/ONEGAYI/vsidian/issues/376) | U06、U07、U14、U15 |
| T03 | [#378](https://github.com/ONEGAYI/vsidian/issues/378) | [双链联想 T03——目标区编辑、转阶段与输入仲裁](wikilink-completion-tickets/t03.md) | [#376](https://github.com/ONEGAYI/vsidian/issues/376) | U02、U03、U04、U05、U08、U13 |
| T04 | [#379](https://github.com/ONEGAYI/vsidian/issues/379) | [双链联想 T04——标题联想、未保存正文与重名提示](wikilink-completion-tickets/t04.md) | [#377](https://github.com/ONEGAYI/vsidian/issues/377)、[#378](https://github.com/ONEGAYI/vsidian/issues/378) | U05、U08、U09、U14、U15 |
| T05 | [#380](https://github.com/ONEGAYI/vsidian/issues/380) | [双链联想 T05——块候选、自动 ID 与撤销收尾](wikilink-completion-tickets/t05.md) | [#375](https://github.com/ONEGAYI/vsidian/issues/375)、[#379](https://github.com/ONEGAYI/vsidian/issues/379) | U05、U08、U10、U11、U14、U15 |
| T06 | [#381](https://github.com/ONEGAYI/vsidian/issues/381) | [双链联想 T06——表格及引用内部 Live 完整接入](wikilink-completion-tickets/t06.md) | [#377](https://github.com/ONEGAYI/vsidian/issues/377)、[#378](https://github.com/ONEGAYI/vsidian/issues/378)、[#379](https://github.com/ONEGAYI/vsidian/issues/379)、[#380](https://github.com/ONEGAYI/vsidian/issues/380) | U01、U02、U03、U05、U08、U10、U11、U12、U13 |
| T07 | [#382](https://github.com/ONEGAYI/vsidian/issues/382) | [双链联想 T07——容量、跨环境回归与交付收口](wikilink-completion-tickets/t07.md) | [#381](https://github.com/ONEGAYI/vsidian/issues/381) | U01、U02、U03、U04、U05、U06、U07、U08、U09、U10、U11、U12、U13、U14、U15、U16 |

V01 与 T01 可并行；T02 与 T03 在 T01 完成后可并行。T04 等两者收敛，T05 另需 V01 的明确放行结论，T06 验证所有 Live 位置，T07 收口。

总览不标 ready-for-agent；初始仅 V01、T01 可认领。已关闭的 #194 索引批次和已落地的引用内部 Live 是现有基础，不列为未完成依赖。附加组件 #347、#348／#349 及 API／SDK 均不列为前置。

## 可审阅的阶段结果

- T01：主正文的 Markdown 文件候选、键盘选择、相对路径、默认别名与真实可见性。
- T02／T03：所有未排除文件可搜索，常用资源空查询排序，完整目标区重编辑与键盘仲裁。
- T04／T05：明确 Markdown 的标题／块候选，重名 toast，无 ID 补写与尽力撤回。
- T06：表格、悬停、正文嵌入和递归内部 Live，以实际来源文档为基准。
- T07：全量回归、三档容量、Remote 及人工待验归档。

这些是迭代交付边界，不能将 T01 单独作为整批已完成或已发布的功能。

## 发布与事实源

票面已核对并按依赖顺序发布，所有模板变量已替换为真实 Issue 引用。本地票面与总览同步记录实际编号；后续修改或重试先核对既有同标题议题，避免重复开票。

新总览附完整规格快照，使未推送的本地文档不成为阅读票面的前置。不得关闭或重开既有父议题；新总览保持开放，自动化、代理自检和用户验收分别记录。

本轮授权范围为票面发布、文档推送合并及工作树清理；功能代码与产品发布另行安排。尚未执行本功能的代码实现或回归，本轮检查仅验证规格／票面、依赖、远端发布结果和文件树一致性。
