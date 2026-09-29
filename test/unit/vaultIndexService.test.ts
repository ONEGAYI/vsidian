// #197 宿主索引服务契约测试：扫描 / 持久化恢复 / 覆盖层 / 反链查询 /
// 多根边界 / 生命周期。端口全注入（fake 内存文件系统），不依赖 vscode。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { VaultIndexService, type VaultIndexScanPort, type VaultIndexStoragePort, type VaultTargetChangeEvent } from '../../src/host/vaultIndexService'
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

/** 扫描端口：listMarkdownFiles 按扩展名过滤 .md（磁盘真实形态，/ 分隔）；
 *  inaccessible 集合模拟 SSH 断连/权限错误（accessOf 返回 inaccessible） */
function scanPortOf(fs: FakeFs, events: string[] = []): VaultIndexScanPort & { yields: number; inaccessible: Set<string> } {
  return {
    yields: 0,
    inaccessible: new Set<string>(),
    async listMarkdownFiles(rootFsPath: string) {
      const prefix = rootFsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/'
      return [...fs.files.keys()].filter((p) => p.startsWith(prefix) && /\.md$/i.test(p))
    },
    async readFileText(fsPath: string) {
      const key = fsPath.replace(/\\/g, '/')
      if (this.inaccessible.has(key)) {
        return null // 不可访问：读失败（与真实 EACCES/断连一致）
      }
      return fs.files.get(key) ?? null
    },
    async statFile(fsPath: string) {
      const key = fsPath.replace(/\\/g, '/')
      if (this.inaccessible.has(key)) {
        return null // 不可访问：stat 失败
      }
      return fs.stats.get(key) ?? null
    },
    async accessOf(fsPath: string) {
      const key = fsPath.replace(/\\/g, '/')
      if (this.inaccessible.has(key)) {
        return 'inaccessible' as const
      }
      return fs.files.has(key) ? ('ok' as const) : ('missing' as const)
    },
    watchRoot(_rootFsPath, _onEvent) {
      events.push('watch')
      return () => events.push('unwatch')
    },
    async yieldToEventLoop() {
      this.yields += 1
      await Promise.resolve()
    },
  } as VaultIndexScanPort & { yields: number; inaccessible: Set<string> }
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
        if (rest.includes('/')) names.add(rest.split('/')[0])
      }
      return [...names]
    },
    async listFiles(baseDir: string) {
      const names = new Set<string>()
      for (const key of files.keys()) {
        if (!key.startsWith(baseDir + '/')) continue
        const rest = key.slice(baseDir.length + 1)
        if (!rest.includes('/')) names.add(rest)
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
        if (key === path || key.startsWith(path + '/')) files.delete(key)
      }
    },
    async ensureDir() {},
  }
}

function makeService(fs: FakeFs, opts: { storageRoot?: string; isWindowsHost?: boolean; excludePatterns?: readonly string[] } = {}) {
  const scan = scanPortOf(fs)
  const storage = storagePortOf()
  const service = new VaultIndexService(scan, storage, {
    storageRoot: opts.storageRoot ?? 'C:/store',
    isWindowsHost: opts.isWindowsHost ?? IS_WIN,
    scanBatchFiles: 2,
    ...(opts.excludePatterns ? { excludePatterns: opts.excludePatterns } : {}),
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

describe('VaultIndexService：#198 编辑调度（防抖 + 2s 强制合并）', () => {
  it('连续输入不超过 2s 强制合并一次（无静默期也冲刷覆盖层）', async () => {
    const { service } = makeService(makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 连续键入：t=0..1800 每 400ms 一版（防抖不断重置、永不静默 500ms）
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\nv2 [[目标]]。\n')
    await vi.advanceTimersByTimeAsync(400)
    service.applyUnsaved('C:/vault/a.md', 3, '# A\n\nv3 [[目标]]。\n')
    await vi.advanceTimersByTimeAsync(400)
    service.applyUnsaved('C:/vault/a.md', 4, '# A\n\nv4 [[目标]]。\n')
    await vi.advanceTimersByTimeAsync(400)
    service.applyUnsaved('C:/vault/a.md', 5, '# A\n\nv5 [[目标]]。\n')
    await vi.advanceTimersByTimeAsync(400)
    service.applyUnsaved('C:/vault/a.md', 6, '# A\n\nv6 引用消失。\n')
    // t=1600：防抖点 2100 晚于强制合并点 2000，尚无冲刷
    await vi.advanceTimersByTimeAsync(0)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(1)
    // t=2000：首事件起 2s 封顶强制合并
    await vi.advanceTimersByTimeAsync(400)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
  })
})

describe('VaultIndexService：#198 增量队列（有界、合并提交、溢出降级）', () => {
  it('批量外部事件（模拟 Git 切换）合并为一次快照提交', async () => {
    const initial: Record<string, string> = { 'C:/vault/b.md': '# B\n' }
    for (let i = 0; i < 6; i++) initial[`C:/vault/a${i}.md`] = `# A${i}\n\n见 [[b]]。\n`
    const fs = makeFs(initial)
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_r, onEvent) => { notify = onEvent; return () => {} }
    const storage = storagePortOf()
    const service = new VaultIndexService(scan, storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN, scanBatchFiles: 2,
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const commitsBefore = storage.writes.filter((w) => w.endsWith('/CURRENT')).length
    for (let i = 0; i < 6; i++) {
      fs.files.set(`C:/vault/a${i}.md`, `# A${i}\n\n引用消失。\n`)
      fs.stats.set(`C:/vault/a${i}.md`, { mtimeMs: 1_700_000_050_000 + i, size: 10 })
      notify!(`C:/vault/a${i}.md`)
    }
    await vi.advanceTimersByTimeAsync(1200) // 去抖 + 队列泵落定
    await vi.advanceTimersByTimeAsync(2000) // 合并提交去抖落定
    // 六文件一批 → 恰一次 CURRENT 提交（合并磁盘写）
    expect(storage.writes.filter((w) => w.endsWith('/CURRENT')).length - commitsBefore).toBe(1)
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
  })

  it('队列溢出降级为清单核验（不产生无界任务；核验检出删除）', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n见 [[b]]。\n', 'C:/vault/b.md': '# B\n' })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_r, onEvent) => { notify = onEvent; return () => {} }
    // 泵滞留门：首个增量任务挂在 accessOf 上，制造队列积压窗口
    const origAccess = scan.accessOf.bind(scan)
    let releasePump!: () => void
    const pumpGate = new Promise<void>((r) => { releasePump = r })
    let stalled = false
    scan.accessOf = async (fsPath: string) => {
      if (!stalled && fsPath.replace(/\\/g, '/').endsWith('x1.md')) {
        stalled = true
        await pumpGate
      }
      return origAccess(fsPath)
    }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN, scanBatchFiles: 2,
      rescanQueueCapacity: 1,
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 磁盘上 a.md 已删除；x1 先入队并滞留泵，随后 x2/x3 到达（容量 1 → 溢出）
    fs.files.delete('C:/vault/a.md')
    fs.stats.delete('C:/vault/a.md')
    notify!('C:/vault/x1.md')
    await vi.advanceTimersByTimeAsync(1000) // 泵启动并滞留于 x1
    notify!('C:/vault/x2.md')
    notify!('C:/vault/x3.md')
    await vi.advanceTimersByTimeAsync(1000) // x2 入队、x3 溢出 → 降级核验挂起
    releasePump()
    await vi.advanceTimersByTimeAsync(2000) // 泵收尾 → 接力核验检出删除 → 合并提交
    const result = await service.backlinksOf('C:/vault/b.md')
    expect(itemsOf(result)).toHaveLength(0) // a.md 删除被核验兜底移除
  })
})

describe('VaultIndexService：#198 排除语义', () => {
  const EXCLUDED_FS = {
    'C:/vault/a.md': '# A\n\n见 [[ex/秘密]] 与 ![图](ex/图.png)。\n',
    'C:/vault/ex/秘密.md': '# 秘密\n\n见 [[../b]]。\n',
    'C:/vault/b.md': '# B\n',
  }

  it('排除的 Markdown 不入索引域（无出链贡献），但被显式引用仍登记为目标', async () => {
    const { service } = makeService(makeFs(EXCLUDED_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 排除前：ex/秘密.md 在 md 域内、贡献指向 b.md 的反链
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toEqual(['ex/秘密.md'])
    await service.setExcludePatterns(['ex/**'])
    // 排除后：无出链贡献（b.md 反链为空）
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    // 被显式引用的排除目标仍登记：a.md 的 [[ex/秘密]] 反链可达
    const toSecret = await service.backlinksOf('C:/vault/ex/秘密.md')
    expect(itemsOf(toSecret).map((i) => i.sourceRelPath)).toEqual(['a.md'])
    // files 计入登记条目：a.md、b.md（md 域）+ ex/秘密.md（显式引用登记的
    // asset 目标——排除不递归扫描但保留可解析性）
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(3)
  })

  it('排除变更触发覆盖范围重算（先前纳入的文件被移出）', async () => {
    const { service, fs } = makeService(makeFs(EXCLUDED_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toContain('ex/秘密.md')
    await service.setExcludePatterns(['ex/**'])
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    // 恢复空排除 → 重算后重新纳入
    await service.setExcludePatterns([])
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toContain('ex/秘密.md')
    void fs
  })

  it('排除文件的未保存编辑不入覆盖层；watcher 事件被忽略', async () => {
    const fs = makeFs(EXCLUDED_FS)
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_r, onEvent) => { notify = onEvent; return () => {} }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await service.setExcludePatterns(['ex/**'])
    // 排除文档的未保存编辑不产生覆盖层边
    service.applyUnsaved('C:/vault/ex/秘密.md', 2, '# 秘密\n\n又见 [[b]]。\n')
    await vi.advanceTimersByTimeAsync(2500)
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    // 排除文件的外部变更不触发重扫（条目 stat 不变）
    fs.files.set('C:/vault/ex/秘密.md', '# 改\n')
    fs.stats.set('C:/vault/ex/秘密.md', { mtimeMs: 9_999, size: 2 })
    notify!('C:/vault/ex/秘密.md')
    await vi.advanceTimersByTimeAsync(2000)
    expect(itemsOf(await service.backlinksOf('C:/vault/ex/秘密.md')).map((i) => i.sourceRelPath)).toEqual(['a.md'])
  })

  it('getExcludePatterns / maintenanceInfo 回读当前模式', async () => {
    const { service } = makeService(makeFs(EXCLUDED_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await service.setExcludePatterns(['**/.git/**'])
    expect(service.getExcludePatterns()).toEqual(['**/.git/**'])
    expect(service.maintenanceInfo().excludePatterns).toEqual(['**/.git/**'])
  })
})

describe('VaultIndexService：#198 核验（启动/清单比对/stale 语义）', () => {
  it('启动核验：快照恢复后磁盘已变的文件被重扫、已删文件被移除', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 停机窗口内：a.md 改写（引删除用）、c.md 新增、b.md 保持
    fs.files.set('C:/vault/a.md', '# A\n\n引用消失。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_100_000, size: 12 })
    fs.files.set('C:/vault/c.md', '# C\n\n见 [[b]]。\n')
    fs.stats.set('C:/vault/c.md', { mtimeMs: 1_700_000_100_000, size: 12 })
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    const events: string[] = []
    second.onTargetChange((e) => events.push(`${e.relPath}:${e.status}`))
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 恢复后自动核验（异步）：等待微任务与批间让出落定
    await vi.advanceTimersByTimeAsync(0)
    const items = itemsOf(await second.backlinksOf('C:/vault/b.md'))
    expect(items.map((i) => i.sourceRelPath).sort()).toEqual(['c.md'])
    expect(events.some((e) => e === 'a.md:changed')).toBe(true)
  })

  it('verifyNow：mtime+size 清单比对筛出变化（含不可访问不误删）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const ctx = makeService(fs)
    await ctx.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 磁盘变化：a.md 引用消失（mtime/size 变）；d.md 删除场景用「不可访问」模拟
    fs.files.set('C:/vault/a.md', '# A\n\n引用消失。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_200_000, size: 12 })
    fs.files.set('C:/vault/d.md', '# D\n\n见 [[b]]。\n')
    fs.stats.set('C:/vault/d.md', { mtimeMs: 1_700_000_200_000, size: 12 })
    await ctx.service.verifyNow()
    expect(itemsOf(await ctx.service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toEqual(['d.md'])
    // 不可访问（SSH 断连/权限）：不得等同删除
    fs.files.delete('C:/vault/d.md')
    fs.stats.delete('C:/vault/d.md')
    ;(ctx.scan as unknown as { inaccessible: Set<string> }).inaccessible.add('C:/vault/d.md')
    await ctx.service.verifyNow()
    expect(itemsOf(await ctx.service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toEqual(['d.md'])
  })

  it('焦点回归触发核验（长时间离开恢复；间隔保护）', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n见 [[b]]。\n', 'C:/vault/b.md': '# B\n' })
    const ctx = makeService(fs)
    await ctx.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    fs.files.set('C:/vault/a.md', '# A\n\n引用消失。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_300_000, size: 12 })
    ctx.service.setActive(false)
    ctx.service.setActive(true) // 回归即核验
    await vi.advanceTimersByTimeAsync(0)
    expect(itemsOf(await ctx.service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
  })
})

describe('VaultIndexService：#198 变化发布通道（generation per target）', () => {
  it('单文件重扫发布 changed/deleted，代次单调递增；断链来源保留', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_r, onEvent) => { notify = onEvent; return () => {} }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const seen: Array<{ relPath: string; status: string; generation: number }> = []
    service.onTargetChange((e) => seen.push({ relPath: e.relPath, status: e.status, generation: e.generation }))
    // 变更
    fs.files.set('C:/vault/a.md', '# A2\n\n见 [[b]]。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_400_000, size: 12 })
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen.filter((e) => e.relPath === 'a.md').map((e) => e.status)).toEqual(['changed'])
    // 删除
    fs.files.delete('C:/vault/b.md')
    fs.stats.delete('C:/vault/b.md')
    notify!('C:/vault/b.md')
    await vi.advanceTimersByTimeAsync(1000)
    const bEvents = seen.filter((e) => e.relPath === 'b.md')
    expect(bEvents.map((e) => e.status)).toEqual(['deleted'])
    // 来源断链保留：a.md 的边仍在（指向已删除目标）
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toEqual(['a.md'])
  })

  it('不可访问发布 stale 且不移除条目；恢复后发布 changed 并清 stale 标记', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const ctx = makeService(fs)
    await ctx.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const seen: Array<{ relPath: string; status: string; generation: number }> = []
    ctx.service.onTargetChange((e) => seen.push({ relPath: e.relPath, status: e.status, generation: e.generation }))
    ;(ctx.scan as unknown as { inaccessible: Set<string> }).inaccessible.add('C:/vault/a.md')
    await ctx.service.verifyNow()
    expect(seen.filter((e) => e.relPath === 'a.md').map((e) => e.status)).toEqual(['stale'])
    // 再次核验仍不可访问：不重复广播 stale
    await ctx.service.verifyNow()
    expect(seen.filter((e) => e.status === 'stale')).toHaveLength(1)
    // 恢复可访问 + 内容变化
    fs.files.set('C:/vault/a.md', '# A2\n\n见 [[b]]。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_500_000, size: 12 })
    ;(ctx.scan as unknown as { inaccessible: Set<string> }).inaccessible.delete('C:/vault/a.md')
    await ctx.service.verifyNow()
    expect(seen.filter((e) => e.relPath === 'a.md').map((e) => e.status)).toEqual(['stale', 'changed'])
    const gens = seen.filter((e) => e.relPath === 'a.md').map((e) => e.generation)
    expect(gens[1]!).toBeGreaterThan(gens[0]!)
  })

  it('完整重建对磁盘删除发布 deleted、对索引条目消失但磁盘仍在不发布', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/b.md': '# B\n',
    })
    const ctx = makeService(fs)
    await ctx.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const seen: Array<{ relPath: string; status: string }> = []
    ctx.service.onTargetChange((e) => seen.push({ relPath: e.relPath, status: e.status }))
    // b.md 磁盘删除；a.md 磁盘在但将被排除（条目消失≠磁盘删除，不得广播）
    fs.files.delete('C:/vault/b.md')
    fs.stats.delete('C:/vault/b.md')
    await ctx.service.setExcludePatterns(['a.md'])
    await ctx.service.rebuildAll()
    expect(seen.filter((e) => e.relPath === 'b.md').map((e) => e.status)).toEqual(['deleted'])
    expect(seen.some((e) => e.relPath === 'a.md')).toBe(false)
  })
})

describe('VaultIndexService：#198 清理与完整重建', () => {
  it('cleanupCache 回收旧代与残留、保留 CURRENT 与继承源（不删活跃文件）', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n见 [[b]]。\n', 'C:/vault/b.md': '# B\n' })
    const ctx = makeService(fs)
    await ctx.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 再提交一代（gen2 继承 gen1 片）+ 模拟残留
    fs.files.set('C:/vault/a.md', '# A2\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_600_000, size: 6 })
    await ctx.service.verifyNow()
    await vi.advanceTimersByTimeAsync(2000)
    ctx.storage.files.set(`${STORE_BASE}/gen-000001-dead/shard-000.json`, 'x')
    ctx.storage.files.set(`${STORE_BASE}/tmp-write-1/f.txt`, 'x')
    const current = ctx.storage.files.get(`${STORE_BASE}/CURRENT`)!
    const manifest = JSON.parse(ctx.storage.files.get(`${STORE_BASE}/${current}/manifest.json`)!) as {
      shards: Array<{ inheritedFrom: string | null }>
    }
    const inherit = manifest.shards.find((s) => s.inheritedFrom)?.inheritedFrom ?? null
    const result = await ctx.service.cleanupCache()
    expect(result.removedDirs).toBeGreaterThanOrEqual(2) // 残留代 + tmp（至少）
    const dirs = new Set(await ctx.storage.listDirs(STORE_BASE))
    expect(dirs.has(current)).toBe(true)
    if (inherit) expect(dirs.has(inherit)).toBe(true)
    expect(dirs.has('gen-000001-dead')).toBe(false)
    expect(dirs.has('tmp-write-1')).toBe(false)
    // 清理后索引仍可读（活跃代未动）
    expect(itemsOf(await ctx.service.backlinksOf('C:/vault/b.md')).length).toBeGreaterThanOrEqual(0)
  })

  it('rebuildAll 重新解析正文（快照旧内容被磁盘新内容取代）并回报进度', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n见 [[b]]。\n', 'C:/vault/b.md': '# B\n' })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 第二实例恢复旧快照后磁盘已变：重建应读盘
    fs.files.set('C:/vault/a.md', '# A\n\n引用消失。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_700_000, size: 12 })
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    // 跳过恢复期自动核验干扰：直接重建（initialize 的后台核验与本断言并存）
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const progress: Array<{ done: number; total: number }> = []
    const result = await second.rebuildAll((p) => progress.push({ ...p }))
    expect(result).toBe('done')
    expect(itemsOf(await second.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)!.done).toBe(progress.at(-1)!.total)
  })

  it('cancelMaintenance 中止重建（返回 cancelled；中断点在批间检查）', async () => {
    const files: Record<string, string> = { 'C:/vault/b.md': '# B\n' }
    for (let i = 0; i < 4; i++) files[`C:/vault/a${i}.md`] = `# A${i}\n\n见 [[b]]。\n`
    const fs = makeFs(files)
    const scan = scanPortOf(fs)
    const origList = scan.listMarkdownFiles.bind(scan)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let calls = 0
    // 只拦第二次列举（首次 = initialize 全量扫描，第二次 = 重建）
    scan.listMarkdownFiles = async (root: string) => {
      calls += 1
      if (calls === 2) {
        await gate
      }
      return origList(root)
    }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN, scanBatchFiles: 1,
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const rebuild = service.rebuildAll()
    await Promise.resolve() // 重建进入列举、挂于 gate
    service.cancelMaintenance()
    release()
    expect(await rebuild).toBe('cancelled')
    // 模型保持上次完整数据（重建中止不清空基线）
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).length).toBeGreaterThan(0)
  })
})

describe('VaultIndexService：#198 根增删（onDidChangeWorkspaceFolders 域）', () => {
  it('setRoots 新增根被扫描、移除根停监听且退出索引域', async () => {
    const events: string[] = []
    const fs = makeFs({
      'C:/r1/a.md': '# A\n\n见 [[b]]。\n',
      'C:/r1/b.md': '# B\n',
      'C:/r2/c.md': '# C\n\n见 [[d]]。\n',
      'C:/r2/d.md': '# D\n',
    })
    const scan = scanPortOf(fs, events)
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await service.initialize([{ fsPath: 'C:/r1', uri: 'file:///c%3A/r1' }])
    expect(itemsOf(await service.backlinksOf('C:/r1/b.md'))).toHaveLength(1)
    expect(await service.backlinksOf('C:/r2/d.md')).toMatchObject({ status: 'error', reason: 'no-workspace' })
    // 新增 r2
    await service.setRoots([
      { fsPath: 'C:/r1', uri: 'file:///c%3A/r1' },
      { fsPath: 'C:/r2', uri: 'file:///c%3A/r2' },
    ])
    expect(itemsOf(await service.backlinksOf('C:/r2/d.md'))).toHaveLength(1)
    // 移除 r1
    await service.setRoots([{ fsPath: 'C:/r2', uri: 'file:///c%3A/r2' }])
    expect(await service.backlinksOf('C:/r1/b.md')).toMatchObject({ status: 'error', reason: 'no-workspace' })
    expect(itemsOf(await service.backlinksOf('C:/r2/d.md'))).toHaveLength(1)
    expect(events.filter((e) => e === 'watch').length).toBeGreaterThanOrEqual(2)
  })

  it('新增嵌套根后覆盖范围重算：父根已索引的嵌套文件重新归属（不重复）', async () => {
    const fs = makeFs({
      'C:/r1/a.md': '# A\n\n见 [[sub/s]]。\n',
      'C:/r1/sub/s.md': '# S\n\n见 [[../a]]。\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/r1', uri: 'file:///c%3A/r1' }])
    // 初始：sub 非根，两文件都属 r1（2 条目）
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(2)
    expect(itemsOf(await service.backlinksOf('C:/r1/sub/s.md'))).toHaveLength(1)
    // 新增嵌套根 sub：s.md 归属重划到 sub 根，父根不再持有（不重复归属）
    await service.setRoots([
      { fsPath: 'C:/r1', uri: 'file:///c%3A/r1' },
      { fsPath: 'C:/r1/sub', uri: 'file:///c%3A/r1/sub' },
    ])
    const roots = service.maintenanceInfo().roots
    expect(roots.length).toBe(2)
    const parent = roots.find((r) => r.fsPath === 'C:/r1')!
    const nested = roots.find((r) => r.fsPath === 'C:/r1/sub')!
    expect(parent.fileCount).toBe(1) // 仅 a.md
    expect(nested.fileCount).toBe(1) // s.md
    // 跨根不解析：sub 根内 [[../a]] 越出 sub 边界（r1/a 属父根）→ 断链；
    // a.md 的 [[sub/s]] 对 r1 而言是子目录文件（现属 sub 根）→ 也断链
    expect(itemsOf(await service.backlinksOf('C:/r1/a.md'))).toHaveLength(0)
    expect(itemsOf(await service.backlinksOf('C:/r1/sub/s.md'))).toHaveLength(0)
    // 移除嵌套根：归属还原（覆盖范围再次重算）
    await service.setRoots([{ fsPath: 'C:/r1', uri: 'file:///c%3A/r1' }])
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(2)
    expect(itemsOf(await service.backlinksOf('C:/r1/sub/s.md'))).toHaveLength(1)
  })
})

describe('VaultIndexService：#199 rename 候选查询', () => {
  it('renameCandidatesOf：ready 态返回引用者分组与被移动文档出链（磁盘真实形态匹配）', async () => {
    const fs = makeFs({
      'C:/vault/target.md': '# T\n\n出链 [[other]]。\n',
      'C:/vault/ref-a.md': '# A\n\n见 [[target]]。\n',
      'C:/vault/ref-b.md': '# B\n\n见 [x](target.md)。\n',
      'C:/vault/other.md': '# O\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const c = service.renameCandidatesOf('C:/vault/target.md')
    expect(c.status).toBe('ready')
    expect(c.incoming.map((g) => g.fsPath)).toEqual(['C:\\vault\\ref-a.md', 'C:\\vault\\ref-b.md'])
    expect(c.incoming[0]!.edges).toHaveLength(1)
    expect(c.incoming[0]!.edges[0]).toMatchObject({ kind: 'wikilink', target: 'target', resolvedTarget: 'target.md' })
    expect(c.incoming[1]!.edges[0]).toMatchObject({ kind: 'mdlink' })
    expect(c.outgoing).toHaveLength(1)
    expect(c.outgoing[0]).toMatchObject({ target: 'other', resolvedTarget: 'other.md' })
  })

  it('无引用时 incoming 为空、outgoing 仍返回；附件目标只含 incoming', async () => {
    const fs = makeFs({
      'C:/vault/lonely.md': '# L\n',
      'C:/vault/a.md': '# A\n\n![图](pic.png)。\n',
      'C:/vault/pic.png': '\u0000png',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const lonely = service.renameCandidatesOf('C:/vault/lonely.md')
    expect(lonely.status).toBe('ready')
    expect(lonely.incoming).toEqual([])
    expect(lonely.outgoing).toEqual([])
    const pic = service.renameCandidatesOf('C:/vault/pic.png')
    expect(pic.status).toBe('ready')
    expect(pic.incoming.map((g) => g.fsPath)).toEqual(['C:\\vault\\a.md'])
    expect(pic.outgoing).toEqual([])
  })

  it('覆盖层接管：未保存编辑的引用者用覆盖层边（区间对齐未保存文本）', async () => {
    const fs = makeFs({
      'C:/vault/target.md': '# T\n',
      'C:/vault/ref.md': '# R\n\n见 [[target]]。\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 未保存编辑：链接前插一行（区间整体后移）+ 新增一处引用
    const edited = '# R\n\n前置行\n见 [[target]] 与 [[target]]。\n'
    service.applyUnsaved('C:/vault/ref.md', 3, edited)
    await vi.advanceTimersByTimeAsync(600) // 冲刷防抖（500ms）
    const c = service.renameCandidatesOf('C:/vault/target.md')
    expect(c.status).toBe('ready')
    expect(c.incoming).toHaveLength(1)
    expect(c.incoming[0]!.edges).toHaveLength(2) // 覆盖层边接管基线（1 → 2）
    expect(c.incoming[0]!.edges[0]!.start).toBe(edited.indexOf('[[target]]'))
  })

  it('扫描未完成时 not-ready；工作区外路径 outside', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n' })
    const { service } = makeService(fs)
    const init = service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const scanning = service.renameCandidatesOf('C:/vault/a.md')
    expect(scanning.status).toBe('not-ready')
    expect(scanning.incoming).toEqual([])
    await init
    const outside = service.renameCandidatesOf('D:/elsewhere/x.md')
    expect(outside.status).toBe('outside')
  })
})

describe('VaultIndexService：#199 rename 后索引刷新（refreshRenamed）', () => {
  it('md 移动：旧条目移除（deleted 正证据）、新路径登记且出链重算', async () => {
    const fs = makeFs({
      'C:/vault/target.md': '# T\n\n出链 [[other]]。\n',
      'C:/vault/ref.md': '# R\n\n见 [[target]]。\n',
      'C:/vault/other.md': '# O\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const before = service.maintenanceInfo().roots[0]!.fileCount
    // 磁盘完成移动（rename 已发生）
    fs.files.delete('C:/vault/target.md')
    fs.stats.delete('C:/vault/target.md')
    fs.files.set('C:/vault/renamed.md', '# T\n\n出链 [[other]]。\n')
    fs.stats.set('C:/vault/renamed.md', { mtimeMs: 1_700_000_001_000, size: 20 })
    const events: VaultTargetChangeEvent[] = []
    service.onTargetChange((e) => events.push(e))
    await service.refreshRenamed('C:/vault/target.md', 'C:/vault/renamed.md')
    // 条目数守恒：旧移除、新登记
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(before)
    // 新路径出链登记：other.md 的反链含 renamed.md
    expect(itemsOf(await service.backlinksOf('C:/vault/other.md')).map((i) => i.sourceRelPath))
      .toContain('renamed.md')
    // 旧路径正证据删除广播
    expect(events.some((e) => e.relPath === 'target.md' && e.status === 'deleted')).toBe(true)
  })

  it('附件移动：旧 asset 移除、新 asset 登记（事件驱动窄登记）且引用解析延续', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n![图](pic.png)。\n',
      'C:/vault/pic.png': '\u0000png',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(2)
    fs.files.delete('C:/vault/pic.png')
    fs.stats.delete('C:/vault/pic.png')
    fs.files.set('C:/vault/pic2.png', '\u0000png')
    fs.stats.set('C:/vault/pic2.png', { mtimeMs: 1_700_000_002_000, size: 4 })
    await service.refreshRenamed('C:/vault/pic.png', 'C:/vault/pic2.png')
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(2) // 旧移除 + 新登记
    // 引用者重扫后解析延续（改写链路的后续：applyUnsaved 模拟已改写文本）
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\n![图](pic2.png)。\n')
    await vi.advanceTimersByTimeAsync(600)
    const back = await service.backlinksOf('C:/vault/pic2.png')
    expect(back.status).toBe('ready')
    expect(itemsOf(back).map((i) => i.sourceRelPath)).toEqual(['a.md'])
  })

  it('排除的 md 不入索引域（rename 刷新跳过）；未排除照常', async () => {
    const fs = makeFs({
      'C:/vault/keep.md': '# K\n',
      'C:/vault/ignored/x.md': '# X\n',
      'C:/vault/ignored/y.md': '# Y\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await service.setExcludePatterns(['**/.git/**', '**/node_modules/**', 'ignored/**'])
    const before = service.maintenanceInfo().roots[0]!.fileCount
    fs.files.delete('C:/vault/ignored/x.md')
    fs.stats.delete('C:/vault/ignored/x.md')
    fs.files.set('C:/vault/ignored/x2.md', '# X2\n')
    fs.stats.set('C:/vault/ignored/x2.md', { mtimeMs: 1, size: 4 })
    await service.refreshRenamed('C:/vault/ignored/x.md', 'C:/vault/ignored/x2.md')
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(before) // 排除域不进不出
  })

  it('新路径在索引域外（根外）只移除旧条目', async () => {
    const fs = makeFs({
      'C:/vault/target.md': '# T\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    fs.files.delete('C:/vault/target.md')
    fs.stats.delete('C:/vault/target.md')
    await service.refreshRenamed('C:/vault/target.md', 'D:/outside/target.md')
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(0)
  })
})

// ---- #200 目录/批量移动：索引清单查询与批量刷新 ----

describe('VaultIndexService：#200 目录前缀清单（indexedFilesUnder）', () => {
  it('返回前缀下全部登记文件（.md 与被引用 asset）；域外与未就绪返回 null', async () => {
    const fs = makeFs({
      // pic.png 被 a.md 引用才登记（asset 只在被引用时入索引——#197 语义）
      'C:/vault/dir/a.md': '# A\n\n![图](pic.png)。\n',
      'C:/vault/dir/deep/b.md': '# B\n',
      'C:/vault/dir/pic.png': '\u0000png',
      'C:/vault/dir/unreferenced.png': '\u0000png2',
      'C:/vault/outside.md': '# O\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const listed = service.indexedFilesUnder('C:/vault/dir')
    expect(listed).not.toBeNull()
    expect(listed!.map((p) => p.replace(/\\/g, '/')).sort()).toEqual([
      'C:/vault/dir/a.md',
      'C:/vault/dir/deep/b.md',
      'C:/vault/dir/pic.png',
    ])
    // 域外（根外）
    expect(service.indexedFilesUnder('D:/elsewhere/dir')).toBeNull()
  })

  it('根未就绪（无数据）返回 null', async () => {
    const fs = makeFs({ 'C:/vault/dir/a.md': '# A\n' })
    const { service } = makeService(fs)
    // 未 initialize：无快照无数据
    expect(service.indexedFilesUnder('C:/vault/dir')).toBeNull()
  })
})

describe('VaultIndexService：#200 批量 rename 刷新（refreshRenamedBatch）', () => {
  it('目录批移除与登记：条目守恒、反链新键命中、旧键退场、deleted 正证据广播', async () => {
    const fs = makeFs({
      'C:/vault/dir-old/a.md': '# A\n\n见 [[b]]。\n',
      'C:/vault/dir-old/b.md': '# B\n',
      'C:/vault/dir-old/deep/c.md': '# C\n',
      'C:/vault/dir-old/pic.png': '\u0000png',
      'C:/vault/dir-ref.md': '# R\n\n![图](dir-old/pic.png)。\n',
      'C:/vault/keep.md': '# K\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const before = service.maintenanceInfo().roots[0]!.fileCount
    // 磁盘完成目录移动（rename 已发生——外部 fs 通道语义）
    for (const rel of ['a.md', 'b.md', 'deep/c.md', 'pic.png']) {
      const oldKey = `C:/vault/dir-old/${rel}`
      const newKey = `C:/vault/dir-new/${rel}`
      const content = fs.files.get(oldKey)!
      fs.files.delete(oldKey)
      fs.stats.delete(oldKey)
      fs.files.set(newKey, content)
      fs.stats.set(newKey, { mtimeMs: 1_700_000_009_000, size: content.length })
    }
    const moves = [
      { oldFsPath: 'C:/vault/dir-old/a.md', newFsPath: 'C:/vault/dir-new/a.md' },
      { oldFsPath: 'C:/vault/dir-old/b.md', newFsPath: 'C:/vault/dir-new/b.md' },
      { oldFsPath: 'C:/vault/dir-old/deep/c.md', newFsPath: 'C:/vault/dir-new/deep/c.md' },
      { oldFsPath: 'C:/vault/dir-old/pic.png', newFsPath: 'C:/vault/dir-new/pic.png' },
    ]
    const events: VaultTargetChangeEvent[] = []
    service.onTargetChange((e) => events.push(e))
    await service.refreshRenamedBatch(moves)
    // 条目守恒（旧移除 + 新登记）
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(before)
    // 批内互链不断链：a 的 [[b]] 在新目录下仍解析（两遍登记的 resolver 可见性）
    const backOfB = itemsOf(await service.backlinksOf('C:/vault/dir-new/b.md'))
    expect(backOfB.map((i) => i.sourceRelPath)).toEqual(['dir-new/a.md'])
    // asset 新键可查反链（引用者 dir-ref 重扫后——applyUnsaved 模拟改写后文本）
    service.applyUnsaved('C:/vault/dir-ref.md', 2, '# R\n\n![图](dir-new/pic.png)。\n')
    await vi.advanceTimersByTimeAsync(600)
    const backOfPic = itemsOf(await service.backlinksOf('C:/vault/dir-new/pic.png'))
    expect(backOfPic.map((i) => i.sourceRelPath)).toEqual(['dir-ref.md'])
    // 旧键正证据删除广播
    expect(events.some((e) => e.relPath === 'dir-old/a.md' && e.status === 'deleted')).toBe(true)
  })

  it('批量合并通知与快照提交：整批一次 onChange 广播、一次 CURRENT 提交', async () => {
    const fs = makeFs({
      'C:/vault/dir-old/a.md': '# A\n',
      'C:/vault/dir-old/b.md': '# B\n',
      'C:/vault/dir-old/c.md': '# C\n',
    })
    const { service, storage } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    for (const name of ['a.md', 'b.md', 'c.md']) {
      const oldKey = `C:/vault/dir-old/${name}`
      const newKey = `C:/vault/dir-new/${name}`
      fs.files.delete(oldKey)
      fs.stats.delete(oldKey)
      fs.files.set(newKey, `# ${name.toUpperCase()}\n`)
      fs.stats.set(newKey, { mtimeMs: 1_700_000_010_000, size: 6 })
    }
    let notifyCount = 0
    service.onChange(() => { notifyCount += 1 })
    const writesBefore = storage.writes.length
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/dir-old/a.md', newFsPath: 'C:/vault/dir-new/a.md' },
      { oldFsPath: 'C:/vault/dir-old/b.md', newFsPath: 'C:/vault/dir-new/b.md' },
      { oldFsPath: 'C:/vault/dir-old/c.md', newFsPath: 'C:/vault/dir-new/c.md' },
    ])
    // 整批一次广播（旧侧+新侧合并；逐文件循环会按文件数广播）
    expect(notifyCount).toBe(1)
    // 快照提交一次（去抖后一次 CURRENT/分片写——advanceTimers 触发提交）
    await vi.advanceTimersByTimeAsync(2000)
    const commitWrites = storage.writes.slice(writesBefore).filter((w) => w.endsWith('/CURRENT'))
    expect(commitWrites.length).toBeLessThanOrEqual(1)
    expect(commitWrites.length).toBe(1)
  })

  it('大目录分批让出（yield 计数增长）', async () => {
    const initial: Record<string, string> = {}
    const moves: Array<{ oldFsPath: string; newFsPath: string }> = []
    for (let i = 0; i < 40; i++) {
      initial[`C:/vault/dir-old/f${i}.md`] = `# F${i}\n`
      moves.push({ oldFsPath: `C:/vault/dir-old/f${i}.md`, newFsPath: `C:/vault/dir-new/f${i}.md` })
    }
    const fs = makeFs(initial)
    const { service, scan } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    for (let i = 0; i < 40; i++) {
      fs.files.delete(`C:/vault/dir-old/f${i}.md`)
      fs.stats.delete(`C:/vault/dir-old/f${i}.md`)
      fs.files.set(`C:/vault/dir-new/f${i}.md`, `# F${i}\n`)
      fs.stats.set(`C:/vault/dir-new/f${i}.md`, { mtimeMs: 1, size: 6 })
    }
    const yieldsBefore = scan.yields
    await service.refreshRenamedBatch(moves)
    expect(scan.yields).toBeGreaterThan(yieldsBefore)
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(40)
  })

  it('跨根批移动：两根各自更新且互不串扰', async () => {
    const fs = makeFs({
      'C:/vault/dir/a.md': '# A\n',
      'D:/other/dir/b.md': '# B\n',
    })
    const { service } = makeService(fs)
    await service.initialize([
      { fsPath: 'C:/vault', uri: 'file:///c%3A/vault' },
      { fsPath: 'D:/other', uri: 'file:///d%3A/other' },
    ])
    // C 根目录移到 D 根（跨根目录移动）
    fs.files.delete('C:/vault/dir/a.md')
    fs.stats.delete('C:/vault/dir/a.md')
    fs.files.set('D:/other/dir-x/a.md', '# A\n')
    fs.stats.set('D:/other/dir-x/a.md', { mtimeMs: 1, size: 5 })
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/dir/a.md', newFsPath: 'D:/other/dir-x/a.md' },
    ])
    const roots = service.maintenanceInfo().roots
    expect(roots[0]!.fileCount).toBe(0) // C 根旧条目退场
    expect(roots[1]!.fileCount).toBe(2) // D 根新增（b.md + a.md）
  })

  it('排除语义：排除区内 rename 不进不出；移出排除区被登记（位置 glob）', async () => {
    const fs = makeFs({
      'C:/vault/keep.md': '# K\n',
      'C:/vault/ignored/x.md': '# X\n',
      'C:/vault/ignored/y.md': '# Y\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await service.setExcludePatterns(['ignored/**'])
    const before = service.maintenanceInfo().roots[0]!.fileCount // = 1（keep.md）
    // 排除区内 rename（ignored/x.md → ignored/x2.md，模式仍匹配）：不进不出
    fs.files.delete('C:/vault/ignored/x.md')
    fs.stats.delete('C:/vault/ignored/x.md')
    fs.files.set('C:/vault/ignored/x2.md', '# X\n')
    fs.stats.set('C:/vault/ignored/x2.md', { mtimeMs: 1, size: 4 })
    // 排除区 → 根（移出排除区）：按新位置登记
    fs.files.delete('C:/vault/ignored/y.md')
    fs.stats.delete('C:/vault/ignored/y.md')
    fs.files.set('C:/vault/y-out.md', '# Y\n')
    fs.stats.set('C:/vault/y-out.md', { mtimeMs: 1, size: 4 })
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/ignored/x.md', newFsPath: 'C:/vault/ignored/x2.md' },
      { oldFsPath: 'C:/vault/ignored/y.md', newFsPath: 'C:/vault/y-out.md' },
    ])
    // 排除是位置 glob：区内不进不出；移出者在新位置入索引域
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(before + 1)
  })
})

describe('VaultIndexService：review-loops 批量刷新 asset 登记次序（#9）', () => {
  it('目录恒等平移时批内 md 指向同批附件的边不断链（asset 先登记再抽边）', async () => {
    const fs = makeFs({
      'C:/vault/dir/a.md': '# A\n\n![图](pic.png)。\n',
      'C:/vault/dir/pic.png': '\u0000png',
      'C:/vault/keep.md': '# K\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(itemsOf(await service.backlinksOf('C:/vault/dir/pic.png')).map((i) => i.sourceRelPath)).toEqual(['dir/a.md'])
    // 磁盘完成目录平移 dir → dir2（a.md 对 pic.png 的相对路径恒等不变）
    for (const rel of ['a.md', 'pic.png']) {
      const oldKey = `C:/vault/dir/${rel}`
      const content = fs.files.get(oldKey)!
      fs.files.delete(oldKey)
      fs.stats.delete(oldKey)
      fs.files.set(`C:/vault/dir2/${rel}`, content)
      fs.stats.set(`C:/vault/dir2/${rel}`, { mtimeMs: 1_700_000_011_000, size: content.length })
    }
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/dir/a.md', newFsPath: 'C:/vault/dir2/a.md' },
      { oldFsPath: 'C:/vault/dir/pic.png', newFsPath: 'C:/vault/dir2/pic.png' },
    ])
    // 批内 md 的图片边解析到新位置附件（resolvedTarget 非空 → 反链命中）
    expect(itemsOf(await service.backlinksOf('C:/vault/dir2/pic.png')).map((i) => i.sourceRelPath)).toEqual(['dir2/a.md'])
  })
})

describe('VaultIndexService：review-loops 保存排除检查（#10）', () => {
  it('排除域 .md 保存后不进 model.files（与 watcher 同款排除）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/excluded/x.md': '# X\n',
    })
    const { service } = makeService(fs, { excludePatterns: ['excluded/**'] })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(1)
    // 保存事件（documentSaved）对排除域文件不得把条目带进索引
    await service.documentSaved('C:/vault/excluded/x.md')
    await vi.advanceTimersByTimeAsync(2000)
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(1)
  })
})

describe('VaultIndexService：review-loops relOf 上行判定（#22）', () => {
  it('POSIX 宿主下 .. 前缀文件名（..drafts.md）不误判越根', async () => {
    const fs = makeFs({
      '/vault/..drafts.md': '# D\n',
      '/vault/ok.md': '# O\n',
    })
    const { service } = makeService(fs, { isWindowsHost: false, storageRoot: '/store' })
    await service.initialize([{ fsPath: '/vault', uri: 'file:///vault' }])
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(2)
    // 真正的上行越根仍被拒绝
    await service.documentSaved('/vault/../outside.md')
    await vi.advanceTimersByTimeAsync(2000)
    expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(2)
  })
})

describe('VaultIndexService：review-loops 快照写失败与 tmp 回收（#13/#15）', () => {
  it('快照写入失败不中断初始化：失败根跳过持久化，后续根照常索引', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'D:/other/b.md': '# B\n',
    })
    const { service, storage } = makeService(fs)
    const failingRootBase = `C:/store/vsidian-index/${rootKeyOf('file:///c%3A/vault')}`
    const originalWriteFile = storage.writeFile.bind(storage)
    storage.writeFile = async (path: string, content: string) => {
      if (path.startsWith(failingRootBase)) {
        throw new Error('EACCES: disk full (simulated)')
      }
      return originalWriteFile(path, content)
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // 不再 reject：写失败仅影响持久化（内存索引与 notify 照常）
      await expect(service.initialize([
        { fsPath: 'C:/vault', uri: 'file:///c%3A/vault' },
        { fsPath: 'D:/other', uri: 'file:///d%3A/other' },
      ])).resolves.toBeUndefined()
      // 第一根内存索引照常可用
      expect((await service.backlinksOf('C:/vault/a.md')).status).toBe('ready')
      // 后续根照常初始化并持久化
      expect((await service.backlinksOf('D:/other/b.md')).status).toBe('ready')
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('提交后回收 baseDir 直下的原子写 tmp 文件残留', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n见 [[b]]。\n', 'C:/vault/b.md': '# B\n' })
    const { service, storage } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 模拟原子写崩溃残留（writeFile 的 <target>.tmp-<hex> 中缀形态）
    const tmpKey = `${STORE_BASE}/shard-000.json.tmp-deadbeef`
    storage.files.set(tmpKey, 'half-written')
    // 变更触发一次增量提交 → 回收清单带上 tmp 文件
    fs.files.set('C:/vault/a.md', '# A2\n\n见 [[b]]。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_020_000, size: 16 })
    await service.documentSaved('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(2000)
    expect(storage.files.has(tmpKey)).toBe(false)
  })
})

describe('VaultIndexService：review-loops 三连代增量快照可恢复（#17 服务层）', () => {
  it('两轮增量提交后新实例恢复最新代内容（继承链跨两代不断裂）', async () => {
    const initial: Record<string, string> = {}
    for (let i = 0; i < 24; i++) initial[`C:/vault/d${i % 4}/n${i}.md`] = `# N${i}\n`
    const fs = makeFs(initial)
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 第一轮增量：改一组文件（其余片继承 gen1）
    fs.files.set('C:/vault/d0/n0.md', '# N0-v2\n')
    fs.stats.set('C:/vault/d0/n0.md', { mtimeMs: 1_700_000_030_000, size: 9 })
    await first.service.documentSaved('C:/vault/d0/n0.md')
    await vi.advanceTimersByTimeAsync(2000)
    // 第二轮增量：再改另一组（继承上一代的继承片——实体在 gen1）
    fs.files.set('C:/vault/d1/n1.md', '# N1-v3\n')
    fs.stats.set('C:/vault/d1/n1.md', { mtimeMs: 1_700_000_040_000, size: 9 })
    await first.service.documentSaved('C:/vault/d1/n1.md')
    await vi.advanceTimersByTimeAsync(2000)
    // 新实例（同存储）恢复：直接拿到最新代（gen3）——若继承链断裂会回退旧代
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const result = await second.backlinksOf('C:/vault/d0/n0.md')
    expect(result.status).toBe('ready')
    // n0 的正文在 gen2 已变（无引用来源），新实例基线应为最新内容
    expect(itemsOf(result)).toHaveLength(0)
    fs.files.set('C:/vault/d0/n0.md', '# N0-v2 见 [[../d1/n1]]\n')
    fs.stats.set('C:/vault/d0/n0.md', { mtimeMs: 1_700_000_050_000, size: 22 })
    await second.documentSaved('C:/vault/d0/n0.md')
    await vi.advanceTimersByTimeAsync(2000)
    expect(itemsOf(await second.backlinksOf('C:/vault/d1/n1.md')).map((i) => i.sourceRelPath)).toEqual(['d0/n0.md'])
  })
})
