// 批量 PDF 导出清单纯逻辑（T04/#624）：收集/去重/增删调序/输出映射与
// 重名三策略/自动更名/结果汇总。
//
// 语义（规格 pdf-export.md §2.2）：
// - 目录递归收集只保留 Markdown（类型判定注入宿主同口径事实源
//   textEditorProvider.isMarkdownFile——.md/.markdown）；非 Markdown 不入清单。
// - 清单顺序即执行顺序（批量逐文件输出；合并 T06 按同序）——不依赖枚举顺序。
// - 批量保留所选目录的相对结构：条目携带来源根与相对路径，目标映射
//   = 目标目录 + 相对路径（扩展名换 .pdf）。
// - 输出路径冲突三策略（跳过/覆盖/自动更名）：先算名义映射，批内同名
//   （多根映射到同一目标）与磁盘已有分别登记，冲突显式呈现（预览表
//   数据源）；不静默覆盖、不无说明丢文件。
// - 冲突判定大小写不敏感：宿主主战场 Windows 文件系统大小写不敏感，
//   仅大小写不同的两条目合并视为同一目标——误判冲突走更名是安全侧
//  （相对静默覆盖）；POSIX 大小写敏感语义不因此放宽覆盖。
//
// 零依赖（webview 与宿主两端共用；路径一律 '/' 分隔的规范形态）。

/** 单文档模式在统一清单中的条目 id（清单只有一行——当前文档；宿主的
 *  preview.select 以此 id 识别「选中当前文档」并加载预览） */
export const PDF_DOCUMENT_LIST_ITEM_ID = 'document'

/** 清单条目：文件身份 + 来源根（相对结构计算的锚） */
export interface PdfBatchItem {
  /** 稳定条目 id（增删调序的锚点；宿主侧自增生成） */
  id: string
  /** 规范绝对身份（'/' 分隔；与 pdfExportPayload docs.fsPath 同形态） */
  fsPath: string
  /** 来源根目录（'/' 分隔；单文件条目 = 其所在目录） */
  rootFsPath: string
  /** 相对来源根的路径（'/' 分隔；单文件条目 = 文件名） */
  relPath: string
}

/** 输出路径冲突的统一策略 */
export type PdfBatchConflictStrategy = 'skip' | 'overwrite' | 'rename'

export const PDF_BATCH_CONFLICT_STRATEGIES: readonly PdfBatchConflictStrategy[] = ['skip', 'overwrite', 'rename']

export function isPdfBatchConflictStrategy(value: unknown): value is PdfBatchConflictStrategy {
  return typeof value === 'string' && (PDF_BATCH_CONFLICT_STRATEGIES as readonly string[]).includes(value)
}

/** 冲突键：小写归一（Windows 文件系统语义） */
const conflictKey = (p: string): string => p.toLowerCase()

/** Markdown 文件判定单一事实源（#38 口径：与 customEditors selector 及
 *  标题栏 when 子句的 resourceExtname 同判——大小写敏感，.md/.markdown）。
 *  批量目录收集与 provider 的 isMarkdownFile 同引此实现（不建第二份）。 */
export function isMarkdownFilePath(fsPath: string): boolean {
  const dot = fsPath.lastIndexOf('.')
  const ext = dot < 0 ? '' : fsPath.slice(dot)
  return ext === '.md' || ext === '.markdown'
}

/** 相对路径 → PDF 目标相对路径（扩展名换 .pdf；无 md 扩展的防御路径直接补） */
function relToPdfRel(relPath: string): string {
  if (/\.md$/i.test(relPath)) return relPath.replace(/\.md$/i, '.pdf')
  if (/\.markdown$/i.test(relPath)) return relPath.replace(/\.markdown$/i, '.pdf')
  return `${relPath}.pdf`
}

/** 自动更名：name.pdf → name (2).pdf → name (3).pdf…（取最小可用编号；
 *  占用判定大小写不敏感——taken 原始键内部归一。调用即更名：调用方只在
 *  需要避开原名时进入，无冲突不动名由调用方判定） */
export function nextAvailableTargetPath(targetPath: string, taken: ReadonlySet<string>): string {
  const keys = new Set([...taken].map(conflictKey))
  const dot = targetPath.lastIndexOf('.')
  const base = dot < 0 ? targetPath : targetPath.slice(0, dot)
  const ext = dot < 0 ? '' : targetPath.slice(dot)
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!keys.has(conflictKey(candidate))) return candidate
  }
}

/**
 * rename 策略的磁盘占用展开（双轴评审 P2-003 复核修复）：占用判定必须覆盖
 * 目录里**实际存在**的同名编号文件，不能按固定编号上限猜候选——固定上限
 * 既可能漏掉 `name (201).pdf`（随后把已占用编号当空闲而覆盖），又会对不
 * 存在的编号发一堆无用 stat。
 *
 * 调用方枚举名义目标的父目录（本机 readDirectory / 执行端同一命令，目录
 * 不存在返回空），本函数把条目名展开成绝对路径占用集。命名序列本身仍由
 * `nextAvailableTargetPath` 负责——「目录里有什么」与「下一个空号」两个
 * 事实源各司其职，不互相猜。
 *
 * 参数 listing 返回目录内条目名（不含分隔符）；带分隔符的异常条目跳过。
 */
export function occupiedTargetsFromListings(
  nominalTargets: readonly string[],
  listing: (dir: string) => readonly string[],
): string[] {
  const dirs = new Set<string>()
  for (const target of nominalTargets) {
    const slash = target.lastIndexOf('/')
    if (slash > 0) dirs.add(target.slice(0, slash))
  }
  const out: string[] = []
  for (const dir of dirs) {
    for (const name of listing(dir)) {
      if (name === '' || name.includes('/') || name.includes('\\')) continue
      out.push(`${dir}/${name}`)
    }
  }
  return out
}

/**
 * 无覆盖提交的碰撞重试（P2-003）：确认映射与真正落位之间目录可能新增同名
 * 文件，自动更名/跳过的最终落位必须再核对一次。调用方把实际撞上的路径并入
 * 占用集后，本函数从**名义路径**重新走同一命名序列取下一候选——不能从已
 * 编号路径继续编号（否则得到 `name (3) (2).pdf`）。
 */
export function nextTargetAfterCollision(
  nominalPath: string,
  attempted: string,
  taken: ReadonlySet<string>,
): string {
  return nextAvailableTargetPath(nominalPath, new Set([...taken, attempted]))
}

/**
 * 目录收集入列：files 为宿主递归枚举出的目录内全部文件（规范 '/' 形态），
 * 只保留 Markdown（注入宿主同口径判定）、按 fsPath 去重（大小写不敏感——
 * 同一文件不重复入列）、计算相对根的 relPath；不在根前缀下的路径防御忽略。
 */
export function addToBatchFromDir(
  items: readonly PdfBatchItem[],
  rootFsPath: string,
  files: readonly string[],
  isMarkdown: (fsPath: string) => boolean,
  nextId: () => string,
): { items: PdfBatchItem[]; added: number } {
  const known = new Set(items.map((i) => conflictKey(i.fsPath)))
  const out = [...items]
  const prefix = rootFsPath.endsWith('/') ? rootFsPath : `${rootFsPath}/`
  let added = 0
  for (const file of files) {
    if (!file.startsWith(prefix)) continue
    if (!isMarkdown(file)) continue
    const key = conflictKey(file)
    if (known.has(key)) continue
    known.add(key)
    out.push({ id: nextId(), fsPath: file, rootFsPath, relPath: file.slice(prefix.length) })
    added++
  }
  return { items: out, added }
}

/** 单文件入列：root = 所在目录、relPath = 文件名（映射到目标根下） */
export function addBatchFiles(
  items: readonly PdfBatchItem[],
  files: readonly string[],
  isMarkdown: (fsPath: string) => boolean,
  nextId: () => string,
): { items: PdfBatchItem[]; added: number } {
  const known = new Set(items.map((i) => conflictKey(i.fsPath)))
  const out = [...items]
  let added = 0
  for (const file of files) {
    if (!isMarkdown(file)) continue
    const key = conflictKey(file)
    if (known.has(key)) continue
    known.add(key)
    const slash = file.lastIndexOf('/')
    out.push({
      id: nextId(),
      fsPath: file,
      rootFsPath: slash < 0 ? '' : file.slice(0, slash),
      relPath: slash < 0 ? file : file.slice(slash + 1),
    })
    added++
  }
  return { items: out, added }
}

/** 删除条目（未知 id 无操作） */
export function removeBatchItem(items: readonly PdfBatchItem[], id: string): PdfBatchItem[] {
  const index = items.findIndex((i) => i.id === id)
  if (index < 0) return [...items]
  return items.filter((i) => i.id !== id)
}

/** 上移/下移（首尾边界与未知 id 无操作）——清单顺序即执行顺序 */
export function moveBatchItem(items: readonly PdfBatchItem[], id: string, direction: 'up' | 'down'): PdfBatchItem[] {
  const index = items.findIndex((i) => i.id === id)
  if (index < 0) return [...items]
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= items.length) return [...items]
  const out = [...items]
  const [entry] = out.splice(index, 1)
  out.splice(swapWith, 0, entry!)
  return out
}

/** 冲突面标注（预览表显示：批内同名 / 目标已有 / 两者） */
export type PdfBatchConflict = 'none' | 'duplicate' | 'exists' | 'both'

/** 映射计划条目（预览表与执行共同消费；执行侧按 action 剔除 skip） */
export interface PdfBatchMappingEntry {
  id: string
  fsPath: string
  /** 计划输出路径（'/' 分隔绝对路径；skip 项也给出拟映射路径便于展示） */
  targetPath: string
  /** rename/skip 策略下的**名义**路径（无编号原始映射）：最终落位发生
   *  碰撞重试时回到它重新走命名序列，不从已编号路径续编。overwrite 策略
   *  下与 targetPath 相同。 */
  nominalPath: string
  action: 'export' | 'skip'
  conflict: PdfBatchConflict
  /** 自动更名过（rename 策略避开冲突） */
  renamed: boolean
  /** 最终落位必须无覆盖（白名单策略：rename/skip）——执行端以排他创建
   *  写入并允许碰撞重试；overwrite 策略是显式覆盖授权，为 false */
  exclusive: boolean
  skipReason?: 'duplicate' | 'exists'
}

/**
 * 输出映射计划：按清单顺序计算每条的目标路径与冲突面。
 * - duplicate 双向标注：名义路径在整批出现多于一次时，**同名两方都标
 *   duplicate**（与顺序无关——预览表上首条也不能看起来安全，覆盖与跳过
 *   的后果由双方共同暴露）；skipReason 仍顺序敏感：首个同名条目只因磁盘
 *   已有而跳过，后到者报 duplicate。
 * - 批内同名（多根映射到同一目标，含仅大小写不同）：skip 保留首个并显式
 *   跳过后到者；overwrite 全部导出到同一路径（按清单顺序后写者生效）；
 *   rename 后到者取编号路径（首条无磁盘冲突不动名）。
 * - 磁盘已有（existingTargets，小写键）：skip 跳过不动已有文件；overwrite
 *   原路径导出（写入侧临时文件 + 原子替换——旧文件在新文件完整写入前不
 *   损毁）；rename 取编号路径。
 * - 每条的最终目标（含 skip 项的拟映射路径）进入占用集合：后续条目与
 *   之前所有条目（无论其 action）的同名都算冲突——文件名撞了就是撞了，
 *   不因前项被跳过而静默放行。
 */
export function planBatchMapping(
  items: readonly PdfBatchItem[],
  targetDir: string,
  strategy: PdfBatchConflictStrategy,
  existingTargets: ReadonlySet<string>,
): PdfBatchMappingEntry[] {
  const dir = targetDir.replace(/\/+$/, '')
  const existing = new Set([...existingTargets].map(conflictKey))
  const taken = new Set(existing)
  // 预扫名义路径计数（duplicate 双向标注数据面）
  const nominalKeys = items.map((item) => conflictKey(`${dir}/${relToPdfRel(item.relPath)}`))
  const counts = new Map<string, number>()
  for (const key of nominalKeys) counts.set(key, (counts.get(key) ?? 0) + 1)
  const seen = new Set<string>()
  const out: PdfBatchMappingEntry[] = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const nominal = `${dir}/${relToPdfRel(item.relPath)}`
    const nominalKey = nominalKeys[index]!
    const isDuplicate = (counts.get(nominalKey) ?? 0) > 1
    const isExists = existing.has(nominalKey)
    const conflict: PdfBatchConflict = isDuplicate && isExists ? 'both' : isDuplicate ? 'duplicate' : isExists ? 'exists' : 'none'
    let entry: PdfBatchMappingEntry
    // skip 触发条件顺序敏感：首个同名条目不被批内同名跳过（它没有
    // 前者——保留首个语义）；只有后到者（seen 命中）或磁盘已有才跳过
    const skipDue = seen.has(nominalKey) || isExists
    if (strategy === 'skip' && skipDue) {
      entry = {
        id: item.id,
        fsPath: item.fsPath,
        targetPath: nominal,
        nominalPath: nominal,
        action: 'skip',
        conflict,
        renamed: false,
        exclusive: false,
        skipReason: seen.has(nominalKey) ? 'duplicate' : 'exists',
      }
    } else if (strategy === 'overwrite') {
      entry = {
        id: item.id,
        fsPath: item.fsPath,
        targetPath: nominal,
        nominalPath: nominal,
        action: 'export',
        conflict,
        renamed: false,
        exclusive: false,
      }
    } else {
      // rename：动名看**实际占用**（此前条目最终目标或磁盘已有命中名义
      // 路径），不看标注面——首个同名条目无磁盘冲突时不动名，后到者取
      // 编号路径；conflict 标注仍如实呈现。落位一律无覆盖（exclusive），
      // 确认到写盘之间新增的同名文件由执行层碰撞重试避开。
      const occupied = taken.has(nominalKey)
      const finalPath = occupied ? nextAvailableTargetPath(nominal, taken) : nominal
      entry = {
        id: item.id,
        fsPath: item.fsPath,
        targetPath: finalPath,
        nominalPath: nominal,
        action: 'export',
        conflict,
        renamed: finalPath !== nominal,
        exclusive: true,
      }
    }
    taken.add(conflictKey(entry.targetPath))
    seen.add(nominalKey)
    out.push(entry)
  }
  return out
}

/** 单项结果（结束汇总的数据面；机器原因码经 i18n 词条映射，不进用户文案直读） */
export interface PdfBatchResultEntry {
  id: string
  fsPath: string
  docName: string
  status: 'success' | 'failed' | 'skipped' | 'cancelled'
  /** 真实输出路径（success 必有） */
  targetPath?: string
  /** 失败分态（复用单文档 fail 词条 + capture-failed 批量扩展） */
  failReason?: string
  skipReason?: 'duplicate' | 'exists'
}

export interface PdfBatchSummary {
  total: number
  success: number
  failed: number
  skipped: number
  cancelled: number
}

/** 结束汇总聚合（结果表头计数——不伪称整批成功） */
export function summarizeBatchResults(results: readonly PdfBatchResultEntry[]): PdfBatchSummary {
  const summary: PdfBatchSummary = { total: results.length, success: 0, failed: 0, skipped: 0, cancelled: 0 }
  for (const entry of results) {
    summary[entry.status]++
  }
  return summary
}

/** 结果轮归并（双轴评审 P3，规格 §2.5「失败项可据清单重新发起」）：单项
 *  重试轮（单项计划）与整批轮共用一张结果表——同 id 原位替换（重试后
 *  状态如实更新，不丢既有成功/跳过记录），新 id 追加。纯函数，两侧同源。 */
export function mergeBatchResults(
  aggregate: readonly PdfBatchResultEntry[],
  latest: readonly PdfBatchResultEntry[],
): PdfBatchResultEntry[] {
  const latestById = new Map(latest.map((entry) => [entry.id, entry]))
  const known = new Set(aggregate.map((entry) => entry.id))
  return [
    ...aggregate.map((entry) => latestById.get(entry.id) ?? entry),
    ...latest.filter((entry) => !known.has(entry.id)),
  ]
}
