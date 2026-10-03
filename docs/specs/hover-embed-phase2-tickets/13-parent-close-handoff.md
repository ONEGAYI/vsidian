# feat: 父标签关闭后交接仍脏目标与当次输入

本地编号：P2-13

GitHub：[#290](https://github.com/ONEGAYI/vsidian/issues/290)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#289](https://github.com/ONEGAYI/vsidian/issues/289)（P2-12）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `1b42f58`，合并 `2d4ee5d`，零冲突自动合并）。五项验收自动化通过，证据见下「执行记录」；窗口退出/重载竞态窗口与 Remote SSH 待验属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U23、U24；验收 P2-A10、A11、A15。

## 问题与交付

A 标签不能被公开 API 前置拦截；B 已提交但未保存的修改需在 A 关闭后有可继续操作的独立标签。

普通 A 标签关闭后打开现有 dirty B 普通文本标签，去重并处理宿主已收到的未提交输入，不误承诺跨重启恢复。

## 实施范围

- 在 A onDidDispose 后等待宿主可继续完成的在途请求，取最新 B dirty；showTextDocument 现有 B、preview:false，重复目标和已有标签复用。
- 干净 B 不打开，不自动保存／丢弃，不从磁盘重读生成 B 副本，不把 A 伪造 dirty。
- 未成功写入 B 的输入与 B 文档交接分开，现有 detachPanel 通知复用 P2-12 的当次选择；取消不静默清除宿主已收到快照。
- 只覆盖普通标签关闭；退出／重载／SSH 断连沿用已有通知与宿主能力，不承诺 webview 未送达输入或扩展持久恢复。
- 打开交接失败显示可操作的当次反馈并保留宿主可用现场，不标记已保存。

## 验收标准

- [x] A 本身干净而 B dirty 时，关闭 A 后 B 原生普通标签出现，TextDocument 身份／文本／dirty 与关闭前一致。（集成用例：去重开标签/复用已有标签/TextDocument 身份与 dirty 一致断言）
- [x] 同一 B 多 occurrence 只交接一次，已有 B 标签不生成重复，干净 B 不自动打开。（`panelEditTargets` 按 targetUri 去重 + 干净不开用例）
- [x] dispose 后才完成写回的 B 仍按最新 dirty 交接；不会因关闭时刻旧状态漏掉。（`settleEdits` 单测 + P2-01 探针在途结论 + 集成断言「最新 dirty 文本」；微秒级窗口竞态无法稳定复现，三层组合支撑，见执行记录）
- [x] 有未提交冲突版本时 B 标签不冒充包含该输入；当次三项选择可处理，失败不误报保存成功。（集成：B 标签不冒称含未提交输入/三项执行路径含 diff 左右内容与资源释放/放弃不回滚 B）
- [x] 窗口退出／重载不会执行普通标签重开承诺，1.82.3 下界真宿主路径与 SSH 待验状态记录清楚，1.86.2 保留为已有调研对照。（交接只在 onDidDispose 路径，停机期 API 自然失效；1.82.3 真宿主 26 例全过，SSH 待验记入人工清单）

## 复用入口与验证

textEditorProvider 的根面板 dispose、目标端口与会话持有；DocumentSession.detachPanel；原生 tab／TextDocument 真宿主测试。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-13` 完成（TDD 单测 8 例先红 `red-unit.log` + 集成红期 `git stash push -- src/` 撤实现复跑 `red-integration.log`；首轮发现「已有标签」形态断言恒真，重排断言顺序后红期干净），提交 `1b42f58`，合并 `2d4ee5d`（与 P2-08 记账树零冲突自动合并，父代理复核 fixtures p208/p213 两块独立完整）。

**交接目标集合** = 关闭时活跃端口（含在途写回目标）∪ 「曾成功写入」记账（`noteEditAck`/`panelEditTargets`，`releasePanel` 清账而单端口释放不清——曾编辑事实独立于端口在场，弥补离屏回收/切 Reading 后活跃集丢失；bind-only 未写过字的目标不记账，其他视图弄脏的 B 不因浏览而弹标签）。同一 B 多 occurrence 按 targetUri 去重。

**顺序契约**：① `settleEdits` 在途排空 → ② **再** detach 虚拟面板（此刻未确认输入才是真正未写入的）→ ③ 以 `textDocuments` 最新 `isDirty` 判定（dispose 时刻旧状态不作数；模型不在 = 干净回收，不重读建副本）→ ④ dirty 才 `showTextDocument(preview:false)` 开标签。干净不开、不自动保存/丢弃、不伪造 A dirty、失败可重试且现场保留。

**未写入输入与文档交接分开**：B 标签打开的是 B 当前权威文本（不冒称含该输入）；输入经 detachPanel 通知走 P2-12 同义三项——`openConflictDiffForText` 提取共用（对比并解决：宿主快照 → untitled 左 + 真实 B 右，转交不清快照；放弃只清宿主快照不借用文档级 revert；取消快照原样留存）。`lastClosedInput` 改无条件记录（取消不清除、放弃才清除）。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-13/final-compile.log` |
| 全量 unit（245 文件 / 5276 + node 契约 118） | 全绿 | `logs/p2-13/green-unit-full.log` |
| browser 五套件（embedLive/Actions/Mixed、hoverLive、hoverPreview） | 全过 | `logs/p2-13/green-browser-*.log` |
| 定向集成 1.82.3 真宿主（P2-13×2 + P2-01 探针×18 + P2-04×3 + P2-05×2 + P2-12×1 共 26 例） | 26/26 | `logs/p2-13/green-integration-targeted.log` |

合并树复验（`logs/merge-p2-13-*`）：compile 通过、全量 unit 246 文件/5285 例、browser 五套件、定向集成 P2-13 过滤词复跑。

**移交边界**：「dispose 后才完成的写回」微秒级窗口竞态未做强制自动化断言（慢路径下消息被端口释放拒收，属既有边界），由 settleEdits 单测 + P2-01 探针结论 + 集成最新 dirty 断言三层组合支撑。窗口退出/重载无重开承诺；Remote SSH 与真实 IME/物理鼠标按 P2-A15 口径记人工清单。可绑定操作评估：本票新增交互均为宿主通知按钮（与 P2-12 同性质），无新增可绑定操作，keybindings 注册表零改动。
