# 规格：图片弹窗查看与防误触

> 状态：已实施（工单 [#212](https://github.com/ONEGAYI/vsidian/issues/212)，2026-09-29），人工验收按[人工验证清单](manual-verification.md) A11c 节逐项记录。交互契约复用图形化代码块（#111）的既有事实源 [graphic-code-block-interaction.md](graphic-code-block-interaction.md)，本规格只记图片侧的差异、边界与接入点；两文冲突时以本规格为准。

## 范围

- Markdown 图片（live 侧替换 widget 与阅读侧 `<img>`）接入与图形化代码块同款的「hover 按钮组 + 本体吞点击防误触 + 全屏弹窗查看」机制。
- 弹窗工具条：缩放 / 重置 / 刷新 / 导出 / 关闭。
- 不含：图片粘贴插入（#161 已交付）、`![[嵌入]]` 语法、图片解析与失效通道的新语义（复用 #201/#208 既有通道）。

## 已确认决策（2026-09-29 访谈）

| 决策点 | 结论 |
|---|---|
| 触发形态 | hover 显现按钮组，单击 popup 按钮开弹窗；图片本体吞点击（live 侧点击不再落位显源码） |
| 按钮组构成 | live 侧 edit + popup 两枚（与代码块同构）；阅读侧仅 popup |
| 行内与块级 | 行内图片与块级独图同一机制、同一按钮组 |
| 链接内嵌图片 | 不接弹窗、不出按钮组，点击保留链接跳转语义（明确排除） |
| 错误态 / 加载态 | 错误态维持点击重试；加载态无交互（loaded 态才有按钮，同构代码块「渲染成功态」） |
| 表格网格内图片 | 暂不接（后续有需求另开票） |
| 放大上限 | 沿用几何内核 0.05–40×，不特判位图（放大到糊是用户选择） |
| 导出语义 | 单按钮「导出」= 另存原图副本：宿主端字节级拷贝、保持原格式、走保存对话框；无「导出 SVG」 |
| 外链图导出 | 禁用（disabled + 悬停提示） |
| 文档编辑联动 | 弹窗维持打开时快照；「刷新」按当前文档重定位该图并重取；定位不到（图被删）维持快照 |

## 现状要点（勘察证据，实施时以代码现状复核）

- live 侧图片是 `LiveImageWidget` 行内 replace 装饰（`src/webview/liveLinks.ts:180-218`），`ignoreEvent()` 现返回 false——普通单击落位图片源码、widget 退场显源文，即本票要消除的误触。
- 防误触同款件：按钮组 DOM 由 `buildGraphicChrome` / `wrapGraphicFrame` 产出（`src/webview/graphicBlockChrome.ts`），CSS 默认隐藏、hover frame 或 `:focus-visible` 才显现（`src/webview/main.css:3393-3434`）；本体吞点击先例 `ignoreEvent(): true`（`src/webview/liveMermaid.ts:110-112`）；按钮 mousedown preventDefault 阻断 CM6 抢焦点（`graphicBlockChrome.ts:39-42`）。
- 弹窗：`openGraphicPopup` 单例全屏浮层（`src/webview/diagramPopup.ts:290`），prevFocus 焦点还原、Esc/空白/背板/关闭钮四路退出、body overflow 锁定；几何纯函数在 `diagramPopupGeometry.ts`。图片侧与其互斥（同时只允许一个弹窗实例）。
- 图片地址：槽位 `data-vsidian-img-src` 与 `ImageResourceManager` 已解析地址可直接复用；webview CSP `img-src` 已放行 webview 资源、https、data:（`src/host/editorCsp.ts:23-38`）。
- 链接内嵌图片现状：阅读侧点击冒泡到 `a` 触发跳转（`src/webview/syncController.ts:1074-1111`）；live 侧 Ctrl+点击跳转（`liveLinks.ts:627-639`）——本票不改此语义。
- 错误态点击重试已占用（`imageResource.ts:455-476`），保持。
- 图片不是围栏代码块，**不进 `RENDERED_FENCE_LABELS` / `graphicRenderers.ts` 两表注册表**；复用的是交互件（按钮组、弹窗、几何），接入点在 liveLinks widget 与阅读图片挂载钩子。

## 实施决策

- **触发与防误触**：live 侧 loaded 态图片按块级/行内统一挂同款按钮组（edit + popup）：edit 派发选区进图片源码起点并显源文（同代码块语义，解决吞点击后鼠标无法进入编辑）；popup 打开弹窗。阅读侧仅 popup。本体 `ignoreEvent(): true`（live 侧吞落位；阅读侧图片无落位语义，按钮组独立挂载）。
- **弹窗**：平行于 `openGraphicPopup` 的图片单例（或同层互斥改造），复用浮层/关闭/焦点/几何骨架；内容是 `<img>` 元素（已解析地址），缩放用 CSS transform（位图无矢量重排），平移/钳制/contain-fit 沿用几何纯函数。
- **导出**：新消息对 `image.export`（建议形态：reqId + 图片原始地址 + 建议文件名）→ 宿主定位工作区文件读字节 → 保存对话框 → 写目标文件；保持原格式字节拷贝，不经 canvas 光栅化。外链（http/https）图按钮禁用。消息协议扩展走 `src/shared/protocol.ts` 单一事实源与校验测试惯例。**解码口径**：消息载荷的 src 是 webview 侧 `normalizeImgSrc` 解码一次后的身份，与 `image.request` 完全同源——宿主不再二次 decode（否则含 `%XX` 字面文件名的图「看到的」与「导出的」错位，review-loops 轮 1 修正）；建议文件名同口径取 basename 并剥 query/fragment，纯点段与超长（与粘贴 fileNameHint 同限）回退 `image.png`。
- **刷新**：弹窗内「刷新」对该图走 `image.invalidate` 单源失效重取，并按当前文档重定位（图片移动后仍能追到，标准 `](目标)` 与尖括号 `](<目标>)` 两种形态都命中，含 %20 编码原文经 encodeURI 回查）；定位不到维持快照；外链直连条目无失效通道，刷新为 no-op（快照保持）。工具栏全局刷新（#208 `invalidateAll`）发生时弹窗内同图联动失效重载（同一资源状态机）。
- **零写回**：点击、hover、开关弹窗、导出、刷新均不改文档（图片纯显示资源契约）。

## 明确排除

- 链接内嵌图片（`[![a](i)](url)`）：不接弹窗不出按钮组，点击保留链接语义；需有回归测试钉住现状。
- 表格网格内图片：暂不接，行为不变（点击落单元格源码）。
- 外链图导出：禁用，不做宿主端网络下载。
- 图片元信息展示（尺寸/大小）：不做。

## 已知边界

- **字面 `%XX` 文件名的三重编码写法**：磁盘真名含字面百分号序列（如 `a%20b.png`）且源文以三重编码（`a%252520b.png`）引用时，正文显示经「webview 解码 + 宿主容错解码」两层可命中真名，而弹窗槽位的身份链多一层归一（openImagePopup 与 attach 各归一一次），弹窗装载与导出定位可能落空（呈现 error 态可重试，不误导出错误文件——宿主分类对解空的身份按 not-found 回报）。与正文显示通道同源的既有边界（review-loops 轮 2 P3-c 记录），修复需收敛弹窗与正文槽位的归一层次，另行开票处理。

## 验证与完成条件

- 单测：交互契约对齐 `test/unit/graphicInteraction.test.ts` 模式——按钮构成（live 双钮 / 阅读单钮）、吞点击（光标不动、widget 不退场、零写回）、edit 落位、弹窗开关与焦点还原、刷新重定位（含定位不到兜底）、导出消息形态、排除项（链接内嵌/错误态/加载态）现状钉住。
- 浏览器测试：真实 Chromium 对齐 `test/browser/graphicPopup.mjs` 模式——hover 显现（opacity 计算值）、缩放增实际尺寸、拖拽平移、0 重置、关闭恢复 overflow、导出内容形态。
- 集成：`VSIDIAN_TEST_HOOKS` 钩子（`image.test.popup` 类）驱动宿主侧观测。
- 视觉层断言落在绘制层（opacity/可见性/颜色），不止 DOM 存在性。
- 全量回归绿（test:unit / test:browser / test:integration）。
- 人工验证清单补真实鼠标项：hover 显现、单击吞、弹窗缩放平移、另存副本。
