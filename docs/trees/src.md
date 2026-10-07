# 扩展源码结构视图

file-tree 视图（id: `src`）：`src` 全量子树投影。主树中的 `src/host`、`src/shared`、`src/webview` 已折叠，在此展开。数据源自 tree.json，随文件变更自动同步渲染；块内内容禁止手改。

```
<!-- file-tree:tree^id=src:begin 由脚本渲染，禁止手改 -->
vsidian/
└── src/ # 扩展源码
    ├── extension.ts # 扩展激活入口
    ├── host/        # 宿主端实现
    │   ├── cssSnippetService.ts          # CSS 片段宿主权威服务
    │   ├── cssSnippetWiring.ts           # CSS 片段 vscode 层装配
    │   ├── diagramExportHost.ts          # 宿主图表导出执行壳
    │   ├── diagramExportValidate.ts      # 图表导出载荷校验
    │   ├── documentSession.ts            # 文档会话与写回同步
    │   ├── editorCsp.ts                  # 编辑器 CSP 装配纯模块（#130）
    │   ├── editorGuardService.ts         # 默认编辑器守护宿主服务
    │   ├── editorGuardWiring.ts          # 默认编辑器守护 vscode 层装配
    │   ├── findOptionsStore.ts           # 查找选项持久化存取
    │   ├── hostLocale.ts                 # 生效语言宿主装配解析帮手
    │   ├── hoverDocAccess.ts             # 悬停预览文档访问纯逻辑
    │   ├── hoverRefreshCoordinator.ts    # 引用视图刷新协调器（宿主）
    │   ├── imageExportHost.ts            # 宿主图片导出执行壳
    │   ├── imagePasteHost.ts             # 图片粘贴落盘执行壳（#161）
    │   ├── imagePastePlan.ts             # 图片粘贴纯逻辑（#161）
    │   ├── imageRefreshCoordinator.ts    # 图片刷新协调器（provider 级）
    │   ├── imageVersioning.ts            # 图片资源版本表纯逻辑
    │   ├── jiebaResourceService.ts       # jieba 资源宿主服务（端口注入）
    │   ├── jiebaResourceWiring.ts        # jieba 资源 vscode 层装配
    │   ├── jiebaTar.ts                   # npm tarball 最小提取器
    │   ├── keybindingService.ts          # 快捷键全局存储服务
    │   ├── linkTarget.ts                 # 宿主侧链接目标分类纯逻辑（#10）
    │   ├── pasteHistoryTracker.ts        # 宿主粘贴阶段历史解释
    │   ├── proxyAgent.ts                 # 外链抓取代理接入（CONNECT 隧道）
    │   ├── refEditPorts.ts               # 引用编辑端口绑定注册表
    │   ├── searchReveal.ts               # 搜索定位恢复纯逻辑（#318）
    │   ├── settingsPage.ts               # 独立设置页面板装配
    │   ├── settingsService.ts            # 宿主设置服务
    │   ├── skeletonScreen.ts             # 骨架屏内联装配纯逻辑（#292）
    │   ├── styleReferenceExport.ts       # 契约 JSON 导出宿主执行壳
    │   ├── styleReferenceExportPlan.ts   # 契约 JSON 导出纯规划逻辑
    │   ├── textAppearance/               # 宿主文本外观服务目录
    │   │   ├── appearanceService.ts # 外观服务 vscode 装配
    │   │   ├── themeResolution.ts   # 主题链解析与颜色管线
    │   │   ├── tmEngine.ts          # TM 引擎封装（同版同算法）
    │   │   └── tmScopeMatcher.ts    # TM scope 匹配器（官方移植）
    │   ├── textEditorProvider.ts         # 自定义文本编辑器提供者
    │   ├── vaultIndexMaintenance.ts      # 索引维护接线：排除持久化与操作编排
    │   ├── vaultIndexOverlay.ts          # 索引覆盖层与反链查询纯逻辑（#197）
    │   ├── vaultIndexService.ts          # 引用索引宿主服务（#197）
    │   ├── vaultIndexWiring.ts           # 索引服务 vscode 层端口装配
    │   ├── vaultLinkExtract.ts           # 出链抽取纯逻辑（#197）
    │   ├── vaultRenameWiring.ts          # rename 引用更新装配（#199）
    │   ├── viewCycle.ts                  # 三态视图编排纯逻辑
    │   ├── webLinkMetaService.ts         # 外链元信息受限抓取服务
    │   ├── webMetaExtract.ts             # HTML 元信息非执行提取
    │   ├── wikilinkBlockIdCoordinator.ts # 块 ID 撤回协调器
    │   ├── wikilinkBlockSource.ts        # 块联想宿主查询编排
    │   ├── wikilinkHeadingSource.ts      # 标题联想宿主查询编排
    │   └── wikilinkTarget.ts             # 宿主侧双链目标解析纯逻辑（#11）
    ├── shared/      # 两端共享纯逻辑
    │   ├── blockId.ts            # 块 id 与块边界单一事实源
    │   ├── changeMapping.ts      # 变更重定位纯函数
    │   ├── chromeContract.ts     # 界面域样式契约探针表
    │   ├── codeLangs.ts          # 代码块语言注册表与别名路由
    │   ├── contextMenu.ts        # 统一右键菜单内核纯函数单一事实源
    │   ├── cssSnippetEnv.ts      # CSS 片段环境身份与分桶戳（#131）
    │   ├── cssSnippetImports.ts  # CSS 片段依赖导入形态学单一事实源
    │   ├── cssSnippets.ts        # CSS 片段纯逻辑单一事实源
    │   ├── editorGuard.ts        # 默认编辑器守护共享纯逻辑
    │   ├── findOptions.ts        # 查找选项三开关单一事实源
    │   ├── formatOperations.ts   # 格式操作注册清单
    │   ├── frontmatterTable.ts   # frontmatter 表格化纯逻辑
    │   ├── globLiteral.ts        # watcher 文件名 glob 转义
    │   ├── hoverRefresh.ts       # 引用视图同步参数与订阅注册表
    │   ├── i18n.ts               # t() 取词与语言包装配状态模块
    │   ├── imageRefresh.ts       # 图片刷新共享常量与核验决策
    │   ├── jiebaManifest.ts      # jieba 锁定版本与下载源清单
    │   ├── keybindings.ts        # 快捷键操作与冲突模型
    │   ├── listPrefix.ts         # 列表引用前缀形态学（#119）
    │   ├── locales/              # 语言包字典单一事实源
    │   │   ├── en.ts     # 英文语言包（类型基准）
    │   │   ├── index.ts  # 语言注册表与解析（仅宿主可引）
    │   │   ├── island.ts # 语言数据岛构建与解析
    │   │   └── zh-cn.ts  # 简体中文语言包（编译期 parity）
    │   ├── looseLink.ts          # 宽松内联链接/图片形态学单一事实源
    │   ├── markdownDoc.ts        # Markdown 文档工具与树查询
    │   ├── math.ts               # 公式形态学纯函数（#59）
    │   ├── mermaid.ts            # Mermaid 围栏形态学（#60）
    │   ├── newline.ts            # CRLF/LF 换行协调器
    │   ├── obsidianAlias.ts      # Obsidian 别名桥实现同源表
    │   ├── pdfNav.ts             # PDF 导航锚点解析纯逻辑
    │   ├── protocol.ts           # 消息协议单一事实源
    │   ├── refContent.ts         # 引用内容类型分派共享内核（#333）
    │   ├── refExpansion.ts       # 引用递归路径与容量预算
    │   ├── refText.ts            # 可读文本锚点与准入共享内核
    │   ├── relocationScan.ts     # 嵌入重定位逐字检索预算
    │   ├── settings.ts           # 设置定义与读写纯逻辑
    │   ├── skeletonTiming.ts     # 骨架屏撤除计算与装配常量（#292）
    │   ├── styleContract.ts      # 公开样式契约清单单一事实源
    │   ├── styleContractEn.ts    # 样式参考条目英文覆盖单一事实源
    │   ├── symbols.ts            # 符号注册表单一事实源（#123）
    │   ├── symbolWrap.ts         # 选区包裹计划纯函数（#124）
    │   ├── tabEscape.ts          # Tab 越界定位纯函数（#125）
    │   ├── tableCellEmbed.ts     # 表格格内嵌入三套区间映射
    │   ├── tableCells.ts         # 表格单元格边界、换行与转义
    │   ├── testDiagnostics.ts    # 测试传播诊断有界日志
    │   ├── vaultFileCatalog.ts   # 全文件清单快照纯逻辑
    │   ├── vaultFileCategory.ts  # 全文件清单分类声明
    │   ├── vaultIndexExclude.ts  # 索引排除模式纯逻辑单一事实源
    │   ├── vaultIndexModel.ts    # 引用索引内存模型纯逻辑
    │   ├── vaultIndexSchedule.ts # 索引维护调度纯逻辑与初值常量
    │   ├── vaultIndexSnapshot.ts # 分片快照存储纯逻辑（#195 选型基线）
    │   ├── vaultLink.ts          # 根内相对路径解析单一事实源（#196）
    │   ├── vaultRename.ts        # 引用改写计划纯逻辑（#199）
    │   ├── webLink.ts            # 外链 URL 准入与归一（两端共享）
    │   ├── wikilink.ts           # 双链形态学单一事实源（#11）
    │   ├── wikilinkBlock.ts      # 块候选纯逻辑（#380 T05）
    │   ├── wikilinkField.ts      # 双链目标字段阶段化识别与编辑计划
    │   ├── wikilinkHeading.ts    # 标题候选枚举与前缀过滤
    │   ├── wikilinkQuery.ts      # 双链联想查询评分移植
    │   └── wordSegment.ts        # 中文分词形态学与移动规划纯函数
    └── webview/     # webview 端实现
        ├── anchorFlash.ts              # 跳转目标高亮装饰状态
        ├── appearanceSettings.ts       # 外观合并分页
        ├── backlinkGrouping.ts         # 反链面板分组排序过滤纯函数
        ├── backlinkPanel.ts            # 反链面板 DOM 与四态渲染（#197）
        ├── blockIdStrip.ts             # 阅读渲染块标记剥离纯函数
        ├── clipboardPaste.ts           # 多格式剪贴板快照与粘贴适配
        ├── codeCardState.ts            # 卡片共享状态中立模块
        ├── codeHighlight.ts            # 语法高亮引擎装配与缓存
        ├── codeLanguages/              # 原创与适配语言词法
        │   ├── graphql.ts  # GraphQL查询与SDL词法
        │   ├── makefile.ts # GNU Makefile词法
        │   ├── php.ts      # PHP顶层选择与标签适配
        │   └── spice.ts    # SPICE网表词法
        ├── contextMenuDom.ts           # 统一菜单 DOM 装配与子菜单翻转
        ├── css.d.ts                    # CSS 导入类型声明
        ├── cssSnippetSettings.ts       # 外观页 CSS 片段页签体
        ├── defaultEditorSettings.ts    # 设置页默认编辑器委托组
        ├── diagramExport.ts            # 图表导出序列化与光栅化
        ├── diagramPopup.ts             # 图表弹窗全屏浮层
        ├── diagramPopupGeometry.ts     # 弹窗几何纯函数
        ├── embedCard.ts                # Reading 嵌入卡片管理器
        ├── embedSlots.ts               # 混排嵌入识别配对与DOM提升纯逻辑
        ├── fenceEscape.ts              # 围栏 Tab 越界适配层（#125）
        ├── findSession.ts              # 查找匹配纯函数（#14）
        ├── fontArrival.ts              # 字体晚到监听（#130）
        ├── formatOperations.ts         # 格式文本变换规划
        ├── frontmatterDecorations.ts   # frontmatter 卡片装饰
        ├── frontmatterEditing.ts       # frontmatter 格导航键位组
        ├── frontmatterPopover.ts       # frontmatter 属性编辑浮层
        ├── graphicBlockChrome.ts       # 图形化块右上角按钮组
        ├── graphicRenderers.ts         # 图形化渲染器注册表
        ├── hitReveal.ts                # 命中显形活跃命中集单一事实源
        ├── hoverPopup.ts               # 悬停预览浮层单例
        ├── hoverPopupGeometry.ts       # 悬停浮层几何纯函数
        ├── htmlComment.ts              # 阅读侧 HTML 注释剥离纯函数
        ├── htmlToMarkdown.ts           # 富文本HTML到Markdown转换
        ├── imagePaste.ts               # 图片粘贴拦截适配层（#161）
        ├── imagePopup.ts               # 图片弹窗全屏浮层单例
        ├── imageResource.ts            # 图片资源状态机（#10）
        ├── imageVerifyScheduler.ts     # webview 周期核验定时器调度
        ├── indentEditing.ts            # Tab 通用行缩进处理器（#120）
        ├── indexMaintenanceSettings.ts # 设置页索引维护分页
        ├── jsonDialects.ts             # JSONC与JSON5词法模式
        ├── keybindingRouter.ts         # 编辑器按键分发器
        ├── keybindingSettings.ts       # 快捷键设置分页
        ├── listEditing.ts              # Enter 延续与退格清层（#119）
        ├── liveBlockId.ts              # 块 id 标记 live 淡化装饰
        ├── liveCodeCard.ts             # Live 代码块卡片装饰
        ├── liveDecorations.ts          # 语法树驱动 Live 装饰（#8）
        ├── liveEmbed.ts                # Live 嵌入装饰与源码显隐
        ├── liveInstance.ts             # Live 编辑器可复用实例
        ├── liveLineNumbers.ts          # 表格段首行号与绘制探针
        ├── liveLinks.ts                # live 链接装饰与跳转（#10）
        ├── liveMath.ts                 # 行内与块级公式 live 装饰（#59）
        ├── liveMermaid.ts              # Mermaid live 装饰（#60）
        ├── localeBoot.ts               # webview 语言装配入口
        ├── localeDom.ts                # 常驻控件文案换包单点重刷注册表
        ├── localeOnDemand.ts           # 按需控件文案换包 DOM 级重刷
        ├── main.css                    # webview 全局布局样式
        ├── main.ts                     # webview 启动入口
        ├── mathRenderCache.ts          # KaTeX 渲染 LRU 缓存共享模块
        ├── mermaidEntry.ts             # Mermaid 独立产物入口（#60）
        ├── mermaidRender.ts            # Mermaid 渲染管线（#60）
        ├── mermaidTheme.ts             # Mermaid 暗色主题装配
        ├── multicursor.ts              # 多光标扩展组单一事实源（#237）
        ├── nextOccurrence.ts           # 选下一处相同词选区计划纯函数
        ├── outline.ts                  # 大纲全文解析与面板装配
        ├── outlineCollapse.ts          # 大纲折叠状态机纯函数
        ├── outlineDrag.ts              # 大纲拖拽移动计划纯函数
        ├── outlineLocate.ts            # 大纲定位纯函数
        ├── outlineMenu.ts              # 大纲右键菜单模型纯逻辑
        ├── outlineSearch.ts            # 大纲标题搜索纯函数
        ├── outlineSection.ts           # 大纲控制域纯函数
        ├── outlinkPanel.ts             # 出链面板 DOM 与四态渲染
        ├── overlayAnchor.ts            # 浮层右缘锚点计划纯函数
        ├── pdfMainEntry.ts             # PDF.js 主库独立产物入口
        ├── pdfRender.ts                # PDF 渲染器（全文按页滚动）
        ├── pdfWorkerEntry.ts           # PDF.js worker 独立产物入口
        ├── perfProbe.ts                # webview 性能探针（#5）
        ├── popupMutex.ts               # 图表与图片弹窗互斥
        ├── quickActionState.ts         # 快速操作状态判定
        ├── readingBlocks.ts            # markdown-it 阅读块切分
        ├── readingCodeCard.ts          # 阅读代码块卡片增强
        ├── readingFind.ts              # 阅读查找源坐标与字符高亮
        ├── readingFindSource.ts        # 阅读查找只读源码浮层
        ├── readingMarkdown.ts          # markdown-it 安全渲染层
        ├── readingProbe.ts             # 阅读视图性能探针
        ├── readingView.ts              # 阅读视图 DOM 构建与锚点定位
        ├── readingViewport.ts          # 阅读视口挂载窗口纯函数
        ├── readingVirtualView.ts       # 阅读视图虚拟化装配层
        ├── refContentInstance.ts       # 引用内容实例与挂载生命周期
        ├── refReadingContent.ts        # 引用内容只读 Reading 装配
        ├── richPasteDialog.css         # 粘贴询问主题与零特异性样式
        ├── richPasteDialog.ts          # 粘贴格式询问会话模态
        ├── richPastePlan.ts            # 富文本粘贴两阶段计划
        ├── settingsMain.ts             # 设置页 webview 入口
        ├── settingsPage.css            # 设置页样式
        ├── settingsPageView.ts         # 设置页 webview 视图
        ├── snippetLoader.ts            # CSS 片段 link 装配器
        ├── styleGuideData.ts           # 设置页样式参考数据（生成）
        ├── styleReferenceSettings.ts   # 外观页样式参考页签体
        ├── symbolAutocomplete.ts       # 符号自动补全编辑器适配层（#123）
        ├── symbolCompositionState.ts   # IME 选区快照共享状态
        ├── symbolWrap.ts               # 选区包裹编辑器适配层（#124）
        ├── syncController.ts           # CM6 同步控制器
        ├── tableColumnWidth.ts         # 表格列宽采样与轨道计划纯函数
        ├── tableControls.ts            # 表格可见行控件与拖动
        ├── tableCreate.ts              # 光标处建表规划纯函数
        ├── tableEditing.ts             # 表格输入钩子（#12）
        ├── tableHeightPlan.ts          # 两列表整表高度优化纯规划层
        ├── tableHeightScheduler.ts     # 高度优化调度ViewPlugin
        ├── tableMetrics.ts             # 表格可读度量探针与注入通道
        ├── tableRegion.ts              # 表格矩形选区与结构规划
        ├── tableRegionField.ts         # 表格格区选区状态单一事实源
        ├── tableRegionSelection.ts     # 表格格区拖选指针交互
        ├── tableStructure.ts           # 表格导航与增删行列纯函数（#13）
        ├── targetTip.ts                # 跳转目标提示：浮层不将现时的目标位置浮标
        ├── taskToggle.ts               # 任务勾选解析纯函数（#9）
        ├── textRefView.ts              # 文本只读视图（虚拟化着色渲染）
        ├── toast.css                   # 轻提示主题与公开样式变量
        ├── toast.ts                    # 编辑器独立轻提示通道
        ├── tooltipCard.css             # 悬停提示共享样式
        ├── tooltipCard.ts              # 悬停提示委托控制器
        ├── tooltipGeometry.ts          # 悬停提示定位几何纯函数
        ├── untrustedFrame.ts           # 不可信子页消息来源判定
        ├── webCard.ts                  # 外链卡片内容视图（web 通道）
        ├── webPage.ts                  # 外链原网页视图（iframe+退回）
        ├── wikilinkSuggest.css         # 联想候选浮层样式
        ├── wikilinkSuggest.ts          # 双链联想候选会话（含转阶段）
        ├── wordMotion.ts               # 词级移动命令与引擎配置
        └── wordSegmentSettings.ts      # 设置页中文分词分页
<!-- file-tree:tree^id=src:end -->
```
