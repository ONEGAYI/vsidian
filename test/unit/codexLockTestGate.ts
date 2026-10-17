// PR #581 四审 P2-D：锁协议受控调度门——把被观测方（party）的每一次
// fs 原语调用变成可注入的检查点（原语完成后、返回给调用方之前挂起），
// 导演在检查点处注入第三方动作。这是评审方「rename→restore 窗口进入第
// 三认领者」手法的结构化等价：**任何**原语边界都是第三方入场点，协议
// 必须在每个边界上安全，而不是只在评审方恰好插桩的那一个窗口安全。
//
// 驱动方式为回调订阅（非 promise 竞速）：同一 gate 可被多个 runGated
// 阶段顺序复用（如「先门控认领、再门控释放」），不留未消费的等待者。
import type { CodexLockFilesystem } from '../../src/shared/codexMigrationLock'

/** 检查点：一次已完成的 fs 原语（op 为方法名），release() 放行挂起方 */
export interface GateCheckpoint {
  op: string
  release(): void
}

/**
 * 端口形态：CodexLockFilesystem 并上旧协议原语（link）——红态（三审
 * 实现）与绿态（代次锁）共用同一测试体与同一调度脚本
 */
export type LockFsLike = CodexLockFilesystem & {
  link?(from: string, to: string): Promise<void>
}

export class LockFsGate {
  private queued: GateCheckpoint[] = []
  private handler: ((cp: GateCheckpoint) => void) | null = null

  /** 原语完成后的检查点：挂起直到导演放行 */
  private check(op: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const cp: GateCheckpoint = { op, release: resolve }
      if (this.handler !== null) this.handler(cp)
      else this.queued.push(cp)
    })
  }

  /** 导演：订阅检查点（替换前一个订阅者；排队中的检查点即刻转交） */
  onCheckpoint(handler: (cp: GateCheckpoint) => void): void {
    this.handler = handler
    while (this.queued.length > 0 && this.handler !== null) {
      const cp = this.queued.shift()
      if (cp) this.handler(cp)
    }
  }

  /** 包装端口：每个方法完成后过检查点（抛错的原语不过——直接上抛） */
  wrap(fs: LockFsLike): LockFsLike {
    const gate = this
    const source = fs as unknown as Record<string, unknown>
    const wrapped: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
      const fn = source[key] as (...args: unknown[]) => Promise<unknown>
      wrapped[key] = async (...args: unknown[]): Promise<unknown> => {
        const value = await fn(...args)
        await gate.check(key)
        return value
      }
    }
    return wrapped as unknown as LockFsLike
  }
}

/**
 * 导演循环：运行 party（其端口经 gate 包装，每个原语完成后挂起）；每个
 * 检查点处先执行 interject（第三方动作，用未经门控的端口，不受挂起影
 * 响），再放行。party 落定（含拒绝）后停止并返回/上抛其结果；interject
 * 抛出的断言错误在收尾时上抛。
 */
export async function runGated<T>(
  gate: LockFsGate,
  party: () => Promise<T>,
  interject: (checkpointIndex: number, op: string) => Promise<void>,
): Promise<T> {
  let settle: (() => void) | undefined
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const result = party()
  void result.then(() => settle?.(), () => settle?.())

  const queue: GateCheckpoint[] = []
  let processing = false
  let index = 0
  let interjectError: { error: unknown } | undefined
  const pump = async (): Promise<void> => {
    if (processing) return
    processing = true
    try {
      while (queue.length > 0) {
        const cp = queue.shift()
        if (!cp) break
        index += 1
        try {
          await interject(index, cp.op)
        } catch (error) {
          interjectError ??= { error }
          cp.release()
          return
        }
        cp.release()
      }
    } finally {
      processing = false
    }
  }
  gate.onCheckpoint((cp) => {
    queue.push(cp)
    void pump().catch((error: unknown) => {
      interjectError ??= { error }
    })
  })
  await settled
  gate.onCheckpoint(() => undefined) // 退订：后续（不应存在的）检查点直接放行
  if (interjectError !== undefined) throw interjectError.error
  return result
}
