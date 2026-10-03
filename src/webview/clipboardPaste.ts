/** 同一次读取的多格式剪贴板快照；纯文本缺失与空串有不同语义。 */
export interface ClipboardSnapshot {
  text?: string
  html?: string
  images: File[]
}

/** HTML里的图片属于格式数据，不伪装为独立图片文件或触发资产导入。 */
export function clipboardHasImages(snapshot: ClipboardSnapshot): boolean {
  if (snapshot.images.length) return true
  if (!snapshot.html) return false
  const template = document.createElement('template')
  template.innerHTML = snapshot.html
  return !!template.content.querySelector('img')
}

interface ClipboardReader {
  read(): Promise<readonly { types: readonly string[]; getType(type: string): Promise<Blob> }[]>
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

export async function readClipboardSnapshot(clipboard: ClipboardReader): Promise<ClipboardSnapshot> {
  const snapshot: ClipboardSnapshot = { images: [] }
  for (const item of await clipboard.read()) {
    for (const type of item.types) {
      if (type === 'text/plain' && snapshot.text === undefined) snapshot.text = await blobText(await item.getType(type))
      else if (type === 'text/html' && snapshot.html === undefined) snapshot.html = await blobText(await item.getType(type))
      else if (type.startsWith('image/')) snapshot.images.push(new File([await item.getType(type)], '', { type }))
    }
  }
  return snapshot
}

/** template 内容保持脱离活动文档；不加载图片/样式，也不执行脚本。 */
export function clipboardPlainText(snapshot: ClipboardSnapshot): string {
  if (snapshot.text !== undefined) return snapshot.text
  if (!snapshot.html) return ''
  const template = document.createElement('template')
  template.innerHTML = snapshot.html
  template.content.querySelectorAll('script,style,iframe,object,embed').forEach((el) => el.remove())
  template.content.querySelectorAll('br').forEach((el) => el.replaceWith('\n'))
  template.content.querySelectorAll('img').forEach((el) => el.replaceWith(el.getAttribute('alt') ?? ''))
  template.content.querySelectorAll('tr').forEach((row) => {
    const cells = Array.from(row.children).filter((cell) => cell.matches('th,td'))
    for (const cell of cells.slice(0, -1)) cell.append('\t')
  })
  template.content.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr').forEach((el) => el.append('\n'))
  return (template.content.textContent ?? '').replace(/\n+$/, '').replace(/\r\n?/g, '\n')
}

/** 交给现有 CM6/table/image paste 处理器，保持上下文规则和多光标粘贴。 */
export function dispatchClipboardPaste(target: HTMLElement, snapshot: ClipboardSnapshot, plain: boolean): boolean {
  const text = plain ? clipboardPlainText(snapshot) : snapshot.text
  const images = plain ? [] : snapshot.images
  const values: Record<string, string> = {}
  if (text !== undefined) values['text/plain'] = text
  if (!plain && snapshot.html !== undefined) values['text/html'] = snapshot.html
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    getData: (type: string) => values[type] ?? '',
    types: [...Object.keys(values), ...(images.length ? ['Files'] : [])],
    files: images,
    items: images.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
  } })
  target.dispatchEvent(event)
  return event.defaultPrevented
}
