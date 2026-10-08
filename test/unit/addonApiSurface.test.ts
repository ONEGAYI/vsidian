// #362 T13 公开声明消费面的防回潮契约：
// 1. 消费编译文件（test/addonApi/publicApiConsumer.ts）只从公开事实源模块
//    导入——内部控制器（src/webview、src/host 其余模块）不得被当 SDK 消费；
//    宿主导出面（addonWiring/addonRegistry）仅允许 type-only 导入（它们
//    import vscode，值导入会引入内部装配依赖）。
// 2. 开发文档不随 Vsidian VSIX 分发（ADR-0012「文档分发」）：.vscodeignore
//    须排除 docs/ 与 scripts/（生成器与指南留在仓库，不进包）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(process.cwd())
const consumerPath = path.join(root, 'test', 'addonApi', 'publicApiConsumer.ts')

/** 消费面允许值导入的公开模块（shared 层不含 vscode/DOM 依赖） */
const VALUE_IMPORT_ALLOWED = new Set([
  'src/shared/addonIdentity',
  'src/shared/addonApiCatalog',
  'src/shared/addonPage',
  'src/shared/addonEditApi',
  'src/shared/addonBehaviors',
  'src/shared/addonSettings',
  'src/shared/addonStorage',
  'src/shared/addonRenderers',
  'src/shared/addonCommands',
  'src/shared/addonUi',
  'src/shared/officialAddons',
])

/** 仅允许 type-only 导入的模块（宿主导出面声明——import vscode） */
const TYPE_ONLY_IMPORT_ALLOWED = new Set([
  'src/host/addons/addonWiring',
  'src/host/addons/addonRegistry',
])

interface ConsumedImport {
  /** 解析为仓库相对路径（正斜杠、去 ../test 前缀后的 src 路径；相对导入） */
  resolved: string
  typeOnly: boolean
}

function listConsumerImports(): ConsumedImport[] {
  const source = readFileSync(consumerPath, 'utf8')
  const sf = ts.createSourceFile(consumerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: ConsumedImport[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text
      if (!spec.startsWith('.')) {
        throw new Error(`消费面出现非相对导入 '${spec}'（公开声明消费只走仓库内模块）`)
      }
      const abs = path.posix.normalize(
        path.posix.join('test/addonApi', path.posix.dirname(spec), path.posix.basename(spec)),
      )
      const resolved = abs.replace(/^\.\//, '')
      out.push({ resolved, typeOnly: node.importClause?.isTypeOnly === true })
    }
    node.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return out
}

describe('附加组件公开声明消费面（T13）', () => {
  it('消费面导入的模块全部在公开白名单内（内部控制器不作 SDK）', () => {
    const imports = listConsumerImports()
    expect(imports.length).toBeGreaterThan(0)
    for (const imp of imports) {
      const allowed =
        VALUE_IMPORT_ALLOWED.has(imp.resolved) || TYPE_ONLY_IMPORT_ALLOWED.has(imp.resolved)
      expect(allowed, `消费面导入了非公开模块 ${imp.resolved}`).toBe(true)
    }
  })

  it('宿主导出面模块仅 type-only 导入（不引入运行时装配依赖）', () => {
    for (const imp of listConsumerImports()) {
      if (TYPE_ONLY_IMPORT_ALLOWED.has(imp.resolved)) {
        expect(imp.typeOnly, `${imp.resolved} 必须以 import type 消费`).toBe(true)
      }
    }
  })

  it('开发文档与生成器不进 Vsidian VSIX（.vscodeignore 排除 docs 与 scripts）', () => {
    const ignore = readFileSync(path.join(root, '.vscodeignore'), 'utf8')
    for (const pattern of ['docs/', 'scripts/', 'src/', 'test/']) {
      expect(ignore, `.vscodeignore 缺少排除模式 ${pattern}`).toContain(pattern)
    }
  })

  it('语义清单与台账事实源不在 CJK 扫描白名单外裸奔（豁免已登记）', async () => {
    const { SCAN_EXCLUDED_PREFIXES } = await import('./i18nScan')
    expect(
      (SCAN_EXCLUDED_PREFIXES as readonly string[]).includes('src/shared/addonApiCatalog.ts'),
      'addonApiCatalog.ts 是文档数据源，须登记 CJK 扫描豁免（同 styleContract.ts 先例）',
    ).toBe(true)
  })
})
