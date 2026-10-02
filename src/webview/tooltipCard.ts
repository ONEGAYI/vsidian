// 统一自绘悬停提示的委托控制器（#300）。全站悬停呈现从原生 title 收敛到
// 此处：document 级事件委托监听 [data-tooltip]（经 localeDom/localeOnDemand
// 通道迁写的悬停词），不逐控件绑定。规格 docs/specs/tooltip.md。
//
// 行为口径：
// - 悬停经 --vsidian-tooltip-show-delay 延迟出现（JS 读计算值，注入可覆盖）；
//   焦点进入即时显示（键盘可达）；
// - 指针移入提示本体保活（文字可选中复制的前提），移出触发元素与本体的
//   联合区域即收；
// - 提示容器可聚焦（tabindex=0），自身持有焦点时 Esc 收起并还焦触发元素；
//   悬停路径零抢焦点——从不程序化 focus，选中只经用户主动交互；
// - 定位纯函数在 tooltipGeometry（下→上翻转、左右翻转、视口钳制）；
// - 不参与 popupMutex 争夺、z-index 置于模态之上：图表/图片/悬停预览弹窗
//   自身按钮也需要提示，互斥压制会使浮层内提示退化（规格「层级与互斥」）；
//   显隐纯指针/焦点驱动，模态遮罩拦截指针后外部目标天然不触发。
import { planTooltipPlacement } from './tooltipGeometry'
// 样式随模块进两入口各自动画产物（esbuild CSS 随 import 合并同名 .css）
import './tooltipCard.css'

/** 悬停词承载属性：原生 title 的继任者（title 退役防双气泡，契约扫描
 *  拦截回潮）。localeDom/localeOnDemand 两通道按此属性迁写 */
export const TOOLTIP_ATTR = 'data-tooltip'

/** 键位徽章属性：值内的键位段以 TOOLTIP_KEYS_SEPARATOR 分隔（内部形态，
 *  显示连接符由徽章样式承担，不走 common.keySeparator 显示串） */
export const TOOLTIP_KEYS_ATTR = 'data-tooltip-keys'

export const TOOLTIP_KEYS_SEPARATOR = '\n'

export const TOOLTIP_CLASS_NAMES = {
  card: 'vsidian-tooltip',
  shown: 'vsidian-tooltip--shown',
  text: 'vsidian-tooltip-text',
  keys: 'vsidian-tooltip-keys',
  key: 'vsidian-tooltip-key',
} as const

/** 出现延迟缺省值：CSS 变量不可读（jsdom/极端环境）时的兜底，与悬停
 *  预览既有节奏一致。导出供 targetTip 单测推进计时（jsdom 读不到变量
 *  时 resolveShowDelay 即回此值）——显示延迟缺省的单一事实源，不另设
 *  同值常量 */
export const DEFAULT_SHOW_DELAY_MS = 300

/** 解析出现延迟：读容器计算样式上的公开变量（ms），非法值回缺省。
 *  #299 起导出：跳转目标提示（targetTip）复用同一延迟口径（统一
 *  提示体系的显示延迟模型单一事实源，不另设常量） */
export function resolveShowDelay(container: HTMLElement): number {
  const raw = getComputedStyle(container).getPropertyValue('--vsidian-tooltip-show-delay')
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHOW_DELAY_MS
}

/** 节点是否在触发元素或提示本体的联合区域内（relatedTarget 在部分事件
 *  类型上宽松定型为 EventTarget，实例判断后按 Element 消费） */
function inLiveRegion(node: EventTarget | null, anchor: Element | null, container: HTMLElement): boolean {
  if (!(node instanceof Element)) return false
  return (anchor !== null && anchor.contains(node)) || container.contains(node)
}

export interface TooltipCardOptions {
  /** 出现延迟注入覆盖（测试）；生产走 CSS 变量读取 */
  showDelayMs?: number
  /** 挂载根注入（测试）；生产 #app ?? document.body */
  mountRoot?: ParentNode
}

/** 装配悬停提示委托层，返回 dispose。编辑器与设置页两个 webview 入口
 *  各调一次；模块无宿主依赖，重复装配各自独立（测试隔离） */
export function installTooltipCard(options: TooltipCardOptions = {}): () => void {
  const container = document.createElement('div')
  container.className = TOOLTIP_CLASS_NAMES.card
  container.tabIndex = 0
  container.setAttribute('role', 'tooltip')
  const text = document.createElement('span')
  text.className = TOOLTIP_CLASS_NAMES.text
  const keys = document.createElement('span')
  keys.className = TOOLTIP_CLASS_NAMES.keys
  container.append(text, keys)
  ;(options.mountRoot ?? document.getElementById('app') ?? document.body).appendChild(container)

  let anchor: Element | null = null
  // 延迟窗口内的最近候选（尚未 show）：mouseout 的联合区域判定用它，
  // 候选控件内部子元素间穿越不重置出现计时
  let pendingAnchor: Element | null = null
  let shown = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // Esc 还焦的一次性抑制：focus() 同步派发 focusin，若不抑制会在收起
  // 同拍内被 onFocusIn 命中重新显示（真实浏览器同样复现）
  let suppressNextFocusIn = false
  // 态变即时刷新（规格「行为规格」）：shown 态监听锚点的提示属性——
  // 值更新即重渲染重定位，属性移除即收（查找输入修正后「无效正则」
  // 不残留）
  const attributeObserver = new MutationObserver(() => {
    if (!shown || anchor === null) return
    const value = anchor.getAttribute(TOOLTIP_ATTR)
    if (value === null || value === '') {
      hide()
      return
    }
    render(anchor)
    place()
  })

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  /** 定位：显示态下按锚点几何落盘（shown 类已加、同帧内完成量测与写位，
   *  浏览器帧末绘制无闪烁） */
  const place = (): void => {
    if (anchor === null) return
    const rect = anchor.getBoundingClientRect()
    const plan = planTooltipPlacement({
      anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      tip: { width: container.offsetWidth, height: container.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    container.style.top = `${plan.top}px`
    container.style.left = `${plan.left}px`
  }

  const render = (target: Element): boolean => {
    const value = target.getAttribute(TOOLTIP_ATTR) ?? ''
    if (value === '') return false
    text.textContent = value
    keys.textContent = ''
    for (const part of (target.getAttribute(TOOLTIP_KEYS_ATTR) ?? '').split(TOOLTIP_KEYS_SEPARATOR)) {
      if (part === '') continue
      const key = document.createElement('span')
      key.className = TOOLTIP_CLASS_NAMES.key
      key.textContent = part
      keys.appendChild(key)
    }
    return true
  }

  const show = (target: Element): void => {
    // 候选消费即清：render 失败（属性被清空）的早退路径同样不可残留，
    // 否则残留候选会同候选短路后续 mouseover、延迟计时无法再起
    pendingAnchor = null
    if (!render(target)) return
    anchor = target
    shown = true
    container.classList.add(TOOLTIP_CLASS_NAMES.shown)
    place()
    attributeObserver.observe(target, {
      attributes: true,
      attributeFilter: [TOOLTIP_ATTR, TOOLTIP_KEYS_ATTR],
    })
  }

  const hide = (): void => {
    clearTimer()
    attributeObserver.disconnect()
    anchor = null
    pendingAnchor = null
    shown = false
    container.classList.remove(TOOLTIP_CLASS_NAMES.shown)
    text.textContent = ''
    keys.textContent = ''
  }

  const onMouseOver = (event: MouseEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<Element>(`[${TOOLTIP_ATTR}]`)
      : null
    if (target === null) return
    if (shown && target === anchor) return
    // 延迟窗口内重复进入同一候选（控件内部子元素间穿越的成对 mouseover）：
    // 计时已在跑，重入不重置
    if (!shown && target === pendingAnchor) return
    clearTimer()
    pendingAnchor = target
    if (target.getAttribute(TOOLTIP_ATTR) === '') {
      // 态变清空语义（如查找输入恢复合法）：命中空提示即收
      hide()
      return
    }
    const delay = options.showDelayMs ?? resolveShowDelay(container)
    timer = setTimeout(() => {
      timer = undefined
      show(target)
    }, delay)
  }

  const onMouseOut = (event: MouseEvent): void => {
    if (!shown && timer === undefined && pendingAnchor === null) return
    // 联合区域以「当前锚点或延迟窗口内候选」为基准：候选控件内部子元素
    // 间穿越（relatedTarget 仍在候选内）不收、不重置计时
    if (inLiveRegion(event.relatedTarget, anchor ?? pendingAnchor, container)) return
    hide()
  }

  const onFocusIn = (event: FocusEvent): void => {
    if (suppressNextFocusIn) {
      suppressNextFocusIn = false
      return
    }
    const target = event.target instanceof Element
      ? event.target.closest<Element>(`[${TOOLTIP_ATTR}]`)
      : null
    if (target === null) return
    clearTimer()
    show(target)
  }

  const onFocusOut = (event: FocusEvent): void => {
    if (!shown) return
    if (inLiveRegion(event.relatedTarget, anchor, container)) return
    hide()
  }

  const onKeydownCapture = (event: KeyboardEvent): void => {
    // 提示自身持有焦点时优先消费 Esc（document 捕获：hoverPopup 等既有
    // 浮层的捕获期 Esc 处理器 stopPropagation 不拦截同节点上的其他
    // listener，本处理器仍可达；stopImmediatePropagation 反向避免提示
    // 持焦时其他浮层再响应同一按键）
    if (event.key !== 'Escape' || document.activeElement !== container) return
    event.stopImmediatePropagation()
    const returnFocus = anchor
    suppressNextFocusIn = true
    hide()
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
      returnFocus.focus()
    }
    suppressNextFocusIn = false
  }

  const onResize = (): void => {
    if (shown) place()
  }

  const onScroll = (): void => {
    // 锚点随滚动漂移，瞬态提示直接收（capture 捕获各滚动容器）
    if (shown) hide()
  }

  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('mouseout', onMouseOut)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('keydown', onKeydownCapture, true)
  window.addEventListener('resize', onResize)
  document.addEventListener('scroll', onScroll, true)

  return () => {
    clearTimer()
    attributeObserver.disconnect()
    document.removeEventListener('mouseover', onMouseOver)
    document.removeEventListener('mouseout', onMouseOut)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('keydown', onKeydownCapture, true)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('scroll', onScroll, true)
    container.remove()
  }
}
