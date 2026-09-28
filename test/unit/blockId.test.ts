// 块 id 形态学与块边界判定契约（shared/blockId，#159/#162）：宿主块定位
// 与 webview 复制块链接入口同源的单一事实源。宿主系行为（offset 含 \r、
// 多命中取首等）由 wikilinkTarget.test.ts 钉住；本文件钉共享层的行级
// 形态学、块区间、id 收集/生成/插入计划。
import { describe, expect, it } from 'vitest'
import {
  atxHeadingOf,
  blockIdOfLine,
  blockRangeOfLine,
  collectBlockIds,
  fenceMarkerOf,
  generateBlockId,
  planBlockIdInsertion,
  scanFenceBlocks,
  standaloneBlockIdAfterBlock,
  standaloneBlockIdOf,
} from '../../src/shared/blockId'

describe('行尾块 id 标记（blockIdOfLine）', () => {
  it('正文 + 空格 + ^id + 行尾：命中', () => {
    expect(blockIdOfLine('正文 ^abc')).toBe('abc')
    expect(blockIdOfLine('正文\t^abc-def')).toBe('abc-def')
    expect(blockIdOfLine('正文 ^abc   ')).toBe('abc') // 尾随空白容忍
    expect(blockIdOfLine('- 列表项 ^x9')).toBe('x9')
  })
  it('无前置空白 / 行中标记 / 空正文：不命中', () => {
    expect(blockIdOfLine('正文^abc')).toBeNull() // id 前须至少一空格
    expect(blockIdOfLine('看 ^abc 后文')).toBeNull() // 行尾即止
    expect(blockIdOfLine('^abc')).toBeNull() // 裸 ^ 无正文空格分隔
  })
  it('id 全字与字符集：越集字符不匹配', () => {
    expect(blockIdOfLine('正文 ^ab_c')).toBeNull() // 下划线越集
    expect(blockIdOfLine('正文 ^a.b')).toBeNull()
    expect(blockIdOfLine('正文 ^中文')).toBeNull()
  })
  it('行内代码内的字面 ^id 因其后仍有字符天然不匹配', () => {
    expect(blockIdOfLine('code `x ^id` tail')).toBeNull()
    // 反例：行内代码恰好结束于行尾，标记形态成立（Obsidian 同款——形态学
    // 只认行尾，不解析行内代码边界）
    expect(blockIdOfLine('text `code` ^real')).toBe('real')
  })
})

describe('ATX 标题行（atxHeadingOf）', () => {
  it('1–6 级命中，文本剥关闭序列与尾随空白', () => {
    expect(atxHeadingOf('# 标题')).toEqual({ level: 1, text: '标题' })
    expect(atxHeadingOf('###### 六级')).toEqual({ level: 6, text: '六级' })
    expect(atxHeadingOf('## 标题 ##')).toEqual({ level: 2, text: '标题' })
    expect(atxHeadingOf('###  标题  ')).toEqual({ level: 3, text: '标题' })
    expect(atxHeadingOf('   # 缩进三格')).toEqual({ level: 1, text: '缩进三格' })
  })
  it('七级 / 无分隔空白 / 四格缩进 / 空标题 / setext / 容器前缀：不命中', () => {
    expect(atxHeadingOf('####### 七个')).toBeNull()
    expect(atxHeadingOf('#无空格')).toBeNull()
    expect(atxHeadingOf('    # 四格缩进')).toBeNull()
    expect(atxHeadingOf('#')).toBeNull()
    expect(atxHeadingOf('标题')).toBeNull()
    expect(atxHeadingOf('======')).toBeNull()
    expect(atxHeadingOf('> # 引用内标题')).toBeNull() // 容器内标题（一期不认）
  })
})

describe('围栏扫描（fenceMarkerOf / scanFenceBlocks）', () => {
  it('围栏字符识别与 info string 容忍', () => {
    expect(fenceMarkerOf('```js')).toBe('`')
    expect(fenceMarkerOf('~~~')).toBe('~')
    expect(fenceMarkerOf('  ````')).toBe('`')
    expect(fenceMarkerOf('``')).toBeNull() // 不足 3 个
    expect(fenceMarkerOf('text ```')).toBeNull() // 前缀仅容空格
  })
  it('成对围栏产出区间；开闭字符须一致', () => {
    const lines = ['```js', 'code', '```', 'para', '~~~', 'a ^x', '~~~']
    expect(scanFenceBlocks(lines)).toEqual([
      { start: 0, end: 2, char: '`' },
      { start: 4, end: 6, char: '~' },
    ])
    // ``` 未闭合（~~~ 不闭合 ```）
    expect(scanFenceBlocks(['```js', 'code', '~~~'])).toEqual([
      { start: 0, end: 2, char: '`' },
    ])
  })
  it('未闭合围栏延伸到文件末行', () => {
    expect(scanFenceBlocks(['para', '```', 'code', 'more'])).toEqual([
      { start: 1, end: 3, char: '`' },
    ])
  })
})

describe('行所属块（blockRangeOfLine）', () => {
  it('段落块：空行分界（含纯空白行）', () => {
    const lines = ['一', '二', '', '   ', '三', '']
    expect(blockRangeOfLine(lines, 0)).toEqual({ start: 0, end: 1 })
    expect(blockRangeOfLine(lines, 1)).toEqual({ start: 0, end: 1 })
    expect(blockRangeOfLine(lines, 4)).toEqual({ start: 4, end: 4 })
  })
  it('文件首尾块：到文件边界', () => {
    const lines = ['a', 'b']
    expect(blockRangeOfLine(lines, 0)).toEqual({ start: 0, end: 1 })
    expect(blockRangeOfLine(lines, 1)).toEqual({ start: 0, end: 1 })
  })
  it('列表块：多行连排为一整块（含围栏内空行场景由围栏分支覆盖）', () => {
    const lines = ['- a', '- b', '  续行', '', '正文']
    expect(blockRangeOfLine(lines, 2)).toEqual({ start: 0, end: 2 })
  })
  it('围栏块：点击围栏内部任一行 = 整个围栏块（含内部空行不被分界）', () => {
    const lines = ['```js', 'const a = 1', '', 'const b = 2', '```', '', 'para']
    for (const i of [0, 1, 2, 3, 4]) {
      expect(blockRangeOfLine(lines, i)).toEqual({ start: 0, end: 4 })
    }
    expect(blockRangeOfLine(lines, 6)).toEqual({ start: 6, end: 6 })
  })
  it('围栏与相邻普通块互不吞并：围栏行是普通块的分界', () => {
    const lines = ['para', '```', 'code', '```', 'para2']
    expect(blockRangeOfLine(lines, 0)).toEqual({ start: 0, end: 0 })
    expect(blockRangeOfLine(lines, 4)).toEqual({ start: 4, end: 4 })
  })
  it('表格整块：无空行连续行为一块（表格右键按表格整块的形态学基础）', () => {
    const lines = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '后文']
    expect(blockRangeOfLine(lines, 2)).toEqual({ start: 0, end: 2 })
  })
  it('空行与越界：不属于任何块', () => {
    const lines = ['a', '', 'b']
    expect(blockRangeOfLine(lines, 1)).toBeNull()
    expect(blockRangeOfLine(lines, -1)).toBeNull()
    expect(blockRangeOfLine(lines, 3)).toBeNull()
    expect(blockRangeOfLine([], 0)).toBeNull()
  })
})

describe('独立行块 id 标记（standaloneBlockIdOf，#163 验收反馈增集形态）', () => {
  it('整行仅 ^id（容忍前后空白与缩进）：命中', () => {
    expect(standaloneBlockIdOf('^abc')).toBe('abc')
    expect(standaloneBlockIdOf('  ^abc-def')).toBe('abc-def')
    expect(standaloneBlockIdOf('\t^x9  ')).toBe('x9')
    expect(standaloneBlockIdOf(' ^abc ')).toBe('abc')
  })
  it('带正文 / 行中标记 / 双井号 / 越集字符 / 空行：不命中', () => {
    expect(standaloneBlockIdOf('正文 ^abc')).toBeNull() // 行尾形态归 blockIdOfLine
    expect(standaloneBlockIdOf('^abc 后文')).toBeNull()
    expect(standaloneBlockIdOf('^^abc')).toBeNull()
    expect(standaloneBlockIdOf('^ab_c')).toBeNull()
    expect(standaloneBlockIdOf('^中文')).toBeNull()
    expect(standaloneBlockIdOf('')).toBeNull()
  })
})

describe('已有 id 收集与唯一 id 生成（collectBlockIds / generateBlockId）', () => {
  it('收集：双形态并存——行尾、闭围栏行行尾与围栏外独立行都计入；围栏内部与开围栏行不计', () => {
    const lines = [
      '---',
      'title: x',
      '---',
      '',
      '正文 ^abc',
      '',
      '^stand1',
      '',
      '```js',
      'code ^inside',
      '^insidestd',
      '``` ^fence1',
      '',
      '```js ^info',
      'x',
      '```',
    ]
    expect(collectBlockIds(lines)).toEqual(new Set(['abc', 'stand1', 'fence1']))
  })
  it('生成：6 位 [a-z0-9]（Obsidian 六位随机块 hash 风格）；与已有冲突重生成直至唯一（注入确定性随机）', () => {
    // 注入随机数（每字符一次 [0,1) 抽样，36 字符集）：首个产物 aaaaaa 撞车，第二个 aaaaab 唯一
    const char = (n: number): number => n / 36
    const pool = [
      char(0), char(0), char(0), char(0), char(0), char(0),
      char(0), char(0), char(0), char(0), char(0), char(1),
    ]
    let cursor = 0
    const pick = (): number => pool[cursor++]!
    expect(generateBlockId(new Set(['aaaaaa']), pick)).toBe('aaaaab')
  })
  it('生成字符集与长度固定', () => {
    const random = Math.random
    for (let i = 0; i < 50; i++) {
      expect(generateBlockId(new Set(), random)).toMatch(/^[a-z0-9]{6}$/)
    }
  })
})

describe('块尾之后的独立行 id 探查（standaloneBlockIdAfterBlock，复制块链接查已有 id）', () => {
  it('空行隔开：块尾跨空行后的首个非空行是 ^id 独立行即命中', () => {
    const lines = ['目标段落', '', '^keepstd', '', '后文']
    expect(standaloneBlockIdAfterBlock(lines, { start: 0, end: 0 })).toBe('keepstd')
  })
  it('紧贴块尾的独立行（块区间已吞并该行）：从 end+1 起探查为 null（由 standaloneBlockIdOf(lastLine) 覆盖）', () => {
    const lines = ['目标段落', '^keeptight', '', '后文']
    // blockRangeOfLine 会把 ^keeptight 吞进块（end=1），本函数从 end+1 起看
    expect(standaloneBlockIdAfterBlock(lines, { start: 0, end: 1 })).toBeNull()
    expect(standaloneBlockIdOf(lines[1]!)).toBe('keeptight')
  })
  it('跨空行后是正文（下一块领地）：不命中——不得越过正文继续找', () => {
    const lines = ['目标段落', '', '下一块', '', '^other']
    expect(standaloneBlockIdAfterBlock(lines, { start: 0, end: 0 })).toBeNull()
  })
  it('块尾后全空行 / 块即文件末块：null', () => {
    expect(standaloneBlockIdAfterBlock(['目标段落', '', ''], { start: 0, end: 0 })).toBeNull()
    expect(standaloneBlockIdAfterBlock(['目标段落'], { start: 0, end: 0 })).toBeNull()
  })
})

describe('块 id 写入计划（planBlockIdInsertion，独立行默认形态）', () => {
  it('统一返回空行 + 独立行文本（自块尾行行尾起插入）：`\\n\\n^id`', () => {
    expect(planBlockIdInsertion('abc123')).toBe('\n\n^abc123')
  })
})
