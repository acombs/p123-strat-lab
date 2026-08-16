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

export interface SurvivalStats {
  n: number
  years: number
  srDaily: number
  skew: number | null
  kurt: number | null
  ar1: number | null
  sharpeComputed: number | null
  sharpeSE: number | null
  sharpeCiLo: number | null
  sharpeCiHi: number | null
  psr: number | null
  minTrackRecordYears: number | null
  breakevenBps: number | null
  // trial-dependent (recomputed via /api/survival/dsr when the count changes)
  trials: number
  dsr: number | null
  expectedMaxSharpe: number | null
  minBacktestYears: number | null
  maxTrialsForLength: number | null
}

export interface TrialsInfo {
  strategyId: number
  runs: number
  extra: number
  total: number
  since: string | null
}

export interface BacktestResult {
  equityCurve: EquityCurvePoint[]
  annualReturns: AnnualReturn[]
  metrics: Metrics
  survival?: SurvivalStats | null
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


export interface FactorLoading {
  factor: string
  beta: number
  t: number | null
}

export interface AttributionModel {
  model: string
  alphaAnn: number
  alphaT: number | null
  alphaP: number | null
  r2: number
  loadings: FactorLoading[]
}

export interface AttributionResult {
  n: number
  years: number
  startDate: string
  endDate: string
  unmatchedDays: number
  models: AttributionModel[]
  alphaSurvives: boolean
  richestModel: string
  factorData: {
    source: 'cache' | 'fresh'
    ageDays: number | null
    lastDate: string | null
    refreshError: string | null
  }
}

export interface PboResult {
  jobId: string
  pbo: number
  nCombos: number
  nConfigs: number
  nPeriods: number
  splits: number
  medianRank: number
  medianLogit: number
  meanOosSharpeOfWinnerAnn: number
  logitHistogram: { lo: number; hi: number; count: number }[]
  configIds: string[]
}
