// 双链联想候选浏览器回归（#376 T01 + #378 T03）：真实键盘/CDP IME 驱动
// 生产控制器，宿主侧由夹具扮演（wikilink.query → wikilink.query.result 回灌）。
// T01 覆盖：连续两个 [ 出候选（空查询无高亮）、有查询自动高亮首项、方向键
// 移动高亮不动光标、Enter/Tab 确认插入相对路径+默认别名并关浮层、Esc 关闭、
// 移出字段关闭、无结果状态行且 Enter 落穿、迟到响应拒收、无工作区真实状态、
// IME 组合期候选不确认、多 range 不接管。
// T03 覆盖：Esc 后二次触发矩阵（纯移动/编辑显示文字不重开，目标区修改才
// 重开且查询取光标左侧）、#／^／| 真实键盘转阶段（高亮补全/无高亮保留、
// 已有 # 只补 ^）、标题/块占位文案与不可确认（Tab 落穿围栏越界零写回）、
// | 进显示文字（新链接留空、已有别名保留）、组合期 # 不转阶段。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/wikilinkSuggest.js')
const katexFontStrip = {
  name: 'katex-font-fallback-strip',
  setup(b) {
    b.onLoad({ filter: /katex\.min\.css$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(
        /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\((["']?)(?:woff|truetype)\1\)/g, ''),
      loader: 'css',
    }))
  },
}
const katexMinJs = {
  name: 'katex-min-js',
  setup(b) {
    b.onResolve({ filter: /^katex$/ }, () => ({
      path: path.resolve(root, 'node_modules/katex/dist/katex.min.js'),
    }))
  },
}
await build({ entryPoints: [path.join(root, 'test/browser/wikilinkSuggestFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// #94：状态行文案经 t() 取词——注入 zh-cn 语言岛（与 webview 首帧同路径）
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let total = 0

const fangan = (over = {}) => ({
  id: 'C:\\vault\\资料\\方案.md', name: '方案.md', dir: '资料', relPath: '资料/方案.md',
  insertPath: '../资料/方案.md', alias: '方案', mtimeMs: 1000, score: 0,
  labelHighlights: [], dirHighlights: [], ...over,
})
const tongzhi = (over = {}) => ({
  id: 'C:\\vault\\通知.md', name: '通知.md', dir: '', relPath: '通知.md',
  insertPath: '../通知.md', alias: '通知', mtimeMs: 2000, score: 0,
  labelHighlights: [], dirHighlights: [], ...over,
})

async function newPage() {
  const page = await browser.newPage()
  await page.setContent(`<!DOCTYPE html><html><body>${islandHtml}<div id="app"></div></body></html>`)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  return { page, errors }
}

/** 单场景执行器：打开页面、初始化文档、定位光标、执行步骤、断言终态 */
async function scenario(name, { doc, cursor }, run) {
  total++
  const { page, errors } = await newPage()
  try {
    await page.evaluate((text) => window.initDoc(text), doc)
    await page.click('.cm-content')
    if (cursor !== undefined) {
      await page.evaluate((offset) => window.locate(offset), cursor)
    }
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[双链联想][PASS] ${name}`)
  } catch (error) {
    console.log(`[双链联想][FAIL] ${name}: ${error.message}`)
    throw error
  } finally {
    await page.close()
  }
}

const read = (page) => page.evaluate(() => window.readEditor())
const popup = (page) => page.evaluate(() => window.readPopup())

try {
  // ---- 触发与初始高亮 ----
  await scenario('连续两个 [ 出现候选；空查询无高亮', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[')
    await page.keyboard.type('[')
    assert.equal((await read(page)).text, '[[]]', '自动补全成 [[]]')
    assert.equal(await page.evaluate(() => window.lastQuery()?.query), '', '空查询出站')
    await page.evaluate((items) => window.respondQuery(items), [fangan(), tongzhi()])
    const p = await popup(page)
    assert.equal(p.open, true, '候选浮层开启')
    assert.equal(p.itemCount, 2)
    assert.equal(p.activeIndex, null, '空查询不高亮')
    assert.deepEqual(p.names, ['方案.md', '通知.md'])
  })

  await scenario('有查询自动高亮首项，目录区分同名文件', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    assert.equal(await page.evaluate(() => window.lastQuery()?.query), '方')
    const sameNamed = [
      fangan({ labelHighlights: [{ start: 0, end: 1 }] }),
      fangan({ id: 'C:\vault\old\方案.md', dir: 'old', relPath: 'old/方案.md', insertPath: '../old/方案.md' }),
    ]
    await page.evaluate((items) => window.respondQuery(items), sameNamed)
    const p = await popup(page)
    assert.equal(p.activeIndex, 0, '非空查询自动高亮首项')
    assert.deepEqual(p.names, ['方案.md', '方案.md'])
    assert.deepEqual(p.dirs, ['资料', 'old'])
  })

  await scenario('方向键移动高亮且不移动正文光标', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    await page.evaluate((items) => window.respondQuery(items), [fangan(), tongzhi()])
    const headBefore = (await read(page)).head
    await page.keyboard.press('ArrowDown')
    assert.equal((await popup(page)).activeIndex, 1, '↓ 移到第 2 项')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    assert.equal((await popup(page)).activeIndex, 0, '↑ 到首项后不再上移')
    assert.equal((await read(page)).head, headBefore, '正文光标不动')
  })

  // ---- 确认插入 ----
  await scenario('Enter 确认：插入来源相对路径与默认别名，关浮层', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    await page.keyboard.press('Enter')
    assert.equal((await read(page)).text, '[[../资料/方案.md|方案]]', '插入相对路径|默认别名')
    assert.equal((await read(page)).head, 2 + '../资料/方案.md'.length, '光标在别名分隔符之前')
    assert.equal((await popup(page)).open, false, '确认后浮层关闭')
    assert.equal(await page.evaluate(() => window.queryCount()), 2, '确认本身不再触发查询')
  })

  await scenario('Tab 确认：替换整个文件字段、保留已有显示文字', { doc: '', cursor: 0 }, async (page) => {
    // 先手写完整链接 [[方案.md|手写]]，再回到文件段中部编辑目标并 Tab 确认
    await page.keyboard.type('[[')
    await page.evaluate(() => window.respondQuery([]))
    await page.keyboard.type('方案.md|手写')
    assert.equal((await read(page)).text, '[[方案.md|手写]]')
    assert.equal((await popup(page)).open, false, '显示文字区无候选')
    // 光标落到文件段中部（「.」「m」之间）：纯移动不重开，键入才再触发
    await page.evaluate((offset) => window.locate(offset), 5)
    await page.keyboard.type('x')
    const q = await page.evaluate(() => window.lastQuery())
    assert.equal(q.query, '方案.x', '再触发自动取光标左侧目标输入')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    await page.keyboard.press('Tab')
    assert.equal((await read(page)).text, '[[../资料/方案.md|手写]]', '文件字段整体替换、显示文字保留')
    assert.equal((await popup(page)).open, false)
  })

  // ---- 关闭路径 ----
  await scenario('Esc 关闭候选不改正文', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    await page.keyboard.press('Escape')
    assert.equal((await popup(page)).open, false)
    assert.equal((await read(page)).text, '[[]]')
    assert.equal((await read(page)).head, 2)
  })

  await scenario('键入 | 进入显示文字：候选关闭、保留原输入', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    await page.keyboard.type('|')
    assert.equal((await read(page)).text, '[[|]]', '无高亮确认语义（T01）：| 原样输入')
    assert.equal((await popup(page)).open, false, '移出文件字段即关闭')
  })

  // ---- 真实状态与落穿 ----
  await scenario('无结果状态行；Enter 落穿（候选不吞键）', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.evaluate(() => window.respondQuery([]))
    const p = await popup(page)
    assert.equal(p.open, true)
    assert.equal(p.itemCount, 0)
    assert.match(p.statusText, /没有匹配的文件|No matching files/)
    const textBefore = (await read(page)).text
    await page.keyboard.press('Enter')
    assert.notEqual((await read(page)).text, textBefore, '无可确认项时 Enter 落穿默认换行')
    assert.equal((await popup(page)).open, false, '换行使围栏失效、候选关闭')
  })

  await scenario('索引未就绪显示真实状态、允许手写', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.evaluate(() => window.respondUnavailable('not-ready'))
    const p = await popup(page)
    assert.equal(p.open, true)
    assert.match(p.statusText, /索引准备中|Index is being prepared/)
    await page.keyboard.type('方案')
    assert.equal((await read(page)).text, '[[方案]]', '状态不阻塞手写')
  })

  await scenario('迟到响应拒收（旧 reqId 的应答不覆盖新状态）', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    assert.equal(await page.evaluate(() => window.queryCount()), 1)
    // 键入新字符触发代次 +1 的第二个查询
    await page.keyboard.type('方')
    assert.equal(await page.evaluate(() => window.queryCount()), 2)
    // 以过期 reqId/generation 回灌：必须被守卫拒收（候选保持加载态、不显示旧结果）
    const latest = await page.evaluate(() => ({
      reqId: window.lastQuery().reqId, generation: window.lastQuery().generation,
    }))
    await page.evaluate(({ reqId, generation, item }) => {
      window.respondStale(reqId, generation, [item])
    }, { reqId: latest.reqId - 1, generation: latest.generation - 1, item: fangan() })
    const staleState = await popup(page)
    assert.equal(staleState.itemCount, 0, '过期应答不进候选')
    // 最新查询正常应答
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    assert.equal((await popup(page)).itemCount, 1)
  })

  // ---- #377 T02 分页与清单代次 ----
  await scenario('触底 ↓ 续页加载：offset 出站、条目追加、高亮与 more 状态行', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    await page.evaluate((items) => window.respondQuery(items, { total: 3, catalogGen: 7 }), [fangan(), tongzhi()])
    let p = await popup(page)
    assert.equal(p.itemCount, 2, '首屏 2 条')
    assert.match(p.statusText, /还有 1 项|1 more/, 'more 状态行提示剩余数')
    // 高亮移到末项后再 ↓：触发续页（offset=2 出站）
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    assert.equal((await popup(page)).activeIndex, 1, '高亮在末项')
    await page.keyboard.press('ArrowDown')
    const more = await page.evaluate(() => window.lastQuery())
    assert.equal(more.offset, 2, '续页请求 offset=2')
    assert.equal(more.query, '方', '同查询续页')
    assert.equal(more.generation >= 1, true, '代次不重置')
    const third = {
      id: 'C:\\vault\\翻新.md', name: '翻新.md', dir: '', relPath: '翻新.md',
      insertPath: '../翻新.md', alias: '翻新', mtimeMs: 3000, score: 0,
      labelHighlights: [], dirHighlights: [],
    }
    await page.evaluate((items) => window.respondQuery(items, { total: 3, catalogGen: 7 }), [third])
    p = await popup(page)
    assert.equal(p.itemCount, 3, '追加页拼接后 3 条')
    assert.deepEqual(p.names, ['方案.md', '通知.md', '翻新.md'])
    assert.equal(p.activeIndex, 1, '手动高亮保持在末项原位置（不跳首项）')
    // 全部加载完成后 more 行消失
    assert.equal((await popup(page)).statusText === null || !/还有|more/.test(p.statusText ?? ''), true, '总数尽后无 more 行')
    await page.keyboard.press('ArrowDown')
    assert.equal((await popup(page)).activeIndex, 2, '后续 ↓ 恢复移动高亮')
  })

  await scenario('跨清单代次的追加页不拼接：重取首页', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    await page.evaluate((items) => window.respondQuery(items, { total: 3, catalogGen: 7 }), [fangan(), tongzhi()])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown') // 触底触发续页
    assert.equal(await page.evaluate(() => window.lastQuery()?.offset), 2)
    // 清单代次已变（7 → 8）：追加页必须被拒拼，并按新代次重取首页
    await page.evaluate((items) => window.respondQuery(items, { total: 3, catalogGen: 8 }),
      [fangan(), tongzhi()])
    const refetch = await page.evaluate(() => window.lastQuery())
    assert.equal(refetch.offset, undefined, '重取首页（无 offset）')
    assert.equal((await popup(page)).itemCount, 2, '旧追加结果未进候选')
    // 新首页应答正常呈现
    await page.evaluate((items) => window.respondQuery(items, { total: 2, catalogGen: 8 }), [fangan()])
    const p = await popup(page)
    assert.equal(p.itemCount, 1)
    assert.equal(p.activeIndex, 0, '首页响应恢复自动高亮首项')
  })

  await scenario('续页请求在途时触底 ↓ 不重复出站', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    await page.evaluate((items) => window.respondQuery(items, { total: 5, catalogGen: 1 }), [fangan(), tongzhi()])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown') // 触发续页
    const countAfterTrigger = await page.evaluate(() => window.queryCount())
    await page.keyboard.press('ArrowDown') // 在途再按
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(() => window.queryCount()), countAfterTrigger, '在途不重复发')
    assert.equal(await page.evaluate(() => window.lastQuery()?.offset), 2, '仍等待 offset=2 应答')
  })

  // ---- #377 T02 候选失效信号 ----
  await scenario('invalidate 广播：会话在场去抖重发当前查询并整体替换结果', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.keyboard.type('方')
    await page.evaluate((items) => window.respondQuery(items, { catalogGen: 3 }), [fangan()])
    assert.equal((await popup(page)).itemCount, 1)
    const countBefore = await page.evaluate(() => window.queryCount())
    // 失效信号：去抖 300ms 后重发同查询（新 reqId）
    await page.evaluate(() => window.sendInvalidate())
    await page.waitForFunction((n) => window.queryCount() === n + 1, countBefore)
    const requery = await page.evaluate(() => window.lastQuery())
    assert.equal(requery.query, '方', '同查询重发')
    assert.equal(requery.offset, undefined, '失效重查取首页')
    // 新结果整体替换（清单已变——新代次新候选集合）
    await page.evaluate((items) => window.respondQuery(items, { catalogGen: 4 }), [tongzhi()])
    const p = await popup(page)
    assert.deepEqual(p.names, ['通知.md'], '结果整体替换不残留旧候选')
    assert.equal(p.activeIndex, 0, '重查恢复自动高亮首项')
  })

  await scenario('invalidate 无会话时零动作（不出站查询）', { doc: '', cursor: 0 }, async (page) => {
    await page.evaluate(() => window.sendInvalidate())
    assert.equal(await page.evaluate(() => window.queryCount()), 0)
  })

  // ---- IME 与多光标 ----
  // CDP 组合实测：组合文本进 CM6 文档并触发查询（候选随组合更新、会话
  // 存活）；组合期 Enter 不确认候选（无插入路径写入正文）。组合期带可确认
  // 高亮的 Enter 守卫由控制器 compositionStarted 条件承担，真实 IME 手感
  // 归人工验证清单。
  await scenario('IME 组合期：候选保持可用且 Enter 不确认候选', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[')
    await page.evaluate((items) => window.respondQuery(items), [])
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '方', selectionStart: 4, selectionEnd: 4 })
    await page.waitForFunction(() => window.queryCount() >= 2)
    const p = await popup(page)
    assert.equal(p.open, true, '组合期候选会话存活（查询随组合更新）')
    await page.keyboard.press('Enter')
    const after = await read(page)
    assert.equal(after.text.includes('../资料/方案.md'), false, '组合期 Enter 未确认候选（无插入路径写入）')
    assert.equal(after.text.includes('\n'), true, '无可确认项时 Enter 落穿默认行为')
    assert.equal((await popup(page)).open, false, '换行破坏围栏后候选关闭')
  })

  await scenario('多 range 不接管（不出候选、不出站查询）', { doc: 'abc\ndef', cursor: 2 }, async (page) => {
    await page.evaluate(() => window.setTwoCursors(2, 6))
    const queriesBefore = await page.evaluate(() => window.queryCount())
    await page.keyboard.type('[')
    await page.keyboard.type('[')
    assert.equal(await page.evaluate(() => window.queryCount()), queriesBefore, '多 range 不出站查询')
    assert.equal((await popup(page)).open, false)
  })

  await scenario('行内代码上下文不出候选', { doc: '` `', cursor: 2 }, async (page) => {
    await page.keyboard.type('[')
    await page.keyboard.type('[')
    assert.equal(await page.evaluate(() => window.queryCount()), 0, '代码上下文不触发')
    assert.equal((await popup(page)).open, false)
  })

  // ---- #378 T03：Esc 后二次触发矩阵 ----
  await scenario('Esc 后纯光标移动与显示文字编辑不重开；目标区修改才重开且查询取左侧', { doc: '[[Aa|B]]', cursor: 3 }, async (page) => {
    // 目标区中部输入触发：查询为光标左侧（A + 新输入 x）
    await page.keyboard.type('x')
    assert.equal(await page.evaluate(() => window.lastQuery()?.query), 'Ax')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    assert.equal((await popup(page)).open, true)
    // Esc 关闭；移动光标（字段内各处/围栏外再回来）不重开、不出站
    await page.keyboard.press('Escape')
    assert.equal((await popup(page)).open, false)
    const countAfterEsc = await page.evaluate(() => window.queryCount())
    await page.evaluate((offset) => window.locate(offset), 2)
    await page.evaluate((offset) => window.locate(offset), 4)
    assert.equal(await page.evaluate(() => window.queryCount()), countAfterEsc, '纯移动不重开')
    // 显示文字 B 编辑不触发
    await page.evaluate((offset) => window.locate(offset), 6)
    await page.keyboard.type('y')
    assert.equal((await read(page)).text, '[[Axa|yB]]')
    assert.equal(await page.evaluate(() => window.queryCount()), countAfterEsc, '显示文字编辑不触发')
    assert.equal((await popup(page)).open, false)
    // 返回目标区删除才重开；查询仍为光标左侧（Axa）
    await page.evaluate((offset) => window.locate(offset), 6)
    await page.keyboard.press('Backspace')
    assert.equal(await page.evaluate(() => window.lastQuery()?.query), 'Axa', '再触发查询取光标左侧')
  })

  // ---- #378 T03：# / ^ 转阶段（真实键盘字符键） ----
  await scenario('高亮文件后 # 直接转标题占位：补全相对路径、占位提示、不出站标题查询', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[方案')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    const before = await page.evaluate(() => window.queryCount())
    await page.keyboard.press('#')
    const after = await read(page)
    assert.equal(after.text, '[[../资料/方案.md#]]', '补全文件并加 #')
    assert.equal(after.head, '[[../资料/方案.md#'.length, '光标在 # 后')
    const p = await popup(page)
    assert.equal(p.open, true, '占位会话在场')
    assert.equal(p.itemCount, 0, '占位不是候选')
    assert.match(p.statusText, /输入小标题|Type a heading/, '标题占位提示（i18n）')
    assert.equal(await page.evaluate(() => window.queryCount()), before, '转阶段不出站标题查询')
  })

  await scenario('无高亮按 #：不补文件名，保留原输入进入标题占位', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[方')
    await page.evaluate(() => window.respondQuery([]))
    await page.keyboard.press('#')
    const after = await read(page)
    assert.equal(after.text, '[[方#]]', '保留原输入')
    assert.equal(after.head, '[[方#'.length)
    assert.match((await popup(page)).statusText, /输入小标题|Type a heading/)
  })

  await scenario('高亮文件后 ^ 一次形成 #^ 转块占位；标题占位再按 ^ 不重复补 #', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[方案')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    await page.keyboard.press('^')
    const after = await read(page)
    assert.equal(after.text, '[[../资料/方案.md#^]]', '补全文件一次形成 #^')
    assert.equal(after.head, '[[../资料/方案.md#^'.length, '光标在 ^ 后')
    const p = await popup(page)
    assert.match(p.statusText, /输入块 ID|Type a block ID/, '块占位提示（i18n）')
    // 继续按 ^：块阶段不接管——真实键盘落穿会把 ^ 作为普通文本插入
    await page.keyboard.press('^')
    assert.equal((await read(page)).text, '[[../资料/方案.md#^^]]', '块阶段 ^ 落穿普通输入')
  })

  await scenario('标题占位下按 ^ 只补 ^（已有 # 不重复补）', { doc: '[[方案.md#]]', cursor: 8 }, async (page) => {
    // 锚点字段输入触发占位会话
    await page.keyboard.type('x')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('^')
    const after = await read(page)
    assert.equal(after.text, '[[方案.md#^]]', '只补 ^ 不重复补 #')
    assert.equal(after.head, '[[方案.md#^'.length)
    assert.match((await popup(page)).statusText, /输入块 ID|Type a block ID/)
  })

  await scenario('空双链按 # / ^：不补文件名，进入对应占位（空目标不猜文档）', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[')
    await page.keyboard.type('[')
    await page.evaluate(() => window.respondQuery([]))
    await page.keyboard.press('#')
    assert.equal((await read(page)).text, '[[#]]', '空目标 # 不补文件名')
    assert.match((await popup(page)).statusText, /输入小标题|Type a heading/)
    await page.keyboard.press('Escape')
    await page.keyboard.type('x')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('^')
    assert.equal((await read(page)).text, '[[#^]]', '空目标 ^ 形成空块字段、不写占位词')
    assert.match((await popup(page)).statusText, /输入块 ID|Type a block ID/)
  })

  // ---- #378 T03：| 进显示文字 ----
  await scenario('高亮文件后 |：补全目标、显示文字留空、关闭候选，光标在 | 后', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[[方案.md')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    await page.keyboard.press('|')
    const after = await read(page)
    assert.equal(after.text, '[[../资料/方案.md|]]', '新链接 | 显示文字留空')
    assert.equal(after.head, '[[../资料/方案.md|'.length, '光标在 | 后等待手动输入')
    assert.equal((await popup(page)).open, false, '进显示文字关闭候选')
  })

  await scenario('无高亮按 |：保留原输入关候选；已有 | 复用跳转、已有别名保留', { doc: '[[Aa|B]]', cursor: 4 }, async (page) => {
    await page.keyboard.type('x')
    await page.evaluate(() => window.respondQuery([]))
    await page.keyboard.press('Backspace')
    await page.keyboard.press('|')
    const after = await read(page)
    assert.equal(after.text, '[[Aa|B]]', '已有 | 零编辑、别名 B 保留')
    assert.equal(after.head, 5, '光标跳到已有 | 后')
    assert.equal((await popup(page)).open, false)
  })

  // ---- #378 T03：占位不可确认（Tab 落穿围栏越界零写回） ----
  await scenario('块占位下 Tab 落穿围栏两步越界零写回；Enter 落穿换行后关闭', { doc: '[[方案.md#^id]]', cursor: 11 }, async (page) => {
    await page.keyboard.type('x')
    await page.keyboard.press('Backspace')
    assert.match((await popup(page)).statusText, /输入块 ID|Type a block ID/)
    const textBefore = (await read(page)).text
    // Tab：块阶段无可确认项——落穿 fenceEscape 两步越界，纯选区移动零写回；
    // 第一步即移出锚点字段（光标进入闭围栏），候选随之关闭（移出目标字段）
    await page.keyboard.press('Tab')
    const afterTab = await read(page)
    assert.equal(afterTab.text, textBefore, 'Tab 落穿零写回')
    assert.equal(afterTab.head, 12, 'Tab 第一步：进入闭围栏内边界')
    assert.equal((await popup(page)).open, false, '移出锚点字段后候选关闭')
    await page.keyboard.press('Tab')
    const afterTab2 = await read(page)
    assert.equal(afterTab2.text, textBefore, '第二步仍零写回')
    assert.equal(afterTab2.head, textBefore.length, 'Tab 第二步：越出闭围栏')
    // Enter：落穿默认换行——围栏跨行破坏，候选关闭
    await page.keyboard.type('x') // 移回块字段（越出后目标区输入重开）
    await page.keyboard.press('Enter')
    const afterEnter = await read(page)
    assert.equal(afterEnter.text.includes('../资料/方案.md'), false, '占位不可确认')
    assert.equal(afterEnter.text.includes('\n'), true, 'Enter 落穿默认换行')
    assert.equal((await popup(page)).open, false, '换行破坏围栏后关闭')
  })

  // ---- #378 T03：IME 组合期 # 不转阶段 ----
  await scenario('IME 组合期 # 不转阶段（组合期按键不消费）', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[')
    await page.keyboard.type('[')
    await page.evaluate((items) => window.respondQuery(items), [fangan()])
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '方', selectionStart: 4, selectionEnd: 4 })
    await page.waitForFunction(() => window.queryCount() >= 2)
    await page.keyboard.press('#')
    const after = await read(page)
    assert.equal(after.text.includes('../资料/方案.md#'), false, '组合期 # 未执行转阶段')
    assert.equal(after.text.includes('\n'), false, '组合期无换行副作用')
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
  })
} finally {
  await browser.close()
}

console.log(`双链联想浏览器回归：${passed}/${total} 通过`)
if (passed !== total) {
  process.exitCode = 1
}
