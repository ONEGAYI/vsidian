# test: 二期组合、性能、兼容性与交付收口

本地编号：P2-14

GitHub：[#291](https://github.com/ONEGAYI/vsidian/issues/291)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#280](https://github.com/ONEGAYI/vsidian/issues/280)（P2-03）、[#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）、[#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）、[#285](https://github.com/ONEGAYI/vsidian/issues/285)（P2-08）、[#286](https://github.com/ONEGAYI/vsidian/issues/286)（P2-09）、[#287](https://github.com/ONEGAYI/vsidian/issues/287)（P2-10）、[#288](https://github.com/ONEGAYI/vsidian/issues/288)（P2-11）、[#289](https://github.com/ONEGAYI/vsidian/issues/289)（P2-12）、[#290](https://github.com/ONEGAYI/vsidian/issues/290)（P2-13）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `414938ae`，合并 `29e18875`，与 main 前移 PR #314 零冲突自动合并）。七项验收自动化通过，证据见下「执行记录」与 manual-verification P2-14 节对账表；Remote SSH/真实 IME/物理鼠标归人工清单，未冒充已验收。

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

- [x] P2-A01–A15 均有对应执行证据或明确受限／待人工条目；不得无证据勾完成。（对账表在 manual-verification P2-14 节：A01–A07/A09–A12/A14 自动化通过；A08 真实 IME、A13 真实观感、A15 Remote SSH 为待人工）
- [x] compile、适用 unit、输入 browser、真宿主、i18n、样式契约和文件树检查通过；首次长命令留报告和退出码。（独立树六门 + 合并树四门，见执行记录表）
- [x] reading 组合零写回、Live 操作正确归各直接目标；所有容器的默认／覆盖、初始定位和恢复行为一致。（组合场景套件 embedLiveCloseout S1–S4 + 各票既有例回归）
- [x] 循环／实例／字节／在途／watch 容量不超既有上界，开关／回收后资源回到稳定基线，无干净离屏 EditorView 预建。（性能六场景：快速开关 10 轮重发 0/端口随切换释放重建；离屏往返对称无泄漏）
- [x] 性能报告写明规模、环境、基线、统计口径和暂态；没有实测证据的延迟／内存阈值不声称达标。（docs/perf/2026-10-ref-phase2-291.md——绝对耗时/堆为本机噪声漂移已声明）
- [x] 1.82.3 下界宿主证据完整，1.86.2 已有调研明确标作对照；Remote SSH 与人工观感、IME 状态分开，剩余问题有明确归属和可复现信息。
- [x] 所有需新增的文档已通过 file-tree 唯一入口登记；父票不被本地草案流程关闭或重写。（父代理经 file-tree 登记四新文件；父票 #227 由 PR #313 正文管理）

## 复用入口与验证

test/browser 既有生产脚本、test/integration/testHost.mjs、perf 入口；docs/specs/manual-verification.md、docs/perf 与 style-contract 门禁。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-14` 完成（codeblock.copy 接线 TDD 4 例先红 `logs/p2-14/red-codeblock-copy.log`），提交 `414938ae`，合并 `29e18875`（与 main 前移 PR #314 及收尾 76d3ce1f 零冲突自动合并——codeblock.copy 走 refEdit.message 信封与 #314 消息族无交错；合并树四门复验）。

**交付要点**：

- **codeblock.copy 接线**（P2-11 移交项落地）：代码卡复制按钮经目标端口（refEdit.message 信封）走宿主剪贴板——B 会话按自身 docUri 守卫 + B 文档 EOL 归一（与根面板 #81 同语义）；协议联合类型/校验白名单/宿主注入四处接线。
- **P2-10 组合缺口闭合实证**：B 内空白表格 IME 组合「笔|记」经表格规划转义落格「笔\|记」不增行（S5）；票据 10 边界区结论已更新。
- **表格网格化「不复现」**：P2-09 移交时疑似缺陷在当前树不成立——装配自 P2-02 起就在 liveInstance，B/C 两级编辑器实测网格渲染正常（S6 断言钉住防回退）。
- **性能六场景**（`docs/perf/data/ref-phase2-291.json`）：短目标×8（端口全建/视口驻留 3/dispose 归零）、长目标 1000 段、重复×12 与宽分支×12（occurrence 独立计费/离屏回收）、快速开关 10 轮（59ms、重发 0）、滚动离屏往返对称。
- **P2-A01–A15 对账**：见 manual-verification P2-14 节对账表——12 项自动化通过，3 项待人工（A08 IME/A13 观感/A15 SSH）。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` / 全量 unit（248 文件/5314） | 通过 | `logs/p2-14/final-compile3.log` / `final-unit.log` |
| browser 全量 67 套件（含新 embedLiveCloseout 5 场景） | 全过 | `logs/p2-14/final-browser-full.log` |
| 定向集成 1.82.3（P2-14 两新例 + 代表回归） | 9/9 | `logs/p2-14/integration-p214-targeted.log` |
| runPerf 基线 + 性能探针六场景 | 通过 | `logs/p2-14/perf-*.log` |
| `npm run check:stylecontract` | 八项零失败 | `logs/p2-14/final-stylecontract.log` |

合并树复验（`logs/merge-p2-14-*`，叠加 main 合并 76d3ce1f）：compile 通过、全量 unit 259 文件/5405 例、browser 9 套件（embedLiveCloseout + richPaste 族 + 嵌入族交叉）、定向集成 10/10、sensitive 4/4。

**归档的已知边界**：嵌入图周期核验不覆盖（1.5 期同口径）；浮窗内子卡悬停无触发路径（live 链接非 a[href]）；#315 连击缺陷另行跟踪；嵌入实例未接 #314 粘贴钩子另行归档（`onPasteTxnAcked`/`onExternalDocSettled`/`onHistoryIntent`/`onRichPasteHtml` 仅根实例接线，代码注释已声明——嵌入内 rich paste 无「已保留格式」toast、粘贴后 undo 不恢复粘贴前选区、原生 Ctrl+V 的 HTML 走纯文本默认链；撤销分段本身正常，`withPasteMeta`/`markUndoSegmentBoundary` 系实例方法已随实例生效；#317 对齐口径）；dispose 微秒竞态/窗口退出维持 P2-13 边界；contract 清理项核实无「已迁移旧单实例入口」可删。
