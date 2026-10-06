# 双链联想 V01 探针：补写块 ID 与尽力撤销的真宿主验证

状态：2026-10-06 执行完毕；对应 [Issue #375](https://github.com/ONEGAYI/vsidian/issues/375)，票面见 [v01.md](../specs/wikilink-completion-tickets/v01.md)，主规格「文档查询、块 ID 与撤销」节见 [wikilink-completion.md](../specs/wikilink-completion.md)。本报告是给 T05（#380）的放行依据，不表示功能已实现或已通过用户验收。

## 结论先行

**放行 T05**：1.82.3 真宿主中，「目标文档补写块 ID＋来源接受链接」的协调路径全程可行，七类场景全部通过。给 T05 的核心可实施判据是——

> **尽力撤回 = 正向 WorkspaceEdit delete ＋双守卫**（补 ID 后目标版本未变、标记在记录 offset 逐字在场），**绝不走 undo**。undo 撤销的是目标「最近一笔」编辑，与本轮新增标记无对应关系，实测会吃掉 B 的无关输入。

七场景分类：成功 ×7；风险跳过 0；不可执行 0。两处宿主行为修订（dirty 清除时机、请求面板无回声）已写入下文，T05 实施时须一并遵守。

## 版本与执行方式

| 项 | 值 |
| --- | --- |
| 源码基点 | `f83c7292`（feat/375-v01-probe 分支基线，干净 main） |
| 宿主 | VSCode 1.82.3 便携宿主（复用已解压缓存，`VSIDIAN_TEST_VSCODE_PATH` 通道） |
| 探针工件 | `test/integration/suite/probe375.ts`（经 `VSIDIAN_TEST_CASES='V01'` 定向执行） |
| fixture | `test/integration/fixtures.mjs` 的 `v01-*.md` 组（13 个文件） |
| 报告日志 | `.vscode-test/integration-dev.log`（本轮副本 `out/test/v01-probe-run4-red.log`，宿主退出码 0，七项 PASS，总耗时 7.8s） |

与生产的同源性：块边界、ID 双形态、查重、插入计划取自 `src/shared/blockId.ts` 单一事实源；补写后定位核对走 `src/host/wikilinkTarget.findBlockOffset`（现有跳转口径）；目标侧写入用 WorkspaceEdit（与 DocumentSession 的 `HostDocumentPort.applyChanges` 同原语）；来源接受经 `_test.injectWebviewMessage` 注入生产 DocumentSession；来源撤销走活动 custom editor 的全局 undo（生产 `port.undo` 路线）。不新造镜像 mock 管线。

## 场景矩阵与证据

### 1. 跨文档·普通可写·版本未变（含重做）

**输入**：A（`v01-cross-a.md`，custom editor 双面板打开）引用 B（`v01-cross-b.md`，仅 `openTextDocument` 装载、无标签）的段落块。

**序列与观测**：

1. 补 ID：`p3iri9` 写入 B 块尾（`\n\n^p3iri9` 独立行，#163 默认形态），B 版本 1→2，dirty 但磁盘零写入；`findBlockOffset` 立即命中块首。
2. 来源接受：`edit.request` 注入生产会话，链接进入 A 权威文本；旁观面板视图同步（见「宿主行为修订」第 2 条）。
3. 来源撤销：全局 undo 一笔移除 A 的链接，`TextDocumentChangeReason.Undo`（枚举值 1）与版本推进（2→3）可观测；A 回到已保存内容自动转干净；**B 零波及**（无 undo 原因事件）。
4. 尽力撤回：双守卫通过 → 正向 delete 精确移除标记，B 回到原字节、仍 dirty、磁盘未写。
5. 重做：全局 redo 恢复 A 链接（`Redo`=2 的 reason 可观测）；目标重核发现标记已安全移除 → 重新计划并补写 `ik545h`，定位有效。

```
[V01][cross-undo] {"aVer":3,"aDirty":false,"aReasons":[{"version":2},{"version":2},{"version":3,"reason":1},{"version":3}],"bVer":2}
[V01][cross-withdraw] {"kept":false,"reason":"withdrawn","bVer":3}
[V01][cross-redo-rebuild] {"id":"ik545h","bVer":4,...}
```

### 2. 同文档引用：一笔受控操作

同一 `edit.request` 携带补 ID 与链接两段插入 → 一次 `applyChanges` → **权威版本恰 +1**（1→2）；全局 undo 一次同时回退两段并转干净（`aDirty:false`），redo 同时恢复。规格「合为该文档内一笔受控操作」在宿主层成立，无需额外交互。

### 3. B 未保存（dirty 目标）与 undo 路线反证

- **正路径**：B 先有用户未保存输入（v2），再补 ID（v3）；来源撤销后守卫撤回成功（v4）——用户输入原样、B 仍 dirty、磁盘未写。
- **反证**（T05 的关键负证据）：补 ID（v5）后 B 又有新输入（v6），走临时激活 B＋全局 undo（P2-01 已验证的唯一公开路线）——实测被撤销的是**用户输入**而非本轮标记：

```
[V01][dirty-undo-route-hazard] {"undone":"用户后行输入（非本轮标记）","markerStillThere":true,"bReasons":[...{"version":7,"reason":1}]}
```

redo 恢复输入后，守卫以 `version-changed` 拒收撤回（8≠5），标记与用户输入双双原样。**undo 路线被否证为撤回通道**；正向 delete 是唯一能「只撤回本轮标记」的路线。

### 4. 块形态矩阵与已有 ID 三落点

- 新增矩阵：段落块、无空行连续列表块（整体一块）、围栏代码块（闭围栏行后独立行标记）三类插入后，`findBlockOffset` 均命中各自块首，全文 id 集合收录。
- 已有 ID 三落点全部复用且零写入：行尾 `^keep01`、跨空行独立行 `^stand01`、紧贴独立行 `^tight01`（被块区间吞并）。
- 来源撤销后全文 id 集合逐项不变——**既有 ID 永不被清理**。

### 5. 目标被修改（版本/标记变化）

- 版本变化（他方修改，v3≠v2）：守卫拒收（`version-changed`）、标记保留、他方修改原样；**来源撤销不被阻塞照常完成**。
- 重做重核：标记仍在 → 复用、不重复补写（全文恰一处）。
- 标记被用户改写（`^8cu4o4`→`^mutate8cx`）：守卫拒收（版本先于标记判据触发——见「边界」）；重做重核认用户新标记，**不复活旧标记**（无重复插入）。

### 6. 来源接受失败（初次接受失败）

补 ID 成功后注入 `baseVersion` 超前的迟到 `edit.request` → 生产管线按「不可安全应用」拒收：面板暂停（`suspended:true`）、输入片段留存可观测（`fragments:["[[v01-fail-b.md#^90qv20|失败目标]]"]`）、权威文本零污染。收尾：守卫撤回成功，B 回原字节。

### 7. 来源/目标关闭与迟到协调

- 来源面板关闭（缓冲先还原干净，会话退役）后：迟到接受注入被测试钩子原生拒收（`无可用会话面板：…`）；迟到撤回由协调层按 `origin-closed` 拒收并保留标记——**不动 B、不抛异常**。
- 目标侧：B 从未以 custom editor 打开（无会话），TextDocument 照常可写可还原；`refPortStats` 全程 `size:0`（无嵌入场景端口面干净；嵌入端口的释放与迟到拒收语义已由 P2-04 既有用例覆盖，本探针不重复验证）。

## 宿主行为修订（T05 实施须知）

1. **applyEdit 还原不清 dirty**：把缓冲改回与磁盘同内容后 `isDirty` 不自动清除（宿主 dirty 按 buffer 版本判定，不按内容相等）；须显式 `save()`（内容幂等）或走 undo 回到已保存点。undo/redo 回到已保存内容时 dirty 自动清除（场景 1/2 实测 `aDirty:false`）。
2. **请求面板无回声**：`edit.request` 的请求方面板收 `edit.ack` 而非 `doc.changed` 广播；视图同步断言与调试观测须落在旁观面板。生产链路中真实 webview 输入本就先落本地视图，不受影响。
3. **变更事件层细节**：一次 WorkspaceEdit 在 1.82.3 观测到两条同版本无 reason 的 change 事件（宿主两阶段派发）；undo 的 reason=1（Undo）、redo=2（Redo），版本单调推进。判据只认「版本相等＋reason 有无」，不受重复事件影响。

## 边界与未覆盖

- **marker-changed 守卫为防御纵深**：任何标记改写都会推进版本，公开 API 下不可能「版本未变而标记已变」；该判据作为规格要求的标记核对保留，正常路径由版本守卫先行拦截。
- **只读/写入失败分支**：`apply-failed` 结果通道已定义（applyEdit 返回 false 时保留＋返回结构化结果），但 1.82.3 对合法编辑几乎总成功，本探针未能构造真实失败，未取得实证。T05 遇只读文件系统/Remote 断连时按同一守卫收尾。
- **CRLF 目标**：fixture 全 LF；标记插入点按「剥 \r 行尾」口径计算，CRLF 文档的行尾适配（插在 `\r` 之前会破坏行尾）留 T05 实施时按 NewlineCoordinator 口径处理。
- **toast 文案**：本探针只验证结构化结果通道（`kept/reason` 五态：withdrawn / version-changed / marker-changed / apply-failed / origin-closed）；用户可见文案属 T05，须走 `src/shared/locales/` i18n 字典。

## 验证留痕

| 轮次 | 结果 | 关键修正 | 日志（工作树 `out/test/`） |
| --- | --- | --- | --- |
| run 1 | 5/7（跨文档、关闭两项红） | 视图同步断言误落在请求面板；dirty 清除时机误解 | `v01-probe-run1-red.log` |
| run 2 | 6/7（跨文档仍红） | 同上第二处 | `v01-probe-run2-red.log` |
| run 3 | 7/7，退出码 0 | 双面板旁观断言 | `v01-probe-run3-red.log` |
| run 4（最终） | 7/7，退出码 0 | 迟到拒收证据改用钩子原生错误 | `v01-probe-run4-red.log` |

编译与类型检查 `out/test/v01-compile6.log`（退出码 0）；契约测试红→绿见 `v01-groups-red.log`（`用例数组不支持未知展开`）与 `v01-groups-green.log`（10/10）。探针失败轮日志均保留未删，修正只改探针自身，不动生产代码与既有断言。
