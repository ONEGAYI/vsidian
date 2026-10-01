# 工作区引用索引、反向链接与图片缓存刷新

## 状态与最终共识

2026-09-28 用户结束访谈并授权规划开票。本文是本批实施规格。实施进度：**#195–#202 八票全部完成开发与自动化验证（2026-09-29 #202 收口：全量验证矩阵、三档容量复测、场景补验与文档收口，见文末「#202 收口落档」节），状态为已实施待用户验收**。各票落地语义见文末「#198 实施落档」至「#202 收口落档」各节；已知边界与人工待验汇总见 [manual-verification.md](manual-verification.md) 的 #202 节。开票授权不等于当前推送或合并授权；自动化通过不等于用户验收，总票 #194 保持开放。

最终规则覆盖访谈中的旧建议：**链接只按来源文档的相对路径解析，不按文件名搜索、不按目录距离或字典序挑候选、不跨根解析相对引用**。多根工作区照常索引，但各根是独立资源边界。同名冲突 Alert 及“放弃/覆盖”的设想随短名搜索撤销；索引未就绪、并发改写等失败提示保留。

## 用户故事

1. 作为多根工作区用户，我希望每个根独立索引，以便不同目录的资料不会相互误匹配。
2. 作为笔记作者，我希望链接按来源文件的相对路径跳转，以便能预测目标。
3. 作为笔记作者，我希望查看当前笔记的反向链接并跳回引用位置，以便追踪上下文。
4. 作为用户，我希望重启后快速恢复索引并持续更新，以便不反复等待全库解析。
5. 作为用户，我希望重命名或移动文件后更新 Markdown 中的引用，以便链接保持可用。
6. 作为用户，我希望图片、PDF、音视频等文件也能作为引用目标登记，以便这些文件改名后链接同步更新。
7. 作为用户，我希望本地及 Remote SSH 图片修改后自动刷新，删除后显示找不到，以便不继续看到过时图片。
8. 作为用户，我希望在插件设置页修改排除规则、恢复默认、清理缓存和完整重建，以便控制扫描范围与修复缓存。
9. 作为用户，我希望索引未就绪或并发变更导致更新失败时收到明确 Alert，以便知道哪些引用未更新。
10. 作为 Remote SSH 用户，我希望后台任务有界、可取消且断连后可恢复，以便编辑不会被索引拖慢。

## 路径与范围

- `[[设计]]` 表示来源文档同目录的 `设计.md`；`[[项目甲/设计]]` 表示明确子路径；`[[../设计]]` 允许根内上行，越出来源所属根不得解析。
- 删除既有双链按 basename 全根搜索、文档相对/根相对双候选及 QuickPick 歧义分支。不再隐式用另一个工作区根补齐相对路径。
- 普通 Markdown 链接、图片沿用各自语法解析，目标定位统一基于来源目录。显式扩展名不得错误补成 `.pdf.md`；双链省略扩展名默认 Markdown。保留别名、标题/块锚点、本文件锚点、URL 编码及宿主大小写语义。
- 嵌套根按文档实际所属的最具体根划分，URI 规范化去重，不能重复归属；根增删后重新判断覆盖范围。路径解析和权限校验分离，索引不扩大资源加载权限。
- 从 Markdown 抽取明确链接及图片引用，包括双链、普通内联链接和引用式链接定义；以项目语法规则排除代码字面量等非引用。语法抽取应与当前呈现复用规则，差异必须有测试及明确说明。
- 非 Markdown 文件仅登记目标 URI、元数据及被引用关系，不解析或改写其内部内容。工作区外目标可保留记录，不保证自动更新；HTTPS 资源保留既有行为，不进入文件 mtime 机制。
- 首版反链以当前 Markdown 为入口：显示来源文件、引用片段及定位，按来源路径/位置稳定排序，区分加载中、无引用、更新中与读取失败。界面采用可开关的反链面板，布局沿用编辑器已有侧栏模式，避免破坏大纲；不新增图谱、全文检索或未链接提及。
- 新增操作均在现有快捷键注册模型登记，允许默认未绑定；反链查看为双模式，索引维护操作在设置页/宿主执行，不接管正文输入。

## 索引模型与存储决策门槛

Markdown 与打开文档的当前内容为事实来源，索引仅为可重建缓存。保存文件清单、mtime、size、内容/解析版本、出链的原始目标与可定位区间；不复制全文、不持久化 AST 或图片。按目标建立反向查询关系，保留断链及未命中引用。

未保存内容为当前窗口内存覆盖层，不写作已保存快照；变更版本递增，旧扫描/旧请求不得覆盖新版本。目标删除移除其自身出链，仍保留来源中的断链。

缓存存扩展私有工作区存储，内部按根 URI 分区；Remote SSH 存宿主侧，不写入笔记目录。不同工作区允许重复缓存；同工作区多窗口仍需协调写入。无工作区的既有编辑和图片显示不因全库索引不可用而阻塞。

存储引擎设为实施前置证据门槛：以紧凑分片快照＋内存关系表为候选基线，与兼容旧宿主的 SQLite 接入方案对比。不能使用 Node 22 才加入的内置 SQLite 作为 Node 18 API 面方案，也不能依赖用户安装 sqlite3。测量后将唯一选型、提交/恢复策略、多窗口写入策略、空间预算和回收阈值写入 ADR，再开始持久化实现；不把未实测数字宣传为已达标性能。

评估 1千/1万/10万篇，分别记录总正文量、边数和非 Markdown 目标数；测首次构建、冷启动恢复、单文件编辑、批量变更、查询、峰值内存、磁盘空间、写入量、事件循环响应。Remote SSH 为重点场景，未能实测必须保留待验，不以本地结果冒充远程通过。

## 生命周期与设置

- 编辑停止约 500ms 后更新内存关系；连续输入约 2s 合并一次；保存/外部事件进入增量队列，磁盘合并写。以上为待测调度初值，不是完成时限承诺。
- 启动、重连、长时间离开后核验；活跃期间约每 10 分钟低优先级核对清单和元数据，大库分批、不重叠、可取消。mtime＋size 仅筛选变化，不是内容一致性证明。
- 全量重建重新解析正文并核验资源，入口放插件自有设置页；提供清理当前工作区缓存及重建操作，展示进度和失败信息。旧缓存清理必须尊重其他活跃读者/写者。
- 健康缓存不按固定天数失效；成功提交新快照后回收不用的旧代际与残留临时文件，保留恢复所需完整版本。首版不建跨工作区闲置清理服务。
- 索引排除项在插件自有设置页提供默认值、修改、持久化、重新打开回显与恢复默认。实施初始默认模式为 `**/.git/**`、`**/node_modules/**`；不自动继承搜索排除及 .gitignore。
- 排除来源不保证其引用自动更新；被显式引用的排除位置目标仍可登记，不递归扫描。更改排除规则触发覆盖范围重算。

## 引用自动更新

覆盖 VSCode 内发起的文件/文件夹重命名与移动；外部工具改名只更新索引，不猜测旧新身份。按更名前的明确路径定位本次引用，按更名后的来源位置/目标位置重算相对路径；别名、锚点和无关正文保持原样。

既要更新指向被移动目标的引用，也要处理被移动 Markdown 自己的相对出链。同批目录移动必须按旧新路径映射统一规划，不能重复替换。跨根移动本身不被承诺拦截，但不得生成跨根相对引用；无法保持根内引用时跳过该项并明确报告，不能报告全部成功。

经 VSCode 文本编辑管线应用，不直接写磁盘，不覆盖未保存文本。确认候选覆盖与当前文档版本，过期则重新规划或中止对应改写。初次扫描、离线、必要核验未完成时不得静默部分更新，以宿主 Alert 说明本次未更新及原因；已有更名完成后的修复必须可审阅，不后台迟到改写。

宿主原生更名事件有时限及入口边界，实施须验证实际能力，不能承诺阻止所有原生更名。区分“未更新”“部分项因越界等被跳过”“已更新”，批量操作合并提示；没有同名选择/覆盖提示。标题和块 id 本身的更名不在范围内。

## 图片定期刷新与删除态

本批必须实施，不只是索引预留字段。当前宿主 stat 仅验证存在性，丢弃 mtime/size；宿主成功缓存与 webview 图源条目都缺少资源版本失效通道。

- 使用目标 URI、mtime、size 和已观测变化代次。收到变更事件即使元数据相同仍失效；仅靠 mtime 无法检出所有内容变化，完整重建提供恢复路径。
- 文件事件触发及时核验，另有周期核验兜底。实施初值为可见面板已挂载图片每 30 秒合并核验一次；按 URI 去重、并发有界、无活跃图片则停止，面板恢复可见/远程重连后及时核验。该初值为工程默认值，须通过开销实测调整，不等于网络条件下刷新时限保证。
- 元数据未变不强制下载/解码；变化则失效宿主解析缓存及 webview 条目，更新已挂载槽位并使用可验证有效的资源版本 URL。视口外不预解码，再挂载时重新核验。
- 明确不存在时撤下旧图，渲染“找不到”状态；权限错误、SSH 断连等不能冒充文件删除，显示相应不可访问状态。定期核验覆盖挂载的失败槽位，图源恢复后可恢复显示。
- 旧版本在途响应和 load/error 事件不能复活旧图或覆盖新状态；双模式、多面板均更新，更新不改变 Markdown 或 dirty。
- 保留资源白名单；图片按需 stat 与生命周期不能依赖首轮全库扫描完成。HTTP(S) 直连缓存刷新不在范围。

## 验证与交付

行为变更遵循 TDD，先验证反例。纯逻辑单测覆盖相对路径边界、抽取、变更计划和版本淘汰；真实浏览器覆盖反链交互、图片实际像素变化、删除可见态及视口卸载。使用生产控制器与现有 test hooks，不为实现镜像测试新造大量 mock seam。

webview/样式修改执行 style-contract，绘制层至少验证真实可见性；新增 UI 全部 i18n。宿主集成验证 TextDocument/WorkspaceEdit、未保存内容、撤销、文件/目录移动、设置持久化与回显。输入/光标相关变更按仓库规则运行浏览器测试。

覆盖扫描途中修改、取消、损坏缓存、丢失事件、同工作区多窗口、根增删、嵌套根、批量 Git 切换、SSH 断连恢复。完整测试/构建首次执行日志落盘。更新文件树、人工验收记录；自动化通过不等于用户验收。

## 明确不包含

跨根相对引用、basename 搜索、最近目录搜索、字典序选目标、同名冲突选择、未链接提及、图谱、全文检索、附件内容索引、HTTP(S) 图片主动刷新、外部改名身份推断、标题/块 id 改名、跨工作区共享索引服务及定时闲置清理服务。

## 依据与历史衔接

[ADR-0008](../adr/0008-workspace-reference-index.md) 替代 [ADR-0002](../adr/0002-wikilink-on-demand-resolution.md) 的按需查找/同名选择范围；旧 ADR 保留历史。当前实现事实来自 `src/host/wikilinkTarget.ts`、`textEditorProvider.ts`、`documentSession.ts`、`src/webview/imageResource.ts`。

官方依据：[VSCode API](https://code.visualstudio.com/api/references/vscode-api)、[Node.js SQLite](https://nodejs.org/api/sqlite.html)。实施以仓库锁定的 VSCode 1.86 类型及真实宿主为准。

## #198 实施落档（2026-09-29）

工单 #198（索引增量维护、排除设置与完整重建）的落地事实。调度数值全部是**待测初值**（集中于 `src/shared/vaultIndexSchedule.ts` 的 `SCHEDULE_DEFAULTS`，可在服务构造参数覆盖），不构成完成时限承诺。

### 调度与增量维护

- **编辑防抖与强制合并**：未保存编辑防抖 500ms 冲刷内存覆盖层；连续输入自首个未冲刷事件起 2s 封顶强制合并一次（`planFlushAt` 决策——防抖时点与封顶点取较早者，长时间连续输入不饿死）。
- **增量队列**：保存与外部文件事件统一进入**有界去重队列**（容量 2000、每批 8 文件、批间让出事件循环）。容量溢出的降级策略：清空队列转一次清单核验（批量 Git 切换不产生无界任务）；泵与全量扫描/核验互斥（busy 挂起、完成后接力），排空后合并为一次快照提交。
- **核验时机**：快照恢复后（启动，后台执行）、窗口焦点回归（`onDidChangeWindowState`，间隔保护 30s，长时间离开/断连恢复即触发）与活跃期周期（约 10 分钟，失焦挂起）。核验为 mtime+size 清单比对（`diffManifest`）——**仅筛变化，不作内容一致性证明**；完整重建是兜底恢复路径。
- **删除与不可访问的区分**：扫描端口 `accessOf` 三态（ok / missing / inaccessible，vscode 壳按 `FileSystemError.code` 区分 FileNotFound 与其余）。移除条目必须有 `missing` 正证据；不可访问（SSH 断连、权限错误）只标 stale 保留条目，不得等同删除。

### 排除设置

- 语义单一事实源 `src/shared/vaultIndexExclude.ts`：glob 子集（`**` 跨目录、`*`/`?` 不跨分隔符、正则特殊字符字面量化），无通配符模式按目录前缀（整个子树）排除；Windows 宿主大小写折叠。**不读取也不合并** VSCode 搜索排除（search.exclude）与 .gitignore。
- 默认 `**/.git/**`、`**/node_modules/**`；持久化在 `context.workspaceState`（键 `vsidian.index.excludePatterns`，工作区维度独立）。空数组是合法存储（显式清空）与「无存储回落默认」严格区分。
- 排除文件不扫描、不入覆盖层与增量域；**被显式引用的排除位置目标仍登记**（asset 元数据形态，不递归解析其内容）。模式变更触发全部根覆盖范围重算（全量重扫，快照增量继承使未变片不重写）。
- 清洗规则：逐项 trim、空行丢弃、保序去重、单条 ≤256 字符、至多 64 条；非法项在设置页回显（合法项照常生效）。

### 清理与完整重建

- **清理当前工作区缓存**：按 `planCleanupDirs` 安全回收各根分区的过期代际——保留 CURRENT 指向代、其全部继承源与**更高代际**目录（可能是并发窗口的在途提交），回收严格更旧代、孤儿代与 tmp-/非法目录名残留。不删活跃文件；健康缓存不按固定天数失效；清理是用户显式操作。
- **完整重建**：全部根全量重扫（重解析正文并核验资源），进度回报（约每 2% 推送一次）与取消（`cancelMaintenance` 递增维护代际，扫描/核验/队列泵在批间检查并中止；中止后模型保持上次完整数据）。重建与清理互斥。
- 入口：设置页「索引维护」分页按钮与宿主命令 `onegayi.vsidian.index.rebuild` / `onegayi.vsidian.index.cleanup`（默认未绑定，评估记录见 [keybindings.md](keybindings.md)）共用同一 wiring。

### 变化发布通道（#201 消费）

- 服务维护目标级**已观测变化代次**（`generation` per target，单调递增、首观测为 1），宿主侧订阅接口 `vaultIndex.onTargetChange(listener)`，事件 `VaultTargetChangeEvent = { fsPath, rootFsPath, relPath, generation, status: 'changed' | 'deleted' | 'stale', stat }`。`generation` 可作 `?v=` 缓存击穿参数。
- 语义要点：`deleted` 只在有磁盘删除正证据时广播（索引条目消失——被排除、引用消失、嵌套根重划——不等于磁盘删除，不广播）；`stale` 只在首次转入不可访问时广播（恢复后广播 `changed` 并清标记）；首扫描只建代次不广播（避免启动风暴）。来源断链在目标删除后保留（目标自身的出链随条目移除）。

### 根增删与嵌套根加固（集成用例暴露的 #197 缺口）

- `onDidChangeWorkspaceFolders` → `setRoots`：新增根扫描纳入、移除根停监听退出索引域（快照留存，显式清理才回收）；**集合有变时对全部存留根覆盖范围重算**（嵌套根增删改变既存根的归属边界）。
- 边界过滤三处同口径（`rootOf` 最具体根）：链接解析（resolveWith）与附件登记不越权处理属于更具体根的文件（父根对嵌套根文件按断链/不登记，跨根不解析）；watcher 事件按最具体根分流（父子根监听树重叠，同一变更会在两根各到达一次）。

### 边界与待验

- 双窗口同工作区的写入协调依赖 ADR-0008 三不变量（写者标签/CURRENT 原子替换/保守回收）；代际仲裁语义由单测钉住，真实双窗口与 Remote SSH 场景待人工验证（见 [manual-verification.md](manual-verification.md)）。
- 核验的 stat 失败不进清单，由移除正证据兜底区分（列举漂移保守跳过，下轮核验兜底）。
- 设置页 notice 保留至下一次操作覆盖（页面不自行清除）；无工作区窗口模式可编辑保存、操作不可用（打开工作区后生效）。
- **外部整目录删除不产生逐文件事件**（实测 1.86.2 Windows：`workspace.fs.delete(dir, {recursive})` 后 `**/*.md` watcher 无逐文件 delete 事件）——索引在周期核验（约 10 分钟）或显式完整重建前不知晓；单文件删除/改写有事件走增量链路。

## #201 实施落档（2026-09-29）

工单 #201（图片定期刷新与删除后找不到状态）的落地事实。工程常量集中于 `src/shared/imageRefresh.ts`（周期核验间隔 30s、事件去抖 400ms、唤醒节流 5s、图片扩展清单——watcher glob 与事件过滤同源），全部是**待测初值**，不构成刷新时限承诺。

### 三层失效通道

三层缓存各击一层，缺一不可（浏览器/资源服务 HTTP 缓存 → 宿主解析缓存 → webview 图源条目）：

- **版本表**（`src/host/imageVersioning.ts`，provider 级单件）：目标 URI 归一键去重（`imageFsKey`，与索引 normKey 同语义——resolve + 分隔符归一 + Windows 大小写折叠）；代次 `generation` 单调递增，直接拼 `?v=` 击穿（`buildSnippetLinkList` 先例——webview 资源服务不承诺无缓存）。**解析路径**（请求时 stat）mtime/size 相同不推进（URI 稳定让浏览器缓存可用——「未变化不强制重载」）；**事件路径**（watcher / onTargetChange）无条件推进（「收到变更事件即使元数据相同仍失效」——防 mtime 粒度漏检）；缺失→存在即使元数据回到缺失前的值也推进（`lastKnown` 置空过即视为变化，删除重建必检出）。
- **stat 升级**（`resolveWorkspaceImage`）：保留 mtime/size 进版本表（不再只验存在性）；stat 失败按 `FileSystemError.code` 区分 FileNotFound=`not-found` 与其余=`inaccessible`（新 reason 码，不冒充删除）。
- **会话失效**（`documentSession.invalidateImagesByFsPath`）：成功与失败结果登记 src→归一目标反查映射（同一 src 在不同文档指向不同文件——映射必须会话级）；失效时删宿主缓存、推进世代（epoch）并向**全部面板**广播 `image.invalidate`（多面板一致）；在途请求跨失效窗口完成时不回写缓存，并按失效时钟（fsKey→时刻）检出「登记未发生的竞态窗口」补失效广播。
- **webview 作废重发**（`imageResource.invalidate`）：条目重建（新 reqId——旧在途结果匹配不到 pending 条目被丢弃，代次守卫）；槽位撤下旧图（释放位图）回 loading；load/error 事件按「当前承载元素」过滤（阅读槽位 img 即 slot、监听与槽位同生命周期——旧世代在途事件不覆盖新状态）。error 重试与失效共用 `rebuildEntry` 重建路径。

### 事件与周期核验

- **事件即时核验**（`imageRefreshCoordinator.handleTargetEvent`，无条件失效）：宿主自建图片扩展 watcher（每工作区根一个花括号 glob watcher，根增删整体重建；索引域 watcher 只听 `**/*.md` 不覆盖图片）+ `vaultIndex.onTargetChange` 订阅（图片扩展过滤；当前事件均为 md 域、天然空操作，未来索引扩展到非 md 目标自动接通）。事件去抖 400ms 归并（保存器写临时文件 + rename 成组事件）。stat 三态决定写表：ok→带 stat 推进；missing→置空；inaccessible→不动表仅广播（文件可能未变，重发请求按 inaccessible 呈现）。
- **周期核验**（webview 驱动）：`ImageVerifyScheduler` 每 30s 合并上报活跃图源（`activeEntries`，直连外链除外）；无活跃槽位停表、面板隐藏停表、恢复可见立即核验；宿主 `image.wake`（窗口焦点回归节流 5s 广播——远程重连的及时核验）同样立即触发。宿主侧 `planImageVerification` 纯函数决策（fsKey 去重、串行 stat 并发有界）：元数据相同且呈现健康→`current` 零动作；变化/呈现态与磁盘真相不符→`refresh`（元数据相同时不推进代次——断连恢复走浏览器缓存命中，无需网络重取）。维持态（全部条目已呈 not-found / inaccessible）不扰动。

### 状态呈现与边界

- 失败态细分：`vsidian-image-notfound`（明确删除，淡红底）/ `vsidian-image-unreachable`（不可访问，警告黄边）叠加在 error 基类上，与 `data-vsidian-img-reason` 同步；词条 `decor.imageNotFound` / `decor.imageInaccessible` 双语 parity。样式契约条目 `image-failure-variants`（content 域），CSS 规则由 `imageStatesCssContract.test.ts` 钉住。
- 失败槽位（error 态）保留在活跃图源集内被周期核验覆盖——文件恢复（watcher create 事件即时 / 周期核验兜底）后重新显示。
- 无工作区：无 watcher，按需 stat（解析请求路径）与周期核验照常（不依赖全库索引）；HTTP(S) 直连图源不经本管线（webview `isDirectSrc` 分支，不入失效/核验/活跃度）；不持久化图片内容，刷新零写回（不改 Markdown/dirty）。
- 观测通道：`view.state.imageEntries`（条目明细含 `appliedSrc`——`?v=` 代次可直接断言）；测试钩子 `_test.takeImageRefreshEvents`（失效日志）/ `_test.getImageVersions`（版本表快照）。

### 顺带修复（既有缺陷）

`releaseImages` 原实现无条件解绑 load/error 监听——阅读槽位的 img 即 slot 本身，重试（error→ok 路径）或失效重发后再应用 src 会永远停在 loading（监听已随首次释放丢失）。修复为仅 live 槽位（render 回调创建的内部 img）随释放解绑，阅读槽位监听与槽位同生命周期（代次守卫改由事件目标过滤承担）。

## 工单与依赖

总规格：[#194](https://github.com/ONEGAYI/vsidian/issues/194)。

| 工单 | 交付 | Blocked by |
| --- | --- | --- |
| [#195](https://github.com/ONEGAYI/vsidian/issues/195) | research: 引用索引存储选型与三档容量基准 | 无 |
| [#196](https://github.com/ONEGAYI/vsidian/issues/196) | feat: 双链与文件引用统一为根内相对路径解析 | 无 |
| [#197](https://github.com/ONEGAYI/vsidian/issues/197) | feat: 持久引用索引与当前笔记反链面板首条闭环 | #195、#196 |
| [#198](https://github.com/ONEGAYI/vsidian/issues/198) | feat: 索引增量维护、排除设置与完整重建 | #197 |
| [#199](https://github.com/ONEGAYI/vsidian/issues/199) | feat: 单文件更名与移动自动更新引用 | #198 |
| [#200](https://github.com/ONEGAYI/vsidian/issues/200) | feat: 文件夹及批量移动的引用更新闭环 | #199 |
| [#201](https://github.com/ONEGAYI/vsidian/issues/201) | fix: 文件图片定期刷新与删除后找不到状态 | #198 |
| [#202](https://github.com/ONEGAYI/vsidian/issues/202) | test: 引用索引整体验证、Remote SSH 与实施文档收口 | #200、#201 |

#195–#202 八票已全部完成开发与自动化验证（2026-09-29 收口，见文末「#202 收口落档」节）；总票保持开放，最终实施与用户验收另行记录，子票完成不替代用户验收。

## #199 实施落档（2026-09-29）

工单 #199（单文件更名与移动自动更新引用）的落地事实。分层：`src/shared/vaultRename.ts`（改写计划纯逻辑单一事实源）→ `VaultIndexService.renameCandidatesOf` / `refreshRenamed`（候选查询与索引刷新）→ `src/host/vaultRenameWiring.ts`（will/did 双通道装配）。

### 通道实测结论（1.86.2 真实宿主）

- **触发面**：资源管理器/命令面板 rename 与 `workspace.applyEdit(renameFile)` 都触发 onWillRenameFiles + onDidRenameFiles；`workspace.fs.rename` 与外部工具改名**不触发**（后者只经 watcher 增量维护，不改写——「不猜测旧新身份」）。
- **will 事件时序**：rename 执行**前**分发（文件仍在旧路径）；`waitUntil` 必须在事件分发期间同步调用（类型注释明言异步调用 throw）；宿主对 will edit 的应用与 rename 合并为**一个撤销单元**——实测撤销一步同时恢复文件名与全部引用文档文本（含未打开文档）。
- **will edit 的硬边界（实测裁决，驱动设计）**：will edit 里对 **newUri（rename 参与文件）的 text edit 不被支持**——edit 先于 rename 应用，目标不存在导致**整笔 edit 连同 rename 被拒**（`applyEdit` 仍返回 true，rename 实际未发生）；对**非参与文件**的 edit 正常应用。官方 TS 扩展的 import 改写同通道也只改其他文件。→ 引用者（非参与文件）改写走 will 通道（原子、一步撤销）；**被移动文档自身的出链改写与 dirty 引用者的改写走 did 通道**（rename 完成后独立 `applyEdit`，文件已存在、对 dirty buffer 按当前内容叠加）。
- **will edit 对 dirty 文档会回滚未保存内容**（实测）：引用者文档有未保存编辑时，will edit 应用于**保存态**坐标、未保存内容被丢弃。→ dirty 引用者（`TextDocument.isDirty`）在 will 阶段剔除，延迟到 did 以常规 `applyEdit` 叠加（常规 edit 对 dirty buffer 正常叠加，不覆盖未保存内容）。
- **undo 栈焦点语义（实测）**：bulk edit 的撤销项挂在受影响文档的撤销栈；焦点在**非受影响文档**（如仅有未保存编辑的引用者面板）时执行 undo 撤的是焦点文档自己的编辑而非 rename——自动恢复流程不得假设 undo 一步总能回滚 rename。
- **时限**：will 通道计划生成为内存索引查询 + 有限文档读取（引用者数量级），正常规模远低于宿主 will 事件等待上限；超时/reject 的行为（rename 照常、edit 丢弃）为宿主语义，不构成可承诺的原子性。
- **通知时机**：did 阶段合并发出（引用者 + 出链 + dirty 三部分都已应用/落定，计数才完全真实）；will 阶段 token 取消不生成计划不打扰。

### 改写计划语义（纯逻辑契约，`test/unit/vaultRename.test.ts` 钉住）

- 目标子串替换：wikilink 只换 `[[` 后路径段（`#`/`|` 之前），mdlink/image/refdef 只换 href 路径部分（首个 `#`/`?` 之前）——别名、锚点、query、无关正文原样保留；`<>` 尖括号包裹段整段替换（新路径含空格且字面风格时重新包裹）。
- 相对路径按**改写应用文档目录**重算（引用者原目录、被移动文档新目录）；双链省略扩展名维持省略、显式扩展名保持完整（不产生 `x.pdf.md`）；编码风格跟随原文（`%XX` 形态按生成侧惯例编码，字面中文/空格直写）。
- 跨根（新相对路径越出应用文档所属根，或应用文档无根）→ 整文档跳过并报告 `cross-root`；区间漂移（索引边区间在当前文本上定位/校验失败）→ 文档级跳过 `edge-stale`（过期不硬改）。
- moves 为映射表：同批移动互指出链统一改写——#200 批量/目录移动的接口已就绪（`RenamePlanContext.moves` 数组即批量输入）。
- LF 偏移 → 宿主行/列换算 `lfOffsetToLineCol`（`
|
|
` 与 LF 归一对偶拆分，CRLF 宿主列不漂移）。

### 索引侧接口

- `renameCandidatesOf(oldFsPath)`：指向目标的引用边（按来源分组，基线+覆盖层合并——覆盖层在场来源用未保存文本的边）+ 被移动文档出链（覆盖层优先）；`not-ready`（首扫未完成）显式返回，调用方不得静默部分更新。
- `refreshRenamed(old, new)`（did 通道）：旧路径 missing 正证据移除（不可访问标 stale 不当删除）；新路径 .md 增量重扫、非 .md 附件**无条件登记** asset（事件驱动窄登记——保证改写后引用解析延续；无人引用的冗余条目由全量重扫自然校正）；排除的 .md 不入索引域。
- **已知边界（覆盖层断链滞留）**：rename 往返（rename 又撤销/移回）后，未保存引用文档的覆盖层边滞留在抽取时刻的断链形态（覆盖层只在文档变更时重抽），其反链/改写候选在下次编辑前缺失——编辑即自愈，无需干预；另注意文档重开后 `TextDocument.version` 重新计数，首次编辑可能与覆盖层旧条目同号被版本仲裁拒绝（第二次编辑起采信）。

### 快捷键评估

本票为**自动触达操作**（rename/move 事件驱动，无用户主动命令面）：不注册新操作、不占键位（keybindings.md 已记录）。

### 验证记录（2026-09-29，本机 Windows 独立桌面宿主）

- 单测：`test/unit/vaultRename.test.ts` 27 例 + 服务新增 9 例全绿；全量 unit 3477（vitest）+ 99（node --test）通过（unit-199.log）。
- 集成（分片全量，integration-199.log）：4 个 rename 用例中「多边型改写/面板同步/通知与撤销」「move 出链重算与附件」「未保存漂移保护与叠加改写」三例 PASS；「跨根移动不改写」**未能在本机执行**——它依赖 `updateWorkspaceFolders` 加第二根，而该 API 在当前本机触发宿主静默退出（独立桌面/前台模式均复现，**基线 fd0e9d3 同样复现**——#198 既有环境问题，非本票引入；CI Linux 通道不受影响时该用例正常执行）。跨根改写语义由单测矩阵覆盖（vaultRename.test.ts 跨根两例）。
- 同轮全量的 5 个既有失败（剪贴板族 #69/#79-81/#84/#162 与「视口源锚点」偶发）经基线 worktree 全量对照**全部复现**——本机环境干扰，与本票无关；视口锚点单跑复核通过。
- onWillRenameFiles 时限：计划生成为内存索引查询 + 逐引用者一次文本装载（本机 3 引用者场景 will→did 全链 <4s，用例 1 全程 3.4s），未见宿主超时截断；超时行为（rename 照常、edit 丢弃）为宿主语义不作承诺。

## #200 实施落档（2026-09-29）

工单 #200（文件夹及批量移动的引用更新闭环）的落地事实。分层：`src/shared/vaultRename.ts` 的 `expandRenameMoves`（目录映射展开纯逻辑）→ `VaultIndexService.refreshRenamedBatch` / `indexedFilesUnder` / `isExcludedDirDeep`（索引批量化与清单查询）→ `src/host/vaultRenameWiring.ts`（will/did 双通道整批接线）。通道语义（will 原子改写 + did 独立出链改写、dirty 延迟、撤销单元）沿用 #199 实测结论，本票只做批量化，不改通道分工。

### 目录/批量映射展开

- **展开输入**：目录 rename/move 的 `event.files` 只给目录级 old→new（1.86 实测）——`expandRenameMoves` 展开为目录下全部受影响文件的逐文件映射。清单两路合流：**fs 递归列举的 .md**（workspace.fs.readDirectory 逐层让出；索引滞后兜底，保证 did 批量重扫后索引域完整）∪ **索引清单**（`indexedFilesUnder` 前缀查询；asset 只在被引用时有登记——未引用附件无引用边，不产生映射）。整体排除的子树（.git、node_modules 等）按 `isExcludedDirDeep` 探测剪枝不进入列举；纯文件名排除模式（如 `*.md`）不误剪（探测路径不命中，目录内有未排除内容）。
- **目录判定双侧探测**（`isDirectory(old) || isDirectory(new)`）：will 阶段旧路径有效；did 保底阶段旧目录已消失但新路径是目录 + 索引仍是旧形态（watcher 对目录 rename 无逐文件事件，#198 实测边界）同样可展开。
- **索引未就绪**：目录展开时根 not-ready 则**整个目录放弃**并计数（不静默部分更新——not-ready 根的候选边查询与批量刷新同样无效），did 阶段反馈说明。
- **去重**：同 old 折叠（Windows 大小写语义），显式文件条目优先于展开产物；输出剔除被替代的原始目录条目。

### 同批统一规划

- 整批**一次** `planVaultRenameRewrites`（映射表统一，不逐条重复替换）；同一引用者指向批内多个目标时边并集合并为单文档输入——**同文档多目标一次 WorkspaceEdit**（#199 单 move 粒度下重复入计划、fillEdit 两次的潜在重复编辑随之修复）。
- **被移动文件不作为引用者走 will 通道**（movedOldKeys 排除）：目录内文档互链的改写由 did 出链通道按新目录统一重算（出链重算经 moveByOld 命中同批映射，已涵盖指向同批目标的边）；同时避免对目录 rename 参与文件发 will edit（宿主对参与文件 edit 的拒绝边界见 #199 实测——目录内文件是否属「参与文件」未经宿主承诺，保守走 did）。
- **恒等替换滤除**：重算结果与原文一致的边（目录整体平移时同目录互链、同级上行的相对路径不变）不产生编辑、不计入编辑数——目录 rename 场景「互链不改写」由该滤除自然成立。反例（只移 a 不移 b）不是恒等：b 留在原处，a 的 `[[b]]` 须改 `../原目录/b`——语义由单测钉住。
- 跨根目录移动：前缀替换照常展开，改写侧按 #199 的 cross-root 文档级跳过与报告（不生成跨根相对引用、不伪报全部成功）；本机宿主级用例因 `updateWorkspaceFolders` 崩溃（#198 既有环境问题）不做，语义由单测矩阵覆盖（展开跨根前缀 + plan 跨根跳过），CI Linux 通道验证留 #202。

### 索引批量化（refreshRenamedBatch）

- 整批一次处理而非逐文件循环提交：旧侧移除须 missing 正证据（不可访问标 stale）；旧路径 rename 后仍可访问的极端形态跳过（watcher 增量兜底，单条通道 rescanFile 的 ok 重扫等价行为由增量队列承担）。新侧 .md **两遍登记**：遍 1 装载文本与 stat 登记 files entry、遍 2 统一抽边——批内互链文档（目录内 A 引用 B）的 resolver 可见完整新清单，不因处理顺序产生断链；非 .md 附件无条件登记 asset（同单条通道的事件驱动窄登记）。排除的 .md 不进不出。
- **批末合并**：每根一次 backlinks 重建 + 一次广播 + 一次快照提交（去抖合并）；分批让出复用 `rescanBatchFiles`；`publishTargetChange` 逐文件保持（#201 消费 per-target 代次）。`refreshRenamed` 改为单条委托（#199 既有 4 例不回归）。
- **did 保底**（will 未观察——激活竞态等）：按索引清单就地展开完成刷新，但不改写不通知（引用者边与出链边须取自 rename 前索引，无法安全重建规划）——与「外部工具改名只更新索引」同语义。批次按原始 event.files 排序序列化配对（目录级映射不进键，will/did 原始映射恒一致）；暂存批次上限 8 防悬挂泄漏。

### 批量反馈与撤销

- 三态通知键族沿用 #199，目录/批量项数合并展示（`{file}` 显示首移动项名——目录 rename 时为目录名）；观测日志新增 `expandedMoves`（展开后条数）。**未更新项详情**：warning 级通知附「未更新项：文件名（原因）」列表（前 3 项 + 余量计数；原因双语文案键 `host.renameRefsSkipCrossRoot` / `SkipEdgeStale`）。
- 撤销语义与 #199 同构：will edit 与 rename 同撤销单元（目录 rename 实测 undo 一步同时回滚目录名与全部引用者文本）；did 出链整批一次 applyEdit（多文档 bulk edit 为一个撤销单元）。
- **undo 触发反向事件链（实测新增）**：1.86.2 Windows 下 undo 回滚 rename 也会触发 will/did 事件（反向映射）——反向 will 的 fs 旧路径列举可能 ENOENT（目录已被 undo 回滚，无害，catch 后索引清单兜底）；反向 did 经 did 保底展开完成索引回滚自愈（集成用例 1 的 undo 后现场不依赖人工还原即收敛，保险还原仍保留）。

### 快捷键评估

本票同 #199 为**自动触达操作**（rename/move 事件驱动，无用户主动命令面）：不注册新操作、不占键位（keybindings.md 已记录）。

### 已知边界

- **asset 条目滞留**：watcher 只监听 `*.md`，fs 通道（外部工具/测试还原）把附件移回旧名不触发 asset 重登记——rename 候选的附件边查不到（引用者文本手动改回的场景）。编辑或完整重建自愈（集成侧此前用前置完整重建规避，改独立文档组后不再需要）。
- **覆盖层滞留的跨用例放大（实测教训）**：#199 已知边界「覆盖层只在文档变更时重抽（编辑即自愈）」在**跨用例/跨场景**不自愈——前置场景泄漏的 dirty buffer（文档仍开着、停在旧批名形态）使后续 rename 的 did dirty 重查按区间校验 stale（只改未漂移边）。属规格内漂移保护（过期不硬改），非缺陷；测试侧用独立文档组隔离（同批用例不与漂移保护用例共享 fixture）。**引用者关闭后的覆盖层滞留已由 review-loops #18 修复**：onDidCloseTextDocument 接线 `documentClosed`（宿主级用例「反链幽灵退场」钉住），未保存内容随文档关闭退役、反链回磁盘基线，不再滞留指向旧目标。
- **did 保底不改写**：激活竞态下 will 未观察的 rename 只刷新索引不改写（边界如实，不伪报）。
- 展开的 fs 递归列举成本：大目录（万级文件）一次列举本地 <100ms 量级；Remote SSH 下有网络往返（每层 readDirectory 一次 RPC + 逐层让出），不构成承诺时限（宿主 will 等待语义见 #199）。

### 验证记录（2026-09-29，本机 Windows 独立桌面宿主）

- 单测：`vaultRename.test.ts` 35 例（#199 的 27 + #200 新增 8：展开 6——嵌套多层与 fs∪索引合流、混合批、去重优先序、not-ready 放弃、did 保底、跨根前缀展开；恒等滤除 2——平移无编辑与真替换并存）+ `vaultIndexService.test.ts` 增 7 例（清单前缀与 null 语义、目录批守恒与反链新键、批内互链不断链、整批一次广播与一次 CURRENT 提交、大目录分批让出、跨根批两根各自更新、排除语义）全绿；全量 unit 3492（vitest）+ 99（node --test）通过（unit-200.log）。
- 集成（integration-200.log，四片全量终跑）：206 项中 202 PASS；2 例失败为既有环境干扰——剪贴板族（#79-81，分片四宿主并发抢系统剪贴板的间歇窗口）与「Live 视口源锚点」（偶发易感，#199 记录同况）**单跑复核均 PASS**（integration-200-clip-rerun.log / integration-200-anchor-rerun.log——当前构建单跑通过即非构建性缺陷的证据，无需再对基线差分）。#200 三用例（目录 rename 批量改写与一步撤销、目录跨深度 move 两通道合并反馈、多文件同批 rename 不重复编辑）与 #199 rename 族非跨根三例全部 PASS；「跨根移动」既有用例仍受 updateWorkspaceFolders 宿主崩溃限制（#198 既有，本批未新增宿主级跨根用例）。
- 首轮分片暴露同批用例被 #199 漂移保护用例的覆盖层滞留污染（见已知边界节），改独立 batch 文档组后干扰序列与三用例连跑复跑均 PASS（integration-200-repro5/6/7.log）。
- 目录 rename 用例 1 的 undo 反向事件链（will ENOENT + did 保底自愈）在本轮实测确认并落档。

## #202 收口落档（2026-09-29）

工单 #202（整体验证、Remote SSH 与实施文档收口）的落地记录。**收口前提修正**：开工核验发现 #201（图片刷新）在独立并行分支 `impl/201-image-refresh`、未并入 #200 完成点——整批验证对象不完整；先以 merge 提交（aa66f7a）将两线合一（文档冲突按两侧全保留解、tree.json 走技能 merge 命令），后续全部验证跑在合并后代码上。

### 验证矩阵与环境族判定

全量六类验证（compile / unit / stylecontract+baseline / browser 33 脚本 / 四分片 integration 209 项 / VSIX 安装态）首跑日志全部落盘 `logs/`，逐项统计与判定见 [manual-verification.md](manual-verification.md) 的 #202 节，此处只记结论：

- **编译、单测（3566+99）、契约检查（含 #201 清单变更后重跑）全绿**。
- browser 31/33：settingsPage/languageSwitch 为环境属性（fd0e9d3 基线差分同败，差分日志在案）；imageRefresh 随合并入列并通过。
- integration 与安装态的全部失败/缺失均归三族既有环境问题：**updateWorkspaceFolders 宿主静默退出**（分片两轮 + 安装态一轮、崩溃点全部落在「根增删」用例——三轮复现坐实；其后用例连带未执行）、**视口锚点偶发**（定向复跑 PASS）、settingsPage/languageSwitch（browser 侧）。**零例本批功能回归**。
- 场景补验：新增集成用例「批量文件增删的队列收敛与索引守恒（Git 切换量级 100 文件）」定向 PASS；缓存损坏（单测矩阵 + #198 重建/清理宿主用例）、双窗口（单测代际仲裁）、根增删（单测 + CI 待验）、目录移动与图片覆盖删除恢复（#200/#201 既有用例本轮复跑全过）的证据链逐项落档于 manual-verification #202 节。

### 三档复测

同语料同脚本对当前 HEAD 复测，与 #195 首测对照：**无衰减**——磁盘占用三档字节级一致、冷恢复/查询/批量同数量级；100k 首建 +31% 与同步提交饿死 −44% 归因环境负载（SQLite 对照物同向约 −48%，代码未变）。生产路径经 chunked 分批让出（#197 落地），同步上限数字不构成生产声明。数据与归因见 [2026-09-vault-index-storage.md](../perf/2026-09-vault-index-storage.md) 的「#202 复测」节与 [vault-index-storage-bench-recheck.json](../perf/data/vault-index-storage-bench-recheck.json)。

### 相对路径兼容变化（显著声明，随交付说明）

#196 起双链只按来源文档相对路径解析：**旧跨目录短名双链（如子目录文档里的 `[[根目录笔记]]`）不再命中**，跳转提示目标不存在、正文不自动改写（改用 `[[../根目录笔记]]`）；**QuickPick 同名候选选择随 basename 搜索一并废除**，不再出现「找到多个目标」弹窗。不自动迁移旧正文；CHANGELOG 未发布段已显著写明。

### 文档与发布物料收口

- **CHANGELOG**：对齐 main 0.6.0 起的 Unreleased 段约定——本批 #196–#201 六条用户可见条目自 0.5.0 段（发布后回填，违反「已发布段落不得回填删改」）迁入新建 `## Unreleased - 开发中` 段（QuickPick 废除一句随迁显著化、#199 条目补票号），0.5.0 段恢复 v0.5.0 tag 快照原样（diff 验证仅头部说明差异）；头部说明更新为 Unreleased 约定文本。
- **manual-verification.md**：新增 #202 收口节（验证矩阵、证据链、新增人工待验 5 项、Remote SSH 待验 6 项）。
- **keybindings.md**：随合并取得 #201 评估记录；#199/#200/#201 均为自动触达无键位，#197 反链面板与 #198 索引维护命令的登记此前已在案——本批快捷键评估记录齐备。
- **file-tree**：复测数据文件已登记，`check --strict` 通过。

### 遗留与待验汇总

Remote SSH 六项待验（存储落宿主侧、断连恢复、远端事件循环、图片 inaccessible 呈现、远端大目录 will 时限、watcher 端到端时延）与本机不可达场景（双窗口、跨根移动宿主操作、启动装载损坏快照）见 [manual-verification.md](manual-verification.md) 的 #202 节——均**不以本地数据冒充通过**；根增删/跨根两集成用例标注 CI Linux 执行。本票不自动授权推送或合并，总票 #194 与用户验收保持开放。

## 反链面板形态改版与出链面板（验收反馈一轮，2026-09-29 落档）

PR #203 用户验收反馈的一轮设计落地：反链面板形态改版（工具栏 + 分组卡片 + 命中高亮）与新增出链面板。两面板与大纲构成**三面板互斥**（沿用 `vsidian-backlinks-active` 类机制扩展出 `vsidian-outlinks-active`），恢复收敛优先级大纲 > 反链 > 出链。

### 反链面板新形态

- **结构**：工具栏（四按钮横排居中）→ 搜索框（按钮下方、居中、水平占满侧栏宽，显隐唯一开关 `hidden` 属性）→ 更新中细条（ready + updating 时面板首位）→ 页头（「链接当前文件」+ 右对齐卡片计数）→ 按来源分组（组头 = chevron + 来源名 + 组内计数，可点击折叠/展开该组）→ 组内白色上下文卡片（每条引用一张；卡片近似直角、行高约 1.4；`vsidian-backlink-card` 与 #197 既有 `vsidian-backlink-item` 类并挂——公开锚点兼容）。loading/error/空文档退化为纯占位（无工具栏）。
- **排序**（工具栏「排序」下拉：六项三组、组间分隔线，Esc/外点关闭，当前项 aria-checked 勾选）：文件名（A-Z / Z-A，显示名码位）；编辑时间（从新到旧 / 从旧到新，组按来源文件 mtimeMs）；创建时间（从新到旧 / 从旧到新，组按来源文件 birthtimeMs）。未知时间（0/缺省）沉底并保持稳定序（同键按显示名码位）；组内条目固定稳定序（路径 → 区间起点）。分组纯逻辑在 `src/webview/backlinkGrouping.ts`（单测直驱）。
- **搜索**：过滤匹配来源文件名 + 短/长片段文本，不区分大小写；Esc 关闭并清空；空结果显示「无匹配」占位（与「没有反向链接」空态区分）。
- **折叠全部**：全部折叠/全部展开二态切换（aria-pressed）。
- **更多上下文**：短/长片段切换（aria-pressed，纯显示层）。宿主快照同时携带两种片段：短 = 引用行截断（#197 既有），长 = 引用行 ±2 行、总长上限约 300 字符、首尾按截断加「…」。
- **命中高亮**：卡片内命中链接的**原始 Markdown 语法整体**（`[...](...)` 或 `[[...]]` 连同括号与 URL）黄底高亮（`mark.vsidian-backlink-hit`；`--vsidian-backlink-hit-bg` 变量明暗两值：light `#ffec99`、dark/高对比约 30% 黄叠加），高亮内文字颜色不变、不加下划线。宿主载荷带 `snippetStart` / `snippetLongStart`（片段在全文中的 LF 起点），webview 按区间减起点切分文本包 mark；载荷缺省（旧宿主快照）不高亮（起点未知宁缺不错位）。

### 出链面板（新增）

- **结构**：页头（「当前笔记中的链接」+ 右上浅灰计数）+ 平铺两行条目（行 1 = 链形小图标 + 目标显示名；行 2 = 目标路径悬挂缩进，约主行 85% 字号）。四态与反链一致（loading / ready 空=「无链接」/ error 含 no-workspace；updating 细条）。DOM 在 `src/webview/outlinkPanel.ts`。
- **条目语义**：目标显示名 = 解析命中目标的 basename 去扩展名；断链用 target 原文并整体弱化（`broken` 类 + `disabled`）不可点；条目点击经 `outlink.activate` 由宿主打开目标——**按该链接实际的锚点定位**（标题 → `findHeadingOffset`、`#^块id` → `findBlockOffset`，与双链跳转同一锚点定位器；无锚点或未命中回落文档顶）。非 Markdown 目标（图片附件）经 `vscode.open` 原生打开（Vsidian 自定义编辑器不接非 md）。
- **数据面**：`VaultIndexService.outlinksOf`（含覆盖层未保存态——覆盖层在场用覆盖层边，与 queryBacklinks 同源语义）；**外部 scheme（https:// 等）与危险 scheme 边不进面板**（判别复用跳转链路同一分类器 `classifyLinkTarget` / `classifyImageTarget`，帮手 `isVaultPanelOutlink` 在 `src/host/vaultLinkExtract.ts`）；stable 排序 resolved → 目标 → 区间。
- **协议**：`outlinks.get`（拉取）/ `outlinks.snapshot`（响应 + 索引变更推送——与 backlinks 同一 `onChange` 广播点、独立 seq）/ `outlink.activate` / `outlinks.test.*` 测试钩子（宿主侧 `VSIDIAN_TEST_HOOKS` 门控转发）。

### 侧栏图标与设置页

- 两枚侧栏图标（24 系 viewBox、currentColor、线宽由 CSS 契约钉住）：反链 = 织结双链环 + 左折返箭头；出链 = 织结双链环 + 右出箭头（lucide link 造型语言；参考图 `docs/design/links-panel-icons-reference.png`，面板参考图同目录）。正式管线资产化属后续批次。
- 设置页「索引维护」分页图标自 'editor' 铅笔改为链环 glyph（`icon()` 新增 'links' kind，链环 path 与侧栏图标同形）。

### 数据层增量

- `VaultFileEntry` 增可选 `birthtimeMs`（Windows 取 stat birthtime；POSIX 常不可得为 0/缺省）。wiring 侧取 `vscode.workspace.fs.stat` 的 `ctime`（0/缺省不写键）。快照序列化为文件行**可选第 6 列**（>0 才写）——旧快照缺列容忍（undefined → 排序沉底），不升格式版本；未采集的片继承不受扰动，增量重扫自愈补齐。
- `BacklinkItemPayload` 扩展：`sourceMtimeMs` / `sourceBirthtimeMs`（组排序键；未知 0）、`snippetLong` / `snippetLongStart`（长片段及其起点）、`snippetStart`（短片段起点，高亮切分基准）。新字段全部可选（旧宿主快照兼容）。

### 快捷键

「打开/切换出链面板」登记为双模式 UI 操作（`onegayi.vsidian.ui.outlinksToggle`，默认未绑定——与反链面板同款镜像）；面板内控件（排序/搜索/折叠/更多上下文）为面板局部交互不设全局键位（评估记录见 [keybindings.md](keybindings.md)）。

### 已知边界

- **排序与折叠态不持久化**（会话内存即可）：面板重载（webview reload）回到默认排序（文件名 A-Z）与全展开。
- **birthtime 平台差异**：Windows 有真实创建时间；POSIX/部分远程语义弱（0/缺省）——按创建时间排序时未知沉底，不代表文件真的最旧。
- **外链不进面板**：https:// 等外部 scheme 与危险 scheme 边不出现在出链面板（「保留断链及未命中引用」的可见性以断链条目承担，外链跳转仍走正文链接点击）。
- **图标为内联 SVG 绘制**：几何按参考图规格（织结双链环 + 箭头）手绘，未经正式图标管线资产化（明暗资源、quick-actions 式 .svg 资产目录）；参考图存档于 `docs/design/`。
- **出链面板图片附件条目**经 `vscode.open` 原生打开（无锚点定位语义）；断链图片同样弱化不可点。

## 混排嵌入边的呈现同源修正（#246 落档，2026-10-01）

#246 起 Reading 侧（主文档正文、嵌入卡片内容、悬停内容）的 `![[…]]` 从独占行扩展到文字混排与列表/引用容器（见 [hover-preview-embed.md](hover-preview-embed.md) 的 #246 节）。索引侧 `vaultLinkExtract` 的行扫描本就不设行独占限制（#222 起混排/容器位置照常产边，区间为嵌入原文精确边界——本票以 `vaultLinkExtract` 单测与 #246 集成用例钉住），本票唯一语义修正是**注释排除**：

- `INLINE_SCAN_CODE_CONTEXTS`（宿主侧对 liveLinks 同名集合的复制）追加 lezer 的 `Comment`/`CommentBlock` 节点——行扫描类抽取（双链/嵌入/宽松链接）不再在 HTML 注释内产边。此前 `<!-- ![[B]] -->` 会抽出用户在阅读视图中**看不见**的引用边（#139 起注释整段剥离），反链面板出现不可见引用、rename 触达不可见位置；呈现接入混排后该分叉从角落问题放大为守卫边界的一部分，随本票与呈现同源。
- 与 liveLinks 行扫描的既有差异保留并在此明示：Live 视图呈现源文（注释文字可见），liveLinks 对注释内文本的源码装饰不受本修正影响；树驱动路径（Link/Image/LinkReference）本就依赖 lezer 不在注释内产节点，无行为变化。
- rename 链路无平行扫描器：`vaultRename` 按嵌入边区间只改路径、别名与锚点保留（与位置无关）；混排/容器位置的边区间即行扫描命中区间，改写语义与独占行一致。

链接文字域内的嵌入（`[文字 ![[B]] 文字](url)`——行扫描形态学命中，prev 非 `[`）照常产边（索引语义不变）；呈现侧产占位但不升级（嵌套 a 属非法 DOM），该呈现差异在样式契约 `embed-slot` 条目与浏览器用例钉住。
