// 诊断探针（视窗宽度 bug 回路，diagnosing-bugs Phase 1）：真实 Chromium +
// 生产控制器 + 产物 CSS，测量用户看到的东西——正文行的实际渲染宽度与
// 水平位置。回路语义（对应用户报告「阅读模式下宽度有隐形限制」）：
//   A1 阅读正文块宽度 === Live 同文档正文行宽度（两模式一致，无隐形钳制）
//   A2 宽度小于可用区时正文块在可用区内水平居中（左缝 ≈ 右缝）
//   A3 侧栏展开时阅读正文自动避让收缩、仍居中
// 现状预期全红（760px 兜底 + 块级居左 + 侧栏不影响正文宽）。观测值全部
// 打印，断言失败逐条收集后统一报告。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'readingWidthProbe/readingWidthProbe.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingWidthProbeFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  const LONG = '这是一段足够长的正文文字用来撑满可用宽度并触发折行。'.repeat(12)
  const DOC = `# 标题\n\n${LONG}\n\n${LONG}\n`
  await page.evaluate((text) => window.initReadingWidth(text), DOC)

  // —— Live 观测（对照组：铺满）——
  await page.waitForSelector('.cm-line')
  const live = await page.evaluate(() => {
    const app = document.getElementById('app')
    const line = document.querySelector('.cm-line')
    const r = line.getBoundingClientRect()
    return { appWidth: app.getBoundingClientRect().width, lineLeft: r.left, lineW: r.width }
  })
  console.log(`观测 Live   : app=${live.appWidth}px 正文行 left=${live.lineLeft} width=${live.lineW}`)

  // —— 阅读观测（侧栏收起 / 展开 / 变量覆盖，三轮）——
  const measureReading = (label) => page.evaluate((l) => {
    const view = document.querySelector('.vsidian-view-reading')
    const p = document.querySelector('.vsidian-reading-block p')
    const cs = getComputedStyle(view)
    const vr = view.getBoundingClientRect()
    const r = p.getBoundingClientRect()
    const padL = Number.parseFloat(cs.paddingLeft)
    const padR = Number.parseFloat(cs.paddingRight)
    const contentLeft = vr.left + padL
    const contentW = view.clientWidth - padL - padR
    return { label: l, viewW: vr.width, contentW, blockLeft: r.left, blockW: r.width,
      gapL: r.left - contentLeft, gapR: contentLeft + contentW - (r.left + r.width) }
  }, label).then((m) => {
    console.log(`观测 阅读(${m.label}): 容器=${m.viewW}px 可用=${m.contentW}px 块 left=${m.blockLeft.toFixed(1)} width=${m.blockW.toFixed(1)} 左缝=${m.gapL.toFixed(1)} 右缝=${m.gapR.toFixed(1)}`)
    return m
  })

  await page.evaluate(() => window.setRwMode('reading'))
  await page.waitForSelector('.vsidian-reading-block p')
  const closed = await measureReading('侧栏收起')

  await page.evaluate(() => window.setRwSidebar(true))
  await page.waitForTimeout(250) // 侧栏 0.15s 宽度过渡完成
  const opened = await measureReading('侧栏展开')

  await page.evaluate(() => window.setRwSidebar(false))
  await page.evaluate(() => window.setRwLineWidth('900px'))
  const overridden = await measureReading('file-line-width=900px')
  await page.evaluate(() => window.setRwLineWidth(''))

  // —— 回路断言 ——
  check('A1 两模式正文宽度一致（阅读无隐形钳制）', Math.abs(closed.blockW - live.lineW) < 2,
    `阅读=${closed.blockW.toFixed(1)} live=${live.lineW.toFixed(1)}`)
  check('A2 阅读正文水平居中', Math.abs(closed.gapL - closed.gapR) < 4,
    `左缝=${closed.gapL.toFixed(1)} 右缝=${closed.gapR.toFixed(1)}`)
  check('A3 侧栏展开自动避让（宽度收缩到可用区）', Math.abs(opened.blockW - opened.contentW) < 2,
    `展开后块宽=${opened.blockW.toFixed(1)} 可用=${opened.contentW.toFixed(1)}`)
  check('A3′ 侧栏展开仍居中', Math.abs(opened.gapL - opened.gapR) < 4,
    `左缝=${opened.gapL.toFixed(1)} 右缝=${opened.gapR.toFixed(1)}`)
  console.log(`观测 根因证: 手动设 --file-line-width=900px → 阅读块宽=${overridden.blockW.toFixed(1)}（证明钳制来源即该变量兜底 760px）`)
  check('附 值可覆盖', Math.abs(overridden.blockW - 900) < 2, `覆盖后=${overridden.blockW.toFixed(1)}`)

  check('页面无脚本错误', errors.length === 0, JSON.stringify(errors))
  if (failures.length > 0) {
    console.error(`readingWidthProbe: ${failures.length} 条断言红（bug 复现）`)
    process.exitCode = 1
  } else {
    console.log('readingWidthProbe: 全部断言通过')
  }
} finally {
  await browser.close()
}
