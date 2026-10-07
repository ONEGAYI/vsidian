// #351 T02 集成夹具：消费公开 registerAddon 两生命周期（setup/enable）与
// 页面入口注册的**兼容**附加组件（宿主 CJS 侧）。页面产物（dist/editor.js
// 与 dist/settings.js IIFE）由 runTest.mjs 经 V02 构建桥生成后拷入本目录
// ——宿主 CJS 与浏览器产物分开装配、互不打包（ADR-0012「代码分发」）。
//
// 生命周期形状（T02 definition）：
// - setup：settings.registerPage（自身设置页入口）+ registerDefinitions
//   （JSON 设置定义）+ setup scope 通道（t02.settingsEcho——停用后仍服务）；
// - enable：pages.registerEditor（编辑器页入口）+ run scope 通道（t02.echo）
//   + onDispose 清理回调（释放证据）。
//
// 观测命令（contributes.commands 自动派生激活）：
// - vsidian-test-fixture.addon-t02.stats：注册与通道计数快照
// - vsidian-test-fixture.addon-t02.armEchoCrash：让 t02.echo 下一次抛错
//   （故障注入——宿主侧可归因回调异常 → 全组件暂停）
// - vsidian-test-fixture.addon-t02.disposeCount：enable 作用域清理回调计数
// - vsidian-test-fixture.addon-t02.releaseAndReRegister：手动重新接入原语
//   （dispose 释放句柄释放旧代次 → 同一 definition 重新注册建新代次——
//   T01 实证激活失败过的 activate() 假成功，重试不走自动路径）
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t02'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  echoCalls: 0,
  settingsEchoCalls: 0,
  reportCalls: 0,
  docStateCalls: 0,
  lastReport: null,
  reportsLog: [],
  lastDocState: null,
  lastRegisterResult: null,
}

let armCrash = false
let releaseHandle = null
let definition = null

async function activate(context) {
  stats.activateCount++
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(`${HOST_ID} not found in this extension host`)
  }
  const host = await ext.activate()
  definition = {
    setup(setupCtx) {
      stats.setupCount++
      setupCtx.settings.registerPage({
        entry: 'dist/settings.js',
        css: ['dist/settings.css'],
        resources: ['dist/assets'],
      })
      setupCtx.settings.registerDefinitions([
        { key: 't02.flag', type: 'boolean', default: true },
      ])
      setupCtx.channel.handle('t02.settingsEcho', (payload) => {
        stats.settingsEchoCalls++
        return { echoed: payload, scope: 'setup' }
      })
      // 组件页面回执结局的收件箱（t02.report：echo/settingsEcho 的确认与
      // t02.docState 的绘制层观测——宿主侧集成断言面）
      setupCtx.channel.handle('t02.report', (payload) => {
        stats.reportCalls++
        stats.lastReport = payload
        stats.reportsLog.push(payload)
        if (stats.reportsLog.length > 20) stats.reportsLog.shift()
        return 'ok'
      })
      setupCtx.channel.handle('t02.docState', (payload) => {
        stats.docStateCalls++
        stats.lastDocState = payload
        return 'ok'
      })
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
        css: ['dist/editor.css'],
        resources: ['dist/assets'],
      })
      enableCtx.channel.handle('t02.echo', (payload) => {
        stats.echoCalls++
        if (armCrash) {
          armCrash = false
          throw new Error('t02 echo handler armed crash')
        }
        return { echoed: payload, scope: 'run' }
      })
      enableCtx.onDispose(() => {
        stats.disposeCount++
      })
    },
  }
  stats.lastRegisterResult = host.registerAddon({ id: SELF_ID }, definition)
  if (stats.lastRegisterResult && typeof stats.lastRegisterResult.dispose === 'function') {
    releaseHandle = stats.lastRegisterResult.dispose
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({ ...stats })),
    vscode.commands.registerCommand(`${SELF_ID}.armEchoCrash`, () => {
      armCrash = true
      return true
    }),
    vscode.commands.registerCommand(`${SELF_ID}.disposeCount`, () => stats.disposeCount),
    vscode.commands.registerCommand(`${SELF_ID}.releaseAndReRegister`, () => {
      // 手动重新接入：释放句柄终结旧代次（全部贡献释放），再重新注册
      // 建新代次；停用偏好在重注册后保持（用户开关独立于代次）
      if (typeof releaseHandle === 'function') {
        releaseHandle()
        releaseHandle = null
      }
      const hostExt = vscode.extensions.getExtension(HOST_ID)
      stats.lastRegisterResult = hostExt.exports.registerAddon({ id: SELF_ID }, definition)
      if (stats.lastRegisterResult && typeof stats.lastRegisterResult.dispose === 'function') {
        releaseHandle = stats.lastRegisterResult.dispose
      }
      return stats.lastRegisterResult
    }),
  )
}

module.exports = { activate }
