// PDF 导出嵌入目标预取（T02/#622）：准备阶段固定输入的嵌入数据面。
//
// 语义（规格 §2.1/§2.3 + ADR-0011）：
// - **超集枚举**：全文逐行扫描全部合法 `![[…]]` 出现（scanEmbedsInLine
//   ——与 Reading 块级/混排嵌入消费同一形态学源），排除图片目标（图片
//   嵌入不升级卡片，走正文图片管线）。多取的目标不构成失败；页面按块
//   精确消费（embedInner / 占位引用行命中才展开或降级）。
// - **目标解析与范围规则零复制**：读取经注入端口（生产实现 = provider
//   侧 readRefContentTarget 的窄化投影——同 resolveVaultFile/openTextDocument
//   链路，内容范围恒全文）；本模块只做去重、分派与失败登记。
// - **嵌套与循环边界**：预取只做一层（B 全文进 payload；B 内的嵌入在
//   页面渲染为占位引用行——与阅读嵌入卡一层展开同边界，不放宽）。
//   循环引用天然断（A→B→A 时 B 内占位）。
// - 同一 inner 只预取一次（同目标同版本——多引用一致性由固定输入保证）。
//
// 纯逻辑可单测：读取端口注入，无 vscode/DOM 依赖。

import { scanEmbedsInLine } from '../../shared/wikilink'
import { refEmbedTargetIsImage } from '../../shared/refContent'
import type {
  PdfExportEmbedEntry,
  PdfExportMediaEmbedEntry,
  PdfExportEmbedPrefetchFailure,
} from '../../shared/pdfExportPayload'

/** 嵌入目标读取端口（生产 = provider 侧 readRefContentTarget 窄化投影） */
export interface PdfExportEmbedReadPort {
  readTarget(inner: string): Promise<
    | { ok: true; kind: 'markdown'; fsPath: string; docName: string; text: string; version: number }
    | { ok: true; kind: 'pdf' | 'media' | 'web'; fsPath?: string; url?: string }
    | { ok: false; reason: string }
  >
}

/**
 * 超集枚举：全文全部合法嵌入出现的目标 inner（保持出现顺序、去重；
 * 图片目标排除——refEmbedTargetIsImage 与 Reading 块判定同源）。
 * 代码围栏内的字面 `![[…]]` 会被枚举（超集语义：多取无害——页面消费
 * 只在真实嵌入块/占位命中，围栏内文本渲染为代码不会查询）。
 */
export function enumerateEmbedTargets(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    for (const hit of scanEmbedsInLine(line)) {
      if (refEmbedTargetIsImage(hit.inner)) {
        continue
      }
      if (!seen.has(hit.inner)) {
        seen.add(hit.inner)
        out.push(hit.inner)
      }
    }
  }
  return out
}

/** 预取结果（payload 的嵌入数据面） */
export interface PdfExportEmbedPrefetchResult {
  embeds: PdfExportEmbedEntry[]
  mediaEmbeds: PdfExportMediaEmbedEntry[]
  embedFailures: PdfExportEmbedPrefetchFailure[]
}

/**
 * 预取全部嵌入目标（超集）：按枚举顺序逐个读取（同一 inner 只读一次），
 * Markdown 成功进 embeds（全文 + 版本固定），pdf/media/web 进 mediaEmbeds
 * （身份条目——页面降级静态说明 + 真实链接），失败进 embedFailures
 * （页面按块消费时命中才呈现，枚举形态不命中即静默）。
 * 单目标读取异常不中断批次（收敛 reason=internal-read-failed）。
 */
export async function prefetchEmbedTargets(
  text: string,
  port: PdfExportEmbedReadPort,
): Promise<PdfExportEmbedPrefetchResult> {
  const result: PdfExportEmbedPrefetchResult = { embeds: [], mediaEmbeds: [], embedFailures: [] }
  for (const inner of enumerateEmbedTargets(text)) {
    let outcome: Awaited<ReturnType<PdfExportEmbedReadPort['readTarget']>>
    try {
      outcome = await port.readTarget(inner)
    } catch {
      outcome = { ok: false, reason: 'read-failed' }
    }
    if (!outcome.ok) {
      result.embedFailures.push({ inner, reason: outcome.reason })
      continue
    }
    if (outcome.kind === 'markdown') {
      result.embeds.push({
        inner,
        fsPath: outcome.fsPath,
        docName: outcome.docName,
        text: outcome.text,
        version: outcome.version,
      })
      continue
    }
    result.mediaEmbeds.push({
      inner,
      kind: outcome.kind,
      ...(outcome.fsPath !== undefined ? { fsPath: outcome.fsPath } : {}),
      ...(outcome.url !== undefined ? { url: outcome.url } : {}),
    })
  }
  return result
}
