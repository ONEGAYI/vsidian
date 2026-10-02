# feat: 混排、列表与引用块嵌入的 Live 编辑

本地编号：P2-07

GitHub：[#284](https://github.com/ONEGAYI/vsidian/issues/284)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#282](https://github.com/ONEGAYI/vsidian/issues/282)（P2-05）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U07、U12、U24；验收 P2-A02–A04、A08、A09、A12。

## 问题与交付

混排与列表／引用中的父源码位置、选区和几何不等同独占行，需要独立证明 B 输入不会触发 A。

段落混排、列表、任务列表与引用块等既有容器使用共享目标 Live，实现输入、选区、关闭和高度闭环。

## 实施范围

- 复用 embedSlots、嵌入精确 occurrence 与容器映射；前后文本、列表／引用标记和原引用源码保持。
- 覆盖父 Reading／Live、继承与手动覆盖；内部选区、键盘、菜单与滚动不被父正文截获。
- 沿用父 Live 的精确区间源码显隐，内部编辑不主动显露／改写 A 的引用源码。
- 内容高度变化唤醒父测量；离屏保存状态和关闭／删除保护使用共享路径，不建立独立实现。

## 验收标准

- [ ] 同段前后文本、列表项／嵌套列表、任务列表、引用块／嵌套引用中，输入只修改 B，A 保真。
- [ ] 内部光标、选字、Enter／Tab／复制与父编辑器不互相消费；reading 父仍能单独进入目标 Live。
- [ ] 引用源码显隐边界保持原 selectionTouchesRange 规则，B 选区不触发 A 的错误显源。
- [ ] 变高／变短、离屏／重挂载和活跃引用删除按共享状态与关闭语义完成，绘制不覆盖相邻文本。

## 复用入口与验证

src/webview/embedCard.ts、embedSlots.ts、liveEmbed 及现有混排容器；refCombination 等生产 browser。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
