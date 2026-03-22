/**
 * Parse show-widget fenced code blocks from message text.
 */

interface ShowWidgetData {
  title?: string
  widget_code: string
}

export type WidgetSegment =
  | { type: 'text'; content: string }
  | { type: 'widget'; data: ShowWidgetData }

/** Parse ALL show-widget fences in text, returning alternating text/widget segments. */
export function parseAllShowWidgets(text: string): WidgetSegment[] {
  const segments: WidgetSegment[] = []
  const fenceRegex = /```show-widget\s*\n?([\s\S]*?)\n?\s*```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let foundAny = false

  while ((match = fenceRegex.exec(text)) !== null) {
    foundAny = true
    const before = text.slice(lastIndex, match.index).trim()
    if (before) segments.push({ type: 'text', content: before })
    try {
      const json = JSON.parse(match[1])
      if (json.widget_code) {
        segments.push({
          type: 'widget',
          data: { title: json.title || undefined, widget_code: String(json.widget_code) },
        })
      }
    } catch {
      /* skip malformed */
    }
    lastIndex = match.index + match[0].length
  }

  if (!foundAny) {
    // Fallback: handle truncated output (last fence not closed)
    const fenceStart = text.indexOf('```show-widget')
    if (fenceStart === -1) return []
    const before = text.slice(0, fenceStart).trim()
    if (before) segments.push({ type: 'text', content: before })
    const fenceBody = text.slice(fenceStart + '```show-widget'.length).trim()
    const widget = extractTruncatedWidget(fenceBody)
    if (widget) segments.push({ type: 'widget', data: widget })
    return segments
  }

  const remaining = text.slice(lastIndex).trim()
  if (remaining) {
    const truncIdx = remaining.indexOf('```show-widget')
    if (truncIdx !== -1) {
      const beforeTrunc = remaining.slice(0, truncIdx).trim()
      if (beforeTrunc) segments.push({ type: 'text', content: beforeTrunc })
      const truncBody = remaining.slice(truncIdx + '```show-widget'.length).trim()
      const widget = extractTruncatedWidget(truncBody)
      if (widget) segments.push({ type: 'widget', data: widget })
    } else {
      segments.push({ type: 'text', content: remaining })
    }
  }

  return segments
}

/** Compute stable React key for a partial (still-streaming) widget. */
export function computePartialWidgetKey(content: string): string {
  const lastFenceStart = content.lastIndexOf('```show-widget')
  const beforePart = content.slice(0, lastFenceStart).trim()
  const hasCompletedFences = beforePart.length > 0 && /```show-widget/.test(beforePart)
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : []
  return `w-${hasCompletedFences ? completedSegments.length : beforePart ? 1 : 0}`
}

/** Extract widget_code from truncated/incomplete JSON (no closing fence). */
function extractTruncatedWidget(fenceBody: string): ShowWidgetData | null {
  try {
    const json = JSON.parse(fenceBody)
    if (json.widget_code)
      return { title: json.title || undefined, widget_code: String(json.widget_code) }
  } catch {
    /* expected — JSON is truncated */
  }

  const keyIdx = fenceBody.indexOf('"widget_code"')
  if (keyIdx === -1) return null
  const colonIdx = fenceBody.indexOf(':', keyIdx + 13)
  if (colonIdx === -1) return null
  const quoteIdx = fenceBody.indexOf('"', colonIdx + 1)
  if (quoteIdx === -1) return null

  let raw = fenceBody.slice(quoteIdx + 1)
  raw = raw.replace(/"\s*\}\s*$/, '')
  if (raw.endsWith('\\')) raw = raw.slice(0, -1)
  try {
    const widgetCode = raw
      .replace(/\\\\/g, '\x00BACKSLASH\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\x00BACKSLASH\x00/g, '\\')
    if (widgetCode.length < 10) return null

    let title: string | undefined
    const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/)
    if (titleMatch) title = titleMatch[1]
    return { title, widget_code: widgetCode }
  } catch {
    return null
  }
}
