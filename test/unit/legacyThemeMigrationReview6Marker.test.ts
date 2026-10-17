// #535 T08 六审（CI 修复）→ 七审 R7-3 改写：writeMarker 并发竞态契约。
// 六审的 tmp 名竞态（CI 39026659483：固定 `${target}.tmp` 双 writer 互抢
// ENOENT）随七审 R7-3 的写入器一并退役——状态文件按（身份,状态,锁代次）
// O_EXCL 分居创建，文件名天然唯一，共享 tmp 在结构上不存在。本测试钉
// 现行契约：不同代次 writer 并发写同一身份互不干扰（六审固定 tmp 名形
// 态下该交错必 ENOENT），读取按 max 代次取值（同代 d 优先），高代次写
// 入收尾清理更低代次文件（残留无害——滞后 owner 仍可能迟到提交低代次
// 文件，max 读取结构性忽略）。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  legacyListMarkerFiles,
  legacyMarkerStateFileName,
  makeDiskMarkerStore,
} from './legacyDiskMarkerStore'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review6-marker-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

describe('七审 R7-3（六审 CI tmp 竞态的结构性取代）：并发 writeMarker 的代次分居', () => {
  it('不同代次并发写同一身份互不干扰：读取取 max 代次（同代 d 优先），高代次收尾清理低代次', async () => {
    const dir = path.join(tmpRoot, 'case-1')
    await fsp.mkdir(dir, { recursive: true })
    const profileId = 'race-profile'
    const pending = { state: 'pending' as const, version: '1.2.3-test' }
    const done = { state: 'done' as const, version: '1.2.3-test' }
    const storeGen1 = makeDiskMarkerStore(dir, { ownedGeneration: async () => 1 })
    const storeGen2 = makeDiskMarkerStore(dir, { ownedGeneration: async () => 2 })

    // 并发交错（真 fs，无门控）：文件名按（身份,状态,代次）唯一，任意
    // 交错安全——六审固定 tmp 名形态下，gen1 与 gen2 共享 tmp 互抢，
    // 后 rename 方必 ENOENT；代次分居后双双成功
    await Promise.all([
      storeGen1.writeMarker(profileId, pending),
      storeGen2.writeMarker(profileId, done),
    ])
    // 读取取 max 代次：gen2 的 done 胜出（gen1 的 pending 沦为低代次残留）
    expect(await storeGen1.readMarker(profileId)).toEqual(done)

    // 确定性序列钉清理面：gen2 的收尾清理 gen1 的 pending；同代 d 在场
    // 时读取 d 优先（防御序——生产序列 p<g> 先于 d<g> 且 d<g> 收尾清
    // p<g>，同代并存只见于滞后 owner 的迟到 p<g> 补提交）
    const names = (await legacyListMarkerFiles(dir)).map((entry) => entry.name)
    expect(names).toContain(legacyMarkerStateFileName(profileId, 'done', 2))
    expect(names).not.toContain(legacyMarkerStateFileName(profileId, 'pending', 1))
    await fsp.writeFile(
      path.join(dir, legacyMarkerStateFileName(profileId, 'pending', 2)),
      JSON.stringify(pending),
      'utf8',
    )
    expect(await storeGen1.readMarker(profileId)).toEqual(done)
    // 目录内不出现任何 tmp 残留（O_EXCL 写入器无 tmp 形态）
    expect((await fsp.readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })
})
