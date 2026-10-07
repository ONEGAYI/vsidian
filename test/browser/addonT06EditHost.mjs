// #355 T06 统一视图编辑 API——真实键盘/IME 驱动生产消费链路。
// VSCode 1.82.3 独立桌面 + 回环 CDP：webview 为真实生产 CM6 控制器，
// 键盘事件经 Input.dispatchKeyEvent 原生派发，IME 组合经
// Input.imeSetComposition 真实驱动 compositionstart..compositionend。
// 与 V01（addonHistoryHost，探针虚拟面板提交）不同：修饰提交经
// addon-t06 夹具组件的**公开 SDK views.applyEdits**（长轮询驱动，
// 真实 edit.request/ack 管线），历史断言经生产协调器观测
// _test.addonHistory.t06State。宿主伴随套件：test/integration/addonT06EditHostSuite.ts。
// 场景（V01 键盘矩阵的生产 SDK 版）：
// 1. 真实键盘输入成外来单步：t06State 记 foreign 条目，一次 Ctrl+Z 恰一笔 Undo；
// 2. SDK 修饰组（atomic + joinPrevious 两笔提交）经真实 Ctrl+Z 一次撤整组
//    （事件级 2 笔 Undo、webview 逐步回流）；
// 3. IME 组合期 229 键不触发撤销；定稿落盘后撤销紧随其后（安全收尾）；
// 4. IME 定稿输入与 SDK 修饰组分属撤回单位，逐单位回退；
// 5. 快速连按 Ctrl+Z 恰按单位推进不多撤（连按两次撤 EF 组 + 外来各一单位）；
// 6. 指令在途时 Ctrl+Z（提交与撤销并发）：F2 执行时点计算保证收敛、不 lost。
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'
import { buildTestHostArgs, runTestHost } from '../integration/testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(path.join(root, 'out/test/355'), { recursive: true })
const dir = mkdtempSync(path.join(root, 'out/test/355/host-fixture-'))
const T0 = 'T06键基\n'
writeFileSync(path.join(dir, 'keyboard.md'), T0)
await build({ entryPoints: [path.join(root, 'test/integration/addonT06EditHostSuite.ts')],
  outfile: path.join(root, 'out/test/integration/addonT06EditHost.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
// T06 夹具组件页面产物：V02 构建桥生成后拷入夹具目录（与 runTest.mjs 同型）
const layout = await buildTestAddons({ log: () => {} })
cpSync(layout.t06Addon.distDir, path.join(root, 'test/integration/addonFixtures/addon-t06/dist'), { recursive: true })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/integration/addonT06EditHost.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true,
  extraExtensionPaths: [path.join(root, 'test/integration/addonFixtures/addon-t06')] })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
console.log(`[T06 键盘宿主] 独立桌面，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 420000,
  reportPath: path.join(root, '.vscode-test/addon-t06-edit-host.log') })
let socket
try {
  const deadline = Date.now() + 60000
  while ((!existsSync(path.join(dir, 'ready')) || !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(existsSync(path.join(dir, 'ready')), '宿主未打开 fixture（或组件未就绪）')
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
    const until = Date.now() + 20000
    while (!existsSync(response) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100))
    assert(existsSync(response), `宿主请求 ${action} 超时`)
    return JSON.parse(readFileSync(response, 'utf8'))
  }
  async function waitText(expected) {
    const until = Date.now() + 10000
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
    const until = Date.now() + 10000
    let value
    do { value = await command('paint'); if (value?.text !== undefined && !value.suspended) return value.text } while (Date.now() < until)
    assert(value?.text !== undefined, 'paint 探针超时')
    return value?.text
  }
  /** SDK 消费链路：塞指令并轮询收件箱直到该 seq 结局到达 */
  async function queueOp(op, args = {}) {
    const seq = await command('queue', { op, args })
    const until = Date.now() + 20000
    for (;;) {
      const results = await command('collect', { timeoutMs: 400 })
      const hit = results.find((r) => r.seq === seq)
      if (hit) return hit.outcome
      if (Date.now() > until) throw new Error(`指令 ${seq}（${op}）结局超时`)
    }
  }
  /** 生产 SDK 提交：快照 → applyEdits（快照-提交间的用户输入由修订标记拒绝，
   *  本套件各调用点无并发输入，直取最新快照即可） */
  async function applyEdits(text, history) {
    const snap = await queueOp('snapshot', { instanceId: 'main' })
    assert.equal(snap.ok, true, `快照应成功：${JSON.stringify(snap)}`)
    const request = { revision: snap.snapshot.revision, changes: [{ offset: snap.snapshot.text.length, length: 0, text }],
      ...(history ? { history } : {}) }
    const outcome = await queueOp('applyEdits', { instanceId: 'main', request })
    assert.equal(outcome.ok, true, `SDK applyEdits 应成功：${JSON.stringify(outcome)}`)
    return outcome
  }

  // ---- 1. 真实键盘输入是外来单步单位：一次 Ctrl+Z 撤一笔输入 ----
  await type('用')
  await waitText('T06键基\n用')
  let state = await command('t06State')
  assert.equal(state.entries.filter((e) => e.owner === 'foreign').length, 1, '真实键盘输入应记外来条目')
  const undoEvents0 = (await command('events')).filter((e) => e.reason === 1).length
  await press('z')
  await waitText(T0)
  assert.equal((await command('events')).filter((e) => e.reason === 1).length - undoEvents0, 1, '一次 Ctrl+Z 恰一笔真实 Undo 事件')
  assert.equal(await paintText(), T0, 'webview 生产控制器回流到基态')
  console.log('[PASS] 真实键盘输入成外来单步（生产 SDK 视角：t06State 记 foreign，一次 Ctrl+Z 恰一步）')

  // ---- 2. SDK 修饰组：真实 Ctrl+Z 一次 = 撤整组（A+B 两步）----
  await applyEdits('甲A')
  await waitText('T06键基\n甲A')
  await applyEdits('乙B', 'joinPrevious')
  await waitText('T06键基\n甲A乙B')
  state = await command('t06State')
  const groups = state.entries.filter((e) => e.owner === 'addon').map((e) => e.groupId)
  assert.equal(groups.length, 2, `SDK 两笔修饰应记两条目：${JSON.stringify(state.entries)}`)
  assert.equal(groups[0], groups[1], 'A+B 同组（joinPrevious 并组）')
  const undoEvents1 = (await command('events')).filter((e) => e.reason === 1).length
  await press('z')
  await waitText(T0)
  const undoEvents = (await command('events')).filter((e) => e.reason === 1)
  assert.equal(undoEvents.length - undoEvents1, 2, '一次 Ctrl+Z 执行组内两步（事件级证据）')
  assert.equal(await paintText(), T0, 'webview 回流基态')
  const stateAfterGroupUndo = await command('t06State')
  assert.equal(stateAfterGroupUndo.lost, false, '组撤回后协调器不 lost')
  console.log('[PASS] SDK 修饰组经真实 Ctrl+Z 一次撤整组（A+B 两步，生产控制器逐步回流）')

  // ---- 3. IME 组合安全收尾：组合期间的 IME 键（229）不触发撤销；定稿
  // 落地为独立单位后，随后的 Ctrl+Z 在其落地之后执行 ----
  await type('丙')
  await waitText('T06键基\n丙')
  await focus()
  await docEnd()
  await call('Input.imeSetComposition', { text: '合', selectionStart: 1, selectionEnd: 1 })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const composingProbe = await call('Runtime.evaluate', { contextId, returnByValue: true,
    expression: 'JSON.stringify({composing: document.querySelector(".cm-content").textContent.includes("合")})' })
  assert.equal(JSON.parse(composingProbe.result.value).composing, true, 'IME 组合应真实启动（DOM 含组合文本）')
  // 真实 IME 期间按键以 keyCode 229（process key）到达——不映射任何绑定
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Process', code: 'KeyZ', windowsVirtualKeyCode: 229, modifiers: 2 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'KeyZ', windowsVirtualKeyCode: 229, modifiers: 2 })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(await command('text'), 'T06键基\n丙', '组合期间宿主文本不动')
  // 定稿：insertText 提交组合 → compositionend → 净编辑出站；立即 Ctrl+Z——
  // webview 竞态守卫保证 history.request 不早于该编辑落地
  await call('Input.insertText', { text: '合' })
  await press('z')
  await waitText('T06键基\n丙')
  const imeEvents = (await command('events'))
  const undoEv = [...imeEvents].reverse().find((e) => e.reason === 1)
  const applyEv = undoEv ? [...imeEvents].reverse().find((e) => e.reason === undefined && e.version < undoEv.version) : undefined
  assert(applyEv, '组合定稿编辑应落地为宿主事件')
  assert(undoEv && undoEv.version === applyEv.version + 1, `撤销应紧随定稿编辑（undo=${undoEv && undoEv.version} apply=${applyEv && applyEv.version}）`)
  assert.equal(await paintText(), 'T06键基\n丙', 'webview 回流')
  console.log('[PASS] IME 组合期 229 键不触发撤销；定稿落盘后撤销按序执行（安全收尾）')

  // ---- 4. IME 定稿输入 + SDK 修饰组混排后的逐单位回退 ----
  await applyEdits('丁C')
  await waitText('T06键基\n丙丁C')
  await applyEdits('戊D', 'joinPrevious')
  await waitText('T06键基\n丙丁C戊D')
  await focus()
  await docEnd()
  await call('Input.imeSetComposition', { text: '己', selectionStart: 1, selectionEnd: 1 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await call('Input.insertText', { text: '己' })
  await waitText('T06键基\n丙丁C戊D己')
  await press('z')
  await waitText('T06键基\n丙丁C戊D')
  await press('z')
  await waitText('T06键基\n丙')
  console.log('[PASS] IME 定稿输入与 SDK 修饰组分属撤回单位，逐单位回退')

  // ---- 5. 快速连按 Ctrl+Z 恰按单位撤、不多撤 ----
  await type('庚')
  await waitText('T06键基\n丙庚')
  await applyEdits('辛E')
  await waitText('T06键基\n丙庚辛E')
  await applyEdits('壬F', 'joinPrevious')
  await waitText('T06键基\n丙庚辛E壬F')
  const eventsBefore = (await command('events')).filter((e) => e.reason === 1).length
  await press('z'); await press('z')
  await waitText('T06键基\n丙')
  const allUndo = (await command('events')).filter((e) => e.reason === 1)
  assert.equal(allUndo.length - eventsBefore, 3, '连按两次撤 EF 组（两步）与外来庚（一步）——恰三个单位步')
  const stateAfterRapid = await command('t06State')
  assert.equal(stateAfterRapid.lost, false, '连按后协调器不 lost')
  console.log('[PASS] 快速连按按单位推进不多撤（EF 组 2 步 + 外来 1 步）')

  // ---- 6. 指令在途时 Ctrl+Z（提交与撤销并发）：执行时点计算收敛、不 lost ----
  // queue 出 SDK 修饰指令后不等待结局，立即真实 Ctrl+Z——撤销可能落在修饰
  // 落地前或后（F2：计划在执行时点计算）；最多两次按键内收敛回基态
  const snap = await queueOp('snapshot', { instanceId: 'main' })
  const request = { revision: snap.snapshot.revision, changes: [{ offset: snap.snapshot.text.length, length: 0, text: '癸G' }] }
  const inFlightSeq = await command('queue', { op: 'applyEdits', args: { instanceId: 'main', request } })
  await press('z')
  let converged = await command('text') === T0
  for (let i = 0; i < 3 && !converged; i++) {
    await press('z')
    await new Promise((resolve) => setTimeout(resolve, 300))
    converged = await command('text') === T0
  }
  assert.equal(await command('text'), T0, '在途修饰 + 并发撤销应收敛回基态')
  const outcomeResults = await command('collect', { timeoutMs: 8000 })
  const inFlightOutcome = outcomeResults.find((r) => r.seq === inFlightSeq)
  assert(inFlightOutcome, `在途指令应有结局（收到 ${JSON.stringify(outcomeResults)}）`)
  const stateAfterRace = await command('t06State')
  assert.equal(stateAfterRace.lost, false, '并发后协调器不 lost')
  assert.equal(await paintText(), T0, 'webview 回流基态')
  console.log('[PASS] 指令在途时 Ctrl+Z 并发收敛（执行时点计算，不 lost）')

  writeFileSync(path.join(root, 'out/test/355/host-events.json'), JSON.stringify(await command('events'), null, 2))
  writeFileSync(path.join(dir, 'done'), '')
  const code = await host
  assert.equal(code, 0)
  assert.equal(readFileSync(path.join(dir, 'result'), 'utf8'), T0)
} finally {
  if (socket) socket.close()
  writeFileSync(path.join(dir, 'done'), '')
  await host
}
