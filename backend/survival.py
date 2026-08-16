"""Statistical-survival diagnostics for a backtest's daily equity curve.

Answers the questions a headline Sharpe cannot: how wide is its confidence interval, how
much of it is explained by the number of configurations tried, and can the strategy pay
for its own trading. Pure numpy/math — no scipy.

References (formulas as implemented in the experienced-quant-investor skill's dsr.py):
  - Lo (2002): standard error of the Sharpe ratio under non-normality.
  - Bailey & Lopez de Prado (2012, 2014): Probabilistic Sharpe Ratio, Deflated Sharpe
    Ratio, Minimum Track Record Length, Minimum Backtest Length.
"""

import math
from typing import Optional

import numpy as np

EULER = 0.5772156649015329
TRADING_DAYS = 252


# ── Normal distribution helpers (no scipy) ───────────────────────────────────

def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def norm_ppf(p: float) -> float:
    """Inverse normal CDF (Acklam's rational approximation, |rel err| < 1.2e-9)."""
    if not 0.0 < p < 1.0:
        raise ValueError("p must be in (0, 1)")
    a = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00)
    b = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01)
    c = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00)
    d = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00)
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) / \
               ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) / \
                ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5]) * q / \
           (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1)


# ── Sharpe inference ─────────────────────────────────────────────────────────

def sharpe_se_lo(sr: float, n: int, skew: float = 0.0, kurt: float = 3.0) -> float:
    """SE of a per-period Sharpe (Lo 2002). `kurt` is raw kurtosis (normal = 3)."""
    if n < 3:
        return float("nan")
    var = (1.0 - skew * sr + 0.25 * (kurt - 1.0) * sr ** 2) / (n - 1)
    return math.sqrt(max(var, 0.0))


def psr(sr: float, n: int, sr_benchmark: float = 0.0, skew: float = 0.0, kurt: float = 3.0) -> float:
    """Probabilistic Sharpe Ratio: P(true SR > benchmark). Per-period units."""
    se = sharpe_se_lo(sr, n, skew, kurt)
    if not (se > 0 and math.isfinite(se)):
        return float("nan")
    return norm_cdf((sr - sr_benchmark) / se)


def expected_max_sharpe(trials: int, sr_variance: float = 1.0) -> float:
    """E[max of `trials` noise Sharpes] (Bailey et al. extreme-value approximation)."""
    if trials < 2:
        return 0.0
    z1 = norm_ppf(1.0 - 1.0 / trials)
    z2 = norm_ppf(1.0 - 1.0 / (trials * math.e))
    return math.sqrt(sr_variance) * ((1.0 - EULER) * z1 + EULER * z2)


def min_track_record_length(sr: float, sr_benchmark: float = 0.0, confidence: float = 0.95,
                            skew: float = 0.0, kurt: float = 3.0) -> float:
    """Observations needed before SR is distinguishable from the benchmark."""
    if sr <= sr_benchmark:
        return float("inf")
    z = norm_ppf(confidence)
    return 1.0 + (1.0 - skew * sr + 0.25 * (kurt - 1.0) * sr ** 2) * (z / (sr - sr_benchmark)) ** 2


def min_backtest_length(trials: int, sr_annual: float = 1.0) -> float:
    """Years needed before an in-sample annual Sharpe of `sr_annual` means anything given `trials`."""
    if sr_annual <= 0:
        return float("inf")
    return (expected_max_sharpe(trials) / sr_annual) ** 2


def max_trials_for(years: float, sr_annual: float = 1.0, hi: int = 1_000_000) -> int:
    """Largest trial count whose MinBTL still fits in `years` (inverse of min_backtest_length)."""
    if years <= 0 or sr_annual <= 0:
        return 1
    lo, best = 2, 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if min_backtest_length(mid, sr_annual) <= years:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return best


# ── Series moments ───────────────────────────────────────────────────────────

def daily_returns(equity_curve: list[dict], key: str = "portfolio") -> np.ndarray:
    vals = np.asarray([p[key] for p in equity_curve if p.get(key) is not None], dtype=float)
    if len(vals) < 3:
        return np.array([])
    return vals[1:] / vals[:-1] - 1.0


def moments(r: np.ndarray) -> dict:
    n = len(r)
    if n < 3:
        return {"n": n, "mean": None, "sd": None, "skew": 0.0, "kurt": 3.0, "ar1": None}
    mean = float(r.mean())
    sd = float(r.std(ddof=1))
    if sd <= 0:
        return {"n": n, "mean": mean, "sd": sd, "skew": 0.0, "kurt": 3.0, "ar1": None}
    z = (r - mean) / sd
    skew = float((z ** 3).mean())
    kurt = float((z ** 4).mean())  # raw kurtosis, normal = 3
    ar1 = float(np.corrcoef(r[:-1], r[1:])[0, 1]) if n > 3 else None
    return {"n": n, "mean": mean, "sd": sd, "skew": skew, "kurt": kurt, "ar1": ar1}


# ── The block the API returns ────────────────────────────────────────────────

def _r(x, nd=3):
    if x is None or not math.isfinite(x):
        return None
    return round(float(x), nd)


def dsr_block(sr_daily: float, n: int, skew: float, kurt: float, trials: int) -> dict:
    """Trial-dependent part of the survival stats; recomputed when the trial count changes."""
    trials = max(1, int(trials))
    ann = math.sqrt(TRADING_DAYS)
    years = n / TRADING_DAYS
    sr_annual = sr_daily * ann
    se = sharpe_se_lo(sr_daily, n, skew, kurt)
    threshold = expected_max_sharpe(trials, se ** 2)  # per-period, sampling-variance scaled
    out = {
        "trials": trials,
        "dsr": _r(psr(sr_daily, n, threshold, skew, kurt)),
        "expectedMaxSharpe": _r(threshold * ann),
        # Years of backtest needed for this Sharpe to be meaningful given `trials`, and
        # the largest trial count this backtest length can honestly support (Bailey et al.).
        "minBacktestYears": _r(min_backtest_length(trials, sr_annual), 1) if sr_annual > 0 else None,
        "maxTrialsForLength": max_trials_for(years, sr_annual) if sr_annual > 0 else None,
    }
    return out


def survival_stats(equity_curve: list[dict], trials: int,
                   turnover_pct: Optional[float], cagr_pct: Optional[float]) -> Optional[dict]:
    """Full survival block for a backtest result.

    turnover_pct: annual one-way turnover in percent (P123's `annualTurnover`).
    cagr_pct:     annualized return in percent.
    """
    r = daily_returns(equity_curve)
    m = moments(r)
    n = m["n"]
    if n < 60 or not m["sd"]:
        return None
    ann = math.sqrt(TRADING_DAYS)
    sr_daily = m["mean"] / m["sd"]
    se = sharpe_se_lo(sr_daily, n, m["skew"], m["kurt"])
    mtrl_days = min_track_record_length(sr_daily, 0.0, 0.95, m["skew"], m["kurt"])

    breakeven_bps = None
    if turnover_pct is not None and turnover_pct > 0 and cagr_pct is not None:
        # break-even round-trip cost = annual return / (2 × one-way annual turnover)
        breakeven_bps = (cagr_pct / 100.0) / (2.0 * turnover_pct / 100.0) * 10000.0

    block = {
        # inputs, kept so the frontend can ask for a DSR recompute at a different trial count
        "n": n,
        "years": _r(n / TRADING_DAYS, 2),
        "srDaily": sr_daily,
        "skew": _r(m["skew"]),
        "kurt": _r(m["kurt"]),
        "ar1": _r(m["ar1"]),
        # inference on the computed (rf = 0, daily, ×√252) Sharpe
        "sharpeComputed": _r(sr_daily * ann),
        "sharpeSE": _r(se * ann),
        "sharpeCiLo": _r((sr_daily - 1.96 * se) * ann),
        "sharpeCiHi": _r((sr_daily + 1.96 * se) * ann),
        "psr": _r(psr(sr_daily, n, 0.0, m["skew"], m["kurt"])),
        "minTrackRecordYears": _r(mtrl_days / TRADING_DAYS, 1) if math.isfinite(mtrl_days) else None,
        "breakevenBps": _r(breakeven_bps, 1),
    }
    block.update(dsr_block(sr_daily, n, m["skew"], m["kurt"], trials))
    return block


if __name__ == "__main__":
    # Self-checks against the worked anchors in the skill's dsr.py --selftest.
    se = sharpe_se_lo(1.9 / math.sqrt(12), 168) * math.sqrt(12)
    assert abs(se - 0.287) < 0.01, se
    assert abs(min_backtest_length(45, 1.0) - 5.0) < 0.1
    assert abs(min_backtest_length(7, 1.0) - 1.9) < 0.1
    assert abs(norm_ppf(0.975) - 1.959964) < 1e-6
    assert abs(norm_cdf(1.959964) - 0.975) < 1e-6
    print("survival self-test ok")
