// 引用改写计划纯逻辑（工单 #199，父规格 #194「引用自动更新」节）：
// 单文件 rename/move 后，按「旧路径→新路径映射 + 索引边（源文本区间与
// 原始目标串）」规划逐文档的文本替换——不直接改盘、不碰 TextDocument，
// 只产出区间与替换串（vscode 层经 WorkspaceEdit 应用，可撤销）。
//
// 规划语义（规格硬约束）：
// - **目标子串替换**：别名、标题/块锚点、URL 编码与无关正文原样保留——
//   wikilink 只替换 `[[` 后的路径段（`#`/`|` 之前），mdlink/image/refdef
//   只替换 href 的路径部分（首个 `#`/`?` 之前），query/fragment 原样
// - **相对路径重算**：按改写应用文档的目录（引用者=原目录；被移动文档
//   =新目录）与目标新位置计算（#196 planVaultLinkPath 的对偶生成侧）
// - **扩展名语义**：双链省略扩展名维持省略（新路径去 .md 尾）；显式
//   扩展名（.md/.pdf/.png…）保持完整——不产生 x.pdf.md
// - **编码风格跟随**：原目标为 percent-encode 形态（含 %XX）→ 新路径
//   按生成侧惯例编码（encodeImagePathComponent 同型）；字面形态（中文/
//   空格裸写）→ 新路径字面直写（tolerantDecode 对偶，两种写法解析同义）；
//   `<>` 尖括号包裹段整段替换（新路径无空格时不再需要包裹）
// - **跨根边界**：新相对路径越出应用文档所属根 → 该文档跳过并报告
//   （cross-root），不生成跨根相对引用；文档本身在工作区外同理
// - **区间漂移检测**：以索引边区间在**当前文本**上重新定位目标子串并
//   校验（trim / 剥 <> 后与边记录的原文一致）；不符 → 整文档跳过
//   （edge-stale），过期不硬改
// - **同文档合并**：同一文档多处命中合并为单一计划的多个 edit（区间
//   升序、互不重叠）；重叠异常按 stale 防御丢弃
// - **批量映射就绪（#200）**：moves 为映射表——同批移动的目标互指出链
//   按映射统一改写，不重复替换；**恒等替换滤除**（重算结果与原文一致
//   的边不产生编辑——目录整体平移时同目录互链的相对路径不变，不得计
//   入编辑数或产生空替换）
//
// #200 目录/批量移动映射展开（expandRenameMoves）：onWillRenameFiles 对
// 目录 rename/move 只给目录级 old→new——展开为目录下全部受影响文件的
// 逐文件映射。清单来源两路合流：**fs 递归列举**（.md 权威——索引滞后时
// 兜底，保证 did 批量重扫后索引域完整）∪ **索引清单**（asset 只在索引
// 有登记——被引用才有引用边，未引用附件无需映射）。fs/索引访问经端口
// 注入（node 单测直驱 fake；wiring 注入 workspace.fs 与索引服务）。
// will 阶段旧目录仍存在（isDirectory(old) 判定）；did 保底路径旧目录已
// 消失，但新路径是目录 + 索引仍是旧形态（watcher 对目录 rename 无逐文件
// 事件，#198 实测边界）→ 同样可展开。
//
// 本模块不依赖 vscode/DOM（node 单测直驱）；路径平台语义由 isWindowsHost
// 注入（与 vaultLink 同约定，与运行进程平台无关）。
import * as path from 'node:path'
import type { VaultEdge } from './vaultIndexModel'

/** 单条移动映射（单文件 rename/move 传 1 条；批量/目录移动传多条） */
export interface RenameMoveEntry {
  oldFsPath: string
  newFsPath: string
}

/** 目录移动映射展开端口（#200）：fs 访问与索引清单经端口注入（wiring
 *  实现 = workspace.fs.stat/readDirectory + 索引服务；单测注入 fake） */
export interface RenameExpandPort {
  /** 路径是否目录（will 阶段旧路径有效；did 保底时旧路径可能已不存在——
   *  实现应同时探测新路径） */
  isDirectory(fsPath: string): Promise<boolean>
  /** 递归列举目录下全部文件（绝对 fsPath；目录不存在返回空） */
  listFilesUnder(dirFsPath: string): Promise<string[]>
  /** 索引清单：目录前缀下全部已登记文件（.md + asset）；根未就绪 null */
  indexedFilesUnder(dirFsPath: string): string[] | null
}

/** 展开结果：逐文件映射（原始文件条目原样保留；目录条目被其内容替换）；
 *  notReadyMoves = 因索引未就绪被整体放弃的目录条目数（调用方计入反馈，
 *  不静默部分更新——not-ready 根的候选边查询与批量刷新同样无效） */
export interface RenameExpandResult {
  moves: RenameMoveEntry[]
  notReadyMoves: number
}

/**
 * 目录/批量移动映射展开（#200）：目录条目 → 目录下全部受影响文件的
 * 逐文件 old→new；文件条目原样。同 old 折叠去重（Windows 大小写语义），
 * 显式文件条目优先于展开产物（防御宿主不发的混合形态）。
 */
export async function expandRenameMoves(
  isWindowsHost: boolean,
  moves: readonly RenameMoveEntry[],
  port: RenameExpandPort,
): Promise<RenameExpandResult> {
  const ops = isWindowsHost ? path.win32 : path.posix
  const fold = (p: string): string => (isWindowsHost ? p.toLowerCase() : p)
  const norm = (p: string): string => ops.resolve(p)

  /** 已占用的 old 键（显式文件条目优先于展开产物） */
  const byOld = new Map<string, RenameMoveEntry>()
  for (const move of moves) {
    byOld.set(fold(norm(move.oldFsPath)), move)
  }
  /** 被展开替代的原始目录条目键（输出剔除目录条目本身） */
  const dirOldKeys = new Set<string>()
  const expanded: RenameMoveEntry[] = []
  let notReadyMoves = 0
  for (const move of moves) {
    const oldKey = fold(norm(move.oldFsPath))
    const isDir = (await port.isDirectory(move.oldFsPath)) ||
      (await port.isDirectory(move.newFsPath))
    if (!isDir) {
      continue // 文件条目原样保留（已在 byOld）
    }
    const indexed = port.indexedFilesUnder(move.oldFsPath)
    if (indexed === null) {
      // 索引未就绪：该目录整体放弃（引用者边查询与批量刷新同样无效——
      // 不静默部分更新），计入反馈
      notReadyMoves += 1
      dirOldKeys.add(oldKey)
      continue
    }
    dirOldKeys.add(oldKey)
    const oldDir = norm(move.oldFsPath)
    const newDir = norm(move.newFsPath)
    // 清单合流：fs 递归列举的 .md（权威兜底）∪ 索引清单全部登记类型
    //（asset 只在索引有登记——未引用附件无引用边，不产生映射）
    const fsFiles = await port.listFilesUnder(move.oldFsPath)
    const seen = new Set<string>()
    const add = (absFsPath: string): void => {
      const key = fold(norm(absFsPath))
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      if (byOld.has(key)) {
        return // 显式文件条目/先前展开优先
      }
      const rel = ops.relative(oldDir, norm(absFsPath))
      if (rel === '' || rel.startsWith('..')) {
        return // 防御：非目录内路径
      }
      const entry: RenameMoveEntry = {
        oldFsPath: absFsPath,
        newFsPath: ops.join(newDir, ...rel.split(ops.sep)),
      }
      byOld.set(key, entry)
      expanded.push(entry)
    }
    for (const f of fsFiles) {
      if (/\.md$/i.test(f)) {
        add(f)
      }
    }
    for (const f of indexed) {
      add(f)
    }
  }
  return {
    moves: [
      ...moves.filter((m) => !dirOldKeys.has(fold(norm(m.oldFsPath)))),
      ...expanded,
    ],
    notReadyMoves,
  }
}

/** 改写规划上下文 */
export interface RenamePlanContext {
  /** 全部工作区根的绝对 fsPath（含嵌套根；最具体根 = 最长前缀命中） */
  rootFsPaths: readonly string[]
  /** 宿主文件系统语义（Windows 本地 true；远程一律 false） */
  isWindowsHost: boolean
  /** 本批移动映射 */
  moves: readonly RenameMoveEntry[]
}

/** 候选文档输入（wiring 按索引查询分组；边区间须与 text 对齐语义见下） */
export interface RenameDocInput {
  /** 改写应用目标路径：引用者 = 原路径；被移动文档自身 = 新路径 */
  fsPath: string
  /** 该文档当前文本（LF 归一——已打开文档含未保存内容） */
  text: string
  /** 索引边（区间为 LF 偏移；指向被移动目标的边，或被移动文档的出链） */
  edges: readonly VaultEdge[]
  /** 边 resolvedTarget 的根空间：引用者 = 其所属根；被移动文档 = 旧所属根 */
  edgeRootFsPath: string
}

/** 单条文本替换（LF 偏移；vscode 层转宿主坐标） */
export interface RenameTextEdit {
  start: number
  end: number
  replacement: string
}

/** 单文档改写计划 */
export interface RenameDocPlan {
  fsPath: string
  edits: readonly RenameTextEdit[]
}

/** 跳过原因：cross-root=无法保持根内引用；edge-stale=区间与当前文本不符 */
export type RenameSkipReason = 'cross-root' | 'edge-stale'

export interface RenameSkipItem {
  fsPath: string
  reason: RenameSkipReason
  detail: string
}

/** 规划结果：docs 为待应用计划（空数组=无可改写）；skipped 为跳过报告 */
export interface RenamePlanResult {
  docs: readonly RenameDocPlan[]
  skipped: readonly RenameSkipItem[]
}

/** href 的路径/query/fragment 原文拆分（linkTarget.planPathTextOf 同语义：
 *  首个 `#` 之前、再首个 `?` 之前为路径；其后整段原样保留） */
function splitHrefParts(href: string): { pathRaw: string; suffix: string } {
  const hash = href.indexOf('#')
  const query = href.indexOf('?')
  let cut = -1
  if (hash >= 0 && query >= 0) {
    cut = Math.min(hash, query)
  } else {
    cut = hash >= 0 ? hash : query
  }
  if (cut < 0) {
    return { pathRaw: href, suffix: '' }
  }
  return { pathRaw: href.slice(0, cut), suffix: href.slice(cut) }
}

/** 百分号编码形态探测：含 %XX 序列视为编码风格（跟随生成侧惯例） */
function isPercentEncodedForm(text: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(text)
}

/** 生成侧单段 percent-encode（imagePastePlan.encodeImagePathComponent 同型；
 *  `..` 与安全字符保持原样，分隔符由调用方分段处理） */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** 相对路径整体编码：按 `/` 分段编码（`..` 段编码后保持 `..`——
 *  encodeURIComponent 不编码 `.`） */
function encodeRelativePath(rel: string): string {
  return rel.split('/').map(encodeSegment).join('/')
}

/** 相对路径是否需要 `<>` 包裹（标准语法里裸空格非法——字面空格形态交由
 *  宽松层，编码形态空格变 %20 后无需包裹） */
function relativePathOf(ops: typeof path.posix, fromDir: string, to: string): string {
  return ops.relative(fromDir, to).split(ops.sep).join('/')
}

/** 计划主入口：对候选文档集合生成逐文档替换计划与跳过报告 */
export function planVaultRenameRewrites(
  ctx: RenamePlanContext,
  docs: readonly RenameDocInput[],
): RenamePlanResult {
  const ops = ctx.isWindowsHost ? path.win32 : path.posix
  const fold = (p: string): string => (ctx.isWindowsHost ? p.toLowerCase() : p)
  const norm = (p: string): string => ops.resolve(p)
  const roots = [...ctx.rootFsPaths].sort((a, b) => fold(norm(b)).length - fold(norm(a)).length)

  /** 最具体根（最长前缀）；无根 undefined */
  const rootOf = (fsPath: string): string | undefined => {
    const key = fold(norm(fsPath))
    for (const root of roots) {
      const rk = fold(norm(root))
      if (key === rk || key.startsWith(`${rk}/`) || key.startsWith(`${rk}\\`)) {
        return root
      }
    }
    return undefined
  }

  const moveByOld = new Map<string, RenameMoveEntry>()
  for (const move of ctx.moves) {
    moveByOld.set(fold(norm(move.oldFsPath)), move)
  }
  const moveByNew = new Map<string, RenameMoveEntry>()
  for (const move of ctx.moves) {
    moveByNew.set(fold(norm(move.newFsPath)), move)
  }

  const planDocs: RenameDocPlan[] = []
  const skipped: RenameSkipItem[] = []

  for (const doc of docs) {
    const docRoot = rootOf(doc.fsPath)
    const docDir = ops.dirname(norm(doc.fsPath))
    // 本文档是否为批内被移动文档（应用目标 = 新路径）：其全部出链重算
    const selfMove = moveByNew.get(fold(norm(doc.fsPath)))
    const docEdits: RenameTextEdit[] = []
    let docStale = false
    let docCrossRoot = false

    for (const edge of doc.edges) {
      if (docStale) {
        break // 文档级跳过已定：区间基线不可信
      }
      // 本文件锚点（无路径段）与断链/外链边不改写
      if (edge.resolvedTarget === null || edge.target.trim() === '') {
        continue
      }
      // 引用者文档：只有指向本批被移动目标的边才改写；被移动文档自身：
      // 全部出链按新目录重算
      const targetAbsRaw = ops.resolve(norm(doc.edgeRootFsPath), ...String(edge.resolvedTarget).split('/'))
      const move = moveByOld.get(fold(targetAbsRaw))
      if (!selfMove && move === undefined) {
        continue
      }
      const targetAbs = move !== undefined ? norm(move.newFsPath) : targetAbsRaw
      if (targetAbs.trim() === '') {
        continue
      }

      // 跨根判定：目标必须仍在应用文档所属根内（文档无根 = 工作区外）
      if (docRoot === undefined || !isInside(ops, docRoot, targetAbs)) {
        docCrossRoot = true
        continue
      }

      // 新相对路径与扩展名语义
      let newRel = relativePathOf(ops, docDir, targetAbs)
      const pathRawOfEdge = splitHrefParts(edge.target).pathRaw
      const originalHasExt = ops.extname(decodeLoose(pathRawOfEdge)) !== ''
      if (!originalHasExt && /\.md$/i.test(newRel)) {
        newRel = newRel.slice(0, -3)
      }

      // 区间定位与替换生成
      const s = doc.text.slice(edge.start, edge.end)
      const edit = buildEdit(edge, s, newRel, edge.start)
      if (edit === null) {
        docStale = true
        break
      }
      // 恒等替换滤除（#200）：重算结果与原文一致（目录整体平移时同目录
      // 互链的相对路径不变）——不产生编辑、不计入编辑数
      if (doc.text.slice(edit.start, edit.end) === edit.replacement) {
        continue
      }
      docEdits.push(edit)
    }

    if (docStale) {
      skipped.push({
        fsPath: doc.fsPath,
        reason: 'edge-stale',
        detail: edgeStaleDetail(doc),
      })
      continue
    }
    if (docEdits.length === 0) {
      if (docCrossRoot) {
        skipped.push({
          fsPath: doc.fsPath,
          reason: 'cross-root',
          detail: targetCrossRootDetail(doc),
        })
      }
      continue // 无可改写边且无跳过（如全部为本文件锚点/断链）
    }
    if (docCrossRoot) {
      // 同文档内既有可改写边又有跨根边：跨根项仍须报告（部分跳过）
      skipped.push({
        fsPath: doc.fsPath,
        reason: 'cross-root',
        detail: targetCrossRootDetail(doc),
      })
    }
    // 区间升序 + 重叠防御（重叠按 stale 丢弃后续——正常边表不重叠）
    docEdits.sort((a, b) => a.start - b.start)
    const kept: RenameTextEdit[] = []
    let lastEnd = -1
    for (const e of docEdits) {
      if (e.start < lastEnd) {
        continue
      }
      kept.push(e)
      lastEnd = e.end
    }
    planDocs.push({ fsPath: doc.fsPath, edits: kept })
  }

  return { docs: planDocs, skipped }
}

/**
 * LF 偏移 → 宿主文本行/列（vscode 层把计划 edit 转为 Position 用）。
 * 宿主文本行界按 /\r\n|\n|\r/ 与 LF 归一（\r\n? → \n）对偶拆分——第 k 个
 * LF 行对应宿主第 k 行，列偏移一致（行界字符不计入列）。
 */
export function lfOffsetToLineCol(
  hostText: string,
  lfOffset: number,
): { line: number; character: number } {
  const lineRe = /\r\n|\n|\r/g
  let line = 0
  let lfAcc = 0 // 当前行首的 LF 偏移
  let searchFrom = 0
  for (;;) {
    lineRe.lastIndex = searchFrom
    const m = lineRe.exec(hostText)
    const segEnd = m === null ? hostText.length : m.index
    const segLen = segEnd - searchFrom
    if (lfOffset <= lfAcc + segLen) {
      return { line, character: lfOffset - lfAcc }
    }
    if (m === null) {
      return { line, character: segLen } // 越界防御：钳到文末
    }
    line += 1
    lfAcc += segLen + 1
    searchFrom = m.index + m[0].length
  }
}

/** root 是否包含 absolute（含根本身；`..foo` 同级文件名不误判） */
function isInside(ops: typeof path.posix, root: string, absolute: string): boolean {
  const rel = ops.relative(ops.resolve(root), ops.resolve(absolute))
  if (rel === '') {
    return true
  }
  return rel !== '..' && !rel.startsWith(`..${ops.sep}`) && !ops.isAbsolute(rel)
}

/** 容错 percent-decode（linkTarget.tolerantDecode 同语义：非法序列原样保留） */
function decodeLoose(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function edgeStaleDetail(doc: RenameDocInput): string {
  return `document text no longer matches index edge offsets: ${doc.fsPath}`
}

function targetCrossRootDetail(doc: RenameDocInput): string {
  return `target cannot be referenced inside the document's root: ${doc.fsPath}`
}

/**
 * 在区间文本 s（text.slice(start, end)）内定位目标子串并生成替换。
 * 定位失败（形态不符 / 子串与边记录原文不一致）返回 null——文档级 stale。
 *
 * @param baseOffset 区间起点在全文中的偏移
 */
function buildEdit(
  edge: VaultEdge,
  s: string,
  newRel: string,
  baseOffset: number,
): RenameTextEdit | null {
  if (edge.kind === 'wikilink') {
    return buildWikilinkEdit(edge, s, newRel, baseOffset)
  }
  return buildHrefEdit(edge, s, newRel, baseOffset)
}

/** wikilink：替换 `[[` 后的路径段（首个 `#`/`|` 之前，含首尾空白） */
function buildWikilinkEdit(
  edge: VaultEdge,
  s: string,
  newRel: string,
  baseOffset: number,
): RenameTextEdit | null {
  if (!s.startsWith('[[') || !s.endsWith(']]')) {
    return null
  }
  const inner = s.slice(2, -2)
  const pipeAt = inner.indexOf('|')
  const targetPart = pipeAt >= 0 ? inner.slice(0, pipeAt) : inner
  const hashAt = targetPart.indexOf('#')
  const pathRaw = hashAt >= 0 ? targetPart.slice(0, hashAt) : targetPart
  if (pathRaw.trim() !== edge.target) {
    return null
  }
  // 双链形态学不做 URL 编码（字面直写）；省略扩展名已在主流程剥除
  return {
    start: baseOffset + 2,
    end: baseOffset + 2 + pathRaw.length,
    replacement: newRel,
  }
}

/** mdlink/image/refdef：替换 href 的路径部分（保留 query/fragment/标题）。
 *  `<>` 尖括号包裹形态替换整个包裹段——新路径仍含空格时重新包裹（字面
 *  风格），否则不再需要包裹。 */
function buildHrefEdit(
  edge: VaultEdge,
  s: string,
  newRel: string,
  baseOffset: number,
): RenameTextEdit | null {
  // 定位目标文本段（相对区间起点；destStart/destEnd 为含 <> 包裹的范围）
  let destStart: number
  let destEnd: number
  let angleWrapped = false
  if (edge.kind === 'refdef') {
    const colon = s.indexOf(']:')
    if (colon < 0) {
      return null
    }
    const rest = s.slice(colon + 2)
    const lead = rest.length - rest.trimStart().length
    const trimmed = rest.trimStart()
    if (trimmed.startsWith('<')) {
      const close = trimmed.indexOf('>')
      if (close < 0) {
        return null
      }
      destStart = colon + 2 + lead
      destEnd = destStart + close + 1
      angleWrapped = true
    } else {
      const sp = trimmed.search(/[\s]/)
      const len = sp < 0 ? trimmed.length : sp
      destStart = colon + 2 + lead
      destEnd = destStart + len
    }
  } else {
    const open = s.lastIndexOf('](')
    if (open < 0 || !s.endsWith(')')) {
      return null
    }
    const inner = s.slice(open + 2, s.length - 1)
    const lead = inner.length - inner.trimStart().length
    const innerTrimmed = inner.trimStart().trimEnd()
    if (innerTrimmed.startsWith('<') && innerTrimmed.endsWith('>') && innerTrimmed.length >= 2) {
      destStart = open + 2 + lead
      destEnd = destStart + innerTrimmed.length
      angleWrapped = true
    } else {
      destStart = open + 2 + lead
      destEnd = destStart + innerTrimmed.length
    }
  }
  const destRaw = s.slice(destStart, destEnd)
  // 校验：剥 <> 后与边记录原文一致（树驱动/宽松/refdef 的 target 均为
  // href 原文——宽松为 trim 后字面段，此处定位已做同口径 trim）
  const innerText = angleWrapped ? destRaw.slice(1, -1) : destRaw
  if (innerText !== edge.target) {
    return null
  }
  // 生成新目标文本：编码风格跟随 + query/fragment 原样保留
  const { suffix } = splitHrefParts(innerText)
  const replacementPath = isPercentEncodedForm(splitHrefParts(edge.target).pathRaw)
    ? encodeRelativePath(newRel)
    : newRel
  const body = `${replacementPath}${suffix}`
  const replacement = angleWrapped && /[ \t]/.test(replacementPath) ? `<${body}>` : body
  return {
    start: baseOffset + destStart,
    end: baseOffset + destEnd,
    replacement,
  }
}
