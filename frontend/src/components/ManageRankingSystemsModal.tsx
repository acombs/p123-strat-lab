import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface RankingSystemItem {
  id: number
  name: string
}

interface Props {
  onClose: () => void
  onAdd: (id: number, name: string) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export default function ManageRankingSystemsModal({ onClose, onAdd, onDelete }: Props) {
  const [systems, setSystems] = useState<RankingSystemItem[]>([])
  const [systemId, setSystemId] = useState('')
  const [systemName, setSystemName] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSystems()
  }, [])

  async function fetchSystems() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/ranking-systems')
      if (!r.ok) throw new Error('Failed to load ranking systems')
      const data = await r.json()
      if (Array.isArray(data)) {
        setSystems(data)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load ranking systems.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const id = parseInt(systemId.trim())
    const name = systemName.trim()

    if (isNaN(id) || id <= 0) {
      setError('Ranking System ID must be a valid positive number.')
      return
    }
    if (!name) {
      setError('Please enter a name/label for the ranking system.')
      return
    }

    setError(null)
    setAdding(true)
    try {
      await onAdd(id, name)
      setSystemId('')
      setSystemName('')
      await fetchSystems()
    } catch (err: any) {
      setError(err.message || 'Failed to add ranking system.')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: number) {
    setError(null)
    setDeletingId(id)
    try {
      await onDelete(id)
      await fetchSystems()
    } catch (err: any) {
      setError(err.message || 'Failed to delete ranking system.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#1a1c1c]/40 transition-opacity" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-none border border-[var(--border-color)] bg-[var(--card-bg)] shadow-none transition-all sm:mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color-light)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[var(--text-main)]">
              Manage Ranking Systems
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Add or remove ranking system IDs from the autocomplete search list.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost -mr-1.5 p-1.5" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="border-b border-[var(--border-color-light)] bg-[var(--pastel-red-bg)] px-6 py-2.5 text-xs text-[var(--pastel-red-text)]">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* Add Ranking System Form */}
        <div className="border-b border-[var(--border-color-light)] bg-[var(--paper-bg)] px-6 py-4">
          <form onSubmit={handleAdd} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={systemId}
                onChange={(e) => setSystemId(e.target.value)}
                placeholder="Ranking System ID"
                className="input-base focus:ring-blue-500/20"
                disabled={adding}
              />
              <input
                type="text"
                value={systemName}
                onChange={(e) => setSystemName(e.target.value)}
                placeholder="Name (e.g. MeanRev 20)"
                className="input-base focus:ring-blue-500/20"
                disabled={adding}
              />
            </div>
            <button
              type="submit"
              disabled={adding || !systemId.trim() || !systemName.trim()}
              className="btn-primary w-full justify-center py-2"
            >
              {adding ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Adding System...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add Ranking System
                </>
              )}
            </button>
          </form>
        </div>

        {/* List of Ranking Systems */}
        <div className="max-h-[280px] overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="label">Ranking Systems ({systems.length})</span>
            {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
          </div>
          <div className="divide-y divide-[var(--border-color-light)]">
            {systems.map((s) => {
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 pr-4">
                    <p className="truncate text-sm font-semibold text-[var(--text-main)]">
                      {s.name}
                    </p>
                    <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                      ID: {s.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId !== null || adding}
                    className="btn-danger p-2 hover:bg-red-50 dark:hover:bg-red-950/50"
                    aria-label={`Remove ${s.name}`}
                  >
                    {deletingId === s.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[var(--border-color-light)] bg-[var(--paper-bg)] px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-save"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
