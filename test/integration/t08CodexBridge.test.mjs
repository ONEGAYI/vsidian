// #535 T08 安装态组件对照与升级路径——阶段装配与 bridge VSIX 审计纯逻辑
// 单测（node --test）。副作用层（vsce/CLI 安装/宿主启动）由
// runInstalledCodexBridge.mjs 集成承载，本文件只钉住纯逻辑契约。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  T08_PHASES,
  T08_CASE_FILTER,
  auditBridgeVsixEntries,
  t08PhaseHostEnv,
} from './t08CodexBridge.mjs'

const BRIDGE_VSIX_OK = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/package.nls.json',
  'extension/LICENSE.txt',
  'extension/dist/extension.js',
  'extension/dist/editor.js',
  'extension/dist/mermaid.js',
  'extension/dist/mermaid-chunks/flowDiagram-ABCD1234.js',
]

test('bridge VSIX 条目审计：干净包通过，宿主/页面/mermaid 产物缺失各报一条', () => {
  assert.deepEqual(auditBridgeVsixEntries(BRIDGE_VSIX_OK), [])
  const noHost = auditBridgeVsixEntries(BRIDGE_VSIX_OK.filter((e) => e !== 'extension/dist/extension.js'))
  assert.equal(noHost.length, 1, '宿主入口缺失报一条')
  const noEditor = auditBridgeVsixEntries(BRIDGE_VSIX_OK.filter((e) => e !== 'extension/dist/editor.js'))
  assert.equal(noEditor.length, 1, '页面模块缺失报一条')
  const noMermaid = auditBridgeVsixEntries(BRIDGE_VSIX_OK.filter((e) => e !== 'extension/dist/mermaid.js'))
  assert.equal(noMermaid.length, 1, 'mermaid 独立产物缺失报一条')
})

test('bridge VSIX 条目审计：分块缺失与源码夹带各自报违规', () => {
  const noChunks = auditBridgeVsixEntries(
    BRIDGE_VSIX_OK.filter((e) => !e.startsWith('extension/dist/mermaid-chunks/')),
  )
  assert.equal(noChunks.length, 1, 'mermaid-chunks 整组缺失报一条（ELK 分块承载在组件侧）')
  const smuggled = auditBridgeVsixEntries([
    ...BRIDGE_VSIX_OK,
    'extension/src/extension.ts',
    'extension/node_modules/mermaid/dist/mermaid.js',
  ])
  assert.equal(smuggled.length, 2, '源码与依赖夹带各报一条')
})

test('T08 阶段矩阵固定为 legacy/upgraded 两阶段，env 拼装与钩子删除标记', () => {
  assert.deepEqual(T08_PHASES, ['legacy', 'upgraded'])
  assert.throws(() => t08PhaseHostEnv('X', { hooks: true }), /未知 T08 阶段/)
  const legacy = t08PhaseHostEnv('legacy', { hooks: true })
  assert.equal(legacy.VSIDIAN_TEST_HOOKS, '1')
  assert.equal(legacy.VSIDIAN_T08_PHASE, 'legacy')
  assert.equal(legacy.VSIDIAN_TEST_CASES, T08_CASE_FILTER)
  assert.equal('!delete' in legacy, false, '测试态阶段无删除标记')
  const upgraded = t08PhaseHostEnv('upgraded', { hooks: true })
  assert.equal(upgraded.VSIDIAN_T08_PHASE, 'upgraded')
})
