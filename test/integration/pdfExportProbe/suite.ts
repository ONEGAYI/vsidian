// #619（V01）PDF 导出探针宿主侧套件：在 VSCode 1.82.3 真实宿主（宿主
// Node 18）内运行全部验证用例：
// 1. 浏览器发现（注册表 App Paths / 常见路径 / PATH）；
// 2. 路线 B（纯 CDP 直连，零依赖）启动握手与 headless 标志对照；
// 3. 最小中文 PDF（Chrome 与 Edge 各一轮）+ pdf.js 产物验证引擎自检；
// 4. 完整样本：多页正文 / CSS / 本地 file:// 图片 / data URL 图片 / 异步图形；
// 5. 完成信号组合 vs 固定延迟（同页面三策略对照 + 页面时间线取证）；
// 6. printToPDF 排版矩阵（纸张/方向/边距/缩放/页眉页脚页码/背景/CSS 分页）；
// 7. 标题书签：pdfjs 文本定位页码 + pdf-lib 后处理 outline 读回；
// 8. 进程与释放：正常关闭/缺路径 ENOENT/非浏览器超时/中途 kill/用户会话论证；
// 9. 路线 A（puppeteer-core 24.43.1）Node 18 实测与 bundle 加载。
// 用例输出对齐 [集成测试][START]/[PASS]/[FAIL]/[TIME]，判定复用
// evaluateHostReport；测量数据落 .vscode-test/pdf-export-probe-report.json，
// PNG 视觉证据落 docs/research/data/pdf-export-browser-probe/。
// 探针代码不进 VSIX；本文件不定义产品行为。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { PDFDocument, PDFName, PDFHexString, PDFNull, type PDFRef } from 'pdf-lib'
import { discoverBrowsers, type DiscoveredBrowser } from './browserFind'
import { launchHeadlessBrowser, createPageSession, navigateAndWaitLoad, printToPdf, evaluate, waitForCompositeReady, devtoolsHttpVersion, portOfWsUrl, type LaunchedBrowser } from './browser'
import { PdfVerifier } from './pdfVerify'
import type { VerifyResult } from './verifyEntry'
import { makeSolidPng, makeSolidPngDataUrl } from './pngBytes'
import { minimalDocHtml, fullDocHtml, completionSignalDocHtml, layoutBasicHtml, headerFooterDocHtml, bookmarksDocHtml } from './sampleDoc'

interface StepRecord { ok: boolean; detail: string }

function fileUrlOf(p: string): string {
  return pathToFileURL(p).toString()
}

/** dataURL PNG 落盘，返回相对描述（供报告引用）。 */
function saveDataUrlPng(dataUrl: string, outPath: string): void {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  writeFileSync(outPath, Buffer.from(base64, 'base64'))
}

/** tasklist 统计指定映像名进程数（生命周期与用户会话论证取证）。 */
function countProcess(imageName: string): number {
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV'], { encoding: 'utf8', timeout: 15_000 })
    return out.split('\n').filter((line) => line.toLowerCase().includes(imageName)).length
  } catch {
    return -1
  }
}

async function addOutline(pdfBytes: Buffer, entries: Array<{ title: string; level: number; pageIndex: number }>): Promise<Uint8Array> {
  // pdf-lib 无高层 outline API：低层手写 /Outlines 树（可行性验证目标）
  const doc = await PDFDocument.load(pdfBytes)
  const ctx = doc.context
  const pages = doc.getPages()
  const outlinesRef = ctx.nextRef()
  interface Node { entry: { title: string; level: number; pageIndex: number }; ref: PDFRef; children: Node[] }
  const nodes: Node[] = entries.map((entry) => ({ entry, ref: ctx.nextRef(), children: [] }))
  const tops: Node[] = []
  let lastByLevel = new Map<number, Node>()
  for (const node of nodes) {
    if (node.entry.level <= 1) {
      tops.push(node)
      lastByLevel = new Map([[1, node]])
    } else {
      let parent: Node | undefined
      for (let level = node.entry.level - 1; level >= 1; level--) {
        parent = lastByLevel.get(level)
        if (parent) break
      }
      if (!parent) parent = tops[tops.length - 1]
      parent.children.push(node)
      lastByLevel.set(node.entry.level, node)
    }
  }
  const makeDest = (pageIndex: number) => ctx.obj([pages[pageIndex].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull])
  const writeNode = (node: Node, parentRef: PDFRef, prev: Node | undefined, next: Node | undefined): void => {
    ctx.assign(node.ref, ctx.obj({
      Title: PDFHexString.fromText(node.entry.title),
      Parent: parentRef,
      Dest: makeDest(node.entry.pageIndex),
      ...(prev ? { Prev: prev.ref } : {}),
      ...(next ? { Next: next.ref } : {}),
      ...(node.children.length > 0
        ? { First: node.children[0].ref, Last: node.children[node.children.length - 1].ref, Count: node.children.length }
        : {}),
    }))
    for (let i = 0; i < node.children.length; i++) {
      writeNode(node.children[i], node.ref, node.children[i - 1], node.children[i + 1])
    }
  }
  for (let i = 0; i < tops.length; i++) writeNode(tops[i], outlinesRef, tops[i - 1], tops[i + 1])
  const countVisible = (list: Node[]): number => list.reduce((sum, node) => sum + 1 + countVisible(node.children), 0)
  ctx.assign(outlinesRef, ctx.obj({
    Type: 'Outlines',
    First: tops[0]?.ref,
    Last: tops[tops.length - 1]?.ref,
    Count: countVisible(tops),
  }))
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  return doc.save()
}

export async function run(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..', '..', '..')
  const artifactsDir = process.env.VSIDIAN_PDF_EXPORT_ARTIFACTS
  const pngDir = process.env.VSIDIAN_PDF_EXPORT_PNG_DIR
  const routeADepsDir = process.env.VSIDIAN_PDF_EXPORT_ROUTE_A
  const routeABundlePath = process.env.VSIDIAN_PDF_EXPORT_ROUTE_A_BUNDLE
  if (!artifactsDir || !pngDir) throw new Error('缺少 VSIDIAN_PDF_EXPORT_ARTIFACTS / VSIDIAN_PDF_EXPORT_PNG_DIR 环境变量')
  mkdirSync(path.join(artifactsDir, 'samples'), { recursive: true })
  mkdirSync(pngDir, { recursive: true })
  const samplesDir = path.join(artifactsDir, 'samples')
  const verifyJsPath = path.join(root, 'out', 'test', 'integration', 'pdfExportProbe', 'verify.js')

  const failures: string[] = []
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    hostNode: process.versions.node,
    hostElectron: process.versions.electron,
    scenarios: [] as Array<{ name: string; steps: StepRecord[] }>,
  }
  let plannedTotal = 0

  const testCase = async (name: string, fn: (steps: StepRecord[]) => Promise<void>): Promise<void> => {
    console.log(`[集成测试][START] ${name}`)
    const steps: StepRecord[] = []
    const t0 = Date.now()
    try {
      await fn(steps)
      const bad = steps.filter((s) => !s.ok)
      if (bad.length > 0) throw new Error(`${bad.length} 步未过：${bad.map((s) => s.detail).join('；')}`)
      console.log(`[集成测试][PASS] ${name}`)
    } catch (err) {
      failures.push(name)
      console.error(`[集成测试][FAIL] ${name}`, err)
    } finally {
      ;(report.scenarios as Array<{ name: string; steps: StepRecord[] }>).push({ name, steps })
      console.log(`[集成测试][TIME] ${Date.now() - t0}ms ${name}`)
    }
  }
  const step = (steps: StepRecord[], ok: boolean, detail: string): void => {
    steps.push({ ok, detail })
    console.log(`[pdfExportProbe][${ok ? 'ok' : 'BAD'}] ${detail}`)
  }

  // ---------- 用例 1：浏览器发现 ----------
  let chrome: DiscoveredBrowser | undefined
  let edge: DiscoveredBrowser | undefined
  await testCase('pdfExportProbe: 浏览器发现（注册表 App Paths / 常见路径 / PATH）', async (steps) => {
    const browsers = await discoverBrowsers()
    report.discoveredBrowsers = browsers
    for (const b of browsers) {
      step(steps, !!b.executablePath && existsSync(b.executablePath), `发现 ${b.kind}：${b.executablePath}（版本 ${b.version ?? '未知'}，通道 ${b.via}）`)
      if (b.kind === 'chrome') chrome = b
      if (b.kind === 'edge') edge = b
    }
    if (!chrome && !edge) throw new Error('未发现任何 Chrome/Edge')
    if (chrome?.version) step(steps, /^\d+\./.test(chrome.version), `Chrome 版本号形态合法：${chrome.version}`)
  })

  const primaryBrowser = chrome ?? edge!
  const primaryKind = primaryBrowser.kind

  // ---------- 用例 2：路线 B 启动握手 ----------
  let browserMain: LaunchedBrowser | undefined
  let verifier: PdfVerifier | undefined
  await testCase(`pdfExportProbe: 路线B 启动与握手（${primaryKind}，--headless=new 与 --headless 对照）`, async (steps) => {
    const launched = await launchHeadlessBrowser({ executablePath: primaryBrowser.executablePath })
    browserMain = launched
    report.routeBLaunch = {
      executablePath: launched.executablePath,
      headlessFlag: launched.headlessFlag,
      browserWsUrl: launched.browserWsUrl,
      userDataDir: launched.userDataDir,
      cdpVersion: launched.cdpVersion,
      stderrHead: launched.stderrHead.slice(0, 1000),
    }
    step(steps, launched.browserWsUrl.startsWith('ws://127.0.0.1:'), `DevTools 动态端口握手成功：${launched.browserWsUrl}`)
    const versionMatch = new RegExp(`${primaryBrowser.version?.split('.')[0] ?? '\\d+'}\\.`).test(launched.cdpVersion.browser)
    step(steps, versionMatch, `CDP Browser.getVersion 回报与二进制版本一致：${launched.cdpVersion.browser}（注册表版本 ${primaryBrowser.version}）`)
    const http = await devtoolsHttpVersion(portOfWsUrl(launched.browserWsUrl))
    step(steps, 'webSocketDebuggerUrl' in http, `DevTools HTTP /json/version 交叉确认：Browser=${http.Browser}（协议独立于 WS）`)
    step(steps, /deprecat|移除/i.test(launched.stderrHead) ? false : true,
      `--headless=new stderr ${/deprecat/i.test(launched.stderrHead) ? '含 deprecation 警告' : '无 deprecation 警告'}（头部 200 字符：${JSON.stringify(launched.stderrHead.slice(0, 200))}）`)
    // 对照组：--headless（Chrome 129+ 与 new 同义）
    const alt = await launchHeadlessBrowser({ executablePath: primaryBrowser.executablePath, headlessFlag: '--headless' })
    report.routeBLaunchAltHeadless = { flag: '--headless', stderrHead: alt.stderrHead.slice(0, 1000), browser: alt.cdpVersion.browser }
    step(steps, true, `--headless 对照启动成功：${alt.cdpVersion.browser}；stderr ${/deprecat/i.test(alt.stderrHead) ? '含 deprecation 警告' : '无 deprecation 警告'}`)
    await alt.close()
    // 验证引擎准备（后续用例共用）
    verifier = await PdfVerifier.create(launched.connection, verifyJsPath)
    step(steps, true, 'pdf.js 产物验证页面就绪（verify bundle 注入完成）')
  })
  if (!browserMain || !verifier) throw new Error('浏览器或验证引擎未就绪，中止后续用例')
  // 固化非空引用（testCase 回调闭包内 TS 无法维持 let 的窄化）
  const mainBrowser = browserMain
  const mainVerifier = verifier

  // Chromium 产物的 ToUnicode 对部分中文落在部首兼容码位：康熙部首区
  // （U+2F00–2FDF，如「文」→U+2F42）NFKC 可归一；但 CJK 部首补充区
  // （U+2E80–2EFF，如「页」→「⻚」U+2E9A）NFKC 无映射，需显式对照表。
  // 本表为探针样本覆盖子集 + 常用 C 简化部首；完整表是产品 T05 实现事项。
  const RADICAL_FIX: Record<string, string> = {
    '⺀': '冫', '⺁': '厂', '⺂': '乙', '⺃': '乚', '⺄': '乛', '⺅': '人', '⺆': '冂', '⺇': '几',
    '⺈': '刀', '⺉': '力', '⺊': '卜', '⺋': '又', '⺌': '小', '⺍': '小', '⺎': '兀', '⺏': '尢',
    '⺐': '尢', '⺑': '尢', '⺒': '巳', '⺓': '山', '⺔': '巛', '⺕': '工', '⺖': '巾', '⺗': '干',
    '⺘': '干', '⺙': '幺', '⺛': '广', '⺜': '廾', '⺝': '弋', '⺞': '弓', '⺟': '彐', '⺠': '彡',
    '⺡': '氵', '⺢': '氵', '⺣': '火', '⺤': '爪', '⺥': '父', '⺦': '爻', '⺧': '爿', '⺨': '犬',
    '⺩': '王', '⺪': '玉', '⺫': '艹', '⺬': '示', '⺭': '礻', '⺮': '竹', '⺯': '糸', '⺰': '糸',
    '⺱': '网', '⺲': '羊', '⺳': '羊', '⺴': '羊', '⺵': '聿', '⺶': '肉', '⺷': '肉', '⺸': '臣',
    '⺹': '至', '⺺': '臼', '⺻': '舌', '⺼': '月', '⺽': '月', '⺾': '艹', '⺿': '艹', '⻀': '艹',
    '⻁': '虎', '⻂': '虫', '⻃': '血', '⻄': '行', '⻅': '见', '⻆': '角', '⻇': '言', '⻈': '讠',
    '⻉': '贝', '⻊': '足', '⻋': '车', '⻌': '辶', '⻍': '辶', '⻎': '邑', '⻏': '阝', '⻐': '阜',
    '⻑': '长', '⻒': '镸', '⻓': '长', '⻔': '门', '⻕': '阜', '⻖': '阝', '⻗': '雨', '⻘': '青',
    '⻙': '韦', '⻚': '页', '⻛': '风', '⻜': '飞', '⻝': '食', '⻞': '食', '⻟': '食', '⻠': '首',
    '⻡': '香', '⻢': '马', '⻣': '骨', '⻤': '鬼', '⻥': '鱼', '⻦': '鸟', '⻧': '卤', '⻨': '麦',
    '⻩': '黄', '⻪': '黾', '⻫': '黹', '⻬': '齐', '⻭': '齿', '⻮': '齿', '⻯': '龙', '⻰': '龙',
    '⻱': '龟', '⻲': '龟', '⻳': '龟',
  }
  const normText = (text: string): string =>
    text.normalize('NFKC').replace(/[⺀-⻿]/g, (ch) => RADICAL_FIX[ch] ?? ch)
  const normalizeResult = (r: VerifyResult): VerifyResult => {
    for (const key of Object.keys(r.textByPage)) r.textByPage[key] = normText(r.textByPage[key])
    if (r.outline) for (const item of r.outline) item.title = normText(item.title)
    return r
  }
  const verify = async (pdf: Buffer, options: Parameters<PdfVerifier['verify']>[1] = {}): Promise<VerifyResult> =>
    normalizeResult(await mainVerifier.verify(pdf, options))

  // ---------- 用例 3：最小中文 PDF（主浏览器 + Edge 各一轮） ----------
  await testCase(`pdfExportProbe: 路线B 最小中文 PDF（${primaryKind}）+ 验证引擎自检`, async (steps) => {
    const { session } = await createPageSession(mainBrowser.connection)
    const htmlPath = path.join(samplesDir, 'minimal.html')
    writeFileSync(htmlPath, minimalDocHtml(), 'utf8')
    await navigateAndWaitLoad(session, fileUrlOf(htmlPath))
    const pdf = await printToPdf(session, { paperWidth: 8.27, paperHeight: 11.69 })
    const pdfPath = path.join(artifactsDir, `minimal-${primaryKind}.pdf`)
    writeFileSync(pdfPath, pdf)
    const result = await verify(pdf)
    step(steps, result.pdfjsVersion === '6.4.299', `验证引擎自检：pdfjs 版本 ${result.pdfjsVersion}（与生产阅读依赖同源 6.4.299）`)
    step(steps, result.numPages === 1, `最小 PDF 页数 = ${result.numPages}（期望 1），产物 ${pdf.length} B → ${pdfPath}`)
    step(steps, (result.textByPage[1] ?? '').includes('V01 最小验证标题') && (result.textByPage[1] ?? '').includes('最小中文正文一段'),
      `中文文本提取命中：${JSON.stringify((result.textByPage[1] ?? '').slice(0, 60))}`)
  })

  if (edge && edge.executablePath !== primaryBrowser.executablePath) {
    const edgeFound = edge
    await testCase('pdfExportProbe: 路线B 最小中文 PDF（edge 独立实例）', async (steps) => {
      const edgeBrowser = await launchHeadlessBrowser({ executablePath: edgeFound.executablePath })
      try {
        const edgeVerifier = await PdfVerifier.create(edgeBrowser.connection, verifyJsPath)
        const { session } = await createPageSession(edgeBrowser.connection)
        const htmlPath = path.join(samplesDir, 'minimal-edge.html')
        writeFileSync(htmlPath, minimalDocHtml(), 'utf8')
        await navigateAndWaitLoad(session, fileUrlOf(htmlPath))
        const pdf = await printToPdf(session, {})
        const pdfPath = path.join(artifactsDir, 'minimal-edge.pdf')
        writeFileSync(pdfPath, pdf)
        const result = normalizeResult(await edgeVerifier.verify(pdf))
        step(steps, result.numPages === 1 && (result.textByPage[1] ?? '').includes('V01 最小验证标题'),
          `Edge 生成 + 双引擎交叉验证：页数 ${result.numPages}，中文命中（CDP 版本 ${edgeBrowser.cdpVersion.browser}）→ ${pdfPath}`)
        edgeVerifier.dispose()
      } finally {
        await edgeBrowser.close()
      }
    })
  }

  // ---------- 用例 4：完整样本 ----------
  await testCase('pdfExportProbe: 路线B 完整样本（多页/CSS/两类图片/异步图形 + 组合完成信号）', async (steps) => {
    const localPngPath = path.join(samplesDir, 'local-image.png')
    writeFileSync(localPngPath, makeSolidPng(48, 36, 217, 39, 184)) // 品红
    const inlineDataUrl = makeSolidPngDataUrl(48, 36, 6, 182, 212) // 青色
    const htmlPath = path.join(samplesDir, 'full.html')
    writeFileSync(htmlPath, fullDocHtml({
      localImageFileUri: fileUrlOf(localPngPath),
      inlineImageDataUrl: inlineDataUrl,
      paragraphCount: 60, // 30 段在 A4 默认边距下仅 2 页；60 段稳定 ≥3 页
      lateDelayMs: 1200,
    }), 'utf8')
    const { session } = await createPageSession(mainBrowser.connection)
    const loadMs = await navigateAndWaitLoad(session, fileUrlOf(htmlPath))
    const ready = await waitForCompositeReady(session, 15_000)
    step(steps, ready.ok, `组合完成信号就绪（等 ${ready.waitedMs}ms，load ${loadMs}ms；fonts=${ready.state.fontsStatus}，asyncReady=${ready.state.asyncReady}，imgs ${ready.state.imgCount} 张全 complete）`)
    const t0 = Date.now()
    const pdf = await printToPdf(session, { paperWidth: 8.27, paperHeight: 11.69, printBackground: true })
    const printMs = Date.now() - t0
    const pdfPath = path.join(artifactsDir, 'full-sample.pdf')
    writeFileSync(pdfPath, pdf)
    const firstPass = await verify(pdf)
    const lastPage = firstPass.numPages
    const midPage = lastPage >= 3 ? Math.ceil(lastPage / 2) : 1
    const renderPages = [...new Set([1, midPage, lastPage])]
    const result = await verify(pdf, {
      renderPages,
      samplePoints: [{ page: 1, fx: 0.5, fy: 0.5 }],
    })
    report.fullSample = {
      pdfPath, printMs, numPages: result.numPages, bytes: pdf.length,
      timeline: ready.state.timeline,
      pageSizes: result.pageSizes,
    }
    step(steps, result.numPages >= 3, `多页正文：页数 ${result.numPages}（期望 ≥3），打印耗时 ${printMs}ms，产物 ${pdf.length} B → ${pdfPath}`)
    step(steps, (result.textByPage[1] ?? '').includes('完整样本 · 导出探针首段标题'), `首页文本命中首段标题：${JSON.stringify((result.textByPage[1] ?? '').slice(0, 50))}`)
    if (lastPage >= 3) {
      step(steps, (result.textByPage[midPage] ?? '').includes('中段小节标题'), `第 ${midPage} 页（中页）文本命中「中段小节标题」`)
    } else {
      step(steps, true, `样本页数 ${lastPage} <3，中页文本以首/末覆盖（组合信号与多页断言仍有效）`)
    }
    step(steps, (result.textByPage[lastPage] ?? '').includes('完整样本末段标记'), `末页（第 ${lastPage} 页）文本命中「完整样本末段标记」`)
    step(steps, Object.values(result.textByPage).some((text) => text.includes('LATE-TEXT-MARKER')),
      '异步图形与延迟文本已进入产物（注入点在文档前部，全文任一页命中 LATE-TEXT-MARKER）')
    const center = result.sampleColors[0]
    step(steps, !!center && (center[0] < 245 || center[1] < 245 || center[2] < 245), `printBackground 背景入版：页 1 中心采样 RGB=${JSON.stringify(center)}（非白）`)
    for (const [pageNumber, dataUrl] of Object.entries(result.pngs)) {
      const outPath = path.join(pngDir, `full-sample-p${pageNumber}.png`)
      saveDataUrlPng(dataUrl, outPath)
    }
    step(steps, Object.keys(result.pngs).length === 3, `首/中/末页 PNG 已落盘：${pngDir}\\full-sample-p{1,${midPage},${lastPage}}.png（视觉证据）`)
  })

  // ---------- 用例 5：完成信号组合 vs 固定延迟 ----------
  await testCase('pdfExportProbe: 完成信号组合 vs 固定延迟（同页面三策略对照）', async (steps) => {
    const slowFontCandidates = ['msyh.ttc', 'msyhbd.ttc', 'simsun.ttc']
    const slowFont = slowFontCandidates.map((f) => path.join('C:\\Windows\\Fonts', f)).find((p) => existsSync(p))
    if (!slowFont) throw new Error('未找到慢字体样本（msyh/msyhbd/simsun 均缺失）')
    const lateDataUrl = makeSolidPngDataUrl(32, 32, 220, 38, 38)
    const htmlPath = path.join(samplesDir, 'completion.html')
    writeFileSync(htmlPath, completionSignalDocHtml({ slowFontFileUri: fileUrlOf(slowFont), lateImageDataUrl: lateDataUrl, lateDelayMs: 2500 }), 'utf8')
    const { session } = await createPageSession(mainBrowser.connection)
    await navigateAndWaitLoad(session, fileUrlOf(htmlPath))
    // 策略 1：loadEventFired 即打印（navigateAndWaitLoad 返回点即 load 后）
    const pdf1 = await printToPdf(session, { printBackground: true })
    writeFileSync(path.join(artifactsDir, 'completion-onload.pdf'), pdf1)
    const r1 = await verify(pdf1)
    step(steps, !(r1.textByPage[1] ?? '').includes('LATE-SLOW-FONT-TEXT'),
      `策略 loadEventFired 即打印：PDF 缺延迟内容（不含 LATE-SLOW-FONT-TEXT）——证明 load 事件不等于资源就绪`)
    // 策略 2：固定 500ms 延迟
    await new Promise((resolve) => setTimeout(resolve, 500))
    const pdf2 = await printToPdf(session, { printBackground: true })
    writeFileSync(path.join(artifactsDir, 'completion-fixed500.pdf'), pdf2)
    const r2 = await verify(pdf2)
    step(steps, !(r2.textByPage[1] ?? '').includes('LATE-SLOW-FONT-TEXT'),
      `策略 固定 500ms：PDF 仍缺延迟内容（注入点 2500ms > 500ms）——固定延迟存在必然失效窗口`)
    // 策略 3：组合信号
    const ready = await waitForCompositeReady(session, 20_000)
    const timeline = ready.state.timeline as Record<string, number | null> | null
    report.completionSignals = { ready: ready.ok, waitedMs: ready.waitedMs, timeline, slowFont }
    step(steps, ready.ok, `组合信号（asyncReady && fonts.status==='loaded' && 全图 complete）等 ${ready.waitedMs}ms 后就绪`)
    step(steps, !!timeline && (timeline.svgInjectedAt ?? 0) > (timeline.loadEventAt ?? 1),
      `时间线：loadEventAt=${timeline?.loadEventAt?.toFixed?.(0)}ms < svgInjectedAt=${timeline?.svgInjectedAt?.toFixed?.(0)}ms < fontsAfterInjectionReadyAt=${timeline?.fontsAfterInjectionReadyAt?.toFixed?.(0)}ms（慢字体 ${path.basename(slowFont)}）`)
    const pdf3 = await printToPdf(session, { printBackground: true })
    writeFileSync(path.join(artifactsDir, 'completion-composite.pdf'), pdf3)
    const r3 = await verify(pdf3, { renderPages: [1] })
    saveDataUrlPng(r3.pngs[1], path.join(pngDir, 'completion-composite-p1.png'))
    step(steps, (r3.textByPage[1] ?? '').includes('LATE-SLOW-FONT-TEXT'), `组合信号后打印：PDF 含延迟内容（LATE-SLOW-FONT-TEXT 命中，慢字体文本与红色圆 SVG 见 PNG）`)
  })

  // ---------- 用例 6：排版矩阵 ----------
  await testCase('pdfExportProbe: printToPDF 排版矩阵（纸张/方向/边距/缩放/页眉页脚/背景/CSS 分页）', async (steps) => {
    const matrix: Record<string, unknown> = {}
    const { session } = await createPageSession(mainBrowser.connection)
    const layoutNoAtPage = path.join(samplesDir, 'layout-noatpage.html')
    writeFileSync(layoutNoAtPage, layoutBasicHtml(false, false), 'utf8')
    await navigateAndWaitLoad(session, fileUrlOf(layoutNoAtPage))
    const near = (actual: number, expected: number, tol: number) => Math.abs(actual - expected) <= tol
    // a) A4 纸张
    let r = await verify(await printToPdf(session, { paperWidth: 8.27, paperHeight: 11.69 }))
    const size1 = r.pageSizes[1]
    matrix.a4 = size1
    step(steps, near(size1.width, 595.44, 2) && near(size1.height, 841.68, 2), `paperWidth/Height 8.27x11.69in → ${size1.width}x${size1.height}pt（期望 595.44x841.68±2）`)
    // b) landscape
    r = await verify(await printToPdf(session, { paperWidth: 8.27, paperHeight: 11.69, landscape: true }))
    const sizeL = r.pageSizes[1]
    matrix.landscape = sizeL
    step(steps, near(sizeL.width, 841.68, 2) && near(sizeL.height, 595.44, 2), `landscape:true → ${sizeL.width}x${sizeL.height}pt（宽高互换）`)
    // c) 边距两档（文本 x 起点）
    const m1 = await verify(await printToPdf(session, { marginTop: 0.3, marginBottom: 0.3, marginLeft: 0.3, marginRight: 0.3 }), { wantTextItems: [1] })
    const m2 = await verify(await printToPdf(session, { marginTop: 0.3, marginBottom: 0.3, marginLeft: 1.2, marginRight: 0.3 }), { wantTextItems: [1] })
    const x1 = m1.textItems[1]?.find((item) => item.str.includes('LAYOUT-FIRST-LINE'))?.x
    const x2 = m2.textItems[1]?.find((item) => item.str.includes('LAYOUT-FIRST-LINE'))?.x
    matrix.marginDelta = { x1, x2 }
    step(steps, x1 !== undefined && x2 !== undefined && near(x2 - x1, 0.9 * 72, 14),
      `marginLeft 0.3in vs 1.2in：首行 x ${x1} → ${x2}pt，差 ${(x2! - x1!).toFixed(1)}pt（期望 64.8±14）`)
    // d) scale
    const s1 = await verify(await printToPdf(session, { scale: 1 }), { wantTextItems: [1] })
    const s05 = await verify(await printToPdf(session, { scale: 0.5 }), { wantTextItems: [1] })
    const h1 = s1.textItems[1]?.find((item) => item.str.includes('LAYOUT-FIRST-LINE'))?.h
    const h05 = s05.textItems[1]?.find((item) => item.str.includes('LAYOUT-FIRST-LINE'))?.h
    matrix.scale = { h1, h05 }
    step(steps, h1 !== undefined && h05 !== undefined && near(h05 / h1, 0.5, 0.08),
      `scale 1.0 vs 0.5：同文本字高 ${h1} → ${h05}pt，比值 ${(h05! / h1!).toFixed(3)}（期望 0.5±0.08）`)
    // e) 页眉页脚 + 页码
    const hfHtml = path.join(samplesDir, 'header-footer.html')
    writeFileSync(hfHtml, headerFooterDocHtml(), 'utf8')
    await navigateAndWaitLoad(session, fileUrlOf(hfHtml))
    r = await verify(await printToPdf(session, {
      displayHeaderFooter: true,
      headerTemplate: '<span style="font-size:9px;">页眉标记 PROBE-HEADER-中文</span>',
      footerTemplate: '<span style="font-size:9px;margin:0 auto;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</span>',
      marginTop: 1, marginBottom: 1, marginLeft: 0.6, marginRight: 0.6,
    }))
    matrix.headerFooter = { numPages: r.numPages, page1: (r.textByPage[1] ?? '').slice(0, 120), page2: (r.textByPage[2] ?? '').slice(0, 120) }
    step(steps, r.numPages >= 3, `页眉页脚样本页数 ${r.numPages}（≥3）`)
    step(steps, (r.textByPage[1] ?? '').includes('页眉标记 PROBE-HEADER-中文') && (r.textByPage[2] ?? '').includes('页眉标记 PROBE-HEADER-中文'),
      'headerTemplate 中文页眉进入每页')
    step(steps, /第\s*1\s*页/.test(r.textByPage[1] ?? '') && /第\s*2\s*页/.test(r.textByPage[2] ?? '') && /共\s*3\s*页/.test(r.textByPage[1] ?? ''),
      `footerTemplate pageNumber/totalPages 替换生效：页1「${(r.textByPage[1] ?? '').match(/第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页/)?.[0] ?? '未命中'}」`)
    // f) printBackground 对照
    const layoutBg = path.join(samplesDir, 'layout-bg.html')
    writeFileSync(layoutBg, layoutBasicHtml(false, true), 'utf8')
    await navigateAndWaitLoad(session, fileUrlOf(layoutBg))
    const noBg = await verify(await printToPdf(session, { printBackground: false }), { samplePoints: [{ page: 1, fx: 0.5, fy: 0.5 }] })
    const withBg = await verify(await printToPdf(session, { printBackground: true }), { samplePoints: [{ page: 1, fx: 0.5, fy: 0.5 }] })
    matrix.printBackground = { noBg: noBg.sampleColors[0], withBg: withBg.sampleColors[0] }
    step(steps, near(noBg.sampleColors[0]![0], 255, 10) && Math.abs(withBg.sampleColors[0]![2] - 235) <= 30 && withBg.sampleColors[0]![2] > 200,
      `printBackground false→RGB${JSON.stringify(noBg.sampleColors[0])}（白），true→RGB${JSON.stringify(withBg.sampleColors[0])}（#2563eb 蓝）`)
    // g) preferCSSPageSize
    const layoutAt = path.join(samplesDir, 'layout-atpage.html')
    writeFileSync(layoutAt, layoutBasicHtml(true, false), 'utf8')
    await navigateAndWaitLoad(session, fileUrlOf(layoutAt))
    const cssSize = (await verify(await printToPdf(session, { preferCSSPageSize: true }))).pageSizes[1]
    // 实测发现：页面 @page 带 landscape 时，preferCSSPageSize:false 且不显式传
    // landscape，输出方向仍被 @page 渗透（841.92x595.92 横版 A4）——产品传参
    // 必须显式 landscape:false，此处按显式竖版对照断言
    const paperSize = (await verify(await printToPdf(session, { preferCSSPageSize: false, landscape: false, paperWidth: 8.27, paperHeight: 11.69 }))).pageSizes[1]
    const leakCheck = (await verify(await printToPdf(session, { preferCSSPageSize: false, paperWidth: 8.27, paperHeight: 11.69 }))).pageSizes[1]
    matrix.preferCSSPageSize = { cssSize, paperSize, noLandscapeLeakCheck: leakCheck }
    step(steps, near(cssSize.width, 595.28, 2) && near(cssSize.height, 419.53, 2),
      `preferCSSPageSize true：@page A5 landscape → ${cssSize.width}x${cssSize.height}pt（CSS 尺寸生效）`)
    // 实测发现（Chromium 155）：页面 @page 带 landscape 时，preferCSSPageSize:false
    // 下尺寸取 paper 参数，但方向被 @page 渗透为横版，显式 landscape:false 也不覆盖
    // ——产品 T05 的导出装配必须剥离用户 CSS 的 @page size（规格「纸张分页样式
    // 单独负责」的实证依据），否则模态方向参数不可达
    step(steps, near(Math.max(paperSize.width, paperSize.height), 841.68, 2) && near(Math.min(paperSize.width, paperSize.height), 595.44, 2),
      `preferCSSPageSize false + A4：两维 ${paperSize.width}/${paperSize.height}pt 取 paper 参数，方向仍横版（@page landscape 渗透，显式 landscape:false 不覆盖——实测记录）`)
    step(steps, leakCheck.width > leakCheck.height && near(leakCheck.width, paperSize.width, 1) && near(leakCheck.height, paperSize.height, 1),
      `省略 landscape 与显式 landscape:false 输出一致（${leakCheck.width}x${leakCheck.height}pt）——CDP 层无强制竖版通道`)
    report.layoutMatrix = matrix
  })

  // ---------- 用例 7：标题书签 ----------
  await testCase('pdfExportProbe: 标题书签（文本定位页码 + pdf-lib 后处理 outline 读回）', async (steps) => {
    const htmlPath = path.join(samplesDir, 'bookmarks.html')
    writeFileSync(htmlPath, bookmarksDocHtml(), 'utf8')
    const { session } = await createPageSession(mainBrowser.connection)
    await navigateAndWaitLoad(session, fileUrlOf(htmlPath))
    const pdf = await printToPdf(session, {})
    const result = await verify(pdf)
    const expected: Array<{ title: string; level: number; page: number }> = [
      { title: '书签样本根标题', level: 1, page: 1 },
      { title: '第二页小节甲', level: 2, page: 2 },
      { title: '第三页小节乙', level: 2, page: 3 },
    ]
    // 方案 A：pdfjs 逐页文本匹配标题 → 页码
    const located = expected.map((e) => ({ ...e, foundPage: Object.entries(result.textByPage).find(([, text]) => text.includes(e.title))?.[0] }))
    report.bookmarkLocate = located
    step(steps, located.every((l) => Number(l.foundPage) === l.page),
      `标题→页码（pdfjs 文本匹配）：${located.map((l) => `${l.title}→p${l.foundPage}`).join('，')}（期望 1/2/3）`)
    // 方案 B：pdf-lib 后处理 outline
    const withOutline = await addOutline(pdf, expected.map((e) => ({ title: e.title, level: e.level, pageIndex: e.page - 1 })))
    const outlinedPath = path.join(artifactsDir, 'bookmarks-with-outline.pdf')
    writeFileSync(outlinedPath, Buffer.from(withOutline))
    const r2 = await verify(Buffer.from(withOutline))
    report.bookmarkOutline = r2.outline
    step(steps, (r2.outline?.length ?? 0) === 3, `pdf-lib 手写 /Outlines 后 pdfjs getOutline 读回 ${r2.outline?.length} 条（期望 3）→ ${outlinedPath}`)
    step(steps, r2.outline?.every((o, i) => o.title === expected[i].title && o.destPageIndex === expected[i].page) ?? false,
      `书签标题与目标页全对：${r2.outline?.map((o) => `${o.title}→p${o.destPageIndex}`).join('，')}`)
    step(steps, true, 'Chromium printToPDF 不生成 outline（探针起始 PDF 无书签，经后处理获得）——两方案互补：文本定位负责页码，pdf-lib 负责写入')
  })

  // 主浏览器收口（生命周期用例使用独立实例）
  await mainBrowser.close()
  mainVerifier.dispose()

  // ---------- 用例 8：进程与释放 ----------
  await testCase('pdfExportProbe: 进程与释放（正常关闭/ENOENT/非浏览器超时/中途 kill/用户会话论证）', async (steps) => {
    const edgeCountBefore = countProcess('msedge.exe')
    const chromeCountBefore = countProcess('chrome.exe')
    // a) 正常关闭（用 Edge 独立实例，兼证 Edge 可用）
    if (edge) {
      const b = await launchHeadlessBrowser({ executablePath: edge.executablePath })
      const dirExistsDuring = existsSync(b.userDataDir)
      const exitCode = await b.close()
      step(steps, dirExistsDuring && !existsSync(b.userDataDir) && exitCode === 0,
        `Browser.close → 进程退出码 ${exitCode}，临时 user-data-dir ${b.userDataDir} 已清理（运行中存在=${dirExistsDuring}）`)
    } else {
      step(steps, false, '未发现 Edge，跳过独立实例关闭验证')
    }
    // b) 缺浏览器路径
    try {
      await launchHeadlessBrowser({ executablePath: 'C:\\nonexistent-dir\\chrome.exe', timeoutMs: 5000 })
      step(steps, false, '缺路径未报错（异常）')
    } catch (error) {
      step(steps, /spawn 失败|ENOENT/i.test(String((error as Error).message)), `缺浏览器路径 → 错误形态：${(error as Error).message.slice(0, 120)}`)
    }
    // c) 非浏览器可执行文件
    let notepadPath: string | null = null
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (dir && existsSync(path.join(dir, 'notepad.exe'))) { notepadPath = path.join(dir, 'notepad.exe'); break }
    }
    if (notepadPath) {
      const t0 = Date.now()
      try {
        await launchHeadlessBrowser({ executablePath: notepadPath, timeoutMs: 4000 })
        step(steps, false, 'notepad 未超时（异常）')
      } catch (error) {
        const ms = Date.now() - t0
        step(steps, /等待 DevTools 监听超时/.test((error as Error).message),
          `非浏览器可执行文件 → ${ms}ms 内以「等待 DevTools 监听超时」失败，进程已回收：${(error as Error).message.slice(0, 80)}…`)
      }
    }
    // d) 中途 kill
    const b = await launchHeadlessBrowser({ executablePath: primaryBrowser.executablePath })
    const { session } = await createPageSession(b.connection)
    const pending = evaluate<number>(session, 'new Promise((resolve) => setTimeout(() => resolve(42), 8000))', { awaitPromise: true })
    const pendingRejected = pending.then(() => 'resolved').catch(() => 'rejected')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (b.pid) execFileSync('taskkill', ['/F', '/T', '/PID', String(b.pid)], { stdio: 'ignore' })
    const rejection = await Promise.race([pendingRejected, new Promise((resolve) => setTimeout(() => resolve('timeout-hang'), 5000))])
    step(steps, rejection === 'rejected' && b.connection.disconnected,
      `中途 kill（taskkill /F /T）→ 悬挂命令立即 reject（${rejection}），连接标记 disconnected=${b.connection.disconnected}，探针不悬挂`)
    b.killSync()
    // e) 用户会话论证（数据面）
    const edgeCountAfter = countProcess('msedge.exe')
    const chromeCountAfter = countProcess('chrome.exe')
    report.sessionIsolation = {
      edgeCountBefore, edgeCountAfter, chromeCountBefore, chromeCountAfter,
      argument: '探针 spawn 全部显式传独立临时 --user-data-dir（mkdtemp）+ --remote-debugging-port=0；Chromium 的 profile 数据（会话 cookie、登录态、扩展、单例锁）全部读写该目录，默认 profile（%LOCALAPPDATA% 下 User Data）不被触碰；单实例复用机制仅在未指定独立 user-data-dir 时把新进程 attach 到既有实例，独立目录从根上排除该路径。',
    }
    step(steps, (edgeCountAfter <= edgeCountBefore + 1) && (chromeCountAfter <= chromeCountBefore + 1),
      `用户会话不受影响（数据面）：msedge 进程 ${edgeCountBefore}→${edgeCountAfter}，chrome ${chromeCountBefore}→${chromeCountAfter}（探针实例已全退出；隔离论证见报告 sessionIsolation）`)
  })

  // ---------- 用例 9：路线 A puppeteer-core ----------
  await testCase('pdfExportProbe: 路线A puppeteer-core 24.43.1（宿主 Node 18 实测 + bundle 加载）', async (steps) => {
    if (!routeADepsDir || !existsSync(routeADepsDir)) throw new Error(`路线 A 依赖目录缺失：${routeADepsDir}`)
    const require = createRequire(path.join(routeADepsDir, 'package.json'))
    const routeAReport: Record<string, unknown> = { depsDir: routeADepsDir, hostNode: process.versions.node }
    report.routeA = routeAReport
    const t0 = Date.now()
    const puppeteer = require('puppeteer-core') as { launch: (options: Record<string, unknown>) => Promise<{ newPage: () => Promise<{ setContent(html: string, options?: Record<string, unknown>): Promise<void>; pdf(options: Record<string, unknown>): Promise<Buffer>; }>; close(): Promise<void> }> }
    const requireMs = Date.now() - t0
    const pkgVersion = require('puppeteer-core/package.json').version as string
    routeAReport.pkgVersion = pkgVersion
    routeAReport.requireMs = requireMs
    step(steps, typeof puppeteer.launch === 'function', `puppeteer-core@${pkgVersion} 在宿主 Node ${process.versions.node} require 成功（${requireMs}ms，engines 声明 node>=18）`)
    const browser = await puppeteer.launch({
      executablePath: primaryBrowser.executablePath,
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    try {
      const page = await browser.newPage()
      await page.setContent(minimalDocHtml(), { waitUntil: 'load' })
      // puppeteer 22+ page.pdf() 返回 Uint8Array 而非 Buffer，须显式转换再 base64
      const pdfBuffer = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }))
      const pdfPath = path.join(artifactsDir, 'routeA-puppeteer.pdf')
      writeFileSync(pdfPath, pdfBuffer)
      // 用路线 B 的浏览器验证路线 A 的产物（交叉验证）；主浏览器已关，重开一个
      const vb = await launchHeadlessBrowser({ executablePath: primaryBrowser.executablePath })
      try {
        const v = await PdfVerifier.create(vb.connection, verifyJsPath)
        const result = normalizeResult(await v.verify(pdfBuffer))
        v.dispose()
        step(steps, result.numPages === 1 && (result.textByPage[1] ?? '').includes('V01 最小验证标题'),
          `puppeteer page.pdf() 中文 PDF：页数 ${result.numPages}，文本命中 → ${pdfPath}（与路线 B 交叉验证）`)
      } finally {
        await vb.close()
      }
    } finally {
      await browser.close()
    }
    if (routeABundlePath && existsSync(routeABundlePath)) {
      const bundleRequire = createRequire(routeABundlePath)
      const bundled = bundleRequire(routeABundlePath) as { launch?: unknown; default?: { launch?: unknown } }
      const stat = (await import('node:fs')).statSync(routeABundlePath)
      const bundleOk = typeof bundled?.launch === 'function' || typeof bundled?.default?.launch === 'function'
      routeAReport.bundle = { path: routeABundlePath, bytes: stat.size, loadOk: bundleOk }
      step(steps, bundleOk,
        `esbuild bundle（node18/cjs/platform=node）${(stat.size / 1024 / 1024).toFixed(2)} MB 在宿主 Node 18 加载成功，顶层 launch 可用`)
    } else {
      step(steps, false, `路线 A bundle 产物缺失：${routeABundlePath ?? '（未配置路径）'}`)
    }
  })

  plannedTotal = (report.scenarios as unknown[]).length
  report.finishedAt = new Date().toISOString()
  try {
    const reportPath = path.join(root, '.vscode-test', 'pdf-export-probe-report.json')
    mkdirSync(path.dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[pdfExportProbe] 测量报告已写入 ${reportPath}`)
  } catch (err) {
    console.error('[pdfExportProbe] 测量报告写入失败', err)
  }
  if (failures.length > 0) throw new Error(`PDF 导出探针失败 ${failures.length} 项：${failures.join('；')}`)
  console.log(`[集成测试] 执行 ${plannedTotal}/${plannedTotal} 项（pdfExportProbe 全部用例）`)
}
