// #535 T08 迁移测试的共享磁盘 marker 夹具（review3/review5/review6/
// review7/review8 同源）：生产 wiring 同语义状态文件族的测试侧装配——
// 命名/扫描/读取（降级回退）/写入（tmp+rename 原子发布）的单一实现自
// 七审 R7-3 起在 src/shared/legacyThemeMarkerFiles（本夹具与 wiring 共用
// 同一份实现，消除测试镜像与生产漂移）；八审 R8-3 起写入走原子发布、
// 读取降级回退。writeMarker 需注入本窗口锁句柄的 ownedGeneration（写入
// 文件名携带代次；仅读侧使用可不注入）。fs 注入面（fs 选项）供受控
// 故障测试（如发布 rename 失败不留最终名残缺文件）；默认走 node fsp。
import { promises as fsp } from 'node:fs'
import type { LegacyThemeMigrationPorts } from '../../src/shared/legacyThemeMigration'
import {
  legacyHasAnyMarkerFile,
  legacyListMarkerFileEntries,
  legacyMarkerIdentitiesInDir,
  legacyMarkerStateFileName,
  readLegacyMarkerFile,
  writeLegacyMarkerFile,
  type LegacyMarkerFileEntry,
  type LegacyMarkerFilesystem,
} from '../../src/shared/legacyThemeMarkerFiles'

export { legacyMarkerStateFileName }
export type { LegacyMarkerFileEntry }

/** node fsp 适配器（默认） */
const nodeMarkerFs: LegacyMarkerFilesystem = {
  readdir: (dir) => fsp.readdir(dir),
  readFile: (file) => fsp.readFile(file, 'utf8'),
  writeFile: (file, data) => fsp.writeFile(file, data, 'utf8'),
  rename: (from, to) => fsp.rename(from, to),
  rm: (file) => fsp.rm(file, { force: true }),
  exists: async (file) => {
    try {
      await fsp.stat(file)
      return true
    } catch {
      return false
    }
  },
}

/**
 * 身份等待分级的磁盘信号（与生产 wiring 同一实现）：目录内是否已有任
 * 一迁移状态文件（目录缺失 = 无；锁族文件不以 .json 结尾，不在匹配面）
 */
export async function legacyHasAnyMarkerState(dir: string): Promise<boolean> {
  return legacyHasAnyMarkerFile(nodeMarkerFs, dir)
}

/**
 * 目录内出现过的全部身份（按状态文件名提取 profileId 去重）——断言
 * 「等待/收敛窗不生成第二身份」时数身份数，不数文件数（一身份可有
 * pending/done 两个代次文件）
 */
export async function legacyMarkerIdentitiesOnDisk(dir: string): Promise<string[]> {
  return legacyMarkerIdentitiesInDir(nodeMarkerFs, dir)
}

/** 列出目录内全部状态文件条目（断言代次分居/清理面用） */
export async function legacyListMarkerFiles(dir: string): Promise<LegacyMarkerFileEntry[]> {
  return legacyListMarkerFileEntries(nodeMarkerFs, dir)
}

export interface MarkerStoreOptions {
  /**
   * 状态文件代次来源：本窗口锁句柄的 getOwnedGeneration（writeMarker 的
   * 文件名携带代次，R7-3）。仅用 readMarker 的观测侧可不注入；未注入而
   * 调 writeMarker 会抛错（防止测试静默写成无代次旧形态）
   */
  ownedGeneration?: () => Promise<number>
  /** fs 注入面（受控故障/调度测试用；默认 node fsp） */
  fs?: LegacyMarkerFilesystem
}

export function makeDiskMarkerStore(
  dir: string,
  options: MarkerStoreOptions = {},
): Pick<LegacyThemeMigrationPorts, 'readMarker' | 'writeMarker'> {
  const fs = options.fs ?? nodeMarkerFs
  return {
    readMarker: (profileId) => readLegacyMarkerFile(fs, dir, profileId),
    writeMarker: async (profileId, marker) => {
      if (options.ownedGeneration === undefined) {
        throw new Error('[vsidian] 测试夹具 writeMarker 需注入 ownedGeneration（状态文件按代次分居，七审 R7-3）')
      }
      await fsp.mkdir(dir, { recursive: true }).catch(() => undefined)
      await writeLegacyMarkerFile(fs, dir, profileId, marker, await options.ownedGeneration())
    },
  }
}
