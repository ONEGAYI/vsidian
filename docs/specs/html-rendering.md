# 原生 HTML 与文档内样式

## 状态与依据

2026-10-16 用户已确认产品范围与拆票粒度，规格总票 [#565](https://github.com/ONEGAYI/vsidian/issues/565) 及 9 张子票已发布，功能未实施、未验收。同日实施启动：集成分支 `spec/565-html-rendering` 按 T01–T09 任务图逐票推进，进度以子票状态为准。完整规格同时保存在本文件与总票正文。

架构与术语入口：[ADR-0019](../adr/0019-document-html-and-style-scope.md)、[CONTEXT.md](../../CONTEXT.md)。

实施进度（2026-10-16，T02/#567 首批落地）：块级 HTML 双模式渲染与 Live 源码编辑闭环已实施——两端区间对拍（Lezer HTMLBlock ↔ markdown-it html_block，`src/shared/htmlBlock.ts` 顶层扫描 + `readingBlocks` 顶层 token 消费，容器内两端一致降级源码）、净化边界（`src/webview/htmlSanitize.ts`，DOMPurify 白名单第一道闸 + sanitizeReadingDom 第二道闸；markdown-it 实测 html:false 不产 html_block token，已按票面换 html:true + html_inline/html_block 渲染规则转义维持行内与容器字面）、Live 片段替换（`src/webview/liveHtml.ts`，liveEmbed 模板）、纯 `<style>` 块 Live 常显/Reading 隐藏、渲染根 data-vsidian-doc-scope 标记（主文档 'doc'，嵌入实例随 T04）。行内混排（T03/#568）已实施：行内区间事实源（`src/shared/htmlInline.ts`——Lezer HTMLTag 实测节点名作候选起点 + 原始文本按 HTML 语法定片段范围（2026-10-17 评审修复：树配对会被片段内 Escape 吞标签误判未闭合）、单行成型、最外层语义，两端对拍钉住）、Reading 行内原位渲染（markdown-it `vsidian_inline_html` 规则整段消费 + 净化，无包装类，片段内不递归 Markdown；不成型维持 T02 转义字面）、Live 行内装饰（`src/webview/liveInlineHtml.ts`——行内 inline replace、selectionTouchesRange 显隐、点击选中完整源码、查找命中同列；「编辑当前 HTML 源码」覆盖块级与行内）、paint 探针 `paint.html.inline`。全文 `<style>` 装载已实施（T04/#569，b2 路线：`src/shared/docStyle.ts` 收集/改写核心 + `src/webview/docStyleLoader.ts` 产物生命周期；标记铺开到全部内容块根，嵌入实例按 canonicalRefTargetKey 派生键装载；两个决策点已定案——`:root`/`body`/`html` 改写后**维持失活**并文档化、文档样式**后置**于 CSS 片段链；@media/@supports/@layer/@container 递归改写、@keyframes/@font-face/@import/@property 原样保留（文档级语义）、CSS 嵌套 & 递归代换）。资源文档归属（T05/#570）已实施：URL 属性语法矩阵（`src/shared/htmlResource.ts`——srcset 按规范算法〔URL 取连续非空白串、末位逗号截断、描述符 w/x 形态校验、不合法候选跳过〕、CSS url()/@import 词法扫描改写〔跳过注释与字符串字面量、引号/裸形态、@import 字符串形态〕、可解析判定〔真 scheme 直连/自足，单字母与含点 scheme 是文件名形态走宿主〕）、四条装配路径共用 `src/webview/htmlResourceMount.ts`（Reading 块挂载钩 A 身份 / RefContentMount B/C 身份 / Live 块级与行内 widget 按视图管理器身份 + `liveHtmlResourceSource` facet 携带嵌入 fsPath；img 绑定所属视图管理器〔Live 形态开 sweep 兜底〕、srcset 剥离重解析重组〔失败候选保持原文〕、媒体 source/src/poster 归属改写〔装载语义归 T06〕、a[href] 不改写——导航归点击委托）、独立消息种 `htmlResource.request/result`（reqId 路由空间与 image.result 隔离，杜绝跨管理器误配对；宿主 documentSession 复用 resolveImage 端口与 sourceDocUri 守卫）、文档样式产物资源管线（docStyleLoader 注册表按 docScope 共享解析映射、失败登记不重试、image.invalidate/手动刷新同口径失效重取、释放退订迟到丢弃）、Live widget 链接点击 preventDefault（不意外跳转）、paint 探针 `paint.html.resources`。表单 details 与音视频（T06/#571）已实施：净化矩阵钉住表单/媒体族默认放行与 formaction/autofocus 剥离、媒体装载语义收紧为「相对目标先剥离-回写-失败恢复原文」、CSP 增 `media-src ${cspSource} https:`（逐项理由见落档节）、Reading 原生交互承载 + 表单提交 document 守卫（`src/webview/htmlInteract.ts`——submit 不导航 + 媒体释放/暂停）、Live 控件与媒体命中区点击无例外源码显形、块卸载/widget 退场/模式切换的媒体停播链、video 三面列宽钳制（样式契约 `html-native-media` 条目）、paint 探针 `paint.html.interact`（details 展开态与媒体 readyState/currentTime 真实状态）。iframe 子文档装载隔离（T07/#572）已实施：净化白名单放行 iframe 并**系统强制 sandbox**（https 远端帧仅 allow-scripts〔#343 webPage 同口径〕，srcdoc/本地/明文 http/无 src 一律零 token——笔记可控内容结构性禁脚本；allow/allowfullscreen/allowpaymentrequest 权限面零授予）、srcdoc 内容**递归净化**（属性值不过标签层 + DOMPurify SAFE_FOR_XML 会整体移除含闭合标签的属性值——beforeSanitizeAttributes 捕获原文、afterSanitizeAttributes 净化回写；嵌套 iframe FORBID 封死递归装载攻击面）、第二道闸按系统标记豁免白名单产物（未标记 iframe 照删——防御纵深不变）、本地页 src 归属改写（`htmlResourceMount` 增 `iframe[src]` 条目；srcdoc 在场跳过）、CSP `frame-src` 增 `${cspSource}`（本地页帧装载许可——逐项理由见落档节）、Live **外层命中机制**（shield 透明覆盖层盖帧——沙箱/跨域子文档事件不冒泡到父文档，单击帧可视区经既有 mousedown 拦截器选中该片段完整源码；Reading 不接管〔U13 原生交互〕）、paint 探针 `paint.html.iframes`。SVG/MathML 与混合命名空间（T08/#573）已实施：净化配置面扩展（`htmlSanitize.ts`——DOMPurify 3.4.16 实测默认白名单不含 foreignObject/use/SMIL 动画元素，ADD_TAGS 放行；foreignObject 内 HTML 命名空间节点被 `_checkValidNamespace` 判非法移除，`HTML_INTEGRATION_POINTS` 补 `foreignobject`（配置键必须小写 + 对象形态——数组形态静默回落默认，两坑实测钉住）；SMIL 动画 attributeName 指向 href 族/on* 的劫持向量由 hook 整体移除（与 DOMPurify 内置属性级防线双保险））、ID 文档作用域（`src/shared/htmlFragment.ts` 纯逻辑 + `htmlResourceMount` 装配咽喉接线——B/C 渲染产物的 id 与片段引用（`url(#id)`/`href="#id"`）统一加 `vs<scope>--` 前缀、主文档零改写、未命中目标也限定 B 域不外溢成 A 锚点；CSS 侧协同——B 的本篇 style 装载时 `#id` 选择器与 `url(#id)` 声明按同前缀代换（docStyle 改写器），选择器含义保持）、SVG 资源条目（image/use 的 href 与旧 xlink:href 两形态沿 T05 媒体同款管线订阅改写、xlink 命名空间保形 setAttributeNS、# 片段归 ID 管线真 scheme 保持原文）、paint 探针 `paint.html.svgMath`（全域圈定三形态：svgs/maths 计数 + rect 面积绘制证据 + foreignObject/渐变引用/前缀 id/前缀引用/前缀描边绘制计数）。2026-10-17 评审修复（PR 审查六项 P2 + Standards 建议）：SVG paint 属性颜色/片段引用按语法区分（href 整值 vs CSS 值 url() 产）；docStyleLoader 资源订阅模型重构（先登记再 subscribe——hub 缓存命中同步回调不丢、完成后订阅持续保留至 release 全退、失效经既有 listener 重取不重复 subscribe）；style 属性相对 URL 接入 T05 资源管线（CSS 词法扫描、成功重装引号形态、失败保持原文、失效/释放同机制）；块级与行内增量重建加顶层结构签名守卫（围栏开闭等块级重分类使变更区外的旧条目/缺口失效——签名不稳定退全量重扫，树是权威）；行内 HTML 片段内的反斜杠 escape 不再吞闭标签（见上）；svgMath 绘制探针增可见性负向控制（隐藏对照在场且不产生绘制证据——探针非恒真的钉子）。2026-10-17 二轮复审修复（三项 P2）：行内片段改交错扫描事实源（上述）+ 增量重建增**行级失效**（段内上下文变化〔InlineCode 开闭吞标签、新外层标签吸收内层〕不改变顶层结构签名但使同一行片段表失效）；style 属性资源失效后失败丢弃旧代映射回退装配原值（失效语义与 `<style>` 产物一致）。2026-10-17 三轮复审修复（三项 Spec P2 + Standards）：行内扫描升级为**行内容器整段扫描**——code span 与非元素原始 HTML token（注释 `<!--…-->`〔含 `<!-->`/`<!--->` 空形态〕、PI `<?…?>`、声明 `<!NAME …>`、CDATA，markdown-it html_inline 各 token 正则镜像）都可跨行，状态在完整行内容器（探针实测 Paragraph/SetextHeading1/SetextHeading2；ATX 标题与表格单元格单行，孤岛扫描等价）内维持、容器边界重置，片段发射仍按单行成型裁剪（P2-1：跨行 code span 内的标签此前被逐行重启的扫描误判为片段）；块级排除从行首点查改为**行末字符 + 片段端点**双定位（P2-2：缩进代码的 CodeBlock 节点从缩进之后才开始，行首祖先链查不到——`    a <span>` 误产片段）；行内结构字面区（探针实测 LinkTitle/LinkReference 节点名——链接 title 是字面串不内解析、引用定义整行被块级消费）按片段端点祖先链排除（P2-3：链接标题/引用定义 title/行内注释内的 span 此前被 Live 误装饰而 Reading 字面）。增量窗口相应升级为**容器级**：变更行扩窗到所属容器区间、剪枝口径补变更区间**旧文本**含 '<'/反引号判定（删除唯一相关字符的键击不再漏扩窗）。二轮引入的「表引用短路」声称修正：短路只覆盖片段表引用比较（下游 spansChanged 判定）与装饰集重建后 `RangeSet.eq` 逐项相等返回旧引用（**等价装饰集保持引用**——view 层内部仍走 CM6 的 RangeSet 比较，同集零 DOM 变更），**RangeSet.of 与触及判定重算仍在每事务执行**（选区随键击移动）——三轮补齐装饰层 eq 短路并修正两处注释/规格的过度声称。Standards：性能探针 longtask 观测修复标准构造签名（旧实现把 'longtask' 传作 PerformanceObserver 构造首参——构造抛 TypeError 被吞、longTasks 恒 null 被报告误记为「全档 0 条」；现回调为首参 + observe({entryTypes})，构造签名由契约测试钉住，HTML 档重测后的真实长任务数据落档于性能报告）。2026-10-17 四轮复审修复（四项 P2）：①行内增量扩窗补**双向**——闭串编辑对容器前文有反向影响（闭串存在与否决定其前开串是否构成 code span，「状态只向后传播」不成立），扩窗延伸到变更行所属容器两端（code span 不跨块，容器即状态作用域）；②PI 闭串 `?>` 按真实两字符长度终止（曾按注释闭串误写 +3，多吞一位紧邻标签起点）；③非正文区（探针实测 LinkTitle/URL/Autolink 节名——链接 title/目的地/autolink 内的反引号是字面）改为**扫描期跳过**而非发射后过滤（事后过滤删不掉已污染的配对状态、恢复不了扫描阶段漏掉的正文；树只对真正解析成功的链接产节点，反引号先于链接开串时两端同样先配对——位置序语义与 markdown-it 一致）；④顶层结构签名守卫补**编辑点祖先链名序列对照**（iterChangedRanges 新旧两端各取祖先链——嵌套引用/列表内的 FencedCode 重分类不改变顶层 Blockquote 的名与映射边界，但必然改变编辑点所处结构路径；块级与行内增量路径共用该守卫）。已知边界：htmlLong 极端档（14674 行密集 HTML）键击输入延迟档差（首轮归档 39.3ms、二轮交替实验 ~49ms、三轮 42.2ms）为**未闭环的性能回归信号**——均值差推不出每键多一帧（「+1 帧」旧表述作废）、不归因 GC、不宣布验收完毕；既有探针口径的局限（dispatch+双 rAF、每档 10 样本、非物理键击全程）已记录，闭环需按「同宿主、同输入位置/视口/预热，旧新各 ≥3 交替轮 ×50 键、同步 dispatch/首末 rAF 样本与 p50/p95/慢帧比例、短 trace 区分脚本/样式/paint/GC」的方法学重测。既有基线为[源文本双视图](../adr/0003-source-text-dual-view-editor.md)、[视口渲染](../adr/0005-viewport-rendering.md)、[HTML 注释](html-comment-support.md)、[CSS 片段](css-snippets.md)。

用户确认记录：块级与行内 HTML 一起做；支持 `style`、`class` 与 `<style>`；文档内规则作用于本篇渲染正文；Q4 选 B，按实际 DOM 匹配、尊重 CSS 原意；Q5 选 C，全量 HTML；Q6 选 A，纯样式块在 Live 源码常显。

## 问题与目标

当前原生 HTML 主要作为字面文本显示，不能直接呈现带合并单元格的表格等 HTML 内容。用户需要在两种模式阅读原生 HTML，同时保持 Live 对原始源码的直接编辑能力。

交付目标包含 HTML 片段渲染、源码显形、文档内样式及全量元素的资源与原生交互处理。全量是支持范围目标；具体浏览器和远端资源的可用性必须有证据，不能把未经验证或平台拒绝的内容写成已支持。

## 用户故事

下列编号依次对应 U01–U15，供实施票追踪覆盖。

1. 作为 Markdown 作者，我希望两种模式都能呈现原生 HTML 区块，以便使用合并单元格和其他 Markdown 无法表达的结构。
2. 作为 Markdown 作者，我希望正文中的行内 HTML 保持原来的位置与排版，以便局部调整文字而不拆开整段正文。
3. 作为 Live 用户，我希望悬停时看到区块边框和编辑入口，以便辨认渲染区域的编辑范围。
4. 作为 Live 用户，我希望点击渲染内容或编辑按钮后选中完整源码，以便直接替换或修改该片段。
5. 作为键盘用户，我希望移入 HTML 源码范围时保留落点，以便逐字符编辑而不被自动全选打断。
6. 作为选择文字的用户，我希望选区经过 HTML 时显形源码并保留原选区，以便连续选择、复制或删除跨块内容。
7. 作为文档作者，我希望源码显形和恢复渲染不改变文本或撤销记录，以便原有保存与历史行为保持可预测。
8. 作为文档作者，我希望 `style`、`class` 和 `<style>` 都可使用，以便组织局部与本篇正文的样式。
9. 作为长文档用户，我希望样式不因样式块离屏或显形而失效，以便滚动与编辑时外观稳定。
10. 作为文档作者，我希望 CSS 保持原生选择器含义，以便理解并复用样式；两种 Markdown DOM 的差异可明确查阅。
11. 作为打开引用内容的用户，我希望本篇样式不会改变其他文档或编辑器工具，以便不同内容的外观不会相互污染。
12. 作为文档作者，我希望链接、图片、音视频等资源按所属文档解析，以便嵌入或移动查看位置时不引用错误的资源。
13. 作为阅读用户，我希望表单、details、媒体、iframe、SVG 和 MathML 均纳入支持，以便阅读完整 HTML 内容。
14. 作为阅读用户，我希望资源或网页被平台拒绝时得到真实状态，以便区分不可用内容与正在装载的内容。
15. 作为组件与 CSS 片段用户，我希望新增 HTML 支持仍保留现有公开入口，以便已安装的样式和组件继续工作。

## 功能契约

### HTML 范围与源文

- 支持目标为全量 HTML 元素及其文档片段语义，不以首批常用标签白名单替代该目标。iframe、音视频、表单、SVG／MathML 均在本批拆票范围内。
- 全量不等于新建完整网页应用运行环境。笔记本体的 `<script>` 和事件属性不获得执行能力；宿主桥、组件注册和内部命令不向笔记 HTML 开放。iframe 子文档权限须独立建模，遵循现有页面嵌入隔离口径并经过探针。
- 源文唯一，不将 HTML 转成 Markdown，不序列化浏览器修复后的 DOM 回写文件。仅显示或点击显形不能改动 dirty、文档版本和宿主撤销栈。
- 代码围栏、缩进代码及行内代码里的 HTML 保持字面内容。HTML 注释沿用 Live 淡化、Reading 隐藏的既有规则，不随新渲染器重新定义。
- HTML 与 Markdown 的边界采用两端核对过的解析规则；不为 HTML 元素内部递归开启另一套 Markdown 渲染。配对、空行、嵌套、未闭合和解析器修复样例须纳入矩阵，不能用正则猜测嵌套范围。
- 无法成型或无法安全呈现的片段保持可访问的原始源码，不让浏览器修复吞入相邻 Markdown 或工具界面。明确不可见的元素按其片段语义处理，不凭空给每个无可视输出元素新增卡片。

### Live 的状态与选区

| 触发 | 显示与选区 |
|---|---|
| 光标及全部选区在片段外 | 渲染 HTML |
| 悬停块级渲染区 | 显示边框和右上角编辑按钮 |
| 普通点击渲染内容或编辑按钮 | 源码显形，选中该片段完整源码 |
| 键盘光标进入范围 | 源码显形，保持原落点 |
| 非空选区与范围相交 | 源码显形，原选区方向、端点和其他选区不变 |
| 光标与全部选区完全离开 | 恢复渲染 |
| 纯 `<style>` 块 | 源码常显、直接编辑，不增加占位 |

相交判定复用既有 `selectionTouchesRange` 语义：折叠光标包含边界，非空选区按区间相交；不要求完整包含。点击显形对命中片段执行，不扩到整篇或无关片段；混排行内 HTML 不隐藏前后正文。多选区按既有编辑器规则处理，不能为了单片段显形把其他范围一起坍缩。

HTML 内部的普通点击仍优先进入源码，包含其链接、控件与媒体命中区；Reading 承载受支持的原生交互。iframe 跨域不能冒充可直接监听的普通子 DOM，需用经验证的外层命中机制兑现同一规则。不得悄悄增加“某些元素普通点击不显形”的例外。

现有查找定位、锚点导航、标题折叠展开与选区恢复必须能抵达 HTML 源码范围；接入既有目标定位和显形机制，不以 DOM 内独立编辑器替代宿主文本编辑。输入法组合期不得因装饰更新丢失未提交输入。

### CSS 原意与作用域

- `style` 属性保留元素级样式语义；`class` 可消费现有 CSS 片段与本篇 `<style>`。CSS 片段的启停、排序、作用范围和历史契约不因本功能改写。
- `<style>` 按全文源码顺序收集，按源文更新；渲染区离屏、DOM 卸载、片段源码显形都不移除规则。释放视图时回收该视图规则及相关资源，避免残留。
- 规则可匹配本篇原生 HTML 与 Markdown 的渲染 DOM；不匹配工具栏、源码编辑层或嵌入的其他文档。父 A、引用 B、递归引用 C 分别遵守自己的文档范围，同一 B 的多个实例不能污染彼此的容器或其他文档。
- CSS 按两种模式各自真实 DOM 匹配。不得将 `h1`、`p`、`table` 等选择器翻译成 CM6 内部类；不为等效匹配大改 Live DOM。例如 `h1 { color:red }` 能匹配 Reading 的原生标题，而 Live Markdown 标题是否命中取决于其真实 DOM；相同原生 `<h1>` 片段应使用同一内容规则。
- 隔离机制不得借机改变选择器本来的含义。先验证层叠顺序、特异性、继承、自定义属性及嵌套引用，再确定装载方案。仅追加容器前缀、仅屏蔽某几个类名不自动构成隔离证据。
- CSS 的 `@media`、`@supports`、动画、字体、`url()`、依赖导入等纳入逐类核对。远程引用遵循已有 HTTPS、CSP 和浏览器限制；文档相对路径以样式所属 Markdown 为基准，不误用主文档或全局 CSS 片段目录。不能以正则替换 CSS 文本代替语法处理。
- 样式失配与装载失败分开：选择器没有匹配实际 DOM 是正常 CSS 结果，不提示错误，也不自动改写；资源请求确实失败时按真实原因呈现。

#### 文档样式实施落档（T04/#569）

- **决策点 1（`:root`/`body`/`html`）定案：维持改写后失活**。逐块标记改写下这三类选择器永不命中（标记块不是根/文档元素的祖先）——最忠实于「不翻译选择器语义」；Obsidian 式「文档根」映射（把 `:root` 受控翻译到标记块）留待用户反馈驱动，须在规格层另行登记后才可实施。
- **决策点 2（与 CSS 片段先后序）定案：文档样式后置**。产物挂 head 末尾（片段链之后）——同特异性时文档胜（就近直觉：文档特定覆盖全局配置）；实测与探针一致。片段的启停、排序与历史契约不因本功能改写。
- **模式差异（U10 口径）**：同一规则在 Reading 直中 Markdown 语义标签（`h1{}` 命中真实 `h1` 元素）；Live 的 Markdown 是 CM6 的 `div/span` 行结构，标签选择器**不命中** Markdown 部分（`h1{}` 不命中标题行）——这是按实际 DOM 匹配（Q4=B）的既定差异，不是缺陷；原生 HTML 片段两模式同一规则命中（widget 渲染根挂标记）。类/属性选择器命中任何携带该类/属性的实际 DOM。
- **at-rule 矩阵去向**：`@media`/`@supports`/`@layer`/`@container` 递归改写内层（组块头原样保留）；`@keyframes`/`@font-face`/`@property`/`@import` 原样保留（文档级名字空间——嵌套场景同名冲突属既有 CSS 语义；`@import` 位置规则按 CSS 原生行为，多块拼接产物中非首位的 `@import` 失效）；CSS 嵌套 `&` 递归代换（含多层与组块内嵌套）；未知 at-rule 保守保留。`url()`/`@import` 的**来源文档解析基准**与字体资源装载归 T05。
- **收集口径**：全文源码顺序收集（块级与行内出现的 style 标签源文；含容器内降级块的样式——降级是呈现边界，与「纯 style 块 Live 常显且生效」同语义）；代码（围栏/缩进/行内）、HTML 注释、frontmatter 内的字面 `<style>` 不收集。配对词法为 HTML raw text 语义（首个 `</style` 闭合，与浏览器一致）。

#### 资源文档归属实施落档（T05/#570）

- **语法事实源**在 `src/shared/htmlResource.ts`（纯逻辑两端共用）：srcset 按 HTML 规范算法（URL 是连续非空白串——**可含中位逗号**，仅末位逗号截断；描述符须匹配 `整数w`/`浮点x`，不合法候选整体跳过——浏览器同判）；CSS url()/@import 走词法扫描（跳过注释与字符串字面量，`content: "url(x)"` 不算；url() 产支持裸/单双引号与内部空白容错；@import 的字符串形态同产 token）；「需按文档基准解析」判定——真 scheme（http/https/data 直连或自足，file/javascript 等保持原文按原生语义失败，资源层不越权）为否，单字母与含点 "scheme"（`a:b.md`）是文件名形态走宿主（linkTarget 同口径）。
- **装配咽喉**（净化产物 → DOM 的后置管线，四条路径共用 `htmlResourceMount.ts` 一份）：Reading 块挂载钩（A 面板管理器身份）、嵌入 RefContentMount（B/C 的 `sourceDocUri` 身份）、Live 块级/行内 widget（`liveImagesOfView` 按视图身份 + `liveHtmlResourceSource` facet 携带嵌入 fsPath）。**img 绑定所属视图的 ImageResourceManager**（src 剥离等宿主解析的既有 #10 语义；srcset 在场时管理器绑定首个候选——浏览器从 srcset 选用时 src 仅回退；Live 形态槽位开 sweep 兜底）；**srcset 先剥离**（防解析完成前浏览器选用 webview origin 下的坏相对候选）原文记忆于 `data-vsidian-srcset`，逐候选解析后按描述符重组回写（失败候选保持原 URL——不编造地址）；**媒体 source/src 与 poster** 保留原属性、成功解析后改写为绝对地址（媒体装载/交互语义归 T06）；**a[href] 一律不改写**——导航归 Reading 点击委托与宿主 linkTarget 分类（单一权威），Live widget 内容的 `<a>` 点击统一 preventDefault（普通点击仍优先源码显形，任何情形不意外跳转）。
- **请求通道为独立消息种** `htmlResource.request`/`htmlResource.result`：webview 侧 reqId 路由空间按消息种隔离——既有 `image.result` 由多个 ImageResourceManager 按「pending + reqId 首个命中」认领，并入同空间会引入跨实例误配对（本票不扩大既有隐患面）。宿主侧完全复用 resolveImage 端口（classifyImageTarget 白名单 + asWebviewUri，路径规则不建第二份）与 sourceDocUri 来源守卫（hover/嵌入目标比对，不信任前端任意 URI）；成功登记失效反查（文件变化 → image.invalidate 广播 → webview hub 重取新代次 URI）。**不扩 localResourceRoots、不动 CSP、不开脚本/宿主桥**。
- **文档样式资源管线**（docStyleLoader 注册表）：产物改写消费按 docScope 共享的解析映射（同一 B 多实例共享）；失败登记不重试（风暴防护），image.invalidate 与手动刷新同口径清映射重取（删除语义下旧地址立即失效回退原文）；release 退订在途——迟到结果按无条目丢弃。**jsdom 边界**：其 CSSOM 丢 @font-face 的 src 描述符（Chromium 保留）——font-face url 改写语法在 shared 层直测，全链字体绘制断言在 browser/真宿主层。
- **移交 T06-T08 的底座**：媒体 `src`/`srcset`/`poster` 的解析改写就位（T06 接装载与交互——注意 CSP 无 media-src 指令、default-src 'none' 拦截媒体装载，接线时需逐项理由）；iframe/SVG 资源属性按同一矩阵扩展（T07/T08——`htmlResourceMount` 的属性矩阵与 `needsDocumentBaseResolution` 判定是唯一定义点）。

#### 表单 details 与音视频实施落档（T06/#571）

- **净化白名单现状（不新增配置）**：DOMPurify 默认白名单已放行全表单族（form/label/input/select/optgroup/option/textarea/button/fieldset/legend/datalist/output/progress/meter）与媒体族（audio/video/source/track，含 controls/autoplay/loop/muted/preload/poster/playsinline/width/height 与 track 的 kind/srclang/label/default）——单元矩阵钉住防后续配置收紧时静默丢族。**默认剥离并钉住**的属性：`formaction`（button/input 的导航覆写——无表单后端时不留可导航面）、`autofocus`（防挂载抢焦点）；`on*`/script/`javascript:` 媒体地址恒拒（负向矩阵）。
- **媒体装载语义（T05「保留原属性」收紧为剥离-回写）**：相对 `src`/`poster`/`source[src]` 解析前剥离（原文记忆 `data-vsidian-media-src/-poster`），成功回写绝对地址、失败恢复原文（T05 失败语义不变——最终 DOM 与源文一致）。理由：CSP 放行媒体装载后，保留原文会先向 webview origin 发坏相对请求再被改写覆盖（img/srcset 同纪律）。
- **CSP `media-src ${cspSource} https:` 逐项理由**：cspSource = 本地媒体经 T05 归属解析的 asWebviewUri 产物（既有授权路径，不新增根）；https: = 远端直连媒体保持原文由浏览器装载（与 img/style/font 的远端面同口径）；不放行 http:（混合内容红线）/data:/blob:（无已知需求不预防性放行）。track 字幕同受 media-src 管辖。真宿主实证：本地 WAV 经归属解析装载 readyState≥2（无 media-src 时 default-src 'none' 全拦截——集成用例即 CSP 生效证据）。
- **Reading 语义**：表单输入/选择/勾选、details 展开为浏览器原生交互（容器点击委托只拦任务 checkbox 与 `<a>`，不吞控件）；**表单提交一律 preventDefault**（document 捕获相位单一守卫 `installHtmlSubmitGuard`，装配在生产控制器 mount——Reading 块/嵌入卡/悬停浮层/Live widget 内容同一防线；webview 是编辑器本体，提交即整页导航且无后端）。临时状态（输入值/勾选/展开/播放进度）不写回 Markdown、不产生编辑事务与撤销历史（browser 断言 edit.* 计数零变化）。
- **Live 语义**：普通点击命中控件（select/checkbox/summary/媒体命中区）一律源码显形并全选该片段完整源码——**无控件类型例外**（既有 mousedown 拦截器天然覆盖，browser 逐类断言 + select 不获焦点）；表单提交在 Live widget 内容同样被 document 守卫拦截。
- **生命周期**：块卸载/视图释放（binding.dispose）与 Live widget 退场（WidgetType.destroy + sweep 兜底）→ 媒体 **pause + src 剥除（含 source 子元素）+ load() 复位**（DOM 移除不自动暂停——Chromium 语义；图片槽位 src 清空同纪律）；模式切换（reading↔live 双向）→ 隐藏容器/widget 媒体**只暂停不释放**（块仍挂载，回切不重置装载）。迟到解析结果由 T05 disposed 守卫丢弃。
- **媒体能力矩阵（如实记录，未验证不声称）**：本地文件经归属解析（WAV 实测 Chromium 解码推进 currentTime）；远端 https 直连按浏览器原生管线（未在本票实证，沿用 img 的 https 面语义）；**muted autoplay**：Electron webview（VSCode 1.82.3 真宿主）允许——集成实测 mediaPlaying=1；无手势 unmuted autoplay 未测（Playwright Chromium 默认策略与 Electron 不同，人工清单列真机核对项）；编码支持 = 运行时 Chromium 原生解码面（不转码、不承诺格式，错误码如实呈现 mediaError）。
- **样式**：video 三面（Live 块级/行内宿主 + Reading 内容块）`max-width:100%` 列宽钳制（样式契约 `html-native-media` 条目；audio 控件条无溢出不加规则）。i18n/键位零新增（无新用户文案与可绑定操作）。

| 元素/属性 | Reading 行为 | Live 显形行为 | 生命周期 |
|---|---|---|---|
| details/summary（open 属性放行） | 原生展开/收起（临时态不写回） | 点击命中区（含 summary）= 完整源码选区 | 随块卸载回收 |
| form + input/select/textarea/button | 原生输入/选择/勾选；提交 preventDefault（无导航） | 同上无例外；控件不获焦点 | 随块卸载回收（值不持久） |
| formaction/autofocus | 净化层剥离（不可用） | 同左 | — |
| audio/video（controls/autoplay 等） | 原生播放/暂停；muted autoplay 宿主实测可播 | 渲染呈现 + 点击命中区显形；widget 退场即释放 | 卸载/释放断流；模式切换暂停 |
| source/track | 随宿主媒体装载（media-src 管辖） | 同左 | 随宿主媒体释放 |

#### iframe 子文档装载隔离实施落档（T07/#572）

- **sandbox 矩阵（净化层系统强制，作者值恒被覆盖）**：`src=https://` 远端帧 = 仅 `allow-scripts` + `referrerpolicy=no-referrer`（#343 webPage 先例——站点渲染所需最小能力；无 allow-same-origin → 不透明源零 cookie/存储、不可达父窗口与 acquireVsCodeApi，无 allow-top-navigation/forms/popups/modals/downloads）；**其余全部形态（srcdoc / 相对路径→本地解析 / 明文 http / 无 src）= 零 token**——笔记本体与 vault 文件同属笔记可控内容，结构性禁脚本（明文 http 帧在生产另被 CSP frame-src 拦截装载）。**src 与 srcdoc 组合形态：srcdoc 在场优先 = 零 token**——浏览器按 HTML 规范以 srcdoc 渲染、忽略 src，帧实际内容是笔记可控的 srcdoc（递归净化产物）；sandbox 分派依据不得取 src，否则组合形态借 https src 为笔记内容换来 allow-scripts。`allow`/`allowfullscreen`/`allowpaymentrequest` 一律剥除（子文档零本地权限）。**与笔记本体脚本禁执行的区别建模**：笔记可控内容（正文 HTML、srcdoc、vault 文件）零脚本；仅第三方远端 https 站点在沙箱内运行其自有脚本（非笔记本体，与悬停 webPage 同信任口径）。
- **srcdoc 许可面结论**：T01 探针实证 srcdoc 不被 `frame-src https:` 约束（帧 URL=about:srcdoc）——本票维持该实测为安全设计输入，srcdoc 的许可以 sandbox 零 token + 净化层递归净化兜底（生产 CSP 的继承拦截〔about:srcdoc 继承父 CSP、script-src nonce 门控〕是额外一层，设计不以 CSP 为前提）。**实现要点**：srcdoc 属性值不过 DOMPurify 标签层（按字符串处理），且 SAFE_FOR_XML 防护（默认开）会把含 `</style>`/`</script>` 等闭合标签的属性值**整体移除**（mXSS 防护，探针二分定位）——`beforeSanitizeAttributes` 先捕获原文、`afterSanitizeAttributes` 递归净化后回写；嵌套 iframe FORBID（`srcdoc<iframe srcdoc=…>` 递归装载攻击面封死，嵌套帧无既有需求）；帧内 `<style>` 保留（帧文档作用域，不出帧；顶层 head 类元素经容器包裹走片段解析防丢——全文档解析会把顶层 style 移入 head 随 body 序列化丢出产物）。srcdoc 帧内**脚本永不执行**（sandbox 结构性禁止，browser 层以「ran 类未加」负向钉住）。
- **CSP 变更（唯一变更：`frame-src` 由 `https:` 改 `${cspSource} https:`）**：本地可控页面（工作区 .html）经 T05 资源归属解析产出的 asWebviewUri 地址在 cspSource 资源域——与 img-src/font-src 消费**同一信任面**（vault 文件，localResourceRoots 已界定），不加此源则本地页帧被 CSP 拦截（处理矩阵「本地可控页面」不可达）。安全面不扩大：帧 sandbox 由净化层强制为零 token（帧内脚本面不因本源表达式扩大）；明文 `http:` 仍不放行；`default-src 'none'`/script-src/connect-src 零变化。词法钉住在 `test/unit/editorCsp.test.ts`（收紧即红）。
- **处理矩阵（五类，证据分层）**：① 本地可控页面——相对 src 经 `htmlResourceMount` 的 `iframe[src]` 条目按来源文档解析改写（srcdoc 在场跳过：内容非资源引用且浏览器按规范忽略 src）；browser 层 CDP 帧读取证内容可见，真宿主证 src 已改写为资源域地址且改写后导航无拒绝日志。**已知边界**：改写落地前浏览器的首跳（相对地址按 webview origin 解析）必然被拒（ERR_ACCESS_DENIED）——与 img 的「先剥离防坏相对候选」不同，iframe 保持原文等改写（媒体管线同语义），首跳是一次无可见影响的失败导航（错误页即空白）。② HTTPS 可用页面——CSP 放行 + browser 层内容可见 + 帧内脚本运行（allow-scripts）与父窗口访问被结构性拒绝（SecurityError 报告读回）+ 顶层导航不发生；真宿主以受控服务器网络层差分证导航被许可（自签证书校验失败在 socket 到达之后，#343 既知边界）。③ srcdoc——内容可见（净化产物）、脚本零执行、帧内样式生效且父 docStyle 不入帧（帧内无 docScope 标记，b2 改写选择器天然不命中——browser 层双向证据）。④ 明确拒绝嵌入（X-Frame-Options/frame-ancestors）——请求真实到达服务器、帧内容不可见（空白帧 = 真实状态）；拒绝的具体站点策略**不可观察，不编造**。⑤ 无效地址——解析失败保持原文（不编造地址），浏览器按原生语义失败呈现空白帧。**一律不以 load 事件或 iframe DOM 存在替代内容可见证据**（内容可见证据只在 browser 层经 CDP 帧读取）。
- **外层命中机制（Live 源码显形）**：沙箱/跨域子文档是独立 document，帧内指针事件不冒泡到父文档——CM6 的 mousedown 拦截器无从命中，无法兑现「单击 iframe 可视区域 → 选中完整源码」。落地为**结构载体**：`prepareHtmlWidgetContent`（块级与行内 widget 共用）把每个 iframe 包进 `.vsidian-live-html-frame`（定位上下文；行内宿主内 inline-block 不断行）+ 后置 `.vsidian-live-html-frame-shield`（absolute + inset:0 + z-index:1 透明压顶），指针事件落在父文档元素上、冒泡到既有拦截器（与内容点击同一执行体——不建第二套命中逻辑）。跨域 iframe **不冒充可直接监听的子 DOM**（规格红线）。Reading 侧不接管（U13：承载受支持的原生交互——browser 层帧内按钮真实可点、零父文档写回）。
- **隔离与生命周期**：本篇 CSS（docStyle 产物）不入 iframe、iframe 内样式不出帧（③ 的双向证据）；`data-vsidian-iframe` 系统标记在属性过滤**之后**写入（源文同名属性已被剥离，不可伪造）——第二道闸 `sanitizeReadingDom` 按标记 + sandbox 在场豁免，未标记 iframe 维持移除（防御纵深语义不变，独立负向钉住）。宿主桥隔离：恶意子页 postMessage 注入不被消息桥消费（真宿主用例复用 #343 证据口径）。释放：帧 DOM 移除即中止在途装载（webPage 先例），资源订阅随 binding 退订迟到不回写（T05 既有），换文档后零残留帧（browser/真宿主双向）。

#### SVG/MathML 与混合命名空间实施落档（T08/#573）

- **净化配置面**（`htmlSanitize.ts` 单一定义点，证据 `out/test/t08-purify-probe*.log`——jsdom 实测 DOMPurify 3.4.16）：默认白名单**不含** foreignObject/use/animate/animateMotion/animateTransform/set/mpath（整元素移除——浏览器可用语义被粗暴全删），`ADD_TAGS` 放行；foreignObject 内 HTML 节点被 `_checkValidNamespace` 判非法移除（HTML_INTEGRATION_POINTS 默认仅 annotation-xml），配置补 `foreignobject` 键——**必须小写**（检查按 tagName 小写比对而配置不做 case 转换）且**必须对象形态**（`_resolveObjectOption` 只认 object，数组静默回落默认）。命名空间内负向全拦（jsdom 单测 + browser 双证据）：svg script/on*/危险协议 use data:/javascript:、动画 attributeName 指向 href 族（含大小写与带前缀形态）与 on* 的劫持向量（hook 整体移除 + DOMPurify 内置属性级防线双保险）、foreignObject 内 HTML 走同一管线（script/iframe/事件/伪造 data-vsidian-* 全拒）、image 的 data:text/html 拒（data:image/* 保留）、maction actiontype 拒。**已知边界**：SANITIZE_DOM（默认开）剥与 document 命名属性撞名的 id（如 id="title"——DOM clobbering 防护，DOMPurify 既定行为）；外部 use 引用（http/data）净化层保持属性、浏览器原生失败（Chromium 已禁外部 use 文档引用——如实呈现）；SMIL 动画的 `begin="id.event"` 同步引用不做 id 前缀协同（跨实例动画同步串扰为已知边界，几何/变换动画不受影响）。
- **ID 文档作用域**（纯逻辑 `src/shared/htmlFragment.ts` + 装配咽喉 `htmlResourceMount.applyHtmlIdScope`——经 `prepareHtmlResources` 的 deps.docScope 单点接线，四条装配路径〔Reading A 零改写缺省 / RefContentMount B/C / Live 块级与行内 widget 从 docScope facet 透传〕共享一份）：HTML/SVG 的内部 ID 在同一 webview document 全局解析——B 的渲染产物挂在 A 的 DOM 里会串目标。**B 单侧前缀化**：产物内全部 id 与片段引用统一加 `vs<scope>--` 前缀（scope 键清洗为 CSS ident 安全字符）；引用改写**按属性语法分派**（2026-10-17 评审修复）：`href`/`xlink:href` 是 URI 值语法——整值 `#frag` 前缀化；style 与 SVG paint 属性（fill/stroke/clip/mask/marker/filter）是 CSS 值语法——只改 `url(#id)` 产（裸与单双引号三形态、引号保形，词法复用 T05 `scanCssUrls`），整值 `#rrggbb` 是颜色零动作；主文档（'doc'/缺省）零改写——A 内多块 id 冲突是作者自己的 HTML 原生语义。**未命中目标也加前缀**（B 域引用一律限定 B 域——不外溢成 A 的锚跳目标，「不伪造宿主锚点」）。**CSS 侧协同**（`docStyle.ts` 改写器同前缀代换，缺一即失配）：`scopeDocStyleSelector` 对非主文 scope 的 `#id` 选择器项加前缀（跳过属性选择器字符串与 CSS 转义 id——后者保持原文降级）；规则声明的 `url(#id)` 经 `scopeCssFragmentRefs` 同前缀（词法复用 T05 `scanCssUrls`——字符串/注释/资源 url() 不动）。已知边界：同一 B 的多实例共享 scope 键 → DOM 内重复前缀 id（同源内容呈现等效，url() 解析到首个实例——记录为边界）；`a[name]` 老锚点语法不改写。
- **SVG 资源条目**（`htmlResourceMount` 的 mediaTargets 式清单加四条）：`image[href]`/`image[xlink\:href]`/`use[href]`/`use[xlink\:href]`（转义冒号属性选择器按 qualified name 命中 namespaced 属性——jsdom/浏览器实测一致）；`#` 片段归 ID 管线不订阅；相对路径沿 T05 订阅管线（B 身份 sourceDocUri）；成功改写 xlink 用 setAttributeNS 保命名空间（防序列化双属性）；失败保持原文。`a[href="#frag"]` 在 B 域经 ID 管线前缀化（a[href] 外部导航不改写的 T05 口径不变——例外仅文档内锚点归属）。
- **SVG 内嵌 `<style>`**：不另建通道——T04 收集器按全文源文扫 `<style\b`，SVG 块内的 style 同被收集装载（文档级语义、docScope 隔离），DOM 净化层 FORBID 全命名空间维持双通道口径；CSS 类/标签选择器命中 SVG 命名空间元素按实际 DOM 匹配天然生效（browser 断言 `.cls` fill 计算色）。
- **能力矩阵**（实测记录）：基本几何/文字/渐变引用（linearGradient+stop+url()/滤镜（feGaussianBlur 等）/clipPath/use 同文档引用/SMIL 几何与变换动画（attributeName=几何目标）/foreignObject 内 HTML（含内联样式与 img 资源属性）/MathML 结构（mrow/msup/mfrac/msqrt/mi/mo/mn）与属性（mathvariant/lspace/displaystyle）——**本机浏览器（Playwright Chromium）与真宿主 1.82.3（Electron 25/Chromium 114）双环境实测可用**（SVG 与 MathML 绘制断言均落在 rect 面积——`test/integration` 用例 #573 与 browser 套件 `svgMathml-573`）；**限制**：外部 use 文档引用（Chromium 禁用——属性保持、原生失败）、动画同步 `begin="id.event"` 跨实例引用不协同、SANITIZE_DOM 撞名 id 剥除、MathML `maction` 交互语义（Chromium 114 未实现，actiontype 净化层拒）。
- **登记**：paint 探针 `paint.html.svgMath`（protocol PaintProbe 类型同步）；style-contract 公开契约面零变化（不改类名/变量/DOM 关系承诺——ID 前缀化作用于文档内容非契约入口，`check:stylecontract` 验证）；i18n/键位/ui-patterns 零新增（无新用户文案、无新操作、无新自绘 UI）。

### 资源与原生交互

- 原生 HTML 输入先经过专用内容净化边界，再与系统生成的渲染内容装配。不能把系统依赖的内部 `data-*`、命令标记或桥接元素准入权交给源文 HTML，也不能在全局净化时误删系统自己生成的锚点。
- HTML 链接、图片和 CSS 引用复用来源文档身份、URI 解析与既有资源权限；嵌入 B 中的相对资源属于 B。HTML 中的不同 URL 属性须按真实语法处理，包括 `srcset`、媒体 `source`、SVG 引用及 CSS URL，不能统一当作单个 `src` 字符串。
- 不允许因为新增 HTML 而自动扩大 `localResourceRoots`、脚本权限或宿主桥能力。现有短名／绝对路径规则、UNC 与 file URL 的边界仍按对应规格维护；需要改变时另报理由。
- Reading 中的表单或控件状态属于视图临时状态，不自动持久到 Markdown，不成为新的宿主写回入口。提交、导航和子框架行为需在处理矩阵中说明，未经验证不得声称可访问外部服务；不承诺提供表单后端。
- SVG、MathML 及混合命名空间内容经过对应净化和资源处理，不能套用仅 HTML 元素的检查就宣布安全。SVG 中的嵌套 HTML、链接和引用资源属于本批。
- 远端 iframe 被站点策略拒绝、媒体格式不受运行时支持、资源没有权限时如实处理；不能以 `load` 事件或 iframe DOM 存在替代内容可见证据。无法判断原因时说明未核实，不编造具体站点原因，不绕过站点限制。

## 工程接缝与变更边界

| 接缝 | 实施职责 |
|---|---|
| `src/shared/markdownDoc.ts` 与现有 Markdown 语法树 | 校准 HTML 源码边界；保留既有标记与代码上下文语义 |
| `src/webview/readingMarkdown.ts`、`readingBlocks.ts`、`readingView.ts` | 接通原生 HTML 分块、渲染与来源身份；将当前 HTML 禁用边界替换为可验证的内容净化边界 |
| `liveInstance.ts`、`liveDecorations.ts`，既有公式／图形替换机制 | 接入当前编辑实例的片段装饰、选区显形与视口生命周期，不建立第二份文档或撤销栈 |
| 现有引用内容实例、目标编辑端口与资源链 | 保留来源 B 的编辑、资源与释放归属；递归视图遵守同样文档规则 |
| `snippetLoader.ts`、`src/host/editorCsp.ts` 及资源服务 | 保留既有片段能力；文档内样式独立持有生命周期；按探针最小接线必要资源能力 |
| `styleContract.ts`、公开别名桥、ui-patterns 与 locales | 登记新增呈现入口和双语文案；保留历史入口、悬停提示和 UI 形态契约 |
| `keybindings.ts` 与既有目标解析 | 提供可绑定的“编辑当前 HTML 源码”操作，默认未绑定、仅 Live 正文；命中当前片段后与按钮同源，不抢源码模式或设置页 |

上述表用于明确消费既有能力的责任，不冻结未验证的新文件名、签名或包选择。解析与净化的共享规则只维护一份，避免 Reading、Live、引用三条路径复制策略。

### 先做技术探针

第一张票验证最难逆转的文档样式隔离方案。必须使用实际最低支持宿主 1.82.3，并覆盖本机浏览器；不能从 esbuild 的 `chrome118` 编译目标推断宿主支持新 CSS 能力。

探针至少覆盖正文／源码层分离、工具栏排除、父子引用相互隔离、继承与 CSS 变量、原生选择器匹配、全文规则顺序、虚拟化及历史片段。记录失败候选与可用路线，不先锁定 Shadow DOM、iframe、`@scope` 或简单选择器前缀方案。与已确认目标不能兼得时，报告证据并暂停依赖该结论的实现，不静默缩减范围。

## T09 收口落档：全量覆盖矩阵（#574）

汇总 T02–T08 各票落档为单一收口矩阵，逐项标注去向与证据。**状态分三档**：

- **已验证**：有自动化证据落地。证据层级缩写——u=unit（vitest/jsdom，无布局）、b=browser（Playwright Chromium 生产控制器，真实布局与指针/IME）、i=integration（1.82.3 真宿主，绘制层断言落 `view.state.paint`）。
- **平台限制**：运行时（Chromium/Electron/宿主 CSP/站点策略）拒绝或未实现，已取证并如实呈现，非本扩展缺陷。
- **待验证（人工）**：物理环境依赖（真实 IME 候选窗、扬声器、物理鼠标、肉眼观感），已列入 [manual-verification.md](manual-verification.md) 对应节，代理自动化通过不构成用户验收。

### A. 元素类别矩阵

| 类别 | 去向 | 证据 | 状态 |
|---|---|---|---|
| 文本结构族（div/span/p/h1–h6/br/hr/em/strong/ul/ol/li/blockquote 等白名单全量） | 双模式净化渲染（DOMPurify 默认白名单第一道闸 + sanitizeReadingDom 第二道闸） | u `htmlSanitize.test.ts`（29 例）/ b `liveHtml`/`liveInlineHtml` / i #567 | 已验证 |
| 表格（table/thead/tbody/tr/td/th + colspan/rowspan 合并单元格） | 原生语义渲染（不转 Markdown 表格网格） | b `liveHtml` / i #567 paint.html（合并格 elementFromPoint 命中） | 已验证 |
| 行内 HTML（span/b/br/img 等单标签与成对嵌套） | 原位渲染、最外层成片段、不成型降级源码 | u `htmlInline`/`readingInlineHtml` / b `liveInlineHtml` / i #568 paint.html.inline | 已验证 |
| 链接 `a[href]` | 属性不改写；Live 点击一律源码显形（preventDefault 不跳转），Reading 走既有导航委托 | b `htmlResources` E/F | 已验证 |
| 图片 `img`（src/srcset）与 `picture>source` | 按所属文档解析改写；srcset 规范算法逐候选 | u `htmlResource`（24 例）/ b `htmlResources` A/B / i #570 | 已验证 |
| 表单族（form/input/select/textarea/button/fieldset 等全族） | Reading 原生交互（临时态零写回）；Live 控件点击=完整源码选区；提交 document 守卫恒拦 | u `htmlInteract` / b `html-controls-571` / i #571 | 已验证 |
| 媒体（audio/video/source/track） | 归属解析装载（CSP media-src）；生命周期停播链（卸载/退场/模式切换） | b `html-controls-571`（合成 WAV 真实解码）/ i #571（readyState≥2、muted autoplay 推进） | 已验证；远端 https 媒体走浏览器原生管线（沿 img 远端面语义，逐格式不承诺——编码支持=运行时解码面） |
| iframe | T07 五类处理矩阵（本地页/https/srcdoc/站点拒绝/无效地址）；sandbox 系统强制；Live 外层 shield 命中 | u `htmlSanitize`（sandbox 矩阵）/ b `htmlIframe572`（CDP 帧读取）/ i #572（CSP 差分+宿主桥隔离） | 已验证；真实站点登录态/各站策略面 → 人工 |
| SVG（几何/文字/渐变/滤镜/clipPath/use/SMIL/foreignObject） | 命名空间净化 + ID 文档作用域 + 资源条目 | u `htmlSvgMathml`（25 例）/ b `svgMathml-573` / i #573 paint.html.svgMath（双环境 rect 面积） | 已验证；外部 use 文档引用 → 平台限制（Chromium 禁用，属性保持原生失败） |
| MathML（mrow/msup/mfrac/msqrt/mi/mo/mn + 属性） | 同上管线 | b `svgMathml-573` / i #573（双环境） | 已验证；`maction` 交互 → 平台限制（Chromium 114 未实现，actiontype 净化层拒） |
| script/事件属性/危险协议（javascript:、data:text/html 等） | 恒拒（含 SVG/MathML/foreignObject/srcdoc 命名空间内负向矩阵） | u 各净化测试 / b 各套件负向场景 | 已验证（负向） |
| 纯 `<style>` 块 | Live 源码常显可直接编辑、Reading 隐藏零占位；内容进全文装载 | b `liveHtml`/`docStyle` / i #569 | 已验证 |
| HTML 注释 | 沿既有规则（Live 淡化、Reading 字符串级剥离）——不随本批重定义 | u `htmlCommentStrip`/`htmlCommentCssContract`（既有） | 已验证（既有） |
| 代码围栏/缩进代码/行内代码中的 HTML | 字面语义不变 | u `htmlBlock`/`htmlInline` 排除集 | 已验证 |
| 畸形边界（未闭合/孤立闭/跨行/容器内降级） | 保守降级为可访问源码，不吞邻接 Markdown | u `htmlBlock`（7 例）/`htmlInline`（9 例）+ b `liveHtml` 边界场景 | 已验证 |
| 明确不可见元素（head 类/style/meta 等） | 按片段语义处理，不新增占位卡片 | u `htmlSanitize`（容器包裹防丢） | 已验证 |

### B. 关键属性与命名空间矩阵

| 项 | 去向 | 证据 | 状态 |
|---|---|---|---|
| `style` 属性 | 元素级样式保留生效 | b `liveInlineHtml`（颜色计算值）/ `htmlCross574` 场景 4（悬停浮层内） | 已验证 |
| `class` 属性 | 可消费 CSS 片段与本篇 `<style>` | b `docStyle` / `svgMathml-573`（`.cls` fill） | 已验证 |
| 源文 `data-vsidian-*` | 净化剥离（系统标记不可伪造；系统标记在过滤后写入） | u `htmlSanitize` / i #567 | 已验证（负向） |
| `formaction`/`autofocus` | 净化层剥离钉住 | u `htmlInteract` | 已验证 |
| iframe `sandbox`/`allow`/`allowfullscreen`/`allowpaymentrequest` | 系统强制覆盖作者值；权限面零授予 | u `htmlSanitize` / b `htmlIframe572` | 已验证 |
| iframe `srcdoc` | 属性值递归净化（SAFE_FOR_XML 闭合标签二分坑绕过）；嵌套帧 FORBID | u `htmlSanitize` / b `htmlIframe572`（帧内脚本零执行） | 已验证 |
| SMIL `attributeName`（href 族/on*） | hook 整体移除（动画目标劫持向量） | u `htmlSvgMathml` | 已验证（负向） |
| `xlink:href`（旧形态） | setAttributeNS 保命名空间改写 | u `htmlResourceMount` / b `svgMathml-573` | 已验证 |
| 文档内部 ID（B/C 渲染产物） | `vs<scope>--` 前缀化（id/`url(#id)`/`href="#frag"` + CSS 侧同前缀协同）；主文档零改写 | u `htmlFragment`（18 例）/`htmlIdScope`（15 例） / b `svgMathml-573` | 已验证；同 B 多实例重复前缀 id（url() 解析首实例）为已记录边界 |
| SANITIZE_DOM 撞名 id（如 id="title"） | DOMPurify 既定剥除行为 | u `htmlSvgMathml` | 平台限制（DOMPurify 防护语义） |

### C. 资源能力矩阵

| 通道 | 去向 | 证据 | 状态 |
|---|---|---|---|
| img `src`/`srcset` | 剥离-解析-回写（srcset 逐候选重组，失败候选保原文） | b `htmlResources` A/B / i #570（A/B 串源负向） | 已验证 |
| 媒体 `src`/`poster`/`source[src]` | 剥离-回写-失败恢复原文 | u `htmlResourceMount` / b `html-controls-571` | 已验证 |
| CSS `url()`/`@import`/`@font-face` src | 词法扫描改写（跳过注释/字符串），按样式所属 Markdown 解析 | u `htmlResource`/`docStyleResources` / b `htmlResources` C（背景绘制+字体装载） | 已验证（jsdom CSSOM 丢 @font-face src 描述符——全链字体断言在 b/i 层） |
| SVG `image/use` href（两形态） | 沿媒体同款管线订阅改写；`#` 片段归 ID 管线 | u `htmlResourceMount` / b `svgMathml-573` | 已验证；外部 use 文档引用 → 平台限制 |
| iframe `src` | 本地相对路径按来源文档解析改写（srcdoc 在场跳过） | b `htmlIframe572`（CDP 帧内容可见）/ i #572（地址已改写+导航无拒绝） | 已验证；改写落地前首跳相对地址有一次无可见影响失败导航（记录的既有语义） |
| `a[href]` | 一律不改写（导航归点击委托/宿主分类） | b `htmlResources` F | 已验证 |
| 请求通道 | 独立消息种 `htmlResource.request`（reqId 与 image.result 隔离）+ 失效重取 + 释放迟到丢弃 | u `docStyleResources` / b `htmlResources` G/H / i #570（覆写失效刷新） | 已验证 |
| 资源根/CSP | `localResourceRoots` 零扩；CSP 增量仅 `media-src ${cspSource} https:`（T06）与 `frame-src` 增 `${cspSource}`（T07），词法钉住 | u `editorCsp.test` | 已验证（词法契约） |

### D. CSS 能力矩阵（文档内 `<style>`）

| 能力 | 去向 | 证据 | 状态 |
|---|---|---|---|
| 选择器形态（标签/类/属性/伪类/伪元素/`#id`） | b2 路线逐块标记改写（`:where()` 零特异性），按实际 DOM 匹配不翻译语义 | u `docStyle`（42 例）/ b `docStyle` / i #569（Reading 标签直中+工具栏排除） | 已验证 |
| `:root`/`body`/`html` | 改写后失活（既定口径，文档化） | u `docStyle` | 已验证（按失活语义） |
| at-rule：`@media`/`@supports`/`@layer`/`@container` | 递归改写内层 | u `docStyle` / i #569 | 已验证 |
| `@keyframes`/`@font-face`/`@property`/`@import` | 原样保留（文档级名字空间；`@import` 非首位失效属 CSS 原生位置规则） | u `docStyle` | 已验证 |
| CSS 嵌套 `&` | 递归代换（多层/组块内） | u `docStyle` | 已验证 |
| 自定义属性定义与继承 | 原意生效 | b `docStyle` | 已验证 |
| 层叠与片段先后序 | 文档样式后置于 CSS 片段链（同特异性文档胜）；片段启停/排序/历史契约不改写 | b `docStyle`（snippetLinkAfter + 特异性共存） | 已验证 |
| 作用域隔离 | 主/子/孙（A/B/C）各自 docScope；源码层与工具栏排除；同 B 多实例共享产物互不污染；释放回收无残留 | b `docStyle`（B 卡/C 孙卡/多实例） / i #569（删除回收）/ i #570（释放回收） | 已验证 |
| 模式差异（U10 口径） | 标签选择器 Reading 直中 Markdown 语义标签、Live 不命中 CM6 行结构——按实际 DOM 匹配的既定差异 | i #569 + 规格「文档样式实施落档」 | 已验证（文档化差异，非缺陷） |
| 样式存续 | 不因离屏/虚拟化卸载/源码显形失效；Live 编辑/撤销/重做/外部更新实时同步 | b `docStyle`（撤销重做往返） / i #569（WorkspaceEdit 增量） | 已验证 |

### E. 交叉场景矩阵（本票补齐）

| 场景 | 证据 | 状态 |
|---|---|---|
| 主文档 × Live/Reading | b `liveHtml`/`liveInlineHtml`（11+10 场景）/ i #567/#568 | 已验证 |
| 嵌入 B × Reading（含 C 孙卡、同 B 多实例） | b `docStyle` / i #570 | 已验证 |
| 嵌入 B 内部 Live（widget + 资源 + 样式排除） | b `docStyle`（嵌入内部 Live）/ u `embedLiveResources` | 已验证 |
| 悬停浮层 × HTML（B 身份渲染+隔离） | b `htmlCross574` 场景 4（本票新增：表格渲染、行内样式生效、脚本零执行、docScope 非 doc） | 已验证（本票补） |
| 多层引用（A→B→C 递归） | b `docStyle`（C 孙卡）/ `hoverRecursive`（既有） | 已验证 |
| 不同来源样式（文档样式 vs CSS 片段） | b `docStyle`（后置序+特异性）/ `cssSnippet*`（既有） | 已验证 |
| 查找定位命中 HTML 源码范围 | b `htmlCross574` 场景 1/2（本票新增：真实 Ctrl+F 命中块级/行内 → 显形；移出恢复） | 已验证（本票补） |
| 标题折叠区间含 HTML 块 | b `htmlCross574` 场景 3（本票新增：折叠隐藏 widget、view.locate 落点自动展开恢复渲染） | 已验证（本票补） |
| IME × 行内 HTML | b `liveInlineHtml` 场景 G（CDP 组合定稿） | 已验证 |
| IME × 块级 HTML | b `htmlCross574` 场景 5（本票新增：CDP 组合定稿落源文、显形保持） | 已验证（本票补） |
| 撤销历史（样式/片段编辑） | b `docStyle`（撤销重做）/ `liveHtml`（选区撤销恢复渲染）/ u 各编辑链路 | 已验证 |
| 锚点导航/搜索 reveal 抵达 HTML | `htmlCross574` 场景 1–3（locate/查找通道）+ 既有 #534 行号落位族 | 已验证（经共同汇聚通道） |
| 模式切换（媒体停播/样式存续/折叠存续） | b `html-controls-571`/`docStyle`/`headingFoldReveal`（既有） | 已验证 |

### F. 收口验证与产物

见下方「T09 收口验证记录」。性能见 [docs/perf/2026-10-html-rendering-perf.md](../perf/2026-10-html-rendering-perf.md)。父票 #565 保持开放用于整体验收；**代理自动化通过不构成用户验收**——人工项清单见 [manual-verification.md](manual-verification.md) 各票专项节与 #565 批次总览节。

### T09 收口验证记录（2026-10-17，工作树 vsidian-565-t09-final @ 1ef411c5）

| 检查 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 编译全链（tsc + esbuild + 生成物） | `npm run compile` | EXIT=0 | `out/test/t09-compile.log` |
| unit 全量 | `npm run test:unit`（foreground） | EXIT=0：390 文件 9061 例通过；node 启动器契约 188 通过/7 跳过 | `out/test/t09-unit-full.log` |
| browser 全量 | `npm run test:browser`（3 并发） | EXIT=0：113/113 套件通过（298s，含本票新增 htmlCross574 五场景） | `out/test/t09-browser-full.log`、`out/test/browser-runs/run-kon4js/` |
| 真宿主集成（dev，1.82.3 本地缓存宿主） | `VSIDIAN_ITEST_SHARDS=4 npm run test:integration` | 分片 1/2/4 退出码 0（113+112+112 例）；分片 3 两例失败——#202 批量索引收敛与 #364 渲染样例降级，均在敏感组登记的既有抖动族；**定向重跑 2/2 通过**（EXIT=0） | `out/test/t09-integration-shards.log`、`out/test/t09-integration-jitter-rerun2.log` |
| VSIX 打包 | `npx @vscode/vsce package --no-dependencies` | EXIT=0：vsidian-1.0.2.vsix（416 文件，5.47 MB，红线内） | `out/test/t09-vsce-package.log` |
| VSIX 安装态回归 | `node test/integration/runInstalled.mjs`（VSIX 装入隔离 profile 便携宿主跑同一套件） | 374/449 通过，**#567–#573 HTML 族 7 例全部在安装产物上通过**；75 失败中 73 例为附加组件夹具族（`vsidian-test-fixture.*` 命令缺失——`runInstalled` 启动器不携带附加组件夹具扩展，先于本批的既有缺口，附加组件安装态路径归 `runInstalledAddons.mjs`/T16 阶段矩阵，不属本批回归面），2 例 #198/#200 索引抖动族——**安装态定向重跑 2/2 通过**（EXIT=0） | `out/test/t09-installed-shards.log`、`out/test/t09-installed-jitter-rerun.log` |
| 性能（HTML 档） | `PERF_SCOPES=html node test/perf/runPerf.mjs docs/perf/data/html-574` | EXIT=0：五档数据与结论见[性能报告](../perf/2026-10-html-rendering-perf.md)（视口有界性与虚拟化边界保持） | `out/test/t09-perf-html.log`、`docs/perf/data/html-574/perf-report.json` |
| 样式契约基线复验 | `npm run check:stylecontract:baseline` | EXIT=0（基线与 git 锚定一致） | `out/test/t09-stylecontract-baseline.log` |
| 样式契约八项 | `npm run check:stylecontract` | EXIT=0（8 项零失败） | `out/test/t09-stylecontract.log` |
| file-tree | `tree_tool.py check --strict` | EXIT=0（新文件已登记） | `out/test/t09-filetree-check3.log` |

**契约面结论**：i18n 两语言包 parity 经编译链把关（compile 全链含 parity 与 nls 生成），本票零新增用户文案；键位注册表本票零新增操作（批次唯一新增操作「编辑当前 HTML 源码」在 #567/#568 已登记落档，keybindings.md 有评估记录）；CHANGELOG 批次用户可见条目（#567–#573 七组）齐全，T09 为收口票零新增用户可见变更。**遗留（如实记录）**：`runInstalled.mjs` 不携带附加组件夹具扩展导致附加组件 73 例在通用安装态回归中确定性失败，属启动器既有缺口（非本批引入、不影响 HTML 族）；修复需另立票据（沿 `runInstalledAddons.mjs` 打包路线或给通用启动器补夹具装载）。

## 验证与完成条件

- 可执行行为遵循 TDD。单测钉源码边界、净化、选区、规则顺序和资源语法；不能只测试与实现同形的字符串常量。
- 使用生产控制器的 browser 测试验证真实点击、方向键、双向选区、多选区、跨块拖选、输入法、模式切换、查找定位和滚动回收。
- 新呈现至少一条真宿主集成断言落在 `view.state.paint` 的颜色、可见性等绘制层；表格合并单元格、行内样式及源码选择均有可观察结果。
- 构建、适用 unit/browser、真宿主与 VSIX 安装态覆盖实际产物；全量浏览器和全量宿主重负载不在本机并跑。长命令首次即保存日志和退出码，优先消费工具自带报告，不为补看输出重跑。
- 变更前固定已发布样式基线与当前分支 SHA；执行 style-contract，新增自绘元素执行 ui-patterns；更新 i18n、键位说明和文件树。不得通过重写历史基线或移除旧测试证明兼容。
- 当前 `html:false` 测试体现旧产品约束；必须在规格差异说明下调整为“允许合规 HTML、仍拒绝执行与越权”的新断言，保留独立负向证据。未改实现前不得先删除旧安全断言。
- 为 HTML 元素分类和关键属性建立覆盖矩阵，区分已验证、平台限制及待验证；不能以排版表格通过替代全量完成。
- 覆盖超长 HTML、单个大表格和大量片段；继续保持视口 DOM 回收，不能通过常驻全文 DOM 兑现 CSS。预算采用现有模型并记录基线／候选数据，不杜撰性能阈值。
- 自动化通过、用户人工验收及实际发行分别记录；人工项至少包含真实输入法、物理鼠标跨块选择、明暗主题观感、媒体及 iframe 内容可见性。

## 明确不包含

- 不增加笔记脚本或事件属性的执行能力，不开放宿主桥，不接管其他文档或整个 Webview。
- 不做 Live Markdown 与 Reading DOM 的重建或标签选择器语义翻译，不承诺任意 CSS 双模式等效。
- 不建设独立富文本文件格式、HTML 可视化结构编辑器或 DOM 回写管线；HTML 表格仍通过本片段源码编辑，不自动获得 Markdown 表格网格编辑命令。
- 不为 HTML 内部递归解析 Markdown，不改变代码字面语义和 HTML 注释规则。
- 不额外提供服务器、表单后端、媒体转码或远端站点策略绕过。
- 本次开票不授权实施代码、推送、合并或市场发布。全量目标下的元素分类不是范围豁免；遇到平台限制需提供证据并单独讨论。

## 实施票与依赖

| 编号 | 可独立验收的交付 | Blocked by |
|---|---|---|
| [T01 #566](https://github.com/ONEGAYI/vsidian/issues/566) | 文档样式隔离与最低宿主技术探针 | 无 |
| [T02 #567](https://github.com/ONEGAYI/vsidian/issues/567) | 块级 HTML 双模式渲染与 Live 源码编辑闭环 | [#566](https://github.com/ONEGAYI/vsidian/issues/566) |
| [T03 #568](https://github.com/ONEGAYI/vsidian/issues/568) | 行内 HTML 混排、源码显形与精确选区 | [#567](https://github.com/ONEGAYI/vsidian/issues/567) |
| [T04 #569](https://github.com/ONEGAYI/vsidian/issues/569) | 全文 `<style>` 装载、原生匹配与文档隔离 | [#566](https://github.com/ONEGAYI/vsidian/issues/566)、[#567](https://github.com/ONEGAYI/vsidian/issues/567) |
| [T05 #570](https://github.com/ONEGAYI/vsidian/issues/570) | HTML 链接、图片与 CSS 资源的来源归属 | [#568](https://github.com/ONEGAYI/vsidian/issues/568)、[#569](https://github.com/ONEGAYI/vsidian/issues/569) |
| [T06 #571](https://github.com/ONEGAYI/vsidian/issues/571) | 表单、details 与音视频的模式内交互 | [#570](https://github.com/ONEGAYI/vsidian/issues/570) |
| [T07 #572](https://github.com/ONEGAYI/vsidian/issues/572) | iframe 与子文档的装载、隔离和显形 | [#570](https://github.com/ONEGAYI/vsidian/issues/570) |
| [T08 #573](https://github.com/ONEGAYI/vsidian/issues/573) | SVG／MathML 与混合命名空间内容 | [#570](https://github.com/ONEGAYI/vsidian/issues/570) |
| [T09 #574](https://github.com/ONEGAYI/vsidian/issues/574) | 全量覆盖矩阵、安装态与性能收口 | [#571](https://github.com/ONEGAYI/vsidian/issues/571)、[#572](https://github.com/ONEGAYI/vsidian/issues/572)、[#573](https://github.com/ONEGAYI/vsidian/issues/573) |

每票同时包含本条用户路径所需的解析、渲染、交互和验证，不按“先全部解析、再全部 UI、最后全部测试”横切。T01 是明确的技术前置；若发现必须重构既有接缝，另列可独立验收的准备票，不把全仓重构混入业务票。

票据已按依赖顺序发布，本地正文与发布记录保存在 `.scratch/html-rendering/`。仅 T01 无阻塞并标记 `ready-for-agent`；其余票标记 `wait-for-upstream`，票面前置使用真实编号。总票保持开放，子票完成不替代整体人工验收。
