// 周期核验决策纯函数契约（工单 #201）：webview 上报活跃图源 → 宿主 stat →
// 每个文件目标的处置判定。语义来自 #194「图片定期刷新与删除态」节：
// - 元数据未变且呈现态健康 → current（不强制重载/解码）
// - 元数据变化 / 呈现态与磁盘真相不符（恢复/转缺/转不可访问）→ refresh
// - 缺失维持（全部条目已呈 not-found）与不可访问维持不扰动（不广播风暴）
// - 按 fsKey 归并：同文件多 src 形态一次判定
import { describe, expect, it } from 'vitest'
import {
  IMAGE_EVENT_DEBOUNCE_MS,
  IMAGE_VERIFY_INTERVAL_MS,
  IMAGE_WAKE_MIN_GAP_MS,
  IMAGE_WATCH_GLOB_SEGMENTS,
  isImageFileExtension,
  planImageVerification,
} from '../../src/shared/imageRefresh'

const STAT_A = { mtimeMs: 1_000, size: 100 }
const STAT_B = { mtimeMs: 2_000, size: 100 }

function plan(
  items: Array<{ src: string; fsKey: string; state: 'loaded' | 'loading' | 'error'; reason?: string }>,
  statOf: Record<string, { kind: 'ok'; mtimeMs: number; size: number } | { kind: 'missing' } | { kind: 'inaccessible' }>,
  lastKnown: Record<string, { mtimeMs: number; size: number } | null> = {},
) {
  return planImageVerification(
    items,
    (key) => statOf[key] ?? { kind: 'missing' },
    (key) => lastKnown[key] ?? null,
  )
}

describe('工程常量（集中可调初值）', () => {
  it('周期核验间隔约 30 秒、事件去抖与唤醒节流为正数', () => {
    expect(IMAGE_VERIFY_INTERVAL_MS).toBe(30_000)
    expect(IMAGE_EVENT_DEBOUNCE_MS).toBeGreaterThan(0)
    expect(IMAGE_EVENT_DEBOUNCE_MS).toBeLessThan(2_000)
    expect(IMAGE_WAKE_MIN_GAP_MS).toBeGreaterThan(0)
  })

  it('图片扩展清单：watcher glob 段与判定函数同源', () => {
    expect(IMAGE_WATCH_GLOB_SEGMENTS).toContain('png')
    expect(IMAGE_WATCH_GLOB_SEGMENTS).toContain('svg')
    expect(isImageFileExtension('a.PNG')).toBe(true)
    expect(isImageFileExtension('a.md')).toBe(false)
    expect(isImageFileExtension('a')).toBe(false)
  })
})

describe('元数据未变不重载', () => {
  it('stat 相同且条目 loaded → current', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'loaded' }],
      { k1: { kind: 'ok', ...STAT_A } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('current')
  })

  it('stat 相同且条目 loading（在途）→ current（不打扰在途请求）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'loading' }],
      { k1: { kind: 'ok', ...STAT_A } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('current')
  })
})

describe('元数据变化刷新', () => {
  it('mtime/size 变化 → refresh（宿主执行 bump + 失效广播）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'loaded' }],
      { k1: { kind: 'ok', ...STAT_B } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('refresh')
  })

  it('lastKnown 为空（曾缺失，文件恢复）→ refresh', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'error', reason: 'not-found' }],
      { k1: { kind: 'ok', ...STAT_A } },
      { k1: null },
    )
    expect(out.get('k1')).toBe('refresh')
  })
})

describe('删除与不可访问', () => {
  it('stat 缺失且条目 loaded → refresh（撤图转找不到）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'loaded' }],
      { k1: { kind: 'missing' } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('refresh')
  })

  it('stat 缺失且全部条目已呈 not-found → current（维持，不打扰）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'error', reason: 'not-found' }],
      { k1: { kind: 'missing' } },
      { k1: null },
    )
    expect(out.get('k1')).toBe('current')
  })

  it('stat 不可访问且条目 loaded → refresh（转不可访问呈现）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'loaded' }],
      { k1: { kind: 'inaccessible' } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('refresh')
  })

  it('stat 不可访问且全部条目已呈 inaccessible → current（维持）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'error', reason: 'inaccessible' }],
      { k1: { kind: 'inaccessible' } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('current')
  })

  it('断连恢复：stat 恢复且元数据相同，但条目呈 inaccessible → refresh（不 bump、URI 不变可缓存命中恢复）', () => {
    const out = plan(
      [{ src: './a.png', fsKey: 'k1', state: 'error', reason: 'inaccessible' }],
      { k1: { kind: 'ok', ...STAT_A } },
      { k1: STAT_A },
    )
    expect(out.get('k1')).toBe('refresh')
  })

  it('混合条目：同文件一条维持一条需刷新 → refresh（任一不匹配即刷新）', () => {
    const out = plan(
      [
        { src: './a.png', fsKey: 'k1', state: 'error', reason: 'not-found' },
        { src: 'assets/a.png', fsKey: 'k1', state: 'loaded' },
      ],
      { k1: { kind: 'missing' } },
      { k1: null },
    )
    expect(out.get('k1')).toBe('refresh')
  })
})

describe('按规范化目标去重', () => {
  it('同 fsKey 多 src 归并为一次判定', () => {
    const out = plan(
      [
        { src: './a.png', fsKey: 'k1', state: 'loaded' },
        { src: 'assets/a.png', fsKey: 'k1', state: 'loaded' },
        { src: './b.png', fsKey: 'k2', state: 'loaded' },
      ],
      { k1: { kind: 'ok', ...STAT_B }, k2: { kind: 'ok', ...STAT_A } },
      { k1: STAT_A, k2: STAT_A },
    )
    expect(out.get('k1')).toBe('refresh')
    expect(out.get('k2')).toBe('current')
  })
})
