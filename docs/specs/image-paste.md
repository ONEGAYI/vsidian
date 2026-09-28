# 规格：图片粘贴插入与资产文件夹

状态：已共识待实施（[#161](https://github.com/ONEGAYI/vsidian/issues/161)）。本文是图片粘贴能力的单一事实源。母题 #16 的图片粘贴切片；拖拽文件插入**不在本批**。

## 范围

- **覆盖**：Live 正文内 `Ctrl+V` 粘贴剪贴板图片 → 落盘到可配置的资产文件夹 → 在光标处插入 Markdown 图片引用；资产文件夹设置（独立设置页新条目）。
- **排除**：
  - 拖拽图片文件进编辑器（另票）；
  - SVG 粘贴落盘（剪贴板 SVG 以文本形态存在，本批不承诺）；
  - 阅读模式粘贴（阅读正文只读，不接管）；
  - 嵌入语法 `![[图片]]`（双链嵌入未实现，插入一律标准语法）；
  - 跨工作区（无工作区的单文件场景按「与当前文件同目录」回退，见下）。

## 已确认决策（2026-09-28 设计访谈）

1. 存放位置用**三模式枚举 + 子路径文本**两个设置项表达（用户确认）：
   - **与当前文件同目录**（默认）；
   - **相对工作区根**：工作区第一文件夹根 + 子路径；
   - **相对当前文件**：当前文档所在目录 + 子路径。
2. 文件名**混合策略**：剪贴板位图（截图，无文件名）生成 `Pasted image YYYYMMDDHHmmss.png`（Obsidian 默认风格）；剪贴板带原始文件名（复制文件对象）时清洗非法字符后沿用，重名自动加 `-1`/`-2` 序号。
3. 一次粘贴只处理**首个**图片项；剪贴板同时含图片与文本时图片优先接管（`preventDefault`，忽略同剪贴板文本）。

## 设置模型

- `SettingDefinition` 扩展 **string 自由文本类型**（`valueMatchesType` / `isSettingDefinition` 放行有限长度字符串；设置页新增 text input 控件分支）。
- 三个新设置项（#163 验收反馈二轮还原起归属编辑器页内「图片」组内小节——`image.*` 键前缀定节）：
  - 粘贴图片插入（boolean，默认开，总开关）；
  - 图片存放位置模式（枚举：同目录 / 相对工作区根 / 相对当前文件，默认同目录；`dependsOn` 总开关——关闭时一并灰化）；
  - 图片存放子路径（string，默认 `assets`；**#163 验收反馈防呆改版**：`dependsOnEnum` 挂位置模式——模式=同目录时控件灰化禁改（值不清除，切回有效模式按原值生效），经模式项的 dependsOn 链随总开关级联灰化）。
- 持久化走既有 `settingsService`（globalState overlay），变更广播与回显复用现有 `settings.changed` 链路；设置页验证保存、重开回显、变更后立即生效。

## 目录解析与落盘规则

- 路径解析为纯函数（宿主侧），输入（模式、子路径、文档 URI、工作区根）输出目标目录：
  - 子路径统一正斜杠、去首尾斜杠；**拒绝绝对路径与 `..` 越界**（违规 → 通知失败，不落盘）；
  - 相对工作区根模式下**无工作区**（单文件打开）→ 回退与当前文件同目录，通知说明回退；
  - 目录不存在时 `createDirectory` 递归创建（含各级父目录）。
- 文件名清洗：去除 Windows 非法字符（`<>:"/\|?*` 与控制字符，保留中文与空格）、去首尾空格与点；清洗后为空（原名全是非法字符）→ 回退时间戳名。清洗只贡献 stem（原名先清洗、再剥去尾部的扩展名段）；**扩展名不沿用原名的扩展名，一律按 mime 映射重建**（下一条映射表）——有意取舍：文件名后缀与落盘字节格式保持一致，hint 的后缀仅是剪贴板来源的猜测。
- 扩展名映射：`image/png`→`.png`、`image/jpeg`→`.jpg`、`image/gif`→`.gif`、`image/webp`→`.webp`、`image/bmp`→`.bmp`；其余 image/* 不拦截但扩展名按 mime 后缀兜底生成。
- 落盘为**宿主侧职责**（webview 无文件系统能力）：`vscode.workspace.fs.writeFile`（Uint8Array 由 base64 解码）；失败 → i18n 通知，不插入文本。

## 消息协议与插入链路

- 新消息对（`src/shared/protocol.ts`，校验函数同步扩展）：
  - `image.paste`：`{ sessionId, docUri, reqId, mime, dataBase64, fileNameHint? }`；
  - `image.paste.result`：`{ sessionId, reqId, ok, markdown? }` 或失败原因码（目录非法 / 写入失败）。
- **webview 侧**：`EditorView.domEventHandlers({ paste })`（模板：tableEditing 的 copy handler）检测 `event.clipboardData.items` 中 `type` 以 `image/` 开头的项（`clipboardData` 仅事件同步窗口内可用，读出后即转 base64）；守卫：总开关开、live 模式、可编辑、非 suspended、非 IME 组合态；命中即 `preventDefault` 并出站。
- **宿主侧**：解析设置 → 目标目录 → 文件名策略 → 写入 → 计算插入文本回发。
- **插入**：webview 收结果后**单事务 dispatch** 在光标处插入 markdown（模板：`applyOutlineEdits` 的变更应用；守卫同格式操作），自动走标准 `edit.request` 出站——一笔撤销、CRLF 由宿主 `NewlineCoordinator` 归一。
- **插入语法**：`![文件名stem](相对路径)`——路径为从当前文档目录到落盘文件的相对路径（POSIX 分隔符），空格、非 ASCII 与 `#()<>` 等特殊字符 percent-encode（与渲染端 `normalizeImgSrc` 的 percent-decode 容错对偶）；stem 取文件名去扩展名。
- 落盘文件天然位于工作区内，无需扩 `localResourceRoots`（现有图片资源根已覆盖工作区文件夹）。

## 交互契约

1. 阅读模式粘贴不接管、不提示（与阅读只读语义一致）；设置页等非正文输入不接管。
2. 失败反馈用宿主通知（i18n 词条），禁止 `window.alert`。
3. 所有用户可见文字入双语言包；manifest NLS 不涉及（设置在扩展自有设置页，不走 `package.json` contributes）。
4. 粘贴发生在 IME 组合态时放行为默认粘贴（不吞输入），组合结束后再粘贴即可。

## 用户故事

1. 作为编辑者，我希望截图后直接 `Ctrl+V`，图片自动存进我配置的文件夹并出现在光标处。
2. 作为编辑者，我希望资产文件夹按「相对工作区」或「相对当前文件」配置，与我库的组织方式一致。
3. 作为编辑者，粘贴失败时（目录越界、磁盘错误）我要得到明确提示，而不是静默丢图。

## 验证与完成条件

- **TDD**：设置定义（string 类型校验、非法值清洗）、目录解析纯函数（三模式、越界拒绝、无工作区回退）、文件名策略（时间戳、原名清洗、重名序号、全非法回退）、插入文本编码先行。
- **协议**：`image.paste` 校验函数契约测试（非法载荷整体丢弃）。
- **集成**：`VSIDIAN_TEST_HOOKS` 短路宿主动作的往返断言（出站载荷 → 回发结果 → 光标处插入 → 撤销一步还原）；设置持久化与回显用例。
- **浏览器**：paste 拦截涉及 webview 输入行为，合并前必跑 `npm run test:browser`（剪贴板注入按 Playwright 能力落地，受限时说明未覆盖面并以集成路径补齐）。
- **回归与文档**：compile / test:unit / test:browser / test:integration 全绿；keybindings.md 说明「无快捷键（原生 Ctrl+V 通道）」；更新人工验证清单（真实截图粘贴人工验收）与文件树；README 双语补图片粘贴条目。

Blocked by: 无
