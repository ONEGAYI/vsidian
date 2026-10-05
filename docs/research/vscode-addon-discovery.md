# Vsidian 附加组件：VSCode 发现与调用边界

调研日期：2026-10-04 起。运行语义核对 VSCode **1.82.3** 的官方源码及 `vscode.d.ts`；在线文档用于辅助说明，不将其新增功能回推到旧版。前期仅阅读；2026-10-05 补充了隔离的最小宿主探针，范围及结果见末节，未执行 Remote SSH 或双 VSIX 安装验证。

## 结论与状态

**通过普通 VSCode 扩展分发附加组件可行，但安装渠道与 Vsidian 接入协议是两件事**。 已确认由 VSCode 发现、安装，Vsidian 设置页汇总具体设置并提供功能开关，兼容组件默认启用且保留用户关闭选择。稳定 API 独立编号，加载选择「元数据声明 + 代码注册」；热切换、统一视图实例与普通扩展信任模型已确认。

2026-10-05 已确认首批稳定 API 的六组能力范围，以输入处理、内容渲染和界面操作三类样例共同验证。范围以 [ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md) 为准；具体接口签名、装配和运行验证仍待落实，下文未选定的技术细节保留为建议。

## 已核实事实

**已安装发现并非全局安装清单**。 稳定 API 提供 `extensions.all`、`getExtension(id)` 和 `onDidChange`，事件反映清单变化；但 1.82.3 实现只查询当前扩展宿主的注册表。跨宿主枚举及额外查询参数属于 proposed `extensionsAny`，不能作为稳定下界方案。因此，查询无结果无法区分未安装、被禁用或在另一宿主。参见[类型声明](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L15452-L15471)、[实际实现](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHost.api.impl.ts#L453-L491)。

**导出 API 只在同一扩展宿主内直接调用**。 `activate()` 返回公开 API，未激活前不应读 `exports`；1.82.3 的异宿主对象 `exports` 返回 `undefined`，`activate()` 抛错。消费者声明 `extensionDependencies` 后，激活器先等依赖成功，再调用消费者；依赖不存在或激活失败会阻止消费者激活。[公开契约](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L7079-L7100)、[异宿主限制](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHostExtensionService.ts#L1126-L1138)、[依赖等待](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHostExtensionActivator.ts#L250-L323)、[失败传播](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHostExtensionActivator.ts#L390-L418)。

**Remote SSH 要保证两者同侧运行**。 Vsidian 当前声明 `extensionKind: ["workspace"]`；官方文档说明 workspace 扩展随工作区运行，本地工作区在本机，SSH 工作区在远端。`Extension.extensionKind` 是运行位置判断，受配置影响；没有远端宿主时返回 UI，不能用它倒推出 manifest 的偏好。跨宿主依赖的提供者须声明 `api: "none"`，改用异步 VSCode 命令通信；这不是透明导出 API，也不适合直接替代 Vsidian 同宿主入口。稳定 API 无法完整枚举另一侧；装错侧的确认应借助 VSCode 扩展管理界面和「Developer: Show Running Extensions」。[项目清单](../../package.json)、[Remote 文档](https://code.visualstudio.com/api/advanced-topics/remote-extensions#architecture-and-extension-kinds)、[位置字段契约](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L7079-L7086)、[跨宿主通信文档](https://code.visualstudio.com/api/advanced-topics/remote-extensions#handling-dependencies-with-remote-extensions)、[跨宿主依赖实现](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts#L29-L44)、[排查入口](https://code.visualstudio.com/api/advanced-topics/remote-extensions#incorrect-execution-location)。

**声明可用私有元数据，不能冒充正式贡献点**。 `packageJSON` 暴露包清单；扫描器解析 JSON 后保留 manifest 字段，再展开到扩展描述。可以约定顶层 `vsidianAddon` 字段由 Vsidian 自行解析。把同名字段放进 `contributes` 不会自动注册 VSCode 正式贡献点：注册表、schema 和隐式激活事件由 VSCode 内部 `registerExtensionPoint` 装配。[包清单 API](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L7074-L7077)、[扫描与保留](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/platform/extensionManagement/common/extensionsScannerService.ts#L668-L695)、[字段展开](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/platform/extensionManagement/common/extensionsScannerService.ts#L949-L961)、[贡献点注册](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/services/extensions/common/extensionsRegistry.ts#L600-L613)。

**在线寻找应走市场搜索，离线安装走 VSIX**。 市场分类采用 VSCode 既有枚举，不能新增「Vsidian」类别；`keywords` 成为市场标签，可约定 `vsidian-addon`。1.82.3 已有 `workbench.extensions.search`、`workbench.extensions.installExtension`；前者打开扩展视图搜索，后者接受扩展 ID 或 VSIX URI。关键词仅帮助寻找，不代表符合接入协议或获得认证。[分类枚举](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/platform/extensions/common/extensions.ts#L234-L253)、[关键词文档](https://code.visualstudio.com/api/references/extension-manifest#fields)、[搜索实现](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts#L401-L422)、[安装实现](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts#L286-L362)。

**VSCode 停用与 Vsidian 功能卸载需要分别定义**。 `Extension` 没有公开 `deactivate()`；1.82.3 不允许安全移除已经开始激活的运行实例，卸载界面也提示重载。Vsidian 内即时停用若要生效，须自行释放组件注册与资源，不能宣称已经停止该 VSCode 扩展执行。[Extension 契约](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L7051-L7100)、[运行期移除边界](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L333-L345)、[卸载提示](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/extensions/browser/extensionsActions.ts#L743-L751)。

**宿主导出函数不能直接传入编辑器**。 `Webview.postMessage` 载荷须可 JSON 序列化，1.57+ 另支持 ArrayBuffer 的传输。由此可知函数对象不能经消息桥变成前端回调；输入与渲染扩展还需独立的前端模块装配和宿主消息协议。[消息边界](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L8607-L8638)。

## 建议路线与待验证项

官方当前[扩展运行时安全文档](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)说明扩展宿主具有与 VSCode 本身相同的权限。因此，Vsidian 的声明校验与功能开关应视为自身接入协议的控制，不能据此推导整个第三方 VSCode 扩展已被沙箱隔离。首版已确认沿用普通 VSCode 扩展信任模型，具体错误恢复仍待设计；该文档的新增市场安全机制不回推到 1.82.3。

文档载体也可与事实源分开：GitHub Wiki 使用独立的 `.wiki.git` 仓库，只有推到其默认分支的内容对外展示（[官方 Wiki 维护说明](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages#adding-or-editing-wiki-pages-locally)）。本专项已确认主仓库保留 API 声明、兼容契约与版本文档，另提供独立示例仓库；是否将 Wiki 用作展示入口尚待安排。

2026-10-05 已确认 Q25–Q26：Vsidian 完成自身激活并提供 API 后，扫描附加组件声明、检查兼容性、唤醒合格的 VSCode 扩展，再由组件代码调用公开 API 注册具体能力。首版要求组件宿主代码与 Vsidian 在同一扩展宿主运行，本机项目在本机，Remote SSH 工作区的宿主代码在远端。VSCode 也可能先于 Vsidian 的主动唤醒步骤激活组件，接入仍须等待 Vsidian API 可访问。注册入口仍需检查身份与兼容性，并避免重复接入。

具体实现建议附加组件声明 `extensionDependencies: ["onegayi.vsidian"]` 和 `extensionKind: ["workspace"]`，配合前述已核实的依赖与运行位置语义。安装侧检查、声明格式及装配细节仍须在接入规格中确定并通过真宿主验证。

**Vsidian 必须先完成自身激活**。 根据上述依赖等待源码推导，若 Vsidian 在自己的 `activate()` 中等待依赖它的附加组件激活，会形成互等。组件的主动唤醒应在 Vsidian 激活完成且 API 可访问之后；该装配约束已纳入 Q25 决策，仍未通过运行探针验证。

设置页分别呈现当前宿主发现、API 不兼容与激活失败；对当前宿主不可见的扩展，仅提供 VSCode 管理入口。离线交付建议分别准备 Vsidian 与附加组件 VSIX，并检查前端资源随包完整；依赖补装、即时启停及重载恢复须在本地与 SSH 真宿主验证。

## 两处运行代码与 VSCode 调试工具

2026-10-04 后续访谈已确认 Q18：一个附加组件以一个 VSIX 分发，按需提供宿主代码与 Webview 页面代码；页面入口由组件代码注册，Vsidian 负责装载，两端通过 SDK 接口进行消息通信。宿主处理注册、文档和数据操作，页面处理输入、渲染与自己的设置内容。具体接口及装载实现仍待设计，未运行装载探针。决策见 [ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md)。

**VSCode 已有页面调试入口**。`Developer: Toggle Developer Tools` 可检查 Webview 的 DOM、样式、脚本、错误与日志；执行表达式时选择对应的活动 frame。官方文档要求旧于 1.56 或启用 `enableFindWidget` 的 Webview 使用 `Developer: Open Webview Developer Tools`。这些入口用于检查页面代码，不能据此把扩展宿主代码视为同一执行环境。[Webview 调试文档](https://code.visualstudio.com/api/extension-guides/webview#inspecting-and-debugging-webviews)。

**扩展宿主使用扩展调试工具**。官方教程以 F5 启动扩展开发宿主，通过断点、变量检查与 Debug Console 调试。日常安装态的日志可由扩展创建 VSCode 输出通道记录。[扩展调试文档](https://code.visualstudio.com/api/get-started/your-first-extension#debugging-the-extension)、[输出通道](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#output-channel)。

**Vsidian 已确认复用这些调试界面**，并在日志中记录组件 ID、阶段和原因；设置页保留简短状态及重试入口。调试工具用于排障，暂停和重试由 Vsidian 生命周期机制实现。2026-10-05 已确认：可捕获且可归因的异常触发该组件在 Vsidian 中全部注册功能的暂停，保留启用偏好并允许手动重试；具体实现仍待设计。本轮只核对公开文档，没有调试工具或日志汇集的运行验证。

## 菜单公开接入与现有内核的区别

2026-10-05 用户确认附加组件只新增自己的菜单项，不允许覆写内置项，设置页面的禁止接管边界继续适用。

现有内核的 `registerContextMenuItem` 会在同 ID 时覆盖既有条目，另外提供 `overrideContextMenuItem` 与 `hideContextMenuItem`。因此，仅省略名称带 `override` 的方法还不足以符合新边界；公开注册入口需要校验命名空间和归属，拒绝覆盖内置标识。本轮只读取源码及记录边界，未修改代码，也没有新增运行探针。[内核菜单注册模块](../../src/shared/contextMenu.ts)、[菜单规格的公开边界](../specs/context-menu.md)、[ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md)。

## Obsidian 加载机制对照

核对日期：2026-10-04。API 类型固定于官方 [1.14.4 提交](https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/package.json#L1-L4)，样例固定于 [07ceb81](https://github.com/obsidianmd/obsidian-sample-plugin/tree/07ceb81d1fb3384af611ebf665a1ec42a7e5926d)；开发者网页为当日公开内容。这里只核对公开契约，未读取闭源插件管理器或运行探针，不推断串并行、排序等内部调度。

**manifest 有元数据声明，没有完整能力与按需激活清单**。公开 schema 描述身份、版本、最低应用版本和桌面限制，未定义命令、CM6 扩展或按能力触发的激活事件。[Manifest 文档](https://docs.obsidian.md/Reference/Manifest)、[PluginManifest 类型](https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/obsidian.d.ts#L5106-L5153)。

**加载后由插件代码注册能力**。官方加载指南说明应用可交互前会加载插件，并要求 `onload()` 保留必要初始化与注册。官方样例在 `onload()` 调用 `addCommand()`，弹窗实际创建放在命令回调中；CM6 通过 `registerEditorExtension()` 由代码注册，功能并非从 manifest 自动装配。[加载指南](https://docs.obsidian.md/plugins/guides/load-time)、[命令样例](https://github.com/obsidianmd/obsidian-sample-plugin/blob/07ceb81d1fb3384af611ebf665a1ec42a7e5926d/src/main.ts#L20-L51)、[CM6 注册契约](https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/obsidian.d.ts#L5023-L5031)。

**昂贵初始化与资源获取的延后主要由作者安排**。官方建议不在 `onload()` 中做昂贵计算或数据获取，启动后工作可放入 `onLayoutReady()`；该方法在布局已就绪时立即调用，否则排队。实际操作也可留在命令回调。延后工作仍须遵守插件卸载时释放资源的生命周期。[加载优化](https://docs.obsidian.md/plugins/guides/load-time)、[布局回调契约](https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/obsidian.d.ts#L7874-L7880)、[生命周期管理](https://docs.obsidian.md/plugins/guides/lifecycle-management)。

**Vsidian 已确认选择 A**：元数据声明身份、兼容与必要展示信息，组件代码注册实际能力并控制调用时机，昂贵资源按需初始化。用户认为同时维护平台激活声明与代码容易漂移，因此不增加第二套 Vsidian 激活事件声明。该选择借鉴轻量注册与资源初始化分离，不等同于承诺复刻 Obsidian 的闭源调度实现。

## Obsidian 设置页接入与覆写边界

核对日期：2026-10-04。以下核对官方设置文档与前文固定的 API 提交，未运行插件或读取闭源设置管理器。

**插件可以自定义自己的设置内容**。`addSettingTab()` 接收插件的 `PluginSettingTab`。传统方式是覆写自己设置页类的 `display()`，在 `containerEl` 中构建界面；这是插件自己页面的渲染，不是接管应用整体设置页或另一个插件的页面。从 Obsidian 1.13.0 起，官方推荐 `getSettingDefinitions()` 声明式定义，普通 `control` 绑定由应用处理渲染、读写、保存及输入校验；旧命令式方式仍作为兼容入口保留。[官方设置文档](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/User%20interface/Settings.md)、[迁移说明](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)、[固定 API 声明](https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/obsidian.d.ts)。

**声明式定义仍提供自定义界面入口**。设置行可使用 `render` 回调，复杂子页面可提供 `SettingPage` 工厂。`render` 不自动保存；命令式子页面内手工生成的控件不自动参与声明式搜索、读写和条件状态，插件需要自行处理。这些入口都属于插件自己的设置内容。[官方文档的自定义行与子页面](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/User%20interface/Settings.md#sub-pages)。

**未在已核对的公开 API 中找到替换整个设置界面或他人设置页的覆写协议**。公开接口描述的是插件添加自身设置页；`App` 的公开声明也没有暴露设置管理器。该结论只限定公开契约，不能推导为插件代码绝对无法改动内部 DOM 或方法，也不能据此判断官方审核是否允许某个具体实现。[公开 API 声明](https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/obsidian.d.ts)。

**Vsidian 已确认的设置页边界**：普通设置由统一定义管理，组件可以自定义自己的设置页内容。整体设置框架、导航和组件开关由 Vsidian 管理，不开放接管整体设置页面、覆写内置设置页或改动其他组件设置页的接口。菜单与操作的显式覆写不能自动扩大为设置页整体覆写；自定义页面的装配与生命周期接口仍待设计。决策见 [ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md)。

## 激活声明的表达边界（方案对照）

2026-10-04 后续访谈已选择 A。本节保留激活声明的表达边界分析；下面的激活声明候选不作为当前实施方向，最终决策见 [ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md)。

VSCode 的公开激活机制提供命令、语言等有限事件，以及启动时激活的 `*` 和启动完成后的 `onStartupFinished`。这些声明描述何时启动扩展，不是完整的业务条件语言（[官方激活事件说明](https://code.visualstudio.com/api/references/activation-events)）。当前文档中的较新事件不回推到 Vsidian 的 1.82.3 下界；上述常见入口以公开文档及前文已固定的显式 `Extension.activate()` 契约为参照，未做运行探针。

**表达边界的判断**：有限触发集合不能精确枚举未来所有组件的动态业务条件。提供更早加载的入口可以让组件自行订阅事件、读取状态并判断复杂条件，但不等于所有组件都能精确延迟到真正需要功能时才加载。

**选择 A 前的候选，现不采用**：用有限声明覆盖常见的首次加载时机，再提供 Vsidian 就绪时加载的兜底。该方案仍需维护另一套激活声明与入口代理，用户选择由组件代码控制调用时机。输入类需要在 Live 实例可交互前完成必要装配，不能假定首次按键到来后再加载也能无损接管；这一输入时序要求仍须在 A 的生命周期 API 中落实。

## 2026-10-05 接口收敛与最小宿主探针

**独立页面脚本与 SDK 注入的基本路线已经运行验证**。本节增加 VSCode 1.82.3 的隔离探针，不将此前只读核查改写成完整生产验证。技术提议另见[接口与装载方案](../design/vsidian-addon-api.md)。

### 源码核查与推导

原生扩展激活完成后才公布返回的 API。协调任务可以等待自身 `Extension.activate()` 完成，但不能被自身 `activate()` 等待；仅改成微任务不能证明 API 已发布。[API 发布源码](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHostExtensionService.ts#L555-L585)、[激活完成与依赖等待](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHostExtensionActivator.ts#L231-L307)。

页面资源须同时经过当前 Webview 的 URI 转换和资源根授权，转换 URI 本身不授予读取权限。建议登记组件安装目录内的页面产物子目录，再加入对应页面的资源根。[资源根契约](https://github.com/microsoft/vscode/blob/1.82.3/src/vscode-dts/vscode.d.ts#L8537-L8544)、[包含性与拒绝检查](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/webview/browser/resourceLoading.ts#L57-L114)、[Remote URI 转换](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/webview/common/webview.ts#L40-L59)。

现有核心页面按 `browser/iife/chrome118` 构建，Mermaid 已采用独立脚本加载。当前 `script-src` 实际包含 `cspSource`、nonce 和 `wasm-unsafe-eval`，不能把文件头的「仅 nonce 门控」作为现行事实。[构建](../../esbuild.mjs#L50)、[实际 CSP](../../src/host/editorCsp.ts#L44)、[现有独立脚本加载器](../../src/webview/mermaidRender.ts#L110)。

独立 IIFE 可登记工厂，由加载器注入本页 SDK。第三方再打包 CM6 会形成另一份运行时；仅 `external` 则可能留下页面不可用的 `require()`。共享应通过明确的构建桥接实现，不能把核心 IIFE 当成原生模块命名导出。[esbuild 格式](https://esbuild.github.io/api/#format)、[external](https://esbuild.github.io/api/#external)、[CM6 的实例检查](https://github.com/codemirror/state/blob/83ce34df91be75081bb05d48df7e04a6575dfdb6/src/facet.ts#L519-L552)。

历史合并有不同于页面装载的限制：`workspace.applyEdit` 的扩展宿主实现没有传递历史组 ID，单文档 bulk edit 建立并关闭历史项。不能只给后一笔 `TextEditor.edit` 关闭前置撤销边界，就声称它已合并到前一笔 WorkspaceEdit。[宿主桥](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/api/common/extHostBulkEdits.ts#L26-L29)、[建立及关闭历史项](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts#L267-L275)。Vsidian 现有写回使用 WorkspaceEdit，撤销由宿主端口路由。[当前写回适配器](../../src/host/textEditorProvider.ts#L1204)、[编辑请求确认路径](../../src/host/documentSession.ts#L1729)。

### 探针环境与证据

探针在本工作树 `out/research/addon-api-probe/` 中生成独立的 API 提供者和依赖组件，使用独立桌面、便携目录、扩展目录和用户数据。仅复用现有缓存的 VSCode 1.82.3 二进制及构建依赖，没有启动生产 Vsidian 或写入用户配置。

两次宿主和外层启动器均退出 0。第一次验证基础路线，第二次新增分组撤销与重做，消费第二次的结果作为当前证据。运行文件保留于本机 Git 忽略目录，不能当作随仓库分发的测试入口：

- `out/research/addon-api-probe/run.mjs`、`host.cjs`、`addon.cjs`、`suite.cjs`：本轮探针源代码。
- `out/research/addon-api-probe/run-1791171093805/results.json`：9 条观察记录及宿主版本。
- `out/research/addon-api-probe/run-1791171093805/host.log`、`exit.json`：完整宿主输出与退出码。
- `out/research/addon-api-probe/runner-tracked.log`、`runner-tracked-exit.txt`：外层运行留证。

| 观察项 | 实测结果 |
| --- | --- |
| 依赖激活与私有声明 | 提供者返回 → 协调唤醒 → 组件激活 → 注册；重复原生激活后仍一个注册，私有声明可读取 |
| 组件页面与共享运行时 | 授权后的本地脚本加载；注入的 EditorState 构造器身份一致，生成预期文本，释放后容器剩余子项为 0 |
| Custom Editor 上下文 | 活动自定义编辑器下 `activeTextEditor` 不存在 |
| 两次独立 WorkspaceEdit | `AB` 撤销一次得到 `A`，两笔未合并 |
| 一次 WorkspaceEdit | `AB` 撤销一次得到空文本 |
| 已关闭 WorkspaceEdit 后追加 TextEditor.edit | 即使禁用前后撤销边界，`AB` 撤销一次仍得到 `A` |
| 保持开放的原生 TextEditor 编辑组 | 两笔编辑可一起撤销，但该条件不等同于当前 Custom Editor 写回路线 |
| Custom Editor 的来源分组协调 | A 原子、B 非原子、C 原子、D 非原子；各一次请求得到 `ABCD → AB → 空 → AB → ABCD` |
| 原生编辑器的来源分组协调 | 原生 Undo／Redo 事件触发组内后续宿主步骤，得到相同状态序列 |

实测 Webview 为 Electron 25.8.1 / Chrome 114.0.5735.289。`chrome118` 是当前构建声明，不代表下界宿主实际使用该浏览器，也不证明所有产物语法和浏览器能力都已验证。[构建目标的含义](https://esbuild.github.io/api/#target)。本次仅证明该最小页面产物在下界宿主执行成功。

### 已验证范围与后续要求

页面探针只使用共享的 `@codemirror/state` 创建状态，未装配实际输入扩展、IME、样式、图片或完整设置页面。没有资源未授权的拒绝对照，也未验证 Remote SSH 或双 VSIX 装载。

历史探针保留来源分组元数据，文本撤销仍在 VSCode；通过观察 Undo／Redo 回流补足同组剩余步骤。它只验证顺序执行及固定文本状态匹配，没有生产版本映射、失败重入、原生连续快捷键、并发外部写入、嵌入 B 或重载后的证据。

因此可以继续采用「独立 IIFE + 本页 SDK 注入」和「来源分组协调 + 宿主历史」设计，不能把最小探针升级成完整稳定契约已兑现的声明。后续先将这些路径接入公开消费样例及真实生产控制器，再开展规格中的完整验证。


