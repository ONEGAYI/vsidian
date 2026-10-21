// #619（V01）PDF 导出探针 · 样本 HTML 构造（纯函数，宿主侧）。
// 覆盖票面要求的样本面：中文标题、多页正文、CSS 样式、本地文件图片、
// 嵌入 data URL 图片、异步图形（setTimeout 延迟注入 SVG + 延迟文本标记）、
// 慢字体（大号系统 ttc 经 @font-face file:// 引用，拉开 fonts.ready 与
// loadEventFired 的时间差）、排版矩阵与书签样本。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

const SENTENCES = [
  '工欲善其事，必先利其器；导出链路的第一原则是产物可验证。',
  '阅读模式的排版语义在纸张上重新分页，段落顺序不得因分页而改变。',
  '资源完成信号必须来自页面自身的就绪状态，而非任何固定延迟的猜测。',
  '双链、图片与图形在同一文档内共存时，各自失败互不拖累整体导出。',
  '页眉页脚与正文边距由同一组纸张参数决定，预览与最终导出共用一条路径。',
]

/** 多页正文段落：pageTag 每 6 段插入一个中段/末段标记标题。 */
function bodyParagraphs(count: number): string {
  const parts: string[] = []
  for (let i = 1; i <= count; i++) {
    const sentence = SENTENCES[i % SENTENCES.length]
    parts.push(`<p>第 ${i} 段：${sentence}</p>`)
    if (i === Math.floor(count / 2)) {
      parts.push('<h2 id="sec-mid" data-vsidian-heading="2">中段小节标题（探针）</h2>')
    }
  }
  parts.push('<h2 id="sec-end" data-vsidian-heading="2">末段小节标题（探针）</h2>')
  parts.push('<p>完整样本末段标记：此处正文应出现在最后一页。</p>')
  return parts.join('\n')
}

export interface FullDocOptions {
  /** 本地图片的 file:// 绝对 URI（宿主写入临时目录的 PNG）。 */
  localImageFileUri: string
  /** 内嵌 data URL 图片。 */
  inlineImageDataUrl: string
  /** 段落数（决定页数）。 */
  paragraphCount?: number
  /** 延迟注入图形的毫秒数。 */
  lateDelayMs?: number
}

/** 完整样本：中文标题 + 多页正文 + CSS + 两类图片 + 延迟注入 SVG。 */
export function fullDocHtml(options: FullDocOptions): string {
  const paragraphs = options.paragraphCount ?? 30
  const lateDelayMs = options.lateDelayMs ?? 1200
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>完整样本</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; background: #f5f0e8; color: #222222; margin: 0; }
  h1 { color: #7c3aed; border-bottom: 3px solid #7c3aed; padding-bottom: 6px; }
  h2 { color: #0e7490; }
  .accent-box { border: 2px solid #0e7490; background: #cffafe; padding: 10px; margin: 12px 0; }
  img.probe-img { width: 120px; height: 90px; }
</style></head>
<body>
<h1 data-vsidian-heading="1">完整样本 · 导出探针首段标题</h1>
<p>首段正文：本页同时包含背景色、标题色、边框样式块与两张图片。</p>
<div class="accent-box">CSS 样式块：边框与背景（printBackground 关闭时背景不应出现）。</div>
<p>本地文件图片（file://）：<img class="probe-img" src="${options.localImageFileUri}" alt="本地图片"></p>
<p>内嵌 data URL 图片：<img class="probe-img" src="${options.inlineImageDataUrl}" alt="内嵌图片"></p>
<div id="late-graphics"><p id="late-placeholder">延迟图形占位：打印过早时这里没有图形。</p></div>
${bodyParagraphs(paragraphs)}
<script>
  window.__probe = { asyncReady: false, fontsReady: false }
  document.fonts.ready.then(() => { window.__probe.fontsReady = true })
  setTimeout(() => {
    document.getElementById('late-graphics').innerHTML =
      '<svg width="220" height="90" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="45" cy="45" r="32" fill="#f59e0b"/><rect x="95" y="12" width="80" height="66" fill="#2563eb"/></svg>' +
      '<p>迟到的文本标记 LATE-TEXT-MARKER-延迟注入完成</p>'
    window.__probe.asyncReady = true
  }, ${lateDelayMs})
</script>
</body></html>`
}

export interface CompletionSignalOptions {
  /** 慢字体 file:// URI（大号系统 ttc，加载耗时拉开与 load 的差距）。 */
  slowFontFileUri: string
  /** 延迟注入的毫秒数（固定延迟组用同一页面保证可比）。 */
  lateDelayMs?: number
  /** 延迟注入的第二张图（data URL）。 */
  lateImageDataUrl: string
}

/** 完成信号反证样本：页面自记时间线，宿主侧按三种策略打印对比。 */
export function completionSignalDocHtml(options: CompletionSignalOptions): string {
  const lateDelayMs = options.lateDelayMs ?? 1200
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>完成信号样本</title>
<style>
  @font-face { font-family: 'ProbeSlowFont'; src: url('${options.slowFontFileUri}'); }
  body { font-family: sans-serif; margin: 0; }
  .slow-font { font-family: 'ProbeSlowFont'; font-size: 26px; }
</style></head>
<body>
<h1>完成信号样本标题</h1>
<p>静态首段：本段在 load 之前就绪。</p>
<div id="late"></div>
<script>
  window.__probe = { loadEventAt: null, fontsInitialReadyAt: null, fontsAfterInjectionReadyAt: null,
                    svgInjectedAt: null, lateImgCompleteAt: null, fontsReady: false, asyncReady: false }
  window.addEventListener('load', () => { window.__probe.loadEventAt = performance.now() })
  // 首次 fonts.ready：记录初始字体集的就绪点（无 pending 字体时立即 resolve）
  document.fonts.ready.then(() => { window.__probe.fontsInitialReadyAt = performance.now() })
  setTimeout(() => {
    const host = document.getElementById('late')
    host.innerHTML = '<p class="slow-font">慢字体迟到的句子 LATE-SLOW-FONT-TEXT</p>' +
      '<svg width="180" height="70" xmlns="http://www.w3.org/2000/svg"><circle cx="35" cy="35" r="26" fill="#dc2626"/></svg>' +
      '<img id="late-img" src="${options.lateImageDataUrl}" width="90">'
    window.__probe.svgInjectedAt = performance.now()
    // 慢字体由 .slow-font 元素触发加载；此时重新 await fonts.ready，
    // 该 promise 在新 pending 字体完成后才 settle（记录二次就绪点）
    document.fonts.ready.then(() => {
      window.__probe.fontsAfterInjectionReadyAt = performance.now()
      window.__probe.fontsReady = true
    })
    const img = document.getElementById('late-img')
    const done = () => {
      if (img.complete && img.naturalWidth > 0) {
        window.__probe.lateImgCompleteAt = performance.now()
        window.__probe.asyncReady = true
      }
    }
    if (img.complete) done(); else img.addEventListener('load', done, { once: true })
  }, ${lateDelayMs})
</script>
</body></html>`
}

/** 排版矩阵基础页：一段文本 + 可选背景与 @page 尺寸声明。 */
export function layoutBasicHtml(withAtPageSize: boolean, withBackground: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>版式测量</title>
<style>
  ${withAtPageSize ? '@page { size: A5 landscape; margin: 0; }' : ''}
  body { font-family: sans-serif; ${withBackground ? 'background: #2563eb;' : ''} color: #111111; margin: 0; font-size: 14px; }
</style></head>
<body>
<p id="first">版式测量首行 LAYOUT-FIRST-LINE 版式测量中文文本</p>
<p>第二行：用于文本位置测量的辅助行。</p>
</body></html>`
}

/** 页眉页脚样本：多页正文（每页数段，保证至少 3 页）。 */
export function headerFooterDocHtml(): string {
  const pages: string[] = []
  for (let p = 1; p <= 3; p++) {
    const section = p > 1 ? '<div style="break-before: page"></div>' : ''
    pages.push(`${section}<h2>页眉页脚样本第 ${p} 节</h2>${Array.from({ length: 12 }, (_, i) => `<p>第 ${p} 节第 ${i + 1} 段：正文填充用于跨页。</p>`).join('\n')}`)
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>页眉页脚样本</title>
<style> body { font-family: sans-serif; margin: 0; font-size: 13px; } </style></head>
<body>${pages.join('\n')}</body></html>`
}

/** 书签样本：根标题第 1 页，两个小节强制分页到第 2、3 页。 */
export function bookmarksDocHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>书签样本</title>
<style> body { font-family: sans-serif; margin: 0; font-size: 13px; } .page-break { break-before: page; } </style></head>
<body>
<h1 data-vsidian-heading="1">书签样本根标题</h1>
<p>第一页正文：标题页码定位方案验证。</p>
<h2 class="page-break" data-vsidian-heading="2">第二页小节甲</h2>
<p>第二页正文：分页由 break-before 强制。</p>
<h2 class="page-break" data-vsidian-heading="2">第三页小节乙</h2>
<p>第三页正文：末页标题与正文。</p>
</body></html>`
}

/** 最小样本：单页中文标题 + 一段正文。 */
export function minimalDocHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>最小样本</title>
<style> body { font-family: "Microsoft YaHei", sans-serif; margin: 24px; } h1 { color: #7c3aed; } </style></head>
<body>
<h1>V01 最小验证标题</h1>
<p>最小中文正文一段：探针须在最低真实宿主内生成并通过文本提取命中本句。</p>
</body></html>`
}
