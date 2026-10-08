// #350 T01 集成夹具：声明身份且兼容，但激活即抛错的附加组件——Vsidian
// 主动唤醒失败后应记录 activation-failed 状态与原因（不崩溃、不重试）。
// 无激活事件：宿主内只有 Vsidian 的协调器会唤醒它。
const vscode = require('vscode')

async function activate() {
  throw new Error('fixture addon-fail: intentional activation failure')
}

module.exports = { activate }
