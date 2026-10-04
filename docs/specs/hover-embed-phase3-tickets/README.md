# 引用视图三期票据索引

**状态**：2026-10-04，用户确认七项产品答案、正式方案和 12 票拆分，并授权发布；#333–#344 已建立。首批 #333／#334／#335 已加 ready-for-agent，其余保留前置依赖。产品能力未实施，PDF 与文本路线尚未完成真实宿主验证。四期资源管理器小浮窗已按用户指示建立 [#330](https://github.com/ONEGAYI/vsidian/issues/330)，不阻塞本期。同日锚点语法修订：非 Markdown 目标锚点仅双链可控（PDF #page=N 收紧双链限定），可读文本新增 #line=N／#range=B-E（硬窗口）；受影响票据 P3-05／P3-08／P3-09 正文已同步。

唯一规格：[hover-preview-embed.md 的三期正式规格](../hover-preview-embed.md)。父票 [#228](https://github.com/ONEGAYI/vsidian/issues/228) 保持开放；二期 #227 已关闭。本轮文档使用当前独立工作树，不切换用户主工作树，不沿用旧票里失效的工作树路径。

## 已确认产品结果

- PDF 基础阅读：全文滚动、双链页码初始定位（#page=N，普通链接 fragment 不解析）、适合宽度／缩放、文本选择复制；不做搜索、区域引用／裁剪、OCR、标注编辑和页区间锚点。
- 图片双链嵌入按普通 Markdown 图片呈现与交互；不加另一套引用卡片壳或图片查看器，既有弹窗排除保持。
- 文本以原生文字高亮、当前主题、字体字号和行号为对照，双链 #line=N 控制初始定位与跳转锚点、#range=B-E 为硬展示窗口（可组合）；不复制插件诊断／行内提示，不做函数名等符号锚点。有高亮目标不能未经确认直接降纯文本。
- 外链预览总开关默认关闭，开启后默认标题摘要卡片，可改为原网页；原网页不可用时退回卡片、说明原因并保留浏览器打开入口。
- 原生 Explorer 独立小浮窗移四期 #330；本期不按右侧面板方案实现。

## 拆分与依赖

P3-01 是允许的准备性复用改造，P3-02／P3-03 是技术验证例外，其余功能票均形成入口、来源／数据、内容绘制与生命周期的纵向闭环。P3-12 只做组合和证据收口。

| 本地编号 | GitHub | 票据正文 | Blocked by | 可独立验证的交付 |
| --- | --- | --- | --- | --- |
| P3-01 | [#333](https://github.com/ONEGAYI/vsidian/issues/333) | [refactor: 提炼多类型只读访问与内容挂载入口](01-renderer-access-seam.md) | 无本地前置 | 增加兼容的类型分派入口，原有 Markdown Reading／Live 行为保持等价 |
| P3-02 | [#334](https://github.com/ONEGAYI/vsidian/issues/334) | [research: 锁定 PDF 渲染器的下界、worker 与包体可行性](02-pdf-compatibility-probe.md) | 无本地前置 | 真实宿主最小 PDF 绘制探针、锁定候选及通过／阻塞结论 |
| P3-03 | [#335](https://github.com/ONEGAYI/vsidian/issues/335) | [research: 验证已装语言插件和主题的原生文字外观复用](03-native-text-appearance-probe.md) | 无本地前置 | 语法／语义／主题／字体可达性探针及原生对照差异清单 |
| P3-04 | [#336](https://github.com/ONEGAYI/vsidian/issues/336) | [feat: 图片双链嵌入与普通 Markdown 图片同源呈现](04-image-attachment-parity.md) | [#333](https://github.com/ONEGAYI/vsidian/issues/333)（P3-01） | 图片悬停，以及与普通 Markdown 图片一致的 ![[图片]] 嵌入 |
| P3-05 | [#337](https://github.com/ONEGAYI/vsidian/issues/337) | [feat: PDF 悬停首条闭环与页码定位](05-pdf-hover-first-page.md) | [#333](https://github.com/ONEGAYI/vsidian/issues/333)（P3-01）、[#334](https://github.com/ONEGAYI/vsidian/issues/334)（P3-02） | 悬停本地 PDF 可看第一页或双链 #page= 指定页（普链 fragment 不解析） |
| P3-06 | [#338](https://github.com/ONEGAYI/vsidian/issues/338) | [feat: PDF 全文按页滚动与正文嵌入](06-pdf-scroll-embed.md) | [#337](https://github.com/ONEGAYI/vsidian/issues/337)（P3-05） | PDF 在浮层与全部既有正文嵌入容器中按页浏览全文 |
| P3-07 | [#339](https://github.com/ONEGAYI/vsidian/issues/339) | [feat: PDF 适合宽度、缩放、文本选择与链接](07-pdf-zoom-copy-links.md) | [#338](https://github.com/ONEGAYI/vsidian/issues/338)（P3-06） | 完整基础 PDF 阅读交互，保持全文可达与只读 |
| P3-08 | [#340](https://github.com/ONEGAYI/vsidian/issues/340) | [feat: 可读文本悬停与原生文字外观](08-text-hover-native.md) | [#333](https://github.com/ONEGAYI/vsidian/issues/333)（P3-01）、[#335](https://github.com/ONEGAYI/vsidian/issues/335)（P3-03） | 代码／配置文件悬停按已验证语言与主题路线只读显示；双链 #line／#range 锚点定位与窗口 |
| P3-09 | [#341](https://github.com/ONEGAYI/vsidian/issues/341) | [feat: 可读文本嵌入、内部视口与版本同步](09-text-embed-sync.md) | [#340](https://github.com/ONEGAYI/vsidian/issues/340)（P3-08） | 全部既有嵌入容器内只读显示代码／配置并正确刷新回收；#range 硬窗口裁剪与 #line 定位 |
| P3-10 | [#342](https://github.com/ONEGAYI/vsidian/issues/342) | [feat: 默认关闭的外部链接标题摘要预览卡片](10-external-link-card.md) | [#333](https://github.com/ONEGAYI/vsidian/issues/333)（P3-01） | 显式开启后悬停 HTTP(S) 链接可看标题、摘要和域名 |
| P3-11 | [#343](https://github.com/ONEGAYI/vsidian/issues/343) | [feat: 可选原网页浮层与带原因的卡片退回](11-external-page-fallback.md) | [#342](https://github.com/ONEGAYI/vsidian/issues/342)（P3-10） | 原网页模式尽力显示网站，不可用时提供卡片和退回原因 |
| P3-12 | [#344](https://github.com/ONEGAYI/vsidian/issues/344) | [test: 三期组合、资源、下界兼容与交付收口](12-phase3-closeout.md) | [#336](https://github.com/ONEGAYI/vsidian/issues/336)（P3-04）、[#339](https://github.com/ONEGAYI/vsidian/issues/339)（P3-07）、[#341](https://github.com/ONEGAYI/vsidian/issues/341)（P3-09）、[#343](https://github.com/ONEGAYI/vsidian/issues/343)（P3-11） | 四类能力组合验收、性能／包体证据及人工待验清单 |

前置关系没有循环。可并行准备的首批为 P3-01／P3-02／P3-03；P3-04 和 P3-10 只依赖准备性接口，不等待 PDF／文本路线。已按此表拓扑顺序发布并回填真实 GitHub 号，本地编号与远端编号分别登记。

**技术验证的解除条件**：P3-02 只有锁定路线在下界／CSP／资源／包体内成立才放行 P3-05；P3-03 只有原生文字外观路线成立且必要差异获接受才放行 P3-08。研究完成但路线失败仍是阻塞。总览 #228 与四期 #330 都不是子票的执行前置，避免父子循环。

## 验证与交付

- 第一批准备和验证可独立开始；功能实施仍需相应授权，开票不自动授权编码、推送或合并。
- 每张功能票先有目标失败契约，再实施。优先现有生产 browser、真实宿主与只读资源通道，不为内部函数增加镜像测试或大套 mock。
- 图像／canvas／token／退回状态必须有实际绘制证据，不能以 DOM 存在、坐标或 iframe load 事件代替。下界采用 VSCode 1.82.3；Remote SSH 与真实鼠标／视觉验收分别记录。
- 主题、CSS、DOM 或 CSP 变更先执行项目 style-contract。新增操作登记默认绑定和状态范围；所有用户文字经两语言 locales，设置只进扩展自有页面。
- 首轮长命令输出及退出码留证，后续复核读报告。引用预算沿用现有上界；二进制／canvas／token／网络缓存另外计量，数值由前置探针锁定。
- 文件新增通过 file-tree 唯一入口维护。全期只读边界不改变二期 Markdown Live 已有写回、dirty 关闭及历史归属。

## 发布状态

用户于 2026-10-04 明确选择「按这 12 票发布」，已按 P3-01–P3-12 的拓扑顺序建立 #333–#344，并回填本地正文、索引及父票 #228。#333／#334／#335 已加 ready-for-agent，其余保留实际阻塞。研究票的 ready 只表示研究可开始；开票不自动授权编码、推送或合并。

四期 [#330](https://github.com/ONEGAYI/vsidian/issues/330) 已发布，仍为规划／可行性跟踪，不加 ready-for-agent。
