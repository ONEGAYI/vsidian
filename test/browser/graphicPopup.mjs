// 图形化代码块交互浏览器回归（工单 #111）：真实 Chromium + 真实 mermaid
// 产物上的原生键鼠路径——按钮悬停显隐、禁点击、edit 迁移、弹窗滚轮缩放/
// 拖拽平移/键盘/Esc、单击图本体不关闭、导出消息与 PNG 光栅化。页面经本地
// HTTP 服务装载并复刻宿主 CSP（含 #111 的 img-src data:）——PNG 光栅化在
// 真实 CSP 约束下的放行实证，不再是无 CSP 环境的空验证。
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = artifactPath(root, 'quick')
await mkdir(outDir, { recursive: true })
const output = path.join(outDir, 'main.js')
await build({
  entryPoints: [path.join(root, 'test/browser/quickActionsFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]',
})
// mermaid 独立产物自建（入口与配置同 esbuild.mjs 的 mermaid target）：CI
// browser job 不跑 npm run compile，引用 out/webview/mermaid.js 会因产物
// 缺失而懒加载 404，本测试须自包含、不依赖前置构建
const mermaidArtifact = artifactPath(root, 'graphicPopup/mermaid.js')
await build({
  entryPoints: [path.join(root, 'src/webview/mermaidEntry.ts')],
   outdir: path.dirname(mermaidArtifact), entryNames: 'mermaid', chunkNames: 'mermaid-chunks/[name]-[hash]',
   bundle: true, platform: 'browser', format: 'esm', splitting: true,
  target: 'chrome118', minify: true, sourcemap: false, logLevel: 'silent',
})

const DOC = [
  '# 图形化代码块',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[开始] --> B{判断}',
  '  B -- 是 --> C[结束]',
  '```',
  '',
].join('\n')

// CSP 复刻（与 textEditorProvider.buildWebviewHtml 同形，含 #111 新增的
// img-src data:）：script-src 'self'+nonce（放行 URI 注入内联脚本与懒加载
// mermaid.js）、style-src 'unsafe-inline'（CM6 与 mermaid SVG 内嵌样式）
const graphicNonce = 'vsidian-graphic-test-nonce'
const pageHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-${graphicNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'">
<link rel="stylesheet" href="/main.css">
<script nonce="${graphicNonce}">window.__vsidianMermaidUri = new URL('/mermaid.js', location.href).href;</script>
</head><body><div id="app"></div><script nonce="${graphicNonce}" src="/main.js"></script></body></html>`

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(pageHtml)
      return
    }
    const rel = url.pathname.slice(1)
    try {
      const data = await readFile(rel === 'mermaid.js' || rel.startsWith('mermaid-chunks/')
        ? path.join(path.dirname(mermaidArtifact), rel) : path.join(outDir, rel))
      res.writeHead(200, {
        'content-type': rel.endsWith('.css') ? 'text/css' : 'text/javascript',
      })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const pageBase = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined,
})
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.goto(pageBase + '/')
  await page.evaluate((doc) => {
    window.initQuick(doc)
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  }, DOC)
  await page.waitForFunction(
    () => document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered',
    null,
    { timeout: 30000 },
  )

  const frame = page.locator('.vsidian-graphic-frame').first()
  const editBtn = page.locator('.vsidian-graphic-chrome-edit').first()
  const popupBtn = page.locator('.vsidian-graphic-chrome-popup').first()

  // 1) 悬停显隐：未悬停透明不可见，悬停 frame 后显现（原生 mouse.move）
  const idleOpacity = await editBtn.evaluate((el) => getComputedStyle(el).opacity)
  assert.equal(idleOpacity, '0', '未悬停时按钮应透明隐藏')
  await frame.hover()
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.vsidian-graphic-chrome-edit')).opacity === '1',
  )
  // 2) 禁点击：原生点击图形中心，光标不落位、渲染图不退场
  const anchorBefore = await page.evaluate(() => window.controller.getView().state.selection.main.anchor)
  const frameBox = await frame.boundingBox()
  await page.mouse.click(frameBox.x + frameBox.width / 2, frameBox.y + Math.min(frameBox.height / 2, 200))
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => ({
    anchor: window.controller.getView().state.selection.main.anchor,
    rendered: document.querySelector('.vsidian-graphic-frame') !== null,
  }))
  assert.equal(after.anchor, anchorBefore, '点击图形不得移动光标（禁点击进编辑）')
  assert.equal(after.rendered, true, '点击图形后渲染图仍在场')

  // 3) edit 按钮：原生点击后光标落围栏、源码显形（编辑入口迁移）
  await frame.hover()
  await editBtn.click()
  await page.waitForFunction(() => document.querySelector('.vsidian-graphic-frame') === null)
  const editState = await page.evaluate(() => ({
    anchor: window.controller.getView().state.selection.main.anchor,
    text: window.controller.getView().state.doc.toString(),
  }))
  assert.equal(editState.anchor, DOC.indexOf('```mermaid'), 'edit 后光标应落围栏起点')
  assert.ok(editState.text.includes('```mermaid'), '文档内容不受 edit 影响（零写回）')

  // 恢复呈现态（光标移出围栏）再开弹窗
  await page.evaluate(() => {
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  })
  await page.waitForFunction(
    () => document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered',
  )

  // 4) popup：原生点击打开全屏浮层，SVG 以矢量装载
  await frame.hover()
  await popupBtn.click()
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-media svg') !== null)
  assert.ok(await page.locator('.vsidian-diagram-overlay').isVisible(), '浮层应可见')

  // 4b) 片段样式保持（#133）：注入弹窗样式（真实片段等效），断言打开在场
  //     即着色；刷新（原地重取源码）后浮层重建内容但样式不丢
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset['vsidianContractProbe'] = 'popup'
    style.textContent = [
      '.vsidian-diagram-toolbar { color: rgb(79, 80, 81); }',
      '.vsidian-diagram-stage { color: rgb(82, 83, 84); }',
    ].join('\n')
    document.head.append(style)
  })
  let popupStyled = await page.evaluate(() => ({
    toolbar: getComputedStyle(document.querySelector('.vsidian-diagram-toolbar')).color,
    stage: getComputedStyle(document.querySelector('.vsidian-diagram-stage')).color,
  }))
  assert.equal(popupStyled.toolbar, 'rgb(79, 80, 81)', '片段应驱动弹窗工具条可见色')
  assert.equal(popupStyled.stage, 'rgb(82, 83, 84)', '片段应驱动弹窗舞台可见色')
  await page.locator('.vsidian-diagram-refresh').click()
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-media svg') !== null)
  await page.waitForTimeout(200)
  popupStyled = await page.evaluate(() => ({
    toolbar: getComputedStyle(document.querySelector('.vsidian-diagram-toolbar')).color,
    stage: getComputedStyle(document.querySelector('.vsidian-diagram-stage')).color,
  }))
  assert.equal(popupStyled.toolbar, 'rgb(79, 80, 81)', '刷新后弹窗工具条样式应保持')
  assert.equal(popupStyled.stage, 'rgb(82, 83, 84)', '刷新后弹窗舞台样式应保持')
  await page.evaluate(() => document.querySelector('style[data-vsidian-contract-probe="popup"]')?.remove())

  // 5) 滚轮缩放（写 SVG 实际尺寸）：放大后 svg width 增长
  const widthBefore = await page.evaluate(() => {
    const svg = document.querySelector('.vsidian-diagram-media svg')
    return Math.round(Number.parseFloat(svg.style.width))
  })
  await page.mouse.move(450, 350)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(150)
  const widthAfter = await page.evaluate(() => {
    const svg = document.querySelector('.vsidian-diagram-media svg')
    return { w: Math.round(Number.parseFloat(svg.style.width)), t: document.querySelector('.vsidian-diagram-media').style.transform }
  })
  assert.ok(widthAfter.w > widthBefore, `滚轮放大应增大 SVG 实际尺寸（${widthBefore} → ${widthAfter.w}）`)

  // 6) 拖拽平移：transform 的 translate 变化
  await page.mouse.move(450, 350)
  await page.mouse.down()
  await page.mouse.move(550, 400, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const panTransform = await page.evaluate(() => document.querySelector('.vsidian-diagram-media').style.transform)
  assert.notEqual(panTransform, widthAfter.t, '拖拽应改变平移 transform')

  // 7) 键盘：0 重置、Esc 关闭（浮层内生效，关闭后焦点归还）
  await page.keyboard.press('0')
  await page.waitForTimeout(100)
  const resetWidth = await page.evaluate(() =>
    Math.round(Number.parseFloat(document.querySelector('.vsidian-diagram-media svg').style.width)),
  )
  assert.ok(resetWidth < widthAfter.w, '0 应重置为 contain-fit 尺寸')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)
  assert.equal(await page.evaluate(() => document.body.style.overflow), '', '关闭后恢复 body overflow')

  // 8) 导出 SVG：经桥发出 diagram.export（生产控制器的消息通道）
  await frame.hover()
  await popupBtn.click()
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-media svg') !== null)
  await page.locator('.vsidian-diagram-export-svg').click()
  await page.waitForFunction(
    () => window.quickSent().some((m) => m.kind === 'diagram.export'),
  )
  const svgExport = await page.evaluate(() =>
    window.quickSent().find((m) => m.kind === 'diagram.export'),
  )
  assert.equal(svgExport.format, 'svg')
  assert.ok(svgExport.content.includes('<svg'), 'SVG 导出内容应为序列化文档')
  assert.ok(svgExport.content.includes('width='), '导出 SVG 应固化尺寸')

  // 9) PNG 光栅化（CSP data: 实证 + foreignObject 风险项实测）：产出
  //    dataURL 并发出 diagram.export；非空 base64 即通过，视觉保真度属
  //    人工验证清单项
  await page.locator('.vsidian-diagram-export-png').click()
  await page.waitForFunction(
    () => window.quickSent().some((m) => m.kind === 'diagram.export' && m.format === 'png'),
    null,
    { timeout: 15000 },
  )
  const pngExport = await page.evaluate(() =>
    window.quickSent().find((m) => m.kind === 'diagram.export' && m.format === 'png'),
  )
  assert.ok(pngExport.content.length > 1000, 'PNG base64 应为非平凡载荷')
  assert.match(pngExport.content, /^[A-Za-z0-9+/]+={0,2}$/, 'PNG 内容应为严格 base64')

  // 10) 关闭路径：单击图形本体不关闭（编辑入口语义），点空白区关闭
  const mediaBox = await page.locator('.vsidian-diagram-media').boundingBox()
  await page.mouse.click(mediaBox.x + mediaBox.width / 2, mediaBox.y + mediaBox.height / 2)
  await page.waitForTimeout(150)
  assert.ok(await page.locator('.vsidian-diagram-overlay').isVisible(), '单击图形本体不得关闭弹窗')
  await page.mouse.click(20, 20)
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-overlay') === null)

  await page.close()
  // Codex 预设：真实产物与 CSP 下的双模式、缓存切换、弹窗导出和语义回归。
  const presetPage = await browser.newPage({ viewport: { width: 1400, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await presetPage.goto(pageBase + '/')
  await presetPage.addStyleTag({ content: 'body { --vscode-editor-background:#fff; --vscode-editor-foreground:#333; --vscode-editorWidget-background:#f8f8f8; --vscode-editorWidget-foreground:#333; }' })
  const codexCode = 'flowchart LR\nS["会话 session"] -->|关系标签 relationship| M["消息 message：user / assistant"]\nM --> T["text：正文"]\nM --> R["reasoning：已暴露的思考记录"]\nM --> F["file：文件与来源引用"]\nM --> U["tool：参数、状态与结果"]'
  await presetPage.evaluate(code => {
    window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'appearance.mermaidTheme': 'codex' } })
    window.initQuick('```mermaid\n' + code + '\n```\n\n结尾')
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  }, codexCode)
  await presetPage.waitForFunction(() => document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered')
  const presetPaint = await presetPage.evaluate(() => {
    const svg = document.querySelector('.vsidian-mermaid svg')
    const rect = svg.querySelector('.node rect.label-container')
    const label = svg.querySelector('.node .label')
    const edge = svg.querySelector('.flowchart-link')
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    return { fill: getComputedStyle(rect).fill, stroke: getComputedStyle(rect).stroke,
      radius: getComputedStyle(rect).rx, text: getComputedStyle(label).fill,
      fontSize: getComputedStyle(label).fontSize, weight: getComputedStyle(label).fontWeight,
      inkWeight: getComputedStyle(label.querySelector('tspan')).fontWeight,
      line: getComputedStyle(edge).stroke, lineWidth: getComputedStyle(edge).strokeWidth,
      paths: [...svg.querySelectorAll('.flowchart-link')].map(el => el.getAttribute('d')),
      visible: window.quickSent().at(-1).paint?.mermaid?.visible,
      labels: svg.textContent, htmlLabels: svg.querySelectorAll('foreignObject').length }
  })
  assert.equal(presetPaint.visible, true)
  assert.equal(presetPaint.fill, 'rgb(229, 243, 255)')
  assert.equal(presetPaint.stroke, 'rgb(206, 219, 229)')
  assert.equal(presetPaint.radius, '16px')
  assert.equal(presetPaint.text, 'rgb(0, 79, 153)')
  assert.equal(presetPaint.fontSize, '14px')
  assert.equal(presetPaint.weight, '600')
  assert.equal(presetPaint.inkWeight, '600', '实际绘制文字应使用 600 字重')
  assert.equal(presetPaint.line, 'rgb(206, 219, 229)')
  assert.equal(presetPaint.lineWidth, '1px')
  assert.equal(presetPaint.htmlLabels, 0)
  assert.equal(presetPaint.paths.length, 5)
  assert.ok(presetPaint.paths.every(d => !/[CQ]/.test(d)), 'ELK 预设应输出折线')
  assert.ok(presetPaint.labels.includes('已暴露的思考记录'))
  const presetArtifacts = artifactPath(root, 'screenshots/mermaidPreset')
  await mkdir(presetArtifacts, { recursive: true })
  await presetPage.locator('.vsidian-mermaid svg').screenshot({ path: path.join(presetArtifacts, 'codex-live.png') })
  // 原生拖选：常态仍能选中文字，CM6 正文选区与图形呈现不被接管。
  const labelBox = await presetPage.locator('.vsidian-view-live .node .label tspan').first().boundingBox()
  const docAnchor = await presetPage.evaluate(() => {
    window.getSelection().removeAllRanges()
    return window.controller.getView().state.selection.main.anchor
  })
  await presetPage.mouse.move(labelBox.x + 1, labelBox.y + labelBox.height / 2)
  await presetPage.mouse.down()
  await presetPage.mouse.move(labelBox.x + labelBox.width - 1, labelBox.y + labelBox.height / 2, { steps: 12 })
  await presetPage.mouse.up()
  await presetPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const regularSelection = await presetPage.evaluate(() => ({
    text: window.getSelection().toString(),
    anchor: window.controller.getView().state.selection.main.anchor,
    rendered: document.querySelector('.vsidian-view-live .vsidian-mermaid svg') !== null,
  }))
  assert.ok(regularSelection.text.includes('会话'), '常态图中文字应可原生拖选')
  assert.equal(regularSelection.anchor, docAnchor, '图中文字选区不得移动正文光标')
  assert.equal(regularSelection.rendered, true, '拖选不得让渲染图退回源码')
  await presetPage.keyboard.press('Control+c')
  assert.equal(await presetPage.evaluate(() => navigator.clipboard.readText()), regularSelection.text, '原生复制应取得图中文字')
  assert.equal(await presetPage.evaluate(() => window.controller.getView().state.doc.toString()), '```mermaid\n' + codexCode + '\n```\n\n结尾', '选字复制不修改围栏源码')
  await presetPage.locator('.vsidian-graphic-frame').hover()
  await presetPage.locator('.vsidian-graphic-chrome-popup').click()
  await presetPage.waitForFunction(() => document.querySelector('.vsidian-diagram-media svg') !== null)
  assert.equal(await presetPage.locator('.vsidian-diagram-media .node rect.label-container').first().evaluate(el => getComputedStyle(el).fill), presetPaint.fill)
  const popupCanvas = await presetPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor)
  const popupTransform = await presetPage.locator('.vsidian-diagram-media').evaluate(el => el.style.transform)
  const edgeLabelBox = await presetPage.locator('.vsidian-diagram-media .edgeLabel tspan').first().boundingBox()
  await presetPage.evaluate(() => window.getSelection().removeAllRanges())
  await presetPage.mouse.move(edgeLabelBox.x + 1, edgeLabelBox.y + edgeLabelBox.height / 2)
  await presetPage.mouse.down()
  await presetPage.mouse.move(edgeLabelBox.x + edgeLabelBox.width - 1, edgeLabelBox.y + edgeLabelBox.height / 2, { steps: 12 })
  await presetPage.mouse.up()
  const popupSelection = await presetPage.evaluate(() => window.getSelection().toString())
  const popupPanned = await presetPage.locator('.vsidian-diagram-media').evaluate(el => el.style.transform)
  assert.deepEqual({
    popupNoSelection: popupSelection === '',
    popupPanned: popupPanned !== popupTransform,
    popupCanvas,
  }, {
    popupNoSelection: true, popupPanned: true, popupCanvas: 'rgb(255, 255, 255)',
  }, '弹窗只平移、不选字，Codex 图形使用白色画布')
  await presetPage.keyboard.press('0')
  await presetPage.waitForFunction(() => getComputedStyle(document.querySelector('.vsidian-diagram-overlay')).opacity === '1')
  await presetPage.locator('.vsidian-diagram-overlay').screenshot({ path: path.join(presetArtifacts, 'codex-popup.png') })
  await presetPage.locator('.vsidian-diagram-export-svg').click()
  await presetPage.waitForFunction(() => window.quickSent().some(m => m.kind === 'diagram.export'))
  const codexExport = await presetPage.evaluate(() => window.quickSent().find(m => m.kind === 'diagram.export'))
  assert.ok(codexExport.content.includes('#e5f3ff'))
  assert.ok(codexExport.content.includes('background-color:#ffffff'), 'SVG 导出保留白色画布')
  assert.ok(!codexExport.content.includes('foreignObject'))
  await presetPage.locator('.vsidian-diagram-export-png').click()
  await presetPage.waitForFunction(() => window.quickSent().some(m => m.kind === 'diagram.export' && m.format === 'png'))
  const pngCorner = await presetPage.evaluate(async () => {
    const exported = window.quickSent().find(m => m.kind === 'diagram.export' && m.format === 'png')
    const img = new Image()
    img.src = 'data:image/png;base64,' + exported.content
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return [...ctx.getImageData(0, 0, 1, 1).data]
  })
  assert.deepEqual(pngCorner, [255, 255, 255, 255], 'PNG 实际像素保留不透明白色画布')
  await presetPage.keyboard.press('Escape')
  await presetPage.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }))
  await presetPage.waitForFunction(() => document.querySelector('.vsidian-view-reading .vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered')
  assert.equal(await presetPage.locator('.vsidian-view-reading .node rect.label-container').first().evaluate(el => getComputedStyle(el).fill), presetPaint.fill)
  const readingLabelBox = await presetPage.locator('.vsidian-view-reading .node .label tspan').first().boundingBox()
  await presetPage.evaluate(() => window.getSelection().removeAllRanges())
  await presetPage.mouse.move(readingLabelBox.x + 1, readingLabelBox.y + readingLabelBox.height / 2)
  await presetPage.mouse.down()
  await presetPage.mouse.move(readingLabelBox.x + readingLabelBox.width - 1, readingLabelBox.y + readingLabelBox.height / 2, { steps: 12 })
  await presetPage.mouse.up()
  const readingSelected = await presetPage.evaluate(() => window.getSelection().toString())
  assert.ok(readingSelected.includes('会话'), '阅读模式图中文字仍能拖选')
  await presetPage.keyboard.press('Control+c')
  assert.equal(await presetPage.evaluate(() => navigator.clipboard.readText()), readingSelected, '阅读模式图中文字仍能原生复制')
  await presetPage.evaluate(() => window.getSelection().removeAllRanges())
  await presetPage.locator('.vsidian-view-reading .vsidian-mermaid svg').screenshot({ path: path.join(presetArtifacts, 'codex-reading.png') })
  await presetPage.evaluate(() => window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'appearance.mermaidTheme': 'default' } }))
  await presetPage.waitForFunction(() => getComputedStyle(document.querySelector('.vsidian-view-reading .node rect.label-container')).fill !== 'rgb(229, 243, 255)')
  await presetPage.locator('.vsidian-view-reading .vsidian-mermaid svg').screenshot({ path: path.join(presetArtifacts, 'default.png') })
  // 原生 Mermaid classDef / 菱形保持自身语义；init/frontmatter 仍可覆写配置。
  const semantic = await presetPage.evaluate(async () => {
    const sequence = 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: hello'
    const normal = await window.mermaid.render('sequence-default', sequence, 'default')
    const codex = await window.mermaid.render('sequence-codex', sequence, 'codex')
    const flow = await window.mermaid.render('shape-codex', 'flowchart LR\nA[自定义]:::red --> B{判断}\nB ==> C[粗线]\nA -.-> D[虚线]\nclassDef red fill:#ff0000,color:#000000', 'codex')
    const override = await window.mermaid.render('override-codex', '---\nconfig:\n  layout: dagre\n  themeVariables:\n    fontSize: 24px\n---\nflowchart LR\nA-->B', 'codex')
    const holder = document.createElement('div')
    document.body.append(holder)
    holder.innerHTML = normal.svg
    const normalColor = getComputedStyle(holder.querySelector('.actor')).fill
    holder.innerHTML = codex.svg
    const codexColor = getComputedStyle(holder.querySelector('.actor')).fill
    holder.innerHTML = flow.svg
    const customColor = getComputedStyle(holder.querySelector('.node rect')).fill
    const decision = holder.querySelector('.node polygon') !== null
    const thickWidth = getComputedStyle(holder.querySelector('.edge-thickness-thick')).strokeWidth
    const dashed = getComputedStyle(holder.querySelector('.edge-pattern-dotted')).strokeDasharray
    holder.innerHTML = override.svg
    const overrideFont = getComputedStyle(holder.querySelector('.node .label tspan')).fontSize
    holder.remove()
    return { normalColor, codexColor, customColor, decision, thickWidth, dashed, overrideFont, override: override.svg.includes('<svg') }
  })
  assert.notEqual(semantic.normalColor, semantic.codexColor, '时序图使用独立 Codex 配色')
  assert.equal(semantic.codexColor, 'rgb(224, 237, 254)')
  assert.equal(semantic.customColor, 'rgb(255, 0, 0)', '显式 classDef 保留')
  assert.equal(semantic.decision, true, '菱形节点不改成矩形')
  assert.equal(semantic.thickWidth, '3.5px', '源码 ==> 的粗箭头语义保留')
  assert.notEqual(semantic.dashed, 'none', '源码虚线语义保留')
  assert.equal(semantic.override, true, 'frontmatter 可覆写布局')
  assert.equal(semantic.overrideFont, '24px', 'frontmatter 显式字号应覆盖预设默认值')
  await presetPage.close()

  // 默认主题的透明 SVG 在弹窗中衬编辑器画布；Codex 固定亮色画布不受宿主明暗影响。
  for (const host of [
    { name: 'light', bodyClass: 'vscode-light', background: '#ffffff', foreground: '#333333', canvas: 'rgb(255, 255, 255)' },
    { name: 'dark', bodyClass: 'vscode-dark', background: '#1f1f1f', foreground: '#cccccc', canvas: 'rgb(31, 31, 31)' },
  ]) {
    const canvasPage = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await canvasPage.goto(pageBase + '/')
    await canvasPage.evaluate(host => {
      document.body.className = host.bodyClass
      document.body.style.setProperty('--vscode-editor-background', host.background)
      document.body.style.setProperty('--vscode-editor-foreground', host.foreground)
      document.body.style.setProperty('--vscode-editorWidget-background', host.name === 'dark' ? '#2d2d30' : '#f8f8f8')
      document.body.style.setProperty('--vscode-editorWidget-foreground', host.foreground)
      window.initQuick('```mermaid\nflowchart TD\nA[开始] -->|关系标签| B[结束]\n```\n\n结尾')
      const view = window.controller.getView()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    }, host)
    for (const preset of ['default', 'codex']) {
      await canvasPage.evaluate(preset => window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'appearance.mermaidTheme': preset } }), preset)
      await canvasPage.waitForFunction(() => document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered')
      if (preset === 'default') {
        await canvasPage.locator('.cm-content').focus()
        const anchor = await canvasPage.evaluate(() => window.controller.getView().state.selection.main.anchor)
        const label = await canvasPage.locator('.node .label').first().boundingBox()
        await canvasPage.mouse.move(label.x + 1, label.y + label.height / 2)
        await canvasPage.mouse.down()
        await canvasPage.mouse.move(label.x + label.width - 1, label.y + label.height / 2, { steps: 12 })
        await canvasPage.mouse.up()
        await canvasPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.ok(await canvasPage.evaluate(() => window.getSelection().toString().includes('开始')), `${host.name} 默认 HTML 标签应可原生拖选`)
        assert.equal(await canvasPage.evaluate(() => window.controller.getView().state.selection.main.anchor), anchor, '默认标签拖选不移动正文光标')
      }
      await canvasPage.locator('.vsidian-graphic-frame').hover()
      await canvasPage.locator('.vsidian-graphic-chrome-popup').click()
      await canvasPage.waitForFunction(() => document.querySelector('.vsidian-diagram-media svg') !== null)
      assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor), preset === 'codex' ? 'rgb(255, 255, 255)' : host.canvas, `${host.name}/${preset} 弹窗画布应与图中文字配色匹配`)
      if (host.name === 'dark' && preset === 'default') {
        assert.equal(await canvasPage.locator('.vsidian-diagram-media .node .label').first().evaluate(el => getComputedStyle(el).color), 'rgb(204, 204, 204)', '默认暗色文字保持宿主浅色墨迹')
      }
      await canvasPage.waitForFunction(() => getComputedStyle(document.querySelector('.vsidian-diagram-overlay')).opacity === '1')
      await canvasPage.locator('.vsidian-diagram-overlay').screenshot({ path: path.join(presetArtifacts, `${host.name}-${preset}-popup.png`) })
      if (preset === 'default') {
        const snapshotId = await canvasPage.locator('.vsidian-diagram-media svg').getAttribute('id')
        const snapshotInk = await canvasPage.locator('.vsidian-diagram-media .node .label').first().evaluate(el => getComputedStyle(el).color)
        const nextTheme = host.name === 'light'
          ? { name: 'dark', bodyClass: 'vscode-dark', background: '#1f1f1f', foreground: '#cccccc', canvas: 'rgb(31, 31, 31)', ink: 'rgb(204, 204, 204)' }
          : { name: 'light', bodyClass: 'vscode-light', background: '#ffffff', foreground: '#333333', canvas: 'rgb(255, 255, 255)', ink: 'rgb(51, 51, 51)' }
        await canvasPage.evaluate(theme => {
          document.body.className = theme.bodyClass
          document.body.style.setProperty('--vscode-editor-background', theme.background)
          document.body.style.setProperty('--vscode-editor-foreground', theme.foreground)
          document.body.style.setProperty('--vscode-editorWidget-background', theme.name === 'dark' ? '#2d2d30' : '#f8f8f8')
          document.body.style.setProperty('--vscode-editorWidget-foreground', theme.foreground)
        }, nextTheme)
        await canvasPage.waitForFunction(ink => {
          const label = document.querySelector('.vsidian-view-live .node .label')
          return label && getComputedStyle(label).color === ink
        }, nextTheme.ink)
        assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').getAttribute('id'), snapshotId, '主题变化保留打开时的图形快照')
        assert.equal(await canvasPage.locator('.vsidian-diagram-media .node .label').first().evaluate(el => getComputedStyle(el).color), snapshotInk)
        assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor), host.canvas, '画布应跟随快照保留，不能只切底色')
        await canvasPage.locator('.vsidian-diagram-refresh').click()
        await canvasPage.waitForFunction(id => document.querySelector('.vsidian-diagram-media svg')?.id !== id, snapshotId)
        assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor), nextTheme.canvas, '刷新后画布与新主题配色一同更新')
        assert.equal(await canvasPage.locator('.vsidian-diagram-media .node .label').first().evaluate(el => getComputedStyle(el).color), nextTheme.ink)
        await canvasPage.evaluate(theme => {
          document.body.className = theme.bodyClass
          document.body.style.setProperty('--vscode-editor-background', theme.background)
          document.body.style.setProperty('--vscode-editor-foreground', theme.foreground)
          document.body.style.setProperty('--vscode-editorWidget-background', theme.name === 'dark' ? '#2d2d30' : '#f8f8f8')
          document.body.style.setProperty('--vscode-editorWidget-foreground', theme.foreground)
        }, host)
      }
      await canvasPage.keyboard.press('Escape')
    }
    await canvasPage.close()
  }

  // 2026-10-14 用户提供的六类截图：经生产管线观察真实绘制色，保存双模式截图。
  const samples = [
    { name: 'sequence', code: `sequenceDiagram
autonumber
actor U as 用户
participant E as 编辑器
participant H as 宿主
participant F as 文件系统
U->>E: 打开文档
activate E
E->>H: 请求文档内容
activate H
H->>F: 读取文件
F-->>H: 返回结果
alt 读取成功
H-->>E: 文档内容
E-->>U: 显示文档
else 读取失败
H-->>E: 错误信息
E-->>U: 显示提示
end
deactivate H
Note over E,H: 编辑内容经宿主写回
loop 自动保存
E->>H: 提交修改
H->>F: 写入文件
F-->>H: 保存完成
end
deactivate E` },
    { name: 'class', code: `classDiagram
direction LR
class Document {
  +String title
  +String content
  +save()
}
class Editor {
  +String mode
  +open(Document)
  +switchMode()
}
class Renderer {
  <<interface>>
  +render(String) String
}
class MermaidRenderer {
  +String theme
  +render(String) String
}
class Attachment {
  +String path
  +String type
}
Editor "1" *-- "1" Document : 编辑
Document "1" o-- "*" Attachment : 包含
Editor --> Renderer : 使用
Renderer <|.. MermaidRenderer : 实现` },
    { name: 'state', code: `stateDiagram-v2
[*] --> Idle
state "等待打开" as Idle
state "加载中" as Loading
state "编辑中" as Editing
state "加载失败" as Failed
Idle --> Loading: 打开文档
Loading --> Editing: 加载成功
Loading --> Failed: 加载失败
Failed --> Loading: 重试
state Editing {
  [*] --> Clean
  state "已保存" as Clean
  state "有修改" as Dirty
  state "保存中" as Saving
  Clean --> Dirty: 输入内容
  Dirty --> Saving: 保存
  Saving --> Clean: 写入成功
  Saving --> Dirty: 写入失败
}
Editing --> Idle: 关闭文档
Idle --> [*]` },
    { name: 'er', code: `erDiagram
FOLDER ||--o{ NOTE : contains
NOTE ||--o{ ATTACHMENT : owns
NOTE }o--o{ TAG : tagged_with
FOLDER {
  string id PK
  string name
  string path
}
NOTE {
  string id PK
  string folder_id FK
  string title
  datetime updated_at
}
ATTACHMENT {
  string id PK
  string note_id FK
  string path
}
TAG {
  string id PK
  string name
}` },
    { name: 'gantt', code: `gantt
title 主题适配计划
dateFormat YYYY-MM-DD
axisFormat %m-%d
section 参考采集
流程图截图 :done, flow, 2026-10-14, 2d
其他图形截图 :active, capture, after flow, 3d
section 实现
主题变量适配 :theme, after capture, 3d
布局与连线调整 :crit, layout, after theme, 2d
section 验证
明暗主题检查 :check, after layout, 2d
完成 :milestone, after check, 0d` },
    { name: 'pie', code: `pie showData
title 图形示例分布
"流程图" : 35
"时序图" : 25
"类图" : 15
"状态图" : 10
"ER 图" : 10
"其他" : 5` },
  ]
  for (const sample of samples) {
    const samplePage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    await samplePage.goto(pageBase + '/')
    await samplePage.evaluate(code => {
      window.controller.handleHostMessage({ kind: 'settings.changed', values: { 'appearance.mermaidTheme': 'codex' } })
      window.initQuick('擅长图形渲染\n\n```mermaid\n' + code + '\n```\n\n结尾')
      const view = window.controller.getView()
      view.dispatch({ selection: { anchor: 0 } })
    }, sample.code)
    for (const mode of ['live', 'reading']) {
      await samplePage.evaluate(mode => window.controller.handleHostMessage({ kind: 'view.mode.set', mode }), mode)
      const diagramSelector = '.vsidian-view-' + mode + ' .vsidian-mermaid'
      await samplePage.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-vsidian-mermaid-state') === 'rendered', diagramSelector)
      const paint = await samplePage.evaluate(selector => {
        const svg = document.querySelector(selector + ' svg')
        window.controller.handleHostMessage({ kind: 'view.state.request' })
        return {
          fills: [...svg.querySelectorAll('rect,path,polygon')].map(el => getComputedStyle(el).fill),
          strokes: [...svg.querySelectorAll('rect,path,polygon,line')].map(el => getComputedStyle(el).stroke),
          ink: [...svg.querySelectorAll('text,tspan')].map(el => getComputedStyle(el).fill),
          background: getComputedStyle(svg).backgroundColor,
          markerFills: [...svg.querySelectorAll('marker path')].map(el => getComputedStyle(el).fill),
          visible: window.quickSent().at(-1).paint?.mermaid?.visible,
        }
      }, diagramSelector)
      assert.equal(paint.visible, true, sample.name + ' / ' + mode + ' 应实际绘制')
      assert.equal(paint.background, 'rgb(255, 255, 255)', sample.name + ' 白色图形画布')
      assert.ok(paint.ink.includes('rgb(26, 28, 31)'), sample.name + ' 深灰文字')
      if (sample.name === 'state') assert.ok(paint.markerFills.length > 0 && paint.markerFills.every(fill => fill === 'rgb(142, 143, 144)'), '状态图灰色箭头')
      if (sample.name === 'pie') {
        for (const color of ['rgb(83, 154, 248)', 'rgb(107, 198, 127)', 'rgb(239, 139, 87)', 'rgb(248, 212, 93)', 'rgb(184, 151, 244)', 'rgb(246, 142, 188)']) {
          assert.ok(paint.fills.includes(color), '饼图六色：' + color)
        }
        assert.ok(paint.strokes.includes('rgb(255, 255, 255)'), '饼图分隔线')
      } else {
        assert.ok(paint.fills.includes('rgb(224, 237, 254)'), sample.name + ' 浅蓝填充')
        assert.ok(paint.strokes.includes('rgb(83, 154, 248)'), sample.name + ' 蓝色边框')
        assert.ok(paint.strokes.includes('rgb(142, 143, 144)'), sample.name + ' 灰色连线')
        if (sample.name === 'sequence' || sample.name === 'gantt') {
          assert.ok(paint.strokes.includes('rgb(107, 198, 127)'), sample.name + ' 绿色注释或关键任务边框')
        }
      }
      await samplePage.locator(diagramSelector + ' svg').screenshot({ path: path.join(presetArtifacts, sample.name + '-' + mode + '.png') })
    }
    const beforeDark = await samplePage.evaluate(() => {
      const id = document.querySelector('.vsidian-view-reading .vsidian-mermaid svg').id
      document.body.style.setProperty('--vscode-editor-background', '#1f1f1f')
      document.body.style.setProperty('--vscode-editor-foreground', '#cccccc')
      document.body.classList.add('vscode-dark')
      return id
    })
    await samplePage.waitForFunction(previousId => {
      const svg = document.querySelector('.vsidian-view-reading .vsidian-mermaid svg')
      return svg && svg.id !== previousId && getComputedStyle(svg).backgroundColor === 'rgb(255, 255, 255)'
    }, beforeDark)
    await samplePage.locator('.vsidian-view-reading .vsidian-mermaid svg').screenshot({ path: path.join(presetArtifacts, sample.name + '-dark.png') })
    const restored = await samplePage.evaluate(async ({ code, name }) => {
      const holder = document.createElement('div')
      document.body.append(holder)
      const codex = await window.mermaid.render('preset-extra', code, 'codex')
      holder.innerHTML = codex.svg
      const presetBackground = getComputedStyle(holder.querySelector('svg')).backgroundColor
      const normal = await window.mermaid.render('default-extra', code, 'default')
      holder.innerHTML = normal.svg
      const defaultBackground = getComputedStyle(holder.querySelector('svg')).backgroundColor
      const variable = { sequence: 'actorBkg', class: 'mainBkg', state: 'stateBkg', er: 'mainBkg', gantt: 'taskBkgColor', pie: 'pie1' }[name]
      const override = await window.mermaid.render('override-extra', '---\nconfig:\n  themeVariables:\n    ' + variable + ': "#ff0000"\n---\n' + code, 'codex')
      holder.innerHTML = override.svg
      const overridden = [...holder.querySelectorAll('rect,path,polygon')].some(el => getComputedStyle(el).fill === 'rgb(255, 0, 0)')
      holder.remove()
      return { presetBackground, defaultBackground, overridden }
    }, sample)
    assert.equal(restored.presetBackground, 'rgb(255, 255, 255)', sample.name + ' 暗色宿主仍使用参考图白底')
    assert.notEqual(restored.defaultBackground, restored.presetBackground, sample.name + ' 切回默认不残留 Codex 配置')
    assert.equal(restored.overridden, true, sample.name + ' 图内配色覆盖预设')
    await samplePage.close()
  }
  console.log('[图形化代码块交互] 悬停显隐、禁点击、edit 迁移、弹窗缩放/平移/键盘/Esc、点图不关、SVG/PNG 导出（CSP 复刻页）通过')
} finally {
  server.close()
  await browser.close()
}
