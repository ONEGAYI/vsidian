// 单文件更名/移动的引用自动更新装配（工单 #199，父规格 #194「引用自动
// 更新」节）：onWillRenameFiles + onDidRenameFiles 双通道。
//
// 通道语义（1.86 真实宿主实测落档，见 docs/specs/vault-index-backlinks.md
// 的「#199 实施落档」节）：
// - will 事件在 rename 执行**前**分发（文件仍在旧路径）；waitUntil 必须
//   在事件分发期间同步调用（类型注释明言异步调用会 throw），resolve 的
//   WorkspaceEdit 由宿主与 rename 合并应用、同一撤销单元
// - **will edit 只含引用者文档（非 rename 参与文件）的改写**：实测 1.86
//   的 will edit 对 newUri（rename 参与文件）的 text edit 不被支持——edit
//   先于 rename 应用，目标文件不存在导致整笔 edit 连同 rename 被拒
//   （applyEdit 仍返回 true）；官方 TS 扩展的 import 改写也只改其他文件
// - 被移动 Markdown 自身的出链改写在 **did 通道**（rename 完成后文件已在
//   新路径）以独立 applyEdit 应用：仍走文本管线（可撤销、面板广播），
//   但与 rename 不同撤销单元（两步撤销）——如实边界，不承诺全链一步撤销
// - 资源管理器/命令面板 rename、move 与 workspace.applyEdit(renameFile)
//   都触发 will+did；workspace.fs.rename 与外部工具改名**不触发**（后者
//   只经 watcher 走增量维护，不改写引用——「不猜测旧新身份」）
// - 反馈通知在 did 阶段合并发出（引用者 + 出链两部分都已应用/落定，计数
//   才完全真实）；will 阶段用户取消（token）不生成计划
//
// 文本获取：已打开文档优先（TextDocument.getText 含未保存内容——区间
// 验证与替换对齐当前文本，漂移即文档级跳过）；未打开文档 openTextDocument
// 只装载不显示。LF 偏移计划经 lfOffsetToLineCol 转宿主 Position。
import * as vscode from 'vscode'
import { t } from '../shared/i18n'
import {
  lfOffsetToLineCol,
  planVaultRenameRewrites,
  type RenameDocInput,
  type RenameMoveEntry,
} from '../shared/vaultRename'
import type { VaultIndexService } from './vaultIndexService'

/** 计划结果观测（集成测试钩子；通知文案的数据面） */
export interface RenameRefLogEntry {
  /** 本批移动（old → new 的 fsPath 对） */
  moves: Array<{ oldFsPath: string; newFsPath: string }>
  /** 已应用改写处数与文件数（引用者随 rename 原子应用；被移动文档出链
   *  在 did 后独立应用） */
  plannedEdits: number
  plannedFiles: number
  /** 跳过项（cross-root / edge-stale，含 fsPath） */
  skipped: Array<{ fsPath: string; reason: string }>
  /** 索引未就绪而被整体放弃的移动数 */
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

/** will 阶段的暂存（did 阶段合并出链与 dirty 引用者部分后统一落日志与
 *  通知）。键 = newFsPath 归一形态（did 事件按 new 配对）。 */
interface PendingWillReport {
  log: RenameRefLogEntry
  /** dirty 引用者（fsPath 归一键）：will edit 实测会回滚其未保存内容
   *  （1.86 边界，见模块头），改写延迟到 did 通道独立 applyEdit */
  dirtyRefs: string[]
}
const pendingWillReports = new Map<string, PendingWillReport>()

/** will 阶段截取的被移动文档出链暂存（did 阶段应用）。**必须来自 rename
 *  前的索引**：链接文本按旧目录书写，其解析关系（resolvedTarget 的绝对
 *  定位）只在旧目录视角下成立——did 后的重扫按新目录解析旧文本会把全部
 *  出链判成断链，不能作为改写依据。 */
interface PendingMovedOutgoing {
  edges: ReadonlyArray<import('../shared/vaultIndexModel').VaultEdge>
  edgeRootFsPath: string
}
const pendingMovedOutgoing = new Map<string, PendingMovedOutgoing>()

/** LF 归一（宿主文本 → 计划坐标系；与索引边表契约一致） */
function normalizeLf(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

/** 文档当前文本：已打开优先（含未保存内容），否则装载磁盘文本 */
async function textOf(uri: vscode.Uri): Promise<{ host: string; lf: string } | null> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
  let doc = open ?? null
  if (!doc) {
    try {
      doc = await vscode.workspace.openTextDocument(uri)
    } catch {
      return null
    }
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
    for (const file of event.files) {
      void applyAfterRename(vaultIndex, isWindowsHost, file.oldUri, file.newUri)
    }
  })
  const subs = [willSub, didSub]
  if (process.env.VSIDIAN_TEST_HOOKS === '1') {
    subs.push(
      vscode.commands.registerCommand('onegayi.vsidian._test.getRenameRefLog', () => getRenameRefLog()),
    )
  }
  return subs
}

/** will 通道主体：引用者文档（非 rename 参与文件）的改写计划 → WorkspaceEdit
 *  （随 rename 原子应用、同一撤销单元）。任何失败路径都 resolve 空 edit
 *  （rename 本身不被阻断——规格不承诺拦截原生更名）。 */
async function buildWillRenameEdit(
  vaultIndex: VaultIndexService,
  isWindowsHost: boolean,
  files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>,
  token: vscode.CancellationToken,
): Promise<vscode.WorkspaceEdit> {
  const edit = new vscode.WorkspaceEdit()
  const moves = files.map((f) => ({ oldFsPath: f.oldUri.fsPath, newFsPath: f.newUri.fsPath }))
  const log: RenameRefLogEntry = {
    moves,
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

  const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []
  const docs: RenameDocInput[] = []
  /** 计划文档 → 宿主文本（与 LF 文本同源取得——LF 偏移换算必须同源） */
  const hostTexts = new Map<string, string>()
  /** dirty 引用者（延迟到 did 通道改写——will edit 会回滚未保存内容） */
  const dirtyRefs: string[] = []
  let hasCandidates = false

  for (const move of moves) {
    if (token.isCancellationRequested) {
      log.cancelled = true
      return edit
    }
    const candidates = vaultIndex.renameCandidatesOf(move.oldFsPath)
    if (candidates.status === 'not-ready') {
      // 索引未就绪：本移动不参与改写（不静默部分更新），did 阶段反馈说明
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
      pendingMovedOutgoing.set(normKeyOf(move.newFsPath), {
        edges: candidates.outgoing,
        edgeRootFsPath: candidates.rootFsPath!,
      })
    }
    if (candidates.incoming.length === 0 && !hasOutgoing) {
      continue // 无引用者且无出链：静默
    }
    hasCandidates = true
    // 引用者：原路径应用（rename 非参与文件，will edit 实测支持），边根 =
    // 目标所属根（反链按根分区，来源同根）。**dirty 引用者除外**：will edit
    // 实测会回滚未保存内容（1.86 边界）——延迟到 did 通道独立 applyEdit
    for (const group of candidates.incoming) {
      const uri = vscode.Uri.file(group.fsPath)
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
      if (openDoc?.isDirty) {
        dirtyRefs.push(normKeyOf(group.fsPath))
        continue
      }
      const text = await textOf(uri)
      if (text === null) {
        log.skipped.push({ fsPath: group.fsPath, reason: 'edge-stale' })
        continue
      }
      docs.push({
        fsPath: group.fsPath,
        text: text.lf,
        edges: group.edges,
        edgeRootFsPath: candidates.rootFsPath!,
      })
      hostTexts.set(group.fsPath, text.host)
    }
  }

  if (hasCandidates) {
    const plan = planVaultRenameRewrites({ rootFsPaths, isWindowsHost, moves }, docs)
    for (const docPlan of plan.docs) {
      fillEdit(edit, docPlan, hostTexts)
    }
    log.plannedEdits = plan.docs.reduce((sum, d) => sum + d.edits.length, 0)
    log.plannedFiles = plan.docs.length
    log.skipped.push(...plan.skipped.map((s) => ({ fsPath: s.fsPath, reason: s.reason })))
  }
  // 暂存至 did：rename 实际发生后合并出链与 dirty 引用者部分，统一落日志
  // 与通知（will 后用户取消 rename 时 did 不到来，暂存悬挂由下轮同键覆盖）
  if (log.plannedEdits > 0 || log.skipped.length > 0 || log.indexNotReady > 0 || dirtyRefs.length > 0) {
    for (const move of moves) {
      pendingWillReports.set(normKeyOf(move.newFsPath), { log: { ...log, moves }, dirtyRefs })
    }
  }
  return edit
}

/**
 * did 通道主体（rename 已完成）：索引刷新 → 被移动 Markdown 自身的出链
 * 改写（新路径已存在，独立 applyEdit 安全）→ 合并 will 暂存反馈统一通知。
 */
async function applyAfterRename(
  vaultIndex: VaultIndexService,
  isWindowsHost: boolean,
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): Promise<void> {
  const move: RenameMoveEntry = { oldFsPath: oldUri.fsPath, newFsPath: newUri.fsPath }
  const pending = pendingWillReports.get(normKeyOf(newUri.fsPath))
  const log: RenameRefLogEntry = pending?.log ?? {
    moves: [move],
    plannedEdits: 0,
    plannedFiles: 0,
    skipped: [],
    indexNotReady: 0,
    cancelled: false,
    notice: null,
  }
  const dirtyRefs = pending?.dirtyRefs ?? []
  pendingWillReports.delete(normKeyOf(newUri.fsPath))

  // 索引刷新（旧路径移除 + 新路径登记——md 重扫后新基线就位）
  await vaultIndex.refreshRenamed(move.oldFsPath, move.newFsPath)

  // 被移动 Markdown 自身的出链：用 will 暂存的旧目录解析边规划（rename 已
  // 完成，newUri 存在，applyEdit 安全）；文本取 did 时刻新路径内容（与
  // rename 前一致，窗口内被改则区间验证按 stale 跳过）
  const pendingOutgoing = pendingMovedOutgoing.get(normKeyOf(newUri.fsPath))
  if (pendingOutgoing) {
    pendingMovedOutgoing.delete(normKeyOf(newUri.fsPath))
    const text = await textOf(newUri)
    if (text !== null) {
      const docs: RenameDocInput[] = [
        {
          fsPath: move.newFsPath,
          text: text.lf,
          edges: pendingOutgoing.edges,
          edgeRootFsPath: pendingOutgoing.edgeRootFsPath,
        },
      ]
      const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []
      const plan = planVaultRenameRewrites({ rootFsPaths, isWindowsHost, moves: [move] }, docs)
      if (plan.docs.length > 0) {
        const edit = new vscode.WorkspaceEdit()
        const hostTexts = new Map<string, string>([[move.newFsPath, text.host]])
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
  // 边数据查旧路径桶（refreshRenamed 移除的是被移动文件自身条目，引用者
  // 边仍按旧目标聚合可查）
  if (dirtyRefs.length > 0) {
    const candidates = vaultIndex.renameCandidatesOf(move.oldFsPath)
    if (candidates.status === 'ready') {
      const docs: RenameDocInput[] = []
      const hostTexts = new Map<string, string>()
      for (const group of candidates.incoming) {
        if (!dirtyRefs.includes(normKeyOf(group.fsPath))) {
          continue
        }
        const uri = vscode.Uri.file(group.fsPath)
        const text = await textOf(uri)
        if (text === null) {
          log.skipped.push({ fsPath: group.fsPath, reason: 'edge-stale' })
          continue
        }
        docs.push({
          fsPath: group.fsPath,
          text: text.lf,
          edges: group.edges,
          edgeRootFsPath: candidates.rootFsPath!,
        })
        hostTexts.set(group.fsPath, text.host)
      }
      if (docs.length > 0) {
        const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []
        const plan = planVaultRenameRewrites({ rootFsPaths, isWindowsHost, moves: [move] }, docs)
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
  }

  // 合并反馈（无候选静默；未更新/部分跳过/已更新三态区分）
  log.notice = noticeKeyOf(log)
  if (log.notice !== null || log.plannedEdits > 0) {
    notifyOf(log)
  }
  if (log.plannedEdits > 0 || log.skipped.length > 0 || log.indexNotReady > 0 || log.cancelled) {
    pushRenameLog(log)
  }
}

/** 通知文案键决策：部分跳过优先警告级；全部跳过按唯一原因 */
function noticeKeyOf(log: RenameRefLogEntry): string | null {
  if (log.plannedEdits > 0) {
    return log.skipped.length > 0 || log.indexNotReady > 0
      ? 'host.renameRefsPartiallyUpdated'
      : 'host.renameRefsUpdated'
  }
  if (log.skipped.length > 0 || log.indexNotReady > 0) {
    return 'host.renameRefsSkippedAll'
  }
  return null
}

function notifyOf(log: RenameRefLogEntry): void {
  const key = log.notice
  if (key === null) {
    return
  }
  const message = t(key, {
    file: firstBasenameOf(log.moves),
    count: String(log.plannedEdits),
    files: String(log.plannedFiles),
    skipped: String(log.skipped.length + log.indexNotReady),
  })
  if (key === 'host.renameRefsUpdated') {
    void vscode.window.showInformationMessage(message)
  } else {
    void vscode.window.showWarningMessage(message)
  }
}

/** 路径归一键（pendingWillReports 配对；Windows 折叠 + 分隔符统一） */
function normKeyOf(fsPath: string): string {
  const norm = fsPath.replace(/\\/g, '/')
  return process.platform === 'win32' ? norm.toLowerCase() : norm
}

function firstBasenameOf(moves: Array<{ oldFsPath: string }>): string {
  const first = moves[0]?.oldFsPath ?? ''
  const norm = first.replace(/\\/g, '/')
  return norm.slice(norm.lastIndexOf('/') + 1)
}
