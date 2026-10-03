// P2-07（#284）混排、列表与引用块嵌入的内部 Live 原生浏览器回归：真实
// Chromium 布局下经生产控制器 + 多端口伪宿主验证——
// - 容器矩阵（段落混排/无序/有序/任务/引用）全部自动继承内部 Live、独立
//   端口、独立编辑器；容器标记（- / 1. / [ ] / >）在 A 源文保留
// - B 内真实键盘（键入/Enter/Tab/选区）只写 B：edit.request 出站、A 全文
//   零写回、B 选区不触发 A 的嵌入源码显形
// - A 光标进嵌入区间 → 该卡显形态（below）、兄弟独立；编辑器随 below 卡
//   存活（端口不重建）
// - A 在混排行前后文真实键盘打字：键迁移使卡片/端口零风暴（零 hover.request
//   重发、零 bind/unbind）且编辑器全部存活——P2-07 核心增量
// - 卡片高度增长让位相邻文本（绘制层 rect 断言）
// - 父 Reading 手动进入目标 Live（覆盖记忆）；dirty 关闭确认链路（P2-05 共享）
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'embedLiveMixed/embedLiveMixed.js')
await build({ entryPoints: [path.join(root, 'test/browser/embedLiveFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：段落混排 + 列表族（无序/有序/任务）+ 引用块——5 个容器卡位 */
const PARENT_DOC = [
  '# P2-07 容器混排父文档',
  '',
  '前文混排 ![[目标笔记]] 后文混排。',
  '',
  '- 无序项 ![[目标笔记]] 无序余文',
  '1. 有序项 ![[目标笔记]] 有序余文',
  '- [ ] 任务项 ![[目标笔记]] 任务余文',
  '',
  '> 引用文 ![[目标笔记]] 引用余文',
  '',
  '收尾段落。',
  '',
].join('\n')

/** 目标全文：标题 + 若干段（高度场景可增长）+ 列表 */
const TARGET_DOC = [
  '# 目标笔记标题',
  '',
  ...Array.from({ length: 6 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`),
  '',
  '- 目标列表一',
  '- 目标列表二',
  '',
].join('\n')

const EMBED_INNER = '目标笔记'
const EMBED_TEXT = '![[目标笔记]]'

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 1500 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  const settle = (ms = 250) => page.waitForTimeout(ms)
  const sent = () => page.evaluate(() => window.embedLiveSent())
  const mark = async () => (await sent()).length
  const sentAfter = async (markAt) => (await sent()).slice(markAt)
  const countOf = (list, kind) => list.filter((m) => m.kind === kind).length
  const allCards = () => page.evaluate(() => window.embedLiveAllCards())

  // ---- 场景 A：容器矩阵自动继承——5 卡位全部绑定独立端口与编辑器 ----
  // 视口只实例化可见行的 widget（CM6 机制）：先注入小卡限高（embed.maxHeight
  // 下界 160，取 170——5 矮卡 + 正文可同屏），高度场景 F 前再放大到 480
  await page.evaluate(() => window.respondEmbedLive({
    kind: 'settings.snapshot', values: { 'embed.maxHeight': 170 },
  }))
  await page.evaluate((text) => window.initEmbedLiveDoc(text), PARENT_DOC)
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await settle(500)
  const cardsA = await allCards()
  assert.equal(cardsA.length, 5, `五个容器卡位全部挂载（实际 ${cardsA.length}）`)
  for (const card of cardsA) {
    assert.equal(card.internalMode, 'live', '父 Live 下容器嵌入继承内部 Live')
    assert.equal(card.liveBound, true, '容器嵌入端口绑定')
  }
  const portIds = new Set(cardsA.map((c) => c.livePortId))
  assert.equal(portIds.size, 5, '五个 occurrence 各自独立端口')
  assert.equal(await page.evaluate(() => window.embedCardEditorCountAll()), 5, '五个嵌入编辑器')
  assert.equal(await page.evaluate(() => window.embedLiveEditorCountAll()), 6, '全文档 6 个 CM6 编辑器（主 + 5 嵌入）')
  // B 全文装载（每卡）
  for (let i = 0; i < 5; i++) {
    const text = await page.evaluate((idx) => window.embedEditorTextAt(idx), i)
    assert.ok(text.includes('目标笔记标题'), `卡 ${i} 装载目标全文`)
  }
  // A 源文容器标记保留（隐形态：嵌入区间被卡片替换、标记/前后文保留）
  const mainTextA = await page.evaluate(() => window.mainEditorText())
  assert.equal(mainTextA, PARENT_DOC, 'A 全文保真（容器标记与前后文不动）')
  // 绘制层：容器卡在场（卡片高度 > 0 且编辑器可见）
  const paint0 = await page.evaluate(() => window.embedCardPaintAt(0))
  assert.ok(paint0.cardHeight > 60, `容器卡有真实高度（实际 ${paint0.cardHeight}）`)
  assert.equal(paint0.editorPresent, true, '容器卡内编辑器在场')
  passed++
  console.log('[容器Live][PASS] A 容器矩阵：5 位继承 Live、独立端口与编辑器')

  // ---- 场景 B：B 内真实键盘只写 B（列表卡键入 + Enter；A 零写回） ----
  // 卡序 = 文档序：0 混排 / 1 无序 / 2 有序 / 3 任务 / 4 引用
  const insertAt = '# 目标笔记标题\n\n'.length + 2
  assert.equal(await page.evaluate((p) => window.focusEmbedEditorAt(1, p), insertAt), true,
    '焦点进无序列表卡的嵌入编辑器')
  const markB = await mark()
  await page.keyboard.type('新')
  await settle(300)
  const outB = await sentAfter(markB)
  const editB = outB.find((m) => m.kind === 'refEdit.message' && m.message.kind === 'edit.request')
  assert.ok(editB, '容器卡键入经 refEdit.message(edit.request) 出站')
  assert.equal(editB.message.changes[0].text, '新', '出站载荷为键入文本')
  assert.equal(editB.portId, cardsA[1].livePortId, '出站落本卡端口（不串其它 occurrence）')
  const modelB = await page.evaluate(() => window.embedTargetModel())
  assert.ok(modelB.text.includes('新目标笔记标题'.slice(1)) || modelB.text.includes('新'),
    'B 权威模型收到键入')
  assert.equal(modelB.dirty, true, 'B dirty')
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC,
    'A 全文零写回（B 输入不落 A——容器源位置与独占行不同，独立证明）')
  // B 内 Enter（真实键盘——段落拆行写 B）
  await page.keyboard.press('Enter')
  await settle(250)
  const textB = await page.evaluate(() => window.embedEditorTextAt(1))
  assert.ok(textB.includes('\n'), 'B 内 Enter 拆行写 B 文档')
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC,
    'B 内 Enter 不写 A')
  passed++
  console.log('[容器Live][PASS] B 容器卡真实键入只写 B：edit.request + A 零写回')

  // ---- 场景 C：B 内 Tab 缩进与选区隔离（不触发 A 显源/不互相消费） ----
  // B 内 Tab（indentEditing——B 文档缩进变化；A 不动）
  const beforeTab = await page.evaluate(() => window.embedEditorTextAt(1))
  await page.keyboard.press('Tab')
  await settle(250)
  const afterTab = await page.evaluate(() => window.embedEditorTextAt(1))
  assert.notEqual(afterTab, beforeTab, 'B 内 Tab 改写 B（缩进/结构）')
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC, 'B 内 Tab 不写 A')
  // B 内选区（shift+ArrowRight 建立选区）
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.up('Shift')
  await settle(200)
  const revealC = await page.evaluate(() => window.embedRevealStates())
  assert.equal(revealC.length, 5, '嵌入表 5 枚')
  assert.equal(revealC.every((r) => r.revealed === false), true,
    'B 选区不触发任何 A 嵌入源码显形（全部保持隐形态）')
  passed++
  console.log('[容器Live][PASS] C B 内 Tab/选区：写 B 不写 A、不触发 A 显源')

  // ---- 场景 D：A 光标进混排嵌入区间 → 该卡显形态、兄弟独立、端口存活 ----
  const embedFrom = PARENT_DOC.indexOf(EMBED_TEXT)
  assert.equal(await page.evaluate((p) => window.focusMainAt(p), embedFrom + 3), true,
    '焦点回 A 并落光标进混排嵌入区间')
  await settle(300)
  const revealD = await page.evaluate(() => window.embedRevealStates())
  assert.equal(revealD.filter((r) => r.revealed).length, 1, '恰第一枚（光标命中）显形')
  assert.equal(revealD[0].revealed, true, '命中枚为混排位（第一枚）')
  // DOM 绘制层：第一卡 below 形态，其余隐藏态
  const belowCount = await page.evaluate(
    () => document.querySelectorAll('.vsidian-live-embed-below').length)
  assert.equal(belowCount, 1, 'DOM 层恰一枚 below 显形态（兄弟独立）')
  // 显形态下源文可见（绘制层：文本节点有真实矩形）
  const embedTopD = await page.evaluate((t) => window.embedTextTopOf(t), EMBED_TEXT)
  assert.ok(embedTopD > -1, `显形态源文绘制可见（top=${embedTopD}）`)
  assert.equal(await page.evaluate(() => window.embedCardEditorCountAll()), 5,
    '显隐切换不销毁编辑器（below 卡承载同一编辑器）')
  const markD = await mark()
  assert.equal(countOf(await sentAfter(markD), 'refEdit.unbind'), 0, '显隐切换零 unbind')
  passed++
  console.log('[容器Live][PASS] D A 光标显形：below 形态、兄弟独立、编辑器/端口存活')

  // ---- 场景 E：A 前后文真实键盘打字 → 键迁移零风暴（P2-07 核心） ----
  // 光标回混排行前文末尾（「前文混排 」后），连打 3 字
  const typeAt = PARENT_DOC.indexOf('前文混排 ') + '前文混排 '.length
  assert.equal(await page.evaluate((p) => window.focusMainAt(p), typeAt), true, '光标落前文末尾')
  const markE = await mark()
  await page.keyboard.type('甲乙丙')
  await settle(400)
  const outE = await sentAfter(markE)
  assert.equal(countOf(outE, 'hover.request'), 0,
    '前后文打字零 hover.request 重发（实例键迁移）')
  assert.equal(countOf(outE, 'refEdit.bind'), 0, '前后文打字零重绑')
  assert.equal(countOf(outE, 'refEdit.unbind'), 0, '前后文打字零端口销毁')
  assert.equal(await page.evaluate(() => window.embedCardEditorCountAll()), 5,
    '打字后 5 编辑器全部存活')
  const mainE = await page.evaluate(() => window.mainEditorText())
  assert.equal(mainE, PARENT_DOC.replace('前文混排 ![[', '前文混排 甲乙丙![['),
    'A 前文含新字、嵌入原文与后文/标记保真')
  // 装载内容仍在（缓存命中渲染，不闪空）
  const textE = await page.evaluate(() => window.embedEditorTextAt(0))
  assert.ok(textE.includes('目标笔记标题'), '打字后卡内容保持（装载缓存命中）')
  passed++
  console.log('[容器Live][PASS] E A 前后文打字：键迁移零风暴、编辑器与内容保持')

  // ---- 场景 F：B 内 Enter 多行使卡片增高让位相邻文本（绘制层） ----
  // 放大限高（480）解除 170 封顶；B 经外部编辑置短文（当前内容已超 480
  // 封顶进入内部滚动，增高不可观测——短文下自然高度远低于限高）
  await page.evaluate(() => window.respondEmbedLive({
    kind: 'settings.snapshot', values: { 'embed.maxHeight': 480 },
  }))
  await settle(300)
  const bLen = (await page.evaluate(() => window.embedEditorTextAt(0))).length
  await page.evaluate(({ len, text }) => window.embedTargetExternalEdit(0, len, text), {
    len: bLen,
    text: ['# 短目标', '', '目标短段正文。', ''].join('\n'),
  })
  await settle(300)
  // 焦点进第一卡（混排位），行首连续 Enter——卡片增高，相邻列表行下移
  assert.equal(await page.evaluate((p) => window.focusEmbedEditorAt(0, p), 0), true, '焦点进混排卡行首')
  const listLineTopBefore = await page.evaluate(() => window.embedTextTopOf('无序项'))
  const cardHBefore = (await page.evaluate(() => window.embedCardPaintAt(0))).cardHeight
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Enter')
    await settle(60)
  }
  await settle(400)
  const cardHAfter = (await page.evaluate(() => window.embedCardPaintAt(0))).cardHeight
  const listLineTopAfter = await page.evaluate(() => window.embedTextTopOf('无序项'))
  assert.ok(cardHAfter > cardHBefore + 40,
    `B 增行使卡片增高（${cardHBefore} → ${cardHAfter}）`)
  assert.ok(listLineTopAfter > listLineTopBefore + 40,
    `相邻列表行随卡片下移让位（${listLineTopBefore} → ${listLineTopAfter}，不覆盖相邻文本）`)
  // 撤销回收（B 的历史）
  await page.keyboard.press('Control+z')
  await settle(250)
  passed++
  console.log('[容器Live][PASS] F 高度闭环：B 增行卡片增高、相邻文本让位')

  // ---- 场景 G：父 Reading 手动进入目标 Live（reading 父可单独进入） ----
  // 注意双容器并存：切 Reading 后 Live 视图隐藏不销毁（widget 卡仍在 DOM、
  // 零尺寸不可见）——选择器与探针断言须限定 Reading 容器域
  await page.evaluate(() => window.setEmbedLiveMode('reading'))
  await settle(400)
  // Reading 容器提升宿主在场（混排位）
  const readingHosts = await page.evaluate(
    () => document.querySelectorAll('.vsidian-view-reading .vsidian-reading-embed-mixed').length)
  assert.ok(readingHosts >= 4, `Reading 提升宿主在场（实际 ${readingHosts}）`)
  assert.equal(await page.evaluate(() => window.embedCardEditorCountAll()), 0,
    '父 Reading 跟随时无编辑器（可见且 Live 才创建）')
  // 手动切第 3 卡（有序位）进 Live——限定 Reading 容器域（隐藏 Live 容器的
  // 同款按钮零尺寸不可点）
  await page.locator('.vsidian-view-reading .vsidian-embed-card .vsidian-embed-card-mode').nth(2).click()
  await settle(500)
  assert.equal(await page.evaluate(() => window.embedCardEditorCountAll()), 1,
    '手动切 Live 创建编辑器（reading 父下单卡进入）')
  const cardsG = (await allCards()).filter((c) => c.host === 'reading')
  assert.equal(cardsG.length, 5, 'Reading 容器 5 卡')
  assert.equal(cardsG[2].internalMode, 'live', '手动覆盖生效')
  assert.equal(cardsG[2].liveBound, true, '手动进入绑定端口')
  // 父切回 Live：手动 Live 保留、其余继承（探针限定 Live 容器域）
  await page.evaluate(() => window.setEmbedLiveMode('live'))
  await settle(500)
  const cardsG2 = (await allCards()).filter((c) => c.host === 'live' && c.rootHost === 'live')
  assert.equal(cardsG2.length, 5, 'Live 容器 5 卡')
  assert.equal(cardsG2.filter((c) => c.internalMode === 'live').length, 5, '父 Live 下全部 Live（手动+继承）')
  passed++
  console.log('[容器Live][PASS] G 父 Reading 手动进入：单卡 Live + 覆盖记忆保持')

  // ---- 场景 H：dirty 关闭确认链路（容器卡走 P2-05 共享路径） ----
  // 第 3 卡（有序位）B 内键入 → dirty → 头部关闭 → 模态 → 保存并关闭
  assert.equal(await page.evaluate((p) => window.focusEmbedEditorAt(2, p), 5), true, '焦点进有序卡')
  await page.keyboard.type('存')
  await settle(300)
  assert.equal(await page.evaluate(() => window.embedDirtyDotPresent()), true, 'dirty 圆点在场')
  const closeBtnH = page.locator('.vsidian-view-live .vsidian-embed-card .vsidian-embed-card-close').nth(2)
  assert.equal(await closeBtnH.isVisible(), true, '关闭入口可见（Live 容器域）')
  await closeBtnH.click()
  await settle(300)
  const dialogH = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogH.open, true, '脏目标关闭弹三项模态')
  assert.equal(dialogH.boxPainted, true, '模态绘制层可见')
  assert.equal(dialogH.focusedAction, 'cancel', '默认焦点取消')
  await page.evaluate(() => window.embedDialogClick('save'))
  await settle(500)
  const dialogH2 = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogH2.open, false, '保存并关闭后模态退场')
  // Live 容器域探针（handle 迭代序随模式往返重排——按语义断言不按索引）：
  // 被操作的卡恰一枚回 Reading 且端口释放，其余四枚保持 Live
  const cardsH = (await allCards()).filter((c) => c.host === 'live' && c.rootHost === 'live')
  assert.equal(cardsH.length, 5, 'Live 容器 5 卡')
  const closedH = cardsH.filter((c) => c.internalMode === 'reading')
  assert.equal(closedH.length, 1, '恰一枚（被关闭的卡）回 Reading（会话记忆）')
  assert.equal(closedH[0].liveBound, false, '端口释放')
  assert.equal(cardsH.filter((c) => c.internalMode === 'live').length, 4, '其余四枚保持 Live 不受牵连')
  passed++
  console.log('[容器Live][PASS] H 脏目标关闭链路：模态 → 保存并关闭 → 回 Reading')

  assert.equal(errors.length, 0, `零页面错误（${errors.join('; ')}）`)
  console.log(`embedLiveMixed: ${passed} 场景全部通过`)
} finally {
  await browser.close()
}
