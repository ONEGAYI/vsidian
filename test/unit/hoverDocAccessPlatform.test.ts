// 平台无关性钉子（CI Linux 修复回归）：readRefContentTarget 的 image 分派
// 中「图源相对来源文档目录」的计算（src）不得依赖运行平台的默认 path 模块
// ——默认模块在 Linux 上是 posix 语义，dirname 对 Windows 风格路径
// （D:\notes\a.md）返回 '.'，导致 win32.relative 无法相对化而回退绝对路径
// （CI 实测产出 'D:/notes/图.png'）。本文件用 vi.mock 把默认 dirname 替换
// 为 posix.dirname，在任意平台复刻「运行于 Linux + isWindowsHost: true 语境」
// 的组合，使该缺陷在 Windows 本地也能先红后绿；win32/posix 命名空间保持
// 原样（实现按 isWindowsHost 显式选择的部分不受影响）。
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual, dirname: actual.posix.dirname }
})

import { describe, expect, it, vi } from 'vitest'
import { readRefContentTarget } from '../../src/host/hoverDocAccess'
import type { HoverDocAccessContext, HoverDocAccessPorts } from '../../src/host/hoverDocAccess'

/** 复刻 CI 失败语境：Windows 宿主语义（isWindowsHost: true）+ win 风格假路径 */
function winCtx(): HoverDocAccessContext {
  return {
    resolve: { docDir: 'D:\\notes', rootDir: 'D:\\notes', isWindowsHost: true, hasWorkspace: true },
    sourceFsPath: 'D:\\notes\\a.md',
    rootFsPath: 'D:\\notes',
  }
}

describe('#336 image 分派：src 计算不随运行平台漂移（Linux 模拟）', () => {
  it('子目录图源：src 相对来源文档目录，posix 默认模块在场仍得相对路径', async () => {
    const ports: HoverDocAccessPorts = {
      resolveVaultFile: async () => ({ kind: 'target', fsPath: 'D:\\notes\\assets\\子图.jpeg' }),
      openTextDocument: async () => null,
    }
    const out = await readRefContentTarget({ target: 'assets/子图.jpeg' }, winCtx(), ports)
    expect(out.ok).toBe(true)
    if (out.ok && out.content.kind === 'image') {
      expect(out.content.src, 'dirname 漂移时退化为 D:/notes/assets/子图.jpeg').toBe('assets/子图.jpeg')
    }
  })

  it('来源同目录图源：src 为裸文件名，不携带目录前缀', async () => {
    const ports: HoverDocAccessPorts = {
      resolveVaultFile: async () => ({ kind: 'target', fsPath: 'D:\\notes\\图.png' }),
      openTextDocument: async () => null,
    }
    const out = await readRefContentTarget({ target: '图.png' }, winCtx(), ports)
    expect(out.ok).toBe(true)
    if (out.ok && out.content.kind === 'image') {
      expect(out.content.src).toBe('图.png')
    }
  })
})
