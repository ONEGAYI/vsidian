// 图片弹窗与防误触浏览器回归（工单 #212，对齐 graphicPopup.mjs 模式）：
// 真实 Chromium + 生产控制器 + 产物 CSS 上的原生键鼠路径——按钮悬停显隐
// （opacity 绘制层计算值）、点击吞（光标不动）、edit 迁移、弹窗滚轮缩放/
// 拖拽平移/键盘重置/Esc、导出消息形态、阅读侧单钮、链接内嵌排除。
// 图源为 data: URI SVG（固有尺寸确定，无 CSP 议题——图片弹窗不经 canvas
// 光栅化，导出走宿主字节拷贝）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'imagePopup/imagePopup.js')
await build({ entryPoints: [path.join(root, 'test/browser/imagePopupFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}

const PIC = './assets/pic.svg'
const picData = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg width="240" height="120" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="120" fill="#4488cc"/></svg>')

const DOC = [
  '# 图片弹窗',
  '',
  `![示例图](${PIC})`,
  '',
  `行内混排 ![行内图](${PIC}) 保持行内形态。`,
  '',
  `[![内嵌图](${PIC})](https://example.com/x)`,
  '',
].join('\n')

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate(([src, data]) => window.serveImg(src, data), [PIC, picData])
  await page.evaluate((text) => {
    window.initImgDoc(text)
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  }, DOC)
  await page.waitForFunction(() => {
    const frames = document.querySelectorAll('.vsidian-graphic-frame.vsidian-image')
    return frames.length >= 2 && Array.from(frames).every(
      (f) => f.getAttribute('data-vsidian-img-state') === 'loaded')
  }, { timeout: 10000 })

  const frame = page.locator('.vsidian-graphic-frame.vsidian-image').first()
  const editBtn = frame.locator('.vsidian-graphic-chrome-edit')
  const popupBtn = frame.locator('.vsidian-graphic-chrome-popup')

  // 1) 悬停显隐：未悬停透明，悬停后显现（opacity 计算值 = 绘制层断言）
  const idleOpacity = await editBtn.evaluate((el) => getComputedStyle(el).opacity)
  check('1 未悬停按钮透明隐藏', idleOpacity === '0', `opacity=${idleOpacity}`)
  await frame.hover()
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-edit')).opacity === '1')
  check('2 悬停后按钮显现', true, 'opacity=1')

  // 2) 点击吞（防误触本体）：原生点击图片中心，光标不动、widget 不退场
  const anchorBefore = await page.evaluate(() => window.controller.getView().state.selection.main.anchor)
  const frameBox = await frame.boundingBox()
  await page.mouse.click(frameBox.x + frameBox.width / 2, frameBox.y + Math.min(frameBox.height / 2, 100))
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => ({
    anchor: window.controller.getView().state.selection.main.anchor,
    rendered: document.querySelector('.vsidian-graphic-frame.vsidian-image') !== null,
    text: window.controller.getView().state.doc.toString(),
  }))
  check('3 点击图片光标不落位（吞点击）', after.anchor === anchorBefore, `anchor ${anchorBefore} → ${after.anchor}`)
  check('4 点击后渲染图在场（不退场显源码）', after.rendered, '')
  check('5 零写回（文档逐字节不变）', after.text === DOC, '')

  // 3) edit 按钮：光标落图片源码起点、源码显形
  await frame.hover()
  await editBtn.click()
  await page.waitForFunction(() =>
    document.querySelectorAll('.vsidian-graphic-frame.vsidian-image').length === 1)
  const editState = await page.evaluate(() => ({
    anchor: window.controller.getView().state.selection.main.anchor,
    text: window.controller.getView().state.doc.toString(),
  }))
  check('6 edit 光标落图片源码起点', editState.anchor === DOC.indexOf('![示例图]'),
    `anchor=${editState.anchor}（期望 ${DOC.indexOf('![示例图]')}）`)
  check('7 edit 后示例图源码显形（其余图在场）', editState.text === DOC, '零写回')

  // 恢复呈现态（光标移出图片区间）
  await page.evaluate(() => {
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  })
  await page.waitForFunction(() => {
    const frames = document.querySelectorAll('.vsidian-graphic-frame.vsidian-image')
    return frames.length >= 2 && Array.from(frames).every(
      (f) => f.getAttribute('data-vsidian-img-state') === 'loaded')
  })

  // 4) popup：打开全屏浮层，img 以固有尺寸装载
  await frame.hover()
  await popupBtn.click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.vsidian-diagram-media img')
    return img && img.getAttribute('data-vsidian-img-state') === 'loaded' && img.naturalWidth > 0
  }, { timeout: 10000 })
  check('8 弹窗浮层可见', await page.locator('.vsidian-diagram-overlay').isVisible(), '')
  check('9 弹窗图片固有尺寸装载', true, 'naturalWidth=240（data URI SVG）')
  const bodyOverflow = await page.evaluate(() => document.body.style.overflow)
  check('10 body overflow 锁定', bodyOverflow === 'hidden', `overflow=${bodyOverflow}`)

  // 5) 滚轮缩放（transform scale 增大——位图缩放走 CSS transform）
  const transformBefore = await page.evaluate(
    () => document.querySelector('.vsidian-diagram-media').style.transform)
  await page.mouse.move(450, 350)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(150)
  const zoomTransform = await page.evaluate(
    () => document.querySelector('.vsidian-diagram-media').style.transform)
  const scaleOf = (t) => Number.parseFloat((t.match(/scale\(([\d.]+)\)/) ?? [0, '1'])[1])
  check('11 滚轮放大增大 transform scale',
    scaleOf(zoomTransform) > scaleOf(transformBefore),
    `${transformBefore} → ${zoomTransform}`)

  // 6) 拖拽平移：translate 变化
  await page.mouse.move(450, 350)
  await page.mouse.down()
  await page.mouse.move(560, 410, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const panTransform = await page.evaluate(
    () => document.querySelector('.vsidian-diagram-media').style.transform)
  check('12 拖拽改变平移 translate', panTransform !== zoomTransform, `${panTransform}`)

  // 7) 键盘 0 重置（contain-fit：无平移）+ Esc 关闭恢复 overflow
  await page.keyboard.press('0')
  await page.waitForTimeout(100)
  const resetTransform = await page.evaluate(
    () => document.querySelector('.vsidian-diagram-media').style.transform)
  check('13 0 重置为 contain-fit（translate 归零）', /translate\(0px, 0px\)/.test(resetTransform), resetTransform)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)
  check('14 Esc 关闭后恢复 body overflow',
    (await page.evaluate(() => document.body.style.overflow)) === '', '')

  // 8) 导出消息形态（生产控制器的消息通道）
  await frame.hover()
  await popupBtn.click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.vsidian-diagram-media img')
    return img && img.getAttribute('data-vsidian-img-state') === 'loaded'
  })
  await page.locator('.vsidian-diagram-export-image').click()
  await page.waitForFunction(
    () => window.imgSent().some((m) => m.kind === 'image.export'))
  const exportMsg = await page.evaluate(
    () => window.imgSent().find((m) => m.kind === 'image.export'))
  check('15 导出经桥发出 image.export', exportMsg.src === './assets/pic.svg'
    && exportMsg.fileName === 'pic.svg' && exportMsg.reqId > 0,
    JSON.stringify({ src: exportMsg.src, fileName: exportMsg.fileName, reqId: exportMsg.reqId }))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)

  // 9) 阅读侧：按钮组仅 popup 一枚；点开同一弹窗
  await page.evaluate(() => window.setImgMode('reading'))
  await page.waitForFunction(() => {
    const frames = document.querySelectorAll('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image')
    return frames.length >= 2
  }, { timeout: 10000 })
  const readingButtons = await page.evaluate(() => {
    const frames = document.querySelectorAll('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image')
    return {
      total: frames.length,
      edits: document.querySelectorAll('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-edit').length,
      popups: document.querySelectorAll('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-popup').length,
    }
  })
  check('16 阅读侧按钮组仅 popup（无 edit）',
    readingButtons.total >= 2 && readingButtons.edits === 0 && readingButtons.popups === readingButtons.total,
    JSON.stringify(readingButtons))
  // 真实用户路径：悬停 frame 使按钮显现后再点击
  const readingFrame = page.locator('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image').first()
  await readingFrame.hover()
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-popup')).opacity === '1')
  await page.locator('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-popup').first().click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.vsidian-diagram-media img')
    return img && img.getAttribute('data-vsidian-img-state') === 'loaded'
  })
  check('17 阅读侧 popup 打开弹窗', await page.locator('.vsidian-diagram-overlay').isVisible(), '')
  await page.keyboard.press('Escape')

  // 10) 链接内嵌图片排除：无按钮组、无 frame（点击保留链接跳转语义）
  const inLink = await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('.vsidian-reading-block img.vsidian-image'))
      .find((i) => i.alt === '内嵌图')
    if (!img) return { found: false }
    return {
      found: true,
      inLink: img.closest('a') !== null,
      framed: img.parentElement.classList.contains('vsidian-graphic-frame'),
    }
  })
  check('18 链接内嵌图片不包 frame 不出按钮组',
    inLink.found && inLink.inLink && !inLink.framed, JSON.stringify(inLink))

  // 11) 弹窗内刷新：按当前文档重定位重取（invalidate → 新 image.request）。
  //     切回 live 会恢复阅读锚点（示例图块 start）为光标——图片区间内
  //     widget 按既有语义不发射（源码显形），先移光标到文末恢复呈现态
  await page.evaluate(() => {
    window.setImgMode('live')
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  })
  await page.waitForFunction(() => {
    const frames = document.querySelectorAll('.cm-content .vsidian-graphic-frame.vsidian-image')
    return frames.length >= 2 && Array.from(frames).every(
      (f) => f.getAttribute('data-vsidian-img-state') === 'loaded')
  }, { timeout: 10000 })
  const reqBefore = await page.evaluate(
    () => window.imgSent().filter((m) => m.kind === 'image.request').length)
  await frame.hover()
  await popupBtn.click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.vsidian-diagram-media img')
    return img && img.getAttribute('data-vsidian-img-state') === 'loaded'
  })
  await page.locator('.vsidian-diagram-refresh').click()
  await page.waitForFunction(
    (before) => window.imgSent().filter((m) => m.kind === 'image.request').length > before,
    reqBefore, { timeout: 5000 })
  await page.waitForFunction(() => {
    const img = document.querySelector('.vsidian-diagram-media img')
    return img && img.getAttribute('data-vsidian-img-state') === 'loaded'
  }, { timeout: 5000 })
  check('19 弹窗刷新按文档重定位走失效重取', true,
    `image.request ${reqBefore} → ${await page.evaluate(() => window.imgSent().filter((m) => m.kind === 'image.request').length)}`)
  await page.keyboard.press('Escape')

  check('20 页面无脚本错误', errors.length === 0, JSON.stringify(errors))
  await page.close()

  if (failures.length > 0) {
    console.error(`imagePopup: ${failures.length} 条断言红`)
    process.exitCode = 1
  } else {
    console.log('imagePopup: 全部断言通过（悬停显隐/吞点击/edit 迁移/弹窗缩放平移键盘/导出消息/阅读单钮/链接内嵌排除/刷新重取）')
  }
} finally {
  await browser.close()
}
