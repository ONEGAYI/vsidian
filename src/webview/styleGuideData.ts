// 设置页「样式参考」分页渲染数据（#132）——由 scripts/genStyleGuide.mjs 从
// src/shared/styleContract.ts 生成，**禁止手改**；一致性由
// test/unit/styleGuideGen.test.ts 以 --check 钉住（改清单后重跑生成并提交）。
// 本文件是文档数据（公开指南内容，中文为准），不是 UI 文案——CJK 扫描豁免
// 同 styleContract.ts；不进编辑器 webview bundle（仅设置页 import）。
// #178：条目文档字段的英文覆盖随本模块内联（取词规则与字段分级见
// src/shared/styleContractEn.ts），仅进设置页产物。
import type { StyleContractCategory, StyleContractEntry } from '../shared/styleContract'
import type { StyleContractEntryOverride } from '../shared/styleContractEn'
import type { ObsidianVariableAlias } from '../shared/obsidianAlias'

/** 指南配套的扩展版本（与安装版本一致） */
export const STYLE_GUIDE_VERSION = "0.9.0"

/** Obsidian 变量别名总表（指南总表同源） */
export const STYLE_GUIDE_VARIABLE_ALIASES: readonly ObsidianVariableAlias[] = [
  {
    "obsidian": "--h1-color",
    "vsidian": "--vsidian-heading-color-1",
    "fallback": "var(--vscode-editor-foreground)"
  },
  {
    "obsidian": "--h2-color",
    "vsidian": "--vsidian-heading-color-2",
    "fallback": "var(--vscode-editor-foreground)"
  },
  {
    "obsidian": "--h3-color",
    "vsidian": "--vsidian-heading-color-3",
    "fallback": "var(--vscode-editor-foreground)"
  },
  {
    "obsidian": "--h4-color",
    "vsidian": "--vsidian-heading-color-4",
    "fallback": "var(--vscode-editor-foreground)"
  },
  {
    "obsidian": "--h5-color",
    "vsidian": "--vsidian-heading-color-5",
    "fallback": "var(--vscode-editor-foreground)"
  },
  {
    "obsidian": "--h6-color",
    "vsidian": "--vsidian-heading-color-6",
    "fallback": "var(--vscode-editor-foreground)"
  },
  {
    "obsidian": "--font-text-size",
    "vsidian": "--vsidian-reading-font-size",
    "fallback": "var(--vsidian-content-font-size)"
  },
  {
    "obsidian": "--file-line-width",
    "vsidian": "--vsidian-reading-max-width",
    "fallback": "none"
  },
  {
    "obsidian": "--file-line-width",
    "vsidian": "--vsidian-live-preview-max-width",
    "fallback": "none"
  },
  {
    "obsidian": "--line-height-normal",
    "vsidian": "--vsidian-reading-line-height",
    "fallback": "var(--vsidian-content-line-height)"
  },
  {
    "obsidian": "--code-background",
    "vsidian": "--vsidian-reading-code-background",
    "fallback": "var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12))"
  },
  {
    "obsidian": "--text-highlight-bg",
    "vsidian": "--vsidian-highlight-background",
    "fallback": "rgba(255, 208, 0, 0.35)"
  },
  {
    "obsidian": "--table-background",
    "vsidian": "--vsidian-table-background",
    "fallback": "rgba(128, 128, 128, 0.05)"
  }
]

/** 类目定义表（#145 分栏分组；条目计数据派生） */
export const STYLE_GUIDE_CATEGORIES: readonly StyleContractCategory[] = [
  {
    "id": "view-container",
    "domain": "content",
    "title": "容器与视图",
    "titleKey": "styleRef.category.viewContainer",
    "order": 1
  },
  {
    "id": "heading",
    "domain": "content",
    "title": "标题",
    "titleKey": "styleRef.category.heading",
    "order": 2
  },
  {
    "id": "inline-format",
    "domain": "content",
    "title": "行内格式",
    "titleKey": "styleRef.category.inlineFormat",
    "order": 3
  },
  {
    "id": "list-task",
    "domain": "content",
    "title": "列表与任务",
    "titleKey": "styleRef.category.listTask",
    "order": 4
  },
  {
    "id": "line-syntax",
    "domain": "content",
    "title": "行级语法",
    "titleKey": "styleRef.category.lineSyntax",
    "order": 5
  },
  {
    "id": "table",
    "domain": "content",
    "title": "表格",
    "titleKey": "styleRef.category.table",
    "order": 6
  },
  {
    "id": "reading-structure",
    "domain": "content",
    "title": "阅读块级结构",
    "titleKey": "styleRef.category.readingStructure",
    "order": 7
  },
  {
    "id": "link-image-wikilink",
    "domain": "content",
    "title": "链接、图片与双链",
    "titleKey": "styleRef.category.linkImageWikilink",
    "order": 8
  },
  {
    "id": "content-variables",
    "domain": "content",
    "title": "公开 CSS 变量",
    "titleKey": "styleRef.category.contentVariables",
    "order": 9
  },
  {
    "id": "content-limits",
    "domain": "content",
    "title": "不支持与限制",
    "titleKey": "styleRef.category.contentLimits",
    "order": 10
  },
  {
    "id": "math",
    "domain": "chrome",
    "title": "公式",
    "titleKey": "styleRef.category.math",
    "order": 1
  },
  {
    "id": "diagram",
    "domain": "chrome",
    "title": "图表渲染",
    "titleKey": "styleRef.category.diagram",
    "order": 2
  },
  {
    "id": "graphic-interact",
    "domain": "chrome",
    "title": "图形化按钮与弹窗",
    "titleKey": "styleRef.category.graphicInteract",
    "order": 3
  },
  {
    "id": "code-card",
    "domain": "chrome",
    "title": "代码块卡片",
    "titleKey": "styleRef.category.codeCard",
    "order": 4
  },
  {
    "id": "outline",
    "domain": "chrome",
    "title": "大纲面板",
    "titleKey": "styleRef.category.outline",
    "order": 5
  },
  {
    "id": "chrome-limits",
    "domain": "chrome",
    "title": "限制说明",
    "titleKey": "styleRef.category.chromeLimits",
    "order": 6
  },
  {
    "id": "toolbar-banner",
    "domain": "chrome",
    "title": "工具栏与横幅",
    "titleKey": "styleRef.category.toolbarBanner",
    "order": 7
  },
  {
    "id": "frontmatter",
    "domain": "chrome",
    "title": "frontmatter 表格卡片",
    "titleKey": "styleRef.category.frontmatter",
    "order": 8
  },
  {
    "id": "context-menu",
    "domain": "chrome",
    "title": "正文右键菜单",
    "titleKey": "styleRef.category.contextMenu",
    "order": 9
  },
  {
    "id": "backlinks",
    "domain": "chrome",
    "title": "反链面板",
    "titleKey": "styleRef.category.backlinks",
    "order": 10
  },
  {
    "id": "outlinks",
    "domain": "chrome",
    "title": "出链面板",
    "titleKey": "styleRef.category.outlinks",
    "order": 11
  },
  {
    "id": "hover-preview",
    "domain": "chrome",
    "title": "悬停预览",
    "titleKey": "styleRef.category.hoverPreview",
    "order": 12
  },
  {
    "id": "find-panel",
    "domain": "chrome",
    "title": "查找面板",
    "titleKey": "styleRef.category.findPanel",
    "order": 13
  },
  {
    "id": "loading",
    "domain": "chrome",
    "title": "加载占位",
    "titleKey": "styleRef.category.loading",
    "order": 14
  },
  {
    "id": "tooltip",
    "domain": "chrome",
    "title": "悬停提示",
    "titleKey": "styleRef.category.tooltip",
    "order": 15
  },
  {
    "id": "toast",
    "domain": "chrome",
    "title": "轻提示",
    "titleKey": "styleRef.category.toast",
    "order": 16
  },
  {
    "id": "rich-paste",
    "domain": "chrome",
    "title": "粘贴询问",
    "titleKey": "styleRef.category.richPaste",
    "order": 17
  }
] as readonly StyleContractCategory[]

/** 清单条目（渲染数据形态与单一事实源同构） */
export const STYLE_GUIDE_ENTRIES: readonly StyleContractEntry[] = [
  {
    "id": "container-live",
    "domain": "content",
    "category": "view-container",
    "kind": "container",
    "target": ".vsidian-view-live",
    "purpose": "live（实时预览）视图容器，内含 CodeMirror 6 编辑器。",
    "views": [
      "live"
    ],
    "dom": "#app 直接子元素；阅读模式下 display:none 但 DOM 常驻（样式仍可命中，探针口径与 LineGutterProbe 同理）。",
    "example": ".markdown-source-view.mod-cm6 {\n  /* Obsidian 容器写法：经别名桥命中 live 容器 */\n}",
    "obsidian": {
      "counterpart": ".markdown-source-view（编辑区容器）、.mod-cm6（CM6 模式标记）、.cm-s-obsidian（CM 主题容器）",
      "support": "direct"
    },
    "aliasTargets": [
      "markdown-source-view",
      "mod-cm6",
      "cm-s-obsidian"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」（cases.ts）：容器组合选择器在 live 视图命中",
      "cssProbe.obsidianAliases.container-live"
    ],
    "introduced": "#6（2026-09-23）"
  },
  {
    "id": "container-reading",
    "domain": "content",
    "category": "view-container",
    "kind": "container",
    "target": ".vsidian-view-reading",
    "purpose": "reading（阅读）视图容器；其内为按需挂载的块级结构。",
    "views": [
      "reading"
    ],
    "dom": "#app 直接子元素；块内为 markdown-it 渲染的真实语义标签，标签选择器（p/h1/strong 等）作为容器后代天然命中。",
    "example": ".markdown-preview-view p {\n  /* Obsidian 阅读容器写法：经别名桥命中阅读容器 */\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view（阅读视图容器）",
      "support": "direct"
    },
    "aliasTargets": [
      "markdown-preview-view"
    ],
    "verification": [
      "集成「稳定样式契约」（#6）：.vsidian-view-reading 探针变量可覆盖读取",
      "集成「Obsidian 原名别名桥」：容器后代标签选择器命中",
      "cssProbe.obsidianAliases[\"reading-paragraph\"]（容器别名经后代标签选择器间接验证）"
    ],
    "introduced": "#6（2026-09-23）"
  },
  {
    "id": "live-heading-line",
    "domain": "content",
    "category": "heading",
    "kind": "selector",
    "target": ".vsidian-heading-line-{1..6}",
    "purpose": "live 标题**行容器**类（挂在 .cm-line 行元素上），整行级样式入口。",
    "views": [
      "live"
    ],
    "dom": "live 容器内 .cm-line 行元素；标题标记 # 在光标进入该标题行时显形。",
    "example": ".HyperMD-header-1 {\n  text-decoration: underline;\n}",
    "obsidian": {
      "counterpart": ".HyperMD-header-{1..6}（Obsidian live 标题行容器类）",
      "support": "direct"
    },
    "aliasTargets": [
      "HyperMD-header-{1..6}"
    ],
    "verification": [
      "集成「稳定样式契约」（#6）：.vsidian-heading-line-1 探针命中 rgb(1, 2, 3)",
      "集成「Obsidian 原名别名桥」：.HyperMD-header-1 命中",
      "cssProbe.obsidianAliases[\"live-heading-line\"]"
    ],
    "introduced": "#5（2026-09-23）"
  },
  {
    "id": "live-header-span",
    "domain": "content",
    "category": "heading",
    "kind": "selector",
    "target": ".vsidian-header-{1..6}",
    "purpose": "live 标题**内容 span** 类（mark 装饰，只包标题文字），行内 token 级入口。",
    "views": [
      "live"
    ],
    "dom": "标题行内 mark 装饰 span；Setext 标题同样命中。",
    "example": ".cm-header-1 {\n  font-weight: 700;\n}",
    "obsidian": {
      "counterpart": ".cm-header-{1..6}（Obsidian live 标题行内 token 类）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-header-{1..6}"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.cm-header-1 命中",
      "cssProbe.obsidianAliases[\"live-header-span\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-heading-inview",
    "domain": "content",
    "category": "heading",
    "kind": "selector",
    "target": ".vsidian-heading-inview",
    "purpose": "视口内标题行标记；#55 起仅作 active 背景的作用域限定与观测入口，自身不绘制样式。",
    "views": [
      "live"
    ],
    "states": "标题行进入视口时附加；随滚动增减。",
    "dom": "与 .vsidian-heading-line-{n} 同元素（行级叠加类）。",
    "example": ".vsidian-heading-inview .vsidian-heading-active {\n  /* 与 active 组合使用 */\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 无视口内标题提示类）",
      "support": "none"
    },
    "verification": [
      "单元 liveDecorations：inview/active 类发射契约"
    ],
    "introduced": "#5（2026-09-23）；#55（2026-09-25）移除其左缘竖线绘制"
  },
  {
    "id": "live-heading-active",
    "domain": "content",
    "category": "heading",
    "kind": "selector",
    "target": ".vsidian-heading-active",
    "purpose": "光标所在标题行的行背景强调提示；标题 # 标记在光标进入该行时显形。",
    "views": [
      "live"
    ],
    "states": "光标位于标题范围内时附加；移出即清除。",
    "dom": "与 .vsidian-heading-line-{n} 同元素；背景绘制以 inview 为作用域限定。",
    "example": ".vsidian-heading-line-1.vsidian-heading-active {\n  background: rgba(128, 128, 128, 0.08);\n}",
    "obsidian": {
      "counterpart": "无直接对应（本项目自有扩展）",
      "support": "none"
    },
    "verification": [
      "单元 liveDecorations：活动标题行类发射契约"
    ],
    "introduced": "#5（2026-09-23）"
  },
  {
    "id": "inline-strong",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-strong（live）/ strong 标签（阅读）",
    "purpose": "粗体内容入口：live 为 mark 装饰 span；阅读为 markdown-it 渲染的语义 strong 标签。",
    "views": [
      "live",
      "reading"
    ],
    "states": "live 侧 ** 标记触及显形（光标离开恢复格式化形态）。",
    "dom": "live：标题/正文行内 mark span；阅读：块内真实 <strong> 元素。",
    "example": ".cm-strong {\n  color: #e06c75;\n}\n.markdown-preview-view strong {\n  color: #e06c75;\n}",
    "obsidian": {
      "counterpart": ".cm-strong（live token）/ .markdown-preview-view strong（阅读标签）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-strong"
    ],
    "verification": [
      "集成「稳定样式契约扩展」（#8）：.vsidian-strong 命中 rgb(7, 8, 9)；阅读 strong 探针 rgb(16, 17, 18)",
      "集成「Obsidian 原名别名桥」：.cm-strong 与 .markdown-preview-view strong 命中",
      "cssProbe.liveStrongDecorationColor / readingStrongDecorationColor / obsidianAliases[\"inline-strong\"] / obsidianAliases[\"reading-inline-strong\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "inline-emphasis",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-emphasis（live）/ em 标签（阅读）",
    "purpose": "斜体内容入口：live mark 装饰 span；阅读语义 em 标签。",
    "views": [
      "live",
      "reading"
    ],
    "states": "live 侧 * / _ 标记触及显形。",
    "dom": "同 inline-strong 的两侧结构。",
    "example": ".cm-emphasis {\n  font-style: italic;\n}",
    "obsidian": {
      "counterpart": ".cm-emphasis（live token）/ .markdown-preview-view em（阅读标签）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-emphasis"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.cm-emphasis 命中",
      "cssProbe.obsidianAliases[\"inline-emphasis\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "inline-code",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-inline-code（live）/ code 标签（阅读，块内 code 另有 language-x 类）",
    "purpose": "行内代码内容入口：live mark 装饰 span；阅读语义 code 标签。",
    "views": [
      "live",
      "reading"
    ],
    "states": "live 侧反引号标记触及显形。",
    "dom": "live：行内 mark span（多反引号围栏按实际定界符长度）；阅读：块内 <code>。",
    "example": ".cm-inline-code {\n  font-family: monospace;\n}",
    "obsidian": {
      "counterpart": ".cm-inline-code（Obsidian 亦用 .cm-hmd-inline-code；本清单承诺前者）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-inline-code"
    ],
    "verification": [
      "集成「稳定样式契约扩展」（#8）：.vsidian-inline-code 命中 rgb(10, 11, 12)",
      "集成「Obsidian 原名别名桥」：.cm-inline-code 命中",
      "cssProbe.liveInlineCodeDecorationColor / obsidianAliases[\"inline-code\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "inline-highlight",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-highlight（live）/ mark 标签（阅读）",
    "purpose": "高亮（==文字==）内容入口：live span 常显主题色底；阅读 mark 标签。底色变量见 var-highlight-background。",
    "views": [
      "live",
      "reading"
    ],
    "states": "live 侧 == 定界符触及显形（同粗体语义）。",
    "dom": "live：mark 装饰 span；阅读：块内 <mark>。",
    "example": ".cm-highlight {\n  background: rgba(255, 208, 0, 0.35);\n}",
    "obsidian": {
      "counterpart": ".cm-highlight（live token）/ .markdown-preview-view mark",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-highlight"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.cm-highlight 命中",
      "cssProbe.obsidianAliases[\"inline-highlight\"]"
    ],
    "introduced": "#105（2026-09-27）"
  },
  {
    "id": "inline-strikethrough",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": "del 标签（仅阅读）",
    "purpose": "删除线（~~文字~~）内容入口：**仅阅读视图**——markdown-it 渲染语义 del 标签。live 侧解析器支持但未装饰，源码形态呈现（见 limit-strikethrough-live）。",
    "views": [
      "reading"
    ],
    "dom": "阅读块内 <del> 元素。live 侧无装饰类，不支持。",
    "example": ".markdown-preview-view del {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view del（阅读标签）",
      "support": "direct"
    },
    "verification": [
      "单元 readingMarkdown：~~文字~~ 渲染 del 标签契约"
    ],
    "introduced": "阅读侧随 #8 语义渲染（2026-09-24）；live 侧缺口如实记录"
  },
  {
    "id": "html-comment",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-html-comment（仅 live）",
    "purpose": "HTML 注释淡化入口（#139）：live 侧行内 Comment / 跨行 CommentBlock 整区间（含定界符）mark 装饰 span，前景 45% 混入的低对比呈现（不隐藏不折叠、可读可编辑）。阅读侧经整段真删除（仅保留换行、行内不留空位）隐藏（阅读无注释呈现），无对应类。",
    "views": [
      "live"
    ],
    "states": "live 常显淡化色（无触及显形语义——注释不参与两态切换，Ctrl+/ 是唯一的取消入口）。",
    "dom": "live 容器内 mark 装饰 span；节点名以 Lezer 实测为准（行内 Comment / 块级 CommentBlock，HTMLBlock 是真 HTML 块、其内注释不可达）。",
    "example": ".vsidian-html-comment {\n  color: color-mix(in srgb, var(--vscode-editor-foreground, #808080) 45%, transparent);\n}",
    "obsidian": {
      "counterpart": ".cm-comment 方向（Obsidian 语义对应但不承诺原名命中）",
      "support": "none"
    },
    "verification": [
      "单元 liveDecorations（#139 describe）：Comment/CommentBlock 整区间发射契约",
      "单元 htmlCommentCssContract：淡化色规则钉住",
      "集成「稳定样式契约扩展」（#8）：.vsidian-html-comment 探针命中 rgb(34, 35, 36)",
      "cssProbe.liveHtmlCommentDecorationColor"
    ],
    "introduced": "#139（2026-09-27）"
  },
  {
    "id": "block-id-mark",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-block-id（仅 live）",
    "purpose": "块 id 标记淡化入口（#163 验收反馈）：live 侧行尾 ` ^id` 与独立行 `^id` 双形态整区间 mark 装饰 span（含行尾形态的前导空白），正文前景 45% 混入的低对比呈现——相对正文色变换而非锚定固定色，适配自定义字体颜色；color-mix 单规则服务明暗主题；不隐藏不折叠、可读可编辑。阅读侧经渲染前剥离隐藏（blockIdStrip：行尾删标记、独立行删内容保换行），无对应类。",
    "views": [
      "live"
    ],
    "states": "live 常显淡化色（块 id 是结构标记，无光标两态切换语义——复制块链接入口在右键菜单/快捷键）。",
    "dom": "live 容器内 mark 装饰 span；围栏内部不命中（代码内容），闭围栏行行尾标记命中（围栏块自身的 id）。",
    "example": ".vsidian-block-id {\n  color: color-mix(in srgb, var(--vscode-editor-foreground, #808080) 45%, transparent);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 阅读隐藏、live 内建样式淡化，无公开类名）",
      "support": "none"
    },
    "verification": [
      "单元 liveBlockId：双形态标记区间发射契约",
      "单元 blockIdCssContract：淡化色规则钉住",
      "浏览器 contextMenu：淡化 computed color 断言（双形态 + 自定义字体色跟随 + 阅读隐藏；随 #183 菜单套件统一自 blockMenu 迁移）"
    ],
    "introduced": "#163 验收反馈（2026-09-28）"
  },
  {
    "id": "live-code-line",
    "domain": "content",
    "category": "line-syntax",
    "kind": "selector",
    "target": ".vsidian-code-line",
    "purpose": "live 围栏/缩进代码**行**（含围栏标记行）；卡片开启时的行级类另见 chrome 域 live-code-card-line。",
    "views": [
      "live"
    ],
    "dom": "live 容器内 .cm-line 行元素；围栏内逐行命中。",
    "example": ".HyperMD-codeblock {\n  font-family: monospace;\n}",
    "obsidian": {
      "counterpart": ".HyperMD-codeblock（Obsidian 代码块行类族）",
      "support": "direct"
    },
    "aliasTargets": [
      "HyperMD-codeblock"
    ],
    "verification": [
      "集成「稳定样式契约扩展」（#8）：.vsidian-code-line 命中 rgb(13, 14, 15)",
      "集成「Obsidian 原名别名桥」：.HyperMD-codeblock 命中",
      "cssProbe.liveCodeLineDecorationColor / obsidianAliases[\"live-code-line\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-quote-line",
    "domain": "content",
    "category": "line-syntax",
    "kind": "selector",
    "target": ".vsidian-quote-line",
    "purpose": "live 引用行（> 前缀）；引用内容不额外 span 化（见 limit-quote-span）。左缘 3px 提示竖条颜色见 var-quote-bar-color（与阅读 blockquote 同源）；左内边距 calc(0.9em + 3px)（QuoteMark 呈现态隐藏后的排版位，与阅读 blockquote 对齐）。",
    "views": [
      "live"
    ],
    "states": "行首 > 标记仅在标记及相邻空格附近显形。",
    "dom": "live 容器内 .cm-line 行元素。",
    "example": ".HyperMD-quote {\n  border-left: 3px solid #888;\n  padding-left: 10px;\n}",
    "obsidian": {
      "counterpart": ".HyperMD-quote（Obsidian 引用行类）",
      "support": "direct"
    },
    "aliasTargets": [
      "HyperMD-quote"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.HyperMD-quote 命中",
      "cssProbe.obsidianAliases[\"live-quote-line\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-list-line",
    "domain": "content",
    "category": "list-task",
    "kind": "selector",
    "target": ".vsidian-list-line（+ -d{1..8} 嵌套深度修饰）",
    "purpose": "live 列表项行；深度修饰 -d{1..8} 为本项目自有形态（Obsidian 按行 class 组合表达缩进）。",
    "views": [
      "live"
    ],
    "states": "行首列表标记仅在标记及相邻空格附近显形。",
    "dom": "live 容器内 .cm-line 行元素；与 bullet/ordered 修饰叠加。",
    "example": ".HyperMD-list-line {\n  line-height: 1.7;\n}",
    "obsidian": {
      "counterpart": ".HyperMD-list-line（Obsidian 列表行类族）",
      "support": "direct"
    },
    "aliasTargets": [
      "HyperMD-list-line"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.HyperMD-list-line 命中",
      "cssProbe.obsidianAliases[\"live-list-line\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-list-bullet",
    "domain": "content",
    "category": "list-task",
    "kind": "selector",
    "target": ".vsidian-list-bullet",
    "purpose": "无序列表行修饰：标记隐藏后以 ::before 圆点呈现；圆点按嵌套深度分级（与阅读侧 marker 语义对齐）：一级实心 •、二级空心 ◦、三级起实心方块 ▪——空心专表二级子列表（此前全层级实心与阅读视图不一致已修复）。阅读侧同语义经显式 list-style-type 钉住（disc/circle/square，不依赖 UA 默认）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "与 .vsidian-list-marker-visible 互斥（源码标记显形时抑制伪圆点）；深度分级随 -d{1..8} 行类组合。",
    "dom": "live：列表行级叠加类，圆点绘制在 ::before；阅读：浏览器原生 li::marker。",
    "example": ".vsidian-list-line.vsidian-list-bullet::before {\n  color: #61afef;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 由 .cm-formatting-list 隐藏 + 原生列表样式承担）",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：bullet/ordered 修饰契约",
      "单元 listMarkerCssContract：双视图层级字形钉规则"
    ],
    "introduced": "#8（2026-09-24；层级分级 2026-10 修复）"
  },
  {
    "id": "live-list-ordered",
    "domain": "content",
    "category": "list-task",
    "kind": "selector",
    "target": ".vsidian-list-ordered",
    "purpose": "有序列表行修饰（编号保留可见）。",
    "views": [
      "live"
    ],
    "dom": "列表行级叠加类。",
    "example": ".vsidian-list-line.vsidian-list-ordered {\n  color: inherit;\n}",
    "obsidian": {
      "counterpart": "无直接对应（同 live-list-bullet）",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：bullet/ordered 修饰契约"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-list-marker-visible",
    "domain": "content",
    "category": "list-task",
    "kind": "selector",
    "target": ".vsidian-list-marker-visible",
    "purpose": "无序列表源码标记显形时抑制 ::before 伪圆点，避免双圆点。",
    "views": [
      "live"
    ],
    "states": "光标进入标记邻域时附加。",
    "dom": "列表行级叠加状态类。",
    "example": ".vsidian-list-marker-visible::before {\n  content: none;\n}",
    "obsidian": {
      "counterpart": "无直接对应",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：marker-visible 状态契约"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-task-checkbox",
    "domain": "content",
    "category": "list-task",
    "kind": "selector",
    "target": ".vsidian-task-checkbox（input[type=checkbox]）+ .vsidian-task-checked 修饰",
    "purpose": "live 任务 checkbox（可交互：点击/Enter/空格切换勾选并写回 Markdown）；勾选态双入口：:checked 伪类与 .vsidian-task-checked 类。",
    "views": [
      "live"
    ],
    "states": "光标进入 [ ]/[x] 标记时切回源码形态（widget 撤下）。",
    "dom": "替换任务标记区间的 input widget。",
    "example": ".vsidian-task-checkbox:checked {\n  accent-color: #98c379;\n}",
    "obsidian": {
      "counterpart": ".cm-task-* 方向（Obsidian 任务标记由 HMR widget 承担，无公开稳定类）",
      "support": "semantic"
    },
    "verification": [
      "集成「稳定样式契约」（#9）：.vsidian-task-checkbox 命中 rgb(19, 20, 21)",
      "cssProbe.liveTaskCheckboxDecorationColor"
    ],
    "introduced": "#8（2026-09-24）；#9（2026-09-24）起可交互"
  },
  {
    "id": "live-hr-line",
    "domain": "content",
    "category": "line-syntax",
    "kind": "selector",
    "target": ".vsidian-hr-line",
    "purpose": "live 水平线**行**级类；#106 起升级渲染态后保留作源码态着色。",
    "views": [
      "live"
    ],
    "states": "光标触及该行时源文显形（行级类仍命中）。",
    "dom": "live 容器内 .cm-line 行元素。",
    "example": ".cm-hr {\n  color: var(--vsidian-hr-color);\n}",
    "obsidian": {
      "counterpart": ".cm-hr（Obsidian 水平线 token 类）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-hr"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.cm-hr 命中",
      "cssProbe.obsidianAliases[\"live-hr-line\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-hr-widget",
    "domain": "content",
    "category": "line-syntax",
    "kind": "selector",
    "target": ".vsidian-hr",
    "purpose": "live 水平线渲染 widget 元素（#106：未触及时源文隐藏，本元素以居中渐变呈现真横线；行盒高等于正文行高，颜色与阅读 hr 同源变量 --vsidian-hr-color）。",
    "views": [
      "live"
    ],
    "states": "光标触及该行时撤下 widget、显源码。",
    "dom": "替换水平线整段源文的行内元素。",
    "example": ".vsidian-hr {\n  opacity: 0.9;\n}",
    "obsidian": {
      "counterpart": ".cm-hr 的横线绘制方向（Obsidian 由同一 token 类承担绘制；本项目拆分行类与 widget 两入口）",
      "support": "semantic"
    },
    "verification": [
      "单元 liveDecorations：hr widget 契约；hrPaintCssContract 钉横线绘制规则"
    ],
    "introduced": "#106（2026-09-27）"
  },
  {
    "id": "live-frontmatter-line",
    "domain": "content",
    "category": "line-syntax",
    "kind": "selector",
    "target": ".vsidian-frontmatter-line",
    "purpose": "live frontmatter 行（头块按源码呈现、语法不解析）。",
    "views": [
      "live"
    ],
    "dom": "live 容器内 .cm-line 行元素；边界由 markdownDoc.frontmatterRange 判定（两视图共用）。",
    "example": ".cm-hmd-frontmatter {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": ".cm-hmd-frontmatter（Obsidian frontmatter 类）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-hmd-frontmatter"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.cm-hmd-frontmatter 命中",
      "cssProbe.obsidianAliases[\"live-frontmatter-line\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "live-table-line",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-line",
    "purpose": "live 表格行（表头/分隔/数据行通用）；仅源码降级或活动分隔行显示管道符。",
    "views": [
      "live"
    ],
    "dom": "live 容器内 .cm-line 行元素；与 header/delimiter 修饰叠加。",
    "example": ".HyperMD-table-line {\n  font-family: monospace;\n}",
    "obsidian": {
      "counterpart": ".HyperMD-table-line（Obsidian live 表格行类族）",
      "support": "direct"
    },
    "aliasTargets": [
      "HyperMD-table-line"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.HyperMD-table-line 命中",
      "cssProbe.obsidianAliases[\"live-table-line\"]"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "live-table-header-line",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-header-line",
    "purpose": "live 表头行修饰。",
    "views": [
      "live"
    ],
    "dom": "表格行级叠加类。",
    "example": ".vsidian-table-line.vsidian-table-header-line {\n  font-weight: 600;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 以 thead 样式承担）",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：表头/分隔行修饰契约"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "live-table-delimiter-line",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-delimiter-line",
    "purpose": "live 分隔行修饰（活动分隔行回到源码显示）。",
    "views": [
      "live"
    ],
    "states": "光标进入分隔行时源码形态。",
    "dom": "表格行级叠加类。",
    "example": ".vsidian-table-line.vsidian-table-delimiter-line {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": "无直接对应",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：分隔行修饰契约"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "live-table-cell",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-cell（+ -header 修饰）",
    "purpose": "live 单元格内容 span（trim 后区间）；GFM 拆分语义自研（\\| 与行内代码内的 | 不切分）。",
    "views": [
      "live"
    ],
    "dom": "表格行内 mark 装饰 span；与 align 修饰叠加。",
    "example": ".cm-table-cell {\n  padding: 0 6px;\n}",
    "obsidian": {
      "counterpart": ".cm-table-cell（社区主题常用方向，非 Obsidian 官方类）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-table-cell"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.cm-table-cell 命中",
      "cssProbe.obsidianAliases[\"live-table-cell\"]"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "live-table-pipe",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-pipe",
    "purpose": "live 管道符 span（含首尾边界管道）；网格状态隐藏，源码状态可见。",
    "views": [
      "live"
    ],
    "dom": "表格行内 mark 装饰 span。",
    "example": ".vsidian-table-pipe {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": "无对应（Obsidian 隐藏或原样呈现管道）",
      "support": "native"
    },
    "verification": [
      "集成「表格装饰与单元格编辑写回」（#12）：.vsidian-table-pipe 命中 rgb(19, 20, 21)",
      "cssProbe.liveTablePipeDecorationColor"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "live-table-prefix",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-prefix",
    "purpose": "网格行容器前缀 span（#296 渲染断裂修复）：引用/列表内表格行的前缀区（标记隐藏区与管道前裸空隙）统一包进本 mark，随 CSS display:none 排除出 grid 放置——前缀残留（replace 固有空占位与裸文本）在 grid 下是占位格，会把格子挤 wrap。",
    "views": [
      "live"
    ],
    "states": "光标/选区触及前缀区时 mark 退场，前缀文本显形可编辑（此时前缀参与行内布局）。",
    "dom": "网格行内覆盖容器前缀区间的 mark 装饰 span。",
    "example": ".vsidian-table-prefix {\n  /* 片段一般无需覆写；如需保留前缀视觉痕迹可改呈现 */\n  display: inline;\n}",
    "obsidian": {
      "counterpart": "无对应（Obsidian 对容器内表格的前缀处理无公开类）",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：前缀 mark 发射与触及退场契约（#296 渲染断裂修复）",
      "浏览器 blockquoteTablePaint：引用表格行对齐与列序绘制断言"
    ],
    "introduced": "#296（2026-10-02 渲染断裂修复）"
  },
  {
    "id": "live-table-align",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-align-{left/center/right}",
    "purpose": "live 分隔行声明的列对齐修饰（落在 trim 后内容 span 上）；网格实际布局由 grid-align 承担。",
    "views": [
      "live"
    ],
    "dom": "单元格 span 级叠加类。",
    "example": ".vsidian-table-align-center {\n  text-align: center;\n}",
    "obsidian": {
      "counterpart": "无对应（对齐由渲染布局承担）",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：对齐修饰契约"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "live-table-grid-row",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-grid-row（行附 data-vsidian-table-row=header/row、--vsidian-table-columns 列数与 --vsidian-table-col-widths 列宽计划）",
    "purpose": "安全表格的 CSS grid 网格行；活动格也保留；单元格仍与源区间对应（非独立表格数据模型）。#142 起列宽按内容比例分配：行装饰内联列宽计划（逐列 minmax(min(48px, 等分份额), 内容占比 fr)，同表各行共享同一计划），网格规则消费之；计划缺失时回退列数等分。片段按类规则覆写 grid-template-columns 仍优先生效。#296 渲染断裂修复：通用网格行规则不再声明 padding/box-shadow 抹平引用行类——引用内表格行与 .vsidian-quote-line 组合恢复竖条与内容缩进（同普通引用行观感）；格位外行级残留（管道/测量缓冲/前缀/replace 空占位）一律排除出 grid 放置。",
    "views": [
      "live"
    ],
    "states": "引用/列表内表格行叠加容器行类（竖条、缩进、圆点）；选中行外框另见 row-selected 规则。",
    "dom": "表格行内的网格行容器（grid 布局）。",
    "example": ".vsidian-table-grid-row {\n  /* 覆写为固定轨道 */\n  grid-template-columns: 1fr 2fr;\n}",
    "obsidian": {
      "counterpart": "Obsidian live 网格方向（无精确对应类）",
      "support": "semantic"
    },
    "verification": [
      "单元 liveDecorations + tableRegionSelection：网格结构契约；tablePaintCssContract 钉网格规则（防等分回潮）；tableColumnWidth：列宽计划契约"
    ],
    "introduced": "#42（2026-09-24）；#142（2026-09-27）起内容比例列宽"
  },
  {
    "id": "live-table-grid-cell",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-grid-cell",
    "purpose": "安全表格的网格单元格；光标进入格子后网格不撤下，直接在该格源区间输入（复用 CM6 的 IME、导航与写回）。",
    "views": [
      "live"
    ],
    "dom": "网格行内的单元格元素。",
    "example": ".vsidian-table-grid-cell {\n  padding: 2px 8px;\n}",
    "obsidian": {
      "counterpart": "Obsidian live 网格方向",
      "support": "semantic"
    },
    "verification": [
      "tablePaintCssContract：网格单元格规则；浏览器 tableCaret：光标直编回流"
    ],
    "introduced": "#42（2026-09-24）"
  },
  {
    "id": "live-table-grid-delimiter",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-grid-delimiter",
    "purpose": "网格状态下的分隔行隐藏。",
    "views": [
      "live"
    ],
    "states": "活动分隔行回到源码。",
    "dom": "网格行内的分隔行元素。",
    "example": ".vsidian-table-grid-delimiter {\n  display: none;\n}",
    "obsidian": {
      "counterpart": "Obsidian 表格对齐方向",
      "support": "semantic"
    },
    "verification": [
      "tablePaintCssContract：分隔行隐藏规则"
    ],
    "introduced": "#42（2026-09-24）"
  },
  {
    "id": "live-table-grid-align",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-grid-align-{left/center/right}",
    "purpose": "网格状态的列对齐（#142 起应用到该列全部单元格——空格占位 widget 同样携带对齐类）。",
    "views": [
      "live"
    ],
    "dom": "网格单元格级叠加类。",
    "example": ".vsidian-table-grid-align-center {\n  text-align: center;\n}",
    "obsidian": {
      "counterpart": "Obsidian 表格对齐方向",
      "support": "semantic"
    },
    "verification": [
      "tablePaintCssContract：对齐规则"
    ],
    "introduced": "#42（2026-09-24）"
  },
  {
    "id": "live-table-escaped-pipe",
    "domain": "content",
    "category": "table",
    "kind": "selector",
    "target": ".vsidian-table-escaped-pipe",
    "purpose": "网格中隐藏转义管道符前的反斜杠；只改变显示，不改 Markdown 原文。",
    "views": [
      "live"
    ],
    "dom": "网格单元格内 span。",
    "example": ".vsidian-table-escaped-pipe {\n  display: none;\n}",
    "obsidian": {
      "counterpart": "无直接对应",
      "support": "native"
    },
    "verification": [
      "单元 tableCells：转义管道拆分契约"
    ],
    "introduced": "#42（2026-09-24）"
  },
  {
    "id": "live-escape",
    "domain": "content",
    "category": "inline-format",
    "kind": "selector",
    "target": ".vsidian-escape（Markdown 转义符反斜杠隐藏类；.vsidian-escape-reveal 为触及行显形类）",
    "purpose": "转义符通用显隐（验收反馈通用化，Obsidian 对齐）：Live 正文中 Markdown 转义序列（反斜杠 + ASCII 标点，树驱动 Escape 节点）的反斜杠默认隐藏——所见为字面字符（\\* 渲染为 *，\\\\ 渲染为 \\）；光标/选区触及该行时换挂显形类，反斜杠以正文前景低混入浅色呈现（暴露源码，口径同块 id 淡化）。表格行内的转义符不经此类：\\| 走 #42 live-table-escaped-pipe 专用发射与规则（降级表格源文原文呈现）；格内其他转义符（\\* 等）零发射、反斜杠常驻原文可见——降级口径：表格自研拆分与通用发射双路径互斥（叠类互抹），钉住在 liveEscape 用例。代码块/行内代码内不生效（无 Escape 节点）。只改显示，不改原文。",
    "views": [
      "live"
    ],
    "states": "隐藏（默认——反斜杠 display:none）/ 显形（触及行换挂 reveal 类：display:inline + 正文前景 45% 低混入色，跟随明暗主题与自定义字体色）；显隐切换随选区事务重建，与标题/双链 mark 显隐同一谓词语义（折叠光标含行两端、非空选区严格重叠）。",
    "dom": "行内 mark span（树驱动 Escape 节点首字符单位）；与双链/强调等行内 mark 可嵌套共存。",
    "example": "#app .cm-editor .cm-scroller .vsidian-escape {\n  display: none;\n}\n#app .cm-editor .cm-scroller .vsidian-escape-reveal {\n  color: color-mix(in srgb, var(--vscode-editor-foreground, #808080) 45%, transparent);\n}",
    "obsidian": {
      "counterpart": "Obsidian Live Preview 转义符行内源码暴露（光标行显示浅色反斜杠）",
      "support": "semantic"
    },
    "verification": [
      "单元 liveEscape：构建层（隐藏/显形/选区/代码 span 排除/表格排除）与 DOM 层（真实 EditorView 类名挂载）",
      "单元 escapeCssContract：隐藏与显形色规则（color-mix 低混入）钉住"
    ],
    "introduced": "#217 验收反馈（2026-09-30）"
  },
  {
    "id": "mod-link-hover",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": "body.vsidian-mod-link（Ctrl/Cmd 修饰键激活态，挂 body 的全局状态类）",
    "purpose": "修饰键悬停反馈（#217 验收反馈：Ctrl+悬停可跳转链接但无任何样式提示，可发现性缺失）：按住 Ctrl/Cmd 时悬停可跳转的链接（双链/嵌入引用/普通链接——源码态 mark 与渲染态 widget，Reading 侧 a 同款）加下划线并显示可点击光标（替代文本光标竖条）。状态类由 syncController 的 document 级 keydown/keyup（getModifierState 精确处理左右修饰键同按与交替）与窗口 blur 回落维护；渲染态 widget 的常驻可点击光标（既有规则）不受影响。",
    "views": [
      "live",
      "reading"
    ],
    "states": "激活（Ctrl/Cmd 按住——body 挂类，悬停链接命中下划线 + cursor:pointer）/ 未激活（无类，链接呈现同既有）；窗口失焦强制回落（keyup 可能丢失）。",
    "dom": "body 上的类；规则选择器覆盖 .vsidian-wikilink / .vsidian-link / Reading a 的 :hover。",
    "example": "body.vsidian-mod-link #app .cm-editor .cm-scroller .vsidian-wikilink:hover { text-decoration: underline; cursor: pointer; }",
    "obsidian": {
      "counterpart": "Obsidian 按住 Ctrl 悬停内部链接的指针与下划线反馈方向",
      "support": "semantic"
    },
    "verification": [
      "单元 syncController 修饰键状态类：keydown 挂类 / keyup 摘类 / blur 回落",
      "单元链接 CSS 契约：状态类规则（underline + cursor）钉住",
      "浏览器：真实键盘 Ctrl 按下/抬起 + 悬停链接的 computed 样式断言"
    ],
    "introduced": "#217 验收反馈（2026-09-30）"
  },
  {
    "id": "reading-block",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-block（+ data-vsidian-src-start / -end 源锚点属性）",
    "purpose": "阅读容器内每个内容块的基类；锚点属性为 LF 全文 UTF-16 offset（与消息协议坐标同构），按需挂载与任务定位依赖。",
    "views": [
      "reading"
    ],
    "dom": ".vsidian-view-reading 直接子元素；块内为 markdown-it 渲染的真实语义标签。",
    "example": ".vsidian-reading-block {\n  margin: 0 0 12px;\n}",
    "obsidian": {
      "counterpart": "无对应（Obsidian 阅读为扁平标签流；本项目为 div 包裹 + 内层标签结构）",
      "support": "native"
    },
    "verification": [
      "单元 readingView：块结构与锚点契约；集成「阅读视图表格」等块级用例"
    ],
    "introduced": "#6（2026-09-23）"
  },
  {
    "id": "reading-heading",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-heading-{1..6}（块类）+ 内层语义 h{1..6} 标签",
    "purpose": "阅读标题块；双入口命中（块类 + 内层标签）。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 h{n} 元素。",
    "example": ".markdown-preview-view h1 {\n  color: var(--vsidian-heading-color-1);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view h{1..6}",
      "support": "direct"
    },
    "verification": [
      "集成「稳定样式契约」（#6）：.vsidian-reading-heading-1 命中 rgb(4, 5, 6)",
      "集成「Obsidian 原名别名桥」：.markdown-preview-view h1 命中",
      "cssProbe.readingHeadingDecorationColor / obsidianAliases[\"reading-heading\"]"
    ],
    "introduced": "#6（2026-09-23）"
  },
  {
    "id": "reading-paragraph",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-paragraph（块类）+ 内层 p 标签",
    "purpose": "阅读段落块。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 p 元素。",
    "example": ".markdown-preview-view p {\n  margin: 0 0 10px;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view p",
      "support": "direct"
    },
    "verification": [
      "集成「Obsidian 原名别名桥」：.markdown-preview-view p 命中",
      "cssProbe.obsidianAliases[\"reading-paragraph\"]"
    ],
    "introduced": "#6（2026-09-23）"
  },
  {
    "id": "reading-blockquote",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-blockquote（块类）+ 内层 blockquote 标签",
    "purpose": "阅读引用块。左边框 3px 提示竖条颜色见 var-quote-bar-color（与 live 引用行同源）。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 blockquote 元素。",
    "example": ".markdown-preview-view blockquote {\n  border-left: 3px solid #888;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view blockquote",
      "support": "direct"
    },
    "verification": [
      "集成「Obsidian 原名别名桥」：.markdown-preview-view blockquote 命中",
      "cssProbe.obsidianAliases[\"reading-blockquote\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "reading-list",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-list（块类）+ 内层 ul/ol/li 嵌套（li 带源锚点）",
    "purpose": "阅读列表块（整块还原嵌套结构）。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 ul/ol > li 嵌套。",
    "example": ".markdown-preview-view ul {\n  padding-left: 22px;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view ul / ol / li",
      "support": "direct"
    },
    "verification": [
      "集成「Obsidian 原名别名桥」：.markdown-preview-view ul 命中",
      "cssProbe.obsidianAliases[\"reading-list\"]"
    ],
    "introduced": "#6（2026-09-23）；#8 起还原嵌套"
  },
  {
    "id": "reading-task",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": "li.vsidian-reading-task",
    "purpose": "阅读任务列表项（挂在语义 li 上）；data-task 扩展勾选状态（[/]、[!] 等）不支持。",
    "views": [
      "reading"
    ],
    "dom": "列表块内 li 元素。",
    "example": ".markdown-preview-view .task-list-item {\n  list-style: none;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view .task-list-item",
      "support": "direct"
    },
    "aliasTargets": [
      "task-list-item"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.task-list-item 命中",
      "cssProbe.obsidianAliases[\"reading-task\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "reading-task-checkbox",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-task-checkbox（input[type=checkbox]）",
    "purpose": "阅读任务复选框（点击/键盘切换并写回）。",
    "views": [
      "reading"
    ],
    "dom": "任务 li 内 input 元素。",
    "example": ".markdown-preview-view .task-list-item input[type=\"checkbox\"] {\n  accent-color: #98c379;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view .task-list-item input[type=\"checkbox\"]",
      "support": "direct"
    },
    "verification": [
      "集成「稳定样式契约」（#9）：.vsidian-reading-task-checkbox 命中 rgb(22, 23, 24)",
      "集成「Obsidian 原名别名桥」：.task-list-item input[type=checkbox] 命中",
      "cssProbe.readingTaskCheckboxDecorationColor / obsidianAliases[\"reading-task-checkbox\"]"
    ],
    "introduced": "#8（2026-09-24）；#9 起启用勾选写回"
  },
  {
    "id": "reading-code-block",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-code-block（块类）+ 内层 pre > code（code 带语言类 language-x）",
    "purpose": "阅读围栏/缩进代码块（内容不含围栏标记文本；大围栏超 60 行按行细分为多块；卡片化外壳另见 chrome 域 reading-code-card）。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 pre > code。",
    "example": ".markdown-preview-view pre {\n  background: var(--vsidian-reading-code-background);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view pre",
      "support": "direct"
    },
    "verification": [
      "集成「Obsidian 原名别名桥」：.markdown-preview-view pre 命中",
      "cssProbe.obsidianAliases[\"reading-code-block\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "reading-hr",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-hr（块类）+ 内层 hr 标签",
    "purpose": "阅读水平线块。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 hr 元素。",
    "example": ".markdown-preview-view hr {\n  border-color: var(--vsidian-hr-color);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view hr",
      "support": "direct"
    },
    "verification": [
      "集成「Obsidian 原名别名桥」：.markdown-preview-view hr 命中",
      "cssProbe.obsidianAliases[\"reading-hr\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "reading-table",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-table（块类）+ 内层真实 table/thead/tbody（GFM 列对齐保留在 th/td 内联 style）",
    "purpose": "阅读表格块（markdown-it 渲染，只读呈现）。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内含真实 table 元素。",
    "example": ".markdown-preview-view table {\n  background: var(--vsidian-table-background);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view table",
      "support": "direct"
    },
    "verification": [
      "集成「阅读视图表格」（#12）：.vsidian-reading-block table 命中 rgb(22, 23, 24)",
      "集成「Obsidian 原名别名桥」：.markdown-preview-view table 命中",
      "cssProbe.readingTableDecorationColor / obsidianAliases[\"reading-table\"]"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "reading-frontmatter",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-frontmatter（块类；内部 pre.vsidian-reading-frontmatter-text）",
    "purpose": "阅读 frontmatter 头块（源码呈现，头块内语法不解析，两视图共用边界判定）。",
    "views": [
      "reading"
    ],
    "dom": "块级容器内 pre 元素。",
    "example": ".markdown-preview-view .markdown-frontmatter {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view .markdown-frontmatter",
      "support": "direct"
    },
    "aliasTargets": [
      "markdown-frontmatter"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：.markdown-frontmatter 命中",
      "cssProbe.obsidianAliases[\"reading-frontmatter\"]"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "reading-spacer",
    "domain": "content",
    "category": "reading-structure",
    "kind": "selector",
    "target": ".vsidian-reading-spacer（-top / -bottom）",
    "purpose": "阅读视口占位：屏外块的高度占位（非内容节点，高度为块高度表前后缀和）；本项目自有结构，不参与兼容承诺，出现在片段中不影响内容块定位。",
    "views": [
      "reading"
    ],
    "dom": "阅读容器首/尾的占位 div。",
    "example": "/* 无需定位；虚拟化结构见 limit-virtualization */",
    "obsidian": {
      "counterpart": "无对应（Obsidian 虚拟化由内部机制承担）",
      "support": "none"
    },
    "verification": [
      "单元 readingViewport / readingVirtualView：挂载窗口与 spacer 契约"
    ],
    "introduced": "#7（2026-09-24）"
  },
  {
    "id": "live-link",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-link",
    "purpose": "live 链接**内容** span（始终标记；光标或选区进入该链接范围时显示 [ 和 ](url) 源码，同一行其他链接保持格式化）；隐藏尾部对应 Obsidian .cm-formatting-link / .cm-string.cm-url 方向——本项目以隐藏呈现，无独立样式类。",
    "views": [
      "live"
    ],
    "states": "光标/选区进入链接范围时源码显形。",
    "dom": "live 行内 mark 装饰 span（间接装饰：视口外按源码呈现，滚动进入视口后应用）。",
    "example": ".cm-link {\n  color: #61afef;\n}",
    "obsidian": {
      "counterpart": ".cm-link（Obsidian 链接内容 token）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-link"
    ],
    "verification": [
      "集成「稳定样式契约」（#10）：.vsidian-link 命中 rgb(19, 20, 21)",
      "集成「Obsidian 原名别名桥」：.cm-link 命中",
      "cssProbe.liveLinkDecorationColor / obsidianAliases[\"live-link\"]"
    ],
    "introduced": "#10（2026-09-24）"
  },
  {
    "id": "reading-link",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": "阅读链接（语义 a 标签，无自有类）",
    "purpose": "阅读链接：markdown-it 渲染的语义 <a>（单击经容器委托上报跳转意图，不做 webview 原生导航）。",
    "views": [
      "reading"
    ],
    "dom": "阅读块内真实 a 元素。",
    "example": ".markdown-preview-view a {\n  color: #61afef;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view a",
      "support": "direct"
    },
    "verification": [
      "集成「稳定样式契约」（#10）：阅读 a 探针 rgb(22, 23, 24)",
      "集成「Obsidian 原名别名桥」：.markdown-preview-view a 命中",
      "cssProbe.readingLinkDecorationColor / obsidianAliases[\"reading-link\"]"
    ],
    "introduced": "#10（2026-09-24）"
  },
  {
    "id": "image-slot",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-image（双视图）",
    "purpose": "图片槽位基类：阅读视图为 <img> 元素本体（Obsidian img 标签选择器天然命中）；live 视图为 widget 容器 span（内部 img 由资源管理器装载，本项目自有形态）。#212 起非链接内嵌、非表格内的图片挂同款按钮组：live 槽位 span 兼任 vsidian-graphic-frame（vsidian-image 类保留，槽位语义不变）；阅读 img 经同款 frame span 包裹（img 为 void 元素不能有子元素）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "进入视口才发起装载；离开视口卸载释放（src 清空）。#212：loaded 态按钮组显现（错误/加载态无按钮——错误态点击重试语义照旧），由 data-vsidian-img-state 的兄弟/子代选择器驱动。",
    "dom": "阅读：块内 img.vsidian-image（#212 起外层可有 span.vsidian-graphic-frame.vsidian-image 包裹）；live：行内 widget span.vsidian-image > img（挂按钮组时叠加 frame 类，按钮组为 img 后置兄弟）。",
    "example": ".markdown-preview-view img {\n  max-width: 100%;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view img（阅读）/ .cm-image（live 方向，Obsidian 无公开稳定类）",
      "support": "direct"
    },
    "verification": [
      "集成「稳定样式契约」（#10）：阅读 img.vsidian-image 命中 rgb(25, 26, 27)",
      "cssProbe.readingImageDecorationColor"
    ],
    "introduced": "#10（2026-09-24）"
  },
  {
    "id": "image-states",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-image-loading / -loaded / -error（与 data-vsidian-img-state 同步）",
    "purpose": "图片三态：占位（alt 文本）/ 已加载（load 事件确认）/ 失败（点击重试，可见错误轮廓）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "loading → loaded / error；error 态点击可重试。",
    "dom": "图片槽位元素级状态修饰类。",
    "example": ".vsidian-image-error {\n  outline: 1px dashed #e06c75;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 无公开加载状态类）",
      "support": "native"
    },
    "verification": [
      "单元 imageResource：三态状态机契约；集成 reading.test.image 注入用例"
    ],
    "introduced": "#10（2026-09-24）"
  },
  {
    "id": "image-failure-variants",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-image-notfound / .vsidian-image-unreachable（叠加在 error 基类上）",
    "purpose": "#201 失败态细分：明确删除（磁盘正证据 missing，找不到）与不可访问（SSH 断连/权限错误）不冒充彼此——找不到淡红底强调、不可访问黄系提示；与 data-vsidian-img-reason（not-found / inaccessible）同步。",
    "views": [
      "live",
      "reading"
    ],
    "states": "仅在 error 基类上叠加出现；失效重发成功（loaded）或槽位释放时移除。",
    "dom": "图片槽位元素级失败原因修饰类。",
    "example": ".vsidian-image-notfound {\n  background: rgba(190, 17, 0, 0.08);\n}\n.vsidian-image-unreachable {\n  border-color: #cca700;\n}",
    "obsidian": {
      "counterpart": "无对应（Obsidian 无删除/不可访问区分类）",
      "support": "none"
    },
    "verification": [
      "单元 imageResource：细分类与 data 同步契约",
      "集成 #201：删除图片后 notfound 绘制层可见",
      "浏览器 imageRefresh：删除可见态与不可访问区分断言"
    ],
    "introduced": "#201（2026-09-29）"
  },
  {
    "id": "image-solo-block",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-image-block（修饰类，叠加于 .vsidian-image；live 槽位与阅读 frame 两种宿主）；.vsidian-image-sized（伴随修饰类，独行图贴图收缩，#212 按钮贴图修复追加）",
    "purpose": "独立成行图片的块级容器变体：live 侧整行仅含一张图片（其余文本全空白，含尾随空白）时 widget 槽位取块级布局；#212 起阅读侧同语义——段落内图片为唯一元素子节点且前后兄弟文本全空白时，挂载钩子包 frame 后由 JS 判定挂本类（不用 :only-child 伪类——它只统计元素子节点，「文字+图」混排段会误命中把混排图独占一行）。块级布局为无固有尺寸的图源（viewBox-only 百分比宽 SVG，mermaid 导出形态）提供确定宽度基准——此类图源在 inline-block shrink-to-fit 下渲染为 0×0（img 加载成功故静默无反馈，表现为空白行）；有固有尺寸的图源不受影响（块级下仍按自然宽度呈现）。已知边界：行内混排（列表前缀、混排文字、同行多图）的此类 SVG 仍为行内形态。伴随修饰类 vsidian-image-sized（仅独行块级形态上生效）：图装载完成后渲染宽仍窄于行可用宽（父级 content 宽）时由 markImageFrameSized 挂上，frame 取 width:fit-content 收缩贴图——按钮组（absolute 右上）跟随贴图右上而非行右缘；百分比宽 SVG 与被钳制大图（渲染宽＝行宽）不挂，前者的块级撑满基准（塌缩修复语义）因此不受 fit-content 化影响。判定分母取父级 content 宽而非 frame 当前宽（后者在收缩后自我否定）；装载前不算（百分比宽 SVG 装载前以 naturalWidth 伪值呈现，早算误挂后塌缩死锁）；离屏构建期经 ResizeObserver 等获得布局后首算。",
    "views": [
      "live",
      "reading"
    ],
    "states": "live：装饰构建时按行判定（树驱动与宽松路径同口径），行内 [from,to) 之外文本全空白即独立成行。阅读：decorateImageChromeBlock 包 frame 时按父元素判定（唯一元素子节点 + 前后兄弟文本全空白）。三态修饰类照常叠加。sized：仅独行块级形态挂载（live render 回调按 block+chrome 判定、阅读包 frame 时按 block 类判定——行内混排/链接内嵌/表格图不挂，无按钮贴图诉求）——图装载完成（load 常驻重算，invalidate 重取后随新 load 收敛）且渲染宽窄于行可用宽时挂，否则摘；error 态即摘（成功→失效→重取失败链上恢复撑满 error 框与重试点击目标，不因收缩残留窄化）；装载态无视觉差异（按钮组随 loaded 态显现）。",
    "dom": "live 行内 widget span.vsidian-image.vsidian-image-block > img；阅读 span.vsidian-graphic-frame.vsidian-image.vsidian-image-block > img（均 display: block）。sized 叠加时同节点加 .vsidian-image-sized（width: fit-content）。",
    "example": ".vsidian-image-block {\n  display: block;\n}\n\n/* 按钮组贴图收缩（图装载后窄于行时） */\n.vsidian-image-block.vsidian-image-sized {\n  width: fit-content;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 无公开独立图片布局类）",
      "support": "native"
    },
    "verification": [
      "浏览器 liveImageLayout：真实 Chromium + 生产控制器——独行 viewBox-only SVG 渲染宽度铺满正文列（修复前 0×0）、固有尺寸图不拉伸、限宽档随列联动、阅读侧非回归",
      "浏览器 imagePopup：阅读侧独行图 frame display=block、文字混排图 display=inline-block（:only-child 误伤回归钉住）",
      "浏览器 imagePopup（#212 按钮贴图修复）：live/阅读独行定宽图 chrome 右缘与图右缘 gap 落在 6px 内缩带、宽幅百分比 SVG 两侧撑满不塌（sized 分治守恒）",
      "单元 linkInteraction：独立成行判定（整行/尾随空白/列表前缀/混排/同行两图/宽松路径）与 widget 形态 eq"
    ],
    "introduced": "live SVG 塌缩修复（2026-09-29）"
  },
  {
    "id": "live-wikilink",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-wikilink",
    "purpose": "live 双链呈现：光标在范围外时为显示文字 widget（替换整个 [[…]]，别名类挂在 widget 外层与源码 mark 上），进入范围后为源码 mark。Obsidian 的拆分形态（链接名/别名/格式化括号）无拆分类。",
    "views": [
      "live"
    ],
    "states": "光标进入该双链范围时源码显形。",
    "dom": "live 行内 widget 或 mark 装饰（间接装饰，视口外按源码呈现；围栏/行内代码与 frontmatter 内不装饰）。",
    "example": ".cm-hmd-internal-link {\n  color: #c678dd;\n}",
    "obsidian": {
      "counterpart": ".cm-hmd-internal-link（Obsidian live 内链 token 类族）",
      "support": "direct"
    },
    "aliasTargets": [
      "cm-hmd-internal-link"
    ],
    "verification": [
      "集成「稳定样式契约」（#11）：.vsidian-wikilink 命中 rgb(28, 29, 30)",
      "集成「Obsidian 原名别名桥」：.cm-hmd-internal-link 命中",
      "cssProbe.liveWikilinkDecorationColor / obsidianAliases[\"live-wikilink\"]"
    ],
    "introduced": "#11（2026-09-24）"
  },
  {
    "id": "reading-wikilink",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": "a.vsidian-wikilink",
    "purpose": "阅读双链：markdown-it 双链规则渲染的语义 <a>（href 为原文 target，显示别名或链接名；单击上报跳转意图）。",
    "views": [
      "reading"
    ],
    "dom": "阅读块内真实 a 元素。",
    "example": ".markdown-preview-view a.internal-link {\n  color: #c678dd;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view a.internal-link（Obsidian 阅读内链类）",
      "support": "direct"
    },
    "aliasTargets": [
      "internal-link"
    ],
    "verification": [
      "集成「稳定样式契约」（#11）：阅读 a.vsidian-wikilink 命中 rgb(31, 32, 33)",
      "集成「Obsidian 原名别名桥」：a.internal-link 命中",
      "cssProbe.readingWikilinkDecorationColor / obsidianAliases[\"reading-wikilink\"]"
    ],
    "introduced": "#11（2026-09-24）"
  },
  {
    "id": "anchor-flash",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-anchor-flash",
    "purpose": "跳转目标高亮（#163 验收反馈）：双链/普通链接锚点跳转（view.locate 通道）后目标标题/段落整体覆盖半透黄；用户任意操作（点击、滚动、按键、切走页面）后消失。live 为行级 line 装饰（目标块逐行）、reading 为块级类（flashBlock，虚拟化重挂载后保持）——类名跨视图同口径，背景色经 --vsidian-anchor-flash-background 变量暴露（用户可覆盖的 CSS 接口，见 var-anchor-flash-background）。大纲点击不闪（已有条目常驻高亮）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "跳转定位后出现，用户任意操作（含切换模式、编辑文档）后消失——瞬态提示，无常驻态。",
    "dom": "live：.cm-line 行元素（目标块各行）；reading：.vsidian-reading-block 块元素。",
    "example": ".vsidian-anchor-flash {\n  background: var(--vsidian-anchor-flash-background);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 内建高亮动画无公开类名）",
      "support": "none"
    },
    "verification": [
      "单元 anchorFlash：目标区间推导与 StateField set/clear",
      "单元 anchorFlashPanel：定位加类、点击/滚动/blur 消失、程序滚动时间窗不误清",
      "单元 anchorFlashCssContract：两视图规则同引变量、变量定义于 #app",
      "浏览器 anchorFlash：真实 view.locate 后绘制层背景断言与消失交互"
    ],
    "introduced": "#163 验收反馈（2026-09-28）"
  },
  {
    "id": "var-anchor-flash-background",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-anchor-flash-background",
    "purpose": "跳转目标高亮的半透黄背景色（#163 验收反馈）：用户可覆盖的 CSS 接口，live 行级与 reading 块级两条规则同引（一处定义两视图生效）。默认 rgba(255, 213, 79, 0.25)。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app。",
    "example": ":root {\n  --vsidian-anchor-flash-background: rgba(255, 213, 79, 0.25);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "单元 anchorFlashCssContract：变量定义与两规则引用"
    ],
    "introduced": "#163 验收反馈（2026-09-28）"
  },
  {
    "id": "var-heading-color",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-heading-color-{1..6}",
    "purpose": "标题层级色变量族：live 标题行级、阅读标题块级与大纲条目级三侧同引（主题分级着色一处定义多处生效）。默认 var(--vscode-editor-foreground)。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app；Obsidian 别名 --h{1..6}-color 经变量桥生效（vsidian 名整条覆盖严格优先）。",
    "example": ":root {\n  --h1-color: #61afef; /* Obsidian 写法 */\n  --vsidian-heading-color-1: #61afef; /* vsidian 写法（优先） */\n}",
    "obsidian": {
      "counterpart": "--h1-color … --h6-color（Obsidian 分色变量族）",
      "support": "direct"
    },
    "aliasTargets": [
      "--h1-color",
      "--h2-color",
      "--h3-color",
      "--h4-color",
      "--h5-color",
      "--h6-color"
    ],
    "verification": [
      "集成「Obsidian 原名别名桥」：--h1-color 探针驱动标题 computed color",
      "cssProbe.obsidianHeadingColor（live/reading）",
      "outlineCssContract：三侧同引关系"
    ],
    "introduced": "#65（2026-09-25）"
  },
  {
    "id": "var-reading-font-size",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-reading-font-size",
    "purpose": "阅读正文字号；默认 var(--vsidian-content-font-size)（跟随 VSCode 编辑器字号）。",
    "views": [
      "reading"
    ],
    "dom": "定义于阅读内容层；Obsidian 别名 --font-text-size。",
    "example": ":root { --font-text-size: 16px; }",
    "obsidian": {
      "counterpart": "--font-text-size",
      "support": "direct"
    },
    "aliasTargets": [
      "--font-text-size"
    ],
    "verification": [
      "单元：reading 排版消费契约（#32 排版基线用例）；obsidianAliasCssContract 钉变量桥形态"
    ],
    "introduced": "#32（2026-09-24，随两模式排版基线公开）"
  },
  {
    "id": "var-reading-max-width",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-reading-max-width",
    "purpose": "阅读块最大宽度（#175 起为可读行宽双变量之一，设置 editor.readableLineWidth 一份值同时驱动两模式，片段可分别单独覆盖）；默认 none = 铺满（原 760px 隐形限宽随 #174 修复废止）。",
    "views": [
      "reading"
    ],
    "dom": "定义于 #app 层（#175 起与 live 变量同址——设置值以内联写在挂载根元素，原阅读层定义会遮蔽内联故上移）；Obsidian 别名 --file-line-width。",
    "example": ":root { --file-line-width: 700px; }",
    "obsidian": {
      "counterpart": "--file-line-width",
      "support": "direct"
    },
    "aliasTargets": [
      "--file-line-width"
    ],
    "verification": [
      "obsidianAliasCssContract：变量桥形态",
      "浏览器：readingWidthProbe（铺满/限宽居中/片段优先序三态）"
    ],
    "introduced": "#32（2026-09-24）"
  },
  {
    "id": "var-live-preview-max-width",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-live-preview-max-width",
    "purpose": "Live 正文列最大宽度（#175 新增，与阅读变量共用设置值；限宽时 [行号列+间距+正文列] 整组居中，行号列随列移动）；默认 none = 铺满。",
    "views": [
      "live"
    ],
    "dom": "定义于 #app 层；Obsidian 别名 --file-line-width（与阅读变量同别名——Obsidian 语义即一个全局行宽同时作用于编辑与阅读两视图）。",
    "example": ":root { --file-line-width: 700px; }",
    "obsidian": {
      "counterpart": "--file-line-width",
      "support": "direct"
    },
    "aliasTargets": [
      "--file-line-width"
    ],
    "verification": [
      "obsidianAliasCssContract：变量桥形态",
      "浏览器：readingWidthProbe（限宽整组居中/行号列随列）"
    ],
    "introduced": "#175（2026-09-28）"
  },
  {
    "id": "var-reading-line-height",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-reading-line-height",
    "purpose": "阅读正文行高；默认 var(--vsidian-content-line-height)。",
    "views": [
      "reading"
    ],
    "dom": "定义于阅读内容层；Obsidian 别名 --line-height-normal。",
    "example": ":root { --line-height-normal: 1.7; }",
    "obsidian": {
      "counterpart": "--line-height-normal",
      "support": "direct"
    },
    "aliasTargets": [
      "--line-height-normal"
    ],
    "verification": [
      "obsidianAliasCssContract：变量桥形态"
    ],
    "introduced": "#32（2026-09-24）"
  },
  {
    "id": "var-reading-code-background",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-reading-code-background",
    "purpose": "代码块背景；默认 var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12))。",
    "views": [
      "reading"
    ],
    "dom": "定义于阅读代码块层；Obsidian 别名 --code-background。",
    "example": ":root { --code-background: rgba(0, 0, 0, 0.3); }",
    "obsidian": {
      "counterpart": "--code-background",
      "support": "direct"
    },
    "aliasTargets": [
      "--code-background"
    ],
    "verification": [
      "obsidianAliasCssContract：变量桥形态"
    ],
    "introduced": "#32（2026-09-24）"
  },
  {
    "id": "var-highlight-background",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-highlight-background",
    "purpose": "高亮底色：live 正文 span、阅读 mark、大纲条目三侧同引。默认深色 rgba(255, 208, 0, 0.35)、浅色 body.vscode-light 覆盖 #ffe066（两轮视觉实测主题变量对比不足，切 Obsidian 式固定荧光黄双主题调校）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（浅色分支 body.vscode-light）；Obsidian 别名 --text-highlight-bg。",
    "example": ":root { --text-highlight-bg: rgba(255, 208, 0, 0.4); }",
    "obsidian": {
      "counterpart": "--text-highlight-bg",
      "support": "direct"
    },
    "aliasTargets": [
      "--text-highlight-bg"
    ],
    "verification": [
      "highlightPaintCssContract：三侧同引；obsidianAliasCssContract：变量桥形态（含浅色分支）"
    ],
    "introduced": "#105（2026-09-27）"
  },
  {
    "id": "var-quote-bar-color",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-quote-bar-color",
    "purpose": "引用块提示竖条色：live 引用行（.vsidian-quote-line 的 inset 竖条）与阅读 blockquote 左边框两侧同引。明显 accent 紫：暗色主题默认 #a78bfa、浅色 body.vscode-light 分支覆盖 #7c3aed；背景底仍走 --vscode-textBlockQuote-background（仅竖条换色，不新增紫色背景）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（浅色分支 body.vscode-light）；自有变量，无 Obsidian 别名。",
    "example": ":root { --vsidian-quote-bar-color: #c678dd; }",
    "obsidian": {
      "counterpart": "无（Obsidian 引用竖条由主题边框样式承担，无公开变量）",
      "support": "none"
    },
    "verification": [
      "quoteBarCssContract：#app 定义 + 亮色覆盖 + 两侧同引（背景底不换色）",
      "浏览器 quoteBarPaint：明暗主题 × 双视图 computed 竖条颜色一致且为紫"
    ],
    "introduced": "#143（2026-09-27）"
  },
  {
    "id": "var-table-background",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-table-background",
    "purpose": "live 表头格 / 阅读表头（th）/ fm 标题栏底色（#213 起数据行透明，行背景改走 --vsidian-table-row-background）；默认 rgba(128, 128, 128, 0.05)。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（#132 起集中定义；此前消费处内联 fallback）；Obsidian 别名 --table-background。",
    "example": ":root { --table-background: rgba(128, 128, 128, 0.1); }",
    "obsidian": {
      "counterpart": "--table-background",
      "support": "direct"
    },
    "aliasTargets": [
      "--table-background"
    ],
    "verification": [
      "obsidianAliasCssContract：变量桥形态"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "var-table-row-background",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-table-row-background",
    "purpose": "live 表格数据行与分隔行背景；默认 transparent（透明到编辑器背景，向阅读侧 td 对齐）。表头格底色不受本变量影响（仍走 --vsidian-table-background）。",
    "views": [
      "live"
    ],
    "dom": "定义于 #app；消费于 .vsidian-table-line 行级规则（表头/分隔/数据行通用，表头行的格级背景覆盖其上）。片段在 #app 层或其后代元素声明即可覆盖——:root/body 声明会被 #app 层定义截断继承。",
    "example": "#app {\n  --vsidian-table-row-background: rgba(128, 128, 128, 0.05);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 数据行底色由 --table-background 全表默认与 --table-row-alt-background 斑马纹差分承担，无单一数据行变量；--table-background 已桥接给 --vsidian-table-background）",
      "support": "none"
    },
    "verification": [
      "tablePaintCssContract：行级规则接线 + #app 定义唯一 + 表头格/阅读 th 保持共享变量"
    ],
    "introduced": "#213（2026-09-29）"
  },
  {
    "id": "var-heading-accent",
    "domain": "content",
    "category": "content-variables",
    "kind": "variable",
    "target": "--vsidian-heading-accent（已移除）",
    "purpose": "曾为 live 视口内标题左缘强调色；随 #55 移除左缘竖线一并移除，不再公开。保留本条目作为弃用/移除生命周期的历史记录。",
    "views": [],
    "dom": "无（变量不再被定义或消费）。",
    "example": "/* 无替代写法：标题行强调请使用 .vsidian-heading-active 或层级色变量族 */",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "单元：CSS 源不再含该变量定义（迁移历史断言）"
    ],
    "introduced": "#5（2026-09-23）",
    "removed": "v0.2.x 周期内随 #55（2026-09-25）移除；移除时该变量仅随内部测试片段使用，无用户迁移负担"
  },
  {
    "id": "limit-hashtag",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": ".cm-hashtag / .tag",
    "purpose": "标签（#tag）语法未实现：出现在片段中不命中（不报错也不生效）。",
    "views": [],
    "dom": "无标签节点。",
    "example": "",
    "obsidian": {
      "counterpart": ".cm-hashtag（live）/ .tag（阅读）",
      "support": "none"
    },
    "verification": [
      "清单即边界：未实现即不承诺"
    ],
    "introduced": "#11（2026-09-24，随双链节如实记录）"
  },
  {
    "id": "limit-callout",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": ".callout 及其 data 属性",
    "purpose": "Callout 语法未实现，后续版本提供。",
    "views": [],
    "dom": "无 callout 结构。",
    "example": "",
    "obsidian": {
      "counterpart": ".callout",
      "support": "none"
    },
    "verification": [
      "清单即边界"
    ],
    "introduced": "#6（2026-09-23）"
  },
  {
    "id": "limit-task-extended-states",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": ".task-list-item[data-task=\"x\"] 等",
    "purpose": "任务扩展勾选状态不支持：仅空格 / x / X 三态。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "任务 checkbox 仅 :checked 与 .vsidian-task-checked 双入口。",
    "example": "",
    "obsidian": {
      "counterpart": ".task-list-item[data-task]",
      "support": "none"
    },
    "verification": [
      "单元 taskToggle：三态解析契约"
    ],
    "introduced": "#9（2026-09-24）"
  },
  {
    "id": "limit-markdown-embed",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": ".markdown-embed / 嵌入结构",
    "purpose": "嵌入（![[…]]）的部分边界（#222 起独占正文一行的嵌入在 Reading 侧渲染为引用卡片、#223 起在 Live 侧挂载同款卡片并支持光标驱动源码显隐，见 reading-embed-card / live-embed-widget；#244/#245 起独占行在正文卡片与悬停浮层内递归展开；#246 起 Reading 侧混排（行内有其他内容）与列表/引用容器内的嵌入升级为流内卡片，见 reading-embed-mixed；#247 起 Live 侧混排与列表/引用/任务/懒续行容器内的嵌入同挂卡片、隐藏态只替换嵌入精确区间——前后文/列表标记/任务控件/引用前缀/缩进保留，见 live-embed-widget；#248 起表格格内（表头/数据格，含 \\| 别名等转义形态按格内语义解码——目标/inner 为解码语义、区间为原始源文）双模式同升级为格内卡片）：Live/Reading 链接文字域内保持源文/占位（块级卡片在行内链接域属非法呈现）；嵌入内容写入不支持。双链残缺形态按原文显示；blockquote 块已支持。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "无嵌入容器的场景：Live/Reading 链接文字域内按原文/占位呈现（.vsidian-embed-slot，文字形态）；代码（围栏/缩进/行内）与注释内的嵌入字面量不解析。",
    "example": "",
    "obsidian": {
      "counterpart": ".markdown-embed",
      "support": "none"
    },
    "verification": [
      "单元 embedSlots：混排/容器/表格/代码/注释区域识别与提升矩阵（#246/#248）",
      "单元 liveEmbed（#247/#248）：混排/容器/表格格挂卡与链接域/行内代码/注释排除矩阵",
      "单元 tableCellEmbed（#248）：格内解码视图与源码区间映射、别名/锚点/URL 编码保真",
      "单元 wikilinkInteraction：合法嵌入升级为流内卡片与降级形态并存",
      "单元 wikilinkEmbed：扫描器、独占行判定与位置精确命中对拍"
    ],
    "introduced": "#11（2026-09-24）"
  },
  {
    "id": "limit-strikethrough-live",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": ".cm-strikethrough（live 侧）",
    "purpose": "删除线 live 侧未装饰：解析器支持但 live 视图无装饰类，源码形态呈现；阅读侧 del 标签可用（见 inline-strikethrough）。",
    "views": [
      "live"
    ],
    "dom": "live 无删除线 span。",
    "example": "",
    "obsidian": {
      "counterpart": ".cm-strikethrough（live token）/ 阅读侧 del 已支持",
      "support": "none"
    },
    "verification": [
      "单元 liveDecorations：无 Strikethrough 装饰（现状契约）"
    ],
    "introduced": "#8（2026-09-24，如实记录）"
  },
  {
    "id": "limit-quote-span",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": ".cm-quote（span 级）",
    "purpose": "引用内容不额外 span 化：live 侧仅行级 .HyperMD-quote 别名；Obsidian 的 span 级 .cm-quote token 类不承诺。",
    "views": [
      "live"
    ],
    "dom": "引用行内无内容 span。",
    "example": "",
    "obsidian": {
      "counterpart": ".cm-quote（span 级 token）",
      "support": "none"
    },
    "verification": [
      "单元 liveDecorations：引用仅行级装饰"
    ],
    "introduced": "#8（2026-09-24）"
  },
  {
    "id": "limit-is-unresolved",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": "双链 is-unresolved 区分（按目标存在与否变色）",
    "purpose": "不做：显示时不查询工作区，避免为样式引入索引/查找。双链一律同色呈现。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "无 unresolved 修饰类。",
    "example": "",
    "obsidian": {
      "counterpart": ".is-unresolved",
      "support": "none"
    },
    "verification": [
      "清单即边界"
    ],
    "introduced": "#11（2026-09-24）"
  },
  {
    "id": "limit-reference-links-live",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": "引用式链接/图片（[t][ref]）live 侧",
    "purpose": "引用式链接/图片：阅读视图由 markdown-it 完整解析（可点击）；live 视图不解析引用定义、按源码呈现（Ctrl+单击不跳转）——跨视图行为差异。",
    "views": [
      "live"
    ],
    "dom": "live 无引用式链接装饰。",
    "example": "",
    "obsidian": {
      "counterpart": "Obsidian 两视图均解析",
      "support": "none"
    },
    "verification": [
      "单元 liveLinks：引用式链接不装饰契约"
    ],
    "introduced": "#10（2026-09-24）"
  },
  {
    "id": "limit-table-crossview",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": "行内代码内 | 的表格拆分跨视图差异",
    "purpose": "markdown-it 不识别行内代码内的 |：含该形态的表格在阅读视图错切或降级为段落；live 侧按 GFM 规范正确拆分（偏差记录于 docs/perf/2026-09-table-cell-editing.md「已知限制」）。",
    "views": [
      "reading"
    ],
    "dom": "阅读表格按 markdown-it 拆分。",
    "example": "",
    "obsidian": {
      "counterpart": "Obsidian 两侧一致",
      "support": "none"
    },
    "verification": [
      "单元 tableCells vs readingTable：拆分语义差异既有记录"
    ],
    "introduced": "#12（2026-09-24）"
  },
  {
    "id": "limit-virtualization",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": "阅读视图虚拟化（全文 DOM 非常驻）",
    "purpose": "阅读视口外块不存在于 DOM：依赖「全文 DOM 常驻」的片段（全局 :nth-child 定位、跨屏兄弟/后代选择器、假设完整内容高度的滚动条计算）与按需挂载冲突。滚动回视口的块重新挂载并继承文档级样式。",
    "views": [
      "reading"
    ],
    "dom": "视口外由 spacer 占位（见 reading-spacer）。",
    "example": "",
    "obsidian": {
      "counterpart": "Obsidian 虚拟化由内部机制承担",
      "support": "none"
    },
    "verification": [
      "集成「阅读视图按需挂载」（#7）：窗口有界断言；#132 别名桥用例含视口重挂载探针复验"
    ],
    "introduced": "#7（2026-09-24）"
  },
  {
    "id": "limit-find-hit-mask",
    "domain": "content",
    "category": "content-limits",
    "kind": "limitation",
    "target": "查找高亮与隐藏标记区的交叉形态",
    "purpose": "当前匹配的 replace 装饰优先于查找高亮：命中区间落在被折叠的隐藏标记（如链接语法标记）内时查找高亮不可见；匹配计数与步进不受影响（按全文文本模型计算）。",
    "views": [
      "live"
    ],
    "dom": "查找高亮装饰层与语法装饰层叠加。",
    "example": "",
    "obsidian": {
      "counterpart": "—",
      "support": "none"
    },
    "verification": [
      "单元 findSession：匹配计数契约"
    ],
    "introduced": "#14（2026-09-24）"
  },
  {
    "id": "live-math",
    "domain": "chrome",
    "category": "math",
    "kind": "selector",
    "target": ".vsidian-math",
    "purpose": "公式渲染态稳定容器：live 为行内 widget 外层、阅读为 KaTeX 外层 span/p（内含 KaTeX .katex 结构）；颜色继承编辑器前景。Obsidian 拆分 .cm-math-begin/end 定界符类，本项目整体替换、无拆分类。",
    "views": [
      "live",
      "reading"
    ],
    "states": "live 侧光标进入公式范围显源码（见 live-math-source）。",
    "dom": "live：行内替换 widget；阅读：行内 span 或块级 p.katex-block（KaTeX HTML 由 KaTeX 产出）。",
    "example": ".vsidian-math .katex {\n  color: inherit;\n}",
    "obsidian": {
      "counterpart": ".cm-math（Obsidian live 数学 token）",
      "support": "semantic"
    },
    "verification": [
      "集成「live 公式渲染与绘制层」（#59）：paint.math.visible + cssProbe.liveMathFontFamily",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-math-live\"/\"reading-math-block\"] 探针命中（KaTeX 在稳定容器内）"
    ],
    "introduced": "#59（2026-09-25）"
  },
  {
    "id": "live-math-block",
    "domain": "chrome",
    "category": "math",
    "kind": "selector",
    "target": ".vsidian-math-block",
    "purpose": "块级公式（$$…$$ / \\begin{align} 等）渲染态变体：独立成块、居中、横向滚动。live widget 与阅读 p.katex-block 双侧同发射（与 .vsidian-math 并挂）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "live：块级替换 widget；阅读：p.katex-block（vsidian-math 与本类并挂）。",
    "example": ".vsidian-math-block {\n  margin: 8px 0;\n}",
    "obsidian": {
      "counterpart": ".HyperMD-math（块级数学行）方向",
      "support": "semantic"
    },
    "verification": [
      "mathPaintCssContract：display:block + text-align:center + overflow-x:auto",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-math-block-live\"] 探针命中"
    ],
    "introduced": "#59（2026-09-25）"
  },
  {
    "id": "live-math-source",
    "domain": "chrome",
    "category": "math",
    "kind": "selector",
    "target": ".vsidian-math-source",
    "purpose": "光标进入公式范围后的源码显形 mark（等宽着色 + 浅底）。",
    "views": [
      "live"
    ],
    "states": "光标进入公式范围时。",
    "dom": "live mark 装饰。",
    "example": ".vsidian-math-source {\n  color: var(--vscode-textPreformat-foreground);\n}",
    "obsidian": {
      "counterpart": ".cm-hmd-math-begin 编辑态方向",
      "support": "semantic"
    },
    "verification": [
      "mathPaintCssContract：--vscode-textPreformat-foreground 着色",
      "单元 liveMath：mathSource mark 发射契约"
    ],
    "introduced": "#59（2026-09-25）"
  },
  {
    "id": "reading-math-block",
    "domain": "chrome",
    "category": "math",
    "kind": "selector",
    "target": ".vsidian-reading-math（块类）+ .katex-block 内层 display 容器",
    "purpose": "阅读公式块（markdown-it-katex 渲染，挂载即渲染、卸载即释放，高度由 ResizeObserver 回填）；块内公式容器为 p.katex-block（vsidian-math/-math-block 并挂其上）。",
    "views": [
      "reading"
    ],
    "dom": "阅读块级容器内 <p class=\"katex-block\"> 包 .katex-display。",
    "example": ".katex-block {\n  text-align: center;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view .math-block",
      "support": "semantic"
    },
    "verification": [
      "cssProbe.readingMathFontFamily：KaTeX 字体族",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"reading-math-block\"] 探针命中（katex-block 在阅读块内）"
    ],
    "introduced": "#59（2026-09-25）"
  },
  {
    "id": "math-error",
    "domain": "chrome",
    "category": "math",
    "kind": "selector",
    "target": ".vsidian-math-error",
    "purpose": "公式解析失败的原文降级 span：错误色 + 浅红底 + 等宽字体，原文完整可读（两视图共用；title 属性带原文便于悬停核对）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "live：替换 widget span；阅读：span（行内）/ p.katex-block>code（块级）。",
    "example": ".vsidian-math-error {\n  color: var(--vscode-errorForeground);\n}",
    "obsidian": {
      "counterpart": ".math-error / .katex-error 方向",
      "support": "semantic"
    },
    "verification": [
      "mathPaintCssContract：错误色变量",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"math-error-live\"/\"math-error-reading\"] 探针命中"
    ],
    "introduced": "#59（2026-09-25）"
  },
  {
    "id": "mermaid-container",
    "domain": "chrome",
    "category": "diagram",
    "kind": "selector",
    "target": ".vsidian-mermaid",
    "purpose": "mermaid 围栏渲染容器（live widget 内层与阅读 fence 容器共用；携带 data-vsidian-mermaid-code 源码与 data-vsidian-mermaid-state 状态 loading/rendered/error）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "live：vsidian-graphic-frame widget 内层；阅读：vsidian-reading-mermaid 块内。渲染容器内含 mermaid SVG（rendered 态）。",
    "example": ".vsidian-mermaid {\n  background: rgba(0, 0, 0, 0.2);\n}",
    "obsidian": {
      "counterpart": ".mermaid（Obsidian 阅读渲染的图表容器）",
      "support": "semantic"
    },
    "verification": [
      "集成「live/阅读 Mermaid 渲染」（#60）：paint.mermaid.visible + 分态计数；mermaidPaintCssContract",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"mermaid-container-live\"/\"mermaid-container-reading\"] 探针命中（rendered 态门控）"
    ],
    "introduced": "#60（2026-09-25）"
  },
  {
    "id": "mermaid-svg",
    "domain": "chrome",
    "category": "diagram",
    "kind": "selector",
    "target": ".vsidian-mermaid svg",
    "purpose": "mermaid 自产 SVG（宽度受容器约束、高度等比）。SVG 内部节点为第三方渲染器私有 DOM，不承诺稳定（见 limit-mermaid-internals）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "渲染容器内 SVG。",
    "example": ".vsidian-mermaid svg {\n  max-width: 100%;\n}",
    "obsidian": {
      "counterpart": ".mermaid svg",
      "support": "semantic"
    },
    "verification": [
      "浏览器 mermaidPaint：真实渲染（CSP 复刻页）；mermaidPaintCssContract：max-width",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"mermaid-svg-live\"] 探针命中"
    ],
    "introduced": "#60（2026-09-25）"
  },
  {
    "id": "reading-mermaid-block",
    "domain": "chrome",
    "category": "diagram",
    "kind": "selector",
    "target": ".vsidian-reading-mermaid",
    "purpose": "阅读 mermaid 围栏整块成块的块元素类（豁免 60 行大围栏切片；挂载即渲染、卸载随块释放）；块内才是 .vsidian-mermaid 渲染容器。",
    "views": [
      "reading"
    ],
    "dom": "阅读块级容器。",
    "example": ".vsidian-reading-mermaid {\n  margin: 8px 0;\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view .mermaid 方向",
      "support": "semantic"
    },
    "verification": [
      "集成「阅读模式 Mermaid 渲染」（#60）",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"reading-mermaid-block\"] 探针命中"
    ],
    "introduced": "#60（2026-09-25）"
  },
  {
    "id": "mermaid-error",
    "domain": "chrome",
    "category": "diagram",
    "kind": "selector",
    "target": ".vsidian-mermaid-error（含 -message / -source）",
    "purpose": "mermaid 语法/渲染失败降级态：错误信息 + 源码可读，光标进入围栏仍可编辑（两视图共用）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "错误容器内 message/source 两区。",
    "example": ".vsidian-mermaid-error-message {\n  color: var(--vscode-errorForeground);\n}",
    "obsidian": {
      "counterpart": ".mermaid error 方向",
      "support": "semantic"
    },
    "verification": [
      "mermaidPaintCssContract：错误色与左对齐",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"mermaid-error\"] 探针命中"
    ],
    "introduced": "#60（2026-09-25）"
  },
  {
    "id": "graphic-chrome",
    "domain": "chrome",
    "category": "graphic-interact",
    "kind": "selector",
    "target": ".vsidian-graphic-frame / .vsidian-graphic-chrome（含 -edit / -popup）",
    "purpose": "图形化代码块（渲染成图形的围栏）定位包裹层与右上角按钮组：edit 进源码编辑（仅实时预览）、popup 打开图表弹窗；按钮组悬停显隐由 CSS 驱动（透明度切换，DOM 常驻渲染成功态）。#212 起 Markdown 图片复用同款按钮组与交互契约（edit+popup 双钮 / 阅读仅 popup；图片本体吞点击防误触），链接内嵌与表格网格内图片不挂（规格明确排除）。按钮底色为「主题面纯色渐变层 + 编辑器底实垫」双层合成（常态 editorWidget-background、悬停 button-secondaryBackground）：主题变量可能半透明（玻璃风主题），按钮直浮图片等斑驳内容时半透明面透出内容色，垫实底后任何主题不透底；主题值为实色时渐变层全覆盖、观感与单层等同。",
    "views": [
      "live",
      "reading"
    ],
    "states": "渲染成功态显示按钮组（error 降级块不发射）；edit 按钮仅实时预览侧装配。图片形态：loaded 态显示（data-vsidian-img-state 兄弟/子代选择器驱动），frame.vsidian-image 取行内布局（不破坏行内混排）。",
    "dom": "live：围栏 widget 外层 frame；阅读：mermaid/图形容器外层 frame。图片形态：live 槽位 span 兼任 frame（vsidian-image 叠加）；阅读 img 经 inline frame span 包裹。按钮组挂 frame 内 absolute 右上。",
    "example": ".vsidian-graphic-chrome {\n  opacity: 1;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 图表块无公开按钮组结构）",
      "support": "none"
    },
    "verification": [
      "集成「图形化代码块按钮组与图表弹窗」（#111）：paint.graphic.frames/editButtons/popupButtons",
      "浏览器 graphicPopup：悬停显隐（透明度两态）",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"graphic-chrome\"] 探针命中",
      "单元/浏览器 imagePopup（#212）：图片按钮组构成、悬停显隐与排除项；悬停按钮底色垫实底（computed backgroundColor 不透明 + 渐变面在场）"
    ],
    "introduced": "#111（2026-09-26）"
  },
  {
    "id": "diagram-popup",
    "domain": "chrome",
    "category": "graphic-interact",
    "kind": "selector",
    "target": ".vsidian-diagram-overlay / -backdrop / -stage / -media / -toolbar / -zoom-in / -zoom-out / -zoom-label / -reset / -refresh / -export-svg / -export-png / -export-image / -close / -error / -note",
    "purpose": "图表弹窗全屏浮层（#111）：遮罩 + 舞台（缩放/平移的图本体）+ 工具条（缩放/重置/刷新/导出/关闭）；error 态保留 close 与 refresh；note 为环境不支持 PNG 光栅化时的提示条。挂 document.body，仅在弹窗打开期间在场。#212 起图片弹窗（查看/缩放/平移/刷新/另存原图副本）复用同一类名族与浮层骨架：内容为 <img>（transform 缩放），-export-image 为图片侧导出钮（外链图禁用 + 外层 span 悬停提示），与图表弹窗互斥单例。",
    "views": [
      "live",
      "reading"
    ],
    "states": "popup 按钮打开期间在场；Esc/点空白区/关闭按钮撤下。",
    "dom": "body 直接子元素 overlay（backdrop/stage/toolbar 三区）。",
    "example": ".vsidian-diagram-toolbar {\n  gap: 4px;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 图表在新标签页打开）",
      "support": "none"
    },
    "verification": [
      "集成「图表弹窗」（#111/#133）：cssProbe.chromePopup 打开期间样式观测 + 刷新后保持",
      "浏览器 graphicPopup：原生键鼠路径（缩放/平移/Esc/导出）与样式保持",
      "单元/浏览器 imagePopup（#212）：图片弹窗开关/缩放/刷新/导出与互斥"
    ],
    "introduced": "#111（2026-09-26）"
  },
  {
    "id": "outline-item",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-item（+ .vsidian-outline-level-{1..6}）",
    "purpose": "大纲条目（级别类兼作缩进与层级色入口）；条目钉常规字重 400，不继承标题级别加粗；层级色与正文标题同引 --vsidian-heading-color-{1..6}（三侧同源，见 var-heading-color）。",
    "views": [],
    "dom": "右侧栏大纲面板条目容器。",
    "example": ".vsidian-outline-level-1 {\n  color: var(--vsidian-heading-color-1);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 大纲为应用级 DOM）",
      "support": "none"
    },
    "verification": [
      "outlineCssContract：层级色三侧同引；单元 outline 系列",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-item\"] 探针命中"
    ],
    "introduced": "#54（2026-09-25）；#65 起样式透传"
  },
  {
    "id": "outline-inline-marks",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-strong / -emphasis / -code / -strike / -highlight",
    "purpose": "大纲行内标记透传（语义元素 strong/em/code/del/mark 上的第二类名入口）：字重/斜体/等宽/删除线/高亮底只由显式标记触发；双链/链接为纯文本（无 a，不可点）。",
    "views": [],
    "dom": "大纲条目内语义行内元素。",
    "example": ".vsidian-outline-highlight {\n  background: var(--vsidian-highlight-background);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 侧大纲插件私有 DOM）",
      "support": "none"
    },
    "verification": [
      "单元 outline：SPAN_KIND_BY_NODE 提取白名单契约",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-inline-marks\"] 探针命中"
    ],
    "introduced": "#65（2026-09-25）；#105 高亮接入"
  },
  {
    "id": "outline-guide",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-guide",
    "purpose": "层级对齐引导线（条目内绝对定位竖线，left 对齐祖先 chevron 中心——嵌套层级的视觉对齐辅助）。",
    "views": [],
    "dom": "嵌套层级条目内绝对定位 span。",
    "example": ".vsidian-outline-guide {\n  background: var(--vscode-editorIndentGuide-background);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "outlineCssContract：引导线规则",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-guide\"] 探针命中"
    ],
    "introduced": "#99（2026-09-26）"
  },
  {
    "id": "outline-located",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-located",
    "purpose": "当前控制域条目的常驻高亮横条（半透明背景；类切换是两态差异唯一来源）；施加在可见代表上（目标被折叠遮蔽时为第一个可见祖先）。",
    "views": [],
    "states": "跟随光标位置。",
    "dom": "大纲条目容器。",
    "example": ".vsidian-outline-located {\n  background: rgba(128, 128, 128, 0.15);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineHover/outlineJump 系列；集成 outline.locatedPainted 绘制证据"
    ],
    "introduced": "#66（2026-09-25）"
  },
  {
    "id": "outline-slider",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-slider（+ ::before）",
    "purpose": "折叠滑块行（显隐唯一开关是侧栏容器的 outline-active 类；::before 画贯穿横线；role=group 六按钮组键盘可达）。",
    "views": [],
    "dom": "侧栏顶栏与条目列表之间。",
    "example": ".vsidian-outline-slider::before {\n  background: #888;\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineCollapse；集成 outline.sliderPainted 绘制证据",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-slider\"] 探针命中"
    ],
    "introduced": "#67（2026-09-25）"
  },
  {
    "id": "outline-slider-dot",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-slider-dot（+ .vsidian-outline-slider-active / -filled）",
    "purpose": "六档折叠圆点：空闲珠空心（透明面 + 描边圆环）、当前珠实心——两态差异唯一来源是 active 类规则；#99 起当前档沿途珠（filled）同态实心；实心色跟随 --vscode-button-background。",
    "views": [],
    "dom": "滑块行内按钮。",
    "example": ".vsidian-outline-slider-active {\n  background: var(--vscode-button-background);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineCollapse；集成 outline.sliderActiveDotPainted",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-slider-dot\"] 探针命中"
    ],
    "introduced": "#67（2026-09-25）；#99 filled 沿途珠"
  },
  {
    "id": "outline-chevron",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-chevron / .vsidian-outline-chevron-spacer",
    "purpose": "折叠箭头按钮（有子项条目）/ 无子项条目的同宽占位（文字左缘对齐）；线宽不写在 SVG 属性上；点箭头折叠/展开、点文字仍跳转。",
    "views": [],
    "dom": "条目内按钮/占位元素。",
    "example": ".vsidian-outline-chevron {\n  color: var(--vscode-foreground);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineCollapse；集成 outline.chevronPainted",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-chevron\"] 探针命中"
    ],
    "introduced": "#67（2026-09-25）"
  },
  {
    "id": "outline-collapsed",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-collapsed",
    "purpose": "折叠中的父节点条目（箭头旋转 -90° 朝右是两态差异唯一来源）。",
    "views": [],
    "states": "折叠态。",
    "dom": "条目容器。",
    "example": ".vsidian-outline-collapsed .vsidian-outline-chevron {\n  transform: rotate(-90deg);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineCollapse：两态往返",
      "单元 outlineCollapse 状态机"
    ],
    "introduced": "#67（2026-09-25）"
  },
  {
    "id": "outline-hidden",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-hidden",
    "purpose": "折叠遮蔽的条目（display:none，类切换是唯一显隐开关；DOM 保留维持索引序）；#68 起搜索过滤隐藏同用此类。",
    "views": [],
    "states": "折叠遮蔽或搜索过滤。",
    "dom": "条目容器。",
    "example": ".vsidian-outline-hidden {\n  display: none;\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "单元 outlineCollapse / outlineSearch",
      "集成 outline.visibleIndices 可见集断言"
    ],
    "introduced": "#67（2026-09-25）"
  },
  {
    "id": "outline-toolbar",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-toolbar",
    "purpose": "大纲工具条行（跳转到末尾、重置、搜索框；显隐唯一开关是 outline-active 类）。",
    "views": [],
    "dom": "侧栏顶栏与滑块行之间。",
    "example": ".vsidian-outline-toolbar {\n  gap: 4px;\n}",
    "obsidian": {
      "counterpart": "无（Quiet Outline 的 function-bar 为插件私有 DOM）",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineSearch；集成 outline.toolbarPainted",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-toolbar\"] 探针命中"
    ],
    "introduced": "#68（2026-09-25）"
  },
  {
    "id": "outline-toolbar-buttons",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-jump-bottom / .vsidian-outline-reset",
    "purpose": "工具条图标按钮（跳转到笔记末尾 / 重置三合一），与侧栏顶栏按钮同形态（基础形态由 .vsidian-outline-toolbar button 结构选择器承担，本类名为行为锚点与片段入口）。",
    "views": [],
    "dom": "工具条内按钮。",
    "example": ".vsidian-outline-reset:hover {\n  background: rgba(128, 128, 128, 0.2);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineSearch",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-toolbar-buttons\"] 探针命中"
    ],
    "introduced": "#68（2026-09-25）"
  },
  {
    "id": "outline-search",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-search（+ ::placeholder）",
    "purpose": "标题搜索输入框（flex 占余宽；配色走 --vscode-input-* 变量族）。",
    "views": [],
    "dom": "工具条内输入框。",
    "example": ".vsidian-outline-search:focus {\n  border-color: var(--vscode-focusBorder);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineSearch",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"outline-search\"] 探针命中"
    ],
    "introduced": "#68（2026-09-25）"
  },
  {
    "id": "outline-search-hit",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": "mark.vsidian-outline-search-hit",
    "purpose": "搜索命中片段高亮（只包命中子串；背景跟随 --vscode-editor-findMatchHighlightBackground，与正文查找命中同族视觉语言）；文本层切分，与语义元素正交。",
    "views": [],
    "states": "命中条目上。",
    "dom": "条目内 mark 元素。",
    "example": ".vsidian-outline-search-hit {\n  background: var(--vscode-editor-findMatchHighlightBackground);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "单元 outlineSearch：片段切分契约",
      "集成 outline.searchHitPainted 绘制证据"
    ],
    "introduced": "#68（2026-09-25）"
  },
  {
    "id": "outline-nomatch",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-nomatch",
    "purpose": "无匹配占位（有词条零命中的可读反馈）。",
    "views": [],
    "states": "搜索零命中。",
    "dom": "条目列表尾。",
    "example": ".vsidian-outline-nomatch {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineSearch",
      "集成 outline.nomatchPainted 绘制证据"
    ],
    "introduced": "#68（2026-09-25）"
  },
  {
    "id": "outline-menu",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-menu（+ -item / -host / -submenu / -danger / -cue）",
    "purpose": "右键菜单浮层（挂侧栏内 absolute；菜单项为 button 键盘可达；子菜单显隐唯一开关是父项宿主的 :hover/:focus-within；danger 红字标删除；颜色跟随 --vscode-menu-* 变量族）。#183 迁移到统一菜单内核装配（描述符化，类名不变）；公用态类 vsidian-menu-open（父项点击展开兜底）与 vsidian-menu-flip（子菜单装配期左翻——大纲面板右置时不再溢出屏幕）叠加在既有子菜单类上。",
    "views": [],
    "states": "右键唤出。",
    "dom": "侧栏内浮层。",
    "example": ".vsidian-outline-menu-danger {\n  color: var(--vscode-errorForeground);\n}",
    "obsidian": {
      "counterpart": "无（VSCode 原生上下文菜单为宿主级）",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineMenu（含右置子菜单翻转矩阵：装配期全翻左 + 展开后右缘不溢出视口）",
      "集成 outline.test.contextMenu/menuClick 系列"
    ],
    "introduced": "#69（2026-09-25）"
  },
  {
    "id": "outline-rename-input",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-rename-input",
    "purpose": "重命名行内编辑态输入框（条目内容区被 input 替换，编辑原文含行内标记）；VSCode 输入框三变量（前景/背景/边框）。",
    "views": [],
    "states": "重命名态。",
    "dom": "条目内 input。",
    "example": ".vsidian-outline-rename-input {\n  background: var(--vscode-input-background);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineMenu：重命名路径"
    ],
    "introduced": "#69（2026-09-25）"
  },
  {
    "id": "outline-dragging",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-dragging",
    "purpose": "拖动中的源条目（整体半透明弱化，类切换是两态差异唯一来源）。",
    "views": [],
    "states": "拖动中。",
    "dom": "条目容器。",
    "example": ".vsidian-outline-dragging {\n  opacity: 0.5;\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineDrag 系列"
    ],
    "introduced": "#70（2026-09-25）"
  },
  {
    "id": "outline-drop-edge",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-drop-before / -after",
    "purpose": "拖拽目标上/下缘插入线（inset box-shadow 不占布局、不与 located 背景冲突；颜色跟随 --vscode-focusBorder）。",
    "views": [],
    "states": "拖拽悬停时。",
    "dom": "目标条目容器。",
    "example": ".vsidian-outline-drop-before {\n  box-shadow: inset 0 2px 0 var(--vscode-focusBorder);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineDragBoundary"
    ],
    "introduced": "#70（2026-09-25）"
  },
  {
    "id": "outline-drop-inside",
    "domain": "chrome",
    "category": "outline",
    "kind": "selector",
    "target": ".vsidian-outline-drop-inside",
    "purpose": "拖拽目标包裹高亮（outline 内缩一圈 + 半透明背景，与 located 同变量族——「放入成为子标题」的视觉区分）。",
    "views": [],
    "states": "拖拽悬停中部时。",
    "dom": "目标条目容器。",
    "example": ".vsidian-outline-drop-inside {\n  outline: 1px solid var(--vscode-focusBorder);\n}",
    "obsidian": {
      "counterpart": "无",
      "support": "none"
    },
    "verification": [
      "浏览器 outlineDrag"
    ],
    "introduced": "#70（2026-09-25）"
  },
  {
    "id": "live-code-card-line",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-line（卡片行）；.vsidian-code-selection（Live 代码字符选区）",
    "purpose": "卡片覆盖的行级类：live 为源行级（含被清空的围栏行与全部代码行，承载卡片底色），阅读为卡内行 span；与正文域 live-code-line 并行。Live 非空代码选区另挂 .vsidian-code-selection 字符装饰：drawSelection 开启时在文字层补绘聚焦/失焦选区色，避免不透明卡片底色遮住选区；多光标关闭时沿用原生选区。",
    "views": [
      "live",
      "reading"
    ],
    "states": "卡片行常驻；.vsidian-code-selection 仅在 Live 非空选区与围栏代码相交时出现（支持多选区），文字层补绘由 .cm-editor:has(.cm-selectionLayer) 门控。",
    "dom": "live：.cm-line 行元素（卡片开启的围栏范围），其代码选区内为 span.vsidian-code-selection；阅读：code 内 span.vsidian-reading-code-line。",
    "example": ".vsidian-code-card-line {\n  background: var(--vsidian-code-card-background);\n}",
    "obsidian": {
      "counterpart": ".HyperMD-codeblock（行族；正文域别名挂于 .vsidian-code-line，卡片行类为自有扩展）",
      "support": "semantic"
    },
    "verification": [
      "codeCardPaintCssContract：底色变量",
      "浏览器 multicursor：不透明代码底色下截图像素必须为选区色",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-code-card-live\"/\"live-code-card-reading\"] 探针命中"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "live-code-card-edge",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-edge-top / -bottom",
    "purpose": "卡片首/末行圆角修饰（无头部覆盖的底边圆角；顶边圆角由头部横带承担）。仅 live 侧发射；阅读卡片圆角由 .vsidian-reading-code-card 承担。",
    "views": [
      "live"
    ],
    "dom": "卡片首/末行元素。",
    "example": ".vsidian-code-card-edge-bottom {\n  border-radius: 0 0 8px 8px;\n}",
    "obsidian": {
      "counterpart": "无对应（圆角由 Obsidian 原生 code 块样式承担）",
      "support": "native"
    },
    "verification": [
      "codeCardPaintCssContract"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "live-code-card-header",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-header（live block widget / 阅读头部容器共用）",
    "purpose": "卡片头部横带：语言标签 + 右侧按钮区，底部 1px 分隔线（观感参照 Code Styler 插件方向，本项目自有结构）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "卡片首行上方横带（live block widget / 阅读块首子元素）。",
    "example": ".vsidian-code-card-header {\n  border-bottom: 1px solid rgba(128, 128, 128, 0.3);\n}",
    "obsidian": {
      "counterpart": ".code-styler-header-container（Code Styler 插件方向）",
      "support": "native"
    },
    "verification": [
      "codeCardPaintCssContract",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-code-card-header-live\"] 探针命中"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "live-code-card-header-parts",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-header-label / -actions / -icon",
    "purpose": "卡片语言标签（首字母大写显示名）/ 按钮容器 / 语言徽标（#83 彩色字形徽标，挂标签内）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "头部横带内。",
    "example": ".vsidian-code-card-header-label {\n  font-weight: 600;\n}",
    "obsidian": {
      "counterpart": ".code-styler-header-title 方向",
      "support": "native"
    },
    "verification": [
      "codeCardPaintCssContract",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-code-card-header-parts-live\"] 探针命中"
    ],
    "introduced": "#79（2026-09-26）；#83 徽标"
  },
  {
    "id": "live-code-card-copy",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-copy（+ -done 修饰）",
    "purpose": "复制按钮（经宿主剪贴板 API）；-done 为点击后约 1.2s 的 ✓ 反馈态。",
    "views": [
      "live",
      "reading"
    ],
    "states": "复制后 -done 约 1.2s；收起态不发射按钮。",
    "dom": "头部按钮区。",
    "example": ".vsidian-code-card-copy-done {\n  color: #98c379;\n}",
    "obsidian": {
      "counterpart": "button.copy-code-button（Obsidian 原生复制按钮）",
      "support": "native"
    },
    "verification": [
      "集成代码卡片用例（codecard.test.copy 剪贴板链路）"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "live-code-card-fold",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-fold（+ -collapsed 修饰）",
    "purpose": "折叠 chevron；-collapsed 为收起态（转向）；折叠为视图态不写源文件（阅读侧收起另有块级 vsidian-code-card-folded 修饰，见 reading-code-card）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "折叠/展开。",
    "dom": "头部按钮区。",
    "example": ".vsidian-code-card-fold-collapsed {\n  transform: rotate(-90deg);\n}",
    "obsidian": {
      "counterpart": ".code-styler-header-container::after（折叠箭头方向）",
      "support": "native"
    },
    "verification": [
      "集成代码卡片用例（codecard.test.fold 折叠链路）"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "live-code-card-wrap",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-wrap（+ -off 修饰，仅阅读侧发射）",
    "purpose": "折行开关按钮（#191）：点击全文联动开/关阅读视图代码块自动折行——开启为现行 pre-wrap 折行，关闭为代码区横向滚动（行号列 sticky 钉左、头部固定）；-off 为已关闭修饰（经 filter: opacity(0.4) 弱化，与显隐 opacity 正交）。仅阅读卡片头部装配：Live 恒折行（CM6 折行是编辑器级 facet 无法按块关）。状态为视图态，不持久化、不设设置项（与折叠 chevron 同语义）。",
    "views": [
      "reading"
    ],
    "states": "折行开启（默认）/ 关闭（-off，title 提示开启）；与复制钮同口径进卡即显（默认隐藏、悬停卡片显现）；收起态不发射。",
    "dom": "头部按钮区最左（[折行] [复制] [折叠]）。",
    "example": ".vsidian-code-card-wrap-off {\n  filter: opacity(0.4);\n}",
    "obsidian": {
      "counterpart": "无对应（Obsidian 代码块无逐块折行开关）",
      "support": "none"
    },
    "verification": [
      "codeCardPaintCssContract：进卡即显显隐体系与 -off filter 弱化",
      "浏览器 codeCardChrome：折行/nowrap 几何、sticky 行号与联动断言",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-code-card-wrap-reading\"] 探针命中"
    ],
    "introduced": "#191（2026-09-28）"
  },
  {
    "id": "live-code-card-linenumber",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-code-card-linenumber",
    "purpose": "卡内行号（每块从 1，围栏行不占号；大围栏分块跨片连续）；live 为行首 widget、阅读为行 span（同类名）；与文档行号槽（源文件行号）两列并存互不遮挡。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "卡片代码行首（live widget / 阅读 span）。",
    "example": ".vsidian-code-card-linenumber {\n  color: var(--vscode-descriptionForeground);\n}",
    "obsidian": {
      "counterpart": ".code-styler-line-number（方向）",
      "support": "native"
    },
    "verification": [
      "lineNumberCssContract：两列并存",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"live-code-card-linenumber-live\"/\"live-code-card-linenumber-reading\"] 探针命中"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "tok-tokens",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": "tok-* token 族（tok-keyword / tok-string 等，@lezer/highlight classHighlighter 词表）",
    "purpose": "语法高亮 token span，两视图及已注册语言共用同一类名与明暗色板；解析器已有函数标签时在旧变量/属性类上叠加 tok-function（基础色取自 VS Code 主题导出与逐词检查，函数色为用户选择的暖黄，非语义 token 逐语言复刻，也非 Obsidian 主题变量）；Prism 原名 .token-* 不提供（见 limit-prism-tokens）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "代码内容内 token span（live mark 装饰 / 阅读卡片行内 span）。",
    "example": ".tok-keyword {\n  color: #af00db;\n}",
    "obsidian": {
      "counterpart": ".token-*（Prism 词表方向）/ .cm-* token 族",
      "support": "native"
    },
    "verification": [
      "codeHighlight 单元：词表契约（tok-* 两端共用）",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"tok-tokens-live\"/\"tok-tokens-reading\"] 探针命中"
    ],
    "introduced": "#83（2026-09-26）"
  },
  {
    "id": "reading-code-card",
    "domain": "chrome",
    "category": "code-card",
    "kind": "selector",
    "target": ".vsidian-reading-code-card（+ .vsidian-reading-code-line 行结构 / .vsidian-code-card-folded 收起态）",
    "purpose": "阅读视图卡片容器（vsidian-reading-code-block 的卡片化外壳）；language-x 类保留在 code 上供路由；行结构 span.vsidian-reading-code-line 携行号与 token；收起态块级修饰隐藏 pre（头部保留）。",
    "views": [
      "reading"
    ],
    "dom": "阅读代码块外壳（块卸载随 DOM 丢弃，重挂载从源码快照幂等重建）。",
    "example": ".vsidian-reading-code-card {\n  background: var(--vsidian-code-card-background);\n}",
    "obsidian": {
      "counterpart": ".markdown-preview-view pre（原有映射保留于正文域）",
      "support": "semantic"
    },
    "verification": [
      "readingCodeCard 单元（幂等增强与形态矩阵）",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"reading-code-card\"] 探针命中"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "var-code-card-background",
    "domain": "chrome",
    "category": "code-card",
    "kind": "variable",
    "target": "--vsidian-code-card-background",
    "purpose": "代码块卡片底色（头部横带与代码区共用；阅读卡片同源）；默认 var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12))。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app。",
    "example": ":root { --vsidian-code-card-background: rgba(0, 0, 0, 0.25); }",
    "obsidian": {
      "counterpart": "--code-background（语义对应；正文代码块变量的别名桥只承诺给 var-reading-code-background）",
      "support": "semantic"
    },
    "verification": [
      "codeCardPaintCssContract",
      "集成「界面域样式契约」（#133）：真实片段经该变量驱动卡片可见底色"
    ],
    "introduced": "#79（2026-09-26）"
  },
  {
    "id": "live-fm-card-line",
    "domain": "chrome",
    "category": "frontmatter",
    "kind": "selector",
    "target": ".vsidian-fm-card-line（+ -edge-top / -edge-bottom 首尾围栏行修饰 / -folded 收起态首行修饰）",
    "purpose": "frontmatter 只读表格卡片的行级类：合法简单头区（标量 + 字符串数组）成型时覆盖头区全部行（含首尾围栏行与杂项行），承载左右边线（行区透明，撞色边界感由边框与标题栏微亮条承担），首尾围栏行补横线并做圆角修饰，拼装为完整边框圆角卡片。折叠收起时键值/项/杂项行连同闭合行整块隐藏，首行改携 -folded 修饰兼任卡片底边（补底边框与四角圆角）。卡片行同时承载 vsidian-frontmatter-line（别名桥 direct 级承诺 .cm-hmd-frontmatter 在成型形态下保持命中，降透明副作用由卡片规则重置）。复杂类型/解析失败时整卡降级为 frontmatter-line 源码形态（见 limit-fm-complex-types）。",
    "views": [
      "live"
    ],
    "states": "常驻卡片（光标位置无关——成型态不暴露源码，光标进入头区被引导至闭合行后）；格不可点击编辑，编辑收敛到标题栏「修改」按钮的 Popover；折叠为视图态（零写回、不跨会话持久化，重开文档全展开——与代码卡折叠同语义）。",
    "dom": "live 视图 .cm-line 行元素（头区行）。",
    "example": ".vsidian-fm-card-line {\n  background: var(--vsidian-table-background);\n}",
    "obsidian": {
      "counterpart": ".metadata-container（Obsidian 属性面板方向，本项目自有表格卡片形态）",
      "support": "none"
    },
    "verification": [
      "frontmatterTable 纯函数单元（成型/降级矩阵）",
      "集成「界面域样式契约」：chromeSelectors[\"live-fm-card-line-live\"] 探针命中"
    ],
    "introduced": "#140（2026-09-27）"
  },
  {
    "id": "live-fm-row",
    "domain": "chrome",
    "category": "frontmatter",
    "kind": "selector",
    "target": ".vsidian-fm-row（+ .vsidian-fm-item-row 数组项行修饰 / .vsidian-fm-list-row 数组宿主行修饰；grid-template-columns: minmax(120px, 32%) 1fr 两列）",
    "purpose": "只读表格卡片的键值行（两列网格：键列/值列）：无格线无行间分隔（行区透明——撞色边界感由卡片边框与标题栏微亮条承担）；行级 grid 撑满内容区（**不限宽**，限宽会使行级边框与头部行错位形成右侧空洞）；数组宿主行带 list-row 修饰（键名类型图标取列表形 ≡），数组项行带 item-row 修饰（键列为 `- ` 标记淡化占位）。阅读侧同款表格行同名（.vsidian-fm-table 容器内，整宽透明同口径）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "live：.cm-line 行元素（网格行）；阅读：.vsidian-fm-table 内 div。",
    "example": ".vsidian-fm-row {\n  grid-template-columns: minmax(120px, 32%) 1fr;\n}",
    "obsidian": {
      "counterpart": ".metadata-property（Obsidian 属性行方向，DOM 结构不同）",
      "support": "none"
    },
    "verification": [
      "集成「界面域样式契约」：chromeSelectors[\"live-fm-row-live\"/\"live-fm-row-reading\"] 探针命中"
    ],
    "introduced": "#140（2026-09-27）"
  },
  {
    "id": "live-fm-cell",
    "domain": "chrome",
    "category": "frontmatter",
    "kind": "selector",
    "target": ".vsidian-fm-cell（+ .vsidian-fm-key 键列 / .vsidian-fm-value 值列 / .vsidian-fm-item-mark 数组项标记 / .vsidian-fm-sep 冒号 / .vsidian-fm-comment 行内注释 / .vsidian-fm-comment-line 独立注释行）",
    "purpose": "单元格 mark：键与值（含数组项文本）映射为源区间的格，只读着色（格不可点击编辑）；键列常规字重 + 弱化灰（opacity 0.7，参考图 key 浅 value 深）+ 行首类型图标（::before：标量 T、数组宿主行列表形 ≡）；sep（冒号与结构空格）与 comment（行内注释）在绘制层隐藏（display:none 不占格位）；item-mark 淡化占键列；独立注释行整行淡化纳入卡片。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "live：格 mark span（源区间）；阅读：span（item-mark/sep/comment 为 live 专属隐藏类）。",
    "example": ".vsidian-fm-key {\n  opacity: 0.7;\n}",
    "obsidian": {
      "counterpart": ".metadata-property-key / -value（方向）",
      "support": "none"
    },
    "verification": [
      "集成「界面域样式契约」：chromeSelectors[\"live-fm-cell-live\"/\"live-fm-cell-reading\"] 探针命中"
    ],
    "introduced": "#140（2026-09-27）"
  },
  {
    "id": "live-fm-header",
    "domain": "chrome",
    "category": "frontmatter",
    "kind": "selector",
    "target": ".vsidian-fm-header（标题栏容器；内含 .vsidian-fm-header-icon 图标 / .vsidian-fm-header-title 标题 / button.vsidian-fm-edit「修改」按钮 / button.vsidian-fm-fold 折叠 chevron）",
    "purpose": "卡片标题栏（首围栏行 replace widget）：微亮底色条（与透明行区形成撞色边界感）+ 列表图标 + Properties 标题（600 字重次级前景灰）+ 右上角圆角描边「修改」按钮（铅笔图标，hover/聚焦高亮）+ 最右折叠 chevron（与代码卡同交互：整条标题栏为折叠热区，排除按钮本身）。行内前后 cm-widgetBuffer 隐藏（inline replace 的光标停靠点各占一行文字高，成型态光标不进头区无消费者）使头部行高收敛到约 1.2 倍正文行高。修改按钮点击开关属性编辑 Popover；折叠收起时打开中的 Popover 自动关闭。阅读侧同容器内同类名同布局（只读，修改按钮不发射；折叠 chevron 与热区经挂载装饰在场）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "标题栏常驻两视图；修改按钮仅 live 且收起态不发射（编辑入口随表格让位，与代码卡收起态不发射复制钮同口径）；折叠 chevron 两态常驻（收起态转向 -90°）。",
    "dom": "live：首围栏行 replace widget 内容；阅读：.vsidian-fm-table 首子元素。",
    "example": "#app .vsidian-fm-header {\n  display: flex;\n}",
    "obsidian": {
      "counterpart": ".metadata-container heading（方向）",
      "support": "none"
    },
    "verification": [
      "集成「界面域样式契约」：chromeSelectors[\"live-fm-header-live\"] 探针命中",
      "浏览器 frontmatterTable 套件（修改按钮开浮层、绘制层可见）"
    ],
    "introduced": "#140（2026-09-27 Popover 改版）"
  },
  {
    "id": "live-fm-popover",
    "domain": "chrome",
    "category": "frontmatter",
    "kind": "selector",
    "target": ".vsidian-fm-popover（浮层容器；内含 .vsidian-fm-pop-rows 行区 / .vsidian-fm-pop-input 输入框（-key/-value/-item 修饰、-invalid 非法标记）/ .vsidian-fm-pop-remove 删除 / .vsidian-fm-pop-add-item 加项 / .vsidian-fm-pop-footer 底区 / .vsidian-fm-pop-add「添加属性」主按钮）",
    "purpose": "属性编辑 Popover：贴「修改」按钮定位的小浮层（挂 body、fixed 定位由 JS 计算），白底圆角 10px + 明显投影；结构化编辑行（键值输入框 + 删除按钮、数组项输入行缩进、加项入口），底部右侧「添加属性」主按钮（主题主色实底）。输入框聚焦 focusBorder 描边、键名非法红边标记。",
    "views": [
      "live"
    ],
    "states": "交互态浮层（打开时挂载、Esc/点击外部/降级自动关闭）——容器本体不进静态探针，开闭与写回由浏览器套件行为验证；样式入口（单类低特异性）公开供片段覆写。",
    "dom": "document.body 直挂（不在 #app 内，故规则无 #app 前缀）。",
    "example": ".vsidian-fm-popover {\n  border-radius: 10px;\n}",
    "obsidian": {
      "counterpart": ".metadata-property-editor（Obsidian 属性编辑浮层方向）",
      "support": "none"
    },
    "verification": [
      "frontmatterPaintCssContract 单元（fixed/圆角/投影/主按钮钉规则）",
      "浏览器 frontmatterTable 套件（真实键鼠开闭、输入即时写回、焦点管理）"
    ],
    "introduced": "#140（2026-09-27 Popover 改版）"
  },
  {
    "id": "live-fm-fold",
    "domain": "chrome",
    "category": "frontmatter",
    "kind": "selector",
    "target": ".vsidian-fm-fold（+ -collapsed 收起态修饰；live 收起另有首行级 vsidian-fm-card-folded、阅读收起另有表格级 vsidian-fm-folded 修饰）",
    "purpose": "折叠 chevron（与代码卡折叠同交互：右上折叠钮 + 标题栏整条热区）：点击收起/展开键值行区——live 侧整块隐藏（标题栏行兼任卡片底边）、阅读侧表格行区整体隐藏（表壳边框圆角保留）。折叠为视图态不写源文件、不跨会话持久化（重开文档全展开）；live 与阅读各持折叠态不互通（与代码卡同口径）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "折叠/展开（chevron 转向）；收起态 live 不发射修改按钮、阅读行 display:none。",
    "dom": "标题栏按钮区最右（修改按钮右侧）。",
    "example": ".vsidian-fm-fold-collapsed svg { transform: rotate(-90deg); }",
    "obsidian": {
      "counterpart": ".metadata-container 标题栏折叠方向（Obsidian 属性面板可收起）",
      "support": "none"
    },
    "verification": [
      "单元 frontmatterInteraction / readingFrontmatterFold：折叠交互契约",
      "浏览器 frontmatterTable 套件（真实鼠标折叠/展开/热区/浮层联动）",
      "集成 frontmatter 卡片折叠用例（paint.fm 绘制层探针）"
    ],
    "introduced": "2026-10（折叠批次）"
  },
  {
    "id": "limit-fm-complex-types",
    "domain": "chrome",
    "category": "chrome-limits",
    "kind": "limitation",
    "target": "复杂 YAML 类型（嵌套对象 / 对象数组 / 多行标量 |·> / 锚点别名 / 顶层序列 / 重复键 / 非法语法）",
    "purpose": "不支持边界：一期表格只覆盖标量（字符串/数字/布尔/日期字符串）与字符串数组（block `- item` 行组 + flow `[a, b]` 单行；live 侧 block 项与 flow 值框在 Popover 内编辑，阅读侧拆项呈现）；复杂类型与解析失败整卡降级源码形态（live 为 .vsidian-frontmatter-line 行类、阅读为 .vsidian-reading-frontmatter-text 转义块），编辑不受限，转简单形态自动成型；降级瞬间打开中的 Popover 自动关闭。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "降级行/块（frontmatter 边界内）。",
    "example": "",
    "obsidian": {
      "counterpart": "Obsidian 属性面板对复杂类型显示为源码/受限编辑",
      "support": "none"
    },
    "verification": [
      "frontmatterTable 纯函数单元（降级矩阵）"
    ],
    "introduced": "#140（2026-09-27）"
  },
  {
    "id": "limit-prism-tokens",
    "domain": "chrome",
    "category": "chrome-limits",
    "kind": "limitation",
    "target": ".token-*（Prism 原名）/ .HyperMD-codeblock-*",
    "purpose": "语法高亮以 tok-* 稳定词表提供（见 tok-tokens）；Prism 原名与 .HyperMD-codeblock-* 子类不提供，片段按原名定位不命中。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "token span 使用 tok-* 类名。",
    "example": "",
    "obsidian": {
      "counterpart": ".token-* / .HyperMD-codeblock-*",
      "support": "none"
    },
    "verification": [
      "codeHighlight 单元：词表契约"
    ],
    "introduced": "#83（2026-09-26）"
  },
  {
    "id": "limit-katex-internals",
    "domain": "chrome",
    "category": "chrome-limits",
    "kind": "limitation",
    "target": ".katex 内部结构（.mord / .mspace / .katex-mathml 等）",
    "purpose": "内部渲染结构不兼容边界：KaTeX 产出的内部 DOM（字形 span、MathML 层等）随上游版本变化，不承诺为稳定接口——仅稳定容器外壳（.vsidian-math / .vsidian-math-block / .katex-block）公开；片段依赖内部类的着色可能在升级后失效。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "KaTeX HTML 在稳定容器内。",
    "example": "",
    "obsidian": {
      "counterpart": "Obsidian 同样不承诺 KaTeX 内部结构",
      "support": "none"
    },
    "verification": [
      "清单即边界：第三方渲染器私有 DOM 不提升为稳定接口"
    ],
    "introduced": "#133（2026-09-27，随界面域核实落档）"
  },
  {
    "id": "limit-mermaid-internals",
    "domain": "chrome",
    "category": "chrome-limits",
    "kind": "limitation",
    "target": "mermaid SVG 内部节点（.node / .edgePath / .cluster 等）",
    "purpose": "内部渲染结构不兼容边界：Mermaid 自产 SVG 的内部节点类随上游版本与主题变化，不承诺为稳定接口——仅容器级入口（.vsidian-mermaid 与其 svg 后代）公开；弹窗内 SVG 同源同边界。需要改图内观感请走 mermaid 主题配置而非片段选择器。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "mermaid SVG 在稳定容器内。",
    "example": "",
    "obsidian": {
      "counterpart": "Obsidian 同样不承诺 mermaid 内部结构",
      "support": "none"
    },
    "verification": [
      "清单即边界：第三方渲染器私有 DOM 不提升为稳定接口"
    ],
    "introduced": "#133（2026-09-27，随界面域核实落档）"
  },
  {
    "id": "suspend-banner",
    "domain": "chrome",
    "category": "toolbar-banner",
    "kind": "selector",
    "target": ".vsidian-suspend-banner（内含 .vsidian-suspend-banner-text）",
    "purpose": "写回冲突暂停横幅（本项目自有 UI）：暂停态顶栏提示 + 恢复按钮。",
    "views": [
      "live",
      "reading"
    ],
    "states": "写回冲突暂停时。",
    "dom": "#app 顶部横幅。",
    "example": ".vsidian-suspend-banner {\n  background: var(--vscode-statusBar-background);\n}",
    "obsidian": {
      "counterpart": "无对应物",
      "support": "none"
    },
    "verification": [
      "editorChromeCssContract",
      "集成写回冲突用例：暂停横幅在场断言"
    ],
    "introduced": "#4（2026-09-23）"
  },
  {
    "id": "toolbar",
    "domain": "chrome",
    "category": "toolbar-banner",
    "kind": "selector",
    "target": ".vsidian-toolbar",
    "purpose": "主编辑区顶栏：设置齿轮（.vsidian-settings-toggle）、快速操作开关（.vsidian-quick-toggle）、刷新嵌入资源（.vsidian-refresh-toggle，#208 起第五按钮，独立条目）、双态视图切换（.vsidian-view-toggle，#141 起第四按钮，独立条目）、侧栏开关（.vsidian-sidebar-toggle）——#38 起三态切换（含源码）在宿主编辑器标题栏命令，不在顶栏（见 mode-toggle 移除记录）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "#app 顶部工具栏。",
    "example": ".vsidian-toolbar {\n  gap: 6px;\n}",
    "obsidian": {
      "counterpart": "无对应物",
      "support": "none"
    },
    "verification": [
      "editorChromeCssContract",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"toolbar\"] 探针命中"
    ],
    "introduced": "#4（2026-09-23）"
  },
  {
    "id": "view-toggle",
    "domain": "chrome",
    "category": "toolbar-banner",
    "kind": "selector",
    "target": ".vsidian-view-toggle（按钮本体；内含图标子类 .vsidian-view-toggle-book / .vsidian-view-toggle-edit）",
    "purpose": "双态视图切换按钮（#141）：live↔reading 互切入口之一（宿主标题栏三态命令与 Ctrl+Q 之外的 webview 内入口）。图标显当前态：书本（当前在阅读）/ 笔（当前在 Live）两图标常驻 DOM，显隐唯一来源是 body 模式类规则（见 mode-body 条目）——样式失效时两图标同显，可被绘制断言暴露。",
    "views": [
      "live",
      "reading"
    ],
    "states": "按钮本体常驻两模式；点击出站 view.switch.request（不本地执行），按钮态由宿主回流的 view.mode.set 驱动——aria/tooltip 表目标动作随态换词。",
    "dom": "顶栏 .vsidian-toolbar 内 button，紧邻侧栏开关左侧；#158 起与侧栏开关组成右端组，#208 起刷新按钮加入右端组并接管 margin-left:auto 推靠规则（本按钮不再持有，推右职责移交见 toolbar-refresh 条目）；与左侧组（设置、快速操作）间为弹性空隙；内联 SVG 两 path（book/edit 子类）。",
    "example": ".vsidian-view-toggle {\n  color: var(--vscode-toolbar-foreground);\n}",
    "obsidian": {
      "counterpart": "无对应物",
      "support": "none"
    },
    "verification": [
      "集成「界面域样式契约」（#133）：chromeSelectors[\"view-toggle\"] 探针命中（真宿主渲染验证）",
      "浏览器套件（#141）：两图标显隐随 body 模式类切换的绘制断言"
    ],
    "introduced": "#141（2026-09-27）"
  },
  {
    "id": "toolbar-refresh",
    "domain": "chrome",
    "category": "toolbar-banner",
    "kind": "selector",
    "target": ".vsidian-refresh-toggle（按钮本体；内含内联 SVG 循环箭头图标）",
    "purpose": "刷新嵌入资源按钮（#208）：手动刷新入口——点击出站 refresh.request，宿主清图片解析缓存并推进资源代次后回发失效通知，webview 对活跃图片槽位全量失效重挂（新代次 URI 重载）并重置 Mermaid 懒加载失败终态。刷新不触碰文档内容/撤销栈/视图状态（光标、滚动、模式原样保持），与快捷键入口共用同一发送实现。",
    "views": [
      "live",
      "reading"
    ],
    "states": "按钮常驻两模式；未就绪（init 前）点击无操作。#158 推右规则（margin-left:auto）于 #208 自 view-toggle 迁移至本按钮——右端组首（刷新 + 双态切换 + 侧栏开关紧挨），与左侧组间弹性空隙。",
    "dom": "顶栏 .vsidian-toolbar 内 button，紧邻双态切换左侧；内联 SVG 循环箭头（lucide refresh-cw 意象，四 path，线宽恒定 stroke-width=2，不引图标库）。",
    "example": ".vsidian-refresh-toggle {\n  color: var(--vscode-toolbar-foreground);\n}",
    "obsidian": {
      "counterpart": "无对应物",
      "support": "none"
    },
    "verification": [
      "集成「界面域样式契约」：chromeSelectors[\"toolbar-refresh\"] 探针命中（真宿主渲染验证）",
      "jsdom 控制器单测（#208）：按钮在场、点击出站 refresh.request",
      "浏览器套件（#208）：右端组几何绘制断言（中点右侧、与双态切换以工具栏 gap 紧邻）"
    ],
    "introduced": "#208（2026-09-29）"
  },
  {
    "id": "mode-body",
    "domain": "chrome",
    "category": "toolbar-banner",
    "kind": "selector",
    "target": "布局根模式类 .vsidian-body.vsidian-mode-live / .vsidian-body.vsidian-mode-reading（互斥，两态必居其一）",
    "purpose": "webview 全域模式锚点（#141）：随视图模式在布局根 div（#app 内的 .vsidian-body，非 HTML body 元素——类对不挂在 <body> 上）切换的互斥类对，是用户片段做「按模式生效」样式的公开入口（如 #app .vsidian-body.vsidian-mode-reading .vsidian-toolbar button { … }）。内置消费方：双态切换按钮的 book/edit 图标显隐规则以其为唯一来源。",
    "views": [
      "live",
      "reading"
    ],
    "states": "模式态类：live 视图挂 .vsidian-mode-live、reading 视图挂 .vsidian-mode-reading，applyModeDom 随每次模式切换重算。",
    "dom": "#app 内布局根 div（.vsidian-body，水平布局根）的 classList；不在 HTML body 元素或任何具体控件上。",
    "example": "#app .vsidian-body.vsidian-mode-reading .vsidian-view-toggle svg {\n  opacity: 0.9;\n}",
    "obsidian": {
      "counterpart": "无对应物（Obsidian 以 mod-cm6 等容器态类表达，不承诺原名命中）",
      "support": "none"
    },
    "verification": [
      "浏览器套件（#141）：模式切换后布局根类互斥、图标显隐据此驱动的绘制断言",
      "探针表豁免（模式态类，非静态可命中——chromeContract.test 豁免表登记）"
    ],
    "introduced": "#141（2026-09-27）"
  },
  {
    "id": "mode-toggle",
    "domain": "chrome",
    "category": "toolbar-banner",
    "kind": "selector",
    "target": ".vsidian-mode-toggle（已移除）",
    "purpose": "曾为顶栏模式切换按钮组。#38（提交 288044d，2026-09-24）起模式切换迁宿主编辑器标题栏三态命令，顶栏不再渲染该类；保留本条目作为旧映射表陈旧行的纠错记录——该类自 v0.1.0 起从未随发布版存在于 DOM（核对：git grep v0.4.0 -- src/ 零命中）。",
    "views": [],
    "dom": "无（类不再发射）。",
    "example": "/* 无替代选择器：模式切换 UI 属宿主标题栏，不在 webview DOM 内 */",
    "obsidian": {
      "counterpart": "无对应物",
      "support": "none"
    },
    "verification": [
      "单元：webview 源码不再含该类发射（迁移历史断言）"
    ],
    "introduced": "#4（2026-09-23）",
    "removed": "#38（2026-09-24，288044d）移除且从未随任何发布版存在；旧映射表该行为陈旧数据（#133 核实纠错，依据 v0.4.0 tag 75c3df7 源码核对）"
  },
  {
    "id": "context-menu",
    "domain": "chrome",
    "category": "context-menu",
    "kind": "selector",
    "target": ".vsidian-context-menu（+ -group / -separator / -host / -item / -icon / -badge / -check / -label / -hint / -submenu / -cue / -danger）",
    "purpose": "统一右键菜单浮层（#183 Live 正文全域接管）：挂 body 的 fixed 定位自绘菜单。三簇分组线（-separator）、级联子菜单（-submenu；:hover/:focus-within 显隐 + 父项点击兜底 vsidian-menu-open 类 + 右缘放不下装配期左翻 vsidian-menu-flip 类）、图标位（-icon 以 data-icon 驱动 mask；#184 起 26 枚接线 key 经 --vsidian-context-icon 定义明暗两套资产，备用 key 资产在场不接线）、文字徽标（-badge，H1–H6）、勾选态（-check，段落设置按行结构点亮）、置灰（disabled）、danger 红字、快捷键提示列（-hint 右对齐小字低不透明度，未绑定不占位）。菜单项为 button 键盘可达；颜色跟随 --vscode-menu-* 变量族（与大纲菜单同族视觉语言）。前身 blockMenu（#162 的 .vsidian-block-menu*）退役并入——该类名从未随任何发布版存在（v0.5.0 tag 零命中），无兼容义务，清单不留条目。",
    "views": [
      "live"
    ],
    "states": "Live 正文右键（空行/普通文本/表格行/围栏内/图形块上均接管；frontmatter 头区与阅读态不接管，原生菜单照常）。结构敏感区（表格/围栏/图形块）写操作置灰（安全降级矩阵）。",
    "dom": "document.body 直接子元素（视口系 fixed 定位）；子菜单嵌父项宿主内（absolute）。",
    "example": ".vsidian-context-menu .vsidian-context-menu-hint {\n  font-size: 11px;\n  opacity: 0.65;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 右键菜单为应用原生菜单，非 DOM 内元素）",
      "support": "none"
    },
    "verification": [
      "单元 contextMenuDom/contextMenuPanel：菜单装配、分组线、降级矩阵与命令交互",
      "浏览器 contextMenu：真实右键、子菜单展开与翻转、提示列绘制",
      "集成 contextMenu.test.* 注入通道 + 绘制层断言"
    ],
    "introduced": "#183（2026-09-28）"
  },
  {
    "id": "backlink-panel",
    "domain": "chrome",
    "category": "backlinks",
    "kind": "selector",
    "target": ".vsidian-backlink-panel（+ .vsidian-backlink-item / -item-source / -item-snippet / -item 上 -source 类；形态改版批次追加 -group / -group-header / -group-name / -group-count / -chevron / -group-collapsed 折叠态、-card / -card-text 上下文卡片——卡片与 #197 既有 .vsidian-backlink-item 并挂，-item-source / -item-snippet 子类随旧两行形态退役）",
    "purpose": "反链面板（#197；形态改版批次重做呈现）：按来源文件分组展示当前笔记的反向链接——组头（chevron + 来源名 + 组内计数，可折叠）+ 组内白色上下文卡片（卡片正文为引用行文本，命中链接的原始 Markdown 语法整体黄底高亮，见 backlink-hit 条目）；页头「链接当前文件」+ 卡片计数；四态占位（loading/empty/error/nomatch）与更新中细条共用容器。显隐唯一开关是侧栏容器的 vsidian-backlinks-active 类（与大纲/出链面板互斥）。",
    "views": [],
    "states": "面板 DOM 常驻侧栏（.vsidian-sidebar-panel 内），默认 display:none；侧栏展开 + 面板 active 时可见。条目为动态数据（宿主索引快照驱动），四态随最近 backlinks.snapshot 变化；组折叠由 group-collapsed 类表达（卡片区隐藏、组头保留）。",
    "dom": "右侧栏面板区域：vsidian-backlink-panel 容器 > 固定区（updating 细条（可选）+ 工具栏（见 backlink-toolbar 条目）+ 搜索框）+ 动态区（排序菜单（打开时）+ 页头 header（title + count）+ group 分组（group-header 按钮 + card 卡片按钮）或 placeholder 占位）。固定区节点跨渲染复用（搜索输入焦点不丢）。",
    "example": ".vsidian-backlink-panel .vsidian-backlink-card {\n  background: var(--vscode-editor-background, #ffffff);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 反链为应用级侧栏 DOM）",
      "support": "none"
    },
    "verification": [
      "单元 backlinkPanel / backlinkGrouping：四态渲染、分组排序过滤与类名锚点、命中高亮切分",
      "集成「反链面板」（#197）：backlinks.togglePainted/panelPainted/itemPainted/emptyPainted 绘制证据（形态改版批次扩展 toolbarPainted/hitPainted）",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"backlink-panel\"] 探针命中"
    ],
    "introduced": "#197（2026-09-29）"
  },
  {
    "id": "backlink-toolbar",
    "domain": "chrome",
    "category": "backlinks",
    "kind": "selector",
    "target": ".vsidian-backlink-toolbar（+ -toolbar-button×4（data-action=sort/search/collapse/context）、-sort-menu / -sort-item / -sort-sep 排序下拉、-search-box / -search-input 搜索框）",
    "purpose": "反链面板工具栏（形态改版批次）：四枚线性图标按钮横排居中——排序（六项三组下拉菜单，当前项勾选，Esc/外点关闭）、搜索（按钮下方全宽搜索框显隐切换）、折叠全部（二态，aria-pressed）、更多上下文（长/短片段切换，aria-pressed）。按钮开态以选中底色标记；排序菜单为面板内 absolute 定位浮层。",
    "views": [],
    "states": "ready + 有条目时可见（loading/error/空文档不渲染工具栏）；四按钮 aria-pressed/expanded 随视图态；搜索框显隐唯一开关是 hidden 属性；菜单打开时挂载（动态态，探针表不伪造静态断言）。",
    "dom": "vsidian-backlink-panel 固定区：role=toolbar 容器 + 四按钮（内联 16 系 SVG 图标）；搜索框紧随其后；菜单（打开时）挂动态区首位（面板容器为 absolute 锚）。",
    "example": ".vsidian-backlink-toolbar-button[aria-pressed='true'] {\n  background: var(--vscode-list-activeSelectionBackground);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 反链面板为应用级 DOM，无对应类名）",
      "support": "none"
    },
    "verification": [
      "单元 backlinkPanel：工具栏四按钮、搜索框显隐与排序菜单勾选态",
      "集成「反链面板」（形态改版批次）：toolbarPainted 绘制证据、搜索过滤与排序切换交互",
      "探针 chromeSelectors[\"backlink-toolbar\"] 命中"
    ],
    "introduced": "形态改版批次（2026-09-29）"
  },
  {
    "id": "backlink-hit",
    "domain": "chrome",
    "category": "backlinks",
    "kind": "variable",
    "target": "--vsidian-backlink-hit-bg（#app 层定义；mark.vsidian-backlink-hit 承接为背景）",
    "purpose": "反链卡片命中高亮（形态改版批次）：卡片内命中链接的原始 Markdown 语法整体（[...](...) 或 [[...]] 连同括号与 URL）的黄底标记——light 用 #ffec99 一档，dark/high-contrast 用可读黄系（约 30% 黄叠加，高亮内文字颜色不变、不加下划线）。公开变量可被外部片段覆盖。",
    "views": [],
    "states": "常驻定义于 #app；明暗两值随 body.vscode-dark / body.vscode-high-contrast 切换。",
    "dom": "#app 的自定义属性；消费方为反链卡片内 mark.vsidian-backlink-hit（动态数据驱动，探针表不为条目级伪造静态断言，颜色规则由契约测试钉住）。",
    "example": "body.vscode-dark #app {\n  --vsidian-backlink-hit-bg: rgba(255, 208, 0, 0.3);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 搜索命中高亮为应用内部样式）",
      "support": "none"
    },
    "verification": [
      "单元 backlinkPanel：命中区间切分（mark 类名锚点）",
      "集成「反链面板」（形态改版批次）：hitPainted 绘制证据 + 高亮 mark 的 computed 背景色断言（明暗主题可读性）"
    ],
    "introduced": "形态改版批次（2026-09-29）"
  },
  {
    "id": "backlinks-toggle",
    "domain": "chrome",
    "category": "backlinks",
    "kind": "selector",
    "target": ".vsidian-backlinks-toggle",
    "purpose": "侧栏顶栏的反链面板切换按钮（与大纲/出链按钮同排）：点击切换反链面板显隐（三面板互斥）；active 态按钮高亮跟随 --vscode-list-activeSelectionBackground。",
    "views": [],
    "states": "侧栏展开时可见；aria-expanded 随面板 active 同步。",
    "dom": "侧栏顶栏工具行（.vsidian-sidebar-toolbar-actions）内按钮 + 链环折返箭头 SVG 图标（形态改版批次：织结双链环 + 左折返箭头，24 系 viewBox；线宽由 CSS 钉住——见 cssProbe）。",
    "example": ".vsidian-sidebar.vsidian-backlinks-active .vsidian-sidebar-toolbar button.vsidian-backlinks-toggle {\n  background: var(--vscode-list-activeSelectionBackground);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 反链开关为应用级 UI）",
      "support": "none"
    },
    "verification": [
      "集成「反链面板」（#197）：backlinks.togglePainted 绘制证据与 toggleAriaLabel"
    ],
    "introduced": "#197（2026-09-29）"
  },
  {
    "id": "outlink-panel",
    "domain": "chrome",
    "category": "outlinks",
    "kind": "selector",
    "target": ".vsidian-outlink-panel（+ -header / -header-title / -header-count、-item / -item-name / -item-path、-broken 断链弱化、-updating、-placeholder）",
    "purpose": "出链面板（出链面板批次）：「当前笔记中的链接」平铺列表——页头（标题 + 右上浅灰计数）+ 两行条目（行 1 链形小图标 + 目标显示名；行 2 目标路径悬挂缩进）；点击打开目标并按链接实际锚点定位；断链条目整体弱化（broken 类 + disabled）不可点；外部 scheme 边不进面板。显隐唯一开关是侧栏容器的 vsidian-outlinks-active 类（与大纲/反链面板互斥）。",
    "views": [],
    "states": "面板 DOM 常驻侧栏，默认 display:none；侧栏展开 + 面板 active 时可见。条目为动态数据（宿主 outlinks.snapshot 驱动），四态与反链面板同构。",
    "dom": "右侧栏面板区域：vsidian-outlink-panel 容器 > updating 细条（可选）+ 页头 outlink-header（title + count）+ outlink-item 按钮条目（item-name（内含 16 系链环 SVG）+ item-path）或 placeholder 占位。",
    "example": ".vsidian-outlink-panel .vsidian-outlink-item-path {\n  margin-left: 20px;\n  font-size: calc(var(--vsidian-outline-font-size, 12px) * 0.85);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 出链面板为应用级侧栏 DOM）",
      "support": "none"
    },
    "verification": [
      "单元 outlinkPanel：四态渲染、条目两行结构与断链不可点属性",
      "集成「出链面板」（出链面板批次）：outlinks.panelPainted/itemPainted/emptyPainted 绘制证据",
      "探针 chromeSelectors[\"outlink-panel\"] 命中"
    ],
    "introduced": "出链面板批次（2026-09-29）"
  },
  {
    "id": "outlinks-toggle",
    "domain": "chrome",
    "category": "outlinks",
    "kind": "selector",
    "target": ".vsidian-outlinks-toggle",
    "purpose": "侧栏顶栏的出链面板切换按钮（与大纲/反链按钮同排）：点击切出链面板显隐（三面板互斥）；active 态高亮跟随 --vscode-list-activeSelectionBackground。",
    "views": [],
    "states": "侧栏展开时可见；aria-expanded 随面板 active 同步。",
    "dom": "侧栏顶栏工具行（.vsidian-sidebar-toolbar-actions）内按钮 + 链环出箭头 SVG 图标（织结双链环 + 右出箭头，24 系 viewBox；线宽由 CSS 钉住）。",
    "example": ".vsidian-sidebar.vsidian-outlinks-active .vsidian-sidebar-toolbar button.vsidian-outlinks-toggle {\n  background: var(--vscode-list-activeSelectionBackground);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 出链开关为应用级 UI）",
      "support": "none"
    },
    "verification": [
      "集成「出链面板」（出链面板批次）：outlinks.togglePainted 绘制证据与 toggleAriaLabel"
    ],
    "introduced": "出链面板批次（2026-09-29）"
  },
  {
    "id": "hover-popup",
    "domain": "chrome",
    "category": "hover-preview",
    "kind": "selector",
    "target": ".vsidian-hover-popup（浮层容器；内含 .vsidian-hover-popup-header 标题条（目标显示名 + .vsidian-hover-popup-title 与 .vsidian-hover-popup-dirty 未保存圆点（P2-06）+ .vsidian-hover-popup-actions 右侧动作组（P2-06：.vsidian-hover-popup-save 保存目标 / .vsidian-hover-popup-mode 内部模式切换 / .vsidian-hover-popup-close 关闭编辑，与 .vsidian-hover-popup-open 跳转入口同组——嵌入卡片同款，#217 验收跟进））、.vsidian-hover-popup-scroll 内容滚动区（承载只读 Reading 容器与 .vsidian-hover-popup-live 内部 Live 编辑器容器（P2-06，与 Reading 容器并列）；#337 起 PDF 形态并列 .vsidian-hover-pdf PDF 内容容器——见 hover-pdf-view 条目）与 .vsidian-hover-popup-state 就地状态行（loading/错误分态；错误分态追加 .vsidian-hover-popup-state-error 修饰——主题错误色，验收反馈与普通文字区分）；#342（P3-10）web 通道追加 .vsidian-hover-web-card 外链卡片容器（内含 .vsidian-hover-web-title 标题 / .vsidian-hover-web-desc 摘要 / .vsidian-hover-web-domain 域名安全链接——纯文字 + 唯一可点元素，挂 Reading 容器内））",
    "purpose": "悬停文档预览浮层（#218 一期首条闭环）：父文档 Reading 中悬停指向 Markdown 的双链/本地链接，经文档访问通道读取目标后以只读 Reading 内容显示。#221 全入口：Live 正文（默认 Ctrl+悬停，设置 hover.liveDirect 开启后直接悬停）与反链/出链面板条目（直接悬停）共用同一浮层。默认宽 480px / 最大高 400px（小视口由 JS 几何计划四边翻转并收缩钳制）；内容只读——任务 checkbox 禁用（JS disabled + pointer-events 双保险），无任何写回通道。#220 起浮层内为目标文档（B）的 Reading 内容：图片以 B 为来源解析（sourceDocUri 通道）、链接可点击跳转、代码块朴素高亮。#245 起 B 内独占行引用沿直接来源递归为禁写卡片，共用正文卡片的深度与预算；子卡片滚轮到底接续浮层，异步高度变化按自然高重新贴锚，整轮只有一个悬停窗口。#217 验收跟进：标题条与嵌入卡片同款——目标显示名（spec.target）常驻不随回包换，右上角跳转入口按目标形态分派到既有激活消息族（双链/普通链接直发、面板形态经 openAction 闭包走条目点击同通道），点击即上下文切换关闭。P2-06（#283）起浮窗根引用支持内部 Live：默认跟随根面板模式、可手动切换（按引用位置在面板会话内记忆）；标题条新增保存目标/模式切换/关闭编辑动作组与紧随显示名的未保存圆点（`·`，目标 B dirty 时在场、警示色——嵌入卡片 P2-04 同款语义），滚动区内并列内部 Live 编辑器容器（限高随几何计划，滚动由 CM6 自身 scroller 承担）；目标 dirty 的内部 Live 抵抗移出/外点/失焦等普通关闭条件（Q18），干净时沿用普通悬停关闭，显式关闭复用嵌入的 ref-close-dialog 三项确认。",
    "views": [
      "live",
      "reading"
    ],
    "states": "交互态浮层（悬停延迟打开期间挂载、离开联合域延迟关闭/Esc/父容器滚动/切模式撤下；#221 键盘命令打开时焦点进入浮层，:focus-visible 轮廓指示，焦点在内不因鼠标离开销毁；P2-06 起目标 dirty 的内部 Live 抵抗普通关闭条件——移出/外点/失焦不销毁，dirty 清零后恢复常规关闭）——容器本体不进静态探针，开闭、保活与绘制由浏览器 hoverPreview / hoverEntry / hoverLive 套件按行为路径验证；样式入口（单类低特异性）公开供片段覆写。P2-06 内部模式两态：内部 Reading（缺省内容视图，无写端口；圆点与保存/关闭入口不在场）/ 内部 Live（编辑器容器在场、隐藏内容视图；目标 dirty 时圆点与保存入口可见；编辑暂停态状态行就地提示）。",
    "dom": "#220 起直挂 #app 内（此前挂 body；fixed 定位不受 #app 布局影响）——#app 的主题变量与 `#app .vsidian-view-reading …` 正文样式、已启用 CSS 片段（容器类含 .markdown-preview-view 别名桥）随之天然命中，不为浮层复制第二套主题环境。内部 Reading 容器挂 .vsidian-view-reading。P2-06：动作组三按钮为真实 <button type=\"button\">（aria-label 与悬停词经 i18n 词条 embed.saveTarget / embed.modeToLive / embed.modeToReading / embed.closeEditor，悬停词走 data-tooltip；内联 SVG 图标 aria-hidden、16 网格 stroke currentColor），圆点为 <span>（aria-label embed.dirtyDot），与嵌入卡片头部同款规则并列（浮层选择器置首）。",
    "example": ".vsidian-hover-popup {\n  width: 480px;\n  max-height: 400px;\n}\n\n/* 标题条与跳转入口（嵌入卡片同款规则并列，浮层选择器置首） */\n#app > .vsidian-hover-popup .vsidian-hover-popup-header,\n#app .vsidian-embed-card .vsidian-embed-card-header {\n  display: flex;\n  justify-content: space-between;\n  padding: 4px 10px;\n}\n\n/* P2-06 头部未保存圆点（嵌入卡片 P2-04 同款并列） */\n#app > .vsidian-hover-popup .vsidian-hover-popup-dirty {\n  font-weight: 700;\n  color: var(--vscode-editorWarning-foreground, #cca700);\n}",
    "obsidian": {
      "counterpart": ".hover-popover（Obsidian 页面预览浮层方向；内部结构闭源不作承诺）",
      "support": "none"
    },
    "verification": [
      "单元 hoverPopupCssContract：fixed/宽 480/最大高 400/实底边框投影/滚动区/状态行/checkbox pointer-events 钉规则；#217 验收跟进加标题条与跳转按钮并列组（组文本含嵌入与浮层两侧选择器）；P2-06 加动作组按钮/圆点/live 容器规则",
      "单元 hoverPopup + hoverPopupGeometry：生命周期契约与四边翻转数学内核",
      "单元 hoverLive（P2-06）：浮窗根 Live 生命周期、保活语义与 chrome 在场性契约",
      "浏览器 hoverPreview（#218）：真实指针开闭/保活/滚动/Esc/边缘翻转 + 正文绘制层可见断言",
      "浏览器 hoverEntry 场景 P（#217 验收跟进）：标题条显示名常驻 + 跳转图标 + 双链/链接分派与点击关闭",
      "浏览器 hoverLive（P2-06）：真实指针/键盘驱动浮窗根 Live——编辑器绘制层可见、圆点绘制、dirty 保活与 Esc 分层",
      "单元 hoverPopupCssContract（#342）：外链卡片四规则（容器行距组织/标题加粗前景色/摘要描述色/域名链接色与 hover 下划线）",
      "浏览器 webLinkCard（#342）：真实指针驱动外链卡片——标题/摘要/域名实际文字内容断言、开关关闭零请求、失败分态与打开入口"
    ],
    "introduced": "#218（2026-09-30）"
  },
  {
    "id": "hover-pdf-view",
    "domain": "chrome",
    "category": "hover-preview",
    "kind": "selector",
    "target": ".vsidian-hover-pdf（悬停浮层内的 PDF 内容容器；.vsidian-hover-pdf-canvas 页面画布 / .vsidian-hover-pdf-page-info 页码信息行）",
    "purpose": "悬停 PDF 预览内容视图（#337 / P3-05 首条闭环）：悬停指向本地 PDF 的双链／普通链接时，浮层滚动区内并列的只读 PDF 渲染容器——PDF.js 在 webview 内按 canvas 绘制指定页（双链 #page=N 初始定位，无页码从第一页；普通链接 fragment 不解析）。只读呈现：无任何写回通道、不接管父输入；翻页操作（键位默认未绑定）只改变预览页不修改文档。容器与画布尺寸由渲染器按浮层内容宽适配（scale 上限 2.5），页码信息行提供「第 N / M 页」反馈。错误分态（损坏/加密/页码越界/资源失败）走浮层既有 .vsidian-hover-popup-state 状态行（含错误色修饰），本容器只承载成功绘制态。",
    "views": [
      "live",
      "reading"
    ],
    "states": "装载中（canvas 零尺寸占位，状态行 loading 文案）／绘制成功（canvas 实际尺寸随页面与适配 scale，页码信息行在场）／错误分态（canvas 清零，状态行错误文案）／失效撤下（目标 deleted/stale 时旧 canvas 一并撤下，不冒充在场内容）。交互态浮层的内部结构——不进静态探针，绘制层可见性由浏览器与集成测试按 canvas 实际像素断言（非 DOM 存在性）。",
    "dom": "挂 #app 内浮层（.vsidian-hover-popup）的滚动区（.vsidian-hover-popup-scroll）内，与 Reading 容器并列（PDF 形态下 Reading 容器隐藏）。canvas 为原生 <canvas> 元素（width/height 由渲染器按视口写）；页码信息行为 <div>，文案经 i18n 词条 hover.pdfPageInfo。",
    "example": "#app > .vsidian-hover-popup .vsidian-hover-pdf-canvas {\n  display: block;\n  max-width: 100%;\n}\n\n#app > .vsidian-hover-popup .vsidian-hover-pdf-page-info {\n  padding: 4px 10px;\n  text-align: center;\n  opacity: 0.85;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 页面预览浮层的 PDF 呈现闭源，不作承诺）",
      "support": "none"
    },
    "verification": [
      "单元 pdfRender：渲染器状态机（装载/绘制/错误分态/取消纪律——迟到结果不落地、失败装载也 destroy）",
      "单元 hoverPopupCssContract：PDF 容器/画布/页码行规则钉住",
      "浏览器 hoverPdf（#337）：真实 Chromium 内生产链路绘制——canvas 非白像素比例与指定页内容断言",
      "集成（#337）：1.82.3 真宿主悬停 PDF——view.state.hoverPreview.pdf 探针的 canvas 尺寸与页码断言"
    ],
    "introduced": "#337（2026-10-04）"
  },
  {
    "id": "hover-fm-section",
    "domain": "chrome",
    "category": "hover-preview",
    "kind": "selector",
    "target": ".vsidian-hover-fm（浮层内笔记属性区修饰，挂 frontmatter 块；.vsidian-hover-fm-toggle 展开/折叠按钮；.vsidian-hover-fm-collapsed 收起态修饰）",
    "purpose": "引用内容的笔记属性区（#220 悬停浮层首创，#222 起嵌入卡片同款共用——共享装配 refReadingContent，选择器并列 .vsidian-hover-popup / .vsidian-embed-card 前缀）：仅全文引用显示——默认折叠，标题整行是悬停热区（hover 或按钮 focus-visible 显示切换按钮，非悬停自动展开），点击按钮切换展开/收起；本次打开内保留展开状态（目标内容变化引发的重建不重置），浮层重新打开恢复折叠、嵌入卡片随实例状态（视口回收不清除）。成型 frontmatter 复用阅读侧标题栏与键值行（呈现与类型/降级边界沿用 frontmatterTable 判定，不扩大），降级形态合成同构标题栏并保留转义源码原文（收起时隐藏）。章节/块引用与无 frontmatter 文档不显示属性区；无任何添加/删除/编辑或任务勾选写回入口。主阅读视图自身的属性呈现不受影响。",
    "views": [
      "reading"
    ],
    "states": "收起（默认，vsidian-hover-fm-collapsed——属性行/降级源码块 display:none，标题行保留）/ 展开（移除修饰类）；按钮默认 opacity:0 + pointer-events:none（不用整体隐藏类声明——保留 Tab 键可达），标题行 :hover 或按钮 :focus-visible 时显示并接指针；chevron 展开向下、收起旋转 -90° 指向右。交互态浮层的内部结构——不进静态探针，折叠/热区/键盘操作与明暗主题下的可见性由浏览器 hoverPreview 套件按行为路径验证。",
    "dom": "挂 #app 内浮层（.vsidian-hover-popup）中的 frontmatter 块（.vsidian-reading-frontmatter）上；按钮为真实 <button type=\"button\">（Enter/Space 原生激活），aria-expanded 随态、aria-label/title 用 i18n 词条（hover.content.fmExpand/fmCollapse）。",
    "example": "#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row {\n  display: none;\n}",
    "obsidian": {
      "counterpart": ".metadata-container 与 .collapse-indicator（Obsidian 属性区折叠方向；内部结构闭源不作承诺）",
      "support": "none"
    },
    "verification": [
      "单元 hoverPopupCssContract：热区/按钮透明与指针/悬停与 focus-visible 显示/收起隐藏/chevron 旋转钉规则",
      "单元 hoverPopup：属性区状态机（默认折叠/切换/刷新保留/重开复位/范围门控/降级合成标题栏）",
      "浏览器 hoverPreview（#220）：真实指针折叠交互、键盘 Enter 操作、明暗主题下标题行与按钮可见性绘制层断言",
      "单元 embedCard（#222）：嵌入卡片属性区状态机与视口回收重挂的状态保持"
    ],
    "introduced": "#220（2026-09-30）"
  },
  {
    "id": "reading-embed-card",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-embed-card（卡片壳，挂 .markdown-embed 别名；.vsidian-embed-card-header 顶部栏 / -title 文件名 / -header-actions 右侧动作组 / -save 保存目标入口 / -mode 内部模式切换入口 / -open 打开入口 / -close 关闭编辑入口（P2-05，内部 Live 在场时可见）/ -dirty 未保存圆点（P2-04，`·` 字符）/ -live 内部 Live 编辑器容器 / -scroll 内容滚动区 / -state 状态行；错误分态追加 .vsidian-embed-card-state-error 修饰——主题错误色，与悬停浮层同口径）",
    "purpose": "正文嵌入卡片（#222 Reading 侧首创，#223 起 Live 侧同款挂载——两容器共用同一卡片装配与状态库）：独占正文一行的 ![[…]] 替换为引用卡片——观感与 Reading 正文对齐（#217 验收反馈：只保留左侧引用竖条，无底色、无整圈边框、无圆角，白底直角同正文引用块方向）、顶部文件名（成功后为目标根内相对路径）、右上角跳转目标文档入口（沿用 Vsidian 既有打开行为，不改写引用原文；内联 SVG 图形图标 stroke currentColor 随 --vscode-icon-foreground 着色——#217 验收反馈补齐，此前按钮为空壳不可见）。内容为目标的只读 Reading 视图（复用悬停文档访问通道装载全文/章节/块）；短内容自然高度，长内容内部滚动，限高默认 480px、经设置页 embed.maxHeight 调整（内联 max-height 优先于规则缺省）。卡片在 #app 正文流内——主题变量与 CSS 片段随嵌套天然命中，卡片壳的 Obsidian 别名（.markdown-embed）让嵌入容器规则同样命中。Live 侧的挂载形态与源码显隐见 live-embed-widget（Live 宿主内卡片壳 margin 清零、间距由宿主 padding 承担——高度记账语义）。P2-04（#281）起卡片支持内部 Live：顶部栏增加右侧动作组（保存目标/内部模式切换/打开入口，图标按钮同款规则）与紧随文件名的未保存圆点（`·`，目标 dirty 时在场、警示色），滚动区内并列 .vsidian-embed-card-live 编辑器容器（内部 Live 态在场，限高同内联 max-height、滚动由 CM6 自身 scroller 承担）；默认内部模式跟随直接父视图（未手动选择），Reading 态仍为只读内容视图（无写端口）。P2-05（#282）起头部增加关闭编辑入口（内部 Live 在场时可见）：显式退出统一走目标 B 最新状态检查——dirty 弹 ref-close-dialog 三项确认，干净直接切回 Reading。",
    "views": [
      "reading",
      "live"
    ],
    "states": "装载中（状态行文案，内容区隐藏）/ 装载成功（内容滚动区在场，任务 checkbox 禁用、属性区默认折叠）/ 失败分态（状态行就地 i18n 文案，不弹宿主通知）。视口回收（Reading）与装饰退场（Live）：卡片 DOM 与目标内容视图释放，属性展开与滚动位置保留（重挂恢复）；父文档会话内装载缓存零重发；Live↔Reading 模式切换共享同一实例状态（语义键 = 嵌入行行首 + 目标原文）。P2-04 内部模式：内部 Reading（缺省——内容视图，无写端口；圆点与保存入口不在场）/ 内部 Live（编辑器容器在场、隐藏内容视图；目标 dirty 时圆点与保存入口可见；编辑暂停态状态行就地提示）。P2-05（#282）：内部 Live 态关闭编辑入口在场（端口释放后隐藏）；显式关闭命中 dirty 目标时弹 ref-close-dialog 模态，干净目标直接切回 Reading。",
    "dom": "Reading：挂阅读视图的嵌入块（.vsidian-reading-embed，data-vsidian-embed-inner 携带目标原文）内。Live（#223）：挂 .vsidian-live-embed 宿主 widget（隐形态 inline 替换 / 显形态行下方 block widget）。卡片壳 .vsidian-embed-card 同时挂 .markdown-embed（别名桥 obsidianAlias 同源表）；内容区是嵌套的 .vsidian-view-reading 容器；打开入口为真实 <button type=\"button\">（aria-label 用 i18n 词条 embed.openTarget；内联 SVG 图标 aria-hidden，16 网格 stroke currentColor——#217 验收反馈补齐）。P2-04：保存/模式切换入口同款真实 <button>（aria-label 与悬停词经 i18n 词条 embed.saveTarget / embed.modeToLive / embed.modeToReading，悬停词走 data-tooltip）；圆点为 <span>（aria-label embed.dirtyDot）。P2-05：关闭编辑入口同款真实 <button>（i18n 词条 embed.closeEditor，X 形内联 SVG，悬停词 data-tooltip）。",
    "example": "#app .vsidian-view-reading .vsidian-reading-embed .vsidian-embed-card,\n#app .cm-editor .cm-content .vsidian-live-embed .vsidian-embed-card {\n  border-left: 3px solid var(--vsidian-quote-bar-color);\n}",
    "obsidian": {
      "counterpart": ".markdown-embed（Obsidian 阅读嵌入容器）",
      "support": "direct"
    },
    "aliasTargets": [
      "markdown-embed"
    ],
    "verification": [
      "单元 embedCardCssContract（#222/#223）：边条/限高/占位行/只读 checkbox 规则钉住（卡片壳规则含 Live 宿主并列选择器）",
      "单元 embedCard：挂载升级、装载、一层展开、状态保持、限高热更、探针（host 容器标记）与双容器并存渲染",
      "单元 embedLive（P2-04）：内部模式状态机（继承/覆盖记忆）、端口生命周期（bind/unbind/迟到推送丢弃）、圆点驱动与 bind 失败回退；浏览器 embedLive（P2-04）：真实 Chromium 键入/Ctrl+S 焦点路由/编辑器无泄漏",
      "单元 embedClose（P2-05）：关闭入口显隐随端口、三项模态触发/取消/确认；浏览器 embedLive 场景 I–N（P2-05）：真实 Esc/点击/拦截与绘制层断言",
      "别名桥一致性：test/unit/styleContract 与 test/unit/obsidianAlias（vsidian-embed-card ↔ markdown-embed）"
    ],
    "introduced": "#222（2026-09-30）"
  },
  {
    "id": "ref-close-dialog",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-ref-close-backdrop（全屏半透明遮罩，body 直接子级）/ .vsidian-ref-close-dialog（对话框壳，role=dialog aria-modal；-title 标题 / -message 说明行两枚（文件名 + 丢弃影响）/ -notice 就地提示行（stale 重新确认 / 保存失败 / 丢弃失败，警示左边条）/ -actions 按钮组（-cancel 取消（默认焦点）/ -save 保存并关闭 / -discard 丢弃修改并关闭））",
    "purpose": "P2-05（#282）引用编辑显式关闭确认模态：插件可控的退出意图（嵌入卡片头部关闭按钮 / 嵌入内 Esc / 删除活跃引用行拦截）统一检查目标 B 最新权威状态，dirty 时弹出的自绘三项对话框——「保存并关闭」（TextDocument.save，失败保留现场）/「丢弃修改并关闭」（P2-01 验证的激活 B + 无参 revert 文档级回滚，恢复整个 B 含其他视图的未保存修改）/「取消」（默认焦点，保留现场；删除意图不完成 A 中删除）。确认文字指明 B 文件名与文档级丢弃影响；对话框期间 B 版本变化触发重新确认（stale 提示行 + 新基线，宿主执行时按版本守卫双防线）。干净目标关闭与模式切换/离屏回收不弹本模态。自绘呈现（role=dialog + aria-modal + Esc 取消），不调用 window.alert；主题变量取 VSCode 公开变量族（遮罩 editorWidget-editableBackground / 盒子 editor-background + panel-border / 保存取消 button 族 / 丢弃 button-secondary 族 / 提示行 editorWarning 左边条），主题与 CSS 片段跟随宿主外观。后续浮窗（P2-06）关闭复用同一目标操作与本模态。",
    "views": [
      "live"
    ],
    "states": "不在场（缺省——无退出意图或目标干净）/ 在场-打开（三项按钮 + 文件名与丢弃影响说明，焦点默认在取消）/ 重新确认（确认期间目标被修改：-notice 提示行在场（警示左边条），确认基线刷新）/ 动作失败保留现场（save-failed / discard-failed：-notice 提示行在场，模态不关闭）。",
    "dom": "body 直接子级 .vsidian-ref-close-backdrop（fixed 全屏遮罩，z-index 高于悬停浮层与图片弹窗——模态阻断）内 .vsidian-ref-close-dialog；标题/说明为 div；三个动作为真实 <button type=\"button\">（文案经 i18n 词条 embed.closeCancel / embed.closeSave / embed.closeDiscard）；提示行为 div（文案 embed.closeStale / embed.closeSaveFailed / embed.closeDiscardFailed，display:none 缺省）。键盘语义：模态上 Esc = 取消；Enter 落在默认焦点（取消）。",
    "example": "body > .vsidian-ref-close-backdrop {\n  position: fixed;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: var(--vscode-editorWidget-editableBackground, rgba(0, 0, 0, 0.36));\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 走宿主原生保存确认弹窗；本项目自绘模态）",
      "support": "none"
    },
    "verification": [
      "单元 embedClose（P2-05）：模态呈现（三项文案/文件名/默认焦点取消）、取消与失败保留现场、stale 重新确认、干净目标不弹、suspended 不弹",
      "浏览器 embedLive 场景 I–N（P2-05）：真实 Esc/点击驱动；绘制层断言（遮罩 fixed + 非透明背景、盒子背景 + 边框、按钮可见、stale 提示左边条）",
      "集成 P2-05 用例（1.82.3 真宿主）：三项模态、保存失败（只读盘）保留现场、文档级丢弃与多 occurrence 去重、删除引用拦截"
    ],
    "introduced": "#282（2026-10-03）"
  },
  {
    "id": "embed-conflict-choices",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-embed-card-conflict（冲突三项选择条，嵌入卡片状态行 .vsidian-embed-card-state 内、P2-12 冲突暂停时在场；-compare 对比并解决 / -discard 放弃当前版本 / -cancel 取消 三按钮 / -reopen 取消收起后的重新选择入口 / -notice 对比打开失败的就地提示行）",
    "purpose": "P2-12（#289）写入冲突三项选择：引用内部 Live 因不可安全写回（外部交错修改覆盖请求区间等）暂停时，在暂停现场（状态行）就地呈现「对比并解决／放弃当前版本／取消」——compare 的 hover 文案为用户指定原文「在临时副本和冲突版本的对比视图中处理冲突」（data-tooltip 承载，逐字）。三项语义：compare 出站当前输入全文快照，宿主创建 untitled 临时副本并打开 VSCode 原生对比页（左=临时副本、右=真实 B，P2-01 §6 验证路线；对比页交互归宿主，扩展不自建解决界面），成功转交后经 sync.request 重同步解除暂停（旧未提交队列不重放）；discard 只放弃本次未成功提交的输入并重新同步 B（不回滚整个 B——与 P2-05 的文档级丢弃分开建模）；cancel 收起选择保持暂停与输入（-reopen 单按钮提供再展开入口）。非模态呈现（不阻断嵌入内容查看，不调用 window.alert）；失败（-notice，警示左边条）保留现场可重试。主题变量取 VSCode 公开变量族（compare 主操作 button 主色族 / 其余 button-secondary 族 / 在途禁用 opacity / focus-visible 描边 / 提示行 editorWarning 左边条），主题与 CSS 片段跟随宿主外观。",
    "views": [
      "live"
    ],
    "states": "不在场（缺省——非冲突暂停；正常编辑/装载/错误分态均无选择条）/ 展开（暂停提示文字 + 三项按钮；compare 在途禁用——opacity 降级）/ 收起（cancel 后：仅剩 -reopen 重新选择入口，暂停与输入保持）/ 失败保留现场（-notice 提示行在场 + 三项按钮保留，可重试）/ 暂停解除（doc.resync 到达：选择条整体移除，状态行交还 loading/错误分态管理）。",
    "dom": "嵌入卡片 .vsidian-embed-card 的状态行 .vsidian-embed-card-state 内：暂停提示为 <span>（文案经 i18n 词条 embed.livePaused，bindLocale 登记换语言刷新）；选择条为 div.vsidian-embed-card-conflict（flex wrap 容器）；按钮为真实 <button type=\"button\">（可见文字经 embed.conflictCompareLabel / embed.conflictDiscardLabel / embed.conflictCancelLabel / embed.conflictReopenLabel，悬停词 data-tooltip 经 embed.conflictCompareHint / embed.conflictDiscardHint / embed.conflictCancelHint / embed.conflictReopenHint——compare 悬停词为用户指定原文）；失败提示为 div.vsidian-embed-card-conflict-notice（文案 embed.conflictCompareFailed）。与选择条按钮 / 键位操作（conflictCompare/conflictDiscard/conflictCancel，P2-10 登记默认未绑定）/ 测试钩子同一处理器链路。",
    "example": ".vsidian-embed-card .vsidian-embed-card-state .vsidian-embed-card-conflict {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 6px;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 冲突处理闭源；本项目自绘就地选择条，对比页走宿主原生 diff）",
      "support": "none"
    },
    "verification": [
      "单元 embedConflictChoices（P2-12）：三项呈现与文案/hover 逐字、compare 出站全文快照与在途防重入、结果 ok 重同步（旧输入不重放）、失败保留现场可重试、cancel 收起与重新选择、键位路由与暂停外零操作",
      "单元 embedCardCssContract（P2-12）：选择条 flex wrap、compare 主按钮色与三项次按钮色、禁用态与 focus-visible、失败提示左边条规则钉住",
      "浏览器 embedLiveActions 场景 I（P2-12）：三项真实绘制（非零尺寸占位）、compare hover 逐字、真实点击转交与重同步、cancel 收起/重新选择、失败提示绘制（左边条）与重试",
      "集成 P2-12 用例（1.82.3 真宿主）：真实冲突暂停现场三项、untitled 左/真实 B 右的原生对比页与两侧内容断言、转交后旧输入不写入 B、对比页关闭后 untitled 释放（无累计泄漏）、放弃不回滚 B 其他修改、干净 B 仍有保护、失败注入保留现场可重试"
    ],
    "introduced": "#289（2026-10-02）"
  },
  {
    "id": "live-embed-widget",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-live-embed（Live 嵌入宿主 widget；.vsidian-live-embed-below 为显形态下方修饰）",
    "purpose": "父文档 Live 正文嵌入的挂载宿主（#223 独占行；#247 起混排/无序/有序/任务列表/懒续行/引用及组合容器内的 occurrence 同接入——识别与 #246 Reading 侧同源 scanEmbedsInLine；#248 起表格内容行（表头/数据格）的格内嵌入经格内解码扫描同接入——inner/目标为解码语义（\\| 别名不进路径）、替换区间为原始源文精确区间，widget 嵌在网格格 mark span 内（CM6 inline replace widget 不切开 mark），网格列布局与格区高亮不因格内卡破坏）：![[…]] 经 CM6 装饰挂载 reading-embed-card 同款卡片——隐形态（光标/选区未触及源码区间）只对嵌入精确区间 [from, to]（![[…]] 本身）做 inline 替换（#247 前整行替换；前后文字、列表标记/编号、任务控件、引用前缀与既有缩进保留在行内，源文不插入换行，宿主经 CSS 块级化呈现「前文 → 卡片 → 后文」流断行；replace 前后的 cm-widgetBuffer 零高块级化——验收反馈「不留隐形源码行」，且保留布局盒作为 CM6 行内块坐标锚：完全摘除（display:none）会让 posAtCoords 垂直探测在区间尾拿不到 rect 直接跳过整块，方向键从上向下越过嵌入行——#217 验收实测；保持 inline 替换是键盘垂直导航可进入嵌入行的前提，块级替换会被 CM6 跳过整行；格内形态的 buffer 零高块级化由格容器规则另行覆盖）；显形态（selectionTouchesRange 语义命中：折叠光标在区间内部或两端、非空选区严格重叠、任一选区命中——不扩大到相邻文字/整行）源文可见可编辑、卡片移至行下方继续显示（动态下移一行给源码让位；显隐只作用于源文文本的视觉呈现，不是撤卡片；兄弟卡片独立显隐）。宿主上下间距由自身 padding 承担、宿主内卡片壳 margin 清零——margin 折叠出行盒、CM6 高度记账（行号 gutter 与视口测算依据）不含它，曾致行号与正文错位逐卡累积（#217 验收实测，padding 计入盒子高使记账与渲染一致）。宿主吞事件（ignoreEvent=true）：卡片点击不落父编辑器光标、卡片内浏览器选区不被误当作父文档 CM6 源码选区；卡片内交互（滚动/选字复制/链接/属性按钮）走嵌入卡片自身监听；#248 起格区选取的起点锚定同排除嵌入卡域（tableRegionSelection——卡内 pointerdown 不启动父矩形格区选取）。未闭合引用保留可编辑原文并撤下卡片（恢复闭合按新引用重载）；围栏/行内代码/HTML 注释/frontmatter 与链接文字域内不挂载（源文呈现）。跨模式状态共享：独占行宿主 key 取行区间、混排/格内宿主 key 取嵌入精确区间（与 Reading 侧两种宿主同口径）。",
    "views": [
      "live"
    ],
    "states": "隐藏态（嵌入精确区间 inline 替换 widget，行结构与前后文/容器标记保留——键盘垂直导航双向可进入；卡片从源码行对齐与 buffer 零高块级化由 CSS 承担，混排呈「前文 → 卡片 → 后文」流断行；#248 起格内形态嵌在网格格 mark span 内、卡随列宽不撑破，格内 buffer 与宿主宽度由格容器规则约束）/ 显形态（行下方 block widget .vsidian-live-embed-below，源文在场，动态下移一行给源码让位；兄弟卡片独立显隐）；两态切换经装饰重建（卡片实例状态由嵌入卡片状态库保持）；装载中/成功/失败分态沿用卡片状态行。",
    "dom": "Live 视图 .cm-content 内：隐形态宿主 div 在 .cm-line 内（inline replace 的替换物，经 CSS display:block 块级化，前后 cm-widgetBuffer 零高块级化 display:block + height:0——观感等同隐藏，布局盒保留作坐标锚）；显形态为行尾后 block widget。卡片壳 .vsidian-embed-card（挂 .markdown-embed 别名）在内；嵌套 Reading 容器重置 white-space: normal（#217 验收实测：CM6 .cm-content 的 white-space: pre 级联会使块 innerHTML 尾部换行渲染为幽灵行盒，卡片行距成倍增大）。卡片高度异步变动（内容装载/图片晚到）经 ResizeObserver → view.requestMeasure 唤醒 CM6 布局。",
    "example": "#app .cm-editor .cm-content .vsidian-live-embed-below {\n  display: block;\n}",
    "obsidian": {
      "counterpart": ".cm-embed-block（Obsidian Live 嵌入容器方向；内部结构闭源不作承诺）",
      "support": "none"
    },
    "verification": [
      "单元 liveEmbed（#223/#247/#248）：显隐谓词矩阵（端点/内部/严格重叠/多选区/相邻文字反例/兄弟独立）、抑制边界（围栏/开放围栏/frontmatter/行内代码/注释/链接域）、混排与容器挂卡矩阵（精确区间/前后文保真/宿主 key 语义）、表格格内挂卡（解码 inner/源码区间/同格多引用独立显隐/增量重建）、增量表与装饰实例缓存",
      "单元 embedCardCssContract：Live 宿主下方形态块级规则钉住；buffer 前后零高块级化组规则与宿主 padding / 卡片壳 margin 清零规则钉住（#217 验收反馈）；#248 格内 buffer 零高与格内宿主宽度约束组规则钉住",
      "浏览器 liveEmbed（#223/#247 更新）：真实键盘/鼠标/IME/拖选驱动显隐切换、源码显形时卡片仍可见的绘制断言、内部选区隔离；#217 验收反馈补场景 C2（ArrowDown 从上方停进源码行，双向导航对称）与场景 M（行号 gutter 跨三卡对齐极差 < 1.5px）",
      "浏览器 liveEmbedMixed（#247 新增）：混排/容器前后文与标记/checkbox 绘制保真、ArrowLeft 逐键进出与相邻文字不显形、同行双嵌入兄弟独立、真实 IME 修改混排 inner、Enter 拆行撤卡与 Backspace 合行恢复、卡片内选字/滚动壳/禁写 checkbox/右键零冒泡零写回、模式切换与动态高度",
      "浏览器 tableEmbed（#248 新增）：Live/Reading 双模式表头与数据格卡绘制、转义别名形态、卡内真实指针选字不启动格区选取、区域复制序列化父文档源文、窄列不撑破"
    ],
    "introduced": "#223（2026-09-30）"
  },
  {
    "id": "reading-embed-ref",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-embed-ref（占位引用行，挂阅读双链 a 级）",
    "purpose": "嵌入引用行的可打开占位形态（#222）：引用内容中的独占行先解析出 ![[显示]] 引用；#244/#245 起在预算与深度允许时升级为正文卡片或悬停内卡片，超深、循环或预算拒绝时保留就地说明及按直接来源打开目标的入口。目标始终按直接来源文档目录解析。",
    "views": [
      "reading"
    ],
    "states": "引用内容中按当前深度和预算升级为卡片或就地占位；内部点击按直接来源跳转，不叠加第二个悬停浮层（嵌入内容域停止 mouseover/mouseout 冒泡）。",
    "dom": "嵌入块 html 内的 <a class=\"vsidian-wikilink vsidian-embed-ref\" href=\"目标原文\">（href 为 | 之前原文，与阅读双链 a 同口径）；主文档的嵌入块挂载时整块替换为嵌入卡片（占位行不出现）。",
    "example": ".vsidian-embed-ref {\n  font-family: inherit;\n}",
    "obsidian": {
      "counterpart": "（Obsidian 嵌入递归展开，无占位形态）",
      "support": "none"
    },
    "verification": [
      "单元 readingBlocks：embed 块占位 html 形态（wikilink 类 + 嵌入修饰类 + href 口径）",
      "单元 embedCard/webviewSync：独占行递归挂载、受限占位与直接来源打开；浏览器 hoverRecursive：单浮层内子卡片绘制"
    ],
    "introduced": "#222（2026-09-30）"
  },
  {
    "id": "reading-embed-mixed",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-reading-embed-mixed（混排嵌入流内宿主——叠加在 .vsidian-reading-embed 上的修饰类；宿主同时携带 data-vsidian-embed-promoted 与独占行 embed 块同构的 data-vsidian-embed-inner / src 锚点 dataset）",
    "purpose": "Reading 混排嵌入宿主（#246）：段落/列表/引用容器内与文字混排的 ![[…]]（「前文 ![[B]] 后文」）在块挂载后由行内占位（embed-slot）提升为流内块级宿主，内挂 reading-embed-card 同款卡片——呈现为「前文 → 块级卡片 → 后文」，源文件不新增换行。p 内提升时拆段（前文 p + 宿主 + 后文 p，类与属性克隆保留、空半不产出——合法 DOM，不在 p 内塞块级节点）；横跨嵌入的粗体/斜体/高亮拆壳为前后各完整的行内标签（可视语义保留）；列表项（无序/有序/任务/懒续行）与引用内直接落位，列表编号、缩进与引用边条容器不拆；宿主宽度跟随所属列/缩进区域（块级占满父内容盒，不越缩进界）。同一识别/挂载适配覆盖主文档 Reading、卡片内容与悬停内容三处（RefContentMount 与 EmbedCardManager 共用 embedSlots 装配）；同段/行多个嵌入各按 occurrence 区间独立成卡、保持源顺序。#248 起表格格内（表头 th/数据格 td）同升级——占位原位替换为格内宿主（表格行列结构不拆、宽度随列；\\| 别名等转义形态的占位经格内解码重解析产出，data-vsidian-embed-inner 为解码语义、src 锚点为原始源文区间）。",
    "views": [
      "reading"
    ],
    "states": "升级路径与独占行卡片同构（装载中/成功/失败分态、限高滚动、深度与预算拒绝、递归与来源租约沿用 #244/#245 既有基建）；不可提升形态（链接域 a 内、配对失败降级）保持 .vsidian-embed-slot 占位文本不升级；#248 起表格格内占位升级为格内宿主（转义别名形态含）。",
    "dom": "主文档 Reading：块元素（.vsidian-reading-block）内部由挂载适配（embedSlots.promoteEmbedSlot）产出，宿主 div 类为 .vsidian-reading-embed .vsidian-reading-embed-mixed；卡片内容与悬停内容内同样经 RefContentMount 块挂载钩子产出（直接来源/occurrence 语义按所在父实例）；#248 起表格块（table 块）的 td/th 内格内宿主同款产出（原位替换占位）。卸载以 data-vsidian-embed-promoted 查询配对（宿主随所属块回收，实例状态保留在卡片状态库）。",
    "example": "#app .vsidian-view-reading .vsidian-reading-embed-mixed {\n  display: block;\n  margin: 0.35em 0;\n}",
    "obsidian": {
      "counterpart": "（Obsidian 混排嵌入同为块级插入；容器规则闭源不作承诺）",
      "support": "none"
    },
    "verification": [
      "单元 embedSlots（#246/#248）：occurrence 扫描语法排除（代码/注释/frontmatter）、占位配对、p 拆分/格式拆壳/列表引用落位/链接不提升矩阵、表格 td/th 格内提升与配对失败降级",
      "单元 embedCard：混排宿主挂载出站请求带行内精确区间、同段多嵌入独立实例、卸载配对与重挂零重发",
      "浏览器 mixedEmbed（#246）：真实指针滚动/明暗主题下前后文可见性与卡片绘制、列表编号与引用边条保真",
      "浏览器 tableEmbed（#248）：Reading 表头/数据格卡绘制与窄列不撑破"
    ],
    "introduced": "#246（2026-10-01）"
  },
  {
    "id": "embed-slot",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-embed-slot（混排嵌入行内占位 span，data-vsidian-embed-inner 携带目标原文）",
    "purpose": "Reading 混排嵌入的行内占位（#246）：markdown-it inline 规则（与 shared/wikilink 扫描器同源的 embedAtPosition 判定）在段落/列表/引用/表格的行内内容产出的 span——块挂载后升级为 reading-embed-mixed 流内宿主（#248 起含表格 td/th 格内）；未升级/不可提升（链接域 a 内——嵌套 a 属非法 DOM、配对失败降级）时按占位文字形态呈现（正文文字 + 描述色弱化，保留 ![[ ]] 文本可辨识）。占位是 span 而非 a：可处于链接文字域内而不破坏 DOM 合法性，链接域内点击走外层 a 的既有链接语义。#248 起表格格内含 \\| 的嵌入形态经格内解码重解析产占位（data-vsidian-embed-inner 为解码语义，如 B|别名），与格内解码扫描的 occurrence 配对同源。",
    "views": [
      "reading"
    ],
    "states": "升级（块挂载且占位可提升——被流内/格内宿主替换，span 退场）/ 占位保持（其余形态；随块 HTML 重建而重建）。",
    "dom": "块级容器（p/li/td/th 等）的行内内容中：<span class=\"vsidian-embed-slot\" data-vsidian-embed-inner=\"原文\">![[显示]]</span>；data 属性值经 HTML 转义，进 DOM 前经 sanitizeReadingDom 纵深净化（data 属性保留）。",
    "example": "#app .vsidian-view-reading .vsidian-reading-block .vsidian-embed-slot {\n  color: var(--vscode-descriptionForeground, inherit);\n}",
    "obsidian": {
      "counterpart": "（Obsidian 混排嵌入直接渲染，无占位形态）",
      "support": "none"
    },
    "verification": [
      "单元 embedSlots（#246）：占位 html 形态（span + data-inner + 显示文本）、代码字面量/残缺形态不产占位与未闭合注释边角",
      "单元 embedSlots：占位查询与配对（data-vsidian-embed-inner 为挂载配对单一来源）",
      "单元 readingMarkdown（#248）：格内 \\| 形态经解码重解析产占位（data-inner 解码语义）、跨格伪形态与 code span 字面量不产占位",
      "浏览器 mixedEmbed（#246）：占位降级形态（链接域内）文字可见"
    ],
    "introduced": "#246（2026-10-01）"
  },
  {
    "id": "find-panel",
    "domain": "chrome",
    "category": "find-panel",
    "kind": "selector",
    "target": ".vsidian-find（浮动面板容器；.vsidian-find-open 展开态）—— 内部 .vsidian-find-row 主行（.vsidian-find-inputwrap 输入容器（边框/背景/聚焦环/非法红边载体）内嵌 .vsidian-find-input 输入框与 .vsidian-find-case（Aa）/ -word（ab）/ -regexp（.*）三开关（各自 -active 点亮态）/.vsidian-find-count 计数（-empty 零命中 / -hidden 空查询收起不占位）/ .vsidian-find-prev / -next 导航 / -in-selection 在选定内容中查找（-active 点亮；禁用态灰化）/ -close 关闭；-selection-range 为开启时正文里的范围淡底 mark）与 .vsidian-find-toggle 左缘替换栏展开切换（aria-expanded 随态；阅读模式 disabled 灰化）",
    "purpose": "编辑区浮动查找面板（#236 起三开关面板，引擎 @codemirror/search 外部驱动）：grid 双列布局（2026-10 对齐 VSCode 原生）——左列替换栏展开切换（跨行全高：收起与主行等高、展开经 :has 跨两行与面板主体等高；常态无边框、focus 态才出强调色圈与输入框焦点圈互斥，点击后焦点归还输入框；图标为 quick-action-icons.py 自绘 SVG 挂内嵌 glyph 层，展开随 aria-expanded 旋转 90°：> → ⌄）+ 右列主行（输入/大小写-全字-正则三开关/「第 n 项，共 total 项·无结果」计数/上一个/下一个/关闭，同序对齐 VSCode 原生浮层）与替换行堆叠。三开关为查找选项单一事实源（shared/findOptions，#238「选下一处相同词」同源消费），workspace 级记忆跨会话保留；面板在 Live 与阅读两模式均可用（阅读保留块级命中与定位），替换入口阅读模式整体禁用（2026-10 用户决策——toggle disabled 灰化、Ctrl+H 键位不消费）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "面板 DOM 常驻、显隐由 .vsidian-find-open 控制（关闭时 display:none，探针不受影响）；三开关点亮为对应 -active 类（开启=点亮，如 matchCase 开启时 Aa 点亮）；非法正则输入容器红边反馈（invalid 类标在输入框上作状态源，:has 上探容器着色；空查询不算非法不标红；不崩、计数显示「无结果」）；空查询计数区以 -hidden 类整体收起（display:none，未搜索不预留「当前/总数」占位——#241 验收修订）；在选定内容中查找（#241 资产接线，VSCode ☰）：面板局部态非持久化（关闭面板/进入阅读即复位）——无用户选区锚点时按钮禁用（灰化不响应 hover），开启时点亮并入激活族、匹配/导航/替换限制在范围（范围随编辑映射、用户重选跟随），正文以 .vsidian-find-selection-range 淡底 mark 标记范围（非活动选区同款底色，可跨行）；替换栏 toggle 阅读态禁用（disabled 灰化不响应——共享 hover 规则带 :not(:disabled) 守卫，disabled 不可聚焦故 focus 圈天然不出现）；开合与开关交互由浏览器套件按行为路径验证。",
    "dom": "挂编辑器容器（position:relative 定位包含块）内、#app 之下；按钮均为真实 <button type=\"button\">（aria-pressed/aria-expanded 随态，aria-label/title 用 i18n 词条 find.*）；#241 起导航/关闭/替换按钮为图标形态——本体显示随主题切换的 SVG 图标，功能词只在 aria-label 与 hover title。",
    "example": ".vsidian-find {\n  border-radius: 6px;\n}\n.vsidian-find .vsidian-find-case-active {\n  color: #f14c4c;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 查找为应用级部件，不作用于文档样式面）",
      "support": "none"
    },
    "verification": [
      "单元 findPanelCssContract：显隐对/grid 双列布局/toggle 全高与 focus 圈互斥/阅读态 disabled 灰化/chevron SVG 双主题与 90° 旋转/三开关点亮/红边规则钉住",
      "单元 find：面板开合、三开关重算与替换行为（jsdom 控制器）",
      "浏览器 findPanel（#236）：真实键盘路径"
    ],
    "introduced": "#14（面板）；#236（三开关面板与列布局，2026-10 批次）"
  },
  {
    "id": "find-panel-replace",
    "domain": "chrome",
    "category": "find-panel",
    "kind": "selector",
    "target": ".vsidian-find-replace（替换行容器；.vsidian-find-replace-open 展开态）—— 内部 .vsidian-find-replace-input 替换输入框 / .vsidian-find-replace-next「替换」/ .vsidian-find-replace-all「全部替换」按钮",
    "purpose": "查找面板的可展开替换栏（#236）：替换行默认收起，左缘 toggle（find-panel 条目的 .vsidian-find-toggle）或 Ctrl+H（findReplace 操作）展开；「替换」替换当前匹配并移到下一处、「全部替换」整批替换——两者均为显式写操作（经 CM6 事务走标准写回链路，一笔 edit.request = 宿主撤销一次）。替换是 Live 编辑能力，阅读模式整体禁用（2026-10 用户决策）：带 replace 的打开指令不开面板（静默忽略）、Ctrl+H 键位不消费（注册表生效模式 Live）、toggle disabled 灰化；live 侧展开记忆不被阅读侧触碰，切回 live 原样恢复（关闭面板即终结会话，两模式同口径）。",
    "views": [
      "live"
    ],
    "states": "替换行 DOM 常驻、显隐由 .vsidian-find-replace-open 控制（默认收起 display:none；阅读模式恒收起且 toggle 禁用）；展开态由 FindSessionProbe.replaceOpen 观测。",
    "dom": "面板（.vsidian-find）内第三段；输入框 Enter 为面板局部键（替换下一个）；按钮为真实 <button type=\"button\">（#241 起图标形态，功能词在 aria-label/title，i18n 词条 find.replaceNext / find.replaceAll）。",
    "example": ".vsidian-find .vsidian-find-replace.vsidian-find-replace-open {\n  gap: 8px;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 替换为应用级部件）",
      "support": "none"
    },
    "verification": [
      "单元 findPanelCssContract：替换行显隐对规则钉住",
      "单元 find（#236）：替换下一个/全部替换各单笔 edit.request、$n 捕获组展开、阅读整体禁用（replace 指令不开面板/记忆不触碰/toggle disabled）"
    ],
    "introduced": "#236（2026-10 批次）；2026-10 阅读模式整体禁用（用户决策）"
  },
  {
    "id": "find-match-highlight",
    "domain": "chrome",
    "category": "find-panel",
    "kind": "selector",
    "target": ".vsidian-find-match（全部匹配装饰）与 .vsidian-find-match-current（当前匹配装饰，双模式行内）；.vsidian-reading-find-hit（阅读当前命中块，旧片段入口）",
    "purpose": "查找匹配高亮：匹配集来自 @codemirror/search 引擎，基于全文源码计数与定位。Live 为当前匹配直接装饰与全部匹配视口装饰；阅读侧按源坐标映射到已挂载块内的可见文字，全部命中浅黄、当前命中深橙，callout/引用块只染命中文字。隐藏链接目标、图片属性与已渲染公式等源码命中仍计数，不挪用相同可见文字作高亮。旧 .vsidian-reading-find-hit 仍挂当前命中块，默认不铺块底或边条，旧片段可继续命中。",
    "views": [
      "live",
      "reading"
    ],
    "states": "交互态装饰（查找会话打开且有命中时在场）——不进静态探针；命中计数、当前序号与定位由集成 find 用例按行为路径验证。",
    "dom": "live：#app .cm-editor .cm-content 内行内装饰；reading：#app .vsidian-view-reading 内匹配文字的 span，当前命中块仍保留 .vsidian-reading-block.vsidian-reading-find-hit。",
    "example": "#app .cm-editor .cm-content .vsidian-find-match {\n  background-color: rgba(234, 179, 8, 0.4);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 命中高亮为应用级）",
      "support": "none"
    },
    "verification": [
      "单元 findSession：匹配集与装饰类名（引擎包裹层）",
      "集成 find 用例（#14/#236）：命中计数、序号与屏外定位",
      "单元 readingVirtualView、浏览器 findPanel：精确命中、隐藏目标不串位、主题绘制、重挂载与模式切换保持、旧块变量仍生效"
    ],
    "introduced": "#14；#236（引擎迁移）"
  },
  {
    "id": "var-find-highlight",
    "domain": "chrome",
    "category": "find-panel",
    "kind": "variable",
    "target": "--vsidian-find-match-background / --vsidian-find-match-current-background / --vsidian-find-match-current-outline / --vsidian-find-hit-block-background",
    "purpose": "查找高亮四变量：--match-background 全部匹配底色（默认黄系半透）；--match-current-background 当前匹配底色（默认橙系，双模式字符装饰同引）；--match-current-outline 当前匹配描边；--hit-block-background 阅读当前命中块的兼容底色入口（默认透明，片段显式赋值仍染块底）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "消费于 live 匹配装饰与阅读命中块规则；默认值以 var() 回落值内联在规则里（未在 #app 定义根值——片段在 :root 覆盖即整体生效）。",
    "example": ":root {\n  --vsidian-find-match-background: rgba(234, 179, 8, 0.4);\n  --vsidian-find-match-current-background: rgba(255, 141, 55, 0.7);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 高亮色为应用设置项非 CSS 变量）",
      "support": "none"
    },
    "verification": [
      "单元 findPanelCssContract：变量消费规则存在（回落值内联形态）"
    ],
    "introduced": "#14"
  },
  {
    "id": "reading-find-source",
    "domain": "chrome",
    "category": "find-panel",
    "kind": "selector",
    "target": ".vsidian-reading-find-source（只读源码浮层）与 .vsidian-reading-find-source-header / -location / -readonly / -code；浮层内复用 .vsidian-find-match / .vsidian-find-match-current",
    "purpose": "阅读查找的隐藏源码反馈：当前命中无法完整映射到可见文字时，保留渲染态并显示命中起始源码行。表格分隔符、隐藏链接目标、公式与注释等无需切模式即可定位；计数与匹配顺序不变。源码以纯文本呈现，无编辑与写回入口。",
    "views": [
      "reading"
    ],
    "states": "交互态，只在隐藏或部分隐藏的当前命中时挂载；可见命中、关闭查找、切 Live 或销毁时移除。滚动后锚点屏外则隐藏，虚拟块重挂载恢复；窗口变化重定位。浮层 fixed 定位，不占正文排版空间，不改变段落位置、块高度或滚动高度；不抢查找焦点，避让查找面板，视口边缘翻转与收缩。长行截取当前命中附近不超过约 320 个 UTF-16 单元且不拆 emoji；跨行命中显示起始行，行末 LF 以 \\n 显示。",
    "dom": "挂 #app 下、阅读滚动容器外；aside[role=region] 内头部显示源码命中、源行列与只读标签，pre > code 内 span 精确高亮。无 input、textarea、contenteditable 或新快捷键操作，沿用既有查找导航与关闭键。",
    "example": "#app .vsidian-reading-find-source {\n  border-radius: 5px;\n}\n#app .vsidian-reading-find-source-code {\n  font-size: 13px;\n}",
    "obsidian": {
      "counterpart": "无（Vsidian 阅读查找的源码反馈）",
      "support": "none"
    },
    "verification": [
      "单元 readingVirtualView：隐藏与部分隐藏命中、可见竖线、纯文本安全、长行与生命周期；findPanelCssContract 钉住 fixed 与共享色变量",
      "浏览器 findPanel：明暗截图像素、段落与滚动高度不移动、键盘导航、模式切换、零写回、窄屏与虚拟挂载",
      "集成编辑区查找：view.state.paint.readingFindSource 当前文字命中与背景实际生效"
    ],
    "introduced": "#241 验收跟进（2026-10-01）"
  },
  {
    "id": "find-options-bar",
    "domain": "chrome",
    "category": "find-panel",
    "kind": "selector",
    "target": ".vsidian-occurrence-bar（迷你浮动条容器；.vsidian-occurrence-bar-open 显示态）—— 内部 .vsidian-occurrence-case（Aa）/ -word（ab）/ -regexp（.*）三开关（各自 -active 点亮态）",
    "purpose": "查找选项条（#238）：「选下一处相同词」会话期间在场的迷你浮动条——仅三个开关按钮，无搜索框无计数（用户决策：每次 Ctrl+D 按下都直接打开）。按钮态与主面板开关记忆同源（shared/findOptions，aria-pressed 同步），点击即切换并按新选项重建会话；非模态——不抢编辑器焦点（按钮 mousedown preventDefault 保焦）、不占弹窗互斥槽位，Esc 在查找面板之后消费一次（只关条不收敛选区）；主查找面板打开时不出现（改由 .vsidian-find-flash 闪烁面板开关按钮承担提示）；会话结束（选区外部变化/失焦/Esc/切模式）淡出。",
    "views": [
      "live"
    ],
    "states": "DOM 常驻、显隐由 .vsidian-occurrence-bar-open 控制（默认 display:none，探针不受影响）；三开关点亮为对应 -active 类（与主面板 -active 同款点亮语言）；面板开关闪烁态 .vsidian-find-flash（0.45s 不透明度脉冲动画，非本条目选择器——挂在 find-panel 域的面板按钮上）。",
    "dom": "挂编辑器容器（与 .vsidian-find 同定位包含块、同右上角位、互斥出现）；按钮为真实 <button type=\"button\">（aria-pressed 随态、aria-label/title 复用 find.matchCase / find.wholeWord / find.regexp 词条，容器 aria-label 用 find.optionsBar）。",
    "example": ".vsidian-occurrence-bar {\n  border-radius: 4px;\n}\n.vsidian-occurrence-bar .vsidian-occurrence-case-active {\n  color: #f14c4c;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 的 Ctrl+D 选项提示为应用级部件，不作用于文档样式面）",
      "support": "none"
    },
    "verification": [
      "单元 occurrenceCssContract：选项条显隐对与三开关点亮规则钉住",
      "单元 occurrence（#238）：显示/在场/淡出/切换重建/闪烁替代的完整行为路径",
      "浏览器 occurrence（#238）：真实键盘 Ctrl+D 连按与弦键位"
    ],
    "introduced": "#238（2026-10 批次）"
  },
  {
    "id": "skeleton",
    "domain": "chrome",
    "category": "loading",
    "kind": "container",
    "target": ".vsidian-skeleton（列容器 .vsidian-skeleton-column 为其唯一子元素）",
    "purpose": "编辑器初次打开的加载期骨架容器（#292）：随初始 HTML 即时呈现，覆盖「脚本加载」与「正文就绪」两段空窗；挂载后收编为主编辑区内、工具栏下方的覆盖层，正文首帧后按扫光收束规则移除。默认背景随编辑器背景变量，骨架不拦截指针事件。",
    "views": [
      "live",
      "reading"
    ],
    "states": "仅装载窗口在场：挂载前覆盖 #app 整页，挂载后仅盖内容区（宿主类 .vsidian-skeleton-host 提供定位包含块，撤除时一并移除）；撤除后不存在。",
    "dom": "初始 HTML 内 #app 的直接子元素（单实例，稳定 id vsidian-skeleton）；挂载后移入 .vsidian-main（vsidian-skeleton-host 态）末尾——不进视图容器（阅读虚拟化按块管理容器子树，见规格 skeleton-screen.md）。",
    "example": ".vsidian-skeleton {\n  background: var(--vscode-editor-background);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 无加载骨架）",
      "support": "none"
    },
    "verification": [
      "单元 skeletonScreen（#292）：内联装配形态钉住（宽变量引用/延时周期同源常量/reduced-motion/自包含无外部资源）",
      "单元 skeletonPanel（#292）：jsdom 控制器收编、撤除、测试冻结与 release",
      "浏览器 skeletonProbe（#292）：呈现与撤除的绘制断言、宽度跟随限宽变量",
      "集成 _test.getSkeletonState（#292）：hold 装配下的在场与落点回报"
    ],
    "introduced": "#292（2026-10-02）"
  },
  {
    "id": "skeleton-block",
    "domain": "chrome",
    "category": "loading",
    "kind": "selector",
    "target": ".vsidian-skeleton-block（nth-child 宽高序列的标题/段落/代码块形态；::after 扫光层与 @keyframes vsidian-skeleton-sweep）",
    "purpose": "骨架灰块条与扫光动画（#292）：通用固定形态（不读文档内容、不模拟行号列），灰块底色与扫光高亮均由编辑器前景色低占比 color-mix 派生（明暗主题自适应）；扫光经启动延时后循环，撤除等当前周期播完——延时/周期常量与撤除计划同源（shared/skeletonTiming）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "扫光在 prefers-reduced-motion: reduce 下禁用（静态灰块）；启动延时（默认 300ms）结束后才出现扫光，瞬间载好的文档全程无动画。",
    "dom": ".vsidian-skeleton > .vsidian-skeleton-column 的直接子 div 序列；列宽引用 --vsidian-live-preview-max-width（与正文列同源，0 = 铺满档下骨架同样铺满），水平留白与正文基线同变量（--vsidian-content-padding-inline）。",
    "example": ".vsidian-skeleton-block {\n  background: color-mix(in srgb, var(--vscode-editor-foreground) 9%, transparent);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 无加载骨架）",
      "support": "none"
    },
    "verification": [
      "单元 skeletonScreen（#292）：颜色派生、动画常量与 reduced-motion 规则钉住",
      "浏览器 skeletonProbe（#292）：reduced-motion 下扫光关闭与扫光在场的绘制断言"
    ],
    "introduced": "#292（2026-10-02）"
  },
  {
    "id": "skeleton-column",
    "domain": "chrome",
    "category": "loading",
    "kind": "selector",
    "target": ".vsidian-skeleton-column",
    "purpose": "骨架列容器（#292）：承载骨架灰块序列的列盒，max-width 引用 --vsidian-live-preview-max-width（与正文列同源，不复制读值），水平留白与正文基线同变量（--vsidian-content-padding-inline）——用户片段对加载期列宽的定制点。",
    "views": [
      "live",
      "reading"
    ],
    "states": "仅装载窗口在场，撤除后不存在；铺满档（0）下随变量回退 none 自然铺满。",
    "dom": ".vsidian-skeleton 的唯一子元素；其直接子元素为 .vsidian-skeleton-block 序列（见 skeleton-block 条目）。",
    "example": ".vsidian-skeleton-column {\n  max-width: var(--vsidian-live-preview-max-width);\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 无加载骨架）",
      "support": "none"
    },
    "verification": [
      "单元 skeletonScreen（#292）：列宽变量引用与预注入行为钉住",
      "浏览器 skeletonProbe（#292）：限宽 600 跟随与铺满档等宽的绘制断言"
    ],
    "introduced": "#292（2026-10-02）"
  },
  {
    "id": "tooltip-card",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "selector",
    "target": ".vsidian-tooltip",
    "purpose": "统一自绘悬停提示容器（#300）：全站悬停词（操作提示、用户内容字面量、态变原因、键位徽章）的自绘小卡片。document 级委托监听 [data-tooltip]（原生 title 已退役，防回潮扫描钉住），悬停经 --vsidian-tooltip-show-delay 延迟出现、焦点进入即时显示；可聚焦（tabindex=0）、内部文字可选中复制，不装载按钮。fixed 定位经 tooltipGeometry（下→上翻转、水平居中优先、越缘翻转对齐、视口钳制），z-index 10500 高于模态——图表/图片/悬停预览弹窗自身按钮的提示可呈现于弹窗之上；不参与 popupMutex 争夺，显隐纯指针/焦点驱动。设置页 webview 同机制同类名。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "挂载于 #app 直下（回退 body）；单例常驻，shown 修饰类驱动显隐。",
    "example": ".vsidian-tooltip { background: var(--vsidian-tooltip-background); border-radius: var(--vsidian-tooltip-radius); }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCard：显隐时序、保活、焦点即显、Esc 还焦、徽章渲染",
      "单元 tooltipGeometry：翻转与钳制矩阵",
      "浏览器 tooltipCard：悬停可见性与主题跟随的绘制层断言"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "tooltip-key",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "selector",
    "target": ".vsidian-tooltip-key",
    "purpose": "悬停提示内的键位徽章（#300）：带快捷键操作的键位段独立成章——名称走 data-tooltip、键位走 data-tooltip-keys（内部 \n 分隔），多段键位各一枚；显示连接符由徽章形态承担，不走 common.keySeparator 显示串。",
    "views": [
      "live",
      "reading"
    ],
    "dom": ".vsidian-tooltip 内 .vsidian-tooltip-keys 区（内部布局壳，不公开）的直接子元素序列。",
    "example": ".vsidian-tooltip-key { background: var(--vsidian-tooltip-key-background); }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCard：多段键位各一枚徽章、无键位不渲染"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-background",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-background",
    "purpose": "悬停提示卡片背景（#300）：默认引宿主 --vscode-editorHoverWidget-background——浅色主题浅底深字、深色主题深底白字，与宿主原生悬停同频自适应。公开变量，CSS 片段可覆盖（规格 docs/specs/tooltip.md「视觉规格」）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-background: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-foreground",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-foreground",
    "purpose": "悬停提示文字前景（#300）：默认引宿主 editorHover 前景，明暗自适应。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-foreground: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-border",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-border",
    "purpose": "悬停提示边框（#300）：默认引宿主 editorHover 边框——浅色细边、深色近无，高对比主题随宿主强化。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-border: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-radius",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-radius",
    "purpose": "悬停提示圆角（#300）。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-radius: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-font-size",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-font-size",
    "purpose": "悬停提示字号（#300）。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-font-size: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-max-width",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-max-width",
    "purpose": "悬停提示最大宽度（#300）：超宽换行（错误原因等长文案的收束边界）。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-max-width: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-key-background",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-key-background",
    "purpose": "键位徽章背景（#300）：默认引宿主 editorHover 状态条色。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-key-background: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-key-foreground",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-key-foreground",
    "purpose": "键位徽章前景（#300）：默认引宿主 description 前景。公开变量，CSS 片段可覆盖。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-key-foreground: …; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCssContract：变量定义于 #app 块且被 .vsidian-tooltip 规则引用",
      "浏览器 tooltipCard：计算样式非透明与主题类切换跟随"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "id": "var-tooltip-show-delay",
    "domain": "chrome",
    "category": "tooltip",
    "kind": "variable",
    "target": "--vsidian-tooltip-show-delay",
    "purpose": "悬停提示出现延迟，ms 无单位数字（#300）：控制器经 getComputedStyle 读取；公开为行为变量供片段调校。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app（编辑器与设置页两 webview 同名容器）。",
    "example": "#app { --vsidian-tooltip-show-delay: 300; }",
    "obsidian": {
      "counterpart": "无（Obsidian tooltip 无公开定制接口）",
      "support": "none"
    },
    "verification": [
      "单元 tooltipCard：延迟来源（变量读取、非法回缺省、注入覆盖）",
      "浏览器 tooltipCard：无注入装配走真实 CSS 变量路径"
    ],
    "introduced": "#300（2026-10-02）"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "toast-container",
    "kind": "container",
    "target": ".vsidian-toast-container",
    "purpose": "编辑器视口底部居中的独立轻提示通道；不抢焦点，不拦截下层输入。",
    "states": "同时最多一条；与宿主通知通道独立。",
    "example": ".vsidian-toast-container { bottom: 32px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "toast",
    "kind": "selector",
    "target": ".vsidian-toast",
    "purpose": "本地轻提示卡片；文本折行，不裁掉操作引导。",
    "states": "data-severity 为 neutral、warning 或 error；动画状态内部使用。",
    "example": ".vsidian-toast { font-size: 13px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "toast-severity",
    "kind": "selector",
    "target": ".vsidian-toast[data-severity=\"neutral\"], .vsidian-toast[data-severity=\"warning\"], .vsidian-toast[data-severity=\"error\"]",
    "purpose": "三种严重性入口：普通跟随主题，警告淡黄，错误淡红；高对比采用主题前景与边框。",
    "example": ".vsidian-toast[data-severity=\"warning\"] { border-width: 2px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-background",
    "kind": "variable",
    "target": "--vsidian-toast-background",
    "purpose": "普通提示背景，跟随当前主题",
    "example": "#app { --vsidian-toast-background: #252526; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-foreground",
    "kind": "variable",
    "target": "--vsidian-toast-foreground",
    "purpose": "普通提示文字，跟随当前主题",
    "example": "#app { --vsidian-toast-foreground: #cccccc; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-border",
    "kind": "variable",
    "target": "--vsidian-toast-border",
    "purpose": "普通提示边框，跟随当前主题",
    "example": "#app { --vsidian-toast-border: #888888; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-warning-background",
    "kind": "variable",
    "target": "--vsidian-toast-warning-background",
    "purpose": "警告淡黄色背景，适配明暗及高对比主题",
    "example": "#app { --vsidian-toast-warning-background: #fff7db; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-warning-foreground",
    "kind": "variable",
    "target": "--vsidian-toast-warning-foreground",
    "purpose": "警告文字色，适配明暗及高对比主题",
    "example": "#app { --vsidian-toast-warning-foreground: #70530b; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-warning-border",
    "kind": "variable",
    "target": "--vsidian-toast-warning-border",
    "purpose": "警告轻边框色，适配明暗及高对比主题",
    "example": "#app { --vsidian-toast-warning-border: #e7d49a; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-error-background",
    "kind": "variable",
    "target": "--vsidian-toast-error-background",
    "purpose": "错误淡红色背景，适配明暗及高对比主题",
    "example": "#app { --vsidian-toast-error-background: #fdebec; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-error-foreground",
    "kind": "variable",
    "target": "--vsidian-toast-error-foreground",
    "purpose": "错误文字色，适配明暗及高对比主题",
    "example": "#app { --vsidian-toast-error-foreground: #922f3c; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-error-border",
    "kind": "variable",
    "target": "--vsidian-toast-error-border",
    "purpose": "错误轻边框色，适配明暗及高对比主题",
    "example": "#app { --vsidian-toast-error-border: #e9bbc1; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-radius",
    "kind": "variable",
    "target": "--vsidian-toast-radius",
    "purpose": "提示圆角",
    "example": "#app { --vsidian-toast-radius: 8px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-font-size",
    "kind": "variable",
    "target": "--vsidian-toast-font-size",
    "purpose": "提示字号",
    "example": "#app { --vsidian-toast-font-size: 12px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-padding-inline",
    "kind": "variable",
    "target": "--vsidian-toast-padding-inline",
    "purpose": "提示水平内边距",
    "example": "#app { --vsidian-toast-padding-inline: 14px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-padding-block",
    "kind": "variable",
    "target": "--vsidian-toast-padding-block",
    "purpose": "提示垂直内边距",
    "example": "#app { --vsidian-toast-padding-block: 9px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-max-width",
    "kind": "variable",
    "target": "--vsidian-toast-max-width",
    "purpose": "提示最大宽度，同时受视口安全留白钳制",
    "example": "#app { --vsidian-toast-max-width: 480px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-viewport-margin",
    "kind": "variable",
    "target": "--vsidian-toast-viewport-margin",
    "purpose": "视口两侧安全留白",
    "example": "#app { --vsidian-toast-viewport-margin: 16px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-bottom-offset",
    "kind": "variable",
    "target": "--vsidian-toast-bottom-offset",
    "purpose": "距编辑器视口底部距离，另计安全区",
    "example": "#app { --vsidian-toast-bottom-offset: 24px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-shadow",
    "kind": "variable",
    "target": "--vsidian-toast-shadow",
    "purpose": "提示阴影",
    "example": "#app { --vsidian-toast-shadow: 0 4px 16px rgb(0 0 0 / 0.12); }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-enter-distance",
    "kind": "variable",
    "target": "--vsidian-toast-enter-distance",
    "purpose": "入场自下向上位移；减少动态效果时移除",
    "example": "#app { --vsidian-toast-enter-distance: 8px; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-enter-duration",
    "kind": "variable",
    "target": "--vsidian-toast-enter-duration",
    "purpose": "入场动画时长（CSS 时间）",
    "example": "#app { --vsidian-toast-enter-duration: 160ms; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-exit-duration",
    "kind": "variable",
    "target": "--vsidian-toast-exit-duration",
    "purpose": "离场动画时长（CSS 时间）",
    "example": "#app { --vsidian-toast-exit-duration: 120ms; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-duration",
    "kind": "variable",
    "target": "--vsidian-toast-duration",
    "purpose": "普通提示停留毫秒数（无单位）",
    "example": "#app { --vsidian-toast-duration: 2600; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-warning-duration",
    "kind": "variable",
    "target": "--vsidian-toast-warning-duration",
    "purpose": "警告停留毫秒数（无单位）",
    "example": "#app { --vsidian-toast-warning-duration: 4000; }"
  },
  {
    "domain": "chrome",
    "category": "toast",
    "views": [
      "live",
      "reading"
    ],
    "dom": "定义于 #app，容器为其直接后代；不随正文滚动。",
    "obsidian": {
      "counterpart": "无（Vsidian 自带轻提示）",
      "support": "none"
    },
    "verification": [
      "单元 toastCssContract：变量定义与消费；单元 toast：生命周期",
      "浏览器 plainPaste：片段覆盖、主题、焦点与绘制层；真宿主 plainPasteHost：paint.toast.visible"
    ],
    "introduced": "#305（2026-10-02）",
    "id": "var-toast-error-duration",
    "kind": "variable",
    "target": "--vsidian-toast-error-duration",
    "purpose": "错误停留毫秒数（无单位）",
    "example": "#app { --vsidian-toast-error-duration: 5000; }"
  },
  {
    "id": "paste-dialog-overlay",
    "domain": "chrome",
    "category": "rich-paste",
    "kind": "container",
    "target": ".vsidian-paste-dialog-overlay",
    "purpose": "粘贴格式询问模态遮罩：拦截局部交互，取消不产生编辑。",
    "views": [
      "live"
    ],
    "states": "仅检测到可转换格式且询问开启时挂载；模式切换或目标失效不插入迟到结果。",
    "dom": "#app 的直接后代，覆盖当前编辑器视口。",
    "example": ".vsidian-paste-dialog-overlay { background: rgb(0 0 0 / 0.1); }",
    "obsidian": {
      "counterpart": "无（Vsidian 粘贴询问）",
      "support": "none"
    },
    "verification": [
      "单元 richPasteInteraction：询问/取消/目标失效；浏览器 richPaste：模态绘制与键盘焦点"
    ],
    "introduced": "#306（2026-10-02）"
  },
  {
    "id": "paste-dialog",
    "domain": "chrome",
    "category": "rich-paste",
    "kind": "selector",
    "target": ".vsidian-paste-dialog",
    "purpose": "保留格式、仅文本、取消与不再提示复选框的对话框；键盘Tab聚焦循环，Esc取消。",
    "views": [
      "live"
    ],
    "states": "通过选择保存本次决定；勾选且未取消时保存两个偏好。",
    "dom": ".vsidian-paste-dialog-overlay 的直接后代；role=dialog、aria-modal=true。",
    "example": ".vsidian-paste-dialog { border-radius: 12px; }",
    "obsidian": {
      "counterpart": "无（Vsidian 粘贴询问）",
      "support": "none"
    },
    "verification": [
      "单元 richPasteInteraction：三种选择；浏览器 richPaste：模态背景/焦点与记忆回显；真宿主 richPasteHost：设置持久化"
    ],
    "introduced": "#306（2026-10-02）"
  }
] as readonly StyleContractEntry[]

/** 条目英文覆盖（#178 双语化：字段级，条目/字段缺失回退中文基准；取词经
 *  src/shared/styleContractEn.ts 的 applyStyleContractEntryOverride 按表应用） */
export const STYLE_GUIDE_EN_OVERRIDES: Readonly<Record<string, StyleContractEntryOverride>> = {
  "container-live": {
    "purpose": "Live preview view container; holds the CodeMirror 6 editor.",
    "dom": "Direct child of #app; hidden with display:none in reading view but stays in the DOM, so styles still match (same probe convention as LineGutterProbe).",
    "obsidian": {
      "counterpart": ".markdown-source-view (editing-area container), .mod-cm6 (CM6 mode marker), .cm-s-obsidian (CM theme container)"
    }
  },
  "container-reading": {
    "purpose": "Reading view container; holds block-level structures that are mounted on demand.",
    "dom": "Direct child of #app; blocks are real semantic tags rendered by markdown-it, so tag selectors (p/h1/strong etc.) match naturally as descendants of the container.",
    "obsidian": {
      "counterpart": ".markdown-preview-view (reading view container)"
    }
  },
  "live-heading-line": {
    "purpose": "Line container class for live headings (attached to the .cm-line line element); the whole-line styling entry point.",
    "dom": "A .cm-line line element inside the live container; the # heading markers are revealed when the cursor enters the heading line.",
    "obsidian": {
      "counterpart": ".HyperMD-header-{1..6} (the Obsidian live heading line container class)"
    }
  },
  "live-header-span": {
    "purpose": "Content span class for live headings (a mark decoration wrapping only the heading text); the inline token-level entry point.",
    "dom": "A mark decoration span inside the heading line; Setext headings match as well.",
    "obsidian": {
      "counterpart": ".cm-header-{1..6} (the Obsidian live heading inline token class)"
    }
  },
  "live-heading-inview": {
    "purpose": "Marks heading lines currently inside the viewport; since #55 it only scopes the active heading background and serves as an observation hook, drawing no styles of its own.",
    "states": "Added when a heading line enters the viewport; added and removed as scrolling proceeds.",
    "dom": "Same element as .vsidian-heading-line-{n} (a line-level modifier class).",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian has no in-viewport heading indicator class)"
    }
  },
  "live-heading-active": {
    "purpose": "Line background accent for the heading line under the cursor; the # heading markers are revealed when the cursor enters the line.",
    "states": "Added while the cursor is inside the heading range; removed as soon as it leaves.",
    "dom": "Same element as .vsidian-heading-line-{n}; background drawing is scoped by the inview class.",
    "obsidian": {
      "counterpart": "No direct counterpart (a vsidian-specific extension)"
    }
  },
  "inline-strong": {
    "purpose": "Entry point for bold content: a mark decoration span in live view; a semantic strong tag rendered by markdown-it in reading view.",
    "states": "In live view the ** markers are revealed when the cursor touches them and return to the formatted form when it leaves.",
    "dom": "Live: a mark span inside heading/body lines. Reading: a real <strong> element inside the block.",
    "obsidian": {
      "counterpart": ".cm-strong (live token) / .markdown-preview-view strong (reading tag)"
    }
  },
  "inline-emphasis": {
    "purpose": "Entry point for italic content: a mark decoration span in live view; a semantic em tag in reading view.",
    "states": "In live view the * / _ markers are revealed when the cursor touches them.",
    "dom": "Same two-view structure as inline-strong.",
    "obsidian": {
      "counterpart": ".cm-emphasis (live token) / .markdown-preview-view em (reading tag)"
    }
  },
  "inline-code": {
    "purpose": "Entry point for inline code content: a mark decoration span in live view; a semantic code tag in reading view.",
    "states": "In live view the backtick markers are revealed when the cursor touches them.",
    "dom": "Live: an inline mark span (multi-backtick fences match by their actual delimiter length). Reading: a <code> element inside the block.",
    "obsidian": {
      "counterpart": ".cm-inline-code (Obsidian also uses .cm-hmd-inline-code; this contract promises the former)"
    }
  },
  "inline-highlight": {
    "purpose": "Entry point for highlighted (==text==) content: the live span carries a persistent theme-colored background; reading view uses the mark tag. For the background variable see var-highlight-background.",
    "states": "In live view the == delimiters are revealed when the cursor touches them (same semantics as bold).",
    "dom": "Live: a mark decoration span. Reading: a <mark> element inside the block.",
    "obsidian": {
      "counterpart": ".cm-highlight (live token) / .markdown-preview-view mark"
    }
  },
  "inline-strikethrough": {
    "purpose": "Entry point for strikethrough (~~text~~) content: reading view only — a semantic del tag rendered by markdown-it. The live side parses the syntax but adds no decoration and shows the raw source (see limit-strikethrough-live).",
    "dom": "A <del> element inside the reading block. No live decoration class exists; not supported there.",
    "obsidian": {
      "counterpart": ".markdown-preview-view del (reading tag)"
    }
  },
  "html-comment": {
    "purpose": "Dimming entry point for HTML comments (#139): in live view the whole inline Comment / multi-line CommentBlock range (delimiters included) gets a mark decoration span rendered at low contrast by mixing 45% into the foreground (not hidden, not folded — readable and editable). In reading view comments are removed entirely before rendering (line breaks kept, no inline gap left), so nothing shows and there is no class to target.",
    "states": "The dimmed color is always visible in live view (no reveal-on-touch semantics — comments do not participate in the two-state toggle; Ctrl+/ is the only way to remove them).",
    "dom": "A mark decoration span inside the live container; node names follow Lezer observation (inline Comment / block CommentBlock — HTMLBlock is a real HTML block whose inner comments are unreachable).",
    "obsidian": {
      "counterpart": "Direction of .cm-comment (semantically equivalent in Obsidian, but the original name is not promised to match)"
    }
  },
  "block-id-mark": {
    "purpose": "Dimming entry point for block id markers (#163 acceptance feedback): in live view both forms — a trailing ` ^id` at end of line and a standalone `^id` line — get a whole-range mark decoration span (including the leading whitespace of the trailing form), rendered at low contrast by mixing 45% into the body foreground. The color transforms relative to the body color instead of anchoring to a fixed value, so custom font colors keep working; a single color-mix rule serves both dark and light themes; not hidden, not folded — readable and editable. In reading view the markers are stripped before rendering (blockIdStrip: trailing markers deleted, standalone lines deleted with their line breaks kept), so nothing shows and there is no class to target.",
    "states": "The dimmed color is always visible in live view (a block id is a structural marker with no cursor two-state toggle; copy block link lives in the context menu / keyboard shortcut).",
    "dom": "A mark decoration span inside the live container; markers inside fences do not match (code content), while a trailing marker on the closing fence line does match (the id of the fence block itself).",
    "obsidian": {
      "counterpart": "None (Obsidian hides block ids in reading view and dims them via built-in live styles, with no public class name)"
    }
  },
  "live-code-line": {
    "purpose": "Line class for live fenced/indented code lines (fence marker lines included); for the line class while cards are enabled see live-code-card-line in the chrome domain.",
    "dom": "A .cm-line line element inside the live container; matches line by line inside fences.",
    "obsidian": {
      "counterpart": ".HyperMD-codeblock (the Obsidian code block line class family)"
    }
  },
  "live-quote-line": {
    "purpose": "Line class for live quotes (the > prefix); quote content gets no extra spans (see limit-quote-span). For the 3px accent bar on the left edge see var-quote-bar-color (shared with the reading blockquote); left padding is calc(0.9em + 3px) — the layout slot left after the QuoteMark presentation is hidden — aligned with the reading blockquote.",
    "states": "The > marker at line start is only revealed near the marker and its adjacent spaces.",
    "dom": "A .cm-line line element inside the live container.",
    "obsidian": {
      "counterpart": ".HyperMD-quote (the Obsidian quote line class)"
    }
  },
  "live-hr-line": {
    "purpose": "Line-level class for live horizontal rules; since #106 the rendered state took over, and this class remains for coloring the raw-source state.",
    "states": "The source text is revealed while the cursor touches the line (the line class still matches).",
    "dom": "A .cm-line line element inside the live container.",
    "obsidian": {
      "counterpart": ".cm-hr (the Obsidian horizontal rule token class)"
    }
  },
  "live-hr-widget": {
    "purpose": "The rendered widget element for live horizontal rules (#106: the source text is hidden unless touched, and this element draws the actual rule as a centered gradient; its line box height equals the body line height, and its color shares the reading hr variable --vsidian-hr-color).",
    "states": "The widget is withdrawn and the source shown while the cursor touches the line.",
    "dom": "An inline element replacing the entire horizontal rule source text.",
    "obsidian": {
      "counterpart": "The rule-drawing side of .cm-hr (Obsidian draws through the same token class; vsidian splits this into a line class and a widget)"
    }
  },
  "live-frontmatter-line": {
    "purpose": "Line class for live frontmatter lines (the header block is shown as raw source; its syntax is not parsed).",
    "dom": "A .cm-line line element inside the live container; boundaries are determined by markdownDoc.frontmatterRange (shared by both views).",
    "obsidian": {
      "counterpart": ".cm-hmd-frontmatter (the Obsidian frontmatter class)"
    }
  },
  "live-list-line": {
    "purpose": "Line class for live list item lines; the -d{1..8} depth modifier is a vsidian-specific form (Obsidian expresses indentation through combinations of line classes).",
    "states": "The list marker at line start is only revealed near the marker and its adjacent spaces.",
    "dom": "A .cm-line line element inside the live container; combines with the bullet/ordered modifiers.",
    "obsidian": {
      "counterpart": ".HyperMD-list-line (the Obsidian list line class family)"
    }
  },
  "live-list-bullet": {
    "purpose": "Modifier for unordered list lines: once the source marker is hidden, a ::before bullet takes its place; the bullet glyph is graded by nesting depth (aligned with the reading-side marker semantics): level 1 filled disc, level 2 hollow circle, level 3 and deeper filled square — the hollow shape is reserved for second-level sublists (the previous all-filled rendering that disagreed with the reading view has been fixed). The reading side pins the same semantics with explicit list-style-type (disc/circle/square, no reliance on UA defaults).",
    "states": "Mutually exclusive with .vsidian-list-marker-visible (the pseudo-bullet is suppressed while the source marker is revealed); the depth grading combines with the -d{1..8} line classes.",
    "dom": "Live: a line-level modifier class on list lines, the bullet drawn on ::before; reading: the native li::marker.",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian relies on .cm-formatting-list hiding plus native list styles)"
    }
  },
  "live-list-ordered": {
    "purpose": "Modifier for ordered list lines (the numbering stays visible).",
    "dom": "A line-level modifier class on list lines.",
    "obsidian": {
      "counterpart": "No direct counterpart (same as live-list-bullet)"
    }
  },
  "live-list-marker-visible": {
    "purpose": "Suppresses the ::before pseudo-bullet while the unordered list source marker is revealed, avoiding a double bullet.",
    "states": "Added when the cursor enters the neighborhood of the marker.",
    "dom": "A line-level state modifier class on list lines.",
    "obsidian": {
      "counterpart": "No direct counterpart"
    }
  },
  "live-task-checkbox": {
    "purpose": "The live task checkbox (interactive: click / Enter / Space toggles the check and writes it back to Markdown); the checked state has two entry points: the :checked pseudo-class and the .vsidian-task-checked class.",
    "states": "Switches back to the raw source form while the cursor is inside the [ ]/[x] markers (the widget is withdrawn).",
    "dom": "An input widget replacing the task marker range.",
    "obsidian": {
      "counterpart": "Direction of .cm-task-* (Obsidian renders task markers through an HMR widget with no public stable class)"
    }
  },
  "live-table-line": {
    "purpose": "Line class for live table rows (shared by header/delimiter/data rows); pipes are shown only in the degraded source form or on the active delimiter row.",
    "dom": "A .cm-line line element inside the live container; combines with the header/delimiter modifiers.",
    "obsidian": {
      "counterpart": ".HyperMD-table-line (the Obsidian live table line class family)"
    }
  },
  "live-table-header-line": {
    "purpose": "Modifier for live table header rows.",
    "dom": "A line-level modifier class on table rows.",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian covers this through thead styles)"
    }
  },
  "live-table-delimiter-line": {
    "purpose": "Modifier for live table delimiter rows (the active delimiter row falls back to raw source display).",
    "states": "Switches to the raw source form while the cursor is on the delimiter row.",
    "dom": "A line-level modifier class on table rows.",
    "obsidian": {
      "counterpart": "No direct counterpart"
    }
  },
  "live-table-cell": {
    "purpose": "Content span for live table cells (the trimmed range); the GFM splitting semantics are implemented in-house (escaped \\| and | inside inline code do not split).",
    "dom": "A mark decoration span inside table rows; combines with the align modifiers.",
    "obsidian": {
      "counterpart": ".cm-table-cell (a direction commonly used by community themes, not an official Obsidian class)"
    }
  },
  "live-table-pipe": {
    "purpose": "Span for live table pipes (boundary pipes included); hidden in the grid state, visible in the source state.",
    "dom": "A mark decoration span inside table rows.",
    "obsidian": {
      "counterpart": "No counterpart (Obsidian hides pipes or shows them as-is)"
    }
  },
  "live-table-prefix": {
    "purpose": "Container prefix span for grid rows (#296 render-breakage fix): the prefix region of table rows inside quotes/lists (marker hiding range and the bare gap before the first pipe) is wrapped into this mark and excluded from grid placement via CSS display:none — leftover prefix DOM (the empty placeholder intrinsically produced by replace, and bare text nodes) becomes an occupying grid item that wraps cells onto a second row.",
    "states": "The mark steps aside while the cursor/selection touches the prefix region, so the prefix text becomes visible and editable (it then participates in the inline layout).",
    "dom": "A mark decoration span covering the container prefix range inside a grid row.",
    "obsidian": {
      "counterpart": "No counterpart (Obsidian exposes no public class for prefix handling of tables in containers)"
    }
  },
  "live-table-align": {
    "purpose": "Column alignment modifiers declared by the live delimiter row (applied to the trimmed content spans); the actual grid layout is handled by the grid-align classes.",
    "dom": "Span-level modifier classes on table cells.",
    "obsidian": {
      "counterpart": "No counterpart (alignment is handled by the rendered layout)"
    }
  },
  "live-table-grid-row": {
    "purpose": "The CSS grid row of safe tables; the active cell keeps the grid in place, and cells still map to their source ranges (not an independent table data model). Since #142 column widths are distributed by content proportion: the line decoration inlines a per-table column width plan (per column minmax(min(48px, equal share), content-proportion fr); all rows of a table share the same plan) which the grid rules consume, falling back to equal columns by count when the plan is missing. Snippet overrides of grid-template-columns through class rules still take precedence. #296 render-breakage fix: the generic grid row rule no longer declares padding/box-shadow that flatten quote line classes — table rows inside quotes restore the accent bar and content indent via the .vsidian-quote-line combination (matching plain quote lines); line-level leftovers outside cells (pipes, measurement buffers, prefixes, replace empty placeholders) are all excluded from grid placement.",
    "dom": "The grid row container inside table rows (CSS grid layout).",
    "states": "Table rows inside quotes/lists stack container line classes on top (accent bar, indent, bullet); the selected-row outline is covered separately by the row-selected rules.",
    "obsidian": {
      "counterpart": "The direction of the Obsidian live table grid (no precisely matching class)"
    }
  },
  "live-table-grid-cell": {
    "purpose": "Grid cells of safe tables; the grid is not withdrawn when the cursor enters a cell — typing goes straight into the source range of that cell (reusing CM6 IME, navigation and write-back).",
    "dom": "The cell element inside grid rows.",
    "obsidian": {
      "counterpart": "The direction of the Obsidian live table grid"
    }
  },
  "live-table-grid-delimiter": {
    "purpose": "Hides the delimiter row in the grid state.",
    "states": "The active delimiter row falls back to raw source.",
    "dom": "The delimiter row element inside grid rows.",
    "obsidian": {
      "counterpart": "The direction of Obsidian table alignment"
    }
  },
  "live-table-grid-align": {
    "purpose": "Column alignment in the grid state (since #142 applied to every cell in the column — the space placeholder widgets carry the alignment classes too).",
    "dom": "Cell-level modifier classes on grid cells.",
    "obsidian": {
      "counterpart": "The direction of Obsidian table alignment"
    }
  },
  "live-table-escaped-pipe": {
    "purpose": "Hides the backslash before escaped pipes in the grid; changes display only, never the Markdown source.",
    "dom": "A span inside grid cells.",
    "obsidian": {
      "counterpart": "No direct counterpart"
    }
  },
  "reading-block": {
    "purpose": "Base class for every content block inside the reading container; the anchor attributes hold LF whole-document UTF-16 offsets (isomorphic to the message protocol coordinates) and are relied on by on-demand mounting and task locating.",
    "dom": "A direct child of .vsidian-view-reading; blocks contain real semantic tags rendered by markdown-it.",
    "obsidian": {
      "counterpart": "No counterpart (the Obsidian reading view is a flat tag stream; vsidian wraps blocks in divs with inner tag structure)"
    }
  },
  "reading-heading": {
    "purpose": "Reading heading blocks; two entry points match (the block class and the inner tag).",
    "dom": "The block container holds a real h{n} element.",
    "obsidian": {
      "counterpart": ".markdown-preview-view h{1..6}"
    }
  },
  "reading-paragraph": {
    "purpose": "Reading paragraph blocks.",
    "dom": "The block container holds a real p element.",
    "obsidian": {
      "counterpart": ".markdown-preview-view p"
    }
  },
  "reading-blockquote": {
    "purpose": "Reading blockquote blocks. For the 3px accent bar on the left border see var-quote-bar-color (shared with the live quote line).",
    "dom": "The block container holds a real blockquote element.",
    "obsidian": {
      "counterpart": ".markdown-preview-view blockquote"
    }
  },
  "reading-list": {
    "purpose": "Reading list blocks (the nested structure is restored as one block).",
    "dom": "The block container holds a real ul/ol > li nesting.",
    "obsidian": {
      "counterpart": ".markdown-preview-view ul / ol / li"
    }
  },
  "reading-task": {
    "purpose": "Reading task list items (attached to the semantic li); extended data-task check states ([/], [!] etc.) are not supported.",
    "dom": "An li element inside the list block.",
    "obsidian": {
      "counterpart": ".markdown-preview-view .task-list-item"
    }
  },
  "reading-task-checkbox": {
    "purpose": "Reading task checkboxes (click / keyboard toggles and writes back).",
    "dom": "An input element inside the task li.",
    "obsidian": {
      "counterpart": ".markdown-preview-view .task-list-item input[type=\"checkbox\"]"
    }
  },
  "reading-code-block": {
    "purpose": "Reading fenced/indented code blocks (content excludes the fence marker text; large fences over 60 lines are split into multiple blocks line by line; for the card shell see reading-code-card in the chrome domain).",
    "dom": "The block container holds a real pre > code.",
    "obsidian": {
      "counterpart": ".markdown-preview-view pre"
    }
  },
  "reading-hr": {
    "purpose": "Reading horizontal rule blocks.",
    "dom": "The block container holds a real hr element.",
    "obsidian": {
      "counterpart": ".markdown-preview-view hr"
    }
  },
  "reading-table": {
    "purpose": "Reading table blocks (rendered by markdown-it, read-only presentation).",
    "dom": "The block container holds a real table element.",
    "obsidian": {
      "counterpart": ".markdown-preview-view table"
    }
  },
  "reading-frontmatter": {
    "purpose": "Reading frontmatter header block (shown as raw source; syntax inside the header is not parsed; boundary detection is shared by both views).",
    "dom": "A pre element inside the block container.",
    "obsidian": {
      "counterpart": ".markdown-preview-view .markdown-frontmatter"
    }
  },
  "reading-spacer": {
    "purpose": "Reading viewport placeholders: height reservations for off-screen blocks (not content nodes; the height is a prefix/suffix sum over the block height table). A vsidian-specific structure outside the compatibility promises; its presence in snippets does not affect content block targeting.",
    "dom": "Placeholder divs at the head/tail of the reading container.",
    "obsidian": {
      "counterpart": "No counterpart (Obsidian handles virtualization internally)"
    }
  },
  "live-link": {
    "purpose": "Content span for live links (always decorated; when the cursor or selection enters the range of a link, its [ and ](url) source is revealed while other links on the same line stay formatted); the hidden tail corresponds to the direction of .cm-formatting-link / .cm-string.cm-url in Obsidian — vsidian presents it by hiding, with no separate styling class.",
    "states": "The source is revealed while the cursor or selection is inside the link range.",
    "dom": "An inline mark decoration span in live view (indirect decoration: shown as raw source outside the viewport and applied once scrolled into it).",
    "obsidian": {
      "counterpart": ".cm-link (the Obsidian link content token)"
    }
  },
  "reading-link": {
    "purpose": "Reading links: a semantic <a> rendered by markdown-it (a single click reports the navigation intent through container delegation; no webview-native navigation).",
    "dom": "A real a element inside the reading block.",
    "obsidian": {
      "counterpart": ".markdown-preview-view a"
    }
  },
  "image-slot": {
    "purpose": "Base class of the image slot: in reading view it is the <img> element itself (Obsidian img tag selectors match naturally); in live view it is a widget container span (the inner img is loaded by the resource manager — a vsidian-specific form). Since #212 images outside links and tables carry the shared button group: the live slot span doubles as vsidian-graphic-frame (the vsidian-image class stays, slot semantics unchanged); reading imgs are wrapped by the same frame span (img is a void element and cannot have children).",
    "states": "Loading starts only when the slot enters the viewport; leaving the viewport unloads and releases it (src is cleared). Since #212 the button group appears in the loaded state (no buttons while error/loading — the error-state click-to-retry semantics stay), driven by sibling/descendant selectors on data-vsidian-img-state.",
    "dom": "Reading: img.vsidian-image inside the block (since #212 optionally wrapped by span.vsidian-graphic-frame.vsidian-image). Live: an inline widget span.vsidian-image > img (with the frame class added when the button group is attached; the group is a following sibling of the img).",
    "obsidian": {
      "counterpart": ".markdown-preview-view img (reading) / .cm-image (live direction; Obsidian has no public stable class)"
    }
  },
  "image-states": {
    "purpose": "The three image states: placeholder (alt text) / loaded (confirmed by the load event) / failed (click to retry, with a visible error outline).",
    "states": "loading → loaded / error; clicking in the error state retries.",
    "dom": "Element-level state modifier classes on the image slot.",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian has no public loading state classes)"
    }
  },
  "image-failure-variants": {
    "purpose": "Failure variants (#201): confirmed deletion (positive on-disk missing evidence, \"not found\") and inaccessibility (SSH disconnect / permission errors) never masquerade as each other — not found gets a faint red background, inaccessible a warning-yellow hint; kept in sync with data-vsidian-img-reason (not-found / inaccessible).",
    "states": "Only applied on top of the error base class; removed when a refresh succeeds (loaded) or the slot is released.",
    "dom": "Element-level failure-reason modifier classes on the image slot.",
    "obsidian": {
      "counterpart": "No counterpart (Obsidian has no deleted/inaccessible distinction classes)"
    }
  },
  "image-solo-block": {
    "purpose": "Block container variant for an image standing alone on its line: in live view, when the whole line holds a single image (all remaining text is whitespace, trailing whitespace included), the widget slot switches to block layout; since #212 the reading view carries the same semantics — when the image is the only element child of its paragraph and the surrounding sibling text is all whitespace, the mount hook wraps the frame and a JS check adds this class (the :only-child pseudo-class is not used — it only counts element children, so a \"text + image\" mixed paragraph would falsely match and force the image onto its own line). Block layout provides a definite width basis for sources without intrinsic dimensions (viewBox-only percentage-width SVGs, the mermaid export form) — such sources collapse to 0×0 under inline-block shrink-to-fit (the img loads successfully, so the failure is silent and shows as a blank line). Sources with intrinsic dimensions are unaffected (they still render at natural width under block layout). Known boundary: such SVGs mixed inline with other content (list prefixes, surrounding text, multiple images on one line) keep the inline form. Companion modifier vsidian-image-sized (effective only on the solo block form, added by the #212 button-alignment fix): once the image finishes loading and still renders narrower than the available line width (parent content width), markImageFrameSized adds it and the frame takes width:fit-content to shrink around the image — the button group (absolute top-right) then hugs the image corner instead of the line edge. Percentage-width SVGs and clamped large images (rendered width = line width) do not get it, so the block fill basis of the former (its collapse-fix semantics) is never fit-content-ed. The comparison denominator is the parent content width, not the current frame width (the latter negates itself after shrinking); no decision before load completes (percentage-width SVGs show a bogus naturalWidth before load — an early hit deadlocks into collapse); offscreen construction defers the first computation to a ResizeObserver once the frame gains layout.",
    "states": "Live: decided per line at decoration build time (same rule on the tree-driven and loose paths) — the line counts as solo when all text outside the image range is whitespace. Reading: decided by decorateImageChromeBlock when wrapping the frame (only element child plus all-whitespace sibling text). The three state modifier classes still stack on top. sized: attached only on the solo block form (live render callback gates on block+chrome, reading frame wrap on the block class — inline mixed, link-nested and table-grid images do not get it, no button-alignment need) — added when the image has loaded (load listener recomputes, converging after invalidate refetches) and renders narrower than the available line width, removed otherwise; removed immediately on error (the loaded→invalidated→refetch-failed chain restores the full-width error box and its retry target instead of a shrunken remnant); loading state shows no visual difference (the button group only appears in the loaded state).",
    "dom": "Live inline widget span.vsidian-image.vsidian-image-block > img; reading span.vsidian-graphic-frame.vsidian-image.vsidian-image-block > img (both display: block). With sized stacked, the same node also carries .vsidian-image-sized (width: fit-content).",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian has no public standalone-image layout class)"
    }
  },
  "live-wikilink": {
    "purpose": "Live wikilink presentation: outside the range it is a display-text widget (replacing the whole [[…]], with the alias class on both the widget wrapper and the source mark); inside the range it becomes the source mark. The split form of Obsidian (link name / alias / formatting brackets) has no split classes here.",
    "states": "The source is revealed while the cursor is inside the wikilink range.",
    "dom": "An inline widget or mark decoration in live view (indirect decoration, shown as raw source outside the viewport; not decorated inside fences, inline code or frontmatter).",
    "obsidian": {
      "counterpart": ".cm-hmd-internal-link (the Obsidian live internal link token class family)"
    }
  },
  "reading-wikilink": {
    "purpose": "Reading wikilinks: a semantic <a> rendered by the markdown-it wikilink rule (href is the raw target; the alias or link name is displayed; a single click reports the navigation intent).",
    "dom": "A real a element inside the reading block.",
    "obsidian": {
      "counterpart": ".markdown-preview-view a.internal-link (the Obsidian reading internal link class)"
    }
  },
  "anchor-flash": {
    "purpose": "Jump target highlight (#163 acceptance feedback): after an anchor jump through a wikilink or plain link (the view.locate channel), the target heading/paragraph is overlaid with a translucent yellow; it disappears on any user interaction (click, scroll, key press, switching away). Live applies a line-level decoration (each line of the target block), reading a block-level class (flashBlock, which survives remounting under virtualization) — the class name is identical across views, and the background color is exposed through the --vsidian-anchor-flash-background variable (a user-overridable CSS interface, see var-anchor-flash-background). Outline clicks do not flash (the target entry keeps its persistent highlight).",
    "states": "Appears after the jump locates the target and disappears on any user interaction (including switching modes or editing the document) — a transient hint with no persistent state.",
    "dom": "Live: .cm-line line elements (each line of the target block). Reading: the .vsidian-reading-block element.",
    "obsidian": {
      "counterpart": "None (the Obsidian built-in highlight animation has no public class name)"
    }
  },
  "var-anchor-flash-background": {
    "purpose": "The translucent yellow background of the jump target highlight (#163 acceptance feedback): a user-overridable CSS interface, referenced by both the live line-level rule and the reading block-level rule (defined once, effective in both views). Defaults to rgba(255, 213, 79, 0.25).",
    "dom": "Defined on #app.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "var-heading-color": {
    "purpose": "The heading level color variable family: referenced by live heading lines, reading heading blocks and outline entries alike (theme-graded coloring defined once, effective everywhere). Defaults to var(--vscode-editor-foreground).",
    "dom": "Defined on #app; the Obsidian aliases --h{1..6}-color take effect through the variable bridge (a vsidian-name override always takes strict precedence).",
    "obsidian": {
      "counterpart": "--h1-color ... --h6-color (the Obsidian per-level color variable family)"
    }
  },
  "var-reading-font-size": {
    "purpose": "The reading body font size; defaults to var(--vsidian-content-font-size) (follows the VSCode editor font size).",
    "dom": "Defined on the reading content layer; Obsidian alias --font-text-size.",
    "obsidian": {
      "counterpart": "--font-text-size"
    }
  },
  "var-reading-max-width": {
    "purpose": "The reading block max width (since #175 one of the readable line width pair — a single editor.readableLineWidth setting drives both modes while snippets can override either one separately); defaults to none = full width (the former invisible 760px cap was abolished with the #174 fix).",
    "dom": "Defined on the #app layer (since #175 at the same site as the live variable — the setting value is written inline on the mount root, and a former reading-layer definition would shadow it, hence the move); Obsidian alias --file-line-width.",
    "obsidian": {
      "counterpart": "--file-line-width"
    }
  },
  "var-live-preview-max-width": {
    "purpose": "The max width of the live content column (added in #175, sharing the setting value with the reading variable; when capped, the whole [line-number column + gap + content column] group is centered and the line-number column moves with it); defaults to none = full width.",
    "dom": "Defined on the #app layer; Obsidian alias --file-line-width (the same alias as the reading variable — Obsidian semantics are one global line width applied to both the editing and reading views).",
    "obsidian": {
      "counterpart": "--file-line-width"
    }
  },
  "var-reading-line-height": {
    "purpose": "The reading body line height; defaults to var(--vsidian-content-line-height).",
    "dom": "Defined on the reading content layer; Obsidian alias --line-height-normal.",
    "obsidian": {
      "counterpart": "--line-height-normal"
    }
  },
  "var-reading-code-background": {
    "purpose": "The code block background; defaults to var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12)).",
    "dom": "Defined on the reading code block layer; Obsidian alias --code-background.",
    "obsidian": {
      "counterpart": "--code-background"
    }
  },
  "var-highlight-background": {
    "purpose": "The highlight background: referenced by the live body span, the reading mark and outline entries alike. Dark theme defaults to rgba(255, 208, 0, 0.35); light theme overrides it with #ffe066 under body.vscode-light (two rounds of visual testing found the theme-variable contrast insufficient, so Obsidian-style fixed fluorescent yellow was adopted with per-theme tuning).",
    "dom": "Defined on #app (light branch under body.vscode-light); Obsidian alias --text-highlight-bg.",
    "obsidian": {
      "counterpart": "--text-highlight-bg"
    }
  },
  "var-quote-bar-color": {
    "purpose": "The quote accent bar color: referenced by the live quote line (the inset bar of .vsidian-quote-line) and the reading blockquote left border alike. A clearly accent purple: dark theme defaults to #a78bfa, light theme overrides it with #7c3aed under body.vscode-light; the background still uses --vscode-textBlockQuote-background (only the bar changes color — no purple background is added).",
    "dom": "Defined on #app (light branch under body.vscode-light); a vsidian-owned variable with no Obsidian alias.",
    "obsidian": {
      "counterpart": "None (the Obsidian quote bar is handled by theme border styles, with no public variable)"
    }
  },
  "var-table-background": {
    "purpose": "Background of the live header cells / the reading table header (th) / the frontmatter card title bar (since #213 data rows are transparent — the row background now uses --vsidian-table-row-background); defaults to rgba(128, 128, 128, 0.05).",
    "dom": "Defined on #app (centrally defined since #132; consumer sites previously carried inline fallbacks); Obsidian alias --table-background.",
    "obsidian": {
      "counterpart": "--table-background"
    }
  },
  "var-table-row-background": {
    "purpose": "Background of live table data rows and delimiter rows; defaults to transparent (blending into the editor background, aligned with the reading-side td). Header cell backgrounds are unaffected by this variable (they still use --vsidian-table-background).",
    "dom": "Defined on #app; consumed by the .vsidian-table-line line-level rule (shared by header/delimiter/data rows — the header cell-level background paints on top of it on header rows). Snippets override it by declaring on #app or any descendant — :root/body declarations are cut off by the #app-level definition.",
    "obsidian": {
      "counterpart": "None (Obsidian derives data-row backgrounds from the table-wide --table-background default plus the --table-row-alt-background zebra stripe — no single data-row variable exists, and --table-background is already bridged to --vsidian-table-background)"
    }
  },
  "var-heading-accent": {
    "purpose": "Formerly the left-edge accent color of in-viewport live headings; removed along with the #55 removal of the left-edge bar and no longer public. This entry is kept as the historical record of the deprecation/removal lifecycle.",
    "dom": "None (the variable is no longer defined or consumed).",
    "obsidian": {
      "counterpart": "None"
    },
    "removed": "Removed during the v0.2.x cycle with #55 (2026-09-25); at removal the variable was only used by an internal test snippet, so no user migration was needed."
  },
  "limit-hashtag": {
    "purpose": "Tag (#tag) syntax is not implemented: selectors match nothing in snippets (no errors, no effect).",
    "dom": "No tag nodes exist.",
    "obsidian": {
      "counterpart": ".cm-hashtag (live) / .tag (reading)"
    }
  },
  "limit-callout": {
    "purpose": "Callout syntax is not implemented; a later version will provide it.",
    "dom": "No callout structure exists.",
    "obsidian": {
      "counterpart": ".callout"
    }
  },
  "limit-task-extended-states": {
    "purpose": "Extended task check states are not supported: only space / x / X.",
    "dom": "The task checkbox has only two entry points: :checked and .vsidian-task-checked.",
    "obsidian": {
      "counterpart": ".task-list-item[data-task]"
    }
  },
  "limit-markdown-embed": {
    "purpose": "Partial boundary for embeds (![[…]]): a line-owning embed renders as the reference card in the reading view (#222) and mounts the same card in the live view with cursor-driven source reveal (#223) — see reading-embed-card / live-embed-widget. Since #244/#245, line-owning embeds expand recursively inside body cards and hover previews. Since #246, mixed-run lines (other content on the line) and list/blockquote containers upgrade to in-flow cards in the reading view — see reading-embed-mixed. Since #247, mixed-run lines and list/blockquote/task/lazy-continuation containers in the live view mount cards too, with the hidden form replacing only the exact embed range — surrounding text, list markers, task checkboxes, quote prefixes and existing indentation are preserved, see live-embed-widget. Since #248, table cells (header and data cells, with escaped-pipe alias forms decoded per in-cell semantics — the target/inner uses the decoded form while ranges stay on the raw source) upgrade to in-cell cards in both views. Link-label runs keep the raw source/placeholder in both views (a block-level card inside an inline link label would be an invalid presentation); writing into embedded content is not supported. Incomplete wikilink forms are shown as-is; blockquote blocks are already supported.",
    "dom": "Where no embed container applies: table cells and link-label runs in both views render the raw source or placeholder span (.vsidian-embed-slot, plain-text form); embed literals inside code (fenced/indented/inline) and comments are never parsed.",
    "obsidian": {
      "counterpart": ".markdown-embed"
    }
  },
  "limit-strikethrough-live": {
    "purpose": "Strikethrough is undecorated in live view: the parser supports it but no live decoration class exists and the raw source is shown; the reading-side del tag is available (see inline-strikethrough).",
    "dom": "No strikethrough span exists in live view.",
    "obsidian": {
      "counterpart": ".cm-strikethrough (live token) / the reading-side del is supported"
    }
  },
  "limit-quote-span": {
    "purpose": "Quote content gets no extra spans: live view only has the line-level .HyperMD-quote alias; the span-level .cm-quote token class of Obsidian is not promised.",
    "dom": "No content spans exist inside quote lines.",
    "obsidian": {
      "counterpart": ".cm-quote (span-level token)"
    }
  },
  "limit-is-unresolved": {
    "purpose": "Not implemented: the workspace is not queried for display, avoiding indexes/lookups introduced for styling. All wikilinks render in the same color.",
    "dom": "No unresolved modifier class exists.",
    "obsidian": {
      "counterpart": ".is-unresolved"
    }
  },
  "limit-reference-links-live": {
    "purpose": "Reference-style links/images: fully parsed by markdown-it in reading view (clickable); live view does not parse reference definitions and shows the raw source (Ctrl+click does not navigate) — a cross-view behavior difference.",
    "dom": "No reference-style link decoration exists in live view.",
    "obsidian": {
      "counterpart": "Obsidian parses them in both views"
    }
  },
  "limit-table-crossview": {
    "purpose": "markdown-it does not recognize | inside inline code: tables containing this form are split at wrong positions or degraded to paragraphs in reading view; live view splits correctly per the GFM spec (the deviation is recorded under \"Known limitations\" in docs/perf/2026-09-table-cell-editing.md).",
    "dom": "Reading tables are split by markdown-it.",
    "obsidian": {
      "counterpart": "Obsidian behaves consistently in both views"
    }
  },
  "limit-virtualization": {
    "purpose": "Blocks outside the reading viewport do not exist in the DOM: snippets relying on a persistent whole-document DOM (global :nth-child targeting, cross-screen sibling/descendant selectors, scrollbar calculations assuming the full content height) conflict with on-demand mounting. Blocks scrolled back into the viewport remount and inherit document-level styles.",
    "dom": "Off-screen areas are held by spacers (see reading-spacer).",
    "obsidian": {
      "counterpart": "Obsidian handles virtualization internally"
    }
  },
  "limit-find-hit-mask": {
    "purpose": "The replace decoration of the current match takes precedence over find highlights: when a hit falls inside a folded hidden marker (such as link syntax markers), the find highlight is not visible; match counting and stepping are unaffected (computed over the whole-document text model).",
    "dom": "The find highlight decoration layer and the syntax decoration layer stack.",
    "obsidian": {
      "counterpart": "—"
    }
  },
  "live-math": {
    "purpose": "The stable container of the rendered math state: in live view the outer wrapper of the inline widget; in reading view the KaTeX outer span/p (containing the KaTeX .katex structure); color inherits the editor foreground. Obsidian splits the .cm-math-begin/end delimiter classes; this project replaces the range as a whole and has no split classes.",
    "states": "In live view the source is revealed while the cursor is inside the math range (see live-math-source).",
    "dom": "Live: an inline replacement widget; reading: an inline span or a block-level p.katex-block (the KaTeX HTML is produced by KaTeX).",
    "obsidian": {
      "counterpart": ".cm-math (the Obsidian live math token)"
    }
  },
  "live-math-block": {
    "purpose": "The rendered-state variant of block math ($$…$$ / \\begin{align} etc.): its own block, centered, horizontally scrollable. Emitted on both sides — the live widget and the reading p.katex-block (attached alongside .vsidian-math).",
    "dom": "Live: a block-level replacement widget; reading: p.katex-block (vsidian-math and this class are attached together).",
    "obsidian": {
      "counterpart": "The direction of .HyperMD-math (block math lines)"
    }
  },
  "live-math-source": {
    "purpose": "The source-revealing mark shown while the cursor is inside the math range (monospace coloring + a light background).",
    "states": "While the cursor is inside the math range.",
    "dom": "A live mark decoration.",
    "obsidian": {
      "counterpart": "The editing-state direction of .cm-hmd-math-begin"
    }
  },
  "reading-math-block": {
    "purpose": "The reading math block (rendered by markdown-it-katex; rendered on mount, released on unmount, height filled back in by a ResizeObserver); the math container inside the block is p.katex-block (vsidian-math / -math-block attached on top of it).",
    "dom": "Inside the reading block container, a <p class=\"katex-block\"> wrapping .katex-display.",
    "obsidian": {
      "counterpart": ".markdown-preview-view .math-block"
    }
  },
  "math-error": {
    "purpose": "The raw-source fallback span for math that fails to parse: error color + light red background + monospace font, with the original text fully readable (shared by both views; the title attribute carries the original text for hover checking).",
    "dom": "Live: a replacement widget span; reading: a span (inline) / p.katex-block>code (block).",
    "obsidian": {
      "counterpart": "The direction of .math-error / .katex-error"
    }
  },
  "mermaid-container": {
    "purpose": "The rendering container of a mermaid fence (shared by the live widget inner layer and the reading fence container; carries the data-vsidian-mermaid-code source and the data-vsidian-mermaid-state state loading/rendered/error).",
    "dom": "Live: the inner layer of the vsidian-graphic-frame widget; reading: inside the vsidian-reading-mermaid block. The rendering container holds the mermaid SVG (in the rendered state).",
    "obsidian": {
      "counterpart": ".mermaid (the diagram container of the Obsidian reading rendering)"
    }
  },
  "mermaid-svg": {
    "purpose": "The SVG produced by mermaid itself (width constrained by the container, height scaled proportionally). Nodes inside the SVG are private DOM of the third-party renderer and are not promised stable (see limit-mermaid-internals).",
    "dom": "An SVG inside the rendering container.",
    "obsidian": {
      "counterpart": ".mermaid svg"
    }
  },
  "reading-mermaid-block": {
    "purpose": "The block element class for a reading mermaid fence rendered as one whole block (exempt from the 60-line large-fence splitting; rendered on mount, released with the block on unmount); the .vsidian-mermaid rendering container lives inside the block.",
    "dom": "A reading block-level container.",
    "obsidian": {
      "counterpart": "The direction of .markdown-preview-view .mermaid"
    }
  },
  "mermaid-error": {
    "purpose": "The fallback state for mermaid syntax/render failures: the error message and the source stay readable, and the fence remains editable when the cursor enters (shared by both views).",
    "dom": "The message and source areas inside the error container.",
    "obsidian": {
      "counterpart": "The direction of the .mermaid error"
    }
  },
  "graphic-chrome": {
    "purpose": "The positioning wrapper of graphic code blocks (fences rendered as graphics) and its top-right button group: edit enters source editing (live preview only), popup opens the diagram popup; the group hover show/hide is CSS-driven (an opacity toggle; the DOM stays present in the rendered-success state). Since #212 Markdown images reuse the same button group and interaction contract (edit+popup on live / popup-only on reading; the image body swallows clicks to prevent accidental edits); images inside links or table grids do not carry it (explicitly out of scope). The button background is a two-layer composite (a solid-color gradient layer of the theme face + a solid editor-background underlay; editorWidget-background at rest, button-secondaryBackground on hover): theme variables may be translucent (glass-style themes), and with the buttons floating directly over mottled content such as images a translucent face lets the content color bleed through; the solid underlay keeps the face opaque under any theme, while solid theme values are fully covered by the gradient layer with no visual change.",
    "states": "The button group shows in the rendered-success state (error fallback blocks do not emit it); the edit button is assembled only on the live preview side. Image form: shown in the loaded state (driven by sibling/descendant selectors on data-vsidian-img-state); frame.vsidian-image takes an inline layout (inline mixed flow is not broken).",
    "dom": "Live: the frame around the fence widget; reading: the frame around the mermaid/graphic container. Image form: the live slot span doubles as the frame (vsidian-image added); reading imgs are wrapped by an inline frame span. The button group is absolutely positioned at the frame's top right.",
    "obsidian": {
      "counterpart": "None (Obsidian diagram blocks have no public button-group structure)"
    }
  },
  "diagram-popup": {
    "purpose": "The fullscreen overlay of the diagram popup (#111): backdrop + stage (the diagram body being zoomed/panned) + toolbar (zoom/reset/refresh/export/close); the error state keeps close and refresh; note is the notice bar shown when the environment does not support PNG rasterization. Attached to document.body and present only while the popup is open. Since #212 the image popup (view/zoom/pan/refresh/save a copy of the original image) reuses the same class family and overlay skeleton: the content is an <img> (transform-based zoom), -export-image is the image-side export button (disabled for remote images with a hover hint on a wrapper span), a mutually exclusive singleton with the diagram popup.",
    "states": "Present while opened via the popup button; dismissed by Esc, clicking the empty area or the close button.",
    "dom": "A direct child of body — the overlay (backdrop/stage/toolbar areas).",
    "obsidian": {
      "counterpart": "None (Obsidian opens diagrams in a new tab)"
    }
  },
  "outline-item": {
    "purpose": "An outline entry (the level class doubles as the indentation and level-color entry); entries are pinned to regular weight 400 and do not inherit heading-level bolding; the level colors reference the same --vsidian-heading-color-{1..6} as body headings (one source across the three sides, see var-heading-color).",
    "dom": "The entry container of the outline panel in the right sidebar.",
    "obsidian": {
      "counterpart": "None (the Obsidian outline is app-level DOM)"
    }
  },
  "outline-inline-marks": {
    "purpose": "Inline mark passthrough for outline entries (a second class-name entry on the semantic strong/em/code/del/mark elements): weight/italic/monospace/strikethrough/highlight background are triggered only by explicit markers; wikilinks/links are plain text (no a, not clickable).",
    "dom": "Semantic inline elements inside outline entries.",
    "obsidian": {
      "counterpart": "None (the Obsidian-side outline plugin DOM is private)"
    }
  },
  "outline-guide": {
    "purpose": "Level-alignment guide lines (absolutely positioned vertical lines inside entries; left aligns with the center of the ancestor chevron — a visual alignment aid for nesting levels).",
    "dom": "An absolutely positioned span inside entries with nesting levels.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-located": {
    "purpose": "The persistent highlight bar of the current section's entry (semi-transparent background; the class toggle is the only source of the two-state difference); applied to the visible representative (the first visible ancestor when the target is hidden by collapse).",
    "states": "Follows the cursor position.",
    "dom": "The outline entry container.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-slider": {
    "purpose": "The collapse slider row (its only show/hide switch is the outline-active class on the sidebar container; ::before draws the through line; the six-button role=group group is keyboard accessible).",
    "dom": "Between the sidebar top bar and the entry list.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-slider-dot": {
    "purpose": "The six-step collapse dots: idle beads are hollow (transparent fill + outlined ring) and the current bead is solid — the active class rule is the only source of the two-state difference; since #99 the beads along the way to the current step (filled) are solid in the same state; the solid color follows --vscode-button-background.",
    "dom": "Buttons inside the slider row.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-chevron": {
    "purpose": "The collapse chevron button (entries with children) / an equal-width placeholder for childless entries (keeping text left edges aligned); the stroke width is not written on SVG attributes; clicking the arrow collapses/expands while clicking the text still jumps.",
    "dom": "Button/placeholder elements inside entries.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-collapsed": {
    "purpose": "A parent entry in the collapsed state (the arrow rotated -90° to point right is the only source of the two-state difference).",
    "states": "Collapsed state.",
    "dom": "The entry container.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-hidden": {
    "purpose": "Entries hidden by collapse (display:none; the class toggle is the only show/hide switch; the DOM is kept to preserve index order); since #68 search filtering hides entries with the same class.",
    "states": "Hidden by collapse or filtered out by search.",
    "dom": "The entry container.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-toolbar": {
    "purpose": "The outline toolbar row (jump to end, reset, search box; the outline-active class is the only show/hide switch).",
    "dom": "Between the sidebar top bar and the slider row.",
    "obsidian": {
      "counterpart": "None (the Quiet Outline function bar is plugin-private DOM)"
    }
  },
  "outline-toolbar-buttons": {
    "purpose": "The toolbar icon buttons (jump to the end of the note / the three-in-one reset — clearing the search, resetting the level and clearing manual collapse), sharing the shape of the sidebar top bar buttons (the base form is carried by the .vsidian-outline-toolbar button structural selector; this class name is the behavior anchor and snippet entry).",
    "dom": "Buttons inside the toolbar.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-search": {
    "purpose": "The heading search input (flex-fills the remaining width; colors come from the --vscode-input-* variable family).",
    "dom": "The input inside the toolbar.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-search-hit": {
    "purpose": "Search hit fragment highlights (wrapping only the matched substring; the background follows --vscode-editor-findMatchHighlightBackground, the same visual language family as body find hits); split at the text layer, orthogonal to the semantic elements.",
    "states": "On entries with hits.",
    "dom": "A mark element inside the entry.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-nomatch": {
    "purpose": "The no-match placeholder (readable feedback when a query has zero hits).",
    "states": "The search has zero hits.",
    "dom": "At the end of the entry list.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-menu": {
    "purpose": "The context-menu overlay (absolutely positioned inside the sidebar; menu items are keyboard-accessible buttons; the submenu's only show/hide switch is the parent item host's :hover/:focus-within; danger marks delete in red; colors follow the --vscode-menu-* variable family). Since #183 it is assembled through the unified menu kernel (descriptor-driven, class names unchanged); the shared state classes vsidian-menu-open (the parent-item click fallback that pins the submenu open) and vsidian-menu-flip (the submenu flips left at assembly time when the right edge would clip) layer on top of the existing submenu classes.",
    "states": "Summoned by right-click.",
    "dom": "An overlay inside the sidebar.",
    "obsidian": {
      "counterpart": "None (the VSCode native context menu lives at the host level)"
    }
  },
  "outline-rename-input": {
    "purpose": "The rename inline-editing input (the entry content area is replaced by an input; the text being edited includes inline markers); the three VSCode input variables (foreground/background/border).",
    "states": "Rename state.",
    "dom": "An input inside the entry.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-dragging": {
    "purpose": "The source entry being dragged (whole-element translucent weakening; the class toggle is the only source of the two-state difference).",
    "states": "While being dragged.",
    "dom": "The entry container.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-drop-edge": {
    "purpose": "The insertion lines on the drop target's top/bottom edges (inset box-shadow takes no layout space and does not conflict with the located background; the color follows --vscode-focusBorder).",
    "states": "While a drag hovers over the target.",
    "dom": "The target entry container.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "outline-drop-inside": {
    "purpose": "The drop-target wrapping highlight (an outline inset by one ring + a semi-transparent background, same variable family as located — the visual distinction for \"drop inside to become a child heading\").",
    "states": "While a drag hovers over the middle of the target.",
    "dom": "The target entry container.",
    "obsidian": {
      "counterpart": "None"
    }
  },
  "live-code-card-line": {
    "purpose": "Card lines carry the background on live source lines, including fence lines, and reading code-line spans. Live code ranges also carry .vsidian-code-selection: with drawSelection enabled, the text layer paints focused or inactive selection colors above opaque code backgrounds. With multicursor disabled, native selection rendering remains in use.",
    "states": "Card lines persist; .vsidian-code-selection is emitted only where nonempty live selections intersect fenced code, including multiple ranges. Text-layer painting is gated by .cm-editor:has(.cm-selectionLayer).",
    "dom": "Live: .cm-line elements in card-enabled fences, with span.vsidian-code-selection around selected code text; reading: span.vsidian-reading-code-line inside code.",
    "obsidian": {
      "counterpart": ".HyperMD-codeblock (the line family; the content-domain alias is attached to .vsidian-code-line, and the card line class is a vsidian-specific extension)"
    }
  },
  "live-code-card-edge": {
    "purpose": "Corner rounding modifiers for the first/last card lines (the bottom corners where no header covers them; the top corners are carried by the header band). Emitted on the live side only; reading card corners are carried by .vsidian-reading-code-card.",
    "dom": "The card's first/last line elements.",
    "obsidian": {
      "counterpart": "No counterpart (corners are handled by the Obsidian native code block styles)"
    }
  },
  "live-code-card-header": {
    "purpose": "The card header band: the language label + the button area on the right, with a bottom 1px separator (the look references the Code Styler plugin direction; the structure is vsidian-specific).",
    "dom": "The band above the card's first line (a live block widget / the reading block's first child).",
    "obsidian": {
      "counterpart": ".code-styler-header-container (the Code Styler plugin direction)"
    }
  },
  "live-code-card-header-parts": {
    "purpose": "The card language label (capitalized display name) / the button container / the language badge (the #83 colored-glyph badge, mounted inside the label).",
    "dom": "Inside the header band.",
    "obsidian": {
      "counterpart": "The direction of .code-styler-header-title"
    }
  },
  "live-code-card-copy": {
    "purpose": "The copy button (through the host clipboard API); -done is the ✓ feedback state for about 1.2s after the click.",
    "states": "-done lasts about 1.2s after copying; the button is not emitted in the collapsed state.",
    "dom": "The header button area.",
    "obsidian": {
      "counterpart": "button.copy-code-button (the Obsidian native copy button)"
    }
  },
  "live-code-card-fold": {
    "purpose": "The fold chevron; -collapsed is the collapsed state (rotated); folding is a view state and never writes to the source file (the reading-side collapse additionally has the block-level vsidian-code-card-folded modifier, see reading-code-card).",
    "states": "Collapse/expand.",
    "dom": "The header button area.",
    "obsidian": {
      "counterpart": ".code-styler-header-container::after (the fold arrow direction)"
    }
  },
  "live-code-card-wrap": {
    "purpose": "The word-wrap toggle (#191): one click toggles auto word wrap for all reading-view code blocks at once — on is the current pre-wrap wrapping, off makes the code area scroll horizontally (the line-number column sticks to the left edge, the header stays fixed); -off is the wrapped-off modifier (weakened via filter: opacity(0.4), orthogonal to the show/hide opacity). Reading-card header only: live view always wraps (CM6 wrapping is an editor-level facet and cannot be turned off per block). A view state, not persisted and with no setting (same semantics as the fold chevron).",
    "states": "Wrapping on (default) / off (-off, the title offers to turn it back on); revealed on card hover like the copy button (hidden by default); not emitted in the collapsed state.",
    "dom": "The leftmost slot of the header button area ([wrap] [copy] [fold]).",
    "obsidian": {
      "counterpart": "No counterpart (Obsidian code blocks have no per-block wrap toggle)"
    }
  },
  "live-code-card-linenumber": {
    "purpose": "In-card line numbers (each block starts at 1, fence lines take no number; numbering continues across the split chunks of a large fence); a line-start widget in live view and a line span in reading view (same class name); coexists with the document line-number gutter (source file line numbers) as two separate columns that do not overlap.",
    "dom": "At the start of the card's code lines (a live widget / a reading span).",
    "obsidian": {
      "counterpart": ".code-styler-line-number (direction)"
    }
  },
  "tok-tokens": {
    "purpose": "Syntax highlight token spans; both views share the same class names and dark/light palettes (colors taken from Dark+/Light+, not Obsidian theme variables); the Prism original names .token-* are not provided (see limit-prism-tokens).",
    "dom": "Token spans inside code content (a live mark decoration / reading in-card line spans).",
    "obsidian": {
      "counterpart": ".token-* (the Prism vocabulary direction) / the .cm-* token family"
    }
  },
  "reading-code-card": {
    "purpose": "The reading view card container (the card shell of vsidian-reading-code-block); the language-x class stays on code for routing; the line structure span.vsidian-reading-code-line carries line numbers and tokens; the collapsed block-level modifier hides the pre (the header is kept).",
    "dom": "The reading code block shell (discarded with the DOM when the block unmounts; rebuilt idempotently from the source snapshot on remount).",
    "obsidian": {
      "counterpart": ".markdown-preview-view pre (the original mapping is kept in the content domain)"
    }
  },
  "var-code-card-background": {
    "purpose": "The code block card background (shared by the header band and the code area; the reading card uses the same source); defaults to var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12)).",
    "dom": "Defined on #app.",
    "obsidian": {
      "counterpart": "--code-background (semantic correspondence; the alias bridge for the content code block variable is promised only to var-reading-code-background)"
    }
  },
  "live-fm-card-line": {
    "purpose": "Line-level class of the read-only frontmatter table card: when a legal simple header block (scalars + string arrays) is well-formed, it covers every line of the header block (including the opening/closing fence lines and stray lines) and carries the left/right border lines (the row area stays transparent — the contrasting boundary feel comes from the card border and the slightly brighter header strip); the opening/closing fence lines add horizontal rules and corner rounding, assembling a full bordered rounded card. When collapsed, the key-value/item/stray lines together with the closing line are hidden as a whole, and the first line instead carries the -folded modifier to double as the card bottom edge (adding the bottom border and four-corner rounding). Card lines also carry vsidian-frontmatter-line (the alias bridge promises at the direct level that .cm-hmd-frontmatter keeps matching in the well-formed shape; its transparency-lowering side effect is reset by the card rules). Complex types / parse failures degrade the whole card back to the frontmatter-line raw-source shape (see limit-fm-complex-types).",
    "states": "Persistent card (independent of cursor position — the well-formed state never exposes the raw source, and a cursor entering the header area is guided to just after the closing line); cells are not click-to-edit — editing is funneled into the Popover opened by the header bar Edit button; folding is a view state (zero write-back, not persisted across sessions — a reopened document starts expanded, the same semantics as the code card fold).",
    "dom": "A .cm-line line element in the live view (header block lines).",
    "obsidian": {
      "counterpart": ".metadata-container (the Obsidian properties panel direction; the table card shape is vsidian-specific)"
    }
  },
  "live-fm-row": {
    "purpose": "Key-value rows of the read-only table card (a two-column grid: key column / value column): no cell borders and no row separators (the row area stays transparent — the contrasting boundary feel comes from the card border and the slightly brighter header strip); the row-level grid spans the full content area (**no width cap** — capping it would misalign the row-level borders with the header row and leave a hole on the right); array host rows carry the list-row modifier (the key type icon takes the list shape ≡) and array item rows carry the item-row modifier (the key column is a dimmed `- ` marker placeholder). The reading side renders the same table rows under the same names (inside the .vsidian-fm-table container, full-width and transparent under the same convention).",
    "dom": "Live: .cm-line line elements (grid rows); reading: divs inside .vsidian-fm-table.",
    "obsidian": {
      "counterpart": ".metadata-property (the Obsidian property row direction; the DOM structure differs)"
    }
  },
  "live-fm-cell": {
    "purpose": "Cell marks: keys and values (array item text included) map to cells over their source ranges with read-only coloring (cells are not click-to-edit); the key column uses a regular font weight + muted gray (opacity 0.7 — in the reference mock the key is lighter and the value darker) + a leading type icon (::before: scalar T, list shape ≡ for array host rows); sep (the colon and structural spaces) and comment (inline comments) are hidden in the paint layer (display:none, occupying no cell slot); item-mark is a dimmed placeholder in the key column; standalone comment lines are dimmed as a whole line inside the card.",
    "dom": "Live: cell mark spans (source ranges); reading: spans (item-mark/sep/comment are live-only hiding classes).",
    "obsidian": {
      "counterpart": ".metadata-property-key / -value (direction)"
    }
  },
  "live-fm-header": {
    "purpose": "The card header bar (a replace widget on the opening fence line): a slightly brighter background strip (creating the contrasting boundary feel against the transparent row area) + a list icon + a Properties title (600 weight, secondary-foreground gray) + a rounded outlined Edit button at the top right (pencil icon, highlighted on hover/focus) + a fold chevron at the far right (the same interaction as the code card: the whole header bar is the fold hotspot, excluding the buttons themselves). The cm-widgetBuffers before and after the inline replacement are hidden (the cursor parking spots of the inline replace each take one line of text height, and in the well-formed state the cursor never enters the header area so there are no consumers), pulling the header row height down to about 1.2x the body line height. The Edit button toggles the property-editing Popover; a Popover left open closes automatically when the card is collapsed. The reading side renders the same container, class names and layout (read-only, the Edit button is not emitted; the fold chevron and hotspot are attached by the mount-time decoration).",
    "states": "The header bar is persistent in both views; the Edit button exists only in live and is not emitted while collapsed (the editing entry gives way with the table, the same convention as the code card not emitting the copy button when collapsed); the fold chevron is persistent in both states (rotated -90 when collapsed).",
    "dom": "Live: the content of the replace widget on the opening fence line; reading: the first child of .vsidian-fm-table.",
    "obsidian": {
      "counterpart": ".metadata-container heading (direction)"
    }
  },
  "live-fm-popover": {
    "purpose": "The property-editing Popover: a small floating layer positioned next to the Edit button (attached to body, fixed positioning computed by JS) with a white background, 10px rounded corners and a distinct shadow; structured editing rows (key/value inputs + a remove button, indented array item input rows, an add-item entry) and a primary Add property button at the bottom right (solid fill in the theme accent color). Focused inputs get a focusBorder outline; invalid key names get a red border marker.",
    "states": "An interaction-state floating layer (mounted while open, auto-closed by Esc / outside click / degradation) — the container itself is not part of the static probes; open/close and write-back are verified behaviorally by the browser suite; the style entry point (a single low-specificity class) is public for snippet overrides.",
    "dom": "Attached directly to document.body (outside #app, so the rules carry no #app prefix).",
    "obsidian": {
      "counterpart": ".metadata-property-editor (the Obsidian property editor overlay direction)"
    }
  },
  "live-fm-fold": {
    "purpose": "The fold chevron (the same interaction as the code card fold: a top-right fold button + the whole header bar as the hotspot): clicking collapses/expands the key-value row area — on the live side the block is hidden as a whole (the header line doubles as the card bottom edge), on the reading side the table row area is hidden as a whole (the table shell keeps its border and rounding). Folding is a view state: it never writes the source file and is not persisted across sessions (a reopened document starts expanded); live and reading each hold their own fold state, not shared (the same convention as the code card).",
    "states": "Collapsed/expanded (chevron rotated); while collapsed live does not emit the Edit button and reading rows are display:none.",
    "dom": "The rightmost slot of the header button area (to the right of the Edit button).",
    "obsidian": {
      "counterpart": "The .metadata-container header collapse direction (the Obsidian properties panel is collapsible)"
    }
  },
  "limit-fm-complex-types": {
    "purpose": "A boundary of what is supported: the first-version table covers only scalars (strings/numbers/booleans/date strings) and string arrays (block `- item` line groups + single-line flow `[a, b]`; on the live side block items and the flow value box are edited in the Popover, and the reading side renders items split out); complex types and parse failures degrade the whole card to the raw-source shape (the .vsidian-frontmatter-line line class in live, the .vsidian-reading-frontmatter-text escaped block in reading) with editing unrestricted, and the card becomes well-formed again automatically once the header returns to a simple shape; an open Popover closes automatically at the moment of degradation.",
    "dom": "The degraded lines/block (within the frontmatter boundaries).",
    "obsidian": {
      "counterpart": "The Obsidian properties panel shows complex types as source / restricted editing"
    }
  },
  "limit-prism-tokens": {
    "purpose": "Syntax highlighting is provided through the stable tok-* vocabulary (see tok-tokens); the Prism original names and the .HyperMD-codeblock-* subclasses are not provided, and snippets targeting them by their original names match nothing.",
    "dom": "Token spans use the tok-* class names.",
    "obsidian": {
      "counterpart": ".token-* / .HyperMD-codeblock-*"
    }
  },
  "limit-katex-internals": {
    "purpose": "A compatibility boundary of internal rendering structures: the internal DOM produced by KaTeX (glyph spans, the MathML layer, etc.) changes with upstream versions and is not promised as a stable interface — only the stable container shells (.vsidian-math / .vsidian-math-block / .katex-block) are public; snippet coloring that depends on internal classes may stop working after upgrades.",
    "dom": "The KaTeX HTML sits inside the stable containers.",
    "obsidian": {
      "counterpart": "Obsidian likewise does not promise KaTeX internal structures"
    }
  },
  "limit-mermaid-internals": {
    "purpose": "A compatibility boundary of internal rendering structures: the internal node classes of the SVG produced by Mermaid change with upstream versions and themes and are not promised as a stable interface — only the container-level entries (.vsidian-mermaid and its svg descendants) are public; the SVG inside the popup shares the same source and boundary. To restyle the inside of a diagram, use mermaid theme configuration instead of snippet selectors.",
    "dom": "The mermaid SVG sits inside the stable container.",
    "obsidian": {
      "counterpart": "Obsidian likewise does not promise mermaid internal structures"
    }
  },
  "suspend-banner": {
    "purpose": "The write-back conflict suspension banner (vsidian-specific UI): a top-of-view notice while paused + a resume button.",
    "states": "While a write-back conflict has paused writing back.",
    "dom": "A banner at the top of #app.",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "toolbar": {
    "purpose": "The top toolbar of the main editing area: the settings gear (.vsidian-settings-toggle), the quick-action toggle (.vsidian-quick-toggle), the refresh-embedded-resources button (.vsidian-refresh-toggle, the fifth button since #208 with its own entry), the dual-state view toggle (.vsidian-view-toggle, the fourth button since #141 with its own entry) and the sidebar toggle (.vsidian-sidebar-toggle) — since #38 the three-state switch (including source mode) lives in the host editor title bar commands, not on this toolbar (see the mode-toggle removal record).",
    "dom": "The toolbar at the top of #app.",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "view-toggle": {
    "purpose": "The dual-state view toggle button (#141): one of the entries for switching between live↔reading (the in-webview entry besides the host title bar three-state command and Ctrl+Q). The icons show the current mode: a book (currently reading) / a pen (currently live) — both icons stay in the DOM permanently, and their show/hide has a single source: the body mode class rules (see the mode-body entry) — when styles fail, both icons show at once, which paint assertions can expose.",
    "states": "The button itself is persistent in both modes; a click posts a view.switch.request outbound (not applied locally), and the button state is driven by the view.mode.set flowed back from the host — the aria/tooltip names the target action and re-words as the mode changes.",
    "dom": "A button inside the top .vsidian-toolbar, immediately to the left of the sidebar toggle; since #158 it forms the right-end group with the sidebar toggle, and since #208 the refresh button joins the group and takes over the margin-left:auto push rule (this button no longer holds it — see the toolbar-refresh entry for the handover record); a flexible gap remains toward the left group (settings, quick actions); an inline SVG with two paths (book/edit subclasses).",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "toolbar-refresh": {
    "purpose": "The refresh-embedded-resources button (#208): the manual refresh entry — a click posts a refresh.request outbound; the host drops the image resolution cache, bumps the resource generation and replies with the invalidation notice, after which the webview remounts every active image slot for re-resolution (reloading with the new-generation URI) and resets the Mermaid lazy-load failure terminal state. Refreshing never touches the document content/undo stack/view state (cursor, scroll and mode stay as they were), and the keybinding entry shares the same send implementation.",
    "states": "Persistent in both modes; before readiness (before init) a click is a no-op. The #158 push rule (margin-left:auto) moved from view-toggle to this button in #208 — head of the right-end group (refresh + dual-state toggle + sidebar toggle, adjacent), with a flexible gap toward the left group.",
    "dom": "A button inside the top .vsidian-toolbar, immediately to the left of the dual-state view toggle; an inline SVG circular arrow (lucide refresh-cw motif, four paths, constant stroke-width=2, no icon library).",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "skeleton": {
    "purpose": "Loading skeleton overlay for the editor initial open (#292): rendered with the initial HTML immediately, covering both the script-load and content-ready windows; after mount it is re-parented as an overlay inside the main editor area below the toolbar, and removed after the first content frame following the shimmer cycle-completion rule. Default background follows the editor background variable; the skeleton never intercepts pointer events.",
    "states": "Present only during the load window: covers #app fully before mount, content area only after mount (the host class .vsidian-skeleton-host provides the positioning context and is removed on dismissal); gone after removal.",
    "dom": "Direct child of #app in the initial HTML (single instance, stable id vsidian-skeleton); after mount moved to the end of .vsidian-main (vsidian-skeleton-host state) — never inside a view container (the reading virtualizer manages container children per block, see docs/specs/skeleton-screen.md).",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "skeleton-block": {
    "purpose": "Skeleton gray bars and shimmer animation (#292): a generic fixed form (no document content is read, no line-number gutter simulated); both the bar fill and the shimmer highlight derive from the editor foreground color via low-ratio color-mix (adapts to light/dark themes); the shimmer starts after a start delay and loops, and removal waits for the current cycle to finish — delay/cycle constants are shared with the exit planner (shared/skeletonTiming).",
    "states": "The shimmer is disabled under prefers-reduced-motion: reduce (static bars); it starts only after the start delay (default 300ms), so instantly-loaded documents never show it.",
    "dom": "Direct div sequence of .vsidian-skeleton > .vsidian-skeleton-column; the column width consumes --vsidian-live-preview-max-width (same source as the content column; full-bleed at the 0 setting), with horizontal padding sharing the content baseline variable (--vsidian-content-padding-inline).",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "skeleton-column": {
    "purpose": "Skeleton column box (#292): hosts the skeleton bar sequence; its max-width consumes --vsidian-live-preview-max-width (same source as the content column, no copied values) and its horizontal padding shares the content baseline variable (--vsidian-content-padding-inline) — the customization point for user snippets targeting the loading-time column width.",
    "states": "Present only during the load window, gone after removal; at the full-bleed setting (0) it fills the available width as the variable falls back to none.",
    "dom": "The only child of .vsidian-skeleton; its direct children are the .vsidian-skeleton-block sequence (see the skeleton-block entry).",
    "obsidian": {
      "counterpart": "No counterpart"
    }
  },
  "mode-body": {
    "purpose": "The webview-wide mode anchor (#141): a mutually exclusive class pair that switches with the view mode on the layout root div (.vsidian-body inside #app, not the HTML body element — the class pair is not attached to <body>), serving as the public entry for user snippets styling \"per mode\" (e.g. #app .vsidian-body.vsidian-mode-reading .vsidian-toolbar button { … }). Built-in consumer: the show/hide rules of the view toggle book/edit icons take it as their single source.",
    "states": "Mode-state classes: the live view carries .vsidian-mode-live and the reading view .vsidian-mode-reading, recomputed by applyModeDom on every mode switch.",
    "dom": "The classList of the layout root div inside #app (.vsidian-body, the horizontal layout root); not on the HTML body element or any specific control.",
    "obsidian": {
      "counterpart": "No counterpart (Obsidian expresses this through container-state classes such as mod-cm6; the original name is not promised to match)"
    }
  },
  "mode-toggle": {
    "purpose": "Formerly the mode toggle button group on the toolbar. Since #38 (commit 288044d, 2026-09-24) mode switching moved to the host editor title bar three-state commands and the toolbar no longer renders this class; the entry is kept as the correction record for a stale row of the old mapping table — the class has never existed in the DOM of any released build since v0.1.0 (verified: git grep v0.4.0 -- src/ has zero hits).",
    "dom": "None (the class is no longer emitted).",
    "obsidian": {
      "counterpart": "No counterpart"
    },
    "removed": "Removed by #38 (2026-09-24, 288044d) and never present in any released build; the old mapping table row was stale data (corrected during the #133 verification against the v0.4.0 tag 75c3df7 source)."
  },
  "context-menu": {
    "purpose": "The unified context-menu overlay (#183 takes over the whole live body): a self-drawn fixed-position menu attached to body. Three cluster separators (-separator), cascading submenus (-submenu; shown/hidden via :hover/:focus-within + the parent-item click fallback class vsidian-menu-open + the assembly-time left flip vsidian-menu-flip when the right edge would clip), the icon slot (-icon driven by data-icon through a mask; since #184 the 26 wired icon keys define light/dark assets via --vsidian-context-icon, spare keys keep assets on disk but stay unwired), text badges (-badge, H1-H6), checkmarks (-check, paragraph-style items lit per line structure), disabled greying, danger red text, and the shortcut hint column (-hint, right-aligned small text at lowered opacity, no placeholder when unbound). Menu items are keyboard-accessible buttons; colors follow the --vscode-menu-* variable family (same visual language family as the outline menu). The former blockMenu (#162, .vsidian-block-menu*) is retired and folded in — that class name never existed in any released build (zero hits in the v0.5.0 tag), so there is no compatibility obligation and the contract keeps no entry for it.",
    "states": "Right-clicking the live body (empty lines, plain text, table rows, inside fences and graphic blocks are all intercepted; the frontmatter header area and reading mode are not — the native menu behaves as usual). Write commands are greyed out in structure-sensitive areas (the safe-degradation matrix).",
    "dom": "A direct child of document.body (viewport-fixed positioning); submenus are nested inside their parent item host (absolute).",
    "obsidian": {
      "counterpart": "None (the Obsidian context menu is an app-native menu, not a DOM element)"
    }
  },
  "backlink-panel": {
    "purpose": "The backlinks panel (#197, reworked in the panel-rework batch): backlinks of the current note grouped by source file — a group header (chevron + source name + count, collapsible) above white context cards (card body is the quoting line; the raw Markdown syntax of the matched link is highlighted as a whole, see the backlink-hit entry); a page header shows the panel title plus the card count; four-state placeholders (loading/empty/error/no-match) and the updating strip share the container. The visibility switch is the vsidian-backlinks-active class on the sidebar container (mutually exclusive with the outline and outlinks panels).",
    "states": "The panel DOM is persistent in the sidebar (.vsidian-sidebar-panel), display:none by default; visible when the sidebar is expanded and the panel is active. Items are dynamic data (driven by host index snapshots); the four states follow the latest backlinks.snapshot; group collapsing is expressed by the group-collapsed class (card area hidden, header kept).",
    "dom": "In the sidebar panel area: vsidian-backlink-panel container > persistent area (updating strip (optional) + toolbar (see the backlink-toolbar entry) + search box) + dynamic area (sort menu (when open) + header (title + count) + groups (group-header buttons + card buttons) or a placeholder). Persistent-area nodes are reused across renders (the search input keeps focus).",
    "obsidian": {
      "counterpart": "None (the Obsidian backlinks pane is app-level DOM)"
    }
  },
  "backlink-toolbar": {
    "purpose": "The backlinks panel toolbar (panel-rework batch): four linear icon buttons centered in a row — sort (a six-item, three-group dropdown with the current item checked; closes on Esc/outside click), search (toggles the full-width search box below the buttons), collapse all (two-state, aria-pressed) and more context (short/long snippet toggle, aria-pressed). Active buttons carry the selection background; the sort menu is an absolutely positioned layer inside the panel.",
    "states": "Visible when ready with items (not rendered for loading/error/empty documents); the four buttons track view state via aria-pressed/expanded; the search box visibility switch is the hidden attribute; the menu mounts only while open (a dynamic state, so the probe table does not fake a static assertion for it).",
    "dom": "Persistent area of vsidian-backlink-panel: a role=toolbar container with four buttons (inline 16-unit SVG icons); the search box follows; the menu (when open) heads the dynamic area (the panel container is its absolute anchor).",
    "obsidian": {
      "counterpart": "None (the Obsidian backlinks pane is app-level DOM with no such class names)"
    }
  },
  "backlink-hit": {
    "purpose": "Backlink card match highlight (panel-rework batch): the raw Markdown syntax of the matched link ([...](...) or [[...]] including brackets and URL) inside a card is marked with a yellow background — light themes use #ffec99, dark/high-contrast themes use a readable yellow (about 30% yellow overlay; the text color inside the highlight is unchanged with no underline). The variable is public and can be overridden by external snippets.",
    "states": "Defined permanently on #app; light/dark values switch with body.vscode-dark / body.vscode-high-contrast.",
    "dom": "A custom property of #app; consumed by mark.vsidian-backlink-hit inside backlink cards (dynamic data, so the probe table does not fake per-item static assertions — the color rule is pinned by contract tests).",
    "obsidian": {
      "counterpart": "None (the Obsidian search-match highlight is app-internal styling)"
    }
  },
  "backlinks-toggle": {
    "purpose": "The sidebar toolbar button toggling the backlinks panel (same row as the outline and outlinks buttons): clicking toggles the panel (three-way mutual exclusion); the active-state highlight follows --vscode-list-activeSelectionBackground.",
    "states": "Visible when the sidebar is expanded; aria-expanded tracks the panel active state.",
    "dom": "A button plus a chain-link SVG icon (interlocked double loop with a left-returning arrow, 24-unit viewBox; stroke width pinned via CSS) inside .vsidian-sidebar-toolbar-actions.",
    "obsidian": {
      "counterpart": "None (the Obsidian backlinks toggle is app-level UI)"
    }
  },
  "outlink-panel": {
    "purpose": "The outgoing links panel (outlinks batch): a flat list of links in the current note — a page header (title + muted count at the top right) plus two-line items (line 1: a small chain icon + target display name; line 2: the target path with hanging indent); clicking opens the target and locates the actual anchor of the link; broken-link items are globally muted (broken class + disabled) and not clickable; external-scheme edges never enter the panel. The visibility switch is the vsidian-outlinks-active class on the sidebar container (mutually exclusive with the outline and backlinks panels).",
    "states": "The panel DOM is persistent in the sidebar, display:none by default; visible when the sidebar is expanded and the panel is active. Items are dynamic data (driven by host outlinks.snapshot); the four states mirror the backlinks panel.",
    "dom": "In the sidebar panel area: vsidian-outlink-panel container > updating strip (optional) + outlink-header (title + count) + outlink-item buttons (item-name (with an inline 16-unit chain SVG) + item-path) or a placeholder.",
    "obsidian": {
      "counterpart": "None (the Obsidian outgoing-links pane is app-level DOM)"
    }
  },
  "outlinks-toggle": {
    "purpose": "The sidebar toolbar button toggling the outgoing links panel (same row as the outline and backlinks buttons): clicking toggles the panel (three-way mutual exclusion); the active-state highlight follows --vscode-list-activeSelectionBackground.",
    "states": "Visible when the sidebar is expanded; aria-expanded tracks the panel active state.",
    "dom": "A button plus a chain-link SVG icon (interlocked double loop with a right-going arrow, 24-unit viewBox; stroke width pinned via CSS) inside .vsidian-sidebar-toolbar-actions.",
    "obsidian": {
      "counterpart": "None (the Obsidian outgoing-links toggle is app-level UI)"
    }
  },
  "hover-popup": {
    "purpose": "The hover document preview popup (first closing loop of phase one, #218): hover a wikilink or local Markdown link in the parent reading view, and the target is read through the document-access channel and shown as read-only reading content. Since #221 the same popup serves all entry points: the live-preview body (Ctrl+hover by default, direct hover once the hover.liveDirect setting is on) and backlink/outgoing-link panel entries (direct hover). Default width 480px / max height 400px (in small viewports a JS geometry plan flips at the four edges and shrinks to fit); the content is read-only — task checkboxes are disabled (JS disabled + pointer-events double safety), with no write-back channel at all. Since #220 the popup carries the target document (B) as reading content: images resolve relative to B (the sourceDocUri channel), links are clickable for navigation, and code blocks get plain syntax highlighting. Since #245, line-owning embeds inside B expand into read-only cards using the same depth and budget as body cards; a child card at its scroll boundary hands the wheel to the popup, and asynchronous height changes reposition it using natural content height. Only one hover popup exists throughout. #217 acceptance follow-up: a header bar shared with the embed cards — the target display name (spec.target) stays constant regardless of the result payload, and the top-right open button dispatches to the existing activation message family by target shape (wikilink/plain-link sent directly; panel shapes go through an openAction closure along the same channel as the entry click); clicking closes the popup as a context switch. Since P2-06 (#283) the popup root reference supports internal Live: it follows the root panel mode by default and can be switched manually (remembered per reference position within the panel session); the header gains a save-target / mode-toggle / close-editing action group plus an unsaved dot (`·`) right after the display name (present while target B is dirty, warning color — same semantics as the embed cards in P2-04), and the scroll area carries a parallel internal-Live editor container (height capped by the geometry plan; scrolling is handled by CM6's own scroller). A dirty internal Live resists the normal dismiss conditions (leave, outside click, blur — Q18); a clean one keeps the normal hover rules, and explicit close reuses the embed ref-close-dialog three-way confirmation.",
    "states": "An interaction-state floating layer (mounted after the hover open delay, dismissed by leaving the joint anchor/popup domain after a close delay, Esc, parent scroll, or mode switch; since #221 a keyboard-command open moves focus into the popup with a :focus-visible outline, and while focus stays inside the popup it is not dismissed by the mouse leaving; since P2-06 an internal Live whose target is dirty resists the normal dismiss conditions — leaving, outside clicks and blur do not destroy it, and the normal rules resume once it is clean again) — the container itself is not part of the static probes; open/close, keep-alive and painting are verified behaviorally by the browser hoverPreview / hoverEntry / hoverLive suites; the style entry point (a single low-specificity class) is public for snippet overrides. P2-06 internal modes: internal Reading (default content view, no write port; the dot and the save/close entries are absent) / internal Live (editor container present, content view hidden; the dot and save entry are visible while the target is dirty; a paused session shows an inline state notice).",
    "dom": "Since #220 attached directly inside #app (previously on body; fixed positioning is unaffected by the #app layout) — the #app theme variables, the `#app .vsidian-view-reading …` content styles, and enabled CSS snippets (the container class carries the .markdown-preview-view alias bridge) therefore match naturally, without duplicating a second theme environment for the popup. The inner reading container carries .vsidian-view-reading. The header bar (target display name plus open button) lists its rules together with the embed-card header selectors (popup selector first, embed selector last). Since P2-06 the three action-group buttons are real <button type=\"button\"> elements (aria-label and tooltip via the i18n entries embed.saveTarget / embed.modeToLive / embed.modeToReading / embed.closeEditor, tooltips carried by data-tooltip; inline SVG icons aria-hidden, 16-grid stroke currentColor), the dot is a <span> (aria-label embed.dirtyDot), and their rules are listed alongside the embed-card header ones (popup selector first).",
    "obsidian": {
      "counterpart": ".hover-popover (the Obsidian page-preview popover direction; the internal structure is closed-source and not promised)"
    }
  },
  "hover-pdf-view": {
    "purpose": "The hover PDF preview content view (first closing loop, #337 / P3-05): when hovering a wikilink or plain link that targets a local PDF, a read-only PDF rendering container sits inside the popup scroll area in parallel with the reading container — PDF.js draws the requested page onto a canvas inside the webview (initial positioning via the wikilink #page=N anchor, falling back to page 1 when absent; plain-link fragments are not parsed). Read-only presentation: no write-back channel and no takeover of parent input; the page-turn operations (keybindings unbound by default) only change the previewed page and never modify the document. The container and canvas sizes are fitted by the renderer to the popup content width (scale capped at 2.5), and the page-info line reports \"Page N of M\". Error states (corrupt / encrypted / out-of-range page / resource failure) go through the popup existing .vsidian-hover-popup-state state line (with the error modifier); this container carries only the successfully painted state.",
    "states": "Loading (zero-size canvas placeholder, loading text on the state line) / painted (canvas at its actual size per page and fitted scale, page-info line present) / error (canvas zeroed, error text on the state line) / invalidated withdrawal (when the target is deleted/stale the old canvas is withdrawn too and never impersonates live content). An internal structure of an interaction-state floating layer — not part of the static probes; paint-level visibility is asserted by browser and integration tests on actual canvas pixels (not DOM presence).",
    "dom": "Attached inside the scroll area (.vsidian-hover-popup-scroll) of the #app popup (.vsidian-hover-popup), in parallel with the reading container (hidden in PDF form). The canvas is a native <canvas> element (width/height written by the renderer per viewport); the page-info line is a <div> whose text comes from the i18n entry hover.pdfPageInfo.",
    "obsidian": {
      "counterpart": "None (the PDF presentation of the Obsidian page-preview popover is closed-source and not promised)"
    }
  },
  "hover-fm-section": {
    "purpose": "The note-properties section of referenced reading content (introduced by the #220 hover popup; shared with the #222 embed cards via the common assembly in refReadingContent — selectors list both the .vsidian-hover-popup and .vsidian-embed-card scopes): shown for full-document references only — collapsed by default, the whole header row is the hover hot zone (hovering it or focusing the button reveals the toggle button; hovering never auto-expands), and clicking the button toggles expansion. The expanded state persists for the current open (rebuilds caused by target-content changes do not reset it); reopening the popup restores collapsed, and an embed card keeps it per instance state (viewport recycling does not clear it). A well-formed frontmatter reuses the reading-side header and key-value rows (presentation and type/degradation boundaries follow the frontmatterTable rules, not widened); the degraded form synthesizes a structurally identical header and keeps the escaped raw source (hidden while collapsed). Section/block references and documents without frontmatter show no properties section; there is no add/delete/edit or task-check write-back entry at all. The main reading view properties presentation is unaffected.",
    "states": "Collapsed (default, vsidian-hover-fm-collapsed — property rows and the degraded source block get display:none, the header row stays) / expanded (modifier removed); the button is opacity:0 + pointer-events:none by default (no wholesale hiding declarations — Tab reachability is preserved), shown and pointer-enabled on header :hover or button :focus-visible; the chevron points down when expanded and rotates -90° (rightward) when collapsed. Internal structure of an interaction-state popup — not part of the static probes; collapse/hot-zone/keyboard interactions and light/dark-theme visibility are verified behaviorally by the browser hoverPreview suite.",
    "dom": "Attached to the frontmatter block (.vsidian-reading-frontmatter) inside the #app popup (.vsidian-hover-popup); the toggle is a real <button type=\"button\"> (Enter/Space activate natively), with aria-expanded following the state and aria-label/title from the i18n entries (hover.content.fmExpand/fmCollapse).",
    "obsidian": {
      "counterpart": ".metadata-container and .collapse-indicator (the Obsidian properties-collapse direction; the internal structure is closed-source and not promised)"
    }
  },
  "reading-embed-card": {
    "purpose": "The in-flow embed card (created for the reading view in #222, mounted identically in the live view since #223 — both containers share the same card assembly and state store): a line-owning ![[…]] is replaced by a reference card — visually aligned with the reading prose (#217 acceptance feedback: only the left accent bar remains; no fill, no full border, no rounding — white background with square corners, the same direction as an in-prose quote block), the file name on top (the target root-relative path once loaded), and an open-target entry at the top right (reusing the existing Vsidian open behavior, never editing the embed source; an inline SVG icon stroked with currentColor so it inherits --vscode-icon-foreground — added by the #217 acceptance feedback, the button used to be an invisible empty shell). The content is a read-only reading view of the target (full document/section/block, loaded through the hover document-access channel); short content keeps its natural height while longer content scrolls internally, capped at 480px by default and adjustable via the embed.maxHeight setting (the inline max-height takes precedence over the rule default). The card lives in the #app content flow — theme variables and CSS snippets match through nesting, and the .markdown-embed alias on the card shell lets embed-container rules match as well. For the live-side mount forms and source reveal, see live-embed-widget (inside the live host the card shell margin is zeroed and spacing is carried by the host padding — the height-accounting semantics). Since P2-04 (#281) the card supports an internal live editor: the header gains a right-hand action group (save target / toggle internal mode / open target, icon buttons sharing the same button rules) and a dirty dot right after the file name (the `·` character, present while the target has unsaved changes, in the theme warning color), and the scroll area gains a sibling .vsidian-embed-card-live editor container (present in the internal live state, capped by the same inline max-height with scrolling carried by the CM6 scroller itself); the default internal mode follows the direct parent view (unless manually overridden), and the internal reading state remains a read-only content view (no write port). Since P2-05 (#282) the header also carries a close-editing entry (visible while an internal live port is attached): explicit exits uniformly check the target B's latest authoritative state — a dirty target opens the ref-close-dialog three-action confirmation, a clean target simply switches back to reading.",
    "states": "Loading (a state line with the i18n text, content area hidden) / loaded (the content scroll area present, task checkboxes disabled, the properties section collapsed by default) / a failure state (the state line shows the localized error text in place, no host notification). On viewport recycling (reading) and decoration teardown (live) the card DOM and the target content view are released while the properties expansion and scroll position are kept (restored on remount); within the parent session the loaded content is cached and never re-requested; live↔reading mode switches share the same per-instance state (the semantic key is the embed line start plus the raw target). P2-04 internal modes: internal reading (the default — the content view, no write port; the dirty dot and save entry are absent) / internal live (the editor container present, the content view hidden; the dirty dot and save entry visible while the target is dirty; a paused editing state shows an in-place state-line note). P2-05 (#282): the close-editing entry is present in the internal live state (hidden once the port is released); an explicit close against a dirty target opens the ref-close-dialog modal, and a clean target switches straight back to reading.",
    "dom": "Reading: inside the reading-view embed block (.vsidian-reading-embed, with data-vsidian-embed-inner carrying the raw target). Live (#223): inside a .vsidian-live-embed host widget (hidden form = a block-level whole-line replacement, revealed form = a below-line block widget). The card shell .vsidian-embed-card also carries the .markdown-embed alias (same-source table in obsidianAlias); the content area is a nested .vsidian-view-reading container; the open entry is a real <button type=\"button\"> (aria-label from the i18n entry embed.openTarget; the inline SVG icon is aria-hidden, 16-grid, stroked with currentColor — added by the #217 acceptance feedback). P2-04: the save and mode-toggle entries are the same kind of real <button> (aria-label and tooltip from the i18n entries embed.saveTarget / embed.modeToLive / embed.modeToReading, tooltips carried by data-tooltip); the dirty dot is a <span> (aria-label embed.dirtyDot). P2-05: the close-editing entry is the same kind of real <button> (i18n entry embed.closeEditor, an X-shaped inline SVG, tooltip carried by data-tooltip).",
    "obsidian": {
      "counterpart": ".markdown-embed (the Obsidian reading embed container)"
    }
  },
  "ref-close-dialog": {
    "purpose": "P2-05 (#282) explicit-close confirmation modal for reference editing: plugin-controlled exit intents (the embed card header close button, Esc inside the embed editor, and the interception of deleting an active reference line) uniformly check the target B's latest authoritative state; a dirty target opens this self-drawn three-action dialog — \"Save and close\" (TextDocument.save; a failure keeps the scene), \"Discard changes and close\" (the P2-01-verified activate-B + argument-less revert document-level rollback that restores the entire B including unsaved changes from other views), and \"Cancel\" (the default focus; the scene is kept and a delete intent never completes the deletion in A). The confirmation text spells out the B file name and the document-level discard impact; if B changes while the dialog is open, a re-confirmation is required (a stale notice line plus a fresh baseline, with a version guard on the host side as the second line of defense). Closing a clean target, mode switches and offscreen recycling never open this modal. Self-drawn presentation (role=dialog + aria-modal + Esc cancels), never window.alert; theme variables come from the public VSCode families (backdrop editorWidget-editableBackground / box editor-background + panel-border / save & cancel button family / discard button-secondary family / notice editorWarning left bar), so themes and CSS snippets follow the host appearance. The upcoming hover popup (P2-06) reuses the same target operation and this modal.",
    "states": "Absent (the default — no exit intent or a clean target) / open (the three action buttons plus the file name and discard-impact notes, focus defaults to cancel) / re-confirm (the target changed while confirming: the -notice line present with the warning left bar, the confirmation baseline refreshed) / action failure keeping the scene (save-failed / discard-failed: the -notice line present, the modal stays open).",
    "dom": "A direct child of body: .vsidian-ref-close-backdrop (a fixed full-screen overlay, z-index above the hover popup and the image popup — modal blocking) containing .vsidian-ref-close-dialog; the title and notes are divs; the three actions are real <button type=\"button\"> elements (labels from the i18n entries embed.closeCancel / embed.closeSave / embed.closeDiscard); the notice line is a div (text from embed.closeStale / embed.closeSaveFailed / embed.closeDiscardFailed, display:none by default). Keyboard semantics: Esc on the modal cancels; Enter lands on the default focus (cancel).",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian uses the native host save-confirmation dialog; this project draws its own modal)."
    }
  },
  "embed-conflict-choices": {
    "purpose": "P2-12 (#289) write-conflict three choices: when an internal live editor is paused because writing back is unsafe (an external interleaved edit overwrote the requested range, and so on), the paused scene (the state line) shows \"Compare and Resolve / Discard Current Version / Cancel\" in place — the compare hover text is the user-specified wording \"Resolve the conflict in a diff view between the temporary copy and the conflicting version\" (carried by data-tooltip, word for word). The three actions: compare sends out the full snapshot of the current input, and the host creates an untitled temporary copy and opens the native VSCode diff (left = the temporary copy, right = the real B; the P2-01 §6 verified route — the diff view belongs to the host and the extension builds no resolution UI of its own); after a successful handoff a sync.request resyncs and lifts the pause (the old uncommitted queue is never replayed). Discard drops only the input that failed to write this time and resyncs B (never a document-level rollback of the whole B — modeled separately from the P2-05 discard). Cancel collapses the choices while keeping the pause and the input (a single -reopen button re-expands them). Non-modal presentation (reading the embedded content stays possible; never window.alert); a failure (the -notice line with the warning left bar) keeps the scene and can be retried. Theme variables come from the public VSCode families (compare as the primary button family / the others button-secondary / in-flight disabled opacity / focus-visible outline / notice editorWarning left bar), so themes and CSS snippets follow the host appearance.",
    "states": "Absent (the default — not a conflict pause; normal editing, loading and failure states never show the choice bar) / expanded (the paused note plus the three buttons; compare disabled in flight — reduced opacity) / collapsed (after cancel: only the -reopen entry remains, the pause and input kept) / failure keeping the scene (the -notice line present plus the three buttons, retryable) / pause lifted (when doc.resync arrives: the whole choice bar is removed and the state line returns to loading/error handling).",
    "dom": "Inside the embed card state line .vsidian-embed-card-state: the paused note is a <span> (text from the i18n entry embed.livePaused, registered with bindLocale for locale switches); the choice bar is a div.vsidian-embed-card-conflict (a flex wrap container); the buttons are real <button type=\"button\"> elements (visible labels from embed.conflictCompareLabel / embed.conflictDiscardLabel / embed.conflictCancelLabel / embed.conflictReopenLabel, tooltips via data-tooltip from embed.conflictCompareHint / embed.conflictDiscardHint / embed.conflictCancelHint / embed.conflictReopenHint — the compare tooltip is the user-specified wording); the failure note is a div.vsidian-embed-card-conflict-notice (text embed.conflictCompareFailed). The bar buttons, the keybinding operations (conflictCompare/conflictDiscard/conflictCancel, registered in P2-10 with no default binding) and the test hooks share one handler chain.",
    "obsidian": {
      "counterpart": "No direct counterpart (Obsidian conflict handling is closed-source; this project draws its own in-place choice bar and delegates the diff to the native host diff editor)."
    }
  },
  "live-embed-widget": {
    "purpose": "The live-view embed host widget (#223 for line-owning embeds; since #247 occurrences inside mixed-run lines, ordered/unordered/task lists, lazy continuations, blockquotes and their combinations mount too — recognition shares the #246 reading-side scanEmbedsInLine; since #248 occurrences inside table content rows (header/data cells) mount via the in-cell decoded scan — inner/target use the decoded semantics (an escaped-pipe alias never leaks into the target path) while the replacement range is the exact raw-source range, and the widget nests inside the grid-cell mark span (a CM6 inline replace widget does not split marks), so the grid column layout and region highlighting survive in-cell cards): a ![[…]] in the live document mounts the same card as reading-embed-card via a CodeMirror decoration — hidden form (cursor/selection not touching the source range) replaces only the exact embed range [from, to] (the ![[…]] itself; before #247 the whole line) with an inline replacement (surrounding text, list markers/numbers, task checkboxes, quote prefixes and existing indentation stay on the line, no newline is ever inserted into the source, and the CSS block-levelized host renders the \"leading text → card → trailing text\" flow break; the cm-widgetBuffer pair around the replacement is zero-height block-levelized — the acceptance-feedback \"no invisible source line\" fix that also keeps the layout boxes as CM6 inline-block coordinate anchors: fully removing them (display:none) starves posAtCoords vertical probing at the range end of any rect, so the probing skips the whole block and ArrowDown from above jumps past the embed line — measured during the #217 acceptance round; keeping the replacement inline is the prerequisite for keyboard vertical navigation to enter the embed line, as a block-level replacement gets skipped wholesale by CM6; the in-cell buffer zero-heighting and host width constraints are carried by the grid-cell container rules); revealed form (per the selectionTouchesRange semantics: a collapsed cursor inside or on either end of the range, a non-empty selection strictly overlapping it, or any one selection range hitting it — never widened to adjacent text or the whole line) shows the editable source with the card moved below the line (dynamically shifting down one line to make room; reveal only affects the visual presentation of the source text — the card is not dismissed, and sibling cards reveal independently). The host vertical spacing is carried by its own padding with the in-host card shell margin zeroed — margins collapse out of the line box and CM6 height accounting (which drives the line-number gutter and viewport math) excludes them, which used to accumulate a per-card gutter misalignment (#217 acceptance measurement; padding counts into the box height so accounting matches rendering). The host swallows events (ignoreEvent=true): clicks inside the card never place the parent editor cursor, and browser text selections inside the card are never mistaken for parent-document CM6 source selections; in-card interactions (scrolling/text-selection copy/links/properties buttons) go through the embed card own listeners; since #248 the rectangular cell-region anchor also excludes the embed-card domain (tableRegionSelection — a pointerdown inside a card never starts the parent cell-region selection). An unclosed reference keeps the editable raw text and dismisses the old card (re-closing reloads per the new reference); embeds inside code fences/inline code/HTML comments/frontmatter and link-label runs do not mount (raw source shown). Cross-mode state sharing: the line-owning host key uses the line range while the mixed/in-cell host key uses the exact embed range (matching the two reading-side host conventions).",
    "states": "Hidden (an exact-embed-range inline replace widget — the line structure plus surrounding text and container markers are kept so keyboard vertical navigation can enter from both directions; the source-line alignment and buffer zero-height block-levelization are carried by CSS, and mixed runs render the leading-text → card → trailing-text flow break; since #248 the in-cell form nests inside the grid-cell mark span with the card bounded by the column width — the in-cell buffers and host width are constrained by the grid-cell container rules) / revealed (a below-line block widget .vsidian-live-embed-below with the source present, dynamically shifting down one line to make room; sibling cards reveal independently); the switch rebuilds the decoration (per-instance card state is kept by the embed-card state store); loading/loaded/failure states reuse the card state line.",
    "dom": "Inside the live view .cm-content: the hidden-form host div sits inside .cm-line (the replacement of an inline replace, block-levelized via CSS display:block, with the surrounding cm-widgetBuffer pair zero-height block-levelized via display:block + height:0 — visually equivalent to hidden while the layout boxes remain as coordinate anchors); the revealed form is a block widget after the line end. The card shell .vsidian-embed-card (carrying the .markdown-embed alias) sits inside; the nested reading container resets white-space: normal (#217 acceptance measurement: the CM6 .cm-content white-space: pre cascade renders the trailing newline of each block innerHTML as a ghost line box, inflating card line spacing). Async card height changes (content loading, late images) wake the CM6 layout via ResizeObserver → view.requestMeasure.",
    "obsidian": {
      "counterpart": ".cm-embed-block (the Obsidian live embed container direction; the internal structure is closed-source and not promised)"
    }
  },
  "live-escape": {
    "purpose": "Universal escape reveal/hide (generalized from acceptance feedback, Obsidian-aligned): in the live view the backslash of a Markdown escape sequence (backslash + ASCII punctuation, tree-driven Escape nodes) is hidden by default — what you see is the literal character (\\* renders as *, \\\\ renders as \\); when the cursor or a selection touches the line, the reveal class takes over and the backslash is shown in a low-mix tint of the editor foreground (exposing the source, same tint as the block-id dimming). Escapes inside table rows do not use this class: an escaped pipe (\\|) goes through the #42 live-table-escaped-pipe dedicated emission and rules (a degraded table keeps the raw source), while other escapes inside a cell (\\* and the like) get no emission at all — their backslash stays visible in the raw text (a deliberate degraded boundary: the table's own cell splitting and this generic emission are mutually exclusive to avoid class collisions), pinned by a liveEscape unit case. No effect inside code blocks/inline code (no Escape nodes). Display only — the source text is never changed.",
    "states": "Hidden (default — the backslash is display:none) / revealed (touching the line swaps in the reveal class: display:inline plus a 45% low-mix tint of the editor foreground, following light/dark themes and custom font colors); the switch rebuilds with selection transactions, sharing the same predicate semantics as the heading/wikilink mark reveal (a collapsed cursor includes both line ends, a non-empty selection strictly overlaps).",
    "dom": "An inline mark span (covering the first character of the tree-driven Escape node); nests freely with wikilink/emphasis and other inline marks.",
    "obsidian": {
      "counterpart": "the Obsidian live preview inline source exposure of escapes (the touching line shows the backslash in a light tint)"
    }
  },
  "mod-link-hover": {
    "purpose": "Modifier-key hover feedback (#217 acceptance feedback: Ctrl+hover over a jumpable link gave no visual cue at all — a discoverability gap): while Ctrl/Cmd is held, hovering a jumpable link (wikilink/embed reference/plain link — source-form marks and rendered widgets alike, reading-view anchors included) underlines it and shows the clickable pointer cursor (instead of the text caret). The state class is maintained by the syncController document-level keydown/keyup (getModifierState handles left/right modifier pairs and alternation precisely) plus a window-blur fallback; the rendered widgets own standing clickable-cursor rule (pre-existing) is unaffected.",
    "states": "Active (Ctrl/Cmd held — the body carries the class, hovering a link picks up underline + cursor:pointer) / inactive (no class, links render exactly as before); window blur forces the fallback (a keyup may have been lost).",
    "dom": "A class on body; the rule selectors cover .vsidian-wikilink / .vsidian-link / reading anchors under :hover.",
    "obsidian": {
      "counterpart": "the Obsidian pointer and underline feedback while holding Ctrl over internal links"
    }
  },
  "reading-embed-ref": {
    "purpose": "The openable placeholder form of an embed reference (#222): a line-owning embed inside referenced reading content first parses into a recognizable ![[display]] reference. Since #244/#245 it mounts as a body card or hover-internal card when depth and budgets allow; excessive depth, a cycle, or budget rejection retains an in-place explanation and an open-target entry. The target always resolves relative to its direct source document.",
    "states": "Inside referenced content, the line upgrades to a card or an in-place placeholder according to depth and budgets; clicks navigate by direct source without stacking another hover popup (the embed content domain stops mouseover/mouseout propagation).",
    "dom": "An <a class=\"vsidian-wikilink vsidian-embed-ref\" href=\"raw target\"> inside the embed block html (the href is the raw text before |, same convention as the reading wikilink anchor); when the parent-document embed block mounts it is replaced wholesale by the embed card (the placeholder line never appears there).",
    "obsidian": {
      "counterpart": "(Obsidian expands embeds recursively; there is no placeholder form)"
    }
  },
  "reading-embed-mixed": {
    "purpose": "Reading mixed-run embed host (#246): a ![[…]] mixed with text (\"lead ![[B]] trail\") or inside a list/blockquote container is promoted from its inline placeholder (embed-slot) into an in-flow block host after the block mounts, carrying the same reading-embed-card — rendered as \"lead text → block card → trail text\" with no newlines inserted into the source. Promotion inside a p splits the paragraph (lead p + host + trail p, classes and attributes cloned, empty halves dropped — valid DOM, never a block node inside p); bold/italic/highlight spanning the embed is unwrapped into two complete inline tags on each side (visual semantics preserved); list items (bullet/ordered/task/lazy continuation) and blockquotes host the card in place — list numbering, indentation, and the quote bar container stay intact; the host width follows its column/indentation area (block-level, filling the parent content box without crossing the indent). One shared recognition/mounting adapter covers the main reading document, card content, and hover content (RefContentMount and EmbedCardManager share the embedSlots assembly); multiple embeds in one paragraph each own an occurrence-keyed card in source order. Since #248, table cells (th/td) upgrade the same way — the placeholder is replaced in place by an in-cell host (the table row/column structure stays intact, the width follows the column; escaped-pipe alias forms produce their placeholder via the in-cell decoded re-parse, with data-vsidian-embed-inner in decoded semantics and the src anchors on the raw-source range).",
    "states": "Upgrade path mirrors the line-owning card (loading/success/failure states, capped scrolling, depth and budget rejection, recursion and source leases all reuse the #244/#245 infrastructure); non-promotable forms (inside an anchor, pairing-failure degradation) keep the .vsidian-embed-slot placeholder text; since #248 table-cell placeholders upgrade to in-cell hosts (escaped-pipe alias forms included).",
    "dom": "Main reading document: produced inside a block element (.vsidian-reading-block) by the mounting adapter (embedSlots.promoteEmbedSlot), the host div carries classes .vsidian-reading-embed .vsidian-reading-embed-mixed; card and hover content produce it the same way via the RefContentMount block-mounted hook (direct-source/occurrence semantics follow the parent instance); since #248 table blocks (the table kind) produce in-cell hosts inside td/th the same way (in-place placeholder replacement). Unmounting pairs via the data-vsidian-embed-promoted query (the host is reclaimed with its owning block; instance state stays in the card state store).",
    "obsidian": {
      "counterpart": "(Obsidian inserts mixed-run embeds as blocks too; container rules are closed-source and not promised)"
    }
  },
  "embed-slot": {
    "purpose": "Reading mixed-run inline placeholder (#246): a span emitted by a markdown-it inline rule (the embedAtPosition check, same source as the shared/wikilink scanner) in the inline content of paragraphs/lists/blockquotes/tables — promoted into a reading-embed-mixed in-flow host after the block mounts (since #248 including table td/th cells); when not promoted or not promotable (inside an anchor — nested anchors are invalid DOM; pairing-failure degradation) it renders as placeholder text (body text in the muted description color, keeping the ![[ ]] form recognizable). The placeholder is a span rather than an anchor: it can sit inside link label text without breaking DOM validity, and clicks inside link labels follow the enclosing anchor semantics. Since #248, table-cell embeds containing an escaped pipe produce their placeholder via the in-cell decoded re-parse (data-vsidian-embed-inner in decoded semantics, e.g. B|alias), pairing against the in-cell decoded occurrence scan.",
    "states": "Promoted (block mounted and the placeholder is promotable — replaced by the in-flow/in-cell host, the span leaves) / placeholder kept (all other forms; rebuilt whenever the block html is rebuilt).",
    "dom": "Inline content of a block container (p/li/td/th): <span class=\"vsidian-embed-slot\" data-vsidian-embed-inner=\"raw\">![[display]]</span>; attribute values are HTML-escaped and survive the sanitizeReadingDom deep sanitization (data attributes are kept).",
    "obsidian": {
      "counterpart": "(Obsidian renders mixed-run embeds directly; there is no placeholder form)"
    }
  },
  "find-panel": {
    "purpose": "Floating find panel over the editing area (three-toggle panel since #236, powered by the @codemirror/search engine in external-drive mode): two-column grid layout since 2026-10, matching the native VSCode widget — the left column is the replace-bar expander (full height across rows: as tall as the main row when collapsed, spanning both rows via :has when expanded; no border at rest, the accent ring appears only on focus and stays mutually exclusive with the input focus ring — clicking hands focus back to the input; the icon is a self-drawn SVG from quick-action-icons.py on an embedded glyph layer, rotating 90° with aria-expanded when expanded: > to a downward chevron), and the right column stacks the main row (input, the case/whole-word/regexp toggles, the \"n of total / No results\" counter, previous/next/close — same order as the native VSCode widget) and the replace row. The three toggles are the find-options single source of truth (shared/findOptions; also consumed by #238 \"select next same word\") and persist per workspace across sessions; the panel is available in both live and reading views (reading keeps block-level hits and positioning), while the replace entry points are disabled entirely in reading view (2026-10 user decision — the toggle is disabled and grayed out, and Ctrl+H is not consumed).",
    "states": "The panel DOM is always present; visibility is controlled by .vsidian-find-open (display:none when closed, so probes are unaffected). A lit toggle means the option is on (e.g. Aa lit when match-case is enabled). An invalid regexp shows a red border on the input container (the invalid class marks the input as the state source and :has lifts the coloring onto the container; an empty query is not flagged and shows no red; no crash, counter reads \"No results\"). An empty query collapses the whole counter area via the -hidden class (display:none — nothing searched yet reserves no \"n of total\" blank, #241 acceptance revision). Find-in-selection (#241 asset wiring, the native ☰): a panel-local non-persisted state (reset on panel close or entering reading view) — the button is disabled without a user-selection anchor (grayed, hover unresponsive); when on it joins the lit family and matches/navigation/replacement are confined to the range (the range maps through edits and follows user reselection), with the range marked in the body text by a .vsidian-find-selection-range low-emphasis background mark (inactive-selection color, may span lines). The replace-bar toggle is disabled in reading view (grayed via the disabled attribute — the shared hover rule carries a :not(:disabled) guard, and a disabled control cannot take focus so the focus ring never appears). Open/close and toggle interactions are verified by the browser suite along behavior paths.",
    "dom": "Attached inside the editor container (position:relative containing block), below #app; buttons are real <button type=\"button\"> elements (aria-pressed/aria-expanded follow state; aria-label/title from the find.* i18n entries). Since #241 the navigate/close/replace buttons are icon-shaped — the button body shows its light- or dark-theme SVG icon, while the words live solely in aria-label and the hover title; the input border/background/focus ring live on .vsidian-find-inputwrap, which embeds the three toggles at its right edge like the native widget.",
    "obsidian": {
      "counterpart": "None (the Obsidian find widget is an application-level part, not a document styling surface)"
    }
  },
  "find-options-bar": {
    "purpose": "The find options bar (#238): a mini floating strip present while a \"select next occurrence\" session is active — just the three toggle buttons, no search box and no counter (user decision: every Ctrl+D press opens it directly). The button states share the main panel toggle memory (shared/findOptions; aria-pressed in sync); clicking toggles and rebuilds the session with the new options. Non-modal: it never takes editor focus (button mousedown is preventDefault-ed to keep focus), never claims the popup mutex slot, and Esc is consumed once after the find panel (closes the bar only, leaving selections intact). While the main find panel is open it does not appear (the panel toggle buttons blink via .vsidian-find-flash instead); the session end (external selection change / focus loss / Esc / mode switch) fades it out.",
    "states": "The bar DOM is always present; visibility is controlled by .vsidian-occurrence-bar-open (display:none by default, so probes are unaffected). A lit toggle means the option is on (same lit language as the main panel -active states). The panel toggle blink state is .vsidian-find-flash (a 0.45s opacity pulse animation; it lives on the find-panel buttons, not on the selectors of this entry).",
    "dom": "Attached inside the editor container (same positioning containing block and top-right corner as .vsidian-find; the two appear exclusively); buttons are real <button type=\"button\"> elements (aria-pressed follows state; aria-label/title reuse the find.matchCase / find.wholeWord / find.regexp entries, the container aria-label uses find.optionsBar).",
    "obsidian": {
      "counterpart": "None (the Obsidian Ctrl+D option hint is an application-level part, not a document styling surface)"
    }
  },
  "find-panel-replace": {
    "purpose": "The expandable replace bar of the find panel (#236): collapsed by default, expanded via the left-edge toggle (find-panel entry, .vsidian-find-toggle) or Ctrl+H (the findReplace operation); \"Replace\" replaces the current match and moves to the next one, \"Replace All\" replaces the whole batch — both are explicit write operations (a single CM6 transaction through the standard write-back chain; one edit.request = one host undo). Replacing is a live-editing capability, disabled entirely in reading view (2026-10 user decision): an open instruction carrying replace does not open the panel (silently ignored), Ctrl+H is not consumed (the registry lists the operation as live-only), and the toggle is disabled and grayed; the live-side expanded state is untouched by reading view and restored as-is when switching back to live (closing the panel ends the session in either mode alike).",
    "states": "The replace-row DOM is always present; visibility is controlled by .vsidian-find-replace-open (display:none by default; permanently collapsed in reading view, where the toggle is also disabled). The expanded state is observable via FindSessionProbe.replaceOpen.",
    "dom": "Third section inside the panel (.vsidian-find); Enter in the input is a panel-local key (replace next); buttons are real <button type=\"button\"> elements (icon-shaped since #241 — the words live in aria-label/title, i18n entries find.replaceNext / find.replaceAll).",
    "obsidian": {
      "counterpart": "None (the Obsidian replace widget is application-level)"
    }
  },
  "find-match-highlight": {
    "purpose": "Matches come from the @codemirror/search engine and are counted and located in the full source text. Live uses direct current-match and viewport match decorations. Reading maps source positions to visible text in mounted blocks: all hits are pale yellow and the current hit orange, including within callouts and blockquotes. Hidden link targets, image attributes, and rendered formula source still count without highlighting unrelated identical visible text. The current block retains .vsidian-reading-find-hit for existing snippets; default rendering adds no block tint or side bar.",
    "states": "Interactive-state decoration (present only while a find session is open and has hits) — excluded from static probes; hit counting, the current index and positioning are verified by the integration find cases along behavior paths.",
    "dom": "Live: inline decorations inside #app .cm-editor .cm-content; reading: spans around matching text inside #app .vsidian-view-reading. The current block retains .vsidian-reading-block.vsidian-reading-find-hit.",
    "obsidian": {
      "counterpart": "None (Obsidian match highlighting is application-level)"
    }
  },
  "var-find-highlight": {
    "purpose": "Four find-highlight variables: --match-background colors all matches (semi-transparent yellow by default); --match-current-background colors the current match (orange by default, shared by both views); --match-current-outline sets its outline. --hit-block-background remains the reading current-block background entry for existing snippets, transparent by default and still effective when explicitly set.",
    "dom": "Consumed by the live match decorations and the reading hit-block rules; defaults are inlined as var() fallbacks in the rules (no root value defined on #app — a snippet overriding at :root takes effect globally).",
    "obsidian": {
      "counterpart": "None (Obsidian highlight colors are application settings, not CSS variables)"
    }
  },
  "reading-find-source": {
    "purpose": "Reading find feedback for hidden source: when the current match cannot be fully mapped to visible text, keep the rendered content and show its starting source line. Table delimiters, hidden link targets, formulas and comments remain locatable without switching modes. Match counts and order stay unchanged. Source is plain text with no editing or writeback path.",
    "states": "Interactive state, mounted only for hidden or partially hidden current hits. Removed on visible hits, closing find, switching to Live, or disposal. Offscreen anchors hide it; virtual remounts restore it, and resizing repositions it. Fixed positioning leaves paragraph positions, block heights and scroll height unchanged; it never steals find focus, avoids the find panel and flips or shrinks at viewport edges. Long lines show about 320 UTF-16 units near the hit without splitting emoji. Multiline matches show the starting line, with trailing LF represented as \\n.",
    "dom": "Inside #app but outside the reading scroll container. An aside[role=region] contains a header with source-hit, source line/column and read-only labels, followed by pre > code with precise span highlights. No input, textarea, contenteditable or new keyboard action; existing find navigation and close keys apply.",
    "obsidian": {
      "counterpart": "None (Vsidian reading find source feedback)"
    }
  },
  "tooltip-card": {
    "purpose": "The unified self-drawn hover hint card (#300): every hover hint in the editor and settings webviews (operation names, user-content literals like raw TeX or image alt, disabled-state reasons, and keybinding badges). A document-level delegate listens on [data-tooltip] — the native title attribute is retired fleet-wide and a contract scan blocks regressions. Appears after the --vsidian-tooltip-show-delay on hover and immediately on keyboard focus; focusable (tabindex=0) with selectable, copyable text; no buttons or interactive logic. Fixed positioning goes through tooltipGeometry (below-first with above flip, center-first horizontal alignment flipping at viewport edges, clamping) at z-index 10500, above modals so buttons inside popups keep hints; it never claims the popup mutex — visibility is purely pointer/focus driven. The settings webview shares the same mechanism and class names.",
    "dom": "Appended to #app (falling back to body); a persistent singleton whose shown modifier class drives visibility.",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "tooltip-key": {
    "purpose": "A keybinding badge inside the hover hint (#300): operations with shortcuts split into a two-part hint — the name travels in data-tooltip and the keys in data-tooltip-keys (internally \\n-separated), one badge per chord segment. The display connector is the badge form itself, not the common.keySeparator text join.",
    "dom": "Direct children of the .vsidian-tooltip-keys area inside .vsidian-tooltip (an internal layout shell, not a public entry).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-background": {
    "purpose": "The hover hint card background (#300): defaults to the host --vscode-editorHoverWidget-background — light text on a dark card in dark themes and the inverse in light themes, adapting in step with native host hovers. A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-foreground": {
    "purpose": "The hover hint text foreground (#300): defaults to the host editorHover foreground, adapting across themes. A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-border": {
    "purpose": "The hover hint border (#300): defaults to the host editorHover border — a hairline in light themes, nearly none in dark ones, strengthened automatically in high-contrast themes. A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-radius": {
    "purpose": "The hover hint corner radius (#300). A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-font-size": {
    "purpose": "The hover hint font size (#300). A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-max-width": {
    "purpose": "The hover hint max width (#300): longer copy such as error reasons wraps past this bound. A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-key-background": {
    "purpose": "The keybinding badge background (#300): defaults to the host editorHover status-bar tint. A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-key-foreground": {
    "purpose": "The keybinding badge foreground (#300): defaults to the host description foreground. A public variable overridable by CSS snippets.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "var-tooltip-show-delay": {
    "purpose": "The hover hint show delay in unitless milliseconds (#300): the controller reads it via getComputedStyle; published as a behavioral variable so snippets can tune the pacing.",
    "dom": "Defined on #app (the same-named container in both the editor and settings webviews).",
    "obsidian": {
      "counterpart": "None (Obsidian tooltips expose no customization interface)"
    }
  },
  "toast-container": {
    "purpose": "Independent lightweight notification channel centered at the bottom of the editor viewport; preserves focus and does not block input.",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    },
    "states": "At most one visible message; independent from host notifications."
  },
  "toast": {
    "purpose": "Local notification card; text wraps without truncating action guidance.",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    },
    "states": "data-severity is neutral, warning or error; animation states are internal."
  },
  "toast-severity": {
    "purpose": "Severity selectors: neutral follows the theme, warning is pale yellow, error pale red; high contrast uses theme foreground and borders.",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-background": {
    "purpose": "Neutral background, follows the current theme",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-foreground": {
    "purpose": "Neutral text color, follows the current theme",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-border": {
    "purpose": "Neutral border, follows the current theme",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-background": {
    "purpose": "Pale yellow warning background, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-foreground": {
    "purpose": "Warning text color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-border": {
    "purpose": "Warning border color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-background": {
    "purpose": "Pale red error background, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-foreground": {
    "purpose": "Error text color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-border": {
    "purpose": "Error border color, adapted to light/dark and high contrast themes",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-radius": {
    "purpose": "Notification corner radius",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-font-size": {
    "purpose": "Notification font size",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-padding-inline": {
    "purpose": "Notification horizontal padding",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-padding-block": {
    "purpose": "Notification vertical padding",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-max-width": {
    "purpose": "Maximum width, also clamped by viewport margins",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-viewport-margin": {
    "purpose": "Horizontal viewport margin",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-bottom-offset": {
    "purpose": "Offset from the editor viewport bottom, plus safe area",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-shadow": {
    "purpose": "Notification shadow",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-enter-distance": {
    "purpose": "Upward entrance distance; removed when reduced motion is preferred",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-enter-duration": {
    "purpose": "Entrance animation duration (CSS time)",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-exit-duration": {
    "purpose": "Exit animation duration (CSS time)",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-duration": {
    "purpose": "Neutral display duration in unitless milliseconds",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-warning-duration": {
    "purpose": "Warning display duration in unitless milliseconds",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "var-toast-error-duration": {
    "purpose": "Error display duration in unitless milliseconds",
    "dom": "Defined on #app; the container is a direct child and does not scroll with the document.",
    "obsidian": {
      "counterpart": "None (Vsidian local lightweight notifications)"
    }
  },
  "paste-dialog-overlay": {
    "purpose": "Overlay for the paste-formatting prompt; cancellation creates no edit.",
    "states": "Mounted only when formatting can be converted and prompting is enabled; stale results cannot insert after mode or target changes.",
    "dom": "Direct child of #app, covering the current editor viewport.",
    "obsidian": {
      "counterpart": "None (Vsidian paste prompt)"
    }
  },
  "paste-dialog": {
    "purpose": "Dialog with Keep formatting, Paste text only, Cancel and a Do not show again checkbox; Tab cycles focus and Escape cancels.",
    "states": "Choice applies to this paste; checking Remember saves two preferences only when not cancelled.",
    "dom": "Direct child of .vsidian-paste-dialog-overlay; role=dialog and aria-modal=true.",
    "obsidian": {
      "counterpart": "None (Vsidian paste prompt)"
    }
  }
} as Readonly<Record<string, StyleContractEntryOverride>>
