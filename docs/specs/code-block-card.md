# 规格：代码块卡片（高亮、卡片样式、复制按钮与折叠）

状态：工单 #78 交付，2026-09-26。本文是代码块卡片功能的单一事实源，实施工单 #79–#85 的验收以此为准。设计共识经问卷（2026-09-26）确认，参考 Obsidian 插件 Code Styler（v1.1.7）的观感与两张逐像素读图结论；**不复用其实现**——该插件的高亮复用 Obsidian 原生引擎、复制按钮借 Obsidian 原生按钮再样式化，两条路径在 VSCode webview 中均无等价物，本项目自建。

## 范围

- **覆盖**：Live 视图与阅读视图的**围栏代码块**（fenced code block），两视图观感一致。
- **固定排除**：`mermaid` 围栏（#60 专属管线）、`$$` 公式（#59 专属管线）不套卡片；缩进代码块（非围栏）维持现状源码形态；行内代码不在本规格内。
- **非目标**：`title:`/`ln:N` 逐块参数、全选代码按钮、自定义 header/footer 文本模板、Shiki 引擎、行内代码美化。

## 卡片解剖（呈现态，光标在块外）

参照读图结论（Code Styler 深色主题截图）：

- **围栏行**：两条围栏行**行槽保留、内容清空**（零残留文字），不是被头部替代——头部是插在块首行**上方**的额外横带。编辑态显形时围栏符号与代码文本列（卡内行号列宽 + 24px 间距）**同 x 真实对齐**（#189：缩进值按块经 `--vsidian-code-indent` 注入行装饰，行号关闭或无内容行时归零；代码文本行与行号列绝对位置不动——用户决议）。
- **头部横带**：语言标签（显示名、首字母大写，如 `Plain text`、`JavaScript`，粗体）居左；右侧按钮区 [折行] [复制] [折叠]——**折叠钮固定最右**（2026-09-28 用户决议：收起态复制钮不渲染，折叠/展开按钮屏幕坐标恒定，鼠标不挪可连续开合）；**折行钮（#191）插在复制钮左侧、仅阅读侧装配**（Live 恒折行，见「折行与续行对齐」节）。**整条横带是折叠热区**（除按钮本身均可点击切换，`cursor: pointer` 暗示，Live 侧另以 mousedown 拦截阻断 CM6 落选区）。头部下方 1px 分隔线。
- **卡内行号**：代码行左侧，每块从 1 起；**围栏行不占卡内行号**（两态一致）。颜色、字号与文档行号槽一致。行号列**总占恒为列宽 + 24px，左右分配为左缘 8px + 数字与代码间距 16px**（2026-09-28 验收调整：行号离卡片左缘 8px，代码列 x 与悬挂缩进基准不变——总占不变则代码正文零位移）。折行态下长行的**续行对齐文本列**（悬挂缩进，见「折行与续行对齐」节），不窜入行号区。**2026-10 起仅实时预览（Live）发射**：阅读视图不再显示卡内行号（用户产品决策，与引用内容先例及 Obsidian 阅读视图形态对齐），`codeblock.lineNumbers` 对阅读侧无操作——阅读侧无行号列、无悬挂缩进注入、无 nowrap sticky 行号（相关规则一并退场）。
- **外壳**：小圆角（约 4–6px）、无边框；背景比正文背景略亮、低对比浮起感（走 `--vscode-*` 主题变量）；头部与代码区同底色。
- **文档行号槽**：两态照常显示**全部**源文件行号——包括呈现态被清空的围栏行；与卡内行号两列并存、互不遮挡。两列行号字体同款（衬线数字观感由宿主字体决定，不强求），代码字体为等宽。

## 编辑态（光标进入块内）

| 项 | 呈现态 | 编辑态 |
| --- | --- | --- |
| 围栏行 | 内容清空、行槽保留 | 原样文本显形，可编辑（含 IME）；符号与代码文本列同 x 对齐（#189） |
| 头部横带 | 保留 | 保留 |
| 卡内行号（仅 Live，2026-10 起阅读侧不发射） | 保留 | 保留 |
| 复制按钮 | 整卡悬停显现 | 常驻（与呈现态一致） |
| 折叠 chevron | 保留 | 保留（编辑态不折叠） |
| 卡片外壳（底色/圆角/分隔线） | 保留 | 保留 |
| 语法高亮 | 保持 | 保持 |

控制域沿用 #29 决议语义：围栏块的**控制域是整个块**（含两条围栏行与全部内容行）；非空选区与块相交时同单光标处理（围栏显形）。光标/选区移动只切换装饰，零写回、不产生撤销历史。

## 折叠

- 折叠入口是**整条头部横带**（chevron 与标签/空白区均可点击，2026-09-28 用户决议；复制等按钮自身排除、事件不冒泡到热区）：点击收起代码体（仅留头部横带，chevron 转向约 -90°/0°），再点展开。两视图同一口径。
- 折叠钮固定按钮区**最右**：收起/展开两态屏幕坐标不变（浏览器测试实测 < 1px），鼠标不挪可连续开合。
- 折叠是**视图状态**：不写源文件、不跨会话持久化（重开文档后全部展开）。
- 光标进入已折叠块区间时**临时展开**，离开后恢复收起；编辑态不折叠。
- 收起态悬停不弹复制按钮。

## 折行与续行对齐（#191）

**续行窜行修复（两视图，默认折行态）**：折行态下长代码行的续行原本退到内容盒左缘（x=0），窜入卡内行号区——Live（行号是行首内联 widget + `EditorView.lineWrapping` 全局折行）与阅读（`.vsidian-reading-code-line` 内联行号 + `pre` `white-space: pre-wrap`）同病。修复采用**悬挂缩进**：行级 `padding-left: var(--vsidian-code-indent, 0px)` + `text-indent: calc(-1 * var(--vsidian-code-indent, 0px))`——首行完全原位（行号左缘 x=8px 让出左缘边距、文本列不变，#189 决议「不动代码文本行」不被破坏），续行对齐文本列（文本列 x = 行号列总占 = 左缘 8px + 列宽 + 间距 16px）。

- **变量同源**：`--vsidian-code-indent` 与 #189 围栏对齐是同一定义（Live 按块注入全部卡片行的行装饰 attributes，值 = `calc(列宽ch + 24px)`），不建两套公式。行号关闭或无内容行时变量为 0px，两式自动无操作（该态续行无悬挂——已知限制，见文末）。**阅读侧 2026-10 起不注入**（卡内行号退场，续行顶格与首行对齐——该视图续行恒为无悬挂形态）。
- **围栏行覆盖**：`edge-top/-bottom` 行 `text-indent: 0`（选择器特异性更高）——围栏行无行号 widget，保持 #189 的对齐缩进而无悬挂（符号从缩进列起笔）。

**折行开关（仅阅读视图）**：卡片头部按钮区提供折行开关，插在复制按钮左侧——[折行] [复制] [折叠]；收起态仅渲染折叠钮（折行钮与复制钮同口径不发射）。类名 `.vsidian-code-card-wrap`（`-off` 修饰为已关闭态，经 `filter: opacity(0.4)` 弱化与开启态区分——opacity/visibility 归显隐体系独占，filter 与之正交，显现态保持弱化；title/aria-label 取**将触发的动作**——开态提示关闭、关态提示开启，`aria-pressed` 反映当前态）。**显隐与复制钮同口径**（#190 决议「折叠钮常驻、其余进卡即显」）：默认 `opacity: 0; visibility: hidden`，三处显现组（header hover/focus-visible、live reveal 类、阅读块容器 hover）并含复制钮与折行钮两个类段（Live 不装配此钮，规则段无匹配无害）。过渡时序（评审 A-1 订正）：`transition` 仅含 opacity——**显现方向渐显约 0.12s；移出方向 visibility 立即生效、视觉瞬时消失**，opacity 数值经 0.12s 过渡归零（隐藏断言须等过渡稳定，测试口径）。

- **Live 不放此按钮**：CM6 折行（`lineWrapping`）是编辑器级 facet，无法按块关闭；若 Live 也切换会把正文段落变成横向滚动——用户已确认取舍，Live 恒折行（悬挂缩进在其现行默认态生效）。
- **联动语义**：点击**任一块**的开关，全文代码块（含大围栏 60 行分片的各片）同时切换；状态由阅读视图持有（`syncController` 的 `readingCodeWrapOn`），关闭态经阅读容器状态类 `vsidian-reading-nowrap`（内部交互态类，不入公开契约）门控。
- **状态口径**：视图态、默认折行（现行行为）、不跨会话持久化、**不新增设置项**（与折叠 chevron 同语义）。
- **关闭折行的呈现**：卡片代码区水平滚动（`pre` `white-space: pre` + `overflow-x: auto`，滚动条在代码区底部）；**头部横带在 `pre` 外天然不滚动**。~~行号列 sticky 钉左与遮罩~~：阅读侧 sticky 行号列、两层遮罩与行盒延展规则已随 2026-10 卡内行号退场移除（无行号可钉，长行直接横向滑过）。
- **大围栏分片边界**：60 行分片各有独立 `pre`，开关联动作用于所有片，**滚动条按片出现**（每片独立滚动，不做跨片聚合）。
- **朴素形态边界**：`codeblock.card` 关闭时无头部无开关，pre 折行行为维持现状（阅读朴素 pre 仍 `pre-wrap`）；mermaid 渲染态无头部不涉及。

## 复制按钮

- 显现触发区是**整个卡片**（鼠标进入卡片即显、离开即隐，2026-09-28 用户决议，头部横带自身 `:hover` 与 `:focus-visible` 键盘可达规则保留）：阅读侧头部与代码同在 `.vsidian-reading-block.vsidian-reading-code-card` 块容器内，纯 CSS（块容器 `:hover`）承担；Live 侧头部是 CM6 block widget、与卡片行是 `.cm-content` 下兄弟节点、无公共 DOM 祖先，由 JS 指针追踪承担（`liveCodeCard.ts` 的 `codeCardHoverReveal`：`mouseover` 从事件目标反查所属头部——行内目标向 `previousElementSibling` 方向找头部，途中遇非卡片行即中止——挂内部显现类 `vsidian-code-card-reveal`，切换卡片先清旧类，鼠标离开 contentDOM 清除）。
- 点击复制**代码体**（两条围栏行之间的原文，不含围栏与 info string）。内容一致性口径：webview 出站恒为 LF 形态，宿主按文档 EOL 归一后写入剪贴板——CRLF 文档粘贴到仅认 CRLF 的环境（如旧记事本）不串行，LF 文档仍得 LF。
- 写入经宿主剪贴板 API（`vscode.env.clipboard.writeText`），webview 内不触碰剪贴板权限。
- 点击后图标变 ✓ 约 1.2 秒复原。
- **编辑态同样常驻**（用户验收决策）：渲染型围栏（mermaid）只有编辑态卡片——呈现态是渲染图无头部，编辑态再隐藏按钮会让复制功能对这类块完全不可用；普通块随同统一。收起态仍不发射。

## 语法高亮

**引擎**：CodeMirror Lezer 语言包 + `@codemirror/legacy-modes` StreamLanguage，两端（Live 装饰与阅读渲染）共用同一 token 类名与色板。

**语言注册表**（显示名 / 语法来源 / 常见别名）：

| 显示名 | 语法来源 | 别名（不限于） |
| --- | --- | --- |
| JavaScript | `@codemirror/lang-javascript` | `js`、`jsx`、`mjs`、`cjs` |
| TypeScript | `@codemirror/lang-javascript`（TS 方言） | `ts`、`tsx` |
| JSON | `@codemirror/lang-json`（保持严格 JSON） | — |
| JSONC | 原创 StreamParser，JSON + 注释/尾逗号 | — |
| JSON5 | 原创 StreamParser，JSON5 独立词法分支 | — |
| HTML | `@codemirror/lang-html` | `htm` |
| CSS | `@codemirror/lang-css` | — |
| Python | `@codemirror/lang-python` | `py` |
| Shell | legacy-modes `shell` | `sh`、`bash`、`zsh` |
| PowerShell | legacy-modes `powershell` | `ps1`、`pwsh` |
| C | `@codemirror/lang-cpp` | — |
| C++ | `@codemirror/lang-cpp` | `cpp`、`cc`、`c++` |
| Java | `@codemirror/lang-java` | — |
| Go | `@codemirror/lang-go` | `golang` |
| Rust | `@codemirror/lang-rust` | `rs` |
| SQL | `@codemirror/lang-sql` StandardSQL | — |
| PostgreSQL | 同包 PostgreSQL 方言 | `pgsql`、`postgres` |
| MySQL | 同包 MySQL 方言 | — |
| SQLite | 同包 SQLite 方言 + 方括号标识符兼容项 | — |
| YAML | legacy-modes `yaml` | `yml` |
| Markdown | `@codemirror/lang-markdown`（已随包依赖） | `md` |
| Verilog | legacy-modes `verilog` | `systemverilog`、`sv` |
| Tcl | legacy-modes `tcl` + 双引号字符串兼容层（6.5.4 上游缺陷修补） | — |
| VHDL | legacy-modes `vhdl` | `vhd` |
| TOML | legacy-modes `toml` | — |
| INI / properties | legacy-modes `properties`（含 section） | `properties` |
| XML | legacy-modes `xml` | — |
| Dockerfile | legacy-modes `dockerfile` | `docker` |
| CMake | legacy-modes `cmake` | — |
| Diff | legacy-modes `diff` | `patch` |
| C# | legacy-modes `clike.csharp` | `c#`、`cs` |
| Kotlin | legacy-modes `clike.kotlin` | `kt`、`kts` |
| Swift | legacy-modes `swift` | — |
| Dart | legacy-modes `clike.dart` | — |
| Ruby | legacy-modes `ruby` | `rb` |
| Lua | legacy-modes `lua` | — |
| R | legacy-modes `r` | — |
| Julia | legacy-modes `julia` | `jl` |
| SCSS | legacy-modes `css.sCSS` | — |
| LESS | legacy-modes `css.less` | — |
| Protocol Buffers | legacy-modes `protobuf` | `proto` |
| SPICE | 原创 ngspice/常见 HSPICE 网表 StreamParser | `sp`、`ngspice`、`hspice` |
| Makefile | 原创 GNU make StreamParser | `make`、`mk` |
| PHP | 官方 `@codemirror/lang-php` 6.0.2；带标签/HTML 与无标签分别选 Template/Program | — |
| GraphQL | 原创查询/SDL StreamParser | `gql` |

- **多词 info string**：语言路由取 info string 的**首个空白分隔词**（CommonMark 惯例）——`` ```js title=x `` 识别为 JavaScript，`` ```c++ `` 命中 C++ 别名。`mermaid` 是刻意例外：渲染管线对标签**全等匹配**，多词 info string 不命中渲染管线。
- 无语言标记或 `text`/`plaintext`：卡片正常呈现，标签显示 `Plain text`，不着色。
- **未识别语言**：回退纯文本（卡片仍在；卡内行号仅 Live 发射，2026-10 起阅读侧不显示）。
- **token 类名**：以 `@lezer/highlight` `classHighlighter` 的 `tok-*` 稳定词表（如 `tok-keyword`、`tok-string`）为基础；解析器已有的函数调用修饰标签经 `tagHighlighter` 叠加 `tok-function`，保留原 `tok-variableName` / `tok-propertyName` 类供旧片段命中。两视图共用；配套 CSS 色板以主题 class 区分明暗。
- **配色**：内置明暗两套共享色板，基础取色自用户提供的 VS Code 明暗主题导出与 Python 逐词检查；函数调用色按用户选择改为与紫色关键词相配的暖黄（浅色 `#806000`、深色 `#DCDCAA`），不再沿用导出主题的紫色函数色。所有已注册语言复用同一 Lezer `tok-*` 类别配色，不承诺逐语言复刻 VS Code 语义 token（模块身份、只读变量等需要语言服务信息）。随现有明暗主题管线（`EditorView.darkTheme` facet + body class）自动切换。高对比档口径（评审 A-2 订正）：**深色高对比（dark+HC）**函数色覆盖为深色淡黄，**浅色高对比（light+HC，VS Code 1.77+）**回落浅色组暖黄（白底可读）；HC keyword 蓝为旧版既有行为（不分深浅），非本批承诺面。卡片外壳（背景、行号、标签、分隔线）继续走 `--vscode-*` 主题变量。
- **新增词类配色（#389）**：INI section 的 `tok-meta` 为浅色 `#0550ae` / 深色 `#79c0ff`；diff `tok-inserted` 为浅色 `#22863a` / 深色 `#85e89d`，`tok-deleted` 为浅色 `#b31d28` / 深色 `#f97583`。INI 仅在 properties 模式内映射 section/key/value 到既有 meta/propertyName/string 词类，不改 Markdown 的 heading 外观；diff 新增/删除词类补色，现有 keyword/string/comment 等配色保持不变，裸 `.tok-*` 用户片段仍可覆写。
- **文件后缀与围栏标签分离（#389）**：`CodeLanguageEntry.extensions` 显式维护可读文本后缀，不再从语言 id/别名派生。既有分类保留；新增语言只收真实文本后缀（如 `.cs`、`.kt`、`.jl`、`.proto`），`.jsonc`/`.json5` 明确收录为文本，既有 `.sql`/`.pgsql` 保留；`.sqlite`/`.sqlite3`/`.db` 仍归 other，SQL 方言围栏标签不自动改文件分类。无扩展名的 `Dockerfile`、`Makefile` 仍归 other，不扩大发现规则。
- **完整围栏上下文（#389）**：阅读侧 60 行挂载片共享完整围栏的数值边界；`createReadingBlockElement` 通过弱引用绑定文档及片偏移，正文与 Markdown hover/embed 走同一增强路径。先挂后片也从完整源码解析，再裁切到本片；文档编辑/刷新产生新的上下文。超过 4096 个代码体行先降级，再决定是否读取完整代码体，不能按每片行数绕过降级；未闭合围栏在 EOF 的尾部空行按原始 token 范围计入预算，不受块呈现裁尾影响。未超限围栏正文按共享身份最多缓存 64 项，token 仍复用既有 64 项 LRU；不在每个分片存放完整代码体。每片复制、折叠与按视口挂载沿用现有语义（卡内行号 2026-10 起阅读侧不发射）。
- **引用形态边界**：Markdown 悬停与嵌入复用 token 路径，但仍保持既有只读朴素代码块，不增加正文卡片工具条。高亮开关变化沿现有挂载对象就地刷新已挂载引用的 code token；不重新装载或解析整份引用，不重建图片、属性区监听或嵌套引用，滚动与属性区展开状态保留。非 Markdown 引用的宿主原生着色、Mermaid 渲染、#368 主题研究均不改。
- **词法边界**：使用锁定 `@codemirror/legacy-modes` 6.5.4 的语言模式及 C#/Kotlin/Dart、SCSS/LESS 专用配置。Tcl 兼容层仅修正普通双引号（含转义引号、跨行字符串）被上游误标 comment 的分支，其余 token 仍交给官方模式；不承诺完整语言服务、补全、诊断或执行。
- **SQL 方言（#391）**：`sql` 仍为 StandardSQL；`pgsql`/`postgres`/`postgresql` 独立路由 PostgreSQL，`mysql`/`sqlite` 分别采用锁定 `@codemirror/lang-sql` 6.10.0 的实际方言，缓存按独立语言 id 隔离。[上游定义](https://github.com/codemirror/lang-sql/blob/main/src/sql.ts)中 SQLite 的 `identifierQuotes` 只含反引号与双引号，本地通过 `SQLDialect.define({...SQLite.spec, identifierQuotes: ...})` 仅追加 `[`；其 tokenizer 已有 `[` → `]` 终止分支。按 [SQLite 官方引用规则](https://www.sqlite.org/lang_keywords.html)测试空格标识符及闭括号后的 `FROM`，保留原词表和其他配置，不声称覆盖所有服务端版本或容错引用规则。引用标识符沿用 `tok-string2`，无全局调色。
- **JSON 方言（#391）**：`json` 继续使用未改动的官方 Lezer JSON。原创 `jsonDialects.ts` 只负责词法高亮：JSONC 接受双引号属性/字符串、JSON 十进制数、`//`/`/* */` 和尾逗号；JSON5 另识别 Unicode/`\uXXXX` IdentifierName 属性、单引号、转义换行、字符转义、带符号十六进制、前后小数点、正号与 Infinity/NaN。对象/数组上下文区分 propertyName 与 string/value；注释不丢失待冒号状态；JSONC 不把 JSON5 专属 key/string/number 着色为合法词类，数字按完整 atom 匹配避免合法前缀误着色。[VS Code JSONC 说明](https://code.visualstudio.com/docs/languages/json#_json-with-comments)与 [JSON5 1.0 规范](https://spec.json5.org/)是词法依据，非复制第三方实现，无新增依赖、运行时下载或执行入口。
- **JSON 词法限制**：这些模式不是 JSON/JSON5 校验器；不诊断 schema、重复键、逗号/冒号完整性或数值范围，不把 JavaScript 表达式、binary/octal/BigInt/数字分隔符纳入 JSON5。Unicode 属性名按运行时 Unicode 字符类别识别，不冻结某个 Unicode 版本。不闭合注释可延续至 EOF；普通未转义换行结束字符串状态，仅 JSON5 转义物理换行保留跨行状态。既有 StreamLanguage 长行限制及完整围栏 4096 行预算保持。正反例、Unicode/转义、恶意外观文本与跨分片续行均经公开高亮/渲染接口测试。
- **新增词法来源（#390）**：SPICE 控制变量、Makefile 嵌套引用/recipe、GraphQL 块字符串与 PHP tagged/plain 使用实测词法；来源、精确版本、许可和边界见[词法来源说明](code-language-sources.md)。PHP 的 heredoc 标签遗漏由小型 styleTags 适配补齐；不增加语言服务、运行时网络 grammar 或执行能力。
- **操作与设置评估（#389/#390/#391）**：只扩展现有围栏渲染，无新增用户操作、设置或快捷键；卡片/高亮现有独立开关不变。
- **语言徽标**：v1 为字形徽标（typographic badge）——等宽缩写 + 品牌近似色（`CODE_LANG_ICONS`），随头部标签显示，仅注册表内语言有徽标，未收录语言无徽标；矢量 logo 集为后续工单（体积与素材来源另行决策）。
- **性能**：Live 侧高亮按块计算并缓存，编辑仅重算受影响块；呈现态与编辑态均保持高亮；大围栏（10 万行档）不阻塞输入。

**体积红线**：语言包解包合计约 430 KB（`@codemirror/language` 已随 lang-markdown 在包内，不额外增），legacy-modes 按模式 tree-shake。**实测（#85）**：main.js 增至约 2.4 MB（语言包增量约 1.6 MB，预估的 0.4–0.5 MB 偏低——Lezer 解析表 minify 后仍大于解包体积占比的直觉）；VSIX 解压总量 4551 KB，单文件警告线 3 MB 未触线，总量距旧警告线 4.5 MB 余量仅约 57 KB——**用户决策（#85 验收）总量警告/上限各上调 1 MB 至 5.5 / 6.5 MB**，无需独立懒加载产物。后续增补语言包前仍需先核对总量余量（新警告线下约 1.06 MB）。


### #389 本地验证与体积记录（2026-10-07，未发布候选）

- 对照基线：v0.11.0 / `c16349acade8b17f2ebc1ec91c9de8c3746c3010`。19 项新增语言均使用已锁定官方模式，无新增依赖或运行时 grammar 下载。Tcl 字符串、INI 词类映射与 EOF 未闭合围栏预算均保留目标先红后绿证据。
- 最终本地 `compile`（含类型检查）通过；Vitest 全量 292 文件 / 6,643 测试通过，356.08 秒，退出码 0。Node 启动器/打包/浏览器调度/历史样式契约共 115 通过、6 项既有平台跳过、0 失败；严格文件树检查通过。日志为 `out/test/t01-complete-*.log`，含退出码。
- 历史样式基线复验通过（v0.4.0 / `75c3df7`）；候选八项契约检查零失败，保留旧 tok 类和全部既有颜色，只有 diff 新增/删除词类补色。0.10.0 / 0.11.0 发布快照尚未固化的既有提示仍记录，不改基线或门禁。
- 生产 Chromium `codeCardChrome` 正式完整套件通过，34.44 秒（`run-TYM7co` / `out/test/t01-reference-hot-toggle-browser.log`）：明暗主题真实文字/徽标颜色、模式切换、正文设置热更、跨 60 行词法状态、实际卸载重挂、4096/4097 边界、Markdown 引用与其已挂载高亮开关，未删断言或跳段。
- 已知测试环境日志：未改动的 suspendResume、lineNumbers、liveMath、liveMermaid、livePaintProbe 五文件会由 CodeMirror 捕获并记录 jsdom 缺少 Range.getClientRects 的测量错误；干净基线独立重跑 102 测试，逐文件计数同为 22/9/3/3/2，均退出 0，无未处理异常。新增设置回归使用本项目既有的零布局 shim，真实可见性另由 Chromium 证明。
- 精确生产体积：main.js 从 **2,144,296 B → 2,240,210 B**（+95,914 B，+4.47%）；实际 VSIX 解压总量从 **12,204,046 B → 12,304,446 B**（+100,400 B，+0.82%），仍为 314 文件。`inspectVsixEntries` 零错误、零警告；单文件低于 3 MiB 警告 / 4 MiB 上限，总量低于 13 MiB 警告 / 13.5 MiB 上限。本票无需新增懒加载产物，不调整阈值。
- **待验**：新增真实 VS Code 宿主集成用例与全部 browser 套件仍等待 draft PR 的 CI 执行；本地定向 Chromium 成功不等同真实宿主、全 browser 或远端完整验收通过。未关闭门禁、未合并或发布版本。

## 渲染型围栏（mermaid）

会被渲染成图形的围栏语言（当前仅 mermaid，用户验收反馈接入）与卡片系统的交界规则：

- **编辑态**（光标/选区触及围栏区间，含点击渲染图进入）：SVG 退场，走通用卡片路径——头部横带（标签 `Mermaid`）、卡内行号、复制按钮、折叠 chevron 齐全；无语法高亮（图表 DSL 不进语言注册表，自然无引擎、无徽标）。接入前此处是朴素围栏源码。
- **呈现态展开**：卡片零发射，专属渲染管线接管（整块 replace 为 SVG，#60 语义不变）——呈现态无头部，折叠入口在编辑态。
- **呈现态折叠**：卡片接管收起形态（头部保留 + 整块收起），SVG 让位；再点展开恢复渲染。折叠路径：编辑态点击 chevron → 光标离开后收起生效。
- **卡片总开关关闭**：折叠集清空，呈现态恒为 SVG（不会出现「SVG 与收起形态同时缺席」的空白）。
- **泛化点**：未来新增渲染型语言（图表 DSL 等）时，在 `shared/mermaid.ts` 的 `RENDERED_FENCE_LABELS` 登记显示名，并在围栏标志判定同步扩展。
- **共享状态位置**：卡片配置 facet、复制/折叠 effects 与折叠 field 位于 `src/webview/codeCardState.ts`（中立模块——mermaid 装饰感知折叠态需要单向依赖，避免与 liveCodeCard 循环引用）。
- **已知交互语义**：点击渲染图的落位依命中元素而异（SVG 背景区 → 光标落围栏起点进入编辑态；节点图形上 → 可能落到区间之外保持渲染）——CM6 replace widget 的坐标 snap 行为，非稳定契约，不据此断言。

## 设置（扩展设置页，#33 链路）

| 设置键 | 类型 | 默认 | 语义 |
| --- | --- | --- | --- |
| `codeblock.card` | boolean | `true` | 卡片总开关：关闭回到朴素围栏外观（现行源码形态） |
| `codeblock.lineNumbers` | boolean | `true` | 卡内行号（依附卡片；卡片关闭时无效。仅实时预览生效——阅读视图 2026-10 起不发射卡内行号，该键对阅读侧无操作） |
| `codeblock.copyButton` | boolean | `true` | 复制按钮（依附卡片） |
| `codeblock.highlight` | boolean | `true` | 语法高亮独立开关：卡片关闭时朴素围栏仍可着色 |

设置页可切换、即时生效（Compartment 热重配）、重开回显；主阅读视图随同一设置联动。#389 修复已挂载正文阅读卡片的设置回填：仅 card/highlight/copyButton 的实际配置变化会原地增强直接挂载块，不重解析 Markdown（lineNumbers 2026-10 起对阅读侧无操作，不参与比较）；保留滚动、折叠、折行和源文，不把嵌套的朴素引用代码块升级成卡片。引用高亮通过原有挂载对象同步就地刷新，始终保持朴素形态。

## 阅读视图

- 围栏代码块渲染为同一卡片契约：头部（标签/图标/复制按钮）、`tok-*` 高亮（与 Live 同一类名与色板）。**卡内行号 2026-10 起阅读侧不发射**（用户产品决策，与引用内容先例统一——对齐 Obsidian 阅读视图形态）。
- 阅读卡片内边距（2026-10-08 观感调整）：代码区横向内边距加倍为左右 24px（上下 8px 保持），头部横带左右同步 24px——行号退场后文本直接从内边距起笔，左右对称。朴素形态（卡片关闭）维持基础 8px 12px，Live 不受影响。
- 与阅读侧既有结构协同：块级虚拟化按需挂载（挂载钩子内做增强）、大围栏 60 行分块、`data-vsidian-src-*` 锚点不变。跨片行号 data 属性（`data-vsidian-code-start/total`）已随行号退场移除，分片后续判定改由 `codeContext` 承担（`readingFind.ts` 的 sourceProjection——续片片首无围栏行）。
- 复制走同一宿主剪贴板消息路径。

## 稳定样式入口

新增稳定类名（登记入 [选择器映射表](../design/obsidian-selector-map.md)）：`.vsidian-code-card-line`、`.vsidian-code-card-edge-top/-bottom`、`.vsidian-code-card-header`（含 `-label`/`-actions`）、`.vsidian-code-card-copy`（`-done` 修饰）、`.vsidian-code-card-fold`（`-collapsed` 修饰）、`.vsidian-code-card-wrap`（`-off` 修饰，仅阅读侧发射，#191）、`.vsidian-code-card-linenumber`（仅实时预览发射，2026-10 起阅读侧不再发射——类名保留，Live 命中不受影响）、`tok-*` token 族；公开变量 `--vsidian-code-card-background`（默认回落 `--vscode-textCodeBlock-background`）。`--vsidian-code-indent`（#189/#191）为按块注入的内部对齐/悬挂缩进基准（Live 行装饰 attributes；阅读侧 2026-10 起不再注入），无公开变量承诺。

## 已知限制与语义

- **整卡悬停显现的瞬态丢失（live，#190）**：光标进出块或状态切换导致头部 widget 重建时，若鼠标未再移动则头部上的显现类随旧 DOM 消失（复制钮退回隐态），下次鼠标移动即恢复——瞬态，可接受取舍（2026-09-28 决议）。
- **整卡悬停显现的视口卸载边界（live，#190 评审落档）**：块高超过视口加 CM6 视口余量（默认约 1000px，触达约 80–110 行、随视口高度与行高浮动）时，悬停块中下部深处，头部 block widget 已被视口虚拟化卸载——`cardHeaderFromTarget` 反查不到头部，显现类无处挂载；此时头部横带本身也不在视口内（CM6 既有渲染机制，非本批引入），悬停头部等旧路径同样不可用。滚回块顶即恢复。
- **折叠集残留边角**：折叠围栏 A 后，一次性删除「A 开围栏行起至紧邻围栏 B 起始行前」的内容时，B 可能继承折叠收起态——折叠集只随 ChangeSet 做位置映射、不做围栏表修剪（「消费点以围栏起点查询」是已声明取舍，见 `codeCardState.ts` 头注释），删除后 B 的起点可能恰好等于残留的映射位置而命中。纯视图态，重开文档恢复全展开。
- **编辑态点击折叠钮/热区预挂折叠集**（既有链路语义，#190 评审落档）：光标在块内（编辑态）时点击折叠钮或头部热区，折叠集立即记入该块但编辑态不呈现收起（`isFolded` 判定含 `!editing`）；光标移出围栏区间后装饰重建、块方才收起。折叠按钮自 #82 起即此语义，#190 热区扩大使该入口更易触达——行为保留（编辑态折叠钮同款），如需「编辑态点击即时收起」另行开票。
- **卡片按钮回调的定位依赖**：复制/折叠按钮点击回调经 `EditorView.findFromDOM` 从头部 widget 根反查视图，依赖 CM6 当前版本 widget Tile 携带的内部标记（非公开 API 承诺面）——升级 `@codemirror/view` 大版本时须把「卡片按钮点击」列入回归清单。
- **阅读视图大围栏分片的复制边界**：60 行分块是阅读虚拟化的挂载单位，每片有独立头部与复制按钮——复制只得该片的代码体，不做跨片聚合（聚合与按需挂载/卸载语义冲突，接受为已知行为）；卡内行号 2026-10 起阅读侧不发射（跨片连续契约随之退场）。
- **未闭合大围栏的闭围栏启发式**（复核登记，前置既有）：阅读分块的闭围栏探测（`readingBlocks.ts` 的 `hasClose` 启发式）对「未闭合且末行恰以围栏标记开头（如末行 ```text）」的超长围栏会误判有闭围栏——该末行不显示，高亮预算的 fence.totalLines 与内容截断同源同错（该字段自 2026-10 起仅服务高亮预算，与行号显示无关）。触发需 >60 行未闭合围栏且末行形态特殊，极边角。
- **未注册多词 info 的标签措辞微差**（复核登记，前置既有）：两视图对未注册语言的标签显示粒度不同——live 显示 trim 后全文（如 `mermaid x`），阅读显示类名提取的首词（如 `mermaid`）；语言路由已统一首词，仅未注册时的标签措辞有此微差。
- **行号关闭态无悬挂缩进**（#191）：卡内行号关闭时 `--vsidian-code-indent` 为 0px（Live），悬挂缩进两式自动无操作——该态折行续行仍退到行内容盒左缘（无行号区可窜，视觉可接受）；已知限制，非承诺行为。阅读侧 2026-10 起恒为此形态（卡内行号退场，续行顶格）。
- **折行开关不跨会话、不进设置**（#191）：关闭折行是阅读视图的视图态（与折叠 chevron 同语义），重开文档回到默认折行；Live 无开关（恒折行，编辑器级 facet 无法按块关）。
- **nowrap 行号遮罩已退场**（2026-10 历史记录）：sticky 行号的两层遮罩与行盒延展规则随阅读侧卡内行号退场一并移除；nowrap 态现为纯横向滚动（头部横带在 pre 外不滚动）。

## 验证与测试边界

- 单元：卡片装饰纯函数（围栏识别、控制域判定、行号序列、语言路由/别名）+「增量 == 全量」对拍 + CSS 契约测试钉关键规则（2026-10 起另钉：阅读卡片恒无行号节点与 indent 注入、分片不再落位行号 data 属性）。
- 集成：`PaintProbe` 的 `code` 节（绘制层断言：卡片可见性、头部、行号——阅读侧断言为空序列、按钮分态）；光标进出零写回用例沿用 #60 模式；设置链路（切换、生效、回显）用例沿用 #33/#34 模式。浏览器 `codeCardChrome` 钉阅读侧无行号 + 折行几何顶格对齐。
- 浏览器（合并前必跑）：光标进出代码块的原生键盘输入、折叠块键盘导航、复制按钮点击（Playwright 原生事件驱动）。
- 性能：`node test/perf/runPerf.mjs` 增代码块密集档；VSIX 体积经 `npm run release:check` 核查（#85）。
- 人工验证：[manual-verification.md](manual-verification.md) 二十一节 A35/A36。
