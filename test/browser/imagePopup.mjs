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
// 塌缩守恒哨兵：width='100%' + viewBox 的百分比宽 SVG（mermaid 导出形态）
// ——无固有宽，独行块级化（vsidian-image-block）为其撑满基准的既有语义
// 不能被按钮贴图修复破坏（fit-content 化会让它回塌 0×0）
const WIDE = './assets/wide.svg'
const wideData = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg width="100%" viewBox="0 0 480 120" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="120" fill="#8844cc"/></svg>')

const DOC = [
  '# 图片弹窗',
  '',
  `![示例图](${PIC})`,
  '',
  `行内混排 ![行内图](${PIC}) 保持行内形态。`,
  '',
  `[![内嵌图](${PIC})](https://example.com/x)`,
  '',
  `![宽幅图](${WIDE})`,
  '',
].join('\n')

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate(([a, da, b, db]) => { window.serveImg(a, da); window.serveImg(b, db) },
    [PIC, picData, WIDE, wideData])
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
    document.querySelectorAll('.vsidian-graphic-frame.vsidian-image').length === 2) // 行内图 + 宽幅图（示例图已显源码）
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
  // 阅读独行/混排 display 计算值（:only-child 误伤回归钉住——混排段的
  // frame 是段落唯一元素子节点，伪类只统计元素子节点会误命中块级化）
  const readingLayout = await page.evaluate(() => {
    const frames = document.querySelectorAll('.vsidian-reading-block .vsidian-graphic-frame.vsidian-image')
    const byAlt = (alt) => Array.from(frames).find((f) => f.querySelector('img')?.alt === alt)
    const solo = byAlt('示例图')
    const mixed = byAlt('行内图')
    return {
      solo: solo ? getComputedStyle(solo).display : null,
      mixed: mixed ? getComputedStyle(mixed).display : null,
      soloClass: solo?.classList.contains('vsidian-image-block') ?? false,
      mixedClass: mixed?.classList.contains('vsidian-image-block') ?? false,
    }
  })
  check('16b 阅读独行图块级、混排图行内（display 计算值）',
    readingLayout.solo === 'block' && readingLayout.mixed === 'inline-block'
      && readingLayout.soloClass && !readingLayout.mixedClass,
    JSON.stringify(readingLayout))
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
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)

  // 9b) 阅读侧几何：正文图禁拖拽 + 按钮组贴图右上（bug：独行块级 frame
  //     撑满行宽，chrome absolute 贴行右缘不贴图右缘）+ 宽幅 SVG 撑满守恒
  //     （vsidian-image-block 块级基准是 viewBox-only 百分比宽 SVG 的塌缩
  //     修复语义，按钮贴图修复不得让它回塌）
  const readingGeometry = await page.evaluate(() => {
    const blockByAlt = (alt) => Array.from(
      document.querySelectorAll('.vsidian-view-reading .vsidian-graphic-frame.vsidian-image.vsidian-image-block'))
      .find((f) => f.querySelector('img')?.alt === alt)
    const chromeGap = (frame) => {
      const img = frame?.querySelector('img')
      const chrome = frame?.querySelector('.vsidian-graphic-chrome')
      if (!img || !chrome) return null
      return chrome.getBoundingClientRect().right - img.getBoundingClientRect().right
    }
    const solo = blockByAlt('示例图')
    const wide = blockByAlt('宽幅图')
    const anyImg = document.querySelector('.vsidian-view-reading img.vsidian-image')
    return {
      imgDraggable: anyImg ? anyImg.draggable : null,
      soloGap: chromeGap(solo),
      wideGap: chromeGap(wide),
      wideWidth: wide ? wide.querySelector('img').getBoundingClientRect().width : null,
      wideNatural: wide ? wide.querySelector('img').naturalWidth : null,
    }
  })
  check('17b 阅读正文图片禁原生拖拽', readingGeometry.imgDraggable === false,
    `draggable=${readingGeometry.imgDraggable}`)
  check('17c 阅读独行图按钮贴图右上（chrome 右缘贴图右缘 6px 内缩）',
    readingGeometry.soloGap !== null && readingGeometry.soloGap <= 0 && readingGeometry.soloGap >= -12,
    `gap=${readingGeometry.soloGap}`)
  check('17d 阅读宽幅 SVG 撑满不塌（块级基准守恒）', (readingGeometry.wideWidth ?? 0) > 400,
    `render=${readingGeometry.wideWidth} natural=${readingGeometry.wideNatural}`)
  check('17e 阅读宽幅图按钮贴行右缘即图右缘', readingGeometry.wideGap !== null
    && readingGeometry.wideGap <= 0 && readingGeometry.wideGap >= -12,
    `gap=${readingGeometry.wideGap}`)

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
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)

  // 12) 原生拖拽禁用回归：弹窗图片按住拖动不得启动浏览器原生 drag（img
  //     默认 draggable=true——ghost 缩略图跟随鼠标 + Windows 复制加号徽标
  //     的根源，且吞掉拖拽平移手势的 pointermove 流）。headless 合成输入
  //     下 ghost 渲染层无可靠信号，回归钉在原生 drag 的启动机制上：
  //     draggable 属性（Chromium 启动判定源）+ document 级 dragstart 零派发
  await frame.hover()
  await popupBtn.click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.vsidian-diagram-media img')
    return img && img.getAttribute('data-vsidian-img-state') === 'loaded'
  })
  const imgDraggable = await page.evaluate(() => {
    window.__imgDragStart = 0
    document.addEventListener('dragstart', () => { window.__imgDragStart += 1 }, { capture: true })
    const img = document.querySelector('.vsidian-diagram-media img')
    return img ? img.draggable : null
  })
  const popupImgBox = await page.locator('.vsidian-diagram-media img').boundingBox()
  await page.mouse.move(popupImgBox.x + popupImgBox.width / 2, popupImgBox.y + popupImgBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    popupImgBox.x + popupImgBox.width / 2 + 140, popupImgBox.y + popupImgBox.height / 2 + 80, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const dragStarted = await page.evaluate(() => window.__imgDragStart)
  check('21 弹窗图片禁用原生拖拽（draggable=false）', imgDraggable === false, `img.draggable=${imgDraggable}`)
  check('22 按住拖动图片不派发 dragstart', dragStarted === 0, `dragstart×${dragStarted}`)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)

  // 13) live 侧几何：正文图禁拖拽 + 按钮组贴图右上 + 宽幅 SVG 撑满守恒
  //     （live 独行图 frame 在 .cm-scroller 内块级撑满 .cm-line 宽，同
  //     阅读侧根因；行内混排图 inline-block 收缩本就贴齐）
  const liveGeometry = await page.evaluate(() => {
    const blockByAlt = (alt) => Array.from(
      document.querySelectorAll('.cm-content .vsidian-image.vsidian-image-block'))
      .find((f) => f.querySelector('img')?.alt === alt)
    const chromeGap = (frame) => {
      const img = frame?.querySelector('img')
      const chrome = frame?.querySelector('.vsidian-graphic-chrome')
      if (!img || !chrome) return null
      return chrome.getBoundingClientRect().right - img.getBoundingClientRect().right
    }
    const solo = blockByAlt('示例图')
    const wide = blockByAlt('宽幅图')
    const anyImg = document.querySelector('.cm-content .vsidian-image img')
    return {
      imgDraggable: anyImg ? anyImg.draggable : null,
      soloGap: chromeGap(solo),
      wideWidth: wide ? wide.querySelector('img').getBoundingClientRect().width : null,
      wideNatural: wide ? wide.querySelector('img').naturalWidth : null,
    }
  })
  check('24 live 正文图片禁原生拖拽', liveGeometry.imgDraggable === false,
    `draggable=${liveGeometry.imgDraggable}`)
  check('25 live 独行图按钮贴图右上', liveGeometry.soloGap !== null
    && liveGeometry.soloGap <= 0 && liveGeometry.soloGap >= -12,
    `gap=${liveGeometry.soloGap}`)
  check('26 live 宽幅 SVG 撑满不塌（块级基准守恒）', (liveGeometry.wideWidth ?? 0) > 400,
    `render=${liveGeometry.wideWidth} natural=${liveGeometry.wideNatural}`)

  // 14) 按钮底色不透底（半透明主题面透出图片色的回归钉住）：常态与
  //     悬停面为「主题色纯色渐变层 + 编辑器底实垫」双层合成——断言垫底
  //     为不透明实色且渐变层在场（fixture 无 VSCode 变量注入，走半透明
  //     fallback 面 + 实色垫底，恰为半透明主题的最不利场景）
  await frame.hover()
  await frame.locator('.vsidian-graphic-chrome-popup').hover()
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-popup')).opacity === '1')
  const hoverBg = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(
      '.vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-popup'))
    return { color: cs.backgroundColor, image: cs.backgroundImage }
  })
  check('27 悬停按钮底色垫实底（不透出图片色）',
    /^rgb\(/.test(hoverBg.color) && hoverBg.image.includes('linear-gradient'),
    JSON.stringify(hoverBg))

  check('28 页面无脚本错误', errors.length === 0, JSON.stringify(errors))
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
