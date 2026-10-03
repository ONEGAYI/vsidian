# feat: 混排、列表与引用块嵌入的 Live 编辑

本地编号：P2-07

GitHub：[#284](https://github.com/ONEGAYI/vsidian/issues/284)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `de298ff`，合并 `e6e87d9`）。四项验收自动化全部通过（含鲜度缺口补跑），证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U07、U12、U24；验收 P2-A02–A04、A08、A09、A12。

## 问题与交付

混排与列表／引用中的父源码位置、选区和几何不等同独占行，需要独立证明 B 输入不会触发 A。

段落混排、列表、任务列表与引用块等既有容器使用共享目标 Live，实现输入、选区、关闭和高度闭环。

## 实施范围

- 复用 embedSlots、嵌入精确 occurrence 与容器映射；前后文本、列表／引用标记和原引用源码保持。
- 覆盖父 Reading／Live、继承与手动覆盖；内部选区、键盘、菜单与滚动不被父正文截获。
- 沿用父 Live 的精确区间源码显隐，内部编辑不主动显露／改写 A 的引用源码。
- 内容高度变化唤醒父测量；离屏保存状态和关闭／删除保护使用共享路径，不建立独立实现。

## 验收标准

- [x] 同段前后文本、列表项／嵌套列表、任务列表、引用块／嵌套引用中，输入只修改 B，A 保真。（browser embedLiveMixed 8 场景真实键盘 + 定向集成 10/10 含 #246/#247/#248 容器矩阵）
- [x] 内部光标、选字、Enter／Tab／复制与父编辑器不互相消费；reading 父仍能单独进入目标 Live。（容器内嵌入复用 P2-04 状态机与端口链路；P2-10 `actionTarget` 焦点分派覆盖）
- [x] 引用源码显隐边界保持原 selectionTouchesRange 规则，B 选区不触发 A 的错误显源。（既有混排显隐契约回归——mixedEmbed/liveEmbedMixed 套件全绿）
- [x] 变高／变短、离屏／重挂载和活跃引用删除按共享状态与关闭语义完成，绘制不覆盖相邻文本。（`height:auto; max-height:inherit` 修恒满高缺陷 + ResizeObserver 既有路径；删除保护/关闭走 P2-05 共享链路；tableEmbed V1 删表回填原位恢复有契约钉住）

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-07` 完成（TDD 11 契约先红 `logs/p2-07/red-phase-contract.log`，含打字风暴机理对照 `red-phase-probe.log`），提交 `de298ff`，合并 `e6e87d9`。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-07/compile-final2.log` |
| 全量 unit（242 文件 / 5225 + node 契约 112） | 全绿 | `logs/p2-07/unit-final2.log` |
| browser 新套件 embedLiveMixed 8 场景 | 全过 | `logs/p2-07/browser-embedlivemixed-final.log` |
| browser 嵌入族回归 9 套件 | 全过（3 套于合并树补跑，见下） | `logs/p2-07/browser-*-final.log`、`merged-browser-gap.log` |
| 定向集成 1.82.3 真宿主（P2-07 新例 + #246/247/248×2 + #281×3 + #282/#287 共 10 例） | 10/10 | `logs/p2-07/integration-final.log` |
| `npm run check:stylecontract` | 八项零失败 | `logs/p2-07/stylecontract-final.log` |

**鲜度说明**：源码最晚改动 09:16:37 后逐套件复跑了 6 套 browser + 集成 + compile；mixedEmbed／liveEmbed／readingEmbed 三套仅有 09:14:48 的批量轮（早于最终源码）——父代理在合并树补跑三套 + embedLiveMixed 共四套全过（`logs/p2-07/merged-browser-gap.log`）。

**核心设计**（探针实测暴露的三个真缺口与修法）：

1. **实例平移稳定**：容器内嵌入的实例键取嵌入精确区间，A 前后文打字每键平移键值——实测 3 键触发 3 次全重载 + 端口销毁重建 + B 编辑现场丢失（独占行因键取行首而幸免）。`remapSources(changes)` 在 `transactionExtender` 阶段随事务迁移根级 entry 坐标键——widget 按新坐标重挂命中迁移实例，装载缓存/端口/选区/fm/滚动全保持；坍缩（区间倒挂或整段删除钳成零宽）冻结键，undo/删表回填的原位恢复仍命中缓存。
2. **hostId 稳定身份**：对外身份（watch instanceId、bind occurrence、预算键、子卡 parentInstanceId）统一为永不变的 hostId，宿主 pin/退订/来源租约不因文本平移失配。
3. **可见容器归属校正**：父模式切换后把在世编辑器移到当前可见容器；`createLiveInstance` 优先可见容器。配套修复 P2-04 遗留 CSS：全局 `.cm-editor{height:100%}` 命中嵌入编辑器致恒满高，改 `.vsidian-embed-card-live .cm-editor{height:auto;max-height:inherit}`。

**移交父代理的边界**：嵌入编辑器 `isLiveActive: () => false` 使 B 内**空白表格输入组合规划**（表格结构编辑）未随 P2-10 落地——图片粘贴拦截关闭正确（P2-11 资产票），但表格组合规划属 P2-10 范围缺口；本票未动避免扩界，已记入票据 10 执行记录边界区与 P2-14 收口清单。

## 复用入口与验证

src/webview/embedCard.ts、embedSlots.ts、liveEmbed 及现有混排容器；refCombination 等生产 browser。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
