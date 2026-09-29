# 规格：编辑器工具栏刷新按钮与嵌入缓存手动刷新

状态：已确认待实施（工单 [#208](https://github.com/ONEGAYI/vsidian/issues/208)；共识经 2026-09-29 三轮访谈确认）。本文是手动刷新入口与图片缓存失效通道的单一事实源，工单验收以此为准。

## 范围

- **覆盖**：webview 编辑器顶栏（`.vsidian-toolbar`）右端组新增刷新按钮；配套的宿主↔webview 手动刷新通道（宿主解析缓存失效 + 图片 URI 代次换戳 + webview 解析条目失效重挂）；Mermaid 懒加载失败终态重置。
- **排除**：磁盘变更自动监听与周期核验（#201 承担自动路径）；右键菜单「刷新」项（保持 2026-09 菜单批次边界）；精准 mtime 逐图比对换戳；KaTeX/语法高亮等键为源码的渲染缓存清理。

## 现状要点（勘察 2026-09-29，行号基于 6ff990c）

- **工具栏**：`buildToolbar`（`src/webview/syncController.ts:3430-3492`）DOM 序为齿轮、✎ 快速操作、双态切换、侧栏；右端组 = 双态切换（持有 `margin-left:auto` 推靠）+ 侧栏（`src/webview/main.css:604-611`）。DOM 序被 `test/unit/toolbarViewToggle.test.ts:51-59` 钉住；样式契约登记在 `src/shared/styleContract.ts:2217-2232`（toolbar 条目）与探针表 `src/shared/chromeContract.ts:82-83`。顶栏按钮均为**内联 SVG**（`createSettingsGearIcon` 等，`syncController.ts:7836-7918`），不走 media 图标管线。
- **图片三层缓存（过期根源）**：宿主 `resolveWorkspaceImage`（`src/host/textEditorProvider.ts:1979-1999`）产出的 `asWebviewUri` 地址**无版本戳**——对照 CSS 片段 URI 明确带 `?v=` 缓存击穿参数并注明「webview 资源服务不承诺无缓存」（`textEditorProvider.ts:213-216,235`）；宿主 `imageCache` 16 条 FIFO，唯一清空入口 `dispose()`，无运行期失效 API（`src/host/documentSession.ts:220-222,739-753`）；webview `ImageResourceManager.entries` 仅在槽位全 detach 或解析失败重试时回收（`src/webview/imageResource.ts:160-163,291-297`）。三层叠加：同名图片被外部替换后地址不变、缓存不复析、HTTP 缓存可命中旧图。加载失败重试亦只重新应用同一地址（`imageResource.ts:286-289`），不构成穿透。
- **Mermaid 终态**：懒加载注入失败置 `loadFailed` 终态不再重试（`src/webview/mermaidRender.ts:59-61,119-121`）。
- **不过期的缓存**：KaTeX（键 `displayMode\0tex`）、语法高亮（键 `languageId\0code`）等缓存键即源码，源码未变不过期，刷新不清。
- **协议**：`src/shared/protocol.ts` 无任何资源刷新/缓存清空消息；全量重同步语义由 `init` / `doc.resync` 承担（`protocol.ts:33-45`），但两者均不触及图片缓存与 URI，不解决过期问题。

## 已确认决策（2026-09-29 访谈）

1. **位置**：工具栏右端组内第三（从右到左：侧栏、双态切换、刷新）；`margin-left:auto` 推右规则自双态切换**迁移**至刷新按钮，DOM 序变为齿轮、✎、刷新、双态切换、侧栏；弹性间隙移至 ✎ 与刷新之间。
2. **作用范围**：仅当前文档面板。
3. **状态保持**：光标/选区、滚动位置、三态视图模式、查找会话全部原样保持——刷新 = 清缓存重渲染，不是重开文件。
4. **清理范围**：图片资源链（宿主 `imageCache` + webview `entries`）+ 图片 URI 全局代次换戳 + Mermaid `loadFailed` 终态重置；其余渲染缓存不动。
5. **版本戳策略**：全局代次自增（每次刷新资源代次计数器 +1，全部图片 URI 统一换新戳重新加载，视口内图片重载闪动可接受）。
6. **快捷键**：注册可绑定入口，默认不绑定，Live 与阅读双模式生效；`docs/specs/keybindings.md` 同步。
7. **右键菜单**：不加项。
8. **自动监听**：不做（#201 承担）。
9. **图标与文案**：内联 SVG 循环箭头（顶栏先例，不引 codicon 依赖）；tooltip/aria 经 `bindLocaleAttrs` 进 localeDom 注册表，键形如 `toolbar.refresh`，双语言包同写。

## 行为契约

1. **点击行为**：webview 出站刷新请求 → 宿主清 `imageCache`、资源代次自增 → 通知 webview 全量失效重解析：现有活跃图片槽位全部重新走解析（新 URI 带新代次戳），命中后 `<img>` 换 src 重载；Mermaid 注入终态重置允许重新懒加载。
2. **无破坏性**：不重赋 `webview.html`、不重建面板、不动文档内容与撤销栈（撤销权威栈在宿主）；刷新不改变 Markdown 内容与 dirty 状态。
3. **键盘可达**：原生 button，Tab 可达、Enter/Space 激活；`mousedown preventDefault` 防抢正文焦点（沿用 ✎ 与双态切换策略）。
4. **快捷键入口**：新操作（如 `refreshEditor`，command `onegayi.vsidian.editor.refresh`）进键位注册表，mode `both`、默认未绑定；触发走既有 `keybindings.execute` 出站 → 宿主 executeCommand → 回发 webview 执行，与工具栏按钮共用同一实现，不另造路径。

## 与 #201 的关系

#201（自动图片核验刷新，分支 `codex/vault-index-backlinks` 未合并）与本票针对同一根源，其验收条件「mtime/size 变化使宿主缓存、webview 条目和资源 URL 版本同步失效」与本票的失效通道语义同构。分工：#201 承担**自动**路径（文件事件 + 30 秒周期核验、按图精准失效），本票承担**手动**路径（用户即时触发、全局代次全量失效）。本票基于 main 独立实施、自建最小失效通道；两票合并顺序无论谁先，**后合并方负责对齐失效通道**（消重复实现，手动入口改为调用统一通道）。叠加依赖不可取：#201 整体验收未结，返工会连带。

## 实施决策

- **协议**：出站消息命名循 protocol.ts 既有风格（如 `refresh.request`）；宿主回发与 reqId 配对按既有 image 通道惯例；契约测试同步。
- **宿主**：`documentSession` 增资源代次计数器与 `imageCache` 运行期清空入口；`resolveWorkspaceImage` 产出的 webview URI 追加 `?v=<代次>`（仅本地/远程工作区相对路径图源；HTTPS 直连图源不经宿主，不在本票范围）。
- **webview**：`ImageResourceManager` 增全量失效重挂入口（清 `entries` 后对当前活跃槽位重新 attach 发新 reqId）；live 侧 widget 装饰缓存与阅读侧块挂载钩子复用既有生命周期，不新造渲染路径。
- **工具栏**：`buildToolbar` 在双态切换前插入；`margin-left:auto` 规则迁移至新按钮；`toolbarViewToggle.test.ts` DOM 序断言、`styleContract.ts` toolbar 条目、`chromeContract.ts` 探针表同步更新（style-contract 技能流程：修改前固定旧契约）。

## 验证与完成条件

- **测试**：协议契约单测；jsdom 控制器单测（按钮存在、DOM 序、tooltip 换包重刷、点击出站消息）；集成（真宿主点击刷新，测试钩子观测代次变化与图片 URI 换戳）。
- **视觉层断言**：按钮绘制层可见 + DOM 序契约钉住（评审必查：断言对象必须是用户看到的东西）。
- **回归与文档**：compile / test:unit / test:browser / test:integration；更新 keybindings.md、README 双语、人工验证清单、CHANGELOG、文件树。
- **用户人工验收**：右端组内第三的位置观感；同名图片被外部替换后点刷新立即显示新图；刷新后光标/滚动/视图模式原样。

Blocked by: 无（合并顺序与 #201 协调，见「与 #201 的关系」）。
