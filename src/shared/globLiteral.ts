// B-1（review-loops 波次一）：text 引用目标 per-file 磁盘 watcher 的
// 文件名字面量转义。VSCode FileSystemWatcher 的 pattern 经
// vs/base/common/glob 引擎解析（按 1.82.3 源码核对，tag 1.82.3 的
// glob.ts parseRegExp）：
// - `[`/`]` 字符类、`*`/`?` 通配、`{`/`}` brace 展开是元字符——文件名
//   中的裸元字符会错配同目录其他文件（`a[b].txt` 按字符类匹配 `ab.txt`）
//   或前缀匹配（孤立的 `}` 产出空可选项，`a}` 会匹配所有 `a*`）；
// - 字符类**内部**的元字符按字面量解析（escapeRegExpCharacters 转义），
//   且 `]` 作为字符类首字符亦为字面量（glob.ts 162 行注释与分支）。
// 转义因此 = 把每个元字符包成单字符类 `[X]`（POSIX glob 惯例形态）。
// VSCode 未公开 escape API，本模块是对其内部引擎行为的定点适配；
// 引擎语义变化时以真宿主集成用例（磁盘替换 changed 推送）为回归锚。
//
// 两端共享纯逻辑（无 vscode/DOM 依赖；宿主侧 watcher 装配在
// textEditorProvider 消费）。

/** 文件名字面量 → glob pattern 安全形态（元字符逐个字符类包裹） */
export function escapeGlobFilenameLiteral(name: string): string {
  return name.replace(/[[\]*?{}]/g, (ch) => `[${ch}]`)
}
