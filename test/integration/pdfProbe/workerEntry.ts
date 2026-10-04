// #334（P3-02）PDF 探针 worker 入口：legacy pdf.worker 以 esbuild 单文件
// iife 打包（自包含、无外部 import），运行时经 Blob URL 装配为 module
// worker（PDF.js 主库以 new Worker(workerSrc, {type:"module"}) 消费）。
// 这也是生产候选的 worker 装配形态。
// 仅探针产物；不进 VSIX。
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
