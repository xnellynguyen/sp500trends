# S&P 500 Trends Predictor - Development Log & Architecture

## Overview
The S&P 500 Trends Predictor originated as a single-asset (SPY) machine learning model to predict the next day's movement based on technical indicators. Throughout this session, it evolved into a highly robust, sector-aware, multi-horizon prediction engine with integrated macro-economic evaluation.

## Key Iterations & Achievements

### 1. Sector-Specific Model Architecture
*   **Initial State:** A single `RandomForestClassifier` trained exclusively on `SPY`.
*   **The Problem:** Using one model for all S&P 500 stocks leads to significant underfitting and poor generalizability. Tech stocks (momentum-heavy) do not trade with the same volatility or mean-reversion characteristics as Utilities or Consumer Staples.
*   **The Solution:** We mapped 11 core GICS sectors and explicitly downloaded 5 years of historical data for the top 7 heavyweights in each sector. We then trained 11 isolated Random Forest models.
*   **Technical Tradeoff:** Training 11 models requires significantly more compute locally, taking several minutes versus a few seconds. However, the performance tradeoff was massive. For example, routing TSLA through the new `consumer_cyclical` model pushed its backtested 1-Day prediction accuracy to **72.06%** over the last 3.5 years (up from typical ~50% baselines).

### 2. Multi-Horizon Forecasting (1-Day vs. 5-Day)
*   **Initial State:** The model strictly predicted the T+1 (next day) close.
*   **The Problem:** Day trading creates high noise-to-signal ratios, and many users prefer swing trading (holding for a week).
*   **The Solution:** We duplicated the training pipeline to offset the target variable `df['Target'] = (df['Close'].shift(-5) > df['Close']).astype(int)`.
*   **Technical Implementation:** This spawned an additional 11 models, bringing the total to 22 models. We implemented a `horizon` query parameter in the API to dynamically select the correct `.joblib` model at inference time.

### 3. Macro-Economic Feature Integration (The "Bull Trap" Filter)
*   **Initial State:** The models only evaluated a stock's isolated technicals (RSI, MACD, Bollinger Bands, SMA/EMA).
*   **The Problem:** A stock might look bullish purely on its own technicals, but if the broader market is collapsing or volatility (VIX) is spiking, the breakout is likely a bull trap.
*   **The Solution:** We introduced a "Macro Features" toggle. When active, the model joins the stock's technical data with the `SPY` Daily Return, `SPY` 50-SMA, and the `^VIX` Daily Close.
*   **Technical Tradeoff & Resolution:**
    *   **Data Alignment Issue:** Joining `yf.download` DataFrames for VIX/SPY with individual stocks caused severe NaNs because Yahoo Finance injects timezones into some indices but not others. We explicitly stripped timezones (`df.index.tz_localize(None)`) to force clean `.join()` alignments.
    *   **API Rate Limiting:** Initially, the backend attempted to fetch SPY and VIX data *for every single ticker* on the frontend dashboard simultaneously (24 extra requests). This caused the local server to hang.
    *   **Optimization:** We refactored `main.py` to use a singleton-like pattern for macro fetching. The backend fetches the VIX and SPY once globally per request and propagates that single DataFrame to all 12 ticker inferences in memory.
*   **Final Output:** This brought the final model count to **44 specialized models** (11 sectors × 2 horizons × 2 macro states).

### 4. UI/UX Dashboard Refactor
*   **Initial State:** Hardcoded static API calls.
*   **The Solution:** Implemented a persistent "Model Parameters" bar underneath the header in React.
*   **Technical Implementation:**
    *   Users can toggle between `1d` and `5d` horizons, and toggle Macro Features `On` or `Off`.
    *   To prevent the dashboard from completely shuffling tickers when parameters change, we implemented a new `/api/predict_batch` endpoint. Instead of calling Yahoo's trending endpoint on every click, React pushes the currently displayed symbols to the backend, which processes the 12 inferences concurrently via `ThreadPoolExecutor` and updates the UI entirely in-place.

## Deployment & Operations

### 1. Cloud Infrastructure
*   **Backend:** Fast API hosted on **Google Cloud Run**.
    *   **Cost Optimization:** `min-instances` set to `0` to ensure zero cost when idle.
    *   **Cold Start Mitigation:** Enabled **Startup CPU Boost** and implemented a custom "Waking up server" loading splash screen in the React frontend to manage the 15-30s spin-up delay gracefully.
*   **Frontend:** React (Vite) hosted on **Vercel**.
    *   **Routing:** Environment-aware API URLs using `import.meta.env.VITE_API_URL`.

### 2. CI/CD Pipeline (GitHub Actions)
*   **Automation:** A `.github/workflows/deploy.yml` pipeline triggers on every push to the `master` branch.
*   **Backend Workflow:** Builds the Docker image and deploys to Cloud Run using `gcloud run deploy --source`.
*   **Frontend Workflow:** Performs a production build with inlined environment variables and deploys to Vercel via the Vercel CLI.

### 3. Production Security
*   **API Key Management:** Sensitive keys (Finnhub) are strictly handled via environment variables (`VITE_FINNHUB_KEY`).
*   **Local Security:** `.env` files and build artifacts are excluded from version control via `.gitignore` and `.gcloudignore`.
*   **IAM:** A dedicated Service Account (`github-deployer`) with least-privilege roles (`run.admin`, `storage.admin`, etc.) handles all cloud interactions.

## Future Roadmap
*   **Persistent User Settings:** Save Horizon and Macro toggles to `localStorage` so user preferences survive page reloads.
*   **Model Performance Monitoring:** Implement an automated daily backtest cron job that alerts if sector-specific models drop below 55% accuracy.
*   **Real-Time WebSocket Streams:** Transition from polling to WebSockets for live price updates to reduce client-side overhead.
