// #461 集成夹具：消费公开 registerAddon 的存储面（ctx.storage）——
// 模拟 vsidian-easy-typing 的 fail-safe init（rule-store C-R4-1 保守策略）。
//
// 归因链对齐 #461 现场：enable 注册通道处理器，处理器内 list() 探测
// 存储；!ok 即抛错 → 宿主「通道回调异常」归因 → faulted（组件运行贡献
// 暂停）。全新隔离 profile 下 <globalStorage>/addons 天然不存在（存储根
// 惰性创建，首次写才建）——修复前 list 对未建目录返回 error 拒绝，本
// 夹具即 faulted；修复后「未建目录 = 空存储」走种子路径（写种子文件再
// 读回）不 faulted。
//
// 公开消费观测命令（contributes.commands 自动派生激活）：
// - vsidian-test-fixture.addon-storage.stats：注册/启用/探测计数与最近
//   一次探测结论（entryCount/seeded/readBack）
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-storage'
const HOST_ID = 'onegayi.vsidian'

const stats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  probeCalls: 0,
  lastProbe: null,
  lastRegisterResult: null,
}

async function activate(context) {
  stats.activateCount++
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(`${HOST_ID} not found in this extension host`)
  }
  const host = await ext.activate()
  const definition = {
    setup() {
      stats.setupCount++
    },
    enable(enableCtx) {
      stats.enableCount++
      // fail-safe 探测：经通道处理器暴露（通道回调异常是宿主可归因路径
      // ——enable 同步段的 async throw 不进宿主归因，见 #461 现场实录：
      // 通道回调异常（easyTyping.rules.get））
      enableCtx.channel.handle('storage.probe', async () => {
        stats.probeCalls++
        const list = await enableCtx.storage.list()
        if (!list.ok) {
          throw new Error(`rules-storage-unreadable: list ${list.reason}`)
        }
        const seeded = list.entries.length === 0
        if (seeded) {
          const write = await enableCtx.storage.writeFile('rule-state.json', '{"seed":true}')
          if (!write.ok) {
            throw new Error(`seed-write-failed: ${write.reason}`)
          }
        }
        const read = await enableCtx.storage.readFile('rule-state.json')
        if (!read.ok) {
          throw new Error('rules-storage-unreadable: rule-state.json')
        }
        stats.lastProbe = {
          listOk: true,
          entryCount: list.entries.length,
          seeded,
          readBack: read.value,
        }
        return stats.lastProbe
      })
    },
  }
  stats.lastRegisterResult = host.registerAddon({ id: SELF_ID }, definition)
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      lastProbe: stats.lastProbe ? { ...stats.lastProbe } : null,
    })),
  )
}

module.exports = { activate }
