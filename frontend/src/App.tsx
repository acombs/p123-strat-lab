import { useEffect, useState } from 'react'
import Header from './components/Header'
import StrategyForm, { hasUnsavedChanges } from './components/StrategyForm'
import Results from './components/Results'
import SavedStrategies from './components/SavedStrategies'
import ManageStrategiesModal from './components/ManageStrategiesModal'
import ManageUniversesModal from './components/ManageUniversesModal'
import ManageRankingSystemsModal from './components/ManageRankingSystemsModal'
import SettingsModal from './components/SettingsModal'
import RunHistoryModal from './components/RunHistoryModal'
import { MAX_START_DATE } from './components/StrategyForm/DateRangePicker'
import type {
  BacktestResult, QuotaInfo, RunHistoryEntry, SavedStrategy,
  StrategyConfig, StrategyOption, SelectOption, RuleItem,
} from './types'

export function normalizeConfig(cfg: any): StrategyConfig {
  const normalizeRule = (r: any): RuleItem => {
    if (typeof r === 'string') {
      return { formula: r, disabled: false }
    }
    return {
      formula: r?.formula ?? '',
      disabled: !!r?.disabled
    }
  }
  return {
    ...cfg,
    buyRules: Array.isArray(cfg.buyRules) ? cfg.buyRules.map(normalizeRule) : [{ formula: '', disabled: false }],
    sellRules: Array.isArray(cfg.sellRules) ? cfg.sellRules.map(normalizeRule) : [{ formula: '', disabled: false }]
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const DEFAULT_CONFIG: StrategyConfig = {
  strategyId: 0,
  universe: 'SP500',
  rankingSystem: '',
  buyRules: [{ formula: '', disabled: false }],
  sellRules: [{ formula: '', disabled: false }],
  holdings: 15,
  rebalFreq: 'Every Week',
  startDate: MAX_START_DATE,
  endDate: today(),
  benchmark: 'SPY',
}

const HISTORY_KEY = 'p123_run_history'
const HISTORY_LIMIT = 20

function loadHistory(): RunHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') }
  catch { return [] }
}

export default function App() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [config, setConfig] = useState<StrategyConfig>(DEFAULT_CONFIG)
  const [baselineConfig, setBaselineConfig] = useState<StrategyConfig | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [showManageUniverses, setShowManageUniverses] = useState(false)
  const [showManageRankingSystems, setShowManageRankingSystems] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const [strategies, setStrategies] = useState<StrategyOption[]>([])
  const [universes, setUniverses] = useState<SelectOption[]>([])
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [history, setHistory] = useState<RunHistoryEntry[]>(loadHistory)

  const selectedStrategy = strategies.find((s) => s.value === config.strategyId)
  const isLive = selectedStrategy ? selectedStrategy.isLive : false

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  // Unsaved edits are purely local now (backtests run on the shadow sim), so
  // leaving the page can't corrupt anything on P123 — just warn about lost edits.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges(config, baselineConfig)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [config, baselineConfig])

  // Fetch data on mount
  useEffect(() => {
    fetchStrategies()
    fetchUniverses()
    refreshQuota()
  }, [])

  async function refreshQuota() {
    try {
      const r = await fetch('/api/quota')
      if (r.ok) {
        const q: QuotaInfo = await r.json()
        if (q.quotaRemaining !== null) setQuota(q)
      }
    } catch { /* non-critical */ }
  }

  function pushHistory(cfg: StrategyConfig, res: BacktestResult) {
    const entry: RunHistoryEntry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      strategyId: cfg.strategyId,
      strategyLabel: strategies.find((s) => s.value === cfg.strategyId)?.label ?? `Strategy ${cfg.strategyId}`,
      config: cfg,
      metrics: res.metrics,
    }
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, HISTORY_LIMIT)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }

  async function fetchStrategies() {
    try {
      const r = await fetch('/api/strategies')
      if (!r.ok) throw new Error('Failed to load strategies list')
      const data = await r.json()
      if (Array.isArray(data)) {
        setStrategies(data)
        if (data.length > 0) {
          setConfig((prev) => {
            const exists = data.some((s) => s.value === prev.strategyId)
            if (!exists) {
              return { ...prev, strategyId: data[0].value }
            }
            return prev
          })
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load strategies list')
    }
  }

  async function fetchUniverses() {
    try {
      const r = await fetch('/api/config')
      if (!r.ok) throw new Error('Failed to load configuration')
      const data = await r.json()
      if (Array.isArray(data.universes)) {
        setUniverses(data.universes)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load configuration universes')
    }
  }

  // Load strategy config details from backend when selected strategy changes
  useEffect(() => {
    if (config.strategyId <= 0) return
    let active = true
    setError(null)
    setSuccess(null)
    setWarning(null)

    fetch(`/api/strategies/${config.strategyId}/trading-system`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: 'Failed to load strategy details' }))
          throw new Error(err.detail || 'Failed to load strategy details')
        }
        return r.json()
      })
      .then((data) => {
        if (!active) return
        const loaded: StrategyConfig = normalizeConfig({
          ...config,
          strategyId: config.strategyId,
          universe: String(data.universe),
          rankingSystem: data.rankingSystem,
          buyRules: data.buyRules,
          sellRules: data.sellRules,
          holdings: data.holdings,
          rebalFreq: data.rebalFreq,
          benchmark: data.benchmark || 'Defined by Strategy',
        })
        setConfig(loaded)
        setBaselineConfig(loaded)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'Failed to load strategy details')
      })
    return () => { active = false }
  }, [config.strategyId])

  function applyRunResult(cfg: StrategyConfig, data: BacktestResult) {
    setResult(data)
    if (data.quota && data.quota.quotaRemaining !== null) setQuota(data.quota)
    setWarning(data.warning ?? null)
    pushHistory(cfg, data)
  }

  async function runBacktest() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    setWarning(null)
    setResult(null)
    try {
      const resp = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Backtest failed')
      }
      const data: BacktestResult = await resp.json()
      applyRunResult(config, data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Live strategies: update the trading system definition directly.
  async function saveStrategyChanges() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const resp = await fetch(`/api/strategies/${config.strategyId}/trading-system`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universe: config.universe,
          rankingSystem: config.rankingSystem,
          buyRules: config.buyRules.filter((r) => r.formula.trim() !== ''),
          sellRules: config.sellRules.filter((r) => r.formula.trim() !== ''),
          holdings: config.holdings,
          rebalFreq: config.rebalFreq,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Failed to save strategy changes')
      }
      const data = await resp.json()
      setSuccess(data.message || 'Strategy updated successfully on Portfolio123!')
      if (data.quota && data.quota.quotaRemaining !== null) setQuota(data.quota)
      setBaselineConfig(config)
      await fetchStrategies()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  // Simulations: committing writes the tested config to the REAL sim (the only
  // moment a real strategy is touched) by rerunning it once with this config.
  async function saveSimChanges() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    setWarning(null)
    try {
      const resp = await fetch(`/api/strategies/${config.strategyId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Failed to commit strategy changes')
      }
      const data: BacktestResult = await resp.json()
      applyRunResult(config, data)
      setBaselineConfig(config)
      setSuccess(data.message || 'Configuration committed to Portfolio123.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function addStrategyId(id: number) {
    const resp = await fetch('/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || 'Failed to add strategy')
    }
    const data = await resp.json()
    if (Array.isArray(data)) {
      setStrategies(data)
      setConfig((prev) => ({ ...prev, strategyId: id }))
    }
  }

  async function deleteStrategyId(id: number) {
    const resp = await fetch(`/api/strategies/${id}`, {
      method: 'DELETE',
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || 'Failed to delete strategy')
    }
    const data = await resp.json()
    if (Array.isArray(data)) {
      setStrategies(data)
      if (config.strategyId === id) {
        const nextStrategy = data.find((s) => s.value !== id)
        setConfig((prev) => ({
          ...prev,
          strategyId: nextStrategy ? nextStrategy.value : 0,
        }))
      }
    }
  }

  async function addUniverseId(value: string, label: string) {
    const resp = await fetch('/api/universes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, label }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || 'Failed to add universe mapping')
    }
    const data = await resp.json()
    if (Array.isArray(data)) {
      setUniverses(data)
    }
  }

  async function deleteUniverseId(value: string) {
    const resp = await fetch(`/api/universes/${value}`, {
      method: 'DELETE',
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || 'Failed to delete universe mapping')
    }
    const data = await resp.json()
    if (Array.isArray(data)) {
      setUniverses(data)
      if (config.universe === value) {
        setConfig((prev) => ({ ...prev, universe: 'SP500' }))
      }
    }
  }

  async function addRankingSystem(id: number, name: string) {
    const resp = await fetch('/api/ranking-systems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || 'Failed to add ranking system')
    }
  }

  async function deleteRankingSystem(id: number) {
    const resp = await fetch(`/api/ranking-systems/${id}`, {
      method: 'DELETE',
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      throw new Error(err.detail || 'Failed to delete ranking system')
    }
  }

  function loadStrategy(s: SavedStrategy) {
    const normalized = normalizeConfig(s.config)
    setConfig(normalized)
    setBaselineConfig(normalized)
    setShowSaved(false)
    setResult(null)
    setError(null)
    setSuccess(null)
    setWarning(null)
  }

  function loadHistoryEntry(entry: RunHistoryEntry) {
    const normalized = normalizeConfig(entry.config)
    setConfig(normalized)
    setShowHistory(false)
    setResult(null)
    setError(null)
    setSuccess(null)
    setWarning(null)
  }

  function deleteHistoryEntry(id: string) {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }

  function clearHistory() {
    setHistory(() => {
      localStorage.setItem(HISTORY_KEY, '[]')
      return []
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper-bg)] text-[var(--text-main)] transition-colors duration-200">
      <Header
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
        onOpenSaved={() => setShowSaved(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        quota={quota}
      />

      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 pb-10 pt-6 lg:px-8">
        <div className="flex flex-col gap-6">
          {/* Top: Results & Alerts */}
          <div className="min-w-0">
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                <span className="font-semibold">Error: </span>{error}
              </div>
            )}
            {warning && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <span className="font-semibold">Warning: </span>{warning}
                {!result?.shadowUsed && (
                  <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                    className="ml-2 underline underline-offset-2 font-semibold"
                  >
                    Open Settings
                  </button>
                )}
              </div>
            )}
            {success && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                <span className="font-semibold">Success: </span>{success}
              </div>
            )}
            <Results result={result} loading={loading} config={config} />
          </div>

          {/* Bottom: Strategy Configuration Form */}
          <StrategyForm
            config={config}
            onChange={setConfig}
            onRun={runBacktest}
            loading={loading}
            strategies={strategies}
            onManageStrategies={() => setShowManage(true)}
            isLive={isLive}
            onSave={saveStrategyChanges}
            saving={saving}
            universes={universes}
            onManageUniverses={() => setShowManageUniverses(true)}
            onManageRankingSystems={() => setShowManageRankingSystems(true)}
            baselineConfig={baselineConfig}
            onSaveSim={saveSimChanges}
          />
        </div>
      </main>

      {showSaved && (
        <SavedStrategies
          currentConfig={config}
          onLoad={loadStrategy}
          onClose={() => setShowSaved(false)}
        />
      )}

      {showManage && (
        <ManageStrategiesModal
          strategies={strategies}
          onClose={() => setShowManage(false)}
          onAdd={addStrategyId}
          onDelete={deleteStrategyId}
        />
      )}

      {showManageUniverses && (
        <ManageUniversesModal
          universes={universes}
          onClose={() => setShowManageUniverses(false)}
          onAdd={addUniverseId}
          onDelete={deleteUniverseId}
        />
      )}

      {showManageRankingSystems && (
        <ManageRankingSystemsModal
          onClose={() => setShowManageRankingSystems(false)}
          onAdd={addRankingSystem}
          onDelete={deleteRankingSystem}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => setWarning(null)}
        />
      )}

      {showHistory && (
        <RunHistoryModal
          history={history}
          onLoad={loadHistoryEntry}
          onDelete={deleteHistoryEntry}
          onClear={clearHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
