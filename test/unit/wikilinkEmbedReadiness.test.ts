import { beforeEach, expect, it, vi } from 'vitest'

const scene = vi.hoisted(() => ({
  text: '# 目标乙\n\n目标乙正文与落点。\n',
  viewReads: 0,
  intermediateLength: 0,
  focusedBeforeInit: false,
  stop: new Error('STOP_AT_FIRST_EMBED_INPUT'),
}))

vi.mock('vscode', () => ({
  Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/vault' } }],
    openTextDocument: async (uri: { fsPath: string }) => ({
      uri, isDirty: false,
      getText: () => uri.fsPath.endsWith('sub/t06-b.md') ? scene.text : '',
    }),
    fs: { readFile: async () => Buffer.from('') },
  },
  commands: {
    executeCommand: async (name: string, _uri: unknown, message?: { kind: string }) => {
      switch (name) {
        case 'vscode.openWith':
          return undefined
        case 'onegayi.vsidian._test.getSessionState':
          return { found: true, panels: [{ ready: true }] }
        case 'onegayi.vsidian._test.requestViewState':
          scene.viewReads++
          return { readingEmbed: [{
            inner: 'sub/t06-b.md', liveBound: true, livePortId: 'refport-B',
            liveTextLen: scene.viewReads < 2 ? scene.intermediateLength : scene.text.length,
          }] }
        case 'onegayi.vsidian._test.postToPanel':
          if (message?.kind === 'embed.test.focus') {
            scene.focusedBeforeInit = scene.viewReads < 2
            return undefined
          }
          // 在第一笔输入处停止真实用例，只检验它的准备链；联想后续由原回归覆盖。
          if (message?.kind === 'embed.test.domType') throw scene.stop
          throw new Error(`Unexpected post: ${message?.kind}`)
        default:
          throw new Error(`Unexpected command: ${name}`)
      }
    },
  },
}))

import { wikilinkEmbedCases } from '../integration/suite/wikilinkEmbed'

beforeEach(() => {
  scene.viewReads = 0
  scene.focusedBeforeInit = false
})

it.each([0, 1])('T06 在绑定后仍只有 %i 字时，等目标正文 init 再按源坐标输入', async (length) => {
  scene.intermediateLength = length
  const blockCase = wikilinkEmbedCases.find(([name]) => name.includes('B 引 C 无 ID 块'))!
  await expect(blockCase[1]()).rejects.toBe(scene.stop)
  expect(scene.focusedBeforeInit).toBe(false)
  expect(scene.viewReads).toBe(2)
})
