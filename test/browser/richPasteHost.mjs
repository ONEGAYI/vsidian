// #305 VS Code 独立桌面 + 回环 CDP：真实剪贴板、多格式权限、纯文本入口及轻提示绘制。
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
await build({ entryPoints: [path.join(root, 'test/integration/richPasteHostSuite.ts')],
  outfile: path.join(root, 'out/test/integration/richPasteHost.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/integration/richPasteHost.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
console.log(`[键盘宿主] 独立桌面，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 90000,
  reportPath: path.join(root, '.vscode-test/rich-paste-host.log') })
let socket
try {
  const deadline = Date.now() + 60000
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

  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { contextId, expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

  await command('preferences', { values: { 'editor.pasteSplitUndo': false } })
  await evaluate('document.querySelector(".cm-content").focus()')
  await evaluate('(async()=>{await navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob(["new"],{type:"text/plain"}),"text/html":new Blob(["<b style=font-weight:normal><span style=font-weight:700>new</span></b>"],{type:"text/html"})})]);})()')
  await press('a');await press('v')
  await new Promise(r=>setTimeout(r,250))
  assert.equal(await command('text'),'word','询问前不修改TextDocument')
  assert.equal(await evaluate('Boolean(document.querySelector("[role=dialog]"))'),true)
  await evaluate('document.querySelector("[data-paste-remember]").checked=true;document.querySelector("[data-paste-choice=keep]").click()')
  await waitText('**new**');await new Promise(r=>setTimeout(r,250))
  const state=await command('paint');assert.equal(state.paint.toast.visible,true);assert.equal(state.paint.toast.severity,'neutral')
  const preferences=await command('settings')
  assert.equal(preferences['editor.pastePreserveFormatting'],true);assert.equal(preferences['editor.pasteAskBefore'],false)
  console.log('[PASS] VSCode1.82.3 native富文本粘贴→询问→格式落TextDocument→实际ack后的neutral绘制→偏好持久化读回')
  await press('z');await waitText('word')
  await press('y');await waitText('**new**')
  console.log('[PASS] T2一次撤销整个格式粘贴，重做恢复')
  await new Promise(r=>setTimeout(r,2800))
  await evaluate('(async()=>{await navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob(["menu"],{type:"text/plain"}),"text/html":new Blob(["<i>menu</i>"],{type:"text/html"})})]);})()')
  await press('a');await command('menu');await evaluate('document.querySelector("[data-vsidian-command=paste]").click()')
  await waitText('*menu*')
  assert.equal(await evaluate('Boolean(document.querySelector("[role=dialog]"))'),false)
  console.log('[PASS] 真实菜单读取HTML，与native普通粘贴同源；记忆后不再询问')
  writeFileSync(path.join(dir,'done'),'');const code=await host;assert.equal(code,0)
  assert.equal(readFileSync(path.join(dir,'result'),'utf8'),'*menu*')
} finally {
  if(socket)socket.close()
  writeFileSync(path.join(dir,'done'),'')
  await host
}
