import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { StrategyOption } from '../types'

interface Props {
  strategies: StrategyOption[]
  onClose: () => void
  onAdd: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export default function ManageStrategiesModal({ strategies, onClose, onAdd, onDelete }: Props) {
  const [strategyId, setStrategyId] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const id = parseInt(strategyId.trim())
    if (isNaN(id) || id <= 0) {
      setError('Please enter a valid positive Strategy ID.')
      return
    }

    setError(null)
    setAdding(true)
    try {
      await onAdd(id)
      setStrategyId('')
    } catch (err: any) {
      setError(err.message || 'Failed to add strategy. Make sure the ID exists on Portfolio123.')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: number) {
    setError(null)
    setDeletingId(id)
    try {
      await onDelete(id)
    } catch (err: any) {
      setError(err.message || 'Failed to delete strategy.')
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
              Manage Strategies
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Add or remove Portfolio123 strategy IDs from the list.
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

        {/* Add Strategy Form */}
        <div className="border-b border-[var(--border-color-light)] bg-[var(--paper-bg)] px-6 py-4">
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="text"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              placeholder="Enter P123 Strategy ID"
              className="input-base flex-1 focus:ring-blue-500/20"
              disabled={adding}
              autoFocus
            />
            <button
              type="submit"
              disabled={adding || !strategyId.trim()}
              className="btn-primary shrink-0 px-4"
            >
              {adding ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add
                </>
              )}
            </button>
          </form>
        </div>

        {/* List of Strategies */}
        <div className="max-h-[320px] overflow-y-auto px-6 py-4">
          <span className="label mb-2 block">Current Strategies ({strategies.length})</span>
          {strategies.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No strategies configured.</p>
          ) : (
            <div className="divide-y divide-[var(--border-color-light)]">
              {strategies.map((s) => (
                <div
                  key={s.value}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--text-main)]">
                        {s.label.replace(/\s\((Simulation|Live Portfolio|Book)\)$/, '')}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-none px-1.5 py-0.5 text-[10px] font-semibold ${
                          s.isBook
                            ? 'bg-[var(--pastel-yellow-bg)] text-[var(--pastel-yellow-text)] border border-[var(--border-color)]'
                            : s.isLive
                            ? 'bg-[var(--pastel-green-bg)] text-[var(--pastel-green-text)] border border-[var(--border-color)]'
                            : 'bg-[var(--pastel-blue-bg)] text-[var(--pastel-blue-text)] border border-[var(--border-color)]'
                        }`}
                      >
                        {s.isBook ? 'Book' : s.isLive ? 'Live' : 'Sim'}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">ID: {s.value}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.value)}
                    disabled={deletingId !== null || adding}
                    className="btn-danger p-2 hover:bg-red-50 dark:hover:bg-red-950/50"
                    aria-label={`Remove ${s.label}`}
                  >
                    {deletingId === s.value ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
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
