// #556 T3 R8 探针结论接线：绝对路径资源目标的 webview 许可面推导纯逻辑。
// 探针证据（notes/t3-csp-probe/evidence.json，1.82.3 win32 真宿主）：
// - webview 资源服务对每个请求做 localResourceRoots 包含性检查，根外目标
//   401 Unauthorized（fetch 与 <img> 同口径）；
// - 扩根重赋 webview.options 触发整页重载（同值重赋无副作用）——运行中
//   动态扩根会打断输入/IME 组合，故只在面板装配点（html 赋值前）一次性
//   纳入目标所在目录。
import { describe, expect, it } from 'vitest'
import { absoluteResourceGrantDirs } from '../../src/host/absoluteResourceRoots'

describe('absoluteResourceGrantDirs：绝对资源目标的许可面推导', () => {
  it('根外绝对目标贡献其所在目录；已授权根内目标不贡献', () => {
    const dirs = absoluteResourceGrantDirs(
      [
        { targetFsPath: 'C:/vault/pic.png' },
        { targetFsPath: 'D:/outside/图.png' },
        { targetFsPath: 'D:/outside/子/文档.pdf' },
      ],
      ['C:/vault'],
      true,
    )
    expect(dirs).toEqual(['D:/outside', 'D:/outside/子'])
  })

  it('同目录去重；null 身份（断链）与大小写漂移容忍', () => {
    const dirs = absoluteResourceGrantDirs(
      [
        { targetFsPath: 'D:/outside/图.png' },
        { targetFsPath: 'D:/outside/图 2.png' },
        { targetFsPath: null },
        { targetFsPath: 'd:/OUTSIDE/图 3.png' },
      ],
      [],
      true,
    )
    expect(dirs).toEqual(['D:/outside'])
  })

  it('非资源类型（markdown/text）不贡献目录（许可面最小化）', () => {
    const dirs = absoluteResourceGrantDirs(
      [
        { targetFsPath: 'D:/outside/笔记.md' },
        { targetFsPath: 'D:/outside/data.csv' },
        { targetFsPath: 'D:/outside/图.png' },
        { targetFsPath: 'D:/outside/手册.pdf' },
      ],
      [],
      true,
    )
    expect(dirs).toEqual(['D:/outside'])
  })

  it('POSIX 宿主：根路径目标按 posix 语义判定', () => {
    const dirs = absoluteResourceGrantDirs(
      [
        { targetFsPath: '/home/user/notes/图.png' },
        { targetFsPath: '/srv/共享/手册.pdf' },
      ],
      ['/home/user/notes'],
      false,
    )
    expect(dirs).toEqual(['/srv/共享'])
  })

  it('根自身与目标目录恰为已授权根时不重复贡献', () => {
    const dirs = absoluteResourceGrantDirs(
      [
        { targetFsPath: 'C:/vault/sub/图.png' },
        { targetFsPath: 'C:/vault/图.png' },
      ],
      ['C:/vault', 'C:/vault/sub'],
      true,
    )
    expect(dirs).toEqual([])
  })
})
