// genNls.mjs 的最小类型面：仅声明 TS 侧（nlsManifest 契约测试）消费的
// 导出；完整签名与行为约束见 genNls.mjs 的 JSDoc（.mjs 为单一事实源，
// 此处签名漂移由契约测试的运行时断言兜底）。
export interface NlsIo {
  readFileSync(path: string, encoding?: string): string
  writeFileSync(path: string, content: string, encoding?: string): void
}
export declare function syncNlsOutputs(
  root: string,
  outputs: [string, string][],
  io: NlsIo,
  options: { write: boolean },
): string[]
