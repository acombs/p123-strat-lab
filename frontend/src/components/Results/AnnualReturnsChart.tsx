import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnnualReturn } from '../../types'

interface Props {
  data: AnnualReturn[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const port = payload.find((p: any) => p.dataKey === 'portfolio')
  const bench = payload.find((p: any) => p.dataKey === 'benchmark')
  return (
    <div className="border border-[var(--border-color)] p-3 rounded-none shadow-none bg-[var(--card-bg)]">
      <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">{label}</p>
      {port && (
        <p className="text-sm font-bold" style={{ color: port.value >= 0 ? 'var(--pastel-green-text)' : 'var(--pastel-red-text)' }}>
          Portfolio: {port.value >= 0 ? '+' : ''}{port.value.toFixed(1)}%
        </p>
      )}
      {bench && (
        <p className="text-sm font-semibold text-slate-500">
          Benchmark: {bench.value >= 0 ? '+' : ''}{bench.value.toFixed(1)}%
        </p>
      )}
    </div>
  )
}

export default function AnnualReturnsChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}%`}
          width={48}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="square" formatter={(v) => <span className="text-xs font-medium capitalize">{v}</span>} />
        <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.2} />
        <Bar dataKey="portfolio" name="Portfolio" radius={0} maxBarSize={40}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.portfolio >= 0 ? 'var(--pastel-green-text)' : 'var(--pastel-red-text)'} fillOpacity={0.85} />
          ))}
        </Bar>
        <Bar dataKey="benchmark" name="Benchmark" fill="var(--chart-benchmark)" fillOpacity={0.5} radius={0} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  )
}
