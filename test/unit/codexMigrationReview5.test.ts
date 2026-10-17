// #535 T08 迁移 PR #581 五审 P2-C 契约测试（方案 B'：profile 身份 +
// 按 profileId 命名的磁盘权威状态）。红态场景（对四审尾实现跑红，
// t08-review5-p2c-red.log）：双 profile 反例——1.82.3 的 globalStorageUri
// 恒为默认 profile（跨 profile 共享磁盘目录），固定名状态文件让 profile
// A 的 done 短路 profile B，B 的迁移与引导被永久跳过。B' 修复：状态文件
// 名携带 profile 身份（globalState PROFILE 域持久化、锁内生成、双载体）。
//
// 绿态场景（任务口径）：
// - 正常双窗恰 1（同 profile 双窗首启，广播即时镜像）；
// - 延迟在等待窗内恰 1（广播延迟 &lt; 锁内身份等待窗 → 败者收敛到胜者
//   身份，不重复引导）；
// - 双 profile 各自独立完成迁移与引导（四审反例场景的修复验证）；
// - 有界边界的有界性（广播丢失 → 败者自生成多引导一次；后续激活从
//   db 读到已收敛身份，永不重复——**不写**「任意延迟下恰 1」断言，
//   平台不可满足，见 codexMigration 文件头声明）。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY,
  parseCodexMigrationMarker,
  runCodexThemeMigration,
  type CodexMigrationPorts,
} from '../../src/shared/codexMigration'
import {
  createCodexMigrationLock,
  type CodexMigrationLockHandle,
} from '../../src/shared/codexMigrationLock'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'
const LOCK_FILE = 'codex-theme-migration.lock'

/** 内存 memento（globalState 语义：update 完成后 get 可见新值——同窗口） */
function makeMemento(): { memento: SettingsStorage; store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  const memento: SettingsStorage = {
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
  return { memento, store }
}

/** 互斥「读-判-写」的内存合成（与 review3 测试同款：串行化路径语义等价合成） */
function mementoExclusiveStep(memento: SettingsStorage) {
  return async <R>(
    step: (overlay: unknown) => { patch: Record<string, unknown> | null; result: R },
  ): Promise<R> => {
    const { patch, result } = step(memento.get(SETTINGS_STORAGE_KEY))
    if (patch !== null) {
      const current = memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
      await memento.update(SETTINGS_STORAGE_KEY, { ...current, ...patch })
    }
    return result
  }
}

/**
 * 跨窗镜像 memento 对（模拟 1.82.3 storage 跨窗广播）：任一侧 update 在
 * delayMs 后镜像到对侧 store（最后写赢）。delayMs = 0 微任务级即时；
 * Infinity = 广播丢失（永不同步——评审方 P2-B 反例同款形态）
 */
function makeMirroredMementos(delayMs: number): {
  A: { memento: SettingsStorage; store: Map<string, unknown> }
  B: { memento: SettingsStorage; store: Map<string, unknown> }
} {
  const storeA = new Map<string, unknown>()
  const storeB = new Map<string, unknown>()
  const mirror = (peer: Map<string, unknown>, key: string, value: unknown) => {
    if (delayMs === Infinity) return
    const apply = () => {
      // 只镜像对侧尚未自行写入的键（对侧自生成身份时不被胜者镜像覆盖）
      if (!peer.has(key)) peer.set(key, value)
    }
    if (delayMs === 0) queueMicrotask(apply)
    else setTimeout(apply, delayMs)
  }
  const mementoOf = (store: Map<string, unknown>, peer: Map<string, unknown>): SettingsStorage => ({
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      store.set(key, value)
      mirror(peer, key, value)
      return Promise.resolve()
    },
  })
  return {
    A: { memento: mementoOf(storeA, storeB), store: storeA },
    B: { memento: mementoOf(storeB, storeA), store: storeB },
  }
}

// ---- 真实 fs（1.82.3 宿主形态：globalStorageUri 跨 profile 共享同一目录） ----

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-codex-review5-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

const nodeFs = {
  writeFileExclusive: async (target: string, data: string) => {
    const handle = await fsp.open(target, 'wx')
    try {
      await handle.writeFile(data, 'utf8')
    } finally {
      await handle.close()
    }
  },
  rename: (from: string, to: string) => fsp.rename(from, to),
  rm: async (target: string) => {
    await fsp.rm(target, { force: true })
  },
  statMtimeMs: async (target: string) => {
    try {
      return (await fsp.stat(target)).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  readFile: (target: string) => fsp.readFile(target, 'utf8'),
  listDirFiles: (dir: string) => fsp.readdir(dir),
}

/** B' wiring 同款：按身份命名分居的磁盘 marker 端口 */
function makeDiskMarkerStore(dir: string): Pick<CodexMigrationPorts, 'readMarker' | 'writeMarker'> {
  const statePath = (profileId: string) =>
    path.join(dir, `codex-theme-migration.${profileId}.state.json`)
  return {
    readMarker: async (profileId) => {
      try {
        return parseCodexMigrationMarker(JSON.parse(await fsp.readFile(statePath(profileId), 'utf8')))
      } catch {
        return null
      }
    },
    writeMarker: async (profileId, marker) => {
      const target = statePath(profileId)
      const tmp = `${target}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(marker), 'utf8')
      await fsp.rename(tmp, target)
    },
  }
}

function makeLock(dir: string, token: string): CodexMigrationLockHandle {
  return createCodexMigrationLock(nodeFs, path.join(dir, LOCK_FILE), { token, pid: 1000 })
}

/** 身份端口（独立键读写——本测试不预置身份，生成走锁内唯一入口） */
const profileIdPorts = (memento: SettingsStorage) => ({
  readProfileId: async () => {
    const direct = memento.get(PROFILE_ID_STATE_KEY)
    if (typeof direct === 'string' && direct !== '') return direct
    const overlay = memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    if (typeof overlay === 'object' && overlay !== null && !Array.isArray(overlay)) {
      const fromOverlay = overlay[CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]
      if (typeof fromOverlay === 'string' && fromOverlay !== '') return fromOverlay
    }
    return null
  },
  writeProfileId: async (id: string) => {
    await memento.update(PROFILE_ID_STATE_KEY, id)
  },
})

function windowPorts(
  memento: SettingsStorage,
  dir: string,
  token: string,
  onGuide: () => void,
): CodexMigrationPorts {
  const diskMarker = makeDiskMarkerStore(dir)
  return {
    readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: mementoExclusiveStep(memento),
    ...profileIdPorts(memento),
    ...diskMarker,
    extensionVersion: () => '1.2.3-test',
    requestGuide: onGuide,
    lock: makeLock(dir, token),
  }
}

const CODEX_OVERLAY = { [MERMAID_THEME_KEY]: 'codex' }

describe("B'（五审 P2-C）：双 profile 共享 globalStorage 磁盘目录", () => {
  it('profile A 完成迁移后 profile B 激活 → B 仍须完成自己的迁移与引导（不被 A 的完成状态短路）', async () => {
    const dir = await newDir()
    // 双 profile：各自独立 globalState（PROFILE 域隔离，storage 广播亦不互通）
    const profileA = makeMemento()
    const profileB = makeMemento()
    for (const p of [profileA, profileB]) {
      p.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    }
    const guides = { A: 0, B: 0 }
    // 无镜像（profile 域隔离）；身份等待窗注入小值让 B 快速自生成（同
    // profile 广播永不到达——等待窗只收窄同 profile 双窗竞态）
    const a = await runCodexThemeMigration(windowPorts(profileA.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 10, profileIdPollMs: 2 })
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(guides.A).toBe(1)

    // 四审反例（固定名状态文件让 B 读到 A 的 done）：B' 后按身份分居
    const b = await runCodexThemeMigration(windowPorts(profileB.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 10, profileIdPollMs: 2 })
    expect(b).toEqual({ action: 'migrate', guide: true })
    expect(guides.B).toBe(1) // B 的迁移引导不得被 A 的完成状态吞掉

    // 两身份各自落盘（共享目录、按身份分文件）
    const stateFiles = (await fsp.readdir(dir)).filter((n) => n.includes('.state.json'))
    expect(stateFiles.length).toBe(2)
    const idA = profileA.store.get(PROFILE_ID_STATE_KEY) as string
    const idB = profileB.store.get(PROFILE_ID_STATE_KEY) as string
    expect(idA).not.toBe(idB) // 双 profile 双身份
    expect((await makeDiskMarkerStore(dir).readMarker(idA))?.state).toBe('done')
    expect((await makeDiskMarkerStore(dir).readMarker(idB))?.state).toBe('done')
  })
})

describe("B'（五审 P2-C）：同 profile 双窗首启（身份生成竞态）", () => {
  it('正常双窗（广播即时镜像）→ 引导恰一次，败者收敛到胜者身份', async () => {
    const dir = await newDir()
    const { A, B } = makeMirroredMementos(0) // 即时广播
    A.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    B.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    const guides = { A: 0, B: 0 }
    const [a, b] = await Promise.all([
      runCodexThemeMigration(windowPorts(A.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 200, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
      runCodexThemeMigration(windowPorts(B.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 200, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
    ])
    const results = [`${a.action}:${a.guide}`, `${b.action}:${b.guide}`].sort()
    expect(results).toEqual(['migrate:true', 'none:false'])
    expect(guides.A + guides.B).toBe(1) // 恰一次
    // 双窗收敛到同一身份（镜像到达后败者读到胜者身份）
    const idA = A.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    const idB = B.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    expect(idA).toBe(idB)
    expect(idA).toBeTruthy()
  })

  it('广播延迟在身份等待窗内 → 败者等待窗内收敛到胜者身份，引导仍恰一次', async () => {
    const dir = await newDir()
    const { A, B } = makeMirroredMementos(50) // 广播延迟 50ms < 等待窗 300ms
    A.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    B.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    const guides = { A: 0, B: 0 }
    const [a, b] = await Promise.all([
      runCodexThemeMigration(windowPorts(A.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 300, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
      runCodexThemeMigration(windowPorts(B.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 300, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
    ])
    const results = [`${a.action}:${a.guide}`, `${b.action}:${b.guide}`].sort()
    expect(results).toEqual(['migrate:true', 'none:false'])
    expect(guides.A + guides.B).toBe(1)
    const idA = A.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    const idB = B.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    expect(idA).toBe(idB) // 延迟到达但仍在窗内 → 同一身份（磁盘状态不分裂）
  })

  it('有界边界（声明的极端形态）：广播丢失 → 败者自生成多引导一次；后续激活从 db 收敛，永不重复', async () => {
    const dir = await newDir()
    const { A, B } = makeMirroredMementos(Infinity) // 广播丢失（评审方缓存模拟同款）
    A.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    B.store.set(SETTINGS_STORAGE_KEY, CODEX_OVERLAY)
    const guides = { A: 0, B: 0 }
    // 顺序激活（A 完成后 B 首启）——B 的身份等待窗内广播永不到达
    const a = await runCodexThemeMigration(windowPorts(A.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 150, profileIdPollMs: 10 })
    expect(a).toEqual({ action: 'migrate', guide: true })
    const b = await runCodexThemeMigration(windowPorts(B.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 150, profileIdPollMs: 10 })
    // 有界边界如实呈现：B 自生成另一身份、多引导一次（总计 2，相对正常
    // 双窗恰 1 多出一次——平台通道固有缺口，见 codexMigration 文件头）
    expect(b).toEqual({ action: 'migrate', guide: true })
    expect(guides.A + guides.B).toBe(2)
    const idA = A.store.get(PROFILE_ID_STATE_KEY) as string
    const idB = B.store.get(PROFILE_ID_STATE_KEY) as string
    expect(idA).not.toBe(idB)

    // 「重启」B：新窗口 memento 从 db 初始化（B 的 store 快照）→ 读到已
    // 收敛身份与磁盘 done → 短路，引导计数不再增长（有界性的收敛面）
    const restarted = makeMemento()
    for (const [key, value] of B.store) restarted.store.set(key, value)
    const again = await runCodexThemeMigration(windowPorts(restarted.memento, dir, 'token-b2', () => { guides.B += 1 }))
    expect(again).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(2) // 永不重复
  })
})
