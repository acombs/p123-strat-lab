import type { PerturbGroup, StrategyConfig } from '../types'

// A perturbable parameter detected in the strategy config: a numeric literal
// inside a buy/sell rule, or a structural knob (holdings, rebalance frequency).
export interface DetectedParam {
  key: string
  source: 'buy' | 'sell' | 'holdings' | 'rebalFreq'
  ruleIndex: number
  occIndex: number
  kind: 'numeric' | 'choice'
  baseValue: number | string
  candidates: (number | string)[]
  enabled: boolean
  label: string
  context: string
}

export interface PlannedRun {
  id: string
  label: string
  group: PerturbGroup
  param?: string
  value?: number | string
  base?: number | string
  config: StrategyConfig
}

// Matches standalone numeric literals: not part of an identifier (Beta1Y,
// ATRN14) and not a decimal tail.
const NUM_RE = /(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g

function defaultCandidates(v: number): number[] {
  // Rank/percentile-style integer thresholds get absolute neighbors; everything
  // else gets multiplicative ones.
  let cands: number[]
  if (Number.isInteger(v) && v >= 10 && v <= 99) {
    cands = [v - 5, v - 2, v + 2, v + 5].map((c) => Math.min(99, Math.max(1, c)))
  } else {
    const decimals = Number.isInteger(v) ? 0 : 2
    cands = [v * 0.8, v * 0.9, v * 1.1, v * 1.2].map((c) => Number(c.toFixed(decimals)))
  }
  return [...new Set(cands)].filter((c) => c !== v && c > 0)
}

// Full formula with the perturbed number marked »like this« — the table cell
// scrolls horizontally, so no truncation is needed here.
function contextSnippet(formula: string, matchIndex: number, matchLen: number): string {
  const num = formula.slice(matchIndex, matchIndex + matchLen)
  return formula.slice(0, matchIndex) + '»' + num + '«' + formula.slice(matchIndex + matchLen)
}

export function detectParams(config: StrategyConfig): DetectedParam[] {
  const params: DetectedParam[] = []

  const scanRules = (source: 'buy' | 'sell', rules: StrategyConfig['buyRules']) => {
    rules.forEach((rule, ruleIndex) => {
      if (rule.disabled || !rule.formula.trim()) return
      let occIndex = 0
      for (const m of rule.formula.matchAll(NUM_RE)) {
        const value = Number(m[0])
        const candidates = defaultCandidates(value)
        params.push({
          key: `${source}${ruleIndex}.n${occIndex}`,
          source,
          ruleIndex,
          occIndex,
          kind: 'numeric',
          baseValue: value,
          candidates,
          // Tiny constants (offsets like Close(0), floors like > 1) are almost
          // never the interesting knobs — detected but off by default.
          enabled: value >= 5 && candidates.length > 0,
          label: `${source === 'buy' ? 'Buy' : 'Sell'} ${ruleIndex + 1}: [${m[0]}]`,
          context: contextSnippet(rule.formula, m.index ?? 0, m[0].length),
        })
        occIndex += 1
      }
    })
  }

  scanRules('buy', config.buyRules)
  scanRules('sell', config.sellRules)

  const h = config.holdings
  params.push({
    key: 'holdings',
    source: 'holdings',
    ruleIndex: -1,
    occIndex: -1,
    kind: 'numeric',
    baseValue: h,
    candidates: [...new Set([Math.max(2, Math.round(h * 0.7)), Math.round(h * 1.5), h * 2])].filter((c) => c !== h),
    enabled: true,
    label: `Holdings: [${h}]`,
    context: `max holdings = ${h}`,
  })

  const freqAlts = ['Every Week', 'Every 2 Weeks', 'Every 4 Weeks'].filter((f) => f !== config.rebalFreq)
  params.push({
    key: 'rebalFreq',
    source: 'rebalFreq',
    ruleIndex: -1,
    occIndex: -1,
    kind: 'choice',
    baseValue: config.rebalFreq,
    candidates: freqAlts,
    enabled: true,
    label: `Rebalance: [${config.rebalFreq}]`,
    context: `rebalance frequency = ${config.rebalFreq}`,
  })

  return params
}

function replaceNthNumber(formula: string, occIndex: number, newValue: number): string {
  let i = -1
  return formula.replace(NUM_RE, (m) => {
    i += 1
    return i === occIndex ? String(newValue) : m
  })
}

export function applyParam(config: StrategyConfig, param: DetectedParam, value: number | string): StrategyConfig {
  if (param.source === 'holdings') {
    return { ...config, holdings: Number(value) }
  }
  if (param.source === 'rebalFreq') {
    return { ...config, rebalFreq: String(value) }
  }
  const rulesKey = param.source === 'buy' ? 'buyRules' : 'sellRules'
  const rules = config[rulesKey].map((r, i) =>
    i === param.ruleIndex ? { ...r, formula: replaceNthNumber(r.formula, param.occIndex, Number(value)) } : r
  )
  return { ...config, [rulesKey]: rules }
}

function oatRuns(config: StrategyConfig, params: DetectedParam[]): PlannedRun[] {
  const runs: PlannedRun[] = []
  for (const p of params) {
    if (!p.enabled) continue
    for (const c of p.candidates) {
      runs.push({
        id: `${p.key}=${c}`,
        label: `${p.label} → ${c}`,
        group: 'oat',
        param: p.key,
        value: c,
        base: p.baseValue,
        config: applyParam(config, p, c),
      })
    }
  }
  return runs
}

function jointRuns(config: StrategyConfig, params: DetectedParam[], count: number): PlannedRun[] {
  const enabled = params.filter((p) => p.enabled)
  const runs: PlannedRun[] = []
  for (let s = 0; s < count; s++) {
    let cfg = config
    for (const p of enabled) {
      if (p.kind === 'numeric') {
        const pool = [...p.candidates.map(Number), Number(p.baseValue)]
        const lo = Math.min(...pool)
        const hi = Math.max(...pool)
        let v = lo + Math.random() * (hi - lo)
        v = Number.isInteger(p.baseValue) ? Math.round(v) : Number(v.toFixed(2))
        cfg = applyParam(cfg, p, v)
      } else {
        const pool = [...p.candidates, p.baseValue]
        cfg = applyParam(cfg, p, pool[Math.floor(Math.random() * pool.length)])
      }
    }
    runs.push({
      id: `joint-${s + 1}`,
      label: `Joint sample ${s + 1}`,
      group: 'joint',
      config: cfg,
    })
  }
  return runs
}

export type PerturbPreset = 'tiny' | 'oat' | 'oat+joint'

export function buildPlan(
  config: StrategyConfig,
  params: DetectedParam[],
  preset: PerturbPreset,
  jointCount: number
): PlannedRun[] {
  const baseline: PlannedRun = {
    id: 'baseline',
    label: 'Baseline',
    group: 'baseline',
    config,
  }
  const all = oatRuns(config, params)

  if (preset === 'tiny') {
    // One variation per parameter, round-robin, capped at 5 — a cheap smoke
    // test of the pipeline before committing to the full grid.
    const byParam = new Map<string, PlannedRun[]>()
    for (const r of all) {
      const list = byParam.get(r.param!) ?? []
      list.push(r)
      byParam.set(r.param!, list)
    }
    const picked: PlannedRun[] = []
    let round = 0
    while (picked.length < 5) {
      let added = false
      for (const list of byParam.values()) {
        if (round < list.length && picked.length < 5) {
          picked.push(list[round])
          added = true
        }
      }
      if (!added) break
      round += 1
    }
    return [baseline, ...picked]
  }

  const runs = [baseline, ...all]
  if (preset === 'oat+joint') {
    runs.push(...jointRuns(config, params, jointCount))
  }
  return runs
}
