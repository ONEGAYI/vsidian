# 文档内 CSS 作用域与最低宿主兼容性探针（T01 / #566）

## 状态与复现入口

2026-10-16 执行，[T01 探针票 #566](https://github.com/ONEGAYI/vsidian/issues/566)（父票 #565「双模式原生 HTML 与文档内样式」）研究交付。本报告为自动化探针证据，**不等于用户人工验收**；探针不定义产品行为，实施细节以 T02–T09 各票规格为准。

复现入口（探针工作树 `D:\.zcode\worktrees\vsidian-565-t01-probe`，分支 `spec/565-t01-probe`）：

| 步骤 | 命令 | 证据落盘 |
| --- | --- | --- |
| 构建 | `node esbuild.mjs` | `out/test/html-css-scope-probe/esbuild.log`（EXIT=0） |
| 真宿主矩阵 | `VSIDIAN_TEST_VSCODE_PATH=<1.82.3 Code.exe> node test/integration/htmlCssScopeProbe/runProbe.mjs` | `.vscode-test/html-css-scope-probe.log`（完整 stdout + 退出码）、`.vscode-test/html-css-scope-probe-report.json` |
| 本机浏览器矩阵 | `node test/integration/htmlCssScopeProbe/runBrowserProbe.mjs` | `out/test/html-css-scope-probe/browser-probe.log`、`browser-probe-result.json`、`browser-probe-b2.png` |
| 进仓长期证据 | — | `docs/research/data/html-css-scope-probe-host-1.82.3.json`、`docs/research/data/html-css-scope-probe-browser-chromium151.json`、`docs/research/data/html-css-scope-probe-b2-evidence.png` |

复核纪律与仓库约定一致：读同一份报告，不为补看输出重跑。探针源码在 `test/integration/htmlCssScopeProbe/`（probeCore.ts 为双环境共用矩阵核心；suite.ts/runProbe.mjs 为宿主侧；runBrowserProbe.mjs 为浏览器侧），不进 VSIX。

## 一、环境固定

| 项 | 值 | 取得方式与退出码 |
| --- | --- | --- |
| 分支 SHA | `5fbdc444aacb859708eb37f683a83262446529cd`（`spec/565-t01-probe`，基于集成分支 5fbdc444） | `git rev-parse HEAD` |
| 已发布样式基线 | 基线 0.4.0（`75c3df7`）↔ 候选 v1.0.2，8 项检查零失败 | `npm run check:stylecontract`（`out/test/html-css-scope-probe/stylecontract-baseline.log`，EXIT=0） |
| 最低宿主 | VSCode 1.82.3 = **Electron 25.8.1 / Chromium 114.0.5735.289 / Node 18.15.0** | 宿主侧套件实打 `process.versions`（`.vscode-test/html-css-scope-probe.log` 首行）；宿主二进制复用主树 `.vscode-test/vscode-win32-x64-archive-1.82.3`（`VSIDIAN_TEST_VSCODE_PATH` 通道），探针经 `downloadAndUnzipVSCode({version:'1.82.3'})` 同源 |
| 本机浏览器 | Playwright 1.62.1 托管 **Chromium 151.0.7922.34** | `npx playwright --version`；`browser.version()` 实打（browser-probe.log 首行） |
| 页面基线 | 生产 `out/webview/main.css`（esbuild 产物）+ `media/css-contract-probe.css`（生产恒挂的稳定契约测试片段，充当代表性历史片段）+ 片段仿真 `<style>` | 双 harness 预挂，层叠/特异性对真实生产 CSS 取证 |

编译目标口径再确认：esbuild webview 产物 target 是 `chrome118`，**高于宿主 114**——本探针所有能力结论以两环境实跑为准，不从编译目标推断（探针 bundle 自身按 `chrome114` 编译，与 pdfProbe 同款纪律）。

## 二、总结论表

| 验证面 | 结论 | 一句话证据 |
| --- | --- | --- |
| **b2 逐块前缀改写**（`:where([data-doc]) :is(sel)`，光 DOM） | **通过（获选路线）** | 两环境全矩阵绿：命中/排除/特异性/源序/虚拟化/片段兼容全项绘制读值达标（host json `b2-prefix-perblock` 场景 meets 全 true） |
| b1 朴素包装前缀 | 证伪（淘汰） | 包装内 B 的 h1 被直染 purple、A 变量 `--a-mark` 继承进 B（`b1.b-native-h1=rgb(75,0,130)`、`b1.b-native-p=rgb(222,0,111)`），且特异性翻转（`.scope p`(0,1,1) 压过片段类(0,1,0)） |
| a1 Shadow DOM（内容整体进 shadow） | 证伪（作为全量路线淘汰） | 生产 CSS 断供（标题 font-size 基线 21.7px→28px）、外部片段断供（strong 下划线色 rgb(16,17,18)→丢失）、A 的 `div{--a-mark}` 命中 B 卡宿主后穿透进 B shadow |
| a2 Shadow 重装变体 | 通过带重大代价（不采为全量路线） | shadow 内重建 `#app/.vsidian-view-reading` 包装链 + adopted sheets 后生产样式恢复（21.7px），但每个内容根都要复制装配生产 CSS+片段链 |
| a3 Shadow Live-widget 变体 | 通过带边界（记录备查） | 共享 constructed sheet 双 widget 全命中、卸下/重挂稳定、源码层不变；但光 DOM Markdown（CM6 div/span）无法被 shadow 内样式按标签命中 |
| c CSS @scope | **红线击穿（最低宿主淘汰）** | Chromium 114 上规则被整表丢弃（`sheet.rule-kinds=(空)`、`CSSScopeRule 全局=false`）；151 上 CSSScopeRule 全绿（含 donut 上边界隔离与特异性保持）——可作未来迁移基线 |
| d 每文档 iframe | 通过带结构性不符（淘汰为主路线） | 隔离成立（帧内 teal/olive 正常），但生产 CSS（font-size 32px≠21.7px 基线）、主题变量（fallback）、片段三断供；Live 的 Markdown DOM 在帧外无法命中 |
| CSP 影响 | 通过（零新增变更） | 生产 `buildEditorCsp` 原样装配下全部候选可运行；**srcdoc iframe 不被 `frame-src https:` 拦截**（帧 URL=about:srcdoc，两环境一致）——T07 安全注意点 |

**四约束兼得判定**（票面：正文样式不影响工具栏/源码层/引用 B/C ＋ 原生匹配含义 ＋ 全文顺序 ＋ 虚拟化）：**b2 路线四约束同时满足**，探针就「隔离技术路线」而言**通过**；两个非阻塞决策点见第六节。

## 三、能力对照（行为检测，非特性嗅探）

能力检测用真 DOM＋真样式表行为读值（`CSS.supports('selector()')` 在 114 缺失会假阴性，已避开）：

| 能力 | 宿主 1.82.3（Chromium 114.0.5735.289） | 本机 Chromium 151.0.7922.34 |
| --- | --- | --- |
| `:is()` / `:where()` | 支持 | 支持 |
| `:not(复杂参数)`（如 `:not(.skip *)`） | 支持 | 支持 |
| `:has()` | 支持 | 支持 |
| `@layer`（CSSLayerBlockRule） | 支持 | 支持 |
| `@container`（CSSContainerRule） | 支持 | 支持 |
| CSS 嵌套（`& p{}`） | 解析支持 | 解析支持 |
| `@scope`（CSSScopeRule） | **不支持（规则被丢弃）** | 支持 |
| constructed `CSSStyleSheet` + `replaceSync` | 支持 | 支持 |
| `adoptedStyleSheets`（document / ShadowRoot） | 支持 | 支持 |

探针编写期两个被行为检测纠正的初版错误，留作后续实施警示：能力标记用自定义属性会因**继承**污染未命中元素（改用 background-color 后 151 的 `:not(complex)` 由假阴性转真）；`:is()` 参数**禁伪元素**，`::before` 必须拆到 `:is()` 之外否则整条规则被静默丢弃。

## 四、候选路线分节取证

排除面断言统一用「同基线」比较：基线 = 未挂文档样式时同一脚手架的绘制读值（同环境内相对差判定，跨环境绝对值差异不参与判定——宿主工具栏色 rgb(204,204,204) 来自真实 VSCode 主题变量，浏览器侧为黑，均为各自基线）。

### 4.1 b2：逐块标记 + `:where():is()` 改写（获选）

**机制**：每个「文档自有内容根」携带标记属性（探针用 `data-doc="a|b|c"`）；`<style>` 全文收集后经 CSSOM 逐选择器改写为 `:where([data-doc="a"]) :is(sel)`（`:where` 归零前缀特异性、`:is` 保留原选择器特异性）；产物作为单一 `<style>` 挂 `document.head` 末尾。标记纪律：**A 的 Markdown 块与原生 HTML 块挂 A 标记；嵌入卡壳/卡体（系统 chrome）不挂；B/C 的内容块挂各自标记**——B 卡是 A 内容流中的兄弟块而非后代，这是隔离成立的结构前提。

矩阵结果（两环境一致，值取宿主）：

1. **原生选择器命中**：`h1{}` purple、`.cls`、`table td` 黄底、`[attr]` 下划线、`::before`（伪元素拆分后）`"PE"`、相邻兄弟 `+`、子组合器 `>`、`:nth-child(2)`、`@media` 内规则（改写递归下钻）全命中。
2. **Markdown 同规则**：Reading 的真实 `p`/`h1` 元素被同一改写规则命中（h1 元素直染 purple 胜过生产包装上的继承主题色——与「按实际 DOM 匹配」一致）。
3. **排除面**：工具栏（含按钮）、`.cm-content` 源码行、B/C 段落（teal/olive 不被 blue 污染）、嵌入卡壳标题全部同基线；用户规则显式指向 `.cm-content`/`.vsidian-toolbar` 时因无标记祖先而不命中。
4. **继承与变量**：A 的 `div{--a-mark}` 只落 A 标记块内；B 的消费者取到 fallback（rgb(5,5,5)），A 自有消费者取到真值——自定义属性定义与消费都不穿透；A 设 broad 继承属性后工具栏/源码层同基线；主题变量链不被破坏。
5. **特异性/层叠/源序**：片段类规则(0,1,0) 仍胜过文档标签规则(0,0,1)（seagreen，原生语义保持）；两文档块按源序后者胜（red→blue）；同特异性(0,1,0) 时文档样式后置胜片段（indianred）——与片段 `<link>` 的先后关系即「head 内片段在前、文档样式末尾追加」。
6. **虚拟化**：卸下 A 原生 HTML 块后规则数稳定（19→19）、其余区域读值不变、重挂恢复 purple。
7. **历史兼容**：契约测试片段对 Reading strong 的 `text-decoration-color: rgb(16,17,18)` 在文档样式在场时保持同基线；生产标题规则 font-size 21.7px 不受影响。
8. **源码显形**（M8）：渲染块 DOM 卸下期间其他已渲染区与 B 均不受影响，重挂即恢复。

视觉取证：`docs/research/data/html-css-scope-probe-b2-evidence.png`（A 紫/蓝、B 青、C 橄榄、工具栏原色同屏）。

### 4.2 b1：朴素包装前缀（淘汰证据）

单个包装器类前缀（`.doc-scope-a sel`）包住含嵌入卡在内的整片内容：B 的 h1 被直染 purple、A 的 `--a-mark` 沿包装继承进 B——直染与继承双泄漏。另一处不可接受的语义损伤：`.scope p` 特异性 (0,1,1) 压过片段类 (0,1,0)，层叠结果与原生 CSS 相反（`a-p-tag` 实测翻转）。b1 的失败同时说明「仅追加容器前缀不构成隔离证据」这一规格警戒线的具体形态。

### 4.3 a1/a2/a3：Shadow DOM 家族

- **a1**（Reading 内容整体进 shadow，样式挂 shadow 内）：文档样式命中良好，但 (i) 生产 CSS 全部选择器自 `#app …` 起算，shadow 内无此外部上下文，标题 font-size 21.7px→28px、契约片段 strong 色丢失；(ii) A 的 `div{--a-mark}` 会命中 shadow 树内的 B 卡宿主元素（宿主属于外层 shadow 树），自定义属性沿宿主继承穿透进 B 的嵌套 shadow——shadow 不隔离「经宿主元素」的变量与继承；(iii) 主题变量自外部继承进 shadow 正常（宿主实测 rgb(204,204,204)，这是 shadow 路线唯一的结构性优点）；(iv) shadow 内 `@font-face` 不泄漏进 `document.fonts`（两环境一致，仅 KaTeX 族在场）。
- **a2**（重装变体）：在 shadow 内重建 `#app > .vsidian-view-reading` 包装链并把生产 CSS/片段以 constructed sheets 采纳进 shadow 后，生产样式恢复（21.7px）。代价：**每个**内容根（主文档、每个嵌入 B/C、每个悬停浮层实例）都要复制这套装配，snippetLoader 现管 `document.head` 需要第二套影子侧装配——与「CSS 片段的启停、排序、作用范围和历史契约不因本功能改写」冲突面大，不采为全量路线。
- **a3**（Live widget 级 shadow + 共享 constructed sheet）：双环境全绿（共享 sheet 多 widget 命中、卸下/重挂稳定、`.cm-line` 同基线）。**结论是记录备查而非采选**：它满足 Live 原生 HTML 块的隔离，但 Q4=B 要求同一规则也能命中 Reading 的 Markdown 真实 DOM——shadow 内样式做不到，若 Reading 用 b2、Live 用 a3 则同一文档两套装载语义，复杂度不换增益（b2 在 Live 同样可用：标记挂 widget 根即可）。

### 4.4 c：CSS @scope（最低宿主淘汰）

`@scope ([data-doc=a]) to (.vsidian-embed-card) { … }` 在 Chromium 114 上**整块规则被丢弃**（`replaceSync` 后 `cssRules` 为空、全局无 `CSSScopeRule`），所有命中值回到基线。151 上全绿：donut 上边界（`to (.vsidian-embed-card)`）原生实现嵌入隔离、特异性天然保持、B teal 不受 A 污染。**迁移注记**：当最低支持宿主的 Chromium ≥118（@scope stable），可评估从 b2 迁移到 @scope 以消除改写器——151 数据即迁移后的预期基线。

### 4.5 d：每文档 iframe（srcdoc）

隔离与自有样式装载成立（A 帧内 purple/blue、B 帧 teal、C 帧 olive，二重嵌套 srcdoc 可用），且**生产 CSP `frame-src https:` 不拦截 srcdoc**（帧 URL=about:srcdoc）。淘汰理由是结构性断供三件套：生产 CSS 不在帧内（font-size 32px）、主题变量不进帧（fallback rgb(64,64,64)）、外部片段不进帧（strong 色丢失）；Live 侧 Markdown DOM 在帧外、帧内样式无法命中，同 a3 的 Q4=B 冲突且交互/焦点/IME 成本更高。「每文档 iframe」不采为文档样式装载路线；iframe 作为**内容元素**的支持归 T07（届时必须显式 sandbox，srcdoc 不被 frame-src 拦截这一实测是安全设计输入）。

## 五、对后续票的实施指令

**T04（#569 全文 `<style>` 装载）——获选机制的落点**：

1. 收集器按全文源码顺序取所有 `<style>` 块文本，`new CSSStyleSheet().replaceSync()` 解析（114 已验可用）后逐规则改写：选择器列表按逗号拆项 → 每项 `:where([data-vsidian-doc-scope="<docId>"]) :is(项)`；**伪元素后缀拆到 `:is()` 之外**；`@media`/`@supports` 递归下钻改写内层；非这三类规则（如 `@font-face`/`@import`/`@keyframes`）原样保留并记录边界（见第七节）。
2. 产物以单一 `<style>` 挂 `document.head` 末尾（生产 CSP `style-src 'unsafe-inline'` 已放行，零 CSP 变更）；释放视图时移除（主文档挂 `VirtualReadingView.setDocument/clearDocument` 生命周期，引用挂 `RefContentInstance` 配对释放点——不挂块级钩子，虚拟化与显形不触碰它）。
3. 标记属性建议 `data-vsidian-doc-scope`（值=文档身份，B 用 `canonicalRefTargetKey`）：由系统在装配时写入，净化边界须把源文自带的 `data-vsidian-*` 全部剥离（防越权自标记）。同一 B 多实例共享同一改写产物（按目标键缓存）。悬停浮层展示 B 内容时同样标记——B 的样式跟随 B 的内容（ADR-0019 决定 3）。

**T02（#567 块级渲染）——隔离结构的落点**：

1. 原生 HTML 块的渲染根（Reading 块元素 / Live widget DOM 根）挂上述标记属性；**内容保持原生语义 DOM，不加生产类名**（如 `vsidian-reading-heading-1`）——生产规则只命中 Markdown 块包装，原生 h1 不被生产标题规则捕获（探针 a-native 与 a-md 的分离行为即此），符合 Q4=B。
2. Live widget 照 liveEmbed/liveCodeCard 模板在光 DOM 装配（无需 shadow）；源码层 `.cm-content` 及其内非 widget 行永远不落在任何标记之下。
3. 排除语义由标记位置保证：嵌入卡壳、工具栏、gutter、codeCard 头带等系统 chrome 一律不挂标记。

**T03（#568 行内 HTML）**：行内片段的渲染根同样挂标记；行内 HTML 在行内节点内部，改写选择器按后代命中即可，无需新机制。

**T05（#570 资源）**：CSS `url()`/`@import`/字体资源按样式所属 Markdown 解析（探针未测资源语法，见待验清单）。

**T07（#572 iframe）**：srcdoc 不受 `frame-src https:` 约束的实测必须进入 sandbox 设计——文档内 iframe 一律显式 sandbox，沿用 webPage.ts 只给 `allow-scripts` 的口径需单独评审（本探针不授权放宽）。

**T09（#574 收口）**：覆盖矩阵应包含本报告第三、四节的读值项；未来最低宿主升到 Chromium ≥118 时评估 @scope 迁移（4.4 注记）。

## 六、决策点（不阻塞 T02 开工，T04 设计时定夺）

1. **`:root`/`body`/`html` 规则失活的口径**：逐块改写下这三类选择器永远不命中（实测 `:root{--a-root-mark}` 与 `body{--a-body-mark}` 均未生效，消费者取 fallback）。维持失活最忠实于「不翻译选择器语义」，但独立 HTML 文件里 `:root` 是常见写法；若产品要 Obsidian 式「文档根」体验，需要把 `:root`/`body` 显式映射到标记块（构成受控翻译，须在规格层登记）。**探针建议维持失活并文档化**，映射留待用户反馈驱动。
2. **文档样式与 CSS 片段的先后**：实测「片段在前、文档样式后置」时同特异性文档胜（indianred 胜 seagreen）。反向插入（文档样式在片段链之前）则片段胜。规格未固定方向；建议维持「文档后置」（文档特定覆盖全局配置，符合就近直觉），T04 实施前在票面确认。

## 七、待验与未解决（如实清单）

- **CSS 嵌套规则（`&`）在改写器下的下钻未实现**：114/151 均解析嵌套，但探针改写器只取 `CSSStyleRule.selectorText + style.cssText`，嵌套子规则会静默丢失。T04 实施须递归改写或显式拒收嵌套 CSS（降级方向：拒收并在源码常显该块样式）。
- `@font-face`/`@keyframes`/`@import` 等 at-rule 在 b2 产物中按原样保留（全文档作用域）——资源面（字体装载、相对路径基准）归 T05 逐类核对；`@keyframes` 名字空间与文档隔离的相互作用未测（对光 DOM 路线 `@keyframes` 本就是文档级作用域，属既有 CSS 语义而非隔离缺陷）。
- `:hover` 等交互态伪类未测（需真实指针事件，T02/T03 的 browser 测试覆盖）；IME/物理鼠标路径不在本探针范围（归人工验证清单）。
- 宿主侧截图未采集（webview 无直接截图通道）；视觉证据以浏览器侧 b2 截图 + 双环境 getComputedStyle 读值覆盖。
- DOMPurify 本体未在探针中实跑（附录 B 为选型评估，接缝验证归 T02）。

## 附录 A：全量 HTML 标签分类目录与责任分派

口径：**全量是支持范围目标**（Q5=C），下表是分类管理目录而非白名单；「净化要点」指进入净化边界时的处理倾向，最终策略在 T02/T08 定型。同一标签可能跨票（主责在前）。

| 类别 | 元素 | 主责票 | 净化要点 | 资源/交互要点 |
| --- | --- | --- | --- | --- |
| 章节与文本 | `h1`–`h6`、`p`、`div`、`span`、`br`、`hr`、`blockquote`、`pre`、`address`、`main`/`article`/`section`/`aside`/`nav`/`header`/`footer`（无区域语义副作用，按通用容器渲染） | T02/T03 | 保留结构与全局属性；`contenteditable` 等编辑属性剥离 | Live 点击进源码（U04）；Reading 照常呈现 |
| 行内语义 | `strong`/`b`、`em`/`i`、`u`/`ins`/`del`/`s`、`mark`、`small`、`sub`/`sup`、`abbr`、`cite`/`q`、`dfn`/`kbd`/`samp`/`var`/`time`/`data`/`ruby` 族、`wbr`/`bdi`/`bdo` | T03 | 同上 | 混排不隐藏前后正文（U02/U06） |
| 列表 | `ul`/`ol`/`li`、`dl`/`dt`/`dd` | T02 | `start`/`reversed`/`type` 保留 | Live 键盘导航可进出（#217 inline 原则） |
| 表格 | `table`/`caption`/`thead`/`tbody`/`tfoot`/`tr`/`td`/`th`/`colgroup`/`col` | T02 | `rowspan`/`colspan`/`scope`/`headers` 保留（合并单元格是原始动机） | 不获得 Markdown 表格网格编辑命令（规格「明确不包含」）；td 内滚动坑（#258 reorderChildren 纪律） |
| 链接与图像 | `a`、`img`、`picture`/`source`、`figure`/`figcaption`、`map`/`area` | T05 | `href`/`src` 走危险协议摘除（既有 `isDangerousUrl` 口径）；`target`/`rel` 策略 T05 定 | 相对资源按所属文档（sourceDocUri 通道）；`srcset`/`sizes` 按 URL 列表语法展开，不当单字符串 |
| 编辑类 | `ins`/`del`（datetime 属性） | T03 | — | — |
| 媒体 | `audio`/`video`/`track`、`source` | T06 | `src` 协议面同上 | Reading 原生交互（播放控制为视图临时态，U13/U14）；格式不支持按真实状态呈现 |
| 表单与交互控件 | `form`、`input`（全 type）、`button`、`select`/`option`/`optgroup`、`textarea`、`label`/`fieldset`/`legend`/`datalist`/`output`/`progress`/`meter`、`dialog`、`details`/`summary` | T06 | `formaction`/`formtarget` 等提交类属性策略 T06 定；事件属性一律剥（既有） | 提交/导航不成为新写回入口；Live 内普通点击仍先进源码（规格）；`dialog`/`details` 的展开态为临时态 |
| 嵌入内容 | `iframe`、`embed`、`object`/`param`、`canvas`、`portal` | T07 | `iframe` 须显式 sandbox（srcdoc 不受 frame-src 拦截，本探针实测）；`object`/`embed` data 协议面 | 权限建模遵循 webPage 先例并经 T07 探针；跨域不可当子 DOM 监听（外层命中机制） |
| SVG | `<svg>` 及内部元素（`path`/`g`/`use`/`text`…）、内嵌 `foreignObject`/`style` | T08 | 命名空间感知净化；`use` 的外部引用、SVG 内 `script`/事件属性剥除 | SVG 内 style 与文档样式装载的交互归 T04/T08 联合核对；mermaid 管线现状口径勿破坏（seams-reading §2） |
| MathML | `<math>` 及内部元素 | T08 | 同 SVG（foreign content 分域） | 渲染兜底（不支持时按真实状态） |
| 脚本与模板 | `script`、`noscript`、`template`、`slot` | T02（处理口径） | `script` 永不执行（源码常显或剥除，T02 定形态）；`template` 内容不进渲染 DOM；`slot` 无 shadow 宿主时按未知元素 | 宿主桥不开放（规格红线） |
| 头部元数据 | `style`、`title`、`meta`、`link`、`base` | T04（style）/T02（其余） | 正文内 `style` 不进 DOM——文本进 T04 收集器；`meta`/`link`/`base` 按片段语义处理（无可视输出不占卡片，规格口径） | `link rel=stylesheet` 是否并入收集器为 T04 设计项（远程 https: 已放行） |
| 过时/废弃 | `center`/`font`/`marquee`/`big`/`strike`/`tt`/`frame`/`frameset` 等 | T09（矩阵登记） | 浏览器仍渲染的按实际 DOM 处理；`frame(set)` 不进 body 渲染 | 覆盖矩阵区分「已验证/平台限制」 |
| 自定义与未知 | 未知标签、自定义元素名（含连字符） | T09 | 按泛型元素处理（无内置行为） | 不调用 `customElements.define`（不执行自定义逻辑） |
| 全局属性 | `style`/`class`/`id`/`title`/`hidden`/`tabindex`/`dir`/`lang`/`data-*`/`aria-*`/`draggable` 等 | T02/T04 | `style` 保留元素级语义（U08）；源文 `data-vsidian-*` 剥离防冒充系统锚点；系统自生锚点防误删（净化 hook 回填） | `id` 参与锚点导航（U 与锚点规格联动） |

## 附录 B：净化库候选与接缝建议

**候选结论：DOMPurify 3.4.17（npm registry 2026-10-16 实查 latest）为首选接缝**；本节为选型评估，未实跑（T02 首个实施动作应是净化边界的契约测试＋最小接线验证）。

- **运行面兼容**：DOMPurify 3.x 面向 evergreen 浏览器、无 Node 依赖（UMD/ESM 双产物），其 DOM/ES 需求面远低于 Chromium 114——webview（Electron 25）可用性无公开障碍；webview iife bundle 随 `main.js` 打包即可，约 20KB 级增量，不新增 VSIX 分发文件。版本按仓库规范锁定精确版本。
- **接缝对位**（消费规格「专用内容净化边界」）：
  - **分域开关**：`USE_PROFILES: { html, svg, svgFilters, mathMl }` 天然对位附录 A 的类别分域，T08 的命名空间感知净化以其为基座而非自写。
  - **系统锚点互斥**：源文 `data-vsidian-*` 剥离（`ALLOW_DATA_ATTR` 收敛 + 前缀黑名单）与系统锚点防误删（`afterSanitizeAttributes` hook 回填 `data-vsidian-src-*` 等）是同一枚硬币的两面，契约测试各钉一条。
  - **`<style>` 的位置语义**：`style` 不随 DOM 净化放行进正文（防越权注入全局位置），由 T04 收集器独立抽取后装载；净化配置对 `style` 元素 FORBID，与收集器形成双通道。
  - **危险面沿用**：`on*` 事件属性、`javascript:`/`vbscript:`/`data:text/html` 协议摘除与现行 `sanitizeReadingDom` 口径一致——现行黑名单是防御纵深，保留为第二道闸，白名单净化为第一道（ADR-0019「不能将已有防御层直接视为完整净化策略」的落地形态）。
- **备选与否决理由**：sanitize-html（偏 Node 服务端、依赖 jsdom，webview 内不可用）；自写白名单（T08 命名空间风险高、维护成本大，与「解析与净化的共享规则只维护一份」冲突）。

## 关联

- 票：[#566](https://github.com/ONEGAYI/vsidian/issues/566)（本票）、[#565](https://github.com/ONEGAYI/vsidian/issues/565)（父票）、T02–T09 = #567–#574。
- 事实源：[html-rendering.md](../specs/html-rendering.md)「CSS 原意与作用域」「先做技术探针」；[ADR-0019](../adr/0019-document-html-and-style-scope.md)；[ADR-0005](../adr/0005-viewport-rendering.md)（虚拟化前提）；[css-snippets.md](../specs/css-snippets.md)（片段契约）。
- 生产接缝现状：`src/host/editorCsp.ts`（CSP 逐指令）、`src/webview/snippetLoader.ts`（片段链）、`src/webview/readingMarkdown.ts:487-501`（现行黑名单净化）、`src/shared/styleContract.ts`（公开样式契约）。
- 探针范式先例：[pdf-engine-compatibility-probe.md](pdf-engine-compatibility-probe.md)（真宿主实测型）、[addon-csp-dynamic-eval-probe.md](addon-csp-dynamic-eval-probe.md)（CSP 取证型）。
