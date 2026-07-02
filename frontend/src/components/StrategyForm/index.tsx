import { ChevronDown, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SelectOption, StrategyConfig, StrategyOption, RuleItem } from '../../types'
import DateRangePicker from './DateRangePicker'
import FormulaInput from './FormulaInput'

interface Props {
  config: StrategyConfig
  onChange: (c: StrategyConfig) => void
  onRun: () => void
  loading: boolean
  strategies: StrategyOption[]
  onManageStrategies: () => void
  isLive: boolean
  onSave: () => void
  saving: boolean
  universes: SelectOption[]
  onManageUniverses: () => void
  onManageRankingSystems: () => void
  baselineConfig: StrategyConfig | null
  onSaveSim: () => void
}

const RECENT_SYSTEMS_KEY = 'p123_recent_ranking_systems'

function useAppConfig() {
  const [rebalFreqs, setRebalFreqs] = useState<SelectOption[]>([])
  const [benchmarks, setBenchmarks] = useState<SelectOption[]>([])

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        setRebalFreqs(data.rebalFrequencies ?? [])
        setBenchmarks(data.benchmarks ?? [])
      })
      .catch(() => {})
  }, [])

  return { rebalFreqs, benchmarks }
}

// ── Ranking system combobox with debounced server-side search ─────────────────
function RankingSystemInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [input, setInput] = useState(value)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<{ id?: string; name: string }[]>([])
  const [fetching, setFetching] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_SYSTEMS_KEY) ?? '[]') }
    catch { return [] }
  })
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setInput(value) }, [value])

  // Debounced search — fires 220 ms after the user stops typing
  useEffect(() => {
    if (disabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    
    // If input matches the current selected value exactly, treat it as empty query
    // so all mapped ranking systems are displayed in the dropdown.
    const isBaseline = input === value
    const q = isBaseline ? '' : input.trim()

    debounceRef.current = setTimeout(() => {
      setFetching(true)
      fetch(`/api/ranking-systems?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setResults(data)
        })
        .catch(() => {})
        .finally(() => setFetching(false))
    }, 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [input, value, disabled])

  // Close on outside click
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function select(name: string) {
    if (disabled) return
    onChange(name)
    setInput(name)
    setOpen(false)
    setRecent((prev) => {
      const next = [name, ...prev.filter((r) => r !== name)].slice(0, 8)
      localStorage.setItem(RECENT_SYSTEMS_KEY, JSON.stringify(next))
      return next
    })
  }

  const lower = input.toLowerCase()

  // Recent systems not already in API results
  const recentFiltered = recent.filter(
    (r) => r.toLowerCase().includes(lower) && !results.find((s) => s.name === r)
  )

  const showDropdown = open && !disabled

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => { if (!disabled) { setInput(e.target.value); onChange(e.target.value); setOpen(true) } }}
          onFocus={() => { if (!disabled) setOpen(true) }}
          placeholder={disabled ? "No ranking system loaded" : "Type to search your ranking systems…"}
          className="input-base pr-8 disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-900"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          {fetching
            ? <Loader2 size={14} className="animate-spin" />
            : <ChevronDown size={14} />
          }
        </div>
      </div>

      {showDropdown && (
        <ul
          className="absolute left-0 z-50 mt-1 w-full overflow-auto rounded-none border border-[var(--border-color)] bg-[var(--card-bg)] shadow-none"
          style={{ maxHeight: 280 }}
        >
          {/* Recent */}
          {recentFiltered.length > 0 && (
            <>
              <li className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Recent
              </li>
              {recentFiltered.map((r) => (
                <li
                  key={r}
                  onMouseDown={(e) => { e.preventDefault(); select(r) }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm
                             hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="h-2 w-2 shrink-0 rounded-none bg-[var(--pastel-blue-text)]" />
                  {r}
                </li>
              ))}
            </>
          )}

          {/* API results */}
          {results.length > 0 && (
            <>
              {recentFiltered.length > 0 && (
                <li className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Your systems
                </li>
              )}
              {results.slice(0, 30).map((s) => (
                <li
                  key={s.id ?? s.name}
                  onMouseDown={(e) => { e.preventDefault(); select(s.name) }}
                  className="cursor-pointer px-3 py-2 text-sm
                             hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {s.name}
                </li>
              ))}
            </>
          )}

          {/* Empty state */}
          {results.length === 0 && recentFiltered.length === 0 && !fetching && (
            <li className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
              {input.length > 0
                ? `No matches — press Enter to use "${input}" directly`
                : 'Start typing to search your P123 ranking systems'}
            </li>
          )}

          {fetching && results.length === 0 && recentFiltered.length === 0 && (
            <li className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" /> Searching…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}



function RulesSection({
  label,
  rules,
  placeholder,
  onChange,
  disabled,
}: {
  label: string
  rules: RuleItem[]
  placeholder: string
  onChange: (rules: RuleItem[]) => void
  disabled?: boolean
}) {
  function update(idx: number, formula: string) {
    if (disabled) return
    const next = [...rules]
    next[idx] = { ...next[idx], formula }
    onChange(next)
  }
  function toggleDisabled(idx: number) {
    if (disabled) return
    const next = [...rules]
    next[idx] = { ...next[idx], disabled: !next[idx].disabled }
    onChange(next)
  }
  function add() { if (!disabled) onChange([...rules, { formula: '', disabled: false }]) }
  function remove(idx: number) {
    if (disabled) return
    const next = rules.filter((_, i) => i !== idx)
    onChange(next.length ? next : [{ formula: '', disabled: false }])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {!disabled && (
          <button type="button" onClick={add} className="btn-ghost px-2 py-1 text-xs">
            <Plus size={13} /> Add rule
          </button>
        )}
      </div>
      {rules.map((rule, i) => (
        <div key={i} className="flex gap-2 items-center">
          {/* Enable/disable toggle: generous hit area, unambiguous state */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => toggleDisabled(i)}
            className={`h-7 w-7 -m-1 p-1 flex items-center justify-center shrink-0 transition-colors ${
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title={rule.disabled ? 'Rule is OFF — click to enable' : 'Rule is ON — click to disable'}
            aria-pressed={!rule.disabled}
          >
            <span
              className={`h-4 w-4 flex items-center justify-center border-2 rounded-none dark:rounded-[0.25rem] ${
                rule.disabled
                  ? 'border-[var(--border-color)] bg-transparent'
                  : 'border-[var(--text-main)] bg-[var(--text-main)]'
              }`}
            >
              {!rule.disabled && (
                <svg className="w-2.5 h-2.5 text-[var(--paper-bg)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4.5}>
                  <path strokeLinecap="square" strokeLinejoin="miter" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          </button>

          <div className="flex-1">
            <FormulaInput
              value={rule.formula}
              onChange={(v) => update(i, v)}
              placeholder={placeholder}
              disabled={disabled}
              isRuleDisabled={rule.disabled}
            />
          </div>
          {rule.disabled && !disabled && (
            <button
              type="button"
              onClick={() => toggleDisabled(i)}
              className="shrink-0 border border-[var(--border-color)] bg-[var(--pastel-yellow-bg)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pastel-yellow-text)] rounded-none dark:rounded-[0.25rem]"
              title="Click to re-enable this rule"
            >
              Off
            </button>
          )}
          {!disabled && rules.length > 1 && (
            <button type="button" onClick={() => remove(i)} className="btn-danger shrink-0 px-2 py-2">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function hasUnsavedChanges(config: StrategyConfig, baseline: StrategyConfig | null): boolean {
  if (!baseline) return false
  
  const normalizeRules = (rules: RuleItem[]) => 
    rules.map(r => ({ formula: r.formula.trim(), disabled: r.disabled })).filter(r => r.formula !== '')
    
  const configBuy = normalizeRules(config.buyRules)
  const baselineBuy = normalizeRules(baseline.buyRules)
  const configSell = normalizeRules(config.sellRules)
  const baselineSell = normalizeRules(baseline.sellRules)
  
  if (config.universe !== baseline.universe) return true
  if (config.rankingSystem !== baseline.rankingSystem) return true
  if (config.holdings !== baseline.holdings) return true
  if (config.rebalFreq !== baseline.rebalFreq) return true
  
  if (configBuy.length !== baselineBuy.length || configBuy.some((r, i) => r.formula !== baselineBuy[i].formula || r.disabled !== baselineBuy[i].disabled)) return true
  if (configSell.length !== baselineSell.length || configSell.some((r, i) => r.formula !== baselineSell[i].formula || r.disabled !== baselineSell[i].disabled)) return true
  
  return false
}

export default function StrategyForm({
  config,
  onChange,
  onRun,
  loading,
  strategies,
  onManageStrategies,
  isLive,
  onSave,
  saving,
  universes,
  onManageUniverses,
  onManageRankingSystems,
  baselineConfig,
  onSaveSim,
}: Props) {
  const { rebalFreqs, benchmarks } = useAppConfig()

  function set<K extends keyof StrategyConfig>(k: K, v: StrategyConfig[K]) {
    onChange({ ...config, [k]: v })
  }

  const canRun = config.strategyId > 0
  const readOnly = false
  const hasChanges = hasUnsavedChanges(config, baselineConfig)

  const handleSaveSim = () => {
    const confirm = window.confirm(
      "Commit these changes to the REAL simulation on Portfolio123? This permanently updates its configuration (backtest runs stay on the shadow sim and never touch it)."
    )
    if (confirm) {
      onSaveSim()
    }
  }

  const handleSaveLive = () => {
    const confirm = window.confirm(
      "Warning: This will update the strategy configuration on Portfolio123. Are you sure you want to proceed?"
    )
    if (confirm) {
      onSave()
    }
  }

  const actionButton = hasChanges ? (
    <div className="flex items-center gap-2 shrink-0">
      {!isLive && (
        <button
          type="submit"
          disabled={!canRun || loading}
          className="btn-primary justify-center py-1.5 px-4 text-xs font-bold transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play size={13} strokeWidth={2.5} />
              Run Backtest
            </>
          )}
        </button>
      )}
      <button
        type="button"
        onClick={isLive ? handleSaveLive : handleSaveSim}
        disabled={isLive ? saving : loading}
        className="btn-save justify-center py-1.5 px-4 text-xs font-bold transition-all"
      >
        {(isLive ? saving : loading) ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Saving…
          </>
        ) : (
          'Save'
        )}
      </button>
    </div>
  ) : isLive ? (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        disabled
        className="btn-save justify-center py-1.5 px-4 text-xs font-bold cursor-not-allowed transition-all"
      >
        Save
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="submit"
        disabled={!canRun || loading}
        className="btn-primary justify-center py-1.5 px-4 text-xs font-bold transition-colors"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running…
          </>
        ) : (
          <>
            <Play size={13} strokeWidth={2.5} />
            Run Backtest
          </>
        )}
      </button>
    </div>
  )

  return (
    <form
      className="card space-y-6 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (canRun && !loading && !isLive) onRun()
      }}
    >
      <div className="flex items-center justify-between border-b pb-3 border-[var(--border-color-light)]">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Strategy Configuration
        </h2>
      </div>

      {/* Parameter Selection & Period Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-2">
        {/* Left Side: Selectors (6 dropdowns/inputs in a 3-column sub-grid, 2 rows) */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Target Strategy Dropdown */}
            <div className="flex flex-col">
              <label className="label mb-1.5 flex items-center gap-1.5">
                <span>Target Strategy</span>
                <button
                  type="button"
                  onClick={onManageStrategies}
                  className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="Manage Strategies"
                >
                  <Pencil size={11} />
                </button>
              </label>
              <div className="relative mt-auto">
                <select
                  value={config.strategyId}
                  onChange={(e) => set('strategyId', parseInt(e.target.value) || 0)}
                  className="select-base pr-8"
                >
                   {strategies.map((s) => (
                    <option key={s.value} value={s.value} disabled={s.isBook}>
                      {s.label} {s.isBook ? '(Book - Unsupported)' : ''}
                    </option>
                  ))}
                  {strategies.length === 0 && (
                    <option value="0">No strategies loaded</option>
                  )}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* Universe Selector */}
            <div className="flex flex-col">
              <label className="label mb-1.5 flex items-center gap-1.5">
                <span>Universe</span>
                <button
                  type="button"
                  onClick={onManageUniverses}
                  className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="Manage Universes"
                >
                  <Pencil size={9} />
                </button>
              </label>
              <div className="relative mt-auto">
                <select
                  value={
                    universes.find((u) => u.value === config.universe)
                      ? config.universe
                      : 'CUSTOM'
                  }
                  disabled={readOnly}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === 'CUSTOM') {
                      set('universe', '')
                    } else {
                      set('universe', val)
                    }
                  }}
                  className={`select-base ${readOnly ? 'bg-slate-50 text-slate-400 dark:bg-slate-900' : ''}`}
                >
                  {universes.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                  <option value="CUSTOM">Custom ID...</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* Benchmark Display (Read-only) */}
            <div className="flex flex-col">
              <label className="label mb-1.5">Benchmark</label>
              <input
                type="text"
                value={config.benchmark || 'Defined by Strategy'}
                disabled
                className="input-base bg-slate-50 text-slate-400 dark:bg-slate-900 mt-auto"
              />
            </div>

            {/* Ranking system */}
            <div className="flex flex-col">
              <label className="label mb-1.5 flex items-center gap-1.5">
                <span>Ranking System</span>
                <button
                  type="button"
                  onClick={onManageRankingSystems}
                  className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="Manage Ranking Systems"
                >
                  <Pencil size={9} />
                </button>
              </label>
              <div className="mt-auto">
                <RankingSystemInput
                  value={config.rankingSystem}
                  onChange={(v) => set('rankingSystem', v)}
                  disabled={readOnly}
                />
              </div>
            </div>

            {/* Max Holdings */}
            <div className="flex flex-col">
              <label className="label mb-1.5">Max Holdings</label>
              <input
                type="number"
                value={config.holdings}
                disabled={readOnly}
                onChange={(e) => set('holdings', parseInt(e.target.value) || 0)}
                className={`input-base ${readOnly ? 'bg-slate-50 text-slate-400 dark:bg-slate-900 mt-auto' : 'mt-auto'}`}
              />
            </div>

            {/* Rebalance */}
            <div className="flex flex-col">
              <label className="label mb-1.5">Rebalance</label>
              <div className="relative mt-auto">
                <select
                  value={config.rebalFreq}
                  disabled={readOnly}
                  onChange={(e) => set('rebalFreq', e.target.value)}
                  className={`select-base ${readOnly ? 'bg-slate-50 text-slate-400 dark:bg-slate-900' : ''}`}
                >
                  {rebalFreqs.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                  {rebalFreqs.length === 0 && (
                    <option value={config.rebalFreq}>{config.rebalFreq}</option>
                  )}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Custom Universe ID input if selected Custom ID */}
          {!universes.find((u) => u.value === config.universe) && (
            <div className="flex flex-col">
              <label className="label mb-1.5">Custom Universe ID</label>
              <input
                type="number"
                value={config.universe || ''}
                disabled={readOnly}
                onChange={(e) => set('universe', e.target.value)}
                placeholder="e.g. 320336"
                className={`input-base ${readOnly ? 'bg-slate-50 text-slate-400 dark:bg-slate-900 mt-auto' : 'mt-auto'}`}
              />
            </div>
          )}
        </div>

        {/* Right Side: Date components (Test Period DateRangePicker) */}
        <div className="flex flex-col">
          <label className="label mb-1.5">Test Period</label>
          <DateRangePicker
            startDate={config.startDate}
            endDate={config.endDate}
            onChange={(start, end) => onChange({ ...config, startDate: start, endDate: end })}
            actionButton={actionButton}
          />
        </div>
      </div>

      {/* Side-by-side Buy & Sell Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 border-t pt-5 border-[var(--border-color-light)]">
        {/* Buy rules */}
        <RulesSection
          label="Buy Rules"
          rules={config.buyRules}
          placeholder={readOnly ? "No buy rules loaded" : "Enter formula..."}
          onChange={(v) => set('buyRules', v)}
          disabled={readOnly}
        />

        {/* Sell rules */}
        <RulesSection
          label="Sell Rules"
          rules={config.sellRules}
          placeholder={readOnly ? "No sell rules loaded" : "Enter formula..."}
          onChange={(v) => set('sellRules', v)}
          disabled={readOnly}
        />
      </div>
    </form>
  )
}
