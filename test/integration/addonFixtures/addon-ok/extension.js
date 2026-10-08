// #350 T01 集成夹具：声明身份的**兼容**附加组件（公开 API 消费样例）。
//
// 装载方式：runTest.mjs 经 --extensionDevelopmentPath 附加装载（与被测
// 扩展同宿主）。声明对 onegayi.vsidian 的原生依赖——VSCode 激活本组件前
// 先完成 Vsidian 激活（API 已公布）；两条激活路径（VSCode 原生激活 /
// Vsidian 主动唤醒）共用 VSCode 幂等的 activate()，无论谁先到本函数只跑
// 一次，注册入口保证同一接入代次只注册一次。
//
// 观测命令（contributes.commands 自动派生激活事件，命令执行即原生激活
// 路径）：
// - vsidian-test-fixture.addon-ok.stats：返回计数与最近注册结果
// - vsidian-test-fixture.addon-ok.registerAgain：显式再次注册（断言
//   already-registered 且 setup 不重跑）
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-ok'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  registerCount: 0,
  setupCount: 0,
  lastRegisterResult: null,
  apiVersionAtRegister: null,
}

function hostApi() {
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(`${HOST_ID} not found in this extension host`)
  }
  // 幂等：依赖保证通常已激活；未激活时等待完成再取 exports（API 在注册
  // 前可访问）
  return ext.activate()
}

async function activate(context) {
  stats.activateCount++
  const host = await hostApi()
  stats.apiVersionAtRegister = host && host.apiVersion
  // 组件尚在自身激活过程中（isActive 仍为 false）即注册——注册入口不得
  // 要求此时已激活
  stats.registerCount++
  stats.lastRegisterResult = host.registerAddon({ id: SELF_ID }, {
    setup() { stats.setupCount++ },
  })
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({ ...stats })),
    vscode.commands.registerCommand(`${SELF_ID}.registerAgain`, () => registerAgain()),
  )
}

function registerAgain() {
  // 显式重复注册：返回 already-registered，setup 不重跑（集成断言面）
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    return { ok: false, reason: 'extension-not-in-host' }
  }
  stats.registerCount++
  stats.lastRegisterResult = ext.exports.registerAddon({ id: SELF_ID }, {
    setup() { stats.setupCount++ },
  })
  return stats.lastRegisterResult
}

module.exports = { activate }
