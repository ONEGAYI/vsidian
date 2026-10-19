# #597 方案 3 验证报告与实施方案（原始输入 → 行为链 → 内置兜底）

> 状态：已批准实施（2026-10-19），实施随 #597。
> 裁决轮：2026-10-19，用户裁定「当前保留方案 1、归一化目标方案 3、不用方案 2 过渡」；
> EasyTyping #64 先行 IME 接入联调，不等 #597。
> 探针代码：vsidian `verify/597-plan3` 分支 `test/unit/plan3Probe.test.ts`（5 例）、
> vsidian-easy-typing `verify/597-plan3` 分支 `test/plan3Probe597.test.ts`（5 例）。

## 一、验证结论

### 1. 方案 2 的代价实证：全角反例链路成立

EasyTyping 的 `builtin-conv-hw2fw`（中文后半角转全角，默认关）是 Input 类规则，匹配**只看快照文本与光标左右切片**，不消费 `inputText`（`rule-engine.ts` `matchAndApplyTextRule`）。因此在「中|」键入 `(`：

- 平台 filter 补成 `中()`、光标居中后，通知（`inputText='()'`）仍驱动该规则命中；
- 其 `trigger_right: '\)?'` 恰好吞掉内置补的右括号——matchRange 覆盖 `中()` 整段，替换为 `中（$0）`，**终态干净的中（|），无残字**。

探针用例（easy-typing 侧第 1 例）逐字断言了该终态。方案 2 屏蔽键入路径通知即杀死该能力——「排除不补最划算」的倾向被否定，裁决依据在代码链与管线实测两个层面都闭合。

### 2. 方案 3 不能按票面字面实施：坐标反证

票面方案 3 原文是「跳过加工事务 + 在 filter 改写点新增机制喂原始字符」——即**内置仍先改写、只补发原始载荷**。SelectKey 管线的重建公式假定「键入文本在快照中占据 `[replaced.from, +inputText.length)`」（`ruleBehaviorPipeline.ts` `planSelectKeyRuleModification` 的 docText 重建与计划基点）。内置先改写后，该假定不成立：

- 同一载荷（`inputText='【'`、`replaced={1,4,'ord'}`），快照为内置改写后状态 `w【ord】` 时，重建错位，产出**重复内容 `w[ord]ord】`**（探针反证用例逐字断言）。

结论：要统一的是**输入上下文、文档状态与执行顺序**，不是补发载荷。方案 3 的正确形态是重排执行序，见第二节。

### 3. 坐标不变量在重排形态下成立

快照为原始事务后状态（`w【`，键入字符恰占 `[1,2)`）时，SelectKey 包裹计划坐标一致、无重复（探针第 3 例）；无选区的全角场景在重排形态（快照 `中(`、兜底未落地）下与现状**终态逐字一致**（探针第 2 例）。链驱动载荷经既有 `maybeDriveAddonBehaviors` 从原始事务推导，天然是干净形态——**不需要新增补驱动机制**。

### 4. 撤销粒度：朴素两笔退化，强制暂缓可恢复单笔

键入路径重排后，「原始 `(` + 微任务兜底 `)`」是两笔事务。jsdom 控制器实测（vsidian 侧探针前三例）：

| 场景 | edit.request 数 | 一次 Ctrl+Z |
| --- | --- | --- |
| 现状基线（filter 原子改写 `()`） | 1 | 整体恢复 |
| 朴素重排（原始笔立即出站） | 2 | 只撤 `)`，残留悬空 `(` |
| 原始笔进暂缓集（触碰未确认） | `(`+`)` 合并 1 笔 | 撤整体 |
| IME 同构对照（组合暂缓 + 定稿后兜底并入同段） | 1 | 整体恢复 |

原因：普通键入首笔在无未确认触碰时**同步立即出站**（`recordLocalChangeSet` 直发分支），兜底笔只能进暂缓段另出一笔。IME 路径不受此困（组合期事务一律暂缓、attempt 并入同段）。**方案 3 必须让符号原始事务强制暂缓**（进 `deferredLocal`/`deferredSegments`），兜底并入同段，维持「一次补全/包裹 = 一笔 edit.request = 一条宿主撤销记录」。

### 5. 多选区：链让位，兜底重建数学成立

SelectKey 管线对 `selections>1` 一律 null（既有门，探针钉住）——多 range 键入的包裹完全由内置兜底承担。兜底重建的坐标原型（vsidian 侧探针第 5 例）：变更组用批量同时坐标（全部相对原始替换后文档）、delta 只平移批后选区——与 `attemptCompositionWrap` 的循环同构，**终态与选区覆盖文本和现行 filter 改写逐字一致**。

## 二、实施方案（待确认）

### 目标架构：键入路径与 IME 路径同构

```
现状（方案 1，键入）          目标（方案 3，键入 = IME 同构）
filter 改写 () 一笔事务        filter 放行原始 ( 一笔事务
  └→ 驱动 inputText='()'       └→ 驱动 inputText='(' ←既有机制推导，零新增
                                   └→ 兜底 attempt（微任务）：插入 ) + addAutoclosePair
                                      区间已被链改写 → 形态校验让位（复用 #124 机制）
```

微任务序契约沿用 ADR-0020 裁决一：**链驱动（M1）先启动、内置兜底（M3）后执行**。同步类行为以组件产出为终态；异步类行为内置先落地、修饰后至覆盖（既有已知边界，键入路径同型继承）。

### 改动清单

1. **`symbolAutocomplete.ts` `autocloseInputFilter` 补全分支**：不再改写，放行原始事务；检出「注册表命中的 open 键入」时暂存兜底材料（per-view，形如 `symbolCompositionState`；含 `shouldAutoclose` 判定用的 ctx——attempt 侧不重算）。**闭合越过分支保持 filter 内改写**（零 doc 变更、不进驱动面与出站，无坐标问题）。
2. **`symbolWrap.ts` `selectionWrapFilter` 包裹分支**：同上放行 + 暂存选区快照（ranges/原文/inCode，`captureCompositionSelection` 同款；表格格区等门控在 filter 时判定并随快照携带——定稿事务会清空 `tableRegionField`，attempt 侧无法复查，镜像 `compositionInTableRegion` 模式）。
3. **新增键入路径兜底 attempt（两处或合一）**：镜像 `attemptCompositionCommitClose`/`attemptCompositionWrap`——形态校验（区间仍为原始键入字符/追加式）不符即让位；符合则补闭合/按段重建（多选区数学见探针原型），携带 `builtinEditOrigin`，`userEvent: 'input.type'` 保留。
4. **attempt 入队点 = 符号扩展组内的 `updateListener`**（新增）：CM6 facet 优先级下数组靠后者先执行，主簿记 listener（链驱动入队点，扩展数组后段）先于符号组 listener 执行 → attempt 微任务天然排在链驱动之后。**不得从 filter 入队**（filter 先于 updateListener 执行，attempt 会抢在链前落地，打破坐标不变量——反证探针即该形态）。装配序由测试钉住。
5. **出站强制暂缓**：filter 放行原始符号事务时以重指定（同 `keepEvent` 机制）附注解（如 `symbolRawInput`，`liveInstance.ts` 定义、与 `builtinEditOrigin` 并列），`recordLocalChangeSet` 见此注解即走暂缓分支（不立即出站）；兜底 attempt 触碰未确认区并入同段（既有机制，无需改）。分段语义沿用：无停顿、无光标移动 → 同段单笔。
6. **契约面（API 语义变更，兼容性事件）**：键入路径 `inputText` 从展开形态（`'()'`）改为原始单字符（`'('`）。同步动作：`CHANGELOG-API` 语义条目、`addonApiCatalog` behaviors 条目语义澄清、developer-guide 行为链触发面、ADR-0020 修订记录、`symbol-input.md` 落档、`check:addoncompat` 基线重锚（`--emit-baseline` 显式动作，随实施 PR 同交并独立说明）。
7. **不新增开关或兼容模式**（用户裁决）；EasyTyping 侧零改动即获得键入路径 SelectKey 命中面，联调归 easy-typing#64。

### 测试面

- 单测转正：探针 10 例并入正式套件（attempt 让位/重建/多选区/出站合并/装配序钉子）。
- browser：真实键入驱动恰一次且 `inputText='('`（改 addonT07Behaviors 4c 断言）；M1 先于 M3 的微任务序；终态矩阵（未装组件 = 内置 `w【ord】` / 同步行为 = 组件产出 / 异步行为 = 内置先落地后覆盖）；撤销一次整体恢复；多 range 包裹与选区回设；paint 探针钉中间态不可见（两笔事务同一事件循环任务内完成）。
- 回归面：symbol-input 既有契约用例（越过/空对退格/格区/代码上下文）、撤销分段、组合路径不回归。

### 已知边界

- 原子改写变两笔事务：均在同一事件循环任务内（微任务先于渲染），用户不可见中间态；由 browser 钉住。
- 出站时点从同步直发改为 flush 定时（`setTimeout(0)`）：组合路径既有形态，组合外逐笔 `conflict.report` 保留，无新增丢失窗口。
- `autoclosePairs` 登记（越过/空对退格依据）移到 attempt：与下一按键之间只隔微任务，事件循环保证不可达竞态。
- 异步行为组件的覆盖序（内置先落地）：ADR-0020 既有已知边界，不为此加链 settle 等待。

### 切片建议

单票实施（#597）：改动集中在 `symbolAutocomplete.ts`/`symbolWrap.ts`/`liveInstance.ts` 三文件 + 注解与暂缓分支 + 契约五处同步 + 测试。探针分支（`verify/597-plan3` × 2）随实施 PR 合入或按需重建。

## 三、待用户确认项

1. 实施方案整体（第二节）是否批准进入 #597 实施。
2. `inputText` 语义变更（展开形态 → 原始形态）随本票一次到位，无过渡期——与「不用方案 2 过渡」一致，确认无异议。
3. 探针分支处置：随实施 PR 合入（推荐）或仅作评审证据。
