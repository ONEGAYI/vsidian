// 块查询宿主编排契约（#380 T05 + 2026-10-14 同文档锚点）：明确 Markdown
// 目标的解析、读取与候选产物，及空目标（省略文件名）按当前文档枚举的
// sameDocFsPath 分支——与 wikilinkHeadingSource.test 同构分层（依赖经
// ports 注入，node 单测直驱）。
import { describe, expect, it } from 'vitest'
import { queryWikilinkBlocks, type WikilinkBlockSourcePorts } from '../../src/host/wikilinkBlockSource'
import type { VaultLinkResolveContext } from '../../src/shared/vaultLink'

const CTX: VaultLinkResolveContext = {
  docDir: '/vault/项目',
  rootDir: '/vault',
  isWindowsHost: false,
  hasWorkspace: true,
}

function harness() {
  const existsPaths = new Map<string, string>()
  const openDocs = new Map<string, { text: string; version: number }>()
  const diskDocs = new Map<string, { text: string; version: number }>()
  const ports: WikilinkBlockSourcePorts = {
    exists: async (fsPath) => existsPaths.get(fsPath) ?? null,
    openTextDocument: (fsPath) => openDocs.get(fsPath) ?? null,
    openTextDocumentFromDisk: async (fsPath) => {
      const doc = diskDocs.get(fsPath)
      if (!doc) {
        throw new Error('FileNotFound')
      }
      return doc
    },
  }
  return { ports, existsPaths, openDocs, diskDocs }
}

describe('queryWikilinkBlocks：目标解析与读取', () => {
  it('明确目标：解析成功返回块候选（无 ID 块照常列出）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/方案.md', '/vault/项目/方案.md')
    h.diskDocs.set('/vault/项目/方案.md', { text: '第一段\n\n```js\ncode\n```\n', version: 1 })
    const result = await queryWikilinkBlocks('方案.md', '', CTX, h.ports)
    expect(result).toEqual({
      status: 'ready',
      targetVersion: 1,
      targetFsPath: '/vault/项目/方案.md',
      items: [
        { id: '/vault/项目/方案.md#^1', blockId: '', snippet: '第一段', line: 1, lineCount: 1, alias: '方案' },
        { id: '/vault/项目/方案.md#^3', blockId: '', snippet: '```js', line: 3, lineCount: 3, alias: '方案' },
      ],
    })
  })

  it('目标不存在 → target-not-found', async () => {
    const h = harness()
    const result = await queryWikilinkBlocks('不存在.md', '', CTX, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'target-not-found' })
  })
})

describe('queryWikilinkBlocks：同文档锚点（空目标=当前文档，2026-10-14 修复）', () => {
  it('空目标 + sameDocFsPath：跳过目标解析直接枚举当前文档，alias 为空串', async () => {
    const h = harness()
    // existsPaths 未登记——同文档不走存在性探测（文档在编辑中即在场）
    h.openDocs.set('/vault/项目/记录.md', { text: '段落一\n\n段落二行一\n段落二行二\n', version: 7 })
    const result = await queryWikilinkBlocks('', '段落二', CTX, h.ports, '/vault/项目/记录.md')
    expect(result).toEqual({
      status: 'ready',
      targetVersion: 7,
      targetFsPath: '/vault/项目/记录.md',
      items: [
        { id: '/vault/项目/记录.md#^3', blockId: '', snippet: '段落二行一', line: 3, lineCount: 2, alias: '' },
      ],
    })
  })

  it('已有 ID 块照常带 id 候选（片段与 id 均可搜索）', async () => {
    const h = harness()
    h.openDocs.set('/vault/项目/记录.md', { text: '已有行尾 id 段落 ^tail01\n', version: 2 })
    const byId = await queryWikilinkBlocks('', 'tail', CTX, h.ports, '/vault/项目/记录.md')
    expect(byId.status).toBe('ready')
    if (byId.status === 'ready') {
      expect(byId.items.map((i) => i.blockId)).toEqual(['tail01'])
      expect(byId.items[0]!.alias).toBe('')
    }
  })

  it('无工作区也按当前文档枚举（本文件锚点不依赖根解析）', async () => {
    const h = harness()
    h.openDocs.set('/独立/笔记.md', { text: '唯一段落\n', version: 1 })
    const result = await queryWikilinkBlocks('', '', { ...CTX, hasWorkspace: false }, h.ports, '/独立/笔记.md')
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items.map((i) => i.snippet)).toEqual(['唯一段落'])
    }
  })

  it('未提供 sameDocFsPath 的空目标维持不可定位（target-not-found，旧守卫不放宽）', async () => {
    const h = harness()
    const result = await queryWikilinkBlocks('', '', CTX, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'target-not-found' })
  })

  it('显式自引目标仍补文件名默认别名（既有行为不变）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/记录.md', '/vault/项目/记录.md')
    h.openDocs.set('/vault/项目/记录.md', { text: '段落\n', version: 2 })
    const result = await queryWikilinkBlocks('记录.md', '', CTX, h.ports, '/vault/项目/记录.md')
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items[0]!.alias).toBe('记录')
    }
  })
})

describe('queryWikilinkBlocks：#556 T3 短名补查分态（真实状态不伪装）', () => {
  it('补查端口注入：唯一且完整 → 命中目标并枚举块', async () => {
    const h = harness()
    h.diskDocs.set('/vault/资料/方案.md', { text: '# 甲\n\n段落一 ^blk-a\n', version: 3 })
    const result = await queryWikilinkBlocks('方案', '', CTX, h.ports, undefined, {
      lookupShortname: async () => ({ candidates: ['/vault/资料/方案.md'], complete: true }),
    })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.targetFsPath).toBe('/vault/资料/方案.md')
      expect(result.items.map((i) => i.blockId)).toContain('blk-a')
    }
  })

  it('多候选 → target-ambiguous；唯一但清单不完整 → target-pending', async () => {
    const h = harness()
    const ambiguous = await queryWikilinkBlocks('方案', '', CTX, h.ports, undefined, {
      lookupShortname: async () => ({ candidates: ['/vault/资料/方案.md', '/vault/归档/方案.md'], complete: true }),
    })
    expect(ambiguous).toEqual({ status: 'unavailable', reason: 'target-ambiguous' })
    const pending = await queryWikilinkBlocks('方案', '', CTX, h.ports, undefined, {
      lookupShortname: async () => ({ candidates: ['/vault/资料/方案.md'], complete: false }),
    })
    expect(pending).toEqual({ status: 'unavailable', reason: 'target-pending' })
  })
})
