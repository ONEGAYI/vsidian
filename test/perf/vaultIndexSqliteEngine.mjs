// 引用索引 SQLite 对照引擎（工单 #195 选型对照候选，不接入扩展运行时）。
//
// 用 sql.js（WASM 编译的 SQLite，纯 JS 依赖、可在 1.86 宿主 Node 18 加载）
// 实现与 src/shared/vaultIndexSnapshot.ts 分片快照相同的索引数据与操作集：
// 首次构建 / 冷启动恢复 / 单文件更新 / 批量变更 / 反链查询。两端喂同一
// VaultIndexModel，结果经 test/unit/vaultIndexSqliteCompare.test.ts 契约
// 对齐（往返等价）。零 vscode 依赖，可被基准脚本与 vitest 直驱。
//
// 本模块是研究对照物：生产选型若不采用 SQLite，此文件随基准归档保留，
// 不进 src/（sql.js 是 devDependency，不进扩展 bundle）。
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 加载 sql.js WASM 运行时（每进程一次）。用 createRequire 直载 UMD
 *  产物：vitest/vite 的 ESM 转换管线处理该 1.5 MB Emscripten 胶水会
 *  触发内存失控，require 路径在 Node 与 vitest（node 环境）下均正常。 */
export async function loadSqlJs() {
  const initSqlJs = require('sql.js')
  const distDir = path.dirname(require.resolve('sql.js'))
  return initSqlJs({ locateFile: (file) => path.join(distDir, file) })
}

const FILE_KIND_CODE = { markdown: 0, asset: 1 }
const FILE_KIND_NAME = ['markdown', 'asset']
const EDGE_KIND_CODE = { wikilink: 0, mdlink: 1, image: 2, refdef: 3 }
const EDGE_KIND_NAME = ['wikilink', 'mdlink', 'image', 'refdef']

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  kind INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  content_version INTEGER NOT NULL
);
CREATE TABLE edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  resolved_target TEXT,
  kind INTEGER NOT NULL,
  anchor TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);
CREATE INDEX idx_edges_source ON edges(source);
CREATE INDEX idx_edges_resolved ON edges(resolved_target);
`

function edgeRow(e) {
  return [e.source, e.target, e.resolvedTarget, EDGE_KIND_CODE[e.kind], e.anchor ?? '', e.start, e.end]
}

/** 基于既有 SQL.Database（内存或从字节加载）包装对照操作集。 */
export function wrapSqliteDb(SQL, db) {
  function insertEdges(edges) {
    const stmt = db.prepare('INSERT INTO edges VALUES (?,?,?,?,?,?,?)')
    try {
      for (const e of edges) stmt.run(edgeRow(e))
    } finally {
      stmt.free()
    }
  }

  function insertFiles(entries) {
    const stmt = db.prepare('INSERT INTO files VALUES (?,?,?,?,?)')
    try {
      for (const f of entries) stmt.run([f.path, FILE_KIND_CODE[f.kind], f.mtimeMs, f.size, f.contentVersion])
    } finally {
      stmt.free()
    }
  }

  return {
    db,

    /** 首次构建：全量建库（单事务）。 */
    bulkBuild(model) {
      db.run('BEGIN')
      try {
        db.run(SCHEMA)
        insertFiles([...model.files.values()])
        insertEdges(model.edges)
        db.run("INSERT INTO meta VALUES ('generation', '1')")
        db.run('COMMIT')
      } catch (err) {
        db.run('ROLLBACK')
        throw err
      }
    },

    /** 导出为 SQLite 数据库文件字节（落盘即持久形态）。 */
    export() {
      return db.export()
    },

    /** 全量读回为 VaultIndexModel（内存关系表等价物）。 */
    readModel() {
      const files = new Map()
      let stmt = db.prepare('SELECT path, kind, mtime_ms, size, content_version FROM files')
      try {
        while (stmt.step()) {
          const row = stmt.getAsObject()
          files.set(row.path, {
            path: row.path,
            kind: FILE_KIND_NAME[row.kind],
            mtimeMs: row.mtime_ms,
            size: row.size,
            contentVersion: row.content_version,
          })
        }
      } finally {
        stmt.free()
      }
      const edges = []
      stmt = db.prepare('SELECT source, target, resolved_target, kind, anchor, start_offset, end_offset FROM edges ORDER BY source, start_offset, end_offset, target')
      try {
        while (stmt.step()) {
          const row = stmt.getAsObject()
          edges.push({
            source: row.source,
            target: row.target,
            resolvedTarget: row.resolved_target === null ? null : row.resolved_target,
            kind: EDGE_KIND_NAME[row.kind],
            anchor: row.anchor ?? '',
            start: row.start_offset,
            end: row.end_offset,
          })
        }
      } finally {
        stmt.free()
      }
      return { files, edges }
    },

    /** 单文件更新：元数据覆盖 + 该来源出链整组重写（单事务）。 */
    pointUpdate(entry, sourceEdges) {
      db.run('BEGIN')
      try {
        db.run(
          'INSERT INTO files VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, mtime_ms=excluded.mtime_ms, size=excluded.size, content_version=excluded.content_version',
          [entry.path, FILE_KIND_CODE[entry.kind], entry.mtimeMs, entry.size, entry.contentVersion],
        )
        db.run('DELETE FROM edges WHERE source = ?', [entry.path])
        insertEdges(sourceEdges)
        db.run('COMMIT')
      } catch (err) {
        db.run('ROLLBACK')
        throw err
      }
    },

    /** 批量变更：多文件同批一个事务（目录移动/Git 切换类负载）。 */
    batchUpdate(updates) {
      db.run('BEGIN')
      try {
        for (const { entry, edges } of updates) {
          db.run(
            'INSERT INTO files VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, mtime_ms=excluded.mtime_ms, size=excluded.size, content_version=excluded.content_version',
            [entry.path, FILE_KIND_CODE[entry.kind], entry.mtimeMs, entry.size, entry.contentVersion],
          )
          db.run('DELETE FROM edges WHERE source = ?', [entry.path])
          insertEdges(edges)
        }
        db.run('COMMIT')
      } catch (err) {
        db.run('ROLLBACK')
        throw err
      }
    },

    /** 反链查询：按解析后目标取全部来源边（与 buildBacklinkIndex 同口径）。
     *  sql.js 语义注意：run() 内部会 step 一次（消费首行），参数化查询
     *  用 bind + step 循环，否则单行结果被吃掉。 */
    backlinks(resolvedTarget) {
      const rows = []
      const stmt = db.prepare('SELECT source, target, kind, anchor, start_offset, end_offset FROM edges WHERE resolved_target = ? ORDER BY source, start_offset, end_offset, target')
      try {
        stmt.bind([resolvedTarget])
        while (stmt.step()) {
          const row = stmt.getAsObject()
          rows.push({ source: row.source, target: row.target, kind: EDGE_KIND_NAME[row.kind], anchor: row.anchor ?? '', start: row.start_offset, end: row.end_offset })
        }
      } finally {
        stmt.free()
      }
      return rows
    },

    stats() {
      const count = (table) => db.exec(`SELECT count(*) FROM ${table}`)[0].values[0][0]
      return { files: count('files'), edges: count('edges') }
    },
  }
}

/** 新建内存库。 */
export function createSqliteIndex(SQL) {
  return wrapSqliteDb(SQL, new SQL.Database())
}

/** 从导出字节冷加载（对应快照引擎的 loadSnapshot）。 */
export function openSqliteIndex(SQL, bytes) {
  return wrapSqliteDb(SQL, new SQL.Database(bytes))
}
