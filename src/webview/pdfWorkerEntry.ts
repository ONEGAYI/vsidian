// PDF.js worker 独立产物入口（#337 / P3-05，#334 探针生产候选形态）：
// legacy pdf.worker 以 esbuild 单文件 iife 打包（自包含、无外部 import
// ——官方 webview worker 指南对 blob/data 装配的要求），运行时经
// 「fetch 文本 → Blob → objectURL」装配（CSP worker-src blob: 放行），
// PDF.js 主库以 new Worker(workerSrc, {type:"module"}) 消费（iife 在
// module 语义下照常执行）。每文档一个 worker，loadingTask.destroy() 后
// 由 PDF.js 终止；**失败装载也持有 worker**——getDocument reject 的 catch
// 里必须显式 destroy（探针实测 13 created / 6 terminated 的泄漏根因）。
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
