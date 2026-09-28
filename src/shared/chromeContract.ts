// 界面域公开样式契约渲染验证探针表（#133）：chrome 域条目的稳定类名在
// 真实渲染中可被外部样式表定位的**机器证据表**——与正文域
// obsidianAlias.ts 的 OBSIDIAN_ALIAS_PROBES 同构，但选择器按 **vsidian
// 稳定类名**书写（chrome 条目以 semantic/native 级为主，Obsidian 原名
// 不承诺命中）。
//
// 探针资产三处同源（缺一即不一致，由 test/unit/chromeContract.test.ts
// 钉住）：
// 1. 本表：id（对应清单条目，可带 -live/-reading 后缀消歧）+ 定位选择器
//    + 期望 outline-color；
// 2. media/css-contract-probe.css：以本表选择器逐条书写探针规则（规则
//    形态与 #132 别名探针一致——outline-color 在 outline-style none 时
//    无视觉影响，与既有 text-decoration-color 探针体系正交）；
// 3. webview 采集（syncController 的 cssProbe.chromeSelectors）：按本表
//    在 **document 域**定位（界面域目标不全在编辑器两视图容器内——大纲
//    面板挂侧栏、图表弹窗挂 body）读自定义属性 --vsidian-chrome-probe
//    的 computed 值——不可见（天然无视觉影响），且与 #132 别名探针的
//    outline-color、更早的 text-decoration-color 两套探针完全正交
//    （同一元素挂多套探针类时零层叠串扰）。
//
// 选择器结构性：规则按真实 DOM 层级书写（如 `.vsidian-math .katex` 证明
// KaTeX 结构在稳定容器内、`.vsidian-graphic-frame .vsidian-graphic-chrome`
// 证明按钮组挂在渲染容器上）——类名挂错节点时选择器不命中，探针即 null。
//
// 覆盖边界（诚实声明）：本表只覆盖**静态可命中**的条目；交互态类
// （located/collapsed/dragging/drop-*/menu/rename/copy-done/fold-collapsed/
// slider-active/nomatch/search-hit、弹窗与暂停横幅的在场态）由既有
// 浏览器/集成套件按行为路径验证（见各条目 verification 字段），探针表
// 不为动态态伪造静态断言。

/** 界面域渲染验证探针（cssProbe.chromeSelectors 的单一事实源） */
export interface ChromeContractProbe {
  /** 清单条目 ID（或「条目 ID-视图」消歧后缀，如 live-math-block-live） */
  id: string
  /** document 域内定位选择器（与 probe.css 探针规则同形，含 #app 前缀） */
  selector: string
  /** probe.css 探针规则的期望 outline-color（期望值与规则同源） */
  expected: string
}

/**
 * 界面域探针表：期望色采用 `rgb(2xx, 0, 1)` 步进 1 的互异序列——与
 * #132 别名探针的 `rgb(n, n+1, n+2)` 家族肉眼可辨，失败时可定位条目。
 */
export const CHROME_CONTRACT_PROBES: readonly ChromeContractProbe[] = [
  // ---- 公式（live 侧；reading 侧见各 -reading 探针） ----
  { id: 'live-math-live', selector: '#app .vsidian-view-live .vsidian-math .katex', expected: 'rgb(200, 0, 1)' },
  { id: 'live-math-block-live', selector: '#app .vsidian-view-live .vsidian-math-block', expected: 'rgb(201, 0, 1)' },
  { id: 'math-error-live', selector: '#app .vsidian-view-live .vsidian-math-error', expected: 'rgb(202, 0, 1)' },
  { id: 'reading-math-block', selector: '#app .vsidian-view-reading .vsidian-reading-math .katex-block', expected: 'rgb(203, 0, 1)' },
  { id: 'math-error-reading', selector: '#app .vsidian-view-reading .vsidian-math-error', expected: 'rgb(204, 0, 1)' },
  // ---- 图表（Mermaid；rendered 态门控——挂载即容器、渲染完成才带 SVG） ----
  { id: 'mermaid-container-live', selector: '#app .vsidian-view-live .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]', expected: 'rgb(205, 0, 1)' },
  { id: 'mermaid-svg-live', selector: '#app .vsidian-view-live .vsidian-mermaid[data-vsidian-mermaid-state="rendered"] svg', expected: 'rgb(206, 0, 1)' },
  { id: 'mermaid-error', selector: '#app .vsidian-view-live .vsidian-mermaid-error-message', expected: 'rgb(207, 0, 1)' },
  { id: 'reading-mermaid-block', selector: '#app .vsidian-view-reading .vsidian-reading-mermaid', expected: 'rgb(208, 0, 1)' },
  { id: 'mermaid-container-reading', selector: '#app .vsidian-view-reading .vsidian-reading-mermaid .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]', expected: 'rgb(209, 0, 1)' },
  // ---- 图形化代码块按钮组（#111） ----
  { id: 'graphic-chrome', selector: '#app .vsidian-view-live .vsidian-graphic-frame .vsidian-graphic-chrome', expected: 'rgb(210, 0, 1)' },
  // ---- 代码块卡片与语法高亮（live + reading 双侧同类名） ----
  { id: 'live-code-card-line-live', selector: '#app .vsidian-view-live .vsidian-code-card-line', expected: 'rgb(211, 0, 1)' },
  { id: 'live-code-card-header-live', selector: '#app .vsidian-view-live .vsidian-code-card-header', expected: 'rgb(212, 0, 1)' },
  { id: 'live-code-card-header-parts-live', selector: '#app .vsidian-view-live .vsidian-code-card-header-label', expected: 'rgb(213, 0, 1)' },
  { id: 'live-code-card-linenumber-live', selector: '#app .vsidian-view-live .vsidian-code-card-linenumber', expected: 'rgb(214, 0, 1)' },
  { id: 'tok-tokens-live', selector: '#app .vsidian-view-live .vsidian-code-card-line .tok-keyword', expected: 'rgb(215, 0, 1)' },
  { id: 'reading-code-card', selector: '#app .vsidian-view-reading .vsidian-reading-code-card', expected: 'rgb(216, 0, 1)' },
  { id: 'live-code-card-line-reading', selector: '#app .vsidian-view-reading .vsidian-code-card-line', expected: 'rgb(217, 0, 1)' },
  { id: 'live-code-card-linenumber-reading', selector: '#app .vsidian-view-reading .vsidian-code-card-linenumber', expected: 'rgb(218, 0, 1)' },
  { id: 'tok-tokens-reading', selector: '#app .vsidian-view-reading .vsidian-reading-code-card .tok-keyword', expected: 'rgb(219, 0, 1)' },
  // ---- 大纲面板（侧栏；DOM 常驻，显隐由 CSS 类控制，探针不受影响） ----
  { id: 'outline-item', selector: '#app .vsidian-sidebar .vsidian-outline-item.vsidian-outline-level-1', expected: 'rgb(220, 0, 1)' },
  { id: 'outline-guide', selector: '#app .vsidian-sidebar .vsidian-outline-item .vsidian-outline-guide', expected: 'rgb(229, 0, 1)' },
  { id: 'outline-inline-marks', selector: '#app .vsidian-sidebar .vsidian-outline-strong', expected: 'rgb(221, 0, 1)' },
  { id: 'outline-slider', selector: '#app .vsidian-sidebar .vsidian-outline-slider', expected: 'rgb(222, 0, 1)' },
  { id: 'outline-slider-dot', selector: '#app .vsidian-sidebar .vsidian-outline-slider-dot', expected: 'rgb(223, 0, 1)' },
  { id: 'outline-chevron', selector: '#app .vsidian-sidebar .vsidian-outline-chevron', expected: 'rgb(224, 0, 1)' },
  { id: 'outline-toolbar', selector: '#app .vsidian-sidebar .vsidian-outline-toolbar', expected: 'rgb(225, 0, 1)' },
  { id: 'outline-toolbar-buttons', selector: '#app .vsidian-sidebar .vsidian-outline-toolbar .vsidian-outline-reset', expected: 'rgb(226, 0, 1)' },
  { id: 'outline-search', selector: '#app .vsidian-sidebar .vsidian-outline-toolbar .vsidian-outline-search', expected: 'rgb(227, 0, 1)' },
  // ---- 编辑器顶栏（#4；#38 起模式切换迁宿主标题栏，顶栏为自有三按钮；
  // #141 起第四按钮双态视图切换——body 模式类为模式态类，不伪造静态探针） ----
  { id: 'toolbar', selector: '#app .vsidian-toolbar', expected: 'rgb(228, 0, 1)' },
  { id: 'view-toggle', selector: '#app .vsidian-toolbar .vsidian-view-toggle', expected: 'rgb(236, 0, 1)' },
  // ---- frontmatter 只读表格卡片（#140 Popover 改版；live 侧 + 阅读侧
  //      同款表格。标题栏是常驻静态入口可探针；Popover 容器为交互态
  //      （打开时挂载），不伪造静态探针，由浏览器套件行为验证） ----
  { id: 'live-fm-card-line-live', selector: '#app .vsidian-view-live .vsidian-fm-card-line', expected: 'rgb(230, 0, 1)' },
  { id: 'live-fm-row-live', selector: '#app .vsidian-view-live .vsidian-fm-row', expected: 'rgb(231, 0, 1)' },
  { id: 'live-fm-cell-live', selector: '#app .vsidian-view-live .vsidian-fm-row > .vsidian-fm-cell', expected: 'rgb(232, 0, 1)' },
  { id: 'live-fm-row-reading', selector: '#app .vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-row', expected: 'rgb(233, 0, 1)' },
  { id: 'live-fm-cell-reading', selector: '#app .vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-cell', expected: 'rgb(234, 0, 1)' },
  { id: 'live-fm-header-live', selector: '#app .vsidian-view-live .vsidian-fm-header', expected: 'rgb(237, 0, 1)' },
  // ---- 代码块卡片折行开关（#191；仅阅读侧发射，非收起块头部常驻在场） ----
  { id: 'live-code-card-wrap-reading', selector: '#app .vsidian-view-reading .vsidian-code-card-wrap', expected: 'rgb(238, 0, 1)' },
]
