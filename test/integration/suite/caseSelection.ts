// 敏感组是有证据的临时归组，不表示已排除产品缺陷；完整名称精确匹配。
// 恢复强制检查时从此表移除，证据与处置边界见 integration-test-groups.md。
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'

export const SENSITIVE_CASES = [
  {
    name: 'PDF 导出（#621 T01）：固定输入、真实浏览器生成与本机保存（多页中文 PDF）',
    issue: '#621',
    reason: 'CI runner 上 spawn Edge/Chrome 冷启动与打印时长波动未建立稳定基线；本地全量持续跑，观察足够 run 后按既有退出条件回流 core。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」',
  },
  {
    name: 'PDF 导出（#622 T02）：完整装配、嵌入展开、缺资源选择与绘制证据',
    issue: '#622',
    reason: 'T01 同族真实浏览器链路（spawn/打印时长 + 127.0.0.1 资源服务时序），CI 波动基线未建立；本地全量持续跑，回流条件与 T01 同节。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T02 沿先例）',
  },
  {
    name: 'PDF 导出（#622 T02）：生成中取消释放与重复执行健康',
    issue: '#622',
    reason: '同族取消链路依赖真实浏览器进程生命周期，CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T02 沿先例）',
  },
  {
    name: 'PDF 导出（#624 T04）：批量执行、相对结构、同名更名与已打开未保存内容（真浏览器）',
    issue: '#624',
    reason: 'T01/T02 同族真实浏览器链路（每文件一次 spawn/打印，批内多次叠加时长波动），CI 波动基线未建立；本地全量持续跑，回流条件与 T01 同节。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T04 沿先例）',
  },
  {
    name: 'PDF 导出（#624 T04）：skip 保护已有文件与单项失败继续（真浏览器）',
    issue: '#624',
    reason: '同族批量真实浏览器链路，CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T04 沿先例）',
  },
  {
    name: 'PDF 导出（#624 T04）：缺资源 resume-all 与中途取消保留已完成（真浏览器）',
    issue: '#624',
    reason: '同族批量真实浏览器链路（含 awaiting-resources 交互时序），CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T04 沿先例）',
  },

  {
    name: 'PDF 导出（#623 T03）：多选区严格切片、顺序与资源同源的真浏览器产物',
    issue: '#623',
    reason: 'T01/T02 同族真实浏览器链路（spawn/打印时长 + 127.0.0.1 资源服务时序），CI 波动基线未建立；本地全量持续跑，回流条件与 T01 同节。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T03 沿先例）',
  },
  {
    name: 'PDF 导出（#623 T03）：选区导出取消释放与选区/源文不变式',
    issue: '#623',
    reason: '同族取消链路依赖真实浏览器进程生命周期，CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T03 沿先例）',
  },

  {
    name: 'PDF 导出（#625 T05）：横纵向/自定义纸张几何、页眉页脚与页码产物断言',
    issue: '#625',
    reason: 'T01/T02 同族真实浏览器链路（spawn/打印时长 + 书签后处理多一轮 target 定位），CI 波动基线未建立；本地全量持续跑，回流条件同节。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T05 沿先例）',
  },
  {
    name: 'PDF 导出（#625 T05）：标题书签结构、重复标题页码与中文标题',
    issue: '#625',
    reason: '书签链路含浏览器侧 pdfjs 定位 target 与 pdf-lib 后处理，CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T05 沿先例）',
  },
  {
    name: 'PDF 导出（#625 T05）：书签失败不给伪造（无标题文档零 outline）',
    issue: '#625',
    reason: '同族真实浏览器链路；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T05 沿先例）',
  },
  {
    name: 'PDF 导出（#625 T05）：持久默认参数回显（自有设置页键 → 模态预选）',
    issue: '#625',
    reason: '同族真实浏览器链路（含固定输入捕获与浏览器发现前置）；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T05 沿先例）',
  },
  {
    name: 'PDF 导出（#626 T06）：三篇合并、分篇书签与页码总页数（真浏览器）',
    issue: '#626',
    reason: 'T01–T05 同族真实浏览器链路（单会话多篇装配 + 书签按篇定位后处理），CI 波动基线未建立；本地全量持续跑，回流条件同节。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T06 沿先例）',
  },
  {
    name: 'PDF 导出（#626 T06）：每篇另起一页关闭连续排版与样式不跨篇（真浏览器）',
    issue: '#626',
    reason: '同族真实浏览器链路（连续排版形态 + 文档样式按篇归属的字号几何断言）；CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T06 沿先例）',
  },
  {
    name: 'PDF 导出（#626 T06）：合并失败/取消无伪成功与缺资源继续（真浏览器）',
    issue: '#626',
    reason: '同族取消/失败链路依赖真实浏览器进程生命周期与 awaiting-resources 交互时序；CI 波动基线未建立；本地全量持续跑。',
    evidence: 'docs/specs/integration-test-groups.md「PDF 导出（#621 T01）」同节（T06 沿先例）',
  },
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
    name: '附加组件 T07：调序与单项关闭即时生效、joinPrevious 并组撤回与重载恢复，#356',
    issue: '#356',
    reason: '近 30 个 CI run 中 6 次失败（约 20%），跨 shard 2/3/4 分布、本地单跑稳定通过——CI 环境时序敏感，根因未定。',
    evidence: 'https://github.com/ONEGAYI/vsidian/actions/runs/37724661505',
  },
  {
    name: '附加组件 T15：渲染样例停用降级、故障恢复与自处理缺陷对照（#364）',
    issue: '#364',
    reason: '近 30 个 CI run 中 6 次失败（约 20%），mermaid 容器绘制等待超时、本地单跑稳定通过——CI 环境时序敏感，根因未定。',
    evidence: 'https://github.com/ONEGAYI/vsidian/actions/runs/37724661505',
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
