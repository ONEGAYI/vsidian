// 浏览器测试分组（2026-10-14，仿集成第五敏感组）：CI 的 browser job 改跑
// core（全量减敏感名单），新增独立非必需的 browser-sensitive job 只跑敏感
// 名单；本地默认（不设环境变量）仍是全量，回归习惯不变。
//
// 敏感名单是本模块的单一事实源，按套件名与 run.mjs 的 names 精确匹配；
// 每项的证据、跟踪票与移入/移出条件维护在 docs/specs/integration-test-groups.md
// 「浏览器测试分组」节（新增未定性失败跟踪在 #552，历史证据见 #446）。分组不修复产品行为、
// 不放宽断言、不自动重试；敏感组失败保留红灯与非零退出码，只是不阻断
// 必需检查。移回 core 须同提交多次 CI 验证，不因单次通过或失败自动迁移。
//
// 入选背景（PR #481 四次 CI attempt 的抖动证据，全部与当期改动零交集、
// 本地 Windows 全绿、main 基线同型挂红——#272 族在 browser job 的表现）：
// tableCaret 的 attempt 2/4 是隐藏态样式采样读空串（TIMEOUT=false），
// 控件重建后 Locator 句柄过期已补原子采样及回归；恢复 core 的候选须在
// 同一提交两轮 CI 通过后合并，证据见 #446 条目 9 与文档台账。
// - addonT10Commands：attempt 1 断言失败（10.3s）
// - addonRendererTakeover：attempt 3 断言失败（16.9s），与 #446 条目 5
//   的初始化等待超时同套件
// tableInput 的边沿 IME 等待已在 Linux 0.5CPU 三并发复现：度量回投覆盖
// keyup 前的原生落点；纯布局回投先接回原生选区，新增按住导航键期间重配的
// 回归。2026-10-30 用户要求恢复 core；候选合并前仍按同提交多轮 CI 口径核对。

/** 敏感名单（单一事实源；增删须同步文档台账、#552/#446 条目与契约测试钉住项） */
export const BROWSER_SENSITIVE_SUITES = ['addonT10Commands', 'addonRendererTakeover']

/**
 * 解析分组环境变量：缺省（未设或空串）为 'all'；只接受 all/core/sensitive，
 * 非法值立即抛错（对齐集成侧 runTest.mjs 的 VSIDIAN_TEST_GROUP 口径）。
 */
export function parseBrowserGroupEnv(value) {
  if (value === undefined || value === '') return 'all'
  if (value === 'all' || value === 'core' || value === 'sensitive') return value
  throw new Error(`[run] VSIDIAN_TEST_BROWSER_GROUP 须为 all/core/sensitive，收到 ${JSON.stringify(value)}`)
}

/**
 * 组别过滤：`allNames` 是 run.mjs 的全量清单（用于校验名单不漂移），
 * `requested` 是 `--suite` 已选定的子集（缺省即全量），`group` 为组别。
 * 结果 = 组别基集 ∩ requested，保持文档序；空集抛错（不静默跑空）。
 */
export function selectBrowserSuites(allNames, requested, group) {
  const missing = BROWSER_SENSITIVE_SUITES.filter((name) => !allNames.includes(name))
  if (missing.length > 0) {
    throw new Error(`[run] 敏感名单引用了未知套件: ${missing.join(',')}（名单与 run.mjs 的 names 失配，须显式维护）`)
  }
  let base
  if (group === 'sensitive') base = allNames.filter((name) => BROWSER_SENSITIVE_SUITES.includes(name))
  else if (group === 'core') base = allNames.filter((name) => !BROWSER_SENSITIVE_SUITES.includes(name))
  else base = allNames
  const selected = requested.filter((name) => base.includes(name))
  if (selected.length === 0) {
    throw new Error(`[run] 当前组 ${group} 与定向套件的交集为空（${JSON.stringify(requested)}）`)
  }
  return selected
}
