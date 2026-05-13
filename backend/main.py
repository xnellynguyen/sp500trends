from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import joblib
import os
import ta
import requests
import concurrent.futures

app = FastAPI(title="S&P 500 Trend Predictor API")

# Setup CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_sector(ticker_symbol):
    try:
        ticker_info = yf.Ticker(ticker_symbol).info
        sector = ticker_info.get('sector', '')
        if sector:
            # e.g., 'Financial Services' -> 'financial_services'
            return sector.replace(" ", "_").lower()
    except:
        pass
    return "technology"  # default fallback

def get_model(ticker, horizon, macro):
    sector = get_sector(ticker)
    mac_str = "macro" if macro == "true" else "nomacro"
    path = os.path.join(os.path.dirname(__file__), 'models', 'sector_models', f"{sector}_{horizon}_{mac_str}.joblib")
    if os.path.exists(path):
        return joblib.load(path)
    # Fallback to technology
    path = os.path.join(os.path.dirname(__file__), 'models', 'sector_models', f"technology_{horizon}_{mac_str}.joblib")
    if os.path.exists(path):
        return joblib.load(path)
    # Ultimate fallback to base model
    return joblib.load(os.path.join(os.path.dirname(__file__), 'models', 'rf_model.joblib'))

def fetch_global_macro_features():
    spy = yf.Ticker("SPY").history(period="6mo")
    vix = yf.Ticker("^VIX").history(period="6mo")
    
    if hasattr(spy.index, 'tz_localize'): spy.index = spy.index.tz_localize(None)
    if hasattr(vix.index, 'tz_localize'): vix.index = vix.index.tz_localize(None)
    
    macro_df = pd.DataFrame()
    macro_df['SPY_Return'] = spy['Close'].pct_change()
    macro_df['SPY_SMA_50'] = ta.trend.sma_indicator(spy['Close'], window=50)
    macro_df['VIX_Close'] = vix['Close']
    return macro_df

def get_signals_from_features(features, close_price, use_macro):
    signals = {}
    
    rsi = float(features['RSI_14'].iloc[0])
    signals['rsi'] = {
        "value": round(rsi, 2),
        "direction": "UP" if rsi < 45 else "DOWN" if rsi > 55 else "NEUTRAL"
    }
    
    macd_diff = float(features['MACD_Diff'].iloc[0])
    signals['macd'] = {
        "value": round(macd_diff, 3), 
        "direction": "UP" if macd_diff > 0 else "DOWN"
    }
    
    sma20 = float(features['SMA_20'].iloc[0])
    signals['sma20'] = {
        "value": round(sma20, 2), 
        "direction": "UP" if close_price > sma20 else "DOWN"
    }
    
    b_high = float(features['Bollinger_High'].iloc[0])
    b_low = float(features['Bollinger_Low'].iloc[0])
    signals['bollinger'] = {
        "value": round(close_price, 2), 
        "direction": "UP" if close_price < b_low * 1.05 else "DOWN" if close_price > b_high * 0.95 else "NEUTRAL"
    }
    
    if use_macro == "true":
        vix = float(features['VIX_Close'].iloc[0])
        signals['vix'] = {
            "value": round(vix, 2), 
            "direction": "DOWN" if vix > 20 else "UP"
        }
        
    return signals

def get_features_for_ticker(ticker_symbol, use_macro="false", macro_df=None):
    """Fetch recent data and compute features for a single prediction."""
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.history(period="6mo")
    
    if df.empty: return None
    if hasattr(df.index, 'tz_localize'): df.index = df.index.tz_localize(None)
        
    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12)
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close'])
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close'])
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close'])
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close'])
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close'])
    
    if use_macro == "true" and macro_df is not None:
        df = df.join(macro_df, how='left')
    
    df = df.dropna()
    if df.empty: return None
        
    features = [
        'Open', 'High', 'Low', 'Close', 'Volume',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    if use_macro == "true":
        features.extend(['SPY_Return', 'SPY_SMA_50', 'VIX_Close'])
        
    latest_features = df[features].iloc[[-1]]
    latest_close = df['Close'].iloc[-1]
    
    history_df = df.tail(30)
    history = [{"date": str(idx.date()), "price": round(row['Close'], 2)} for idx, row in history_df.iterrows()]
    
    return latest_features, latest_close, history

@app.get("/")
def read_root():
    return {"message": "S&P 500 Trend Predictor API is running."}

@app.get("/api/predict/{ticker}")
def predict_trend(ticker: str, horizon: str = "1d", macro: str = "false"):
    ticker = ticker.upper()
    try:
        model = get_model(ticker, horizon, macro)
    except:
        raise HTTPException(status_code=500, detail="Model not found on server.")
        
    macro_df = fetch_global_macro_features() if macro == "true" else None
    data = get_features_for_ticker(ticker, macro, macro_df)
    
    if data is None:
        raise HTTPException(status_code=404, detail="Could not fetch data or calculate features for ticker.")
        
    latest_features, latest_close, history = data
    
    prediction = model.predict(latest_features)[0]
    probabilities = model.predict_proba(latest_features)[0]
    confidence = probabilities[prediction]
    
    trend = "UP" if prediction == 1 else "DOWN"
    
    signals = get_signals_from_features(latest_features, latest_close, macro)
    
    return {
        "ticker": ticker,
        "current_price": round(latest_close, 2),
        "predicted_trend": trend,
        "confidence": round(confidence * 100, 2),
        "history": history,
        "signals": signals
    }

class BatchPredictRequest(BaseModel):
    tickers: List[str]
    horizon: str = "1d"
    macro: str = "false"

@app.post("/api/predict_batch")
def predict_batch(req: BatchPredictRequest):
    results = []
    macro_df = fetch_global_macro_features() if req.macro == "true" else None
    
    def process_ticker(t):
        try:
            model = get_model(t, req.horizon, req.macro)
            data = get_features_for_ticker(t, req.macro, macro_df)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                signals = get_signals_from_features(features, close_price, req.macro)
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
                
    # Maintain original order
    ordered_results = []
    res_dict = {r["ticker"]: r for r in results}
    for t in req.tickers:
        if t in res_dict:
            ordered_results.append(res_dict[t])
            
    return {"results": ordered_results}

@app.get("/api/intraday/{ticker}")
def get_intraday(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        df = stock.history(period="1d", interval="5m")
        if df.empty:
            return {"history": []}
            
        history = []
        # Convert index to localized time if needed, but it's usually timezone-aware
        for idx, row in df.iterrows():
            time_str = idx.strftime("%H:%M")
            history.append({"time": time_str, "price": round(row['Close'], 2)})
            
        return {"ticker": ticker, "history": history}
    except Exception as e:
        print(f"Intraday error for {ticker}: {e}")
        return {"history": []}

from fastapi import Query
from datetime import datetime
import traceback

@app.get("/api/earnings/{ticker}")
def get_earnings_info(ticker: str):
    fmp_key = os.environ.get("FMP_API_KEY")
    if not fmp_key:
        return {"error": "FMP API key not configured on server"}
        
    try:
        # 1. Earnings Date
        earnings_res = requests.get(f"https://financialmodelingprep.com/api/v3/earning_calendar/{ticker}?apikey={fmp_key}", timeout=5)
        earnings_data = earnings_res.json() if earnings_res.status_code == 200 else []
        
        next_date = None
        days_until = -1
        is_warning = False
        
        if earnings_data and len(earnings_data) > 0:
            for item in earnings_data:
                date_str = item.get("date")
                if date_str:
                    e_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                    if e_date >= datetime.now().date():
                        next_date = date_str
                        days_until = (e_date - datetime.now().date()).days
                        is_warning = days_until <= 5
            
            # If all are in past
            if not next_date:
                next_date = earnings_data[0].get("date")
                
        # 2. Analyst Consensus
        analyst_res = requests.get(f"https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/{ticker}?apikey={fmp_key}", timeout=5)
        analyst_data = analyst_res.json() if analyst_res.status_code == 200 else []
        
        analyst_info = None
        if analyst_data and len(analyst_data) > 0:
            latest = analyst_data[0]
            buy_count = latest.get("analystRatingsbuy", 0) + latest.get("analystRatingsStrongBuy", 0)
            total_count = buy_count + latest.get("analystRatingsHold", 0) + latest.get("analystRatingsSell", 0) + latest.get("analystRatingsStrongSell", 0)
            
            analyst_info = {
                "buy_count": buy_count,
                "total_count": total_count,
                "consensus": "BUY" if (buy_count / max(total_count, 1)) > 0.5 else "HOLD"
            }
            
        # 3. Surprises
        surp_res = requests.get(f"https://financialmodelingprep.com/api/v3/earnings-surprises/{ticker}?apikey={fmp_key}", timeout=5)
        surp_data = surp_res.json() if surp_res.status_code == 200 else []
        
        beat_rate = None
        if surp_data and len(surp_data) > 0:
            recent = surp_data[:8]
            beats = sum(1 for q in recent if q.get("actualEarningResult", 0) > q.get("estimatedEarning", 0))
            beat_rate = round(beats / len(recent), 2)
            
        return {
            "ticker": ticker,
            "next_earnings_date": next_date,
            "days_until": days_until,
            "is_warning": is_warning,
            "analyst": analyst_info,
            "historical_beats": {
                "beat_rate": beat_rate,
                "quarters_checked": min(len(surp_data) if surp_data else 0, 8)
            }
        }
    except Exception as e:
        print(f"Earnings error: {e}")
        traceback.print_exc()
        return {"error": "Failed to fetch earnings info"}

@app.get("/api/search")
def search_tickers(q: str):
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

@app.get("/api/trending")
def get_trending(horizon: str = "1d", macro: str = "false"):
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
    
    macro_df = fetch_global_macro_features() if macro == "true" else None
    
    def process_ticker(t):
        try:
            model = get_model(t, horizon, macro)
            data = get_features_for_ticker(t, macro, macro_df)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                signals = get_signals_from_features(features, close_price, macro)
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
                
    # Sort by probability (confidence) descending
    results.sort(key=lambda x: x["confidence"], reverse=True)
            
    return {"trending": results}
