from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List
import concurrent.futures
import requests
from datetime import datetime, timedelta
from security import verify_token
from models import get_model, fetch_global_macro_features
from features import get_features_for_ticker, get_signals_from_features
from data_fetcher import fetch_polygon_aggs

router = APIRouter()

class BatchPredictRequest(BaseModel):
    tickers: List[str]
    horizon: str = "1d"
    macro: str = "false"

@router.get("/api/predict/{ticker}")
def predict_trend(ticker: str, horizon: str = "1d", macro: str = "false", user=Depends(verify_token)):
    ticker = ticker.upper()
    if horizon not in ("1d", "5d"):
        raise HTTPException(status_code=400, detail="Horizon must be '1d' or '5d'.")
    use_macro = macro.lower() == "true"
    
    try:
        model = get_model(ticker, horizon, use_macro)
    except Exception:
        raise HTTPException(status_code=500, detail="Model not found on server.")
        
    macro_df = fetch_global_macro_features() if use_macro else None
    data = get_features_for_ticker(ticker, use_macro, macro_df)
    
    if data is None:
        raise HTTPException(status_code=404, detail="Could not fetch data or calculate features for ticker.")
        
    latest_features, latest_close, history = data
    
    prediction = model.predict(latest_features)[0]
    probabilities = model.predict_proba(latest_features)[0]
    confidence = probabilities[prediction]
    
    trend = "UP" if prediction == 1 else "DOWN"
    signals = get_signals_from_features(latest_features, latest_close, use_macro)
    
    return {
        "ticker": ticker,
        "current_price": round(latest_close, 2),
        "predicted_trend": trend,
        "confidence": round(confidence * 100, 2),
        "history": history,
        "signals": signals
    }

@router.post("/api/predict_batch")
def predict_batch(req: BatchPredictRequest, user=Depends(verify_token)):
    if req.horizon not in ("1d", "5d"):
        raise HTTPException(status_code=400, detail="Horizon must be '1d' or '5d'.")
    
    results = []
    use_macro = req.macro.lower() == "true"
    macro_df = fetch_global_macro_features() if use_macro else None
    
    def process_ticker(t):
        try:
            model = get_model(t, req.horizon, use_macro)
            data = get_features_for_ticker(t, use_macro, macro_df)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                signals = get_signals_from_features(features, close_price, use_macro)
                return {
                    "ticker": t,
                    "current_price": round(close_price, 2),
                    "predicted_trend": "UP" if pred == 1 else "DOWN",
                    "confidence": round(conf * 100, 2),
                    "history": history,
                    "signals": signals
                }
        except Exception as e:
            print(f"Error predicting {t}: {e}")
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_ticker = {executor.submit(process_ticker, t): t for t in req.tickers}
        for future in concurrent.futures.as_completed(future_to_ticker):
            res = future.result()
            if res:
                results.append(res)
                
    ordered_results = []
    res_dict = {r["ticker"]: r for r in results}
    for t in req.tickers:
        if t in res_dict:
            ordered_results.append(res_dict[t])
            
    return {"results": ordered_results}

@router.get("/api/intraday/{ticker}")
def get_intraday(ticker: str, user=Depends(verify_token)):
    ticker = ticker.upper()
    try:
        start_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
        end_date = datetime.now().strftime("%Y-%m-%d")
        df = fetch_polygon_aggs(ticker, start_date, end_date, multiplier=5, timespan="minute")
        if df.empty:
            return {"history": []}
            
        last_day = df.index[-1].date()
        df = df[df.index.date == last_day]
            
        history = []
        for idx, row in df.iterrows():
            time_str = idx.strftime("%H:%M")
            history.append({"time": time_str, "price": round(row['Close'], 2)})
            
        return {"ticker": ticker, "history": history}
    except Exception as e:
        print(f"Intraday error for {ticker}: {e}")
        return {"history": []}

@router.get("/api/trending")
def get_trending(horizon: str = "1d", macro: str = "false", user=Depends(verify_token)):
    if horizon not in ("1d", "5d"):
        raise HTTPException(status_code=400, detail="Horizon must be '1d' or '5d'.")
    use_macro = macro.lower() == "true"
    
    trending_symbols = []
    try:
        url = "https://query1.finance.yahoo.com/v1/finance/trending/US?count=30"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            quotes = data.get("finance", {}).get("result", [{}])[0].get("quotes", [])
            for q in quotes:
                sym = q.get("symbol")
                if sym and "-" not in sym and "." not in sym and "^" not in sym:
                    trending_symbols.append(sym)
    except Exception as e:
        print(f"Failed to fetch trending from Yahoo: {e}")
        
    if len(trending_symbols) < 4:
        trending_symbols = ["AAPL", "MSFT", "NVDA", "SPY", "AMZN", "META", "GOOGL", "TSLA", "AMD", "NFLX", "JPM", "V"]
        
    trending_symbols = trending_symbols[:12]
    
    results = []
    macro_df = fetch_global_macro_features() if use_macro else None
    
    def process_ticker(t):
        try:
            model = get_model(t, horizon, use_macro)
            data = get_features_for_ticker(t, use_macro, macro_df)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                signals = get_signals_from_features(features, close_price, use_macro)
                return {
                    "ticker": t,
                    "current_price": round(close_price, 2),
                    "predicted_trend": "UP" if pred == 1 else "DOWN",
                    "confidence": round(conf * 100, 2),
                    "history": history,
                    "signals": signals
                }
        except Exception as e:
            print(f"Error predicting {t}: {e}")
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_ticker = {executor.submit(process_ticker, t): t for t in trending_symbols}
        for future in concurrent.futures.as_completed(future_to_ticker):
            res = future.result()
            if res:
                results.append(res)
                
    results.sort(key=lambda x: x["confidence"], reverse=True)
            
    return {"trending": results}

@router.get("/api/search")
def search_tickers(q: str, user=Depends(verify_token)):
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            quotes = data.get("quotes", [])
            results = [{"symbol": quote.get("symbol"), "name": quote.get("shortname", quote.get("longname", ""))} 
                       for quote in quotes if quote.get("quoteType") in ["EQUITY", "ETF"]]
            return {"results": results[:5]}
        return {"results": []}
    except Exception as e:
        print(f"Search error: {e}")
        return {"results": []}
