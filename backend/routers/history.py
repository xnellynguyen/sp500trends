from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import List
import concurrent.futures
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
import pandas as pd
import requests

from security import verify_token
from config import SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_TOKEN, os
from data_fetcher import fetch_polygon_aggs

router = APIRouter()

# Read the service role key from env. Bypasses RLS to write resolutions.
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

class PriceCheck(BaseModel):
    ticker: str
    date: str  # "YYYY-MM-DD"

class HistoricalPricesRequest(BaseModel):
    checks: List[PriceCheck]

@router.post("/api/historical_prices")
def get_historical_prices(req: HistoricalPricesRequest, user=Depends(verify_token)):
    """Return the closing price for each ticker on (or just before) the given date."""
    results = {}

    def fetch_price(check):
        try:
            target = datetime.strptime(check.date, "%Y-%m-%d").date()
            start = (target - timedelta(days=5)).strftime("%Y-%m-%d")
            end = (target + timedelta(days=1)).strftime("%Y-%m-%d")

            df = fetch_polygon_aggs(check.ticker, start, end)
            if df.empty:
                return check.ticker, check.date, None

            mask = df.index.date <= target
            valid = df[mask]
            if valid.empty:
                return check.ticker, check.date, None

            close = float(valid['Close'].iloc[-1])
            return check.ticker, check.date, round(close, 2)
        except Exception as e:
            print(f"Historical price error for {check.ticker} on {check.date}: {e}")
            return check.ticker, check.date, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(fetch_price, c) for c in req.checks]
        for future in concurrent.futures.as_completed(futures):
            ticker, dt, price = future.result()
            key = f"{ticker}_{dt}"
            results[key] = price

    return {"prices": results}


# ─── Helper for prediction resolution ───
def resolve_single_prediction(pred, now_ny):
    ticker = pred.get("ticker")
    horizon = pred.get("horizon")
    created_at_str = pred.get("created_at")
    base_price = pred.get("base_price")
    predicted_direction = pred.get("predicted_direction")
    pred_id = pred.get("id")

    if not ticker or not created_at_str or base_price is None or not predicted_direction:
        return None

    try:
        clean_str = created_at_str.replace("Z", "")
        if "." in clean_str:
            clean_str = clean_str.split(".")[0]
        log_dt = datetime.strptime(clean_str, "%Y-%m-%dT%H:%M:%S")
    except Exception as e:
        print(f"Error parsing created_at {created_at_str} for prediction {pred_id}: {e}")
        return None

    # Fetch history surrounding log date to now
    start_str = (log_dt - timedelta(days=5)).strftime("%Y-%m-%d")
    end_str = (now_ny.date() + timedelta(days=2)).strftime("%Y-%m-%d")

    df = fetch_polygon_aggs(ticker, start_str, end_str)
    if df.empty:
        return None

    trading_days = sorted(list(df.index.date))
    log_date = log_dt.date()

    # Find trading days strictly after the prediction log date
    trading_days_after = [d for d in trading_days if d > log_date]

    required_index = 0 if horizon == "1d" else 4
    if len(trading_days_after) <= required_index:
        return None  # Target trading day not completed yet

    target_date = trading_days_after[required_index]

    # Maturity Check (Eastern Time)
    if target_date > now_ny.date():
        return None
    if target_date == now_ny.date():
        if now_ny.hour < 16 or (now_ny.hour == 16 and now_ny.minute < 30):
            return None

    target_dt = pd.to_datetime(target_date)
    if target_dt not in df.index:
        return None

    actual_price = float(df.loc[target_dt, "Close"])

    # Align base price to close of log date (or closest preceding trading day close)
    trading_days_before_or_on = [d for d in trading_days if d <= log_date]
    if not trading_days_before_or_on:
        aligned_base_price = base_price
    else:
        aligned_base_day = trading_days_before_or_on[-1]
        aligned_base_dt = pd.to_datetime(aligned_base_day)
        aligned_base_price = float(df.loc[aligned_base_dt, "Close"])

    actual_direction = "UP" if actual_price > aligned_base_price else "DOWN"
    resolved_correctly = (actual_direction == predicted_direction)

    return {
        "id": pred_id,
        "resolved_correctly": resolved_correctly,
        "base_price": round(aligned_base_price, 2),
        "actual_price": round(actual_price, 2),
        "target_date": target_date.strftime("%Y-%m-%d")
    }


@router.post("/api/cron/resolve-predictions")
def resolve_predictions_cron(authorization: str = Header(None)):
    """Nightly Cron endpoint triggered by GCP Cloud Scheduler to resolve predictions."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    
    if token != SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")

    db_key = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
    headers = {
        "apikey": db_key,
        "Authorization": f"Bearer {db_key}",
        "Content-Type": "application/json"
    }

    # 1. Fetch all unresolved predictions from Supabase
    url = f"{SUPABASE_URL}/rest/v1/predictions?resolved_correctly=is.null"
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Failed to fetch predictions: {res.text}")
        predictions = res.json()
    except Exception as e:
        print(f"Error fetching from Supabase predictions: {e}")
        return {"status": "error", "message": str(e)}

    if not predictions:
        return {"status": "success", "resolved_count": 0, "message": "No pending predictions to resolve."}

    # Setup New York timezone timezone-aware datetime
    try:
        ny_tz = ZoneInfo("America/New_York")
    except Exception:
        ny_tz = ZoneInfo("EST5EDT")
    now_ny = datetime.now(ny_tz)

    resolutions = []
    
    # 2. Process each prediction sequentially
    for pred in predictions:
        try:
            resolved = resolve_single_prediction(pred, now_ny)
            if resolved:
                resolutions.append(resolved)
        except Exception as e:
            print(f"Error processing prediction {pred.get('id')}: {e}")

    # 3. Update database for each resolved prediction
    updated_count = 0
    for r in resolutions:
        patch_url = f"{SUPABASE_URL}/rest/v1/predictions?id=eq.{r['id']}"
        body = {
            "resolved_correctly": r["resolved_correctly"],
            "base_price": r["base_price"]
        }
        try:
            patch_res = requests.patch(patch_url, headers=headers, json=body, timeout=5)
            if patch_res.status_code in (200, 201, 204):
                updated_count += 1
            else:
                print(f"Failed to update prediction {r['id']}: {patch_res.text}")
        except Exception as e:
            print(f"Exception updating prediction {r['id']}: {e}")

    return {
        "status": "success",
        "total_pending": len(predictions),
        "evaluated_count": len(resolutions),
        "updated_count": updated_count
    }
