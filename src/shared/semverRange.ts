// semver 范围子集求值（#350 T01 附加组件兼容判定）。
//
// 只实现身份声明 `api: "^1.0.0"` 语义所需的操作符子集：精确（`=` 或裸
// 版本）、`^`、`~`、`>`、`>=`、`<`、`<=`、`*`，以及空格分隔的 AND 组合
// （OR `||` 与连字符区间不支持——声明侧用不到，遇见判非法）。
// 非法输入一律 false / undefined，不抛出（清单是不可信输入）。
//
// 该模块不引入 semver 依赖：宿主 bundle 保持零新增依赖，规则子集有
// 单元契约测试钉住（test/unit/addonIdentity.test.ts）。

interface Semver {
  major: number
  minor: number
  patch: number
}

function parseVersion(value: string): Semver | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim())
  if (!match) {
    return undefined
  }
  return {
    major: Number(match[1]),
    minor: match[2] !== undefined ? Number(match[2]) : 0,
    patch: match[3] !== undefined ? Number(match[3]) : 0,
  }
}

function compare(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

type Comparator = '=' | '^' | '~' | '>' | '>=' | '<' | '<=' | '*'

interface RangePart {
  comparator: Comparator
  version: Semver
}

/** 解析单段范围（如 '^1.2.3'）；非法返回 undefined */
function parseRangePart(part: string): RangePart | undefined {
  const token = part.trim()
  if (token === '*' || token === '') {
    return { comparator: '*', version: { major: 0, minor: 0, patch: 0 } }
  }
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?(?:\.\d+)?)$/.exec(token)
  if (!match) {
    return undefined
  }
  const version = parseVersion(match[2])
  if (!version) {
    return undefined
  }
  const comparator = (match[1] ?? '=') as Comparator
  return { comparator, version }
}

function matches(part: RangePart, version: Semver): boolean {
  switch (part.comparator) {
    case '*':
      return true
    case '=':
      return compare(version, part.version) === 0
    case '>':
      return compare(version, part.version) > 0
    case '>=':
      return compare(version, part.version) >= 0
    case '<':
      return compare(version, part.version) < 0
    case '<=':
      return compare(version, part.version) <= 0
    case '~': {
      // 同 minor 内：>=x.y.z 且 <x.(y+1).0
      if (compare(version, part.version) < 0) return false
      return version.major === part.version.major && version.minor === part.version.minor
    }
    case '^': {
      // 兼容区间：左主版本 > 0 时 <(major+1).0.0；左主版本 = 0 且 minor > 0
      // 时 <0.(minor+1).0；0.0.z 时精确匹配 0.0.z
      if (compare(version, part.version) < 0) return false
      if (part.version.major > 0) return version.major === part.version.major
      if (part.version.minor > 0) {
        return version.major === 0 && version.minor === part.version.minor
      }
      return compare(version, part.version) === 0
    }
  }
}

/**
 * 判定版本是否满足范围（AND 组合须全部满足）。范围或版本非法一律 false。
 */
export function satisfiesSemverRange(range: string, version: string): boolean {
  const parsedVersion = parseVersion(version)
  if (!parsedVersion) {
    return false
  }
  const parts = parseSemverRangeOrUndefined(range)
  if (!parts) {
    return false
  }
  return parts.every((part) => matches(part, parsedVersion))
}

/** 解析整条范围（空格 AND 组合）；任一段非法则整条非法（undefined） */
export function parseSemverRangeOrUndefined(range: string): readonly RangePart[] | undefined {
  const parts = range.trim().split(/\s+/).filter((token) => token.length > 0)
  if (!parts.length) {
    return undefined
  }
  const parsed: RangePart[] = []
  for (const part of parts) {
    const result = parseRangePart(part)
    if (!result) {
      return undefined
    }
    parsed.push(result)
  }
  return parsed
}

/** 范围可解析性（声明校验用：可解析但可能不匹配任何宿主版本） */
export function isValidSemverRange(range: string): boolean {
  return parseSemverRangeOrUndefined(range) !== undefined
}
