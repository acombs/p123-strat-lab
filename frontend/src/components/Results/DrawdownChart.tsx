import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
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

function downsample(data: EquityCurvePoint[], maxPoints = 600): EquityCurvePoint[] {
  if (data.length <= maxPoints) return data
  const step = Math.ceil(data.length / maxPoints)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1)
}

const PORTFOLIO_COLOR = 'var(--pastel-red-text)'
const BENCHMARK_COLOR = 'var(--chart-benchmark)'

export default function DrawdownChart({ data }: Props) {
  const sampled = downsample(data)

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const port = payload.find((p: any) => p.dataKey === 'drawdown')
    const bench = payload.find((p: any) => p.dataKey === 'benchDrawdown')
    return (
      <div className="border border-[var(--border-color)] p-3 rounded-none shadow-none bg-[var(--card-bg)]">
        <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">
          {new Date(label + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
        {port && (
          <p style={{ color: PORTFOLIO_COLOR }} className="text-sm font-bold">
            Portfolio: {port.value.toFixed(1)}%
          </p>
        )}
        {bench && (
          <p style={{ color: BENCHMARK_COLOR }} className="text-sm font-semibold">
            Benchmark: {bench.value.toFixed(1)}%
          </p>
        )}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={420}>
      <AreaChart data={sampled} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="portDD" x1="0" y1="1" x2="0" y2="0">
            <stop offset="5%" stopColor={PORTFOLIO_COLOR} stopOpacity={0.25} />
            <stop offset="95%" stopColor={PORTFOLIO_COLOR} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="benchDD" x1="0" y1="1" x2="0" y2="0">
            <stop offset="5%" stopColor={BENCHMARK_COLOR} stopOpacity={0.15} />
            <stop offset="95%" stopColor={BENCHMARK_COLOR} stopOpacity={0.01} />
          </linearGradient>
        </defs>
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
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}%`}
          width={48}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="plainline"
          formatter={(v) => <span className="text-xs font-medium capitalize">{v}</span>}
        />
        <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.2} />
        <Area
          type="monotone"
          dataKey="drawdown"
          stroke={PORTFOLIO_COLOR}
          strokeWidth={1.5}
          fill="url(#portDD)"
          dot={false}
          name="Portfolio DD"
        />
        <Area
          type="monotone"
          dataKey="benchDrawdown"
          stroke={BENCHMARK_COLOR}
          strokeWidth={1}
          fill="url(#benchDD)"
          dot={false}
          strokeDasharray="4 2"
          name="Benchmark DD"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
