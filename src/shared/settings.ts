// 设置定义与读写纯逻辑（#33）：单一事实源，宿主（settingsService）与
// webview（设置页渲染）两端共享，不依赖 vscode / DOM。
//
// 设计决策（工单 #33 + AGENTS.md「插件设置入口」约定）：
// - 存储与 schema 完全归 Vsidian 自有链路：不使用 workspace.getConfiguration，
//   不声明 contributes.configuration——设置项不出现在 VSCode 统一设置中心，
//   界面入口只有扩展自己的设置页。
// - 定义含键、类型、默认值；校验内建于类型（boolean 开关、string 枚举
//   （#93 i18n 语言设置型）、number 范围步进（#175 可读行宽滑块型））。
// - 生产注册表初始为空：设置页据此渲染空状态，不展示不能生效的占位开关；
//   后续工单接入实际设置项时在 PRODUCTION_SETTING_DEFINITIONS 追加。
// - 值域语义：无效存量（类型不符）恢复默认值；未知键（历史遗留）忽略；
//   补丁应用按批原子——任一键非法整批拒绝，有效值不落地。

// 纯类型导入：MessageKey 只用于 optionLabelKeys 的编译期约束（esbuild 剥除
// type import，字典字节不进 webview 产物——settings.ts 被两端共享）
import type { MessageKey } from './locales/en'

/** 协议载荷中的设置值：标量容器（协议层只约束形态，合法性由本模块按定义判定；
 *  放宽数值类型不需要改协议——「整体下发而非逐项布尔」的扩展预留） */
export type SettingsPayloadValue = boolean | number | string

/** 设置快照：键 → 当前生效值 */
export type SettingsPayload = Record<string, SettingsPayloadValue>

/** 单个设置项定义的公共字段 */
interface SettingDefinitionBase {
  /** 稳定标识（点分层级，如 'editor.lineNumbers'；不得为空串） */
  key: string
  /** 展示名消息键（#95 起语义为 MessageKey，渲染层经 t() 取词；非空由
   *  isSettingDefinition 保证，键存在性由语言包编译期 parity 保证） */
  titleKey: string
  /** 可选说明消息键（设置页副文案，同样经 t() 取词） */
  descriptionKey?: string
  /**
   * 可选依赖（#155 跟进）：本项可用的前提设置项 key（boolean 语义——
   * 依赖项开启时本项可用）。设置页据此自动灰化：依赖关闭时控件禁用、
   * 条目降不透明度，依赖恢复自动解灰；值不清除，依赖恢复后按原值生效。
   * 引用存在性与无环由 validateSettingDependencies 校验（生产注册表由
   * 单测钉住恒合法）；依赖链可传递（A 依赖 B、B 依赖 C 则逐级传导）。
   */
  dependsOn?: string
  /**
   * 可选枚举值依赖（#163 验收反馈防呆）：依赖项（string 枚举型）当前值
   * ∈ values 时本项可用——语义为「仅这些取值下本设置才有意义」。依赖项
   * 自身灰化时传导（链式）；values ⊆ 依赖项枚举由校验把关。
   */
  dependsOnEnum?: { key: string; values: readonly string[] }
}

/** 布尔设置项（开关；#34「显示源文件行号」同型） */
export interface BooleanSettingDefinition extends SettingDefinitionBase {
  type: 'boolean'
  /** 默认值：缺省与无效存量的回退目标 */
  default: boolean
}

/**
 * 字符串枚举设置项（#93 i18n 设置 schema 扩展）：值域必填（枚举非空、
 * 无重复），默认值必须在值域内；设置页渲染为下拉控件，enum 顺序即选项
 * 顺序。optionLabels 提供枚举值 → 静态显示名（缺省显示原值；语言设置项的
 * 「语言自名不自译」约定见规格「语言设置项」）。optionLabelKeys（#96）
 * 提供枚举值 → 消息键，渲染层经 t() 取词——显示名随当前装配语言变化
 * （语言设置 auto 档「自动 / Auto」）。显示名优先级：optionLabels >
 * optionLabelKeys > 原值。键类型经 import type 引入（纯类型依赖，不把
 * 字典字节带进 webview 产物）。
 */
export interface StringEnumSettingDefinition extends SettingDefinitionBase {
  type: 'string'
  default: string
  /** 值域（非空、无重复） */
  enum: readonly string[]
  /** 可选：枚举值 → 选项静态显示名（不随语言变化，如语言自名） */
  optionLabels?: Readonly<Record<string, string>>
  /** 可选：枚举值 → 消息键（渲染层 t() 取词，随当前语言变化） */
  optionLabelKeys?: Readonly<Record<string, MessageKey>>
}

/**
 * 字符串自由文本设置项（#161 图片粘贴）：无值域的受限文本——长度上限
 * 必填（防误存超长字符串进 globalState 与协议载荷），设置页渲染为
 * text input。与 StringEnum 的分型判据是 enum 字段有无（两者 type 同为
 * 'string'，TS 经 `'enum' in def` 收窄）。
 */
export interface StringTextSettingDefinition extends SettingDefinitionBase {
  type: 'string'
  default: string
  /** 值长度上限（正整数；default 与存量/补丁值均不得超限） */
  maxLength: number
}

/**
 * 数字设置项（#175「可读行宽」起启用，本文件头注的 number 预留兑现）：
 * 范围与步进内建于类型——min/max/step 必为有限数、min ≤ max、step > 0、
 * default 在 [min, max] 内；校验只管类型与范围，步进倍数不强制（滑块产出
 * 步进值，手改存量允许任意范围内值）。0 是普通合法值——「0 = 铺满」的
 * 领域语义归各消费方解释（见 READABLE_LINE_WIDTH_* 注释），schema 不特判。
 * 设置页渲染为滑块控件（range），值文本显示消费方自定（如铺满档显示词）。
 */
export interface NumberSettingDefinition extends SettingDefinitionBase {
  type: 'number'
  default: number
  /** 值域下限（含） */
  min: number
  /** 值域上限（含） */
  max: number
  /** 步进（正有限数；显示与滑块粒度，不作为存量校验条件） */
  step: number
  /**
   * 可选：值 0 的显示词消息键（#175 可读行宽的「铺满」档）——设置页滑块
   * 的值文本与 aria-valuetext 在 0 时取此词，缺省显示原值。语义归消费方
   * （schema 不特判 0），显示归渲染层经本键取词（注册表驱动，无逐项特判）。
   */
  zeroLabelKey?: MessageKey
  /** 可选：非 0 值的单位后缀（如 'px'），缺省无单位 */
  unit?: string
}

export type SettingDefinition =
  | BooleanSettingDefinition
  | StringEnumSettingDefinition
  | StringTextSettingDefinition
  | NumberSettingDefinition

/**
 * #34「显示行号」：实时预览侧 CM6 行号栏开关。键与消费方常量成对导出——
 * webview（syncController 的 Compartment 装配）与宿主（无直接消费，经快照
 * 透传）读同一键，避免字面量漂移。默认开启（首次安装即显示，工单 #34）。
 */
export const SHOW_LINE_NUMBERS_KEY = 'editor.lineNumbers'
export const SHOW_LINE_NUMBERS_DEFAULT = true

/**
 * #79「代码块卡片」总开关：围栏代码块呈现态收起为卡片（隐藏围栏标记、
 * 头部横带 + 语言标签；行号/复制按钮子开关见 #80/#81 的
 * codeblock.lineNumbers / codeblock.copyButton，语法高亮见 #83 的
 * codeblock.highlight）。关闭后回到朴素源码围栏外观。键与消费方
 * （syncController 的 codeCardCompartment）成对导出。
 */
export const CODEBLOCK_CARD_KEY = 'codeblock.card'
export const CODEBLOCK_CARD_DEFAULT = true

/**
 * #80「卡内行号」子开关：卡片内代码行行首的块内行号（每块从 1 起、围栏
 * 行不占号）。依附卡片总开关——卡片关闭时本项无效。
 */
export const CODEBLOCK_LINE_NUMBERS_KEY = 'codeblock.lineNumbers'
export const CODEBLOCK_LINE_NUMBERS_DEFAULT = true

/**
 * #81「复制按钮」子开关：卡片头部悬停显现的复制按钮（点击经宿主剪贴板
 * API 复制代码体）。依附卡片总开关；编辑态同样常驻，收起态不发射。
 */
export const CODEBLOCK_COPY_BUTTON_KEY = 'codeblock.copyButton'
export const CODEBLOCK_COPY_BUTTON_DEFAULT = true

/**
 * #83「语法高亮」独立开关：tok-* token 着色（Lezer 语言包 + legacy-modes，
 * 两视图共用同一词表与色板）。独立于卡片——卡片关闭时朴素围栏仍可着色。
 */
export const CODEBLOCK_HIGHLIGHT_KEY = 'codeblock.highlight'
export const CODEBLOCK_HIGHLIGHT_DEFAULT = true

/**
 * #123「符号自动补全」开关：实时预览正文中键入起始符号自动补入闭合
 * 符号（含闭合越过与自动空对退格删除，注册表见 shared/symbols）。
 * 关闭后三条路径（补全/越过/空对删除）一并停用。
 */
export const SYMBOL_AUTOCOMPLETE_KEY = 'editor.symbolAutocomplete'
export const SYMBOL_AUTOCOMPLETE_DEFAULT = true

/**
 * #124「选区符号包裹」开关：有非空选区时键入注册包裹符号在选区两侧
 * 包裹并保持原文选中（跨段按空行拆段、多 range 原文保持；注册表
 * selectionWrap 登记）。与 #123 自动补全是两个独立开关，互不替代；
 * 关闭后包裹路径停用（键入回到普通替换选区语义），无选区补全不受
 * 影响；#125 Tab 越界为第三个独立布尔键（规格三独立开关）。
 */
export const SYMBOL_SELECTION_WRAP_KEY = 'editor.symbolSelectionWrap'
export const SYMBOL_SELECTION_WRAP_DEFAULT = true

/**
 * #125「符号 Tab 越界」开关：光标在有效成对围栏内部时 Tab 先到闭合
 * 标记左边界、再越过整个闭合标记（嵌套逐层退出；表格格内先越界后切格，
 * 围栏外沿用既有缩进）。与 #123/#124 是三个独立开关（规格三独立开关）；
 * 关闭后 Tab 回落既有表格导航/整行缩进行为。
 */
export const SYMBOL_TAB_ESCAPE_KEY = 'editor.symbolTabEscape'
export const SYMBOL_TAB_ESCAPE_DEFAULT = true

/**
 * #175「可读行宽」：正文内容列的最大宽度（px），Live 与阅读两模式共用
 * 一份值。**0 = 铺满**（不限宽，默认档）——两模式内容铺满主区可用宽度；
 * 非 0 值为列宽上限，内容自动避让右侧大纲栏收缩（min(设定宽, 可用宽)）
 * 并在主区水平居中、随侧栏开合动态跟随。应用层经 CSS 双变量落地：
 * --vsidian-reading-max-width（阅读）与 --vsidian-live-preview-max-width
 * （Live）——0 档产品不写内联变量（CSS 片段全层级常规规则可定制），
 * 非 0 档内联写两变量：根级片段覆盖需 !important，按视图作用域声明的
 * 后代级片段常规规则即生效（差异化路径）。键与消费方
 * （syncController 的应用器）成对导出，避免字面量漂移。
 */
export const READABLE_LINE_WIDTH_KEY = 'editor.readableLineWidth'
/** 默认 0 = 铺满（bug #174 修复语义：默认无限宽，阅读与 Live 默认一致） */
export const READABLE_LINE_WIDTH_DEFAULT = 0
/** 值域下限：0 即铺满档，不另设独立开关 */
export const READABLE_LINE_WIDTH_MIN = 0
/** 值域上限：1600px（更宽需求走铺满档） */
export const READABLE_LINE_WIDTH_MAX = 1600
/** 步进 20px（滑块粒度） */
export const READABLE_LINE_WIDTH_STEP = 20

/**
 * #222「嵌入最大高度」：Reading 正文嵌入卡片内容滚动区的限高（px）。
 * 短内容自然高度不受影响；超限内容内部滚动。规格一期初值 480px（视觉
 * 验收可校准的工程初值，不构成完成时限承诺）。键与消费方
 * （syncController 的 applyEmbedMaxHeightSetting → EmbedCardManager）
 * 成对导出，避免字面量漂移。
 */
export const EMBED_MAX_HEIGHT_KEY = 'embed.maxHeight'
/** 默认 480px（规格一期初值） */
export const EMBED_MAX_HEIGHT_DEFAULT = 480
/** 值域下限：低于一屏的卡片没有阅读价值 */
export const EMBED_MAX_HEIGHT_MIN = 160
/** 值域上限：更高需求属全屏阅读场景（直接打开原文档） */
export const EMBED_MAX_HEIGHT_MAX = 2000
/** 步进 20px（滑块粒度） */
export const EMBED_MAX_HEIGHT_STEP = 20

/**
 * 语言设置键（#93 预留，#96 注册定义与「常规」分区）：值域 auto | zh-cn |
 * en（StringEnumSettingDefinition），解析与语言包装配见 shared/locales。
 * 键常量先行导出——宿主 HTML 生成点读取快照中的该键决定注入语言（缺省
 * 走 auto 语义），设置项注册后无需再改取键方。
 */
export const LANGUAGE_KEY = 'general.language'

/** 语言设置默认值：auto（跟随 VSCode 显示语言解析，规格「两层语言模型」） */
export const LANGUAGE_DEFAULT = 'auto'

/**
 * #161「粘贴图片插入」总开关：Live 正文粘贴剪贴板图片时拦截并落盘为
 * 资产文件、光标处插入图片引用。关闭后粘贴回到 CM6 默认行为（零拦截）。
 * 键与消费方（webview paste 拦截守卫、宿主落盘链路）成对导出。
 */
export const IMAGE_PASTE_KEY = 'image.paste'
export const IMAGE_PASTE_DEFAULT = true

/**
 * #161 图片存放位置模式（StringEnum）：same-dir=与当前文件同目录（默认）；
 * workspace-root=工作区第一文件夹根 + 子路径；relative-to-file=当前文档
 * 所在目录 + 子路径。解析纯函数在 host/imagePastePlan（URI path 空间）。
 */
export const IMAGE_PASTE_LOCATION_KEY = 'image.pasteLocation'
export const IMAGE_PASTE_LOCATION_MODES = ['same-dir', 'workspace-root', 'relative-to-file'] as const
export type ImagePasteLocationMode = (typeof IMAGE_PASTE_LOCATION_MODES)[number]
export const IMAGE_PASTE_LOCATION_DEFAULT: ImagePasteLocationMode = 'same-dir'

/**
 * #161 图片存放子路径（自由文本，默认 assets）：workspace-root /
 * relative-to-file 模式下拼在根后；same-dir 模式不生效（描述文案写明）。
 * 目录解析拒绝绝对路径与 `..` 越界（违规粘贴失败通知，不落盘）。
 */
export const IMAGE_PASTE_SUBPATH_KEY = 'image.pasteSubpath'
export const IMAGE_PASTE_SUBPATH_DEFAULT = 'assets'
/** 子路径长度上限（与定义 maxLength 同源；防超长字符串进存储与消息） */
export const IMAGE_PASTE_SUBPATH_MAX_LENGTH = 200

/**
 * 生产设置定义注册表：#33 交付空状态页面与完整数据链路，#34 加入首个
 * 实际设置项「显示行号」（设置页自此渲染真实开关），#79 加入「代码块卡片」，
 * #80 加入「卡内行号」，#81 加入「复制按钮」，#83 加入「语法高亮」，#96
 * 加入「界面语言」（首个 string 枚举项，归属设置页「常规」分组——键前缀
 * general.* 的定义渲染进常规分组，见 settingsPageView 分组规则），#123
 * 加入「符号自动补全」，#124 加入「选区符号包裹」，#125 加入「符号 Tab
 * 越界」（三者独立布尔开关，见上方键常量注释），#161 加入图片粘贴三件
 * （总开关 / 存放模式枚举 / 子路径自由文本，首个 StringText 型）。
 * #95 i18n 起文案字段键化（titleKey/descriptionKey → 字典 setting.*），
 * 注册表不再含用户可见字面量。
 */
export const PRODUCTION_SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: LANGUAGE_KEY,
    type: 'string',
    default: LANGUAGE_DEFAULT,
    enum: ['auto', 'zh-cn', 'en'],
    titleKey: 'setting.language.title',
    descriptionKey: 'setting.language.description',
    // 语言自名不自译（规格「语言设置项」）：静态直显，不随界面语言翻译
    optionLabels: { 'zh-cn': '简体中文', en: 'English' },
    // auto 档例外：随当前界面语言取词（自动 / Auto）
    optionLabelKeys: { auto: 'setting.languageAuto' },
  },
  {
    key: SHOW_LINE_NUMBERS_KEY,
    type: 'boolean',
    default: SHOW_LINE_NUMBERS_DEFAULT,
    titleKey: 'setting.editorLineNumbers.title',
    descriptionKey: 'setting.editorLineNumbers.description',
  },
  {
    key: CODEBLOCK_CARD_KEY,
    type: 'boolean',
    default: CODEBLOCK_CARD_DEFAULT,
    titleKey: 'setting.codeblockCard.title',
    descriptionKey: 'setting.codeblockCard.description',
  },
  {
    key: CODEBLOCK_LINE_NUMBERS_KEY,
    type: 'boolean',
    default: CODEBLOCK_LINE_NUMBERS_DEFAULT,
    titleKey: 'setting.codeblockLineNumbers.title',
    descriptionKey: 'setting.codeblockLineNumbers.description',
    dependsOn: CODEBLOCK_CARD_KEY,
  },
  {
    key: CODEBLOCK_COPY_BUTTON_KEY,
    type: 'boolean',
    default: CODEBLOCK_COPY_BUTTON_DEFAULT,
    titleKey: 'setting.codeblockCopyButton.title',
    descriptionKey: 'setting.codeblockCopyButton.description',
    dependsOn: CODEBLOCK_CARD_KEY,
  },
  {
    key: CODEBLOCK_HIGHLIGHT_KEY,
    type: 'boolean',
    default: CODEBLOCK_HIGHLIGHT_DEFAULT,
    titleKey: 'setting.codeblockHighlight.title',
    descriptionKey: 'setting.codeblockHighlight.description',
  },
  {
    key: SYMBOL_AUTOCOMPLETE_KEY,
    type: 'boolean',
    default: SYMBOL_AUTOCOMPLETE_DEFAULT,
    titleKey: 'setting.symbolAutocomplete.title',
    descriptionKey: 'setting.symbolAutocomplete.description',
  },
  {
    key: SYMBOL_SELECTION_WRAP_KEY,
    type: 'boolean',
    default: SYMBOL_SELECTION_WRAP_DEFAULT,
    titleKey: 'setting.symbolSelectionWrap.title',
    descriptionKey: 'setting.symbolSelectionWrap.description',
  },
  {
    key: SYMBOL_TAB_ESCAPE_KEY,
    type: 'boolean',
    default: SYMBOL_TAB_ESCAPE_DEFAULT,
    titleKey: 'setting.symbolTabEscape.title',
    descriptionKey: 'setting.symbolTabEscape.description',
  },
  // #161 图片粘贴：总开关 + 存放模式枚举 + 子路径自由文本（首个
  // StringTextSettingDefinition——设置页 text input 控件分支随本批接入）
  {
    key: IMAGE_PASTE_KEY,
    type: 'boolean',
    default: IMAGE_PASTE_DEFAULT,
    titleKey: 'setting.imagePaste.title',
    descriptionKey: 'setting.imagePaste.description',
  },
  {
    key: IMAGE_PASTE_LOCATION_KEY,
    type: 'string',
    default: IMAGE_PASTE_LOCATION_DEFAULT,
    enum: IMAGE_PASTE_LOCATION_MODES,
    titleKey: 'setting.imagePasteLocation.title',
    descriptionKey: 'setting.imagePasteLocation.description',
    // 总开关关闭时模式选择一并灰化（子路径经 dependsOnEnum 链级联）
    dependsOn: IMAGE_PASTE_KEY,
    optionLabelKeys: {
      'same-dir': 'setting.imagePasteLocationSameDir',
      'workspace-root': 'setting.imagePasteLocationWorkspaceRoot',
      'relative-to-file': 'setting.imagePasteLocationRelativeToFile',
    },
  },
  {
    key: IMAGE_PASTE_SUBPATH_KEY,
    type: 'string',
    default: IMAGE_PASTE_SUBPATH_DEFAULT,
    maxLength: IMAGE_PASTE_SUBPATH_MAX_LENGTH,
    titleKey: 'setting.imagePasteSubpath.title',
    descriptionKey: 'setting.imagePasteSubpath.description',
    // #163 验收反馈防呆：子路径只对后两种存放模式生效——同目录模式下
    // 控件灰化禁改（值不清除，切回有效模式按原值生效）；依赖链经
    // pasteLocation 的 dependsOn 传导（总开关关闭时整组灰化）
    dependsOnEnum: {
      key: IMAGE_PASTE_LOCATION_KEY,
      values: ['workspace-root', 'relative-to-file'],
    },
  },
  {
    key: READABLE_LINE_WIDTH_KEY,
    type: 'number',
    default: READABLE_LINE_WIDTH_DEFAULT,
    min: READABLE_LINE_WIDTH_MIN,
    max: READABLE_LINE_WIDTH_MAX,
    step: READABLE_LINE_WIDTH_STEP,
    titleKey: 'setting.readableLineWidth.title',
    descriptionKey: 'setting.readableLineWidth.description',
    zeroLabelKey: 'setting.readableLineWidthFill',
    unit: 'px',
  },
  {
    // #222 嵌入最大高度（embed.* 域 → 编辑器页「显示」组：非 symbol/
    // codeblock/image 前缀的 editor 域外键由 displayDefs 收纳）
    key: EMBED_MAX_HEIGHT_KEY,
    type: 'number',
    default: EMBED_MAX_HEIGHT_DEFAULT,
    min: EMBED_MAX_HEIGHT_MIN,
    max: EMBED_MAX_HEIGHT_MAX,
    step: EMBED_MAX_HEIGHT_STEP,
    titleKey: 'setting.embedMaxHeight.title',
    descriptionKey: 'setting.embedMaxHeight.description',
    unit: 'px',
  },
]

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 依赖可用性（#155 跟进；#163 验收反馈增枚举值依赖）：按 dependsOn /
 * dependsOnEnum 链递归解析本项当前是否可用。语义：无依赖恒可用；
 * dependsOn（boolean）依赖项开启才可用；dependsOnEnum 依赖项值 ∈ values
 * 才可用；链上传导（父不可用则子不可用）；快照缺值回退依赖项默认值
 * （与 sanitize 语义一致）；非布尔值不视为开启。成环时视为可用不死
 * 循环——环由 validateSettingDependencies 拦截（生产注册表单测钉住恒
 * 合法），此处只做渲染层兜底。
 */
export function isSettingEnabled(
  defs: readonly SettingDefinition[],
  values: SettingsPayload,
  def: SettingDefinition,
): boolean {
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const enabledOf = (current: SettingDefinition, visited: Set<string>): boolean => {
    if (current.dependsOn !== undefined) {
      if (visited.has(current.dependsOn)) {
        return true // 环兜底（注册表校验另行拦截）
      }
      const dependency = byKey.get(current.dependsOn)
      if (!dependency) {
        return true // 引用缺失兜底（注册表校验另行拦截）
      }
      const raw = values[current.dependsOn]
      if ((raw === undefined ? dependency.default : raw) !== true) {
        return false
      }
      visited.add(current.dependsOn)
      return enabledOf(dependency, visited)
    }
    if (current.dependsOnEnum !== undefined) {
      const { key, values: allowed } = current.dependsOnEnum
      if (visited.has(key)) {
        return true // 环兜底
      }
      const dependency = byKey.get(key)
      if (!dependency) {
        return true // 引用缺失兜底
      }
      const raw = values[key]
      if (!allowed.includes(raw === undefined ? String(dependency.default) : String(raw))) {
        return false
      }
      // 依赖项自身不可用时传导灰化（链式语义与 dependsOn 一致）
      visited.add(key)
      return enabledOf(dependency, visited)
    }
    return true
  }
  return enabledOf(def, new Set())
}

/**
 * 依赖注册完整性校验（#155 跟进；#163 验收反馈增枚举值依赖）：每个
 * dependsOn / dependsOnEnum 引用必须存在于定义表，且依赖链无自环、无
 * 传递环；dependsOnEnum 的目标必须是 string 枚举型、values 不得越出其
 * 枚举。返回违规描述列表（空数组 = 合法）。生产注册表的合法性由单测钉
 * 住——新增依赖项时此函数保证错引用/成环/越界在测试期暴露。
 */
export function validateSettingDependencies(defs: readonly SettingDefinition[]): string[] {
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const violations: string[] = []
  for (const def of defs) {
    if (!def.dependsOn && !def.dependsOnEnum) continue
    if (def.dependsOn && !byKey.has(def.dependsOn)) {
      violations.push(`${def.key} dependsOn 未注册的 ${def.dependsOn}`)
    }
    if (def.dependsOnEnum) {
      const { key, values } = def.dependsOnEnum
      const dependency = byKey.get(key)
      if (!dependency) {
        violations.push(`${def.key} dependsOnEnum 未注册的 ${key}`)
      } else if (!('enum' in dependency) || !Array.isArray(dependency.enum)) {
        violations.push(`${def.key} dependsOnEnum 依赖非枚举型的 ${key}`)
      } else if (values.some((v) => !dependency.enum!.includes(v))) {
        violations.push(`${def.key} dependsOnEnum values 不在依赖项枚举内（${key}）`)
      }
    }
    const chain = new Set<string>()
    let cursor: SettingDefinition | undefined = def
    for (;;) {
      const nextKey = cursor?.dependsOn ?? cursor?.dependsOnEnum?.key
      if (nextKey === undefined) {
        break
      }
      if (chain.has(cursor!.key)) {
        violations.push(`${def.key} 依赖链成环（${[...chain, cursor!.key].join(' -> ')}）`)
        break
      }
      chain.add(cursor!.key)
      cursor = byKey.get(nextKey)
    }
  }
  return violations
}

/** 定义自校验（注册入口防线：非法定义整体拒绝）。titleKey/descriptionKey
 *  只校验字符串形态（非空）；键是否存在于语言包由渲染层 t() 回退链兜底
 *  （缺键显示键名本身），生产键的正确性由字典编译期 parity 保证 */
export function isSettingDefinition(v: unknown): v is SettingDefinition {
  if (
    !isObject(v) ||
    typeof v.key !== 'string' ||
    v.key.length === 0 ||
    typeof v.titleKey !== 'string' ||
    (v.descriptionKey !== undefined && typeof v.descriptionKey !== 'string') ||
    (v.dependsOn !== undefined && (typeof v.dependsOn !== 'string' || v.dependsOn.length === 0)) ||
    (v.dependsOnEnum !== undefined && (
      !isObject(v.dependsOnEnum) ||
      typeof v.dependsOnEnum.key !== 'string' ||
      v.dependsOnEnum.key.length === 0 ||
      !Array.isArray(v.dependsOnEnum.values) ||
      v.dependsOnEnum.values.length === 0 ||
      !v.dependsOnEnum.values.every((item) => typeof item === 'string')
    ))
  ) {
    return false
  }
  if (v.type === 'boolean') {
    return typeof v.default === 'boolean'
  }
  if (v.type === 'number') {
    // #175 number 型：min/max/step 有限、min ≤ max、step 正数、default 在范围内；
    // zeroLabelKey/unit 可选显示字段存在时须为字符串
    return (
      typeof v.default === 'number' && Number.isFinite(v.default) &&
      typeof v.min === 'number' && Number.isFinite(v.min) &&
      typeof v.max === 'number' && Number.isFinite(v.max) &&
      typeof v.step === 'number' && Number.isFinite(v.step) &&
      v.min <= v.max && v.step > 0 && v.default >= v.min && v.default <= v.max &&
      (v.zeroLabelKey === undefined || typeof v.zeroLabelKey === 'string') &&
      (v.unit === undefined || typeof v.unit === 'string')
    )
  }
  if (v.type === 'string') {
    // #161 自由文本形态：无 enum + maxLength 正整数 + default 不超限
    if (v.enum === undefined) {
      return (
        typeof v.default === 'string' &&
        typeof v.maxLength === 'number' &&
        Number.isInteger(v.maxLength) &&
        v.maxLength > 0 &&
        v.default.length <= v.maxLength
      )
    }
    // #93 string 枚举：值域非空、全字符串、无重复，默认值在值域内
    if (
      typeof v.default !== 'string' ||
      !Array.isArray(v.enum) ||
      v.enum.length === 0 ||
      !v.enum.every((item) => typeof item === 'string') ||
      new Set(v.enum).size !== v.enum.length ||
      !v.enum.includes(v.default)
    ) {
      return false
    }
    if (
      v.optionLabels !== undefined &&
      (!isObject(v.optionLabels) || !Object.values(v.optionLabels).every((label) => typeof label === 'string'))
    ) {
      return false
    }
    // #96 optionLabelKeys：形态校验（对象、值全字符串）；键是否真实存在
    // 由渲染层 t() 回退链兜底（编译期类型已约束生产注册表）
    if (
      v.optionLabelKeys !== undefined &&
      (!isObject(v.optionLabelKeys) || !Object.values(v.optionLabelKeys).every((k) => typeof k === 'string'))
    ) {
      return false
    }
    return true
  }
  return false
}

/** 值是否符合定义的类型（boolean 布尔；string 枚举值域内 / 自由文本不超
 *  上限的字符串——按 enum 有无分型，与 isSettingDefinition 同判据；number
 *  范围内有限数） */
function valueMatchesType(def: SettingDefinition, value: unknown): boolean {
  if (def.type === 'boolean') {
    return typeof value === 'boolean'
  }
  if (def.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) && value >= def.min && value <= def.max
  }
  if ('enum' in def) {
    return typeof value === 'string' && def.enum.includes(value)
  }
  return typeof value === 'string' && value.length <= def.maxLength
}

/** 按定义表产出默认值快照 */
export function settingsDefaults(defs: readonly SettingDefinition[]): SettingsPayload {
  const out: SettingsPayload = {}
  for (const def of defs) {
    out[def.key] = def.default
  }
  return out
}

/**
 * 存量清洗：持久化容器读出的任意 JSON → 合法快照。
 * 规则：非对象整体视为空；未知键忽略（历史遗留不进入快照）；类型不符的
 * 值恢复默认；缺失键回填默认。永不抛错、永不部分读取非法字段。
 */
export function sanitizeStoredSettings(
  defs: readonly SettingDefinition[],
  stored: unknown,
): SettingsPayload {
  const out = settingsDefaults(defs)
  if (!isObject(stored)) {
    return out
  }
  for (const def of defs) {
    const value = stored[def.key]
    if (valueMatchesType(def, value)) {
      // valueMatchesType 已按定义类型校验；TS 无法对依赖 def 的谓词收窄
      out[def.key] = value as SettingsPayloadValue
    }
  }
  return out
}

/** 补丁应用结果：ok 时 merged 为合并后的完整快照；拒绝时列出非法键 */
export type ApplySettingsResult =
  | { ok: true; merged: SettingsPayload }
  | { ok: false; rejected: string[] }

/**
 * 补丁应用（保存路径）：patch 中每个键必须已定义且值匹配类型，任一非法
 * 整批拒绝（原子性——半批落地会让「无效值恢复默认」语义漂移为部分生效）。
 * 空补丁合法且幂等。
 */
export function applySettingsPatch(
  defs: readonly SettingDefinition[],
  current: SettingsPayload,
  patch: unknown,
): ApplySettingsResult {
  if (!isObject(patch)) {
    return { ok: false, rejected: [] }
  }
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const rejected: string[] = []
  for (const key of Object.keys(patch)) {
    const def = byKey.get(key)
    if (!def || !valueMatchesType(def, patch[key])) {
      rejected.push(key)
    }
  }
  if (rejected.length > 0) {
    return { ok: false, rejected }
  }
  // 上方已验证 patch 为对象、键全部已定义且值匹配类型（收窄安全）
  return { ok: true, merged: { ...current, ...(patch as SettingsPayload) } }
}
