// 宽松内联链接/图片形态学单一事实源（工单 #152）：`[文字](含空格 路径.md)`
// 与 `![alt](图片 名字.png)` 这类「目标含未编码空格」的内联形态。lezer 与
// markdown-it 均按严格 CommonMark 拒绝裸空格目标（lezer 树只剩 `[文字]`
// 残节点、markdown-it 整条按文本渲染）；Obsidian 对该形态按字面路径渲染，
// 本模块以 Obsidian 为基准提供两视图共用的宽松判定——live 装饰
// （liveLinks 行扫描）与阅读渲染（markdown-it 自定义规则）共用，同一文本
// 两视图语义必须逐字节一致（沿用 wikilink 形态学的先例）。
//
// 接管口径（与既有形态学同族的降级哲学：不支持即按原文降级，不改写源文）：
// - 仅接管「标准 CommonMark 会拒绝」的形态：括号内容含空格/制表符，且标准
//   目标语法（ws* 目标 ws* 标题? ws*；含 <> 尖括号形态）无法解析时才匹配。
//   %20 编码、<> 包裹、合法标题等标准形态一律交还标准层，行为不变
// - 目标 = 括号内整段字面文本（两侧空白 trim、内部空格保留）：带引号的
//   「标题」不拆分——`[t](a b "标题")` 的目标是 `a b "标题"`，完整渲染为
//   一条链接，不产生部分链接（文件不存在由宿主探测后给 not-found 反馈）
// - 反斜杠（`\!` 转义前缀 / 标签内转义 / 目标内转义）属标准层语义，宽松层
//   一律不接管（维持现状）——转义会破坏「首个 ]」「首个空白」的位置判定
// - 标签内部含 `[` / `]`、`[` 前紧贴 `[`（双链/三连括号域）、`[` 前紧贴
//   `!` 的链接形态（该括号只按图片形态尝试，在 `!` 处解析）不匹配
// - 括号未在同一行闭合（含嵌套括号不平衡）、内容含控制字符或纯空白：
//   不匹配；出现不跨行（单行形态）
//
// 跳转/资源链路（与 %20 通道同宿主语义）：live 点击上报字面目标原文，
// 阅读 href/src 经 markdown-it normalizeLink 编码——宿主 linkTarget 的
// trim + 容错 percent-decode 使两种写法解析到同一目标。
//
// 本模块不依赖 vscode/DOM/CM6（node 单测直驱；宿主与 webview 双产物共用）。

/** 宽松内联链接/图片出现（区间为输入字符串坐标；base 偏移由调用方叠加） */
export interface LooseLinkHit {
  /** 出现起点：图片形态含 `!`，链接形态为 `[` */
  from: number
  /** 出现终点：含闭括号 `)`（不含） */
  to: number
  /** 标签文本区间起点（`[` 之后） */
  labelFrom: number
  /** 标签文本区间终点（`]` 之前，不含） */
  labelTo: number
  /** 目标：括号内整段字面文本（两侧空白 trim，内部空格保留） */
  dest: string
  /** 图片形态（`![` 前缀） */
  image: boolean
}

function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

/**
 * 括号内容是否标准内联目标语法可解析（markdown-it parseLinkDestination/
 * parseLinkTitle 同口径近似）：`ws* 目标 ws* 标题? ws*` 全部匹配即标准层
 * 职责（合法与否由标准层按其语义处置——宽松层只在标准语法无法解析时接管）。
 */
export function standardInlineDestParses(content: string): boolean {
  const n = content.length
  let i = 0
  while (i < n && isWs(content[i]!)) {
    i++
  }
  if (i >= n) {
    return true // 空白/空内容（[t]() 形态）属标准层
  }
  if (content[i] === '<') {
    return true // 尖括号形态（合法与否）均归标准层
  }
  while (i < n && !isWs(content[i]!)) {
    i++ // 裸目标 run：至首个空白
  }
  let j = i
  while (j < n && isWs(content[j]!)) {
    j++
  }
  if (j >= n) {
    return true // 目标后仅尾随空白
  }
  const quote = content[j]!
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = quote === '(' ? ')' : quote
    const k = content.indexOf(close, j + 1)
    if (k > j) {
      let m = k + 1
      while (m < n && isWs(content[m]!)) {
        m++
      }
      if (m >= n) {
        return true // 目标 + 合法标题 + 尾随空白
      }
    }
  }
  return false
}

/**
 * 自 col 起尝试宽松内联链接/图片解析（col 必须在 `!`（图片形态）或 `[`
 * （链接形态）上）。命中返回出现（输入字符串坐标）；形态学不匹配或属标准
 * 层职责返回 null。limit 为扫描上界（阅读规则以行尾为界；缺省到串尾）。
 */
export function parseLooseLinkAt(src: string, col: number, limit = src.length): LooseLinkHit | null {
  if (col < 0 || limit > src.length || col >= limit) {
    return null
  }
  let at = col
  let image = false
  if (src.charCodeAt(at) === 0x21 /* ! */) {
    // 转义前缀（\!）属标准层语义，不构成图片前缀
    if (col > 0 && src.charCodeAt(col - 1) === 0x5c /* \ */) {
      return null
    }
    if (at + 1 >= limit || src.charCodeAt(at + 1) !== 0x5b /* [ */) {
      return null
    }
    image = true
    at++
  } else {
    if (src.charCodeAt(at) !== 0x5b /* [ */) {
      return null
    }
    // 链接形态的前置守卫：前置 [（双链/三连括号域）与前置 !（该括号只按
    // 图片形态尝试，在 ! 处解析，不回退链接）——图片形态的 [ 前即自身 !
    const prev = at > 0 ? src.charCodeAt(at - 1) : -1
    if (prev === 0x5b /* [ */ || prev === 0x21 /* ! */) {
      return null
    }
  }
  // 标签：至首个 ]；内部含 [ 或换行即降级（嵌套括号形态与双链守卫同族）；
  // 反斜杠（转义闭括号等）会破坏「首个 ]」判定，一律归标准层
  const labelFrom = at + 1
  let close = -1
  for (let i = labelFrom; i < limit; i++) {
    const code = src.charCodeAt(i)
    if (code === 0x5d /* ] */) {
      close = i
      break
    }
    if (code === 0x5b /* [ */ || code === 0x5c /* \ */ || code === 0x0a /* \n */) {
      return null
    }
  }
  if (close < 0 || close + 1 >= limit || src.charCodeAt(close + 1) !== 0x28 /* ( */) {
    return null
  }
  // 括号内容：嵌套括号深度平衡扫描至闭括号（不跨行、无反斜杠、无控制字符）
  const contentStart = close + 2
  let depth = 0
  let end = -1
  for (let i = contentStart; i < limit; i++) {
    const code = src.charCodeAt(i)
    if (code === 0x0a /* \n */) {
      return null
    }
    if (code === 0x5c /* \ */) {
      return null // 转义形态归标准层（含 \ 空格等），维持现状
    }
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      return null // 控制字符降级（制表符 0x09 是合法空白触发字符，放行）
    }
    if (code === 0x28 /* ( */) {
      depth++
      continue
    }
    if (code === 0x29 /* ) */) {
      if (depth === 0) {
        end = i
        break
      }
      depth--
    }
  }
  if (end < 0) {
    return null
  }
  const content = src.slice(contentStart, end)
  const dest = content.trim()
  if (dest === '') {
    return null // 空白内容降级
  }
  if (!/[\t ]/.test(dest)) {
    return null // 无空白触发字符：标准层职责
  }
  if (standardInlineDestParses(content)) {
    return null // 标准语法可解析：交还标准层
  }
  return { from: col, to: end + 1, labelFrom, labelTo: close, dest, image }
}

/**
 * 扫描单行文本中的全部宽松内联链接/图片出现（base 为该行首的全文 offset，
 * 缺省 0；出现互不重叠，未命中的 `[` 只推进一格——其后出现的合法形态仍
 * 必须独立命中）。图片形态经 `[` 前紧贴的 `!` 识别（`!` 处解析）。
 */
export function scanLooseLinksInLine(line: string, base = 0): LooseLinkHit[] {
  const out: LooseLinkHit[] = []
  let at = 0
  for (;;) {
    const open = line.indexOf('[', at)
    if (open < 0) {
      return out
    }
    const prev = open > 0 ? line[open - 1] : ''
    const col = prev === '!' ? open - 1 : open
    const hit = parseLooseLinkAt(line, col)
    if (hit) {
      out.push({
        ...hit,
        from: base + hit.from,
        to: base + hit.to,
        labelFrom: base + hit.labelFrom,
        labelTo: base + hit.labelTo,
      })
      at = hit.to
      continue
    }
    // 未命中（含 prev === '[' 的双链域）：只推进到本 [ 之后
    at = open + 1
  }
}

/** 找包含 col（from <= col < to）的宽松出现；未命中返回 null */
export function looseLinkAtCol(line: string, col: number): LooseLinkHit | null {
  for (const hit of scanLooseLinksInLine(line)) {
    if (hit.from <= col && col < hit.to) {
      return hit
    }
  }
  return null
}
