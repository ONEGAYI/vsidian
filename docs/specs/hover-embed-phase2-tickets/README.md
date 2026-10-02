# 悬停与嵌入二期票据索引

**状态**：2026-10-02，用户确认 14 票拆分并授权开票，已发布 #278–#291。前三张无本地技术前置的票已加 ready-for-agent，其他票保留阻塞依赖。**P2-01 研究已完成并收口**（2026-10-02 探针交付、2026-10-03 用户确认两项取舍）：四条路线 1.82.3 真宿主探针全部通过、无阻塞，依赖票的本票前置已放行，结论见[探针报告](../../research/vscode-1823-host-route-probes.md)。**P2-02、P2-03、P2-04 已实施并合入 PR #313**（2026-10-02/03，`c197eaa`、`5c22110`、`d166ec7`），验收自动化通过，见[票据 02](02-live-instance-seam.md)／[票据 03](03-full-document-navigation.md)／[票据 04](04-embed-target-editing.md) 执行记录。

唯一规格：[hover-preview-embed.md 的二期正式规格](../hover-preview-embed.md)。父票 [#227](https://github.com/ONEGAYI/vsidian/issues/227)；历史版本想法已补入总体三期 [#18](https://github.com/ONEGAYI/vsidian/issues/18)。

工作区：`D:/.codex/worktrees/hover-embed-phase2/vscode-obsidian-like-editor`；分支 `codex/hover-embed-phase2`。所有草案与后续实施使用该独立树；原工作树留给用户。

## 拆分与依赖

P2-01 是可行性验证，P2-02 是准备性复用改造；其他功能票都是从用户入口到目标文档结果的纵向切片。P2-14 只做组合、证据与交付收口。每张票按一次新 agent 上下文准备，不把所有容器或整个主控制器改造塞进一票。

| 本地编号 | GitHub | 标题与票据正文 | Blocked by | 可独立验证的交付 |
| --- | --- | --- | --- | --- |
| P2-01 | [#278](https://github.com/ONEGAYI/vsidian/issues/278) | [research: 验证目标历史、丢弃、临时对比与关闭交接](01-host-compatibility.md) | 无本地前置 | 宿主探针、通过／阻塞结论 || P2-02 | [#279](https://github.com/ONEGAYI/vsidian/issues/279) | [refactor: 提炼 Live 实例上下文并验证主编辑器等价](02-live-instance-seam.md) | 无本地前置 | 主正文复用入口且行为等价 |
| P2-03 | [#280](https://github.com/ONEGAYI/vsidian/issues/280) | [feat: 引用全文可达与锚点初始定位](03-full-document-navigation.md) | 无本地前置 | Reading 全文与初始锚点 |
| P2-04 | [#281](https://github.com/ONEGAYI/vsidian/issues/281) | [feat: 正文嵌入接入目标文档编辑、保存与历史](04-embed-target-editing.md) | [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#279](https://github.com/ONEGAYI/vsidian/issues/279)（P2-02）、[#280](https://github.com/ONEGAYI/vsidian/issues/280)（P2-03） | 独占行嵌入写 B、保存与历史 |
| P2-05 | [#282](https://github.com/ONEGAYI/vsidian/issues/282) | [feat: 脏目标显式关闭确认与输入保护](05-explicit-close.md) | [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04） | 关闭三项选择与输入保护 |
| P2-06 | [#283](https://github.com/ONEGAYI/vsidian/issues/283) | [feat: 悬停 Live、文档标题与脏状态保活](06-hover-live.md) | [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05） | 悬停 Live、名称／· 与 dirty 保活 |
| P2-07 | [#284](https://github.com/ONEGAYI/vsidian/issues/284) | [feat: 混排、列表与引用块嵌入的 Live 编辑](07-mixed-list-quote-live.md) | [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05） | 混排／列表／引用块编辑隔离 |
| P2-08 | [#285](https://github.com/ONEGAYI/vsidian/issues/285) | [feat: 表格格内嵌入目标 Live 与父表格输入隔离](08-table-cell-live.md) | [#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07） | 格内坐标与父表格输入隔离 |
| P2-09 | [#286](https://github.com/ONEGAYI/vsidian/issues/286) | [feat: 递归引用的直接父模式与逐层目标编辑](09-recursive-live.md) | [#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）、[#285](https://github.com/ONEGAYI/vsidian/issues/285)（P2-08） | 直接父模式与逐层目标编辑 |
| P2-10 | [#287](https://github.com/ONEGAYI/vsidian/issues/287) | [feat: 引用完整 Live 操作与实例焦点分派](10-full-live-actions.md) | [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04） | 完整既有 Live 操作指向 B |
| P2-11 | [#288](https://github.com/ONEGAYI/vsidian/issues/288) | [feat: 引用链接、图片与粘贴资产归直接目标](11-target-resources.md) | [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#287](https://github.com/ONEGAYI/vsidian/issues/287)（P2-10） | 资源解析／粘贴资产归 B |
| P2-12 | [#289](https://github.com/ONEGAYI/vsidian/issues/289) | [feat: 写入冲突三项选择与原生临时副本对比](12-conflict-native-diff.md) | [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05） | 冲突三项选择与宿主原生 diff |
| P2-13 | [#290](https://github.com/ONEGAYI/vsidian/issues/290) | [feat: 父标签关闭后交接仍脏目标与当次输入](13-parent-close-handoff.md) | [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#289](https://github.com/ONEGAYI/vsidian/issues/289)（P2-12） | 关闭 A 后交接 dirty B |
| P2-14 | [#291](https://github.com/ONEGAYI/vsidian/issues/291) | [test: 二期组合、性能、兼容性与交付收口](14-phase2-closeout.md) | [#280](https://github.com/ONEGAYI/vsidian/issues/280)（P2-03）、[#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）、[#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）、[#285](https://github.com/ONEGAYI/vsidian/issues/285)（P2-08）、[#286](https://github.com/ONEGAYI/vsidian/issues/286)（P2-09）、[#287](https://github.com/ONEGAYI/vsidian/issues/287)（P2-10）、[#288](https://github.com/ONEGAYI/vsidian/issues/288)（P2-11）、[#289](https://github.com/ONEGAYI/vsidian/issues/289)（P2-12）、[#290](https://github.com/ONEGAYI/vsidian/issues/290)（P2-13） | 组合覆盖、性能与兼容性证据 |

依赖解除指前置票的验收通过。特别是 P2-01：调查已经做完但结论无法满足产品契约，仍属阻塞，不能仅以“票已完成”解除后续编辑依赖。

父票 #227 当前还写有阶段依赖 #226；1.5 期代码已经合入及自动化收口的事实，与跟踪票仍 open 分开记录。发布时保留父票关系，实施前核对前期交付状态；本次不关闭、解决或重写 #226／#227，不以本地无前置票表示阶段依赖已被取消。

## 推进顺序

- **先验证与准备**：P2-01 调查可提前；P2-02 提炼最小 Live 复用面，P2-03 完成全文和初始定位。
- **第一条可写闭环**：P2-04 正文独占行嵌入 → P2-05 显式关闭。后续浮窗和容器沿用同一目标能力。
- **扩展用户入口**：P2-06 悬停、P2-07 混排／列表／引用块、P2-08 表格格内、P2-09 递归。
- **补齐完整能力与退出**：P2-10 既有 Live 操作、P2-11 目标资源、P2-12 原生冲突对比、P2-13 父关闭交接。实际可推进顺序以表中依赖为准。
- **收口**：P2-14 对全部 P2-U／P2-A 编号核对证据，列出人工待验和受限项目。

## 共同边界

- 内部 Live 编辑、保存、dirty 和宿主历史归直接目标；Reading 全部禁写。
- 全文／标题／块统一全文可达，锚点仅初始定位；缺锚点沿用既有错误，不自动回退。
- 默认跟随直接父视图，可单独切换并按 occurrence 会话记忆。
- dirty Live 才保活，干净 Live 按 Reading 普通规则关闭；IME／在途与冲突输入分别保护。
- 关闭选项为“保存并关闭／丢弃修改并关闭／取消”，丢弃整个目标并提示其他视图影响，离屏不弹窗。
- 冲突选项为“对比并解决／放弃当前版本／取消”；hover 原文为“在临时副本和冲突版本的对比视图中处理冲突”。原生 diff 交互由 VSCode 管理。
- 不纳入持久恢复库、历史版本、PDF、资源管理器预览、浮窗固定／拖动／调整大小／多浮窗或全量协同编辑。
- 本地编号不能冒充 GitHub issue 号，发布后再登记远端编号和链接。

## 验证与证据

每张功能票先补能暴露问题的失败契约再实施，优先公开会话、生产 browser 和真宿主。按最新 AGENTS.md，目标历史、文档级丢弃、原生 diff 与标签交接必须有 VSCode 1.82.3 下界真宿主证据；1.86.2 保留为已有调研对照，不能用较高版本源码或 mock 命令调用次数代替下界结果。当前独立树的建树基线仍为旧主线，实施前同步最新主线并按其宿主启动器验证，不改动用户主工作树。

新增用户文字经两语言 locales；每个新增操作评估快捷键入口和模式。呈现改动先执行 style-contract，并断言实际绘制。文件新增／移动通过 file-tree 唯一入口维护。首轮长命令即留日志和退出码，后续复核消费报告。

资源实测沿用现有实例／字节／在途／watch 上界，统计新增 EditorView 与端口；未测量不承诺新的延迟或内存数字。Remote SSH、物理鼠标、真实中文 IME 和观感单列人工验收，自动化通过不勾成用户验收。

## 发布记录

用户于 2026-10-02 明确授权开票，已按拓扑顺序创建 #278–#291，并将本地 Blocked by 回填为真实 issue 链接。父票 #226／#227 未关闭或重写。P2-01–P2-03 已加 ready-for-agent；其他票待其前置验收通过后再更新就绪状态。

**P2-01 执行记录（2026-10-02）**：#278 研究在独立树完成——18 个探针用例（`test/integration/suite/probe278.ts`）在 1.82.3 真宿主全部通过；四条路线（目标保存／撤销归属、文档级丢弃、临时副本原生对比、父关闭交接）均无阻塞。同时修正两项前置认知：`files.revert` 带 URI 参数在 1.82.3 误伤活动编辑器必须禁用；Tab API 编程关闭脏编辑器是静默丢弃（Q14 边界修正）。详见[探针报告](../../research/vscode-1823-host-route-probes.md)与票据正文。

**P2-01 收口（2026-10-03）**：用户确认接受两项取舍——撤销路由的可见标签切换（临时激活 B 后全局 undo／redo 再重显 A）、丢弃后 undo 可翻回（不宣称历史清除、不额外拦截）。P2-01 对依赖票（P2-04／P2-05／P2-10／P2-12／P2-13）的前置结论就此放行；其余前置（P2-02、P2-03）按索引依赖另行推进。

**P2-03 执行记录（2026-10-02）**：#280 在独立树完成（提交 `5c22110`）并合入 PR #313。内容范围恒为目标全文，`hover.result.range` 降为初始定位区间；新增 `anchorOptional` 宽容重载——已打开实例锚点缺失回退全文并保留原选择器，首开仍分态错误；祖先循环判定收窄为「带来源的链上子引用 + 文档身份」，页内锚点与第一跳自引用按一期 #219 契约合法打开（口径已补记 ADR-0011）。验证：TDD 先红后绿 20 项新契约、全量单测 5144 例、定向 browser 12 套件（合并后代码复跑全过）、定向集成 19 例真宿主全过。详见[票据执行记录](03-full-document-navigation.md)。

**P2-02 执行记录（2026-10-02）**：#279 在独立树完成（提交 `c197eaa`）并合入 PR #313（`3d00faf`）。新增 `src/webview/liveInstance.ts`——`LiveEditorInstance` 可复用正文实例（EditorView 装配、目标文本同步全链、编辑意图出站、依赖注入面与根特性 hook）；`syncController.ts` 保留根 chrome 与全局消息分派、正文改走实例入口，行为等价。子代理两轮 browser 首轮暴露一处 guard 转写回归（右键保选区语义）并修复复跑全绿；独立树日志晚于最终改动（与 P2-03 同型鲜度缺口），合入后在 P2-02+P2-03 合并树上完整复验四项通过。模块级单槽移交 P2-10/P2-11。详见[票据执行记录](02-live-instance-seam.md)。

发布票据不等同编码、推送、PR 或合并授权。当前工作树、已确认产品契约、P2-01 的实际技术结论及各票验收标准共同构成之后实施上下文。
