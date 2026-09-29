// live 图片布局回归套件（live SVG 塌缩修复）：真实 Chromium + 生产控制器 +
// 产物 CSS，断言用户看到的东西（AGENTS 视觉层断言）——图片实际渲染宽度：
//   B1 live 独立成行的 viewBox-only 百分比宽 SVG（mermaid 导出形态：width="100%"
//      无 height 只有 viewBox）渲染宽度铺满正文列（修复本体：inline-block
//      shrink-to-fit 下解析为 0×0 的静默空白行）
//   B2 live 独立成行的固有尺寸图片按自然宽度呈现（block 变体不拉伸有固有
//      尺寸的图源，不回归 PNG 类形态）
//   B3 live 限宽档（600px）下 B1 图随正文列限宽（与 viewport-width 契约联动）
//   B4 阅读侧同图正常渲染（非回归基线）
//   B5 行内混排图片保持 inline 形态（独立成行判定不误伤；已知边界：行内
//      viewBox-only SVG 仍塌缩属记录边界，本套件只钉形态不量其宽）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'liveImageLayout/liveImageLayout.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveImageLayoutFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}

/** mermaid 导出形态 SVG（width="100%" 无 height 仅 viewBox）与固有尺寸 SVG */
const vbOnlySvg = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg width="100%" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100" fill="#cc4444"/></svg>')
const intrinsicSvg = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg width="240" height="120" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="120" fill="#4488cc"/></svg>')

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate(([a, b]) => {
    window.serveImg('./assets/lifecycle.svg', a)
    window.serveImg('./assets/intrinsic.svg', b)
  }, [vbOnlySvg, intrinsicSvg])
  const DOC = [
    '# 图片布局样例',
    '',
    '![mermaid 形态](./assets/lifecycle.svg)',
    '',
    '![固有尺寸](./assets/intrinsic.svg)',
    '',
    '行内混排 ![行内](./assets/intrinsic.svg) 保持行内形态。',
    '',
  ].join('\n')
  await page.evaluate((text) => window.initImgDoc(text), DOC)
  await page.waitForSelector('.cm-line')

  /** live 侧观测：按 DOM 序返回各图片槽位（加载状态、形态、img 渲染几何） */
  const measureLive = () => page.evaluate(() => {
    const content = document.querySelector('.cm-content')
    const slots = Array.from(content?.querySelectorAll('.vsidian-image') ?? [])
    return {
      colW: content ? content.getBoundingClientRect().width : 0,
      slots: slots.map((slot) => {
        const img = slot.querySelector('img')
        const r = img ? img.getBoundingClientRect() : null
        return {
          rawSrc: slot.getAttribute('data-vsidian-img-src') ?? '',
          state: slot.getAttribute('data-vsidian-img-state'),
          block: slot.classList.contains('vsidian-image-block'),
          display: getComputedStyle(slot).display,
          imgW: r ? Math.round(r.width * 10) / 10 : 0,
          imgH: r ? Math.round(r.height * 10) / 10 : 0,
        }
      }),
    }
  })
  await page.waitForFunction(() => {
    const slots = document.querySelectorAll('.cm-content .vsidian-image')
    return slots.length >= 3 && Array.from(slots).every((s) => s.getAttribute('data-vsidian-img-state') === 'loaded')
  }, { timeout: 10000 })
  let m = await measureLive()
  const [vb, intrinsicSolo, intrinsicInline] = m.slots

  check('B1 live 独行 viewBox-only SVG 渲染宽度铺满正文列（塌缩修复本体）',
    vb.imgW >= m.colW * 0.9 && vb.imgH > 50,
    `imgW=${vb.imgW} imgH=${vb.imgH} 列宽=${m.colW.toFixed(1)}（修复前为 0×0）`)
  check('B2 live 独行固有尺寸图按自然宽度呈现（block 变体不拉伸）',
    Math.abs(intrinsicSolo.imgW - 240) < 2 && Math.abs(intrinsicSolo.imgH - 120) < 2,
    `imgW=${intrinsicSolo.imgW} imgH=${intrinsicSolo.imgH}（自然 240×120）`)
  check('B5 独行图片为块级形态、行内混排保持行内形态（判定不误伤）',
    vb.block && vb.display === 'block' && intrinsicSolo.block && intrinsicSolo.display === 'block'
      && intrinsicInline && !intrinsicInline.block && intrinsicInline.display === 'inline-block',
    `独行=${vb.display}/${intrinsicSolo.display} 行内=${intrinsicInline ? intrinsicInline.display : 'n/a'}`)

  // —— B3：限宽档 600 下塌缩 SVG 随正文列限宽（viewport-width 契约联动）——
  await page.evaluate(() => window.setImgSettings({ 'editor.readableLineWidth': 600 }))
  await page.waitForTimeout(250) // 列宽变量与重排稳定后再量
  m = await measureLive()
  check('B3 限宽档 600：独行 SVG 随正文列限宽',
    Math.abs((m.slots[0]?.imgW ?? 0) - 600) < 6,
    `imgW=${m.slots[0]?.imgW}（列宽设定 600）`)
  await page.evaluate(() => window.setImgSettings({ 'editor.readableLineWidth': 0 }))

  // —— B4：阅读侧同图正常渲染（非回归基线）——
  await page.evaluate(() => window.setImgMode('reading'))
  await page.waitForSelector('.vsidian-reading-block img.vsidian-image')
  await page.waitForFunction(() => {
    const imgs = document.querySelectorAll('.vsidian-reading-block img.vsidian-image')
    return imgs.length >= 2 && Array.from(imgs).every((i) => i.getAttribute('data-vsidian-img-state') === 'loaded')
  }, { timeout: 10000 })
  const reading = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.vsidian-reading-block img.vsidian-image'))
    const vbImg = imgs.find((i) => i.getAttribute('data-vsidian-img-src') === './assets/lifecycle.svg')
    return { w: vbImg ? vbImg.getBoundingClientRect().width : 0 }
  })
  check('B4 阅读侧同 SVG 正常渲染（非回归）',
    reading.w > 100,
    `imgW=${reading.w.toFixed(1)}`)

  check('页面无脚本错误', errors.length === 0, JSON.stringify(errors))
  if (failures.length > 0) {
    console.error(`liveImageLayout: ${failures.length} 条断言红`)
    process.exitCode = 1
  } else {
    console.log('liveImageLayout: 全部断言通过（独行 SVG 铺满/固有尺寸不拉伸/限宽联动/阅读非回归/形态判定）')
  }
} finally {
  await browser.close()
}
