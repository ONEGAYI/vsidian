// #365 T16 安装态回归——打包与阶段装配纯逻辑单测（node --test）。
// 副作用层（vsce/CLI 安装/宿主启动）由 runInstalledAddons.mjs 集成承载，
// 本文件只钉住纯逻辑契约：主/组件 VSIX 条目断言、阶段环境拼装与删除标记。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  T16_PHASES,
  T16_CASE_FILTER,
  applyPhaseEnv,
  auditAddonVsixEntries,
  auditMainVsixEntries,
  phaseHostEnv,
} from './t16Package.mjs'

const MAIN_VSIX_OK = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/package.nls.json',
  'extension/package.nls.zh-cn.json',
  'extension/LICENSE.txt',
  'extension/out/extension.js',
  'extension/out/webview/main.js',
  'extension/out/webview/main.js.map'.replace('.map', ''),
  'extension/out/webview/settings.js',
  'extension/media/vsidian-icon-256.png',
]

test('主 VSIX 条目断言：干净包通过，排除面夹带与关键产物缺失各自报违规', () => {
  assert.deepEqual(auditMainVsixEntries(MAIN_VSIX_OK), [])
  const smuggled = auditMainVsixEntries([
    ...MAIN_VSIX_OK,
    'extension/src/extension.ts',
    'extension/test/unit/leak.test.ts',
    'extension/docs/specs/mvp.md',
    'extension/examples/renderer/package.json',
  ])
  assert.equal(smuggled.length, 4, `四类夹带各自报一条（实际 ${JSON.stringify(smuggled)}）`)
  const missing = auditMainVsixEntries(['extension/package.json', '[Content_Types].xml'])
  assert.equal(missing.length, 3, '缺宿主入口与两枚 webview 产物各报一条')
  assert.ok(missing.every((v) => v.includes('out/')), '缺失断言点名产物路径')
})

test('主 VSIX 条目断言：目录本身（无尾斜杠）同样算夹带，路径分隔符归一', () => {
  const violations = auditMainVsixEntries([
    ...MAIN_VSIX_OK,
    'extension\\src\\shared\\protocol.ts',
    'extension/test',
  ])
  assert.equal(violations.length, 2, '反斜杠条目与目录条目都命中')
})

test('组件 VSIX 条目断言：样例形态要求宿主/页面/样式随包，负向夹具只要求清单', () => {
  const rendererVsix = [
    'extension.vsixmanifest',
    'extension/package.json',
    'extension/dist/extension.js',
    'extension/dist/editor.js',
    'extension/dist/editor.css',
  ]
  assert.deepEqual(auditAddonVsixEntries(rendererVsix, {
    pages: ['extension/dist/editor.js'],
    css: ['extension/dist/editor.css'],
  }), [])
  const uiVsix = [...rendererVsix, 'extension/dist/settings.js']
  assert.deepEqual(auditAddonVsixEntries(uiVsix, {
    pages: ['extension/dist/editor.js', 'extension/dist/settings.js'],
    css: ['extension/dist/editor.css'],
  }), [])
  // 页面缺失：报违规（资源随包是安装态链路的前提）
  const noPage = auditAddonVsixEntries(
    rendererVsix.filter((entry) => entry !== 'extension/dist/editor.js'),
    { pages: ['extension/dist/editor.js'] },
  )
  assert.equal(noPage.length, 1)
  // addon-incompatible：声明即扩展（无 main 无产物）
  assert.deepEqual(auditAddonVsixEntries(
    ['extension.vsixmanifest', 'extension/package.json'],
    { hostOnly: true },
  ), [])
})

test('阶段环境拼装：未知阶段拒绝；发行态阶段返回钩子删除标记，测试态显式置 1', () => {
  assert.throws(() => phaseHostEnv('X', { hooks: true }), /未知 T16 阶段/)
  const hooked = phaseHostEnv('B', { hooks: true })
  assert.equal(hooked.VSIDIAN_TEST_HOOKS, '1')
  assert.equal(hooked.VSIDIAN_T16_PHASE, 'B')
  assert.equal(hooked.VSIDIAN_TEST_CASES, T16_CASE_FILTER)
  const production = phaseHostEnv('C', { hooks: false })
  assert.equal('VSIDIAN_TEST_HOOKS' in production, false, '发行态不出现钩子键（以删除标记承载）')
  assert.deepEqual(production['!delete'], ['VSIDIAN_TEST_HOOKS'])
})

test('阶段环境应用：删除标记把继承 env 里的 VSIDIAN_TEST_HOOKS 真实移除', () => {
  const inherited = { VSIDIAN_TEST_HOOKS: '1', WORKSPACE_DIR: '/tmp/ws', PATH: 'x' }
  const applied = applyPhaseEnv(inherited, phaseHostEnv('C', { hooks: false }))
  assert.equal('VSIDIAN_TEST_HOOKS' in applied, false, '继承残留的 1 必须被移除')
  assert.equal(applied.WORKSPACE_DIR, '/tmp/ws')
  assert.equal(applied.VSIDIAN_T16_PHASE, 'C')
  const hooked = applyPhaseEnv({ WORKSPACE_DIR: '/w' }, phaseHostEnv('A', { hooks: true }))
  assert.equal(hooked.VSIDIAN_TEST_HOOKS, '1')
  // 应用不回写源对象（启动器按阶段独立拼装）
  assert.equal(inherited.WORKSPACE_DIR, '/tmp/ws')
})

test('阶段矩阵固定为 A-E 五阶段（启动器编排与用例 phaseGuard 共同依赖）', () => {
  assert.deepEqual(T16_PHASES, ['A', 'B', 'C', 'D', 'E'])
})
