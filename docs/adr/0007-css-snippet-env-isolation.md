# ADR 0007：CSS 片段的环境隔离依赖 globalState 宿主亲和

日期：2026-09-27
状态：已接受（工单 #131）

## 背景

CSS 片段（#128 起）把「用户级目录 + 逐片段开关 + 暂停标志」持久化在
`context.globalState` 的 `vsidian.cssSnippets` 键。#131 要求本地与不同
SSH 环境分别记录目录与启用状态：各环境内跨项目共用、远程配置不覆盖本地
目录、不做跨环境同步。核心设计问题：环境身份键怎么取，隔离靠什么保证。

## 对 1.86.0 API 面的事实核查（`@types/vscode 1.86.0`）

- `vscode.env.remoteName: string | undefined`（d.ts ~10103 行）：本地窗口
  （无远程扩展宿主）为 `undefined`；SSH 远程为 `'ssh-remote'`——这是**远端
  类型名**，不是机器名，无法单独区分两台不同的远程主机。另注意其文档：
  存在远程扩展宿主时本地与远程宿主**都**会读到定义值——单看 remoteName
  不能断定自己运行在哪一侧。
- `vscode.env.machineId: string`（d.ts ~10053 行）：扩展宿主所在机器的
  唯一标识；远程扩展宿主读到的是远程机器的 id。禁用遥测时可能返回占位值
  ——不能作为强制的机器身份依赖。
- `context.globalState.setKeysForSync`（d.ts ~7737 行）：Settings Sync 只
  同步经此显式登记的 globalState 键。**vsidian 从不调用它**（可 grep 复
  核），因此 `vsidian.cssSnippets` 不会被 Settings Sync 带到其他机器。
- `context.globalStorageUri`：宿主机器上本扩展 globalState 的物理归属目
  录，可作隔离证据的采集点（本地在用户数据目录，SSH 窗口在远端
  `~/.vscode-server` 下）。1.86.2 真实宿主实测：其 scheme 可为
  `vscode-userdata:`（虚拟用户数据文件系统）而非 `file:`——scheme 不在
  承诺面内，集成断言钉路径归属（`…/User/globalStorage/onegayi.vsidian`）
  而非 scheme。

## 决策

1. **隔离的权威机制：globalState 按扩展宿主机器持久。** VSCode 的 workspace
   扩展运行在工作区所在机器的扩展宿主（本地窗口=本地进程，Remote SSH 窗口
   =远端 `~/.vscode-server` 内的 Remote Extension Host），其 globalState 落
   在该宿主的用户数据目录。本地与远程是两份物理上不相交的存储：远程窗口
   的写入到不了本地 db，反之亦然——「远程配置不覆盖本地目录」由架构保
   证；同一台远程机器的多个窗口共享同一 db，恰合「同环境跨项目共用」。
2. **`extensionKind: ["workspace"]` 显式钉住。** package.json 原先不声明该
   字段、依赖 VSCode 对无声明扩展的推断。显式声明把「本扩展随工作区安装、
   在远程窗口运行于远端宿主」从推断变为契约，隔离架构不再取决于默认值。
3. **不按环境拆存储键。** 键恒为 `vsidian.cssSnippets`：单个 db 内只存在
   一个环境的数据，按键分桶是永不生效的死代码。环境身份不进键。
4. **防御性桶戳（值内分桶）。** 存储值内落 `envStamp`
   （`cssSnippetEnvStamp`：本地恒 `'local'`；远程
   `remote:<remoteName>:<machineId>`）。读取侧（`readStoredCssSnippetBucket`）
   只认本环境戳：#128 存量无戳采用当前环境（升级不清空已配置目录）；戳不
   匹配视为未配置且**不回写清空**——万一 db 被手工复制/搬运到另一环境，
   各环境只读写自己的桶，异桶数据原样保留。正常情况下（键永不分发、
   Settings Sync 不带走）该层是空转的保险，不是隔离的必要条件。
5. **环境身份的用途是观测与验收，不是执行。** `machineId` 占位值会让两台
   远程机器同戳（`remote:ssh-remote:unknown`，记录在案的降级）——因此桶戳
   不承担「区分两台远程机器」的硬保证，那仍由架构层（不同机器不同 db）承
   担。`onegayi.vsidian._test.getSnippetEnv`（VSIDIAN_TEST_HOOKS 门控）暴
   露 remoteName/machineId/appHost/globalStorageUri/isTrusted，供集成测试
   断言本地语义、供真实 SSH 人工验收记录远端读值。

## 证据链与验证设计

- **API 面**：上文 d.ts 行号可直接复核；`setKeysForSync` 全仓库无调用。
- **本地侧（自动化，真实 1.86.2 宿主）**：集成用例「环境身份与存储位置
  证据」断言 `remoteName === null`、`machineId` 非空、`globalStorageUri`
  为本机文件系统 URI 并打印读值入运行报告——证明状态存储位置绑定扩展宿
  主机器（同一绑定把远程窗口的状态放到远端）。
- **纯逻辑（单测）**：身份推导（本地/远程/空串防御/machineId 缺失降级）、
  桶戳稳定性（同机同戳、异机异戳）、分桶读写（异桶不读不写、存量采用、
  同桶含 paused 清洗）钉在 `test/unit/cssSnippetEnv.test.ts` 与
  `cssSnippetService.test.ts`。
- **远程侧（人工，不可 mock 冒充）**：见
  `docs/specs/manual-verification.md` 的 #131 清单——真实 SSH 窗口运行
  `_test.getSnippetEnv` 记录读值、双环境互设目录验证互不覆盖、重启回显。

## 后果

- 本地与 SSH、两台不同 SSH 主机之间：配置天然互不可见，符合验收；无跨机
  器同步（Settings Sync 不带此键，也不新增同步机制——工单明确不做）。
- VSCode profile 维度仍存在：同一机器不同 profile 的 globalState 各自独立
  ——「环境」粒度是「机器 + profile」，比「机器」更细，不与验收冲突。
- 若未来引入 UI 扩展形态（本地宿主运行、remoteName 有值的场景），
  `extensionKind` 契约与桶戳语义需重新评估——本 ADR 的架构保证以
  workspace 扩展为前提。
