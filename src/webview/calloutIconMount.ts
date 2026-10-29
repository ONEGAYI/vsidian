// Callout 图标装载器（#657/T06）：--callout-icon 公开自定义变量的运行期
// 消费面。机制（T01 §6.2 / §8 探针结论 + Obsidian 1.14.4 setIcon 同型）：
// 默认渲染走 CSS mask 通道（T03 的 --_vsidian-callout-icon 类型表，零
// JS）；本模块只在该变量被用户片段设置且解析成功时，把 SVG 以 innerHTML
// 注入 .callout-icon 并挂内部类关闭 mask（颜色随类型色：库 SVG 用
// currentColor 描边，与 Obsidian `.callout-icon .svg-icon` 同款）。
//
// 触发面（各场景复测有效，规格 §8.2）：
// - Live：标记 widget toDOM 后下一帧解析（视口回收/显隐重建天然重解析）；
// - 阅读：块挂载钩（onBlockMounted → mountCalloutIcons）；
// - 片段热更新：syncController 在 snippets.snapshot 应用与装载回报处调度
//   全量刷新（scheduleCalloutIconRefresh）；head 子元素增删的兜底观察器
//   覆盖文档样式产物等直接装配面；
// - 明暗主题：body class 翻转经同一观察器重解析。
//
// 安全：SVG 字符串经 htmlSanitize 单一净化面（DOMPurify——脚本/事件
// mXSS 由其默认矩阵拦截），图标语境追加外链剥离（a/image/use 元素移除、
// 非 # 片段 href 属性移除——内部渐变引用保留）；不新增资源授权、不越
// CSP。非法值（未知 ID / 净化后无内容 / 垃圾形态）保留默认图标并给可查
// 诊断：console.warn（webview 开发者工具可查，与剪贴板降级等同口径）+
// 可注入诊断 sink（syncController 接 TestDiagnostics）；同 (类型,值) 键
// 去重不刷屏。
import { CALLOUT_ICON_LIBRARY, calloutIconLibraryKeyOf, parseCalloutIconValue } from '../shared/calloutIcon'
import { calloutTypeOf } from '../shared/calloutSyntax'
import { sanitizeHtmlBlockMarkup } from './htmlSanitize'

/** 注入态内部类（内部状态标记，非公开契约——公开面是 --callout-icon 变量） */
export const CALLOUT_ICON_CUSTOM_CLASS = 'vsidian-callout-icon-custom'

/** 诊断出口（TestDiagnostics 观测面；生产由 syncController 注入）——
 * data 形状对齐 TestDiagnostics.record 的取值域 */
type CalloutIconDiagnosticsSink = (
  stage: string,
  data: Record<string, string | number | boolean | null>,
) => void
let diagnosticsSink: CalloutIconDiagnosticsSink | undefined

export function setCalloutIconDiagnosticsSink(sink: CalloutIconDiagnosticsSink | undefined): void {
  diagnosticsSink = sink
}

/** 诊断去重键（类型 × 值；值变化即新键再诊断） */
const diagnosedKeys = new Set<string>()

/** 注册表图标名（如 lucide-flame / help-circle / quote-glyph）→ 库键 */
function registryIconKeyOf(registryName: string): string | null {
  return calloutIconLibraryKeyOf(registryName.toLowerCase().replace(/^lucide-/, ''))
}

/** 图标语境剥离的元素（外链/引用载体——图标不消费外部资源与引用） */
const STRIPPED_ICON_ELEMENTS = ['a', 'image', 'use', 'script', 'foreignobject']

/** 剥离后仍算有效内容的元素（几何/文字/定义载体——防空壳图标伪报成功） */
const EFFECTIVE_ICON_ELEMENTS =
  'path, rect, circle, ellipse, line, polyline, polygon, text, tspan, g, defs, linearGradient, radialGradient, filter, mask'

/**
 * SVG 图标字符串净化：htmlSanitize 单一净化面（DOMPurify 默认矩阵剥脚本/
 * 事件/mXSS）+ 图标语境后处理（外链元素移除、非 # 片段 href 剥离——内部
 * 渐变/滤镜引用保留）。净化后无有效 svg 根或剥空（无任何可绘制内容）返回
 * null（调用方按非法值诊断——注入空壳会「伪报定制成功」）。
 */
export function sanitizeCalloutIconSvg(markup: string): string | null {
  const sanitized = sanitizeHtmlBlockMarkup(markup)
  if (!sanitized.includes('<svg')) {
    return null
  }
  const container = document.createElement('div')
  container.innerHTML = sanitized
  for (const el of [...container.querySelectorAll('*')]) {
    if (STRIPPED_ICON_ELEMENTS.includes(el.tagName.toLowerCase())) {
      el.remove()
      continue
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if ((name === 'href' || name === 'xlink:href') && !attr.value.trimStart().startsWith('#')) {
        el.removeAttribute(attr.name)
      }
    }
  }
  const svg = container.querySelector('svg')
  if (!svg || svg.textContent?.trim() === '' && !svg.querySelector(EFFECTIVE_ICON_ELEMENTS)) {
    return null
  }
  return svg.outerHTML
}

/** 装载决策：默认（mask 通道）/ 注入 / 非法（保留默认 + 诊断语义） */
export type CalloutIconDecision =
  | { readonly action: 'default' }
  | { readonly action: 'inject'; readonly svg: string }
  | { readonly action: 'invalid'; readonly reason: string }

/**
 * 决策（纯函数，jsdom 可测）：值等于该类型注册表默认图标时跳过注入——
 * 类型表自带的默认 --callout-icon 与之相等，mask 默认通道已画同款造型
 * （几何同源由契约测试钉住），避免常规路径 DOM 改动。
 */
export function decideCalloutIcon(raw: string, defaultIcon: string): CalloutIconDecision {
  const spec = parseCalloutIconValue(raw)
  switch (spec.kind) {
    case 'none':
      return { action: 'default' }
    case 'id': {
      const key = calloutIconLibraryKeyOf(spec.id)
      if (key === null) {
        // 诊断带用户原始值（含 lucide- 前缀照录），可定位到具体片段行
        return { action: 'invalid', reason: `未知图标 ID（不在随包 lucide-static 0.462.0 锁版集合内）：${raw.trim()}` }
      }
      if (key === registryIconKeyOf(defaultIcon)) {
        return { action: 'default' }
      }
      return { action: 'inject', svg: CALLOUT_ICON_LIBRARY[key]! }
    }
    case 'svg': {
      const sanitized = sanitizeCalloutIconSvg(spec.markup)
      if (sanitized === null) {
        return { action: 'invalid', reason: `SVG 值净化后无有效内容（脚本/事件/外链已剥离）：${spec.markup.slice(0, 60)}` }
      }
      return { action: 'inject', svg: sanitized }
    }
    case 'invalid':
      return { action: 'invalid', reason: spec.reason }
  }
}

/**
 * 解析并应用一个图标元素（幂等：先复位默认态再按决策应用——值撤回后
 * 注入内容清除）。类型取最近 [data-callout] 祖先（Live 行元素/阅读容器
// 均携带；嵌套取最近即最内层，与行属性胜出口径一致）。
 */
export function applyCalloutIcon(el: Element): void {
  const type = el.closest('[data-callout]')?.getAttribute('data-callout') ?? ''
  const raw = getComputedStyle(el).getPropertyValue('--callout-icon')
  const decision = decideCalloutIcon(raw, calloutTypeOf(type).icon)
  if (decision.action === 'inject') {
    el.classList.add(CALLOUT_ICON_CUSTOM_CLASS)
    el.innerHTML = decision.svg
    return
  }
  el.classList.remove(CALLOUT_ICON_CUSTOM_CLASS)
  el.innerHTML = ''
  if (decision.action === 'invalid') {
    const key = `${type}::${raw.trim()}`
    if (!diagnosedKeys.has(key)) {
      diagnosedKeys.add(key)
      console.warn(`[vsidian] callout 图标值无法解析，已保留默认图标（类型=${type || '未知'}）：${decision.reason}`)
      diagnosticsSink?.('callout.icon.invalid', { type, value: raw.trim(), reason: decision.reason })
    }
  }
}

/** 批量解析 root 下全部图标（阅读块挂载钩口径） */
export function mountCalloutIcons(root: ParentNode): void {
  for (const el of root.querySelectorAll('.callout-icon')) {
    applyCalloutIcon(el)
  }
}

/** widget toDOM 后下一帧解析（CM6 同步插入完成后 computed 值可读） */
export function scheduleCalloutIconResolve(el: Element): void {
  requestAnimationFrame(() => {
    if (el.isConnected) {
      applyCalloutIcon(el)
    }
  })
}

/** rAF 合帧的全量刷新（片段装载/主题翻转/文档样式装配后） */
let refreshScheduled = false
export function scheduleCalloutIconRefresh(): void {
  if (refreshScheduled) {
    return
  }
  refreshScheduled = true
  requestAnimationFrame(() => {
    refreshScheduled = false
    mountCalloutIcons(document)
  })
}

/**
 * 样式影响面观察器（幂等安装）：head 子元素增删（片段链 <link> 装配/
 * 摘除、文档样式产物 <style>）与 body class 翻转（明暗主题）→ 合帧刷新。
 * 片段 <link> 的「装载完成」时机仍以 syncController 的装载回报调度为准
 * （观察器在插入时即触发，早于 sheet 生效——双触发经 rAF 合帧与幂等应用
 * 自然收敛）。
 */
let styleWatchInstalled = false
export function initCalloutIconStyleWatch(): void {
  if (styleWatchInstalled || typeof MutationObserver === 'undefined') {
    return
  }
  styleWatchInstalled = true
  const observer = new MutationObserver(() => scheduleCalloutIconRefresh())
  observer.observe(document.head, { childList: true })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
}
