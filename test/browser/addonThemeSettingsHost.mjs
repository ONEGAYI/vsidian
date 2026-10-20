// #602 主题目录宿主转发——真宿主 + 回环 CDP 设置页 webview DOM 断言。
// 被测链路：设置页 webview 装载即发 addons.themesGet（settingsMain）
// → 宿主 settingsPage 转发（case 'addons.themesGet'——ebdbce84 曾漏，
// 导致「外观 → 主题」只剩默认项）→ 附加组件接线应答
// addons.themesState → webview 渲染主题候选单选。
// 本脚本断言链路终点（用户可见层）：addon-theme 夹具的 aqua 候选真实
// 出现在「外观 → 主题」单选列表——radio 在场、未禁用、有非零布局
// （非 DOM 存在性）。ebdbce84 型回归（漏转发 → webview 等不到目录）
// 必然在此翻红；宿主接线侧另有 _test.addonThemes 前置断言兜底。
// 宿主伴随套件：test/integration/addonThemeSettingsSuite.ts（装夹具、
// 开设置页、等 ready/done）。
// 装配：VSCode 1.82.3 独立桌面 + 回环 CDP；addon-theme 夹具经
// extraExtensionPaths 以真实扩展形态安装（页面产物经构建桥生成拷入）。
// 用法：npm run test:addon-theme-settings-host（独立运行，不在浏览器
// 调度器 names 内——与 test:addon-t07-host 同款真宿主入口）。
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'
import { buildTestHostArgs, runTestHost } from '../integration/testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(path.join(root, 'out/test/602'), { recursive: true })
const dir = mkdtempSync(path.join(root, 'out/test/602/host-fixture-'))
const AQUA = 'vsidian-test-fixture.addon-theme/aqua'
await build({ entryPoints: [path.join(root, 'test/integration/addonThemeSettingsSuite.ts')],
  outfile: path.join(root, 'out/test/602/addonThemeSettingsSuite.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] })
const layout = await buildTestAddons({ log: () => {} })
cpSync(layout.themeAddon.distDir, path.join(root, 'test/integration/addonFixtures/addon-theme/dist'), { recursive: true })
const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const args = buildTestHostArgs({ workspaceDir: dir,
  testsPath: path.join(root, 'out/test/602/addonThemeSettingsSuite.js'),
  extensionPath: root, extensionsDir: path.join(root, '.vscode-test/extensions'),
  userDataDir: path.join(dir, 'user-data'), disableExtensions: true,
  extraExtensionPaths: [path.join(root, 'test/integration/addonFixtures/addon-theme')] })
args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1')
console.log(`[#602 主题目录宿主] 独立桌面，回环 CDP 端口 ${port}，fixture ${dir}；测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
const host = runTestHost({ executable, args, env: { ...process.env, WORKSPACE_DIR: dir,
  VSIDIAN_TEST_HOOKS: '1' }, mode: 'desktop', timeoutMs: 180000,
  reportPath: path.join(root, '.vscode-test/addon-theme-settings-host.log') })
let socket
try {
  const deadline = Date.now() + 90000
  while ((!existsSync(path.join(dir, 'ready')) || !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(existsSync(path.join(dir, 'ready')), '宿主侧前置未收敛（夹具目录登记或设置页就绪失败，详见宿主报告）')
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
      const { resolve: ok, reject } = pending.get(response.id)
      pending.delete(response.id)
      response.error ? reject(new Error(response.error.message)) : ok(response.result)
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
        expression: 'Boolean(document.querySelector(".vsidian-settings-nav-item"))', returnByValue: true,
      }).catch(() => null)
      if (probe?.result?.value === true) {
        found = true; contextId = world.executionContextId; break
      }
    }
    if (found) break
    socket.close()
  }
  assert(found, 'CDP 未找到 Vsidian 设置页 webview（.vsidian-settings-nav-item）')
  const evalWorld = async (expression) => {
    const result = await call('Runtime.evaluate', { contextId, expression, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(`页面求值异常：${JSON.stringify(result.exceptionDetails)}`)
    return result?.result?.value
  }
  // ready 谓词判定采样是否就绪（默认按 truthiness——布尔探针沿用）；
  // 对象采样必须显式传谓词：未就绪对象（{ok:false}）是 truthy，无谓词
  // 会在首采即返回、把「尚未回填」误判成回归（#616 复审 002）。未就绪
  // 采样保留在 last 里，超时报文携带最后采样辅助定位
  const waitFor = async (label, expression, timeout = 30000, ready = (v) => Boolean(v)) => {
    const until = Date.now() + timeout
    let last
    do {
      last = await evalWorld(expression)
      if (ready(last)) return last
      await new Promise((resolve) => setTimeout(resolve, 200))
    } while (Date.now() < until)
    throw new Error(`等待超时：${label}（最后采样 ${JSON.stringify(last)}）`)
  }
  // 外观分页就绪（伴随套件经 openStyleReference 路由；页签按 data-tab
  // 定位——不依赖页签顺序与页面语言）
  await waitFor('外观分页页签挂载', 'Boolean(document.querySelector(\'.vsidian-style-ref-tab[data-tab="presets"]\'))')
  // 切到「主题」页签（真实 click 事件路径——与用户点击同一监听器）
  await evalWorld('document.querySelector(\'.vsidian-style-ref-tab[data-tab="presets"]\').click()')
  // 链路终点断言：aqua 候选出现在单选列表。两态都等满 30 秒：转发断链
  // 时 webview 等不到 themesState、只剩 default——超时翻红；回填稍晚于
  // 页签挂载（settingsPageInfo.ready 只保证设置页 ready）时未就绪对象
  // 经 ok 谓词继续等待，不误判回归（#616 复审 002）。
  // 可见性双证据（#616 复审 003）：非零布局（几何）+ 绘制层——候选
  // label 至文档根逐级计算样式 visibility/display/opacity（含 #app 等
  // 面板上方持久祖先），visibility:hidden / display:none / opacity:0
  // 布局仍在但不可见，仅查高度拦不住
  const sample = await waitFor('主题候选（aqua 单选）渲染', `(() => {
    const panel = document.querySelector('.vsidian-appearance-presets')
    if (!panel || panel.hasAttribute('hidden')) return null
    const aqua = panel.querySelector('input[type=radio][value="${AQUA}"]')
    const def = panel.querySelector('input[type=radio][value="default"]')
    if (!aqua || !def) {
      return { ok: false, aqua: Boolean(aqua), default: Boolean(def), count: panel.querySelectorAll('input[type=radio]').length }
    }
    let painted = true
    for (let el = aqua.closest('label') ?? aqua; el; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) {
        painted = false
        break
      }
    }
    return { ok: true, aquaDisabled: aqua.disabled, aquaVisible: aqua.getBoundingClientRect().height > 0,
      aquaPainted: painted,
      aquaSource: aqua.closest('label')?.querySelector('.vsidian-theme-option-source')?.textContent ?? '',
      defaultChecked: def.checked, count: panel.querySelectorAll('input[type=radio]').length }
  })()`, 30000, (v) => v?.ok === true)
  assert.equal(sample.ok, true, `主题候选应出现在「外观 → 主题」单选列表：${JSON.stringify(sample)}`)
  assert.equal(sample.aquaDisabled, false, `aqua 候选应可用（夹具启用中，available=true）：${JSON.stringify(sample)}`)
  assert.equal(sample.aquaVisible, true, `aqua 候选应有非零布局（用户可见层，非 DOM 存在性）：${JSON.stringify(sample)}`)
  assert.equal(sample.aquaPainted, true, `aqua 候选应绘制可见（候选至文档根无 visibility:hidden/display:none/opacity:0）：${JSON.stringify(sample)}`)
  assert.equal(sample.defaultChecked, true, `干净 profile 下 default 应为选中态（preferred 未设置）：${JSON.stringify(sample)}`)
  console.log(`[PASS] #602 设置页主题目录经真宿主转发回填：aqua 候选可见可用（来源徽章 ${JSON.stringify(sample.aquaSource)}，单选共 ${sample.count} 项）`)
  writeFileSync(path.join(dir, 'done'), '')
  const code = await host
  assert.equal(code, 0, '宿主应正常退出（伴随套件无失败）')
} finally {
  if (socket) socket.close()
  writeFileSync(path.join(dir, 'done'), '')
  await host
}
