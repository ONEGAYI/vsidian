// 浏览器回归共用的设置页生产包构建：languageSwitch / keybindings /
// settingsPage 三脚本同用 settings/main.js 产物，构建选项必须单源——
// buildBroker 以「同 outfile 不同配置」为冲突（#265 给设置页引入 svg
// 资产后 loader 出现三处内联漂移，CI 上同产物两套件按设计互炸）。
// loader svg:dataurl 为设置页打包语义的一部分（生图资产经 CSS url 内联），
// 后续新增设置页选项只改此处。
import path from 'node:path'
import { build, artifactPath } from './runtime.mjs'

/** 构建设置页生产入口（settings/main.js），返回产物 js 路径 */
export async function buildSettingsMain(root) {
  const output = artifactPath(root, 'settings/main.js')
  await build({ entryPoints: [path.join(root, 'src/webview/settingsMain.ts')], bundle: true,
    outfile: output, format: 'iife', loader: { '.svg': 'dataurl' } })
  return output
}
