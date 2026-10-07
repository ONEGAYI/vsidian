// #355 T06 修复配套：编辑器面板桥的 webview 身份簿契约测试。
// 钉住的竞态时序（集成实测暴露：全量跑中 T06 六用例「页面产物就绪」
// 超时——addonPage.ready 命中已销毁面板的残留 record，装载指令投递到
// 死 webview 被吞，新面板永远等不到 addon.load）：
// - sessionId 是 session 内局部名（每个文档会话都从 panel-1 起），跨会话
//   重名；旧面板 onDidDispose 可能晚于新面板首条消息到达；
// - 身份簿保证 record.webview 恒属于「最近一次就绪面板」：同名新面板的
//   settle 替换旧 record；迟到的旧面板 disposed 不误删新 record。
import { describe, expect, it } from 'vitest'
import { WebviewPanelBook } from '../../src/host/addons/webviewPanelBook'

interface FakeWebview { readonly tag: string }

const w = (tag: string): FakeWebview => ({ tag })

describe('WebviewPanelBook：同名 sessionId 的面板身份对账', () => {
  it('settle 以 webview 实例为准：同名新面板替换旧 record（pushed 对账基线归零）', () => {
    const book = new WebviewPanelBook<FakeWebview>()
    const old = book.settle('panel-1', w('old'))
    old.pushed.set('addon-x', 3)
    // 新面板（同名 sessionId）就绪：旧 record 的 pushed 不得劫持新面板
    const freshWebview = w('fresh')
    const fresh = book.settle('panel-1', freshWebview)
    expect(fresh.webview.tag).toBe('fresh')
    expect(fresh.pushed.size).toBe(0)
    // 同一面板重复 settle：幂等返回同一 record（不重置 pushed）
    const again = book.settle('panel-1', freshWebview)
    expect(again).toBe(fresh)
    again.pushed.set('addon-y', 1)
    expect(book.settle('panel-1', freshWebview).pushed.get('addon-y')).toBe(1)
  })

  it('迟到 dispose 不误删新面板 record（webview 匹配才删除）', () => {
    const book = new WebviewPanelBook<FakeWebview>()
    book.settle('panel-1', w('old'))
    const freshWebview = w('fresh')
    const fresh = book.settle('panel-1', freshWebview)
    // 旧面板的 dispose 事件晚于新面板就绪到达
    book.disposed('panel-1', w('old'))
    expect(book.get('panel-1')).toBe(fresh)
    // 新面板自己销毁：正常删除
    book.disposed('panel-1', freshWebview)
    expect(book.get('panel-1')).toBeUndefined()
  })

  it('get 只认就绪面板（未 settle 过返回 undefined）', () => {
    const book = new WebviewPanelBook<FakeWebview>()
    expect(book.get('panel-9')).toBeUndefined()
  })

  it('完整竞态时序：旧面板消息 → 新面板就绪 → 旧 dispose 晚到 → 新面板指令照常', () => {
    const book = new WebviewPanelBook<FakeWebview>()
    const old = book.settle('panel-1', w('old'))
    old.pushed.set('addon-t06', 1)
    // 新文档会话的面板（同名 panel-1）装载器就绪
    const fresh = book.settle('panel-1', w('fresh'))
    // 旧面板 dispose 迟到
    book.disposed('panel-1', w('old'))
    // 新面板的指令对账不受影响：desired 对账从空 pushed 开始全量重推
    expect(book.get('panel-1')).toBe(fresh)
    expect(fresh.pushed.size).toBe(0)
  })
})
