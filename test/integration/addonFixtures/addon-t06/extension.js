// #355 T06 集成夹具：消费公开 registerAddon 生命周期注册编辑器页入口的
// 兼容附加组件（宿主 CJS 侧）。页面产物（dist/editor.js IIFE）由
// runTest.mjs 经 V02 构建桥生成后拷入本目录——宿主 CJS 与浏览器产物分开
// 装配、互不打包。
//
// 驱动协议（与页面产物 t06Editor.ts 配对）：
// - run scope 通道 t06.next：立即返回一条待发指令（无则 null——页面侧
//   短轮询重试）。不做挂起式长轮询：webview 面板可销毁，挂起的 resolver
//   会随页面死亡变成死 waiter 吞指令（实测：closeAllEditors 后新面板的
//   组件永远收不到 queue 塞入的指令）；
// - run scope 通道 t06.result：页面执行 SDK 操作的结局收件箱；
// - 观测命令（contributes.commands 自动派生激活）：
//   stats（通道计数）/ queue {op, args}（塞指令并返回序号）/
//   collect {timeoutMs}（等待并取走全部结果）/ reset（清空队列）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t06'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  nextCalls: 0,
  resultCalls: 0,
  lastRegisterResult: null,
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
      enableCtx.channel.handle('t06.next', () => {
        stats.nextCalls++
        return pendingCommands.shift() ?? null
      })
      enableCtx.channel.handle('t06.result', (payload) => {
        stats.resultCalls++
        console.log('[t06-fixture] result ' + JSON.stringify(payload).slice(0, 200))
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
    vscode.commands.registerCommand(`${SELF_ID}.queue`, (op, args) => {
      const seq = ++seqCounter
      const command = { seq, op, ...(args !== undefined ? { args } : {}) }
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
