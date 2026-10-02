# feat: 正文嵌入接入目标文档编辑、保存与历史

本地编号：P2-04

GitHub：[#281](https://github.com/ONEGAYI/vsidian/issues/281)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#279](https://github.com/ONEGAYI/vsidian/issues/279)（P2-02）、[#280](https://github.com/ONEGAYI/vsidian/issues/280)（P2-03）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `d166ec7`）。五项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U04–U06、U09–U12、U16；验收 P2-A02–A05。

## 问题与交付

第一条可写链路需从可见嵌入实例一直证明到 B 的宿主文本与历史，不能分成只有协议或只有 UI 的半成品。

正文独占行嵌入可继承／单独切换内部模式；可见 Live 通过 B 会话编辑全文、保存并撤销／重做，Reading 仍禁写。

## 实施范围

- 复用可用的 B TextDocument／DocumentSession，以经过宿主验证的来源绑定实例编辑端口；根面板身份与目标会话身份分开。
- 协议与校验、版本／seq、CRLF、ack／外部同步、dirty 推送和 UI 在本票闭环。禁止任意目标 URI、Reading 写请求和释放后写入。
- 可见且内部 Live 才创建 EditorView；覆盖父 Reading／Live、默认继承与手动覆盖，按位置记忆模式和编辑状态。
- 焦点内 Ctrl+S／undo／redo 使用 P2-01 通过的 B 路由；回 A 恢复 A 操作。头部显示 B 未保存状态与保存入口。
- 本票先跑通普通文本、基础同步和宿主操作；完整命令／结构内容接线由 P2-10，资源由 P2-11；旧只读路径保留到新链路验证完成。

## 验收标准

- [x] 父 Reading 和 Live 的嵌入都能单独进入内部 Live，普通输入只修改 B，A 引用文本和 dirty 不被误改。（集成例 1：A 会话 appliedEdits 零推进；browser embedLive 场景 B 真实键入）
- [x] 未手动选择跟随父模式；手动选择在父切换后保留，同目标两个 occurrence 的位置／选区不串。（集成例 1 断言两独立 portId；jsdom/browser 钉记忆语义）
- [x] B 保存、历史和外部视图同步与真实 TextDocument 一致；B 与 A 交错编辑时焦点路由正确。（集成例 1/2：保存、P2-01 激活路由收口；browser 场景 C/D/E：Ctrl+S/Ctrl+Z 焦点路由真实键盘）
- [x] 旧版本安全重定位、不可安全写回暂停、CRLF 坐标、重复 seq 和迟到端口回包有目标文本断言。（集成例 2/3：重复 seq 恰一笔、释放后写入 B 文本/版本零变化、暂停后 B=外部版本、CRLF 回读保真）
- [x] Reading 无写端口且所有写意图被拒绝；可见性切换与实例释放不留下 EditorView／会话端口。（jsdom：Reading 零 refEdit 出站、unbind 后零泄漏；browser：编辑器计数断言）

## 执行记录（2026-10-03）

实施在独立树 `D:/.codex/worktrees/p2-04` 完成（TDD 先红后绿，红期 `logs/p2-04/p204-red-phase.log` 25 项先红），提交 `d166ec7`（30 文件 +3112/−59），经 `--no-ff` 合入 PR #313 分支（`bcdd97b`）。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过（独立树 + 合并树各一轮） | `logs/p2-04/p204-compile.log`、`merged-compile.log` |
| `npm run test:unit` 全量 | 239 文件 / 5179 用例全绿（新增 30 例） | `logs/p2-04/p204-unit-full3.log` |
| browser 嵌入族 8 套件（含新 embedLive 8 场景） | 全绿 | `logs/p2-04/p204-browser-final.log`、`p204-browser-embedlive-final.log` |
| browser 悬停/键位回归 6 套件 | 全绿 | `logs/p2-04/p204-browser-hover2.log` |
| 定向集成（1.82.3 真宿主，P2-04 用例 + 8 既有例） | 11/11 | `logs/p2-04/p204-integration-final2.log` |
| `npm run check:stylecontract` | 8 项零失败 | `logs/p2-04/p204-stylecontract-final.log` |

**鲜度核查**（父代理 stat 复核）：生产码最晚改动 02:18:30，其后仅单测文件编辑（02:23:04）——unit（02:23:43）/browser-embedlive（02:23:57）/集成（02:24:24）/样式契约（02:22:43）对其覆盖面均新鲜；独立树 compile（02:18:30）未覆盖最后两次单测编辑的类型面，父代理在合并树补跑 compile 通过（`merged-compile.log`）闭合。

**核心设计与实施要点**：

- **端口双身份**：webview 侧 portId / 会话侧 virtualSessionId 分开（实施中曾误用 portId 注入 ready 被静默丢弃，修正后有集成断言钉住）；同一 B 只建一份 `DocumentSession`，根面板与目标会话身份分开。
- **撤销路由**：P2-01 激活路线 + 快照差分收口临时标签（1.82.3 实测 `Tab.isPreview` 不可靠）。
- **孙卡收口**：嵌入内部 Live 编辑器经宿主 facet 标记不挂孙卡（#223/#248 集成例暴露模块级单例管理器以 A 会话身份装载孙卡的问题）；嵌套结构完整接线归 P2-10。
- **装载次序**：先呈现 Reading 再在绑定成功时切 Live——伪宿主/慢宿主下卡片不空白，兼容全部既有套件。
- **键位**：`embedToggleMode` 操作注册（both 模式、非写、默认未绑定）；保存复用焦点内 Ctrl+S 不设独立操作——评估记录已写入 `docs/specs/keybindings.md`。
- **范围裁剪**（按票面归后续票）：嵌入编辑器内不挂孙卡/不接链接跳转/图片粘贴不劫持（P2-10/P2-11）；浮层内部 Live 锁定 Reading（P2-05）；冲突暂停 UI 仅状态行提示（完整界面归后续票）。

**实测新发现（移交后续票评估）**：撤销路由激活 B 期间，A 的 webview 被隐藏卸载（retainContextWhenHidden 关闭），恢复后重载、嵌入自动重绑（stale 端口释放闭环已实现并被集成例覆盖）——属「标签短暂切换」取舍的自然延伸，P2-05 建议一并评估观感。

## 复用入口与验证

src/host/documentSession.ts、textEditorProvider.ts；src/shared/protocol.ts；src/webview/refContentInstance.ts、embedCard.ts 与 Live 复用入口。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
