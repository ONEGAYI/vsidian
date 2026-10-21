// PDF 导出预览纯逻辑（T07/#627）：预览目标身份指纹——同源同代次判定的
// 单一事实源。
//
// 预览与最终导出的「同源同代次」（规格 §2.4：过期预览不能被当作当前配置
// 的最终产物；新旧任务以真实代次区分）由指纹承载：指纹 = 归一参数 + 固定
// 输入身份（文档名/权威版本/选区切片签名、批量条目、合并清单序与逐篇
// 版本、每篇另起一页、页眉日期开启时的宿主侧当日日期）的稳定序列化。
//
// 两侧共用同一函数：
// - webview 就地计算「当前设置」的指纹，与就绪预览产物的指纹比较 → 过期
//   徽章（参数、清单、选中条目、输入版本任一变化即失配——宿主侧变化经
//   state 下发的目标身份进入同一比较，不建第二份判定）；
// - 宿主在导出发起时计算指纹，与预览产物指纹严格相等才允许字节复用。
//
// 零依赖（进 webview bundle——不 import node:/DOM API；today 由调用方
// 注入：宿主侧日期权威，webview 用 state 下发的 hostToday，远端时区不使
// 过期判定漂移）。

import { normalizePdfExportOptions } from './pdfExportOptions'

/** 单文档（含选区导出）的固定输入身份 */
export interface PdfPreviewDocIdentity {
  docName: string
  /** 固定时刻权威版本（观测面语义与 job 一致） */
  capturedVersion: number
  /** 选区片段的 [start,end) 切片签名（选区导出在场；全文导出缺省） */
  fragments?: ReadonlyArray<readonly [number, number]>
}

/** 预览目标身份（按导出输入形态分治；merge 的每篇另起一页经 pageBreak
 *  参数进入指纹——它是 webview 本地态，两侧各持本地值参与同一函数） */
export type PdfPreviewTarget =
  | { kind: 'document'; doc: PdfPreviewDocIdentity }
  | { kind: 'batchItem'; fsPath: string; doc: PdfPreviewDocIdentity }
  | { kind: 'merge'; fsPaths: ReadonlyArray<string>; versions: ReadonlyArray<number> }

export interface PdfPreviewFingerprintInput {
  /** 参数（任意形态——内部经 normalizePdfExportOptions 归一，与导出发起同口径） */
  options: unknown
  target: PdfPreviewTarget
  /** 合并模式：每篇另起一页（非合并模式忽略） */
  pageBreak?: boolean
  /** 页眉日期开启时的宿主侧当日日期（YYYY-MM-DD；其他时候忽略） */
  today?: string
}

/** 归一参数 + 固定输入身份 → 稳定指纹（JSON 序列化；字段顺序由实现固定，
 *  与对象字面量顺序无关）。 */
export function pdfPreviewFingerprint(input: PdfPreviewFingerprintInput): string {
  const options = normalizePdfExportOptions(input.options)
  const target = input.target
  const head: unknown[] = [
    options.paper, options.customWidthMm, options.customHeightMm,
    options.orientation, options.marginMm, options.scale,
    options.headerEnabled, options.headerTitle, options.headerDate,
    options.pageNumberEnabled, options.pageNumberPosition,
    options.bookmarksEnabled,
  ]
  // 页眉日期开启时产物印刷当日日期——跨日即为不同代次（复用不得携带旧日期）
  if (options.headerDate && input.today !== undefined) {
    head.push(`date:${input.today}`)
  }
  if (target.kind === 'document') {
    return JSON.stringify(['document', head, target.doc.docName, target.doc.capturedVersion,
      target.doc.fragments ?? null])
  }
  if (target.kind === 'batchItem') {
    return JSON.stringify(['batchItem', head, target.fsPath, target.doc.docName,
      target.doc.capturedVersion, target.doc.fragments ?? null])
  }
  return JSON.stringify(['merge', head, target.fsPaths, target.versions, input.pageBreak === true])
}
