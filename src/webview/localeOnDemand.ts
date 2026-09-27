// 按需控件文案的 DOM 级就地重刷（#101 第三部分）：CM6 widget 与资源
// 状态机固化的 title/aria-label 生命周期归装饰系统——换包触发的装饰
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
// 2. 此处补一段扫描重写（title/aria-label 取 t()，选择器引创建侧常量）；
// 3. localeRefreshContract.test.ts 的按需控件用例补对应断言。
// tableControls 不在此列：控件按钮每轮 render 全量重建取词，静止窗口
// 只剩层 aria-label，由 applyEditorLocale 兜底（探索笔记 §4.5）。
import { t } from '../shared/i18n'
import { CODE_CARD_CLASS_NAMES } from './liveCodeCard'
import { GRAPHIC_CHROME_CLASS_NAMES } from './graphicBlockChrome'
import { MATH_CLASS_NAMES } from '../shared/math'
import { refreshMermaidErrorLocale } from './mermaidRender'

/** 换包后就地重刷已物化按需控件的固化文案（#101）：按钮类控件重写
 *  title/aria-label，mermaid 错误占位经重渲染换词 */
export function refreshOnDemandControlLocale(root: ParentNode): void {
  // 代码卡片复制按钮（buildCopyButton，live 头部与阅读卡片共用 builder：
  // document 级扫描同时覆盖两视图已挂载块）
  for (const btn of root.querySelectorAll<HTMLElement>(`.${CODE_CARD_CLASS_NAMES.copy}`)) {
    const label = t('codeblock.copy')
    btn.setAttribute('aria-label', label)
    btn.title = label
  }
  // 折叠 chevron（buildFoldButton）：两态词按收起修饰类判定（收起态提示
  // 「展开」）；aria-expanded 是布尔多态、与语言无关，不动
  for (const btn of root.querySelectorAll<HTMLElement>(`.${CODE_CARD_CLASS_NAMES.fold}`)) {
    const label = t(
      btn.classList.contains(CODE_CARD_CLASS_NAMES.foldCollapsed)
        ? 'codeblock.expand'
        : 'codeblock.collapse',
    )
    btn.setAttribute('aria-label', label)
    btn.title = label
  }
  // 图形化块按钮组（buildGraphicChrome）：edit（仅实时预览装配）与 popup
  for (const btn of root.querySelectorAll<HTMLElement>(`.${GRAPHIC_CHROME_CLASS_NAMES.edit}`)) {
    const label = t('graphic.editSource')
    btn.setAttribute('aria-label', label)
    btn.title = label
  }
  for (const btn of root.querySelectorAll<HTMLElement>(`.${GRAPHIC_CHROME_CLASS_NAMES.popup}`)) {
    const label = t('graphic.popup')
    btn.setAttribute('aria-label', label)
    btn.title = label
  }
  // 公式降级 span 的 title（LiveMathWidget.toDOM 失败分支；成功态是
  // KaTeX 排版，无本地化文案）
  for (const el of root.querySelectorAll<HTMLElement>(`.${MATH_CLASS_NAMES.mathError}`)) {
    el.title = t('decor.mathError')
  }
  // 图片错误态 title（imageResource.setSlotState 的 error 分支固化）：
  // reason 原文存于 data-vsidian-img-reason（缺失/unknown 回退
  // decor.unknownReason），据此重建插值。宿主 slot（live widget 容器与
  // 阅读 img）同带该 data 属性，一并覆盖
  for (const el of root.querySelectorAll<HTMLElement>('[data-vsidian-img-state="error"]')) {
    const reason = el.dataset['vsidianImgReason']
    el.title = t('decor.imageError', {
      reason: reason && reason !== 'unknown' ? reason : t('decor.unknownReason'),
    })
  }
  // mermaid 错误占位是降级 DOM 文本（非属性），无法就地改写，经重渲染换词
  refreshMermaidErrorLocale(root)
}
