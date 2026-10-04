# feat: 递归引用的直接父模式与逐层目标编辑

本地编号：P2-09

GitHub：[#286](https://github.com/ONEGAYI/vsidian/issues/286)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）、[#285](https://github.com/ONEGAYI/vsidian/issues/285)（P2-08）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `cfb4ff8`，合并 `c309af5`）。五项验收自动化通过，证据见下「执行记录」；真实 IME／物理鼠标观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U08、U09、U12、U25；验收 P2-A02–A04、A08、A12、A14。

## 问题与交付

递归子引用必须跟随直接父内部模式，而其写入和资源归子目标，不能沿用根 A 的模式与操作路由。

所有既有递归容器按共享实例模式挂载，B 内 C 的文本编辑／保存／历史归 C，父子生命周期与预算闭环。

## 实施范围

- A Live、B 手动 Reading 时，C 默认 Reading；C 手动选择本次会话独立记忆。父为内部 Live 时可见子 Live 按需创建。
- 沿直接来源 B 的当前全文验证 C occurrence，逐级目标端口与祖先路径分开，不能用根文档或任意自报 URI。
- 覆盖悬停内、独占行／混排／列表／引用和表格格内的递归，父内部两种模式均覆盖。
- 祖先文档循环截断、兄弟重复合法；保留既有深度、实例、字节、在途及 watch 预算，父回收时子状态／输入保护有配对处理。

## 验收标准

- [x] A／B／C 三份可区分文本：在 C 输入／保存／撤销归 C，回 B 再回 A 按焦点恢复目标。（集成例 1：C 输入只写 C、保存只落 C、A/B 零写回零 dirty；focusedLiveEntry 嵌套取最内层，焦点路由单测+browser 双层钉住）
- [x] 直接父跟随和每级手动覆盖正确，父根 A 切换不覆写手动 B／C。（集成例 2：A Live、B 手动 Reading 时孙位默认 Reading；孙位手动 Live 后 A 切换不覆写且端口稳定）
- [x] 全文初始锚点之外的合法子引用可编辑；过期／伪造来源拒绝，循环与预算状态可见。（宿主侧零改动复用 hoverParentGrants/validChildSource 沿 B 当前全文验证 C occurrence；伪造来源拒绝由既有分态覆盖——真宿主集成证明该结论）
- [x] 父目标刷新、祖先回收、切模式和快速开关不丢组合／在途输入，迟到子响应不复活已释放树。（跟随回落即回收：B 切回 Reading 无覆盖孙卡随父回落、手动孙卡保持——browser 场景闭环；迟到响应拒收经既有端口机制）
- [x] recursiveEmbed、hoverRecursive、refCombination 和 tableEmbed 的实际组合行为通过。（browser 66 套件全量 + 合并树 9 套件定向复跑全绿；hoverRecursive Tab 断言按解锁后 Tab 序适配）

## 复用入口与验证

src/shared/refExpansion.ts；目标会话来源租约；src/webview/refContentInstance.ts、embedCard.ts 与各递归挂载。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-09` 完成（TDD 红期 `logs/p2-09/red-unit3.log`：浮窗锁/孙卡装饰缺失 4 例先红），提交 `cfb4ff8`，合并 `c309af5`（与 P2-11 交错区人工解冲：embedCard 构造器第二参取 P2-09 孙卡扩展 + P2-11 的 imagePopupSource 与实例变量新形态保留；cases.ts P2-11 块与 P2-09 块拼接；run.mjs 并集。范围锁收窄/visibleHostOf/focusedLiveEntry 自动合并区人工复核正确）。

**宿主侧零改动**：源码评审确认 `hoverParentGrants`+`validChildSource`（沿 B 当前 TextDocument 全文验证 C occurrence）、`hover.watch` 准入、`refEdit.bind` 来源 pin（bind.occurrence = 实例 watch 的 instanceId/hostId）、端口簿记按目标分离对子卡天然成立——真宿主集成证明该结论。改动集中在 webview 侧：

- `liveEmbedChildCards` 扩展 + `LiveEmbedChildContext` facet：B 的编辑器装配后其正文嵌入以「B 的子引用」身份发射装饰，`LiveEmbedWidget.child` 字段（eq 与缓存键含父身份，不跨视图串实例），`toDOM` 经直接父来源身份挂载，与 Reading 侧 `mountChildFrom` 语义键同源共享实例状态。
- 范围锁收窄至「来源父不在状态库」防御分支（浮窗根后代与正文子卡解锁，模式按钮恢复 Tab 停留点）；`visibleHostOf`（根级取面板模式、子卡取直接父生效模式）统一 createLiveInstance/correctLiveDomHomes/双容器移交。
- **嵌套焦点路由缺陷（实测发现并修复）**：孙卡编辑器 DOM 被父 B 编辑器 DOM 包含，旧 `focusedLiveEntry` 的 contains 首中会把孙卡内 Ctrl+S 误存到 B——改取最内层命中，保存/撤销/关闭/冲突动作路由一并修正。
- 跟随回落即回收：B 切回 Reading 时无覆盖孙卡随直接父回落（端口/编辑器销毁、预算释放），手动覆盖孙卡保持。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| TDD 红期（4 例先红） | 预期失败 | `logs/p2-09/red-unit3.log` |
| `npm run compile` | 通过 | `logs/p2-09/compile-final.log` |
| 全量 unit（247 文件 / 5293） | 全绿 | `logs/p2-09/unit-full-final.log` |
| browser 全量 66 套件（含新 recursiveLive） | 全过 | `logs/p2-09/browser-full.log` |
| 定向集成真宿主（P2-09×2 + P2-04/05/07 代表例） | 4/4 | `logs/p2-09/integration-targeted.log` |
| `npm run check:stylecontract` | 八项零失败 | `logs/p2-09/stylecontract.log` |

合并树复验（`logs/merge-p2-09-*`）：compile 通过、全量 unit 248 文件/5308 例、browser 9 套件（新 recursiveLive + 递归族回归 + 交错票 embedLiveResources/hoverLive/tableCellLive/embedLive）、定向集成 11/11（+P2-11×2 + P2-06×2 交错票）。

**移交边界**：①嵌入内部 Live 编辑器中表格**网格化渲染**不工作（基线 stash 对照证实的既有边界，格内孙卡以源文行内 replace 形态挂载、功能完整无网格观感）——记入 P2-14 收口清单评估；②P2-10/P2-11 既有缺口对孙卡同样适用（空白表格组合规划已由 P2-11 的 isLiveActive 接真恢复、图片粘贴经端口归 B，P2-14 组合验证）；③hoverRecursive Tab 断言适配属票面直接后果（解锁使 Tab 序多一停留点）；④键位零新增（复用 embedToggleMode/embedSaveTarget/embedClose/conflict 族）、i18n 零新增文字；⑤真实 IME／物理鼠标／Remote SSH 待人工验收。

## #321 增补（2026-10-04）：孙卡删除拦截对齐 A 层语义

PR #313 终审留档的票面外边界「嵌入实例内部删除孙卡引用行无确认拦截」（[#321](https://github.com/ONEGAYI/vsidian/issues/321)），经产品决策（2026-10-04）**对齐 A 层语义**收编：B 内删除孙卡引用行走与 A 层完全同构的 requestClose 关闭链——孙卡 clean 时静默完成删除（无感，与现状一致）；孙卡 dirty 时弹三项确认模态（保存/丢弃/取消，补齐缺失环节）。不做「仅 dirty 拦截」：dirty 权威在宿主侧，同步 filter 拿不到，A 层正是因此无条件拦再异步分岔。

实施要点（webview 侧，宿主链零改动）：

- B 实例装配仿 `mainDocChangeFilter` 的 changeFilter（`createLiveInstance` extraExtensions）：坐标空间 = B 自身 doc，候选 = 直接子卡（端口在场 + 非 popupRoot/非冻结死键 + 区间在事务定义域内）；命中条件与保文本重定位放行（含 #320 三口径：命中或 `'over-budget'` 放行、`null` 才拦）均镜像 A 层。
- `closePendingDelete` 带 `parent`（拦截时刻的直接父 B entry + 实例引用）：B 上下文的重放目标是父 B 的编辑器、快照守卫比对 B 全文；孙卡 `entry.live` 重放时可能已 teardown，父引用在拦截时刻定格，实例已被销毁/替换即保守放弃。A 上下文（`parent: null`）行为不变。
- `refCloseReplay` 豁免注解 A/B 共用：filter 按 view 装配，重放各入各的 view，无交叉豁免；A 层 filter 只看根级条目，天然不受 B 重放影响（既有 A-2 用例钉住）。
- requestClose/三项模态/宿主 query/execute 链零改动（以 EmbedEntry 为键，孙卡有独立 portId/fsPath）；i18n 零新增键。
- 测试：jsdom 契约 5 例（拦截/clean 静默/dirty 三项含取消与确认/表格保文本不误拦/模态期间 B 漂移守卫放弃）；browser recursiveLive 场景 4（真实键盘输入制造 dirty + 真实事务删除 + 模态按钮真实 click）；集成 P2-09 邻接一例（`#321 嵌入实例内删除孙卡引用行：B 侧拦截对齐 A 层`，新增 `embed.test.deleteChildRef` 钩子经直接父 B 编辑器派发删除事务）。

**保持不动的边界**：`relocatedInterval`/`remapSources`/`remapChildSources` 内部（remapChildSources 刻意不接重定位的边界保持——B 内表格重写孙卡行走重载装载的退化，语义安全）；unmountBlock/teardownLive 离屏回收契约（P2-09）；A 层 filter 语义。孙卡 Reading（无端口）时删除仍无拦截——与 A 层「端口在场才拦」对称。
