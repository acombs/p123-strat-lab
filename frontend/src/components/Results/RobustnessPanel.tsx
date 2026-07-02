import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EquityCurvePoint, RollingWindowsResult } from '../../types'

interface Props {
  curve: EquityCurvePoint[]
}

function pct(v: number | undefined, digits = 1) {
  return v === undefined || v === null ? '—' : `${v.toFixed(digits)}%`
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="metric-card !p-3">
      <span className="metric-label">{label}</span>
      <span className={`text-lg font-bold tracking-tight tabular-nums ${
        tone === 'good' ? 'positive' : tone === 'bad' ? 'negative' : ''
      }`}>
        {value}
      </span>
    </div>
  )
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export default function RobustnessPanel({ curve }: Props) {
  const [windowYears, setWindowYears] = useState(5)
  const [result, setResult] = useState<RollingWindowsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch('/api/rolling-windows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dates: curve.map((p) => p.date),
        portfolio: curve.map((p) => p.portfolio),
        benchmark: curve.map((p) => p.benchmark),
        windowYears,
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: 'Rolling-window analysis failed' }))
          throw new Error(err.detail || 'Rolling-window analysis failed')
        }
        return r.json()
      })
      .then((data) => { if (active) setResult(data) })
      .catch((e) => { if (active) { setResult(null); setError(e.message) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [curve, windowYears])

  const WindowTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const row = result?.windows.find((w) => w.start === label)
    if (!row) return null
    return (
      <div className="border border-[var(--border-color)] bg-[var(--card-bg)] p-3 text-xs">
        <p className="mb-1 font-semibold text-[var(--text-muted)]">
          {windowYears}y starting {new Date(label + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
        <p>Strategy: <span className="font-mono">{pct(row.cagr)}</span> CAGR</p>
        <p>Benchmark: <span className="font-mono">{pct(row.benchCagr)}</span> CAGR</p>
        <p>Window Max DD: <span className="font-mono">{pct(row.maxDD)}</span></p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label mb-1">Window Length</label>
          <select value={windowYears} onChange={(e) => setWindowYears(Number(e.target.value))} className="select-base w-28">
            {[3, 5, 10].map((y) => <option key={y} value={y}>{y} years</option>)}
          </select>
        </div>
        <p className="max-w-md text-[11px] text-[var(--text-muted)]">
          Every possible {windowYears}-year investment window in the backtest (weekly starts): would the strategy
          have worked no matter when you started? Uses no API credits.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--pastel-red-text)]">{error}</p>}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Computing windows…
        </div>
      )}

      {result && !loading && (
        <>
          <div>
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              CAGR of each {result.windowYears}-year window by start date — strategy (solid) vs. benchmark (dashed)
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={result.windows} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="1 5" />
                <XAxis dataKey="start" tickFormatter={formatDate} minTickGap={40} />
                <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={48} />
                <Tooltip content={<WindowTooltip />} />
                <ReferenceLine y={0} stroke="var(--pastel-red-text)" strokeDasharray="4 4" />
                <Line dataKey="cagr" stroke="var(--chart-portfolio)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="benchCagr" stroke="var(--chart-benchmark)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Windows" value={String(result.summary.count)} />
            <Stat label="Median CAGR" value={pct(result.summary.medianCagr)}
                  tone={result.summary.medianCagr >= 0 ? 'good' : 'bad'} />
            <Stat label="Best Window" value={pct(result.summary.bestCagr)} tone="good" />
            <Stat label="Worst Window" value={pct(result.summary.worstCagr)}
                  tone={result.summary.worstCagr < 0 ? 'bad' : undefined} />
            <Stat label="% Negative" value={pct(result.summary.pctNegative)}
                  tone={result.summary.pctNegative > 10 ? 'bad' : 'good'} />
            <Stat label="% Beat Bench" value={pct(result.summary.pctBeatBench)}
                  tone={result.summary.pctBeatBench > 50 ? 'good' : 'bad'} />
            <Stat label="Median Win DD" value={pct(result.summary.medianMaxDD)} tone="bad" />
            <Stat label="Worst Win DD" value={pct(result.summary.worstMaxDD)} tone="bad" />
          </div>
        </>
      )}
    </div>
  )
}
