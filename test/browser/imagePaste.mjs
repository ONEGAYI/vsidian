// 图片粘贴浏览器回归（#161）：真实 ClipboardEvent 驱动生产控制器的 paste
// 拦截——守卫矩阵、图片优先于文本、出站载荷形态、结果插入（单事务）、
// 陈旧 reqId 丢弃。粘贴落盘与撤销还原由集成路径覆盖（真宿主钩子）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'imagePaste/main.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/imagePasteFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml } = await buildZhLocaleIsland(root)

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_B64 = 'iVBORw0KGgo='

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body class="vscode-light">${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: sans-serif; --vscode-editor-background: #ffffff; --vscode-editor-foreground: #222222; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  const firePaste = (items) => page.evaluate((i) => window.firePaste(i), items)
  const hostPasteMessages = () => page.evaluate(() =>
    window.readHostMessages().filter((m) => m.kind === 'image.paste'))

  // ---- 场景 1：命中拦截——preventDefault、出站载荷形态、结果插入 ----
  await page.evaluate(() => window.initDoc('hello'))
  await page.evaluate(() => window.locate(5))
  await page.evaluate(() => window.focusEditor())
  const prevented = await firePaste([{ kind: 'file', type: 'image/png', name: 'image.png', bytes: PNG_BYTES }])
  assert.equal(prevented, true, '图片粘贴应 preventDefault（阻断默认文本粘贴）')
  await page.waitForFunction(() => window.readHostMessages().some((m) => m.kind === 'image.paste'))
  const messages = await hostPasteMessages()
  assert.equal(messages.length, 1, '应恰好出站一条 image.paste（多图取首）')
  const msg = messages[0]
  assert.equal(msg.mime, 'image/png')
  assert.equal(msg.dataBase64, PNG_B64, 'base64 载荷应为字节序列的 base64')
  assert.equal(msg.fileNameHint, 'image.png')
  assert.equal(msg.docUri, 'file:///d/note.md')
  assert.ok(typeof msg.reqId === 'number' && msg.reqId >= 1)
  let editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, 'hello', '拦截后编辑器文本不得被默认粘贴改动')
  // 宿主回发成功结果：光标处插入 markdown（单事务）
  await page.evaluate(() => window.respondImagePaste(true, '![Pasted image 20260928090503](Pasted%20image%2020260928090503.png)'))
  editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, 'hello![Pasted image 20260928090503](Pasted%20image%2020260928090503.png)',
    '结果到达后应在光标处插入宿主计算的 markdown')
  assert.equal(editor.head, editor.text.length, '光标应落在插入文本之后')
  await page.evaluate(() => window.ackLastEdit(2))

  // ---- 场景 2：选区替换（有选区时插入替换选区，与 CM6 粘贴语义一致） ----
  await page.evaluate(() => window.selectRange(0, 2))
  await firePaste([{ kind: 'file', type: 'image/png', name: 'shot a.png', bytes: PNG_BYTES }])
  await page.waitForFunction(() => window.readHostMessages().filter((m) => m.kind === 'image.paste').length === 2)
  await page.evaluate(() => window.respondImagePaste(true, '![b](b.png)'))
  editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, '![b](b.png)llo![Pasted image 20260928090503](Pasted%20image%2020260928090503.png)',
    '选区应被插入文本替换')
  await page.evaluate(() => window.ackLastEdit(3))

  // ---- 场景 3：图片优先于同剪贴板文本 ----
  await page.evaluate(() => window.locate(0))
  const prevented3 = await firePaste([
    { kind: 'string', type: 'text/plain', text: 'plain text' },
    { kind: 'file', type: 'image/png', name: 'image.png', bytes: PNG_BYTES },
  ])
  assert.equal(prevented3, true, '图片优先接管')
  await page.waitForFunction(() => window.readHostMessages().filter((m) => m.kind === 'image.paste').length === 3)
  editor = await page.evaluate(() => window.readEditor())
  assert.ok(!editor.text.includes('plain text'), '同剪贴板文本不得进入文档')
  // 该次出站不回结果（保持 pending），供场景 8 用陈旧 reqId 验证

  // ---- 场景 4：纯文本剪贴板放行（不出站；文本经 CM6 默认粘贴进入文档） ----
  // 注：preventDefault 为 true 属 CM6 核心 handlers.paste 的文本接管（默认
  // 粘贴路径），非本扩展拦截——放行语义以「无 image.paste 出站 + 文本实际
  // 进入文档」断言
  await firePaste([{ kind: 'string', type: 'text/plain', text: 'just text' }])
  const after4 = await hostPasteMessages()
  assert.equal(after4.length, 3, '纯文本粘贴不得新增 image.paste 出站')
  editor = await page.evaluate(() => window.readEditor())
  assert.ok(editor.text.includes('just text'), '放行后文本应经默认粘贴进入文档')

  // ---- 场景 5：IME 组合中放行 ----
  await page.evaluate(() => window.fireComposition('start'))
  await firePaste([{ kind: 'file', type: 'image/png', name: 'image.png', bytes: PNG_BYTES }])
  await page.evaluate(() => window.fireComposition('end'))
  const after5 = await hostPasteMessages()
  assert.equal(after5.length, 3, 'IME 组合中不得新增 image.paste 出站')

  // ---- 场景 6：总开关关放行 ----
  await page.evaluate(() => window.applySettings({ 'image.paste': false }))
  await firePaste([{ kind: 'file', type: 'image/png', name: 'image.png', bytes: PNG_BYTES }])
  await page.evaluate(() => window.applySettings({ 'image.paste': true }))

  // ---- 场景 7：阅读模式不接管 ----
  await page.evaluate(() => window.setViewMode('reading'))
  await firePaste([{ kind: 'file', type: 'image/png', name: 'image.png', bytes: PNG_BYTES }])
  await page.evaluate(() => window.setViewMode('live'))
  const after7 = await hostPasteMessages()
  assert.equal(after7.length, 3, '总开关关/阅读模式下不得新增 image.paste 出站')

  // ---- 场景 8：失败结果不插入；陈旧 reqId 结果丢弃 ----
  // 场景 3 留下的 pending（reqId=3）：以失败结果回应——文本不变
  const before8 = await page.evaluate(() => window.readEditor())
  await page.evaluate(() => window.respondImagePaste(false, ''))
  editor = await page.evaluate(() => window.readEditor())
  assert.equal(editor.text, before8.text, '失败结果不得插入文本')
  // 同一 reqId 重复/未知 reqId 的成功结果不得插入（防陈旧回包重复插入）
  await page.evaluate(() => window.respondImagePaste(true, '![stale](x.png)', 999))
  editor = await page.evaluate(() => window.readEditor())
  assert.ok(!editor.text.includes('stale'), '未知 reqId 的回包必须丢弃')
  await page.evaluate(() => window.respondImagePaste(true, '![dup](y.png)'))
  editor = await page.evaluate(() => window.readEditor())
  assert.ok(!editor.text.includes('dup'), '已消费 reqId 的重复回包必须丢弃')

  // ---- 场景 9：出站与插入的事务数（单事务 = 一笔 edit.request = 撤销一步） ----
  const edits = await page.evaluate(() =>
    window.readHostMessages().filter((m) => m.kind === 'edit.request'))
  // 3 笔 = 场景 1/2 的两次图片结果插入各一笔 + 场景 4 的默认文本粘贴一笔
  assert.equal(edits.length, 3, '两次成功插入应各产生恰好一笔 edit.request（一笔撤销）')

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  await page.close()
} finally {
  await browser.close()
}
console.log('imagePaste: 9 场景通过')
