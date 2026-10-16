// 引用改写计划纯逻辑（工单 #199，父规格 #194「引用自动更新」节）：
// 单文件 rename/move 后，按「旧路径→新路径映射 + 索引边（源文本区间与
// 原始目标串）」规划逐文档的文本替换——不直接改盘、不碰 TextDocument，
// 只产出区间与替换串（vscode 层经 WorkspaceEdit 应用，可撤销）。
//
// 规划语义（规格硬约束）：
// - **目标子串替换**：别名、标题/块锚点、URL 编码与无关正文原样保留——
//   wikilink 只替换 `[[` 后的路径段（`#`/`|` 之前），embed 只替换 `![[`
//   后的路径段（#222，与 wikilink 同构），mdlink/image/refdef 只替换
//   href 的路径部分（首个 `#`/`?` 之前），query/fragment 原样
// - **目标文本三形态决策（#556 T4，规格「改名与移动」节）**：保留更名前
//   已确定的目标——
//   1. 原短名在新状态（映射应用后的世界）仍准确命中同一目标 → 不改正文
//      （纯移动场景短名位置无关，零编辑；判定 = 同目录相对候选直击，或
//      短名唯一性端口校正后的唯一命中——端口不注入/未就绪时不猜目标，
//      不冒充命中）；
//   2. 文件改名后新短名唯一且准确 → 更新短名（省略/显式扩展名各自保持）；
//   3. 无法安全保留短名 → 改有效的明确相对路径；目标越出来源根或为
//      外部目标 → 明确绝对路径（**替代 #199 的 cross-root 跳过报告**——
//      身份用绝对形态保留，跳过仅余 edge-stale）
//   已有路径链接按原形式更新：相对路径仍有效时保持相对（按改写应用文档
//   目录重算），绝对路径随目标更名更新绝对形态；不因切换插入设置批量换
//   风格（决策不读设置）。形态判定与短名域复用 vaultLink 规划器口径
//   （planVaultLinkPath / shortnameLookupKeyOf，R1 单一解析语义）
// - **短名唯一性端口（R6）**：经 RenamePlanContext.shortnameLookup 注入
//   （wiring 传索引 catalog 倒排查询，零 IO）；本模块纯函数、不引 IO。
//   will 阶段端口返回旧世界 catalog——规划器按 moves 映射校正为新世界
//   同名集（改名者退出、移出根域者剔除、移入根域的同名新路径并入）；
//   did 阶段端口已是新世界，校正自然 no-op
// - **扩展名语义**：双链省略扩展名维持省略（新路径去 .md 尾）；显式
//   扩展名（.md/.pdf/.png…）保持完整——不产生 x.pdf.md（短名与绝对
//   形态同此语义）
// - **编码风格跟随**：原目标为 percent-encode 形态（含 %XX）→ 新路径
//   按生成侧惯例编码（encodeImagePathComponent 同型）；字面形态（中文/
//   空格裸写）→ 新路径字面直写（tolerantDecode 对偶，两种写法解析同义）；
//   `<>` 尖括号包裹段整段替换（新路径无空格时不再需要包裹）
// - **绝对形态文本**：Windows 宿主盘符 `/` 分隔形式、POSIX 原样
//   （ADR-0018「显式绝对路径」的生成侧对偶）
// - **区间漂移检测**：以索引边区间在**当前文本**上重新定位目标子串并
//   校验（trim / 剥 <> 后与边记录的原文一致）；不符 → 整文档跳过
//   （edge-stale），过期不硬改
// - **同文档合并**：同一文档多处命中合并为单一计划的多个 edit（区间
//   升序、互不重叠）；重叠异常按 stale 防御丢弃
// - **批量映射就绪（#200）**：moves 为映射表——同批移动的目标互指出链
//   按映射统一改写，不重复替换；**恒等替换滤除**（重算结果与原文一致
//   的边不产生编辑——含 #556 短名保留的零编辑路径）
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
import { planVaultLinkPath, shortnameLookupKeyOf, type VaultLinkPathContext } from './vaultLink'
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
  // review-loops #12：目录条目按 old 路径长度降序处理（最具体的子目录先
  // 展开）——父目录先展开会把子目录下文件映射到父新路径下，吞并同批
  // 子目录自身的映射（子目录 rename 语义丢失）
  const dirEntries: Array<{ move: RenameMoveEntry; oldKey: string; depth: number }> = []
  for (const move of moves) {
    const isDir = (await port.isDirectory(move.oldFsPath)) ||
      (await port.isDirectory(move.newFsPath))
    if (!isDir) {
      continue // 文件条目原样保留（已在 byOld）
    }
    dirEntries.push({
      move,
      oldKey: fold(norm(move.oldFsPath)),
      depth: norm(move.oldFsPath).length,
    })
  }
  dirEntries.sort((a, b) => b.depth - a.depth)
  for (const { move, oldKey } of dirEntries) {
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

/** 短名唯一性查询端口（#556 T4）：按来源 fsPath（定位最具体根分区）与
 *  完整 basename（含扩展名）查该根内未排除 Markdown 的候选（绝对身份
 *  形态——host 侧 catalog 倒排，零 IO，R6）；null = 索引未就绪/来源无
 *  分区——不注入短名语义（保留与更新两决策均不冒充命中，退相对路径）。
 *  与 vaultIndexService.shortnameLookup / VaultLinkShortnameLookupResult
 *  结构同形（本模块不 import host/vscode）。 */
export interface RenameShortnameLookupPort {
  (sourceFsPath: string, basename: string):
    | { candidates: readonly string[]; complete: boolean }
    | null
}

/** 改写规划上下文 */
export interface RenamePlanContext {
  /** 全部工作区根的绝对 fsPath（含嵌套根；最具体根 = 最长前缀命中） */
  rootFsPaths: readonly string[]
  /** 宿主文件系统语义（Windows 本地 true；远程一律 false） */
  isWindowsHost: boolean
  /** 本批移动映射 */
  moves: readonly RenameMoveEntry[]
  /** 短名唯一性查询端口（#556 T4，可选注入；wiring 传索引查询） */
  shortnameLookup?: RenameShortnameLookupPort
  /** 新世界路径存在性端口（评审 S1，可选注入）：候选序「第一个存在文件
   *  优先」核对用——will 阶段 = catalog 登记 ∪ moves 新路径；did 阶段 =
   *  catalog 登记（moves 已落盘）。未注入退化为几何比较（上游兼容） */
  targetExists?: (fsPath: string) => boolean
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

/** 跳过原因（#556 T4 起 cross-root 越界改为绝对路径改写，不再跳过）：
 *  edge-stale = 区间与当前文本不符（过期不硬改） */
export type RenameSkipReason = 'edge-stale'

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

/** #556 T4 单边目标文本决策输入（planVaultRenameRewrites 主循环组装；
 *  ops/fold/norm 为宿主语义闭包，insideRoot 为应用文档所属根域判定） */
interface EdgeTargetPlanArgs {
  ops: typeof path.posix
  fold: (p: string) => string
  norm: (p: string) => string
  isWindowsHost: boolean
  moves: readonly RenameMoveEntry[]
  moveByOld: Map<string, RenameMoveEntry>
  lookup: RenameShortnameLookupPort | undefined
  /** 新世界路径存在性（评审 S1；未注入为 undefined——候选核对退化几何比较） */
  targetExists: ((fsPath: string) => boolean) | undefined
  /** 路径是否在应用文档所属根域内（无根恒 false） */
  insideRoot: (p: string) => boolean
  /** 改写应用文档（引用者=原路径；被移动文档=新路径）——lookup 端口的
   *  来源定位（最具体根分区随应用目标走） */
  docFsPath: string
  docDir: string
  docRoot: string | undefined
  edge: VaultEdge
  /** 目标新绝对身份（映射应用后） */
  targetAbs: string
}

/**
 * #556 T4 目标文本三形态决策（纯函数，规格「改名与移动」节）：
 *
 * 1. **绝对形态原文**（planVaultLinkPath 判 absolute——R1 复用规划器
 *    口径）→ 随目标更名更新绝对形态（扩展名省略语义跟随原文）。
 * 2. **短名形态原文**（仅文件名 + Markdown 语义，shortnameLookupKeyOf
 *    判域）→
 *    a. 同目录相对候选直击目标新身份 → 返回 null（保留原文，零编辑）；
 *    b. 原短名在新世界同名集唯一且命中 → null（保留——纯移动场景）；
 *    c. 新短名（目标新 basename）唯一且命中 → 新短名文本；
 *    d. 无法安全保留 → 落入相对/绝对分支。
 * 3. **明确相对路径原文**（含分隔符；文件名但非 Markdown 语义同理）→
 *    目标在根域内保持相对（按应用文档目录重算，扩展名语义沿用）；越出
 *    根域/无根 → 明确绝对路径。
 *
 * 短名唯一性经注入端口查询（未注入/未就绪不冒充命中——保留与更新两
 * 决策都不猜目标，退相对路径）；「新世界」= moves 映射应用后的文件集
 * （will 阶段端口返回旧世界 catalog，经 newWorldShortnameCandidates 校正）。
 */
function planEdgeTargetText(a: EdgeTargetPlanArgs): string | null {
  const pathRaw = splitHrefParts(a.edge.target).pathRaw
  const decodedRaw = decodeLoose(pathRaw)
  const originalHasExt = a.ops.extname(decodedRaw) !== ''
  const linkCtx: VaultLinkPathContext = {
    docDir: a.docDir,
    rootDir: a.docRoot ?? a.docDir,
    isWindowsHost: a.isWindowsHost,
  }

  // 形态 1：绝对路径原文随目标更名（不接 docDir、不受根域边界）
  if (planVaultLinkPath(decodedRaw, linkCtx).kind === 'absolute') {
    return absoluteTextOf(a, originalHasExt)
  }

  // 形态 2：短名（仅文件名 + Markdown 语义——image 边无隐式 .md 意图）
  const implicitMd = a.edge.kind !== 'image'
  const shortnameKey = shortnameLookupKeyOf(decodedRaw, linkCtx, { implicitMd })
  if (shortnameKey !== null) {
    // a. 同目录相对候选直击（T1 解析序「相对候选优先」的保留面——目标
    //    移入应用文档同目录时原文已是最短准确形态）。评审 S1：核对必须
    //    遵守解析器「第一个存在文件优先」——只判断「候选含目标」会在
    //    裸名文件遮蔽候选序时把链接偷换成另一文件；注入存在性端口时按
    //    首个存在候选核对身份，未注入退化为几何比较（上游兼容）
    const sameDirBase = a.ops.resolve(a.docDir, decodedRaw)
    const sameDirCandidates = originalHasExt || !implicitMd
      ? [sameDirBase]
      : [sameDirBase, `${sameDirBase}.md`]
    const sameDirHit = a.targetExists !== undefined
      ? sameDirCandidates.find((c) => a.targetExists!(c))
      : sameDirCandidates.find((c) => a.fold(a.norm(c)) === a.fold(a.targetAbs))
    if (sameDirHit !== undefined && a.fold(a.norm(sameDirHit)) === a.fold(a.targetAbs)) {
      return null
    }
    // 评审 S1：同目录第一个存在候选非目标 = 短名被遮蔽——解析器「相对
    // 候选第一个存在文件优先」在补查之前命中，原文短名到不了补查桶
    const shadowedBySameDir = sameDirHit !== undefined
    // b. 原短名在新世界同名集唯一命中 → 保留（唯一性须 complete——
    //    清单不完整不声明唯一，pending 语义不冒充命中；遮蔽时解析器
    //    序到不了补查，唯一性再真也不保留）
    if (!shadowedBySameDir && a.lookup !== undefined && shortnameUniqueHit(a, shortnameKey)) {
      return null
    }
    // c. 新短名唯一且准确 → 更新（短名 = 目标新 basename，扩展名省略
    //    语义跟随原文；短名语义仅 Markdown）。省略扩展的前提是「省略后
    //    仍唯一解析」——新裸名在同目录被遮蔽或无端口可判时用显式形态
    //    （评审 S1：省略形态会把解析偷换给遮蔽文件）
    const newBase = a.ops.basename(a.targetAbs)
    if (/\.md$/i.test(newBase) && a.lookup !== undefined && shortnameUniqueHit(a, newBase)) {
      const bareBase = newBase.replace(/\.md$/i, '')
      const bareShadowed = a.targetExists !== undefined
        && a.targetExists(a.ops.resolve(a.docDir, bareBase))
      if (originalHasExt || (implicitMd && bareShadowed)) {
        return newBase
      }
      if (implicitMd) {
        return newBase.replace(/\.md$/i, '')
      }
      return newBase
    }
    // d. 无法安全保留 → 相对/绝对（下方通用分支）
  }

  // 形态 3：明确相对路径保持相对（根域内）；越出根域/无根 → 绝对路径
  if (a.insideRoot(a.targetAbs)) {
    let rel = relativePathOf(a.ops, a.docDir, a.targetAbs)
    if (!originalHasExt && /\.md$/i.test(rel)) {
      rel = rel.slice(0, -3)
    }
    return rel
  }
  return absoluteTextOf(a, originalHasExt)
}

/** 绝对形态链接文本（ADR-0018 生成侧对偶）：Windows 盘符 `/` 分隔、
 *  POSIX 原样；扩展名省略语义跟随原文（原文无扩展名且目标 .md → 去尾） */
function absoluteTextOf(a: EdgeTargetPlanArgs, originalHasExt: boolean): string {
  const text = a.isWindowsHost
    ? a.norm(a.targetAbs).replace(/\\/g, '/')
    : a.norm(a.targetAbs)
  if (!originalHasExt && /\.md$/i.test(text)) {
    return text.slice(0, -3)
  }
  return text
}

/** 短名 key 在新世界（moves 应用后）是否唯一命中决策目标（#556 T4）：
 *  端口未就绪（null）或清单不完整（complete=false）不声明唯一。 */
function shortnameUniqueHit(a: EdgeTargetPlanArgs, key: string): boolean {
  const found = a.lookup?.(a.docFsPath, key)
  if (found === null || found === undefined || !found.complete) {
    return false
  }
  const candidates = newWorldShortnameCandidates(a, found.candidates, key)
  return candidates.length === 1 && a.fold(a.norm(candidates[0]!)) === a.fold(a.targetAbs)
}

/**
 * 复审 S1 终审回验：目标文本按**解析器语义**（候选序「第一个存在文件优先」
 * + 短名补查）回算命中身份，必须等于决策目标——决策分支对存在性的局部
 * 探测（同目录候选序、裸名遮蔽）覆盖不到的组合面（降级分支剥 .md 后的
 * 相对/绝对遮蔽、端口数据面缺口）在此统一拦截，不建第二套规则（R1）。
 * 存在性端口未注入不回验（上游兼容，决策分支自身已退化为几何比较）。
 */
function resolvesToTargetText(a: EdgeTargetPlanArgs, text: string): boolean {
  if (a.targetExists === undefined) {
    return true
  }
  const implicitMd = a.edge.kind !== 'image'
  const linkCtx: VaultLinkPathContext = {
    docDir: a.docDir,
    rootDir: a.docRoot ?? a.docDir,
    isWindowsHost: a.isWindowsHost,
  }
  const plan = planVaultLinkPath(text, linkCtx, { implicitMd })
  if (plan.kind === 'escape') {
    return false // 生成的文本越出解析域（防御：正常三形态产物不会到达）
  }
  for (const candidate of plan.candidates) {
    if (a.targetExists(candidate)) {
      return a.fold(a.norm(candidate)) === a.fold(a.targetAbs)
    }
  }
  // 候选全未命中：短名补查域按唯一命中核对（与 b/c 分支同一端口与校正）
  const key = shortnameLookupKeyOf(text, linkCtx, { implicitMd })
  if (key !== null) {
    return shortnameUniqueHit(a, key)
  }
  return false // 目标存在而生成文本解析为空（断链）——不可用
}

/**
 * planEdgeTargetText 的终审回验包装（复审 S1）：决策文本（null=保留原文）
 * 经解析器语义回验，命中身份≠目标即降级为显式扩展形态——根域内相对路径
 * 不剥 .md（单候选直击目标，候选序无从被遮蔽）、越根明确绝对路径不剥。
 * 兜底形态本身不再回验降级（无更安全形态，尽力而为）。
 */
function planEdgeTargetTextVerified(a: EdgeTargetPlanArgs): string | null {
  const decided = planEdgeTargetText(a)
  const candidate = decided ?? decodeLoose(splitHrefParts(a.edge.target).pathRaw)
  if (resolvesToTargetText(a, candidate)) {
    return decided
  }
  if (a.insideRoot(a.targetAbs)) {
    return relativePathOf(a.ops, a.docDir, a.targetAbs)
  }
  return absoluteTextOf(a, true)
}

/**
 * 短名 key 的新世界同名候选集（will/did 同一语义）：旧世界候选经 moves
 * 映射后**仅保留 basename 仍等于 key 者**（改名者退出同名集——原短名的
 * 「仍命中」与新短名的「唯一」都按新名字判定），移出应用文档根域者剔除
 * （lookup 域 = 来源最具体根）；并入本批移入根域的同名新路径（will 旧
 * 世界 catalog 看不到它们）。did 阶段端口已是新世界，映射 miss、并入
 * 去重，校正自然 no-op。
 */
function newWorldShortnameCandidates(
  a: EdgeTargetPlanArgs,
  raw: readonly string[],
  key: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (p: string): void => {
    const k = a.fold(a.norm(p))
    if (!seen.has(k)) {
      seen.add(k)
      out.push(a.norm(p))
    }
  }
  for (const c of raw) {
    const moved = a.moveByOld.get(a.fold(a.norm(c)))
    const p = moved !== undefined ? a.norm(moved.newFsPath) : a.norm(c)
    if (a.fold(a.ops.basename(p)) !== a.fold(key)) {
      continue // 改名退出同名集
    }
    if (!a.insideRoot(p)) {
      continue // 移出根域剔除
    }
    push(p)
  }
  for (const move of a.moves) {
    const p = a.norm(move.newFsPath)
    if (a.fold(a.ops.basename(p)) !== a.fold(key)) {
      continue
    }
    if (!a.insideRoot(p)) {
      continue
    }
    push(p)
  }
  return out
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
      // #556 T2 起 resolvedTarget 为规范绝对身份——绝对形态直接归一采用
      // （本票起为语义主域）；根内相对形态（旧快照迁移期/单测 fixture）
      // 仍按 edgeRootFsPath 拼接（兼容两域）
      const resolvedRaw = String(edge.resolvedTarget)
      const targetAbsRaw = ops.isAbsolute(resolvedRaw)
        ? norm(resolvedRaw)
        : ops.resolve(norm(doc.edgeRootFsPath), ...resolvedRaw.split('/'))
      const move = moveByOld.get(fold(targetAbsRaw))
      if (!selfMove && move === undefined) {
        continue
      }
      const targetAbs = move !== undefined ? norm(move.newFsPath) : targetAbsRaw
      if (targetAbs.trim() === '') {
        continue
      }

      // #556 T4：目标文本三形态决策（短名保留/更新 → 相对/绝对）+ 复审 S1
      // 终审回验（决策文本经解析器语义核对命中身份，失败降级显式扩展形态）
      const newTargetText = planEdgeTargetTextVerified({
        ops,
        fold,
        norm,
        isWindowsHost: ctx.isWindowsHost,
        moves: ctx.moves,
        moveByOld,
        lookup: ctx.shortnameLookup,
        targetExists: ctx.targetExists,
        // 评审 F5：根域判定按归属不按几何——目标最具体根 ≠ 应用文档根
        // 即为跨根（嵌套根独立分区：补查域/反链域已随归属转移，几何上
        // 仍在父根域内的相对形态与其短名语义分家）。rootOf 返回 roots
        // 数组原元素，与 docRoot（同款 rootOf 产物）严格相等即同根
        insideRoot: (p) => docRoot !== undefined && rootOf(p) === docRoot,
        docFsPath: doc.fsPath,
        docDir,
        docRoot,
        edge,
        targetAbs,
      })
      if (newTargetText === null) {
        continue // 原短名在新状态仍准确命中：保留原文（零编辑）
      }

      // 区间定位与替换生成
      const s = doc.text.slice(edge.start, edge.end)
      const edit = buildEdit(edge, s, newTargetText, edge.start)
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
      continue // 无可改写边（全部为本文件锚点/断链/短名保留）
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

/**
 * 在区间文本 s（text.slice(start, end)）内定位目标子串并生成替换。
 * 定位失败（形态不符 / 子串与边记录原文不一致）返回 null——文档级 stale。
 *
 * @param baseOffset 区间起点在全文中的偏移
 */
function buildEdit(
  edge: VaultEdge,
  s: string,
  newTargetText: string,
  baseOffset: number,
): RenameTextEdit | null {
  if (edge.kind === 'wikilink') {
    return buildWikilinkEdit(edge, s, newTargetText, baseOffset)
  }
  if (edge.kind === 'embed') {
    // #222 嵌入：`![[` 后路径段替换——与 wikilink 同构（别名/锚点原样）
    return buildEmbedEdit(edge, s, newTargetText, baseOffset)
  }
  return buildHrefEdit(edge, s, newTargetText, baseOffset)
}

/** wikilink：替换 `[[` 后的路径段（首个 `#`/`|` 之前，含首尾空白） */
function buildWikilinkEdit(
  edge: VaultEdge,
  s: string,
  newTargetText: string,
  baseOffset: number,
): RenameTextEdit | null {
  return buildBracketPathEdit(edge, s, newTargetText, baseOffset, 2)
}

/** embed：替换 `![[` 后的路径段（首个 `#`/`|` 之前，含首尾空白）——与
 *  wikilink 同一子串定位语义（#222），仅开标记多一个 `!` 前缀字符 */
function buildEmbedEdit(
  edge: VaultEdge,
  s: string,
  newTargetText: string,
  baseOffset: number,
): RenameTextEdit | null {
  return buildBracketPathEdit(edge, s, newTargetText, baseOffset, 3)
}

/** 双链/嵌入共用：`[[`（或 `![[`，openLen 为开标记长）后路径段替换。
 *  newTargetText 为三形态决策的最终路径文本（短名/相对/绝对）。 */
function buildBracketPathEdit(
  edge: VaultEdge,
  s: string,
  newTargetText: string,
  baseOffset: number,
  openLen: number,
): RenameTextEdit | null {
  const open = openLen === 3 ? '![[' : '[['
  if (!s.startsWith(open) || !s.endsWith(']]')) {
    return null
  }
  const inner = s.slice(openLen, -2)
  const pipeAt = inner.indexOf('|')
  const targetPart = pipeAt >= 0 ? inner.slice(0, pipeAt) : inner
  const hashAt = targetPart.indexOf('#')
  const pathRaw = hashAt >= 0 ? targetPart.slice(0, hashAt) : targetPart
  if (pathRaw.trim() === edge.target) {
    // 双链形态学不做 URL 编码（字面直写）；扩展名省略语义已在决策侧处理
    return {
      start: baseOffset + openLen,
      end: baseOffset + openLen + pathRaw.length,
      replacement: newTargetText,
    }
  }
  // #248 表格格内嵌入（转义管道形态）：首个 `|` 分割把 `\` 留进了路径
  //（`B\|别名` → pathRaw=`B\`），与解码语义的边 target（`B`）不匹配——按
  // 转义管道（`\|`，pipe 前恰一枚未配对反斜杠）分割再定位一次；替换区间
  // 只覆盖路径段（不含 `\|`），别名与锚点原文保真。非表格行的原文字面边
  //（target 含 `\`）已在上方首分割命中，不进入本分支。
  const escapedPipe = inner.indexOf('\\|')
  if (escapedPipe >= 0) {
    const escTargetPart = inner.slice(0, escapedPipe)
    const escHashAt = escTargetPart.indexOf('#')
    const escPathRaw = escHashAt >= 0 ? escTargetPart.slice(0, escHashAt) : escTargetPart
    if (escPathRaw.trim() === edge.target) {
      return {
        start: baseOffset + openLen,
        end: baseOffset + openLen + escPathRaw.length,
        replacement: newTargetText,
      }
    }
  }
  return null
}

/** mdlink/image/refdef：替换 href 的路径部分（保留 query/fragment/标题）。
 *  newTargetText 为三形态决策的最终路径文本；`<>` 尖括号包裹形态替换
 *  整个包裹段——新路径仍含空格时重新包裹（字面风格），否则不再需要包裹 */
function buildHrefEdit(
  edge: VaultEdge,
  s: string,
  newTargetText: string,
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
    ? encodeRelativePath(newTargetText)
    : newTargetText
  const body = `${replacementPath}${suffix}`
  const replacement = angleWrapped && /[ \t]/.test(replacementPath) ? `<${body}>` : body
  return {
    start: baseOffset + destStart,
    end: baseOffset + destEnd,
    replacement,
  }
}

/** rename 引用更新反馈的数据面（通知文案键决策的输入；wiring 的
 *  RenameRefLogEntry 字段子集） */
export interface RenameNoticeInput {
  plannedEdits: number
  skipped: ReadonlyArray<unknown>
  indexNotReady: number
}

/**
 * 通知文案键决策（review-loops #1 下沉纯逻辑）：三态区分——已更新 /
 * 部分更新 / 未更新；未更新再按构成归因——**纯索引未就绪**（无一处
 * 编辑、无越界/漂移跳过）归因 host.renameRefsIndexNotReady（含设置页
 * 重建指引），混合场景（跳过与未就绪并存）沿用全部跳过文案（越界/
 * 已变化语义），不再把纯未就绪误报为「因越界或内容变化被跳过」。
 */
export function renameNoticeKeyOf(log: RenameNoticeInput): string | null {
  if (log.plannedEdits > 0) {
    return log.skipped.length > 0 || log.indexNotReady > 0
      ? 'host.renameRefsPartiallyUpdated'
      : 'host.renameRefsUpdated'
  }
  if (log.skipped.length > 0 || log.indexNotReady > 0) {
    return log.skipped.length === 0 && log.indexNotReady > 0
      ? 'host.renameRefsIndexNotReady'
      : 'host.renameRefsSkippedAll'
  }
  return null
}
