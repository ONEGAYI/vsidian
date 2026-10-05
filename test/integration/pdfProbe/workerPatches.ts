// #334（P3-02）worker/Blob 生命周期打点：在任何 PDF.js 代码运行前 patch
// 全局 Worker 与 URL.createObjectURL/revokeObjectURL，累计创建/终止/释放
// 计数。探针的「最后消费者释放后计数归零」断言读这组计数。
// 仅探针 bundle 使用；不进生产产物。
const stats = {
  workersCreated: 0,
  workersTerminated: 0,
  blobCreated: 0,
  blobRevoked: 0,
}
;(globalThis as Record<string, unknown>).__vsidianPdfWorkerStats = stats

const NativeWorker = globalThis.Worker
if (NativeWorker) {
  class CountingWorker extends NativeWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args)
      stats.workersCreated++
    }
    override terminate(): void {
      stats.workersTerminated++
      super.terminate()
    }
  }
  globalThis.Worker = CountingWorker as unknown as typeof Worker
}

const nativeCreate = URL.createObjectURL.bind(URL)
const nativeRevoke = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = ((obj: Blob | MediaSource) => {
  stats.blobCreated++
  return nativeCreate(obj)
}) as typeof URL.createObjectURL
URL.revokeObjectURL = ((url: string) => {
  stats.blobRevoked++
  nativeRevoke(url)
}) as typeof URL.revokeObjectURL

export {}
