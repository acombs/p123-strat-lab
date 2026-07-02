import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Transaction } from '../../types'

interface Props {
  simId: number
  start: string
  end: string
}

// Preferred column order; anything else present is appended.
const PREFERRED = ['date', 'tranDt', 'dt', 'ticker', 'symbol', 'transType', 'type', 'action',
  'shares', 'price', 'amount', 'value', 'gainPct', 'daysHeld', 'weight', 'note']
const MAX_COLS = 9
const PAGE = 100

function header(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}

export default function TradesPanel({ simId, start, end }: Props) {
  const [trans, setTrans] = useState<Transaction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)

  useEffect(() => {
    let active = true
    setTrans(null)
    setError(null)
    setLimit(PAGE)
    fetch(`/api/strategies/${simId}/transactions?start=${start}&end=${end}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: 'Failed to load transactions' }))
          throw new Error(err.detail || 'Failed to load transactions')
        }
        return r.json()
      })
      .then((data) => { if (active) setTrans(Array.isArray(data.trans) ? data.trans : []) })
      .catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [simId, start, end])

  const columns = useMemo(() => {
    if (!trans || trans.length === 0) return []
    const keys = new Set<string>()
    for (const t of trans.slice(0, 50)) Object.keys(t).forEach((k) => keys.add(k))
    const cols = PREFERRED.filter((k) => keys.has(k))
    for (const k of keys) {
      if (cols.length >= MAX_COLS) break
      if (!cols.includes(k)) cols.push(k)
    }
    return cols.slice(0, MAX_COLS)
  }, [trans])

  if (error) {
    return <p className="py-6 text-center text-sm text-[var(--pastel-red-text)]">{error}</p>
  }
  if (!trans) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-muted)]">
        <Loader2 size={16} className="animate-spin" /> Loading transactions…
      </div>
    )
  }
  if (trans.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--text-muted)]">No transactions in this period.</p>
  }

  return (
    <div>
      <div className="max-h-[420px] overflow-auto border border-[var(--border-color-light)] rounded-none dark:rounded-[0.25rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--paper-bg)]">
            <tr className="text-left">
              {columns.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                >
                  {header(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {trans.slice(0, limit).map((t, i) => (
              <tr key={i} className="border-t border-[var(--border-color-light)]">
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-1.5 text-[var(--text-main)]">
                    {cell(t[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>{Math.min(limit, trans.length).toLocaleString()} of {trans.length.toLocaleString()} transactions</span>
        {limit < trans.length && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="btn-ghost px-2 py-1 text-[11px]">
            Show more
          </button>
        )}
      </div>
    </div>
  )
}
