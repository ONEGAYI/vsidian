// 图片尺寸后缀浏览器验收（#635）：真实 Chromium + 生产控制器 + 产物 CSS，
// 断言用户看到的绘制层几何——不是 DOM 属性存在性。
//
// 覆盖规格 §9.2 的尺寸矩阵（不含拖动，拖动归 #636）：
//   S1 |W   等比：渲染宽 = W，高按固有比例
//   S2 |WxH 拉伸：渲染宽高恰为 W×H（不保持比例，官方语义）
//   S3 |N%  百分比：渲染宽 = 固有宽 × N%
//   S4 非法值降级：渲染宽 = 固有宽，alt 保留原后缀
//   S5 七个渲染面：Live 独行 / Live 行内混排 / Reading / 表格格内 / 链接内
//   S6 双链嵌入与 Markdown 直链两种语法同尺寸（同源一致性）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'imageSize/imageSize.js')
await build({
  entryPoints: [path.join(root, 'test/browser/liveImageLayoutFixture.ts')],
  bundle: true,
  outfile: output,
  format: 'iife',
  loader: { '.svg': 'file' },
  assetNames: 'assets/[name]',
})

const browser = await chromium.launch({
  headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined,
})
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}
/** 几何容差：亚像素舍入 */
const near = (actual, expected, tolerance = 1.5) => Math.abs(actual - expected) <= tolerance

// 固有 200×100 的 PNG（宽高比 2:1），用 SVG 更易控制固有尺寸
const intrinsic = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="200" height="100" fill="#3366cc"/></svg>')

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((url) => {
    for (const src of ['./img.png', 'img.png', '../img.png']) window.serveImg(src, url)
  }, intrinsic)

  /** 读取当前视图内全部图片槽位的绘制层几何 */
  const measure = () => page.evaluate(() => {
    // 两种模式的容器同时存在于 DOM（非活动侧 display:none），必须按可见性
    // 取，否则会量到隐藏容器的 0×0 几何
    const reading = document.querySelector('.vsidian-view-reading')
    const readingVisible = reading !== null && reading.getBoundingClientRect().width > 0
    const root = readingVisible ? reading : document.querySelector('.cm-content')
    const slots = Array.from(root?.querySelectorAll('.vsidian-image') ?? [])
    return slots.map((slot) => {
      const img = slot instanceof HTMLImageElement ? slot : slot.querySelector('img')
      const rect = img ? img.getBoundingClientRect() : null
      return {
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0,
        naturalWidth: img instanceof HTMLImageElement ? img.naturalWidth : 0,
        naturalHeight: img instanceof HTMLImageElement ? img.naturalHeight : 0,
        alt: img?.getAttribute('alt') ?? '',
        attrWidth: img?.getAttribute('width') ?? null,
        attrHeight: img?.getAttribute('height') ?? null,
        styleWidth: (img instanceof HTMLElement ? img.style.width : '') || null,
        loaded: slot.getAttribute('data-vsidian-img-state') === 'loaded',
      }
    })
  })

  /** 装载一份只含单张图的文档到指定模式并等图加载完成。
   *  前导段落把光标留在首行、让图片独占一行——光标落在嵌入区间内会按
   *  设计显源码（widget 退场），验收要的是渲染态几何。 */
  async function load(mode, line, { prefix = true } = {}) {
    const doc = prefix ? `前导段落

${line}` : line
    await page.evaluate((text) => window.initImgDoc(text), doc)
    await page.evaluate((m) => window.setImgMode(m), mode)
    await page.waitForFunction((m) => {
      const root = m === 'reading'
        ? document.querySelector('.vsidian-view-reading')
        : document.querySelector('.cm-content')
      const slots = Array.from(root?.querySelectorAll('.vsidian-image') ?? [])
      const img = slots[0]?.querySelector('img') ?? (slots[0] instanceof HTMLImageElement ? slots[0] : null)
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
    }, mode, { timeout: 5000 })
    await page.waitForTimeout(120) // 让尺寸属性参与布局后再量
  }

  // ---- S1：|W 等比（Live 双链嵌入） ----
  await load('live', '![[img.png|100]]')
  let m = (await measure())[0]
  check('S1 |W 等比宽度', near(m.width, 100), `w=${m.width.toFixed(1)} expected=100`)
  check('S1 |W 等比高度', near(m.height, 50), `h=${m.height.toFixed(1)} expected=50（200×100 的一半）`)
  check('S1 alt 不含尺寸后缀', m.alt === '', `alt=${JSON.stringify(m.alt)}`)

  // ---- S2：|WxH 拉伸（不保持比例） ----
  await load('live', '![[img.png|300x300]]')
  m = (await measure())[0]
  check('S2 |WxH 固定宽', near(m.width, 300), `w=${m.width.toFixed(1)} expected=300`)
  check('S2 |WxH 固定高（拉伸不保比例）', near(m.height, 300), `h=${m.height.toFixed(1)} expected=300`)

  // ---- S3：|N% 百分比 ----
  await load('live', '![[img.png|50%]]')
  m = (await measure())[0]
  check('S3 |N% 宽度 = 固有宽 × 50%', near(m.width, 100), `w=${m.width.toFixed(1)} expected=100`)

  // ---- S4：非法值降级 ----
  await load('live', '![[img.png|0]]')
  m = (await measure())[0]
  check('S4 非法值渲染宽 = 固有宽', near(m.width, 200), `w=${m.width.toFixed(1)} expected=200`)
  check('S4 非法值后缀留在 alt（不静默改写）', m.alt.includes('0'), `alt=${JSON.stringify(m.alt)}`)

  // ---- S5a：Reading 面 ----
  await load('reading', '![[img.png|120]]')
  m = (await measure())[0]
  check('S5 Reading |W 生效', near(m.width, 120), `w=${m.width.toFixed(1)} expected=120`)

  // ---- S5b：Markdown 直链（Reading） ----
  await load('reading', '![图注|140](img.png)')
  m = (await measure())[0]
  check('S5 直链 |W 生效', near(m.width, 140), `w=${m.width.toFixed(1)} expected=140`)
  check('S5 直链 alt 剥离尺寸', m.alt === '图注', `alt=${JSON.stringify(m.alt)}`)

  // ---- S5c：表格格内 ----
  // 表格必须从行首起（前导段落会把它并成段落续行，表格语法即失效）；
  // 格内竖线转义成 `\|` 由 GFM 拆分解码回 `|`（规格 §10 的既有口径）
  await load('reading', '| 图 | 说明 |\n| --- | --- |\n| ![[img.png\\|90]] | 格内 |', { prefix: false })
  await page.waitForTimeout(200)
  m = (await measure())[0]
  check('S5 表格格内 |W 生效', near(m.width, 90), `w=${m.width?.toFixed(1)} expected=90`)

  // ---- S6：两种语法同尺寸（直链的尺寸写在标签里，不在目标 URL 里） ----
  await load('reading', '![图注|160](img.png)\n\n![[img.png|160]]')
  await page.waitForTimeout(200)
  const [direct, embed] = await measure()
  check('S6 直链与嵌入同宽', near(direct.width, 160) && near(embed.width, 160),
    `direct=${direct.width.toFixed(1)} embed=${embed.width.toFixed(1)} expected=160`)

  check('无页面错误', errors.length === 0, errors.join('; ') || 'none')
} finally {
  await browser.close()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败:\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log('\n全部通过')
}
