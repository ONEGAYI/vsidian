// 父文档 Live 正文嵌入的原生浏览器回归（#223）：真实布局（Chromium）下经
// 生产控制器装配验证——光标/选区驱动源码显隐（方向键进出、鼠标点击不落
// 光标、shift+click 跨区选、多选区任一命中）、源码显形时卡片仍可见的绘制
// 断言、真实 IME（CDP composition + 提交）修改引用源码、未闭合撤卡与恢复
// 重载、内部选区隔离、长内容高度变动不跳动、模式切换状态保持、零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'liveEmbed/liveEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：独占行全文嵌入 + 混排 + 围栏内 + 未闭合 + 尾部段落 */
const EMBED_LINE = '![[目标笔记]]'
const PARENT_DOC = [
  '# Live 嵌入父文档',
  '',
  '开篇正文段。',
  '',
  EMBED_LINE,
  '',
  '中间段落。',
  '',
  '混排嵌入 ![[目标笔记]] 不成卡片。',
  '',
  '```text',
  '![[围栏内不挂载]]',
  '```',
  '',
  '围栏后段落。',
  '',
  '![[未闭合锚',
  '',
  '尾部段落。',
  '',
].join('\n')

const EMBED_FROM = PARENT_DOC.indexOf(EMBED_LINE)
const EMBED_TO = EMBED_FROM + EMBED_LINE.length

/** 目标全文：标题 + 多段（撑出限高）+ fm */
const TARGET_DOC = [
  '---',
  'title: 目标笔记',
  '---',
  '',
  '# 目标笔记标题',
  '',
  ...Array.from({ length: 30 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`),
  '',
  '- [ ] 禁写任务',
  '',
].join('\n')

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initLiveEmbedDoc(text), PARENT_DOC)
  await page.locator('.vsidian-live-embed').first().waitFor({ timeout: 5000 })

  const sent = () => page.evaluate(() => window.liveEmbedSent())
  const hoverRequests = () => page.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
  const reads = () => page.evaluate(() => window.readLiveEmbeds())
  const linePainted = (lineText) => page.evaluate((n) => window.liveLinePainted(n), lineText)
  const selection = () => page.evaluate(() => window.liveEmbedSelection())
  const respondOk = async (req, text = TARGET_DOC) => {
    await page.evaluate(({ reqId, instanceId, t }) => window.respondLiveEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
      version: 2, text: t, range: { start: 0, end: t.length }, scope: { kind: 'full' },
    }), { reqId: req.reqId, instanceId: req.instanceId, t: text })
    await page.waitForTimeout(150)
  }

  // ---- 场景 A：隐形态挂载 + 载荷契约 + 抑制边界（混排/围栏/未闭合保留源文） ----
  const reqsA = await hoverRequests()
  assert.equal(reqsA.length, 1, '仅独占行嵌入发装载请求（混排/围栏/未闭合不请求）')
  assert.match(reqsA[0].instanceId, /^embed-/, '嵌入实例前缀')
  assert.equal(reqsA[0].target, '目标笔记', 'target 为嵌入 inner 原文')
  assert.equal(reqsA[0].sourceStart, EMBED_FROM, 'sourceStart 为嵌入行区间起点')
  assert.equal(reqsA[0].sourceEnd, EMBED_TO, 'sourceEnd 为嵌入行区间终点')
  let hosts = await reads()
  assert.equal(hosts.length, 1, '恰一个 Live 嵌入宿主')
  assert.equal(hosts[0].below, false, '隐形态（无 below 修饰）')
  assert.equal(hosts[0].cardPresent, true, '卡片壳在场')
  assert.ok(hosts[0].cardHeight > 20, `卡片有真实高度（实际 ${hosts[0].cardHeight}）`)
  assert.ok(parseFloat(hosts[0].barWidth) >= 3, `左侧引用边条在场（实际 ${hosts[0].barWidth}）`)
  assert.notEqual(hosts[0].barColor, 'rgba(0, 0, 0, 0)', '边条颜色非透明')
  assert.equal(hosts[0].stateText, zhCn['embed.loading'], '装载中就地 loading 文案')
  assert.equal(await linePainted(EMBED_LINE), false, '隐形态源文不绘制（整行替换）')
  assert.equal(await linePainted('混排嵌入 ![[目标笔记]] 不成卡片。'), true, '混排行保留源文')
  assert.equal(await linePainted('![[围栏内不挂载]]'), true, '围栏内保留源文（字面文本）')
  assert.equal(await linePainted('![[未闭合锚'), true, '未闭合行保留可编辑源文')
  passed++
  console.log('[Live嵌入][PASS] 隐形态挂载 + 载荷契约 + 混排/围栏/未闭合保留源文')

  // ---- 场景 B：成功回包 → 卡片内容绘制（限高内部滚动 + 源文保持隐藏） ----
  await respondOk(reqsA[0])
  hosts = await reads()
  assert.equal(hosts[0].stateVisible, false, '成功后状态行隐藏')
  assert.ok(hosts[0].text.includes('目标笔记标题'), '卡片渲染目标内容')
  assert.equal(await linePainted(EMBED_LINE), false, '装载后源文仍隐藏（光标未触及）')
  passed++
  console.log('[Live嵌入][PASS] 成功回包：内容绘制 + 源文保持隐藏')

  // ---- 场景 C：真实方向键进出（光标驱动显隐 + 显形时卡片仍可见） ----
  await page.evaluate((p2) => window.setLiveCursor(p2), EMBED_TO + 1 + 3) // 嵌入行下两段（中间段落行）
  await page.evaluate(() => window.focusLiveEmbed())
  // 中间段落 → 逐次 ArrowUp 进入嵌入行区间
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.equal(hosts.length, 1, '显形态宿主在场（below 形态）')
  assert.equal(hosts[0].below, true, '光标进入区间 → 下方形态')
  assert.equal(await linePainted(EMBED_LINE), true, '源码显形（源文真实文本盒子）')
  assert.ok(hosts[0].cardHeight > 20, `显形态卡片继续显示（高度 ${hosts[0].cardHeight}）`)
  assert.equal(hosts[0].stateVisible, false, '内容区在场')
  // 行尾再 ArrowUp 离开区间（进入上段落）→ 恢复隐藏
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.equal(hosts[0].below, false, '光标离开 → 恢复隐藏形态')
  assert.equal(await linePainted(EMBED_LINE), false, '源文重新退场')
  passed++
  console.log('[Live嵌入][PASS] 方向键进出：显形（源文+下方卡片）与恢复隐藏')

  // ---- 场景 D：鼠标点击卡片不落光标（ignoreEvent 选区隔离） ----
  await page.evaluate(() => window.setLiveCursor(0))
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.ok(hosts[0].hitInside, '卡片头部 elementFromPoint 命中落在宿主内（真实绘制）')
  const selBefore = await selection()
  const cardRect = await page.evaluate(() => {
    const card = document.querySelector('.vsidian-live-embed .vsidian-embed-card')
    if (!card) {
      return null
    }
    const r = card.getBoundingClientRect()
    return { x: r.left + 40, y: r.top + 12 }
  })
  assert.ok(cardRect, '卡片在场（点击目标）')
  await page.mouse.click(cardRect.x, cardRect.y)
  await page.waitForTimeout(60)
  const selAfter = await selection()
  assert.deepEqual(selAfter, selBefore, '点击卡片不改父编辑器光标')
  assert.equal(await linePainted(EMBED_LINE), false, '点击卡片不显形源文（光标未触及）')
  passed++
  console.log('[Live嵌入][PASS] 鼠标点击卡片：父编辑器光标不动、源文保持隐藏')

  // ---- 场景 E：shift+click 跨区选区（非空选区严格重叠显形） ----
  // 点击上段落建立锚点 → shift+click 下段落（选区跨嵌入行）
  const upRect = await page.evaluate(() => {
    const top = window.liveEmbedTextTop('开篇正文段。')
    return { y: top + 6 }
  })
  await page.mouse.click(120, upRect.y)
  await page.waitForTimeout(40)
  const downRect = await page.evaluate(() => {
    const top = window.liveEmbedTextTop('中间段落。')
    return { y: top + 6 }
  })
  await page.keyboard.down('Shift')
  await page.mouse.click(120, downRect.y)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(60)
  const selE = await selection()
  assert.ok(selE.length === 1 && selE[0].anchor !== selE[0].head, 'shift+click 建立非空选区')
  hosts = await reads()
  assert.equal(hosts[0].below, true, '跨区选区严格重叠区间 → 显形')
  assert.equal(await linePainted(EMBED_LINE), true, '显形源文可见')
  // 清选区（Escape 后点击别处）→ 恢复隐藏
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.setLiveCursor(0))
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.equal(hosts[0].below, false, '选区离开 → 恢复隐藏')
  passed++
  console.log('[Live嵌入][PASS] shift+click 跨区选区显形；选区离开恢复')

  // ---- 场景 F：多选区任一 range 命中显形（另一组全不命中则隐藏） ----
  await page.evaluate((p) => window.setLiveRanges([[0, 1], [p + 2, p + 3]]), EMBED_FROM)
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.equal(hosts[0].below, true, '多选区任一 range 命中区间 → 显形')
  await page.evaluate(() => window.setLiveCursor(0))
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.equal(hosts[0].below, false, '单光标离开 → 隐藏')
  passed++
  console.log('[Live嵌入][PASS] 多选区任一 range 命中即显形')

  // ---- 场景 G：真实 IME 修改引用源码（CDP composition + 提交）→ 新目标重载 ----
  await page.evaluate((p) => window.setLiveCursor(p + 3), EMBED_FROM) // 光标进区间（显形）
  await page.waitForTimeout(60)
  hosts = await reads()
  assert.equal(hosts[0].below, true, '编辑前显形态')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '笔', selectionStart: 1, selectionEnd: 1 })
  await page.waitForTimeout(60)
  const composingDoc = await page.evaluate(() => window.liveEmbedDocText())
  assert.ok(composingDoc.includes('目标笔笔记') || composingDoc.includes('笔'),
    'IME 候选期文本进入文档（组合中）')
  await cdp.send('Input.insertText', { text: '笔' }) // 提交候选（插入“笔”）
  await page.waitForTimeout(60)
  const reqsG = (await hoverRequests()).slice(1) // 首笔请求之后的
  assert.ok(reqsG.length >= 1, '源码修改后新装载请求在途')
  assert.ok(reqsG.some((r) => r.target.includes('笔')), `新请求目标含 IME 文本（实际 ${reqsG.map((r) => r.target)}）`)
  await respondOk(reqsG[reqsG.length - 1])
  hosts = await reads()
  assert.ok(hosts.length === 1, '修改后的嵌入仍单卡片（显形态）')
  assert.equal(await linePainted(EMBED_LINE), false, '原文 ![[目标笔记]] 行已被修改（不再存在）')
  passed++
  console.log('[Live嵌入][PASS] 真实 IME 修改引用源码 → 新目标自动重载')

  // ---- 场景 H：未闭合撤卡与恢复（真实 Backspace 删除/重输闭合） ----
  const docNow = await page.evaluate(() => window.liveEmbedDocText())
  const embedNow = docNow.match(/!\[\[[^\n]+\]\]/)[0]
  const nowFrom = docNow.indexOf(embedNow)
  // 光标置于 ]] 前并删除两键（真实 Backspace）
  await page.evaluate((pos) => window.setLiveCursor(pos), nowFrom + embedNow.length)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.liveEmbedCount()), 0, '未闭合后卡片撤下')
  const unclosed = (await page.evaluate(() => window.liveEmbedDocText())).slice(nowFrom, nowFrom + embedNow.length - 2)
  assert.ok(unclosed.startsWith('![[') && !unclosed.includes(']]'),
    `未闭合源文保留可编辑（实际 ${unclosed}）`)
  // 重新输入闭合（真实键盘）→ 自动重新挂载装载
  await page.keyboard.type(']]')
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.liveEmbedCount()), 1, '闭合后卡片重挂')
  const reqsH = await hoverRequests()
  const lastReq = reqsH[reqsH.length - 1]
  await respondOk(lastReq)
  hosts = await reads()
  assert.ok(hosts[0].text.includes('目标笔记标题') || hosts[0].stateVisible, '恢复后装载渲染（缓存或新回包）')
  passed++
  console.log('[Live嵌入][PASS] 未闭合撤卡保留源文；重输闭合自动重挂')

  // ---- 场景 I：内部选字隔离（卡片选区不变成父文档选区） ----
  await page.evaluate(() => window.setLiveCursor(0))
  await page.waitForTimeout(60)
  const selI = await selection()
  // 基线：此前场景 G/H 的真实键盘编辑（IME/Backspace/重输）已产生预期
  // edit.request（源码编辑本就是父文档写回）；本场景起的零写回断言以
  // 「嵌入链路（装载/点击/选字）不新增写回」为准
  const editsBefore = await editRequestCount()
  assert.ok(editsBefore >= 0, '编辑基线在场')
  const picked = await page.evaluate(() => window.selectLiveEmbedText(0, '目标笔记第 3 段正文'))
  assert.equal(picked, '目标笔记第 3 段正文', '卡片内可建立浏览器文本选区（选字复制能力）')
  await page.waitForTimeout(60)
  const selI2 = await selection()
  assert.deepEqual(selI2, selI, '内部选字不改父文档 CM6 选区')
  assert.equal(await linePainted(EMBED_LINE), false, '内部选字不触发源码显形')
  assert.equal(await editRequestCount(), editsBefore, '选字/复制零新增写回')
  passed++
  console.log('[Live嵌入][PASS] 内部选字复制不触发父编辑器选区/写回')

  // ---- 场景 J：错误分态就地呈现（not-found） ----
  // 载体：真实键盘修改 inner 触发一笔新装载请求（既有请求已被成功回包消费）
  await page.evaluate(() => window.focusLiveEmbed())
  const docJ = await page.evaluate(() => window.liveEmbedDocText())
  const jFrom = docJ.indexOf('![[')
  await page.evaluate((pos) => window.setLiveCursor(pos + 3), jFrom + 3)
  await page.waitForTimeout(60)
  await page.keyboard.type('缺') // 新目标「缺…」：预期 not-found
  await page.waitForTimeout(100)
  const reqsJ = await hoverRequests()
  const errReq = reqsJ[reqsJ.length - 1]
  await page.evaluate(({ reqId, instanceId }) => window.respondLiveEmbed({
    kind: 'hover.result', reqId, instanceId, ok: false, reason: 'not-found',
  }), { reqId: errReq.reqId, instanceId: errReq.instanceId })
  await page.waitForTimeout(120)
  hosts = await reads()
  assert.equal(hosts.length, 1, '错误态卡片壳保留')
  assert.ok(hosts[0].stateText.includes(zhCn['hover.errorNotFound'].split('{target}')[0]),
    `错误分态就地呈现（实际 ${hosts[0].stateText}）`)
  assert.equal(hosts[0].stateVisible, true, '错误态状态行可见')
  passed++
  console.log('[Live嵌入][PASS] 目标缺失错误分态就地呈现')

  // ---- 场景 K：模式切换（live→reading→live）源码不丢、卡片两侧在场 ----
  const docBefore = await page.evaluate(() => window.liveEmbedDocText())
  await page.evaluate(() => window.setLiveEmbedMode('reading'))
  await page.waitForTimeout(200)
  const readingCards = await page.evaluate(() =>
    document.querySelectorAll('.vsidian-view-reading .vsidian-embed-card').length)
  assert.ok(readingCards >= 1, 'Reading 侧同一嵌入挂载卡片')
  await page.evaluate(() => window.setLiveEmbedMode('live'))
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.liveEmbedDocText()), docBefore, '切回 Live 源文不丢')
  assert.equal(await page.evaluate(() => window.liveEmbedCount()), 1, '切回 Live 卡片重挂')
  passed++
  console.log('[Live嵌入][PASS] 模式切换：卡片两侧在场、源文不丢')

  // ---- 场景 L：高度变动不跳动 + 零写回 + 无页面错误 ----
  // 光标置于文档尾（视口低位），重挂卡片装载高度变化后断言滚动稳定
  const docText = await page.evaluate(() => window.liveEmbedDocText())
  await page.evaluate((p) => window.setLiveCursor(p), docText.length)
  await page.waitForTimeout(80)
  const scrollBefore = await page.evaluate(() => window.liveEmbedScrollTop())
  await page.evaluate((p) => window.setLiveCursor(p), docText.indexOf('开篇'))
  await page.waitForTimeout(150)
  const scrollAfter = await page.evaluate(() => window.liveEmbedScrollTop())
  assert.ok(Math.abs(scrollAfter - scrollBefore) <= 200,
    `高度变动后滚动无异常跳动（前 ${scrollBefore} 后 ${scrollAfter}）`)
  assert.equal(await editRequestCount(), editsBefore, '场景 I 起零写回（嵌入链路只读——装载/选字/点击/切换均不新增 edit.request）')
  assert.deepEqual(errors, [], '无页面错误')
  passed++
  console.log('[Live嵌入][PASS] 高度变动滚动稳定 + 零写回 + 无页面错误')

  console.log(`\n[Live嵌入] 全部 ${passed} 个场景通过`)
} finally {
  await browser.close()
}
