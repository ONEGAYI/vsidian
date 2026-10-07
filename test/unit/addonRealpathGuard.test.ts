// #354 T05 realpath 符号链接逃逸校验契约（V02 未验项收口）：宿主侧
// 资源授权前，登记路径 realpath 后必须仍在组件安装目录内——词法包含
//（addonPageRegistry 第一层）挡不住「安装目录内符号链接指向目录外」的
// 逃逸；本守卫是装载意图（addon.load 推送）前的第二层。
//
// 语义边界（票面 + V02 报告「未含 realpath/符号链接逃逸校验」）：
// - escape：路径 realpath 成功但落在安装目录 realpath 之外 → 拒绝装载；
// - missing：路径不存在（realpath 抛错）→ 放行——装载时 script-load-
//   failed 自然失败，不属于逃逸（攻击面不存在）；
// - 安装目录本身取 realpath（安装目录可能经 junction/symlink 挂载——
//   base 与 candidate 同取真实路径后判前缀包含）；
// - 结果缓存：同一路径只 resolve 一次（escape 判定不反复触发文件系统）。
import { describe, expect, it } from 'vitest'
import { createAddonRealpathGuard, type AddonRealpathPort, type AddonRealpathPlan } from '../../src/host/addons/addonRealpathGuard'

const WIN = process.platform === 'win32'
/** 路径分隔符归一（Windows 断言用反斜杠形态构造） */
const p = (...segments: string[]): string => segments.join(WIN ? '\\' : '/')

function makePort(mapping: Record<string, string>, missing: readonly string[] = []): AddonRealpathPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    realpath: async (fsPath: string) => {
      calls.push(fsPath)
      if (missing.includes(fsPath)) {
        throw Object.assign(new Error(`ENOENT: ${fsPath}`), { code: 'ENOENT' })
      }
      const real = mapping[fsPath]
      if (real === undefined) {
        // 未在映射中的路径：原样返回（真目录语义）
        return fsPath
      }
      return real
    },
  }
}

describe('realpath 符号链接逃逸校验（T05）', () => {
  const install = p('C:', 'ext', 'addon-demo-1.0.0')
  const plan = (overrides?: Partial<AddonRealpathPlan>): AddonRealpathPlan => ({
    addonId: 'demo.addon',
    installDir: install,
    fileFsPaths: [p(install, 'dist', 'page.js')],
    dirFsPaths: [p(install, 'dist', 'assets')],
    ...overrides,
  })

  it('词法包含但入口经符号链接指向安装目录外 → escape 拒绝', async () => {
    const outside = p('C:', 'outside')
    const port = makePort({
      // install/dist 是指向外部的符号链接（junction 同语义）
      [p(install, 'dist')]: outside,
      [p(install, 'dist', 'page.js')]: p(outside, 'page.js'),
    })
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan(plan())).toBe('escape')
  })

  it('资源子目录经符号链接逃逸 → escape 拒绝（文件本身词法在内也不放行）', async () => {
    const outside = p('C:', 'secret')
    const port = makePort({
      [p(install, 'dist', 'assets')]: outside,
    })
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan(plan())).toBe('escape')
  })

  it('路径不存在（realpath 抛 ENOENT）→ 放行（装载时自然失败，非逃逸）', async () => {
    const port = makePort({}, [p(install, 'dist', 'page.js')])
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan(plan())).toBe('ok')
  })

  it('安装目录本身经 junction 挂载：base 与 candidate 同取真实路径后判包含 → ok', async () => {
    const realInstall = p('C:', 'Users', 'me', '.vscode', 'extensions', 'addon-demo-1.0.0')
    const port = makePort({
      [install]: realInstall,
      [p(install, 'dist', 'page.js')]: p(realInstall, 'dist', 'page.js'),
      [p(install, 'dist', 'assets')]: p(realInstall, 'dist', 'assets'),
    })
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan(plan())).toBe('ok')
  })

  it('逃逸判定带组件与路径留痕（日志回调），且结果缓存不重复判', async () => {
    const outside = p('C:', 'outside')
    const port = makePort({
      [p(install, 'dist')]: outside,
      [p(install, 'dist', 'page.js')]: p(outside, 'page.js'),
    })
    const logged: Array<{ stage: string; addonId: string; detail: string }> = []
    const guard = createAddonRealpathGuard(port, (stage, addonId, detail) => logged.push({ stage, addonId, detail }))
    expect(await guard.verifyPlan(plan())).toBe('escape')
    expect(await guard.verifyPlan(plan())).toBe('escape')
    // realpath 每路径只调一次（缓存）；日志每次判定都留痕
    expect(port.calls.filter((call) => call === p(install, 'dist', 'page.js'))).toHaveLength(1)
    expect(logged.every((entry) => entry.stage === 'page-entry-escape-rejected' && entry.addonId === 'demo.addon')).toBe(true)
  })

  it('escape 目录登记表：资源根授权排除用（已判逃逸目录可查询）', async () => {
    const outside = p('C:', 'outside')
    const port = makePort({
      [p(install, 'dist', 'assets')]: outside,
    })
    const guard = createAddonRealpathGuard(port)
    await guard.verifyPlan(plan())
    expect(guard.isEscapedDir(p(install, 'dist', 'assets'))).toBe(true)
    expect(guard.isEscapedDir(p(install, 'dist'))).toBe(false)
  })

  it('多文件计划：任一文件逃逸整计划拒绝（不留半授权状态）', async () => {
    const outside = p('C:', 'outside')
    const port = makePort({
      [p(install, 'dist', 'evil.css')]: p(outside, 'evil.css'),
    })
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan(plan({
      fileFsPaths: [p(install, 'dist', 'page.js'), p(install, 'dist', 'evil.css')],
    }))).toBe('escape')
  })

  it('安装目录 realpath 失败（不可解析）→ escape 拒绝（保守：授权无锚不放行）', async () => {
    const port = makePort({}, [install])
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan(plan())).toBe('escape')
  })
})

describe('realpath 守卫并发与缓存', () => {
  it('并发验证同一路径只 resolve 一次（在途合并）', async () => {
    const install = p('C:', 'ext', 'addon-x')
    let resolveCount = 0
    const port: AddonRealpathPort = {
      realpath: async (fsPath: string) => {
        if (fsPath === install) {
          resolveCount++
          await new Promise((resolve) => setTimeout(resolve, 5))
          return install
        }
        return fsPath
      },
    }
    const guard = createAddonRealpathGuard(port)
    const plan = { addonId: 'x.a', installDir: install, fileFsPaths: [p(install, 'page.js')], dirFsPaths: [null] }
    const [a, b] = await Promise.all([guard.verifyPlan(plan), guard.verifyPlan(plan)])
    expect(a).toBe('ok')
    expect(b).toBe('ok')
    expect(resolveCount).toBe(1)
  })

  it('realpath 端口异常（非 ENOENT 的意外错误）不炸守卫：按 escape 保守拒绝', async () => {
    const install = p('C:', 'ext', 'addon-y')
    const port: AddonRealpathPort = {
      realpath: async () => {
        throw new Error('unexpected fs error')
      },
    }
    const guard = createAddonRealpathGuard(port)
    expect(await guard.verifyPlan({ addonId: 'y.a', installDir: install, fileFsPaths: [p(install, 'page.js')], dirFsPaths: [null] })).toBe('escape')
  })
})
