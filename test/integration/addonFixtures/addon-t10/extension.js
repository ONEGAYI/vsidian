// #359 T10 集成夹具：消费公开 registerAddon 生命周期注册编辑器页入口的
// 兼容附加组件（宿主 CJS 侧）。页面产物（dist/editor.js IIFE）由
// runTest.mjs 经 V02 构建桥生成后拷入本目录——宿主 CJS 与浏览器产物分开
// 装配、互不打包。
//
// 驱动协议（与页面产物 t10Editor.ts 配对，短轮询同 T06 款）：
// - run scope 通道 t10.register：页面挂载即上报注册结局（正向 ID 与负向
//   拒绝原因——用例断言「同名/含点/Tab/iconKey 均明确拒绝」的收件箱）；
// - run scope 通道 t10.next：立即回执一条待发指令（无则 null——页面小睡
//   重试；不做挂起式长轮询，面板可销毁场景挂起 resolver 会变死 waiter）；
// - run scope 通道 t10.result：页面执行 SDK 操作的结局收件箱；
// - 观测命令（contributes.commands 自动派生激活）：stats（通道计数与
//   注册结局快照）/ queue {op}（塞指令并返回序号）/ collect {timeoutMs}
//   （等待并取走全部结果）/ reset（清空队列与收件箱）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t10'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  nextCalls: 0,
  resultCalls: 0,
  registerCalls: 0,
  lastRegisterResult: null,
}

/** 页面挂载即上报的注册结局（负向拒绝与正向 ID 的断言面） */
let lastRegistrations = null
/** 待发指令队列（seq 单调；页面短轮询取走即执行） */
const pendingCommands = []
/** 页面上报的执行结局（seq → outcome；collect 取走） */
const results = []
let seqCounter = 0

async function activate(context) {
  stats.activateCount++
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(`${HOST_ID} not found in this extension host`)
  }
  const host = await ext.activate()
  const definition = {
    setup(setupCtx) {
      stats.setupCount++
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
      })
      enableCtx.channel.handle('t10.register', (payload) => {
        stats.registerCalls++
        lastRegistrations = payload
        return 'ok'
      })
      enableCtx.channel.handle('t10.next', () => {
        stats.nextCalls++
        return pendingCommands.shift() ?? null
      })
      enableCtx.channel.handle('t10.result', (payload) => {
        stats.resultCalls++
        console.log('[t10-fixture] result ' + JSON.stringify(payload).slice(0, 200))
        results.push(payload)
        if (results.length > 64) {
          results.shift()
        }
        return 'ok'
      })
      enableCtx.onDispose(() => {
        stats.disposeCount++
      })
    },
  }
  stats.lastRegisterResult = host.registerAddon({ id: SELF_ID }, definition)
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      queueDepth: pendingCommands.length,
      resultsDepth: results.length,
      registrations: lastRegistrations,
    })),
    vscode.commands.registerCommand(`${SELF_ID}.queue`, (op) => {
      const seq = ++seqCounter
      pendingCommands.push({ seq, op })
      return seq
    }),
    vscode.commands.registerCommand(`${SELF_ID}.collect`, async (timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs
      while (results.length === 0) {
        if (Date.now() > deadline) {
          return []
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      return results.splice(0)
    }),
    vscode.commands.registerCommand(`${SELF_ID}.reset`, () => {
      pendingCommands.length = 0
      results.length = 0
      lastRegistrations = null
      return true
    }),
  )
}

module.exports = { activate }
