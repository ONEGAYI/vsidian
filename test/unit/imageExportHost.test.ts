// 宿主图片导出纯逻辑与执行壳分支矩阵（工单 #212，review-loops 轮 1 补）：
// 文件名清洗 / 载荷校验 / 保存过滤器纯函数直驱；runImageExport 经 vscode
// 替身覆盖全部失败分支（invalid / 非 workspace / not-found / 目录型 /
// 超限 / read-failed / cancelled / 成功）——图表导出的 validate 与执行壳
// 分层先例在此补齐图片侧（此前零覆盖）。
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { statMock, readFileMock, writeFileMock, showSaveDialogMock, errorMessageMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  errorMessageMock: vi.fn(),
}))

vi.mock('vscode', () => ({
  Uri: {
    file: (p: string) => ({ scheme: 'file', fsPath: p, path: p.replace(/\\/g, '/') }),
    parse: (s: string) => {
      const mk = (path: string) => ({
        scheme: 'file',
        path,
        fsPath: path,
        with: ({ path: next }: { path: string }) => mk(next),
      })
      return mk(decodeURIComponent(s.replace(/^file:\/*/, '').replace(/\\/g, '/')))
    },
    joinPath: (base: { path: string }, seg: string) => ({
      scheme: 'file',
      path: `${base.path.replace(/\/$/, '')}/${seg}`,
      fsPath: `${base.path.replace(/\/$/, '')}/${seg}`,
    }),
  },
  workspace: {
    fs: { stat: statMock, readFile: readFileMock, writeFile: writeFileMock },
  },
  window: {
    showSaveDialog: showSaveDialogMock,
    showErrorMessage: errorMessageMock,
  },
  FileType: { File: 1, Directory: 2 },
}))

import {
  IMAGE_EXPORT_LIMITS,
  imageExportFilters,
  runImageExport,
  sanitizeImageExportFileName,
  validateImageExportPayload,
} from '../../src/host/imageExportHost'

const LINK_CTX = { docDir: 'D:/ws/notes', rootDir: 'D:/ws', isWindowsHost: false }
const DOC_URI = 'file:///d%3A/ws/notes/img.md'
const PAYLOAD = {
  kind: 'image.export', sessionId: 's1', docUri: DOC_URI,
  src: 'assets/pic a.png', fileName: 'pic a.png', reqId: 1,
} as const
type Outcome = { ok: boolean; reason?: string }

async function run(payload: unknown = PAYLOAD): Promise<Outcome> {
  const outcomes: Outcome[] = []
  await runImageExport(
    payload as never,
    LINK_CTX as never,
    DOC_URI,
    (o) => {
      outcomes.push(o)
    },
  )
  expect(outcomes).toHaveLength(1)
  return outcomes[0]!
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sanitizeImageExportFileName', () => {
  it('剥 Windows 非法字符与控制字符', () => {
    expect(sanitizeImageExportFileName('a:b*c?.png')).toBe('abc.png')
    expect(sanitizeImageExportFileName('a\u0000b.png')).toBe('ab.png')
  })
  it('空与纯点段回退默认名（.. 不再让预填退化为父目录）', () => {
    expect(sanitizeImageExportFileName('')).toBe('image.png')
    expect(sanitizeImageExportFileName('.')).toBe('image.png')
    expect(sanitizeImageExportFileName('..')).toBe('image.png')
    expect(sanitizeImageExportFileName('...')).toBe('image.png')
  })
  it('超长回退默认名（限长与粘贴 fileNameHint 同源）', () => {
    expect(sanitizeImageExportFileName(`${'a'.repeat(256)}.png`)).toBe('image.png')
    // 恰好 255 字符的名字不回退（限长边界）
    expect(sanitizeImageExportFileName(`${'a'.repeat(251)}.png`)).not.toBe('image.png')
    expect(IMAGE_EXPORT_LIMITS.fileNameMaxChars).toBe(255)
  })
})

describe('validateImageExportPayload', () => {
  it('缺字段 / 空 src / 超长 fileName 拒绝；合法通过', () => {
    expect(validateImageExportPayload(PAYLOAD)).toBe(true)
    expect(validateImageExportPayload({ ...PAYLOAD, src: '' })).toBe(false)
    expect(validateImageExportPayload({ ...PAYLOAD, fileName: '' })).toBe(false)
    expect(validateImageExportPayload({ ...PAYLOAD, fileName: 'a'.repeat(256) })).toBe(false)
    expect(validateImageExportPayload({ src: 'a.png' } as never)).toBe(false)
  })
})

describe('imageExportFilters', () => {
  it('png/svg 已知扩展名给过滤器，其余不限类型', () => {
    expect(Object.keys(imageExportFilters('a.png'))).toHaveLength(1)
    expect(Object.keys(imageExportFilters('a.svg'))).toHaveLength(1)
    expect(imageExportFilters('a.gif')).toEqual({})
    expect(imageExportFilters('noext')).toEqual({})
  })
})

describe('runImageExport 分支矩阵', () => {
  it('非法载荷 → invalid', async () => {
    expect(await run({ src: '', fileName: 'x.png', reqId: 1 })).toEqual({ ok: false, reason: 'invalid' })
    expect(errorMessageMock).toHaveBeenCalledTimes(1)
  })

  it('外链图源 → invalid（webview 已禁用，防御旧 webview）', async () => {
    expect(await run({ ...PAYLOAD, src: 'https://example.com/a.png', fileName: 'a.png', reqId: 1 }))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(errorMessageMock).toHaveBeenCalledTimes(1)
  })

  it('目标不存在（stat 抛错）→ not-found', async () => {
    statMock.mockRejectedValue(new Error('FileNotFound'))
    expect(await run()).toEqual({ ok: false, reason: 'not-found' })
    expect(errorMessageMock).toHaveBeenCalledTimes(1)
  })

  it('目录型目标（stat 非 File）→ not-found', async () => {
    statMock.mockResolvedValue({ type: 2, size: 10 })
    expect(await run()).toEqual({ ok: false, reason: 'not-found' })
  })

  it('超 64MB → not-found', async () => {
    statMock.mockResolvedValue({ type: 1, size: 64 * 1024 * 1024 + 1 })
    expect(await run()).toEqual({ ok: false, reason: 'not-found' })
  })

  it('stat 成功但读字节失败 → read-failed（与 not-found 区分的协议承诺）', async () => {
    statMock.mockResolvedValue({ type: 1, size: 100 })
    readFileMock.mockRejectedValue(new Error('EACCES'))
    expect(await run()).toEqual({ ok: false, reason: 'read-failed' })
  })

  it('对话框取消 → cancelled（无通知）', async () => {
    statMock.mockResolvedValue({ type: 1, size: 100 })
    readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    showSaveDialogMock.mockResolvedValue(undefined)
    expect(await run()).toEqual({ ok: false, reason: 'cancelled' })
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('成功：字节原样写盘、对话框预填文档目录', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    statMock.mockResolvedValue({ type: 1, size: 100 })
    readFileMock.mockResolvedValue(bytes)
    showSaveDialogMock.mockResolvedValue({ scheme: 'file', path: 'D:/out/pic a.png' })
    expect(await run()).toEqual({ ok: true })
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    expect(writeFileMock.mock.calls[0]![1]).toBe(bytes)
    const dialogArg = showSaveDialogMock.mock.calls[0]![0]
    expect(dialogArg.defaultUri.path).toContain('/notes/pic a.png')
  })

  it('写盘失败 → writeFailed', async () => {
    statMock.mockResolvedValue({ type: 1, size: 100 })
    readFileMock.mockResolvedValue(new Uint8Array([1]))
    showSaveDialogMock.mockResolvedValue({ scheme: 'file', path: 'D:/out/x.png' })
    writeFileMock.mockRejectedValue(new Error('EPERM'))
    expect(await run()).toEqual({ ok: false, reason: 'writeFailed' })
  })

  it('含 %XX 字面文件名不再被二次解码（与 image.request 同口径）', async () => {
    // 磁盘真名 a%20b.png（字面百分号）在显示链路的身份是 a%2520b.png
    // （webview 解码一次；classify 内部再容错解码得真名）。导出通道若
    // 多 decode 一次（修复前）会定位到 a b.png——错文件或 not-found
    statMock.mockResolvedValue({ type: 1, size: 100 })
    readFileMock.mockResolvedValue(new Uint8Array([9]))
    showSaveDialogMock.mockResolvedValue({ scheme: 'file', path: 'D:/o/x' })
    await run({ ...PAYLOAD, src: 'assets/a%2520b.png', fileName: 'a%20b.png' })
    const arg = statMock.mock.calls[0]![0] as { fsPath: string }
    expect(arg.fsPath.endsWith('a%20b.png')).toBe(true)
  })
})
