// 宿主导出 API 的最小声明（example-repo-plan 2.2「vendor 快照或自写
// 最小声明」——本工程取最小声明形态）：Vsidian 经 activate() 返回值公布
// 的 registerAddon 面。AddonDefinition / AddonRegistrationResult 的完整
// 契约以主仓库事实源为准（复制到独立仓库时随 vendor 声明快照带走，见
// test/examples/README 的复制清单）。
import type { AddonRegistrationResult } from '../../../../src/shared/addonIdentity'
import type { AddonDefinition } from '../../../../src/host/addons/addonRegistry'

/** Vsidian（onegayi.vsidian）的公开导出 API 形状 */
export interface VsidianHostExports {
  /** 宿主当前提供的稳定 API 版本 */
  readonly apiVersion: string
  registerAddon(
    owner: { id: string },
    definition?: AddonDefinition,
  ): AddonRegistrationResult & { dispose?(): void }
}
