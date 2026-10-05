// #335 原生文字外观探针（P3-03）：在真实 VSCode 1.82.3 宿主内运行的探针套件。
// 由 test/integration/runAppearanceProbe.mjs 以 extensionTestsPath 启动，
// 复用 testHost.mjs 真宿主框架（独立便携目录、报告落盘）。产出：
// 1) stdout 上的探针日志（随宿主报告落盘）；
// 2) VSIDIAN_PROBE_EVIDENCE 指向的 JSON 证据文件（对照矩阵数据源）。
// 探针不进 VSIX，不修改生产代码；所有高亮源取自已装扩展与当前主题。
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import {
  buildCustomTokenRules,
  loadThemeChain,
  normalizeColorHex,
  pickSemanticCustomRules,
  resolveSemanticColor,
  type LoadedTheme,
  type SemanticStyleRule,
  type ThemedTokenRule,
  type TokenColorCustomizations,
} from './themeResolution'
import { ProbeTextMateEngine, type GrammarContribution } from './textmateEngine'

interface Evidence {
  label: string
  vscodeVersion: string
  hardFailures: string[]
  observations: string[]
  inventory: {
    extensionCount: number
    grammarExtensions: Array<{ id: string; version: string; kind: string; active: boolean; grammarCount: number; languages?: string[] }>
    themeExtensions: Array<{ id: string; version: string; kind: string; active: boolean; themeCount: number }>
    thirdPartyGrammarInstalled: boolean
  }
  documents: Array<{ file: string; languageId: string; version: number; bytes: number }>
  settings: Record<string, unknown>
  theme: {
    requestedLabel: string
    resolved: { id: string; label: string; path: string; extensionId: string; uiTheme: string } | null
    includeChain: string[]
    editorForeground: string
    editorBackground: string
    tokenColorCount: number
    semanticRules: SemanticStyleRule[]
    semanticHighlightingInTheme: boolean
    userSemanticHighlighting: unknown
    unsupportedPlistTokenColors: string[]
  }
  textMate: Array<{
    file: string
    languageId: string
    grammarScope: string | null
    distinctColors: string[]
    sampleTokens: Array<{ text: string; scopes: string[]; color: string }>
  }>
  semantic: {
    tsLegend: { tokenTypes: string[]; tokenModifiers: string[] } | null
    tsTokenCount: number
    tsSampleTokens: Array<{ text: string; type: string; modifiers: string[]; line: number; startChar: number; length: number }>
    rangeCommandResult: 'ok' | string
    noProviderResults: Record<string, string>
    overlaySamples: Array<{ text: string; semanticColor: string; semanticLayer: string; tmColor: string; finalColor: string; semanticWins: boolean }>
  }
  resilience: {
    ownProviderTokens: 'ok' | string
    ownProviderLegend: 'ok' | string
    throwingProvider: string
    delayedProviderOutcome: string
    delayedProviderBounded: boolean
    afterDispose: string
    unsavedEdit: { versionBefore: number; versionAfter: number; tokensCoverNewLine: boolean; newLineInTokens: boolean }
  }
  render: {
    cssVarForeground: string
    cssVarBackground: string
    themeForeground: string
    themeBackground: string
    spanChecks: Array<{ text: string; expected: string; computed: string; pass: boolean }>
    fontSizeSetting: unknown
    fontSizeComputed: string
    fontFamilySetting: string
    fontFamilyComputed: string
    lineNumbersSetting: unknown
    screenshotSaved: string | null
    screenshotError: string | null
  }
  fonts: {
    globalFamily: unknown
    globalSize: unknown
    tsScopedFamily: unknown
    tsScopedSize: unknown
    scopedOverrideVisible: boolean
  }
}

const label = process.env.VSIDIAN_PROBE_LABEL ?? 'unlabeled'
const evidencePath = process.env.VSIDIAN_PROBE_EVIDENCE
const onigWasmPath = process.env.VSIDIAN_PROBE_ONIG_WASM
const workspaceDir = process.env.WORKSPACE_DIR ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''

const evidence: Evidence = {
  label,
  vscodeVersion: vscode.version,
  hardFailures: [],
  observations: [],
  inventory: { extensionCount: 0, grammarExtensions: [], themeExtensions: [], thirdPartyGrammarInstalled: false },
  documents: [],
  settings: {},
  theme: {
    requestedLabel: '',
    resolved: null,
    includeChain: [],
    editorForeground: '',
    editorBackground: '',
    tokenColorCount: 0,
    semanticRules: [],
    semanticHighlightingInTheme: false,
    userSemanticHighlighting: undefined,
    unsupportedPlistTokenColors: [],
  },
  textMate: [],
  semantic: {
    tsLegend: null,
    tsTokenCount: 0,
    tsSampleTokens: [],
    rangeCommandResult: '',
    noProviderResults: {},
    overlaySamples: [],
  },
  resilience: {
    ownProviderTokens: '',
    ownProviderLegend: '',
    throwingProvider: '',
    delayedProviderOutcome: '',
    delayedProviderBounded: false,
    afterDispose: '',
    unsavedEdit: { versionBefore: 0, versionAfter: 0, tokensCoverNewLine: false, newLineInTokens: false },
  },
  render: {
    cssVarForeground: '',
    cssVarBackground: '',
    themeForeground: '',
    themeBackground: '',
    spanChecks: [],
    fontSizeSetting: undefined,
    fontSizeComputed: '',
    fontFamilySetting: '',
    fontFamilyComputed: '',
    lineNumbersSetting: undefined,
    screenshotSaved: null,
    screenshotError: null,
  },
  fonts: { globalFamily: undefined, globalSize: undefined, tsScopedFamily: undefined, tsScopedSize: undefined, scopedOverrideVisible: false },
}

function log(message: string): void {
  console.log(`[appearance-probe] ${message}`)
}

function hardFail(message: string): void {
  evidence.hardFailures.push(message)
  console.error(`[appearance-probe][HARD-FAIL] ${message}`)
}

function hexToRgbCss(hex: string): string {
  const n = normalizeColorHex(hex)
  if (!n) {
    return hex
  }
  const r = parseInt(n.slice(1, 3), 16)
  const g = parseInt(n.slice(3, 5), 16)
  const b = parseInt(n.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}

const SAMPLES = [
  { file: 'sample.ts', expectLanguage: 'typescript' },
  { file: 'sample.py', expectLanguage: 'python' },
  { file: 'sample.toml', expectLanguage: 'toml' },
  { file: 'plain.txt', expectLanguage: 'plaintext' },
]

export async function run(): Promise<void> {
  log(`探针开始：label=${label} workspace=${workspaceDir} host=${vscode.version}`)
  if (!evidencePath || !onigWasmPath) {
    throw new Error('缺少 VSIDIAN_PROBE_EVIDENCE / VSIDIAN_PROBE_ONIG_WASM 环境变量（由启动器注入）')
  }
  if (vscode.version !== '1.82.3') {
    hardFail(`宿主版本 ${vscode.version} != 1.82.3（下界矩阵锚点）`)
  }

  // 步骤全部包进 try/finally：中途失败也要把已采集证据落盘（部分证据亦是证据）
  try {
  // ---- S1 扩展与 grammar/主题清单（数据可达性）----
  const grammarContributions: GrammarContribution[] = []
  const themeContributions: Array<{ id: string; label: string; path: string; uiTheme: string; extensionId: string }> = []
  const thirdPartyGrammarIds: string[] = []
  for (const ext of vscode.extensions.all) {
    const pkg = (ext as unknown as { packageJSON: Record<string, unknown> }).packageJSON
    const contributes = pkg?.contributes as Record<string, unknown> | undefined
    if (!contributes) {
      continue
    }
    const grammars = contributes.grammars as Array<Record<string, unknown>> | undefined
    if (Array.isArray(grammars) && grammars.length > 0) {
      const languages = (contributes.languages as Array<Record<string, unknown>> | undefined)?.map((l) => String(l.id))
      evidence.inventory.grammarExtensions.push({
        id: ext.id,
        version: ext.packageJSON.version ?? '',
        kind: String(ext.extensionKind),
        active: ext.isActive,
        grammarCount: grammars.length,
        languages,
      })
      for (const g of grammars) {
        const scopeName = String(g.scopeName ?? '')
        const grammarPath = g.path ? vscode.Uri.joinPath(ext.extensionUri, String(g.path)).fsPath : ''
        if (scopeName && grammarPath) {
          grammarContributions.push({
            language: g.language ? String(g.language) : undefined,
            scopeName,
            path: grammarPath,
            injectTo: Array.isArray(g.injectTo) ? g.injectTo.map(String) : undefined,
          })
        }
      }
      // 内置扩展 id 以 vscode. 开头；其余视为第三方
      if (!ext.id.startsWith('vscode.')) {
        thirdPartyGrammarIds.push(ext.id)
      }
    }
    const themes = contributes.themes as Array<Record<string, unknown>> | undefined
    if (Array.isArray(themes) && themes.length > 0) {
      evidence.inventory.themeExtensions.push({
        id: ext.id,
        version: ext.packageJSON.version ?? '',
        kind: String(ext.extensionKind),
        active: ext.isActive,
        themeCount: themes.length,
      })
      for (const t of themes) {
        themeContributions.push({
          id: String(t.id ?? ''),
          label: String(t.label ?? ''),
          path: t.path ? vscode.Uri.joinPath(ext.extensionUri, String(t.path)).fsPath : '',
          uiTheme: String(t.uiTheme ?? ''),
          extensionId: ext.id,
        })
      }
    }
  }
  evidence.inventory.extensionCount = vscode.extensions.all.length
  evidence.inventory.thirdPartyGrammarInstalled = thirdPartyGrammarIds.length > 0
  log(`S1 扩展清单：共 ${vscode.extensions.all.length} 个；grammar 扩展 ${evidence.inventory.grammarExtensions.length} 个（第三方：${thirdPartyGrammarIds.join(', ') || '无'}）；主题扩展 ${evidence.inventory.themeExtensions.length} 个`)
  const requiredExtIds = ['vscode.typescript-language-features', 'vscode.theme-defaults', 'vscode.python']
  for (const required of requiredExtIds) {
    if (!evidence.inventory.grammarExtensions.some((e) => e.id === required) && !evidence.inventory.themeExtensions.some((e) => e.id === required) && !vscode.extensions.all.some((e) => e.id === required)) {
      hardFail(`宿主缺少内置扩展 ${required}`)
    }
  }

  // ---- S2 样本文档与 languageId ----
  const docs = new Map<string, vscode.TextDocument>()
  for (const sample of SAMPLES) {
    const uri = vscode.Uri.file(path.join(workspaceDir, sample.file))
    const doc = await vscode.workspace.openTextDocument(uri)
    docs.set(sample.file, doc)
    evidence.documents.push({ file: sample.file, languageId: doc.languageId, version: doc.version, bytes: Buffer.byteLength(doc.getText(), 'utf8') })
    if (doc.languageId !== sample.expectLanguage) {
      hardFail(`${sample.file} languageId=${doc.languageId}，期望 ${sample.expectLanguage}`)
    }
    log(`S2 ${sample.file} → languageId=${doc.languageId} version=${doc.version}`)
  }
  // 打开编辑器触发 onLanguage 激活（typescript-language-features 的语义 provider）
  await vscode.window.showTextDocument(docs.get('sample.ts')!, { viewColumn: vscode.ViewColumn.One })
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

  // ---- S3 设置读取 ----
  const workbench = vscode.workspace.getConfiguration('workbench')
  const editorGlobal = vscode.workspace.getConfiguration('editor')
  const tsDoc = docs.get('sample.ts')!
  const editorTs = vscode.workspace.getConfiguration('editor', tsDoc)
  const themeLabel = String(workbench.get('colorTheme') ?? '')
  evidence.theme.requestedLabel = themeLabel
  evidence.settings = {
    'workbench.colorTheme': themeLabel,
    'editor.fontFamily': editorGlobal.get('fontFamily'),
    'editor.fontSize': editorGlobal.get('fontSize'),
    'editor.fontLigatures': editorGlobal.get('fontLigatures'),
    'editor.lineNumbers': editorGlobal.get('lineNumbers'),
    'editor.semanticHighlighting': editorGlobal.inspect('semanticHighlighting'),
    'editor.tokenColorCustomizations': editorGlobal.get('tokenColorCustomizations'),
    'editor.semanticTokenColorCustomizations': editorGlobal.get('semanticTokenColorCustomizations'),
  }
  evidence.fonts = {
    globalFamily: editorGlobal.get('fontFamily'),
    globalSize: editorGlobal.get('fontSize'),
    tsScopedFamily: editorTs.get('fontFamily'),
    tsScopedSize: editorTs.get('fontSize'),
    scopedOverrideVisible: editorTs.get('fontSize') !== editorGlobal.get('fontSize') || editorTs.get('fontFamily') !== editorGlobal.get('fontFamily'),
  }
  log(`S3 主题设置=${themeLabel}；全局字体=${String(editorGlobal.get('fontFamily'))}@${String(editorGlobal.get('fontSize'))}；TS 范围字体=${String(editorTs.get('fontFamily'))}@${String(editorTs.get('fontSize'))}`)
  if (label === 'dark-custom' && !evidence.fonts.scopedOverrideVisible) {
    hardFail('dark-custom 轮 [typescript] 语言级字体覆盖未生效（设置读取层面）')
  }
  if (label === 'dark-custom') {
    // 用户自定义覆盖序验证：variable.other.readwrite.alias 无主题具体规则，
    // 自定义 #FF00FF 应生效；keyword 宽泛自定义被主题 keyword.control.* 覆盖
    // 是原生同构行为（特异性优先），不算探针失败
    evidence.observations.push('dark-custom 校验自定义覆盖序：variable.other.readwrite.alias 应为 #ff00ff')
  }

  // ---- S4 主题解析（含 include 链与跨链 CSS 变量交叉核对在 S7）----
  const themeCandidates = themeContributions.filter((t) => t.label === themeLabel || t.id === themeLabel)
  if (themeCandidates.length === 0) {
    hardFail(`当前主题 ${themeLabel} 在扩展清单中不可达（contributes.themes 无匹配 label/id）`)
  }
  const themeEntry = themeCandidates[0]
  evidence.theme.resolved = themeEntry ?? null
  let loadedTheme: LoadedTheme | null = null
  if (themeEntry) {
    try {
      loadedTheme = await loadThemeChain(themeEntry.path, async (p) => fs.readFile(p, 'utf8'))
      evidence.theme.includeChain = loadedTheme.chain.map((p) => path.relative(path.dirname(themeEntry.path), p))
      evidence.theme.editorForeground = loadedTheme.colors['editor.foreground'] ?? ''
      evidence.theme.editorBackground = loadedTheme.colors['editor.background'] ?? ''
      evidence.theme.tokenColorCount = loadedTheme.tokenColors.length
      evidence.theme.semanticRules = loadedTheme.semanticRules
      evidence.theme.semanticHighlightingInTheme = loadedTheme.semanticHighlighting
      evidence.theme.unsupportedPlistTokenColors = loadedTheme.unsupportedPlistTokenColors
      log(`S4 主题文件可达：${themeEntry.extensionId} → ${path.basename(themeEntry.path)}；include 链 ${loadedTheme.chain.length} 层；tokenColors ${loadedTheme.tokenColors.length} 条；fg=${loadedTheme.colors['editor.foreground']}`)
      if (loadedTheme.chain.length < 2) {
        evidence.observations.push('当前主题 include 链仅 1 层（无 include），include 语义覆盖依赖所选主题形态')
      }
    } catch (error) {
      hardFail(`主题文件解析失败：${String(error)}`)
    }
  }
  if (loadedTheme && !(loadedTheme.colors['editor.foreground'] && loadedTheme.colors['editor.background'])) {
    hardFail('主题解析后缺少 editor.foreground / editor.background')
  }

  const customTokenRules = buildCustomTokenRules(evidence.settings['editor.tokenColorCustomizations'] as TokenColorCustomizations | undefined)
  const customSemanticRules = pickSemanticCustomRules(evidence.settings['editor.semanticTokenColorCustomizations'], themeLabel)
  const pipelineInput = {
    theme: loadedTheme!,
    customTokenRules,
    themeSemanticRules: loadedTheme?.semanticRules ?? [],
    customSemanticRules,
  }
  evidence.theme.userSemanticHighlighting = evidence.settings['editor.semanticHighlighting']

  // ---- S5 TextMate 引擎（复刻原生 setTheme 路径）----
  const engine = await ProbeTextMateEngine.create(onigWasmPath, grammarContributions)
  const flatRules: ThemedTokenRule[] = []
  if (loadedTheme) {
    flatRules.push({ settings: { foreground: loadedTheme.colors['editor.foreground'], background: loadedTheme.colors['editor.background'] } })
    for (const rule of loadedTheme.tokenColors) {
      flatRules.push({ scope: rule.scope, settings: { foreground: normalizeColorHex(rule.settings.foreground), background: normalizeColorHex(rule.settings.background), fontStyle: rule.settings.fontStyle } })
    }
    for (const rule of customTokenRules) {
      flatRules.push(rule)
    }
    engine.setTheme(themeLabel, flatRules, loadedTheme.colors['editor.foreground'] ?? '#000000')
  }
  const tokenized = new Map<string, Awaited<ReturnType<ProbeTextMateEngine['tokenize']>>>()
  for (const sample of SAMPLES) {
    const doc = docs.get(sample.file)!
    const result = await engine.tokenize(doc.getText(), doc.languageId)
    tokenized.set(sample.file, result)
    const interesting = result.tokens.filter((t) => t.text.trim().length > 0).slice(0, 12)
    evidence.textMate.push({
      file: sample.file,
      languageId: result.languageId,
      grammarScope: result.grammarScope ?? null,
      distinctColors: result.distinctColors,
      sampleTokens: interesting.map((t) => ({ text: t.text, scopes: t.scopes.slice(-3), color: t.color })),
    })
    log(`S5 ${sample.file} grammar=${result.grammarScope ?? '(无)'} 颜色数=${result.distinctColors.length} 首token=${interesting[0]?.text ?? ''} scopes=${interesting[0]?.scopes.join(' ') ?? ''}`)
  }
  if ((tokenized.get('sample.ts')?.distinctColors.length ?? 0) < 3) {
    hardFail('sample.ts TM 着色少于 3 种颜色（引擎或主题装配异常）')
  }
  if ((tokenized.get('sample.py')?.distinctColors.length ?? 0) < 3) {
    hardFail('sample.py（仅 grammar 语言）TM 着色少于 3 种颜色')
  }
  if ((tokenized.get('sample.toml')?.distinctColors.length ?? 0) < 2) {
    hardFail('sample.toml（第三方 grammar）TM 着色少于 2 种颜色')
  }
  if ((tokenized.get('plain.txt')?.distinctColors.length ?? 0) !== 1) {
    hardFail('plain.txt 应恰为 1 种颜色（纯文本 = editor.foreground）')
  }

  // ---- S6 语义 token 公开命令 ----
  const legendCommand = 'vscode.provideDocumentSemanticTokensLegend'
  const tokensCommand = 'vscode.provideDocumentSemanticTokens'
  const rangeTokensCommand = 'vscode.provideDocumentRangeSemanticTokens'
  const tsUri = tsDoc.uri
  let legend: { tokenTypes: string[]; tokenModifiers: string[] } | undefined
  for (let attempt = 0; attempt < 40 && !legend; attempt++) {
    try {
      legend = (await vscode.commands.executeCommand(legendCommand, tsUri)) as { tokenTypes: string[]; tokenModifiers: string[] } | undefined
    } catch (error) {
      evidence.observations.push(`legend 命令第 ${attempt + 1} 次尝试异常：${String(error)}`)
    }
    if (!legend) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (!legend) {
    hardFail(`${legendCommand} 在 1.82.3 未取得 legend（等待 20s）`)
  } else {
    evidence.semantic.tsLegend = legend
    log(`S6 semantic legend 可达：tokenTypes=${legend.tokenTypes.length} modifiers=${legend.tokenModifiers.length}`)
  }
  interface SemanticTokenRow {
    text: string
    type: string
    modifiers: string[]
    line: number
    startChar: number
    length: number
    semanticColor: string
    semanticLayer: string
    tmColor: string
    finalColor: string
  }
  const semanticRows: SemanticTokenRow[] = []
  if (legend) {
    let tokensPayload: { data?: number[] } | undefined
    try {
      tokensPayload = (await vscode.commands.executeCommand(tokensCommand, tsUri)) as { data?: number[] } | undefined
    } catch (error) {
      hardFail(`${tokensCommand} 执行异常：${String(error)}`)
    }
    if (!tokensPayload?.data || tokensPayload.data.length === 0) {
      hardFail('TS 语义 token 数据为空')
    } else {
      const data = tokensPayload.data
      evidence.semantic.tsTokenCount = data.length / 5
      let lastLine = 0
      let lastChar = 0
      const rows: Array<{ line: number; startChar: number; length: number; typeIdx: number; modBits: number }> = []
      for (let i = 0; i < data.length; i += 5) {
        const deltaLine = data[i]
        const deltaStart = data[i + 1]
        const length = data[i + 2]
        const typeIdx = data[i + 3]
        const modBits = data[i + 4]
        if (deltaLine > 0) {
          lastLine += deltaLine
          lastChar = deltaStart
        } else {
          lastChar += deltaStart
        }
        rows.push({ line: lastLine, startChar: lastChar, length, typeIdx, modBits })
      }
      const textAt = (row: { line: number; startChar: number; length: number }): string => {
        const lineText = tsDoc.lineAt(row.line).text
        return lineText.substr(row.startChar, row.length)
      }
      const tmColorAt = (row: { line: number; startChar: number; length: number }): string => {
        const docOffset = tsDoc.offsetAt(new vscode.Position(row.line, 0)) + row.startChar
        const tm = tokenized.get('sample.ts')?.tokens.find((t) => t.start <= docOffset && t.end > docOffset)
        return tm?.color ?? ''
      }
      for (const row of rows) {
        const type = legend.tokenTypes[row.typeIdx] ?? `#${row.typeIdx}`
        const modifiers = legend.tokenModifiers.filter((_, idx) => (row.modBits & (1 << idx)) !== 0)
        const semanticOutcome = loadedTheme ? resolveSemanticColor(pipelineInput, type, modifiers, 'typescript') : undefined
        const tmColor = tmColorAt(row)
        const finalColor = semanticOutcome?.color ?? tmColor
        const text = textAt(row)
        semanticRows.push({ text, type, modifiers, line: row.line, startChar: row.startChar, length: row.length, semanticColor: semanticOutcome?.color ?? '', semanticLayer: semanticOutcome?.layer ?? 'none', tmColor, finalColor })
      }
      evidence.semantic.tsSampleTokens = semanticRows.slice(0, 20).map((r) => ({ text: r.text, type: r.type, modifiers: r.modifiers, line: r.line, startChar: r.startChar, length: r.length }))
      evidence.semantic.overlaySamples = semanticRows
        .filter((r) => r.semanticColor && r.tmColor)
        .slice(0, 15)
        .map((r) => ({ text: r.text, semanticColor: r.semanticColor, semanticLayer: r.semanticLayer, tmColor: r.tmColor, finalColor: r.finalColor, semanticWins: r.finalColor === r.semanticColor && r.semanticColor !== r.tmColor }))
      log(`S6 semantic tokens：${rows.length} 个；样例 type 集=${[...new Set(semanticRows.map((r) => r.type))].slice(0, 8).join(',')}；语义覆盖生效样本 ${evidence.semantic.overlaySamples.filter((s) => s.semanticWins).length}/${evidence.semantic.overlaySamples.length}`)
    }
    try {
      const rangeResult = (await vscode.commands.executeCommand(rangeTokensCommand, tsUri, new vscode.Range(0, 0, 5, 0))) as { data?: number[] } | undefined
      evidence.semantic.rangeCommandResult = rangeResult?.data?.length ? 'ok' : `empty:${JSON.stringify(rangeResult)?.slice(0, 80)}`
    } catch (error) {
      evidence.semantic.rangeCommandResult = `error:${String(error).slice(0, 120)}`
    }
  }
  // 无 provider 语言的命令行为（观察项：undefined 或报错都算「无 provider」证据）
  for (const file of ['sample.py', 'sample.toml', 'plain.txt']) {
    const doc = docs.get(file)!
    try {
      const result = await vscode.commands.executeCommand(legendCommand, doc.uri)
      evidence.semantic.noProviderResults[file] = result === undefined ? 'undefined' : JSON.stringify(result).slice(0, 80)
    } catch (error) {
      evidence.semantic.noProviderResults[file] = `error:${String(error).slice(0, 120)}`
    }
    log(`S6 ${file} 无语义 provider：${evidence.semantic.noProviderResults[file]}`)
  }

  // ---- S7 韧性：自有 provider 的注册/异常/延迟/注销 ----
  const probeContent = 'probe alpha\nprobe beta\n'
  const probeDoc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: probeContent })
  const probeLegend = { tokenTypes: ['probeThing'], tokenModifiers: ['probeMod'] }
  const buildTokens = (): vscode.SemanticTokens => {
    const data: number[] = []
    let lastLine = 0
    let lastChar = 0
    probeContent.split('\n').forEach((line, lineIdx) => {
      for (const match of line.matchAll(/\w+/g)) {
        const startChar = match.index ?? 0
        const deltaLine = lineIdx - lastLine
        const deltaStart = deltaLine > 0 ? startChar : startChar - lastChar
        data.push(deltaLine, deltaStart, match[0].length, 0, 1)
        lastLine = lineIdx
        lastChar = startChar
      }
    })
    return new vscode.SemanticTokens(new Uint32Array(data))
  }
  const registration = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: 'plaintext' },
    {
      provideDocumentSemanticTokens: () => buildTokens(),
      onDidChangeSemanticTokens: undefined,
    },
    probeLegend,
  )
  try {
    const ownLegend = (await vscode.commands.executeCommand(legendCommand, probeDoc.uri)) as { tokenTypes: string[] } | undefined
    evidence.resilience.ownProviderLegend = ownLegend?.tokenTypes?.[0] === 'probeThing' ? 'ok' : `unexpected:${JSON.stringify(ownLegend)?.slice(0, 80)}`
    const ownTokens = (await vscode.commands.executeCommand(tokensCommand, probeDoc.uri)) as { data?: number[] } | undefined
    // probe 内容 4 个词（probe/alpha/probe/beta）→ 5 元组共 20 个数
    evidence.resilience.ownProviderTokens = ownTokens?.data?.length === 20 ? 'ok' : `unexpected:${JSON.stringify(ownTokens)?.slice(0, 80)}`
    log(`S7 自有 provider：legend=${evidence.resilience.ownProviderLegend} tokens=${evidence.resilience.ownProviderTokens}`)
  } catch (error) {
    evidence.resilience.ownProviderLegend = `error:${String(error).slice(0, 120)}`
    evidence.resilience.ownProviderTokens = 'not-run'
    hardFail(`自有 provider 链路异常：${String(error)}`)
  } finally {
    await registration.dispose()
  }
  // 注销后命令回到「无 provider」态
  try {
    const afterDispose = await vscode.commands.executeCommand(legendCommand, probeDoc.uri)
    evidence.resilience.afterDispose = afterDispose === undefined ? 'undefined' : JSON.stringify(afterDispose).slice(0, 80)
  } catch (error) {
    evidence.resilience.afterDispose = `error:${String(error).slice(0, 120)}`
  }
  // 抛错 provider：命令以拒绝（rejected）呈现——#340 侧需按「本次失败、不渲染错版」处理
  const throwing = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: 'plaintext' },
    {
      provideDocumentSemanticTokens: () => {
        throw new Error('probe provider failure')
      },
    },
    probeLegend,
  )
  try {
    const bad = await vscode.commands.executeCommand(tokensCommand, probeDoc.uri)
    evidence.resilience.throwingProvider = `resolved:${JSON.stringify(bad)?.slice(0, 60)}`
  } catch (error) {
    evidence.resilience.throwingProvider = `rejected:${String(error).slice(0, 100)}`
  } finally {
    await throwing.dispose()
  }
  // 延迟 provider：公开命令本身无超时（等满 5s），探针侧必须自设上界——
  // 用 3s Promise.race 验证消费方可控放弃且不产生错版 token
  const delayed = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: 'plaintext' },
    {
      provideDocumentSemanticTokens: async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return buildTokens()
      },
    },
    probeLegend,
  )
  const startedAt = Date.now()
  try {
    const bounded = await Promise.race([
      vscode.commands.executeCommand(tokensCommand, probeDoc.uri),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout 3000ms')), 3000)),
    ])
    evidence.resilience.delayedProviderOutcome = `resolved-in-${Date.now() - startedAt}ms:${JSON.stringify(bounded)?.slice(0, 40)}`
    evidence.resilience.delayedProviderBounded = Date.now() - startedAt < 4500
  } catch (error) {
    evidence.resilience.delayedProviderBounded = String(error).includes('3000ms')
    evidence.resilience.delayedProviderOutcome = `bounded:${String(error).slice(0, 60)}`
  } finally {
    await delayed.dispose()
  }
  log(`S7 韧性：throwing=${evidence.resilience.throwingProvider.slice(0, 50)}；delayed=${evidence.resilience.delayedProviderOutcome.slice(0, 50)}；afterDispose=${evidence.resilience.afterDispose}`)

  // ---- S8 未保存版本变化（目标未保存编辑后的 token 一致性）----
  {
    const versionBefore = tsDoc.version
    const edit = new vscode.WorkspaceEdit()
    edit.insert(tsUri, new vscode.Position(tsDoc.lineCount - 1, 0), 'const afterEdit = 7;\n')
    const applied = await vscode.workspace.applyEdit(edit)
    if (!applied) {
      hardFail('未保存编辑 applyEdit 失败')
    }
    const versionAfter = tsDoc.version
    await new Promise((r) => setTimeout(r, 1500))
    const afterText = tsDoc.getText()
    const afterTm = await engine.tokenize(afterText, 'typescript')
    const newLineOffset = afterText.indexOf('const afterEdit')
    const tmCover = afterTm.tokens.some((t) => t.start <= newLineOffset && t.end > newLineOffset)
    let semanticCovers = false
    try {
      const payload = (await vscode.commands.executeCommand(tokensCommand, tsUri)) as { data?: number[] } | undefined
      const data = payload?.data ?? []
      let lastLine = 0
      let lastChar = 0
      let found = false
      for (let i = 0; i < data.length; i += 5) {
        if (data[i] > 0) {
          lastLine += data[i]
          lastChar = data[i + 1]
        } else {
          lastChar += data[i + 1]
        }
        if (tsDoc.lineAt(Math.min(lastLine, tsDoc.lineCount - 1)).text.includes('afterEdit')) {
          found = true
          break
        }
      }
      semanticCovers = found
    } catch {
      semanticCovers = false
    }
    evidence.resilience.unsavedEdit = { versionBefore, versionAfter, tokensCoverNewLine: tmCover, newLineInTokens: semanticCovers }
    log(`S8 未保存编辑：version ${versionBefore}→${versionAfter}；TM 覆盖=${tmCover}；语义覆盖=${semanticCovers}`)
    // 还原编辑（不落盘）：撤回最后一行插入
    const revert = new vscode.WorkspaceEdit()
    revert.delete(tsUri, new vscode.Range(new vscode.Position(tsDoc.lineCount - 2, 0), new vscode.Position(tsDoc.lineCount - 1, 0)))
    await vscode.workspace.applyEdit(revert)
  }

  // ---- S9 webview 绘制证据 + 主题 CSS 变量交叉核对 ----
  {
    const tsTokens = tokenized.get('sample.ts')!.tokens
    const semanticByOffset = new Map<number, SemanticTokenRow>()
    for (const row of semanticRows) {
      const offset = tsDoc.offsetAt(new vscode.Position(row.line, row.startChar))
      if (row.finalColor) {
        semanticByOffset.set(offset, row)
      }
    }
    // 渲染 sample.ts 前 12 行：TM 底色 + 语义覆盖
    const text = tsDoc.getText()
    const lines = text.split('\n').slice(0, 12)
    let offset = 0
    const htmlLines: string[] = []
    const checks: Evidence['render']['spanChecks'] = []
    for (const line of lines) {
      const spans: string[] = []
      for (const t of tsTokens) {
        if (t.start < offset || t.end > offset + line.length) {
          if (t.start >= offset + line.length + 1) {
            break
          }
          continue
        }
        const semantic = semanticByOffset.get(t.start)
        const color = semantic?.finalColor ?? t.color
        const dataIdx = checks.length
        checks.push({ text: t.text, expected: color, computed: '', pass: false })
        spans.push(`<span class="tok" data-idx="${dataIdx}" style="color:${color}">${t.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`)
      }
      htmlLines.push(`<div class="ln"><span class="no">${offset === 0 ? 1 : text.slice(0, offset).split('\n').length}</span><span class="code">${spans.join('')}</span></div>`)
      offset += line.length + 1
    }
    const fontFamily = String(evidence.fonts.tsScopedFamily ?? evidence.fonts.globalFamily ?? 'monospace')
    const fontSize = String(evidence.fonts.tsScopedSize ?? evidence.fonts.globalSize ?? 14)
    evidence.render.fontSizeSetting = fontSize
    evidence.render.fontFamilySetting = fontFamily
    evidence.render.lineNumbersSetting = evidence.settings['editor.lineNumbers']
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { margin: 0; padding: 8px; }
  .ln { white-space: pre; font-family: ${JSON.stringify(fontFamily)}; font-size: ${fontSize}px; line-height: 1.5; }
  .no { display: inline-block; width: 3em; color: var(--vscode-editorLineNumber-foreground, #888); text-align: right; margin-right: 1em; user-select: none; }
  .code { white-space: pre; }
  #probe-fg { color: var(--vscode-editor-foreground); }
  #probe-bg { background: var(--vscode-editor-background); }
</style>
</head>
<body>
<div id="probe-fg" class="ln">foreground-probe</div>
<div id="probe-bg" class="ln">background-probe</div>
${htmlLines.join('\n')}
<script>
(function () {
  const vscode = acquireVsCodeApi();
  const out = {
    spans: [],
    fg: getComputedStyle(document.getElementById('probe-fg')).color,
    bg: getComputedStyle(document.getElementById('probe-bg')).backgroundColor,
    fontFamily: getComputedStyle(document.querySelector('.ln')).fontFamily,
    fontSize: getComputedStyle(document.querySelector('.ln')).fontSize,
  };
  document.querySelectorAll('span.tok').forEach(function (el) {
    out.spans.push({ idx: Number(el.dataset.idx), color: getComputedStyle(el).color });
  });
  vscode.postMessage({ type: 'probe-render', payload: out });
})();
</script>
</body>
</html>`
    const panel = vscode.window.createWebviewPanel('vsidian.appearanceProbe', 'appearance probe', { viewColumn: vscode.ViewColumn.Two }, { enableScripts: true })
    // 先订阅再注入 HTML，避免 webview 首帧消息早于订阅到达
    const rendered = await new Promise<{ fg: string; bg: string; spans: Array<{ idx: number; color: string }>; fontFamily: string; fontSize: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('webview 渲染回包超时（10s）')), 10_000)
      panel.webview.onDidReceiveMessage((message) => {
        if (message?.type === 'probe-render') {
          clearTimeout(timer)
          resolve(message.payload)
        }
      })
      panel.webview.html = html
    })
    panel.dispose()
    evidence.render.cssVarForeground = rendered.fg
    evidence.render.cssVarBackground = rendered.bg
    evidence.render.themeForeground = loadedTheme?.colors['editor.foreground'] ?? ''
    evidence.render.themeBackground = loadedTheme?.colors['editor.background'] ?? ''
    evidence.render.fontFamilyComputed = rendered.fontFamily
    evidence.render.fontSizeComputed = rendered.fontSize
    for (const span of rendered.spans) {
      const check = checks[span.idx]
      if (!check) {
        continue
      }
      check.computed = span.color
      check.pass = span.color.replace(/\s/g, '') === hexToRgbCss(check.expected).replace(/\s/g, '')
    }
    evidence.render.spanChecks = checks
    const failedChecks = checks.filter((c) => !c.pass)
    if (failedChecks.length > 0) {
      hardFail(`webview 实际着色与管线解析不一致 ${failedChecks.length}/${checks.length} 项（首项：${failedChecks[0].text} 期望 ${failedChecks[0].expected} 实得 ${failedChecks[0].computed}）`)
    }
    const varFg = hexToRgbCss(evidence.render.themeForeground).replace(/\s/g, '')
    if (rendered.fg.replace(/\s/g, '') !== varFg) {
      hardFail(`--vscode-editor-foreground(${rendered.fg}) 与主题解析(${evidence.render.themeForeground}) 不一致`)
    }
    const varBg = hexToRgbCss(evidence.render.themeBackground).replace(/\s/g, '')
    if (rendered.bg.replace(/\s/g, '') !== varBg) {
      hardFail(`--vscode-editor-background(${rendered.bg}) 与主题解析(${evidence.render.themeBackground}) 不一致`)
    }
    if (rendered.fontSize !== `${fontSize}px`) {
      hardFail(`webview 字号 ${rendered.fontSize} != 设置 ${fontSize}px`)
    }
    if (label === 'dark-custom' && !rendered.fontFamily.includes(String(evidence.fonts.tsScopedFamily ?? '').split(',')[0].trim().replace(/'/g, ''))) {
      hardFail(`webview 字体族未应用 [typescript] 覆盖：computed=${rendered.fontFamily}`)
    }
    log(`S9 webview 绘制：${checks.length} 个 span 计算色全部核对${failedChecks.length === 0 ? '通过' : '失败'}；CSS 变量 fg=${rendered.fg} bg=${rendered.bg}；font=${rendered.fontSize} ${rendered.fontFamily.slice(0, 40)}`)
    // 截图能力探测（非关键路径）：1.82.3 是否可用 workbench.action.screenshot 留证
    try {
      const shot = (await vscode.commands.executeCommand('workbench.action.screenshot')) as unknown
      if (typeof shot === 'string' && shot.startsWith('data:image')) {
        const shotPath = evidencePath.replace(/\.json$/, '-screenshot.png')
        await fs.writeFile(shotPath, Buffer.from(shot.slice(shot.indexOf(',') + 1), 'base64'))
        evidence.render.screenshotSaved = path.basename(shotPath)
        log(`S9 截图留证：${path.basename(shotPath)}`)
      } else {
        evidence.render.screenshotError = `non-data-uri:${typeof shot === 'string' ? shot.slice(0, 40) : String(shot).slice(0, 40)}`
      }
    } catch (error) {
      evidence.render.screenshotError = String(error).slice(0, 120)
    }
  }

  // ---- 汇总 ----
  if (evidence.hardFailures.length > 0) {
    throw new Error(`appearance probe ${label} 有 ${evidence.hardFailures.length} 项硬断言失败：\n- ${evidence.hardFailures.join('\n- ')}`)
  }
  log(`appearance probe ${label} 全部通过`)
  } finally {
    await fs.mkdir(path.dirname(evidencePath), { recursive: true })
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8')
    log(`证据写入：${evidencePath}`)
  }
}
