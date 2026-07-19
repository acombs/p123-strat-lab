export interface RuleItem {
  formula: string
  disabled: boolean
}

export interface StrategyConfig {
  strategyId: number
  universe: string
  rankingSystem: string
  buyRules: RuleItem[]
  sellRules: RuleItem[]
  holdings: number
  rebalFreq: string
  startDate: string
  endDate: string
  benchmark?: string
}


export interface EquityCurvePoint {
  date: string
  portfolio: number
  benchmark: number
  drawdown: number
  benchDrawdown: number
  rollingReturn: number | null
  rollingBenchReturn: number | null
  rollingSharp: number | null
}

export interface AnnualReturn {
  year: string
  portfolio: number
  benchmark: number
}

export interface Metrics {
  cagr: number | null
  totalReturn: number | null
  sharpe: number | null
  sortino: number | null
  maxDrawdown: number | null
  maxDrawdownDays: number | null
  alpha: number | null
  beta: number | null
  winRate: number | null
  avgHoldingPeriod: number | null
  turnover: number | null
  benchCagr: number | null
  benchTotalReturn: number | null
  benchMaxDrawdown: number | null
  benchSharpe: number | null
  numHoldings: number | null
  maxUnderperformanceMonths: number | null
}

export interface QuotaInfo {
  quotaRemaining: number | null
  lastCost: number | null
  updatedAt: string | null
}

export interface BacktestResult {
  equityCurve: EquityCurvePoint[]
  annualReturns: AnnualReturn[]
  metrics: Metrics
  runSimId?: number
  shadowUsed?: boolean
  warning?: string | null
  quota?: QuotaInfo
  message?: string
}

export interface AppSettings {
  shadowSimId: number | null
  shadowSimIdStatic: number | null
}

export interface Transaction {
  [key: string]: unknown
}

export interface Pctiles {
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
}

export interface MonteCarloResult {
  numPaths: number
  horizonYears: number
  blockDays: number
  fan: { years: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]
  cagr: Pctiles
  terminalMultiple: Pctiles
  maxDrawdown: Pctiles
  ddHistogram: { bin: number; count: number }[]
  probLoss: number
  probUnderperformBench: number
  probDDWorseThan: Record<string, number>
  trades?: {
    count: number
    winRate: number
    avgTradePct: number
    expectancyCI: { p5: number; p50: number; p95: number }
    maxLosingStreak: { p50: number; p95: number }
    probNegativeExpectancy: number
  }
  tradesNote?: string
  quota?: QuotaInfo
}

export interface RollingWindowsResult {
  windowYears: number
  windows: { start: string; cagr: number; benchCagr: number; maxDD: number }[]
  summary: {
    count: number
    medianCagr: number
    worstCagr: number
    bestCagr: number
    pctNegative: number
    pctBeatBench: number
    medianMaxDD: number
    worstMaxDD: number
  }
}

export interface RunHistoryEntry {
  id: string
  ts: string
  strategyId: number
  strategyLabel: string
  config: StrategyConfig
  metrics: Metrics
}

export interface SavedStrategy {
  id: string
  name: string
  config: StrategyConfig
  createdAt: string
}

export interface PinnedPeriod {
  id: string
  name: string
  startDate: string
  endDate: string
}

export type PerturbGroup = 'baseline' | 'oat' | 'joint'

export interface PerturbRunResult {
  id: string
  label: string
  group: PerturbGroup
  param?: string | null
  value?: number | string | null
  base?: number | string | null
  config?: StrategyConfig
  metrics?: Metrics
  warning?: string | null
  error?: string
  costCredits?: number
  elapsedSec?: number
  reused?: boolean
}

export interface PerturbJob {
  jobId?: string
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'halted_quota' | 'error'
  startedAt?: string
  finishedAt?: string | null
  total?: number
  completed?: number
  quotaFloor?: number
  quotaRemaining?: number | null
  interrupted?: boolean
  runs: PerturbRunResult[]
  quota?: QuotaInfo
}

export interface PerturbJobSummary {
  jobId: string
  startedAt?: string
  finishedAt?: string | null
  state: string
  total?: number
  completed?: number
  params: string[]
  baselineCagr?: number | null
  window?: string
  strategyId?: number | null
  strategy?: string
}

export interface SelectOption {
  value: string
  label: string
}

export interface StrategyOption {
  value: number
  label: string
  isBook: boolean
  isLive: boolean
}

