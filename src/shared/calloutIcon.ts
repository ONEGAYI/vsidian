// Callout 图标值解析与锁版图标库（#657/T06）：--callout-icon 公开自定义
// 变量的取值分类（纯逻辑，两端可用零依赖）与 Lucide 锁版库。
//
// 契约（规格 docs/specs/callout.md §8.1；票 #657）：
// - 取值三形态：Lucide 图标 ID（`lucide-<名>` 或裸 `<名>`，大小写不敏感、
//   对称引号剥除）、`<svg …>` 字符串（净化后注入）、非法值（保留默认图标
//   + 可查诊断，不静默伪报成功——诊断与净化在 webview 侧
//   calloutIconMount，本模块只做无副作用的形态判定）。
// - 「随包锁定 Lucide 版本」：库只收录 T03 已随 CSS 落地的 13 组图标
//   （lucide-static **0.462.0** 锚定，取证留痕 T03 工作树 out/test/
//   lucide-icons/）。0.462.0 已把 help-circle/alert-triangle/
//   check-circle-2 更名为 circle-help/triangle-alert/circle-check-big
//   ——Obsidian 1.14.4 app.css 照录旧拼写，别名表把两种拼写都接到同一
//   造型（用户从 Obsidian 片段复制即用）。库条目与 main.css mask 表的
//   data URL 几何逐字符同源（契约测试钉住，仅 stroke 通道不同：mask 取
//   alpha 用 #000、注入随类型色用 currentColor）。
// - 不引入 lucide-static 运行期依赖（零新依赖优先；锁版集合外的 ID 走
//   SVG 字符串形态）。

/** 锁版声明（文档与契约测试锚点；素材取证见 obsidian-1144 JSON 与 T03 留痕） */
export const CALLOUT_ICON_VERSION = 'lucide-static 0.462.0'

/** --callout-icon 计算值的四分类（形态判定零副作用；决策在 webview 侧） */
export type CalloutIconSpec =
  | { readonly kind: 'none' }
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'svg'; readonly markup: string }
  | { readonly kind: 'invalid'; readonly reason: string }

/** 单标识符（lucide 图标名语法：字母/数字/连字符；无 lucide- 前缀语义） */
const ID_RE = /^[A-Za-z0-9-]+$/

function stripSymmetricQuotes(value: string): string {
  const head = value[0]
  const tail = value[value.length - 1]
  if (value.length >= 2 && ((head === '"' && tail === '"') || (head === "'" && tail === "'"))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * 解析 --callout-icon 的计算值（已 trim）。ID 形态剥掉可选 `lucide-` 前缀
 * 并小写规范化（保留原始连字符拼写，如 `circle-check-big`）；SVG 形态
 * 剥外层对称引号后**原样**保留 markup（净化在消费侧）；其余为非法。
 */
export function parseCalloutIconValue(raw: string): CalloutIconSpec {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { kind: 'none' }
  }
  const unquoted = stripSymmetricQuotes(trimmed)
  if (/^<svg[\s>]/i.test(unquoted)) {
    return { kind: 'svg', markup: unquoted }
  }
  if (ID_RE.test(unquoted)) {
    const id = unquoted.toLowerCase().replace(/^lucide-/, '')
    if (id === '') {
      return { kind: 'invalid', reason: `图标 ID 为空：${unquoted}` }
    }
    return { kind: 'id', id }
  }
  return { kind: 'invalid', reason: `无法解析的图标值（既非图标 ID 也非 <svg> 字符串）：${unquoted.slice(0, 60)}` }
}

/**
 * 锁版库（lucide-static 0.462.0，13 组；几何与 main.css mask 表同源，
 * 契约测试钉住）：键为 0.462.0 规范名，值为 currentColor 描边 SVG。
 */
export const CALLOUT_ICON_LIBRARY: Readonly<Record<string, string>> = {
  pencil:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' /> <path d='m15 5 4 4' /></svg>",
  'clipboard-list':
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='8' height='4' x='8' y='2' rx='1' ry='1' /> <path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' /> <path d='M12 11h4' /> <path d='M12 16h4' /> <path d='M8 11h.01' /> <path d='M8 16h.01' /></svg>",
  info:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10' /> <path d='M12 16v-4' /> <path d='M12 8h.01' /></svg>",
  'circle-check-big':
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21.801 10A10 10 0 1 1 17 3.335' /> <path d='m9 11 3 3L22 4' /></svg>",
  flame:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z' /></svg>",
  check:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6 9 17l-5-5' /></svg>",
  'circle-help':
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10' /> <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' /> <path d='M12 17h.01' /></svg>",
  'triangle-alert':
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' /> <path d='M12 9v4' /> <path d='M12 17h.01' /></svg>",
  x:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M18 6 6 18' /> <path d='m6 6 12 12' /></svg>",
  zap:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z' /></svg>",
  bug:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m8 2 1.88 1.88' /> <path d='M14.12 3.88 16 2' /> <path d='M9 7.13v-1a3.003 3.003 0 1 1 6 0v1' /> <path d='M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6' /> <path d='M12 20v-9' /> <path d='M6.53 9C4.6 8.8 3 7.1 3 5' /> <path d='M6 13H2' /> <path d='M3 21c0-2.1 1.7-3.9 3.8-4' /> <path d='M20.97 5c0 2.1-1.6 3.8-3.5 4' /> <path d='M22 13h-4' /> <path d='M17.2 17c2.1.1 3.8 1.9 3.8 4' /></svg>",
  list:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 12h.01' /> <path d='M3 18h.01' /> <path d='M3 6h.01' /> <path d='M8 12h13' /> <path d='M8 18h13' /> <path d='M8 6h13' /></svg>",
  quote:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z' /> <path d='M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z' /></svg>",
}

/**
 * 别名表：Obsidian 1.14.4 照录拼写 → 0.462.0 规范名（app.css 取证用
 * 旧名，lucide-static 0.462.0 已更名；quote-glyph 为 Obsidian 内部图标
 * 名——造型即 lucide quote）。
 */
export const CALLOUT_ICON_ALIASES: Readonly<Record<string, string>> = {
  'help-circle': 'circle-help',
  'alert-triangle': 'triangle-alert',
  'check-circle-2': 'circle-check-big',
  'quote-glyph': 'quote',
}

/**
 * 图标名（含可选 `lucide-` 前缀，大小写不敏感）→ 库键；含别名归一
 * （Obsidian 照录旧拼写 → 0.462.0 规范名）。不在锁版集合内返回 null
 * （消费方按非法值诊断）。
 */
export function calloutIconLibraryKeyOf(id: string): string | null {
  const key = id.toLowerCase().replace(/^lucide-/, '')
  const aliased = CALLOUT_ICON_ALIASES[key] ?? key
  return Object.prototype.hasOwnProperty.call(CALLOUT_ICON_LIBRARY, aliased) ? aliased : null
}
