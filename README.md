# S&P 500 AI Trend Predictor

An AI-driven dashboard for forecasting S&P 500 component trends over 1-day and 5-day horizons. The application features technical indicator confluence analysis, macro-economic sentiment integration, and calibrated LightGBM machine learning models.

---

## Architecture Overview

The project is split into a modern React frontend and a modular FastAPI backend:

* **Frontend:** Built with React 19, Vite, and TailwindCSS (or Vanilla CSS utilities), leveraging Supabase Auth and Recharts for interactive financial charting.
* **Backend:** Built with FastAPI, structured into dedicated service and router layers:
  * `config.py`: Loads environment configurations and handles Upstash Redis client setup.
  * `security.py`: Middleware for verifying Supabase JWT authorization tokens.
  * `data_fetcher.py`: Client wrapper for Polygon (prices) and Financial Modeling Prep (FMP) (earnings, surprise metrics, analyst consensus).
  * `features.py`: Feature engineering pipeline constructing MACD, RSI, Bollinger Bands, and technical confluences.
  * `models.py`: Model registry that pulls serialized LightGBM estimators from Google Cloud Storage (GCS) or falls back to local calibrated binaries.
  * `routers/`: Cleanly isolates predictions, earnings info, and historical price resolution routes.

---

## Installation & Setup

### Environment Configuration

Create a `.env` file inside the `backend/` directory with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>

# CRITICAL: Secret key used to verify Supabase client JWTs.
# Retrieve this from Supabase Dashboard -> Project Settings -> API -> JWT Settings -> JWT Secret.
SUPABASE_JWT_SECRET=<your-jwt-secret>

# Bypasses RLS to write prediction resolution outcomes back to Supabase.
# Retrieve from Supabase Dashboard -> Project Settings -> API -> service_role key.
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Third-Party Market Data APIs
POLYGON_API_KEY=<your-polygon-api-key>
FMP_API_KEY=<your-fmp-api-key>

# Caching & Models Storage
REDIS_URL=rediss://default:<password>@<host>:<port>
GCS_MODEL_BUCKET=sp500trends-models

# Shared Secret for Cron Job Authorization (GCP Cloud Scheduler)
SERVICE_TOKEN=your_secure_shared_cron_token_here
```

### Running Backend Locally

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the development server:
   ```bash
   uvicorn main:app --port 8000 --reload
   ```

### Running Frontend Locally

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install Node packages:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

---

## Machine Learning Pipeline

Models are trained on 5 years of historical stock and macroeconomic data using **LightGBM** classifiers.
* **Calibrated Confidence:** Outputs are calibrated using `CalibratedClassifierCV` (isotonic regression) to align prediction probabilities with real-world accuracy rates.
* **Sample Weighting:** Exponential decay sample weighting is applied during model fitting (`sample_weight=decay`) to prioritize recent market trends over older historical data.
* **Retraining Models:**
  To run the full retraining and calibration pipeline across all 44 sector-horizon models, execute:
  ```bash
  python train_all.py
  ```

---

## Cron Resolution Setup

To keep accuracy stats and win percentages correct, predictions are resolved daily after market close using Google Cloud Scheduler.

1. Set up a GCP Cloud Scheduler job.
2. Configure it to send a `POST` request to `https://<your-backend-domain>/api/cron/resolve-predictions` daily at **5:00 PM EST** (22:00 UTC).
3. Set the `Authorization` header to `Bearer <SERVICE_TOKEN>`, matching the `SERVICE_TOKEN` specified in your backend environment variables.
