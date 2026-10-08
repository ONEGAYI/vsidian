// 代码块卡片绘制层回归（#189/#190/#191/#389）：真实 Chromium + 生产控制器 +
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
    // 数字文字右缘（Range 全量矩形）：右对齐锚定须抵消行级负 text-indent 的
    // 继承——盒内文字不因悬挂缩进移位（评审 A 疑点的回归钉）
    let numberTextRight = null
    if (number) {
      const range = document.createRange()
      range.selectNodeContents(number)
      numberTextRight = range.getBoundingClientRect().right
    }
    return {
      fenceTopX: window.textX(fence),
      codeX: window.textX(code),
      numberX: number ? number.getBoundingClientRect().left : null,
      numberTextRight,
      numberBoxRight: number ? number.getBoundingClientRect().right : null,
      codeLineX: code.getBoundingClientRect().left,
      fencePad: getComputedStyle(fence).paddingLeft,
    }
  })
  assert(Math.abs((small.fenceTopX ?? -1) - (small.codeX ?? -2)) < 1,
    `#189 开围栏符号应与代码文本列同 x：围栏 ${small.fenceTopX} vs 文本 ${small.codeX}`)
  // 行号边距 8+16 重分配：行号左缘让出 8px（数字右移，列总占与代码列 x 不变）
  assert(Math.abs(((small.numberX ?? -1) - (small.codeLineX ?? -2)) - 8) < 1,
    `#189 代码行行号左缘应距行左缘 8px：行号 ${small.numberX} vs 行左缘 ${small.codeLineX}`)
  assert(Math.abs((small.numberTextRight ?? -1) - (small.numberBoxRight ?? -2)) < 1,
    `#189 行号数字应右对齐贴盒右缘（负 text-indent 继承不致文字移位）：文字 ${small.numberTextRight} vs 盒 ${small.numberBoxRight}`)
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

  // (a-reading) 折行态（默认）：卡内行号 2026-10 起阅读侧不再发射——续行与
  // 首行同 x 顶格对齐（无行号区可窜、无悬挂缩进），全文无行号节点
  const readWrap = await longLineMetrics('.vsidian-reading-code-line')
  assert.ok(readWrap, '阅读长行应折出续行（127 字符 > 视口可用宽）')
  assert(Math.abs(readWrap.contX - readWrap.firstX) < 1,
    `#191 阅读续行首字符应与首行同 x（行号退场后顶格对齐）：续行 ${readWrap.contX} vs 首行 ${readWrap.firstX}`)
  assert.equal(await page.evaluate(() =>
    document.querySelectorAll('.vsidian-view-reading .vsidian-code-card-linenumber').length),
  0, '阅读侧不得发射卡内行号（2026-10 退场，codeblock.lineNumbers 仅 Live）')

  // (b/d) 阅读关闭折行：点击任一块折行钮 → 容器类 + 全部已挂载块（含
  // 大围栏各片）pre 同时进入 nowrap；不触发热区折叠。折行钮与复制钮同口径
  // 进卡即显（#190 决议）：未悬停隐藏，hover 卡片显现后方可点击
  const wrapBtn = page.locator('.vsidian-reading-block.vsidian-reading-code-card').first()
    .locator('button.vsidian-code-card-wrap')
  // 先把指针移到正文段落（卡片横带贴近容器左缘，(8,8) 仍可能落在卡上）；
  // 隐藏断言等 opacity 数值过渡（0.12s）归零——视觉上移出即隐（visibility
  // 立即生效），数值经过渡稳定，不得在过渡起点立即断读
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

  // (b-geometry) 长行卡片横向滚动：scrollWidth > clientWidth；头部不随滚动。
  // 行号 sticky 钉左与遮罩已随 2026-10 阅读侧行号退场移除（无行号可钉）
  const scrollGeom = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.vsidian-reading-code-line')]
      .find((el) => el.textContent.includes('wrapLongLine'))
    const pre = line ? line.closest('pre') : null
    const card = line ? line.closest('.vsidian-reading-code-card') : null
    const header = card ? card.querySelector('.vsidian-code-card-header') : null
    if (!pre || !header) {
      return null
    }
    const headerX0 = header.getBoundingClientRect().x
    const before = { scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth, overflowX: getComputedStyle(pre).overflowX }
    pre.scrollLeft = 9999
    return {
      ...before,
      scrolled: pre.scrollLeft,
      headerX1: header.getBoundingClientRect().x,
      headerX0,
    }
  })
  assert.ok(scrollGeom, '长行卡片几何应可采样')
  assert.equal(scrollGeom.overflowX, 'auto', '#191 nowrap pre 应 overflow-x auto')
  assert.ok(scrollGeom.scrollWidth > scrollGeom.clientWidth,
    `#191 长行应出现横向滚动（scrollWidth ${scrollGeom.scrollWidth} > clientWidth ${scrollGeom.clientWidth}）`)
  assert.ok(scrollGeom.scrolled > 0, '横向滚动应已发生位移')
  assert(Math.abs(scrollGeom.headerX1 - scrollGeom.headerX0) < 1,
    `#191 头部横带不随横向滚动：${scrollGeom.headerX0} → ${scrollGeom.headerX1}`)

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

  // ---- #389：语言扩展的真实文字绘制（生产色板，无测试 CSS 改写） ----
  const paintColors = {
    light: { string: 'rgb(10, 48, 105)', string2: 'rgb(129, 31, 63)', number: 'rgb(9, 134, 88)', keyword: 'rgb(175, 0, 219)',
      comment: 'rgb(110, 119, 129)', meta: 'rgb(5, 80, 174)',
      inserted: 'rgb(34, 134, 58)', deleted: 'rgb(179, 29, 40)' },
    dark: { string: 'rgb(165, 214, 255)', string2: 'rgb(209, 105, 105)', number: 'rgb(181, 206, 168)', keyword: 'rgb(197, 134, 192)',
      comment: 'rgb(139, 148, 158)', meta: 'rgb(121, 192, 255)',
      inserted: 'rgb(133, 232, 157)', deleted: 'rgb(249, 117, 131)' },
  }
  const assertTokenPaint = async (scope, tokenClass, text, color, label) => {
    const selector = `${scope} .${tokenClass}`
    await page.waitForFunction(({ selector, text, color }) => {
      const paint = window.codePaint(selector, text)
      return paint?.visible === true && paint.color === color
    }, { selector, text, color })
    const paint = await page.evaluate(({ selector, text }) => window.codePaint(selector, text), { selector, text })
    assert.equal(paint?.visible, true, `${label}：目标文字应实际可见并命中绘制层`)
    assert.equal(paint?.color, color, `${label}：目标文字应使用生产词类色`)
    return paint
  }
  const languageCases = [
    { info: 'ngspice title=paint', id: 'spice', label: 'SPICE', badge: 'SP', badgeColor: 'rgb(45, 140, 140)',
      code: '.param gain=2', text: '.param', kind: 'keyword' },
    { info: 'mk', id: 'makefile', label: 'Makefile', badge: 'MK', badgeColor: 'rgb(109, 128, 134)',
      code: 'all:\n\t@echo "make recipe paint"', text: 'make recipe paint', kind: 'string' },
    { info: 'php', id: 'php', label: 'PHP', badge: 'PHP', badgeColor: 'rgb(119, 123, 180)',
      code: '$label = "plain PHP paint";', text: 'plain PHP paint', kind: 'string' },
    { info: 'gql', id: 'graphql', label: 'GraphQL', badge: 'GQL', badgeColor: 'rgb(225, 0, 152)',
      code: 'query PaintChip { chip { id } }', text: 'query', kind: 'keyword' },
    { info: 'TCL title=paint', id: 'tcl', label: 'Tcl', badge: 'Tcl', badgeColor: 'rgb(228, 204, 152)',
      code: 'set message "quoted Tcl paint"', text: 'quoted Tcl paint', kind: 'string' },
    { info: 'VHD', id: 'vhdl', label: 'VHDL', badge: 'VHD', badgeColor: 'rgb(173, 178, 203)',
      code: 'entity PaintChip is\nend entity;', text: 'entity', kind: 'keyword' },
    { info: 'properties', id: 'ini', label: 'INI', badge: 'INI', badgeColor: 'rgb(109, 128, 134)',
      code: '[paint_section]\ncolor=blue', text: '[paint_section]', kind: 'meta' },
    { info: 'patch', id: 'diff', label: 'Diff', badge: '+−', badgeColor: 'rgb(86, 138, 53)',
      code: '-removed_paint\n+added_paint', text: '+added_paint', kind: 'inserted' },
    { info: 'PGSQL title=paint', id: 'postgresql', label: 'PostgreSQL', badge: 'PG', badgeColor: 'rgb(227, 140, 0)',
      code: 'SELECT $tag$postgres -- paint$tag$;', text: 'postgres -- paint', kind: 'string' },
    { info: 'MYSQL', id: 'mysql', label: 'MySQL', badge: 'My', badgeColor: 'rgb(227, 140, 0)',
      code: 'SELECT `paint name`; # mysql paint', text: '# mysql paint', kind: 'comment' },
    { info: 'SQLITE', id: 'sqlite', label: 'SQLite', badge: 'Lite', badgeColor: 'rgb(227, 140, 0)',
      code: 'SELECT [sqlite paint] FROM records;', text: '[sqlite paint]', kind: 'string2' },
    { info: 'JSONC', id: 'jsonc', label: 'JSONC', badge: '{c}', badgeColor: 'rgb(168, 185, 204)',
      code: '{"key": 1, /* jsonc paint */}', text: 'jsonc paint', kind: 'comment' },
    { info: 'JSON5', id: 'json5', label: 'JSON5', badge: '{5}', badgeColor: 'rgb(168, 185, 204)',
      code: "{unquoted: +.5, label: 'json5 paint',}", text: '+.5', kind: 'number' },
  ]
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.body.classList.toggle('vscode-dark', theme === 'dark')
      document.body.classList.toggle('vscode-light', theme === 'light')
      document.body.style.setProperty('--vscode-editor-foreground', theme === 'dark' ? '#d4d4d4' : '#1f2328')
      document.body.style.setProperty('--vscode-editor-background', theme === 'dark' ? '#1e1e1e' : '#ffffff')
    }, theme)
    for (const language of languageCases) {
      const source = ['Language paint.', '', `\`\`\`${language.info}`, language.code, '```', '', 'Tail.'].join('\n')
      await page.evaluate((source) => window.initCode(source), source)
      for (const mode of ['live', 'reading', 'live']) {
        await page.evaluate((mode) => window.setCodeMode(mode), mode)
        await page.evaluate((offset) => window.locateCode(offset), source.indexOf(language.text))
        const scope = `#app .vsidian-view-${mode}`
        const label = `#389/#391 ${theme}/${mode}/${language.id}`
        await assertTokenPaint(scope, `tok-${language.kind}`, language.text, paintColors[theme][language.kind], label)
        const header = `${scope} .vsidian-code-card-header[data-vsidian-code-lang="${language.id}"]`
        await page.locator(header).scrollIntoViewIfNeeded()
        const badge = await page.evaluate(({ header, badge }) =>
          window.codePaint(`${header} .vsidian-code-card-header-icon`, badge), { header, badge: language.badge })
        assert.equal(badge?.visible, true, `${label}：语言字形徽标应实际绘制`)
        assert.equal(badge?.color, language.badgeColor, `${label}：徽标应使用对应语言色`)
        assert.equal(await page.locator(`${header} .vsidian-code-card-header-label`).evaluate((el) =>
          el.lastChild?.textContent), language.label, `${label}：首词/别名应显示规范标签`)
        if (language.id === 'diff') {
          const removed = await assertTokenPaint(scope, 'tok-deleted', '-removed_paint', paintColors[theme].deleted, label)
          const added = await assertTokenPaint(scope, 'tok-inserted', '+added_paint', paintColors[theme].inserted, label)
          assert.notEqual(removed.color, added.color, `${label}：增删文本必须肉眼可区分`)
        }
      }
    }
  }

  // 新语言仍遵守既有两个独立开关：禁高亮仍可读，关卡片仍保留高亮。
  const settingsSource = '```tcl\nset message "settings Tcl paint"\n```'
  await page.evaluate((source) => window.initCode(source), settingsSource)
  for (const mode of ['live', 'reading']) {
    await page.evaluate((mode) => window.setCodeMode(mode), mode)
    await page.evaluate((offset) => window.locateCode(offset), settingsSource.indexOf('settings Tcl paint'))
    const scope = `#app .vsidian-view-${mode}`
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'settings.snapshot',
      values: { 'codeblock.card': true, 'codeblock.highlight': false } }))
    const rawSelector = `${scope} ${mode === 'live' ? '.cm-line' : '.vsidian-reading-code-line'}`
    await page.waitForFunction(({ rawSelector, scope }) =>
      window.codePaint(rawSelector, 'settings Tcl paint')?.visible === true &&
      document.querySelectorAll(`${scope} [class*="tok-"]`).length === 0, { rawSelector, scope })
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'settings.snapshot',
      values: { 'codeblock.card': false, 'codeblock.highlight': true } }))
    await assertTokenPaint(scope, 'tok-string', 'settings Tcl paint', paintColors.dark.string,
      `#389 ${mode} 关闭卡片仍真实高亮`)
    assert.equal(await page.locator(`${scope} .vsidian-code-card-header`).count(), 0,
      '#389 关闭卡片后不得残留工具条')
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'settings.snapshot',
      values: { 'codeblock.card': true, 'codeblock.highlight': true } }))
    await assertTokenPaint(scope, 'tok-string', 'settings Tcl paint', paintColors.dark.string,
      `#389 ${mode} 设置恢复后真实高亮`)
  }

  // 完整围栏上下文：第 65 行在第二片，首片开头的多行状态必须仍在。
  // 末尾加入足够多的段落，使定位离开后目标 DOM 确实卸载（不是隐藏）。
  const chunkCases = [
    { info: 'gql', open: '"""paint_open', close: '"""\ntype Chip { id: ID! }',
      marker: 'paint_graphql_after_sixty', kind: 'string' },
    { info: 'php', open: '<?php /* paint_open', close: '*/ echo 1; ?>',
      marker: 'paint_php_after_sixty', kind: 'comment' },
    { info: 'kotlin', open: '/* paint_open', close: '*/\nval after = 7',
      marker: 'paint_comment_after_sixty', kind: 'comment' },
    { info: 'toml', open: 'message = """paint_open', close: '"""',
      marker: 'paint_string_after_sixty', kind: 'string' },
    { info: 'jsonc', open: '{ /* paint_open', close: '*/ "after": 2}',
      marker: 'paint_jsonc_after_sixty', kind: 'comment' },
    { info: 'json5', open: '{key: "paint_open\\', fill: '\\', close: 'closing", after: 2}',
      marker: 'paint_json5_after_sixty', kind: 'string' },
    { info: 'postgresql', open: 'SELECT $tag$paint_open', close: 'closing$tag$;',
      marker: 'paint_postgres_after_sixty', kind: 'string' },
  ]
  for (const sample of chunkCases) {
    const source = ['Cross-chunk paint.', '', `\`\`\`${sample.info}`, sample.open,
      ...Array.from({ length: 63 }, (_, i) => `context filler ${i + 2}${sample.fill ?? ""}`),
      sample.marker + (sample.fill ?? ''), sample.close, '```', '',
      ...Array.from({ length: 160 }, (_, i) => `Distant paragraph ${i}.\n`),
      'far_remount_anchor'].join('\n')
    await page.evaluate((source) => window.initCode(source), source)
    for (const mode of ['live', 'reading', 'live']) {
      await page.evaluate((mode) => window.setCodeMode(mode), mode)
      await page.evaluate((offset) => window.locateCode(offset), source.indexOf(sample.marker))
      const paint = await assertTokenPaint(`#app .vsidian-view-${mode}`, `tok-${sample.kind}`,
        sample.marker, paintColors.dark[sample.kind], `#389 ${mode} 跨片 ${sample.info}`)
      // 卡内行号 2026-10 起仅 Live：跨片定位以行号锚定时只在 live 断言，
      // reading 侧断言行号缺席（跨片上下文本身由 token 着色验证）
      if (mode === 'live') {
        assert.equal(paint.lineNumber, '65', '#389 跨片仍保持原文第 65 行行号')
      } else {
        assert.equal(paint.lineNumber, null, '#389 阅读侧无卡内行号（2026-10 退场）')
      }
      if (mode === 'reading') {
        await page.evaluate((marker) => {
          window.previousCodeToken = [...document.querySelectorAll('.vsidian-view-reading [class*="tok-"]')]
            .find((el) => el.textContent.includes(marker))
        }, sample.marker)
        await page.evaluate((offset) => window.locateCode(offset), source.indexOf('far_remount_anchor'))
        await page.waitForFunction(() => window.previousCodeToken && !window.previousCodeToken.isConnected)
        await page.evaluate((offset) => window.locateCode(offset), source.indexOf(sample.marker))
        const remounted = await assertTokenPaint('#app .vsidian-view-reading', `tok-${sample.kind}`,
          sample.marker, paintColors.dark[sample.kind], `#389 重挂 ${sample.info}`)
        assert.equal(remounted.lineNumber, null, '#389 阅读侧重挂后同样无卡内行号')
      }
    }
    assert.equal(await page.evaluate(() => window.controller.getView().state.doc.toString()), source,
      '#389 模式切换与视口回收不得改写围栏源码')
  }

  // 整块 4096/4097 边界：第二片不得因仅看到 60 行而绕过降级。
  for (const lineCount of [4096, 4097]) {
    const body = Array.from({ length: lineCount }, (_, i) =>
      i === 64 ? 'set message "paint_limit_after_sixty"' : `# limit filler ${i + 1}`)
    const source = ['```tcl', ...body, '```'].join('\n')
    await page.evaluate((source) => window.initCode(source), source)
    for (const mode of ['live', 'reading']) {
      await page.evaluate((mode) => window.setCodeMode(mode), mode)
      await page.evaluate((offset) => window.locateCode(offset), source.indexOf('paint_limit_after_sixty'))
      const scope = `#app .vsidian-view-${mode}`
      if (lineCount === 4096) {
        const paint = await assertTokenPaint(scope, 'tok-string', 'paint_limit_after_sixty',
          paintColors.dark.string, `#389 ${mode} 4096 行边界`)
        if (mode === 'live') {
          assert.equal(paint.lineNumber, '65', '#389 边界内着色保持原行号')
        } else {
          assert.equal(paint.lineNumber, null, '#389 阅读侧边界内无卡内行号')
        }
      } else {
        const selector = `${scope} ${mode === 'live' ? '.cm-line' : '.vsidian-reading-code-line'}`
        await page.waitForFunction(({ selector, scope }) => {
          const raw = window.codePaint(selector, 'paint_limit_after_sixty')
          return raw?.visible === true && raw.color === 'rgb(212, 212, 212)' &&
            document.querySelectorAll(`${scope} [class*="tok-"]`).length === 0
        }, { selector, scope })
        const raw = await page.evaluate((selector) =>
          window.codePaint(selector, 'paint_limit_after_sixty'), selector)
        if (mode === 'live') {
          assert.equal(raw.lineNumber, '65', '#389 降级仍显示原文与原行号')
        } else {
          assert.equal(raw.lineNumber, null, '#389 阅读侧降级同样无卡内行号')
        }
      }
    }
    assert.equal(await page.evaluate(() => window.controller.getView().state.doc.toString()), source,
      '#389 超大围栏高亮降级不得删改源码')
  }

  // Markdown hover/embed 的共用 RefContentInstance 装配：朴素 code 路径也
  // 必须读取整块上下文。这里不伪造 token DOM，也不复制阅读增强逻辑。
  const refSource = ['```toml', 'message = """paint_open',
    ...Array.from({ length: 63 }, (_, i) => `reference filler ${i + 2}`),
    'paint_reference_after_sixty', '"""', '```'].join('\n')
  for (let mount = 0; mount < 2; mount++) {
    await page.evaluate(({ source, offset }) => window.mountCodeReference(source, offset),
      { source: refSource, offset: refSource.indexOf('paint_reference_after_sixty') })
    await assertTokenPaint('#code-reference-surface', 'tok-string', 'paint_reference_after_sixty',
      paintColors.dark.string, `#389 Markdown 引用 ${mount === 0 ? '首次挂载' : '重新挂载'}`)
  }

  // 已挂载引用的高亮开关：只改变 token 子节点，不能用重挂整篇恢复颜色。
  // 控制器到 hover/embed 的路由由控制器单测覆盖；这里直驱同一 mount 刷新口，
  // 验证生产朴素 code 的实际绘制，以及用户正在阅读的位置和节点不变。
  const referenceBefore = await page.evaluate(() => {
    const surface = document.getElementById('code-reference-surface')
    const code = [...surface.querySelectorAll('pre > code')]
      .find((el) => el.textContent.includes('paint_reference_after_sixty'))
    const block = code.closest('.vsidian-reading-block')
    window.referencePaintBefore = { surface, code, block, pre: code.parentElement,
      text: code.textContent, scrollTop: surface.scrollTop }
    return { scrollTop: surface.scrollTop,
      color: window.codePaint('#code-reference-surface .tok-string', 'paint_reference_after_sixty')?.color }
  })
  assert.ok(referenceBefore.scrollTop > 0, '#389 引用热切换必须覆盖已滚动到后片的阅读位置')
  for (const enabled of [false, true]) {
    await page.evaluate((enabled) => window.setCodeReferenceHighlight(enabled), enabled)
    if (enabled) {
      await assertTokenPaint('#code-reference-surface', 'tok-string', 'paint_reference_after_sixty',
        referenceBefore.color, '#389 引用原地恢复高亮应还原原词类色')
    } else {
      await page.waitForFunction(() => {
        const paint = window.codePaint('#code-reference-surface pre > code', 'paint_reference_after_sixty')
        return paint?.visible === true && paint.color === 'rgb(212, 212, 212)' &&
          document.querySelectorAll('#code-reference-surface [class*="tok-"]').length === 0
      })
    }
    const after = await page.evaluate(() => {
      const before = window.referencePaintBefore
      const surface = document.getElementById('code-reference-surface')
      const code = [...surface.querySelectorAll('pre > code')]
        .find((el) => el.textContent.includes('paint_reference_after_sixty'))
      return { sameSurface: surface === before.surface, sameCode: code === before.code,
        samePre: code?.parentElement === before.pre,
        sameBlock: code?.closest('.vsidian-reading-block') === before.block,
        sameText: code?.textContent === before.text, scrollDelta: surface.scrollTop - before.scrollTop,
        headers: surface.querySelectorAll('.vsidian-code-card-header').length }
    })
    assert.ok(after.sameSurface && after.sameBlock && after.samePre && after.sameCode,
      `#389 引用开关不得重挂 surface/block/pre/code：${JSON.stringify(after)}`)
    assert.ok(after.sameText, '#389 引用开关不得改写朴素代码原文')
    assert.ok(Math.abs(after.scrollDelta) < 1, `#389 引用开关不得改变滚动位置：${after.scrollDelta}`)
    assert.equal(after.headers, 0, '#389 引用高亮切换仍保留无卡片工具条的原形态')
  }

  for (const language of languageCases.filter((sample) => ['postgresql', 'mysql', 'sqlite', 'jsonc', 'json5'].includes(sample.id))) {
    const source = `\`\`\`${language.info}\n${language.code}\n\`\`\``
    await page.evaluate((source) => window.mountCodeReference(source, 0), source)
    await assertTokenPaint('#code-reference-surface', `tok-${language.kind}`, language.text,
      paintColors.dark[language.kind], `#391 Markdown reference/${language.id}`)
  }

  assert.deepEqual(errors, [], '页面不得有脚本错误')
  console.log('codeCardChrome: #189 + #190 + #191 + #389 + #391 断言通过（围栏真实对齐、折叠钮位置恒定、整卡悬停恒显、整条热区、折行开关、续行对齐与语言文字真实着色）')
} finally {
  await browser.close()
}
