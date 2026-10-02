# feat: 正文嵌入接入目标文档编辑、保存与历史

本地编号：P2-04

GitHub：[#281](https://github.com/ONEGAYI/vsidian/issues/281)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#279](https://github.com/ONEGAYI/vsidian/issues/279)（P2-02）、[#280](https://github.com/ONEGAYI/vsidian/issues/280)（P2-03）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。P2-01 必须给出满足契约的通过结论，阻塞结论不解除依赖。

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

- [ ] 父 Reading 和 Live 的嵌入都能单独进入内部 Live，普通输入只修改 B，A 引用文本和 dirty 不被误改。
- [ ] 未手动选择跟随父模式；手动选择在父切换后保留，同目标两个 occurrence 的位置／选区不串。
- [ ] B 保存、历史和外部视图同步与真实 TextDocument 一致；B 与 A 交错编辑时焦点路由正确。
- [ ] 旧版本安全重定位、不可安全写回暂停、CRLF 坐标、重复 seq 和迟到端口回包有目标文本断言。
- [ ] Reading 无写端口且所有写意图被拒绝；可见性切换与实例释放不留下 EditorView／会话端口。

## 复用入口与验证

src/host/documentSession.ts、textEditorProvider.ts；src/shared/protocol.ts；src/webview/refContentInstance.ts、embedCard.ts 与 Live 复用入口。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
