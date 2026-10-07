// #358 T09 集成夹具：消费公开 registerAddon 的 enable 生命周期注册编辑器
// 页入口的**兼容**附加组件（宿主 CJS 侧）。页面产物（dist/editor.js 与
// dist/editor.css IIFE）由 runTest.mjs 经 V02 构建桥生成后拷入本目录——
// t09Renderer.ts 经页面 SDK renderers.register 登记渲染提供者候选。
//
// 生命周期形状（T09 definition）：
// - setup：setup scope 通道（t09.setupEcho）；
// - enable：pages.registerEditor（编辑器页入口）+ run scope 通道
//  （t09.echo——armCrash 后下一次抛错：可归因通道回调异常 → 全组件故障
//   暂停 → 渲染候选不可用 → 内置接管，Q30 集成断言的故障注入入口）。
//
// 手动重试路径（T01 实证约束）：1.82.3 对激活失败过的扩展再次 activate()
// 假成功（resolve 而不重跑 activate）——故障重试后组件须自行重新接入
// （releaseAndReRegister：dispose 旧句柄 + 同一 definition 再注册）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t09'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  echoCalls: 0,
}

let armCrash = false
// 渲染候选放行（默认拒绝）：集成/浏览器宿主是共享会话，未放行时页面
// 装载保持惰性（零候选上报、生效表零变化——不毒化其他用例的 mermaid/
// 阅读解析断言）；T09 用例经命令显式开启，用毕关闭
let providersAllowed = false
let releaseHandle = null
let definition = null
let hostApi = null

function buildDefinition() {
  return {
    setup(setupCtx) {
      stats.setupCount++
      setupCtx.channel.handle('t09.setupEcho', () => ({ ok: true, setup: true }))
    },
    enable(enableCtx) {
      stats.enableCount++
      // 编辑器页入口不带 css：集成断言不依赖 .t09-box 样式（provider/
      // width/rendered 态），而 T02「停用后 cssLinksActive===0」断言假设
      // 面板内带 CSS 的夹具唯一——本组件带 CSS 会常驻面板打破该假设
      //（计算色 rgb(9,96,246) 断言在浏览器套件，走其独立 CSS 装载通道）
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
      })
      enableCtx.channel.handle('t09.providersAllowed', () => ({ allowed: providersAllowed }))
      enableCtx.channel.handle('t09.echo', () => {
        stats.echoCalls++
        if (armCrash) {
          armCrash = false
          throw new Error('t09 fixture: injected echo crash')
        }
        return { ok: true, echoCalls: stats.echoCalls }
      })
      enableCtx.onDispose(() => {
        stats.disposeCount++
      })
    },
  }
}

function registerSelf() {
  if (!hostApi) {
    throw new Error(`${SELF_ID}: host API not resolved yet`)
  }
  const result = hostApi.registerAddon({ id: SELF_ID }, definition)
  stats.lastRegisterResult = { ok: result.ok, reason: result.reason ?? null }
  if (result.ok) {
    releaseHandle = result
  }
  return result
}

async function activate(context) {
  stats.activateCount++
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(`${HOST_ID} not found in this extension host`)
  }
  hostApi = await ext.activate()
  definition = buildDefinition()
  registerSelf()
  context.subscriptions.push({
    dispose() {
      if (releaseHandle && typeof releaseHandle.dispose === 'function') {
        releaseHandle.dispose()
        releaseHandle = null
      }
    },
  })
}

function deactivate() {}

module.exports = { activate, deactivate, stats }

// 观测与重试命令（contributes.commands 自动派生激活，模块装载时注册）
const register = (command, handler) => {
  try {
    vscode.commands.registerCommand(command, handler)
  } catch {
    // 无命令注册面的环境（单测）忽略
  }
}

register('vsidian-test-fixture.addon-t09.stats', () => ({ ...stats, armCrash }))
register('vsidian-test-fixture.addon-t09.armCrash', () => {
  armCrash = true
  return { ok: true }
})
// 渲染候选放行开关（T09 用例按需；页面装载时经通道询问）
register('vsidian-test-fixture.addon-t09.armProviders', () => {
  providersAllowed = true
  return { ok: true, allowed: providersAllowed }
})
register('vsidian-test-fixture.addon-t09.disarmProviders', () => {
  providersAllowed = false
  return { ok: true, allowed: providersAllowed }
})
// 手动重试的组件侧配合：释放旧代次（宿主 retry 已释放注册记录时为
// no-op）后以同一 definition 重新接入（T01 实证：激活失败过的 activate()
// 假成功，重试不走自动路径）
register('vsidian-test-fixture.addon-t09.releaseAndReRegister', () => {
  if (releaseHandle && typeof releaseHandle.dispose === 'function') {
    releaseHandle.dispose()
    releaseHandle = null
  }
  const result = registerSelf()
  return { ok: result.ok, reason: result.reason ?? null }
})
