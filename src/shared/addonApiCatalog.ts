// #362 T13 附加组件公开 API——结构化语义清单与发行台账的单一事实源。
//
// 地位（ADR-0012「文档与兼容维护」+ 规格 vsidian-addons.md §7）：本模块与
// CSS 样式契约（styleContract.ts）同等维护。**签名不在此手写第二份**——
// 条目经 signature 指向各事实源模块的导出符号，版本参考由
// scripts/genAddonApiRef.mjs 用 TypeScript 解析从源文件提取声明文本生成；
// 符号缺失或清单自洽性破坏时生成与检查失败（npm run check:addonapi）。
// 公开声明的编译期消费在 test/addonApi/publicApiConsumer.ts（不导入内部
// 控制器；防回潮由 test/unit/addonApiSurface.test.ts 钉住）。
//
// 本文件是文档数据源（语义描述中文为准），不是 UI 文案——CJK 扫描豁免
// 同 styleContract.ts（见 test/unit/i18nScan.ts 的 SCAN_EXCLUDED_PREFIXES）。
// 不进任何 webview bundle（仅生成器与测试消费）。
//
// 维护纪律（改接口必经此处）：
// - 新增/修改分组接口：同步本清单条目（含 semantics 与 verification）、
//   重跑 npm run gen:addonapi 提交产物、按需更新开发指南与消费样例；
// - 台账如实：候选（candidate）与草案（draft）不携带发布日期——未真正
//   发行不得伪造稳定历史；实际发行时改 status=released 并填 releasedAt。

/** 公开能力面的分组 ID（票面 #362 口径：按实现模块面分组；#541 起追加粘贴转换组） */
export type AddonApiGroupId =
  /** ① 发现与安装：宿主清单发现、身份声明、兼容判定、注册入口、官方登记 */
  | 'discovery'
  /** ② 页面 SDK：装载协议、注入 SDK、视图与编辑、通道 */
  | 'page-sdk'
  /** ③ 行为：可组合输入行为的注册、观察与顺序/开关持久 */
  | 'behaviors'
  /** ④ 设置：定义注册、读写、作用范围与设置页 */
  | 'settings'
  /** ⑤ 渲染提供者：代码块渲染候选、确定性选择与自动接管 */
  | 'renderers'
  /** ⑥ 命令/菜单/界面：命令、菜单项、按钮与面板及快捷键 */
  | 'commands-menus-ui'
  /** ⑦ 粘贴转换：声明式粘贴规则注册与富文本粘贴的 HTML→Markdown 接管（#541 起） */
  | 'paste-conversion'

/** 分组定义（参考文档的章节骨架） */
export interface AddonApiGroup {
  readonly id: AddonApiGroupId
  /** 分组中文名 */
  readonly title: string
  /** 能力范围一句话 */
  readonly scope: string
  /** 呈现顺序（1 起） */
  readonly order: number
}

/** 分层：stable-candidate = 稳定 API 面，发行状态见台账与条目说明；experimental = 实验入口 */
export type AddonApiLayer = 'stable-candidate' | 'experimental'

/** 执行端：host = 组件宿主代码（扩展进程）；editor-page / settings-page = 页面代码 */
export type AddonApiEndpoint = 'host' | 'editor-page' | 'settings-page'

/** 签名源：module 为仓库相对路径（.ts）；symbols 为该模块的导出符号名。
 *  生成器逐符号提取声明文本（含紧邻的前导文档注释）；找不到即失败。 */
export interface AddonApiSignatureSource {
  readonly module: string
  readonly symbols: readonly string[]
}

/** 结构化语义（按适用性给出；口径：目标归 purpose，此处的字段是横切约束） */
export interface AddonApiSemantics {
  /** 适用模式（live/reading 及门控） */
  readonly modes?: string
  /** 坐标与数据形状约定 */
  readonly coordinates?: string
  /** 选区形态与回设语义（编辑通道条目，#498 起） */
  readonly selection?: string
  /** 生命周期归属与释放 */
  readonly lifecycle?: string
  /** 错误/拒绝面（普通 API 拒绝与组件故障的区分） */
  readonly errors?: string
  /** 历史/撤回语义（编辑类条目） */
  readonly history?: string
  /** 自动渲染/接管规则（渲染类条目） */
  readonly autoRules?: string
  /** 暴露面裁剪口径（实验入口的最小集合边界，#406 起） */
  readonly language?: string
  /** 按键拦截优先级契约（实验层，#402 起） */
  readonly keymap?: string
  /** 谓词输入的场景命中负载语义（菜单类条目，#436 起） */
  readonly contextPayloads?: string
  /** 多语言名称形态与语言回落（本地化条目，#464 起） */
  readonly localization?: string
  /** 呈现层形态声明与编辑行为（设置控件类条目，#473/#475 起） */
  readonly presentation?: string
}

/** 单个公开接口条目（参考文档的一节） */
export interface AddonApiEntry {
  /** 条目稳定 ID（kebab-case；参考锚点，一经公开不再变更） */
  readonly id: string
  readonly group: AddonApiGroupId
  /** 能力名（条目标题） */
  readonly title: string
  readonly layer: AddonApiLayer
  /** 执行端集合 */
  readonly endpoints: readonly AddonApiEndpoint[]
  /** 签名源（不手写第二份签名——生成器从事实源提取） */
  readonly signatures: readonly AddonApiSignatureSource[]
  /** 目标：做什么、不做什么 */
  readonly purpose: string
  readonly semantics: AddonApiSemantics
  /** 验证定位（测试文件路径，仓库相对） */
  readonly verification: readonly string[]
  /** 引入记录（票号） */
  readonly introduced: string
  /** layer=experimental 时必填：清单 experimental 声明的入口名 */
  readonly experimentalEntry?: string
}

// ---- 发行台账 ----

/**
 * 台账状态机：draft = 草案（形状仍在变）；candidate = 候选（形状已随消费
 * 样例冻结、待发行）；released = 已实际发行；deprecated / removed = 已按
 * 移除规则弃用/移除。**只有 released 起才允许携带 releasedAt**——未真正
 * 发行不得伪造日期；候选升级为已发布是人工落账动作，不是生成时自动推导。
 */
export type AddonApiReleaseStatus = 'draft' | 'candidate' | 'released' | 'deprecated' | 'removed'

/** 实验入口兼容清单条目（清单 experimental 声明的入口名 → 候选/已发布版本） */
export interface AddonApiExperimentalEntry {
  /** 入口名（清单 experimental 表的键，如 'cm6'） */
  readonly entry: string
  /** 入口版本（独立于稳定 API 版本） */
  readonly version: string
  readonly status: AddonApiReleaseStatus
  /** 仅 released 起可携带 */
  readonly releasedAt?: string
  /** 边界说明（实验入口必须显式声明兼容边界） */
  readonly note?: string
}

/** API 版本发行记录（版本号独立于 Vsidian 本体版本） */
export interface AddonApiReleaseRecord {
  readonly version: string
  readonly status: AddonApiReleaseStatus
  /** 实际发布日期（YYYY-MM-DD；仅 released/deprecated/removed 可携带） */
  readonly releasedAt?: string
  readonly summary: string
  /** 该版本的实验入口兼容清单 */
  readonly experimental: readonly AddonApiExperimentalEntry[]
}

/** 稳定 API 移除规则（ADR-0012「文档与兼容维护」原文口径，生成进参考） */
export const ADDON_API_REMOVAL_RULE =
  '稳定 API 默认长期兼容。确需移除时，先发布弃用说明与替代方案；从包含该弃用的版本实际发布之日起，至少经过两个后续 API 次版本且满 30 天，两项门槛同时满足才允许移除。版本跨度按独立 API 版本计算，不按 Vsidian 本体版本计算。'

/** 签名源模块的合法前缀（公开声明所在：shared 事实源、宿主导出面、V02 构建桥声明） */
const SIGNATURE_MODULE_ALLOWED_PREFIXES = ['src/shared/', 'src/host/addons/', 'test/fixtures/addon-v02/sdk/']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 台账状态可携带日期的档位（draft/candidate 携带日期 = 伪造发行史，拒绝） */
function statusAllowsDate(status: AddonApiReleaseStatus): boolean {
  return status === 'released' || status === 'deprecated' || status === 'removed'
}

/**
 * 清单自洽校验（生成器入口与单测共用；返回问题列表，空数组 = 通过）。
 * 覆盖：分组引用、条目 ID 唯一、实验分层互斥、签名源路径合法、台账日期
 * 诚实性（候选不带日期、已发布必有日期、日期格式）、每组至少一条。
 */
export function validateAddonApiCatalog(
  groups: readonly AddonApiGroup[],
  entries: readonly AddonApiEntry[],
  releases: readonly AddonApiReleaseRecord[],
): string[] {
  const problems: string[] = []
  const groupIds = new Set(groups.map((g) => g.id))
  if (groupIds.size !== groups.length) {
    problems.push('分组 ID 重复')
  }
  const seenEntryIds = new Set<string>()
  const experimentalEntries = new Set<string>()
  for (const record of releases) {
    for (const exp of record.experimental) {
      if (experimentalEntries.has(exp.entry)) {
        problems.push(`实验入口 '${exp.entry}' 在台账中出现多次`)
      }
      experimentalEntries.add(exp.entry)
    }
  }
  for (const entry of entries) {
    if (seenEntryIds.has(entry.id)) {
      problems.push(`条目 ID 重复：${entry.id}`)
    }
    seenEntryIds.add(entry.id)
    if (!groupIds.has(entry.group)) {
      problems.push(`条目 ${entry.id} 引用未知分组 ${entry.group}`)
    }
    if (entry.layer === 'experimental') {
      if (entry.experimentalEntry === undefined) {
        problems.push(`实验条目 ${entry.id} 缺 experimentalEntry`)
      } else if (!experimentalEntries.has(entry.experimentalEntry)) {
        problems.push(`实验条目 ${entry.id} 的入口 '${entry.experimentalEntry}' 不在台账实验清单中`)
      }
    } else if (entry.experimentalEntry !== undefined) {
      problems.push(`稳定候选条目 ${entry.id} 不应携带 experimentalEntry`)
    }
    if (entry.signatures.length === 0) {
      problems.push(`条目 ${entry.id} 缺签名源`)
    }
    for (const source of entry.signatures) {
      if (!SIGNATURE_MODULE_ALLOWED_PREFIXES.some((prefix) => source.module.startsWith(prefix))) {
        problems.push(`条目 ${entry.id} 的签名源模块越界：${source.module}（公开声明只应在 ${SIGNATURE_MODULE_ALLOWED_PREFIXES.join(' / ')}）`)
      }
      if (source.symbols.length === 0) {
        problems.push(`条目 ${entry.id} 的签名源 ${source.module} 缺符号`)
      }
    }
  }
  for (const group of groups) {
    if (!entries.some((entry) => entry.group === group.id)) {
      problems.push(`分组 ${group.id} 没有条目`)
    }
  }
  const seenVersions = new Set<string>()
  for (const record of releases) {
    if (seenVersions.has(record.version)) {
      problems.push(`台账版本重复：${record.version}`)
    }
    seenVersions.add(record.version)
    if (record.releasedAt !== undefined) {
      if (!statusAllowsDate(record.status)) {
        problems.push(`版本 ${record.version} 状态为 ${record.status}，不得携带发布日期（未发行不伪造历史）`)
      }
      if (!DATE_RE.test(record.releasedAt)) {
        problems.push(`版本 ${record.version} 的 releasedAt 不是 YYYY-MM-DD：${record.releasedAt}`)
      }
    } else if (statusAllowsDate(record.status)) {
      problems.push(`版本 ${record.version} 状态为 ${record.status}，必须携带实际发布日期`)
    }
    const seenExp = new Set<string>()
    for (const exp of record.experimental) {
      if (seenExp.has(exp.entry)) {
        problems.push(`版本 ${record.version} 的实验入口 '${exp.entry}' 重复`)
      }
      seenExp.add(exp.entry)
      if (exp.releasedAt !== undefined) {
        if (!statusAllowsDate(exp.status)) {
          problems.push(`实验入口 ${exp.entry}@${exp.version} 状态为 ${exp.status}，不得携带发布日期`)
        }
        if (!DATE_RE.test(exp.releasedAt)) {
          problems.push(`实验入口 ${exp.entry}@${exp.version} 的 releasedAt 不是 YYYY-MM-DD`)
        }
      } else if (statusAllowsDate(exp.status)) {
        problems.push(`实验入口 ${exp.entry}@${exp.version} 状态为 ${exp.status}，必须携带实际发布日期`)
      }
    }
  }
  return problems
}

/** 公开能力面分组（#362 首版六组；#541 起追加粘贴转换组） */
export const ADDON_API_GROUPS: readonly AddonApiGroup[] = [
  {
    id: 'discovery',
    title: '发现与安装',
    scope: '宿主清单发现、身份声明、兼容判定、注册入口与官方登记',
    order: 1,
  },
  {
    id: 'page-sdk',
    title: '页面 SDK',
    scope: '编辑器/设置页的装载协议、注入 SDK、统一视图与编辑、通道',
    order: 2,
  },
  {
    id: 'behaviors',
    title: '输入行为',
    scope: '可组合行为的注册、观察与顺序/开关持久',
    order: 3,
  },
  {
    id: 'settings',
    title: '设置',
    scope: '定义注册、读写与来源、作用范围、自定义设置页',
    order: 4,
  },
  {
    id: 'renderers',
    title: '渲染提供者',
    scope: '代码块渲染候选登记、确定性选择与自动接管',
    order: 5,
  },
  {
    id: 'commands-menus-ui',
    title: '命令/菜单/界面',
    scope: '命令、菜单项、工具栏按钮与面板及统一快捷键',
    order: 6,
  },
  {
    id: 'paste-conversion',
    title: '粘贴转换',
    scope: '声明式粘贴规则注册与富文本粘贴的 HTML→Markdown 转换接管（#541 T01 基础链路）',
    order: 7,
  },
]

/** 语义清单条目（全部分组） */
export const ADDON_API_ENTRIES: readonly AddonApiEntry[] = [
  // ---- ① 发现与安装 ----
  {
    id: 'manifest-declaration',
    group: 'discovery',
    title: '私有身份声明（vsidianAddon 清单字段）',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonIdentity.ts',
        symbols: ['ADDON_MANIFEST_FIELD', 'ADDON_IDENTITY_MANIFEST_VERSION', 'AddonIdentityDeclaration', 'AddonDeclarationParseResult'],
      },
    ],
    purpose:
      '组件在自己的 package.json 顶层用私有字段声明身份与兼容范围。没有声明的普通扩展不进入组件列表；声明非法者保留状态与原因，不静默忽略。',
    semantics: {
      lifecycle: 'manifestVersion 是身份声明格式版本（当前 1），与公开 API 版本分开；清单只承担识别与兼容，不列能力与激活条件（能力由代码注册）。',
      errors: '四种可辨认拒绝原因：field-not-object / manifest-version-unsupported / api-invalid / experimental-invalid。',
    },
    verification: ['test/unit/addonIdentity.test.ts', 'test/integration/suite/addonT02Cases.ts'],
    introduced: '#350（T01）',
  },
  {
    id: 'compatibility',
    group: 'discovery',
    title: '兼容判定（稳定 API 范围与实验入口）',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonIdentity.ts',
        symbols: ['ADDON_API_VERSION', 'AddonCompatibilityHost', 'AddonCompatibility', 'checkAddonCompatibility'],
      },
    ],
    purpose:
      '声明的 api 范围须包含宿主当前稳定 API 版本（首个候选 1.0.0）；声明的实验入口逐项核对宿主已提供且版本匹配。API 版本独立于 Vsidian 本体版本号。',
    semantics: {
      lifecycle: '不因普通本体升级自动改变稳定 API 兼容判断；宿主实验入口未提供的入口名判 experimental-unsupported（如实反映未发布）。',
      errors: 'api-range / experimental-unsupported / experimental-incompatible 三种拒绝；experimental 拒绝时点名入口名。',
    },
    verification: ['test/unit/addonIdentity.test.ts', 'test/unit/addonRegistry.test.ts'],
    introduced: '#350（T01）',
  },
  {
    id: 'register-addon',
    group: 'discovery',
    title: '宿主注册入口（registerAddon）',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/host/addons/addonWiring.ts',
        symbols: ['VsidianAddonExports', 'VSIDIAN_EXTENSION_ID'],
      },
    ],
    purpose:
      'Vsidian activate() 返回的公开导出 API：组件经 extensions.getExtension(\'onegayi.vsidian\').exports 调用 registerAddon 接入。owner 为调用者的原生 Extension 身份，组件激活中即可调用（不要求 isActive）。',
    semantics: {
      lifecycle: 'Vsidian 先就绪 API 再扫描唤醒；VSCode 也可能先原生激活组件——两条路径使用相同的校验。同一接入代次重复注册返回 already-registered（不重跑 setup）；手动重试先 dispose 旧句柄再注册。dispose 重复调用无害。',
      errors: '四种拒绝：not-addon-extension / extension-not-in-host / incompatible-api / already-registered（普通 API 拒绝，不算组件故障）。',
    },
    verification: ['test/unit/addonHostRegistration.test.ts', 'test/unit/addonCoordinator.test.ts', 'test/integration/suite/addonT02Cases.ts'],
    introduced: '#350（T01）、#351（T02）',
  },
  {
    id: 'addon-definition',
    group: 'discovery',
    title: '注册定义与两段生命周期（setup/enable）',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/host/addons/addonRegistry.ts',
        symbols: ['AddonDefinition', 'AddonSetupContext', 'AddonEnableContext', 'AddonRegistrationHandle'],
      },
    ],
    purpose:
      '设置接入与运行功能分别管理：setup 注册设置定义、自己的设置页与设置通信（普通停用后保留）；enable 注册编辑器页面入口与运行功能（按用户功能开关启停）。',
    semantics: {
      lifecycle: 'setup 在注册成功时本代次恰好一次；enable 开启时调用、关闭或故障时释放所属注册；作者可登记清理回调，退出作用范围时执行。可归因的注册/初始化/回调异常触发全组件故障暂停（释放注册、保留偏好、提供手动重试）。',
    },
    verification: ['test/unit/addonRuntime.test.ts', 'test/integration/suite/addonT02Cases.ts', 'test/integration/suite/addonT12Cases.ts'],
    introduced: '#351（T02）',
  },
  {
    id: 'official-registry',
    group: 'discovery',
    title: '官方（核心）组件登记表',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/officialAddons.ts',
        symbols: ['OfficialAddonEntry', 'OFFICIAL_ADDON_REGISTRY', 'OFFICIAL_ADDON_EXTENSION_IDS'],
      },
    ],
    purpose:
      '官方归属只由主仓库维护的扩展 ID 清单判定（唯一入口 isOfficialAddon）；组件不能自行声明「核心」。表内已登记首个官方组件 vsidian-easy-typing，后续官方组件发布时增行登记。',
    semantics: {
      lifecycle: '登记官方组件只改 officialAddons.ts；表内容变化不构成兼容性承诺（第三方不得依据曾在表内/表外主张契约）。',
    },
    verification: ['test/unit/addonIdentity.test.ts'],
    introduced: '#354（T05）',
  },
  {
    id: 'addon-status',
    group: 'discovery',
    title: '组件状态模型与设置页呈现',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonIdentity.ts',
        symbols: ['AddonStatusEntry', 'AddonStatusKind'],
      },
    ],
    purpose:
      '设置页「附加组件」分页的状态载荷：七种状态覆盖注册、唤醒在途、待注册、不兼容、激活失败、宿主不可查与声明非法；故障暂停标注但不改变「已启用」归类。#472 起已注册有定义组件附带 settingsSearchIndex 摘要（定义 title/description 与组声明——组件设置分页全局搜索索引的数据源，随 addons.state 既有链路推送）。',
    semantics: {
      lifecycle: '启用偏好与实际故障分别记录（enabled 与 fault 两个字段）；host-unavailable 原因不可判——不直接写成未安装或装错侧。',
    },
    verification: ['test/integration/suite/addonT02Cases.ts', 'test/browser/addonSidebar.mjs'],
    introduced: '#350（T01）、#355（T06 运行状态）、#472（搜索摘要）',
  },
  // ---- ② 页面 SDK ----
  {
    id: 'page-sdk',
    group: 'page-sdk',
    title: '注入组件工厂的页面 SDK',
    layer: 'stable-candidate',
    endpoints: ['editor-page', 'settings-page'],
    signatures: [
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['VsidianAddonPageSdk', 'AddonPageFactory', 'AddonPageKind'],
      },
    ],
    purpose:
      '装载器核对入口身份后调用工厂注入 SDK：装载身份（组件 ID + 代次 + 页面种类）、七个能力 facet（views/behaviors/behaviorState/settingsContext/commands/menus/renderers 等）、CM6 扩展登记、设置页挂载根、资源地址与释放回调。',
    semantics: {
      lifecycle: '代次是硬边界：旧工厂注册、旧消息、迟到结果不能接入新代次；onDispose 回调在停用/故障/代次回收时执行（重复释放无害）。',
      errors: 'views/behaviors/commands/menus/renderers/ui 六个 facet 仅编辑器页提供（设置页为 undefined）；behaviorState 与 settingsContext 两面两端点分布——前者编辑器页与设置页均提供、后者仅设置页提供；resourceUri 越出资源子目录返回 null（组件不得自造越界地址）。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/browser/addonPageSdk.mjs', 'test/integration/suite/addonT02Cases.ts'],
    introduced: '#351（T02），facet 随 T06–T11 与 #553 增补',
  },
  {
    id: 'page-locale',
    group: 'page-sdk',
    title: '页面生效语言快照与订阅（locale）',
    layer: 'stable-candidate',
    endpoints: ['editor-page', 'settings-page'],
    signatures: [{ module: 'src/shared/addonPage.ts', symbols: ['AddonLocaleFacet'] }],
    purpose:
      '#582 新增只读 sdk.locale：组件按平台生效语言选择自己的文案，语言切换时就地更新已挂载界面，不重载工厂或清空组件状态。本能力开发中，尚未计入已发行 API 版本；旧宿主须特性检测。',
    semantics: {
      modes: '编辑器页与设置页均提供，与 live/reading 模式无关。SDK 声明为可选成员以兼容旧宿主与既有结构化消费者；本面没有语言设置写入成员。',
      localization: '与平台 UI 共用 resolveLocale(general.language, vscode.env.language) 的生效结果：显式偏好优先，auto 跟随宿主显示语言。页面只读首帧数据岛与 locale.changed 已装配的 i18n 快照，不读取 navigator.language、操作系统语言或裸宿主语言作为旁路。当前代码为 en / zh-cn，公开返回类型为 string；仅缺失或损坏语言启动数据时沿用内核空串，不伪造回退语言。',
      lifecycle: 'get 同步读取当前快照，查询不受代次释放影响。onChange 不立即回放，首值由 get 读取；只在生效语言代码变化时通知，同语言换包不重发，回调前 get 已是新值。同一回调的多次订阅独立；返回幂等退订函数，所属装载释放时自动全部回收，已释放代次的迟到订阅为 no-op。',
      errors: '订阅回调同步抛错按既有主题环境口径归因上报组件运行期故障，由宿主裁决暂停；不阻断平台语言刷新与其他组件的通知。',
    },
    verification: [
      'test/unit/addonPageLocale.test.ts',
      'test/unit/addonSettingsArea.test.ts',
      'test/unit/addonApiSurface.test.ts',
      'test/addonApi/publicApiConsumer.ts',
      'test/browser/addonSettingsContext.mjs',
      'test/integration/suite/addonT02Cases.ts',
    ],
    introduced: '#582',
  },
  {
    id: 'page-settings-context',
    group: 'page-sdk',
    title: '设置页上下文面（settingsContext）',
    layer: 'stable-candidate',
    endpoints: ['settings-page'],
    signatures: [
      {
        module: 'src/shared/addonSettingsContextApi.ts',
        symbols: ['AddonSettingsContextFacet', 'AddonSettingsScopeSnapshot', 'AddonSettingsLocateTarget'],
      },
    ],
    purpose:
      '#553 详情自绘页优先起设置页提供的平台上下文：作用域标签状态（用户默认/当前工作区 + 工作区在场）与全局设置搜索的定位目标（定义/分组键）的快照读取与变化订阅——组件自绘设置页据此对齐「当前写到哪一层」并承接搜索跳转的页内定位（切自己的页内 Tab 并定位控件），不读取平台私有 DOM。',
    semantics: {
      lifecycle: '查询（scopeState/locateTarget）不做代次守卫（只读无副作用）；订阅（onScopeChange/onLocateTarget）过 isLoadActive 守卫——已释放代次的迟到登记为 no-op 退订，释放时已有的订阅由 releaseLoad 整组回收。onLocateTarget 订阅即回放当前挂起目标（页面装载晚于定位到达的补投；null 表示清除）。',
      modes: '仅设置页提供（编辑器页为 undefined）；数据源是设置页的平台外壳——作用域切换点击与 #472 定位链路经页面级 runtime 上抛。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/browser/addonSettingsContext.mjs'],
    introduced: '#553',
  },
  {
    id: 'page-load-protocol',
    group: 'page-sdk',
    title: '页面装载协议（指令与出站消息）',
    layer: 'stable-candidate',
    endpoints: ['editor-page', 'settings-page'],
    signatures: [
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['AddonLoadManifest', 'AddonLoadOutcome', 'AddonLoadFailureReason', 'AddonUnloadOutcome', 'AddonPageDirective', 'AddonPageOutbound'],
      },
    ],
    purpose:
      '宿主与页面之间的装载/卸载/通道/故障消息形状。装载实现细节（作者一般经构建桥间接使用，不直接记忆桥接名）；每 webview 资源独立授权，不复用另一页 URI。',
    semantics: {
      lifecycle: '装载指令携带代次；卸载结果区分 not-loaded / stale-generation / already-released；样式逐条独立装载互不牵连。',
      errors: '五种装载失败原因：already-loaded / script-load-failed / identity-mismatch / no-factory-registered / factory-error（工厂同步异常与 async 工厂 rejection 同归因：按故障释放全部注册并整代次回滚，rejection 迟到则静默丢弃）。',
    },
    verification: ['test/unit/addonPageLoader.test.ts'],
    introduced: '#351（T02）',
  },
  {
    id: 'page-bridge',
    group: 'page-sdk',
    title: 'SDK 构建桥（vsidian-addon-sdk 虚拟模块）',
    layer: 'stable-candidate',
    endpoints: ['editor-page', 'settings-page'],
    signatures: [
      {
        module: 'test/fixtures/addon-v02/sdk/vsidian-addon-sdk.d.ts',
        symbols: ['defineAddonPage', 'currentSdk'],
      },
    ],
    purpose:
      '构建辅助工具提供的作者入口：defineAddonPage 在 IIFE 执行时把工厂推入全局登记表（作者不手写全局变量），currentSdk 读装载器注入槽（仅工厂执行期可靠）。',
    semantics: {
      lifecycle: '构建桥在 esbuild 解析期注入 shim（不是真实 npm 包）；组件产物为独立 IIFE（目标 chrome114——对齐下界宿主 Electron 25 / Chromium 114）。',
      autoRules: '构建桥拒绝 @codemirror/* 值导入（第一道防线）；产物静态标记断言不含 CM6 运行时串（第二道）——组件不得重打包 CM6，须经 experimental.cm6 取得。',
    },
    verification: ['test/fixtures/addon-v02/sdk/buildAddon.mjs', 'test/browser/addonPageSdk.mjs'],
    introduced: '#349（V02 验证）、#351（T02 生产化）',
  },
  {
    id: 'document-navigation',
    group: 'page-sdk',
    title: '文档打开与定位（views.openDocument）',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [{ module: 'src/shared/addonNavApi.ts', symbols: [
      'AddonDocNavLocate', 'AddonDocNavRequest', 'AddonDocNavRejection', 'AddonDocNavResult',
    ] }],
    purpose: '组件提交来源实例、目标路径与互斥定位，由宿主打开 Markdown 或原生文本并报告实际打开与定位结果；不提供任意文件读取面。',
    semantics: {
      modes: '仅编辑器页，Live 与阅读态均可调用；来源可为 main/embed/hover 的有效视图，设置页不提供。',
      coordinates: '目标以来源视图的目标文档目录解析；行号为 1-based 正整数，标题与块 ID 互斥。空 target 为来源文档自身；首次越界不钳末行。CRLF 经 NewlineCoordinator 换算为 LF 行首。',
      lifecycle: '组件身份与代次由 SDK 注入，来源必须仍在当前页面注册表；来源释放、页面重载、代次结束和超时终结在途请求，拒收迟到回包与定位。Markdown 经既有 view.locate/ack 确认，等待面板就绪后重读权威文本。',
      errors: '成功区分 opened 与 located；失败携带 opened 与 invalid-request/no-workspace/escape/not-found/view-disposed/anchor-not-found/out-of-bounds/delivery-failed/error 原因。普通拒绝不触发组件故障，API 不重复弹通知。',
    },
    verification: ['test/unit/addonNavApi.test.ts', 'test/unit/addonDocNav.test.ts', 'test/unit/addonDocNavDelivery.test.ts', 'test/unit/addonViews.test.ts', 'test/browser/addonDocNav.mjs', 'test/integration/suite/addonDocNavCases.ts'],
    introduced: '#543（扩展批次 T03）',
  },
  {
    id: 'views-editor',
    group: 'page-sdk',
    title: '统一视图与编辑面（views / editor）',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonEditApi.ts',
        symbols: ['AddonViewsFacet', 'AddonViewHandle', 'AddonViewInfo', 'AddonViewEditorFacet', 'AddonEditorSnapshot', 'AddonSelectionRange', 'AddonApplyEditsRequest', 'AddonApplyEditsResult', 'AddonEditRejection', 'AddonEditCredential'],
      },
    ],
    purpose:
      '主正文、嵌入内部 Live 与悬停引用共用统一句柄：枚举/订阅实例、读取快照、提交文本修饰（默认原子或显式 joinPrevious）、选区与定位。操作始终归当前目标文档——在引用 B 中编辑不误改父文档 A。',
    semantics: {
      modes: 'live 可写、reading 只读；hover 恒只读（写入拒 read-only）；embed 句柄身份为宿主 occurrence 序号。',
      coordinates: '全文 UTF-16 code unit 偏移、页面全程 LF（宿主适配器负责行尾转换）；快照含页面未确认输入——revision 标记覆盖「宿主版本未变但页面有未确认输入」的窗口。',
      selection: 'applyEdits 提交后选区双形态（#498）：单对象 = 单选区（旧形态，既有组件零迁移）；数组 = 多光标回设——多 ranges 随文本事务同笔原子生效（不坍缩其余光标），主光标 = 数组首项（对齐 setSelection；乱序输入经 CM6 归一化排序，mainIndex 随首项重定位），空数组拒绝 invalid-request；缺省不携带则保持实例现有选区重定位。边界校验逐 range 覆盖（docLength + growth 上界，越界整体拒绝）。行为修饰计划（AddonBehaviorInputPlan.selection）同形态透传。',
      lifecycle: '来源身份由 SDK 注入（opId 按装载代次生成），作者请求结构上不携带身份字段——不能冒充其他组件。',
      errors: '八种可辨认拒绝：view-disposed / read-only / suspended / stale-snapshot / history-boundary / conflict / error / invalid-request。旧快照不自动重试（内核输入重定位逻辑不适用于 API 提交）。',
      history: 'atomic（缺省）= 独立撤回边界；joinPrevious = 随同目标上次原子操作撤回，无可确认前项时拒绝（history-boundary 四种形态：空日志/仅外来/组顶被打断/映射失配）。撤销与重做归宿主文本管线。',
    },
    verification: ['test/unit/addonEditApi.test.ts', 'test/unit/addonViews.test.ts', 'test/unit/liveInstance.test.ts', 'test/integration/suite/addonT06Cases.ts', 'test/browser/addonT06EditHost.mjs', 'test/integration/suite/addonHistoryCases.ts'],
    introduced: '#355（T06）',
  },
  {
    id: 'cm6-experimental',
    group: 'page-sdk',
    title: '实验入口：共享 CM6 运行时（experimental.cm6）',
    layer: 'experimental',
    experimentalEntry: 'cm6',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['AddonCm6Runtime', 'AddonCm6LanguageRuntime'],
      },
    ],
    purpose:
      '页面 bundle 自构造的 CM6 模块命名空间（state 与 view）与语法树读取子集（language，#406 起），与生产控制器共享同一实例（构造器身份一致）。供高级扩展登记真正的 CM6 Extension 与做基于语法树的行类型判定。',
    semantics: {
      lifecycle: '仅编辑器页提供（设置页 undefined）；使用前须在清单 experimental 声明 cm6 兼容范围，且范围含宿主提供的入口版本才判兼容。',
      language: 'language 只暴露 syntaxTree / ensureSyntaxTree / syntaxTreeAvailable 三个读树函数（最小暴露集合的单一裁剪点在装载器的 addonCm6LanguageSubset）——LRLanguage / foldGutter / indentUnit 等注册类成员不纳入，addon 不应借实验入口注册语言或改全局语言配置；树与节点类型经 type-only 导入消费（构建桥允许）。已知边界：live 编辑器的 markdown 语法树是内核私有增量解析（不经 @codemirror/language 的 language facet 装配），syntaxTree 在 live 状态上恒为未解析空树——行类型判定类需求不能依赖本入口，平台级树查询能力另行评估。',
      keymap: '#402 按键拦截优先级契约（实验层）：扩展槽为平台扩展数组末位——普通 keymap 在平台情境链（Tab 三段/列表续行等）不处理时落空接手；Prec.high 为抢先层（可替代平台键位，返回 false 落穿）；撤销/重做（Mod-z / Shift-Mod-z / Mod-y）是 Prec.highest 的平台保留键闸、在扩展序上先于附加组件槽——addon 用 Prec.highest 也不可越过；Esc 与宿主级快捷键不开放抢先；多组件同层按装载顺序仲裁；实验层 keymap 不进统一快捷键管理，用户关闭 = 停用组件。',
      errors: '宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/browser/addonPageSdk.mjs'],
    introduced: '#349（V02）、#351（T02 登记候选版本）、#406（language 语法树子集）',
  },
  {
    id: 'heading-fold-experimental',
    group: 'page-sdk',
    title: '实验入口：标题折叠查询与命令（experimental.headingFold）',
    layer: 'experimental',
    experimentalEntry: 'headingFold',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonFoldApi.ts',
        symbols: [
          'AddonHeadingFoldSpan',
          'AddonHeadingFoldOperation',
          'AddonHeadingFoldApplyOptions',
          'AddonHeadingFoldRejection',
          'AddonHeadingFoldQueryResult',
          'AddonHeadingFoldCommandResult',
          'AddonHeadingFoldFacet',
        ],
      },
    ],
    purpose:
      '页面 SDK 的标题折叠实验入口（sdk.experimental.headingFold，#410）：按 views 面实例 ID 查询有效折叠区间（folds）与可折叠区间全集（foldable），并执行折叠命令（apply 五操作、foldAt/unfoldAt 按区间键批量组合、foldAll 可 upToLevel 参数化）。折叠本体随 #409 落地（Live 实例的 CM6 StateField）；查询消费本体派生视图（不复制派生逻辑），命令直传本体五操作执行体——编程触发与用户触发同链路（effect 直驱，无 DOM-only 路径）。',
    semantics: {
      modes: 'Live-only（#409 定案阅读模式不开放）：reading 态主正文与 hover 只读视图一律 read-only 拒绝；设置页不提供该入口。实例按 views 面句柄寻址（main / embed occurrence 键），折叠态随实例独立；keymap/扩展回调拿到 CM6 view 时经 experimental.viewIdentity.instanceIdOf 反查实例 ID（#426，不依赖扩展槽装配范围推定）。',
      coordinates: '全文 UTF-16 code unit 偏移、页面全程 LF。span = { key（标题起始行行首）、level（ATX 1–6 / Setext 1–2）、hideFrom（标题块行尾）、hideTo（下一级别 ≤ 自身的标题行首或文档末尾）}；序列化面不含标题文本摘要（大文档保持精简——作者可从快照 text 与 key 对应标题行自取）。',
      lifecycle: '折叠是视图态（零写回、不 dirty、不进撤销栈、不跨会话持久化）；全文替换显式清空、编辑时键随增量映射（#409 本体语义）。原始键集不对外——folds 是「折叠键 ∩ 可折叠标题键」的有效派生视图，脱靶键经此过滤天然无行为（foldAt/unfoldAt 的脱靶键静默忽略；applied = 有效折叠区间前后变化数）。#426 起 folds 与 foldable 共享同一 doc 版本的派生缓存（调用成本为 O(标题数) 过滤而非全文档重扫；返回逐项拷贝，组件侧变异不污染缓存），按键热路径消费无需自建行门槛节流。组件代次终结后的迟到调用拒绝 view-disposed。',
      errors: '三种可辨认拒绝：view-disposed / read-only / invalid-request（upToLevel 仅 foldAll 接受且须为 1–6 整数；区间键须为非负整数）。使用前须在清单 experimental 声明 headingFold 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。',
    },
    verification: ['test/unit/addonFoldApi.test.ts', 'test/unit/addonHeadingFoldApi.test.ts', 'test/browser/addonHeadingFold.mjs'],
    introduced: '#410',
  },
  {
    id: 'view-identity-experimental',
    group: 'page-sdk',
    title: '实验入口：视图身份反查（experimental.viewIdentity）',
    layer: 'experimental',
    experimentalEntry: 'viewIdentity',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonEditApi.ts',
        symbols: ['AddonViewIdentityFacet'],
      },
    ],
    purpose:
      '页面 SDK 的视图身份反查面（sdk.experimental.viewIdentity，#426）：CM6 EditorView → views 面实例 ID。keymap/扩展回调拿到的是 view，按实例 ID 寻址的 API（headingFold 查询与命令等）经此换算——不再依赖「扩展槽仅挂主正文 Live 实例」的装配范围推定（该装配范围契约见开发指南「视图身份与扩展槽」）。',
    semantics: {
      lifecycle: '身份承载于 Live 实例的 CM6 StateField，注册进视图注册表时写入（main 恒 main；embed 为 embed:<hostId>）；实例销毁随 state 消亡。未装配身份的 view（非平台实例或尚未注册）返回 null——组件据此自判。方法为闭包实现，无 this 依赖（解构裸传安全；SDK 各面通用的接收者绑定约束见开发指南）。',
      errors: '使用前须在清单 experimental 声明 viewIdentity 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/unit/liveInstance.test.ts', 'test/unit/addonRegistry.test.ts'],
    introduced: '#426',
  },
  {
    id: 'syntax-experimental',
    group: 'page-sdk',
    title: '实验入口：行类型与行内标记查询（experimental.syntax）',
    layer: 'experimental',
    experimentalEntry: 'syntax',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonSyntaxApi.ts',
        symbols: [
          'AddonSyntaxLineKind',
          'AddonSyntaxInlineKind',
          'AddonSyntaxRejection',
          'AddonSyntaxLineJudge',
          'AddonSyntaxInlineJudge',
          'AddonSyntaxLineTypeResult',
          'AddonSyntaxInlineResult',
          'AddonSyntaxFacet',
        ],
      },
    ],
    purpose:
      '页面 SDK 的行类型/行内标记位置查询面（sdk.experimental.syntax，#433，#408 B+ 形态落定）：光标驱动的单点查询，供输入行为类组件判定当前位置语义（替代组件自带的全文档文本扫描）。live 树对 frontmatter 反语义（HorizontalRule/SetextHeading2）、公式零语义（皆 Paragraph），查询面在平台侧组合三条常驻管线（增量树 + frontmatter 区间缓存 + 跨行公式块表）给出平台自有枚举——不暴露树/节点句柄，不把 Lezer 节点名变成事实契约。',
    semantics: {
      modes: 'Live-only：reading 态主正文与 hover 只读视图一律 read-only 拒绝；设置页不提供该入口。实例按 views 面句柄寻址，与 headingFold 同款；keymap/扩展回调可经 viewIdentity.instanceIdOf 反查实例 ID。',
      coordinates: '全文 UTF-16 code unit 偏移、页面全程 LF。pos 为非负整数（否则 invalid-request；形状校验在边界拒绝之后——视图不在场或非 Live 时先折 view-disposed / read-only）；超出文档长度时钳制到文末（行尾是合法光标位）。',
      lifecycle: '位置驱动单点查询（µs 级：三管线常驻快照 + 单行扫描），无全树 iterate 形态；查询零写回。行类型判定链：frontmatter 区间（行级，树上反语义先拦截）→ 跨行公式块表（块级代码上下文内不命中——块表是纯文本扫描，围栏/缩进代码内 $$ 是字面，与 live 渲染抑制同口径；公式块内容含行内代码 span 不受影响）→ 树链枚举（code（围栏与缩进代码）> table > heading > list > quote，嵌套组合取先命中者）→ 单行闭合块 $$x$$（独占一行）→ 兜底 text。行内标记判定链：frontmatter → none（源码态）→ InlineCode → code → 其余代码上下文 → none（$ 为字面）→ 公式块表/当前行扫描 → formula → 兜底 none。',
      errors: '三种可辨认拒绝：view-disposed / read-only / invalid-request（pos 须为非负整数）。使用前须在清单 experimental 声明 syntax 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。nodeNames 为诊断载荷，显式声明非稳定、不构成兼容承诺（节点名随解析器升级变化）。',
    },
    verification: ['test/unit/addonSyntaxApi.test.ts', 'test/unit/addonSyntaxSdk.test.ts', 'test/unit/addonRegistry.test.ts'],
    introduced: '#433',
  },
  {
    id: 'host-settings-experimental',
    group: 'page-sdk',
    title: '实验入口：宿主设置白名单读取（experimental.hostSettings）',
    layer: 'experimental',
    experimentalEntry: 'hostSettings',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonHostSettingsApi.ts',
        symbols: [
          'ADDON_HOST_SETTING_KEYS',
          'AddonHostSettingKey',
          'AddonHostSettingValue',
          'AddonHostSettingsRejection',
          'AddonHostSettingGetResult',
          'AddonHostSettingsFacet',
          'addonHostSettingGet',
        ],
      },
    ],
    purpose:
      '页面 SDK 的宿主设置读取面（sdk.experimental.hostSettings，#457）：按显式白名单读宿主设置的当前生效值（首项 editor.readingBreaks——阅读渲染宽松换行，#423），供组件按宿主行为决定自身门控（如 easy-typing 严格换行三模式）。不开放任意 configuration 全量读取——读取范围收敛是本入口的存在前提。',
    semantics: {
      modes: '仅编辑器页提供（设置页不提供该入口）；不按视图模式门控——设置值与 live/reading 视图状态无关。',
      lifecycle: '拉取式快照：每次 get 经快照读取器取最新值（数据源为编辑器面板的设置快照缓存，settings.snapshot/settings.changed 到达即更新）——宿主保存热更后下次 get 即新值，无需重开面板。首版不提供 onDidChange 推送通知（#457 评估定案：门控类消费只需读当前值；需即时感知时在输入回调中重读）。快照未达或键缺失回定义表默认值（与宿主渲染的缺键口径一致）。与宿主一致性：值来自宿主设置快照投影，无独立合成层——host settings 为 globalState 单层（无工作区覆盖层），透传即与宿主完全一致。',
      errors: '两种可辨认拒绝：invalid-key（白名单外键——读取范围收敛，不静默 undefined）/ view-disposed（组件代次已终结的迟到调用）。使用前须在清单 experimental 声明 hostSettings 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。',
    },
    verification: [
      'test/unit/addonHostSettingsApi.test.ts',
      'test/unit/addonHostSettingsSdk.test.ts',
      'test/unit/addonRegistry.test.ts',
      'test/browser/addonHostSettings.mjs',
    ],
    introduced: '#457',
  },
  {
    id: 'ref-views-popup',
    group: 'page-sdk',
    title: '只读引用浮窗请求（refViews）',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonRefViews.ts',
        symbols: ['AddonRefAnchor', 'AddonRefTargetSpec', 'AddonRefPopupRequest', 'AddonRefPopupHandle', 'AddonRefPopupRejection', 'AddonRefPopupOutcome', 'AddonSdkRefViewsFacet', 'isAddonRefTargetSpec', 'buildAddonRefHoverTarget'],
      },
    ],
    purpose:
      '组件请求内核只读引用浮窗（T05 #544，规格 addon-reference-views.md）：在触发文字或自有控件旁打开目标引用浮窗，获取本次请求的关闭句柄。宿主复用 hoverDocAccess/refContent 的来源、准入、读取、租约与刷新链——组件不重新实现内容渲染，也不因请求呈现取得写目标文档的能力。',
    semantics: {
      modes: '仅编辑器页提供（设置页为 undefined）。缺省鼠标语义（零抢焦点、移出延迟关闭、单页单浮窗经 popupMutex 仲裁）；keyboard:true 显式键盘请求复用既有键盘浮窗路径（焦点进入可操作域，Esc 关闭后归还原有效焦点）。不经悬停总开关（#298 门控的是鼠标悬停触发规则——显式请求面不改写它）。',
      coordinates: '目标 = 根内路径 + 可选互斥锚点（heading 标题原文 / block 块 ID / line 1-based 行号 / range 1-based 闭区间行范围）。结构化目标在平台侧合成双链目标原文（buildAddonRefHoverTarget），走既有三形态解析——Markdown 用全文/标题/块语义（line/range 锚点按标题原文解析，缺失即真实失败，不引入 fragment 新语法）；非 Markdown 文本走 refText 的 #line=/#range= 与 REF_TEXT_LIMITS 准入。来源实例（views 面 ID：main/embed/hover）决定解析语境——B 中的相对路径按 B 目录，不误用父文档 A（请求带 addonSource，宿主校验成员资格为本面板文档或已送达目标，不接受任意 URI）。',
      lifecycle: '单页单浮窗：新请求替换旧请求，旧句柄随之失效（close 返回 false，不误关后来的浮窗）；迟到回包经 reqId/instanceId 配对守卫丢弃。句柄 close/isActive 只认本请求的浮窗实例身份。触发位置脱树、Esc、既有关闭动作、组件停用/故障/代次释放、页面结束均释放实例；pending 请求以 view-disposed 终结。所创建实例及递归内容恒只读（复用错误视图、刷新与释放链；T06 组件容器嵌入复用同一目标访问与来源语义）。',
      errors: '普通拒绝与真实失败分开：invalid-request（形状/触发位置非法——不创建空浮窗）/ view-disposed（来源实例不在场或请求被关闭）/ released（组件代次终结）/ HoverPreviewFailReason 透传（not-found / escape 越界 / anchor-invalid / anchor-missing / file-too-large / budget 等——浮窗同时以现有错误分态就地显示真实原因）。目标失败不折叠为 not-found。',
    },
    verification: [
      'test/unit/addonRefViews.test.ts',
      'test/unit/addonRefViewsRuntime.test.ts',
      'test/unit/addonRefViewsPopup.test.ts',
      'test/unit/embedRecursiveLive.test.ts',
      'test/unit/documentSessionRefViews.test.ts',
      'test/unit/addonPageLoader.test.ts',
      'test/browser/addonRefViews.mjs',
      'test/integration/suite/addonRefViewsCases.ts',
    ],
    introduced: '#544（T05）',
  },
  {
    id: 'ref-views-embed',
    group: 'page-sdk',
    title: '只读引用组件容器嵌入（refViews.mountEmbed）',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonRefViews.ts',
        symbols: ['AddonRefEmbedRequest', 'AddonRefEmbedHandle', 'AddonRefEmbedRejection', 'AddonRefEmbedOutcome', 'isAddonRefEmbedRequest'],
      },
    ],
    purpose:
      '组件在自有容器挂载内核只读引用子根（T06 #545，规格 addon-reference-views.md §6）：sdk.refViews.mountEmbed 把内核引用卡片（与正文 ![[…]] 嵌入同款装配）挂进本组件已取得的面板内容根或渲染内容根（可为其后代），复用成熟的内容展示与既有目标访问链（来源解析/只读能力/预算/订阅/释放），不重新实现渲染，也不因请求呈现取得写目标文档的能力。本请求零正文写入、零撤销项——插入 ![[…]] 仍由既有编辑 API 显式执行。',
    semantics: {
      modes: '仅编辑器页提供（设置页为 undefined）。容器须为本组件已取得的面板内容根（ui.registerPanel 的内容根）或渲染内容根（renderers.register 生效容器的后代）——正文根、其他组件容器与平台管理的引用子根内容一律 invalid-request（不建子根，不猜测位置）。内核卡片观感与正文嵌入同源（引用竖条/限高同规则），呈现在组件容器内不接管正文与其他组件容器。',
      coordinates: '目标与来源语义和 requestPopup 完全同源（同一目标合成器与 addonSource 来源覆盖——R-U02 的 B 目录解析、行号/范围/大小准入沿既有规则）。多处同目标挂载共享解析缓存（读取数据层），但每次挂载有独立 occurrence——实例、滚动与属性展示状态互不共享，一处释放不销毁其他同目标挂载。',
      lifecycle: 'promise 在首次读取结局落定时兑现：内容装载成功 → ok + 释放句柄；目标解析/读取/锚点/准入失败 → 失败原因（子根留在场以既有错误分态就地显示，随组释放）。释放触发整组（句柄 release、容器/外层面板/渲染根卸载或脱树、组件停用/故障/代次终结、页面结束）：订阅 unwatch、预算与内容实例彻底终结，pending 以 view-disposed 终结，迟到回包不重挂不复活缓存。重复挂载同一容器（含错误分态挂载）→ duplicate-mount，先释放旧实例才可重挂。目标更新沿既有 watch 通道静默刷新；删除/失效按现有引用视图分态就地显示（R-U11），失效不生成新写会话。所创建引用树及递归内容恒只读（readOnly 逐层传递——模式切换/保存/编辑入口不出现或不生效，不能借父 Live 或历史模式获得写端口）。',
      errors: '自有拒绝与浮窗同族另加容器占位冲突：invalid-request（形状/容器脱树或非本组件所有/容器在引用子根内）/ view-disposed（来源实例不在场、页面会话缺失，或结局落定前挂载被释放）/ duplicate-mount（容器已被有效挂载占用）/ released（组件代次终结）；HoverPreviewFailReason 透传（not-found / anchor-invalid / file-too-large / budget 等——真实原因就地显示，不折叠为 not-found）。',
    },
    verification: [
      'test/unit/addonRefViews.test.ts',
      'test/unit/addonRefViewsEmbed.test.ts',
      'test/unit/addonRefViewsEmbedCard.test.ts',
      'test/unit/embedCardCssContract.test.ts',
      'test/unit/addonPageLoader.test.ts',
      'test/browser/addonRefViewsEmbed.mjs',
      'test/integration/suite/addonRefViewsCases.ts',
    ],
    introduced: '#545（T06）',
  },
  {
    id: 'theme-environment',
    group: 'page-sdk',
    title: '主题环境快照与订阅（themeEnvironment）',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonThemes.ts',
        symbols: [
          'AddonThemeEnvironment',
          'AddonThemeEnvironmentKind',
          'AddonThemeEnvironmentFacet',
          'addonThemeEnvironmentOf',
          'addonThemeEnvironmentEqual',
          'isAddonThemeEnvironmentPayload',
        ],
      },
    ],
    purpose:
      '编辑器页 SDK 的只读主题环境面（sdk.themeEnvironment，#546/H-U06–U07）：读取 VSCode 实际生效主题的明暗快照并订阅变化——主题组件据此更新已挂载图形。不扩充为任意 VSCode configuration 读取（白名单语义与 hostSettings 同边界）。',
    semantics: {
      modes: '仅编辑器页提供（设置页为 undefined）；不按视图模式门控（环境与 live/reading 无关）。',
      lifecycle: '快照是四态两轴投影（dark / highContrast——亮色高对比不为暗）；数据源为宿主 vscode.window.activeColorTheme 事件推送（手动固定暗色而系统变亮仍为暗；跟随系统时随系统变化）。通知在页面缓存更新后送达（回调中 get 拿到相同新状态）；重复值不重复广播（等值跳过）；代次释放自动退订（不依赖组件自觉）。组件在回调中更新已挂载文档图形，旧异步渲染结果由现有挂载代次拒收。',
      errors: '查询无拒绝码（同步返回快照；宿主推送未达时为初始播种值）。本面不提供任何写入成员；订阅回调抛错按既有可归因异常上报组件故障，不静默吞掉。',
    },
    verification: ['test/unit/addonThemeEnvironment.test.ts', 'test/unit/addonPageLoader.test.ts', 'test/browser/addonThemes.mjs'],
    introduced: '#546（T07）',
  },
  {
    id: 'channel',
    group: 'page-sdk',
    title: '页面与宿主通道',
    layer: 'stable-candidate',
    endpoints: ['host', 'editor-page', 'settings-page'],
    signatures: [
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['AddonChannelOutcome'],
      },
      {
        module: 'src/host/addons/addonRegistry.ts',
        symbols: ['AddonChannelRegistry', 'AddonChannelHandler'],
      },
    ],
    purpose:
      '组件宿主代码与自身页面之间的 JSON 请求/结果传递：页面侧 sdk.channel.request，宿主侧 channel.handle 注册 topic 处理器。载荷与结果必须是可序列化数据——不能把 DOM、函数或编辑器实例传过桥。',
    semantics: {
      lifecycle: 'topic 注册归所在的生命周期（setup 或 enable），停用即注销；同名 topic 重复注册拒绝。组件停用、故障或实例释放后，旧消息及异步完成不继续产生编辑写回或重新挂载。',
      errors: 'rejected = 宿主侧未注册 topic 或业务拒绝；timeout / released 由装载器本地终结（不依赖宿主存活）。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/browser/addonPageSdk.mjs'],
    introduced: '#351（T02）',
  },
  {
    id: 'addon-storage',
    group: 'settings',
    title: '组件数据目录与文件监听',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonStorage.ts',
        symbols: ['AddonStorageFacet', 'AddonStorageResult', 'AddonStorageListResult', 'AddonStorageEntryInfo', 'AddonStorageRejection', 'isSafeAddonStoragePath', 'ADDON_STORAGE_FILE_LIMIT_BYTES'],
      },
      {
        module: 'src/host/addons/addonStorageService.ts',
        symbols: ['AddonStorageService', 'AddonStorageFsPort'],
      },
    ],
    purpose:
      '每组件一个安装目录外的隔离可写数据目录（globalStorage 语义）与目录内文件监听：富结构数据（规则对象等，超出设置存储一层嵌套边界）自由读写，外部同步工具改写文件后自动重载。宿主侧 setup/enable 上下文同形状；页面侧组件经自己的 channel topic 桥接宿主读写。',
    semantics: {
      modes: '仅宿主端（编辑器/设置页面不直接提供——经组件通道桥接）。',
      coordinates: '相对路径为正斜杠形态，先过 isSafeAddonStoragePath 守卫（越界/非法一律 invalid-path 拒绝——普通 API 拒绝不算故障）；文件内容按 UTF-8 文本读写。',
      lifecycle: '目录 = <vsidian globalStorage>/addons/<addonId>（按需创建；list 对不存在目录（含根目录未建）返回空清单——未建目录 = 空存储，#461）；停用/故障/组件扩展卸载不删数据（随 Vsidian 本体卸载整体清除，重装组件数据仍在）；watcher 惰性创建、多订阅共享，组件停用/故障/代次终结时平台统一注销；onDidChangeFile 回调回 (相对路径, change|delete)，change 含改写与新建。',
      errors: 'invalid-path（越界/非法相对路径）/ too-large（单文件超 ADDON_STORAGE_FILE_LIMIT_BYTES 8MB）/ error（IO 失败，detail 归因；list 的目标目录不存在不属 error——返回空清单，#461）——可辨认拒绝，不抛出。',
    },
    verification: ['test/unit/addonStorage.test.ts'],
    introduced: '#404',
  },
  // ---- ③ 输入行为 ----
  {
    id: 'behaviors-register',
    group: 'behaviors',
    title: '输入行为注册与观察',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonBehaviors.ts',
        symbols: ['AddonBehaviorsFacet', 'AddonBehaviorRegistration', 'AddonBehaviorName', 'resolveAddonBehaviorName', 'AddonInputContext', 'AddonReplacedRange', 'AddonBehaviorInputPlan', 'AddonBehaviorChangeEvent', 'AddonBehaviorRegisterResult'],
      },
    ],
    purpose:
      '注册可组合输入行为：稳定局部 ID + 必填名称（单语言字符串或多语言映射，映射按页面语言渲染）+ 可选说明/例子/独占组 + 业务回调。onChanged 为只读观察（通知与修饰分别注册——不是原输入链的第二写入口）。',
    semantics: {
      modes: '合法可编辑 Live 实例（内核先执行只读、IME 组合中间态、表格网格与既有情境门控；IME 组合定稿（composition commit）驱动一次——userEvent input.type.compose、inputText 为净定稿文本，#399；删除事务白名单 backward/forward/selection/cut/line 驱动（dedent 属缩进命令族不纳入），#400；IME 定稿路径的内置补全/包裹重建事务不驱动（#595）——compositionend 后微任务派发的配对补全与选区包裹重建携带内置来源标记，IME 定稿符号对只驱动一次（#593 补驱动的干净形态），该路径的展开/闭合形态不作为二次驱动外泄；键入路径与 IME 定稿路径归一为只以原始输入驱动（#597）——真实键入符号字符的补全/包裹不再经输入改写为展开形态，恰驱动一次、inputText 为原始键入字符（如 ( ）、replaced 为被替换选区，内置补全/包裹退为微任务兜底（携带内置来源标记，不驱动），两路径驱动次数与载荷形态同构（此前键入路径 inputText 为展开形态如 ()，#411 起过渡行为，#597 归一废止）；例外（表格空白行规范化接管域）：键入命中表格空白行首笔规范化（blankRowInputPlan）时维持 #597 前的原子改写（open+close 成对插入、经规范化整行重建），该场景 inputText 为规范化整行载荷（如 | | | ()|）而非原始单字符——归一的完整统一转 #600，不在本票扩面；上述键入路径各句除本例外场景外均适用；符号对优先序两路径同为行为链先、内置兜底：修饰先改写区间即生效，内置包裹遇改写让位，无适用修饰时内置全角包裹照常落地）。',
      coordinates: '修饰计划相对 context.snapshot（LF 坐标）；后续行为读取前序行为的修饰结果。上下文与观察事件携带 docUri（目标文档 URI，与 views 句柄 targetDocUri 同源：main = 面板文档，embed = 引用目标——在引用 B 内触发时是 B 的 URI，#407）与 replaced（事务替换/删除侧：键入替换选区 = 被替换内容（#401），delete = 被删文本（#400），事务前 LF 坐标；IME 定稿经组合期净变更推导（#593）——起点坐标系被组合覆盖的文本，纯插入与迟入组合为 null）。',
      lifecycle: '行为能力与适用条件只由代码表达（不复制进清单）；每次修饰按自己的原子声明提交，提交与身份注入由平台完成（行为不能直接写文档）。',
      errors: '注册拒绝：invalid-registration / duplicate-id / not-editor-page / released（名称缺失或形态非法拒绝、说明/例子缺失允许）。',
      history: '文本变化不终止链（默认可组合）；确需择一的用显式独占组（同组件命名空间内互斥，跨组件不互斥）——不恢复统一「先接管者生效」。',
      localization: 'name 为多语言映射时键规整 trim+小写（推荐小写 BCP47 连字符形，如 zh-cn/en）；候选链 zh-cn → zh → en（zh 开头页面语言折算，对齐 resolveLocale），非 zh 页面只试 en；全部候选缺失取规整字典序最小键的值（非空呈现、确定性）；映射全链路透传不预解析，语言切换后已注册名跟随（渲染时经 resolveAddonBehaviorName 选值，#464）。纯字符串单语言不随语言切换（历史兼容）。映射条目上限 32、键规整后 ≤64 字符、值同单语言口径（trim 非空 ≤256）；规整后键重复拒绝（zh 与 ZH 共存歧义）。',
    },
    verification: ['test/unit/addonBehaviors.test.ts', 'test/unit/addonBehaviorRuntime.test.ts', 'test/integration/suite/addonT07Cases.ts', 'test/browser/addonT07Behaviors.mjs'],
    introduced: '#356（T07）',
  },
  {
    id: 'behavior-order-state',
    group: 'behaviors',
    title: '行为顺序与逐项开关持久',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonBehaviors.ts',
        symbols: ['addonBehaviorFullKey', 'AddonBehaviorStateStore', 'resolveAddonBehaviorOrder', 'orderedAddonBehaviorKeys', 'mergeBehaviorOrderPreservingUnknown'],
      },
    ],
    purpose:
      '行为的持久身份 = 组件 ID + 局部 ID（不以显示名为存储键——改名/本地化不丢配置）；用户排序保留相对次序，新项按默认序（完整键字典序）追加，逐项关闭保留存储。',
    semantics: {
      lifecycle: '单层 user 持久（不做工作区层）；未知项（已卸载组件）保留存储、不剔除——展示状态而不重新打开用户已关闭的项；调序落库把不可见键锚定回原相对位。',
    },
    verification: ['test/unit/addonBehaviorStateService.test.ts', 'test/integration/suite/addonT08Cases.ts', 'test/browser/addonT08BehaviorsManage.mjs'],
    introduced: '#357（T08）',
  },
  {
    id: 'behavior-enabled-state',
    group: 'behaviors',
    title: '行为禁用态只读可见面',
    layer: 'stable-candidate',
    endpoints: ['editor-page', 'settings-page'],
    signatures: [
      {
        module: 'src/shared/addonBehaviors.ts',
        symbols: ['AddonBehaviorStateFacet', 'AddonBehaviorEnabledState', 'AddonBehaviorRunState', 'behaviorDisabledLocalIds'],
      },
    ],
    purpose:
      'SDK behaviorState 面（独立于 behaviors 面，编辑器页与设置页均提供）：enabledState() 立即返回本组件行为启用快照（组件运行态 + 本组件被禁行为局部 id 集），onEnabledChange(cb) 订阅变化（返回退订）。只读——无任何写入宿主状态的成员（两层开关语义的平台侧答案：宿主层只报事实，写入归宿主行为管理）。',
    semantics: {
      modes: '无编辑模式门槛：灰态消费在设置页与编辑器页同样可达。',
      coordinates: 'disabled 为本组件行为的局部 id 集（存储完整键按组件 ID 前缀过滤后剥离；顺序保持存储序，不去重不排序）——组件自知 addonId，接口按「本组件」过滤天然隔离。',
      lifecycle: '快照两层报事实：addonRunState（enabled / user-disabled）+ disabled。组件被用户停用后设置页不卸载，本面仍可查询与订阅（灰态消费场景）；faulted 不进快照（故障时设置页不装载，语义不可达）。通知在宿主状态落库后即时发出（单项禁用/恢复与组件启停）。查询不做代次守卫：已释放代次的迟到调用返回最后已知快照（只读无副作用）；订阅过装载器记录身份判活（与全部 SDK 面同款）——迟到登记为 no-op 退订，释放时点已有的订阅随组件释放整组回收（不依赖组件自觉退订——与 behaviors/commands/renderers/ui 四面的整组件回收同款）。',
      errors: '本面无拒绝码：只读查询恒返回快照（广播未到达时为默认态 enabled + 空集），订阅回调异常只吞不升级。',
    },
    verification: ['test/unit/addonBehaviorEnabledState.test.ts', 'test/unit/addonPageLoader.test.ts', 'test/integration/suite/addonBehaviorStateCases.ts'],
    introduced: '#476',
  },
  // ---- ④ 设置 ----
  {
    id: 'settings-context',
    group: 'settings',
    title: '宿主设置能力面（setup 上下文）',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/host/addons/addonRegistry.ts',
        symbols: ['AddonSettingsContextApi', 'AddonSettingsGetSnapshot', 'AddonSettingsChangeEventData'],
      },
    ],
    purpose:
      'setup 生命周期常驻的设置能力：registerPage 登记自己的设置页入口、registerDefinitions 收集可序列化定义（#472 起第二参可选组声明批——声明序即呈现序，定义 group 字段引用组键）、get / getSource 读生效值与来源（#590 起 get 快照另附两层显式值 userValues / workspaceValues，供组件按作用域层呈现）、update 按批写入指定层、clearWorkspaceOverride 清除工作区覆盖、onChanged 订阅成功保存后的变化。',
    semantics: {
      lifecycle: '普通停用后保留（已停用组件仍可配置）；故障暂停时回收组件代码——平台保留已取得的定义与值，用基础控件供修正参数后手动重试。新 setup 代次重跑时定义集与组声明一并清换。',
      errors: '按批校验并保存，失败不虚报成功；变化事件只在持久化成功后发出。clearWorkspaceOverride 恢复继承用户默认，不是恢复出厂默认。#472 组批校验：组键重复或定义引用未声明组键整批拒绝（归因 invalid-definitions）。',
      coordinates: '#590 get 快照可选成员 userValues / workspaceValues（数据形状）：各层只含显式保存过的键（含定义外遗留键——存储原样不删）；workspaceValues 为 null 表无工作区。values/sources 合并口径不变，生效值不从层值推导。',
    },
    verification: ['test/unit/addonRuntimeSettings.test.ts', 'test/integration/suite/addonT04Cases.ts', 'test/browser/addonSettings.mjs'],
    introduced: '#351（T02 页面入口）、#353（T04 读写）、#472（分组声明）、#590（两层显式值）',
  },
  {
    id: 'settings-definitions',
    group: 'settings',
    title: '可序列化设置定义与值校验',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonSettings.ts',
        symbols: ['AddonSettingDefinition', 'AddonSettingValue', 'AddonScalarItemSpec', 'AddonLocalizedText', 'AddonSettingGroup', 'AddonSettingSearchEntry', 'AddonSettingsSearchIndex', 'isAddonSettingDefinition', 'isAddonSettingGroupDeclaration', 'isAddonSettingSearchEntry', 'addonSettingValueMatches'],
      },
    ],
    purpose:
      '设置定义可序列化：标量（boolean/number/string）、数组（重复项）与对象（字段表）一层结构；有限数、长度、枚举约束由定义描述——不存在函数校验器形态。string 定义可声明呈现层形态：enumLabels 枚举档位标签（直值或多语言映射）与 multiline 多行文本（#473/#475）。#472 分组（引用式）：定义可选 group 字段引用组键，组元数据（title/description 为 AddonLocalizedText）经注册载荷声明一次、声明序即呈现序；组键组件内唯一、引用未声明组键整批拒绝。',
    semantics: {
      errors: '定义升级后存量漂移：显式值非法视为该层未设置（跳过继续下层，不从存储删除——定义回退后自动恢复生效）。数组/对象一层硬边界：项与字段必须是标量。#472 组批校验：组声明形状非法或键重复、定义引用未声明组键——整批拒绝。',
      presentation: 'enumLabels 与 multiline 仅作用设置页呈现（#473/#475）：标签缺失回退渲染枚举值本身，标签选值随页面语言切换；multiline 渲染 textarea、换行符参与持久化值；持久化值与值校验口径不变。数组 string 自由文本项支持批量粘贴拆分（逐行 trim、去空行、maxLength 截断，enum/number/boolean 项不适用）。#472 分组呈现：组标题按当前语言选值、组容器按声明序，未分组定义与功能开关行恒居首容器；组声明随 addons.settingsState 既有链路透传；定义级与组级条目进全局搜索（object 字段级不进），定位键 addon:<组件 ID>/def:<定义键> 与 addon:<组件 ID>/group:<组键>。',
    },
    verification: ['test/unit/addonSettings.test.ts', 'test/unit/addonSettingsArea.test.ts', 'test/unit/addonSettingsService.test.ts'],
    introduced: '#353（T04）、#473/#475（呈现形态）、#472（分组）',
  },
  {
    id: 'settings-scope',
    group: 'settings',
    title: '作用范围解析与存储',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonSettings.ts',
        symbols: ['AddonSettingSource', 'resolveAddonSettingLayer', 'AddonSettingsStoreV1', 'serializeAddonSettingsStore', 'parseAddonSettingsStore'],
      },
    ],
    purpose:
      '生效值解析：工作区显式 > 用户默认显式 > 出厂默认；两层存储同构（globalState / workspaceState），结构 version 1 冻结。',
    semantics: {
      lifecycle: '解析 fail-safe：version 未知或形态不符整层回 null（宁回默认值，不写回、不删除用户数据）；跨窗口不做实时推送，读取以新构造对账（1.82.3 Memento 无变更事件）。',
    },
    verification: ['test/unit/addonSettings.test.ts', 'test/unit/addonSettingsService.test.ts'],
    introduced: '#353（T04）',
  },
  // ---- ⑤ 渲染提供者 ----
  {
    id: 'renderers-register',
    group: 'renderers',
    title: '渲染提供者注册',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonRenderers.ts',
        symbols: ['AddonRenderersFacet', 'AddonRendererRegistration', 'AddonRendererProviderInfo', 'AddonRendererMountContext', 'AddonRendererCandidate'],
      },
    ],
    purpose:
      '为一个或多个代码块语言提供渲染候选（可替代内置，含 Mermaid）：可序列化声明上报宿主参与确定性选择，mount/refresh/release 回调留本页执行；可选登记图形导出（exportSvg——弹窗与导出链路共用）。',
    semantics: {
      modes: 'live / reading 非空子集；组件未支持的模式不会收到调用（模式资格筛选在挂载之前完成）。',
      lifecycle: '生效表广播回来后才承担挂载（顺序由宿主决定，不靠脚本装载竞速）；接管切换、容器退场、停用或故障时 release（重复无害）；平台保证容器不跨生效代次复用——旧代次容器退场即与组件代码无关。',
      errors: '声明非法或代次已终结时拒绝（返回 no-op 句柄，不构成组件故障）。',
    },
    verification: ['test/unit/addonRenderers.test.ts', 'test/unit/addonRenderersWeb.test.ts', 'test/integration/suite/addonT09Cases.ts'],
    introduced: '#358（T09）',
  },
  {
    id: 'renderer-selection',
    group: 'renderers',
    title: '确定性选择、自动接管与首选恢复',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonRenderers.ts',
        symbols: ['BUILTIN_RENDERER_PROVIDER_ID', 'RendererSelectionInput', 'RendererThemeSelectionContext', 'AddonRendererLanguageSelection', 'selectEffectiveRenderers', 'assignDiscoveryBatches', 'AddonRendererStoreV1'],
      },
    ],
    purpose:
      '选择单位是提供者、挂载单位是某视图中的某个代码块。默认序按（发现批次升序, providerId 升序）取末位生效（内置视作批次 0）；用户显式首选优先且不可用时按默认序回退（首选记录不清除）。#546 起主题关联提供者例外：不参与默认序与按语言首选，仅主题单选选中且可用时对其声明语言生效（RendererThemeSelectionContext 注入）。',
    semantics: {
      autoRules: '新安装、兼容且已启用组件成功接入后自动替换所支持语言的现有显示（含内置）——不要求用户先选择渲染器；重启、重复注册与普通升级不当作新安装（批次一经记录不改写）。用户正常停用或整组件故障降级停用后内置接管（无图形内置则普通代码块，首选保留）；组件仍运行而渲染有 bug 时不自动接管、不承诺识别或修复；手动恢复成功后按原选择显示，旧异步结果不得重新挂载。主题例外（#546/ADR-0017）：主题关联提供者不走自动接管（安装只新增候选不切换），不能经按语言显式首选绕过主题单选；仅当前选中主题的提供者（activeThemeProviderId）对其声明语言生效（source=user），不可用时回默认序且主题首选保留、内置 default 承接显示。',
    },
    verification: ['test/unit/addonRendererTakeover.test.ts', 'test/unit/addonRendererService.test.ts', 'test/unit/addonRenderers.test.ts', 'test/browser/addonRendererTakeover.mjs'],
    introduced: '#358（T09）、#546（T07 主题例外）',
  },
  {
    id: 'themes-register',
    group: 'renderers',
    title: '主题目录登记与唯一选择',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonThemes.ts',
        symbols: [
          'AddonThemeDeclaration',
          'AddonThemeCandidate',
          'AddonThemesRegistrationFacet',
          'AddonThemeRegisterOutcome',
          'addonThemeRefOf',
          'validateAddonThemeBatch',
          'CODEX_THEME_ID',
          'resolveThemePreferred',
          'resolveActiveTheme',
          'AddonThemesStatePayload',
        ],
      },
      {
        module: 'src/host/addons/addonRegistry.ts',
        symbols: ['AddonEnableContext'],
      },
    ],
    purpose:
      '组件在 enable 生命周期经 context.themes.register 登记主题元数据（稳定身份 + 多语言名 + 本组件提供者关联）——宿主目录不依赖打开编辑器页面；主题目录与唯一首选驱动设置页「主题」页签单选与渲染生效。#546（T07）首版候选；#535（T08）内核 Codex 退役：无老用户存量、不做激活迁移与引导（2026-10-17 用户裁决），Codex 改由附加组件提供。',
    semantics: {
      lifecycle: 'enable 注册按 addonId 整组替换（空批 = 撤销）；停用/故障/注销/卸载与代次终结回收目录，主题首选保留（恢复后按原选择继续）。目录不持久化（元数据由组件代码每次接入注册）；用户唯一首选持久化在宿主设置键 appearance.theme（resolveThemePreferred：新键权威、空值兜底 default），值域 default | <addonId>/<themeId>。#535 后旧键 appearance.mermaidTheme 不再参与解析（定义删除、快照不含）；存量 codex 不做激活迁移（2026-10-17 用户裁决：无老用户存量）——按未知首选走目录不命中回落 default 显示且首选保留。v1.1.0 兼容形状保留：resolveThemePreferred 双参调用仍编译通过（第二参 legacyMermaidValue 已退役、传任何值含 codex 均不再影响结果，deprecated——语义收窄即迁移语义本身）；CODEX_THEME_ID 常量恢复为 deprecated 兼容导出（值恒 codex，不再是内置身份，作未知首选走目录不命中回落）。',
      errors: '登记校验与批内重复拒绝属普通 API 结果（invalid-theme / duplicate-theme 整批拒绝，不算组件故障）：任一条目形状非法或同批 themeId 重复均拒绝；同组件不同主题可支持同一语言，由唯一主题首选选择。',
      autoRules: '主题关联提供者不走一般渲染候选的自动接管（ADR-0017 例外）——目录命中但页面 renderers 候选未上报（页面未装载）时主题提供者不生效；选中主题不可用（组件停用/故障/未注册）时回落内置 default 显示（不用其他主题顶替），保留首选并回显不可用/回落状态。',
      localization: 'label 为多语言映射时按页面语言渲染（resolveLocalizedText 候选链 zh-cn → zh → en → 规整字典序最小键兜底）；同名主题按来源徽章区分（组件显示名）。',
    },
    verification: ['test/unit/addonThemes.test.ts', 'test/unit/addonThemeService.test.ts', 'test/unit/addonRuntime.test.ts', 'test/browser/addonThemes.mjs', 'test/integration/suite/addonThemeCases.ts'],
    introduced: '#546（T07）',
  },
  // ---- ⑥ 命令/菜单/界面 ----
  {
    id: 'commands-register',
    group: 'commands-menus-ui',
    title: '命令注册与统一快捷键',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonCommands.ts',
        symbols: ['AddonCommandDefinition', 'AddonCommandRegisterResult', 'AddonCommandReport', 'AddonLocalIdProblem', 'AddonDefaultBindingsProblem'],
      },
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['AddonSdkCommandsFacet'],
      },
    ],
    purpose:
      '新增自己的可绑定命令（title 自由文本，不进 Vsidian 内置字典）：进入统一快捷键管理（冲突检查/绑定/显式清空/恢复默认）与宿主命令面板；执行链三入口（快捷键路由、宿主命令面板、菜单项点击）共用组件回调。#427 起回调携带目标视图句柄（AddonViewHandle | null）——平台在执行时刻解析当前活动视图（焦点嵌入内部 Live → 该实例，否则主正文；无活动视图 null），组件无需自建焦点探针防御链。',
    semantics: {
      modes: 'live / reading / both 由代码声明；写操作快捷键仅在 Live 正文接管宿主绑定——源码模式与设置页输入不接管（沿键位注册表 writes 门控）。',
      lifecycle: '命名空间 ID 由平台注入（<组件 ID>.<局部 ID>）；局部 ID 禁点号（含点即伪造跨组件/内置身份）。停用/故障/代次释放整组件回收注册——不影响内置命令，不清用户键位。',
      errors: 'duplicate-command、tab-forbidden（#125 Tab 固定链——「围栏越界 → 表格导航 → 行缩进」优先级不可绕；#427 收窄为裸 Tab 与 Shift+Tab 段，ctrl/alt/meta+Tab 放行——宿主/OS 占用组合不保证事件可达）、too-many（#450 默认绑定条数封顶 4，按原始数组长度计数）、非法 chord 等明确拒绝码；普通 API 拒绝不算故障。',
    },
    verification: ['test/unit/addonCommands.test.ts', 'test/unit/addonCommandService.test.ts', 'test/integration/suite/addonT10Cases.ts', 'test/browser/addonT10Commands.mjs'],
    introduced: '#359（T10）',
  },
  {
    id: 'menus-register',
    group: 'commands-menus-ui',
    title: '菜单项注册',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonCommands.ts',
        symbols: ['AddonMenuItemDefinition', 'addonMenuItemProblem'],
      },
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['AddonSdkMenusFacet'],
      },
    ],
    purpose:
      '向统一右键菜单新增自己的菜单项：组件簇（addon.<组件 ID>）追加在内置三簇之后；label 自由文本，iconKey 须已在平台图标 key 表登记（组件不能注入新图标资产）。',
    semantics: {
      modes: 'when / enable 谓词输入为打开菜单时采集的结构化快照（MenuContextSnapshot）；结构敏感区置灰的安全降级矩阵由组件自行声明。',
      contextPayloads:
        '快照自 #436 起含三类可选场景命中负载，谓词可直接消费：table（表格网格坐标——内容行/列索引、行列总数、表格行区间、引用层级一致性；仅 zone=table 且解析树接管该表时在场，残缺表缺省）、link（链接族类 wikilink/link/autolink/loose + 目标原文 + 显示文字 + 源区间；仅 zone=normal 且命中时在场，嵌入 ![[…]] 与代码上下文/头区不采集）、graphic（图形块围栏行区间/语言/源码/svg 取图能力 + #438 起的渲染成功探针 rendered〔错误降级 false，探针不可得缺省〕；仅 zone=graphic 时在场）。负载只在对应 zone 出现——结构敏感区不采链接与安全降级矩阵对齐。',
      errors: 'label 空、icon-key 未登记、command 局部 ID 非法等明确拒绝。不提供覆写/隐藏/接管内置菜单项的任何入口（ADR-0012 菜单边界；结构性免疫：局部 ID 禁点号，传入的 id 不可能成为内置或另一组件的身份）。',
    },
    verification: ['test/unit/addonCommands.test.ts', 'test/integration/suite/addonT10Cases.ts', 'test/browser/addonT10Commands.mjs'],
    introduced: '#359（T10）',
  },
  {
    id: 'ui-buttons-panels',
    group: 'commands-menus-ui',
    title: '工具栏按钮与面板',
    layer: 'stable-candidate',
    endpoints: ['editor-page'],
    signatures: [
      {
        module: 'src/shared/addonUi.ts',
        symbols: ['ADDON_UI_BUTTON_SLOTS', 'AddonUiButtonDefinition', 'AddonUiPanelDefinition', 'AddonUiTargetGetter'],
      },
      {
        module: 'src/shared/addonPage.ts',
        symbols: ['AddonSdkUiFacet'],
      },
    ],
    purpose:
      '往平台预定义挂载点新增自己的界面元素：按钮唯一合法槽是工具栏左组尾部容器，面板唯一宿主是主编辑区尾部 dock（面板 chrome 与 dock 样式归平台，内容根内部样式归组件）。按钮动作二选一：挂接已注册命令（点击经命令体系执行、键位徽章取生效绑定）或自带回调。',
    semantics: {
      modes: '缺省 both；不匹配模式的按钮撤下（注册保留、切回重挂），不符面板强制关闭（不自动复活）。',
      lifecycle: '面板关闭（用户或组件 close）即容器移除、内容根脱挂——迟到结果结构上不可见；mount 异常回收并移除注册（不留半装配）；onClick/unmount 异常吞掉留痕（运行期回调异常不升级为全组件故障）；停用/故障/代次释放整组件回收。',
      errors: 'duplicate-button / duplicate-panel、slot-unknown（槽位白名单外——内置界面/侧栏/设置框架不可挂）、action-conflict / action-missing（动作二选一）、局部 ID 含点等明确拒绝。',
      autoRules: 'onClick 与面板 target 由平台注入当前活动视图句柄（焦点所在嵌入内部 Live → B，否则主正文 A——T06 句柄语义，操作归当前目标文档）。',
    },
    verification: ['test/unit/addonUi.test.ts', 'test/unit/addonUiRuntime.test.ts', 'test/integration/suite/addonT11Cases.ts', 'test/browser/addonT11Ui.mjs'],
    introduced: '#360（T11）',
  },
  // ---- ⑦ 粘贴转换 ----
  {
    id: 'paste-rules-register',
    group: 'paste-conversion',
    title: '声明式粘贴规则注册（enable 生命周期）',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [
      {
        module: 'src/shared/addonPasteRules.ts',
        symbols: [
          'AddonPasteRuleDeclaration',
          'AddonPasteRuleMatch',
          'AddonPasteRuleOutput',
          'AddonPasteSlot',
          'AddonPasteSlotSource',
          'AddonPasteRegex',
          'AddonPastePredicate',
          'AddonPasteCondition',
          'AddonPasteConditionNode',
          'AddonPasteNestedRule',
          'AddonPasteRulesRegisterResult',
          'AddonPasteRulesSnapshot',
          'ADDON_PASTE_RULES_MAX_PER_ADDON',
          'ADDON_PASTE_RULES_MAX_DEPTH',
          'ADDON_PASTE_RULES_EVAL_STEP_BUDGET',
          'ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT',
          'ADDON_PASTE_RULES_REGEX_INPUT_LIMIT',
          'ADDON_PASTE_RULES_CONDITION_NODES_LIMIT',
          'addonPasteRegexGroupInfo',
          'validateAddonPasteRuleDeclarations',
          'orderAddonPasteRules',
        ],
      },
      {
        module: 'src/host/addons/addonRegistry.ts',
        symbols: ['AddonPasteRulesContextApi'],
      },
    ],
    purpose:
      '组件在宿主运行生命周期（enable 上下文的 paste 面）登记可序列化粘贴转换规则：全部已打开与新打开的编辑器页面共用同一组有效规则，在富文本粘贴的 HTML→Markdown 遍历中消费——来源特化元素（如带私有属性的 span）可恢复为 Markdown 链接等结构，来源识别不进入内核。',
    semantics: {
      modes: '只作用于富文本粘贴链（HTML 载荷）；显式纯文本粘贴、代码/表格上下文与 plain 等值守卫不经规则。转换成功参与 hasFormatting 判定，最终结果与 plain 相同时仍走一次撤销路径。',
      coordinates:
        '规则语言为可序列化数据：匹配（标签名相等、属性条件全与——缺失与空串区分——＋可选条件树）＋取值槽（元素文本/指定属性/子内容转换结果/正则捕获组）＋模板产出（{{name}} 槽引用；字面部分是作者声明的静态 Markdown 结构不转义，文本/属性/捕获组槽按内置转义，URL 槽经既有 safeUrl 策略，children 槽不二次转义）或显式丢弃。正则为数据声明 pattern＋受限 flags（i/m/s/u，禁 g/y 有状态修饰符），注册时编译校验；捕获组取值支持整匹（组 0）/数字组/命名组，组引用越界或命名组缺失即拒绝。条件为 all/any/not 树（叶子：属性存在/相等、属性值正则、元素文本正则；空组合、非法节点与隐式真值形态拒绝）。嵌套转换在 children 槽声明子规则集（与顶层同一声明语言，ID 为槽内局部；子元素先子规则后内置，只沿子节点下降）。未知字段一律显式拒绝，不静默当成已声明形态。',
      lifecycle:
        '有效规则按优先级降序、组件稳定 ID 升序、规则稳定 ID 升序确定性执行（缺省优先级 0，顺序不取决于页面装载先后；children 子规则集递归同序）；对同一元素依次尝试、首条成功接管、单条失败继续、全部未成功回内置转换；内置 SCRIPT/STYLE 等忽略规则先行生效，组件规则不能复活已忽略节点；嵌套求值期间外层规则集不参与（不按规则 ID 回跳或再次转换自身）。停用、故障、单组释放与代次结束撤回相应规则并广播新快照（版本单调、内容等值不递增）；一次粘贴在使用开始时捕获快照，转换中不拼接两个注册代次，迟到旧版本快照不回退。预算集中定义：每组件至多 256 条规则声明（含嵌套子规则合计）、条件组合层级与规则嵌套层级各至多 16、单条规则条件树至多 64 节点、单次粘贴求值步数至多 100,000（规则尝试/条件节点/正则执行各计一步，超限停用规则、内置转换继续）。正则实现为运行环境原生 RegExp：同步、单次执行不可中断——步数预算计执行次数不是可中断超时；正则输入（元素文本/属性值）超过 4,096 字符按必需取值缺失处理（本规则失败，不截断不改写）。',
      errors: '四种可辨认拒绝：invalid-declaration（形状/未知操作/未知字段/非法正则——编译失败、flags 越集、组引用越界或命名组缺失——/空条件组合/条件或嵌套超深超节点数）/ duplicate-id / too-many / released（已终结代次的迟到注册）——普通 API 拒绝不算组件故障；整批拒绝不部分安装。',
    },
    verification: [
      'test/unit/addonPasteRules.test.ts',
      'test/unit/addonRuntimePasteRules.test.ts',
      'test/unit/htmlToMarkdownPasteRules.test.ts',
      'test/unit/richPasteAddonRules.test.ts',
      'test/browser/addonPasteRules.mjs',
      'test/browser/richPasteUndoHost.mjs',
      'test/integration/richPasteHostSuite.ts',
      'test/integration/addonFixtures/addon-paste-rules/extension.js',
    ],
    introduced: '#541（T01）；#542（T02 正则/条件/嵌套）',
  },
]

/** 发行台账（API 版本独立于 Vsidian 本体版本号；如实区分候选与已发布） */
export const ADDON_API_RELEASES: readonly AddonApiReleaseRecord[] = [
  {
    version: '1.0.0',
    status: 'candidate',
    summary:
      '首个候选稳定 API：首版六组能力面（发现与安装/页面 SDK/输入行为/设置/渲染提供者/命令菜单界面）已随 T01–T12 实施与消费样例收敛；候选期内追加粘贴转换组（#541 T01 基础链路起）与 2026-10 扩展批次（文档导航 #543、只读引用浮窗与嵌入 #544/#545、主题登记 #546、设置页上下文 #553）。候选 = 形状已冻结待发行，尚未对外发布——发行前不产生兼容承诺；升级为 released 须在真实发行时人工落账并填实际发布日期。',
    experimental: [
      {
        entry: 'cm6',
        version: '1.1.0',
        status: 'candidate',
        note: '页面共享 CM6 运行时（experimental.cm6）。1.1.0 = #406 起暴露面含 language 语法树子集（syntaxTree / ensureSyntaxTree / syntaxTreeAvailable——最小集合，注册类成员不纳入）。使用须在清单 experimental 声明 cm6 兼容范围且含本版本；组件不得重打包 CM6（构建桥拒绝值导入 + 产物静态标记双防线）。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。',
      },
      {
        entry: 'headingFold',
        version: '1.0.0',
        status: 'candidate',
        note: '页面 SDK 的标题折叠查询与命令（experimental.headingFold，#410）。1.0.0 首版候选：folds / foldable 查询（有效派生视图与可折叠全集，span 不含文本摘要）+ apply 五操作（选区驱动，编程触发与用户触发同链路）+ foldAt / unfoldAt 按区间键批量组合 + foldAll 可 upToLevel 参数化；Live-only（#419 翻案后维持：阅读视图消费同一折叠状态集呈现折叠，但折叠状态仍以 Live 编辑器 StateField 为单一事实源，阅读态交互走平台 UI 通道，API 拒绝面不变）。#426 起 folds 与 foldable 共享同一 doc 版本缓存（调用成本 O(标题数) 过滤，非全文档重扫），实例寻址可经 viewIdentity.instanceIdOf 反查。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。',
      },
      {
        entry: 'viewIdentity',
        version: '1.0.0',
        status: 'candidate',
        note: '视图身份反查面（experimental.viewIdentity，#426）。1.0.0 首版候选：instanceIdOf（CM6 EditorView → views 面实例 ID；未装配身份的 view 返回 null）——keymap/扩展回调拿到 view 后据此反查实例，headingFold 等按 ID 寻址的 API 不再依赖「扩展槽仅挂主正文 Live 实例」的装配范围推定。闭包实现无 this 依赖（解构裸传安全）。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。',
      },
      {
        entry: 'syntax',
        version: '1.0.0',
        status: 'candidate',
        note: '行类型与行内标记查询面（experimental.syntax，#433，#408 B+ 形态落定）。1.0.0 首版候选：lineTypeAt（八种行类型：frontmatter/code/formula/table/heading/quote/list/text——平台侧组合增量树、frontmatter 区间缓存与跨行公式块表，live 树对 fm 反语义、公式零语义由组合判定补齐）+ inlineAt（code/formula/none 位置级行内标记）+ nodeNames 诊断载荷（祖先链节点名快照，非稳定、不构成兼容承诺）。位置驱动单点查询（µs 级），不暴露树/节点句柄；Live-only。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。',
      },
      {
        entry: 'hostSettings',
        version: '1.0.0',
        status: 'candidate',
        note: '宿主设置白名单读取面（experimental.hostSettings，#457）。1.0.0 首版候选：get 同步读白名单键当前生效值——首项 editor.readingBreaks（#423 阅读渲染宽松换行，easy-typing 严格换行门控的消费入口）；仅编辑器页；拉取式快照（宿主保存热更后下次 get 即新值，无 onDidChange 推送通知）；快照未达/缺键回定义表默认值；白名单外键 invalid-key 拒绝（读取范围收敛，不开放任意 configuration 全量读取）。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。',
      },
    ],
  },
  {
    version: '1.1.0',
    status: 'released',
    releasedAt: '2026-10-16',
    summary:
      '首个随本体发行的稳定 API（随 Vsidian 1.1.0 发布）：1.0.0 候选面与候选期增补（粘贴转换组、2026-10 扩展批次）并入本版本；自本发行日起产生兼容承诺，弃用与移除受双移除门槛约束（两个后续 API 次版本且满 30 天）。此前各本体版本携带的候选面不追溯兼容承诺；experimental 实验入口维持候选口径（兼容清单整本台账唯一锚定，见 1.0.0 记录），不随稳定 API 弃用期限承诺。',
    // 实验入口跨版本唯一锚定（校验器拦截重复出现）；本版本不新增实验入口，
    // 既有五个入口的兼容清单保留在 1.0.0 记录，参考文档按全台账合并呈现。
    experimental: [],
  },
  {
    version: '1.2.0',
    status: 'released',
    releasedAt: '2026-10-18',
    summary:
      '兼容性修订（随 Vsidian 1.2.0 发布）：无新增能力面与实验入口。内核 Codex 主题退役（#535/T08）——旧键 appearance.mermaidTheme 不再参与主题首选解析，首选值域收窄为 default | <addonId>/<themeId>，存量 codex 按未知首选回落 default 显示且首选保留；resolveActiveTheme 对退役 codex 值按目录不命中处理（available=false、effective=default、preferred 保留）；preferredAvailable 收窄为仅 default 恒 true；v1.1.0 公开符号 resolveThemePreferred 双参与 CODEX_THEME_ID 保持编译期兼容并标 @deprecated（弃用与移除受双门槛约束）。',
    // 本版本不新增实验入口，既有五个入口的兼容清单保留在 1.0.0 记录，
    // 参考文档按全台账合并呈现。
    experimental: [],
  },
]
