// #361 T12 集成夹具：诊断与全组件故障暂停的公开路径载体（宿主 CJS 侧）。
// 页面产物（dist/editor.js IIFE）由 runTest.mjs 经 V02 构建桥生成后拷入
// 本目录（与 addon-t10/t11 同款装配链）。
//
// 驱动协议（与页面产物 t12Editor.ts 配对，短轮询同 T06/T10/T11 款）：
// - setup scope 通道 t12.contributionsAllowed：页面装载后许可协商（贡献
//   防毒化门控——setContrib 放行才注册行为/命令/按钮/渲染器），应答携带
//   当前 arm；
// - setup scope 通道 t12.businessFail：返回业务错误对象（不抛）——「组件
//   错误日志/业务失败不等于故障」的负向对照载体；
// - run scope 通道 t12.register / t12.next（应答携带 arm 视图）/ t12.result
//   / t12.armAck（页面确认 arm——测试的确定性同步点）；
// - enable 抛错注入：arm === 'enable' 时 enable 抛未捕获异常（重试失败
//   场景——宿主归因 enable 阶段故障）；
// - 观测命令（contributes.commands 自动派生激活）：stats / queue {op} /
//   collect {timeoutMs} / reset / setArm {arm} / clearArm / setContrib {on} /
//   releaseAndReRegister（T05 手动重试的现实路径——dispose 旧句柄再注册）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t12'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  registerCalls: 0,
  nextCalls: 0,
  resultCalls: 0,
  armAckCalls: 0,
  lastAckArm: null,
  lastRegisterResult: null,
}

/** 故障注入选择（宿主侧模块变量——跨 retry 保留，clearArm/setArm(null) 清零）：
 *  behavior / command / button / render-mount / render-self-handled / enable */
let arm = null
/** 贡献放行（防毒化门控——默认 false，setContrib(true) 后需重装载生效） */
let contribAllowed = false
/** 页面挂载即上报的注册结局 */
let lastRegistrations = null
const pendingCommands = []
const results = []
let seqCounter = 0
let registrationHandle = null

function buildDefinition() {
  return {
    setup(setupCtx) {
      stats.setupCount++
      setupCtx.settings.registerDefinitions([
        { key: 't12.flag', title: 'T12 flag', type: 'boolean', default: true },
      ])
      setupCtx.channel.handle('t12.contributionsAllowed', () => ({ allowed: contribAllowed, arm }))
      setupCtx.channel.handle('t12.businessFail', (payload) => ({ ok: false, reason: 'business-error', echo: payload ?? null }))
    },
    enable(enableCtx) {
      stats.enableCount++
      if (arm === 'enable') {
        throw new Error('T12 enable boom (armed)')
      }
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
        css: ['dist/editor.css'],
      })
      enableCtx.channel.handle('t12.register', (payload) => {
        stats.registerCalls++
        lastRegistrations = payload
        return 'ok'
      })
      enableCtx.channel.handle('t12.next', () => {
        stats.nextCalls++
        return { command: pendingCommands.shift() ?? null, arm }
      })
      enableCtx.channel.handle('t12.result', (payload) => {
        stats.resultCalls++
        console.log('[t12-fixture] result ' + JSON.stringify(payload).slice(0, 200))
        results.push(payload)
        if (results.length > 64) {
          results.shift()
        }
        return 'ok'
      })
      enableCtx.channel.handle('t12.armAck', (payload) => {
        stats.armAckCalls++
        stats.lastAckArm = payload && typeof payload === 'object' ? payload.arm ?? null : null
        return 'ok'
      })
      enableCtx.onDispose(() => {
        stats.disposeCount++
      })
    },
  }
}

async function activate(context) {
  stats.activateCount++
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(`${HOST_ID} not found in this extension host`)
  }
  const host = await ext.activate()
  registrationHandle = host.registerAddon({ id: SELF_ID }, buildDefinition())
  stats.lastRegisterResult = registrationHandle
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      arm,
      contribAllowed,
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
      stats.lastAckArm = null
      return true
    }),
    // 故障注入臂选择（null 清零）——宿主侧模块变量，跨代次保留
    vscode.commands.registerCommand(`${SELF_ID}.setArm`, (value) => {
      arm = value ?? null
      return arm
    }),
    vscode.commands.registerCommand(`${SELF_ID}.clearArm`, () => {
      arm = null
      return true
    }),
    // 贡献放行（防毒化门控）——放行后需组件重装载生效（releaseAndReRegister）
    vscode.commands.registerCommand(`${SELF_ID}.setContrib`, (on) => {
      contribAllowed = on === true
      return contribAllowed
    }),
    // 手动重试的现实路径（T05 先例）：dispose 旧句柄再 registerAddon
    vscode.commands.registerCommand(`${SELF_ID}.releaseAndReRegister`, () => {
      try {
        registrationHandle?.dispose?.()
      } catch {
        // 已释放句柄的迟到 dispose 无害
      }
      registrationHandle = vscode.extensions.getExtension(HOST_ID)?.exports?.registerAddon?.({ id: SELF_ID }, buildDefinition())
        ?? registrationHandle
      stats.lastRegisterResult = registrationHandle
      return true
    }),
  )
}

module.exports = { activate }
