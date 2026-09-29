# Vsidian

**[English](https://github.com/ONEGAYI/vsidian/blob/main/README.en.md)** | 中文

Vsidian 在 VSCode 里提供接近 Obsidian 的 Markdown 编辑体验。安装后打开 `.md` 文件直接进入实时预览：文档以渲染后的样子呈现，光标移到标题、链接或公式上时显示对应源码，改完即恢复渲染；也可以切换到纯阅读模式，或随时回到原生源码编辑器。

- **实时预览与阅读都只渲染视口内的内容**：大型文档的滚动与编辑性能不随文件变大而下降。
- **类 Obsidian 的编辑习惯**：双链与块引用跳转、表格网格编辑、任务勾选、frontmatter 属性表、粘贴图片自动落盘、正文统一右键菜单，常用操作都在熟悉的位置。
- **样式入口公开**：内置 CSS 片段体系，公开样式契约在设置页离线查阅并可导出 JSON，Obsidian 原名选择器与 CSS 变量直接兼容。

## 安装

**扩展市场（推荐）**：VSCode（1.86+）扩展面板搜索 **Vsidian**，或打开 [Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=onegayi.vsidian)，安装后重启。

**VSIX 手动安装**：从 [GitHub Releases](https://github.com/ONEGAYI/vsidian/releases) 下载 `vsidian-*.vsix`，命令面板 →「Extensions: Install from VSIX…」选择该文件并重启。Remote SSH 场景在远端扩展目录安装同一 VSIX。

## 功能一览

### 编辑与格式

| 功能 | 说明 |
| --- | --- |
| 三态视图 | 实时预览、阅读、源码编辑器三态切换，最近模式与滚动位置跨窗口记住 |
| 统一右键菜单 | 实时预览正文右键弹出链接、格式、剪贴板三簇菜单，含级联子菜单、图标与快捷键提示 |
| 文本格式 | 命令面板与快速操作条覆盖粗体、斜体、高亮、标题六级、行内代码等，全部可绑定快捷键 |
| 快捷键管理 | 全部操作集中改绑（支持两段键），冲突检测、清空与恢复默认，清空后重启不回弹 |
| 查找 | Ctrl+F / Cmd+F（编辑器激活时） |

### 结构化内容

| 功能 | 说明 |
| --- | --- |
| 表格编辑 | 规范表格以网格呈现：格内直接编辑、跨格拖选复制、行列增删与拖动重排、列宽按内容分配 |
| 列表与引用 | Enter 延续结构、退格分层剥除、Tab 整行缩进，嵌套列表与引用完整支持 |
| frontmatter 属性 | YAML 头呈现为只读表格卡片，浮层内增删改属性与数组项，每笔操作一次撤销 |

### 链接与图片

| 功能 | 说明 |
| --- | --- |
| 双链与锚点 | `[[笔记]]` 五形态双链，`#标题` 与 `#^块id` 锚点跳转落到目标位置，跳转后目标高亮提示 |
| 复制块链接 | 右键任意块复制 `[[笔记#^块id]]`，块无 id 时自动生成；快捷键 `Ctrl+Shift+C` |
| 图片粘贴 | `Ctrl+V` 落盘剪贴板图片并在光标处插入引用，存放位置与子路径可配置 |
| 嵌入资源刷新 | 外部替换同名图片后，点顶栏刷新按钮立即显示新图；快捷键可绑定（默认未绑定） |

### 代码块与图表

| 功能 | 说明 |
| --- | --- |
| 代码块卡片 | 代码块收起为卡片：语言徽标、卡内行号、复制、折叠、阅读视图折行开关；语法配色跟随 VSCode 明暗主题 |
| 图表与公式 | Mermaid 图表与 KaTeX 公式双视图渲染，图表可全屏弹窗缩放浏览并导出 SVG/PNG |

### 大纲

| 功能 | 说明 |
| --- | --- |
| 大纲面板 | 标题层级实时同步、点击跳转、拖拽整段重排、标题搜索、折叠滑块，行内样式与层级配色透传 |

### 外观与定制

| 功能 | 说明 |
| --- | --- |
| CSS 片段 | 用户目录 `.css` 文件作为跨项目片段逐项启停，支持 `@import` 嵌套导入、HTTPS 远程样式与在线字体 |
| 样式参考 | 公开样式契约离线查阅与搜索，契约 JSON 可导出供 AI 助手和外部工具使用 |
| 可读行宽 | 滑块同时约束实时预览与阅读的正文列宽，0 为铺满，正文列居中并避让大纲栏 |
| 界面语言 | 中英文界面即时切换，默认跟随 VSCode 显示语言 |

各功能的完整行为、边界与全部设置项说明见 [docs/features.md](https://github.com/ONEGAYI/vsidian/blob/main/docs/features.md)（中文）。

## 已知限制

- 不支持 Obsidian 的 Canvas、白板、插件生态与 `.md` 之外的笔记格式。
- CSP 允许任意 https 图源（远程图床支持的设计代价，理论上可被用作跟踪像素）。
- 超长代码块跳过语法着色，回退纯文本卡片。

## 从源码构建

```bash
npm install             # 安装锁定依赖
npm run compile         # esbuild 构建 + tsc 类型检查
npm run test:unit       # 单元测试（无 VSCode 宿主依赖）
npm run test:browser    # Playwright 浏览器回归（首次需 npx playwright install chromium）
npm run test:integration # 真实 VSCode 宿主集成测试
npm run release:check   # 打包 VSIX 与发布前检查
```

Windows 上集成测试默认在独立桌面启动真实 VSCode 宿主，不干扰当前桌面；无人值守环境的前台模式与分片运行见仓库内 `test/integration/` 各启动器说明。发布流程、包体红线与样式契约门禁的约定见仓库内技能文档（`.agents/skills/release/` 与 `.agents/skills/style-contract/`）。

问题反馈请到 [Issues](https://github.com/ONEGAYI/vsidian/issues)，版本历史见 [CHANGELOG](https://github.com/ONEGAYI/vsidian/blob/main/CHANGELOG.md)。
