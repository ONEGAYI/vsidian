// CSS 片段本地依赖导入形态学（#129）：@import 与 url() 的纯逻辑扫描、
// 引用分类、按「各自 CSS 文件路径」的相对解析、目录包含判定与依赖闭包
// 遍历。宿主服务（host/cssSnippetService）用它做三件事——变更归因（哪个
// 入口依赖被改的文件）、越界/符号链接逃逸拒绝（清单装配前）、嵌套导入
// 的监听面（缺失但被引用的目标也入归因集，后续创建即触发重载）。
//
// 明确不追求完整 CSS 解析（#129 边界）：
// - 只识别 CSSOM 会实际生效的顶层 @import——出现在首个生效规则之前
//   （@charset 与 @layer「声明」不关闭导入窗口；块内或规则后的 @import
//   浏览器忽略，宿主也不计入依赖，避免过度归因与过度拒绝）。
// - 字符串转义只处理「反斜杠 + 下一字符」（\" \' \\）；十六进制转义不展开。
// - 条件语义（media/supports/layer）不解释求值——浏览器按条件取舍；宿主
//   把带条件的导入一并计入依赖（条件为假时多一次无害重载）。
// - 非本地引用（http(s)/data/fragment/空）不参与路径解析与越界判定：
//   联网资源属 #130 与 CSP 管辖，宿主不预判。

/** 引用分类（@import 地址与 url() 资产共用词表） */
export type CssRefKind =
  /** 相对当前 CSS 文件（唯一参与本地路径解析的类别） */
  | 'relative'
  /** 以 / 或 \ 开头——在 webview 源内解析到源根，必在片段目录资源面外 */
  | 'root-relative'
  /** 带协议的绝对 URL 且非 http(s)/data（file:、vscode-webview: 等） */
  | 'absolute'
  /** http(s) 与协议相对 //（联网导入与在线字体，#130） */
  | 'http'
  /** data: 内联载荷 */
  | 'data'
  /** 片段锚点（#gradient 一类，不产生网络请求） */
  | 'fragment'
  /** 空地址 */
  | 'empty'

export interface CssImportRef {
  /** 去引号/去 url() 包装后的原始地址串（未做百分号解码） */
  spec: string
  kind: CssRefKind
}

export interface CssAssetRef {
  spec: string
  kind: CssRefKind
}

export interface CssReferenceScan {
  imports: CssImportRef[]
  assets: CssAssetRef[]
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function classifyCssRef(spec: string): CssRefKind {
  const s = spec.trim()
  if (s === '') {
    return 'empty'
  }
  if (s.startsWith('#')) {
    return 'fragment'
  }
  if (/^data:/i.test(s)) {
    return 'data'
  }
  if (/^https?:/i.test(s) || s.startsWith('//')) {
    return 'http'
  }
  if (SCHEME_RE.test(s)) {
    return 'absolute'
  }
  if (s.startsWith('/') || s.startsWith('\\')) {
    return 'root-relative'
  }
  return 'relative'
}

/** 去除 /* 注释 *​/（字符串内的注释样文本保留；转义感知）。 */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'") {
      const quote = c
      out += c
      i++
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text[i]
          i++
          if (i < text.length) {
            out += text[i]
            i++
          }
          continue
        }
        out += text[i]
        if (text[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++
      }
      i = i < text.length ? i + 2 : text.length
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

/** 读一个引号字符串（进入点在开引号上）；返回 [值, 结束后下标] */
function readString(text: string, start: number): [string, number] {
  const quote = text[start]
  let value = ''
  let i = start + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\' && i + 1 < text.length) {
      value += text[i + 1]
      i += 2
      continue
    }
    if (c === quote) {
      return [value, i + 1]
    }
    value += c
    i++
  }
  return [value, i]
}

const isIdentChar = (c: string | undefined): boolean =>
  c !== undefined && /[a-zA-Z0-9_-]/.test(c)

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) {
    i++
  }
  return i
}

/** 解析 url(...) 函数体（已定位到 '(' 之后）：引号体或裸体。裸体（未引号）
 *  内的反斜杠转义按 CSS 语法消费（\X → X 计入地址）：url(a\).css) 的地址是
 *  a).css——转义括号不是函数体结束符，未处理会提前截断。注释不在此处剥
 *  离（scanCssReferences 已前置 stripComments 统一处理） */
function readUrlBody(text: string, openParenEnd: number): [string, number] | null {
  let i = skipWs(text, openParenEnd)
  if (i >= text.length) {
    return null
  }
  const c = text[i]
  if (c === '"' || c === "'") {
    const [value, end] = readString(text, i)
    return [value, end]
  }
  let value = ''
  while (i < text.length && text[i] !== ')') {
    if (text[i] === '\\' && i + 1 < text.length) {
      // 转义：下一字符原样计入地址（含 \) 与 \\），两字符一并消费
      value += text[i + 1]
      i += 2
      continue
    }
    value += text[i]
    i++
  }
  return [value.trim(), i < text.length ? i + 1 : i]
}

/** 从 @import 预备段（@import 之后到分号前的文本）提取导入地址：
 *  依 CSS 语法依次扫描，第一个 string 或 url() 记号即地址（layer/supports/
 *  media 词项跳过）；无地址（纯条件词）返回 null */
function extractImportSpec(prelude: string): string | null {
  let i = 0
  while (i < prelude.length) {
    const c = prelude[i]
    if (c === '"' || c === "'") {
      return readString(prelude, i)[0]
    }
    if (isIdentChar(c)) {
      let word = ''
      while (i < prelude.length && isIdentChar(prelude[i])) {
        word += prelude[i]
        i++
      }
      if (prelude[i] === '(') {
        if (word.toLowerCase() === 'url') {
          const body = readUrlBody(prelude, i + 1)
          if (body) {
            return body[0]
          }
          return null
        }
        // 其他函数（layer(base)/supports(...)）：跨过平衡括号
        let depth = 1
        i++
        while (i < prelude.length && depth > 0) {
          if (prelude[i] === '(') {
            depth++
          } else if (prelude[i] === ')') {
            depth--
          }
          i++
        }
      }
      continue
    }
    i++
  }
  return null
}

export function scanCssReferences(cssText: string): CssReferenceScan {  const text = stripComments(cssText)
  const imports: CssImportRef[] = []
  const assets: CssAssetRef[] = []
  let i = 0
  let depth = 0
  // CSSOM 有效性：@import 只在「首个生效规则」之前生效；@charset 与
  // @layer 声明（无块）不关闭窗口，其余任何顶层规则（含 @layer 块）关闭
  let importWindowOpen = true
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'") {
      const [, end] = readString(text, i)
      i = end
      continue
    }
    if (c === '{') {
      depth++
      importWindowOpen = false
      i++
      continue
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (c === '@' && depth === 0 && !isIdentChar(text[i - 1])) {
      let j = i + 1
      let keyword = ''
      while (j < text.length && isIdentChar(text[j])) {
        keyword += text[j]
        j++
      }
      const lower = keyword.toLowerCase()
      if (lower === 'import' && importWindowOpen) {
        // 收集预备段直到 ';'（字符串/括号感知；遇块起点按畸形丢弃尾段）
        let k = j
        let prelude = ''
        let parenDepth = 0
        while (k < text.length) {
          const pc = text[k]
          if (pc === '"' || pc === "'") {
            const [, end] = readString(text, k)
            prelude += text.slice(k, end)
            k = end
            continue
          }
          if (pc === '(') {
            parenDepth++
          } else if (pc === ')') {
            parenDepth = Math.max(0, parenDepth - 1)
          } else if (pc === ';' && parenDepth === 0) {
            break
          } else if ((pc === '{' || pc === '}') && parenDepth === 0) {
            break
          }
          prelude += pc
          k++
        }
        const spec = extractImportSpec(prelude)
        if (spec !== null && spec !== '') {
          imports.push({ spec, kind: classifyCssRef(spec) })
        }
        i = k < text.length && text[k] === ';' ? k + 1 : k
        continue
      }
      // 其余 at 规则：@charset 与 @layer「声明」（无块）不关闭导入窗口，
      // @layer 块与其他任何规则关闭。向前看首个 '{' 或 ';' 判定形态
      if (lower === 'layer' || lower === 'charset') {
        let k = j
        while (k < text.length && text[k] !== '{' && text[k] !== ';') {
          k++
        }
        if (k < text.length && text[k] === '{') {
          importWindowOpen = false
        }
        i = k < text.length ? k : text.length
        continue
      }
      importWindowOpen = false
      i = j
      continue
    }
    // url(...) 资产引用（不在已消费的 @import 预备段内）
    if ((c === 'u' || c === 'U') && depth >= 0 && !isIdentChar(text[i - 1])) {
      const rest = text.slice(i, i + 4).toLowerCase()
      if (rest === 'url(') {
        const body = readUrlBody(text, i + 4)
        if (body) {
          const spec = body[0]
          assets.push({ spec, kind: classifyCssRef(spec) })
          i = body[1]
          continue
        }
      }
    }
    i++
  }
  return { imports, assets }
}

/**
 * 路径归一：反斜杠→正斜杠、折叠 '.' 与 '..'（不越过的保留在段首供包含
 * 判定拒绝）、保留 Windows 盘符前缀。服务内部统一用正斜杠形态比较；宿主
 * fsPath 与 CSS 内正斜杠混用形态在此收敛。
 */
export function normalizeSnippetPath(path: string): string {
  const raw = path.replace(/\\/g, '/')
  let prefix = ''
  let rest = raw
  if (/^[a-zA-Z]:/.test(raw)) {
    prefix = raw.slice(0, 2)
    rest = raw.slice(2)
  } else if (raw.startsWith('//')) {
    // UNC：保双斜杠前缀语义（按 POSIX 绝对处理即可）
    prefix = '/'
    rest = raw.slice(2)
  } else if (raw.startsWith('/')) {
    prefix = '/'
    rest = raw.slice(1)
  }
  const segments: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') {
      continue
    }
    if (seg === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop()
      } else {
        segments.push('..')
      }
      continue
    }
    segments.push(seg)
  }
  if (prefix) {
    // 盘符/根之下不允许 '..' 逃逸段残留（盘根即顶）
    while (segments.length > 0 && segments[0] === '..') {
      segments.shift()
    }
    const joined = segments.join('/')
    if (prefix === '/') {
      return joined ? `/${joined}` : '/'
    }
    return joined ? `${prefix}/${joined}` : prefix
  }
  return segments.join('/')
}

/** 相对引用按「导入方 CSS 文件所在目录」解析（浏览器标准锚定语义）。
 *  仅接受 relative 类；百分号转义尽力解码（非法序列保留原文）。
 *  返回归一化正斜杠路径；非相对引用返回 null。 */
export function resolveCssRefPath(fromCssPath: string, spec: string): string | null {
  if (classifyCssRef(spec) !== 'relative') {
    return null
  }
  let decoded = spec.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // 非法百分号序列：保留原文（浏览器对畸形转义的处置同样宽容）
  }
  const fromDir = normalizeSnippetPath(fromCssPath).split('/').slice(0, -1).join('/')
  return normalizeSnippetPath(`${fromDir}/${decoded}`)
}

/** 词法包含判定（段边界精确；比较两侧大小写折叠——大小写不敏感文件系统
 *  上 CSS 词法路径与磁盘/realpath 路径可能仅大小写不同（@import "./Theme.css"
 *  vs theme.css），精确比较会漏判；折叠的方向取「过度匹配」而非「漏匹配」：
 *  大小写敏感文件系统上仅大小写不同的两个文件被过度判定包含，代价只是一次
 *  安全重载（重装同 URI 幂等），反向漏判则是越界/逃逸检查失真。段名实质
 *  不同仍拒绝；权威判定仍以 realpath 两侧归一化后的折叠比较为准） */
export function isPathWithinSnippetDirectory(directory: string, path: string): boolean {
  const d = normalizeSnippetPath(directory).toLowerCase()
  const p = normalizeSnippetPath(path).toLowerCase()
  return p === d || p.startsWith(`${d}/`)
}

/** 依赖闭包遍历端口（宿主注入 workspace.fs 读取与 node realpath） */
export interface SnippetAnalysisPorts {
  /** 读 CSS 文本（utf-8 解码；失败/不存在 → null） */
  readText(path: string): Promise<string | null>
  /** 符号链接解析（失败/不存在 → null） */
  realpath(path: string): Promise<string | null>
}

export interface SnippetAnalysisOk {
  ok: true
  /** 依赖闭包内全部本地导入目标（含缺失但被引用的目标：后续创建时
   *  watcher 事件可归因）。归一化正斜杠路径；入口自身不在内 */
  importPaths: string[]
  /** 入口文件当前是否可读（原子保存窗口内可为 false——不拒绝，交由
   *  webview 装载回报失败，宿主保留上一闭包） */
  entryReadable: boolean
}

export interface SnippetAnalysisRejected {
  ok: false
  /** path-escape：词法越界（../ 逃逸、根相对、file: 等非片段资源面引用）；
   *  symlink-escape：realpath 落在片段目录之外 */
  reason: 'path-escape' | 'symlink-escape'
  /** 逃逸目标（path-escape 为词法解析结果或原始 spec；symlink-escape 为
   *  realpath 结果）——用户提示与诊断用 */
  path: string
  /** 触发拒绝的原始引用写法 */
  spec: string
}

export type SnippetAnalysis = SnippetAnalysisOk | SnippetAnalysisRejected

/** 深度上限（循环由 visited 集合真正兜底；上限只是防御恶意长链的保险） */
export const SNIPPET_IMPORT_MAX_DEPTH = 32

/**
 * 分析单个入口片段的依赖闭包：从入口文件出发递归走本地 @import（嵌套、
 * 去重、深度上限），同时检查全部本地引用（导入 + url() 资产）的目录包含
 * 与符号链接逃逸。首个逃逸即返回拒绝（文档序确定）。
 *
 * @param directory 片段目录（宿主 fsPath，任意斜杠形态）
 * @param entryName 第一层入口文件名
 * @param ports 读写端口
 * @param realpathDirectory 片段目录的 realpath（调用方解析一次；解析失败
 *        传目录本身的归一化形态——目录不可读时扫描本身已失败，不会走到这）
 */
export async function analyzeSnippetEntry(
  directory: string,
  entryName: string,
  ports: SnippetAnalysisPorts,
  realpathDirectory: string,
  options: { maxDepth?: number } = {},
): Promise<SnippetAnalysis> {
  const maxDepth = options.maxDepth ?? SNIPPET_IMPORT_MAX_DEPTH
  const dir = normalizeSnippetPath(directory)
  const entryPath = normalizeSnippetPath(`${dir}/${entryName}`)
  const realCache = new Map<string, string | null>()
  const realpathCached = async (p: string): Promise<string | null> => {
    if (!realCache.has(p)) {
      realCache.set(p, await ports.realpath(p))
    }
    return realCache.get(p) ?? null
  }

  // 入口自身的符号链接检查（第一层符号链接文件指向目录外 → 拒绝）
  const entryReal = await realpathCached(entryPath)
  if (entryReal !== null && !isPathWithinSnippetDirectory(realpathDirectory, normalizeSnippetPath(entryReal))) {
    return { ok: false, reason: 'symlink-escape', path: entryReal, spec: entryName }
  }

  const importPaths: string[] = []
  const visited = new Set<string>()

  const checkLocalRef = async (
    fromPath: string,
    spec: string,
  ): Promise<SnippetAnalysisRejected | null> => {
    const resolved = resolveCssRefPath(fromPath, spec)
    if (resolved === null) {
      return null
    }
    if (!isPathWithinSnippetDirectory(dir, resolved)) {
      return { ok: false, reason: 'path-escape', path: resolved, spec }
    }
    const real = await realpathCached(resolved)
    if (real !== null && !isPathWithinSnippetDirectory(realpathDirectory, normalizeSnippetPath(real))) {
      return { ok: false, reason: 'symlink-escape', path: real, spec }
    }
    return null
  }

  const walk = async (filePath: string, depth: number): Promise<SnippetAnalysisRejected | null> => {
    const text = await ports.readText(filePath)
    if (text === null) {
      return null // 缺失/不可读：保留为归因成员（调用方已记录路径），不展开
    }
    const scan = scanCssReferences(text)
    for (const imp of scan.imports) {
      if (imp.kind === 'relative') {
        const rejected = await checkLocalRef(filePath, imp.spec)
        if (rejected) {
          return rejected
        }
        const resolved = resolveCssRefPath(filePath, imp.spec)
        if (resolved === null || visited.has(resolved)) {
          continue
        }
        visited.add(resolved)
        importPaths.push(resolved)
        if (depth + 1 <= maxDepth) {
          const nested = await walk(resolved, depth + 1)
          if (nested) {
            return nested
          }
        }
      } else if (imp.kind === 'root-relative' || imp.kind === 'absolute') {
        // 根相对/带协议绝对导入不经片段目录资源面（webview 源内必失败）
        return { ok: false, reason: 'path-escape', path: imp.spec, spec: imp.spec }
      }
      // http/data/fragment/empty 导入：非本地，浏览器与 CSP 管辖
    }
    for (const asset of scan.assets) {
      if (asset.kind === 'relative') {
        const rejected = await checkLocalRef(filePath, asset.spec)
        if (rejected) {
          return rejected
        }
      } else if (asset.kind === 'root-relative' || asset.kind === 'absolute') {
        return { ok: false, reason: 'path-escape', path: asset.spec, spec: asset.spec }
      }
      // http/data/fragment/empty 资产：#130/CSP 管辖
    }
    return null
  }

  const entryText = await ports.readText(entryPath)
  if (entryText === null) {
    return { ok: true, importPaths, entryReadable: false }
  }
  visited.add(entryPath)
  const rejected = await walk(entryPath, 0)
  if (rejected) {
    return rejected
  }
  return { ok: true, importPaths, entryReadable: true }
}
