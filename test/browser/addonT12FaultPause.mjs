// #361 T12 输入回调故障暂停与手动恢复——真实键盘驱动生产链路。
// VSCode 1.82.3 独立桌面 + 回环 CDP：webview 为真实生产 CM6 控制器，
// 键盘事件经 Input.insertText 原生派发。被测对象是 addon-t12 夹具组件
// 经公开 behaviors 面注册的输入行为（inject-mark：^ → -T12-）的故障
// 升级路径（票面「输入回调异常触发全组件暂停」的原生键盘验证）。
// 宿主伴随套件：test/integration/addonT12FaultPauseSuite.ts。
// 场景：
// 1. 贡献放行并重装载后，真实键入 ^ 触发行为修饰（-T12- 插入——原生前置）；
// 2. arm=behavior 后真实键入 ^ → 行为回调抛未捕获异常 → 全组件暂停
//    （宿主 runState faulted、行为目录回收、输入本身仍落文本）；
// 3. 故障后编辑器仍可用：普通键入照常（验收「内置功能仍可用」）；
// 4. 清 arm + 手动重试 + 组件重接入 → 行为目录恢复，真实键入 ^ 再次
//    触发修饰（恢复不自动——按手动意图）。
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
mkdirSync(path.join(root, 'out/test/361'), { recursive: true })
const dir = mkdtempSync(path.join(root, 'out/test/361/host-fixture-'))
const T0 = 'word'
writeFileSync(path.join(dir, 'keyboard.md'), T0)
await build({ entryPoints: [path.join(root, 'test/integration/addonT12FaultPauseSuite.ts')],
  outfile: path.join(root, 'out/test/integration/addonT12FaultPauseSuite.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
const layout = await buildTestAddons({ log: () => {} })
cpSync(layout.t12Addon.distDir, path.join(root, 'test/integration/addonFixtures/addon-t12/dist'), { recursive: true })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/integration/addonT12FaultPauseSuite.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true,
  extraExtensionPaths: [path.join(root, 'test/integration/addonFixtures/addon-t12')] })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
// 宿主模式：Windows 默认独立桌面（不抢前台）；VSIDIAN_TEST_HOST_MODE=
// foreground 时前台直启（独立桌面 HiddenDesktopHost 不可用环境的回退）
const hostMode = process.env.VSIDIAN_TEST_HOST_MODE === 'foreground' ? 'foreground' : 'desktop'
console.log(`[T12 键盘宿主] ${hostMode === 'desktop' ? '独立桌面' : '前台直启'}，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: hostMode, timeoutMs: 420000,
  reportPath: path.join(root, '.vscode-test/addon-t12-fault-pause.log') })
let socket
try {
  const deadline = Date.now() + 60000
  while ((!existsSync(path.join(dir, 'ready')) || !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(existsSync(path.join(dir, 'ready')), '宿主未打开 fixture（或组件未能进入 enabled）')
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
  let contextId
  /** （重）定位 Vsidian webview 的 frame 并建 isolatedWorld——组件重接入
   *  的装载时序下 webview 可能重建（context 失效），失效时重找 */
  async function reinitContext() {
    contextId = undefined
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
    for (const target of list.filter((item) => item.webSocketDebuggerUrl)) {
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
          contextId = world.executionContextId
          return
        }
      }
      socket.close()
    }
  }
  await reinitContext()
  assert(contextId !== undefined, 'CDP 未找到 Vsidian webview 的 .cm-content')
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
  async function waitStatus(expected, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs
    let last
    do {
      last = await command('status')
      if (last?.runState === expected) return last
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < until)
    assert.equal(last?.runState, expected, `运行态应收敛 ${expected}（实际 ${JSON.stringify(last)}）`)
  }
  async function waitArmAck(expected, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs
    let last
    do {
      last = await command('stats')
      if (last?.lastAckArm === expected) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < until)
    assert.equal(last?.lastAckArm, expected, `页面应确认 arm=${JSON.stringify(expected)}（实际 ${JSON.stringify(last?.lastAckArm)}）`)
  }
  async function waitBehavior(expected) {
    const until = Date.now() + 20000
    let last
    do {
      last = await command('behaviorCatalog')
      const hit = (last ?? []).some((entry) => entry.addonId === 'vsidian-test-fixture.addon-t12' && entry.id === 'inject-mark')
      if (hit === expected) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < until)
    assert.fail(`行为目录应${expected ? '含' : '不含'} inject-mark（实际 ${JSON.stringify(last)}）`)
  }
  async function focus() {
    try {
      await call('Runtime.evaluate', { contextId, expression: 'document.querySelector(".cm-content").focus()' })
    } catch {
      // webview 重建（context 失效）——重找 frame/world 后重试
      await reinitContext()
      assert(contextId !== undefined, 'webview 重建后未能重新定位 .cm-content')
      await call('Runtime.evaluate', { contextId, expression: 'document.querySelector(".cm-content").focus()' })
    }
  }
  async function docEnd() {
    await focus()
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
  }
  /** 真实键入（Input.insertText 走生产输入路径，userEvent input.type） */
  async function typeChar(text) { await focus(); await docEnd(); await call('Input.insertText', { text }) }
  async function undo() {
    await focus()
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
  }
  /** 回基态（undo 序列——dirty 文档的外部改写不会被 VSCode 自动重载，
   *  撤回比 closeAllEditors+重开轻；上限防御后仍不符则硬断言） */
  async function resetToBase() {
    for (let i = 0; i < 6 && (await command('text')) !== T0; i++) {
      await undo()
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.equal(await command('text'), T0)
  }

  // ---- 1. 贡献放行并重装载：真实键入 ^ 触发行为修饰 ----
  await command('setContrib', { on: true })
  await command('reRegister')
  await waitStatus('enabled')
  await waitBehavior(true)
  await typeChar('^')
  try {
    await waitText('word^-T12-')
  } catch (err) {
    const stats = await command('behaviorStats')
    throw new Error(`${err.message}；行为探针=${JSON.stringify(stats?.['addonBehaviors'] ?? null)?.slice(0, 600)}`)
  }
  console.log('[PASS] 贡献放行后真实键入触发行为修饰（^ → -T12-）')

  // ---- 2. arm=behavior：真实键入 ^ → 行为回调抛异常 → 全组件暂停 ----
  await resetToBase()
  await command('setArm', { arm: 'behavior' })
  await waitArmAck('behavior')
  await typeChar('^')
  await waitStatus('faulted')
  const faulted = await command('status')
  assert.ok(String(faulted?.faultReason ?? '').includes('behavior-onInput') && String(faulted?.faultReason ?? '').includes('inject-mark'),
    `故障原因应归因行为回调（实际 ${JSON.stringify(faulted)}）`)
  assert.equal(faulted?.enabled, true, '启用偏好不被改写')
  await waitBehavior(false)
  await waitText('word^')  // 输入本身仍落文本（行为链是修饰器不是输入 gate）
  console.log('[PASS] 行为回调异常升级全组件暂停（目录回收、原因归因、偏好保持）')

  // ---- 3. 故障后编辑器仍可用：普通键入照常 ----
  await typeChar('a')
  await waitText('word^a')
  console.log('[PASS] 故障暂停后编辑器仍可用（普通输入不受影响）')

  // ---- 4. 清 arm + 手动重试 + 重接入：行为恢复（不自动重试） ----
  await resetToBase()
  await command('setArm', { arm: null })
  const retry = await command('retry')
  assert.equal(retry, 'ok', `手动重试应受理（实际 ${JSON.stringify(retry)}）`)
  await command('reRegister')
  await waitStatus('enabled')
  await waitBehavior(true)
  await waitArmAck(null)
  await typeChar('^')
  await waitText('word^-T12-')
  console.log('[PASS] 手动重试恢复（行为目录重建、键入修饰回归；不自动重试）')

  writeFileSync(path.join(root, 'out/test/361/host-stats.json'), JSON.stringify(await command('stats'), null, 2))
  writeFileSync(path.join(dir, 'done'), '')
  const code = await host
  assert.equal(code, 0)
} finally {
  if (socket) socket.close()
  writeFileSync(path.join(dir, 'done'), '')
  await host
}
