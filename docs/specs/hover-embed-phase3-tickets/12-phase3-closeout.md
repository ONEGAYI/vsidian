# test: 三期组合、资源、下界兼容与交付收口

本地编号：P3-12

GitHub：[#344](https://github.com/ONEGAYI/vsidian/issues/344)

父票：[#228](https://github.com/ONEGAYI/vsidian/issues/228)

Blocked by: [#336](https://github.com/ONEGAYI/vsidian/issues/336)（P3-04）、[#339](https://github.com/ONEGAYI/vsidian/issues/339)（P3-07）、[#341](https://github.com/ONEGAYI/vsidian/issues/341)（P3-09）、[#343](https://github.com/ONEGAYI/vsidian/issues/343)（P3-11）

状态：2026-10-04 用户确认方案及 12 票拆分，已发布；未实施。保留上述技术前置。P3-02／P3-03 的依赖解除要求可行路线通过，不能仅凭研究票关闭。

规格：[三期正式规格](../hover-preview-embed.md)；用户故事 全部 P3-U1–U12。

## 问题与交付

四类能力组合验收、性能／包体证据及人工待验清单。

## 实施范围

- 核对三期四块范围和全部逐票契约；跨类型反复切换、递归来源、两个同目标实例、父模式切换、删除／恢复及网络开关组合。
- 独立统计宿主文本／二进制、webview 解析／token、图片解码、PDF canvas／worker、外链缓存和来源订阅；记录逻辑费用与实测进程内存的区别。
- 完成下界 1.82.3 真实宿主、浏览器绘制、开发与安装态产物验证，1.86 保留兼容对照；Remote SSH 另列实际执行和待人工验收。
- 核对新增操作默认绑定／模式范围、i18n 两语言、设置持久化／回显、历史样式兼容、源码与索引 rename 语义和文件树。
- 更新唯一规格、已选择路线的 ADR／领域术语、性能与人工验证记录；不把四期 #330 算作三期完成前置。

## 验收标准

- [ ] 功能票各自已有证据，组合矩阵没有遗漏；只读 PDF／图片／文本／网页行为全部零文档写回，二期 Markdown Live 回归通过。
- [ ] 100 次开关／目标切换、长 PDF／长文本、多兄弟引用与大图／动图后，存活任务／worker／Blob／订阅与实例准确对应，无持续累积。
- [ ] compile、适用 unit／browser／integration／安装态与 style-contract／file-tree 检查通过；首轮长命令日志和退出码完整，后续只读报告复核。
- [ ] VSIX 真正包含锁定渲染资产，现有总包与单文件硬阈值通过；未执行 Remote SSH／真实鼠标／观感列为待验，不勾成已通过。
- [ ] 没有把纯文本降级、未通过技术路线、网站无条件可嵌入或四期资源管理器能力标为已交付；父 #228 是否收口由实际完成条件判断。

## 复用入口与验证

全部三期票、test/browser/run.mjs、test/integration/testHost.mjs／runInstalled.mjs、scripts/checkStyleContract.mjs、file-tree 工具；docs/specs/manual-verification.md。

## 明确排除

资源管理器小浮窗四期、发布版本／推送／合并授权、历史版本功能与原本不在本期的编辑能力。

## 共同完成条件

- 对可执行行为先补能暴露目标问题的契约测试，再实现；采用生产 browser／真实宿主等既有高层入口，不只检查消息调用次数或 DOM 存在。
- 呈现变更先加载项目 style-contract、固定旧契约，提供实际绘制和 CSS 契约证据。所有用户文字经 locales／t()，设置只进 Vsidian 自有页面。
- 每个新增操作登记可绑定入口、默认值和有效状态；只读内容不接管写操作，焦点和 Esc 沿用已有优先级。
- 来源验证、请求代次、目标版本、挂载释放及已存在预算都必须保持；自动化通过不等同用户验收。首次长命令即落盘日志和退出码，复核读取报告。
- 每票按一个新 agent 上下文安排；发现需要扩大接口／产品范围时报告增量并重切片，不将不完整行为标为完成。本票不授权推送、PR、合并或版本发布。

完整依赖与发布次序见[票据索引](README.md)。
