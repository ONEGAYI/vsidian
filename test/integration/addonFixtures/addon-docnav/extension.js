// #543 T03 集成夹具：消费公开 registerAddon 生命周期注册编辑器页入口的
// 兼容附加组件（宿主 CJS 侧）。页面产物（dist/editor.js IIFE）由
// runTest.mjs 经 V02 构建桥生成后拷入本目录（与 addon-t06 同装配）。
//
// 驱动协议（与页面产物 docNavEditor.ts 配对，短轮询——同 t06 口径）：
// - run scope 通道 docnav.next：立即返回一条待发指令（无则 null）；
// - run scope 通道 docnav.result：页面执行 SDK 操作的结局收件箱；
// - 观测命令（contributes.commands 自动派生激活）：
//   stats（通道计数）/ queue {op, args}（塞指令并返回序号）/
//   collect {timeoutMs}（等待并取走全部结果）/ reset（清空队列）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-docnav'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  nextCalls: 0,
  resultCalls: 0,
  lastRegisterResult: null,
  lastSourceUri: null,
  lastQueueSourceUri: null,
}

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
      enableCtx.channel.handle('docnav.next', (payload) => {
        stats.nextCalls++
        stats.lastSourceUri = payload.sourceUri
        const index = pendingCommands.findIndex((command) => command.sourceUri === payload.sourceUri)
        return index < 0 ? null : pendingCommands.splice(index, 1)[0]
      })
      enableCtx.channel.handle('docnav.result', (payload) => {
        stats.resultCalls++
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
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({ ...stats, queueDepth: pendingCommands.length, resultsDepth: results.length })),
    vscode.commands.registerCommand(`${SELF_ID}.queue`, (op, args, sourceUri) => {
      stats.lastQueueSourceUri = sourceUri
      const seq = ++seqCounter
      const command = { seq, op, sourceUri, ...(args !== undefined ? { args } : {}) }
      pendingCommands.push(command)
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
      return true
    }),
  )
}

module.exports = { activate }
