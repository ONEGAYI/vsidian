// #366 T17 附加组件 Remote SSH 同宿主安装、资源与排障——SSH 装配库。
//
// 在真实 Remote SSH 工作区（远端=本机回环 sshd，链路真实走 SSH——资源
// URI、webview 装载、扩展宿主都是真路径）驱动 VSCode 1.82.3 测试宿主：
// Remote-SSH 0.106.1（engine ^1.82.0-insider，1.82.3 stable 兼容；0.107+
// engine 已抬至 ^1.84 不可用）装进隔离 profile，宿主以 --remote
// ssh-remote+<host> 启动，extensionTestsPath 在远端扩展宿主执行。
//
// 本文件分两层：
// - 纯逻辑（单测 test/integration/t17RemoteSsh.test.mjs 覆盖）：profile
//   预置设置、--remote 参数拼装、marketplace 下载 URL、阶段标记文件；
// - 副作用（启动器调用）：marketplace 下载+解压 Remote-SSH VSIX、CLI
//   安装进隔离 profile。
//
// 探针实证（out/test/t17-probe2-*.log，2026-10-08）：
// - sshd 运行中 + BatchMode 免密 `ssh localhost` 直连可用是前提；
// - 首连会经 VSCode 标准行为在远端用户目录建 ~/.vscode-server（非本
//   库改动的用户配置——Remote-SSH 的远端会话产物目录）；
// - 缺 remote.SSH.remotePlatform.<host> 时 resolver 弹平台选择 QuickPick
//   （ignoreFocusOut:true 永不超时），无人值守会话挂死——profile 必须预置；
// - 缺 remote.SSH.confirmFingerprint=false 时首连指纹确认同样挂起。
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 与 1.82.3 兼容的 Remote-SSH 版本（engine ^1.82.0-insider；更高版引擎抬高不可装） */
export const REMOTE_SSH_COMPAT_VERSION = '0.106.1'

/** marketplace 历史版本端点：该 URL 返回 gzip 压缩的 VSIX 内容（需解压） */
export function remoteSshMarketplaceUrl(version) {
  return `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/${version}/vspackage`
}

/** T17 SSH 阶段矩阵（远端会话用例经标记文件选择执行）
 * - R1 全装载：主 VSIX 安装解压目录 + 三样例解压目录 + 两负向夹具经
 *   --extensionDevelopmentPath 进同一远端扩展宿主——远端语义（remoteName/
 *   工作区 vscode-remote scheme）、页面资源（渲染接管/输入行为/界面命令）、
 *   双端 API、设置保存、卸载释放与手动恢复、负向夹具状态如实呈现；
 * - R2 宿主不可见负向：同 R1 装配但 --disable-extension 禁用一个样例——
 *   「当前宿主查不到」不冒充「未安装/装错侧」（host-unavailable 不归因
 *   口径的远端实证：不可见样例不在 vscode.extensions.all，也不因查不到
 *   而对其余可见组件的安装状态做任何断言扩张）。 */
export const T17_SSH_PHASES = ['R1', 'R2']

/** T17 SSH 用例的名称子串（VSIDIAN_TEST_CASES 定向筛选） */
export const T17_SSH_CASE_FILTER = '附加组件 T17'

/** 阶段标记文件名（工作区根内、点前缀——扫描器忽略点文件） */
export const T17_SSH_PHASE_MARKER_NAME = '.vsidian-t17-ssh.json'

/**
 * 纯逻辑：Remote-SSH 隔离 profile 必须预置的 settings 内容。
 * 探针实证（见模块头）：两项缺失都会让无人值守首连挂死。
 */
export function remoteSshProfileSettings({ host, platform }) {
  if (typeof host !== 'string' || host === '') {
    throw new Error(`SSH 主机名必须非空：${JSON.stringify(host)}`)
  }
  const knownPlatforms = ['windows', 'linux', 'macos']
  if (!knownPlatforms.includes(platform)) {
    throw new Error(`远端平台须为 ${knownPlatforms.join('/')}，收到 ${JSON.stringify(platform)}`)
  }
  return {
    'remote.SSH.confirmFingerprint': false,
    'remote.SSH.remotePlatform': { [host]: platform },
  }
}

/** 纯逻辑：remote authority 形态（--remote 参数值） */
export function buildRemoteAuthority(host) {
  return `ssh-remote+${host}`
}

/**
 * 纯逻辑：在测试宿主参数表上拼装 --remote（workspace 参数保持在末位——
 * `--remote <authority> <folder>` 的 CLI 语法约定；buildTestHostArgs 产出的
 * 参数表以 workspace 路径收尾）。
 */
export function withRemoteArg(args, host) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('withRemoteArg 需要非空参数表（末位应为 workspace 路径）')
  }
  const authority = buildRemoteAuthority(host)
  return [...args.slice(0, -1), '--remote', authority, args[args.length - 1]]
}

/** 纯逻辑 + 文件 IO：写阶段标记（远端 ext host 不继承本地 env——阶段变量
 * 与用例筛选经工作区文件传递；caseFilter 供 suite 入口的兜底通道
 * sshMarkerCaseFilter 消费。写失败抛错不静默） */
export function writeSshPhaseMarker(wsDir, phase, caseFilter) {
  if (!T17_SSH_PHASES.includes(phase)) {
    throw new Error(`未知 T17 SSH 阶段：${JSON.stringify(phase)}（可选 ${T17_SSH_PHASES.join('/')}）`)
  }
  if (caseFilter !== undefined && (typeof caseFilter !== 'string' || caseFilter === '')) {
    throw new Error(`caseFilter 须为非空字符串或省略：${JSON.stringify(caseFilter)}`)
  }
  writeFileSync(
    path.join(wsDir, T17_SSH_PHASE_MARKER_NAME),
    `${JSON.stringify({ phase, ...(caseFilter !== undefined ? { caseFilter } : {}) })}\n`,
    'utf8',
  )
}

/** 纯逻辑 + 文件 IO：读阶段标记（缺席/损坏返回 null——非 SSH 会话与缺标记
 * 同为「不执行 T17 用例」，损坏不冒充任何阶段） */
export function readSshPhaseMarker(wsDir) {
  try {
    const raw = readFileSync(path.join(wsDir, T17_SSH_PHASE_MARKER_NAME), 'utf8')
    const parsed = JSON.parse(raw)
    return T17_SSH_PHASES.includes(parsed?.phase) ? parsed.phase : null
  } catch {
    return null
  }
}

// ---- 远端清单镜像（T17 架构事实的承载，见模块头「通道边界」） ----

/**
 * 纯逻辑：把本地安装清单条目合并进远端清单。管辖集语义（governedIds 是
 * T17 全部被测 id）：管辖内的远端去留完全由本次 includeIds 决定（include
 * → 以本地条目替换或追加；管辖但不 include → 从远端删除——R2 不可见负向
 * 由此清除先前阶段镜像的条目）；管辖外的远端条目原样保留（远端自带条目
 * 不动）。背景：1.82.3 的 extension tests runner 挂在本地 ext host，
 * workspace 类扩展装载在远端 ext host——远端装载经远端扩展服务的权威
 * 清单（~/.vscode-server/extensions/extensions.json）。本地 CLI 真实安装
 * （--install-extension 产出权威条目与解压目录）后，把条目镜像进远端
 * 清单即完成远端装载装配（localhost 回环下解压目录两址同盘，location
 * 无需改写）；装载与运行仍走远端扩展服务全链路（激活/exports/命令注册
 * 都在远端真实发生）。 */
export function mergeRemoteExtensionEntries(remoteEntries, localEntries, includeIds, governedIds) {
  if (!Array.isArray(remoteEntries) || !Array.isArray(localEntries) || !Array.isArray(includeIds) || !Array.isArray(governedIds)) {
    throw new Error('mergeRemoteExtensionEntries 需要四个数组参数（远端清单/本地清单/镜像 id 集/管辖 id 集）')
  }
  const include = new Set(includeIds.map((id) => id.toLowerCase()))
  const governed = new Set(governedIds.map((id) => id.toLowerCase()))
  for (const id of include) {
    if (!governed.has(id)) {
      throw new Error(`镜像 id 不在管辖集内：${id}（includeIds 必须是 governedIds 的子集）`)
    }
  }
  const merged = []
  const placed = new Set()
  for (const entry of remoteEntries) {
    const id = (entry?.identifier?.id ?? '').toLowerCase()
    if (governed.has(id)) {
      if (include.has(id)) {
        const local = localEntries.find((candidate) => (candidate?.identifier?.id ?? '').toLowerCase() === id)
        if (local) {
          merged.push(local)
          placed.add(id)
          continue
        }
        // include 命中但本地清单缺该条目：本地安装链不完整，报错不静默
        throw new Error(`镜像 id 在本地清单未命中：${id}`)
      }
      // 管辖但不 include：删除（负向阶段清除先前镜像）
      continue
    }
    merged.push(entry)
  }
  for (const entry of localEntries) {
    const id = (entry?.identifier?.id ?? '').toLowerCase()
    if (id && include.has(id) && !placed.has(id)) {
      merged.push(entry)
      placed.add(id)
    }
  }
  const missing = [...include].filter((id) => !placed.has(id))
  if (missing.length > 0) {
    throw new Error(`镜像 id 在本地清单未命中：${missing.join('、')}`)
  }
  return merged
}

/** 副作用：镜像本地安装到远端 server 扩展目录——解压目录真复制进
 * ~/.vscode-server/extensions/<relativeLocation>，extensions.json 条目的
 * location 重写为远端目录（远端扩展服务的扫描要求条目目录物理在场，
 * 指向外部目录的清单不被装载——实测）。includeIds ⊆ governedIds：缺席
 * 的管辖 id 从远端清单移除并删除其目录（R2 不可见负向的装配面），非
 * 管辖远端条目与目录不动。重复运行幂等（管辖目录先删后复制）。 */
export function mirrorExtensionsToRemoteServer({ serverExtensionsDir, localExtensionsDir, includeIds, governedIds, copyDir = cpSync, removeDir = rmSync }) {
  mkdirSync(serverExtensionsDir, { recursive: true })
  const remoteManifest = path.join(serverExtensionsDir, 'extensions.json')
  let remoteEntries = []
  try {
    remoteEntries = JSON.parse(readFileSync(remoteManifest, 'utf8'))
  } catch {
    remoteEntries = []
  }
  const localEntries = JSON.parse(readFileSync(path.join(localExtensionsDir, 'extensions.json'), 'utf8'))
  const merged = mergeRemoteExtensionEntries(remoteEntries, localEntries, includeIds, governedIds)
  // 管辖条目的目录差分：include 复制（location 重写为远端目录），管辖但
  // 不 include 删除远端目录（负向）
  const governedSet = new Set(governedIds.map((id) => id.toLowerCase()))
  const wantedDirs = new Set(merged
    .filter((entry) => governedSet.has((entry?.identifier?.id ?? '').toLowerCase()))
    .map((entry) => entry.relativeLocation))
  const presentDirs = new Set(readdirSync(serverExtensionsDir).filter((name) => name.includes('-') && !name.endsWith('.json') && !name.startsWith('.')))
  for (const name of presentDirs) {
    // 仅清理管辖形态的目录（id 前缀匹配 governed），其他（server 自带）不动
    const owner = governedIds.find((id) => name.toLowerCase().startsWith(`${id.toLowerCase()}-`))
    if (owner && !wantedDirs.has(name)) {
      removeDir(path.join(serverExtensionsDir, name), { recursive: true, force: true })
    }
  }
  for (const entry of merged) {
    const id = (entry?.identifier?.id ?? '').toLowerCase()
    if (!governedSet.has(id)) {
      continue
    }
    const source = path.join(localExtensionsDir, entry.relativeLocation)
    const target = path.join(serverExtensionsDir, entry.relativeLocation)
    if (!existsSync(source)) {
      throw new Error(`本地安装目录缺失：${source}`)
    }
    removeDir(target, { recursive: true, force: true })
    copyDir(source, target, { recursive: true })
    entry.location = { $mid: 1, path: `/${target.replace(/\\/g, '/')}`, scheme: 'file' }
  }
  writeFileSync(remoteManifest, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  return { mirrored: includeIds, total: merged.length }
}

// ---- 副作用层（启动器调用；单测不触达） ----

/**
 * 确保 Remote-SSH VSIX 在缓存目录在场（缺席则从 marketplace 下载
 * vspackage——gzip 或未压缩 VSIX 两种实测形态，按 magic 分流）。缓存以
 * zip magic 校验有效性——解压失败残留的 0 字节 .vsix 不再永久命中。
 * 网络与 marketplace 是外部依赖，失败抛错由启动者决定降级（票面：无
 * 真实 SSH 环境时记录外部阻塞）。
 * @param {{ cacheDir: string, version?: string, log?: (msg: string) => void }} input
 */
export async function ensureRemoteSshVsix({ cacheDir, version = REMOTE_SSH_COMPAT_VERSION, log = () => {} }) {
  const readHead = (file) => {
    try {
      return readFileSync(file).subarray(0, 4)
    } catch {
      return Buffer.alloc(0)
    }
  }
  mkdirSync(cacheDir, { recursive: true })
  const vsix = path.join(cacheDir, `remote-ssh-${version}.vsix`)
  if (remoteSshPayloadKind(readHead(vsix)) === 'zip') {
    return vsix
  }
  if (existsSync(vsix)) {
    log(`[T17] 缓存 ${path.basename(vsix)} 非 zip 形态（残留坏缓存），重新下载`)
    rmSync(vsix, { force: true })
  }
  const raw = path.join(cacheDir, `remote-ssh-${version}.vspackage`)
  log(`[T17] 下载 Remote-SSH ${version}（marketplace 历史版本端点）`)
  await downloadToFile(remoteSshMarketplaceUrl(version), raw)
  let code = 0
  try {
    const payload = readFileSync(raw)
    const kind = remoteSshPayloadKind(payload.subarray(0, 4))
    if (kind === 'gzip') {
      const result = await runCommand('python', ['-c', `import gzip,shutil,sys
with gzip.open(sys.argv[1],'rb') as fin, open(sys.argv[2],'wb') as fout:
    shutil.copyfileobj(fin,fout)`, raw, vsix], { capture: false })
      code = result.code
    } else if (kind === 'zip') {
      // 端点直接返回未压缩 VSIX（2026-10-08 T18 重跑实测形态）：改名即可用
      renameSync(raw, vsix)
    } else {
      throw new Error(`下载载荷形态未知（magic ${payload.subarray(0, 4).toString('hex')}，长度 ${payload.length}）——疑似半途下载或端点变更`)
    }
  } finally {
    rmSync(raw, { force: true })
  }
  if (code !== 0 || remoteSshPayloadKind(readHead(vsix)) !== 'zip') {
    throw new Error(`Remote-SSH VSIX 解压失败（退出码 ${code}）`)
  }
  return vsix
}

/**
 * marketplace vspackage 端点载荷形态判定（#367——端点行为漂移兼容）：
 * 同一 URL 实测返回两种形态——gzip 压缩的 vspackage（T17 实施时观测）
 * 或未压缩 VSIX（zip，PK magic；T18 重跑时观测）。按 magic 分流，避免
 * 把 zip 载荷喂给 gzip 解压器（BadGzipFile）。坏载荷（空/过短/未知
 * magic）判 'unknown' 由调用方按下载损坏处理。
 * @param {Buffer} buffer 下载内容（至少 4 字节可判）
 * @returns {'gzip' | 'zip' | 'unknown'}
 */
export function remoteSshPayloadKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return 'unknown'
  }
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return 'gzip'
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'zip'
  }
  return 'unknown'
}

/** 简单 HTTPS 下载（Node 内建 fetch；VSIX ~700KB，无需流式进度） */
async function downloadToFile(url, target) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status}：${url}`)
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

function runCommand(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1 }))
  })
}
