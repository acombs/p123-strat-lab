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
  mode: 'sharpe' | 'returns'
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function downsample(data: EquityCurvePoint[], maxPoints = 500): EquityCurvePoint[] {
  if (data.length <= maxPoints) return data
  const step = Math.ceil(data.length / maxPoints)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1)
}

const PORTFOLIO_COLOR = 'var(--chart-portfolio)'
const BENCHMARK_COLOR = 'var(--chart-benchmark)'

export default function RollingChart({ data, mode }: Props) {
  const filtered = data.filter(
    (d) => (mode === 'sharpe' ? d.rollingSharp != null : d.rollingReturn != null)
  )
  const sampled = downsample(filtered)

  const portKey = mode === 'sharpe' ? 'rollingSharp' : 'rollingReturn'
  const benchKey = mode === 'sharpe' ? null : 'rollingBenchReturn'
  const label = mode === 'sharpe' ? 'Rolling Sharpe (1Y)' : 'Rolling 1Y Return'

  const CustomTooltip = ({ active, payload, label: lbl }: any) => {
    if (!active || !payload?.length) return null
    const port = payload.find((p: any) => p.dataKey === portKey)
    const bench = benchKey ? payload.find((p: any) => p.dataKey === benchKey) : null
    return (
      <div className="border border-[var(--border-color)] p-3 rounded-none shadow-none bg-[var(--card-bg)]">
        <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">
          {new Date(lbl + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
        {port && (
          <p style={{ color: PORTFOLIO_COLOR }} className="text-sm font-bold">
            Portfolio: {mode === 'sharpe' ? port.value.toFixed(2) : `${port.value.toFixed(1)}%`}
          </p>
        )}
        {bench && (
          <p style={{ color: BENCHMARK_COLOR }} className="text-sm font-semibold">
            Benchmark: {mode === 'sharpe' ? bench.value?.toFixed(2) : `${bench.value?.toFixed(1)}%`}
          </p>
        )}
      </div>
    )
  }

  if (!sampled.length) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-slate-400">
        Not enough data for rolling metrics
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
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => mode === 'sharpe' ? v.toFixed(1) : `${v}%`}
          width={48}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="plainline" formatter={(v) => <span className="text-xs font-medium capitalize">{v}</span>} />
        <ReferenceLine
          y={mode === 'sharpe' ? 1 : 0}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
        />
        <Line
          type="monotone"
          dataKey={portKey}
          stroke={PORTFOLIO_COLOR}
          strokeWidth={2}
          dot={false}
          name="Portfolio"
          connectNulls
        />
        {benchKey && (
          <Line
            type="monotone"
            dataKey={benchKey}
            stroke={BENCHMARK_COLOR}
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="4 2"
            name="Benchmark"
            connectNulls
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
