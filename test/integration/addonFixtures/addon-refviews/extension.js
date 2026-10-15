// T05（#544）集成夹具：消费公开 registerAddon 生命周期注册编辑器页入口的
// 兼容附加组件（宿主 CJS 侧）。页面产物（dist/editor.js IIFE）由
// runTest.mjs 经 V02 构建桥生成后拷入本目录（与 addon-t11 同款装配链）。
//
// 驱动协议（与页面产物 refViewsEditor.ts 配对，短轮询同 T06/T10/T11 款）：
// - run scope 通道 rv.register：页面挂载即上报 facet 在场性；
// - run scope 通道 rv.next：立即回执一条待发指令（无则 null——页面小睡
//   重试；不做挂起式长轮询，面板可销毁场景挂起 resolver 会变死 waiter）；
// - run scope 通道 rv.result：页面执行 SDK 操作的结局收件箱；
// - 观测命令（contributes.commands 自动派生激活）：stats（通道计数快照）/
//   queue {op, args}（塞指令并返回序号）/ collect {timeoutMs}（等待并取走
//   全部结果）/ reset（清空队列与收件箱）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-refviews'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  nextCalls: 0,
  resultCalls: 0,
  registerCalls: 0,
}

const pendingCommands = []
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
      enableCtx.channel.handle('rv.register', (payload) => {
        stats.registerCalls++
        return 'ok'
      })
      enableCtx.channel.handle('rv.next', () => {
        stats.nextCalls++
        return pendingCommands.shift() ?? null
      })
      enableCtx.channel.handle('rv.result', (payload) => {
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
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      queueDepth: pendingCommands.length,
      resultsDepth: results.length,
    })),
    vscode.commands.registerCommand(`${SELF_ID}.queue`, (op, args) => {
      const seq = ++seqCounter
      pendingCommands.push({ seq, op, args })
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
