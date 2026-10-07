// #354 T05 官方（核心）附加组件登记表——可维护形态的事实源。
//
// 形态约定（ADR-0012「侧栏结构」：官方归属的具体识别方式尚待设计，本票
// 落地为「主仓库维护的明确扩展 ID 清单」的可维护结构）：
// - 登记 official 组件**只改本表**：每条一个官方扩展 ID（publisher.name，
//   与 VSCode Extension.id 同形）+ 可选备注（用途/发布仓线索，不参与判定）。
// - 官方归属判定唯一入口是 isOfficialAddon（addonIdentity.ts 再导出消费）：
//   只查本表，不读组件自称（keywords、displayName、身份声明内无官方字段
//   ——第三方不能自行声明「核心」，ADR-0012 已确认）。
// - 清单随主仓库一起审查与发布；addon 清单为空时设置页「核心组件」组
//   呈现空态（分组结构在场，不因空清单消失）。
// - 本表不是已发布 API：登记内容变化不构成兼容性承诺（第三方不得依据
//   「曾在表内/表外」主张任何契约）。

/** 官方附加组件登记条目（extensionId 是判定键；label 备注不参与判定） */
export interface OfficialAddonEntry {
  /** 官方组件的 VSCode 扩展 ID（publisher.name） */
  readonly extensionId: string
  /** 维护备注（用途或发布仓线索；仅文档性质） */
  readonly label?: string
}

/**
 * 官方（核心）附加组件登记表。初版为空占位——首个官方组件发布时在此
 * 登记；「核心组件」侧栏分组随之从空态转为条目列表。
 */
export const OFFICIAL_ADDON_REGISTRY: readonly OfficialAddonEntry[] = [
  // 登记样例（形态参考，勿留注释放行）：
  // { extensionId: 'onegayi.vsidian-official-xxx', label: '官方 xxx 组件' },
]

/** 判定用 ID 清单（登记表的投影视，供 isOfficialAddon 与文档消费） */
export const OFFICIAL_ADDON_EXTENSION_IDS: readonly string[] = OFFICIAL_ADDON_REGISTRY.map(
  (entry) => entry.extensionId,
)
