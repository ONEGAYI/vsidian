// 悬停预览文档访问（工单 #218，ADR-0009「文档访问」层首块）：从双链跳转
// 链路（executeWikilinkIntent 七步）提炼的**无副作用读取路径**——目标解析、
// 规范身份、带版本正文与 LF 范围；不打开面板、不写文档、不建索引。
//
// 分层（ADR-0009）：本模块只负责「读什么、读成什么」，不做视图布局与
// 编辑输入；端口面（HoverDocAccessPorts）只有解析与读取两个入口、无任何
// 写端口——「只读视图不获得写入端口」的结构性表达，后续 #219（章节/块
// 范围选择器）、#222（嵌入内容来源）、#224（版本订阅与刷新）复用本通道。
//
// 解析语义（与跳转链路同源，不建第二套解析器）：
// - 形态学 parseWikilinkInner（shared/wikilink 单一事实源）；
// - 空 path（[[#标题]] / [[#^块id]]）目标即来源文档自身，不查文件系统；
// - 根内相对路径 resolveVaultLinkFile（ADR-0008 语义：docDir 基准、越出
//   所属根拦截、多根互不补查）；
// - 正文读取 openTextDocument+getText（宿主 TextDocument 是权威事实源，
//   未保存修改天然可见；不创建每引用 WebviewPanel）；
// - LF 坐标经 NewlineCoordinator 转换（webview 全程 LF）。
//
// 一期范围：全文（scope=full）。带标题/块锚点的双链同样返回全文——范围
// 选择在渲染侧按切块+区间做（#219 接入），本层不孤立解析截取字符串。
// 非 Markdown 目标（如 [[图.png]]）返回 non-markdown 错误分态（#218 只接
// Markdown 全文；PDF 等三期另议）。
//
// 本模块不依赖 vscode（node 单测直驱；vscode 层装配在 textEditorProvider）。
import * as path from 'node:path'
import { NewlineCoordinator } from '../shared/newline'
import { parseWikilinkInner } from '../shared/wikilink'
import type { VaultLinkFileResolution, VaultLinkResolveContext } from '../shared/vaultLink'
import type { HoverPreviewFailReason } from '../shared/protocol'

/** 读取结果：成功携带规范身份 + 版本 + LF 全文与源范围；失败为错误分态
 *  （就地 i18n 呈现的载荷来源，不连续弹宿主通知） */
export type HoverReadOutcome =
  | {
      ok: true
      /** 宿主侧真实路径（解析端口大小写归正后形态） */
      fsPath: string
      /** 所属根内相对路径（`/` 分隔；身份键与显示名共用） */
      relPath: string
      /** 目标 TextDocument.version（#224 变更刷新的版本基准） */
      version: number
      /** LF 全文（保留全文解析上下文——范围选取在渲染侧做） */
      lfText: string
      /** 目标源范围（一期全文恒为 [0, length]） */
      range: { start: number; end: number }
    }
  | { ok: false; reason: HoverPreviewFailReason }

/** 读取上下文：来源文档的解析语境与身份（vscode 层从父 TextDocument 构造） */
export interface HoverDocAccessContext {
  /** 根内相对解析上下文（docDir 基准；与跳转链路同款） */
  resolve: VaultLinkResolveContext
  /** 来源文档绝对 fsPath（空 path 双链的自引用目标） */
  sourceFsPath: string
  /** 所属根绝对 fsPath（relPath 计算基准；无工作区时与 docDir 同） */
  rootFsPath: string
}

/** 读取端口（vscode 层注入；无写端口——只读访问不依赖写入） */
export interface HoverDocAccessPorts {
  /** 双链文件目标存在性解析（vscode 层 = resolveVaultLinkFile + statFileRealPath） */
  resolveVaultFile(rawPath: string): Promise<VaultLinkFileResolution>
  /** 打开并读取目标文档（vscode 层 = openTextDocument 只装载不显示 + getText；
   *  失败返回 null） */
  openTextDocument(fsPath: string): Promise<{ version: number; text: string } | null>
}

/** 目标是否 Markdown（一期悬停只接 Markdown 全文；大小写不敏感） */
function isMarkdownPath(fsPath: string): boolean {
  return /\.md$/i.test(fsPath)
}

/**
 * 读取悬停双链的目标文档（#218 全文路径）。
 *
 * rawTarget 为 `[[` 与 `]]` 之间、`|` 之前的原文（未 trim——parseWikilinkInner
 * 自带规范化）。全程无副作用：不 openWith、不定位、不提示、不写文档。
 */
export async function readHoverDocTarget(
  rawTarget: string,
  ctx: HoverDocAccessContext,
  ports: HoverDocAccessPorts,
): Promise<HoverReadOutcome> {
  const parsed = parseWikilinkInner(rawTarget.trim())
  if (!parsed) {
    return { ok: false, reason: 'unsupported' }
  }
  let fsPath: string
  if (parsed.path === '') {
    // 本文件锚点：目标即来源文档自身（不查文件系统）
    fsPath = ctx.sourceFsPath
  } else {
    const resolution = await ports.resolveVaultFile(parsed.path)
    if (resolution.kind === 'no-workspace') {
      return { ok: false, reason: 'no-workspace' }
    }
    if (resolution.kind === 'escape') {
      return { ok: false, reason: 'escape' }
    }
    if (resolution.kind === 'not-found') {
      return { ok: false, reason: 'not-found' }
    }
    fsPath = resolution.fsPath
  }
  if (!isMarkdownPath(fsPath)) {
    // 一期只接 Markdown 全文；图片/附件等目标不读取正文（#220/#223+ 再扩）
    return { ok: false, reason: 'non-markdown' }
  }
  const doc = await ports.openTextDocument(fsPath)
  if (!doc) {
    return { ok: false, reason: 'read-failed' }
  }
  const lfText = new NewlineCoordinator(doc.text).toLfText(doc.text)
  const relOf = ctx.resolve.isWindowsHost ? path.win32.relative : path.posix.relative
  return {
    ok: true,
    fsPath,
    relPath: relOf(ctx.rootFsPath, fsPath).replaceAll('\\', '/'),
    version: doc.version,
    lfText,
    range: { start: 0, end: lfText.length },
  }
}
