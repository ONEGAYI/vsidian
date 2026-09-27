function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  return value
}

// 生命周期 = 一次 runSuites；不将缓存持久化到下一轮，源码变化必重建。
// 写入串行化；相同 outfile 必须使用同一配置，防止后写覆盖已在使用的产物。
export function createBuildBroker({ build, reuse = true }) {
  const cache = new Map(), outputs = new Map()
  let queue = Promise.resolve()
  return async options => {
    const start = performance.now()
    const key = JSON.stringify(stable(options))
    if (outputs.has(options.outfile) && outputs.get(options.outfile) !== key) throw new Error(`构建配置冲突: ${options.outfile}`)
    outputs.set(options.outfile, key)
    const cacheHit = reuse && cache.has(key)
    let pending = cacheHit ? cache.get(key) : undefined
    if (!pending) {
      pending = queue.then(async () => {
        const started = performance.now()
        await build(options)
        return performance.now() - started
      })
      queue = pending.catch(() => {})
      if (reuse) cache.set(key, pending)
    }
    const actualMs = await pending
    const durationMs = performance.now() - start
    return { cacheHit, durationMs, buildMs: cacheHit ? 0 : actualMs,
      waitMs: Math.max(0, durationMs - (cacheHit ? 0 : actualMs)) }
  }
}
