# P123 Strategy Lab

A self-hosted web dashboard for **testing Portfolio123 strategies safely**. Iterate on buy/sell
rules, universes, ranking systems, and rebalance settings against P123's simulation engine —
without modifying your real strategies — then commit a configuration back to Portfolio123 only
when you're happy with it.

Built with FastAPI + React (Vite, Tailwind, Recharts), deployed on Google Cloud Run behind
Identity-Aware Proxy.

> Independent community project. Not affiliated with, sponsored by, or endorsed by
> Portfolio123, Inc. Nothing here is investment advice.

## Features

- **Shadow-sim testing** — backtests are executed by rerunning a dedicated *scratch simulation*
  with your test configuration. Portfolio123's `rerun` API permanently rewrites a sim's
  definition, so running tests directly against a real strategy would corrupt it; the shadow
  sim absorbs that. Your real strategy is only written when you explicitly **Save/Commit**.
- **Verified formula autocomplete** — 4,800+ factors and functions with official descriptions
  and signatures, generated from an extraction of P123's Factor Reference (no invented names).
- **Full results suite** — log-scale equity curve, drawdown, rolling Sharpe/returns, annual
  returns, and the sim's actual transaction log.
- **Monte Carlo** — paired block bootstrap of the backtest's daily returns (benchmark resampled
  in lockstep, preserving correlation): percentile fan chart, CAGR and max-drawdown
  distributions, P(loss), P(underperforming the benchmark), drawdown-threshold probabilities,
  plus a trade-level bootstrap (FIFO round-trip pairing) for expectancy confidence intervals
  and losing-streak statistics. Costs zero API credits.
- **Robustness (rolling windows)** — every possible 3/5/10-year investment window inside the
  backtest, strategy vs. benchmark, answering "did this only work because of the start date?"
  Zero API credits.
- **Run history** — the last 20 runs with config summaries and side-by-side metric comparison.
- **Live API quota meter** — every P123 response's `cost`/`quotaRemaining` is surfaced in the
  header, with a low-credit warning.
- **Durable state** — strategy/universe/ranking-system lists and settings persist to a GCS
  bucket in production (Cloud Run filesystems are ephemeral and per-instance).

## How the shadow sim works

Portfolio123's API cannot create strategies, and `POST /strategy/{id}/rerun` **permanently
changes** the target sim's configuration. The lab therefore uses one (or two) throwaway sims
you create once in the P123 UI:

1. Create a new simulated strategy on Portfolio123 (any universe/rules — it will be
   overwritten constantly). Use **dynamic-weight** rebalancing (the default).
2. Open the app → Settings (gear icon) → paste the sim's ID as the **dynamic** shadow sim.
3. Optional: if any of your strategies use **static** position sizing (fixed weight %), create
   a second scratch sim with static sizing and add it too — the API cannot switch a sim's
   sizing method, so a matching shadow is needed for exact results.

Every backtest then runs on the shadow sim with your test config overriding everything;
**Save** is the only action that writes to the strategy you selected.

## Local development

Prerequisites: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 20+, and a Portfolio123
account with API access (Account Settings → API; paid feature).

```bash
# Backend
cd backend
cp .env.example .env          # fill in P123_API_ID / P123_API_KEY
uv sync
uv run uvicorn main:app --port 8000

# Frontend (separate terminal; proxies /api to :8000)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Locally, app state is stored as JSON files next to the backend (gitignored). In production it
lives in GCS (set `GCS_BUCKET`).

## Deploying to Google Cloud Run

The included script deploys behind **native IAP** so only you can reach the app (your P123
API credentials live in the container's environment — never expose the service publicly).

```bash
cp deploy.env.example deploy.env    # set PROJECT and IAP_MEMBER
cp backend/.env.example backend/.env # set P123 credentials
./deploy.sh
```

The script: enables IAP, creates and seeds the state bucket, grants the runtime service
account access, builds the image with Cloud Build, deploys to Cloud Run
(`--no-allow-unauthenticated --iap`), and grants `IAP_MEMBER` web access. Subsequent deploys
are just `./deploy.sh` again.

Estimated cost: effectively free at personal usage levels (scale-to-zero, 512 MB instance).

## API quota notes

- Each backtest is one `rerun` + one results fetch (typically ~30–50 credits depending on the
  period). Monte Carlo, Robustness, and run-history comparisons consume **no** credits; the
  Trades tab and trade-level Monte Carlo stats use one cached transactions fetch.
- P123 allows one in-flight API request per key; the backend serializes all calls.
- The header meter always shows the credits remaining in your billing month.

## Regenerating the formula autocomplete

`backend/p123_autocomplete.json` ships pre-generated. To regenerate it you need the
[portfolio123 Claude skill](https://github.com/acombs/p123-skill)'s reference files (an
extraction-verified copy of P123's Factor Reference):

```bash
python backend/generate_autocomplete.py /path/to/p123-skill/references
```

## Repository layout

```
backend/
  main.py                  # FastAPI app: P123 client, shadow-sim flow, analytics
  storage.py               # GCS-or-local JSON state persistence
  generate_autocomplete.py # builds p123_autocomplete.json from the skill's references
  p123_autocomplete.json   # verified formula dictionary served to the frontend
frontend/
  src/App.tsx              # state, run/commit flows, history
  src/components/          # form, results tabs (charts, MC, robustness, trades), modals
Dockerfile                 # two-stage build: Vite dist → FastAPI static serving
deploy.sh                  # Cloud Run + IAP + state-bucket deployment
```

## Security

- Credentials are read only from `backend/.env` (local) or Cloud Run env vars (deployed);
  both are gitignored and never logged.
- The deployed service refuses unauthenticated traffic; IAP performs Google-account auth
  before requests reach the container.
- User state (your strategy IDs/names, shadow-sim settings) is gitignored — a fresh clone
  starts with safe defaults.

## License

MIT
