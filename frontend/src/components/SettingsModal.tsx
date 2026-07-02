import { Loader2, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../types'

interface Props {
  onClose: () => void
  onSaved: (s: AppSettings) => void
}

export default function SettingsModal({ onClose, onSaved }: Props) {
  const [shadowSimId, setShadowSimId] = useState('')
  const [shadowSimIdStatic, setShadowSimIdStatic] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s: AppSettings) => {
        setShadowSimId(s.shadowSimId ? String(s.shadowSimId) : '')
        setShadowSimIdStatic(s.shadowSimIdStatic ? String(s.shadowSimIdStatic) : '')
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shadowSimId: shadowSimId.trim() ? parseInt(shadowSimId.trim()) : null,
          shadowSimIdStatic: shadowSimIdStatic.trim() ? parseInt(shadowSimIdStatic.trim()) : null,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Failed to save settings')
      }
      const data: AppSettings = await resp.json()
      onSaved(data)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#1a1c1c]/40 transition-opacity" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-none border border-[var(--border-color)] bg-[var(--card-bg)] shadow-none transition-all sm:mx-4">
        <div className="flex items-center justify-between border-b border-[var(--border-color-light)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[var(--text-main)]">Settings</h2>
            <p className="text-xs text-[var(--text-muted)]">Shadow sims keep backtests off your real strategies.</p>
          </div>
          <button onClick={onClose} className="btn-ghost -mr-1.5 p-1.5" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="border-b border-[var(--border-color-light)] bg-[var(--pastel-red-bg)] px-6 py-2.5 text-xs text-[var(--pastel-red-text)]">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        <div className="space-y-5 px-6 py-5">
          <div className="flex gap-3 border border-[var(--border-color-light)] bg-[var(--paper-bg)] p-3 text-xs text-[var(--text-muted)] rounded-none dark:rounded-[0.25rem]">
            <ShieldCheck size={28} className="shrink-0 text-[var(--pastel-green-text)]" />
            <p>
              Backtests are executed by rerunning a dedicated <span className="font-semibold">scratch simulation</span> with
              your test config, so the strategy you selected is never modified. Create a throwaway SIM on
              Portfolio123 (any settings), then paste its ID below. Without one, runs fall back to rerunning
              the selected sim directly — which permanently changes it on P123.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div>
                <label className="label mb-1.5">Shadow Sim ID (dynamic sizing)</label>
                <input
                  type="number"
                  value={shadowSimId}
                  onChange={(e) => setShadowSimId(e.target.value)}
                  placeholder="Scratch SIM id from the P123 URL"
                  className="input-base"
                />
                <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  Used for all tests. Create it with dynamic-weight rebalancing (the P123 default).
                </p>
              </div>
              <div>
                <label className="label mb-1.5">Shadow Sim ID (static sizing) — optional</label>
                <input
                  type="number"
                  value={shadowSimIdStatic}
                  onChange={(e) => setShadowSimIdStatic(e.target.value)}
                  placeholder="Only needed for STATIC-sized targets"
                  className="input-base"
                />
                <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  The API cannot switch a sim's sizing method, so targets that use static position
                  weights need a second scratch sim created with static sizing.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-color-light)] bg-[var(--paper-bg)] px-6 py-3.5">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="button" onClick={save} disabled={saving || loading} className="btn-save">
            {saving ? (<><Loader2 size={14} className="animate-spin" /> Validating…</>) : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
