/**
 * #320 重定位逐字检索的扫描预算（`relocatedInterval` 三口径）。
 *
 * 背景：坍缩候选的保文本重定位对事务全部变更的插入文本做
 * `text.indexOf(raw)` 逐字检索，最坏 O(候选数 × 插入文本长度 × 源文长度)；
 * mainDocChangeFilter 与 remapSources 对同一事务各执行一遍。极端场景
 * （10 万行文档全选替换 × 64 活跃嵌入）可一次性阻塞主线程数百 ms 量级。
 * 三层预算把单次 filter 执行的扫描量压到数十毫秒量级以内；超限语义是
 * 「无法判定存活」而非「判定已删」——filter 侧放行（不误拦合法大编辑），
 * remap 侧与未命中同待遇冻结死键（undo 回填命中缓存可恢复）。
 *
 * 叠加口径：单次 filter 执行的最坏扫描量为 候选数 × hitScans ×
 * insertTextLength（64 × 64 × 1 MiB ≈ 4 GiB 量级）——仍有界、无死循环；
 * 需单事务同时具备 64 枚近 1 MiB 插入与满候选才可达，现实变更形态不触
 * 此角（少枚巨量插入超限零扫描、多枚微插入扫描廉价）。
 *
 * 数值依据（目标：64 候选全量扫描 ≤ 数十 ms 主线程阻塞）：
 * - `insertTextLength`：64 候选 × 1 MiB = 64 MiB 原生 indexOf 扫描
 *   （V8 快速路径吞吐量级 1-2 GB/s）≈ 30-60 ms；10 万行全选替换
 *   （数 MB 插入文本）超限零扫描。正常表格结构编辑的单枚插入文本
 *   （单行/整表区域重写）远低于 1 MiB（1 万行表整表重写约 0.3-0.5 MB）。
 * - `sourceTextLength`：典型嵌入源文 `![[目标|别名]]` 不足 100 字符，
 *   4096 已覆盖极长目标名/别名；raw 超长会把 indexOf 的最坏复杂度从
 *   近似线性推向 O(n×m) 回退路径，此上限钳住该乘数。
 * - `hitScans`：对齐 REF_EXPANSION_LIMITS.panelInstances（每面板 64 个
 *   引用实例）。计数是 indexOf 调用次数——**miss 扫描（该枚变更不含
 *   源文）同样入账**：多枚变更形态（列移动每行一枚，见
 *   planTableColumnMove）下前方各行的 miss 先各耗 1 次预算，65+ 行表格
 *   且嵌入行在文档序第 65 位之后即触限。claimed 单调推进下第 k 个坍缩
 *   候选的命中侧至多第 k 次扫描（k ≤ 64），合法满载的命中分配不触限；
 *   预算被耗尽后**确实未被检视**的变更按「无法判定存活」升为超限
 *   （'over-budget'，filter 放行 + remap 冻结），不得当作未命中（真
 *   删除）；全部枚完整检视的 miss 仍返回 null（真删除照常拦截）。
 */
export const RELOCATION_SCAN_LIMITS = {
  /** 单候选嵌入源文长度上限（字符，函数入口检查） */
  sourceTextLength: 4096,
  /** 单枚变更插入文本长度上限（字符，iterChanges 内逐枚检查） */
  insertTextLength: 1024 * 1024,
  /** 单候选命中扫描次数上限（indexOf 调用计，跨枚变更累计） */
  hitScans: 64,
} as const
