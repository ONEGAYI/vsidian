# 规格：HTML 注释快捷键与双视图呈现

状态：待实施（工单 [#139](https://github.com/ONEGAYI/vsidian/issues/139)）。本文是 HTML 注释操作的单一事实源，工单验收以此为准。语法采用 HTML `<!-- -->`（用户已明确不用 Obsidian `%%`）；词表新增「HTML 注释」条目见 CONTEXT.md。

## 范围

- **覆盖**：`ctrl+/` 注释操作（两态切换）、Live 视图注释淡化呈现、阅读视图注释隐藏。
- **机制归属**：操作按 #103 行内围栏约定接入 `INLINE` 表与 `FORMAT_OPERATIONS` 注册表；注释属**插入型结构**（同 wikilink / inlineMath 一类），两态取消分支为本规格新增设计。
- **排除**：注释折叠 / 点击显形交互（Obsidian 式，已决策不做，未来另票）；`%%` 语法；源码模式与设置页内 `ctrl+/`（不接管宿主绑定）。

## 已确认决策（2026-09-27 澄清答复）

1. **默认键 `ctrl+/`**，仅 Live 编辑正文时生效（覆盖宿主行注释绑定属既定语义）；可改绑 / 清空 / 恢复默认。
2. **两态齐全**：无选区插入空注释对、光标落开围栏内侧（锚点按 `markers.open.length` 从实际定界符计算）；有选区包裹选区；光标在注释内再按取消整段。
3. **Live 淡化呈现**：低对比度装饰，明显非正文、仍可读；不隐藏、不折叠。
4. **阅读隐藏**：markdown-it 解析前剥离，注释不产生任何输出。

## 交互契约

1. 取消分支的节点命中需覆盖两种解析形态：行内位置的注释节点与块级 `HTMLBlock`（以 Lezer 实际产出节点为准，契约测试钉住）；`HTMLBlock` 既有的「格式操作禁用上下文」语义与注释取消的关系在实现中明确——注释操作在注释块内应可取消，其余格式操作维持禁用。
2. 阅读剥离器为纯函数，输入全文输出剥离后文本：覆盖跨行块级、同行多处、未闭合残缺（保留原样不吞正文）；代码块与行内代码内的字面 `<!--` 不得剥离。
3. 剥离只影响阅读渲染输入；查找、写回、源码文本不受影响。
4. i18n：操作 titleKey、tooltip 入两语言包；`docs/specs/keybindings.md` 补记一行。

## 用户故事

1. 作为编辑者，我希望 `ctrl+/` 一键给选中内容加注释 / 取消注释，注释语法不需要手打。
2. 作为读者，我希望注释在阅读视图完全消失，正文干净。
3. 作为编辑者，我希望 Live 里注释以淡化样式提示「这里有不渲染的内容」，需要时仍可读。

## 实施决策

- **注册表接入**：`FORMAT_OPERATIONS` 登记 `htmlComment`（live / writes / 默认 `ctrl+/`）；`INLINE` 表 mark / node 字段按实际解析形态填；分派落在 `planFormatOperation` 插入分支（同 wikilink 一类），取消分支自行实现。
- **Live 装饰**：liveDecorations 按语法树节点发射 mark 装饰（淡色类），复用现有样式注入链；关键 CSS 规则由契约测试钉住。
- **阅读剥离**：接入点在 `splitReadingBlocks` 交 markdown-it 前（body 切片后），与 frontmatter 剥离同层。

## 验证与完成条件

- **TDD**：包裹 / 取消 / 光标落位先行——`formatOperations.test.ts` 补光标断言一条，`formatInteraction.test.ts` 两态往返枚举加一行（#103 惯例）；剥离纯函数含负面用例（代码块内字面 `<!--`）。
- **控制器与浏览器**：jsdom 单测三路径；涉及 webview 输入与光标行为，合并前必跑 `npm run test:browser`。
- **视觉层断言**：至少一条落在绘制层探针（淡化可见性）。
- **回归与文档**：compile / test:unit / test:browser / test:integration 全绿；更新 keybindings.md、README 双语、人工验证清单、文件树。
- **用户人工验收**：淡化观感、阅读侧不可见确认。

Blocked by: 无
