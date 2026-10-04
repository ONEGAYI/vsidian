// PDF.js 主库独立产物入口（#337 / P3-05，装配结论来自 #334 探针）：
// 悬停 PDF 目标时 webview 经动态 <script> 按需装载本产物（mermaid 先例
// ——约 480 KB minified，不进主 bundle 以免每个 webview 启动付出解析
// 成本），装载后 pdfjsLib 挂全局 `__vsidianPdfjs` 供渲染器消费。
//
// - 引擎锁定 pdfjs-dist@6.4.299 legacy 主库（与 legacy worker 同包同版本，
//   Apache-2.0；官方 legacy 支持声明 Chrome 125+，1.82.3 宿主为 Chromium
//   114——差距由构建 banner 注入的两枚 polyfill 补齐（Promise.withResolvers
//   / ReadableStream async iteration，esbuild.mjs 的 pdfBanner），升级
//   pdfjs-dist 必须重跑 test/integration/pdfProbe 回归门禁（#334 结论）；
// - quickjs sandbox 产物不随包——PDF JavaScript 天然拒绝执行（规格边界）。
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = pdfjsLib
