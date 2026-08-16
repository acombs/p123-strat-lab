"""Probability of Backtest Overfitting via Combinatorially Symmetric Cross-Validation.

Bailey, Borwein, Lopez de Prado & Zhu (2014). Input: one column of daily returns per
configuration tried (here: every variant of a perturbation job), one row per day. The
sample is cut into S contiguous blocks; for every balanced half/half partition the
in-sample winner is chosen and its out-of-sample rank recorded. PBO is the share of
partitions where the IS winner lands below the OOS median.

Reading it: > 0.5 the selection procedure is counterproductive; 0.2–0.5 meaningful
overfitting risk; < 0.2 selection carried information (validates the procedure, not the
strategy). A single sweep is noisy — do not over-read a value near a boundary.

Implementation note: Sharpe of each block-union is computed from per-block sums and
sums of squares, so cost is O(partitions × S × N) instead of O(partitions × T × N).
"""

import itertools
import math

import numpy as np


def cscv(matrix: np.ndarray, splits: int = 16, max_combos: int = 20_000) -> dict:
    m = np.asarray(matrix, dtype=float)
    T, N = m.shape
    if N < 2:
        raise ValueError("need at least 2 configurations")
    if splits % 2:
        raise ValueError("splits must be even")
    if T < splits * 2:
        raise ValueError(f"need at least {splits * 2} periods for {splits} splits, got {T}")

    blocks = np.array_split(np.arange(T), splits)
    # per-block sufficient statistics: (S, N)
    bs = np.array([m[b].sum(axis=0) for b in blocks])
    bss = np.array([(m[b] ** 2).sum(axis=0) for b in blocks])
    bn = np.array([len(b) for b in blocks], dtype=float)

    def sharpe_of(sel: np.ndarray) -> np.ndarray:
        n = bn[sel].sum()
        s = bs[sel].sum(axis=0)
        ss = bss[sel].sum(axis=0)
        mean = s / n
        var = (ss - s * s / n) / (n - 1)
        sd = np.sqrt(np.maximum(var, 0.0))
        return np.where(sd > 0, mean / np.where(sd > 0, sd, 1.0), -np.inf)

    half = splits // 2
    combos = list(itertools.combinations(range(splits), half))
    if len(combos) > max_combos:
        step = len(combos) / max_combos
        combos = [combos[int(i * step)] for i in range(max_combos)]

    all_idx = np.arange(splits)
    logits, ranks, oos_win = [], [], []
    for pick in combos:
        is_sel = np.array(pick)
        oos_sel = np.setdiff1d(all_idx, is_sel)
        is_perf = sharpe_of(is_sel)
        oos_perf = sharpe_of(oos_sel)
        best = int(np.argmax(is_perf))
        order = np.argsort(np.argsort(oos_perf))  # 0 = worst OOS
        omega = (order[best] + 1.0) / (N + 1.0)
        logits.append(math.log(omega / (1.0 - omega)))
        ranks.append(omega)
        oos_win.append(oos_perf[best])

    logits_a = np.array(logits)
    hist, edges = np.histogram(logits_a, bins=15)
    return {
        "pbo": round(float((logits_a <= 0).mean()), 3),
        "nCombos": len(combos),
        "nConfigs": N,
        "nPeriods": T,
        "splits": splits,
        "medianRank": round(float(np.median(ranks)), 3),
        "medianLogit": round(float(np.median(logits_a)), 3),
        "meanOosSharpeOfWinnerAnn": round(float(np.mean(oos_win)) * math.sqrt(252), 3),
        "logitHistogram": [{"lo": round(float(edges[i]), 2), "hi": round(float(edges[i + 1]), 2),
                            "count": int(hist[i])} for i in range(len(hist))],
    }


if __name__ == "__main__":
    rng = np.random.default_rng(11)
    T, N = 1200, 40
    pbos = [cscv(rng.normal(0, 0.01, size=(T, N)), splits=10)["pbo"] for _ in range(12)]
    assert 0.40 < float(np.mean(pbos)) < 0.60, np.mean(pbos)
    real = rng.normal(0, 0.01, size=(T, N)); real[:, 0] += 0.004
    assert cscv(real, splits=10)["pbo"] < 0.10
    fake = rng.normal(0, 0.01, size=(T, N)); fake[: T // 2, 0] += 0.010; fake[T // 2:, 0] -= 0.010
    assert cscv(fake, splits=10)["pbo"] > 0.5
    import time; t = time.time(); cscv(rng.normal(0, 0.01, size=(1300, 200)), splits=16); print(f"200 cfg × 16 splits: {time.time()-t:.1f}s")
    print("pbo self-test ok")
