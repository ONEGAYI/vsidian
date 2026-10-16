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

  it('越出根的目标（#556 relative 档）：无法以合法根内相对路径表达时回退绝对路径保留身份', () => {
    // 规格「路径生成与外部引用」：明确跨根或外部目标 → 绝对路径（不再丢弃候选）
    expect(planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/elsewhere/方案.md'))
      .toBe('/elsewhere/方案.md')
  })

  it('目录身份（targetAbs 即 docDir）恒 null——绝对回退不适用于目录', () => {
    expect(planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/项目'))
      .toBeNull()
  })
})

describe('planWikilinkInsertPath 三档（#556 T5：shortest / relative / absolute）', () => {
  const posix = { rootDir: '/root', isWindowsHost: false }
  const win = { rootDir: 'C:\\root', isWindowsHost: true }

  /** 同步存在性端口替身：命中集按平台 fold 归一，命中返回探测路径本身 */
  function existsOf(isWindowsHost: boolean, paths: readonly string[]) {
    const fold = (p: string): string => (isWindowsHost ? p.toLowerCase() : p)
    const hits = new Set(paths.map(fold))
    return (fsPath: string): string | null => (hits.has(fold(fsPath)) ? fsPath : null)
  }

  /** 短名补查端口替身（索引数据面形态：candidates 为磁盘真实路径形态） */
  const lookupOf = (candidates: readonly string[], complete = true) => (): { candidates: string[]; complete: boolean } =>
    ({ candidates: [...candidates], complete })

  // ---- absolute 档：宿主完整路径，Windows 含盘符 / 分隔，POSIX 原样 ----

  it('absolute 档（POSIX）：宿主路径原样', () => {
    expect(planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', { mode: 'absolute' }))
      .toBe('/root/资料/方案.md')
  })

  it('absolute 档（Windows）：反斜杠 fsPath 产出具盘符的 / 分隔形态', () => {
    expect(planWikilinkInsertPath('C:\\root\\项目', win.rootDir, win.isWindowsHost, 'C:\\root\\资料\\方案.md', { mode: 'absolute' }))
      .toBe('C:/root/资料/方案.md')
  })

  it('relative 档跨盘（Windows）：win32.relative 退化为绝对 → 绝对回退', () => {
    expect(planWikilinkInsertPath('C:\\root\\项目', win.rootDir, win.isWindowsHost, 'D:\\other\\方案.md'))
      .toBe('D:/other/方案.md')
  })

  // ---- shortest 档：文件名（可省 .md）→ 相对 → 绝对，经统一解析器核对 ----

  it('shortest 跨目录唯一短名：根内唯一同名 Markdown → 省略 .md 的文件名', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, []),
      lookupShortname: lookupOf(['/root/资料/方案.md']),
    })
    expect(insert).toBe('方案')
  })

  it('shortest 同目录目标：省略 .md 的文件名（exists 直击）', () => {
    const insert = planWikilinkInsertPath('/root/资料', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/资料/方案.md']),
      lookupShortname: lookupOf(['/root/资料/方案.md']),
    })
    expect(insert).toBe('方案')
  })

  it('shortest 同名歧义：多候选不归任一 → 退来源相对路径', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, []),
      lookupShortname: lookupOf(['/root/资料/方案.md', '/root/项目甲/方案.md']),
    })
    expect(insert).toBe('../资料/方案.md')
  })

  it('shortest 清单不完整：唯一候选不声明唯一（pending）→ 退相对路径', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, []),
      lookupShortname: lookupOf(['/root/资料/方案.md'], false),
    })
    expect(insert).toBe('../资料/方案.md')
  })

  it('shortest 端口未注入：数据面不完整不冒充短名 → 退相对路径（不猜目标）', () => {
    expect(planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', { mode: 'shortest' }))
      .toBe('../资料/方案.md')
    // 只注入 exists 不注入补查端口：跨目录短名仍不可核对
    expect(planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest', exists: existsOf(false, []),
    })).toBe('../资料/方案.md')
  })

  it('shortest 同目录无扩展名同名文件遮蔽：[[方案]] 首候选命中他文件 → 拒短名，退带扩展名文件名（相对退化形态）', () => {
    // docDir 存在名为「方案」的无扩展文件——[[方案]] 解析首候选直击该文件，
    // 不再走短名补查；省略 .md 形态不返回所选目标 → 退 '方案.md'（同目录相对）
    const insert = planWikilinkInsertPath('/root/资料', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/资料/方案', '/root/资料/方案.md']),
      lookupShortname: lookupOf(['/root/资料/方案.md']),
    })
    expect(insert).toBe('方案.md')
  })

  it('shortest 跨目录目标被同目录无扩展名同名文件遮蔽：裸名拒后取显式 .md 短名（P2-4 梯级，短于相对形态）', () => {
    // 目标 /root/资料/方案.md 跨目录；docDir /root/项目 存在无扩展文件
    // 「方案」——裸名 [[方案]] 首候选直击遮蔽文件被拒；显式 [[方案.md]]
    // 同目录候选未命中 → 短名补查唯一命中目标 → '方案.md' 梯级成立，
    // 短于相对 '../资料/方案.md'（Markdown 显式扩展名语义）
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/项目/方案']),
      lookupShortname: lookupOf(['/root/资料/方案.md']),
    })
    expect(insert).toBe('方案.md')
  })

  it('shortest docDir 存在同名的其他 .md：统一解析先命中他文件 → 拒短名，退相对', () => {
    // 来源目录已有相对候选优先（相对优先规则）：[[方案]] 命中 /root/项目/方案.md
    // （非所选目标）——不因根内补查唯一而覆盖相对优先
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/项目/方案.md']),
      lookupShortname: lookupOf(['/root/资料/方案.md']),
    })
    expect(insert).toBe('../资料/方案.md')
  })

  it('shortest 补查唯一命中他目标：核对不返回所选身份 → 拒短名，退相对', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, []),
      lookupShortname: lookupOf(['/root/其他/方案.md']),
    })
    expect(insert).toBe('../资料/方案.md')
  })

  it('shortest 非 Markdown 跨目录：不产生短名（补查只面向 Markdown）→ 退相对', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/素材/图.png', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/素材/图.png']),
      lookupShortname: lookupOf([]),
    })
    expect(insert).toBe('../素材/图.png')
  })

  it('shortest 非 Markdown 同目录：文件名即有效相对形式', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/root/项目/图.png', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/项目/图.png']),
      lookupShortname: lookupOf([]),
    })
    expect(insert).toBe('图.png')
  })

  it('shortest Windows 语义：补查端口身份为索引域 / 分隔形态，对账经宿主 ops 归一；大小写不敏感', () => {
    const insert = planWikilinkInsertPath('C:\\root\\项目', win.rootDir, win.isWindowsHost, 'C:\\Root\\资料\\方案.md', {
      mode: 'shortest',
      exists: existsOf(true, []),
      lookupShortname: lookupOf(['C:/root/资料/方案.md']),
    })
    expect(insert).toBe('方案')
  })

  it('shortest 越出根的目标：文件名与相对均不可表达 → 绝对路径保留身份', () => {
    const insert = planWikilinkInsertPath('/root/项目', posix.rootDir, posix.isWindowsHost, '/elsewhere/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, []),
      lookupShortname: lookupOf([]),
    })
    expect(insert).toBe('/elsewhere/方案.md')
  })

  it('最短档结果稳定性：候选序（文件名 → 相对 → 绝对）结构性由短到长，先核对先得（同长优先文件名）', () => {
    // 同目录目标：'方案'（3）< '方案.md'（5）< 绝对——首核对通过的最短形态即产出
    const insert = planWikilinkInsertPath('/root/资料', posix.rootDir, posix.isWindowsHost, '/root/资料/方案.md', {
      mode: 'shortest',
      exists: existsOf(false, ['/root/资料/方案.md']),
      lookupShortname: lookupOf(['/root/资料/方案.md']),
    })
    expect(insert).toBe('方案')
    expect(insert!.length).toBeLessThan('方案.md'.length)
  })
})

describe('F5 绝对插入路径的写回语法校验（#556 T5：wikilinkFileCandidateSafe 对三档形态）', () => {
  it('Windows 盘符 / 分隔与 POSIX 根路径均为合法 wikilink path（: 不在守卫字符集）', () => {
    expect(wikilinkFileCandidateSafe('D:/笔记库/资料/目标.md', '目标')).toBe(true)
    expect(wikilinkFileCandidateSafe('/home/user/notes/资料/目标.md', '目标')).toBe(true)
    expect(wikilinkFileCandidateSafe('方案', '方案')).toBe(true)
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
