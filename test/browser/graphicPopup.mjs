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
  // #535 T08：旧预设退役——原「预设主题：真实产物与 CSP 下的
  // 双模式、缓存切换、弹窗导出」验证段与六类截图参考配色段整体删除
  //（配色断言钉的是已删除的旧预设色板）；preset 无关
  // 的「预设不改写源码」语义平移为 default 形态继续钉住。
  const presetArtifacts = artifactPath(root, 'screenshots/mermaidPreset')
  await mkdir(presetArtifacts, { recursive: true })
  // 原生 Mermaid classDef / 菱形保持自身语义；init/frontmatter 仍可覆写配置。
  const semanticPage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await semanticPage.goto(pageBase + '/')
  await semanticPage.evaluate(() => {
    window.initQuick('```mermaid\nflowchart LR\nA[开始]\n```\n\n结尾')
    const view = window.controller.getView()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  })
  await semanticPage.waitForFunction(() => document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered')
  const semantic = await semanticPage.evaluate(async () => {
    const sequence = 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: hello'
    const normal = await window.mermaid.render('sequence-default', sequence)
    const flow = await window.mermaid.render('shape-default', 'flowchart LR\nA[自定义]:::red --> B{判断}\nB ==> C[粗线]\nA -.-> D[虚线]\nclassDef red fill:#ff0000,color:#000000')
    const override = await window.mermaid.render('override-default', '---\nconfig:\n  themeVariables:\n    fontSize: 24px\n---\nflowchart LR\nA-->B')
    const holder = document.createElement('div')
    document.body.append(holder)
    holder.innerHTML = normal.svg
    const sequenceRendered = holder.querySelector('.actor') !== null
    holder.innerHTML = flow.svg
    const customColor = getComputedStyle(holder.querySelector('.node rect')).fill
    const decision = holder.querySelector('.node polygon') !== null
    const thickWidth = getComputedStyle(holder.querySelector('.edge-thickness-thick')).strokeWidth
    const dashed = getComputedStyle(holder.querySelector('.edge-pattern-dotted')).strokeDasharray
    holder.innerHTML = override.svg
    const overrideFont = getComputedStyle(holder.querySelector('.node .label')).fontSize
    holder.remove()
    return { sequenceRendered, customColor, decision, thickWidth, dashed, overrideFont, override: override.svg.includes('<svg') }
  })
  assert.equal(semantic.sequenceRendered, true, '时序图默认渲染在场')
  assert.equal(semantic.customColor, 'rgb(255, 0, 0)', '显式 classDef 保留')
  assert.equal(semantic.decision, true, '菱形节点不改成矩形')
  assert.equal(semantic.thickWidth, '3.5px', '源码 ==> 的粗箭头语义保留')
  assert.notEqual(semantic.dashed, 'none', '源码虚线语义保留')
  assert.equal(semantic.override, true, 'frontmatter 可覆写配置')
  await semanticPage.close()

  // 默认主题的透明 SVG 衬编辑器画布（明暗跟随宿主；#535 后单 default 档）。
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
    {
      await canvasPage.waitForFunction(() => document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered')
      assert.equal(await canvasPage.locator('.vsidian-graphic-frame').evaluate(el => getComputedStyle(el.parentElement).backgroundColor),
        'rgba(0, 0, 0, 0)', `${host.name} Live 图形外层不能绘出源码灰底`)
      const extraHeight = await canvasPage.locator('.vsidian-graphic-frame').evaluate(frame => {
        const css = getComputedStyle(frame)
        return frame.parentElement.getBoundingClientRect().height - frame.getBoundingClientRect().height
          - parseFloat(css.marginTop) - parseFloat(css.marginBottom)
      })
      assert.ok(Math.abs(extraHeight) < 1, `${host.name} 真实图形不应多出光标缓冲空行：${extraHeight}px`)
      await canvasPage.evaluate(() => document.activeElement.blur())
      await canvasPage.locator('.cm-content').screenshot({ path: path.join(presetArtifacts, `${host.name}-live-surround.png`) })
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
      await canvasPage.locator('.vsidian-graphic-frame').hover()
      await canvasPage.locator('.vsidian-graphic-chrome-popup').click()
      await canvasPage.waitForFunction(() => document.querySelector('.vsidian-diagram-media svg') !== null)
      assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor), host.canvas, `${host.name} 弹窗画布应与宿主明暗一致`)
      if (host.name === 'dark') {
        assert.equal(await canvasPage.locator('.vsidian-diagram-media .node .label').first().evaluate(el => getComputedStyle(el).color), 'rgb(204, 204, 204)', '默认暗色文字保持宿主浅色墨迹')
      }
      await canvasPage.waitForFunction(() => getComputedStyle(document.querySelector('.vsidian-diagram-overlay')).opacity === '1')
      await canvasPage.locator('.vsidian-diagram-overlay').screenshot({ path: path.join(presetArtifacts, `${host.name}-popup.png`) })
      {
        const labelSelector = '.node .label'
        const inkProperty = 'color'
        const snapshotCanvas = await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor)
        const snapshotId = await canvasPage.locator('.vsidian-diagram-media svg').getAttribute('id')
        const snapshotInk = await canvasPage.locator('.vsidian-diagram-media ' + labelSelector).first().evaluate((el, property) => getComputedStyle(el)[property], inkProperty)
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
        await canvasPage.waitForFunction(({ selector, property, ink }) => {
          const label = document.querySelector('.vsidian-view-live ' + selector)
          return label && getComputedStyle(label)[property] === ink
        }, { selector: labelSelector, property: inkProperty, ink: nextTheme.ink })
        assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').getAttribute('id'), snapshotId, '主题变化保留打开时的图形快照')
        assert.equal(await canvasPage.locator('.vsidian-diagram-media ' + labelSelector).first().evaluate((el, property) => getComputedStyle(el)[property], inkProperty), snapshotInk)
        assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor), snapshotCanvas, '画布应跟随快照保留，不能只切底色')
        await canvasPage.locator('.vsidian-diagram-refresh').click()
        await canvasPage.waitForFunction(id => document.querySelector('.vsidian-diagram-media svg')?.id !== id, snapshotId)
        assert.equal(await canvasPage.locator('.vsidian-diagram-media svg').evaluate(el => getComputedStyle(el).backgroundColor), nextTheme.canvas, '刷新后画布与新主题配色一同更新')
        assert.equal(await canvasPage.locator('.vsidian-diagram-media ' + labelSelector).first().evaluate((el, property) => getComputedStyle(el)[property], inkProperty), nextTheme.ink)
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

  console.log('[图形化代码块交互] 悬停显隐、禁点击、edit 迁移、弹窗缩放/平移/键盘/Esc、点图不关、SVG/PNG 导出（CSP 复刻页）通过')
} finally {
  server.close()
  await browser.close()
}
