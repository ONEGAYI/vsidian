/** #272 测试专用传播日志。默认关闭；不记录正文，不主动读 DOM 或调度任务。 */
export interface DiagnosticEvent {
  seq: number
  at: number
  stage: string
  data: Record<string, string | number | boolean | null>
}
export interface DiagnosticSnapshot { events: DiagnosticEvent[]; dropped: number }
export const DIAGNOSTIC_LIMIT = 256

export class TestDiagnostics {
  enabled = false
  private events: DiagnosticEvent[] = []
  private seq = 0
  private dropped = 0
  constructor(private readonly now: () => number = Date.now) {}
  reset(enabled: boolean): void { this.enabled = enabled; this.events = []; this.seq = 0; this.dropped = 0 }
  record(stage: string, data: DiagnosticEvent['data'] = {}): void {
    if (!this.enabled) return
    const bounded = Object.fromEntries(Object.entries(data).slice(0, 12)
      .map(([key, value]) => [key.slice(0, 64), typeof value === 'string' ? value.slice(0, 192) : value]))
    this.events.push({ seq: ++this.seq, at: this.now(), stage: stage.slice(0, 96), data: bounded })
    if (this.events.length > DIAGNOSTIC_LIMIT) { this.events.shift(); this.dropped++ }
  }
  snapshot(): DiagnosticSnapshot {
    return { events: this.events.map((event) => ({ ...event, data: { ...event.data } })), dropped: this.dropped }
  }
}

/** 只允许传播身份及状态字段进入日志，正文、变更文本与资源 URI 不进入。 */
export function recordDiagnosticMessage(trace: TestDiagnostics, direction: string, message: unknown): void {
  if (!trace.enabled || !message || typeof message !== 'object') return
  const value = message as Record<string, unknown>
  if (typeof value.kind !== 'string' || !/^(hover\.|snippets\.|view\.mode\.set|init$)/.test(value.kind)) return
  const data: DiagnosticEvent['data'] = {}
  for (const key of ['reqId', 'instanceId', 'docUri', 'sessionId', 'fsPath', 'version', 'generation', 'ok', 'reason', 'status', 'mode']) {
    const v = value[key]
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) data[key] = v
  }
  if (value.target && typeof value.target === 'object') {
    const target = value.target as Record<string, unknown>
    if (typeof target.fsPath === 'string') data.fsPath = target.fsPath
  }
  if (value.source && typeof value.source === 'object') {
    const source = value.source as Record<string, unknown>
    if (typeof source.sourceDocUri === 'string') data.sourceDocUri = source.sourceDocUri
    if (typeof source.parentInstanceId === 'string') data.parentInstanceId = source.parentInstanceId
  }
  if (Array.isArray(value.snippets)) data.entries = value.snippets.slice(0, 16).map((item: unknown) => {
    if (!item || typeof item !== 'object') return '?'
    const snippet = item as { name?: unknown; v?: unknown }
    return `${typeof snippet.name === 'string' ? snippet.name : '?'}:${snippet.v ?? value.version}`
  }).join('|')
  trace.record(`${direction}.${value.kind}`, data)
}

export function isDiagnosticSnapshot(value: unknown): value is DiagnosticSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as DiagnosticSnapshot
  return Number.isInteger(snapshot.dropped) && snapshot.dropped >= 0 && Array.isArray(snapshot.events) &&
    snapshot.events.length <= DIAGNOSTIC_LIMIT && snapshot.events.every((event) =>
      event && Number.isInteger(event.seq) && event.seq > 0 && Number.isFinite(event.at) &&
      typeof event.stage === 'string' && event.stage.length <= 96 && event.data &&
      typeof event.data === 'object' && !Array.isArray(event.data) && Object.keys(event.data).length <= 12 &&
      Object.entries(event.data).every(([key, v]) => key.length <= 64 && (v === null ||
        typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 192))))
}
