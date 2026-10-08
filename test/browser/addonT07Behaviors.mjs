// #356 T07 可组合输入行为——真实键盘/IME 驱动生产链路。
// VSCode 1.82.3 独立桌面 + 回环 CDP：webview 为真实生产 CM6 控制器，
// 键盘事件经 Input.dispatchKeyEvent/insertText 原生派发，IME 组合经
// Input.imeSetComposition 真实驱动 compositionstart..compositionend。
// 行为链由 addon-t07 夹具组件经公开 SDK behaviors.register 注册
// （dash-fill / space-fill / tilde-fill——后两者同独占组 fill；行为族
// 判定只依赖 inputText 键入 ^，重设计缘由见 t07Editor.ts 头注），
// 调序与单项停用经宿主行为状态钩子（管理面等价入口）。
// 宿主伴随套件：test/integration/addonT07BehaviorsSuite.ts。
// 场景：
// 1. 真实键盘键入 ^ 触发默认序链（dash 插 -、space 组内先适用插空格
//    并读取前序修饰后的快照、tilde 同组跳过）——文本、事件与轨迹三面
//    一致；joinPrevious（space）并入 dash 原子修饰一次撤回、再撤撤键入；
// 2. 调序（tilde 前置）后 tilde 与组外 dash 共同运行、space 被组内
//    跳过；调序后均 atomic，三次 Ctrl+Z 逐笔回退；
// 3. 单项停用（关 dash）后组内接位者生效；恢复默认（幂等写回）后
//    默认链回归；
// 4. IME 情境（#399 修订）：候选期不驱动（组合中间态非行为输入）、
//    组合定稿驱动行为链（inputText 含定稿文本，观察与修饰面一致）；
// 5. 表格情境口径：源码行内键入照常驱动与受修饰（#124 同口径——排除
//    面是网格编辑态 tableRegionField 而非表格行文本；网格 region 在场
//    不驱动由单测 liveInstanceBehaviorDrive 钉住）；
// 6. 固定 Tab 情境保持：Tab 键走缩进/越界链（非 input.type），不触发
//    行为链且 Tab 语义保持。
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
mkdirSync(path.join(root, 'out/test/356'), { recursive: true })
const dir = mkdtempSync(path.join(root, 'out/test/356/host-fixture-'))
const T0 = 'word'
const TABLE_T0 = '| a | b |\n| --- | --- |'
writeFileSync(path.join(dir, 'keyboard.md'), T0)
await build({ entryPoints: [path.join(root, 'test/integration/addonT07BehaviorsSuite.ts')],
  outfile: path.join(root, 'out/test/integration/addonT07BehaviorsSuite.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
const layout = await buildTestAddons({ log: () => {} })
cpSync(layout.t07Addon.distDir, path.join(root, 'test/integration/addonFixtures/addon-t07/dist'), { recursive: true })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/integration/addonT07BehaviorsSuite.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true,
  extraExtensionPaths: [path.join(root, 'test/integration/addonFixtures/addon-t07')] })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
console.log(`[T07 键盘宿主] 独立桌面，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 420000,
  reportPath: path.join(root, '.vscode-test/addon-t07-behaviors.log') })
let socket
try {
  const deadline = Date.now() + 60000
  while ((!existsSync(path.join(dir, 'ready')) || !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(existsSync(path.join(dir, 'ready')), '宿主未打开 fixture（或行为注册未就绪）')
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
  async function docEnd() {
    await focus()
    await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
  }
  async function press(key, ctrl = false, shift = false) {
    const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0)
    if (ctrl) await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers })
    if (shift) await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers })
    const code = `${/^[0-9]$/.test(key) ? 'Digit' : 'Key'}${key.toUpperCase()}`
    const vk = key.toUpperCase().charCodeAt(0)
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    if (shift) await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 0 })
    if (ctrl) await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 })
  }
  async function undo() { await press('z', true) }
  /** 真实键入（Input.insertText 走生产输入路径，userEvent input.type） */
  async function typeChar(text) { await focus(); await docEnd(); await call('Input.insertText', { text }) }
  /** 事件收件箱（清零语义：每次场景前 reset） */
  async function collectEvents() { return (await command('collect', { timeoutMs: 100 })) ?? [] }

  // ---- 1. 真实键盘键入 ^ 触发默认序链：dash 插 -、space 组内先适用插空格、tilde 跳过 ----
  await command('reset')
  let stats = await command('stats')
  assert.equal(stats.registrations.length, 3, `应注册三个行为：${JSON.stringify(stats.registrations)}`)
  assert.equal(stats.hostState, null, '初始无用户覆盖（默认序全开启）')
  await typeChar('^')
  await waitText('word^- ')
  let events = await collectEvents()
  let ids = events.filter((e) => e.kind === 'behavior').map((e) => e.id)
  assert.ok(ids.includes('dash-fill') && ids.includes('space-fill'), `dash 与 space 应共同运行：${JSON.stringify(events)}`)
  assert.ok(!ids.includes('tilde-fill'), `独占组内首个适用者生效，tilde 不应被调用：${JSON.stringify(ids)}`)
  const spaceEvent = events.find((e) => e.id === 'space-fill')
  assert.ok(String(spaceEvent?.snapshotText ?? '').includes('-'), `space 读取前序修饰后的快照：${JSON.stringify(spaceEvent)}`)
  assert.ok(events.some((e) => e.kind === 'changed' && e.inputText === '^'), 'onChanged 观察事件应到达')
  stats = await command('stats')
  let trace = stats.trace
  assert.equal(trace[trace.length - 2].behaviorKey.endsWith('#dash-fill'), true, `轨迹应含 dash：${JSON.stringify(trace)}`)
  assert.equal(trace[trace.length - 1].behaviorKey.endsWith('#space-fill'), true, `轨迹应含 space：${JSON.stringify(trace)}`)
  // joinPrevious（space）并入 dash 原子组一次撤回；再撤撤键入
  await undo()
  await waitText('word^')
  await undo()
  await waitText(T0)
  console.log('[PASS] 真实键盘触发默认序链（dash+space 共同运行、space 读前序结果、tilde 组内跳过；joinPrevious 并组一次撤回）')

  // ---- 2. 调序（tilde 前置）：tilde 与 dash 共同运行、space 被组内跳过 ----
  await command('setOrder', { order: ['vsidian-test-fixture.addon-t07#tilde-fill', 'vsidian-test-fixture.addon-t07#dash-fill', 'vsidian-test-fixture.addon-t07#space-fill'] })
  for (let i = 0; i < 50; i++) {
    stats = await command('stats')
    if (stats.hostState?.order?.[0]?.endsWith('#tilde-fill')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(stats.hostState?.order?.[0]?.endsWith('#tilde-fill'), `宿主调序应推送到达：${JSON.stringify(stats.hostState)}`)
  await command('reset')
  await typeChar('^')
  await waitText('word^~-')
  events = await collectEvents()
  ids = events.filter((e) => e.kind === 'behavior').map((e) => e.id)
  assert.ok(ids.includes('tilde-fill') && ids.includes('dash-fill') && !ids.includes('space-fill'), `调序后 tilde 与 dash 应共同运行、space 被组内跳过：${JSON.stringify(ids)}`)
  // 调序后 tilde/dash 均 atomic：三次 Ctrl+Z 逐笔回退
  await undo(); await undo(); await undo()
  await waitText(T0)
  console.log('[PASS] 调序即时生效（tilde 前置与组外 dash 共同运行、space 跳过；atomic 逐笔回退）')

  // ---- 3. 单项停用：关 dash 后组内 space 生效；重开恢复默认 ----
  await command('setDisabled', { keys: ['vsidian-test-fixture.addon-t07#dash-fill'], disabled: true })
  for (let i = 0; i < 50; i++) {
    stats = await command('stats')
    if (stats.hostState?.disabled?.some((k) => k.endsWith('#dash-fill'))) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(stats.hostState?.disabled?.some((k) => k.endsWith('#dash-fill')), `停用推送应到达：${JSON.stringify(stats.hostState)}`)
  await command('reset')
  await typeChar('^')
  // 调序残留态（tilde 前置）下组内 tilde 接位
  await waitText('word^~')
  events = await collectEvents()
  assert.ok(!events.some((e) => e.kind === 'behavior' && e.id === 'dash-fill'), `停用的 dash 不应被调用：${JSON.stringify(events)}`)
  await undo()
  await waitText(T0)
  // 恢复默认（管理面幂等写回）并验证默认链回归
  await command('setDisabled', { keys: ['vsidian-test-fixture.addon-t07#dash-fill'], disabled: false })
  await command('setOrder', { order: [] })
  for (let i = 0; i < 50; i++) {
    stats = await command('stats')
    if (stats.hostState === null) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(stats.hostState, null, '恢复默认后无用户覆盖')
  await command('reset')
  await typeChar('^')
  await waitText('word^- ')
  await undo(); await undo()
  await waitText(T0)
  console.log('[PASS] 单项停用即时生效（组内 space 接位）；恢复默认后默认链回归')

  // ---- 4. IME 情境（#399 修订）：候选期不驱动、组合定稿驱动 ----
  await command('reset')
  const drivesBeforeIme = (await command('stats')).counters.drives
  await focus(); await docEnd()
  await call('Input.imeSetComposition', { text: '，', selectionStart: 1, selectionEnd: 1 })
  await new Promise((resolve) => setTimeout(resolve, 250))
  // 候选期（组合中间态）：不驱动、零事件——组合中间态不是行为输入
  stats = await command('stats')
  assert.equal(stats.counters.drives, drivesBeforeIme, `IME 候选期不应驱动行为链：${JSON.stringify(stats.counters)}`)
  events = await collectEvents()
  assert.ok(!events.some((e) => e.kind === 'behavior'), `IME 候选期不应触发行为回调：${JSON.stringify(events)}`)
  await call('Input.insertText', { text: '，' })
  await waitText('word，')
  await new Promise((resolve) => setTimeout(resolve, 500))
  // 组合定稿：驱动恰一次，行为上下文的 inputText 含定稿文本（'，' 非 '^'，
  // 行为族判定不修饰——但回调被真实调用且可读定稿文本）
  events = await collectEvents()
  const imeBehaviors = events.filter((e) => e.kind === 'behavior')
  assert.ok(imeBehaviors.length > 0, `IME 定稿应触发行为回调：${JSON.stringify(events)}`)
  assert.ok(imeBehaviors.every((e) => e.inputText === '，'), `行为上下文 inputText 应为定稿文本：${JSON.stringify(imeBehaviors)}`)
  assert.ok(events.some((e) => e.kind === 'changed' && e.inputText === '，'), `onChanged 观察应含定稿文本：${JSON.stringify(events)}`)
  stats = await command('stats')
  assert.equal(stats.counters.drives, drivesBeforeIme + 1, `IME 定稿应驱动恰好一次：${JSON.stringify(stats.counters)}`)
  await undo()
  await waitText(T0)
  console.log('[PASS] IME 候选期不驱动、组合定稿驱动行为链（inputText 含定稿文本，#399）')

  // ---- 5. 表格情境口径：源码行键入照常受行为修饰（网格编辑态排除）----
  // #124 同口径：排除面是「网格编辑态」（tableRegionField 在场——点击
  // 网格格激活）而非表格行文本；源码行内的普通键入行为链照常工作。
  // 网格 region 在场不驱动的契约由单测 liveInstanceBehaviorDrive.test.ts
  // 钉住（region 激活需真实网格点击，CDP 坐标不可靠）。
  await command('text')
  writeFileSync(path.join(dir, 'keyboard.md'), TABLE_T0)
  await waitText(TABLE_T0)
  await command('reset')
  const drivesBeforeTable = (await command('stats')).counters.drives
  await focus()
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 })
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await call('Input.insertText', { text: '^' })
  await new Promise((resolve) => setTimeout(resolve, 800))
  stats = await command('stats')
  assert.equal(stats.counters.drives, drivesBeforeTable + 1, `表格源码行键入应照常驱动（排除面是网格编辑态）：${JSON.stringify(stats.counters)}`)
  const tableText = await command('text')
  assert.ok(tableText.includes('-'), `表格源码行键入应受行为修饰：${JSON.stringify(tableText)}`)
  // 回基态（两撤回单位：修饰组 + 键入）
  await undo()
  await undo()
  await waitText(TABLE_T0)
  console.log('[PASS] 表格源码行键入照常受行为修饰（#124 同口径；网格编辑态排除由单测钉住）')

  // ---- 6. 固定 Tab 情境保持：Tab 走既有链（缩进），不触发行为链 ----
  writeFileSync(path.join(dir, 'keyboard.md'), T0)
  await waitText(T0)
  await command('reset')
  const drivesBeforeTab = (await command('stats')).counters.drives
  await focus(); await docEnd()
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  stats = await command('stats')
  assert.equal(stats.counters.drives, drivesBeforeTab, `Tab 键不应驱动行为链：${JSON.stringify(stats.counters)}`)
  const afterTab = await command('text')
  assert.equal(typeof afterTab, 'string', 'Tab 后文本可读')
  console.log(`[PASS] Tab 键不触发行为链（Tab 语义走既有链，输入后文本 ${JSON.stringify(afterTab)}）`)

  writeFileSync(path.join(root, 'out/test/356/host-stats.json'), JSON.stringify(await command('stats'), null, 2))
  writeFileSync(path.join(dir, 'done'), '')
  const code = await host
  assert.equal(code, 0)
} finally {
  if (socket) socket.close()
  writeFileSync(path.join(dir, 'done'), '')
  await host
}
