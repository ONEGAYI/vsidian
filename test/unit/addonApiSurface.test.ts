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
  'src/shared/addonThemes',
  'src/shared/addonIdentity',
  'src/shared/addonApiCatalog',
  'src/shared/addonPage',
  'src/shared/addonEditApi',
  'src/shared/addonNavApi',
  'src/shared/addonFoldApi',
  'src/shared/addonSyntaxApi',
  'src/shared/addonHostSettingsApi',
  'src/shared/addonBehaviors',
  'src/shared/addonSettings',
  'src/shared/addonStorage',
  'src/shared/addonRenderers',
  'src/shared/addonCommands',
  'src/shared/addonUi',
  'src/shared/addonPasteRules',
  'src/shared/addonRefViews',
  'src/shared/addonSettingsContextApi',
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

  it('#464 行为名多语言形态已进消费面（AddonBehaviorName 类型与 resolveAddonBehaviorName 值导入防回潮）', () => {
    // 删除这两个公开符号的任一（或从消费面移除其消费）即红——签名面
    // 与选值函数的公开消费由本断言钉住
    const source = readFileSync(consumerPath, 'utf8')
    const sf = ts.createSourceFile(consumerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const symbols = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.endsWith('/addonBehaviors') &&
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          symbols.add(element.name.text)
        }
      }
      node.forEachChild(visit)
    }
    sf.forEachChild(visit)
    expect(symbols.has('AddonBehaviorName'), '消费面应导入 AddonBehaviorName（多语言名称 union）').toBe(true)
    expect(symbols.has('resolveAddonBehaviorName'), '消费面应导入 resolveAddonBehaviorName（选值纯函数）').toBe(true)
  })

  it('#476 行为禁用态只读面已进消费面（behaviorState 进 SdkSurface 与 facet 钉住防回潮）', () => {
    // 从消费面移除 behaviorState 的任一消费（SdkSurface Pick 键、facet
    // 形状钉住、快照 union 钉住）即红——只读面的公开消费由本断言钉住
    const source = readFileSync(consumerPath, 'utf8')
    expect(source.includes("'behaviorState'"), 'SdkSurface 应 Pick behaviorState 键').toBe(true)
    expect(source.includes('BehaviorStateSurface'), '消费面应含 BehaviorStateSurface 钉住').toBe(true)
    expect(source.includes('AddonBehaviorEnabledState'), '消费面应导入 AddonBehaviorEnabledState（快照形状）').toBe(true)
    expect(source.includes('behaviorRunStatesPinned'), '消费面应钉住 AddonBehaviorRunState union').toBe(true)
  })

  it('#498 applyEdits selection 多形态已进消费面（联合类型钉住与数组消费样例防回潮）', () => {
    // 从消费面移除多形态的任一消费（联合钉住、数组样例）即红——selection
    // 扩形态的公开消费由本断言钉住（请求类型与行为计划同形态透传）
    const source = readFileSync(consumerPath, 'utf8')
    expect(source.includes('applyEditsSelectionPinned'), '消费面应钉住 applyEdits selection 联合形态').toBe(true)
    expect(source.includes('behaviorPlanSelectionPinned'), '消费面应钉住行为计划 selection 联合形态').toBe(true)
    expect(source.includes('multiCursorSelectionSample'), '消费面应含数组形态消费样例').toBe(true)
  })

  it('#473/#475 设置定义呈现形态已进消费面（AddonLocalizedText 类型导入与 enumLabels/multiline 消费样例防回潮）', () => {
    // 删除公开符号或呈现字段（或从消费面移除其消费）即红——标签值形态
    // 与 string 定义新字段的公开消费由本断言钉住
    const source = readFileSync(consumerPath, 'utf8')
    const sf = ts.createSourceFile(consumerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const symbols = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.endsWith('/addonSettings') &&
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          symbols.add(element.name.text)
        }
      }
      node.forEachChild(visit)
    }
    sf.forEachChild(visit)
    expect(symbols.has('AddonLocalizedText'), '消费面应导入 AddonLocalizedText（枚举档位标签值形态）').toBe(true)
    expect(source.includes('enumLabels'), '消费面应含 enumLabels 字段消费样例').toBe(true)
    expect(source.includes('multiline'), '消费面应含 multiline 字段消费样例').toBe(true)
    expect(symbols.has('AddonSettingGroup'), '消费面应导入 AddonSettingGroup（#472 组声明形状）').toBe(true)
    expect(symbols.has('AddonSettingSearchEntry'), '消费面应导入 AddonSettingSearchEntry（#472 搜索摘要条目形状）').toBe(true)
    expect(source.includes('group:'), '消费面应含定义 group 字段消费样例').toBe(true)
    expect(source.includes('settingGroupDeclarations'), '消费面应含组声明消费样例').toBe(true)
  })

  it('#553 设置页上下文面已进消费面（settingsContext 进 SdkSurface 与 facet 钉住防回潮）', () => {
    // 从消费面移除 settingsContext 的任一消费（SdkSurface Pick 键、facet
    // 形状钉住、union 钉住、消费样例）即红——设置页上下文的公开消费由
    // 本断言钉住
    const source = readFileSync(consumerPath, 'utf8')
    expect(source.includes("'settingsContext'"), 'SdkSurface 应 Pick settingsContext 键').toBe(true)
    expect(source.includes('SettingsPageContextSurface'), '消费面应含 SettingsPageContextSurface 钉住').toBe(true)
    expect(source.includes('AddonSettingsScopeSnapshot'), '消费面应导入 AddonSettingsScopeSnapshot（作用域快照形状）').toBe(true)
    expect(source.includes('AddonSettingsLocateTarget'), '消费面应导入 AddonSettingsLocateTarget（定位目标形状）').toBe(true)
    expect(source.includes('settingsLocateKindsPinned'), '消费面应钉住定位目标 kind union').toBe(true)
    expect(source.includes('settingsScopeSample'), '消费面应含作用域快照消费样例').toBe(true)
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
