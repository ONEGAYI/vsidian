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
export const STYLE_GUIDE_VERSION = "0.6.0"

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
    "purpose": "无序列表行修饰：标记隐藏后以 ::before 圆点呈现。",
    "views": [
      "live"
    ],
    "states": "与 .vsidian-list-marker-visible 互斥（源码标记显形时抑制伪圆点）。",
    "dom": "列表行级叠加类；圆点绘制在 ::before。",
    "example": ".vsidian-list-line.vsidian-list-bullet::before {\n  color: #61afef;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 由 .cm-formatting-list 隐藏 + 原生列表样式承担）",
      "support": "native"
    },
    "verification": [
      "单元 liveDecorations：bullet/ordered 修饰契约"
    ],
    "introduced": "#8（2026-09-24）"
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
    "purpose": "安全表格的 CSS grid 网格行；活动格也保留；单元格仍与源区间对应（非独立表格数据模型）。#142 起列宽按内容比例分配：行装饰内联列宽计划（逐列 minmax(min(48px, 等分份额), 内容占比 fr)，同表各行共享同一计划），网格规则消费之；计划缺失时回退列数等分。片段按类规则覆写 grid-template-columns 仍优先生效。",
    "views": [
      "live"
    ],
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
    "purpose": "图片槽位基类：阅读视图为 <img> 元素本体（Obsidian img 标签选择器天然命中）；live 视图为 widget 容器 span（内部 img 由资源管理器装载，本项目自有形态）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "进入视口才发起装载；离开视口卸载释放（src 清空）。",
    "dom": "阅读：块内 img.vsidian-image；live：行内 widget span.vsidian-image > img。",
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
    "id": "image-solo-block",
    "domain": "content",
    "category": "link-image-wikilink",
    "kind": "selector",
    "target": ".vsidian-image-block（live 修饰类，叠加于 .vsidian-image）",
    "purpose": "live 独立成行图片的块级容器变体：整行仅含一张图片（其余文本全空白，含尾随空白）时 widget 槽位取块级布局，为无固有尺寸的图源（viewBox-only 百分比宽 SVG，mermaid 导出形态）提供确定宽度基准——此类图源在 inline-block shrink-to-fit 下渲染为 0×0（img 加载成功故静默无反馈，表现为空白行）；有固有尺寸的图源不受影响（块级下仍按自然宽度呈现）。已知边界：行内混排（列表前缀、混排文字、同行多图）的此类 SVG 仍为行内形态。",
    "views": [
      "live"
    ],
    "states": "装饰构建时按行判定（树驱动与宽松路径同口径）：行内 [from,to) 之外文本全空白即独立成行；三态修饰类照常叠加。",
    "dom": "live 行内 widget span.vsidian-image.vsidian-image-block > img（display: block）。",
    "example": ".vsidian-image-block {\n  display: block;\n}",
    "obsidian": {
      "counterpart": "无直接对应（Obsidian 无公开独立图片布局类）",
      "support": "native"
    },
    "verification": [
      "浏览器 liveImageLayout：真实 Chromium + 生产控制器——独行 viewBox-only SVG 渲染宽度铺满正文列（修复前 0×0）、固有尺寸图不拉伸、限宽档随列联动、阅读侧非回归",
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
    "purpose": "live 表格行背景 / 阅读表头背景；默认 rgba(128, 128, 128, 0.05)。",
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
    "purpose": "嵌入（![[…]] 等）结构未提供（双链残缺形态按原文显示）；blockquote 块已支持。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "无嵌入容器。",
    "example": "",
    "obsidian": {
      "counterpart": ".markdown-embed",
      "support": "none"
    },
    "verification": [
      "清单即边界"
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
    "purpose": "图形化代码块（渲染成图形的围栏）定位包裹层与右上角按钮组：edit 进源码编辑（仅实时预览）、popup 打开图表弹窗；按钮组悬停显隐由 CSS 驱动（透明度切换，DOM 常驻渲染成功态）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "渲染成功态显示按钮组（error 降级块不发射）；edit 按钮仅实时预览侧装配。",
    "dom": "live：围栏 widget 外层 frame；阅读：mermaid/图形容器外层 frame。按钮组挂 frame 内 absolute 右上。",
    "example": ".vsidian-graphic-chrome {\n  opacity: 1;\n}",
    "obsidian": {
      "counterpart": "无（Obsidian 图表块无公开按钮组结构）",
      "support": "none"
    },
    "verification": [
      "集成「图形化代码块按钮组与图表弹窗」（#111）：paint.graphic.frames/editButtons/popupButtons",
      "浏览器 graphicPopup：悬停显隐（透明度两态）",
      "集成「界面域样式契约」（#133）：chromeSelectors[\"graphic-chrome\"] 探针命中"
    ],
    "introduced": "#111（2026-09-26）"
  },
  {
    "id": "diagram-popup",
    "domain": "chrome",
    "category": "graphic-interact",
    "kind": "selector",
    "target": ".vsidian-diagram-overlay / -backdrop / -stage / -media / -toolbar / -zoom-in / -zoom-out / -zoom-label / -reset / -refresh / -export-svg / -export-png / -close / -error / -note",
    "purpose": "图表弹窗全屏浮层（#111）：遮罩 + 舞台（缩放/平移的图本体）+ 工具条（缩放/重置/刷新/导出/关闭）；error 态保留 close 与 refresh；note 为环境不支持 PNG 光栅化时的提示条。挂 document.body，仅在弹窗打开期间在场。",
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
      "浏览器 graphicPopup：原生键鼠路径（缩放/平移/Esc/导出）与样式保持"
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
    "target": ".vsidian-code-card-line",
    "purpose": "卡片覆盖的行级类：live 为源行级（含被清空的围栏行与全部代码行，承载卡片底色），阅读为卡内行 span（与 live 同类名，跨视图同口径）；与正文域 live-code-line 并行（live 卡片开启时两者都在场）。",
    "views": [
      "live",
      "reading"
    ],
    "dom": "live：.cm-line 行元素（卡片开启的围栏范围）；阅读：code 内 span.vsidian-reading-code-line。",
    "example": ".vsidian-code-card-line {\n  background: var(--vsidian-code-card-background);\n}",
    "obsidian": {
      "counterpart": ".HyperMD-codeblock（行族；正文域别名挂于 .vsidian-code-line，卡片行类为自有扩展）",
      "support": "semantic"
    },
    "verification": [
      "codeCardPaintCssContract：底色变量",
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
    "target": ".vsidian-fm-card-line（+ -edge-top / -edge-bottom 首尾围栏行修饰）",
    "purpose": "frontmatter 只读表格卡片的行级类：合法简单头区（标量 + 字符串数组）成型时覆盖头区全部行（含首尾围栏行与杂项行），承载左右边线（行区透明，撞色边界感由边框与标题栏微亮条承担），首尾围栏行补横线并做圆角修饰，拼装为完整边框圆角卡片。卡片行同时承载 vsidian-frontmatter-line（别名桥 direct 级承诺 .cm-hmd-frontmatter 在成型形态下保持命中，降透明副作用由卡片规则重置）。复杂类型/解析失败时整卡降级为 frontmatter-line 源码形态（见 limit-fm-complex-types）。",
    "views": [
      "live"
    ],
    "states": "常驻卡片（光标位置无关——成型态不暴露源码，光标进入头区被引导至闭合行后）；格不可点击编辑，编辑收敛到标题栏「修改」按钮的 Popover。",
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
    "target": ".vsidian-fm-header（标题栏容器；内含 .vsidian-fm-header-icon 图标 / .vsidian-fm-header-title 标题 / button.vsidian-fm-edit「修改」按钮）",
    "purpose": "卡片标题栏（首围栏行 replace widget）：微亮底色条（与透明行区形成撞色边界感）+ 列表图标 + Properties 标题（600 字重次级前景灰）+ 右上角圆角描边「修改」按钮（铅笔图标，hover/聚焦高亮）。行内前后 cm-widgetBuffer 隐藏（inline replace 的光标停靠点各占一行文字高，成型态光标不进头区无消费者）使头部行高收敛到约 1.2 倍正文行高。按钮点击开关属性编辑 Popover。阅读侧同容器内同类名同布局（无按钮，只读）。",
    "views": [
      "live",
      "reading"
    ],
    "states": "标题栏常驻两视图；按钮仅 live（阅读侧不发射）。",
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
    "purpose": "Modifier for unordered list lines: once the source marker is hidden, a ::before bullet takes its place.",
    "states": "Mutually exclusive with .vsidian-list-marker-visible (the pseudo-bullet is suppressed while the source marker is revealed).",
    "dom": "A line-level modifier class on list lines; the bullet is drawn on ::before.",
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
  "live-table-align": {
    "purpose": "Column alignment modifiers declared by the live delimiter row (applied to the trimmed content spans); the actual grid layout is handled by the grid-align classes.",
    "dom": "Span-level modifier classes on table cells.",
    "obsidian": {
      "counterpart": "No counterpart (alignment is handled by the rendered layout)"
    }
  },
  "live-table-grid-row": {
    "purpose": "The CSS grid row of safe tables; the active cell keeps the grid in place, and cells still map to their source ranges (not an independent table data model). Since #142 column widths are distributed by content proportion: the line decoration inlines a per-table column width plan (per column minmax(min(48px, equal share), content-proportion fr); all rows of a table share the same plan) which the grid rules consume, falling back to equal columns by count when the plan is missing. Snippet overrides of grid-template-columns through class rules still take precedence.",
    "dom": "The grid row container inside table rows (CSS grid layout).",
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
    "purpose": "Base class of the image slot: in reading view it is the <img> element itself (Obsidian img tag selectors match naturally); in live view it is a widget container span (the inner img is loaded by the resource manager — a vsidian-specific form).",
    "states": "Loading starts only when the slot enters the viewport; leaving the viewport unloads and releases it (src is cleared).",
    "dom": "Reading: img.vsidian-image inside the block. Live: an inline widget span.vsidian-image > img.",
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
  "image-solo-block": {
    "purpose": "Block container variant for an image standing alone on its line in live view: when the whole line holds a single image (all remaining text is whitespace, trailing whitespace included), the widget slot switches to block layout, providing a definite width basis for sources without intrinsic dimensions (viewBox-only percentage-width SVGs, the mermaid export form) — such sources collapse to 0×0 under inline-block shrink-to-fit (the img loads successfully, so the failure is silent and shows as a blank line). Sources with intrinsic dimensions are unaffected (they still render at natural width under block layout). Known boundary: such SVGs mixed inline with other content (list prefixes, surrounding text, multiple images on one line) keep the inline form.",
    "states": "Decided per line at decoration build time (same rule on the tree-driven and loose paths): the line counts as solo when all text outside the image range is whitespace; the three state modifier classes still stack on top.",
    "dom": "Live inline widget span.vsidian-image.vsidian-image-block > img (display: block).",
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
    "purpose": "Background of live table rows / the reading table header; defaults to rgba(128, 128, 128, 0.05).",
    "dom": "Defined on #app (centrally defined since #132; consumer sites previously carried inline fallbacks); Obsidian alias --table-background.",
    "obsidian": {
      "counterpart": "--table-background"
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
    "purpose": "Embed (![[…]] etc.) structures are not provided (incomplete wikilink forms are shown as-is); blockquote blocks are already supported.",
    "dom": "No embed containers exist.",
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
    "purpose": "The positioning wrapper of graphic code blocks (fences rendered as graphics) and its top-right button group: edit enters source editing (live preview only), popup opens the diagram popup; the group hover show/hide is CSS-driven (an opacity toggle; the DOM stays present in the rendered-success state).",
    "states": "The button group shows in the rendered-success state (error fallback blocks do not emit it); the edit button is assembled only on the live preview side.",
    "dom": "Live: the frame around the fence widget; reading: the frame around the mermaid/graphic container. The button group is absolutely positioned at the frame's top right.",
    "obsidian": {
      "counterpart": "None (Obsidian diagram blocks have no public button-group structure)"
    }
  },
  "diagram-popup": {
    "purpose": "The fullscreen overlay of the diagram popup (#111): backdrop + stage (the diagram body being zoomed/panned) + toolbar (zoom/reset/refresh/export/close); the error state keeps close and refresh; note is the notice bar shown when the environment does not support PNG rasterization. Attached to document.body and present only while the popup is open.",
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
    "purpose": "The line-level class covered by cards: in live view the source line level (including the cleared fence lines and all code lines, carrying the card background); in reading view the in-card line spans (same class name as live, same convention across views); runs in parallel with the content-domain live-code-line (both are present when live cards are enabled).",
    "dom": "Live: .cm-line line elements (the fence range with cards enabled); reading: span.vsidian-reading-code-line inside code.",
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
    "purpose": "Line-level class of the read-only frontmatter table card: when a legal simple header block (scalars + string arrays) is well-formed, it covers every line of the header block (including the opening/closing fence lines and stray lines) and carries the left/right border lines (the row area stays transparent — the contrasting boundary feel comes from the card border and the slightly brighter header strip); the opening/closing fence lines add horizontal rules and corner rounding, assembling a full bordered rounded card. Card lines also carry vsidian-frontmatter-line (the alias bridge promises at the direct level that .cm-hmd-frontmatter keeps matching in the well-formed shape; its transparency-lowering side effect is reset by the card rules). Complex types / parse failures degrade the whole card back to the frontmatter-line raw-source shape (see limit-fm-complex-types).",
    "states": "Persistent card (independent of cursor position — the well-formed state never exposes the raw source, and a cursor entering the header area is guided to just after the closing line); cells are not click-to-edit — editing is funneled into the Popover opened by the header bar Edit button.",
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
    "purpose": "The card header bar (a replace widget on the opening fence line): a slightly brighter background strip (creating the contrasting boundary feel against the transparent row area) + a list icon + a Properties title (600 weight, secondary-foreground gray) + a rounded outlined Edit button at the top right (pencil icon, highlighted on hover/focus). The cm-widgetBuffers before and after the inline replacement are hidden (the cursor parking spots of the inline replace each take one line of text height, and in the well-formed state the cursor never enters the header area so there are no consumers), pulling the header row height down to about 1.2x the body line height. Clicking the button toggles the property-editing Popover. The reading side renders the same container, class names and layout (no button, read-only).",
    "states": "The header bar is persistent in both views; the button exists only in live (not emitted on the reading side).",
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
  }
} as Readonly<Record<string, StyleContractEntryOverride>>
