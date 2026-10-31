# Callout 完整块渲染：CM6 原生 BlockWrapper 生产链路探针

- 状态：**探针完成，路线条件可行**（2026-10-31）
- 代码基线：`509ff58f`（feat/callout-live-refinement，基于 main `3d70cb36`）
- 探针方式：真实 Chromium + 生产 `WebviewSyncController` 装配 + 产物 CSS，经 `controller.mount(el, [探针扩展])` 注入 `EditorView.blockWrappers`；20 次同坐标真实点击口径（V01 同款）
- 关联：[#668](https://github.com/ONEGAYI/vsidian/issues/668)（总票）、[V01](callout-live-refinement-probe2-v01.md)、[V02](callout-live-refinement-probe2-v02.md)、交接文档（2026-10-31 17:56 BlockWrapper 路线版）
- 证据留存：三轮日志与截图在 `out/test/callout-wrapper/`（gitignored，不入 VSIX）；探针脚本为一次性验证件，已删除

## 1. 结论

**BlockWrapper 路线在生产链路上成立，两条 V02 硬约束都被结构性化解；但带出 4 条实施硬约束与 3 类视觉缺口。**

| V02 硬约束 | 探针结果 |
| --- | --- |
| 卡头 block widget 宽度由 `.cm-content` 决定，横带跨出容器左缘 | **化解**：widget 进入 wrapper 后宽度 = wrapper 内容盒宽（实测 594px 逐像素相等，`s3` 截图） |
| callout 行规则与卡片 edge 规则特异性平局，抢走 `padding-left` | **化解**：容器视觉上移 wrapper 后行不再承载 callout padding，平局无从发生；wrapper 内外代码行 computed `padding-left`/`text-indent` 逐值相等 |

完整链路组合（引用内完整代码卡 + 多行公式 + 嵌套，20 次点击 + 折叠/复制烟测 + 明暗主题无页面错误）全部通过。前提是临时补丁让扫描器认出引用内围栏/公式（补丁已回滚，工作树干净；三轮对照日志证明无残留）。

## 2. 机制事实（源码 + 实测双钉）

以下每条都先读 `@codemirror/view` 6.43.13 源码再实测验证，非推理：

1. **行归属是行粒度、两端含端点**：TileBuilder 的 `updateBlockWrappers` 以 `cur.from <= pos && cur.to >= pos` 收集开启的 wrapper，按 rank 降序入栈，块落入最内层（`index.js` 2449-2483）。**推论（S1 实证）：wrapper 区间必须行对齐**——嵌套 callout 的内层 `from` 若取 Lezer 节点起点（`> > [!tip]` 的第二个 `>`），内层标题行会逃出内层容器；对齐到标题行行首后嵌套成立。
2. **rank 语义**：数值小者在内层（0-100）。外层 callout 50 / 二层 40 / 三层 30 的方案下三层嵌套 DOM 正确。
3. **wrapper 边界空间入 heightmap 记账，但 margin 不入**：`measureVisibleLineHeights` 把 wrapper 盒内边界空间（padding+border）计入 `spaceAbove`（`index.js` 3324-3360）；margin 在 wrapper rect 之外，完全不进记账。
4. **Lezer 嵌套 Blockquote 的 `node.to` 吃掉外层尾行**（既有缺陷根源实证）：`> > [!tip]` 内层节点的 `to` 覆盖到后续 `> 外层尾部` 行（树转储：内层 fromLine 3 / toLine 5）。生产 `data-callout`「内层胜出」缺陷（V01 §4.1）即源于此——不是行类写入逻辑的错，是区间事实源本身偏大。

## 3. 分阶段证据

### S1：wrapper 承载真实 callout 行（结构 / 嵌套 / 落点）

- **真实嵌套容器达成**：note 盒（x70-696）内含 tip 盒（x87-681），内层标题行就位内层盒、外层尾部回外层盒；兄弟 callout 与「仅标题」callout 各自成盒；空行留在盒外。这是 T01 三条路线（逐行装饰 / 手工重挂 / 整块替换）都未达成的形态。
- **短文档点击**：外层标题行 20/20 精确；末行下方空白点击（min-height 区）5/5 落文档尾行。
- **热样式**：wrapper padding 10→26px 后 20 次点击仍全准（样式热更新后重测链路成立）。
- **键入**：内层正文行真实键入后文字仍在内层 wrapper、行数不变。
- **模式往返**：live→reading→live 后 wrapper 结构恢复。
- **拖选**：起点逐字节精确；终点首拖可能差 1 字（init 后测量窗口内），重复拖选逐字节精确。三路对照定性：普通段落精确、普通引用行（隐藏前缀）精确、唯 wrapper 语境首拖偶偏——**非稳定缺陷，是时序窗口**（普通段落/引用行对照每轮均精确）。

### S1b/S1c：落点偏移的责任变量（关键对照）

| 场景 | wrapper CSS | 结果 |
| --- | --- | --- |
| S1b 长文档（measure 必跑） | `margin: 6px 0` | **4 行确定性错行**（内层标题/内层正文/外层尾部/兄弟正文，全部 +1 行，20/20 同落点） |
| S1c 同文档同结构 | `margin: 0` | **全部 6 行 20/20 精确** |

责任钉死：**wrapper 的垂直 margin 不入 `posAtCoords` 记账**。这不是 V01 的 `.cm-content` min-height 门控（长文档 measure 照跑仍错），是独立的记账边界。实施硬约束由此而来：**wrapper 禁用垂直 margin，间距一律用 padding 表达**。

### S2：block widget 与 wrapper 的几何（顶层围栏对照）

- **卡头挂载层（block widget）位于 wrapper 内**，其左缘 = wrapper 内容盒左缘（±0.5px）、宽度 = 内容盒宽（±1px）——V02 约束 1 在 wrapper 下不成立。
- **边缘分裂现象**：wrapper 起点与 widget 锚点重合（`wrapper.from == fence.from`）时，wrapper 分裂为两个兄弟 div（一片含卡头、一片含代码行）。**S3 对照证明 widget 位于 wrapper 内部时不分裂**——分裂是起点重合的边缘构造，生产形态（wrapper 从标题行起）不触发。邻接片段可用 `+`/`:has(+)` 选择器视觉拼合（实测缓解后相邻片段 0px 缝隙），作为边缘兜底手段记录。
- 视口入场（160 行填充 + 滚动到折叠线下方）后结构、几何、20 次点击全部正常。
- 折叠/复制按钮烟测通过（折叠态类切换、无页面错误）。

### S3：完整链路组合（临时补丁在场，已回滚）

文档：callout（标题/正文/代码卡/多行公式/尾部）+ 临时补丁（`scanFencesDetailed`/`scanMathRanges` 识别时剥引用前缀，from/to 保持全文坐标）。

- **单一 wrapper 盒**承载全部内容（无分裂）：标题行、正文行、卡头挂载层（含 JS 标签/复制/折叠）、edge 行、带行号代码行（`1const a = 1`）、KaTeX 公式（`x = a² + b` 成型）、尾部行。
- **卡头宽度归属**：594px = 内容盒宽，逐像素吻合。
- **`>` 前缀全部隐藏**（QuoteMark 隐藏 × 卡片围栏行 replace 重叠，无吞字、无异常）；尾部行 `data-callout` 保持 `note`；无行逃出 wrapper。
- **20 次点击**：标题行 / 代码行 / 尾部行全准；折叠展开往返正常。
- 回滚补丁后重跑：S3 回到 SKIP 基线，S1/S2 结论不变（三轮日志对照）。

## 4. 视觉层发现（截图 + 视觉判读，DOM 断言之外）

按「探针伪影 / 实施项 / 样式迁移设计项」归类：

1. **公式源文泄漏（实施项）**：KaTeX widget 渲染成功，但源文 `x = a^2 + b` 以纯文本同排一行未被隐藏。liveMath 的 `$$` 标记隐藏/替换装饰按「行首即 `$$`」假设锚定，引用内行首是 `>`。实施时需适配前缀锚点（与围栏行 replace 同理）。
2. **token 高亮错位（实施项，交接已预告）**：`openLine.to + 1 + tokenOffset` 直加映射没扣每行前缀长度，两行代码着色范围错开。实施需逐行/逐段映射（交接 §5「源码映射是关键风险」的实证）。
3. **卡片行号落在盒外（成因已 DOM 级钉死，必修）**：行号不是绝对定位，是流内 inline-block + 悬挂缩进模型——行级卡规则 `padding-left: var(--vsidian-code-indent)`（实测注入 `calc(2ch + 24px)` = 38px）与 `text-indent: -38px` 配对（首行拉回行盒左缘，行号 margin-left 8px 落位「卡左缘内 8px」）。顶层卡实测：行盒 x70、行号 x78 ✓。引用内卡实测：行盒 x87（wrapper 内容盒）、**padding-left 被 quiet/探针规则清零而 text-indent -38px 存活**，首行起点 = 87 − 38 = 49，行号落 x57——越过 wrapper padding 14px 与蓝条 3px 甩到盒外，右缘 71 紧贴盒左缘 70（视觉复核：x65-69 纯盒外，与代码文字距 19px）。这与 V02 §3.2 特异性平局同族：**两式必须同源消费同一变量，任何一侧被覆盖即产生悬挂缩进塌陷**。迁移设计：wrapper 内卡片行的 padding/text-indent 同源对（或行号定位改变量化），行号应落 wrapper 内容盒内 8px（x95）。
4. **行级 quiet 背景拼贴（观感「内边距没留」的根源，必修）**：视觉复核实测两层反差——外层 wrapper 灰框留白上下 26/26、左右 14/14（充分），而**浅蓝内容块内部左 0-1px、上 3px、下 4px 三面贴边**，块间另有 2 处 0px 硬接（代码头↔代码体、代码体↔尾段）。根源是容器视觉仍在行级：quiet 规则只有 `padding-left: 24px`，**上下分量按现行纪律不落行**（main.css:2462 注释「行级类不改行高」），文字直接贴行背景边缘。迁移时容器底色上移 wrapper、行级背景让位后，wrapper padding 即为真内边距（本探针 CSS 已对 padding-left 做让位模拟，背景未清属探针残留）。
5. **存疑待人工复核**：视觉判读未辨认出复制按钮图标（DOM 在场、点击链路通）；「卡片标题」旁一个小蓝点成因不明。列入人工验收项。

## 5. 实施前置条件清单

1. **wrapper 禁垂直 margin**（S1b/S1c 责任钉死的直接后果）；间距用 padding 表达。
2. **wrapper 区间行对齐派生，且不能直接用 Lezer `node.to`**：需按「标题行引用深度向下扫描」或等价口径收尾（S1 修正后嵌套正确；同时修复 `data-callout` 内层胜出的既有缺陷——V01 的 `data-callout-lN` 提案与本修正互补）。引用深度扫描的已知边界：懒延续行（无 `>` 的引用续行）深度为 0，会提前截断——生产树区间不受此影响，两者需组合裁定。
3. **扫描器前缀剥离**（本轮补丁形态可作蓝本）：识别用剥前缀行，from/to 保持全文坐标；`code`/`tex` 内容同步剥前缀（KaTeX 干净输入已验证）；增量重建跨窗口一致性需按 P1 矩阵验证。
4. **liveMath `$$` 标记隐藏锚点适配前缀**（源文泄漏修复）。
5. **代码卡 token 映射改逐行前缀感知**。
6. **公开样式契约迁移**：`.callout`/`data-callout` 现为行级入口，迁到 wrapper 需走 style-contract 固定旧契约 + 基线重锚定；行级让位（padding/背景）与行号定位计入迁移设计。探针用内部类名 `vsidian-callout-wrap` 验证结构，公开类名承接未设计。
7. **rank 方案**：外层 50 / 内层递减 10（三层内已验证）。

## 6. 未验证边界（不得写成已确认）

- IME 组合输入、软换行开关、主题切换矩阵、明暗双主题下的 wrapper 绘制（本轮仅暗色亮色 CSS 通道存在性，无双主题截图对照）
- 10 万行档位性能（wrapper tile 增量更新成本未测；`findChangedWrappers` 的映射路径未压测）
- 引用内列表/表格/图片/嵌入等既有块在 wrapper 下的回归（P2 范围）
- `htmlBlock`/`htmlInline` 在引用内仍是规格级排除，本轮未动（独立范围边界）
- 边缘分裂兜底 CSS（`:has(+)`）依赖 Chromium 105+，目标 chrome118 满足，但未做多浏览器矩阵
- Reading 侧无 wrapper 概念（本路线仅 Live；Reading 已有真实容器，无回归面）

## 7. 一手依据

- 三轮探针日志：`out/test/callout-wrapper/round1-nopatch.log`（无补丁 5/5）、`round2-patched.log`（补丁 5/5）、`round3-reverted.log`（回滚 5/5，S3 回 SKIP）
- 截图：`s1-live.png`（嵌套容器）、`s2-fence-wrap.png`（边缘分裂 + 缓解）、`s3-baseline.png`（现状）/ `s3-patched-raw.png` / `s3-patched-seam.png`（完整链路）、`debug-s3.png`
- 源码锚点：`@codemirror/view` 6.43.13 `index.js` 1903-1929（blockTiles）、1974-1979（BlockWrapperTile）、2449-2483（updateBlockWrappers/getBlockPos）、3324-3360（measureVisibleLineHeights 记账）、3451（facet 消费）；`index.d.ts` 358-395（BlockWrapperSpec）、1323-1329（facet）
- API 版本事实：锁定版 `Range` 无静态 `of`，工厂为 `RangeValue.range(from, to)`；`coordsAtPos` 返回 `{left,right,top,bottom}` 纯对象（无 `width`）
- Lezer 树转储：嵌套 Blockquote `toLine:5` 吃外层尾行（S1 文档，全量解析）
