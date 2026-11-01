// Callout --callout-icon 公开自定义与容器变量绘制层回归（#657/T06）：
// 真实 Chromium + 生产控制器 + 产物 CSS + **真实片段通道**（snippets.snapshot
// → SnippetLoader <link> 装配，blob URL 与 asWebviewUri 同形态）。断言用户
// 看到的东西（AGENTS 视觉层断言）：
// - 默认通道不回归：值未设置时 mask 图标照画、零 DOM 注入
// - 锁版 Lucide ID 注入：类挂载 + svg 可见几何 + 颜色随类型色（明暗两轮）
// - SVG 字符串注入：净化（脚本/事件/外链剥离）后呈现，window 无副作用
// - 非法值：保留默认图标 + console.warn 可查诊断；非法撤销后恢复
// - 片段热更新（保存换版）：图标内容随 sheet 更换即时切换
// - 明暗主题翻转：per-theme 图标值经观察器重解析；mask 默认通道颜色随主题
// - 容器变量：--callout-border-width（阅读四边 + live 左缘近似 box-shadow）
//   与 --callout-blend-mode（暗 lighten / 亮 darken）真实计算值
// - RGB 三元组边界（T01 §6.2）：底色通道吃三元组、图标 currentColor 通道
//   降级继承（非背景通道无法兼容两形态的实测边界）
// - 模式往返与阅读视口重挂后自定义图标仍有效
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutIcon/calloutIcon.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutIconFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const fillers = Array.from({ length: 30 }, (_, i) => `填充段 ${i + 1}，撑起阅读滚动与视口回收窗口。`)
const DOC = [
  '> [!note] 笔记标题',
  '> 笔记正文',
  '',
  '> [!tip] 提示标题',
  '> 提示正文',
  '',
  '> [!important] 重要标题',
  '> 重要正文',
  '',
  '> [!custom-x] 自定义类型',
  '> 自定义正文',
  '',
  ...fillers,
].join('\n')

/** 图标元素观测（live：标题行内 widget；reading：.callout-title 子元素） */
const iconOf = (page, type) => page.evaluate((t) => {
  const el = document.querySelector(`[data-callout='${t}'] .callout-icon`)
    ?? [...document.querySelectorAll('.cm-line[data-callout]')].find((l) => l.getAttribute('data-callout') === t)?.querySelector('.callout-icon')
  if (!el) return null
  const s = getComputedStyle(el)
  const svg = el.querySelector('svg')
  const r = svg?.getBoundingClientRect()
  return {
    custom: el.classList.contains('vsidian-callout-icon-custom'),
    html: el.innerHTML.slice(0, 400),
    color: s.color,
    bgColor: s.backgroundColor,
    mask: s.maskImage ?? s.webkitMaskImage,
    svgW: r ? Math.round(r.width) : 0,
    varValue: s.getPropertyValue('--callout-icon').trim().slice(0, 60),
  }
}, type)

async function waitFor(fn, label, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`等待超时：${label}`)
}

/** 片段应用 + 装载回报等待 + 重解析两帧 */
async function applySnippet(page, css, version) {
  const uri = await page.evaluate((text) => window.snippetUrl(text), css)
  await page.evaluate(({ v, u }) => window.applySnippets(v, [{ name: 't06', uri: u }]), { v: version, u: uri })
  await waitFor(() => page.evaluate((v) => window.iconSent().some((m) => m.kind === 'snippets.loadResult' && m.ok === true && m.version === v), version),
    `片段 v${version} 装载回报`)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

const ZAP_PATH = 'M4 14a1'
const BUG_PATH = 'M14.12 3.88'
const X_PATH = 'M18 6 6 18'
const CLEAN_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='9' /><path d='M4 4 L20 20' /></svg>"
const EVIL_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' onload='window.__pwned = 1'><script>window.__pwned = 2</script><path d='M2 20 L22 4' /><a href='https://evil.example/x'>x</a></svg>"

const V1 = [
  `[data-callout='note'] { --callout-color: #d94f00; --callout-icon: lucide-bug; }`,
  `[data-callout='tip'] { --callout-icon: "${CLEAN_SVG}"; }`,
  `[data-callout='custom-x'] { --callout-icon: "${EVIL_SVG}"; }`,
  `[data-callout='important'] { --callout-icon: lucide-rocket; }`,
  `body.vscode-light [data-callout='important'] { --callout-icon: lucide-x; }`,
].join('\n')

try {
  const page = await browser.newPage({ viewport: { width: 760, height: 640 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const warnLogs = []
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      warnLogs.push(message.text())
    }
  })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initIcon(text), DOC)
  // 光标落文档尾（不触及任何标题行——触及即显形源码、图标 widget 退场）
  await page.evaluate(() => window.locateIcon(window.controller.getView().state.doc.length))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  // ---- 默认通道：值未设置（类型表默认与注册表一致）→ mask 照画、零注入 ----
  let note = await iconOf(page, 'note')
  assert.ok(note, 'live note 图标元素应在场')
  assert.equal(note.custom, false, '默认态不应注入自定义类')
  assert.equal(note.html, '', '默认态零 DOM 注入')
  assert.ok(String(note.mask).includes('data:image/svg+xml'), '默认态走 mask 通道')

  // ---- v1：锁版 ID / SVG 字符串 / 危险 SVG / 非法 ID / per-theme 值 ----
  await applySnippet(page, V1, 1)

  // note：ID 注入 + 标准色覆盖（颜色随类型色）
  note = await waitFor(async () => (await iconOf(page, 'note')).custom ? note : null, 'note 注入').catch(() => null)
  note = await iconOf(page, 'note')
  assert.equal(note.custom, true, '锁版 ID 应注入')
  assert.ok(note.html.includes(BUG_PATH), `bug 造型应注入: ${note.html.slice(0, 80)}`)
  assert.equal(note.color, 'rgb(217, 79, 0)', `注入图标颜色随 --callout-color 标准色: ${note.color}`)
  assert.ok(note.svgW >= 10, `注入 svg 应有可见几何（绘制层，非 DOM 存在性）: ${note.svgW}px`)
  assert.equal(note.mask, 'none', '注入态应关闭 mask 通道')

  // tip：SVG 字符串净化注入（currentColor 随类型青色）
  const tip = await iconOf(page, 'tip')
  assert.equal(tip.custom, true, 'SVG 字符串应注入')
  assert.ok(tip.html.includes('circle'), `净化后 circle 造型在场: ${tip.html.slice(0, 80)}`)
  assert.equal(tip.color, 'rgb(83, 223, 221)', `SVG 图标 currentColor 随类型色（暗 cyan）: ${tip.color}`)

  // custom-x：脚本/事件/外链剥离，几何保留，无页面副作用
  const custom = await iconOf(page, 'custom-x')
  assert.equal(custom.custom, true, '危险 SVG 净化后仍注入（几何可呈现）')
  assert.ok(custom.html.includes('L22 4'), `净化保留 path 几何: ${custom.html.slice(0, 120)}`)
  assert.ok(!custom.html.includes('<script') && !custom.html.includes('onload') && !custom.html.includes('evil.example'),
    `脚本/事件/外链必须剥离: ${custom.html}`)
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'SVG 事件与脚本均不得执行（onload 经 innerHTML 注入会真触发，断言有判别力）')

  // important：非法 ID 保留默认图标 + console.warn 可查诊断
  const important = await iconOf(page, 'important')
  assert.equal(important.custom, false, '非法 ID 不注入')
  assert.equal(important.html, '', '非法 ID 零 DOM 改动')
  assert.ok(String(important.mask).includes('data:image/svg+xml'), '非法 ID 保留默认 mask 图标')
  assert.ok(warnLogs.some((text) => text.includes('lucide-rocket') && text.includes('[vsidian]')),
    `非法图标值应有 console.warn 诊断: ${JSON.stringify(warnLogs)}`)
  assert.deepEqual(pageErrors, [], '页面不得有脚本错误')

  // ---- 明暗主题：per-theme 图标值经观察器重解析；暗轮回恢复默认 ----
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  let importantLight = await iconOf(page, 'important')
  assert.equal(importantLight.custom, true, '亮色 per-theme 值 lucide-x 应注入')
  assert.ok(importantLight.html.includes(X_PATH), `x 造型应注入: ${importantLight.html.slice(0, 80)}`)
  // mask 默认通道颜色随主题（warning 类型的暗/亮橙不同——用 tip 未注入前不可行，
  // 改证 note 注入色在亮色下仍随片段标准色稳定、默认通道由 v3 后置断言覆盖）
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const importantBack = await iconOf(page, 'important')
  assert.equal(importantBack.custom, false, '暗色回到非法值 → 保留默认（诊断去重不再刷屏）')

  // ---- v2：热更新（保存换版）——内容切换 / 边界通道 / 非法撤销 ----
  const V2 = [
    `[data-callout='note'] { --callout-color: #d94f00; --callout-icon: lucide-zap; }`,
    `[data-callout='tip'] { --callout-color: 255, 0, 0; --callout-icon: lucide-bug; }`,
    `[data-callout='custom-x'] { --callout-icon: "${CLEAN_SVG}"; }`,
  ].join('\n')
  await applySnippet(page, V2, 2)
  note = await iconOf(page, 'note')
  assert.equal(note.custom, true, '热更新后仍注入')
  assert.ok(note.html.includes(ZAP_PATH), `热更新应把 bug 切换为 zap: ${note.html.slice(0, 80)}`)
  const tip2 = await iconOf(page, 'tip')
  assert.ok(tip2.html.includes(BUG_PATH), `tip 换为 bug 注入: ${tip2.html.slice(0, 80)}`)
  // §6.2 边界：三元组吃底色通道（bgc rgba(255,0,0,.1)）、currentColor 通道降级继承
  const tipRow = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-callout-wrap[data-callout="tip"]')
    const s = getComputedStyle(el)
    return { bgc: s.backgroundColor, img: s.backgroundImage }
  })
  assert.equal(tipRow.bgc, 'rgba(255, 0, 0, 0.1)', `三元组底色通道应绘制: ${tipRow.bgc}`)
  assert.notEqual(tip2.color, 'rgb(255, 0, 0)', `图标颜色通道不吃三元组（降级继承，§6.2 实测边界）: ${tip2.color}`)
  // 非法撤销：important 回到默认 flame（等于注册表默认 → mask 通道，不再诊断）
  const importantV2 = await iconOf(page, 'important')
  assert.equal(importantV2.custom, false, '撤销非法值后回默认通道')

  // ---- v3：撤下 note 自定义 → 默认恢复（摘链无装载回报，走 apply 后调度）；
  // tip 保留自定义供阅读/往返/重挂断言；border 变量供容器断言 ----
  const V3 = [
    `[data-callout='tip'] { --callout-color: 255, 0, 0; --callout-icon: lucide-bug; }`,
    `[data-callout] { --callout-border-width: 2px; }`,
  ].join('\n')
  await applySnippet(page, V3, 3)
  note = await iconOf(page, 'note')
  assert.equal(note.custom, false, '片段撤下自定义后应回默认通道')
  assert.equal(note.html, '', '注入内容应清除')
  assert.ok(String(note.mask).includes('data:image/svg+xml'), '默认 mask 恢复')

  // ---- 容器变量：border（T05 起 live wrapper 四边真 border + 阅读四边）与 blend ----
  const wrapBorder = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-callout-wrap[data-callout="note"]')
    const s = getComputedStyle(el)
    return { left: s.borderLeftWidth, top: s.borderTopWidth, color: s.borderLeftColor }
  })
  assert.ok(wrapBorder.left.includes('2px'), `live wrapper 左边框应消费宽度变量: ${wrapBorder.left}`)
  assert.ok(wrapBorder.top.includes('2px'), `live wrapper 四边完整消费（非仅左缘近似）: ${wrapBorder.top}`)

  // ---- 模式往返：阅读侧同样注入；blend/border 真实计算值 ----
  await page.evaluate(() => window.setIconMode('reading'))
  await page.waitForSelector('.vsidian-view-reading .callout')
  const readingTip = await iconOf(page, 'tip')
  assert.equal(readingTip.custom, true, '阅读侧应同样注入自定义图标')
  assert.ok(readingTip.html.includes(BUG_PATH), `阅读侧 bug 造型在场: ${readingTip.html.slice(0, 80)}`)
  const container = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-view-reading div.callout[data-callout="note"]')
    const s = getComputedStyle(el)
    return { bw: s.borderWidth, bc: s.borderColor, blend: s.mixBlendMode }
  })
  assert.equal(container.bw, '2px', `阅读容器 border-width 应消费变量: ${container.bw}`)
  assert.notEqual(container.bc, 'rgba(0, 0, 0, 0)', `border-color 应按 opacity 混合绘制: ${container.bc}`)
  assert.equal(container.blend, 'lighten', `暗色档 blend 应为 lighten（取证值）: ${container.blend}`)
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const blendLight = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-view-reading div.callout[data-callout="note"]')
    return getComputedStyle(el).mixBlendMode
  })
  assert.equal(blendLight, 'darken', `亮色档 blend 应为 darken（取证值）: ${blendLight}`)
  // 默认 mask 通道颜色随主题（note 未注入：暗 #027aff / 亮 #086ddd）
  const noteLightIcon = await iconOf(page, 'note')
  assert.equal(noteLightIcon.custom, false, '默认通道保持')
  assert.equal(noteLightIcon.bgColor, 'rgb(8, 109, 221)', `mask 图标底色应随亮色主题类型色: ${noteLightIcon.bgColor}`)
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  // ---- 阅读视口重挂：滚出再滚回，块重挂后自定义图标仍有效 ----
  const scrolled = await page.evaluate(() => {
    const c = document.querySelector('.vsidian-view-reading')
    c.scrollTop = c.scrollHeight // 滚到底（顶部块卸载）
    return c.scrollTop > 0
  })
  assert.ok(scrolled, '文档应可滚动（视口回收前提）')
  await page.evaluate(() => { document.querySelector('.vsidian-view-reading').scrollTop = 0 })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const tipAfterRemount = await waitFor(async () => {
    const v = await iconOf(page, 'tip')
    return v && v.custom ? v : null
  }, '重挂后 tip 图标恢复注入')
  assert.ok(tipAfterRemount.html.includes(BUG_PATH), `视口重挂后自定义图标应重新解析: ${tipAfterRemount.html.slice(0, 80)}`)

  // ---- 模式切回 live：行级形态恢复且自定义图标仍生效 ----
  await page.evaluate(() => window.setIconMode('live'))
  const tipLive = await waitFor(async () => {
    const v = await iconOf(page, 'tip')
    return v && v.custom ? v : null
  }, '切回 live 后 tip 图标注入')
  assert.ok(tipLive.html.includes(BUG_PATH), '模式往返后 live 自定义图标仍生效')

  assert.deepEqual(pageErrors, [], '页面不得有脚本错误')
  console.log('calloutIcon: 全部断言通过（ID/SVG 注入 × 净化 × 非法诊断 × 热更新 × 明暗主题 × 容器变量 × 模式往返 × 视口重挂）')
} finally {
  await browser.close()
}
