# feat: 引用全文可达与锚点初始定位

本地编号：P2-03

GitHub：[#280](https://github.com/ONEGAYI/vsidian/issues/280)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: 无本地前置票

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-02，提交 `5c22110`）。六项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U01–U03；验收 P2-A01、A12、A14。本票在技术上可独立准备；#226 是父票既有阶段依赖，发布时保留该跟踪关系，不由本轮关闭父票。

## 问题与交付

现有标题／块引用只挂载局部内容，不能满足两种模式全文可达。

全部 Reading 引用成功打开后展示目标全文，标题／块只影响初始定位；宿主、协议、来源准入与递归预算按全文一致处理。

## 实施范围

- 区分初始选择器／定位点与全文内容范围，覆盖悬停、所有嵌入容器及递归；不只改前端滚动。
- 保持原链接文字、LF／CRLF 坐标和根边界。打开时缺标题／块沿用 anchor-missing，不退回全文。
- 来源租约验证仍以当前直接来源版本、occurrence 与引用原文为准；目标全文计费，合法子引用可位于初始章节之外。
- 祖先循环按规范目标文档身份判定；不同锚点不能绕过全文循环，同目标兄弟实例仍合法。保留既有深度与容量上界。
- Reading 内部始终禁写；已打开全文后刷新保留位置，重新打开再验证原锚点。

## 验收标准

- [x] 全文、标题、块成功打开后可见并能滚动到锚点前后完整目标内容，标题／块首开定位正确。（browser hoverPreview 场景 H／I／K 改写后断言全文在场 + 首开 scrollTop 非零；refContentInstance 单测钉住 rAF 定位与滚动优先级）
- [x] 合法锚点外的引用可按既有来源守卫展开；伪造来源、过期租约及不支持语法仍拒绝。（refExpansion／documentSession 单测保留全部来源守卫契约，validChildSource 仅去父锚定区间边界）
- [x] 缺文件与缺锚点分别呈现，原引用零改写，Reading 任务／属性零写回。（既有失败分态契约全绿；hoverPopup／embedCard 首开仍严格，不改写来源）
- [x] 已打开后改名／删除初始标题或块 id，当前全文实例继续可用；关闭后重新打开原引用，缺锚点按既有错误处理。（协议新增 `hover.request.anchorOptional`：changed 失效重载与版本仲裁自愈重发带 `true` 时宿主回成功全文并保留原选择器；首开不带仍 `anchor-missing` 分态）
- [x] 同文档不同锚点祖先循环截断、兄弟重复合法；大全文不能按旧局部预算通过。（`canonicalRefTargetKey` 按文档身份去锚点；计费本按全文 `lfText.length*2+128`，新增单测钉住；集成 #219 场景真宿主全过）
- [x] 生产 hover、recursiveEmbed、refCombination、tableEmbed 与相应 host／protocol 失败契约转绿。（定向 browser 12 套件、定向集成 19 例、全量单测 5144 例通过，见执行记录）

## 执行记录（2026-10-02）

实施在独立树 `D:/.codex/worktrees/p2-03` 完成（TDD 先红后绿，新增 20 项契约），提交 `5c22110` 后经 `--no-ff` 合入 PR #313 分支。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-03/compile-8.log` |
| `npm run test:unit` | 5144 用例全绿 | `logs/p2-03/unit-all-3.log` |
| TDD 红期证据 | 17 项新契约先红 | `logs/p2-03/unit-red-1.log`、`unit-red-2.log` |
| 定向集成（`VSIDIAN_TEST_CASES='悬停,嵌入,递归'`，1.82.3 真宿主） | 19/19 通过，宿主退出码 0 | `logs/p2-03/integration-2.log` |
| 定向 browser 12 套件（含 hoverPreview／recursiveEmbed／refCombination／tableEmbed） | 全过 | `logs/p2-03/browser-rerun-merged.log`（合并后代码复跑） |

实施要点与一处口径收窄：

- **内容范围恒为目标全文**；`hover.result.range` 语义从「内容范围」改为**初始定位区间**，`scope` 降级为引用身份标识，两者不再是授权或编辑边界，webview 渲染层移除按区间过滤块的路径。
- **宽容重载经 `anchorOptional` 表达**：已打开实例的 changed 失效重载与版本仲裁自愈重发带 `true`——锚点缺失回成功全文（定位区间退化、保留原选择器）；首开不带，锚点缺失仍分态错误。i18n 文案零新增。
- **循环判定收窄为「带来源的链上子引用 + 文档身份」**：循环身份统一为文档身份后，页内锚点与第一跳自引用会被「根面板身份在路径上」误判为 cycle（集成 #219 真宿主实证失败）；收窄后第一跳按一期契约合法打开，链上回指（B→A）照常截断。该口径已补记 ADR-0011 与规格「内容、定位与实例身份」节。
- 验证鲜度说明：子代理的两条 browser 日志跑在最后一次生产代码修改之前；父代理在合入后的 PR 分支上对同一组 12 套件复跑全过（上表 `browser-rerun-merged.log`），compile／unit／integration 三项日志经时间戳核对为最终代码之后、无需复跑。

## 复用入口与验证

src/host/hoverDocAccess.ts；src/shared/protocol.ts、refExpansion.ts；src/webview/refContentInstance.ts、refReadingContent.ts 与既有容器。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
