// #366 T17 Remote SSH 同宿主安装回归——SSH 装配纯逻辑单测（node --test）。
// 副作用层（marketplace 下载、CLI 安装、远端宿主启动）由
// runRemoteSshAddons.mjs 集成承载，本文件只钉住纯逻辑契约：
// - 隔离 profile 需预置的 Remote-SSH 设置（探针实证：缺 remotePlatform
//   时 resolver 弹平台选择 QuickPick 且 ignoreFocusOut 永不超时，无人值守
//   会话挂死；缺 confirmFingerprint 时首连指纹确认同样挂起）；
// - 测试宿主参数的 --remote 拼装（workspace 参数保持在末位）；
// - marketplace 历史版本下载 URL 形态；
// - SSH 会话阶段标记文件读写（远端 ext host 不继承本地 env，阶段变量
//   经工作区文件传递——T16 的 VSIDIAN_T16_PHASE 通道在 SSH 下不可用）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  T17_SSH_CASE_FILTER,
  T17_SSH_PHASES,
  T17_SSH_PHASE_MARKER_NAME,
  buildRemoteAuthority,
  mergeRemoteExtensionEntries,
  readSshPhaseMarker,
  remoteSshMarketplaceUrl,
  remoteSshProfileSettings,
  withRemoteArg,
  writeSshPhaseMarker,
} from './t17RemoteSsh.mjs'

test('Remote-SSH profile 设置：预置指纹确认关闭与远端平台映射（探针实证的挂死根因）', () => {
  const settings = remoteSshProfileSettings({ host: 'localhost', platform: 'windows' })
  assert.equal(settings['remote.SSH.confirmFingerprint'], false)
  assert.deepEqual(settings['remote.SSH.remotePlatform'], { localhost: 'windows' })
  // 平台值原样进映射：不同主机/平台组合不特殊归一（Remote-SSH 自身消费）
  const other = remoteSshProfileSettings({ host: 'build-box', platform: 'linux' })
  assert.deepEqual(other['remote.SSH.remotePlatform'], { 'build-box': 'linux' })
})

test('remote authority 拼装：ssh-remote+<host>', () => {
  assert.equal(buildRemoteAuthority('localhost'), 'ssh-remote+localhost')
})

test('withRemoteArg：--remote 插在末位 workspace 之前，原参数顺序其余不变', () => {
  const base = ['--no-sandbox', '--extensionTestsPath=X', '--extensionDevelopmentPath=D', 'D:\\ws\\fixture.code-workspace']
  const withRemote = withRemoteArg(base, 'localhost')
  assert.deepEqual(withRemote, [
    '--no-sandbox',
    '--extensionTestsPath=X',
    '--extensionDevelopmentPath=D',
    '--remote',
    'ssh-remote+localhost',
    'D:\\ws\\fixture.code-workspace',
  ])
})

test('withRemoteArg：空参数表拒绝（workspace 约定缺失是装配错误，不得静默放行）', () => {
  assert.throws(() => withRemoteArg([], 'localhost'), /workspace/)
})

test('marketplace 历史版本下载 URL：发布者/扩展/版本三段形态', () => {
  assert.equal(
    remoteSshMarketplaceUrl('0.106.1'),
    'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/0.106.1/vspackage',
  )
})

test('SSH 阶段标记：写读往返、未知阶段拒绝、缺席读 null', () => {
  const wsDir = mkdtempSync(path.join(tmpdir(), 'vsidian-t17-unit-'))
  try {
    assert.equal(readSshPhaseMarker(wsDir), null, '未写标记读 null')
    assert.throws(() => writeSshPhaseMarker(wsDir, 'NOPE'), /未知 T17 SSH 阶段/)
    assert.throws(() => writeSshPhaseMarker(wsDir, 'R1', ''), /caseFilter/)
    for (const phase of T17_SSH_PHASES) {
      writeSshPhaseMarker(wsDir, phase)
      assert.equal(readSshPhaseMarker(wsDir), phase)
    }
    // 覆写语义：后写覆盖先写（阶段矩阵同一工作区目录可复用）
    writeSshPhaseMarker(wsDir, 'R1')
    assert.equal(readSshPhaseMarker(wsDir), 'R1')
    // caseFilter 携带（suite 入口兜底通道消费）与省略形态
    writeSshPhaseMarker(wsDir, 'R1', '附加组件 T17')
    const raw = JSON.parse(readFileSync(path.join(wsDir, T17_SSH_PHASE_MARKER_NAME), 'utf8'))
    assert.deepEqual(Object.keys(raw).sort(), ['caseFilter', 'phase'])
    assert.equal(raw.caseFilter, '附加组件 T17')
    writeSshPhaseMarker(wsDir, 'R2')
    const omit = JSON.parse(readFileSync(path.join(wsDir, T17_SSH_PHASE_MARKER_NAME), 'utf8'))
    assert.deepEqual(Object.keys(omit), ['phase'])
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('阶段与筛选常量：R1/R2 两阶段，用例筛选子串与非安装态会话兼容', () => {
  assert.deepEqual(T17_SSH_PHASES, ['R1', 'R2'])
  assert.equal(T17_SSH_CASE_FILTER, '附加组件 T17')
  assert.equal(T17_SSH_PHASE_MARKER_NAME, '.vsidian-t17-ssh.json')
})

test('远端清单镜像：include 替换/追加、管辖外保留、管辖不 include 删除、本地缺失报错', () => {
  const entry = (id) => ({ identifier: { id }, version: '1.0.0' })
  const local = [entry('onegayi.vsidian'), entry('vsidian-example.input-behavior'), entry('vsidian-example.renderer')]
  const governed = ['onegayi.vsidian', 'vsidian-example.input-behavior', 'vsidian-example.renderer']
  // 空远端：include 全追加
  assert.deepEqual(
    mergeRemoteExtensionEntries([], local, ['onegayi.vsidian', 'vsidian-example.renderer'], governed),
    [entry('onegayi.vsidian'), entry('vsidian-example.renderer')],
  )
  // 远端已有先前镜像（R1 装了 input-behavior）：R2 不 include → 删除；远端自带条目保留
  const remoteAfterR1 = [entry('ms-vscode.remote-explorer'), entry('onegayi.vsidian'), entry('vsidian-example.input-behavior')]
  assert.deepEqual(
    mergeRemoteExtensionEntries(remoteAfterR1, local, ['onegayi.vsidian'], governed),
    [entry('ms-vscode.remote-explorer'), entry('onegayi.vsidian')],
  )
  // 替换语义：远端旧版本条目被本地条目替换（引用同一对象）
  const replaced = mergeRemoteExtensionEntries(remoteAfterR1, local, ['onegayi.vsidian', 'vsidian-example.input-behavior'], governed)
  assert.equal(replaced.find((e) => e.identifier.id === 'onegayi.vsidian'), local[0])
  // include 不在管辖集：拒绝
  assert.throws(() => mergeRemoteExtensionEntries([], local, ['ms-vscode.remote-explorer'], governed), /管辖集/)
  // include 命中但本地清单缺条目：报错不静默
  assert.throws(() => mergeRemoteExtensionEntries([], [entry('onegayi.vsidian')], ['onegayi.vsidian', 'vsidian-example.renderer'], governed), /本地清单未命中/)
  // 参数形态防御
  assert.throws(() => mergeRemoteExtensionEntries(null, [], [], []), /四个数组/)
})
