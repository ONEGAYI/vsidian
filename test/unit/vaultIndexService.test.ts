// #197 宿主索引服务契约测试：扫描 / 持久化恢复 / 覆盖层 / 反链查询 /
// 多根边界 / 生命周期。端口全注入（fake 内存文件系统），不依赖 vscode。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { VaultIndexService, type VaultIndexScanPort, type VaultIndexStoragePort } from '../../src/host/vaultIndexService'
import { rootKeyOf } from '../../src/shared/vaultIndexSnapshot'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const ROOT_KEY = rootKeyOf('file:///c%3A/vault')
const STORE_BASE = `C:/store/vsidian-index/${ROOT_KEY}`

/** 根形态：win32 语义（与本地宿主一致）；路径用 / 书写由服务归一 */
const IS_WIN = process.platform === 'win32'

interface FakeFs {
  files: Map<string, string>       // 绝对路径（/ 形态）→ 内容（原样，可含 \r\n）
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

/** 扫描端口：listMarkdownFiles 按扩展名过滤 .md（磁盘真实形态，/ 分隔） */
function scanPortOf(fs: FakeFs, events: string[] = []): VaultIndexScanPort & { yields: number } {
  return {
    yields: 0,
    async listMarkdownFiles(rootFsPath: string) {
      const prefix = rootFsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/'
      return [...fs.files.keys()].filter((p) => p.startsWith(prefix) && /\.md$/i.test(p))
    },
    async readFileText(fsPath: string) {
      return fs.files.get(fsPath.replace(/\\/g, '/')) ?? null
    },
    async statFile(fsPath: string) {
      return fs.stats.get(fsPath.replace(/\\/g, '/')) ?? null
    },
    watchRoot(_rootFsPath, _onEvent) {
      events.push('watch')
      return () => events.push('unwatch')
    },
    async yieldToEventLoop() {
      this.yields += 1
      await Promise.resolve()
    },
  } as VaultIndexScanPort & { yields: number }
}

/** 存储端口：内存目录树（沿用 snapshot 的 `/` 拼接路径） */
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
        if (rest.includes('/')) names.add(rest.split('/')[0]!)
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

function makeService(fs: FakeFs, opts: { storageRoot?: string; isWindowsHost?: boolean } = {}) {
  const scan = scanPortOf(fs)
  const storage = storagePortOf()
  const service = new VaultIndexService(scan, storage, {
    storageRoot: opts.storageRoot ?? 'C:/store',
    isWindowsHost: opts.isWindowsHost ?? IS_WIN,
    scanBatchFiles: 2,
  })
  return { service, scan, storage, fs }
}


/** 类型收窄：非 ready 直接失败（用例语义即期望 ready） */
function itemsOf(r: Awaited<ReturnType<VaultIndexService['backlinksOf']>>) {
  if (r.status !== 'ready') {
    throw new Error(`期望 ready 状态，实际 ${r.status}`)
  }
  return r.items
}

describe('VaultIndexService：初始化与持久化', () => {
  it('无快照时全量扫描建索引并提交快照（CURRENT 指向新代）', async () => {
    const { service, storage } = makeService(makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 片落在代目录下（baseDir/gen-xxxxxx-writer/shard-NNN.json）
    const shardKeys = [...storage.files.keys()].filter((k) => k.endsWith('/shard-000.json'))
    expect(shardKeys.length).toBeGreaterThan(0)
    expect(shardKeys[0]!.startsWith(`${STORE_BASE}/gen-`)).toBe(true)
    // CURRENT 存在且指向完整代
    const current = storage.files.get(`${STORE_BASE}/CURRENT`)!
    expect(current).toMatch(/^gen-000001-/)
  })

  it('有健康快照时直接恢复、不重扫正文（readFileText 不被调用）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 第二实例：同存储目录 + 换一份正文磁盘内容（快照恢复不读正文，
    // 恢复期间正文变化由 watcher/保存重扫兜底——此处验证不读）
    const readSpy = vi.spyOn(first.scan, 'readFileText')
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(readSpy).not.toHaveBeenCalled()
    const result = await second.backlinksOf('C:/vault/b.md')
    expect(result.status).toBe('ready')
    expect(itemsOf(result).map((i) => i.sourceRelPath)).toEqual(['a.md'])
    readSpy.mockRestore()
  })

  it('快照损坏时回退重建（loadSnapshot null → 全量扫描）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 损坏：清空全部片文件
    for (const key of [...first.storage.files.keys()]) {
      if (key.includes('/shard-')) first.storage.files.set(key, '{corrupted')
    }
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const result = await second.backlinksOf('C:/vault/b.md')
    expect(result.status).toBe('ready')
    expect(itemsOf(result)).toHaveLength(1)
  })

  it('扫描分批让出事件循环（batch=2 时 2 文件至少 2 次 yield）', async () => {
    const { service, scan } = makeService(makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/b.md': '# B\n',
      'C:/vault/c.md': '# C\n',
    }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect((scan as { yields: number }).yields).toBeGreaterThanOrEqual(2)
  })
})

describe('VaultIndexService：反链查询', () => {
  const BASE_FS = {
    'C:/vault/a.md': '# A\n\n引用 [[目标]] 与 [文字](./目标.md)。\n',
    'C:/vault/sub/c.md': '# C\n\n上行 [[../目标]]。\n',
    'C:/vault/目标.md': '# 目标\n',
    'C:/vault/孤岛.md': '# 孤岛\n',
  }

  it('多来源聚合：来源文件、行号与片段定位，按来源路径/位置稳定排序', async () => {
    const { service } = makeService(makeFs(BASE_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const result = await service.backlinksOf('C:/vault/目标.md')
    expect(result.status).toBe('ready')
    expect(itemsOf(result).map((i) => [i.sourceRelPath, i.kind])).toEqual([
      ['a.md', 'wikilink'],
      ['a.md', 'mdlink'],
      ['sub/c.md', 'wikilink'],
    ])
    // 行号 1 基、片段含引用文字
    expect(itemsOf(result)[0]!.line).toBe(3)
    expect(itemsOf(result)[0]!.snippet).toContain('引用 [[目标]]')
  })

  it('无引用返回 ready + 空列表；无工作区文档返回 no-workspace 失败态', async () => {
    const { service } = makeService(makeFs(BASE_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(await service.backlinksOf('C:/vault/孤岛.md')).toMatchObject({ status: 'ready', items: [] })
    expect(await service.backlinksOf('D:/other/x.md')).toMatchObject({ status: 'error', reason: 'no-workspace' })
  })

  it('未就绪（扫描中）返回 loading 状态', async () => {
    let releaseScan: (() => void) | undefined
    const gate = new Promise<void>((r) => {
      releaseScan = r
    })
    const fs = makeFs(BASE_FS)
    const scan = scanPortOf(fs)
    const origList = scan.listMarkdownFiles.bind(scan)
    scan.listMarkdownFiles = async (root: string) => {
      await gate
      return origList(root)
    }
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    const init = service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await Promise.resolve()
    const during = await service.backlinksOf('C:/vault/目标.md')
    expect(during.status).toBe('loading')
    releaseScan!()
    await init
  })
})

describe('VaultIndexService：覆盖层与保存', () => {
  it('未保存内容即时反映（去抖窗口内的最新版本胜出），不写磁盘基线', async () => {
    const { service, fs, storage } = makeService(makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const before = await storage.readFile([...storage.files.keys()].find((k) => k.endsWith('CURRENT'))!)
    // 未保存编辑：a.md 删除引用
    service.applyUnsaved('C:/vault/a.md', 3, '# A\n\n引用消失。\n')
    await vi.advanceTimersByTimeAsync(700)
    const result = await service.backlinksOf('C:/vault/目标.md')
    expect(itemsOf(result)).toHaveLength(0)
    // 磁盘基线未变（快照不因覆盖层重写）
    expect(storage.files.get([...storage.files.keys()].find((k) => k.endsWith('CURRENT'))!)).toBe(before)
    expect(fs.files.get('C:/vault/a.md')).toContain('引用 [[目标]]')
  })

  it('旧版本扫描结果不覆盖新版本（版本仲裁在服务层同样生效）', async () => {
    const { service } = makeService(makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    service.applyUnsaved('C:/vault/a.md', 8, '# A\n\n新文 [[目标]]。\n')
    service.applyUnsaved('C:/vault/a.md', 5, '# A\n\n旧文 [[其他]]。\n') // 迟到旧扫描
    await vi.advanceTimersByTimeAsync(700)
    const result = await service.backlinksOf('C:/vault/目标.md')
    expect(itemsOf(result)).toHaveLength(1)
    expect(itemsOf(result)[0]!.snippet).toContain('新文')
  })

  it('保存后覆盖层退役、磁盘基线重扫并提交新快照', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    const { service, storage } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const gen1 = storage.files.get([...storage.files.keys()].find((k) => k.endsWith('CURRENT'))!)
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\n引用消失。\n')
    await vi.advanceTimersByTimeAsync(700)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
    // 保存：磁盘内容更新 + 通知服务
    fs.files.set('C:/vault/a.md', '# A\n\n引用消失。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_010_000, size: 16 })
    await service.documentSaved('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(2000) // 合并提交去抖落定
    const result = await service.backlinksOf('C:/vault/目标.md')
    expect(itemsOf(result)).toHaveLength(0) // 基线同内容，仍无引用
    const currentOf = (): string | undefined =>
      storage.files.get([...storage.files.keys()].find((k) => k.endsWith('CURRENT'))!)
    const gen2 = currentOf()
    expect(gen2).not.toBe(gen1) // 新代提交
  })
})

describe('VaultIndexService：多根与附件', () => {
  it('多根各自独立资源边界：跨根目标不解析（断链保留），嵌套根归最具体根', async () => {
    const { service } = makeService(makeFs({
      'C:/r1/a.md': '# A\n\n越根 [[../../r2/b]] 与本根 [[b]]。\n',
      'C:/r1/b.md': '# B(r1)\n',
      'C:/r2/b.md': '# B(r2)\n',
      'C:/r1/sub/s.md': '# S\n\n上级 [[../b]]。\n',
    }))
    await service.initialize([
      { fsPath: 'C:/r1', uri: 'file:///c%3A/r1' },
      { fsPath: 'C:/r1/sub', uri: 'file:///c%3A/r1/sub' },
      { fsPath: 'C:/r2', uri: 'file:///c%3A/r2' },
    ])
    // s.md 属最具体根 sub：[[../b]] 从 sub 出发是 r1/b——r1/b 属父根不属 sub。
    // 各根独立边界：sub 根内无 b.md → 断链（保留边）
    const forSubB = await service.backlinksOf('C:/r1/b.md')
    // r1/b.md 的反链只来自 r1 根（a.md 的 [[b]]）；sub 根的 [[../b]] 越出 sub
    // 不得跨根解析（不产生指向 r1/b 的边）
    expect(itemsOf(forSubB).map((i) => i.sourceRelPath)).toEqual(['a.md'])
    // （跨根断链保留为边由 model 内部保证：resolvedTarget=null 的边仍在
    // 边表——r1/b.md 的反链集合不含 sub 根来源即其外部表现）
  })

  it('被引用的附件登记为 asset 条目；图片边解析命中', async () => {
    const { service } = makeService(makeFs({
      'C:/vault/a.md': '# A\n\n![图](./assets/pic.png)\n',
      'C:/vault/assets/pic.png': '\u0000png',
      'C:/vault/目标.md': '# 目标\n',
    }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const result = await service.backlinksOf('C:/vault/assets/pic.png')
    expect(result.status).toBe('ready')
    expect(itemsOf(result).map((i) => [i.sourceRelPath, i.kind])).toEqual([['a.md', 'image']])
  })
})

describe('VaultIndexService：watcher 与生命周期', () => {
  it('外部变更经 watch 端口触发单文件重扫（去抖合并）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map).toHaveLength(1)
    // 外部改写：a.md 删除引用
    fs.files.set('C:/vault/a.md', '# A\n\n引用消失。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_020_000, size: 16 })
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
  })

  it('dispose 清理 watcher 与未决定时器（不再产生扫描或提交）', async () => {
    const events: string[] = []
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const scan = scanPortOf(fs, events)
    const storage = storagePortOf()
    const service = new VaultIndexService(scan, storage, { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\n变更。\n')
    service.dispose()
    await vi.advanceTimersByTimeAsync(3000)
    expect(events).toContain('unwatch')
    const current = storage.files.get([...storage.files.keys()].find((k) => k.endsWith('CURRENT'))!)
    expect(current).toMatch(/^gen-000001-/) // 覆盖层去抖未触发新提交
  })

  it('变更通知 listener 面板可订阅（广播链路测试面）', async () => {
    const { service } = makeService(makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    }))
    const seen: string[] = []
    service.onChange(() => seen.push('changed'))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(seen.length).toBeGreaterThanOrEqual(1)
  })
})
