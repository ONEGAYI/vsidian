# feat: 引用链接、图片与粘贴资产归直接目标

本地编号：P2-11

GitHub：[#288](https://github.com/ONEGAYI/vsidian/issues/288)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）、[#287](https://github.com/ONEGAYI/vsidian/issues/287)（P2-10）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `4e6da8f`，合并 `b2b24eb`）。五项验收自动化通过（含磁盘资产位置断言），证据见下「执行记录」；Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U15；验收 P2-A07、A12。

## 问题与交付

读取已有 B 来源上下文，但 Live 图片粘贴、资源刷新及打开动作不能借用 A 的文档目录或写入口。

内部 Live 的链接、图片、粘贴插入与资产存放全部归直接目标；释放、刷新与递归保持原有资源语义。

## 实施范围

- 普通链接、双链、图片解析与刷新以当前 B 为来源，经过宿主验证的目标绑定向既有资源端口传递身份。
- 图片粘贴在 B 的配置资产目录落盘并向 B 插入，复用现有命名／根边界／EOL 与失败结果；Reading 禁写。
- 图形／图片等现有弹层和导出操作保持调用实例的目标及资源身份，不扩展图形语言或图片弹窗既有排除范围。
- 资源结果关联实例／代次；目标切换、释放或迟到结果不能插入 A 或另一 B occurrence。递归接入后由 P2-14 核对 C 同语义。

## 验收标准

- [x] A 与 B 不同目录，B 内链接／图片指向 B 目录，资源点击不自动改写 A。（集成例 1：embed-assets 子目录 B 的图片解析与双链跳转按 B 归属，A 文本零改写）
- [x] B 粘贴资产按 B 的配置落盘且只向 B 插入；位置非法／写盘失败有正确结果，不误写父文档。（集成例 2 断言 PNG 出现在 B 同目录且 A 根目录 png 集合不变；失败结果复用既有管线）
- [x] Reading 对粘贴／任务等写操作保持禁写，目标变化或释放后的迟到图片结果不写错实例。（isLiveActive 实例身份闭包 + notifyPush portId/fsPath 配对 + 在途表；browser 场景 D 真实在途 reqId 注入验证释放后迟到零写入）
- [x] 图片刷新、既有图形／图片弹层代表性行为通过，Remote URI 接线通过真宿主并记录 SSH 待验。（browser imageRefresh/imagePopup/graphicPopup 套件回归；真宿主 1.82.3 通过，SSH 记人工清单）
- [x] imagePaste／imageRefresh 与资源宿主回归证明目标文本和磁盘资产位置。（browser imagePaste + 集成磁盘断言）

## 复用入口与验证

src/host/textEditorProvider.ts 资源端口、imagePasteHost 与资源解析；webview imageResource、粘贴与既有图形／图片弹层。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-11` 完成（TDD 15 例先红 `logs/p2-11/red-phase.log`：embedLiveResources 12 + refEditProtocol 2 + documentSession image.export 守卫 1），提交 `4e6da8f`，合并 `b2b24eb`（与 P2-06/07/08/13 四票交错区人工解冲：embedCard 的 onLocalInputSettled 取 P2-06 保活扩展版 + P2-11 imagePopupSource 整块保留；cases.ts 的 P2-06 块与 P2-11 块拼接；run.mjs 套件并集；attachPanel 参数内 P2-13 记账与 P2-11 资源注入交织复核）。

**资源身份 = 端口绑定**：资源消息（link.activate/wikilink.activate/image.request/image.paste/refresh.request）全部经 refEdit.message 信封进 B 会话——宿主按 portId 绑定校验，B 会话按自身 docUri 守卫并带解析缓存/在途去重/失效反查/刷新代次完整语义（与 #220 悬停浮层 sourceDocUri 直发是两条并行路径）。宿主侧 refEdit.bind 虚拟面板注入 B 身份资源端口（resolveImage B 目录解析、pasteImage 目录/相对路径/工作区 folder 基准 = B、openLink/openWikilink 以 B 为解析语境）。

**reqId 撞号防线**：实例请求走端口后回包经 refEdit.push 信封按 portId 定向；A 面板广播 image.result 不再投递实例管理器——两侧 reqId 空间（各自从 0 自增）撞号时不再错插错图。迟到结果四层防线：宿主 portId 释放拒收 + webview notifyPush 配对 + 实例内 imagePastePending 在途表 + isLiveActive 实例身份闭包。

**连带正面效应**：isLiveActive 接真使 B 内空白表格组合规划（beginBlankComposition）恢复——P2-10 记录的范围缺口由本票必要改动自然闭合（P2-14 收口验证）。两处顺手修复的真缺陷（有据非扩界）：弹窗存续期 closeImagePopup 误用全局 context 管理器 detach（改为打开时快照）；嵌入实例从未收到设置快照（创建晚于面板装载，补 lastSettings 留存补发）。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-11/final-compile.log` |
| 全量 unit（244 文件全绿） | 通过 | `logs/p2-11/final-unit.log` |
| browser 9 套件（含新 embedLiveResources 6 场景） | 全过 | `logs/p2-11/final-browser.log` |
| 定向集成 1.82.3 真宿主（P2-11 两例 + #161×3 + #208/#220/#212/#111 + P2-04×3 + P2-07 + P2-10 共 14 例） | 14/14 | `logs/p2-11/final-integration.log` |
| `npm run check:stylecontract` | 八项零失败 | `logs/p2-11/final-stylecontract.log` |

合并树复验（`logs/merge-p2-11-*`）：compile 通过、全量 unit 247 文件/5300 例、browser 11 套件（+hoverLive/tableCellLive 交错票复盖）、定向集成 10/10（+P2-06/P2-13/P2-04/P2-07 交错票）。

**移交边界**：codeblock.copy 仍丢弃（信封白名单外）——内部 Live 代码卡复制按钮暂无动作，归 P2-14 收口核对；周期核验调度器不挂嵌入实例管理器（与 1.5 期 B Reading 同口径，失效靠 image.invalidate 信封回推，#201 兜底不覆盖嵌入图，边界一致未扩面）；hoverPopup/targetTip 单槽未迁移（P2-06 已实施浮窗根 Live，其内部嵌入的悬停无触发路径——live 视图链接非 `a[href]`）；递归 C 同语义归 P2-09/P2-14；Remote URI 观感待 SSH 人工验收。测试钩子增量（embed.test.pasteImage 消息 + `_test.injectWebviewReceived` 宿主命令，均 hooks 门控内）供 P2-14 复用。
