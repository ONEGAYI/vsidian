// TextMate 引擎封装（宿主侧生产模块）。
// #335 探针建立并验证、#340（P3-08）转入生产：语法层 token 与颜色计算。
// 关键事实（1.82.3 源码核实，textMateTokenizationFeatureImpl._updateTheme）：
// 原生编辑器的 TM token 颜色不是自研匹配，而是把扁平化后的 tokenColors 规则
// 传给 vscode-textmate 的 setTheme，由库内 theme 匹配产出颜色索引。本模块
// 直接用同版库（9.0.0，与 1.82.3 锁定版本一致）复刻该路径，不自研匹配器。

import * as fs from 'node:fs/promises'
import * as vscodeTextmate from 'vscode-textmate'
import * as vscodeOniguruma from 'vscode-oniguruma'
import type { ThemedTokenRule } from './themeResolution'

export interface GrammarContribution {
  language?: string
  scopeName: string
  path: string
  injectTo?: string[]
}

/** metadata 位布局（vscode-textmate 9.0.0 release/main.js 提取，与
 *  vs/editor/common/encodedTokenAttributes 同一布局） */
const FOREGROUND_MASK = 16744448
const FOREGROUND_OFFSET = 15
const FONT_STYLE_MASK = 30720
const FONT_STYLE_OFFSET = 11

export async function loadOniguruma(onigWasmPath: string): Promise<vscodeTextmate.IOnigLib> {
  const wasm = await fs.readFile(onigWasmPath)
  const arrayBuffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer
  await vscodeOniguruma.loadWASM(arrayBuffer)
  return {
    createOnigScanner: (sources) => new vscodeOniguruma.OnigScanner(sources),
    createOnigString: (str) => new vscodeOniguruma.OnigString(str),
  }
}

export interface EngineToken {
  /** 文档内 0-based 偏移（LF 坐标） */
  start: number
  end: number
  text: string
  /** 浅→深 */
  scopes: string[]
  color: string
  /** fontStyle 位：1 italic / 2 bold / 4 underline / 8 strikethrough */
  fontStyleBits: number
}

export interface TokenizedDocument {
  languageId: string
  grammarScope?: string
  tokens: EngineToken[]
  distinctColors: string[]
}

export class TextMateEngine {
  private readonly registry: vscodeTextmate.Registry
  private readonly grammarPaths = new Map<string, string>()
  private readonly languageScope = new Map<string, string>()
  private readonly injections = new Map<string, string[]>()
  private colorMap: string[] = []
  private defaultForeground = '#000000'

  private constructor(onigLib: vscodeTextmate.IOnigLib) {
    this.registry = new vscodeTextmate.Registry({
      onigLib: Promise.resolve(onigLib),
      loadGrammar: async (scopeName) => {
        const grammarPath = this.grammarPaths.get(scopeName)
        if (!grammarPath) {
          return null
        }
        const content = await fs.readFile(grammarPath)
        return vscodeTextmate.parseRawGrammar(content.toString('utf8'), grammarPath)
      },
      getInjections: (scopeName) => this.injections.get(scopeName) ?? [],
    })
  }

  static async create(onigWasmPath: string, grammars: GrammarContribution[]): Promise<TextMateEngine> {
    const onigLib = await loadOniguruma(onigWasmPath)
    const engine = new TextMateEngine(onigLib)
    for (const g of grammars) {
      engine.grammarPaths.set(g.scopeName, g.path)
      if (g.language) {
        // 同语言多条 grammar 时首条（扩展声明序）为顶层入口，与 VSCode 装配一致
        if (!engine.languageScope.has(g.language)) {
          engine.languageScope.set(g.language, g.scopeName)
        }
      }
      if (g.injectTo) {
        for (const target of g.injectTo) {
          const list = engine.injections.get(target) ?? []
          list.push(g.scopeName)
          engine.injections.set(target, list)
        }
      }
    }
    return engine
  }

  /**
   * 复刻原生装配：默认规则（editor.foreground/background）在最前，
   * 主题 tokenColors 次之，用户自定义最后（库内排序/匹配自然体现覆盖序）。
   */
  setTheme(themeLabel: string, rules: ThemedTokenRule[], editorForeground: string): void {
    const flattened = rules.map((rule) => ({
      scope: rule.scope,
      settings: {
        foreground: rule.settings.foreground,
        background: rule.settings.background,
        fontStyle: rule.settings.fontStyle,
      },
    }))
    this.registry.setTheme({ name: themeLabel, settings: flattened })
    this.colorMap = this.registry.getColorMap()
    this.defaultForeground = editorForeground
  }

  async tokenize(text: string, languageId: string): Promise<TokenizedDocument> {
    const scopeName = this.languageScope.get(languageId)
    if (!scopeName) {
      // 无 grammar：原生即纯文本（前景色 = editor.foreground），不算降级
      const lines = text.split('\n')
      const tokens: EngineToken[] = []
      let offset = 0
      for (const line of lines) {
        if (line.length > 0) {
          tokens.push({ start: offset, end: offset + line.length, text: line, scopes: [], color: this.defaultForeground, fontStyleBits: 0 })
        }
        offset += line.length + 1
      }
      return { languageId, tokens, distinctColors: [this.defaultForeground] }
    }
    const grammar = await this.registry.loadGrammar(scopeName)
    if (!grammar) {
      throw new Error(`grammar 加载失败：${scopeName}`)
    }
    const tokens: EngineToken[] = []
    const colors = new Set<string>()
    const lines = text.split('\n')
    let offset = 0
    let state: vscodeTextmate.StateStack | null = vscodeTextmate.INITIAL
    for (const line of lines) {
      const withScopes = grammar.tokenizeLine(line, state)
      const withMeta = grammar.tokenizeLine2(line, state)
      // tokenizeLine2 会合并「样式相同」的相邻 token（实测一行 14 个 v1 token
      // 只产出 8 对 v2 数据），按下标配对必然错位——改为按位置区间查样式：
      // 每对数据 [start, metadata]，区间 [start, 下一对 start)，行尾以行长收口
      const runs: Array<{ start: number; end: number; color: string; fontStyleBits: number }> = []
      for (let i = 0; i < withMeta.tokens.length; i += 2) {
        const start = withMeta.tokens[i]
        const meta = withMeta.tokens[i + 1]
        const fgIdx = (meta & FOREGROUND_MASK) >>> FOREGROUND_OFFSET
        runs.push({
          start,
          end: i + 2 < withMeta.tokens.length ? withMeta.tokens[i + 2] : line.length,
          color: fgIdx === 0 ? this.defaultForeground : (this.colorMap[fgIdx] ?? this.defaultForeground),
          fontStyleBits: (meta & FONT_STYLE_MASK) >>> FONT_STYLE_OFFSET,
        })
      }
      let runCursor = 0
      for (const t of withScopes.tokens) {
        while (runCursor < runs.length - 1 && runs[runCursor].end <= t.startIndex) {
          runCursor++
        }
        const run = runs[runCursor]
        tokens.push({
          start: offset + t.startIndex,
          end: offset + t.endIndex,
          text: line.slice(t.startIndex, t.endIndex),
          scopes: t.scopes,
          color: run?.color ?? this.defaultForeground,
          fontStyleBits: run?.fontStyleBits ?? 0,
        })
        colors.add(run?.color ?? this.defaultForeground)
      }
      state = withScopes.ruleStack
      offset += line.length + 1
    }
    return { languageId, grammarScope: scopeName, tokens, distinctColors: [...colors] }
  }
}
