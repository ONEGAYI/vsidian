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
// - 新增/修改六组接口：同步本清单条目（含 semantics 与 verification）、
//   重跑 npm run gen:addonapi 提交产物、按需更新开发指南与消费样例；
// - 台账如实：候选（candidate）与草案（draft）不携带发布日期——未真正
//   发行不得伪造稳定历史；实际发行时改 status=released 并填 releasedAt。

/** 六组公开能力面的分组 ID（票面 #362 口径：按实现模块面分组） */
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

/** 分层：stable-candidate = 随 1.0.0 候选冻结的稳定面；experimental = 实验入口 */
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

/** 六组公开能力面 */
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
]

/** 语义清单条目（六组全量） */
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
      '官方归属只由主仓库维护的扩展 ID 清单判定（唯一入口 isOfficialAddon）；组件不能自行声明「核心」。初版为空占位——首个官方组件发布时在表内登记。',
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
      '设置页「附加组件」分页的状态载荷：七种状态覆盖注册、唤醒在途、待注册、不兼容、激活失败、宿主不可查与声明非法；故障暂停标注但不改变「已启用」归类。',
    semantics: {
      lifecycle: '启用偏好与实际故障分别记录（enabled 与 fault 两个字段）；host-unavailable 原因不可判——不直接写成未安装或装错侧。',
    },
    verification: ['test/integration/suite/addonT02Cases.ts', 'test/browser/addonSidebar.mjs'],
    introduced: '#350（T01）、#355（T06 运行状态）',
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
      '装载器核对入口身份后调用工厂注入 SDK：装载身份（组件 ID + 代次 + 页面种类）、六个能力 facet、CM6 扩展登记、设置页挂载根、资源地址与释放回调。',
    semantics: {
      lifecycle: '代次是硬边界：旧工厂注册、旧消息、迟到结果不能接入新代次；onDispose 回调在停用/故障/代次回收时执行（重复释放无害）。',
      errors: 'views/behaviors/commands/menus/renderers/ui 六个 facet 仅编辑器页提供（设置页为 undefined）；resourceUri 越出资源子目录返回 null（组件不得自造越界地址）。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/browser/addonPageSdk.mjs', 'test/integration/suite/addonT02Cases.ts'],
    introduced: '#351（T02），facet 随 T06–T11 增补',
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
      errors: '五种装载失败原因：already-loaded / script-load-failed / identity-mismatch / no-factory-registered / factory-error（工厂同步异常按故障释放全部注册）。',
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
      lifecycle: '来源身份由 SDK 注入（opId 按装载代次生成），作者请求结构上不携带身份字段——不能冒充其他组件。',
      errors: '八种可辨认拒绝：view-disposed / read-only / suspended / stale-snapshot / history-boundary / conflict / error / invalid-request。旧快照不自动重试（内核输入重定位逻辑不适用于 API 提交）。',
      history: 'atomic（缺省）= 独立撤回边界；joinPrevious = 随同目标上次原子操作撤回，无可确认前项时拒绝（history-boundary 四种形态：空日志/仅外来/组顶被打断/映射失配）。撤销与重做归宿主文本管线。',
    },
    verification: ['test/unit/addonEditApi.test.ts', 'test/unit/addonViews.test.ts', 'test/integration/suite/addonT06Cases.ts', 'test/browser/addonT06EditHost.mjs', 'test/integration/suite/addonHistoryCases.ts'],
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
      language: 'language 只暴露 syntaxTree / ensureSyntaxTree / syntaxTreeAvailable 三个读树函数（最小暴露集合的单一裁剪点在装载器的 addonCm6LanguageSubset）——LRLanguage / foldGutter / indentUnit 等注册类成员不纳入，addon 不应借实验入口注册语言或改全局语言配置；树与节点类型经 type-only 导入消费（构建桥允许）。',
      errors: '宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。',
    },
    verification: ['test/unit/addonPageLoader.test.ts', 'test/browser/addonPageSdk.mjs'],
    introduced: '#349（V02）、#351（T02 登记候选版本）、#406（language 语法树子集）',
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
        symbols: ['AddonBehaviorsFacet', 'AddonBehaviorRegistration', 'AddonInputContext', 'AddonBehaviorInputPlan', 'AddonBehaviorChangeEvent', 'AddonBehaviorRegisterResult'],
      },
    ],
    purpose:
      '注册可组合输入行为：稳定局部 ID + 必填名称 + 可选说明/例子/独占组 + 业务回调。onChanged 为只读观察（通知与修饰分别注册——不是原输入链的第二写入口）。',
    semantics: {
      modes: '合法可编辑 Live 实例（内核先执行只读、IME、表格与既有情境门控）。',
      coordinates: '修饰计划相对 context.snapshot（LF 坐标）；后续行为读取前序行为的修饰结果。',
      lifecycle: '行为能力与适用条件只由代码表达（不复制进清单）；每次修饰按自己的原子声明提交，提交与身份注入由平台完成（行为不能直接写文档）。',
      errors: '注册拒绝：invalid-registration / duplicate-id / not-editor-page / released（名称缺失拒绝、说明/例子缺失允许）。',
      history: '文本变化不终止链（默认可组合）；确需择一的用显式独占组（同组件命名空间内互斥，跨组件不互斥）——不恢复统一「先接管者生效」。',
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
      'setup 生命周期常驻的设置能力：registerPage 登记自己的设置页入口、registerDefinitions 收集可序列化定义、get / getSource 读生效值与来源、update 按批写入指定层、clearWorkspaceOverride 清除工作区覆盖、onChanged 订阅成功保存后的变化。',
    semantics: {
      lifecycle: '普通停用后保留（已停用组件仍可配置）；故障暂停时回收组件代码——平台保留已取得的定义与值，用基础控件供修正参数后手动重试。',
      errors: '按批校验并保存，失败不虚报成功；变化事件只在持久化成功后发出。clearWorkspaceOverride 恢复继承用户默认，不是恢复出厂默认。',
    },
    verification: ['test/unit/addonRuntimeSettings.test.ts', 'test/integration/suite/addonT04Cases.ts', 'test/browser/addonSettings.mjs'],
    introduced: '#351（T02 页面入口）、#353（T04 读写）',
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
        symbols: ['AddonSettingDefinition', 'AddonSettingValue', 'AddonScalarItemSpec', 'isAddonSettingDefinition', 'addonSettingValueMatches'],
      },
    ],
    purpose:
      '设置定义可序列化：标量（boolean/number/string）、数组（重复项）与对象（字段表）一层结构；有限数、长度、枚举约束由定义描述——不存在函数校验器形态。',
    semantics: {
      errors: '定义升级后存量漂移：显式值非法视为该层未设置（跳过继续下层，不从存储删除——定义回退后自动恢复生效）。数组/对象一层硬边界：项与字段必须是标量。',
    },
    verification: ['test/unit/addonSettings.test.ts'],
    introduced: '#353（T04）',
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
        symbols: ['BUILTIN_RENDERER_PROVIDER_ID', 'RendererSelectionInput', 'AddonRendererLanguageSelection', 'selectEffectiveRenderers', 'assignDiscoveryBatches', 'AddonRendererStoreV1'],
      },
    ],
    purpose:
      '选择单位是提供者、挂载单位是某视图中的某个代码块。默认序按（发现批次升序, providerId 升序）取末位生效（内置视作批次 0）；用户显式首选优先且不可用时按默认序回退（首选记录不清除）。',
    semantics: {
      autoRules: '新安装、兼容且已启用组件成功接入后自动替换所支持语言的现有显示（含内置）——不要求用户先选择渲染器；重启、重复注册与普通升级不当作新安装（批次一经记录不改写）。用户正常停用或整组件故障降级停用后内置接管（无图形内置则普通代码块，首选保留）；组件仍运行而渲染有 bug 时不自动接管、不承诺识别或修复；手动恢复成功后按原选择显示，旧异步结果不得重新挂载。',
    },
    verification: ['test/unit/addonRendererTakeover.test.ts', 'test/unit/addonRendererService.test.ts', 'test/browser/addonRendererTakeover.mjs'],
    introduced: '#358（T09）',
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
      '新增自己的可绑定命令（title 自由文本，不进 Vsidian 内置字典）：进入统一快捷键管理（冲突检查/绑定/显式清空/恢复默认）与宿主命令面板；执行链三入口（快捷键路由、宿主命令面板、菜单项点击）共用组件回调。',
    semantics: {
      modes: 'live / reading / both 由代码声明；写操作快捷键仅在 Live 正文接管宿主绑定——源码模式与设置页输入不接管（沿键位注册表 writes 门控）。',
      lifecycle: '命名空间 ID 由平台注入（<组件 ID>.<局部 ID>）；局部 ID 禁点号（含点即伪造跨组件/内置身份）。停用/故障/代次释放整组件回收注册——不影响内置命令，不清用户键位。',
      errors: 'duplicate-command、tab-forbidden（#125 Tab 固定链——「围栏越界 → 表格导航 → 行缩进」优先级不可绕）、非法 chord 等明确拒绝码；普通 API 拒绝不算故障。',
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
]

/** 发行台账（API 版本独立于 Vsidian 本体版本号；如实区分候选与已发布） */
export const ADDON_API_RELEASES: readonly AddonApiReleaseRecord[] = [
  {
    version: '1.0.0',
    status: 'candidate',
    summary:
      '首个候选稳定 API：六组能力面（发现与安装/页面 SDK/输入行为/设置/渲染提供者/命令菜单界面）已随 T01–T12 实施与消费样例收敛。候选 = 形状已冻结待发行，尚未对外发布——发行前不产生兼容承诺；升级为 released 须在真实发行时人工落账并填实际发布日期。',
    experimental: [
      {
        entry: 'cm6',
        version: '1.1.0',
        status: 'candidate',
        note: '页面共享 CM6 运行时（experimental.cm6）。1.1.0 = #406 起暴露面含 language 语法树子集（syntaxTree / ensureSyntaxTree / syntaxTreeAvailable——最小集合，注册类成员不纳入）。使用须在清单 experimental 声明 cm6 兼容范围且含本版本；组件不得重打包 CM6（构建桥拒绝值导入 + 产物静态标记双防线）。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。',
      },
    ],
  },
]
