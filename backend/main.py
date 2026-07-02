import os
import math
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Union

import json
import numpy as np
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import storage

# Anchor .env to this file's directory so uvicorn can be started from any cwd.
load_dotenv(Path(__file__).parent / ".env", override=True)

P123_API_ID = os.environ.get("P123_API_ID", "")
P123_API_KEY = os.environ.get("P123_API_KEY", "")
P123_BASE_URL = "https://api.portfolio123.com"

app = FastAPI(title="P123 Strategy Tester")

if os.environ.get("ENV") == "development":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ── P123 auth & requests ──────────────────────────────────────────────────────
# P123 auth returns a plain-text Bearer token (not a session cookie).
# Cache token to avoid redundant network auth roundtrips.
_TOKEN_CACHE = {
    "token": None,
    "expiry": 0.0
}

# P123 allows only ONE in-flight request per API key; a second concurrent
# request fails. Serialize every call through this lock.
_P123_LOCK = threading.Lock()

# Last-seen quota info, harvested from every P123 response body (SharedResult).
QUOTA_STATE: dict = {"quotaRemaining": None, "lastCost": None, "updatedAt": None}


def _bearer_token() -> str:
    """Authenticate and return a fresh or cached Bearer token."""
    now = time.time()
    if _TOKEN_CACHE["token"] and _TOKEN_CACHE["expiry"] > now + 30:
        return _TOKEN_CACHE["token"]

    r = requests.post(
        f"{P123_BASE_URL}/auth",
        json={"apiId": P123_API_ID, "apiKey": P123_API_KEY},
        timeout=30,
    )
    r.raise_for_status()
    token = r.text.strip()

    expires_in_sec = 3600
    try:
        expires_in_hdr = r.headers.get("X-Expires-In")
        if expires_in_hdr:
            expires_in_sec = int(expires_in_hdr)
    except Exception:
        pass

    _TOKEN_CACHE["token"] = token
    _TOKEN_CACHE["expiry"] = now + expires_in_sec
    return token


def _p123_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_bearer_token()}"})
    return s


def _track_quota(data: Any) -> None:
    if isinstance(data, dict) and "quotaRemaining" in data:
        QUOTA_STATE["quotaRemaining"] = data.get("quotaRemaining")
        QUOTA_STATE["lastCost"] = data.get("cost")
        QUOTA_STATE["updatedAt"] = datetime.utcnow().isoformat() + "Z"


def _p123_request(method: str, endpoint: str, payload: Optional[dict] = None,
                  params: Optional[dict] = None, timeout: int = 120) -> Any:
    with _P123_LOCK:
        s = _p123_session()
        r = s.request(method, f"{P123_BASE_URL}{endpoint}", json=payload,
                      params=params, timeout=timeout)
    if not r.ok:
        detail = r.text
        try:
            detail = r.json().get("message", r.text)
        except Exception:
            pass
        raise HTTPException(status_code=r.status_code, detail=detail)
    try:
        data = r.json()
    except Exception:
        return None
    _track_quota(data)
    return data


def p123_post(endpoint: str, payload: dict) -> Any:
    return _p123_request("POST", endpoint, payload=payload)


def p123_get(endpoint: str, params: Optional[dict] = None, timeout: int = 120) -> Any:
    return _p123_request("GET", endpoint, params=params, timeout=timeout)


# ── Durable app state (GCS-backed on Cloud Run, local files in dev) ───────────

def _dedupe(items: list[dict], key) -> list[dict]:
    seen: set = set()
    out = []
    for it in items:
        k = key(it)
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def _load_strategies_list() -> list[dict]:
    strategies = storage.load_json("strategies", None)
    if strategies is None:
        # Fallback to .env
        sids = [sid.strip() for sid in os.environ.get("P123_STRATEGY_IDS", "").split(",") if sid.strip()]
        strategies = []
        for sid in sids:
            try:
                strategies.append({"id": int(sid), "name": f"Strategy {sid}"})
            except ValueError:
                pass
    return _dedupe(strategies, lambda s: s["id"])


def _save_strategies_list(strategies: list[dict]):
    storage.save_json("strategies", _dedupe(strategies, lambda s: s["id"]))


DEFAULT_UNIVERSES = [
    {"value": "SP500", "label": "S&P 500"},
    {"value": "SP400", "label": "S&P 400 (Mid Cap)"},
    {"value": "SP600", "label": "S&P 600 (Small Cap)"},
    {"value": "SP1500", "label": "S&P 1500"},
    {"value": "Prussell1000", "label": "Russell 1000"},
    {"value": "Prussell2000", "label": "Russell 2000"},
    {"value": "Prussell3000", "label": "Russell 3000"},
    {"value": "ALLSTOCKS", "label": "All Stocks"},
    {"value": "NASDAQ100", "label": "NASDAQ 100"},
    {"value": "LargeCap", "label": "Large Cap"},
    {"value": "MidCap", "label": "Mid Cap"},
    {"value": "SmallCap", "label": "Small Cap"},
    {"value": "MicroCap", "label": "Micro Cap"},
]

# Ranking systems auto-register when a strategy that uses them is loaded;
# custom entries can be added in the UI.
DEFAULT_RANKING_SYSTEMS: list[dict] = []


def _load_universes() -> list[dict]:
    universes = storage.load_json("universes", DEFAULT_UNIVERSES)
    return _dedupe(universes, lambda u: str(u["value"]).strip().lower())


def _save_universes(universes: list[dict]):
    storage.save_json("universes", _dedupe(universes, lambda u: str(u["value"]).strip().lower()))


def _load_ranking_systems() -> list[dict]:
    systems = storage.load_json("ranking_systems", DEFAULT_RANKING_SYSTEMS)
    return _dedupe(systems, lambda s: s["id"])


def _save_ranking_systems(ranking_systems: list[dict]):
    storage.save_json("ranking_systems", _dedupe(ranking_systems, lambda s: s["id"]))


DEFAULT_SETTINGS = {
    # A scratch SIM on P123 that hosts test reruns so real strategies are never
    # modified. Create one in the P123 UI (any config), then paste its ID here.
    "shadowSimId": None,
    # Optional second scratch SIM whose rebalance sizing is STATIC (position
    # weight %) — used for targets with STATIC sizing, since the API cannot
    # change a sim's sizing method.
    "shadowSimIdStatic": None,
}


def _load_settings() -> dict:
    settings = storage.load_json("settings", {})
    return {**DEFAULT_SETTINGS, **settings}


def _save_settings(settings: dict):
    storage.save_json("settings", settings)


STRATEGY_CACHE: dict = {}
_SHADOW_TS_CACHE: dict = {}  # shadow sim id -> {"sizingMethod": ...}


# ── Static config ──────────────────────────────────────────────────────────────

REBAL_FREQUENCIES = [
    {"value": "Every Day", "label": "Daily"},
    {"value": "Every Week", "label": "Weekly"},
    {"value": "Every 2 Weeks", "label": "Every 2 Weeks"},
    {"value": "Every 4 Weeks", "label": "Every 4 Weeks"},
    {"value": "Every 13 Weeks", "label": "Quarterly"},
    {"value": "Every 26 Weeks", "label": "Semi-Annual"},
    {"value": "Every 52 Weeks", "label": "Annual"},
]

BENCHMARKS = [
    {"value": "SPY", "label": "S&P 500 (SPY)"},
    {"value": "QQQ", "label": "NASDAQ 100 (QQQ)"},
    {"value": "IWM", "label": "Russell 2000 (IWM)"},
    {"value": "DIA", "label": "Dow Jones (DIA)"},
]

# Verified P123 formula dictionary, generated from the official Factor Reference
# extraction by generate_autocomplete.py. Loaded once at startup.
AUTOCOMPLETE_FILE = Path(__file__).parent / "p123_autocomplete.json"
try:
    with open(AUTOCOMPLETE_FILE) as f:
        AUTOCOMPLETE_ITEMS = json.load(f)
except Exception:
    AUTOCOMPLETE_ITEMS = []


# ── API routes ─────────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {
        "universes": _load_universes(),
        "rebalFrequencies": REBAL_FREQUENCIES,
        "benchmarks": BENCHMARKS,
    }


@app.get("/api/quota")
def get_quota():
    return QUOTA_STATE


@app.get("/api/autocomplete")
def get_autocomplete():
    return AUTOCOMPLETE_ITEMS


class SettingsRequest(BaseModel):
    shadowSimId: Optional[int] = None
    shadowSimIdStatic: Optional[int] = None


@app.get("/api/settings")
def get_settings():
    return _load_settings()


@app.put("/api/settings")
def update_settings(req: SettingsRequest):
    settings = _load_settings()
    for sid in (req.shadowSimId, req.shadowSimIdStatic):
        if sid is not None and sid > 0:
            _validate_shadow_sim(sid)
    settings["shadowSimId"] = req.shadowSimId if (req.shadowSimId or 0) > 0 else None
    settings["shadowSimIdStatic"] = req.shadowSimIdStatic if (req.shadowSimIdStatic or 0) > 0 else None
    _save_settings(settings)
    _SHADOW_TS_CACHE.clear()
    return settings


def _validate_shadow_sim(sim_id: int):
    """A shadow sim must be a plain simulation the account can rerun."""
    try:
        ts_data = p123_get(f"/strategy/{sim_id}/trading-system")
        ts = ts_data.get("tradingSystem", {})
        det = p123_get(f"/strategy/{sim_id}")
        info = det.get("summary", {}).get("generalInfo", {})
    except HTTPException as he:
        raise HTTPException(status_code=400,
                            detail=f"Shadow sim {sim_id} could not be loaded from Portfolio123: {he.detail}")
    if "assets" in ts:
        raise HTTPException(status_code=400, detail=f"Strategy {sim_id} is a Book — a shadow sim must be a plain Simulation.")
    if info.get("rebalMode") is not None or info.get("nextRebal") is not None:
        raise HTTPException(status_code=400, detail=f"Strategy {sim_id} is a Live Portfolio — a shadow sim must be a Simulation.")
    _SHADOW_TS_CACHE[sim_id] = {
        "sizingMethod": ts.get("rebalance", {}).get("sizingMethod", "DYNAMIC")
    }


class UniverseAddRequest(BaseModel):
    value: str
    label: str


@app.post("/api/universes")
def add_universe(req: UniverseAddRequest):
    universes = _load_universes()
    for u in universes:
        if u["value"] == req.value:
            u["label"] = req.label
            break
    else:
        universes.append({"value": req.value, "label": req.label})
    _save_universes(universes)
    return _load_universes()


@app.delete("/api/universes/{value}")
def delete_universe(value: str):
    universes = _load_universes()
    universes = [u for u in universes if u["value"] != value]
    _save_universes(universes)
    return universes


class RankingSystemAddRequest(BaseModel):
    id: int
    name: str


@app.get("/api/ranking-systems")
def list_ranking_systems(q: str = Query(default="")):
    systems = sorted(_load_ranking_systems(), key=lambda x: x["name"])
    if not q:
        return systems
    ql = q.lower()
    return [s for s in systems if ql in s["name"].lower()]


@app.post("/api/ranking-systems")
def add_ranking_system(req: RankingSystemAddRequest):
    systems = _load_ranking_systems()
    for s in systems:
        if s["id"] == req.id:
            s["name"] = req.name
            break
    else:
        systems.append({"id": req.id, "name": req.name})
    _save_ranking_systems(systems)
    return sorted(_load_ranking_systems(), key=lambda x: x["name"])


@app.delete("/api/ranking-systems/{system_id}")
def delete_ranking_system(system_id: int):
    systems = _load_ranking_systems()
    systems = [s for s in systems if s["id"] != system_id]
    _save_ranking_systems(systems)
    return sorted(systems, key=lambda x: x["name"])


def _classify_strategy(sid: str, fallback_name: str) -> dict:
    """Fetch and cache a strategy's name/type; persist to storage to survive restarts."""
    if sid in STRATEGY_CACHE:
        return STRATEGY_CACHE[sid]
    try:
        det = p123_get(f"/strategy/{sid}", timeout=15)
        ts_data = p123_get(f"/strategy/{sid}/trading-system", timeout=15)
        info = det.get("summary", {}).get("generalInfo", {})
        entry = {
            "name": info.get("name", fallback_name),
            "is_book": "assets" in ts_data.get("tradingSystem", {}),
            "is_live": info.get("rebalMode") is not None or info.get("nextRebal") is not None,
        }
    except Exception:
        entry = {"name": fallback_name, "is_book": False, "is_live": False}
    STRATEGY_CACHE[sid] = entry
    return entry


@app.get("/api/strategies")
def get_strategies():
    strategies_config = _load_strategies_list()
    results = []
    dirty = False

    for item in strategies_config:
        sid = str(item["id"])
        # Prefer metadata persisted alongside the id (no P123 round-trip needed).
        if "is_book" in item and "is_live" in item and sid not in STRATEGY_CACHE:
            STRATEGY_CACHE[sid] = {
                "name": item.get("name", f"Strategy {sid}"),
                "is_book": item["is_book"],
                "is_live": item["is_live"],
            }
        entry = _classify_strategy(sid, item.get("name", f"Strategy {sid}"))

        # Persist fresh metadata so future cold starts skip the API calls.
        if item.get("name") != entry["name"] or item.get("is_book") != entry["is_book"] or item.get("is_live") != entry["is_live"]:
            item.update({"name": entry["name"], "is_book": entry["is_book"], "is_live": entry["is_live"]})
            dirty = True

        if entry["is_book"]:
            label = f"{entry['name']} (Book)"
        elif entry["is_live"]:
            label = f"{entry['name']} (Live Portfolio)"
        else:
            label = f"{entry['name']} (Simulation)"

        results.append({
            "value": int(sid),
            "label": label,
            "isBook": entry["is_book"],
            "isLive": entry["is_live"],
        })

    if dirty:
        _save_strategies_list(strategies_config)
    return results


class StrategyAddRequest(BaseModel):
    id: int


@app.post("/api/strategies")
def add_strategy(req: StrategyAddRequest):
    strategies = _load_strategies_list()
    if any(s["id"] == req.id for s in strategies):
        return get_strategies()

    try:
        det = p123_get(f"/strategy/{req.id}")
        name = det.get("summary", {}).get("generalInfo", {}).get("name", f"Strategy {req.id}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch strategy from Portfolio123: {str(e)}")

    strategies.append({"id": req.id, "name": name})
    _save_strategies_list(strategies)

    STRATEGY_CACHE.pop(str(req.id), None)
    return get_strategies()


@app.delete("/api/strategies/{strategy_id}")
def delete_strategy(strategy_id: int):
    strategies = _load_strategies_list()
    strategies = [s for s in strategies if s["id"] != strategy_id]
    _save_strategies_list(strategies)
    STRATEGY_CACHE.pop(str(strategy_id), None)
    return get_strategies()


class RuleModel(BaseModel):
    formula: str
    disabled: bool = False

def parse_rules(rules: list[Union[RuleModel, str]]) -> list[dict]:
    res = []
    for r in rules:
        if isinstance(r, str):
            if r.strip():
                res.append({"formula": r.strip(), "disabled": False})
        else:
            if r.formula.strip():
                res.append({"formula": r.formula.strip(), "disabled": r.disabled})
    return res

class StrategyUpdateRequest(BaseModel):
    universe: str
    rankingSystem: str
    buyRules: list[Union[RuleModel, str]]
    sellRules: list[Union[RuleModel, str]]
    holdings: int
    rebalFreq: str


@app.post("/api/strategies/{strategy_id}/trading-system")
def update_strategy_trading_system_api(strategy_id: int, req: StrategyUpdateRequest):
    try:
        ts_data = p123_get(f"/strategy/{strategy_id}/trading-system")
        ts = ts_data.get("tradingSystem", {})

        det_data = p123_get(f"/strategy/{strategy_id}")
        info = det_data.get("summary", {}).get("generalInfo", {})

        is_book = "assets" in ts
        is_live = info.get("rebalMode") is not None or info.get("nextRebal") is not None

        if is_book:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy {strategy_id} is a Book strategy, which cannot be modified."
            )

        if not is_live:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy {strategy_id} is a Simulated strategy (SIM). Portfolio123 does not allow editing simulated strategy configuration parameters via the API."
            )

        rebal = ts.get("rebalance", {})
        sizing_method = rebal.get("sizingMethod", "DYNAMIC")
        rebal_params = _build_rebal_params(sizing_method, req.holdings, req.rebalFreq, rebal)

        payload = {
            "universe": _universe_param(req.universe),
            "rankingSystem": req.rankingSystem,
            "rankingMethod": ts.get("rankingMethod", 0),
            "buyRules": parse_rules(req.buyRules),
            "sellRules": parse_rules(req.sellRules),
            "rebalance": rebal_params
        }

        p123_post(f"/strategy/{strategy_id}/trading-system", payload)

        sid_str = str(strategy_id)
        if sid_str in STRATEGY_CACHE:
            STRATEGY_CACHE[sid_str]["name"] = info.get("name", STRATEGY_CACHE[sid_str]["name"])

        return {"status": "success", "message": f"Strategy {strategy_id} successfully updated on Portfolio123.",
                "quota": QUOTA_STATE}

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class BacktestRequest(BaseModel):
    strategyId: int
    startDate: str
    endDate: str
    universe: Optional[str] = None
    rankingSystem: Optional[str] = None
    buyRules: Optional[list[Union[RuleModel, str]]] = None
    sellRules: Optional[list[Union[RuleModel, str]]] = None
    holdings: Optional[int] = None
    rebalFreq: Optional[str] = None


def _universe_param(universe: str) -> Union[str, int]:
    universe = universe.strip()
    if universe.isdigit():
        return -int(universe)
    return universe


def _build_rebal_params(sizing_method: str, holdings: Optional[int], rebal_freq: Optional[str],
                        fallback_rebal: dict) -> dict:
    freq = rebal_freq if rebal_freq else fallback_rebal.get("rebalFreq", "Every Week")
    if sizing_method in ("STATIC", "STATIC_OLD"):
        if holdings is not None:
            pos_weight = round(100.0 / max(1, holdings), 2)
        else:
            pos_weight = fallback_rebal.get("posWeight", 6.67)
        return {"sizingMethod": sizing_method, "rebalFreq": freq, "posWeight": pos_weight}
    return {
        "sizingMethod": "DYNAMIC",
        "numPos": holdings if holdings is not None else fallback_rebal.get("numPos", 15),
        "rebalFreq": freq,
        "reconFreq": freq,
    }


def _map_universe_uid_to_code(universe_uid: int, universe_name: str) -> str:
    if universe_uid < 0:
        return str(abs(universe_uid))

    name_lower = universe_name.lower()

    # 1. Custom UID overrides
    if universe_uid == 19114:
        return "SP500"
    if universe_uid == 23465:
        return "LargeCap"
    if universe_uid == 43418:
        return "ALLSTOCKS"

    # 2. Substring matching (Check SP500 before Large Cap to avoid wrong matches on S&P500 LargeCap name)
    if "sp500" in name_lower or "s&p 500" in name_lower or "s&p500" in name_lower:
        return "SP500"
    if "largecap" in name_lower or "large cap" in name_lower:
        return "LargeCap"
    if "sp400" in name_lower or "s&p 400" in name_lower or "s&p400" in name_lower:
        return "SP400"
    if "sp600" in name_lower or "s&p 600" in name_lower or "s&p600" in name_lower:
        return "SP600"
    if "sp1500" in name_lower or "s&p 1500" in name_lower or "s&p1500" in name_lower:
        return "SP1500"
    if "russell 1000" in name_lower:
        return "Prussell1000"
    if "russell 2000" in name_lower:
        return "Prussell2000"
    if "russell 3000" in name_lower:
        return "Prussell3000"
    if "all listed stocks" in name_lower or "all listed" in name_lower or "allstocks" in name_lower or "all stocks" in name_lower:
        return "ALLSTOCKS"
    if "nasdaq" in name_lower or "nasdaq 100" in name_lower or "nasdaq100" in name_lower:
        return "NASDAQ100"
    if "midcap" in name_lower or "mid cap" in name_lower:
        return "MidCap"
    if "smallcap" in name_lower or "small cap" in name_lower:
        return "SmallCap"
    if "microcap" in name_lower or "micro cap" in name_lower:
        return "MicroCap"

    return universe_name


@app.get("/api/strategies/{strategy_id}/trading-system")
def get_strategy_trading_system(strategy_id: int):
    try:
        ts_data = p123_get(f"/strategy/{strategy_id}/trading-system")
        ts = ts_data.get("tradingSystem", {})

        det_data = p123_get(f"/strategy/{strategy_id}")
        info = det_data.get("summary", {}).get("generalInfo", {})

        # Verify strategy type (must not be a book strategy)
        sid_str = str(strategy_id)
        is_book = "assets" in ts
        is_live = info.get("rebalMode") is not None or info.get("nextRebal") is not None

        if sid_str not in STRATEGY_CACHE:
            STRATEGY_CACHE[sid_str] = {
                "name": info.get("name", f"Strategy {strategy_id}"),
                "is_book": is_book,
                "is_live": is_live
            }

        if is_book:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy {strategy_id} is a Book strategy (which contains other sub-strategies/assets) and does not support individual rules-based backtests. Please enter a Simulation ID (SIM) instead."
            )

        # Extract fields to match our StrategyConfig structure
        buy_rules = [{"formula": r.get("formula", ""), "disabled": r.get("disabled", False)} for r in ts.get("buyRules", [])]
        sell_rules = [{"formula": r.get("formula", ""), "disabled": r.get("disabled", False)} for r in ts.get("sellRules", [])]

        rebal = ts.get("rebalance", {})
        holdings = rebal.get("numPos", 15)
        if rebal.get("sizingMethod") in ("STATIC", "STATIC_OLD"):
            # Translate posWeight back to holdings
            pos_weight = rebal.get("posWeight", 6.67)
            if pos_weight > 0:
                holdings = int(round(100.0 / pos_weight))

        ranking_sys = ts.get("rankingSystem", "")
        ranking_sys_uid = ts.get("rankingSystemUid")
        if ranking_sys_uid:
            try:
                systems = _load_ranking_systems()
                if not any(rs["id"] == ranking_sys_uid for rs in systems):
                    systems.append({"id": ranking_sys_uid, "name": ranking_sys})
                    _save_ranking_systems(systems)
            except Exception as e:
                print(f"Failed to auto-register ranking system: {e}")

            # Fallback to name if rank UID is matched in our list
            for rs in _load_ranking_systems():
                if rs["id"] == ranking_sys_uid:
                    ranking_sys = rs["name"]
                    break

        universe_uid = ts.get("universeUid", 0)
        universe_name = ts.get("universe", "SP500")
        universe_code = _map_universe_uid_to_code(universe_uid, universe_name)

        # Auto-register universe if not in list (idempotent: matched on normalized value)
        try:
            universes_list = _load_universes()
            norm = universe_code.strip().lower()
            if not any(str(u["value"]).strip().lower() == norm for u in universes_list):
                universes_list.append({"value": universe_code, "label": universe_name})
                _save_universes(universes_list)
        except Exception as e:
            print(f"Failed to auto-register universe: {e}")

        return {
            "universe": universe_code,
            "rankingSystem": ranking_sys,
            "buyRules": buy_rules if buy_rules else [{"formula": "", "disabled": False}],
            "sellRules": sell_rules if sell_rules else [{"formula": "", "disabled": False}],
            "holdings": holdings,
            "rebalFreq": rebal.get("rebalFreq", "Every Week"),
            "benchmark": info.get("benchmark", "SPY"),
            "sizingMethod": rebal.get("sizingMethod", "DYNAMIC"),
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


def _shadow_sizing_method(shadow_id: int) -> str:
    if shadow_id not in _SHADOW_TS_CACHE:
        ts_data = p123_get(f"/strategy/{shadow_id}/trading-system")
        _SHADOW_TS_CACHE[shadow_id] = {
            "sizingMethod": ts_data.get("tradingSystem", {}).get("rebalance", {}).get("sizingMethod", "DYNAMIC")
        }
    return _SHADOW_TS_CACHE[shadow_id]["sizingMethod"]


def _pick_shadow_sim(target_sizing: str) -> Optional[int]:
    """Pick the configured scratch sim, preferring one whose sizing method matches the target."""
    settings = _load_settings()
    dyn = settings.get("shadowSimId")
    static = settings.get("shadowSimIdStatic")
    if target_sizing in ("STATIC", "STATIC_OLD") and static:
        return static
    return dyn or static


def _run_rerun(run_id: int, target_ts: dict, req: BacktestRequest, sizing_method: str) -> dict:
    """Rerun `run_id` with the requested config (defaults from target_ts) and return results."""
    rebal = target_ts.get("rebalance", {})
    rebal_params = _build_rebal_params(sizing_method, req.holdings, req.rebalFreq, rebal)

    buy_rules = parse_rules(req.buyRules) if req.buyRules is not None else target_ts.get("buyRules", [])
    sell_rules = parse_rules(req.sellRules) if req.sellRules is not None else target_ts.get("sellRules", [])

    universe = _universe_param(req.universe) if req.universe is not None else target_ts.get("universe", "SP500")
    ranking_system = req.rankingSystem if req.rankingSystem is not None else target_ts.get("rankingSystem", "")

    rerun_payload = {
        "startDt": req.startDate,
        "endDt": req.endDate,
        "saveTrans": True,
        "universe": universe,
        "rankingSystem": ranking_system,
        "rankingMethod": target_ts.get("rankingMethod", 0),
        "buyRules": buy_rules,
        "sellRules": sell_rules,
        "rebalance": rebal_params
    }

    try:
        p123_post(f"/strategy/{run_id}/rerun", rerun_payload)
    except HTTPException as he:
        if "Only StrategySim supported" in str(he.detail):
            raise HTTPException(
                status_code=400,
                detail=f"Strategy {run_id} is a Live Portfolio (PTF) or Designer Model (DM), not a Simulation (SIM). Portfolio123 only allows rerunning simulated strategies via the API. Please enter a Simulation ID (SIM) instead."
            )
        raise he

    raw_results = p123_get(f"/strategy/{run_id}")
    return build_response(raw_results)


@app.post("/api/backtest")
def run_backtest(req: BacktestRequest):
    # 1. Fetch the target's trading system for defaults (universe, rules, sizing method).
    try:
        ts_data = p123_get(f"/strategy/{req.strategyId}/trading-system")
        ts = ts_data.get("tradingSystem", {})
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to fetch baseline trading system details for strategy {req.strategyId}: {str(e)}"
        )

    target_sizing = ts.get("rebalance", {}).get("sizingMethod", "DYNAMIC")

    # 2. Run on the shadow (scratch) sim so the real strategy is never modified.
    shadow_id = _pick_shadow_sim(target_sizing)
    warning = None
    if shadow_id:
        run_id = shadow_id
        # The API cannot change a sim's sizing method, so the payload must use
        # the shadow's own method; holdings are translated accordingly.
        sizing_method = _shadow_sizing_method(shadow_id)
        if sizing_method != target_sizing and target_sizing in ("STATIC", "STATIC_OLD"):
            warning = ("Target uses STATIC position sizing but the shadow sim is DYNAMIC — "
                       "test results use dynamic sizing (equal position count). Add a STATIC "
                       "shadow sim in Settings for an exact match.")
    else:
        run_id = req.strategyId
        sizing_method = target_sizing
        warning = (f"No shadow sim configured — this run modified simulation {req.strategyId} "
                   "on Portfolio123. Create a scratch SIM on P123 and add its ID in Settings "
                   "so tests never touch your real strategies.")

    result = _run_rerun(run_id, ts, req, sizing_method)
    result["runSimId"] = run_id
    result["shadowUsed"] = bool(shadow_id)
    result["warning"] = warning
    result["quota"] = QUOTA_STATE
    return result


@app.post("/api/strategies/{strategy_id}/commit")
def commit_strategy(strategy_id: int, req: BacktestRequest):
    """Persist the tested config to the REAL simulation by rerunning it once.

    This is the only code path (besides the live-strategy trading-system update)
    that writes to a real strategy.
    """
    try:
        ts_data = p123_get(f"/strategy/{strategy_id}/trading-system")
        ts = ts_data.get("tradingSystem", {})
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch strategy {strategy_id}: {str(e)}")

    sizing_method = ts.get("rebalance", {}).get("sizingMethod", "DYNAMIC")
    result = _run_rerun(strategy_id, ts, req, sizing_method)
    result["runSimId"] = strategy_id
    result["shadowUsed"] = False
    result["warning"] = None
    result["quota"] = QUOTA_STATE
    result["message"] = f"Configuration committed to simulation {strategy_id} on Portfolio123."
    return result


@app.get("/api/strategies/{strategy_id}/transactions")
def get_strategy_transactions(strategy_id: int, start: str, end: str):
    data = p123_get(f"/strategy/{strategy_id}/transactions", params={"start": start, "end": end})
    trans = data.get("trans", data) if isinstance(data, dict) else data
    return {"trans": trans or [], "quota": QUOTA_STATE}


# ── Monte Carlo & robustness analytics ────────────────────────────────────────
# These run entirely on data already returned by a backtest (daily equity curve
# and the sim's transaction log) — no P123 quota is consumed except a single
# cached transactions fetch for trade-level stats.

_TRANS_CACHE: dict = {}  # (simId, start, end) -> list of transactions
_TRANS_CACHE_MAX = 8


def _fetch_transactions_cached(sim_id: int, start: str, end: str) -> list[dict]:
    key = (sim_id, start, end)
    if key not in _TRANS_CACHE:
        data = p123_get(f"/strategy/{sim_id}/transactions", params={"start": start, "end": end})
        trans = data.get("trans", []) if isinstance(data, dict) else (data or [])
        if len(_TRANS_CACHE) >= _TRANS_CACHE_MAX:
            _TRANS_CACHE.pop(next(iter(_TRANS_CACHE)))
        _TRANS_CACHE[key] = trans
    return _TRANS_CACHE[key]


def _tget(t: dict, *keys, default=None):
    for k in keys:
        if k in t and t[k] is not None:
            return t[k]
    return default


_SPLIT_RATIO_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)", re.IGNORECASE)


def _round_trip_pnl(trans: list[dict]) -> list[float]:
    """Pair BUY/SELL (and SHORT/COVER) into FIFO round trips → % P&L per trade.

    Dividends are excluded (price return only). On a split whose ratio can't be
    parsed from the note, open lots for that ticker are dropped rather than
    producing a garbage return.
    """
    def sort_key(t):
        return str(_tget(t, "tranDt", "date", "dt", default=""))

    lots: dict = defaultdict(deque)        # ticker -> deque of [shares, price] (longs)
    short_lots: dict = defaultdict(deque)  # ticker -> deque of [shares, price] (shorts)
    pnl: list[float] = []

    def close_against(book, ticker, shares, price, short: bool):
        remaining = abs(shares)
        entry_cost = 0.0
        entry_shares = 0.0
        q = book[ticker]
        while remaining > 1e-9 and q:
            lot = q[0]
            take = min(lot[0], remaining)
            entry_cost += take * lot[1]
            entry_shares += take
            lot[0] -= take
            remaining -= take
            if lot[0] <= 1e-9:
                q.popleft()
        if entry_shares > 0 and entry_cost > 0:
            avg_entry = entry_cost / entry_shares
            ret = (price - avg_entry) / avg_entry * 100.0
            pnl.append(-ret if short else ret)

    for t in sorted(trans, key=sort_key):
        typ = str(_tget(t, "type", "transType", "action", default="")).upper()
        ticker = str(_tget(t, "ticker", "symbol", default=""))
        shares = safe_float(_tget(t, "shares"), 0.0) or 0.0
        price = safe_float(_tget(t, "price"), 0.0) or 0.0
        if not ticker:
            continue
        if typ == "BUY" and shares != 0 and price > 0:
            lots[ticker].append([abs(shares), price])
        elif typ == "SELL" and price > 0:
            close_against(lots, ticker, shares, price, short=False)
        elif typ == "SHORT" and shares != 0 and price > 0:
            short_lots[ticker].append([abs(shares), price])
        elif typ == "COVER" and price > 0:
            close_against(short_lots, ticker, shares, price, short=True)
        elif typ == "SPLIT":
            note = str(_tget(t, "note", "notes", default=""))
            m = _SPLIT_RATIO_RE.search(note)
            for book in (lots, short_lots):
                if ticker not in book:
                    continue
                if m:
                    a, b = float(m.group(1)), float(m.group(2))
                    if a > 0 and b > 0:
                        for lot in book[ticker]:
                            lot[0] *= a / b
                            lot[1] *= b / a
                        continue
                book[ticker].clear()
    return pnl


def _pctiles(arr, qs=(5, 25, 50, 75, 95)):
    vals = np.percentile(arr, qs)
    return {f"p{q}": round(float(v), 4) for q, v in zip(qs, vals)}


class MonteCarloRequest(BaseModel):
    portfolio: list[float]
    benchmark: list[float]
    horizonYears: float = 5
    numPaths: int = 1000
    blockDays: int = 20
    simId: Optional[int] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None


@app.post("/api/montecarlo")
def monte_carlo(req: MonteCarloRequest):
    p = np.asarray([v for v in req.portfolio if v and math.isfinite(v)], dtype=np.float64)
    b = np.asarray([v for v in req.benchmark if v and math.isfinite(v)], dtype=np.float64)
    n = min(len(p), len(b))
    if n < 260:
        raise HTTPException(status_code=400, detail="Need at least one year of daily equity data for Monte Carlo.")
    p, b = p[:n], b[:n]
    r_p = p[1:] / p[:-1] - 1.0
    r_b = b[1:] / b[:-1] - 1.0

    years = min(max(req.horizonYears, 1.0), 20.0)
    block = int(min(max(req.blockDays, 5), 120))
    horizon = int(252 * years)
    num_paths = int(min(max(req.numPaths, 100), 2000))
    # Memory guard: cap total simulated cells.
    max_cells = 6_000_000
    if num_paths * horizon > max_cells:
        num_paths = max(100, max_cells // horizon)

    rng = np.random.default_rng()
    nret = len(r_p)
    if nret <= block:
        raise HTTPException(status_code=400, detail="Equity history too short for the chosen block size.")
    nblocks = math.ceil(horizon / block)
    starts = rng.integers(0, nret - block + 1, size=(num_paths, nblocks))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(num_paths, -1)[:, :horizon]

    # Paired resampling: the same blocks drive portfolio and benchmark, so their
    # correlation (and thus P(underperformance)) is preserved.
    paths_p = np.cumprod(1.0 + r_p[idx], axis=1)
    paths_b = np.cumprod(1.0 + r_b[idx], axis=1)

    # Fan chart: percentile cone at ~150 downsampled steps.
    cols = np.unique(np.linspace(0, horizon - 1, 150).astype(int))
    fan_q = np.percentile(paths_p[:, cols], [5, 25, 50, 75, 95], axis=0)
    fan = [
        {
            "years": round(float((c + 1) / 252.0), 3),
            "p5": round(float(fan_q[0, j]), 4),
            "p25": round(float(fan_q[1, j]), 4),
            "p50": round(float(fan_q[2, j]), 4),
            "p75": round(float(fan_q[3, j]), 4),
            "p95": round(float(fan_q[4, j]), 4),
        }
        for j, c in enumerate(cols)
    ]

    terminal = paths_p[:, -1]
    terminal_b = paths_b[:, -1]
    cagr = terminal ** (1.0 / years) - 1.0

    dd = paths_p / np.maximum.accumulate(paths_p, axis=1) - 1.0
    max_dd = dd.min(axis=1) * 100.0

    hist_counts, hist_edges = np.histogram(max_dd, bins=15)
    dd_hist = [
        {"bin": round(float((hist_edges[i] + hist_edges[i + 1]) / 2), 2), "count": int(c)}
        for i, c in enumerate(hist_counts)
    ]

    result: dict = {
        "numPaths": num_paths,
        "horizonYears": years,
        "blockDays": block,
        "fan": fan,
        "cagr": {**_pctiles(cagr * 100)},
        "terminalMultiple": {**_pctiles(terminal)},
        "maxDrawdown": {**_pctiles(max_dd)},
        "ddHistogram": dd_hist,
        "probLoss": round(float(np.mean(terminal < 1.0)), 4),
        "probUnderperformBench": round(float(np.mean(terminal < terminal_b)), 4),
        "probDDWorseThan": {
            str(th): round(float(np.mean(max_dd < -th)), 4) for th in (20, 30, 40, 50)
        },
    }

    # Trade-level bootstrap (optional; one cached transactions fetch).
    if req.simId and req.startDate and req.endDate:
        try:
            trans = _fetch_transactions_cached(req.simId, req.startDate, req.endDate)
            trades = np.asarray(_round_trip_pnl(trans), dtype=np.float64)
            if len(trades) >= 30:
                nboot = 2000
                samples = rng.choice(trades, size=(nboot, len(trades)), replace=True)
                means = samples.mean(axis=1)
                losses = samples < 0
                # Longest losing streak per resample.
                streaks = np.zeros(nboot)
                for i in range(nboot):
                    run = best = 0
                    for is_loss in losses[i]:
                        run = run + 1 if is_loss else 0
                        best = max(best, run)
                    streaks[i] = best
                result["trades"] = {
                    "count": int(len(trades)),
                    "winRate": round(float(np.mean(trades > 0) * 100), 2),
                    "avgTradePct": round(float(trades.mean()), 3),
                    "expectancyCI": _pctiles(means, (5, 50, 95)),
                    "maxLosingStreak": _pctiles(streaks, (50, 95)),
                    "probNegativeExpectancy": round(float(np.mean(means < 0)), 4),
                }
            else:
                result["tradesNote"] = f"Only {len(trades)} closed round trips — need 30+ for meaningful trade-level stats."
        except HTTPException as he:
            result["tradesNote"] = f"Trade stats unavailable: {he.detail}"

    result["quota"] = QUOTA_STATE
    return result


class RollingWindowsRequest(BaseModel):
    dates: list[str]
    portfolio: list[float]
    benchmark: list[float]
    windowYears: int = 5


@app.post("/api/rolling-windows")
def rolling_windows(req: RollingWindowsRequest):
    n = min(len(req.dates), len(req.portfolio), len(req.benchmark))
    p = np.asarray(req.portfolio[:n], dtype=np.float64)
    b = np.asarray(req.benchmark[:n], dtype=np.float64)
    years = min(max(req.windowYears, 1), 15)
    window = int(252 * years)
    if n < window + 20:
        raise HTTPException(
            status_code=400,
            detail=f"Backtest covers less than {years} years — shorten the window or lengthen the test period."
        )

    step = 5  # weekly starts
    rows = []
    for i in range(0, n - window, step):
        j = i + window
        seg = p[i:j + 1]
        cagr = (seg[-1] / seg[0]) ** (1.0 / years) - 1.0
        bench_cagr = (b[j] / b[i]) ** (1.0 / years) - 1.0
        max_dd = float((seg / np.maximum.accumulate(seg) - 1.0).min() * 100.0)
        rows.append({
            "start": req.dates[i],
            "cagr": round(float(cagr * 100), 2),
            "benchCagr": round(float(bench_cagr * 100), 2),
            "maxDD": round(max_dd, 2),
        })

    cagrs = np.asarray([r["cagr"] for r in rows])
    dds = np.asarray([r["maxDD"] for r in rows])
    beat = np.asarray([r["cagr"] > r["benchCagr"] for r in rows])
    return {
        "windowYears": years,
        "windows": rows,
        "summary": {
            "count": len(rows),
            "medianCagr": round(float(np.median(cagrs)), 2),
            "worstCagr": round(float(cagrs.min()), 2),
            "bestCagr": round(float(cagrs.max()), 2),
            "pctNegative": round(float(np.mean(cagrs < 0) * 100), 1),
            "pctBeatBench": round(float(beat.mean() * 100), 1),
            "medianMaxDD": round(float(np.median(dds)), 2),
            "worstMaxDD": round(float(dds.min()), 2),
        },
    }


# ── Result processing ──────────────────────────────────────────────────────────

def safe_float(val, default=None):
    if val is None:
        return default
    try:
        f = float(val)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return default


def build_response(raw: dict) -> dict:
    # ── Equity curve ────────────────────────────────────────────────────────────
    # In Strategy details, raw["dailyPerf"] has lists: "date", "ret", "retBench"
    # values start at 100.0. We multiply by 10.0 to match the 1000.0 start scale of screen backtests.
    daily_perf = raw.get("dailyPerf", {})
    dates = daily_perf.get("date", [])
    port_vals = daily_perf.get("ret", [])
    bench_vals = daily_perf.get("retBench", [])

    equity_curve = []
    for i, dt in enumerate(dates):
        port = safe_float(port_vals[i] if i < len(port_vals) else None)
        bench = safe_float(bench_vals[i] if i < len(bench_vals) else None)
        if dt and port is not None and bench is not None:
            equity_curve.append({
                "date": dt,
                "portfolio": port * 10.0,
                "benchmark": bench * 10.0
            })

    equity_curve = _add_drawdown(equity_curve)
    equity_curve = _add_rolling(equity_curve)
    annual_returns = _annual_returns(equity_curve)

    # ── Stats ───────────────────────────────────────────────────────────────────
    stats = raw.get("stats", {})
    summary = raw.get("summary", {})
    quick_stats = summary.get("quickStats", {})
    general_info = summary.get("generalInfo", {})

    # Extract return pct stats
    perf_stats = stats.get("perf", {}).get("returnPct", {})
    port_cagr = perf_stats.get("annualized", {}).get("model")
    bench_cagr = perf_stats.get("annualized", {}).get("bench")

    port_total = perf_stats.get("total", {}).get("model")
    bench_total = perf_stats.get("total", {}).get("bench")

    # Extract risk statistics (using weekly sinceInception if available, falling back to daily)
    risk_weekly = stats.get("riskMeasurements", {}).get("weekly", {}).get("sinceInception", {})
    risk_daily = stats.get("riskMeasurements", {}).get("daily", {}).get("sinceInception", {})
    risk = risk_weekly if risk_weekly else risk_daily

    sharpe = risk.get("sharpeRatio", {}).get("model")
    sortino = risk.get("sortinoRatio", {}).get("model")
    max_drawdown = risk.get("maxDrawdown", {}).get("model")
    alpha = risk.get("alpha", {}).get("model")
    beta = risk.get("beta", {}).get("model")

    bench_sharpe = risk.get("sharpeRatio", {}).get("bench")
    bench_max_dd = risk.get("maxDrawdown", {}).get("bench")

    # Win rate & turnover
    win_rate = quick_stats.get("overallWinnersPct")
    turnover = quick_stats.get("annualTurnover")

    # Average holding period
    realized_trades = stats.get("trading", {}).get("realized", {}).get("trades", {}).get("all", 0)
    unrealized_trades = stats.get("trading", {}).get("unrealized", {}).get("trades", {}).get("all", 0)
    realized_days = stats.get("trading", {}).get("realized", {}).get("avgDaysHeld", {}).get("all", 0.0) or 0.0
    unrealized_days = stats.get("trading", {}).get("unrealized", {}).get("avgDaysHeld", {}).get("all", 0.0) or 0.0

    total_trades = realized_trades + unrealized_trades
    if total_trades > 0:
        avg_holding_period = round((realized_trades * realized_days + unrealized_trades * unrealized_days) / total_trades, 1)
    else:
        avg_holding_period = None

    # Average holdings count (mean of the daily posCnt array)
    pos_cnts = daily_perf.get("posCnt", [])
    if pos_cnts:
        avg_holdings = round(float(np.mean(pos_cnts)), 1)
    else:
        avg_holdings = safe_float(general_info.get("noPos"))

    metrics = {
        "cagr":              safe_float(port_cagr),
        "totalReturn":       safe_float(port_total),
        "sharpe":            safe_float(sharpe),
        "sortino":           safe_float(sortino),
        "maxDrawdown":       safe_float(max_drawdown),
        "maxDrawdownDays":   None,
        "alpha":             safe_float(alpha),
        "beta":              safe_float(beta),
        "winRate":           safe_float(win_rate),
        "avgHoldingPeriod":  avg_holding_period,
        "turnover":          safe_float(turnover),
        "benchCagr":         safe_float(bench_cagr),
        "benchTotalReturn":  safe_float(bench_total),
        "benchMaxDrawdown":  safe_float(bench_max_dd),
        "benchSharpe":       safe_float(bench_sharpe),
        "numHoldings":       avg_holdings,
        "maxUnderperformanceMonths": _max_underperformance_months(equity_curve),
    }

    return {
        "equityCurve": equity_curve,
        "annualReturns": annual_returns,
        "metrics": metrics,
    }


def _max_underperformance_months(curve: list) -> Optional[float]:
    if not curve:
        return None

    # Check if we have enough points for rolling returns (52 weeks)
    has_rolling = any(p.get("rollingReturn") is not None for p in curve)

    max_streak = 0
    current_streak = 0
    best_start_idx = -1
    best_end_idx = -1

    for i, p in enumerate(curve):
        if has_rolling:
            r_port = p.get("rollingReturn")
            r_bench = p.get("rollingBenchReturn")
        else:
            # Fallback to cumulative return since start
            r_port = p.get("portfolio")
            r_bench = p.get("benchmark")

        if r_port is None or r_bench is None:
            current_streak = 0
            continue

        if r_port < r_bench:
            current_streak += 1
            if current_streak > max_streak:
                max_streak = current_streak
                best_start_idx = i - current_streak + 1
                best_end_idx = i
        else:
            current_streak = 0

    if best_start_idx == -1 or best_end_idx == -1:
        return 0.0

    try:
        start_date = datetime.strptime(curve[best_start_idx]["date"], "%Y-%m-%d").date()
        end_date = datetime.strptime(curve[best_end_idx]["date"], "%Y-%m-%d").date()
        days = (end_date - start_date).days
        return round(days / 30.4375, 1)
    except Exception:
        return 0.0


def _total_return(curve: list, key: str) -> Optional[float]:
    if len(curve) < 2:
        return None
    start = curve[0][key]
    end = curve[-1][key]
    if not start:
        return None
    return round((end / start - 1) * 100, 2)


def _add_drawdown(curve: list) -> list:
    if not curve:
        return curve
    peak = curve[0]["portfolio"]
    bench_peak = curve[0]["benchmark"]
    for p in curve:
        peak = max(peak, p["portfolio"])
        bench_peak = max(bench_peak, p["benchmark"])
        p["drawdown"] = round((p["portfolio"] - peak) / peak * 100, 4) if peak else 0
        p["benchDrawdown"] = round((p["benchmark"] - bench_peak) / bench_peak * 100, 4) if bench_peak else 0
    return curve


def _add_rolling(curve: list, window: int = 252) -> list:
    """Add rolling 1-year Sharpe and rolling 1-year return (annualised) to each point."""
    if not curve:
        return curve

    port_vals = [p["portfolio"] for p in curve]
    bench_vals = [p["benchmark"] for p in curve]

    port_rets = [0.0] + [
        (port_vals[i] - port_vals[i - 1]) / port_vals[i - 1]
        for i in range(1, len(port_vals))
        if port_vals[i - 1]
    ]
    # Pad if lengths differ (edge case with zero prices)
    while len(port_rets) < len(curve):
        port_rets.append(0.0)

    bench_rets = [0.0] + [
        (bench_vals[i] - bench_vals[i - 1]) / bench_vals[i - 1]
        for i in range(1, len(bench_vals))
        if bench_vals[i - 1]
    ]
    while len(bench_rets) < len(curve):
        bench_rets.append(0.0)

    for i, point in enumerate(curve):
        # Rolling 1-year return
        if i >= window:
            prev_port = curve[i - window]["portfolio"]
            prev_bench = curve[i - window]["benchmark"]
            point["rollingReturn"] = round((point["portfolio"] / prev_port - 1) * 100, 4) if prev_port else None
            point["rollingBenchReturn"] = round((point["benchmark"] / prev_bench - 1) * 100, 4) if prev_bench else None
        else:
            point["rollingReturn"] = None
            point["rollingBenchReturn"] = None

        # Rolling Sharpe
        start = max(0, i - window + 1)
        window_rets = port_rets[start: i + 1]
        if len(window_rets) >= 4:
            mean_r = np.mean(window_rets)
            std_r = np.std(window_rets, ddof=1)
            point["rollingSharp"] = round(float(mean_r / std_r * np.sqrt(252)), 4) if std_r > 1e-10 else None
        else:
            point["rollingSharp"] = None

    return curve


def _annual_returns(curve: list) -> list:
    if not curve:
        return []
    yearly: dict = defaultdict(list)
    for p in curve:
        year = p["date"][:4]
        yearly[year].append(p)

    result = []
    for year in sorted(yearly.keys()):
        pts = yearly[year]
        if len(pts) < 2:
            continue
        p_ret = (pts[-1]["portfolio"] / pts[0]["portfolio"] - 1) * 100
        b_ret = (pts[-1]["benchmark"] / pts[0]["benchmark"] - 1) * 100
        result.append({
            "year": year,
            "portfolio": round(p_ret, 2),
            "benchmark": round(b_ret, 2),
        })
    return result


# ── Static file serving (production) ─────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
