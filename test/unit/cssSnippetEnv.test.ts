// CSS 片段环境身份契约（#131）：本地与 Remote SSH 环境的身份推导与存储
// 桶戳。语义依据 @types/vscode 1.86.0 的事实核查（见 docs/adr/0007）：
// - vscode.env.remoteName：本地窗口（无远程扩展宿主）为 undefined；SSH
//   远程为 'ssh-remote'（远端类型名，不含机器名——区分不同远程机器不能
//   只靠它）。
// - vscode.env.machineId：扩展宿主所在机器的唯一标识（远程宿主即远程
//   机器的 id）；禁用遥测时可能为占位值——身份仅用于观测与防御性分桶，
//   隔离的权威机制是 globalState 按宿主机器持久（ADR-0007 证据链）。
import { describe, it, expect } from 'vitest'
import {
  cssSnippetEnvIdentity,
  cssSnippetEnvStamp,
  readStoredCssSnippetBucket,
} from '../../src/shared/cssSnippetEnv'

describe('环境身份推导（cssSnippetEnvIdentity）', () => {
  it('本地（remoteName undefined）：scope=local，remoteName 归 null', () => {
    expect(cssSnippetEnvIdentity({ remoteName: undefined, machineId: 'm-local' })).toEqual({
      scope: 'local',
      remoteName: null,
      machineId: 'm-local',
    })
  })

  it('SSH 远程（remoteName=ssh-remote）：scope=remote，remoteName 保留类型名', () => {
    expect(cssSnippetEnvIdentity({ remoteName: 'ssh-remote', machineId: 'm-r1' })).toEqual({
      scope: 'remote',
      remoteName: 'ssh-remote',
      machineId: 'm-r1',
    })
  })

  it('remoteName 空串按本地处理（防御：非空才算远程）', () => {
    expect(cssSnippetEnvIdentity({ remoteName: '', machineId: 'm' }).scope).toBe('local')
  })

  it('machineId 缺失可降级构造（身份不因占位值崩溃）', () => {
    expect(cssSnippetEnvIdentity({ remoteName: undefined, machineId: undefined })).toEqual({
      scope: 'local',
      remoteName: null,
      machineId: null,
    })
    expect(cssSnippetEnvIdentity({ remoteName: 'ssh-remote', machineId: undefined }).scope)
      .toBe('remote')
  })
})

describe('存储桶戳（cssSnippetEnvStamp）', () => {
  it('本地戳恒为 local；远程戳含类型名与机器 id', () => {
    expect(cssSnippetEnvStamp({ remoteName: undefined, machineId: 'm-local' })).toBe('local')
    expect(cssSnippetEnvStamp({ remoteName: 'ssh-remote', machineId: 'm-r1' }))
      .toBe('remote:ssh-remote:m-r1')
  })

  it('同一名远程机器的多窗口同戳（machineId 稳定即共享一桶）；不同机器异戳', () => {
    const a = cssSnippetEnvStamp({ remoteName: 'ssh-remote', machineId: 'm-r1' })
    const a2 = cssSnippetEnvStamp({ remoteName: 'ssh-remote', machineId: 'm-r1' })
    const b = cssSnippetEnvStamp({ remoteName: 'ssh-remote', machineId: 'm-r2' })
    expect(a).toBe(a2)
    expect(a).not.toBe(b)
  })

  it('machineId 缺失时远程戳降级为 unknown（同类型多机器退化为同桶——记录在案的降级，不崩溃）', () => {
    expect(cssSnippetEnvStamp({ remoteName: 'ssh-remote', machineId: undefined }))
      .toBe('remote:ssh-remote:unknown')
  })
})

describe('分桶读取（readStoredCssSnippetBucket）', () => {
  it('同桶：合法存储原样读出（含 paused）', () => {
    const raw = { directory: 'D:/x', enabled: { 'a.css': true }, paused: true, envStamp: 'local' }
    expect(readStoredCssSnippetBucket(raw, 'local')).toEqual({
      directory: 'D:/x',
      enabled: { 'a.css': true },
      paused: true,
    })
  })

  it('异桶：stamp 不匹配的存储被视为未配置（读取侧过滤——远程配置不覆盖本地，本地也不读远程桶）', () => {
    const raw = { directory: '/home/u/.snips', enabled: { 'a.css': true }, paused: false, envStamp: 'remote:ssh-remote:m-r1' }
    expect(readStoredCssSnippetBucket(raw, 'local')).toEqual({
      directory: null,
      enabled: {},
      paused: false,
    })
    // 反方向同样成立
    const local = { directory: 'D:/local', enabled: {}, paused: false, envStamp: 'local' }
    expect(readStoredCssSnippetBucket(local, 'remote:ssh-remote:m-r1').directory).toBeNull()
  })

  it('#128 存量无 stamp：采用当前环境（迁移友好——升级不清空已配置目录）', () => {
    const legacy = { directory: 'D:/legacy', enabled: { 'a.css': true } }
    expect(readStoredCssSnippetBucket(legacy, 'local').directory).toBe('D:/legacy')
    expect(readStoredCssSnippetBucket(legacy, 'remote:ssh-remote:m-r1').directory).toBe('D:/legacy')
  })

  it('空串 stamp 视为无 stamp（采用当前环境）；非对象输入回默认', () => {
    expect(readStoredCssSnippetBucket({ directory: 'D:/x', envStamp: '' }, 'local').directory).toBe('D:/x')
    expect(readStoredCssSnippetBucket(undefined, 'local')).toEqual({
      directory: null,
      enabled: {},
      paused: false,
    })
    expect(readStoredCssSnippetBucket('junk', 'local').directory).toBeNull()
  })

  it('桶内字段仍走存量清洗（非法 directory/enabled/paused 逐项回默认）', () => {
    const raw = { directory: 42, enabled: { 'a.css': 'on' }, paused: 'yes', envStamp: 'local' }
    expect(readStoredCssSnippetBucket(raw, 'local')).toEqual({
      directory: null,
      enabled: {},
      paused: false,
    })
  })
})
