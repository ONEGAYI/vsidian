// i18n 防回潮扫描器（#93；#101 语义升级）：TypeScript AST 扫描源码字符
// 串字面量中的 CJK 统一表意文字（U+4E00–U+9FFF）。本模块是扫描实现
// （非测试文件），供 i18nNoHardcodedCjk.test.ts 契约与白名单再生使用。
//
// 扫描范围：src/webview、src/host、src/shared（排除 src/shared/locales——
// 字典本身是中文数据的唯一合法居所）与 src/extension.ts；test/ 不扫。
// 豁免（开发面文案，规格「防回潮纪律」，口径为「console.* 调用参数」）：
// - console.* 调用、throw 语句与 new Error(...) 的**直接参数子树**内且
//   不跨函数边界的字面量（判定走祖先链，字面量上行进入函数节点即停：
//   闭包内的延迟求值不属于任何外层调用的参数，不再豁免）；
// - 「console 转发 helper」调用点直通参数：局部函数的某参数在函数体内
//   只流向 console.* 调用参数子树（单文件、单层、直接数据流，见
//   buildForwardingIndex），调用点传给该参数位的字面量视同 console 文案。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** 扫描范围（仓库相对路径；目录递归、文件精确） */
export const SCAN_ROOTS = ['src/webview', 'src/host', 'src/shared', 'src/extension.ts'] as const

/** 范围内但豁免的路径前缀：
 *  - 字典目录是语言数据源，不是 UI 硬编码；
 *  - styleContract.ts 是公开样式契约清单（#132）——条目文案即用户指南的
 *    文档数据源（语言随仓库文档惯例中文为准），不是界面文案，且绝不进
 *    webview bundle（发射侧只引 obsidianAlias） */
export const SCAN_EXCLUDED_PREFIXES = [
  'src/shared/locales/',
  // 公开样式契约清单与其生成数据（#132）：指南文档数据源，不是 UI 文案
  'src/shared/styleContract.ts',
  'src/webview/styleGuideData.ts',
] as const

const CJK_RE = /[\u4e00-\u9fff]/

export interface CjkViolation {
  /** 仓库相对路径，正斜杠 */
  file: string
  /** 违规字面量原文 */
  literal: string
  /** 1 基行号 */
  line: number
}

export function scanSourceCjkLiterals(source: string, fileName: string): CjkViolation[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const forwarding = buildForwardingIndex(sf)
  const violations: CjkViolation[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CJK_RE.test(node.text) &&
      !isExempt(node) &&
      !isForwardingCallArgument(node, forwarding)
    ) {
      violations.push({
        file: fileName,
        literal: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      })
    }
    node.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return violations
}

/** console.* 属性调用判定（直接豁免与转发识别共用） */
function isConsoleCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'console'
  )
}

/** new Error(...) 判定 */
function isNewErrorExpression(node: ts.Node): boolean {
  return ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Error'
}

/** 豁免判定：祖先链上有 console.* 调用 / throw / new Error 即为开发面
 * 文案；上行在函数边界停止——规格口径是「console.* 调用参数」，字面量
 * 进入函数节点后即不属于任何外层调用的参数子树（闭包内延迟求值不豁免）。
 * 命中顺序保证 throw/new Error/console 在函数边界前判定：直通参数的
 * 豁免祖先总在最近的函数节点之内。 */
function isExempt(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isThrowStatement(current)) {
      return true
    }
    if (isNewErrorExpression(current)) {
      return true
    }
    if (isConsoleCall(current)) {
      return true
    }
    if (ts.isFunctionLike(current)) {
      return false
    }
    current = current.parent
  }
  return false
}

/** 标识符是否处于「非引用」语法位（作为属性名/限定名出现，不构成数据流） */
function isNonReferencePosition(node: ts.Identifier): boolean {
  const p = node.parent
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true
  if (ts.isQualifiedName(p) && p.right === node) return true
  if (ts.isPropertyAssignment(p) && p.name === node) return true
  if (ts.isPropertySignature(p) && p.name === node) return true
  return false
}

/** 标识符出现是否为写目标（再赋值：=、复合赋值、++/--） */
function isWriteTarget(node: ts.Identifier): boolean {
  const p = node.parent
  if (
    (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
    (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true
  }
  if (ts.isBinaryExpression(p) && p.left === node) {
    const kind = p.operatorToken.kind
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
  }
  return false
}

/** 参数引用是否流向 console.* 参数子树：上行遇到的第一个调用必须是
 * console.*（中途流入其他调用视为逃逸）；出函数边界（返回值、普通语句
 * 位等未遇调用）同样视为逃逸。 */
function paramRefFlowsToConsole(ref: ts.Identifier): boolean {
  let current: ts.Node | undefined = ref.parent
  while (current && !ts.isFunctionLike(current)) {
    if (ts.isCallExpression(current)) {
      return isConsoleCall(current)
    }
    current = current.parent
  }
  return false
}

/** 判定函数参数是否为「console 转发参数」：函数体内该标识符至少出现一
 * 次，且每一次出现都只流向 console.* 调用参数子树——无再赋值、无逃逸、
 * 无嵌套闭包内的出现（嵌套函数内同名一律放弃，不区分真引用与遮蔽）。 */
function isConsoleForwardingParam(fn: ts.FunctionLikeDeclaration, paramName: string): boolean {
  const body = fn.body
  if (!body) return false
  let used = false
  let failed = false
  const walk = (node: ts.Node, nested: boolean): void => {
    if (ts.isIdentifier(node) && node.text === paramName && !isNonReferencePosition(node)) {
      used = true
      if (nested || isWriteTarget(node) || !paramRefFlowsToConsole(node)) {
        failed = true
      }
      return
    }
    const childNested = nested || ts.isFunctionLike(node)
    node.forEachChild((child) => walk(child, childNested))
  }
  walk(body, false)
  return used && !failed
}

/** 单文件「console 转发 helper」索引：函数名 → 各参数位是否转发（同名
 * 多函数视为歧义 null，调用点一律不豁免）。只登记具名 FunctionDeclaration
 * 与 const/let 绑定的箭头函数/函数表达式（声明在调用点按名匹配，不做
 * 作用域解析）。跨文件转发、多层链式转发不在识别范围。 */
interface ForwardingIndex {
  byName: Map<string, readonly boolean[] | null>
}

function buildForwardingIndex(sf: ts.SourceFile): ForwardingIndex {
  const byName = new Map<string, readonly boolean[] | null>()
  const declare = (name: string, paramFlags: readonly boolean[]): void => {
    byName.set(name, byName.has(name) ? null : paramFlags)
  }
  const paramFlagsOf = (fn: ts.FunctionLikeDeclaration): readonly boolean[] =>
    fn.parameters.map((param) =>
      ts.isIdentifier(param.name) ? isConsoleForwardingParam(fn, param.name.text) : false,
    )
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      declare(node.name.text, paramFlagsOf(node))
    } else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      const decl = node.parent
      if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
        declare(decl.name.text, paramFlagsOf(node))
      }
    }
    node.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return { byName }
}

/** 字面量是否为「console 转发 helper」调用的直通参数：沿表达式包装层
 * （括号、条件表达式分支）上行落在某个调用的 argument 位，被调函数为
 * 本文件内具名转发 helper 且该参数位已标记转发。 */
function isForwardingCallArgument(
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
  index: ForwardingIndex,
): boolean {
  let current: ts.Expression = node
  let parent: ts.Node | undefined = node.parent
  while (parent && !ts.isFunctionLike(parent)) {
    if (ts.isCallExpression(parent)) {
      if (!parent.arguments.includes(current)) return false
      if (!ts.isIdentifier(parent.expression)) return false
      const flags = index.byName.get(parent.expression.text)
      if (!flags) return false
      const argIndex = parent.arguments.indexOf(current)
      return argIndex >= 0 && flags[argIndex] === true
    }
    if (ts.isParenthesizedExpression(parent) || ts.isConditionalExpression(parent)) {
      current = parent
      parent = parent.parent
      continue
    }
    return false
  }
  return false
}

/** 枚举扫描范围内全部 .ts 文件（仓库相对路径，正斜杠，字典序） */
export function listScanFiles(repoRoot: string): string[] {
  const out: string[] = []
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir).sort()) {
      const abs = path.join(absDir, entry)
      const rel = `${relDir}/${entry}`
      if (statSync(abs).isDirectory()) {
        walk(abs, rel)
      } else if (entry.endsWith('.ts')) {
        out.push(rel)
      }
    }
  }
  for (const root of SCAN_ROOTS) {
    const abs = path.join(repoRoot, root)
    if (!statSync(abs).isDirectory()) {
      if (root.endsWith('.ts')) {
        out.push(root)
      }
      continue
    }
    walk(abs, root)
  }
  return out.filter((rel) => !SCAN_EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))).sort()
}

/** 全仓扫描：返回范围内全部非豁免 CJK 字面量违规 */
export function scanRepoCjk(repoRoot: string): CjkViolation[] {
  const violations: CjkViolation[] = []
  for (const rel of listScanFiles(repoRoot)) {
    const source = readFileSync(path.join(repoRoot, rel), 'utf8')
    violations.push(...scanSourceCjkLiterals(source, rel))
  }
  return violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
}
