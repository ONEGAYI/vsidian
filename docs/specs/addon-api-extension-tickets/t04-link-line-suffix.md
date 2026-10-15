# [T04] 实施：普通 Markdown 链接尾部行号解析与定位

## 状态与前置

父票：[规格/总览 #531](https://github.com/ONEGAYI/vsidian/issues/531)。本票切片编号：T04。

Blocked by: [#543](https://github.com/ONEGAYI/vsidian/issues/543)

主规格：[addon-navigation.md](https://github.com/ONEGAYI/vsidian/blob/main/docs/specs/addon-navigation.md)。实施前阅读全部“契约/边界/验证”节；本票只交付下列故事，不把规格定稿当作功能完成。

用户故事：N-U08–N-U11，并复验 N-U06/N-U07。

## 目标与范围

- 在本地普通链接路径段剥离尾部正整数行号，早于 Windows ADS 怪异名拦截，保持外链协议和盘符边界。
- 非 md 复用 refText 行号判定与原生 reveal；md 复用 T03 的内部宿主定位执行体。
- 普通链接含冒号行号又带 fragment 直接解析失败；浮窗报错，点击使用 i18n toast，不讨论定位优先级。
- 同步 anchor-navigation、features、README 双语与人工验证清单。

## 验收标准

- [ ] TDD 形态矩阵覆盖 file.md:103、file.ts:103、空格宽松路径、编码、query/fragment、盘符/外链及 a:b.md。
- [ ] :0、负数、非数字和混合定位不产出合法行定位；保留既有非行号文件名分类，不按文件存在性切换语义。
- [ ] 浏览器/集成点击证明 md 在 Vsidian 落行、文本在原生编辑器 reveal；覆盖 CRLF/阅读态/折叠区。
- [ ] 语法非法不执行打开；合法目标行号越界按规格反馈，不静默钳到末行。
- [ ] 浮窗错误与点击 toast 有实际可见断言，文案走双语 i18n。
- [ ] 未带行号的普通链接、外链与双链旧用例通过；功能文档和人工清单同步。

## 不包含

双链不增加 :行号；不引入普通链接 #L103/#line=、引用式链接支持或绝对路径越界放宽。

## 验证与维护纪律

- 可执行行为遵循 TDD，优先使用生产控制器/公开 SDK/真宿主的既有测试接缝。
- 呈现变更按 ui-patterns/style-contract，至少一条断言落绘制层；涉及输入/光标必跑 browser。
- API 变更同步 addonApiCatalog、生成参考、编译期消费者和覆盖映射；若声明/语义冻结命中，兼容基线显式重锚定须同 PR 独立说明。候选台账不写虚构发行日期。
- 长命令首次即保存日志、退出码或工具报告，复核读已有报告。文档/人工验收与自动化结果分开，不关闭父票代替整体验收。
