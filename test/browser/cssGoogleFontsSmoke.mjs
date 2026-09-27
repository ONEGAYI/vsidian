// 在线字体服务烟测（#130 人工留证用，**不进默认套件**——依赖真实网络与
// 第三方服务可用性，CI 不跑）。运行：
//   node test/browser/cssGoogleFontsSmoke.mjs
// 页面挂宿主同形 CSP（buildEditorCsp 的 'self' 形态，含 #130 的
// style-src/font-src https: 放行），经真实 Google Fonts（css2 样式表 +
// gstatic woff2 字体，天然带 ACAO——字体 CORS 强制资源的标准服务形态）
// 验证：https 样式表可装载、远程表内相对/绝对字体 URL 的 @font-face 字体
// 实际装载并改变字形度量、文本可见。截图与命中留证 logs/。
// 与受控套件的分工：本烟测覆盖「真 HTTPS + 浏览器完整证书校验 + 真第三方
// 服务」链路；受控套件（cssHttpsImports）覆盖失败注入与缓存语义。
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const logsDir = path.join(root, 'logs')
await mkdir(logsDir, { recursive: true })

const FONT_FAMILY = 'Crete Round' // Google Fonts 衬线体，与默认无衬线度量差异明显
const SHEET_URL = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FONT_FAMILY)}&display=swap`

const files = new Map()
const hits = []
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
  hits.push(urlPath)
  const file = files.get(urlPath)
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('missing')
    return
  }
  res.writeHead(200, { 'Content-Type': file.contentType })
  res.end(file.content)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

// 宿主同形 CSP：style-src/font-src 的 https: 即 #130 放行面；页面本身 http
// 本地源（不影响 https 子资源装载）
const nonce = randomUUID()
files.set('/fixture.html', {
  contentType: 'text/html; charset=utf-8',
  content: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:">
<link href="/entry.css" rel="stylesheet">
</head><body>
<div id="probe" class="google-font">Online font smoke test 0123 文本</div>
<div id="fallback">Online font smoke test 0123 文本</div>
</body></html>`,
})
// 入口样式表：@import Google Fonts css2（其内部 @font-face 指向 gstatic 的
// woff2——相对 gstatic 域解析，浏览器标准管线）
files.set('/entry.css', {
  contentType: 'text/css; charset=utf-8',
  content: `@import url("${SHEET_URL}");
#probe, #fallback { display: inline-block; white-space: nowrap; }
#probe { font-family: '${FONT_FAMILY}', sans-serif; font-size: 32px; }
#fallback { font-size: 32px; font-family: sans-serif; }`,
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 240 } })
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  await page.goto(`${base}/fixture.html`)

  // 等字体装载（FontFaceSet status，而非 check——check 对未入集的族恒真）。
  // Google css2 按现代 UA 返回多分区 @font-face（unicode-range 子集）：用到
  // 的分区会 loaded，未用到的保持 unloaded——判定取「任一分区 loaded」
  const probe = await page.evaluate(async (fam) => {
    const deadline = Date.now() + 20000
    let statuses = []
    while (Date.now() < deadline) {
      statuses = []
      for (const face of document.fonts) {
        if (face.family.replace(/['"]/g, '') === fam) {
          statuses.push(face.status)
        }
      }
      if (statuses.some((s) => s === 'loaded')) {
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    await document.fonts.ready
    const probeEl = document.getElementById('probe')
    const fallbackEl = document.getElementById('fallback')
    return {
      statuses,
      probeWidth: probeEl.getBoundingClientRect().width,
      fallbackWidth: fallbackEl.getBoundingClientRect().width,
      probeFont: getComputedStyle(probeEl).fontFamily,
      probeVisible: probeEl.getBoundingClientRect().height > 0,
    }
  }, FONT_FAMILY)

  const screenshot = path.join(logsDir, 'google-fonts-smoke.png')
  await page.screenshot({ path: screenshot })
  console.log(`[烟测] FontFace statuses=${JSON.stringify(probe.statuses)}`)
  console.log(`[烟测] 字形宽度 probe=${probe.probeWidth} fallback=${probe.fallbackWidth}`)
  console.log(`[烟测] font-family=${probe.probeFont} 可见=${probe.probeVisible}`)
  console.log(`[烟测] 控制台错误 ${consoleErrors.length} 条${consoleErrors.length ? '：' + consoleErrors.join(' | ') : ''}`)
  console.log(`[烟测] 截图 ${screenshot}`)

  assert.ok(probe.statuses.some((st) => st === 'loaded'),
    `Google Fonts 应有分区装载（实际 ${JSON.stringify(probe.statuses)}）`)
  assert.notEqual(probe.probeWidth, probe.fallbackWidth, '在线字体应实际改变字形度量')
  assert.equal(probe.probeVisible, true, '文本应可见（备用字体兜底亦可见）')
  assert.ok(consoleErrors.every((msg) => !/Content Security Policy/i.test(msg)),
    `不应出现 CSP 拦截（实际 ${JSON.stringify(consoleErrors)}）`)
  console.log('[烟测] Google Fonts 在线链路通过（真 HTTPS 证书校验 + 标准 ACAO 字体服务）')
} finally {
  await browser.close()
  server.close()
}
