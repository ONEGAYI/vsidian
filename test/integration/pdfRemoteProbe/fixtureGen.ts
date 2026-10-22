// #620（V02）Remote SSH 探针 · fixture 生成（由 build.mjs 以 node 运行）。
// 产出：sample.md（远端读取的 Markdown 正文）与 probe-img.png（16x16 纯色
// 真彩 PNG，复用 V01 的零依赖 PNG 构造）。探针代码，不定义产品行为。

import { writeFileSync } from 'node:fs'
import { makeSolidPng } from '../pdfExportProbe/pngBytes'

const outDir = process.argv[2]
if (!outDir) throw new Error('用法：node fixtureGen.js <fixtureDir>')

writeFileSync(`${outDir}/sample.md`, [
  '# 远端文档标题',
  '',
  '远端到本机闭环测试文档：本文件与下方图片由 vscode-server 侧（workspace 扩展视角）读取，',
  '经跨扩展宿主命令送达本机执行端，由本机已安装浏览器生成 PDF 并落盘本机。',
  '',
  '![探针图片](probe-img.png)',
  '',
].join('\n'), 'utf8')
writeFileSync(`${outDir}/probe-img.png`, makeSolidPng(16, 16, 30, 100, 220))
console.log(`[fixtureGen] fixture 就绪：${outDir}`)
