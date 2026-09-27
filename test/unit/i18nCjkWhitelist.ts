// i18n 防回潮扫描白名单（#93 生成；由 i18nNoHardcodedCjk.test.ts 契约钉住）。
// 文件（仓库相对路径）→ 允许在案的 CJK 字面量（集合语义）。
// 条目失效时契约测试报错，须同步清除。
// 再生：VSIDIAN_I18N_DUMP_WHITELIST=1 npx vitest run test/unit/i18nNoHardcodedCjk.test.ts
// 在案说明（防回潮「清零」终态=仅剩永久合法类别，见规格「防回潮纪律」），
// #101 扫描器升级后仅剩两类：
// settings.ts「简体中文」为语言自名直显（#96，规格「语言设置项」，不自译）；
// perfProbe「探」为探针徽标标识——数据流进 view.dispatch 文档编辑负载而非
// console 文案，属合法永久居所（原 tableEditing 3 条 helper 间接传递已由
// 扫描器「console 转发 helper」语义放行，不再需要白名单）。
export const CJK_LITERALS_WHITELIST: Readonly<Record<string, readonly string[]>> = {
  // #96 语言设置项残留：语言自名不自译（规格「语言设置项」）——静态直显的
  // 「简体中文」是刻意的字面量，不随界面语言翻译；title/description 字面量
  // 已随 #95 键化（setting.language.*）消灭，不入白名单
  'src/shared/settings.ts': [
    "简体中文",
  ],
  // 探针徽标：作为文档文本经 view.dispatch 插入（#5 探针约定），非 console
  // 开发面文案，转发识别语义覆盖不到，永久在案
  'src/webview/perfProbe.ts': [
    "探",
  ],
}
