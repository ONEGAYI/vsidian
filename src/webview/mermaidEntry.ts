// Mermaid 独立模块入口（工单 #60）：产出 out/webview/mermaid.js 与动态块（esbuild
// browser/esm/chrome118），宿主在 webview HTML 注入其资源 URI、webview
// 存在 mermaid 围栏时按需 <script> 加载——mermaid 不进主 bundle（约 2.7MB
// 会让每个 webview 启动都付出解析成本）。
//
// 为什么需要本入口而不是直接打包官方 UMD（dist/mermaid.min.js）：UMD 尾部
// 以 `globalThis.__esbuild_esm_mermaid_nm.mermaid.default` 完成全局自赋值，
// 该内部命名空间在独立脚本里是全局 var、被 esbuild 模块包裹后变成模块
// 作用域局部变量——globalThis 引用落空抛 TypeError，全局永远挂不上。经
// ESM 源（dist/mermaid.core.mjs）打包并由本入口显式挂全局即可，且 minify
// 后核心与图类型、ELK 引擎分别按需加载。
import mermaid from 'mermaid'
import elkLayouts from '@mermaid-js/layout-elk'
import type { MermaidApi } from './mermaidRender'
import { buildCodexMermaidConfig } from './mermaidTheme'

mermaid.registerLayoutLoaders(elkLayouts)
let baseConfig: Record<string, unknown> = {}
// 每张图先恢复站点配置，再按 Mermaid 自身识别结果应用对应图形预设。
// 预设不改写源码：init/frontmatter、classDef 与 style 仍由 Mermaid 解析。
const api: MermaidApi = {
  initialize(config) {
    baseConfig = config
    mermaid.initialize(config)
  },
  async render(id, code, preset = 'default') {
    mermaid.initialize(baseConfig)
    if (preset === 'codex') {
      const config = buildCodexMermaidConfig(mermaid.detectType(code), baseConfig.theme === 'dark')
      if (config) mermaid.initialize({ ...baseConfig, ...config })
    }
    return mermaid.render(id, code)
  },
}
;(globalThis as { mermaid?: unknown }).mermaid = api
