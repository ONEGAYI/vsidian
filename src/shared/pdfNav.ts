// PDF 导航锚点解析（#337 / P3-05，2026-10-04 修订口径落地）：`#page=N`
// 为 PDF 目标的唯一锚点键——1-based 正整数，仅初始定位，原链接不改写。
//
// 语法边界（三期正式规格「导航边界」节）：
// - **双链限定**：锚点控制仅 `[[...]]` / `![[...]]` 可用；普通 Markdown
//   链接的 fragment 不由本扩展解析（原样交宿主打开，悬停预览从第一页
//   开始）。调用侧（hoverDocAccess 的 pdf 分派）负责形态判定，本模块只
//   做纯语法解析。
// - **分词边界**：`;` 与 `key=value` 形态仅对非 Markdown 目标的锚点段
//   启用（Markdown 锚点保持标题/块 id 直读，不经本模块）。
// - **非法不回落**：页码格式非法（0/负数/小数/非数字/前导零）、未知键、
//   重复键、空段、裸数字、块 id 形态——一律报错，不静默改为第一页；
//   「有效引用可修正后重试」由就地错误分态承载。
// - 范围校验（越出总页数）不在本层：总页数在装载 PDF 后才可知，由
//   webview 渲染器按 numPages 分态（非法页码不冒充顶部）。
//
// 本模块不依赖 vscode/DOM（两端共享纯逻辑）。
import type { RefPdfNavSelector } from './refContent'

/** PDF 锚点解析结果：成功携带导航选择器（无 page 字段 = 第一页）；
 *  失败附锚点原文（就地错误文案与重试指引取材） */
export type PdfNavParseResult =
  | { ok: true; selector: RefPdfNavSelector }
  | { ok: false; reason: 'invalid'; anchor: string }

/** page 值形态：1-based 正整数的十进制严格形态（拒绝 0/负数/小数/前导零） */
const PAGE_VALUE_RE = /^[1-9][0-9]*$/

/**
 * 解析 PDF 目标的锚点段（双链形态学解析出的锚点原文——heading 形态；
 * 空值 null 表示无锚点，从第一页开始）。
 *
 * 合法形态：`page=N`（唯一键；1-based 正整数）。
 * 其余一切形态（未知键、`page` 无值、裸数字、纯文本、块 id、重复键、
 * 空段）均报 invalid——「不支持的 fragment 不静默改为顶部」。
 */
export function parsePdfNavAnchor(anchor: string | null): PdfNavParseResult {
  if (anchor === null || anchor === '') {
    return { ok: true, selector: { kind: 'pdf' } }
  }
  // 分词：`;` 分段，段内 `key=value`；任一段非恰好一个 key=value 即非法
  const segments = anchor.split(';')
  let page: number | undefined
  for (const segment of segments) {
    const eq = segment.indexOf('=')
    if (eq <= 0 || eq === segment.length - 1) {
      // 无 `=`、key 为空、value 为空（含尾/首/连续分号产生的空段）均非法
      return { ok: false, reason: 'invalid', anchor }
    }
    const key = segment.slice(0, eq)
    const value = segment.slice(eq + 1)
    if (key !== 'page') {
      // 不支持的其他键（zoom/pages/offset…）——不静默忽略
      return { ok: false, reason: 'invalid', anchor }
    }
    if (!PAGE_VALUE_RE.test(value)) {
      // 页码格式：0 / 负数 / 小数 / 非数字 / 前导零 / 空白
      return { ok: false, reason: 'invalid', anchor }
    }
    if (page !== undefined) {
      // 同一键重复出现视为非法（与文本锚点键序规则的重复判定同口径）
      return { ok: false, reason: 'invalid', anchor }
    }
    page = Number(value)
  }
  return { ok: true, selector: { kind: 'pdf', ...(page !== undefined ? { page } : {}) } }
}
