// 悬停预览文档访问纯逻辑（#218）：readHoverDocTarget 的目标解析、身份/
// 版本契约、LF 全文与错误分态。读取路径不依赖写入（端口面只有解析与
// 读取，无任何写端口——「读取不依赖写入」的结构性表达）。
import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  readHoverDocTarget,
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

  it('本文件锚点（path 为空）目标即来源文档自身，不查文件系统', async () => {
    const disk = new Map<string, { version: number; text: string }>([
      ['D:\\notes\\a.md', note('# 父文档\n\n正文', 4)],
    ])
    const h = makeHarness(disk)
    const out = await readHoverDocTarget('#某标题', h.ctx, h.ports)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.fsPath).toBe('D:\\notes\\a.md')
      expect(out.relPath).toBe('a.md')
      expect(out.version).toBe(4)
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
