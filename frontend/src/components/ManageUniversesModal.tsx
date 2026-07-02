import { Loader2, Plus, Trash2, X, Lock } from 'lucide-react'
import { useState } from 'react'
import type { SelectOption } from '../types'

interface Props {
  universes: SelectOption[]
  onClose: () => void
  onAdd: (value: string, label: string) => Promise<void>
  onDelete: (value: string) => Promise<void>
}

export default function ManageUniversesModal({ universes, onClose, onAdd, onDelete }: Props) {
  const [universeId, setUniverseId] = useState('')
  const [universeLabel, setUniverseLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingValue, setDeletingValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const idVal = universeId.trim()
    const labelVal = universeLabel.trim()

    if (!/^\d+$/.test(idVal)) {
      setError('Universe ID must be a valid positive number.')
      return
    }
    if (!labelVal) {
      setError('Please enter a descriptive label/name for the universe.')
      return
    }

    setError(null)
    setAdding(true)
    try {
      await onAdd(idVal, labelVal)
      setUniverseId('')
      setUniverseLabel('')
    } catch (err: any) {
      setError(err.message || 'Failed to add custom universe mapping.')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(value: string) {
    setError(null)
    setDeletingValue(value)
    try {
      await onDelete(value)
    } catch (err: any) {
      setError(err.message || 'Failed to delete universe mapping.')
    } finally {
      setDeletingValue(null)
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
              Manage Universes
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Create and manage custom Portfolio123 universe ID mappings.
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

        {/* Add Universe Form */}
        <div className="border-b border-[var(--border-color-light)] bg-[var(--paper-bg)] px-6 py-4">
          <form onSubmit={handleAdd} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={universeId}
                onChange={(e) => setUniverseId(e.target.value)}
                placeholder="Universe ID or code"
                className="input-base focus:ring-blue-500/20"
                disabled={adding}
              />
              <input
                type="text"
                value={universeLabel}
                onChange={(e) => setUniverseLabel(e.target.value)}
                placeholder="Label (e.g. NOTC + Min30M)"
                className="input-base focus:ring-blue-500/20"
                disabled={adding}
              />
            </div>
            <button
              type="submit"
              disabled={adding || !universeId.trim() || !universeLabel.trim()}
              className="btn-primary w-full justify-center py-2"
            >
              {adding ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Adding Universe...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add Universe Mapping
                </>
              )}
            </button>
          </form>
        </div>

        {/* List of Universes */}
        <div className="max-h-[280px] overflow-y-auto px-6 py-4">
          <span className="label mb-2 block">Universes ({universes.length})</span>
          <div className="divide-y divide-[var(--border-color-light)]">
            {universes.map((u) => {
              const isCustom = /^\d+$/.test(u.value)
              return (
                <div
                  key={u.value}
                  className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 pr-4">
                    <p className="truncate text-sm font-semibold text-[var(--text-main)]">
                      {u.label}
                    </p>
                    <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                      {isCustom ? `Custom ID: ${u.value}` : `System Code: ${u.value}`}
                    </p>
                  </div>
                  {isCustom ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(u.value)}
                      disabled={deletingValue !== null || adding}
                      className="btn-danger p-2 hover:bg-red-50 dark:hover:bg-red-950/50"
                      aria-label={`Remove ${u.label}`}
                    >
                      {deletingValue === u.value ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  ) : (
                    <div className="p-2 text-[var(--text-muted)]" title="System universe (Locked)">
                      <Lock size={14} />
                    </div>
                  )}
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
