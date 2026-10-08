// #404 附加组件数据目录——守卫矩阵与服务契约单元测试。
// 守卫纯函数（isSafeAddonStoragePath）直接验证；服务（AddonStorageService，
// 零 vscode 依赖的纯逻辑模块）经注入内存 fs/watcher 端口验证——与
// addonSettingsService 的端口注入单测同模式。
import { describe, expect, it } from 'vitest'
import {
  ADDON_STORAGE_FILE_LIMIT_BYTES,
  isSafeAddonStoragePath,
} from '../../src/shared/addonStorage'
import { AddonStorageService, type AddonStorageFsPort } from '../../src/host/addons/addonStorageService'

describe('#404 相对路径守卫矩阵（单一事实源）', () => {
  it('合法形态放行', () => {
    expect(isSafeAddonStoragePath('rules.json')).toBe(true)
    expect(isSafeAddonStoragePath('sub/user-rules.json')).toBe(true)
    expect(isSafeAddonStoragePath('a/b/c/data.txt')).toBe(true)
  })
  it('越界与非法形态拒绝', () => {
    expect(isSafeAddonStoragePath('')).toBe(false)
    expect(isSafeAddonStoragePath('../escape.json')).toBe(false)
    expect(isSafeAddonStoragePath('a/../../escape')).toBe(false)
    expect(isSafeAddonStoragePath('/abs/path')).toBe(false)
    expect(isSafeAddonStoragePath('C:/win')).toBe(false)
    expect(isSafeAddonStoragePath('a\\b')).toBe(false)
    expect(isSafeAddonStoragePath('a//b')).toBe(false)
    expect(isSafeAddonStoragePath('a/./b')).toBe(false)
    expect(isSafeAddonStoragePath('x'.repeat(513))).toBe(false)
  })
})

describe('#404 AddonStorageService（内存 fs 端口）', () => {
  const FILE = 1
  const DIR = 2
  const BASE = '/gs/addons'

  interface Harness {
    service: AddonStorageService
    files: Map<string, Uint8Array | 'dir'>
    disposedWatchers: string[]
  }

  function makeService(initial: Record<string, string> = {}): Harness {
    const files: Map<string, Uint8Array | 'dir'> = new Map(
      Object.entries(initial).map(([path, content]) => [path, Buffer.from(content, 'utf8')]),
    )
    const disposedWatchers: string[] = []
    const fs: AddonStorageFsPort = {
      readFile: async (path) => {
        const entry = files.get(path)
        if (entry === undefined || entry === 'dir') throw new Error(`ENOENT ${path}`)
        return entry
      },
      writeFile: async (path, content) => {
        files.set(path, content)
      },
      delete: async (path) => {
        files.delete(path)
      },
      readDirectory: async (path) => {
        const prefix = `${path}/`
        const out: Array<[string, number]> = []
        const seen = new Set<string>()
        for (const key of files.keys()) {
          if (!key.startsWith(prefix)) continue
          const rest = key.slice(prefix.length)
          if (rest === '') continue
          const slash = rest.indexOf('/')
          if (slash === -1) {
            out.push([rest, files.get(key) === 'dir' ? DIR : FILE])
          } else {
            const dir = rest.slice(0, slash)
            if (!seen.has(dir)) {
              seen.add(dir)
              out.push([dir, DIR])
            }
          }
        }
        return out
      },
      createDirectory: async (path) => {
        files.set(path, 'dir')
      },
    }
    return {
      files,
      disposedWatchers,
      service: new AddonStorageService({
        baseDir: BASE,
        uriOf: (addonId) => `file:///gs/addons/${addonId}`,
        fs,
        createWatcher: (dirPath) => ({
          dispose: () => {
            disposedWatchers.push(dirPath)
          },
        }),
      }),
    }
  }

  const ADDON = 'pub.my-addon'

  it('write → read 往返（UTF-8）；uri 为组件隔离目录', async () => {
    const { service } = makeService()
    const storage = service.storageFor(ADDON)
    expect(storage.uri()).toBe(`file:///gs/addons/${ADDON}`)
    expect((await storage.writeFile('rules/user.json', '{"k": "值"}')).ok).toBe(true)
    expect(await storage.readFile('rules/user.json')).toEqual({ ok: true, value: '{"k": "值"}' })
  })

  it('越界/非法路径拒绝 invalid-path（不触达 fs）', async () => {
    const { service } = makeService()
    const storage = service.storageFor(ADDON)
    for (const bad of ['../escape', 'a/../../x', '/abs', 'C:/x', 'a\\b', '']) {
      expect(await storage.readFile(bad)).toMatchObject({ ok: false, reason: 'invalid-path' })
      expect(await storage.writeFile(bad, 'x')).toMatchObject({ ok: false, reason: 'invalid-path' })
      expect(await storage.deleteFile(bad)).toMatchObject({ ok: false, reason: 'invalid-path' })
    }
  })

  it('单文件超限拒绝 too-large（上限常量口径）', async () => {
    const { service } = makeService()
    const storage = service.storageFor(ADDON)
    const oversized = 'x'.repeat(ADDON_STORAGE_FILE_LIMIT_BYTES + 1)
    expect(await storage.writeFile('big.txt', oversized)).toEqual({ ok: false, reason: 'too-large' })
  })

  it('list：一层与递归', async () => {
    const { service } = makeService({
      '/gs/addons/pub.my-addon/builtin-rules.json': '[]',
      '/gs/addons/pub.my-addon/sub/user-rules.json': '[]',
    })
    const storage = service.storageFor(ADDON)
    const flat = await storage.list()
    expect(flat.ok && flat.entries.length).toBe(2)
    expect(await storage.list(undefined, true)).toMatchObject({
      ok: true,
      entries: [
        { path: 'builtin-rules.json', kind: 'file' },
        { path: 'sub', kind: 'directory' },
        { path: 'sub/user-rules.json', kind: 'file' },
      ],
    })
  })

  it('deleteFile 删除；不同 addonId 目录隔离', async () => {
    const { service } = makeService({
      '/gs/addons/pub.a/rules.json': 'A',
      '/gs/addons/pub.b/rules.json': 'B',
    })
    const a = service.storageFor('pub.a')
    const b = service.storageFor('pub.b')
    expect(await a.readFile('rules.json')).toEqual({ ok: true, value: 'A' })
    expect((await a.deleteFile('rules.json')).ok).toBe(true)
    expect(await a.readFile('rules.json')).toMatchObject({ ok: false, reason: 'error' })
    expect(await b.readFile('rules.json')).toEqual({ ok: true, value: 'B' })
  })

  it('读不存在文件 → error 拒绝（可辨认，不抛出）', async () => {
    const { service } = makeService()
    const result = await service.storageFor(ADDON).readFile('missing.json')
    expect(result).toMatchObject({ ok: false, reason: 'error' })
  })

  it('onDidChangeFile：多订阅共享一个底层 watcher，全退订注销；release 注销', async () => {
    const { service, disposedWatchers } = makeService()
    const storage = service.storageFor(ADDON)
    const seen: string[] = []
    const h1 = storage.onDidChangeFile((path) => seen.push(`a:${path}`))
    const h2 = storage.onDidChangeFile((path) => seen.push(`b:${path}`))
    expect(disposedWatchers).toEqual([])
    h1.dispose()
    expect(disposedWatchers).toEqual([]) // 仍有订阅：底层保留
    h2.dispose()
    expect(disposedWatchers).toEqual([`/gs/addons/${ADDON}`]) // 全退订：注销
    // release 注销（模拟：重新订阅后 release）
    const h3 = storage.onDidChangeFile(() => {})
    service.release(ADDON)
    expect(disposedWatchers).toHaveLength(2)
    h3.dispose()
  })
})
