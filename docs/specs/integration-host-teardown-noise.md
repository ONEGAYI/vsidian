# CI Linux 集成宿主收尾退出噪声：归因与边界（#211 落档）

> 状态：**追查完成，归因上游（VSCode 1.86.2 宿主收尾竞速），缓解保留**。
> 本文档是 #211 的边界落档：解释噪声的确切机制、为何不再追产品侧修复、
> 以及现有缓解为什么必须长期保留。

## 现象回顾

CI Linux（xvfb + `--disable-gpu`）集成分片出现与用例成败无关的收尾噪声：
本片全部用例 PASS 后约 0.3 秒，扩展宿主报
`Extension host test runner error { name: 'Canceled' }` 并以退出码 1 结束。

2026-09-29 的五轮确定性复现（run 36533194954 / 36536043859 / 36537301428 /
36537956726 / 36538615674 的 shard 3/4）全部落在同一用例组合上：末位用例
「设置页：索引维护分页可达」、倒数第二「出链面板：空态与失败态」。本地
Windows 四分片全绿，从不复现。

## 机制归因（三方归一：VSCode 宿主）

退出码 1 的确切抛出点在 VSCode 1.86.2 产物
`workbench.desktop.main.js` 的测试完成路径：

```
Q = await extHost.extensionTestsExecute()   // workbench → ext host 的 RPC
} catch (Z) {
  console.error(Z)                           // ← 日志里的 Canceled 打印
  Q = 1
}
this.Qb(Q)                                   // → Asking native host service to exit with code 1
```

ext host 侧（`extensionHostProcess.js`）在测试 `run()` resolve 后回包
`ye(0)`。红绿两轮日志的时间线一致：末例 TIME 后 **~270ms** 出 Canceled，
且 main 进程随后记录 ext host **以退出码 0 干净退出**——即 ext host 并非
崩溃，而是**回包在途时连接先被拆除**，RPC 以 `Canceled` 拒绝。

三方排除：

- **不是扩展代码异常**——扩展侧异常会带栈与消息经同一 catch 打印，观测
  载荷是裸 `{ name: 'Canceled' }`；
- **不是 @vscode/test-electron**——它只读取宿主退出码；
- **归 VSCode 宿主**：workbench 与 ext host 在测试完成响应投递与收尾拆除
  之间的内部竞速，上游 1.86.2 行为。

触发面与分片用例组合相关：新用例合入改变取模分片后（#212/#213/#214
时代起），shard 3 末例换为 rename 用例，噪声连续多轮未再出现；收尾路径
代码当时并未修改。这意味着竞速是**潜在**的——未来分片组合若再次落到同
形态的收尾负载（设置页面板关闭 + 索引服务在途），噪声可能回归。

## 既有缓解（长期保留，勿移除）

1. **末例落定等待**（58202b4）：设置页用例补「等 onDidDispose 落定」再
   收尾——降低收尾在途负载，本身语义正确；
2. **报告驱动片判定**（3c5a4dd，`test/integration/runTest.mjs`）：宿主
   退出码非零时读该片报告统计 `[集成测试][FAIL]` 行数，为零则放行并打
   `WARN（收尾退出噪声放行）` 留痕，非零照常判败。**不掩盖真实失败**，
   WARN 行是回归时的归因入口。

## 边界与后续

- 不改产品侧视口/面板/dispose 逻辑追此噪声（归因已明确在上游，产品侧
  无缺陷证据）；
- 若噪声回归：先读 `gh run download` 的分片报告确认零 FAIL，再比对末位
  用例组合是否回到「设置页索引维护收尾」形态；
- 升级 VSCode 引擎版本（`engines.vscode`）时此边界需重验——上游修复后
  可移除报告驱动判定中的噪声放行（保留判定本身无妨）。
