"""Fama-French factor attribution: is the backtest alpha, or repackaged beta?

Regresses the strategy's daily excess returns on CAPM / FF3 / Carhart-4 / FF5 / FF5+Mom
using the Ken French data library, with Newey-West (HAC) standard errors. numpy only.

Factor data is fetched on demand and cached through the app's storage layer (GCS on
Cloud Run, a file locally), refreshed when older than FACTOR_TTL_DAYS. Ken French
updates monthly, so no scheduler is needed; a failed refresh falls back to the cached
copy and reports its age.
"""

import io
import logging
import math
import time
import urllib.request
import zipfile
from typing import Optional

import numpy as np

import storage

log = logging.getLogger(__name__)

KF_BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
KF_FILES = {
    "ff5": "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip",
    "mom": "F-F_Momentum_Factor_daily_CSV.zip",
}
FACTOR_COLS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom", "RF"]
MODELS = {
    "CAPM": ["Mkt-RF"],
    "FF3": ["Mkt-RF", "SMB", "HML"],
    "Carhart-4": ["Mkt-RF", "SMB", "HML", "Mom"],
    "FF5": ["Mkt-RF", "SMB", "HML", "RMW", "CMA"],
    "FF5+Mom": ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"],
}
FACTOR_TTL_DAYS = 7
_STORE_KEY = "ff_factors_daily"
_MEM: dict = {}  # process-local copy so repeated calls don't re-read GCS


# ── Fetch / parse / cache ────────────────────────────────────────────────────

def _download(name: str) -> bytes:
    with urllib.request.urlopen(KF_BASE + name, timeout=60) as r:
        return r.read()


def _parse_daily(blob: bytes) -> tuple[list[str], list[str], list[list[float]]]:
    """Ken French CSV: prose header, then rows `YYYYMMDD,v1,v2,...` (percent). Returns
    (dates, column names, rows in decimal)."""
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        raw = z.read(z.namelist()[0]).decode("latin-1")
    header: Optional[list[str]] = None
    dates, rows = [], []
    for line in raw.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            continue
        key = parts[0]
        if not (key.isdigit() and len(key) == 8):
            if header is None and key == "" and any(parts[1:]):
                header = [p for p in parts[1:] if p]
            continue
        try:
            vals = [float(p) / 100.0 for p in parts[1:] if p != ""]
        except ValueError:
            continue
        if header and len(vals) >= len(header):
            dates.append(f"{key[:4]}-{key[4:6]}-{key[6:]}")
            rows.append(vals[: len(header)])
    if not header or not rows:
        raise ValueError("could not parse Ken French CSV")
    return dates, header, rows


def _fetch_all() -> dict:
    d5, h5, r5 = _parse_daily(_download(KF_FILES["ff5"]))
    dm, hm, rm = _parse_daily(_download(KF_FILES["mom"]))
    mom_by_date = {d: r[0] for d, r in zip(dm, rm)}  # first column is Mom (name varies)
    cols = {c: [] for c in FACTOR_COLS}
    dates = []
    idx = {h: i for i, h in enumerate(h5)}
    for d, r in zip(d5, r5):
        if d not in mom_by_date:
            continue
        dates.append(d)
        for c in ("Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"):
            cols[c].append(round(r[idx[c]], 6))
        cols["Mom"].append(round(mom_by_date[d], 6))
    return {"fetchedAt": time.time(), "dates": dates, "cols": cols}


def load_factors(force_refresh: bool = False) -> tuple[Optional[dict], dict]:
    """Return (factor table, meta). meta reports source/age and any refresh error."""
    now = time.time()
    data = _MEM.get("data")
    if data is None:
        data = storage.load_json(_STORE_KEY, None)
        if data:
            _MEM["data"] = data
    age_days = (now - data["fetchedAt"]) / 86400.0 if data else None
    meta = {"source": "cache", "ageDays": round(age_days, 1) if age_days is not None else None,
            "lastDate": data["dates"][-1] if data else None, "refreshError": None}
    if data and not force_refresh and age_days is not None and age_days < FACTOR_TTL_DAYS:
        return data, meta
    try:
        fresh = _fetch_all()
        storage.save_json(_STORE_KEY, fresh)
        _MEM["data"] = fresh
        return fresh, {"source": "fresh", "ageDays": 0.0, "lastDate": fresh["dates"][-1], "refreshError": None}
    except Exception as e:  # network down, site changed layout, ...
        log.warning("Ken French factor refresh failed: %s", e)
        meta["refreshError"] = str(e)[:200]
        return data, meta


# ── Regression (Newey-West HAC) ──────────────────────────────────────────────

def _auto_lags(n: int) -> int:
    return int(math.floor(4.0 * (n / 100.0) ** (2.0 / 9.0)))


def _norm_sf(x: float) -> float:
    return 0.5 * math.erfc(x / math.sqrt(2.0))


def ols_hac(y: np.ndarray, X: np.ndarray, lags: Optional[int] = None) -> dict:
    n, k = X.shape
    if n <= k + 2:
        raise ValueError("too few observations")
    if lags is None:
        lags = _auto_lags(n)
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    xtx_inv = np.linalg.inv(X.T @ X)
    h = X * resid[:, None]
    S = h.T @ h
    for lag in range(1, lags + 1):
        w = 1.0 - lag / (lags + 1.0)
        G = h[lag:].T @ h[:-lag]
        S += w * (G + G.T)
    cov = xtx_inv @ S @ xtx_inv
    se = np.sqrt(np.maximum(np.diag(cov), 0.0))
    t = np.where(se > 0, beta / se, np.nan)
    tss = float(((y - y.mean()) ** 2).sum())
    r2 = 1.0 - float((resid ** 2).sum()) / tss if tss > 0 else float("nan")
    return {"beta": beta, "se": se, "t": t, "r2": r2, "n": n, "lags": lags}


def attribute(equity_curve: list[dict], factors: dict) -> dict:
    """Run every model on the strategy's daily excess returns. Alphas annualized (×252), %."""
    fdates = factors["dates"]
    fidx = {d: i for i, d in enumerate(fdates)}
    cols = factors["cols"]

    # daily strategy returns keyed by the date the return ends on
    pts = [p for p in equity_curve if p.get("portfolio") is not None]
    rets, dates = [], []
    for a, b in zip(pts[:-1], pts[1:]):
        if a["portfolio"] > 0:
            rets.append(b["portfolio"] / a["portfolio"] - 1.0)
            dates.append(str(b["date"])[:10])
    keep = [i for i, d in enumerate(dates) if d in fidx]
    if len(keep) < 60:
        raise ValueError(f"only {len(keep)} backtest days overlap the factor data "
                         f"(factor data ends {fdates[-1] if fdates else '?'})")
    y_all = np.array([rets[i] for i in keep])
    rows = [fidx[dates[i]] for i in keep]
    F = {c: np.array([cols[c][r] for r in rows]) for c in FACTOR_COLS}
    y = y_all - F["RF"]

    out = []
    for name, facs in MODELS.items():
        X = np.column_stack([np.ones(len(y))] + [F[c] for c in facs])
        r = ols_hac(y, X)
        alpha_ann = float(r["beta"][0]) * 252.0 * 100.0
        out.append({
            "model": name,
            "alphaAnn": round(alpha_ann, 2),
            "alphaT": round(float(r["t"][0]), 2) if math.isfinite(r["t"][0]) else None,
            "alphaP": round(2.0 * _norm_sf(abs(float(r["t"][0]))), 4) if math.isfinite(r["t"][0]) else None,
            "r2": round(r["r2"], 3),
            "loadings": [
                {"factor": c, "beta": round(float(r["beta"][i + 1]), 3),
                 "t": round(float(r["t"][i + 1]), 2) if math.isfinite(r["t"][i + 1]) else None}
                for i, c in enumerate(facs)
            ],
        })
    richest = out[-1]
    return {
        "n": int(len(y)),
        "years": round(len(y) / 252.0, 2),
        "startDate": dates[keep[0]],
        "endDate": dates[keep[-1]],
        "unmatchedDays": int(len(dates) - len(keep)),
        "models": out,
        # Direct answer to "alpha or beta?": significant at 5% against the richest model?
        "alphaSurvives": bool(richest["alphaT"] is not None and abs(richest["alphaT"]) >= 1.96
                              and richest["alphaAnn"] > 0),
        "richestModel": richest["model"],
    }


if __name__ == "__main__":
    # Self-test of the regression engine on synthetic data (no network).
    rng = np.random.default_rng(0)
    n = 4000
    x = rng.normal(size=n)
    yv = 1.5 + 2.0 * x + rng.normal(scale=0.5, size=n)
    r = ols_hac(yv, np.column_stack([np.ones(n), x]))
    assert abs(r["beta"][0] - 1.5) < 0.05 and abs(r["beta"][1] - 2.0) < 0.05
    e = np.zeros(n); sh = rng.normal(size=n)
    for i in range(1, n):
        e[i] = 0.8 * e[i - 1] + sh[i]
    Xc = np.column_stack([np.ones(n), x])
    assert ols_hac(1.0 + e, Xc)["se"][0] > ols_hac(1.0 + e, Xc, lags=0)["se"][0] * 1.2
    print("factors self-test ok")
