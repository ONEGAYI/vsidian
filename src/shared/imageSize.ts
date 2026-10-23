// 图片尺寸后缀的解析单一事实源（#635）：双链嵌入 `![[图.png|尺寸]]`、
// Markdown 直链 `![图注|尺寸](图.png)`（markdown-it 把整段标签原文放进
// token.content——尺寸必须从 alt 字符串剥离，token 无独立尺寸字段）。
//
// 支持的尾缀形态（规格 docs/specs/image-resize.md §3.1）：
//   `|宽`      宽度像素，等比        官方（Obsidian Embed files）
//   `|宽x高`   固定宽高，不保持比例  官方（拉伸语义原样保留，不做 contain-fit）
//   `|百分比`  固有宽度的 N%，等比    本项目扩展（非官方语法）
//
// 否定形态（一律判非法，调用方原样降级为普通文本后缀，不改写源文）：
//   `|x200`（只写高度，Obsidian 未实现）、`|50%x30%`（高度百分比无明确
//   基准）、`|0`、`|0%`、`|2000%`（超出 1%–1000% 合法域）。
//
// 作用域只限嵌入形态：普通链接 `[[图.png|100]]` 的 `100` 是显示文字，
// 调用方不得对链接扫描结果调用本模块（规格 §3.2）。
//
// 本模块不依赖 vscode/DOM/CM6（node 单测直驱；宿主与 webview 双产物共用）。

/** 百分比合法域上限（1%–1000%，允许放大） */
export const IMAGE_SIZE_PERCENT_MAX = 1000

/** 解析后的图片显示尺寸（源文语义，不含任何渲染环境信息） */
export interface ImageSize {
  /** 宽度：像素值，或百分比数值（unit 区分） */
  width: number
  /** 高度像素；null = 等比缩放（只给宽度） */
  height: number | null
  unit: 'px' | 'percent'
}

/** 只写宽度的像素形态 */
const WIDTH_PX_RE = /^\d+$/
/** 固定宽高形态（x 与 X 等价） */
const BOX_PX_RE = /^(\d+)x(\d+)$/i
/** 百分比形态（允许小数，如 12.5%） */
const WIDTH_PERCENT_RE = /^(\d+(?:\.\d+)?)%$/

/** 安全整数判定：超出 Number 安全域的位数按非法处理（不产出 Infinity） */
function safePx(raw: string): number | null {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}

/**
 * 解析单个尾缀段为尺寸；非法返回 null（调用方按普通文本后缀降级）。
 * 段内首尾空白先 trim——`![[图.png| 100 ]]` 与 `![[图.png|100]]` 同义。
 */
export function parseImageSizeSuffix(segment: string): ImageSize | null {
  const text = segment.trim()
  if (text === '') {
    return null
  }
  const box = BOX_PX_RE.exec(text)
  if (box) {
    const width = safePx(box[1]!)
    const height = safePx(box[2]!)
    if (width === null || height === null) {
      return null
    }
    return { width, height, unit: 'px' }
  }
  const percent = WIDTH_PERCENT_RE.exec(text)
  if (percent) {
    const value = Number(percent[1])
    if (!Number.isFinite(value) || value < 1 || value > IMAGE_SIZE_PERCENT_MAX) {
      return null
    }
    return { width: value, height: null, unit: 'percent' }
  }
  if (WIDTH_PX_RE.test(text)) {
    const width = safePx(text)
    return width === null ? null : { width, height: null, unit: 'px' }
  }
  return null
}

/**
 * 从 `|` 分段中剥离尾缀尺寸（规格 §3.3）：**最后一段**匹配尺寸形态则判为
 * 尺寸，其余段按原分隔符拼回别名。
 *
 * ```
 * ['说明文字', '100'] → { alias: '说明文字', size: 100 }
 * ['100']            → { alias: null, size: 100 }
 * ['说明文字']        → { alias: '说明文字', size: null }
 * ['100', '200']     → { alias: '100', size: 200 }   ← 末尾规则，前段仍是别名
 * ```
 *
 * parts 由调用方按 `|` 切分别名原文得到（`parseWikilinkInner` 的 alias 段
 * 原文、Markdown 图片标签原文）；空数组视为无别名无尺寸。
 */
export function splitAliasAndSize(parts: readonly string[]): {
  alias: string | null
  size: ImageSize | null
} {
  // 尾随空段不含信息（`[[图.png|说明|]]` 与 `[[图.png|说明]]` 同义）：
  // 先丢弃，避免拼出「说明 |」这类带尾分隔符的别名
  let end = parts.length
  while (end > 0 && parts[end - 1]!.trim() === '') {
    end -= 1
  }
  if (end === 0) {
    return { alias: null, size: null }
  }
  const kept = parts.slice(0, end)
  const size = parseImageSizeSuffix(kept[end - 1]!)
  if (size === null) {
    const alias = kept.join('|').trim()
    return { alias: alias === '' ? null : alias, size: null }
  }
  const alias = kept.slice(0, -1).join('|').trim()
  return { alias: alias === '' ? null : alias, size }
}

/**
 * 尺寸 → 渲染载体属性（规格 §4.4）的单一派生：
 * 像素走 `width`／`height` 属性（浏览器加载前即可预留空间，减少布局
 * 跳动）；百分比必须走内联 `style.width`——HTML `width` 属性不接受百分比。
 *
 * `percentWidth` 是百分比的**数值**形态，供装载链路在图片 loaded 后按
 * 固有宽折算像素（CSS `%` 的基准是包含块而非规格 §3.1 的固有宽——裸
 * `N%` 会让放大域（>100%）被 `max-width:100%` 钳制、独行 block 形态撑满
 * 整行；折算函数见 `percentToPxWidth`，两条渲染血缘的接线共用它）。
 * `styleWidth`（`N%` 串）作为装载前的占位保留，loaded 后立即被折算 px
 * 覆盖（加载前无宽，占位不产生布局跳动）。
 *
 * 返回形态供两条渲染血缘共用：Reading 侧拼 HTML 字符串，Live 侧写 DOM
 * 属性（`height` 缺省表示等比，不写）。
 */
export function imageSizeAttrs(size: ImageSize): {
  width: string | null
  height: string | null
  styleWidth: string | null
  percentWidth: number | null
} {
  if (size.unit === 'percent') {
    return { width: null, height: null, styleWidth: `${size.width}%`, percentWidth: size.width }
  }
  return {
    width: String(size.width),
    height: size.height === null ? null : String(size.height),
    styleWidth: null,
    percentWidth: null,
  }
}

/**
 * 百分比 → 像素宽（规格 §3.1 基准：`naturalWidth × N%`，等比、不取整——
 * 与拖动 applyVisual 的视觉折算同口径）。两条渲染血缘的装载接线共用
 * 本函数，不建第二份折算。
 *
 * `naturalWidth` 未知（未装载 0 / 非有限值）返回 null：不产出伪像素，
 * 调用方保持装载前占位（`N%`）或无宽。
 */
export function percentToPxWidth(naturalWidth: number, percent: number): number | null {
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 0 || !Number.isFinite(percent)) {
    return null
  }
  return (naturalWidth * percent) / 100
}

/** 写回源文用的尾缀文本（拖动结果与既有写法保持同形态，规格 §5.2）。
 *  像素等比 → `宽`；像素双轴 → `宽x高`；百分比 → `N%`（小数原样保留，
 *  整数不带小数点）。 */
export function formatImageSizeSuffix(size: ImageSize): string {
  if (size.unit === 'percent') {
    return `${formatNumber(size.width)}%`
  }
  return size.height === null
    ? formatNumber(size.width)
    : `${formatNumber(size.width)}x${formatNumber(size.height)}`
}

/** 数值格式化：整数不带小数点，小数去掉尾随零 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/**
 * 两个尺寸是否等价（拖动提交判定：无变化不写文档，避免空撤销步）。
 * 单位不同即不等价（`100` 与 `100%` 是不同声明，即使当前渲染宽偶然相同）。
 */
export function sameImageSize(a: ImageSize | null, b: ImageSize | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return a.width === b.width && a.height === b.height && a.unit === b.unit
}
