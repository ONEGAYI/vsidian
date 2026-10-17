// #535 T08 Codex 迁移锁——代次锁（fencing）协议（PR #581 四审 P2-D 修
// 复；不依赖 vscode/DOM，fs 原语经端口注入——宿主接线用 node fs，单测
// 注入真实 fs 或受控门控复现评审方调度）。
//
// 文件族（都在 globalStorage 扩展私有目录，lockPath 为基名）：
//   <lockPath>.gen      当前代次指针：内容为十进制代次数字，tmp+rename
//                        原子替换；首次认领时创建，此后只被原子前进、
//                        永不删除或夺走——公开锁路径（指针）任意时刻存
//                        在，不存在「检查/接管/释放期间锁路径暂时消失」
//                        的窗口，第三窗口无法趁虚获锁。
//   <lockPath>.<n>      第 n 代锁文件：JSON { token, pid, createdAt, gen }
//                        ——O_EXCL 创建，同名互斥；文件名即代次身份。
//
// 不变量（协议核心，评审方四审两项调度反例的闭合面）：
//
// U1 指针在场：认领提交只经 tmp+rename 原子替换；任何路径都不把指针或
//    当前代次文件「先移走再核验」——评审方实测的「接管先 rename 候选
//    （可能是 A 重建的新鲜活锁）→ 公开路径暂时空缺 → 第三窗口
//    open('wx') 成功 → link 因 EEXIST 放弃恢复 → rm 清掉 A 的隔离副本
//    → 双 owner」与「释放先 rename 后核验 token 的同型空隙」两类根因
//    （活锁路径暂时消失 + 按过期观察删继任锁）在此结构上不存在。
// U2 至多一个 owner：每代文件只有一个 O_EXCL 创建者；指针只被「自己
//    候选代次文件已创建、且重读指针仍低于候选」的一方推进（提交点）。
//    创建后的指针单调性校验让持滞后指针读数的迟到者删自己的文件退场
//    ——陈旧读数永远写不出回退指针，也就不会与真实 owner 并存。
// U3 删除对象永远是自己代次的确切文件名：释放 = 单条 rm 自己的
//    <lockPath>.<ownGen>（文件名即身份，无观察/校验窗口）；旧 owner
//    永远够不到继任者（继任者代次严格更高）。
// U4 前代残留清理只删代次数字严格小于自己代次的 <lockPath>.<n>：自己
//    能走到更高代次，意味着所有更低代次已被声明陈旧（超阈值）、孤儿
//    （提交窗崩溃）或放弃（单调性校验撤退）——新 owner 按文件名携带的
//    代次核对后清理，绝不删当前或更高代次的锁（不存在「按过期观察删
//    新锁」）。
//
// 认领（tryAcquire / takeoverIfStale 共用核心）：
//   读指针 p → 入口检查当前代次（tryAcquire 要求在位即败——无论新鲜
//   陈旧；接管只对 mtime 陈旧的当前代次放行）→ 步进候选 = p+1：跳过
//   「存在且已陈旧」的候选代次（提交窗崩溃的孤儿），遇新鲜候选即整体
//   失败（那是正在提交的并行认领者——fail-closed）→ O_EXCL 创建
//   lock.<候选>（并发同代认领只有一个赢家）→ 重读指针做单调性校验
//   （≥ 候选则删自己的文件、按败者退场）→ tmp+rename 把指针原子推到
//   候选（提交点，所有权成立）→ 尽力清理更低代次残留。
//
// 陈旧接管：当前代次 mtime 超阈值即以同一核心按更高代次抢占；指针只在
// 提交点前进、从不回退。崩溃在「创建后、提交前」的孤儿代次文件由下一
// 个认领者按陈旧步进越过、由新 owner 清理（U4），不会永久锁死。
//
// 指针读取失败语义：指针缺失 = 从未认领（按代次 0 引导，首个认领者顺
// 带创建指针）；指针内容损坏（非纯十进制数字）= 存储层异常，fail-closed
// 抛错（本次激活放弃迁移，下次激活重试）——绝不按 0 重写，那会在真实
// owner 在场时造成指针回退与双 owner。

/** errno 形态错误（code 判定用；不引 node 类型保持 webview 边界纯净） */
export interface CodexLockFsError {
  code?: string
}

/** 锁协议依赖的 fs 原语端口（宿主 wiring 用 node fs.promises 实现） */
export interface CodexLockFilesystem {
  /** O_EXCL 创建并整体写入（目标已存在抛 code=EEXIST） */
  writeFileExclusive(path: string, data: string): Promise<void>
  /** 原子改名替换（指针推进：tmp → 指针；同卷 rename 原子替换） */
  rename(from: string, to: string): Promise<void>
  /** 删除文件（不存在视为成功——语义等价 rm -f） */
  rm(path: string): Promise<void>
  /** 目标 mtime（ms；不存在 = null） */
  statMtimeMs(path: string): Promise<number | null>
  /** 读文本内容（指针读取；不存在/不可读抛错） */
  readFile(path: string): Promise<string>
  /** 列目录条目名（前代残留清理与 _test 隔离；不存在抛错） */
  listDirFiles(dir: string): Promise<string[]>
}

/** 认领者身份：token 为本代次唯一标识（生成方保证唯一） */
export interface CodexMigrationLockIdentity {
  token: string
  pid: number
}

/** 锁协议句柄（语义见文件头不变量注释） */
export interface CodexMigrationLockHandle {
  /** O_EXCL 认领（当前代次在位即 false）：true = 本代次持有 */
  tryAcquire(): Promise<boolean>
  /** 陈旧接管（协议见文件头）：true = 接管成功（本代次持有） */
  takeoverIfStale(staleMs: number): Promise<boolean>
  /** 释放（U3）：只删自己代次的确切文件名——单条 rm，无观察/校验窗口 */
  release(): Promise<void>
  /** 当前代次锁年龄（ms；指针代次文件不存在 = null） */
  ageMs(): Promise<number | null>
  /**
   * 全族清理（_test 隔离钩子专用）：删除指针与所有 <lockPath> 家族
   * 文件（含旧协议形态残留）；生产路径不调用（生产释放走 release 的
   * 按名删除协议）。
   */
  forceCleanup(): Promise<void>
}

/** 锁文件内容形态 */
export interface CodexMigrationLockInfo {
  token: string
  pid: number
  createdAt: number
  /** 代次（文件名携带；诊断与 U4 清理核对用） */
  gen: number
}

function isErrnoLike(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null &&
    (error as CodexLockFsError).code === code
}

/** 锁内容解析（非 JSON / 字段形态不符 → null，调用方按「无法核对」处理） */
export function parseCodexMigrationLockInfo(content: string): CodexMigrationLockInfo | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>
    if (typeof value['token'] !== 'string' ||
        typeof value['pid'] !== 'number' ||
        typeof value['createdAt'] !== 'number' ||
        typeof value['gen'] !== 'number') {
      return null
    }
    return {
      token: value['token'],
      pid: value['pid'],
      createdAt: value['createdAt'],
      gen: value['gen'],
    }
  } catch {
    return null
  }
}

/** 纯字符串 dirname（兼容两种分隔符；wiring/测试均传绝对路径） */
function dirOfFile(file: string): string {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return index === -1 ? '.' : file.slice(0, index)
}

/** 纯字符串 basename（家族前缀清理匹配用） */
function baseOfFile(file: string): string {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return file.slice(index + 1)
}

export function createCodexMigrationLock(
  fs: CodexLockFilesystem,
  lockPath: string,
  identity: CodexMigrationLockIdentity,
  now: () => number = Date.now,
): CodexMigrationLockHandle {
  const pointerPath = `${lockPath}.gen`
  const genPath = (gen: number) => `${lockPath}.${gen}`
  const lockDir = dirOfFile(lockPath)
  const lockBase = baseOfFile(lockPath)
  let ownGen: number | null = null

  /** 读当前代次指针：缺失 = 0（引导态）；损坏 = 抛错（fail-closed，见文件头） */
  const readPointer = async (): Promise<number> => {
    let content: string
    try {
      content = await fs.readFile(pointerPath)
    } catch (error) {
      if (isErrnoLike(error, 'ENOENT')) return 0
      throw error
    }
    const text = content.trim()
    if (!/^\d+$/.test(text)) {
      throw new Error(`[vsidian] Codex 迁移锁指针内容损坏: ${JSON.stringify(text)}`)
    }
    return Number.parseInt(text, 10)
  }

  /** 指针原子推进（提交点）：token 唯一的 tmp 写入 + rename 原子替换 */
  const pushPointer = async (gen: number): Promise<void> => {
    const tmp = `${pointerPath}.${identity.token}.tmp`
    await fs.writeFileExclusive(tmp, String(gen))
    try {
      await fs.rename(tmp, pointerPath)
    } catch (error) {
      await fs.rm(tmp).catch(() => undefined)
      throw error
    }
  }

  /** U4：清理严格更低代次的残留锁文件（尽力而为，失败不传播） */
  const cleanupOlderGens = async (own: number): Promise<void> => {
    let names: string[]
    try {
      names = await fs.listDirFiles(lockDir)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.startsWith(`${lockBase}.`)) continue
      const suffix = name.slice(lockBase.length + 1)
      if (!/^\d+$/.test(suffix)) continue // 指针（.gen）/指针 tmp/旧协议残留——不动
      if (Number.parseInt(suffix, 10) < own) {
        await fs.rm(`${lockPath}.${suffix}`).catch(() => undefined)
      }
    }
  }

  /**
   * 认领核心（tryAcquire / takeoverIfStale 共用）：
   * requireCurrentAbsent = true：当前代次在位即败（「无锁才认领」的严格
   * 形态，陈旧交给 takeoverIfStale 处理）；false：当前代次缺失或陈旧均
   * 可继续（接管形态）。
   */
  const acquireCore = async (options: {
    requireCurrentAbsent: boolean
    staleMs: number
  }): Promise<boolean> => {
    const p = await readPointer()
    const currentMtime = await fs.statMtimeMs(genPath(p))
    if (currentMtime !== null) {
      if (options.requireCurrentAbsent) return false
      if (now() - currentMtime <= options.staleMs) return false // 新鲜——不动
    }
    // 步进候选：跳过「存在且已陈旧」的孤儿代次；遇新鲜候选即失败
    // （尚未提交完成的并行认领者——fail-closed，败者路径接管兜底）
    let candidate = p + 1
    for (;;) {
      const mtime = await fs.statMtimeMs(genPath(candidate))
      if (mtime === null) break
      if (now() - mtime <= options.staleMs) return false
      candidate += 1
    }
    const info: CodexMigrationLockInfo = {
      token: identity.token,
      pid: identity.pid,
      createdAt: now(),
      gen: candidate,
    }
    try {
      await fs.writeFileExclusive(genPath(candidate), JSON.stringify(info))
    } catch (error) {
      // 并发同代认领：O_EXCL 只有一个赢家，败者走等待语义
      if (isErrnoLike(error, 'EEXIST')) return false
      throw error
    }
    // U2 单调性校验：指针已被更晚的认领者推进到 ≥ 候选（自己的指针读数
    // 已过时）——删自己刚创建的文件、按败者退场，绝不写回退指针
    const p2 = await readPointer()
    if (p2 >= candidate) {
      await fs.rm(genPath(candidate)).catch(() => undefined)
      return false
    }
    try {
      await pushPointer(candidate)
    } catch {
      // 提交失败：撤回自己的候选文件（残留即孤儿，由后续陈旧步进越过）
      await fs.rm(genPath(candidate)).catch(() => undefined)
      return false
    }
    ownGen = candidate
    await cleanupOlderGens(candidate).catch(() => undefined)
    return true
  }

  return {
    tryAcquire: () => acquireCore({ requireCurrentAbsent: true, staleMs: 0 }),

    takeoverIfStale: (staleMs) => acquireCore({ requireCurrentAbsent: false, staleMs }),

    release: async () => {
      if (ownGen === null) return
      const gen = ownGen
      ownGen = null
      // U3：只删自己代次的确切文件名——单条 rm。曾被接管（文件已被新
      // owner 按 U4 清理）时为无害 no-op；任何情况下都够不到继任者
      await fs.rm(genPath(gen))
    },

    ageMs: async () => {
      const p = await readPointer()
      const mtime = await fs.statMtimeMs(genPath(p))
      return mtime === null ? null : now() - mtime
    },

    forceCleanup: async () => {
      ownGen = null
      let names: string[]
      try {
        names = await fs.listDirFiles(lockDir)
      } catch {
        return
      }
      for (const name of names) {
        if (name === lockBase || name.startsWith(`${lockBase}.`)) {
          await fs.rm(`${lockDir}/${name}`).catch(() => undefined)
        }
      }
    },
  }
}
