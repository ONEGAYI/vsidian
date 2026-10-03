# feat: 脏目标显式关闭确认与输入保护

本地编号：P2-05

GitHub：[#282](https://github.com/ONEGAYI/vsidian/issues/282)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `00eef32`，与 P2-10 合并解冲突后落 `525cba4`）。五项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U19、U20、U24；验收 P2-A08、A09。

## 问题与交付

目标共享 dirty 与历史，因此关闭引用时必须明确保存、整个目标丢弃或取消，并防止销毁正在提交的输入。

插件可控退出统一检查最新目标状态，提供三项模态选择；模式切换／离屏不弹窗。

## 实施范围

- 实现独立于容器的退出意图：关闭、Esc、删除活跃引用；后续浮窗使用同一目标操作和结果。
- 目标有未保存修改时给出“保存并关闭／丢弃修改并关闭／取消”，默认取消，明确 B 文件名及其他视图修改的影响。
- 保存失败不退出；丢弃恢复整个 B。对话框期间版本变化须重新确认，不能用过期确认丢弃新修改。
- 取消删除引用时不完成 A 中该删除；退出意图与 A／B 最新版本重验，不把未确认删除先写入 A。
- IME／在途提交先保留实例，完成后检查最新 dirty。冲突暂停沿用输入保留，P2-12 接入新三项处理；不为本票建设持久草稿。
- 普通离屏和内部模式切换只切换／回收视图，B dirty 保留在宿主，不自动保存或丢弃。

## 验收标准

- [x] 三个按钮均有目标文本、dirty、引用是否还在的断言；取消保留现场，保存失败保留现场。（集成例 1：三项模态含文件名文案、取消后卡片仍 Live 且 B 仍 dirty、只读保存失败保留现场；browser 场景 I–N）
- [x] 整个 B 丢弃同步到它的其他视图，确认文字指明影响；期间新修改触发重新确认。（revert 走激活 B + 无参 revert 恢复整个 B；宿主执行时权威 version 比对，过期回 stale——双防线：webview 侧模态期间 dirty/doc.changed 推送即 stale+基线刷新，宿主侧再比对）
- [x] IME 组合中或写入尚未 ack 时关闭不吞输入，不把未提交输入误报已保存。（`hasPendingLocalInput` + `onLocalInputSettled`：挂起退出意图，IME/ack 收敛后重查最新 dirty 再走模态）
- [x] 删除活跃引用的取消保留 A 原引用，确认后才完成相关退出；模式切换／普通滚动离屏没有模态。（`mainDocChangeFilter` 拦截覆盖活跃引用区间的 A 删除事务，取消不写入 A、确认后带豁免注解重放+快照守卫；集成例 2；离屏回收只关在场模态不新弹）
- [x] 两 occurrence 指向同一 B 的同一次退出不重复回滚。用户文字经 i18n，不调用 window.alert。（集成断言 discard 恰一次——第二次因 revert 推进版本必然 stale；自绘 `role=dialog` 模态，`embed.close*` 族两语言包）

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-05` 完成（TDD 17 例先红 `logs/p2-05/p205-red-phase.log`，因子代理撞 5h 限额中断一次、唤醒续跑），提交 `00eef32`（26 文件 +2410/−53）。与 P2-10 同域冲突由父代理按「显式关闭统一为单一操作」解：弃本票重复注册的 `embedCloseTarget`，保留 P2-10 登记项 `embedClose`（mode 收窄 live），执行体统一为本票 `requestClose` 完整链路；键位/语言包/NLS 只留 P2-10 五操作口径。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-05/p205-compile-final2.log` |
| `npm run test:unit` 全量 | 240 文件 / 5196 全绿（新增 17） | `logs/p2-05/p205-unit-full-final3.log` |
| browser 嵌入族+悬停回归 6 套件（含新场景 I–N） | 全绿 | `logs/p2-05/p205-browser-final.log` |
| 定向集成 1.82.3 真宿主（P2-05×2 + P2-04×3） | 5/5 | `logs/p2-05/p205-integration-final.log` |
| `npm run check:stylecontract` | 8 项零失败（新条目 `ref-close-dialog`） | `logs/p2-05/p205-stylecontract-final.log` |
| **合并树复验**（P2-05+P2-10+CI 修复叠加） | compile／全量 unit／全量 browser／定向集成 | `logs/merged-final-*.log` |

**核心设计**：统一退出入口 `requestClose`（关闭按钮/嵌入内 Esc/删除拦截三径，后续浮窗 P2-06 复用）；关闭状态机（reqId 配对、模态单实例、stale 重确认）；双防线版本守卫；多 occurrence 去重靠版本推进天然成立。实测修复两个 webview 缺陷：`entryOfInner` occurrence 序号被 LRU 重排扰动（改「文档序在场第 N 个」稳定化）、Esc 非空选区无默认绑定（显式收选区再拦截）。

**P2-04 移交项的评估结论**：discard 必然激活 B → A webview 隐藏卸载重载 → closed 回包与删除重放随重载丢失（最终状态正确：B 已回滚、嵌入重绑干净）；「确认后 A 删除完成」断言放 save 路径验证；若未来要求重载后补完成删除，需 P2-13 交接机制协同。

**边界**：冲突暂停时不弹三项（保留实例，归 P2-12）；持久草稿不建（票面）；真实 IME/物理鼠标/Remote SSH 人工清单。另两条落档（review-loops 终审补录）：确认期间目标被外部保存后选「丢弃修改并关闭」，revert 会连带回滚刚保存的内容——保存不推进 version、dirty=false 推送不触发 stale，版本守卫检测不到；属「discard = 文档级回滚」既定语义的边界，数据可经 undo 找回，人工验收时留意。close.query 宿主装载失败无回包时同 entry 意图可覆盖重发自愈、他 entry 意图被挡至该 entry 离屏（已接受形态）。

## 复用入口与验证

目标会话／provider 的保存与丢弃路线、实例退出生命周期、父引用编辑意图；真宿主模态与多视图测试。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
