// 块 ID 撤回协调器注入桩单测（#380 T05 分层——本文件新增于 code-review
// 修复批次，覆盖 F1/F2/F7/F13 四项发现的回归钉）：
// - F1：per-origin 串行队列——异步入口（onHistoryApplied/cancelAccept/
//   disposeOrigin）与 registerPending 的 records 读写互斥，交错 undo/redo
//   不以陈旧快照覆盖写（丢记录/复活/双 withdraw）；
// - F2：withdraw 双守卫 TOCTOU——hasOtherReferences 读盘 await 窗口内目标
//   变更时，deleteRange 执行前以活文档复核，不按陈旧 offset 删错正文；
// - F7：disposeOrigin 对 unconfirmed 记录先核对来源权威文本——linked 已落
//   权威文本（回包晚于 dispose）的按 origin-closed 保留标记，结构上确无
//   块引用（parseWikilinkInner 全等）才收尾撤回；
// - F13：disposeAll 跨多来源全量收尾。
// 桩与被测协调器同构（openTarget 每次调用返回当时目标状态——活文档模拟；
// hasOtherReferences 首调支持受控挂起与副作用注入，模拟读盘窗口行为）。
import { describe, expect, it } from 'vitest'
import {
  WikilinkBlockIdCoordinator,
  type BlockIdCoordinatorPorts,
  type BlockIdTargetPort,
} from '../../src/host/wikilinkBlockIdCoordinator'

interface StubTarget {
  text: string
  version: number
}

/** 手动放行闸门 */
function makeGate(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 宏任务推进（微任务链全跑完：openTarget/hasOtherReferences 等桩内 await） */
const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

const ORIGIN = 'file:///src/a.md'
const TARGET = 'D:\\vault\\b.md'
const TARGET2 = 'D:\\vault\\c.md'
const MARKER_ABC = '\n\n^abc123'
const MARKER_DEF = '\n\n^def456'

function makeHarness() {
  const targets = new Map<string, StubTarget>()
  let originText: string | null = null
  const log: string[] = []
  const kept: Array<{ reason: string; id: string }> = []
  const deleteCalls: Array<{ fsPath: string; offset: number; length: number }> = []
  const insertCalls: Array<{ fsPath: string; offset: number; text: string }> = []
  let otherReferenceChecks = 0
  let stallGate: Promise<void> | null = null
  let onFirstOtherReferencesCheck: () => void = () => {}
  const ports: BlockIdCoordinatorPorts = {
    getOriginText: () => originText,
    openTarget: async (fsPath): Promise<BlockIdTargetPort | null> => {
      const t = targets.get(fsPath)
      if (!t) {
        return null
      }
      log.push(`open:${fsPath.split('\\').pop()}:${t.version}`)
      return {
        text: t.text,
        version: t.version,
        crlf: false,
        insertAt: async (offset, text) => {
          insertCalls.push({ fsPath, offset, text })
          t.text = t.text.slice(0, offset) + text + t.text.slice(offset)
          t.version += 1
          return true
        },
        deleteRange: async (offset, length) => {
          deleteCalls.push({ fsPath, offset, length })
          t.text = t.text.slice(0, offset) + t.text.slice(offset + length)
          t.version += 1
          return true
        },
      }
    },
    hasOtherReferences: async () => {
      otherReferenceChecks += 1
      if (otherReferenceChecks === 1) {
        onFirstOtherReferencesCheck()
        if (stallGate !== null) {
          await stallGate
        }
      }
      return false
    },
    notifyKept: (reason, id) => {
      kept.push({ reason, id })
    },
    notifyRebuildFailed: () => {},
  }
  return {
    coordinator: new WikilinkBlockIdCoordinator(ports),
    targets,
    log,
    kept,
    deleteCalls,
    insertCalls,
    setOriginText: (text: string | null): void => {
      originText = text
    },
    /** 首次 hasOtherReferences 读盘挂起（F1 交错窗口） */
    stallFirstOtherReferencesCheck: (gate: Promise<void>): void => {
      stallGate = gate
    },
    /** 首次 hasOtherReferences 读盘副作用（F2 窗口内目标变更） */
    onFirstOtherReferencesCheck: (fn: () => void): void => {
      onFirstOtherReferencesCheck = fn
    },
  }
}

/** 登记一条 pending 并等入队写落定 */
async function register(
  h: ReturnType<typeof makeHarness>,
  input: {
    reqId: number
    id: string
    offset: number
    versionAfterInsert: number
    targetFsPath?: string
    originDocUri?: string
    markerLf?: string
  },
): Promise<void> {
  h.coordinator.registerPending({
    reqId: input.reqId,
    originDocUri: input.originDocUri ?? ORIGIN,
    targetFsPath: input.targetFsPath ?? TARGET,
    id: input.id,
    markerLf: input.markerLf ?? `\n\n^${input.id}`,
    offset: input.offset,
    versionAfterInsert: input.versionAfterInsert,
    blockFirstLine: 1,
    targetCrlf: false,
  })
  await flush()
}

/** 登记一条 confirmed + everReferenced 的记录（undo 撤回路径就绪态） */
async function registerConfirmed(h: ReturnType<typeof makeHarness>): Promise<void> {
  h.targets.set(TARGET, { text: `para1${MARKER_ABC}`, version: 5 })
  h.setOriginText('[[b.md#^abc123]]')
  await register(h, { reqId: 1, id: 'abc123', offset: 5, versionAfterInsert: 5 })
  h.coordinator.confirmLinked(ORIGIN, 1)
  h.coordinator.observeOriginText(ORIGIN)
  h.setOriginText('')
}

describe('WikilinkBlockIdCoordinator code-review 修复（F1/F2/F7/F13）', () => {
  it('基线：undo 尽力撤回成功，redo 按记录块首行重建原 id', async () => {
    const h = makeHarness()
    await registerConfirmed(h)
    await h.coordinator.onHistoryApplied(ORIGIN, 'undo')
    expect(h.deleteCalls).toEqual([{ fsPath: TARGET, offset: 5, length: MARKER_ABC.length }])
    expect(h.targets.get(TARGET)).toEqual({ text: 'para1', version: 6 })
    h.setOriginText('[[b.md#^abc123]]')
    await h.coordinator.onHistoryApplied(ORIGIN, 'redo')
    expect(h.insertCalls).toEqual([{ fsPath: TARGET, offset: 5, text: MARKER_ABC }])
    expect(h.targets.get(TARGET)!.text).toBe(`para1${MARKER_ABC}`)
  })

  it('F1：同来源并发 onHistoryApplied 串行——前一操作未完成时后一操作零副作用', async () => {
    const h = makeHarness()
    await registerConfirmed(h)
    // 第一个 undo 挂在首次「已观测新使用」读盘处（模拟用户连按 undo 且
    // 读盘慢）：挂起窗口内发出第二个 undo
    const gate = makeGate()
    h.stallFirstOtherReferencesCheck(gate.promise)
    const p1 = h.coordinator.onHistoryApplied(ORIGIN, 'undo')
    await flush()
    const opensAtStall = h.log.length
    const deletesAtStall = h.deleteCalls.length
    const p2 = h.coordinator.onHistoryApplied(ORIGIN, 'undo')
    await flush()
    // 串行断言：p1 挂起期间 p2 不得产生任何目标访问或写入（旧实现下 p2
    // 以同一陈旧 records 快照并发进入 withdraw——双 withdraw 竞态起点）
    expect(h.log.length).toBe(opensAtStall)
    expect(h.deleteCalls.length).toBe(deletesAtStall)
    gate.resolve()
    await Promise.all([p1, p2])
    // 两个 undo 最终只撤一次（p2 重读 records 后不再满足撤回条件）
    expect(h.deleteCalls).toEqual([{ fsPath: TARGET, offset: 5, length: MARKER_ABC.length }])
    expect(h.targets.get(TARGET)!.text).toBe('para1')
  })

  it('F1：onHistoryApplied 读盘窗口内 registerPending 的新记录不被陈旧 set 覆盖丢失', async () => {
    const h = makeHarness()
    await registerConfirmed(h)
    h.targets.set(TARGET2, { text: `paraX${MARKER_DEF}`, version: 3 })
    const gate = makeGate()
    h.stallFirstOtherReferencesCheck(gate.promise)
    const p1 = h.coordinator.onHistoryApplied(ORIGIN, 'undo')
    await flush()
    // p1 挂起（读盘慢）期间来源发起新的补 ID 接受（另一目标文档）
    await register(h, {
      reqId: 2, id: 'def456', offset: 5, versionAfterInsert: 3, targetFsPath: TARGET2,
    })
    gate.resolve()
    await p1
    // r1 已撤回；r2 必须仍在场（disposeOrigin 的收尾撤回可观测到它）
    expect(h.deleteCalls).toEqual([{ fsPath: TARGET, offset: 5, length: MARKER_ABC.length }])
    h.setOriginText('')
    await h.coordinator.disposeOrigin(ORIGIN)
    expect(h.deleteCalls).toEqual([
      { fsPath: TARGET, offset: 5, length: MARKER_ABC.length },
      { fsPath: TARGET2, offset: 5, length: MARKER_DEF.length },
    ])
    expect(h.targets.get(TARGET2)!.text).toBe('paraX')
  })

  it('F2：读盘窗口内目标变更——deleteRange 前复核放弃并走保留分支，不删错正文', async () => {
    const h = makeHarness()
    await registerConfirmed(h)
    // 窗口内目标被外部修改：标记仍逐字在场但整体后移（offset 漂移 + 版本推进）
    h.onFirstOtherReferencesCheck(() => {
      h.targets.set(TARGET, { text: 'para1\nX\n\n^abc123', version: 6 })
    })
    await h.coordinator.onHistoryApplied(ORIGIN, 'undo')
    // 复核失败 → 保留（version-changed），零删除（旧实现按陈旧 offset 删除
    // 会吃掉 '\nX\n\n^abc1' 前缀损坏正文）
    expect(h.deleteCalls).toEqual([])
    expect(h.kept).toContainEqual({ reason: 'version-changed', id: 'abc123' })
    expect(h.targets.get(TARGET)).toEqual({ text: 'para1\nX\n\n^abc123', version: 6 })
  })

  it('F7：disposeOrigin 时 unconfirmed 记录的链接已落权威文本——保留标记不撤回', async () => {
    const h = makeHarness()
    h.targets.set(TARGET, { text: `para1${MARKER_ABC}`, version: 5 })
    h.setOriginText('see [[b.md#^abc123]] here')
    await register(h, { reqId: 1, id: 'abc123', offset: 5, versionAfterInsert: 5 })
    // linked 回包晚于 dispose：confirmed 仍 false，但权威文本已含结构引用
    await h.coordinator.disposeOrigin(ORIGIN)
    expect(h.deleteCalls).toEqual([])
    expect(h.targets.get(TARGET)).toEqual({ text: `para1${MARKER_ABC}`, version: 5 })
  })

  it('F7：权威文本仅以纯文本出现 #^id（非链接）——结构核对不算引用，照常收尾撤回', async () => {
    const h = makeHarness()
    h.targets.set(TARGET, { text: `para1${MARKER_ABC}`, version: 5 })
    h.setOriginText('plain mention #^abc123 not a link')
    await register(h, { reqId: 1, id: 'abc123', offset: 5, versionAfterInsert: 5 })
    await h.coordinator.disposeOrigin(ORIGIN)
    expect(h.deleteCalls).toEqual([{ fsPath: TARGET, offset: 5, length: MARKER_ABC.length }])
  })

  it('F13：disposeAll 跨来源全量收尾——各来源未落地且无引用的记录均撤回', async () => {
    const h = makeHarness()
    h.targets.set(TARGET, { text: `para1${MARKER_ABC}`, version: 5 })
    h.targets.set(TARGET2, { text: 'para2\n\n^zzz999', version: 7 })
    h.setOriginText('')
    await register(h, { reqId: 1, id: 'abc123', offset: 5, versionAfterInsert: 5 })
    await register(h, {
      reqId: 1, id: 'zzz999', offset: 5, versionAfterInsert: 7,
      targetFsPath: TARGET2, originDocUri: 'file:///src/other.md', markerLf: '\n\n^zzz999',
    })
    await h.coordinator.disposeAll()
    expect(h.deleteCalls.length).toBe(2)
    expect(h.targets.get(TARGET)!.text).toBe('para1')
    expect(h.targets.get(TARGET2)!.text).toBe('para2')
  })
})
