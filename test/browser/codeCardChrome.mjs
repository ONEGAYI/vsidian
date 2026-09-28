// 代码块卡片绘制层回归（#189/#190/#191）：真实 Chromium + 生产控制器 +
// 产物 CSS，断言用户看到的几何与按钮态（AGENTS 视觉层断言，不做 DOM
// 存在性检查）：
// - #189：编辑态围栏符号与代码文本列同 x（真实对齐，2ch/3ch 两档列宽）；
//   代码行行号列起点不位移（用户决议「不动代码文本行」）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'codeCardChrome/codeCardChrome.js')
await build({ entryPoints: [path.join(root, 'test/browser/codeCardChromeFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  // 文档：小 js 块（2ch 列宽）+ 长行块（#191 折行/窜行观测，~127 字符
  // 在 760px 视口必然折出续行）+ 120 行 js 块（3ch 列宽）
  const BIG = Array.from({ length: 120 }, (_, i) => `console.log(${i})`).join('\n')
  const LONG_LINE = `const wrapLongLine = '${'x'.repeat(100)}';`
  const DOC = [
    '正文段落。', '',
    '```js', 'const a = 1;', 'let b = 2;', '```', '',
    '```js', LONG_LINE, 'let b = 2;', '```', '',
    '```js', BIG, '```', '',
  ].join('\n')
  await page.evaluate((text) => window.initCode(text), DOC)
  await page.waitForSelector('.vsidian-code-card-header')

  // 页内纯 JS 助手：行内首个非行号文本的首字符屏幕 x（Range 矩形）
  await page.evaluate(() => {
    window.textX = (line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest('.vsidian-code-card-linenumber') !== null) {
          continue
        }
        if (node.textContent === '') {
          continue
        }
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, Math.min(1, node.textContent.length))
        return range.getBoundingClientRect().left
      }
      return null
    }
  })

  const visibleFences = () => page.evaluate(() =>
    [...document.querySelectorAll('.cm-line.vsidian-code-card-edge-top')]
      .filter((el) => el.textContent.includes('```')))
  const codeLines = () => page.evaluate(() =>
    [...document.querySelectorAll('.cm-line.vsidian-code-card-line:not(.vsidian-code-card-edge-top):not(.vsidian-code-card-edge-bottom)')])

  // 真实点击进入编辑态（光标进块 → 围栏源码显形），先测小块（2ch 档）
  await page.locator('.cm-line.vsidian-code-card-line:not(.vsidian-code-card-edge-top):not(.vsidian-code-card-edge-bottom)').first().click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.cm-line.vsidian-code-card-edge-top')]
      .some((el) => el.textContent.includes('```')))
  let fences = await visibleFences()
  assert.equal(fences.length, 1, `编辑态应只有当前块围栏显形，实际 ${fences.length}`)
  const small = await page.evaluate(() => {
    const fence = document.querySelector('.cm-line.vsidian-code-card-edge-top')
    const lines = [...document.querySelectorAll('.cm-line.vsidian-code-card-line:not(.vsidian-code-card-edge-top):not(.vsidian-code-card-edge-bottom)')]
    const code = lines[0]
    const number = code.querySelector('.vsidian-code-card-linenumber')
    return {
      fenceTopX: window.textX(fence),
      codeX: window.textX(code),
      numberX: number ? number.getBoundingClientRect().left : null,
      codeLineX: code.getBoundingClientRect().left,
      fencePad: getComputedStyle(fence).paddingLeft,
    }
  })
  assert(Math.abs((small.fenceTopX ?? -1) - (small.codeX ?? -2)) < 1,
    `#189 开围栏符号应与代码文本列同 x：围栏 ${small.fenceTopX} vs 文本 ${small.codeX}`)
  // 行号边距 8+16 重分配：行号左缘让出 8px（数字右移，列总占与代码列 x 不变）
  assert(Math.abs(((small.numberX ?? -1) - (small.codeLineX ?? -2)) - 8) < 1,
    `#189 代码行行号左缘应距行左缘 8px：行号 ${small.numberX} vs 行左缘 ${small.codeLineX}`)
  const smallPad = Number.parseFloat(small.fencePad ?? '')
  assert.ok(Number.isFinite(smallPad) && smallPad > 0, `首块围栏左内边距应 > 0（2ch 档）：${small.fencePad}`)

  // 120 行块（3ch 档）：点击其首条内容行（唯一文本 console.log(0)）→ 仅
  // 该块编辑态且围栏行保持在视口内（CM6 视口虚拟化：滚出视口的行不在 DOM）
  await page.locator('.cm-line.vsidian-code-card-line', { hasText: 'console.log(0)' }).first().click()
  await page.waitForFunction(() => {
    const fences = [...document.querySelectorAll('.cm-line.vsidian-code-card-edge-top')]
      .filter((el) => el.textContent.includes('```'))
    return fences.length === 1 && fences[0].nextElementSibling?.querySelector('.vsidian-code-card-linenumber')?.textContent === '1'
  })
  const big = await page.evaluate(() => {
    // 编辑中的块才有围栏文本；上方小块此时退回清空态（无文本节点）
    const fence = [...document.querySelectorAll('.cm-line.vsidian-code-card-edge-top')]
      .find((el) => el.textContent.includes('```'))
    const code = fence.nextElementSibling
    return {
      fenceX: window.textX(fence),
      codeX: window.textX(code),
      fencePad: getComputedStyle(fence).paddingLeft,
    }
  })
  assert(Math.abs((big.fenceX ?? -1) - (big.codeX ?? -2)) < 1,
    `#189 120 行块（3ch）围栏与代码文本同 x：${big.fenceX} vs ${big.codeX}`)
  const bigPad = Number.parseFloat(big.fencePad ?? '')
  assert.ok(Number.isFinite(bigPad) && bigPad > smallPad,
    `3ch 档围栏缩进应大于 2ch 档（对齐公式随块）：${big.fencePad} vs ${small.fencePad}`)

  // ---- #190：按钮区换位 / 整卡悬停恒显 / 整条折叠热区 ----
  // 光标移回正文（退出编辑态：全部块回到呈现态）
  await page.locator('.cm-line', { hasText: '正文段落。' }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.cm-line.vsidian-code-card-edge-top')]
      .every((el) => !el.textContent.includes('```')))

  const boxX = (box) => { assert.ok(box, '元素应有 boundingBox'); return box.x }
  // (a) 折叠钮位置恒定：收起/展开两态 x 差 < 1px（连续开合不挪鼠标）；
  // 收起态 DOM 无复制按钮
  const smallHeader = page.locator('.vsidian-code-card-header').first()
  const smallFold = smallHeader.locator('button.vsidian-code-card-fold')
  const collapsedCount = () => page.evaluate(() =>
    document.querySelectorAll('.vsidian-code-card-fold-collapsed').length)
  const xExpanded = boxX(await smallFold.boundingBox())
  await smallFold.click()
  await page.waitForFunction(() => document.querySelectorAll('.vsidian-code-card-fold-collapsed').length === 1)
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('.vsidian-code-card-header')[0]
      .querySelector('.vsidian-code-card-copy')),
    null, '#190 收起态 DOM 无复制按钮')
  const xCollapsed = boxX(await smallFold.boundingBox())
  assert(Math.abs(xCollapsed - xExpanded) < 1,
    `#190 收起/展开两态折叠钮 x 应恒定：${xCollapsed} vs ${xExpanded}`)
  await smallFold.click()
  await page.waitForFunction(() => document.querySelectorAll('.vsidian-code-card-fold-collapsed').length === 0)
  const xReExpanded = boxX(await smallFold.boundingBox())
  assert(Math.abs(xReExpanded - xExpanded) < 1,
    `#190 再展开后折叠钮 x 应回到原位：${xReExpanded} vs ${xExpanded}`)

  // (b) Live 整卡悬停恒显：hover 代码区（非头部）→ 复制钮 computed opacity 1；
  // 移出到块外 → 回 0（头部与卡片行无公共 DOM 祖先，reveal 类经 JS 指针追踪）
  const codeLine = page.locator('.cm-line.vsidian-code-card-line', { hasText: 'const a = 1;' })
  const codeBox = await codeLine.boundingBox()
  assert.ok(codeBox, '代码行应有 boundingBox')
  await page.mouse.move(codeBox.x + codeBox.width / 2, codeBox.y + codeBox.height / 2)
  await page.waitForFunction(() => {
    const btn = document.querySelectorAll('.vsidian-code-card-header')[0]
      .querySelector('.vsidian-code-card-copy')
    return btn !== null && getComputedStyle(btn).opacity === '1'
  })
  const paraBox = await page.locator('.cm-line', { hasText: '正文段落。' }).boundingBox()
  assert.ok(paraBox, '正文行应有 boundingBox')
  await page.mouse.move(paraBox.x + 20, paraBox.y + paraBox.height / 2)
  await page.waitForFunction(() => {
    const btn = document.querySelectorAll('.vsidian-code-card-header')[0]
      .querySelector('.vsidian-code-card-copy')
    return btn !== null && getComputedStyle(btn).opacity === '0'
  })

  // (d-live) 整条折叠热区：点击头部语言标签区坐标触发折叠；点击复制钮不触发折叠
  await smallHeader.locator('.vsidian-code-card-header-label').click()
  await page.waitForFunction(() => document.querySelectorAll('.vsidian-code-card-fold-collapsed').length === 1)
  // 热区展开回呈现态，hover 头部让复制钮可点，点击它不触发折叠
  await smallHeader.locator('.vsidian-code-card-header-label').click()
  await page.waitForFunction(() => document.querySelectorAll('.vsidian-code-card-fold-collapsed').length === 0)
  await smallHeader.hover()
  await page.waitForFunction(() => {
    const btn = document.querySelectorAll('.vsidian-code-card-header')[0]
      .querySelector('.vsidian-code-card-copy')
    return btn !== null && getComputedStyle(btn).opacity === '1'
  })
  await smallHeader.locator('button.vsidian-code-card-copy').click()
  await page.waitForTimeout(150)
  assert.equal(await collapsedCount(), 0, '#190 Live 点击复制钮不得触发折叠')

  // (c) 阅读视图同口径：纯 CSS 整卡悬停 + 折叠钮 x 恒定 + 热区
  await page.evaluate(() => window.setCodeMode('reading'))
  await page.waitForSelector('.vsidian-reading-block.vsidian-reading-code-card')
  const readCard = page.locator('.vsidian-reading-block.vsidian-reading-code-card').first()
  const readHeader = readCard.locator('.vsidian-code-card-header')
  const readFold = readHeader.locator('button.vsidian-code-card-fold')
  // 折叠钮 x 恒定（收起态复制钮不渲染，同口径）
  const readXExpanded = boxX(await readFold.boundingBox())
  await readFold.click()
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-reading-code-card')?.classList.contains('vsidian-code-card-folded'))
  const readXCollapsed = boxX(await readFold.boundingBox())
  assert(Math.abs(readXCollapsed - readXExpanded) < 1,
    `#190 阅读收起/展开折叠钮 x 应恒定：${readXCollapsed} vs ${readXExpanded}`)
  await readFold.click()
  await page.waitForFunction(() =>
    !document.querySelector('.vsidian-reading-code-card')?.classList.contains('vsidian-code-card-folded'))
  // hover 代码区（pre 内）→ 复制钮 opacity 1（块容器 :hover 纯 CSS 路径）；移出 → 0
  const readPreBox = await readCard.locator('pre').boundingBox()
  assert.ok(readPreBox, '阅读代码区应有 boundingBox')
  await page.mouse.move(readPreBox.x + readPreBox.width / 2, readPreBox.y + Math.min(readPreBox.height / 2, 30))
  await page.waitForFunction(() => {
    const btn = document.querySelector('.vsidian-reading-code-card .vsidian-code-card-copy')
    return btn !== null && getComputedStyle(btn).opacity === '1'
  })
  const readParaBox = await page.locator('.vsidian-reading-block', { hasText: '正文段落。' }).boundingBox()
  assert.ok(readParaBox, '阅读正文块应有 boundingBox')
  await page.mouse.move(readParaBox.x + 20, readParaBox.y + readParaBox.height / 2)
  await page.waitForFunction(() => {
    const btn = document.querySelector('.vsidian-reading-code-card .vsidian-code-card-copy')
    return btn !== null && getComputedStyle(btn).opacity === '0'
  })
  // 热区：点击头部语言标签区触发 onFoldToggle（收起类出现）；点击复制钮不触发
  await readHeader.locator('.vsidian-code-card-header-label').click()
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-reading-code-card')?.classList.contains('vsidian-code-card-folded'))
  await readHeader.locator('.vsidian-code-card-header-label').click()
  await page.waitForFunction(() =>
    !document.querySelector('.vsidian-reading-code-card')?.classList.contains('vsidian-code-card-folded'))
  await readCard.hover()
  await page.waitForFunction(() => {
    const btn = document.querySelector('.vsidian-reading-code-card .vsidian-code-card-copy')
    return btn !== null && getComputedStyle(btn).opacity === '1'
  })
  await readCard.locator('button.vsidian-code-card-copy').click()
  await page.waitForTimeout(150)
  assert.equal(
    await page.evaluate(() => document.querySelector('.vsidian-reading-code-card')
      ?.classList.contains('vsidian-code-card-folded')),
    false, '#190 阅读点击复制钮不得触发折叠')

  // ---- #191：折行开关与两视图续行窜行修复 ----
  // 页内助手：行内逐字符扫描折行几何——首字符矩形定首行基线，扫出第一
  // 个落在下方视觉行的字符（续行首字符）；返回首行/续行 x、行号盒两缘
  // 与行左缘（两视图通用，行号选择器同类名）
  await page.evaluate(() => {
    window.lineWrapMetrics = (lineEl) => {
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
      const texts = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest('.vsidian-code-card-linenumber') !== null) {
          continue
        }
        if (node.textContent === '') {
          continue
        }
        texts.push(node)
      }
      if (texts.length === 0) {
        return null
      }
      const rectOf = (node, offset) => {
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, Math.min(offset + 1, node.textContent.length))
        return range.getBoundingClientRect()
      }
      const first = rectOf(texts[0], 0)
      for (const node of texts) {
        for (let i = 0; i < node.textContent.length; i++) {
          const rect = rectOf(node, i)
          if (rect.top > first.top + first.height * 0.6) {
            const ln = lineEl.querySelector('.vsidian-code-card-linenumber')
            return {
              firstX: first.left,
              contX: rect.left,
              lnRight: ln ? ln.getBoundingClientRect().right : null,
              lnLeft: ln ? ln.getBoundingClientRect().left : null,
              lineLeft: lineEl.getBoundingClientRect().left,
            }
          }
        }
      }
      return null // 未折行
    }
  })
  const longLineMetrics = (scope) => page.evaluate((sel) => {
    const line = [...document.querySelectorAll(sel)]
      .find((el) => el.textContent.includes('wrapLongLine'))
    return line ? window.lineWrapMetrics(line) : null
  }, scope)

  // (a-reading) 折行态（默认）：长行续行首字符与代码文本列对齐（悬挂缩进），
  // 不窜入卡内行号区；行号左缘距行左缘 8px（8+16 重分配，列总占不变）
  const readWrap = await longLineMetrics('.vsidian-reading-code-line')
  assert.ok(readWrap, '阅读长行应折出续行（127 字符 > 视口可用宽）')
  assert(Math.abs(readWrap.contX - readWrap.firstX) < 1,
    `#191 阅读续行首字符应与文本列对齐：续行 ${readWrap.contX} vs 首行 ${readWrap.firstX}`)
  assert.ok(readWrap.lnRight !== null && readWrap.contX > readWrap.lnRight + 15,
    `#191 阅读续行不得窜入行号区：续行 x ${readWrap.contX} 应 > 行号右缘+15（${readWrap.lnRight}）`)
  assert(Math.abs(((readWrap.lnLeft ?? -1) - readWrap.lineLeft) - 8) < 1,
    `#191 阅读首行行号左缘应距行左缘 8px：${readWrap.lnLeft} vs ${readWrap.lineLeft}`)

  // (b/d) 阅读关闭折行：点击任一块折行钮 → 容器类 + 全部已挂载块（含
  // 大围栏各片）pre 同时进入 nowrap；不触发热区折叠。折行钮与复制钮同口径
  // 进卡即显（#190 决议）：未悬停隐藏，hover 卡片显现后方可点击
  const wrapBtn = page.locator('.vsidian-reading-block.vsidian-reading-code-card').first()
    .locator('button.vsidian-code-card-wrap')
  // 先把指针移到正文段落（卡片横带贴近容器左缘，(8,8) 仍可能落在卡上）；
  // 隐藏断言等渐隐过渡（0.12s）稳定，不得在过渡起点立即断读
  await page.locator('.vsidian-reading-block', { hasText: '正文段落' }).first().hover()
  await page.waitForFunction(() => {
    const btn = document.querySelector('.vsidian-reading-code-card button.vsidian-code-card-wrap')
    return btn !== null && getComputedStyle(btn).opacity === '0'
  }, undefined, { timeout: 2000 })
  const firstReadCard = page.locator('.vsidian-reading-block.vsidian-reading-code-card').first()
  await firstReadCard.hover()
  await page.waitForFunction(() => {
    const btn = document.querySelector('.vsidian-reading-code-card button.vsidian-code-card-wrap')
    return btn !== null && getComputedStyle(btn).opacity === '1'
  })
  const longCardLineCount = () => page.evaluate(() => {
    const line = [...document.querySelectorAll('.vsidian-reading-code-line')]
      .find((el) => el.textContent.includes('wrapLongLine'))
    const pre = line ? line.closest('pre') : null
    return pre ? pre.querySelectorAll('.vsidian-reading-code-line').length : 0
  })
  assert.equal(await longCardLineCount(), 2, '长行块应有两行内容')
  const linesBefore = await longCardLineCount()
  await wrapBtn.click()
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-view-reading')?.classList.contains('vsidian-reading-nowrap') === true)
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-reading-code-card button.vsidian-code-card-wrap')
      ?.classList.contains('vsidian-code-card-wrap-off') === true)
  const nowrapStates = await page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-reading-code-card > pre')]
      .map((pre) => getComputedStyle(pre).whiteSpace))
  assert.ok(nowrapStates.length >= 3, `联动应覆盖全部已挂载卡片（实际 ${nowrapStates.length} 片）`)
  assert(nowrapStates.every((v) => v === 'pre'),
    `#191 联动：点击任一开关全部块进入 nowrap，实际 ${nowrapStates.join(',')}`)
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('.vsidian-code-card-folded').length),
    0, '#191 点击折行钮不得触发热区折叠')
  assert.equal(await longCardLineCount(), linesBefore, '#191 折行切换不改卡片行数')

  // (b-geometry) 长行卡片横向滚动：scrollWidth > clientWidth；滚动后行号
  // sticky 钉左（x 不变）、头部不随滚动；遮罩两层合成不透明（卡片色叠
  // 不透明编辑器底色，backgroundImage 在场 + backgroundColor alpha=1）
  const scrollGeom = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.vsidian-reading-code-line')]
      .find((el) => el.textContent.includes('wrapLongLine'))
    const pre = line ? line.closest('pre') : null
    const card = line ? line.closest('.vsidian-reading-code-card') : null
    const ln = line ? line.querySelector('.vsidian-code-card-linenumber') : null
    const header = card ? card.querySelector('.vsidian-code-card-header') : null
    if (!pre || !ln || !header) {
      return null
    }
    const lnX0 = ln.getBoundingClientRect().x
    const headerX0 = header.getBoundingClientRect().x
    const style = getComputedStyle(ln)
    const before = { scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth, overflowX: getComputedStyle(pre).overflowX }
    pre.scrollLeft = 9999
    return {
      ...before,
      scrolled: pre.scrollLeft,
      lnX1: ln.getBoundingClientRect().x,
      headerX1: header.getBoundingClientRect().x,
      lnX0,
      headerX0,
      maskImage: style.backgroundImage,
      maskColor: style.backgroundColor,
    }
  })
  assert.ok(scrollGeom, '长行卡片几何应可采样')
  assert.equal(scrollGeom.overflowX, 'auto', '#191 nowrap pre 应 overflow-x auto')
  assert.ok(scrollGeom.scrollWidth > scrollGeom.clientWidth,
    `#191 长行应出现横向滚动（scrollWidth ${scrollGeom.scrollWidth} > clientWidth ${scrollGeom.clientWidth}）`)
  assert.ok(scrollGeom.scrolled > 0, '横向滚动应已发生位移')
  assert(Math.abs(scrollGeom.lnX1 - scrollGeom.lnX0) < 1,
    `#191 滚动后行号 sticky 钉左（x 不变）：${scrollGeom.lnX0} → ${scrollGeom.lnX1}`)
  assert(Math.abs(scrollGeom.headerX1 - scrollGeom.headerX0) < 1,
    `#191 头部横带不随横向滚动：${scrollGeom.headerX0} → ${scrollGeom.headerX1}`)
  assert.notEqual(scrollGeom.maskImage, 'none',
    `#191 行号遮罩卡片色层应在场：${scrollGeom.maskImage}`)
  const maskAlpha = /rgba?\(\d+, \d+, \d+(?:, ([\d.]+))?\)/.exec(scrollGeom.maskColor)
  assert.ok(maskAlpha && (maskAlpha[1] === undefined || Number(maskAlpha[1]) === 1),
    `#191 遮罩底层应为不透明色：${scrollGeom.maskColor}`)

  // (c-restore) 再点恢复折行：全部块回 pre-wrap；恢复后长行续行仍对齐
  // （验收「再开启恢复折行且续行对齐」）；折行钮进卡即显——鼠标仍在卡内，
  // 显现态延续，点击前确保 hover 在场
  await firstReadCard.hover()
  await wrapBtn.click()
  await page.waitForFunction(() =>
    !document.querySelector('.vsidian-view-reading')?.classList.contains('vsidian-reading-nowrap'))
  const wrapStates = await page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-reading-code-card > pre')]
      .map((pre) => getComputedStyle(pre).whiteSpace))
  assert(wrapStates.every((v) => v === 'pre-wrap'),
    `#191 再点开关应全文恢复折行，实际 ${wrapStates.join(',')}`)
  const readRewrap = await longLineMetrics('.vsidian-reading-code-line')
  assert.ok(readRewrap, '恢复折行后长行应有续行')
  assert(Math.abs(readRewrap.contX - readRewrap.firstX) < 1,
    `#191 恢复折行后续行仍与文本列对齐：${readRewrap.contX} vs ${readRewrap.firstX}`)

  // (a-live) Live 恒折行：卡片不放折行钮（CM6 lineWrapping 是编辑器级
  // facet 无法按块关）；长行续行对齐（窜行修复）+ 首行零位移
  await page.evaluate(() => window.setCodeMode('live'))
  await page.waitForSelector('.cm-line.vsidian-code-card-line')
  assert.equal(await page.evaluate(() => document.querySelectorAll('#app .vsidian-view-live .vsidian-code-card-wrap').length),
    0, '#191 Live 卡片不装配折行钮（阅读容器隐藏未销毁，选择器须限定 live 容器）')
  const liveWrap = await longLineMetrics('.cm-line.vsidian-code-card-line')
  assert.ok(liveWrap, 'live 长行应折出续行（lineWrapping 全局折行）')
  assert(Math.abs(liveWrap.contX - liveWrap.firstX) < 1,
    `#191 Live 续行首字符应与文本列对齐：续行 ${liveWrap.contX} vs 首行 ${liveWrap.firstX}`)
  assert.ok(liveWrap.lnRight !== null && liveWrap.contX > liveWrap.lnRight + 15,
    `#191 Live 续行不得窜入行号区：续行 x ${liveWrap.contX} 应 > 行号右缘+15（${liveWrap.lnRight}）`)
  assert(Math.abs(((liveWrap.lnLeft ?? -1) - liveWrap.lineLeft) - 8) < 1,
    `#191 Live 首行行号左缘应距行左缘 8px：${liveWrap.lnLeft} vs ${liveWrap.lineLeft}`)

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('codeCardChrome: #189 + #190 + #191 断言通过（围栏真实对齐、折叠钮位置恒定、整卡悬停恒显、整条热区、折行开关与续行对齐）')
} finally {
  await browser.close()
}
