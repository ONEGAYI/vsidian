# Callout Live 形态收口：可行方案探查

- 状态：**探查完成，方案待决策**（2026-10-31）
- 代码基线：`3d70cb36`（main）
- 探查方式：真实 Chromium + 生产控制器 + 产物 CSS（复用 `test/browser/calloutPaintFixture.ts` 夹具）
- 关联规格：[callout.md](../specs/callout.md)、[ADR-0023](../adr/0023-callout-source-and-view-state.md)

本文只记录实测结论，不把候选方案写成已验证事实。探针脚本为一次性验证件，已删除，不随仓库留存。

## 1. 问题来源

用户在实施后的观感复核中提出四项与 Live 形态有关的差距：

1. 各类型 callout 标题颜色完全相同（期望按类型区分）
2. 标题与正文之间没有留白
3. callout 内部的代码块、公式块、嵌套 callout 不渲染
4. 嵌套 callout 没有层次（内外层同色）

另有两项被标注为**待决策**、本轮不动：整标题可点击折叠、光标进入时整体退化为引用块。两项均与规格既有决策冲突，见 §5。

## 2. 探针 A：行级垂直 padding 与落点稳定性

### 2.1 做法

给 callout 标题行注入 `padding-top: 12px` 与 `padding-bottom: 6px`，测量行盒高度与后续行位置，再用 `view.posAtCoords` 取行中心对应的源码行号。

### 2.2 数据

| 状态 | 标题行高 | 正文第一行 top | 点击正文第二行中心 |
| --- | --- | --- | --- |
| 基线 | 21px | 55 | 落在第 3 行（正确） |
| 注入 padding 后 | 39px | 73 | **第 1 次运行落在第 4 行，第 2 次运行落在第 3 行** |

### 2.3 结论

**不是「能不能加 padding」，而是「加了之后落点不一致」。**

同一份文档、同一个点击坐标（`y=104.5`），两次独立运行分别命中 `pos 29`（第 4 行）与 `pos 23`（第 3 行）。CM6 的 `measureVisibleLineHeights`（`@codemirror/view` 3325-3329）按真实 DOM `getBoundingClientRect().height` 记账，而 CSS padding 由浏览器异步布局反映——在高度重测完成之前，`posAtCoords` 仍按旧高度表换算，落点偏移整整一行。

**因此「把 `--callout-padding` 的上下分量直接落到 `.cm-line` 上」不可行**，必须换承载层，或接受「行高变化 + 强制同步重测」的额外机制。

> **2026-10-31 更正（见 [V01 探查](callout-live-refinement-probe2-v01.md) §2）**：上面「浏览器异步布局竞态」的归因**不成立**。实测表明这是**确定性失效**，不是抖动——同一坐标连续 20 次点击在热态下 `20/20` 全部错行，3 秒内模型偏差恒为 24px 不变。
>
> 真正根因是 **`.cm-content` 的 `min-height: 100%` 高度门控**（CM6 baseTheme 的 `minHeight: "100%"`）：CM6 的 `measure()` 只在 `contentDOMHeight != domRect.height` 时重测行高；短文档内容被钳在视口高度，给行加 padding 不改变 `.cm-content` 自身高度，于是模型永不重测。长文档（超出视口）不受影响——**这意味着短笔记（callout 的主要场景）必然踩坑，而手工试用时「打字看起来没问题」**（真实键入产生事务会置 `mustMeasureContent`）。
>
> 生产现成的 `scheduleSnippetMeasure` 唤醒机制对该问题完全无效。归因差异影响取路：若它是竞态，等待或补一次重测即可；既然不是，就必须换承载层（V01 选定块级间隔 widget）或改 `.cm-content` 基础 CSS（有副作用）。
>
> 本文 §2 **不被当作 #552 抖动族的同型证据**。

## 3. 探针 B：引用容器内的围栏

### 3.1 现状确认

文档：

```
> [!note] 标题
> 正文
> ```js
> const a = 1
> ```
> 尾部
```

浏览器实测（`hasWidget` = 该行是否挂上代码卡片头部）：

| 行 | 类名摘要 | 代码卡片头部 |
| --- | --- | --- |
| 标题 | `callout callout-title vsidian-callout-first` | 无 |
| 正文 | `callout callout-content` | 无 |
| ` ```js ` | `callout callout-content vsidian-code-line` | **无** |
| `const a = 1` | 同上 | **无** |
| ` ``` ` | 同上 | **无** |

围栏行拿到了 `.vsidian-code-line`（等宽字体 + 底色），但**没有任何卡片加工**：无语言标签、无高亮、无行号、无复制按钮。

### 3.2 成因

`src/shared/mermaid.ts:159-175` 的 `indentColumns` 只把空格与 Tab 计为缩进，引用前缀 `>` 不属于缩进。`matchFenceOpen` 收到的 rest 是 `` > ```js ``，正则 `^(`{3,}|~{3,})` 不匹配，围栏表为空；`liveCodeCard` 消费同一张表（`liveCodeCard.ts:618`），因此零加工。

公式块同型：`src/shared/math.ts:279` 用 `trimmed.startsWith('$$')`，实际 trim 后是 `> $$`。

### 3.3 为什么「剥前缀」不等于能修好

这是本次探查最重要的负面结论。围栏表一旦认出引用内的围栏，`liveCodeCard` 会做三件在引用上下文里都有问题的事：

1. **块顶头部是 block widget**，锚在 `fence.from`（行首，即 `>` 之前）。在引用行里这个位置会把整行前缀变成块级 widget 的宿主，与 QuoteMark 的隐藏装饰争夺同一区域。
2. **围栏行用 `Decoration.replace` 整体覆盖**（`liveCodeCard.ts:600-602`）。引用内每行还有 QuoteMark 的 `hideDeco`（`liveDecorations.ts:223`，`Decoration.replace({})`）。两个 replace 区间在同一行重叠。
3. **卡片行类加在含 `>` 的源文行上**，缩进计算（`--vsidian-code-indent`）按 `x=0` 起点算，与引用缩进叠加后列对齐失准。

现有实现从未走这条路径，因为围栏表里没有引用内的围栏。**这三个冲突都没有现成证据表明可解**，必须先做专门探针。

> **2026-10-31 更正（见 [V02 探查](callout-live-refinement-probe2-v02.md)）**：本节对第 2 条的判断**有误**。CM6 的 `Decoration.replace` 区间重叠**不抛错**，而是静默取并集（实测七组重叠形态全部通过；源码 `@codemirror/view` 的 `PointDecoration.range` 仅在 `from > to` 或零宽 replace 时抛 `RangeError`）。独立复核已确认该结论。
>
> 第 3 条的根因也不准确：偏移的成因是 **CSS 特异性平局**（callout 规则与卡片 edge 规则同为 `(1,5,0)`，callout 规则靠后胜出抢走 `padding-left`，而 `text-indent` 存活），不是「缩进值算错」——因此调 `--vsidian-code-indent` 修不好（两处引用同一变量，差值恒定）。
>
> **结论不变但依据要换**：引用内完整卡片仍不可行，真正的原因是两个——block widget 的宽度由 `.cm-content` 决定（卡头横带必然跨出引用容器左缘）、以及上述特异性平局。完整卡片之外的降级形态（只发语法高亮）**可行且零缺陷**。

## 4. 探针 C：嵌套 callout 的分层

### 4.1 数据

文档：

```
> [!note] 外层
> > [!tip] 内层
> > 内层正文
> 外层正文
```

实测各行 `data-callout`：

| 行 | data-callout | padding-left | 背景 |
| --- | --- | --- | --- |
| 外层标题 | `note` | 24px | 透明 |
| 内层标题 | `tip` | 24px | 透明 |
| 内层正文 | `tip` | 24px | 透明 |
| **外层正文** | **`tip`** | 24px | 透明 |

### 4.2 结论

**最内层类型胜出，外层被整体染成内层色。**

`liveDecorations.ts:1123-1125` 的既定语义是「`data-callout` 取最内层 callout 容器」，而类型色变量按 `[data-callout]` 挂在行上（`main.css:155-209`）。于是最后一行「外层正文」虽属外层容器，却拿到 `tip`。

同时所有行 `padding-left` 都是同一个 24px——**没有随嵌套深度递增的缩进**，视觉上内外层完全贴合，无层次。

> **2026-10-31 补充（[V01 探查](callout-live-refinement-probe2-v01.md) §4.1）**：这不只是观感问题，是**既有缺陷**。`data-callout` 一旦被内层覆盖就不再恢复——三层嵌套下外层尾段被染成最内层类型。后果是既有片段 `[data-callout='note']` 只能命中第 1、2 行，**写「给最外层加样式」的片段无法达成**。V01 推荐逐层身份通道 `data-callout-lN`，对既有片段零破坏且能修复该缺陷。

要修，必须动 `data-callout` 的最内层语义，或引入逐层的第二身份通道。前者是**公开样式契约变更**（片段按 `[data-callout]` 书写，语义变化会改变既有片段效果），需走 style-contract 并重锚基线。

## 5. 两项待决策的冲突性质

两项都已在规格层有明确决策，不是漏实现：

| 需求 | 现状依据 | 冲突性质 |
| --- | --- | --- |
| 整标题可点击折叠 | `callout.md:58`「标题文字点击编辑，折叠箭头单独负责开合」 | 我们标题是真实文本、可定位编辑；Obsidian 敢整块点是因为它编辑态是整块 widget、标题不可编辑 |
| 光标进入退化为引用块 | `callout.md:56` 用户故事 2「保留外框时编辑正文」 | 正是本批核心目标；T01 取证已记录 Obsidian 自己也不满足此目标 |

**这两项若要做，等于推翻已发布的设计决策**，需要修订规格、T01 报告、`styleContract` 的 callout states 描述，并重写一批浏览器用例。不属本轮范围。

## 6. 建议的票面切分

按「未知量」而非按「观感条目」切分——同一视觉问题背后的技术未知可能只有一处。

| 票 | 内容 | 阻塞关系 |
| --- | --- | --- |
| [总票 / #668](https://github.com/ONEGAYI/vsidian/issues/668) | Live 形态收口，索引本报告与各子票 | 无 |
| [V01 / #669](https://github.com/ONEGAYI/vsidian/issues/669) | 行级形态能否承载容器级视觉（间距 + 嵌套边框 + 落点稳定） | 阻塞 T03 |
| [V02 / #670](https://github.com/ONEGAYI/vsidian/issues/670) | 引用容器内围栏/公式的装饰接缝（replace 重叠 + block widget 定位） | 阻塞 T04 |
| [T02 / #671](https://github.com/ONEGAYI/vsidian/issues/671) | 标题取类型色 | 无，可立即开工 |

V01 与 V02 都是「有明确退出条件的验证票」，不能以「票关闭」代替结论通过。若验证失败，回到技术方案重新选路，不以静态截图或部分可用冒充通过。

## 7. 未验证的边界

以下事项本轮没有实测，票面不得预设为已确认：

- 行级形态下改用「伪元素 / box-shadow / outline」承载上下间距的落点影响（探针只测了真实 padding）
- 引用内围栏若改为「不发射 block widget 头部、只做行类与高亮」的降级形态是否可接受
- 嵌套分层若改用「深度类 `-d2`/`-d3`」而非第二 `data-callout`，片段兼容影响范围
- 主题切换、CSS 片段热更新下上述改动是否稳定
- 10 万行档位的性能影响（现有 1千／1万／10万行档位可复用）

## 8. 一手依据

- 探针实测：本报告 §2–§4 的表格数据，2026-10-31，基线 `3d70cb36`
- CM6 行高记账：`@codemirror/view` `measureVisibleLineHeights`（3318-3368）、`measureTextSize`（3368-3405）
- Obsidian 1.14.4 `app.css`：`.callout-title` 取 `--callout-color`、`.callout-title-inner` 取 `--callout-title-color`（本机 `obsidian.asar` 提取，2026-10-28 取证）
- 既有降级边界记录：[mermaid-rendering.md §已知限制](../perf/2026-09-mermaid-rendering.md)、[math-rendering.md §已知差异](../perf/2026-09-math-rendering.md)
