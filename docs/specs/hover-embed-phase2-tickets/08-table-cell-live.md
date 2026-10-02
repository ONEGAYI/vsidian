# feat: 表格格内嵌入目标 Live 与父表格输入隔离

本地编号：P2-08

GitHub：[#285](https://github.com/ONEGAYI/vsidian/issues/285)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U07、U12、U24；验收 P2-A02–A04、A08、A09、A12、A13。

## 问题与交付

格内引用有源码、转义解码和渲染三套坐标，父表格按键处理不能误把 B 的输入当成 A 格编辑。

表头／数据格内的既有嵌入可进入完整目标 Live，精确映射、焦点、测量和释放正确。

## 实施范围

- 复用 tableCellEmbed 的格内解码与原始 occurrence 坐标，保留转义 | 和别名，不混用解码偏移写 A。
- 进入 B 后内部 EditorView 接管实际输入／选区／滚动，父格导航与父表格操作不截获目标事件。
- 支持父 Reading／Live 和模式覆盖，共享保存／历史／dirty／关闭保护及实例状态。
- 卡片宽度、高度和内部视口跟随格空间，不能退回全文 DOM 常驻或撑坏父表格。

## 验收标准

- [ ] 含转义竖线、别名、相邻文本的表头与数据格，A 源码和索引落点保持，输入只改 B。
- [ ] 目标内 Enter／Tab／方向键／选择／菜单不执行 A 表格导航或增删行列，焦点回父格后恢复原行为。
- [ ] 父两种模式、目标两种模式、三种链接形态覆盖；Reading 零写回。
- [ ] 内部滚动位置和选区重挂载可恢复，变高测量与可见绘制正确，输入保护和删除取消保持。
- [ ] tableEmbed 和原生 tableCaret 回归通过，不只断言 DOM 存在。

## 复用入口与验证

src/webview/tableCellEmbed.ts、embedCard.ts 与父表格输入路径；test/browser/tableEmbed.mjs、tableCaret.mjs。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
