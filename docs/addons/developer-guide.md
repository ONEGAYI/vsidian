# Vsidian 附加组件开发指南

状态：**候选 API 的开发指南（2026-10-08，随 T13 #362 建立）**。当前 Vsidian 尚未发行任何稳定 API、SDK 包或独立示例仓库——本文描述的接口形状已随 T01–T12 的消费样例冻结，按候选口径使用；发行前不产生兼容承诺。接口签名与逐条语义以[公开 API 参考](api-reference.md)为准（该文档从事实源生成，不手改）。

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
  sdk.behaviors?.register({ id: 'auto-pairs', name: '括号补全', onInput(ctx) { /* ... */ } })
})
```

- 构建桥是 esbuild 插件：解析期注入 `vsidian-addon-sdk` shim（**不是真实 npm 包**——SDK 载体未发布，当前从主仓库测试夹具复制，见[示例仓库准备](example-repo-plan.md)）。
- 构建目标 chrome114（对齐下界宿主 1.82.3 = Electron 25）。
- **CM6 红线**：构建桥拒绝 `@codemirror/*` 值导入；共享 CM6 运行时须经 `sdk.experimental.cm6` 取得（该入口须在清单 `experimental` 声明）。产物含 CM6 运行时标记串即构建失败（双防线）。
- **cm6 暴露面**：`state` 与 `view` 是整模块命名空间（构造 StateField/ViewPlugin 等值对象）；`language` 是**语法树读取子集**（`syntaxTree` / `ensureSyntaxTree` / `syntaxTreeAvailable`，#406 起 1.1.0）——`LRLanguage`、`foldGutter`、`indentUnit` 等注册类成员不暴露，addon 不应借实验入口注册语言或改全局语言配置；树与节点类型经 `import type` 消费（构建桥允许 type-only）。
- **已知边界（重要）**：live 编辑器的 markdown 语法树是内核私有的增量解析，不经 `@codemirror/language` 的 language facet 装配——`syntaxTree()` 在 live 编辑器状态上**恒返回未解析空树**。行类型判定（代码块/frontmatter/表格等）类需求不能依赖本入口，等待平台级树查询能力（另行评估）。
- **组件数据目录**（#404）：`ctx.storage` 提供安装目录外的隔离可写目录（`uri()` 显示/同步配置用；`<vsidian globalStorage>/addons/<你的组件 ID>/`）。富结构数据（规则对象、含正则与优先级的 JSON）归这里读写，不塞设置存储（一层嵌套边界）；相对路径用正斜杠，越界形态（`..`、绝对路径、反斜杠）一律 `invalid-path` 拒绝；单文件上限 8MB。`onDidChangeFile(callback)` 监听外部变化——回调收 `(relativePath, kind)`，`kind` 为 `'change'`（改写或新建）或 `'delete'`（删除），同步工具改写/新建规则文件后自动重载；停用/故障/卸载不删数据（随 Vsidian 本体卸载清除，重装组件数据仍在）。页面侧组件代码经自己的 channel topic 桥接宿主读写。
- **动态代码（`new Function` / `eval`）不可用**：附加组件页面的 CSP 由平台配置且不含 `unsafe-eval`（`'wasm-unsafe-eval'` 仅覆盖 WebAssembly）——动态构造的替换逻辑在两个 webview 都会被 CSP 引擎拦截，且平台**不计划**为此放行。等价能力：替换函数写成组件代码内的真函数，规则文件只存声明性数据与函数引用（预注册变换函数表，评估见 [CSP 探针](../research/addon-csp-dynamic-eval-probe.md)，#405）。
- **视图身份反查（#426，实验）**：`sdk.experimental.viewIdentity.instanceIdOf(view)` 把 CM6 `EditorView` 反查为 views 面实例 ID（keymap/扩展回调消费；非平台实例返回 null）——清单声明 `experimental: { viewIdentity: '^1.0.0' }`，详见 §4.2。
- **标题折叠入口（#410，实验）**：`sdk.experimental.headingFold` 提供折叠区间查询与命令——方法按 `views` 面实例 ID 寻址（`folds(instanceId)` 有效折叠派生视图、`foldable(instanceId)` 可折叠全集；span 形状 `{ key, level, hideFrom, hideTo }`，LF 偏移、不含文本摘要）。命令面 `apply(instanceId, operation, options?)` 五操作（`fold` / `unfold` / `toggle` 选区驱动——先经 `views` 面 `setSelection` 定位；`foldAll` 可 `{ upToLevel }` 参数化、`unfoldAll` 全清）与 `foldAt` / `unfoldAt(instanceId, keys)` 按区间键批量组合（键来自查询结果，脱靶键静默忽略）。**Live-only**：reading 态与 hover 只读视图拒绝 `read-only`，设置页不提供该入口；折叠是视图态（零写回、不进撤销栈、不跨会话），编程触发与用户触发同链路。使用须在清单声明 `experimental: { headingFold: '^1.0.0' }`。
- 装载器核对入口身份后调用工厂注入 SDK；组件只登记安装目录内的相对入口与资源子目录，越界路径被资源服务拒绝。
- 详见参考的 [`page-sdk`](api-reference.md#page-sdk)、[`page-bridge`](api-reference.md#page-bridge)、[`page-load-protocol`](api-reference.md#page-load-protocol) 与 [`heading-fold-experimental`](api-reference.md#heading-fold-experimental) 条目。

## 3. 六组能力速览

逐条签名、语义与验证定位见[公开 API 参考](api-reference.md)；此处只给「用哪组做什么」的路标。

| 组 | 用途 | 关键入口 | 页面/宿主 |
| --- | --- | --- | --- |
| 发现与安装 | 声明身份、兼容、注册接入 | `vsidianAddon` 清单、`registerAddon` | 宿主 |
| 页面 SDK | 装载协议、视图/快照/文本提交、通道 | `sdk.views`、`sdk.channel`、`defineAddonPage` | 两端 |
| 输入行为 | 可组合输入处理 | `sdk.behaviors.register` | 编辑器页 |
| 设置 | 定义、读写、作用范围、设置页 | `ctx.settings.*` | 宿主 |
| 渲染提供者 | 代码块渲染候选与自动接管 | `sdk.renderers.register` | 编辑器页 |
| 命令/菜单/界面 | 命令、菜单项、按钮、面板 | `sdk.commands` / `sdk.menus` / `sdk.ui` | 编辑器页 |

几个高频语义提醒（完整版在参考各条目）：

- **编辑坐标**：全文 UTF-16 code unit 偏移、页面全程 LF；快照的 `revision` 覆盖页面未确认输入窗口——旧快照提交明确拒绝 `stale-snapshot`，不自动重试。
- **撤回边界**：`applyEdits` 默认原子（独立撤回）；声明 `joinPrevious` 则随同目标上次原子操作撤回，无可确认前项拒绝 `history-boundary`。撤销与重做归宿主文本管线。
- **目标归属**：操作始终归当前目标文档（在引用 B 中编辑不误改父 A）；按钮与面板回调收到的句柄由平台动态解析当前活动视图。
- **渲染接管**：新安装的兼容且已启用组件自动替换所支持语言的显示（含内置）；重启/重复注册/普通升级不当作新安装；组件仍运行而渲染有 bug 时平台不自动接管。
- **命名空间**：命令/菜单/按钮/面板的公开 ID 由平台注入 `<addonId>.<localId>`（局部 ID 禁点号）；不存在覆写、隐藏或接管内置菜单项的入口。
- **按键拦截与优先级**（#402，实验入口契约）：经 `registerExtension` 挂 CM6 keymap 有两层位置——**普通 keymap**（扩展槽为平台扩展数组末位，平台 Tab 三段/列表续行等情境链先试，addon keymap 在平台不处理时落空接手，适合 Tabout 兜底类）与**抢先层**（用 `Prec.high` 包裹——高于平台普通键位，可替代平台处理如智能退格；返回 `false` 即落穿平台链，透传语义）。**保留键面不可越过**：撤销/重做（`Mod-z` / `Shift-Mod-z` / `Mod-y`）是 `Prec.highest` 的平台保留键闸（撤销栈归宿主文本管线），addon 即便用 `Prec.highest` 也抢不掉（同为 highest 时平台闸在扩展序上先注册、先者先匹配）；Esc 与宿主级快捷键（`Ctrl+P` 等命令面板键不经编辑器）同理不开放抢先。多组件同层按键按装载顺序仲裁（先装载先试）；逐项关闭=停用组件（实验层 keymap 不进统一快捷键管理，稳定化路线另行设计）。
- **标题折叠**（#410，实验入口）：查询只读派生视图（原始键集不对外）；命令选区驱动三操作与全文档两操作共用用户触发执行体（effect 直驱）；`upToLevel` 仅 `foldAll` 接受（1–6 整数），其他操作携带即 `invalid-request`。
- **视图身份与扩展槽**（#426/#427/#428，契约）：扩展槽仅装配主正文 Live 实例；view → instanceId 反查走 `experimental.viewIdentity`；命令回调携带目标视图句柄——完整条款与移植换算见 §4。
- **行为链触发面**（#399/#400/#401）：普通键入（`input.type`）与删除白名单（`delete.backward` / `forward` / `selection` / `cut` / `line`——`delete.dedent` 属缩进命令族不纳入）驱动；IME 候选期不驱动，**组合定稿驱动一次**（`userEvent='input.type.compose'`、`inputText` 为净定稿文本；取消/空白格组合/代码上下文不驱动）。上下文 `inputText` 为插入侧净文本；`replaced` 携带替换/删除侧（键入替换选区 = 被替换内容，delete = 被删文本，事务前 LF 坐标，IME 定稿恒 null）；`docUri` 为当前目标文档 URI（多视图语义：embed 触发时是引用目标的 URI）。

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
| 构建桥 | esbuild 插件与产物红线 | `test/fixtures/addon-v02/sdk/buildAddon.mjs`、`sdkBridge.mjs` |

夹具的驱动协议是「宿主夹具 ↔ 页面短轮询」（各文件头注有说明），真实业务里组件自行决定调用时机。

**独立消费样例（T15，2026-10-08 起）**：`test/examples/` 另有三套完整独立扩展工程（输入/渲染/界面——`input-behavior`、`renderer`、`ui-command`），只使用公开 SDK、可独立构建，是「从零写一个组件」的最佳参考（比测试夹具更贴近真实业务形态：无短轮询驱动协议、有自己的设置与 i18n 字典、共享构建脚本与产物扫描）。构建与复制清单见 [test/examples/README](../../test/examples/README.md)。

## 6. 调试

调试复用 VSCode 工具，不另建开发者控制台：

- **页面代码**：VSCode 命令「Webview 开发者工具」检查编辑器页/设置页的 DOM、断点与 console。
- **宿主代码**：F5 扩展调试宿主（仓库 `.vscode/launch.json`），断点与 Debug Console。
- **安装态日志**：写入 VSCode 输出通道，标明组件 ID、出错阶段与原因。
- **组件状态**：Vsidian 设置页「附加组件」分页展示启用偏好、兼容、装载与故障状态，并提供手动重试；故障暂停的组件保留启用偏好。

## 7. 版本、兼容与迁移

- **API 版本独立于 Vsidian 本体版本**：兼容判定只看清单 `api` 范围与宿主稳定 API 版本（当前候选 1.0.0），不因本体升级自动改变。
- **实验入口另行声明**：`experimental.cm6`、`experimental.headingFold` 等入口可能随版本调整，不随稳定 API 弃用期限承诺；使用前必须在清单声明兼容范围。
- **稳定移除规则**：稳定 API 确需移除时，先发布弃用说明与替代方案；从弃用版本实际发布日起，同时满足两个后续 API 次版本和 30 天才允许移除。
- **当前状态**：全部条目为候选——发行台账（`src/shared/addonApiCatalog.ts` 的 `ADDON_API_RELEASES`）如实区分候选与已发布，只有真实发行才携带日期。迁移内容在真实发行并出现破坏性变更时补充。

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

签名或语义调整必须同步：语义清单条目 → 重生成参考 → 消费样例与钉住断言 → 台账（如涉版本状态）。
