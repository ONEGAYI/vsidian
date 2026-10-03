# 规格：外部搜索导航定位恢复（显式命令路径）

状态：已实施（显式命令路径转正；自动捕获按停止裁定移除）。工单 [#318](https://github.com/ONEGAYI/vsidian/issues/318)（保持 OPEN 跟踪上游）；上游阻塞 [microsoft/vscode#289785](https://github.com/microsoft/vscode/issues/289785)。本文是搜索定位恢复功能与边界的单一事实源；键位评估见 [keybindings.md](keybindings.md) #318 节，人工验收项见 [manual-verification.md](manual-verification.md) #318 节。

## 背景与根因

VSCode 全工作区搜索（Ctrl+Shift+F）命中 `.md` 后点击结果条目：原生 Markdown 编辑器会打开文档并**选中匹配 + 滚动到匹配处**；Vsidian 接管 `.md` 默认编辑器后只完成「打开文档」，定位一步丢失。

根因是 **VSCode 公开 API 缺口**，不是本扩展代码缺陷（2026-10-03 独立树实测，非回归——#38 接管以来该能力从未存在）：

- 与搜索点击同源的管线 `editorService.openEditor(resource, { selection })` 打开 custom editor 时，selection 在 workbench 层即被丢弃；
- 宿主侧扩展 API 零可感知信号：实测 `activeTextEditor=undefined`、`visibleTextEditors=[]`，selection/visible/active 三类事件全部零触发，`resolveCustomTextEditor` 参数面也无位置信息；
- 官方佐证：[microsoft/vscode#289785](https://github.com/microsoft/vscode/issues/289785)（2026-01-22 开、Backlog Candidates、尚无修复）。同源入口（问题面板点击、终端/编辑器 cmd+click 行号、Ctrl+P `file:line`）走同一 workbench 管线，推定一并丢失。

源码核查留档（copyMatch 输出格式、搜索视图选中语义、能力边界）见 [../research/vscode-search-view-internals.md](../research/vscode-search-view-internals.md)。

## 正式方案：显式命令定位

用户操作路径：在搜索结果列表中点击/键盘选中条目 → Vsidian 打开文档 → 执行命令「**定位到搜索选中结果**」（`onegayi.vsidian.searchReveal.locate`，命令面板可达；键位注册表已登记，**默认未绑定**，用户可经设置页自配）。意图判定交给用户显式按键，零歧义。

命令语义（宿主 `src/host/textEditorProvider.ts` wiring + `src/host/searchReveal.ts` 纯逻辑）：

1. **活动面板校验**：触发时活动 tab 须为 Vsidian 面板（非 Vsidian 面板或 5s 内未就绪 → 通知放弃，不误动其他文件）；目标 uri 在入口快照，快速连击时旧任务不得把位置落到后来激活的文件上。
2. **copyMatch 回读**：剪贴板三步捕获——写哨兵 → 执行内部命令 `search.action.copyMatch`（把搜索树**当前选中条目**的「1-based 起始行,起始列: 匹配行全文」写入剪贴板）→ 回读 → 恢复原剪贴板文本。哨兵未变（命令 no-op：无选中或文件级选中）识别为无输出。
3. **行文本唯一吻合校验**（文件身份的唯一校验）：解析出的行列须落在目标文档范围内，且该行文本（剥 `\r`）与预览文本完全吻合；不吻合即安全放弃。残留选中条目配对到其他文件时在此拦下。
4. **落位**：换算 LF 坐标后经 `view.locate` 发送（与双链锚点跳转同一通道）——单点光标落**匹配词首**（col 指向词首而非行首），flash 高亮由该通道既有语义提供；重握手补发兜底由 `documentSession.lastLocate` 既有机制承担。

失败反馈：无活动面板 / copyMatch 无输出 / 行文本不吻合，均以宿主通知（`host.searchRevealNotFound`，i18n 双语）反馈，不静默。

## 边界清单

- **单点定位不选词**：copyMatch 不提供匹配结束位置与长度，只能把光标落到匹配起始（词首），不产生区间选区；视觉补偿是 flash 高亮（整行目标段落级，与锚点跳转同款）。
- **文件身份靠行文本吻合**：copyMatch 不提供文件路径（copyPath 对 Match 级选中静默 no-op）；行号越界或行文本不吻合即放弃——宁可不定位，不误定位。
- **非文本剪贴板被覆盖**：三步捕获的恢复只能写回文本，捕获前的图片等非文本剪贴板内容会丢失（已知副作用，接受度由人工验收确认，见 manual-verification）。
- **命令缺失安全退出**：宿主版本无 `search.action.copyMatch`（或执行失败）时视为无输出，通知放弃，不抛错。
- **零 dirty**：纯视图定位，不写文档、不产生编辑历史。
- **CRLF 文档**：宿主系 offset（含 `\r`）换算 LF 后落位，webview 全程 LF 坐标。

## 自动捕获停止裁定（2026-10-03）

「面板激活时自动尝试定位」的原型路径已按 [#318 票面停止条件](https://github.com/ONEGAYI/vsidian/issues/318)**移除**（实现与歧义实证用例驻留原型分支 `dev/diag-search-reveal` 供复查）。三项证据：

1. **残留选中歧义已实证误定位**：搜索选中停留在甲文件条目时，纯切换（非搜索导航）激活一个「行 3 与甲同文本」的影子文件——行文本吻合校验被击穿，影子文件光标被拉离 0 到词首（日志留痕）。扩展侧无任何信号可区分「点击搜索条目」与「切回 tab」。
2. **已激活面板无事件盲区**：已激活面板上的再次导航（同文件下一条）不产生激活翻转事件，自动钩子对此失明（源码核查预警 + 实测撞上）。
3. **非文本剪贴板覆盖副作用**：每次自动捕获都要扰动剪贴板，自动路径把该副作用放大到全部面板激活时刻。

显式触发把意图判定交给用户按键，是零歧义的退让方案；本票保持 OPEN 跟踪官方 API。

## 官方 API 落地后的演进路径

上游请求形态为打开上下文透传 `selection?: Range`（vscode#289785）。落地后的实施面：打开上下文读取 selection → 换算 LF 坐标 → 复用既有 `view.locate` 通道。**协议已预留完整选区通道**：`view.locate` 的可选 `head` 字段（选区右端，LF 坐标）携带时 live 落位为区间选区 `[offset, head)`，补发链不降级为单点（`documentSession.lastLocate` 随定位意图一并留存 head）。期望口径（2026-10-03 用户裁定）：完全对齐原生——选中匹配文本 + 滚动到视口，高亮复用 #163「跳转目标高亮持续到下次操作」先例。官方 API 落地时，自动恢复路径与 #318 票面的反馈回路红测试（`vscode.open` 携带 selection）从原型分支转正。

## 测试钩子

- `onegayi.vsidian._test.takeSearchRevealLog`：取后清空定位恢复观测记录（`{ at, result }` 数组，`result` 为 `located / no-panel / no-match / no-fit`；上限 64 条）。仅 `VSIDIAN_TEST_HOOKS=1` 时注册，供集成用例「搜索定位恢复（#318）：显式命令矩阵」断言（分组登记见 [integration-test-groups.md](integration-test-groups.md)）。
- 单元契约：`test/unit/searchReveal.test.ts`（copyMatch 解析格式钉在 1.82.3 实测样例、行文本配对与 CRLF offset 换算）。

## 实施记录

- 原型验证（独立树 `dev/diag-search-reveal` @ `b6d8d13d`）：`view.locate` head 协议扩展、`src/host/searchReveal.ts` 纯逻辑、显式命令与自动开关 wiring、双语文案与键位登记、集成矩阵（显式/歧义）与诊断用例；结论回票见 [#318 原型验证结论评论](https://github.com/ONEGAYI/vsidian/issues/318)。
- 转正（2026-10-03，分支 `feat/318-search-reveal`）：显式命令路径措辞与用例转正（显式命令矩阵进 core 组）；自动捕获路径（`searchRevealAuto` 开关、激活钩子、`_test.setSearchRevealAuto`、歧义矩阵用例）与纯观测用例（信号盘点、命令面探针、反馈回路红测试）移除。
