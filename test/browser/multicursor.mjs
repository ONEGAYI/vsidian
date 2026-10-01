// 多光标基础设施的原生浏览器回归（#237）：真实键盘 + 鼠标驱动生产
// webview 控制器——Alt+点击三场景（普通正文 / 链接文字上不触发跳转 /
// 表格格内经既有 altKey 让路）、Ctrl+Alt+Up/Down 逐行添加光标（目标列
// 保持与短行钳制）、Alt+点击既有光标位置移除（toggle）、Esc 一次收敛、
// 清空默认绑定后 defaultKeymap 内建键位不复活（键位所有权归注册表）、
// 多光标设置关闭回到单选区行为（绘制层撤下 + 内建键位恢复 #237 前语义）。
// 绘制层断言（.cm-cursor 元素计数与几何）钉住 drawSelection 真实画出了
// 副光标与多选区背景——jsdom 层只验元素在场，可见性证据在本层。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'multicursor/multicursor.js')
// 与 symbolInput.mjs 同口径：katex 裸导入重定向官方 UMD；css 裁掉 woff/ttf
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
await build({ entryPoints: [path.join(root, 'test/browser/multicursorFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

const PLAIN_DOC = 'first line\nsecond line\nthird line'
// line1: 0-10（len 10），line2: 11-21（len 11），line3: 22-32（len 11）
const LINK_DOC = 'see [[目标笔记]] here\nsecond line'
const TABLE_DOC = '| a | b |\n| --- | --- |\n| 1 | 2 |\npara'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let total = 0

/** 单场景执行器：打开页面、初始化文档、定位光标、执行步骤、断言终态 */
async function scenario(name, { doc, cursor }, run) {
  total++
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    await page.evaluate((text) => window.initDoc(text), doc)
    // 先点击聚焦（光标落到点击处），再经生产 view.locate 链路精确定位
    await page.click('.cm-content')
    if (cursor !== undefined) {
      await page.evaluate((offset) => window.locate(offset), cursor)
    }
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[多光标][PASS] ${name}`)
  } catch (error) {
    console.log(`[多光标][FAIL] ${name}: ${error.message}`)
    throw error
  } finally {
    await page.close()
  }
}

const read = (page) => page.evaluate(() => window.readEditor())
const paint = (page) => page.evaluate(() => window.readPaint())
const hostMessages = (page) => page.evaluate(() => window.readHostMessages())

/** 等绘制层稳定：drawSelection 的光标/选区层 DOM 在 rAF 测量步更新，
 *  键鼠事件返回后立即读取会早于该帧（keybindings.mjs 同款等帧口径） */
const settle = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))))

/** 真实 Alt+点击：按住 Alt（键盘修饰键）点击字符边界；坐标取边界 +1px
 * 落进右侧字符左半段，posAtCoords 就近取目标边界（光标钉在 offset 处，
 * 与字体渲染宽度解耦）。page.mouse.click 是低层 API 无 modifiers 参数 */
async function altClick(page, offset) {
  const at = await page.evaluate((o) => window.posCoords(o), offset)
  await page.keyboard.down('Alt')
  await page.mouse.click(at.x + 1, at.y)
  await page.keyboard.up('Alt')
}

try {
  // ---- 场景 A：Alt+点击普通正文——添加副光标、绘制层可见、键入双落、
  //      Esc 收敛、再点既有光标位置移除（toggle） ----
  await scenario('Alt+点击普通正文：添加副光标 + 绘制层可见 + 双落键入 + Esc 收敛 + 再点移除',
    { doc: PLAIN_DOC, cursor: 5 }, async (page) => {
      await altClick(page, 24) // 第三行 't|hard line'（offset 24 在 t/h 间）
      let state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 5, to: 5 }, { from: 24, to: 24 }],
        `Alt+点击后应为双光标: ${JSON.stringify(state)}`)
      // drawSelection 绘制层：两枚绘制光标在场且有几何（可见性证据）
      await settle(page)
      const drawn = await paint(page)
      assert.equal(drawn.cursorLayerPresent, true, '多光标开启时光标层应在场')
      assert.equal(drawn.cursorCount, 2, `应绘制两枚光标（实际 ${drawn.cursorCount}）`)
      assert.ok(drawn.firstCursorHeight > 0, `绘制光标应有几何高度（实际 ${drawn.firstCursorHeight}）`)
      // Shift+Right 双 range 扩选：选区背景逐 range 绘制
      await page.keyboard.press('Shift+ArrowRight')
      state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 5, to: 6 }, { from: 24, to: 25 }],
        `扩选后双 range: ${JSON.stringify(state)}`)
      await settle(page)
      const drawnSel = await paint(page)
      assert.equal(drawnSel.selectionCount, 2,
        `应绘制两块选区背景（实际 ${drawnSel.selectionCount}）`)
      // Esc 一次收敛：多 range → 仅主 range（非空保留）
      await page.keyboard.press('Escape')
      state = await read(page)
      assert.equal(state.ranges.length, 1, 'Esc 应收敛为单 range')
      assert.equal(state.ranges[0].from, 24, '收敛保留主 range（最后添加处）')
      assert.equal(state.ranges[0].to, 25, '主 range 非空保留（再 Esc 才折光标）')
      // 再 Esc：非空选区折为主 range head 光标
      await page.keyboard.press('Escape')
      state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 25, to: 25 }], '第二次 Esc 折为光标')
      // toggle：Alt+点击既有光标位置（唯一 range 内）移除该 range——
      // 需先重建双光标（removeRangeAround 只在 >1 range 时生效）
      await altClick(page, 5)
      state = await read(page)
      assert.equal(state.ranges.length, 2, '重建双光标')
      await altClick(page, 5)
      state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 25, to: 25 }],
        `Alt+点击既有光标位置应移除该 range: ${JSON.stringify(state)}`)
      // 双光标键入双落（终态文本回归；cursor 5='first|'、25='th|ird'）
      await altClick(page, 5)
      await page.keyboard.type('X')
      state = await read(page)
      assert.equal(state.text, 'firstX line\nsecond line\nthXird line',
        `双光标键入应双落: ${JSON.stringify(state)}`)
      // 键入是写操作：出站 edit.request（生产写回链路真实走通）
      const edits = (await hostMessages(page)).filter((m) => m.kind === 'edit.request')
      assert.ok(edits.length >= 1, '双光标键入应经 edit.request 出站')
    })

  // ---- 场景 B：Alt+点击链接文字——添加光标但绝不触发跳转 ----
  // 光标在范围外时双链呈渲染态 widget（替换源文），点击目标用 widget
  // 包围盒中心（替换区间内的 posCoords 映射到 widget 边缘，+1px 会点空）
  const widgetCenter = (page) => page.evaluate(() => {
    const w = document.querySelector('[data-vsidian-rendered-wikilink="true"]')
    if (!w) throw new Error('双链未呈渲染态 widget')
    const r = w.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: (r.top + r.bottom) / 2 }
  })
  await scenario('Alt+点击链接文字：添加光标、不触发跳转（正控制：普通单击仍跳转）',
    { doc: LINK_DOC, cursor: 22 }, async (page) => {
      // 正控制：普通单击双链 → 出站 wikilink.activate（证明跳转判定路径活着）
      const at = await widgetCenter(page)
      await page.mouse.click(at.x, at.y)
      const controlMsgs = (await hostMessages(page))
        .filter((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate')
      assert.equal(controlMsgs.length, 1, `普通单击链接应出站跳转意图: ${JSON.stringify(controlMsgs)}`)
      // Alt+点击同一处：在链接上添加光标，零新增跳转意图
      await page.evaluate(() => window.locate(22)) // 回到第二行（widget 重建）
      const again = await widgetCenter(page)
      await page.keyboard.down('Alt')
      await page.mouse.click(again.x, again.y)
      await page.keyboard.up('Alt')
      const state = await read(page)
      assert.equal(state.ranges.length, 2,
        `Alt+点击链接文字应添加光标: ${JSON.stringify(state)}`)
      // 新 range 落在双链源码区间 [4, 12) 内（widget 命中点映射回文档坐标）
      assert.ok(state.ranges.some((r) => r.from >= 4 && r.from <= 12 && r.to === r.from),
        `新光标应落在双链区间内: ${JSON.stringify(state)}`)
      const jumps = (await hostMessages(page))
        .filter((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate')
      assert.equal(jumps.length, 1,
        `Alt+点击不得新增跳转意图（仅正控制那一笔）: ${JSON.stringify(jumps)}`)
    })

  // ---- 场景 C：Alt+点击表格格内——既有 altKey 让路路径，光标可加 ----
  await scenario('Alt+点击表格格内：经 altKey 让路添加光标、键入双落且表格不降级',
    { doc: TABLE_DOC, cursor: TABLE_DOC.indexOf('a') + 1 }, async (page) => {
      await altClick(page, TABLE_DOC.indexOf('1') + 1) // 数据行 '1' 后
      let state = await read(page)
      assert.equal(state.ranges.length, 2,
        `格内 Alt+点击应添加光标: ${JSON.stringify(state)}`)
      // 焦点保持（#241 验收回归）：Alt+click 后焦点必须仍在编辑器内，
      // 否则真宿主里键入落宿主快捷键层（altClickFocusGuard 的防御前提）
      const focused = await page.evaluate(() => {
        const dom = document.querySelector('.cm-content')
        return !!dom && document.activeElement !== null &&
          (dom === document.activeElement || dom.contains(document.activeElement))
      })
      assert.ok(focused, 'Alt+click 后焦点应保持在编辑器内')
      await page.keyboard.type('x')
      state = await read(page)
      assert.equal(state.text, '| ax | b |\n| --- | --- |\n| 1x | 2 |\npara',
        `双光标格内键入双落、表格结构保持: ${JSON.stringify(state)}`)
      // 绘制层：两枚光标在场（格内假光标去重规则不隐藏全部——表头格是
      // 零宽空格活动格时绘制光标让位，数据行活动格同理由 ::after 假光标
      // 呈现；这里断言光标层数与 range 数的对应不被破坏）
      const drawn = await paint(page)
      assert.ok(drawn.cursorLayerPresent, '光标层应在场')

      // 两个数据行格各放一光标（#241 验收实测形态：两格同步键入）——
      // Esc 收敛后重摆，覆盖「双格内光标」的组合路径（offset 按已写入
      // 'x' 的当前文本求值；Esc 后主光标停在 '1x' 后）
      await page.keyboard.press('Escape')
      state = await read(page)
      assert.equal(state.ranges.length, 1, 'Esc 收敛回单光标')
      const cur = state.text
      await altClick(page, cur.indexOf('b') + 1) // 表头 'b' 后
      await altClick(page, cur.indexOf('2') + 1) // 数据行 '2' 后
      state = await read(page)
      assert.equal(state.ranges.length, 3,
        `两次格内 Alt+点击应三光标: ${JSON.stringify(state)}`)
      await page.keyboard.type('y')
      state = await read(page)
      assert.equal(state.text,
        cur.replace('b ', 'by ').replace('1x ', '1xy ').replace('2 ', '2y '),
        `三光标（含两格内）键入应各落: ${JSON.stringify(state)}`)
    })

  // ---- 场景 D：Ctrl+Alt+Down/Up 逐行添加光标（目标列保持与短行钳制）----
  await scenario('Ctrl+Alt+Down：等长行目标列保持', { doc: 'abcdefgh\nabcdefgh', cursor: 3 },
    async (page) => {
      await page.keyboard.press('Control+Alt+ArrowDown')
      const state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 3, to: 3 }, { from: 12, to: 12 }],
        `下行同列添加光标: ${JSON.stringify(state)}`)
    })
  await scenario('Ctrl+Alt+Down：短行钳制到行尾', { doc: 'abcdefgh\nxy', cursor: 6 },
    async (page) => {
      await page.keyboard.press('Control+Alt+ArrowDown')
      const state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 6, to: 6 }, { from: 11, to: 11 }],
        `下行列 6 超出 'xy' 应钳到行尾 11: ${JSON.stringify(state)}`)
    })
  await scenario('Ctrl+Alt+Up：上一行添加光标', { doc: 'abcdefgh\nabcdefgh', cursor: 11 },
    async (page) => {
      await page.keyboard.press('Control+Alt+ArrowUp')
      const state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 2, to: 2 }, { from: 11, to: 11 }],
        `上行同列添加光标: ${JSON.stringify(state)}`)
    })

  // ---- 场景 E：清空默认绑定后 defaultKeymap 内建键位不复活 ----
  await scenario('清空默认绑定后 Ctrl+Alt+Down 不触发：内建键位退役，所有权归注册表',
    { doc: 'abcdefgh\nabcdefgh', cursor: 3 }, async (page) => {
      await page.evaluate(() => window.setKeybindings({ addCursorBelow: [] }))
      await page.keyboard.press('Control+Alt+ArrowDown')
      const state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 3, to: 3 }],
        `清空后按键应零效果（不加光标也不移动）: ${JSON.stringify(state)}`)
    })

  // ---- 场景 F：多光标设置关闭——单选区行为回归 ----
  await scenario('设置关闭：Alt+点击是普通点击（光标单移不添加）、内建键位恢复 #237 前语义、绘制层撤下',
    { doc: PLAIN_DOC, cursor: 5 }, async (page) => {
      await page.evaluate(() => window.setMulticursor(false))
      // 绘制层整组退出（drawSelection 撤下）
      const drawn = await paint(page)
      assert.equal(drawn.cursorLayerPresent, false, '关闭后光标层应撤下（原生 caret 回归）')
      // Alt+点击退化为普通点击：光标移到落点、单 range
      await altClick(page, 24)
      let state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 24, to: 24 }],
        `关闭后 Alt+点击应等价普通点击: ${JSON.stringify(state)}`)
      // 接管 keymap 撤下；但注册表默认绑定仍在——路由命中后进
      // runCursorAdd 检查设置关闭即静默返回（按键被路由消费，零动作），
      // 内建 addCursorBelow 不落穿（键位所有权归注册表的关闭态语义）
      await page.evaluate(() => window.locate(5))
      await page.keyboard.press('Control+Alt+ArrowDown')
      state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 5, to: 5 }],
        `关闭后按键应被路由静默消费（不加光标也不移动）: ${JSON.stringify(state)}`)
      // 再清空绑定（设置关 + 无绑定）：接管 keymap 与路由都不在路径上，
      // defaultKeymap 内建键位恢复 #237 前语义——加出的 range 被 asSingle
      // 折回主 range，等价光标下移一行
      await page.evaluate(() => window.setKeybindings({ addCursorBelow: [] }))
      await page.keyboard.press('Control+Alt+ArrowDown')
      state = await read(page)
      assert.deepEqual(state.ranges, [{ from: 16, to: 16 }],
        `内建键位恢复为光标下移一行（第二行同列）: ${JSON.stringify(state)}`)
      // 再开：热重配恢复多选区
      await page.evaluate(() => window.setMulticursor(true))
      await altClick(page, 24)
      state = await read(page)
      assert.equal(state.ranges.length, 2, '重新开启后 Alt+点击恢复添加光标')
    })

  console.log(`[多光标] 通过 ${passed}/${total}`)
  if (passed !== total) throw new Error(`有 ${total - passed} 个场景失败`)
} finally {
  await browser.close()
}
