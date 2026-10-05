// pdfSample.mjs 的最小类型面：仅声明 TS 侧（集成用例）消费的导出；
// 完整签名与页色约定见 pdfSample.mjs 的 JSDoc（.mjs 为单一事实源，
// 此处签名漂移由测试的运行时断言兜底）。
export declare function buildThreePageColorPdf(): Promise<Buffer>
export declare function buildMultiPageColorPdf(pageCount: number): Promise<Buffer>
