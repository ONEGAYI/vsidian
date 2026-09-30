// 选下一处相同词（#238）浏览器回归：真实键盘路径（Ctrl+D 连按、选项条
// 点击切换重建会话、Ctrl+K Ctrl+D 两段弦、Ctrl+Shift+L 全选与多光标编辑
// 回流、Esc 两段层级——先关选项条后收敛多选区）驱动生产控制器验证；
// 选项条非模态（在场时焦点仍在编辑器）与 drawSelection 副选区绘制可见
// 为断言依据。明暗主题各跑一遍。与 findPanel.mjs 同口径。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'occurrence/main.js')
// 与 findPanel.mjs 同口径：katex css 裁掉 woff/ttf 字体引用
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
await build({ entryPoints: [path.join(root, 'test/browser/occurrenceFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml } = await buildZhLocaleIsland(root)

/** 等待观测满足谓词（轮询到落定） */
async function wait(page, evaluate, pred, label) {
  const deadline = Date.now() + 4000
  let last = null
  while (Date.now() < deadline) {
    last = await evaluate()
    if (pred(last)) return last
    await page.waitForTimeout(50)
  }
  throw new Error(`等待超时：${label}，最后观测 ${JSON.stringify(last)}`)
}

const waitEditor = (page, pred, label) =>
  wait(page, () => page.evaluate(() => window.readEditor()), pred, label)
const waitBar = (page, pred, label) =>
  wait(page, () => page.evaluate(() => window.readOccurrenceBar()), pred, label)
/** drawSelection 的选区层绘制在 update 后的下一帧，paint 断言一律轮询 */
const waitPaint = (page, pred, label) =>
  wait(page, () => page.evaluate(() => window.readPaint()), pred, label)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(`<html lang="zh-CN"><body class="vscode-${theme}">${islandHtml}<div id="app"></div></body></html>`)
    await page.addStyleTag({ content: `:root { --vscode-font-family: sans-serif; --vscode-editor-background: ${theme === 'light' ? '#ffffff' : '#1e1e1e'}; --vscode-editor-foreground: ${theme === 'light' ? '#222222' : '#dddddd'}; }` })
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })

    // 文本布局：foo:0-3 / foo:8-11 / food:12-16（内含 foo:12-15）/
    // Foo:17-20 / foo:25-28。override 档（敏感+全字）命中 0-3/8-11/25-28
    await page.evaluate(() => window.initDoc('foo bar foo\nfood Foo bar\nfoo end'))
    await page.evaluate(() => window.locate(9)) // 光标置于第二个 foo 内
    await page.evaluate(() => window.focusEditor())

    // ---- 场景 1：Ctrl+D 种子选词（override 档），选项条直接打开且不抢焦点 ----
    await page.keyboard.press('Control+d')
    let editor = await waitEditor(page, (e) => e.ranges.length === 1 && e.ranges[0].from === 8,
      'Ctrl+D 首按选中光标所在词')
    let bar = await waitBar(page, (b) => b.open, '选项条随首次生效打开')
    assert.ok(bar.editorFocused, '选项条在场时焦点应仍在编辑器（非模态）')
    assert.equal(bar.case.pressed, 'false', '默认档三关：case 按钮 aria-pressed=false')

    // ---- 场景 2：连按追加（Foo 与 food 内 foo 不进候选——override 敏感+全字）----
    await page.keyboard.press('Control+d')
    editor = await waitEditor(page, (e) => e.ranges.length === 2 && e.ranges[1].from === 25,
      '第二次 Ctrl+D 追加 foo:25-28')
    await waitPaint(page, (p) => p.selectionCount === 2, 'drawSelection 副选区绘制在场（多光标可见性）')
    // 文档尾 wrap 回头部
    await page.keyboard.press('Control+d')
    editor = await waitEditor(page, (e) => e.ranges.length === 3 && e.ranges[0].from === 0,
      '第三次 Ctrl+D wrap 回 foo:0-3')
    // 全部命中已选：保持
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(150)
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.ranges.length, 3, '全占后 Ctrl+D 保持三处不加选')

    // ---- 场景 3：选项条点击切换（matchCase 关→开），会话按新档重建 ----
    const setBefore = await page.evaluate(() =>
      window.readHostMessages().filter((m) => m.kind === 'findOptions.set').length)
    await page.click('.vsidian-occurrence-case')
    bar = await waitBar(page, (b) => b.case.active && b.open, '点击后 case 点亮且条保持在场')
    assert.equal(bar.case.pressed, 'true', 'aria-pressed 随切换点亮')
    assert.ok(bar.editorFocused, '点击选项条后焦点应仍在编辑器（mousedown 保焦）')
    const setAfter = await page.evaluate(() =>
      window.readHostMessages().filter((m) => m.kind === 'findOptions.set').length)
    assert.equal(setAfter, setBefore + 1, '切换开关应出站一笔 findOptions.set')
    // 新档（matchCase 开 + wholeWord 关）：food 内 foo:12-15 是命中——wrap 加选
    await page.keyboard.press('Control+d')
    editor = await waitEditor(page, (e) => e.ranges.length === 4 && e.ranges.some((r) => r.from === 12),
      '切换后下一次 Ctrl+D 随动新档（非全字档 food 内 foo 进候选）')
    await waitPaint(page, (p) => p.selectionCount === 4, '四选区绘制在场')

    // ---- 场景 4：Esc 两段层级——先关选项条（选区保持），再收敛多选区 ----
    await page.keyboard.press('Escape')
    bar = await waitBar(page, (b) => !b.open, '第一次 Esc 只关选项条')
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.ranges.length, 4, '第一次 Esc 后多选区保持')
    await page.keyboard.press('Escape')
    editor = await waitEditor(page, (e) => e.ranges.length === 1, '第二次 Esc 经 CM6 收敛为单选区')

    // ---- 场景 5：Ctrl+K Ctrl+D 两段弦（真实键盘：种子 + 立即追加）----
    await page.evaluate(() => window.locate(9)) // 空光标回到第二个 foo
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+d')
    editor = await waitEditor(page, (e) => e.ranges.length === 2 && e.ranges[0].from === 8 && e.ranges[1].from === 25,
      '弦键位：种子选词并立即追加下一处')
    bar = await waitBar(page, (b) => b.open, '弦生效后选项条在场')

    // ---- 场景 6：Ctrl+Shift+L 全选 + 多光标编辑回流（一笔写回）----
    await page.evaluate(() => window.locate(9))
    await page.keyboard.press('Control+Shift+l')
    editor = await waitEditor(page, (e) => e.ranges.length === 3 && e.ranges.every((r) => r.to - r.from === 3),
      '全选三处相同词（override 全字档：Foo/food 不进）')
    await waitPaint(page, (p) => p.selectionCount === 3, '全选后三选区绘制在场')
    const editsBefore = await page.evaluate(() =>
      window.readHostMessages().filter((m) => m.kind === 'edit.request').length)
    await page.keyboard.type('bar')
    editor = await waitEditor(page, (e) => e.text === 'bar bar bar\nfood Foo bar\nbar end',
      '多光标键入逐选区替换三处')
    const editsAfter = await page.evaluate(() =>
      window.readHostMessages().filter((m) => m.kind === 'edit.request').length)
    assert.equal(editsAfter, editsBefore + 1, '多光标键入应恰一笔 edit.request')

    // ---- 场景 7：主查找面板打开时 Ctrl+D 不出选项条，闪烁面板开关 ----
    // 面板记忆档被场景 3 改为 matchCase=true——先点面板 Aa 复位三关
    //（findOptions.set 出站 + 宿主回环同步），使脱节断言回到确定基线
    await page.evaluate(() => window.locate(26)) // foo:25-28 内（'foo end'）
    await page.keyboard.press('Control+f')
    bar = await waitBar(page, (b) => b.findPanelOpen, 'Ctrl+F 打开主面板')
    if (await page.evaluate(() => window.readOccurrenceBar().case.pressed === 'true')) {
      await page.click('.vsidian-find .vsidian-find-case')
      // 面板按钮态由 findRender 即时同步（选项条此刻收起，其按钮态在
      // 下次显示时由 syncOccurrenceBarDom 统一刷新——关闭态无 UI 意义）
      await wait(page, () => page.evaluate(() =>
        document.querySelector('.vsidian-find .vsidian-find-case')
          ?.getAttribute('aria-pressed')), (p) => p === 'false',
      '面板 Aa 复位 matchCase 记忆档')
    }
    // 焦点在查找输入框：先归位编辑器（面板保持开——locate 不改面板）
    await page.evaluate(() => window.focusEditor())
    await page.evaluate(() => window.locate(26))
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(200)
    bar = await page.evaluate(() => window.readOccurrenceBar())
    assert.ok(!bar.open, '面板打开时选项条不出场')
    assert.equal(bar.findFlashCount, 2, 'override 档与面板显示脱节的 matchCase/wholeWord 两开关应闪烁')
    await page.keyboard.press('Escape') // 关面板

    assert.deepEqual(errors, [], '全程不得有页面错误')
    await page.close()
  }
  console.log('occurrence: 全部场景通过（light/dark）')
} finally {
  await browser.close()
}
