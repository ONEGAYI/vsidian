# 独立示例附加组件仓库：准备说明

状态：**准备文档（2026-10-08，随 T13 #362 建立）**。本文是「独立示例仓库建起来时照抄执行」的清单——**当前不创建、不发布任何外部仓库、包或 Wiki**（ADR-0012「文档分发」：独立示例仓库的名称、创建和发布待后续安排，未授权当前创建）。Wiki 只作为展示入口，不取代主仓库事实源。

## 1. 定位与边界

- 示例仓库的目标读者是组件作者：展示如何消费 Vsidian 公开 API，覆盖输入处理、内容渲染、界面操作三类样例（ADR-0012「首批稳定 API 范围」）。
- 主仓库保留全部事实源：公开声明、语义清单、发行台账与版本参考（`src/shared/addonApiCatalog.ts` 生成链）。示例仓库**只消费、不定义**接口——签名以主仓库为准，示例代码出现类型不匹配时改示例，不改事实源去迁就示例。
- 开发文档不随 Vsidian VSIX 分发（`.vscodeignore` 排除 `docs/`，由 `test/unit/addonApiSurface.test.ts` 钉住）；示例仓库同理是独立仓库，不是 Vsidian 的打包输入。

## 2. 建仓时的内容规划

### 2.1 仓库骨架

```text
vsidian-addon-examples/        # 名称待定，创建前需用户授权
├── README.md                  # 三类样例索引、环境要求、许可证
├── package.json               # 开发依赖（esbuild、typescript）；无运行时依赖
├── examples/
│   ├── input-behavior/        # 输入类：行为注册 + 组合链（样板 t07Editor.ts）
│   ├── renderer/              # 渲染类：代码块渲染候选 + 图形导出（样板 t09Renderer.ts）
│   └── ui-command/            # 界面类：命令/菜单/按钮/面板（样板 t10/t11Editor.ts）
└── tools/                     # 构建桥（从主仓库复制，见 2.2）
```

每个样例是完整可打包的迷你扩展：自己的 `package.json`（含 `vsidianAddon` 声明与 `extensionDependencies`）、宿主入口（`registerAddon`）与页面入口（`defineAddonPage`）。

### 2.2 从主仓库复制的内容

| 内容 | 来源 | 复制方式 |
| --- | --- | --- |
| SDK 构建桥（esbuild 插件 + shim） | `test/fixtures/addon-v02/sdk/sdkBridge.mjs` | 原样复制；构建桥无 npm 包，SDK 载体发布前这是唯一形态 |
| SDK 类型声明 | `test/fixtures/addon-v02/sdk/vsidian-addon-sdk.d.ts` | 复制并把 `VsidianAddonPageSdk` 的导入指向随仓库 vendor 的声明快照（见 2.3） |
| 页面 SDK 完整声明 | `src/shared/addonPage.ts` 及其依赖（`addonEditApi.ts`、`addonBehaviors.ts`、`addonSettings.ts`、`addonRenderers.ts`、`addonCommands.ts`、`addonUi.ts`） | vendor 快照（仅类型与纯守卫，无 vscode/DOM 依赖，可整目录复制） |
| 宿主侧声明 | `src/host/addons/addonRegistry.ts`、`addonWiring.ts` 的类型（type-only 消费） | vendor 快照或自写最小声明（`registerAddon` 形状） |
| 构建脚本范式 | `test/fixtures/addon-v02/sdk/buildAddon.mjs`（chrome114 目标、CM6 标记断言） | 参考改写 |
| 样例源码 | `test/fixtures/addon-v02/addon/t07Editor.ts`、`t09Renderer.ts`、`t10Editor.ts`、`t11Editor.ts`、`t02Editor.ts`、`t02Settings.ts` | 摘除测试驱动协议（宿主夹具短轮询），保留业务注册部分 |

### 2.3 声明快照的维护约定

vendor 进示例仓库的类型声明是**快照**，标注来源主仓库提交（文件头注释 `// vendored from ONEGAYI/vsidian@<commit> src/shared/addonPage.ts`）。主仓库接口变更时：

1. 主仓库侧完成「清单 → 参考 → 样例」同步（开发指南 §7 的维护入口）；
2. 示例仓库按其自身节奏 re-vendor 并修复编译——**候选期内**接口仍可能调整，示例仓库不承诺逐提交跟随；**发行后**破坏性变更按稳定 API 弃用规则给出迁移期。

## 3. 发布前检查（将来执行）

- [ ] 用户授权创建仓库与命名
- [ ] 三类样例在隔离 profile 的便携宿主中从 VSIX 真实安装运行（复用主仓库 `test/integration/runInstalled.mjs` 的模式）
- [ ] README 链接的版本参考与台账状态与主仓库一致（候选 vs 已发布的表述不得失真）
- [ ] Wiki（如启用）内容从示例仓库 README 派生，标注展示日期与对应主仓库提交
