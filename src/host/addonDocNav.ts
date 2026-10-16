// #543 T03 附加组件文档打开与定位——宿主执行体（内部定位执行体）。
//
// 职责（规格 addon-navigation.md §4.2）：解析（vaultLink 同一解析器：来源
// 文档目录基准、所属根边界、扩展名候选、大小写由宿主文件系统裁决）→
// 分派（md = Vsidian 面板 openWith 重显 + view.locate 管线；可读文本 =
// 原生编辑器 showTextDocument + revealRange）→ 定位（标题/块 ID 与双链
// 跳转同一 findHeadingOffset / findBlockOffset；行号按执行时权威文本换算
// LF 行首坐标——CRLF 由 NewlineCoordinator，不用等待前的旧偏移）。
//
// 本模块是 #534（普通链接尾部行号）的**可复用定位执行体**：Markdown 行号
// 经本执行体落位，不把数字交给标题定位器。全部 vscode 操作经端口注入
// （无 vscode 依赖，node 单测直驱）；生产接线在 textEditorProvider。
//
// 有界终态（规格 §4.2）：每个分支都返回结果——面板关闭、来源失效、代次
// 结束或定位未送达返回失败；不把仅调用 openWith 当作已定位成功。来源/
// 代次存活在三个执行点复核（入口、打开后、定位前——旧请求不抢回当前
// 定位）。
import * as path from 'node:path'
import { resolveVaultLinkFile, isVaultPathInsideRoot, type VaultLinkResolveContext } from '../shared/vaultLink'
import { classifyLocalRefContentKind } from '../shared/refContent'
import { NewlineCoordinator } from '../shared/newline'
import { isAddonDocNavLocate, type AddonDocNavLocate, type AddonDocNavResult } from '../shared/addonNavApi'
import { findBlockOffset, findHeadingOffset } from './wikilinkTarget'
import { classifyLinkTarget } from './linkTarget'

/** 执行端口（vscode 操作注入；生产实现在 textEditorProvider，测试注入桩） */
export interface AddonDocNavExecPorts {
  /** 目标存在性探测（resolveVaultLinkFile 的 exists 端口——真实路径归正） */
  statRealPath(fsPath: string): Promise<string | null>
  /** 按来源文档派生解析上下文（docDir 基准 + 所属根 + 无工作区判定） */
  resolveContext(sourceFsPath: string): VaultLinkResolveContext
  /** 来源面板仍在场（面板关闭后迟到执行拒收） */
  isSourceLive(): boolean
  /** 请求组件的编辑器代次仍当前（代次结束拒收——旧请求不抢回定位） */
  isGenerationLive(): boolean
  /** 读目标权威全文（宿主系坐标；已打开 TextDocument 优先/否则读盘）。
   *  null = 读取失败 */
  readDocText(fsPath: string): Promise<string | null>
  /** 打开 Markdown 为 Vsidian 面板（vscode.openWith——对已开面板是重显）。
   *  false = 执行失败 */
  openMarkdown(fsPath: string): Promise<boolean>
  /** 就绪等待必须先于权威文本读取，防止等待中变化导致旧偏移。 */
  waitForMarkdownReady(fsPath: string): Promise<boolean>
  /** 投递 view.locate（waitForReadyPanel 就绪等待 + LF 偏移 + 送达确认/
   *  重握手补发管线）。false = 未送达（无就绪面板） */
  locateMarkdown(fsPath: string, lfOffset: number): Promise<boolean>
  /** 打开可读文本为原生编辑器并定位行（lineIdx0 = 0-based 行；null = 仅
   *  打开不定位——落点行首并 reveal 居中）。false = 执行失败 */
  openTextAtLine(fsPath: string, lineIdx0: number | null): Promise<boolean>
}

/** 行总数（宿主系文本；尾随换行的末空行是合法定位行，与 VSCode lineCount 同口径） */
function countHostLines(text: string): number {
  return text.split('\n').length
}

/** 宿主系行首偏移（1-based line；越界返回 null——调用方按 out-of-bounds 分派）。
 *  #534 起公开导出：普通链接尾部行号（executeLinkIntent 的 md 落位）复用
 *  同一行号→宿主偏移换算，不建第二套（CRLF 语义由 NewlineCoordinator 收口） */
export function hostLineStart(text: string, line1: number): number | null {
  let offset = 0
  let n = 1
  for (const rawLine of text.split('\n')) {
    if (n === line1) {
      return offset
    }
    offset += rawLine.length + 1
    n++
  }
  return null
}

/**
 * 执行附加组件文档导航请求（宿主翻译形态：来源实例已解析为绝对
 * sourceFsPath——来源身份校验在 provider 层完成）。来源/代次失效复核在
 * 入口、打开后、定位前三点；打开动作先于锚点校验（目标存在但定位失败
 * 时报告打开状态），非法形状（invalid-request）不执行任何打开。
 */
export async function executeAddonDocNav(
  input: { sourceFsPath: string; target: string; locate?: AddonDocNavLocate | unknown },
  ports: AddonDocNavExecPorts,
): Promise<AddonDocNavResult> {
  if (!ports.isSourceLive() || !ports.isGenerationLive()) {
    return { ok: false, reason: 'view-disposed', opened: false }
  }
  // 形状守卫（宿主复核层：消息桥已拦，这里兜住直调/伪造路径——与 SDK
  // 入口同一互斥口径，非法不进打开管线）
  if (
    typeof input.sourceFsPath !== 'string' || input.sourceFsPath === '' ||
    typeof input.target !== 'string' ||
    (input.locate !== undefined && !isAddonDocNavLocate(input.locate))
  ) {
    return { ok: false, reason: 'invalid-request', opened: false }
  }
  let opened = false
  try {
    const locate = input.locate

    // ---- 目标解析（vaultLink 同一解析器；空 target = 同文件锚点） ----
    let targetFsPath: string
    if (input.target === '') {
      targetFsPath = input.sourceFsPath
    } else {
      const context = ports.resolveContext(input.sourceFsPath)
      const ops = context.isWindowsHost ? path.win32 : path.posix
      if (ops.isAbsolute(input.target)) {
        return { ok: false, reason: 'invalid-request', opened: false }
      }
      const classification = classifyLinkTarget(input.target, context)
      if (classification.kind !== 'doc') {
        return { ok: false, reason: classification.kind === 'blocked' && classification.reason === 'escape'
          ? 'escape' : 'invalid-request', opened: false }
      }
      const resolution = await resolveVaultLinkFile(
        input.target,
        context,
        ports.statRealPath,
      )
      if (resolution.kind !== 'target') {
        // no-workspace / escape / not-found：对齐既有解析口径，不新增 fs 权限
        //（ambiguous/pending 由短名补查端口产生，#556 未接线不可达，折射为
        //  not-found——公开 API 拒绝枚举的扩面留待接线票评估）
        return {
          ok: false,
          reason:
            resolution.kind === 'ambiguous' || resolution.kind === 'pending'
              ? 'not-found'
              : resolution.kind,
          opened: false,
        }
      }
      if (!isVaultPathInsideRoot(resolution.fsPath, context)) {
        return { ok: false, reason: 'escape', opened: false }
      }
      targetFsPath = resolution.fsPath
    }

    // ---- 目标类型分派（classifyLocalRefContentKind 同源；附件不在本面） ----
    const kind = classifyLocalRefContentKind(targetFsPath)
    if (kind === 'image' || kind === 'pdf') {
      return { ok: false, reason: 'invalid-request', opened: false }
    }
    // 标题/块 ID 锚点语义仅 Markdown（text 目标只接受行号或无定位）
    if (kind === 'text' && locate !== undefined && locate.kind !== 'line') {
      return { ok: false, reason: 'invalid-request', opened: false }
    }
    if (!ports.isSourceLive() || !ports.isGenerationLive()) {
      return { ok: false, reason: 'view-disposed', opened: false }
    }

    if (kind === 'markdown') {
      // ---- Markdown：Vsidian 面板打开/重显 → 执行时权威文本校验 → locate ----
      opened = await ports.openMarkdown(targetFsPath)
      if (!opened) {
        return { ok: false, reason: 'error', opened: false }
      }
      if (!ports.isSourceLive() || !ports.isGenerationLive()) {
        return { ok: false, reason: 'view-disposed', opened: true }
      }
      if (locate === undefined) {
        return { ok: true, opened: true, located: false }
      }
      const ready = await ports.waitForMarkdownReady(targetFsPath)
      if (!ports.isSourceLive() || !ports.isGenerationLive()) {
        return { ok: false, reason: 'view-disposed', opened: true }
      }
      if (!ready) {
        return { ok: false, reason: 'delivery-failed', opened: true }
      }
      // 执行时权威文本：等待中目标变短时行号在此重校验，不发送旧偏移
      const text = await ports.readDocText(targetFsPath)
      if (text === null) {
        return { ok: false, reason: 'error', opened: true }
      }
      const coordinator = new NewlineCoordinator(text)
      let lfOffset: number
      if (locate.kind === 'line') {
        const hostOffset = hostLineStart(text, locate.line)
        if (hostOffset === null) {
          // 首次越界严格失败，不默默钳到末行
          return { ok: false, reason: 'out-of-bounds', opened: true }
        }
        lfOffset = coordinator.hostOffsetToLf(hostOffset)
      } else if (locate.kind === 'heading') {
        const hit = findHeadingOffset(text, locate.heading)
        if (hit === null) {
          return { ok: false, reason: 'anchor-not-found', opened: true }
        }
        lfOffset = coordinator.hostOffsetToLf(hit.offset)
      } else {
        const hit = findBlockOffset(text, locate.blockId)
        if (hit === null) {
          return { ok: false, reason: 'anchor-not-found', opened: true }
        }
        lfOffset = coordinator.hostOffsetToLf(hit.offset)
      }
      if (!ports.isSourceLive() || !ports.isGenerationLive()) {
        return { ok: false, reason: 'view-disposed', opened: true }
      }
      const delivered = await ports.locateMarkdown(targetFsPath, lfOffset)
      if (!ports.isSourceLive() || !ports.isGenerationLive()) {
        return { ok: false, reason: 'view-disposed', opened: true }
      }
      return delivered
        ? { ok: true, opened: true, located: true }
        : { ok: false, reason: 'delivery-failed', opened: true }
    }

    // ---- 可读文本：原生编辑器打开 → 执行时权威文本校验 → reveal 行 ----
    opened = await ports.openTextAtLine(targetFsPath, null)
    if (!opened) {
      return { ok: false, reason: 'error', opened: false }
    }
    if (!ports.isSourceLive() || !ports.isGenerationLive()) {
      return { ok: false, reason: 'view-disposed', opened: true }
    }
    const textLine = locate?.kind === 'line' ? locate.line : null
    if (textLine === null) {
      return { ok: true, opened: true, located: false }
    }
    const text = await ports.readDocText(targetFsPath)
    if (text === null) {
      return { ok: false, reason: 'error', opened: true }
    }
    if (textLine > countHostLines(text)) {
      return { ok: false, reason: 'out-of-bounds', opened: true }
    }
    if (!ports.isSourceLive() || !ports.isGenerationLive()) {
      return { ok: false, reason: 'view-disposed', opened: true }
    }
    const revealed = await ports.openTextAtLine(targetFsPath, textLine - 1)
    return revealed
      ? { ok: true, opened: true, located: true }
      : { ok: false, reason: 'delivery-failed', opened: true }
  } catch {
    // 文件系统与编辑器端口属于外部执行边界，失败按公开结果返回。
    return { ok: false, reason: 'error', opened }
  }
}
