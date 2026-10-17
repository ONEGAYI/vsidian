// 附加组件设置页接线契约（#579）：市场搜索入口必须以 @tag: 修饰符查询
// vsidian-addon——package.json 的 keywords 上架 Marketplace 后被索引为
// tag，@keyword: 不是 workbench.extensions.search 的合法修饰符（整串被当
// 字面文本搜索，结果恒为空）。经 vi.mock('vscode') 装配真实
// createAddonWiring，钉住 openSearch 传给宿主命令的查询串。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vscodeMock = vi.hoisted(() => ({
  commands: {
    registerCommand: vi.fn(() => ({ dispose: () => {} })),
    executeCommand: vi.fn((_command: string, _arg?: unknown) => Promise.resolve()),
  },
}))

vi.mock('vscode', () => {
  const fakeUri = (path: string) => ({
    scheme: 'file',
    path,
    fsPath: path,
    toString: () => `file://${path}`,
  })
  return {
    commands: vscodeMock.commands,
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
      onDidChangeActiveColorTheme: () => ({ dispose: () => {} }),
      activeColorTheme: { kind: 1 },
    },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    workspace: {
      workspaceFolders: undefined,
      workspaceFile: undefined,
      fs: {
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
        delete: async () => {},
        readDirectory: async () => [],
        createDirectory: async () => {},
      },
      createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose: () => {} }),
        onDidChange: () => ({ dispose: () => {} }),
        onDidDelete: () => ({ dispose: () => {} }),
        dispose: () => {},
      }),
    },
    RelativePattern: class {
      constructor(public base: unknown, public pattern: string) {}
    },
    Uri: {
      joinPath: (base: { path: string }, ...parts: string[]) => fakeUri([base.path, ...parts].join('/')),
      file: (path: string) => fakeUri(path),
    },
    extensions: {
      getExtension: () => undefined,
      all: [],
      onDidChange: () => ({ dispose: () => {} }),
    },
  }
})

import { createAddonWiring } from '../../src/host/addons/addonWiring'
import { SettingsService, type SettingsStorage } from '../../src/host/settingsService'

function memoryStorage(): SettingsStorage {
  const map = new Map<string, unknown>()
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    update: async (key: string, value: unknown) => { map.set(key, value) },
  }
}

/** 构造真实 wiring：context 用内存 Memento 假件，hostSettings 用真实服务 */
function makeWiring() {
  const memento = () => {
    const map = new Map<string, unknown>()
    return { get: (key: string) => map.get(key), update: async (key: string, value: unknown) => { map.set(key, value) } }
  }
  const context = {
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: memento(),
    workspaceState: memento(),
    globalStorageUri: { scheme: 'file', path: '/test/storage', fsPath: '/test/storage', toString: () => 'file:///test/storage' },
    extensionUri: { scheme: 'file', path: '/test/ext', fsPath: '/test/ext', toString: () => 'file:///test/ext' },
  }
  return createAddonWiring(context as never, new SettingsService(memoryStorage()))
}

describe('附加组件设置页接线：市场搜索查询串（#579）', () => {
  beforeEach(() => vscodeMock.commands.executeCommand.mockClear())

  it('openSearch 以 @tag:"vsidian-addon" 调用 workbench.extensions.search', () => {
    makeWiring().page.openSearch()
    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.search',
      '@tag:"vsidian-addon"',
    )
  })

  it('@keyword 非法修饰符不得回潮（Marketplace 把 keywords 索引为 tag）', () => {
    makeWiring().page.openSearch()
    const query = vscodeMock.commands.executeCommand.mock.calls
      .filter(([command]) => command === 'workbench.extensions.search')
      .map((call) => call[1] as string)[0]
    expect(query).toBeDefined()
    expect(query.startsWith('@tag:')).toBe(true)
    expect(query.includes('@keyword')).toBe(false)
  })
})
