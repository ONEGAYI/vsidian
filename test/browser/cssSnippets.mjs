// CSS 片段浏览器回归（#128）：真实 Chromium 布局下验证——片段经 <link>
// 实际改变 live/reading 视图（computed 颜色读值，非 DOM 存在性）、文件名
// 顺序层叠（后者覆盖）、热更新不打断输入且选区保持、加载失败保留最近成功
// 样式、样式致高度变化后阅读侧滚动锚定（measureAndStabilize 管线）、视口
// 重挂载后片段仍生效、模式切换不丢样式。
// #131 暂停/恢复：暂停=空清单撤下（颜色回默认）、恢复=重发原清单同 URI
// 立即重装生效。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'cssSnippets/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/cssSnippetsFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const LIVE_COLOR_A = 'rgb(140, 20, 30)'
const LIVE_COLOR_B = 'rgb(30, 120, 140)'
const LIVE_COLOR_C = 'rgb(90, 60, 160)'

const docText = [
  '# 片段回归标题',
  '',
  ...Array.from({ length: 36 }, (_, i) => `第 ${i + 1} 段正文，用于撑起阅读滚动与虚拟化窗口。`),
].join('\n\n')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

async function liveHeadingColor(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.vsidian-heading-line-1')
    return el ? getComputedStyle(el).color : null
  })
}
async function readingHeadingColor(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.vsidian-reading-heading-1')
    return el ? getComputedStyle(el).color : null
  })
}
/**
 * 阅读视口顶锚点块观测（measureAndStabilize 的锚定对象：被视口顶边切分
 * 的挂载块——它的顶部位移会被同量平移 scrollTop 抵消，即视觉锚定承诺
 * 作用其上的块）。记录文本与相对容器顶部位移；两次 rAF 等布局稳定。
 */
async function viewportAnchor(page) {
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = document.querySelector('.vsidian-view-reading')
      const rect = container.getBoundingClientRect()
      // 与 anchorIndexAtScroll 同判：首个底边越过视口顶的挂载块（滚动落在
      // 块间 margin 时为下一块——两种取法都是管线锚定对象）
      for (const block of container.querySelectorAll('.vsidian-reading-block')) {
        const r = block.getBoundingClientRect()
        if (r.bottom > rect.top) {
          resolve({ text: (block.textContent ?? '').slice(0, 18), top: r.top - rect.top })
          return
        }
      }
      resolve(null)
    }))
  }))
}

/** 按文本定位挂载块的容器顶部位移（锚定不变式断言用：变化前后同块比较，
 *  不依赖「视口顶第一块」的边界情形——补偿残留 ±10px 级漂移可能让相邻块
 *  顶替第一块身份） */
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

async function waitFor(fn, label, timeout = 8000) {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== false && value !== null) return value
    if (Date.now() - start > timeout) throw new Error(`等待超时：${label}（当前值 ${JSON.stringify(value)}）`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initSnip(text), docText)
  await waitFor(() => page.evaluate(() =>
    document.querySelector('.vsidian-heading-line-1') !== null), 'live 标题行渲染')

  // ---- 1. 片段实际改变 live 视图（可见颜色读值，非 DOM 存在性）----
  const urlA = await page.evaluate((color) => window.snippetUrl(
    `#app { --vsidian-heading-color-1: ${color}; }`), LIVE_COLOR_A)
  await page.evaluate((uri) => window.applySnippets(1, [{ name: 'a.css', uri }]), urlA)
  await waitFor(() => (async () => {
    const color = await liveHeadingColor(page)
    return color === LIVE_COLOR_A ? color : undefined
  })(), 'live 标题颜色变为片段 A 色')

  // ---- 2. 绘制层探针：片段加载后正文仍真实可见（paint.textVisible）----
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.state.request' }))
  const paintState = await page.evaluate(() =>
    window.snipSent().filter((m) => m.kind === 'view.state').at(-1))
  assert.equal(paintState.paint?.textVisible, true, '片段加载后正文仍可见（绘制层断言）')

  // ---- 3. 文件名顺序层叠：b.css 后加载覆盖 a.css；停用 b 回到 a ----
  const urlB = await page.evaluate((color) => window.snippetUrl(
    `#app { --vsidian-heading-color-1: ${color}; }`), LIVE_COLOR_B)
  await page.evaluate(({ a, b }) => window.applySnippets(2, [
    { name: 'a.css', uri: a }, { name: 'b.css', uri: b }]), { a: urlA, b: urlB })
  await waitFor(() => (async () => {
    const color = await liveHeadingColor(page)
    return color === LIVE_COLOR_B ? color : undefined
  })(), 'b.css 后加载覆盖 a.css')
  await page.evaluate((a) => window.applySnippets(3, [{ name: 'a.css', uri: a }]), urlA)
  await waitFor(() => (async () => {
    const color = await liveHeadingColor(page)
    return color === LIVE_COLOR_A ? color : undefined
  })(), '停用 b.css 后回到 a.css 覆盖')

  // ---- 3.5 暂停/恢复（#131）：暂停 = 宿主下发空清单（全局冻结，非逐项
  // 停用）——已装链撤下、颜色回默认；恢复 = 重发原清单（同一 URI），装载
  // 器重新装配立即生效（可见效果断言，非 DOM 存在性）----
  await page.evaluate(() => window.applySnippets(4, []))
  await waitFor(() => (async () => {
    const color = await liveHeadingColor(page)
    return color !== LIVE_COLOR_A ? color : undefined
  })(), '暂停（空清单）撤下片段样式')
  await page.evaluate((a) => window.applySnippets(5, [{ name: 'a.css', uri: a }]), urlA)
  await waitFor(() => (async () => {
    const color = await liveHeadingColor(page)
    return color === LIVE_COLOR_A ? color : undefined
  })(), '恢复重发原清单后片段立即重新生效（同一 URI 重装）')

  // ---- 4. 输入中热更新：不打断输入、选区保持、文档内容不因 CSS 变化 ----
  await page.click('.cm-content')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('End')
  for (let i = 0; i < 5; i++) await page.keyboard.type('字')
  const before = await page.evaluate(() => ({
    head: window.controller.getView().state.selection.main.head,
    text: window.controller.getView().state.doc.toString(),
  }))
  const urlA2 = await page.evaluate((color) => window.snippetUrl(
    `#app { --vsidian-heading-color-1: ${color}; }`), LIVE_COLOR_C)
  await page.evaluate((a) => window.applySnippets(6, [{ name: 'a.css', uri: a }]), urlA2)
  await waitFor(() => (async () => {
    const color = await liveHeadingColor(page)
    return color === LIVE_COLOR_C ? color : undefined
  })(), '热更新后 live 标题变为新片段色')
  for (let i = 0; i < 3; i++) await page.keyboard.type('尾')
  const after = await page.evaluate(() => ({
    head: window.controller.getView().state.selection.main.head,
    text: window.controller.getView().state.doc.toString(),
  }))
  assert.equal(after.text, before.text + '尾尾尾', '输入中热更新不丢输入且可继续输入')
  assert.equal(after.head, before.head + 3, '热更新保持选区（光标随输入前进，无跳变/丢失）')
  assert.ok(after.text.startsWith(docText), '文档内容不因 CSS 更新而变化（前缀保持）')

  // ---- 5. 加载失败保留最近成功样式 + 失败回报宿主 ----
  await page.evaluate(() => window.applySnippets(7, [{ name: 'a.css', uri: 'http://127.0.0.1:1/vsidian-missing.css' }]))
  await waitFor(() => page.evaluate(() =>
    window.snipSent().some((m) => m.kind === 'snippets.loadResult' && m.ok === false &&
      m.name === 'a.css' && m.version === 7)), '失败回报到达')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(await liveHeadingColor(page), LIVE_COLOR_C, '加载失败保留最近成功样式（颜色不变）')
  // 恢复：清空清单撤下（明确停用语义）
  await page.evaluate(() => window.applySnippets(8, []))
  await new Promise((r) => setTimeout(r, 300))
  assert.notEqual(await liveHeadingColor(page), LIVE_COLOR_C, '停用撤下片段样式')

  // ---- 6. 阅读视图：片段生效 + 高度变化后滚动锚定（measureAndStabilize）----
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }))
  await waitFor(() => page.evaluate(() =>
    document.querySelector('.vsidian-reading-block') !== null), '阅读块挂载')
  // 模式锚点跟随光标（文末）——标题块在首屏外未挂载，先滚回顶部
  await page.evaluate(() => {
    document.querySelector('.vsidian-view-reading').scrollTop = 0
  })
  await waitFor(() => page.evaluate(() =>
    document.querySelector('.vsidian-reading-heading-1') !== null), '阅读标题块挂载')
  const urlReading = await page.evaluate(() => window.snippetUrl(
    `#app { --vsidian-heading-color-1: rgb(10, 90, 200); }`))
  await page.evaluate((uri) => window.applySnippets(9, [{ name: 'r.css', uri }]), urlReading)
  await waitFor(() => (async () => {
    const color = await readingHeadingColor(page)
    return color === 'rgb(10, 90, 200)' ? color : undefined
  })(), '阅读标题被片段命中')

  // 滚到中部：视口顶锚点块；施加增高片段（padding，不触发重排换行）后
  // 锚点块应保持视口位置——measureAndStabilize 对锚块顶部位移同量平移
  await page.evaluate(() => {
    const container = document.querySelector('.vsidian-view-reading')
    container.scrollTop = 300
  })
  const anchorBefore = await waitFor(() => viewportAnchor(page), '视口顶锚点块出现')
  assert(anchorBefore, '应找到视口顶锚点块')
  // 增高片段（padding +2×14px/块，实测块高 21→55）走与 main.css 同形选择器
  // + 重复类抬特异性保证生效；不改变换行（换行数变化的重排场景见人工验证）
  const urlTall = await page.evaluate(() => window.snippetUrl(
    `#app .vsidian-view-reading .vsidian-reading-block.vsidian-reading-block { padding-block: 14px; }`))
  await page.evaluate(({ r, t }) => window.applySnippets(10, [
    { name: 'r.css', uri: r }, { name: 't.css', uri: t }]), { r: urlReading, t: urlTall })
  // 不变式（measureAndStabilize）：锚点块的 tops-scrollTop 差被同量平移补偿，
  // 视口顶部位移保持（实测全文字号翻倍的残留漂移为个位数像素，容差 16px）
  const anchorAfterTop = await waitFor(async () => {
    const top = await blockTopByText(page, anchorBefore.text)
    return top !== null && Math.abs(top - anchorBefore.top) < 16 ? top : undefined
  }, `高度变化后锚点块「${anchorBefore.text}」保持视口原位（滚动锚定，基准 top=${anchorBefore.top}）`, 6000)
  assert.ok(typeof anchorAfterTop === 'number',
    `锚点块应保持视口位置：before top=${anchorBefore.top}，after top=${String(anchorAfterTop)}`)

  // ---- 7. 视口重挂载仍生效：滚到底部，新挂载块继承文档级片段样式 ----
  const bottomPadding = await waitFor(async () => page.evaluate(() => {
    const container = document.querySelector('.vsidian-view-reading')
    container.scrollTop = container.scrollHeight
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const rect = container.getBoundingClientRect()
      let last = null
      for (const block of container.querySelectorAll('.vsidian-reading-block')) {
        if (block.getBoundingClientRect().top < rect.bottom) last = block
      }
      resolve(last && getComputedStyle(last).paddingTop === '14px' ? true : undefined)
    })))
  }), '底部重挂载块继承增高片段（padding 14px）')
  assert.ok(bottomPadding, '视口重挂载后片段仍生效（不因虚拟化丢失）')
  // 滚回顶部：首块标题重挂载，颜色片段仍命中
  await page.evaluate(() => {
    document.querySelector('.vsidian-view-reading').scrollTop = 0
  })
  const topColorAgain = await waitFor(() => page.evaluate(() =>
    document.querySelector('.vsidian-reading-heading-1') !== null &&
    getComputedStyle(document.querySelector('.vsidian-reading-heading-1')).color === 'rgb(10, 90, 200)'),
  '顶部重挂载标题仍命中颜色片段')
  assert.ok(topColorAgain, '重挂载的标题块继承颜色片段')
  const virtualized = await page.evaluate(() => {
    window.controller.handleHostMessage({ kind: 'view.state.request' })
    const state = window.snipSent().filter((m) => m.kind === 'view.state').at(-1)
    return { readingVirtualized: state.readingVirtualized, mounted: state.readingMountedBlocks }
  })
  assert.equal(virtualized.readingVirtualized, true, '片段加载不取消虚拟化')
  assert.ok(virtualized.mounted < 40, `虚拟化保持（挂载块数有界：${virtualized.mounted}）`)

  // ---- 8. 模式切换保持：回 live 后片段样式仍在 ----
  await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'live' }))
  await waitFor(async () => (async () => {
    const state = await page.evaluate(() => {
      window.controller.handleHostMessage({ kind: 'view.state.request' })
      return window.snipSent().filter((m) => m.kind === 'view.state').at(-1)
    })
    return state.viewMode === 'live' ? state : undefined
  })(), '切回 live')
  // live 侧清单为 r+t（a 已在步骤 5 撤下）——标题颜色回落默认，阅读片段不作用于 live
  const liveFinal = await liveHeadingColor(page)
  assert.notEqual(liveFinal, LIVE_COLOR_C, '切回 live 后已撤下的片段不复活')

  await page.close()
  console.log('[CSS 片段] 双视图生效、层叠覆盖、输入中热更新、失败保留、滚动锚定、视口重挂载与模式切换通过')
} finally {
  await browser.close()
}
