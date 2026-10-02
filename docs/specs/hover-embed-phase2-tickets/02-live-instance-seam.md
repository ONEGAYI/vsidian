# refactor: 提炼 Live 实例上下文并验证主编辑器等价

本地编号：P2-02

GitHub：[#279](https://github.com/ONEGAYI/vsidian/issues/279)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: 无本地前置票

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-02，提交 `c197eaa`）。四项验收自动化全部通过（含合并树复验），证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U06、U13、U25；验收 P2-A03、A06、A14。本票在技术上可独立准备；#226 是父票既有阶段依赖，发布时保留该跟踪关系，不由本轮关闭父票。

## 问题与交付

主控制器同时拥有正文 EditorView、面板 chrome 和若干全局接线。直接复制控制器会产生重复侧栏、错误目标与资源冲突。

增加可供主正文与引用复用的最小 Live 创建／同步／操作上下文，并让主正文使用该入口；用户可见主正文行为保持等价。

## 实施范围

- 采用 expand 方式提炼正文创建、目标文本同步、编辑意图及实例拥有的扩展入口；侧栏、主顶栏、设置页和全局消息接收仍由根控制器单份持有。
- 以实例依赖传入文本／版本、出站、资源来源、焦点与操作目标，不让复用入口默认读取 this.view 或唯一全局编辑器。
- 只迁移最小复用面，不在本票改写整个 syncController 或顺手重构无关功能；其余命令与资源接线由 P2-10、P2-11 迁移后再 contract。
- 实例拥有 EditorView 与其监听器／定时器的创建释放；不接入目标 B 的生产写端口，不引入独立 history。

## 验收标准

- [x] 主正文使用新入口，现有文本编辑、任务、属性、表格、格式及关键弹层代表性行为保持原有目标文本结果。（全量单测两轮绿 + 全量 browser 60/60——首轮 contextMenu 暴露 guard 转写回归（`return !keep` 吞 mousedown 默认行为），修复后复跑全绿 + 定向集成 13 例）
- [x] 两个 fixture 实例的选区、滚动、派发目标和释放互不影响；销毁一个不释放另一份编辑器。（`test/unit/liveInstance.test.ts` 5 条契约，TDD 先红 `logs/p2-02/tdd-red.log`）
- [x] 根面板只创建一套 chrome，主功能不因新入口重复注册全局监听或双重消费按键。（根控制器单份持有全局接线；syncController 11260→9661 行，正文路由委派实例）
- [x] 契约失败用例先暴露唯一编辑器／全局依赖问题，再完成改造；适用生产 browser 和主正文宿主回归通过。（见执行记录验证表）

## 执行记录（2026-10-02）

实施在独立树 `D:/.codex/worktrees/p2-02` 完成（提交 `c197eaa`），经 `--no-ff` 合入 PR #313 分支（`3d00faf`）。核心产出：`src/webview/liveInstance.ts`（`LiveEditorInstance`，1835 行）——EditorView 装配（扩展逐项同序迁移、设置 Compartment 热重配）、目标文本同步全链（增量/全文/ack/版本单调/冲突暂停/IME 组合缓冲/撤销分段）、编辑意图出站与 `destroy()`；外部依赖经构造 deps 注入（出站、持久化时机、资源来源、Live 激活态、初始明暗），根特性经可选 hook 联动。`syncController.ts` 保留侧栏/顶栏/设置页/查找面板 chrome 与全局消息分派，`this.view` 变实例 getter。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| TDD 红期证据 | 契约先红 | `logs/p2-02/tdd-red.log` |
| `npm run compile` | 通过（独立树 00:28 轮） | `logs/p2-02/compile.log` |
| `npm run test:unit` | 通过（独立树两轮） | `logs/p2-02/test-unit.log`、`test-unit2.log` |
| `npm run test:browser`（全量） | 60/60（首轮暴露 guard 回归后复跑） | `logs/p2-02/test-browser.log`（红）、`test-browser2.log`（绿） |
| 定向集成（#148 undo 竞态守卫等 13 例，1.82.3 真宿主） | 13/13 | `logs/p2-02/test-integration-targeted.log` |
| **合并树复验**（P2-02+P2-03 叠加后） | compile／全量 unit／全量 browser／定向集成（两票并集） | `logs/p2-02/merged-*.log` |

**验证鲜度说明**：子代理最后一次源码改动（`syncController.ts`，00:55:02）晚于其全部验证日志——与 P2-03 同型缺口，独立树日志一律按过程证据看待；合入后在合并树上完整复跑四项（上表 merged 行）作为本票验收依据。

**边界与后续移交**：模块级单槽（`setLiveEmbedCards`、`ImageResourceManager`、hoverPopup/targetTip/diagramPopup/imagePopup 上下文）仍归根，多实例并存时共享——实例化迁移按票归 P2-10/P2-11；`handleFullSync` 中 `releasePendingHistory` 与骨架撤除调度有一次无交互路径的次序对调（代码注释说明）；本票无新增用户文字（i18n 扫描零回潮）、未触及呈现层（未触发 style-contract）。

## 复用入口与验证

src/webview/syncController.ts 的 EditorView 装配、extensions 与实例相关操作；既有 tableCaret、frontmatterTable、菜单和快捷键 browser 入口。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

本票属于准备性 expand 改造，独立验证主编辑器行为等价；后续命令／资源迁移完成前不强行删除所有旧入口。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
