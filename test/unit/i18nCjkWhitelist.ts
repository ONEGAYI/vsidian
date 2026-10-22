// i18n 防回潮扫描白名单（#93 生成；由 i18nNoHardcodedCjk.test.ts 契约钉住）。
// 文件（仓库相对路径）→ 允许在案的 CJK 字面量（集合语义）。
// 条目失效时契约测试报错，须同步清除。
// 再生：VSIDIAN_I18N_DUMP_WHITELIST=1 npx vitest run test/unit/i18nNoHardcodedCjk.test.ts
// 在案说明（防回潮「清零」终态=仅剩永久合法类别，见规格「防回潮纪律」）：
// 各条目行内注明类别与依据——语言自名（#96）、探针徽标/探针载荷（#5/#371）、
// 文档性质登记备注（#463）均非用户可见界面文案，属合法永久居所（原
// tableEditing 3 条 helper 间接传递已由 #101 扫描器「console 转发 helper」
// 语义放行，不再需要白名单）。
export const CJK_LITERALS_WHITELIST: Readonly<Record<string, readonly string[]>> = {
  // #96 语言设置项残留：语言自名不自译（规格「语言设置项」）——静态直显的
  // 「简体中文」是刻意的字面量，不随界面语言翻译；title/description 字面量
  // 已随 #95 键化（setting.language.*）消灭，不入白名单
  'src/shared/settings.ts': [
    "简体中文",
  ],
  // T05（#625）PDF 文本归一对照表（pdfTextNormalize.ts 的 PDF_RADICAL_FIX
  // 值域）：CJK 部首补充区 → 规范汉字的编码学数据映射（V01 §7——Chromium
  // ToUnicode 部首兼容码位的归一补丁），是标题匹配算法的数据输入而非用户
  // 可见界面文案，运行时不经任何 UI 面呈现，永久在案
  'src/shared/pdfTextNormalize.ts': [
    "乙",
    "乚",
    "乛",
    "人",
    "兀",
    "冂",
    "冫",
    "几",
    "刀",
    "力",
    "卜",
    "卤",
    "厂",
    "又",
    "小",
    "尢",
    "山",
    "巛",
    "工",
    "巳",
    "巾",
    "干",
    "幺",
    "广",
    "廾",
    "弋",
    "弓",
    "彐",
    "彡",
    "月",
    "氵",
    "火",
    "爪",
    "父",
    "爻",
    "爿",
    "犬",
    "玉",
    "王",
    "示",
    "礻",
    "竹",
    "糸",
    "网",
    "羊",
    "聿",
    "肉",
    "臣",
    "至",
    "臼",
    "舌",
    "艹",
    "虎",
    "虫",
    "血",
    "行",
    "见",
    "角",
    "言",
    "讠",
    "贝",
    "足",
    "车",
    "辶",
    "邑",
    "镸",
    "长",
    "门",
    "阜",
    "阝",
    "雨",
    "青",
    "韦",
    "页",
    "风",
    "飞",
    "食",
    "首",
    "香",
    "马",
    "骨",
    "鬼",
    "鱼",
    "鸟",
    "麦",
    "黄",
    "黹",
    "黾",
    "齐",
    "齿",
    "龙",
    "龟",
  ],
  // 探针徽标：作为文档文本经 view.dispatch 插入（#5 探针约定），非 console
  // 开发面文案，转发识别语义覆盖不到，永久在案
  'src/webview/perfProbe.ts': [
    "探",
  ],
  // #371 表格可读度量探针载荷（tableMetrics.ts PROBE_TEXT）：测量「约三个
  // 汉字内容宽」的隐藏 span 文本——测量输入而非用户可见文案（探针
  // visibility hidden、无命中面），非界面文字不自译，永久在案
  'src/webview/tableMetrics.ts': [
    "汉汉汉",
  ],
  // #463 官方组件登记表 label：维护备注（用途/发布仓线索），仅文档性质、
  // 运行时零消费（UI 显示名来自扩展 displayName），同注释等价不走 t()，
  // 见 OfficialAddonEntry 接口注释与 #463 探索论证
  'src/shared/officialAddons.ts': [
    "官方输入增强组件（上游 Obsidian Easy-Typing 移植）",
  ],
}
