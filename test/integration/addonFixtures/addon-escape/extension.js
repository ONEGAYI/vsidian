// #354 T05 集成夹具：登记「词法包含但真实路径逃逸」的页面入口。
// escape/ 目录由 runTest.mjs 在运行期创建为 junction（指向安装目录外的
// 临时目录——Windows junction 与符号链接同语义，无需管理员权限）；其内
// 的 page.js 只是占位（装载被宿主 realpath 守卫拒绝，永不执行）。
//
// 生命周期：setup 登记自己的设置页入口（escape/settings.js）+ 设置定义；
// enable 登记编辑器页入口（escape/editor.js）。两者词法上都在安装目录内
//（词法包含性第一层放行），真实路径在安装目录外（realpath 守卫第二层
// 拒绝装载——T05 的验收对象）。
const vscode = require('vscode')

const SELF_ID = 'vsidian-test-fixture.addon-escape'
const HOST_ID = 'onegayi.vsidian'

const stats = { activateCount: 0, setupCount: 0, enableCount: 0 }

async function activate() {
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
        entry: 'escape/settings.js',
      })
      setupCtx.settings.registerDefinitions([
        { key: 'note', title: '占位设置', type: 'string', maxLength: 16, default: 'escaped' },
      ])
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({
        entry: 'escape/editor.js',
      })
    },
  }
  const result = host.registerAddon({ id: SELF_ID }, definition)
  stats.lastRegisterResult = result.ok
  return result
}

function deactivate() {}

module.exports = { activate, deactivate, stats }
