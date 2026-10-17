// 块级 HTML 专用内容净化边界（#567/T02，ADR-0019 决定 5；T01 探针附录 B
// 选型 DOMPurify 的最小接线）：html 块源文进 DOM 前经白名单净化——
// Reading 块渲染与 Live widget 共用本入口（净化规则只维护一份）。
//
// 分层（探针附录 B 口径）：
// - 第一道闸：DOMPurify 白名单（默认全量 HTML + 安全 SVG/MathML 子集；
//   script/事件属性/危险协议默认拒绝）。`<style>` 显式 FORBID——文档内
//   样式由 T04 收集器从源文独立装载，不随 DOM 净化放行进正文（双通道）。
// - 第二道闸：既有 sanitizeReadingDom 黑名单（防御纵深）继续对挂载 DOM
//   执行（mermaid 管线依赖其剥 SVG 内 style 的现状口径，不受本模块影响）。
// - 系统锚点互斥：源文自带的 `data-vsidian-*` 一律剥离（防越权自标记/
//   伪造锚点）；系统装配生成的锚点（块元素 src 锚点、docScope 标记）写
//   在净化输入之外，天然不被误删——无需回填 hook（T01 探针的回填建议
//   针对对既有 DOM 复净化的场景，本管线是字符串→DOM 单向装配）。
// - 降级：净化后为空（script-only 等）回退转义源码呈现（规格「无法安全
//   呈现的片段保持可访问的原始源码」）。DOMPurify 不可用（无 DOM 环境）
//   同样回退源码——绝不放行未净化内容。
//
// #572（T07）iframe 许可面（T01 探针 d 候选实测：srcdoc 不被生产 CSP
// `frame-src https:` 拦截——帧 URL=about:srcdoc，属本票安全设计输入）：
// - 白名单放行 iframe（DOMPurify 默认整体移除——ADD_TAGS 显式放行；
//   `srcdoc` 属性默认剥除，ADD_ATTR 放行后进 hook 重写）。
// - **sandbox 系统强制**（作者值恒被覆盖，afterSanitizeAttributes 写入——
//   源文自带的 sandbox/allow* 属性已被默认属性面剥除，不可带私货）：
//   `src=https://` 远端帧 = 仅 `allow-scripts`（#343 webPage 同口径：站点
//   渲染所需最小能力；无 allow-same-origin → 不透明源零 cookie/存储、
//   不可达父窗口与 acquireVsCodeApi；无 allow-top-navigation/forms/
//   popups/modals/downloads）+ referrerpolicy=no-referrer；**其余全部形态
//   （srcdoc / 相对路径→本地解析 / 明文 http / 无 src）= 零 token**——
//   笔记可控内容（笔记本体与 vault 文件）结构性禁脚本，与「笔记本体
//   script 不获得执行能力」同一红线（明文 http 帧在生产另被 CSP
//   frame-src 拦截装载）。
// - **权限面零授予**：allow/allowfullscreen/allowpaymentrequest 不进产物。
// - **srcdoc 内容递归净化**：属性值不过标签层净化（DOMPurify 按字符串
//   处理属性），且其 SAFE_FOR_XML 防护（默认开）会把含 `</style>` 等
//   闭合标签的属性值**整体移除**（mXSS 防护）——先经 beforeSanitizeAttributes
//   捕获原文、afterSanitizeAttributes 净化后回写（见 pendingSrcdoc）。
//   净化口径：剥 script/事件/危险协议、FORBID 嵌套 iframe
//   （`srcdoc<iframe srcdoc=…>` 递归装载攻击面封死；嵌套帧无既有需求）；
//   帧内 `<style>` 保留（帧文档作用域，不出帧）。生产 CSP 叠加继承拦截
//   （about:srcdoc 继承父 CSP，script-src nonce 门控），但设计以 sandbox
//   为准（无 CSP 环境仍成立）。
// - 系统标记 `data-vsidian-iframe`：hook 在属性过滤**之后**写入（源文
//   同名属性已被 uponSanitizeAttributes 剥离，不可伪造）——第二道闸
//   sanitizeReadingDom 按此豁免白名单产物。
import DOMPurify from 'dompurify'
import { escapeHtml } from '../shared/frontmatterTable'

/** 净化后为空的块回退源码呈现的稳定类名（样式契约 reading-html-block /
 *  live-html-widget 条目的降级态注记） */
export const HTML_SOURCE_FALLBACK_CLASS = 'vsidian-html-source-fallback'

/** #572（T07）iframe 白名单产物标记：第一道闸写入（属性过滤后），
 *  第二道闸 sanitizeReadingDom 按此豁免移除；源文同名属性已被剥离 */
export const IFRAME_APPROVED_ATTR = 'data-vsidian-iframe'

/** #572（T07）https 远端帧的 sandbox 面（#343 webPage 先例：仅 allow-scripts） */
export const IFRAME_REMOTE_SANDBOX = 'allow-scripts'

/** #572（T07）其余形态（srcdoc/本地/相对/http/无 src）的 sandbox 面：零 token */
export const IFRAME_STATIC_SANDBOX = ''

/** data-vsidian-* 剥离与 iframe 策略 hook 只挂一次（模块级实例单例） */
let hooksInstalled = false

const SVG_NS = 'http://www.w3.org/2000/svg'

/** SVG SMIL 动画元素（href 族/事件属性动画化 = 导航与脚本劫持向量，
 * 下方 hook 拦截其 attributeName 目标；几何/变换目标正常放行） */
const SVG_ANIMATION_TAGS = new Set(['animate', 'animatemotion', 'animatetransform', 'set'])

/**
 * #572（T07）srcdoc 原文中转站：DOMPurify 的 SAFE_FOR_XML 防护（默认开）
 * 会把含 `</style>`/`</script>` 等**闭合标签的属性值**整体移除（mXSS 防护
 * ——属性值里的标记是 JSON/XML 上下文的混淆向量）；srcdoc 的合法内容恰好
 * 命中。处理：beforeSanitizeAttributes 先取走原文（属性过滤前的原值），
 * afterSanitizeAttributes 净化后回写——递归净化不受该防护影响（内层是
 * 标签层输入，不是属性值）。字符串输入的 sanitize 是解析树原位清洗，
 * 节点引用跨两阶段稳定。
 */
const pendingSrcdoc = new Map<Element, string>()

/** #573（T08）SVG/MathML ADD_TAGS 放行面（主净化与 #572 srcdoc 递归净化
 *  共用一份——帧内 SVG 与正文 SVG 同口径，不建第二份清单） */
const SVG_MATHML_ADD_TAGS = ['foreignObject', 'use', 'animate', 'animateMotion', 'animateTransform', 'set', 'mpath']

/** #573（T08）HTML 集成点配置（foreignObject 内 HTML 命名空间放行——键
 *  小写、对象形态两坑见 sanitizeHtmlBlockMarkup 注释；同上共用一份） */
const HTML_INTEGRATION_POINTS_CONFIG = { 'annotation-xml': true, foreignobject: true }

/** https 远端帧判定（sandbox 分派依据——trim 后精确 scheme 前缀） */
function isHttpsFrameSrc(raw: string): boolean {
  return /^https:\/\//i.test(raw.trim())
}

/** srcdoc 内容的递归净化（属性值不过标签层——第二净化通道） */
function sanitizeSrcdocContent(value: string): string {
  // 嵌套 iframe FORBID：`srcdoc<iframe srcdoc=…>` 递归装载攻击面封死
  //（嵌套帧无既有需求）；FORBID_TAGS 使内层不再产 iframe 节点，hook 递归
  // 有界（深度 1）。style 显式放行：默认标签集不含 style（与外层 FORBID
  // 同因），而帧内样式是帧文档作用域的合法内容（不出帧）。
  // SVG 放行面与主净化同源共用（SVG_MATHML_ADD_TAGS）。
  // 顶层 head 类元素（style 等）在全文档解析下会被 HTML 解析器移入 head、
  // 随 body 序列化丢出产物——以容器包裹走片段解析后 DOMParser 解包；
  // 浏览器对 srcdoc 重新按文档解析，片段内容语义等价（自动重建壳）。
  const wrapped = DOMPurify.sanitize(`<div>${value}</div>`, {
    FORBID_TAGS: ['iframe'],
    ADD_TAGS: ['style', ...SVG_MATHML_ADD_TAGS],
    HTML_INTEGRATION_POINTS: HTML_INTEGRATION_POINTS_CONFIG,
  })
  const host = new DOMParser().parseFromString(wrapped, 'text/html').body.firstElementChild
  return host?.innerHTML ?? ''
}

function purifyInstance(): typeof DOMPurify | null {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) {
    return null
  }
  if (!hooksInstalled) {
    DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName.startsWith('data-vsidian-')) {
        data.keepAttr = false
      }
    })
    // #572（T07）srcdoc 原文捕获（见 pendingSrcdoc 头注释）
    DOMPurify.addHook('beforeSanitizeAttributes', (node) => {
      if (node instanceof HTMLIFrameElement) {
        const value = node.getAttribute('srcdoc')
        if (value !== null) {
          pendingSrcdoc.set(node, value)
          node.removeAttribute('srcdoc')
        }
      }
    })
    // #573（T08）动画目标劫持防线：SMIL 动画把 attributeName 指向
    // href/xlink:href（含前缀与大小写形态）或 on* 事件属性时，动画可把
    // 链接 href 改写为 javascript: 或直接挂事件——该动画元素整体移除
    //（DOMPurify 内置亦有属性级防线，此为双保险，不依赖其内部行为细节）
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (!(node instanceof Element) || node.namespaceURI !== SVG_NS) {
        return
      }
      const local = node.localName?.toLowerCase() ?? ''
      if (!SVG_ANIMATION_TAGS.has(local)) {
        return
      }
      const raw = node.getAttribute('attributeName') ?? ''
      const t = raw.trim().toLowerCase()
      const bare = t.includes(':') ? t.slice(t.indexOf(':') + 1) : t
      if (bare === 'href' || bare.startsWith('on')) {
        node.parentNode?.removeChild(node)
      }
    })
    // #572（T07）iframe 许可面强制（afterSanitizeAttributes：源文属性已
    // 过滤、此处写系统值——见模块头「iframe 许可面」；与 #573 动画防线
    // 是独立节点集〔HTMLIFrame vs SVG〕，两 hook 互不干扰）
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (!(node instanceof HTMLIFrameElement)) {
        return
      }
      // 权限面零授予（防御性移除——默认属性面已剥，直写不受影响）
      node.removeAttribute('allow')
      node.removeAttribute('allowfullscreen')
      node.removeAttribute('allowpaymentrequest')
      // sandbox 系统强制：作者值不可选（远端 https = allow-scripts；其余零 token）
      const remote = isHttpsFrameSrc(node.getAttribute('src') ?? '')
      node.setAttribute('sandbox', remote ? IFRAME_REMOTE_SANDBOX : IFRAME_STATIC_SANDBOX)
      if (remote) {
        node.setAttribute('referrerpolicy', 'no-referrer')
      } else {
        node.removeAttribute('referrerpolicy')
      }
      // srcdoc 回写（捕获原文 → 递归净化；空值保持空——帧空文档语义）
      const captured = pendingSrcdoc.get(node)
      if (captured !== undefined) {
        pendingSrcdoc.delete(node)
        node.setAttribute('srcdoc', captured === '' ? '' : sanitizeSrcdocContent(captured))
      }
      // 白名单产物标记（第二道闸豁免面；源文同名属性已被剥离）
      node.setAttribute(IFRAME_APPROVED_ATTR, '1')
    })
    hooksInstalled = true
  }
  return DOMPurify
}

/**
 * html 块源文的净化产物（字符串）。不可安全呈现时返回空串（调用方
 * htmlBlockRenderHtml 回退转义源码）；DOM 环境缺失同样返回空串（降级
 * 方向安全——源码可见优先于内容放行）。
 *
 * #573（T08）SVG/MathML 配置面（证据 out/test/t08-purify-probe*.log，
 * DOMPurify 3.4.16 实测）：
 * - 默认白名单**不含** foreignObject/use/SMIL 动画元素（animate/
 *   animateMotion/animateTransform/set/mpath）——整元素被移除，浏览器
 *   可用语义被粗暴全删。ADD_TAGS 放行（负向面由属性级白名单 + 上方
 *   动画防线 hook 维持，实测见 test/unit/htmlSvgMathml.test.ts）。
 * - foreignObject 内 HTML 命名空间节点被 `_checkValidNamespace` 判非法
 *   移除：HTML_INTEGRATION_POINTS 默认只有 annotation-xml。配置补
 *   foreignobject——**键必须小写**（检查按 tagName 小写比对，而配置
 *   不做 case 转换）且**必须对象形态**（_resolveObjectOption 只认
 *   object，数组形态静默回落默认——两坑均实测钉住）。
 * - 命名空间混淆防线保持：HTML ns 里名字为 SVG 独占标签的节点仍被拒
 *   （mXSS 向量，DOMPurify 内置）。
 * - 已知边界：SANITIZE_DOM（默认开）会把与 document 命名属性撞名的
 *   id（如 id="title"）剥除（DOM clobbering 防护）——极少数撞名 id 的
 *   渐变/引用会失效，DOMPurify 既定行为，如实呈现。
 */
export function sanitizeHtmlBlockMarkup(source: string): string {
  const purify = purifyInstance()
  if (!purify) {
    return ''
  }
  return purify.sanitize(source, {
    // 文档内样式走 T04 收集器（源文 → CSSStyleSheet 装载），不进正文 DOM
    FORBID_TAGS: ['style'],
    // SVG/MathML 混合命名空间放行面（见函数注释）+ #572（T07）iframe
    // 白名单放行（默认整体移除；srcdoc 属性经 ADD_ATTR 进 hook 重写）
    ADD_TAGS: [...SVG_MATHML_ADD_TAGS, 'iframe'],
    ADD_ATTR: ['srcdoc'],
    HTML_INTEGRATION_POINTS: HTML_INTEGRATION_POINTS_CONFIG,
  })
}

/**
 * html 块的渲染 HTML 装配：净化成功 → 净化产物（供 innerHTML）；净化后
 * 为空且源文非空 → 转义源码 pre（可访问原始源码，不吞不执行）。纯空白
 * 源文产空串（无内容可呈现）。
 */
export function htmlBlockRenderHtml(source: string): string {
  const sanitized = sanitizeHtmlBlockMarkup(source)
  if (sanitized !== '' || source.trim() === '') {
    return sanitized
  }
  return `<pre class="${HTML_SOURCE_FALLBACK_CLASS}">${escapeHtml(source)}</pre>`
}

/**
 * **行内** HTML 片段的渲染 HTML 装配（#568/T03）：净化复用
 * sanitizeHtmlBlockMarkup（单一事实源，不建第二份——仅装配形态差异：
 * 行内降级回退是转义源码 **span** 而非 pre，避免行内混排被块级元素
 * 拆行）。行内 `<script>` 等净化为空片段同样回退源码（可访问原始源码）。
 */
export function htmlInlineRenderHtml(source: string): string {
  const sanitized = sanitizeHtmlBlockMarkup(source)
  if (sanitized !== '' || source.trim() === '') {
    return sanitized
  }
  return `<span class="${HTML_SOURCE_FALLBACK_CLASS}">${escapeHtml(source)}</span>`
}
