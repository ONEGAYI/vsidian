// PDF 导出打印页装配（T01/#621）：纯 Markdown → 完整导出 HTML。
//
// 职责边界（V01「给 T01 的实施指令」+ 规格 §2.3）：
// - 基础排版：标题/列表/表格/引用/代码的白底黑字打印排版与中文字体栈；
//   完整阅读样式（主题/片段/文档样式）归 T02，本模块的 extraCss 入参是
//   T02 的接线骨架（就位前先经 stripAtPageRules 剥离用户 @page）。
// - 纸张适配：@page 与 Page.printToPDF 参数同源（shared/pdfExportOptions
//   的换算函数），两侧永不分歧；用户 CSS 的 @page 一律剥离——V01 §6 实测
//   preferCSSPageSize:false 时 @page 的 landscape 仍渗透输出方向，显式
//   landscape:false 也不能覆盖（方向参数不可达坑），剥离是硬边界。
// - 就绪位：静态装配页同步置 window.__vsidianPdfExport.asyncReady，完成
//   信号由 browserLauncher 的组合谓词轮询（禁止固定延迟——V01 §5 证伪）。
import MarkdownIt from 'markdown-it'
import { cssAtPageRuleOf, type PdfExportOptions } from '../../shared/pdfExportOptions'

/** 宿主侧 Markdown 渲染器：T01 纯 Markdown 口径（原生 HTML 字面转义——
 *  html:false；完整阅读正文管线归 T02）。表格为 markdown-it 内置 GFM。 */
const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
})

export function renderMarkdownBody(markdown: string): string {
  return md.render(markdown)
}

/** 剥离 CSS 文本中的全部 @page 规则（含 @media 等块内嵌套形态）。
 *
 *  线性扫描 + 花括号配对：字符串（单双引号）与注释内的 @page 不触发；
 *  @page 块体内的嵌套花括号（如 @page { @top-center { … } }）按深度配对
 *  整体删除。删除段连同其前导空白与尾随换行收口，避免残留空行堆积。 */
export function stripAtPageRules(css: string): string {
  let out = ''
  let i = 0
  const n = css.length
  const isIdent = (c: string | undefined): boolean => c !== undefined && /[-\w]/.test(c)
  while (i < n) {
    const c = css[i]!
    // 注释：整体跳过（注释内的 @page 不是生效规则）
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += css.slice(i, stop)
      i = stop
      continue
    }
    // 字符串：原样保留，内部不扫描
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && css[j] !== c) {
        if (css[j] === '\\') j += 1
        j += 1
      }
      out += css.slice(i, Math.min(j + 1, n))
      i = Math.min(j + 1, n)
      continue
    }
    // @page 词边界：前一字符不是标识符字符（避免命中 mypage 之类）
    if (c === '@' && css.startsWith('page', i + 1) && !isIdent(css[i + 5]) && !isIdent(css[i - 1])) {
      // 跳过注释/空白/字符串找到块开 '{'；途中遇到 ';' 或 '}' 视为非块
      // 形态（@page 无此合法形态），放弃本次命中继续扫描
      let j = i + 5
      let foundBrace = false
      while (j < n) {
        const cj = css[j]!
        if (cj === '{') { foundBrace = true; break }
        if (cj === ';' || cj === '}') break
        if (cj === '/' && css[j + 1] === '*') {
          const end = css.indexOf('*/', j + 2)
          j = end === -1 ? n : end + 2
          continue
        }
        j += 1
      }
      if (foundBrace) {
        // 深度配对找块尾（块内字符串/注释同样跳过）
        let depth = 0
        let k = j
        while (k < n) {
          const ck = css[k]!
          if (ck === '/' && css[k + 1] === '*') {
            const end = css.indexOf('*/', k + 2)
            k = end === -1 ? n : end + 2
            continue
          }
          if (ck === '"' || ck === "'") {
            let m = k + 1
            while (m < n && css[m] !== ck) {
              if (css[m] === '\\') m += 1
              m += 1
            }
            k = Math.min(m + 1, n)
            continue
          }
          if (ck === '{') depth += 1
          else if (ck === '}') {
            depth -= 1
            if (depth === 0) { k += 1; break }
          }
          k += 1
        }
        // 删除 [i, k)，同时收口前导空白与尾随换行
        const trimmedOut = out.replace(/[ \t]*$/, '')
        out = trimmedOut
        const restAt = k
        let restStart = restAt
        if (css[restStart] === '\n') restStart += 1
        i = restStart
        continue
      }
    }
    out += c
    i += 1
  }
  return out
}

/** 基础打印排版：白底黑字、中文字体栈、标题/列表/表格/引用/代码。
 *  链接保留蓝色与下划线（打印可辨识）；正文行高与阅读模式观感对齐。 */
export function pdfExportBaseCss(): string {
  return `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1f2328;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  font-size: 14px;
  line-height: 1.7;
}
article { padding: 0; }
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.35;
  margin: 1.4em 0 0.6em;
  break-after: avoid-page;
}
h1 { font-size: 1.9em; margin-top: 0.4em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4, h5, h6 { font-size: 1.05em; }
p { margin: 0.6em 0; }
ul, ol { margin: 0.6em 0; padding-left: 1.8em; }
li { margin: 0.2em 0; }
li > p { margin: 0.2em 0; }
blockquote {
  margin: 0.8em 0;
  padding: 0.1em 1em;
  border-left: 3px solid #d0d7de;
  color: #57606a;
}
blockquote p { margin: 0.4em 0; }
code {
  font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  font-size: 0.92em;
  background: #f6f8fa;
  border-radius: 3px;
  padding: 0.15em 0.35em;
}
pre {
  background: #f6f8fa;
  border: 1px solid #d8dee4;
  border-radius: 6px;
  padding: 0.8em 1em;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}
pre code { background: none; padding: 0; border-radius: 0; }
table {
  border-collapse: collapse;
  margin: 0.9em 0;
  width: 100%;
  font-size: 0.95em;
}
th, td {
  border: 1px solid #d0d7de;
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
thead th { background: #f6f8fa; }
tbody tr:nth-child(2n) { background: #fbfbfc; }
a { color: #0969da; text-decoration: underline; }
img, svg, video { max-width: 100%; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 1.6em 0; }
`
}

export interface PdfExportHtmlInput {
  /** 文档名（标题栏与 <title>；已由调用方取 basename） */
  title: string
  /** 固定输入的 Markdown 正文（LF 坐标） */
  markdown: string
  /** 本次导出参数（@page 与 printToPDF 同源换算） */
  options: PdfExportOptions
  /** 追加样式（T02 阅读样式接线骨架；就位前剥离其中 @page） */
  extraCss?: string
}

/** 完整导出 HTML 装配：@page 纸张适配 + 基础排版 + 正文 + 就绪位。
 *  就绪位 asyncReady 静态置 true（无异步资源的 T01 页面）；fonts 装载由
 *  完成信号谓词轮询 document.fonts.status（V01 §5：已 resolve 的
 *  fonts.ready 不重挂，轮询 status 而非 await）。 */
export function buildPdfExportHtml(input: PdfExportHtmlInput): string {
  const atPage = cssAtPageRuleOf(input.options)
  const extraCss = input.extraCss ? stripAtPageRules(input.extraCss) : ''
  const body = renderMarkdownBody(input.markdown)
  const escapeTitle = input.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeTitle}</title>
<style>
${atPage}
${pdfExportBaseCss()}
${extraCss}
</style>
<script>window.__vsidianPdfExport = { asyncReady: true };</script>
</head>
<body>
<article id="vsidian-pdf-doc">
${body}
</article>
</body>
</html>
`
}
