// #356 T07 集成夹具：消费公开 registerAddon 生命周期注册编辑器页入口的
// 兼容附加组件（宿主 CJS 侧）。页面产物（dist/editor.js IIFE）由
// runTest.mjs 经 V02 构建桥生成后拷入本目录——宿主 CJS 与浏览器产物分开
// 装配、互不打包。
//
// 上报协议（与页面产物 t07Editor.ts 配对）：
// - run scope 通道 t07.event：页面行为回调与 onChanged 观察的事件收件箱
//   （行为执行、适用判定与顺序断言面）；
// - 观测命令（contributes.commands 自动派生激活）：
//   stats（事件计数）/ collect {timeoutMs}（等待并取走全部事件）/ reset。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t07'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  eventCalls: 0,
  lastRegisterResult: null,
}

/** 页面上报的事件收件箱（collect 取走） */
const events = []

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
      enableCtx.channel.handle('t07.event', (payload) => {
        stats.eventCalls++
        events.push(payload)
        if (events.length > 128) {
          events.shift()
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
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({ ...stats, eventsDepth: events.length })),
    vscode.commands.registerCommand(`${SELF_ID}.collect`, async (timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs
      while (events.length === 0) {
        if (Date.now() > deadline) {
          return []
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      return events.splice(0)
    }),
    vscode.commands.registerCommand(`${SELF_ID}.reset`, () => {
      events.length = 0
      return true
    }),
  )
}

module.exports = { activate }
