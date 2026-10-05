# 原生文字外观复用探针（#335 / P3-03）

日期：2026-10-04 ｜ 工单：[#335](https://github.com/ONEGAYI/vsidian/issues/335) ｜ 父票：#228 ｜ 下游：#340（P3-08 文本着色实施）

## 结论

**路线成立但有差异**：本地 Windows（1.82.3 真宿主）的完整原生文字外观复用路线——语法（TextMate）＋语义 token＋主题（含 include 链与用户自定义）＋字体字号——经探针实测成立，且全部颜色值与原生一致；差异集中在 Remote SSH 场景的结构性可达性（评估结论，未实测）、语义命令通道的韧性约束与少量主题形态边界，逐条列于[差异清单](#差异清单需-340-前用户表态)，其中第 1、2 条需要用户明确接受或决策后 #340 才放行对应场景。

> 探针性质：本文所有「与原生一致」的断言，指探针产出的 token/scope/颜色/字体值与 1.82.3 渲染管线的**同源数据**一致——渲染侧 TM 颜色本身就由 vscode-textmate 9.0.0 计算（见[关键源码事实](#关键源码事实1-1823-渲染侧的-tm-颜色走-vscode-textmate-库自身匹配)），探针用同版库同管线复刻，并以 webview CSS 变量、主题 JSON 已知值两条独立通道交叉验证；未做像素级截图对照（`workbench.action.screenshot` 命令在 1.82.3 不存在，实测报错记录在案）。

## 探针构成与复现步骤

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 启动器 | `test/integration/runAppearanceProbe.mjs` | 复用 `test/integration/testHost.mjs` 真宿主框架（独立便携目录、报告落盘）；**不传 `--disable-extensions`**（内置语言/主题扩展必须在场），第三方 grammar 经 `bin/code.cmd --install-extension` 预装 |
| 宿主内套件 | `test/integration/appearanceProbe/index.ts` | S1 扩展清单 → S2 languageId → S3 设置 → S4 主题解析 → S5 TM 引擎 → S6 语义命令 → S7 韧性 → S8 未保存版本 → S9 webview 绘制 |
| 引擎封装 | `test/integration/appearanceProbe/textmateEngine.ts` | vscode-textmate 9.0.0 + vscode-oniguruma 1.7.0（与 1.82.3 宿主锁定版本一致） |
| 纯逻辑模块 | `themeResolution.ts` / `tmScopeMatcher.ts` | 主题链解析（JSONC/include）、用户自定义合并、语义选择器（官方实现移植，无 vscode 依赖） |
| 单元测试 | `test/unit/appearanceProbeLib.test.ts` | 16 例：匹配语义、JSONC、include 序、语义选择器（含 Windows 盘符回归） |

```bash
npm ci
node esbuild.mjs && npx tsc --noEmit
npx vitest run test/unit/appearanceProbeLib.test.ts   # 16/16
node test/integration/runAppearanceProbe.mjs          # 两轮真宿主，退出码 0
```

产物：`docs/research/data/appearance-probe-<label>.json`（对照矩阵数据，随仓库提交）；`.vscode-test/appearance-probe-<label>.log`（完整宿主报告，本地留存，`.gitignore` 排除）。

两轮矩阵：`dark-custom`（Default Dark Modern + tokenColor/semanticToken 自定义 + `[typescript]` 语言级字体覆盖）、`light-default`（Default Light Modern 纯默认）。

## 关键源码事实（1）：1.82.3 渲染侧的 TM 颜色走 vscode-textmate 库自身匹配

这是本票最重要的路线判断依据。VSCode 1.82.3 的 `textMateTokenizationFeatureImpl._updateTheme` 把扁平化后的 `colorTheme.tokenColors` 直接传给 vscode-textmate 的 `setTheme`——**原生编辑器的 TM token 颜色由库内 theme 匹配（trie + 特异性排序）计算**，不是 `tokenClassificationRegistry` 的 `nameMatcher`（后者只服务语义默认回退与 inspect 面板）。

推论：探针与 #340 用同版库 + 同一扁平规则序即可与原生**同算法**，无需自研匹配器。扁平规则序（`colorThemeData.tokenColors` getter）：

1. 默认规则（无 scope，foreground = `editor.foreground`、background = `editor.background`）；
2. 主题链 tokenColors（include 先、own 后）；
3. 用户 `tokenColorCustomizations`（分组在前、`textMateRules` 在后）。

特异性语义实测：主题的 `keyword.control` 规则**覆盖**用户宽泛的 `keyword` 自定义（`import` 保持 #C586C0）；用户具体规则 `variable.other.readwrite.alias` 无主题竞争规则时**生效**（`join` → #FF00FF）——两者都是原生同构行为。

## 关键源码事实（2）：语义 legend 与 token 都有公开命令

1.82.3 `extHostApiCommands` 注册（源码核实 + 实测通过）：

| 命令 | 入参 | 返回 | 实测 |
| --- | --- | --- | --- |
| `vscode.provideDocumentSemanticTokensLegend` | Uri | `{tokenTypes, tokenModifiers}` | TS：12 types / 6 modifiers |
| `vscode.provideDocumentSemanticTokens` | Uri | `{data: number[]}`（5 元组增量编码） | 18 tokens，UTF-16 坐标 |
| `vscode.provideDocumentRangeSemanticTokens(Legend)` | Uri, Range? | 同上（区间） | ok |

Legend 可公开获取，无需 hook provider 注册。语义层解析链（官方移植）：用户 `semanticTokenColorCustomizations`（含 `[主题 settingsId]` 分组，实测 `[Default Dark Modern]` 生效）→ 主题 `semanticTokenColors` → 语义默认（按默认注册表 probe scopes 回退解析 TM 规则）→ TM 层。

## 数据可达性核实（本地 Windows 实测）

| 数据 | 途径 | 结果 |
| --- | --- | --- |
| `TextDocument.languageId` | 公开 API | typescript / python / toml（第三方）/ plaintext，全对 |
| 当前主题名 | `workbench.colorTheme` 设置 | 可读；**值是主题 id（settingsId）**，如 `Default Dark Modern`，不是显示 label `Dark Modern`——匹配 `contributes.themes` 时须按 id |
| 字体字号 | `getConfiguration('editor', doc)` | 全局与 `[typescript]` 语言范围覆盖均正确读取（Cascadia Code@20 vs Consolas@14） |
| tokenColor / semanticToken 自定义 | `getConfiguration('editor')` | 原始对象可读，含主题分组键 |
| 已装扩展清单 | `vscode.extensions.all` + `packageJSON.contributes` | 91 个扩展、52 个 grammar 扩展、10 个主题扩展 |
| grammar/主题文件 | `extensionUri.joinPath(path)` + node fs | 全部可读可解析（Windows 盘符路径实测） |
| 第三方 grammar | `be5invis.toml`（TOML Language Support 0.6.0，engines ^1.8）经 marketplace CLI 预装 | source.toml 7 色着色正常 |

注意两个实现陷阱（首跑实证后修复并配了单测回归）：

- **主题文件是 JSONC**（注释 + 尾逗号），`JSON.parse` 直接炸，需字符串感知的剥除；
- **Windows 盘符路径**下 include 相对路径拼接不能产出 `/d:/...` 根相对错位路径。

## 主题链与对照矩阵

include 链实测（加载顺序，include 先行）：`dark_vs.json → dark_plus.json → dark_modern.json`（3 层，65 条 tokenColors）；亮色对称（64 条）。`semanticHighlighting` 主题声明 true；用户设置默认 `configuredByTheme` → 生效。

对照矩阵代表数据（完整数据见 `docs/research/data/appearance-probe-*.json` 的 `textMate[].sampleTokens`）：

| token（scope 尾） | Dark Modern + 自定义 | Light Modern | 与原生一致 |
| --- | --- | --- | --- |
| `import`（keyword.control.import.ts） | #C586C0 | #AF00DB | 一致（主题已知值） |
| 注释主体（comment.line.double-slash.ts） | #6A9955 | #008000 | 一致 |
| `join`（variable.other.readwrite.alias.ts） | **#FF00FF（用户自定义生效）** | #001080 | 一致 |
| 字符串（string.quoted.single.ts） | #CE9178 | #A31515 | 一致 |
| 纯文本（plain.txt，无 grammar） | #CCCCCC = editor.foreground | #3B3B3B | 一致（恰 1 色） |
| toml 表名（entity.other.attribute-name.table.toml，第三方） | #9CDCFE | #E50000 | 一致 |

TS 12 色 / Python 11 色 / TOML 7 色 / plaintext 1 色（暗轮）；明暗两轮 webview 各 **87 个 span 的计算色全部与管线解析一致**。

语义覆盖样本（暗轮 15 个双源样本，7 个语义层改写最终色）：`greeting`→#00FFAA（用户 variable 规则）、`sample`→#00C8FF（用户 `[Default Dark Modern]` parameter 分组规则）；其余落语义默认（probe TM scopes）或 TM 层。

## 独立交叉验证

1. **webview CSS 变量 vs 主题解析**：`--vscode-editor-foreground/background` 实测 rgb(204,204,204)/rgb(31,31,31)（暗）、rgb(59,59,59)/rgb(255,255,255)（亮），与探针主题链解析的 #CCCCCC/#1F1F1F、#3B3B3B/#FFFFFF 完全一致——主题读取管线（含 include 合并）被主题服务的实际生效值反向验证。
2. **TM/语义双源一致性**：同一 token 位置两个独立层（vscode-textmate 引擎 / TSLS 语义命令）覆盖互证，18 个语义 token 均落在真实文本上（UTF-16 坐标可回切文本）。

## 韧性验证（实测）

| 场景 | 行为 | #340 侧要求 |
| --- | --- | --- |
| 无 provider（Python/TOML/plaintext） | 命令返回 undefined | 纯文本呈现，不算降级（原生同样无） |
| provider 抛错 | 命令 rejected（错误透传） | 按本次失败处理，不渲染错版 token |
| provider 延迟 5s | **公开命令无超时，会等满** | 消费侧自设上界（探针 3s race 实测可控放弃） |
| provider 注销（扩展更新近似） | 命令回 undefined | legend+tokens 每次成对重取即无陈旧缓存 |
| 目标未保存编辑 | version 1→2：TM 立即覆盖新行；语义延迟约 1.5s 后覆盖 | token 必须与 doc.version 配对校验，不匹配丢弃重取 |
| provider 变更通知 | `onDidChangeSemanticTokens` 仅 provider 自己持有，消费者无公开事件 | 版本驱动重取（打开/编辑/失效时） |

实现坑（首跑实证）：`tokenizeLine2` 会**合并同样式的相邻 token**（一行 14 个 v1 token 只产出 8 对 v2 数据），按下标配对会系统性错色——必须按位置区间查样式（`textmateEngine.ts` 已实现并留注释）。

## 字体与行号

- 语言范围设置读取：`getConfiguration('editor', doc)` 正确合并 `[typescript]` 覆盖；webview computed `20px "'Cascadia Code', Consolas, monospace"` 实测生效（探针渲染断言）。
- `editor.fontLigatures`、`editor.lineNumbers`（on）可读；行号自绘即可对齐（无宿主障碍）。
- 字体可用性：webview 与编辑器同属工作台 Chromium，同一字体栈解析一致。

## Remote SSH 评估（单列待验，不冒充通过）

**未做远端实测**（本机无 Remote SSH 环境）。以下为源码证据 + 本地实测的评估结论：

- 1.82.3 `extensionRunningLocationTracker.filterByExtensionHostKind`：每个扩展宿主只收到分派给该侧的扩展描述；`ExtensionKind.UI = 1`（vscode.d.ts：「Extension runs where the UI runs」）。
- 本地实测 `extensionKind`：全部 10 个主题扩展、`vscode.python`、`be5invis.toml` 均为 `'1'`（UI）——无代码的 grammar/主题贡献扩展默认 UI 侧。
- vsidian 自身 `extensionKind: ["workspace"]`：Remote SSH 时扩展宿主进程在远端。
- 原生的 grammar/主题加载发生在**渲染进程（客户端）**（`textMateTokenizationFeature` 是 workbench 服务），与扩展宿主位置无关——这正是原生远端高亮正常的原因，也意味着**扩展宿主侧复刻管线在远端缺客户端资产**。
- 推论（待远端实测确认）：远端宿主读不到客户端安装的主题文件；`workbench.colorTheme` 设置值本身可读。grammar 侧视语言扩展安装位置（有 main 的语言扩展多装远端、其 grammar 随之可达，但纯 grammar 无代码扩展默认 UI 侧）——两类都需实测。

远端验证清单（供后续补测）：

1. 真实 Remote SSH 会话内在远端宿主执行探针 S1/S4：`vscode.extensions.all` 是否可见主题扩展、extensionUri 是否指向不可读的客户端路径；
2. 远端装 Python 扩展（workspace 侧）时 grammar 文件可达性；
3. 语义命令在远端宿主的可用性（TSLS 装远端，理论可达）。

缓解选项与取舍（#340 前需用户表态）：a) 接受远端降级（纯文本/仅前景色）——与「原生有高亮不能静默降级」的门禁冲突，须用户显式接受；b) 新增客户端辅助扩展做客户端侧解析——产品形态变更，票面要求先报告；c) 等上游提供公开通道——无时间表。

## 差异清单（需 #340 前用户表态）

1. **Remote SSH 结构性差异**（见上节）：本地路线全绿，远端待验且评估为不可直接复用；采取何种缓解是用户决策，不是技术细节。
2. **语义命令韧性约束**：公开命令无超时、无变更事件——#340 必须自设超时上界与版本配对（探针已验证可行模式），属实现约束而非视觉差异；若不加约束会出现错版 token，票面验收项已覆盖。
3. **tmTheme plist 形态主题**：`tokenColors` 指向 tmTheme plist 文件的主题（`loadThemeChain.unsupportedPlistTokenColors`）探针未解析——内置主题不触发，第三方 tmTheme 主题可能触发；#340 需补 plist 解析或对该形态显式降级提示。
4. **`defaultThemeColors` 补丁未实现**：主题无 `token.info-token` 规则时 VSCode 会追加一组 legacy 兜底 token 颜色，探针未实现——仅影响「完全无 tokenColors 的主题 + legacy token scope」场景，常规主题不受影响。
5. **截图留证不可用**：`workbench.action.screenshot` 在 1.82.3 不存在（实测 `command not found`）——影响测试证据形态（token/颜色值对照已足够），不影响功能路线。
6. **行为细节同构确认**：用户宽泛 textMateRules 自定义会被主题更具体规则覆盖（特异性优先）——原生同构，但对「用户以为自定义必生效」的预期需要在 #340 的文档/说明中交代。

## 给 #340 的接线提示

**锁定依赖清单**（进生产 `dependencies`，当前为探针 devDependencies）：

- `vscode-textmate@9.0.0`（与 1.82.3 宿主锁定版本一致；TM 匹配算法即原生算法）
- `vscode-oniguruma@1.7.0`（onig WASM；扩展宿主 Node 端 `loadWASM(Buffer)` 实测可用）

**管线**（探针模块可直接复用，均为无 vscode 依赖的纯逻辑，可挪 `src/host` 或 `src/shared`）：

```
扩展清单扫描（vscode.extensions.all + contributes）
→ 主题解析（colorTheme 设置=settingsId → contributes.themes 按 id 匹配 → JSONC 剥除 → include 链）
→ 扁平规则（默认 → 主题链 → 用户自定义）→ vscode-textmate setTheme
→ tokenizeLine（scopes）+ tokenizeLine2（颜色，按位置区间配对，勿按下标！）
→ 语义层（legend+tokens 成对命令、自设超时、doc.version 配对、失败回退 TM 层）
→ webview 着色（span color + 语言范围字体 + 自绘行号）
```

**失效与刷新**：`onDidChangeConfiguration`（`workbench.colorTheme`、`editor.tokenColorCustomizations`、`editor.semanticTokenColorCustomizations`、语言范围 `editor.font*`）→ 重走主题解析；文档版本变化 → 重取语义 token；扩展安装/卸载（grammar 集变化）→ 重扫清单。

**探针依赖去留建议**：保留 `vscode-textmate`/`vscode-oniguruma` 的 devDependencies 与探针套件（回归可重跑、复现步骤零成本）；#340 实施时把它们加入生产依赖并在 `release.mjs` 体积红线中登记。

## 明确边界

- 探针不进 VSIX（`test/` 产物、dev 构建入口），未改动任何生产代码（仅 `esbuild.mjs` 增加 dev-only 探针入口）。
- 诊断波浪线、插件额外装饰、行内提示不在本票范围（原生侧也非文字颜色，属四期外）。
- 本报告的「原生一致」以同源数据 + 双通道交叉验证为口径；最终像素级观感归人工验证清单（三期验收要求保留）。
