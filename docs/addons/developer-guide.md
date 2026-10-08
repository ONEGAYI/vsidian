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
- 装载器核对入口身份后调用工厂注入 SDK；组件只登记安装目录内的相对入口与资源子目录，越界路径被资源服务拒绝。
- 详见参考的 [`page-sdk`](api-reference.md#page-sdk)、[`page-bridge`](api-reference.md#page-bridge) 与 [`page-load-protocol`](api-reference.md#page-load-protocol) 条目。

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
- **行为链触发面**（#399/#400/#401）：普通键入（`input.type`）与删除白名单（`delete.backward` / `forward` / `selection` / `cut` / `line`——`delete.dedent` 属缩进命令族不纳入）驱动；IME 候选期不驱动，**组合定稿驱动一次**（`userEvent='input.type.compose'`、`inputText` 为净定稿文本；取消/空白格组合/代码上下文不驱动）。上下文 `inputText` 为插入侧净文本；`replaced` 携带替换/删除侧（键入替换选区 = 被替换内容，delete = 被删文本，事务前 LF 坐标，IME 定稿恒 null）；`docUri` 为当前目标文档 URI（多视图语义：embed 触发时是引用目标的 URI）。

## 4. 消费样例入口

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
| 构建桥 | esbuild 插件与产物红线 | `test/fixtures/addon-v02/sdk/buildAddon.mjs`、`sdkBridge.mjs` |

夹具的驱动协议是「宿主夹具 ↔ 页面短轮询」（各文件头注有说明），真实业务里组件自行决定调用时机。

**独立消费样例（T15，2026-10-08 起）**：`test/examples/` 另有三套完整独立扩展工程（输入/渲染/界面——`input-behavior`、`renderer`、`ui-command`），只使用公开 SDK、可独立构建，是「从零写一个组件」的最佳参考（比测试夹具更贴近真实业务形态：无短轮询驱动协议、有自己的设置与 i18n 字典、共享构建脚本与产物扫描）。构建与复制清单见 [test/examples/README](../../test/examples/README.md)。

## 5. 调试

调试复用 VSCode 工具，不另建开发者控制台：

- **页面代码**：VSCode 命令「Webview 开发者工具」检查编辑器页/设置页的 DOM、断点与 console。
- **宿主代码**：F5 扩展调试宿主（仓库 `.vscode/launch.json`），断点与 Debug Console。
- **安装态日志**：写入 VSCode 输出通道，标明组件 ID、出错阶段与原因。
- **组件状态**：Vsidian 设置页「附加组件」分页展示启用偏好、兼容、装载与故障状态，并提供手动重试；故障暂停的组件保留启用偏好。

## 6. 版本、兼容与迁移

- **API 版本独立于 Vsidian 本体版本**：兼容判定只看清单 `api` 范围与宿主稳定 API 版本（当前候选 1.0.0），不因本体升级自动改变。
- **实验入口另行声明**：`experimental.cm6` 等入口可能随版本调整，不随稳定 API 弃用期限承诺；使用前必须在清单声明兼容范围。
- **稳定移除规则**：稳定 API 确需移除时，先发布弃用说明与替代方案；从弃用版本实际发布日起，同时满足两个后续 API 次版本和 30 天才允许移除。
- **当前状态**：全部条目为候选——发行台账（`src/shared/addonApiCatalog.ts` 的 `ADDON_API_RELEASES`）如实区分候选与已发布，只有真实发行才携带日期。迁移内容在真实发行并出现破坏性变更时补充。

## 7. 文档维护入口（组件作者一般不需要）

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
