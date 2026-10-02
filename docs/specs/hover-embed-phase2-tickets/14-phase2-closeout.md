# test: 二期组合、性能、兼容性与交付收口

本地编号：P2-14

GitHub：[#291](https://github.com/ONEGAYI/vsidian/issues/291)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#280](https://github.com/ONEGAYI/vsidian/issues/280)（P2-03）、[#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）、[#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）、[#285](https://github.com/ONEGAYI/vsidian/issues/285)（P2-08）、[#286](https://github.com/ONEGAYI/vsidian/issues/286)（P2-09）、[#287](https://github.com/ONEGAYI/vsidian/issues/287)（P2-10）、[#288](https://github.com/ONEGAYI/vsidian/issues/288)（P2-11）、[#289](https://github.com/ONEGAYI/vsidian/issues/289)（P2-12）、[#290](https://github.com/ONEGAYI/vsidian/issues/290)（P2-13）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U01–U26；验收 P2-A01–A15。

## 问题与交付

所有容器复用一套编辑能力后，需要跨组合证明边界一致并给出实际资源、兼容性和人工待验记录。

完成验收矩阵对账、最低宿主／Remote 路径证据、全文 Live 资源实测、公开样式检查与人工清单；未完成项明确列出。

## 实施范围

- 按容器 × 父模式 × 内部模式 × 全文／标题／块对账；补跨票真实场景：浮窗内递归、表格格内递归、C 资源归属、模式覆盖后关闭。
- 覆盖多视图共享历史、普通失焦／显式关闭、确认期间新版本、原生 diff 转交失败和父关闭在途，优先既有高层生产入口。
- 实测短／长目标、重复目标、宽分支、快速开关、滚动离屏：统计 EditorView、端口、watch、在途、全文／解析预算及回收。
- 最终 contract 仅删除全部调用方迁移并验证后的旧单实例入口；不能删除公开样式契约或前期来源安全边界。
- 整理自动化结果、性能报告和真实中文 IME／鼠标／观感／Remote SSH 人工待验，更新同一规格和 manual-verification，不把自检当用户验收。

## 验收标准

- [ ] P2-A01–A15 均有对应执行证据或明确受限／待人工条目；不得无证据勾完成。
- [ ] compile、适用 unit、输入 browser、真宿主、i18n、样式契约和文件树检查通过；首次长命令留报告和退出码。
- [ ] reading 组合零写回、Live 操作正确归各直接目标；所有容器的默认／覆盖、初始定位和恢复行为一致。
- [ ] 循环／实例／字节／在途／watch 容量不超既有上界，开关／回收后资源回到稳定基线，无干净离屏 EditorView 预建。
- [ ] 性能报告写明规模、环境、基线、统计口径和暂态；没有实测证据的延迟／内存阈值不声称达标。
- [ ] 1.82.3 下界宿主证据完整，1.86.2 已有调研明确标作对照；Remote SSH 与人工观感、IME 状态分开，剩余问题有明确归属和可复现信息。
- [ ] 所有需新增的文档已通过 file-tree 唯一入口登记；父票不被本地草案流程关闭或重写。

## 复用入口与验证

test/browser 既有生产脚本、test/integration/testHost.mjs、perf 入口；docs/specs/manual-verification.md、docs/perf 与 style-contract 门禁。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
