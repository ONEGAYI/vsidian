// #426 视图身份基座——CM6 EditorView → 平台实例 ID 的反查承载。
//
// 背景（首消费反馈）：headingFold 查询与命令回调都按 views 面实例 ID
// 寻址，而 keymap/扩展回调拿到的是 EditorView——此前无官方映射，组件
// 只能靠「扩展槽仅挂主正文 Live 实例」的未成文契约推定 'main'（该契约
// 本批已升格为 developer-guide 显式条款）。
//
// 形态：StateField 承载实例 ID（null = 未注册/非平台实例），注册方在
// 告知行为链身份的同一时点（setAddonBehaviorIdentity——addonViews 注册
// 的既有单一身份入口）经 effect 写入。查询经 SDK 实验入口
// experimental.viewIdentity.instanceIdOf(view)（闭包实现，无 this 依赖
// ——解构裸传安全，#426 第 4 条形态契约）。
//
// 边界：身份随实例状态存在（StateField 语义），不随事务映射漂移（值
// 是身份字符串，不是文档坐标）；实例销毁即随 state 消亡。hover 只读
// 视图无 CM6 实例，不经本 field（views 面按 ID 直接寻址，无需反查）。
import { StateEffect, StateField } from '@codemirror/state'

/** 写入实例身份（注册方：syncController 主正文 'main' / embedCard
 *  `embed:<hostId>`——与 addonViews 句柄同 ID 源） */
export const setAddonInstanceId = StateEffect.define<string>()

/** 实例身份 field（null = 未注册/非平台实例）。装配进全部 Live 实例的
 *  extensions（main 与 embed 同装——扩展槽装配范围变化时反查自动跟随） */
export const addonInstanceIdField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAddonInstanceId)) {
        return e.value
      }
    }
    return value
  },
})
