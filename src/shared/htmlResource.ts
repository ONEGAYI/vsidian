// #570（T05）HTML 资源属性与 CSS URL 的**真实语法**层（纯逻辑，两端
// 共用；规格 html-rendering.md「资源与原生交互」：「HTML 中的不同 URL
// 属性须按真实语法处理，包括 srcset、媒体 source、SVG 引用及 CSS URL，
// 不能统一当作单个 src 字符串」「不能以正则替换 CSS 文本代替语法处理」）。
//
// 职责分层：本模块只做**语法**（解析/重组/改写/可解析判定）；「按哪个
// 文档解析」的归属由调用方注入（webview 装配层 htmlResourceMount /
// docStyleLoader 携带来源文档身份），路径边界白名单在宿主
// classifyImageTarget/planVaultLinkPath（不建第二份路径规则——#556 纪律）。
//
// 语法口径：
// - srcset：HTML 规范「parse a srcset attribute」算法的忠实实现——URL 是
//   非空白字符序列（逗号结尾截断），描述符须匹配 `整数w` / `浮点x`，
//   不合法候选整体跳过（浏览器同判）。
// - CSS url()/@import：词法扫描跳过注释与字符串字面量（content:
//   "url(x)" 不算）；url() 产支持裸与单双引号形态及内部空白容错；
//   @import 的字符串形态（@import "x.css"）同样产 token。CSS 转义按
//   原文保留（改写层不重排用户转义）。
/** CSS 资源 URL token（词法产物；区间 [start, end) 覆盖整个产——替换用） */
export interface CssUrlToken {
  start: number
  end: number
  /** 剥引号后的 URL 原文（转义按原文保留） */
  url: string
  /** 引号形态：裸 url() 为 null */
  quote: '"' | "'" | null
  /** 来源形态：url() 产或 @import 字符串 */
  form: 'url' | 'import-string'
}

/** srcset 候选项（descriptor 为描述符原文，无描述符为空串） */
export interface SrcsetCandidate {
  url: string
  descriptor: string
}

/** ASCII 空白（HTML srcset 语义） */
function isWs(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r'
}

/** srcset 描述符合法性：`正整数w` 或 `浮点x`（规范口令，h 描述符已废弃） */
function isSrcsetDescriptor(d: string): boolean {
  return /^[0-9]+w$/.test(d) || /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)x$/.test(d)
}

/**
 * srcset 属性值解析（HTML 规范算法）：
 * - 跳过前导空白与逗号；URL = 连续非空白字符，**以逗号结尾即截断**（URL
 *   不可含逗号，余部进入下一候选——浏览器同判，不猜 URL 内容）。
 * - 描述符 = URL 后到逗号/末尾的原文（去首尾空白）；非空且不匹配 w/x
 *   形态 → 该候选整体跳过（规范 parse error 分支）。
 * - URL 为空（连续逗号/尾逗号）跳过。
 */
export function parseSrcsetCandidates(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = []
  const n = value.length
  let pos = 0
  while (pos < n) {
    while (pos < n && (isWs(value[pos]) || value[pos] === ',')) {
      pos++
    }
    if (pos >= n) {
      break
    }
    let j = pos
    while (j < n && !isWs(value[j])) {
      j++
    }
    let url = value.slice(pos, j)
    pos = j
    let descriptor = ''
    if (url.endsWith(',')) {
      url = url.slice(0, -1)
    } else {
      while (pos < n && isWs(value[pos])) {
        pos++
      }
      let k = pos
      while (k < n && value[k] !== ',') {
        k++
      }
      descriptor = value.slice(pos, k).trim()
      pos = k
    }
    if (url === '') {
      continue
    }
    if (descriptor !== '' && !isSrcsetDescriptor(descriptor)) {
      continue
    }
    out.push({ url, descriptor })
  }
  return out
}

/** srcset 重组：URL + 单空格描述符，多项逗号分隔（空描述符不带尾空格） */
export function buildSrcsetValue(candidates: readonly SrcsetCandidate[]): string {
  return candidates
    .map((c) => (c.descriptor === '' ? c.url : `${c.url} ${c.descriptor}`))
    .join(', ')
}

// ---------------------------------------------------------------------------
// CSS url()/@import 词法
// ---------------------------------------------------------------------------

const URL_OPEN_RE = /^url\(/i

/**
 * CSS 文本扫描：产出全部资源 URL token（url() 产与 @import 字符串形态）。
 * 词法纪律：注释块与字符串字面量（双引号/单引号包裹）整体跳过——
 * content: "url(fake)" 不产 token；url() 内空白容错；空 URL 跳过。
 * token 区间 [start, end) 覆盖整个产（替换用），url 为剥引号后的原文。
 */
export function scanCssUrls(css: string): CssUrlToken[] {
  const out: CssUrlToken[] = []
  const n = css.length
  let i = 0
  // @import 头之后「跳空白即遇引号」标记（字符串形态目标）
  let afterImportHead = false
  while (i < n) {
    const ch = css[i]!
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      afterImportHead = false
      continue
    }
    if (ch === '"' || ch === "'") {
      if (afterImportHead) {
        const token = readString(css, i)
        if (token !== null && token.url !== '') {
          out.push({ start: i, end: token.end, url: token.url, quote: token.quote, form: 'import-string' })
        }
        i = token === null ? n : token.end
        afterImportHead = false
        continue
      }
      const token = readString(css, i)
      i = token === null ? n : token.end
      continue
    }
    if ((ch === 'u' || ch === 'U') && URL_OPEN_RE.test(css.slice(i, i + 4))) {
      const token = readUrlProduction(css, i)
      if (token !== null) {
        if (token.url !== '') {
          out.push(token)
        }
        i = token.end
        continue
      }
      i += 4
      afterImportHead = false
      continue
    }
    if (ch === '@' && /^@import\b/i.test(css.slice(i, i + 8))) {
      i += 7
      // 头后跳空白；下一 token 若为字符串则为目标（media 限定形态回退常规扫描）
      while (i < n && /\s/.test(css[i]!)) {
        i++
      }
      afterImportHead = true
      continue
    }
    if (/\s/.test(ch)) {
      i++
      // 空白不清洗 afterImportHead 之外的语义；但 @import 头后空白已在上面跳过
      continue
    }
    afterImportHead = false
    i++
  }
  return out
}

/** 字符串字面量读取（引号形态；转义按原文保留，url 为去引号原文） */
function readString(css: string, start: number): { url: string; end: number; quote: '"' | "'" } | null {
  const quote = css[start] as '"' | "'"
  let i = start + 1
  while (i < css.length) {
    const ch = css[i]!
    if (ch === '\\') {
      i += 2 // 转义对按原文保留（不重排用户转义）
      continue
    }
    if (ch === quote) {
      return { url: css.slice(start + 1, i), end: i + 1, quote }
    }
    i++
  }
  return null // 未闭合字符串：保守吞到末尾
}

/** url(…) 产读取（start 指向 'u'）；裸形态到首个 ')'，引号形态走 readString */
function readUrlProduction(css: string, start: number): CssUrlToken | null {
  let i = start + 4 // 越过 'url('
  const n = css.length
  while (i < n && /\s/.test(css[i]!)) {
    i++
  }
  if (i >= n) {
    return null
  }
  const ch = css[i]!
  if (ch === '"' || ch === "'") {
    const str = readString(css, i)
    if (str === null) {
      return { start, end: n, url: '', quote: ch, form: 'url' } // 未闭合：空 URL 由调用方跳过
    }
    // 闭引号后容错空白再到 ')'
    let j = str.end
    while (j < n && /\s/.test(css[j]!)) {
      j++
    }
    if (css[j] !== ')') {
      return null // 词法不完整（url("x" 后无闭括号）：不当 token
    }
    return { start, end: j + 1, url: str.url, quote: ch, form: 'url' }
  }
  // 裸形态：非空白/引号/括号字符序列（转义对保留）；URL 后允许尾随空白
  // 再到 ')'（url( x.png ) 容错），但空白后必须直接闭括号（url( a b ) 非
  // 法产——不当 token）
  let j = i
  while (j < n) {
    const c = css[j]!
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === ')') {
      break
    }
    if (c === '"' || c === "'" || /\s/.test(c)) {
      break
    }
    j++
  }
  const url = css.slice(i, j)
  let close = j
  while (close < n && /\s/.test(css[close]!)) {
    close++
  }
  if (css[close] !== ')') {
    return null
  }
  return { start, end: close + 1, url, quote: null, form: 'url' }
}

/**
 * CSS URL 逐 token 改写：replace 返回整个产的重装文本（如
 * `url("https://…")` 或 `"https://…"`——调用方按 token.form 决定形态），
 * 返回 null 保持原文。token 互不重叠，splice 拼接保持其余文本原样。
 */
export function rewriteCssUrls(
  css: string,
  replace: (token: CssUrlToken) => string | null,
): string {
  const tokens = scanCssUrls(css)
  if (tokens.length === 0) {
    return css
  }
  let out = ''
  let cursor = 0
  for (const token of tokens) {
    const replacement = replace(token)
    if (replacement === null || token.url === '') {
      continue
    }
    out += css.slice(cursor, token.start) + replacement
    cursor = token.end
  }
  if (cursor === 0) {
    return css
  }
  return out + css.slice(cursor)
}

// ---------------------------------------------------------------------------
// 可解析判定
// ---------------------------------------------------------------------------

/** 真 scheme 形态（linkTarget.preClassify 同口径：单字母/含点的是文件名形态非协议） */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/

/**
 * 该 URL 是否需要按来源文档基准解析：
 * - 相对路径（裸名、./、../、子目录、根相对 `/x`）→ true（宿主按文档目录
 *   走 classifyImageTarget 白名单）。
 * - 任意真 scheme（http/https/data/file/javascript…）→ false：http(s)/data
 *   直连（CSP 语义），危险/其他 scheme 资源层不越权解析（净化层已拒，保持
 *   原文按原生语义失败）。
 * - 片段（#frag）与空白 → false（无独立目标语义）。
 * - 单字母/含点 "scheme"（a:b.md、note.md:103）是文件名形态 → true。
 */
export function needsDocumentBaseResolution(raw: string): boolean {
  const t = raw.trim()
  if (t === '' || t.startsWith('#')) {
    return false
  }
  const m = SCHEME_RE.exec(t)
  if (m && m[1]!.length > 1 && !m[1]!.includes('.')) {
    return false
  }
  return true
}
