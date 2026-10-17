// #535 T08 六审（CI 修复）：writeMarker 固定 tmp 名并发竞态的确定性调度
// 测试。CI run 39026659483 unit job（legacyThemeMigrationReview5「正常双窗
// 即时镜像」用例）在 Linux 上 1 例 ENOENT：双窗收敛到同一 profileId 后并
// 发调 writeMarker，夹具的固定 tmp 名 `${target}.tmp` 让后 rename 的一方
// 找不到 tmp（A rename 消费共享 tmp → B rename ENOENT）。本测试用门控 fs
// 把该交错确定化为 B.writeFile → A.writeFile → A.rename → B.rename：
// 对六审前实现跑红（out/test/t08-review6-marker-red.log，EXIT=1），tmp
// 唯一化（每次写入唯一片段）后绿。生产 wiring 的 tmp 带 PID（跨进程不同
// 名）但同进程多次写仍共享——一并唯一化作防御纵深（锁协议修复另见
// legacyThemeMigrationReview6Lock.test.ts；本测试只钉 tmp 竞态本身）。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { legacyMarkerStatePath, makeDiskMarkerStore, type MarkerWriteFs } from './legacyDiskMarkerStore'
import { LockFsGate, runGated, type LockFsLike } from './legacyLockTestGate'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review6-marker-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

describe('六审（CI 39026659483）：并发 writeMarker 的 tmp 名竞态', () => {
  it('受控交错 B.writeFile → A 完整写入 → B.rename：双写均成功，终值为合法 marker JSON 且无 tmp 残留', async () => {
    const dir = path.join(tmpRoot, 'case-1')
    await fsp.mkdir(dir, { recursive: true })
    const profileId = 'race-profile'
    const marker = { state: 'pending' as const, version: '1.2.3-test' }
    const gate = new LockFsGate()
    const gatedWriteFs = gate.wrap({
      writeFile: (target: string, data: string) => fsp.writeFile(target, data, 'utf8'),
      rename: (from: string, to: string) => fsp.rename(from, to),
    } as unknown as LockFsLike) as unknown as MarkerWriteFs
    // B：门控端口（每个原语完成后挂起）；A：同 profile 的另一 writer（直连 fs）
    const storeB = makeDiskMarkerStore(dir, gatedWriteFs)
    const storeA = makeDiskMarkerStore(dir)
    let injected = false
    const bRun = runGated(
      gate,
      () => storeB.writeMarker(profileId, marker),
      async () => {
        if (injected) return
        injected = true
        // B 的 writeFile(共享 tmp) 已完成、rename 未发：A 以同一 profileId
        // 完整写一遍（固定 tmp 名下 A 的 writeFile 覆盖同一 tmp、A 的
        // rename 把它消费掉）——随后放行 B 的 rename
        await storeA.writeMarker(profileId, marker)
      },
    )
    // 绿态：tmp 按写入唯一化后 B 仍能 rename 自己的 tmp；红态：ENOENT 上抛
    await expect(bRun).resolves.toBeUndefined()
    // 终值是合法 marker JSON（两 writer 内容一致，最后 rename 者生效）
    expect(JSON.parse(await fsp.readFile(legacyMarkerStatePath(dir, profileId), 'utf8')))
      .toEqual(marker)
    // rename 后无共享 tmp 残留
    const leftovers = (await fsp.readdir(dir)).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})
