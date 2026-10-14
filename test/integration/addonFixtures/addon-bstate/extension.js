// #476 集成夹具：消费公开 SDK behaviorState 只读面的兼容附加组件（宿主
// CJS 侧）。页面产物（dist/editor.js 与 dist/settings.js IIFE）由
// runTest.mjs 经 V02 构建桥生成后拷入本目录。
//
// 生命周期形状：
// - setup：settings.registerPage（自身设置页入口）+ setup scope 通道
//   bstate.event（**停用后仍服务**——停用后设置页不卸载，页面事件继续
//   上报，正是本票验证的关键链路）；
// - enable：pages.registerEditor（编辑器页入口）+ onDispose 计数。
//
// 观测命令（contributes.commands 自动派生激活）：
// - collect {timeoutMs}（等待并取走全部事件）/ reset / stats。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-bstate'
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
      setupCtx.settings.registerPage({
        entry: 'dist/settings.js',
      })
      setupCtx.channel.handle('bstate.event', (payload) => {
        stats.eventCalls++
        events.push(payload)
        if (events.length > 128) {
          events.shift()
        }
        return 'ok'
      })
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
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
