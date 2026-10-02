# feat: 父标签关闭后交接仍脏目标与当次输入

本地编号：P2-13

GitHub：[#290](https://github.com/ONEGAYI/vsidian/issues/290)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#278](https://github.com/ONEGAYI/vsidian/issues/278)（P2-01）、[#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#289](https://github.com/ONEGAYI/vsidian/issues/289)（P2-12）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。P2-01 必须给出满足契约的通过结论，阻塞结论不解除依赖。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U23、U24；验收 P2-A10、A11、A15。

## 问题与交付

A 标签不能被公开 API 前置拦截；B 已提交但未保存的修改需在 A 关闭后有可继续操作的独立标签。

普通 A 标签关闭后打开现有 dirty B 普通文本标签，去重并处理宿主已收到的未提交输入，不误承诺跨重启恢复。

## 实施范围

- 在 A onDidDispose 后等待宿主可继续完成的在途请求，取最新 B dirty；showTextDocument 现有 B、preview:false，重复目标和已有标签复用。
- 干净 B 不打开，不自动保存／丢弃，不从磁盘重读生成 B 副本，不把 A 伪造 dirty。
- 未成功写入 B 的输入与 B 文档交接分开，现有 detachPanel 通知复用 P2-12 的当次选择；取消不静默清除宿主已收到快照。
- 只覆盖普通标签关闭；退出／重载／SSH 断连沿用已有通知与宿主能力，不承诺 webview 未送达输入或扩展持久恢复。
- 打开交接失败显示可操作的当次反馈并保留宿主可用现场，不标记已保存。

## 验收标准

- [ ] A 本身干净而 B dirty 时，关闭 A 后 B 原生普通标签出现，TextDocument 身份／文本／dirty 与关闭前一致。
- [ ] 同一 B 多 occurrence 只交接一次，已有 B 标签不生成重复，干净 B 不自动打开。
- [ ] dispose 后才完成写回的 B 仍按最新 dirty 交接；不会因关闭时刻旧状态漏掉。
- [ ] 有未提交冲突版本时 B 标签不冒充包含该输入；当次三项选择可处理，失败不误报保存成功。
- [ ] 窗口退出／重载不会执行普通标签重开承诺，1.82.3 下界真宿主路径与 SSH 待验状态记录清楚，1.86.2 保留为已有调研对照。

## 复用入口与验证

textEditorProvider 的根面板 dispose、目标端口与会话持有；DocumentSession.detachPanel；原生 tab／TextDocument 真宿主测试。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
