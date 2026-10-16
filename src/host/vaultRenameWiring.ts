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
  type RenameShortnameLookupPort,
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
  /** 跳过项（edge-stale，含 fsPath；#556 T4 起 cross-root 越界改为绝对
   *  路径改写、不再是跳过原因） */
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
  /** will 阶段经 docsByKey 读文本的引用者（面板打开与 URI 大小写漂移窄径
   *  混合、will 时刻原则上全非 dirty——dirty 者已分流 dirtyRefs）。面板
   *  子集只改 buffer 转脏不落盘（覆盖层=buffer 现状，did 收尾按「编辑器
   *  标签仍持有」豁免，见 retireLoadedDocs）；未打开子集自 #556 收口起
   *  采集走直读盘（textOf 不装载模型），will edit 随宿主直接写盘（覆盖层
   *  =盘面，退役即归基线；无 tab 缓存实例的滞留问题随装载消失）。 */
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

/** 文档当前文本：已打开（含未保存 buffer）优先直取；否则**直接读盘**
 *  （fs.readFile 字节级，不装载文档模型）。不得改回 openTextDocument
 *  装载：VSCode bulk edit（will additional edits / did applyEdit）对
 *  「已建模型的文档」只作用 buffer 不落盘（#269 集成实证的语义）——采集
 *  时装载会让对未打开引用者的改写滞留无标签 dirty buffer、磁盘永不变更
 *  （无人保存即改写丢失；#556 收口：跨根用例磁盘断言暴露——同根 #199
 *  系用例读 buffer/面板而恰好通过，掩盖了该缺陷）；不装载模型时 bulk
 *  edit 走文件服务直接写盘（watcher 通道更新索引，不经覆盖层）。
 *  读盘失败返回 null（调用方按 edge-stale 跳过）。 */
async function textOf(
  uri: vscode.Uri,
): Promise<{ host: string; lf: string } | null> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
  if (open) {
    const host = open.getText()
    return { host, lf: normalizeLf(host) }
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const host = Buffer.from(bytes).toString('utf8')
    return { host, lf: normalizeLf(host) }
  } catch {
    return null
  }
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
      vscode.commands.registerCommand('onegayi.vsidian._test.getRenameOverlay', (fsPath: string) =>
        vaultIndex.overlayEdgesOf(fsPath)),
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
  /** #556 收口（跨根 will edit 丢弃）：1.82.3 宿主对「跨 workspace folder
   *  rename」事务里的 additional text edits 静默丢弃（收口对照实验实证：
   *  手工同事务 replace 的 buffer/磁盘双验——同根事务 buffer 生效、跨根
   *  事务的 will additional edit 连 buffer 都不变；独立 applyEdit 的纯
   *  text edits 则跨根同款生效）。批内任一 move 跨根（old/new 最具体
   *  workspace folder 不同，含 new 越出全部根）时整批引用改写不走 will
   *  additional edit，延迟到 did 通道独立 applyEdit（与 dirtyRefs 同通道
   *  同语义——did 时刻 rename 已完成、纯文本 edit 的 buffer 语义可靠）。
   *  代价：混合批（同根+跨根同批）的同根部分失去与 rename 的撤销原子性
   *  （撤销需两步），换跨根改写实际生效——罕见形态，接受并记录 */
  const folderOf = (fsPath: string): string | undefined =>
    vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath))?.uri.toString()
  const batchCrossRoot = moves.some((m) => folderOf(m.newFsPath) !== folderOf(m.oldFsPath))
  /** 引用者文档合并表（键 = fsPath@edgeRoot 归一）：同文档指向批内多个
   *  目标的边并集——一次规划、同文档多目标一次 WorkspaceEdit */
  const docsByKey = new Map<string, RenameDocInput & { hostText: string }>()
  const dirtyRefs: string[] = []
  const outgoingStash: PendingMovedOutgoing[] = []
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
    // 目标所属根（反链按根分区，来源同根）。三类除外：
    // - 本批被移动文件（movedOldKeys）：did 出链通道统一重算，不重复替换
    // - dirty 引用者：will edit 实测会回滚未保存内容（1.86 边界）——延迟
    //   到 did 通道独立 applyEdit 叠加
    // - 跨根批（batchCrossRoot）：宿主丢弃跨根事务的 additional edits——
    //   同样延迟 did 独立 applyEdit（见 batchCrossRoot 注释）
    for (const group of candidates.incoming) {
      if (movedOldKeys.has(normKeyOf(group.fsPath))) {
        continue
      }
      const mergeKey = `${normKeyOf(group.fsPath)}@${normKeyOf(group.edgeRootFsPath)}`
      const merged = docsByKey.get(mergeKey)
      if (merged) {
        merged.edges = [...merged.edges, ...group.edges]
        continue
      }
      const uri = vscode.Uri.file(group.fsPath)
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
      if (batchCrossRoot || openDoc?.isDirty) {
        dirtyRefs.push(normKeyOf(group.fsPath))
        continue
      }
      const text = await textOf(uri)
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
    const plan = planVaultRenameRewrites(
      {
        rootFsPaths,
        isWindowsHost,
        moves,
        shortnameLookup: renameShortnamePortOf(vaultIndex),
        targetExists: await buildRenameTargetExistsPort(vaultIndex, moves, [...docsByKey.keys()]),
      },
      docs,
    )
    for (const docPlan of plan.docs) {
      fillEdit(edit, docPlan, hostTexts)
    }
    log.plannedEdits = plan.docs.reduce((sum, d) => sum + d.edits.length, 0)
    log.plannedFiles = plan.docs.length
    log.skipped.push(...plan.skipped.map((s) => ({ fsPath: s.fsPath, reason: s.reason })))
  }
  // 暂存至 did：rename 实际发生后合并出链与 dirty 引用者部分，统一落日志
  // 与通知（will 后用户取消 rename 时 did 不到来，暂存悬挂由上限淘汰）
  if (log.plannedEdits > 0 || log.skipped.length > 0 || log.indexNotReady > 0 ||
    dirtyRefs.length > 0 || outgoingStash.length > 0) {
    stashBatch(batchKeyOf(files), {
      log: { ...log, moves: rawMoves },
      expandedMoves: moves,
      dirtyRefs,
      outgoing: outgoingStash,
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

  /** did 出链通道触达的文档（did applyEdit 改写它们，收尾退役覆盖层归
   *  基线；dirtyRefs 段的叠加改写是真实未保存内容，不在此列。#556 收口
   *  起文本采集直读盘不装载，此处清单面向 applyEdit 在途装载的残留实例
   *  退役——no-op 亦无害） */
  const didRewrittenDocs: string[] = []
  const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []

  // 索引批量刷新（整批一次）：优先用 will 暂存的展开映射；无暂底时就地
  // 展开（旧路径已消失——isDirectory 双侧探测 + 索引清单兜底）
  let expandedMoves = pending?.expandedMoves
  if (!expandedMoves) {
    const expand = await expandRenameMoves(isWindowsHost, rawMoves, expandPortOf(vaultIndex))
    expandedMoves = expand.moves
  }

  // dirty 引用者的候选与文本采集须先于 refreshRenamedBatch：批末的覆盖层
  // 世界重算（#269 慢时序兜底）会按新世界（旧目标已删）把 dirty 引用者的
  // 边重算成断链——之后再查旧路径 incoming 将失去该来源，叠加改写被静默
  // 跳过（连续 rename 以另一形态回归漏改，集成 #269 第二段钉住）。did 时刻
  // 基于当前 buffer（含未保存内容）采集——常规 applyEdit 对 dirty 文档按
  // buffer 叠加（不回滚未保存内容）；边数据查旧路径桶（引用者基线边按旧
  // 目标聚合，不受本批刷新影响）；整批合并一次规划、一次 applyEdit
  const dirtyDocsByKey = new Map<string, RenameDocInput & { hostText: string }>()
  if (pending && pending.dirtyRefs.length > 0) {
    for (const move of expandedMoves) {
      const candidates = vaultIndex.renameCandidatesOf(move.oldFsPath)
      if (candidates.status !== 'ready') {
        continue
      }
      for (const group of candidates.incoming) {
        if (!pending.dirtyRefs.includes(normKeyOf(group.fsPath))) {
          continue
        }
        const mergeKey = `${normKeyOf(group.fsPath)}@${normKeyOf(group.edgeRootFsPath)}`
        const merged = dirtyDocsByKey.get(mergeKey)
        if (merged) {
          merged.edges = [...merged.edges, ...group.edges]
          continue
        }
        const text = await textOf(vscode.Uri.file(group.fsPath))
        if (text === null) {
          pending.log.skipped.push({ fsPath: group.fsPath, reason: 'edge-stale' })
          continue
        }
        dirtyDocsByKey.set(mergeKey, {
          fsPath: group.fsPath,
          text: text.lf,
          edges: [...group.edges],
          edgeRootFsPath: group.edgeRootFsPath,
          hostText: text.host,
        })
      }
    }
  }

  await vaultIndex.refreshRenamedBatch(expandedMoves)

  if (!pending) {
    // did 保底（will 未观察——激活竞态等）：无法安全规划改写（引用者边与
    // 出链边须取自 rename 前索引），仅完成索引刷新——与「外部工具改名只
    // 更新索引」同语义，不改写、不通知、不落日志
    return
  }
  const log = pending.log

  try {
    // 被移动 Markdown 自身的出链：用 will 暂存的旧目录解析边规划（rename
    // 已完成，新路径存在，applyEdit 安全）；文本取 did 时刻新路径内容（与
    // rename 前一致，窗口内被改则区间验证按 stale 跳过）。整批一次规划、
    // 一次 applyEdit（同文档多目标/多文档同批各一个撤销单元）
    if (pending.outgoing.length > 0) {
      const docs: RenameDocInput[] = []
      const hostTexts = new Map<string, string>()
      for (const item of pending.outgoing) {
        const text = await textOf(vscode.Uri.file(item.newFsPath))
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
        const plan = planVaultRenameRewrites(
          {
            rootFsPaths,
            isWindowsHost,
            moves: expandedMoves,
            shortnameLookup: renameShortnamePortOf(vaultIndex),
            targetExists: await buildRenameTargetExistsPort(vaultIndex, expandedMoves, docs.map((d) => d.fsPath)),
          },
          docs,
        )
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

    // dirty 引用者的延迟改写（候选与文本已先于索引刷新采集，见函数前段；
    // 边记录与采集之间 buffer 再变由区间验证按 stale 跳过；采集→应用的
    // 窗口漂移无防线，属既有接受的风险类——窗口含 refresh 时长）：
    // 整批合并一次规划、一次 applyEdit
    if (dirtyDocsByKey.size > 0) {
      const docs = [...dirtyDocsByKey.values()].map(({ hostText, ...doc }) => {
        void hostText
        return doc
      })
      const hostTexts = new Map<string, string>(
        [...dirtyDocsByKey.values()].map((d) => [d.fsPath, d.hostText]),
      )
      const plan = planVaultRenameRewrites(
        {
          rootFsPaths,
          isWindowsHost,
          moves: expandedMoves,
          shortnameLookup: renameShortnamePortOf(vaultIndex),
          targetExists: await buildRenameTargetExistsPort(vaultIndex, expandedMoves, [...dirtyDocsByKey.keys()]),
        },
        docs,
      )
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

    // 合并反馈（无候选静默；未更新/部分跳过/已更新三态区分 + 未更新项详情）
    log.notice = renameNoticeKeyOf(log)
    if (log.notice !== null || log.plannedEdits > 0) {
      notifyOf(log)
    }
    if (log.plannedEdits > 0 || log.skipped.length > 0 || log.indexNotReady > 0 || log.cancelled) {
      pushRenameLog(log)
    }
  } finally {
    // 覆盖层回收（#256）：本批 will/did 触达并改写的文档（引用者
    // rewrittenDocs + did 出链清单），其文本变更（will edit / did applyEdit，
    // 含宿主 bulk edit 的短暂 dirty 态）已登记覆盖层，而无 tab 的缓存文档
    // 实例没有退场事件（onDidCloseTextDocument 永不触发、惰性重载不广播）
    // ——不退役会永久遮蔽基线（外部还原后反链/rename 候选读到幽灵边）。
    // did 时刻仍被编辑器标签持有者豁免（retireLoadedDocs：活 buffer 的未
    // 保存内容是合法接管）；其余退役即归基线（documentSaved 同款语义）。
    // finally 内执行（#256 review 轮）：通道中途异常（IO/applyEdit 拒绝）
    // 不丢退役。#556 收口起未打开子集采集走直读盘、宿主写盘不建模型，
    // 退役面向面板打开与残留缓存实例
    retireLoadedDocs(vaultIndex, [...pending.rewrittenDocs, ...didRewrittenDocs])
  }
}

/** rename 通道触达文档的索引覆盖层退役（谁改写谁回收，见 textOf 注释）。
 *  豁免（#256 review 轮 + #269）：did 收尾时刻仍被**编辑器标签持有**或仍为
 *  **dirty 缓存实例**的文档不退役——活 buffer 的未保存内容是合法接管
 *  （#199「未保存内容即时反映」），退役会使索引回落旧盘面基线，连续
 *  rename（对新目标再 rename）将静默漏发现该引用者。两类豁免同一原则：
 *  面板引用者经 will 改写只转 buffer 脏不落盘；装载引用者实测同款语义
 *  （#269 集成实证：will edit 只作用 buffer、磁盘保持旧文，dirty buffer 是
 *  改写的唯一载体）。豁免者的退场走正常文档生命周期：面板关闭（provider
 *  onDidClose）→ 保存（documentSaved）→ isDocOpen 兜底（标签关闭后残渣随
 *  重扫退役）。 */
function retireLoadedDocs(vaultIndex: VaultIndexService, fsPaths: readonly string[]): void {
  for (const fsPath of fsPaths) {
    if (isTabHeld(fsPath) || isDirtyCached(fsPath)) {
      continue
    }
    vaultIndex.documentClosed(fsPath)
  }
}

/** did 收尾时刻该文档是否仍为宿主 textDocuments 中的 dirty 缓存实例（无
 *  标签的装载文档经通道改写后即此态——buffer 持改写文而磁盘未落盘）。
 *  与 isTabHeld 同一归一体系（normKeyOf）。 */
function isDirtyCached(fsPath: string): boolean {
  const key = normKeyOf(fsPath)
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isDirty && doc.uri.scheme === 'file' && normKeyOf(doc.uri.fsPath) === key) {
      return true
    }
  }
  return false
}

/** did 收尾时刻该文档是否仍被任一编辑器标签持有（Vsidian 面板、普通文本
 *  编辑器或 diff 视图——用户可见编辑中的活 buffer 都不算通道残渣）；装载
 *  文档无标签，恒不持有。比较用 normKeyOf 归一（Windows 大小写+分隔符，
 *  与清单内路径同一归一体系）。 */
function isTabHeld(fsPath: string): boolean {
  const key = normKeyOf(fsPath)
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as
        | { uri?: vscode.Uri; modified?: vscode.Uri; original?: vscode.Uri }
        | undefined
      const uris = input ? [input.uri, input.modified, input.original] : []
      for (const uri of uris) {
        if (uri && uri.scheme === 'file' && normKeyOf(uri.fsPath) === key) {
          return true
        }
      }
    }
  }
  return false
}

/** #556 T4 短名唯一性端口（R1/R6：与跳转/悬停共用 vaultIndex.shortnameLookup
 *  的 catalog 倒排查询，零 IO）：will 阶段返回旧世界 catalog——规划器按
 *  moves 映射校正为新世界同名集；did 阶段（refreshRenamedBatch 之后）已
 *  是新世界，校正自然 no-op。未就绪返回 null → 不注入短名语义（退相对
 *  路径，不猜目标）。 */
function renameShortnamePortOf(vaultIndex: VaultIndexService): RenameShortnameLookupPort {
  return (sourceFsPath, basename) => vaultIndex.shortnameLookup(sourceFsPath, basename)
}

/** 复审 S1 存在性端口数据面（真实 fs 预取）：规划器的候选序核对与终审
 *  回验需要「第一个存在文件优先」的**真实**裁决——catalog 投影不含未引用
 *  的无扩展遮蔽物（model.files 只有 md 与被引用 asset），只查登记会漏
 *  遮蔽。预取面 = 应用文档目录 ∪ 移动新路径目录（短名候选、降级与兜底
 *  文本的全部落点），readDirectory 一次列齐（will 时刻新路径未落盘——由
 *  moves 集合补；目录尚不存在时列举为空，同样由 moves 补）。只把普通
 *  文件入集（目录不算存在——解析器 exists 端口对非普通文件返回 null 的
 *  同款语义）。catalog 登记仍并入（外部/跨根绝对目标目录不在预取面内，
 *  其存在性由引用登记承载） */
async function buildRenameTargetExistsPort(
  vaultIndex: VaultIndexService,
  moves: ReadonlyArray<{ oldFsPath: string; newFsPath: string }>,
  docFsPaths: readonly string[],
): Promise<(fsPath: string) => boolean> {
  const dirs = new Set<string>()
  for (const m of moves) {
    dirs.add(dirnameOf(m.newFsPath))
  }
  for (const p of docFsPaths) {
    dirs.add(dirnameOf(p))
  }
  const exists = new Set<string>()
  await Promise.all([...dirs].map(async (dir) => {
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir))
      for (const [name, type] of entries) {
        if (type === vscode.FileType.File) {
          exists.add(normKeyOf(`${dir}/${name}`))
        }
      }
    } catch {
      // 目录不存在（will 时刻新目录未建）：该目录的文件由 moves 集合补
    }
  }))
  const newPaths = new Set(moves.map((m) => normKeyOf(m.newFsPath)))
  return (fsPath) =>
    newPaths.has(normKeyOf(fsPath)) || exists.has(normKeyOf(fsPath)) || vaultIndex.catalogHasFile(fsPath)
}

/** 跳过原因的文案键（通知详情用；#556 T4 起仅剩 edge-stale 一种） */
function skipReasonKeyOf(reason: string): string {
  void reason
  return 'host.renameRefsSkipEdgeStale'
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

/** 目录部分（/ 分隔归一形态；根路径退化为自身）——存在性预取的目录集 */
function dirnameOf(fsPath: string): string {
  const norm = normalizeSeparators(fsPath)
  const cut = norm.lastIndexOf('/')
  return cut > 0 ? norm.slice(0, cut) : norm
}

function firstBasenameOf(moves: Array<{ oldFsPath: string }>): string {
  return basenameOf(moves[0]?.oldFsPath ?? '')
}
