// Mermaid 绘制探针回归：在真实 Chromium 布局下经 view.state.paint 观察。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'quick/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/quickActionsFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  // 1.0.2 回归：真实 Live 围栏装饰不能把源码行底色绘到图形四周。
  // SVG stub 只隔离异步绘图；外层行、widget 与双模式由生产控制器创建。
  await page.evaluate(() => {
    window.mermaid = { initialize() {}, async render() {
      return { svg: '<svg width="100" height="100" style="background:white"><rect width="100" height="100" fill="white"/></svg>' }
    } }
    document.getElementById('app').style.setProperty('--vsidian-live-code-background', 'rgb(50, 51, 52)')
    document.getElementById('app').style.setProperty('--vsidian-code-card-background', 'rgb(70, 71, 72)')
    window.initQuick('```mermaid\nflowchart TD\nA-->B\n```\n\n结尾')
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  })
  await page.waitForFunction(() => document.querySelector('.vsidian-mermaid svg'))
  const layout = await page.locator('.vsidian-graphic-frame').evaluate(frame => {
    const css = getComputedStyle(frame)
    return { actual: frame.parentElement.getBoundingClientRect().height,
      expected: frame.getBoundingClientRect().height + parseFloat(css.marginTop) + parseFloat(css.marginBottom) }
  })
  assert.ok(Math.abs(layout.actual - layout.expected) < 1,
    `图形行高度应只包含图形及其上下边距，不能多出光标缓冲空行：${JSON.stringify(layout)}`)
  const surround = await page.locator('.vsidian-graphic-frame').evaluate(frame => {
    const layers = []
    for (let el = frame; el && !el.classList.contains('cm-content'); el = el.parentElement) {
      layers.push({ className: el.className, background: getComputedStyle(el).backgroundColor })
    }
    return layers
  })
  assert.ok(surround.every(layer => layer.background === 'rgba(0, 0, 0, 0)'),
    `Live 图形外层应透明，不能继承源码行底色：${JSON.stringify(surround)}`)
  for (const theme of [
    { name: 'vscode-light', size: '14px', lineHeight: '1.5' },
    { name: 'vscode-dark', size: '18px', lineHeight: '2' },
    { name: 'vscode-high-contrast', size: '24px', lineHeight: '1.5' },
  ]) {
    await page.evaluate(theme => {
      document.body.className = theme.name
      document.getElementById('app').style.setProperty('--vsidian-content-font-size', theme.size)
      document.getElementById('app').style.setProperty('--vsidian-content-line-height', theme.lineHeight)
    }, theme)
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }))
    await page.waitForFunction(() => document.querySelector('.vsidian-view-reading .vsidian-mermaid svg'))
    assert.equal(await page.locator('.vsidian-view-reading .vsidian-graphic-frame').evaluate(el => getComputedStyle(el.parentElement).backgroundColor),
      'rgba(0, 0, 0, 0)', `${theme.name} 阅读图形外层应透明`)
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'live' }))
    await page.waitForFunction(() => document.querySelector('.cm-content .vsidian-mermaid svg'))
    assert.equal(await page.locator('.cm-content .vsidian-graphic-frame').evaluate(el => getComputedStyle(el.parentElement).backgroundColor),
      'rgba(0, 0, 0, 0)', `${theme.name} 切回 Live 后图形外层应透明`)
    const extraHeight = await page.locator('.cm-content .vsidian-graphic-frame').evaluate(frame => {
      const css = getComputedStyle(frame)
      return frame.parentElement.getBoundingClientRect().height - frame.getBoundingClientRect().height
        - parseFloat(css.marginTop) - parseFloat(css.marginBottom)
    })
    assert.ok(Math.abs(extraHeight) < 1, `${theme.name}/${theme.size}/${theme.lineHeight} 不应多出光标缓冲空行：${extraHeight}px`)
  }
  await page.locator('.vsidian-graphic-chrome-edit').evaluate(button => button.click())
  // edit 点击选中整个围栏区间（本变更新增契约）：fixture 文档以围栏开头，
  // 围栏区间 = 0 .. 文档首个空行前（双换行到结尾段的首个换行处）
  const selAfterEdit = await page.evaluate(() => {
    const view = window.controller.getView()
    const sel = view.state.selection.main
    const fenceTo = view.state.doc.toString().indexOf('\n\n结尾')
    return { anchor: sel.anchor, head: sel.head, empty: sel.empty, fenceTo }
  })
  assert.ok(selAfterEdit.fenceTo > 0, '围栏区间推导成功')
  assert.ok(!selAfterEdit.empty && selAfterEdit.anchor === 0 && selAfterEdit.head === selAfterEdit.fenceTo,
    `edit 点击应选中整个围栏区间（实际 ${JSON.stringify(selAfterEdit)}，期望 [0,${selAfterEdit.fenceTo}]）`)
  assert.equal(await page.locator('.vsidian-code-line').first().evaluate(el => getComputedStyle(el).backgroundColor),
    'rgb(70, 71, 72)', '进入源码后仍使用既有代码卡片背景变量')
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'codeblock.card': false } }))
  assert.equal(await page.locator('.vsidian-code-line').first().evaluate(el => getComputedStyle(el).backgroundColor),
    'rgb(50, 51, 52)', '关闭卡片后源码仍使用既有代码行背景变量')
  await page.evaluate(() => {
    document.body.className = ''
    const root = document.getElementById('app')
    for (const key of ['--vsidian-content-font-size', '--vsidian-content-line-height',
      '--vsidian-live-code-background', '--vsidian-code-card-background']) root.style.removeProperty(key)
    window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'codeblock.card': true } })
  })
  await page.evaluate(() => window.initQuick('正文'))

  const hidden = await page.evaluate(() => {
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.style.cssText = 'position:fixed;left:100px;top:100px;width:100px;height:100px;background:red;z-index:1000'
    diagram.innerHTML = '<svg width="100" height="100" style="visibility:hidden"><rect width="100" height="100" fill="blue"/></svg>'
    window.controller.getView().contentDOM.appendChild(diagram)
    const hit = document.elementFromPoint(150, 150)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    const state = window.quickSent().at(-1)
    return { visible: state.paint?.mermaid?.visible, hitContainer: hit === diagram,
      svgVisibility: getComputedStyle(diagram.querySelector('svg')).visibility }
  })
  assert.equal(hidden.hitContainer, true, '预置条件：隐藏 SVG 的中心命中可见容器')
  assert.equal(hidden.svgVisibility, 'hidden')
  assert.equal(hidden.visible, false, 'SVG visibility:hidden 时不能把容器背景视为图表绘制')

  const clipped = await page.evaluate(() => {
    const crop = document.createElement('div')
    crop.style.cssText = 'position:fixed;left:250px;top:100px;width:100px;height:30px;overflow:hidden;z-index:1000'
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.style.cssText = 'width:100px;height:100px'
    diagram.innerHTML = '<svg width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    crop.appendChild(diagram)
    window.controller.getView().contentDOM.appendChild(crop)
    const svg = diagram.querySelector('svg')
    const topHit = document.elementFromPoint(300, 115)
    const centerHit = document.elementFromPoint(300, 150)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    const state = window.quickSent().at(-1)
    return { visible: state.paint?.mermaid?.visible,
      topHitSvg: svg.contains(topHit), centerHitSvg: svg.contains(centerHit) }
  })
  assert.equal(clipped.topHitSvg, true, '预置条件：裁切后顶部 30px 仍绘出 SVG')
  assert.equal(clipped.centerHitSvg, false, '预置条件：SVG 几何中心已被祖先裁切')
  assert.equal(clipped.visible, true, '祖先裁切后仍有 SVG 绘制像素应判为可见')

  const transparent = await page.evaluate(() => {
    window.controller.getView().contentDOM.querySelectorAll('.vsidian-mermaid').forEach((el) =>
      el.parentElement?.style.position === 'fixed' ? el.parentElement.remove() : el.remove())
    const layer = document.createElement('div')
    layer.style.cssText = 'position:fixed;left:100px;top:250px;width:100px;height:100px;opacity:0;z-index:1000'
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.innerHTML = '<svg width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    layer.appendChild(diagram)
    window.controller.getView().contentDOM.appendChild(layer)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    return window.quickSent().at(-1).paint?.mermaid?.visible
  })
  assert.equal(transparent, false, '祖先 opacity:0 时 SVG 未绘制')

  const partlyCovered = await page.evaluate(() => {
    window.controller.getView().contentDOM.querySelectorAll('.vsidian-mermaid').forEach((el) =>
      el.parentElement?.remove())
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.style.cssText = 'position:fixed;left:100px;top:250px;width:100px;height:100px;z-index:1000'
    diagram.innerHTML = '<svg width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    window.controller.getView().contentDOM.appendChild(diagram)
    const cover = document.createElement('div')
    cover.style.cssText = 'position:fixed;left:130px;top:280px;width:40px;height:40px;background:red;z-index:1001'
    document.body.appendChild(cover)
    const centerHit = document.elementFromPoint(150, 300)
    const edgeHit = document.elementFromPoint(120, 270)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    return { visible: window.quickSent().at(-1).paint?.mermaid?.visible,
      centerCovered: centerHit === cover,
      edgeSvg: diagram.querySelector('svg').contains(edgeHit) }
  })
  assert.equal(partlyCovered.centerCovered, true, '预置条件：图形中心被浮层挡住')
  assert.equal(partlyCovered.edgeSvg, true, '预置条件：图形边缘仍可见')
  assert.equal(partlyCovered.visible, true, '中心受遮挡时仍应识别其他可见 SVG 区域')

  const transparentGraphic = await page.evaluate(() => {
    document.querySelectorAll('.vsidian-mermaid').forEach((el) => el.remove())
    document.querySelectorAll('body > div').forEach((el) => {
      if (el.style.zIndex === '1001') el.remove()
    })
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.style.cssText = 'position:fixed;left:100px;top:250px;width:100px;height:100px;z-index:1000'
    diagram.innerHTML = '<svg width="100" height="100"><rect width="100" height="100" style="opacity:0"/></svg>'
    window.controller.getView().contentDOM.appendChild(diagram)
    const graphic = diagram.querySelector('rect')
    const hit = document.elementFromPoint(150, 300)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    return { hitGraphic: hit === graphic,
      visible: window.quickSent().at(-1).paint?.mermaid?.visible }
  })
  assert.equal(transparentGraphic.hitGraphic, true,
    '预置条件：opacity:0 的 rect 仍被 elementFromPoint 命中')
  assert.equal(transparentGraphic.visible, false, '透明图形子节点不能报告 SVG 已绘制')

  const emptySvg = await page.evaluate(() => {
    document.querySelectorAll('.vsidian-mermaid').forEach((el) => el.remove())
    document.querySelectorAll('body > div').forEach((el) => {
      if (el.style.zIndex === '1001') el.remove()
    })
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.style.cssText = 'position:fixed;left:250px;top:250px;width:100px;height:100px;z-index:1000'
    diagram.innerHTML = '<svg width="100" height="100"></svg>'
    window.controller.getView().contentDOM.appendChild(diagram)
    const svg = diagram.querySelector('svg')
    const hit = document.elementFromPoint(300, 300)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    return { hitSvg: hit === svg, visible: window.quickSent().at(-1).paint?.mermaid?.visible }
  })
  assert.equal(emptySvg.hitSvg, true, '预置条件：空 SVG 本体会被 elementFromPoint 命中')
  assert.equal(emptySvg.visible, false, '只有空 SVG 视口框时不能报告图形已绘制')

  const strokedLine = await page.evaluate(() => {
    document.querySelectorAll('.vsidian-mermaid').forEach((el) => el.remove())
    const diagram = document.createElement('div')
    diagram.className = 'vsidian-mermaid'
    diagram.setAttribute('data-vsidian-mermaid-state', 'rendered')
    diagram.style.cssText = 'position:fixed;left:100px;top:250px;width:100px;height:100px;z-index:1000'
    diagram.innerHTML = '<svg width="100" height="100"><path d="M10 50 H90" fill="none" stroke="blue" stroke-width="4"/></svg>'
    window.controller.getView().contentDOM.appendChild(diagram)
    const line = diagram.querySelector('path')
    const lineRect = line.getBoundingClientRect()
    const hit = document.elementFromPoint(lineRect.left + lineRect.width / 2, lineRect.top)
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    return { hitLine: hit === line, visible: window.quickSent().at(-1).paint?.mermaid?.visible,
      hitTag: hit?.tagName, lineRect: lineRect.toJSON() }
  })
  assert.equal(strokedLine.hitLine, true, `预置条件：仅描边的线条真实绘制 ${JSON.stringify(strokedLine)}`)
  assert.equal(strokedLine.visible, true, 'Mermaid 描边线条应保持可见判定')
  await page.close()
  console.log('[Mermaid 绘制探针] 隐藏、裁切、透明、遮挡、空 SVG 与描边线条通过')
} finally {
  await browser.close()
}
