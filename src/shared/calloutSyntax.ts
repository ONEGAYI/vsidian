// Callout 语法单一事实源（#653/T02 建，#654/T03 全类型登记；规格
// docs/specs/callout.md §3；T01 探针报告 §4/§9）：识别器 + 类型注册表 +
// 默认标题派生，Live 装饰（liveDecorations 的 Blockquote 分支）与阅读渲染
// （readingMarkdown 的 token 变换）共用——适配器不得复制类型表或另写识别
// 规则。
//
// 识别输入（T01 两端语法对拍固定，35 夹具零分歧）：引用容器**直属首段
// 首行**的「段起点→行尾」子串——两端解析器（@codemirror/lang-markdown 与
// markdown-it）在到达本模块前均已剥掉引用/列表前缀，对拍即验证此等价。
// 形态 `/^\[!([^\]]*)\]([+-])?/` 上接三道拒绝：空类型、类型非单标识符
// `[A-Za-z0-9_-]+`、声明后紧贴非空白。未成型按普通引用降级，不补写修复。
//
// 注册表（T03）：13 规范类型 + 14 别名（帮助页口径）+ important 双面归属
// （别名归类 tip、CSS 变量独立）；数据源 obsidian-1144-callout-defaults.json。
// 折叠状态机归 T04、--callout-icon 自定义归 T06，在此结构上增量扩展。

/** 一次成型的 callout 声明（均为输入子串内的相对偏移语义） */
export interface CalloutDecl {
  /** 规范化小写类型标识；未知自定义类型原样小写保留（data-callout 用） */
  readonly type: string
  /** 折叠符号：`+`（默认展开）/ `-`（默认收起）/ undefined（不可折叠）。
   *  本票（T02）仅解析不实现折叠状态机（T04 消费） */
  readonly fold: '+' | '-' | undefined
  /** 显式标题（声明后的首行剩余，trim；无显式标题为 undefined） */
  readonly title: string | undefined
  /** 标记区间右端（输入子串内偏移，不含）：`]` 或其后折叠符号之后 */
  readonly markerTo: number
}

/** 声明形态：`[!类型]` + 可选折叠符号 */
const DECL_RE = /^\[!([^\]]*)\]([+-])?/
/** 类型名须为单个标识符（字母/数字/下划线/连字号） */
const TYPE_RE = /^[A-Za-z0-9_-]+$/

/**
 * 识别 callout 声明（输入为容器直属首段首行「段起点→行尾」子串）。
 * 未成型（空类型/非标识符/紧贴非空白/非标记起点）返回 null——调用方按
 * 普通引用呈现，不补写修复（规格 §3.1）。
 */
export function parseCalloutDecl(line: string): CalloutDecl | null {
  const m = DECL_RE.exec(line)
  if (!m) {
    return null
  }
  const rawType = m[1]!
  // 三道拒绝（T01 对拍固定，后续票不得各写宽松规则）
  if (rawType === '' || !TYPE_RE.test(rawType)) {
    return null
  }
  const after = line.slice(m[0].length)
  if (after !== '' && !/^\s/.test(after)) {
    return null
  }
  const fold = (m[2] as '+' | '-' | undefined) ?? undefined
  const title = after.trim() === '' ? undefined : after.trim()
  return {
    type: rawType.toLowerCase(),
    fold,
    title,
    markerTo: m[0].length,
  }
}

/**
 * 自定义类型标识校验（#656/T05 输入框架的 validateInput 判定）：trim 后
 * 须为单个标识符（字母/数字/下划线/连字号）且非空——TYPE_RE 同一事实源，
 * 宿主输入框与 webview 侧共用，不各写宽松规则。
 */
export function isValidCalloutTypeInput(value: string): boolean {
  const trimmed = value.trim()
  return trimmed !== '' && TYPE_RE.test(trimmed)
}

/**
 * 默认标题派生（Obsidian 1.14.4 app.js 实测口径，T01 取证
 * obsidian-1144-callout-defaults.json）：type trim → 连字号换空格 →
 * 小写 → 首字母大写。默认标题不写回源文（规格 §3.2）。
 */
export function calloutDefaultTitle(type: string): string {
  const normalized = type.trim().replace(/-/g, ' ').toLowerCase()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

/** 注册表条目：默认呈现类别（原标识与呈现类别分开保存——未知类型回落
 *  note 外观，data-callout 仍暴露原标识让自定义 CSS 命中，规格 §3.2） */
export interface CalloutTypeEntry {
  /** 呈现类别 id（即 CSS 类型变量映射的目标类型） */
  readonly id: string
  /** 语法别名（帮助页口径；important 的「别名归类 tip + 独立变量」分歧
   *  由 CALLOUT_ALIAS_VARIABLE_OVERRIDES 分别登记——见其注释） */
  readonly aliases: readonly string[]
  /** 该类型的 CSS 颜色变量（CSS :where 类型表消费，契约测试钉住同步） */
  readonly colorVariable: string
  /** 图标名（Obsidian 默认主题取证；T06 做 Lucide/SVG 自定义接线） */
  readonly icon: string
  /** 是否注册表内置类型（false = 未知类型回落的合成条目） */
  readonly knownType: boolean
}

/** 未知类型的默认呈现类别（note 外观回落） */
export const CALLOUT_FALLBACK_TYPE = 'note'

const FALLBACK_ENTRY: CalloutTypeEntry = {
  id: CALLOUT_FALLBACK_TYPE,
  aliases: [],
  colorVariable: '--callout-default',
  icon: 'lucide-pencil',
  knownType: false,
}

/**
 * 类型注册表（T03 全类型登记；数据源为 T01 取证
 * obsidian-1144-callout-defaults.json——帮助页口径 13 规范类型 + 14 别名，
 * CSS 变量名按 app.css 取证形态：abstract→--callout-summary、
 * failure→--callout-fail、danger→--callout-error；note 的色即
 * --callout-default；important 在帮助页列为 tip 别名、app.css 给独立
 * --callout-important——语法归类的别名归 tip，变量面独立见覆盖表）。
 * 消费方：呈现层（CSS 变量/图标选择，经契约测试映射钉住同步）、
 * T05 转换规划（菜单写入规范类型）。
 */
export const CALLOUT_TYPES: readonly CalloutTypeEntry[] = [
  {
    id: 'note',
    aliases: [],
    colorVariable: '--callout-default',
    icon: 'lucide-pencil',
    knownType: true,
  },
  {
    id: 'abstract',
    aliases: ['summary', 'tldr'],
    colorVariable: '--callout-summary',
    icon: 'lucide-clipboard-list',
    knownType: true,
  },
  {
    id: 'info',
    aliases: [],
    colorVariable: '--callout-info',
    icon: 'lucide-info',
    knownType: true,
  },
  {
    id: 'todo',
    aliases: [],
    colorVariable: '--callout-todo',
    icon: 'lucide-check-circle-2',
    knownType: true,
  },
  {
    id: 'tip',
    aliases: ['hint', 'important'],
    colorVariable: '--callout-tip',
    icon: 'lucide-flame',
    knownType: true,
  },
  {
    id: 'success',
    aliases: ['check', 'done'],
    colorVariable: '--callout-success',
    icon: 'lucide-check',
    knownType: true,
  },
  {
    id: 'question',
    aliases: ['help', 'faq'],
    colorVariable: '--callout-question',
    icon: 'help-circle',
    knownType: true,
  },
  {
    id: 'warning',
    aliases: ['caution', 'attention'],
    colorVariable: '--callout-warning',
    icon: 'lucide-alert-triangle',
    knownType: true,
  },
  {
    id: 'failure',
    aliases: ['fail', 'missing'],
    colorVariable: '--callout-fail',
    icon: 'lucide-x',
    knownType: true,
  },
  {
    id: 'danger',
    aliases: ['error'],
    colorVariable: '--callout-error',
    icon: 'lucide-zap',
    knownType: true,
  },
  {
    id: 'bug',
    aliases: [],
    colorVariable: '--callout-bug',
    icon: 'lucide-bug',
    knownType: true,
  },
  {
    id: 'example',
    aliases: [],
    colorVariable: '--callout-example',
    icon: 'lucide-list',
    knownType: true,
  },
  {
    id: 'quote',
    aliases: ['cite'],
    colorVariable: '--callout-quote',
    icon: 'quote-glyph',
    knownType: true,
  },
]

/**
 * 个别别名的 CSS 变量覆盖（T01 取证 aliasDiscrepancy）：`important`
 * 帮助页列为 tip 的别名（语法归类归 tip），但 app.css 给它独立变量
 * --callout-important（值同 cyan、图标同 lucide-flame）——两者并存不矛盾，
 * 分别登记：别名归 tip 条目，变量经本覆盖表独立呈现（自定义 CSS 可分别
 * 覆盖 --callout-tip 与 --callout-important）。CSS 侧有独立 :where 规则
 * （契约测试钉住）。
 */
export const CALLOUT_ALIAS_VARIABLE_OVERRIDES: Readonly<Record<string, string>> = {
  important: '--callout-important',
}

/** 类型标识（已小写规范化）→ 呈现类别条目；未知类型回落 note 外观 */
export function calloutTypeOf(type: string): CalloutTypeEntry {
  const normalized = type.toLowerCase()
  for (const entry of CALLOUT_TYPES) {
    if (entry.id === normalized || entry.aliases.includes(normalized)) {
      const override = CALLOUT_ALIAS_VARIABLE_OVERRIDES[normalized]
      return override && override !== entry.colorVariable
        ? { ...entry, colorVariable: override }
        : entry
    }
  }
  return FALLBACK_ENTRY
}
