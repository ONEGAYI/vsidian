// #535 T08 迁移状态文件族——命名、扫描、读取与原子发布的单一实现
// （八审 R8-3 从 wiring 与测试夹具的双实现抽取）：按（profile 身份，
// 状态，锁代次）分居的 `legacy-theme-migration.<profileId>.p<gen>.json`
// （pending）与 `.d<gen>.json`（done）。纯逻辑 + fs 端口注入（不依赖
// node/vscode/DOM，保持 webview 边界纯净；宿主 wiring 与单测夹具各注入
// 各自的 fs 适配器）。
//
// 八审 R8-3 修复语义：
// - **原子发布**：写入 = 先完整写 tmp、再 rename 到最终名——最终名上
//   不存在「先创建（O_EXCL 暴露文件名）后填充内容」的窗口，写入失败/
//   中断只可能留下 tmp 残缺（不参与读取，随下次写入清理），不可能在
//   最终名留下空/残缺文件；
// - **读取降级回退**：按（代次 desc，同代 done 优先）逐个尝试解析，
//   跳过空/残缺/形态不符的文件——不完整的高代写入不能消除低代有效
//   pending 的引导欠账（R8 反例：空 p2 遮蔽有效 p1 → 恢复连续不引导）；
// - **代次单调性保持（七审 R7-3）**：文件名携带写入者锁代次，滞后
//   owner 的迟到提交只落在自己的低代次名上，被 max 优先读取结构性
//   忽略；写入收尾清理同身份更低代次文件与 tmp 残留（滞后方迟到提交
//   的低代次文件此后仍可能出现，残留无害）。
import {
  parseLegacyThemeMigrationMarker,
  type LegacyThemeMigrationMarker,
} from './legacyThemeMigration'

/** 状态文件族前缀（与锁基名同族，按后缀分族互不相扰） */
export const LEGACY_MARKER_STATE_FILE_PREFIX = 'legacy-theme-migration.'

/** 状态文件族依赖的 fs 原语端口（宿主 wiring 用 node fs.promises 实现） */
export interface LegacyMarkerFilesystem {
  readdir(dir: string): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(path: string): Promise<void>
  /** 目标是否存在（发布前的幂等检查） */
  exists(path: string): Promise<boolean>
}

/** 状态文件名（前缀 + 身份 + p|d + 代次 + .json） */
export function legacyMarkerStateFileName(
  profileId: string,
  state: 'pending' | 'done',
  gen: number,
): string {
  return `${LEGACY_MARKER_STATE_FILE_PREFIX}${profileId}.${state === 'done' ? 'd' : 'p'}${gen}.json`
}

/** 本身份状态文件的文件名匹配器（UUID 仍做正则转义防御） */
function stateFilePatternOf(profileId: string): RegExp {
  return new RegExp(`^${profileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([pd])(\\d+)\\.json$`)
}

/** 状态文件族的（身份, 状态, 代次）观测形态 */
export interface LegacyMarkerFileEntry {
  profileId: string
  state: 'pending' | 'done'
  gen: number
  name: string
}

/** 目录内全部状态文件条目（与族无关名字忽略；目录缺失 = 空） */
export async function legacyListMarkerFileEntries(
  fs: LegacyMarkerFilesystem,
  dir: string,
): Promise<LegacyMarkerFileEntry[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const entries: LegacyMarkerFileEntry[] = []
  for (const name of names) {
    if (!name.startsWith(LEGACY_MARKER_STATE_FILE_PREFIX)) continue
    const match = /^(.+)\.([pd])(\d+)\.json$/.exec(name.slice(LEGACY_MARKER_STATE_FILE_PREFIX.length))
    if (match === null) continue
    entries.push({
      profileId: match[1],
      state: match[2] === 'd' ? 'done' : 'pending',
      gen: Number.parseInt(match[3], 10),
      name,
    })
  }
  return entries
}

/**
 * 读取本身份的权威状态（R8-3 降级回退）：候选按（代次 desc，同代
 * done 优先）排序，逐个解析直至首个合法 marker——空/残缺/形态不符的
 * 高代文件被跳过，不消除低代有效状态；全部不可解析或无文件 = null
 */
export async function readLegacyMarkerFile(
  fs: LegacyMarkerFilesystem,
  dir: string,
  profileId: string,
): Promise<LegacyThemeMigrationMarker | null> {
  const doneRank = (entry: LegacyMarkerFileEntry) => (entry.state === 'done' ? 0 : 1)
  const entries = (await legacyListMarkerFileEntries(fs, dir))
    .filter((entry) => entry.profileId === profileId)
    .sort((a, b) => (b.gen - a.gen) || (doneRank(a) - doneRank(b)))
  for (const entry of entries) {
    try {
      const marker = parseLegacyThemeMigrationMarker(
        JSON.parse(await fs.readFile(`${dir}/${entry.name}`)))
      if (marker !== null) return marker
    } catch {
      // 跳过不可解析候选，继续降级
    }
  }
  return null
}

/**
 * 原子发布状态文件（R8-3）：完整内容先写 tmp，再 rename 到最终名——
 * 最终名上不存在空/残缺窗口。同（身份,状态,代次）名已在（罕见幂等
 * 形态）时按发布成功处理（内容用途一致），不覆盖。收尾尽力清理同
 * 身份更低代次文件与本身份 tmp 残留（失败不传播——残留不参与读取）。
 */
export async function writeLegacyMarkerFile(
  fs: LegacyMarkerFilesystem,
  dir: string,
  profileId: string,
  marker: LegacyThemeMigrationMarker,
  gen: number,
): Promise<void> {
  const finalName = legacyMarkerStateFileName(profileId, marker.state, gen)
  const finalPath = `${dir}/${finalName}`
  const tmpPath = `${finalPath}.${Math.random().toString(36).slice(2)}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(marker))
  try {
    if (await fs.exists(finalPath)) {
      // 幂等：同（身份,状态,代次）名已在——本次发布视为已完成
      await fs.rm(tmpPath).catch(() => undefined)
    } else {
      await fs.rename(tmpPath, finalPath)
    }
  } catch (error) {
    await fs.rm(tmpPath).catch(() => undefined)
    throw error
  }
  // 收尾清理：同身份更低代次 + tmp 残留（尽力而为）
  const pattern = stateFilePatternOf(profileId)
  try {
    const names = await fs.readdir(dir)
    for (const name of names) {
      if (!name.startsWith(LEGACY_MARKER_STATE_FILE_PREFIX)) continue
      const suffix = name.slice(LEGACY_MARKER_STATE_FILE_PREFIX.length)
      if (suffix.endsWith('.tmp')) {
        const stem = suffix.slice(0, -'.tmp'.length)
        if (pattern.test(stem)) await fs.rm(`${dir}/${name}`).catch(() => undefined)
        continue
      }
      const match = pattern.exec(suffix)
      if (match !== null && Number.parseInt(match[2], 10) < gen) {
        await fs.rm(`${dir}/${name}`).catch(() => undefined)
      }
    }
  } catch {
    // 尽力而为
  }
}

/** 目录内是否已有任一迁移状态文件（身份等待分级的磁盘信号；目录缺失 = 无） */
export async function legacyHasAnyMarkerFile(
  fs: LegacyMarkerFilesystem,
  dir: string,
): Promise<boolean> {
  try {
    const names = await fs.readdir(dir)
    return names.some((name) =>
      name.startsWith(LEGACY_MARKER_STATE_FILE_PREFIX) && name.endsWith('.json'))
  } catch {
    return false
  }
}

/** 目录内出现过的全部身份（按文件名提取去重——断言「不生成第二身份」用） */
export async function legacyMarkerIdentitiesInDir(
  fs: LegacyMarkerFilesystem,
  dir: string,
): Promise<string[]> {
  const entries = await legacyListMarkerFileEntries(fs, dir)
  return [...new Set(entries.map((entry) => entry.profileId))]
}
