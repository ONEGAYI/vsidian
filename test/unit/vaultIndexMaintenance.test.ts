// 索引维护接线契约测试（#198）：排除模式持久化存取（workspaceState 端口
// 注入内存实现）、维护操作编排（保存→服务生效→状态推送、重建/清理状态
// 机与 notice）、无工作区降级。服务为真实 VaultIndexService（fake 端口），
// 不新造 mock seam。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  createIndexMaintenance,
  createIndexSettingsStore,
  initialExcludePatterns,
  type IndexSettingsStorage,
} from '../../src/host/vaultIndexMaintenance'
import { VaultIndexService, type VaultIndexScanPort, type VaultIndexStoragePort } from '../../src/host/vaultIndexService'
import { DEFAULT_EXCLUDE_PATTERNS, EXCLUDE_PATTERN_MAX_LENGTH } from '../../src/shared/vaultIndexExclude'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** 内存 Memento（vscode workspaceState 结构） */
function memoryStorage(initial: Record<string, unknown> = {}): IndexSettingsStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    get: (<T>(key: string): T | undefined => data.get(key) as T | undefined),
    update: (key: string, value: unknown) => {
      data.set(key, value)
      return Promise.resolve()
    },
  }
}

interface FakeFs {
  files: Map<string, string>
  stats: Map<string, { mtimeMs: number; size: number }>
}

function makeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map(Object.entries(initial))
  const stats = new Map<string, { mtimeMs: number; size: number }>()
  for (const [p, c] of files) {
    stats.set(p, { mtimeMs: 1_700_000_000_000, size: c.length })
  }
  return { files, stats }
}

// 测试钉住 win32 语义：fixture 路径与断言全按 win32 形态书写（C:/、大小写折叠），
// isWindowsHost 注入即为此可测性服务——不随运行平台漂移（CI Linux 同样按 win32 语义断言）
const IS_WIN = true

function scanPortOf(fs: FakeFs): VaultIndexScanPort & { inaccessible: Set<string> } {
  const inaccessible = new Set<string>()
  return {
    inaccessible,
    async listMarkdownFiles(rootFsPath: string) {
      const prefix = rootFsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/'
      return [...fs.files.keys()].filter((p) => p.startsWith(prefix) && /\.md$/i.test(p))
    },
    async listAllFiles(rootFsPath: string, opts?: { skipDir?: (fsPath: string) => boolean }) {
      // #377 T02 全文件清单：列根内全部文件（skipDir 剪枝；无失败目录）
      const prefix = rootFsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/'
      const all = [...fs.files.keys()].filter((p) => p.startsWith(prefix))
      if (!opts?.skipDir) {
        return { files: all, failedDirs: [] }
      }
      const pruned = new Set<string>()
      for (const p of all) {
        let d = p.slice(0, p.lastIndexOf('/'))
        while (d.length >= prefix.length) {
          if (opts.skipDir(d)) {
            pruned.add(d)
          }
          d = d.slice(0, d.lastIndexOf('/'))
        }
      }
      return {
        files: all.filter((p) => ![...pruned].some((d) => p.startsWith(`${d}/`))),
        failedDirs: [],
      }
    },
    async readFileText(fsPath: string) {
      const key = fsPath.replace(/\\/g, '/')
      return inaccessible.has(key) ? null : (fs.files.get(key) ?? null)
    },
    async statFile(fsPath: string) {
      const key = fsPath.replace(/\\/g, '/')
      return inaccessible.has(key) ? null : (fs.stats.get(key) ?? null)
    },
    async accessOf(fsPath: string) {
      const key = fsPath.replace(/\\/g, '/')
      if (inaccessible.has(key)) {
        return 'inaccessible' as const
      }
      return fs.files.has(key) ? ('ok' as const) : ('missing' as const)
    },
    watchRoot() {
      return () => {}
    },
    async yieldToEventLoop() {
      await Promise.resolve()
    },
  }
}

function storagePortOf(): VaultIndexStoragePort & { files: Map<string, string>; writes: string[] } {
  const files = new Map<string, string>()
  const writes: string[] = []
  return {
    files,
    writes,
    async listDirs(baseDir: string) {
      const names = new Set<string>()
      for (const key of files.keys()) {
        if (!key.startsWith(baseDir + '/')) continue
        const rest = key.slice(baseDir.length + 1)
        if (rest.includes('/')) names.add(rest.split('/')[0])
      }
      return [...names]
    },
    async readFile(path: string) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT ${path}`)
      return content
    },
    async writeFile(path: string, content: string) {
      writes.push(path)
      files.set(path, content)
    },
    async removeDir(path: string) {
      for (const key of [...files.keys()]) {
        if (key.startsWith(path + '/')) files.delete(key)
      }
    },
    async ensureDir() {},
  }
}

/** 真实服务 + 内存存储的维护接线装配 */
async function makeWiring(initial: Record<string, string> = {}, persisted?: Record<string, unknown>) {
  const fs = makeFs(initial)
  const scan = scanPortOf(fs)
  const storage = storagePortOf()
  const settingsStore = createIndexSettingsStore(memoryStorage(persisted))
  const service = new VaultIndexService(scan, storage, {
    storageRoot: 'C:/store', isWindowsHost: IS_WIN, scanBatchFiles: 2,
    excludePatterns: initialExcludePatterns(settingsStore),
  })
  const maintenance = createIndexMaintenance(settingsStore, service)
  const events: string[] = []
  maintenance.onStateChanged(() => events.push('changed'))
  await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
  return { fs, scan, storage, settingsStore, service, maintenance, events }
}

describe('排除模式持久化存取', () => {
  it('无存储返回 null（调用方回落默认）；initialExcludePatterns 给默认值', () => {
    const store = createIndexSettingsStore(memoryStorage())
    expect(store.load()).toBeNull()
    expect(initialExcludePatterns(store)).toEqual([...DEFAULT_EXCLUDE_PATTERNS])
  })

  it('空数组是合法存储（显式清空），不回落默认', () => {
    const store = createIndexSettingsStore(memoryStorage({ 'vsidian.index.excludePatterns': [] }))
    expect(store.load()).toEqual([])
    expect(initialExcludePatterns(store)).toEqual([])
  })

  it('损坏存储（非数组）按无存储处理；保存后可读回', async () => {
    const storage = memoryStorage({ 'vsidian.index.excludePatterns': 'garbage' })
    const store = createIndexSettingsStore(storage)
    expect(store.load()).toBeNull()
    await store.save(['x/**'])
    expect(store.load()).toEqual(['x/**'])
    expect(store.raw()).toEqual(['x/**'])
  })
})

describe('维护接线：模式保存与服务生效', () => {
  it('setPatterns 持久化 + 服务覆盖范围重算生效 + patterns-saved 推送', async () => {
    const { service, maintenance, settingsStore } = await makeWiring({
      'C:/vault/a.md': '# A\n\n见 [[ex/秘密]]。\n',
      'C:/vault/ex/秘密.md': '# 秘密\n',
    })
    await maintenance.setPatterns(['ex/**'])
    expect(service.getExcludePatterns()).toEqual(['ex/**'])
    expect(settingsStore.load()).toEqual(['ex/**'])
    const state = maintenance.getState()
    expect(state.patterns).toEqual(['ex/**'])
    expect(state.notice).toEqual({ kind: 'patterns-saved' })
    expect(state.defaults).toEqual([...DEFAULT_EXCLUDE_PATTERNS])
  })

  it('非法项进 notice 回显（合法项照常保存生效）', async () => {
    const { service, maintenance } = await makeWiring({ 'C:/vault/a.md': '# A\n' })
    const tooLong = 'a'.repeat(EXCLUDE_PATTERN_MAX_LENGTH + 1)
    await maintenance.setPatterns(['ok/**', tooLong])
    expect(service.getExcludePatterns()).toEqual(['ok/**'])
    expect(maintenance.getState().notice).toEqual({
      kind: 'patterns-invalid', detail: tooLong,
    })
  })

  it('resetPatterns 恢复默认清单并持久化', async () => {
    const { service, maintenance, settingsStore } = await makeWiring({ 'C:/vault/a.md': '# A\n' })
    await maintenance.setPatterns(['x/**'])
    await maintenance.resetPatterns()
    expect(service.getExcludePatterns()).toEqual([...DEFAULT_EXCLUDE_PATTERNS])
    expect(settingsStore.load()).toEqual([...DEFAULT_EXCLUDE_PATTERNS])
  })

  it('状态变更触发 onStateChanged（设置页 index.state 推送链路）', async () => {
    const { maintenance, events } = await makeWiring({ 'C:/vault/a.md': '# A\n' })
    const before = events.length
    await maintenance.setPatterns(['x/**'])
    expect(events.length).toBeGreaterThan(before)
  })
})

describe('维护接线：重建与清理', () => {
  it('rebuild 返回 done，状态机 idle→rebuilding→idle、进度入 state', async () => {
    const { maintenance } = await makeWiring({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const statuses: string[] = []
    maintenance.onStateChanged(() => statuses.push(maintenance.getState().status))
    const result = await maintenance.rebuild()
    expect(result).toBe('done')
    expect(statuses[0]).toBe('rebuilding')
    expect(maintenance.getState().status).toBe('idle')
    expect(maintenance.getState().notice).toEqual({ kind: 'rebuild-done' })
  })

  it('cleanup 返回移除数并置 cleanup-done；进度不适用（null）', async () => {
    const { maintenance } = await makeWiring({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const result = await maintenance.cleanup()
    expect(typeof result === 'object' && result.removedDirs >= 0).toBe(true)
    expect(maintenance.getState().status).toBe('idle')
    expect(maintenance.getState().notice).toEqual({ kind: 'cleanup-done', detail: expect.any(String) })
  })

  it('重建进行中重复触发返回 busy（互斥；维护进行中不是失败）', async () => {
    const files: Record<string, string> = { 'C:/vault/b.md': '# B\n' }
    for (let i = 0; i < 3; i++) files[`C:/vault/a${i}.md`] = `# A${i}\n\n见 [[b]]。\n`
    const { maintenance } = await makeWiring(files)
    const first = maintenance.rebuild()
    const second = await maintenance.rebuild()
    expect(second).toBe('busy')
    // busy 拒绝不覆盖 notice（首次操作的反馈不被误置为失败）
    expect(maintenance.getState().notice).toBeNull()
    expect(await first).toBe('done')
  })

  it('清理进行中触发重建返回 busy（互斥；不冒充失败弹空详情）', async () => {
    const files: Record<string, string> = { 'C:/vault/b.md': '# B\n' }
    const { maintenance } = await makeWiring(files)
    const first = maintenance.cleanup()
    const second = await maintenance.rebuild()
    expect(second).toBe('busy')
    await first
    expect(maintenance.getState().status).toBe('idle')
  })
})

describe('无工作区降级', () => {
  it('无服务时：模式仍可保存持久化；重建/清理返回 unavailable', async () => {
    const settingsStore = createIndexSettingsStore(memoryStorage())
    const maintenance = createIndexMaintenance(settingsStore, undefined)
    expect(maintenance.getState().available).toBe(false)
    await maintenance.setPatterns(['x/**'])
    expect(settingsStore.load()).toEqual(['x/**'])
    expect(await maintenance.rebuild()).toBe('unavailable')
    expect(await maintenance.cleanup()).toBe('unavailable')
    // persistedRaw 供测试钩子观测
    expect(maintenance.persistedRaw()).toEqual(['x/**'])
  })
})
