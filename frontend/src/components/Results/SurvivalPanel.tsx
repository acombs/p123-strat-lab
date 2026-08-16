import { useEffect, useState } from 'react'
import type { SurvivalStats, TrialsInfo } from '../../types'

interface Props {
  survival: SurvivalStats
  strategyId: number
}

function fmt(v: number | null | undefined, d = 2, suffix = '') {
  return v == null ? '—' : v.toFixed(d) + suffix
}

function pct(v: number | null | undefined) {
  return v == null ? '—' : (v * 100).toFixed(0) + '%'
}

/**
 * Statistical survival: is the headline Sharpe distinguishable from noise once
 * its standard error and the number of configurations tried are accounted for?
 * Everything here is arithmetic on the daily equity curve — zero API credits.
 */
export default function SurvivalPanel({ survival, strategyId }: Props) {
  const [trials, setTrials] = useState<TrialsInfo | null>(null)
  const [extraInput, setExtraInput] = useState('')
  const [live, setLive] = useState<SurvivalStats>(survival)
  const [busy, setBusy] = useState(false)

  // Fresh result → reset the live block to what the backend computed.
  useEffect(() => setLive(survival), [survival])

  useEffect(() => {
    fetch(`/api/strategies/${strategyId}/trials`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t: TrialsInfo | null) => {
        if (t) {
          setTrials(t)
          setExtraInput(String(t.extra))
        }
      })
      .catch(() => {})
  }, [strategyId, survival])

  async function recompute(total: number) {
    const r = await fetch('/api/survival/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srDaily: survival.srDaily,
        n: survival.n,
        skew: survival.skew ?? 0,
        kurt: survival.kurt ?? 3,
        trials: total,
      }),
    })
    if (r.ok) {
      const d = await r.json()
      setLive((prev) => ({ ...prev, ...d }))
    }
  }

  async function saveExtra() {
    const extra = Math.max(0, parseInt(extraInput || '0', 10) || 0)
    setBusy(true)
    try {
      const r = await fetch(`/api/strategies/${strategyId}/trials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra }),
      })
      if (r.ok) {
        const t: TrialsInfo = await r.json()
        setTrials(t)
        await recompute(t.total)
      }
    } finally {
      setBusy(false)
    }
  }

  async function resetRuns() {
    if (!confirm('Reset the app-counted trials for this strategy to zero?')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/strategies/${strategyId}/trials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
      if (r.ok) {
        const t: TrialsInfo = await r.json()
        setTrials(t)
        await recompute(t.total)
      }
    } finally {
      setBusy(false)
    }
  }

  const dsr = live.dsr
  const dsrClass = dsr == null ? 'neutral' : dsr >= 0.95 ? 'positive' : dsr >= 0.5 ? 'neutral' : 'negative'
  const psrClass = live.psr == null ? 'neutral' : live.psr >= 0.95 ? 'positive' : 'neutral'
  const be = live.breakevenBps
  const beClass = be == null ? 'neutral' : be >= 50 ? 'positive' : be >= 15 ? 'neutral' : 'negative'
  const overTried =
    live.maxTrialsForLength != null && live.trials > live.maxTrialsForLength

  return (
    <div className="flex flex-col gap-3 mt-4">
      <div className="flex items-center justify-between border-b pb-2 border-[var(--border-color-light)]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] px-1">
          Statistical Survival
        </h3>
        <span className="text-[10px] text-[var(--text-muted)] px-1">
          {live.years.toFixed(1)}y · {live.n} days · 0 credits
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="metric-card">
          <span className="metric-label">Sharpe 95% CI</span>
          <span className="metric-value neutral">
            {fmt(live.sharpeCiLo)} – {fmt(live.sharpeCiHi)}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            computed {fmt(live.sharpeComputed)} ± {fmt(live.sharpeSE)} (Lo 2002)
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">P(Sharpe &gt; 0)</span>
          <span className={`metric-value ${psrClass}`}>{pct(live.psr)}</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {live.minTrackRecordYears != null
              ? `needs ${fmt(live.minTrackRecordYears, 1)}y to confirm at 95%`
              : 'not distinguishable from zero'}
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Deflated Sharpe</span>
          <span className={`metric-value ${dsrClass}`}>{pct(dsr)}</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            after {live.trials} trial{live.trials === 1 ? '' : 's'} · noise alone ≈ {fmt(live.expectedMaxSharpe)}
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Break-even Cost</span>
          <span className={`metric-value ${beClass}`}>{fmt(be, 0, ' bps')}</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            round-trip, from CAGR ÷ 2×turnover
          </span>
        </div>
      </div>

      <div className="card p-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span>
            <b>Trials:</b> {trials ? trials.runs : '…'} run here
            {trials && trials.extra > 0 ? ` + ${trials.extra} elsewhere` : ''} ={' '}
            <b>{live.trials}</b>
            {live.maxTrialsForLength != null && (
              <> · this backtest length supports ≤ <b>{live.maxTrialsForLength}</b></>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <label className="whitespace-nowrap">tried elsewhere</label>
            <input
              className="input-base w-16 text-[11px] py-0.5"
              type="number"
              min={0}
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              onBlur={saveExtra}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              disabled={busy}
            />
            <button className="btn-ghost text-[11px] py-0.5 px-2" onClick={resetRuns} disabled={busy}>
              reset
            </button>
          </span>
        </div>
        {overTried && (
          <p className="mt-1.5 text-[var(--pastel-red-text)]">
            More configurations were tried than {live.years.toFixed(0)} years of data can support at
            this Sharpe — the best-of-N result is expected from noise. Lengthen the window or stop
            searching.
          </p>
        )}
        {live.ar1 != null && Math.abs(live.ar1) > 0.15 && (
          <p className="mt-1.5">
            Daily returns show autocorrelation (AR1 {fmt(live.ar1)}); √252 annualisation overstates
            the Sharpe.
          </p>
        )}
        <p className="mt-1.5">
          Every backtest and perturbation variant run here counts as a trial. Add the ones you made in
          the P123 UI or elsewhere — the deflated Sharpe is only as honest as this number.
        </p>
      </div>
    </div>
  )
}
