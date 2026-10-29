// Callout 类型菜单取色预览（#658/T07）：三级类型页（「插入 → Callout →
// 类型」与 Live 标题右键「Callout 类型」共用）的逐行实际配色与逐项分隔
// 线（分隔线在 contextMenuDom 的 itemSeparators 通道，本模块只管配色）。
//
// 取色方法（T01 报告 §8 定型，规格 callout.md §7「逐行颜色与分隔线」）：
// 菜单打开时在 #app 内创建 visibility:hidden; position:absolute 探针，探针
// 根**自带正文样式上下文所需祖先**——阅读作用域形态（.markdown-preview-view）
// 与 Live 作用域形态（.markdown-source-view.mod-cm6，两者并挂——片段按任一
// Obsidian 作用域书写均命中；分别书写不同色时无法同真，属规格「不承诺完全
// 复刻」边界）与**文档样式身份**（data-vsidian-doc-scope，docStyleLoader
// 产物的作用域钩），内放 13 规范类型的 .callout[data-callout] 探针元素
// （带 .callout-title/.callout-icon 真实结构），经 getComputedStyle 读
// 计算值：--callout-color（原样串——标准色或 RGB 三元组，菜单侧以同款
// 双通道表达式消费，互斥语义与正文一致）、标题计算色、图标底色/mask/
// --callout-icon（自定义图标经 calloutIconMount.decideCalloutIcon 同一
// 解析路径，与正文图标同源）。「无 Callout」行用普通引用呈现（引用底色
// 变量 + --vsidian-quote-bar-color 竖条，同正文行消费的变量）。
//
// 硬边界（票面 + 规格）：不在菜单按钮上挂 .callout 冒充正文上下文（探针
// 才带 .callout；菜单 DOM 零 callout 类名/属性，只内联复制计算值）——正文
// 布局规则（片段对 .callout 的 padding/布局改写）不可能接管菜单点击区域；
// 探针隐藏定位零占位（T01 §8 布局隔离实测同款）；自定义输入动作行保持
// 菜单语义（透明占位槽，不伪装固定类型）；打开菜单及主题/片段变化时经
// head 子元素增删 + body class 翻转观察器（calloutIconMount 同款目标）
// rAF 合帧重读重绘，关闭即 dispose 归零——不常驻任何重型实例；任意内容
// 位置或复杂 :has() 选择器不承诺完全复刻（规格 §7 口径，样式参考已写明）。
import { CALLOUT_TYPES } from '../shared/calloutSyntax'
import { OBSIDIAN_DOM_ALIASES } from '../shared/obsidianAlias'
import { decideCalloutIcon } from './calloutIconMount'
import { ROOT_DOC_SCOPE } from './liveHtml'

/** 探针根类（内部样式锚：隐藏定位零占位；非公开契约） */
export const CALLOUT_MENU_PROBE_CLASS = 'vsidian-callout-menu-probe'
/** 类型行预览槽（挂在按钮内文案前，样式契约 context-menu 条目 -swatch 族） */
export const CALLOUT_MENU_SWATCH_CLASS = 'vsidian-context-menu-swatch'
/** 预览槽内图标位（mask 通道或净化 SVG 注入态） */
export const CALLOUT_MENU_SWATCH_ICON_CLASS = 'vsidian-context-menu-swatch-icon'
/** 自定义图标注入态（关闭 mask、currentColor 随类型色——calloutIconMount 同款语义） */
export const CALLOUT_MENU_SWATCH_ICON_CUSTOM_CLASS = 'vsidian-context-menu-swatch-icon-custom'

export interface CalloutMenuPreviewHandle {
  /** 重读探针并重绘（片段装载回报等样式落地后的显式刷新口） */
  refresh(): void
  /** 摘观察器并移除探针（幂等） */
  dispose(): void
}

export interface CalloutMenuPreviewOptions {
  /** 探针宿主（#app——继承 #app 作用域的 --callout-* 变量与主题覆盖） */
  scopeRoot: HTMLElement
  /** 文档样式身份键（docStyleLoader 产物的作用域钩；缺省根文档 'doc'） */
  docScope?: string
}

/** 命令标识 → 类型行归类（none=普通引用呈现 / custom=菜单语义占位） */
const typeRowKindOf = (
  command: string,
): { kind: 'type'; id: string } | { kind: 'none' } | { kind: 'custom' } | null => {
  if (!command.startsWith('calloutType:')) {
    return null
  }
  const suffix = command.slice('calloutType:'.length)
  if (suffix === 'none') {
    return { kind: 'none' }
  }
  if (suffix === 'custom') {
    return { kind: 'custom' }
  }
  return CALLOUT_TYPES.some((entry) => entry.id === suffix) ? { kind: 'type', id: suffix } : null
}

/** 装配探针 DOM：根带双作用域祖先 + 文档样式身份，13 类型各一个真实结构 */
function buildProbe(docScope: string): HTMLElement {
  const probe = document.createElement('div')
  // 祖先形态取别名桥单一事实源（liveContainer 去 cm-s-obsidian——该类只
  // 是主题容器标记，探针不需要；readingContainer 即 .markdown-preview-view）
  const scopeAncestors = [
    ...OBSIDIAN_DOM_ALIASES.readingContainer,
    ...OBSIDIAN_DOM_ALIASES.liveContainer.filter((name) => name !== 'cm-s-obsidian'),
  ]
  probe.className = [CALLOUT_MENU_PROBE_CLASS, ...scopeAncestors].join(' ')
  probe.setAttribute('aria-hidden', 'true')
  probe.setAttribute('data-vsidian-doc-scope', docScope)
  // 隐藏定位（T01 §8：布局零影响——不在正文流内占位、不接指针）
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.width = '0'
  probe.style.height = '0'
  probe.style.overflow = 'hidden'
  for (const entry of CALLOUT_TYPES) {
    const callout = document.createElement('div')
    callout.className = 'callout'
    callout.setAttribute('data-callout', entry.id)
    const title = document.createElement('div')
    title.className = 'callout-title'
    const icon = document.createElement('span')
    icon.className = 'callout-icon'
    const inner = document.createElement('span')
    inner.className = 'callout-title-inner'
    inner.textContent = entry.id
    title.append(icon, inner)
    const content = document.createElement('div')
    content.className = 'callout-content'
    callout.append(title, content)
    probe.appendChild(callout)
  }
  return probe
}

/** 读取一个类型探针元素的计算外观（菜单侧只内联复制，不复制解析逻辑） */
function readTypePaint(probe: HTMLElement, id: string): {
  colorRaw: string
  titleColor: string
  iconColor: string
  iconMask: string
  iconVar: string
  radius: string
} {
  const el = probe.querySelector<HTMLElement>(`.callout[data-callout="${id}"]`)!
  const style = getComputedStyle(el)
  const title = el.querySelector<HTMLElement>('.callout-title')!
  const icon = el.querySelector<HTMLElement>('.callout-icon')!
  const iconStyle = getComputedStyle(icon)
  const mask = iconStyle.maskImage && iconStyle.maskImage !== 'none'
    ? iconStyle.maskImage
    : iconStyle.webkitMaskImage ?? ''
  return {
    colorRaw: style.getPropertyValue('--callout-color').trim(),
    titleColor: getComputedStyle(title).color,
    iconColor: iconStyle.backgroundColor,
    iconMask: mask,
    iconVar: iconStyle.getPropertyValue('--callout-icon').trim(),
    radius: style.getPropertyValue('--callout-radius').trim(),
  }
}

/** 行内预览槽（幂等：在场即复用，仅更新内联值） */
function ensureSwatch(btn: HTMLButtonElement): HTMLElement {
  let swatch = btn.querySelector<HTMLElement>(`.${CALLOUT_MENU_SWATCH_CLASS}`)
  if (!swatch) {
    swatch = document.createElement('span')
    swatch.className = CALLOUT_MENU_SWATCH_CLASS
    swatch.setAttribute('aria-hidden', 'true')
    btn.insertBefore(swatch, btn.firstChild)
  }
  return swatch
}

/** 单行绘制：类型行消费同一 CSS 解析结果（内联变量 + 双通道表达式在 CSS 侧） */
function paintTypeRow(btn: HTMLButtonElement, probe: HTMLElement, id: string, baseColor: string): void {
  const entry = CALLOUT_TYPES.find((e) => e.id === id)!
  const read = readTypePaint(probe, id)
  const swatch = ensureSwatch(btn)
  swatch.className = `${CALLOUT_MENU_SWATCH_CLASS}`
  swatch.style.setProperty('--callout-color', read.colorRaw)
  if (read.radius) {
    swatch.style.setProperty('--vsidian-callout-menu-radius', read.radius)
  }
  // 图标：默认走 mask 通道（形状与颜色都是正文图标计算值）；自定义值经
  // decideCalloutIcon 同一解析路径（净化 SVG 注入 / 非法保留默认——正文
  // 侧已诊断，菜单侧不重复刷屏）
  let icon = swatch.querySelector<HTMLElement>(`.${CALLOUT_MENU_SWATCH_ICON_CLASS}`)
  if (!icon) {
    icon = document.createElement('span')
    icon.className = CALLOUT_MENU_SWATCH_ICON_CLASS
    swatch.appendChild(icon)
  }
  const decision = decideCalloutIcon(read.iconVar, entry.icon)
  if (decision.action === 'inject') {
    icon.classList.add(CALLOUT_MENU_SWATCH_ICON_CUSTOM_CLASS)
    icon.innerHTML = decision.svg
  } else {
    icon.classList.remove(CALLOUT_MENU_SWATCH_ICON_CUSTOM_CLASS)
    icon.innerHTML = ''
  }
  icon.style.setProperty('--vsidian-callout-menu-icon-mask', read.iconMask)
  icon.style.setProperty('--vsidian-callout-menu-icon-color', read.iconColor)
  // 标题字色：仅在被片段实际定制时落到菜单文案（默认 = 正文继承前景，
  // 与菜单默认前景不同源——不落值避免菜单默认观感漂移）
  const label = btn.querySelector<HTMLElement>('.vsidian-context-menu-label')
  if (label) {
    if (read.titleColor && read.titleColor !== baseColor) {
      label.style.color = read.titleColor
    } else {
      label.style.color = ''
    }
  }
}

/**
 * 装配类型页取色预览：菜单含 calloutType:* 行时创建探针并绘制，返回生命
 * 周期句柄（refresh 显式重读；dispose 摘观察器移探针）；不含类型行（其他
 * 菜单/大纲菜单）返回 null 零影响。主题/片段变化的被动刷新经 head 子元素
 * 增删与 body class 翻转观察器（片段 <link> 装载完成时机以调用方在装载
 * 回报处 refresh 为准——观察器在插入时即触发，早于 sheet 生效，双触发经
 * rAF 合帧与幂等应用自然收敛）。
 */
export function mountCalloutMenuPreview(
  menu: HTMLElement,
  options: CalloutMenuPreviewOptions,
): CalloutMenuPreviewHandle | null {
  const rows = new Map<HTMLButtonElement, ReturnType<typeof typeRowKindOf>>()
  for (const btn of Array.from(menu.querySelectorAll<HTMLButtonElement>('button[data-vsidian-command]'))) {
    const kind = typeRowKindOf(btn.dataset['vsidianCommand'] ?? '')
    if (kind) {
      rows.set(btn, kind)
    }
  }
  if (rows.size === 0) {
    return null
  }
  const probe = buildProbe(options.docScope ?? ROOT_DOC_SCOPE)
  options.scopeRoot.appendChild(probe)

  let disposed = false
  let refreshQueued = false

  const paint = (): void => {
    if (disposed) {
      return
    }
    const baseColor = getComputedStyle(probe).color
    const quoteBar = getComputedStyle(probe).getPropertyValue('--vsidian-quote-bar-color').trim()
    for (const [btn, kind] of rows) {
      if (!btn.isConnected || kind === null) {
        continue
      }
      if (kind.kind === 'type') {
        paintTypeRow(btn, probe, kind.id, baseColor)
        continue
      }
      const swatch = ensureSwatch(btn)
      if (kind.kind === 'none') {
        // 无 Callout：普通引用呈现（引用底色变量族 + 紫条变量，CSS 侧同
        // 正文行消费；竖条色经探针内联透传——菜单在 #app 外不继承该变量）
        swatch.className = `${CALLOUT_MENU_SWATCH_CLASS} ${CALLOUT_MENU_SWATCH_CLASS}-quote`
        if (quoteBar) {
          swatch.style.setProperty('--vsidian-quote-bar-color', quoteBar)
        }
      } else {
        // 自定义输入：透明占位（保列对齐），无类型色底——菜单语义不伪装
        swatch.className = `${CALLOUT_MENU_SWATCH_CLASS} ${CALLOUT_MENU_SWATCH_CLASS}-placeholder`
      }
      swatch.style.removeProperty('--callout-color')
      swatch.style.removeProperty('--vsidian-callout-menu-radius')
      const label = btn.querySelector<HTMLElement>('.vsidian-context-menu-label')
      if (label) {
        label.style.color = ''
      }
    }
  }
  paint()

  let observer: MutationObserver | undefined
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      if (refreshQueued || disposed) {
        return
      }
      refreshQueued = true
      requestAnimationFrame(() => {
        refreshQueued = false
        paint()
      })
    })
    observer.observe(document.head, { childList: true })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }

  return {
    refresh: paint,
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      observer?.disconnect()
      observer = undefined
      probe.remove()
    },
  }
}
