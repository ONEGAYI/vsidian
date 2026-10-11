import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'

/** Windows 的隐藏桌面共用 WinSta0 剪贴板；这些用例必须跨宿主互斥。 */
export const CLIPBOARD_CASE_NAMES: ReadonlySet<string> = new Set([
  '大纲复制五项经宿主剪贴板：端到端读写对拍（#69）',
  'live 代码块卡片：呈现态头部绘制、编辑态保留、零写回与设置开关（#79/#80/#81）',
  '阅读模式代码块卡片：卡片/行号/高亮/复制/折叠与观感契约（#84）',
  '统一右键菜单：全域接管、绘制层断言与剪贴板四项端到端（#183）',
  '块链接两项：统一菜单两态、自动补写可撤销与快捷键入口（#183，自 #162 迁移）',
  'P2-14 嵌入内部 Live：代码卡复制经端口落宿主剪贴板（#291）',
  '搜索定位恢复（#318）：显式命令矩阵——首次/重复/多匹配/CRLF/剪贴板恢复',
])

export async function withClipboardLock(
  run: () => Promise<void>, mutexName = 'Local\\VsidianIntegrationClipboard',
): Promise<void> {
  // Local 命名互斥量跨宿主、工作树共享，不需要管理员权限。持锁进程的
  // stdin 随调用方退出而关闭，ReadLine 收到 EOF 后也会释放互斥量。
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$mutex = [Threading.Mutex]::new($false, $env:VSIDIAN_TEST_CLIPBOARD_MUTEX)
$owned = $false
try {
  try { $null = $mutex.WaitOne(); $owned = $true }
  catch [Threading.AbandonedMutexException] { $owned = $true; throw }
  [Console]::WriteLine('CLIPBOARD_LOCK_ACQUIRED')
  $null = [Console]::ReadLine()
} finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
`
  const child = spawn(path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, env: { ...process.env, VSIDIAN_TEST_CLIPBOARD_MUTEX: mutexName } })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  let finish!: (code: number | null) => void
  const exited = new Promise<number | null>((resolve) => { finish = resolve })
  let acquired = false
  const ready = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    createInterface({ input: child.stdout }).once('line', (line) => {
      if (line !== 'CLIPBOARD_LOCK_ACQUIRED') {
        reject(new Error(`剪贴板互斥量响应异常：${line}`))
        return
      }
      acquired = true
      resolve()
    })
    child.once('close', (code) => {
      finish(code)
      if (!acquired) reject(new Error(`剪贴板互斥量获取失败（exit=${code}）：${stderr}`))
    })
  })
  try {
    await ready
    await run()
  } finally {
    child.stdin.end()
    const code = await exited
    if (acquired && code !== 0) throw new Error(`剪贴板互斥量释放失败（exit=${code}）：${stderr}`)
  }
}
