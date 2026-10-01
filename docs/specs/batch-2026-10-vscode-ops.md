# 2026-10 批次：VSCode 操作适配（搜索替换 / 多光标 / 中文分词）——批次总览

> 状态：**已开票**（2026-09-30，总览 #235 + 子票 #236–#240），实施待启动。本文档是本批次的实施树与共识落点；**随 #236 的实施 PR 落档仓库**，此后演化为批次总览。

## 0. 需求原文（2026-09-30）

1. 适配接入 VSCode 原生搜索和替换工具，替换现有自制搜索。
2. 多光标（alt+click）、上下分裂光标（ctrl+alt+arrow）、ctrl+D 自动选词（或已有选区）每次按下都选中全文下一处相同词；可和 VSCode 一样开关大小写敏感、全字匹配、正则——搜索工具同理（本就是原生搜索逻辑）。
3. 左右箭头+ctrl 分词加入中文分词支持。

约束：上述快捷键均为默认但可设置项；尤其注意和在途「预览、嵌入浮窗」功能（#217–#228，分支 `codex/hover-preview-embed`）的兼容性。

## 1. 事实基线（2026-09-30 四路调研）

### 1.1 VSCode 原生 find widget：字面接入不可达成需求功能集

对 `WebviewOptions.enableFindWidget`（公开稳定 API）在 1.86.2 时点的核实：

- **能力极其有限**：无替换 UI（构造传 `showCommonFindToggles: false`，Ctrl+H 对 webview 无绑定）、无 Aa/ab/`.*` 三开关、无匹配计数（`_getResultCount` 返回 undefined）、强制大小写不敏感（`matchCase` 硬编码 false）。
- **协议非公开**：查找请求走 workbench ↔ webview pre 脚本的内部消息（`find` / `find-stop`），不经过扩展与 `acquireVsCodeApi` 通道，扩展与 webview 页面 JS 均无法参与 query/结果回路；vscode.d.ts 零文档化。
- **致命伤：搜不全长文档**：底层是 Electron `WebFrameMain.findInFrame`（依赖 MS 自定义 Electron 构建，VSCodium 全废）搜 iframe 实际 DOM 文本，而 CM6 视口外文本不渲染——虚拟化长文档视口外匹配找不到，也无法与 CM6 选区/滚动联动。
- 高亮由 Chromium 原生渲染，不可控样式。
- 既有注释 `syncController.ts:6084`「custom editor webview 不可用 VSCode 原生 find 控件」的前提在功能层面依然成立。

**推论**：用户列举的功能集（替换、三开关、Ctrl+D 联动）只有自研 UI + CM6 引擎路线能达成，即「**对齐 VSCode 功能**」而非「字面接入 VSCode 部件」。此为 D1 决策点。

### 1.2 CM6 生态能力（@codemirror/search 6.7.2 dist 实测 + 已锁 @codemirror/commands 6.11.1）

- **搜索**：`SearchQuery` 原生支持 `caseSensitive` / `wholeWord` / `regexp` / `replace`；`search()` 扩展不含面板与 keymap，可纯外部驱动（`setSearchQuery` effect + `findNext/findPrevious/replaceNext/replaceAll/selectMatches` 命令）。两个坑：① 高亮仅在面板存在时渲染，纯外部驱动需自绘（可复用 vsidian findSession 双轨高亮通道：当前匹配 StateField 直接装饰 + 全部匹配视口间接装饰）；② query 无效时命令会 fallback 打开官方面板，外部驱动须先 dispatch 合法 query。体积约 11.7 KB gzip，新传递依赖仅 crelt（<1KB）。
- **多光标**：`addCursorAbove` / `addCursorBelow`（上下行插光标）**已在仓库已锁版本的 @codemirror/commands 内**，零新依赖；`simplifySelection`（Esc 收敛多选区）已在 defaultKeymap；`selectNextOccurrence`（Ctrl+D 等价）在 search 包。缺口：① `clickAddsSelectionRange` 默认修饰键是 Ctrl/Cmd 而非 Alt，需显式配置 `e => e.altKey`；② **仓库未启用 `drawSelection`**，Chromium 原生 DOM 选区单 range，多光标必须补装否则副光标不可见（`syncController.ts:7426` 注释自证）；③ `allowMultipleSelections` 目前只在符号包裹设置开启时随装（`symbolWrap.ts:324-329`），需解耦为多光标独立装配；④ 无「跳过当前」与 cursorUndo（Ctrl+U）对应物，需自写。
- **中文分词**：`Intl.Segmenter`（granularity `'word'`，ICU 词典分词，带 `isWordLike` 标志）在 chrome118 webview 确定可用、零体积；jieba-wasm 单 wasm 约 4.0 MB（对比悬殊）。VSCode 1.86 词移动对 CJK 无分词（连续中文整块跳过，字符分类器无 CJK 特判）——本需求是**超越 VSCode 原生**的增强。

### 1.3 VSCode 参考行为语义（1.86.2 源码核实，R1 追加核实于 multicursor.ts / findController.ts 原文）

- **Ctrl+D**（addSelectionToNextFindMatch）：`MultiCursorSession.create`——find widget 打开且 searchString 非空时沿用面板选项；否则选区给搜索词、面板选项给匹配设置；**唯一例外**是「单一空选区 + 面板未开」时按大小写敏感 + 全字匹配（`FindOptionOverride.True`）。（需求原文假设「默认大小写不敏感」不成立，VSCode 实际默认是敏感+全字。）
- **Ctrl+D 不展开完整查找面板**（R1 用户疑问核实）：`_beginSessionIfNeeded` 里 `state.change({searchString}, false)` 不带 `isRevealed`。用户观察到的「自动展开开关面板」实为 **`FindOptionsWidget`**——每次匹配前 `highlightFindOptions()` 在面板未开时于编辑器右上角短暂浮现开关状态小指示（面板已开则闪烁面板开关按钮），提示 Ctrl+D 会话当前实际使用的匹配选项（因为 override 档与面板开关显示可能脱节）。
- **会话生命周期**：选区变化、编辑器失焦、或用户切换面板 matchCase/wholeWord 开关都会结束 Ctrl+D 会话（下一次按下按新状态重建）；多选区文本不一致（按 matchCase 比较）时 Ctrl+D 不加选、改为把各空光标扩成词。
- **选项状态持久化**：matchCase / wholeWord / isRegex 经 storageService 按 WORKSPACE 级记忆，跨会话保留开关状态。
- **Ctrl+K Ctrl+D** = moveSelectionToNextFindMatch（跳过当前：去掉最后加的选区、光标移到下一处）；多光标撤销是 **Ctrl+U = cursorUndo**；Esc = removeSecondaryCursors。
- insertCursorAbove/Below：Win/Mac 默认 Ctrl+Alt+Up/Down。
- **查找替换完整键位表**（对齐参考）：F3/Shift+F3 下一/上一处（面板输入框聚焦时 Enter/Shift+Enter 等价）；**Ctrl+F3/Ctrl+Shift+F3 = 以选区文本为搜索词**找下一/上一处；Ctrl+H（Mac Cmd+Alt+F）打开查找+替换栏；替换一个 = Ctrl+Shift+1（面板可见时）或 Enter（替换框聚焦时）；全部替换 = Ctrl+Alt+Enter（Mac 替换框内 Cmd+Enter）；**Alt+Enter = 选中全部匹配**；**Ctrl+Shift+L / Ctrl+F2 = 选中全部出现处**（多光标族）；Esc 关面板。
- CM6 `selectNextOccurrence` 语义：恒大小写敏感、空选先选词、选区为完整词时候选也须整词、文档尾 wrap——与 VSCode 默认档接近但无选项联动与提示。

### 1.4 仓库现状

- **自制查找**（#14）：仅大小写一个开关；无全字/正则/替换；Live 双轨装饰 + 阅读块级高亮与源锚点定位（屏外匹配定位能力，原生部件无法覆盖）；纯只读契约（零写回零出站，测试锁定）。`findSession.ts` 唯一生产消费方是 `syncController.ts`（8 处织入点），退役/改造影响面清晰。
- **快捷键系统**：操作注册表三面同源（`keybindings.ts` + `keybindingRouter` + 宿主命令 + genNls），新增操作 8 步接入清单已备；设置页行列表由注册表派生，零改动自动出现。键位现状：Ctrl+F/F3/Shift+F3 已被自制 find 占用；Ctrl+D、Ctrl+Alt+Up/Down 未占用、语法合法；Ctrl+Left/Right 由 CM6 defaultKeymap 的 `cursorGroupLeft/Right` 掌管（拉丁分组语义，中文整段跳过即痛点来源）。
- **既有钉住的约束**：Tab 不得绑定命令（`keybindings.md:50`）；撤销/重做走专用 keymap 不进注册表；tabEscape 是「情境动作不进注册表」先例；find 三操作是「本地消化不转发宿主」先例。

### 1.5 在途预览/嵌入批次冲突面（#217–#228，分支未合入）

- 分支改动 `liveLinks.ts`(+79)、`liveDecorations.ts`(+38)、`syncController.ts`(+663)、`shared/keybindings.ts`（新增 `hoverPreviewLink` 操作）——本批次必动同文件，**预期合并冲突**。
- #221 Live 悬停预览默认 **Ctrl+悬停**（Ctrl 系鼠标语义变拥挤，但与 alt+click 无事件竞争）。
- #223 Live 嵌入显隐复用 `selectionTouchesRange`——多选区任一命中即显源码，语义天然兼容多光标。
- alt+click 与 `liveLinks.ts:799-832` 链接 mouseup 判定冲突（判定不看 alt 修饰键，alt+click 落在链接上会误触发跳转）——**真实冲突需修**；表格 `gridCellMouseSelection`/`clampGridCellPointer` 已在 altKey 时让路（`liveDecorations.ts:1722/1785`）；独行块级图片吞一切指针事件（#212 防误触契约）。
- Esc 队列现状：router 前缀取消 → quickHeadingMenu → find 面板 → 大纲/右键/重命名/拖拽/backlink/frontmatterPopover/图片弹窗/图表弹窗/悬停浮层 → CM6 `simplifySelection`。浮窗打开期间键盘被浮窗消费（夺焦模式），到不了 CM6——多光标 Esc 收敛天然排尾，无需插队。

## 2. 设计树（决策节点，R2 定稿）

```
批次根：VSCode 操作适配
├── D1 搜索路线 ──────────── [已定 R1] 功能对等自研升级：保留自研 Ctrl+F 面板，UI 升级为 VSCode 部件同款（三开关/计数/可展开替换栏），引擎换 @codemirror/search，选项状态与 Ctrl+D 共享
├── D2 替换范围 ──────────── [已定 R1] 纳入：替换栏 + replaceNext/replaceAll 操作 + Ctrl+H 默认键位；查找只读、替换为显式写操作（契约修订）；一次替换一笔撤销、全部替换一笔撤销
├── D3 Ctrl+D 语义与链 ───── [已定 R2] 对齐 VSCode 语义（空选默认敏感+全字、面板开沿用开关、切开关即重建会话）；呈现为「查找选项条」——仅三按钮的迷你浮动条，每次按下 Ctrl+D 都直接显示（会话期间在场、可点击切换），主查找面板打开时改为闪烁主面板开关不重复出条；跳过链 Ctrl+K Ctrl+D 纳入、cursorUndo 暂缓；Ctrl+Shift+L（选中全部相同词）纳入
├── D4 多光标装配 ────────── [已定 R1] alt+click（ctrl+click 被链接占用）；独立设置项默认开；allowMultipleSelections 与符号包裹解耦
├── D5 中文分词 ──────────── [已定 R2] 引擎用户可选：预设 Intl.Segmenter，jieba 可切换且资源经公共 CDN 按需下载不随包体；下载源默认 jsdelivr、设置页可选 npmmirror/自定义 URL；sha256 清单随扩展发布校验；宿主侧下载存 globalStorage（Remote SSH 在远程机执行），webview 经 asWebviewUri 加载；失败或离线回退 Intl.Segmenter 并明确提示
├── D6 多 range 写操作 ───── [已定 R1] 行内包裹类格式操作逐 range 改造随批次纳入；表格/结构性操作多 range 退化主 range 记边界
├── D7 批次顺序 ──────────── [已定，R4 更新] 引用视图一期已合入 main（PR #234），排序前提达成；已开票 #235–#240，与 #226–#228 后续分期无硬依赖，同文件相遇时后开工方 rebase
└── D9 拆票结构 ──────────── [已定 R2，R4 落地] 1 总览票（#235）+ 5 子票（#236–#240），见「开票清单」
```

## 3. 已定边界（事实或既有契约钉住，不设为决策点）

- **修饰键**：Live 正文 Ctrl/Cmd+click 已被「链接跳转」占用（CONTEXT.md 产品边界钉住），多光标添加选区只能是 **Alt+click**（恰与 VSCode 默认一致，无冲突）。
- **作用模式**：多光标、Ctrl+D、分词移动均为 Live 编辑能力（writes=true 类）；阅读模式只读不适用。搜索面板维持 both 模式（现有行为）。
- **查找选项状态**：单一事实源承载三开关（matchCase/wholeWord/regexp），查找面板与 Ctrl+D 同源消费；对齐 VSCode 按 workspace 级记忆（跨会话保留，实施时经插件自有设置存储）。
- **分词键位范围**：Ctrl+Left/Right 词级移动 + Shift 变体（词级扩选）纳入；Ctrl+Backspace/Delete 删词与 cursorUndo 同留后续票。英文/数字段移动语义保持现状，仅对连续 CJK 段做分词细化（既有边界不放宽）。
- **Tab**：不绑定任何新命令（keybindings.md 钉住）；Tab 越界对多 range 显式不接管的既有决策不变。
- **表格**：格区 region（矩形多格选区）与 CM6 多 range 正交，region 状态机内不加光标、region 存在时多光标操作退化为单选区语义；格内 alt+click 落点已由既有 altKey 让路逻辑保证。
- **图片**：独行块级图片吞指针事件（#212 防误触契约），图上不可落光标（含 alt+click），维持不变。
- **frontmatter 成型头区**：多光标/搜索替换不进入头区（frontmatterEditing 引导既有边界）。
- **Esc 队列**：浮窗（弹窗/浮层/菜单/面板）优先消费，多光标收敛（simplifySelection）排 CM6 层尾位，不新增队首插入。
- **阅读模式搜索**：保留现有块级高亮 + 源锚点虚拟挂载定位通道（原生部件与 CM6 引擎均无法直接覆盖阅读 DOM，自研通道是独有能力）；选项状态与 Live 共享。
- **i18n 与样式契约**：新 UI 文案走 locales 语言包；查找相关公开类名/变量变更须过 style-contract 技能流程（固定旧契约→兼容期→移除期限）。
- **引擎依赖**：新增依赖一律精确版本锁 lockfile；@codemirror/search 6.7.2 与已锁 view 6.43.13 / state 兼容已核实；jieba-wasm 资源不进包体（按需下载，见 D5）。
- **查找选项条细节**（D3 呈现形态）：仅含三开关按钮（大小写/全字/正则）的迷你浮动条，无搜索框、无计数；Ctrl+D 会话期间在场、可点击，切换即按新选项重建会话；会话结束（选区变化/失焦/Esc）淡出；主查找面板打开时不出现（闪烁主面板开关替代）。i18n 与 aria 状态随面板开关同源。
- **替换撤销语义**：替换下一个一次一笔撤销；全部替换整批一笔撤销（CM6 单事务天然满足）；替换期间光标/选区恢复遵循现有标准写回链路。
- **与在途批次的兼容钉住**：#221 Live 悬停预览 Ctrl+悬停与 alt+click 无事件竞争（mouseover 委托 vs mousedown/mouseup）；#223 嵌入显隐的 `selectionTouchesRange` 对多选区「任一命中即显源码」语义直接兼容；新浮层（查找选项条）不抢编辑器焦点，且与 `popupMutex` 弹窗槽位的关系在票 3 实施时明确（预期不占用模态槽位，属非模态指示）。

## 4. 明确不包含（本批次范围外，留作后续）

- **Ctrl+Backspace/Delete 删词**（写操作，分错词即删错段）与 **Ctrl+U cursorUndo**（CM6 无内置光标历史栈）——同留后续票。
- **查找历史下拉**（VSCode 搜索历史记忆）——现有自制面板无此能力，本批不新增。
- **查找范围**（find in selection，VSCode Alt+L）与 **preserveCase**（保留大小写替换）——VSCode 有，本批不含。
- **literal 转义开关**（CM6 SearchQuery 的 `\n\t` 转义）——用户面不暴露。
- **多光标修饰键切换**（VSCode `editor.multiCursorModifier` ctrl↔alt 切换）——ctrl+click 已被链接跳转占用，无切换空间，恒为 alt。
- **选上一处相同词**（VSCode AddSelectionToPreviousFindMatch，无默认键位）——命令面板级入口可随票 3 顺手提供，但不设默认键位；如不做亦不视为缺口。

## 5. 开票清单（已建票，2026-09-30）

总览票 1 张 + 子票 5 张：

| 票号 | 标题 | 正文要点（取自本文档对应节） | 依赖 |
|---|---|---|---|
| #235（总览） | plan: 2026-10 编辑器操作批次——查找替换重做、多光标、选词与中文分词总览 | 需求原文、共识决策 D1–D9 摘要、方向修正说明、子票清单 | — |
| #236 | feat: 查找替换重做——CM6 引擎、三开关面板与替换写回 | D1/D2：引擎换 @codemirror/search（外部驱动两坑的规避）、面板 UI 升级（三开关/计数/可展开替换栏/Ctrl+H）、选项状态单一事实源与 workspace 记忆、替换写回与撤销语义、阅读模式块级高亮通道保留、只读契约修订、键位族均入操作注册表；实施树与 CONTEXT.md 术语随本票 PR 落档 | — |
| #237 | feat: 多光标基础设施——drawSelection、独立装配与 alt+click | D4：drawSelection 补装、allowMultipleSelections 解耦独立设置默认开、`clickAddsSelectionRange.of(e => e.altKey)`、链接 mouseup 判定修复（liveLinks.ts:799-832 补 alt 排除）、addCursorAbove/Below 键位（Ctrl+Alt+Up/Down）、Esc 收敛验证、表格 region/图片/frontmatter 边界钉住 | — |
| #238 | feat: 选下一处相同词——Ctrl+D、选项联动与查找选项条 | D3：selectNextOccurrence 适配（选项联动改造）、空选默认敏感+全字、查找选项条（迷你三按钮、每次按下显示、会话期在场）、跳过链 Ctrl+K Ctrl+D、Ctrl+Shift+L 选中全部相同词、非模态关系钉住 | #236（软依赖 #237） |
| #239 | feat: 中文分词词级移动——Ctrl+左右箭头与可切换分词引擎 | D5：Intl.Segmenter 引擎、Ctrl+Left/Right + Shift 变体命令（仅 CJK 段细化，拉丁行为不变）、键位入注册表（mode live）、jieba 按需下载（jsdelivr 默认/npmmirror/自定义源、sha256 校验、宿主下载存 globalStorage、失败回退与提示）、设置页引擎切换 | — |
| #240 | feat: 多光标写操作兼容——格式操作逐 range 与批次收口 | D6：行内包裹类格式操作逐 range 改造、表格/结构性操作退化主 range、Tab 越界/列表延续等既有多 range 决策复核、批次测试收口（unit/browser/integration 三层 + 人工验证清单条目） | #237，批次最后 |

`ready-for-agent` 标签：#236 / #237 / #239（无前置依赖且票面完备）；#238 / #240 依赖前序票，依赖达成后再打。

## 6. CONTEXT.md 术语落档（随实施 PR 合并，预备阶段不改 CONTEXT.md）

> R3 用户决策：访谈预备阶段保持工作区干净，以下术语与批次记录**不提前写入 CONTEXT.md**，随 #236 的实施 PR 一并合并（本票为批次首个实施 PR）。词条全文与插入位置如下，实施时按此落档。

**领域语言节插入**（「安全降级」条之后，六条）：

- **多光标**：实时预览正文中多条光标与选区并行编辑的形态，三种入口——Alt+点击在指针处添加、「在上方/下方添加光标」（Ctrl+Alt+Up/Down，逐行添加）与「选下一处相同词」；Esc 一次收敛回主选区单光标。独立设置项默认开启，仅 Live 正文生效。避免称「分裂光标」——那是「在上方/下方添加光标」单项的口语说法，不指整族能力；避免与源码模式宿主编辑器的多光标混称。
- **选下一处相同词**：Ctrl+D 操作——无选区时先选中光标所在词，此后每次按下把按当前匹配选项找到的下一处相同词追加为选区并成为活动光标；Ctrl+K Ctrl+D 跳过当前（末位选区移到下一处），Ctrl+Shift+L 一次选中全部相同词。避免称「自动选词」——首次选词只是空选区时的种子行为，操作语义是追加选区。
- **查找选项**：大小写敏感、全字匹配、正则三开关的统称；查找面板与「选下一处相同词」共用同一状态，按工作区记忆跨会话保留。面板未开时的选词默认档为大小写敏感 + 全字匹配（对齐 VSCode）。
- **查找选项条**：「选下一处相同词」会话期间显示的迷你浮动条——仅三个开关按钮，无搜索框无计数；每次按下 Ctrl+D 都显示，会话期间在场、可点击切换；主查找面板打开时由面板开关闪烁替代。避免称「查找面板」——它是选项指示与快切入口，不是完整查找界面。
- **词级移动**：Ctrl+Left/Right 的词边界跳转（含 Shift 选区变体）；拉丁与数字段沿用既有分组语义，仅连续中文段经分词引擎逐词切分（预设浏览器内置 Intl.Segmenter，可切换 jieba——资源经公共 CDN 按需下载不随包体）。避免与源码模式宿主的词移动混称——宿主对中文无分词。

**批次记录节插入**（「三期考察」之前，一节）：

```markdown
## 编辑器操作批次（2026-10，访谈定档待开票）

2026-09-30 设计访谈完成（两轮），共识与实施树落档 [batch-2026-10-vscode-ops.md](docs/specs/batch-2026-10-vscode-ops.md)：查找替换重做（引擎换 @codemirror/search、三开关面板与替换写回，字面接入 VSCode 原生 find 部件经核实不可行已否决）、多光标三件套（Alt+点击、上下添加光标、选下一处相同词与查找选项条）、中文分词词级移动（预设 Intl.Segmenter，jieba 可切换且资源经公共 CDN 按需下载）。实施工单 #235–#240（2026-09-30 已开）。
```

## 7. 轮次记录

- **2026-10-01 验收修订**：用户确认阅读视图查找升级为字符级高亮，全部命中浅黄、当前命中深橙，callout/引用块只标命中文字。匹配计数仍忠实全文源码；隐藏的目标和图形源码不转标同词正文。旧阅读命中块类及块底色变量保留给片段，默认块底色透明。实施在 `readingFind.ts` 与 `readingVirtualView.ts`，绘制、重挂载及模式切换验证见 `test/browser/findPanel.mjs`；待用户验收记录见 `manual-verification.md` 的 2026-10-01 跟进节。
- **2026-10-01 隐藏源码反馈追加决策**：用户认可最小演示并同意接入阅读查找的只读源码浮层。当前匹配未完全呈现时显示所属源码行及精确字符标记，表格/图形保持渲染；fixed 浮层不占正文布局，动态显隐不移动下方段落，查找导航的定位滚动仍保留。不抢查找输入焦点、不写文档，关闭查找/切模式/离屏回收时清理；计数与成型 frontmatter 排除口径不变。实现入口 `readingFindSource.ts`，样式片段通过新增公开类与既有查找变量覆盖；自动化与人工待验见 `manual-verification.md` 同日隐藏源码反馈节。

- **R1（2026-09-30）**：事实基线四路调研完成；提出 Q1–Q6。
- **R1 答复（2026-09-30）**：Q1/Q2/Q4/Q6 同意推荐（D1/D2/D4/D6/D7 落定）；Q3 提出疑问「VSCode 按 Ctrl+D 是否自动展开开关面板」——已补核实源码（multicursor.ts / findController.ts）：不展开完整面板，浮现 FindOptionsWidget 选项指示，待 R2 细化呈现方式；Q5 给出新决策：引擎用户可选，预设 Intl.Segmenter，jieba 按需下载不随包体，下载通道待 R2 细化。
- **R2（2026-09-30）**：提出 Q7（Ctrl+D 选项呈现）、Q8（jieba 下载通道）、Q9（拆票结构 + Ctrl+Shift+L）。
- **R2 答复（2026-09-30）**：Q7 用户明确「每次按下都直接打开只有 3 个按钮的面板」→ D3 定稿为查找选项条（比 VSCode 的只读浮现指示更进一步：可点击、会话期间在场）；Q8 否决 GitHub Release（可达性差）→ 公共 CDN（默认 jsdelivr，可切 npmmirror/自定义）；Q9 拆票结构与 Ctrl+Shift+L 纳入确认。frontier 清空，共识达成。
- **R3（2026-09-30 用户决策）**：CONTEXT.md 不在预备阶段改动（保持工作区干净）——术语六词条与批次记录节挪入本文档第 6 节封存，随本批次首个实施 PR 一并合并落档。CONTEXT.md 已 `git restore` 复原。
- **R4（2026-09-30 开票）**：用户授权开票，并告知引用视图一期已合并（PR #234）。建票六张：#235 总览 + #236 查找替换重做 + #237 多光标基础设施 + #238 选下一处相同词 + #239 中文分词词级移动 + #240 多光标写操作兼容；`ready-for-agent` 打给无前置依赖的 #236/#237/#239。总览票已评论回填子票号。本文档随 #236 实施 PR 落档仓库。
