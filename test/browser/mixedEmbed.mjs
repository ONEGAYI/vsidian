// #246 混排/列表/引用容器内嵌入的原生浏览器回归：真实布局（Chromium）
// 经生产控制器装配（复用 readingEmbedFixture 基座）验证——
// - 段落混排「前文 → 块级卡片 → 后文」的绘制层证据（前后文 p 可见、卡片
//   elementFromPoint 命中、横跨粗体拆壳后前后各成完整 strong）
// - 无序/有序/任务/懒续行列表与 blockquote 内卡片落位：列表编号与结构
//   不拆、引用边条绘制、宿主宽度跟随所属列（不越缩进界）
// - 同段多嵌入源顺序；递归（卡片内容内混排升级孙卡，RefContentMount 路径）
// - 链接域内占位不升级（span 文本形态）；#248 起表格格内同升级（td 宿主）
// - 图片 alt 域内字面量不落 DOM、不牵连同段随文位降级（终审 P1-1 回归钉）
// - 零写回（全程无 edit.request）
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'mixedEmbed/mixedEmbed.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

/** 父文档：混排各形态（段落/跨格式/双嵌入/列表族/引用/组合/链接/表格）。
 *  乙笔记 11 个可提升位（段落/粗体/双嵌入首/无序/有序/任务/懒续/引用/引用内
 *  列表/表格格内 #248 起/图片 alt 段随文位）+ 2 个不升级位（链接域 + 图片 alt
 *  域内——终审 P1-1 后者不落 DOM 不发请求且不牵连同段随文位）；丙笔记 1 个。 */
const PARENT_DOC = [
  '# 混排嵌入父文档',
  '',
  '前文段落 ![[乙笔记]] 后文段落。',
  '',
  '**粗体开 ![[乙笔记]] 粗体续** 与普通 *斜体*。',
  '',
  '图片 alt ![替代 ![[乙笔记]] 文字](https://e.example/i.png) 不升级，随后 ![[乙笔记]] 照常挂卡。',
  '',
  '起 ![[乙笔记]] 中 ![[丙笔记]] 末。',
  '',
  '- 无序项甲',
  '- 无序项乙 ![[乙笔记]] 项内余文',
  '- 无序项丙',
  '',
  '1. 有序一',
  '2. 有序二 ![[乙笔记]] 二余',
  '3. 有序三',
  '',
  '- [ ] 任务项 ![[乙笔记]] 完成度',
  '',
  '- 懒续项',
  '  续行 ![[乙笔记]] 续余',
  '',
  '> 引用前文 ![[乙笔记]] 引用后文',
  '',
  '> - 引用内列表 ![[乙笔记]] 项余',
  '',
  '链接域 [文字 ![[乙笔记]] 形态](https://e.example/x) 不升级。',
  '',
  '| 列甲 | 列乙 |',
  '| --- | --- |',
  '| 单元 | 格内 ![[乙笔记]] 占位 |',
  '',
].join('\n')

const TARGET_B = ['# 乙笔记', '', '乙笔记正文一段。', '', '乙内混排 ![[丙笔记]] 乙内余文。', ''].join('\n')
const TARGET_C = ['# 丙笔记', '', '丙笔记正文。', ''].join('\n')

const { islandHtml } = await buildZhLocaleIsland(root)

/** 页内观测共用的「主文档直属」宿主查询（排除卡片/浮层内嵌套容器）——
 *  以 window 注入（Playwright evaluate 的多语句串不回值，函数式可靠） */
const MAIN_HOSTS_FN = `(() => {
  window.__mixedHosts = () => Array.from(document.querySelectorAll('.vsidian-reading-embed-mixed'))
    .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
})()`

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initEmbedDoc(text), PARENT_DOC)
  await page.evaluate(MAIN_HOSTS_FN)
  const hoverRequests = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'hover.request'))
  const editRequestCount = () => page.evaluate(() =>
    window.embedSent().filter((m) => m.kind === 'edit.request').length)

  /** 主文档请求按目标逐笔回成功包；孙卡请求（乙内容内混排丙）随后出现并回包 */
  const answered = new Set()
  const respondAll = async () => {
    for (let round = 0; round < 3; round++) {
      const reqs = (await hoverRequests()).filter((r) => !answered.has(r.reqId))
      if (reqs.length === 0) break
      for (const req of reqs) {
        answered.add(req.reqId)
        const isC = req.target === '丙笔记'
        const text = isC ? TARGET_C : TARGET_B
        await page.evaluate(({ reqId, instanceId, text: t, target, isChild }) => window.respondEmbed({
          kind: 'hover.result', reqId, instanceId, ok: true,
          target: { fsPath: isChild ? 'D:\\notes\\丙笔记.md' : 'D:\\notes\\乙笔记.md', relPath: isChild ? '丙笔记' : target },
          version: 2, text: t, range: { start: 0, end: t.length }, scope: { kind: 'full' },
        }), { reqId: req.reqId, instanceId: req.instanceId, text, target: req.target, isChild: isC })
      }
      await page.waitForTimeout(250)
    }
  }

  // ---- 场景 A：混排请求载荷（行内 occurrence 区间）与升级数量 ----
  const reqsA = await hoverRequests()
  const bReqs = reqsA.filter((r) => r.target === '乙笔记')
  const cReqs = reqsA.filter((r) => r.target === '丙笔记')
  assert.equal(bReqs.length, 11, `乙笔记 11 个可提升位（丙另计；#248 起含表格格内，终审 P1-1 起含图片 alt 段随文位）各发请求（实际 ${bReqs.length}）`)
  assert.equal(cReqs.length, 1, '丙笔记 1 个（同段双嵌入的第二目标）')
  for (const req of reqsA) {
    const raw = `![[${req.target}]]`
    assert.equal(PARENT_DOC.slice(req.sourceStart, req.sourceEnd), raw,
      `请求区间须为嵌入原文精确边界（${req.target}@${req.sourceStart}）`)
  }
  const linkSlotFrom = PARENT_DOC.indexOf('![[乙笔记]]', PARENT_DOC.indexOf('[文字'))
  const tableSlotFrom = PARENT_DOC.indexOf('![[乙笔记]]', PARENT_DOC.indexOf('格内'))
  const altSlotFrom = PARENT_DOC.indexOf('![[乙笔记]]', PARENT_DOC.indexOf('替代'))
  const altFollowFrom = PARENT_DOC.indexOf('![[乙笔记]]', altSlotFrom + 1)
  assert.ok(!bReqs.some((r) => r.sourceStart === linkSlotFrom), '链接域内占位不升级（无请求）')
  assert.ok(bReqs.some((r) => r.sourceStart === tableSlotFrom), '表格格内升级（#248 起有请求）')
  assert.ok(!bReqs.some((r) => r.sourceStart === altSlotFrom), '图片 alt 域内字面量不落 DOM（无请求——随 img alt 属性走，终审 P1-1）')
  assert.ok(bReqs.some((r) => r.sourceStart === altFollowFrom), '同段随文位照常升级（不牵连，终审 P1-1）')
  passed++
  console.log('[混排嵌入][PASS] 混排请求载荷：行内精确区间 + 链接域不升级（表格格内 #248 起同升级）')

  // ---- 场景 B：段落混排绘制层（前后文 p 可见 + 卡片命中 + 粗体拆壳） ----
  const paraEvidence = await page.evaluate(() => {
      const hosts = window.__mixedHosts()
      const first = hosts[0]
      if (!first) return null
      const card = first.querySelector('.vsidian-embed-card')
      const before = first.previousElementSibling
      const after = first.nextElementSibling
      const rect = card?.getBoundingClientRect()
      const hit = rect ? document.elementFromPoint(rect.left + 40, rect.top + 12) : null
      return {
        hostCount: hosts.length,
        beforeIsP: before instanceof HTMLParagraphElement,
        afterIsP: after instanceof HTMLParagraphElement,
        beforeVisible: before ? before.getBoundingClientRect().height > 0 : false,
        afterVisible: after ? after.getBoundingClientRect().height > 0 : false,
        beforeText: (before?.textContent ?? '').trim(),
        afterText: (after?.textContent ?? '').trim(),
        hitInsideCard: hit !== null && !!card?.contains(hit),
        cardWidth: rect?.width ?? 0,
      }
    })
  assert.ok(paraEvidence, '流内宿主在场')
  assert.equal(paraEvidence.hostCount, 12, `主文档 12 个可提升位各一宿主（乙 11 + 丙 1，#248 起含表格 td 内，实际 ${paraEvidence.hostCount}）`)
  assert.ok(paraEvidence.beforeIsP && paraEvidence.afterIsP, '拆段为 p(前)+宿主+p(后)')
  assert.ok(paraEvidence.beforeVisible && paraEvidence.afterVisible, '前后文绘制层可见（非零高）')
  assert.equal(paraEvidence.beforeText, '前文段落', `前文文本无吞噬（实际 ${paraEvidence.beforeText}）`)
  assert.equal(paraEvidence.afterText, '后文段落。', `后文文本无吞噬（实际 ${paraEvidence.afterText}）`)
  assert.ok(paraEvidence.hitInsideCard, '卡片 elementFromPoint 命中（真实绘制）')
  assert.ok(paraEvidence.cardWidth > 100, `宿主宽度跟随正文列（实际 ${paraEvidence.cardWidth}）`)
  const strongEvidence = await page.evaluate(() => {
      const hosts = window.__mixedHosts()
      const bold = hosts[1]
      const pBefore = bold?.previousElementSibling
      const pAfter = bold?.nextElementSibling
      const strongBefore = pBefore?.firstElementChild ?? null
      const strongAfter = pAfter?.firstElementChild ?? null
      return {
        beforeIsP: pBefore instanceof HTMLParagraphElement,
        afterIsP: pAfter instanceof HTMLParagraphElement,
        beforeStrong: strongBefore?.tagName === 'STRONG',
        afterStrong: strongAfter?.tagName === 'STRONG',
        beforeWeight: strongBefore ? getComputedStyle(strongBefore).fontWeight : '',
        afterWeight: strongAfter ? getComputedStyle(strongAfter).fontWeight : '',
        beforeText: (strongBefore?.textContent ?? '').trim(),
        afterText: (strongAfter?.textContent ?? '').trim(),
      }
    })
  assert.ok(strongEvidence.beforeIsP && strongEvidence.afterIsP, '粗体段拆为 p(前)+宿主+p(后)')
  assert.ok(strongEvidence.beforeStrong && strongEvidence.afterStrong, '拆壳后前后半 p 内首元素各为完整 strong')
  assert.equal(strongEvidence.beforeText, '粗体开', `拆壳前半文本（实际 ${strongEvidence.beforeText}）`)
  assert.equal(strongEvidence.afterText, '粗体续', `拆壳后半文本（实际 ${strongEvidence.afterText}）`)
  assert.ok(Number(strongEvidence.beforeWeight) >= 600 && Number(strongEvidence.afterWeight) >= 600,
    `拆壳后前后半仍为粗体渲染（${strongEvidence.beforeWeight}/${strongEvidence.afterWeight}）`)
  passed++
  console.log('[混排嵌入][PASS] 段落混排绘制：前后文可见 + 卡片命中 + 粗体拆壳')

  // ---- 场景 C：列表族与引用容器（结构保真 + 宽度跟随 + 边条绘制） ----
  const listEvidence = await page.evaluate(() => {
      const hosts = window.__mixedHosts()
      const out = { inLi: true, liWidthOk: true, taskLi: false, lazyLi: false,
        ulHosts: 0, olHosts: 0, olNumbers: [] }
      for (const host of hosts) {
        const li = host.closest('li')
        const list = host.closest('ul, ol')
        if (!list) continue // 段落/粗体/双嵌入宿主不在列表——本断言不辖
        if (!li) { out.inLi = false; continue }
        const liRect = li.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        if (hostRect.left < liRect.left - 1 || hostRect.right > liRect.right + 1) out.liWidthOk = false
        if (list.tagName === 'UL') out.ulHosts++
        if (list.tagName === 'OL') {
          out.olHosts++
          const idx = Array.from(list.querySelectorAll(':scope > li')).indexOf(li)
          out.olNumbers.push(idx + 1)
        }
        if (li.querySelector('input[type="checkbox"]')) out.taskLi = true
        if (li.textContent?.includes('续行')) out.lazyLi = true
      }
      const main = () => Array.from(document.querySelectorAll('.vsidian-reading-block'))
        .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
      out.olLiTotal = main().reduce((n, b) => n + b.querySelectorAll('ol > li').length, 0)
      out.ulLiTotal = main().reduce((n, b) => n + b.querySelectorAll('ul > li').length, 0)
      return out
    })
  assert.ok(listEvidence.inLi, '列表内宿主全部落位 li（结构不拆）')
  assert.ok(listEvidence.liWidthOk, '列表内宿主宽度不越 li 内容界')
  assert.ok(listEvidence.taskLi, '任务项内宿主与 checkbox 共存')
  assert.ok(listEvidence.lazyLi, '懒续行内宿主落位')
  assert.equal(listEvidence.ulHosts + listEvidence.olHosts, 5,
    `列表内宿主 5 处（无序+有序+任务+懒续+引用内列表，实际 ul=${listEvidence.ulHosts} ol=${listEvidence.olHosts}）`)
  const quoteEvidence = await page.evaluate(() => {
      const quotes = Array.from(document.querySelectorAll('.vsidian-reading-block blockquote'))
        .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
      const withCard = quotes.filter((q) => q.querySelector('.vsidian-reading-embed-mixed'))
      const q = withCard[0]
      if (!q) return null
      const style = getComputedStyle(q)
      const host = q.querySelector('.vsidian-reading-embed-mixed')
      const hostRect = host.getBoundingClientRect()
      const qRect = q.getBoundingClientRect()
      return {
        quoteCount: quotes.length,
        withCard: withCard.length,
        barWidth: style.borderLeftWidth,
        barColor: style.borderLeftColor,
        hostInsideQuote: hostRect.left >= qRect.left && hostRect.right <= qRect.right + 1,
        pCount: q.querySelectorAll(':scope > p').length,
      }
    })
  assert.ok(quoteEvidence, '引用内宿主在场')
  assert.equal(quoteEvidence.quoteCount, 2, `两条 blockquote 保留（实际 ${quoteEvidence.quoteCount}）`)
  assert.equal(quoteEvidence.withCard, 2, '两处引用内各一宿主（含引用内列表）')
  assert.ok(parseFloat(quoteEvidence.barWidth) >= 3, `引用边条在场（实际 ${quoteEvidence.barWidth}）`)
  assert.notEqual(quoteEvidence.barColor, 'rgba(0, 0, 0, 0)', '引用边条颜色非透明')
  assert.ok(quoteEvidence.hostInsideQuote, '宿主不越引用内容界')
  assert.equal(quoteEvidence.pCount, 2, `引用内拆段 p(前)+p(后)（实际 ${quoteEvidence.pCount}）`)
  passed++
  console.log('[混排嵌入][PASS] 列表族与引用容器：结构保真 + 宽度跟随 + 边条绘制')

  // ---- 场景 D：链接域占位保持（span 文本形态）；#248 起表格格内升级 td 宿主 ----
  const degradedEvidence = await page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll('span.vsidian-embed-slot'))
      .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
    const inLink = slots.filter((s) => s.closest('a'))
    const inTable = slots.filter((s) => s.closest('table'))
    const tableHost = document.querySelector('table td .vsidian-reading-embed-mixed')
    const style = slots.length ? getComputedStyle(slots[0]) : null
    return {
      slotCount: slots.length,
      inLink: inLink.length,
      inTableSlots: inTable.length,
      linkText: (inLink[0]?.closest('a')?.textContent ?? '').trim(),
      tableHostInTd: tableHost !== null,
      tableTrCount: document.querySelectorAll('table tr').length,
      color: style?.color ?? '',
      visibleHeight: slots[0]?.getBoundingClientRect().height ?? 0,
    }
  })
  assert.equal(degradedEvidence.slotCount, 1, `恰一处占位保持（链接域；表格格内 #248 起升级，实际 ${degradedEvidence.slotCount}）`)
  assert.equal(degradedEvidence.inLink, 1, '链接域占位 1 处')
  assert.equal(degradedEvidence.inTableSlots, 0, '表格格内不再保持占位（升级为格内宿主）')
  assert.ok(degradedEvidence.tableHostInTd, '表格格内卡片宿主落位 td（#248）')
  assert.equal(degradedEvidence.tableTrCount, 2, '表格行结构完整（升级不拆表）')
  assert.ok(degradedEvidence.linkText.includes('![[乙笔记]]'), `链接域占位文本保留（实际 ${degradedEvidence.linkText}）`)
  assert.ok(degradedEvidence.visibleHeight > 0, '占位绘制层可见（非零高）')
  passed++
  console.log('[混排嵌入][PASS] 链接域占位保持；表格格内升级 td 宿主且不拆表（#248）')

  // ---- 场景 D2：图片 alt 域内字面量不牵连同块（终审 P1-1：不整块降级） ----
  const altEvidence = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('#app img'))
        .filter((el) => !el.classList.contains('cm-widgetBuffer')
          && !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup')
          && el.closest('p') !== null)
      const para = imgs[0]?.closest('p') ?? null
      const host = para?.nextElementSibling ?? null
      const rect = host instanceof HTMLElement ? host.getBoundingClientRect() : null
      return {
        imgCount: imgs.length,
        imgAlt: imgs[0]?.getAttribute('alt') ?? '',
        imgState: imgs[0]?.closest('[data-vsidian-img-state]')?.getAttribute('data-vsidian-img-state')
          ?? imgs[0]?.getAttribute('data-vsidian-img-state') ?? '',
        paraText: (para?.textContent ?? '').trim(),
        hostIsMixed: host instanceof HTMLElement && host.classList.contains('vsidian-reading-embed-mixed'),
        hostInner: host instanceof HTMLElement ? host.dataset['vsidianEmbedInner'] ?? '' : '',
        hostVisible: rect !== null && rect.height > 0,
      }
    })
  assert.equal(altEvidence.imgCount, 1, `图片 alt 域段渲染为 img（实际 ${altEvidence.imgCount}）`)
  // 远程占位图必然加载失败；失败回传快时产品按 imageResource 契约将 alt
  // 改写为失败提示（原 alt 存内部记录，见 applyErrorAlt）。两种终态都证明
  // img 属性通道正常呈现——不依赖失败回传时机（对代理/DNS 环境不敏感）。
  const altIntact = altEvidence.imgAlt.includes('替代') && altEvidence.imgAlt.includes('文字')
  const errorUiApplied = altEvidence.imgState === 'error' && altEvidence.imgAlt.includes('图片加载失败')
  assert.ok(altIntact || errorUiApplied,
    `alt 属性两种终态其一（原文字或失败提示，实际 alt=${altEvidence.imgAlt} state=${altEvidence.imgState}）`)
  assert.ok(altEvidence.paraText.startsWith('图片 alt'), `拆段前文保留（实际 ${altEvidence.paraText}）`)
  assert.ok(altEvidence.hostIsMixed, '同段随文位提升为流内宿主（不牵连降级）')
  assert.equal(altEvidence.hostInner, '乙笔记', `随文位宿主 inner（实际 ${altEvidence.hostInner}）`)
  assert.ok(altEvidence.hostVisible, '随文位宿主绘制层可见（非零高）')
  passed++
  console.log('[混排嵌入][PASS] 图片 alt 域内字面量不牵连同块（img 属性呈现 + 随文位照常挂卡）')

  // ---- 场景 E：回包 → 内容绘制 + 卡片内递归混排（RefContentMount 路径） ----
  // 回包后卡片变高使虚拟化窗口收缩，远端块（含宿主/孙卡）按既有语义回收
  //——在场断言只覆盖当前窗口，请求侧断言覆盖全部 10 位与孙卡请求
  await respondAll()
  const cardsAfter = await page.evaluate(() => window.readEmbedCards())
  assert.ok(cardsAfter.length >= 3, `窗口内卡片在场（实际 ${cardsAfter.length}）`)
  const withContent = cardsAfter.filter((c) => c.text.includes('乙笔记正文') || c.text.includes('丙笔记正文'))
  assert.equal(withContent.length, cardsAfter.length, `在场卡片全部装载到目标正文（实际 ${withContent.length}/${cardsAfter.length}）`)
  const childReqs = (await hoverRequests()).filter((r) => r.source !== undefined)
  assert.ok(childReqs.length >= 1 && childReqs.length <= 11,
    `乙卡内容内混排位随父块挂载发孙卡请求（实际 ${childReqs.length}/11——远端块按虚拟化语义回收）`)
  const recursion = await page.evaluate(() => {
      const inner = Array.from(document.querySelectorAll('.vsidian-embed-card .vsidian-embed-card'))
      const hosts = inner.map((card) => card.closest('.vsidian-reading-embed-mixed'))
      return {
        nestedCount: inner.length,
        nestedHost: hosts.filter(Boolean).length,
        nestedHasContent: inner.some((c) => (c.textContent ?? '').includes('丙笔记正文')),
      }
    })
  assert.ok(recursion.nestedCount > 0, `窗口内孙卡在场（实际 ${recursion.nestedCount}）`)
  assert.equal(recursion.nestedHost, recursion.nestedCount, '孙卡宿主为流内混排宿主（与主文档同构）')
  assert.ok(recursion.nestedHasContent, '孙卡装载到丙正文（直接来源递归）')
  passed++
  console.log('[混排嵌入][PASS] 卡片内容内递归混排升级（三处同一识别/挂载）')

  // ---- 场景 F：同段双嵌入源顺序 ----
  const orderEvidence = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('.vsidian-reading-block > p'))
        .filter((el) => !el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup'))
      const dual = ps.find((p) => (p.textContent ?? '').trim() === '起')
      if (!dual || !dual.nextElementSibling) return null
      const host = dual.nextElementSibling
      return {
        hostIsMixed: host.classList.contains('vsidian-reading-embed-mixed'),
        firstCardText: (host.querySelector('.vsidian-embed-card')?.textContent ?? '').slice(0, 40),
      }
    })
  assert.ok(orderEvidence, '双嵌入首段（只含前文「起」）后紧跟流内宿主（源顺序）')
  assert.ok(orderEvidence.hostIsMixed, '首嵌入宿主为流内混排宿主')
  assert.ok(orderEvidence.firstCardText.includes('乙笔记正文'), `首卡为乙笔记（源顺序正确，实际 ${orderEvidence.firstCardText}）`)
  passed++
  console.log('[混排嵌入][PASS] 同段双嵌入源顺序')

  // ---- 场景 G：零写回 + 无页面错误 ----
  assert.equal(await editRequestCount(), 0, '混排链路零写回（装载/递归均只读）')
  assert.deepEqual(errors, [], '无页面错误')
  passed++
  console.log('[混排嵌入][PASS] 零写回 + 无页面错误')

  console.log(`\n[混排嵌入] 全部 ${passed} 个场景通过`)
} finally {
  await browser.close()
}
