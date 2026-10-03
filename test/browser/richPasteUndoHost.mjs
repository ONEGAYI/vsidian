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
const dir = mkdtempSync(path.join(root, 'out/test/307/host-fixture-'))
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
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 180000,
  reportPath: path.join(root, '.vscode-test/rich-paste-undo-host.log') })
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

  async function clipboard(text, html) {
    await evaluate('document.querySelector(".cm-content").focus()')
    await evaluate(`navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob([${JSON.stringify(text)}],{type:"text/plain"}),"text/html":new Blob([${JSON.stringify(html)}],{type:"text/html"})})])`)
  }
  async function paste(text, html) { await clipboard(text,html); await press('a'); await press('v') }
  async function state(expected, panelIndex=0) {
    const until=Date.now()+5000
    let value
    do { value=await command('paint',{panelIndex}); if(value?.text===expected && !value.suspended)return value }while(Date.now()<until)
    assert.equal(value?.text,expected);assert.equal(value?.suspended,false);return value
  }
  async function setText(text) { await command('replaceText',{text});await waitText(text);await state(text) }
  async function type(text) { await evaluate('document.querySelector(".cm-content").focus()');await call('Input.insertText',{text}) }
  async function refreshContexts() {
    const currentTargets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())
    const contexts=[]
    let selectedSocket=socket,selectedContext=contextId
    for(const target of currentTargets.filter(t=>t.type==='iframe'&&t.webSocketDebuggerUrl)){
      await connect(target)
      const tree=await call('Page.getFrameTree').catch(()=>null),frames=[]
      function collect(node){if(!node)return;frames.push(node.frame);for(const child of node.childFrames??[])collect(child)}collect(tree?.frameTree)
      let candidate
      for(const frame of frames){const world=await call('Page.createIsolatedWorld',{frameId:frame.id}).catch(()=>null);if(!world)continue
        const probe=await call('Runtime.evaluate',{contextId:world.executionContextId,expression:'Boolean(document.querySelector(".cm-content"))',returnByValue:true}).catch(()=>null)
        if(probe?.result?.value){candidate=world.executionContextId;break}
      }
      if(candidate){selectedSocket.close();selectedSocket=socket;selectedContext=candidate;contexts.push(candidate)}else socket.close()
    }
    socket=selectedSocket;contextId=selectedContext;assert(contexts.length);return contexts
  }
  await command('preferences',{values:{'editor.pasteAskBefore':false,'editor.pasteSplitUndo':true}})
  await paste('new','<b>new</b>');await waitText('**new**')
  let value=await state('**new**');assert.equal(value.paint.toast.visible,true);assert.equal(value.paint.toast.severity,'neutral')
  let undoCount=(await command('events')).filter(e=>e.reason===1).length
  await press('z');await waitText('new');value=await state('new')
  assert.equal((await command('events')).filter(e=>e.reason===1).length-undoCount,1,'一次CtrlZ仅一笔真实Undo事件')
  assert.equal(value.paint.toast.visible,true);assert.match(value.paint.toast.text,/再撤销一次|Undo again/);assert.equal(value.paint.toast.severity,'neutral')
  await press('z');await waitText('word');value=await state('word')
  assert.equal(value.paint.toast.visible,false);assert.equal(value.selectionOffset,0);assert.equal(value.selectionHead,4)
  const redoCount=(await command('events')).filter(e=>e.reason===2).length
  await press('y');await waitText('new');assert.equal((await command('events')).filter(e=>e.reason===2).length-redoCount,1)
  await press('y');await waitText('**new**')
  console.log('[PASS] 真实宿主 A(word)→B(new)→C(**new**) 两次Undo/Redo；首次neutral绘制，第二次清理并恢复替换前选区')
  undoCount=(await command('events')).filter(e=>e.reason===1).length
  await press('z');await press('z');await waitText('word');assert.equal((await command('events')).filter(e=>e.reason===1).length-undoCount,2)
  assert.equal((await state('word')).paint.toast.visible,false)
  await press('y');await press('y');await waitText('**new**');assert.equal((await state('**new**')).paint.toast.visible,false)
  console.log('[PASS] 快速连续Undo/Redo没有过期成功或撤格式引导')
  await setText('word');await evaluate('document.querySelector(".cm-content").focus()');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35})
  await type('!');await paste('next','<i>next</i>');await type('後');await waitText('*next*後')
  await press('z');await waitText('*next*');assert.equal((await state('*next*')).paint.toast.visible,false)
  await press('z');await waitText('next');assert.match((await state('next')).paint.toast.text,/再撤销一次|Undo again/)
  await press('z');await waitText('word!');await press('z');await waitText('word')
  console.log('[PASS] 前后快速输入与粘贴两个阶段分别撤销，后续输入先撤，不跳历史')
  await paste('one','<b>one</b>');await waitText('**one**');await paste('two','<i>two</i>');await waitText('*two*')
  for(const expected of ['two','**one**','one','word']){await press('z');await waitText(expected);await state(expected)}
  assert.equal((await state('word')).paint.toast.visible,false)
  console.log('[PASS] 连续两次富文本替换各自保持两个宿主历史阶段')
  await command('preferences',{values:{'editor.pasteSplitUndo':false}})
  await paste('single','<b>single</b>');await waitText('**single**');await press('z');await waitText('word');await press('y');await waitText('**single**')
  await type('!');await waitText('**single**!');await press('z');await waitText('**single**');await press('z');await waitText('word')
  assert.equal((await state('word')).paint.toast.visible,false)
  await command('preferences',{values:{'editor.pasteSplitUndo':true}})
  await setText('new');await paste('new','<b>new</b>');await waitText('**new**');await press('z');await waitText('new')
  assert.equal((await state('new')).paint.toast.visible,false)
  await paste('**equal**','<b>equal</b>');await waitText('**equal**');await press('z');await waitText('new')
  console.log('[PASS] 关闭分步 A↔C；A=B 无空文本步骤和误导；B=C 无空格式步骤')
  await command('split')
  const splitDeadline=Date.now()+10000
  let panelInfo
  do { panelInfo=await command('panels');if(panelInfo?.panels?.filter(p=>p.ready).length===2)break;await new Promise(r=>setTimeout(r,100)) }while(Date.now()<splitDeadline)
  console.log('[多面板探针]',JSON.stringify(panelInfo))
  assert.equal(panelInfo?.panels?.filter(p=>p.ready).length,2)
  const contexts=await refreshContexts();assert.equal(contexts.length,2)
  await paste('peer','<b>peer</b>');await waitText('**peer**');await state('**peer**',0);await state('**peer**',1)
  await press('z');await waitText('peer');await state('peer',0);await state('peer',1)
  await press('z');await waitText('new');await state('new',0);await state('new',1)
  await press('y');await press('y');await waitText('**peer**');await state('**peer**',0);await state('**peer**',1)
  console.log('[PASS] 两个真实custom editor面板在A/B/C和Undo/Redo上共同回流')
  await command('source');await command('sourceEnd');await command('sourceType',{text:'x'});await command('sourceType',{text:'y'});await command('sourceType',{text:'z'})
  await waitText('**peer**xyz');await command('undo');await waitText('**peer**');await command('undo');await waitText('peer');await command('undo');await waitText('new')
  await command('redo');await waitText('peer');await command('redo');await waitText('**peer**')
  await command('live');await new Promise(r=>setTimeout(r,350));await refreshContexts();await state('**peer**')
  const events=await command('events');assert(events.some(event=>event.reason===1&&event.text==='peer'));assert(events.some(event=>event.reason===2&&event.text==='**peer**'))
  console.log('[PASS] 切源码连续type合并一笔Undo，随后B/A及Redo仍由实际TextDocument reason回流；重开Live一致')
  writeFileSync(path.join(root,'out/test/307/host-events.json'),JSON.stringify(events,null,2))
  writeFileSync(path.join(dir,'done'),'');const code=await host;assert.equal(code,0)
  assert.equal(readFileSync(path.join(dir,'result'),'utf8'),'**peer**')
} finally {
  if(socket)socket.close()
  writeFileSync(path.join(dir,'done'),'')
  await host
}
