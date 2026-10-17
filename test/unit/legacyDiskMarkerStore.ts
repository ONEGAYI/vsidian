// #535 T08 迁移测试的共享磁盘 marker 夹具（review3/review5/review6/
// review7 同源，六审抽取为单一事实源、七审 R7-3 随生产 wiring 同步改写）：
// 与生产 wiring 同语义的状态文件族——按锁代次分居（`<prefix><profileId>.
// p<gen>.json`（pending）/ `.d<gen>.json`（done），O_EXCL 创建）、读取取
// max 代次（同代 d 优先）、损坏按无标记处理。writeMarker 需注入本窗口锁
// 句柄的 ownedGeneration（写入文件名携带代次；仅读侧使用可不注入）。
// 六审的「tmp 名唯一化」修复面随 tmp+rename 写入器一并退役：O_EXCL 文件
// 名天然按（身份,状态,代次）唯一，共享 tmp 竞态在结构上不存在（六审
// 竞态契约改由本夹具的并发分居语义承接，见 legacyThemeMigrationReview6Marker）。
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import {
  parseLegacyThemeMigrationMarker,
  type LegacyThemeMigrationMarker,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'

const STATE_FILE_PREFIX = 'legacy-theme-migration.'

/** 状态文件名（与 wiring 同一命名规则：前缀 + 身份 + p|d + 代次） */
export function legacyMarkerStateFileName(
  profileId: string,
  state: 'pending' | 'done',
  gen: number,
): string {
  return `${STATE_FILE_PREFIX}${profileId}.${state === 'done' ? 'd' : 'p'}${gen}.json`
}

/** 本身份状态文件的文件名匹配器（与 wiring 同一防御：UUID 仍做正则转义） */
function stateFilePatternOf(profileId: string): RegExp {
  return new RegExp(`^${profileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([pd])(\\d+)\\.json$`)
}

/**
 * 身份等待分级的磁盘信号（六审 R5-1 起、七审 R7 沿用）：目录内是否已有
 * 任一迁移状态文件（目录缺失 = 无——与生产 wiring 的 hasAnyMigrationState
 * 同语义；锁族文件不以 .json 结尾，不在匹配面）
 */
export async function legacyHasAnyMarkerState(dir: string): Promise<boolean> {
  try {
    const names = await fsp.readdir(dir)
    return names.some((name) => name.startsWith(STATE_FILE_PREFIX) && name.endsWith('.json'))
  } catch {
    return false
  }
}

/**
 * 目录内出现过的全部身份（按状态文件名提取 profileId 去重）——断言
 * 「让位/收敛窗不生成第二身份」时数身份数，不数文件数（一身份可有
 * p/d 两个代次文件）
 */
export async function legacyMarkerIdentitiesOnDisk(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const ids = new Set<string>()
  for (const name of names) {
    if (!name.startsWith(STATE_FILE_PREFIX)) continue
    const match = /^(.+)\.[pd]\d+\.json$/.exec(name.slice(STATE_FILE_PREFIX.length))
    if (match !== null) ids.add(match[1])
  }
  return [...ids]
}

/** 状态文件族的（身份, 状态, 代次）观测形态 */
export interface LegacyMarkerFileEntry {
  profileId: string
  state: 'pending' | 'done'
  gen: number
  name: string
}

/** 列出目录内全部状态文件条目（断言代次分居/清理面用） */
export async function legacyListMarkerFiles(dir: string): Promise<LegacyMarkerFileEntry[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const entries: LegacyMarkerFileEntry[] = []
  for (const name of names) {
    if (!name.startsWith(STATE_FILE_PREFIX)) continue
    const match = /^(.+)\.([pd])(\d+)\.json$/.exec(name.slice(STATE_FILE_PREFIX.length))
    if (match === null) continue
    entries.push({
      profileId: match[1],
      state: match[2] === 'd' ? 'done' : 'pending',
      gen: Number.parseInt(match[3], 10),
      name,
    })
  }
  return entries
}

export interface MarkerStoreOptions {
  /**
   * 状态文件代次来源：本窗口锁句柄的 getOwnedGeneration（writeMarker 的
   * 文件名携带代次，R7-3）。仅用 readMarker 的观测侧可不注入；未注入而
   * 调 writeMarker 会抛错（防止测试静默写成无代次旧形态）
   */
  ownedGeneration?: () => Promise<number>
}

export function makeDiskMarkerStore(
  dir: string,
  options: MarkerStoreOptions = {},
): Pick<LegacyThemeMigrationPorts, 'readMarker' | 'writeMarker'> {
  return {
    readMarker: async (profileId) => {
      let names: string[]
      try {
        names = await fsp.readdir(dir)
      } catch {
        return null
      }
      const pattern = stateFilePatternOf(profileId)
      let best: { state: 'pending' | 'done'; gen: number } | null = null
      for (const name of names) {
        if (!name.startsWith(STATE_FILE_PREFIX)) continue
        const match = pattern.exec(name.slice(STATE_FILE_PREFIX.length))
        if (match === null) continue
        const state = match[1] === 'd' ? 'done' : 'pending'
        const gen = Number.parseInt(match[2], 10)
        if (best === null || gen > best.gen || (gen === best.gen && state === 'done')) {
          best = { state, gen }
        }
      }
      if (best === null) return null
      try {
        return parseLegacyThemeMigrationMarker(JSON.parse(
          await fsp.readFile(path.join(dir, legacyMarkerStateFileName(profileId, best.state, best.gen)), 'utf8')))
      } catch {
        return null
      }
    },
    writeMarker: async (profileId, marker: LegacyThemeMigrationMarker) => {
      if (options.ownedGeneration === undefined) {
        throw new Error('[vsidian] 测试夹具 writeMarker 需注入 ownedGeneration（状态文件按代次分居，七审 R7-3）')
      }
      const gen = await options.ownedGeneration()
      const target = path.join(dir, legacyMarkerStateFileName(profileId, marker.state, gen))
      const handle = await fsp.open(target, 'wx')
      try {
        await handle.writeFile(JSON.stringify(marker), 'utf8')
      } finally {
        await handle.close()
      }
      // 收尾清理同身份更低代次（与生产 wiring 同语义）
      const pattern = stateFilePatternOf(profileId)
      try {
        const names = await fsp.readdir(dir)
        for (const name of names) {
          if (!name.startsWith(STATE_FILE_PREFIX)) continue
          const match = pattern.exec(name.slice(STATE_FILE_PREFIX.length))
          if (match === null) continue
          if (Number.parseInt(match[2], 10) < gen) {
            await fsp.rm(path.join(dir, name), { force: true }).catch(() => undefined)
          }
        }
      } catch {
        // 尽力而为
      }
    },
  }
}
