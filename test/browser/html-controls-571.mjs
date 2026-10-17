// #571（T06）表单 details 与音视频双模式行为的原生浏览器回归（真实
// Chromium + 生产控制器 + 合成真实 WAV）：Reading 承载原生交互（表单
// 真实输入/选择/勾选、details 真实展开、媒体真实播放——readyState/
// currentTime 推进），提交不导航、零写回；Live 控件/媒体命中区普通点击 =
// 完整源码选区（不因控件例外）；释放与模式切换后无持续播放。
// 选择器纪律：双容器常驻并存（另一侧 display:none），同 id 在两侧各有一
// 份——一切 DOM 断言按活跃容器作用域查询（.vsidian-view-reading /
// .vsidian-live-html），不用 document 级 id 查询。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'html-controls-571/html-controls-571.js')
await build({ entryPoints: [path.join(root, 'test/browser/html-controls-571Fixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'dataurl', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml } = await buildZhLocaleIsland(root)

/** 文档：块级 HTML（details + 表单 + video/audio）+ 行内 audio */
const DOC = [
  '开篇段落。',
  '',
  '<div id="t6-block">',
  '  <details id="t6-details"><summary>展开更多</summary><p id="t6-hidden">折叠正文</p></details>',
  '  <form action="https://example.com/submit" method="get">',
  '    <input id="t6-text" type="text" value="初始">',
  '    <select id="t6-sel"><option value="a">甲</option><option value="b">乙</option></select>',
  '    <input id="t6-check" type="checkbox">',
  '    <button id="t6-submit" type="submit">提交</button>',
  '  </form>',
  '  <video id="t6-video" src="t6-tone.wav" controls muted autoplay></video>',
  '  <audio id="t6-audio" src="t6-tone.wav" controls></audio>',
  '</div>',
  '',
  '行内段落 <audio src="t6-tone.wav" controls>（行内音频）</audio> 收尾。',
  '',
  '尾段。',
].join('\n')

/** Reading 容器作用域内查询（断言不落隐藏的 Live 副本） */
const R = (sel) => `.vsidian-view-reading ${sel}`

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let navigated = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigated += 1
    }
  })
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  const settle = (ms = 250) => page.waitForTimeout(ms)
  const media = () => page.evaluate(() => window.grabT6Media())
  const editCount = () => page.evaluate(() =>
    window.sentT6().filter((m) => m.kind === 'edit.request' || m.kind === 'conflict.report').length)

  await page.evaluate((text) => window.initT6Doc(text, { 't6-tone.wav': window.TONE_WAV }), DOC)
  await settle(400)

  // ============ Reading 模式 ============
  await page.evaluate(() => window.setT6Mode('reading'))
  await settle(600)
  const editsBaseline = await editCount()

  // ---- A：details 真实展开（点击 summary → open 属性翻转 + 内容可见性）----
  const summaryBox = await page.locator(R('#t6-details > summary')).first().boundingBox()
  assert.ok(summaryBox, 'Reading 态 details/summary 在场')
  const openBefore = await page.evaluate((sel) => document.querySelector(sel)?.open ?? null, R('#t6-details'))
  const hiddenVisibleBefore = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? el.checkVisibility() : null
  }, R('#t6-hidden'))
  assert.equal(openBefore, false, '初始收起')
  assert.equal(hiddenVisibleBefore, false, '收起态正文不可见')
  await page.mouse.click(summaryBox.x + summaryBox.width / 2, summaryBox.y + summaryBox.height / 2)
  await settle(150)
  assert.equal(await page.evaluate((sel) => document.querySelector(sel)?.open ?? null, R('#t6-details')), true,
    '点击 summary 真实展开（open 属性翻转——原生交互不被容器点击委托吞掉）')
  assert.equal(await page.evaluate((sel) => document.querySelector(sel)?.checkVisibility() ?? null, R('#t6-hidden')), true,
    '展开后折叠正文可见（非仅 DOM 存在）')
  passed++
  console.log('[T06 控件][PASS] A Reading details 真实展开（open 翻转 + 可见性）')

  // ---- B：表单真实输入/勾选/选择（无写回）----
  const inputBox = await page.locator(R('#t6-text')).first().boundingBox()
  assert.ok(inputBox, 'Reading 态文本输入在场')
  await page.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
  await settle(100)
  const focusProbe = await page.evaluate((sel) => ({
    activeId: document.activeElement?.id ?? null,
    inReading: document.querySelector(sel) !== null,
  }), R('#t6-text'))
  assert.ok(focusProbe.inReading, 'Reading 态输入框在场（作用域查询命中）')
  assert.equal(focusProbe.activeId, 't6-text', '点击聚焦输入框（原生焦点不被吞）')
  await page.keyboard.type('编辑')
  await settle(100)
  const typed = await page.evaluate((sel) => document.querySelector(sel)?.value ?? '', R('#t6-text'))
  assert.ok(typed.includes('编辑'), `真实键入落到输入框（实际 ${typed}）`)
  await page.keyboard.press('End')

  const checkBox = await page.locator(R('#t6-check')).first().boundingBox()
  await page.mouse.click(checkBox.x + checkBox.width / 2, checkBox.y + checkBox.height / 2)
  await settle(100)
  assert.equal(await page.evaluate((sel) => document.querySelector(sel)?.checked, R('#t6-check')), true,
    'checkbox 真实点击勾选')

  // select：真实键盘选择（focus + ArrowDown——原生选项移动）
  await page.focus(R('#t6-sel'))
  await page.keyboard.press('ArrowDown')
  await settle(100)
  assert.equal(await page.evaluate((sel) => document.querySelector(sel)?.value, R('#t6-sel')), 'b',
    'select 真实键盘选择（ArrowDown 移动选项）')
  passed++
  console.log('[T06 控件][PASS] B Reading 表单真实输入/勾选/选择')

  // ---- C：媒体真实播放（muted autoplay 解码推进）----
  await settle(600)
  const videoState = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? { paused: el.paused, currentTime: el.currentTime, readyState: el.readyState, src: el.getAttribute('src') } : null
  }, R('#t6-video'))
  assert.ok(videoState, 'Reading 态 video 在场')
  assert.ok(videoState.src !== null && videoState.src.startsWith('data:audio/wav'),
    `video 装载解析地址（实际 ${JSON.stringify(videoState.src?.slice(0, 40))}）`)
  assert.ok(!videoState.paused && videoState.currentTime > 0,
    `video muted autoplay 真实播放（paused=false 且 currentTime 推进；实际 ${JSON.stringify(videoState)}）`)
  assert.ok(videoState.readyState >= 2, `video 已取得媒体数据（readyState≥2；实际 ${videoState.readyState}）`)
  passed++
  console.log('[T06 控件][PASS] C Reading 媒体真实装载与播放（data: WAV 解码推进）')

  // ---- D：提交不导航（form action 外站 → 点击后 webview 不动）----
  const submitBox = await page.locator(R('#t6-submit')).first().boundingBox()
  assert.ok(submitBox, '提交按钮在场')
  await page.mouse.click(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2)
  await settle(250)
  assert.equal(navigated, 0, `表单提交不导航 webview（framenavigated 0；实际 ${navigated}）`)
  passed++
  console.log('[T06 控件][PASS] D Reading 表单提交不导航（无表单后端）')

  // ---- E：零写回（表单/媒体交互不产生编辑事务）----
  assert.equal(await editCount(), editsBaseline,
    'Reading 控件交互零写回（edit.request/conflict.report 计数不变）')
  passed++
  console.log('[T06 控件][PASS] E Reading 临时交互零写回（不触 dirty/撤销栈）')

  // ---- F：文档替换释放（旧块卸载 → 媒体释放无持续播放）----
  const refCount = await page.evaluate(() => window.keepT6MediaRefs())
  assert.ok(refCount >= 3, `抓到媒体引用（video/audio/行内 audio；实际 ${refCount}）`)
  await page.evaluate(() => window.initT6Doc('替换后的普通文档。\n\n段落。', {}))
  await settle(400)
  const released = await page.evaluate(() => window.readT6MediaRefs())
  assert.ok(released.length > 0 && released.every((m) => m.paused && m.src === null),
    `文档替换后旧媒体释放（全部 paused 且 src 剥除；实际 ${JSON.stringify(released)}）`)
  passed++
  console.log('[T06 控件][PASS] F 文档替换释放（无持续播放 + 断流）')

  // ---- G：模式切换暂停（reading→live：隐藏容器媒体停；live→reading：widget 媒体停）----
  await page.evaluate((text) => window.initT6Doc(text, { 't6-tone.wav': window.TONE_WAV }), DOC)
  await settle(400)
  await page.evaluate(() => window.setT6Mode('reading'))
  await settle(800)
  const playingVideoBefore = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? !el.paused && el.currentTime > 0 : false
  }, R('#t6-video'))
  assert.ok(playingVideoBefore, '切模式前 Reading video 在播放（前置条件）')
  await page.evaluate(() => window.setT6Mode('live'))
  await settle(200)
  const readingVideoAfter = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? el.paused : null
  }, R('#t6-video'))
  assert.equal(readingVideoAfter, true, '切到 live 后隐藏阅读容器内的 video 已暂停（双向对称防线）')
  // live 侧 widget 的同源 video（新元素、muted autoplay）播放中 → 切回 reading 应暂停
  await settle(600)
  const livePlaying = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.vsidian-live-html video, .vsidian-live-inline-html audio'))
    return els.some((el) => !el.paused && el.currentTime > 0)
  })
  assert.ok(livePlaying, 'live 侧 widget 媒体在播放（前置条件——新元素 muted autoplay）')
  await page.evaluate(() => window.setT6Mode('reading'))
  await settle(200)
  const livePausedAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.vsidian-live-html video, .vsidian-live-inline-html audio'))
      .every((el) => el.paused))
  assert.ok(livePausedAfter, '切回 reading 后 live widget 媒体全部暂停')
  passed++
  console.log('[T06 控件][PASS] G 模式切换双向暂停（隐藏面媒体即停）')

  // ============ Live 模式：控件命中区点击 = 源码显形全选 ============
  await page.evaluate(() => window.setT6Mode('live'))
  await settle(600)
  const selBeforeLive = await editCount()

  // ---- H：点击 Live widget 内 select 控件 → 完整源码选区（不先触发控件）----
  const liveSelect = await page.locator('.vsidian-live-html #t6-sel').first().boundingBox()
  assert.ok(liveSelect, 'Live widget 内 select 在场')
  await page.mouse.click(liveSelect.x + liveSelect.width / 2, liveSelect.y + liveSelect.height / 2)
  await settle(200)
  const selText = await page.evaluate(() => document.getSelection()?.toString() ?? '')
  assert.ok(selText.includes('t6-details') && selText.includes('t6-video'),
    `点击控件命中区选中完整源码（实际 ${JSON.stringify(selText.slice(0, 90))}）`)
  assert.equal(await page.evaluate(() => document.activeElement?.id ?? ''), '',
    'select 未获得焦点（不先触发控件——源码显形优先）')
  assert.equal((await page.locator('.vsidian-live-html').count()), 0,
    'widget 已撤下（源码显形）')
  passed++
  console.log('[T06 控件][PASS] H Live 点击 select 控件 = 完整源码选区（无控件例外）')

  // ---- I：点击 Live widget 内 details summary → 同一规则（无 details 例外）----
  // 选区 [from,to] 非空：首按 ArrowRight 塌缩到 to（端点仍触及——含边界），
  // 次按离开区间 → widget 恢复
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await settle(400)
  const liveSummary = await page.locator('.vsidian-live-html #t6-details summary').first().boundingBox()
  assert.ok(liveSummary, 'widget 恢复（光标移开），summary 在场')
  await page.mouse.click(liveSummary.x + liveSummary.width / 2, liveSummary.y + liveSummary.height / 2)
  await settle(200)
  const selText2 = await page.evaluate(() => document.getSelection()?.toString() ?? '')
  assert.ok(selText2.includes('t6-details'), '点击 summary 同样选中完整源码（details 无例外）')
  assert.equal(await page.locator('.vsidian-live-html #t6-details').count(), 0,
    'widget 已撤下（details 元素随显形退场——不残留可点控件）')
  passed++
  console.log('[T06 控件][PASS] I Live 点击 details summary = 完整源码选区（无例外）')

  // ---- J：点击 Live widget 内 video 命中区 → 显形 + 媒体释放 + 零写回 + 不导航 ----
  await page.keyboard.press('ArrowRight') // 塌缩到 to
  await page.keyboard.press('ArrowRight') // 离开区间 → widget 恢复
  await settle(400)
  const videoRefCount = await page.evaluate(() => window.keepT6MediaRefs())
  assert.ok(videoRefCount >= 1, 'Live 媒体引用已抓取')
  const liveVideo = await page.locator('.vsidian-live-html #t6-video').first().boundingBox()
  assert.ok(liveVideo, 'widget 恢复，video 命中区在场')
  await page.mouse.click(liveVideo.x + liveVideo.width / 2, Math.min(liveVideo.y + liveVideo.height - 8, liveVideo.y + 30))
  await settle(200)
  const selText3 = await page.evaluate(() => document.getSelection()?.toString() ?? '')
  assert.ok(selText3.includes('t6-video'), '点击媒体命中区选中完整源码（含媒体命中区——规格红线）')
  const liveRefs = await page.evaluate(() => window.readT6MediaRefs())
  const blockWidgetVideo = liveRefs.find((m) => !m.connected)
  assert.ok(blockWidgetVideo !== undefined && blockWidgetVideo.paused && blockWidgetVideo.src === null,
    `widget 退场媒体已释放（paused + 断流；实际 ${JSON.stringify(liveRefs)}）`)
  assert.equal(navigated, 0, '全程零导航')
  assert.equal(await editCount(), selBeforeLive, 'Live 点击交互零写回')
  passed++
  console.log('[T06 控件][PASS] J Live 媒体命中区点击 = 显形 + 释放 + 零写回')

  assert.equal(errors.length, 0, `页面无未捕获异常（实际 ${JSON.stringify(errors)}）`)
  console.log(`[T06 控件] 全部 ${passed} 组断言通过`)
} finally {
  await browser.close()
}
