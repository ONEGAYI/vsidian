/** #223 首载采样：同一父文档内四张 Live 卡全部到达终态后再检查明细。
 *  P2-09 起孙卡随直接父进 live 挂载——host=live 的卡不再只含根级，计数
 *  按根级口径（parentInstanceId 为空）过滤，孙卡多寡不影响本谓词。 */
export function liveEmbedReady(view: {
  viewMode?: string
  readingEmbed?: readonly { host?: string; state: string; parentInstanceId?: string | null }[]
}): boolean {
  const live = (view.readingEmbed ?? []).filter((card) => card.host === 'live' && !card.parentInstanceId)
  return view.viewMode === 'live' && live.length === 4 &&
    live.filter((card) => card.state === 'content').length === 3 &&
    live.filter((card) => card.state === 'error').length === 1
}

export function readingEmbedCard<T extends { inner: string; host?: string; rootHost?: string }>(
  cards: readonly T[] | undefined, inner: string,
): T | undefined {
  return cards?.find((card) => card.rootHost === 'reading' && card.inner === inner)
}

/** #246：混排递归链装载后才采样后续断言；调用方保持在场父卡动态数量。 */
export function mixedEmbedReady(view: {
  viewMode?: string
  readingEmbed?: readonly { inner: string; host?: string; rootHost?: string; state: string; textLen?: number }[]
} | undefined, targets: { parent: string; child: string; descendant: string }): boolean {
  const cards = (view?.readingEmbed ?? []).filter((card) => card.rootHost === 'reading')
  const parents = cards.filter((card) => card.inner === targets.parent)
  return view?.viewMode === 'reading' && parents.length >= 1 &&
    parents.every((card) => card.state === 'content' && (card.textLen ?? 0) > 0) &&
    cards.some((card) => card.inner === targets.child && card.state === 'content') &&
    readingEmbedCard(cards, targets.descendant)?.state === 'content'
}

/** #222：宿主保存成功之后还需等待设置回显与 Reading 卡片的实际限高。 */
export function readingEmbedHeightReady(view: {
  viewMode?: string
  settings?: Readonly<Record<string, unknown>>
  readingEmbed?: readonly { rootHost?: string; state: string; maxHeightPx?: number }[]
}, height: number): boolean {
  const card = (view.readingEmbed ?? []).find((item) => item.rootHost === 'reading' && item.state === 'content')
  return view.viewMode === 'reading' && view.settings?.['embed.maxHeight'] === height && card?.maxHeightPx === height
}
