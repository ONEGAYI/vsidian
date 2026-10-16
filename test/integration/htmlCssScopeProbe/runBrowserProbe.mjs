// #566（T01）CSS 作用域探针（本机浏览器）：Playwright 托管 Chromium 上执行
// 同一 probeCore 矩阵，与真宿主 1.82.3（Chromium 114）双环境对照。
// - 页面形状与宿主侧同型：CSP 形状近似（宿主 CSP 为权威——本页仅保留
//   style/frame 的分支形态），预挂生产 main.css 与契约测试片段；
// - main.css/片段经 addStyleTag 注入（file:// 直链受同源策略限制，与
//   test/browser 基建同款做法），并标记 data-which 供 a2 变体读取文本；
// - 结果 JSON + 最终态截图落 out/test/html-css-scope-probe/。
// 前置：node esbuild.mjs。
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const outDir = path.join(root, 'out', 'test', 'html-css-scope-probe')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  console.log(`[browser-probe] Playwright chromium ${browser.version()}（playwright ${process.env.npm_package_version ?? '仓库锁定 1.62.1'}）`)
  // CSP 形状近似：生产指令面里与本探针相关的分支（style-src unsafe-inline、
  // frame-src https:）；宿主侧 buildEditorCsp 的完整口径才是权威证据。
  await page.setContent(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' blob:; font-src 'unsafe-inline' https: data:; img-src data: https: blob:; script-src 'unsafe-inline' blob:; frame-src https:">
<title>CSS scope probe</title></head><body></body></html>`)
  const mainHandle = await page.addStyleTag({ path: path.join(root, 'out', 'webview', 'main.css') })
  await mainHandle.evaluate((el) => el.setAttribute('data-which', 'main'))
  const probeHandle = await page.addStyleTag({ path: path.join(root, 'media', 'css-contract-probe.css') })
  await probeHandle.evaluate((el) => el.setAttribute('data-which', 'probe'))
  await page.addScriptTag({ path: path.join(root, 'out', 'test', 'integration', 'htmlCssScopeProbe', 'main.js') })

  const result = await page.evaluate(() => window.__vsidianCssScopeProbeRun({
    label: 'browser-chromium',
    readStylesheetText: async (which) => {
      const el = document.querySelector(`style[data-which="${which}"]`)
      return el ? el.textContent ?? '' : ''
    },
  }))
  for (const s of result.scenarios) {
    console.log(`[browser-probe] 场景 ${s.route}：${s.summary}`)
    for (const r of s.rows) {
      const tag = r.meets === null ? 'info' : r.meets ? 'ok' : 'BAD'
      console.log(`[browser-probe][${tag}] ${s.route}.${r.name} = ${r.value}（期望：${r.expect}）`)
    }
    for (const n of s.notes) console.log(`[browser-probe][note] ${s.route}: ${n}`)
  }
  console.log(`[browser-probe] capabilities ${JSON.stringify(result.capabilities)}`)
  const resultPath = path.join(outDir, 'browser-probe-result.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8')
  // b2 获选路线视觉取证：挂载 b2 形态后截图（A 紫/蓝、B 青、C 橄榄、工具栏不变）
  await page.evaluate(() => window.__vsidianCssScopeProbeMountB2?.())
  await page.screenshot({ path: path.join(outDir, 'browser-probe-b2.png'), fullPage: true })
  console.log(`[browser-probe] 结果 JSON：${resultPath}；b2 视觉取证：browser-probe-b2.png`)
} finally {
  await browser.close()
}
