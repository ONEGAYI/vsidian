# feat: 递归引用的直接父模式与逐层目标编辑

本地编号：P2-09

GitHub：[#286](https://github.com/ONEGAYI/vsidian/issues/286)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#283](https://github.com/ONEGAYI/vsidian/issues/283)（P2-06）、[#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）、[#285](https://github.com/ONEGAYI/vsidian/issues/285)（P2-08）

状态：已发布（2026-10-02），尚未实施。前置票验收通过后再实施；暂不加 ready-for-agent。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U08、U09、U12、U25；验收 P2-A02–A04、A08、A12、A14。

## 问题与交付

递归子引用必须跟随直接父内部模式，而其写入和资源归子目标，不能沿用根 A 的模式与操作路由。

所有既有递归容器按共享实例模式挂载，B 内 C 的文本编辑／保存／历史归 C，父子生命周期与预算闭环。

## 实施范围

- A Live、B 手动 Reading 时，C 默认 Reading；C 手动选择本次会话独立记忆。父为内部 Live 时可见子 Live 按需创建。
- 沿直接来源 B 的当前全文验证 C occurrence，逐级目标端口与祖先路径分开，不能用根文档或任意自报 URI。
- 覆盖悬停内、独占行／混排／列表／引用和表格格内的递归，父内部两种模式均覆盖。
- 祖先文档循环截断、兄弟重复合法；保留既有深度、实例、字节、在途及 watch 预算，父回收时子状态／输入保护有配对处理。

## 验收标准

- [ ] A／B／C 三份可区分文本：在 C 输入／保存／撤销归 C，回 B 再回 A 按焦点恢复目标。
- [ ] 直接父跟随和每级手动覆盖正确，父根 A 切换不覆写手动 B／C。
- [ ] 全文初始锚点之外的合法子引用可编辑；过期／伪造来源拒绝，循环与预算状态可见。
- [ ] 父目标刷新、祖先回收、切模式和快速开关不丢组合／在途输入，迟到子响应不复活已释放树。
- [ ] recursiveEmbed、hoverRecursive、refCombination 和 tableEmbed 的实际组合行为通过。

## 复用入口与验证

src/shared/refExpansion.ts；目标会话来源租约；src/webview/refContentInstance.ts、embedCard.ts 与各递归挂载。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
