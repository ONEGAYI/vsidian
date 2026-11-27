import { Text } from '@codemirror/state'
import { Parser } from 'htmlparser2'
import { topLevelHtmlBlockSpansOfTree } from '../shared/htmlBlock'
import { inlineHtmlFragmentsOfTree } from '../shared/htmlInline'
import { parseSrcsetCandidates, scanCssUrls } from '../shared/htmlResource'
import { frontmatterRange, markdownTreeParser } from '../shared/markdownDoc'
import { classifyImageTarget, type LinkContext } from './linkTarget'
import { extractVaultEdges } from './vaultLinkExtract'
import { imageFsKey } from './imageVersioning'

/** 从宿主权威 Markdown 取图片引用。仅解析路径与标记，不读取资源或执行 HTML。 */
export function previewSourceImagePaths(text: string, sourcePath: string, context: LinkContext): ReadonlySet<string> {
  const paths = new Set<string>()
  const add = (raw: string | undefined): void => {
    if (raw === undefined) return
    const target = classifyImageTarget(raw, context)
    if (target.kind === 'workspace') paths.add(imageFsKey(target.fsPath, context.isWindowsHost))
  }
  for (const edge of extractVaultEdges(sourcePath, text, context, () => null)) {
    if (edge.kind === 'image' || edge.kind === 'embed' || edge.kind === 'refdef') add(edge.target)
  }
  if (!text.includes('<')) return paths

  const tree = markdownTreeParser.parse(text)
  const frontmatterEnd = frontmatterRange(text)?.end ?? 0
  const fragments = [...topLevelHtmlBlockSpansOfTree(tree), ...inlineHtmlFragmentsOfTree(tree, Text.of(text.split('\n')))]
  for (const { from, to } of fragments) {
    if (from < frontmatterEnd) continue
    let style = false
    const addCss = (css: string) => { for (const token of scanCssUrls(css)) add(token.url) }
    const parser = new Parser({
      onopentag(tag, attrs) {
        if (tag === 'img' || tag === 'source') {
          add(attrs.src)
          for (const candidate of parseSrcsetCandidates(attrs.srcset ?? '')) add(candidate.url)
        } else if (tag === 'video') add(attrs.poster)
        else if (tag === 'image') add(attrs.href ?? attrs['xlink:href'])
        if (attrs.style !== undefined) addCss(attrs.style)
        style = tag === 'style'
      },
      ontext(value) { if (style) addCss(value) },
      onclosetag(tag) { if (tag === 'style') style = false },
    })
    parser.end(text.slice(from, to))
  }
  return paths
}
