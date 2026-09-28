// 图片资源版本表契约（工单 #201）：宿主侧缓存击穿与失效判定的单一状态源。
// 语义来自 #194「图片定期刷新与删除态」节：
// - 解析请求路径：mtime/size 与最后已知不同（含缺失→存在）才推进代次；
//   相同不推进（未变化不重载，URI 稳定让浏览器缓存可用）
// - 事件路径（watcher / onTargetChange）：收到变更事件即使元数据相同仍
//   失效（防 mtime 粒度漏检），无条件推进代次
// - 缺失观察：存在→缺失推进代次并把最后已知置空（恢复时必检出）；
//   已缺失的重复观察不变（周期核验维持态不扰动）
// - 键归一：路径分隔符/相对段/尾分隔符归一后同键（按规范化目标 URI 去重）
import { describe, expect, it } from 'vitest'
import { ImageVersionTable, imageFsKey } from '../../src/host/imageVersioning'

const STAT_A = { mtimeMs: 1_000, size: 100 }
const STAT_A2 = { mtimeMs: 2_000, size: 100 }
const STAT_B = { mtimeMs: 1_000, size: 200 }

describe('imageFsKey：规范化目标 URI 去重键', () => {
  it('Windows 宿主：分隔符与大小写归一为同一键', () => {
    expect(imageFsKey('C:\\repo\\assets\\a.png', true)).toBe(imageFsKey('c:/repo/assets/a.png', true))
  })

  it('Windows 宿主：尾分隔符与相对段归一', () => {
    expect(imageFsKey('C:\\repo\\assets\\..\\assets\\a.png\\', true)).toBe(imageFsKey('C:/repo/assets/a.png', true))
  })

  it('POSIX 宿主：保持大小写敏感、反斜杠是文件名字符', () => {
    expect(imageFsKey('/home/u/repo/a.png', false)).toBe(imageFsKey('/home/u/repo/./a.png', false))
    expect(imageFsKey('/home/u/repo/a.png', false)).not.toBe(imageFsKey('/home/u/repo/A.png', false))
    expect(imageFsKey('/home/u/repo/a\\b.png', false)).toContain('a\\b.png')
  })

  it('Windows 宿主下 POSIX 形态路径按 win32 语义归一（UNC 与盘符不混）', () => {
    expect(imageFsKey('/c/repo/a.png', true)).not.toBe(imageFsKey('C:\\repo\\a.png', true))
  })
})

describe('解析请求路径观察（recordObservation）', () => {
  it('首次观察建立代次 1，不视为变化', () => {
    const table = new ImageVersionTable(true)
    expect(table.recordObservation('C:/r/a.png', STAT_A)).toEqual({ generation: 1, changed: false })
    expect(table.generationOf('C:/r/a.png')).toBe(1)
  })

  it('mtime 或 size 变化推进代次并标记 changed', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:/r/a.png', STAT_A)
    expect(table.recordObservation('C:/r/a.png', STAT_A2)).toEqual({ generation: 2, changed: true })
    expect(table.recordObservation('C:/r/a.png', STAT_B)).toEqual({ generation: 3, changed: true })
  })

  it('元数据相同不推进代次（URI 稳定）', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:/r/a.png', STAT_A)
    expect(table.recordObservation('C:/r/a.png', STAT_A)).toEqual({ generation: 1, changed: false })
  })

  it('缺失→存在：即使元数据与缺失前相同也推进代次（删除重建检出）', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:/r/a.png', STAT_A)
    table.recordMissing('C:/r/a.png')
    expect(table.recordObservation('C:/r/a.png', STAT_A)).toEqual({ generation: 3, changed: true })
  })
})

describe('缺失观察（recordMissing）', () => {
  it('存在→缺失推进代次，最后已知置空', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:/r/a.png', STAT_A)
    expect(table.recordMissing('C:/r/a.png')).toEqual({ generation: 2, changed: true })
    expect(table.lastKnownOf('C:/r/a.png')).toBeNull()
  })

  it('已缺失的重复观察不推进（周期核验维持态零扰动）', () => {
    const table = new ImageVersionTable(true)
    table.recordMissing('C:/r/a.png')
    expect(table.recordMissing('C:/r/a.png')).toEqual({ generation: 1, changed: false })
    expect(table.generationOf('C:/r/a.png')).toBe(1)
  })
})

describe('事件路径观察（recordEvent）', () => {
  it('收到事件即使元数据相同仍推进代次（无条件失效）', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:/r/a.png', STAT_A)
    expect(table.recordEvent('C:/r/a.png', STAT_A)).toBe(2)
    expect(table.recordEvent('C:/r/a.png', STAT_A)).toBe(3)
  })

  it('删除事件（stat null）推进代次并把最后已知置空', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:/r/a.png', STAT_A)
    expect(table.recordEvent('C:/r/a.png', null)).toBe(2)
    expect(table.lastKnownOf('C:/r/a.png')).toBeNull()
  })

  it('无历史的事件首代为 1', () => {
    const table = new ImageVersionTable(true)
    expect(table.recordEvent('C:/r/a.png', STAT_A)).toBe(1)
  })
})

describe('键去重（同文件多形态路径共享代次）', () => {
  it('Windows：正反斜杠与大小写混写的多 src 命中同一条目', () => {
    const table = new ImageVersionTable(true)
    table.recordObservation('C:\\Repo\\Assets\\图 片.png', STAT_A)
    expect(table.generationOf('c:/repo/assets/图 片.png')).toBe(1)
    expect(table.recordEvent('C:/REPO/ASSETS/图 片.png', STAT_A2)).toBe(2)
    expect(table.generationOf('C:\\repo\\assets\\图 片.png')).toBe(2)
  })

  it('lastKnownOf 未登记文件返回 null，generationOf 未登记返回 0', () => {
    const table = new ImageVersionTable(true)
    expect(table.lastKnownOf('C:/r/none.png')).toBeNull()
    expect(table.generationOf('C:/r/none.png')).toBe(0)
  })
})
