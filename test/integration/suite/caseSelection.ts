// 敏感组是有证据的临时归组，不表示已排除产品缺陷；完整名称精确匹配。
// 恢复强制检查时从此表移除，证据与处置边界见 integration-test-groups.md。
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'

export const SENSITIVE_CASES = [
  {
    name: 'CSS 片段：被导入文件修改自动刷新、删除降级与缺失恢复（#129）',
    issue: '#293 / #129',
    reason: 'CSS 导入刷新状态在 CI 超时，同一相关代码有通过记录。',
    evidence: 'https://github.com/ONEGAYI/vsidian/issues/293',
  },
  {
    name: '索引维护：批量文件增删的队列收敛与索引守恒（Git 切换量级 100 文件，#202）',
    issue: '#202',
    reason: '百文件增量收敛在 CI 超时，健康运行约四秒；根因未定。',
    evidence: 'https://github.com/ONEGAYI/vsidian/actions/runs/36864132224',
  },
  {
    name: '嵌入：Live 挂载与源码显隐——IME 编辑撤销闭环与双零 dirty（#223）',
    issue: '#272 / #223',
    reason: '缺失卡终态采样缺口已修复，待同提交多次 CI 验证后恢复 core。',
    evidence: 'https://github.com/ONEGAYI/vsidian/actions/runs/36875022608/attempts/2',
  },
  {
    name: '递归：真宿主直接来源、三层、设置热更与未保存刷新（#244）',
    issue: '#272 / #244',
    reason: '隐藏 Live 根重复卡误采已修复，待同提交多次 CI 验证后恢复 core。',
    evidence: 'https://github.com/ONEGAYI/vsidian/issues/272',
  },
] as const

export interface CaseSelectionOptions {
  group?: string
  filter?: string
  shard?: string
}

/** #366 T17：SSH 远端会话的用例筛选兜底通道。远端 ext host 不继承本地
 * env（VSIDIAN_TEST_CASES 经 process.env 传不进 SSH 会话——server 进程
 * env 来自远端登录 shell），阶段变量与筛选经工作区标记文件传递（与
 * test/integration/t17RemoteSsh.mjs 的 writeSshPhaseMarker 同一文件、
 * 同一字段语义）。本地会话 env 优先，缺席且标记文件在场时才兜底；标记
 * 损坏/无工作区返回 undefined（回到全量语义，不静默扩大筛选面）。 */
export function sshMarkerCaseFilter(readFile: (p: string) => string = (p) => readFileSync(p, 'utf8'),
  folders: readonly { uri: vscode.Uri }[] = vscode.workspace.workspaceFolders ?? []): string | undefined {
  const root = folders[0]?.uri.fsPath
  if (!root) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFile(path.join(root, '.vsidian-t17-ssh.json')))
  } catch {
    return undefined
  }
  const filter = (parsed as { caseFilter?: unknown } | null)?.caseFilter
  return typeof filter === 'string' && filter !== '' ? filter : undefined
}

/** 保留既有筛选与切片语义，分组只决定用例是否执行，不修改断言。 */
export function selectIntegrationCases<T>(cases: Array<[string, T]>, options: CaseSelectionOptions = {}) {
  const group = options.group || 'all'
  if (group !== 'all' && group !== 'core' && group !== 'sensitive') {
    throw new Error(`VSIDIAN_TEST_GROUP 须为 all/core/sensitive，收到 ${JSON.stringify(options.group)}`)
  }
  const sensitiveNames = new Set<string>(SENSITIVE_CASES.map((entry) => entry.name))
  for (const name of sensitiveNames) {
    if (cases.filter(([caseName]) => caseName === name).length !== 1) {
      throw new Error(`敏感组登记用例须存在且唯一：${name}`)
    }
  }
  const filter = options.filter
  const parts = filter?.split(',').map((part) => part.trim()).filter(Boolean) ?? []
  const filtered = filter ? cases.filter(([name]) => parts.some((part) => name.includes(part))) : cases
  if (filter && (!parts.length || !filtered.length)) {
    throw new Error(`VSIDIAN_TEST_CASES 未命中用例：${JSON.stringify(filter)}`)
  }
  // 先固定既有筛选结果的位置，再排除另一组。移出用例不改变后续分片归属。
  let indexed = filtered.map((entry, index) => ({ entry, index }))
  if (group === 'core') indexed = indexed.filter(({ entry: [name] }) => !sensitiveNames.has(name))
  if (group === 'sensitive') indexed = indexed.filter(({ entry: [name] }) => sensitiveNames.has(name))
  if (filter && !indexed.length) {
    throw new Error(`VSIDIAN_TEST_CASES 未命中 ${group} 组用例：${JSON.stringify(filter)}`)
  }
  let shardLabel = ''
  if (options.shard) {
    const match = /^(\d+)\/(\d+)$/.exec(options.shard)
    if (!match) throw new Error(`VSIDIAN_TEST_SHARD 形如 k/N，收到 ${JSON.stringify(options.shard)}`)
    const shard = Number(match[1])
    const total = Number(match[2])
    if (total < 1 || shard < 1 || shard > total) throw new Error(`VSIDIAN_TEST_SHARD 越界：${options.shard}`)
    indexed = indexed.filter(({ index }) => index % total === shard - 1)
    shardLabel = `（分片 ${shard}/${total}，本片 ${indexed.length} 项）`
  }
  const selected = indexed.map(({ entry }) => entry)
  return { selected, group, shardLabel }
}
