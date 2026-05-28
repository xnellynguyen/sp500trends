# S&P 500 AI Trend Predictor — Development Log & Architecture

> **Last Updated:** May 28, 2026 | **Version:** 2.1

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Iteration History](#2-iteration-history)
3. [Backend Implementation](#3-backend-implementation)
4. [Frontend Implementation](#4-frontend-implementation)
5. [Database Schema (Supabase)](#5-database-schema-supabase)
6. [Infrastructure & CI/CD](#6-infrastructure--cicd)
7. [Known Issues & Tech Debt](#7-known-issues--tech-debt)
8. [Roadmap](#8-roadmap)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite → Vercel)                          │
│  - Google OAuth via Supabase Auth                            │
│  - Finnhub WebSocket (live prices)                           │
│  - REST calls to FastAPI backend with Supabase Auth Header   │
└────────────────────┬─────────────────────────────────────────┘
                     │ HTTPS (Authorization: Bearer <JWT>)
┌────────────────────▼─────────────────────────────────────────┐
│  FastAPI (Google Cloud Run · us-central1 · sp500-predictor)  │
│  - 44 Calibrated LightGBM models (sector × horizon × macro)   │
│  - FMP & Polygon API data fetching                           │
│  - Dynamic model downloading from Google Cloud Storage        │
│  - ThreadPoolExecutor for concurrent inference               │
└────────────────────┬─────────────────────────────────────────┘
                     │ Supabase JS Client (direct from browser)
┌────────────────────▼─────────────────────────────────────────┐
│  Supabase (PostgreSQL + Auth)                                │
│  - watchlist table                                           │
│  - predictions table                                         │
│  - Row-Level Security enforced                               │
└──────────────────────────────────────────────────────────────┘
```

**Stack summary:**
- **Backend:** FastAPI, LightGBM, scikit-learn (`CalibratedClassifierCV`), Upstash Redis (caching), Polygon API, FMP API, google-cloud-storage.
- **Frontend:** React 19 (Vite), Lucide icons, Recharts, Finnhub WebSockets.
- **Database/Auth:** Supabase (PostgreSQL + OAuth).
- **Deployment:** Google Cloud Run (backend) + Vercel (frontend).
- **CI/CD:** GitHub Actions (`deploy-prod.yml` / `deploy-staging.yml`).

---

## 2. Iteration History

### Phase 1 — Single-Model Baseline
- **What:** Single `RandomForestClassifier` trained on SPY only.
- **Problem:** Severe underfitting. One model cannot capture the volatility profile of both momentum tech stocks and defensive utilities.
- **Result:** Baseline of ~50% accuracy on most tickers.

### Phase 2 — Sector-Specific Model Architecture
- **What:** Mapped 11 GICS sectors. Trained isolated Random Forest models per sector using the top 3 heavyweights per sector as training data.
- **Impact:** TSLA via `consumer_cyclical` model reached **72.06% backtested accuracy** over 3.5 years.
- **Technical:** `train_all.py` downloads 5 years of data per ticker, engineers technical features, and persists models as `.joblib` files under `models/sector_models/`.

### Phase 3 — Multi-Horizon Forecasting
- **What:** Duplicated training pipeline with `target = df['Close'].shift(-5) > df['Close']` for 5-day predictions.
- **Result:** 22 models total (11 sectors × 2 horizons).
- **API:** Added `horizon` query param; model is selected dynamically at inference.

### Phase 4 — Macro-Economic Feature Integration ("Bull Trap Filter")
- **What:** Optional toggle to join SPY Daily Return, SPY 50-SMA, and VIX Daily Close into the feature vector.
- **Problem solved:** Stocks can look bullish in isolation but be in a macro collapse context (VIX spike).
- **Technical debt fixed:**
  - Timezone NaN bug: `yf.download` injects timezones inconsistently. Fixed with `df.index.tz_localize(None)` on all DataFrames before joining.
  - API hammering: Initial design re-fetched SPY/VIX for every ticker. Refactored to a singleton `fetch_global_macro_features()` called once per request, passed to all inference calls.
- **Result:** 44 models total (11 sectors × 2 horizons × 2 macro states).

### Phase 5 — UI/UX Dashboard Refactor
- **What:** Replaced static hardcoded tickers with a dynamic watchlist. Added "Model Parameters" bar for horizon and macro toggles.
- **Key endpoint:** `/api/predict_batch` — accepts current displayed symbols, runs 12 concurrent inferences, returns in original order. Eliminates re-fetching trending tickers on every parameter change.

### Phase 6 — Real-Time Price Streaming
- **What:** Integrated Finnhub.io WebSocket for live price updates.
- **React Strict Mode bug:** Triggering visual flash animations inside `setState` caused conflicting renders. Fixed by decoupling flash state into a separate `useEffect`.
- **Fallback:** Mock ticker (±$0.50 every 2s) when no Finnhub key present (local dev).

### Phase 7 — Portfolio Intelligence & Details Modal
- **What:** Unified Details Modal with 3 tabs: Overview (intraday chart, P&L), Signals (RSI/MACD/Bollinger with layman explanations), Earnings (next date, analyst consensus, historical beat rate).
- **P&L:** Users enter `entry_price` / `entry_date`; stored in Supabase `watchlist` table; calculated live against Finnhub price.
- **Earnings data:** Fetched from `yfinance` calendar + `earnings_dates` DataFrame via `/api/earnings/{ticker}`.

### Phase 8 — Production Infrastructure
- **What:** Migrated to dedicated GCP project `sp500trends-prod`. Moved all API keys server-side (Cloud Run env vars). Added GitHub Actions CI/CD pipeline.
- **Auth fix:** `redirectTo: window.location.origin` ensures OAuth returns to the correct domain (production Vercel vs. localhost).
- **Notifications:** Added `Notification API` permission flow + `/sw.js` service worker registration. Gracefully handles environments where Notification API is unavailable.

### Phase 9 — Prediction Resolution Pipeline
- **What:** Automated accuracy tracking. On each dashboard load, the frontend resolves matured predictions against real historical closing prices.
- **New endpoint:** `POST /api/historical_prices` — accepts batch `{ticker, date}` pairs, fetches the closest trading day close via `yfinance`, handles weekends/holidays via a 5-day window lookup.
- **Resolution logic:** Compare `actual_close` vs `base_price` to determine actual direction. Set `resolved_correctly` boolean in Supabase.
- **Deduplication:** `logPrediction()` checks if a prediction for the same ticker/horizon was logged within the past 12 hours before inserting.
- **Reset:** Existing inaccurate resolutions (that used current price as proxy) were cleared from the DB so only historically-verified data populates accuracy bars.

### Phase 10 — Divergence Detection & Trending Discovery
- **Divergence:** Both horizon predictions are fetched on load (primary horizon in main path; secondary in background slow-path). A ticker is flagged divergent if 1D and 5D disagree. Amber alert tag on card; sortable.
- **Trending:** Scrapes Yahoo Finance trending US endpoint (top 30). Filters to clean equity tickers. Runs batch ML inference, sorted by confidence. Users can one-click add to watchlist.

### Phase 11 — Technical Hardening & Modular Architecture
- **Refactoring:** Refactored the backend into modular components, isolating routing, configuration, security middleware, and feature engineering.
- **LightGBM:** Standardized modeling on LightGBM. Calibrated model outputs with isotonic regression (`CalibratedClassifierCV`).
- **Decay Weighting:** Updated the ML pipeline to apply exponential decay weights (`sample_weight=decay`) during training, prioritizing recent market events.
- **Security:** Added strict JWT authorization middleware verifying headers using `SUPABASE_JWT_SECRET`. Secured prediction resolution endpoint via `SERVICE_TOKEN`.
- **Base Price & Trading Days:** Aligned prediction evaluation with log-day closing prices (rather than intraday base prices) and resolved target dates using actual business/trading calendars.
- **Earnings & FMP:** Dropped flaky `yfinance` earnings calendar scraping in favor of a stable FMP API integration, loading calendar date and quarterly surprise metrics on-demand inside the details modal.
- **Git Cleanup:** Removed 18MB of `.joblib` model binaries from git tracking, relying on startup GCS bucket downloading with local cache fallbacks.

---

## 3. Backend Implementation

### File Structure
```
backend/
├── main.py              # FastAPI application entrypoint
├── config.py            # Environment configurations & Redis initialization
├── security.py          # JWT verification middleware
├── data_fetcher.py      # FMP and Polygon API interfaces
├── features.py          # Technical indicator & signal confluence logic
├── models.py            # Model loading, caching, and GCS synchronization
├── train_all.py         # Full LightGBM model retraining pipeline
├── requirements.txt
├── requirements-prod.txt
├── Dockerfile
├── models/
│   ├── rf_model.joblib  # Fallback base model
│   └── sector_models/   # 44 calibrated sector models (Git-ignored)
└── routers/
    ├── predict.py       # Ticker predictions, batch predictions, Yahoo trending
    ├── earnings.py      # On-demand FMP earnings details
    └── history.py       # Price lookup & daily predictions resolution cron
```

### Key Functions

#### `verify_token(authorization)`
FastAPI dependency that extracts the Bearer token and verifies it against the `SUPABASE_JWT_SECRET`. Supports `SERVICE_TOKEN` bypass for internal developer testing.

#### `fetch_earnings_from_fmp(ticker)`
Calls the stable FMP `/stable/earnings` endpoint to retrieve historical and upcoming earnings dates. Computes quarterly beat rate over the last 8 quarters.

#### `resolve_single_prediction(pred, now_ny)`
Compares mature predictions against historical stock price changes. Resolves predictions relative to the close price on the log-day, checking target dates (1st trading day after log date for `1d`; 5th trading day for `5d`) and handling market holidays/weekends.

#### `get_model(ticker, horizon, macro)` → `CalibratedClassifierCV`
Loads the model matching the sector, horizon, and macro toggle. Dynamically falls back to standard sector templates or the base model if a specific sector binary is missing.

---

## 4. Frontend Implementation

### File Structure
```
frontend/src/
├── App.jsx              # Core application entrypoint (watchlist lifecycle)
├── index.css            # CSS design system (tokens, keyframe animations)
├── supabaseClient.js    # Client initialization for Supabase Auth/DB
├── main.jsx             # React DOM root mounting
└── components/
    ├── Header.jsx       # Global application navigation and params bar
    ├── TrendCard.jsx    # Component rendering individual ticker cards
    ├── TrendingSection.jsx # Handles display/interactions for trending tickers
    ├── charts/
    │   └── IntradayChart.jsx # Intraday rendering wrapper (Recharts)
    └── modals/
        └── DetailsModal.jsx  # Detailed tabs for technicals, signals, and FMP earnings
```

### Key Flows

**On-Demand Earnings Loading**
Rather than bulk-fetching earnings calendars for the entire watchlist on load, the application fetches earnings details via `GET /api/earnings/{ticker}` dynamically only when a user opens the details modal.

**Cron Triggered Resolution**
The daily prediction resolution cron runs on a secure nightly trigger via Google Cloud Scheduler, calling `POST /api/cron/resolve-predictions` with the static `SERVICE_TOKEN` header. Direct local frontend-side resolution has been completely removed to ensure server-side data integrity.

---

## 5. Database Schema (Supabase)

### `watchlist`
```sql
CREATE TABLE watchlist (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) NOT NULL,
  ticker      TEXT NOT NULL,
  added_at    TIMESTAMPTZ DEFAULT now(),
  entry_price NUMERIC,
  entry_date  DATE,
  UNIQUE(user_id, ticker)
);
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
```

### `predictions`
```sql
CREATE TABLE predictions (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID REFERENCES auth.users(id) NOT NULL,
  ticker               TEXT NOT NULL,
  horizon              TEXT NOT NULL,          -- '1d' or '5d'
  predicted_direction  TEXT NOT NULL,          -- 'UP' or 'DOWN'
  confidence           NUMERIC,               -- 0.0 to 1.0
  base_price           NUMERIC,
  created_at           TIMESTAMPTZ DEFAULT now(),
  resolved_correctly   BOOLEAN                -- NULL until resolved
);
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
```

---

## 6. Infrastructure & CI/CD

### Cloud Run Service (`sp500-predictor`)
Standard environment parameters apply. Note that `SUPABASE_JWT_SECRET` must be set in the service environment variables. Without this secret, the server raises a configuration error and exits immediately to prevent unauthenticated access.

### CI/CD Pushes (GitHub Actions)
Deployments are handled via `.github/workflows/deploy-prod.yml` and `deploy-staging.yml`. Since `.joblib` files are removed from Git tracking, the Cloud Run instance pulls models dynamically from Google Cloud Storage on startup, utilizing the `GCS_MODEL_BUCKET` configuration.

---

## 7. Known Issues & Tech Debt

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Predictions table grows unbounded | 🟡 Low | Open (Needs edge function pruning) |
| 2 | Push notifications partially wired but not triggered | 🟡 Low | Open (WIP) |
| 3 | Model performance drift tracking | 🟡 Low | Open (Roadmap item R-07) |

---

## 8. Roadmap

### Completed Milestones
- [x] **JWT Verification:** Locked down FastAPI endpoints using Supabase JWT middleware.
- [x] **CORS Lockdown:** Restricted origins strictly to the production Vercel domains and local dev environments.
- [x] **Stable Earnings calendar:** Integrated FMP stable API, discarding yfinance scrapers.
- [x] **Cloud-cached models:** Removed joblib binaries from Git, fetching dynamically from GCS.
- [x] **Decay model weighting:** Incorporated exponential sample weights during training.
- [x] **Cron-driven prediction resolution:** Scheduled daily Cloud Scheduler cron for data-consistent resolutions.

### Near-Term & Roadmap Items
- [ ] **R-04** Supabase Edge Function to prune predictions older than 90 days.
- [ ] **R-07** Daily accuracy monitoring dashboard alerts.
- [ ] **R-09** Complete web push notifications for threshold alerts.
- [ ] **R-10** Support international equities and index ETFs.
