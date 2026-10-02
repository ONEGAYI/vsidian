# P2-01 真宿主探针结论：目标历史、丢弃、临时对比与关闭交接（VSCode 1.82.3）

调研日期：2026-10-02。状态：[#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）研究交付——探针已在本机 1.82.3 真宿主运行并留痕；自动化证据不等于用户人工验收，Remote SSH 与真实 IME／鼠标按 P2-A15 口径单列（见第 9 节）。

复现入口：`test/integration/suite/probe278.ts`（18 个用例，`VSIDIAN_TEST_CASES='P2-01' npm run test:integration` 定向运行）；证据行格式为 `[P2-01][tag] {JSON}`，随每次运行落盘 `.vscode-test/integration-dev.log`。本文引用的证据 JSON 均摘自 2026-10-02 实跑日志。

## 1. 总结论

**无阻塞路线**。票据要求的四条公开路线在 1.82.3 下界全部存在且可用；其中两条携带需要用户确认的取舍或语义边界，列在第 10 节，确认前不建议放行依赖实施票（P2-04／P2-05／P2-12／P2-13）。

| 路线 | 结论 | 一句话证据 |
| --- | --- | --- |
| A 活动时保存 B | **通过** | `TextDocument.save()` 无需激活 B 即落盘，A 的 dirty 与内容原样（`save-post`：`aDirty:true, bDirty:false`，活动标签仍为 A 的 custom） |
| 撤销／重做归属 B | **通过，带可见取舍** | 唯一公开路线是把 B 临时激活为活动编辑器再执行全局 undo／redo；实测撤销精准落 B、A 零波及，但标签栏出现 B 预览标签且活动标签短暂切换（第 4.3 节） |
| 文档级丢弃 | **通过，带语义边界** | 可用路线是激活 B 后无参 `files.revert`；带 URI 参数的形态在 1.82.3 **有害**（误清活动编辑器 A 的未保存修改），必须禁用；丢弃后 undo 能翻回已丢弃修改（第 5 节） |
| 临时副本原生对比 | **通过** | untitled 文档可作 `vscode.diff` 左侧、真实 B 作右侧；打开失败不清临时副本；对比页可免提示关闭且临时副本随之释放（第 6 节） |
| 父标签关闭交接 | **通过** | A 关闭后 `showTextDocument(B, {preview:false})` 交接：dirty 内容完整、标签钉住不被预览替换、已有 B 标签去重、在途写回完成后交接最新 dirty、干净 B 不打开（第 7 节） |

另有一项**修正 Q14 预期的边界发现**：脏 B 文档在**无任何编辑器**时确实驻留（交接路线的资源前提成立）；但用 Tab API **编程关闭**脏 B 的最后编辑器是「静默丢弃」——不弹确认、未保存内容不驻留、模型随即释放（第 8.2 节）。产品任何流程不得用 Tab API 关闭脏标签。

## 2. 证据分层

票据要求分开记录「API 存在」「探针通过」「Remote SSH 人工待验」。API 存在性承自规格已核实的 1.86.2 源码调研；探针在 1.82.3 下界真宿主验证；Remote SSH 未验证。

| 能力 | API 存在（1.86.2 源码） | 探针通过（1.82.3 实测） | Remote SSH |
| --- | --- | --- | --- |
| `TextDocument.save()` | 有 | ✔ 保存路由、只读盘失败保护 | 待人工 |
| `workspace.save(uri)` | **无此 API**（类型层即不存在，探针改用上一行路线） | — | — |
| 全局 `undo`／`redo` 命令 | 有；按活动编辑器路由（custom editor 分派取活动面板） | ✔ 守卫必要性、临时激活路由、preserveFocus 变体、共享历史、跨资源原子撤销 | 待人工 |
| `workbench.action.files.revert` | 有 | ✔ 无参形态（激活后）；**URI 参数形态证伪且有害** | 待人工 |
| `vscode.diff`（untitled 左侧） | 有 | ✔ 打开、失败保护、免提示关闭、资源释放 | 待人工 |
| untitled 文档（`openTextDocument({content})`） | 有 | ✔ 创建、驻留、随对比页释放、独立关闭释放 | 待人工 |
| `showTextDocument`（preview、preserveFocus） | 有 | ✔ 交接钉住、去重、激活路由 | 待人工 |
| `tabGroups.close` | 有 | ✔ 静默丢弃语义（脏编辑器） | 待人工 |
| `workbench.action.revertAndCloseActiveEditor` | 有 | ✔ 免提示关闭对比页与 untitled | 待人工 |
| A 关闭前置可取消事件 | **无**（`WebviewPanel` 只有 `onDidDispose`，规格已核实） | —（路线设计不依赖前置事件） | — |

## 3. 环境与口径

- 宿主：`@vscode/test-electron` 下载的 VSCode **1.82.3** 便携实例，独立隐藏桌面（`testHost.mjs` 默认 Windows 策略），fixture 工作区由 `runTest.mjs` 临时生成。
- A = 本扩展 custom editor（`onegayi.vsidian.editor`）打开的 `p201-*-a.md`；B = 同工作区独立文件 `p201-*-b.md`，对 B 的写入全部经 `workspace.applyEdit`——与产品 `DocumentSession` 写回同一宿主原语。探针不以命令 mock 冒充可行性证据。
- 每个用例独立文件对，结束前把缓冲与磁盘还原为 fixture 字节；探针已并入集成套件 core 组参与分片与 CI。

## 4. 路线一：A 活动时的保存与撤销归属（P2-A05）

### 4.1 保存只落 B

A 以 custom editor 打开且活动，A、B 各有未保存修改，B 全程无标签。`await bDoc.save()` 返回 true 后：磁盘 B 更新、`bDirty:false`；A 保持 `aDirty:true`、内容不变、活动标签仍是 A 的 custom。

> `[P2-01][save-post] {"aDirty":true,"bDirty":false,"diskB":"乙未保存 P2-01 save 乙第一行\n乙第二行\n","activeTab":{"kind":"custom",...}}`

注意 **1.82 类型层没有 `workspace.save(uri)`**；「不激活即保存」的公开路线就是 `TextDocument.save()`。

### 4.2 全局 undo 在 A 活动时命中 A（守卫必要性）

A 活动且 A 有自己的修改、B 也有修改时执行全局 `undo`：被撤销的是 **A**（活动 custom editor 的宿主历史），B 原样保留。

> `[P2-01][undo-guard] {"aText":"# P2-01 guard 甲面板\n\n甲正文行\n","aDirty":false,"bDirty":true,...}`

这是产品侧守卫的实证：为 B 调全局 undo 前**必须**先改变路由目标，否则撤销错误落到 A。

### 4.3 候选路由：临时激活 B（主路线）与 preserveFocus 变体

**主路线**：`showTextDocument(B, {preview:true})` 把 B 激活为普通文本编辑器 → 全局 undo／redo → `openWith(A)` 重显 A → `tabGroups.close` 收掉 B 预览标签。实测全程撤销精准落 B、redo 正常、A 零波及、无回声；B 预览标签收掉后回到初始形态。

> `[P2-01][route-activated] {"bTabs":["text"],"activeTab":{"kind":"text","label":"p201-route-b.md"},...,"tabs":[{"kind":"custom","label":"p201-route-a.md"},{"kind":"text","label":"p201-route-b.md"}]}`
> `[P2-01][route-final] {"bTabs":0,"aDirty":false,"bDirty":false,"activeTab":{"kind":"custom","label":"p201-route-a.md"},...}`

**可见代价（需用户确认的取舍）**：激活期间标签栏多出一个 B 预览标签，活动标签短暂从 A 切到 B 再切回；键盘焦点同样离开 A 的 webview。

**preserveFocus 变体**（不夺取焦点的期望落空了一半）：`showTextDocument(B, {preview:true, preserveFocus:true})` 后键盘焦点留在 A 的 webview，但**活动标签已是 B**，全局 undo 仍命中 B：

> `[P2-01][pf-shown] {"activeTab":{"kind":"text","label":"p201-pf-b.md"},"activeTextEditor":"...p201-pf-b.md",...,"activeTextEditorIsB":true}`
> `[P2-01][pf-undo-landed] {"landed":"B","aDirty":true,"bDirty":false}`

即 undo 路由跟随**活动编辑器**而非键盘焦点；该变体把代价收窄为「活动标签高亮跳动、无焦点转移」，但不消除标签可见变化。

### 4.4 B 两视图交错编辑共享宿主历史

B 以两列两个文本视图打开，三笔编辑分别经视图一、`applyEdit`（产品写回原语）、视图二交错写入；激活 B 后连续三次 undo 逆序撤销全部三笔（回到已保存内容并清 dirty），三次 redo 逐笔恢复。历史归 B 的资源栈，与编辑来源视图无关——同一 B 多视图保持一致历史的契约成立。

### 4.5 宿主合法跨资源原子撤销

单份 `WorkspaceEdit` 同改 A 与 B 后，激活 B 执行**一次** undo：A、B 同时整体回退且双双清 dirty。

> `[P2-01][atomic-undo] {"aDirty":false,"bDirty":false,...}`

这是宿主把跨资源编辑记为单个原子历史元素的合法语义，与「只操作 B」的单文档路由分开记录：产品不得把这类整体回退误报为路由错误。

## 5. 路线二：文档级丢弃（P2-A09）

### 5.1 `files.revert` 带 URI 参数在 1.82.3 证伪且有害——禁用

`executeCommand('workbench.action.files.revert', bUri)` 实测三项副作用，全部复现于两轮运行：

- **不按参数定位**：B 未被回退（3 秒内 `bDirty` 仍 true）；
- **误清活动编辑器**：活动 A 的未保存修改被丢弃（`misrouteHitA:true`）；
- **副作用开标签**：B 被以**默认编辑器**（即本扩展 custom editor）打开一个多余标签（`strayCustomB:true`）。

> `[P2-01][revert-uri-arg] {"uriArgRevertedB":false,"misrouteHitA":true,"strayCustomB":true,"aDirty":false,"bDirty":true,...}`

这条形态在任何实现票中都不得使用；「丢弃指定 B」不能借 URI 参数跳过激活。

### 5.2 可用路线：激活 B 为文本编辑器后无参 revert

`showTextDocument(B, {preview:true})`（恒开**文本**编辑器）激活 B 后无参 `files.revert`：B 整体回到磁盘内容、清 dirty（`bVerBefore:3 → bVerAfter:4`）。A 全程不受影响。注意激活必须走 `showTextDocument`——以默认编辑器形态打开 .md 会落进本扩展 custom editor（5.1 的副作用标签即证据）。

### 5.3 丢弃后 undo 能翻回已丢弃修改（语义边界）

revert 完成后再执行一次 undo：**已丢弃的两笔修改整体翻回**，B 重新变脏。

> `[P2-01][revert-undo-semantics] {"undoRestoresDiscarded":true,"bDirty":true,"bText":"乙二改 乙一改 P2-01 revert 乙第一行\n乙第二行\n"}`

即 revert 并不清除可撤销历史，只是把文档推回已保存态。产品「丢弃修改并关闭」在关闭 B 视图后不存在翻回入口，但 B 若仍有其他视图或此后被重新打开，用户的 undo 可以复活已丢弃内容——这是宿主合法语义，产品不得宣称「丢弃即历史清除」，也无需额外拦截。

### 5.4 确认期再变化被整体覆盖

模拟模态确认期间 B 版本前移（第二笔修改到达后再 revert）：丢弃覆盖**最新**状态（含确认期内的修改），版本从确认时点继续前移（`verAtConfirm:2 → verFinal:4`）。产品「确认期间 B 再变化需重新确认」建立在该原语之上：重新确认后执行的是覆盖最新状态的同一条路线。

### 5.5 保存失败不误清 dirty、不误丢弃

磁盘文件置只读（Windows 只读属性）后 `TextDocument.save()` 返回 **false**（不抛错）：B 保持 dirty、内容原样、磁盘未被污染；恢复可写后同一 API 保存成功且落盘一致。

> `[P2-01][ro-save-failed] {"saveOutcome":false,"bDirty":true,"bText":"乙改 P2-01 ro 乙第一行\n乙第二行\n"}`
> `[P2-01][ro-save-recovered] {"bDirty":false}`

「保存失败保留现场」的契约在原语层成立；产品需把 false 分支呈现为失败并保留 B 现场即可。

## 6. 路线三：临时副本与原生对比（P2-A10）

### 6.1 untitled 作 vscode.diff 左侧

`workspace.openTextDocument({content, language:'markdown'})` 产出 untitled 文档，`vscode.diff(untitled, bUri, title, {override:true})` 打开对比页：活动 tab 为 `TabInputTextDiff` 且左侧=untitled、右侧=真实 B；左右内容完整可读；B 的 dirty 与内容零扰动；B 没有产生独立文本标签（对比页是它唯一的视图形态）。

> `[P2-01][diff-open] {"leftLen":18,"rightDirty":true,"bTextTabs":0,...,"activeTab":{"kind":"diff","label":"冲突对比（左临时右真实）"}}`

`override:true` 沿用既有 #38 结论：避免右侧 .md 被默认编辑器解析成 custom editor。

### 6.2 打开失败不清除临时副本

右侧换成不可解析的未知 scheme URI：命令**不抛错**（resolved），而是打开一个带错误侧的对比页；临时副本内容原样，随后用同一临时副本成功打开左右正确的对比页——失败不消耗输入。

> `[P2-01][diff-fail] {"failure":"resolved","tempIntact":true,...}`

「打开对比失败不清除原输入」在探针可控的失败形态下成立；真实「目标被删除」等形态由宿主错误侧呈现，产品侧不变式仍是「转交成功前保持暂停与快照」。

### 6.3 关闭与资源释放

对比页关闭走 `workbench.action.revertAndCloseActiveEditor`（免提示丢弃未保存内容并关闭，无宿主确认弹窗）：临时副本（untitled 恒为未保存态）随之释放，B 内容完好。

> `[P2-01][diff-closed] {"closeChannel":"revert-and-close","dirtyWhileDiffOpen":true,"tempStillOpen":false,"tempTextIntact":true,...}`
> `[P2-01][untitled-released] {"closeChannel":"revert-and-close","uri":"untitled:Untitled-1"}`

untitled 独立标签同样经该命令从 `textDocuments` 释放（poll 断言通过）。**未自动化边界**：用户以 UI 关闭按钮关掉「左侧含未保存 untitled」的对比页时宿主会弹保存确认——自动化探针为避免模态卡死不触发该路径，形态留人工验证；产品实现应优先自驱关闭（同命令）而非依赖用户手关。

## 7. 路线四：父标签关闭交接（P2-A11）

**基本交接**：A（干净）以 custom editor 活动时执行 `closeActiveEditor`，A 标签消失后 `showTextDocument(B, {preview:false})`：B 以文本标签打开、内容为 dirty 当前值、`isDirty:true`。`preview:false` 的钉住以行为学断言钉死：随后以 `preview:true` 打开旁观文档 C，B 标签不被替换。

> `[P2-01][hand-opened] {"bTabs":["text"],"cTabs":["text"],"bDirty":true,...}`

**已有 B 标签去重**：B 已有钉住文本标签时，交接后 B 标签数仍为 1（复用不重复开）。

**在途写回**：`applyEdit` 尚未 resolve 时关闭 A，写回照常完成；交接打开的 B 包含该笔最新修改且 dirty——「等待在途提交再检查最新 dirty」的原语层成立。

**干净 B 不打开**：B 干净时关闭 A，无任何 B 标签出现。

**窗口退出边界（记录，不自动化）**：窗口退出／重载时扩展主机进入停机，`showTextDocument` 不再可用，交接不适用；该边界已写入二期规格（不扩大为退出后自动重开的保证），产品实现按「普通标签关闭的 `onDidDispose` 才交接」约束即可。

## 8. 宿主语义观察项（实现票须知）

这些不是四条路线的验收项，而是实现时容易踩的 1.82.3 实测语义：

1. **dirty 是保存版本态，不是内容相等**。经 applyEdit 把内容改回与磁盘一致，`isDirty` 仍为 true（`recycle-restore-quirk: {textIsBase:true, isDirtyAfterEditRestore:true}`）；undo 回到已保存版本才清 dirty（`pf-undo-landed` 中 `bDirty:false`）。对账逻辑必须读 `isDirty`，不能拿「内容==磁盘」当干净判据。
2. **Tab API 编程关闭脏编辑器 = 静默丢弃**。`tabGroups.close` 关闭脏 B 唯一编辑器：无确认弹窗、无挂起、返回 true；未保存内容不驻留（模型从 `textDocuments` 消失），重开只剩磁盘内容。产品任何「关闭」流程都不得对脏标签使用 Tab API；需要丢弃时走 5.2 的 revert 路线（保模型、可继续会话）。
3. **`showTextDocument` 恒开文本编辑器**；但让宿主按默认编辑器解析 .md（如 `files.revert` 的 URI 副作用）会落进本扩展 custom editor。对 B 的所有「以普通编辑器激活」都必须显式走 `showTextDocument`。
4. **干净文档不急于回收**：无编辑器的干净 B 在 1.5 秒观测期仍在 `textDocuments`（会话级缓存）；这不影响交接（交接只依赖 dirty 驻留，已证）。

## 9. 未覆盖与人工待验清单

- **Remote SSH**：全部路线均为扩展主机内 API 调用，机制上与本地同源；但标签切换、焦点与 dirty 链路在远程窗口的实际观感未验证——P2-A15 人工清单项。
- **真实中文 IME 与物理鼠标**：P2-A08 口径，本票不冒充已验。
- **UI 关闭含未保存 untitled 左侧的对比页**：宿主确认弹窗形态（自动化避免模态卡死，见 6.3）。
- **窗口退出／重载、Hot Exit 恢复**：沿用宿主能力，不属本票路线（第 7 节边界）。

## 10. 放行建议与待确认取舍

P2-01 自身结论：**通过，无阻塞**。以下两项按票据「不能默认获准取舍」的要求列出，需用户确认后放行依赖票：

1. **撤销路由的可见代价**（影响 P2-04、P2-10）：为 B 撤销／重做的唯一公开路线会把 B 临时激活为活动编辑器——标签栏出现 B 预览标签、活动标签短暂切换（preserveFocus 变体可保住键盘焦点，保不住活动标签切换）。请确认接受该取舍，或选择放弃「宿主历史」改为其他方案（后者超出二期契约，需重开讨论）。
2. **丢弃后的 undo 翻回语义**（影响 P2-05、P2-13）：revert 后用户在 B 的任一视图中 undo 可复活已丢弃修改（宿主合法语义）。请确认产品按「不宣称历史清除、不额外拦截」处理。

确认后 P2-04（正文嵌入接入目标编辑）的全部前置（P2-01、P2-02、P2-03）即可按索引依赖推进；P2-05／P2-12／P2-13 的本票前置同样满足。
