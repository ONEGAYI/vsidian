# Vsidian 附加组件 V02：页面 SDK、共享 CM6 与资源释放探针

调研日期：2026-10-07。票面：[#349](https://github.com/ONEGAYI/vsidian/issues/349)（总览 #347）。类型：验证票——验证「独立浏览器脚本（IIFE）+ 本页 SDK 注入」能实际接入编辑器 webview 与组件自身设置页，不建设完整安全沙箱、不发布测试组件、Remote SSH 留给安装侧验证票。

前置事实源：[ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md)、[接口与装载技术方案](../design/vsidian-addon-api.md)、[既有最小宿主探针（2026-10-05）](vscode-addon-discovery.md#2026-10-05-接口收敛与最小宿主探针)。本页证据补足该探针明确未验的四项：真实 StateField/ViewPlugin、首笔输入、完整释放、拒绝对照。

## 结论速览

**T02「页面 SDK、两端通信与贡献生命周期」可放行**，边界与未验项见文末。放行依据是三层证据全部通过：

| 证据层 | 载体 | 结果 |
| --- | --- | --- |
| 模块释放与代次拒收（纯逻辑） | `test/unit/addonPageLoader.test.ts`、`test/unit/addonRegistry.test.ts` | 30 项全过 |
| 生产构建下的 CM6 输入与绘制 | `test/browser/addonPageSdk.mjs`（Chromium 真实键盘/CDP IME） | 6 场景全过 |
| 真宿主 1.82.3 资源与 CSP 对照 | `test/integration/addonV02Probe/runProbe.mjs`（独立桌面便携宿主） | 11 用例全过，退出码 0 |

证据 JSON（随仓库提交）：[data/addon-v02-probe-results.json](data/addon-v02-probe-results.json)。

## 验证件结构

验证件全部位于测试树（不进 VSIX、不进生产 bundle），形状为 T02 实施的收敛目标：

```
test/fixtures/addon-v02/
├── loader/
│   ├── types.ts           # SDK/装载协议的提议形状（三处共享的单一契约）
│   └── pageAddonLoader.ts # 页面装载器原型（webview 侧，核心验证对象）
├── registry/
│   └── addonRegistry.ts   # 宿主侧登记与路径包含性校验（纯逻辑原型）
├── sdk/
│   ├── sdkBridge.mjs      # SDK 构建桥（esbuild 插件，见下）
│   ├── buildAddon.mjs     # 测试组件构建脚本 + CM6 不得重打包的静态红线
│   └── vsidian-addon-sdk.d.ts  # 虚拟模块的 tsc 声明
├── addon/                 # 测试组件源码（模拟组件作者）
│   ├── page.ts / page.css / throw.ts
└── .build/                # 运行时构建产物（git 忽略）
test/integration/addonV02Probe/   # 真宿主探针（suite + 双 webview 主 + runner）
test/browser/addonPageSdk*        # 浏览器套件（生产控制器）
```

## 模块格式

**独立浏览器 IIFE，执行后经全局登记表暴露工厂**（路线三，设计 §1）。测试组件产物 2300 B（minified，chrome114 目标）；构建桥的 `defineAddonPage(addonId, factory)` 把工厂推入 `globalThis.__vsidianAddonPages`（数组形态：同一脚本重复执行追加新条目，装载器按「本次装载期间注册 + 未消费」规则取用）。作者不手写全局变量——这是构建辅助工具的职责，与设计 §4.2 一致。

## SDK 构建桥：组件如何不重打包 CM6

双防线：

1. **构建期拒绝**：`sdkBridge.mjs` 把 `@codemirror/*` 的**值导入**解析为构建错误（"共享 CM6 运行时须经 vsidian-addon-sdk 的 experimental.cm6 取得"）。type-only 导入被 esbuild 在解析期剥离，作者仍可用 `import type` 拿类型。组件源码在工厂内解构：`const { StateField } = sdk.experimental.cm6.state`。
2. **构建后静态红线**：`buildAddon.mjs` 断言产物不含 CM6 发行产物的稳定标记串（`Unrecognized extension value`〔state〕、`Widget decorations can only have zero-length ranges`〔view〕）——出现即构建失败。本轮实测主组件产物 2300 B、无标记。

构造器身份的运行时证据：装载器由**页面 bundle 自身**构造（探针 webview 主/浏览器夹具 `import * as cmState from '@codemirror/state'` 后注入），esbuild 单 bundle 去重保证与生产控制器同一实例。若组件私带第二份 CM6，其 StateField 无法接入本页视图（field 查询抛错、装饰不绘制）——浏览器与探针套件的 pageerror 监听 + 绘制断言覆盖该路径，全部通过。另以 `stats().cm6Shared` 留装载器侧登记证据。

**与生产装载点的差距（T02 实施要求）**：本轮装载器经 `attachExtensions` 注入 `Compartment.reconfigure` 驱动生产 EditorView——Compartment 槽由夹具/探针在 `controller.mount(parent, [keymap, addonSlot.of([])])` 的 extraExtensions 提供。生产 `liveInstance.extensions()` 目前没有该槽，T02 须在生产扩展列表加一个空 Compartment 槽（或等价机制），否则组件扩展无挂载点。这是本票发现的唯一生产缺口，不是阻塞：槽位添加是纯装配变更，语义已由本票验证。

## 资源授权方案

**每个 Webview 分别授权**——本轮有一个修正既有认知的实测发现：

> **1.82.3 桌面本地工作区中，两个 webview 面板对同一文件铸造的 `asWebviewUri()` 地址字符串完全相同**（共享 `vscode-resource` 服务根）。因此「不能复用另一页的 URI」（设计 §4.1）的隔离**不是**由 URI 字符串实现，而是由资源服务按**请求面板**的 `localResourceRoots` 包含性实现：同一地址在未登记该根的面板内装载即被拒（对照用例实测 `script-load-failed`），在登记了该根的面板内正常装载。此前「asWebviewUri 前缀是 webview 私有随机 origin」的说法对桌面本地形态不成立（随机化的是 `cspSource` 暴露面与远程形态，未在远程实测——见未验项）。

三层防线（全部实测）：

| 层 | 机制 | 对照证据 |
| --- | --- | --- |
| 宿主登记校验 | `resolveAddonRegistration` 拒绝 `..`/绝对/协议形态的入口与资源子目录 | 4/4 越界形态拒绝（单测矩阵 + 探针用例） |
| 资源服务包含性 | `localResourceRoots` = 页面产物目录 + 各组件**资源子目录**；`asWebviewUri` 只构造地址不授予读取 | 未登记目录的脚本/样式/图片全拒（`script-load-failed`、css `denied`、图片加载失败）；受限面板（只登记探针产物根）装载同一地址被拒 |
| 页面装载器 | `resourceUri` 拒绝 `..`/绝对/协议相对路径；manifest 不带资源基址时恒 null | 单测矩阵钉住 |

探针面板 CSP：编辑器型用生产 `buildEditorCsp` 原样（cspSource + nonce + wasm-unsafe-eval 全量指令）；设置页型用生产设置页的收紧 CSP（`script-src cspSource 'nonce-…'`；`style-src`/`img-src` 仅 cspSource）。组件脚本（动态 `<script src=cspSource>`）、样式（`<link>`）与图片在两种 CSP 下装载路径全部走通。资源对照矩阵：

| 资源 | 授权路径 | 拒绝对照 |
| --- | --- | --- |
| 脚本 | dist/page.js 经本面板 asWebviewUri → 工厂登记、扩展接入 | outside/denied.js → `script-load-failed`；受限面板同一地址 → `script-load-failed` |
| 样式 | dist/page.css → `<link>` 装载，标记计算色 `rgb(255,0,127)` 生效 | outside/denied.css → `denied`，同装载内授权样式不受牵连（逐条独立） |
| 图片 | dist/logo.png 经 `resourceUri` → `naturalWidth>0` | outside/denied.png（宿主经通道下发地址）→ 加载失败，组件如实上报 |

**未含 realpath/符号链接逃逸校验**——属 T05 安装侧实施（见未验项）。

## 共享运行时方案

装载器原型（`pageAddonLoader.ts`）在页面内安装，环境注入四件：页面种类（editor/settings）、共享 CM6 模块命名空间（仅编辑器页）、扩展挂载槽、出站消息通道。SDK 提议形状见 `loader/types.ts`（V02 最小子集：`experimental.cm6`、`registerExtension`、`mountRoot`、`resourceUri`、`channel.request`、`onDispose`——六组稳定能力的其余部分属后续票）。

**首个按键与 IME 不丢**（票面硬要求）：生产编辑器从装载起即可交互，组件脚本异步装载经 Compartment `reconfigure` 挂载——CM6 文档状态跨重配置保留，输入不落格。浏览器套件三个场景钉住：装载前真实键盘输入 `hello` 后组件 StateField `create` 即见 5 字符全文；脚本未 onload 时按键（竞态窗）输入完整；首个输入即 CDP 组合输入（`imeSetComposition` 候选期文本在场 → `insertText` 提交完整），组件装载后再来一轮组合同样不被扰动。

## 释放矩阵与代次

装载器契约（单测 30 项钉住，真宿主/浏览器复核关键路径）：

| 场景 | 结果 |
| --- | --- |
| 普通停用（unload 当前代次） | 释放回调执行、扩展经槽摘除（field 不可读、标记消失）、挂载根与授权样式撤下、文档不扰动、滞留通道请求以 `released` 终结 |
| 视图关闭 | 面板销毁即页面装载器消亡；宿主侧路由随 onDidDispose 回收 |
| 故障（工厂抛错 / 宿主故障指令） | `factory-error` 完整释放（不留半初始化）、历史记 `faulted`、可归因原因上报 |
| 手动恢复 | 同一授权入口新代次重新装载成功，工厂重新执行 |
| 旧代次指令 | 卸载/故障指令携旧代次 → 拒收且当前装载保持原状（计数留痕） |
| 旧工厂注册 | 装载开始前的遗留未消费登记被丢弃（`lateRegistrationsDropped`），不接入新代次 |
| 迟到通道回执 | 请求已终结/代次不符即丢弃（`lateChannelRepliesDropped`），承诺不二次结算 |
| 重复接入/重复卸载 | `already-loaded` / `not-loaded`（幂等无害）；迟到 `onDispose` 立即执行 |

## 宿主浏览器版本下界

真宿主 1.82.3 webview 实测（证据 JSON 的 userAgent 字段，编辑器型与设置页型两面板一致）：**Electron 25.8.1 / Chrome 114.0.5735.289**（与 2026-10-05 探针一致）。`chrome118` 是生产 webview 产物的构建目标声明，不代表下界宿主使用该浏览器。本轮组件与探针 webview 产物按 **chrome114** 构建并在下界宿主真实执行——「下界宿主能跑组件产物」有直接证据；生产 webview bundle 本身的语法面仍以 chrome118 构建为准（未因本票改变）。

## 验证过程发现的实现陷阱（T02 实施注意）

1. **隐藏即销毁的 webview**：`retainContextWhenHidden` 缺省关闭时，被顶到后台的面板 webview 上下文会被销毁——装载器/页面脚本不可依赖隐藏面板存活。双面板并行（编辑器 + 设置页）时各占一列。生产设置页面板已按「隐藏即释放、重开重载」设计（settingsPage.ts 既有事实），组件设置页装载须沿用该口径。
2. **`<img>` 的 `complete` 陷阱**：无 `src` 属性的 img 其 `complete` 恒为 true（HTML「不可用」态）；「先设 src 后挂 load 监听」则可能错过已触发的 load 事件。组件内异步等待图片结局必须**先挂监听再设 src**，且 `complete` 快捷路径只在 src 已存在时启用（测试组件本轮两处实证后修正）。
3. **宿主侧事件消费模型**：装载器出站事件（loaded/faulted/channel.request）到达顺序与业务消费顺序解耦（工厂内的通道请求先于 loaded 事件入表）——宿主侧收集须支持乱序消费且不回放旧事件（探针以索引级消费集合实现）。

## 证据与复现

- 证据 JSON（随仓库提交）：`docs/research/data/addon-v02-probe-results.json`——逐用例结论 + 双面板 userAgent。
- 探针报告（本机落盘，不入库）：`.vscode-test/addon-v02-probe.log`（完整 stdout/stderr + 退出码）；运行入口 `node test/integration/addonV02Probe/runProbe.mjs`。
- 浏览器：`npm run test:browser -- --suite=addonPageSdk`（报告落 `out/test/browser-runs/run-*/`）。
- 单元：`npx vitest run test/unit/addonPageLoader.test.ts test/unit/addonRegistry.test.ts`。

## 放行结论（T02）与边界

**放行**：「独立 IIFE + 本页 SDK 注入 + 共享 CM6 + 每 webview 资源授权 + 代次化生命周期」的整条路线在真宿主 1.82.3 与生产构建控制器上验证通过，T02 可按本票收敛的形状实施。实施必须携带的生产缺口：

1. 生产扩展列表加入组件扩展槽（Compartment，见「共享运行时方案」）。
2. 装载器并入页面 bundle（main/settings 两入口），不再由测试夹具装配。
3. `resourceUri` 的宿主侧 realpath 校验（符号链接逃逸）在 T05 安装侧补齐。

**边界**：本票验证的是机制可行性，以下不在声明内——完整安全沙箱（组件代码仍在页面 JS 环境执行，释放是「贡献与监听回收」不是代码卸载）；公开 API 冻结（字段与接口名仍是提议形状，随 T02 与公开声明冻结）；真实设置页生产 HTML（探针面板复刻其 CSP 形态，未在生产 settingsPage.ts 上装配）。

## 未验项清单（下游实施验证，非本票弱化）

- Remote SSH 与安装侧双 VSIX（V03/安装侧票）——含远程形态下 `asWebviewUri` 是否按面板区分（本票实测仅覆盖桌面本地工作区）。
- 真实 IME 输入法（本轮为 CDP 协议级组合输入，与真实输入法的时序差异沿用人工验证清单口径）。
- 组件故障对**生产宿主**的归因链路（本轮故障由装载器内捕获，生产侧的暂停/重试 UI 与设置页状态属 T05/T06）。
- 符号链接逃逸的 realpath 校验；组件资源目录的 watcher/失效（资源热更新属后续）。
- 多面板并发与性能（多 webview 同时装载、大扩展的装载耗时）未测。
- 六组稳定能力中未验证的接口（视图快照、applyEdits、行为链、渲染提供者、命令/菜单、设置定义读写）——分属 T03/T04 及后续票。
