# 产品与实施规格视图

file-tree 视图（id: `specs`）：`docs/specs` 全量子树投影。主树中的 `docs/specs/` 已折叠，在此展开。数据源自 tree.json，随文件变更自动同步渲染；块内内容禁止手改。

```
<!-- file-tree:tree^id=specs:begin 由脚本渲染，禁止手改 -->
vsidian/
└── docs/
    └── specs/ # 产品规格
        ├── addon-api-extension-tickets/          # 附加组件API扩展实施票据
        │   ├── t01-paste-registration.md  # 基础粘贴规则实施票
        │   ├── t02-paste-expressions.md   # 复杂粘贴表达式实施票
        │   ├── t03-document-navigation.md # 文档导航API实施票
        │   ├── t04-link-line-suffix.md    # 普通链接行号实施票
        │   ├── t05-reference-popup.md     # 只读引用浮窗实施票
        │   ├── t06-reference-embed.md     # 组件容器引用嵌入实施票
        │   ├── t07-theme-system.md        # 统一主题机制实施票
        │   └── t08-codex-retirement.md    # Codex内核退役实施票
        ├── addon-behavior-disabled-state.md      # 组件行为禁用态可见性规格
        ├── addon-navigation.md                   # 组件导航与普通链接行号规格
        ├── addon-paste-conversion.md             # 组件声明式粘贴转换规格
        ├── addon-reference-views.md              # 组件只读引用浮窗与嵌入规格
        ├── addon-settings-detail.md              # 组件设置详情自绘页优先规格
        ├── addon-settings-grouping.md            # 附加组件设置分组规格
        ├── addon-themes.md                       # 组件主题与内核退役规格
        ├── addons-api-gate.md                    # API 契约门禁 CI 接线规格
        ├── anchor-navigation.md                  # 锚点跳转规格（标题/块引用/复制块链接）
        ├── appearance-merge.md                   # 外观合并分页规格
        ├── batch-2026-09-menu.md                 # 右键菜单批次总览与决策回执
        ├── batch-2026-09.md                      # 2026-09 开票批次总览
        ├── batch-2026-10-addon-api-extensions.md # 附加组件API扩展批次索引
        ├── batch-2026-10-heading-fold.md         # 标题折叠批次索引
        ├── batch-2026-10-menu-scenes.md          # 右键菜单场景差异化批次切片记录
        ├── batch-2026-10-settings-sections.md    # 2026-10 设置页批次实施树
        ├── batch-2026-10-vscode-ops.md           # 2026-10 编辑器操作批次实施树
        ├── batch-2026-10-vsidian-addons.md       # 附加组件验证与实施批次索引
        ├── batch-2026-10-wikilink-completion.md  # 双链输入联想实施批次
        ├── behavior-manage-pagination.md         # 行为管理分页与筛选规格
        ├── blockquote-accent-bar.md              # 引用块紫色提示边条规格
        ├── blockquote-table.md                   # 引用块内表格规格
        ├── callout.md                            # Callout语法与样式规格
        ├── code-block-card.md                    # 代码块卡片功能规格
        ├── code-language-sources.md              # 新词法来源许可与边界
        ├── context-menu.md                       # 统一右键菜单规格（正文全域接管）
        ├── css-snippets.md                       # CSS片段与样式兼容规格
        ├── default-editor-guard.md               # 默认编辑器守护规格
        ├── frontmatter-table.md                  # frontmatter 表格化规格
        ├── graphic-code-block-interaction.md     # 图形化代码块交互规格
        ├── heading-fold.md                       # 正文标题折叠实施规格
        ├── hover-embed-phase2-tickets/           # 二期票据正文与依赖
        │   ├── 01-host-compatibility.md       # 二期P2-01任务与票据
        │   ├── 02-live-instance-seam.md       # 二期P2-02任务与票据
        │   ├── 03-full-document-navigation.md # 二期P2-03任务与票据
        │   ├── 04-embed-target-editing.md     # 二期P2-04任务与票据
        │   ├── 05-explicit-close.md           # 二期P2-05任务与票据
        │   ├── 06-hover-live.md               # 二期P2-06任务与票据
        │   ├── 07-mixed-list-quote-live.md    # 二期P2-07任务与票据
        │   ├── 08-table-cell-live.md          # 二期P2-08任务与票据
        │   ├── 09-recursive-live.md           # 二期P2-09任务与票据
        │   ├── 10-full-live-actions.md        # 二期P2-10任务与票据
        │   ├── 11-target-resources.md         # 二期P2-11任务与票据
        │   ├── 12-conflict-native-diff.md     # 二期P2-12任务与票据
        │   ├── 13-parent-close-handoff.md     # 二期P2-13任务与票据
        │   ├── 14-phase2-closeout.md          # 二期P2-14任务与票据
        │   └── README.md                      # 二期票据索引与依赖
        ├── hover-embed-phase3-tickets/           # 三期票据正文与依赖
        │   ├── 01-renderer-access-seam.md         # 多类型只读入口准备票
        │   ├── 02-pdf-compatibility-probe.md      # PDF下界与包体验证票
        │   ├── 03-native-text-appearance-probe.md # 文本原生外观验证票
        │   ├── 04-image-attachment-parity.md      # 图片双链同源呈现票
        │   ├── 05-pdf-hover-first-page.md         # PDF悬停页码闭环票
        │   ├── 06-pdf-scroll-embed.md             # PDF全文滚动嵌入票
        │   ├── 07-pdf-zoom-copy-links.md          # PDF缩放文本选择票
        │   ├── 08-text-hover-native.md            # 文本原生外观悬停票
        │   ├── 09-text-embed-sync.md              # 文本视口嵌入同步票
        │   ├── 10-external-link-card.md           # 外链标题摘要卡片票
        │   ├── 11-external-page-fallback.md       # 原网页与卡片退回票
        │   ├── 12-phase3-closeout.md              # 三期组合资源收口票
        │   └── README.md                          # 三期票据依赖与发布索引
        ├── hover-preview-embed.md                # 悬停预览与文档嵌入规格
        ├── html-comment-support.md               # HTML 注释快捷键与呈现规格
        ├── html-rendering.md                     # 原生HTML与文档样式规格
        ├── i18n.md                               # 全局 i18n 适配规格
        ├── image-paste.md                        # 图片粘贴插入与资产文件夹规格
        ├── image-popup.md                        # 图片弹窗查看与防误触规格
        ├── image-resize.md                       # 图片尺寸后缀与拖动手柄规格
        ├── integration-host-teardown-noise.md    # CI 收尾退出噪声边界（#211）
        ├── integration-test-groups.md            # 四片强制与第五敏感组规格
        ├── keybindings.md                        # 快捷键清单与默认值
        ├── live-table-column-width.md            # Live 表格列宽规格
        ├── manual-verification.md                # 人工验证清单
        ├── markdown-shortname-links.md           # 短名引用与链接类型规格
        ├── mvp-issues.md                         # MVP GitHub Issue 索引
        ├── mvp.md                                # MVP 规格主文档
        ├── pdf-export.md                         # PDF导出规格与工单索引
        ├── reference-view-group.md               # 引用视图设置组与跳转目标提示规格
        ├── rich-text-paste.md                    # 富文本粘贴与分步撤销规格
        ├── search-reveal.md                      # 外部搜索导航定位恢复规格
        ├── settings-page-visual-refresh.md       # 设置页视觉刷新规格（#155）
        ├── skeleton-screen.md                    # 编辑器初开骨架屏加载规格
        ├── style-contract-gate.md                # 契约门禁 CI 接线与远端配置文档
        ├── style-reference-i18n.md               # 样式参考条目双语化规格
        ├── symbol-input.md                       # 符号输入与行内围栏扩展约定落档
        ├── table-interaction-rework.md           # 表格交互重做规格
        ├── toolbar-refresh.md                    # 工具栏刷新按钮与缓存刷新规格
        ├── toolbar-view-toggle.md                # 工具栏双态切换按钮规格
        ├── tooltip.md                            # 统一自绘悬停提示规格
        ├── ui-patterns.md                        # UI元素形态契约目录（单一事实源）
        ├── vault-index-backlinks.md              # 引用索引与反链实施规格
        ├── viewport-width.md                     # 可读行宽与双模式列布局规格
        ├── vsidian-addons-coverage.md            # 29 用户故事覆盖映射
        ├── vsidian-addons-tickets/               # 附加组件验证与实施票面
        │   ├── t01.md # 附加组件发现与注册实施票
        │   ├── t02.md # 页面SDK通信与生命周期票
        │   ├── t03.md # 编辑来源与历史接入准备票
        │   ├── t04.md # 复杂设置与作用范围实施票
        │   ├── t05.md # 组件侧栏与设置页实施票
        │   ├── t06.md # 视图编辑API与原子历史票
        │   ├── t07.md # 可组合输入行为实施票
        │   ├── t08.md # 行为冲突管理界面实施票
        │   ├── t09.md # 自动渲染接管与恢复实施票
        │   ├── t10.md # 组件命令菜单与快捷键票
        │   ├── t11.md # 组件按钮与面板实施票
        │   ├── t12.md # 组件故障诊断与恢复票
        │   ├── t13.md # 公开API声明与指南实施票
        │   ├── t14.md # API基线与兼容门禁实施票
        │   ├── t15.md # 三类公开SDK消费样例票
        │   ├── t16.md # 附加组件双VSIX安装回归票
        │   ├── t17.md # Remote同宿主接入验证票
        │   ├── t18.md # 附加组件公开接入验收收口票
        │   ├── v01.md # 原子历史与目标归属验证票
        │   └── v02.md # 页面SDK与CM6装载验证票
        ├── vsidian-addons.md                     # 附加组件接入与公开API规格草案
        ├── wikilink-completion-tickets/          # 双链联想验证与实施票面
        │   ├── t01.md # T01 Markdown 候选闭环
        │   ├── t02.md # T02 全文件登记与维护
        │   ├── t03.md # T03 目标区与按键仲裁
        │   ├── t04.md # T04 标题候选与重名提示
        │   ├── t05.md # T05 块 ID 与撤销收尾
        │   ├── t06.md # T06 表格与内部 Live
        │   ├── t07.md # T07 容量回归与交付收口
        │   └── v01.md # V01 补 ID 与撤销验证
        └── wikilink-completion.md                # 双链文件输入联想规格
<!-- file-tree:tree^id=specs:end -->
```
