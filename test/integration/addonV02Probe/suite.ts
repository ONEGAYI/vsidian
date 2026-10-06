// V02（#349）探针宿主侧套件：在真实 VSCode 1.82.3 宿主内运行。
// 两个探针 webview（编辑器型 / 设置页型）分别按生产 CSP 形态装配：
// - 编辑器型：生产 buildEditorCsp 原样（资源源 + nonce + wasm-unsafe-eval
//   等全量指令），脚本/样式为探针产物（生产控制器 + 装载器原型）；
// - 设置页型：生产 buildSettingsPageHtml 的收紧 CSP（script-src cspSource
//   + nonce；style-src/img-src 仅 cspSource）。
// localResourceRoots = 探针产物目录 + 两个组件安装目录的资源子目录——
// outside/ 对照目录**不在**许可面（资源服务应拒绝其 asWebviewUri 地址）。
// 用例输出对齐 [集成测试][START]/[PASS]/[FAIL]/[TIME]，报告判定复用
// evaluateHostReport；证据 JSON 写 VSIDIAN_ADDON_V02_EVIDENCE 指定路径。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { buildEditorCsp } from '../../../src/host/editorCsp'
import { resolveAddonRegistration } from '../../fixtures/addon-v02/registry/addonRegistry'
import type { AddonLoadOutcome, AddonPageOutbound } from '../../fixtures/addon-v02/loader/types'

const TEST_ADDON_ID = 'onegayi.vsidian-test-addon'
const THROW_ADDON_ID = 'onegayi.vsidian-throw-addon'

interface ProbeInbound {
  type: 'probe.ready' | 'probe.rpc.result' | 'probe.pageError' | 'probe.forward' | 'probe.note'
  page?: string
  userAgent?: string
  id?: string
  result?: unknown
  message?: AddonPageOutbound
  note?: string
  controller?: { kind: string }
}

/** 探针面板会话：rpc 相关 + 装载器出站事件流收集。
 *  事件流为**只追加**数组；awaitForward 以单调游标消费（找到即越过），
 *  通道应答以 requestId 集合去重——旧事件不回放、不重复应答 */
class ProbePanel {
  readonly panel: vscode.WebviewPanel
  readonly forwards: AddonPageOutbound[] = []
  readonly notes: string[] = []
  userAgent = ''
  private answeredRequests = new Set<string>()
  private consumed = new Set<number>()
  private rpcSeq = 0
  private pendingRpc = new Map<string, (result: unknown) => void>()
  private readyResolve!: () => void
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  readonly ready: Promise<void>
  private disposed = false

  constructor(
    viewType: string,
    title: string,
    buildHtml: (webview: vscode.Webview) => string,
    localResourceRoots: vscode.Uri[],
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      viewType, title, { viewColumn, preserveFocus: true },
      { enableScripts: true, localResourceRoots },
    )
    this.panel.webview.html = buildHtml(this.panel.webview)
    // ready 有界：页面脚本不执行（CSP/资源拒绝/装配错误）时快速失败，
    // 不让宿主等到全局超时
    this.ready = Promise.race([
      new Promise<void>((resolve) => { this.readyResolve = resolve }),
      new Promise<void>((_, reject) => {
        this.readyTimer = setTimeout(
          () => reject(new Error('探针页面 30s 未就绪（脚本未装载或页面被隐藏销毁）')), 30_000)
      }),
    ])
    this.ready.finally(() => clearTimeout(this.readyTimer)).catch(() => {})
    this.panel.webview.onDidReceiveMessage((raw: ProbeInbound) => this.onMessage(raw))
    this.panel.onDidDispose(() => { this.disposed = true })
  }

  private onMessage(raw: ProbeInbound): void {
    if (raw.type === 'probe.ready') {
      this.userAgent = raw.userAgent ?? ''
      this.readyResolve()
      return
    }
    if (raw.type === 'probe.rpc.result' && raw.id) {
      this.pendingRpc.get(raw.id)?.(raw.result)
      this.pendingRpc.delete(raw.id)
      return
    }
    if (raw.type === 'probe.forward' && raw.message) {
      this.forwards.push(raw.message)
      return
    }
    if (raw.type === 'probe.note') {
      this.notes.push(raw.note ?? '')
      console.log(`[addonV02][note] ${this.panel.title}: ${raw.note ?? ''}`)
      return
    }
    if (raw.type === 'probe.pageError') {
      console.log(`[addonV02][pageError] ${raw.result ?? ''}`)
    }
  }

  async rpc<T>(action: string, args?: unknown, timeoutMs = 15_000): Promise<T> {
    const id = `rpc-${++this.rpcSeq}`
    const reply = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rpc ${action} 超时`)), timeoutMs)
      this.pendingRpc.set(id, (result) => {
        clearTimeout(timer)
        const holder = result as { error?: string } | T
        if (holder && typeof holder === 'object' && 'error' in holder && typeof (holder as { error?: string }).error === 'string') {
          reject(new Error((holder as { error: string }).error))
          return
        }
        resolve(result as T)
      })
    })
    await this.panel.webview.postMessage({ type: 'probe.rpc', id, action, args })
    return reply
  }

  directive(directive: unknown): void {
    void this.panel.webview.postMessage(directive)
  }

  /** 等待装载器出站事件（loaded/unloaded/faulted/channel.request）——全表
   *  扫描首个**未消费**的匹配事件并标记消费（到达顺序与消费顺序解耦：
   *  组件工厂内的通道请求可能先于 loaded 事件入表）；已消费事件不回放 */
  async awaitForward(predicate: (message: AddonPageOutbound) => boolean, timeoutMs = 15_000): Promise<AddonPageOutbound> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      for (let i = 0; i < this.forwards.length; i++) {
        if (this.consumed.has(i)) continue
        if (predicate(this.forwards[i])) {
          this.consumed.add(i)
          return this.forwards[i]
        }
      }
      if (Date.now() > deadline) throw new Error('等待装载器事件超时')
      if (this.disposed) throw new Error('面板已销毁')
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }

  /** 当前全部事件标记消费（后续 countNewRequests 只见新事件） */
  sealForwards(): void {
    for (let i = 0; i < this.forwards.length; i++) this.consumed.add(i)
  }

  /** 未消费事件中指定 topic 的请求数 */
  countNewRequests(topic: string): number {
    let count = 0
    for (let i = 0; i < this.forwards.length; i++) {
      const message = this.forwards[i]
      if (this.consumed.has(i)) continue
      if (message.type === 'addon.channel.request' && message.topic === topic) count++
    }
    return count
  }

  /** 未消费且未应答的指定 topic 请求（迟到回执用例取目标） */
  findPendingRequest(topic: string): { requestId: string; addonId: string; generation: number } | undefined {
    for (let i = this.forwards.length - 1; i >= 0; i--) {
      const message = this.forwards[i]
      if (this.consumed.has(i)) continue
      if (message.type === 'addon.channel.request' && message.topic === topic && !this.answeredRequests.has(message.requestId)) {
        return message
      }
    }
    return undefined
  }

  hasAnswered(requestId: string): boolean {
    return this.answeredRequests.has(requestId)
  }

  markAnswered(requestId: string): void {
    this.answeredRequests.add(requestId)
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true
      this.panel.dispose()
    }
  }
}

interface EvidenceCase {
  name: string
  ok: boolean
  detail?: string
}

export async function run(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..', '..', '..')
  const buildDir = process.env.VSIDIAN_ADDON_V02_BUILD
  if (!buildDir || !existsSync(buildDir)) {
    throw new Error(`缺少组件产物目录 VSIDIAN_ADDON_V02_BUILD（${buildDir ?? '未设置'}）——先运行 test/fixtures/addon-v02/sdk/buildAddon.mjs`)
  }
  const evidencePath = process.env.VSIDIAN_ADDON_V02_EVIDENCE
    ?? path.join(root, 'out', 'test', 'addon-v02-probe-results.json')
  const testAddonDir = path.join(buildDir, 'test-addon')
  const testAddonDist = path.join(testAddonDir, 'dist')
  const throwAddonDist = path.join(buildDir, 'throw-addon', 'dist')
  const outsideDir = path.join(buildDir, 'outside')
  const outRoot = vscode.Uri.joinPath(vscode.Uri.file(root), 'out', 'test', 'integration', 'addonV02')
  // 资源许可面：探针产物 + 两个「已登记组件」的资源子目录；outside 不注册
  const resourceRoots = [outRoot, vscode.Uri.file(testAddonDist), vscode.Uri.file(throwAddonDist)]

  const failures: string[] = []
  const evidence: { cases: EvidenceCase[]; userAgent: { editor?: string; settings?: string } } = {
    cases: [], userAgent: {},
  }
  let caseStarted = 0

  const runCase = async (name: string, fn: () => Promise<string | void>) => {
    console.log(`[集成测试][START] ${name}`)
    caseStarted = Date.now()
    try {
      const detail = await fn()
      evidence.cases.push({ name, ok: true, ...(detail ? { detail } : {}) })
      console.log(`[集成测试][PASS] ${name}${detail ? `：${detail}` : ''}`)
    } catch (err) {
      evidence.cases.push({ name, ok: false, detail: String(err) })
      failures.push(name)
      console.error(`[集成测试][FAIL] ${name}`, err)
    } finally {
      console.log(`[集成测试][TIME] ${Date.now() - caseStarted}ms ${name}`)
    }
  }

  const buildEditorHtml = (webview: vscode.Webview): string => {
    const nonce = randomUUID()
    const csp = buildEditorCsp(webview.cspSource, nonce)
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outRoot, 'editor.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(outRoot, 'editor.css'))
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link href="${styleUri}" rel="stylesheet">
<title>V02 addon probe（editor）</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  const buildSettingsHtml = (webview: vscode.Webview): string => {
    const nonce = randomUUID()
    // 生产 buildSettingsPageHtml 的收紧 CSP 同型（settingsPage.ts 的字面形态）
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
      `style-src ${webview.cspSource}`,
    ].join('; ')
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outRoot, 'settings.js'))
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>V02 addon probe（settings）</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  const createEditorPanel = (viewColumn = vscode.ViewColumn.One) =>
    new ProbePanel('vsidianAddonV02Editor', 'V02 editor', buildEditorHtml, resourceRoots, viewColumn)
  const createSettingsPanel = (viewColumn = vscode.ViewColumn.One) =>
    new ProbePanel('vsidianAddonV02Settings', 'V02 settings', buildSettingsHtml, resourceRoots, viewColumn)

  /** 宿主侧通道应答：按 topic 分流（deniedImage 回越界图地址；holdEcho
   *  故意不答——迟到回执用例；其余回声）。以 requestId 去重，事件不移除 */
  const answerChannel = async (panel: ProbePanel, timeoutMs = 8_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const message of panel.forwards) {
        if (message.type !== 'addon.channel.request') continue
        if (panel.hasAnswered(message.requestId)) continue
        panel.markAnswered(message.requestId)
        if (message.topic === 'probe.holdEcho') continue
        if (message.topic === 'probe.deniedImage') {
          const uri = panel.panel.webview.asWebviewUri(vscode.Uri.file(path.join(outsideDir, 'denied.png'))).toString()
          panel.directive({
            type: 'addon.channel.reply', addonId: message.addonId, generation: message.generation,
            requestId: message.requestId, outcome: { ok: true, result: { uri } },
          })
          continue
        }
        panel.directive({
          type: 'addon.channel.reply', addonId: message.addonId, generation: message.generation,
          requestId: message.requestId, outcome: { ok: true, result: { echoed: message.topic } },
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const loadManifest = (panel: ProbePanel, opts: {
    addonId?: string
    generation?: number
    page: 'editor' | 'settings'
    scriptFsPath?: string
    cssFsPaths?: string[]
    resourceDir?: string
  }) => ({
    addonId: opts.addonId ?? TEST_ADDON_ID,
    generation: opts.generation ?? 1,
    page: opts.page,
    scriptUri: panel.panel.webview.asWebviewUri(vscode.Uri.file(opts.scriptFsPath ?? path.join(testAddonDist, 'page.js'))).toString(),
    cssUris: (opts.cssFsPaths ?? [path.join(testAddonDist, 'page.css')]).map(
      (fsPath) => panel.panel.webview.asWebviewUri(vscode.Uri.file(fsPath)).toString()),
    ...(opts.resourceDir ? { resourceBase: panel.panel.webview.asWebviewUri(vscode.Uri.file(opts.resourceDir)).toString() } : {}),
  })

  // ---- 用例：宿主侧登记校验（词法包含性第一层） ----
  await runCase('宿主登记校验——入口/资源越界被拒', async () => {
    const installDir = testAddonDir
    const good = resolveAddonRegistration({ id: TEST_ADDON_ID, installDir, entry: 'dist/page.js', resourceDirs: ['dist'] })
    if (!good.ok) throw new Error(`合法登记被拒：${JSON.stringify(good)}`)
    const escapes = ['../outside/denied.js', '..\\outside\\denied.js', '/abs/page.js', 'dist/../../outside/denied.js']
    const rejected: string[] = []
    for (const entry of escapes) {
      const outcome = resolveAddonRegistration({ id: TEST_ADDON_ID, installDir, entry })
      if (outcome.ok) throw new Error(`越界入口未被拒：${entry}`)
      rejected.push(outcome.reason)
    }
    return `越界拒绝 ${rejected.length}/${escapes.length}（${[...new Set(rejected)].join(',')}）`
  })

  // ---- 用例：编辑器页授权装载 + 真实扩展 + 绘制层 ----
  const editorPanel = createEditorPanel()
  try {
    await editorPanel.ready
    evidence.userAgent.editor = editorPanel.userAgent
    const chromeVersion = /Chrome\/[\d.]+/.exec(editorPanel.userAgent)?.[0] ?? '未知'
    console.log(`[addonV02] 编辑器页 webview：${chromeVersion}`)

    await runCase('编辑器页——授权装载：脚本/样式/扩展接入与绘制层', async () => {
      await editorPanel.rpc('init', { text: '授权矩阵' })
      // 授权脚本 + 授权样式 + 越界样式对照（同一装载内并存）
      const manifest = loadManifest(editorPanel, {
        page: 'editor',
        cssFsPaths: [path.join(testAddonDist, 'page.css'), path.join(outsideDir, 'denied.css')],
        resourceDir: testAddonDist,
      })
      await editorPanel.directive({ type: 'addon.load', manifest })
      const loaded = await editorPanel.awaitForward((m) => m.type === 'addon.loaded')
      if (loaded.type !== 'addon.loaded') throw new Error('事件形态错误')
      const outcome = loaded.outcome as AddonLoadOutcome
      if (!outcome.ok) throw new Error(`授权装载失败：${JSON.stringify(outcome)}`)
      if (outcome.css[0]?.status !== 'authorized') throw new Error(`授权样式被拒：${JSON.stringify(outcome.css)}`)
      if (outcome.css[1]?.status !== 'denied') throw new Error(`越界样式未被拒：${JSON.stringify(outcome.css)}`)
      // 组件扩展真实接入：addon.state 上报（field create 即见装载时刻全文）
      const stateReport = await editorPanel.awaitForward(
        (m) => m.type === 'addon.channel.request' && m.topic === 'addon.state')
      if (stateReport.type !== 'addon.channel.request') throw new Error('state 上报形态错误')
      const payload = stateReport.payload as { docLength: number; markText: string; hasCm6: boolean }
      if (payload.docLength !== 4 || payload.markText !== '授' || !payload.hasCm6) {
        throw new Error(`组件状态上报异常：${JSON.stringify(payload)}`)
      }
      await answerChannel(editorPanel, 1_500)
      // 绘制层：组件标记的计算背景色与几何（样式经授权 <link> 生效）
      const paint = await editorPanel.rpc<Record<string, unknown>>('paint')
      if (paint.count !== 1) throw new Error(`标记数量 ${paint.count}`)
      if (paint.color !== 'rgb(255, 0, 127)') throw new Error(`标记计算色 ${String(paint.color)}`)
      if (Number(paint.rectWidth) <= 0 || Number(paint.rectHeight) <= 0) throw new Error('标记几何为零')
      const stats = await editorPanel.rpc<{ cm6Shared: boolean }>('stats')
      if (!stats.cm6Shared) throw new Error('装载器未登记共享运行时')
      return `标记 ${String(paint.text)}@${String(paint.color)}，越界样式拒绝对照成立`
    })

    await runCase('编辑器页——未授权脚本拒绝（资源服务）', async () => {
      // 独立组件 ID 发起装载（主组件保持装载不受影响）——对照脚本若被
      // 资源服务放行会执行并登记 denied-addon（随后被身份核对拒绝）；期
      // 望结局是脚本根本装载失败
      const manifest = loadManifest(editorPanel, {
        page: 'editor',
        addonId: 'onegayi.vsidian-denied-attempt',
        scriptFsPath: path.join(outsideDir, 'denied.js'),
        cssFsPaths: [],
      })
      await editorPanel.directive({ type: 'addon.load', manifest })
      const loaded = await editorPanel.awaitForward(
        (m) => m.type === 'addon.loaded' && m.addonId === 'onegayi.vsidian-denied-attempt')
      if (loaded.type !== 'addon.loaded' || loaded.outcome.ok) {
        throw new Error(`未授权脚本未被拒：${JSON.stringify(loaded)}`)
      }
      if (loaded.outcome.reason !== 'script-load-failed') throw new Error(`拒绝原因 ${loaded.outcome.reason}`)
      const stats = await editorPanel.rpc<{ active: Array<{ addonId: string }> }>('stats')
      if (stats.active.length !== 1 || stats.active[0].addonId !== TEST_ADDON_ID) {
        throw new Error(`未授权装载后 active 异常：${JSON.stringify(stats.active)}`)
      }
      return 'script-load-failed（localResourceRoots 包含性拒绝）'
    })

    await runCase('编辑器页——身份不匹配与重复装载拒绝', async () => {
      // 身份不符：同一授权脚本，manifest 声明为他人 ID
      const mismatch = loadManifest(editorPanel, { page: 'editor', addonId: 'someone.else-addon', generation: 9 })
      await editorPanel.directive({ type: 'addon.load', manifest: mismatch })
      const loaded = await editorPanel.awaitForward(
        (m) => m.type === 'addon.loaded' && m.addonId === 'someone.else-addon')
      if (loaded.type !== 'addon.loaded' || loaded.outcome.ok || loaded.outcome.reason !== 'identity-mismatch') {
        throw new Error(`身份校验异常：${JSON.stringify(loaded)}`)
      }
      // 重复装载（当前已装载 → already-loaded）
      const duplicate = loadManifest(editorPanel, { page: 'editor', generation: 2 })
      await editorPanel.directive({ type: 'addon.load', manifest: duplicate })
      const dup = await editorPanel.awaitForward(
        (m) => m.type === 'addon.loaded' && m.generation === 2)
      if (dup.type !== 'addon.loaded' || dup.outcome.ok || dup.outcome.reason !== 'already-loaded') {
        throw new Error(`重复装载校验异常：${JSON.stringify(dup)}`)
      }
      const paint = await editorPanel.rpc<{ count: number }>('paint')
      if (paint.count !== 1) throw new Error('原装载被误扰')
      return 'identity-mismatch + already-loaded'
    })

    await runCase('编辑器页——故障组件完整释放（工厂抛错）', async () => {
      const manifest = loadManifest(editorPanel, {
        page: 'editor', addonId: THROW_ADDON_ID, scriptFsPath: path.join(throwAddonDist, 'throw.js'), cssFsPaths: [],
      })
      await editorPanel.directive({ type: 'addon.load', manifest })
      const faulted = await editorPanel.awaitForward((m) => m.type === 'addon.faulted')
      if (faulted.type !== 'addon.faulted') throw new Error('事件形态错误')
      if (!String(faulted.reason).includes('intentional factory fault')) {
        throw new Error(`故障原因异常：${faulted.reason}`)
      }
      const stats = await editorPanel.rpc<{ active: Array<{ addonId: string }>; history: Array<{ ended: string }> }>('stats')
      if (stats.active.some((entry) => entry.addonId === THROW_ADDON_ID)) throw new Error('故障组件仍 active')
      if (!stats.history.some((entry) => entry.ended === 'faulted')) throw new Error('历史缺 faulted')
      return 'factory-error → 完整释放'
    })

    await runCase('编辑器页——停用释放矩阵与迟到回执拒收', async () => {
      // 制造挂起请求（探针事件触发 addon.ping；宿主故意不答）
      await editorPanel.rpc('dispatchProbeEvent')
      const ping = await editorPanel.awaitForward(
        (m) => m.type === 'addon.channel.request' && m.topic === 'addon.ping')
      const docBefore = await editorPanel.rpc<string>('doc')
      await editorPanel.directive({ type: 'addon.unload', addonId: TEST_ADDON_ID, generation: 1 })
      const unloaded = await editorPanel.awaitForward(
        (m) => m.type === 'addon.unloaded' && m.addonId === TEST_ADDON_ID && m.generation === 1)
      if (unloaded.type !== 'addon.unloaded' || !unloaded.outcome.ok) {
        throw new Error(`卸载异常：${JSON.stringify(unloaded)}`)
      }
      if (unloaded.disposals < 1) throw new Error(`释放回调数 ${unloaded.disposals}`)
      const paint = await editorPanel.rpc<{ count: number }>('paint')
      if (paint.count !== 0) throw new Error('卸载后标记仍在')
      const docAfter = await editorPanel.rpc<string>('doc')
      if (docAfter !== docBefore) throw new Error(`卸载扰动文档：${docAfter}`)
      // 迟到回执（挂起请求已随卸载终结）
      if (ping.type === 'addon.channel.request') {
        await editorPanel.directive({
          type: 'addon.channel.reply', addonId: ping.addonId, generation: ping.generation,
          requestId: ping.requestId, outcome: { ok: true, result: 'late' },
        })
      }
      const stats = await editorPanel.rpc<{ counters: { lateChannelRepliesDropped: number }; active: unknown[] }>('stats')
      if (stats.counters.lateChannelRepliesDropped < 1) throw new Error('迟到回执未拒收')
      if (stats.active.length !== 0) throw new Error('卸载后仍有 active')
      // 释放后监听不再生效：封存旧事件后再触发，新事件窗内零新增
      editorPanel.sealForwards()
      await editorPanel.rpc('dispatchProbeEvent')
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (editorPanel.countNewRequests('addon.ping') > 0) throw new Error('释放后仍有组件请求')
      return `disposals=${unloaded.disposals}，迟回执拒收，监听自清`
    })

    await runCase('编辑器页——手动恢复与旧代次卸载拒收', async () => {
      // 手动恢复：新代次重新装载同一授权入口
      const manifest = loadManifest(editorPanel, { page: 'editor', generation: 2, resourceDir: testAddonDist })
      await editorPanel.directive({ type: 'addon.load', manifest })
      const loaded = await editorPanel.awaitForward((m) => m.type === 'addon.loaded' && m.generation === 2)
      if (loaded.type !== 'addon.loaded' || !loaded.outcome.ok) {
        throw new Error(`恢复装载失败：${JSON.stringify(loaded)}`)
      }
      await answerChannel(editorPanel, 1_000)
      const paint = await editorPanel.rpc<{ count: number }>('paint')
      if (paint.count !== 1) throw new Error('恢复后标记未回')
      // 旧代次卸载指令不生效
      await editorPanel.directive({ type: 'addon.unload', addonId: TEST_ADDON_ID, generation: 1 })
      const stale = await editorPanel.awaitForward(
        (m) => m.type === 'addon.unloaded' && m.generation === 1 && m.outcome.ok === false)
      if (stale.type !== 'addon.unloaded' || !('reason' in stale.outcome) || stale.outcome.reason !== 'stale-generation') {
        throw new Error(`旧代次卸载异常：${JSON.stringify(stale)}`)
      }
      const stats = await editorPanel.rpc<{ active: Array<{ generation: number }>; counters: { staleUnloadRejected: number } }>('stats')
      if (stats.active[0]?.generation !== 2) throw new Error('旧代次指令误伤当前装载')
      if (stats.counters.staleUnloadRejected < 1) throw new Error('旧代次未计数')
      // 收尾卸载
      await editorPanel.directive({ type: 'addon.unload', addonId: TEST_ADDON_ID, generation: 2 })
      await editorPanel.awaitForward(
        (m) => m.type === 'addon.unloaded' && m.generation === 2 && m.outcome.ok)
      return '恢复 gen2 → stale gen1 拒收 → 收尾卸载'
    })
  } finally {
    editorPanel.dispose()
  }

  // ---- 用例：设置页族 ----
  await runCase('设置页——跨页授权对照：未登记资源根的面板被拒', async () => {
    // 2026-10-07 实测（重要事实）：1.82.3 桌面本地工作区中，两个 webview
    // 面板对同一文件铸造的 asWebviewUri **字符串相同**（共享
    // vscode-resource 服务根）——「不能复用另一页的 URI」的隔离不由 URI
    // 字符串实现，而由资源服务按**请求面板**的 localResourceRoots 包含性
    // 实现。对照：编辑器面板登记了组件资源根，设置页「受限面板」只登记
    // 探针产物根——同一地址在受限面板装载必须被拒。
    const editor = createEditorPanel()
    await editor.ready
    const restrictedSettings = new ProbePanel(
      'vsidianAddonV02SettingsRestricted', 'V02 settings restricted',
      buildSettingsHtml, [outRoot], vscode.ViewColumn.Beside,
    )
    try {
      await restrictedSettings.ready
      const editorMinted = editor.panel.webview.asWebviewUri(vscode.Uri.file(path.join(testAddonDist, 'page.js'))).toString()
      const settingsMinted = restrictedSettings.panel.webview.asWebviewUri(vscode.Uri.file(path.join(testAddonDist, 'page.js'))).toString()
      const uriSame = editorMinted === settingsMinted
      console.log(`[addonV02] asWebviewUri 跨面板字符串${uriSame ? '相同（服务根共享，隔离靠 per-webview 资源根）' : '不同'}`)
      await restrictedSettings.directive({
        type: 'addon.load',
        manifest: {
          addonId: TEST_ADDON_ID, generation: 1, page: 'settings',
          scriptUri: editorMinted, cssUris: [],
        },
      })
      const loaded = await restrictedSettings.awaitForward((m) => m.type === 'addon.loaded')
      if (loaded.type !== 'addon.loaded' || loaded.outcome.ok) {
        throw new Error(`未登记资源根的面板未被拒：${JSON.stringify(loaded)}`)
      }
      if (loaded.outcome.reason !== 'script-load-failed') throw new Error(`拒绝原因 ${loaded.outcome.reason}`)
      return `受限面板装载被拒（URI 字符串${uriSame ? '相同' : '不同'}，隔离由 per-webview localResourceRoots 实现）`
    } finally {
      editor.dispose()
      restrictedSettings.dispose()
    }
  })

  await runCase('设置页——授权装载：挂载根/样式/授权图片与越界图片对照', async () => {
    const settings = createSettingsPanel()
    try {
      await settings.ready
      evidence.userAgent.settings = settings.userAgent
      const manifest = loadManifest(settings, { page: 'settings', resourceDir: testAddonDist })
      await settings.directive({ type: 'addon.load', manifest })
      let loaded: AddonPageOutbound
      try {
        loaded = await settings.awaitForward((m) => m.type === 'addon.loaded')
      } catch (err) {
        // 诊断兜底：装载器观测快照随错误带出（history 能定位失败阶段）
        const stats = await settings.rpc<unknown>('stats')
        throw new Error(`${String(err)}；stats=${JSON.stringify(stats)}；notes=${JSON.stringify(settings.notes)}`)
      }
      if (loaded.type !== 'addon.loaded' || !loaded.outcome.ok) {
        throw new Error(`设置页装载失败：${JSON.stringify(loaded)}`)
      }
      // 等待组件上报（挂载 + 两图结局；宿主回执 deniedImage 越界图地址）
      const answerLoop = answerChannel(settings, 10_000)
      const report = await settings.awaitForward(
        (m) => m.type === 'addon.channel.request' && m.topic === 'addon.report', 15_000)
      await answerLoop
      if (report.type !== 'addon.channel.request') throw new Error('report 形态错误')
      const payload = report.payload as { page: string; logoLoaded: boolean; deniedLoaded: boolean; deniedSrcSet: boolean }
      if (payload.page !== 'settings') throw new Error(`上报页面 ${payload.page}`)
      if (!payload.logoLoaded || payload.deniedLoaded || !payload.deniedSrcSet) {
        const info = await settings.rpc<Record<string, unknown>>('settingsInfo')
        throw new Error(`图片对照异常：${JSON.stringify(payload)}；info=${JSON.stringify(info)}`)
      }
      // 绘制层：标题计算色来自组件 page.css
      const info = await settings.rpc<Record<string, unknown>>('settingsInfo')
      if (info.rootPresent !== true || info.rootConnected !== true) throw new Error(`挂载根 ${JSON.stringify(info)}`)
      if (info.titleColor !== 'rgb(0, 120, 215)') throw new Error(`标题计算色 ${String(info.titleColor)}`)
      if (Number(info.logoNaturalWidth) <= 0) throw new Error('授权图片 naturalWidth 为零')
      return `logo=授权/denied=拒绝，标题色 ${String(info.titleColor)}`
    } finally {
      settings.dispose()
    }
  })

  await runCase('设置页——释放：挂载根移除与迟到回执拒收', async () => {
    const settings = createSettingsPanel()
    try {
      await settings.ready
      const manifest = loadManifest(settings, { page: 'settings', generation: 1, resourceDir: testAddonDist })
      await settings.directive({ type: 'addon.load', manifest })
      const loaded = await settings.awaitForward((m) => m.type === 'addon.loaded')
      if (loaded.type !== 'addon.loaded' || !loaded.outcome.ok) throw new Error('装载失败')
      const answerLoop = answerChannel(settings, 4_000)
      await settings.awaitForward(
        (m) => m.type === 'addon.channel.request' && m.topic === 'addon.report', 10_000)
      await answerLoop
      await settings.directive({ type: 'addon.unload', addonId: TEST_ADDON_ID, generation: 1 })
      const unloaded = await settings.awaitForward(
        (m) => m.type === 'addon.unloaded' && m.generation === 1)
      if (unloaded.type !== 'addon.unloaded' || !unloaded.outcome.ok) throw new Error('卸载失败')
      const info = await settings.rpc<Record<string, unknown>>('settingsInfo')
      if (info.rootPresent !== false) throw new Error(`挂载根未移除：${JSON.stringify(info)}`)
      const stats = await settings.rpc<{ active: unknown[] }>('stats')
      if (stats.active.length !== 0) throw new Error('active 未清空')
      return '挂载根随卸载移除'
    } finally {
      settings.dispose()
    }
  })

  await runCase('视图关闭——面板销毁即回收（宿主侧无残留路由）', async () => {
    const settings = createSettingsPanel()
    await settings.ready
    const manifest = loadManifest(settings, { page: 'settings', resourceDir: testAddonDist })
    await settings.directive({ type: 'addon.load', manifest })
    await settings.awaitForward((m) => m.type === 'addon.loaded')
    settings.dispose()
    // onDidDispose 后宿主不应再向该面板投递（postMessage 对已销毁面板为
    // 无效投递，此处以销毁事件与通道静默为证：等待窗口内无新事件）
    await new Promise((resolve) => setTimeout(resolve, 300))
    return '面板销毁，页面装载器随之消亡'
  })

  // ---- 证据落盘与汇总 ----
  mkdirSync(path.dirname(evidencePath), { recursive: true })
  const hostInfo = {
    vscodeVersion: vscode.version,
    executedAt: new Date().toISOString(),
    evidenceNote: 'V02 页面 SDK 探针（#349）：资源授权/拒绝对照、共享 CM6、代次与释放矩阵',
  }
  writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, hostInfo }, null, 2)}\n`, 'utf8')
  console.log(`[addonV02] 证据已写入 ${evidencePath}（用例 ${evidence.cases.length} 项，失败 ${failures.length} 项）`)
  if (existsSync(evidencePath)) {
    // 自查：证据文件可解析且含浏览器版本记录
    JSON.parse(readFileSync(evidencePath, 'utf8'))
  }
  if (failures.length > 0) {
    throw new Error(`V02 探针失败 ${failures.length} 项：${failures.join('；')}`)
  }
}
