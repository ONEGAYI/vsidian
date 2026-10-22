// VS Code 独立桌面 + 回环 CDP：真实 Electron/webview 到工作台键位路径。
// 默认宿主与 engines 承诺下界同版（#255 矩阵钉住）；VSIDIAN_TEST_VSCODE_PATH
// 指向已解压宿主可执行文件时跳过默认下载，用于下界候选的定向复验。
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { buildTestHostArgs, runTestHost } from '../integration/testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-keyboard-host-'))
writeFileSync(path.join(dir, 'keyboard.md'), 'word')
await build({ entryPoints: [path.join(root, 'test/integration/keybindingsHostSuite.ts')],
  outfile: path.join(root, 'out/test/integration/keybindingsHost.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/integration/keybindingsHost.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
console.log(`[键盘宿主] 独立桌面，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 90000,
  reportPath: path.join(root, '.vscode-test/keybindings-host.log') })
let socket
try {
  // 首次运行需下载并解压宿主，冷启动可达数分钟（#638 实测 60s 窗口不足）；
  // 宿主本体超时由 runTestHost 的 timeoutMs 兜底，此处只等就绪信号
  const deadline = Date.now() + 180000
  while ((!existsSync(path.join(dir, 'ready')) || !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(existsSync(path.join(dir, 'ready')), '宿主未打开 fixture')
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  console.log(`[键盘宿主] CDP 目标：${targets.map((target) => target.type).join(', ')}`)
  const pending = new Map()
  let nextId = 0
  async function connect(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    ws.addEventListener('message', (event) => {
      const response = JSON.parse(event.data)
      if (!pending.has(response.id)) return
      const { resolve, reject } = pending.get(response.id)
      pending.delete(response.id)
      response.error ? reject(new Error(response.error.message)) : resolve(response.result)
    })
    socket = ws
  }
  function call(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  let found = false
  let contextId
  for (const target of targets.filter((item) => item.webSocketDebuggerUrl)) {
    await connect(target)
    const tree = await call('Page.getFrameTree').catch(() => null)
    const frames = []
    function collect(node) {
      if (!node) return
      frames.push(node.frame)
      for (const child of node.childFrames ?? []) collect(child)
    }
    collect(tree?.frameTree)
    for (const frame of frames) {
      const world = await call('Page.createIsolatedWorld', { frameId: frame.id }).catch(() => null)
      if (!world) continue
      const probe = await call('Runtime.evaluate', {
        contextId: world.executionContextId,
        expression: "Boolean(document.querySelector('.cm-content'))", returnByValue: true,
      }).catch(() => null)
      if (probe?.result?.value === true) {
        found = true; contextId = world.executionContextId; break
      }
    }
    if (found) break
    socket.close()
  }
  assert(found, 'CDP 未找到 Vsidian webview 的 .cm-content')
  let requestId = 0
  async function command(action, details = {}) {
    const id = ++requestId
    writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ id, action, ...details }))
    const response = path.join(dir, `response-${id}.json`)
    const until = Date.now() + 10000
    while (!existsSync(response) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100))
    assert(existsSync(response), `宿主请求 ${action} 超时`)
    return JSON.parse(readFileSync(response, 'utf8'))
  }
  async function waitText(expected) {
    const until = Date.now() + 5000
    do {
      if (await command('text') === expected) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < until)
    assert.equal(await command('text'), expected)
  }
  async function press(key, shift = false, focusSelector = '.cm-content') {
    await call('Runtime.evaluate', { contextId,
      expression: `document.querySelector(${JSON.stringify(focusSelector)}).focus()` })
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft',
      windowsVirtualKeyCode: 17, modifiers: 2 })
    if (shift) await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft',
      windowsVirtualKeyCode: 16, modifiers: 10 })
    const digit = /^[0-9]$/.test(key)
    const code = key.toUpperCase().charCodeAt(0)
    const modifiers = shift ? 10 : 2
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: shift ? key.toUpperCase() : key,
      code: `${digit ? 'Digit' : 'Key'}${key.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: shift ? key.toUpperCase() : key,
      code: `${digit ? 'Digit' : 'Key'}${key.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
    if (shift) await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
  }
  await press('b')
  await waitText('**word**')
  assert.equal(await command('mode', { text: 'reading' }), true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  await press('b', false, '[data-vsidian-mode="reading"]')
  assert.equal(await command('text'), '**word**', '阅读模式不得触发粗体写入')
  assert.equal(await command('mode', { text: 'live' }), true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  for (let level = 1; level <= 6; level++) {
    assert.equal(await command('replaceText', { text: 'word' }), true)
    await waitText('word')
    await press(String(level))
    await waitText(`${'#'.repeat(level)} word`)
  }
  assert.equal(await command('replaceText', { text: '# word' }), true)
  await waitText('# word')
  await press('0')
  await waitText('word')
  await press('b')
  await waitText('**word**')
  assert.equal((await command('set', { operationId: 'bold', bindings: ['ctrl+shift+b'] })).ok, true)
  assert.equal(await command('replaceText', { text: 'word' }), true)
  await waitText('word')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await press('b')
  assert.equal(await command('text'), 'word', '改绑后旧 Ctrl+B 应释放')
  await press('b', true)
  await waitText('**word**')
  assert.equal((await command('set', { operationId: 'bold', bindings: ['ctrl+k ctrl+b'] })).ok, true)
  assert.equal(await command('replaceText', { text: 'word' }), true)
  await waitText('word')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await press('k')
  assert.equal(await command('text'), 'word', '首段只能等待')
  await press('b')
  await waitText('**word**')
  assert.equal((await command('set', { operationId: 'bold', bindings: [] })).ok, true)
  assert.equal(await command('replaceText', { text: 'word' }), true)
  await waitText('word')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await press('b')
  assert.equal(await command('text'), 'word', '显式清空后 Ctrl+B 不应复活')
  assert.equal((await command('resetAll')).ok, true)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await press('b')
  await waitText('**word**')

  // #638 跳转到行：命令入口开原生输入框（webview 的 Ctrl+G 已在
  // keybindingEditor 浏览器套件覆盖面板消费），此处验证真宿主「输入框 →
  // view.locate → 落位/绘制层」全链。宿主会把写入文本按平台规范化行尾
  //（Windows 为 CRLF），断言按实际文本比较——CRLF 行号换算正是本票验收项。
  const gotoDocLines = ['第一行', '第二行', '第三行', '第四行']
  assert.equal(await command('replaceText', { text: gotoDocLines.join('\n') + '\n' }), true)
  let gotoDoc = ''
  for (let i = 0; i < 50; i++) {
    gotoDoc = await command('text')
    if (gotoDoc.includes('第三行')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(gotoDoc.includes('第三行'), '替换后的文本应可读回')
  assert(/\r\n/.test(gotoDoc), `宿主应为 CRLF 行尾（实测 ${JSON.stringify(gotoDoc)}）`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  // 工作台页面（非 webview）驱动原生输入框：先在 webview 内把光标移到文首，
  // 再经命令入口触发，随后在任一 CDP 目标里找 .quick-input-widget 输入。
  await call('Runtime.evaluate', { contextId,
    expression: "document.querySelector('.cm-content').focus()" })
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Home', code: 'Home',
    windowsVirtualKeyCode: 36, modifiers: 2 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home',
    windowsVirtualKeyCode: 36, modifiers: 2 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  // 命令入口（与键位同执行体；键位路径已在浏览器套件覆盖）
  assert.deepEqual(await command('gotoLineCommand'), { started: true })
  // 输入框出现在工作台页面：逐目标尝试找到可输入的输入框
  let inputTarget
  for (const target of targets.filter((item) => item.webSocketDebuggerUrl)) {
    if (target.webSocketDebuggerUrl === undefined) continue
    await connect(target)
    const probe = await call('Runtime.evaluate', {
      expression: `Boolean(document.querySelector('.quick-input-box input, .quick-input-widget input'))`,
      returnByValue: true,
    }).catch(() => null)
    if (probe?.result?.value === true) { inputTarget = target; break }
  }
  assert(inputTarget, '未找到原生输入框（.quick-input-widget input）')
  // 原生输入框由 VSCode quickInput 自持按键处理，合成 DOM 事件不生效（实测
  // keydown 合成不触发确认）——经 CDP Input 域真实键入：先输入越界值 99 回车，
  // validateInput 应拦下并保持输入框在场；再全选替换为 3 回车完成定位。
  const inputSelector = '.quick-input-box input, .quick-input-widget input'
  const widgetOpen = async () => (await call('Runtime.evaluate', {
    expression: `Boolean(document.querySelector(${JSON.stringify(inputSelector)}))`,
    returnByValue: true,
  })).result?.value === true
  await call('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(inputSelector)}).focus()`,
    returnByValue: true,
  })
  const typeText = async (text) => call('Input.insertText', { text })
  const pressEnter = async () => {
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  }
  const selectAll = async () => {
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA',
      windowsVirtualKeyCode: 65, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA',
      windowsVirtualKeyCode: 65, modifiers: 2 })
  }
  await typeText('99')
  await new Promise((resolve) => setTimeout(resolve, 150))
  await pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert(await widgetOpen(), '越界输入应被 validateInput 拦下并保持输入框在场')
  await selectAll()
  await typeText('3')
  await new Promise((resolve) => setTimeout(resolve, 150))
  await pressEnter()
  const gotolineDone = path.join(dir, 'gotoline-result.json')
  const until = Date.now() + 8000
  while (!existsSync(gotolineDone) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(existsSync(gotolineDone), 'gotoLine 命令未在输入确认后返回')
  assert.equal(JSON.parse(readFileSync(gotolineDone, 'utf8')).done, true)
  // 光标应落在第三行行首：读 webview 内 CM6 活动行（DOM 选区所在 .cm-line）
  let cursorHit = false
  for (const target of targets.filter((item) => item.webSocketDebuggerUrl)) {
    await connect(target)
    const probe = await call('Runtime.evaluate', { contextId,
      expression: `(() => { const el = document.querySelector('.cm-content');
        return el ? document.querySelectorAll('.cm-line').length : -1 })()`,
      returnByValue: true }).catch(() => null)
    if (probe?.result?.value >= 0) {
      const line = await call('Runtime.evaluate', { contextId,
        expression: `(() => { const sel = window.getSelection();
          const node = sel?.anchorNode; const el = node?.nodeType === 3 ? node.parentElement : node;
          const lineEl = el?.closest?.('.cm-line');
          if (!lineEl) return -1;
          const lines = [...document.querySelectorAll('.cm-line')];
          return lines.indexOf(lineEl) + 1 })()`,
        returnByValue: true })
      if (line?.result?.value === 3) { cursorHit = true; break }
    }
  }
  assert(cursorHit, 'Ctrl+G 提交行号后光标应落在第 3 行')
  assert.equal(await command('text'), gotoDoc, '跳转到行不得修改正文')
  console.log('[键盘宿主] Ctrl+G 真宿主输入框 → view.locate → 落位通过')
  // 还原为 Ctrl+B 段落的期望文本，让既有最终断言（写回结果）继续成立
  assert.equal(await command('replaceText', { text: 'word' }), true)
  await waitText('word')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await press('b')
  await waitText('**word**')
  // 真宿主 TextDocument 经 edit.request 写回；最终由伴随套件在 done 后回报。
  writeFileSync(path.join(dir, 'done'), '')
  const code = await host
  assert.equal(code, 0)
  assert.equal(readFileSync(path.join(dir, 'result'), 'utf8'), '**word**',
    'Ctrl+B 应由 Vsidian 加粗而非切换工作台侧栏')
  console.log('[键盘宿主][PASS] 独立桌面 CDP Ctrl+B、Ctrl+0–6、改绑旧键释放、两段键、清空及重置、Ctrl+G 跳转到行（宿主版本见启动日志）')
} finally {
  if (socket) socket.close()
  writeFileSync(path.join(dir, 'done'), '')
  await host
}
