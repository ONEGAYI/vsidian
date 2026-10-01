// 浮层锚点跟随回归（2026-10）：查找面板与选词选项条的 right 由静态视口
// 14px 改为正文列右缘动态跟随（ResizeObserver 逐帧 + 打开主动同步 + 事务
// 兜底）。真实 Chromium + 产物 CSS 断言用户看到的几何（视觉层断言约定）：
//   B1 限宽档 live：面板右缘咬合正文列右缘，且确为跟随值而非保底
//   B2 侧栏展开：过渡动画落定后仍咬合，面板确实随列左移
//   B3 模式切换：查找会话跨模式保活，测量源换 reading 限宽块仍咬合
//   B4 选词选项条：Ctrl+D 会话期间同锚咬合（真实键盘路径）
//   B5 铺满档：贴正文列右缘（滚动条/内边距余量计入 diff；保底 14 由单测钉）
//   B6 窗口缩放：视口变宽后仍咬合
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'findBarAnchor/findBarAnchor.js')
await build({ entryPoints: [path.join(root, 'test/browser/findBarAnchorFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}
/** 容差：右缘咬合 ±2px（子像素与取整余量） */
const EPS = 2

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  // 文本布局：offset 13-15 为首个 foo（B4 光标落点）；段落足够折行撑几何
  const DOC = `# Title\n\n${'word foo bar '.repeat(10)}\n\n${'second line foo baz '.repeat(10)}\n`
  await page.evaluate(() => window.setSettings({ 'editor.readableLineWidth': 600, 'editor.lineNumbers': false }))
  await page.evaluate((text) => window.initDoc(text), DOC)
  await page.waitForSelector('.cm-line')

  /** 几何观测：包含块/两浮层/两模式正文列右缘与浮层内联 right */
  const measure = () => page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, width: r.width }
    }
    const panel = document.querySelector('.vsidian-find')
    const bar = document.querySelector('.vsidian-occurrence-bar')
    const content = document.querySelector('.cm-content')
    const block = document.querySelector('.vsidian-view-reading .vsidian-reading-block, .vsidian-view-reading .vsidian-reading-spacer')
    return {
      appRight: rect(document.getElementById('app')).right,
      panel: panel ? { ...rect(panel), styleRight: panel.style.right, open: panel.classList.contains('vsidian-find-open') } : null,
      bar: bar ? { ...rect(bar), styleRight: bar.style.right, open: bar.classList.contains('vsidian-occurrence-bar-open') } : null,
      contentRight: content ? rect(content).right : null,
      blockRight: block ? rect(block).right : null,
    }
  })

  // —— B1：限宽档 live 面板右缘咬合正文列 ——
  await page.evaluate(() => window.openFindPanel())
  const m1 = await measure()
  check('B1 限宽档面板右缘咬合正文列', m1.panel.open && m1.contentRight !== null &&
    Math.abs(m1.panel.right - m1.contentRight) <= EPS,
    `面板右=${m1.panel.right.toFixed(1)} 正文列右=${m1.contentRight?.toFixed(1)}`)
  check('B1b 面板确为跟随值而非保底（右侧留白>14）', (m1.appRight - m1.panel.right) > 14 + EPS,
    `面板距视口右缘=${(m1.appRight - m1.panel.right).toFixed(1)}`)

  // —— B2：侧栏展开动画落定后仍咬合（RO 逐帧跟随）——
  await page.evaluate(() => window.setSidebar(true))
  await page.waitForTimeout(400)
  const m2 = await measure()
  check('B2 侧栏展开后仍咬合', Math.abs(m2.panel.right - m2.contentRight) <= EPS,
    `面板右=${m2.panel.right.toFixed(1)} 正文列右=${m2.contentRight.toFixed(1)}`)
  check('B2b 面板随列左移（确实跟随而非静止）', m2.panel.right < m1.panel.right - 10,
    `移动前=${m1.panel.right.toFixed(1)} 移动后=${m2.panel.right.toFixed(1)}`)

  // —— B3：跨模式保活，测量源换 reading 限宽块 ——
  await page.evaluate(() => window.setMode('reading'))
  await page.waitForSelector('.vsidian-view-reading .vsidian-reading-block')
  await page.waitForTimeout(120)
  const m3 = await measure()
  check('B3 阅读模式面板右缘咬合限宽块', m3.blockRight !== null &&
    Math.abs(m3.panel.right - m3.blockRight) <= EPS,
    `面板右=${m3.panel.right.toFixed(1)} 限宽块右=${m3.blockRight?.toFixed(1)}`)

  // —— B4：选词选项条同锚咬合（回 live，真实键盘 Ctrl+D）——
  await page.evaluate(() => window.setMode('live'))
  await page.waitForSelector('.cm-line')
  await page.evaluate(() => window.closeFindPanel())
  await page.evaluate(() => window.locate(14))
  await page.evaluate(() => window.focusEditor())
  await page.keyboard.press('Control+d')
  await page.waitForTimeout(150)
  const m4 = await measure()
  check('B4 选词选项条右缘咬合正文列', m4.bar.open &&
    Math.abs(m4.bar.right - m4.contentRight) <= EPS,
    `条右=${m4.bar.right.toFixed(1)} 正文列右=${m4.contentRight.toFixed(1)}`)

  // —— B5：铺满档贴正文列右缘（滚动条/内边距余量计入 diff）——
  // headless 经典滚动条+内容边距使铺满档 diff≈24px（>保底），公式取差值
  // 即面板贴正文右缘；保底 14 分支的数值逻辑由单测 overlayAnchor 钉住
  // （overlay 滚动条等零余量平台触发），此处断言公式在真实几何上成立
  await page.evaluate(() => window.endOccurrenceSession())
  await page.evaluate(() => window.setSidebar(false))
  await page.evaluate(() => window.setSettings({ 'editor.readableLineWidth': 0 }))
  await page.waitForTimeout(300)
  await page.evaluate(() => window.openFindPanel())
  const m5 = await measure()
  const diff5 = m5.appRight - m5.contentRight
  const expected5 = Math.max(diff5, 14)
  check('B5 铺满档贴正文列右缘（余量计入）', m5.panel.open && diff5 > 14 &&
    Math.abs(Number.parseFloat(m5.panel.styleRight) - expected5) <= EPS,
    `diff=${diff5.toFixed(1)} styleRight=${m5.panel.styleRight}`)

  // —— B6：窗口缩放跟随（视口 1000→1200）——
  await page.evaluate(() => window.setSettings({ 'editor.readableLineWidth': 600 }))
  await page.waitForTimeout(120)
  await page.setViewportSize({ width: 1200, height: 700 })
  await page.waitForTimeout(200)
  const m6 = await measure()
  check('B6 缩放视口后仍咬合', Math.abs(m6.panel.right - m6.contentRight) <= EPS,
    `面板右=${m6.panel.right.toFixed(1)} 正文列右=${m6.contentRight.toFixed(1)}`)

  if (errors.length) {
    failures.push(`页面错误: ${errors.join(' | ')}`)
  }
} finally {
  await browser.close()
}
if (failures.length) {
  console.error(`\nfindBarAnchor 失败 ${failures.length} 项`)
  process.exit(1)
}
console.log('\nfindBarAnchor 全部通过')
