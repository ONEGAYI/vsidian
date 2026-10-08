# 附加组件页面 CSP 对动态代码（new Function）的支持评估（#405）

状态：2026-10-08 现状摸底与决策建议（research 交付）。驱动方 [ONEGAYI/vsidian-easy-typing](https://github.com/ONEGAYI/vsidian-easy-typing) 自定义规则的**函数替换体**（JS `new Function` 动态构造替换逻辑——Obsidian 插件生态形态，Obsidian 渲染进程无 CSP 约束）。

## 现状（以事实为准）

两个承载附加组件页面的 webview，`script-src` 都**不含 `unsafe-eval`**：

| 页面 | CSP 构造点 | script-src | eval 面现状 |
| --- | --- | --- | --- |
| 编辑器 webview（附加组件编辑器页） | `src/host/editorCsp.ts` `buildEditorCsp` | `${cspSource} 'nonce-…' 'wasm-unsafe-eval'` | `new Function` / `eval` 被 CSP 引擎拦截；`'wasm-unsafe-eval'`（#239）仅放行 WebAssembly 编译实例化，明确不放行 JS eval |
| 设置页 webview（附加组件设置页） | `src/host/settingsPage.ts` | `${cspSource} 'nonce-…'` | 同上，连 wasm 放行都没有 |

钉住测试：`test/unit/editorCsp.test.ts`（"不放行 https:/unsafe-inline/**unsafe-eval**"精确等值断言，收紧即红）；真实宿主生效由集成测试验证（#37 教训）。附加组件页面与 Vsidian 自身页面共用同一 CSP——**附加组件自身无法改 CSP**（meta 由宿主 HTML 生成）。

## 决策建议：预注册变换函数表（不放行 unsafe-eval）

三选一的评估：

**方案 A：放行 `unsafe-eval`** —— 不建议。CSP 的 eval 授权是**页面粒度**（无按脚本粒度），一旦放行，页内所有已装载脚本（Vsidian 自身 + 全部附加组件 IIFE）的 eval 面全开：防线从「CSP 引擎级禁止」退到「代码审查级自觉」，一个组件的规则文件缺陷（如规则 JSON 被同步工具注入恶意函数体）即获得任意代码执行。且打破 editorCsp.ts 文件头与测试钉住的既有验收红线，收益只有一个（函数体存 JSON 字符串）。

**方案 B：预注册变换函数表（推荐）** —— 规则 JSON 只存**声明性数据与函数引用**（如 `{"replace": {"kind": "function", "ref": "dashTransform"}}`），替换函数本体是组件代码里的真函数（组件经构建桥打包，函数天然存在），组件启动时注册到自己的变换表。表达力不损（图灵完备函数仍在），只改变函数的物理位置：从「规则文件里的字符串」到「组件代码」。与 ADR-0012「载荷与结果是可传输数据，函数不过桥」原则同构。上游移植时：easy-typing 的内置函数替换体改写为组件内置函数 + 规则引用；用户自定义的"函数体"场景由「自定义规则组件化」（用户改自己 fork 的规则组件）承接。

**方案 C：受限 DSL** —— 备选（未来若出现「无构建轻量规则包」需求再评估）：字符串模板 + 受控算子（捕获组引用、条件、大小写变换等），表达力介于模板与任意函数之间，需要独立的解析器与安全边界设计，当前需求下不必要。

## 结论落档

- 附加组件页面 CSP **不支持且不计划支持** `new Function` / `eval` 动态代码（安全权衡：页面粒度授权全开 eval 面 > 函数替换体的便利收益）。
- 函数替换体的等价能力经**预注册变换函数表**实现（组件代码内函数 + 规则文件引用）——归入未来设置/规则类 API 的形状设计（若 easy-typing 移植需要，可随 #404 数据目录票或单独票细化注册面）。
- 边界写入 [developer-guide](../addons/developer-guide.md)（组件作者可见处）。

## 关联

- 票面：[#405](https://github.com/ONEGAYI/vsidian/issues/405)
- CSP 事实源：`src/host/editorCsp.ts`（文件头红线说明）、`src/host/settingsPage.ts`、`test/unit/editorCsp.test.ts`
- 安全先例：#37（CSP 拦截实证）、#239（wasm-unsafe-eval 最小放行先例——「按需为能力开最小口子」的对拍基准）
