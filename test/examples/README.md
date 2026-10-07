# Vsidian 附加组件独立消费样例（T15）

状态：**随 #364 建立（2026-10-08）**。三套只使用公开 SDK 的可独立构建样例——每套是一个完整的独立 VSCode 扩展工程，共同检验 Vsidian 公开 API 不只为单一需求服务。规则依据 [ADR-0012](../../docs/adr/0012-vsidian-addons-distribution-api-governance.md)；接入流程与六组能力速览见[开发指南](../../docs/addons/developer-guide.md)。

## 三套样例

| 样例 | 工程目录 | 演示内容 |
| --- | --- | --- |
| 输入 | `input-behavior/` | 借鉴 Easy Typing 的中英文自动空格（atomic）、标点全角化（缺省 atomic）、括号补全（joinPrevious 非原子）；行为顺序组合、自身设置开关、平台逐项关闭（T07/T08） |
| 渲染 | `renderer/` | 接管内置 mermaid 与普通语言 sampleflow 的显示；同批双候选确定性默认序、用户首选按需调整；正常停用/全组件故障降级与恢复；自身缺陷候选的自处理降级（≠故障）（T09/T12） |
| 界面 | `ui-command/` | 自己的命令（统一快捷键管理）、右键菜单项、工具栏按钮（挂接命令/自带回调双路径）、统计面板；复杂设置三形态（enum/boolean/对象/数组）与用户默认/工作区分层；停用后配置保留与故障手动重试；自有设置页（T10/T11/T04/T05/T02） |

每套工程的形态：自有 `package.json`（`vsidianAddon` 身份声明、`extensionDependencies: ["onegayi.vsidian"]`、`extensionKind: ["workspace"]`、`engines.vscode ^1.82.3`）、`tsconfig.json`、宿主入口 `src/extension.ts`（构建为 `dist/extension.js` CJS）、页面入口（构建为 `dist/*.js` chrome114 IIFE，经 SDK 构建桥）。

## 构建与验证

```bash
# 构建全部三工程（产物在各工程 dist/，git 忽略；逐产物扫描：无 CM6 运行时
# 标记、无主仓库内部路径、页面零 require、宿主仅 require vscode）
node test/examples/build.mjs

# 定向单工程
node test/examples/build.mjs --name=input-behavior

# 结构契约单测（manifest 声明、源码 type-only 导入纪律、.vscodeignore 排除）
npx vitest run test/unit/addonExamples.test.ts

# 端到端（真宿主，安装/注册到可见结果——经 VSIDIAN_TEST_CASES 定向）
npm run test:integration -- 附加组件 T15
```

- 依赖可达性：esbuild 从仓库根 `node_modules` 相对解析（不新增 npm 安装）；SDK 构建桥与 CM6 标记表从 `test/fixtures/addon-v02/sdk/` 导入（公开 SDK 开发路径的单一事实源）。
- 页面源码的类型导入（`import type ... from '<主仓库>/src/shared/...'`）在 esbuild 构建期剥离——产物零内部依赖；产物扫描是第二道防线，`addonExamples.test.ts` 的导入纪律断言是源码层第一道。
- 样例用户可见文字走各工程自己的 zh/en 简单字典（`src/i18n.ts`；独立扩展自身惯例，不受 Vsidian 本体 i18n 体系约束）。

## 放行门控（共享测试会话防毒化）

三套样例的页面贡献（行为/渲染候选/命令/菜单/按钮/面板）默认在装载时注册——真实安装即自动生效（渲染样例自动接管、输入样例行为即时生效）。但**共享测试宿主**（`VSIDIAN_TEST_HOOKS=1` 的集成会话）中默认惰性：样例行为链会修饰全部真实键入、渲染接管会替换内置 mermaid 显示、命令与菜单会扰动目录断言——不门控会毒化整仓测试。集成用例经各样例自己的观测命令（`arm*`/`disarm*`）按需放行，判据与门控通道全部走公开面（页面装载时经通道询问宿主）。

## 观测命令（调试与测试）

每套样例的宿主注册观测命令（`contributes.commands` 声明，见各工程 package.json）：`stats`（生命周期与通道计数）、`arm*`/`disarm*`（放行门控）、`collect`/`reset`（事件收件箱）、`armCrash` + `releaseAndReRegister`（故障注入与手动重试配合，渲染/界面样例）。

## 复制到独立仓库（example-repo-plan 的落地预演）

独立示例仓库建仓时的复制清单（[准备说明](../../docs/addons/example-repo-plan.md) 的执行版——建仓需用户授权，当前不创建）：

| 内容 | 来源 | 复制方式 |
| --- | --- | --- |
| 三套样例工程 | `test/examples/<工程>/` | 整目录复制为 `examples/<工程>/`；`dist/` 不复制（按需构建） |
| 共享构建库 | `test/examples/tools/buildLib.mjs`、`test/examples/build.mjs` | 复制为 `tools/buildLib.mjs` 与顶层构建入口；其中对 `test/fixtures/addon-v02/sdk/` 的两处导入改指向随迁的构建桥 |
| SDK 构建桥 + CM6 标记表 | `test/fixtures/addon-v02/sdk/sdkBridge.mjs`、`buildAddon.mjs` 的 `CM6_RUNTIME_MARKERS` | sdkBridge 原样复制（`CM6_RUNTIME_MARKERS` 随 buildLib 迁移或从 buildAddon 摘出——两处定义需保持同源） |
| SDK 虚拟模块类型声明 | `test/fixtures/addon-v02/sdk/vsidian-addon-sdk.d.ts` | 复制到各工程（或共享 tools/）；tsc 靠 ambient 声明解析 `vsidian-addon-sdk` |
| 页面 SDK 完整声明 | `src/shared/addonPage.ts` 及依赖（addonEditApi/addonBehaviors/addonSettings/addonRenderers/addonCommands/addonUi） | vendor 快照（文件头注明 `// vendored from ONEGAYI/vsidian@<commit>`）；三工程源码中的相对 type 导入改指 vendor 副本 |
| 宿主侧声明 | `src/host/addons/addonRegistry.ts`、`addonWiring.ts` 的类型 | vendor 快照或沿用工程内自写的 `src/host-api.ts` 最小声明（现形态） |
| devDependencies | — | `typescript`、`@types/vscode`、`esbuild`（版本对齐主仓库 lockfile；无运行时依赖） |

主仓库内维护时，样例类型直接相对导入主仓库事实源（不漂移）；独立仓库的 vendor 快照按 example-repo-plan §2.3 的节奏 re-vendor。

## 已知边界

- 输入样例不承诺完整移植 Easy Typing（只取三个明确场景作消费演示）。
- 样例未声明 `experimental.cm6`（无 CM6 扩展需求）；构建桥的 CM6 拒绝与产物标记断言仍然生效。
- 渲染样例的 `mermaid-lite` 不解析 mermaid 源码（显示源码摘要框）——接管机制是演示重点，不是图表引擎。
- 跨宿主真重启语义（行为状态/键位/首选持久）由平台单测承载；集成用例以面板重开近似（与 T07–T12 用例同口径的已知边界）。
