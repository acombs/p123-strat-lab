import { Bookmark, Download, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SavedStrategy, StrategyConfig } from '../types'

interface Props {
  currentConfig: StrategyConfig
  onLoad: (s: SavedStrategy) => void
  onClose: () => void
}

const STORAGE_KEY = 'p123_saved_strategies'

function loadSaved(): SavedStrategy[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
  catch { return [] }
}

function saveSaved(strategies: SavedStrategy[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies))
}

export default function SavedStrategies({ currentConfig, onLoad, onClose }: Props) {
  const [strategies, setStrategies] = useState<SavedStrategy[]>(loadSaved)
  const [name, setName] = useState('')

  useEffect(() => {
    saveSaved(strategies)
  }, [strategies])

  function save() {
    if (!name.trim()) return
    const s: SavedStrategy = {
      id: crypto.randomUUID(),
      name: name.trim(),
      config: { ...currentConfig },
      createdAt: new Date().toISOString(),
    }
    setStrategies((prev) => [s, ...prev])
    setName('')
  }

  function remove(id: string) {
    setStrategies((prev) => prev.filter((s) => s.id !== id))
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(strategies, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'p123-strategies.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (Array.isArray(data)) {
          setStrategies((prev) => {
            const existing = new Set(prev.map((s) => s.id))
            const fresh = data.filter((s) => !existing.has(s.id))
            return [...fresh, ...prev]
          })
        }
      } catch {}
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  // Backdrop close
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-[#1a1c1c]/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-none border border-[var(--border-color)] bg-[var(--card-bg)] shadow-none sm:mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color-light)] px-6 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
            <Bookmark size={16} /> Saved Strategies
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X size={16} />
          </button>
        </div>

        {/* Save current */}
        <div className="border-b border-[var(--border-color-light)] px-6 py-4">
          <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Save current configuration</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Strategy name…"
              className="input-base flex-1"
              autoFocus
            />
            <button onClick={save} disabled={!name.trim()} className="btn-primary shrink-0">
              Save
            </button>
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto px-6 py-3">
          {strategies.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">No saved strategies yet</p>
          ) : (
            <div className="space-y-2">
              {strategies.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-none border border-[var(--border-color-light)] bg-[var(--paper-bg)] px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => onLoad(s)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-semibold text-[var(--text-main)]">{s.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {s.config.universe} · {s.config.rankingSystem || '—'} · {formatDate(s.createdAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="btn-danger ml-3 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex justify-between border-t border-[var(--border-color-light)] px-6 py-3">
          <button onClick={exportAll} className="btn-ghost text-xs" disabled={strategies.length === 0}>
            <Download size={14} /> Export JSON
          </button>
          <label className="btn-ghost cursor-pointer text-xs">
            <Upload size={14} /> Import JSON
            <input type="file" accept=".json" className="hidden" onChange={importFile} />
          </label>
        </div>
      </div>
    </div>
  )
}
