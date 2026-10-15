# [T08] 实施：Codex 内核主题退役、旧设置迁移与包体收口

## 状态与前置

父票：[规格/总览 #533](https://github.com/ONEGAYI/vsidian/issues/533)。本票切片编号：T08。

Blocked by: [#546](https://github.com/ONEGAYI/vsidian/issues/546)
外部前置：[bridge#3](https://github.com/ONEGAYI/vsidian-codex-bridge/issues/3) 与经安装验证的兼容组件产物（来源可由 bridge#4 的分发交付提供）。

主规格：[addon-themes.md](https://github.com/ONEGAYI/vsidian/blob/main/docs/specs/addon-themes.md)。实施前阅读全部“契约/边界/验证”节；本票只交付下列故事，不把规格定稿当作功能完成。

用户故事：H-U09、H-U10、H-U12，并复验 H-U05–H-U07/H-U11。

## 目标与范围

- 前置包括 T07、bridge#3 完成及具体可安装可用的兼容组件产物；不要求 bridge#3 先等待本票。
- 对仍有效选择旧内核 codex 的 profile 回落 default，提供一次性 i18n 安装引导；不覆盖用户已选组件主题，不自动安装/选择。
- 删除内核 Codex 专属枚举、色板、ELK 依赖/分块及图类适配，保留 default 与公开 Mermaid 样式入口。
- 通过实际打包评估 SIZE_LIMITS，更新 release 技能/包内容门禁、CHANGELOG、外观规格和人工验证记录。

## 验收标准

- [ ] 记录组件具体版本/提交、可安装产物及安装验证结果；只有 API 完成或 bridge#3 关闭不足以放行。
- [ ] 升级路径 TDD 覆盖旧 codex/default/已选组件主题，重开、重启、多窗口引导只一次且不改用户新选择。
- [ ] 安装态能从统一主题页选择组件 Codex，流程图及六类图亮暗、ELK、画布、导出与显式配置对照通过。
- [ ] default 和公开 .vsidian-mermaid 族旧片段实际命中保持；历史基线不动。
- [ ] compile、unit、browser、integration、样式契约与 release 打包/包内容检查通过，日志及退出码首次落盘。
- [ ] 报告实际包体与最大单文件，依据实测重估阈值并同步发布约定；人工待验如实记录。

## 不包含

不承担 bridge 仓库的色板/ELK实现，不自动发布本体或组件，不提前删除尚无可用替代的内核功能。

## 验证与维护纪律

- 可执行行为遵循 TDD，优先使用生产控制器/公开 SDK/真宿主的既有测试接缝。
- 呈现变更按 ui-patterns/style-contract，至少一条断言落绘制层；涉及输入/光标必跑 browser。
- API 变更同步 addonApiCatalog、生成参考、编译期消费者和覆盖映射；若声明/语义冻结命中，兼容基线显式重锚定须同 PR 独立说明。候选台账不写虚构发行日期。
- 长命令首次即保存日志、退出码或工具报告，复核读已有报告。文档/人工验收与自动化结果分开，不关闭父票代替整体验收。
