# refactor: 提炼多类型只读访问与内容挂载入口

本地编号：P3-01

GitHub：[#333](https://github.com/ONEGAYI/vsidian/issues/333)

父票：[#228](https://github.com/ONEGAYI/vsidian/issues/228)

Blocked by: 无本地前置票

状态：2026-10-04 用户确认方案及 12 票拆分，已发布；未实施。无本地前置，已标 ready-for-agent。P3-02／P3-03 的依赖解除要求可行路线通过，不能仅凭研究票关闭。

规格：[三期正式规格](../hover-preview-embed.md)；用户故事 P3-U1、U8、U9。

## 问题与交付

增加兼容的类型分派入口，原有 Markdown Reading／Live 行为保持等价。

## 实施范围

- 采用先增加入口、再迁移、最后收口的顺序。区分根面板、直接来源、occurrence、目标和挂载代次；沿用来源租约、版本仲裁与释放。
- 将 Markdown 载荷与附件／外链载荷按类型区分，导航选择器也按文件类型区分。Markdown 的 TextDocument.version 和 LF 范围不能冒充 PDF／图片的版本或页码。
- 提炼最窄的内容挂载生命周期接口，由容器提供空间、焦点、关闭和释放。保留旧 Markdown 调用入口的兼容适配，不在本票实现附件、网络请求或全局重写。
- 生产 Markdown 首跳、递归、正文卡片与悬停走新增入口，保持二期编辑端口、保存、历史和 dirty 关闭契约。

## 验收标准

- [ ] 既有全文／标题／块 Markdown 在 Live、Reading、浮层、混排／列表／引用／表格中呈现和目标归属等价，新增入口的生产浏览器回归通过。
- [ ] 运行期校验拒绝未知类型、类型与载荷不匹配、来源伪造、过期挂载、释放后回包；旧合法 Markdown 消息仍可识别。
- [ ] 只读挂载不取得 refEdit 写端口；相同目标两个 occurrence 的滚动、焦点与释放互不影响。
- [ ] 创建／卸载循环后新增计数归零，既有来源 watch、实例和字节预算没有被绕过。

## 复用入口与验证

src/host/hoverDocAccess.ts、src/shared/protocol.ts、src/webview/refContentInstance.ts、embedCard.ts、hoverPopup.ts；既有 hover／embed 单测、生产 browser 和真宿主引用回归。

## 明确排除

PDF 引擎、文本高亮路线、图片新语法、外链抓取；不删除历史公开样式入口。

## 共同完成条件

- 对可执行行为先补能暴露目标问题的契约测试，再实现；采用生产 browser／真实宿主等既有高层入口，不只检查消息调用次数或 DOM 存在。
- 呈现变更先加载项目 style-contract、固定旧契约，提供实际绘制和 CSS 契约证据。所有用户文字经 locales／t()，设置只进 Vsidian 自有页面。
- 每个新增操作登记可绑定入口、默认值和有效状态；只读内容不接管写操作，焦点和 Esc 沿用已有优先级。
- 来源验证、请求代次、目标版本、挂载释放及已存在预算都必须保持；自动化通过不等同用户验收。首次长命令即落盘日志和退出码，复核读取报告。
- 每票按一个新 agent 上下文安排；发现需要扩大接口／产品范围时报告增量并重切片，不将不完整行为标为完成。本票不授权推送、PR、合并或版本发布。

完整依赖与发布次序见[票据索引](README.md)。
