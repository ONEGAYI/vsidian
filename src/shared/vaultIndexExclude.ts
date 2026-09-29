// 索引排除模式纯逻辑（工单 #198）：glob 匹配语义、模式清洗与默认值的
// 单一事实源。宿主服务（扫描过滤）与 vscode 壳（设置页接线）共用本模块，
// 不在两侧重复实现匹配规则。
//
// 语义约定（#194「生命周期与设置」；docs/specs/vault-index-backlinks.md）：
// - 模式对**根内相对路径**（`/` 形态、无前导斜杠）求值；
// - 通配符子集：`**` 跨任意层目录、`*` 与 `?` 不跨 `/`，其余字符按字面量
//   （正则特殊字符转义）；不支持花括号展开与字符类；
// - 无通配符的模式按**目录前缀**语义：命中路径的某个祖先目录段即排除
//   其整个子树（用户写 `drafts` 即排除 drafts/ 下全部文件）；
// - 默认模式 `**/.git/**` 与 `**/node_modules/**`；**不继承** VSCode 搜索
//   排除（search.exclude）与 .gitignore——两者都不读取、不合并；
// - 被排除的路径不参与扫描与解析；被显式引用的排除位置目标仍登记
//   （登记语义在 vaultIndexService 的 missed-stat 路径，本模块只管匹配）。
//
// 本模块零 vscode / node 专属依赖（vitest 直测）。

/** 默认排除模式（#194 实施初值；设置页「恢复默认」的目标值） */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = ['**/.git/**', '**/node_modules/**']

/** 单个模式长度上限（防超长字符串进存储与消息） */
export const EXCLUDE_PATTERN_MAX_LENGTH = 256

/** 模式数量上限（溢出部分判非法，不静默丢弃） */
export const EXCLUDE_PATTERN_MAX_COUNT = 64

/** glob → 正则源串：通配符子集翻译，其余字符字面量化 */
export function globToRegExpSource(pattern: string): string {
  let re = '^'
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // 连续星号整体视为一个 **（*** 同 **）
        let j = i + 2
        while (pattern[j] === '*') {
          j++
        }
        if (pattern[j] === '/') {
          // `**/`：任意层目录前缀（可为零层）
          re += '(?:.*/)?'
          j++
        } else {
          // 尾部或中段孤立 `**`：任意字符（含 /）
          re += '.*'
        }
        i = j
      } else {
        re += '[^/]*'
        i++
      }
    } else if (c === '?') {
      re += '[^/]'
      i++
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return `${re}$`
}

/** 编译后的排除匹配器（test 输入根内相对路径；反斜杠形态归一后求值） */
export interface ExcludeMatcher {
  test(relPath: string): boolean
  /** 参与编译的模式清单（清洗后形态） */
  readonly patterns: readonly string[]
}

/**
 * 编译排除模式集合。foldCase 为 true 时大小写不敏感（Windows 宿主语义）；
 * 空模式集合产出恒 false 的匹配器（「不排除任何路径」）。
 */
export function compileExcludeMatcher(
  patterns: readonly string[],
  opts: { foldCase?: boolean } = {},
): ExcludeMatcher {
  const flags = opts.foldCase ? 'i' : undefined
  const regexes = patterns.map((p) => new RegExp(globToRegExpSource(p), flags))
  return {
    patterns,
    test(relPath: string): boolean {
      const rel = relPath.replace(/\\/g, '/').replace(/^\//, '')
      if (regexes.some((re) => re.test(rel))) {
        return true
      }
      // 目录前缀语义：命中任一祖先目录段（无通配符模式的主路径）
      for (let idx = rel.indexOf('/'); idx >= 0; idx = rel.indexOf('/', idx + 1)) {
        const dir = rel.slice(0, idx)
        if (regexes.some((re) => re.test(dir))) {
          return true
        }
      }
      return false
    },
  }
}

/** 模式清洗结果：合法模式（保序去重去空白）+ 非法项（供设置页回显） */
export interface SanitizedExcludePatterns {
  patterns: string[]
  invalid: string[]
}

/**
 * 清洗用户输入的排除模式列表：逐项 trim、空项静默丢弃、超长判非法、
 * 保序去重、超过数量上限的多余项判非法。非数组输入返回空清单
 * （调用方据此回落默认值，不在此隐藏回退逻辑）。
 */
export function sanitizeExcludePatterns(input: unknown): SanitizedExcludePatterns {
  if (!Array.isArray(input)) {
    return { patterns: [], invalid: [] }
  }
  const patterns: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') {
      continue // 非字符串项忽略（历史遗留容错，不进 invalid）
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      continue // 空行是列表编辑的正常产物，静默丢弃
    }
    if (trimmed.length > EXCLUDE_PATTERN_MAX_LENGTH || patterns.length >= EXCLUDE_PATTERN_MAX_COUNT) {
      invalid.push(trimmed)
      continue
    }
    if (seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    patterns.push(trimmed)
  }
  return { patterns, invalid }
}
