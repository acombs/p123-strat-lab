import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EquityCurvePoint } from '../../types'

interface Props {
  data: EquityCurvePoint[]
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function formatVal(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 100_000) return `$${(v / 1000).toFixed(0)}K`
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function logTick(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `${(v / 1_000).toFixed(0)}K`
  return `${v}`
}

// Downsample long series for performance
function downsample(data: EquityCurvePoint[], maxPoints = 600): EquityCurvePoint[] {
  if (data.length <= maxPoints) return data
  const step = Math.ceil(data.length / maxPoints)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1)
}

const PORTFOLIO_COLOR = 'var(--chart-portfolio)'
const BENCHMARK_COLOR = 'var(--chart-benchmark)'

export default function EquityChart({ data }: Props) {
  const sampled = downsample(data)

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const port = payload.find((p: any) => p.dataKey === 'portfolio')
    const bench = payload.find((p: any) => p.dataKey === 'benchmark')
    const portStart = data[0]?.portfolio ?? 100000
    const benchStart = data[0]?.benchmark ?? 100000
    const portPct = port ? ((port.value / portStart - 1) * 100).toFixed(1) : null
    const benchPct = bench ? ((bench.value / benchStart - 1) * 100).toFixed(1) : null
    return (
      <div className="border border-[var(--border-color)] p-3 rounded-none shadow-none bg-[var(--card-bg)]">
        <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">{new Date(label + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        {port && (
          <p style={{ color: PORTFOLIO_COLOR }} className="text-sm font-bold">
            Portfolio: {formatVal(port.value)} {portPct ? `(+${portPct}%)` : ''}
          </p>
        )}
        {bench && (
          <p style={{ color: BENCHMARK_COLOR }} className="text-sm font-semibold">
            Benchmark: {formatVal(bench.value)} {benchPct ? `(+${benchPct}%)` : ''}
          </p>
        )}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={sampled} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={60}
        />
        <YAxis
          scale="log"
          domain={['auto', 'auto']}
          tickFormatter={logTick}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="plainline"
          iconSize={24}
          formatter={(v) => (
            <span className="text-xs font-medium capitalize">{v}</span>
          )}
        />
        <Line
          type="monotone"
          dataKey="portfolio"
          stroke={PORTFOLIO_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="Portfolio"
        />
        <Line
          type="monotone"
          dataKey="benchmark"
          stroke={BENCHMARK_COLOR}
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="4 2"
          name="Benchmark"
        />
        <ReferenceLine
          y={data[0]?.portfolio ?? 100000}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeDasharray="2 4"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
