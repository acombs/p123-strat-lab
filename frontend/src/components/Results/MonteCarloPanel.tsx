import { Loader2, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EquityCurvePoint, MonteCarloResult } from '../../types'

interface Props {
  curve: EquityCurvePoint[]
  simId?: number
}

const START_VALUE = 100_000

function money(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 10_000) return `$${(v / 1000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
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

export default function MonteCarloPanel({ curve, simId }: Props) {
  const [horizon, setHorizon] = useState(5)
  const [paths, setPaths] = useState(1000)
  const [block, setBlock] = useState(20)
  const [result, setResult] = useState<MonteCarloResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ranOnce = useRef(false)

  async function run(h = horizon, np = paths, bl = block) {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/montecarlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio: curve.map((p) => p.portfolio),
          benchmark: curve.map((p) => p.benchmark),
          horizonYears: h,
          numPaths: np,
          blockDays: bl,
          simId: simId ?? null,
          startDate: curve[0]?.date ?? null,
          endDate: curve[curve.length - 1]?.date ?? null,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Monte Carlo failed')
      }
      setResult(await resp.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!ranOnce.current && curve.length > 260) {
      ranOnce.current = true
      run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve])

  const fanData = result?.fan.map((f) => ({
    years: f.years,
    outer: [f.p5 * START_VALUE, f.p95 * START_VALUE],
    inner: [f.p25 * START_VALUE, f.p75 * START_VALUE],
    median: f.p50 * START_VALUE,
  }))

  const FanTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const d = result?.fan.find((f) => f.years === label)
    if (!d) return null
    return (
      <div className="border border-[var(--border-color)] bg-[var(--card-bg)] p-3 text-xs">
        <p className="mb-1 font-semibold text-[var(--text-muted)]">{`Year ${label.toFixed(1)}`}</p>
        <p>95th: <span className="font-mono">{money(d.p95 * START_VALUE)}</span></p>
        <p>75th: <span className="font-mono">{money(d.p75 * START_VALUE)}</span></p>
        <p className="font-bold">Median: <span className="font-mono">{money(d.p50 * START_VALUE)}</span></p>
        <p>25th: <span className="font-mono">{money(d.p25 * START_VALUE)}</span></p>
        <p>5th: <span className="font-mono">{money(d.p5 * START_VALUE)}</span></p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label mb-1">Horizon</label>
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="select-base w-28">
            {[1, 3, 5, 10, 15].map((y) => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1">Paths</label>
          <select value={paths} onChange={(e) => setPaths(Number(e.target.value))} className="select-base w-24">
            {[500, 1000, 2000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1">Block (days)</label>
          <select value={block} onChange={(e) => setBlock(Number(e.target.value))} className="select-base w-24">
            {[5, 20, 60].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => run()} disabled={loading} className="btn-primary py-1.5">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} strokeWidth={2.5} />}
          Simulate
        </button>
        <p className="text-[11px] text-[var(--text-muted)] max-w-xs">
          Block bootstrap of the backtest's daily returns (benchmark resampled in lockstep). Uses no API credits.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--pastel-red-text)]">{error}</p>}

      {loading && !result && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Simulating…
        </div>
      )}

      {result && fanData && (
        <>
          {/* Fan chart */}
          <div>
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              {result.numPaths.toLocaleString()} simulated {result.horizonYears}-year paths from {money(START_VALUE)} —
              bands: 5–95% (outer), 25–75% (inner), median line
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={fanData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="1 5" />
                <XAxis dataKey="years" type="number" domain={[0, 'dataMax']}
                       tickFormatter={(v: number) => `${v.toFixed(0)}y`} />
                <YAxis scale="log" domain={['auto', 'auto']} tickFormatter={money} width={64} />
                <Tooltip content={<FanTooltip />} />
                <Area dataKey="outer" stroke="none" fill="var(--chart-portfolio)" fillOpacity={0.10} isAnimationActive={false} />
                <Area dataKey="inner" stroke="none" fill="var(--chart-portfolio)" fillOpacity={0.18} isAnimationActive={false} />
                <Line dataKey="median" stroke="var(--chart-portfolio)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Median CAGR" value={pct(result.cagr.p50)} tone={result.cagr.p50 >= 0 ? 'good' : 'bad'} />
            <Stat label="CAGR 5–95%" value={`${pct(result.cagr.p5)} … ${pct(result.cagr.p95)}`} />
            <Stat label="Median Max DD" value={pct(result.maxDrawdown.p50)} tone="bad" />
            <Stat label="Worst-5% Max DD" value={pct(result.maxDrawdown.p5)} tone="bad" />
            <Stat label="P(Loss)" value={pct(result.probLoss * 100)} tone={result.probLoss > 0.2 ? 'bad' : undefined} />
            <Stat label="P(Under Bench)" value={pct(result.probUnderperformBench * 100)}
                  tone={result.probUnderperformBench > 0.5 ? 'bad' : 'good'} />
          </div>

          {/* Drawdown risk + histogram */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">Probability of a drawdown worse than…</p>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(result.probDDWorseThan).map(([th, p]) => (
                  <Stat key={th} label={`−${th}%`} value={pct(p * 100)} tone={p > 0.25 ? 'bad' : undefined} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">Max-drawdown distribution across paths</p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={result.ddHistogram} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                  <XAxis dataKey="bin" tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v: number) => [`${v} paths`, 'Count']}
                    labelFormatter={(v: number) => `Max DD ≈ ${v.toFixed(1)}%`}
                  />
                  <Bar dataKey="count" fill="var(--chart-benchmark)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Trade-level quality */}
          {result.trades && (
            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                Trade-level bootstrap — {result.trades.count.toLocaleString()} closed round trips (price return, FIFO-paired;
                dividends excluded). Answers "is the edge real," not portfolio risk.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Win Rate" value={pct(result.trades.winRate)} />
                <Stat label="Avg Trade" value={pct(result.trades.avgTradePct, 2)}
                      tone={result.trades.avgTradePct >= 0 ? 'good' : 'bad'} />
                <Stat label="Expectancy 5%" value={pct(result.trades.expectancyCI.p5, 2)} />
                <Stat label="Expectancy 95%" value={pct(result.trades.expectancyCI.p95, 2)} />
                <Stat label="Losing Streak (p95)" value={`${result.trades.maxLosingStreak.p95.toFixed(0)} trades`} />
                <Stat label="P(No Edge)" value={pct(result.trades.probNegativeExpectancy * 100)}
                      tone={result.trades.probNegativeExpectancy > 0.05 ? 'bad' : 'good'} />
              </div>
            </div>
          )}
          {result.tradesNote && (
            <p className="text-[11px] text-[var(--text-muted)]">{result.tradesNote}</p>
          )}
        </>
      )}
    </div>
  )
}
