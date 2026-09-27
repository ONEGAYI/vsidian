// CSS 片段环境身份（#131）：本地与 Remote SSH 环境的身份推导与存储桶戳。
// 不依赖 vscode / DOM（宿主注入 vscode.env 读值），供宿主服务与测试共用。
//
// 设计决策（完整证据链见 docs/adr/0007-css-snippet-env-isolation.md）：
// - 隔离的权威机制是 globalState 按扩展宿主机器持久：本地窗口的宿主在
//   本地（状态存本地用户目录），Remote SSH 窗口的工作区扩展宿主在远端
//   （状态存远端 ~/.vscode-server）——两份存储物理隔离，「远程配置不覆盖
//   本地」由架构保证。本模块的桶戳是这层之上的防御：万一同一 db 被复制
//   或同步到另一环境（仓库从不调用 globalState.setKeysForSync，Settings
//   Sync 不会带走本键；此处只防手工搬运），读取侧按 stamp 过滤，异桶
//   视为未配置且不回写清空。
// - vscode.env.remoteName（1.86.0 事实核查）：本地（无远程扩展宿主）为
//   undefined；SSH 远程为 'ssh-remote'——是远端类型名，不含机器名，不能
//   单独区分两台不同远程主机。
// - vscode.env.machineId：扩展宿主所在机器的唯一标识（远程宿主即远程
//   机器）；禁用遥测时可能为占位值，此时远程侧多机器退化为同桶
//   （'remote:<name>:unknown'）——记录在案的降级，不影响权威隔离层。
import { sanitizeStoredCssSnippets, type StoredCssSnippetState } from './cssSnippets'

/** 身份来源（宿主层从 vscode.env 读取后注入；测试可模拟 remoteName） */
export interface CssSnippetEnvSource {
  remoteName: string | undefined
  machineId: string | undefined
}

/** 推导结果（观测与诊断面） */
export interface CssSnippetEnvIdentity {
  scope: 'local' | 'remote'
  /** 远端类型名（如 'ssh-remote'）；本地为 null */
  remoteName: string | null
  /** 宿主机器 id；不可得为 null */
  machineId: string | null
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 环境身份推导：remoteName 缺省/空串为本地；machineId 可缺失（降级） */
export function cssSnippetEnvIdentity(source: CssSnippetEnvSource): CssSnippetEnvIdentity {
  const remoteName =
    typeof source.remoteName === 'string' && source.remoteName.length > 0
      ? source.remoteName
      : null
  const machineId =
    typeof source.machineId === 'string' && source.machineId.length > 0
      ? source.machineId
      : null
  return {
    scope: remoteName === null ? 'local' : 'remote',
    remoteName,
    machineId,
  }
}

/**
 * 存储桶戳：本地恒为 'local'；远程为 'remote:<类型名>:<机器id>'。
 * 同一宿主机器的多个窗口（同 db、同 machineId）得到同戳——同环境跨项目/
 * 跨窗口共享一桶；不同远程机器异戳。machineId 不可得时远程侧降级为
 * 'remote:<名>:unknown'。
 */
export function cssSnippetEnvStamp(source: CssSnippetEnvSource): string {
  const identity = cssSnippetEnvIdentity(source)
  if (identity.scope === 'local') {
    return 'local'
  }
  return `remote:${identity.remoteName}:${identity.machineId ?? 'unknown'}`
}

/**
 * 分桶读取：持久层原始值 × 当前环境戳 → 本环境可见的存储形态。
 * - 无 stamp（含空串）的 #128 存量：采用当前环境（升级不清空已配置目录）；
 * - stamp 与当前环境不匹配：视为未配置（返回默认形态），调用方不回写——
 *   异桶数据原样保留在持久层，等待其归属环境读取；
 * - 同桶：走存量清洗（#128 语义不变，含 #131 paused 字段）。
 */
export function readStoredCssSnippetBucket(
  raw: unknown,
  currentStamp: string,
): StoredCssSnippetState {
  if (isObject(raw)) {
    const stamp = raw.envStamp
    if (typeof stamp === 'string' && stamp.length > 0 && stamp !== currentStamp) {
      return { directory: null, enabled: {}, paused: false }
    }
  }
  return sanitizeStoredCssSnippets(raw)
}
