/** #223 首载采样：同一父文档内四张 Live 卡全部到达终态后再检查明细。 */
export function liveEmbedReady(view: {
  viewMode?: string
  readingEmbed?: readonly { host?: string; state: string }[]
}): boolean {
  const live = (view.readingEmbed ?? []).filter((card) => card.host === 'live')
  return view.viewMode === 'live' && live.length === 4 &&
    live.filter((card) => card.state === 'content').length === 3 &&
    live.filter((card) => card.state === 'error').length === 1
}

export function readingEmbedCard<T extends { inner: string; host?: string; rootHost?: string }>(
  cards: readonly T[] | undefined, inner: string,
): T | undefined {
  return cards?.find((card) => card.rootHost === 'reading' && card.inner === inner)
}
