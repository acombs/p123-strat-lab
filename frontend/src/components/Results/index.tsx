import { useState } from 'react'
import type { BacktestResult } from '../../types'
import Spinner from '../Spinner'
import AnnualReturnsChart from './AnnualReturnsChart'
import DrawdownChart from './DrawdownChart'
import EquityChart from './EquityChart'
import MetricsGrid from './MetricsGrid'
import RollingChart from './RollingChart'
import TradesPanel from './TradesPanel'
import MonteCarloPanel from './MonteCarloPanel'
import RobustnessPanel from './RobustnessPanel'

interface Props {
  result: BacktestResult | null
  loading: boolean
}

type ChartTab = 'equity' | 'drawdown' | 'rolling-sharpe' | 'rolling-returns' | 'annual' | 'monte-carlo' | 'robustness' | 'trades'

const TABS: { key: ChartTab; label: string }[] = [
  { key: 'equity', label: 'Equity Curve' },
  { key: 'drawdown', label: 'Drawdown' },
  { key: 'rolling-sharpe', label: 'Rolling Sharpe' },
  { key: 'rolling-returns', label: 'Rolling Returns' },
  { key: 'annual', label: 'Annual Returns' },
  { key: 'monte-carlo', label: 'Monte Carlo' },
  { key: 'robustness', label: 'Robustness' },
  { key: 'trades', label: 'Trades' },
]

export default function Results({ result, loading }: Props) {
  const [activeTab, setActiveTab] = useState<ChartTab>('equity')

  if (loading) {
    return (
      <div className="card flex min-h-[480px] items-center justify-center p-12">
        <Spinner size={56} />
      </div>
    )
  }

  if (!result) {
    return (
      <div className="card flex min-h-[480px] flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-none bg-[var(--paper-bg)] text-[var(--text-muted)] border border-[var(--border-color)]">
          <svg className="h-8 w-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-[var(--text-main)]">
            No results yet
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Configure your strategy and click Run Backtest
          </p>
        </div>
      </div>
    )
  }

  const { equityCurve, annualReturns, metrics } = result

  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
      {/* Left: Charts card */}
      <div className="card overflow-hidden flex flex-col justify-between">
        <div>
          {/* Tab bar */}
          <div className="flex overflow-x-auto border-b border-[var(--border-color-light)] bg-[var(--paper-bg)]">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={activeTab === key ? 'tab-btn-active' : 'tab-btn'}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Chart area */}
          <div className="p-4">
            {activeTab === 'equity' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Log-scale equity curve — $100,000 initial investment</p>
                <EquityChart data={equityCurve} />
              </div>
            )}
            {activeTab === 'drawdown' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Underwater curve — drawdown from rolling peak (%)</p>
                <DrawdownChart data={equityCurve} />
              </div>
            )}
            {activeTab === 'rolling-sharpe' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Rolling 52-week Sharpe ratio — dashed line at 1.0</p>
                <RollingChart data={equityCurve} mode="sharpe" />
              </div>
            )}
            {activeTab === 'rolling-returns' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Rolling 52-week return vs. benchmark (%)</p>
                <RollingChart data={equityCurve} mode="returns" />
              </div>
            )}
            {activeTab === 'annual' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Calendar-year returns — portfolio vs. benchmark</p>
                <AnnualReturnsChart data={annualReturns} />
              </div>
            )}
            {activeTab === 'monte-carlo' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">
                  What could the future look like if returns resemble this backtest? Block-bootstrapped paths from the daily returns.
                </p>
                <MonteCarloPanel curve={equityCurve} simId={result.runSimId} />
              </div>
            )}
            {activeTab === 'robustness' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">
                  Start-date sensitivity — every possible investment window inside the backtest
                </p>
                <RobustnessPanel curve={equityCurve} />
              </div>
            )}
            {activeTab === 'trades' && (
              <div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">
                  Transactions recorded by the simulation run
                </p>
                {result.runSimId && equityCurve.length > 1 ? (
                  <TradesPanel
                    simId={result.runSimId}
                    start={equityCurve[0].date}
                    end={equityCurve[equityCurve.length - 1].date}
                  />
                ) : (
                  <p className="py-6 text-center text-sm text-[var(--text-muted)]">
                    Trades are available after running a backtest.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Metrics sidebar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between border-b pb-2 border-[var(--border-color-light)]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] px-1">
            Performance Metrics
          </h3>
        </div>
        <div className="flex-1 pr-1">
          <MetricsGrid metrics={metrics} />
        </div>
      </div>
    </div>
  )
}
