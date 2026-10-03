// #322 默认编辑器守护——共享纯逻辑（单一事实源）：接管判定、写回值构造、
// 版本锁三元组比较、拒绝记录语义与持久化清洗。宿主服务（host/
// editorGuardService）与 webview/设置页（#323 委托组）消费同一模块，不依赖
// vscode / DOM。#323 增设置页状态行四形态判定（classifyDefaultEditorDisplay）。
//
// 关键口径（规格 docs/specs/default-editor-guard.md 第二节决策表与第四节
// 现状事实，按 VSCode 1.82.0 tag 源码查证）：
// - associations 键集是宿主实现细节（非稳定 API 承诺）：检测与写回共用
//   本模块的键集常量，不得散落字面量；
// - 多 key 匹配同一文件时宿主按 glob 字符串长度降序取第一个（`**/*.md`
//   胜 `*.md`）——检测顺序同向（长度降序），多键非我混合时报告最特异的
//   抢占者，最贴近用户打开 .md 的实际体验；
// - 内置文本编辑器的关联值为字符串 "default"，UI「Configure default
//   editor for ...」写入的 key 形态为 `*${扩展名}`（即 *.md / *.markdown）；
// - 合并语义为 workspace 层同 key 覆盖 user(global) 层——修复写回必须以
//   inspect().globalValue 为基底合并（不得用 get() 合并值直接写回），写后
//   复查 get() 生效值兜底（复查归宿主服务，本模块只构造写回值）。

/** 本扩展自定义编辑器 viewType（package.json contributes.customEditors 声明） */
export const VSIDIAN_EDITOR_VIEW_TYPE = 'onegayi.vsidian.editor'

/** 内置文本编辑器在 associations 中的关联值（1.82.0 源码口径；也算接管） */
export const BUILTIN_EDITOR_ASSOCIATION_VALUE = 'default'

/** 基础键：与 selector 声明一致（`*.md` + `*.markdown`），写回时常写为我 */
export const EDITOR_ASSOCIATION_BASE_KEYS: readonly string[] = ['*.md', '*.markdown']

/** 特异键：更长 glob（宿主仲裁优先于基础键），写回时仅在已存在时覆盖 */
export const EDITOR_ASSOCIATION_SPECIFIC_KEYS: readonly string[] = ['**/*.md', '**/*.markdown']

/** 检测键序：glob 字符串长度降序（双星特异的 markdown 键 > 单星
 *  markdown 键 > 双星特异的 md 键 > 单星 md 键），与宿主特异性仲裁同向
 *  ——多键非我混合时第一个命中的非我键即报告的抢占者 */
export const EDITOR_ASSOCIATION_DETECT_ORDER: readonly string[] = [
  '**/*.markdown',
  '*.markdown',
  '**/*.md',
  '*.md',
]

/** 接管判定结果：未接管，或接管并指明抢占者 viewType（即关联值原文） */
export type EditorTakeoverVerdict =
  | { takenOver: false }
  | { takenOver: true; takerViewType: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 接管判定（规格决策表）：键集任一**存在且值 ≠ 本扩展** 即接管；值为
 * `"default"`（内置文本编辑器）也算接管；全部无记录不算接管。值为
 * null / undefined 的键视同无记录（不参与判定）；值为空字符串视为非我
 * （极端防御形态，抢占者身份为空串，展示层回退原文）。
 */
export function detectEditorTakeover(associations: unknown): EditorTakeoverVerdict {
  if (!isPlainObject(associations)) {
    return { takenOver: false }
  }
  for (const key of EDITOR_ASSOCIATION_DETECT_ORDER) {
    const value = associations[key]
    if (value === null || value === undefined) {
      continue
    }
    if (value !== VSIDIAN_EDITOR_VIEW_TYPE) {
      return { takenOver: true, takerViewType: String(value) }
    }
  }
  return { takenOver: false }
}

/**
 * 写回值构造（规格修复路径）：以 `inspect('editorAssociations').globalValue`
 * 为基底合并——基础键常写为我；已存在的特异键覆盖为我；不存在的特异键
 * 不新增（最小干预）；其他文件类型的映射原样保留。
 *
 * 基底为空 / 非对象（global 层从未写过）时按空基底新建；基底中非字符串值
 * 的键按垃圾丢弃（update 写回的值形态须为 glob → 编辑器 id 字符串）。
 */
export function buildEditorAssociationsFix(globalValue: unknown): Record<string, string> {
  const next: Record<string, string> = {}
  if (isPlainObject(globalValue)) {
    for (const [key, value] of Object.entries(globalValue)) {
      if (typeof value === 'string') {
        next[key] = value
      }
    }
  }
  for (const key of EDITOR_ASSOCIATION_BASE_KEYS) {
    next[key] = VSIDIAN_EDITOR_VIEW_TYPE
  }
  for (const key of EDITOR_ASSOCIATION_SPECIFIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      next[key] = VSIDIAN_EDITOR_VIEW_TYPE
    }
  }
  return next
}

/** 版本段数值提取：每段取数字前缀（`3-beta` → 3）；不足三段或任一段无
 *  数字前缀返回 null（退化形态） */
function parseVersionTriplet(version: string): [number, number, number] | null {
  const parts = version.split('.')
  const numbers: number[] = []
  for (let i = 0; i < 3; i++) {
    const segment = parts[i]
    if (segment === undefined) {
      return null
    }
    const match = /^(\d+)/.exec(segment)
    if (!match) {
      return null
    }
    numbers.push(Number(match[1]))
  }
  return [numbers[0], numbers[1], numbers[2]]
}

/**
 * 版本锁比较（规格决策表：与当前版本**不相等即触发**，含降级）：主.次.修
 * 三元组数值自实现（不引 semver 依赖）。非三段形态（如预发布后缀）按前
 * 三段数字前缀比较；退化形态（解析失败）视为不相等——宁可多提示一次。
 * 锁不存在（首装）或为空串不相等。
 */
export function sameEditorGuardVersion(
  locked: string | null | undefined,
  current: string,
): boolean {
  if (typeof locked !== 'string' || locked.length === 0) {
    return false
  }
  const a = parseVersionTriplet(locked)
  const b = parseVersionTriplet(current)
  if (a === null || b === null) {
    return false
  }
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/** 守护持久化形态（globalState 单键存结构化对象，cssSnippets 同风格） */
export interface EditorGuardPersisted {
  /** 上次主动检测时的扩展版本（三元组比较见 sameEditorGuardVersion） */
  versionLock: string | null
  /** 被用户拒绝的抢占者 viewType 集合（按抢占者压制其被动层提示） */
  rejections: string[]
}

/**
 * 持久化清洗：任意 JSON → 合法 EditorGuardPersisted。非对象整体视为空；
 * versionLock 非空字符串否则置 null；rejections 过滤非字符串项并去重
 * （保持首次出现顺序）。永不抛错。
 */
export function sanitizeEditorGuardPersisted(raw: unknown): EditorGuardPersisted {
  const out: EditorGuardPersisted = { versionLock: null, rejections: [] }
  if (!isPlainObject(raw)) {
    return out
  }
  if (typeof raw.versionLock === 'string' && raw.versionLock.length > 0) {
    out.versionLock = raw.versionLock
  }
  if (Array.isArray(raw.rejections)) {
    const seen = new Set<string>()
    for (const item of raw.rejections) {
      if (typeof item === 'string' && item.length > 0 && !seen.has(item)) {
        seen.add(item)
        out.rejections.push(item)
      }
    }
  }
  return out
}

/**
 * 拒绝记录语义（被动层压制判定）：同抢占者（viewType 相等）在记录中则
 * 压制其被动层提示；换抢占者重新具备提示资格（返回 false 放行）。
 * 主动层（版本变化触发）的绕过不经过本函数——由宿主服务在版本变化分支
 * 直接跳过本判定（每版本至多一次，由版本锁写回保证）。
 */
export function isPassiveSuppressedBy(
  rejections: readonly string[],
  takerViewType: string,
): boolean {
  return rejections.includes(takerViewType)
}

/**
 * 设置页状态行四形态（#323「默认编辑器」委托组）：区分 detectEditorTakeover
 * 合并处理的「未接管」两形态——「已是我」（键存在且全是我，展示 Vsidian）
 * 与「无记录」（键集全部无记录，展示由 VSCode 仲裁的说明文案），两者用户
 * 感知不同。
 */
export type DefaultEditorDisplayStatus = 'vsidian' | 'builtin' | 'other' | 'none'

/**
 * defaultEditor.state 消息载荷体（协议与宿主服务共用本形态；kind 字段由
 * 消息装配处附加）：label 为「其他扩展」形态的可读名（extensions 反查
 * displayName，反查失败回退关联值原文——本身即 viewType 字符串）；其余
 * 形态 label 为 null（展示文本由设置页经自身语言包组句，不透传宿主侧
 * 取词结果，换语言重渲染无滞留）。
 */
export interface DefaultEditorDisplayState {
  status: DefaultEditorDisplayStatus
  /** 抢占者关联值原文（builtin/other 形态随行；vsidian/none 为 null） */
  viewType: string | null
  /** 抢占者可读名（仅 other 形态非 null；builtin 由设置页自组句） */
  label: string | null
}

/** 四形态判定结果（字段命名与 EditorTakeoverVerdict 同族；载荷装配见 DefaultEditorDisplayState） */
export interface DefaultEditorDisplayVerdict {
  status: DefaultEditorDisplayStatus
  /** builtin/other 形态随行关联值原文；vsidian/none 为 null */
  takerViewType: string | null
}

/**
 * 四形态判定：检测序与 detectEditorTakeover 同向（glob 长度降序），第一
 * 个非我键决定 builtin/other 并随行关联值原文；无任何记录 → none；有记
 * 录且全是我 → vsidian。键值为 null/undefined 视同无记录（与接管判定
 * 同口径）。
 */
export function classifyDefaultEditorDisplay(associations: unknown): DefaultEditorDisplayVerdict {
  if (!isPlainObject(associations)) {
    return { status: 'none', takerViewType: null }
  }
  let hasRecord = false
  for (const key of EDITOR_ASSOCIATION_DETECT_ORDER) {
    const value = associations[key]
    if (value === null || value === undefined) {
      continue
    }
    if (value !== VSIDIAN_EDITOR_VIEW_TYPE) {
      return {
        status: value === BUILTIN_EDITOR_ASSOCIATION_VALUE ? 'builtin' : 'other',
        takerViewType: String(value),
      }
    }
    hasRecord = true
  }
  return { status: hasRecord ? 'vsidian' : 'none', takerViewType: null }
}
