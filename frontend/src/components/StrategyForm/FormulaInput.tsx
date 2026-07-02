import { useEffect, useRef, useState } from 'react'
import { applyCompletion, ensureLoaded, getSuggestions, type AutocompleteItem } from '../../utils/p123Autocomplete'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  isRuleDisabled?: boolean
}

export default function FormulaInput({ value, onChange, placeholder, disabled, isRuleDisabled }: Props) {
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Warm the dictionary as soon as a formula input mounts.
  useEffect(() => { ensureLoaded() }, [])

  function updateSuggestions(text: string, cursor: number) {
    if (disabled) return
    ensureLoaded().then(() => {
      // Recompute against the input's live state (a fetch may have been in flight).
      const el = inputRef.current
      const liveText = el ? el.value : text
      const liveCursor = el ? el.selectionStart ?? cursor : cursor
      const items = getSuggestions(liveText, liveCursor)
      setSuggestions(items)
      setSelectedIdx(0)
      setOpen(items.length > 0)
    })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return
    const { value: text, selectionStart } = e.target
    onChange(text)
    updateSuggestions(text, selectionStart ?? text.length)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled || !open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (suggestions[selectedIdx]) {
        e.preventDefault()
        accept(suggestions[selectedIdx])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function accept(item: AutocompleteItem) {
    if (disabled) return
    const el = inputRef.current!
    const cursor = el.selectionStart ?? value.length
    const { text, cursor: newCursor } = applyCompletion(value, cursor, item)
    onChange(text)
    setOpen(false)
    setTimeout(() => {
      el.setSelectionRange(newCursor, newCursor)
      el.focus()
    }, 0)
  }

  // Close on outside click
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!inputRef.current?.contains(e.target as Node) &&
          !listRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const CATEGORY_COLORS: Record<string, string> = {
    Ratios:       'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    Financials:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    Fundamentals: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    Estimates:    'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    Technical:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    Advanced:     'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
    Strategy:     'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    Universe:     'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    Benchmark:    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    Industry:     'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    Misc:         'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    Operator:     'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (!disabled) updateSuggestions(value, inputRef.current?.selectionStart ?? value.length) }}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        className={`input-base font-mono text-xs disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-900 ${
          isRuleDisabled ? 'opacity-40 line-through' : ''
        }`}
      />
      {open && suggestions.length > 0 && !disabled && (
        <ul
          ref={listRef}
          className="absolute left-0 z-50 mt-1 w-full overflow-auto rounded-lg border bg-white
                     shadow-xl dark:bg-slate-900"
          style={{ maxHeight: 280 }}
        >
          {suggestions.map((item, i) => (
            <li
              key={item.label}
              onMouseDown={(e) => { e.preventDefault(); accept(item) }}
              className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm transition-colors
                ${i === selectedIdx
                  ? 'bg-blue-50 dark:bg-blue-950/60'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
            >
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[item.category] ?? 'bg-slate-100 text-slate-600'}`}>
                {item.category}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {item.sig ?? item.label}
                </div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {item.desc}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
