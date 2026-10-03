import { describe, expect, it } from 'vitest'
import { PasteHistoryTracker } from '../../src/host/pasteHistoryTracker'
import type { PasteHistory } from '../../src/shared/protocol'

const metadata = (stage: 'text' | 'format', group = 's:paste-1'): PasteHistory => ({ group, stage, sessionId: 's', hasTextStep: true,
  before: { ranges: [{ anchor: 0, head: 3 }], mainIndex: 0 }, after: { ranges: [{ anchor: 3, head: 3 }], mainIndex: 0 } })

describe('仅解释真实宿主历史的粘贴元数据', () => {
  it('长段源码输入合并撤销后仍识别较早粘贴阶段，不设置任意提示深度上限', () => {
    const tracker = new PasteHistoryTracker('旧')
    tracker.observe([{ offset: 0, length: 1, text: '新' }], '新', undefined, metadata('text'))
    tracker.observe([{ offset: 0, length: 1, text: '**新**' }], '**新**', undefined, metadata('format'))
    for (let i = 0; i < 300; i++) tracker.observe([{ offset: 5 + i, length: 0, text: 'x' }], '**新**' + 'x'.repeat(i + 1))
    expect(tracker.observe([{ offset: 5, length: 300, text: '' }], '**新**', 'undo')).toBeUndefined()
    expect(tracker.observe([{ offset: 0, length: 5, text: '新' }], '新', 'undo')).toMatchObject({ stage: 'format' })
  })
  it('真实Undo/Redo精确匹配阶段，常规输入先撤掉再撤格式仍保留归属', () => {
    const tracker = new PasteHistoryTracker('旧内容')
    tracker.observe([{ offset: 0, length: 3, text: '新内容' }], '新内容', undefined, metadata('text'))
    tracker.observe([{ offset: 0, length: 3, text: '**新内容**' }], '**新内容**', undefined, metadata('format'))
    tracker.observe([{ offset: 7, length: 0, text: 'x' }], '**新内容**x')
    tracker.observe([{ offset: 8, length: 0, text: 'y' }], '**新内容**xy')
    tracker.observe([{ offset: 9, length: 0, text: 'z' }], '**新内容**xyz')
    expect(tracker.observe([{ offset: 7, length: 3, text: '' }], '**新内容**', 'undo')).toBeUndefined()
    expect(tracker.observe([{ offset: 0, length: 7, text: '新内容' }], '新内容', 'undo')).toMatchObject({ stage: 'format', group: 's:paste-1' })
    expect(tracker.observe([{ offset: 0, length: 3, text: '旧内容' }], '旧内容', 'undo')).toMatchObject({ stage: 'text' })
    expect(tracker.observe([{ offset: 0, length: 3, text: '新内容' }], '新内容', 'redo')).toMatchObject({ stage: 'text' })
    expect(tracker.observe([{ offset: 0, length: 3, text: '**新内容**' }], '**新内容**', 'redo')).toMatchObject({ stage: 'format' })
  })
  it('普通取消/恢复粗体复用同样变更时不误报；同内容连续粘贴按组区分', () => {
    const tracker = new PasteHistoryTracker('旧内容')
    tracker.observe([{ offset: 0, length: 3, text: '新内容' }], '新内容', undefined, metadata('text'))
    tracker.observe([{ offset: 0, length: 3, text: '**新内容**' }], '**新内容**', undefined, metadata('format'))
    tracker.observe([{ offset: 0, length: 7, text: '新内容' }], '新内容')
    tracker.observe([{ offset: 0, length: 3, text: '**新内容**' }], '**新内容**')
    expect(tracker.observe([{ offset: 0, length: 7, text: '新内容' }], '新内容', 'undo')).toBeUndefined()
    expect(tracker.observe([{ offset: 0, length: 3, text: '**新内容**' }], '**新内容**', 'undo')).toBeUndefined()
    expect(tracker.observe([{ offset: 0, length: 7, text: '新内容' }], '新内容', 'undo')).toMatchObject({ group: 's:paste-1' })
    tracker.observe([{ offset: 0, length: 3, text: '新内容' }], '新内容', undefined, metadata('text', 's:paste-2'))
    tracker.observe([{ offset: 0, length: 3, text: '**新内容**' }], '**新内容**', undefined, metadata('format', 's:paste-2'))
    expect(tracker.observe([{ offset: 0, length: 7, text: '新内容' }], '新内容', 'undo')).toMatchObject({ group: 's:paste-2' })
  })
  it('没有真实reason、错误增量或未知Undo不能按相等文本伪造格式撤销', () => {
    const tracker = new PasteHistoryTracker('新')
    tracker.observe([{ offset: 0, length: 1, text: '**新**' }], '**新**', undefined, metadata('format'))
    expect(tracker.observe([{ offset: 0, length: 5, text: '新' }], '新')).toBeUndefined()
    expect(tracker.observe([{ offset: 0, length: 1, text: '**新**' }], '**新**', 'undo')).toBeUndefined()
    expect(tracker.observe([{ offset: 99, length: 1, text: '错误' }], '变化', 'undo')).toBeUndefined()
  })
})
