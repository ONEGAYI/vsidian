// 双链联想查询适配单测（#376 T01）：VSCode 查询准备/评分移植（fuzzyScorer
// 固定基线 2dca67a0）以官方测试例（docs/research/vscode-quick-open-matching.md
// 示例表）钉行为，另钉 Vsidian 排序契约（分数 → mtime 新→旧 → 稳定路径，
// 不引入上游完整比较器的长度/文本兜底——那会让 mtime 失效）、默认别名与
// 插入路径经 vaultLink 的往返核对。
import { describe, expect, it } from 'vitest'
import {
  defaultAliasOf,
  planWikilinkInsertPath,
  prepareWikilinkQuery,
  rankWikilinkCandidates,
  scoreWikilinkItem,
  wikilinkFileCandidateSafe,
  wikilinkHeadingCandidateSafe,
  type WikilinkCandidateFile,
} from '../../src/shared/wikilinkQuery'

const file = (name: string, dir: string, mtimeMs = 0): WikilinkCandidateFile => ({
  name,
  dir,
  relPath: dir ? `${dir}/${name}` : name,
  mtimeMs,
})

describe('prepareWikilinkQuery', () => {
  it('空查询 normalized 为空（宿主按空查询走 mtime 榜）', () => {
    expect(prepareWikilinkQuery('').normalized).toBe('')
    expect(prepareWikilinkQuery('   ').normalized).toBe('')
  })

  it('空格拆片：每片独立 normalized，整体 normalized 剥空白', () => {
    const q = prepareWikilinkQuery('some xyz')
    expect(q.values?.map((v) => v.normalized)).toEqual(['some', 'xyz'])
    expect(q.normalized).toBe('somexyz')
    expect(q.containsPathSeparator).toBe(false)
  })

  it('反斜杠归一为 /（索引域路径统一 / 分隔；considerAsEqual 本就把两类分隔符视为等价）', () => {
    const q = prepareWikilinkQuery('资料\\方案')
    expect(q.containsPathSeparator).toBe(true)
    expect(q.normalized).toBe('资料/方案')
  })

  it('片段首尾引号 = 连续匹配（expectContiguousMatch），引号本身剥除', () => {
    const q = prepareWikilinkQuery('"contiguous"')
    expect(q.expectContiguousMatch).toBe(true)
    expect(q.normalized).toBe('contiguous')
    const plain = prepareWikilinkQuery('contiguous')
    expect(plain.expectContiguousMatch).toBe(false)
  })

  it('尾随 # 剥除（锚点查询修饰符不进文件评分）', () => {
    expect(prepareWikilinkQuery('方案#').normalized).toBe('方案')
  })
})

describe('scoreWikilinkItem（官方测试例）', () => {
  it('HW 跳字符命中 HelLo-World；edcda 逆序不命中 abcde', () => {
    const hit = scoreWikilinkItem('HelLo-World', '', prepareWikilinkQuery('HW'))
    expect(hit).not.toBeNull()
    expect(hit!.score).toBeGreaterThan(0)
    expect(scoreWikilinkItem('abcde', '', prepareWikilinkQuery('edcda'))).toBeNull()
  })

  it('多词空格：词序交换命中并同分（xyz some / some xyz → /xyz/some/path/someFile123.txt）', () => {
    const a = scoreWikilinkItem('someFile123.txt', 'xyz/some/path', prepareWikilinkQuery('xyz some'))
    const b = scoreWikilinkItem('someFile123.txt', 'xyz/some/path', prepareWikilinkQuery('some xyz'))
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.score).toBe(b!.score)
  })

  it('多词任一片未命中则整项不命中', () => {
    expect(scoreWikilinkItem('someFile123.txt', 'xyz/some/path', prepareWikilinkQuery('xyz nope'))).toBeNull()
  })

  it('路径分支：url/def 让 djangosite/urls/default.py 优于 djangosite/ufrela/def.py', () => {
    const urls = scoreWikilinkItem('default.py', 'djangosite/urls', prepareWikilinkQuery('url/def'))
    const ufrela = scoreWikilinkItem('def.py', 'djangosite/ufrela', prepareWikilinkQuery('url/def'))
    expect(urls).not.toBeNull()
    expect(ufrela).not.toBeNull()
    expect(urls!.score).toBeGreaterThan(ufrela!.score)
  })

  it('引号连续匹配："contiguous" 命中；缺字的 "contguous" 不命中', () => {
    expect(scoreWikilinkItem('contiguous', '', prepareWikilinkQuery('"contiguous"'))).not.toBeNull()
    expect(scoreWikilinkItem('contiguous', '', prepareWikilinkQuery('"contguous"'))).toBeNull()
  })

  it('无路径分隔符查询对文件名加权：前缀匹配获得高基础分', () => {
    // 前缀命中在 label 上（阈值分级），部分命中也在 label 上但基础分更低
    const prefix = scoreWikilinkItem('window.ts', '', prepareWikilinkQuery('window'))
    const inside = scoreWikilinkItem('myWindow.ts', '', prepareWikilinkQuery('window'))
    expect(prefix).not.toBeNull()
    expect(inside).not.toBeNull()
    expect(prefix!.score).toBeGreaterThan(inside!.score)
  })

  it('前缀匹配下短文件名加分更高（window.ts 优于 windowActions.ts）', () => {
    const short = scoreWikilinkItem('window.ts', '', prepareWikilinkQuery('window'))
    const long = scoreWikilinkItem('windowActions.ts', '', prepareWikilinkQuery('window'))
    expect(short!.score).toBeGreaterThan(long!.score)
  })

  it('无分隔符查询优先 label 命中：dir 命中弱于 label 命中', () => {
    const inLabel = scoreWikilinkItem('plan.md', 'other', prepareWikilinkQuery('plan'))
    const inDir = scoreWikilinkItem('other.md', 'plan', prepareWikilinkQuery('plan'))
    expect(inLabel!.score).toBeGreaterThan(inDir!.score)
  })

  it('高亮区间落在原始文字的 UTF-16 位置（含中文）', () => {
    const hit = scoreWikilinkItem('资料/方案.md'.split('/').pop()!, '资料', prepareWikilinkQuery('方案'))
    expect(hit).not.toBeNull()
    // label = '方案.md'，前缀命中区间 [0, 2)
    expect(hit!.labelMatch).toEqual([{ start: 0, end: 2 }])
  })
})

describe('rankWikilinkCandidates（Vsidian 排序契约）', () => {
  it('空查询：mtime 新→旧，未知（0）沉底，稳定路径破同分，无高亮', () => {
    const files = [
      file('a.md', '', 100),
      file('c.md', 'dir', 300),
      file('b.md', '', 200),
      file('unknown.md', '', 0),
      file('same.md', 'x', 100),
    ]
    const { items, total } = rankWikilinkCandidates(files, '', 50)
    expect(total).toBe(5)
    expect(items.map((i) => i.relPath)).toEqual(['dir/c.md', 'b.md', 'a.md', 'x/same.md', 'unknown.md'])
    for (const item of items) {
      expect(item.score).toBe(0)
      expect(item.labelHighlights).toEqual([])
      expect(item.dirHighlights).toEqual([])
    }
  })

  it('有查询：匹配分数优先于 mtime（分数高的旧文件压过分数低的新文件）', () => {
    const files = [file('ab.md', '', 900), file('abacus.md', '', 1000)]
    // 查询 ab：两文件同为前缀命中但短名加分更高 → ab.md 领先，尽管 mtime 更旧
    const { items } = rankWikilinkCandidates(files, 'ab', 50)
    expect(items[0]!.relPath).toBe('ab.md')
    expect(items[0]!.mtimeMs).toBe(900)
  })

  it('同分按 mtime 新→旧', () => {
    const files = [file('plan-a.md', '', 100), file('plan-b.md', '', 200), file('plan-c.md', '', 300)]
    const { items } = rankWikilinkCandidates(files, 'plan', 50)
    expect(items.map((i) => i.relPath)).toEqual(['plan-c.md', 'plan-b.md', 'plan-a.md'])
  })

  it('同分同 mtime 以稳定路径（字典序）破同分', () => {
    const files = [file('plan-zz.md', 'b', 100), file('plan-aa.md', 'b', 100), file('plan-mm.md', 'b', 100)]
    const { items } = rankWikilinkCandidates(files, 'plan', 50)
    expect(items.map((i) => i.relPath)).toEqual(['b/plan-aa.md', 'b/plan-mm.md', 'b/plan-zz.md'])
  })

  it('未命中的文件不进候选；total 为命中总数，items 截到 limit', () => {
    const files = [
      file('plan-a.md', '', 100),
      file('plan-b.md', '', 200),
      file('unrelated.md', '', 300),
    ]
    const { items, total } = rankWikilinkCandidates(files, 'plan', 1)
    expect(total).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0]!.relPath).toBe('plan-b.md')
  })
})

describe('defaultAliasOf', () => {
  it('Markdown 去尾 .md（大小写不敏感），其余保留完整文件名', () => {
    expect(defaultAliasOf('方案.md', 'markdown')).toBe('方案')
    expect(defaultAliasOf('Notes.MD', 'markdown')).toBe('Notes')
    expect(defaultAliasOf('a.b.md', 'markdown')).toBe('a.b')
    expect(defaultAliasOf('plain', 'markdown')).toBe('plain')
    expect(defaultAliasOf('图片.png', 'asset')).toBe('图片.png')
  })
})

describe('planWikilinkInsertPath（来源相对路径 + vaultLink 往返核对）', () => {
  const posix = { rootDir: '/root', isWindowsHost: false }
  const win = { rootDir: 'C:\\root', isWindowsHost: true }

  it('子目录目标：doc /root/项目/记录.md → /root/资料/方案.md 为 ../资料/方案.md', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md')
    expect(insert).toBe('../资料/方案.md')
  })

  it('同目录目标：相对结果为裸文件名', () => {
    expect(planWikilinkInsertPath('/root/资料', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md'))
      .toBe('方案.md')
  })

  it('根直下文档向子目录：无 .. 前缀', () => {
    expect(planWikilinkInsertPath('/root', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md'))
      .toBe('资料/方案.md')
  })

  it('Windows 宿主语义：反斜杠 fsPath 产出 / 分隔插入路径', () => {
    expect(planWikilinkInsertPath('C:\\root\\项目', win.rootDir, win.isWindowsHost, 'C:\\root\\资料\\方案.md'))
      .toBe('../资料/方案.md')
  })

  it('越出根的目标（防御）返回 null', () => {
    expect(planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/elsewhere/方案.md'))
      .toBeNull()
  })
})

describe('F5：候选写回语法往返校验（wikilinkFileCandidateSafe / wikilinkHeadingCandidateSafe）', () => {
  it('正常路径/别名候选全部通过（含空格、Unicode、点号、.. 上行）', () => {
    expect(wikilinkFileCandidateSafe('../资料/方案.md', '方案')).toBe(true)
    expect(wikilinkFileCandidateSafe('a b 附件.PDF.pdf', 'a b 附件.PDF.pdf')).toBe(true)
    expect(wikilinkFileCandidateSafe('子目录/说明.txt', '说明')).toBe(true)
  })

  it('文件名/路径含 | 写回即裂断——不安全（POSIX a|b.md）', () => {
    expect(wikilinkFileCandidateSafe('a|b.md', 'a|b')).toBe(false)
    expect(wikilinkFileCandidateSafe('dir/x|y.png', 'x|y.png')).toBe(false)
  })

  it('路径含 # 被当锚点标记——不安全；含 ^ 恒非法——不安全', () => {
    expect(wikilinkFileCandidateSafe('a#b.md', 'a#b')).toBe(false)
    expect(wikilinkFileCandidateSafe('a^b.md', 'a^b')).toBe(false)
  })

  it('路径含 [ 或 ] 链接形态守卫拒绝——不安全', () => {
    expect(wikilinkFileCandidateSafe('a[b.md', 'a[b')).toBe(false)
    expect(wikilinkFileCandidateSafe('a]b.md', 'a]b')).toBe(false)
  })

  it('空路径不安全（防御）', () => {
    expect(wikilinkFileCandidateSafe('', 'x')).toBe(false)
    expect(wikilinkFileCandidateSafe('  ', 'x')).toBe(false)
  })

  it('正常标题通过；含 | / # / ^ / 以 ^ 开头 / 含 [ ] 的标题不安全', () => {
    expect(wikilinkHeadingCandidateSafe('预算')).toBe(true)
    expect(wikilinkHeadingCandidateSafe('L2 / 子项：Q3')).toBe(true)
    expect(wikilinkHeadingCandidateSafe('标|题')).toBe(false)
    expect(wikilinkHeadingCandidateSafe('一级#二级')).toBe(false)
    expect(wikilinkHeadingCandidateSafe('标^题')).toBe(false)
    expect(wikilinkHeadingCandidateSafe('^intro')).toBe(false)
    expect(wikilinkHeadingCandidateSafe('带[括]号')).toBe(false)
    expect(wikilinkHeadingCandidateSafe('  ')).toBe(false)
  })
})

describe('前缀碰撞字界（#385 V11——字界加分形态的排序钉）', () => {
  it('同片命中不同字界：词首 > 路径分隔符后 > 普通分隔符后 > 无边界', () => {
    const q = prepareWikilinkQuery('方案')
    const wordStart = scoreWikilinkItem('方案.md', '', q)
    const afterSlash = scoreWikilinkItem('旧/方案.md', '', q)
    const afterDash = scoreWikilinkItem('my-方案.md', '', q)
    const noBoundary = scoreWikilinkItem('地方案.md', '', q)
    expect(wordStart).not.toBeNull()
    expect(afterSlash).not.toBeNull()
    expect(afterDash).not.toBeNull()
    expect(noBoundary).not.toBeNull()
    // 词首 +8 > '/' +5 > '-' +4 > 前字为汉字（无字界加分）
    expect(wordStart!.score).toBeGreaterThan(afterSlash!.score)
    expect(afterSlash!.score).toBeGreaterThan(afterDash!.score)
    expect(afterDash!.score).toBeGreaterThan(noBoundary!.score)
  })

  it('高亮区间如实落在各字界命中起点（UTF-16）', () => {
    const q = prepareWikilinkQuery('方案')
    expect(scoreWikilinkItem('my-方案.md', '', q)!.labelMatch).toEqual([{ start: 3, end: 5 }])
    expect(scoreWikilinkItem('地方案.md', '', q)!.labelMatch).toEqual([{ start: 1, end: 3 }])
    expect(scoreWikilinkItem('旧/方案.md', '', q)!.labelMatch).toEqual([{ start: 2, end: 4 }])
  })

  it('小写查询下驼峰形态等分：驼峰 +2 被大小写一致加分抵消（fa：myFA.md ≡ myfa.md）', () => {
    // 命中位逐字得分：myFA 的 F 得驼峰 +2 但失大小写一致，myfa 的 f 失驼峰
    // 但每字得大小写一致——两目标合计恰抵消，这是当前算法的真实语义
    const q = prepareWikilinkQuery('fa')
    const camel = scoreWikilinkItem('myFA.md', '', q)
    const plain = scoreWikilinkItem('myfa.md', '', q)
    expect(camel).not.toBeNull()
    expect(plain).not.toBeNull()
    expect(camel!.score).toBe(plain!.score)
    expect(camel!.labelMatch).toEqual([{ start: 2, end: 4 }])
    expect(plain!.labelMatch).toEqual([{ start: 2, end: 4 }])
  })

  it('大小写一致查询下驼峰形态领先：fA 命中 myFA.md 压过 myfa.md', () => {
    const q = prepareWikilinkQuery('fA')
    const camel = scoreWikilinkItem('myFA.md', '', q)
    const plain = scoreWikilinkItem('myfa.md', '', q)
    expect(camel).not.toBeNull()
    expect(plain).not.toBeNull()
    expect(camel!.score).toBeGreaterThan(plain!.score)
  })

  it('排序端到端：字界序压过 mtime（同片前缀碰撞四候选）', () => {
    // mtime 全部给无边界者最新——字界分仍须领先（分数优先于 mtime）
    const files = [
      file('地方案.md', '', 4000),
      file('my-方案.md', '', 3000),
      file('旧/方案.md', '', 2000),
      file('方案.md', '', 1000),
    ]
    const { items } = rankWikilinkCandidates(files, '方案', 50)
    expect(items.map((i) => i.relPath)).toEqual(['方案.md', '旧/方案.md', 'my-方案.md', '地方案.md'])
  })
})
