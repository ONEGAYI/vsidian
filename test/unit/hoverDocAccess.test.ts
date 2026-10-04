// 悬停预览文档访问纯逻辑（#218 目标解析、身份/版本契约、LF 全文与错误
// 分态；#219 扩展局部范围——标题章节/块引用与普通 Markdown 链接入口）。
// 读取路径不依赖写入（端口面只有解析与读取，无任何写端口——「读取不
// 依赖写入」的结构性表达）。
import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  flattenHoverReadOutcome,
  readHoverDocTarget,
  readHoverDirectTarget,
  readHoverMdLinkTarget,
  readRefContentTarget,
  resolveHoverTargetTip,
  type HoverDocAccessContext,
  type HoverDocAccessPorts,
  type HoverReadOutcome,
  type RefReadOutcome,
} from '../../src/host/hoverDocAccess'
import type { VaultLinkFileResolution } from '../../src/shared/vaultLink'

/** 单一目标文件盘上形态：fsPath → { version, hostText } */
type Disk = Map<string, { version: number; text: string }>

interface Harness {
  ctx: HoverDocAccessContext
  ports: HoverDocAccessPorts
  /** resolve 端口收到的 rawPath 调用序列（断言解析入口） */
  resolvedCalls: string[]
  /** openTextDocument 收到的 fsPath 序列（断言读取目标） */
  opened: string[]
}

/** Windows 宿主语境的装配替身：rootDir=D:\notes，来源 D:\notes\a.md */
function makeHarness(disk: Disk, resolveOverride?: (raw: string) => VaultLinkFileResolution | null): Harness {
  const resolvedCalls: string[] = []
  const opened: string[] = []
  const ctx: HoverDocAccessContext = {
    resolve: {
      docDir: 'D:\\notes',
      rootDir: 'D:\\notes',
      isWindowsHost: true,
      hasWorkspace: true,
    },
    sourceFsPath: 'D:\\notes\\a.md',
    rootFsPath: 'D:\\notes',
  }
  const ports: HoverDocAccessPorts = {
    resolveVaultFile: async (rawPath) => {
      resolvedCalls.push(rawPath)
      if (resolveOverride) {
        const out = resolveOverride(rawPath)
        if (out) {
          return out
        }
      }
      // 默认替身：按 docDir 拼绝对候选（精确或 +.md），盘上存在即命中真实路径
      const base = path.win32.resolve(ctx.resolve.docDir, rawPath)
      for (const candidate of [base, `${base}.md`]) {
        if (disk.has(candidate)) {
          return { kind: 'target', fsPath: candidate }
        }
      }
      return { kind: 'not-found' }
    },
    openTextDocument: async (fsPath) => {
      opened.push(fsPath)
      const hit = disk.get(fsPath)
      return hit ? { version: hit.version, text: hit.text } : null
    },
  }
  return { ctx, ports, resolvedCalls, opened }
}

function note(text: string, version = 1): { version: number; text: string } {
  return { version, text }
}

/** #221 directTarget 专用盘面：来源/目标/锚点矩阵与断链分态的公共数据 */
function directHarness(disk?: Disk): Harness {
  return makeHarness(disk ?? new Map<string, { version: number; text: string }>([
    ['D:\\notes\\a.md', note('x')],
    ['D:\\notes\\来源.md', note('# 来源全文\n\n来源正文段。\n', 7)],
    ['D:\\notes\\目标.md', note([
      '# 目标全文',
      '',
      '## 章节甲',
      '',
      '甲段。',
      '',
      '- 列表项 ^direct-blk',
      '',
      '## 章节乙',
      '',
      '乙段。',
      '',
    ].join('\n'), 9)],
    ['D:\\notes\\图.png', note('binary')],
  ]))
}

describe('readHoverDocTarget：成功路径（身份/版本/LF 契约）', () => {
  it('解析命中的 Markdown 目标：返回规范身份 + 版本 + LF 全文与全文范围', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n')],
      ['D:\\notes\\目标.md', note('# 目标\n\n正文', 7)],
    ])
    const h = makeHarness(disk)
    const out = await readHoverDocTarget('目标', h.ctx, h.ports)
    expect(out).toEqual({
      ok: true,
      fsPath: 'D:\\notes\\目标.md',
      relPath: '目标.md',
      version: 7,
      lfText: '# 目标\n\n正文',
      range: { start: 0, end: 8 },
      scope: { kind: 'full' },
    } satisfies HoverReadOutcome)
    expect(h.resolvedCalls).toEqual(['目标'])
    expect(h.opened).toEqual(['D:\\notes\\目标.md'])
  })

  it('CRLF 目标转为 LF 全文（webview 坐标契约）', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\crlf.md', note('# 标题\r\n\r\n段落一\r\n')],
    ])
    const h = makeHarness(disk)
    const out = await readHoverDocTarget('crlf.md', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.lfText).toBe('# 标题\n\n段落一\n')
      expect(out.range).toEqual({ start: 0, end: out.lfText.length })
    }
  })

  it('本文件锚点（path 为空）目标即来源文档自身，不查文件系统（#219 起锚点收窄为章节）', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n\n## 某标题\n\n正文。\n', 4)],
    ])
    const h = makeHarness(disk)
    const out = await readHoverDocTarget('#某标题', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.fsPath).toBe('D:\\notes\\a.md')
      expect(out.relPath).toBe('a.md')
      expect(out.version).toBe(4)
      expect(out.scope).toEqual({ kind: 'heading', anchor: '某标题' })
      expect(out.lfText.slice(out.range.start, out.range.end)).toBe('## 某标题\n\n正文。')
    }
    expect(h.resolvedCalls, '空 path 不得走文件系统解析').toEqual([])
    expect(h.opened).toEqual(['D:\\notes\\a.md'])
  })

  it('relPath 相对所属根（子目录目标）；读取端不产生任何写入面', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\sub\\目标.md', note('子目录目标')],
    ])
    const h = makeHarness(disk)
    const out = await readHoverDocTarget('sub/目标', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.fsPath).toBe('D:\\notes\\sub\\目标.md')
      expect(out.relPath).toBe('sub/目标.md')
    }
  })
})

describe('readHoverDocTarget：错误分态（就地 i18n 呈现的载荷来源）', () => {
  it('非法双链形态 → unsupported', async () => {
    const h = makeHarness(new Map())
    expect(await readHoverDocTarget('a#b#c', h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await readHoverDocTarget('', h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('无工作区 → no-workspace；越出所属根 → escape；不存在 → not-found', async () => {
    const noWs = makeHarness(new Map(), () => ({ kind: 'no-workspace' }))
    expect(await readHoverDocTarget('目标', noWs.ctx, noWs.ports)).toEqual({ ok: false, reason: 'no-workspace' })

    const escape = makeHarness(new Map(), () => ({ kind: 'escape', detail: '../../x' }))
    expect(await readHoverDocTarget('../../x', escape.ctx, escape.ports)).toEqual({ ok: false, reason: 'escape' })

    const notFound = makeHarness(new Map())
    expect(await readHoverDocTarget('不存在', notFound.ctx, notFound.ports)).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('非 Markdown 目标（如图片）→ non-markdown（一期只接 Markdown 全文）', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\图.png', note('binary')],
    ])
    const h = makeHarness(disk)
    expect(await readHoverDocTarget('图.png', h.ctx, h.ports)).toEqual({ ok: false, reason: 'non-markdown' })
    expect(h.opened, '非 Markdown 目标不读取正文').toEqual([])
  })

  it('打开/读取目标失败 → read-failed（不抛出、不部分成功）', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\坏.md', note('x')],
    ])
    const h = makeHarness(disk)
    h.ports.openTextDocument = async () => null
    expect(await readHoverDocTarget('坏.md', h.ctx, h.ports)).toEqual({ ok: false, reason: 'read-failed' })
  })
})

/** 局部范围矩阵共用目标：章节结构 + 多行块（列表/围栏）+ 重复标题 */
const SECTION_DOC = [
  '# 顶部',
  '',
  '顶部段。',
  '',
  '## 章节甲',
  '',
  '甲段一。',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '## 章节乙',
  '',
  '乙段。',
  '',
  '## 章节甲', // 重复标题：取首
  '',
  '丙段。',
  '',
].join('\n')

const BLOCK_DOC = [
  '# 块目标',
  '',
  '列表引导：',
  '- 项一',
  '- 项二 ^blk1',
  '',
  '独立标记段落。',
  '',
  '^std1',
  '',
].join('\n')

describe('readHoverDocTarget：局部范围（#219 标题章节与块引用）', () => {
  function sectionHarness(text: string, version = 5): Harness {
    return makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n')],
      ['D:\\notes\\目标.md', note(text, version)],
    ]))
  }

  it('标题锚点：scope=heading，range 为章节区间（标题行起、下一同级标题前；LF 坐标）', async () => {
    const h = sectionHarness(SECTION_DOC)
    const out = await readHoverDocTarget('目标#章节甲', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.scope).toEqual({ kind: 'heading', anchor: '章节甲' })
    expect(out.lfText.slice(out.range.start, out.range.end)).toBe(
      '## 章节甲\n\n甲段一。\n\n```js\nconst a = 1\n```',
    )
    expect(out.range.start).toBeGreaterThan(0)
    expect(out.range.end).toBeLessThan(out.lfText.length)
  })

  it('块锚点（行尾标记）：scope=block，range 为完整多行块（不截首行）', async () => {
    const h = sectionHarness(BLOCK_DOC)
    const out = await readHoverDocTarget('目标#^blk1', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.scope).toEqual({ kind: 'block', anchor: '^blk1' })
    expect(out.lfText.slice(out.range.start, out.range.end)).toBe('列表引导：\n- 项一\n- 项二 ^blk1')
  })

  it('块锚点（独立行标记）：完整范围是上方块（不含 ^id 行）', async () => {
    const h = sectionHarness(BLOCK_DOC)
    const out = await readHoverDocTarget('目标#^std1', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.lfText.slice(out.range.start, out.range.end)).toBe('独立标记段落。')
  })

  it('重复标题取首：章节取首个同名标题的区间', async () => {
    const h = sectionHarness(SECTION_DOC)
    const out = await readHoverDocTarget('目标#章节甲', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.lfText.slice(out.range.start, out.range.end)).not.toContain('丙段')
  })

  it('锚点缺失 → anchor-missing 分态并携带锚点原文（不以全文替代）', async () => {
    const h = sectionHarness(SECTION_DOC)
    expect(await readHoverDocTarget('目标#不存在标题', h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'anchor-missing',
      anchor: '不存在标题',
    })
    expect(await readHoverDocTarget('目标#^nope', h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'anchor-missing',
      anchor: '^nope',
    })
  })

  it('CRLF 目标：range 为 LF 坐标（宿主系区间经 NewlineCoordinator 换算）', async () => {
    const h = sectionHarness('# 甲\r\n\r\n甲段\r\n\r\n# 乙\r\n\r\n乙段\r\n')
    const out = await readHoverDocTarget('目标#甲', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.lfText).toBe('# 甲\n\n甲段\n\n# 乙\n\n乙段\n')
    expect(out.lfText.slice(out.range.start, out.range.end)).toBe('# 甲\n\n甲段')
    expect(out.range.end).toBeLessThanOrEqual(out.lfText.length)
  })

  it('空 path 双链的标题/块锚点：目标即来源文档自身的章节/块', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n\n## 父章节\n\n父段。\n\n父块。 ^parent-blk\n', 4)],
    ])
    const h = makeHarness(disk)
    const heading = await readHoverDocTarget('#父章节', h.ctx, h.ports)
    expect(heading.ok).toBe(true)
    if (heading.ok) {
      expect(heading.scope).toEqual({ kind: 'heading', anchor: '父章节' })
      expect(heading.lfText.slice(heading.range.start, heading.range.end)).toBe('## 父章节\n\n父段。\n\n父块。 ^parent-blk')
    }
    const block = await readHoverDocTarget('#^parent-blk', h.ctx, h.ports)
    expect(block.ok).toBe(true)
    if (block.ok) {
      expect(block.scope).toEqual({ kind: 'block', anchor: '^parent-blk' })
    }
  })
})

describe('readHoverMdLinkTarget：普通本地 Markdown 链接（#219）', () => {
  it('相对路径无锚点 → 全文（scope=full）；无扩展名补 .md 候选', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\目标.md', note('# 目标\n\n正文', 3)],
    ])
    const h = makeHarness(disk)
    const out = await readHoverMdLinkTarget('目标.md', h.ctx, h.ports)
    expect(out).toMatchObject({
      ok: true,
      fsPath: 'D:\\notes\\目标.md',
      relPath: '目标.md',
      version: 3,
      scope: { kind: 'full' },
    })
    const out2 = await readHoverMdLinkTarget('目标', h.ctx, h.ports)
    expect(out2).toMatchObject({ ok: true, fsPath: 'D:\\notes\\目标.md' })
  })

  it('带标题 fragment → 章节范围；带块 fragment（#^id）→ 块范围', async () => {
    const section = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\目标.md', note(SECTION_DOC)],
    ]))
    const heading = await readHoverMdLinkTarget('目标.md#章节乙', section.ctx, section.ports)
    expect(heading.ok).toBe(true)
    if (heading.ok) {
      expect(heading.scope).toEqual({ kind: 'heading', anchor: '章节乙' })
      expect(heading.lfText.slice(heading.range.start, heading.range.end)).toBe('## 章节乙\n\n乙段。')
    }
    const block = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\目标.md', note(BLOCK_DOC)],
    ]))
    const blockOut = await readHoverMdLinkTarget('目标.md#^blk1', block.ctx, block.ports)
    expect(blockOut.ok).toBe(true)
    if (blockOut.ok) {
      expect(blockOut.scope).toEqual({ kind: 'block', anchor: '^blk1' })
      expect(blockOut.lfText.slice(blockOut.range.start, blockOut.range.end)).toBe('列表引导：\n- 项一\n- 项二 ^blk1')
    }
  })

  it('页内锚点（#frag）以来源文档为目标：目标即当前文档自身', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n\n## 父章节\n\n父段。\n', 9)],
    ])
    const h = makeHarness(disk)
    const out = await readHoverMdLinkTarget('#父章节', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.fsPath).toBe('D:\\notes\\a.md')
    expect(out.scope).toEqual({ kind: 'heading', anchor: '父章节' })
    expect(out.lfText.slice(out.range.start, out.range.end)).toBe('## 父章节\n\n父段。')
    expect(h.resolvedCalls, '页内锚点不查文件系统').toEqual([])
  })

  it('中文与空格路径：字面与 percent-encode 两种写法解析到同一目标', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\我的 笔记.md', note('# 我的 笔记\n\n## 章\n\n段。\n')],
    ])
    const literal = await makeHarness(disk)
    const out1 = await readHoverMdLinkTarget('我的 笔记.md#章', literal.ctx, literal.ports)
    expect(out1).toMatchObject({ ok: true, relPath: '我的 笔记.md', scope: { kind: 'heading', anchor: '章' } })
    const encoded = await makeHarness(disk)
    const out2 = await readHoverMdLinkTarget('我的%20笔记.md#章', encoded.ctx, encoded.ports)
    expect(out2).toMatchObject({ ok: true, fsPath: 'D:\\notes\\我的 笔记.md' })
  })

  it('外部网页与带 scheme 目标不接入 → unsupported', async () => {
    const h = makeHarness(new Map())
    expect(await readHoverMdLinkTarget('https://example.com/x.md', h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(await readHoverMdLinkTarget('http://example.com', h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await readHoverMdLinkTarget('mailto:a@b.c', h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await readHoverMdLinkTarget('//example.com/x', h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('越出所属根 → escape；裸 # → unsupported', async () => {
    const h = makeHarness(new Map())
    expect(await readHoverMdLinkTarget('../../x.md', h.ctx, h.ports)).toEqual({ ok: false, reason: 'escape' })
    expect(await readHoverMdLinkTarget('#', h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('目标不存在 → not-found；非 Markdown → non-markdown；锚点缺失 → anchor-missing', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\目标.md', note('# 目标\n')],
      ['D:\\notes\\图.png', note('binary')],
    ])
    const h = makeHarness(disk)
    expect(await readHoverMdLinkTarget('不存在.md', h.ctx, h.ports)).toEqual({ ok: false, reason: 'not-found' })
    expect(await readHoverMdLinkTarget('图.png', h.ctx, h.ports)).toEqual({ ok: false, reason: 'non-markdown' })
    expect(await readHoverMdLinkTarget('目标.md#没有的标题', h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'anchor-missing',
      anchor: '没有的标题',
    })
  })
})

// #221 面板直接目标（反链/出链条目）：目标身份是宿主快照携带的绝对
// fsPath（± 锚点），不走 target/linkHref 文本解析与根内路径探测——
// 解析端口零调用（无 resolveVaultFile 输入），读取与范围收窄复用同一
// readAndScope 收尾（锚点语义与链接形态无关）。
describe('readHoverDirectTarget：面板条目直接目标（#221）', () => {

  it('无锚点 → 全文（scope=full）；反链条目形态：不查文件系统（解析端口零调用）', async () => {
    const h = directHarness()
    const out = await readHoverDirectTarget({ fsPath: 'D:\\notes\\来源.md' }, h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.scope).toEqual({ kind: 'full' })
    expect(out.relPath).toBe('来源.md')
    expect(out.version).toBe(7)
    expect(out.range).toEqual({ start: 0, end: out.lfText.length })
    expect(h.resolvedCalls, '直接目标不走文本解析（resolveVaultFile 零调用）').toEqual([])
    expect(h.opened).toEqual(['D:\\notes\\来源.md'])
  })

  it('出链条目锚点：标题原文 → heading 章节；^块id → block 完整块（与链接形态同一收窄口径）', async () => {
    const h = directHarness()
    const heading = await readHoverDirectTarget(
      { fsPath: 'D:\\notes\\目标.md', anchor: '章节甲' }, h.ctx, h.ports)
    expect(heading.ok).toBe(true)
    if (heading.ok) {
      expect(heading.scope).toEqual({ kind: 'heading', anchor: '章节甲' })
      expect(heading.lfText.slice(heading.range.start, heading.range.end))
        .toBe('## 章节甲\n\n甲段。\n\n- 列表项 ^direct-blk')
    }
    const block = await readHoverDirectTarget(
      { fsPath: 'D:\\notes\\目标.md', anchor: '^direct-blk' }, h.ctx, h.ports)
    expect(block.ok).toBe(true)
    if (block.ok) {
      expect(block.scope).toEqual({ kind: 'block', anchor: '^direct-blk' })
      expect(block.lfText.slice(block.range.start, block.range.end)).toBe('- 列表项 ^direct-blk')
    }
  })

  it('空串锚点 = 无锚点（full）；锚点缺失 → anchor-missing 附锚点原文', async () => {
    const h = directHarness()
    const full = await readHoverDirectTarget({ fsPath: 'D:\\notes\\目标.md', anchor: '' }, h.ctx, h.ports)
    expect(full.ok).toBe(true)
    if (full.ok) {
      expect(full.scope).toEqual({ kind: 'full' })
    }
    expect(await readHoverDirectTarget(
      { fsPath: 'D:\\notes\\目标.md', anchor: '不存在标题' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'anchor-missing',
      anchor: '不存在标题',
    })
  })

  it('断链条目（空串 fsPath）→ not-found；非 Markdown → non-markdown；读取失败 → read-failed', async () => {
    const h = directHarness()
    // 断链出链条目：目标解析从未命中，无 fsPath 可读——空串入队让宿主
    // 回 not-found 分态（条目仍可悬停显示失效占位，而非静默不发）
    expect(await readHoverDirectTarget({ fsPath: '', anchor: 'x' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(await readHoverDirectTarget({ fsPath: 'D:\\notes\\图.png' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'non-markdown',
    })
    const broken = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\坏.md', note('y')],
    ]))
    broken.ports.openTextDocument = async () => null
    expect(await readHoverDirectTarget({ fsPath: 'D:\\notes\\坏.md' }, broken.ctx, broken.ports)).toEqual({
      ok: false,
      reason: 'read-failed',
    })
  })
})

// P1-1（review 修复）：directTarget 的 fsPath 来自前端消息，被攻陷 webview
// 可伪造任意路径——双链/普通链接路径经 resolveVaultLinkFile 根内边界（escape
// 拦截），directTarget 必须补齐同一静态边界：fsPath 须在所属根内（ADR-0008
// 语义：当前文档所属 workspaceFolder——索引按根分区、跨根目标不解析，面板
// 快照身份恒在所属根内，合法条目不受影响）且 .md 后缀；越界归 escape 分态。
describe('readHoverDirectTarget：宿主侧静态边界（P1-1，不信任前端任意路径）', () => {
  it('工作区外绝对路径 → escape，且读取端口零调用（不装载越界文件）', async () => {
    const h = directHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\outside\\机密.md', note('secret')],
      ['E:\\别的盘\\目标.md', note('y')],
    ]))
    // 同盘越界（..\ 上行出根）
    expect(await readHoverDirectTarget({ fsPath: 'D:\\outside\\机密.md' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'escape',
    })
    // 跨盘符（Windows 语义下相对结果是绝对路径 → 越界）
    expect(await readHoverDirectTarget({ fsPath: 'E:\\别的盘\\目标.md' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'escape',
    })
    expect(h.opened, '越界路径不得触达读取端口').toEqual([])
    expect(h.resolvedCalls).toEqual([])
  })

  it('相对形态 fsPath（非绝对路径）→ escape（不可信形态不做 cwd 依赖解析）', async () => {
    const h = directHarness()
    expect(await readHoverDirectTarget({ fsPath: '机密.md' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'escape',
    })
    expect(h.opened).toEqual([])
  })

  it('根内子目录合法路径 → 放行（多根架构下面板快照身份恒在所属根内，合法条目不受影响）', async () => {
    const h = directHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\sub\\目标.md', note('# 子目录目标\n', 3)],
    ]))
    const out = await readHoverDirectTarget({ fsPath: 'D:\\notes\\sub\\目标.md' }, h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok) {
      return
    }
    expect(out.relPath).toBe('sub/目标.md')
    expect(out.version).toBe(3)
    expect(h.opened).toEqual(['D:\\notes\\sub\\目标.md'])
  })

  it('根内但非 .md 后缀 → non-markdown（既有分态，边界后复核）', async () => {
    const h = directHarness()
    expect(await readHoverDirectTarget({ fsPath: 'D:\\notes\\图.png' }, h.ctx, h.ports)).toEqual({
      ok: false,
      reason: 'non-markdown',
    })
    expect(h.opened).toEqual([])
  })
})


describe('跳转目标提示轻量解析（#299 resolveHoverTargetTip：只解析不读正文）', () => {
  /** 轻量端口替身：resolveVaultFile 同款 + openTextDocument 从不期望被调 */
  function tipHarness(disk: Disk): Harness & { opened: string[] } {
    return makeHarness(disk, undefined)
  }

  it('双链全文：解析成功返回所属根内相对路径（/ 分隔、含扩展名），无锚点', async () => {
    const h = tipHarness(new Map([['D:\\notes\\sub\\目标笔记.md', note('x')]]))
    const out = await resolveHoverTargetTip({ target: 'sub/目标笔记' }, h.ctx)
    expect(out).toEqual({ ok: true, relPath: 'sub/目标笔记.md', anchor: '' })
    // 轻量硬边界：不读目标正文（openTextDocument 零调用）
    expect(h.opened).toEqual([])
  })

  it('双链锚点两形态：#标题 与 #^块id 按源码形态附加', async () => {
    const h = tipHarness(new Map([['D:\\notes\\目标.md', note('x')]]))
    expect(await resolveHoverTargetTip({ target: '目标#章节一' }, h.ctx))
      .toEqual({ ok: true, relPath: '目标.md', anchor: '#章节一' })
    expect(await resolveHoverTargetTip({ target: '目标#^blk-id' }, h.ctx))
      .toEqual({ ok: true, relPath: '目标.md', anchor: '#^blk-id' })
  })

  it('双链本文件锚点（#标题）：目标即来源文档自身，同样带完整路径（规则不特判）', async () => {
    const h = tipHarness(new Map([['D:\\notes\\a.md', note('x')]]))
    const out = await resolveHoverTargetTip({ target: '#本文件标题' }, h.ctx)
    expect(out).toEqual({ ok: true, relPath: 'a.md', anchor: '#本文件标题' })
    expect(h.resolvedCalls).toEqual([]) // 本文件锚点不查文件系统
  })

  it('目标不存在照常显示意图路径（纯计算零探测）；escape / 非法形态仍 ok:false（2026-10-02 用户裁定）', async () => {
    // 空磁盘：不存在任何文件——提示仍「诚实地把链接目标反映出来」（无扩展名补 .md 意图路径）
    const h = tipHarness(new Map())
    expect(await resolveHoverTargetTip({ target: '不存在的笔记' }, h.ctx))
      .toEqual({ ok: true, relPath: '不存在的笔记.md', anchor: '' })
    // 越出根边界：无从构成根内相对路径，静默不出
    const esc = makeHarness(new Map(), () => ({ kind: 'escape' as const, detail: '' }))
    expect(await resolveHoverTargetTip({ target: '../越界' }, esc.ctx)).toEqual({ ok: false })
    // 形态学非法（空目标，parseWikilinkInner 归 null；[[ ]] 括号在 webview
    // 判定族已剥除，内部文字层宽容）：不出
    expect(await resolveHoverTargetTip({ target: '' }, h.ctx)).toEqual({ ok: false })
  })

  it('普通链接：linkHref 形态解析 + fragment 锚点（^ 前缀块 id 同形态附加）', async () => {
    const h = tipHarness(new Map([['D:\\notes\\b.md', note('x')]]))
    expect(await resolveHoverTargetTip({ linkHref: 'b.md' }, h.ctx))
      .toEqual({ ok: true, relPath: 'b.md', anchor: '' })
    expect(await resolveHoverTargetTip({ linkHref: 'b.md#小节' }, h.ctx))
      .toEqual({ ok: true, relPath: 'b.md', anchor: '#小节' })
    expect(await resolveHoverTargetTip({ linkHref: 'b.md#^blk' }, h.ctx))
      .toEqual({ ok: true, relPath: 'b.md', anchor: '#^blk' })
    // 页内锚点：目标即来源文档（路径相对根完整给出）
    expect(await resolveHoverTargetTip({ linkHref: '#页内' }, h.ctx))
      .toEqual({ ok: true, relPath: 'a.md', anchor: '#页内' })
    // 外部 scheme：不接入（webview 已预滤，宿主复核兜底）
    expect(await resolveHoverTargetTip({ linkHref: 'https://example.com/x' }, h.ctx))
      .toEqual({ ok: false })
  })

  it('指向图片等非 Markdown 目标：路径照常返回（提示不只服务笔记链接；不读正文）', async () => {
    const h = tipHarness(new Map([['D:\\notes\\assets\\图.png', { version: 1, text: '' }]]))
    const out = await resolveHoverTargetTip({ target: 'assets/图.png' }, h.ctx)
    expect(out).toEqual({ ok: true, relPath: 'assets/图.png', anchor: '' })
    expect(h.opened).toEqual([])
  })

  it('面板直接目标：fsPath 直取相对路径 + 锚点原文附加；空串 fsPath（断链）失败', async () => {
    const h = tipHarness(new Map())
    expect(await resolveHoverTargetTip(
      { directTarget: { fsPath: 'D:\\notes\\sub\\c.md' } }, h.ctx))
      .toEqual({ ok: true, relPath: 'sub/c.md', anchor: '' })
    expect(await resolveHoverTargetTip(
      { directTarget: { fsPath: 'D:\\notes\\sub\\c.md', anchor: '^blk' } }, h.ctx))
      .toEqual({ ok: true, relPath: 'sub/c.md', anchor: '#^blk' })
    expect(await resolveHoverTargetTip(
      { directTarget: { fsPath: 'D:\\notes\\sub\\c.md', anchor: '某标题' } }, h.ctx))
      .toEqual({ ok: true, relPath: 'sub/c.md', anchor: '#某标题' })
    expect(await resolveHoverTargetTip({ directTarget: { fsPath: '' } }, h.ctx))
      .toEqual({ ok: false })
    // 直接目标不走文本解析（resolve 端口零调用）
    expect(h.resolvedCalls).toEqual([])
  })

  it('多根工作区：路径相对其所属根（rootFsPath），文档在根子目录不改变口径', async () => {
    // 文档在根的子目录 sub 内：docDir=sub，目标解析基准为 docDir，
    // 但 relPath 计算基准恒为 rootFsPath（所属根）
    const h = makeHarness(new Map([['D:\\notes\\sub\\目标.md', note('x')]]))
    h.ctx.resolve.docDir = 'D:\\notes\\sub'
    h.ctx.sourceFsPath = 'D:\\notes\\sub\\a.md'
    const out = await resolveHoverTargetTip({ target: '目标' }, h.ctx)
    expect(out).toEqual({ ok: true, relPath: 'sub/目标.md', anchor: '' })
  })

  it('无工作区单文件：rootFsPath 为文档目录，路径相对当前文件目录（纯计算——hasWorkspace 不参与提示解析）', async () => {
    // 空磁盘 + 无工作区实条件：目标不在磁盘也照常显示（纯计算口径）
    const empty = tipHarness(new Map())
    empty.ctx.resolve.docDir = 'D:\\单文件夹'
    empty.ctx.resolve.rootDir = 'D:\\单文件夹'
    empty.ctx.resolve.hasWorkspace = false
    empty.ctx.sourceFsPath = 'D:\\单文件夹\\a.md'
    empty.ctx.rootFsPath = 'D:\\单文件夹'
    expect(await resolveHoverTargetTip({ target: '目标' }, empty.ctx))
      .toEqual({ ok: true, relPath: '目标.md', anchor: '' })
  })
})

describe('P2-03 全文可达与锚点初始定位（#280，ADR-0011）', () => {
  const TARGET_TEXT = ['顶部段。', '', '## 章节甲', '', '甲段。', '', '## 章节乙', '', '乙段。', ''].join('\n')
  const disk = (): Disk => new Map<string, { version: number; text: string }>([
    ['D:\\notes\\a.md', note('x')],
    ['D:\\notes\\目标.md', note(TARGET_TEXT, 4)],
  ])

  it('anchorOptional（刷新重载）：锚点缺失不构成失败——成功全文 + 定位区间退化为全文区间', async () => {
    const h = makeHarness(disk())
    const out = await readHoverDocTarget('目标#已删除的标题', h.ctx, h.ports, { anchorOptional: true })
    expect(out).toMatchObject({
      ok: true,
      fsPath: 'D:\\notes\\目标.md',
      version: 4,
      range: { start: 0, end: TARGET_TEXT.length },
      scope: { kind: 'heading', anchor: '已删除的标题' },
    })
    if (out.ok) {
      expect(out.lfText).toBe(TARGET_TEXT)
    }
  })

  it('不带 anchorOptional（首开）：锚点缺失仍 anchor-missing 分态（重开再验证原锚点）', async () => {
    const h = makeHarness(disk())
    const out = await readHoverDocTarget('目标#已删除的标题', h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'anchor-missing', anchor: '已删除的标题' })
  })

  it('anchorOptional 且锚点命中：行为与严格读取一致（range 仍为锚定定位区间）', async () => {
    const h = makeHarness(disk())
    const out = await readHoverDocTarget('目标#章节甲', h.ctx, h.ports, { anchorOptional: true })
    expect(out).toMatchObject({ ok: true, scope: { kind: 'heading', anchor: '章节甲' } })
    if (out.ok) {
      expect(out.range.start).toBe(TARGET_TEXT.indexOf('## 章节甲'))
      // 章节定位区间覆盖到下一同级标题之前（含章节尾内容，不含乙标题）
      expect(out.range.end).toBeGreaterThan(TARGET_TEXT.indexOf('甲段。'))
      expect(out.range.end).toBeLessThanOrEqual(TARGET_TEXT.indexOf('## 章节乙'))
    }
  })

  it('普通链接与直接目标入口同款 anchorOptional 语义', async () => {
    const h = makeHarness(disk())
    const md = await readHoverMdLinkTarget('目标.md#已删除的标题', h.ctx, h.ports, { anchorOptional: true })
    expect(md).toMatchObject({ ok: true, range: { start: 0, end: TARGET_TEXT.length } })
    const direct = await readHoverDirectTarget(
      { fsPath: 'D:\\notes\\目标.md', anchor: '^已删除' }, h.ctx, h.ports, { anchorOptional: true })
    expect(direct).toMatchObject({
      ok: true,
      range: { start: 0, end: TARGET_TEXT.length },
      scope: { kind: 'block', anchor: '^已删除' },
    })
  })
})

// #333（P3-01）类型分派入口：目标三形态（双链/普通链接/直接目标）解析
// 出 fsPath 后按类型分派——markdown 通道装载既有全文载荷（身份/版本/LF/
// 定位区间/选择器）；其余类型维持 non-markdown 分态（附件/外链载荷由
// P3-04/P3-05/P3-08/P3-10 登记）。旧三入口为兼容适配（经本入口后展开为
// 旧扁平形态）——等价矩阵钉住「同一输入两条入口同果」。
describe('#333 类型分派入口 readRefContentTarget', () => {
  function matrixDisk(): Disk {
    return new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n\n## 父章节\n\n父段。\n\n父块。 ^blk-p\n', 4)],
      ['D:\\notes\\目标.md', note(SECTION_DOC, 9)],
      ['D:\\notes\\图.png', note('binary')],
      ['D:\\notes\\资料.pdf', note('pdf-bytes')],
      ['D:\\notes\\脚本.ts', note('const x = 1\n')],
    ])
  }

  it('markdown 全文：类型化结果携带 kind 标记的 Markdown 载荷（身份在顶层、内容在 content）', async () => {
    const h = makeHarness(matrixDisk())
    const out = await readRefContentTarget({ target: '目标' }, h.ctx, h.ports)
    expect(out).toEqual({
      ok: true,
      fsPath: 'D:\\notes\\目标.md',
      relPath: '目标.md',
      content: {
        kind: 'markdown',
        version: 9,
        lfText: SECTION_DOC,
        range: { start: 0, end: SECTION_DOC.length },
        selector: { kind: 'full' },
      },
    } satisfies RefReadOutcome)
  })

  it('markdown 锚点两形态：heading/block 选择器与定位区间经类型化通道保真', async () => {
    const h = makeHarness(matrixDisk())
    const heading = await readRefContentTarget({ target: '目标#章节甲' }, h.ctx, h.ports)
    expect(heading.ok).toBe(true)
    if (heading.ok) {
      expect(heading.content.kind).toBe('markdown')
      expect(heading.content.selector).toEqual({ kind: 'heading', anchor: '章节甲' })
      expect(heading.content.lfText.slice(heading.content.range.start, heading.content.range.end))
        .toBe('## 章节甲\n\n甲段一。\n\n```js\nconst a = 1\n```')
    }
    const bh = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\目标.md', note(BLOCK_DOC)],
    ]))
    const block = await readRefContentTarget({ target: '目标#^blk1' }, bh.ctx, bh.ports)
    expect(block.ok).toBe(true)
    if (block.ok) {
      expect(block.content.selector).toEqual({ kind: 'block', anchor: '^blk1' })
    }
  })

  it('普通链接与直接目标形态同经类型化通道；页内锚点目标即来源文档', async () => {
    const h = makeHarness(matrixDisk())
    const link = await readRefContentTarget({ linkHref: '目标.md#章节乙' }, h.ctx, h.ports)
    expect(link.ok).toBe(true)
    if (link.ok) {
      expect(link.content.selector).toEqual({ kind: 'heading', anchor: '章节乙' })
    }
    const direct = await readRefContentTarget(
      { directTarget: { fsPath: 'D:\\notes\\目标.md', anchor: '章节甲' } }, h.ctx, h.ports)
    expect(direct.ok).toBe(true)
    if (direct.ok) {
      expect(direct.content.selector).toEqual({ kind: 'heading', anchor: '章节甲' })
    }
    const pageAnchor = await readRefContentTarget({ linkHref: '#父章节' }, h.ctx, h.ports)
    expect(pageAnchor.ok).toBe(true)
    if (pageAnchor.ok) {
      expect(pageAnchor.fsPath).toBe('D:\\notes\\a.md')
    }
  })

  it('非 markdown 类型（image/pdf）→ non-markdown 分态，读取端口零调用（不装载附件）。#340 起 text 走 text 通道（契约见 hoverDocAccessText.test.ts）', async () => {
    const h = makeHarness(matrixDisk())
    for (const [form, label] of [
      [{ target: '图.png' }, '双链图片'],
      [{ linkHref: '资料.pdf' }, '普通链接 PDF'],
    ] as Array<[{ target?: string; linkHref?: string; directTarget?: { fsPath: string; anchor?: string } }, string]>) {
      expect(await readRefContentTarget(form, h.ctx, h.ports), `${label} 应 non-markdown`).toEqual({
        ok: false,
        reason: 'non-markdown',
      })
    }
    expect(h.opened, '非 markdown 目标不读取正文').toEqual([])
  })

  it('失败分态经类型化通道原样保留（unsupported/not-found/escape/no-workspace）', async () => {
    const h = makeHarness(new Map())
    expect(await readRefContentTarget({ target: 'a#b#c' }, h.ctx, h.ports)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await readRefContentTarget({ target: '不存在' }, h.ctx, h.ports)).toEqual({ ok: false, reason: 'not-found' })
    const esc = makeHarness(new Map(), () => ({ kind: 'escape', detail: '../../x' }))
    expect(await readRefContentTarget({ target: '../../x' }, esc.ctx, esc.ports)).toEqual({ ok: false, reason: 'escape' })
    const noWs = makeHarness(new Map(), () => ({ kind: 'no-workspace' }))
    expect(await readRefContentTarget({ target: 'x' }, noWs.ctx, noWs.ports)).toEqual({ ok: false, reason: 'no-workspace' })
  })

  it('anchorOptional 语义经类型化通道保持（宽容重载回成功全文）', async () => {
    const h = makeHarness(matrixDisk())
    const out = await readRefContentTarget({ target: '目标#已删除的标题' }, h.ctx, h.ports, { anchorOptional: true })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.content.range).toEqual({ start: 0, end: SECTION_DOC.length })
      expect(out.content.selector).toEqual({ kind: 'heading', anchor: '已删除的标题' })
    }
    const strict = await readRefContentTarget({ target: '目标#已删除的标题' }, h.ctx, h.ports)
    expect(strict).toEqual({ ok: false, reason: 'anchor-missing', anchor: '已删除的标题' })
  })

  it('等价矩阵：同一输入下旧扁平入口与类型化入口内容一致（兼容适配不改变语义）', async () => {
    const disk = matrixDisk()
    const cases: Array<{
      label: string
      form: { target?: string; linkHref?: string; directTarget?: { fsPath: string; anchor?: string } }
    }> = [
      { label: '双链全文', form: { target: '目标' } },
      { label: '双链标题', form: { target: '目标#章节甲' } },
      { label: '双链本文件锚点', form: { target: '#父章节' } },
      { label: '普通链接全文', form: { linkHref: '目标.md' } },
      { label: '普通链接块锚点', form: { linkHref: '目标.md#章节乙' } },
      { label: '直接目标', form: { directTarget: { fsPath: 'D:\\notes\\目标.md' } } },
      { label: '非 markdown', form: { target: '图.png' } },
      { label: '不存在', form: { target: '不存在' } },
      { label: '锚点缺失', form: { target: '目标#没有的标题' } },
    ]
    for (const { label, form } of cases) {
      const h = makeHarness(new Map(disk))
      const legacy: HoverReadOutcome = form.directTarget !== undefined
        ? await readHoverDirectTarget(form.directTarget, h.ctx, h.ports)
        : form.linkHref !== undefined
          ? await readHoverMdLinkTarget(form.linkHref, h.ctx, h.ports)
          : await readHoverDocTarget(form.target!, h.ctx, h.ports)
      const typed = await readRefContentTarget(form, h.ctx, h.ports)
      // 兼容适配等价：类型化结果经 flattenHoverReadOutcome 展开后与旧扁平
      // 入口逐字段一致（身份 + kind 标记载荷 + 失败分态）
      expect(typed.ok, `${label}：成败一致`).toBe(legacy.ok)
      if (legacy.ok && typed.ok) {
        expect(flattenHoverReadOutcome(typed), `${label}：内容一致`).toEqual(legacy)
        expect(typed.content.kind, `${label}：kind 标记`).toBe('markdown')
      } else if (!legacy.ok && !typed.ok) {
        expect(typed, `${label}：失败分态一致`).toEqual(legacy)
      }
    }
  })
})
