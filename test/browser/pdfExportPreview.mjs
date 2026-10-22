// PDF 导出模态预览的真实浏览器验收（验收修复轮）：生产入口 + 真实 pdfjs +
// 真实画布，钉住——
// 1) 空态说明在预览区真正居中（不是被 max-width 贴左）；
// 2) 预览页面按 A4 纸面宽显示（≈794 CSS px，宽面板不再拉伸），水平居中；
// 3) HiDPI：canvas 后备尺寸 = CSS 尺寸 × devicePixelRatio（矢量清晰度）；
// 4) 左下角缩放条（− / 百分比 / +）与 Ctrl+滚轮走同一缩放入口；普通滚轮
//    不拦截；
// 5) 生成在途显示扫光骨架（9 个同族灰块）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium, ensurePdfArtifacts } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildTextLinkPdf } from '../pdfSample.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'pdfExportPreview/main.js')
await build({
  entryPoints: [path.join(root, 'src/webview/pdfExportMain.ts')],
  bundle: true,
  outfile: bundle,
  format: 'iife',
  loader: { '.svg': 'dataurl', '.woff2': 'file' },
  assetNames: 'assets/[name]',
})
const cssPath = bundle.replace(/\.js$/, '.css')
const { islandHtml } = await buildZhLocaleIsland(root)
const sample = await buildTextLinkPdf()
await ensurePdfArtifacts(root)
const pdfMainJs = await readFile(path.join(root, 'out/webview/pdfMain.js'))
const pdfWorkerJs = await readFile(path.join(root, 'out/webview/pdfWorker.js'))

const DEFAULTS = {
  paper: 'letter', customWidthMm: 210, customHeightMm: 297,
  orientation: 'portrait', marginMm: 20, scale: 1,
  headerEnabled: false, headerTitle: true, headerDate: false,
  pageNumberEnabled: false, pageNumberPosition: 'footer-center', bookmarksEnabled: false,
}

const state = (preview) => ({
  kind: 'pdfExportModal.state',
  phase: 'idle',
  generation: 0,
  docName: '验收.md',
  capturedVersion: 1,
  defaults: DEFAULTS,
  browserPath: '',
  hostToday: '2026-10-22',
  preview,
})

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  // deviceScaleFactor 2：断言 HiDPI 后备尺寸与 CSS 尺寸分离（清晰度根因）
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://assets.local/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.route('https://assets.local/pdfMain.js', (route) =>
    route.fulfill({ body: pdfMainJs, contentType: 'application/javascript' }))
  await page.route('https://assets.local/pdfWorker.js', (route) =>
    route.fulfill({ body: pdfWorkerJs, contentType: 'application/javascript' }))

  // 必须给页面一个真实 origin：about:blank 的 opaque origin 下 Blob worker
  // 装配会被拒绝，pdfjs 退回 fake worker 后 import(IIFE) 无导出而失败
  // （不是产品缺陷——生产 webview 有真实 origin）
  await page.route('https://app.local/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body class="vscode-dark">${islandHtml}<div id="app"></div></body></html>`,
  }))
  await page.goto('https://app.local/')
  await page.addStyleTag({
    content: `:root {
      --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      --vscode-editor-background: #1e1e1e; --vscode-editor-foreground: #dddddd;
      --vscode-panel-border: #474750; --vscode-descriptionForeground: #aaaaaa;
      --vscode-editorWidget-background: #252526;
      --vscode-button-background: #0e639c; --vscode-button-foreground: #ffffff;
      --vscode-button-secondaryBackground: #313131; --vscode-button-secondaryForeground: #cccccc;
      --vscode-dropdown-background: #313131; --vscode-dropdown-foreground: #cccccc;
      --vscode-dropdown-border: #3c3c3c; --vscode-input-background: #313131;
      --vscode-input-foreground: #cccccc; --vscode-focusBorder: #007fd4;
      --vscode-list-hoverBackground: #2a2d2e; --vscode-widget-shadow: rgba(0,0,0,0.36);
    }
    html, body { margin: 0; width: 100%; height: 100%; }`,
  })
  await page.addStyleTag({ path: cssPath })
  await page.addScriptTag({
    content: `window.acquireVsCodeApi = () => ({ postMessage() {} });
      window.__vsidianPdfAssets = {
        mainJs: 'https://assets.local/pdfMain.js',
        workerJs: 'https://assets.local/pdfWorker.js',
        cMapUrl: 'https://assets.local/cmaps',
        fontUrl: 'https://assets.local/fonts',
        wasmUrl: 'https://assets.local/wasm',
        iccUrl: 'https://assets.local/iccs',
      };`,
  })
  await page.addScriptTag({ path: bundle })

  // ---- 空态：说明块在预览区水平居中；缩放条不显示 ----
  await page.evaluate((s) => window.postMessage(s, '*'), state({ phase: 'idle', generation: 0 }))
  await page.locator('.vsidian-pdfexport-preview-placeholder').waitFor()
  const idle = await page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect()
      return box === undefined ? null : { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }
    }
    return {
      preview: rect('.vsidian-pdfexport-preview'),
      placeholder: rect('.vsidian-pdfexport-preview-placeholder'),
      zoomVisible: document.querySelector('.vsidian-pdfexport-zoombar')?.offsetParent !== null,
      printWidth: document.querySelector('.vsidian-pdfexport')?.style.getPropertyValue('--vsidian-pdfexport-print-width') ?? '',
    }
  })
  assert.ok(idle.preview && idle.placeholder, '空态预览与说明块在场')
  assert.equal(idle.printWidth, '816px', `预览列宽应为 Letter 纵向纸面宽（实测 ${idle.printWidth}）`)
  assert.equal(idle.zoomVisible, false, '空态不显示缩放条')
  const idleCenter = (idle.placeholder.left + idle.placeholder.right) / 2
  const previewCenter = (idle.preview.left + idle.preview.right) / 2
  assert.ok(Math.abs(idleCenter - previewCenter) <= 2, `说明块应水平居中（偏差 ${(idleCenter - previewCenter).toFixed(1)}px）`)
  passed++

  // ---- 生成在途：扫光骨架 9 块 ----
  await page.evaluate((s) => window.postMessage(s, '*'), state({ phase: 'generating', generation: 1 }))
  await page.locator('.vsidian-pdfexport-preview-skeleton').waitFor()
  const skeletonBlocks = await page.locator('.vsidian-skeleton-block').count()
  assert.equal(skeletonBlocks, 9, `骨架灰块数（实测 ${skeletonBlocks}）`)
  const sweep = await page.locator('.vsidian-skeleton-block').first().evaluate((el) => {
    const style = getComputedStyle(el, '::after')
    return { name: style.animationName, duration: style.animationDuration }
  })
  assert.match(sweep.name, /vsidian-pdfexport-skeleton-sweep/, `扫光动画应挂载（实测 ${sweep.name}）`)
  assert.equal(sweep.duration, '1.5s', `扫光周期与共享常量一致（实测 ${sweep.duration}）`)
  passed++

  // ---- 产物落地：页面宽 ≈ 纸面宽、居中、按 DPR 后备绘制 ----
  await page.evaluate(({ s, b64 }) => {
    window.postMessage(s, '*')
    window.postMessage({ kind: 'pdfExportModal.previewArtifact', generation: 1, base64: b64 }, '*')
  }, { s: state({ phase: 'ready', generation: 1, fingerprint: 'fp' }), b64: sample.bytes.toString('base64') })
  await page.locator('.vsidian-pdfexport-preview-scroll canvas').first().waitFor({ timeout: 30000 })
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('.vsidian-pdfexport-preview-scroll canvas')
    const preview = document.querySelector('.vsidian-pdfexport-preview').getBoundingClientRect()
    const bar = document.querySelector('.vsidian-pdfexport-zoombar').getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    return {
      canvasCssWidth: canvasRect.width,
      canvasBackingWidth: canvas.width,
      dpr: window.devicePixelRatio,
      canvasCenter: (canvasRect.left + canvasRect.right) / 2,
      previewCenter: (preview.left + preview.right) / 2,
      bar: { left: bar.left, bottom: bar.bottom },
      preview: { left: preview.left, bottom: preview.bottom },
      zoomText: document.querySelector('.vsidian-pdfexport-zoom-value')?.textContent ?? '',
    }
  })
  assert.ok(painted.canvasCssWidth > 0 && painted.canvasCssWidth <= 816.5,
    `页面宽应不超过 Letter 纸面宽（实测 ${painted.canvasCssWidth.toFixed(1)}px）`)
  assert.ok(painted.canvasCssWidth > 700,
    `宽面板下页面应按纸面宽显示而非缩小（实测 ${painted.canvasCssWidth.toFixed(1)}px）`)
  assert.ok(Math.abs(painted.canvasCenter - painted.previewCenter) <= 2,
    `页面应水平居中（偏差 ${(painted.canvasCenter - painted.previewCenter).toFixed(1)}px）`)
  assert.ok(Math.abs(painted.canvasBackingWidth / painted.canvasCssWidth - painted.dpr) < 0.05,
    `HiDPI 后备尺寸应 = CSS × DPR（后备 ${painted.canvasBackingWidth} / CSS ${painted.canvasCssWidth.toFixed(1)} / DPR ${painted.dpr}）`)
  assert.ok(Math.abs(painted.bar.left - (painted.preview.left + 15)) <= 3, `缩放条应靠预览区左侧（实测 ${painted.bar.left - painted.preview.left}px）`)
  assert.ok(Math.abs(painted.bar.bottom - (painted.preview.bottom - 15)) <= 3, `缩放条应靠预览区底部（实测 ${painted.preview.bottom - painted.bar.bottom}px）`)
  assert.equal(painted.zoomText, '100%', `就绪态缩放百分比（实测 ${painted.zoomText}）`)
  passed++

  // ---- Ctrl+滚轮缩放；普通滚轮不拦截 ----
  const spin = await page.evaluate(() => {
    const scroll = document.querySelector('.vsidian-pdfexport-preview-scroll')
    const canvas = scroll.querySelector('canvas').getBoundingClientRect()
    const control = new WheelEvent('wheel', {
      ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true,
      clientX: canvas.left + canvas.width / 2, clientY: canvas.top + 100,
    })
    scroll.dispatchEvent(control)
    const label = document.querySelector('.vsidian-pdfexport-zoom-value')?.textContent ?? ''
    const plain = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    scroll.dispatchEvent(plain)
    return { prevented: control.defaultPrevented, label, plainPrevented: plain.defaultPrevented }
  })
  assert.equal(spin.prevented, true, 'Ctrl+滚轮应被预览接管（防止 webview 页面缩放）')
  assert.equal(spin.plainPrevented, false, '普通滚轮不拦截（页面仍可滚动）')
  assert.notEqual(spin.label, '100%', `Ctrl+滚轮应改变缩放百分比（实测 ${spin.label}）`)
  // 百分比点击复位；随后 + / − 按钮同入口
  await page.locator('.vsidian-pdfexport-zoom-value').click()
  assert.equal(await page.locator('.vsidian-pdfexport-zoom-value').textContent(), '100%', '点击百分比复位 100%')
  await page.locator('.vsidian-pdfexport-zoom-btn').nth(1).click()
  assert.equal(await page.locator('.vsidian-pdfexport-zoom-value').textContent(), '125%', '+ 按钮放大')
  await page.locator('.vsidian-pdfexport-zoom-btn').nth(0).click()
  assert.equal(await page.locator('.vsidian-pdfexport-zoom-value').textContent(), '100%', '− 按钮缩小')
  passed++

  // ---- 窄面板：百分比复位必须回到纸面 100%，而不是适合宽度 ----
  // 视口收窄后预览列窄于 Letter 纸面（816px），适合宽度约 5x%；点百分比
  // 复位应把乘子反算到纸面尺寸，画布宽回到 ≈816 并横向可滚动。
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.vsidian-pdfexport-preview-scroll')
    const canvas = scroll?.querySelector('canvas')
    if (!scroll || !canvas) return false
    return Number.parseFloat(canvas.style.width) < Number.parseFloat(getComputedStyle(document.querySelector('.vsidian-pdfexport')).getPropertyValue('--vsidian-pdfexport-print-width'))
  }, undefined, { timeout: 15000 })
  const narrow = await page.evaluate(() => {
    const scroll = document.querySelector('.vsidian-pdfexport-preview-scroll')
    const canvas = scroll.querySelector('canvas')
    return {
      label: document.querySelector('.vsidian-pdfexport-zoom-value')?.textContent ?? '',
      canvasCssWidth: Number.parseFloat(canvas.style.width),
      scrollClientWidth: scroll.clientWidth,
    }
  })
  assert.ok(narrow.label !== '100%', `窄面板下适合宽度不应回显 100%（实测 ${narrow.label}）`)
  assert.ok(narrow.canvasCssWidth < 816, `窄面板下页面应随面板缩小（实测 ${narrow.canvasCssWidth.toFixed(1)}px）`)
  assert.ok(narrow.canvasCssWidth <= narrow.scrollClientWidth, '窄面板下页面不溢出（适合宽度）')
  await page.locator('.vsidian-pdfexport-zoom-value').click()
  await page.waitForFunction((paper) => {
    const canvas = document.querySelector('.vsidian-pdfexport-preview-scroll canvas')
    return canvas !== null && Math.abs(Number.parseFloat(canvas.style.width) - paper) <= 1
  }, Math.round(612 * 96 / 72), { timeout: 15000 })
  const narrowReset = await page.evaluate(() => {
    const scroll = document.querySelector('.vsidian-pdfexport-preview-scroll')
    const canvas = scroll.querySelector('canvas')
    return {
      label: document.querySelector('.vsidian-pdfexport-zoom-value')?.textContent ?? '',
      canvasCssWidth: Number.parseFloat(canvas.style.width),
      scrollWidth: scroll.scrollWidth,
      scrollClientWidth: scroll.clientWidth,
    }
  })
  assert.equal(narrowReset.label, '100%', '窄面板点百分比应复位纸面 100%')
  assert.ok(Math.abs(narrowReset.canvasCssWidth - 816) <= 1,
    `复位后画布宽应等于 Letter 纸面（实测 ${narrowReset.canvasCssWidth.toFixed(1)}px）`)
  assert.ok(narrowReset.scrollWidth > narrowReset.scrollClientWidth + 20,
    '纸面尺寸超出窄面板时应横向可滚动，而不是被裁掉')
  passed++

  assert.deepEqual(errors, [], `页面不应有未捕获异常：${errors.join(' | ')}`)
  console.log(`pdfExportPreview: ${passed}/5 场景通过`)
} finally {
  await browser.close()
}
