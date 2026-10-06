// V02 验证票（#349）：SDK 构建桥虚拟模块的类型声明（tsc 用）。
// `vsidian-addon-sdk` 不是真实 npm 包——构建桥（sdkBridge.mjs）在 esbuild
// 解析时注入 shim（见 buildAddon.mjs），tsc 靠本环境声明解析导入。
declare module 'vsidian-addon-sdk' {
  import type { VsidianAddonPageSdk } from '../loader/types'
  /** 组件页面入口登记：IIFE 执行时调用，装载器核对身份后注入 SDK 调工厂 */
  export function defineAddonPage(
    addonId: string,
    factory: (sdk: VsidianAddonPageSdk) => void,
  ): void
  /** 模块作用域取当前 SDK（装载器调用工厂前注入；仅工厂执行期可靠） */
  export function currentSdk(): VsidianAddonPageSdk | undefined
}
