# feat: 写入冲突三项选择与原生临时副本对比

本地编号：P2-12

GitHub：[#289](https://github.com/ONEGAYI/vsidian/issues/289)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `0637f78`，与 P2-07 自动合并后经合并树四门复验）。五项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U21、U22、U24；验收 P2-A04、A08、A10。

## 问题与交付

写入冲突需要保留当次输入并让用户在宿主对比页处理；旧“复制取回”主路径不符合已确认选择。

暂停端口提供准确三项选择，完整输入转交临时资源和原生对比；放弃与取消语义正确，不建设历史库。

## 实施范围

- 复用现有版本冲突／apply 失败暂停与输入快照，只替换本次引用编辑冲突的主要处理选项；不顺手改变无关主正文恢复协议。
- 实际显示“对比并解决／放弃当前版本／取消”；可 hover 入口准确说明“在临时副本和冲突版本的对比视图中处理冲突”。所有新增文字 i18n。
- 使用 P2-01 已验证的临时资源路线和 vscode.diff：临时当前输入左侧、现有 B 右侧，原生编辑／保存／关闭由宿主管理。
- 临时资源完整就绪且对比成功打开前保留暂停／输入；成功转交后原引用重新同步当前 B，旧队列不自动重放，不宣称已合并。
- 放弃只丢本次未成功提交版本并同步 B；取消保留暂停／输入；B 是否 dirty 不替代该状态判断。
- 临时资源按宿主已验证的生命周期释放，不新增持久档案、多快照编号或自有完成解决界面。

## 验收标准

- [x] 真实外部交错修改造成不安全重定位时暂停，双方文本保持完整，未自动覆盖 B。（既有暂停契约保持；集成根面板冲突链路 + 嵌入暂停用例）
- [x] 三个选项与 hover 精确匹配；放弃不回滚 B 的其他修改，取消不替换本地输入。（hover 文案为用户指定原文逐字；集成断言放弃不回滚 B 外部修改、取消保留输入；单测 14 例钉选择条状态机）
- [x] 临时副本包含最新尚未提交输入，右侧使用真实 B 模型；API／资源打开失败原现场可继续选择。（全文快照由 webview 点击时出站——webview 是未提交输入唯一权威；集成断言左 untitled 含暂停后输入、右为 B 权威文本；失败注入 `_test.failNextConflictDiff` 原现场可重试）
- [x] 成功转交后旧输入不再次写入 B，B 后续原生编辑正常同步，打开对比不误报已保存或已合并。（**转交后恢复为宿主直驱 `resumePanel`**——对比页激活会隐藏来源面板 webview，恢复若依赖 webview 再出站即断链；集成断言旧输入不写 B）
- [x] 干净 B 但存在未提交输入时仍有保护；资源释放无累计泄漏，原生 diff 真宿主通过。（集成：active tab 为 `TabInputTextDiff`、关闭后 untitled 从 `textDocuments` 释放、`conflictTempUris` 记账随 `onDidCloseTextDocument` 移除；孤儿副本自驱清理）

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-12` 完成（TDD 14 例先红 `logs/p2-12/red-unit.log`），提交 `0637f78`，与 P2-07 文本层自动合并（零冲突）、合并树四门复验。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-12/final-compile.log`、`merged-compile.log` |
| 全量 unit（242 文件 / 5231） | 全绿 | `logs/p2-12/final-unit.log`、`merged-unit.log` |
| browser embedLiveActions（9 场景含新 I）+ embedLive/hoverPreview | 全过 | `logs/p2-12/final-browser*.log` |
| 定向集成（1.82.3 真宿主，6 项组合：根面板冲突链路/嵌入暂停/P2-05×2/P2-10/P2-12） | 6/6 | `logs/p2-12/green-integration-targeted.log` |
| `npm run check:stylecontract` | 八项零失败（新条目 `embed-conflict-choices`） | `logs/p2-12/final-stylecontract.log` |
| **合并树复验**（叠加 P2-07） | compile／全量 unit／browser 4 套件／定向集成（07+12+回归例并集） | `logs/p2-12/merged-*.log` |

**核心设计与实施发现**：

1. **宿主直驱恢复**：对比页激活隐藏来源面板 webview（retainContextWhenHidden 关闭即销毁）——diff 成功打开后宿主直接 `resumePanel`（清暂停/冲突快照 + 权威全文重置），活 webview 由 doc.resync 解除 UI、已销毁的重载后 init 恢复。
2. **顺带修复 P2-10 丢弃链路的宿主侧缺口**：此前最小实现只发 `doc.resync`，`suspended` 残留导致丢弃后后续输入全落冲突快照黑洞——暂停面板的 `sync.request` 统一走恢复语义。
3. **释放闭环**：untitled 随对比页关闭释放（P2-01 §6.3 路线）；不主动关闭已打开对比页（revert 类命令可能误伤右侧 B 未保存修改）。
4. **1.82.3 新宿主怪癖两则**（探针未覆盖，代码与用例注释留档）：pinned diff（`preview:false`）关闭时左 untitled 弹独立标签驻留——故用默认 preview 形态；关含未保存 untitled 的 diff 时模型偶发以独立标签恢复——集成以兜底补关收尾。

**边界**：用户手关含未保存 untitled 左侧的对比页会弹宿主保存确认（P2-01 §6.3 已声明的人工边界）；临时副本不建多快照编号/持久档案（票面）；P2-10 登记的 compare/cancel 由占位接通真实执行，注册表与默认绑定零变化（keybindings.md 已同步修订）。

## 复用入口与验证

DocumentSession 冲突通知／resume 路径、provider 原生对比入口、引用暂停 UI 与 locales；公开会话入口和原生 diff 宿主测试。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
