// 宿主侧文本外观服务（#340 / P3-08）：按 #335 探针验证的路线为 text 通道
// 提供窗口内着色数据——语法层（vscode-textmate 9.0.0 + vscode-oniguruma
// 1.7.0，与 1.82.3 宿主锁定版本一致；TM 颜色本由该库计算，无需自研匹配
// 器）+ 语义层（公开命令 legend/tokens 成对获取，消费侧自设 3s 上界）。
//
// 数据来源（全部宿主已装资产，不内置任何 grammar/配色）：
// - 扩展清单（vscode.extensions.all + contributes.grammars/themes）；
// - 主题链（workbench.colorTheme = settingsId → contributes.themes 按
//   id/label 匹配 → JSONC 解析 → include 链）+ 用户 tokenColor/
//   semanticTokenColor 自定义（同序合并：默认 → 主题链 → 用户自定义）；
// - 语言级字体经调用方（hoverDocAccess 端口）读取，本服务只管 token。
//
// 失效与刷新：onDidChangeConfiguration（主题/颜色自定义）与扩展安装/
// 卸载（grammar 集变化）经 invalidateAppearance() 失效缓存；调用方负责
// 广播 appearance.changed 让 webview 重取。语义层韧性口径（#335 实测）：
// 无 provider（undefined）不算失败（原生同样无，纯文本呈现）——不发该层；
// provider 抛错/超时按本次失败处理（不渲染错版 token，语法层保持）；
// legend+tokens 每次成对重取（无陈旧缓存）。
//
// 本模块依赖 vscode（provider 层装配）；纯逻辑在 themeResolution /
// tmScopeMatcher / tmEngine（可单测直驱）。
import * as fs from 'node:fs/promises'
import * as vscode from 'vscode'
import { NewlineCoordinator } from '../../shared/newline'
import { encodeTextTokenRuns, type TextTokenRun } from '../../shared/refText'
import { TextMateEngine, type GrammarContribution } from './tmEngine'
import {
  buildCustomTokenRules,
  loadThemeChain,
  pickSemanticCustomRules,
  resolveActiveThemeSettingsId,
  resolveDefaultForeground,
  resolveSemanticColor,
  type LoadedTheme,
  type SemanticStyleRule,
  type ThemedTokenRule,
  type TokenColorCustomizations,
} from './themeResolution'

/** 语义 token 公开命令的消费上界（#335 实测：公开命令无超时会等满） */
const SEMANTIC_TIMEOUT_MS = 3000

/** 窗口内着色载荷（hover.tokens 的数据体：颜色表 + 5 元组增量——
 *  窗口内 0-based 行坐标、UTF-16 列） */
export interface WindowTokenPayload {
  colors: string[]
  data: number[]
}

interface GrammarInventory {
  grammars: GrammarContribution[]
  themes: Array<{ id: string; label: string; path: string }>
}

interface ThemePipeline {
  theme: LoadedTheme
  customTokenRules: ThemedTokenRule[]
  themeSemanticRules: SemanticStyleRule[]
  customSemanticRules: SemanticStyleRule[]
  themeSettingsId: string
}

/** 颜色表建造器（颜色 → 索引去重） */
class ColorTable {
  private readonly map = new Map<string, number>()
  readonly colors: string[] = []
  indexOf(color: string): number {
    const hit = this.map.get(color)
    if (hit !== undefined) {
      return hit
    }
    const idx = this.colors.length
    this.colors.push(color)
    this.map.set(color, idx)
    return idx
  }
}

export class TextAppearanceService {
  private inventory: GrammarInventory | null = null
  private pipeline: ThemePipeline | null = null
  private pipelineKey = ''
  private enginePromise: Promise<TextMateEngine | null> | null = null
  private enginePipelineKey = ''

  constructor(private readonly onigWasmPath: string) {}

  /** 外观失效（主题/颜色自定义/扩展清单变化）：清缓存，下次计算重建 */
  invalidateAppearance(): void {
    this.inventory = null
    this.pipeline = null
    this.pipelineKey = ''
    this.enginePromise = null
    this.enginePipelineKey = ''
  }

  /** 扩展清单扫描（grammars + themes 贡献；缓存到失效） */
  private inventoryOf(): GrammarInventory {
    if (this.inventory !== null) {
      return this.inventory
    }
    const grammars: GrammarContribution[] = []
    const themes: Array<{ id: string; label: string; path: string }> = []
    for (const ext of vscode.extensions.all) {
      const contributes = (ext.packageJSON as { contributes?: Record<string, unknown> } | undefined)?.contributes
      if (!contributes) {
        continue
      }
      const grammarEntries = contributes.grammars as Array<Record<string, unknown>> | undefined
      if (Array.isArray(grammarEntries)) {
        for (const g of grammarEntries) {
          const scopeName = String(g.scopeName ?? '')
          const grammarPath = g.path ? vscode.Uri.joinPath(ext.extensionUri, String(g.path)).fsPath : ''
          if (scopeName && grammarPath) {
            grammars.push({
              language: g.language ? String(g.language) : undefined,
              scopeName,
              path: grammarPath,
              injectTo: Array.isArray(g.injectTo) ? g.injectTo.map(String) : undefined,
            })
          }
        }
      }
      const themeEntries = contributes.themes as Array<Record<string, unknown>> | undefined
      if (Array.isArray(themeEntries)) {
        for (const t of themeEntries) {
          const themePath = t.path ? vscode.Uri.joinPath(ext.extensionUri, String(t.path)).fsPath : ''
          if (themePath) {
            themes.push({ id: String(t.id ?? ''), label: String(t.label ?? ''), path: themePath })
          }
        }
      }
    }
    this.inventory = { grammars, themes }
    return this.inventory
  }

  /** 主题管线（加载 + 缓存；key 覆盖主题 id 与两处用户自定义） */
  private async pipelineOf(): Promise<ThemePipeline | null> {
    const workbench = vscode.workspace.getConfiguration('workbench')
    const editor = vscode.workspace.getConfiguration('editor')
    // 生效主题身份（autoDetect 语义复刻）：跟随系统深浅开启时
    // workbench.colorTheme 配置值是手选历史值，真实生效主题按
    // activeColorTheme 深浅取 preferred 值（Dark/HighContrast 为深侧）
    const kind = vscode.window.activeColorTheme.kind
    const prefersDark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    const themeSettingsId = resolveActiveThemeSettingsId(
      String(workbench.get('colorTheme') ?? ''),
      vscode.workspace.getConfiguration('window').get<boolean>('autoDetectColorScheme') ?? false,
      prefersDark,
      workbench.get<string>('preferredDarkColorTheme'),
      workbench.get<string>('preferredLightColorTheme'),
    )
    const tokenCustom = editor.get('tokenColorCustomizations') as TokenColorCustomizations | undefined
    const semanticCustom = editor.get('semanticTokenColorCustomizations')
    const key = JSON.stringify([themeSettingsId, tokenCustom ?? null, semanticCustom ?? null])
    if (this.pipeline !== null && this.pipelineKey === key) {
      return this.pipeline
    }
    const inventory = this.inventoryOf()
    // 匹配口径（#335 实测）：设置值是主题 id（settingsId），按 id 或 label
    const entry = inventory.themes.find((t) => t.id === themeSettingsId || t.label === themeSettingsId)
    if (!entry) {
      return null
    }
    let theme: LoadedTheme
    try {
      theme = await loadThemeChain(entry.path, (p) => fs.readFile(p, 'utf8'))
    } catch {
      return null // 主题文件不可读/解析失败：语法层回退纯文本（不算降级失败）
    }
    const pipeline: ThemePipeline = {
      theme,
      customTokenRules: buildCustomTokenRules(tokenCustom),
      themeSemanticRules: theme.semanticRules,
      customSemanticRules: pickSemanticCustomRules(semanticCustom, themeSettingsId),
      themeSettingsId,
    }
    this.pipeline = pipeline
    this.pipelineKey = key
    return pipeline
  }

  /** TM 引擎（惰性单例 + 主题身份自愈；失败返回 null 允许下次重试）。
   *  身份自愈：每次请求先重读管线（pipelineOf 每次重读配置算 key），key
   *  与引擎装配时不一致即重建——主题事件（跟随系统深浅切换等）缺失或监
   *  听遗漏时，配置/深浅漂移在下一次请求自愈，不依赖 invalidate 的时序 */
  private async engineOf(): Promise<TextMateEngine | null> {
    const pipeline = await this.pipelineOf()
    if (pipeline === null) {
      return null
    }
    if (this.enginePromise !== null && this.enginePipelineKey === this.pipelineKey) {
      return this.enginePromise
    }
    const pipelineKey = this.pipelineKey
    this.enginePipelineKey = pipelineKey
    this.enginePromise = (async (): Promise<TextMateEngine | null> => {
      try {
        const engine = await TextMateEngine.create(this.onigWasmPath, this.inventoryOf().grammars)
        // 扁平规则序（原生同构）：默认（editor.foreground/background）→
        // 主题链 tokenColors → 用户自定义
        const flatRules: ThemedTokenRule[] = [
          { settings: { foreground: pipeline.theme.colors['editor.foreground'], background: pipeline.theme.colors['editor.background'] } },
          ...pipeline.theme.tokenColors,
          ...pipeline.customTokenRules,
        ]
        // 默认前景补全链（原生同口径）：dark_plus 类主题 colors 段无
        // editor.foreground，正文色定义在 tokenColors 无 scope 规则里
        engine.setTheme(
          pipeline.themeSettingsId,
          flatRules,
          resolveDefaultForeground(pipeline.theme.colors, pipeline.theme.tokenColors),
        )
        return engine
      } catch {
        return null
      }
    })()
    // 失败不缓存（下次请求重试装配）
    void this.enginePromise.then((engine) => {
      if (engine === null) {
        this.enginePromise = null
        this.enginePipelineKey = ''
      }
    })
    return this.enginePromise
  }

  /**
   * 语法层 token（窗口内 5 元组；无 grammar 语言返回单色整行 runs——纯文本
   * 呈现与原生一致，不算降级）。引擎/主题不可用返回 null（调用方回
   * unavailable，纯文本呈现不抹除）。
   */
  async computeTextmateTokens(
    doc: vscode.TextDocument,
    beginLine: number,
    endLine: number,
  ): Promise<WindowTokenPayload | null> {
    const engine = await this.engineOf()
    if (engine === null) {
      return null
    }
    // LF 坐标（webview 全程 LF；\r\n 行尾的 \r 不进 token 文本）
    const lfText = new NewlineCoordinator(doc.getText()).toLfText(doc.getText())
    let tokenized
    try {
      tokenized = await engine.tokenize(lfText, doc.languageId)
    } catch {
      return null
    }
    const table = new ColorTable()
    const runs: TextTokenRun[] = []
    const lines = lfText.split('\n')
    const lineStarts: number[] = []
    let offset = 0
    for (const line of lines) {
      lineStarts.push(offset)
      offset += line.length + 1
    }
    const windowStart = lineStarts[beginLine - 1] ?? 0
    const windowEnd = (lineStarts[endLine] ?? lfText.length + 1) - 1
    for (const token of tokenized.tokens) {
      if (token.end <= windowStart || token.start >= windowEnd) {
        continue
      }
      // 跨行 token（多行字符串等）：按窗口内所在行切分为多 run
      const firstLine = lowerBound(lineStarts, token.start)
      const lastLine = lowerBound(lineStarts, Math.min(token.end - 1, lfText.length - 1))
      for (let line = firstLine; line <= lastLine; line++) {
        const lineStart = lineStarts[line]
        const lineEnd = lineStart + (lines[line]?.length ?? 0)
        const segStart = Math.max(token.start, lineStart)
        const segEnd = Math.min(token.end, lineEnd)
        if (segEnd <= segStart) {
          continue
        }
        if (line < beginLine - 1 || line > endLine - 1) {
          continue
        }
        runs.push({
          line: line - (beginLine - 1),
          start: segStart - lineStart,
          length: segEnd - segStart,
          colorIdx: table.indexOf(token.color),
          fontStyleBits: token.fontStyleBits,
        })
      }
    }
    return { colors: table.colors, data: encodeTextTokenRuns(runs) }
  }

  /**
   * 语义层 token（窗口内 5 元组，最终色已含用户自定义/主题规则/语义默认
   * 回退解析）。无 provider / 抛错 / 超时（3s 上界）返回 null——不发该层
   * （语法层保持，原生同构叠加语义；「语义 provider 暂不可用不抹掉已验证
   * 语法层」）。语义 token 的最终色按解析链取值，未解析出颜色的 token 跳过
   * （TM 层已着色，覆盖无效果）。
   */
  async computeSemanticTokens(
    doc: vscode.TextDocument,
    beginLine: number,
    endLine: number,
  ): Promise<WindowTokenPayload | null> {
    const pipeline = await this.pipelineOf()
    if (pipeline === null) {
      return null
    }
    const uri = doc.uri
    let legend: { tokenTypes: string[]; tokenModifiers: string[] } | undefined
    try {
      legend = await this.boundedExecute(
        vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri),
      ) as { tokenTypes: string[]; tokenModifiers: string[] } | undefined
    } catch {
      return null
    }
    if (!legend) {
      return null // 无 provider（原生同样无——纯语法层呈现）
    }
    let payload: { data?: number[] } | undefined
    try {
      payload = await this.boundedExecute(
        vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', uri),
      ) as { data?: number[] } | undefined
    } catch {
      return null // provider 抛错：本次失败，不渲染错版 token
    }
    const data = payload?.data
    if (!data || data.length === 0) {
      return null
    }
    // 5 元组增量解码（host 行列坐标；行号与 LF 一致，\r\n 的 \r 在行尾
    // 不影响列）
    const docText = doc.getText()
    const docLines = docText.split('\n')
    const table = new ColorTable()
    const runs: TextTokenRun[] = []
    let lastLine = 0
    let lastChar = 0
    for (let i = 0; i + 5 <= data.length; i += 5) {
      const deltaLine = data[i]
      const deltaStart = data[i + 1]
      if (deltaLine > 0) {
        lastLine += deltaLine
        lastChar = deltaStart
      } else {
        lastChar += deltaStart
      }
      const length = data[i + 2]
      const typeIdx = data[i + 3]
      const modBits = data[i + 4]
      if (lastLine < beginLine - 1 || lastLine > endLine - 1 || length === 0) {
        continue
      }
      const tokenType = legend.tokenTypes[typeIdx] ?? `#${typeIdx}`
      const modifiers = legend.tokenModifiers.filter((_, idx) => (modBits & (1 << idx)) !== 0)
      const outcome = resolveSemanticColor(pipeline, tokenType, modifiers, doc.languageId)
      if (outcome?.color === undefined) {
        continue // 语义默认回退 TM 层：TM 已着色，跳过（覆盖无效果）
      }
      // 行内越界防御（provider 数据劣化时钳到行长）
      const lineLen = (docLines[lastLine] ?? '').length
      const start = Math.min(lastChar, lineLen)
      const clipped = Math.min(length, lineLen - start)
      if (clipped <= 0) {
        continue
      }
      runs.push({
        line: lastLine - (beginLine - 1),
        start,
        length: clipped,
        colorIdx: table.indexOf(outcome.color),
        fontStyleBits: 0,
      })
    }
    if (runs.length === 0) {
      return null
    }
    return { colors: table.colors, data: encodeTextTokenRuns(runs) }
  }

  /** 语义命令的消费上界（公开命令无超时——3s race 可控放弃） */
  private boundedExecute<T>(promise: Thenable<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('semantic tokens timeout')), SEMANTIC_TIMEOUT_MS)
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
}

/** 二分：行首偏移表中「最后一个 ≤ target 的行号」 */
function lowerBound(lineStarts: readonly number[], target: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= target) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
