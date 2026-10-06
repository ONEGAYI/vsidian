// V02 验证票（#349）：SDK 构建桥——esbuild 插件（构建辅助工具的最小形态）。
// 设计依据（docs/design/vsidian-addon-api.md §4.2）：
// - 提供虚拟模块 `vsidian-addon-sdk`：defineAddonPage 登记工厂到全局登记表
//   （组件作者不手写全局变量），currentSdk 读装载器注入槽；
// - **拒绝组件直接值导入 `@codemirror/*`**：共享 CM6 运行时必须经 SDK 的
//   experimental.cm6 取得，重打包整份 CM6 在构建期即被拦截（type-only
//   导入被 esbuild 剥离，不受影响）——这是「组件不得再次打包一份 CM6
//   运行时」的第一道防线；第二道是构建后的静态标记断言（buildAddon.mjs）。
// 桥接名与登记表形态属装载实现，不作为作者要记忆的接口（装载器侧
// ADDON_PAGE_REGISTRY_GLOBAL/ADDON_SDK_SLOT_GLOBAL 与本 shim 同源约定）。
export const SDK_BRIDGE_REGISTRY_GLOBAL = '__vsidianAddonPages'
export const SDK_BRIDGE_SDK_SLOT_GLOBAL = '__vsidianAddonSdk'

const SDK_SHIM = `// vsidian-addon-sdk shim（由 V02 构建桥注入，非真实包）
const holder = globalThis
const REGISTRY = ${JSON.stringify(SDK_BRIDGE_REGISTRY_GLOBAL)}
const SLOT = ${JSON.stringify(SDK_BRIDGE_SDK_SLOT_GLOBAL)}
export function defineAddonPage(addonId, factory) {
  if (!Array.isArray(holder[REGISTRY])) holder[REGISTRY] = []
  holder[REGISTRY].push({ addonId, factory, registeredAt: Date.now() })
}
export function currentSdk() {
  return holder[SLOT]
}
`

/** 构建桥插件：虚拟 SDK 模块 + CM6 值导入构建期拒绝 */
export function createSdkBridgePlugin() {
  return {
    name: 'vsidian-addon-sdk-bridge',
    setup(build) {
      build.onResolve({ filter: /^vsidian-addon-sdk$/ }, () => ({
        path: 'vsidian-addon-sdk',
        namespace: 'vsa2-sdk',
      }))
      build.onLoad({ filter: /.*/, namespace: 'vsa2-sdk' }, () => ({
        contents: SDK_SHIM,
        loader: 'js',
      }))
      // 值导入 @codemirror/* → 构建失败（type-only 导入在解析期已被剥离）
      build.onResolve({ filter: /^@codemirror\// }, (args) => ({
        errors: [
          {
            text:
              `V02 构建桥拒绝直接导入 ${args.path}：共享 CM6 运行时须经 vsidian-addon-sdk 的 experimental.cm6 取得` +
              '（组件不得重打包 CM6；type-only 导入不受影响）',
          },
        ],
      }))
    },
  }
}
