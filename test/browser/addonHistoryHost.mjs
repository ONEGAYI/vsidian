// V01（#348）附加组件历史分组——真实键盘/IME/生产控制器输入路径探针。
// VSCode 1.82.3 独立桌面 + 回环 CDP：webview 为真实生产 CM6 控制器，键盘
// 事件经 Input.dispatchKeyEvent 原生派发，IME 组合经 Input.imeSetComposition
// 真实驱动 compositionstart..compositionend；修饰提交与分组断言经宿主侧
// _test.addonHistory.* 探针命令（真实 edit.request/ack/history.request 管线）。
// 宿主伴随套件：test/integration/addonHistoryHostSuite.ts。
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { buildTestHostArgs, runTestHost } from '../integration/testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(path.join(root, 'out/test/348'), { recursive: true })
const dir = mkdtempSync(path.join(root, 'out/test/348/host-fixture-'))
const T0 = 'V01键基\n'
writeFileSync(path.join(dir, 'keyboard.md'), T0)
await build({ entryPoints: [path.join(root, 'test/integration/addonHistoryHostSuite.ts')],
  outfile: path.join(root, 'out/test/integration/addonHistoryHost.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/integration/addonHistoryHost.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
console.log(`[V01 键盘宿主] 独立桌面，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 300000,
  reportPath: path.join(root, '.vscode-test/addon-history-host.log') })
let socket
try {
  const deadline = Date.now() + 60000
  while ((!existsSync(path.join(dir, 'ready')) || !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(existsSync(path.join(dir, 'ready')), '宿主未打开 fixture')
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
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
        expression: 'Boolean(document.querySelector(".cm-content"))', returnByValue: true,
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
    const until = Date.now() + 15000
    while (!existsSync(response) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100))
    assert(existsSync(response), `宿主请求 ${action} 超时`)
    return JSON.parse(readFileSync(response, 'utf8'))
  }
  async function waitText(expected) {
    const until = Date.now() + 8000
    do {
      if (await command('text') === expected) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < until)
    assert.equal(await command('text'), expected)
  }
  async function focus() {
    await call('Runtime.evaluate', { contextId, expression: 'document.querySelector(".cm-content").focus()' })
  }
  async function press(key, shift = false) {
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
  async function docEnd() {
    await focus()
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
  }
  async function type(text) { await focus(); await docEnd(); await call('Input.insertText', { text }) }
  async function paintText() {
    const until = Date.now() + 8000
    let value
    do { value = await command('paint'); if (value?.text !== undefined && !value.suspended) return value.text } while (Date.now() < until)
    assert(value?.text !== undefined, 'paint 探针超时')
    return value?.text
  }

  await command('attach')

  // ---- 1. 真实键盘输入是外来单步单位：一次 Ctrl+Z 撤一笔输入 ----
  await type('用')
  await waitText('V01键基\n用')
  let state = await command('state')
  assert.equal(state.entries.filter((e) => e.owner === 'foreign').length, 1, '真实键盘输入应记外来条目')
  const undoEvents0 = (await command('events')).filter((e) => e.reason === 1).length
  await press('z')
  await waitText(T0)
  assert.equal((await command('events')).filter((e) => e.reason === 1).length - undoEvents0, 1, '一次 Ctrl+Z 恰一笔真实 Undo 事件')
  assert.equal(await paintText(), T0, 'webview 生产控制器回流到基态')
  console.log('[PASS] 真实键盘输入经生产控制器成外来单步撤回单位，一次 Ctrl+Z 恰一步')

  // ---- 2. 探针修饰组：真实 Ctrl+Z 一次 = 撤整组（A+B 两步）----
  await command('submit', { opId: 'A', atomic: true, changes: [{ offset: T0.length, length: 0, text: '甲A' }] })
  await waitText('V01键基\n甲A')
  await command('submit', { opId: 'B', atomic: false, changes: [{ offset: T0.length + 2, length: 0, text: '乙B' }] })
  await waitText('V01键基\n甲A乙B')
  state = await command('state')
  const groups = state.entries.filter((e) => e.owner === 'addon').map((e) => e.groupId)
  assert.equal(groups.length, 2)
  assert.equal(groups[0], groups[1], 'A+B 同组')
  const undoEvents1 = (await command('events')).filter((e) => e.reason === 1).length
  await press('z')
  await waitText(T0)
  const undoEvents = (await command('events')).filter((e) => e.reason === 1)
  assert.equal(undoEvents.length - undoEvents1, 2, '一次 Ctrl+Z 执行组内两步（事件级证据）')
  assert.equal(await paintText(), T0, 'webview 回流基态')
  console.log('[PASS] 修饰组经真实 Ctrl+Z 一次撤整组（A+B 两步），生产控制器逐步回流')

  // ---- 3. IME 组合安全收尾：组合期间的 IME 键（229）不触发撤销；定稿
  // 落地为独立单位后，随后的 Ctrl+Z 在其落地之后执行 ----
  await type('丙')
  await waitText('V01键基\n丙')
  await focus()
  await docEnd()
  await call('Input.imeSetComposition', { text: '合', selectionStart: 1, selectionEnd: 1 })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const composingProbe = await call('Runtime.evaluate', { contextId, returnByValue: true,
    expression: 'JSON.stringify({text: document.querySelector(".cm-content").textContent, composing: document.querySelector(".cm-content").textContent.includes("合")})' })
  assert.equal(JSON.parse(composingProbe.result.value).composing, true, 'IME 组合应真实启动（DOM 含组合文本）')
  // 真实 IME 期间按键以 keyCode 229（process key）到达——不映射任何绑定
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Process', code: 'KeyZ', windowsVirtualKeyCode: 229, modifiers: 2 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'KeyZ', windowsVirtualKeyCode: 229, modifiers: 2 })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(await command('text'), 'V01键基\n丙', '组合期间宿主文本不动')
  // 定稿：insertText 提交组合 → compositionend → 净编辑出站；立即 Ctrl+Z——
  // webview 竞态守卫保证 history.request 不早于该编辑落地
  await call('Input.insertText', { text: '合' })
  await press('z')
  await waitText('V01键基\n丙')
  const imeEvents = (await command('events'))
  const undoEv = [...imeEvents].reverse().find((e) => e.reason === 1)
  const applyEv = undoEv ? [...imeEvents].reverse().find((e) => e.reason === undefined && e.version < undoEv.version) : undefined
  assert(applyEv, '组合定稿编辑应落地为宿主事件')
  assert(undoEv && undoEv.version === applyEv.version + 1, `撤销应紧随定稿编辑（undo=${undoEv && undoEv.version} apply=${applyEv.version}）`)
  assert.equal(await paintText(), 'V01键基\n丙', 'webview 回流')
  console.log('[PASS] IME 组合期 229 键不触发撤销；定稿落盘后撤销按序执行（安全收尾）')

  // ---- 4. 组合输入 + 探针非原子修饰混排后的组撤回 ----
  await command('submit', { opId: 'C', atomic: true, changes: [{ offset: 'V01键基\n丙'.length, length: 0, text: '丁C' }] })
  await waitText('V01键基\n丙丁C')
  await focus()
  await docEnd()
  await call('Input.imeSetComposition', { text: '戊', selectionStart: 1, selectionEnd: 1 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await call('Input.insertText', { text: '戊' })
  await waitText('V01键基\n丙丁C戊')
  await press('z')
  await waitText('V01键基\n丙丁C')
  await press('z')
  await waitText('V01键基\n丙')
  console.log('[PASS] IME 输入与修饰组分属两个撤回单位，逐单位回退')

  // ---- 5. 快速连按 Ctrl+Z 恰按单位撤、不多撤 ----
  await type('己')
  await waitText('V01键基\n丙己')
  const eventsBefore = (await command('events')).filter((e) => e.reason === 1).length
  await press('z'); await press('z')
  await waitText(T0)
  const allUndo = (await command('events')).filter((e) => e.reason === 1)
  assert.equal(allUndo.length - eventsBefore, 2, '连按两次各撤一个单位（己 一笔、丙 一笔）')
  console.log('[PASS] 快速连按按单位推进不多撤')

  // ---- 6. 原生文本编辑器外部撤销触发组完成（真实外部入口）----
  await command('submit', { opId: 'D', atomic: true, changes: [{ offset: T0.length, length: 0, text: '庚D' }] })
  await waitText('V01键基\n庚D')
  await command('submit', { opId: 'E', atomic: false, changes: [{ offset: 'V01键基\n庚D'.length, length: 0, text: '辛E' }] })
  await waitText('V01键基\n庚D辛E')
  const native = await command('nativeHistory', { op: 'undo' })
  assert.equal(native.text, T0, `原生一步 + 组完成应撤整组：${JSON.stringify(native.text)}`)
  await waitText(T0)
  const activeAfter = await command('activeTextEditor')
  assert(activeAfter === null || activeAfter.endsWith('/keyboard.md'), '外部原生入口收尾活动编辑器只可能是本文档（不误伤其他文档）')
  console.log('[PASS] 原生文本编辑器单步撤销触发组完成（外部入口真实链路）')

  writeFileSync(path.join(root, 'out/test/348/host-events.json'), JSON.stringify(await command('events'), null, 2))
  writeFileSync(path.join(dir, 'done'), '')
  const code = await host
  assert.equal(code, 0)
  assert.equal(readFileSync(path.join(dir, 'result'), 'utf8'), T0)
} finally {
  if (socket) socket.close()
  writeFileSync(path.join(dir, 'done'), '')
  await host
}
