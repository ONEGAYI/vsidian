// 样式参考条目英文平行覆盖（#178）：设置页「样式参考」条目文档字段的
// 英文版单一事实源——中文清单（./styleContract）保持权威基准不动，本模块
// 按条目 id 索引、字段级覆盖；取词规则为**英文优先、条目或字段缺失回退
// 中文基准**，翻译可渐进合入（规格 docs/specs/style-reference-i18n.md）。
//
// 字段分级（规格钉死）：
// - 双语（可覆盖）：purpose / states / dom / deprecated / removed /
//   obsidian.counterpart——设置页渲染的说明性文案（dom 当前仅离线 HTML
//   指南渲染，按同一分级提供覆盖）；
// - 不译（覆盖对象中不得出现）：target / example / aliasTargets /
//   introduced / verification / id / views——代码标识符、CSS 代码、工单号、
//   测试定位，语言无关或可检索性优先。
//
// 消费方与包体纪律：
// - `scripts/genStyleGuide.mjs` 加载 STYLE_CONTRACT_EN_OVERRIDES 内联进
//   设置页渲染数据 src/webview/styleGuideData.ts（一致性由
//   test/unit/styleContractEn.test.ts 钉住）；契约 JSON 与离线 HTML 固定
//   取中文，不消费本模块。
// - 设置页（styleReferenceSettings.ts）按 UI 语言调用参数化取词函数
//   applyStyleContractEntryOverride，覆盖表经生成物内联数据传入——本文件
//   的覆盖数据不进任何 bundle（webview 侧仅 type 依赖，编译后擦除）。
// - CJK 防回潮扫描：本文件为纯英文数据（注释不计字面量），不需豁免。
import type { StyleContractEntry } from './styleContract'

/** 条目英文覆盖形态（字段级）：仅双语字段可覆盖，键全部可选；obsidian
 *  覆盖形态固定为 { counterpart }（support 等级是枚举、语言无关） */
export interface StyleContractEntryOverride {
  purpose?: string
  states?: string
  dom?: string
  deprecated?: string
  removed?: string
  obsidian?: { counterpart: string }
}

/** 英文覆盖表：条目 id → 字段级覆盖（未覆盖条目/字段渲染时回退中文基准） */
export const STYLE_CONTRACT_EN_OVERRIDES: Readonly<Record<string, StyleContractEntryOverride>> = {
  // 试点：「容器与视图」类目 2 条（#178；术语对齐 locales/en.ts 与
  // README.en.md——live preview / reading view / mounted on demand）
  'container-live': {
    purpose: 'Live preview view container; holds the CodeMirror 6 editor.',
    dom: 'Direct child of #app; hidden with display:none in reading view but stays in the DOM, so styles still match (same probe convention as LineGutterProbe).',
    obsidian: {
      counterpart:
        '.markdown-source-view (editing-area container), .mod-cm6 (CM6 mode marker), .cm-s-obsidian (CM theme container)',
    },
  },
  'container-reading': {
    purpose: 'Reading view container; holds block-level structures that are mounted on demand.',
    dom: 'Direct child of #app; blocks are real semantic tags rendered by markdown-it, so tag selectors (p/h1/strong etc.) match naturally as descendants of the container.',
    obsidian: { counterpart: '.markdown-preview-view (reading view container)' },
  },
}

/**
 * 按目标语言应用条目英文覆盖（参数化取词，覆盖表由调用方传入）：
 * - lang 非 en 开头（或条目无覆盖）→ 原样返回同一引用（中文基准零开销）；
 * - 有覆盖 → 字段级 merge 生成新条目：覆盖字段用英文，其余字段（含不译
 *   字段与 obsidian.support）回退中文基准；不原地改写入参。
 */
export function applyStyleContractEntryOverride(
  entry: StyleContractEntry,
  lang: string,
  overrides: Readonly<Record<string, StyleContractEntryOverride>>,
): StyleContractEntry {
  if (!lang.startsWith('en')) return entry
  const override = overrides[entry.id]
  if (!override) return entry
  return {
    ...entry,
    ...(override.purpose !== undefined ? { purpose: override.purpose } : {}),
    ...(override.states !== undefined ? { states: override.states } : {}),
    ...(override.dom !== undefined ? { dom: override.dom } : {}),
    ...(override.deprecated !== undefined ? { deprecated: override.deprecated } : {}),
    ...(override.removed !== undefined ? { removed: override.removed } : {}),
    ...(override.obsidian !== undefined
      ? { obsidian: { ...entry.obsidian, counterpart: override.obsidian.counterpart } }
      : {}),
  }
}

/** 便捷封装：查本模块覆盖表（生成器加载校验与测试用；设置页消费生成物
 *  内联覆盖表时走参数化 applyStyleContractEntryOverride，避免本模块数据
 *  与生成物数据重复进 bundle） */
export function localizedStyleContractEntry(entry: StyleContractEntry, lang: string): StyleContractEntry {
  return applyStyleContractEntryOverride(entry, lang, STYLE_CONTRACT_EN_OVERRIDES)
}
