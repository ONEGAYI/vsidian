// 按需控件文案的 DOM 级就地重刷（#101 第三部分）：CM6 widget 与资源
// 状态机固化的 data-tooltip/aria-label 生命周期归装饰系统——换包触发的装饰
// 重算被按内容寻址的实例缓存 eq 短路，已物化 DOM 不重建（探索笔记 101
// §4.6，空事务 dispatch 路线已否定）——故不经 localeDom 注册表登记，
// 改由换包时按稳定类名 / data 属性扫描已物化控件就地改写
// （setMermaidDarkTheme 先例模式）。
//
// 扫描用 document 级查询：live widget、阅读挂载块与图表弹窗同在编辑器
// webview 文档内；设置页 webview 是独立 bundle、无这些控件，不引本模块。
//
// 新增按需控件接入清单：
// 1. 创建侧（widget toDOM / 状态机转换）用稳定类名或 data 属性标记控件；
// 2. 此处补一段扫描重写（data-tooltip/aria-label 取 t()，选择器引创建侧常量）；
// 3. localeRefreshContract.test.ts 的按需控件用例补对应断言。
// tableControls 不在此列：控件按钮每轮 render 全量重建取词，静止窗口
// 只剩层 aria-label，由 applyEditorLocale 兜底（探索笔记 §4.5）。
import { t } from '../shared/i18n'
import { CODE_CARD_CLASS_NAMES } from './liveCodeCard'
import { FM_CARD_CLASS_NAMES } from './frontmatterDecorations'
import { GRAPHIC_CHROME_CLASS_NAMES } from './graphicBlockChrome'
import { LIVE_CLASS_NAMES } from './liveDecorations'
import { DIAGRAM_POPUP_CLASS_NAMES } from './diagramPopup'
import { MATH_CLASS_NAMES } from '../shared/math'
import { refreshMermaidErrorLocale } from './mermaidRender'

/** 按钮类控件的双写共用段：选择器命中集就地重写 aria-label 与悬停词
 *  ——物化控件侧与常驻侧 bindLocaleAttrs 同一口径（fold 段的逐元素条件
 *  键经 labelOf(el) 承载）；悬停词承载属性为 data-tooltip（#300 起
 *  原生 title 退役，与 localeDom 映射同口径） */
function rewriteButtonLocale(
  root: ParentNode,
  selector: string,
  labelOf: (el: HTMLElement) => string,
): void {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    const label = labelOf(el)
    el.setAttribute('aria-label', label)
    el.setAttribute('data-tooltip', label)
  }
}

/** 换包后就地重刷已物化按需控件的固化文案（#101）：按钮类控件重写
 *  data-tooltip/aria-label（#300 起悬停词承载于 data-tooltip），mermaid
 *  错误占位经重渲染换词 */
export function refreshOnDemandControlLocale(root: ParentNode): void {
  // 代码卡片复制按钮（buildCopyButton，live 头部与阅读卡片共用 builder：
  // document 级扫描同时覆盖两视图已挂载块）
  rewriteButtonLocale(root, `.${CODE_CARD_CLASS_NAMES.copy}`, () => t('codeblock.copy'))
  // 折叠 chevron（buildFoldButton）：两态词按收起修饰类判定（收起态提示
  // 「展开」）；aria-expanded 是布尔多态、与语言无关，不动
  rewriteButtonLocale(root, `.${CODE_CARD_CLASS_NAMES.fold}`, (btn) =>
    t(btn.classList.contains(CODE_CARD_CLASS_NAMES.foldCollapsed)
      ? 'codeblock.expand'
      : 'codeblock.collapse'))
  // fm 卡片标题栏（FmCardHeaderWidget.toDOM 固化；live 首围栏行 widget 与
  // 阅读挂载块 decorateReadingFrontmatterCard 同类名，document 级扫描一并
  // 覆盖）：标题文字是文本节点（非属性，改写 textContent），「修改」按钮
  // 与折叠 chevron 双写——折叠钮两态词按收起修饰类判定（收起态提示
  // 「展开」），与代码卡折叠钮同口径；aria-expanded 与语言无关，不动
  for (const el of root.querySelectorAll<HTMLElement>(`.${FM_CARD_CLASS_NAMES.headerTitle}`)) {
    el.textContent = t('frontmatter.title')
  }
  rewriteButtonLocale(root, `.${FM_CARD_CLASS_NAMES.edit}`, () => t('frontmatter.edit'))
  rewriteButtonLocale(root, `.${FM_CARD_CLASS_NAMES.fold}`, (btn) =>
    t(btn.classList.contains(FM_CARD_CLASS_NAMES.foldCollapsed)
      ? 'frontmatter.expand'
      : 'frontmatter.collapse'))
  // 标题折叠 UI（#414 T03，gutter 箭头与省略号占位）：两态词按折叠修饰类
  // 判定（折叠态提示「展开」）；aria-expanded 与键位徽章属性（data-tooltip-
  // keys）语言无关，不动
  rewriteButtonLocale(root, '.vsidian-fold-arrow', (btn) =>
    t(btn.classList.contains('vsidian-fold-arrow-collapsed')
      ? 'headingfold.unfold'
      : 'headingfold.fold'))
  rewriteButtonLocale(root, '.vsidian-fold-ellipsis', () => t('headingfold.unfold'))
  // 图形化块按钮组（buildGraphicChrome）：edit（仅实时预览装配）与 popup
  rewriteButtonLocale(root, `.${GRAPHIC_CHROME_CLASS_NAMES.edit}`, () => t('graphic.editSource'))
  rewriteButtonLocale(root, `.${GRAPHIC_CHROME_CLASS_NAMES.popup}`, () => t('graphic.popup'))
  // 公式降级 span 的悬停词（LiveMathWidget.toDOM 失败分支；成功态是
  // KaTeX 排版，无本地化文案）
  for (const el of root.querySelectorAll<HTMLElement>(`.${MATH_CLASS_NAMES.mathError}`)) {
    el.setAttribute('data-tooltip', t('decor.mathError'))
  }
  // 图片错误态悬停词（imageResource.setSlotState 的 error 分支固化）：
  // reason 原文存于 data-vsidian-img-reason（缺失/unknown 回退
  // decor.unknownReason），据此重建插值。宿主 slot（live widget 容器与
  // 阅读 img）同带该 data 属性，一并覆盖
  for (const el of root.querySelectorAll<HTMLElement>('[data-vsidian-img-state="error"]')) {
    const reason = el.dataset['vsidianImgReason']
    el.setAttribute('data-tooltip', t('decor.imageError', {
      reason: reason && reason !== 'unknown' ? reason : t('decor.unknownReason'),
    }))
  }
  // 表格空格占位 widget（EmptyTableCellWidget.toDOM 固化 aria-label）：
  // 装饰是模块级单例实例（eq 恒成立），物化 DOM 不随换包重建；标记类
  // tableGridEmpty 只落空格物化物，普通格 mark 装饰不带（不误伤）；
  // active 态仅叠加修饰类，与常规态同词，一并覆盖
  for (const el of root.querySelectorAll<HTMLElement>(`.${LIVE_CLASS_NAMES.tableGridEmpty}`)) {
    el.setAttribute('aria-label', t('decor.emptyCell'))
  }
  // 图表弹窗（openGraphicPopup 固化；overlay 挂 body 直下，document 级
  // 扫描可达）：对话框可访问名 + 工具条 7 按钮双写（title/aria-label
  // 同词，与常驻侧 bindLocaleAttrs 同口径）。zoomLabel 是百分数字（与
  // 语言无关）；错误占位/降级提示条是瞬态文本（5 秒自消或下次装载重建）
  for (const el of root.querySelectorAll<HTMLElement>(`.${DIAGRAM_POPUP_CLASS_NAMES.overlay}`)) {
    el.setAttribute('aria-label', t('graphic.popup'))
  }
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.zoomOut}`, () => t('graphic.popupZoomOut'))
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.zoomIn}`, () => t('graphic.popupZoomIn'))
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.reset}`, () => t('graphic.popupReset'))
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.refresh}`, () => t('graphic.popupRefresh'))
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.exportSvg}`, () => t('graphic.popupExportSvg'))
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.exportPng}`, () => t('graphic.popupExportPng'))
  rewriteButtonLocale(root, `.${DIAGRAM_POPUP_CLASS_NAMES.close}`, () => t('graphic.popupClose'))
  // mermaid 错误占位是降级 DOM 文本（非属性），无法就地改写，经重渲染换词
  refreshMermaidErrorLocale(root)
}
