// CSS 片段本地依赖导入浏览器实验与回归（#129）：真实 Chromium 布局 +
// 生产 WebviewSyncController → SnippetLoader 装配管线，片段与依赖经本地
// HTTP 服务提供（无显式缓存头——与 webview 资源服务同样不承诺缓存；真实
// 资源服务上的缓存行为由集成测试在真宿主内钉住）。本脚本同时是「浏览器
// CSSOM 对 @import 的实际行为」留证：
// - 循环导入有界不挂死（a↔b 各自规则生效一次，CSSOM 忽略重复环）
// - 相对资源按「各自 CSS 文件路径」解析（依赖文件的 ../ 资产锚定到该
//   文件所在目录），路径含空格与中文可用（URL 编码 + 字节真实可取）
// - 局部无效 CSS 不整份回滚（浏览器逐规则容错，入口链照常 load）
// - 规则之后的 @import 被 CSSOM 忽略（宿主侧形态学同口径）
// - media/layer 条件语义由浏览器取舍（print 不生效、screen/layer 生效）
// - 入口 ?v= 变更后 import 链取新内容（依赖文件修改 → 入口版本推进 →
//   重装链 → 嵌套导入取到新字节）；缺失导入不阻塞入口，创建后经版本
//   推进恢复
// - 撤下一入口（清单移除）不影响共享同一服务的其他入口
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'cssSnippetImports/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/cssSnippetsFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 1×1 PNG（合法字节，供资产真实拉取断言 naturalWidth） */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// ---- 本地样式服务：内存文件表；URL 路径为百分号编码形态（含空格中文） ----
const files = new Map()
const setFile = (urlPath, content, type = 'text/css; charset=utf-8') => files.set(urlPath, { content, type })
// 页面与样式同源（生产 webview 内片段链与页面同源——装载器的 sheet
// 三态判定依赖 cssRules 可读；跨源表读 cssRules 抛 SecurityError）。
// DOCTYPE/meta charset 与 CSS 响应 charset 缺一不可：无 charset 时
// Chromium 按遗留单字节编码解码样式表，嵌套 @import 的非 ASCII 路径
// 被双重编码成乱码 URL（探针留证 logs/probe-suite-repro-1522.log）
setFile('/fixture.html', '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div id="app"></div></body></html>', 'text/html; charset=utf-8')
const server = http.createServer((req, res) => {
  const file = files.get(decodeURIComponent(req.url ?? '').split('?')[0])
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('missing')
    return
  }
  // 与 webview 资源服务同口径：不发任何缓存指令（不承诺缓存也不承诺禁止）；
  // charset 必须随 Content-Type 声明（见上：嵌套导入 URL 的解码依赖）
  res.writeHead(200, { 'Content-Type': file.type })
  res.end(file.content)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const docText = ['# 依赖导入回归标题', '', '依赖导入正文段落。'].join('\n\n')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

async function headingColor(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.vsidian-heading-line-1')
    return el ? getComputedStyle(el).color : null
  })
}
/** #app 上读 CSS 变量（探针通道：--p-* 由片段规则设置） */
async function appVar(page, name) {
  return page.evaluate((prop) => {
    const value = getComputedStyle(document.getElementById('app')).getPropertyValue(prop).trim()
    return value === '' ? null : value
  }, name)
}
async function waitFor(fn, label, timeout = 8000) {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== false && value !== null) return value
    if (Date.now() - start > timeout) throw new Error(`等待超时：${label}（当前值 ${JSON.stringify(value)}）`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
/** 下发装载清单（宿主广播路径：controller 正式消息入口）。
 *  list 形如 { name, v }[]；uri 由服务器文件表拼出（?v= 与条目 v 一致） */
async function applyList(page, version, list) {
  await page.evaluate(({ version: ver, items }) => {
    window.applySnippets(ver, items.map((item) => ({
      name: item.name,
      uri: `${item.url}?v=${item.v}`,
      v: item.v,
    })))
  }, { version, items: list.map((item) => ({ ...item, url: `${base}${encodeURI(item.path)}` })) })
}

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  // 页面本身也从样式服务加载（同源）；addStyleTag/addScriptTag 装产物
  await page.goto(`${base}/fixture.html`)
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initSnip(text), docText)
  await waitFor(() => page.evaluate(() =>
    document.querySelector('.vsidian-heading-line-1') !== null), 'live 标题行渲染')

  // ---- 1. 嵌套导入生效：入口 → 子目录依赖 → 再嵌套，路径含空格与中文 ----
  setFile('/snips/主 样式.css',
    '@import "子 目录/依赖 样式.css";\n@import "子 目录/深层.css" screen;\n#app { --p-entry: entry-ok; }')
  setFile('/snips/子 目录/依赖 样式.css',
    '@import "deep2.css";\n#app { --vsidian-heading-color-1: rgb(21, 61, 101); --p-dep: dep-ok; }')
  setFile('/snips/子 目录/deep2.css', '#app { --p-deep: deep-ok; }')
  setFile('/snips/子 目录/深层.css', '#app { --p-screen: screen-ok; }')
  await applyList(page, 1, [{ name: '主 样式.css', path: '/snips/主 样式.css', v: 1 }])
  assert.equal(await waitFor(() => appVar(page, '--p-entry')), 'entry-ok', '入口规则生效')
  assert.equal(await waitFor(() => appVar(page, '--p-dep')), 'dep-ok', '一级 @import 生效（空格中文路径）')
  assert.equal(await waitFor(() => appVar(page, '--p-deep')), 'deep-ok', '嵌套 @import 生效')
  assert.equal(await waitFor(() => appVar(page, '--p-screen')), 'screen-ok', '条件 media(screen) 导入生效')
  await waitFor(async () => (await headingColor(page)) === 'rgb(21, 61, 101)' ? true : undefined,
    '被导入文件改标题颜色（可见效果）')

  // ---- 2. 相对图片按各自 CSS 文件路径解析（字节真实可取）----
  setFile('/snips/图 片.png', PNG_BYTES, 'image/png')
  setFile('/snips/子 目录/依赖 样式.css',
    '@import "deep2.css";\n' +
    '#app { --vsidian-heading-color-1: rgb(21, 61, 101); --p-dep: dep-ok; background-image: url("../图 片.png"); }')
  await applyList(page, 2, [{ name: '主 样式.css', path: '/snips/主 样式.css', v: 2 }])
  const bgUrl = await waitFor(async () => {
    const image = await page.evaluate(() =>
      getComputedStyle(document.getElementById('app')).backgroundImage)
    return image && image !== 'none' ? image : undefined
  }, '背景图规则生效')
  // 解析锚点断言：依赖文件位于 /snips/子 目录/，../图 片.png 应锚定到 /snips/
  assert.ok(decodeURIComponent(bgUrl).includes('/snips/图 片.png'),
    `资产应按依赖文件路径解析（实际 ${bgUrl}）`)
  const rawUrl = bgUrl.match(/url\("?(.*?)"?\)$/)?.[1] ?? bgUrl
  const fetched = await page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode().catch(() => undefined)
    return { ok: image.complete && image.naturalWidth > 0, width: image.naturalWidth }
  }, rawUrl)
  assert.ok(fetched.ok, `解析出的资产 URL 应真实可取（naturalWidth=${fetched.width}）`)

  // ---- 3. 循环导入有界不挂死（a↔b），两条规则各生效一次 ----
  setFile('/snips/cyc-a.css', '@import "cyc-b.css";\n#app { --p-cyc-a: a-ok; }')
  setFile('/snips/cyc-b.css', '@import "cyc-a.css";\n#app { --p-cyc-b: b-ok; }')
  const mainList = (v) => ({ name: '主 样式.css', path: '/snips/主 样式.css', v })
  await applyList(page, 3, [
    mainList(2),
    { name: 'cyc-a.css', path: '/snips/cyc-a.css', v: 1 },
  ])
  assert.equal(await waitFor(() => appVar(page, '--p-cyc-a')), 'a-ok', '循环链 a 侧规则生效（不挂死）')
  assert.equal(await waitFor(() => appVar(page, '--p-cyc-b')), 'b-ok', '循环链 b 侧规则生效（CSSOM 忽略重复环）')

  // ---- 4. 依赖文件修改 → 入口版本推进 → import 链取新内容（缓存语义）----
  setFile('/snips/hot.css', '@import "sub/hot-dep.css";\n#app { --p-hot: hot-ok; }')
  setFile('/snips/sub/hot-dep.css', '#app { --vsidian-heading-color-1: rgb(200, 30, 40); }')
  await applyList(page, 6, [
    mainList(2),
    { name: 'cyc-a.css', path: '/snips/cyc-a.css', v: 1 },
    { name: 'hot.css', path: '/snips/hot.css', v: 1 },
  ])
  await waitFor(async () => (await headingColor(page)) === 'rgb(200, 30, 40)' ? true : undefined,
    '热更新依赖先生效为红色')
  // 依赖文件内容变更（同一 URL，无缓存头）→ 仅入口 ?v= 推进 → 链上取新字节
  setFile('/snips/sub/hot-dep.css', '#app { --vsidian-heading-color-1: rgb(30, 200, 90); }')
  await applyList(page, 7, [
    mainList(2),
    { name: 'cyc-a.css', path: '/snips/cyc-a.css', v: 1 },
    { name: 'hot.css', path: '/snips/hot.css', v: 2 },
  ])
  await waitFor(async () => (await headingColor(page)) === 'rgb(30, 200, 90)' ? true : undefined,
    '依赖修改经入口 ?v= 推进后取到新内容（import 链缓存击穿）')

  // ---- 5. 局部无效 CSS 不整份回滚；规则后 @import 被 CSSOM 忽略 ----
  // 错误恢复口径（Chromium 实测钉住）：未知 at 规则吞到分号即止、块内
  // 无效声明只丢自身；无块垃圾文本会作为限定规则吞噬下一条规则的块
  // （后者的期望不成立，故不用该形态做「容错」断言——行为边界留证于本注释）
  setFile('/snips/invalid.css', [
    '#app { --p-valid: valid-ok; }',
    '@import "never-applied.css";', // 规则之后的导入：浏览器忽略（宿主形态学同口径）
    '@unknown-feature some value;', // 未知 at 规则：跳到分号，不吞后续规则
    '#app { color: notacolor; --p-valid2: valid2-ok; }', // 块内无效声明丢弃，同块其余声明生效
  ].join('\n'))
  setFile('/snips/never-applied.css', '#app { --p-never: never-ok; }')
  const fiveList = (invV) => ([
    mainList(2),
    { name: 'cyc-a.css', path: '/snips/cyc-a.css', v: 1 },
    { name: 'hot.css', path: '/snips/hot.css', v: 2 },
    { name: 'invalid.css', path: '/snips/invalid.css', v: invV },
  ])
  await applyList(page, 8, fiveList(1))
  assert.equal(await waitFor(() => appVar(page, '--p-valid')), 'valid-ok', '导入语句前后的有效规则生效')
  assert.equal(await waitFor(() => appVar(page, '--p-valid2')), 'valid2-ok',
    '未知 at 规则与块内无效声明不拖垮其余规则（逐规则容错）')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(await appVar(page, '--p-never'), null, '规则后的 @import 被浏览器忽略（不加载）')

  // ---- 6. media=print 不生效、layer() 生效；缺失导入不阻塞，创建后恢复 ----
  setFile('/snips/cond.css', [
    '@import "print-only.css" print;',
    '@import "layered.css" layer(base);',
    '@import "missing.css";',
    '#app { --p-cond: cond-ok; }',
  ].join('\n'))
  setFile('/snips/print-only.css', '#app { --p-print: print-ok; }')
  setFile('/snips/layered.css', '#app { --p-layer: layer-ok; }')
  const sixList = (condV) => ([
    ...fiveList(1),
    { name: 'cond.css', path: '/snips/cond.css', v: condV },
  ])
  await applyList(page, 9, sixList(1))
  assert.equal(await waitFor(() => appVar(page, '--p-cond')), 'cond-ok', '含缺失导入的入口其余规则生效')
  assert.equal(await waitFor(() => appVar(page, '--p-layer')), 'layer-ok', 'layer() 导入生效')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(await appVar(page, '--p-print'), null, 'media=print 在屏幕媒体下不生效（浏览器条件语义）')
  // 缺失文件创建 + 入口版本推进 → 恢复（对应宿主归因集含缺失目标的路径）
  setFile('/snips/missing.css', '#app { --p-recovered: recovered-ok; }')
  await applyList(page, 10, sixList(2))
  assert.equal(await waitFor(() => appVar(page, '--p-recovered')), 'recovered-ok',
    '缺失依赖创建后经入口版本推进生效（归因 + ?v= 击穿的恢复路径）')

  // ---- 7. 装载回报携带入口级 v；撤下一入口不影响其他入口 ----
  const loadResults = await page.evaluate(() =>
    window.snipSent().filter((m) => m.kind === 'snippets.loadResult'))
  assert.ok(loadResults.some((m) => m.name === 'hot.css' && m.version === 2 && m.ok === true),
    `装载回报应携带入口级版本 v（实际 ${JSON.stringify(loadResults.slice(-4))}）`)
  await applyList(page, 11, [
    mainList(2),
    { name: 'cyc-a.css', path: '/snips/cyc-a.css', v: 1 },
  ])
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(await appVar(page, '--p-entry'), 'entry-ok', '撤下其他入口不影响主样式入口（各自链独立）')
  assert.equal(await appVar(page, '--p-cyc-a'), 'a-ok', '循环链入口不受撤下影响')
  // 绘制层：片段仍在装时正文可见
  await applyList(page, 12, [mainList(3)])
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.state.request' }))
  const paintState = await page.evaluate(() =>
    window.snipSent().filter((m) => m.kind === 'view.state').at(-1))
  assert.equal(paintState.paint?.textVisible, true, '依赖导入片段装载后正文仍真实可见（绘制层断言）')

  await page.close()
  console.log('[CSS 依赖导入] 嵌套/条件导入、循环有界、相对资源锚定（空格中文）、缓存击穿、局部无效容错、缺失恢复、入口隔离通过')
} finally {
  await browser.close()
  server.close()
}
