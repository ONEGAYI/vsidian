// CSS 片段纯逻辑契约（#128）：目录片段判定、确定性排序、扫描合并（默认
// 关闭 / 文件消失不出清单）、存量清洗。语义依据 docs/specs/css-snippets.md
// 「已确认行为」与工单 #128 验收标准。
import { describe, it, expect } from 'vitest'
import {
  compareSnippetNames,
  enabledSnippetFiles,
  fileTypeMatches,
  isSnippetFileName,
  mergeScanEntries,
  sanitizeStoredCssSnippets,
  type CssSnippetState,
} from '../../src/shared/cssSnippets'

describe('片段文件判定（isSnippetFileName）', () => {
  it('接受 .css 与大小写变体，拒绝其他扩展名与裸名', () => {
    expect(isSnippetFileName('theme.css')).toBe(true)
    expect(isSnippetFileName('THEME.CSS')).toBe(true)
    expect(isSnippetFileName('a.b.css')).toBe(true)
    expect(isSnippetFileName('.css')).toBe(true)
    expect(isSnippetFileName('theme.scss')).toBe(false)
    expect(isSnippetFileName('csstxt')).toBe(false)
    expect(isSnippetFileName('')).toBe(false)
  })
})

describe('目录条目类型判定（fileTypeMatches，FileType 位掩码）', () => {
  // vscode.FileSystemEntryType 是位掩码（vscode.d.ts 明示可能为组合值）：
  // Unknown=0、File=1、Directory=2、SymbolicLink=64；符号链接文件在部分
  // 平台上报 File|SymbolicLink=65 组合位——严格相等会漏掉它。mask 由调用
  // 方用 vscode.FileType 常量拼装，此处按 vscode.d.ts 枚举数值复刻同一组合。
  const MASK = 1 | 64 // vscode.FileType.File | vscode.FileType.SymbolicLink

  it('按位判定：File / SymbolicLink / File|SymbolicLink 组合位都命中', () => {
    expect(fileTypeMatches(1, MASK)).toBe(true) // File
    expect(fileTypeMatches(64, MASK)).toBe(true) // SymbolicLink
    expect(fileTypeMatches(65, MASK)).toBe(true) // File|SymbolicLink（符号链接文件组合位）
  })

  it('Directory(2) 与 Unknown(0) 不命中', () => {
    expect(fileTypeMatches(2, MASK)).toBe(false)
    expect(fileTypeMatches(0, MASK)).toBe(false)
  })

  it('Directory|SymbolicLink(66) 命中：目录符号链接的既有取舍（不阻塞真文件）', () => {
    // 66 带 SymbolicLink 位会进候选——名为 *.css 的目录符号链接经后续
    // readFileText 读目录失败归并为不可读（既有降级路径），不误装载；
    // 反向漏掉 65 组合位的真符号链接文件则是清单缺项，代价更高。
    expect(fileTypeMatches(66, MASK)).toBe(true)
  })
})

describe('确定性排序（compareSnippetNames）', () => {
  it('按 code unit 排序：与 locale 无关，大小写位次确定', () => {
    const names = ['b.css', 'A.css', 'a.css', 'B.css', '10.css', '2.css']
    expect([...names].sort(compareSnippetNames)).toEqual([
      '10.css', '2.css', 'A.css', 'B.css', 'a.css', 'b.css',
    ])
  })

  it('数字段不做数值比较（字符串序），保证跨平台一致', () => {
    expect(compareSnippetNames('10.css', '2.css')).toBe(-1)
    expect(compareSnippetNames('2.css', '10.css')).toBe(1)
  })
})

describe('扫描合并（mergeScanEntries）', () => {
  it('新文件默认关闭；显式开启的条目按文件名确定性排序输出', () => {
    expect(mergeScanEntries(['b.css', 'a.css'], { 'b.css': true })).toEqual([
      { name: 'a.css', enabled: false },
      { name: 'b.css', enabled: true },
    ])
  })

  it('开关映射中的多余键不产出条目（文件已删除不出清单），映射值非真值按关闭', () => {
    expect(mergeScanEntries(['a.css'], { 'a.css': true, 'gone.css': true })).toEqual([
      { name: 'a.css', enabled: true },
    ])
    expect(mergeScanEntries(['a.css'], {})).toEqual([{ name: 'a.css', enabled: false }])
  })

  it('重复文件名去重（同一文件只一条目）', () => {
    expect(mergeScanEntries(['a.css', 'a.css'], { 'a.css': true })).toEqual([
      { name: 'a.css', enabled: true },
    ])
  })
})

describe('存量清洗（sanitizeStoredCssSnippets）', () => {
  it('非对象 / 数组 / null 回默认：未配置目录、无开关、未暂停', () => {
    const empty = { directory: null, enabled: {}, paused: false }
    expect(sanitizeStoredCssSnippets(undefined)).toEqual(empty)
    expect(sanitizeStoredCssSnippets(null)).toEqual(empty)
    expect(sanitizeStoredCssSnippets([])).toEqual(empty)
    expect(sanitizeStoredCssSnippets('x')).toEqual(empty)
  })

  it('合法形态原样保留（目录 + 显式开关，含 false 值）', () => {
    const stored = { directory: 'D:\\样式\\片段', enabled: { 'a.css': true, 'b.css': false } }
    expect(sanitizeStoredCssSnippets(stored)).toEqual({ ...stored, paused: false })
  })

  it('非法字段逐项回默认：空串/非串目录归 null；非布尔值与空名键剔除', () => {
    expect(
      sanitizeStoredCssSnippets({ directory: '', enabled: { 'a.css': 'on', '': true, 'b.css': true } }),
    ).toEqual({ directory: null, enabled: { 'b.css': true }, paused: false })
    expect(sanitizeStoredCssSnippets({ directory: 42, enabled: [] })).toEqual({
      directory: null,
      enabled: {},
      paused: false,
    })
  })
})

describe('暂停字段（#131）', () => {
  it('paused 只接受布尔：true 保留，缺省/非布尔归 false（重启回显的数据源）', () => {
    expect(sanitizeStoredCssSnippets({ paused: true }).paused).toBe(true)
    expect(sanitizeStoredCssSnippets({ paused: false }).paused).toBe(false)
    expect(sanitizeStoredCssSnippets({ paused: 'yes' }).paused).toBe(false)
    expect(sanitizeStoredCssSnippets({ paused: 1 }).paused).toBe(false)
    expect(sanitizeStoredCssSnippets({}).paused).toBe(false)
  })

  it('暂停是装载门控叠加，不改扫描合并与启用清单（语义与逐项停用不混淆）', () => {
    // 暂停不清空开关、不改变清单条目——mergeScanEntries / enabledSnippetFiles
    // 保持纯语义；「暂停时不下发片段」由宿主装载门控（buildSnippetLinkList）
    // 与服务广播负责
    const entries = mergeScanEntries(['a.css', 'b.css'], { 'a.css': true })
    expect(entries).toEqual([
      { name: 'a.css', enabled: true },
      { name: 'b.css', enabled: false },
    ])
    const state: CssSnippetState = {
      directory: 'D:/snips', readError: false, paused: true, entries, version: 2, rejections: {},
    }
    expect(enabledSnippetFiles(state)).toEqual(['a.css'])
  })
})

describe('启用清单（enabledSnippetFiles）', () => {
  it('目录未配置时恒为空；已配置时按序输出启用文件', () => {
    const base: CssSnippetState = {
      directory: null, readError: false, paused: false,
      entries: [{ name: 'a.css', enabled: true }], version: 3, rejections: {},

    }
    expect(enabledSnippetFiles(base)).toEqual([])
    expect(
      enabledSnippetFiles({ ...base, directory: 'D:/snips', entries: [
        { name: 'b.css', enabled: true }, { name: 'a.css', enabled: true }, { name: 'c.css', enabled: false },
      ] }),
    ).toEqual(['a.css', 'b.css'])
  })
})
