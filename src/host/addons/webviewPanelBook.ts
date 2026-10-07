// #355 T06 编辑器面板桥的 webview 身份簿（纯逻辑）。
//
// 背景（集成实测缺陷）：面板桥以 sessionId 为键登记 record，而 sessionId
// 是 session 内局部名（每个文档会话都从 panel-1 起）——跨会话重名。旧面板
// 的 onDidDispose 可能晚于新面板的首条 addonPage.ready 到达，两个竞态都会
// 让装载指令投递到已销毁的 webview（异常被吞）而新面板永远等不到
// addon.load：
// 1. 新面板 ready 命中旧 record → push 发到死 webview；
// 2. 迟到的旧 dispose 删掉新面板的 record → 后续通道消息无路由。
//
// 身份簿钉住的不变量：record.webview 恒属于「最近一次就绪面板」。
// - settle：webview 实例不同即替换（同名新面板，pushed 对账基线归零——
//   新面板的装载器是新生命周期，必须全量重推）；同一实例幂等返回。
// - disposed：webview 匹配才删除——迟到的旧面板 dispose 不误删新 record。
// 设置页面板桥的 ensureRecord（addonWiring 内）是同一对账语义的单面板特例。
export interface PanelBookRecord<W> {
  readonly webview: W
  /** 本面板已推送的装载（addonId → generation；desired 对账用） */
  readonly pushed: Map<string, number>
}

export class WebviewPanelBook<W> {
  private readonly records = new Map<string, PanelBookRecord<W>>()

  /** 消息路由/指令推送前的身份对账：返回对账后的 record（总是可用） */
  settle(sessionId: string, webview: W): PanelBookRecord<W> {
    const existing = this.records.get(sessionId)
    if (existing && existing.webview === webview) {
      return existing
    }
    const fresh: PanelBookRecord<W> = { webview, pushed: new Map() }
    this.records.set(sessionId, fresh)
    return fresh
  }

  get(sessionId: string): PanelBookRecord<W> | undefined {
    return this.records.get(sessionId)
  }

  /** 面板销毁：webview 匹配才删除（迟到 dispose 不误删新面板 record） */
  disposed(sessionId: string, webview: W): void {
    const existing = this.records.get(sessionId)
    if (existing && existing.webview === webview) {
      this.records.delete(sessionId)
    }
  }
}
