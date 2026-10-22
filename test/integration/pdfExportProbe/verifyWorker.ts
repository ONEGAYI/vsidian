// #619（V01）PDF 导出探针 · 验证 worker 入口：legacy pdf.worker 以 esbuild
// 单文件 iife 打包（自包含、无外部 import），由宿主读文本传入验证页面经
// Blob URL 装配（与 P3-02 pdfProbe worker 同一装配形态）。
// 仅探针产物；不进 VSIX。
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
