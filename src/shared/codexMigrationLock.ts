// #535 T08 Codex 迁移锁——跨窗口/跨进程原子认领与安全接管协议（PR #581
// 三审 P2-B 同修；不依赖 vscode/DOM，fs 原语经端口注入——宿主接线用
// node fs，单测注入真实 fs 或受控包装复现评审方调度）。
//
// 锁文件内容：JSON `{ token, pid, createdAt }`——token 为每次认领生成的
// 唯一代次标识（认领者私有），是「这把锁是我的」的凭证；pid/createdAt
// 为诊断信息。
//
// 接管与释放的不变量（协议核心，评审方两项实测反例的闭合面）：
//
// 1. **不删除未验证为当初观察到的陈旧锁**：接管绝不按「先前 stat 得到的
//    陈旧观察」行动——观察与动作之间锁可能已被他人换新（A 删旧建新后，
//    B 按过期观察 rm 会删掉 A 的新锁 → 两边均 migrate）。协议改为：先
//    rename 把候选锁**原子夺走**到隔离名，再对**夺走的文件自身**重新
//    stat 验证陈旧（rename 不改 mtime），验证通过才 rm——被删除的对象
//    永远是刚被验证的对象，不存在观察/动作窗口。夺走后发现新鲜（他人
//    已接管重建）则经 link（no-clobber）原位恢复，绝不删除。
//
// 2. **旧 owner 的 finally 不删继任锁**：释放（owner 正常完成/异常退出
//    的 finally 路径）同样先 rename 夺走，再读隔离文件内容核对 token 与
//    自己一致——一致才 rm；不一致（锁已被接管、现为继任者所有，或内容
//    损坏无法核对）则原位恢复、绝不删除。
//
// 3. **恢复不覆盖新锁**：恢复用 fs.link 创建硬链接（目标已存在抛
//    EEXIST）——lockPath 位置已被新认领占用时放弃恢复（新锁无恙），只
//    清理自己手里的隔离文件。恢复与原 owner 并发释放交错的最坏后果是
//    短暂残留一把新鲜锁、由 mtime 陈旧接管（默认 10s）兜底，不影响
//    磁盘权威 marker 的收口判据（done 状态文件才是幂等短路依据）。
//
// 4. 隔离文件名内嵌操作者 token，多方并发互不冲突；进程在 rename 与 rm
//    之间崩溃会残留 `*.takeover` / `*.release` 隔离文件——不影响
//    lockPath 判据，globalStorage 扩展私有目录内偶发残留可接受。

/** errno 形态错误（code 判定用；不引 node 类型保持 webview 边界纯净） */
export interface CodexLockFsError {
  code?: string
}

/** 锁协议依赖的 fs 原语端口（宿主 wiring 用 node fs.promises 实现） */
export interface CodexLockFilesystem {
  /** O_EXCL 创建并整体写入（目标已存在抛 code=EEXIST） */
  writeFileExclusive(path: string, data: string): Promise<void>
  /** 原子改名（from 不存在抛 code=ENOENT） */
  rename(from: string, to: string): Promise<void>
  /** 创建硬链接（to 已存在抛 code=EEXIST——no-clobber 恢复原语） */
  link(from: string, to: string): Promise<void>
  /** 删除文件（不存在视为成功——语义等价 rm -f） */
  rm(path: string): Promise<void>
  /** 目标 mtime（ms；不存在 = null） */
  statMtimeMs(path: string): Promise<number | null>
  /** 读文本内容（不存在/不可读抛错） */
  readFile(path: string): Promise<string>
}

/** 认领者身份：token 为本代次唯一标识（生成方保证唯一） */
export interface CodexMigrationLockIdentity {
  token: string
  pid: number
}

/** 锁协议句柄（语义见文件头不变量注释） */
export interface CodexMigrationLockHandle {
  /** O_EXCL 认领：true = 本代次持有 */
  tryAcquire(): Promise<boolean>
  /** 陈旧接管（协议见不变量 1）：true = 接管成功（本代次持有） */
  takeoverIfStale(staleMs: number): Promise<boolean>
  /** 释放（协议见不变量 2）：只删核对为本代次 token 的锁 */
  release(): Promise<void>
  /** 锁年龄（ms；不存在 = null） */
  ageMs(): Promise<number | null>
  /**
   * 隔离式强制清理（_test 隔离钩子专用）：rename 夺走后直接删除——
   * 删的就是夺走的那份，无观察/动作窗口；生产路径不调用（生产释放走
   * release 的 token 校验协议）。
   */
  forceCleanup(): Promise<void>
}

/** 锁文件内容形态 */
export interface CodexMigrationLockInfo {
  token: string
  pid: number
  createdAt: number
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
        typeof value['createdAt'] !== 'number') {
      return null
    }
    return { token: value['token'], pid: value['pid'], createdAt: value['createdAt'] }
  } catch {
    return null
  }
}

export function createCodexMigrationLock(
  fs: CodexLockFilesystem,
  lockPath: string,
  identity: CodexMigrationLockIdentity,
  now: () => number = Date.now,
): CodexMigrationLockHandle {
  let acquired = false

  const writeOwnLock = async (): Promise<boolean> => {
    const info: CodexMigrationLockInfo = {
      token: identity.token,
      pid: identity.pid,
      createdAt: now(),
    }
    try {
      await fs.writeFileExclusive(lockPath, JSON.stringify(info))
      acquired = true
      return true
    } catch (error) {
      if (isErrnoLike(error, 'EEXIST')) return false
      throw error
    }
  }

  /** 把隔离文件原位恢复回 lockPath（不变量 3：no-clobber）；rm 隔离文件 */
  const restoreFrom = async (trash: string): Promise<void> => {
    try {
      await fs.link(trash, lockPath)
    } catch (error) {
      if (!isErrnoLike(error, 'EEXIST')) throw error
      // EEXIST：位置已被新锁占用——放弃恢复（新锁无恙）
    }
    await fs.rm(trash)
  }

  return {
    tryAcquire: writeOwnLock,

    takeoverIfStale: async (staleMs: number): Promise<boolean> => {
      const mtime = await fs.statMtimeMs(lockPath)
      if (mtime === null) return writeOwnLock() // 无锁——直接抢
      if (now() - mtime <= staleMs) return false // 新鲜——不动
      // 陈旧候选：原子夺走并对夺走对象自身重新验证（不变量 1）
      const trash = `${lockPath}.${identity.token}.takeover`
      try {
        await fs.rename(lockPath, trash)
      } catch (error) {
        if (isErrnoLike(error, 'ENOENT')) return writeOwnLock() // 竞态中锁消失
        throw error
      }
      const taken = await fs.statMtimeMs(trash)
      if (taken !== null && now() - taken > staleMs) {
        // 验证陈旧：取得接管权——删的是验证过的对象，再抢新锁
        await fs.rm(trash)
        return writeOwnLock()
      }
      // 夺走的是新鲜锁（陈旧观察已过时，他人已接管重建）——原位恢复
      await restoreFrom(trash)
      return false
    },

    release: async (): Promise<void> => {
      if (!acquired) return
      acquired = false
      const trash = `${lockPath}.${identity.token}.release`
      try {
        await fs.rename(lockPath, trash)
      } catch (error) {
        if (isErrnoLike(error, 'ENOENT')) return // 已被接管清理
        throw error
      }
      try {
        const info = parseCodexMigrationLockInfo(await fs.readFile(trash))
        if (info !== null && info.token === identity.token) {
          await fs.rm(trash) // 核对为本代次的锁（不变量 2）→ 删除
          return
        }
        // 不是自己的（继任者的锁 / 内容损坏无法核对）——原位恢复不删除
        await restoreFrom(trash)
      } catch {
        // readFile 等异常：保守恢复（残留锁由陈旧接管兜底）
        await restoreFrom(trash).catch(() => undefined)
      }
    },

    ageMs: async () => {
      const mtime = await fs.statMtimeMs(lockPath)
      return mtime === null ? null : now() - mtime
    },

    forceCleanup: async () => {
      acquired = false
      const trash = `${lockPath}.${identity.token}.cleanup`
      try {
        await fs.rename(lockPath, trash)
      } catch (error) {
        if (isErrnoLike(error, 'ENOENT')) return
        throw error
      }
      await fs.rm(trash)
    },
  }
}
