// 双链与普通链接/图片**共用的纯逻辑**解析核心：目标先按来源文档目录
// （docDir）相对解析、越出来源所属根（rootDir）不得解析（工单 #196，
// ADR-0008）；#556（ADR-0018）增补两条语义——**显式绝对路径**独立解析
// 与**根内短名补查**。
//
// 显式绝对路径（#556）：Windows 宿主盘符形态（X:/…、X:\…，反斜杠先
// 归一）与 POSIX 宿主根路径（/…）规划为 absolute——不接 docDir、不受
// rootDir 边界、不做短名补查、无工作区也独立解析（允许跨根与工作区外
// 目标，按宿主文件系统解释）。UNC 形态不在此列（越出本地根即 escape，
// UNC 根内目标照常 inside）；POSIX 宿主上的盘符形态是普通文件名字符
// （远程语义不转换；跨宿主盘符的拦截在 linkTarget 层）。
//
// 根内短名补查（#556）：相对候选全未命中且路径仅含文件名（归一后无
// 分隔符）时，经注入端口查来源所属根内未被排除的唯一同名 Markdown——
// 相对候选优先（同目录命中不打扰补查）；补查仅面向 Markdown 语义
// （显式 .md 或省略扩展名的双链/文档链接），非 Markdown 不跨目录补查。
// 多候选 ambiguous（不归任一候选）、唯一但清单不完整 pending（不声明
// 唯一）。端口不注入则补查不存在（解析行为与无补查语义一致）。
//
// 取代旧 ADR-0002 的按需查找范围（basename 全根搜索 / 文档相对+根相对
// 双候选 / 同名 QuickPick 选择，详见 ADR-0008）：
// - [[设计]] = docDir/设计(.md)：同目录短名优先，未命中经补查端口查
//   所属根内唯一同名 Markdown（多根互不补查，嵌套根按文档实际所属的
//   最具体根划界——补查范围即最具体根）
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
// 实现；#556 短名补查经 lookupShortname 端口注入，跳转/悬停传索引查询
// 端口、索引侧传 catalog 查询——实现在一处，各消费方注入）。本模块
// 不依赖 vscode/DOM（node 单测直驱）。
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
  | {
      /** 显式绝对路径（#556）：Windows 宿主盘符形态 / POSIX 宿主根路径——
       *  不接 docDir、不受 rootDir 边界（允许跨根与工作区外目标） */
      kind: 'absolute'
      /** 按优先序的候选绝对 fsPath（扩展名规则与 inside 一致） */
      candidates: string[]
    }
  | { kind: 'escape'; /** 越界时的目标原文 */ detail: string }

/** 存在性探测端口：返回目标**真实路径**（存在；Windows 宿主须做大小写
 *  归正——文件系统不敏感命中后取磁盘真实大小写形态，避免以注入形态
 *  建立 URI 与真实面板/文档身份漂移）或 null（不存在/非普通文件）。
 *  vscode 层传 fs 适配（stat + readDirectory 归正）；#197 索引可换传
 *  索引查询（索引持有真实磁盘路径，直接返回即可） */
export type VaultLinkExistsPort = (fsPath: string) => string | null | Promise<string | null>

/** 存在性解析上下文（跳转链路用：含无工作区判定） */
export interface VaultLinkResolveContext extends VaultLinkPathContext {
  /** 来源文档是否属于某个工作区文件夹（未打开文件夹时为 false——双链不猜测目标；
   *  显式绝对路径不受此限：无工作区也独立解析） */
  hasWorkspace: boolean
}

/** 短名补查端口结果（#556）：candidates 为命中目标的磁盘真实路径形态
 *  （端口持有真实身份，resolve 不做二次探测）；complete 表示端口的文件
 *  清单是否完整——不完整时唯一候选不得声明唯一（pending）。 */
export interface VaultLinkShortnameLookupResult {
  candidates: string[]
  complete: boolean
}

/** 短名补查端口（#556）：按完整 basename（含扩展名）查来源所属根内未被
 *  排除的 Markdown。零 IO 原则的延续——端口由消费方注入（跳转/悬停传
 *  索引查询，索引侧传 catalog 查询；**禁止点击时全库 fs 扫描**）。 */
export type VaultLinkShortnamePort = (
  basename: string,
) => VaultLinkShortnameLookupResult | Promise<VaultLinkShortnameLookupResult>

/** 存在性解析结果（vscode 层按 kind 分派：打开/提示） */
export type VaultLinkFileResolution =
  | { kind: 'target'; fsPath: string }
  | { kind: 'not-found' }
  | { kind: 'escape'; detail: string }
  | { kind: 'no-workspace' }
  | {
      /** 多个同名候选（#556）：不归任一候选，消费方提示补路径 */
      kind: 'ambiguous'
      /** 端口给定的候选磁盘真实路径（提示补路径用，不猜目标） */
      candidates: string[]
    }
  | {
      /** 清单未完整且只发现一个候选（#556）：不声明唯一，显示更新中状态 */
      kind: 'pending'
    }

/** 按注入语义选择路径实现：Windows/POSIX 分类不得依赖运行进程的平台
 *  （在 Windows 上跑单测也必须能验 POSIX 远程语义，反之亦然） */
function pathOps(ctx: VaultLinkPathContext) {
  return ctx.isWindowsHost ? path.win32 : path.posix
}

/** Windows 盘符绝对路径（归一后 `X:/…` 形态）。`X:` 后必须跟分隔符——
 *  裸 `X:` 前缀（如 `d:目标`）是「盘内当前目录相对」的 Win32 怪语义，
 *  不按绝对处理，维持相对解析口径 */
const WINDOWS_DRIVE_ABSOLUTE_RE = /^[a-zA-Z]:\//

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
 * 判定绝对路径是否位于根内（ADR-0008 边界的独立复用入口）：非绝对路径
 * 一律不在根内（不可信形态不做 cwd 依赖解析——`path.relative` 会把相对
 * 输入按 process.cwd() 补全，cwd 恰在根内时会误放行）。供 host 侧对
 * **前端直供的绝对路径身份**做静态边界复核（#221 directTarget，P1-1
 * review 修复）：文本解析路径经 planVaultLinkPath 规划天然带界，直供
 * 身份必须显式过同一根内语义。
 */
export function isVaultPathInsideRoot(absolute: string, ctx: VaultLinkPathContext): boolean {
  const ops = pathOps(ctx)
  if (!ops.isAbsolute(absolute)) {
    return false
  }
  return isInsideRoot(absolute, ctx.rootDir, ops)
}

/** 扩展名候选（absolute 与 inside 同一规则）：显式扩展名单候选精确
 *  解析；无扩展名且 implicitMd 时候选 [精确, 精确.md]（不产生 x.pdf.md） */
function candidatesOf(
  base: string,
  ops: ReturnType<typeof pathOps>,
  implicitMd: boolean,
): string[] {
  return ops.extname(base) ? [base] : implicitMd ? [base, `${base}.md`] : [base]
}

/**
 * 规划目标的候选绝对路径（纯路径计算，无 IO）。
 *
 * 输入 rawPath 为**已解码**的路径文本（percent-decode、fragment/query
 * 剥除由调用方完成——双链形态学 path 部分原样、普通链接先容错解码）；
 * 本函数负责 trim、分隔符归一（仅 Windows 宿主）、docDir 基准拼接、
 * 越界判别与扩展名候选。
 *
 * 显式绝对路径（#556）：Windows 宿主盘符形态与 POSIX 宿主根路径归
 * absolute——不接 docDir、不受 rootDir 边界（扩展名候选规则与 inside
 * 一致）。UNC 形态不属此类（越出本地根 escape、UNC 根内照常 inside）；
 * 空路径与越出 rootDir 的相对路径一律 escape（无可定位目标，与 #10
 * 普通链接的 blocked(escape) 同口径）。
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
  if (ctx.isWindowsHost ? WINDOWS_DRIVE_ABSOLUTE_RE.test(p) : p.startsWith('/')) {
    return { kind: 'absolute', candidates: candidatesOf(ops.resolve(p), ops, implicitMd) }
  }
  const base = ops.resolve(ctx.docDir, p)
  if (!isInsideRoot(base, ctx.rootDir, ops)) {
    return { kind: 'escape', detail: rawPath }
  }
  return { kind: 'inside', candidates: candidatesOf(base, ops, implicitMd) }
}

/**
 * 解析目标的文件存在性（跳转链路入口）。
 *
 * 显式绝对路径（#556）先于一切判定独立解析——无工作区也成立，候选按
 * 优先序探测取首个存在者的真实路径；绝对路径不做短名补查。
 *
 * 相对目标：无工作区 → no-workspace（不猜测目标，维持双链既有边界）；
 * 空目标 → not-found（双链本文件锚点在形态学层已分流，此处防御）；其余
 * 经 {@link planVaultLinkPath} 规划候选后按优先序探测，取首个存在者的
 * **真实路径**（端口归正后形态）作为 target。
 *
 * 短名补查（#556）：inside 全候选未命中、路径仅含文件名（归一后无分隔
 * 符）且注入 lookupShortname 端口时，按完整 basename（无扩展名的双链
 * 语义补 `.md` 作查询键）查所属根内唯一同名 Markdown——0 候选 not-found、
 * 多候选 ambiguous、唯一但清单不完整 pending、唯一且完整 target（端口
 * 给定的磁盘真实形态，不做二次探测）。端口不注入时补查不存在。
 * 大小写语义由 exists 端口的宿主文件系统裁决（见模块头注释）。
 */
export async function resolveVaultLinkFile(
  rawPath: string,
  ctx: VaultLinkResolveContext,
  exists: VaultLinkExistsPort,
  options?: VaultLinkPlanOptions,
  lookupShortname?: VaultLinkShortnamePort,
): Promise<VaultLinkFileResolution> {
  const plan = planVaultLinkPath(rawPath, ctx, options)
  if (plan.kind === 'absolute') {
    for (const candidate of plan.candidates) {
      const realPath = await exists(candidate)
      if (realPath !== null) {
        return { kind: 'target', fsPath: realPath }
      }
    }
    return { kind: 'not-found' }
  }
  if (!ctx.hasWorkspace) {
    return { kind: 'no-workspace' }
  }
  if (rawPath.trim() === '') {
    return { kind: 'not-found' }
  }
  if (plan.kind === 'escape') {
    return { kind: 'escape', detail: plan.detail }
  }
  for (const candidate of plan.candidates) {
    const realPath = await exists(candidate)
    if (realPath !== null) {
      return { kind: 'target', fsPath: realPath }
    }
  }
  // 短名补查：仅文件名（归一后无分隔符的明确相对目录路径不补查）、仅
  // Markdown 语义（显式 .md 或省略扩展名的 implicitMd；非 Markdown 不跨
  // 目录补查）——查询键为完整 basename（含扩展名）
  const normalized = (ctx.isWindowsHost ? rawPath.replace(/\\/g, '/') : rawPath).trim()
  const ext = path.posix.extname(normalized)
  const markdownIntent = ext === '.md' || (ext === '' && (options?.implicitMd ?? true))
  if (lookupShortname !== undefined && !normalized.includes('/') && markdownIntent) {
    const found = await lookupShortname(ext === '' ? `${normalized}.md` : normalized)
    if (found.candidates.length === 0) {
      return { kind: 'not-found' }
    }
    if (found.candidates.length > 1) {
      return { kind: 'ambiguous', candidates: found.candidates }
    }
    return found.complete
      ? { kind: 'target', fsPath: found.candidates[0]! }
      : { kind: 'pending' }
  }
  return { kind: 'not-found' }
}
