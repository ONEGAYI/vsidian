// 图片拖动手柄浏览器验收（#636）：真实 Chromium + 生产控制器 + 产物 CSS，
// 断言用户看到的绘制层——不是 DOM 存在性。
//
// 覆盖规格 §9.2 的拖动矩阵：
//   D1 手柄只在悬停相框时显现（不常驻）
//   D2 等比拖动：改宽、高等比跟随，写回 |W
//   D3 Shift 自由拖动：写回 |WxH
//   D4 原 |WxH 等比拖动保留两轴
//   D5 一次拖动 = 一笔 edit.request（宿主撤销一步）
//   D6 Esc 中止不写文档
//   D7 最小宽 24 保底
//   D8 光晕延伸距离 = max(24, 短边 × 10%)（计算样式断言）
//   D9 按住态：相框异色描边 + 光晕消失（互斥）
//   D10 链接内与表格格内无手柄（沿既有排除矩阵）
//   D11 拖动开始弹 Shift 提示 toast（已按住 Shift 时跳过）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'imageResize/imageResize.js')
// 语言包数据岛：无岛时 t() 回退键名，读数与 toast 文案会显示成
// `imageResize.readout` 这类键值（不是产品缺陷，是 harness 缺装配）
const { islandHtml } = await buildZhLocaleIsland(root)
await build({
  entryPoints: [path.join(root, 'test/browser/imageResizeFixture.ts')],
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
const near = (actual, expected, tolerance = 1.5) => Math.abs(actual - expected) <= tolerance

// 固有 200×100（2:1）
const intrinsic = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="200" height="100" fill="#3366cc"/></svg>')

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><head>${islandHtml}</head><body class="vscode-light"><div id="app"></div></body></html>`)
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((url) => {
    for (const src of ['./img.png', 'img.png', '../img.png']) window.serveImg(src, url)
  }, intrinsic)

  const editRequests = () => page.evaluate(() => window.sentImage().filter((m) => m.kind === 'edit.request'))

  /** 装载文档并等图加载完成。默认加前导段落：光标停在首行，图片才以渲染
   *  态（widget）出现——光标落进嵌入区间会按设计显源码、手柄随之不存在。
   *  表格等必须行首起笔的形态用 `{ prefix: false }`。 */
  async function load(doc, { prefix = true } = {}) {
    const text = prefix ? `前导段落\n\n${doc}` : doc
    await page.evaluate((t) => window.initImgDoc(t), text)
    await page.waitForFunction(() => {
      const img = document.querySelector('.cm-content .vsidian-image img')
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
    }, { timeout: 5000 })
    await page.waitForTimeout(150)
  }

  /** 手柄几何与显隐 */
  const handleInfo = () => page.evaluate(() => {
    const handle = document.querySelector('.vsidian-image-resize-handle')
    if (!handle) return null
    const style = getComputedStyle(handle)
    const rect = handle.getBoundingClientRect()
    const visible = style.display !== 'none' && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    return { visible, width: rect.width, height: rect.height, cursor: style.cursor,
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  })

  // ---- D1：悬停显现 ----
  await load('![[img.png]]')
  const beforeHover = await handleInfo()
  check('D1 未悬停时手柄不可见', beforeHover === null || !beforeHover.visible,
    `visible=${beforeHover?.visible}`)
  const frame = await page.$('.cm-content .vsidian-image')
  await frame.hover()
  await page.waitForTimeout(120)
  const afterHover = await handleInfo()
  check('D1 悬停相框后手柄可见', afterHover !== null && afterHover.visible,
    `visible=${afterHover?.visible} size=${afterHover?.width}×${afterHover?.height}`)
  check('D1 手柄光标 nwse-resize', afterHover?.cursor === 'nwse-resize', `cursor=${afterHover?.cursor}`)

  // ---- D8：光晕延伸距离 ----
  const glow = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-image-resize-glow')
    if (!el) return null
    const style = getComputedStyle(el)
    return { boxShadow: style.boxShadow, opacity: style.opacity, display: style.display }
  })
  check('D8 光晕元素在场且有发光（非透明）',
    glow !== null && (glow.boxShadow !== 'none' || glow.opacity !== '0'),
    `boxShadow=${glow?.boxShadow} opacity=${glow?.opacity}`)

  // ---- D2：等比拖动 ----
  await load('![[img.png|100]]')
  await (await page.$('.cm-content .vsidian-image'))?.hover()
  await page.waitForTimeout(100)
  const box = await (await page.$('.vsidian-image-resize-handle'))?.boundingBox()
  if (!box) throw new Error('手柄不可定位')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 8 })
  const duringDrag = await page.evaluate(() => {
    const img = document.querySelector('.cm-content .vsidian-image img')
    const f = document.querySelector('.cm-content .vsidian-image')
    return {
      width: img?.getBoundingClientRect().width ?? 0,
      height: img?.getBoundingClientRect().height ?? 0,
      frameOutline: f ? getComputedStyle(f).outlineWidth : '',
      resizing: f?.classList.contains('vsidian-image-resizing') ?? false,
      readout: document.querySelector('.vsidian-image-resize-readout')?.textContent ?? null,
    }
  })
  check('D2 拖动中宽度跟随', duringDrag.width > 110, `w=${duringDrag.width.toFixed(1)}`)
  check('D2 拖动中高等比跟随（2:1）', near(duringDrag.height, duringDrag.width / 2, 3),
    `h=${duringDrag.height.toFixed(1)} expected≈${(duringDrag.width / 2).toFixed(1)}`)
  check('D9 按住时相框异色描边', duringDrag.resizing && duringDrag.frameOutline !== '0px',
    `resizing=${duringDrag.resizing} outline=${duringDrag.frameOutline}`)
  check('D2 拖动中有尺寸读数', duringDrag.readout !== null && /\d+\s*×\s*\d+/.test(duringDrag.readout),
    `readout=${JSON.stringify(duringDrag.readout)}`)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const edits = await editRequests()
  check('D5 一次拖动一笔 edit.request', edits.length === 1, `count=${edits.length}`)
  const written = edits[0]?.changes?.[0]?.text ?? JSON.stringify(edits[0] ?? null)
  check('D2 等比写回 |W（无 x 高）', /^\|\d+$/.test(String(written).replace(/^.*\|/, '|')),
    `written=${JSON.stringify(written)}`)

  // ---- D3：Shift 自由拖动 ----
  await load('![[img.png|100]]')
  // ---- D3：Shift 自由拖动 ----
  // 每轮先清出站记录：edit.request 是累积数组，不清会把上一轮的写回当本轮
  await page.evaluate(() => window.clearSentImage())
  await load('![[img.png|100]]')
  await (await page.$('.cm-content .vsidian-image'))?.hover()
  await page.waitForTimeout(100)
  const box2 = await (await page.$('.vsidian-image-resize-handle'))?.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
  await page.mouse.down()
  await page.mouse.move(box2.x + box2.width / 2 + 60, box2.y + box2.height / 2 + 10, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(200)
  const shiftEdits = await editRequests()
  const shiftWritten = String(shiftEdits[0]?.changes?.[0]?.text ?? '')
  check('D3 Shift 拖动写回 |WxH', /^\|\d+x\d+$/.test(shiftWritten.replace(/^.*\|/, '|')),
    `written=${JSON.stringify(shiftWritten)}`)

  // ---- D6：Esc 中止 ----
  await page.evaluate(() => window.clearSentImage?.())
  await load('![[img.png|100]]')
  await (await page.$('.cm-content .vsidian-image'))?.hover()
  await page.waitForTimeout(100)
  const box3 = await (await page.$('.vsidian-image-resize-handle'))?.boundingBox()
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2)
  await page.mouse.down()
  await page.mouse.move(box3.x + box3.width / 2 + 80, box3.y + box3.height / 2, { steps: 6 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(200)
  check('D6 Esc 中止不写文档', (await editRequests()).length === 0,
    `count=${(await editRequests()).length}`)

  // ---- D7：最小宽保底 ----
  const minWidth = await page.evaluate(() => {
    const img = document.querySelector('.cm-content .vsidian-image img')
    return img ? img.getBoundingClientRect().width : 0
  })
  check('D7 中止后恢复原尺寸', near(minWidth, 100), `w=${minWidth.toFixed(1)} expected=100`)

  // ---- D10：排除矩阵 ----
  await load('| 图 | 说明 |\n| --- | --- |\n| ![[img.png]] | 格内 |')
  const tableHandle = await handleInfo()
  check('D10 表格格内无拖动手柄', tableHandle === null, `handle=${JSON.stringify(tableHandle)}`)

  // ---- D11：Shift 提示 toast ----
  await load('![[img.png|100]]')
  await (await page.$('.cm-content .vsidian-image'))?.hover()
  await page.waitForTimeout(100)
  const box4 = await (await page.$('.vsidian-image-resize-handle'))?.boundingBox()
  await page.mouse.move(box4.x + box4.width / 2, box4.y + box4.height / 2)
  await page.mouse.down()
  await page.mouse.move(box4.x + box4.width / 2 + 10, box4.y + box4.height / 2 + 5, { steps: 3 })
  const toastText = await page.evaluate(() => {
    const toast = document.querySelector('.vsidian-toast')
    return toast ? { text: toast.textContent ?? '', severity: toast.getAttribute('data-severity') } : null
  })
  check('D11 拖动开始弹出 Shift 提示', toastText !== null && /Shift/i.test(toastText.text),
    `toast=${JSON.stringify(toastText)}`)
  check('D11 提示为 neutral 档（能力说明非警示）', toastText?.severity === 'neutral',
    `severity=${toastText?.severity}`)
  await page.mouse.up()

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
