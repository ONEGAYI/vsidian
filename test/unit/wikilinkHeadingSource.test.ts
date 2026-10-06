// 标题查询宿主编排契约（工单 #379 T04）：明确 Markdown 目标的解析、读取
// 与候选产物——目标按来源相对语义解析（vaultLink 同一实现，不按部分文件
// 名猜目标）；正文以「宿主当前 TextDocument」为依据（已打开文档优先——
// 未保存内容不被磁盘/索引副本替代）；失败分真实状态（target-not-found /
// target-not-md / read-error / no-workspace），不伪装空结果。
// 依赖经 ports 注入（exists / 已打开文本 / 磁盘读取），node 单测直驱。
import { describe, expect, it } from 'vitest'
import { queryWikilinkHeadings, type WikilinkHeadingSourcePorts } from '../../src/host/wikilinkHeadingSource'
import type { VaultLinkResolveContext } from '../../src/shared/vaultLink'

const CTX: VaultLinkResolveContext = {
  docDir: '/vault/项目',
  rootDir: '/vault',
  isWindowsHost: false,
  hasWorkspace: true,
}

interface Harness {
  ports: WikilinkHeadingSourcePorts
  existsPaths: Map<string, string>
  openDocs: Map<string, { text: string; version: number }>
  diskDocs: Map<string, { text: string; version: number }>
  diskFailures: Set<string>
}

function harness(): Harness {
  const existsPaths = new Map<string, string>()
  const openDocs = new Map<string, { text: string; version: number }>()
  const diskDocs = new Map<string, { text: string; version: number }>()
  const diskFailures = new Set<string>()
  const ports: WikilinkHeadingSourcePorts = {
    exists: async (fsPath) => existsPaths.get(fsPath) ?? null,
    openTextDocument: (fsPath) => openDocs.get(fsPath) ?? null,
    openTextDocumentFromDisk: async (fsPath) => {
      if (diskFailures.has(fsPath)) {
        throw new Error('boom')
      }
      const doc = diskDocs.get(fsPath)
      if (!doc) {
        throw new Error('FileNotFound')
      }
      return doc
    },
  }
  return { ports, existsPaths, openDocs, diskDocs, diskFailures }
}

const FANGAN_MD = '# 概述\n正文\n## 预算\n内容\n# 预算\n重复同名\n'

describe('queryWikilinkHeadings：目标解析（不猜目标）', () => {
  it('来源相对路径解析成功并返回目标标题候选（含重复标记与别名）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/资料/方案.md', '/vault/资料/方案.md')
    h.diskDocs.set('/vault/资料/方案.md', { text: FANGAN_MD, version: 1 })
    const result = await queryWikilinkHeadings('../资料/方案.md', '', CTX, h.ports)
    expect(result).toEqual({
      status: 'ready',
      targetVersion: 1,
      targetFsPath: '/vault/资料/方案.md',
      items: [
        { id: '/vault/资料/方案.md#1', heading: '概述', level: 1, line: 1, duplicate: false, alias: '方案' },
        { id: '/vault/资料/方案.md#3', heading: '预算', level: 2, line: 3, duplicate: true, alias: '方案' },
        { id: '/vault/资料/方案.md#5', heading: '预算', level: 1, line: 5, duplicate: true, alias: '方案' },
      ],
    })
  })

  it('无扩展名目标补 .md 候选（双链 implicitMd 语义）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/笔记.md', '/vault/项目/笔记.md')
    h.diskDocs.set('/vault/项目/笔记.md', { text: '# 标题\n', version: 1 })
    const result = await queryWikilinkHeadings('笔记', '', CTX, h.ports)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items.map((i) => i.heading)).toEqual(['标题'])
    }
  })

  it('目标不存在（精确与 .md 候选均未命中）→ target-not-found', async () => {
    const h = harness()
    const result = await queryWikilinkHeadings('不存在的目标', '', CTX, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'target-not-found' })
  })

  it('越出所属根 → target-not-found（escape 归并：无法定位目标）', async () => {
    const h = harness()
    const result = await queryWikilinkHeadings('../../越界.md', '', CTX, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'target-not-found' })
  })

  it('无工作区 → no-workspace（不猜测目标）', async () => {
    const h = harness()
    const result = await queryWikilinkHeadings('方案.md', '', { ...CTX, hasWorkspace: false }, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'no-workspace' })
  })
})

describe('queryWikilinkHeadings：Markdown 判定与读取', () => {
  it('非 Markdown 目标 → target-not-md（标题联想仅用于 Markdown）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/图.png', '/vault/项目/图.png')
    const result = await queryWikilinkHeadings('图.png', '', CTX, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'target-not-md' })
  })

  it('已打开文档优先：未保存正文（TextDocument 当前版本）不被磁盘替代', async () => {
    const h = harness()
    h.existsPaths.set('/vault/资料/方案.md', '/vault/资料/方案.md')
    // 磁盘是旧内容（无「新增标题」）；已打开 TextDocument 有未保存新标题
    h.diskDocs.set('/vault/资料/方案.md', { text: '# 旧标题\n', version: 1 })
    h.openDocs.set('/vault/资料/方案.md', { text: '# 旧标题\n# 新增标题\n', version: 3 })
    const result = await queryWikilinkHeadings('../资料/方案.md', '', CTX, h.ports)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.targetVersion).toBe(3)
      expect(result.items.map((i) => i.heading)).toEqual(['旧标题', '新增标题'])
    }
  })

  it('未打开目标读磁盘最新内容', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/笔记.md', '/vault/项目/笔记.md')
    h.diskDocs.set('/vault/项目/笔记.md', { text: '# 磁盘标题\n', version: 0 })
    const result = await queryWikilinkHeadings('笔记.md', '', CTX, h.ports)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items.map((i) => i.heading)).toEqual(['磁盘标题'])
    }
  })

  it('读取失败（删除竞态/权限）→ read-error（真实状态不伪装空结果）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/笔记.md', '/vault/项目/笔记.md')
    h.diskFailures.add('/vault/项目/笔记.md')
    const result = await queryWikilinkHeadings('笔记.md', '', CTX, h.ports)
    expect(result).toEqual({ status: 'unavailable', reason: 'read-error' })
  })
})

describe('queryWikilinkHeadings：查询与别名', () => {
  it('前缀过滤在枚举产物上执行（重复项独立保留）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/资料/方案.md', '/vault/资料/方案.md')
    h.diskDocs.set('/vault/资料/方案.md', { text: FANGAN_MD, version: 1 })
    const result = await queryWikilinkHeadings('../资料/方案.md', '预算', CTX, h.ports)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items.map((i) => i.heading)).toEqual(['预算', '预算'])
      expect(result.items.map((i) => i.line)).toEqual([3, 5])
    }
  })

  it('别名派生：Markdown 文件名去尾 .md（大小写不敏感只去一次）', async () => {
    const h = harness()
    h.existsPaths.set('/vault/资料/Project Notes.MD', '/vault/资料/Project Notes.MD')
    h.diskDocs.set('/vault/资料/Project Notes.MD', { text: '# Title\n', version: 1 })
    const result = await queryWikilinkHeadings('../资料/Project Notes.MD', 'title', CTX, h.ports)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items[0]!.alias).toBe('Project Notes')
    }
  })
})

describe('queryWikilinkHeadings：F5 标题写回语法往返校验（不合法标题不入候选）', () => {
  it('含 | / # / ^ 的标题被过滤，正常标题保留', async () => {
    const h = harness()
    h.existsPaths.set('/vault/项目/混合.md', '/vault/项目/混合.md')
    h.diskDocs.set('/vault/项目/混合.md', {
      text: [
        '# 正常标题',
        '# 带|竖线',
        '# 带#井号',
        '# 带^插入符',
        '# ^开头块形',
        '# 结尾正常',
        '',
      ].join('\n'),
      version: 1,
    })
    const result = await queryWikilinkHeadings('混合.md', '', CTX, h.ports)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.items.map((i) => i.heading)).toEqual(['正常标题', '结尾正常'])
    }
  })
})
