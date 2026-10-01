// #249 引用视图 1.5 期跨功能组合回归（组合矩阵空白补齐——各功能票
// 单票用例不覆盖的三重组合）：
// - RC1 表格×混排递归×长文：表格格内 B 目标正文含列表/引用内 C 混排
//   嵌入且 C 为超限高长文（#248 表格准入 × #246 容器混排 × #244 递归
//   × #222 限高三重组合）——卡内递归升级、B 身份出站、C 限高与滚轮
//   先内后外
// - RC2 同行多引用×多 range×IME：同行三枚混排嵌入上多选区双 range
//   命中两枚显形（第三枚独立），真实 IME 编辑未命中枚（#247 三重串联）
// - RC3 快速目标切换×乱序回包×旧回包：两枚嵌入的回包乱序到达（快目标
//   先应答、慢目标后应答）不错配；文档变更产生新请求后旧回包迟到被
//   身份守卫丢弃（#224/#242 组合竞速）
// 复用 liveEmbedFixture 生产控制器基座（真实键盘/IME/布局）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'refCombination/refCombination.js')
await build({ entryPoints: [path.join(root, 'test/browser/liveEmbedFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0

async function setupPage(docText) {
  const page = await browser.newPage({ viewport: { width: 860, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initLiveEmbedDoc(text), docText)
  await page.locator('.cm-editor .cm-content').waitFor({ timeout: 5000 })
  return { page, errors }
}

/** hover.result 回包（与生产 handleHostMessage 同入口） */
async function respond(page, req, text, fsPath, relPath) {
  await page.evaluate(({ reqId, instanceId, tt, fs, rel }) => window.respondLiveEmbed({
    kind: 'hover.result', reqId, instanceId, ok: true,
    target: { fsPath: fs, relPath: rel },
    version: 2, text: tt, range: { start: 0, end: tt.length }, scope: { kind: 'full' },
  }), { reqId: req.reqId, instanceId: req.instanceId, tt: text, fs: fsPath, rel: relPath })
}

try {
  // ============ RC1 表格 × 容器混排递归 × 长文限高 ============
  const C_LONG = [
    '# C 长文标题', '',
    ...Array.from({ length: 60 }, (_, i) => `C 长文第 ${i + 1} 段，撑出超过限高的内容量。`), '',
  ].join('\n')
  // B 目标正文：无序列表项内 C 混排 + 引用块内 C 混排（同一 C 两个 occurrence）
  const B_MIX = [
    '# B 表内目标', '',
    '- 列表前文 ![[C长文\\|列表别名]] 列表后文',
    '- 普通列表项',
    '',
    '> 引用前文 ![[C长文]] 引用后文',
    '',
    '正文收尾段。',
    '',
  ].join('\n')
  const RC1_DOC = [
    '# RC1 组合', '',
    '| ![[B表内目标]] | 普通格 |',
    '| --- | --- |',
    '| 无嵌入行 | 123 |',
    '',
  ].join('\n')
  {
    const { page, errors } = await setupPage(RC1_DOC)
    const requests = () => page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
    // 顶层 B 请求
    const bReq = (await requests()).find((r) => r.target === 'B表内目标')
    assert.ok(bReq, 'RC1 表头格 B 请求在途')
    await respond(page, bReq, B_MIX, 'D:\\notes\\B表内目标.md', 'B表内目标.md')
    await page.waitForTimeout(150)
    // B 卡内两个 C occurrence 发子请求（按 B 身份：source.parentInstanceId/sourceDocUri）
    const childReqs = (await requests()).filter((r) => r.target.startsWith('C长文'))
    assert.equal(childReqs.length, 2, `RC1 卡内两枚 C 子请求（列表 + 引用 occurrence，实际 ${childReqs.length}）`)
    assert.ok(childReqs.every((r) => r.source?.parentInstanceId && r.source?.sourceDocUri?.includes('B表内目标')),
      `RC1 子请求按 B 身份出站（实际 ${JSON.stringify(childReqs.map((r) => r.source))}）`)
    for (const r of childReqs) {
      await respond(page, r, C_LONG, 'D:\\notes\\C长文.md', 'C长文.md')
    }
    await page.waitForTimeout(250)
    const structure = await page.evaluate(() => {
      const bCard = [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .find((c) => (c.textContent ?? '').includes('B 表内目标'))
      if (!bCard) return { found: false }
      // B 卡内层结构（卡内 B 视图为 Reading 装配）
      const list = bCard.querySelector('.vsidian-reading-list, ul')
      const quote = bCard.querySelector('blockquote')
      const listTextBefore = list?.textContent ?? ''
      const childCards = [...bCard.querySelectorAll('.vsidian-embed-card')]
      const longScroll = childCards
        .map((c) => c.querySelector('.vsidian-embed-card-scroll'))
        .find((s) => s && (s.textContent ?? '').includes('C 长文第 3 段'))
      return {
        found: true,
        list: list !== null,
        listMixedText: listTextBefore.includes('列表前文') && listTextBefore.includes('列表后文'),
        quote: quote !== null,
        quoteMixedText: (quote?.textContent ?? '').includes('引用前文') && (quote?.textContent ?? '').includes('引用后文'),
        childCards: childCards.length,
        longScrollCapped: longScroll ? longScroll.clientHeight <= 481 : false,
        longScrollOverflow: longScroll ? longScroll.scrollHeight > longScroll.clientHeight : false,
      }
    })
    assert.ok(structure.found, 'RC1 B 卡在场')
    assert.ok(structure.list && structure.listMixedText, `RC1 B 卡内列表结构保真且混排前后文在（实际 ${JSON.stringify(structure)}）`)
    assert.ok(structure.quote && structure.quoteMixedText, 'RC1 B 卡内引用结构保真且混排前后文在')
    assert.equal(structure.childCards, 2, `RC1 卡内两枚 C 递归升级挂载（实际 ${structure.childCards}）`)
    assert.ok(structure.longScrollCapped && structure.longScrollOverflow,
      `RC1 C 长文卡限高且可滚（实际 ${JSON.stringify(structure)}）`)
    // 滚轮在 C 卡上先滚 C 内层（最内层优先——#244 接续语义在表格链路的组合）
    const wheelState = await page.evaluate(() => {
      const bCard = [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .find((c) => (c.textContent ?? '').includes('B 表内目标'))
      const cScroll = [...(bCard?.querySelectorAll('.vsidian-embed-card-scroll') ?? [])]
        .find((s) => (s.textContent ?? '').includes('C 长文第 3 段'))
      cScroll?.scrollIntoView({ block: 'center' })
      return cScroll ? { top: cScroll.getBoundingClientRect().top, clientHeight: cScroll.clientHeight } : null
    })
    assert.ok(wheelState, 'RC1 C 卡滚动区在场')
    await page.waitForTimeout(80)
    const innerBefore = await page.evaluate(() => {
      const bCard = [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .find((c) => (c.textContent ?? '').includes('B 表内目标'))
      const cScroll = [...(bCard?.querySelectorAll('.vsidian-embed-card-scroll') ?? [])]
        .find((s) => (s.textContent ?? '').includes('C 长文第 3 段'))
      return cScroll ? cScroll.scrollTop : -1
    })
    await page.mouse.move(300, wheelState.top + 60)
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, 200)
      await page.waitForTimeout(40)
    }
    const innerAfter = await page.evaluate(() => {
      const bCard = [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .find((c) => (c.textContent ?? '').includes('B 表内目标'))
      const cScroll = [...(bCard?.querySelectorAll('.vsidian-embed-card-scroll') ?? [])]
        .find((s) => (s.textContent ?? '').includes('C 长文第 3 段'))
      return cScroll ? cScroll.scrollTop : -1
    })
    assert.ok(innerAfter > innerBefore && innerAfter > 0,
      `RC1 滚轮在 C 卡上先滚 C 内层（${innerBefore} → ${innerAfter}）`)
    assert.equal(await page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length), 0, 'RC1 零写回')
    assert.deepEqual(errors, [], `RC1 无页面错误（实际 ${JSON.stringify(errors)}）`)
    await page.close()
  }
  passed++
  console.log('[引用组合][PASS] RC1 表格×容器混排递归×长文：B 身份子请求 + 结构保真 + C 限高 + 滚轮最内优先')

  // ============ RC2 同行多引用 × 多 range × IME ============
  const RC2_DOC = [
    '# RC2 组合', '',
    '前 ![[甲目标]] 中 ![[乙目标\\|e]] 后 ![[丙目标]] 尾',
    '',
  ].join('\n')
  const SHORT = (n) => [`# ${n} 标题`, '', `${n} 正文一段。`, ''].join('\n')
  {
    const { page, errors } = await setupPage(RC2_DOC)
    await page.evaluate(() => window.focusLiveEmbed())
    const text = () => page.evaluate(() => window.liveEmbedDocText())
    const reveals = () => page.evaluate(() => window.liveEmbedRevealStates())
    const doc0 = await text()
    const jiaAt = doc0.indexOf('![[甲目标]]')
    const bingAt = doc0.indexOf('![[丙目标]]')
    // 双 range：甲区间内 + 丙区间内（乙不命中）——任一命中即显形语义
    await page.evaluate(([a1, a2, b1, b2]) => window.setLiveRanges([[a1, a2], [b1, b2]]),
      [jiaAt + 3, jiaAt + 6, bingAt + 3, bingAt + 6])
    await page.waitForTimeout(100)
    let states = await reveals()
    // inner 形态按实现细节容错（普通行别名 occurrence 的表 inner 保留 \|
    // 原文，表格格内路径为解码 inner——显隐语义才是断言目标）
    const byInner = (part) => states.find((x) => x.inner.split('\\|').join('|').includes(part))
    assert.equal(byInner('甲目标')?.revealed, true, 'RC2 甲被 range 命中显形')
    assert.equal(byInner('丙目标')?.revealed, true, 'RC2 丙被 range 命中显形')
    assert.equal(byInner('乙目标|e')?.revealed, false, 'RC2 乙未被命中保持隐藏')
    // 真实 IME 编辑乙 inner（未命中枚）：组合「多 range 显形态 × IME 编辑」
    const yiAt = (await text()).indexOf('![[乙目标\\|e]]')
    await page.evaluate((p) => window.setLiveCursor(p + 5), yiAt)
    await page.waitForTimeout(80)
    states = await reveals()
    assert.equal(states.find((x) => x.inner.split('\\|').join('|').includes('乙目标|e'))?.revealed, true,
      'RC2 光标进乙区间显形（编辑前提）')
    const edits0 = await page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '添', selectionStart: 1, selectionEnd: 1 })
    await page.waitForTimeout(60)
    await cdp.send('Input.insertText', { text: '添' })
    await page.waitForTimeout(180)
    const afterIme = await text()
    assert.ok(afterIme.includes('![[乙目添标\\|e]]'),
      `RC2 IME 编辑乙 inner（实际 ${afterIme.split('\n')[2] ?? ''}）`)
    assert.ok(afterIme.includes('前 ![[甲目标]]') && afterIme.includes('后 ![[丙目标]] 尾'),
      'RC2 甲丙不受 IME 编辑牵连')
    const newReqs = (await page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))).filter((r) => r.target.includes('乙目添标'))
    assert.ok(newReqs.length >= 1, 'RC2 新目标装载请求在途')
    const edits1 = await page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length)
    assert.equal(edits1, edits0 + 1, `RC2 IME 编辑恰一笔写（实际 ${edits1 - edits0}）`)
    assert.deepEqual(errors, [], `RC2 无页面错误（实际 ${JSON.stringify(errors)}）`)
    await page.close()
  }
  passed++
  console.log('[引用组合][PASS] RC2 同行三引用×多 range 双显×IME 编辑未命中枚')

  // ============ RC3 快速目标切换 × 乱序回包 × 旧回包守卫 ============
  const RC3_DOC = [
    '# RC3 组合', '',
    '![[慢目标]]',
    '',
    '![[快目标]]',
    '',
  ].join('\n')
  {
    const { page, errors } = await setupPage(RC3_DOC)
    const requests = () => page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'hover.request'))
    const reqs = await requests()
    const slow = reqs.find((r) => r.target === '慢目标')
    const fast = reqs.find((r) => r.target === '快目标')
    assert.ok(slow && fast, 'RC3 两目标请求在途')
    // 乱序：先应答快、后应答慢（reqId/instanceId 各自配对）
    await respond(page, fast, '# 快目标标题\n\n快目标正文。\n', 'D:\\notes\\快目标.md', '快目标.md')
    await page.waitForTimeout(120)
    await respond(page, slow, '# 慢目标标题\n\n慢目标正文。\n', 'D:\\notes\\慢目标.md', '慢目标.md')
    await page.waitForTimeout(200)
    const afterReorder = await page.evaluate(() =>
      [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .map((c) => ({
          fast: (c.textContent ?? '').includes('快目标正文'),
          slow: (c.textContent ?? '').includes('慢目标正文'),
          cross: (c.textContent ?? '').includes('快目标') && (c.textContent ?? '').includes('慢目标'),
        })))
    assert.equal(afterReorder.length, 2, `RC3 两卡装配（实际 ${afterReorder.length}）`)
    assert.equal(afterReorder.filter((c) => c.fast).length, 1, 'RC3 快目标卡装载快内容')
    assert.equal(afterReorder.filter((c) => c.slow).length, 1, 'RC3 慢目标卡装载慢内容')
    assert.ok(!afterReorder.some((c) => c.cross), `RC3 乱序回包零交叉污染（实际 ${JSON.stringify(afterReorder)}）`)
    // 旧回包守卫：文档变更使慢目标变更为「新慢目标」，旧回包（新 reqId 之前
    // 的过期实例）迟到不得应用——以已装载卡不被旧内容覆盖为准
    const docNow = () => page.evaluate(() => window.liveEmbedDocText())
    const at = (await docNow()).indexOf('![[慢目标]]')
    await page.evaluate(({ offset }) => window.respondLiveEmbed({
      kind: 'doc.changed', version: 8, origin: 'external',
      changes: [{ offset, length: '![[慢目标]]'.length, text: '![[新慢目标]]' }],
    }), { offset: at })
    await page.waitForTimeout(250)
    const newReq = (await requests()).find((r) => r.target === '新慢目标')
    assert.ok(newReq, 'RC3 变更后新目标请求在途')
    // 用「旧实例 id」发送旧内容回包（模拟迟到旧回包）
    await page.evaluate(({ reqId, instanceId }) => window.respondLiveEmbed({
      kind: 'hover.result', reqId, instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\慢目标.md', relPath: '慢目标.md' },
      version: 2, text: '# 旧内容不应出现\n\n旧正文污染。\n',
      range: { start: 0, end: 20 }, scope: { kind: 'full' },
    }), { reqId: slow.reqId, instanceId: slow.instanceId })
    await page.waitForTimeout(250)
    const polluted = await page.evaluate(() =>
      [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .some((c) => (c.textContent ?? '').includes('旧内容不应出现')))
    assert.equal(polluted, false, 'RC3 迟到旧回包被身份守卫丢弃（零污染）')
    // 新目标正常回包装载
    await respond(page, newReq, '# 新慢目标标题\n\n新慢目标正文。\n', 'D:\\notes\\新慢目标.md', '新慢目标.md')
    await page.waitForTimeout(200)
    const newLoaded = await page.evaluate(() =>
      [...document.querySelectorAll('.vsidian-live-embed .vsidian-embed-card')]
        .some((c) => (c.textContent ?? '').includes('新慢目标正文')))
    assert.equal(newLoaded, true, 'RC3 新目标正常装载')
    assert.equal(await page.evaluate(() =>
      window.liveEmbedSent().filter((m) => m.kind === 'edit.request').length), 0, 'RC3 零写回')
    assert.deepEqual(errors, [], `RC3 无页面错误（实际 ${JSON.stringify(errors)}）`)
    await page.close()
  }
  passed++
  console.log('[引用组合][PASS] RC3 快速切换×乱序回包零交叉×旧回包身份守卫')
} finally {
  await browser.close()
}
console.log(`refCombination: ${passed} scenarios passed`)
