// #457 附加组件宿主设置读取面——白名单与值解析的单一事实源。
//
// 边界（票面 #457 定案）：
// - **experimental 入口**：挂在页面 SDK 的 experimental.hostSettings，使用
//   前须在清单 experimental 声明 hostSettings 兼容范围；实验入口可能随
//   版本调整，不随稳定 API 弃用期限承诺（对齐 cm6/headingFold/
//   viewIdentity/syntax 治理形态）。
// - **读取范围收敛**：只按显式白名单（ADDON_HOST_SETTING_KEYS）暴露，
//   不开放任意 configuration 全量读取——白名单外 key 一律 invalid-key
//   拒绝，不静默 undefined；新增白名单项须同步台账与文档（新增项是
//   minor 扩展，非破坏性演进）。
// - **与宿主一致**：值来自宿主设置快照（SettingsPayload）投影，无独立
//   合成层——宿主怎么解析（globalState overlay > 定义表默认）读取面就
//   拿到什么；快照未达或键缺失回定义表默认值（与 syncController 的
//   applyReadingBreaksSetting 缺键回默认同口径，宿主初始渲染同语义）。
// - **无变更通知**：首版不提供 onDidChange（#457 评估定案——门控类消费
//   只需读当前值）；宿主设置保存后经既有 settings.changed 全量广播更新
//   webview 快照缓存，下次 get 即拿到新值，无需重开面板。消费方需即时
//   感知时在输入回调中重读（拉取式）。
// - 仅编辑器页提供（设置页不提供该入口，对齐既有实验入口）。
import { READING_BREAKS_DEFAULT, READING_BREAKS_KEY, type SettingsPayload } from './settings'

/** 白名单（票面「读取范围收敛」的落地）：显式清单枚举宿主设置键，键名
 *  引用宿主侧成对导出的常量（不复制字面量）。首版仅 #423 的
 *  editor.readingBreaks（easy-typing #30 门控消费方）。 */
export const ADDON_HOST_SETTING_KEYS = [READING_BREAKS_KEY] as const

/** 白名单键类型（新增白名单项时经 as const 数组自动扩展） */
export type AddonHostSettingKey = (typeof ADDON_HOST_SETTING_KEYS)[number]

/** 白名单值类型：首版全部白名单键均为 boolean；将来纳入非布尔项时按
 *  键扩展联合类型（minor 演进） */
export type AddonHostSettingValue = boolean

/** 拒绝类型：invalid-key = 白名单外键（读取范围收敛）；view-disposed =
 *  组件代次已终结（迟到的僵尸调用，装载器守卫给出） */
export type AddonHostSettingsRejection = 'invalid-key' | 'view-disposed'

/** 读取结果（可辨认拒绝，不抛出） */
export type AddonHostSettingGetResult =
  | { ok: true; value: AddonHostSettingValue }
  | { ok: false; reason: AddonHostSettingsRejection }

/** 读取面（experimental.hostSettings 的内容；仅编辑器页提供）。get 同步
 *  返回——keymap/输入行为等热路径可直接消费 */
export interface AddonHostSettingsFacet {
  /** 读白名单宿主设置的当前生效值（类型收窄为白名单键；JS 组件传入
   *  任意值时运行时校验拒绝 invalid-key） */
  get(key: AddonHostSettingKey): AddonHostSettingGetResult
}

/** key 守卫（SDK 运行时边界：JS 组件可传任意值） */
export function isAddonHostSettingKey(key: string): key is AddonHostSettingKey {
  return (ADDON_HOST_SETTING_KEYS as readonly string[]).includes(key)
}

/** 值解析（纯函数）：快照未达/缺键回定义表默认值；仅显式 true 归一为
 *  true（与 applyReadingBreaksSetting 的 raw === true 归一化同口径） */
export function resolveAddonHostSettingValue(
  snapshot: SettingsPayload | undefined,
  key: AddonHostSettingKey,
): AddonHostSettingValue {
  if (key === READING_BREAKS_KEY) {
    const raw = snapshot?.[READING_BREAKS_KEY]
    return raw === undefined ? READING_BREAKS_DEFAULT : raw === true
  }
  // 白名单穷举的编译期守卫：新增白名单键而漏加分支时，此处 key 不再
  // 收窄为 never，tsc --noEmit 即失败（防漏改——兜底回错误键的默认值
  // 是静默错值；运行时此分支不可达）
  key satisfies never
  return READING_BREAKS_DEFAULT
}

/** 读取组合（装载器 facet 的实现体）：白名单校验 + 值解析 */
export function addonHostSettingGet(
  snapshot: SettingsPayload | undefined,
  key: string,
): AddonHostSettingGetResult {
  if (!isAddonHostSettingKey(key)) {
    return { ok: false, reason: 'invalid-key' }
  }
  return { ok: true, value: resolveAddonHostSettingValue(snapshot, key) }
}
