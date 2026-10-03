# feat: 悬停 Live、文档标题与脏状态保活

本地编号：P2-06

GitHub：[#283](https://github.com/ONEGAYI/vsidian/issues/283)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `04650b6`，与 P2-07/12 合并解冲突 + 语义补丁后落 `5558715`）。五项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U06、U16–U18；验收 P2-A03–A05、A08、A09、A13。

## 问题与交付

悬停当前统一按瞬态 Reading 销毁。Live 必须仅在目标 dirty 时保活，同时保持普通干净悬停的交互。

现有全部悬停入口接入同一引用 Live 能力，head 显示规范名称与 ·，按 dirty 判定普通关闭与显式退出。

## 实施范围

- 正文双链／本地链接、键盘预览及反链／出链入口保持现有触发规则；父模式继承和单独切换按实例实现。
- head 显示目标文档名称；B 未保存显示精确 ·，保存／丢弃清除后消失，不使用别名或 A dirty 代替。
- dirty Live 遇移出、外点、blur／visibilitychange 等普通关闭条件保活；干净 Live 按 Reading 现有规则关闭。
- 组合期、在途或冲突暂停输入不能按“B 干净”销毁；显式关闭按钮与 Esc 复用 P2-05。
- 干净浮窗重开恢复本次引用位置的模式／选区／滚动，无需旧 EditorView 常驻。一次一个浮窗，不新增固定、拖动、尺寸调整。

## 验收标准

- [x] 所有既有入口均能继承或手动进入 Live，并实际修改／保存 B；键盘打开、焦点返回与修饰键规则保持。（browser hoverLive 6 组 + hoverPreview/hoverEntry/hoverRefresh/hoverRecursive 回归；真宿主集成 14 例含 P2-06 两例）
- [x] 名称、· 和模式／保存入口在绘制层可见，dirty 来自 B，清除后圆点消失。（头部动作组/圆点物理移除——干净态无节点；dirty 来自 refEdit.dirty 推送非 A）
- [x] dirty Live 移出／外点／切应用仍在；干净 Live 对相同普通条件关闭，先输入后保存再离开正确重算。（Q18 保活门控：移出延迟关/外点/blur/visibilitychange/父容器滚动抑制 + 窗口回焦重估；端口态信号——dirty 清零/ack 落定/暂停解除——翻转时恢复关闭计时，有专门断言）
- [x] IME／在途结束后依据最新 dirty 处理，冲突暂停不吞输入；Esc 经过当前弹层优先级后执行已确认退出。（输入落定兼作保活重估信号；Esc 分层：模态→keymap→消隐意图显式链路）
- [x] 快速换目标与迟到回包不会重开已关闭浮窗，释放无残留订阅，干净重开恢复实例状态。（单例浮窗既有契约 + 语义键会话驻留：模式/选区/滚动跨开合记忆、fm 按既有契约挂载复位）

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-06` 完成（TDD 17/18 先红 `logs/p2-06/red-unit-hoverLive.log`），提交 `04650b6`；与 P2-07/P2-12 合并解冲突（范围锁判定统一为「按 hostId 查父不在库**或**父为浮窗根」均锁 Reading；测试钩子双保留；browser 清单并集；fixtures 交错区重建），另打语义补丁 `5558715`（浮窗根 entry 补 hostId=语义键与 collapsed:false；remapSources 跳过浮窗根——语义键非文本位键）。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-06/fresh-compile.log`、`merged-compile.log` |
| 全量 unit（5237） | 全绿（新 hoverLive 20 例） | `logs/p2-06/fresh-unit-full.log`、`merged-unit.log` |
| browser 7 套件（新 hoverLive + 悬停族 + embedLive 族） | 全过 | `logs/p2-06/fresh-browser-targeted.log`、`merged-browser.log` |
| 定向集成 1.82.3 真宿主（悬停族 + P2-04/05/06 共 14 例） | 14/14 | `logs/p2-06/fresh-integration-targeted.log`、`merged-integration.log` |
| `npm run check:stylecontract` | 八项零失败（hover-popup 条目仅增 token） | `logs/p2-06/fresh-stylecontract.log` |

**核心设计**：浮窗根 entry（语义键 `hover@start::target`）挂进 `EmbedCardManager` 同一状态库——端口绑定/模式状态机/保存/requestClose 三项确认全走嵌入同一条代码路径，浮窗只提供 DOM、请求机械与生命周期钩子（「复用不另造」）。宿主来源租约按 occurrence 转交固定：首轮真宿主实测 `hover.watch` 被拒（租约钉在请求 occurrenceId 上），据此把请求 occurrenceId、watch 身份、bind occurrence、子卡 parentInstanceId 统一到语义键。保活重估闭环：`scheduleClose` 抑制时记录抵抗态，端口态信号翻转恢复计时。

**边界**：浮窗内子卡（B 的嵌入）仍锁 Reading（范围锁显式扩展到浮窗根后代；直接父跟随与逐层编辑属 P2-09）；bind 失败×父持续 Live 的重试循环为 P2-04 既有形态未扩大处理；blur 保活后浮窗驻留遮挡正文属 Q18 设计取舍；fm 不在记忆清单（#220 契约保持）。键位评估：零新增操作（既有三操作焦点路由天然覆盖），keybindings.md 已落档。

## 复用入口与验证

src/webview/hoverPopup.ts、hoverPopupGeometry.ts、refContentInstance.ts；hoverEntry、hoverPreview、hoverRefresh 生产 browser 与宿主。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
