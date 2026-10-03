# feat: 引用完整 Live 操作与实例焦点分派

本地编号：P2-10

GitHub：[#287](https://github.com/ONEGAYI/vsidian/issues/287)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#281](https://github.com/ONEGAYI/vsidian/issues/281)（P2-04）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `f36f42f`，与 P2-05 合并解冲突后落 `1f1be6c`）。五项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标／Remote SSH 观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U09、U12–U14、U26；验收 P2-A04、A06、A12、A13。

## 问题与交付

复用 EditorView 不足以证明完整 Live：菜单、格式操作、属性浮层和表格等仍可能绑定主正文。

正文已有格式、结构化编辑、菜单与快捷键在引用内指向实际目标；Reading 继续全部禁写。

## 实施范围

- 迁移尚未实例化的现有操作：格式／段落、任务、表格、属性、符号输入、多光标等已有正文能力，不新增新的语法功能。
- 菜单与属性／表格等编辑控件捕获调用实例和 B 目标；打开后焦点变化、实例释放或目标换版仍重验，不能落到 A。
- 实例资源依赖与根面板 chrome 分离；修正单编辑器操作假设，完成相关 expand-contract，保留现有默认绑定、弹层优先级和 i18n。
- 新增内部切换、目标保存、显式关闭和冲突操作登记可绑定入口；模式切换／冲突选择默认未绑定，Ctrl+S／Esc 按已确认范围使用。
- Reading 不授予任务／属性写能力，阅读头区与菜单既有边界保持；不因二期扩大正文功能本身。

## 验收标准

- [x] 目标文本实际反映格式、任务、表格和属性操作；每笔事务仍经 B 标准出站并入宿主历史，A 保持原文。（集成例「格式/表格/Popover 落 B 不落 A」+ browser embedLiveActions 8 场景真实键盘）
- [x] 相同键位在 A／B 焦点之间正确分派，父子不重复消费，设置页／源码模式输入不被接管。（键位路由以焦点实例的内部模式放行写操作；capture 层拦截格式键、Mod-Z 归实例 keymap——父子不双消费；`embedFocusBlocked` 吞掉面板会话绑定类操作不落 A）
- [x] 菜单或属性浮层打开后焦点变化与实例释放不会写入错误目标；Reading 同入口／快捷键零写回。（`openContextMenu` 捕获调用实例 + 执行前双重重验：实例在场 `liveViewEntry` + 文档快照一致；fm Popover 随 `teardownLive` 配对关闭；Reading `targetEditable` 门控零写）
- [x] 复用的多光标、符号输入与表格原生输入代表性回归通过，文案两语言 parity 和 manifest 生成正确。（多光标/词移动/表格命令目标化；nlsManifest 78 条统一口径断言绿）
- [x] 新增可见入口／控件有 CSS 契约与绘制层证据；主正文能力没有被引用实例接线破坏。（quick action 状态随目标刷新；嵌入路径 `posAtCoords(x,y,false)` 估计定位修复——CM6 精确模式对滚动容器外行返回 null；全量 browser 回归绿）

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-10` 完成（TDD 16 例先红 `logs/p2-10/p210-red-phase.log`），提交 `f36f42f`。与 P2-05 同域冲突由父代理按「显式关闭统一」解：本票的 `closeFocused` 占位实现（切 Reading 释放端口）由 P2-05 完整确认链路取代，登记项 `embedClose` 保留（mode 收窄 live）。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-10/p210-compile-final.log` |
| `npm run test:unit` 全量 | 240 文件 / 5196 全绿（新增 17） | `logs/p2-10/p210-unit-final.log` |
| browser 新套件 embedLiveActions 8 场景 | 全绿 | `logs/p2-10/p210-browser-final.log` |
| browser 定向回归（嵌入族 7 + 悬停/键位 + 代表性共 31 套次） | 全绿 | `logs/p2-10/p210-browser-regress.log` |
| 定向集成 1.82.3 真宿主 | 14/15（唯一失败为 #222 既有回归，本票合入前已由 CI 修复分支处理，见下） | `logs/p2-10/p210-integration-final.log` |
| `npm run check:stylecontract` | 8 项零失败 | `logs/p2-10/p210-stylecontract-final.log` |
| **合并树复验**（P2-05+P2-10+CI 修复叠加） | compile／全量 unit／全量 browser／定向集成 | `logs/merged-final-*.log` |

**单编辑器假设修正清单**：操作目标解析单一入口 `actionTarget()`（原取 `this.view` 的格式/表格/多光标/词移动/块链接/剪贴板/quick action/菜单命令全部改经此）；门控 `targetEditable` 按实例暂停判定不查宿主 `viewMode`（父 Reading + 嵌入手动 Live 合法）；统一菜单捕获+双重重验；diagramPopup 文档源单槽迁移为打开时捕获实例源；fm Popover 实例释放联动；粘贴桥按发起时捕获目标重验。

**安全降级（记录为实例化前边界）**：查找/选词/链接预览族（面板会话绑定主编辑器）在嵌入焦点下吞掉不执行——不落 A；已记录于 `docs/specs/keybindings.md` P2-10 节。

**P2-07 轮补充发现的范围缺口**：嵌入编辑器 `isLiveActive: () => false`（`src/webview/embedCard.ts`）使 B 内**空白表格输入的组合规划**（表格结构编辑）未随本票落地——键入正常但无结构规划；属本票「表格」目标化的未竟部分，图片粘贴拦截保持关闭正确（P2-11 资产票）。已列入 P2-14 收口清单评估补齐或降级记录。

**本票报告牵出的战役级修复**：其定向集成唯一失败例（#222）经父代理归因为 P2-04 虚拟面板混入 `_test.*` 钩子的面板定位（与 #224 用例迁移、probe278 加固同分支 `codex/fix-ci-regressions` 修复，见 README 发布记录）。

## 复用入口与验证

Live 复用入口、keybindingRouter／shared/keybindings、菜单注册／dispatch、frontmatterPopover 与表格操作；先读对应项目领域约定。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。
