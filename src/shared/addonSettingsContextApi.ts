// #553 组件设置详情自绘页优先——设置页上下文面的公开契约。
//
// 形状来源：#553 票面「公开、可维护的页面上下文承接当前作用域及其变化、
// 无工作区状态，以及搜索的定义/分组定位目标」。仅设置页装载的组件页面
// 提供（编辑器页 sdk.settingsContext 为 undefined）；数据源是设置页
// webview 的页面级 runtime（src/webview/addonSettingsContext.ts，由
// settingsMain 构造注入装载器 env），组件不读取平台私有 DOM 获取这些
// 信息。仍是候选 API：字段与接口名随公开声明冻结，不冒充已发布稳定 API。
//
// 生命周期口径（与 behaviorState 只读面同款）：
// - 查询（scopeState/locateTarget）不做代次守卫——只读无副作用，已释放
//   代次返回页面级当前值；
// - 订阅（onScopeChange/onLocateTarget）过装载器 isLoadActive 守卫：已
//   释放代次的迟到登记为 no-op 退订；释放时点已有的订阅由 releaseLoad
//   的 releaseAddon 整组回收；
// - onLocateTarget 订阅即回放当前挂起目标（页面装载晚于定位到达的补投
//   ——搜索跳转可在装载完成前发起；null 表示清除）。

/** 作用域快照：当前生效的作用范围标签 + 工作区在场状态 */
export interface AddonSettingsScopeSnapshot {
  /** 平台作用域标签的当前选中值（user = 用户默认层；workspace = 当前工作区层） */
  readonly scope: 'user' | 'workspace'
  /** 宿主是否打开了工作区（false 时工作区层不可用——组件据此呈现明确状态） */
  readonly hasWorkspace: boolean
}

/** 搜索定位目标（全局设置搜索命中定义/分组后交给自绘页的落点） */
export interface AddonSettingsLocateTarget {
  /** def = 设置定义键；group = 设置分组键（与平台注册的 keys 同空间） */
  readonly kind: 'def' | 'group'
  readonly key: string
}

/** 设置页上下文面（仅设置页提供；编辑器页为 undefined） */
export interface AddonSettingsContextFacet {
  /** 当前作用域快照（拉取式——重复读取同代次内一致，页面级当前值） */
  scopeState(): AddonSettingsScopeSnapshot
  /** 订阅作用域/工作区状态变化；返回退订函数（重复退订无害） */
  onScopeChange(listener: (state: AddonSettingsScopeSnapshot) => void): () => void
  /** 当前未消费的定位目标（null = 无挂起目标） */
  locateTarget(): AddonSettingsLocateTarget | null
  /** 订阅定位目标交付：订阅时如有挂起目标先回放一次（补投），此后每次
   *  交付（含 null 清除）通知；返回退订函数（重复退订无害） */
  onLocateTarget(listener: (target: AddonSettingsLocateTarget | null) => void): () => void
}
