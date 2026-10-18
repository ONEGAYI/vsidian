# Vsidian 附加组件开发指南

状态：**公开 API 开发指南（2026-10-08 随 T13 #362 建立；当前发行 1.2.0）**。稳定 API 自 1.1.0（2026-10-16）起随 Vsidian 本体发行并提供兼容承诺（变更记录见仓库根 [CHANGELOG-API.md](../../CHANGELOG-API.md)）；SDK 包与独立示例仓库尚未提供。接口签名与逐条语义以[公开 API 参考](api-reference.md)为准（该文档从事实源生成，不手改）。

本文回答「一个附加组件从零到跑起来要做什么」：接入流程、两端代码形态、六组能力怎么用、去哪抄样例、怎么调试、版本怎么算。规则依据是 [ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md) 与[规格](../specs/vsidian-addons.md)；技术路线见[技术方案](../design/vsidian-addon-api.md)。

## 1. 附加组件模型速览

- **分发形态**：一个附加组件 = 一个 VSCode 扩展（自己的 VSIX），安装、卸载与扩展启停由 VSCode 管理；Vsidian 只管理组件在自己体内的注册功能与功能开关。
- **宿主位置**：首版要求组件宿主代码与 Vsidian 在同一扩展宿主运行（本机项目两者在本机，Remote SSH 项目两者在远端）。
- **两段生命周期**：`setup` 常驻设置能力（手动停用后仍可配置），`enable` 按用户功能开关装配运行功能。设置接入与运行功能分开管理。
- **页面代码**：编辑器页与设置页代码是独立浏览器 IIFE（目标 chrome114），由 Vsidian 的装载器按授权装载并注入 SDK。

## 2. 接入流程

### 2.1 清单声明（发现与安装）

组件在自己的 `package.json` 顶层声明私有字段 `vsidianAddon`，建议同时声明对 `onegayi.vsidian` 的原生依赖与 `workspace` 运行偏好：

```json
{
  "extensionDependencies": ["onegayi.vsidian"],
  "extensionKind": ["workspace"],
  "vsidianAddon": {
    "manifestVersion": 1,
    "api": "^1.0.0"
  }
}
```

- 没有该声明的普通扩展不进入组件列表；声明非法会保留状态与原因。
- `api` 是组件支持的**稳定 API 范围**（semver range 子集），必须包含宿主提供的稳定 API 版本才判兼容——不能用 Vsidian 本体版本代替。
- 使用实验入口（如 `experimental.cm6`）时另加 `experimental` 表声明兼容范围；宿主未提供的入口名会让整个组件判不兼容。
- `manifestVersion` 是身份声明格式版本（当前 1），与 API 版本无关。
- 语义细节见参考的 [`manifest-declaration`](api-reference.md#manifest-declaration) 与 [`compatibility`](api-reference.md#compatibility) 条目。

### 2.2 宿主代码（registerAddon 与两段生命周期）

Vsidian 激活后经 `extensions.getExtension('onegayi.vsidian').exports` 暴露导出 API。组件在自己的 `activate()` 中调用注册入口：

```ts
import type * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const vsidian = vscode.extensions.getExtension<{ apiVersion: string; registerAddon(...): ... }>('onegayi.vsidian')
    ?.exports
  vsidian?.registerAddon(context.extension, {
    setup(ctx) {
      // 设置能力（常驻）：定义、自己的设置页入口、设置通信
      ctx.settings.registerDefinitions([...])
      ctx.settings.registerPage({ entry: 'dist/settings.js', ... })
    },
    enable(ctx) {
      // 运行功能（按开关启停）：编辑器页面入口、运行通道
      ctx.pages.registerEditor({ entry: 'dist/editor.js', ... })
    },
  })
}
```

- 组件激活中即可调用（不要求 `isActive`）；VSCode 原生激活与 Vsidian 主动唤醒两条路径的校验一致。
- 同一接入代次重复注册返回 `already-registered`；手动重试先 `dispose` 旧句柄。
- 注册、初始化或回调中的**可归因异常**会触发全组件故障暂停（释放注册、保留偏好、设置页显示原因并提供手动重试）——普通 API 拒绝不算故障。
- 详见参考的 [`register-addon`](api-reference.md#register-addon) 与 [`addon-definition`](api-reference.md#addon-definition) 条目。

### 2.3 页面代码（构建桥与注入 SDK）

页面入口用构建辅助工具（SDK 构建桥）打成 IIFE，源码只需从虚拟模块 `vsidian-addon-sdk` 导入登记函数：

```ts
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '<主仓库>/src/shared/addonPage' // 或随 SDK 发布的声明

defineAddonPage('publisher.my-addon', (sdk) => {
  // sdk 即注入的页面 SDK：六个能力 facet + 装配/资源/通信/释放
  // 行为名：单语言字符串（历史兼容）或多语言映射（#464——按页面语言渲染）
  sdk.behaviors?.register({ id: 'auto-pairs', name: { en: 'Auto pairs', 'zh-cn': '括号补全' }, onInput(ctx) { /* ... */ } })
  // 行为禁用态只读面（#476，编辑器页与设置页均提供）：灰态实时同步
  const off = sdk.behaviorState?.onEnabledChange((state) => {
    // state.addonRunState: 'enabled' | 'user-disabled'；state.disabled: 本组件被禁行为局部 id 集
  })
  sdk.onDispose(() => off?.())
})
```

- **设置页上下文（#553，仅设置页提供）**：有自绘设置页的组件，详情打开即呈现自绘内容（平台外壳保留导航/作用域标签/总开关）。`sdk.settingsContext` 承接平台侧上下文——`scopeState()` 拉取当前作用域快照（`{ scope: 'user' | 'workspace', hasWorkspace }`），`onScopeChange` 订阅变化（返回退订）；`locateTarget()` 与 `onLocateTarget` 承接全局设置搜索的定位目标（`{ kind: 'def' | 'group', key }` 或 null 清除——订阅即回放当前挂起目标，页面装载晚于定位到达也能收到）。组件据此切自己的页内 Tab 并定位控件、并让自绘控件的显示值与写入目标（作用域层）一致，不读取平台私有 DOM。

- **行为名的多语言形态（#464）**：`name` 除单语言字符串外可传「语言键 → 名称」映射。键推荐小写 BCP47 连字符形（如 `en`、`zh-cn`），匹配时规整 trim + 小写；页面语言以 `zh` 开头的候选链为 `zh-cn` → `zh` → `en`，其余页面语言只试 `en`；全部候选缺失时取字典序最小的键的值兜底（非空呈现）。映射全链路透传（注册、上报、设置页目录均不预解析），**语言切换后已注册行为名即时跟随**。纯字符串是历史兼容形态，不随语言切换。映射条目上限 32、键规整后至多 64 字符、值与单语言同名口径（非空、≤256 字符）；规整后重复键（`zh` 与 `ZH` 共存）会被拒绝。**注册后不得修改传入的 `name` 对象（含映射对象）**——平台不复制注册载荷，修改会影响后续上报与呈现。`description` / `examples` 仍是单语言字符串（多语言形态后续另行演进）。

- 构建桥是 esbuild 插件：解析期注入 `vsidian-addon-sdk` shim（**不是真实 npm 包**——SDK 载体未发布，当前从主仓库测试夹具复制，见[示例仓库准备](example-repo-plan.md)）。
- 构建目标 chrome114（对齐下界宿主 1.82.3 = Electron 25）。
- **CM6 红线**：构建桥拒绝 `@codemirror/*` 值导入；共享 CM6 运行时须经 `sdk.experimental.cm6` 取得（该入口须在清单 `experimental` 声明）。产物含 CM6 运行时标记串即构建失败（双防线）。
- **cm6 暴露面**：`state` 与 `view` 是整模块命名空间（构造 StateField/ViewPlugin 等值对象）；`language` 是**语法树读取子集**（`syntaxTree` / `ensureSyntaxTree` / `syntaxTreeAvailable`，#406 起 1.1.0）——`LRLanguage`、`foldGutter`、`indentUnit` 等注册类成员不暴露，addon 不应借实验入口注册语言或改全局语言配置；树与节点类型经 `import type` 消费（构建桥允许 type-only）。
- **已知边界（重要）**：live 编辑器的 markdown 语法树是内核私有的增量解析，不经 `@codemirror/language` 的 language facet 装配——`syntaxTree()` 在 live 编辑器状态上**恒返回未解析空树**。行类型判定（代码块/frontmatter/表格等）类需求**不要依赖本入口**，改用平台级行类型查询面 `experimental.syntax`（#433，见下条与 §4.8）。
- **组件数据目录**（#404）：`ctx.storage` 提供安装目录外的隔离可写目录（`uri()` 显示/同步配置用；`<vsidian globalStorage>/addons/<你的组件 ID>/`）。富结构数据（规则对象、含正则与优先级的 JSON）归这里读写，不塞设置存储（一层嵌套边界）；相对路径用正斜杠，越界形态（`..`、绝对路径、反斜杠）一律 `invalid-path` 拒绝；单文件上限 8MB。**`list()` 对不存在的目录（含存储根未建——全新 profile 首启的常态）返回空清单而非 error**（#461：「未建目录 = 空存储」——init 探测可放心走种子路径；其余 IO 失败仍为 `error` 拒绝）。`onDidChangeFile(callback)` 监听外部变化——回调收 `(relativePath, kind)`，`kind` 为 `'change'`（改写或新建）或 `'delete'`（删除），同步工具改写/新建规则文件后自动重载；停用/故障/卸载不删数据（随 Vsidian 本体卸载清除，重装组件数据仍在）。页面侧组件代码经自己的 channel topic 桥接宿主读写。
- **动态代码（`new Function` / `eval`）不可用**：附加组件页面的 CSP 由平台配置且不含 `unsafe-eval`（`'wasm-unsafe-eval'` 仅覆盖 WebAssembly）——动态构造的替换逻辑在两个 webview 都会被 CSP 引擎拦截，且平台**不计划**为此放行。等价能力：替换函数写成组件代码内的真函数，规则文件只存声明性数据与函数引用（预注册变换函数表，评估见 [CSP 探针](../research/addon-csp-dynamic-eval-probe.md)，#405）。
- **视图身份反查（#426，实验）**：`sdk.experimental.viewIdentity.instanceIdOf(view)` 把 CM6 `EditorView` 反查为 views 面实例 ID（keymap/扩展回调消费；非平台实例返回 null）——清单声明 `experimental: { viewIdentity: '^1.0.0' }`，详见 §4.2。
- **行类型查询（#433，实验）**：`sdk.experimental.syntax` 提供位置驱动的单点语义查询——`lineTypeAt(instanceId, pos)` 返回八种行类型（`frontmatter` / `code` / `formula` / `table` / `heading` / `quote` / `list` / `text`），`inlineAt(instanceId, pos)` 返回位置级行内标记（`code` / `formula` / `none`）；成功结果附带 `nodeNames` 诊断载荷（祖先链节点名快照，**非稳定**——不构成兼容承诺）。**Live-only**：reading 态与 hover 只读视图拒绝 `read-only`，设置页不提供。查询 µs 级（平台侧组合常驻管线，无全文档扫描）。使用须在清单声明 `experimental: { syntax: '^1.0.0' }`，语义对照与口径细节见 §4.8。
- **标题折叠入口（#410，实验）**：`sdk.experimental.headingFold` 提供折叠区间查询与命令——方法按 `views` 面实例 ID 寻址（`folds(instanceId)` 有效折叠派生视图、`foldable(instanceId)` 可折叠全集；span 形状 `{ key, level, hideFrom, hideTo }`，LF 偏移、不含文本摘要）。命令面 `apply(instanceId, operation, options?)` 五操作（`fold` / `unfold` / `toggle` 选区驱动——先经 `views` 面 `setSelection` 定位；`foldAll` 可 `{ upToLevel }` 参数化、`unfoldAll` 全清）与 `foldAt` / `unfoldAt(instanceId, keys)` 按区间键批量组合（键来自查询结果，脱靶键静默忽略）。**Live-only**：reading 态与 hover 只读视图拒绝 `read-only`，设置页不提供该入口；折叠是视图态（零写回、不进撤销栈、不跨会话），编程触发与用户触发同链路。使用须在清单声明 `experimental: { headingFold: '^1.0.0' }`。
- **宿主设置读取（#457，实验）**：`sdk.experimental.hostSettings.get(key)` 同步读**白名单**宿主设置的当前生效值（首项 `editor.readingBreaks`——阅读渲染宽松换行，#423）。白名单外键拒绝 `invalid-key`（不开放任意 configuration 全量读取）；快照未达或键缺失回定义表默认值（与宿主渲染缺键同口径）。**拉取式跟随热更**：宿主保存设置后经既有广播更新页面缓存，组件**下次 `get` 即拿到新值**（无需重开面板）；首版不提供变更推送通知——需即时感知时在输入回调中重读。仅编辑器页提供（设置页 `undefined`）；不按视图模式门控（live/reading 均可读）。使用须在清单声明 `experimental: { hostSettings: '^1.0.0' }`。
- 装载器核对入口身份后调用工厂注入 SDK；组件只登记安装目录内的相对入口与资源子目录，越界路径被资源服务拒绝。
- **工厂允许 async 形态**（官方样例即「await 通道握手后再注册」）：装载结局按工厂同步段判定（返回 pending 的 promise 即报装载成功），但工厂 promise 的 rejection 会与同步异常**同路径归因 `factory-error`**——整代次立即回滚（`onDispose` 回调、扩展、命令等全部回收）并上报宿主触发全组件故障暂停；rejection 迟到（代次已被卸载或替换）则静默丢弃。工厂内部的长等待或驻留循环不会挂起装载指令流。
- 详见参考的 [`page-sdk`](api-reference.md#page-sdk)、[`page-bridge`](api-reference.md#page-bridge)、[`page-load-protocol`](api-reference.md#page-load-protocol)、[`heading-fold-experimental`](api-reference.md#heading-fold-experimental)、[`syntax-experimental`](api-reference.md#syntax-experimental)、[`host-settings-experimental`](api-reference.md#host-settings-experimental) 与 [`behavior-enabled-state`](api-reference.md#behavior-enabled-state) 条目。

### 2.4 页面语言（sdk.locale，#582，开发中）

编辑器页与设置页都提供 `sdk.locale`，组件用它选择**自己的**语言包。它与平台 UI 共用 `resolveLocale(general.language, vscode.env.language)` 的结果：显式偏好优先，`auto` 跟随 VSCode 显示语言。不要用 `navigator.language`、系统区域或裸宿主显示语言推测平台的生效语言。

```ts
import type { VsidianAddonPageSdk } from '<主仓库>/src/shared/addonPage'

function observePageLocale(
  sdk: VsidianAddonPageSdk,
  renderLabels: (language: string) => void,
): (() => void) | undefined {
  const locale = sdk.locale
  if (!locale) return undefined // 旧宿主缺此能力，由调用方选择明确的兼容策略
  renderLabels(locale.get()) // 首值；onChange 不立即回放
  const off = locale.onChange(renderLabels)
  sdk.onDispose(off)
  return off
}
```

- 当前正常快照为 `en` / `zh-cn`，类型为 `string`，为未来语言留口；组件遇到未支持代码时自行选用自己的默认词包。仅平台语言启动数据缺失/损坏时可为空串，与平台快照一致。
- 回调只在**生效语言代码变化**时触发，重复通知或同语言换包不触发；回调中 `get()` 已是新值。语言切换不重建组件工厂，更新现有文字节点即可保留输入、页签与其他组件状态。
- 返回的退订函数可重复调用；同一回调的多次订阅相互独立。平台在装载释放时自动清理订阅，释放后的迟到订阅无效；同步回调异常按组件故障上报，不阻断平台与其他组件的语言更新。
- `locale` 在声明上为可选，以兼容旧宿主及现有 SDK 结构。缺失时可保留组件明确配置的默认界面或提示升级，不能把浏览器语言当作平台语言；需要严格同语种时须要求支持本能力的宿主。
- 本能力尚未发行，不能据此宣称 API 1.2.0 已提供；下次本体发布需随新增能力升 API 次版本并正式落账。逐条契约见 [`page-locale`](api-reference.md#page-locale)，已发布记录不回填。

## 3. 能力分组速览

逐条签名、语义与验证定位见[公开 API 参考](api-reference.md)；此处只给「用哪组做什么」的路标（首版六组随 #362 批次落地，粘贴转换组自 #541 起追加）。

| 组 | 用途 | 关键入口 | 页面/宿主 |
| --- | --- | --- | --- |
| 发现与安装 | 声明身份、兼容、注册接入 | `vsidianAddon` 清单、`registerAddon` | 宿主 |
| 页面 SDK | 装载协议、视图/快照/文本提交、通道 | `sdk.views`、`sdk.channel`、`defineAddonPage` | 两端 |
| 输入行为 | 可组合输入处理 | `sdk.behaviors.register` | 编辑器页 |
| 输入行为 | 行为禁用态只读可见（灰态同步） | `sdk.behaviorState.enabledState` / `onEnabledChange` | 两端页面 |
| 页面 SDK（生效语言，开发中） | 组件文案与平台同步，原地更新且保留状态 | `sdk.locale.get/onChange` | 编辑器页与设置页 |
| 页面 SDK（设置上下文） | 详情自绘页的作用域对齐与搜索定位承接 | `sdk.settingsContext.*` | 设置页 |
| 设置 | 定义、读写、作用范围、设置页 | `ctx.settings.*` | 宿主 |
| 渲染提供者 | 代码块渲染候选与自动接管 | `sdk.renderers.register` | 编辑器页 |
| 命令/菜单/界面 | 命令、菜单项、按钮、面板 | `sdk.commands` / `sdk.menus` / `sdk.ui` | 编辑器页 |
| 粘贴转换 | 声明式粘贴规则：来源特化元素恢复为 Markdown 结构 | `ctx.paste.registerRules`（enable 生命周期） | 宿主 |
| 页面 SDK（引用） | 只读引用浮窗请求与本次请求关闭句柄 | `sdk.refViews.requestPopup` | 编辑器页 |
| 页面 SDK（引用） | 组件自有容器挂载只读引用视图与释放句柄 | `sdk.refViews.mountEmbed` | 编辑器页 |

几个高频语义提醒（完整版在参考各条目）：

- **编辑坐标**：全文 UTF-16 code unit 偏移、页面全程 LF；快照的 `revision` 覆盖页面未确认输入窗口——旧快照提交明确拒绝 `stale-snapshot`，不自动重试。
- **提交后选区**（#498）：`applyEdits` 的 `selection` 支持单对象（单选区，旧形态零迁移）与数组（多光标回设——多 ranges 随文本事务同笔原子生效，不坍缩其余光标；mainIndex 恒 0，对齐 `setSelection`；空数组拒绝）。边界校验逐 range 覆盖，越界整体拒绝 `invalid-request`；缺省不携带则保持实例现有选区重定位。
- **撤回边界**：`applyEdits` 默认原子（独立撤回）；声明 `joinPrevious` 则随同目标上次原子操作撤回，无可确认前项拒绝 `history-boundary`。撤销与重做归宿主文本管线。
- **目标归属**：操作始终归当前目标文档（在引用 B 中编辑不误改父 A）；按钮与面板回调收到的句柄由平台动态解析当前活动视图。
- **渲染接管**：新安装的兼容且已启用组件自动替换所支持语言的显示（含内置）；重启/重复注册/普通升级不当作新安装；组件仍运行而渲染有 bug 时平台不自动接管。
- **设置呈现形态**（#473/#475）：string 定义可声明 `enumLabels`（枚举档位显示标签——直值或 `{ 'zh-cn': '…', en: '…' }` 多语言映射，缺失标签回退枚举值本身，随设置页语言切换）与 `multiline: true`（渲染多行文本域，换行符参与持久化值）；`array<string>` 的自由文本项支持批量粘贴拆分（多行剪贴板逐行拆项：trim、空行丢弃、超长按 maxLength 截断——拼接结果同样截断，enum 项不适用；maxItems 不在控件层拦截，由保存时校验兜底——与手输一致）。`multiline` 仅自由文本适用，enum 定义（档位下拉）拒绝与它组合。两者仅作用呈现层，值校验与存储语义不变。
- **设置定义分组**（#472，引用式）：定义可选 `group` 字段引用组键，组元数据经 `registerDefinitions(defs, groups)` 第二参声明一次（`groups: [{ key, title, description? }]`，`title`/`description` 直值或 `{ 'zh-cn': '…', en: '…' }` 多语言映射——与 `enumLabels` 同构）。声明序即设置页呈现序；组键组件内唯一、定义引用未声明组键或组键重复**整批拒绝**。无分组声明的组件保持既有平铺（向后兼容）；未分组定义与功能开关行恒居首容器。定义级与组级条目进设置页全局搜索（命中跨组件定位——`addon:<组件 ID>/def:<定义键>` 与 `addon:<组件 ID>/group:<组键>`）；object 定义字段级不进。组声明随 `addons.settingsState` 既有链路透传，不新增消息通道。
- **详情自绘页优先**（#553）：有自绘设置页且未故障的组件，设置详情首屏即自绘内容（打开详情由平台自动装载，无「打开自定义设置页」操作）；基础设置表单转为详情内次级页签（定义注册/值校验/存储与清除覆盖入口保留）。作用域切换与搜索定位经 `sdk.settingsContext` 交付；无自绘页组件与故障暂停维持平台表单 + 排障块（重试成功后自动重新装载自绘页）。语义细节见[组件设置详情规格](../specs/addon-settings-detail.md)。
- **命名空间**：命令/菜单/按钮/面板的公开 ID 由平台注入 `<addonId>.<localId>`（局部 ID 禁点号）；不存在覆写、隐藏或接管内置菜单项的入口。
- **按键拦截与优先级**（#402，实验入口契约）：经 `registerExtension` 挂 CM6 keymap 有两层位置——**普通 keymap**（扩展槽为平台扩展数组末位，平台 Tab 三段/列表续行等情境链先试，addon keymap 在平台不处理时落空接手，适合 Tabout 兜底类）与**抢先层**（用 `Prec.high` 包裹——高于平台普通键位，可替代平台处理如智能退格；返回 `false` 即落穿平台链，透传语义）。**保留键面不可越过**：撤销/重做（`Mod-z` / `Shift-Mod-z` / `Mod-y`）是 `Prec.highest` 的平台保留键闸（撤销栈归宿主文本管线），addon 即便用 `Prec.highest` 也抢不掉（同为 highest 时平台闸在扩展序上先注册、先者先匹配）；Esc 与宿主级快捷键（`Ctrl+P` 等命令面板键不经编辑器）同理不开放抢先。多组件同层按键按装载顺序仲裁（先装载先试）；逐项关闭=停用组件（实验层 keymap 不进统一快捷键管理，稳定化路线另行设计）。
- **行为禁用态只读可见**（#476）：`sdk.behaviorState` 在编辑器页与设置页均提供——`enabledState()` 返回本组件快照（`addonRunState: 'enabled' | 'user-disabled'` + 本组件被禁行为局部 id 集），`onEnabledChange(cb)` 在宿主落库后即时通知（返回退订；组件释放时订阅由平台整组回收，不依赖自觉退订，查询仍返回最后已知快照）。宿主层开关（组件停用或单项禁用）与组件层开关（自己的规则配置）是两层独立开关，生效 = 两层都开启——组件页对宿主层任一为真的行为行可呈灰态；被停用后设置页不卸载，本面仍可查询与订阅。本面只读，无任何写入成员。
- **标题折叠**（#410，实验入口）：查询只读派生视图（原始键集不对外）；命令选区驱动三操作与全文档两操作共用用户触发执行体（effect 直驱）；`upToLevel` 仅 `foldAll` 接受（1–6 整数），其他操作携带即 `invalid-request`。
- **视图身份与扩展槽**（#426/#427/#428，契约）：扩展槽仅装配主正文 Live 实例；view → instanceId 反查走 `experimental.viewIdentity`；命令回调携带目标视图句柄——完整条款与移植换算见 §4。
- **行为链触发面**（#399/#400/#401）：普通键入（`input.type`）与删除白名单（`delete.backward` / `forward` / `selection` / `cut` / `line`——`delete.dedent` 属缩进命令族不纳入）驱动；IME 候选期不驱动，**组合定稿驱动一次**（`userEvent='input.type.compose'`、`inputText` 为净定稿文本；取消/空白格组合/代码上下文不驱动）。上下文 `inputText` 为插入侧净文本；`replaced` 携带替换/删除侧（键入替换选区 = 被替换内容，delete = 被删文本，事务前 LF 坐标，IME 定稿恒 null）；`docUri` 为当前目标文档 URI（多视图语义：embed 触发时是引用目标的 URI）。
- **粘贴转换规则**（#541 T01 + #542 T02，enable 生命周期）：`ctx.paste.registerRules([...])` 登记可序列化规则（标签/属性匹配 + 可选 `all/any/not` 条件树 + `{{槽}}` 模板或显式丢弃），身份由平台注入；整批校验（批内重复 ID、未知操作、非法正则、空条件组合、超预算——每组件至多 256 条声明，嵌套子规则计入——整批拒绝不部分安装）。取值槽支持元素文本、属性、子内容转换结果与正则捕获组（整匹/数字组/命名组；flags 限 `i/m/s/u`，注册时编译校验）。children 槽可声明嵌套子规则集（与顶层同一语言、ID 槽内局部；子元素先子规则后内置，只沿子节点下降）。有效规则广播到全部编辑器页面，在富文本粘贴的 HTML→Markdown 遍历中按优先级降序、组件 ID 升序、规则 ID 升序确定性执行：首条成功接管、单条失败继续、全部未成功回内置转换；内置 SCRIPT/STYLE 忽略与纯文本/代码上下文路径不经规则。停用/故障/代次结束撤回规则。预算集中定义：条件树与规则嵌套各至多 16 层、单条规则条件树至多 64 节点、单次粘贴求值步数至多 100,000（规则尝试/条件节点/正则执行各计一步）；正则为原生 RegExp（同步、单次执行不可中断——步数预算计执行次数不是超时），正则输入超 4,096 字符按必需取值缺失回退。未知字段显式拒绝，不静默当成已声明形态。

## 3.1 只读引用浮窗（sdk.refViews，T05）

请求内核在触发位置旁打开目标引用浮窗（T05 #544）。两句话分工：**看内容用 refViews，编辑目标用「打开独立文档」**——refViews 打开的是只读预览浮窗（单页单浮窗、随触发位置摆放、Esc/移出关闭）；要把目标文档开成编辑器面板，仍走宿主导航或用户自己的跳转链路，本面不提供打开/写入能力。

```ts
defineAddonPage(ADDON_ID, async (sdk) => {
  const refViews = sdk.refViews!  // 仅编辑器页提供
  const outcome = await refViews.requestPopup({
    source: 'main',                        // views 面实例 ID：相对路径按该实例目标文档解析
    target: { path: 'notes/ref.md', anchor: { kind: 'heading', heading: '第二章' } },
    trigger: myButtonEl,                   // 本页在树元素（组件自有控件或文字元素——脱树即拒绝）
    keyboard: false,                       // true = 键盘路径：焦点进入浮层，Esc 归还原焦点
  })
  if (outcome.ok) {
    // outcome.handle.close() 只关本次请求的浮窗（被替换/已关返回 false）
    // outcome.handle.isActive() 报告本请求浮窗是否在场
  } else {
    // outcome.reason：invalid-request / view-disposed / released
    // 或目标真实失败（not-found / escape / anchor-invalid / file-too-large …）
  }
})
```

语义要点（完整版见 API 参考 `ref-views-popup` 条目）：

- **目标与锚点**：路径 + 互斥锚点（`heading` 标题 / `block` 块 ID / `line` 行号 / `range` 行范围）。Markdown 目标用既有全文/标题/块语义；`line` / `range` 只对非 Markdown 文本生效（Markdown 目标携带时按标题原文解析——沿用双链行为，锚点缺失即真实失败）。大文件与超限走既有准入（`file-too-large` 等真实原因码）。
- **单页单浮窗**：新请求替换旧请求；旧句柄随之后失效（`close()` 返回 false，不误关后来的浮窗）。缺省鼠标语义零抢焦点；触发位置脱树、组件停用、页面关闭都释放实例。
- **只读边界**：本面创建的实例及递归内容恒只读，没有写端口；不给浮窗注入自定义 DOM 的入口。

## 3.2 只读引用组件容器嵌入（sdk.refViews.mountEmbed，T06）

在自己的面板或渲染内容里复用内核的只读引用展示（T06 #545）：`mountEmbed` 把内核引用卡片（与正文 `![[…]]` 嵌入同款装配）挂进**本组件已取得的容器**——`ui.registerPanel` 面板的内容根、`renderers.register` 生效容器，或它们的后代。展示请求零正文写入、零撤销项；要在正文里插入 `![[…]]`，仍由你已获授权的编辑 API 显式执行。

```ts
defineAddonPage(ADDON_ID, async (sdk) => {
  const refViews = sdk.refViews!  // 仅编辑器页提供
  const outcome = await refViews.mountEmbed({
    source: 'main',                        // 与浮窗请求同源：相对路径按该实例目标文档解析
    target: { path: 'notes/ref.md' },
    container: myPanelRootEl,              // 本组件面板内容根（或其后代）——脱树/非自有即拒绝
  })
  if (outcome.ok) {
    // outcome.handle.release() 撤下本次挂载（幂等；重复调用返回 false）
    // outcome.handle.isActive() 报告本次挂载是否在场
  } else {
    // outcome.reason：invalid-request / view-disposed / duplicate-mount / released
    // 或目标真实失败（not-found / anchor-invalid / budget …——错误就地显示在挂载位）
  }
})
```

语义要点（完整版见 API 参考 `ref-views-embed` 条目）：

- **容器归属**：只接受本组件自己的面板内容根或渲染内容根（可为其后代）；正文、其他组件的容器与平台管理的引用内容一律 `invalid-request`。平台在容器里创建并管理引用子根，不覆盖容器其他内容。
- **挂载仲裁与释放**：同一容器一次只属一次有效挂载（未释放前重复挂载 `duplicate-mount`）；句柄释放、容器或外层面板/渲染根卸载脱树、组件停用、页面结束都会整组释放（订阅、预算与内容实例彻底终结，迟到回包不重挂）。
- **同目标多处挂载**：解析缓存共享，实例/滚动/属性状态各自独立——一处释放不影响另一处。
- **只读与失效**：挂载的引用树及递归内容恒只读（无模式切换/保存/编辑入口）；目标更新沿既有 watch 通道刷新，删除/失效按现有分态就地显示，不生成写会话。

## 4. 视图身份与扩展槽（契约）

本节是跨六组能力的横向契约：视图实例如何被识别、扩展装配到哪些实例、以及移植 Obsidian 插件时的换算口径。变更这些条款视为契约演进（声明面版本 + 迁移说明），不得顺手改。

### 4.1 扩展槽装配范围（显式契约）

`sdk.registerExtension` 登记的 CM6 扩展**仅装配到主正文 Live 实例**（装载器聚合后经主正文控制器的附加组件 Compartment 槽下发）；嵌入（embed）与悬停（hover）视图不经装配——组件扩展在这些实例上不存在。

- 这意味着：keymap 等 ViewPlugin 回调当前只在主正文触发；但**不要据此把「回调的 view 一定是主正文」写成组件逻辑**——装配范围是平台实现契约，若未来扩展槽装配到更多实例，该推定会静默失效。需要实例身份时一律走 4.2 的反查面。
- 变更约束：装配范围变化（例如未来把扩展槽装到嵌入实例）属于实验入口 `cm6` 的语义变更，须随入口版本声明与迁移说明显式演进，组件会得到版本不兼容信号而不是静默行为漂移。

### 4.2 视图身份反查（experimental.viewIdentity）

keymap / 扩展回调拿到的是 CM6 `EditorView`，而按实例寻址的 API（`experimental.headingFold` 的 folds / foldable / apply 等）需要 views 面实例 ID。反查面补上这段换算：

```ts
defineAddonPage('publisher.my-addon', (sdk) => {
  const identity = sdk.experimental.viewIdentity
  sdk.registerExtension(keymap.of([{
    key: 'Enter',
    run: (view) => {
      // 回调 view → 实例 ID（'main' 或 'embed:<hostId>'）；非平台实例 null
      const instanceId = identity?.instanceIdOf(view)
      if (instanceId === null || instanceId === undefined) return false
      const folds = sdk.experimental.headingFold?.folds(instanceId)
      // ...
      return true
    },
  }]))
})
```

- 清单声明：`experimental: { viewIdentity: '^1.0.0', headingFold: '^1.0.0' }`（样例同时消费折叠入口，两入口都须声明；与其他实验入口同规则）。
- 身份由平台在实例注册进视图注册表时写入其编辑器状态；实例销毁即随状态消亡。未装配身份的 view 返回 `null`——组件据此自行降级。
- `instanceIdOf` 为闭包实现，无 `this` 依赖（解构引用安全，有单测钉住）；不过通用消费仍建议按 4.6 的接收者绑定口径书写。

### 4.3 命令回调的目标视图句柄

`sdk.commands.register` 的回调**携带执行时刻的目标视图句柄**：

```ts
sdk.commands?.register({ id: 'format', title: '格式化', mode: 'live', writes: true }, (target) => {
  if (!target) return            // 无活动视图（罕见）
  if (!target.info.editable) return  // reading 态等只读目标
  void target.editor.applyEdits({ /* ... */ })
})
```

- 解析口径：焦点在嵌入内部 Live → 该实例句柄；否则主正文；无活动视图 `null`。与界面面按钮回调（`onClick(target)`）同一解析。
- 组件侧不再需要 `document.activeElement` 焦点探针与「焦点视图不在登记表即拒绝」的防御链——平台保证句柄即命令语义的目标文档（在引用 B 中编辑不会误写父 A）。

### 4.4 折叠查询的调用成本

`headingFold.folds / foldable` 共享同一文档版本的派生缓存：同一版本内重复调用是 O(标题数) 的过滤，不做全文档重扫；文档编辑后的首次调用会重派生一次（与平台折叠箭头指示器共用）。**按键热路径可以直接消费，无需自建「行门槛」节流**。返回值为逐项拷贝，组件侧可自由持有与修改。

### 4.5 hideTo 与 Obsidian 上游的换算

`hideTo` 采用**下一标题行首**口径（换行符之后）；Obsidian / CM5 上游的折叠终点在末行**行尾**（换行符之前）——同一物理间隙的两侧。移植换算：

| 场景 | 上游行尾口径 |
| --- | --- |
| 区间被下一标题截断（常态） | `hideTo - 1`（回退一个分隔换行） |
| 折到文档末尾、文档以换行结尾 | `hideTo - 1`（尾随换行属隐藏区） |
| 折到文档末尾、无尾随换行 | `hideTo`（两者都等于文档长度，无换行可回退） |

判断式：`hideTo === doc.length && text[doc.length - 1] !== '\n'` 时不减一，其余减一。反向（把上游行尾换成本平台口径）对称加一。`hideFrom` 两侧口径一致（标题块行尾），无需换算。

### 4.6 SDK 方法的接收者绑定

调用 SDK 各面方法须**保持接收者绑定**：写 `sdk.views.list()`，不要解构后裸传引用（`const list = sdk.views.list; list()`）。平台保留以对象方法 + `this` 实现各面的自由；当前各面实现为闭包函数（解构实测可用，`viewIdentity.instanceIdOf` 已有单测钉住），但**不构成兼容承诺**——组件侧统一按接收者绑定或箭头包装书写最稳。

### 4.7 默认绑定的保留 Tab

命令**默认绑定**中，**裸 Tab 与 Shift+Tab 恒被拒绝**（注册期 `tab-forbidden`）：它们属于平台情境输入固定链（围栏越界 → 表格导航 → 行缩进），任何命令绑定都会破坏该链。**ctrl / alt / meta + Tab（可再叠加 shift）放行**——它们不参与情境链。注意宿主（如 VSCode 自身的标签切换）或操作系统可能占用个别修饰组合，注册成功不保证按键事件可达，选用前先在目标环境实测。

已知边界：**用户绑定通道（设置页键位捕获与存储）现状不拦截保留 Tab 段**——`tab-forbidden` 只存在于注册期默认绑定校验。是否为用户绑定补同款拦截另行评估（平台已知缺口，组件作者不应依赖该缺口给默认绑定之外的使用路径绑定裸 Tab/Shift+Tab）。

默认绑定另有**条数上限 4**（注册期 `too-many` 拒绝；协议守卫与宿主复验同款拦截）：按原始数组长度计数，归一化与去重不折抵。量级参照内置操作键位注册表最多双登记（跨平台 meta/ctrl 各一）的惯例，4 已是 2 倍余量。

### 4.8 行类型查询与 Obsidian 上游语义对照（experimental.syntax）

`experimental.syntax` 是位置驱动的单点查询（#433，#408 B+ 形态）：平台侧组合三条常驻管线（增量语法树、frontmatter 区间缓存、跨行公式块表）给出平台自有枚举，**不暴露树/节点句柄**——组件不需要也不应该自带 HyperMD→树映射表或全文档文本扫描。

```ts
defineAddonPage('publisher.my-addon', (sdk) => {
  const syntax = sdk.experimental.syntax
  // keymap 回调里：view → 实例 ID → 行类型（与 headingFold 同款寻址链）
  sdk.registerExtension(keymap.of([{
    key: 'Enter',
    run: (view) => {
      const instanceId = sdk.experimental.viewIdentity?.instanceIdOf(view)
      if (!instanceId || !syntax) return false
      const pos = view.state.selection.main.head
      const line = syntax.lineTypeAt(instanceId, pos)
      if (line.ok && line.kind === 'table') {
        // 表格行上的定制 Enter 行为……
      }
      return false
    },
  }]))
})
```

- **判定链（lineTypeAt）**：frontmatter 区间（行级）→ 跨行 `$$` 块表（**块级代码上下文内不命中**——块表是纯文本扫描、围栏与缩进代码内的 `$$` 文本同样进表，查询按块级代码守卫判字面代码，与 live 渲染抑制同口径；公式块内容含行内代码 span 不影响所在块的行类型）→ 树链枚举（code（围栏与缩进代码）> table > heading > list > quote，嵌套组合取先命中者）→ 单行闭合块 `$$x$$`（独占一行）→ 兜底 `text`。**inlineAt**：frontmatter → `none`（源码态）→ 行内代码 → `code` → 其余代码上下文 → `none`（`$` 为字面）→ 公式块表/当前行扫描 → `formula` → 兜底 `none`。跨行块与围栏交叉的畸形形态按位置局部语义（光标在围栏行判 `code`、块内普通行判 `formula`）。
- **与 Obsidian 上游的关键对照**（上游 `getPosLineType` / `detectRuleScope` 移植者必读）：
  - **frontmatter**：fm 判定是**文档头部 8192 字符的有界扫描**（与平台呈现同源）——超长头块按未识别降级为普通 Markdown，fm 行类型随之变化；fm 区间按**行级**判定（fm 结束行行尾仍属 frontmatter）。上游若在 fm 内判 `code` 等，移植时改为 `frontmatter` + `none`（fm 是源码态，无行内标记语义）。
  - **公式**：上游块级判定通常逐行扫描 `$$`；本平台跨行块表 + 单行扫描的口径差异——**段内形态 `text $$x$$ tail` 行类型是 `text`**（不是公式行；行内维度 `inlineAt` 在公式位置返回 `formula`），**单行闭合块 `$$x$$`（独占一行、内容非空）是 `formula`**；未闭合 `$$` 稳定降级 `text`。
  - **callout**：一期**不入枚举**——live 侧无 callout 识别管线，`> [!note]` 系列统一 `quote`。上游有 callout 细分语义的组件，移植时按 `quote` 处理或自判标记行。
  - **嵌套优先级**：引用内列表、列表内引用等组合按 code > table > heading > list > quote 取先命中者（如 `> - item` 的列表项内容处判 `list`、行首 `>` 标记处判 `quote`——链式下降按位置走，两种位置各判各的）。
- **pos 口径**：全文 UTF-16 code unit 偏移（页面全程 LF）；非负整数否则 `invalid-request`，超出文档长度**钳制到文末**（行尾是合法光标位）。
- **nodeNames 诊断载荷**：光标处祖先链节点名快照（根→叶）。**显式声明非稳定**——节点名随解析器升级变化，不构成兼容承诺；诊断用途（如观察平台树形态）可用，逻辑分支不要依赖它。fm 行的快照会如实包含树上反语义节点（如 `SetextHeading2`）——这正是它作为诊断载荷的价值。
- **Live-only**：reading 态主正文与 hover 只读视图拒绝 `read-only`（照 headingFold 先例）；设置页不提供该入口。

## 5. 消费样例入口

主仓库的测试夹具是当前最完整的消费样例（输入、渲染、界面三类及组合），全部经公开路径消费、不引用内部控制器：

| 样例 | 演示内容 | 源码 |
| --- | --- | --- |
| T02 主样例 | 两段生命周期、双页面入口、设置定义 | `test/fixtures/addon-v02/addon/t02Editor.ts`、`t02Settings.ts` |
| T06 编辑样例 | views 面、快照、提交、选区、joinPrevious | `test/fixtures/addon-v02/addon/t06Editor.ts` |
| T07 输入行为样例 | behaviors 注册与事件上报（**输入类样板**） | `test/fixtures/addon-v02/addon/t07Editor.ts` |
| T09 渲染样例 | renderers 注册、挂载、导出（**渲染类样板**） | `test/fixtures/addon-v02/addon/t09Renderer.ts` |
| T10 命令样例 | commands/menus、快捷键、负向对照 | `test/fixtures/addon-v02/addon/t10Editor.ts` |
| T11 界面样例 | ui 按钮/面板、目标句柄（**界面类样板**） | `test/fixtures/addon-v02/addon/t11Editor.ts` |
| T12 诊断样例 | 四通道故障注入与全组件暂停 | `test/fixtures/addon-v02/addon/t12Editor.ts` |
| 折叠样例 | experimental.headingFold 查询与命令（**实验入口样板**） | `test/fixtures/addon-v02/addon/foldEditor.ts` |
| 宿主设置样例 | experimental.hostSettings 白名单读取（**门控类样板**） | `test/fixtures/addon-v02/addon/hostSettingsEditor.ts` |
| 构建桥 | esbuild 插件与产物红线 | `test/fixtures/addon-v02/sdk/buildAddon.mjs`、`sdkBridge.mjs` |

夹具的驱动协议是「宿主夹具 ↔ 页面短轮询」（各文件头注有说明），真实业务里组件自行决定调用时机。

**独立消费样例（T15，2026-10-08 起）**：`test/examples/` 另有三套完整独立扩展工程（输入/渲染/界面——`input-behavior`、`renderer`、`ui-command`），只使用公开 SDK、可独立构建，是「从零写一个组件」的最佳参考（比测试夹具更贴近真实业务形态：无短轮询驱动协议、有自己的设置与 i18n 字典、共享构建脚本与产物扫描）。构建与复制清单见 [test/examples/README](../../test/examples/README.md)。

## 文档打开与定位（扩展批次 T03 / #543）

编辑器页面的 `sdk.views.openDocument()` 接收有效来源视图 ID、相对目标路径和可选定位；设置页不提供此面。导航可从 Live、阅读态、嵌入或悬停引用发起；在 A 的引用 B 内调用时，以 B 的目录解析路径。

```ts
const result = await sdk.views?.openDocument({
  sourceInstanceId: 'main',
  target: 'notes/target.md',
  locate: { kind: 'line', line: 3 },
})
```

`target: ''` 表示来源文档自身。定位可选 `line`（1-based 正整数）、`heading` 或 `block`（块 ID 不带 `^`），只能选择一种；标题与块定位仅用于 Markdown。Markdown 通过 Vsidian 打开或重显并保留模式，其他可读文本通过原生编辑器打开；图片/PDF 不属于本 API。

结果分别报告 `opened` 与 `located`。首次行号越界不钳到末行；锚点未命中、定位未送达与文件缺失有不同失败原因。来源释放、页面重载、组件停用或换代后在途请求失效；调用方自行呈现失败，平台不重复弹通知。结构化 API 不接受普通链接尾部行号语法。签名与失败枚举见参考的 [`document-navigation`](api-reference.md#document-navigation) 条目，公开消费夹具为 `test/fixtures/addon-v02/addon/docNavEditor.ts`。

## 6. 调试

调试复用 VSCode 工具，不另建开发者控制台：

- **页面代码**：VSCode 命令「Webview 开发者工具」检查编辑器页/设置页的 DOM、断点与 console。
- **宿主代码**：F5 扩展调试宿主（仓库 `.vscode/launch.json`），断点与 Debug Console。
- **安装态日志**：写入 VSCode 输出通道，标明组件 ID、出错阶段与原因。
- **组件状态**：Vsidian 设置页「附加组件」分页展示启用偏好、兼容、装载与故障状态，并提供手动重试；故障暂停的组件保留启用偏好。

## 7. 版本、兼容与迁移

- **API 版本独立于 Vsidian 本体版本**：兼容判定只看清单 `api` 范围与宿主稳定 API 版本（当前 1.2.0，2026-10-18 随 v1.2.0 发行；兼容承诺自 1.1.0 起），不因本体升级自动改变。
- **实验入口另行声明**：`experimental.cm6`、`experimental.headingFold` 等入口可能随版本调整，不随稳定 API 弃用期限承诺；使用前必须在清单声明兼容范围。
- **稳定移除规则**：稳定 API 确需移除时，先发布弃用说明与替代方案；从弃用版本实际发布日起，同时满足两个后续 API 次版本和 30 天才允许移除。
- **当前状态**：已随本体发行 1.1.0（2026-10-16）与 1.2.0（2026-10-18），发行版本受兼容承诺与移除规则约束；发行台账（`src/shared/addonApiCatalog.ts` 的 `ADDON_API_RELEASES`）如实区分候选与已发布，experimental 实验入口维持候选口径。迁移内容在出现破坏性变更时补充。
- **变更记录**：调用者可见的 API 变更（新能力面、语义修订、拒绝原因、预算）记录在仓库根 [CHANGELOG-API.md](../../CHANGELOG-API.md)——候选期增补累计进当前候选面不升版本号，落账时转正为版本段。

## 8. 文档维护入口（组件作者一般不需要）

修改六组接口时的事实源与命令（详细纪律见 [AGENTS.md](../../AGENTS.md) 的附加组件条目与[规格 §7](../specs/vsidian-addons.md)）：

| 对象 | 事实源 / 命令 |
| --- | --- |
| 接口签名 | 各事实源模块（`src/shared/addon*.ts`、`src/host/addons/`）——不手写第二份 |
| 语义清单与发行台账 | `src/shared/addonApiCatalog.ts` |
| 版本参考（生成产物） | `npm run gen:addonapi` 生成；`npm run check:addonapi` 校验新鲜度 |
| 编译期消费 | `test/addonApi/publicApiConsumer.ts`（随 `npm run compile` 检查） |
| 行为消费样例 | `test/fixtures/addon-v02/` 各夹具 |
| 用户故事覆盖映射 | `docs/specs/vsidian-addons-coverage.md`（接口或验证变更时同步更新） |

签名或语义调整必须同步：语义清单条目 → 重生成参考 → 消费样例与钉住断言 → 台账（如涉版本状态）。新增开发中能力单列条目与 `CHANGELOG-API.md` Unreleased，不改写已发行记录；声明文本变化仍按 [API 门禁](../specs/addons-api-gate.md) 显式重锚，不能弱化检查。

## 9. 统一主题与主题环境（T07 / #546）

主题组件在宿主 `enable` 阶段调用 `context.themes.register` 登记元数据，在编辑器页面调用 `sdk.renderers.register` 提供实际渲染。目录无需先打开文档即可出现在「外观 → 主题」；安装只新增候选，用户显式选择后才接管声明语言。普通非主题渲染提供者保留安装后接管规则。

`themeId` 为组件内稳定 ID，平台组合 `<addonId>/<themeId>` 作为主题首选。声明的 `rendererId` 是本组件局部提供者 ID，`languages` 限定该主题生效范围；不同主题可以支持同一语言。注册返回普通成功/拒绝结果，句柄释放撤销本次登记；旧句柄不能撤销后来的替换登记。停用与故障回落内置显示，保留主题首选，恢复后继续原选择。

编辑器页面通过 `sdk.themeEnvironment.get()` 同步读取 VSCode 实际主题的 `dark` / `highContrast`，通过 `onChange` 订阅变化。回调触发前快照已更新，重复值不通知；组件代次释放自动退订，回调抛错按既有组件故障上报。设置页不提供此面，实验 `hostSettings` 白名单仍保持原范围。

可直接参考[主题页面消费夹具](../../test/fixtures/addon-v02/addon/themeEditor.ts)和[宿主登记夹具](../../test/integration/addonFixtures/addon-theme/extension.js)。签名以[生成参考](api-reference.md)的 `themes-register` / `theme-environment` 条目为准，完整产品规则见[主题规格](../specs/addon-themes.md)。内核 Codex 在 T07 继续保留；替代组件的发行与内核退役由 bridge#3、#535 接续。

## 10. 后续 API 扩展规格

2026-10-15 批次设计与各票交付状态见[批次索引](../specs/batch-2026-10-addon-api-extensions.md)：[声明式粘贴转换](../specs/addon-paste-conversion.md)、[文档导航与行号](../specs/addon-navigation.md)、[只读引用浮窗/嵌入](../specs/addon-reference-views.md)、[统一主题与明暗状态](../specs/addon-themes.md)。T01 基础粘贴、T02 正则/条件/嵌套、T03 文档导航、T04 普通链接尾部行号、T05 只读引用浮窗、T06 组件容器嵌入及 T07 统一主题已实施，待用户整体验收；T08 内核退役为仅存未实施票。当前公开声明和生成参考是实际可消费能力的事实源。
