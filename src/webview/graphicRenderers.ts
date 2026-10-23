// 图形化代码块渲染器注册表（工单 #111，规格 docs/specs/
// graphic-code-block-interaction.md）：webview 侧管线注册表——按钮组、
// 图表弹窗、禁点击进编辑等路径级行为全部读本表驱动，新渲染语言登记
// 即继承全部交互。共享侧 RENDERED_FENCE_LABELS（shared/mermaid.ts）是
// 「哪些语言算渲染型围栏」的判定与标签事实源；本表是「渲染管线在哪」的
// 事实源。两侧键集一致性由契约测试钉住（每键须有标签、每管线须有
// 渲染实现），「登记即继承」由假想第二渲染器用例验证（不引入真实依赖）。
//
// #358 T09 多提供者适配：本表降格为**内置提供者**的管线事实源（保留原
// 两表同步约定——新增内置图形语言仍走下方三步接入清单）；生效提供者的
// 判定与挂载统一经 effectiveGraphicRendererFor / renderGraphicIntoContainer：
// 附加组件提供者（生效表驱动，见 webview/addonRenderers.ts）优先，内置
// 注册表兜底——内置实现作为候选保留（ADR-0012 Q28）。容器携带
// GRAPHIC_PROVIDER_ATTR 所有权标记：接管切换先释放旧提供者、换新容器
// 挂载（旧容器脱离文档——旧代次迟到结果写入脱离节点，不回潮）。
//
// T12（#361）故障升级：生效组件提供者的 mount 抛出未捕获异常时上报
// 全组件故障（bindAddonFaultReporter 注入的装载器上报槽——宿主裁决后
// 整组件回收、生效表重算回内置，即「整组件故障降级停用后内置可接管」
// 一档）；自处理渲染失败（组件捕获自己的异常或仅输出错误内容）不上
// 报——仍运行的渲染 bug 不伪造停用状态（ADR-0012 Q30）。
//
// 接入清单（新增**内置**图形化渲染语言的三步）：
// 1. shared/mermaid.ts 的 RENDERED_FENCE_LABELS 登记语言显示名；
// 2. 本表登记 { renderInto, renderSvg }（renderInto 负责容器内渲染与
//    降级态，renderSvg 供弹窗/导出取矢量产物，缓存口径与 mermaidRender
//    对齐）；
// 3. 契约测试补一行（test/unit/graphicRenderers.test.ts 的语言枚举）。
// 按钮/弹窗/禁点击/导出自动继承，无需逐处适配。已知边界：主题明暗切换
// 的全量重渲仍走 mermaidRender 的 mermaid 专属扫描（setMermaidDarkTheme），
// 内置第二渲染语言或附加组件接入时经 refreshAddonGraphicBlocks 联动
//（附加组件走 refresh 回调或 release+mount 重建）。
import {
  renderMermaidInto,
  renderMermaidSvg,
  type MermaidSvgResult,
} from './mermaidRender'
import {
  GRAPHIC_LANG_ATTR,
  GRAPHIC_MODE_ATTR,
  GRAPHIC_PROVIDER_ATTR,
  MERMAID_CLASS_NAMES,
  MERMAID_CODE_ATTR,
  MERMAID_STATE_ATTR,
} from '../shared/mermaid'
import type { AddonRendererMode, AddonRendererRegistration } from '../shared/addonRenderers'
import { addonRenderersBridge } from './addonRenderers'

/** 图形化代码块渲染管线（webview 侧能力面） */
export interface GraphicRenderer {
  /** 容器内渲染（含降级态；live widget 内层容器与阅读挂载容器共用） */
  renderInto(container: HTMLElement, code: string): void
  /** 取渲染 SVG 字符串（缓存优先；图表弹窗与导出共用一条取图路径） */
  renderSvg(code: string): Promise<MermaidSvgResult>
}

const mermaidRenderer: GraphicRenderer = {
  renderInto: renderMermaidInto,
  renderSvg: renderMermaidSvg,
}

const registry = new Map<string, GraphicRenderer>([
  ['mermaid', mermaidRenderer],
])

/** 语言（trim 后 info）→ 内置渲染管线；未登记返回 undefined（调用方降级） */
export function graphicRendererFor(language: string): GraphicRenderer | undefined {
  return registry.get(language.trim())
}

// ---- T12（#361）渲染回调故障上报槽（main.ts 在装载器安装后绑定） ----

/** 组件回调异常的升级入口（装载器 reportRuntimeFault 的模块级转发） */
let addonFaultReporter: ((addonId: string, stage: string, detail: string) => boolean) | undefined

/** 绑定/解绑上报槽（main.ts 装配；undefined 复位供测试隔离） */
export function bindAddonFaultReporter(
  reporter: ((addonId: string, stage: string, detail: string) => boolean) | undefined,
): void {
  addonFaultReporter = reporter
}

/** 生效提供者 mount 的可归因异常上报（组件 + 提供者 + 原因） */
function reportRendererFault(providerId: string, err: unknown): void {
  const separator = providerId.indexOf('/')
  const addonId = separator > 0 ? providerId.slice(0, separator) : providerId
  addonFaultReporter?.(addonId, 'renderer-mount', `${providerId}: ${String(err)}`)
}

/** 已登记内置语言清单（观测与契约测试） */
export function graphicRendererLanguages(): readonly string[] {
  return [...registry.keys()]
}

/** 测试钩子：注册假想渲染器验证「登记即继承」（返回清理函数还原） */
export function __registerGraphicRendererForTest(
  language: string,
  renderer: GraphicRenderer,
): () => void {
  registry.set(language, renderer)
  return () => {
    registry.delete(language)
  }
}

/** 某语言某模式当前生效管线（附加组件提供者优先，内置注册表兜底；
 *  无可用提供者返回 undefined——调用方降级普通代码块或源码+卡片） */
export function effectiveGraphicRendererFor(language: string, mode: AddonRendererMode): GraphicRenderer | undefined {
  const resolved = addonRenderersBridge()?.resolve(language, mode)
  if (resolved?.kind === 'addon') {
    return addonRegistrationAsGraphicRenderer(resolved.registration, resolved.providerId, language, mode)
  }
  return graphicRendererFor(language)
}

/** 某语言某模式是否有可用生效管线（发射 gate 与按钮装配的布尔口径） */
export function hasEffectiveGraphicRenderer(language: string, mode: AddonRendererMode): boolean {
  return effectiveGraphicRendererFor(language, mode) !== undefined
}

/** 某语言的弹窗/导出取图能力（chrome 按钮与导出降级依据）：内置管线恒有
 *  renderSvg；附加组件按其 exportFormats['svg'] 声明 */
export function effectiveGraphicSvgExport(language: string, mode: AddonRendererMode): boolean {
  const resolved = addonRenderersBridge()?.resolve(language, mode)
  if (resolved?.kind === 'addon') {
    return resolved.registration.exportFormats.includes('svg')
  }
  return graphicRendererFor(language) !== undefined
}

/** 渲染型围栏显示名：生效组件声明优先（经桥），内置标签表兜底，未知语言
 *  返回 undefined（调用方回退 info 原文） */
export function effectiveGraphicLabel(language: string): string | undefined {
  return addonRenderersBridge()?.renderedFenceLabel(language) ?? undefined
}

/** 组件注册 → GraphicRenderer 管线适配（挂载带所有权标记） */
function addonRegistrationAsGraphicRenderer(
  registration: AddonRendererRegistration,
  providerId: string,
  language: string,
  mode: AddonRendererMode,
): GraphicRenderer {
  return {
    renderInto(container: HTMLElement, code: string): void {
      container.setAttribute(GRAPHIC_PROVIDER_ATTR, providerId)
      try {
        registration.mount(container, code, { language, mode })
      } catch (err) {
        // T12：可归因挂载异常上报全组件故障；弹窗调用链不外溢
        reportRendererFault(providerId, err)
      }
    },
    async renderSvg(code: string): Promise<MermaidSvgResult> {
      if (registration.exportSvg) {
        try {
          return { ok: true, svg: await registration.exportSvg(code, language) }
        } catch (err) {
          return { ok: false, message: String(err) }
        }
      }
      return { ok: false, message: `renderer '${registration.rendererId}' declares no svg export` }
    },
  }
}

// ---- 挂载与所有权（#358 T09） ----

/**
 * T06（#545）容器归属查询：元素是否落在某附加组件渲染提供者的容器内
 * （GRAPHIC_PROVIDER_ATTR 标记的容器本体或其后代——refViews 嵌入挂载的
 * 容器合法性判定之一）。providerId 形态 `${addonId}/${rendererId}`；
 * 内置标记（'builtin'，无 `/`）不属于任何组件，返回 null。
 */
export function graphicProviderAddonOwnerOf(el: HTMLElement): string | null {
  const host = el.closest<HTMLElement>(`[${GRAPHIC_PROVIDER_ATTR}]`)
  if (host === null) {
    return null
  }
  const providerId = host.getAttribute(GRAPHIC_PROVIDER_ATTR) ?? ''
  const separator = providerId.indexOf('/')
  return separator > 0 ? providerId.slice(0, separator) : null
}

/** 释放容器当前的附加组件所有者（内置无释放语义）；重复释放无害。
 *  release 与 mount/refresh 同为组件回调，异常同等隔离（上报 + 不中断
 *  本轮其余容器的联动/热切换）——劣质组件 refresh 抛错后走兜底重挂的
 *  release 是高概率连带抛错点 */
function releaseOwner(container: HTMLElement): void {
  const providerId = container.getAttribute(GRAPHIC_PROVIDER_ATTR)
  if (!providerId || providerId === 'builtin') {
    return
  }
  const separator = providerId.indexOf('/')
  const registration = separator > 0
    ? addonRenderersBridge()?.registrationOf(providerId.slice(0, separator), providerId.slice(separator + 1))
    : undefined
  container.removeAttribute(GRAPHIC_PROVIDER_ATTR)
  try {
    registration?.release?.(container, {
      language: (container.getAttribute(GRAPHIC_LANG_ATTR) ?? '').trim(),
      mode: (container.getAttribute(GRAPHIC_MODE_ATTR) === 'live' ? 'live' : 'reading') as AddonRendererMode,
    })
  } catch (err) {
    reportRendererFault(providerId, err)
  }
}

/**
 * 把某语言某代码渲染进容器（生效提供者判定 + 所有权标记 + 内置兜底）。
 * 容器是新造的（widget toDOM / 阅读挂载 / 热切换换新）：只做首次挂载，
 * 不做切换——切换走 remountGraphicContainer（换新容器，旧容器脱离文档，
 * 旧提供者的迟到异步结果写入脱离节点，不回潮）。
 */
export function renderGraphicIntoContainer(container: HTMLElement, code: string, language: string, mode: AddonRendererMode): void {
  const lang = language.trim()
  container.setAttribute(GRAPHIC_LANG_ATTR, lang)
  container.setAttribute(MERMAID_CODE_ATTR, code)
  container.setAttribute(GRAPHIC_MODE_ATTR, mode)
  const resolved = addonRenderersBridge()?.resolve(lang, mode)
  if (resolved?.kind === 'addon') {
    container.setAttribute(GRAPHIC_PROVIDER_ATTR, resolved.providerId)
    container.setAttribute(MERMAID_STATE_ATTR, 'pending')
    try {
      resolved.registration.mount(container, code, { language: lang, mode })
      // mount 是同步入口：返回即视为本次挂载完成，容器状态交平台标记
      //（chrome 按钮组与既有 CSS 的 rendered 态选择器因此对组件容器同样
      //  生效）。mount 抛出未捕获异常 → T12 上报全组件故障（停用后内置
      //  按规则接管）；容器即时停留 error 态，停用与接管由宿主链路完成
      //  ——自处理失败（组件自行 catch）不上报、生效者不变（Q30）。
      container.setAttribute(MERMAID_STATE_ATTR, 'rendered')
    } catch (err) {
      container.setAttribute(MERMAID_STATE_ATTR, 'error')
      console.warn(`[vsidian] 渲染提供者 ${resolved.providerId} mount 异常（已上报全组件故障）：`, err)
      reportRendererFault(resolved.providerId, err)
    }
    return
  }
  const builtin = graphicRendererFor(lang)
  container.setAttribute(GRAPHIC_PROVIDER_ATTR, 'builtin')
  if (!builtin) {
    // 无可用提供者：停留无状态（调用方降级普通代码块/源码+卡片——多见于
    // 切换瞬态，下一轮分派恢复）
    return
  }
  container.setAttribute(MERMAID_STATE_ATTR, 'pending')
  builtin.renderInto(container, code)
}

/**
 * 热切换重挂载：释放旧提供者、以**新容器**替换旧容器并按当前生效提供者
 * 挂载（frame/chrome 等父级结构原样保留——内层容器整换）。返回新容器
 * （旧容器已脱离文档；无图形属性的原样返回自身）。
 */
export function remountGraphicContainer(existing: HTMLElement, mode: AddonRendererMode): HTMLElement {
  const language = (existing.getAttribute(GRAPHIC_LANG_ATTR) ?? '').trim()
  const code = existing.getAttribute(MERMAID_CODE_ATTR) ?? ''
  if (language === '' || code === '') {
    return existing
  }
  releaseOwner(existing)
  const fresh = document.createElement('div')
  fresh.className = MERMAID_CLASS_NAMES.diagram
  fresh.setAttribute(GRAPHIC_LANG_ATTR, language)
  fresh.setAttribute(MERMAID_CODE_ATTR, code)
  fresh.setAttribute(GRAPHIC_MODE_ATTR, mode)
  fresh.setAttribute(MERMAID_STATE_ATTR, 'pending')
  existing.replaceWith(fresh)
  renderGraphicIntoContainer(fresh, code, language, mode)
  return fresh
}

/** 生效提供者是否与容器当前所有者不同（热切换扫描的换新判据；内置与
 *  内置视为相同） */
export function graphicContainerOwnerChanged(container: HTMLElement, mode: AddonRendererMode): boolean {
  const language = (container.getAttribute(GRAPHIC_LANG_ATTR) ?? '').trim()
  const resolved = addonRenderersBridge()?.resolve(language, mode)
  const currentOwner = container.getAttribute(GRAPHIC_PROVIDER_ATTR) ?? 'builtin'
  const effectiveOwner = resolved?.kind === 'addon' ? resolved.providerId : 'builtin'
  return currentOwner !== effectiveOwner
}

/**
 * 渲染容器分派入口（阅读挂载钩子；live 侧由 widget 发射 gate 直接走
 * renderGraphicIntoContainer）：扫描 root（含自身）内 pending 态图形容器，
 * 按 GRAPHIC_LANG_ATTR 经生效提供者解析渲染；无可用提供者的语言跳过
 * （容器停留 pending 降级，不回落内置误渲非内置语言）。「登记即继承」
 * 在阅读挂载钩子的落点。
 */
export function renderGraphicBlockInto(root: ParentNode, owns?: (el: Element) => boolean): void {
  const targets: HTMLElement[] = []
  if (
    root instanceof HTMLElement &&
    root.getAttribute(GRAPHIC_LANG_ATTR) !== null &&
    root.getAttribute(MERMAID_STATE_ATTR) === 'pending'
  ) {
    targets.push(root)
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${GRAPHIC_LANG_ATTR}]`))) {
    if (owns !== undefined && !owns(el)) {
      continue
    }
    if (el.getAttribute(MERMAID_STATE_ATTR) === 'pending') {
      targets.push(el)
    }
  }
  for (const el of targets) {
    const language = (el.getAttribute(GRAPHIC_LANG_ATTR) ?? '').trim()
    if (!hasEffectiveGraphicRenderer(language, 'reading')) {
      continue
    }
    renderGraphicIntoContainer(el, el.getAttribute(MERMAID_CODE_ATTR) ?? '', language, 'reading')
  }
}

/**
 * #358 T09 生效表变化的全文档热切换扫描：所有图形容器里所有者已变化的
 * 换新容器重挂（释放旧提供者；主文档阅读块随调用方的整篇重渲染替换，
 * 本扫描兜住嵌入阅读内容等不随主重渲染走的容器）。幂等：所有者未变的
 * 容器零动作。
 */
export function remountChangedGraphicBlocks(root: ParentNode): void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>(`[${GRAPHIC_LANG_ATTR}]`))
  for (const el of containers) {
    const mode: AddonRendererMode = el.getAttribute(GRAPHIC_MODE_ATTR) === 'live' ? 'live' : 'reading'
    if (graphicContainerOwnerChanged(el, mode)) {
      remountGraphicContainer(el, mode)
    }
  }
}

/**
 * 主题明暗切换的附加组件联动（内置 mermaid 走 setMermaidDarkTheme 的专属
 * 扫描；附加组件经 refresh 回调就地刷新，未提供 refresh 走 release+换新
 * 容器重挂）。只处理附加组件所有的容器。
 */
export function refreshAddonGraphicBlocks(root: ParentNode): void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>(`[${GRAPHIC_PROVIDER_ATTR}]`))
  for (const el of containers) {
    const providerId = el.getAttribute(GRAPHIC_PROVIDER_ATTR)
    if (!providerId || providerId === 'builtin') {
      continue
    }
    const separator = providerId.indexOf('/')
    const registration = separator > 0
      ? addonRenderersBridge()?.registrationOf(providerId.slice(0, separator), providerId.slice(separator + 1))
      : undefined
    if (!registration) {
      continue
    }
    const language = (el.getAttribute(GRAPHIC_LANG_ATTR) ?? '').trim()
    const code = el.getAttribute(MERMAID_CODE_ATTR) ?? ''
    const mode: AddonRendererMode = el.getAttribute(GRAPHIC_MODE_ATTR) === 'live' ? 'live' : 'reading'
    if (registration.refresh) {
      try {
        registration.refresh(el, code, { language, mode })
        continue
      } catch (err) {
        // 组件 refresh 抛错不中断本轮其余容器的主题联动（对齐 mount 的
        // 捕获+上报处理）；退化为整容器重挂保内容新鲜
        reportRendererFault(providerId, err)
      }
    }
    remountGraphicContainer(el, mode)
  }
}

// ---- T09 绘制观测纯函数（#629 探针语义修正） ----

/** 文档范围内渲染容器里的 svg 按所有权分桶：builtin 只计内置容器（含无
 *  所有权标记的历史容器），addon 计组件接管容器——热切换重挂载的新容器
 *  无论内置/组件一律挂 .vsidian-mermaid 类，按类名全量计数会把组件渲染
 *  出的 SVG 误计入「内置 SVG 在场数」（#629 主缺陷），所有权判定一律经
 *  GRAPHIC_PROVIDER_ATTR 最近祖先 */
export function graphicSvgCountByOwner(scope: ParentNode): { builtin: number; addon: number } {
  let builtin = 0
  let addon = 0
  for (const svg of Array.from(scope.querySelectorAll(`.${MERMAID_CLASS_NAMES.diagram} svg`))) {
    const host = svg.closest(`[${GRAPHIC_PROVIDER_ATTR}]`)
    if (host !== null && host.getAttribute(GRAPHIC_PROVIDER_ATTR) !== 'builtin') {
      addon += 1
    } else {
      builtin += 1
    }
  }
  return { builtin, addon }
}

/** UA 默认不参与绘制的元素（无布局语义；mermaid 内嵌 <style>——Codex
 *  预设把 themeCSS 烘焙进 svg——是 #629 旧 fallback 误命中 display:none
 *  节点的典型，width 探针因此恒 0） */
const NON_PAINTED_TAGS = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE'])

/**
 * 图形容器内组件渲染内容的代表元素（paint.renderers 容器条目 width/color
 * 的观测对象）。选择序：
 * 1. 显式断言锚（fixture 组件的 t09-box / data-t09-renderer）——组件
 *    作者声明的观测标记语义最强；
 * 2. 容器内首个 svg——真 SVG 绘制产物的最强证据；
 * 3. 首个非 UA 隐藏、非 display:none 且带非空文本的叶子元素——error
 *    占位文本等仍可观测（区分渲染成败靠 builtinSvg/addonSvg 计数与
 *    svg 代表元素，不靠 width 归零）。
 */
export function graphicRendererContentEl(container: HTMLElement): Element | null {
  const box = container.querySelector<HTMLElement>('[data-t09-renderer]') ?? container.querySelector<HTMLElement>('.t09-box')
  if (box !== null) {
    return box
  }
  const svg = container.querySelector('svg')
  if (svg !== null) {
    return svg
  }
  for (const child of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
    if (child.childElementCount !== 0 || (child.textContent ?? '').trim() === '') {
      continue
    }
    if (NON_PAINTED_TAGS.has(child.tagName) || getComputedStyle(child).display === 'none') {
      continue
    }
    return child
  }
  return null
}
