// 骨架屏回归套件（#292）：真实 Chromium + 生产控制器 + 宿主同源内联装配，
// 断言用户看到的东西（AGENTS 视觉层断言）：
//   S1 空窗①观感：仅样式+标记时骨架整页覆盖且底色不透明
//   S2 空窗②收编：骨架在工具栏下方（top≈工具栏底缘），不遮工具栏
//   S3 宽度口径：列宽引用 --vsidian-live-preview-max-width（600 档跟随；
//      铺满档与可用宽一致）——不复制读值
//   S4 扫光：名称/延时/周期与撤除计划同源常量一致（绘制层）
//   S5 reduced-motion：扫光关闭（静态灰块）
//   S6 撤除：release 后退场且宿主类还原；无 hold 路径 init 后自动撤除
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'skeletonProbe/skeletonProbe.js')
await build({ entryPoints: [path.join(root, 'test/browser/skeletonProbeFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}

const DOC = '# 骨架标题\n\n正文段落甲，足够长以触发首帧绘制。\n\n正文段落乙。\n'

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  // 模拟 VSCode webview 的主题变量注入（真实宿主由预加载脚本提供；
  // 骨架底色/前景派生与正文同源消费这些变量）
  await page.addStyleTag({ content: ':root { --vscode-editor-background: #1f1f1f; --vscode-editor-foreground: #cccccc; --vscode-font-family: monospace; --vscode-font-size: 13px; }' })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  // —— S1：空窗①观感（标记在场、编辑器未挂载）——
  await page.evaluate(() => window.stageSkeleton())
  const s1 = await page.evaluate(() => {
    const sk = document.getElementById('vsidian-skeleton')
    const app = document.getElementById('app')
    if (!sk || !app) return null
    const r = sk.getBoundingClientRect()
    const a = app.getBoundingClientRect()
    return { w: r.width, h: r.height, appW: a.width, appH: a.height,
      bg: getComputedStyle(sk).backgroundColor }
  })
  check('S1 空窗①骨架整页覆盖且底色不透明',
    !!s1 && Math.abs(s1.w - s1.appW) < 2 && Math.abs(s1.h - s1.appH) < 2 &&
      s1.bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(s1.bg),
    `骨架=${s1?.w.toFixed(0)}x${s1?.h.toFixed(0)} app=${s1?.appW.toFixed(0)}x${s1?.appH.toFixed(0)} 底色=${s1?.bg}`)

  // —— S2：空窗②收编（工具栏下方、内容区之上）——
  await page.evaluate((text) => window.initSkeletonProbe(text, { hold: true }), DOC)
  await page.waitForSelector('.vsidian-skeleton-host')
  const s2 = await page.evaluate(() => {
    const sk = document.getElementById('vsidian-skeleton')
    const toolbar = document.querySelector('.vsidian-toolbar')
    const main = document.querySelector('.vsidian-main')
    if (!sk || !toolbar || !main) return null
    const r = sk.getBoundingClientRect()
    const t = toolbar.getBoundingClientRect()
    const m = main.getBoundingClientRect()
    return { top: r.top, toolbarBottom: t.bottom, toolbarH: t.height,
      mainBottom: m.bottom, skBottom: r.bottom, topStyle: sk.style.top }
  })
  check('S2 收编后骨架在工具栏下方且盖到内容区底',
    !!s2 && Math.abs(s2.top - s2.toolbarBottom) < 2 && Math.abs(s2.skBottom - s2.mainBottom) < 2,
    `骨架顶=${s2?.top.toFixed(1)} 工具栏底=${s2?.toolbarBottom.toFixed(1)} 实测top=${s2?.topStyle}`)

  // —— S3：宽度口径跟随 Live 变量 ——
  await page.evaluate(() => {
    document.getElementById('app')?.style.setProperty('--vsidian-live-preview-max-width', '600px')
  })
  const s3Limited = await page.evaluate(() => {
    const col = document.querySelector('.vsidian-skeleton-column')
    return col ? col.getBoundingClientRect().width : null
  })
  check('S3 限宽 600：骨架列宽跟随变量',
    s3Limited !== null && Math.abs(s3Limited - 600) < 2,
    `列宽=${s3Limited?.toFixed(1)}`)
  await page.evaluate(() => {
    document.getElementById('app')?.style.setProperty('--vsidian-live-preview-max-width', 'none')
  })
  const s3Fill = await page.evaluate(() => {
    const col = document.querySelector('.vsidian-skeleton-column')
    const main = document.querySelector('.vsidian-main')
    if (!col || !main) return null
    // border-box：列宽含自身水平 padding，铺满档应与主区宽度一致
    return { colW: col.getBoundingClientRect().width, available: main.getBoundingClientRect().width }
  })
  check('S3 铺满档（none）：骨架列与主区宽一致',
    !!s3Fill && Math.abs(s3Fill.colW - s3Fill.available) < 2,
    `列宽=${s3Fill?.colW.toFixed(1)} 主区=${s3Fill?.available.toFixed(1)}`)

  // —— S4：扫光常量（与撤除计划同源）——
  const s4 = await page.evaluate(() => {
    const block = document.querySelector('.vsidian-skeleton-block')
    if (!block) return null
    const cs = getComputedStyle(block, '::after')
    return { name: cs.animationName, delay: cs.animationDelay, duration: cs.animationDuration }
  })
  check('S4 扫光名称/延时/周期（300ms 延时 + 1500ms 周期）',
    !!s4 && s4.name === 'vsidian-skeleton-sweep' &&
      (s4.delay === '0.3s' || s4.delay === '300ms') &&
      (s4.duration === '1.5s' || s4.duration === '1500ms'),
    `name=${s4?.name} delay=${s4?.delay} duration=${s4?.duration}`)

  // —— S5：reduced-motion 关闭扫光 ——
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const s5 = await page.evaluate(() => {
    const block = document.querySelector('.vsidian-skeleton-block')
    return block ? getComputedStyle(block, '::after').animationName : null
  })
  check('S5 reduced-motion 扫光关闭（静态灰块）',
    s5 === 'none', `animationName=${s5}`)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // —— S6a：release 撤除与宿主类还原 ——
  await page.evaluate(() => window.releaseSkeleton())
  const s6a = await page.waitForFunction(() =>
    document.getElementById('vsidian-skeleton') === null &&
    document.querySelector('.vsidian-skeleton-host') === null, { timeout: 3000 })
  check('S6a release 后骨架退场且宿主类还原', !!s6a, 'waitForFunction 命中')

  // —— S6b：无 hold 路径 init 后自动撤除 ——
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors2 = []
  page2.on('pageerror', (error) => errors2.push(error.message))
  await page2.setContent('<div id="app"></div>')
  await page2.addStyleTag({ content: ':root { --vscode-editor-background: #1f1f1f; --vscode-editor-foreground: #cccccc; --vscode-font-family: monospace; --vscode-font-size: 13px; }' })
  await page2.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page2.addScriptTag({ path: output })
  await page2.evaluate((text) => window.initSkeletonProbe(text), DOC)
  const s6b = await page2.waitForFunction(() =>
    document.getElementById('vsidian-skeleton') === null &&
    document.querySelector('.vsidian-skeleton-host') === null, { timeout: 3000 })
  check('S6b 无冻结路径 init 后自动撤除', !!s6b, 'waitForFunction 命中')
  check('页面无脚本错误', errors.length === 0 && errors2.length === 0,
    JSON.stringify({ errors, errors2 }))

  if (failures.length > 0) {
    console.error(`skeletonProbe: ${failures.length} 条断言红`)
    process.exitCode = 1
  } else {
    console.log('skeletonProbe: 全部断言通过（空窗两段覆盖/宽度跟随/扫光常量/reduced-motion/撤除）')
  }
} finally {
  await browser.close()
}
