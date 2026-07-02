import type { Metrics } from '../../types'

interface Props {
  metrics: Metrics
}

function fmt(val: number | null, decimals = 2, suffix = '') {
  if (val == null) return '—'
  return val.toFixed(decimals) + suffix
}

function fmtPct(val: number | null) {
  if (val == null) return '—'
  const sign = val >= 0 ? '+' : ''
  return sign + val.toFixed(1) + '%'
}

function fmtDays(val: number | null) {
  if (val == null) return '—'
  const days = Math.round(val)
  return days >= 365 ? `${(days / 365).toFixed(1)}y` : `${days}d`
}

function fmtEndingVal(val: number | null) {
  if (val == null) return '—'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`
  return `$${val.toFixed(0)}`
}

interface MetricDef {
  label: string
  portVal: string
  benchVal?: string
  portClass?: string
  benchClass?: string
}

export default function MetricsGrid({ metrics }: Props) {
  const isPos = (v: number | null) => v != null && v > 0
  const isNeg = (v: number | null) => v != null && v < 0

  const activeCagr = metrics.cagr != null && metrics.benchCagr != null
    ? metrics.cagr - metrics.benchCagr
    : null

  const endingVal = metrics.totalReturn != null
    ? 100000 * (1 + metrics.totalReturn / 100)
    : null

  const benchEndingVal = metrics.benchTotalReturn != null
    ? 100000 * (1 + metrics.benchTotalReturn / 100)
    : null

  const getEndingClass = (v: number | null) =>
    v != null && v > 100000 ? 'positive' : v != null && v < 100000 ? 'negative' : 'neutral'

  const rows: MetricDef[] = [
    {
      label: 'Ending Value',
      portVal: fmtEndingVal(endingVal),
      benchVal: benchEndingVal != null ? fmtEndingVal(benchEndingVal) : undefined,
      portClass: getEndingClass(endingVal),
      benchClass: getEndingClass(benchEndingVal),
    },
    {
      label: 'CAGR',
      portVal: fmtPct(metrics.cagr),
      benchVal: metrics.benchCagr != null ? fmtPct(metrics.benchCagr) : undefined,
      portClass: isPos(metrics.cagr) ? 'positive' : isNeg(metrics.cagr) ? 'negative' : 'neutral',
      benchClass: isPos(metrics.benchCagr) ? 'positive' : isNeg(metrics.benchCagr) ? 'negative' : 'neutral',
    },
    {
      label: 'Total Return',
      portVal: fmtPct(metrics.totalReturn),
      benchVal: metrics.benchTotalReturn != null ? fmtPct(metrics.benchTotalReturn) : undefined,
      portClass: isPos(metrics.totalReturn) ? 'positive' : isNeg(metrics.totalReturn) ? 'negative' : 'neutral',
      benchClass: isPos(metrics.benchTotalReturn) ? 'positive' : isNeg(metrics.benchTotalReturn) ? 'negative' : 'neutral',
    },
    {
      label: 'Active CAGR',
      portVal: fmtPct(activeCagr),
      portClass: isPos(activeCagr) ? 'positive' : isNeg(activeCagr) ? 'negative' : 'neutral',
    },
    {
      label: 'Sharpe',
      portVal: fmt(metrics.sharpe),
      benchVal: metrics.benchSharpe != null ? fmt(metrics.benchSharpe) : undefined,
      portClass: (metrics.sharpe ?? 0) >= 1 ? 'positive' : (metrics.sharpe ?? 0) >= 0.5 ? 'neutral' : 'negative',
    },
    {
      label: 'Sortino',
      portVal: fmt(metrics.sortino),
      portClass: (metrics.sortino ?? 0) >= 1 ? 'positive' : 'neutral',
    },
    {
      label: 'Max Drawdown',
      portVal: fmtPct(metrics.maxDrawdown),
      benchVal: metrics.benchMaxDrawdown != null ? fmtPct(metrics.benchMaxDrawdown) : undefined,
      portClass: 'negative',
      benchClass: 'negative',
    },
    {
      label: 'Alpha',
      portVal: fmt(metrics.alpha, 2, '%'),
      portClass: isPos(metrics.alpha) ? 'positive' : isNeg(metrics.alpha) ? 'negative' : 'neutral',
    },
    {
      label: 'Beta',
      portVal: fmt(metrics.beta),
      portClass: 'neutral',
    },
    {
      label: 'Win Rate',
      portVal: fmtPct(metrics.winRate),
      portClass: (metrics.winRate ?? 0) >= 55 ? 'positive' : 'neutral',
    },
    {
      label: 'Max Underperformance',
      portVal: fmt(metrics.maxUnderperformanceMonths, 1, ' mo'),
      portClass: 'neutral',
    },
    {
      label: 'Avg Holdings',
      portVal: fmt(metrics.numHoldings, 1),
      portClass: 'neutral',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="metric-card">
          <span className="metric-label">{row.label}</span>
          <span className={`metric-value ${row.portClass ?? 'neutral'}`}>
            {row.portVal}
          </span>
          {row.benchVal != null ? (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Benchmark: <span className={`font-semibold ${row.benchClass ?? 'neutral'}`}>{row.benchVal}</span>
            </span>
          ) : (
            <span className="text-[11px] text-transparent select-none">
              &nbsp;
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
