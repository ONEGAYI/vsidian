// 一次性诊断探针：代码块内拖选与 Shift+Arrow 是否失效（含普通正文对照）。
// 用法：node test/browser/probeCodeblock.mjs  —— 输出各项判定（不进套件）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'probe-codeblock/main.js')

await build({ entryPoints: [path.join(root, 'test/browser/probeCodeblockFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)

const DOC = [
  '普通正文段落 alpha beta。',          // 对照组：正文
  '',                                    // 0..13
  '```js',                               // fence 起
  'const a = 1;',                        // 代码行 1
  'const b = 2;',                        // 代码行 2
  '```',                                 // fence 止
  '',
].join('\n')
const codeLine1 = DOC.indexOf('const a')
const codeLine1End = codeLine1 + 'const a = 1;'.length
const plainFrom = DOC.indexOf('alpha')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const verdicts = []
const check = (name, ok, detail) => {
  verdicts.push(`${ok ? 'PASS' : 'RED '} ${name}${detail ? ` | ${detail}` : ''}`)
}
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent(`<html lang="zh-CN"><body class="vscode-light">${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((t) => window.initDoc(t), DOC)
  await page.evaluate(() => window.focusEditor())

  // ---- A. 普通正文对照：Shift+Arrow 扩选 ----
  await page.evaluate((o) => window.locate(o), plainFrom)
  await page.keyboard.press('Shift+ArrowRight')
  let st = await page.evaluate(() => window.readEditor())
  check('A1 正文 Shift+ArrowRight 扩选一格', st.main[1] === plainFrom + 1 && st.main[0] === plainFrom,
    JSON.stringify(st.main))

  // ---- B. 普通正文对照：拖选 ----
  const pa = await page.evaluate((o) => window.posCoords(o), plainFrom)
  const pb = await page.evaluate((o) => window.posCoords(o), plainFrom + 5)
  await page.mouse.move(pa.x + 1, pa.y)
  await page.mouse.down()
  await page.mouse.move(pb.x + 1, pb.y, { steps: 5 })
  await page.mouse.up()
  st = await page.evaluate(() => window.readEditor())
  check('A2 正文拖选产生非空选区', st.main[1] > st.main[0], JSON.stringify(st.main))

  // ---- C. 代码行内：Shift+Arrow 扩选 ----
  await page.evaluate((o) => window.locate(o), codeLine1)
  await page.keyboard.press('Shift+ArrowRight')
  st = await page.evaluate(() => window.readEditor())
  check('B1 代码行 Shift+ArrowRight 扩选一格', st.main[1] === codeLine1 + 1 && st.main[0] === codeLine1,
    JSON.stringify(st.main))

  // ---- D. 代码行内：拖选（同行内 const a） ----
  const ca = await page.evaluate((o) => window.posCoords(o), codeLine1)
  const cb = await page.evaluate((o) => window.posCoords(o), codeLine1 + 6)
  await page.mouse.move(ca.x + 1, ca.y)
  await page.mouse.down()
  await page.mouse.move(cb.x + 1, cb.y, { steps: 5 })
  await page.mouse.up()
  st = await page.evaluate(() => window.readEditor())
  check('B2 代码行拖选产生非空选区', st.main[1] > st.main[0], JSON.stringify(st.main))

  // ---- E. 代码行跨行拖选（a 行拖到 b 行） ----
  const codeLine2 = DOC.indexOf('const b')
  const cc = await page.evaluate((o) => window.posCoords(o), codeLine2 + 6)
  await page.mouse.move(ca.x + 1, ca.y)
  await page.mouse.down()
  await page.mouse.move(cc.x + 1, cc.y, { steps: 8 })
  await page.mouse.up()
  st = await page.evaluate(() => window.readEditor())
  check('B3 代码行跨行拖选产生非空选区', st.main[1] > st.main[0], JSON.stringify(st.main))

  check('C1 全程无页面错误', errors.length === 0, errors.slice(0, 3).join(' ; '))

  // ---- F. 查找面板开着时（#241 验收现场形态）：代码块内选区操作 ----
  await page.keyboard.press('Escape')
  await page.evaluate((o) => window.locate(o), codeLine1)
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(120)
  // 真实回焦路径：点击代码行（面板输入框还开着，焦点回编辑器）
  const fc = await page.evaluate((o) => window.posCoords(o), codeLine1)
  await page.mouse.click(fc.x + 1, fc.y)
  await page.waitForTimeout(60)
  st = await page.evaluate(() => window.readEditor())
  check('F0 面板开着时点击代码行后焦点在编辑器', st.activeIsEditor === true,
    JSON.stringify({ active: st.activeIsEditor, main: st.main }))
  await page.keyboard.press('Shift+ArrowRight')
  st = await page.evaluate(() => window.readEditor())
  check('F1 面板开着时点击代码行后 Shift+Arrow 扩选', st.main[1] > st.main[0],
    JSON.stringify(st.main))
  const fa = await page.evaluate((o) => window.posCoords(o), codeLine1)
  const fb = await page.evaluate((o) => window.posCoords(o), codeLine1End)
  await page.mouse.move(fa.x + 1, fa.y)
  await page.mouse.down()
  await page.mouse.move(fb.x + 1, fb.y, { steps: 5 })
  await page.mouse.up()
  st = await page.evaluate(() => window.readEditor())
  check('F2 面板开着时代码行拖选', st.main[1] > st.main[0], JSON.stringify(st.main))
  await page.keyboard.press('Escape')

  // ---- G. 点击进入代码块（卡片编辑态）后选区操作 ----
  await page.evaluate((o) => window.posCoords(o), codeLine1).then(async (at) => {
    await page.mouse.click(at.x + 1, at.y)
  })
  await page.waitForTimeout(120)
  await page.keyboard.press('Shift+ArrowRight')
  st = await page.evaluate(() => window.readEditor())
  check('G1 点击代码行后 Shift+Arrow 扩选', st.main[1] === st.main[0] + 1 || st.main[1] > st.main[0],
    JSON.stringify(st.main))
  const ga = await page.evaluate((o) => window.posCoords(o), codeLine1)
  const gb = await page.evaluate((o) => window.posCoords(o), codeLine1 + 6)
  await page.mouse.move(ga.x + 1, ga.y)
  await page.mouse.down()
  await page.mouse.move(gb.x + 1, gb.y, { steps: 5 })
  await page.mouse.up()
  st = await page.evaluate(() => window.readEditor())
  check('G2 点击代码行后拖选', st.main[1] > st.main[0], JSON.stringify(st.main))

  check('C2 全程无页面错误（含 F/G）', errors.length === 0, errors.slice(0, 3).join(' ; '))
  await page.close()

  // ---- H. callout（引用块）内的代码块：拖选 + Shift+Arrow ----
  {
    const calloutDoc = [
      '> 前言行。',
      '> ```js',
      '> const x = 1;',
      '> ```',
      '',
    ].join('\n')
    const cx = calloutDoc.indexOf('const x')
    const page2 = await browser.newPage({ viewport: { width: 900, height: 640 } })
    const errors2 = []
    page2.on('pageerror', (e) => errors2.push(e.message))
    await page2.setContent(`<html lang="zh-CN"><body class="vscode-light">${islandHtml}<div id="app"></div></body></html>`)
    await page2.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page2.addScriptTag({ path: output })
    await page2.evaluate((t) => window.initDoc(t), calloutDoc)
    await page2.evaluate(() => window.focusEditor())
    await page2.evaluate((o) => window.locate(o), cx)
    await page2.keyboard.press('Shift+ArrowRight')
    let s2 = await page2.evaluate(() => window.readEditor())
    check('H1 callout 内代码行 Shift+Arrow 扩选', s2.main[1] === cx + 1 && s2.main[0] === cx,
      JSON.stringify(s2.main))
    const ha = await page2.evaluate((o) => window.posCoords(o), cx)
    const hb = await page2.evaluate((o) => window.posCoords(o), cx + 6)
    await page2.mouse.move(ha.x + 1, ha.y)
    await page2.mouse.down()
    await page2.mouse.move(hb.x + 1, hb.y, { steps: 5 })
    await page2.mouse.up()
    s2 = await page2.evaluate(() => window.readEditor())
    check('H2 callout 内代码行拖选', s2.main[1] > s2.main[0], JSON.stringify(s2.main))
    check('H3 callout 场景无页面错误', errors2.length === 0, errors2.slice(0, 2).join(' ; '))
    await page2.close()
  }

  // ---- I. 行内代码 span 内：Shift+Arrow + 拖选 ----
  {
    const inlineDoc = '前文 `const y = 2` 后文\n'
    const iy = inlineDoc.indexOf('const y')
    const page3 = await browser.newPage({ viewport: { width: 900, height: 640 } })
    await page3.setContent(`<html lang="zh-CN"><body class="vscode-light">${islandHtml}<div id="app"></div></body></html>`)
    await page3.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page3.addScriptTag({ path: output })
    await page3.evaluate((t) => window.initDoc(t), inlineDoc)
    await page3.evaluate(() => window.focusEditor())
    await page3.evaluate((o) => window.locate(o), iy)
    await page3.keyboard.press('Shift+ArrowRight')
    let s3 = await page3.evaluate(() => window.readEditor())
    check('I1 行内代码内 Shift+Arrow 扩选', s3.main[1] === iy + 1 && s3.main[0] === iy,
      JSON.stringify(s3.main))
    const ia = await page3.evaluate((o) => window.posCoords(o), iy)
    const ib = await page3.evaluate((o) => window.posCoords(o), iy + 6)
    await page3.mouse.move(ia.x + 1, ia.y)
    await page3.mouse.down()
    await page3.mouse.move(ib.x + 1, ib.y, { steps: 5 })
    await page3.mouse.up()
    s3 = await page3.evaluate(() => window.readEditor())
    check('I2 行内代码内拖选', s3.main[1] > s3.main[0], JSON.stringify(s3.main))
    await page3.close()
  }

  // ---- J. 绘制层（用户看到的东西）：三主题下代码行/正文的选区背景真实可见 ----
  for (const theme of ['light', 'dark', 'high-contrast']) {
    const pj = await browser.newPage({ viewport: { width: 900, height: 640 } })
    await pj.setContent(`<html lang="zh-CN"><body class="vscode-${theme}">${islandHtml}<div id="app"></div></body></html>`)
    await pj.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await pj.addScriptTag({ path: output })
    await pj.evaluate((t) => window.initDoc(t), DOC)
    await pj.evaluate(() => window.focusEditor())
    for (const [label, from, to] of [['正文', plainFrom, plainFrom + 5], ['代码行', codeLine1, codeLine1 + 6]]) {
      const ja = await pj.evaluate((o) => window.posCoords(o), from)
      const jb = await pj.evaluate((o) => window.posCoords(o), to)
      await pj.mouse.move(ja.x + 1, ja.y)
      await pj.mouse.down()
      await pj.mouse.move(jb.x + 1, jb.y, { steps: 4 })
      await pj.mouse.up()
      const vis = await pj.evaluate(() => {
        const sels = [...document.querySelectorAll('.cm-editor .cm-selectionBackground')]
        const withColor = sels.filter((el) => {
          const bg = getComputedStyle(el).backgroundColor
          return bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)'
        })
        return { count: sels.length, visible: withColor.length, sample: sels[0] ? getComputedStyle(sels[0]).backgroundColor : null }
      })
      check(`J ${theme} ${label}选区绘制层可见（cm-selectionBackground 有不透明底色）`,
        vis.count > 0 && vis.visible === vis.count, JSON.stringify(vis))
    }
    await pj.close()
  }

  // ---- K. 多光标设置关闭态（drawSelection 退出）：原生选区回退可见 ----
  {
    const pk = await browser.newPage({ viewport: { width: 900, height: 640 } })
    await pk.setContent(`<html lang="zh-CN"><body class="vscode-light">${islandHtml}<div id="app"></div></body></html>`)
    await pk.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await pk.addScriptTag({ path: output })
    await pk.evaluate((t) => window.initDoc(t), DOC)
    await pk.evaluate(() => window.setMulticursor?.(false))
    await pk.evaluate(() => window.focusEditor())
    const ka = await pk.evaluate((o) => window.posCoords(o), codeLine1)
    const kb = await pk.evaluate((o) => window.posCoords(o), codeLine1 + 6)
    await pk.mouse.move(ka.x + 1, ka.y)
    await pk.mouse.down()
    await pk.mouse.move(kb.x + 1, kb.y, { steps: 4 })
    await pk.mouse.up()
    const k = await pk.evaluate(() => {
      const native = window.getSelection()
      return {
        drawn: document.querySelectorAll('.cm-editor .cm-selectionBackground').length,
        nativeRange: native && native.rangeCount > 0 ? [native.getRangeAt(0).collapsed, native.toString().length] : null,
      }
    })
    check('K1 关态原生选区回退（native selection 非空且非折叠）',
      k.nativeRange !== null && k.nativeRange[0] === false && k.nativeRange[1] > 0, JSON.stringify(k))
    await pk.close()
  }
} finally {
  await browser.close()
}
console.log(`== probe:codeblock @ ${await (async () => 'HEAD')()} ==`)
for (const v of verdicts) {
  console.log(v)
}
const red = verdicts.filter((v) => v.startsWith('RED')).length
console.log(`RED=${red}`)
process.exitCode = red === 0 ? 0 : 1
