import { Ban, Loader2, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Metrics, PerturbJob, PerturbJobSummary, PerturbRunResult, StrategyConfig } from '../../types'
import type { DetectedParam, PerturbPreset } from '../../utils/perturb'
import { buildPlan, detectParams } from '../../utils/perturb'
import { BAR_ACTIVE, TOOLTIP_PROPS } from './chartTheme'

interface Props {
  config: StrategyConfig
}

type MetricKey = 'cagr' | 'sharpe' | 'maxDrawdown'

const METRIC_OPTIONS: { key: MetricKey; label: string; digits: number; suffix: string }[] = [
  { key: 'cagr', label: 'CAGR', digits: 1, suffix: '%' },
  { key: 'sharpe', label: 'Sharpe', digits: 2, suffix: '' },
  { key: 'maxDrawdown', label: 'Max Drawdown', digits: 1, suffix: '%' },
]

const DEFAULT_COST_PER_RUN = 6

function fmt(v: number | null | undefined, digits = 1, suffix = '') {
  return v === null || v === undefined ? '—' : `${v.toFixed(digits)}${suffix}`
}

function metricOf(r: PerturbRunResult, key: MetricKey): number | null {
  const m: Metrics | undefined = r.metrics
  const v = m ? m[key] : null
  return v === null || v === undefined ? null : v
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

// ── Tornado ───────────────────────────────────────────────────────────────────

function TornadoChart({ rows, digits, suffix }: {
  rows: { label: string; min: number; max: number }[]
  digits: number
  suffix: string
}) {
  const maxAbs = Math.max(...rows.flatMap((r) => [Math.abs(r.min), Math.abs(r.max)]), 1e-9)
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const left = 50 + (Math.min(r.min, 0) / maxAbs) * 50
        const width = ((Math.max(r.max, 0) - Math.min(r.min, 0)) / maxAbs) * 50
        return (
          <div key={r.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-44 shrink-0 truncate text-[var(--text-muted)]" title={r.label}>{r.label}</span>
            <span className="w-14 shrink-0 text-right font-mono tabular-nums">{fmt(r.min, digits, suffix)}</span>
            <div className="relative h-4 flex-1 border border-[var(--border-color-light)] bg-[var(--paper-bg)]">
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-color)]" />
              <div
                className="absolute inset-y-0.5 bg-[var(--chart-portfolio)] opacity-70"
                style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
              />
            </div>
            <span className="w-14 shrink-0 font-mono tabular-nums">{fmt(r.max, digits, suffix)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function PerturbationsPanel({ config }: Props) {
  const [params, setParams] = useState<DetectedParam[]>(() => detectParams(config))
  // Bumped whenever detection reruns — remounts the uncontrolled candidate
  // inputs so their displayed text can't go stale against params state.
  const [paramsGen, setParamsGen] = useState(0)
  const [preset, setPreset] = useState<PerturbPreset>('tiny')
  const [jointCount, setJointCount] = useState(20)
  const [quotaFloor, setQuotaFloor] = useState(500)
  const [metricKey, setMetricKey] = useState<MetricKey>('cagr')
  const [job, setJob] = useState<PerturbJob | null>(null)
  const [jobs, setJobs] = useState<PerturbJobSummary[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quotaNow, setQuotaNow] = useState<number | null>(null)
  const [latestBaseConfig, setLatestBaseConfig] = useState<StrategyConfig | null>(null)
  const pollRef = useRef<number | null>(null)

  async function fetchJobs() {
    try {
      const r = await fetch('/api/perturb/jobs')
      if (r.ok) setJobs(await r.json())
    } catch { /* non-critical */ }
  }

  async function loadJob(jobId: string) {
    try {
      const r = await fetch(`/api/perturb/jobs/${jobId}`)
      if (!r.ok) throw new Error('Failed to load job')
      setJob(await r.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const plan = useMemo(
    () => buildPlan(config, params, preset, jointCount),
    [config, params, preset, jointCount]
  )

  const completedCosts = (job?.runs ?? [])
    .map((r) => r.costCredits ?? 0)
    .filter((c) => c > 0)
  const costPerRun = completedCosts.length
    ? completedCosts.reduce((a, b) => a + b, 0) / completedCosts.length
    : DEFAULT_COST_PER_RUN

  // Mirror the backend's baseline-reuse check (perturb_start): if the baseline
  // config is identical to the last completed job's, that run is free.
  const canon = (v: unknown): string => {
    const sortDeep = (x: any): any => {
      if (Array.isArray(x)) return x.map(sortDeep)
      if (x && typeof x === 'object') {
        return Object.keys(x).sort().reduce((acc: any, k) => {
          if (x[k] !== undefined) acc[k] = sortDeep(x[k])
          return acc
        }, {})
      }
      return x
    }
    return JSON.stringify(sortDeep(v))
  }
  const baselineReused =
    latestBaseConfig !== null && canon({ ...config, benchmark: undefined }) === canon(latestBaseConfig)
  const oatCount = plan.filter((r) => r.group === 'oat').length
  const jointPlanned = plan.filter((r) => r.group === 'joint').length
  const chargeableRuns = plan.length - (baselineReused ? 1 : 0)
  const estCredits = Math.round(chargeableRuns * costPerRun)
  const running = job?.state === 'running'

  async function fetchStatus() {
    try {
      const r = await fetch('/api/perturb/status')
      if (!r.ok) return
      const data: PerturbJob = await r.json()
      setJob(data.state === 'idle' ? null : data)
      if (data.quota?.quotaRemaining != null) setQuotaNow(data.quota.quotaRemaining)
      const base = data.runs?.find((x) => x.group === 'baseline')
      if (base?.config && base?.metrics) setLatestBaseConfig(base.config)
      if (data.state !== 'running' && pollRef.current !== null) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
        fetchJobs() // a job just finished — refresh the history list
      }
    } catch { /* transient */ }
  }

  // Attach to any running/persisted job on mount. This only READS state — a
  // perturbation job is never started implicitly.
  useEffect(() => {
    fetchStatus()
    fetchJobs()
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (running && pollRef.current === null) {
      pollRef.current = window.setInterval(fetchStatus, 3000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Params are positional (ruleIndex/occIndex into the rule formulas), so any
  // change to the rules, holdings, or rebalance — including switching
  // strategies — invalidates them. Re-detect, preserving the user's
  // enabled/candidates edits for params whose underlying rule is unchanged.
  const configFp = JSON.stringify([config.strategyId, config.buyRules, config.sellRules, config.holdings, config.rebalFreq])
  useEffect(() => {
    setParams((prev) =>
      detectParams(config).map((f) => {
        const old = prev.find((p) => p.key === f.key && p.baseValue === f.baseValue && p.context === f.context)
        return old ? { ...f, enabled: old.enabled, candidates: old.candidates } : f
      })
    )
    setParamsGen((g) => g + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configFp])

  // History is scoped to the active strategy; when the user switches
  // strategies, swap the displayed job for that strategy's most recent one
  // (a running job stays visible regardless — it occupies the engine).
  const scopedJobs = jobs.filter((j) => j.strategyId === config.strategyId)
  const jobStrategyId = job?.runs?.find((r) => r.group === 'baseline')?.config?.strategyId ?? null

  useEffect(() => {
    if (!job || running || jobStrategyId === null) return
    if (jobStrategyId !== config.strategyId) {
      const latest = jobs.find((j) => j.strategyId === config.strategyId)
      if (latest) loadJob(latest.jobId)
      else setJob(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.strategyId, jobs, jobStrategyId, running])

  async function start() {
    const msg =
      `Run ${plan.length} backtests (1 baseline${baselineReused ? ' — reused, free' : ''} + ${plan.length - 1} perturbations) on the shadow sim?\n\n` +
      `Estimated cost: ~${estCredits} API credits. The job stops automatically if remaining quota drops below ${quotaFloor}.`
    if (!window.confirm(msg)) return
    setStarting(true)
    setError(null)
    try {
      const resp = await fetch('/api/perturb/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotaFloor,
          runs: plan.map((r) => ({ ...r, config: { ...r.config, benchmark: undefined } })),
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Failed to start perturbation job')
      }
      await fetchStatus()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setStarting(false)
    }
  }

  async function cancel() {
    try { await fetch('/api/perturb/cancel', { method: 'POST' }) } catch { /* ignore */ }
    fetchStatus()
  }

  function updateParam(key: string, patch: Partial<DetectedParam>) {
    setParams((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  function parseCandidates(p: DetectedParam, text: string) {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
    const cands = p.kind === 'numeric'
      ? parts.map(Number).filter((n) => Number.isFinite(n) && n !== p.baseValue)
      : parts.filter((s) => s !== p.baseValue)
    updateParam(p.key, { candidates: cands })
  }

  // ── Result analytics ────────────────────────────────────────────────────────

  const metricOpt = METRIC_OPTIONS.find((m) => m.key === metricKey)!
  const okRuns = (job?.runs ?? []).filter((r) => r.metrics && !r.error)
  const baseline = okRuns.find((r) => r.group === 'baseline') ?? null
  const baseMetric = baseline ? metricOf(baseline, metricKey) : null
  const variants = okRuns.filter((r) => r.group !== 'baseline' && metricOf(r, metricKey) !== null)

  // Labels come from the job's own runs (label format "Buy1 · 90 → 85"), not
  // the currently-loaded strategy's params — an archived job may belong to a
  // different strategy than the one selected in the form.
  const paramLabel = (runsOfParam: PerturbRunResult[], key: string) =>
    runsOfParam[0]?.label.split(' → ')[0] ?? key

  const tornadoRows = useMemo(() => {
    if (baseMetric === null) return []
    const byParam = new Map<string, { deltas: number[]; runs: PerturbRunResult[] }>()
    for (const r of variants) {
      if (r.group !== 'oat' || !r.param) continue
      const v = metricOf(r, metricKey)
      if (v === null) continue
      const entry = byParam.get(r.param) ?? { deltas: [], runs: [] }
      entry.deltas.push(v - baseMetric)
      entry.runs.push(r)
      byParam.set(r.param, entry)
    }
    return [...byParam.entries()]
      .map(([key, { deltas, runs }]) => ({
        label: paramLabel(runs, key),
        min: Math.min(...deltas, 0),
        max: Math.max(...deltas, 0),
      }))
      .sort((a, b) => (b.max - b.min) - (a.max - a.min))
  }, [variants, baseMetric, metricKey])

  const plateaus = useMemo(() => {
    if (baseMetric === null || baseline === null) return []
    const byParam = new Map<string, { pts: { x: number; y: number }[]; runs: PerturbRunResult[] }>()
    for (const r of variants) {
      if (r.group !== 'oat' || !r.param || typeof r.value === 'string' || r.value === null || r.value === undefined) continue
      const y = metricOf(r, metricKey)
      if (y === null) continue
      const entry = byParam.get(r.param) ?? { pts: [], runs: [] }
      entry.pts.push({ x: Number(r.value), y })
      entry.runs.push(r)
      byParam.set(r.param, entry)
    }
    return [...byParam.entries()]
      .map(([key, { pts, runs }]) => {
        // Prefer the structured base value stored on the run; fall back to
        // parsing it out of the label for jobs archived before `base` existed
        // ("Buy 1: [90] → 85" or the older "Buy1 · 90 → 85").
        const label = paramLabel(runs, key)
        const stored = runs.find((r) => r.base !== undefined && r.base !== null)?.base
        const base = stored !== undefined
          ? Number(stored)
          : Number(label.match(/\[([^\]]+)\]/)?.[1] ?? label.split('·')[1]?.trim())
        const hasBase = Number.isFinite(base)
        const data = [...pts, ...(hasBase ? [{ x: base, y: baseMetric }] : [])].sort((a, b) => a.x - b.x)
        return { key, label, data, base: hasBase ? base : null }
      })
      .filter((p) => p.data.length >= 3)
  }, [variants, baseline, baseMetric, metricKey])

  const histogram = useMemo(() => {
    if (baseMetric === null || variants.length < 3) return null
    const vals = variants.map((r) => metricOf(r, metricKey)!).sort((a, b) => a - b)
    const lo = Math.min(...vals, baseMetric)
    const hi = Math.max(...vals, baseMetric)
    const span = hi - lo || 1
    const nbins = Math.min(12, Math.max(6, Math.round(Math.sqrt(vals.length) * 2)))
    const bins = Array.from({ length: nbins }, (_, i) => ({
      bin: lo + span * ((i + 0.5) / nbins),
      count: 0,
    }))
    for (const v of vals) {
      const i = Math.min(nbins - 1, Math.floor(((v - lo) / span) * nbins))
      bins[i].count += 1
    }
    const below = vals.filter((v) => v <= baseMetric).length
    const percentile = Math.round((below / vals.length) * 100)
    return { bins, percentile, lo: lo - span * 0.05, hi: hi + span * 0.05 }
  }, [variants, baseMetric, metricKey])

  const scatterData = variants
    .filter((r) => metricOf(r, 'cagr') !== null && metricOf(r, 'maxDrawdown') !== null)
    .map((r) => ({
      label: r.label,
      cagr: metricOf(r, 'cagr')!,
      maxDD: metricOf(r, 'maxDrawdown')!,
      sharpe: metricOf(r, 'sharpe'),
    }))
  const scatterBase = baseline && metricOf(baseline, 'cagr') !== null && metricOf(baseline, 'maxDrawdown') !== null
    ? [{ label: 'Baseline', cagr: metricOf(baseline, 'cagr')!, maxDD: metricOf(baseline, 'maxDrawdown')!, sharpe: metricOf(baseline, 'sharpe') }]
    : []

  const failedRuns = (job?.runs ?? []).filter((r) => r.error)
  const spentCredits = completedCosts.reduce((a, b) => a + b, 0)

  const verdict = histogram === null ? null
    : histogram.percentile >= 90
      ? { tone: 'bad' as const, text: 'Baseline outperforms ≥90% of its neighborhood — the exact thresholds look optimized. Treat the backtest edge with suspicion.' }
      : histogram.percentile >= 70
        ? { tone: undefined, text: 'Baseline is in the upper part of its neighborhood — some threshold-fitting likely, but not extreme.' }
        : { tone: 'good' as const, text: 'Baseline sits inside the body of its neighborhood — performance comes from a plateau, not a fitted peak.' }

  const ScatterTip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="border border-[var(--border-color)] bg-[var(--card-bg)] p-2 text-xs">
        <p className="font-semibold">{d.label}</p>
        <p>CAGR: <span className="font-mono">{fmt(d.cagr, 1, '%')}</span></p>
        <p>Max DD: <span className="font-mono">{fmt(d.maxDD, 1, '%')}</span></p>
        <p>Sharpe: <span className="font-mono">{fmt(d.sharpe, 2)}</span></p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-[var(--text-muted)]">
        Is the strategy a plateau or a fitted peak? Each perturbation reruns the full backtest on the
        shadow sim with one (or all) parameters nudged. <span className="font-semibold">Each run costs
        API credits — nothing starts until you click Run.</span>
      </p>

      {/* Parameter table */}
      <details open={!job}>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Parameters ({params.filter((p) => p.enabled).length} of {params.length} enabled)
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setParams(detectParams(config)); setParamsGen((g) => g + 1) }}
            className="ml-3 inline-flex items-center gap-1 text-[10px] font-normal normal-case underline underline-offset-2"
          >
            <RotateCcw size={10} /> re-detect from config
          </button>
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color-light)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="py-1.5 pr-2 font-semibold">On</th>
                <th className="py-1.5 pr-3 font-semibold">Parameter</th>
                <th className="py-1.5 pr-3 font-semibold">Context</th>
                <th className="py-1.5 pr-3 font-semibold">Base</th>
                <th className="py-1.5 font-semibold">Candidate values (comma-separated)</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key} className="border-b border-[var(--border-color-light)]">
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" checked={p.enabled}
                           onChange={(e) => updateParam(p.key, { enabled: e.target.checked })} />
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap font-semibold">{p.label}</td>
                  <td className="py-1.5 pr-3" title={p.context}>
                    <div className="max-w-[320px] overflow-x-auto whitespace-nowrap font-mono text-[11px] text-[var(--text-muted)] [scrollbar-width:thin]">
                      {p.context}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">{String(p.baseValue)}</td>
                  <td className="py-1.5">
                    <input
                      key={`${paramsGen}:${p.key}`}
                      type="text"
                      defaultValue={p.candidates.join(', ')}
                      onBlur={(e) => parseCandidates(p, e.target.value)}
                      disabled={!p.enabled}
                      className="select-base w-full min-w-[220px] !py-1 font-mono text-[11px] disabled:opacity-40"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Run plan & cost */}
      <div className="border border-[var(--border-color-light)] p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label mb-1">Preset</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value as PerturbPreset)} className="select-base w-56">
              <option value="tiny">Tiny test (pipeline check)</option>
              <option value="oat">Full one-at-a-time</option>
              <option value="oat+joint">Full + joint samples</option>
            </select>
          </div>
          {preset === 'oat+joint' && (
            <div>
              <label className="label mb-1">Joint samples</label>
              <input type="number" min={5} max={100} value={jointCount}
                     onChange={(e) => setJointCount(Math.max(5, Math.min(100, Number(e.target.value) || 20)))}
                     className="select-base w-24" />
            </div>
          )}
          <div>
            <label className="label mb-1">Halt if credits fall below</label>
            <input type="number" min={0} value={quotaFloor}
                   onChange={(e) => setQuotaFloor(Math.max(0, Number(e.target.value) || 0))}
                   className="select-base w-28" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-color-light)] pt-3">
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold">
              {plan.length} runs — 1 baseline{baselineReused ? ' (reused, free)' : ''}
              {oatCount > 0 && <> + {oatCount} one-at-a-time</>}
              {jointPlanned > 0 && <> + {jointPlanned} joint</>}
            </p>
            <p className="text-[var(--text-muted)]">
              est. ~{estCredits} credits at {costPerRun.toFixed(1)}/run
              {completedCosts.length > 0 ? ' (measured)' : ' (default)'}
              {quotaNow != null && (
                <> · {quotaNow.toLocaleString()} → ~{Math.max(0, quotaNow - estCredits).toLocaleString()} remaining</>
              )}
            </p>
          </div>
          {running ? (
            <button type="button" onClick={cancel} className="btn-primary py-1.5">
              <Ban size={13} strokeWidth={2.5} /> Cancel
            </button>
          ) : (
            <button type="button" onClick={start} disabled={starting || plan.length < 2} className="btn-primary py-1.5">
              {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} strokeWidth={2.5} />}
              Run Perturbations
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-[var(--pastel-red-text)]">{error}</p>}

      {/* Progress */}
      {job && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="font-semibold">
              {running ? 'Running…' :
               job.state === 'done' ? 'Complete' :
               job.state === 'cancelled' ? 'Cancelled' :
               job.state === 'halted_quota' ? 'Halted — quota floor reached' :
               job.interrupted ? 'Interrupted (server restarted)' : 'Stopped on repeated errors'}
            </span>
            <span className="text-[var(--text-muted)]">{job.completed ?? 0} / {job.total ?? 0} runs</span>
            {spentCredits > 0 && <span className="text-[var(--text-muted)]">{spentCredits} credits spent</span>}
            {job.quotaRemaining != null && <span className="text-[var(--text-muted)]">{job.quotaRemaining.toLocaleString()} remaining</span>}
          </div>
          <div className="h-1.5 w-full bg-[var(--paper-bg)] border border-[var(--border-color-light)]">
            <div className="h-full bg-[var(--chart-portfolio)] transition-all"
                 style={{ width: `${((job.completed ?? 0) / Math.max(1, job.total ?? 1)) * 100}%` }} />
          </div>
          {failedRuns.length > 0 && (
            <p className="text-[11px] text-[var(--pastel-red-text)]">
              {failedRuns.length} run{failedRuns.length > 1 ? 's' : ''} failed — first error: {failedRuns[0].error}
            </p>
          )}
        </div>
      )}

      {/* Job history — scoped to the active strategy */}
      {scopedJobs.length > 0 && !running && (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1 max-w-xl">
            <label className="label mb-1">Viewing job ({scopedJobs[0]?.strategy ?? 'this strategy'})</label>
            <select
              value={job?.jobId ?? ''}
              onChange={(e) => e.target.value && loadJob(e.target.value)}
              className="select-base w-full"
            >
              {job?.jobId && !scopedJobs.some((j) => j.jobId === job.jobId) && (
                <option value={job.jobId}>current job</option>
              )}
              {scopedJobs.map((j) => (
                <option key={j.jobId} value={j.jobId}>
                  {(j.startedAt ?? '').slice(0, 16).replace('T', ' ')} · {j.total} runs · {j.params.length} params · {j.window}
                  {j.baselineCagr != null ? ` · base ${j.baselineCagr.toFixed(1)}%` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Results */}
      {baseline && variants.length > 0 && (
        <>
          <div className="flex items-end justify-between gap-4">
            <div>
              <label className="label mb-1">Metric</label>
              <select value={metricKey} onChange={(e) => setMetricKey(e.target.value as MetricKey)} className="select-base w-40">
                {METRIC_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label={`Baseline ${metricOpt.label}`} value={fmt(baseMetric, metricOpt.digits, metricOpt.suffix)} />
              <Stat label="Neighborhood percentile" value={histogram ? `${histogram.percentile}th` : '—'}
                    tone={verdict?.tone} />
            </div>
          </div>

          {verdict && (
            <p className={`text-xs ${verdict.tone === 'bad' ? 'text-[var(--pastel-red-text)]'
              : verdict.tone === 'good' ? 'text-[var(--pastel-green-text)]' : 'text-[var(--text-muted)]'}`}>
              {verdict.text}
            </p>
          )}

          {/* Tornado */}
          {tornadoRows.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                Sensitivity — change in {metricOpt.label} vs. baseline across each parameter's tested values
              </p>
              <TornadoChart rows={tornadoRows} digits={metricOpt.digits} suffix={metricOpt.suffix} />
            </div>
          )}

          {/* Plateau small multiples */}
          {plateaus.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                Parameter plateaus — {metricOpt.label} across each parameter's values (dot = baseline, dashed line = baseline {metricOpt.label}). Flat tops are good; cliffs are overfitting.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {plateaus.map((pl) => (
                  <div key={pl.key}>
                    <p className="mb-1 truncate text-[11px] font-semibold" title={pl.label}>{pl.label}</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={pl.data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="1 5" />
                        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} />
                        <YAxis width={40} tick={{ fontSize: 10 }} domain={['auto', 'auto']}
                               tickFormatter={(v: number) => v.toFixed(metricOpt.digits)} />
                        <Tooltip
                          {...TOOLTIP_PROPS}
                          formatter={(v: number) => [`${v.toFixed(metricOpt.digits)}${metricOpt.suffix}`, metricOpt.label]}
                          labelFormatter={(v: number) => `value = ${v}`}
                        />
                        {baseMetric !== null && (
                          <ReferenceLine y={baseMetric} stroke="var(--chart-portfolio)" strokeDasharray="4 3" strokeOpacity={0.55} />
                        )}
                        {pl.base !== null && (
                          <ReferenceLine x={pl.base} stroke="var(--chart-portfolio)" strokeDasharray="4 3" strokeOpacity={0.55} />
                        )}
                        <Line dataKey="y" stroke="var(--chart-portfolio)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                        {pl.base !== null && baseMetric !== null && (
                          <ReferenceDot x={pl.base} y={baseMetric} r={5} fill="var(--chart-portfolio)" stroke="var(--card-bg)" strokeWidth={2} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Histogram + scatter */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {histogram && (
              <div>
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  Neighborhood distribution of {metricOpt.label} ({variants.length} variants) — line = baseline
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={histogram.bins} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                    <XAxis dataKey="bin" type="number" domain={[histogram.lo, histogram.hi]}
                           tickFormatter={(v: number) => `${v.toFixed(metricOpt.digits)}`} tick={{ fontSize: 10 }} />
                    <YAxis hide />
                    <Tooltip
                      {...TOOLTIP_PROPS}
                      cursor={false}
                      formatter={(v: number) => [`${v} variants`, 'Count']}
                      labelFormatter={(v: number) => `${metricOpt.label} ≈ ${v.toFixed(metricOpt.digits)}${metricOpt.suffix}`}
                    />
                    <Bar dataKey="count" fill="var(--chart-benchmark)" isAnimationActive={false} activeBar={BAR_ACTIVE} />
                    {baseMetric !== null && (
                      <ReferenceLine x={baseMetric} stroke="var(--chart-portfolio)" strokeWidth={2}
                                     label={{ value: 'Baseline', fontSize: 10, position: 'top' }} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {scatterData.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  Risk / return of every variant — CAGR vs. max drawdown (large dot = baseline)
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <ScatterChart margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                    <CartesianGrid strokeDasharray="1 5" />
                    <XAxis dataKey="maxDD" type="number" name="Max DD" domain={['auto', 'auto']}
                           tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10 }} />
                    <YAxis dataKey="cagr" type="number" name="CAGR" width={44} domain={['auto', 'auto']}
                           tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10 }} />
                    <Tooltip content={<ScatterTip />} />
                    <Scatter data={scatterData} fill="var(--chart-benchmark)" isAnimationActive={false} />
                    <Scatter data={scatterBase} fill="var(--chart-portfolio)" shape="circle" isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Run table */}
          <details>
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              All runs ({(job?.runs ?? []).length})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color-light)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="py-1.5 pr-3 font-semibold">Run</th>
                    <th className="py-1.5 pr-3 font-semibold">CAGR</th>
                    <th className="py-1.5 pr-3 font-semibold">Sharpe</th>
                    <th className="py-1.5 pr-3 font-semibold">Max DD</th>
                    <th className="py-1.5 pr-3 font-semibold">Turnover</th>
                    <th className="py-1.5 font-semibold">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {(job?.runs ?? []).map((r) => (
                    <tr key={r.id} className={`border-b border-[var(--border-color-light)] ${r.group === 'baseline' ? 'font-bold' : ''}`}>
                      <td className="py-1.5 pr-3 max-w-[320px] truncate" title={r.label}>
                        {r.label}
                        {r.reused && <span className="ml-2 text-[var(--text-muted)]">(reused — 0 credits)</span>}
                        {r.error && <span className="ml-2 text-[var(--pastel-red-text)]" title={r.error}>failed</span>}
                      </td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(metricOf(r, 'cagr'), 1, '%')}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(metricOf(r, 'sharpe'), 2)}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(metricOf(r, 'maxDrawdown'), 1, '%')}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(r.metrics?.turnover ?? null, 0, '%')}</td>
                      <td className="py-1.5 font-mono tabular-nums">{r.costCredits ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
