import { describe, expect, it } from 'vitest'
import { withClipboardLock } from '../integration/suite/clipboardLock'

describe.skipIf(process.platform !== 'win32')('Windows 真实剪贴板跨进程互斥', () => {
  it('并发请求的用例正文不得交错', async () => {
    const events: string[] = []
    await Promise.all(['A', 'B'].map((name) => withClipboardLock(async () => {
      events.push(`${name}:start`)
      await new Promise((resolve) => setTimeout(resolve, 200))
      events.push(`${name}:end`)
    })))
    expect(events).toEqual(events[0] === 'A:start'
      ? ['A:start', 'A:end', 'B:start', 'B:end']
      : ['B:start', 'B:end', 'A:start', 'A:end'])
  })

  it('用例抛错后释放互斥量，后续用例仍能执行', async () => {
    const failure = new Error('用例失败')
    await expect(withClipboardLock(async () => { throw failure })).rejects.toBe(failure)
    let executed = false
    await withClipboardLock(async () => { executed = true })
    expect(executed).toBe(true)
  })
})
