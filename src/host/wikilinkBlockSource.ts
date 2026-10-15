// 块联想查询的宿主编排（工单 #380 T05）：明确 Markdown 目标 → 按来源
// 相对语义解析（shared/vaultLink 同一实现，不按部分文件名猜目标）→ 以
// 「宿主当前 TextDocument」为依据读取正文（已打开文档优先——未保存内容
// 不被磁盘或索引副本替代；未打开读磁盘最新内容）→ 块边界枚举候选
// （shared/wikilinkBlock，边界单一事实源 shared/blockId）→ 片段/已有 id
// 过滤。与 wikilinkHeadingSource（#379 T04）同构分层：本模块只做编排与
// 产物组装，vscode/DOM 依赖经 ports 注入；不做显式缓存（一期）——每次
// 查询读取时核对当前 TextDocument / 磁盘内容。失败分真实状态，不伪装
// 空结果。
import path from 'node:path'
import { resolveVaultLinkFile, type VaultLinkExistsPort, type VaultLinkResolveContext } from '../shared/vaultLink'
import { classifyVaultFileCategory } from '../shared/vaultFileCategory'
import { defaultAliasOf } from '../shared/wikilinkQuery'
import { enumerateReferableBlocks, filterWikilinkBlocks } from '../shared/wikilinkBlock'
import type { WikilinkBlockItem } from '../shared/protocol'

/** 宿主依赖端口（provider 注入真实适配；单测注入桩）——与标题源同构 */
export interface WikilinkBlockSourcePorts {
  /** 目标存在性探测（vscode 层 = statFileRealPath，大小写归正磁盘真值） */
  exists: VaultLinkExistsPort
  /** 已打开 TextDocument 的当前文本（无则 null——未打开目标走磁盘读取） */
  openTextDocument(fsPath: string): { text: string; version: number } | null
  /** 未打开目标的磁盘读取（不存在/权限失败 reject——真实状态不吞错） */
  openTextDocumentFromDisk(fsPath: string): Promise<{ text: string; version: number }>
}

export type { WikilinkBlockItem }

export type WikilinkBlockQueryResult =
  | { status: 'unavailable'; reason: 'no-workspace' | 'target-not-found' | 'target-not-md' | 'read-error' }
  | { status: 'ready'; targetFsPath: string; targetVersion: number; items: WikilinkBlockItem[] }

/**
 * 查询明确 Markdown 目标的块候选：targetRaw 为双链文件字段原文（宿主按
 * 来源相对语义解析——与跳转同一 resolveVaultLinkFile）；query 为块字段
 * 前缀（片段与已有 id 包含匹配，空 = 全部——无 ID 块照常列出）。目标非
 * Markdown 或不可定位返回真实状态；读取失败分态（不冒充空结果）。
 * targetVersion 随结果返回——无 ID 块接受时 webview 原样回传，宿主按版本
 * 核对淘汰「目标正文在请求中改动」的旧候选。
 *
 * 同文档锚点（2026-10-14 修复）：targetRaw 为空/空白且提供 sameDocFsPath
 * 时跳过目标解析，直接以来源文档为目标（与 parseWikilinkInner 本文件锚点
 * `[[#^块ID]]` 及 #159 跳转语义同口径，不依赖工作区在场）。此时候选 alias
 * 为空串：确认写回不补文件名默认别名（显式写出的目标——含显式自引——
 * 仍按文件名补默认别名，既有行为不变）。
 */
export async function queryWikilinkBlocks(
  targetRaw: string,
  query: string,
  ctx: VaultLinkResolveContext,
  ports: WikilinkBlockSourcePorts,
  sameDocFsPath?: string,
): Promise<WikilinkBlockQueryResult> {
  // 本文件锚点：省略文件名 = 当前文档（文档在编辑中即在场，不走存在性探测）
  const selfAnchor = targetRaw.trim() === '' && sameDocFsPath !== undefined
  let targetFsPath: string
  if (selfAnchor) {
    targetFsPath = sameDocFsPath
  } else {
    const resolution = await resolveVaultLinkFile(targetRaw, ctx, ports.exists)
    if (resolution.kind === 'no-workspace') {
      return { status: 'unavailable', reason: 'no-workspace' }
    }
    if (
      resolution.kind === 'escape' ||
      resolution.kind === 'not-found' ||
      resolution.kind === 'ambiguous' ||
      resolution.kind === 'pending'
    ) {
      // 越界与未命中都归「无法定位明确目标」：不按部分文件名猜目标
      //（ambiguous/pending 由短名补查端口产生，#556 未接线，不可达）
      return { status: 'unavailable', reason: 'target-not-found' }
    }
    targetFsPath = resolution.fsPath
  }
  if (classifyVaultFileCategory(targetFsPath) !== 'markdown') {
    return { status: 'unavailable', reason: 'target-not-md' }
  }
  let doc: { text: string; version: number }
  const opened = ports.openTextDocument(targetFsPath)
  if (opened !== null) {
    doc = opened
  } else {
    try {
      doc = await ports.openTextDocumentFromDisk(targetFsPath)
    } catch {
      return { status: 'unavailable', reason: 'read-error' }
    }
  }
  // 省略文件名（本文件锚点）→ alias 空串（确认不补文件名默认别名）；
  // 显式写出的目标（含显式自引）仍按文件名补
  const alias = selfAnchor ? '' : defaultAliasOf(path.basename(targetFsPath), 'markdown')
  const items = filterWikilinkBlocks(enumerateReferableBlocks(doc.text), query).map((entry) => ({
    id: `${targetFsPath}#^${entry.line}`,
    blockId: entry.blockId,
    snippet: entry.snippet,
    line: entry.line,
    lineCount: entry.lineCount,
    alias,
  }))
  return { status: 'ready', targetFsPath, targetVersion: doc.version, items }
}
