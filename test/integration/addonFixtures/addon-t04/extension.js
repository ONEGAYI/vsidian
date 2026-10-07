// #353 T04 集成夹具：消费公开 registerAddon 的 setup 设置能力面——
// 复杂设置定义（标量/替换规则数组/对象样例）+ 分层读写 API
//（settings.get/getSource/update/clearWorkspaceOverride/onChanged，技术
// 方案 5.5 形状）的**兼容**附加组件（宿主 CJS 侧）。不声明 enable——
// 纯设置组件：验证「未启用运行功能也可配置」（ADR Q23 停用态配置语义）。
//
// 公开消费观测命令（contributes.commands 自动派生激活）：
// - vsidian-test-fixture.addon-t04.stats：注册与 API 调用计数 + 最近
//   get() 快照（values/sources）+ onChanged 日志（最近 20 条）
// - vsidian-test-fixture.addon-t04.updateFromAddon { scope, key, value }：
//   经公开 API 写入（成功保存后 onChanged 应触发）
// - vsidian-test-fixture.addon-t04.badPatch：经公开 API 发送混批非法补丁
//  （合法 string + 超界 number——整批拒绝断言面）
// - vsidian-test-fixture.addon-t04.clearOverrideFromAddon { key }：经公开
//   API 清除工作区覆盖
// - vsidian-test-fixture.addon-t04.releaseAndReRegister：释放句柄后同
//   definition 重新注册（新 setup 代次——定义替换、存储值不重置断言面）
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-t04'
const HOST_ID = 'onegayi.vsidian'

// 复杂定义样本：标量三型 + 替换规则数组 + 对象样例（票面验收三形态）
const DEFINITIONS = [
  { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
  { key: 'label', title: '标签', type: 'string', maxLength: 30, default: 'demo' },
  { key: 'mode', title: '模式', type: 'string', enum: ['a', 'b'], default: 'a' },
  { key: 'flag', title: '开关', type: 'boolean', default: false },
  { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 20 }, default: ['旧词→新词'] },
  {
    key: 'limits', title: '对象样例', type: 'object',
    fields: [
      { key: 'name', title: '名称', kind: 'string', maxLength: 20, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
    ],
  },
]

const stats = {
  activateCount: 0,
  setupCount: 0,
  updateCalls: 0,
  badPatchCalls: 0,
  clearCalls: 0,
  changedCount: 0,
  changedLog: [],
  lastGet: null,
  lastUpdateResult: null,
  lastBadPatchResult: null,
  lastClearResult: null,
  lastRegisterResult: null,
}

let settingsApi = null
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
      settingsApi = setupCtx.settings
      setupCtx.settings.registerDefinitions(DEFINITIONS)
      setupCtx.settings.onChanged((change) => {
        stats.changedCount++
        stats.changedLog.push({ scope: change.scope, keys: [...change.keys] })
        if (stats.changedLog.length > 20) stats.changedLog.shift()
      })
      stats.lastGet = settingsApi.get()
    },
    // 不声明 enable：纯设置组件（未启用运行功能也可配置——T04 验收路径）
  }
  stats.lastRegisterResult = host.registerAddon({ id: SELF_ID }, definition)
  if (stats.lastRegisterResult && typeof stats.lastRegisterResult.dispose === 'function') {
    releaseHandle = stats.lastRegisterResult.dispose
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      changedLog: [...stats.changedLog],
      lastGet: stats.lastGet ? { values: { ...stats.lastGet.values }, sources: { ...stats.lastGet.sources } } : null,
    })),
    vscode.commands.registerCommand(`${SELF_ID}.updateFromAddon`, async (args) => {
      stats.updateCalls++
      stats.lastUpdateResult = await settingsApi.update(args.scope, { [args.key]: args.value })
      stats.lastGet = settingsApi.get()
      return { result: stats.lastUpdateResult, get: stats.lastGet }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.badPatch`, async () => {
      stats.badPatchCalls++
      // 混批：合法 label + 超界 threshold（max 100）——按批校验应整批拒绝
      stats.lastBadPatchResult = await settingsApi.update('user', { label: 'legal-value', threshold: 9999 })
      stats.lastGet = settingsApi.get()
      return { result: stats.lastBadPatchResult, get: stats.lastGet }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.clearOverrideFromAddon`, async (args) => {
      stats.clearCalls++
      stats.lastClearResult = await settingsApi.clearWorkspaceOverride(args.key)
      stats.lastGet = settingsApi.get()
      return { result: stats.lastClearResult, get: stats.lastGet }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.releaseAndReRegister`, () => {
      // 手动重新接入原语（升级模拟）：释放旧代次 → setup 重跑（定义替换）；
      // 存储值不重置由用例断言（普通升级不重置）
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
