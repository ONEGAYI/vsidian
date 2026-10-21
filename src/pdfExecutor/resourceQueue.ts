// 执行端挂起资源队列（T08/#628）：远程导出会话中资源字节在远端——本机
// 资源服务的 /res 请求入队挂起，远端经 queryTask 轮询看到清单、读取字节
// 后经 provideResources 回填。纯逻辑（定时器真实跑），vitest 可单测。
//
// 语义：
// - 去重：同 key（doc + src）的并发请求共享一条队列项（页面「先探后装」
//   的双 GET 与 <img> 重试不重复登记）；
// - 超时：单项等待上限（缺省 45s）——远端断连/不响应时以 inaccessible
//   收口，不悬挂页面就绪谓词之外的通道（就绪谓词自身有 15s 上限，此处
//   超时是页面继续等待重试资源时的兜底）；
// - 任务终结路径 failAll/dispose：在途等待全部按给定原因收口（会话释放
//   时无悬挂 promise）。

import { pdfRemoteResourceKey, type PdfRemotePendingResource, type PdfRemoteResourceItem } from '../shared/pdfRemote'

export type DeferredResourceOutcome =
  | { ok: true; contentType: string; bytes: Uint8Array }
  | { ok: false; reason: 'not-found' | 'inaccessible' | 'blocked' }

interface QueueEntry {
  src: string
  doc: string | undefined
  waiters: Array<(outcome: DeferredResourceOutcome) => void>
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface RemoteResourceQueueOptions {
  /** 单项等待上限（毫秒；缺省 45s） */
  timeoutMs?: number
}

export class RemoteResourceQueue {
  private readonly entries = new Map<string, QueueEntry>()
  private readonly timeoutMs: number
  private disposed = false

  constructor(options: RemoteResourceQueueOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 45_000
  }

  /** 入队挂起（去重键共享；disposed 后直接 blocked——不再接收新等待） */
  request(src: string, doc: string | undefined): Promise<DeferredResourceOutcome> {
    if (this.disposed || src === '') {
      return Promise.resolve({ ok: false, reason: 'blocked' })
    }
    const key = pdfRemoteResourceKey(src, doc)
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      return new Promise<DeferredResourceOutcome>((resolve) => {
        existing.waiters.push(resolve)
      })
    }
    const entry: QueueEntry = { src, doc, waiters: [], timer: undefined }
    entry.timer = setTimeout(() => {
      this.entries.delete(key)
      for (const waiter of entry.waiters) waiter({ ok: false, reason: 'inaccessible' })
      entry.waiters = []
    }, this.timeoutMs)
    this.entries.set(key, entry)
    return new Promise<DeferredResourceOutcome>((resolve) => {
      entry.waiters.push(resolve)
    })
  }

  /** 远端回填（按 key 配对；未知 key 忽略——迟到供给不冒充） */
  provide(items: readonly PdfRemoteResourceItem[]): void {
    for (const item of items) {
      if (typeof item?.key !== 'string') continue
      const entry = this.entries.get(item.key)
      if (entry === undefined) continue
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      this.entries.delete(item.key)
      const outcome: DeferredResourceOutcome = item.ok === true && typeof item.base64 === 'string'
        ? { ok: true, contentType: typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream', bytes: Buffer.from(item.base64, 'base64') }
        : { ok: false, reason: item.reason === 'not-found' || item.reason === 'inaccessible' || item.reason === 'blocked' ? item.reason : 'inaccessible' }
      for (const waiter of entry.waiters) waiter(outcome)
      entry.waiters = []
    }
  }

  /** 当前挂起清单（queryTask 轮询数据面） */
  pendingList(): PdfRemotePendingResource[] {
    return [...this.entries.entries()].map(([key, entry]) => ({ key, src: entry.src, doc: entry.doc }))
  }

  /** 任务终结：在途等待全部收口（浏览器会话释放路径调用） */
  failAll(reason: DeferredResourceOutcome & { ok: false }): void {
    for (const [key, entry] of this.entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      for (const waiter of entry.waiters) waiter(reason)
      entry.waiters = []
      this.entries.delete(key)
    }
  }

  dispose(): void {
    this.disposed = true
    this.failAll({ ok: false, reason: 'inaccessible' })
  }
}
