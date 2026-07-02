// Autocomplete over the extraction-verified P123 formula dictionary (4,800+
// factors/functions parsed from the official Factor Reference). Served by the
// backend at /api/autocomplete and fetched once per session.

export interface AutocompleteItem {
  label: string
  category: string
  desc: string
  sig?: string
  kind: 'factor' | 'function' | 'operator'
}

let ITEMS: AutocompleteItem[] = []
let loadPromise: Promise<void> | null = null

export function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = fetch('/api/autocomplete')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) ITEMS = data
      })
      .catch(() => {
        loadPromise = null // allow retry on next keystroke
      })
  }
  return loadPromise
}

function currentToken(text: string, cursorPos: number): string {
  const before = text.slice(0, cursorPos)
  const match = before.match(/[\w%.#@$]+$/)
  return match ? match[0] : ''
}

export function getSuggestions(text: string, cursorPos: number): AutocompleteItem[] {
  const token = currentToken(text, cursorPos)
  if (token.length < 2) return []

  const lower = token.toLowerCase()
  const prefix: AutocompleteItem[] = []
  const substring: AutocompleteItem[] = []

  for (const item of ITEMS) {
    const l = item.label.toLowerCase()
    if (l.startsWith(lower)) {
      prefix.push(item)
    } else if (l.includes(lower)) {
      substring.push(item)
    }
    if (prefix.length >= 12) break
  }

  // Shorter labels first within each tier — exact/near matches float to the top.
  prefix.sort((a, b) => a.label.length - b.label.length)
  substring.sort((a, b) => a.label.length - b.label.length)
  return [...prefix, ...substring].slice(0, 12)
}

export function applyCompletion(
  text: string,
  cursorPos: number,
  item: AutocompleteItem
): { text: string; cursor: number } {
  const before = text.slice(0, cursorPos)
  const after = text.slice(cursorPos)
  const match = before.match(/[\w%.#@$]+$/)
  const tokenLen = match ? match[0].length : 0
  // Functions insert an opening paren (and closing, when nothing follows) so
  // the caret lands ready for arguments.
  let completion = item.label
  let cursorOffset = completion.length
  if (item.kind === 'function' && !after.trimStart().startsWith('(')) {
    completion = `${item.label}()`
    cursorOffset = completion.length - 1
  }
  const newBefore = before.slice(0, before.length - tokenLen) + completion
  return { text: newBefore + after, cursor: before.length - tokenLen + cursorOffset }
}
