// 跳转目标高亮契约（#163 验收反馈）：双链/普通链接锚点跳转（view.locate）
// 后目标标题/段落整体覆盖半透黄（类 vsidian-anchor-flash，颜色经
// --vsidian-anchor-flash-background 变量暴露），用户任意操作后消失。
// 本文件钉 live 侧：目标区间推导纯函数（标题行整行 / 块整块）与
// StateField 装配（set/clear）；消失监听与阅读块加类在 jsdom 控制器
// 测试（anchorFlashPanel）与浏览器断言覆盖。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import {
  anchorFlashClear,
  anchorFlashField,
  anchorFlashRangeOf,
  anchorFlashSet,
} from '../../src/webview/anchorFlash'

describe('anchorFlashRangeOf：跳转目标整体区间（标题整行 / 块整块）', () => {
  it('标题行：整行（ATX 单行即标题整体）', () => {
    const doc = '前置\n\n# 目标标题\n\n后文\n'
    const state = EditorState.create({ doc })
    expect(anchorFlashRangeOf(state.doc, doc.indexOf('# 目标标题')))
      .toEqual({ from: doc.indexOf('# 目标标题'), to: doc.indexOf('# 目标标题') + '# 目标标题'.length })
  })
  it('块首行/块中行：整块（多行段落从首行到尾行）', () => {
    const doc = '段一甲\n段一乙\n段一丙\n\n后文\n'
    const state = EditorState.create({ doc })
    const whole = { from: 0, to: '段一甲\n段一乙\n段一丙'.length }
    expect(anchorFlashRangeOf(state.doc, 0)).toEqual(whole)
    expect(anchorFlashRangeOf(state.doc, doc.indexOf('段一乙'))).toEqual(whole)
  })
  it('围栏块：整围栏（开闭围栏行之间，跳转围栏块 id 场景）', () => {
    const doc = '```js\nconst a = 1\n```\n\n后文\n'
    const state = EditorState.create({ doc })
    expect(anchorFlashRangeOf(state.doc, 0)).toEqual({ from: 0, to: '```js\nconst a = 1\n```'.length })
  })
  it('空行兜底：单行自身（定位点不应落在空行，防御性回退）', () => {
    const doc = '段一\n\n段二\n'
    const state = EditorState.create({ doc })
    expect(anchorFlashRangeOf(state.doc, doc.indexOf('\n\n') + 1))
      .toEqual({ from: doc.indexOf('\n\n') + 1, to: doc.indexOf('\n\n') + 1 })
  })
})

describe('anchorFlashField：高亮行装饰 set/clear', () => {
  const flashLines = (set: DecorationSet): string[] => {
    const out: string[] = []
    set.between(0, 1e9, (_f, _t, deco) => {
      if ((deco as { spec?: { class?: string } }).spec?.class === 'vsidian-anchor-flash') {
        out.push('hit')
      }
    })
    return out
  }
  it('set 后块内每行发射 line 装饰；clear 清空', () => {
    const doc = '段一甲\n段一乙\n\n后文\n'
    let state = EditorState.create({ doc, extensions: [anchorFlashField] })
    expect(flashLines(state.field(anchorFlashField))).toEqual([])
    state = state.update({ effects: anchorFlashSet.of({ from: 0, to: doc.indexOf('\n\n') }) }).state
    expect(flashLines(state.field(anchorFlashField))).toEqual(['hit', 'hit'])
    state = state.update({ effects: anchorFlashClear.of(null) }).state
    expect(flashLines(state.field(anchorFlashField))).toEqual([])
  })
  it('set(null) 同 clear（空载荷语义）', () => {
    const doc = '段一\n'
    let state = EditorState.create({ doc, extensions: [anchorFlashField] })
    state = state.update({ effects: anchorFlashSet.of({ from: 0, to: 2 }) }).state
    state = state.update({ effects: anchorFlashSet.of(null) }).state
    expect(flashLines(state.field(anchorFlashField))).toEqual([])
  })
})
