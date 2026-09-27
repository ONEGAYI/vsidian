// CSS 片段宿主服务契约（#128）：目录配置与开关的持久化、扫描状态机
// （默认关闭/排序/读取失败保留最近成功清单）、监听事件去抖、陈旧扫描
// 作废、用户可见失败提示。存储与文件系统均为注入假件（服务不依赖 vscode）。
import { describe, it, expect } from 'vitest'
import {
  CssSnippetService,
  type CssSnippetFsPort,
  type CssSnippetStorage,
} from '../../src/host/cssSnippetService'

interface Deferred<T> {
  promise: Promise<T>
  resolve(): void
}

function deferred<T>(value: T): Deferred<T> {
  let settle!: (v: T) => void
  const promise = new Promise<T>((r) => {
    settle = r
  })
  return { promise, resolve: () => settle(value) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 假持久层：记录写入，可注入失败 */
function makeStorage(writes: Array<{ key: string; value: unknown }> = []): CssSnippetStorage & {
  writes: typeof writes
  failNext: boolean
} {
  const store = new Map<string, unknown>()
  const storage: CssSnippetStorage & { writes: typeof writes; failNext: boolean } = {
    writes,
    failNext: false,
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: async (key, value) => {
      if (storage.failNext) {
        storage.failNext = false
        throw new Error('storage unavailable')
      }
      store.set(key, value)
      writes.push({ key, value })
    },
  }
  return storage
}

/** 假文件系统端口：脚本化目录清单与监听 */
interface FakeSnippetFs extends CssSnippetFsPort {
  listing: string[] | null
  fail: boolean
  scans: number
  watcherEvents(): void
  watcherDirs: string[]
  disposedWatchers: number
  pendingScan: Deferred<string[]> | null
}

function makeFs(initial: string[] | null = null): FakeSnippetFs {
  const notifyRef: { notify: (changedPath: string | null) => void } = { notify: () => {} }
  const port: FakeSnippetFs = {
    listing: initial,
    fail: false,
    scans: 0,
    watcherDirs: [],
    disposedWatchers: 0,
    pendingScan: null,
    watcherEvents: () => notifyRef.notify(null),
    listCssFiles: async () => {
      port.scans += 1
      if (port.pendingScan) {
        const listing = await port.pendingScan.promise
        return port.fail ? null : listing
      }
      return port.fail ? null : port.listing
    },
    watchDirectory: (dir, onEvent) => {
      port.watcherDirs.push(dir)
      notifyRef.notify = onEvent
      return () => {
        port.disposedWatchers += 1
        if (notifyRef.notify === onEvent) {
          notifyRef.notify = () => {}
        }
      }
    },
    // #129 依赖分析端口：默认无可读文本（条目照常入清单——装载成败由
    // webview 回报），realpath 恒等（无符号链接）
    readFileText: async () => null,
    realpath: async (p) => p,
  }
  return port
}

function makeService(storage: CssSnippetStorage, fs: CssSnippetFsPort, debounceMs = 1) {
  return new CssSnippetService(storage, fs, 'vsidian.cssSnippets', { debounceMs })
}

describe('初始状态与初次扫描', () => {
  it('未配置目录：空清单、无失败态，initialize 不触发扫描通知', async () => {
    const fs = makeFs(['a.css'])
    const svc = makeService(makeStorage(), fs)
    expect(svc.getState()).toEqual({ directory: null, readError: false, entries: [], version: 0, rejections: {} })
    await svc.initialize()
    expect(fs.scans).toBe(0)
    expect(fs.watcherDirs).toEqual([])
  })

  it('已存目录重启回读：构造即得目录，initialize 扫描出排序清单（默认关闭）并挂监听', async () => {
    const storage = makeStorage()
    await storage.update('vsidian.cssSnippets', { directory: 'D:/snips', enabled: { 'a.css': true } })
    const fs = makeFs(['b.css', 'a.css'])
    const svc = makeService(storage, fs)
    expect(svc.getState().directory).toBe('D:/snips')
    const reasons: string[] = []
    svc.onChange((_state, reason) => reasons.push(reason))
    await svc.initialize()
    expect(svc.getState().entries).toEqual([
      { name: 'a.css', enabled: true },
      { name: 'b.css', enabled: false },
    ])
    expect(svc.getState().version).toBe(1)
    expect(reasons).toEqual(['initialize'])
    expect(fs.watcherDirs).toEqual(['D:/snips'])
  })
})

describe('目录配置（setDirectory）', () => {
  it('设置目录：清空开关映射、扫描产出清单并持久化', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/theme')
    expect(svc.getState().entries).toEqual([{ name: 'a.css', enabled: false }])
    expect(storage.writes.at(-1)?.value).toEqual({ directory: 'D:/theme', enabled: {} })
    expect(fs.watcherDirs).toEqual(['D:/theme'])
  })

  it('换目录重置开关：旧目录的显式开启不带入新目录', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/one')
    await svc.setEnabled('a.css', true)
    fs.listing = ['a.css', 'b.css']
    await svc.setDirectory('D:/two')
    expect(svc.getState().entries).toEqual([
      { name: 'a.css', enabled: false },
      { name: 'b.css', enabled: false },
    ])
    expect(svc.getStored().enabled).toEqual({})
  })

  it('取消配置（null）：清单清空、版本推进一次（撤下 webview 已装片段）、监听摘除', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/one')
    await svc.setEnabled('a.css', true)
    const versionBefore = svc.getState().version
    await svc.setDirectory(null)
    const state = svc.getState()
    expect(state.directory).toBeNull()
    expect(state.entries).toEqual([])
    expect(state.version).toBe(versionBefore + 1)
    // 重复取消：无新通知、版本不动
    const seen: number[] = []
    svc.onChange((s) => seen.push(s.version))
    await svc.setDirectory(null)
    expect(seen).toEqual([])
    expect(svc.getState().version).toBe(versionBefore + 1)
    expect(fs.disposedWatchers).toBeGreaterThanOrEqual(1)
  })

  it('非法目录值拒绝；持久层写入失败返回 storage 且状态不变', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    expect((await svc.setDirectory('')).ok).toBe(false)
    expect((await svc.setDirectory(42 as never)).ok).toBe(false)
    storage.failNext = true
    const result = await svc.setDirectory('D:/x')
    expect(result).toEqual({ ok: false, reason: 'storage' })
    expect(svc.getState().directory).toBeNull()
  })
})

describe('逐片段开关（setEnabled）', () => {
  it('持久化显式开关并反映进清单；版本推进、通知 reason=enabled', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css', 'b.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/snips')
    const reasons: string[] = []
    svc.onChange((_s, reason) => reasons.push(reason))
    const versionBefore = svc.getState().version
    const result = await svc.setEnabled('b.css', true)
    expect(result.ok).toBe(true)
    expect(svc.getState().entries).toEqual([
      { name: 'a.css', enabled: false },
      { name: 'b.css', enabled: true },
    ])
    expect(svc.getState().version).toBe(versionBefore + 1)
    expect(reasons).toEqual(['enabled'])
    expect(svc.getStored().enabled).toEqual({ 'b.css': true })
    // 关闭走同一入口
    await svc.setEnabled('b.css', false)
    expect(svc.getStored().enabled).toEqual({ 'b.css': false })
  })

  it('非法参数拒绝（空名/非布尔），零写入', async () => {
    const storage = makeStorage()
    const svc = makeService(makeStorage(), makeFs([]))
    expect((await svc.setEnabled('', true)).ok).toBe(false)
    expect((await svc.setEnabled('a.css', 'on' as never)).ok).toBe(false)
    expect(storage.writes).toEqual([])
  })

  it('文件不在当前清单也允许翻转（原子保存窗口内的操作不丢）', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('a.css', true)
    // 文件被（暂时）移走：清单不含，但开关保留
    fs.listing = []
    await svc.refresh()
    expect(svc.getState().entries).toEqual([])
    expect(svc.getStored().enabled).toEqual({ 'a.css': true })
    // 文件回来：开关仍然生效
    fs.listing = ['a.css']
    await svc.refresh()
    expect(svc.getState().entries).toEqual([{ name: 'a.css', enabled: true }])
  })
})

describe('读取失败语义（保留最近成功）', () => {
  it('扫描失败：清单与版本保持最近成功值、readError 置位并通知 scan-failed', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('a.css', true)
    const before = svc.getState()
    const reasons: string[] = []
    svc.onChange((_s, reason) => reasons.push(reason))
    fs.fail = true
    await svc.refresh()
    const after = svc.getState()
    expect(after.readError).toBe(true)
    expect(after.entries).toEqual(before.entries)
    expect(after.version).toBe(before.version)
    expect(reasons).toEqual(['scan-failed'])
    // 恢复：失败态清除、版本推进
    fs.fail = false
    fs.listing = ['a.css', 'new.css']
    await svc.refresh()
    expect(svc.getState().readError).toBe(false)
    expect(svc.getState().entries.map((e) => e.name)).toEqual(['a.css', 'new.css'])
  })

  it('连续失败只通知一次（不重复打扰）；用户主动触发的失败经回调提示，后台失败不提示', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const errors: string[] = []
    const svc = new CssSnippetService(storage, fs, 'vsidian.cssSnippets', {
      debounceMs: 1,
      onUserVisibleReadError: (dir) => errors.push(dir),
    })
    await svc.setDirectory('D:/snips')
    fs.fail = true
    // 每次用户主动动作都给出失败反馈（第二次点击静默会像没反应）
    await svc.refresh()
    await svc.refresh()
    expect(errors).toEqual(['D:/snips', 'D:/snips'])
    // watcher 后台失败：不触发用户提示（仍是两条）
    await svc.initialize()
    fs.watcherEvents()
    await sleep(30)
    expect(errors).toEqual(['D:/snips', 'D:/snips'])
  })
})

describe('监听事件去抖与陈旧扫描作废', () => {
  it('连续事件合并为一次扫描（尾随去抖），扫描后清单更新', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/snips')
    const scansBefore = fs.scans
    fs.listing = ['a.css', 'b.css']
    fs.watcherEvents()
    fs.watcherEvents()
    fs.watcherEvents()
    await sleep(30)
    expect(fs.scans).toBe(scansBefore + 1)
    expect(svc.getState().entries.map((e) => e.name)).toEqual(['a.css', 'b.css'])
  })

  it('慢扫描被后发扫描作废：先完成的旧结果不落地', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/snips')
    // 第一发：挂起
    const slow = deferred(['stale.css'])
    fs.pendingScan = slow
    const first = svc.refresh()
    // 第二发：立即完成
    fs.pendingScan = null
    fs.listing = ['fresh.css']
    await svc.refresh()
    expect(svc.getState().entries.map((e) => e.name)).toEqual(['fresh.css'])
    // 释放慢扫描：其结果被 token 作废
    slow.resolve()
    await first
    expect(svc.getState().entries.map((e) => e.name)).toEqual(['fresh.css'])
  })
})

describe('生命周期', () => {
  it('dispose：取消去抖定时器、摘除监听、清空订阅', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const svc = makeService(storage, fs)
    await svc.setDirectory('D:/snips')
    const seen: number[] = []
    svc.onChange((s) => seen.push(s.version))
    fs.watcherEvents()
    svc.dispose()
    await sleep(30)
    expect(seen).toEqual([])
    expect(fs.disposedWatchers).toBeGreaterThanOrEqual(1)
  })
})

describe('跨窗口共享等价验证（用户级存储）', () => {
  it('同一 storage 重建服务：目录与开关恢复（globalState 按用户 profile 持久）', async () => {
    const storage = makeStorage()
    const fs = makeFs(['a.css'])
    const first = makeService(storage, fs)
    await first.setDirectory('D:/shared')
    await first.setEnabled('a.css', true)
    const revived = new CssSnippetService(storage, makeFs(['a.css']))
    expect(revived.getStored()).toEqual({ directory: 'D:/shared', enabled: { 'a.css': true } })
    await revived.initialize()
    expect(revived.getState().entries).toEqual([{ name: 'a.css', enabled: true }])
  })
})
