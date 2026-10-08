// #354 T05 附加组件登记路径的符号链接逃逸守卫（宿主侧，vscode 文件系统
// 经端口注入）。
//
// 边界（票面：宿主侧资源授权的符号链接逃逸校验——登记路径 realpath 后
// 必须仍在组件安装目录内；V02 探针报告未验项收口）：
// - 第一层防线是 addonPageRegistry 的词法包含性（词法上越出安装目录的
//   登记已拒绝）；本守卫是**第二层**：词法在内但经符号链接（Windows
//   junction/symlink 同语义）真实路径落在安装目录外的逃逸，在装载意图
//   （addon.load 推送）之前拒绝。
// - 语义分级：
//   · escape  = realpath 成功但真实路径在安装目录 realpath 之外 → 拒绝；
//   · missing = realpath 抛错（路径不存在）→ 放行（装载时 script-load-
//     failed 自然失败——不存在的路径不构成逃逸攻击面）；
//   · 安装目录 realpath 失败（授权无锚）→ 保守按 escape 拒绝。
// - base 与 candidate 同取真实路径后按 isWithin（addonPageRegistry 导出
//   的同一包含性口径）判定——安装目录本身经 junction 挂载时不含误判。
// - 结果缓存：同一路径只 resolve 一次（在途 Promise 合并）；escape 的
//   目录登记入表（isEscapedDir——资源根授权排除消费）。
import { isWithin } from './addonPageRegistry'

/** 真实路径解析端口（生产 = fs.promises.realpath；单测注入映射表） */
export interface AddonRealpathPort {
  realpath(fsPath: string): Promise<string>
}

/** 待验证的装载计划路径集（addon.load 推送前组装） */
export interface AddonRealpathPlan {
  addonId: string
  /** 安装目录（授权锚；词法路径） */
  installDir: string
  /** 文件路径（入口与样式表；词法） */
  fileFsPaths: readonly string[]
  /** 目录路径（资源子目录基址；词法；null = 无） */
  dirFsPaths: readonly (string | null)[]
}

/** 归因日志端口（与 runtime/wiring 同形：stage + 组件 ID + 原因） */
export type AddonRealpathLogPort = (stage: string, addonId: string, detail: string) => void

export interface AddonRealpathGuard {
  /** 校验装载计划：任一路径逃逸整计划拒绝（'escape'）；全过或仅 missing 放行（'ok'） */
  verifyPlan(plan: AddonRealpathPlan): Promise<'ok' | 'escape'>
  /** 某词法目录是否已判逃逸（资源根授权排除用；未判/miss 为 false） */
  isEscapedDir(fsPath: string): boolean
}

export function createAddonRealpathGuard(port: AddonRealpathPort, log: AddonRealpathLogPort = () => {}): AddonRealpathGuard {
  /** realpath 结果缓存（null = 不存在/解析失败） */
  const realCache = new Map<string, string | null>()
  /** 在途解析（并发合并——同一路径只 resolve 一次） */
  const inFlight = new Map<string, Promise<string | null>>()
  /** 已判逃逸的词法目录（资源根排除用） */
  const escapedDirs = new Set<string>()

  const realOf = (fsPath: string): Promise<string | null> => {
    const cached = realCache.get(fsPath)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
    const pending = inFlight.get(fsPath)
    if (pending) {
      return pending
    }
    const resolve = port.realpath(fsPath)
      .then(
        (real) => {
          realCache.set(fsPath, real)
          return real
        },
        () => {
          // 不存在/不可解析（含意外错误）：统一 missing 语义——candidate
          // 放行给装载失败路径，installDir 的 missing 由 verifyPlan 保守处理
          realCache.set(fsPath, null)
          return null
        },
      )
      .finally(() => {
        inFlight.delete(fsPath)
      })
    inFlight.set(fsPath, resolve)
    return resolve
  }

  return {
    verifyPlan: async (plan) => {
      const installReal = await realOf(plan.installDir)
      if (installReal === null) {
        // 授权无锚（安装目录不可解析）：保守拒绝
        log('page-entry-escape-rejected', plan.addonId, `installDir realpath failed: ${plan.installDir}`)
        return 'escape'
      }
      const paths: string[] = [
        ...plan.fileFsPaths.filter((fsPath) => fsPath !== ''),
        ...plan.dirFsPaths.filter((fsPath): fsPath is string => typeof fsPath === 'string'),
      ]
      for (const fsPath of paths) {
        const real = await realOf(fsPath)
        if (real === null) {
          // missing：放行（装载时自然失败，非逃逸）
          continue
        }
        if (!isWithin(installReal, real)) {
          escapedDirs.add(fsPath)
          log('page-entry-escape-rejected', plan.addonId, `${fsPath} -> ${real} escapes ${installReal}`)
          return 'escape'
        }
      }
      return 'ok'
    },
    isEscapedDir: (fsPath) => escapedDirs.has(fsPath),
  }
}
