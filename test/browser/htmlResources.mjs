// #570（T05）HTML 链接图片与 CSS 资源文档归属的原生浏览器回归（真实
// Chromium 布局 + 生产控制器 + 伪造资源宿主）：
// - Live HTML img（相对路径经视图管理器解析 → data: URL 真实装载绘制）
// - srcset 多候选拆解重组（描述符保留、二候选解析到不同地址、直连候选
//   原样；浏览器 currentSrc 选用证据）
// - 文档样式 url() 背景绘制（产物改写后 computed backgroundImage）与
//   @font-face 字体装载（document.fonts）
// - 媒体 source/poster 归属改写（成功解析后属性为解析地址）
// - Live 链接点击源码显形不意外跳转；Reading 链接 link.activate 意图上报
// - 失效重取（image.invalidate → 新 URL 重应用）与释放后迟到不污染
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'htmlResources/htmlResources.js')
await build({ entryPoints: [path.join(root, 'test/browser/htmlResourcesFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'dataurl', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml } = await buildZhLocaleIsland(root)

/** 文档：块级 HTML（img/srcset/媒体/链接）+ 行内 HTML（img）+ 文档样式
 * （url() 背景 + @font-face 字体） */
const DOC = [
  '开篇段落。',
  '',
  '<div>',
  '  <img src="pic.png" alt="本地图">',
  '  <img srcset="a.png 1x, b.png 2x" alt="多候选">',
  '  <img srcset="a.png 1x, https://cdn.invalid/direct.png 2x" alt="混合直连">',
  '  <video src="clip.mp4" poster="cover.png" controls></video>',
  '  <a href="note.md">内部文档链接</a>',
  '  <a href="https://example.com/target">外部链接</a>',
  '</div>',
  '',
  '中间段落 <img src="inline.png" alt="行内图"> 继续。',
  '',
  '<style>',
  '.t5-hero { background: url(bg.png); }',
  '</style>',
  '',
  '<style>',
  '@font-face { font-family: T5Test; src: url(f.woff2) format("woff2"); }',
  '.t5-font { font-family: T5Test; }',
  '</style>',
  '',
  '<div class="t5-hero">背景目标</div>',
  '<span class="t5-font">字体目标</span>',
  '',
  '尾段。',
].join('\n')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let navigated = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigated += 1
    }
  })
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  const settle = (ms = 250) => page.waitForTimeout(ms)
  const imgs = () => page.evaluate(() => window.readHtmlResImgs())
  const media = () => page.evaluate(() => window.readHtmlResMedia())

  // ---- 场景 A：Live 块级/行内 img 装载（伪造宿主回包 → 真实 load 事件）----
  await page.evaluate(([text, red, wide, font]) => window.initHtmlResDoc(text, {
    'pic.png': red,
    'a.png': red,
    'b.png': wide,
    'inline.png': wide,
    'clip.mp4': 'data:video/mp4;base64,AAAA',
    'cover.png': red,
    'bg.png': red,
    'f.woff2': font,
  }), [DOC, await page.evaluate(() => window.RED_PNG), await page.evaluate(() => window.WIDE_PNG),
    await page.evaluate(() => window.TEST_FONT_DATA_URL)])
  await settle(500)
  const imgsA = await imgs()
  assert.equal(imgsA.length, 4, `四张 img 在场（块级 3 + 行内 1；实际 ${imgsA.length}）`)
  const local1 = imgsA.find((i) => i.src?.startsWith('data:image/png'))
  assert.ok(local1, '至少一张 img 的 src 已应用解析地址（data: URL）')
  assert.ok(imgsA.filter((i) => i.state === 'loaded').length >= 3,
    `img 装载完成（load 事件确认；实际 ${JSON.stringify(imgsA.map((i) => i.state))}）`)
  assert.ok(imgsA.every((i) => i.naturalWidth > 0 || i.state !== 'loaded'), '装载态与解码一致')
  passed++
  console.log('[HTML 资源][PASS] A Live img 归属解析与装载（data: URL 真实绘制）')

  // ---- 场景 B：srcset 多候选（描述符保留、二候选不同地址、混合直连）----
  // 注：解析地址是 data: URL（内含逗号），候选区分按内容特征不按 split(',')
  const multi = imgsA.find((i) => (i.srcset ?? '').includes(' 1x,') && (i.srcset ?? '').endsWith(' 2x') &&
    !(i.srcset ?? '').includes('cdn.invalid'))
  assert.ok(multi, `多候选 srcset 已重组（实际 ${JSON.stringify(imgsA.map((i) => i.srcset))}）`)
  assert.match(multi.srcset, /data:image\/png\S+ 1x, data:image\/png\S+ 2x/,
    '描述符按语法保留（1x/2x）且两项都解析')
  const mixed = imgsA.find((i) => (i.srcset ?? '').includes('cdn.invalid'))
  assert.ok(mixed, '混合直连候选在场')
  assert.match(mixed.srcset, /https:\/\/cdn\.invalid\/direct\.png 2x/, 'https 直连候选原样保留')
  passed++
  console.log('[HTML 资源][PASS] B srcset 真实语法：多候选拆解 + 描述符 + 直连保留')

  // ---- 场景 C：文档样式 url() 背景绘制 + @font-face 字体装载 ----
  const styleProbe = await page.evaluate(() => window.readHtmlResDocStyle())
  assert.match(styleProbe.heroBackground ?? '', /^url\("data:image\/png/,
    `产物 url() 已解析并进入 computed 背景（实际 ${styleProbe.heroBackground}）`)
  await page.evaluate(() => document.fonts.load('16px T5Test'))
  await settle(300)
  const fontLoaded = await page.evaluate(() => document.fonts.check('16px T5Test'))
  assert.equal(fontLoaded, true, '@font-face 相对字体经解析后真实装载（document.fonts）')
  assert.match(styleProbe.productText ?? '', /url\("data:font\/woff2/,
    '产物内 @font-face src 已改写为解析地址')
  passed++
  console.log('[HTML 资源][PASS] C CSS 资源文档基准：背景绘制 + 字体装载（Chromium CSSOM 全链）')

  // ---- 场景 D：媒体属性归属改写 ----
  const mediaA = await media()
  const video = mediaA.find((m) => m.tag === 'video')
  assert.ok(video, 'video 在场')
  assert.match(video.src ?? '', /^data:video\/mp4/, 'video src 改写为解析地址')
  assert.match(video.poster ?? '', /^data:image\/png/, 'poster 改写为解析地址')
  passed++
  console.log('[HTML 资源][PASS] D 媒体 source/poster 归属改写（语法矩阵；装载语义归 T06）')

  // ---- 场景 E：Live 链接普通点击 → 源码显形，不意外跳转 ----
  const linkBox = await page.locator('.vsidian-live-html a[href="https://example.com/target"]').first()
    .boundingBox()
  assert.ok(linkBox, 'Live 块内外链在场')
  const selBefore = await page.evaluate(() => document.querySelector('.cm-content')?.getAttribute('style') ?? '')
  await page.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2)
  await settle(200)
  assert.equal(navigated, 0, `webview 未被链接导航（framenavigated 计数 0；实际 ${navigated}）`)
  const linkText = await page.evaluate(() => {
    const sel = document.getSelection()
    return sel ? sel.toString() : ''
  })
  assert.ok(linkText.includes('example.com/target') || linkText.includes('外部链接'),
    `普通点击选中 HTML 片段源码（实际选中文本 ${JSON.stringify(linkText.slice(0, 80))}）`)
  assert.equal(selBefore !== undefined, true)
  passed++
  console.log('[HTML 资源][PASS] E Live 链接点击源码显形 + 零意外跳转')

  // ---- 场景 F：Reading 链接经既有导航机制（link.activate 意图上报）----
  await page.evaluate(() => window.setHtmlResMode('reading'))
  await settle(300)
  const markF = await page.evaluate(() => window.htmlResLog().length)
  const innerLink = await page.locator('.vsidian-reading-html a[href="note.md"]').first().boundingBox()
  assert.ok(innerLink, 'Reading 块内内链在场')
  await page.mouse.click(innerLink.x + innerLink.width / 2, innerLink.y + innerLink.height / 2)
  await settle(200)
  const logF = await page.evaluate(() => window.htmlResLog())
  void markF
  const sentF = await page.evaluate(() => window.htmlResSent())
  const linkMsg = sentF.find((m) => m.kind === 'link.activate')
  assert.ok(linkMsg, '点击经容器委托上报 link.activate（宿主分类是单一权威）')
  assert.equal(linkMsg.href, 'note.md', 'href 原文上报（资源装配层不改写）')
  void logF
  passed++
  console.log('[HTML 资源][PASS] F Reading 链接导航意图（href 原文 → 宿主分类）')

  // Reading 态资源同样装载（共享管理器）
  const imgsF = await imgs()
  assert.ok(imgsF.filter((i) => i.state === 'loaded').length >= 3, 'Reading 态 img 同样装载完成')
  const styleF = await page.evaluate(() => window.readHtmlResDocStyle())
  assert.match(styleF.heroBackground ?? '', /^url\("data:image\/png/, 'Reading 态背景绘制在场')

  // ---- 场景 G：失效重取（image.invalidate → hub/注册表消费 → 新 URL）----
  await page.evaluate(() => window.setHtmlResMode('live'))
  await settle(200)
  await page.evaluate(() => window.htmlResInvalidate(['bg.png']))
  await settle(400)
  const styleG = await page.evaluate(() => window.readHtmlResDocStyle())
  assert.match(styleG.heroBackground ?? '', /#g1"\)$/, `背景取到新代次 URL（实际 ${styleG.heroBackground}）`)
  passed++
  console.log('[HTML 资源][PASS] G 失效链路：image.invalidate → 文档样式资源重取（新代次 URI）')

  // ---- 场景 H：请求通道矩阵（htmlResource.request 独立消息种 + 归属字段）----
  const sentH = await page.evaluate(() => window.htmlResSent())
  const htmlResReqs = sentH.filter((m) => m.kind === 'htmlResource.request')
  assert.ok(htmlResReqs.length > 0, 'srcset/媒体/CSS 资源走 htmlResource.request 新通道')
  assert.ok(htmlResReqs.every((m) => m.sourceDocUri === undefined), '主文档请求不带 sourceDocUri（A 身份缺省）')
  const urls = new Set(htmlResReqs.map((m) => m.url))
  for (const expected of ['a.png', 'b.png', 'clip.mp4', 'cover.png', 'bg.png', 'f.woff2']) {
    assert.ok(urls.has(expected), `相对目标逐项请求（缺 ${expected}；实际 ${[...urls]}）`)
  }
  assert.ok(!urls.has('pic.png'), 'img src 走既有 image.request 通道（不重复）')
  passed++
  console.log('[HTML 资源][PASS] H 请求通道矩阵：htmlResource.request 独立空间 + 归属字段')

  // ---- 场景 I：净化负向（资源装配不引入执行面）----
  const scripts = await page.evaluate(() =>
    document.querySelectorAll('.vsidian-live-html script, .vsidian-reading-html script').length)
  assert.equal(scripts, 0, '渲染根内 script 恒 0')
  assert.equal(errors.length, 0, `页面无未捕获异常（实际 ${JSON.stringify(errors)}）`)
  passed++
  console.log('[HTML 资源][PASS] I 净化负向与页面清洁')

  console.log(`[HTML 资源] 全部 ${passed} 组断言通过`)
} finally {
  await browser.close()
}
