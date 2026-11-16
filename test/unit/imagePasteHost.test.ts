import { beforeEach, expect, it, vi } from 'vitest'

const { files, writeFile, stat, createDirectory } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  createDirectory: vi.fn(),
}))

vi.mock('vscode', () => {
  const uri = (path: string): object => ({ path, with: ({ path: next }: { path: string }) => uri(next), toString: () => `file://${path}` })
  return {
    Uri: { file: uri, joinPath: (base: { path: string }, name: string) => uri(`${base.path}/${name}`) },
    workspace: { fs: { stat, writeFile, createDirectory } },
    window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
  }
})

import * as vscode from 'vscode'
import { runImagePaste, type ImagePasteOutcome } from '../../src/host/imagePasteHost'

beforeEach(() => {
  files.clear()
  vi.clearAllMocks()
  createDirectory.mockResolvedValue(undefined)
  stat.mockImplementation(async ({ path }: { path: string }) => {
    if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'FileNotFound' })
    return { type: 1 }
  })
  writeFile.mockImplementation(async ({ path }: { path: string }, bytes: Uint8Array) => {
    files.set(path, Buffer.from(bytes).toString())
  })
})

it('R01 同一目录跨面板并发粘贴同名图片，编号分配与写入不覆盖前一笔', async () => {
  const outcomes: ImagePasteOutcome[] = []
  await Promise.all(['first', 'second'].map((value, index) => runImagePaste({
    kind: 'image.paste', sessionId: `panel-${index}`, docUri: `file:///notes/${index}.md`, reqId: 1,
    mime: 'image/png', dataBase64: Buffer.from(value).toString('base64'), fileNameHint: 'photo.png',
  }, {
    settings: {}, docUri: vscode.Uri.file(`/notes/${index}.md`), workspaceRootPath: '/notes',
  }, (outcome) => outcomes.push(outcome))))
  expect([...files]).toEqual([['/notes/photo.png', 'first'], ['/notes/photo-1.png', 'second']])
  expect(outcomes).toEqual([
    { ok: true, markdown: '![photo](photo.png)' },
    { ok: true, markdown: '![photo-1](photo-1.png)' },
  ])
})

it('R01 前一笔写入失败仍释放目录队列，后一笔正常保存且失败不虚报成功', async () => {
  writeFile.mockRejectedValueOnce(new Error('write failed'))
  const outcomes: ImagePasteOutcome[] = []
  const payload = { kind: 'image.paste' as const, sessionId: 'panel', docUri: 'file:///notes/a.md', reqId: 1,
    mime: 'image/png', dataBase64: Buffer.from('kept').toString('base64'), fileNameHint: 'photo.png' }
  const options = { settings: {}, docUri: vscode.Uri.file('/notes/a.md'), workspaceRootPath: '/notes' }
  await Promise.all([
    runImagePaste(payload, options, (outcome) => outcomes.push(outcome)),
    runImagePaste({ ...payload, reqId: 2 }, options, (outcome) => outcomes.push(outcome)),
  ])
  expect(outcomes).toEqual([{ ok: false, reason: 'write-failed' }, { ok: true, markdown: '![photo](photo.png)' }])
  expect([...files]).toEqual([['/notes/photo.png', 'kept']])
})
