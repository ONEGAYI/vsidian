// Callout 语法单一事实源（#653/T02，规格 docs/specs/callout.md §3；T01 探针
// 报告 §4/§9）：识别器 + 类型注册表 + 默认标题派生，Live 装饰
// （liveDecorations 的 Blockquote 分支）与阅读渲染（readingMarkdown 的
// token 变换）共用——适配器不得复制类型表或另写识别规则。
//
// 识别输入（T01 两端语法对拍固定，35 夹具零分歧）：引用容器**直属首段
// 首行**的「段起点→行尾」子串——两端解析器（@codemirror/lang-markdown 与
// markdown-it）在到达本模块前均已剥掉引用/列表前缀，对拍即验证此等价。
// 形态 `/^\[!([^\]]*)\]([+-])?/` 上接三道拒绝：空类型、类型非单标识符
// `[A-Za-z0-9_-]+`、声明后紧贴非空白。未成型按普通引用降级，不补写修复。
//
// 本票（T02）注册表只登记 note 与未知类型回落；全类型/别名/折叠状态机/
// 图标定制归 T03/T04/T06 在此结构上增量扩展，不另建第二份类型表。

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
   *  由 T03/T06 按取证 JSON 分别登记，本票 note 无别名） */
  readonly aliases: readonly string[]
  /** 该类型的 CSS 颜色变量（T03 全类型变量表消费；本票仅 note 落 CSS） */
  readonly colorVariable: string
  /** 图标名（Obsidian 默认主题取证；T06 做 Lucide/SVG 装配） */
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
 * 类型注册表（T02 只登记 note；数据源为 T01 取证
 * obsidian-1144-callout-defaults.json，全类型在 T03 登记）。
 * 消费方：呈现层（CSS 变量/图标选择）、T05 转换规划（菜单写入规范类型）。
 */
export const CALLOUT_TYPES: readonly CalloutTypeEntry[] = [
  {
    id: 'note',
    aliases: [],
    colorVariable: '--callout-default',
    icon: 'lucide-pencil',
    knownType: true,
  },
]

/** 类型标识（已小写规范化）→ 呈现类别条目；未知类型回落 note 外观 */
export function calloutTypeOf(type: string): CalloutTypeEntry {
  const normalized = type.toLowerCase()
  for (const entry of CALLOUT_TYPES) {
    if (entry.id === normalized || entry.aliases.includes(normalized)) {
      return entry
    }
  }
  return FALLBACK_ENTRY
}
