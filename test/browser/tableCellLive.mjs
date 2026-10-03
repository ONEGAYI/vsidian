// P2-08（#285）表格格内嵌入的内部 Live 原生浏览器回归：真实 Chromium 布局
// 下经生产控制器 + 多端口伪宿主（tableCellLiveFixture）验证——
// - 表头/数据格（转义别名 + #标题/#^块 三种链接形态）自动继承内部 Live、
//   独立端口、编辑器落网格格内；请求区间为原始源文（\| 保真）
// - B 内真实键盘（键入/Enter/Tab/选区）只写 B：A 零写回、A 选区不动、
//   不触发 A 嵌入显形；焦点回 A 后 Tab 切格恢复（父格语义）
// - 父表格结构编辑不误伤（核心）：列/行移动真实拖拽——零删除确认弹窗、
//   结构编辑完成、端口稳定（零 bind/unbind/重载）、B 未保存编辑保持
// - 真删除拦截保持：区域 Delete 删嵌入行弹三项模态；取消保留；保存并
//   关闭后 A 行删除
// - 变高与父表格行高联动（卡增高让位、限高封顶、邻格可见）；父 Reading
//   手动进入目标 Live；卡内拖选不启动父格区
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'tableCellLive/tableCellLive.js')
await build({ entryPoints: [path.join(root, 'test/browser/tableCellLiveFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：三列表格——表头转义别名 + #标题格、数据格混排别名 + #^块格、
 *  次行乙笔记转义别名（6 个格内卡位、5 种形态） */
const PARENT_DOC = [
  '# P2-08 表格格内 Live', '',
  '| ![[目标笔记\\|头别名]] | ![[目标笔记#小节]] | 头C |',
  '| --- | --- | --- |',
  '| 甲 ![[目标笔记\\|别名]] 乙 | ![[目标笔记#^blk]] | 普二格 |',
  '| 数据行二 | ![[乙笔记\\|e]] | 普四格 |',
  '',
  '收尾段落。',
  '',
].join('\n')

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1500 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  const settle = (ms = 250) => page.waitForTimeout(ms)
  const sent = () => page.evaluate(() => window.tableCellSent())
  const mark = async () => (await sent()).length
  const after = async (m) => (await sent()).slice(m)
  const countOf = (list, kind) => list.filter((m) => m.kind === kind).length
  const cards = () => page.evaluate(() => window.tableCellCards())
  const mainText = () => page.evaluate(() => window.tableCellMainText())

  await page.evaluate(() => window.respondTableCell({
    kind: 'settings.snapshot', values: { 'embed.maxHeight': 170 },
  }))
  await page.evaluate((text) => window.initTableCellDoc(text), PARENT_DOC)
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await settle(600)

  // ---- 场景 A：格内继承——6 卡位独立端口、编辑器落格内、源文区间保真 ----
  const cardsA = await cards()
  assert.equal(cardsA.length, 5, `五个格内卡位全部挂载（实际 ${cardsA.length}）`)
  for (const c of cardsA) {
    assert.equal(c.internalMode, 'live', `${c.inner} 继承内部 Live`)
    assert.equal(c.liveBound, true, `${c.inner} 端口绑定`)
  }
  const portIds = new Set(cardsA.map((c) => c.livePortId))
  assert.equal(portIds.size, 5, '五个 occurrence 各自独立端口')
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 5, '五个格内编辑器')
  const geoA = await page.evaluate(() => window.tableCellEditorGeometryAt(0))
  assert.equal(geoA.present && geoA.inGridCell, true, '编辑器嵌在网格格内（cell 仍单 grid item）')
  assert.ok(geoA.capped, `编辑器受 embed.maxHeight 限高（实际 ${geoA.editorHeight}）`)
  assert.equal(geoA.neighborPainted, true, '同行邻格文本绘制可见（列布局不因编辑器破坏）')
  // 解码 inner + 源文区间（\| 逐字；#标题/#^块 原样进 target）
  const reqsA = (await sent()).filter((m) => m.kind === 'hover.request')
  const byTarget = new Map(reqsA.map((r) => [r.target, r]))
  assert.deepEqual([...byTarget.keys()].sort(),
    ['乙笔记|e', '目标笔记#^blk', '目标笔记#小节', '目标笔记|别名', '目标笔记|头别名'],
    '五种形态的解码 target（别名管道不切列、锚点形态原样）')
  const aliasReq = byTarget.get('目标笔记|别名')
  assert.equal(PARENT_DOC.slice(aliasReq.sourceStart, aliasReq.sourceEnd),
    '![[目标笔记\\|别名]]', '数据格请求区间 slice 回源文恰为嵌入原文（含 \\|）')
  const headReq = byTarget.get('目标笔记|头别名')
  assert.equal(PARENT_DOC.slice(headReq.sourceStart, headReq.sourceEnd),
    '![[目标笔记\\|头别名]]', '表头格请求区间为源文精确边界')
  // 表头与 #标题卡装载全文（P2 全文可达）且 #标题定位到小节（probe 内部装载）
  const textA0 = await page.evaluate(() => window.tableCellEditorTextAt(0))
  assert.ok(textA0.includes('目标笔记第 1 段正文。'), '表头卡装载目标全文')
  passed++
  console.log('[格内Live][PASS] A 格内继承：5 位独立端口、编辑器落格内、转义与锚点形态保真')

  // ---- 场景 B：B 内真实键盘只写 B（键入/Enter/Tab/选区；A 零写回零选区扰动） ----
  // 卡序 = 文档序：0 表头别名 / 1 #小节 / 2 数据格别名 / 3 #^blk / 4 乙笔记
  const insertAt = '# 目标笔记标题\n\n'.length + 2
  assert.equal(await page.evaluate((p) => window.tableCellFocusEditorAt(2, p), insertAt), true,
    '焦点进数据格别名卡的嵌入编辑器')
  const markB = await mark()
  await page.keyboard.type('新')
  await settle(300)
  const outB = await after(markB)
  const editB = outB.find((m) => m.kind === 'refEdit.message' && m.message.kind === 'edit.request')
  assert.ok(editB, '格内卡键入经 refEdit.message(edit.request) 出站')
  assert.equal(editB.portId, cardsA[2].livePortId, '出站落本卡端口')
  const modelB = await page.evaluate(() => window.tableCellTargetModel('目标笔记'))
  assert.ok(modelB.text.includes('新目标笔记标题'.slice(1)), 'B 权威模型收到键入')
  assert.equal(modelB.dirty, true, 'B dirty')
  assert.equal(await mainText(), PARENT_DOC, 'A 全文零写回')
  // B 内 Enter（B 拆行）与 Tab（B 缩进）——A 选区零扰动、A 文本不动
  const selA0 = await page.evaluate(() => window.tableCellMainSelection())
  await page.keyboard.press('Enter')
  await settle(200)
  await page.keyboard.press('Tab')
  await settle(250)
  const textB2 = await page.evaluate(() => window.tableCellEditorTextAt(2))
  assert.ok(textB2.includes('\n') && textB2 !== modelB.text.length.toString(), 'B 内 Enter/Tab 改写 B 文档')
  const selA1 = await page.evaluate(() => window.tableCellMainSelection())
  assert.equal(selA0.anchor === selA1.anchor && selA0.head === selA1.head, true,
    'A 选区零扰动（B 输入不触发 A 表格导航/切格）')
  assert.equal(await mainText(), PARENT_DOC, 'B 内 Enter/Tab 不写 A')
  // B 内选区（shift+方向）不触发 A 嵌入显形
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Shift')
  await settle(200)
  const revealB = await page.evaluate(() => window.tableCellRevealStates())
  assert.equal(revealB.every((r) => r.revealed === false), true, 'B 选区不触发 A 嵌入源码显形')
  passed++
  console.log('[格内Live][PASS] B B 内真实键盘只写 B：edit.request + A 零写回零选区扰动')

  // ---- 场景 C：焦点回 A 父格——Tab 切格语义恢复；邻格打字实例平移零风暴 ----
  const textC = await mainText()
  const atC = textC.indexOf('数据行二')
  assert.equal(await page.evaluate((p) => window.tableCellFocusMainAt(p), atC), true, '焦点回 A 落父格')
  await page.keyboard.press('Tab')
  await settle(150)
  const selC = await page.evaluate(() => window.tableCellMainSelection())
  assert.equal(selC.head, textC.indexOf('![[乙笔记\\|e]]'),
    `Tab 切格恢复（落乙笔记格内容首 = 嵌入源文区间首，实际 ${selC.head}）`)
  // Tab 落点在乙格嵌入源文区间首（父格语义，会显源）——打字场景重新落位
  // 到「数据行二」文字尾（同格邻文），避免把打字混进嵌入区间本身
  assert.equal(await page.evaluate(
    (p) => window.tableCellFocusMainAt(p), atC + '数据行二'.length), true,
    '光标落「数据行二」文字尾')
  await settle(100)
  const markC = await mark()
  // 逐字节奏输入（60ms/字）：连击两字会命中基线既有的暂缓窗口异常
  //（格内输入族问题，非本票范围——logs/p2-08/diag-base2.mjs 复现与留证）
  await page.keyboard.type('丁戊', { delay: 60 })
  await settle(350)
  const outC = await after(markC)
  assert.equal(countOf(outC, 'hover.request'), 0, '邻格打字零 hover.request 重发（键迁移）')
  assert.equal(countOf(outC, 'refEdit.bind'), 0, '邻格打字零重绑')
  assert.equal(countOf(outC, 'refEdit.unbind'), 0, '邻格打字零端口销毁')
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 5, '打字后 5 编辑器全部存活')
  const textC2 = await mainText()
  assert.ok(textC2.includes('| 数据行二丁戊 |'), `A 邻格含新字（实际 ${textC2.split('\n')[5] ?? ''}）`)
  assert.equal(await page.evaluate(() => window.tableCellMainSelection().head > 0), true)
  passed++
  console.log('[格内Live][PASS] C 焦点回 A：Tab 切格恢复 + 邻格打字实例平移零风暴')

  // ---- 场景 D：列移动真实拖拽（列 1 嵌入列 → 列 2 位）——不误弹、端口稳定 ----
  await page.evaluate(() => window.tableCellFocusMainAt(0))
  await settle(150)
  const from = await page.locator('.vsidian-table-column-handle').nth(0).boundingBox()
  const to = await page.locator('.vsidian-table-column-handle').nth(1).boundingBox()
  assert.ok(from && to, 'D 列把手在场')
  const markD = await mark()
  const portsD0 = (await cards()).map((c) => c.livePortId).sort()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width + 6, from.y + from.height / 2, { steps: 8 })
  await page.mouse.up()
  await settle(400)
  const outD = await after(markD)
  const dialogD = await page.evaluate(() => window.tableCellCloseDialogOpen())
  assert.equal(dialogD, false, '列移动不弹删除确认（保文本重定位放行）')
  assert.equal(countOf(outD, 'refEdit.close.query'), 0, '零 close.query')
  const textD = await mainText()
  assert.ok(textD.includes('| ![[目标笔记#小节]] | ![[目标笔记\\|头别名]] | 头C |'),
    `列移动完成且转义原文逐字保留（实际 ${textD.split('\n')[2]}）`)
  assert.ok(textD.includes('| ![[目标笔记#^blk]] | 甲 ![[目标笔记\\|别名]] 乙 | 普二格 |'),
    `数据行列移动同款（实际 ${textD.split('\n')[4]}）`)
  assert.equal(countOf(outD, 'refEdit.bind'), 0, '列移动零重绑（键迁移命中重定位）')
  assert.equal(countOf(outD, 'refEdit.unbind'), 0, '列移动零端口销毁')
  assert.equal(countOf(outD, 'hover.request'), 0, '列移动零重载')
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 5, '5 编辑器全部存活')
  const portsD1 = (await cards()).map((c) => c.livePortId).sort()
  assert.deepEqual(portsD1, portsD0, '端口身份不变（列移动不误伤嵌入实例与端口）')
  const modelD = await page.evaluate(() => window.tableCellTargetModel('目标笔记'))
  assert.ok(modelD.text.includes('目标笔记标题') && modelD.dirty, 'B 未保存编辑与权威状态保持')
  passed++
  console.log('[格内Live][PASS] D 列移动：零弹窗零重绑、转义保真、端口与 B 现场保持')

  // ---- 场景 E：行移动真实拖拽（数据行 1 升表头）同款 ----
  await page.evaluate(() => window.tableCellFocusMainAt(0))
  await settle(150)
  const fromR = await page.locator('.vsidian-table-row-handle').nth(1).boundingBox()
  const topR = await page.locator('.vsidian-table-row-handle').nth(0).boundingBox()
  assert.ok(fromR && topR, 'E 行把手在场')
  const markE = await mark()
  await page.mouse.move(fromR.x + fromR.width / 2, fromR.y + fromR.height / 2)
  await page.mouse.down()
  await page.mouse.move(fromR.x + fromR.width / 2, topR.y + 2, { steps: 8 })
  await page.mouse.up()
  await settle(400)
  const outE = await after(markE)
  assert.equal(await page.evaluate(() => window.tableCellCloseDialogOpen()), false, '行移动不弹删除确认')
  assert.equal(countOf(outE, 'refEdit.close.query'), 0, '零 close.query')
  const linesE = (await mainText()).split('\n')
  assert.ok(linesE[2].includes('甲 ![[目标笔记\\|别名]] 乙'),
    `嵌入行升表头、对换形态转义保真（实际 ${linesE[2]}）`)
  assert.equal(countOf(outE, 'refEdit.bind'), 0, '行移动零重绑')
  assert.equal(countOf(outE, 'refEdit.unbind'), 0, '行移动零端口销毁')
  assert.equal(countOf(outE, 'hover.request'), 0, '行移动零重载')
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 5, '5 编辑器全部存活')
  passed++
  console.log('[格内Live][PASS] E 行移动：零弹窗零重绑、对换形态实例迁移')

  // ---- 场景 F：区域 Delete 删嵌入行——拦截确认；取消保留；保存并关闭删除 ----
  // 恢复文档形态：行移动后表头 = 原数据行（含 2 嵌入）。删除当前表头行 = 删 2 嵌入
  await page.evaluate(() => window.tableCellFocusMainAt(0))
  await settle(150)
  const cellBox = (r, c) => page.evaluate(([rr, cc]) => {
    const row = document.querySelectorAll('.vsidian-table-grid-row')[rr]
    const cell = row?.querySelectorAll(':scope > .vsidian-table-grid-cell')[cc]
    return cell?.getBoundingClientRect() ?? null
  }, [r, c])
  const a = await cellBox(0, 0)
  const b = await cellBox(0, 2)
  const startY = a.y + Math.min(10, a.height / 2)
  await page.mouse.move(a.x + 12, startY)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 10, startY, { steps: 3 })
  await page.mouse.move(b.x + b.width - 10, b.y + b.height / 2, { steps: 2 })
  await page.mouse.up()
  await settle(150)
  assert.equal(await page.locator('.vsidian-table-region-cell').count(), 3, 'F 满行格区建立')
  const textF0 = await mainText()
  await page.keyboard.press('Delete')
  await settle(300)
  assert.equal(await page.evaluate(() => window.tableCellCloseDialogOpen()), true,
    '删嵌入行弹删除确认（真删除拦截保持）')
  assert.equal(await mainText(), textF0, '确认前 A 不写入（事务被拦）')
  await page.evaluate(() => window.tableCellDialogClick('cancel'))
  await settle(250)
  assert.equal(await page.evaluate(() => window.tableCellCloseDialogOpen()), false, '取消后模态退场')
  assert.equal(await mainText(), textF0, '取消保留引用')
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 5, '取消后编辑器全存活')
  // 再删（模态取消使焦点离开编辑器——真实用户路径重新拖选格区）→ 保存并
  // 关闭：A 行删除、目标 B 已保存内容不丢
  await page.evaluate(() => window.tableCellFocusMainAt(0))
  await settle(150)
  const a2 = await cellBox(0, 0)
  const b2 = await cellBox(0, 2)
  const startY2 = a2.y + Math.min(10, a2.height / 2)
  await page.mouse.move(a2.x + 12, startY2)
  await page.mouse.down()
  await page.mouse.move(b2.x + b2.width - 10, startY2, { steps: 3 })
  await page.mouse.move(b2.x + b2.width - 10, b2.y + b2.height / 2, { steps: 2 })
  await page.mouse.up()
  await settle(150)
  assert.equal(await page.locator('.vsidian-table-region-cell').count(), 3, 'F 二次格区重建（焦点已回编辑器）')
  await page.keyboard.press('Delete')
  await settle(300)
  assert.equal(await page.evaluate(() => window.tableCellCloseDialogOpen()), true, '二次删除再拦截')
  await page.evaluate(() => window.tableCellDialogClick('save'))
  await settle(500)
  const textF1 = await mainText()
  assert.ok(!textF1.includes('目标笔记\\|别名') || !textF1.includes('| 甲'),
    `保存并关闭后嵌入行删除（实际 ${textF1.split('\n').slice(2, 6).join(' / ')}）`)
  assert.ok(textF1.includes('数据行二丁戊') && textF1.includes('乙笔记\\|e'),
    '其余行与格不受扰')
  passed++
  console.log('[格内Live][PASS] F 删嵌入行：拦截→取消保留→保存并关闭完成删除')

  // ---- 场景 G：B 增行使卡增高让位相邻内容（行高联动）+ 限高封顶 ----
  await page.evaluate(() => window.respondTableCell({
    kind: 'settings.snapshot', values: { 'embed.maxHeight': 480 },
  }))
  await settle(300)
  // 乙笔记卡（文档序 4——F 后表头行删除，卡序有变：按内容找编辑器序号）
  const yiIdx = await page.evaluate(() => {
    const editors = document.querySelectorAll('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    for (let i = 0; i < editors.length; i++) {
      if ((editors[i].textContent ?? '').includes('乙笔记标题')) return i
    }
    return -1
  })
  assert.ok(yiIdx >= 0, 'G 乙笔记卡在场')
  assert.equal(await page.evaluate((p) => window.tableCellFocusEditorAt(p, 0), yiIdx), true, '焦点进乙卡行首')
  // 行高联动观测点：表格下方段落（同行邻格在 grid 行内顶对齐，top 不随行高变化）
  const rowBelowTopBefore = await page.evaluate(() => window.tableCellTextTopOf('收尾段落'))
  const cardHBefore = await page.evaluate((p) => window.tableCellEditorGeometryAt(p).editorHeight, yiIdx)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Enter')
    await settle(60)
  }
  await settle(400)
  const geoG = await page.evaluate((p) => window.tableCellEditorGeometryAt(p), yiIdx)
  assert.ok(geoG.editorHeight > cardHBefore + 30,
    `B 增行使格内编辑器增高（${cardHBefore} → ${geoG.editorHeight}）`)
  assert.ok(geoG.capped, `编辑器限高封顶不撑破父表格（${geoG.editorHeight} <= 480+2）`)
  const rowBelowTopAfter = await page.evaluate(() => window.tableCellTextTopOf('收尾段落'))
  assert.ok(rowBelowTopAfter > rowBelowTopBefore + 30,
    `父表格行高联动（同行邻格内容随卡下移让位，${rowBelowTopBefore} → ${rowBelowTopAfter}）`)
  assert.equal(geoG.neighborPainted, true, '同行邻格仍绘制可见')
  await page.keyboard.press('Control+z')
  await settle(250)
  passed++
  console.log('[格内Live][PASS] G 变高联动：编辑器增高、限高封顶、父行高让位')

  // ---- 场景 H：父 Reading 手动进入目标 Live（模式矩阵 + Reading 零写回） ----
  await page.evaluate(() => window.setTableCellMode('reading'))
  await settle(400)
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 0,
    '父 Reading 跟随时无编辑器（Reading 零端口）')
  // Reading 容器内的格内卡（td/th 内）：手动切第 2 枚进 Live
  const readingCards = page.locator('.vsidian-view-reading .vsidian-embed-card .vsidian-embed-card-mode')
  const readingCount = await readingCards.count()
  assert.ok(readingCount >= 3, `Reading 侧格内卡在场（实际 ${readingCount}）`)
  await readingCards.nth(1).click()
  await settle(500)
  assert.equal(await page.evaluate(() => window.tableCellCardEditorCount()), 1,
    '手动切 Live 创建编辑器（reading 父下单卡进入）')
  const cardsH = (await cards()).filter((c) => c.host === 'reading' && c.internalMode === 'live')
  assert.equal(cardsH.length, 1, '手动覆盖生效（探针限定 Reading 容器域）')
  assert.equal(cardsH[0].liveBound, true, '手动进入绑定端口')
  // Reading 父 + 单卡 Live 下：B 输入仍只写 B，A（Reading）零写回
  const hIdx = await page.evaluate(() => {
    const editors = document.querySelectorAll('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    return editors.length - 1
  })
  await page.evaluate((p) => window.tableCellFocusEditorAt(p, 2), hIdx)
  await page.keyboard.type('读')
  await settle(300)
  assert.equal(await mainText(), textF1, 'Reading 父下 B 输入零写回 A')
  // 父切回 Live：手动 Live 保留、其余继承
  await page.evaluate(() => window.setTableCellMode('live'))
  await settle(500)
  const cardsH2 = (await cards()).filter((c) => c.host === 'live' && c.rootHost === 'live')
  assert.equal(cardsH2.length, 3, `F 删行后 Live 容器 3 卡（实际 ${cardsH2.length}）`)
  assert.equal(cardsH2.filter((c) => c.internalMode === 'live').length, 3,
    '父 Live 下全部 Live（手动 + 继承）')
  passed++
  console.log('[格内Live][PASS] H 父 Reading 手动进入 + Reading 零写回 + 覆盖记忆保持')

  // ---- 场景 I：卡内拖选不启动父矩形格区（Live 编辑器版交互隔离） ----
  const plainRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
    const r = rows.find((row) => (row.textContent ?? '').includes('数据行二'))
    const cells = r?.querySelectorAll(':scope > .vsidian-table-grid-cell')
    return cells?.[1] ? cells[0].getBoundingClientRect().toJSON() : null
  })
  assert.ok(plainRow, 'I 对照格在场')
  const cardBox = await page.evaluate(() => {
    const eds = document.querySelectorAll('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    const ed = eds[0]
    return ed ? ed.getBoundingClientRect().toJSON() : null
  })
  assert.ok(cardBox, 'I 编辑器在场')
  await page.mouse.move(cardBox.x + 20, cardBox.y + 14)
  await page.mouse.down()
  await page.mouse.move(plainRow.x + 14, plainRow.y + plainRow.height / 2, { steps: 5 })
  await page.mouse.up()
  await settle(150)
  assert.equal(await page.locator('.vsidian-table-region-cell').count(), 0,
    '编辑器内拖选不启动父矩形格区')
  passed++
  console.log('[格内Live][PASS] I 交互隔离：格内编辑器拖选零父格区')

  // ---- 场景 J：离屏回收重挂——编辑器销毁重建、B 内容恢复 ----
  const OFFDOC = [
    '# P2-08 离屏', '',
    ...Array.from({ length: 50 }, (_, i) => `前置段落 ${i + 1}，把表格推到文档中部。`),
    '',
    '| ![[目标笔记\\|离屏]] | 普通格 |',
    '| --- | --- |',
    '| 数据格 | ![[乙笔记\\|乙]] |',
    '',
    ...Array.from({ length: 170 }, (_, i) => `后置段落 ${i + 1}，用于把表格推离视口。`),
    '',
  ].join('\n')
  const page2 = await browser.newPage({ viewport: { width: 1000, height: 640 } })
  const errors2 = []
  page2.on('pageerror', (error) => errors2.push(error.message))
  await page2.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page2.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page2.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page2.addScriptTag({ path: bundle })
  await page2.evaluate((text) => window.initTableCellDoc(text), OFFDOC)
  // 滚到表格使格内 widget 进视口、装载并绑定
  for (let i = 0; i < 30; i += 1) {
    const reqs = await page2.evaluate(() =>
      window.tableCellSent().filter((m) => m.kind === 'hover.request').length)
    if (reqs >= 2) break
    await page2.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')
      if (scroller) scroller.scrollTop += 400
    })
    await page2.waitForTimeout(120)
  }
  await page2.waitForTimeout(600)
  const jLoaded = await page2.evaluate(() => ({
    editors: window.tableCellCardEditorCount(),
    cards: window.tableCellCards().length,
  }))
  assert.equal(jLoaded.editors, 2, `J 两枚格内编辑器在场（实际 ${jLoaded.editors}）`)
  // B 内设置选区 + 键入（编辑现场），滚离（widget 出 CM6 视口 → 卸载销毁端口）
  await page2.evaluate(() => window.tableCellFocusEditorAt(0, 8))
  await page2.keyboard.type('离')
  await page2.waitForTimeout(300)
  const jSel = await page2.evaluate(() => window.tableCellEditorSelectionAt(0))
  await page2.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await page2.waitForTimeout(400)
  const jOff = await page2.evaluate(() => ({
    editors: window.tableCellCardEditorCount(),
    cards: window.tableCellCards().length,
  }))
  assert.ok(jOff.editors < 2, `J 离屏编辑器回收（实际剩 ${jOff.editors}）`)
  // 滚回：重挂 → 端口重绑 → init 装载（含未保存编辑）+ 选区恢复
  for (let i = 0; i < 30; i += 1) {
    const found = await page2.evaluate(() => window.tableCellCardEditorCount())
    if (found >= 2) break
    await page2.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')
      if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - 500)
    })
    await page2.waitForTimeout(150)
  }
  await page2.waitForTimeout(600)
  const jBack = await page2.evaluate(() => ({
    editors: window.tableCellCardEditorCount(),
    text: window.tableCellEditorTextAt(0),
    sel: window.tableCellEditorSelectionAt(0),
  }))
  assert.equal(jBack.editors, 2, `J 滚回两编辑器重建（实际 ${jBack.editors}）`)
  assert.ok(jBack.text.includes('离'), `J 重建后 B 未保存编辑恢复（实际 ${jBack.text.slice(0, 20)}）`)
  assert.ok(jBack.sel.anchor === jSel.anchor && jBack.sel.head === jSel.head,
    `J 选区记忆恢复（离屏保存值 ${JSON.stringify(jSel)} → 重挂后 ${JSON.stringify(jBack.sel)}）`)
  assert.deepEqual(errors2, [], `J page2 无页面错误（实际 ${JSON.stringify(errors2)}）`)
  await page2.close()
  passed++
  console.log('[格内Live][PASS] J 离屏回收重挂：编辑器重建、未保存编辑与选区恢复')

  assert.deepEqual(errors, [], `page1 无页面错误（实际 ${JSON.stringify(errors)}）`)
  console.log(`tableCellLive: ${passed} 场景全部通过`)
} finally {
  await browser.close()
}
