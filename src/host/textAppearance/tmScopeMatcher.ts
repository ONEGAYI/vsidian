// TextMate scope 选择器匹配器（纯逻辑）。
// #335 探针建立、#340（P3-08）转入生产；不 import vscode，可被单测直接覆盖。
// 逐段移植自 VSCode 1.82.3 官方实现（保证解析口径与宿主一致，来源：
// src/vs/workbench/services/themes/common/textMateScopeMatcher.ts 与
// src/vs/workbench/services/themes/common/colorThemeData.ts 的
// nameMatcher / scopesAreMatching / resolveScopes）。

/** 一条主题 token 颜色规则（tokenColors 数组元素） */
export interface ThemedTokenRule {
  scope?: string | string[]
  settings: {
    foreground?: string
    background?: string
    fontStyle?: string
  }
}

/** 匹配器：输入 scope 栈（浅→深），返回非负得分或 -1（不匹配） */
type ScopeStackMatcher = (scopeStack: string[]) => number

const noMatch: ScopeStackMatcher = () => -1

/** token 化器：官方正则逐字符还原（含 L:/R: 优先级前缀） */
function newTokenizer(input: string): { next: () => string | null } {
  const regex = /([LR]:|[\w\.:][\w\.:\-]*|[\,\|\-\(\)])/g
  let match = regex.exec(input)
  return {
    next: () => {
      if (!match) {
        return null
      }
      const res = match[0]
      match = regex.exec(input)
      return res
    },
  }
}

function isIdentifier(token: string | null): token is string {
  return !!token && !!token.match(/[\w\.:]+/)
}

function scopesAreMatching(thisScopeName: string, scopeName: string): boolean {
  if (!thisScopeName) {
    return false
  }
  if (thisScopeName === scopeName) {
    return true
  }
  const len = scopeName.length
  return thisScopeName.length > len && thisScopeName.substr(0, len) === scopeName && thisScopeName[len] === '.'
}

/** 官方 nameMatcher：最后一个 scope 匹配选择器最右标识符，其余 scope 自深向浅匹配 */
function nameMatcher(identifiers: string[], scopeStack: string[]): number {
  function findInIdents(s: string, lastIdent: number): number {
    for (let i = lastIdent - 1; i >= 0; i--) {
      if (scopesAreMatching(s, identifiers[i])) {
        return i
      }
    }
    return -1
  }
  if (scopeStack.length < identifiers.length) {
    return -1
  }
  let lastScopeIndex = scopeStack.length - 1
  let lastIdentifierIndex = findInIdents(scopeStack[lastScopeIndex--], identifiers.length)
  if (lastIdentifierIndex >= 0) {
    const score = (lastIdentifierIndex + 1) * 0x10000 + identifiers[lastIdentifierIndex].length
    while (lastScopeIndex >= 0) {
      lastIdentifierIndex = findInIdents(scopeStack[lastScopeIndex--], lastIdentifierIndex)
      if (lastIdentifierIndex === -1) {
        return -1
      }
    }
    return score
  }
  return -1
}

/** 官方 createMatchers：逗号分隔的合取选择器列表（含 -、()、| 支持） */
function createMatchers(selector: string, results: ScopeStackMatcher[]): void {
  const tokenizer = newTokenizer(selector)
  let token = tokenizer.next()
  while (token !== null) {
    if (token.length === 2 && token.charAt(1) === ':') {
      // L:/R: 优先级前缀在 colorThemeData 的调用路径未参与计分（getScopeMatcher
      // 只取各 matcher 的 max），此处同样忽略并继续读下一个 token
      token = tokenizer.next()
    }
    const matcher = parseConjunction()
    if (matcher) {
      results.push(matcher)
    }
    if (token !== ',') {
      break
    }
    token = tokenizer.next()

    function parseOperand(): ScopeStackMatcher | null {
      if (token === '-') {
        token = tokenizer.next()
        const expressionToNegate = parseOperand()
        if (!expressionToNegate) {
          return null
        }
        return (matcherInput) => {
          const score = expressionToNegate(matcherInput)
          return score < 0 ? 0 : -1
        }
      }
      if (token === '(') {
        token = tokenizer.next()
        const expressionInParents = parseInnerExpression()
        if (token === ')') {
          token = tokenizer.next()
        }
        return expressionInParents
      }
      if (isIdentifier(token)) {
        const identifiers: string[] = []
        do {
          identifiers.push(token)
          token = tokenizer.next()
        } while (isIdentifier(token))
        return (matcherInput) => nameMatcher(identifiers, matcherInput)
      }
      return null
    }
    function parseConjunction(): ScopeStackMatcher | null {
      let matcher = parseOperand()
      if (!matcher) {
        return null
      }
      const matchers: ScopeStackMatcher[] = []
      while (matcher) {
        matchers.push(matcher)
        matcher = parseOperand()
      }
      return (matcherInput) => {
        let min = matchers[0](matcherInput)
        for (let i = 1; min >= 0 && i < matchers.length; i++) {
          min = Math.min(min, matchers[i](matcherInput))
        }
        return min
      }
    }
    function parseInnerExpression(): ScopeStackMatcher | null {
      let matcher = parseConjunction()
      if (!matcher) {
        return null
      }
      const matchers: ScopeStackMatcher[] = []
      while (matcher) {
        matchers.push(matcher)
        if (token === '|' || token === ',') {
          do {
            token = tokenizer.next()
          } while (token === '|' || token === ',')
        } else {
          break
        }
        matcher = parseConjunction()
      }
      return (matcherInput) => {
        let max = matchers[0](matcherInput)
        for (let i = 1; i < matchers.length; i++) {
          max = Math.max(max, matchers[i](matcherInput))
        }
        return max
      }
    }
  }
}

/** 官方 getScopeMatcher：scope 可为数组（多等价写法），取各选择器最大分 */
function getScopeMatcher(rule: ThemedTokenRule): ScopeStackMatcher {
  const ruleScope = rule.scope
  if (!ruleScope || !rule.settings) {
    return noMatch
  }
  const matchers: ScopeStackMatcher[] = []
  if (Array.isArray(ruleScope)) {
    for (const rs of ruleScope) {
      createMatchers(rs, matchers)
    }
  } else {
    createMatchers(ruleScope, matchers)
  }
  if (matchers.length === 0) {
    return noMatch
  }
  return (scopeStack) => {
    let max = matchers[0](scopeStack)
    for (let i = 1; i < matchers.length; i++) {
      max = Math.max(max, matchers[i](scopeStack))
    }
    return max
  }
}

export interface ResolvedTokenStyle {
  foreground?: string
  fontStyle?: string
  /** 命中规则的来源标记，供证据表回溯 */
  source: 'theme' | 'custom' | 'default'
  /** 命中规则在选择器文本（回溯用） */
  matchedScope?: string
}

/**
 * 官方 resolveScopes 单栈语义的移植：按序扫描规则，`score >= best` 使
 * 后规则在同分时覆盖（theme 在前、custom 在后 ⇒ 用户自定义覆盖主题）；
 * 输入为候选 scope 栈列表（语义默认回退时为多个候选，取首个产出样式的栈）。
 */
export function resolveTokenStyle(scopeStacks: string[][], rulesBySource: Array<{ source: 'theme' | 'custom'; rules: ThemedTokenRule[] }>): ResolvedTokenStyle | undefined {
  for (const scopeStack of scopeStacks) {
    let foreground: string | undefined
    let fontStyle: string | undefined
    let foregroundScore = -1
    let fontStyleScore = -1
    let source: 'theme' | 'custom' = 'theme'
    let matchedScope: string | undefined
    for (const { source: ruleSource, rules } of rulesBySource) {
      for (let i = 0; i < rules.length; i++) {
        const matcher = getScopeMatcher(rules[i])
        const score = matcher(scopeStack)
        if (score >= 0) {
          const settings = rules[i].settings
          if (score >= foregroundScore && settings.foreground) {
            foreground = settings.foreground
            foregroundScore = score
            source = ruleSource
            const ruleScope = rules[i].scope
            matchedScope = Array.isArray(ruleScope) ? ruleScope.join('|') : ruleScope
          }
          if (score >= fontStyleScore && typeof settings.fontStyle === 'string') {
            fontStyle = settings.fontStyle
            fontStyleScore = score
          }
        }
      }
    }
    if (foreground !== undefined || fontStyle !== undefined) {
      return { foreground, fontStyle, source, matchedScope }
    }
  }
  return undefined
}
