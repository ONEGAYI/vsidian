# research: 锁定 PDF 渲染器的下界、worker 与包体可行性

本地编号：P3-02

GitHub：[#334](https://github.com/ONEGAYI/vsidian/issues/334)

父票：[#228](https://github.com/ONEGAYI/vsidian/issues/228)

Blocked by: 无本地前置票

状态：2026-10-04 用户确认方案及 12 票拆分，已发布；未实施。无本地前置，已标 ready-for-agent。P3-02／P3-03 的依赖解除要求可行路线通过，不能仅凭研究票关闭。

规格：[三期正式规格](../hover-preview-embed.md)；用户故事 P3-U2、U3、U7、U9。

## 问题与交付

真实宿主最小 PDF 绘制探针、锁定候选及通过／阻塞结论。

## 实施范围

- 优先验证 PDF.js，候选不能因存在 legacy 目录就宣称适配 VSCode 1.82.3。锁定核心、worker、CMap／字体及必要 polyfill 的同一精确版本，并核对许可与安全配置。
- 在 VSCode 1.82.3 Windows 真实 webview 用本地打包的独立 worker 绘制样页。验证 blob worker 单文件装配、CSP、资源通道、Node 18 宿主不执行 PDF 渲染。
- 用中文／内嵌字体、非内嵌字体、扫描页、损坏与加密样本验证可用边界；证明提取文本可用性，为 P3-07 文本层预留已经验证的 API。
- 测源文件装载、worker／Blob 生命周期、按页取消与 canvas 像素费用；评估 Remote SSH 目标加载，并实际检查 VSIX 中资源和 scripts/release.mjs 现有体积红线。

## 验收标准

- [ ] 最小样页在下界真实宿主可见，证据落 canvas 实际绘制；核心与 worker 的版本完全一致，不以 headless Chromium 成功替代宿主。
- [ ] 明确需要的最小 worker-src 与本地资源权限；不引入外网脚本、JS unsafe-eval、外部 PDF 脚本执行或假 worker 阻塞主线程作为默认兜底。
- [ ] PDF 源文件／页像素／总 canvas／并发装载／worker 初值有实测依据，最后消费者释放后 worker、Blob、渲染任务与订阅计数归零。
- [ ] VSIX 包含必要 worker、字体／CMap，现有总包及单文件硬阈值内通过；不能擅自提高阈值或兼容下界。
- [ ] 结论明确为可用路线或阻塞；任一关键项未验证或不满足契约，P3-05 保持阻塞。Remote SSH 未执行项单独记录，不冒充通过。

## 复用入口与验证

src/host/editorCsp.ts、esbuild.mjs、test/integration/testHost.mjs、scripts/release.mjs；上游 PDF.js 核心／worker 与官方 Webview Worker 指南。

## 明确排除

整套 PDF UI、全文搜索、OCR、区域引用／裁剪和标注；本票是技术验证例外，不以调查结束自动放行。

## 共同完成条件

- 对可执行行为先补能暴露目标问题的契约测试，再实现；采用生产 browser／真实宿主等既有高层入口，不只检查消息调用次数或 DOM 存在。
- 呈现变更先加载项目 style-contract、固定旧契约，提供实际绘制和 CSS 契约证据。所有用户文字经 locales／t()，设置只进 Vsidian 自有页面。
- 每个新增操作登记可绑定入口、默认值和有效状态；只读内容不接管写操作，焦点和 Esc 沿用已有优先级。
- 来源验证、请求代次、目标版本、挂载释放及已存在预算都必须保持；自动化通过不等同用户验收。首次长命令即落盘日志和退出码，复核读取报告。
- 每票按一个新 agent 上下文安排；发现需要扩大接口／产品范围时报告增量并重切片，不将不完整行为标为完成。本票不授权推送、PR、合并或版本发布。

完整依赖与发布次序见[票据索引](README.md)。
