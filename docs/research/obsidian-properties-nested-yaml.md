# Obsidian 的 YAML 头（properties）呈现与编辑——嵌套结构支持面调查

> 调查票：[#421](https://github.com/ONEGAYI/vsidian/issues/421)（2026-10-09）。
> 触发场景：用户文档 `claryti-orchestrator.md` 的 frontmatter 为嵌套映射
> （`permission` → `bash`/`task` → 键值），命中本项目一期「合法但不支持」降级分支，
> 头区始终源码呈现、无表格卡片；连带暴露降级态缩进缺陷（#420，已修）。
> 本报告回答：Obsidian 对嵌套 YAML 的**呈现与编辑**怎么做的、成型边界在哪、
> 对本项目嵌套 map 支持的设计映射。仅调查不开实施。

## 一、Obsidian 官方行为（1.4 properties 起，至今未变）

### 1.1 成型类型白名单

官方帮助文档（help.obsidian.md/Editing+and+formatting/Properties，2026-10 查证）
明确七种属性类型：**Text、List、Number、Checkbox、Date、Date & time、Tags**。
类型按属性名全库统一（同库同名属性共享类型），可经类型图标或「All properties」
视图改换；数值推断出的值可被误转 text（社区实测 `weight: 175` → `"175"`）。

### 1.2 嵌套结构的实际呈现

「Not supported」节官方原文点名 **Nested properties**，处置建议是「用源码模式查看」。
实际呈现（论坛与博客多方印证，2023-08 至 2026-03）：

- **Live Preview / 阅读模式**：嵌套 map 的值被压成一条 **JSON 字符串**显示
  （如 `{"series_name":"The Wheel of Time","series_num":6}`），类型图标为
  未知类型（问号），**不能结构化编辑**；列表内的对象同样如此
  （forum.obsidian.md/t/64413「Cannot edit nested properties in Preview mode」、
  bbbburns.com 2025-07 博客实测）
- **源码模式**：原始 YAML 文本，可自由编辑——嵌套唯一可编辑的通道
- 显示模式三态（Settings → Editor → **Properties in document**）：
  Visible（默认 UI）/ Hidden（只在侧栏视图出现）/ **Source（纯 YAML 文本）**
  ——Source 态是嵌套用户的常用逃生门，多个论坛帖推荐

### 1.3 编辑的破坏性语义

官方有意收紧 YAML 方言（开发者原话：在「允许用户保留任意注释与格式的 YAML」
与「让插件无痛交互 YAML」之间权衡）。已知破坏性行为：

- JSON flow 写法编辑后被改写为 block YAML；引号、注释、格式在经
  `processFrontMatter` 写回时不保真（forum.obsidian.md/t/66274）
- properties 面板内**不支持 Markdown**——官方定性为有意限制（属性面向
  「小而原子化」的信息）

### 1.4 成型边界小结

可结构化呈现 = 顶层平铺的七种类型（标量 + 字符串列表）；**一切嵌套
（map、对象列表、多行标量）在 UI 层一律降级为只读 JSON 字符串**，编辑
只能走源码。批量编辑同样点名不支持（建议 VSCode/脚本/插件）。

## 二、社区生态

- **功能请求**：multi-level YAML 支持主帖 forum.obsidian.md/t/63826
  （2023-07 起，2026-03 仍活跃）；期间有点号扁平化提案
  （`book.started` 显示、写回还原嵌套），因 Dataview 兼容与排序问题未成主流
- **Nested Properties 插件**（mnaoumov/obsidian-nested-properties，2026-03）：
  社区已有完整实现，关键设计——
  - 嵌套对象/数组渲染为 **Properties 面板内折叠树**：逐键缩进行、三角展开、
    折叠行显示一行内容预览（非不透明 `{ ... }`）、深层结构横向滚动
  - 任意层级增删改、右键菜单（剪切/复制/粘贴/移除）、全库范围按点路径
    （`foo.bar`）重命名/删除
  - 嵌套类型持久化到库级 `types.json`（点路径键）；类型转换有损时弹确认
  - **数组不下降为树节点**（数组索引不是稳定属性名），数组整体作为路径终点
  - 扩展 Obsidian 原生搜索支持嵌套点路径（`[book.author: value]`）

## 三、对本项目的映射

### 3.1 现状对照

本项目一期成型规则「标量 + 字符串数组 → 只读表格卡片 + Popover 编辑；
其余降级源码」，嵌套 map 属「合法但不支持」降级。与 Obsidian 对照：

| 维度 | Obsidian | 本项目现状 |
| --- | --- | --- |
| 成型子集 | 七种顶层平铺类型 | 标量 + 字符串数组（更窄，无 date/checkbox 推断） |
| 不成型时的呈现 | JSON 字符串锁死（不可编辑）+ Source 模式逃生门 | **降级即源码、可编辑**（frontmatterTable「降级后编辑不受限」） |
| 嵌套编辑通道 | 仅源码模式 | 降级源码态直接编辑（#420 修复后 Tab 缩进可用） |

**关键判断：本项目「降级 = 可编辑源码」比 Obsidian「JSON 字符串锁死 + 另设
Source 开关」更顺**——降级态天然就是 Obsidian 用户被迫手动切换的 Source 形态，
且 #420 修复后缩进编辑体验完整。Obsidian 官方对嵌套的处置（不支持、劝退到
源码）也说明「嵌套一律结构化」不是他们认可的成本收益。

### 3.2 嵌套 map 支持的呈现候选（若做）

1. **维持降级源码（现状，零成本）**：与 Obsidian 官方建议路径等价；可考虑的
   低成本增强是给降级头区加一行轻提示（「复杂 YAML，源码呈现」），降低
   「为什么没变表格」的困惑（即 #421 的触发疑问）
2. **折叠树卡片**（Nested Properties 插件路线）：折叠行一行预览 + 逐键缩进 +
   数组不下降为节点；编辑面可先只读（展开浏览）后补分层编辑。工作量大，
   值得独立规格票
3. **点号扁平化显示**：社区论证过、未成主流，Dataview 兼容与写回排序有坑，
   不建议

### 3.3 建议

短期维持**降级源码 + 可选轻提示**（选项 1，含 #420 已落地的编辑体验即完整
闭环）；中期若嵌套卡片需求成立（用户实际文档里嵌套 frontmatter 占比高），
按选项 2 立规格票，参照 Nested Properties 插件的折叠树与「数组不下降」设计，
成型边界仍由 `src/shared/frontmatterTable.ts` 单一事实源扩展并补降级矩阵。

## 证据清单

- 官方帮助：help.obsidian.md/Editing+and+formatting/Properties（类型白名单、
  Not supported 节、显示模式三态；2026-10-09 查证）
- 嵌套呈现与不可编辑：forum.obsidian.md/t/64413（2023-08）、
  forum.obsidian.md/t/66382（2023-09）、
  forum.obsidian.md/t/112440（2026-03，确认至今未支持）、
  bbbburns.com/blog/2025/07/nested-yaml-frontmatter-for-obsidian-book-notes
- 编辑破坏性：forum.obsidian.md/t/66274（JSON→YAML 改写、引号注释不保真）
- 功能请求主帖：forum.obsidian.md/t/63826（含点号扁平化提案，2023-07 起）
- 社区插件：github.com/mnaoumov/obsidian-nested-properties（README 与
  nested-property-paths.ts 源码；点路径模型、数组不下降的设计依据）
