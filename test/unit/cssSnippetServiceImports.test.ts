// CSS 片段宿主服务依赖导入契约（#129）：@import 子目录依赖的变更归因
// （子级事件只重载受影响入口、无关变更静默）、入口级缓存击穿版本
// （?v= 语义对 import 链成立的最小面——URI 随依赖变更而变）、越界与符号
// 链接逃逸拒绝（清单排除 + 拒绝态变化回报 + 修复恢复）、共享依赖入口
// 隔离（关一入口不扰动另一入口的装载 URI）。存储/文件系统均为注入假件。
import { describe, it, expect } from 'vitest'
import { CssSnippetService } from '../../src/host/cssSnippetService'
import type { CssSnippetFsPort, CssSnippetStorage } from '../../src/host/cssSnippetService'
import { normalizeSnippetPath } from '../../src/shared/cssSnippetImports'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeStorage(): CssSnippetStorage {
  const store = new Map<string, unknown>()
  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: async (key, value) => {
      store.set(key, value)
    },
  }
}

/** 带文件内容的假文件系统：files 键为正斜杠归一形态；watcher 事件按路径派发 */
interface FakeDepFs extends CssSnippetFsPort {
  files: Map<string, string>
  realpaths: Map<string, string>
  listing: string[] | null
  scans: number
  fire(path: string | null): void
}

function makeFs(initialFiles: Record<string, string>, listing: string[]): FakeDepFs {
  const files = new Map(
    Object.entries(initialFiles).map(([k, v]) => [normalizeSnippetPath(k), v]),
  )
  const realpaths = new Map<string, string>()
  let notify: (changedPath: string | null) => void = () => {}
  const fs: FakeDepFs = {
    files,
    realpaths,
    listing,
    scans: 0,
    fire: (path) => notify(path),
    listCssFiles: async () => {
      fs.scans += 1
      return fs.listing
    },
    watchDirectory: (_dir, onEvent) => {
      notify = onEvent
      return () => {
        notify = () => {}
      }
    },
    readFileText: async (p) => files.get(normalizeSnippetPath(p)) ?? null,
    realpath: async (p) => {
      const key = normalizeSnippetPath(p)
      return realpaths.get(key) ?? key
    },
  }
  return fs
}

function writeFile(fs: FakeDepFs, path: string, text: string): void {
  fs.files.set(normalizeSnippetPath(path), text)
}

/** 常用布局：main-a/main-b 共享 sub/dep.css，main-a 另引 sub2/nested.css */
const SHARED_LAYOUT = {
  'D:/snips/main-a.css': '@import "sub/dep.css";\n@import "sub2/nested.css";',
  'D:/snips/main-b.css': '@import "sub/dep.css";',
  'D:/snips/sub/dep.css': '.dep{color:red}',
  'D:/snips/sub2/nested.css': '.nested{color:blue}',
}

function linkMap(svc: CssSnippetService): Record<string, number> {
  return Object.fromEntries(svc.getLinkItems().map((item) => [item.name, item.v]))
}

describe('依赖归因：子级文件变更只重载受影响入口', () => {
  it('共享依赖变更：两个入口的 v 都推进；结构版本不动、reason=dep', async () => {
    const fs = makeFs(SHARED_LAYOUT, ['main-a.css', 'main-b.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main-a.css', true)
    await svc.setEnabled('main-b.css', true)
    const before = linkMap(svc)
    const versionBefore = svc.getState().version
    const reasons: string[] = []
    svc.onChange((_s, reason) => reasons.push(reason))

    fs.fire('D:\\snips\\sub\\dep.css')
    await sleep(30)

    const after = linkMap(svc)
    expect(after['main-a.css']).toBeGreaterThan(before['main-a.css'])
    expect(after['main-b.css']).toBeGreaterThan(before['main-b.css'])
    expect(svc.getState().version).toBe(versionBefore) // 列表结构未动
    expect(fs.scans).toBe(1) // 纯子级事件不触发重扫
    expect(reasons).toEqual(['dep'])
  })

  it('入口专属依赖变更：只推进依赖它的入口；另一入口 v 不动（?v= 不变即不重取）', async () => {
    const fs = makeFs(SHARED_LAYOUT, ['main-a.css', 'main-b.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main-a.css', true)
    await svc.setEnabled('main-b.css', true)
    const before = linkMap(svc)

    fs.fire('D:/snips/sub2/nested.css')
    await sleep(30)

    const after = linkMap(svc)
    expect(after['main-a.css']).toBeGreaterThan(before['main-a.css'])
    expect(after['main-b.css']).toBe(before['main-b.css'])
  })

  it('无入口依赖的子目录文件变更：完全静默（不通知、不重扫、版本全不动）', async () => {
    const fs = makeFs(SHARED_LAYOUT, ['main-a.css', 'main-b.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main-a.css', true)
    const before = linkMap(svc)
    const versionBefore = svc.getState().version
    const events: string[] = []
    svc.onChange((_s, reason) => events.push(reason))

    fs.fire('D:/snips/orphan/other.css')
    await sleep(30)

    expect(events).toEqual([])
    expect(linkMap(svc)).toEqual(before)
    expect(svc.getState().version).toBe(versionBefore)
    expect(fs.scans).toBe(1)
  })

  it('缺失依赖后来创建：归因集含缺失目标，创建事件触发入口重载', async () => {
    const fs = makeFs(
      { 'D:/snips/main.css': '@import "sub/missing.css";\n.a{color:red}' },
      ['main.css'],
    )
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main.css', true)
    const before = linkMap(svc)

    writeFile(fs, 'D:/snips/sub/missing.css', '.late{color:green}')
    fs.fire('D:/snips/sub/missing.css')
    await sleep(30)

    expect(linkMap(svc)['main.css']).toBeGreaterThan(before['main.css'])
  })

  it('入口文件编辑（第一层事件）：权威重扫 + 归因拍推进该入口与依赖它的入口', async () => {
    // main-b @import main-a（第一层文件同时也是依赖）
    const fs = makeFs(
      {
        'D:/snips/main-a.css': '.a{color:red}',
        'D:/snips/main-b.css': '@import "main-a.css";',
      },
      ['main-a.css', 'main-b.css'],
    )
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main-a.css', true)
    await svc.setEnabled('main-b.css', true)
    const before = linkMap(svc)

    writeFile(fs, 'D:/snips/main-a.css', '.a{color:green}')
    fs.fire('D:/snips/main-a.css')
    await sleep(30)

    expect(fs.scans).toBe(2) // 第一层事件走权威重扫
    const after = linkMap(svc)
    expect(after['main-a.css']).toBeGreaterThan(before['main-a.css'])
    expect(after['main-b.css']).toBeGreaterThan(before['main-b.css']) // 依赖 main-a
  })
})

describe('越界与符号链接逃逸拒绝', () => {
  it('词法越界：清单排除、rejections 暴露、回调按拒绝态变化只触发一次、修复后恢复', async () => {
    const fs = makeFs(
      {
        'D:/snips/bad.css': '@import "../outside.css";\n.a{color:red}',
        'D:/snips/good.css': '.g{color:red}',
      },
      ['bad.css', 'good.css'],
    )
    const rejections: Array<[string, string, string]> = []
    const svc = new CssSnippetService(makeStorage(), fs, 'k', {
      debounceMs: 1,
      onEntryRejected: (name, reason, path) => rejections.push([name, reason, path]),
    })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('bad.css', true)
    await svc.setEnabled('good.css', true)

    expect(svc.getLinkItems().map((i) => i.name)).toEqual(['good.css'])
    expect(svc.getState().rejections['bad.css']).toEqual({
      reason: 'path-escape',
      path: 'D:/outside.css',
    })
    expect(rejections).toEqual([['bad.css', 'path-escape', 'D:/outside.css']])

    // 重扫不重复打扰（拒绝态未变化）
    await svc.refresh()
    expect(rejections).toHaveLength(1)

    // 修复（去掉逃逸导入）→ 拒绝清除、条目回清单
    writeFile(fs, 'D:/snips/bad.css', '.a{color:green}')
    fs.fire('D:/snips/bad.css')
    await sleep(30)
    expect(svc.getState().rejections).toEqual({})
    expect(svc.getLinkItems().map((i) => i.name)).toEqual(['bad.css', 'good.css'])
  })

  it('符号链接逃逸（入口与导入目标 realpath 落在目录外）：拒绝并回报路径', async () => {
    const fs = makeFs(
      {
        'D:/snips/link.css': '.l{color:red}',
        'D:/snips/entry.css': '@import "sub/dep.css";',
        'D:/snips/sub/dep.css': '.d{color:red}',
      },
      ['link.css', 'entry.css'],
    )
    fs.realpaths.set('D:/snips/link.css', 'E:/evil/theme.css')
    fs.realpaths.set('D:/snips/sub/dep.css', 'E:/evil/dep.css')
    const rejections: Array<[string, string, string]> = []
    const svc = new CssSnippetService(makeStorage(), fs, 'k', {
      debounceMs: 1,
      onEntryRejected: (name, reason, path) => rejections.push([name, reason, path]),
    })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('link.css', true)
    await svc.setEnabled('entry.css', true)
    expect(svc.getLinkItems()).toEqual([])
    expect(rejections).toContainEqual(['link.css', 'symlink-escape', 'E:/evil/theme.css'])
    expect(rejections).toContainEqual(['entry.css', 'symlink-escape', 'E:/evil/dep.css'])
  })

  it('资产 url() 越界同样拒绝；http/data 资产不受影响', async () => {
    const fs = makeFs(
      {
        'D:/snips/asset.css': '.a{background:url("../../out.png")}',
        'D:/snips/online.css': '.b{background:url(https://x/f.woff2)}',
      },
      ['asset.css', 'online.css'],
    )
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('asset.css', true)
    await svc.setEnabled('online.css', true)
    expect(svc.getState().rejections['asset.css']?.reason).toBe('path-escape')
    expect(svc.getState().rejections['online.css']).toBeUndefined()
    expect(svc.getLinkItems().map((i) => i.name)).toEqual(['online.css'])
  })

  it('停用被拒条目：清除拒绝面（设置页不再显示陈旧拒绝）', async () => {
    const fs = makeFs({ 'D:/snips/bad.css': '@import "../x.css";' }, ['bad.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('bad.css', true)
    expect(svc.getState().rejections['bad.css']).toBeDefined()
    await svc.setEnabled('bad.css', false)
    expect(svc.getState().rejections).toEqual({})
  })

  it('循环导入（a↔b）：分析有界完成，条目正常入清单', async () => {
    const fs = makeFs(
      {
        'D:/snips/cyc.css': '@import "sub/back.css";\n.a{color:red}',
        'D:/snips/sub/back.css': '@import "../cyc.css";\n.b{color:blue}',
      },
      ['cyc.css'],
    )
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('cyc.css', true)
    expect(svc.getLinkItems().map((i) => i.name)).toEqual(['cyc.css'])
    expect(svc.getState().rejections).toEqual({})
    // 循环内任一文件变更都归因到入口
    const before = linkMap(svc)
    fs.fire('D:/snips/sub/back.css')
    await sleep(30)
    expect(linkMap(svc)['cyc.css']).toBeGreaterThan(before['cyc.css'])
  })
})

describe('入口级版本与共享依赖隔离', () => {
  it('关闭一入口不扰动另一入口的装载 URI（v 不变）——撤下整套样式、共享者无感', async () => {
    const fs = makeFs(SHARED_LAYOUT, ['main-a.css', 'main-b.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main-a.css', true)
    await svc.setEnabled('main-b.css', true)
    const bBefore = linkMap(svc)['main-b.css']

    await svc.setEnabled('main-a.css', false)
    const items = svc.getLinkItems()
    expect(items.map((i) => i.name)).toEqual(['main-b.css'])
    expect(items[0].v).toBe(bBefore) // 结构版本虽推进，入口 v 稳定 → URI 不变
  })

  it('启用即获得入口 v（?v= 参数随启用产生）；重扫结构不变时不无谓推进', async () => {
    const fs = makeFs(SHARED_LAYOUT, ['main-a.css', 'main-b.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    expect(svc.getLinkItems()).toEqual([])
    await svc.setEnabled('main-a.css', true)
    const v1 = linkMap(svc)['main-a.css']
    expect(typeof v1).toBe('number')
    // 与本入口无关的子级事件（不依赖）不推进；手动刷新取新内容（reloadAll）
    fs.fire('D:/snips/orphan/x.css')
    await sleep(30)
    expect(linkMap(svc)['main-a.css']).toBe(v1)
    await svc.refresh()
    expect(linkMap(svc)['main-a.css']).toBeGreaterThan(v1)
  })

  it('清单结构变化（新文件入列）推进全部启用入口；读取失败不动', async () => {
    const fs = makeFs(SHARED_LAYOUT, ['main-a.css'])
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('main-a.css', true)
    const before = linkMap(svc)['main-a.css']

    fs.listing = ['main-a.css', 'main-b.css']
    await svc.refresh()
    expect(linkMap(svc)['main-a.css']).toBeGreaterThan(before)

    // 读取失败：依赖面前值保留、入口 v 不动（不下发扰动）
    const beforeFail = linkMap(svc)
    fs.listing = null
    await svc.refresh()
    expect(svc.getState().readError).toBe(true)
    expect(linkMap(svc)).toEqual(beforeFail)
  })
})

describe('#130 远程引用：不进监听归因面，重发由入口版本驱动', () => {
  it('仅含 https @import 的入口：本地无依赖可归因（无关事件静默）；刷新与入口变更推进 v 驱动重发', async () => {
    const fs = makeFs(
      { 'D:/snips/online.css': '@import "https://fonts.example/sheet.css";\n.a{color:red}' },
      ['online.css'],
    )
    const svc = new CssSnippetService(makeStorage(), fs, 'k', { debounceMs: 1 })
    await svc.setDirectory('D:/snips')
    await svc.setEnabled('online.css', true)
    expect(svc.getState().rejections).toEqual({}) // 远程引用不触发越界拒绝
    const v1 = linkMap(svc)['online.css']

    // 目录内无关子级事件：依赖闭包为空（远程目标不可 watch）→ 完全静默
    fs.fire('D:/snips/orphan/x.css')
    await sleep(30)
    expect(linkMap(svc)['online.css']).toBe(v1)

    // 远程样式源变更宿主无从感知：手动刷新 → 入口 v 推进 → 入口 ?v= 击穿
    // → 嵌套 https @import 随新入口链重发（远程侧缓存遵循 HTTP 语义，见
    // test/browser/cssHttpsImports.mjs 的缓存语义钉住点）
    await svc.refresh()
    expect(linkMap(svc)['online.css']).toBeGreaterThan(v1)

    // 入口文件自身修改（保存后自动更新路径）同样推进
    const v2 = linkMap(svc)['online.css']
    writeFile(fs, 'D:/snips/online.css', '@import "https://fonts.example/sheet2.css";')
    fs.fire('D:/snips/online.css')
    await sleep(30)
    expect(linkMap(svc)['online.css']).toBeGreaterThan(v2)
  })
})
