// CSS 片段 HTTPS 导入与联网字体浏览器回归（#130）：真实 Chromium + 受控
// 本地 HTTPS 服务（自签证书，见 fixtures/https/README.md）+ 生产
// WebviewSyncController → SnippetLoader 装配管线，页面挂**宿主同形 CSP**
// （buildEditorCsp 的 'self' 形态）——CSP 源匹配在浏览器层真实求值：
// - style-src/font-src 的 https: 放行让 https @import、@font-face 远程字体
//   （含远程表内相对字体 URL——按该远程 CSS 的 URL 解析锚定）可装载生效
// - 明文 http: 被 CSP 拦截（请求不出网，服务端零命中；console 有 violation）
// - 跨源 https 导入生效（sheet 跨源不可读，装载器三态的 opaque 分支）
// - 失败隔离：远程 404/500/无效 CSS 不拖垮其他片段；无 ACAO 的跨源字体被
//   CORS 拒载、回退备用字体（字体失败无 link 事件可观测——只断言能确认的
//   状态，观测面是 FontFaceSet face.status 与备用字体度量）
// - 远程缓存遵循 HTTP 语义：Cache-Control 允许时入口 ?v= 推进只击穿本地
//   入口，远程表不重取；no-store 则重取（设置页说明的行为钉住点）
// - 字体晚到（慢字体端点）：document.fonts 稳定后重测——阅读侧滚动锚定
//   保持、live 侧输入不丢、正文绘制层可见
//
// 按场景独立浏览器进程（重要实测约束，2026-09 探针留证 logs/browser-cssHttps*
// 与 .scratch 消融实验）：「CM6 页面 + https 样式表装载/热换」在同一浏览器
// 进程内累积到一定量后，渲染进程会被硬杀（无 pagehide/unload、无 crash
// 事件，Playwright 以 close 呈现；系统 Edge 同形态复现；纯 <link> 循环、
// 无控制器页面、既有 blob/http 套件、新进程内最小复现均不复现；禁用本票
// fontArrival 的探针照样崩，与生产代码无因果——CSP 页面/上下文隔离均不能
// 重置该累积态，只有浏览器进程重启可以）。每场景独立进程规避；真实宿主
// （Electron 1.86.2 webview，每个面板独立 webview 进程组且生命周期短于测
// 试进程）内的热换稳定性由集成用例（#130 多轮热换）钉住。
//
// 其他测试环境取舍（与生产的差异，如实声明）：Playwright newPage
// ignoreHTTPSErrors 跳过自签证书校验——TLS 之上的行为（CSP/CORS/字体/
// 缓存）与生产同栈；真证书链路由在线字体服务烟测（cssGoogleFontsSmoke）
// 与人工验收覆盖。CSS 响应一律带 charset、页面带 DOCTYPE+meta charset
// （#129 实测：缺 charset 时 Chromium 按遗留单字节解码，嵌套导入路径被
// 双重编码）。
import assert from 'node:assert/strict'
import https from 'node:https'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'cssHttpsImports/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/cssSnippetsFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const certDir = path.join(root, 'test/browser/fixtures/https')
const [tlsCert, tlsKey] = await Promise.all([
  readFile(path.join(certDir, 'localhost-cert.pem')),
  readFile(path.join(certDir, 'localhost-key.pem')),
])

// 探针字体：KaTeX 主字体（真实 woff2 字节；衬线字形与默认无衬线度量差
// 异明显，宽度断言可分辨）
const FONT_BYTES = await readFile(path.join(root, 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2'))

const CSS_TYPE = 'text/css; charset=utf-8'
const ACAO = { 'Access-Control-Allow-Origin': '*' }

// ---- 受控服务（内存文件表 + 命中计数 + 可控 CORS/缓存/延迟/状态） ----
const hits = new Map()
const hitCount = (p) => hits.get(p) ?? 0

function setFile(files, urlPath, content, extra = {}) {
  files.set(urlPath, { contentType: CSS_TYPE, ...extra, content })
}

function makeServer(files, { tls = true } = {}) {
  const server = (tls ? https : http).createServer(
    tls ? { key: tlsKey, cert: tlsCert } : undefined,
    (req, res) => {
      const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
      hits.set(urlPath, hitCount(urlPath) + 1)
      const file = files.get(urlPath)
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('missing')
        return
      }
      const headers = { 'Content-Type': file.contentType, ...file.headers }
      if (file.status) {
        res.writeHead(file.status, headers)
        res.end('forced error')
        return
      }
      const send = () => {
        res.writeHead(200, headers)
        res.end(file.content)
      }
      if (file.delayMs) {
        setTimeout(send, file.delayMs)
      } else {
        send()
      }
    },
  )
  return server
}

const docText = [
  '# HTTPS 导入回归标题',
  '',
  ...Array.from({ length: 36 }, (_, i) => `第 ${i + 1} 段正文，用于撑起阅读滚动与虚拟化窗口。`),
].join('\n\n')

async function waitFor(fn, label, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== false && value !== null) return value
    if (Date.now() - start > timeout) throw new Error(`等待超时：${label}（当前值 ${JSON.stringify(value)}）`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
const appVar = (page, name) => page.evaluate((prop) => {
  const value = getComputedStyle(document.getElementById('app')).getPropertyValue(prop).trim()
  return value === '' ? null : value
}, name)

/** 挂探针 span 实测字形宽度：先等 @font-face 规则进入文档字体集且
 *  status=loaded 再量宽。不能只看 document.fonts.check——它对**不在字体集
 *  中的族**恒真（无可装载面），样式表尚未应用时会误判（实测踩坑留证） */
async function fontWidthProbe(page, family) {
  return page.evaluate(async (fam) => {
    const text = 'HttpsFontProbe 文本 0123'
    const make = (cssFamily) => {
      const span = document.createElement('span')
      span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:32px;font-family:${cssFamily}`
      span.textContent = text
      document.body.appendChild(span)
      return span
    }
    const fallback = make('sans-serif')
    const custom = make(`'${fam}'`)
    const deadline = Date.now() + 10000
    let faceStatus = 'absent'
    while (Date.now() < deadline) {
      let status = 'absent'
      for (const face of document.fonts) {
        if (face.family.replace(/['"]/g, '') === fam) {
          status = face.status
          break
        }
      }
      faceStatus = status
      if (status === 'loaded') {
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    const result = {
      loaded: faceStatus === 'loaded',
      faceStatus,
      fallbackWidth: fallback.getBoundingClientRect().width,
      customWidth: custom.getBoundingClientRect().width,
    }
    fallback.remove()
    custom.remove()
    return result
  }, family)
}

/** 按文本定位挂载块的容器顶部位移（锚定不变式断言用，与 cssSnippets.mjs 同口径） */
async function blockTopByText(page, text) {
  return page.evaluate((needle) => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = document.querySelector('.vsidian-view-reading')
      const rect = container.getBoundingClientRect()
      for (const block of container.querySelectorAll('.vsidian-reading-block')) {
        if ((block.textContent ?? '').slice(0, 18) === needle) {
          resolve(Math.round((block.getBoundingClientRect().top - rect.top) * 10) / 10)
          return
        }
      }
      resolve(null)
    }))
  }), text)
}
async function viewportAnchorText(page) {
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = document.querySelector('.vsidian-view-reading')
      const rect = container.getBoundingClientRect()
      for (const block of container.querySelectorAll('.vsidian-reading-block')) {
        const r = block.getBoundingClientRect()
        if (r.bottom > rect.top) {
          resolve((block.textContent ?? '').slice(0, 18))
          return
        }
      }
      resolve(null)
    }))
  }))
}

// ---- 服务一（页面与片段同源 https）：CSS/字体/失败端点 ----
const files = new Map()
const server1 = makeServer(files)
await new Promise((resolve) => server1.listen(0, '127.0.0.1', resolve))
const base = `https://127.0.0.1:${server1.address().port}`
// ---- 服务二（跨源 https，同证书不同端口）：跨源导入/字体形态 ----
const filesCross = new Map()
const server2 = makeServer(filesCross)
await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve))
const crossBase = `https://127.0.0.1:${server2.address().port}`
// ---- 服务三（明文 http）：CSP 拦截的对照面（命中计数即「是否出网」） ----
const filesPlain = new Map()
const server3 = makeServer(filesPlain, { tls: false })
await new Promise((resolve) => server3.listen(0, '127.0.0.1', resolve))
const plainBase = `http://127.0.0.1:${server3.address().port}`

// 页面静态资源（产物 bundle，宿主同形 CSP 页内以 nonce 装载）
setFile(files, '/main.js', await readFile(output), { contentType: 'text/javascript; charset=utf-8' })
setFile(files, '/main.css', await readFile(output.replace(/\.js$/, '.css')))

// 页面变体：带宿主同形 CSP（场景 1/6——CSP 源匹配须在浏览器层真实求值）
// 与无 CSP（其余场景，与既有 cssSnippets/cssSnippetImports 套件同形）。实
// 测约束见文件头：CSP 页 + CM6 + 多轮 https 热换在同一浏览器进程内累积会
// 硬杀渲染器，CSP 页面收敛到低热换次数的场景、每场景独立 context。
const bundleNonce = randomUUID()
const fixtureHtml = (csp) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
${csp ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; script-src 'self' 'nonce-${bundleNonce}'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:">` : ''}
<link href="/main.css" rel="stylesheet">
</head><body><div id="app"></div><script nonce="${bundleNonce}" src="/main.js"></script></body></html>`
setFile(files, '/fixture.html', fixtureHtml(true), { contentType: 'text/html; charset=utf-8' })
setFile(files, '/fixture-nocsp.html', fixtureHtml(false), { contentType: 'text/html; charset=utf-8' })

/** 每场景开新浏览器上下文（分页+缓存分区隔离，见文件头实测约束：崩溃
 *  累积态在浏览器进程层跨页面共享——独立 context 隔离网络缓存分区） */
async function openFixture({ csp = false } = {}) {
  const browser = await chromium.launch({ headless: true,
    channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ viewport: { width: 640, height: 480 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  await page.goto(`${base}${csp ? '/fixture.html' : '/fixture-nocsp.html'}`)
  await page.evaluate((text) => window.initSnip(text), docText)
  await waitFor(() => page.evaluate(() =>
    document.querySelector('.vsidian-heading-line-1') !== null), 'live 标题行渲染')
  /** 宿主广播路径：下发装载清单（uri 直接指向受控服务的 https 地址） */
  const apply = (version, snippets) => page.evaluate(
    ({ version: ver, snippets: snips }) => window.applySnippets(ver, snips),
    { version, snippets },
  )
  return {
    page, apply, consoleErrors,
    close: async () => {
      await browser.close()
    },
  }
}

try {
  // ---- 1. HTTPS @import 远程样式表 + 远程表内相对字体 URL ----
  // 远程表（模拟 Google Fonts 形态）：@font-face 用相对 url()，浏览器按该
  // 远程 CSS 的 URL 解析（/remote/rel-font.woff2）；字体端点带 ACAO（字体
  // 是 CORS 强制资源——跨源无 ACAO 即拒载，见场景 5）
  setFile(files, '/remote/sheet.css', [
    `@font-face { font-family: "VsRemoteRel"; src: url("./rel-font.woff2") format("woff2"); }`,
    `#app { --p-remote: remote-ok; }`,
  ].join('\n'), { headers: ACAO })
  setFile(files, '/remote/rel-font.woff2', FONT_BYTES, { contentType: 'font/woff2', headers: ACAO })
  setFile(files, '/snips/import-entry.css',
    `@import url("${base}/remote/sheet.css");\n#app { --p-entry: entry-ok; }`)
  {
    const fx = await openFixture({ csp: true }) // 宿主同形 CSP：https 放行在浏览器层求值
    const { page, apply } = fx
    await apply(1, [{ name: 'import-entry.css', uri: `${base}/snips/import-entry.css?v=1`, v: 1 }])
    assert.equal(await waitFor(() => appVar(page, '--p-entry')), 'entry-ok', '同源 https 入口自身规则生效')
    assert.equal(await waitFor(() => appVar(page, '--p-remote')), 'remote-ok', 'https @import 远程表规则生效')
    // 字节级证据：远程表内相对字体 URL 按远程表地址解析并真实拉取装载
    const relFont = await fontWidthProbe(page, 'VsRemoteRel')
    assert.equal(relFont.loaded, true, '远程表内相对 URL 字体已装载（FontFace status=loaded）')
    assert.ok(relFont.customWidth !== relFont.fallbackWidth,
      `自定义字体实际改变字形宽度（custom=${relFont.customWidth} fallback=${relFont.fallbackWidth}）`)
    assert.ok(hitCount('/remote/rel-font.woff2') >= 1, '相对字体 URL 解析锚定到远程表所在目录（服务端命中）')
    await fx.close()
  }

  // ---- 2. 直接 @font-face HTTPS 字体（入口内绝对 https url） ----
  setFile(files, '/remote/abs-font.woff2', FONT_BYTES, { contentType: 'font/woff2', headers: ACAO })
  setFile(files, '/snips/font-entry.css', [
    `@font-face { font-family: "VsRemoteAbs"; src: url("${base}/remote/abs-font.woff2") format("woff2"); }`,
    `#app { --p-absfont: abs-ok; }`,
  ].join('\n'))
  {
    const fx = await openFixture()
    const { page, apply } = fx
    await apply(1, [
      { name: 'font-entry.css', uri: `${base}/snips/font-entry.css?v=1`, v: 1 },
    ])
    assert.equal(await waitFor(() => appVar(page, '--p-absfont')), 'abs-ok', '字体片段其余规则生效')
    const absFont = await fontWidthProbe(page, 'VsRemoteAbs')
    assert.equal(absFont.loaded, true, '直接 https @font-face 字体已装载')
    assert.ok(absFont.customWidth !== absFont.fallbackWidth, '字体实际改变字形度量')
    await fx.close()
  }

  // ---- 3. 跨源 https 导入（不同端口=不同源）：规则生效，sheet 跨源不可读 ----
  setFile(filesCross, '/cross-sheet.css', `#app { --p-cross: cross-ok; }`)
  setFile(files, '/snips/cross-entry.css', `@import url("${crossBase}/cross-sheet.css");`)
  {
    const fx = await openFixture()
    const { page, apply } = fx
    await apply(1, [
      { name: 'cross-entry.css', uri: `${base}/snips/cross-entry.css?v=1`, v: 1 },
    ])
    assert.equal(await waitFor(() => appVar(page, '--p-cross')), 'cross-ok',
      '跨源 https @import 生效（样式跨源无需 CORS；cssRules 不可读由装载器 opaque 分支承接）')
    await fx.close()
  }

  // ---- 4. 失败隔离：远程 404 / 500 / 无效 CSS / 远程入口不可达 ----
  setFile(files, '/remote/error.css', 'x', { status: 500 })
  setFile(files, '/remote/invalid.css', '{{{ not a stylesheet !!!', { headers: ACAO })
  setFile(files, '/snips/broken-import.css',
    `@import url("${base}/remote/missing.css");\n#app { --p-broken-import: own-ok; }`)
  setFile(files, '/snips/error-import.css',
    `@import url("${base}/remote/error.css");\n#app { --p-error-import: own-ok; }`,
    // 入口表刻意带延迟（#193）：全量并发下入口响应可能晚于断言到达，本段
    // 断言必须经 waitFor 等落地——立即读在延迟窗口内必读到 null（偶发红根因）
    { delayMs: 400 })
  setFile(files, '/snips/invalid-import.css',
    `@import url("${base}/remote/invalid.css");\n#app { --p-invalid-import: own-ok; }`)
  {
    const fx = await openFixture()
    const { page, apply } = fx
    await apply(1, [
      { name: 'import-entry.css', uri: `${base}/snips/import-entry.css?v=1`, v: 1 },
      { name: 'broken-import.css', uri: `${base}/snips/broken-import.css?v=1`, v: 1 },
      { name: 'error-import.css', uri: `${base}/snips/error-import.css?v=1`, v: 1 },
      { name: 'invalid-import.css', uri: `${base}/snips/invalid-import.css?v=1`, v: 1 },
    ])
    assert.equal(await waitFor(() => appVar(page, '--p-broken-import')), 'own-ok', '远程 404：入口自身规则仍生效（降级）')
    assert.equal(await waitFor(() => appVar(page, '--p-error-import')), 'own-ok', '远程 500：入口自身规则仍生效')
    assert.equal(await waitFor(() => appVar(page, '--p-invalid-import')), 'own-ok', '无效 CSS 远程表：入口自身规则仍生效')
    assert.equal(await waitFor(() => appVar(page, '--p-remote')), 'remote-ok', '失败隔离：好的远程导入不受坏远程导入影响')
    // 远程入口本身不可达（跨源 404 → sheet 跨源不可读，装载器 opaque 失败分支）
    setFile(filesCross, '/ghost.css', 'x', { status: 404 })
    await apply(2, [
      { name: 'import-entry.css', uri: `${base}/snips/import-entry.css?v=1`, v: 1 },
      { name: 'remote-dead-entry.css', uri: `${crossBase}/ghost.css?v=1`, v: 1 },
    ])
    await waitFor(() => page.evaluate(() =>
      window.snipSent().some((m) => m.kind === 'snippets.loadResult' && m.name === 'remote-dead-entry.css' && m.ok === false)),
      '远程入口不可达的失败回报到达')
    assert.equal(await waitFor(() => appVar(page, '--p-remote')), 'remote-ok', '远程入口失败不影响其他片段')
    await fx.close()
  }

  // ---- 5. 跨源字体 CORS 对照：带 ACAO 装载、无 ACAO 拒载回退备用 ----
  // CORS 只作用于**跨源**请求——拒绝面由跨源服务（server2）提供；字体是
  // CORS 强制资源：无 ACAO 的跨源字体拒载（Google Fonts 等服务都带 ACAO）
  setFile(filesCross, '/cross-font-ok.woff2', FONT_BYTES, { contentType: 'font/woff2', headers: ACAO })
  setFile(filesCross, '/cross-font-denied.woff2', FONT_BYTES, { contentType: 'font/woff2' })
  setFile(files, '/snips/cors-font.css', [
    `@font-face { font-family: "VsCrossOk"; src: url("${crossBase}/cross-font-ok.woff2") format("woff2"); }`,
    `@font-face { font-family: "VsCrossDenied"; src: url("${crossBase}/cross-font-denied.woff2") format("woff2"); }`,
    `#app { --p-cors: cors-ok; }`,
  ].join('\n'))
  {
    const fx = await openFixture()
    const { page, apply } = fx
    await apply(1, [
      { name: 'cors-font.css', uri: `${base}/snips/cors-font.css?v=1`, v: 1 },
    ])
    assert.equal(await waitFor(() => appVar(page, '--p-cors')), 'cors-ok', '字体 CORS 对照片段的其余规则生效')
    const crossOk = await fontWidthProbe(page, 'VsCrossOk')
    assert.equal(crossOk.loaded, true, '带 ACAO 的跨源 https 字体装载（Google Fonts 形态）')
    assert.ok(crossOk.customWidth !== crossOk.fallbackWidth, '跨源字体实际改变字形度量')
    const denied = await page.evaluate(async () => {
      const span = document.createElement('span')
      span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:32px;font-family:'VsCrossDenied'`
      span.textContent = 'CorsDeniedProbe'
      document.body.appendChild(span)
      const deadline = Date.now() + 8000
      let status = 'absent'
      while (Date.now() < deadline) {
        for (const face of document.fonts) {
          if (face.family.replace(/['"]/g, '') === 'VsCrossDenied') {
            status = face.status
            break
          }
        }
        if (status === 'loaded' || status === 'error') {
          break
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      await document.fonts.ready
      const width = span.getBoundingClientRect().width
      // 回退参照用「不存在的家族名」而非 sans-serif：两者同样落到浏览器
      // 默认字体，跨平台等价；Linux 上 sans-serif 映射无衬线系，与默认
      // 字体（衬线系）宽度不等，会造成平台相关误报
      const absent = document.createElement('span')
      absent.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:32px;font-family:'VsFallbackAbsentProbe'`
      absent.textContent = span.textContent
      document.body.appendChild(absent)
      const fallbackWidth = absent.getBoundingClientRect().width
      absent.remove()
      span.remove()
      return { width, fallbackWidth, status, check: document.fonts.check("32px 'VsCrossDenied'") }
    })
    assert.equal(denied.status, 'error', `无 ACAO 的跨源字体被 CORS 拒载（face.status=error，实际 ${denied.status}）`)
    assert.equal(denied.check, false, 'CORS 拒绝的字体未装载（document.fonts.check 为假）')
    assert.ok(denied.width > 0, '正文文本未消失（宽度大于 0）')
    assert.equal(denied.width, denied.fallbackWidth, '正文以备用字体宽度呈现（与不存在家族名的默认回退同宽）')
    assert.equal(await appVar(page, '--p-cors'), 'cors-ok', '字体 CORS 失败不拖垮同表其余规则')
    await fx.close()
  }

  // ---- 6. 明文 http: 被 CSP 拦截（请求不出网；violation 可观测） ----
  setFile(filesPlain, '/plain-sheet.css', `#app { --p-plain: plain-ok; }`)
  setFile(files, '/snips/plain-import.css',
    `@import url("${plainBase}/plain-sheet.css");\n#app { --p-plain-entry: own-ok; }`)
  {
    const fx = await openFixture({ csp: true }) // CSP 拦截在浏览器层求值
    const { page, apply, consoleErrors } = fx
    await apply(1, [
      { name: 'plain-import.css', uri: `${base}/snips/plain-import.css?v=1`, v: 1 },
    ])
    assert.equal(await waitFor(() => appVar(page, '--p-plain-entry')), 'own-ok', '含明文导入的入口自身规则生效')
    await new Promise((r) => setTimeout(r, 600))
    assert.equal(hitCount('/plain-sheet.css'), 0, '明文 http 导入被 CSP 拦截：请求不出网（服务端零命中）')
    assert.equal(await appVar(page, '--p-plain'), null, '明文远程表的规则不生效')
    await waitFor(() => consoleErrors.some((msg) => /Content Security Policy|refused.*load/i.test(msg)),
      'CSP violation 控制台证据（拦截可观测）')
    // 入口本身为明文 http 链接：同样被拦（链不生效、零出网）
    await apply(2, [
      { name: 'plain-entry.css', uri: `${plainBase}/plain-entry.css?v=1`, v: 1 },
    ])
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(hitCount('/plain-entry.css'), 0, '明文 http 入口链同样被 CSP 拦截（零出网）')
    await fx.close()
  }

  // ---- 7. 远程缓存遵循 HTTP 语义（设置页说明的行为钉住点） ----
  // 可缓存远程表：入口 ?v= 推进只击穿本地入口；远程表 URL 未变 → 浏览器
  // 缓存命中，不重取（内容更新不可见）；no-store 远程表则重取
  setFile(files, '/cache/cached.css', `#app { --p-cache: cached-v1; }`,
    { headers: { 'Cache-Control': 'max-age=3600' } })
  setFile(files, '/cache/nostore.css', `#app { --p-nostore: nostore-v1; }`,
    { headers: { 'Cache-Control': 'no-store' } })
  setFile(files, '/snips/cache-entry.css', [
    `@import url("${base}/cache/cached.css");`,
    `@import url("${base}/cache/nostore.css");`,
  ].join('\n'))
  {
    const fx = await openFixture()
    const { page, apply } = fx
    await apply(1, [{ name: 'cache-entry.css', uri: `${base}/snips/cache-entry.css?v=1`, v: 1 }])
    assert.equal(await waitFor(() => appVar(page, '--p-cache')), 'cached-v1', '可缓存远程表首次生效')
    assert.equal(await waitFor(() => appVar(page, '--p-nostore')), 'nostore-v1', 'no-store 远程表首次生效')
    const cachedHits = hitCount('/cache/cached.css')
    const nostoreHits = hitCount('/cache/nostore.css')
    // 服务端内容更新；入口 v=1 → v=2（手动刷新/依赖变更的 ?v= 推进形态）
    setFile(files, '/cache/cached.css', `#app { --p-cache: cached-v2; }`,
      { headers: { 'Cache-Control': 'max-age=3600' } })
    setFile(files, '/cache/nostore.css', `#app { --p-nostore: nostore-v2; }`,
      { headers: { 'Cache-Control': 'no-store' } })
    await apply(2, [{ name: 'cache-entry.css', uri: `${base}/snips/cache-entry.css?v=2`, v: 2 }])
    await waitFor(async () => (await appVar(page, '--p-nostore')) === 'nostore-v2' ? true : undefined,
      'no-store 远程表重取新内容')
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(await appVar(page, '--p-cache'), 'cached-v1',
      '可缓存远程表未重取（远程缓存遵循 HTTP 语义——?v= 只击穿本地入口）')
    assert.equal(hitCount('/cache/cached.css'), cachedHits, '可缓存远程表零重取（服务端命中数不变）')
    assert.ok(hitCount('/cache/nostore.css') > nostoreHits, 'no-store 远程表重取（服务端命中数增加）')
    await fx.close()
  }

  // ---- 8. 字体晚到：输入不丢（live）+ 滚动锚定（reading）+ 绘制层可见 ----
  // 慢字体端点（1200ms）：链 load 与即时重测先于字体完成——fonts.ready 后
  // 的补测路径（fontArrival）由此驱动
  setFile(files, '/slow/slow-font.woff2', FONT_BYTES,
    { contentType: 'font/woff2', headers: ACAO, delayMs: 1200 })
  setFile(files, '/snips/slow-font-entry.css', [
    `@font-face { font-family: "VsSlowFont"; src: url("${base}/slow/slow-font.woff2") format("woff2"); }`,
    `#app .vsidian-view-live .cm-line { font-family: "VsSlowFont", sans-serif; }`,
    `#app { --p-slow: slow-ok; }`,
  ].join('\n'))
  {
    const fx = await openFixture()
    const { page, apply } = fx
    // live：字体到达前后持续输入，文本不丢
    await page.click('.cm-content')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('End')
    for (let i = 0; i < 3; i++) await page.keyboard.type('早')
    await apply(1, [
      { name: 'slow-font-entry.css', uri: `${base}/snips/slow-font-entry.css?v=1`, v: 1 },
    ])
    assert.equal(await waitFor(() => appVar(page, '--p-slow')), 'slow-ok', '慢字体片段自身规则立即生效（字体仍在途）')
    for (let i = 0; i < 3; i++) await page.keyboard.type('中')
    const slowLive = await fontWidthProbe(page, 'VsSlowFont')
    assert.equal(slowLive.loaded, true, '慢字体最终装载完成（晚到）')
    for (let i = 0; i < 3; i++) await page.keyboard.type('晚')
    const afterLate = await page.evaluate(() => ({
      text: window.controller.getView().state.doc.toString(),
    }))
    assert.ok(afterLate.text.endsWith('早早早中中中晚晚晚'),
      `字体晚到过程中输入不丢（尾部实际 ${JSON.stringify(afterLate.text.slice(-9))}）`)
    // 绘制层探针量的是前 8 行；只滚动 scroller 会被文末光标的自动入视
    // 拉回底部。经真实键盘把光标移至文首，再等待实际可见的绘制层状态。
    await page.keyboard.press('Control+Home')
    const paintLive = await waitFor(async () => {
      await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.state.request' }))
      const state = await page.evaluate(() =>
        window.snipSent().filter((m) => m.kind === 'view.state').at(-1))
      return state?.paint?.textVisible === true ? state : false
    }, '字体晚到后 live 正文绘制层可见')
    assert.equal(paintLive.paint?.textVisible, true, '字体晚到后 live 正文绘制层仍可见')

    // reading：字体晚到改变块高度——measureAndStabilize 锚定补偿
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }))
    await waitFor(() => page.evaluate(() =>
      document.querySelector('.vsidian-reading-block') !== null), '阅读块挂载')
    await page.evaluate(() => {
      document.querySelector('.vsidian-view-reading').scrollTop = 0
    })
    await waitFor(() => page.evaluate(() =>
      document.querySelector('.vsidian-reading-heading-1') !== null), '阅读标题块挂载')
    await page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      container.scrollTop = 260
    })
    const anchorText = await waitFor(() => viewportAnchorText(page), '视口顶锚点块出现')
    const anchorBefore = await blockTopByText(page, anchorText)
    assert(typeof anchorBefore === 'number', '锚点块基准位置应可测')
    // 新一批慢字体（v=2，更大字号放大晚到位移）：字体重新在途 → 晚到 →
    // 高度重测 + 锚定补偿
    setFile(files, '/slow/slow2.woff2', FONT_BYTES,
      { contentType: 'font/woff2', headers: ACAO, delayMs: 1000 })
    setFile(files, '/snips/slow-font-entry.css', [
      `@font-face { font-family: "VsSlowFont2"; src: url("${base}/slow/slow2.woff2") format("woff2"); }`,
      `#app .vsidian-view-reading .vsidian-reading-block { font-family: "VsSlowFont2", sans-serif; font-size: 19px; }`,
      `#app { --p-slow: slow2-ok; }`,
    ].join('\n'))
    await apply(2, [
      { name: 'slow-font-entry.css', uri: `${base}/snips/slow-font-entry.css?v=2`, v: 2 },
    ])
    await waitFor(async () => (await appVar(page, '--p-slow')) === 'slow2-ok' ? true : undefined, '第二批慢字体片段规则生效')
    const font2 = await fontWidthProbe(page, 'VsSlowFont2')
    assert.equal(font2.loaded, true, '第二批慢字体装载完成')
    const anchorAfter = await waitFor(async () => {
      const top = await blockTopByText(page, anchorText)
      return top !== null && Math.abs(top - anchorBefore) < 16 ? top : undefined
    }, `字体晚到后锚点块「${anchorText}」保持视口原位（基准 top=${anchorBefore}）`, 8000)
    assert.ok(typeof anchorAfter === 'number',
      `字体晚到触发重测与锚定保持：before=${anchorBefore} after=${anchorAfter}`)
    // 绘制层（阅读侧）：paint 探针只测 live 视图，阅读侧以真实布局断言——
    // 锚点块有非零高度且字体族已是晚到字体（computed style 读值）
    const readingVisible = await page.evaluate((needle) => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const container = document.querySelector('.vsidian-view-reading')
        const rect = container.getBoundingClientRect()
        for (const block of container.querySelectorAll('.vsidian-reading-block')) {
          if ((block.textContent ?? '').slice(0, 18) === needle) {
            const r = block.getBoundingClientRect()
            resolve({
              height: r.height,
              fontFamily: getComputedStyle(block).fontFamily,
              fontSize: getComputedStyle(block).fontSize,
            })
            return
          }
        }
        resolve(null)
      }))
    }), anchorText)
    assert.ok(readingVisible && readingVisible.height > 10,
      `字体晚到重测后阅读正文块可见（实测高度 ${readingVisible?.height}）`)
    assert.ok(/VsSlowFont2/.test(readingVisible?.fontFamily ?? ''),
      `晚到字体实际应用于阅读正文（font-family=${readingVisible?.fontFamily}）`)
    assert.equal(readingVisible?.fontSize, '19px', '第二批片段字号生效')
    // 虚拟化未取消（锚定补偿走 measureAndStabilize 而非退全量渲染）
    await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.state.request' }))
    const paintReading = await page.evaluate(() =>
      window.snipSent().filter((m) => m.kind === 'view.state').at(-1))
    assert.equal(paintReading.viewMode, 'reading', '阅读态回报')
    assert.equal(paintReading.readingVirtualized, true, '字体晚到不取消虚拟化')
    await fx.close()
  }

  console.log('[HTTPS 导入] 远程表/相对字体/跨源导入、失败隔离（404/500/无效/CORS 回退）、明文 CSP 拦截、HTTP 缓存语义、字体晚到锚定与输入保持通过')
} finally {
  server1.close()
  server2.close()
  server3.close()
}
