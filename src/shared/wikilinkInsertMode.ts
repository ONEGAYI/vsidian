// 双链插入路径三档值域（#556）：webview 安全的零依赖单一事实源。
//
// 常量本体从 wikilinkQuery 抽离（后者 import node:path 并依赖 vaultLink，
// 而 shared/settings.ts（设置页 webview 产物消费）需要引用值域——若直接
// 引 wikilinkQuery 会把 node:path 拖进 browser 平台打包，esbuild 解析
// 失败）。wikilinkQuery 从本模块 re-export，消费方引用面不变。

/** 插入路径三档（#556 规格「最短形式与三档路径」）：shortest=依次核对取最短；
 *  relative=来源相对（默认，现状风格）；absolute=宿主完整路径。档位值即
 *  设置 link.insertPathType 的值域（设置侧以此为单一事实源，不另写第二份）。 */
export const WIKILINK_INSERT_PATH_MODES = ['shortest', 'relative', 'absolute'] as const
export type WikilinkInsertPathMode = (typeof WIKILINK_INSERT_PATH_MODES)[number]
