// 主题文件解析与颜色解析管线（纯逻辑，无 vscode 依赖）。
// #335 探针建立、#340（P3-08）转入生产（宿主 text 通道外观服务的数据层）。
// 合并顺序与回退链按 VSCode 1.82.3 官方实现移植（来源：
// src/vs/workbench/services/themes/common/colorThemeData.ts 的
// _loadColorTheme / addCustomTokenColors / tokenColors 组装）。

import { resolveTokenStyle, type ResolvedTokenStyle, type ThemedTokenRule } from './tmScopeMatcher'

export type { ThemedTokenRule } from './tmScopeMatcher'

/** 文件读取注入（宿主内用 node fs；单测注入内存映射） */
export type ReadTextFile = (absolutePath: string) => Promise<string>

export interface SemanticStyleRule {
  /** 原始选择器文本（回溯用） */
  selector: string
  foreground?: string
  fontStyle?: string
}

export interface LoadedTheme {
  /** include 链（加载顺序：被包含者在先） */
  chain: string[]
  /** 主题 colors 段（key 如 editor.foreground，值为归一化 #rrggbb(aa)） */
  colors: Record<string, string>
  /** 主题 tokenColors（include 先、own 后 ⇒ 同分时 own 覆盖） */
  tokenColors: ThemedTokenRule[]
  /** 主题 semanticTokenColors 规则 */
  semanticRules: SemanticStyleRule[]
  /** 主题声明 semanticHighlighting */
  semanticHighlighting: boolean
  /** 探针边界：tokenColors 指向 tmTheme plist 字符串路径时未解析（官方走 plist 解析器） */
  unsupportedPlistTokenColors: string[]
}

/** JSONC 宽松解析（主题/设置文件允许注释与尾逗号）：字符串感知地剥注释与尾逗码 */
export function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      // 字符串整体搬运（处理转义）
      out += ch
      i++
      while (i < n) {
        const c = text[i]
        out += c
        if (c === '\\' && i + 1 < n) {
          out += text[i + 1]
          i += 2
          continue
        }
        i++
        if (c === '"') {
          break
        }
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        i++
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        i++
      }
      i += 2
      continue
    }
    out += ch
    i++
  }
  // 尾逗号剥除：, 后（允许空白/注释已剥）紧跟 } 或 ]
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Color.fromHex 的归一化子集：#RGB/#RGBA/#RRGGBB/#RRGGBBAA → #rrggbbaa（小写） */
export function normalizeColorHex(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const v = value.trim()
  const hex = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(v)
  if (!hex) {
    return undefined
  }
  let digits = v.slice(1)
  if (digits.length === 3 || digits.length === 4) {
    digits = digits.split('').map((c) => c + c).join('')
  }
  return `#${digits.toLowerCase()}`
}

/**
 * 主题链加载（官方 _loadColorTheme 移植）：
 * include 递归先行；colors 覆盖式合并；tokenColors 追加式（own 在 include 之后）；
 * semanticHighlighting 为 OR 累计；tokenColors 字符串路径（tmTheme plist）记为探针不支持。
 */
export async function loadThemeChain(entryPath: string, readFile: ReadTextFile): Promise<LoadedTheme> {
  const result: LoadedTheme = {
    chain: [],
    colors: {},
    tokenColors: [],
    semanticRules: [],
    semanticHighlighting: false,
    unsupportedPlistTokenColors: [],
  }
  await loadInto(entryPath, result, readFile, 0)
  return result
}

async function loadInto(themePath: string, result: LoadedTheme, readFile: ReadTextFile, depth: number): Promise<void> {
  if (depth > 16) {
    throw new Error(`主题 include 链过深（>16），疑似环：${themePath}`)
  }
  const contentValue = JSON.parse(stripJsonc(await readFile(themePath)))
  if (typeof contentValue !== 'object' || contentValue === null) {
    throw new Error(`主题文件不是对象：${themePath}`)
  }
  const normalizedThemePath = themePath.replace(/[/\\]/g, '/')
  const dir = normalizedThemePath.slice(0, normalizedThemePath.lastIndexOf('/'))
  if (contentValue.include) {
    await loadInto(joinPath(dir, contentValue.include), result, readFile, depth + 1)
  }
  // 链按「实际加载顺序」记录（include 先行，own 后加载）
  result.chain.push(themePath)
  if (Array.isArray(contentValue.settings)) {
    // 旧式 tmTheme-in-json：首条无 scope 项为全局 editor 颜色
    convertLegacySettings(contentValue.settings, result)
    return
  }
  result.semanticHighlighting = result.semanticHighlighting || !!contentValue.semanticHighlighting
  const colors = contentValue.colors
  if (colors && typeof colors === 'object') {
    for (const colorId of Object.keys(colors)) {
      if (typeof colors[colorId] === 'string') {
        result.colors[colorId] = normalizeColorHex(colors[colorId]) ?? colors[colorId]
      }
    }
  }
  const tokenColors = contentValue.tokenColors
  if (Array.isArray(tokenColors)) {
    result.tokenColors.push(...tokenColors)
  } else if (typeof tokenColors === 'string') {
    result.unsupportedPlistTokenColors.push(joinPath(dir, tokenColors))
  }
  const semanticTokenColors = contentValue.semanticTokenColors
  if (semanticTokenColors && typeof semanticTokenColors === 'object') {
    for (const key of Object.keys(semanticTokenColors)) {
      const rule = readSemanticStyleRule(key, semanticTokenColors[key])
      if (rule) {
        result.semanticRules.push(rule)
      }
    }
  }
}

function convertLegacySettings(settings: Array<Record<string, unknown>>, result: LoadedTheme): void {
  for (const entry of settings) {
    const entrySettings = entry.settings as { foreground?: string; background?: string } | undefined
    if (!entrySettings) {
      continue
    }
    if (entry.scope) {
      result.tokenColors.push({ scope: entry.scope as string | string[], settings: entrySettings })
    } else {
      const fg = normalizeColorHex(entrySettings.foreground)
      const bg = normalizeColorHex(entrySettings.background)
      if (fg) {
        result.colors['editor.foreground'] = fg
      }
      if (bg) {
        result.colors['editor.background'] = bg
      }
    }
  }
}

function joinPath(dir: string, rel: string): string {
  const normalized = rel.replace(/[/\\]/g, '/')
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
    return rel
  }
  // 解析 ./ 与 ../ 段（include 路径常见 "./xxx.json" 写法）；保留 Windows
  // 盘符前缀（dir 形如 d:/x/y 时不得拼成 /d:/x/y —— 根相对路径会错位）
  const isWindowsDrive = /^[a-zA-Z]:\//.test(dir)
  const parts = `${dir}/${normalized}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  const joined = out.join('/')
  return isWindowsDrive ? joined : `/${joined}`
}

/** 主题身份解析（主题服务 autoDetect 语义复刻）：跟随系统深浅开启时，
 *  生效主题按深浅取 preferred 值而非 workbench.colorTheme 手选值——后者
 *  在跟随模式下保持历史值不随系统切换更新（2026-10 着色发灰根因：配置值
 *  ≠生效主题）。preferred 缺席或空串回退手选值，不产出空身份 */
export function resolveActiveThemeSettingsId(
  colorTheme: string,
  autoDetect: boolean,
  prefersDark: boolean,
  preferredDark: string | undefined,
  preferredLight: string | undefined,
): string {
  if (!autoDetect) {
    return colorTheme
  }
  const preferred = prefersDark ? preferredDark : preferredLight
  return typeof preferred === 'string' && preferred.length > 0 ? preferred : colorTheme
}

/** 主题默认前景补全链（原生 colorThemeData 同口径）：colors 段的
 *  editor.foreground 优先；缺席时取 tokenColors 无 scope 规则（主题默认
 *  token 色，dark_plus 类主题的正文色只定义在这里——直读 colors 会错拿
 *  #000000 兜底）；多条无 scope 规则后一条胜（include 先 own 后的追加覆
 *  盖序，与 textmate 引擎内同分覆盖同构） */
export function resolveDefaultForeground(colors: Record<string, string>, tokenColors: ThemedTokenRule[]): string {
  const explicit = colors['editor.foreground']
  if (explicit) {
    return explicit
  }
  let fallback = '#000000'
  for (const rule of tokenColors) {
    if (rule.scope) {
      continue
    }
    const fg = normalizeColorHex(rule.settings.foreground)
    if (fg) {
      fallback = fg
    }
  }
  return fallback
}

function readSemanticStyleRule(selectorString: string, settings: unknown): SemanticStyleRule | undefined {
  if (typeof settings === 'string') {
    const fg = normalizeColorHex(settings)
    return fg ? { selector: selectorString, foreground: fg } : undefined
  }
  if (settings && typeof settings === 'object') {
    const s = settings as { foreground?: string; fontStyle?: string }
    const fg = normalizeColorHex(s.foreground)
    if (fg || typeof s.fontStyle === 'string') {
      return { selector: selectorString, foreground: fg, fontStyle: s.fontStyle }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 用户自定义合并（官方 addCustomTokenColors / applyCustomizations 移植）

/** 官方 tokenGroupToScopesMap：分组自定义先行，textMateRules 覆盖分组 */
const TOKEN_GROUP_SCOPES: Record<string, string[]> = {
  comments: ['comment'],
  strings: ['string'],
  keywords: ['keyword'],
  numbers: ['constant.numeric'],
  types: ['entity.name.type', 'support.type'],
  functions: ['entity.name.function', 'support.function'],
  variables: ['variable'],
}

export interface TokenColorCustomizations {
  comments?: string | { foreground?: string }
  strings?: string | { foreground?: string }
  keywords?: string | { foreground?: string }
  numbers?: string | { foreground?: string }
  types?: string | { foreground?: string }
  functions?: string | { foreground?: string }
  variables?: string | { foreground?: string }
  textMateRules?: ThemedTokenRule[]
  [themeScoped: string]: unknown
}

export function buildCustomTokenRules(custom: TokenColorCustomizations | undefined): ThemedTokenRule[] {
  const rules: ThemedTokenRule[] = []
  if (!custom || typeof custom !== 'object') {
    return rules
  }
  // 分组自定义先行（官方注释：通用在前，具体 textMateRules 覆盖之）
  for (const group of Object.keys(TOKEN_GROUP_SCOPES)) {
    const value = custom[group]
    if (value) {
      const settings = typeof value === 'string' ? { foreground: normalizeColorHex(value) } : { foreground: normalizeColorHex((value as { foreground?: string }).foreground) }
      if (settings.foreground) {
        for (const scope of TOKEN_GROUP_SCOPES[group]) {
          rules.push({ scope, settings: { foreground: settings.foreground } })
        }
      }
    }
  }
  if (Array.isArray(custom.textMateRules)) {
    for (const rule of custom.textMateRules) {
      if (rule.scope && rule.settings) {
        rules.push({ scope: rule.scope, settings: { foreground: normalizeColorHex(rule.settings.foreground), fontStyle: rule.settings.fontStyle } })
      }
    }
  }
  return rules
}

/** editor.semanticTokenColorCustomizations：全局 rules + [主题 settingsId] 分组 */
export function pickSemanticCustomRules(custom: unknown, themeSettingsId: string): SemanticStyleRule[] {
  const out: SemanticStyleRule[] = []
  if (!custom || typeof custom !== 'object') {
    return out
  }
  const record = custom as Record<string, unknown>
  const collect = (section: unknown): void => {
    if (!section || typeof section !== 'object') {
      return
    }
    const sectionRecord = section as Record<string, unknown>
    const rules = (sectionRecord.rules ?? section) as Record<string, unknown>
    if (!rules || typeof rules !== 'object') {
      return
    }
    for (const key of Object.keys(rules)) {
      if (key === 'enabled') {
        continue
      }
      const rule = readSemanticStyleRule(key, rules[key])
      if (rule) {
        out.push(rule)
      }
    }
  }
  collect(record.rules)
  const scoped = record[`[${themeSettingsId}]`]
  if (scoped && typeof scoped === 'object') {
    collect(scoped)
  }
  return out
}

// ---------------------------------------------------------------------------
// 语义选择器（官方 parseClassifierString + TokenSelector.match 移植）

export interface SemanticSelectorParts {
  type: string
  modifiers: string[]
  language?: string
}

export function parseClassifierString(s: string): SemanticSelectorParts {
  const CHAR_LANGUAGE = ':'.charCodeAt(0)
  const CHAR_MODIFIER = '.'.charCodeAt(0)
  let k = s.length
  let language: string | undefined
  const modifiers: string[] = []
  for (let i = k - 1; i >= 0; i--) {
    const ch = s.charCodeAt(i)
    if (ch === CHAR_LANGUAGE || ch === CHAR_MODIFIER) {
      const segment = s.substring(i + 1, k)
      k = i
      if (ch === CHAR_LANGUAGE) {
        language = segment
      } else {
        modifiers.push(segment)
      }
    }
  }
  return { type: s.substring(0, k), modifiers, language }
}

/** 默认注册表的 superType 图（1.82.3 仅 member→method） */
const TYPE_HIERARCHY_SUPER: Record<string, string> = {
  member: 'method',
}

function typeHierarchy(type: string): string[] {
  // 官方 getTypeHierarchy：自身 + 祖先链
  const out = [type]
  let current = type
  while (TYPE_HIERARCHY_SUPER[current]) {
    current = TYPE_HIERARCHY_SUPER[current]
    out.push(current)
  }
  return out
}

export function matchSemanticSelector(selector: SemanticSelectorParts, type: string, modifiers: string[], language: string): number {
  let score = 0
  if (selector.language !== undefined) {
    if (selector.language !== language) {
      return -1
    }
    score += 10
  }
  if (selector.type !== '*') {
    const hierarchy = typeHierarchy(type)
    const level = hierarchy.indexOf(selector.type)
    if (level === -1) {
      return -1
    }
    score += 100 - level
  }
  for (const selectorModifier of selector.modifiers) {
    if (!modifiers.includes(selectorModifier)) {
      return -1
    }
  }
  return score + selector.modifiers.length * 100
}

/** 默认注册表的语义类型 → TM scopesToProbe（回退到 TM 层时用） */
export const SEMANTIC_TYPE_PROBE_SCOPES: Record<string, string[][]> = {
  comment: [['comment']],
  string: [['string']],
  keyword: [['keyword.control']],
  number: [['constant.numeric']],
  regexp: [['constant.regexp']],
  operator: [['keyword.operator']],
  namespace: [['entity.name.namespace']],
  type: [['entity.name.type'], ['support.type']],
  struct: [['entity.name.type.struct']],
  class: [['entity.name.type.class'], ['support.class']],
  interface: [['entity.name.type.interface']],
  enum: [['entity.name.type.enum']],
  typeParameter: [['entity.name.type.parameter']],
  function: [['entity.name.function'], ['support.function']],
  method: [['entity.name.function.member'], ['support.function']],
  macro: [['entity.name.function.preprocessor']],
  variable: [['variable.other.readwrite'], ['entity.name.variable']],
  parameter: [['variable.parameter']],
  property: [['variable.other.property']],
  enumMember: [['variable.other.enummember']],
  event: [['variable.other.event']],
  decorator: [['entity.name.decorator'], ['entity.name.function']],
}

// ---------------------------------------------------------------------------
// 端到端颜色解析

export interface ThemePipelineInput {
  theme: LoadedTheme
  customTokenRules: ThemedTokenRule[]
  themeSemanticRules: SemanticStyleRule[]
  customSemanticRules: SemanticStyleRule[]
}

export interface TokenColorOutcome {
  color: string
  layer: 'semantic-custom' | 'semantic-theme' | 'semantic-probe-tm' | 'textmate' | 'fallback-foreground'
  matchedSelector?: string
}

/** 语义样式解析：用户自定义 > 主题规则 > 语义默认（probe TM scopes）> undefined（回退 TM 层） */
export function resolveSemanticColor(
  input: ThemePipelineInput,
  tokenType: string,
  modifiers: string[],
  languageId: string,
): TokenColorOutcome | undefined {
  const layers: Array<{ layer: TokenColorOutcome['layer']; rules: SemanticStyleRule[] }> = [
    { layer: 'semantic-custom', rules: input.customSemanticRules },
    { layer: 'semantic-theme', rules: input.themeSemanticRules },
  ]
  for (const { layer, rules } of layers) {
    let best: { score: number; rule: SemanticStyleRule } | undefined
    for (const rule of rules) {
      const score = matchSemanticSelector(parseClassifierString(rule.selector), tokenType, modifiers, languageId)
      if (score >= 0 && rule.foreground && (!best || score >= best.score)) {
        best = { score, rule }
      }
    }
    if (best && best.rule.foreground) {
      return { color: best.rule.foreground, layer, matchedSelector: best.rule.selector }
    }
  }
  // 语义默认：按默认注册表 scopesToProbe 回退解析 TM 规则
  const probeScopes = SEMANTIC_TYPE_PROBE_SCOPES[tokenType]
  if (probeScopes) {
    const style = resolveTokenStyle(probeScopes, [
      { source: 'theme', rules: input.theme.tokenColors },
      { source: 'custom', rules: input.customTokenRules },
    ])
    if (style?.foreground) {
      return { color: style.foreground, layer: 'semantic-probe-tm', matchedSelector: style.matchedScope }
    }
  }
  return undefined
}

/** TM token 颜色：规则未命中时回退 editor.foreground（原生同口径） */
export function resolveTextMateColor(input: ThemePipelineInput, scopeStack: string[]): TokenColorOutcome {
  const style: ResolvedTokenStyle | undefined = resolveTokenStyle([scopeStack], [
    { source: 'theme', rules: input.theme.tokenColors },
    { source: 'custom', rules: input.customTokenRules },
  ])
  if (style?.foreground) {
    return { color: style.foreground, layer: 'textmate', matchedSelector: style.matchedScope }
  }
  return { color: input.theme.colors['editor.foreground'] ?? '#000000', layer: 'fallback-foreground' }
}
