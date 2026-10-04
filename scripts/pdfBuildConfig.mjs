// PDF.js 双产物构建配置的单一事实源（#337 装配，#346 修复轮 2 提取共享）：
// esbuild.mjs 主构建与 test/browser 的 ensurePdfArtifacts 消费同一工厂——
// 相同 outfile 的配置逐字段一致（buildBroker 以完整序列化配置为 key 防后写
// 覆盖，任一侧单独改配置即漂移冲突）。banner/iife/chrome114 语义见
// esbuild.mjs 头注释（Promise.withResolvers 与 ReadableStream async iteration
// 双 polyfill；iife 产物经动态 <script> 装载、worker 经 Blob URL 装配——页面
// 装载行为依赖这些字段，提取时不得裁剪）。
import path from 'node:path'

/** #337 Chromium 114 双 polyfill（#334 探针结论，主线程与 worker 全局
 *  作用域独立、两侧同注；存在性检测——更高 Chromium 下自动跳过）：
 *  - Promise.withResolvers（Chromium 119+；缺它 pdfjs 6.x 顶层即抛）
 *  - ReadableStream async iteration（Chromium 124+；缺它 getTextContent
 *    抛 TypeError，文本层完全不可用——P3-07 前置） */
export const pdfBanner = {
  js: `if (typeof Promise.withResolvers !== "function") { Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; } }if (!ReadableStream.prototype[Symbol.asyncIterator]) { ReadableStream.prototype[Symbol.asyncIterator] = async function* () { const reader = this.getReader(); try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } } finally { reader.releaseLock(); } }; }`,
}

/** PDF 双产物 target 配置（绝对路径形态，浏览器测试与主构建共用）：
 *  - pdfMain：pdfjs-dist legacy 主库，pdfjsLib 挂全局，动态 <script> 装载
 *  - pdfWorker：legacy worker 单文件 iife，Blob URL 装配 */
export function pdfBuildTargets(root, { production = false } = {}) {
  const pdfCommon = {
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome114',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    banner: pdfBanner,
  }
  return [
    {
      entryPoints: [path.join(root, 'src/webview/pdfMainEntry.ts')],
      outfile: path.join(root, 'out/webview/pdfMain.js'),
      ...pdfCommon,
    },
    {
      entryPoints: [path.join(root, 'src/webview/pdfWorkerEntry.ts')],
      outfile: path.join(root, 'out/webview/pdfWorker.js'),
      ...pdfCommon,
    },
  ]
}
