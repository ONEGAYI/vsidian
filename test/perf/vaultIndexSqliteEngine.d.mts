// vaultIndexSqliteEngine.mjs 的最小类型面：仅声明 TS 侧（对照契约测试）
// 消费的导出；完整签名与行为约束见 .mjs 的 JSDoc（.mjs 为单一事实源，
// 签名漂移由对照契约测试的运行时断言兜底——先例 scripts/genNls.d.mts）。
import type { VaultFileEntry, VaultIndexModel } from '../../src/shared/vaultIndexModel'

export interface SqlJsStatement {
  run(params?: unknown[]): void
  bind(params?: unknown[]): void
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
}

export interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void
  prepare(sql: string): SqlJsStatement
  exec(sql: string): { columns: string[]; values: unknown[][] }[]
  export(): Uint8Array
}

export interface SqlJsModule {
  Database: new (data?: Uint8Array | ArrayBuffer | null) => SqlJsDatabase
}

export interface SqliteBacklinkRow {
  source: string
  target: string
  kind: string
  anchor: string
  start: number
  end: number
}

export interface SqliteIndexHandle {
  db: SqlJsDatabase
  bulkBuild(model: VaultIndexModel): void
  export(): Uint8Array
  readModel(): VaultIndexModel
  pointUpdate(entry: VaultFileEntry, sourceEdges: VaultIndexModel['edges']): void
  batchUpdate(updates: { entry: VaultFileEntry; edges: VaultIndexModel['edges'] }[]): void
  backlinks(resolvedTarget: string): SqliteBacklinkRow[]
  stats(): { files: number; edges: number }
}

export declare function loadSqlJs(): Promise<SqlJsModule>
export declare function wrapSqliteDb(SQL: SqlJsModule, db: SqlJsDatabase): SqliteIndexHandle
export declare function createSqliteIndex(SQL: SqlJsModule): SqliteIndexHandle
export declare function openSqliteIndex(SQL: SqlJsModule, bytes: Uint8Array): SqliteIndexHandle
