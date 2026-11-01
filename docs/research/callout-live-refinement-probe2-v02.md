# V02：引用容器内围栏与公式的装饰接缝实测

- 状态：**验证完成，结论为「不可行（完整卡片）/ 可行（降级形态）」**（2026-10-31）
- 票面：[#670 / V02](https://github.com/ONEGAYI/vsidian/issues/670)，父票 [#668](https://github.com/ONEGAYI/vsidian/issues/668)
- 代码基线：`feat/callout-live-refinement`（工作树 `vsidian-callout-refine`）
- 前序报告：[callout-live-refinement-probe.md](callout-live-refinement-probe.md) §3
- 探查方式：真实 Chromium（`test/browser/runtime.mjs` 的 `chromium`）+ 生产 `WebviewSyncController` + 产物 CSS；扫描器部分以 esbuild 打包后用 node 直跑纯函数
- 探针脚本与中间产物一次性，已删除，不随仓库留存

---

## 结论摘要

| 问题 | 结论 | 证据级别 |
| --- | --- | --- |
| 冲突 1：replace 区间重叠 | **不抛错，静默取并集** —— 前序报告的「CM6 严格禁止」判断错误。唯一抛错点是零宽 replace，与重叠无关 | 已实测 |
| 冲突 2：block widget 锚在 `fence.from` | **能渲染，但卡头横带恒跨出 callout 容器左缘**（x=70，容器内容从 x=94 起） | 已实测 |
| 冲突 3：缩进列对齐 | **围栏行 +14px、行号列 −6px**。根因是 **CSS 特异性平局 + 遗漏**：callout 规则抢走中间行的 `padding-left`、留下 `text-indent` | 已实测 + 特异性复算 |
| 扫描器改造面 | **不能改 `indentColumns`**；须新增「容器前缀之后起算缩进」+ **深度感知**（容器边界语义） | 已实测 + 推断 |
| 增量重建 | 前缀剥离不改行数/行 offset，窗口锚点与 `trailingOpenStart` **语义不变**；只需 `OpenFence` 加 `depth` | 推断（有等价性实测支撑） |
| 多层前缀 | 深度感知扫描器天然给出「depth≥2 不产出」，**实现成本为零**；不建议专门支持 | 已实测 + 决策建议 |
| 降级路线 | **`hl`（纯语法高亮）可行且零缺陷**；「行类 + 行号」因缩进模型错位不可直接用 | 已实测 |

**总的判断：完整卡片形态不可行**，但**不是因为 replace 重叠**（那条前提是错的），而是因为：

1. **block widget 的宽度由 `.cm-content` 决定**，卡头横带在引用内必然跨出容器左缘——没有 CSS 之外的修法
2. **CSS 特异性平局**让 callout 的 `padding-left: 24px` 抢走代码卡中间行的缩进，而 `text-indent: -indent` 存活下来，造成「中间行反向缩进」；围栏行因 1,5,0 平局且文件靠后而保住卡片语义。**这个错位与缩进值无关，调 `--vsidian-code-indent` 无法修复**（两处引用同一变量，差值恒定 14px）

**降级形态可行**：只发语法高亮（`hl`），代价是丢弃卡头横带与行号列，零缩进计算、零 replace 交互。

---

## 1. 冲突 1：replace 区间重叠 —— 前序结论被推翻

### 1.1 前序报告的判断

[callout-live-refinement-probe.md:82](callout-live-refinement-probe.md) 写：

> 两个 replace 区间在同一行重叠，CM6 严格禁止。

### 1.2 实测：不抛错

裸 CM6（同一 `StateField` 内 `Decoration.replace`）与跨 field 两种装配，七组重叠形态全部**通过**，`EditorView` 构造无 throw、无 `console.error`/`console.warn`：

| 用例 | 区间 | DOM 文本 | 结论 |
| --- | --- | --- | --- |
| P1 同 field 部分重叠 | `[2,10)` + `[5,15)` | `ab` + `pqrstuvwxyz` | 并集 `[2,15)` 全隐 |
| P2 跨 field 部分重叠 | 同上，分属两 field | 同上 | 同上 |
| P3 一端相接 | `[2,10)` + `[10,18)` | `ab` + `stuvwxyz` | 相接正常拼接 |
| P4 完全包含 | `[2,20)` + `[5,8)` | `ab` + `uvwxyz` | 外层生效 |
| P5 三层重叠（同 field） | `[2,20)`/`[5,15)`/`[8,12)` | `ab` + `uvwxyz` | 外层生效 |
| P6 三层重叠（跨 field） | 同上分三 field | 同上 | 同上 |
| P7 相同区间跨 field | `[4,12)` × 2 | `abcd` + `mnopqrstuvwxyz` | 幂等 |

原文 26 字符 `abcdefghijklmnopqrstuvwxyz`，可见残留与「并集隐藏」逐一吻合。

**唯一会抛错的是零宽违规**，与重叠无关：把 `Decoration.replace` 的 `from == to` 且 `startSide > 0 && endSide <= 0` 传入时抛

```
RangeError: Invalid range for replacement decoration
```

（`@codemirror/view` 6.43.13 `dist/index.js:363`）。生产代码里 `fenceHideDeco.range(openLine.from, openLine.to)` 恒 `from < to`（空围栏行的 `from < to` 也成立），QuoteMark 的 `hideDeco.range(node.from, to)` 同理，两者都不会触发这条。

### 1.3 生产链路上的后果

不抛错不代表没问题。实测反例：引用内 mermaid 围栏（`buildMermaidDecorationRanges` 发整块跨行 replace）与 QuoteMark 的 `hideDeco` 同场时（独立新页，无残留）：

| 行 | 文本 | 行盒 y | 行盒高 | 结果 |
| --- | --- | --- | --- | --- |
| L1 | `> [!note] 标题` | 34 | 21 | 正常 |
| L2 | `> ```mermaid` | 55 | **97.89** | 被撑高近 5 行 |
| L3 | `> graph TD` | 152.89 | 21 | 正常（`vsidian-callout-last`） |
| L4 | `> A-->B` | **null** | null | 未物化 |
| L5 | `> ``` ` | **null** | null | 未物化 |
| L6 | `> 尾部` | **null** | null | 未物化 |

整块跨行 replace 覆盖 L2–L5，只有一块 `vsidian-mermaid vsidian-mermaid-error`（x=94、y=65.5、w=780、h=76.89）被物化成替身，内容是错误提示加带 `> ` 的源码行。截图证据：L2–L3 塌成一块灰底错误框，L4–L6 干脆没有行盒。

视觉上 L2–L6 塌成一块错误提示——**这是「能跑但观感崩坏」，不是「跑不起来」**。错误本身来自 mermaid 收到带 `> ` 前缀的源码（`> graph TD` 不是合法 mermaid），属围栏识别后未剥内容前缀的连带问题，与 replace 重叠解耦。

**结论：冲突 1 不是阻塞项。** 重叠语义是「取并集」，需要设计者确认并集结果符合预期：对卡片围栏行（整行隐藏）符合预期；对 mermaid（错误态吞掉多行）不可接受，但那是「引用内 mermaid 该不该渲染」的独立决策。

---

## 2. 冲突 2：block widget 锚在 `fence.from`

### 2.1 DOM 形态

生产构建器把卡头发成 `Decoration.widget({ block: true, side: -1 })`，锚点 `fence.from`（即 `>` 之前）。实测 DOM：

```
DIV.vsidian-code-card-header-mount
  DIV.vsidian-code-card-header
    DIV.vsidian-code-card-header-label  "JavaScript"
    ... 复制/折叠/换行按钮
```

父链：`cm-content.cm-lineWrapping` → `vsidian-code-card-header-mount`。**卡头是 `cm-content` 的直接子节点，不是 `.cm-line` 的子节点**——CM6 的 block widget 本就插在行间。

### 2.2 几何：横带跨出容器左缘

| 元素 | x | 宽度 | 说明 |
| --- | --- | --- | --- |
| `.cm-content` 左缘 | 70 | — | 正文容器 |
| callout 行 `.cm-line`（pad 24px） | 70 | 806 | 行盒 |
| callout 正文文字 | 94 | — | 行盒 + 24px 内边距后 |
| **卡头横带 `header-mount`** | **70** | **806** | **与行盒同宽，未吃 callout 的 24px 左内距** |
| 卡头标签文字 | 82 | — | 横带 + 12px 自身内距 |

顶层对照（无 callout）：

| 元素 | x |
| --- | --- |
| `.cm-line`（pad 38px） | 70 |
| 卡头横带 | 70 |
| 卡头标签 | 82 |

**两者卡头 x 完全相同（70）**。区别在于 callout 场景下正文从 94 起，卡头标签从 82 起——横带比容器内容左移 12px，且横带整体压在 callout 底色上但不受 24px 内距约束。

### 2.3 视觉后果（截图证据）

引用内围栏开启卡片后的实测布局（x 为左缘，全部来自 DOM `getBoundingClientRect`）：

```
callout 标题行       x=70  ┐
标题文字             x=94  │ 容器内距 24px
正文                 x=94  │
[📄 JavaScript    ▼] x=70  ← 卡头横带未吃内距，跨出容器左缘
1  const a = 1       x=94   ← 行号 x=64（已穿出容器）
（围栏行清空，高 14px）
尾部                 x=94  ┘
```

卡头横带左端伸出 callout 的 24px 内距边界（70 vs 94，差 24px），视觉上像「贴纸压过外框」。这不是「渲染失败」，是「渲染位置错层」。**修法不在 widget 侧**——block widget 的宽度由 CM6 按 `.cm-content` 宽度铺开，要吃容器内距只能走 CSS 给 `header-mount` 加左偏移（会把右侧也缩进，破坏卡片与正文的同宽关系），或改用行内 widget（放弃块级横带形态）。

截图（`out/test/v02b-mode-real.png` 与 `v02g-q-q24head.png`，探针产物已按约束删除）：卡头横带灰底从容器左缘起，与上下 callout 行浅蓝底形成「横带压边」的错觉。

### 2.4 连带缺陷：围栏行的行高塌陷

| 状态 | 围栏行高 | 代码行高 |
| --- | --- | --- |
| 生产基线（未识别） | 21px | 21px |
| 卡片开启（围栏行被 replace 清空） | **14px** | 21px |

`Decoration.replace` 清空后围栏行退化为 14px（`.cm-line` 默认行高）。顶层卡片同样 14px，属既有行为，但叠加 callout 的连续底色后，圆角边界处出现 14/21/14 的锯齿。

---

## 3. 冲突 3：缩进列对齐 —— 真正的位置错层

### 3.1 生产基线（未识别围栏）的可见坐标

文档 `> [!note] 标题 / > 正文 / > ```js / > const a = 1 / > ``` / > 尾部`，viewport 900px，`.cm-content` 左缘 x=70，字体 13px 等宽。每行都取**独立新页**测量（消除多次 `init` 的 DOM 残留）：

| 行 | 文本 | padding-left | 首字符 | 首字符可见 x |
| --- | --- | --- | --- | --- |
| L1 | `> [!note] 标题` | 24px | `>` | 94 |
| L2 | `> 正文` | 24px | `正` | 94 |
| L3 | `> ```js` | 24px | `` ` `` | 94 |
| L4 | `> const a = 1` | 24px | `c` | 94 |
| L5 | `> ``` ` | 24px | `` ` `` | 94 |
| L6 | `> 尾部` | 24px | `尾` | 94 |

**引用内所有内容行都从 x=94 起笔**（70 + 24）。`>` 与后随空格被 QuoteMark 的 `hideDeco` 替换成零宽占位，所以剩余文本从行盒内容起点开始。这就是「引用内围栏渲染态的**唯一正确基线**」。

### 3.2 卡片形态的偏移

| 行 | 形态 | 计算 padding-left | 计算 text-indent | 行盒高 | 首字符可见 x | 相对基线 94 |
| --- | --- | --- | --- | --- | --- | --- |
| 围栏行（```` ```js ````，**呈现态**） | `edge-top` | 38px | 0 | **14px** | 不可见（整行 replace 清空） | — |
| 围栏行（同上，**编辑态**） | `edge-top` | 38px | 0 | 21px | **108** | **+14** |
| 代码行（`const...`） | 中间行 | **24px** | **−38px** | 21px | **94** | 0 |
| 闭合围栏（编辑态） | `edge-bottom` | 38px | 0 | 21px | **108** | **+14** |

顶层对照（同一构建器、无 callout、独立新页、单次发射）：

| 行 | padding-left | text-indent | 首字符可见 x |
| --- | --- | --- | --- |
| 围栏行（编辑态） | 38px | 0 | 108 |
| 代码行 | 38px | −38px | 108（行号 widget 存在时 @146） |

**根因是一个 CSS specificity 平局与一条遗漏，不是「缩进值算错」。**

实测四行竞争规则的 `(id, class, type)` 特异性：

| 行号 | 选择器 | 特异性 | 设置 |
| --- | --- | --- | --- |
| `main.css:2467` | `#app .cm-editor .cm-scroller .vsidian-quote-line.callout.vsidian-callout-quiet` | **(1,5,0)** | `padding-left: 24px` |
| `main.css:3139` | `#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line` | (1,4,0) | `padding-left: var(--vsidian-code-indent)`；`text-indent: -indent` |
| `main.css:3149` | …`.vsidian-code-card-line.vsidian-code-card-edge-top` | **(1,5,0)** | `padding-left: var(--vsidian-code-indent)`；`text-indent: 0` |
| `main.css:3160` | …`.vsidian-code-card-line.vsidian-code-card-edge-bottom` | **(1,5,0)** | `padding-left: var(--vsidian-code-indent)`；`text-indent: 0` |

于是：

- **围栏行**（`edge-top`/`edge-bottom`，特异性 1,5,0 与 callout quiet 打平）→ 同为 1,5,0，**文件靠后的 `main.css:3149/3160` 胜**，拿到 38px padding、0 text-indent → 文字 @108
- **中间代码行**（只有 `.vsidian-code-card-line`，特异性 (1,4,0)）→ **输给 callout quiet 的 (1,5,0)**，`padding-left` 被覆盖成 **24px**；但 callout quiet **不设 `text-indent`**，所以 (1,4,0) 规则的 `text-indent: -38px` 存活 → 内容盒从 94 起、首行拉回 94−38=56，行号 widget（`margin-left: 8px` + `min-width: 2ch`）落到 64，正文落到 56+38=94

复算校验：`indentPx = 2ch(14px) + 24px = 38px`，`widget 宽 = min-width 2ch(14) + margin-left 8 + margin-right 16 = 38px`；`内容盒 = 70 + 24 = 94`，`首行 = 94 − 38 = 56`，`行号 = 56 + 8 = 64`，`正文 = 56 + 38 = 94`。**与实测 64 / 94 逐一吻合。**

**结论**：中间代码行「恰好落在 94」是**两条规则各管一半**的巧合——callout 抢走了 `padding-left`，卡片留下了 `text-indent`。这不是设计，是特异性漏网。围栏行因为特异性打平且文件靠后而保住了完整卡片语义，于是比中间行多出 14px。

**这意味着「改缩进值」修不好**：把 `--vsidian-code-indent` 调大或调小，中间行和围栏行会**同步移动相同的量**（两处都引用同一变量），14px 的差值恒定。修法只有一条——给中间代码行也提升特异性到 (1,5,0) 以上，或在 callout 规则里显式让位（`:where()` 降特异性或加 `.vsidian-code-card-line` 排除）。

### 3.3 行号与卡头的列

| 元素 | 引用内 x | 顶层 x |
| --- | --- | --- |
| 卡内行号 | **64** | **78** |
| 卡头横带 | 70 | 70 |
| 卡头标签 | 82 | 82 |

引用内行号落在 x=64，**比容器左缘（70）还左 6px**，压在 gutter 区（gutter 在 x=24、宽 20）。成因就是上面的「padding 被抢、text-indent 存活」：内容盒 94 − 38 = 56 起笔，行号在 56 + 8 = 64。顶层因为 padding 与 text-indent 都是 38（特异性都够），首行回到 70，行号在 78——**正常**。

---

## 4. 扫描器改造面

### 4.1 不能改 `indentColumns`

`src/shared/mermaid.ts:159` 的 `indentColumns` 只计空格与 Tab，是 CommonMark 口径的**缩进**语义，被顶层围栏、列表内围栏共用。把 `>` 塞进去会破坏：

| 既有边界 | 改 `indentColumns` 的后果 |
| --- | --- |
| 0-3 列缩进容忍 | `>` 被当作 1 列 → `>    ```` ``` ````（`>` + 4 空格）变成 5 列，**误降级** |
| 4 列为缩进代码块 | 同上，边界从「4 空格」漂移到「3 空格 + `>`」 |
| 未闭合 EOF 降级 | 语义未变，但误降级面扩大 |
| 列表内围栏（`  ```` ``` ````） | `indentColumns` 与列表缩进耦合，加 `>` 判定会让 `- a` 的续行误判 |

实测确认：顶层 `    ```` ```js ````（4 空格）不产出围栏（正确），`   ```` ```js ````（3 空格）产出。任何「把 `>` 计为缩进」的改法都会把这个 0-3/4 的分界弄乱。

### 4.2 三种剥前缀候选的实测对比

| 候选 | `> \`\`\`js` | `>  \`\`\`js`（+1 空格） | `>   \`\`\`js`（+2） | `> > \`\`\`js` | `> - a` / `>   \`\`\`` | 容器逃逸 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 空白化保留 offset** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ 误配 |
| **B 内容相对缩进** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ 误配 |
| **C 真剥 + 坐标平移** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ 误配 |

逐条说明：

**A（`blankContainerPrefix` 同款，把前缀换成等宽空格）**
- `>   ```` ```js ````（`>` 后 2 空格）：空白化后是 `    ```` ```js ````——4 列，被当成缩进代码块，**降级**。markdown-it 认为这是围栏（`quotedFences=1`）。
- `> > ```` ```js ````：空白化后 4 列，**降级**。markdown-it 认为是 depth=2 的围栏。
- `> - a` + `>   ```` ```js ````：`> ` 剥成 2 空格后是 `    ```` ```js ````——4 列，**降级**。
- **A 的失败面正是「引用内稍深缩进」与「嵌套引用」——恰恰是 callout 的主要形态。**

**B（改扫描器：缩进从容器前缀之后起算）**
- 全部成对通过，且与 markdown-it 的 `quotedFences` 判定逐条一致（12/12）。
- 需要新增一个「容器前缀长度」函数，并与 `indentColumns` 组合。这是唯一能同时满足「内容相对缩进」与「多层嵌套」的形态。
- 坐标仍为全文 offset（前缀只是起算点平移，不改行 offset），因此**没有坐标映射成本**。

**C（真剥前缀 + 坐标回映）**
- 需要把 stripped 坐标映射回原文，`parseLinePrefix` 对每行重解析，每条围栏两次映射。
- 实测 T7（`> > > ```` ```js ````）映射出错：`from=6, to=11`（应为 `to=29`）——多层前缀下 `to` 的回映把行内偏移算进了前缀宽度里。**这是实现缺陷，但也说明回映逻辑需要独立测试面**，成本高于收益。

**推荐 B**：在 `src/shared/mermaid.ts` 新增 `containerPrefixColumns`（或 `lineIndentAfterContainer`），让 `scanFencesDetailed` 的缩进起算点从「行首」变成「容器前缀之后」。公式侧 `math.ts` 同型：`trimmed.startsWith('$$')` 之前先剥容器前缀。

### 4.3 既有边界在该改法下的状态

| 边界 | 改法 B 后 | 是否需要新约定 |
| --- | --- | --- |
| 0-3 列缩进容忍 | 保持（相对内容起算） | 否 |
| 4 列为缩进代码块 | 保持：`>     ```` ``` ````（`>` 后 5 空格）剥前缀后余 4 空格 → 降级，与 markdown-it 一致（实测两方都不产出） | 否 |
| 3 列为围栏 | 保持：`>    ```` ``` ````（`>` 后 4 空格）剥前缀后余 3 空格 → 围栏，与 markdown-it 一致（实测两方都产出） | 否 |
| 未闭合 EOF 降级 | 保持（不产出，`open` 非 null） | 否 |
| 列表内围栏 | **无关**（容器前缀只剥引用层，列表缩进仍走 `indentColumns`） | 否 |
| 容器边界（逃逸） | **新增风险**：`> \`\`\`js` / `outside` / ` ``` ` 会被配成跨容器围栏（实测 A/B/C 全部误配，markdown-it 判定为 depth=1 + depth=0 两个独立围栏） | **是** |

实测确认（`indentColumns` 原语义下）：顶层 `    ```` ```js ````（4 空格）不产出围栏，`   ```` ```js ````（3 空格）产出。**把 `>` 计为缩进的做法会破坏这个分界**——例如 `>    ```` ````（4 空格）被记成 5 列而误降级，而正确值（剥容器后 3 列）应当是围栏。

**容器边界是必须新定的语义。** 实测对拍（`markdown-it` 8/8 与生产阅读管线同版本）：

| 用例 | markdown-it 判定 | 剥前缀（A/B/C） | 差 |
| --- | --- | --- | --- |
| `> ```js` / `> x` / `outside` / ` ``` ` | depth=1 `js` + depth=0 空围栏（两个独立块） | 一个跨容器围栏 `code="  x\noutside"` | 错 |
| `> ```js` / `> x` / `` / ` ``` ` / `tail` | depth=1 + depth=0 | 一个围栏 `[0,16)` | 错 |
| `> > ```js` / `> > x` / ` ``` ` | depth=2 + depth=1 | 一个围栏 | 错 |

深度感知版（开围栏记 depth，闭合要求同 depth，depth 变小即隐式闭合不产出）实测 **10/10 与 markdown-it 一致**：

| 用例 | markdown-it | 深度感知扫描 |
| --- | --- | --- |
| 正常闭合 `> ```js` / `> x` / `> ``` ` | 1 条 | 1 条 ✅ |
| 嵌套 `> > ```js` / `> > x` / `> > ``` ` | 1 条 depth=2 | 1 条 ✅ |
| 深度递减闭合 `> > ```js` / `> > x` / `> ``` ` | 2 条（depth2 + depth1） | 0 条（隐式闭合降级）✅ 方向安全 |
| 容器逃逸两种 | 2 条独立 | 0 条（降级）✅ |
| `> ` + 3 空格（`>    ```js`） | 1 条 | 1 条 ✅ |
| `> ` + 4 空格（`>     ```js`） | 0 条 | 0 条 ✅ |
| `> - a` / `>   ```js ` | 1 条 | 1 条 ✅ |
| 顶层 `    ```js`（4 空格，对照） | 0 条（缩进代码块） | 0 条 ✅ 不受影响 |

**这意味着改造面不止「剥前缀」，还要给扫描器加深度状态。** `OpenFence` 需要新增 `depth` 字段，并且增量重建的 `initialOpen` 传递要带上它。

**「相对缩进 vs 绝对缩进」这条边界实测与 markdown-it 一致，无需另定**：`>` 后的空白数按内容相对起算，3 空格是围栏、4 空格不是——与顶层完全同构。前序担心的「边界漂移」只在改 `indentColumns` 的实现里出现；改法 B（另加容器前缀起算点）不触碰它。

---

## 5. 增量重建

### 5.1 `trailingOpenStart` 与窗口锚点

容器前缀剥离**不改变行数、不改变行 offset**（B 只是缩进起算点平移），因此：

- `rebuildFences` 的行号 ↔ offset 换算（`doc.lineAt`）完全不受影响
- `seedFrom`/`seedTo`、`anchorEnd`、`trailingOpenStart` 都基于行首 offset，**全部保持有效**
- 批续扫的 `initialOpen` 传递中新增 `depth` 字段即可，语义与 `char/run/info` 同类

实测等价性（`scanFencesDetailed` 全量 vs 从 `changeLine-2` 起只扫窗口）：

| 用例 | 全量 | 窗口增量 |
| --- | --- | --- |
| 围栏内改一行（`a=1`→`a=2`） | `[0,27) js` | `[0,27) js`（一致） |
| 未闭合引用围栏 | 无产出 | 无产出（一致） |

**推断**：无需改 `rebuildFences` 的窗口逻辑。唯一要改的是 `OpenFence` 接口加 `depth`，以及 `initialOpen` 的构造点（`liveMermaid.ts:326/332`、`scanFencesDetailed` 的 `initialOpen` 分支）。这条我只有 2 个用例的实测（能覆盖正常与未闭合），窗口跨容器边界的形态属推断。

### 5.2 一个真实风险：`rebuildFences` 的锚点在容器内

`anchorEnd` 取「种子前最后一个已闭合围栏的 `to`」。若那个围栏在引用内且引用在之后结束，从它之后起扫是正确的顶层状态——但**若新增深度语义，`anchorEnd` 之后的「顶层」未必是 depth=0**。

推断：`anchorEnd` 之后应重置 depth=0（因为它取的是「已闭合围栏之后」，闭合围栏的闭合行 depth 已确定），这在深度语义下仍成立。**需要一条专门的单测钉住**，不建议只靠推演。

---

## 6. 多层前缀

**单层（depth=1）支持，depth≥2 明确不支持**——理由不是「做不到」，而是「收益与改动面不成比例」。

实测（B 内容相对缩进）下 `> > \`\`\`js` 能被正确识别为 depth=2 的围栏，与 markdown-it 一致。但：

1. **改动面从「一个扫描函数」扩到「一个 field 的 schema」**：`depth` 进入 `OpenFence` 进而进入 `MermaidFenceTable`，所有消费方（`liveCodeCard` 的 `buildCodeCardDecorations`、`liveMermaid` 的 `buildMermaidDecorationRanges`、`liveEmbed`）都要决定是否消费它，`rebuildFences` 的映射与 `initialOpen` 传递也要带。
2. **渲染形态无定义**：`> > \`\`\`js` 是「callout 内嵌 callout 内的代码块」。行级形态下内层 callout 的 `data-callout` 已取最内层（前序报告 §4 实测），缩进列要按 depth 叠加到 `--vsidian-code-indent`，而 §3 已证明该变量连单层的容器内距都表达不了。
3. **收益低**：嵌套 callout 里的代码块不是常见形态，且本仓库的嵌套 callout 本身尚未收口（前序报告 §4：内外层同色、无递增缩进）。

**建议**：深度感知扫描器天然给出这个缺省——闭合要求同 depth，depth≥2 的开围栏直接不产出（降级源码）。这条实现成本为零（就是 `depth === 1` 的产出条件），是「深度感知」的免费副产品。

---

## 6.5 阅读侧对照（语义基准）

同一批文档喂给生产阅读管线的 `markdown-it` + `@vscode/markdown-it-katex`：

| 形态 | 阅读侧 | Live 现状 | 一致性 |
| --- | --- | --- | --- |
| `> ```js` … `> ``` ` | `<blockquote><pre><code class="language-js">` | 源码 + `.vsidian-code-line` 底色 | **不一致**（阅读有代码块外观） |
| `> > ```js` … | 双层 blockquote + 代码块 | 源码 | 不一致 |
| `> - a` / `>   ```js ` | blockquote > ul > li > pre | 源码 | 不一致 |
| `> ```js` / `> x` / ` ``` ` （逃逸） | 两个独立块（depth1 代码 + depth0 空围栏） | 源码 | 一致（都不误配） |
| `> $$` / `> x^2` / `> $$`（多行块） | `<p class="katex-block">` 渲染 | 源码 | 不一致 |
| `> $$x^2$$`（单行） | 渲染 | **渲染** | ✅ 一致 |
| `> 公式 $x^2$ 结尾` | 渲染 | **渲染** | ✅ 一致 |

**两条重要修正**：行内公式与单行 `$$` 在引用内**已经和阅读侧一致**，因为它们是行内装饰；只有多行块与围栏因跨行 replace 与行首锚定而落后。前序报告把「公式不渲染」笼统列为问题，粒度太粗。

---

## 7. 降级路线：可行，且已实测

### 7.1 三档降级形态实测

文档同上，viewport 900，**每种形态独立新页**。`hl` = 只发语法高亮（生产 `card:false` 路径）；`linesPlain` = 高亮 + 行类 + 行号，缩进沿用生产公式 `calc(2ch + 24px)`；`linesPrefix` = 同上但缩进额外加 2ch（把前缀宽算进去）；`q24` = 高亮 + 行类，缩进改为 `calc(24px + 2ch + 24px)`。

| 形态 | 卡头 | 行号 x | 围栏行首字符 x | 代码行首字符 x | 与基线 94 的关系 |
| --- | --- | --- | --- | --- | --- |
| 基线（`prod`） | 无 | — | 94 | 94 | 基准 |
| `hl`（只高亮） | 无 | — | **94** | **94** | **全部命中** |
| `linesPlain` | 无 | 64（出界 −6） | **108**（+14） | 94 | 围栏行右偏、行号穿出容器 |
| `linesPrefix` | 无 | 50（出界 −20） | 122（+28） | 80（−14） | 双向偏离 |
| `q24` | 无 | — | 132（+38） | **32**（−62） | 代码行严重穿出容器 |
| `q24num` | 无 | 40（−30） | 132 | 70 | 同上 |
| `q24head` | **有**（x=70 跨出容器） | 40 | 132 | 70 | 卡头跨容器 + 缩进错 |

语法高亮 mark 本身**不改布局**：`hl` 形态下 `const`@94、`a`@136、`=`@150、`1`@164，与基线独立字符坐标逐字节一致（纯逻辑探针与浏览器双向确认）。

### 7.2 结论

**形态 `hl`（只加语法高亮，不发行类/行号/卡头）是唯一「零缺陷」的降级形态**：

- 围栏行源码保持可见（不 replace，与 QuoteMark 无任何交互，不触碰冲突 1）
- 语法高亮 mark 落在源码真实列上（`const` @94，与基线逐字节一致），因为 mark 装饰不改布局
- 无缩进计算，不触碰 `--vsidian-code-indent`，不进冲突 3

代价：没有卡头横带、没有行号、没有复制/折叠/换行按钮、围栏符号 `` ```js `` 可见。

**形态 `linesPlain`（行类 + 行号）在引用内是错的**：围栏行 +14px、行号 −6px 出界。**根因不是缩进值算错，是 §3.2 的特异性漏网**——调 `--vsidian-code-indent` 只会让两行同步平移，14px 差值恒定。

实测 `q24`（把缩进改成 `calc(24px + 2ch + 24px)` 试图补偿容器内距）更糟：围栏行 +38px、代码行 −62px 穿出容器。因为 `padding-left` 被 callout 抢成 24px，而 `text-indent` 拿到 62px，首行被拉到 94 − 62 = 32。

**修法必须动特异性，不是动数值**。两条可行路径（都属 style-contract 变更面，不在 V02 内）：

1. 给中间代码行规则提升特异性到 ≥ (1,6,0)，或
2. 把 callout quiet 的 `padding-left` 降到 `:where()` 零特异性（但那是既有公开契约，会影响既有片段）

**`q24head` 形态（带卡头）**：卡头横带仍从 x=70 起（与 `.cm-content` 同宽），跨出容器左缘。block widget 的宽度由 CM6 按 `.cm-content` 铺开，**卡头在引用内必然跨容器**。除非改成行内 widget 或纯 CSS 偏移（后者会同时缩右缘，破坏卡片与正文同宽），否则完整卡片形态无解。

### 7.3 推荐

**引用内围栏采用 `hl` 形态**（只高亮、不发卡头/行号/行类），并接受：

- 围栏符号 `` ```js `` 可见
- 无卡头、无复制按钮
- 与阅读侧（markdown-it 渲染 `<pre><code class="language-js">`）不一致——阅读侧有完整代码块外观

若要 `linesPlain` 的观感，必须先解 §3.2 的特异性漏网（callout 规则抢 `padding-left`）。那是独立的 CSS 架构改动，涉及公开样式契约（callout 的 `padding-left: 24px` 是片段书写入口之一），不属于 V02。

**注意 `hl` 形态的一个残留**：`.vsidian-code-line` 类（`liveDecorations.ts:1212-1215` 的 `FencedCode`/`CodeBlock` 分支）已经给了等宽字体 + 底色。所以 `hl` 形态相对**现状**的唯一增量是 **token 着色**，其余观感不变——现状并非「什么都不做」，而是「有代码底色、无语法高亮」。

因此这条降级路线的实际收益 = 「引用内围栏能看到语法高亮」，成本 = 「扫描器改造 + 深度语义」。**这是本报告里性价比最高的一条**，但也是收益最小的一条。如果 T04 的判断是「只高亮不值得改扫描器」，那么「维持现状 + 更新已知限制文档」是同样合法的结论（见 §9）。

---

## 8. 公式块（`$$`）的独立结论

### 8.1 现状：三种引用内公式，两种意外「能用」

| 文档 | 扫描结果 | Live 呈现 | 说明 |
| --- | --- | --- | --- |
| `> $$` / `> x^2` / `> $$` | `scanMathRanges` **返回空** | 源码三行 | 块扫描要求剥缩进后行首 `$$`，`trimmed` 是 `> $$` 不命中 |
| `> $$x^2$$`（单行） | `scanMathRanges` 产出 `block [15,22)`；但 `mathBlocksField`（多行块表）为空 | **渲染成 KaTeX** | `scanMathInLine` 的段内 `$$…$$` 分支命中，走**视口内联路径**（`buildMathDecorationRanges`），与多行块表无关 |
| `> 公式 $x^2$ 结尾` | `scanMathRanges` 产出 `inline [18,23)` | **渲染成 KaTeX** | 行内 `$…$` 本就跨容器（正则不锚行首） |

实测单行 `$$x^2$$` 的 widget：`SPAN.vsidian-math.vsidian-math-block`，x=94、y=69、h=41、w=780——**正确落在 callout 内容左缘（94），无错层**。行内公式同理（x=129、y=59、h=14）。

**这是个重要发现：行内公式与单行 `$$` 在引用内已经正确渲染，因为它们是行内 replace/mark，不受行盒偏移与跨行约束影响。** 唯一不工作的是**多行 `$$` 块**，它需要跨行 replace（`mathBlockDecorations`），与 mermaid 同型。

对照顶层多行块（光标移开后）：`mathBlocksField` 有 `block [0,9)`，渲染成 `SPAN.vsidian-math.vsidian-math-block`（x=70、h=41），三行源码收进一个 widget。**同一机制在引用内完全不触发**（块表为空）。

### 8.2 多行块的障碍

与 mermaid 完全同型：跨行 `Decoration.replace` 由 `mathBlockDecorations` 发，与 QuoteMark 的 `hideDeco` 重叠（实测不抛错，取并集）。`scanMathRanges` 的块模式要求 `trimmed.startsWith('$$')`，引用内是 `> $$`，不命中。

改法与围栏同构（容器前缀剥离），但**优先级低于围栏**：

1. 多行块在 callout 内是低频形态
2. 跨行 replace 在引用内会整块塌成 widget（实测 mermaid 同型：4 行塌成一块错误框、后 3 行行盒消失），观感风险高
3. 需要同样的 depth 语义（`> > $$` 的嵌套）

### 8.3 建议

- **不动多行 `$$` 的引用内扫描**，维持源码降级
- 在 [docs/perf/2026-09-math-rendering.md](perf/2026-09-math-rendering.md) 的「已知差异与限制」补一条：引用内多行 `$$` 块 live 显源码；**行内 `$…$` 与单行 `$$x$$` 在引用内已正常渲染**（务必分开写，不要笼统说「公式不渲染」——这是前序报告遗留的误述）
- 若未来与围栏一并支持，复用同一个容器前缀剥离函数，不另建

---

## 9. 三条可选路线与文档更新

### 9.1 三条路线

| 路线 | 收益 | 成本 | 本报告判断 |
| --- | --- | --- | --- |
| **A 维持现状** | 零 | 零（只改文档） | **合法结论**。现状是「代码底色 + 等宽字体」，缺的只是语法高亮与卡片外观 |
| **B `hl` 降级**（§7.3） | 语法高亮 | 扫描器加容器前缀 + 深度语义（`OpenFence.depth`、`initialOpen` 传递、单测面） | **推荐**。收益明确、风险封闭（不碰 replace、不碰缩进） |
| **C 完整卡片** | 卡头 + 行号 + 复制/折叠 | B 的成本 + CSS 特异性重构（公开契约）+ block widget 容器归属重设计 | **不可行**。两个硬约束都不是「再调一下」能解决的 |

**A 与 B 都是合法出口。** 若选 A，需要如实记录限制；若选 B，按 §4.2 的改法 B + §4.3 的深度语义实施。

### 9.2 需要更新的文档

| 文档 | 位置 | 改什么 |
| --- | --- | --- |
| [docs/perf/2026-09-mermaid-rendering.md](perf/2026-09-mermaid-rendering.md) | 「已知限制」第 1 条 | 现写「live 扫描剥引用前缀即可」——**需改写**：剥前缀不是充分条件，还需容器边界深度语义；并明确当前维持降级 |
| [docs/perf/2026-09-math-rendering.md](perf/2026-09-math-rendering.md) | 「已知差异与限制」 | **新增**：引用内多行 `$$` 块 live 显源码；行内 `$…$` 与单行 `$$x$$` 已正常渲染（区分开写，不要笼统说「公式不渲染」） |
| [docs/research/callout-live-refinement-probe.md](callout-live-refinement-probe.md) | §3.3 第 2 条 | 「CM6 严格禁止」**是错的**，须更正为「取并集，不抛错」；该条不应作为「剥前缀不可行」的依据 |
| 同上 | §3.3 第 3 条 | 「缩进计算按 x=0 起点算，与引用缩进叠加后列对齐失准」方向正确，但**根因是 CSS 特异性平局**（§3.2），不是缩进值叠加——落地时按 §3.2 的机制描述改 |

前序报告 §7「未验证的边界」中「引用内围栏若改为不发射 block widget 头部的降级形态是否可接受」——本报告 §7 已答：**可接受**，`hl` 形态零缺陷；「行类 + 行号」因特异性漏网不可直接用。

---

## 10. 一手依据

- 探针实测：本报告全部数据，2026-10-31，工作树 `vsidian-callout-refine`（`feat/callout-live-refinement`）
  - 扫描器纯逻辑：esbuild 打包 `src/shared/mermaid.ts`、`src/shared/math.ts` 后 node 直跑
  - 渲染/几何：Playwright Chromium（headless）+ 生产 `WebviewSyncController` + 产物 CSS，`viewport 900×900`
  - 重叠矩阵：裸 `EditorView` + `StateField<DecorationSet>`，7 组重叠形态 + 7 组部分重叠形态
  - 阅读对拍：`markdown-it` + `@vscode/markdown-it-katex`（与生产阅读管线同版本）
- CM6 版本：`@codemirror/view` 6.43.13、`@codemirror/state` 6.7.6（`node_modules` 实测）
- 关键源码位置：
  - `src/shared/mermaid.ts:159-175`（`indentColumns`，只计空格与 Tab）
  - `src/shared/mermaid.ts:227-258`（`scanFencesDetailed` 状态机，`cols <= 3` 双处判定）
  - `src/shared/math.ts:216-224`（`opensMathBlockLine`，`trimmed.startsWith('$$')`）
  - `src/shared/math.ts:279`（块模式入口）；`math.ts:129-162`（`scanMathInLine`，段内 `$$…$$`）
  - `src/webview/liveCodeCard.ts:577`（卡头 block widget 锚 `fence.from`）
  - `src/webview/liveCodeCard.ts:606-609`（围栏行整行 replace）
  - `src/webview/liveCodeCard.ts:584-604`（行类 + `--vsidian-code-indent` 注入）
  - `src/webview/liveDecorations.ts:1212-1215`（`FencedCode`/`CodeBlock` → `.vsidian-code-line` 行类）
  - `src/webview/liveDecorations.ts:1455-1462`（QuoteMark `hideDeco`）
  - `src/webview/main.css:2467-2478`（callout quiet，特异性 **(1,5,0)**，`padding-left: 24px`）
  - `src/webview/main.css:3139-3147`（通用卡片行，(1,4,0)，`padding-left` + `text-indent: -indent`）
  - `src/webview/main.css:3149-3158` / `3160-3167`（edge-top / edge-bottom，**(1,5,0)**，`text-indent: 0`）
  - `node_modules/@codemirror/view/dist/index.js:361-366`（`RangeError: Invalid range for replacement decoration` 唯一抛错点）
