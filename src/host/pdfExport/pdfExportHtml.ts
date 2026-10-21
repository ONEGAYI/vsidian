// PDF 导出 CSS @page 剥离（T01/#621 建立，T02/#622 收窄为单一职责）。
//
// T01 的宿主侧 markdown-it 纯装配（renderMarkdownBody/buildPdfExportHtml/
// pdfExportBaseCss）已在 T02 退役——完整阅读正文装配升级为导出页内复用
// webview Reading 管线（src/webview/pdfExportAssembly.ts，规格 §2.3「不建
// 第二套」）；骨架页装配在 pdfExportPage.ts。本模块保留 @page 剥离：
//
// - 纸张适配：@page 与 Page.printToPDF 参数同源（shared/pdfExportOptions
//   的换算函数），两侧永不分歧；用户 CSS 的 @page 一律剥离——V01 §6 实测
//   preferCSSPageSize:false 时 @page 的 landscape 仍渗透输出方向，显式
//   landscape:false 也不能覆盖（方向参数不可达坑），剥离是硬边界。片段
//   文本与文档样式产物统一经此剥离（骨架页装配侧调用）。

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
