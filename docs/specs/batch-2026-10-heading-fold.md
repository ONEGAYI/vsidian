# 正文标题折叠实施批次

## 状态与范围

2026-10-09 #409 to-spec 阶段落定规格（提交 0ad04ddf，`feat/heading-fold` 分支），同轮 to-tickets 切片开票：T01–T04 子票 #412–#415。父票 #409 保持开放，功能尚未实施。

主规格：[正文标题折叠](heading-fold.md)。语义边界研究：[折叠能力探针](../research/addon-fold-capability-probe.md)（#403）。下游：[#410](https://github.com/ONEGAYI/vsidian/issues/410)（折叠能力对附加组件开放，依赖本批落地后推进）；插件侧 [vsidian-easy-typing#18](https://github.com/ONEGAYI/vsidian-easy-typing/issues/18)（折叠标题 Enter，验收口径随本批「阅读折叠不开放」定案收窄为仅 Live）。

## 拆分与依赖

| 本地号 | GitHub Issue | 票面 | Blocked by | 用户故事 |
| --- | --- | --- | --- | --- |
| T01 | [#412](https://github.com/ONEGAYI/vsidian/issues/412) | 折叠本体、区间派生与坐标生命周期 | 无 | U05、U06、U07、U08、U09、U12、U14 |
| T02 | [#413](https://github.com/ONEGAYI/vsidian/issues/413) | 五操作注册、命令分发与 shift 符号映射 | [#412](https://github.com/ONEGAYI/vsidian/issues/412) | U02、U03、U04、U13 |
| T03 | [#414](https://github.com/ONEGAYI/vsidian/issues/414) | gutter 折叠箭头与省略号占位 UI | [#412](https://github.com/ONEGAYI/vsidian/issues/412) | U01、U13 |
| T04 | [#415](https://github.com/ONEGAYI/vsidian/issues/415) | 落点展开联动与批次收口 | [#413](https://github.com/ONEGAYI/vsidian/issues/413)、[#414](https://github.com/ONEGAYI/vsidian/issues/414) | U06、U10、U11、U12 |

T01 为唯一无前置票（发布时标 ready-for-agent，其余不标）；T02 与 T03 在 T01 完成后可并行；T04 等两者收敛并承担批次收口——落点展开五处接线、外部同步光标钳制、人工清单并入、AGENTS.md 落档节与全量回归。用户故事编号为规格「用户故事」节第 1–14 条序号。

## 发布与事实源

票面按依赖顺序发布（T01→T02→T03→T04，票号顺次），全部自包含目标、范围、验收标准与「实施前必读规格节」指针。规格文档位于 `feat/heading-fold` 分支提交 0ad04ddf、尚未合入 main——票面已注明提交号与「随本批首个实施 PR 落库」，未推送的本地文档不构成阅读票面的前置。父票 #409 不自动关闭；自动化、代理自检与用户验收分别记录，人工待验（真实 IME、物理鼠标、观感）不随自动化通过而关闭。
