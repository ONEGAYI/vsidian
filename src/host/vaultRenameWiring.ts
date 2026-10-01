// 文件/目录更名与移动的引用自动更新装配（#199 单文件双通道，#200 目录
// 与批量扩展），父规格 #194「引用自动更新」节：onWillRenameFiles +
// onDidRenameFiles 双通道，整批一次规划。
//
// 通道语义（1.86 真实宿主实测落档，见 docs/specs/vault-index-backlinks.md
// 的「#199 实施落档」节）：
// - will 事件在 rename 执行**前**分发（文件仍在旧路径）；waitUntil 必须
//   在事件分发期间同步调用（类型注释明言异步调用会 throw），resolve 的
//   WorkspaceEdit 由宿主与 rename 合并应用、同一撤销单元
// - **will edit 只含引用者文档（非 rename 参与文件）的改写**：实测 1.86
//   的 will edit 对 newUri（rename 参与文件）的 text edit 不被支持——edit
//   先于 rename 应用，目标不存在导致整笔 edit 连同 rename 被拒
//   （applyEdit 仍返回 true）；官方 TS 扩展的 import 改写也只改其他文件。
//   目录 rename 的参与文件按宿主视角是**目录**——展开后的目录内文件是否
//   属「参与文件」未经宿主文档承诺，保守起见目录内被移动文档一律走 did
//   通道（与 #199 被移动文档自身出链同一通道语义）
// - 被移动 Markdown 自身的出链改写在 **did 通道**（rename 完成后文件已在
//   新路径）以独立 applyEdit 应用：仍走文本管线（可撤销、面板广播），
//   但与 rename 不同撤销单元（两步撤销）——如实边界，不承诺全链一步撤销
// - 资源管理器/命令面板 rename、move 与 workspace.applyEdit(renameFile)
//   都触发 will+did；workspace.fs.rename 与外部工具改名**不触发**（后者
//   只经 watcher 走增量维护，不改写引用——「不猜测旧新身份」）
// - 反馈通知在 did 阶段合并发出（引用者 + 出链 + dirty 三部分都已应用/
//   落定，计数才完全真实）；will 阶段用户取消（token）不生成计划
//
// #200 批量语义：
// - 目录 rename/move 的 event.files 只给目录级 old→new——经
//   expandRenameMoves（fs 递归列举 .md ∪ 索引清单）展开为逐文件映射，
//   整批**一次** planVaultRenameRewrites（映射表统一，不逐条重复替换）
// - 同一引用者指向批内多个目标：边并集合并为单文档输入（一次规划、同
//   文档多目标一次 WorkspaceEdit）
// - 批次配对：will 暂存以「原始 event.files 排序序列化」为键，did 按同键
//   取回（目录展开形态不进键——will/did 的原始映射恒一致）；did 无暂存
//   （激活竞态等 will 未观察）时只做索引保底刷新，不改写不通知（与外部
//   工具改名同语义）
//
// 文本获取：已打开文档优先（TextDocument.getText 含未保存内容——区间
// 验证与替换对齐当前文本，漂移即文档级跳过）；未打开文档 openTextDocument
// 只装载不显示。LF 偏移计划经 lfOffsetToLineCol 转宿主 Position。
import * as vscode from 'vscode'
import { t } from '../shared/i18n'
import {
  expandRenameMoves,
  lfOffsetToLineCol,
  planVaultRenameRewrites,
  renameNoticeKeyOf,
  type RenameDocInput,
  type RenameMoveEntry,
} from '../shared/vaultRename'
import { normalizeSeparators, type VaultIndexService } from './vaultIndexService'
import type { VaultEdge } from '../shared/vaultIndexModel'

/** 计划结果观测（集成测试钩子；通知文案的数据面） */
export interface RenameRefLogEntry {
  /** 本批移动的**原始**事件映射（目录级条目原样保留；file→file 形态） */
  moves: Array<{ oldFsPath: string; newFsPath: string }>
  /** #200 展开后的逐文件映射条数（目录展开后 ≥ moves.length） */
  expandedMoves: number
  /** 已应用改写处数与文件数（引用者随 rename 原子应用；被移动文档出链
   *  在 did 后独立应用） */
  plannedEdits: number
  plannedFiles: number
  /** 跳过项（cross-root / edge-stale，含 fsPath） */
  skipped: Array<{ fsPath: string; reason: string }>
  /** 索引未就绪而被整体放弃的移动数（目录按目录计、文件按条计） */
  indexNotReady: number
  /** 用户取消（token）导致未规划 */
  cancelled: boolean
  /** 发出的通知文案键（null=静默：无候选不打扰） */
  notice: string | null
}

const RENAME_LOG_LIMIT = 8
const renameLog: RenameRefLogEntry[] = []

/** 测试钩子观测口（VSIDIAN_TEST_HOOKS 门控的命令用） */
export function getRenameRefLog(): readonly RenameRefLogEntry[] {
  return [...renameLog]
}

function pushRenameLog(entry: RenameRefLogEntry): void {
  renameLog.push(entry)
  if (renameLog.length > RENAME_LOG_LIMIT) {
    renameLog.splice(0, renameLog.length - RENAME_LOG_LIMIT)
  }
}

/** will 阶段截取的被移动文档出链暂存（did 阶段应用）。**必须来自 rename
 *  前的索引**：链接文本按旧目录书写，其解析关系（resolvedTarget 的绝对
 *  定位）只在旧目录视角下成立——did 后的重扫按新目录解析旧文本会把全部
 *  出链判成断链，不能作为改写依据。 */
interface PendingMovedOutgoing {
  newFsPath: string
  edges: readonly VaultEdge[]
  edgeRootFsPath: string
}

/** will 阶段的整批暂存（did 阶段按批次键取回，合并出链与 dirty 引用者
 *  部分后统一落日志与通知）。 */
interface PendingRenameBatch {
  log: RenameRefLogEntry
  /** 展开后的逐文件映射（did 索引刷新输入） */
  expandedMoves: RenameMoveEntry[]
  /** dirty 引用者（fsPath 归一键）：will edit 实测会回滚其未保存内容
   *  （1.86 边界，见模块头），改写延迟到 did 通道独立 applyEdit */
  dirtyRefs: string[]
  /** 被移动文档出链（did 阶段按新路径文本统一规划） */
  outgoing: PendingMovedOutgoing[]
  /** will 阶段装载取文本的文档（did 收尾退役覆盖层，见 textOf） */
  loadedDocs: string[]
  /** will 阶段经 docsByKey 读文本的引用者（open 装载混合、全非 dirty——
   *  dirty 者已分流 dirtyRefs）。will edit 改写后其覆盖层=改写后文本=盘面
   *  （宿主随 rename 保存），did 收尾退役归基线（#256：无 tab 的缓存实例
   *  惰性重载不广播事件、onDidClose 不触发，覆盖层无退场路径） */
  rewrittenDocs: string[]
}
const pendingBatches = new Map<string, PendingRenameBatch>()
const PENDING_BATCH_LIMIT = 8

function stashBatch(key: string, batch: PendingRenameBatch): void {
  pendingBatches.set(key, batch)
  while (pendingBatches.size > PENDING_BATCH_LIMIT) {
    const oldest = pendingBatches.keys().next().value
    if (oldest === undefined) {
      break
    }
    pendingBatches.delete(oldest)
  }
}

/** 批次键：原始 event.files 排序序列化（will/did 的原始映射恒一致；展开
 *  形态不进键——did 保底时展开产物可能与 will 阶段不同） */
function batchKeyOf(files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>): string {
  return files
    .map((f) => `${normKeyOf(f.oldUri.fsPath)}=>${normKeyOf(f.newUri.fsPath)}`)
    .sort()
    .join('|')
}

/** LF 归一（宿主文本 → 计划坐标系；与索引边表契约一致） */
function normalizeLf(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

/** 文档当前文本：已打开优先（含未保存内容），否则装载磁盘文本。
 *  装载态文档（openTextDocument 只装载不显示）经 loadedDocs 登记——它没有
 *  编辑器标签，后续 will/did 的 applyEdit 改写会经 onDidChangeTextDocument
 *  登记索引覆盖层，而 onDidCloseTextDocument 对装载文档永不触发（无标签
 *  可关），覆盖层边会永久滞留遮蔽基线（#256 幽灵反链）——did 收尾按清单
 *  统一退役（谁装载谁回收）。 */
async function textOf(
  uri: vscode.Uri,
  loadedDocs?: string[],
): Promise<{ host: string; lf: string } | null> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
  let doc = open ?? null
  if (!doc) {
    try {
      doc = await vscode.workspace.openTextDocument(uri)
    } catch {
      return null
    }
    loadedDocs?.push(doc.uri.fsPath)
  }
  const host = doc.getText()
  return { host, lf: normalizeLf(host) }
}

/** 把计划文档的 edits 填入 WorkspaceEdit（LF 偏移 → 宿主 Position） */
function fillEdit(
  edit: vscode.WorkspaceEdit,
  docPlan: { fsPath: string; edits: readonly { start: number; end: number; replacement: string }[] },
  hostTexts: ReadonlyMap<string, string>,
): void {
  const uri = vscode.Uri.file(docPlan.fsPath)
  const host = hostTexts.get(docPlan.fsPath) ?? ''
  for (const e of docPlan.edits) {
    const from = lfOffsetToLineCol(host, e.start)
    const to = lfOffsetToLineCol(host, e.end)
    edit.replace(uri, new vscode.Range(from.line, from.character, to.line, to.character), e.replacement)
  }
}

/** 展开端口（will 与 did 保底共用）：stat 判目录、递归列举（排除子树
 *  剪枝）、索引清单 */
function expandPortOf(vaultIndex: VaultIndexService): {
  isDirectory(fsPath: string): Promise<boolean>
  listFilesUnder(dirFsPath: string): Promise<string[]>
  indexedFilesUnder(dirFsPath: string): string[] | null
} {
  return {
    async isDirectory(fsPath: string) {
      try {
        const st = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
        return st.type === vscode.FileType.Directory
      } catch {
        return false
      }
    },
    async listFilesUnder(dirFsPath: string) {
      // 递归列举（每层让出一次——大目录不饿死 will 事件等待）；整体排除
      // 的子树（.git/node_modules 等）按服务判定剪枝不进入
      const out: string[] = []
      const walk = async (dir: vscode.Uri): Promise<void> => {
        let entries: [string, vscode.FileType][]
        try {
          entries = await vscode.workspace.fs.readDirectory(dir)
        } catch {
          return
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
        for (const [name, type] of entries) {
          const child = vscode.Uri.joinPath(dir, name)
          if (type === vscode.FileType.Directory) {
            if (vaultIndex.isExcludedDirDeep(child.fsPath)) {
              continue
            }
            await walk(child)
          } else if (type === vscode.FileType.File) {
            out.push(child.fsPath)
          }
        }
      }
      await walk(vscode.Uri.file(dirFsPath))
      return out
    },
    indexedFilesUnder(dirFsPath: string) {
      return vaultIndex.indexedFilesUnder(dirFsPath)
    },
  }
}

/**
 * 装配 rename 引用更新（extension.ts 调用）：返回订阅，调用方并入
 * context.subscriptions。无索引服务时不装配（无工作区即无引用域）。
 */
export function installRenameRefUpdater(
  vaultIndex: VaultIndexService,
  isWindowsHost: boolean,
): vscode.Disposable[] {
  const willSub = vscode.workspace.onWillRenameFiles((event) => {
    // waitUntil 必须在事件分发期间同步调用——thenable 内部异步生成计划
    event.waitUntil(buildWillRenameEdit(vaultIndex, isWindowsHost, event.files, event.token))
  })
  const didSub = vscode.workspace.onDidRenameFiles((event) => {
    void applyAfterRenameBatch(vaultIndex, isWindowsHost, event.files)
  })
  const subs = [willSub, didSub]
  if (process.env.VSIDIAN_TEST_HOOKS === '1') {
    subs.push(
      vscode.commands.registerCommand('onegayi.vsidian._test.getRenameRefLog', () => getRenameRefLog()),
      vscode.commands.registerCommand('onegayi.vsidian._test.getRenameCandidates', (fsPath: string) => {
        const c = vaultIndex.renameCandidatesOf(fsPath)
        return {
          status: c.status,
          incomingFsPaths: c.incoming.map((g) => g.fsPath),
        }
      }),
    )
  }
  return subs
}

/** will 通道主体：目录/批量映射展开 → 纯外部引用者（非本批被移动文件）
 *  的改写计划 → WorkspaceEdit（随 rename 原子应用、同一撤销单元）。任何
 *  失败路径都 resolve 空 edit（rename 本身不被阻断——规格不承诺拦截原生
 *  更名）。 */
async function buildWillRenameEdit(
  vaultIndex: VaultIndexService,
  isWindowsHost: boolean,
  files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>,
  token: vscode.CancellationToken,
): Promise<vscode.WorkspaceEdit> {
  const edit = new vscode.WorkspaceEdit()
  const rawMoves = files.map((f) => ({ oldFsPath: f.oldUri.fsPath, newFsPath: f.newUri.fsPath }))
  const log: RenameRefLogEntry = {
    moves: rawMoves,
    expandedMoves: 0,
    plannedEdits: 0,
    plannedFiles: 0,
    skipped: [],
    indexNotReady: 0,
    cancelled: false,
    notice: null,
  }
  if (token.isCancellationRequested) {
    log.cancelled = true
    return edit
  }

  // ---- 映射展开（目录条目 → 逐文件；索引未就绪的目录整体放弃计数） ----
  const expand = await expandRenameMoves(isWindowsHost, rawMoves, expandPortOf(vaultIndex))
  log.indexNotReady += expand.notReadyMoves
  const moves = expand.moves
  log.expandedMoves = moves.length
  /** 本批被移动文件集合（fold 归一）：其链接改写统一由 did 出链通道负责
   *  （被移动文档按新目录重算出链已涵盖指向同批目标的边——避免重复替换，
   *  也不对 rename 参与文件发 will edit） */
  const movedOldKeys = new Set(moves.map((m) => normKeyOf(m.oldFsPath)))

  const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []
  /** 引用者文档合并表（键 = fsPath@edgeRoot 归一）：同文档指向批内多个
   *  目标的边并集——一次规划、同文档多目标一次 WorkspaceEdit */
  const docsByKey = new Map<string, RenameDocInput & { hostText: string }>()
  const dirtyRefs: string[] = []
  const outgoingStash: PendingMovedOutgoing[] = []
  const loadedDocs: string[] = []
  const rewrittenDocs: string[] = []
  let hasCandidates = false

  for (const move of moves) {
    if (token.isCancellationRequested) {
      log.cancelled = true
      return edit
    }
    const candidates = vaultIndex.renameCandidatesOf(move.oldFsPath)
    if (candidates.status === 'not-ready') {
      // 索引未就绪：本文件不参与改写（不静默部分更新），did 阶段反馈说明
      log.indexNotReady += 1
      continue
    }
    if (candidates.status === 'outside') {
      continue // 工作区外目标不在引用域
    }
    const hasOutgoing = candidates.outgoing.some(
      (e) => e.resolvedTarget !== null && e.target.trim() !== '',
    )
    if (hasOutgoing) {
      // 被移动文档出链：暂存 rename 前的索引边（旧目录解析关系），did 应用
      outgoingStash.push({
        newFsPath: move.newFsPath,
        edges: candidates.outgoing,
        edgeRootFsPath: candidates.rootFsPath!,
      })
    }
    if (candidates.incoming.length === 0 && !hasOutgoing) {
      continue // 无引用者且无出链：静默
    }
    hasCandidates = true
    // 引用者：原路径应用（rename 非参与文件，will edit 实测支持），边根 =
    // 目标所属根（反链按根分区，来源同根）。两类除外：
    // - 本批被移动文件（movedOldKeys）：did 出链通道统一重算，不重复替换
    // - dirty 引用者：will edit 实测会回滚未保存内容（1.86 边界）——延迟
    //   到 did 通道独立 applyEdit 叠加
    for (const group of candidates.incoming) {
      if (movedOldKeys.has(normKeyOf(group.fsPath))) {
        continue
      }
      const mergeKey = `${normKeyOf(group.fsPath)}@${normKeyOf(candidates.rootFsPath!)}`
      const merged = docsByKey.get(mergeKey)
      if (merged) {
        merged.edges = [...merged.edges, ...group.edges]
        continue
      }
      const uri = vscode.Uri.file(group.fsPath)
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
      if (openDoc?.isDirty) {
        dirtyRefs.push(normKeyOf(group.fsPath))
        continue
      }
      const text = await textOf(uri, loadedDocs)
      if (text === null) {
        log.skipped.push({ fsPath: group.fsPath, reason: 'edge-stale' })
        continue
      }
      docsByKey.set(mergeKey, {
        fsPath: group.fsPath,
        text: text.lf,
        edges: [...group.edges],
        edgeRootFsPath: candidates.rootFsPath!,
        hostText: text.host,
      })
      rewrittenDocs.push(group.fsPath)
    }
  }

  if (hasCandidates && docsByKey.size > 0) {
    const docs = [...docsByKey.values()].map(({ hostText, ...doc }) => {
      void hostText
      return doc
    })
    const hostTexts = new Map<string, string>(
      [...docsByKey.values()].map((d) => [d.fsPath, d.hostText]),
    )
    const plan = planVaultRenameRewrites({ rootFsPaths, isWindowsHost, moves }, docs)
    for (const docPlan of plan.docs) {
      fillEdit(edit, docPlan, hostTexts)
    }
    log.plannedEdits = plan.docs.reduce((sum, d) => sum + d.edits.length, 0)
    log.plannedFiles = plan.docs.length
    log.skipped.push(...plan.skipped.map((s) => ({ fsPath: s.fsPath, reason: s.reason })))
  }
  // 暂存至 did：rename 实际发生后合并出链与 dirty 引用者部分，统一落日志
  // 与通知（will 后用户取消 rename 时 did 不到来，暂存悬挂由上限淘汰）。
  // loadedDocs 计入暂存条件：装载清单须随批次到 did 才能退役覆盖层
  if (log.plannedEdits > 0 || log.skipped.length > 0 || log.indexNotReady > 0 ||
    dirtyRefs.length > 0 || outgoingStash.length > 0 || loadedDocs.length > 0) {
    stashBatch(batchKeyOf(files), {
      log: { ...log, moves: rawMoves },
      expandedMoves: moves,
      dirtyRefs,
      outgoing: outgoingStash,
      loadedDocs,
      rewrittenDocs,
    })
  }
  return edit
}

/**
 * did 通道主体（rename 已完成，整批一次）：索引批量刷新 → 被移动 Markdown
 * 自身的出链改写（新路径已存在，独立 applyEdit 安全，一批一次）→ dirty
 * 引用者叠加改写（一批一次）→ 合并 will 暂存反馈统一通知。
 */
async function applyAfterRenameBatch(
  vaultIndex: VaultIndexService,
  isWindowsHost: boolean,
  files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>,
): Promise<void> {
  const rawMoves = files.map((f) => ({ oldFsPath: f.oldUri.fsPath, newFsPath: f.newUri.fsPath }))
  const key = batchKeyOf(files)
  const pending = pendingBatches.get(key)
  pendingBatches.delete(key)
  const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []

  // 索引批量刷新（整批一次）：优先用 will 暂存的展开映射；无暂底时就地
  // 展开（旧路径已消失——isDirectory 双侧探测 + 索引清单兜底）
  let expandedMoves = pending?.expandedMoves
  if (!expandedMoves) {
    const expand = await expandRenameMoves(isWindowsHost, rawMoves, expandPortOf(vaultIndex))
    expandedMoves = expand.moves
  }
  await vaultIndex.refreshRenamedBatch(expandedMoves)

  if (!pending) {
    // did 保底（will 未观察——激活竞态等）：无法安全规划改写（引用者边与
    // 出链边须取自 rename 前索引），仅完成索引刷新——与「外部工具改名只
    // 更新索引」同语义，不改写、不通知、不落日志
    return
  }
  const log = pending.log
  const dirtyRefs = pending.dirtyRefs
  /** did 出链通道触达的文档（open 装载混合——did applyEdit 改写它们，收尾
   *  退役覆盖层归基线；dirtyRefs 段的叠加改写是真实未保存内容，不在此列） */
  const didRewrittenDocs: string[] = []

  // 被移动 Markdown 自身的出链：用 will 暂存的旧目录解析边规划（rename
  // 已完成，新路径存在，applyEdit 安全）；文本取 did 时刻新路径内容（与
  // rename 前一致，窗口内被改则区间验证按 stale 跳过）。整批一次规划、
  // 一次 applyEdit（同文档多目标/多文档同批各一个撤销单元）
  if (pending.outgoing.length > 0) {
    const docs: RenameDocInput[] = []
    const hostTexts = new Map<string, string>()
    for (const item of pending.outgoing) {
      const text = await textOf(vscode.Uri.file(item.newFsPath), didRewrittenDocs)
      if (text === null) {
        log.skipped.push({ fsPath: item.newFsPath, reason: 'edge-stale' })
        continue
      }
      docs.push({
        fsPath: item.newFsPath,
        text: text.lf,
        edges: item.edges,
        edgeRootFsPath: item.edgeRootFsPath,
      })
      hostTexts.set(item.newFsPath, text.host)
      didRewrittenDocs.push(item.newFsPath)
    }
    if (docs.length > 0) {
      const plan = planVaultRenameRewrites({ rootFsPaths, isWindowsHost, moves: expandedMoves }, docs)
      if (plan.docs.length > 0) {
        const edit = new vscode.WorkspaceEdit()
        for (const docPlan of plan.docs) {
          fillEdit(edit, docPlan, hostTexts)
        }
        const applied = await vscode.workspace.applyEdit(edit)
        if (applied) {
          log.plannedEdits += plan.docs.reduce((sum, d) => sum + d.edits.length, 0)
          log.plannedFiles += plan.docs.length
        }
      }
      log.skipped.push(...plan.skipped.map((s) => ({ fsPath: s.fsPath, reason: s.reason })))
    }
  }

  // dirty 引用者的延迟改写：did 时刻基于当前 buffer（含未保存内容）重新
  // 规划——常规 applyEdit 对 dirty 文档按 buffer 叠加（不回滚未保存内容）。
  // 边数据查旧路径桶（refreshRenamedBatch 移除的是被移动文件自身条目，
  // 引用者边仍按旧目标聚合可查）；整批合并一次规划、一次 applyEdit
  if (dirtyRefs.length > 0) {
    const docsByKey = new Map<string, RenameDocInput & { hostText: string }>()
    for (const move of expandedMoves) {
      const candidates = vaultIndex.renameCandidatesOf(move.oldFsPath)
      if (candidates.status !== 'ready') {
        continue
      }
      for (const group of candidates.incoming) {
        if (!dirtyRefs.includes(normKeyOf(group.fsPath))) {
          continue
        }
        const mergeKey = `${normKeyOf(group.fsPath)}@${normKeyOf(candidates.rootFsPath!)}`
        const merged = docsByKey.get(mergeKey)
        if (merged) {
          merged.edges = [...merged.edges, ...group.edges]
          continue
        }
        const text = await textOf(vscode.Uri.file(group.fsPath))
        if (text === null) {
          log.skipped.push({ fsPath: group.fsPath, reason: 'edge-stale' })
          continue
        }
        docsByKey.set(mergeKey, {
          fsPath: group.fsPath,
          text: text.lf,
          edges: [...group.edges],
          edgeRootFsPath: candidates.rootFsPath!,
          hostText: text.host,
        })
      }
    }
    if (docsByKey.size > 0) {
      const docs = [...docsByKey.values()].map(({ hostText, ...doc }) => {
        void hostText
        return doc
      })
      const hostTexts = new Map<string, string>(
        [...docsByKey.values()].map((d) => [d.fsPath, d.hostText]),
      )
      const plan = planVaultRenameRewrites({ rootFsPaths, isWindowsHost, moves: expandedMoves }, docs)
      if (plan.docs.length > 0) {
        const dirtyEdit = new vscode.WorkspaceEdit()
        for (const docPlan of plan.docs) {
          fillEdit(dirtyEdit, docPlan, hostTexts)
        }
        const applied = await vscode.workspace.applyEdit(dirtyEdit)
        if (applied) {
          log.plannedEdits += plan.docs.reduce((sum, d) => sum + d.edits.length, 0)
          log.plannedFiles += plan.docs.length
        }
      }
      log.skipped.push(...plan.skipped.map((s) => ({ fsPath: s.fsPath, reason: s.reason })))
    }
  }

  // 合并反馈（无候选静默；未更新/部分跳过/已更新三态区分 + 未更新项详情）
  log.notice = renameNoticeKeyOf(log)
  if (log.notice !== null || log.plannedEdits > 0) {
    notifyOf(log)
  }
  if (log.plannedEdits > 0 || log.skipped.length > 0 || log.indexNotReady > 0 || log.cancelled) {
    pushRenameLog(log)
  }
  // 覆盖层回收（#256）：本批 will/did 触达并改写的文档（装载清单 + 引用者
  // rewrittenDocs + did 出链清单——全非 dirty，dirty 者走 dirtyRefs 其覆盖层
  // 是真实未保存内容），其文本变更（will edit / did applyEdit，含宿主 bulk
  // edit 的短暂 dirty 态）已登记覆盖层，而无 tab 的缓存文档实例没有退场事件
  // （onDidCloseTextDocument 永不触发、惰性重载不广播）——不退役会永久遮蔽
  // 基线（外部还原后反链/rename 候选读到幽灵边）。此时退役无损：非 dirty
  // 文档的覆盖层退役即归基线（documentSaved 同款语义）
  retireLoadedDocs(vaultIndex, [...pending.loadedDocs, ...pending.rewrittenDocs, ...didRewrittenDocs])
}

/** rename 通道触达文档的索引覆盖层退役（谁改写谁回收，见 textOf 注释） */
function retireLoadedDocs(vaultIndex: VaultIndexService, fsPaths: readonly string[]): void {
  for (const fsPath of fsPaths) {
    vaultIndex.documentClosed(fsPath)
  }
}

/** 跳过原因的文案键（通知详情用） */
function skipReasonKeyOf(reason: string): string {
  return reason === 'cross-root' ? 'host.renameRefsSkipCrossRoot' : 'host.renameRefsSkipEdgeStale'
}

function notifyOf(log: RenameRefLogEntry): void {
  const key = log.notice
  if (key === null) {
    return
  }
  let message = t(key, {
    file: firstBasenameOf(log.moves),
    count: String(log.plannedEdits),
    files: String(log.plannedFiles),
    skipped: String(log.skipped.length + log.indexNotReady),
  })
  // 未更新项与原因（用户可查；cap 3 防通知过长，余量以总数概括）。
  // 条目与余量形态走词条（review-loops #3：全角括号/省略号不留在源码字面量）
  if (key !== 'host.renameRefsUpdated' && log.skipped.length > 0) {
    const items = log.skipped
      .slice(0, 3)
      .map((s) => t('host.renameRefsSkipItem', {
        file: basenameOf(s.fsPath),
        reason: t(skipReasonKeyOf(s.reason)),
      }))
      .join('、')
    const suffix = log.skipped.length > 3
      ? t('host.renameRefsSkipMore', { count: String(log.skipped.length) })
      : ''
    message += `\n${t('host.renameRefsSkippedDetail', { items: `${items}${suffix}` })}`
  }
  if (key === 'host.renameRefsUpdated') {
    void vscode.window.showInformationMessage(message)
  } else {
    void vscode.window.showWarningMessage(message)
  }
}

/** 路径归一键（批次配对与合并表；Windows 折叠 + 分隔符统一——折叠为
 *  本模块语义，与索引服务的 foldKey 分立，不并入共享步） */
function normKeyOf(fsPath: string): string {
  const norm = normalizeSeparators(fsPath)
  return process.platform === 'win32' ? norm.toLowerCase() : norm
}

function basenameOf(fsPath: string): string {
  const norm = normalizeSeparators(fsPath)
  return norm.slice(norm.lastIndexOf('/') + 1)
}

function firstBasenameOf(moves: Array<{ oldFsPath: string }>): string {
  return basenameOf(moves[0]?.oldFsPath ?? '')
}
