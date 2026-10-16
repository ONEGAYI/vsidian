// #569（T04）文档样式装载器（webview 层）：CSSOM 解析适配 + head 产物
// 生命周期（ADR-0019 决定 3/4）。
//
// - **b2 产物**：全文 <style> 收集（shared/docStyle 纯逻辑）→ CSSOM
//   解析为规则树 → shared 改写核心 → 单一 <style> 挂 document.head
//   **末尾**（决策点 2：文档后置——实测片段在前时同特异性文档胜，
//   就近直觉；snippetLoader 的片段链契约零改写）。观测属性
//   data-vsidian-doc-style="<docScope>"（样式契约条目同源）。
// - **生命周期**：DocStyleRegistry 按 docScope 键引用计数——同一 B 的
//   多实例共享同一产物（acquire/release 配对，归零移除元素，释放后
//   无残留规则）。DocumentStyleBinding 是一个视图侧句柄：sync 随全文
//   源文更新（Live 经 ViewPlugin 事务驱动；Reading/嵌入经 render 驱动），
//   dispose 释放。装载不依赖样式块 DOM 在场——虚拟化卸载/离屏/源码
//   显形不触碰本产物（探针 M6/M8 证据）。
// - **CSSOM 不可用降级**：不装载（安全方向——无样式而非泄漏样式；
//   规格口径「样式失配不提示错误」，装载失败无用户可见提示面）。
// - 解析容错：replaceSync 对非法 CSS 不抛（引擎按原生规则丢弃坏规则）；
//   真抛异常（理论不可达）时同样拒收该批产物。
import {
  collectDocumentStyles,
  rewriteDocStyleRuleTree,
  type DocStyleRule,
  type DocStyleSource,
} from '../shared/docStyle'
import { needsDocumentBaseResolution, rewriteCssUrls, scanCssUrls } from '../shared/htmlResource'
import type { HtmlResourceOutcome } from './htmlResourceHub'

/** head 产物 style 元素的观测属性名（样式契约 doc-style-injection 条目同源） */
export const DOC_STYLE_ELEMENT_ATTR = 'data-vsidian-doc-style'

/**
 * #570（T05）文档样式的资源解析端口：订阅一个相对 URL 的解析结果。
 * 产物 url()/@import/@font-face 的来源文档基准由此端口携带（主文档 = A
 * 面板 hub 订阅；嵌入 = 以 B fsPath 订阅——宿主按 B 目录解析）。
 */
export interface DocStyleResourcePort {
  subscribe(raw: string, apply: (outcome: HtmlResourceOutcome) => void): () => void
}

/** 原样保留的 at-rule 头前缀（无选择器语义可隔离——矩阵见 shared/docStyle 模块头） */
const RAW_AT_PREFIXES = ['@keyframes', '@font-face', '@import', '@property', '@charset', '@namespace']

/** 递归下钻的组块 at-rule 头前缀 */
const GROUP_AT_PREFIXES = ['@media', '@supports', '@layer', '@container']

/** CSSRule → DocStyleRule 数据投影（鸭子判定：不依赖可被 minify 改写的 constructor.name） */
function adaptCssRule(rule: CSSRule): DocStyleRule {
  const raw = rule as unknown as Record<string, unknown>
  if (typeof raw['selectorText'] === 'string') {
    const style = raw['style'] as { cssText?: string } | undefined
    return {
      selectorText: raw['selectorText'],
      declarations: style?.cssText ?? '',
      cssRules: adaptCssRules(raw['cssRules'] as CSSRuleList | undefined),
    }
  }
  const cssText = rule.cssText
  const braceAt = cssText.indexOf('{')
  const head = (braceAt >= 0 ? cssText.slice(0, braceAt) : cssText).trim()
  if (head.startsWith('@')) {
    if (RAW_AT_PREFIXES.some((p) => head.startsWith(p))) {
      return { rawCssText: cssText }
    }
    if (GROUP_AT_PREFIXES.some((p) => head.startsWith(p))) {
      return { groupHead: head, cssRules: adaptCssRules(raw['cssRules'] as CSSRuleList | undefined) }
    }
    return { rawCssText: cssText } // 未知 at-rule：保守原样
  }
  // 裸声明规则（CSSNestedDeclarations：嵌套/组块内无选择器的声明——
  // 语义 = 父选择器的声明，`& { … }` 形态）。空 selectorText 标记，
  // rewriteGroup 按父链展开；无父（理论不可达——顶层裸声明被引擎丢弃）
  // 按原样文本保守输出。
  const style = raw['style'] as { cssText?: string } | undefined
  if (braceAt < 0 && style?.cssText) {
    return { selectorText: '', declarations: style.cssText }
  }
  return { rawCssText: cssText }
}

function adaptCssRules(rules: CSSRuleList | undefined): DocStyleRule[] | undefined {
  if (rules === undefined || rules === null || rules.length === 0) {
    return undefined
  }
  return Array.from(rules, adaptCssRule)
}

/** CSSOM 解析能力探测（缺 DOM/CSSOM 环境按不可装载降级） */
function parseSheet(cssText: string): readonly DocStyleRule[] | null {
  if (typeof CSSStyleSheet !== 'function' || typeof document !== 'object' || document === null) {
    return null
  }
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(cssText)
    return adaptCssRules(sheet.cssRules) ?? []
  } catch {
    return null // 拒收（理论不可达：replaceSync 对非法 CSS 容错不抛）
  }
}

/**
 * 一段文档样式源文的 b2 改写产物（CSSOM 解析 → 规则树 → shared 纯变换）。
 * 不可解析/无规则返回空串（调用侧据此移除产物元素）。
 * #570（T05）：resources 提供已解析的 URL 映射——相对 url()/@import/
 * @font-face 目标替换为 webview 可装载地址；映射缺席保持原文（未解析/
 * 失败不编造，浏览器按原生语义失败）。
 */
export function rewriteDocumentStyleCss(
  cssText: string,
  docScope: string,
  resources?: { get(raw: string): string | null },
): string {
  if (cssText.trim() === '') {
    return ''
  }
  const rules = parseSheet(cssText)
  if (rules === null || rules.length === 0) {
    return ''
  }
  const scoped = rewriteDocStyleRuleTree(rules, docScope)
  if (resources === undefined) {
    return scoped
  }
  return rewriteCssUrls(scoped, (token) => {
    if (!needsDocumentBaseResolution(token.url)) {
      return null // 直连/自足/片段：保持原文
    }
    const resolved = resources.get(token.url)
    if (resolved === null) {
      return null // 未解析/失败：保持原文
    }
    // 重装为引号形态（解析地址可能含 '?' 等——引号形态最稳）
    return token.form === 'import-string' ? `"${resolved}"` : `url("${resolved}")`
  })
}

interface RegistryEntry {
  docScope: string
  refCount: number
  styleEl: HTMLStyleElement | null
  /** 改写 memo（同源文重挂免重复改写——多实例/滚动回收的重复 sync） */
  lastInput: string
  lastOutput: string
  /** #570（T05）资源状态（按 docScope 共享——同一 B 多实例共享产物与解析） */
  resourceMap: Map<string, string>
  resourceFailed: Set<string>
  /** 在途订阅的退订句柄（release 归零时全退——迟到结果丢弃） */
  resourcePending: Map<string, () => void>
  /** 资源代次（映射变化推进——memo 连同计入，结果到达触发重渲染） */
  resourceGen: number
  /** 已渲染产物对应的资源代次（memo 的一部分） */
  renderedGen: number
  /** 最近一次提供端口的 binding 传入（同 scope 身份等价，latest-wins） */
  resourcePort: DocStyleResourcePort | null
}

/**
 * 文档样式装载注册表（模块级单例）：按 docScope 键持有产物元素与引用
 * 计数。acquire/release 由 DocumentStyleBinding 配对调用；同一键的多
 * 视图实例（同一 B 的嵌入卡 + 悬停浮层 + 内部 Live）共享同一元素。
 */
class DocStyleRegistry {
  private readonly entries = new Map<string, RegistryEntry>()

  acquire(docScope: string): void {
    const entry = this.entries.get(docScope)
    if (entry) {
      entry.refCount++
      return
    }
    this.entries.set(docScope, {
      docScope,
      refCount: 1,
      styleEl: null,
      lastInput: '',
      lastOutput: '',
      resourceMap: new Map(),
      resourceFailed: new Set(),
      resourcePending: new Map(),
      resourceGen: 0,
      renderedGen: 0,
      resourcePort: null,
    })
  }

  release(docScope: string): void {
    const entry = this.entries.get(docScope)
    if (!entry) {
      return
    }
    if (--entry.refCount > 0) {
      return
    }
    for (const unsub of entry.resourcePending.values()) {
      unsub() // 在途退订：迟到结果按无条目丢弃（「释放后无迟到结果污染」）
    }
    entry.resourcePending.clear()
    entry.styleEl?.remove()
    entry.styleEl = null
    this.entries.delete(docScope)
  }

  /** 按源文批次更新产物（sources 为按源码顺序收集的 style 内容）。
   *  #570（T05）port 由 binding 传入（同 scope 身份等价，latest-wins）；
   *  产物改写消费 entry 的资源映射，改写后对缺失映射的相对目标发起订阅。 */
  update(docScope: string, sources: readonly DocStyleSource[], port?: DocStyleResourcePort | null): void {
    const entry = this.entries.get(docScope)
    if (!entry) {
      return // 未 acquire（调用序异常）——保守丢弃
    }
    if (port !== undefined && port !== null) {
      entry.resourcePort = port
    }
    const input = sources.map((s) => s.css).join('\n')
    if (input !== entry.lastInput || entry.resourceGen !== entry.renderedGen) {
      // memo 命中判定含资源代次：映射变化触发重渲染（产物文本依赖映射）
      const output = rewriteDocumentStyleCss(input, docScope, {
        get: (raw) => entry.resourceMap.get(raw) ?? null,
      })
      entry.lastInput = input
      entry.lastOutput = output
      entry.renderedGen = entry.resourceGen
      if (output === '') {
        entry.styleEl?.remove()
        entry.styleEl = null
      } else {
        if (entry.styleEl === null) {
          const el = document.createElement('style')
          el.setAttribute(DOC_STYLE_ELEMENT_ATTR, docScope)
          document.head.appendChild(el) // 末尾追加（决策点 2：文档后置）
          entry.styleEl = el
        }
        entry.styleEl.textContent = output
      }
      this.subscribeMissingResources(entry, input)
    }
  }

  /** 产物内缺失映射的相对目标发起订阅（去重：map/failed/pending 三查） */
  private subscribeMissingResources(entry: RegistryEntry, input: string): void {
    const port = entry.resourcePort
    if (port === null) {
      return // 无端口（未装配/测试直驱）：不请求，产物保持原文（降级方向）
    }
    for (const token of scanCssUrls(input)) {
      if (token.url === '' || !needsDocumentBaseResolution(token.url)) {
        continue
      }
      const raw = token.url
      if (entry.resourceMap.has(raw) || entry.resourceFailed.has(raw) || entry.resourcePending.has(raw)) {
        continue
      }
      const unsub = port.subscribe(raw, (outcome) => {
        // 迟到守卫：条目仍在场且该 raw 仍在本 entry 的 pending 表（release
        // 后 entry 已删除；同 raw 被失效重建时旧退订句柄已被替换）
        if (this.entries.get(entry.docScope) !== entry) {
          return
        }
        if (!entry.resourcePending.has(raw)) {
          return
        }
        entry.resourcePending.delete(raw)
        if (outcome.ok) {
          entry.resourceMap.set(raw, outcome.url)
          entry.resourceGen++
          this.render(entry)
        } else {
          entry.resourceFailed.add(raw) // 失败登记：不重试风暴；文本保持原文
        }
      })
      entry.resourcePending.set(raw, unsub)
    }
  }

  /** 按当前输入与映射重渲染产物（资源结果/失效驱动） */
  private render(entry: RegistryEntry): void {
    const output = rewriteDocumentStyleCss(entry.lastInput, entry.docScope, {
      get: (raw) => entry.resourceMap.get(raw) ?? null,
    })
    entry.lastOutput = output
    entry.renderedGen = entry.resourceGen
    if (output === '') {
      entry.styleEl?.remove()
      entry.styleEl = null
      return
    }
    if (entry.styleEl === null) {
      const el = document.createElement('style')
      el.setAttribute(DOC_STYLE_ELEMENT_ATTR, entry.docScope)
      document.head.appendChild(el)
      entry.styleEl = el
    }
    entry.styleEl.textContent = output
  }

  /**
   * #570（T05）失效通知（image.invalidate 广播的 CSS 资源面）：命中的 raw
   * 清映射/清失败登记并重渲染（回退原文——删除语义下旧地址立即失效），
   * 随后对缺失映射重新订阅（新代次 URI）。
   */
  notifyResourceInvalidate(srcs: readonly string[]): void {
    const set = new Set(srcs)
    for (const entry of this.entries.values()) {
      let touched = false
      for (const raw of set) {
        if (entry.resourceMap.delete(raw)) {
          touched = true
        }
        if (entry.resourceFailed.delete(raw)) {
          touched = true
        }
      }
      if (!touched) {
        continue
      }
      entry.resourceGen++
      this.render(entry)
      this.subscribeMissingResources(entry, entry.lastInput)
    }
  }

  /** 手动刷新（refresh.invalidated）：全部条目失效重取（新代次戳 URI） */
  invalidateAllResources(): void {
    const raws = new Set<string>()
    for (const entry of this.entries.values()) {
      for (const raw of entry.resourceMap.keys()) {
        raws.add(raw)
      }
      for (const raw of entry.resourceFailed) {
        raws.add(raw)
      }
    }
    if (raws.size > 0) {
      this.notifyResourceInvalidate([...raws])
    }
  }

  /** 测试/诊断观测：当前在场键集（产物元素挂载态） */
  activeScopes(): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.styleEl !== null).map(([k]) => k)
  }
}

export const documentStyleRegistry = new DocStyleRegistry()

/**
 * 一个文档视图的文档样式装载句柄：构造占键（acquire），sync 随全文源文
 * 更新产物（文本与树均未变时零成本短路），dispose 释放（多实例共享时
 * 引用递减，归零移除产物）。Live 经 docStyleViewPlugin 装配（主文与
 * 嵌入内部 Live）；Reading/嵌入 Reading 经 render/clear 驱动。
 * #570（T05）：resourcePort 携带来源文档身份（主文档 A / 嵌入 B）——
 * 产物内相对 url()/@import/@font-face 经此订阅解析（同 scope 多实例
 * 共享产物与解析，latest-wins）。
 */
export class DocumentStyleBinding {
  private released = false
  private lastText: string | null = null
  private lastTree: unknown = undefined

  constructor(
    readonly docScope: string,
    private readonly resourcePort?: DocStyleResourcePort | null,
  ) {
    documentStyleRegistry.acquire(docScope)
  }

  /**
   * 全文同步：收集（shared 纯逻辑；树缺席或与文本长度不符时独立全文
   * parse——Lezer 增量解析的坐标安全前提）后更新产物。text 与 tree
   * 引用均未变时短路（解析推进换树引用会触发重收集）。
   */
  sync(text: string, tree?: import('@lezer/common').Tree | null): void {
    if (this.released) {
      return
    }
    if (text === this.lastText && tree === this.lastTree) {
      return
    }
    this.lastText = text
    this.lastTree = tree ?? null
    const usable = tree !== undefined && tree !== null && tree.length === text.length ? tree : null
    documentStyleRegistry.update(this.docScope, collectDocumentStyles(text, usable), this.resourcePort)
  }

  dispose(): void {
    if (this.released) {
      return
    }
    this.released = true
    documentStyleRegistry.release(this.docScope)
    this.lastText = null
    this.lastTree = undefined
  }
}
