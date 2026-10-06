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
// 测试钉住 win32 语义：fixture 路径与断言全按 win32 形态书写（C:/、大小写折叠），
// isWindowsHost 注入即为此可测性服务——不随运行平台漂移（CI Linux 同样按 win32 语义断言）
const IS_WIN = true

interface FakeFs {
  files: Map<string, string>       // 绝对路径（/ 形态）→ 内容（原样，可含 \r\n）
  stats: Map<string, { mtimeMs: number; size: number; birthtimeMs?: number }>
}

function makeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map(Object.entries(initial))
  const stats = new Map<string, { mtimeMs: number; size: number; birthtimeMs?: number }>()
  for (const [p, c] of files) {
    stats.set(p, { mtimeMs: 1_700_000_000_000, size: c.length })
  }
  return { files, stats }
}

/** 扫描端口：listMarkdownFiles 按扩展名过滤 .md（磁盘真实形态，/ 分隔）；
 *  inaccessible 集合模拟 SSH 断连/权限错误（accessOf 返回 inaccessible）；
 *  #377 T02 起 listAllFiles 支持全文件列举（目录推导 + skipDir 剪枝 +
 *  failedDirs 三态）与 watcher 事件手动发射（emit） */
function scanPortOf(fs: FakeFs, events: string[] = []): VaultIndexScanPort & {
  yields: number
  inaccessible: Set<string>
  inaccessibleDirs: Set<string>
  emit: (fsPath: string) => void
  listAllCalls: number
} {
  const watchers: Array<(fsPath: string | null) => void> = []
  return {
    yields: 0,
    inaccessible: new Set<string>(),
    inaccessibleDirs: new Set<string>(),
    listAllCalls: 0,
    emit(fsPath: string) {
      for (const w of watchers) w(fsPath)
    },
    async listMarkdownFiles(rootFsPath: string) {
      const prefix = rootFsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/'
      return [...fs.files.keys()].filter((p) => p.startsWith(prefix) && /\.md$/i.test(p))
    },
    async listAllFiles(rootFsPath: string, opts?: { skipDir?: (fsPath: string) => boolean }) {
      this.listAllCalls += 1
      const prefix = rootFsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/'
      const all = [...fs.files.keys()].filter((p) => p.startsWith(prefix))
      // 根内祖先目录推导（含根自身）
      const dirs = new Set<string>([prefix.slice(0, -1)])
      for (const p of all) {
        let d = p.slice(0, p.lastIndexOf('/'))
        while (d.length >= prefix.length - 1 && !dirs.has(d)) {
          dirs.add(d)
          if (d.length <= prefix.length) break
          d = d.slice(0, d.lastIndexOf('/'))
        }
      }
      // 不可访问目录（三态：子树不列举且记 failedDirs——不冒充删除）
      const failedDirs = [...dirs].filter((d) => this.inaccessibleDirs.has(d))
      // 剪枝目录（skipDir 判定；剪掉的子树不进 failedDirs）
      const prunedDirs = new Set<string>()
      if (opts?.skipDir) {
        for (const d of dirs) {
          if (opts.skipDir(d.replace(/\\/g, '/'))) {
            prunedDirs.add(d)
          }
        }
      }
      const blocked = (p: string) =>
        failedDirs.some((d) => p.startsWith(`${d}/`)) || [...prunedDirs].some((d) => p.startsWith(`${d}/`))
      return { files: all.filter((p) => !blocked(p)), failedDirs }
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
    watchRoot(_rootFsPath, onEvent) {
      events.push('watch')
      watchers.push(onEvent)
      return () => events.push('unwatch')
    },
    async yieldToEventLoop() {
      this.yields += 1
      await Promise.resolve()
    },
  } as VaultIndexScanPort & {
    yields: number
    inaccessible: Set<string>
    inaccessibleDirs: Set<string>
    emit: (fsPath: string) => void
    listAllCalls: number
  }
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

  it('外部写回流的覆盖层在盘面一致时退役，断链快照不永久遮蔽基线（#256）', async () => {
    // 复刻跨根用例的微观时序：rename 期间目标退场基线 → 打开文档被外部
    // 写盘（宿主回流把盘面内容灌进未保存暂存）→ flush 抽边时目标不在基线
    // → 覆盖层持断链边；随后目标归位、盘面重扫——盘=暂存时覆盖层须退役
    // （基线即真相），否则断链边永久遮蔽已自愈的基线（外部写无保存/关闭
    // 事件，没有其他退场路径）
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(1)
    // rename 中间态：目标退场（watcher 重扫 missing → 基线条目移除）
    fs.files.delete('C:/vault/目标.md')
    fs.stats.delete('C:/vault/目标.md')
    notify!('C:/vault/目标.md')
    await vi.advanceTimersByTimeAsync(1200)
    // 外部写回 a 原文：磁盘已落新内容，宿主回流把盘面内容登记为「未保存」
    const restored = '# A\n\n引用 [[目标]]。\n'
    fs.files.set('C:/vault/a.md', restored)
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_020_000, size: restored.length })
    service.applyUnsaved('C:/vault/a.md', 9, restored)
    await vi.advanceTimersByTimeAsync(700) // flush：目标不在基线 → 断链边落覆盖层
    // 目标归位 + a 的盘面变更经 watcher 重扫（盘=暂存 → 覆盖层退役）
    fs.files.set('C:/vault/目标.md', '# 目标\n')
    fs.stats.set('C:/vault/目标.md', { mtimeMs: 1_700_000_021_000, size: 7 })
    notify!('C:/vault/目标.md')
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    // 基线接管：目标反链恢复（覆盖层断链残渣不再遮蔽）
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(1)
  })

  it('真实未保存编辑不受回流收敛影响（盘≠暂存时覆盖层继续接管）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    // 刻意不注入 isDocOpen：钉住端口缺省=视为在场的历史语义（生产 wiring
    // 恒注入；此处覆盖 rescanFile 在缺省分支下的行为）
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 用户编辑（未保存，盘面未变）：覆盖层必须继续遮蔽旧盘面基线
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\n引用消失。\n')
    await vi.advanceTimersByTimeAsync(700)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
    // 其他文件事件触发的本文件重扫（盘≠暂存且端口缺省视为在场）不得退役
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_030_000, size: 14 })
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
  })

  it('文档不在场的关闭残渣经重扫兜底退役（isDocOpen=false，#256）', async () => {
    // onDidCloseTextDocument 漏触发时覆盖层滞留（面板文档关闭竞态）——
    // watcher 重扫时文档已不在 textDocuments → 覆盖层必为残渣，兜底退役
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
      isDocOpen: () => false, // 文档从不在场（模拟关闭后残留）
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 面板期幽灵登记：未保存文本指向别处（盘≠暂存，回流收敛不命中）
    service.applyUnsaved('C:/vault/a.md', 5, '# A\n\n引用 [[其他]]。\n')
    await vi.advanceTimersByTimeAsync(700)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
    // 磁盘变更触发重扫：文档不在场 → 覆盖层兜底退役 → 基线接管
    fs.files.set('C:/vault/a.md', '# A\n\n引用 [[目标]] 与新文 [[目标]]。\n')
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_030_000, size: 30 })
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(2)
  })

  it('文档在场时不触发关闭残渣兜底（isDocOpen=true，覆盖层继续接管）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
      isDocOpen: () => true, // 文档始终在场（打开编辑中）
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\n引用消失。\n')
    await vi.advanceTimersByTimeAsync(700)
    // 其他文件事件引起的本文件重扫（盘≠暂存且文档在场）不得退役覆盖层
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_030_000, size: 14 })
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
  })

  it('外部删除时文档不在场的残渣兜底退役，幽灵边不再贡献反链（#256 review 轮）', async () => {
    // 文件被外部删除且其覆盖层残渣滞留（onDidClose 漏触发同发）：missing
    // 分支只移除基线条目，来源的覆盖层幽灵边会继续出现在反链查询里
    // （queryBacklinks 迭代全部覆盖条目）——文档不在场时必为残渣，须与
    // 基线移除同拍退役
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
      isDocOpen: () => false, // 删除时文档已不在场（关闭残渣滞留）
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 面板期幽灵登记：未保存文本指向目标（盘≠暂存，回流收敛不命中）
    service.applyUnsaved('C:/vault/a.md', 5, '# A\n\n引用 [[目标]] 与私文 [[目标]]。\n')
    await vi.advanceTimersByTimeAsync(700)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(2)
    // 外部删除 a：missing 分支移除基线；文档不在场 → 覆盖层残渣一并退役
    fs.files.delete('C:/vault/a.md')
    fs.stats.delete('C:/vault/a.md')
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(0)
  })

  it('外部删除时文档在场的覆盖层保留（编辑器内未保存内容仍接管查询）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n',
      'C:/vault/目标.md': '# 目标\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
      isDocOpen: () => true, // 文档始终在场（编辑器打开中，文件被外部删除）
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    service.applyUnsaved('C:/vault/a.md', 5, '# A\n\n引用 [[目标]] 与私文 [[目标]]。\n')
    await vi.advanceTimersByTimeAsync(700)
    fs.files.delete('C:/vault/a.md')
    fs.stats.delete('C:/vault/a.md')
    notify!('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(1200)
    // 基线条目已移除，但编辑器内未保存内容（2 边）继续接管反链查询
    expect(itemsOf(await service.backlinksOf('C:/vault/目标.md'))).toHaveLength(2)
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

  it('排除变更后已登记的未保存暂存不得经冲刷或 rename 批末重算复活（#269 review 轮）', async () => {
    const fs = makeFs(EXCLUDED_FS)
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 未排除时编辑 ex/秘密.md：pending 登记 + 布防冲刷（在途定时器）
    service.applyUnsaved('C:/vault/ex/秘密.md', 3, '# 秘密\n\n见 [[../b]] 再见 [[b]]。\n')
    // 排除命中该文档：setExcludePatterns 清覆盖层条目但 pending 与在途
    // 定时器残留——冲刷/批末重算通道须自行复检排除，不得复活
    await service.setExcludePatterns(['ex/**'])
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(600) // 在途冲刷定时器到期（flush 通道）
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    // rename 批末世界重算通道（批末遍历 unsaved 现存条目）同口径不复活
    fs.files.delete('C:/vault/b.md')
    fs.stats.delete('C:/vault/b.md')
    fs.files.set('C:/vault/b2.md', '# B\n')
    fs.stats.set('C:/vault/b2.md', { mtimeMs: 1_700_000_011_000, size: 4 })
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/b.md', newFsPath: 'C:/vault/b2.md' },
    ])
    expect(itemsOf(await service.backlinksOf('C:/vault/b2.md'))).toHaveLength(0)
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
  })

  it('getExcludePatterns / maintenanceInfo 回读当前模式与正常扫描完成态', async () => {
    const { service } = makeService(makeFs(EXCLUDED_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await service.setExcludePatterns(['**/.git/**'])
    expect(service.getExcludePatterns()).toEqual(['**/.git/**'])
    expect(service.maintenanceInfo().excludePatterns).toEqual(['**/.git/**'])
    expect(service.maintenanceInfo().roots).toMatchObject([
      { hasData: true, scanning: false, verifying: false, queued: 0 },
    ])
  })

  it('旧扫描提交结束不得放行新扫描期间的删除队列（#198）', async () => {
    const firstTemp = 'C:/vault/ex-zone/a.md'
    const lastTemp = 'C:/vault/ex-zone/b.md'
    const fs = makeFs({
      'C:/vault/base.md': '# 基线\n',
      [firstTemp]: '# 临时甲\n',
      [lastTemp]: '# 临时乙\n',
    })
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => { notify = onEvent; return () => {} }
    const storage = storagePortOf()
    const service = new VaultIndexService(scan, storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])

    let releaseOldCommit!: () => void
    let enteredOldCommit!: () => void
    const oldCommitGate = new Promise<void>((resolve) => { releaseOldCommit = resolve })
    const oldCommitEntered = new Promise<void>((resolve) => { enteredOldCommit = resolve })
    const writeFile = storage.writeFile.bind(storage)
    let holdOldCommit = true
    storage.writeFile = async (path, content) => {
      await writeFile(path, content)
      if (holdOldCommit && path.endsWith('/CURRENT')) {
        holdOldCommit = false
        enteredOldCommit()
        await oldCommitGate
      }
    }

    let releaseNewRead!: () => void
    let enteredNewRead!: () => void
    const newReadGate = new Promise<void>((resolve) => { releaseNewRead = resolve })
    const newReadEntered = new Promise<void>((resolve) => { enteredNewRead = resolve })
    const readFileText = scan.readFileText.bind(scan)
    let holdNewRead = false
    scan.readFileText = async (path) => {
      const raw = await readFileText(path)
      if (holdNewRead && path.replace(/\\/g, '/') === lastTemp) {
        enteredNewRead()
        await newReadGate
      }
      return raw
    }

    let oldScan: Promise<void> | undefined
    let newScan: Promise<void> | undefined
    try {
      // 设置页可以在旧扫描已发布模型、但 CURRENT 提交尚未返回时发送下一次设置。
      oldScan = service.setExcludePatterns(['**/.git/**'])
      await oldCommitEntered
      holdNewRead = true
      newScan = service.setExcludePatterns(['**/.git/**', '**/node_modules/**'])
      await newReadEntered

      releaseOldCommit()
      await oldScan
      const scanningWhileNewRead = service.maintenanceInfo().roots[0]!.scanning
      for (const path of [firstTemp, lastTemp]) {
        fs.files.delete(path)
        fs.stats.delete(path)
        notify!(path)
      }
      await vi.advanceTimersByTimeAsync(1200)
      const countWhileNewRead = service.maintenanceInfo().roots[0]!.fileCount

      // 新扫描读到了删除前的正文；删除事件须等该模型发布后再重扫，不能被覆盖。
      releaseNewRead()
      await newScan
      await vi.advanceTimersByTimeAsync(1200)
      const finalRoot = service.maintenanceInfo().roots[0]!
      expect({
        scanningWhileNewRead,
        countWhileNewRead,
        finalCount: finalRoot.fileCount,
        finalScanning: finalRoot.scanning,
        finalQueued: finalRoot.queued,
      }).toEqual({
        scanningWhileNewRead: true, countWhileNewRead: 3,
        finalCount: 1, finalScanning: false, finalQueued: 0,
      })
    } finally {
      releaseOldCommit()
      releaseNewRead()
      await Promise.allSettled([oldScan, newScan])
      service.dispose()
    }
  })

  it('旧扫描最后一次读取结束不得覆盖新排除域（#198）', async () => {
    const lastTemp = 'C:/vault/ex-zone/b.md'
    const fs = makeFs({ 'C:/vault/base.md': '# 基线\n', [lastTemp]: '# 临时\n' })
    const { service, scan } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const readEntered = new Promise<void>((resolve) => { entered = resolve })
    const readFileText = scan.readFileText.bind(scan)
    scan.readFileText = async (path) => {
      const raw = await readFileText(path)
      if (path.replace(/\\/g, '/') === lastTemp) {
        entered()
        await gate
      }
      return raw
    }
    const oldScan = service.setExcludePatterns([])
    try {
      await readEntered
      await service.setExcludePatterns(['ex-zone/**'])
      expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(1)
      release()
      await oldScan
      // 旧列表已读到正文，取消检查仍须阻止它发布到新覆盖域与快照。
      expect(service.maintenanceInfo().roots[0]!.fileCount).toBe(1)
    } finally {
      release()
      await oldScan
      service.dispose()
    }
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

// ---- #269 rename 后新目标反链桶空窗：连续 rename 静默漏改写的契约 ----
// 通道时序基线（见 vaultRenameWiring 模块头与本票落档）：引用者的 will edit
// 只作用 buffer 不落盘（1.86 实测），其可见性走 dirty 豁免 + 覆盖层冲刷
// （冲刷晚于 did 登记时边即解析）；断链边入基线的真实可达时序是「引用者
// 落盘（用户保存）+ watcher 重扫早于本批登记」的泵竞态。第一例复刻后者
// 钉遍 3 的结构性契约，第二例复刻 buffer-only 改写钉桶外兜底，第三例钉
// 冲刷早于登记的慢时序（大批量/慢盘 rename）下覆盖层的批末重算。

describe('VaultIndexService：#269 目标归位重抽依赖者与桶兜底', () => {
  function makeWatcherService(fs: FakeFs) {
    let notify: ((p: string | null) => void) | undefined
    const scan = scanPortOf(fs)
    scan.watchRoot = (_root, onEvent) => {
      notify = onEvent
      return () => {}
    }
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    return {
      service,
      fire: (p: string) => notify!(p),
    }
  }

  it('rename 后新目标 incoming 含已落盘引用者（依赖者重抽、桶随归位重建，#269）', async () => {
    const fs = makeFs({
      'C:/vault/改名目标.md': '# 目标\n',
      'C:/vault/rename-ref-a.md': '# 引用甲\n\n见 [[改名目标]]。\n',
      'C:/vault/notes/rename-ref-b.md': '# 引用乙\n\n上行 [[../改名目标]]。\n',
    })
    const { service, fire } = makeWatcherService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const before = service.renameCandidatesOf('C:/vault/改名目标.md')
    expect(before.incoming).toHaveLength(2) // 基线：旧目标桶含两个引用者
    // 1. will edit 落盘（引用者文本改写为新名；新目标此刻尚不存在）
    fs.files.set('C:/vault/rename-ref-a.md', '# 引用甲\n\n见 [[改名目标2]]。\n')
    fs.stats.set('C:/vault/rename-ref-a.md', { mtimeMs: 1_700_000_010_000, size: 20 })
    fs.files.set('C:/vault/notes/rename-ref-b.md', '# 引用乙\n\n上行 [[../改名目标2]]。\n')
    fs.stats.set('C:/vault/notes/rename-ref-b.md', { mtimeMs: 1_700_000_010_000, size: 22 })
    fire('C:/vault/rename-ref-a.md')
    fire('C:/vault/notes/rename-ref-b.md')
    await vi.advanceTimersByTimeAsync(1200) // watcher 去抖 800ms + 增量泵
    // 2. rename 应用（磁盘旧名消失、新名就位）+ did 通道刷新登记新路径
    fs.files.delete('C:/vault/改名目标.md')
    fs.stats.delete('C:/vault/改名目标.md')
    fs.files.set('C:/vault/改名目标2.md', '# 目标\n')
    fs.stats.set('C:/vault/改名目标2.md', { mtimeMs: 1_700_000_011_000, size: 7 })
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/改名目标.md', newFsPath: 'C:/vault/改名目标2.md' },
    ])
    // 断言：新目标 incoming 含两个已落盘引用者（连续 rename 的改写依据）
    const after = service.renameCandidatesOf('C:/vault/改名目标2.md')
    expect(after.status).toBe('ready')
    expect(after.incoming.map((g) => g.fsPath).sort()).toEqual([
      'C:\\vault\\notes\\rename-ref-b.md',
      'C:\\vault\\rename-ref-a.md',
    ])
  })

  it('rename 后新目标 incoming 含面板打开引用者（覆盖层边桶外兜底，#269）', async () => {
    const fs = makeFs({
      'C:/vault/改名目标.md': '# 目标\n',
      'C:/vault/rename-ref-a.md': '# 引用甲\n\n见 [[改名目标]]。\n',
    })
    const { service } = makeWatcherService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.renameCandidatesOf('C:/vault/改名目标.md').incoming).toHaveLength(1)
    // 1. will edit 只作用面板 buffer（盘面保持旧名文本，不落盘、无 watcher）
    service.applyUnsaved('C:/vault/rename-ref-a.md', 2, '# 引用甲\n\n见 [[改名目标2]]。\n')
    // 2. rename 应用 + did 通道登记新路径（真实时序：防抖冲刷晚于 did）
    fs.files.delete('C:/vault/改名目标.md')
    fs.stats.delete('C:/vault/改名目标.md')
    fs.files.set('C:/vault/改名目标2.md', '# 目标\n')
    fs.stats.set('C:/vault/改名目标2.md', { mtimeMs: 1_700_000_011_000, size: 7 })
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/改名目标.md', newFsPath: 'C:/vault/改名目标2.md' },
    ])
    // 3. 覆盖层防抖冲刷（新名已登记，buffer 边解析命中新目标）
    await vi.advanceTimersByTimeAsync(600)
    // 断言：盘面基线仍指旧名（依赖者重抽无从接通），唯一来源是覆盖层——
    // 桶缺失时 renameCandidatesOf 不得整段跳过（桶外覆盖层兜底）
    const after = service.renameCandidatesOf('C:/vault/改名目标2.md')
    expect(after.status).toBe('ready')
    expect(after.incoming.map((g) => g.fsPath)).toEqual(['C:\\vault\\rename-ref-a.md'])
    expect(after.incoming[0]!.edges[0]).toMatchObject({ kind: 'wikilink', target: '改名目标2', resolvedTarget: '改名目标2.md' })
  })

  it('覆盖层冲刷早于新路径登记时，批末按新清单重算接通断链边（#269 慢时序兜底）', async () => {
    const fs = makeFs({
      'C:/vault/改名目标.md': '# 目标\n',
      'C:/vault/rename-ref-a.md': '# 引用甲\n\n见 [[改名目标]]。\n',
    })
    const { service } = makeWatcherService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.renameCandidatesOf('C:/vault/改名目标.md').incoming).toHaveLength(1)
    // 1. will edit 只作用面板 buffer；大批量/慢盘 rename 时 did 的登记晚于
    //    500ms 防抖冲刷——冲刷时刻新路径未登记，覆盖层边按断链落层
    service.applyUnsaved('C:/vault/rename-ref-a.md', 2, '# 引用甲\n\n见 [[改名目标2]]。\n')
    await vi.advanceTimersByTimeAsync(600)
    expect(service.renameCandidatesOf('C:/vault/改名目标.md').incoming).toHaveLength(0) // 旧目标已查不到（buffer 改走，覆盖层接管）
    // 2. rename 应用 + did 通道登记新路径——冲刷定时器已消费、无后续冲刷
    //    时机，批末须对现存未保存条目按完整新清单重算，否则断链边滞留、
    //    连续 rename 静默漏改（省扩展名双链的断链 target 与 rel 不同形，
    //    桶外兜底的 fold 匹配救不回）
    fs.files.delete('C:/vault/改名目标.md')
    fs.stats.delete('C:/vault/改名目标.md')
    fs.files.set('C:/vault/改名目标2.md', '# 目标\n')
    fs.stats.set('C:/vault/改名目标2.md', { mtimeMs: 1_700_000_011_000, size: 7 })
    await service.refreshRenamedBatch([
      { oldFsPath: 'C:/vault/改名目标.md', newFsPath: 'C:/vault/改名目标2.md' },
    ])
    const after = service.renameCandidatesOf('C:/vault/改名目标2.md')
    expect(after.status).toBe('ready')
    expect(after.incoming.map((g) => g.fsPath)).toEqual(['C:\\vault\\rename-ref-a.md'])
    expect(after.incoming[0]!.edges[0]).toMatchObject({ kind: 'wikilink', target: '改名目标2', resolvedTarget: '改名目标2.md' })
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

  /** relOf 是 private 纵深防御内层（公开入口均被 rootOf 前置拦截，越根
   *  行为差异不可经公开面观察）——按平台分隔符直接钉契约：win32 的
   *  path.relative 产出 `..\` 形态，越根判定必须跟随 ops.sep（与
   *  vaultLink.isInsideRoot 同口径），硬编码 '../' 会漏拦 */
  function relOfProbe(service: VaultIndexService, fsPath: string): string | null {
    const internal = service as unknown as {
      relOf(state: unknown, p: string): string | null
      roots: Map<string, unknown>
    }
    const state = internal.roots.values().next().value
    return internal.relOf(state, fsPath)
  }

  it('Windows 宿主下多段越根（..\\ 形态）判 null，根内路径与 .. 前缀文件名不受影响', async () => {
    const fs = makeFs({
      'C:/vault/..drafts.md': '# D\n',
      'C:/vault/sub/a.md': '# A\n',
    })
    const { service } = makeService(fs, { isWindowsHost: true, storageRoot: 'C:/store' })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 多段越根：win32.relative 产出 '..\outside.md'，旧实现 startsWith('../') 漏拦
    expect(relOfProbe(service, 'C:/outside.md')).toBeNull()
    // 纯上行到盘根（rel === '..'）两平台一致拒绝
    expect(relOfProbe(service, 'C:/')).toBeNull()
    // 根内路径与 .. 前缀文件名照常
    expect(relOfProbe(service, 'C:/vault/sub/a.md')).toBe('sub/a.md')
    expect(relOfProbe(service, 'C:/vault/..drafts.md')).toBe('..drafts.md')
  })

  it('POSIX 宿主越根判定语义保持（分隔符跟随不影响）', async () => {
    const fs = makeFs({
      '/vault/sub/a.md': '# A\n',
      '/vault/..drafts.md': '# D\n',
    })
    const { service } = makeService(fs, { isWindowsHost: false, storageRoot: '/store' })
    await service.initialize([{ fsPath: '/vault', uri: 'file:///vault' }])
    expect(relOfProbe(service, '/outside.md')).toBeNull()
    expect(relOfProbe(service, '/')).toBeNull()
    expect(relOfProbe(service, '/vault/sub/a.md')).toBe('sub/a.md')
    expect(relOfProbe(service, '/vault/..drafts.md')).toBe('..drafts.md')
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

describe('VaultIndexService：review-loops 反链查询 fold 匹配（#11）', () => {
  it('Windows 宿主下查询路径大小写漂移不产生假空反链（与 renameCandidatesOf 同口径）', async () => {
    // 磁盘真实形态 Pic.png（扫描侧 rel 原样登记，resolvedTarget 同形态）
    const fs = makeFs({
      'C:/vault/dir/Pic.png': '\u0000png',
      'C:/vault/dir/a.md': '# A\n\n![图](Pic.png)。\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 大小写漂移的查询路径（用户/宿主传入形态）：fold 桶匹配命中
    expect(itemsOf(await service.backlinksOf('C:/vault/dir/pic.png')).map((i) => i.sourceRelPath)).toEqual(['dir/a.md'])
    // 原形态查询照常
    expect(itemsOf(await service.backlinksOf('C:/vault/dir/Pic.png')).map((i) => i.sourceRelPath)).toEqual(['dir/a.md'])
  })
})

describe('VaultIndexService：review-loops 文档关闭退役（#18）', () => {
  it('documentClosed 退役未保存覆盖层：幽灵反链退场、基线接管查询', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/b.md': '# B\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 编辑 a.md 加引用（未保存）→ 覆盖层接管，b 出现反链
    service.applyUnsaved('C:/vault/a.md', 2, '# A\n\n见 [[b]]。\n')
    await vi.advanceTimersByTimeAsync(600)
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toEqual(['a.md'])
    // 编辑后不保存关闭面板 → 覆盖层退役，反链回到磁盘基线（无引用）
    service.documentClosed('C:/vault/a.md')
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md'))).toHaveLength(0)
    // 再次编辑仍正常（退役不破坏后续覆盖层登记）
    service.applyUnsaved('C:/vault/a.md', 3, '# A\n\n再见 [[b]]。\n')
    await vi.advanceTimersByTimeAsync(600)
    expect(itemsOf(await service.backlinksOf('C:/vault/b.md')).map((i) => i.sourceRelPath)).toEqual(['a.md'])
  })
})

describe('VaultIndexService：review-loops 三连代增量快照可恢复（#17 服务层）', () => {
  it('两轮增量提交后新实例恢复最新代内容（继承链跨两代不断裂）', async () => {
    const initial: Record<string, string> = {}
    for (let i = 0; i < 24; i++) initial[`C:/vault/d${i % 4}/n${i}.md`] = `# N${i}\n`
    const fs = makeFs(initial)
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 第一轮增量：改一组文件（其余片继承 gen1）——n0 正文带 gen1 没有的
    // 引用边（n0→n1，恢复代特征 A）
    fs.files.set('C:/vault/d0/n0.md', '# N0-v2 见 [[../d1/n1]]\n')
    fs.stats.set('C:/vault/d0/n0.md', { mtimeMs: 1_700_000_030_000, size: 22 })
    await first.service.documentSaved('C:/vault/d0/n0.md')
    await vi.advanceTimersByTimeAsync(2000)
    // 第二轮增量：再改另一组（继承上一代的继承片——实体在 gen1）——n1
    // 正文带 gen2 也没有的引用边（n1→n2，恢复代特征 B）
    fs.files.set('C:/vault/d1/n1.md', '# N1-v3 见 [[../d2/n2]]\n')
    fs.stats.set('C:/vault/d1/n1.md', { mtimeMs: 1_700_000_040_000, size: 22 })
    await first.service.documentSaved('C:/vault/d1/n1.md')
    await vi.advanceTimersByTimeAsync(2000)
    // 新实例（同存储）恢复：直接拿到最新代（gen3）——若继承链断裂会回退旧代。
    // 恢复代区分断言（review-loops R6 加强）：两条代特征边都在场——
    //   特征 A（n0→n1）：回退 gen1 时缺失（n1 反链为空）
    //   特征 B（n1→n2）：回退 gen1 或 gen2 时缺失（n2 反链无 d1/n1.md）
    // 旧实现的「空 items」断言在新旧代都无引用时两可，无法区分代
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const n1Result = await second.backlinksOf('C:/vault/d1/n1.md')
    expect(n1Result.status).toBe('ready')
    expect(itemsOf(n1Result).map((i) => i.sourceRelPath)).toEqual(['d0/n0.md'])
    expect(itemsOf(await second.backlinksOf('C:/vault/d2/n2.md')).map((i) => i.sourceRelPath))
      .toEqual(['d1/n1.md'])
    // 恢复后的实例可继续增量提交（原尾段语义保留）：n0 改指向 n2 后，
    // n2 的反链按来源路径序含两个引用者
    fs.files.set('C:/vault/d0/n0.md', '# N0-v2 见 [[../d2/n2]]\n')
    fs.stats.set('C:/vault/d0/n0.md', { mtimeMs: 1_700_000_050_000, size: 22 })
    await second.documentSaved('C:/vault/d0/n0.md')
    await vi.advanceTimersByTimeAsync(2000)
    expect(itemsOf(await second.backlinksOf('C:/vault/d2/n2.md')).map((i) => i.sourceRelPath)).toEqual(['d0/n0.md', 'd1/n1.md'])
  })
})

describe('VaultIndexService：出链查询（出链面板批次）', () => {
  const OUT_FS = {
    'C:/vault/cur.md': [
      '# 当前笔记',
      '',
      '见 [[设计笔记#标题一]] 与 [外部](https://example.com)。',
      '还有 [文档](./docs/参考.md) 与 ![图](./assets/pic.png)。',
      '断链 [[不存在的目标]] 与 [危险](javascript:alert(1))。',
      '',
    ].join('\n'),
    'C:/vault/设计笔记.md': '# 设计\n\n## 标题一\n',
    'C:/vault/docs/参考.md': '# 参考\n',
    'C:/vault/assets/pic.png': '(binary)',
  }

  /** 类型收窄：非 ready 直接失败 */
  function outItemsOf(r: Awaited<ReturnType<VaultIndexService['outlinksOf']>>) {
    if (r.status !== 'ready') {
      throw new Error(`期望 ready 状态，实际 ${r.status}`)
    }
    return r.items
  }

  it('命中/断链载荷形态与外链排除；stable 排序（resolved → 目标 → 区间）', async () => {
    const { service } = makeService(makeFs(OUT_FS))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const items = outItemsOf(await service.outlinksOf('C:/vault/cur.md'))
    expect(items.map((i) => [i.targetDisplay, i.resolved])).toEqual([
      ['pic', true],
      ['参考', true],
      ['设计笔记', true],
      ['不存在的目标', false],
    ])
    const design = items.find((i) => i.targetDisplay === '设计笔记')!
    expect(design.anchor).toBe('标题一')
    expect(design.targetRelPath).toBe('设计笔记.md')
    // fsPath 为宿主平台分隔符形态（win32 \ / posix /）
    expect(design.targetFsPath!.endsWith('设计笔记.md')).toBe(true)
    expect(design.kind).toBe('wikilink')
    // 外部 scheme 与危险 scheme 边不进面板
    expect(items.some((i) => i.targetDisplay.includes('example.com'))).toBe(false)
    expect(items.some((i) => i.targetDisplay.includes('javascript'))).toBe(false)
    // 断链：rel/fsPath 为 null、display 用 target 原文
    const broken = items.find((i) => !i.resolved)!
    expect(broken.targetRelPath).toBeNull()
    expect(broken.targetFsPath).toBeNull()
  })

  it('覆盖层即时性：未保存新增出链立即可查（与 queryBacklinks 同源 overlay 语义）', async () => {
    const fs = makeFs({ 'C:/vault/cur.md': '# 无出链\n', 'C:/vault/b.md': '# B\n' })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(outItemsOf(await service.outlinksOf('C:/vault/cur.md'))).toHaveLength(0)
    service.applyUnsaved('C:/vault/cur.md', 2, '# 新出链\n\n见 [[b]]。\n')
    await vi.advanceTimersByTimeAsync(700)
    const items = outItemsOf(await service.outlinksOf('C:/vault/cur.md'))
    expect(items).toHaveLength(1)
    expect(items[0]!.targetDisplay).toBe('b')
    expect(items[0]!.targetFsPath!.endsWith('b.md')).toBe(true)
  })

  it('四态：无工作区 error；扫描中 loading；无出链 ready + 空', async () => {
    expect(await makeService(makeFs(OUT_FS)).service.outlinksOf('D:/other/x.md'))
      .toMatchObject({ status: 'error', reason: 'no-workspace' })
    const { service } = makeService(makeFs({ 'C:/vault/孤岛.md': '# 孤岛\n' }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(await service.outlinksOf('C:/vault/孤岛.md')).toMatchObject({ status: 'ready', items: [] })
    // loading：门闩挂起首扫（反链 loading 用例同手法）
    let releaseScan: (() => void) | undefined
    const gate = new Promise<void>((r) => { releaseScan = r })
    const fs = makeFs(OUT_FS)
    const scan = scanPortOf(fs)
    const origList = scan.listMarkdownFiles.bind(scan)
    scan.listMarkdownFiles = async (root: string) => {
      await gate
      return origList(root)
    }
    const gated = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    const init = gated.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await Promise.resolve()
    expect((await gated.outlinksOf('C:/vault/cur.md')).status).toBe('loading')
    releaseScan!()
    await init
  })
})

describe('VaultIndexService：birthtime 与长片段（形态改版批次）', () => {
  it('birthtimeMs 采集进文件条目并随快照往返（恢复后组排序键可用）', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n', 'C:/vault/目标.md': '# 目标\n' })
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_700_000_000_000, size: 20, birthtimeMs: 1_600_000_000_000 })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await vi.advanceTimersByTimeAsync(2000) // 快照合并提交落定
    const items = itemsOf(await first.service.backlinksOf('C:/vault/目标.md'))
    expect(items[0]!.sourceBirthtimeMs).toBe(1_600_000_000_000)
    expect(items[0]!.sourceMtimeMs).toBe(1_700_000_000_000)
    // 新实例同存储恢复：birthtime 经片序列化/反序列化往返
    const second = new VaultIndexService(first.scan, first.storage, { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const restored = itemsOf(await second.backlinksOf('C:/vault/目标.md'))
    expect(restored[0]!.sourceBirthtimeMs).toBe(1_600_000_000_000)
  })

  it('旧快照缺 birthtime 列容忍（恢复后按 0 语义沉底）', async () => {
    // 第一实例的 stat 无 birthtime（POSIX 语义）→ 快照行无第 6 列 → 恢复后 0
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n引用 [[目标]]。\n', 'C:/vault/目标.md': '# 目标\n' })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await vi.advanceTimersByTimeAsync(2000)
    const second = new VaultIndexService(first.scan, first.storage, { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const restored = itemsOf(await second.backlinksOf('C:/vault/目标.md'))
    expect(restored[0]!.sourceBirthtimeMs).toBe(0)
  })

  it('backlinksOf 长片段：±2 行窗口与片段起点（snippetStart / snippetLongStart）', async () => {
    const text = [
      '前0',
      '前1',
      '前2',
      '引用 [[目标]] 行',
      '后1',
      '后2',
      '后3',
    ].join('\n')
    const { service } = makeService(makeFs({ 'C:/vault/a.md': `${text}\n`, 'C:/vault/目标.md': '# 目标\n' }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const item = itemsOf(await service.backlinksOf('C:/vault/目标.md'))[0]!
    // 短片段 = 引用行整行，起点 = 行 3 行首
    expect(item.snippet).toBe('引用 [[目标]] 行')
    expect(item.snippetStart).toBe('前0\n前1\n前2\n'.length)
    // 长片段 = 行 1..5（引用行 ±2），头部截断（前 0 行被裁）加「…」
    expect(item.snippetLong).toBe(`…前1\n前2\n引用 [[目标]] 行\n后1\n后2`)
    expect(item.snippetLongStart).toBe('前0\n'.length)
  })

  it('backlinksOf 长片段：总长上限 300 字符，超限尾截断加「…」', async () => {
    const long = '长'.repeat(400)
    const text = `上\n${long} [[目标]]\n下`
    const { service } = makeService(makeFs({ 'C:/vault/a.md': `${text}\n`, 'C:/vault/目标.md': '# 目标\n' }))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const item = itemsOf(await service.backlinksOf('C:/vault/目标.md'))[0]!
    expect(item.snippetLong.length).toBe(301) // 300 + 「…」
    expect(item.snippetLong.endsWith('…')).toBe(true)
  })
})

// ---- #377 T02 全文件清单：登记 / 排除 / 持久化 / 事件 / 代次 / 核验 / 查询 ----

/** 服务级候选查询收窄：非 ready 直接失败 */
function candidatesOf(r: ReturnType<VaultIndexService['queryWikilinkFileCandidates']>) {
  if (r.status !== 'ready') {
    throw new Error(`期望 ready 状态，实际 ${r.status}`)
  }
  return r
}

describe('VaultIndexService：全文件清单（#377 T02）', () => {
  it('全文件登记：所有未排除文件入清单并落盘 catalog.json；常用资源取真实 mtime，未知类型仅记名 mtime=0', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/素材/配图.png': 'png',
      'C:/vault/手册.pdf': 'pdf',
      'C:/vault/歌曲.mp3': 'mp3',
      'C:/vault/片段.mp4': 'mp4',
      'C:/vault/说明.txt': 'txt',
      'C:/vault/cache.pyc': 'pyc',
      'C:/vault/lib.so': 'so',
      'C:/vault/Makefile': 'mk',
    })
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_000, size: 4 })
    fs.stats.set('C:/vault/素材/配图.png', { mtimeMs: 2_000, size: 3 })
    fs.stats.set('C:/vault/cache.pyc', { mtimeMs: 9_000, size: 99 }) // 即使磁盘可 stat，other 类不取
    for (const p of ['C:/vault/手册.pdf', 'C:/vault/歌曲.mp3', 'C:/vault/片段.mp4', 'C:/vault/说明.txt', 'C:/vault/lib.so', 'C:/vault/Makefile']) {
      fs.stats.set(p, { mtimeMs: 500, size: 1 }) // 同 mtime：稳定路径破同分
    }
    const { service, storage } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(9)
    const persisted = storage.files.get(`${STORE_BASE}/catalog.json`)
    expect(persisted).toBeDefined()
    const empty = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', ''))
    expect(empty.total).toBe(6) // md/图片/PDF/音频/视频/文本——other 三项不进空查询
    expect(empty.items.map((i) => i.name)).toEqual([
      '配图.png', 'a.md', '手册.pdf', '歌曲.mp3', '片段.mp4', '说明.txt',
    ]) // mtime 已知者按新→旧（2000 → 1000 → 其余默认 1.7e12 同值走稳定路径）
    const withQuery = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', 'pyc'))
    expect(withQuery.items.map((i) => i.name)).toEqual(['cache.pyc']) // 有查询允许未知/编译类型
    expect(withQuery.items[0]!.mtimeMs).toBe(0) // 仅记名：未知不伪装为磁盘时间
  })

  it('来源无路径/不属于任何根：候选返回 no-workspace，不猜根不产候选（T07 补钉）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
    })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 未保存无路径文档（untitled）或根外路径：rootOf 无匹配 → no-workspace
    const r = service.queryWikilinkFileCandidates('C:/别处/来源.md', 'a')
    expect(r).toEqual({ status: 'unavailable', reason: 'no-workspace' })
  })

  it('排除语义：.git / node_modules 与用户排除不入清单；排除变更触发覆盖范围重算', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/.git/objects/pack.png': 'x',
      'C:/vault/node_modules/pkg/res.png': 'x',
      'C:/vault/草稿/draft.png': 'x',
    })
    const { service } = makeService(fs, {
      excludePatterns: ['**/.git/**', '**/node_modules/**', '草稿'],
    })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(1)
    // 用户排除移除（保留默认排除）：draft.png 随覆盖范围重算入清单
    await service.setExcludePatterns(['**/.git/**', '**/node_modules/**'])
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
    const hit = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', 'draft'))
    expect(hit.items.map((i) => i.relPath)).toEqual(['草稿/draft.png'])
    // 排除恢复：重算后再次退出清单（排除域不进不出）
    await service.setExcludePatterns(['**/.git/**', '**/node_modules/**', '草稿'])
    expect(candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', 'draft')).total).toBe(0)
  })

  it('持久化恢复：健康 catalog.json 重开不重新列举；损坏 catalog.json 走全量重建', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n', 'C:/vault/配图.png': 'png' })
    const first = makeService(fs)
    await first.service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(first.storage.files.get(`${STORE_BASE}/catalog.json`)).toBeDefined()
    // 第二实例：健康快照 → 直接恢复，不再列举
    const second = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await second.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const callsAfterRestore = first.scan.listAllCalls
    expect(second.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
    // 第三实例：损坏 catalog.json → 重建（重新列举）
    first.storage.files.set(`${STORE_BASE}/catalog.json`, '{corrupted')
    const third = new VaultIndexService(first.scan, first.storage, {
      storageRoot: 'C:/store', isWindowsHost: IS_WIN,
    })
    await third.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(first.scan.listAllCalls).toBeGreaterThan(callsAfterRestore)
    expect(third.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
    expect(candidatesOf(third.queryWikilinkFileCandidates('C:/vault/a.md', '配图')).total).toBe(1)
  })

  it('watcher 事件维护：非 md 文件创建/删除更新清单并递增清单代次；不可访问不冒充删除', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n' })
    const { service, scan } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const gen0 = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '')).catalogGen
    // 创建：新 png 落盘 + 事件
    fs.files.set('C:/vault/新图.png', 'png')
    fs.stats.set('C:/vault/新图.png', { mtimeMs: 5_000, size: 3 })
    scan.emit('C:/vault/新图.png')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
    const afterCreate = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '新图'))
    expect(afterCreate.items[0]!.mtimeMs).toBe(5_000)
    expect(afterCreate.catalogGen).toBeGreaterThan(gen0)
    // 不可访问（SSH 断连）：条目保留
    scan.inaccessible.add('C:/vault/新图.png')
    scan.emit('C:/vault/新图.png')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
    // 删除（missing 正证据）：条目移除
    scan.inaccessible.delete('C:/vault/新图.png')
    fs.files.delete('C:/vault/新图.png')
    fs.stats.delete('C:/vault/新图.png')
    scan.emit('C:/vault/新图.png')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(1)
    expect(candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '新图')).total).toBe(0)
  })

  it('md 保存路径与 rename 批刷新同步维护清单条目', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n![[配图.png]]\n',
      'C:/vault/配图.png': 'png',
      'C:/vault/未引用图.png': 'png',
    })
    fs.stats.set('C:/vault/a.md', { mtimeMs: 100, size: 10 })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // md 保存（mtime 更新）：清单条目跟随磁盘 stat
    fs.stats.set('C:/vault/a.md', { mtimeMs: 200, size: 14 })
    fs.files.set('C:/vault/a.md', '# A\n\n![[配图.png]]\n更多\n')
    await service.documentSaved('C:/vault/a.md')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', 'a.md')).items[0]!.mtimeMs).toBe(200)
    // rename：旧路径退场、新路径登记（含未被引用附件）
    fs.files.delete('C:/vault/未引用图.png')
    fs.stats.delete('C:/vault/未引用图.png')
    fs.files.set('C:/vault/改名图.png', 'png')
    fs.stats.set('C:/vault/改名图.png', { mtimeMs: 300, size: 3 })
    await service.refreshRenamedBatch([{ oldFsPath: 'C:/vault/未引用图.png', newFsPath: 'C:/vault/改名图.png' }])
    const hit = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '图'))
    expect(hit.items.map((i) => i.name).sort()).toEqual(['改名图.png', '配图.png'])
  })

  it('周期核验：外部增删（无事件漂移）由清单核验兜底；失败目录下不移除、清单标记不完整', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/sub/漂移.png': 'png',
      'C:/vault/外部删.txt': 'txt',
    })
    const { service, scan } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(3)
    // 外部新增（无事件）+ 外部删除（无事件）
    fs.files.set('C:/vault/漂入.pdf', 'pdf')
    fs.stats.set('C:/vault/漂入.pdf', { mtimeMs: 1, size: 1 })
    fs.files.delete('C:/vault/外部删.txt')
    fs.stats.delete('C:/vault/外部删.txt')
    await service.verifyNow()
    const info = service.maintenanceInfo().roots[0]!
    expect(info.catalogFileCount).toBe(3) // +漂入.pdf -外部删.txt
    expect(info.catalogComplete).toBe(true)
    // 子目录不可访问：其下文件不被移除；complete=false（部分就绪不冒充完整）
    scan.inaccessibleDirs.add('C:/vault/sub')
    await service.verifyNow()
    const partial = service.maintenanceInfo().roots[0]!
    expect(partial.catalogComplete).toBe(false)
    expect(candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '漂移')).total).toBe(1)
    expect(candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '')).updating).toBe(true)
  })

  it('代次守卫：取消（epoch 递增）后旧清单枚举不得发布', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n', 'C:/vault/旧图.png': 'png' })
    const { service, scan } = makeService(fs)
    // 挂起首轮枚举：listAllFiles 返回手动受控 promise
    let release!: (v: { files: string[]; failedDirs: string[] }) => void
    const original = scan.listAllFiles.bind(scan)
    scan.listAllFiles = async () => await new Promise((resolve) => { release = resolve }) as { files: string[]; failedDirs: string[] }
    const init = service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await vi.advanceTimersByTimeAsync(0) // 推进至 listAllFiles 挂起点
    scan.listAllFiles = original
    service.cancelMaintenance() // 旧枚举在途时取消
    release({ files: ['C:/vault/旧图.png'], failedDirs: [] })
    await init
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(0) // 旧枚举未发布
    // 重触发（排除重算同路径）后正常建立
    await service.setExcludePatterns([])
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
  })

  it('清单未就绪回退：构建中退回现有索引 Markdown/附件候选并明确 updating；部分结果不冒充完整空结果', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n\n![[被引图.png]]\n',
      'C:/vault/被引图.png': 'png',
      'C:/vault/未引图.png': 'png',
    })
    const { service, scan } = makeService(fs)
    let release!: (v: { files: string[]; failedDirs: string[] }) => void
    scan.listAllFiles = async () => await new Promise((resolve) => { release = resolve }) as { files: string[]; failedDirs: string[] }
    const init = service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await vi.advanceTimersByTimeAsync(0) // 推进：md 索引建完、清单挂起
    // 引用索引（md）已就绪、清单仍在构建：可用项继续候选 + updating 标注
    const during = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', ''))
    expect(during.updating).toBe(true)
    expect(during.items.map((i) => i.name).sort()).toEqual(['a.md', '被引图.png'])
    release({ files: [], failedDirs: [] })
    await init
  })

  it('分页与总量：offset 越过首屏继续取页，total 为命中总数', async () => {
    const files: Record<string, string> = { 'C:/vault/a.md': '# A\n' }
    for (let i = 0; i < 8; i++) {
      files[`C:/vault/分页图${i}.png`] = 'png'
    }
    const { service } = makeService(makeFs(files))
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const page1 = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '分页图', 0, 3))
    const page2 = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '分页图', 3, 3))
    const page3 = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '分页图', 6, 3))
    expect(page1.total).toBe(8)
    expect(page1.items).toHaveLength(3)
    expect(page2.items).toHaveLength(3)
    expect(page3.items).toHaveLength(2)
    const all = [...page1.items, ...page2.items, ...page3.items].map((i) => i.relPath)
    expect(new Set(all).size).toBe(8) // 无重复无遗漏
  })

  it('未保存编辑不冒充磁盘修改时间：applyUnsaved 后候选 mtime 仍为磁盘 stat', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n', 'C:/vault/b.md': '# B\n' })
    fs.stats.set('C:/vault/b.md', { mtimeMs: 4_000, size: 5 })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    service.applyUnsaved('C:/vault/b.md', 7, '# B 改\n')
    await vi.advanceTimersByTimeAsync(1_000)
    const hit = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', 'b.md'))
    expect(hit.items[0]!.mtimeMs).toBe(4_000) // 磁盘 mtime，未保存内容不参与
  })

  it('清单就绪与引用关系就绪分别标记：清单完成不改变 rename not-ready 语义', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n', 'C:/vault/x.png': 'png' })
    let release!: (v: { files: string[]; failedDirs: string[] }) => void
    const { service, scan } = makeService(fs)
    scan.readFileText = async () => await new Promise<string | null>(() => {}) // md 正文读取挂起 → 引用索引未就绪
    scan.listAllFiles = async () => await new Promise((resolve) => { release = resolve }) as { files: string[]; failedDirs: string[] }
    const init = service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await vi.advanceTimersByTimeAsync(0) // 推进至 listAllFiles 挂起点
    release({ files: ['C:/vault/a.md', 'C:/vault/x.png'], failedDirs: [] }) // 清单先行完成
    await vi.advanceTimersByTimeAsync(1_000)
    // 清单已发布（count=2）而引用关系未就绪：rename 候选仍 not-ready（不因名称枚举完成放行）
    expect(service.maintenanceInfo().roots[0]!.catalogFileCount).toBe(2)
    expect(service.renameCandidatesOf('C:/vault/a.md').status).toBe('not-ready')
    void init
  })
})

// ---- code-review 修复批次：F5/F6/F10/F14/F15（候选语法往返与分页、空查询
// 口径、核验零变化、扫描窗口直写） ----

describe('VaultIndexService：code-review 修复（F5/F6/F10/F14/F15）', () => {
  it('F5+F6：文件名含语法字符的候选写回即损坏——不入列表且不占页位（补位）', async () => {
    // POSIX 形态病态名在桩文件系统合法登记；mtime 控制排序（a|b.md 最前）
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/a|b.md': '# 病态\n',
      'C:/vault/c1.md': '# C1\n',
      'C:/vault/c2.md': '# C2\n',
    })
    fs.stats.set('C:/vault/a|b.md', { mtimeMs: 20_000, size: 5 })
    fs.stats.set('C:/vault/c1.md', { mtimeMs: 5_000, size: 4 })
    fs.stats.set('C:/vault/c2.md', { mtimeMs: 4_000, size: 4 })
    fs.stats.set('C:/vault/a.md', { mtimeMs: 3_000, size: 4 })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 病态占位补位：首页（limit 1）跳过 a|b.md 投递 c1.md
    const page1 = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '', 0, 1))
    expect(page1.items.map((i) => i.relPath)).toEqual(['c1.md'])
    // 续页 offset=1（已投递数）：投递 c2（旧实现的排名偏移会重复投递 c1）
    const page2 = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '', 1, 1))
    expect(page2.items.map((i) => i.relPath)).toEqual(['c2.md'])
    // 病态全局不可达：无论怎么翻页都选不到（候选侧静默排除，不产出损坏引用）
    const full = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '', 0, 50))
    expect(full.items.map((i) => i.relPath)).toEqual(['c1.md', 'c2.md', 'a.md'])
  })

  it('F6：尾部病态——items.length < limit 即穷尽信号（webview 终态判据的宿主侧语义）', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/c1.md': '# C1\n',
      'C:/vault/z|尾病.md': '# 病态\n',
    })
    fs.stats.set('C:/vault/c1.md', { mtimeMs: 5_000, size: 4 })
    fs.stats.set('C:/vault/z|尾病.md', { mtimeMs: 1_000, size: 4 })
    fs.stats.set('C:/vault/a.md', { mtimeMs: 3_000, size: 4 })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    const r = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '', 0, 3))
    expect(r.items).toHaveLength(2) // 3 < limit=3 的窗口内只投递 2 个（穷尽）
    expect(r.items.map((i) => i.relPath)).toEqual(['c1.md', 'a.md'])
  })

  it('F10：全符号查询（单 *）与评分侧同源判空——按空查询口径只列常用资源', async () => {
    const fs = makeFs({
      'C:/vault/a.md': '# A\n',
      'C:/vault/图.png': 'png',
      'C:/vault/cache.pyc': 'pyc',
    })
    fs.stats.set('C:/vault/图.png', { mtimeMs: 2_000, size: 3 })
    fs.stats.set('C:/vault/cache.pyc', { mtimeMs: 9_000, size: 99 })
    fs.stats.set('C:/vault/a.md', { mtimeMs: 1_000, size: 4 })
    const { service } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 单 `*`：prepare 的 normalized 为空（通配符剥除）——空查询口径只列
    // 常用资源（旧 trim 口径会把 other 类 cache.pyc 混入首位）
    const r = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '*'))
    expect(r.items.map((i) => i.relPath)).toEqual(['图.png', 'a.md'])
    expect(r.total).toBe(2)
  })

  it('F14：verifyNow 零变化不触发任何提交写盘（不为周期核验空转全模型序列化）', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n\n见 [[b]]。\n', 'C:/vault/b.md': '# B\n' })
    const { service, storage } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    await vi.advanceTimersByTimeAsync(2_000) // 初始快照/清单提交落定
    const writesBefore = storage.writes.length
    await service.verifyNow()
    await vi.advanceTimersByTimeAsync(2_000) // 若误排提交，防抖定时器在此落盘
    expect(storage.writes.length).toBe(writesBefore) // 零变化 → 零写入
    // 确有变化时行为不变：磁盘新增文件 → 清单 diff 非空 → 提交发生
    fs.files.set('C:/vault/新图.png', 'png')
    fs.stats.set('C:/vault/新图.png', { mtimeMs: 7_000, size: 3 })
    await service.verifyNow()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(storage.writes.length).toBeGreaterThan(writesBefore)
    expect(candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '新图')).items)
      .toHaveLength(1)
  })

  it('F15：清单枚举窗口内 verifyRoot 的直写转 pending 重放——不被完成时的整体覆盖吞掉', async () => {
    const fs = makeFs({ 'C:/vault/a.md': '# A\n', 'C:/vault/x.png': 'png' })
    const { service, scan } = makeService(fs)
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 受控挂起：setExcludePatterns 触发重扫（fullScan → scanCatalog），
    // scanCatalog 的逐文件 stat 挂在 gate 上（模拟大目录扫描窗口）
    const gate = makeGate4Test()
    const originalStat = scan.statFile.bind(scan)
    let armed = true
    scan.statFile = (async (p: string) => {
      if (armed && p.endsWith('a.md')) {
        armed = false
        await gate.promise
      }
      return originalStat(p)
    }) as typeof scan.statFile
    const reapply = service.setExcludePatterns(['**/.git/**', '**/node_modules/**'])
    await vi.advanceTimersByTimeAsync(0) // 推进至 scanCatalog 的 stat 挂起点
    // 窗口内：新文件落盘（无 watcher 事件），verifyRoot 直写通道到达
    //（verifyRoot 不检查 catalogScanning——F15 场景本体）
    fs.files.set('C:/vault/窗口直写.png', 'png')
    fs.stats.set('C:/vault/窗口直写.png', { mtimeMs: 8_000, size: 3 })
    await service.verifyNow()
    // 放行重扫：scanCatalog 收尾整体覆盖（旧枚举不含新文件）+ pending 重放
    gate.resolve()
    await reapply
    await vi.advanceTimersByTimeAsync(1_000)
    const r = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '窗口直写'))
    expect(r.items).toHaveLength(1) // 旧实现：直写被覆盖吞掉，候选查不到
    expect(r.items[0]!.relPath).toBe('窗口直写.png')
  })
})

/** 手动放行闸门（F15 用例） */
function makeGate4Test(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('VaultIndexService：F15 回归（CI s3 T02/#198 扫描窗口重放）', () => {
  it('扫描窗口内 watcher 事件经 pending 重放真正入清单且收敛（不死循环）', async () => {
    let notify: ((p: string | null) => void) | undefined
    const fs = makeFs({ 'C:/vault/a.md': '# A\n', 'C:/vault/x.png': 'png' })
    const scan = scanPortOf(fs)
    scan.watchRoot = (_r, onEvent) => { notify = onEvent; return () => {} }
    const service = new VaultIndexService(scan, storagePortOf(), { storageRoot: 'C:/store', isWindowsHost: IS_WIN })
    await service.initialize([{ fsPath: 'C:/vault', uri: 'file:///c%3A/vault' }])
    // 重扫：statFile 挂 gate 模拟大目录扫描窗口（catalogScanning=true 期间）
    const gate = makeGate4Test()
    const originalStat = scan.statFile.bind(scan)
    let armed = true
    // armed 目标选非 md（x.png）：fullScan 只 stat md，重扫的 scanCatalog 才
    // 会 stat 它——gate 精确挂在 catalogScanning=true 的窗口内
    scan.statFile = (async (p: string) => {
      if (armed && p.endsWith('x.png')) {
        armed = false
        await gate.promise
      }
      return originalStat(p)
    }) as typeof scan.statFile
    const reapply = service.setExcludePatterns(['**/.git/**', '**/node_modules/**'])
    await vi.advanceTimersByTimeAsync(50) // 链推进至 scanCatalog 挂 gate（scanning=true）
    // 窗口内注册去抖：到期必落在 scanCatalog 挂起中
    fs.files.set('C:/vault/事件图.png', 'png')
    fs.stats.set('C:/vault/事件图.png', { mtimeMs: 9_000, size: 3 })
    notify!('C:/vault/事件图.png')
    await vi.advanceTimersByTimeAsync(1_000) // 去抖到期 → pending（scanning=true）
    // 放行：整体覆盖 + pending 重放——若重放登记被 applyCatalogUpsert 的
    // F15 拦截回填 pending，重放循环永不收敛（reapply 永挂，用例超时红）
    gate.resolve()
    await reapply
    await vi.advanceTimersByTimeAsync(1_000)
    const r = candidatesOf(service.queryWikilinkFileCandidates('C:/vault/a.md', '事件图'))
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.relPath).toBe('事件图.png')
  })
})
