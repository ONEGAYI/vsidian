// #535 T08 旧主题迁移锁——代次锁（fencing）协议（PR #581 四审 P2-D 建立，
// 六审 P2-E 修订提交点语义；不依赖 vscode/DOM，fs 原语经端口注入——宿主
// 接线用 node fs，单测注入真实 fs 或受控门控复现评审方调度）。
//
// 文件族（都在 globalStorage 扩展私有目录，lockPath 为基名）：
//   <lockPath>.<n>      第 n 代锁文件：JSON { token, pid, createdAt, gen }
//                        ——O_EXCL 创建，同名互斥；文件名即代次身份；释放
//                        与前代清理按名删除（U3/U4）。
//   <lockPath>.g<n>     第 n 代的提交标记（六审）：O_EXCL 创建、内容为十
//                        进制代次数字，生产路径永不删除。**有效代次指针 =
//                        标记族的 max**——标记只增不减，任何滞后方的任何
//                        写都无法让有效指针回退（旧单文件指针的 rename
//                        覆盖回退路径在协议中不再存在）。
//   <lockPath>.gen      指针兼容视图（六审降级为诊断面）：内容为最后一次
//                        提交的代次数字，tmp+rename 尽力更新；其值恒 ≤ 标
//                        记族 max（每次写都发生在自己标记提交之后），不参
//                        与仲裁。保留原因：诊断习惯与四/五审测试播种形态。
//
// 为什么提交点是「真正的原子仲裁」（六审 P2-E 核心论证）：单机文件系统
// 没有通用 compare-and-swap——评审方已论证「多读一次指针 + rename 原子
// 替换」不构成 CAS（读与写之间的窗口让滞后读数写出回退指针，R4 实测
// 2→1、双 owner、guides=['B','A']）。文件系统保证原子性的创建语义只有
// **O_EXCL**：名字由创建方选定，同名恰有一个赢家、败者得 EEXIST。因此
// 把「指针推进」从「可覆盖 rename 的单文件」改为 **O_EXCL 单调标记族**：
// - 第 n 代的提交 = 创建 g<n>。同名并发/重复提交只有一个赢家；EEXIST
//   即仲裁败诉——该代次已被历史认领者提交（自己的指针读数过时，典型形
//   态：接管者已提交并释放、名字看似空闲），删自己的候选文件撤退；
// - 滞后者「把指针写回旧值」变形为「创建一个更低的标记」——max 不受影
//   响，回退在结构上不存在；滞后者在提交后核验（重读 max）发现自己落
//   后时删自己的代次文件退场（标记保留：该代次确实被提交过，是历史的
//   一部分，删除既无必要又有竞态代价）。
//
// 不变量（协议核心；U1-U4 四审建立，六审保持不回退）：
//
// U1 指针在场：首次提交后标记族（与兼容视图）在生产路径永不消失——不
//    存在「检查/接管/释放期间锁路径暂时空缺」的窗口，第三窗口无法趁虚
//    获锁。六审加强：标记族永不删除，指针语义上永久单调。
// U2 至多一个 owner：每代文件只有一个 O_EXCL 创建者；代次提交与所有权
//    成立是同一原子动作（创建 g<n> 成功），提交后不存在「用先前读数改
//    写指针」的步骤；已提交却被更高代次超越的滞后者由提交后核验拦截撤
//    退，进入 owner 序列后由调用方的 fencing（legacyThemeMigration 六审
//    方向 B：每个关键副作用前 isCurrentGeneration 复核）继续拦截。
// U3 删除对象永远是自己代次的确切文件名：释放 = 单条 rm 自己的
//    <lockPath>.<ownGen>（标记不删；曾被接管时文件已被清理，rm 为无害
//    no-op）；旧 owner 永远够不到继任者（继任者代次严格更高）。
// U4 前代残留清理只删代次数字严格小于自己代次的 <lockPath>.<n>：标记
//    g<n> 的后缀不是纯数字，天然不在清理面；新 owner 按文件名携带的代
//    次核对后清理，绝不删当前或更高代次的锁。
//
// 认领（tryAcquire / takeoverIfStale 共用核心）：
//   读指针 p（标记族 max 与兼容视图取大）→ 入口检查当前代次（tryAcquire
//   要求在位即败——无论新鲜陈旧；接管只对 mtime 陈旧的当前代次放行）→
//   步进候选 = p+1：跳过「存在且已陈旧」的候选（提交窗崩溃的孤儿），遇
//   新鲜候选即整体失败（fail-closed）。**六审：普通认领的候选新鲜度阈值
//   为 Infinity——任何存在的候选文件（无论年龄）都按在途/残留让位，永
//   不以时间判定越过；时间语义（陈旧阈值）只属于接管路径**，两条路径的
//   过期语义不混用。普通认领被孤儿挡住不锁死：调用方等待环经
//   takeoverIfStale 的阈值兜底（生产 runLegacyThemeMigration 已有衔接）→
//   O_EXCL 创建 lock.<候选>（并发同代认领只有一个赢家）→ **提交点：
//   O_EXCL 创建 g<候选>（EEXIST = 名字已被历史提交 → 撤退）** → 提交后
//   核验：重读 max，> 候选 → 已被更高代次超越 → 删自己的代次文件撤退 →
//   兼容视图尽力更新 → 清理更低代次残留。
//
// 陈旧接管：当前代次 mtime 超阈值即以同一核心按更高代次抢占；有效指针
// 只在提交点前进、从不回退。崩溃在「创建后、提交前」的孤儿代次文件由
// 接管路径按陈旧步进越过、由新 owner 清理（U4），不会永久锁死。
//
// 指针读取失败语义：兼容视图缺失 = 从未提交（按代次 0 引导）；内容损坏
// （非纯十进制数字）= 存储层异常，fail-closed 抛错（本次激活放弃迁移，
// 下次激活重试）——绝不按 0 重写。标记扫描对目录缺失（首次提交前父目录
// 尚未建立）按空族处理。

/** errno 形态错误（code 判定用；不引 node 类型保持 webview 边界纯净） */
export interface LegacyLockFsError {
  code?: string
}

/** 锁协议依赖的 fs 原语端口（宿主 wiring 用 node fs.promises 实现） */
export interface LegacyLockFilesystem {
  /** O_EXCL 创建并整体写入（目标已存在抛 code=EEXIST） */
  writeFileExclusive(path: string, data: string): Promise<void>
  /** 原子改名替换（指针兼容视图：tmp → 视图；同卷 rename 原子替换） */
  rename(from: string, to: string): Promise<void>
  /** 删除文件（不存在视为成功——语义等价 rm -f） */
  rm(path: string): Promise<void>
  /** 目标 mtime（ms；不存在 = null） */
  statMtimeMs(path: string): Promise<number | null>
  /** 设置目标 mtime（ms 纪元值；八审 R8-2 keepalive 心跳——把「代次文件年龄」从距认领改为距最后心跳） */
  utimes(path: string, mtimeMs: number): Promise<void>
  /** 读文本内容（指针视图读取；不存在/不可读抛错） */
  readFile(path: string): Promise<string>
  /** 列目录条目名（标记族扫描、前代残留清理与 _test 隔离；不存在抛错） */
  listDirFiles(dir: string): Promise<string[]>
}

/** 认领者身份：token 为本代次唯一标识（生成方保证唯一） */
export interface LegacyThemeMigrationLockIdentity {
  token: string
  pid: number
}

/** 锁协议句柄（语义见文件头不变量注释） */
export interface LegacyThemeMigrationLockHandle {
  /** O_EXCL 认领（当前代次在位即 false）：true = 本代次持有 */
  tryAcquire(): Promise<boolean>
  /** 陈旧接管（协议见文件头）：true = 接管成功（本代次持有） */
  takeoverIfStale(staleMs: number): Promise<boolean>
  /** 释放（U3）：只删自己代次的确切文件名——单条 rm，无观察/校验窗口 */
  release(): Promise<void>
  /** 当前代次锁年龄（ms；指针代次文件不存在 = null） */
  ageMs(): Promise<number | null>
  /**
   * fencing 判据（六审方向 B）：自己是否仍持有最高已提交代次（标记族
   * max === ownGen）。未认领或已被更高代次接管（自身滞缓/崩溃被陈旧接
   * 管）→ false——owner 序列在关键副作用前复核，滞后 owner 静默撤退。
   * 判据依赖「有效指针不可回退」（标记族），不存在「指针被拉回自己代
   * 次后误判有效」的形态。
   */
  isCurrentGeneration(): Promise<boolean>
  /**
   * 本句柄认领过的代次（七审 R7-3；八审 R9-3 收敛收尾放宽）：owner 写
   * 迁移状态文件时以自己代次为文件名代次（滞后 owner 的迟到提交只落低
   * 代次文件，被 max 读取结构性忽略）——release 后仍返回最后持有的代
   * 次（收敛收尾的封存写属于「滞后写」，落在自己旧代次名上恰是被
   * max 语义保护的形态）；从未认领过才抛错。
   */
  getOwnedGeneration(): Promise<number>
  /**
   * 心跳（八审 R8-2）：owner 在长等待（身份等待第一窗/收敛窗）期间刷新
   * 自己代次文件的 mtime——陈旧接管按「距最后心跳」而非「距认领」判
   * 定，合法等待中的 owner 不被并发窗口当失效逐出。未认领时为无害
   * no-op；失败尽力而为不传播（接管路径自身 fail-closed）。
   */
  keepalive(): Promise<void>
  /**
   * 全族清理（_test 隔离钩子专用）：删除指针视图与所有 <lockPath> 家族
   * 文件（含提交标记与旧协议形态残留）；生产路径不调用（生产释放走
   * release 的按名删除协议）。
   */
  forceCleanup(): Promise<void>
}

/** 锁文件内容形态 */
export interface LegacyThemeMigrationLockInfo {
  token: string
  pid: number
  createdAt: number
  /** 代次（文件名携带；诊断与 U4 清理核对用） */
  gen: number
}

function isErrnoLike(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null &&
    (error as LegacyLockFsError).code === code
}

/** 锁内容解析（非 JSON / 字段形态不符 → null，调用方按「无法核对」处理） */
export function parseLegacyThemeMigrationLockInfo(content: string): LegacyThemeMigrationLockInfo | null {
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

export function createLegacyThemeMigrationLock(
  fs: LegacyLockFilesystem,
  lockPath: string,
  identity: LegacyThemeMigrationLockIdentity,
  now: () => number = Date.now,
): LegacyThemeMigrationLockHandle {
  const pointerPath = `${lockPath}.gen`
  const markerPath = (gen: number) => `${lockPath}.g${gen}`
  const genPath = (gen: number) => `${lockPath}.${gen}`
  const lockDir = dirOfFile(lockPath)
  const lockBase = baseOfFile(lockPath)
  let ownGen: number | null = null
  /** 最后一次成功认领的代次（release 后保留——getOwnedGeneration 供收敛收尾的封存写；从未认领为 null） */
  let lastGen: number | null = null

  /** 兼容视图读取（缺失 = 0；损坏抛错 fail-closed，见文件头） */
  const readPointerHint = async (): Promise<number> => {
    let content: string
    try {
      content = await fs.readFile(pointerPath)
    } catch (error) {
      if (isErrnoLike(error, 'ENOENT')) return 0
      throw error
    }
    const text = content.trim()
    if (!/^\d+$/.test(text)) {
      throw new Error(`[vsidian] 旧主题迁移锁指针内容损坏: ${JSON.stringify(text)}`)
    }
    return Number.parseInt(text, 10)
  }

  /** 提交标记族扫描取 max（目录缺失 = 空族——首次提交前父目录尚不存在） */
  const scanMarkerMax = async (): Promise<number> => {
    let names: string[]
    try {
      names = await fs.listDirFiles(lockDir)
    } catch (error) {
      if (isErrnoLike(error, 'ENOENT')) return 0
      throw error
    }
    const prefix = `${lockBase}.g`
    let max = 0
    for (const name of names) {
      if (!name.startsWith(prefix)) continue
      const suffix = name.slice(prefix.length)
      if (!/^\d+$/.test(suffix)) continue
      max = Math.max(max, Number.parseInt(suffix, 10))
    }
    return max
  }

  /** 有效代次指针：max(兼容视图, 提交标记族)——标记族单调，整体不回退 */
  const readPointer = async (): Promise<number> =>
    Math.max(await readPointerHint(), await scanMarkerMax())

  /** 兼容视图尽力更新（tmp+rename；失败不回滚所有权——标记才是权威） */
  const pushPointerHint = async (gen: number): Promise<void> => {
    const tmp = `${pointerPath}.${identity.token}.tmp`
    await fs.writeFileExclusive(tmp, String(gen))
    try {
      await fs.rename(tmp, pointerPath)
    } catch (error) {
      await fs.rm(tmp).catch(() => undefined)
      throw error
    }
  }

  /** U4：清理严格更低代次的残留锁文件（尽力而为，失败不传播；标记不在清理面） */
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
      if (!/^\d+$/.test(suffix)) continue // 标记（g<n>）/指针视图/旧协议残留——不动
      if (Number.parseInt(suffix, 10) < own) {
        await fs.rm(`${lockPath}.${suffix}`).catch(() => undefined)
      }
    }
  }

  /**
   * 认领核心（tryAcquire / takeoverIfStale 共用）：
   * requireCurrentAbsent = true：当前代次在位即败（「无锁才认领」的严格
   * 形态，陈旧交给 takeoverIfStale 处理）；false：当前代次缺失或陈旧均
   * 可继续（接管形态）。staleMs 只作用于「接管形态的当前代次新鲜度」与
   * 「孤儿候选步进的陈旧阈值」；普通认领传 Infinity——候选存在即让位。
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
    // （尚未提交完成的并行认领者或任何在途候选——fail-closed；普通认领
    // 的 staleMs=Infinity 使该分支对任何存在的候选恒真，永不以时间越过）
    let candidate = p + 1
    for (;;) {
      const mtime = await fs.statMtimeMs(genPath(candidate))
      if (mtime === null) break
      if (now() - mtime <= options.staleMs) return false
      candidate += 1
    }
    const info: LegacyThemeMigrationLockInfo = {
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
    // 提交点（六审）：O_EXCL 创建提交标记——原子仲裁。EEXIST = 该代次已
    // 被历史认领者提交（自己的指针读数过时：典型为接管者已提交并释放、
    // 名字看似空闲）——删自己的候选文件撤退，绝不重试同名、绝不改写指针
    try {
      await fs.writeFileExclusive(markerPath(candidate), String(candidate))
    } catch (error) {
      await fs.rm(genPath(candidate)).catch(() => undefined)
      if (isErrnoLike(error, 'EEXIST')) return false
      throw error
    }
    // 提交后核验：已有更高代次提交 → 自己是滞后者（如慢 owner 在提交点
    // 前后被人接管）——删自己的代次文件撤退；自己的标记保留（该代次确实
    // 被提交过，max 不受影响），不构成回退
    const committed = await readPointer()
    if (committed > candidate) {
      await fs.rm(genPath(candidate)).catch(() => undefined)
      return false
    }
    ownGen = candidate
    lastGen = candidate
    await pushPointerHint(candidate).catch(() => undefined)
    await cleanupOlderGens(candidate).catch(() => undefined)
    return true
  }

  return {
    tryAcquire: () => acquireCore({ requireCurrentAbsent: true, staleMs: Number.POSITIVE_INFINITY }),

    takeoverIfStale: (staleMs) => acquireCore({ requireCurrentAbsent: false, staleMs }),

    release: async () => {
      if (ownGen === null) return
      const gen = ownGen
      ownGen = null
      // U3：只删自己代次的确切文件名——单条 rm；标记不删。曾被接管（文件
      // 已被新 owner 按 U4 清理）时为无害 no-op；任何情况下都够不到继任者
      await fs.rm(genPath(gen))
    },

    ageMs: async () => {
      const p = await readPointer()
      const mtime = await fs.statMtimeMs(genPath(p))
      return mtime === null ? null : now() - mtime
    },

    isCurrentGeneration: async () => {
      if (ownGen === null) return false
      const p = await readPointer()
      return p === ownGen
    },

    getOwnedGeneration: async () => {
      if (lastGen === null) {
        throw new Error('[vsidian] 旧主题迁移状态写入需先认领锁（代次未知）')
      }
      return lastGen
    },

    keepalive: async () => {
      if (ownGen === null) return
      try {
        const at = new Date(now())
        await fs.utimes(genPath(ownGen), at.getTime())
      } catch {
        // 尽力而为：心跳失败不传播（无心跳时 mtime 停在认领/上次成功
        // 心跳，接管按陈旧兜底——方向与 fail-closed 一致）
      }
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
        // 只删锁族文件：基名本身、代次（纯数字后缀）、指针视图（.gen）、
        // 提交标记（g<数字>）与指针 tmp（.tmp 结尾）——**不含**同前缀的状
        // 态文件（<base>.<profileId>.p<gen>/.d<gen>.json：锁基名与状态文件
        // 前缀同族，须按后缀分族）
        const suffix = name === lockBase ? ''
          : name.startsWith(`${lockBase}.`) ? name.slice(lockBase.length + 1) : null
        if (suffix === null) continue
        if (suffix !== '' && suffix !== 'gen' && !suffix.endsWith('.tmp') &&
            !/^\d+$/.test(suffix) && !/^g\d+$/.test(suffix)) {
          continue
        }
        await fs.rm(`${lockDir}/${name}`).catch(() => undefined)
      }
    },
  }
}
