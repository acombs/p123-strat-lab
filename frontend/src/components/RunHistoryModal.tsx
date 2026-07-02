import { Trash2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import type { RunHistoryEntry } from '../types'

interface Props {
  history: RunHistoryEntry[]
  onLoad: (entry: RunHistoryEntry) => void
  onDelete: (id: string) => void
  onClear: () => void
  onClose: () => void
}

const COMPARE_METRICS: { key: keyof RunHistoryEntry['metrics']; label: string; pct?: boolean }[] = [
  { key: 'cagr', label: 'CAGR', pct: true },
  { key: 'totalReturn', label: 'Total Return', pct: true },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'sortino', label: 'Sortino' },
  { key: 'maxDrawdown', label: 'Max Drawdown', pct: true },
  { key: 'alpha', label: 'Alpha' },
  { key: 'beta', label: 'Beta' },
  { key: 'winRate', label: 'Win Rate', pct: true },
  { key: 'turnover', label: 'Turnover', pct: true },
]

function fmt(v: number | null | undefined, pct?: boolean) {
  if (v === null || v === undefined) return '—'
  return pct ? `${v.toFixed(1)}%` : v.toFixed(2)
}

function summarizeConfig(e: RunHistoryEntry) {
  const buy = e.config.buyRules.filter((r) => r.formula.trim() && !r.disabled).length
  const sell = e.config.sellRules.filter((r) => r.formula.trim() && !r.disabled).length
  return `${e.config.universe} · ${e.config.rankingSystem || 'no ranking'} · ${e.config.holdings} pos · ${e.config.rebalFreq} · ${buy}B/${sell}S rules · ${e.config.startDate} → ${e.config.endDate}`
}

export default function RunHistoryModal({ history, onLoad, onDelete, onClear, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>([])

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-3)
    )
  }

  const compared = history.filter((h) => selected.includes(h.id))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#1a1c1c]/40 transition-opacity" onClick={onClose} />

      <div className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-none border border-[var(--border-color)] bg-[var(--card-bg)] shadow-none sm:mx-4">
        <div className="flex items-center justify-between border-b border-[var(--border-color-light)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[var(--text-main)]">Run History</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Last {history.length} backtests on this browser. Select up to 3 to compare.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {history.length > 0 && (
              <button onClick={onClear} className="btn-ghost text-xs" title="Clear history">
                Clear all
              </button>
            )}
            <button onClick={onClose} className="btn-ghost -mr-1.5 p-1.5" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Comparison table */}
        {compared.length >= 2 && (
          <div className="border-b border-[var(--border-color-light)] bg-[var(--paper-bg)] px-6 py-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th className="pb-2 pr-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Metric</th>
                  {compared.map((c) => (
                    <th key={c.id} className="pb-2 pr-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      {new Date(c.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {COMPARE_METRICS.map(({ key, label, pct }) => {
                  const values = compared.map((c) => c.metrics[key] as number | null)
                  const valid = values.filter((v): v is number => v !== null && v !== undefined)
                  // "Best" = max, except drawdown/beta/turnover where smaller magnitude is better
                  const lowerBetter = key === 'maxDrawdown' ? 'abs' : key === 'turnover' ? 'min' : null
                  let bestIdx = -1
                  if (valid.length > 1) {
                    let best = -Infinity
                    values.forEach((v, i) => {
                      if (v === null || v === undefined) return
                      const score = lowerBetter === 'abs' ? -Math.abs(v) : lowerBetter === 'min' ? -v : v
                      if (score > best) { best = score; bestIdx = i }
                    })
                  }
                  return (
                    <tr key={key} className="border-t border-[var(--border-color-light)]">
                      <td className="py-1.5 pr-4 font-sans font-semibold text-[var(--text-muted)]">{label}</td>
                      {values.map((v, i) => (
                        <td key={i} className={`py-1.5 pr-4 ${i === bestIdx ? 'font-bold text-[var(--pastel-green-text)]' : 'text-[var(--text-main)]'}`}>
                          {fmt(v, pct)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Entries */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {history.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              No runs yet — results will accumulate here as you backtest.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-color-light)]">
              {history.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <input
                    type="checkbox"
                    checked={selected.includes(e.id)}
                    onChange={() => toggle(e.id)}
                    className="h-4 w-4 shrink-0 accent-[var(--text-main)]"
                    title="Select for comparison"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--text-main)]">{e.strategyLabel}</span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {new Date(e.ts).toLocaleString()}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-[var(--text-muted)]" title={summarizeConfig(e)}>
                      {summarizeConfig(e)}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--text-main)]">
                      CAGR {fmt(e.metrics.cagr, true)} · Sharpe {fmt(e.metrics.sharpe)} · DD {fmt(e.metrics.maxDrawdown, true)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onLoad(e)}
                    className="btn-ghost shrink-0 px-2 py-1.5 text-xs"
                    title="Load this configuration into the form"
                  >
                    <Upload size={13} /> Load
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(e.id)}
                    className="btn-danger shrink-0 px-2 py-2"
                    aria-label="Delete entry"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
