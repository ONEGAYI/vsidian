# feat: 悬停 Live、文档标题与脏状态保活

本地编号：P2-06

GitHub：[#283](https://github.com/ONEGAYI/vsidian/issues/283)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U06、U16–U18；验收 P2-A03–A05、A08、A09、A13。

## 问题与交付

悬停当前统一按瞬态 Reading 销毁。Live 必须仅在目标 dirty 时保活，同时保持普通干净悬停的交互。

现有全部悬停入口接入同一引用 Live 能力，head 显示规范名称与 ·，按 dirty 判定普通关闭与显式退出。

## 实施范围

- 正文双链／本地链接、键盘预览及反链／出链入口保持现有触发规则；父模式继承和单独切换按实例实现。
- head 显示目标文档名称；B 未保存显示精确 ·，保存／丢弃清除后消失，不使用别名或 A dirty 代替。
- dirty Live 遇移出、外点、blur／visibilitychange 等普通关闭条件保活；干净 Live 按 Reading 现有规则关闭。
- 组合期、在途或冲突暂停输入不能按“B 干净”销毁；显式关闭按钮与 Esc 复用 P2-05。
- 干净浮窗重开恢复本次引用位置的模式／选区／滚动，无需旧 EditorView 常驻。一次一个浮窗，不新增固定、拖动、尺寸调整。

## 验收标准

- [ ] 所有既有入口均能继承或手动进入 Live，并实际修改／保存 B；键盘打开、焦点返回与修饰键规则保持。
- [ ] 名称、· 和模式／保存入口在绘制层可见，dirty 来自 B，清除后圆点消失。
- [ ] dirty Live 移出／外点／切应用仍在；干净 Live 对相同普通条件关闭，先输入后保存再离开正确重算。
- [ ] IME／在途结束后依据最新 dirty 处理，冲突暂停不吞输入；Esc 经过当前弹层优先级后执行已确认退出。
- [ ] 快速换目标与迟到回包不会重开已关闭浮窗，释放无残留订阅，干净重开恢复实例状态。

## 复用入口与验证

src/webview/hoverPopup.ts、hoverPopupGeometry.ts、refContentInstance.ts；hoverEntry、hoverPreview、hoverRefresh 生产 browser 与宿主。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
