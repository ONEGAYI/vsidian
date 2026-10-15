# 组件设置详情：自绘页优先与页面上下文（#553）

> 状态：2026-10-15 实施（#553）。本文档是「组件设置详情呈现关系与页面上下文语义」的落档规格：有自绘设置页的组件以自绘内容为详情主界面，平台保留公共外壳与配置基础设施；作用域与搜索定位目标经公开页面上下文（SDK `settingsContext` 面）交付自绘页。关联：ADR-0012「设置界面与作用范围」「停用后的设置」；#472 定义/分组搜索与定位（`addon-settings-grouping.md`）；#465 组件设置分页 IA；#554 侧栏唯一高亮。

## 1. 产品语义（票面钉死）

- **自绘页优先**：有自绘设置页且未故障的组件，打开详情（`addons.settingsOpen` 应答渲染）首屏即自绘内容；界面不再出现同一批设置项的重复默认表单，也不再有「打开自定义设置页」开闭操作。无自绘页组件维持平台默认表单。
- **平台保留职责**：整体导航、用户默认/工作区作用域标签、组件总开关、状态与故障提示；设置定义注册、值校验、现有存储与清除工作区覆盖接口全部保留——**界面迁移不是设置数据迁移**（存储结构与清除语义不变）。
- **基础设置的次级化**：自绘页优先形态下，基础设置表单转为详情内次级视图（页内双视图页签，`vsidian-addons-detail-tabs`——ui-patterns §2.2 登记档位）；定义行、来源徽章、清除覆盖、保存反馈全部留在次级表单中。
- **停用与故障**（ADR Q23 语义不变）：普通手动停用后详情仍开、自绘页仍装载可配置；故障暂停时宿主 `desiredSettingsLoad` 归 null 撤下自绘代码（既有机制），详情退回整页基础表单 + 排障块，已有定义时用基础控件修正参数并手动重试；重试成功后详情自动重新装载自绘页。没有取得定义时沿用现有状态/排障边界。
- **管理页入口统一**：附加组件管理页（`addonSettingsSection.ts`）原「设置」（有定义）与「打开组件设置页」（有页）两入口合一为「设置」（有定义**或有页**即可配置）——打开详情后自绘页由详情渲染自动装载，独立 openAddonPage 入口退役。

## 2. 打开语义与生命周期

打开/撤除由 **webview 侧渲染对账**驱动（不新增宿主状态字段），宿主既有消息族与 `desiredSettingsLoad` 机制不变：

| 场景 | 行为 |
| --- | --- |
| 打开详情（有自绘页、未故障） | `renderSettingsArea` 渲染时自动上送 `addons.openAddonPage`（`reconcileAddonPage`，转移守卫幂等——应答未达期间重复推送不重发，防 `settingsGeneration` 世代抖动）；宿主推 `addon.load` 指令，工厂装载后挂载区并入详情首屏 |
| 已开重开 / addonPage.ready 对账 | `openAddonSettingsPage === addonId` 即挂载呈现（already-loaded 幂等由装载器既有机制兜底） |
| 切换组件 A → B（B 有页） | 详情 B 渲染自动 open B；宿主 `settingsOpenAddon = B` → 指令对账 unload A / load B；共享挂载容器 `addonSettingsHost` 单份搬运（A 的 mountRoots 随 releaseLoad 移除） |
| 切换组件 A → B（B 无页） | `reconcileAddonPage` 上送 `addons.closeAddonPage` 撤下 A 的残留挂载（单一组件身份——不留隐身装载）；详情 B 为整页表单 |
| 关闭详情（返回组件列表） | `addons.settingsClose` 与 `addons.closeAddonPage` 同发（详情即页——不再保留无详情的裸挂载态；T02 回退挂载渲染保留为瞬态/安全网路径） |
| 故障 | 不自动开页（请求标记清空）；恢复推送后再次自动开页（重试成功的再装载入口） |

## 3. 页面上下文（SDK `settingsContext` 面）

公开契约在 `src/shared/addonSettingsContextApi.ts`（候选 API，未发行）；仅设置页提供（编辑器页 `undefined`）；数据源是设置页 webview 的页面级 runtime（`src/webview/addonSettingsContext.ts`，settingsMain 构造注入装载器 env 与分页构造）。

| 成员 | 语义 |
| --- | --- |
| `scopeState()` | 当前作用域快照：`{ scope: 'user' \| 'workspace', hasWorkspace: boolean }`（拉取式，页面级当前值） |
| `onScopeChange(listener)` | 作用域/工作区变化订阅，返回退订函数。数据流：分页作用域标签点击与 settingsState 推送的 `hasWorkspace` → runtime `applyScope`（等值不分发）→ facet 分发 |
| `locateTarget()` | 当前未消费的搜索定位目标：`{ kind: 'def' \| 'group', key }` 或 null |
| `onLocateTarget(listener)` | 定位目标交付订阅（null = 清除）。**订阅即回放**当前挂起目标——页面装载晚于定位到达的补投（搜索跳转可在装载完成前发起） |

**代次边界**（与 behaviorState 只读面同款两分）：查询不做代次守卫（只读无副作用）；订阅过装载器 `isLoadActive` 守卫——已释放代次的迟到登记为 no-op 退订；释放时点已有的订阅由 `releaseLoad` 的 `releaseAddon` 整组回收；回调异常只吞不升级（观察面口径）。

**定位交付流**（复用 #472 `locatedTarget`/`pendingFocus` 机制）：

```
全局搜索点击 def/group 条目 → focusEntry → AddonSettingsAreaSection.mount 解析
  ├─ 目标组件详情未开 → pendingFocus + addons.settingsOpen（既有链路）
  │    └─ settingsState 应答 → pendingFocus 消费 → deliverLocateToPage
  └─ 目标组件详情已开 → deliverLocateToPage（立即）
deliverLocateToPage（有自绘页且未故障时）：
  detailView = 'page'（视图保持/切回自绘页——平台不切回自己的表单）
  settingsContext.deliverLocateTarget({ kind, key }) → runtime 广播 → facet 订阅者
```

- 无自绘页组件沿用既有表单 located 描边 + 滚动（#472 语义不动）。
- 定位目标在 runtime 内按「最新一份」持有，直到被替换或清除（详情关闭/切换组件时 `deliverLocateTarget(null)`——不把上一组件的目标串给下一组件）；不设一次性消费时限（慢装载由订阅回放覆盖）。页面重装载会重新收到当前目标（罕见且无害，已知边界）。
- 全局搜索索引不新增内容：继续只索引已注册定义/分组（#472 边界）——规则文件与组件私有业务数据不进索引。

## 4. 明确不包含

- 不迁移设置存储（user=globalState / workspace=workspaceState 的结构 version 1 冻结不动）。
- 不把宿主 `openSettingsArea`/`openSettingsPage` 两态合一（两态语义保留：详情打开者与装载意图各自独立，本票只改变 webview 呈现与自动开合对账）。
- 不新增右键菜单项、不改变「附加组件」页通道堵死守护（#465）与 #554 侧栏唯一高亮语义（`settingsState.open` 派生）。
- 跨窗口作用域实时推送不做（1.82.3 Memento 无变更事件，既有边界）。

## 5. 实施落档约定（后续变更必读）

- **详情形态判定单一入口**在 `renderSettingsArea` 的 `customFirst`（`hasCustomPage && !faulted`）——新增呈现分支须保持平台外壳（标题/返回、作用域标签、总开关、故障块）恒在场。
- **自绘页开合对账单一入口**在 `reconcileAddonPage`（含 `openPageRequested`/`closePageRequested` 去重）——不得在别处再发 `addons.openAddonPage`/`addons.closeAddonPage`（T02 回退挂载区的关闭按钮除外）。
- **上下文数据上抛单一入口**在 `AddOn 设置区分页`（`applyScope`/`deliverLocateTarget`）——装载器与 SDK 面只消费不写。
- 新增设置页可见文字一律 i18n（`addons.*` 词条族，两语言包 parity）；详情双视图页签形态沿用 ui-patterns §2.2 登记档位（与作用域标签同款 pill）。
- 消费夹具：`test/fixtures/addon-v02/addon/settingsContextSettings.ts`（作用域/定位回显）；浏览器回归 `test/browser/addonSettingsContext.mjs`（绘制层断言）。

## 6. 验收对照

见票面 #553 验收标准；单测（`addonSettingsArea.test.ts` #553 组、`addonPageLoader.test.ts` #553 组）、浏览器（`addonSettingsContext.mjs`）、门禁（page-settings-context 条目 + 基线重锚）构成证据链。人工验收项登记于 `manual-verification.md`。
