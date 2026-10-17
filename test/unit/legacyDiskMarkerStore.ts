// #535 T08 迁移测试的共享磁盘 marker 夹具（review3/review5/review6 同源，
// 六审抽取为单一事实源）：与生产 wiring 同语义的 tmp+rename 原子写、损坏
// 按无标记处理。writeFs 注入面仅供六审受控调度测试（复现 CI 39026659483
// 的固定 tmp 名并发竞态）；默认走 node fsp。
// 六审（CI 39026659483）修复：tmp 名按写入唯一化——固定 `${target}.tmp`
// 在同 profile 并发 writeMarker 下让先 rename 方消费共享 tmp、后 rename 方
// ENOENT；每次写入带唯一片段后各自的 rename 只消费各自的 tmp。
import { promises as fsp } from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import {
  parseLegacyThemeMigrationMarker,
  type LegacyThemeMigrationMarker,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'

/** writeMarker 的两步 fs 原语注入面（受控调度门控用；默认 node fsp） */
export interface MarkerWriteFs {
  writeFile(target: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

const defaultWriteFs: MarkerWriteFs = {
  writeFile: (target, data) => fsp.writeFile(target, data, 'utf8'),
  rename: (from, to) => fsp.rename(from, to),
}

/** 按 profile 身份命名的状态文件路径（与 wiring 同一命名规则） */
export function legacyMarkerStatePath(dir: string, profileId: string): string {
  return path.join(dir, `legacy-theme-migration.${profileId}.state.json`)
}

export function makeDiskMarkerStore(
  dir: string,
  writeFs: MarkerWriteFs = defaultWriteFs,
): Pick<LegacyThemeMigrationPorts, 'readMarker' | 'writeMarker'> {
  return {
    readMarker: async (profileId) => {
      try {
        return parseLegacyThemeMigrationMarker(
          JSON.parse(await fsp.readFile(legacyMarkerStatePath(dir, profileId), 'utf8')))
      } catch {
        return null
      }
    },
    writeMarker: async (profileId, marker: LegacyThemeMigrationMarker) => {
      const target = legacyMarkerStatePath(dir, profileId)
      // 六审：tmp 名按写入唯一化（每次写入唯一片段）——各自的 rename 只
      // 消费各自的 tmp，并发写同一状态文件不再互抢
      const tmp = `${target}.${randomUUID()}.tmp`
      await writeFs.writeFile(tmp, JSON.stringify(marker))
      await writeFs.rename(tmp, target)
    },
  }
}
