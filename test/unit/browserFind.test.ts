// T01（#621）浏览器发现单元测试：三通道优先级、显式路径覆盖与分态
//（deps 注入替身——V01 探针三通道语义的钉住面；不 spawn 真实进程）。
import { describe, expect, it } from 'vitest'
import {
  discoverBrowsers,
  resolveExportBrowser,
  type BrowserFindDeps,
} from '../../src/host/pdfExport/browserFind'

function makeDeps(overrides: Partial<BrowserFindDeps> & {
  registry?: Record<string, string>
  existing?: string[]
} = {}): BrowserFindDeps {
  const { registry = {}, existing = [], ...rest } = overrides
  return {
    execFileAsync: async (command: string, args: string[]) => {
      if (command === 'reg') {
        const key = args[1] ?? ''
        const hit = registry[key]
        return { stdout: hit ? `\r\n    (默认)    REG_SZ    ${hit}\r\n` : '' }
      }
      return { stdout: '' } // powershell 版本读取按空处理（null）
    },
    existsSync: (p: string) => existing.includes(p),
    platform: 'win32',
    pathEnv: rest.pathEnv,
    ...rest,
  }
}

describe('discoverBrowsers：三通道优先级', () => {
  it('注册表 App Paths 命中即用（chrome 与 edge 双发现）', async () => {
    const deps = makeDeps({
      registry: {
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe': 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe': 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      },
      existing: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
    })
    const found = await discoverBrowsers(deps)
    expect(found.map((b) => b.kind)).toEqual(['chrome', 'edge'])
    expect(found[0]!.via).toBe('app-paths-registry')
  })

  it('注册表缺失/失效时回落常见路径', async () => {
    const deps = makeDeps({
      existing: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
    })
    const found = await discoverBrowsers(deps)
    expect(found).toHaveLength(1)
    expect(found[0]!.kind).toBe('edge')
    expect(found[0]!.via).toBe('common-path')
  })

  it('常见路径也缺失时扫 PATH 环境变量', async () => {
    const deps = makeDeps({
      existing: ['C:\\Tools\\Chrome\\chrome.exe'],
      pathEnv: 'C:\\Windows;C:\\Tools\\Chrome',
    })
    const found = await discoverBrowsers(deps)
    expect(found[0]!.kind).toBe('chrome')
    expect(found[0]!.via).toBe('path-env')
    expect(found[0]!.executablePath).toBe('C:\\Tools\\Chrome\\chrome.exe')
  })

  it('三通道全空：返回空数组（未安装形态）', async () => {
    expect(await discoverBrowsers(makeDeps())).toEqual([])
  })

  it('非 Windows 平台：返回空数组（未验证通道不冒充发现）', async () => {
    const deps = makeDeps({
      platform: 'linux',
      existing: ['/usr/bin/google-chrome'],
    })
    expect(await discoverBrowsers(deps)).toEqual([])
  })
})

describe('resolveExportBrowser：显式路径覆盖', () => {
  it('显式路径存在即用、不回退自动发现', async () => {
    const deps = makeDeps({
      registry: {
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe': 'C:\\reg-chrome.exe',
      },
      existing: ['C:\\reg-chrome.exe', 'D:\\Custom\\Browser\\app.exe'],
    })
    const result = await resolveExportBrowser('D:\\Custom\\Browser\\app.exe', deps)
    expect(result.ok).toBe(true)
    expect(result.ok && result.browser.executablePath).toBe('D:\\Custom\\Browser\\app.exe')
    expect(result.ok && result.fromConfiguredPath).toBe(true)
  })

  it('显式路径不存在：configured-path-missing（区分配置错与未安装）', async () => {
    const deps = makeDeps({
      existing: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    })
    const result = await resolveExportBrowser('E:\\gone\\chrome.exe', deps)
    expect(result).toEqual({ ok: false, reason: 'configured-path-missing', configuredPath: 'E:\\gone\\chrome.exe' })
  })

  it('空/空白路径走自动发现：Chrome 优先于 Edge', async () => {
    const deps = makeDeps({
      registry: {
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe': 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe': 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      },
      existing: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
    })
    const byTrim = await resolveExportBrowser('  ', deps)
    expect(byTrim.ok && byTrim.browser.kind).toBe('chrome')
    const byUndefined = await resolveExportBrowser(undefined, deps)
    expect(byUndefined.ok && byUndefined.browser.kind).toBe('chrome')
  })

  it('自动发现仅有 Edge 时用 Edge；全无时 no-browser', async () => {
    const edgeOnly = await resolveExportBrowser(undefined, makeDeps({
      existing: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
    }))
    expect(edgeOnly.ok && edgeOnly.browser.kind).toBe('edge')
    const none = await resolveExportBrowser(undefined, makeDeps())
    expect(none).toEqual({ ok: false, reason: 'no-browser' })
  })
})
