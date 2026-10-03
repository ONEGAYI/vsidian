# 默认编辑器守护（Markdown 关联抢占检测与一键改回）—— 共识定稿

> 状态：**共识定稿（待开票确认）**，2026-10-03。
> 本文档是「默认编辑器守护」设计访谈（grill 两轮，第一轮六题 + 决策点确认）的共识落点：第二节为决策记录，第七节为票面草稿，经用户确认后建票。
> 定名已定：**默认编辑器守护**（CONTEXT.md 已立词条）。

## 一、问题与目标

**问题**：其他扩展（如 vscode-office）以 `priority: "default"` 声明 `*.md` 的自定义编辑器。用户安装这类扩展后，VSCode 仲裁或用户选择会把用户设置 `workbench.editorAssociations` 中 Markdown 的关联写入其他编辑器 id，本扩展**静默失去默认编辑器地位**；且被抢占后打开 .md 不再经本扩展（当前 `activationEvents` 仅隐式 `onCustomEditor`，打开 .md 走别的编辑器时本扩展根本不激活），用户既难察觉也难自救。

**目标**：安装/升级（含降级）后的首次窗口启动主动检测一次，此后关联变化沿提示；宿主通知（VSCode 自带 toast）指名抢占者并支持一键改回；设置页常驻当前默认编辑器状态、守护开关与手动改回入口。

## 二、共识决策记录（2026-10-03 访谈）

| 决策点 | 裁定 |
| --- | --- |
| 检测载体 | 读 `workbench.editorAssociations` **合并生效值**（`get()`），不解析宿主内部状态 |
| 接管判定 | 键集（`*.md`、`*.markdown`、`**/*.md`、`**/*.markdown`）任一**存在且值 ≠ `onegayi.vsidian.editor`** 即接管；值为 `"default"`（内置文本编辑器）也算接管；全部无记录不算接管 |
| 提示范围 | 值为 `"default"`（用户明确选内置）也提示——一次为限兜底，安装了 Vsidian 的用户大概率想用 |
| 修复路径 | 一键合并写回 global 层 + 写后复查生效值 + 复查失败降级引导统一设置中心 |
| 时机模型 | 两层互补：主动层（版本锁门控）+ 被动层（配置变更监听，沿触发） |
| 版本锁 | globalState 持久化（不建文件）；与 `context.extension.packageJSON.version` **不相等即触发**（含降级）；写锁不依赖用户对通知的响应 |
| 拒绝记录 | 按抢占者 viewType 记（globalState）；仅压制该抢占者的**被动层**提示；换抢占者重新具备提示资格 |
| 升级绕过 | 版本变化触发的主动检测**绕过拒绝记录一次**（每版本至多一次）——主动升级是"仍想要它"的强信号 |
| 沿触发 | 被动层只在生效值**从"是我"变为"非我"**的变更沿提示，状态不变化不重复弹 |
| 守护模式 | 两态（提示开 / 关，默认开）；**不提供自动改设档**——静默改回越权 |
| 名称反查 | 进一期：扫 `extensions.all` 的 `contributes.customEditors` 匹配 viewType → displayName；查不到回退原值展示 |
| 写回键集 | `*.md`、`*.markdown` 常写（与 selector 一致）；已存在特异键非我则一并覆盖；**不新增不存在的特异键**（最小干预） |
| 设置页形态 | 常规页新组「默认编辑器」，委托组形态（「中文分词」同款）：状态行 + 守护开关 + 手动「设为默认」按钮（已是我时禁用） |
| 常驻激活 | `activationEvents` 增加 `"onStartupFinished"`（安装/升级后必经 reload/重启，首窗口激活即检测点） |
| 细粒度批 | 空窗口（无工作区）也检测；被动监听常挂（守护关闭仅更新状态行）；多窗口并发极端重复提示记边界不处理；主动层 toast 延迟约 1.5 秒避开启动通知密集期 |

## 三、行为规格

### 检测口径

- 生效值 = `workspace.getConfiguration('workbench').get('editorAssociations')`（合并 user/workspace 两层后的视图）。
- 接管判定与抢占者身份提为共享纯函数（输入生效值与键集，输出「未接管 / 接管（viewType）」）；键集常量集中定义，检测与写回共用单一事实源。
- 抢占者可读名：宿主侧扫 `vscode.extensions.all` 各扩展 `packageJSON.contributes.customEditors` 的 viewType 匹配取 displayName；反查失败回退直接展示关联值原文（本身即 viewType 字符串）。

### 修复路径（一键改回）

1. 基于 `inspect('editorAssociations').globalValue` 为基底合并（**不得**用 `get()` 合并值直接写回——会把 workspace 层值提升到 global 层）。
2. 键集处理：`*.md`、`*.markdown` 写为 `onegayi.vsidian.editor`；已存在的特异键（`**/*.md`、`**/*.markdown`）若值非我一并覆盖；不存在的特异键不新增；其他文件类型的映射原样保留。
3. `update(..., ConfigurationTarget.Global)` 写回后**复查** `get()` 生效值：已是我 → 成功确认通知；仍非我（极罕见，如 workspace 层覆盖 global）→ 降级引导：执行 `workbench.action.openSettings` 定位到该设置键，让用户手动处理。

### 时机模型（两层互补）

- **主动层（版本锁门控）**：激活时比较 globalState 版本锁与 `context.extension.packageJSON.version`，不相等（首装、升级、降级均含）→ 执行一次检测（可提示）→ 无条件写锁为当前版本。主动层 toast 延迟约 1.5 秒出现。
- **被动层（配置变更监听）**：`workspace.onDidChangeConfiguration` 过滤 `workbench.editorAssociations`，生效值发生**「是我 → 非我」的变更沿**时提示；守护开关关闭时常挂监听仅更新设置页状态行，不提示。
- 两层提示共用同一通知与修复链路。

### 防骚扰语义

- 拒绝记录按抢占者 viewType 存 globalState；同抢占者的被动层提示被压制，换抢占者（viewType 变化）重新具备资格。
- 版本变化触发的主动检测绕过拒绝记录一次——每版本至多一次主动提示。
- toast 自然超时（用户未选任何按钮）不记拒绝记录；沿触发保证接管状态不变期间不重复弹；同一时刻通知在途（in-flight）不重复弹。
- 守护开关（设置页「默认编辑器」组）整体关闭提示；关闭不影响状态行与手动按钮。

### 设置页形态

- 常规页新组「默认编辑器」，采用「中文分词」同款**委托组**（动态状态展示超出标准设置行能力）：
  - **状态行**：当前默认编辑器——Vsidian / 内置编辑器 / 其他扩展（可读名，回退原值）/ 无记录；
  - **守护开关**：提示开 / 关，默认开（两态）；
  - **手动「设为默认」按钮**：当前已是我时禁用；点击走修复路径同一逻辑。
- 设置项接入按「插件设置入口」约定执行：验证持久化、重开回显与变更生效。

### i18n

宿主通知（提示、按钮、成功确认、降级引导）、设置页状态行与开关文案全部经 `src/shared/locales/` 两语言包（`host.*` / `setting.*` 家族）与 `t()` 字典映射；两包键集 parity 由既有编译期契约把关。

### 边界与明确不包含

- **无记录竞争不检测**：associations 无 Markdown 记录时不提示。此场景下 VSCode 自身行为（1.82 实证）：多个 `priority: "default"` 竞争同一 glob 时，打开 rank 最高者（同 rank 时 glob 更长者胜）并弹官方冲突警告（Configure Default / Keep 二选一）——用户至少被官方问过一次，主动层不与该通知重复。
- **Keep 盲区（已知边界，不承诺覆盖）**：用户在上述官方警告中点「Keep {他者}」后，选择记入 profile 级 storage、不写 associations 设置——此后宿主不再提醒，守护也检测不到（无记录 = 未接管）。若对方 glob 更长（如 `**/*.md` 对本扩展 `*.md`），用户实际打开体验已被抢而两端皆静默。此盲区无公开 API 可观测，明确不包含。
- **不反杀 workspace 层**：写回后复查失败（workspace 层同 key 占用）不做"写更长 glob 反杀"（长度排序下可行但属过度工程），降级引导统一设置中心。
- **多窗口并发**：不做去重（见实施注意点）。
- **不做自动改设档**、不接管 `.markdown` 以外的关联键。

## 四、现状事实（实施依据）

- `viewType` 为 `onegayi.vsidian.editor`，selector 声明 `*.md` + `*.markdown`，`priority: "default"`（package.json `contributes.customEditors`）。
- `activationEvents` 当前为空数组（仅隐式 `onCustomEditor` 激活）——须增加 `"onStartupFinished"`。
- 宿主通知先例：`showInformationMessage` + `t()`（cssSnippets pause/resume、indexMaintenance 等同模式）。
- globalState 持久化先例：SettingsService、KeybindingService、CssSnippetService（版本锁与拒绝记录同模式）；Remote 场景 globalState 属当前宿主机器（ADR-0007 环境隔离观察），本地窗口与 Remote 窗口各自版本锁、各自首装语义。
- 设置页委托组先例：`wordSegmentSettings`（#239「中文分词」组）。
- 测试通道：`_test.*` 注入命令仅 `VSIDIAN_TEST_HOOKS=1` 时注册、宿主侧门控。
- `workbench.editorAssociations` 官方口径（已按 VSCode 1.82.0 tag 源码逐项查证）：
  - 设置 ID 自 1.49 引入起即 `workbench.editorAssociations`，从未用过其他名；1.57 起值形态为数组改对象（glob → 编辑器 id）；
  - UI「Configure default editor for ...」写入的 key 形态为 `*${扩展名}`（即 `*.md`）；内置文本编辑器的值为字符串 `"default"`；自定义编辑器的值即 `contributes.customEditors` 的 viewType；
  - 多 key 匹配同一文件时按 **glob 字符串长度降序**取第一个（`**/*.md` 胜 `*.md`），这是特异性仲裁的全部规则；
  - 作用域为默认 WINDOW scope，**可写在 workspace settings**；运行时合并语义为 workspace 条目先铺底、user 条目仅在同 key 未被占用时补入，不同 key 两边都参与长度排序——即 workspace 层同 key 覆盖 user 层，这正是修复路径"写后复查生效值"要兜住的情形。

## 五、实施注意点（风险）

1. **常驻激活成本**：`onStartupFinished` 使扩展从"打开 .md 才激活"变为每窗口常驻（启动完成后异步激活，不阻塞启动）；启动性能影响在实施票以既有性能档位复核口径确认。
2. **写回分层**：必须以 `inspect().globalValue` 为基底合并（第四节修复路径第 1 步），防止把 workspace 层值提升到 global。
3. **键形态脆弱性**：associations 键集是宿主实现细节（非稳定 API 承诺），检测与写回共用同一常量事实源，不得散落字面量。
4. **多窗口并发**：globalState 跨窗口无原子性，两窗口同时首见版本变化极端下可能各弹一次——已知边界，不做去重。
5. **版本比较**：主.次.修三元组数值自实现，不引 semver 依赖；非三段形态（如预发布后缀）按前三段数值比较，退化时视为不相等（触发一次主动检测，宁可多提示一次）。
6. **纯宿主逻辑 + 设置页委托组**：无 webview 编辑器呈现变更，不触发 style-contract 流程；设置页新增组的 UI 接线与回显验证按「插件设置入口」约定执行。

## 六、测试与验收

- **单测（共享纯逻辑）**：
  - 接管判定矩阵：无记录 / 已是我 / 值 `"default"` / 值他人 / 多键混合 / 仅特异键存在 / 键存在但值为空；
  - 写回值构造：合并保留无关映射 / 只动目标键 / 不新增不存在的特异键 / global 层为空时新建；
  - 版本比较：相等 / 升 / 降 / 多段数字 / 退化形态；
  - 拒绝记录语义：同抢占者压制 / 换抢占者放行 / 版本变化绕过一次 / 每版本至多一次。
- **集成（真宿主 1.82.3）**：`_test.*` 注入命令读守护状态（当前判定、版本锁、拒绝记录）；写回路径经隔离 profile 的真实 settings 验证 associations 值变化与复查闭环；toast UI 交互进人工验证。
- **人工验证清单**：真宿主装 vscode-office → 抢占 → 重启触发提示 → 一键改回生效（打开 .md 默认进 Vsidian）→ 拒绝后同抢占者不再提示 → 模拟升级（版本号变化）后重新提示一次 → 设置页状态行与手动按钮闭环。

## 七、票面草稿（待建票）

标题：`feat: 默认编辑器守护——检测 Markdown 关联被抢占并在安装/升级后提示一键改回`

```markdown
## 需求（共识已定稿：docs/specs/default-editor-guard.md）

其他扩展（如 vscode-office）抢占 Markdown 默认编辑器后本扩展静默失效且不再激活。
落地默认编辑器守护：

- **检测**：读 workbench.editorAssociations 合并生效值，键集（*.md、*.markdown、
  **/*.md、**/*.markdown）任一存在且值非本扩展即视为接管（值 "default" 也算）；
  抢占者经 contributes.customEditors 反查可读名，失败回退原值。
- **时机两层**：globalState 版本锁与当前版本不相等（首装/升级/降级）→ 首次激活
  主动检测一次；此后 onDidChangeConfiguration 沿「是我→非我」变更沿提示。
- **修复**：inspect().globalValue 合并写回 global 层（*.md/*.markdown 常写、已存在
  特异键覆盖、不新增），写后复查生效值，复查失败降级引导统一设置中心。
- **防骚扰**：拒绝记录按抢占者 viewType 压制被动层；换抢占者重新提示；版本变化
  主动检测绕过拒绝一次（每版本至多一次）；toast 超时不记拒绝。
- **设置页**：常规页「默认编辑器」委托组——状态行 + 守护开关（两态默认开）+
  手动「设为默认」按钮（已是我时禁用）。
- **激活**：activationEvents 增加 onStartupFinished。
- **边界**：无记录竞争不检测（宿主官方冲突警告在场）；官方警告点「Keep {他者}」
  记入 profile storage 的静默盲区明确不覆盖；不反杀 workspace 层（降级引导）；
  多窗口并发不去重。

## 实施要点（风险）

1. 写回必须基于 inspect().globalValue 合并，防 workspace 层值提升到 global。
2. associations 键集为宿主实现细节：键集常量集中定义，检测与写回共用单一事实源。
3. 多窗口并发极端重复提示记已知边界，不做去重。
4. 版本比较主.次.修三元组自实现；退化形态视为不相等。
5. 设置委托组按「中文分词」组先例接线，回显与生效验证按「插件设置入口」约定。

## 验收

- 单测覆盖判定矩阵 / 写回构造 / 版本比较 / 拒绝记录语义全绿。
- 集成：注入命令读守护状态、写回路径真实 settings 生效与复查闭环。
- 人工：装 vscode-office 抢占 → 提示 → 一键改回 → 拒绝压制 → 升级再提示一次 →
  设置页闭环。
```

### 建票操作

- `gh issue create --title <上> --body-file <正文文件>`（[issue-tracker.md](../agents/issue-tracker.md) 约定，中文标题正文，多行正文写 UTF-8 文件）。
- 标签：建议 `ready-for-agent`。
- 建票后回填票号至本节；文档提交按 CI 敏感期处置约定（纯文档直推 main）。
