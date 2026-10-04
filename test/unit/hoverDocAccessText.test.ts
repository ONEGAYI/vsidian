// #340（P3-08）text 通道契约：有界准入（大小/二进制/编码/超长行——不读
// 完整无界内容、不悄悄截断）、双链限定的 #line/#range 锚点（分词/校验/
// 窗口裁剪/跳转落点）、普链与直接目标锚点不生效、anchorOptional 钳制、
// 语言身份与外观端口注入。装配替身与 hoverDocAccess.test.ts 同构。
import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  readRefContentTarget,
  type HoverDocAccessContext,
  type HoverDocAccessPorts,
} from '../../src/host/hoverDocAccess'
import type { VaultLinkFileResolution } from '../../src/shared/vaultLink'

type Disk = Map<string, { version: number; text: string }>

interface Harness {
  ctx: HoverDocAccessContext
  ports: HoverDocAccessPorts
  opened: string[]
}

function makeHarness(disk: Disk): Harness {
  const opened: string[] = []
  const ctx: HoverDocAccessContext = {
    resolve: { docDir: 'D:\\notes', rootDir: 'D:\\notes', isWindowsHost: true, hasWorkspace: true },
    sourceFsPath: 'D:\\notes\\a.md',
    rootFsPath: 'D:\\notes',
  }
  const ports: HoverDocAccessPorts = {
    resolveVaultFile: async (rawPath) => {
      const base = path.win32.resolve(ctx.resolve.docDir, rawPath)
      for (const candidate of [base, `${base}.md`]) {
        if (disk.has(candidate)) {
          return { kind: 'target', fsPath: candidate } as VaultLinkFileResolution
        }
      }
      return { kind: 'not-found' } as VaultLinkFileResolution
    },
    openTextDocument: async (fsPath) => {
      opened.push(fsPath)
      const hit = disk.get(fsPath)
      return hit ? { version: hit.version, text: hit.text } : null
    },
  }
  return { ctx, ports, opened }
}

const note = (text: string, version = 1): { version: number; text: string } => ({ version, text })

describe('#340 text 通道：读取与载荷', () => {
  const SAMPLE = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].join('\n')

  function textHarness(disk?: Disk): Harness {
    return makeHarness(disk ?? new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\code.ts', note(SAMPLE, 5)],
    ]))
  }

  it('无锚点全文：窗口 [1,total]、落点 1、languageId 缺省 plaintext', async () => {
    const h = textHarness()
    const out = await readRefContentTarget({ target: 'code.ts' }, h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok || out.content.kind !== 'text') return
    expect(out.content.lfText).toBe(SAMPLE)
    expect(out.content.totalLines).toBe(6)
    expect(out.content.hasWindow).toBe(false)
    expect(out.content.beginLine).toBe(1)
    expect(out.content.endLine).toBe(6)
    expect(out.content.locateLine).toBe(1)
    expect(out.content.jumpLine).toBe(1)
    expect(out.content.range).toEqual({ start: 0, end: SAMPLE.length })
    expect(out.content.languageId).toBe('plaintext')
    expect(out.content.font).toEqual({})
    expect(out.content.lineNumbers).toBe(true)
    expect(out.fsPath).toBe('D:\\notes\\code.ts')
    expect(out.relPath).toBe('code.ts')
  })

  it('双链 #line=10：初始定位与跳转锚点落 10，全文可滚（无 range）', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\big.txt', note(Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join('\n'), 2)],
    ])
    const h = makeHarness(disk)
    const out = await readRefContentTarget({ target: 'big.txt#line=10' }, h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok || out.content.kind !== 'text') return
    expect(out.content.lfText).toContain('line-1\n')
    expect(out.content.hasWindow).toBe(false)
    expect(out.content.locateLine).toBe(10)
    expect(out.content.jumpLine).toBe(10)
    // 定位区间起点 = 前 9 行长度和（每行 'line-N' 6 字符 + 换行 = 7）
    expect(out.content.range.start).toBe(9 * 7)
  })

  it('双链 #range=3-5：硬窗口只携带 3-5 行（范围外不进载荷）、跳转落窗口起点 3', async () => {
    const h = textHarness()
    const out = await readRefContentTarget({ target: 'code.ts#range=3-5' }, h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (!out.ok || out.content.kind !== 'text') return
    expect(out.content.lfText).toBe('charlie\ndelta\necho')
    expect(out.content.hasWindow).toBe(true)
    expect(out.content.beginLine).toBe(3)
    expect(out.content.endLine).toBe(5)
    expect(out.content.locateLine).toBe(3)
    expect(out.content.jumpLine).toBe(3)
    expect(out.content.totalLines).toBe(6)
    expect(out.content.range.start).toBe(0) // 窗口内首行即定位行
  })

  it('组合 #line=4;range=3-5：窗口内定位 4；键序无关（range 先行同果）', async () => {
    const h = textHarness()
    const a = await readRefContentTarget({ target: 'code.ts#line=4;range=3-5' }, h.ctx, h.ports)
    const b = await readRefContentTarget({ target: 'code.ts#range=3-5;line=4' }, h.ctx, h.ports)
    expect(a).toEqual(b)
    expect(a.ok).toBe(true)
    if (!a.ok || a.content.kind !== 'text') return
    expect(a.content.locateLine).toBe(4)
    expect(a.content.jumpLine).toBe(4)
    expect(a.content.lfText).toBe('charlie\ndelta\necho')
    expect(a.content.range.start).toBe(8) // 'charlie\n' 长度
  })

  it('开放端：B- 到文件末、-E 从文件头', async () => {
    const h = textHarness()
    const openEnd = await readRefContentTarget({ target: 'code.ts#range=5-' }, h.ctx, h.ports)
    expect(openEnd.ok && openEnd.content.kind === 'text' && openEnd.content.lfText).toBe('echo\nfoxtrot')
    const openBegin = await readRefContentTarget({ target: 'code.ts#range=-2' }, h.ctx, h.ports)
    expect(openBegin.ok && openBegin.content.kind === 'text' && openBegin.content.lfText).toBe('alpha\nbravo')
  })

  it('languageId 与外观端口注入（语言级字体与行号开关透传）', async () => {
    const h = textHarness()
    const ports: HoverDocAccessPorts = {
      ...h.ports,
      openTextDocument: async (fsPath) => (fsPath === 'D:\\notes\\code.ts'
        ? { version: 5, text: SAMPLE, languageId: 'typescript' }
        : null),
      readTextEditorConfig: async () => ({ family: 'Cascadia Code, monospace', size: 20, ligatures: true, lineNumbers: false }),
    }
    const out = await readRefContentTarget({ target: 'code.ts' }, h.ctx, ports)
    expect(out.ok && out.content.kind === 'text' && out.content.languageId).toBe('typescript')
    if (!out.ok || out.content.kind !== 'text') return
    expect(out.content.font).toEqual({ family: 'Cascadia Code, monospace', size: 20, ligatures: true })
    expect(out.content.lineNumbers).toBe(false)
  })
})

describe('#340 text 通道：锚点非法分态（就地报错不静默回顶）', () => {
  const SAMPLE = ['one', 'two', 'three', 'four'].join('\n')

  function anchorHarness(): Harness {
    return makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\t.txt', note(SAMPLE, 1)],
    ]))
  }

  it.each([
    ['line=0', 'format'],
    ['line=-2', 'format'],
    ['line=abc', 'format'],
    ['line=1;line=2', 'format'],
    ['page=3', 'format'],
    ['some heading', 'format'],
    ['range=3-2', 'range-order'],
    ['line=50', 'out-of-bounds'],
    ['range=1-99', 'out-of-bounds'],
    ['line=3;range=1-2', 'line-outside-window'],
    // 验收示例显式契约（2026-10-04 修正口径）：10 越出 3–5 窗口——就地报错
    ['line=10;range=3-5', 'line-outside-window'],
  ])('锚点 "%s" -> anchor-invalid（%s）', async (anchor, detail) => {
    const h = anchorHarness()
    const out = await readRefContentTarget({ target: `t.txt#${anchor}` }, h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'anchor-invalid', anchor, anchorDetail: detail })
  })

  it('块引用形态（#^blk）对 text 目标非法（无块语义）', async () => {
    const h = anchorHarness()
    const out = await readRefContentTarget({ target: 't.txt#^blk-1' }, h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'anchor-invalid', anchor: '^blk-1', anchorDetail: 'format' })
  })

  it('双链限定：普链 fragment 与直接目标锚点不解析（按无锚点全文）', async () => {
    const h = anchorHarness()
    const mdlink = await readRefContentTarget({ linkHref: 't.txt#line=2' }, h.ctx, h.ports)
    expect(mdlink.ok && mdlink.content.kind === 'text' && mdlink.content.locateLine).toBe(1)
    const direct = await readRefContentTarget({ directTarget: { fsPath: 'D:\\notes\\t.txt', anchor: 'line=2' } }, h.ctx, h.ports)
    expect(direct.ok && direct.content.kind === 'text' && direct.content.locateLine).toBe(1)
  })

  it('anchorOptional（刷新重载）钳制：文件变短后 line/range 合法收口不失败', async () => {
    const h = anchorHarness()
    const line = await readRefContentTarget({ target: 't.txt#line=99' }, h.ctx, h.ports, { anchorOptional: true })
    expect(line.ok && line.content.kind === 'text' && line.content.locateLine).toBe(4)
    const range = await readRefContentTarget({ target: 't.txt#range=3-99' }, h.ctx, h.ports, { anchorOptional: true })
    expect(range.ok && range.content.kind === 'text' && range.content.endLine).toBe(4)
    const combo = await readRefContentTarget({ target: 't.txt#line=3;range=1-2' }, h.ctx, h.ports, { anchorOptional: true })
    // line=3 在窗口 [1,2] 外：钳回窗口内（收口语义——定位落窗口末）
    expect(combo.ok && combo.content.kind === 'text' && combo.content.locateLine).toBe(2)
    // B>E 仍报错（结构性矛盾无法钳出合理窗口；初次与刷新同口径）
    const order = await readRefContentTarget({ target: 't.txt#range=9-2' }, h.ctx, h.ports, { anchorOptional: true })
    expect(order).toEqual({ ok: false, reason: 'anchor-invalid', anchor: 'range=9-2', anchorDetail: 'range-order' })
  })
})

describe('#340 text 通道：有界准入（不读完整无界内容、不悄悄截断）', () => {
  const SAMPLE = 'const x = 1;\nconst y = 2;\n'

  function admissionHarness(
    stat: (fsPath: string) => Promise<number | null>,
    head: (fsPath: string, max: number) => Promise<Uint8Array | null>,
  ): Harness {
    const h = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\s.txt', note(SAMPLE, 1)],
    ]))
    h.ports = {
      ...h.ports,
      statFileSize: stat,
      readFileHead: head,
    }
    return h
  }

  it('超限文件：stat 判 file-too-large，不打开（openTextDocument 零调用）', async () => {
    const h = admissionHarness(async () => 3 * 1024 * 1024, async () => new Uint8Array())
    const out = await readRefContentTarget({ target: 's.txt' }, h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'file-too-large' })
    expect(h.opened).toEqual([])
  })

  it('二进制：头部 NUL 判 binary-file（不打开）', async () => {
    const h = admissionHarness(async () => 100, async () => new Uint8Array([0x41, 0x00, 0x42]))
    const out = await readRefContentTarget({ target: 's.txt' }, h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'binary-file' })
    expect(h.opened).toEqual([])
  })

  it('非法编码：严格 UTF-8 失败判 invalid-encoding（不打开）', async () => {
    const h = admissionHarness(async () => 100, async () => new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))
    const out = await readRefContentTarget({ target: 's.txt' }, h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'invalid-encoding' })
    expect(h.opened).toEqual([])
  })

  it('超长行：解码后判 line-too-long（不截断）', async () => {
    const longLine = 'x'.repeat(20_001)
    const h = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\long.txt', note(`ok\n${longLine}\n`, 1)],
    ]))
    const out = await readRefContentTarget({ target: 'long.txt' }, h.ctx, h.ports)
    expect(out).toEqual({ ok: false, reason: 'line-too-long' })
  })

  it('探测通过（UTF-8 文本/UTF-16 BOM）正常读取；端口缺省跳过检查', async () => {
    const ok = admissionHarness(async () => 100, async () => new TextEncoder().encode('const'))
    const utf16 = admissionHarness(async () => 100, async () => new Uint8Array([0xff, 0xfe, 0x41, 0x00]))
    for (const h of [ok, utf16]) {
      const out = await readRefContentTarget({ target: 's.txt' }, h.ctx, h.ports)
      expect(out.ok).toBe(true)
    }
    const noProbe = makeHarness(new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('x')],
      ['D:\\notes\\s.txt', note(SAMPLE, 1)],
    ]))
    const out = await readRefContentTarget({ target: 's.txt' }, noProbe.ctx, noProbe.ports)
    expect(out.ok).toBe(true)
  })
})
