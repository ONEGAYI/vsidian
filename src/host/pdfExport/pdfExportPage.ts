// PDF 导出页骨架装配（T02/#622）：固定输入 payload → 导出页 HTML。
//
// 正文 DOM 不在此装配（宿主侧零 markdown 渲染——T01 的宿主侧 markdown-it
// 简化装配退役；完整 Reading 管线在导出页内跑，见 src/webview/
// pdfExportAssembly.ts）。本模块只装配：
// - 主题与样式：阅读样式快照的 CSS 变量注入（快照缺失时 VSCode 官方默认
//   主题基础值兜底——被真实快照覆盖）、body 主题类、阅读正文字体；
// - 纸张适配：@page（options 同源换算）+ 打印分页友好规则；
// - 片段链：payload.snippets 文本（@page 剥离——T01 防线对片段统一执行）；
// - 装配输入与产物地址：nonce 内联 payload（</script> 防断）+ 产物 script/
//   style 引用 + mermaid 资源 URI。
//
// CSP：script-src self + nonce（payload 内联）；style-src self + inline
//（docStyle 产物为 head 内联 <style>）；img-src 本服务（同源）+ data: +
//  https:（远端直连图源）+ file:（fileLinkOf 的真实本机链接目标是 <a>，
//  img 的 file: 不放——正文图片一律经 /res）；font-src self + https:
//  （片段/文档样式可能引远程字体）；connect-src self；frame/media 禁。

import { randomUUID } from 'node:crypto'
import { cssAtPageRuleOf, type PdfExportOptions } from '../../shared/pdfExportOptions'
import { buildLocaleIslandHtml } from '../../shared/locales/island'
import { LOCALE_MESSAGES } from '../../shared/locales'
import type { PdfExportPagePayload } from '../../shared/pdfExportPayload'
import { stripAtPageRules } from './pdfExportHtml'

/** 主题基础兜底（VSCode 默认亮/暗主题的公开基础值；快照注入在后覆盖） */
const BASE_VARS_LIGHT: Record<string, string> = {
  '--vscode-editor-background': '#ffffff',
  '--vscode-editor-foreground': '#3b3b3b',
  '--vscode-sideBar-background': '#f3f3f3',
  '--vscode-focusBorder': '#0090f1',
}
const BASE_VARS_DARK: Record<string, string> = {
  '--vscode-editor-background': '#1e1e1e',
  '--vscode-editor-foreground': '#cccccc',
  '--vscode-sideBar-background': '#181818',
  '--vscode-focusBorder': '#0078d4',
}

function cssVarBlockOf(vars: Record<string, string>): string {
  return Object.entries(vars)
    .filter(([name, value]) => name.startsWith('--') && typeof value === 'string' && value !== '')
    .map(([name, value]) => `${name}: ${value.replaceAll(';', '\\3b ')};`)
    .join('\n')
}

export interface PdfExportPageAssemblyInput {
  payload: PdfExportPagePayload
  options: PdfExportOptions
  /** 产物脚本地址（同源绝对路径，如 /<token>/pdfExportPage.js） */
  scriptSrc: string
  /** 产物样式地址（同源绝对路径） */
  styleHref: string
}

/** 打印分页友好与导出限定观感（pdfExportPage.css 承载阅读样式复用；此处
 *  仅放骨架级：body 重置、背景、纸张内排版宽、链接可辨识） */
function printAdaptCss(options: PdfExportOptions): string {
  // 纸张内排版宽：@page 边距内铺满（0 = 铺满零干预语义与 #174 一致——
  // 屏幕可读行宽是屏幕布局概念，不照搬到纸张）
  void options
  return `
html, body { margin: 0; padding: 0; }
body {
  background: var(--vscode-editor-background, #ffffff);
  color: var(--vscode-editor-foreground, #1f2328);
}
#app {
  font-family: var(--vsidian-pdf-reading-font, inherit);
}
a { color: inherit; }
h1, h2, h3, h4, h5, h6 { break-after: avoid-page; }
table, pre, figure { break-inside: avoid-page; }
img { max-width: 100%; }
`
}

export function buildPdfExportPageHtml(input: PdfExportPageAssemblyInput): string {
  const { payload, options } = input
  const nonce = randomUUID()
  const varsBlock = [
    cssVarBlockOf(payload.style.dark ? BASE_VARS_DARK : BASE_VARS_LIGHT),
    cssVarBlockOf(payload.style.vars),
    payload.style.reading.fontFamily !== undefined
      ? `--vsidian-pdf-reading-font: ${payload.style.reading.fontFamily.replaceAll(';', '\\3b ')};`
      : '',
  ].filter((block) => block !== '').join('\n')
  const readingFont = [
    payload.style.reading.fontFamily !== undefined ? `font-family: ${payload.style.reading.fontFamily.replaceAll(';', '\\3b ')};` : '',
    payload.style.reading.fontSize !== undefined ? `font-size: ${payload.style.reading.fontSize};` : '',
    payload.style.reading.lineHeight !== undefined ? `line-height: ${payload.style.reading.lineHeight};` : '',
  ].filter((line) => line !== '').join('')
  const snippetCss = payload.snippets
    .map((snippet) => `/* snippet: ${snippet.name} */\n${stripAtPageRules(snippet.css)}`)
    .join('\n')
  // payload JSON 的 < 转义：防 </script> 提前闭合（标准防断裂手段）
  const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c')
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https:",
    "connect-src 'self'",
  ].join('; ')
  const bodyClass = payload.style.dark ? 'vscode-dark' : 'vscode-light'
  return `<!DOCTYPE html>
<html lang="${payload.locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${escapeHtmlText(mainDocNameOf(payload))}</title>
<link href="${input.styleHref}" rel="stylesheet">
<style>
:root {
${varsBlock}
}
</style>
<style>
${cssAtPageRuleOf(options)}
${printAdaptCss(options)}
</style>
${snippetCss !== '' ? `<style>\n${snippetCss}\n</style>` : ''}
</head>
<body class="${bodyClass}">
<div id="app" style="${readingFont}"></div>
${buildLocaleIslandHtml(payload.locale, LOCALE_MESSAGES[payload.locale])}
<script nonce="${nonce}">window.__vsidianPdfExportInput = ${payloadJson};</script>
<script nonce="${nonce}" src="${input.scriptSrc}"></script>
</body>
</html>
`
}

function mainDocNameOf(payload: PdfExportPagePayload): string {
  return payload.docs[0]?.docName ?? 'document'
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
