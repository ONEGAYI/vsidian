// 代码块语言注册表单一事实源（工单 #78 规格，docs/specs/code-block-card.md）：
// 显示名、别名路由。#79 起供卡片头部语言标签；#83 起语法引擎按 id 路由
// （Lezer 语言包 / legacy-modes）。live 装饰与阅读渲染共用同一注册表。
// 不依赖 vscode / DOM / CM6（node 单测直驱）。
//
// 显示名为 Prism show-language 命名风格（首字母大写，如 Plain text、
// C++）；别名匹配大小写不敏感、取 info string 首词（CommonMark 语言
// 标识语义，```js title=x 按 js 路由）；未识别 info string 不回退任何
// 语言（卡片标签显示 trim 后原文，高亮按纯文本处理）。

export interface CodeLanguageEntry {
  /** 稳定语言 id（= 规范 info string，小写） */
  id: string
  /** 头部标签显示名 */
  displayName: string
  /** 别名（info string 匹配用，小写；不含 id 本身） */
  aliases: readonly string[]
  /** 显式文本文件后缀；围栏别名不自动取得文件分类资格 */
  extensions: readonly string[]
}

/** 注册表语言；既有后缀保留历史分类，新语言只显式收录文本后缀。 */
export const CODE_LANGUAGES: readonly CodeLanguageEntry[] = [
  { id: 'javascript', displayName: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs'], extensions: ['javascript', 'js', 'jsx', 'mjs', 'cjs'] },
  { id: 'typescript', displayName: 'TypeScript', aliases: ['ts', 'tsx'], extensions: ['typescript', 'ts', 'tsx'] },
  { id: 'json', displayName: 'JSON', aliases: [], extensions: ['json'] },
  { id: 'html', displayName: 'HTML', aliases: ['htm'], extensions: ['html', 'htm'] },
  { id: 'css', displayName: 'CSS', aliases: [], extensions: ['css'] },
  { id: 'python', displayName: 'Python', aliases: ['py'], extensions: ['python', 'py'] },
  { id: 'shell', displayName: 'Shell', aliases: ['sh', 'bash', 'zsh'], extensions: ['shell', 'sh', 'bash', 'zsh'] },
  { id: 'powershell', displayName: 'PowerShell', aliases: ['ps1', 'pwsh'], extensions: ['powershell', 'ps1', 'pwsh'] },
  { id: 'c', displayName: 'C', aliases: [], extensions: ['c'] },
  { id: 'cpp', displayName: 'C++', aliases: ['cc', 'c++'], extensions: ['cpp', 'cc', 'c++'] },
  { id: 'java', displayName: 'Java', aliases: [], extensions: ['java'] },
  { id: 'go', displayName: 'Go', aliases: ['golang'], extensions: ['go', 'golang'] },
  { id: 'rust', displayName: 'Rust', aliases: ['rs'], extensions: ['rust', 'rs'] },
  { id: 'sql', displayName: 'SQL', aliases: ['pgsql'], extensions: ['sql', 'pgsql'] },
  { id: 'yaml', displayName: 'YAML', aliases: ['yml'], extensions: ['yaml', 'yml'] },
  { id: 'markdown', displayName: 'Markdown', aliases: ['md'], extensions: ['markdown', 'md'] },
  { id: 'verilog', displayName: 'Verilog', aliases: ['systemverilog', 'sv'], extensions: ['verilog', 'systemverilog', 'sv'] },
  { id: 'tcl', displayName: 'Tcl', aliases: [], extensions: ['tcl', 'tk'] },
  { id: 'vhdl', displayName: 'VHDL', aliases: ['vhd'], extensions: ['vhdl', 'vhd'] },
  { id: 'toml', displayName: 'TOML', aliases: [], extensions: ['toml'] },
  { id: 'ini', displayName: 'INI', aliases: ['properties'], extensions: ['ini', 'properties'] },
  { id: 'xml', displayName: 'XML', aliases: [], extensions: ['xml', 'xsd', 'xsl', 'xslt'] },
  { id: 'dockerfile', displayName: 'Dockerfile', aliases: ['docker'], extensions: ['dockerfile'] },
  { id: 'cmake', displayName: 'CMake', aliases: [], extensions: ['cmake'] },
  { id: 'diff', displayName: 'Diff', aliases: ['patch'], extensions: ['diff', 'patch'] },
  { id: 'csharp', displayName: 'C#', aliases: ['c#', 'cs'], extensions: ['cs'] },
  { id: 'kotlin', displayName: 'Kotlin', aliases: ['kt', 'kts'], extensions: ['kt', 'kts'] },
  { id: 'swift', displayName: 'Swift', aliases: [], extensions: ['swift'] },
  { id: 'dart', displayName: 'Dart', aliases: [], extensions: ['dart'] },
  { id: 'ruby', displayName: 'Ruby', aliases: ['rb'], extensions: ['rb', 'rbw'] },
  { id: 'lua', displayName: 'Lua', aliases: [], extensions: ['lua'] },
  { id: 'r', displayName: 'R', aliases: [], extensions: ['r'] },
  { id: 'julia', displayName: 'Julia', aliases: ['jl'], extensions: ['jl'] },
  { id: 'scss', displayName: 'SCSS', aliases: [], extensions: ['scss'] },
  { id: 'less', displayName: 'LESS', aliases: [], extensions: ['less'] },
  { id: 'protobuf', displayName: 'Protocol Buffers', aliases: ['proto'], extensions: ['proto'] },
]

/** 纯文本语言（无语言标记 / text / plaintext）的注册表内表示 */
export const PLAIN_TEXT_LANGUAGE: CodeLanguageEntry = {
  id: 'text',
  displayName: 'Plain text',
  aliases: ['plaintext', 'txt'],
  extensions: ['plaintext', 'txt'],
}

export interface ResolvedCodeLanguage {
  id: string
  displayName: string
}

const ALL_ENTRIES: readonly CodeLanguageEntry[] = [...CODE_LANGUAGES, PLAIN_TEXT_LANGUAGE]

/**
 * info string 首词（CommonMark 语言标识语义）：语言判定只看第一个空白
 * 分隔词（```js title=x → js）；trim 后空串返回 ''。live 与阅读侧共用，
 * 保证多词 info string 两视图同路由。
 */
export function codeInfoFirstWord(info: string): string {
  return /^\S+/.exec(info.trim())?.[0] ?? ''
}

/** info string → 语言条目（首词语义）；空串/text/plaintext → 纯文本；
 *  未识别返回 null */
export function resolveCodeLanguage(info: string): ResolvedCodeLanguage | null {
  const key = codeInfoFirstWord(info).toLowerCase()
  if (key === '') {
    return { id: PLAIN_TEXT_LANGUAGE.id, displayName: PLAIN_TEXT_LANGUAGE.displayName }
  }
  for (const entry of ALL_ENTRIES) {
    if (key === entry.id || entry.aliases.includes(key)) {
      return { id: entry.id, displayName: entry.displayName }
    }
  }
  return null
}
