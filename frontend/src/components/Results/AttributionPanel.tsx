import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AttributionResult, EquityCurvePoint } from '../../types'

interface Props {
  curve: EquityCurvePoint[]
}

const FACTOR_HELP: Record<string, string> = {
  'Mkt-RF': 'market beta',
  SMB: 'size (small − big)',
  HML: 'value (high − low B/M)',
  RMW: 'profitability (robust − weak)',
  CMA: 'investment (conservative − aggressive)',
  Mom: 'momentum (winners − losers)',
}

function tClass(t: number | null) {
  if (t == null) return ''
  return Math.abs(t) >= 2.58 ? 'font-bold' : Math.abs(t) >= 1.96 ? 'font-semibold' : 'opacity-60'
}

/**
 * Fama-French factor attribution: regress the backtest's daily excess returns on
 * CAPM / FF3 / Carhart-4 / FF5 / FF5+Mom (Ken French data, Newey-West t-stats).
 * The question is not "did it make money" but "did it make money after paying for
 * exposures you could have bought for a few basis points". Zero P123 credits.
 */
export default function AttributionPanel({ curve }: Props) {
  const [res, setRes] = useState<AttributionResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run(refresh = false) {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch('/api/attribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equityCurve: curve, refresh }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: 'Attribution failed' }))
        throw new Error(e.detail || 'Attribution failed')
      }
      setRes(await r.json())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setRes(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (curve.length > 60) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-muted)]">
        <Loader2 size={14} className="animate-spin" /> Regressing on Fama-French factors…
      </div>
    )
  }
  if (err) {
    return (
      <div className="text-sm text-[var(--pastel-red-text)] py-4">
        {err}
        <button className="btn-ghost text-xs ml-3" onClick={() => run(true)}>Retry (refresh factors)</button>
      </div>
    )
  }
  if (!res) return null

  const richest = res.models[res.models.length - 1]
  const capm = res.models[0]
  const mktBeta = richest.loadings.find((l) => l.factor === 'Mkt-RF')?.beta ?? null
  const bigLoads = richest.loadings.filter((l) => l.t != null && Math.abs(l.t) >= 1.96 && l.factor !== 'Mkt-RF')

  return (
    <div className="flex flex-col gap-4">
      {/* Verdict */}
      <div className={`card p-4 border-l-4 ${res.alphaSurvives ? 'border-l-[var(--pastel-green-text)]' : 'border-l-[var(--pastel-red-text)]'}`}>
        <div className="text-sm font-semibold">
          {res.alphaSurvives
            ? `Alpha survives ${res.richestModel}: ${richest.alphaAnn.toFixed(1)}%/yr (t = ${richest.alphaT?.toFixed(2)})`
            : `No significant alpha against ${res.richestModel}: ${richest.alphaAnn.toFixed(1)}%/yr (t = ${richest.alphaT?.toFixed(2) ?? '—'})`}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
          {res.alphaSurvives
            ? 'The return is not explained by market, size, value, profitability, investment or momentum exposure. Move the conversation to costs and implementation.'
            : 'The excess return is largely explained by factor exposures you could hold cheaply. That is not nothing — but it is beta in a costume, and the discussion should be about cost and implementation, not signal.'}
          {capm.alphaT != null && Math.abs(capm.alphaT) >= 1.96 && !res.alphaSurvives && (
            <> CAPM alone showed {capm.alphaAnn.toFixed(1)}%/yr "alpha" — that is what the richer models absorbed.</>
          )}
          {mktBeta != null && (mktBeta > 1.15 || mktBeta < 0.85) && (
            <> Market beta is {mktBeta.toFixed(2)}, so a plain benchmark comparison {mktBeta > 1 ? 'flatters' : 'penalises'} it.</>
          )}
          {bigLoads.length > 0 && (
            <> Significant tilts: {bigLoads.map((l) => `${l.factor} ${l.beta > 0 ? '+' : ''}${l.beta.toFixed(2)}`).join(', ')}.</>
          )}
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color-light)]">
              <th className="py-1.5 pr-3">Model</th>
              <th className="py-1.5 pr-3 text-right">α (ann)</th>
              <th className="py-1.5 pr-3 text-right">t(α)</th>
              <th className="py-1.5 pr-3 text-right">R²</th>
              <th className="py-1.5">Loadings (β, t)</th>
            </tr>
          </thead>
          <tbody>
            {res.models.map((m) => (
              <tr key={m.model} className="border-b border-[var(--border-color-light)] align-top">
                <td className="py-2 pr-3 font-semibold whitespace-nowrap">{m.model}</td>
                <td className={`py-2 pr-3 text-right ${m.alphaAnn > 0 ? 'positive' : 'negative'}`}>
                  {m.alphaAnn > 0 ? '+' : ''}{m.alphaAnn.toFixed(2)}%
                </td>
                <td className={`py-2 pr-3 text-right ${tClass(m.alphaT)}`}>{m.alphaT?.toFixed(2) ?? '—'}</td>
                <td className="py-2 pr-3 text-right">{m.r2.toFixed(3)}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {m.loadings.map((l) => (
                      <span key={l.factor} title={FACTOR_HELP[l.factor]} className={tClass(l.t)}>
                        {l.factor} {l.beta > 0 ? '+' : ''}{l.beta.toFixed(2)}
                        <span className="text-[var(--text-muted)]"> ({l.t?.toFixed(1) ?? '—'})</span>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
        {res.n} daily obs ({res.startDate} → {res.endDate}, {res.years}y), Newey-West HAC t-stats; bold = |t| ≥ 2.58,
        semibold ≥ 1.96. Factors: Ken French daily library, data through {res.factorData.lastDate}
        {res.factorData.ageDays != null && ` (cached ${res.factorData.ageDays}d ago)`}
        {res.unmatchedDays > 0 && ` — ${res.unmatchedDays} backtest day${res.unmatchedDays === 1 ? '' : 's'} after that date excluded`}.
        {res.factorData.refreshError && ` Refresh failed (${res.factorData.refreshError}); using cached copy.`}
        {' '}Alpha is annualised (×252). Beta and factor exposures are cheap to buy; alpha is not.
      </p>
    </div>
  )
}
