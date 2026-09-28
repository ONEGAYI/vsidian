// 根内相对路径目标解析（工单 #196，父规格 #194「路径与范围」）：
// 双链与普通链接/图片共用的**纯逻辑**解析核心——目标一律按来源文档目录
// （docDir）相对解析，越出来源所属根（rootDir）不得解析。
//
// 取代旧 ADR-0002 的按需查找范围（basename 全根搜索 / 文档相对+根相对
// 双候选 / 同名 QuickPick 选择，详见 ADR-0008）：
// - [[设计]] = docDir/设计(.md)：同目录短名；子目录或其他根的同名文件
//   不命中（多根互不补查，嵌套根按文档实际所属的最具体根划界）
// - [[项目甲/设计]] 明确子路径；[[../设计]] 允许根内上行；[[../../x]]
//   越出所属根 → escape
// - 扩展名语义：显式扩展名（.md/.pdf/.png…）单候选精确解析；无扩展名
//   且 implicitMd（双链与文档链接语义）时候选为 [精确路径, 精确路径.md]
//   ——不产生 x.pdf.md
// - 分隔符与平台语义：Windows 宿主把反斜杠当分隔符并归一为 /；POSIX
//   宿主上反斜杠是普通文件名字符（远程语义不转换）。两类语义由注入的
//   isWindowsHost 描述，与运行进程平台无关
// - 大小写语义**由存在性端口的宿主文件系统裁决**（vscode 层 fs.stat：
//   Windows 本地 NTFS 不敏感、远程 POSIX 严格——与真实宿主一致，模块
//   不做折叠，不引入第二套大小写语义）
//
// 分层（「路径解析和权限校验分离」）：本模块只做路径计算与判别，不做
// IO——存在性经 exists 端口注入（vscode 层传 fs.stat 适配；#197 引用
// 索引可换传索引查询，#199/#200 重命名规划共用同一解析器，不建重复
// 实现）。本模块不依赖 vscode/DOM（node 单测直驱）。
import * as path from 'node:path'

/** 路径解析上下文（宿主文件系统语义由注入方描述） */
export interface VaultLinkPathContext {
  /** 来源文档所在目录（绝对 fsPath，宿主平台分隔符） */
  docDir: string
  /** 来源文档所属根的绝对 fsPath（嵌套根取最具体根；无工作区时为文档目录） */
  rootDir: string
  /** 宿主文件系统是否 Windows 语义（本地 Windows 为 true；远程一律 false） */
  isWindowsHost: boolean
}

/** 候选规划选项 */
export interface VaultLinkPlanOptions {
  /**
   * 无扩展名目标是否补 `.md` 候选（精确路径优先、`.md` 其次）。
   * 双链与普通文档链接为 true（省略扩展名默认 Markdown）；图片等
   * 二进制目标为 false（显式扩展名单候选，不补）。
   * @default true
   */
  implicitMd?: boolean
}

/** 路径规划结果（纯路径计算，无 IO） */
export type VaultLinkPathPlan =
  | { kind: 'inside'; /** 按优先序的候选绝对 fsPath */ candidates: string[] }
  | { kind: 'escape'; /** 越界时的目标原文 */ detail: string }

/** 存在性探测端口：返回目标**真实路径**（存在；Windows 宿主须做大小写
 *  归正——文件系统不敏感命中后取磁盘真实大小写形态，避免以注入形态
 *  建立 URI 与真实面板/文档身份漂移）或 null（不存在/非普通文件）。
 *  vscode 层传 fs 适配（stat + readDirectory 归正）；#197 索引可换传
 *  索引查询（索引持有真实磁盘路径，直接返回即可） */
export type VaultLinkExistsPort = (fsPath: string) => string | null | Promise<string | null>

/** 存在性解析上下文（跳转链路用：含无工作区判定） */
export interface VaultLinkResolveContext extends VaultLinkPathContext {
  /** 来源文档是否属于某个工作区文件夹（未打开文件夹时为 false——双链不猜测目标） */
  hasWorkspace: boolean
}

/** 存在性解析结果（vscode 层按 kind 分派：打开/提示） */
export type VaultLinkFileResolution =
  | { kind: 'target'; fsPath: string }
  | { kind: 'not-found' }
  | { kind: 'escape'; detail: string }
  | { kind: 'no-workspace' }

/** 按注入语义选择路径实现：Windows/POSIX 分类不得依赖运行进程的平台
 *  （在 Windows 上跑单测也必须能验 POSIX 远程语义，反之亦然） */
function pathOps(ctx: VaultLinkPathContext) {
  return ctx.isWindowsHost ? path.win32 : path.posix
}

/** absolute 是否位于 root 内（含 root 本身）。`..foo.md` 是同级合法
 *  文件名，粗判 startsWith('..') 会误判越界——须用 relative 精确判定 */
function isInsideRoot(
  absolute: string,
  rootDir: string,
  ops: ReturnType<typeof pathOps>,
): boolean {
  const rel = ops.relative(rootDir, absolute)
  if (rel === '') {
    return true
  }
  return rel !== '..' && !rel.startsWith(`..${ops.sep}`) && !ops.isAbsolute(rel)
}

/**
 * 规划根内相对目标的候选绝对路径（纯路径计算，无 IO）。
 *
 * 输入 rawPath 为**已解码**的路径文本（percent-decode、fragment/query
 * 剥除由调用方完成——双链形态学 path 部分原样、普通链接先容错解码）；
 * 本函数负责 trim、分隔符归一（仅 Windows 宿主）、docDir 基准拼接、
 * 越界判别与扩展名候选。
 *
 * 空路径与越出 rootDir 一律 escape（无可定位目标，与 #10 普通链接的
 * blocked(escape) 同口径）。
 */
export function planVaultLinkPath(
  rawPath: string,
  ctx: VaultLinkPathContext,
  options: VaultLinkPlanOptions = {},
): VaultLinkPathPlan {
  const implicitMd = options.implicitMd ?? true
  // 分隔符归一：Windows 宿主把反斜杠当分隔符（与 #10 一致）；POSIX 宿主上
  // 反斜杠是普通文件名字符（远程语义不转换）
  const p = (ctx.isWindowsHost ? rawPath.replace(/\\/g, '/') : rawPath).trim()
  if (p === '') {
    return { kind: 'escape', detail: rawPath }
  }
  const ops = pathOps(ctx)
  const base = ops.resolve(ctx.docDir, p)
  if (!isInsideRoot(base, ctx.rootDir, ops)) {
    return { kind: 'escape', detail: rawPath }
  }
  const candidates = ops.extname(base) ? [base] : implicitMd ? [base, `${base}.md`] : [base]
  return { kind: 'inside', candidates }
}

/**
 * 解析根内相对目标的文件存在性（跳转链路入口）。
 *
 * 无工作区 → no-workspace（不猜测目标，维持双链既有边界）；空目标 →
 * not-found（双链本文件锚点在形态学层已分流，此处防御）；其余经
 * {@link planVaultLinkPath} 规划候选后按优先序探测，取首个存在者的
 * **真实路径**（端口归正后形态）作为 target。
 * 大小写语义由 exists 端口的宿主文件系统裁决（见模块头注释）。
 */
export async function resolveVaultLinkFile(
  rawPath: string,
  ctx: VaultLinkResolveContext,
  exists: VaultLinkExistsPort,
  options?: VaultLinkPlanOptions,
): Promise<VaultLinkFileResolution> {
  if (!ctx.hasWorkspace) {
    return { kind: 'no-workspace' }
  }
  if (rawPath.trim() === '') {
    return { kind: 'not-found' }
  }
  const plan = planVaultLinkPath(rawPath, ctx, options)
  if (plan.kind === 'escape') {
    return { kind: 'escape', detail: plan.detail }
  }
  for (const candidate of plan.candidates) {
    const realPath = await exists(candidate)
    if (realPath !== null) {
      return { kind: 'target', fsPath: realPath }
    }
  }
  return { kind: 'not-found' }
}
