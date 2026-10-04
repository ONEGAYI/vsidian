// #336（P3-04）图片双链嵌入浏览器回归：同一文件两种嵌入语法
// （![[图.png]] 与 ![](图.png)）的真实绘制层一致性（尺寸/像素/chrome/
// 独行块布局）、弹窗排除矩阵（链接内/表格格内无 chrome——不放宽）、悬停
// 图片浮层（image 载荷渲染 + 查看大图入口）、嵌入内容 B 中图片按 B 解
// 析（sourceDocUri 载荷）、SVG 恶意样本不执行脚本、格式解码下界矩阵与
// 失败分态。宿主回包经 fixture 替身注入（handleHostMessage 同入口）；全
// 程断言零文档写回（无 edit.request）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'imageEmbedParity/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/imageEmbedParityFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><head>${islandHtml}</head><body class="vscode-light"><div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: sans-serif; --vscode-editor-background: #ffffff; --vscode-editor-foreground: #222222; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  const sent = () => page.evaluate(() => window.sent336())
  const editRequests = () => page.evaluate(() => window.sent336().filter((m) => m.kind === 'edit.request').length)
  const hoverRequests = () => page.evaluate(() => window.sent336().filter((m) => m.kind === 'hover.request'))
  const imageRequests = () => page.evaluate(() => window.sent336().filter((m) => m.kind === 'image.request'))

  // ---- 场景 1：Reading 双语法绘制层一致性（尺寸/像素/chrome/独行块） ----
  const bluePng = await page.evaluate(() => window.makeDataPng(30, 60, 210, 48, 36))
  await page.evaluate((url) => window.serveImg336('assets/par.png', url), bluePng)
  const PARITY_DOC = [
    '# 双语法对照',
    '',
    '![](assets/par.png)',
    '',
    '![[assets/par.png]]',
    '',
    '混排 ![[assets/par.png|别名]] 与文字。',
    '',
    '| 图 | 说明 |',
    '| --- | --- |',
    '| ![[assets/par.png]] | 单元格文字 |',
    '',
    '链接内 [外链 ![[assets/par.png]] 文字](https://example.com)。',
    '',
    '见 [[assets/hover.png]] 双链与 [普通链接](assets/hover.png)。',
    '',
    '结尾段。',
    '',
  ].join('\n')
  await page.evaluate((text) => window.initDoc336(text), PARITY_DOC)
  await page.evaluate(() => window.setMode336('reading'))
  await page.waitForFunction(() => window.slotsOf('assets/par.png').filter((s) => s.state === 'loaded').length >= 5,
    null, { timeout: 8000, polling: 100 })

  const parSlots = await page.evaluate(() => window.slotsOf('assets/par.png'))
  // 主视图共 5 枚 par.png 槽位：独行标准、独行嵌入、混排嵌入、表格格内、链接内
  assert.equal(parSlots.length, 5, `预期 5 枚 par.png 槽位，实际 ${JSON.stringify(parSlots)}`)
  const [soloStd, soloEmbed, mixedEmbed, tableEmbed, linkEmbed] = parSlots

  // 独行两语法：同宽同高（块级布局）+ 同 chrome 按钮组
  assert.ok(Math.abs(soloStd.width - soloEmbed.width) <= 1,
    `独行两语法渲染宽应一致（标准 ${soloStd.width} vs 嵌入 ${soloEmbed.width}）`)
  assert.ok(Math.abs(soloStd.height - soloEmbed.height) <= 1, '独行两语法渲染高应一致')
  assert.equal(soloStd.block, true, '独行标准图取块级布局')
  assert.equal(soloEmbed.block, true, '独行图片嵌入取块级布局（与标准一致）')
  assert.equal(soloStd.chromeButtons, soloEmbed.chromeButtons, '独行两语法 chrome 按钮组一致')
  assert.ok(soloStd.chromeButtons > 0, '独行标准图有 chrome 按钮（查看大图入口）')

  // 像素级一致（绘制层证据：canvas 采样两图中心像素同色）
  const pixels = await page.evaluate(() => window.sampleSlotsOf('assets/par.png', 2))
  const p0 = pixels[0]
  const p1 = pixels[1]
  assert.ok(p0 && p1 && Math.abs(p0.b - p1.b) <= 8 && p0.b > 150 && p0.r < 90,
    `独行两语法中心像素应一致且为蓝色系（标准 ${JSON.stringify(p0)} vs 嵌入 ${JSON.stringify(p1)}）`)

  // 混排嵌入：行内形态（非块级）+ 有 chrome
  assert.equal(mixedEmbed.block, false, '混排图片嵌入保持行内形态（与混排标准图一致）')
  assert.equal(mixedEmbed.chromeButtons > 0, true, '混排图片嵌入挂 chrome 按钮')

  // 排除矩阵：表格格内与链接内不挂 chrome（弹窗排除不放宽——允许显示
  // 不等于允许弹窗）
  assert.equal(tableEmbed.inTable, true, '表格格内图片嵌入照常显示')
  assert.equal(tableEmbed.chromeButtons, 0, '表格格内图片嵌入无 chrome（弹窗排除矩阵保持）')
  assert.equal(linkEmbed.inLink, true, '链接内图片嵌入照常显示（点击走链接语义）')
  assert.equal(linkEmbed.chromeButtons, 0, '链接内图片嵌入无 chrome（弹窗排除矩阵保持）')

  // 图片嵌入不建卡片壳：主视图无 par.png 嵌入卡片
  const cardCount = await page.evaluate(() => document.querySelectorAll('.vsidian-embed-card').length)
  assert.equal(cardCount, 0, '图片嵌入不新增文件名引用卡片壳')

  // ---- 场景 2：Live 双语法绘制层一致性 ----
  await page.evaluate(() => window.setMode336('live'))
  await page.waitForFunction(() => window.slotsOf('assets/par.png').filter((s) => s.state === 'loaded').length >= 3,
    null, { timeout: 8000, polling: 100 })
  const liveSlots = await page.evaluate(() => window.slotsOf('assets/par.png'))
  // Live 主视图：独行标准 + 独入嵌入 + 混排嵌入（表格格内/链接内为源码
  // 降级或无 chrome 形态——数量下界取 3）
  assert.ok(liveSlots.length >= 3, `Live 侧应至少 3 枚 par.png 槽位，实际 ${liveSlots.length}`)
  const liveSoloStd = liveSlots.find((s) => s.block && s.chromeButtons > 0)
  const liveSoloEmbed = liveSlots.filter((s) => s.block && s.chromeButtons > 0)[1]
  assert.ok(liveSoloEmbed, 'Live 独行图片嵌入应有块级 chrome 形态')
  assert.ok(Math.abs(liveSoloStd.width - liveSoloEmbed.width) <= 1,
    `Live 独行两语法渲染宽应一致（${liveSoloStd.width} vs ${liveSoloEmbed.width}）`)
  const liveTable = liveSlots.find((s) => s.inTable)
  if (liveTable) {
    assert.equal(liveTable.chromeButtons, 0, 'Live 表格格内图片嵌入无 chrome（排除矩阵保持）')
  }

  // 触及源码显形（Live 图片嵌入与标准图同款光标语义）：光标置于嵌入区间
  // 内 → widget 撤下、源码可见（同一选择器语义，不发行下方卡片 widget）
  const embedAt = PARITY_DOC.indexOf('![[assets/par.png]]')
  const soloStdAt = PARITY_DOC.indexOf('![](assets/par.png)')
  assert.ok(embedAt >= 0 && soloStdAt >= 0, 'Live 源文坐标在文档内（图片嵌入与标准图源码）')
  await page.evaluate((pos) => window.setLiveCursor336(pos), embedAt + 3)
  await page.waitForFunction(() => window.slotsOf('assets/par.png').length <= 4, null, { timeout: 4000, polling: 100 })
  const touchedSlots = await page.evaluate(() => window.slotsOf('assets/par.png'))
  assert.equal(touchedSlots.some((s) => s.state === 'loaded' && s.block && s.chromeButtons > 0) === false
    || touchedSlots.filter((s) => s.block && s.chromeButtons > 0).length === 1,
    true, '触及的图片嵌入撤下 widget（源码显形）——其余独行图保持在场')
  await page.evaluate((pos) => window.setLiveCursor336(pos), 0)
  await page.waitForFunction(() => window.slotsOf('assets/par.png').filter((s) => s.state === 'loaded' && s.block).length >= 2,
    null, { timeout: 4000, polling: 100 })

  // ---- 场景 3：悬停图片浮层（image 载荷渲染 + 查看大图入口） ----
  const greenPng = await page.evaluate(() => window.makeDataPng(30, 200, 60, 60, 40))
  await page.evaluate((url) => window.serveImg336('assets/hover.png', url), greenPng)
  await page.evaluate(() => window.setMode336('reading'))
  const anchor = page.locator('a.vsidian-wikilink', { hasText: 'assets/hover.png' }).first()
  await anchor.hover()
  await page.waitForFunction(() => window.sent336().some((m) => m.kind === 'hover.request'), null, { timeout: 4000, polling: 50 })
  const hoverReq = (await hoverRequests())[0]
  assert.equal(hoverReq.target, 'assets/hover.png', '悬停图片双链的读取请求携带目标原文')
  await page.evaluate(({ reqId, instanceId }) => window.respondHost({
    kind: 'hover.result', reqId, instanceId, ok: true, contentKind: 'image',
    target: { fsPath: 'D:\\notes\\assets\\hover.png', relPath: 'assets/hover.png' },
    version: 1760000000123, imageSrc: 'assets/hover.png',
    text: '', range: { start: 0, end: 0 }, scope: { kind: 'plain' },
  }), { reqId: hoverReq.reqId, instanceId: hoverReq.instanceId })
  await page.waitForFunction(() => window.readPopupImage().state === 'loaded', null, { timeout: 8000, polling: 100 })
  const popupImg = await page.evaluate(() => window.readPopupImage())
  assert.equal(popupImg.rawSrc, 'assets/hover.png', '浮层图片槽位携带宿主载荷图源')
  assert.ok(popupImg.pixel && popupImg.pixel.g > 150 && popupImg.pixel.r < 90,
    `浮层图片应在绘制层呈现绿色（实际 ${JSON.stringify(popupImg.pixel)}）`)
  assert.ok(popupImg.chromeButtons > 0, '浮层图片挂查看大图入口（既有图片弹窗路径）')
  // 浮层图片的图源请求按面板文档解析（非来源化——无 sourceDocUri）
  const popupImgReq = (await imageRequests()).find((m) => m.src === 'assets/hover.png')
  assert.ok(popupImgReq, '浮层图片经 image.request 装载')
  assert.equal('sourceDocUri' in popupImgReq, false, '浮层图片图源按面板文档解析（非来源化）')
  // 查看大图：悬停浮现按钮组（CSS hover 显隐）后点击 popup 按钮
  await page.hover('.vsidian-hover-popup .vsidian-graphic-frame')
  await page.click('.vsidian-hover-popup .vsidian-graphic-frame .vsidian-graphic-chrome button')
  await page.waitForFunction(() => window.imagePopupOpen(), null, { timeout: 4000, polling: 50 })
  assert.ok(await page.evaluate(() => window.imagePopupOpen()), '点击查看大图打开既有图片弹窗')

  // ---- 场景 4：嵌入内容 B 中图片按 B 解析（sourceDocUri = B） ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  const redPng = await page.evaluate(() => window.makeDataPng(220, 40, 40, 40, 30))
  await page.evaluate((url) => window.serveImg336('b-assets/b图.png', url), redPng)
  await page.evaluate(() => window.initDoc336('# 父文档\n\n![[B笔记]]\n\n结尾。\n'))
  await page.evaluate(() => window.setMode336('reading'))
  await page.waitForFunction(() => window.sent336().some((m) => m.kind === 'hover.request'), null, { timeout: 4000, polling: 50 })
  const bReq = (await hoverRequests()).at(-1)
  assert.equal(bReq.target, 'B笔记')
  const B_TEXT = '# B 笔记\n\n内嵌图片 ![[b-assets/b图.png|B 内图片]]。\n'
  await page.evaluate(({ reqId, instanceId, text }) => window.respondHost({
    kind: 'hover.result', reqId, instanceId, ok: true, contentKind: 'markdown',
    target: { fsPath: 'D:\\notes\\sub\\B笔记.md', relPath: 'sub/B笔记.md' },
    version: 2, text,
    range: { start: 0, end: text.length }, scope: { kind: 'full' },
  }), { reqId: bReq.reqId, instanceId: bReq.instanceId, text: B_TEXT })
  await page.waitForFunction(() => document.querySelector('.vsidian-embed-card img') !== null,
    null, { timeout: 8000, polling: 100 })
  const bImgReq = (await imageRequests()).find((m) => m.src === 'b-assets/b图.png')
  assert.ok(bImgReq, 'B 内容中的图片嵌入经 image.request 装载')
  assert.equal(bImgReq.sourceDocUri, 'D:\\notes\\sub\\B笔记.md',
    'B 内图片按 B 解析（sourceDocUri = B 身份）')
  const bPixel = await page.evaluate(() => window.sampleCenter(document.querySelector('.vsidian-embed-card .vsidian-image')))
  assert.ok(bPixel && bPixel.r > 150 && bPixel.g < 100,
    `B 内图片按 B 解析装载并在绘制层呈现红色（实际 ${JSON.stringify(bPixel)}）`)

  // ---- 场景 5：SVG 安全（非交互 img 资源加载，脚本不执行） ----
  const evilSvg = await page.evaluate(() => window.makeEvilSvg())
  await page.evaluate((url) => window.serveImg336('assets/evil.svg', url), evilSvg)
  await page.evaluate(() => window.initDoc336('# SVG 安全\n\n![[assets/evil.svg]]\n\n结尾。\n'))
  await page.evaluate(() => window.setMode336('reading'))
  await page.waitForFunction(() => window.slotsOf('assets/evil.svg').filter((s) => s.state === 'loaded').length >= 1,
    null, { timeout: 8000, polling: 100 })
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.svgScriptFlag()), false,
    'SVG 内 script 与 onload 不得执行（img 资源加载形态，无脚本执行面）')
  assert.equal(await page.evaluate(() => document.querySelectorAll('object, iframe').length), 0,
    '不以 object/iframe 执行 SVG')
  const svgPixel = await page.evaluate(() => window.sampleCenter(document.querySelector('.vsidian-image')))
  assert.ok(svgPixel && svgPixel.r > 120 && svgPixel.g < 100, 'SVG 位图在绘制层实际呈现')

  // ---- 场景 6：失败分态与格式解码下界矩阵 ----
  // 失败：目标不存在 → error 态 + notfound 细分（与普通图片同一状态机）
  await page.evaluate(() => window.serveImg336('assets/缺失.png', null))
  await page.evaluate(() => window.initDoc336('# 失败分态\n\n![[assets/缺失.png]]\n\n结尾。\n'))
  await page.evaluate(() => window.setMode336('reading'))
  await page.waitForFunction(() => window.slotsOf('assets/缺失.png').filter((s) => s.state === 'error').length >= 1,
    null, { timeout: 8000, polling: 100 })
  const errSlot = (await page.evaluate(() => window.slotsOf('assets/缺失.png')))[0]
  assert.equal(errSlot.reason, 'not-found', '缺失图片嵌入的失败细分为 not-found（与普通图片同源）')

  // 解码下界矩阵（管线内实测：各格式在真实生产管线装载到 loaded）
  const uris = await page.evaluate(async () => ({
    png: window.makeDataPng(10, 120, 10, 16, 16),
    jpeg: window.makeDataUri('image/jpeg', 0.9),
    webp: window.makeDataUri('image/webp', 0.9),
    svg: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3c3"/></svg>'),
    bmp: window.makeDataBmp(200, 120, 30),
    apng: await window.makeApng(120, 30, 180),
    avif: 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=',
  }))
  const matrix = []
  for (const name of Object.keys(uris)) {
    const uri = uris[name]
    const decoded = await page.evaluate((u) => window.probeDecode(u), uri)
    await page.evaluate(({ n, url }) => window.serveImg336(`assets/f.${n}`, url), { n: name, url: uri })
    await page.evaluate((n) => window.initDoc336(`# ${n}\n\n![[assets/f.${n}]]\n\n结尾。\n`), name)
    await page.evaluate(() => window.setMode336('reading'))
    let loaded = false
    try {
      await page.waitForFunction((n) =>
        window.slotsOf(`assets/f.${n}`).some((s) => s.state === 'loaded' || s.state === 'error'), name,
        { timeout: 6000, polling: 100 })
      loaded = await page.evaluate((n) => window.slotsOf(`assets/f.${n}`).some((s) => s.state === 'loaded'), name)
    } catch {
      loaded = false
    }
    matrix.push({ name, loaded, decoded })
  }
  // 支持矩阵实测记录（PNG/JPEG/GIF/WebP/SVG/BMP/APNG/AVIF）：管线 loaded
  // 态与解码器探测一致；支持格式必须 loaded（GIF 用标准 ![]() 形态另行
  // 覆盖——见下方补充）
  for (const entry of matrix) {
    assert.equal(entry.loaded, entry.decoded,
      `${entry.name}：管线装载态应与解码器实测一致（loaded=${entry.loaded} decoded=${entry.decoded}）`)
  }
  const required = ['png', 'jpeg', 'webp', 'svg', 'bmp', 'apng']
  for (const name of required) {
    const entry = matrix.find((m) => m.name === name)
    assert.equal(entry.loaded, true, `${name} 应在支持下界内（实测 loaded）`)
  }
  console.log('格式解码下界矩阵（实测）:', JSON.stringify(matrix))

  // GIF（著名 1x1 透明样本，经标准嵌入语法）
  const gifLoaded = await page.evaluate(async () => {
    const uri = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    window.serveImg336('assets/f.gif', uri)
    window.initDoc336('# gif\n\n![[assets/f.gif]]\n\n结尾。\n')
    window.setMode336('reading')
    return await new Promise((resolve) => {
      const started = performance.now()
      const poll = () => {
        if (window.slotsOf('assets/f.gif').some((s) => s.state === 'loaded')) resolve(true)
        else if (performance.now() - started > 6000) resolve(false)
        else setTimeout(poll, 100)
      }
      poll()
    })
  })
  assert.equal(gifLoaded, true, 'GIF 应在支持下界内（实测 loaded）')

  // ---- 全程零文档写回 ----
  assert.equal(await editRequests(), 0, '图片嵌入/悬停/弹窗全程零文档写回（无 edit.request）')
  assert.deepEqual(errors, [], '无页面错误')

  await browser.close()
} catch (err) {
  await browser.close().catch(() => {})
  throw err
}
console.log('imageEmbedParity: 全部断言通过')
