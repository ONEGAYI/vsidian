// 悬停预览文档访问纯逻辑（#218 目标解析、身份/版本契约、LF 全文与错误
// 分态；#219 扩展局部范围——标题章节/块引用与普通 Markdown 链接入口）。
// 读取路径不依赖写入（端口面只有解析与读取，无任何写端口——「读取不
// 依赖写入」的结构性表达）。
import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  readHoverDocTarget,
  readHoverMdLinkTarget,
  type HoverDocAccessContext,
  type HoverDocAccessPorts,
  type HoverReadOutcome,
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
