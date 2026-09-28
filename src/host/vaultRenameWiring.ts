// 单文件更名/移动的引用自动更新装配（工单 #199，父规格 #194「引用自动
// 更新」节）：onWillRenameFiles 主通道（waitUntil 返回 WorkspaceEdit，随
// rename 原子应用、可撤销）+ onDidRenameFiles 索引刷新。
//
// 通道语义（1.86 实测落档，见 docs/specs/vault-index-backlinks.md #199 节）：
// - will 事件在 rename 执行**前**分发（文件仍在旧路径——被移动文档文本
//   取 oldUri）；waitUntil 必须在事件分发期间同步调用，传入的 thenable
//   resolve 的 WorkspaceEdit 由宿主在 rename 完成后应用（edit 中对 newUri
//   的修改合法，内置 TS 扩展的 import 改写同通道），rename 与 edit 合并
//   为一个撤销单元
// - 资源管理器/命令面板 rename、move 与 workspace.applyEdit(renameFile)
//   都触发 will+did；workspace.fs.rename 与外部工具改名**不触发**（后者
//   只经 watcher 走增量维护，不改写引用——「不猜测旧新身份」）
// - 反馈在 will 阶段按计划结果发（宿主承诺 edit 随 rename 应用；用户取消
//   rename 时 token 取消，计划不生成也不通知）
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
  type RenameSkipItem,
} from '../shared/vaultRename'
import type { VaultIndexService } from './vaultIndexService'

/** 计划结果观测（集成测试钩子；通知文案的数据面） */
export interface RenameRefLogEntry {
  /** 本批移动（old → new 的 fsPath 对） */
  moves: Array<{ oldFsPath: string; newFsPath: string }>
  /** 计划改写处数与文件数（edit 随 rename 应用） */
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

/**
 * 装配 rename 引用更新（extension.ts 调用）：返回订阅，调用方并入
 * context.subscriptions。无索引服务时不装配（无工作区即无引用域）。
 */
export function installRenameRefUpdater(
  vaultIndex: VaultIndexService,
  isWindowsHost: boolean,
): vscode.Disposable[] {
  const willSub = vscode.workspace.onWillRenameFiles((event) => {
    // waitUntil 必须在事件分发期间同步调用（1.86 类型注释明言异步调用
    // 会 throw）——thenable 内部异步生成计划
    event.waitUntil(buildRenameEdit(vaultIndex, isWindowsHost, event.files, event.token))
  })
  const didSub = vscode.workspace.onDidRenameFiles((event) => {
    // rename 完成后的索引刷新：旧路径移除（missing 正证据）、新路径登记
    for (const file of event.files) {
      void vaultIndex.refreshRenamed(file.oldUri.fsPath, file.newUri.fsPath)
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

/** will 通道主体：候选查询 → 计划 → WorkspaceEdit（uri：引用者原路径、
 *  被移动文档新路径）→ 反馈通知。任何失败路径都 resolve 空 edit（rename
 *  本身不被阻断——规格不承诺拦截原生更名）。 */
async function buildRenameEdit(
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
    pushRenameLog(log)
    return edit
  }

  const rootFsPaths = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []
  const docs: RenameDocInput[] = []
  /** 计划文档 → 宿主文本（与 LF 文本同源取得：引用者=自身，被移动文档
   *  =旧路径——新路径在 will 时刻尚不存在，LF 偏移换算必须同源） */
  const hostTexts = new Map<string, string>()
  let hasCandidates = false

  for (const move of moves) {
    if (token.isCancellationRequested) {
      log.cancelled = true
      pushRenameLog(log)
      return edit
    }
    const candidates = vaultIndex.renameCandidatesOf(move.oldFsPath)
    if (candidates.status === 'not-ready') {
      // 索引未就绪：本移动不参与改写（不静默部分更新），计数后在反馈说明
      log.indexNotReady += 1
      continue
    }
    if (candidates.status === 'outside') {
      continue // 工作区外目标不在引用域
    }
    const hasIncoming = candidates.incoming.length > 0
    const hasOutgoing = candidates.outgoing.some(
      (e) => e.resolvedTarget !== null && e.target.trim() !== '',
    )
    if (!hasIncoming && !hasOutgoing) {
      continue // 无人引用且无出链：静默（rename 不打扰）
    }
    hasCandidates = true
    // 引用者：原路径应用，边根 = 目标所属根（反链按根分区，来源同根）
    for (const group of candidates.incoming) {
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
    // 被移动文档自身：新路径应用（edit 随 rename 应用在 newUri 上），
    // 文本取旧路径（will 时刻文件未动；已打开时含未保存内容）
    if (hasOutgoing) {
      const oldUri = vscode.Uri.file(move.oldFsPath)
      const movedText = await textOf(oldUri)
      if (movedText !== null) {
        docs.push({
          fsPath: move.newFsPath,
          text: movedText.lf,
          edges: candidates.outgoing,
          edgeRootFsPath: candidates.rootFsPath!,
        })
        hostTexts.set(move.newFsPath, movedText.host)
      }
    }
  }

  if (hasCandidates) {
    const plan = planVaultRenameRewrites(
      { rootFsPaths, isWindowsHost, moves },
      docs,
    )
    for (const docPlan of plan.docs) {
      const uri = vscode.Uri.file(docPlan.fsPath)
      const host = hostTexts.get(docPlan.fsPath) ?? ''
      for (const e of docPlan.edits) {
        const from = lfOffsetToLineCol(host, e.start)
        const to = lfOffsetToLineCol(host, e.end)
        edit.replace(uri, new vscode.Range(from.line, from.character, to.line, to.character), e.replacement)
      }
    }
    log.plannedEdits = plan.docs.reduce((sum, d) => sum + d.edits.length, 0)
    log.plannedFiles = plan.docs.length
    log.skipped = [
      ...log.skipped,
      ...plan.skipped.map((s: RenameSkipItem) => ({ fsPath: s.fsPath, reason: s.reason })),
    ]
    log.notice = noticeKeyOf(log)
    notifyOf(log, moves)
  } else if (log.indexNotReady > 0) {
    log.notice = 'host.renameRefsIndexNotReady'
    notifyOf(log, moves)
  }

  pushRenameLog(log)
  return edit
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

function notifyOf(log: RenameRefLogEntry, moves: Array<{ oldFsPath: string }>): void {
  const key = log.notice
  if (key === null) {
    return
  }
  const file = firstBasenameOf(moves)
  const message = t(key, {
    file,
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

function firstBasenameOf(moves: Array<{ oldFsPath: string }>): string {
  const first = moves[0]?.oldFsPath ?? ''
  const norm = first.replace(/\\/g, '/')
  const base = norm.slice(norm.lastIndexOf('/') + 1)
  return base
}
