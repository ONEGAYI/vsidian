// #535 T08 安装态组件对照与升级路径——阶段装配与 bridge VSIX 审计纯逻辑。
// 副作用启动器 runInstalledCodexBridge.mjs 消费本模块；单测钉契约
// t08CodexBridge.test.mjs。阶段矩阵：
// - legacy：装 v1.1.0 旧主 VSIX（真实旧物）——旧枚举 codex 在旧版语义内
//   合法可保存，建立「升级前状态真实成立」的基线；
// - upgraded：--force 同版本覆盖为本分支主 VSIX + bridge VSIX 同装——
//   迁移语义（旧键残留 → 回落 default + 一次性引导 + 不覆盖组件选择）
//   与组件对照（Codex 主题登记/选路渲染/停用回落/恢复）。
// 注：1.82.3 测试宿主的 storage 完全 in-memory（T16 D/E 票面实证，写入/
// 预置均不落盘也不读盘），legacy 阶段写入的 globalState 无法跨会话带到
// upgraded 阶段——升级残留以 _test.injectCodexLegacyOverlay 直写原始
// overlay 承载（模拟磁盘上的旧键残留），取舍记录于票面与规格 §10。

export const T08_PHASES = ['legacy', 'upgraded']

/** T08 安装态用例的名称子串（VSIDIAN_TEST_CASES 定向筛选） */
export const T08_CASE_FILTER = 'T08 安装态'

/** bridge VSIX 必含产物（宿主入口 + 页面模块 + mermaid 独立产物） */
const BRIDGE_REQUIRED_ENTRIES = [
  'extension/package.json',
  'extension/dist/extension.js',
  'extension/dist/editor.js',
  'extension/dist/mermaid.js',
]

/** bridge VSIX 中不得出现的目录前缀（外部产物装前结构审计） */
const BRIDGE_FORBIDDEN_PREFIXES = [
  'extension/src/',
  'extension/test/',
  'extension/node_modules/',
]

/** bridge VSIX 条目审计（返回违规描述数组；空 = 通过） */
export function auditBridgeVsixEntries(entries) {
  const violations = []
  for (const required of BRIDGE_REQUIRED_ENTRIES) {
    if (!entries.includes(required)) {
      violations.push(`缺少必需产物：${required}`)
    }
  }
  const hasChunk = entries.some((entry) =>
    /^extension\/dist\/mermaid-chunks\/[\w.-]+\.js$/.test(entry))
  if (!hasChunk) {
    violations.push('缺少 mermaid-chunks 分块产物（至少一枚散列 JS）')
  }
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    if (BRIDGE_FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      violations.push(`不允许的夹带条目：${entry}`)
    }
  }
  return violations
}

/**
 * T08 阶段宿主 env 拼装（覆盖层；经 applyPhaseEnv 应用到继承 env）。
 * hooks=false 时返回 VSIDIAN_TEST_HOOKS 删除标记（发行态会话）。
 */
export function t08PhaseHostEnv(phase, { hooks }) {
  if (!T08_PHASES.includes(phase)) {
    throw new Error(`未知 T08 阶段：${phase}（可选 ${T08_PHASES.join('/')}）`)
  }
  const env = {
    VSIDIAN_T08_PHASE: phase,
    VSIDIAN_TEST_CASES: T08_CASE_FILTER,
  }
  if (hooks) {
    env.VSIDIAN_TEST_HOOKS = '1'
  } else {
    env['!delete'] = ['VSIDIAN_TEST_HOOKS']
  }
  return env
}
