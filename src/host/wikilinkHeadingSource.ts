// 标题联想查询的宿主编排（工单 #379 T04）：明确 Markdown 目标 → 按来源
// 相对语义解析（shared/vaultLink 同一实现，不按部分文件名猜目标）→ 以
// 「宿主当前 TextDocument」为依据读取正文（已打开文档优先——未保存内容
// 不被磁盘或索引副本替代；未打开读磁盘最新内容）→ ATX 口径枚举候选
// （shared/wikilinkHeading；重复标题独立身份 + 规范化同名风险标记）。
//
// 分层（与 hoverDocAccess 同构）：本模块只做编排与产物组装，vscode/DOM
// 依赖经 ports 注入——provider 层传真实适配，node 单测直驱注入桩。不做
// 显式缓存（一期）：每次查询读取时核对当前 TextDocument / 磁盘内容，
// 「缓存只加速不替代版本核对」由不建缓存满足；容量验证（T07）后再评估。
// 失败分真实状态（target-not-found / target-not-md / read-error /
// no-workspace），不伪装空结果。
import * as path from 'node:path'
import { resolveVaultLinkFile, type VaultLinkExistsPort, type VaultLinkResolveContext } from '../shared/vaultLink'
import { classifyVaultFileCategory } from '../shared/vaultFileCategory'
import { defaultAliasOf, wikilinkHeadingCandidateSafe } from '../shared/wikilinkQuery'
import { enumerateAtxHeadings, filterWikilinkHeadings } from '../shared/wikilinkHeading'
import type { WikilinkHeadingItem } from '../shared/protocol'

/** 宿主依赖端口（provider 注入真实适配；单测注入桩） */
export interface WikilinkHeadingSourcePorts {
  /** 目标存在性探测（vscode 层 = statFileRealPath，大小写归正磁盘真值） */
  exists: VaultLinkExistsPort
  /** 已打开 TextDocument 的当前文本（无则 null——未打开目标走磁盘读取） */
  openTextDocument(fsPath: string): { text: string; version: number } | null
  /** 未打开目标的磁盘读取（不存在/权限失败 reject——真实状态不吞错） */
  openTextDocumentFromDisk(fsPath: string): Promise<{ text: string; version: number }>
}

export type { WikilinkHeadingItem }

export type WikilinkHeadingQueryResult =
  | { status: 'unavailable'; reason: 'no-workspace' | 'target-not-found' | 'target-not-md' | 'read-error' }
  | { status: 'ready'; targetFsPath: string; targetVersion: number; items: WikilinkHeadingItem[] }

/**
 * 查询明确 Markdown 目标的标题候选：targetRaw 为双链文件字段原文（宿主按
 * 来源相对语义解析——精确路径 / 补 .md 候选 / 越界拦截，与跳转同一
 * resolveVaultLinkFile）；query 为标题前缀（规范化口径过滤，空 = 全部）。
 * 目标非 Markdown 或不可定位返回真实状态；读取失败分态（不猜当前文档、
 * 不冒充空结果）。
 */
export async function queryWikilinkHeadings(
  targetRaw: string,
  query: string,
  ctx: VaultLinkResolveContext,
  ports: WikilinkHeadingSourcePorts,
): Promise<WikilinkHeadingQueryResult> {
  const resolution = await resolveVaultLinkFile(targetRaw, ctx, ports.exists)
  if (resolution.kind === 'no-workspace') {
    return { status: 'unavailable', reason: 'no-workspace' }
  }
  if (resolution.kind === 'escape' || resolution.kind === 'not-found') {
    // 越界与未命中都归「无法定位明确目标」：不按部分文件名猜目标
    return { status: 'unavailable', reason: 'target-not-found' }
  }
  const targetFsPath = resolution.fsPath
  if (classifyVaultFileCategory(targetFsPath) !== 'markdown') {
    return { status: 'unavailable', reason: 'target-not-md' }
  }
  // 正文依据：已打开 TextDocument 优先（未保存内容不被磁盘替代），
  // 未打开读磁盘最新内容；读取失败（删除竞态/权限）真实报错
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
  const alias = defaultAliasOf(path.basename(targetFsPath), 'markdown')
  // F5：标题写回语法往返校验——含 | / # / ^ / [ / ] 的标题经确认写回后
  // 引用静默损坏或表格格内裂格（`[[t#标题]]` 解析不回同一标题），不入
  // 候选列表（与文件候选 insertPath 往返失败丢弃同口径）
  const items = filterWikilinkHeadings(enumerateAtxHeadings(doc.text), query)
    .filter((entry) => wikilinkHeadingCandidateSafe(entry.text))
    .map((entry) => ({
      id: `${targetFsPath}#${entry.line}`,
      heading: entry.text,
      level: entry.level,
      line: entry.line,
      duplicate: entry.duplicate,
      alias,
    }))
  return { status: 'ready', targetFsPath, targetVersion: doc.version, items }
}
