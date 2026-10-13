# 附加组件设置定义分组（#472）——规格

> 状态：访谈中（第二轮已收，第三轮 T1 待答）。本票是「附加组件基础设置呈现复刻」（#477）的平台前置之一。
> 代码基线：origin/main @ ee8af89e（含 #465/#466 拆分）。规格树 `spec/472-476-settings-ia`。

## 0. 需求原文（2026-10-13 票面要点）

- `AddonSettingDefinition`（`src/shared/addonSettings.ts`）支持分组/分区描述元数据；字段形状、命名、是否多层规格期定夺（候选：定义级 `group` 标识 + 组元数据声明，或定义内嵌 `section` 字段）。
- 宿主基础设置区按分组渲染：分区标题 + 组内条目聚合，呈现形态对齐 ui-patterns 档位。
- 向后兼容：无分组元数据的定义保持现状平铺，已注册组件不受影响。
- 「功能开关行」（`__enabled__`）恒居首行的既有行为保留。
- 分组信息属声明面：随 `addons.settingsState` 既有推送链路透传至 webview，不新增消息通道。
- 票面边界：不改设置持久化与两层作用域；不含枚举档位标签（#473）与多行文本控件（#475）；不接管组件自绘设置页（`registerPage` 通道不变）。

## 1. 事实基线（2026-10-13 核查）

### 1.1 定义模型现状

- `AddonSettingDefinitionBase`（`src/shared/addonSettings.ts:43-50`，未导出）：`key`（非空、组件内唯一）、`title`（必填 string）、`description`（可选 string）——**纯字符串直值**，头注钉死「展示信息为字符串直值——组件的键不进 Vsidian 内置字典」（:42）。
- 五臂判别联合（:53-71）：boolean / number / string / array / object。
- 容器在协议层：`AddonSettingsAreaPayload.definitions: readonly AddonSettingDefinition[]`（`src/shared/protocol.ts:1017-1018`，注册序；webview 侧逐元素过 `isAddonSettingDefinition` 守卫）。

### 1.2 渲染现状（#465/#466 拆分后）

- `renderSettingsArea()` 现位于 `src/webview/addonSettingsAreaSection.ts:205-324`——**票面所写 `addonSettingsSection.ts:706-719` 是批 4 树（拆分前旧 main）形态，已过时**。
- 控件组（:281-295）：单个 `div.vsidian-settings-group`；`renderEnabledRow()`（`__enabled__`，`ENABLED_KEY` :31）先渲染——代码顺序即渲染顺序，恒居首；随后 `for (const def of definitions)` 按载荷注册序平铺。**无任何组标题/分区概念**，整区仅头部一个 h3。

### 1.3 全局搜索与定位现状

- 搜索匹配 = 条目显示文本（title + description，大小写不敏感子串），不匹配 key（`src/webview/settingsPageView.ts:731-732`）。
- **附加组件设置定义不进搜索索引**：两个分页只登记页级条目（附加组件页 `list`/`manage`；组件设置页 `hub`）。定义级命中属新增能力，且组件设置区**没有页内搜索**。
- focusEntry：协议 `settings.focusSection { section, entry? }`（`src/shared/protocol.ts:565-571`）；组件设置页现仅 `hub` 整卡定位（located 类 + scrollIntoView，`addonSettingsAreaSection.ts:212-215`）。前缀先例：附加组件页 `addon:<id>`（`addonSettingsSection.ts:415-421` 解析）。

### 1.4 批 4 并行与撞形

- 批 4（#473/#475，树 `D:/CODE/Project/_Extensions/vsidian-473-475`，基于旧 main 53c20cb6）在同文件 string 臂新增 `enumLabels?: Readonly<Record<string, AddonLocalizedText>>` 与 `multiline?: boolean`，并新增 `src/shared/localizedText.ts`（`LocalizedText = string | Readonly<Record<string, string>>`）。
- 撞形面：批 4 动联合的 string 臂与 `isAddonSettingDefinition` 的 string 分支；本票分组落在 base 臂加可选字段 + 注册载荷扩形——类型不重叠，同文件同函数区域文本冲突概率低但存在，合并时需手工合流。

### 1.5 契约登记点

- `src/shared/addonApiCatalog.ts` `settings-definitions` 条目（:772-791）：形状演进须同步 symbols/purpose/semantics；随后 `npm run gen:addonapi` 重生成参考、`npm run check:addoncompat` 过门禁，必要时基线重锚定并独立说明理由（流程见 `docs/specs/addons-api-gate.md` 与 AGENTS.md「附加组件公开 API 维护」节）。

## 2. 设计树（决策节点与拍板记录）

- **D1 能力路线**：扩平台分组能力（方向 A），不做组件整体自绘。〔票面既有拍板〕
- **D2 数据模型（引用式）**：定义公共臂加可选 `group?: string`（组键引用）；`registerDefinitions` 载荷新增可选组声明数组 `groups?: [{ key, title, description? }]`——组元数据只声明一次，组序 = 声明序。否决内嵌式（组元数据随定义重复、无法声明空组、组序隐式）。〔第一轮 Q1 用户拍板〕命名用 `group` 不用 `section`——「section」在设置页语境已固定指侧栏分页（`SettingsPageSection`），避免术语冲突。
- **D3 层级深度**：一层，组内不嵌组。〔第一轮 Q2〕
- **D4 组元数据本地化**：组 `title`/`description` 采用批 4 的 `LocalizedText`（string 直值或语言码映射二选一）。**依赖批 4（#473）先行合并或实施时合流**。〔第一轮 Q3〕
- **D5 呈现**：每个分组一个圆角容器（对齐 CONTEXT.md「设置页容器语言」与内建设置分组观感），组标题用设置页组标题档位（ui-patterns 既有）；未分组定义与 `__enabled__` 行留在首个无组标题容器恒置顶；分组容器按声明序随后；未分组项聚拢不散插。〔第一轮 Q4〕
- **D6 全局搜索与定位兼容**：〔**第三轮 T1 待定夺**〕——第二轮用户澄清：全局搜索不命中行为管理具体行（该职能归行为管理页自己的积木搜索，见 #474 规格）；设置定义/组标题本身是否进全局搜索索引待确认。

## 3. 已定边界

- `__enabled__` 恒居首行（票面钉住）。
- 分组随 `addons.settingsState` 既有链路透传，不新增消息通道（票面钉住）。
- 无组定义保持平铺（向后兼容，票面钉住）；混合声明时未分组项聚拢首容器。
- 不改设置持久化语义与两层作用域（用户默认/当前工作区）。
- 组键组件内唯一；定义引用的组键必须已声明（校验口径，随 `isAddonSettingDefinition`/载荷守卫扩展）。

## 4. 明确不包含

- 枚举档位本地化标签（#473）、多行文本控件（#475）——批 4 并行，各自独立。
- 组件自绘设置页（`registerPage` 通道）不变。
- object 定义的字段级不进全局搜索/定位（若 T1 拍板加定义级搜索，定义级即止）。

## 5. 依赖与并行

- 批 4（#473/#475）同文件并行：合并时 `addonSettings.ts` 两处改动手工合流（base 臂 vs string 臂、`isAddonSettingDefinition` 同函数不同分支）。
- 消费方 #477（呈现复刻总装）以本票为前置之一。

## 6. 轮次记录

- **R1（2026-10-13）**：Q1 数据模型（引用式 ✅）、Q2 一层（✅）、Q3 LocalizedText（✅，注明批 4 依赖）、Q4 呈现（✅）、Q5 搜索/定位——用户答「都加上」。
- **R2（2026-10-13）**：用户澄清 Q5 原意——全局搜索不命中行为管理具体行，行级检索职能归行为管理页自己的搜索；设置定义级/组级是否进全局搜索转为 T1 待确认（第三轮）。
